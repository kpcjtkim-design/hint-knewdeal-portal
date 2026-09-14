import {reasonFor} from './attendance-reason-parser.mjs';
import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {portalStatus,isoLabel} from './attendance-beta-core.mjs';
import {cleanRequest} from './checkhere/approval-core.mjs';
import {judge} from './checkhere/rules.mjs';
import {ACTIVE_REQUESTS,PROPOSAL_STATUS,suggestReason,sourceRecord,assertColumnSource,requestChanges,suggestTimes,REQUEST_COLUMNS,columnFields,requestsOverlap,requestColumn} from './checkhere-proposal-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>`${s.rowIndex}_${s.name}`;
const fingerprint=c=>JSON.stringify({status:c.status,reason:c.reason,excursion:!!c.excursion,record:sourceRecord(c.record)});
const draftId=(cid,date)=>`checkhereProposalDrafts_${cid}_${date}`;
const contextId=id=>`checkhereProposalRequest_${id}`;
export async function validateSheetSource(db,user,c,cache=new Map()){
  const cacheKey=String(c.classId);
  if(!cache.has(cacheKey)||Date.now()-cache.get(cacheKey).readAt>10000)cache.set(cacheKey,{readAt:Date.now(),promise:(async()=>{const response=await fetch('/api/attendance-reader',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({classId:c.classId,idToken:await user.getIdToken()}),cache:'no-store'});const data=await response.json();if(!response.ok||data.ok===false)throw Error('현재 시트를 다시 확인하지 못했습니다. 요청·승인을 중단합니다.');return data;})()});
  const data=await cache.get(cacheKey).promise;
  const a=data.attendance||[],dates=(a[0]||[]).map((v,i)=>({iso:isoLabel(v),i})).filter(x=>x.i>=4&&x.iso===c.date),students=a.slice(1).filter(row=>String(row[0]||'').trim()===c.name);
  const reasonDates=(data.reasons?.[0]||[]).map((v,i)=>({iso:isoLabel(v),i})).filter(x=>x.i>=4&&x.iso===c.date);
  if(dates.length!==1||students.length!==1||reasonDates.length!==1)throw Error('시트 학생·날짜 연결이 달라졌습니다. 다시 읽고 검토해 주세요.');
  const raw=String(data.reasons?.[1]?.[reasonDates[0].i]||''),rawStatus=String(students[0][dates[0].i]||'').trim();
  const meta=(await getDoc(doc(db,'settings',`attendanceBeta_${c.classId}_${c.date}`))).data()?.students?.[c.studentKey]||{};
  const roster=a.slice(1).map(row=>String(row[0]||'').trim());
  const currentReason=meta.reasonEntry&&raw.split(/\r?\n/).includes(meta.reasonEntry)?meta.portalReason:reasonFor(c.name,raw,roster,rawStatus);
  const expectedReason=c.reason??reasonFor(c.name,c.raw,roster,rawStatus);
  if(currentReason!==expectedReason||portalStatus(rawStatus,meta)!==c.status)throw Error('요청의 기준인 시트 출결·사유가 바뀌었습니다. 출결대조에서 다시 읽고 검토해 주세요.');
}
export async function validateLinkedRequest(db,user,request,record,cache){
  if(!request.id.startsWith('proposal_'))return;
  const context=(await getDoc(doc(db,'checkhereProposalSources',contextId(request.id)))).data();
  if(!context||context.requestId!==request.id)throw Error('자동 제안의 근거 기록을 찾지 못했습니다.');
  if(JSON.stringify(request.changes)!==JSON.stringify(context.changes))throw Error('요청과 보관된 제안이 다릅니다.');
  if(context.sourceScope==='column-v2'&&requestColumn(request)!==context.column)throw Error('요청 항목과 근거가 다릅니다.');
  assertColumnSource(context,record);
  await validateSheetSource(db,user,context,cache);
}
export function createProposalReview({db,user,root,getContext,render,showErr,hasUnsavedReason}){
 let saved={},requests=[],loadError='',sequence=0,working=false;
 const edits=new Map(),columns=Object.keys(REQUEST_COLUMNS),slot=(s,column)=>`${key(s)}__${column}`;
 const context=s=>({...getContext(s),studentKey:key(s)});
 const current=(c,column)=>column==='times'?{entry:c.record?.entry||'',exit:c.record?.exit||''}:c.record?.[column]||'';
 const activeFor=(s,column)=>requests.find(r=>r.name===s.name&&ACTIVE_REQUESTS.includes(r.status)&&Object.keys(r.changes).some(k=>columnFields(column).includes(k)));
 function view(s,column){
  const c=context(s),auto=column==='times'?suggestTimes(c):suggestReason(c),legacy=saved[key(s)],draft=saved[slot(s,column)]||(legacy?.field===column?legacy:null);
  const recommended=column==='times'?auto.value:auto.field===column?auto.text:'';
  const fallback=column==='times'?auto.value:recommended||current(c,column);
  const edited=edits.get(slot(s,column)),value=edited?.value??draft?.value??draft?.text??fallback;
  const stale=!!(edited||draft)&&(edited?.fingerprint??draft.fingerprint)!==fingerprint(c);
  const request=activeFor(s,column)||requests.filter(r=>r.name===s.name&&Object.keys(r.changes).some(k=>columnFields(column).includes(k))).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];
  return {c,column,auto,recommended,value,stale,draft,revision:saved[slot(s,column)]?.revision||0,request};
 }
 function disabledReason(v){
  if(working||loadError)return loadError?'추천사유 조회 실패':'요청 처리 중';
  if(!v.c.record||v.c.record.readState!=='complete'||!v.c.record.id||!v.c.record.version)return '체크히어 상세 저장본을 먼저 수집해 주세요.';
  if(v.request?.status==='verified'&&v.request.approval&&columnFields(v.column).some(k=>(v.c.record[k]||'')!==(v.request.approval.after[k]||'')))return '반영 확인 완료 · 재수집 후 플랫폼에 저장해 주세요.';
  if(v.c.status==='중복')return '중복 출결은 개별 확인 대상입니다.';
  if(v.stale)return '시트·체크히어 근거가 바뀌었습니다. 추천을 다시 생성하거나 직접 확인해 주세요.';
  if(activeFor({name:v.c.name},v.column))return '이 항목은 승인 대기 또는 반영 중입니다.';
  if(v.column==='times'&&v.c.status==='결석')return '결석 시간은 자동으로 만들거나 삭제하지 않습니다.';
  return '';
 }
 function html(s,column){
  const v=view(s,column),active=v.request&&ACTIVE_REQUESTS.includes(v.request.status),disabled=disabledReason(v),ident=esc(slot(s,column));
  let changed=false;try{requestChanges(v.c.record||{},column,v.value);changed=true;}catch{}
  const label=active?PROPOSAL_STATUS[v.request.status]:disabled.startsWith('반영 확인 완료')?'반영 확인 완료':v.stale?'재검토 필요':changed?'변경 필요':'현재 기록과 일치';
  const controls=column==='times'?`<div class="proposal-times">${['entry','exit'].map(k=>`<label>${k==='entry'?'입실':'퇴실'}<input type="time" step="1" data-proposal-edit="${ident}" data-time="${k}" aria-label="${esc(s.name)} 추천 ${k==='entry'?'입실':'퇴실'}시간" value="${esc(v.value[k]||'')}" ${active?'disabled':''}></label>`).join('')}</div>`:`<textarea class="proposal-input" data-proposal-edit="${ident}" maxlength="500" aria-label="${esc(s.name+' '+REQUEST_COLUMNS[column])} 추천사유" placeholder="사유 확인 후 직접 입력" ${active?'disabled':''}>${esc(active?v.request.changes[column]??v.value:v.value)}</textarea>`;
  return `<div class="proposal-box ${changed||v.stale?'changed':''}" data-proposal-box="${ident}"><strong>${column==='times'?'추천시간':'추천사유'}</strong><small class="proposal-label">${esc(label)}</small>${controls}<small>${esc(disabled||(!v.recommended||column==='times'?v.auto.notes?.[0]||'':'시트 출결·사유와 수집 시간을 기준으로 생성'))}</small><div class="proposal-cell-actions"><button class="btn soft" data-proposal-reset="${ident}" ${active?'disabled':''}>추천 다시 생성</button><button class="btn dark" data-proposal-send="${ident}" ${disabled||!changed?'disabled':''}>변경요청</button></div>${v.stale?`<button class="btn soft" data-proposal-accept="${ident}">직접 수정값 유지 · 근거 확인</button>`:''}${active?'<small>요청 접수 · 체크히어 승인 후 반영</small>':'<small>추천값 편집만으로 체크히어가 변경되지 않습니다.</small>'}</div>`;
 }
 async function load(classId,iso,preserve=false){
  const n=++sequence;if(!preserve)edits.clear();saved={};requests=[];loadError='';
  try{const [d,list]=await Promise.all([getDoc(doc(db,'checkhereProposalDrafts',draftId(String(classId),iso))),getDocs(query(collection(db,'checkhereRequests'),where('classId','==',String(classId))))]);if(n!==sequence)return;saved=d.data()?.students||{};requests=list.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.date===iso);}catch(e){if(n===sequence){loadError=e.message;showErr(new Error('체크히어 추천사유 조회 실패: '+e.message));}}
 }
 async function submit(s,v,cache){
  if(hasUnsavedReason())throw Error('시트에 저장하지 않은 사유가 있습니다. 사유 저장 후 요청해 주세요.');
  const block=disabledReason(v);if(block&&block!=='요청 처리 중')throw Error(block);
  const changes=requestChanges(v.c.record,v.column,v.value);
  if(!judge({...v.c.record,source:'live'}).canApply)throw Error('중복·진행중·교시 불일치 등 확인이 필요합니다. 재수집 후 요청해 주세요.');
  await validateSheetSource(db,user,v.c,cache);
  const input=cleanRequest({classId:v.c.classId,date:v.c.date,name:s.name,phoneLast4:v.c.record.phoneLast4||'',changes,reason:`출결대조 ${REQUEST_COLUMNS[v.column]} · ${v.c.status} · ${v.c.reason||'일반 출결'}${v.c.excursion?' · 견학일 확인':''}`.slice(0,1000)});
  const id='proposal_'+crypto.randomUUID(),ref=doc(db,'checkhereProposalDrafts',draftId(v.c.classId,v.c.date)),name=slot(s,v.column);
  await runTransaction(db,async tx=>{
   const snap=await tx.get(ref),students=snap.data()?.students||{},previous=students[name];
   if((previous?.revision||0)!==v.revision)throw Error('다른 직원이 이 항목을 수정했습니다. 다시 읽어 주세요.');
   const ids=[...new Set([key(s),...columns.map(c=>slot(s,c))].map(k=>students[k]?.activeId).filter(Boolean))];
   const live=await Promise.all(ids.map(id=>tx.get(doc(db,'checkhereRequests',id))));
   if(live.some(d=>{const r=d.data();return r&&ACTIVE_REQUESTS.includes(r.status)&&requestsOverlap(r,input);})||requests.some(r=>ACTIVE_REQUESTS.includes(r.status)&&requestsOverlap(r,input)))throw Error('동일 항목의 진행 중인 요청이 있습니다.');
   tx.set(doc(db,'checkhereRequests',id),{...input,status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   tx.set(doc(db,'checkhereProposalSources',contextId(id)),{requestId:id,classId:v.c.classId,date:v.c.date,name:s.name,studentKey:key(s),status:v.c.status,reason:v.c.reason,raw:v.c.raw,record:sourceRecord(v.c.record),changes,column:v.column,sourceScope:'column-v2',updatedBy:user.email,updatedAt:serverTimestamp()});
   tx.set(ref,{classId:v.c.classId,date:v.c.date,students:{[name]:{value:v.value,field:v.column,fingerprint:fingerprint(v.c),revision:v.revision+1,activeId:id}},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true});
  });
  requests.push({id,...input,status:'pending'});edits.delete(name);return id;
 }
 function capture(students){
  for(const s of students)for(const column of columns){const name=slot(s,column),nodes=[...root.querySelectorAll('[data-proposal-edit]')].filter(x=>x.dataset.proposalEdit===name);if(!nodes.length||nodes[0].disabled)continue;const v=view(s,column),value=column==='times'?Object.fromEntries(nodes.map(x=>[x.dataset.time,x.value])):nodes[0].value;if(JSON.stringify(value)!==JSON.stringify(v.value))edits.set(name,{value,fingerprint:edits.get(name)?.fingerprint??v.draft?.fingerprint??fingerprint(v.c)});}
 }
 async function sendMany(students,column){
  if(working)return;capture(students);const results=[],pending=[];
  for(const s of students){const v=view(s,column);try{const why=disabledReason(v);if(why)throw Error(why);requestChanges(v.c.record,column,v.value);pending.push({s,v});}catch(e){results.push(`${s.name}: ${e.message}`);}}
  if(!pending.length){alert('요청 가능한 변경이 없습니다.\n'+results.join('\n'));return;}
  const dialog=document.createElement('dialog');dialog.className='proposal-dialog';root.append(dialog);
  const display=value=>typeof value==='object'?`${value.entry||'공란'} → ${value.exit||'공란'}`:value||'공란';
  dialog.innerHTML=`<h3>${esc(REQUEST_COLUMNS[column])} · 변경요청 ${pending.length}건</h3><p>실제 변경까지는 시간이 걸립니다. 체크히어 탭에서 지정 관리자가 수집 PC로 승인·반영해야 완료됩니다.</p><table><thead><tr><th>학생</th><th>현재 기록</th><th>요청할 값</th></tr></thead><tbody>${pending.map(({s,v})=>`<tr><th>${esc(s.name)}</th><td>${esc(display(current(v.c,column)))}</td><td>${esc(display(v.value))}</td></tr>`).join('')}</tbody></table>${pending.some(x=>x.v.c.excursion)?'<p class="proposal-warning">견학일입니다. 실제 운영 시간과 사유를 확인해 주세요.</p>':''}${results.length?`<details><summary>제외 ${results.length}건</summary><pre>${esc(results.join('\n'))}</pre></details>`:''}<p role="status" id="requestResult"></p><button id="sendSelected" class="btn dark">${pending.length}건 변경요청</button><button id="closeRequests">닫기</button>`;
  const close=()=>{if(working)return;dialog.close();dialog.remove();};dialog.querySelector('#closeRequests').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
  dialog.querySelector('#sendSelected').onclick=async()=>{if(working)return;working=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);let count=0;const failed=[],cache=new Map();try{for(const {s,v}of pending){try{await submit(s,v,cache);count++;}catch(e){failed.push(`${s.name}: ${e.message}`);}dialog.querySelector('#requestResult').textContent=`${count}건 접수 · ${failed.length}건 실패 · ${pending.length}건 중 처리 중`;}const c=pending[0].v.c;await load(c.classId,c.date,true);}finally{working=false;dialog.querySelector('#sendSelected').disabled=true;dialog.querySelector('#closeRequests').disabled=false;dialog.querySelector('#requestResult').textContent=`${count}건 요청 접수 · ${failed.length}건 실패. 실제 변경까지는 시간이 걸립니다. 체크히어 탭에서 승인 후 반영됩니다.${failed.length?'\n'+failed.join('\n'):''}`;render();}};
  dialog.showModal();
 }
 return {html,load,capture,hasEdits:()=>edits.size>0,bind(students){
  const resolve=name=>{for(const s of students)for(const column of columns)if(slot(s,column)===name)return{s,column};};
  root.querySelectorAll('[data-proposal-edit]').forEach(el=>el.oninput=()=>{const {s,column}=resolve(el.dataset.proposalEdit);capture(students);const v=view(s,column),box=el.closest('[data-proposal-box]');let different=false;try{requestChanges(v.c.record||{},column,v.value);different=true;}catch{}box.querySelector('[data-proposal-send]').disabled=!!disabledReason(v)||!different;box.classList.toggle('changed',different);box.querySelector('.proposal-label').textContent=v.stale?'재검토 필요':different?'변경 필요':'현재 기록과 일치';});
  for(const action of ['send','reset','accept'])root.querySelectorAll(`[data-proposal-${action}]`).forEach(el=>el.onclick=()=>{capture(students);const{s,column}=resolve(el.getAttribute(`data-proposal-${action}`));if(action==='send'){sendMany([s],column);return;}const v=view(s,column);if(action==='reset'){if(!confirm('현재 시트·체크히어 데이터로 추천값을 다시 만들까요?'))return;edits.set(slot(s,column),{value:column==='times'?v.auto.value:v.recommended||'',fingerprint:fingerprint(v.c)});}else edits.set(slot(s,column),{value:v.value,fingerprint:fingerprint(v.c)});render();});
  root.querySelectorAll('[data-proposal-bulk]').forEach(b=>b.onclick=()=>sendMany(students,b.dataset.proposalBulk));
 },exportFor(s){return columns.flatMap(column=>{const v=view(s,column);return[column==='times'?`${v.value.entry||''} → ${v.value.exit||''}`:v.value,v.request?PROPOSAL_STATUS[v.request.status]:'미요청'];});}};
}
