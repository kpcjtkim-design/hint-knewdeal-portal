import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {portalStatus,isoLabel} from './attendance-beta-core.mjs';
import {cleanRequest} from './checkhere/approval-core.mjs';
import {judge} from './checkhere/rules.mjs';
import {ACTIVE_REQUESTS,PROPOSAL_STATUS,suggestReason,sourceRecord,assertProposalSource,requestChanges} from './checkhere-proposal-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>`${s.rowIndex}_${s.name}`;
const fingerprint=c=>JSON.stringify({status:c.status,reason:c.reason,record:sourceRecord(c.record)});
const draftId=(cid,date)=>`checkhereProposalDrafts_${cid}_${date}`;
const contextId=id=>`checkhereProposalRequest_${id}`;
export async function validateSheetSource(db,user,c){
  const response=await fetch('/api/attendance-reader',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({classId:c.classId,idToken:await user.getIdToken()}),cache:'no-store'});
  const data=await response.json();if(!response.ok||data.ok===false)throw Error('현재 시트를 다시 확인하지 못했습니다. 요청·승인을 중단합니다.');
  const a=data.attendance||[],dates=(a[0]||[]).map((v,i)=>({iso:isoLabel(v),i})).filter(x=>x.i>=4&&x.iso===c.date),students=a.slice(1).filter(row=>String(row[0]||'').trim()===c.name);
  const reasonDates=(data.reasons?.[0]||[]).map((v,i)=>({iso:isoLabel(v),i})).filter(x=>x.i>=4&&x.iso===c.date);
  if(dates.length!==1||students.length!==1||reasonDates.length!==1)throw Error('시트 학생·날짜 연결이 달라졌습니다. 다시 읽고 검토해 주세요.');
  const raw=String(data.reasons?.[1]?.[reasonDates[0].i]||''),rawStatus=String(students[0][dates[0].i]||'').trim();
  const meta=(await getDoc(doc(db,'settings',`attendanceBeta_${c.classId}_${c.date}`))).data()?.students?.[c.studentKey]||{};
  if(raw!==c.raw||portalStatus(rawStatus,meta)!==c.status)throw Error('요청의 기준인 시트 출결·사유가 바뀌었습니다. 출결대조에서 다시 읽고 검토해 주세요.');
}
export async function validateLinkedRequest(db,user,request,record){
  if(!request.id.startsWith('proposal_'))return;
  const context=(await getDoc(doc(db,'checkhereProposalSources',contextId(request.id)))).data();
  if(!context||context.requestId!==request.id)throw Error('자동 제안의 근거 기록을 찾지 못했습니다.');
  if(JSON.stringify(request.changes)!==JSON.stringify(context.changes))throw Error('요청과 보관된 제안이 다릅니다.');
  assertProposalSource(context,record);
  await validateSheetSource(db,user,context);
}
export function createProposalReview({db,user,root,getContext,render,showErr,hasUnsavedReason}){
  let saved={},requests=[],loadError='',cid='',date='',sequence=0;
  const context=s=>({...getContext(s),studentKey:key(s)});
  const activeFor=s=>requests.find(r=>r.name===s.name&&ACTIVE_REQUESTS.includes(r.status));
  function view(s){
    const c=context(s),auto=suggestReason(c),draft=saved[key(s)],stale=!!draft&&draft.fingerprint!==fingerprint(c);
    const request=activeFor(s)||requests.filter(r=>r.name===s.name).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];
    return {c,auto,draft,stale,request,text:draft?.text??auto.text,field:draft?.field??auto.field};
  }
  function html(s,field){
    const v=view(s);if(field!==v.field||(!v.auto.supported&&!v.draft&&!v.request))return '';
    const changed=v.text&&v.text!==v.c.record?.[v.field],active=v.request&&ACTIVE_REQUESTS.includes(v.request.status);
    const label=loadError?'제안 조회 실패':active?PROPOSAL_STATUS[v.request.status]:v.stale?'재검토 필요':changed?'변경 필요':v.text?'현재 기록과 일치':'확인 필요';
    return `<div class="proposal-box ${changed||v.stale?'changed':''}"><strong>${esc(label)}</strong>${v.request&&!active?`<small>최근 요청: ${esc(PROPOSAL_STATUS[v.request.status]||v.request.status)}</small>`:''}<div class="proposal-preview">${esc(v.text||v.auto.notes[0]||'사유 확인 필요')}</div><button type="button" class="btn soft" data-proposal="${esc(key(s))}" ${loadError?'disabled':''}>${active?'요청 내용 보기':'반영할 사유 검토'}</button><small>승인 전 · 체크히어에 미반영</small></div>`;
  }
  async function load(classId,iso){
    const n=++sequence;cid=String(classId);date=iso;saved={};requests=[];loadError='';
    try{const [drafts,list]=await Promise.all([getDoc(doc(db,'checkhereProposalDrafts',draftId(cid,date))),getDocs(query(collection(db,'checkhereRequests'),where('classId','==',cid)))]);if(n!==sequence)return;saved=drafts.data()?.students||{};requests=list.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.date===iso);}catch(e){if(n===sequence){loadError=e.message;showErr(new Error('체크히어 제안 조회 실패: '+e.message));}}
  }
  async function saveDraft(s,v,text,field){
    const ref=doc(db,'checkhereProposalDrafts',draftId(v.c.classId,v.c.date));
    let next;
    await runTransaction(db,async tx=>{const snap=await tx.get(ref),previous=snap.data()?.students?.[key(s)];if((previous?.revision||0)!==(v.draft?.revision||0))throw Error('다른 직원이 제안을 수정했습니다. 다시 읽어 주세요.');next={text,field,fingerprint:fingerprint(v.c),revision:(previous?.revision||0)+1};tx.set(ref,{classId:v.c.classId,date:v.c.date,students:{[key(s)]:next},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true});});
    saved[key(s)]=next;
  }
  async function submit(s,v,text,field){
    if(hasUnsavedReason())throw Error('시트에 저장하지 않은 사유가 있습니다. 사유 저장 후 요청해 주세요.');
    if(loadError||!v.auto.supported||v.auto.blocked||!v.c.record||!judge({...v.c.record,source:'live'}).canApply)throw Error('중복·미수집·교시 불일치 등 확인이 필요합니다. 체크히어를 재수집하고 검토해 주세요.');
    if(!v.c.record.entry||!v.c.record.exit)throw Error('입퇴실이 없는 기록은 시간 확인 후 별도 요청해야 합니다. 사유만으로 시간을 만들지 않습니다.');
    const changes=requestChanges(v.c.record,field,text);
    await validateSheetSource(db,user,v.c);
    const id='proposal_'+crypto.randomUUID(),ref=doc(db,'checkhereProposalDrafts',draftId(v.c.classId,v.c.date));
    const input=cleanRequest({classId:v.c.classId,date:v.c.date,name:s.name,phoneLast4:v.c.record.phoneLast4||'',changes,reason:`출결대조 검토 · ${v.c.status} · ${v.c.reason||'일반 출결'} · 담임:${v.c.record.teacher||'확인 필요'}`.slice(0,1000)});
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),previous=snap.data()?.students?.[key(s)];
      if((previous?.revision||0)!==(v.draft?.revision||0))throw Error('다른 직원이 제안을 수정했습니다. 다시 읽어 주세요.');
      const previousId=previous?.activeId;
      if(previousId){const pending=await tx.get(doc(db,'checkhereRequests',previousId));if(ACTIVE_REQUESTS.includes(pending.data()?.status))throw Error('이미 승인 대기 또는 반영 중인 요청이 있습니다.');}
      if(activeFor(s))throw Error('해당 학생의 진행 중인 요청이 있습니다. 먼저 처리 결과를 확인해 주세요.');
      tx.set(doc(db,'checkhereRequests',id),{...input,status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      tx.set(doc(db,'checkhereProposalSources',contextId(id)),{requestId:id,classId:v.c.classId,date:v.c.date,name:s.name,studentKey:key(s),status:v.c.status,raw:v.c.raw,record:sourceRecord(v.c.record),changes,updatedBy:user.email,updatedAt:serverTimestamp()});
      tx.set(ref,{classId:v.c.classId,date:v.c.date,students:{[key(s)]:{text,field,fingerprint:fingerprint(v.c),revision:(previous?.revision||0)+1,activeId:id}},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true});
    });
    await load(v.c.classId,v.c.date);
  }
  function open(s){
    const v=view(s),active=v.request&&ACTIVE_REQUESTS.includes(v.request.status);
    let accepted=!v.stale,text=v.text,field=v.field;
    const dialog=document.createElement('dialog');dialog.className='proposal-dialog';root.append(dialog);
    dialog.innerHTML=`<h3>${esc(s.name)} · 체크히어 반영할 사유</h3><p>이곳은 실제 체크히어에 보낼 수정 제안입니다. 내부 특이사항과 별도로 관리합니다.</p><div class="proposal-source">${esc(v.c.classId)}반 · ${esc(v.c.date)} · 시트 ${esc(v.c.status)}<br>저장된 사유: ${esc(v.c.reason||'없음')}<br>강의에 등록된 담임: ${esc(v.c.record?.teacher||'확인 필요')}</div>${v.auto.notes.map(n=>`<p>${esc(n)}</p>`).join('')}<label>반영 위치<select id="proposalField" ${active?'disabled':''}><option value="entryMemo" ${field==='entryMemo'?'selected':''}>입실·교시 관리자 사유</option><option value="exitMemo" ${field==='exitMemo'?'selected':''}>퇴실 관리자 사유</option></select></label><label>체크히어 현재 기록<pre id="proposalBefore">${esc(v.c.record?.[field]||'공란')}</pre></label><label>반영할 사유<textarea id="proposalText" maxlength="500" ${active?'disabled':''}>${esc(active?v.request.changes[field]??text:text)}</textarea></label>${v.stale?'<p class="proposal-warning">입력 근거가 바뀌었습니다. 아래에서 재검토 방법을 선택해 주세요.</p><button id="proposalKeep">직접 수정한 문구 유지 · 새 근거 확인</button>':''}<button id="proposalRegenerate" ${active?'disabled':''}>현재 데이터로 다시 생성</button><p id="proposalState" role="status"></p><p>입퇴실 시간과 서류 확인 상태는 이 요청으로 변경되지 않습니다.</p><div class="proposal-actions"><button id="proposalSave" ${active?'disabled':''}>제안만 저장</button><button id="proposalSend" class="btn dark" ${active?'disabled':''}>체크히어 반영 요청</button><button id="proposalClose">닫기</button></div>`;
    const $=id=>dialog.querySelector('#'+id),message=$('proposalState');
    $('proposalField').onchange=()=>{$('proposalBefore').textContent=v.c.record?.[$('proposalField').value]||'공란';};
    $('proposalRegenerate').onclick=()=>{if(!v.auto.text){message.textContent=v.auto.notes.join(' · ');return;}if($('proposalText').value&&$('proposalText').value!==v.auto.text&&!confirm('직접 편집한 제안을 현재 데이터의 자동 제안으로 바꿀까요?'))return;$('proposalText').value=v.auto.text;$('proposalField').value=v.auto.field;$('proposalField').onchange();accepted=true;message.textContent='현재 데이터로 다시 생성했습니다. 저장 또는 요청해 주세요.';};
    if($('proposalKeep'))$('proposalKeep').onclick=()=>{accepted=true;message.textContent='새 근거를 확인했습니다. 기존 문구를 저장 또는 요청할 수 있습니다.';};
    let busy=false;
    const close=()=>{if(busy)return;if(!active&&$('proposalText').value!==text&&!confirm('저장하지 않은 제안을 닫을까요?'))return;dialog.close();dialog.remove();};
    $('proposalClose').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
    const act=send=>async()=>{if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{if(!accepted)throw Error('근거 변경 사항을 먼저 재검토해 주세요.');const next=$('proposalText').value.trim(),target=$('proposalField').value;if(!next)throw Error('반영할 사유를 입력해 주세요.');if(send){await submit(s,v,next,target);text=next;dialog.close();dialog.remove();render();alert('요청이 등록되었습니다. 체크히어는 아직 변경되지 않았습니다. 지정 관리자가 수집 PC에서 승인·반영한 뒤 완료 여부가 표시됩니다.');}else{await saveDraft(s,v,next,target);text=next;dialog.close();dialog.remove();render();}}catch(e){message.textContent=e.message;}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}};
    $('proposalSave').onclick=act(false);$('proposalSend').onclick=act(true);
    if(active)message.textContent=`${PROPOSAL_STATUS[v.request.status]} · 변경하려면 지정 관리자에게 기존 요청 반려를 요청해 주세요.`;
    dialog.showModal();
  }
  return {html,load,bind(students){root.querySelectorAll('[data-proposal]').forEach(b=>b.onclick=()=>open(students.find(s=>key(s)===b.dataset.proposal)));},exportFor(s){const v=view(s);return[v.text,v.request?PROPOSAL_STATUS[v.request.status]:'미요청'];}};
}
