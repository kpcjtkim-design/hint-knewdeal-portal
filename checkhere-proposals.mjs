import {canWithdraw,withdrawRequest} from './checkhere-request-actions.mjs';
import {reasonFor} from './attendance-reason-parser.mjs';
import {collection,doc,getDoc,getDocFromServer,getDocs,query,where,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {within,readJson} from './attendance-io.mjs';
import {isoLabel} from './attendance-beta-core.mjs';
import {deriveRecognized} from './attendance-derived-core.mjs';
import {APPROVER,cleanRequest,matchRequest,sameRequestTarget} from './checkhere/approval-core.mjs';
import {judge} from './checkhere/rules.mjs';
import {ACTIVE_REQUESTS,PROPOSAL_STATUS,suggestReason,sourceRecord,assertColumnSource,requestChanges,suggestTimes,REQUEST_COLUMNS,columnFields,requestsOverlap,requestColumn} from './checkhere-proposal-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>`${s.rowIndex}_${s.name}`;
const fingerprint=c=>JSON.stringify({status:c.status,reason:c.reason,teacher:c.teacher,excursion:!!c.excursion,record:sourceRecord(c.record)});
const draftId=(cid,date)=>`checkhereProposalDrafts_${cid}_${date}`;
const contextId=id=>`checkhereProposalRequest_${id}`;
export async function validateSheetSource(db,user,c,cache=new Map(),{signal,timeout=55000}={}){
  const cacheKey=String(c.classId);
  if(!cache.has(cacheKey)||Date.now()-cache.get(cacheKey).readAt>10000){const entry={readAt:Date.now()};entry.promise=(async()=>{const data=await readJson('/api/attendance-reader',{classId:c.classId,fresh:true,idToken:await within(user.getIdToken(),8000,'로그인 확인이 지연됩니다. 다시 로그인해 주세요.',signal)},{signal,timeout});entry.readAt=Date.now();return data;})();cache.set(cacheKey,entry);}
  let data;try{data=await cache.get(cacheKey).promise;}catch(e){cache.delete(cacheKey);throw e;}
  const a=data.attendance||[],dates=(a[0]||[]).map((v,i)=>({iso:isoLabel(v),i})).filter(x=>x.i>=4&&x.iso===c.date),students=a.slice(1).filter(row=>String(row[0]||'').trim()===c.name);
  const reasonDates=(data.reasons?.[0]||[]).map((v,i)=>({iso:isoLabel(v),i})).filter(x=>x.i>=4&&x.iso===c.date);
  if(dates.length!==1||students.length!==1||reasonDates.length!==1)throw Error('시트 학생·날짜 연결이 달라졌습니다. 다시 읽고 검토해 주세요.');
  const raw=String(data.reasons?.[1]?.[reasonDates[0].i]||''),rawStatus=String(students[0][dates[0].i]||'').trim();
  const meta=(await within(getDocFromServer(doc(db,'settings',`attendanceBeta_${c.classId}_${c.date}`)),15000,undefined,signal)).data()?.students?.[c.studentKey]||{};
  const roster=a.slice(1).map(row=>String(row[0]||'').trim());
  const currentReason=meta.reasonEntry&&raw.split(/\r?\n/).includes(meta.reasonEntry)?meta.portalReason:reasonFor(c.name,raw,roster,rawStatus);
  const expectedReason=c.reason??reasonFor(c.name,c.raw,roster,rawStatus);
  // Use the same interpretation as the attendance screen: the Sheet stores all
  // recognized types as 인정출석, while the portal also uses the collected times.
  const currentStatus=deriveRecognized(rawStatus,meta,c.record,{excursion:!!c.excursion}).status;
  if(currentReason!==expectedReason)throw Error('요청의 기준인 시트 사유가 바뀌었습니다. 출결대조에서 다시 읽고 검토해 주세요.');
  if(currentStatus!==c.status)throw Error(`요청의 기준인 출결 구분이 바뀌었습니다 (${c.status} → ${currentStatus}). 출결대조에서 다시 읽고 검토해 주세요.`);
}
export async function validateLinkedRequest(db,user,request,record,cache,identities=[]){
  // Approval applies the submitted target reviewed against the live student record.
  // Archived suggestions and later Sheet edits are provenance, not approval locks.
  // The approval transaction separately checks that the request itself is unchanged.
  matchRequest(request,[record],identities);
}
export function createProposalReview({db,user,root,getContext,render,showErr,hasUnsavedReason,timeouts={}}){
 let saved={},requests=[],loadError='',sequence=0,working=false,loadedClass='',loadedDate='';
 const limits={source:55000,read:15000,write:20000,...timeouts};
 const journalKey=`hintProposalReceipts_v1_${user.uid||user.email}`;
 let journal={};try{journal=JSON.parse(localStorage.getItem(journalKey)||'{}');}catch{}
 const receiptKey=v=>`${v.c.classId}/${v.c.date}/${v.c.studentKey}/${v.column}`;
 const remember=(key,value)=>{if(value)journal[key]=value;else delete journal[key];try{localStorage.setItem(journalKey,JSON.stringify(journal));}catch{if(value)throw Error('이 브라우저에 요청 번호를 보관할 수 없습니다. 브라우저 저장 공간을 확인해 주세요.');}};
 const recordRequest=r=>{if(String(r.classId)!==loadedClass||r.date!==loadedDate)return;requests=requests.filter(x=>x.id!==r.id);requests.push(r);};
 let boundStudents=[];const edits=new Map(),columns=Object.keys(REQUEST_COLUMNS),slot=(s,column)=>`${key(s)}__${column}`;
 const context=s=>({...getContext(s),studentKey:key(s)});
 const current=(c,column)=>column==='times'?{entry:c.record?.entry||'',exit:c.record?.exit||''}:c.record?.[column]||'';
 const activeFor=(s,column)=>requests.find(r=>r.name===s.name&&ACTIVE_REQUESTS.includes(r.status)&&Object.keys(r.changes).some(k=>columnFields(column).includes(k)));
 function view(s,column){
  const c=context(s),auto=column==='times'?suggestTimes(c):suggestReason(c),legacy=saved[key(s)],draft=saved[slot(s,column)]||(legacy?.field===column?legacy:null);
  const recommended=column==='times'?auto.value:(auto.fields||[auto.field]).includes(column)?auto.text:'';
  const fallback=column==='times'?auto.value:auto.clear?'':recommended||current(c,column);
  const receipt=journal[receiptKey({c,column})];
  const edited=receipt||edits.get(slot(s,column)),stored=edited||draft,origin=stored?.origin|| (stored?'manual':'auto');
  const sourceChanged=!!stored&&stored.fingerprint!==fingerprint(c);
  const value=origin==='auto'&&sourceChanged?fallback:edited?.value??draft?.value??draft?.text??fallback;
  const stale=origin==='manual'&&sourceChanged;
  const request=activeFor(s,column)||requests.filter(r=>r.name===s.name&&Object.keys(r.changes).some(k=>columnFields(column).includes(k))).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];
  return {c,column,auto,recommended,value,stale,origin,draft,receipt,revision:receipt?.revision??saved[slot(s,column)]?.revision??0,request};
 }
 function disabledReason(v){
  if(working)return '요청 처리 중';
  if(v.receipt&&v.receipt.state!=='retry')return '접수 확인 필요 · 같은 요청을 새로 만들지 않습니다.';
  if(activeFor({name:v.c.name},v.column))return '이 항목은 승인 대기 또는 반영 중입니다.';
  return '';
 }

 function html(s,column){
  const v=view(s,column),active=v.request&&ACTIVE_REQUESTS.includes(v.request.status),locked=active||!!v.receipt,disabled=disabledReason(v),ident=esc(slot(s,column));
  let changed=false;try{requestChanges(v.c.record||{},column,v.value);changed=true;}catch{}
  const label=v.receipt?(v.receipt.state==='retry'?'동일 요청 번호로 재시도 가능':'접수 확인 필요'):active?PROPOSAL_STATUS[v.request.status]:disabled.startsWith('반영 확인 완료')?'반영 확인 완료':v.stale?'재검토 필요':v.request?.status==='withdrawn'?'취소 · 다시 요청 가능':!v.c.record?'저장본 미수집 · 미리보기':changed?'변경 필요':'현재 기록과 일치';
  const shownValue=active&&column==='times'?{...(v.draft?.value||current(v.c,column)),...v.request.changes}:v.value;
  const controls=column==='times'?`<div class="proposal-times">${['entry','exit'].map(k=>`<label>${k==='entry'?'입실':'퇴실'}<input type="time" step="1" data-proposal-edit="${ident}" data-time="${k}" aria-label="${esc(s.name)} 추천 ${k==='entry'?'입실':'퇴실'}시간" value="${esc(shownValue[k]||'')}" ${locked?'disabled':''}></label>`).join('')}</div>`:`<textarea class="proposal-input" data-proposal-edit="${ident}" maxlength="500" aria-label="${esc(s.name+' '+REQUEST_COLUMNS[column])} 추천사유" placeholder="사유 확인 후 직접 입력" ${locked?'disabled':''}>${esc(active?v.request.changes[column]??v.value:v.value)}</textarea>`;
  return `<div class="proposal-box ${changed||v.stale?'changed':''}" data-proposal-box="${ident}"><strong>${column==='times'?'추천시간':'추천사유'} · 편집 가능</strong><small class="proposal-label">${esc(label)}</small>${controls}${v.stale||active?`<small class="proposal-warning">시트 변경 후 추천: ${esc(column==='times'?`${v.recommended.entry||'공란'} → ${v.recommended.exit||'공란'}`:v.recommended|| (v.auto.clear?'공란(사유 없음)':'자동 생성 불가 · 원문 확인'))}</small>`:''}<small>${esc(disabled||(!v.recommended||column==='times'?v.auto.notes?.[0]||'':'시트 출결·사유와 수집 시간을 기준으로 생성'))}</small><div class="proposal-cell-actions">${column!=='times'?`<button class="btn soft" data-proposal-clear="${ident}" ${locked?'disabled':''}>공란으로 변경</button>`:''}<button class="btn soft" data-proposal-reset="${ident}" ${locked?'disabled':''}>추천 다시 생성</button><button class="btn dark" data-proposal-send="${ident}" ${disabled||!changed?'disabled':''}>변경요청</button></div>${v.receipt?`<button class="btn soft" data-proposal-receipt="${ident}">접수 확인</button>`:''}${v.stale&&!v.receipt?`<button class="btn soft" data-proposal-accept="${ident}">직접 수정값 유지 · 근거 확인</button>`:''}${active&&canWithdraw(v.request,user)?`<button class="btn soft" data-proposal-withdraw="${ident}">요청취소</button>`:''}${active?'<small>요청 접수 · 체크히어 승인 후 반영</small>':'<small>추천값 편집만으로 체크히어가 변경되지 않습니다.</small>'}</div>`;
 }
 async function read(classId,iso){const [d,list]=await Promise.all([getDoc(doc(db,'checkhereProposalDrafts',draftId(String(classId),iso))),getDocs(query(collection(db,'checkhereRequests'),where('classId','==',String(classId)),where('date','==',iso)))].map(p=>within(p,limits.read)));return {saved:d.data()?.students||{},requests:list.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.date===iso)};}
 function applyRead(data){saved=data.saved;requests=data.requests;loadError='';for(const [name,item]of Object.entries(journal)){if(requests.some(r=>r.id===item.id))remember(name,null);}}
 async function load(classId,iso,preserve=false){
  const n=++sequence,same=loadedClass===String(classId)&&loadedDate===iso;loadedClass=String(classId);loadedDate=iso;if(!preserve&&!same)edits.clear();saved={};requests=[];loadError='';
  try{const data=await read(classId,iso);if(n!==sequence)return;applyRead(data);}catch(e){if(n===sequence){loadError=e.message;showErr(new Error('체크히어 추천사유 조회 실패: '+e.message));}}
 }
 async function checkReceipt(s,column){
  const v=view(s,column),name=receiptKey(v),item=journal[name];if(!item)return;
  const snapshot=await within(getDocFromServer(doc(db,'checkhereRequests',item.id)),limits.read);
  if(snapshot.exists()){recordRequest({id:item.id,...snapshot.data()});remember(name,null);edits.delete(slot(s,column));}
  else remember(name,{...item,state:'retry'});
 }
 async function submit(s,v,cache,signal,progress){
  const generation=sequence,discardEdit=()=>{if(generation===sequence)edits.delete(slot(s,v.column));};
  const block=disabledReason(v);if(block&&block!=='요청 처리 중')throw Error(block);
  const changes=requestChanges(v.c.record||{},v.column,v.value);
  const input=cleanRequest({classId:v.c.classId,date:v.c.date,name:s.name,phoneLast4:v.c.record?.phoneLast4||v.c.phoneLast4||'',changes,reason:`출결대조 ${REQUEST_COLUMNS[v.column]} · ${v.c.status} · ${v.c.reason||'일반 출결'}${v.c.excursion?' · 견학일 확인':''}`.slice(0,1000)});
  const name=slot(s,v.column),receipt=receiptKey(v);let previousReceipt=journal[receipt];
  if(previousReceipt){
    progress('기존 요청 접수 확인 중…');
    const found=await within(getDocFromServer(doc(db,'checkhereRequests',previousReceipt.id)),limits.read,undefined,signal);
    if(found.exists()){recordRequest({id:previousReceipt.id,...found.data()});remember(receipt,null);if(['withdrawn','rejected'].includes(found.data().status))previousReceipt=null;else{discardEdit();return previousReceipt.id;}}
  }
  // Submit the administrator's explicit target. Sheet and collector diagnostics
  // inform the approver; they must not prevent a pending request from being saved.
  signal.throwIfAborted();
  const signature=JSON.stringify(input);
  if(previousReceipt){let original;try{const stored=JSON.parse(previousReceipt.signature);original=stored.input||stored;}catch{}if(!sameRequestTarget(original,input))throw Error('접수 확인 중인 요청값이 다릅니다. 접수 확인 후 다시 요청해 주세요.');}
  const id=previousReceipt?.id||'proposal_'+crypto.randomUUID(),ref=doc(db,'checkhereProposalDrafts',draftId(v.c.classId,v.c.date));
  const attempt=crypto.randomUUID(),item={id,value:v.value,origin:v.origin,fingerprint:fingerprint(v.c),revision:v.revision,signature,state:'confirming',attempt};
  // Preserve the operation ID before the first write. Retries read and reuse it.
  remember(receipt,item);progress('요청 저장 중… 창을 닫아도 진행된 요청의 접수 확인은 계속됩니다.');
  const deadline=performance.now()+limits.write;
  const transaction=runTransaction(db,async tx=>{
   const existing=await tx.get(doc(db,'checkhereRequests',id));
   if(existing.exists()){
    const r=existing.data();if(r.createdBy!==user.email||!sameRequestTarget(r,input))throw Error('요청 번호의 내용이 다릅니다. 접수 현황을 확인해 주세요.');
    return {id,...r};
   }
   const snap=await tx.get(ref),students=snap.data()?.students||{},previous=students[name];
   const ids=[...new Set([key(s),...columns.map(c=>slot(s,c))].map(k=>students[k]?.activeId).filter(Boolean))];
   const live=await Promise.all(ids.map(id=>tx.get(doc(db,'checkhereRequests',id))));
   if(live.some(d=>{const r=d.data();return r&&ACTIVE_REQUESTS.includes(r.status)&&requestsOverlap(r,input);})||requests.some(r=>ACTIVE_REQUESTS.includes(r.status)&&requestsOverlap(r,input)))throw Error('동일 항목의 진행 중인 요청이 있습니다.');
   if(performance.now()>=deadline)throw Error('요청 저장 대기 시간이 지나 중단했습니다. 다시 요청해 주세요.');
   const row={...input,status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
   tx.set(doc(db,'checkhereRequests',id),row);
   // Preserve the inputs as request provenance, not an approval-time lock.
   // For legacy records without rawEntry, entry is the physical arrival value.
   const record={...sourceRecord(v.c.record),rawEntry:(Object.hasOwn(v.c.record||{},'rawEntry')?v.c.record.rawEntry:v.c.record?.entry)??null,outingCount:v.c.record?.outingCount??v.c.record?.outings?.length??0,exception:v.c.record?.exception||null};
   tx.set(doc(db,'checkhereProposalSources',contextId(id)),{requestId:id,classId:v.c.classId,date:v.c.date,name:s.name,studentKey:key(s),status:v.c.status||'',reason:v.c.reason||'',raw:v.c.raw||'',record,excursion:!!v.c.excursion,changes,column:v.column,sourceScope:'column-v2',updatedBy:user.email,updatedAt:serverTimestamp()});
   tx.set(ref,{classId:v.c.classId,date:v.c.date,students:{[name]:{value:v.value,origin:v.origin,field:v.column,fingerprint:fingerprint(v.c),revision:(previous?.revision||0)+1,activeId:id}},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true});
   return {id,...row};
  },{maxAttempts:3});
  transaction.then(r=>{recordRequest(r);if(journal[receipt]?.id===id)remember(receipt,null);discardEdit();if(!working&&root.isConnected)render();},()=>{if(journal[receipt]?.attempt===attempt)remember(receipt,{...item,state:'retry'});if(!working&&root.isConnected)render();});
  try{await within(transaction,limits.write,'응답 지연으로 접수 여부를 확인하고 있습니다.');}
  catch(e){
   if(e.code==='READ_TIMEOUT'){
    progress('접수 여부 확인 중… 중복 요청은 만들지 않습니다.');
    try{const found=await within(getDocFromServer(doc(db,'checkhereRequests',id)),limits.read);if(found.exists()){recordRequest({id,...found.data()});remember(receipt,null);discardEdit();return id;}}catch{}
    if(!journal[receipt]&&requests.some(r=>r.id===id))return id;
    throw Object.assign(Error('접수 결과 확인 필요 · 셀의 「접수 확인」을 눌러 주세요. 새 요청은 만들지 않습니다.'),{uncertain:true});
   }
   // A retry keeps the same ID even if the transport reported a failure.
   throw e;
  }
  return id;
 }

 function capture(students){
  const bySlot=new Map();for(const node of root.querySelectorAll('[data-proposal-edit]')){const name=node.dataset.proposalEdit;if(!bySlot.has(name))bySlot.set(name,[]);bySlot.get(name).push(node);}
  for(const s of students)for(const column of columns){const name=slot(s,column),nodes=bySlot.get(name)||[];if(!nodes.length||nodes[0].disabled)continue;const v=view(s,column),value=column==='times'?Object.fromEntries(nodes.map(x=>[x.dataset.time,x.value])):nodes[0].value;if(JSON.stringify(value)!==JSON.stringify(v.value))edits.set(name,{value,origin:'manual',fingerprint:edits.get(name)?.fingerprint??v.draft?.fingerprint??fingerprint(v.c)});}
 }

 async function sendMany(students,column){
  if(working)return;capture(students);const results=[],pending=[];
  for(const s of students){const v=view(s,column);try{const why=disabledReason(v);if(why)throw Error(why);requestChanges(v.c.record||{},column,v.value);pending.push({s,v});}catch(e){results.push(`${s.name}: ${e.message}`);}}
  if(!pending.length){alert('요청 가능한 변경이 없습니다.\n'+results.join('\n'));return;}
  const dialog=document.createElement('dialog');dialog.className='proposal-dialog';root.append(dialog);
  const display=value=>typeof value==='object'?`${value.entry||'공란'} → ${value.exit||'공란'}`:value||'공란(사유 없음)';
  dialog.innerHTML=`<h3>${esc(REQUEST_COLUMNS[column])} · 변경요청 ${pending.length}건</h3><p>실제 변경까지는 시간이 걸립니다. 체크히어 탭에서 지정 관리자가 수집 PC로 승인·반영해야 완료됩니다.</p><table><thead><tr><th>학생</th><th>현재 기록</th><th>요청할 값</th></tr></thead><tbody>${pending.map(({s,v})=>`<tr><th>${esc(s.name)}</th><td>${esc(display(current(v.c,column)))}</td><td>${esc(display(v.value))}</td></tr>`).join('')}</tbody></table>${column!=='times'&&pending.some(x=>x.v.c.record&&judge({...x.v.c.record,source:'live'}).issues.some(i=>i.code==='MULTIPLE'))?'<p class="proposal-warning">지각·조퇴·외출이 겹친 기록이 포함되어 있습니다. 사유만 요청하며 입퇴실 시간은 유지합니다.</p>':''}${pending.some(x=>x.v.c.excursion)?'<p class="proposal-warning">견학일입니다. 실제 운영 시간과 사유를 확인해 주세요.</p>':''}${results.length?`<details><summary>제외 ${results.length}건</summary><pre>${esc(results.join('\n'))}</pre></details>`:''}<p role="status" id="requestResult"></p><button id="sendSelected" class="btn dark">${pending.length}건 변경요청</button><button id="closeRequests">닫기</button>`;
  let controller;
  const close=()=>{controller?.abort();dialog.close();dialog.remove();};dialog.querySelector('#closeRequests').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
  dialog.querySelector('#sendSelected').onclick=async()=>{
   if(working)return;working=true;controller=new AbortController();dialog.querySelector('#sendSelected').disabled=true;
   let count=0,uncertain=0;const failed=[],cache=new Map(),status=dialog.querySelector('#requestResult');
   try{
    for(const {s,v}of pending){
     if(controller.signal.aborted)break;
     try{await submit(s,v,cache,controller.signal,message=>{status.textContent=`${s.name} · ${message} (${count+1}/${pending.length})`;});count++;}
     catch(e){if(e.name==='AbortError')break;if(e.uncertain)uncertain++;else failed.push(`${s.name}: ${e.code==='permission-denied'?'관리자 요청 저장 권한을 확인하지 못했습니다. 로그인 계정의 관리자 등록 상태를 확인해 주세요.':e.message}`);}
    }
   }finally{
    working=false;dialog.querySelector('#sendSelected').disabled=true;
    status.textContent=`${count}건 요청 접수 · ${failed.length}건 실패${uncertain?' · '+uncertain+'건 접수 확인 필요':''}. 체크히어 탭에서 승인 후 반영됩니다.${controller.signal.aborted?' 아직 시작하지 않은 요청은 중단했습니다.':''}${failed.length?'\n'+failed.join('\n'):''}`;
    if(!dialog.isConnected&&(count||uncertain||failed.length))showErr(new Error(status.textContent));
    render();
   }
  };

  dialog.showModal();
 }
 function refresh(students){const boxes=new Map([...root.querySelectorAll('[data-proposal-box]')].map(el=>[el.dataset.proposalBox,el]));for(const s of students)for(const column of columns){const el=boxes.get(slot(s,column));if(el)el.outerHTML=html(s,column);}bind(boundStudents.length?boundStudents:students);}

 function bind(students){
  boundStudents=students;const lookup=new Map(students.flatMap(s=>columns.map(column=>[slot(s,column),{s,column}])));
  const resolve=name=>lookup.get(name);
  root.querySelectorAll('[data-proposal-edit]').forEach(el=>el.oninput=()=>{const {s,column}=resolve(el.dataset.proposalEdit);capture([s]);const v=view(s,column),box=el.closest('[data-proposal-box]');let different=false;try{requestChanges(v.c.record||{},column,v.value);different=true;}catch{}box.querySelector('[data-proposal-send]').disabled=!!disabledReason(v)||!different;box.classList.toggle('changed',different);box.querySelector('.proposal-label').textContent=v.stale?'재검토 필요':different?'변경 필요':'현재 기록과 일치';});
  for(const action of ['send','reset','accept','clear','withdraw','receipt'])root.querySelectorAll(`[data-proposal-${action}]`).forEach(el=>el.onclick=async()=>{capture(students);const{s,column}=resolve(el.getAttribute(`data-proposal-${action}`));if(action==='send'){sendMany([s],column);return;}const v=view(s,column);if(action==='receipt'){el.disabled=true;try{await checkReceipt(s,column);}catch(e){showErr(e);}finally{render();}return;}if(action==='withdraw'){if(!confirm(`${s.name}의 승인 대기 요청을 취소할까요?`))return;working=true;el.disabled=true;try{const cancelled=await withdrawRequest(db,user,v.request.id);remember(receiptKey(v),null);await load(v.c.classId,v.c.date,true);recordRequest(cancelled);edits.set(slot(s,column),{value:v.request.changes[column]??v.value,origin:v.origin,fingerprint:fingerprint(v.c)});}catch(e){showErr(e);}finally{working=false;render();}return;}if(action==='clear'){edits.set(slot(s,column),{value:'',origin:'manual',fingerprint:fingerprint(v.c)});render();return;}if(action==='reset'){if(!confirm('현재 시트·체크히어 데이터로 추천값을 다시 만들까요?'))return;edits.set(slot(s,column),{value:column==='times'?v.auto.value:v.auto.clear?'':v.recommended||current(v.c,column),origin:'auto',fingerprint:fingerprint(v.c)});}else edits.set(slot(s,column),{value:v.value,origin:'manual',fingerprint:fingerprint(v.c)});render();});
  root.querySelectorAll('[data-proposal-bulk]').forEach(b=>b.onclick=()=>sendMany(students,b.dataset.proposalBulk));
 }
 return {html,load,read,applyRead,capture,refresh,bind,hasEdits:()=>edits.size>0,isWorking:()=>working,exportFor(s){return columns.flatMap(column=>{const v=view(s,column);return[column==='times'?`${v.value.entry||''} → ${v.value.exit||''}`:v.value,v.request?PROPOSAL_STATUS[v.request.status]:'미요청'];});}};
}
