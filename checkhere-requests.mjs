import {RETRYABLE_STATUSES,isRetryableRequest,retryHeads} from './checkhere-retry-core.mjs';
import {invalidateRead} from './session-read-cache.mjs';
import {loadCheckHereIdentities} from './checkhere-name-store.mjs';
import {canWithdraw,withdrawRequest} from './checkhere-request-actions.mjs';
import {within} from './attendance-io.mjs';
import {REQUEST_COLUMNS,requestColumn,requestsOverlap} from './checkhere-proposal-core.mjs';
const ACTIVE_STATUSES=['pending','approved','applying'];
import {validateLinkedRequest} from './checkhere-proposals.mjs';
import {collection,doc,getDocs,setDoc,query,where,orderBy,limit,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {APPROVER,FIELDS,STATUS,cleanRequest,matchRequest as matchRequestCore,prepareApproval as prepareApprovalCore,requestMatchesRecord as requestMatchesRecordCore,sameRequestTarget,memoDefaultTimes} from './checkhere/approval-core.mjs';
import {assertChangeAllowed} from './checkhere/rules.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const automaticFields=(r,a)=>['entry','exit'].filter(k=>!Object.hasOwn(r.changes,k)&&!a.before[k]&&a.after[k]);
const approvalFields=(r,a)=>[...new Set([...Object.keys(r.changes),...automaticFields(r,a)])];
const approvalLabel=(r,a,k)=>FIELDS[k]+(automaticFields(r,a).includes(k)?' · 기본시간 자동 입력':'');
function requireMemoDefaults(c,r,a){if(automaticFields(r,a).length&&!c.state().capabilities?.includes('memo-default-time-v1'))throw Error('빈 시간 자동 입력을 사용하려면 수집 PC에서 최신 체크히어 시작.cmd를 다시 실행해 주세요.');}
const dateNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function createRequest(db,user,input){
  const data=cleanRequest(input),id=crypto.randomUUID();
  try{await setDoc(doc(db,'checkhereRequests',id),{...data,status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});}finally{invalidateRead(db,user,'operations:requests');}return id;
}
export async function mountCheckHereRequests(host,{db,user,classes,admin=false,controller=null,openCollector=()=>{},onCount=()=>{}}){
  const root=host.attachShadow({mode:'open'}),$=s=>root.querySelector(s);
  const identity=await user.getIdTokenResult(),approver=admin&&user.email?.toLowerCase()===APPROVER&&identity.claims.firebase?.sign_in_provider==='google.com';
  let rows=[],timer,disposed=false,working=false,reading=false,retryLinks=new Map(),retryResolved=new Set(),retryHistory=[],failuresLoaded=false,requestDigest='';
  const invalidateCounts=()=>invalidateRead(db,user,'operations:requests');
  const checkedExisting=new Set(),identityMaps=new Map();
  const identityFor=r=>identityMaps.get(String(r.classId))||[];
  const matchRequest=(r,records)=>matchRequestCore(r,records,identityFor(r));
  const requestMatchesRecord=(r,record)=>requestMatchesRecordCore(r,record,identityFor(r));
  const prepareApproval=(r,record,options={})=>prepareApprovalCore(r,record,{...options,identities:identityFor(r)});
  const judgeRequest=(r,record,c)=>{const defaults=memoDefaultTimes(r.changes,record),judgement=assertChangeAllowed(record,{...r.changes,...defaults},{capabilities:c.state().capabilities,requested:true});if(Object.keys(defaults).length)judgement.warning='메모 저장에 필요한 빈 시간만 기본 설정으로 자동 입력합니다. 기존 시간은 유지합니다.';return judgement;};
  async function readIdentities(){for(const classId of new Set(rows.filter(r=>ACTIVE_STATUSES.includes(r.status)||isRetryableRequest(r)).map(r=>String(r.classId))))identityMaps.set(classId,await loadCheckHereIdentities(db,classId,rows.filter(r=>String(r.classId)===classId)));}
  const active=()=>host.isConnected&&!host.hidden&&host.style.display!=='none'&&!document.hidden;
  root.innerHTML=`<style>:host{display:block;font-family:inherit;color:#172033;margin:12px 0}*{box-sizing:border-box}button,input,select,textarea{font:inherit}section{background:white;border:1px solid #dbe3ee;border-radius:12px;padding:16px}h3{margin:0 0 8px}p,small{color:#64748b;line-height:1.5}button{padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer;background:#f8fafc}button.primary{background:#1d4ed8;color:white;border-color:#1d4ed8}button:disabled{opacity:.5;cursor:not-allowed}.line{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}label{display:block;font-size:12px;font-weight:700}input:not([type=checkbox]),select,textarea{width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:8px;margin:5px 0}textarea{min-height:75px;resize:vertical}.request{border-top:1px solid #e2e8f0;padding:12px 0}.needs-change{background:#fff8e8;border-left:4px solid #d59a2b;padding-left:12px}.badge{border-radius:8px;padding:4px 8px;background:#eef2ff;font-size:12px}.reason{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:#334155}.error{color:#b91c1c}.success{color:#166534}dialog{border:1px solid #cbd5e1;border-radius:14px;max-width:720px;width:95%;max-height:90vh;overflow:auto}dialog::backdrop{background:#0f172a88}table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}td,th{padding:9px;border:1px solid #e2e8f0;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}.note{background:#f1f5f9;padding:10px;border-radius:8px}summary{cursor:pointer;font-weight:800}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style>
  <section><h3>체크히어 수정 요청${approver?' · 승인':''}</h3><p>요청 등록만으로 체크히어가 변경되지는 않습니다. 지정된 관리자가 수집 PC에서 승인한 뒤 반영 결과를 확인합니다.</p>
  <details id="new"><summary>수정 요청 작성</summary><form id="form"><div class="grid"><label>반<select id="class">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반</option>`).join('')}</select></label><label>교육일자<input id="date" type="date" min="2026-07-27" max="2026-10-22" value="${dateNow()}"></label><label>학생 이름<input id="name" maxlength="60" required autocomplete="off"></label><label>동명이인 구분 · 전화번호 끝 4자리(선택)<input id="last4" inputmode="numeric" maxlength="4" autocomplete="off"></label></div>
  <p>변경할 항목만 체크하세요. 체크하지 않은 항목은 그대로 유지합니다.</p><div class="grid">${Object.entries(FIELDS).map(([k,label])=>`<div><label><input type="checkbox" data-enable="${k}"> ${label} 수정</label>${k.endsWith('Memo')?`<textarea id="${k}" maxlength="500" disabled></textarea>`:`<input id="${k}" type="time" step="1" disabled>`}</div>`).join('')}</div><label>수정 근거<textarea id="reason" maxlength="1000" required placeholder="시트·수기출석 등에서 확인한 내용과 수정 이유를 적어 주세요."></textarea></label><button class="primary" id="submit">수정 요청 등록</button></form></details>
  <div class="line" style="margin-top:16px"><label>반 범위<select id="requestClass"><option value="">전체 반</option>${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반</option>`).join('')}</select></label><label>날짜 범위<input id="requestDate" type="date"></label><label>처리 상태<select id="requestStatus"><option value="all">전체 현황</option><option value="active">승인 대기·처리 중</option><option value="failures">실패·확인 필요</option><option value="history">완료·지난 이력</option></select></label></div><div class="line" id="columnApprovals"></div><div class="line" style="margin-top:16px"><strong>${admin?'요청 처리 현황':'내 요청 처리 현황'}</strong><button id="refresh">새로고침</button>${approver?'<button id="retryFailures">실패 건 다시 처리</button>':''}</div><p id="message" role="status" aria-live="polite"></p><div id="list">불러오는 중…</div></section><dialog id="review"></dialog>`;
  function message(text,error=false){$('#message').textContent=text;$('#message').className=error?'error':'success';}
  const action=fn=>async e=>{const b=e?.currentTarget;if(b)b.disabled=true;try{await fn(e);}catch(err){message(err.code==='permission-denied'?'요청 저장 권한이 없거나 담당반 권한이 변경됐습니다. 관리자에게 문의해 주세요.':err.message,true);}finally{if(b)b.disabled=false;}};
  root.querySelectorAll('[data-enable]').forEach(c=>c.onchange=()=>{$('#'+c.dataset.enable).disabled=!c.checked;});
  $('#form').onsubmit=action(async e=>{e.preventDefault();if(working)return;working=true;try{const changes={};root.querySelectorAll('[data-enable]:checked').forEach(c=>changes[c.dataset.enable]=$('#'+c.dataset.enable).value);await createRequest(db,user,{classId:$('#class').value,date:$('#date').value,name:$('#name').value,phoneLast4:$('#last4').value,reason:$('#reason').value,changes});$('#form').reset();$('#new').open=false;root.querySelectorAll('[data-enable]').forEach(c=>{$('#'+c.dataset.enable).disabled=true;});message('수정 요청을 등록했습니다. 관리자 승인을 기다려 주세요.');}finally{invalidateCounts();working=false;await refresh();}});
  async function refresh(){
    clearTimeout(timer);if(disposed||!host.isConnected||working||reading)return;if(!active()){timer=setTimeout(refresh,60000);return;}reading=true;
    try{
      const ref=collection(db,'checkhereRequests');let docs;
      if(admin){const [active,recent]=await within(Promise.all([getDocs(query(ref,where('status','in',['pending','approved','applying']))),getDocs(query(ref,orderBy('updatedAt','desc'),limit(50)))]));docs=[...new Map([...active.docs,...recent.docs].map(d=>[d.id,d])).values()];}
      else docs=(await within(getDocs(query(ref,where('createdBy','==',user.email),where('classId','==',String(classes[0].id)),limit(200))))).docs;
      if(disposed||!host.isConnected)return;
      rows=[...new Map([...retryHistory,...docs.map(d=>({id:d.id,...d.data()}))].map(r=>[r.id,r])).values()].sort((a,b)=>(['pending','approved','applying'].includes(b.status)?1:0)-(['pending','approved','applying'].includes(a.status)?1:0)||(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));const digest=JSON.stringify(rows.map(r=>[r.id,r.status,r.updatedAt?.seconds,r.updatedAt?.nanoseconds,r.result?.platformSaved]).sort(([a],[b])=>a.localeCompare(b)));if(requestDigest&&requestDigest!==digest)invalidateCounts();requestDigest=digest;const retryState=await retryHeads(rows);retryLinks=retryState.links;retryResolved=new Set(retryState.resolved);if(approver)await readIdentities();render();
    }catch(e){message(e.code==='permission-denied'?'수정 요청 저장 권한을 확인하지 못했습니다. 기존 출결대조 기능은 계속 사용할 수 있습니다.':e.message,true);}
    reading=false;await autoConfirmExisting();if(host.isConnected&&!disposed)timer=setTimeout(refresh,60000);
  }
  function render(){
    onCount(rows.filter(r=>['pending','approved','applying'].includes(r.status)).length);
    const visible=visibleRows();$('#columnApprovals').innerHTML=Object.entries(REQUEST_COLUMNS).map(([column,title])=>{const count=visible.filter(r=>r.status==='pending'&&requestColumn(r)===column).length;return `<div><strong>${esc(title)}</strong>${approver?`<button data-bulk-approve="${column}" ${count?'':'disabled'}>일괄승인·자동입력 (${count})</button>`:`<span class="badge">승인 대기 ${count}건</span>`}</div>`;}).join('');root.querySelectorAll('[data-bulk-approve]').forEach(b=>b.onclick=action(()=>bulkReview(b.dataset.bulkApprove)));
    $('#list').innerHTML=visible.length?visible.map(r=>`<article class="request ${['pending','approved','applying'].includes(r.status)?'needs-change':''}"><div class="line"><strong>${esc(r.classId)}반 · ${esc(r.date)} · ${esc(r.name)}</strong><span class="badge">${esc(r.status==='verified'&&r.result?.alreadyApplied?'이미 반영':STATUS[r.status]||r.status)}</span>${r.id.startsWith('proposal_')?'<span class="badge">출결대조 제안</span>':r.id.startsWith('retry_')?'<span class="badge">다시 처리</span>':''}${retryLinks.has(r.id)?`<span class="badge">${retryResolved.has(r.id)?'재처리 완료':'재처리 이력 있음'}</span>`:''}</div><div class="reason">${Object.entries(r.changes).map(([k,v])=>`${esc(FIELDS[k])}: ${esc(v||'(메모 비우기)')}`).join('<br>')}<br>근거: ${esc(r.reason)}</div>${r.reviewNote?`<p>반려 사유: ${esc(r.reviewNote)}</p>`:''}${r.result?`<p class="${r.status==='verified'?'success':'error'}">${esc(r.result.message)}</p>`:''}${approver?`<div class="line">${r.status==='pending'?`<button data-collect="${r.id}">해당 날짜 수집</button><button data-review="${r.id}" class="primary">요청 승인·반영</button><button data-reject="${r.id}">반려</button>`:r.status==='approved'?`<button data-run="${r.id}" class="primary">승인된 변경 반영</button>`:r.status==='applying'?`<button data-result="${r.id}">반영 결과 확인</button>`:isRetryableRequest(r)&&!retryLinks.has(r.id)?`<button data-retry="${r.id}">실패 건 다시 처리</button>`:''}</div>`:''}${!admin&&canWithdraw(r,user)?`<button data-withdraw="${r.id}">요청취소</button>`:''}${r.status==='withdrawn'?'<p>요청취소됨 · 체크히어에 반영하지 않습니다.</p>':''}</article>`).join(''):'<p>등록된 요청이 없습니다.</p>';
    root.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=action(()=>withdraw(rows.find(r=>r.id===b.dataset.withdraw))));
    for(const [attr,fn] of Object.entries({collect:collect,review:review,reject:reject,run:run,result:reconcile,retry:r=>retryReview([r])}))root.querySelectorAll(`[data-${attr}]`).forEach(b=>b.onclick=action(()=>fn(rows.find(r=>r.id===b.dataset[attr]))));
  }
  async function connected(){if(!approver)throw Error('지정된 관리자만 승인할 수 있습니다.');const c=controller?.();if(!c)throw Error('수집 PC 연결 프로그램을 먼저 연결해 주세요.');await c.refresh();if(!c.state().capabilities?.includes('approval-current-sync-v1')||!c.state().capabilities?.includes('live-approval-preview-v1'))throw Error('수집 PC에서 최신 ‘체크히어 시작.cmd’를 실행해 주세요.');return c;}
  async function collect(r){openCollector();const c=await connected();c.select(r.classId,r.date);await c.api('sync',{classId:r.classId,dates:[r.date]});await c.refresh();message('해당 날짜를 수집 중입니다. 완료 후 변경 전후 확인을 눌러 주세요.');}
  async function withdraw(r){if(working)return;if(!confirm(`${r.name}의 승인 대기 요청을 취소할까요?\n취소한 요청은 체크히어에 반영하지 않습니다.`))return;working=true;try{await withdrawRequest(db,user,r.id,approver);message('요청을 취소했습니다. 체크히어에 반영되지 않습니다.');}finally{invalidateCounts();working=false;await refresh();}}
  async function review(r){
    if(working)return;
    if(rows.some(x=>x.id!==r.id&&requestsOverlap(x,r)&&['pending','approved','applying'].includes(x.status)))throw Error('동일 항목의 진행 중인 요청이 여러 개 있습니다. 중복 요청을 먼저 정리해 주세요.');
    const c=await connected(),record=await previewCurrent(c,r);
    if(requestMatchesRecord(r,record)){working=true;try{await confirmExisting(c,r);}finally{working=false;await refresh();}return;}
    const judgement=judgeRequest(r,record,c);
    const approval=prepareApproval(r,record),modal=$('#review');requireMemoDefaults(c,r,approval);
    modal.innerHTML=`<h3>${esc(r.classId)}반 · ${esc(r.date)} · ${esc(r.name)}</h3>${judgement.warning?`<p class="note" role="note">${esc(judgement.warning)}</p>`:''}<p class="reason">요청 근거: ${esc(r.reason)}</p><table><thead><tr><th>항목</th><th>현재 체크히어 값</th><th>승인할 값</th></tr></thead><tbody>${approvalFields(r,approval).map(k=>`<tr><th>${esc(approvalLabel(r,approval,k))}</th><td>${esc(approval.before[k]||'공란')}</td><td>${esc(approval.after[k]||'공란')}</td></tr>`).join('')}</tbody></table><p class="note">수집본이 없으면 자동으로 수집합니다. 승인한 항목을 체크히어에 입력하고, 실제 저장값과 플랫폼 DB 저장까지 확인합니다.</p><div class="line"><button id="approve" class="primary">승인하고 체크히어에 반영</button><button id="close">닫기</button></div>`;modal.showModal();$('#close').onclick=()=>modal.close();
    $('#approve').onclick=action(async()=>{if(working)return;working=true;try{message('승인된 내용을 체크히어에 자동 입력하고 저장 결과를 확인합니다.');const connection=await approveOne(r,approval);modal.close();await run(r,connection);}finally{invalidateCounts();working=false;await refresh();}});
  }
  async function run(r,connection=null){const c=connection||await connected();try{if(!connection){const record=await previewCurrent(c,r);if(!requestMatchesRecord(r,record))await validateLinkedRequest(db,user,r,record,undefined,identityFor(r));}await c.api('apply',{approvalId:r.id,idToken:await user.getIdToken()});message('체크히어 자동 입력 중 · 저장된 결과까지 확인하고 있습니다.');const result=await waitApplied(c,r);await refresh();message(result.message||'체크히어 반영·플랫폼 DB 저장 완료');}finally{invalidateCounts();}}
  async function reconcile(r){const c=await connected();let result;try{result=await c.api('reconcile',{approvalId:r.id,idToken:await user.getIdToken(true)});}finally{invalidateCounts();}await refresh();message(result.status==='running'?'아직 반영 중입니다.':result.status==='verified'&&result.platformSaved===true?'체크히어 반영·플랫폼 DB 저장 완료':'처리 현황과 체크히어 원본을 확인해 주세요.',!(result.status==='running'||result.status==='verified'&&result.platformSaved===true));}
  async function reject(r){const modal=$('#review');modal.innerHTML=`<h3>수정 요청 반려</h3><p>${esc(r.classId)}반 · ${esc(r.date)} · ${esc(r.name)}</p><label>반려 사유<textarea id="rejectReason" maxlength="1000"></textarea></label><div class="line"><button id="rejectNow">반려 처리</button><button id="close">닫기</button></div>`;modal.showModal();$('#close').onclick=()=>modal.close();$('#rejectNow').onclick=action(async()=>{const note=$('#rejectReason').value.trim();if(!note)throw Error('반려 사유를 입력해 주세요.');await runTransaction(db,async tx=>{const ref=doc(db,'checkhereRequests',r.id),fresh=await tx.get(ref);if(fresh.data()?.status!=='pending')throw Error('이미 처리된 요청입니다.');tx.update(ref,{status:'rejected',reviewNote:note,reviewedBy:user.email,updatedAt:serverTimestamp()});}).finally(invalidateCounts);modal.close();await refresh();message('요청을 반려했습니다. 체크히어는 변경되지 않았습니다.');});}
  const visibleRows=()=>rows.filter(r=>(!$('#requestClass').value||r.classId===$('#requestClass').value)&&(!$('#requestDate').value||r.date===$('#requestDate').value)&&($('#requestStatus').value==='all'||$('#requestStatus').value==='active'&&ACTIVE_STATUSES.includes(r.status)||$('#requestStatus').value==='failures'&&isRetryableRequest(r)&&!retryLinks.has(r.id)||$('#requestStatus').value==='history'&&(!ACTIVE_STATUSES.includes(r.status)&&(!isRetryableRequest(r)||retryLinks.has(r.id)))));
  async function approveOne(r,preview,cache=new Map()){
    const c=await connected(),record=matchRequest(r,c.state().records);
    if(rows.some(x=>x.id!==r.id&&ACTIVE_STATUSES.includes(x.status)&&requestsOverlap(x,r)))throw Error('동일 항목의 중복 요청이 있습니다. 먼저 반려·정리해 주세요.');
    judgeRequest(r,record,c);
    await validateLinkedRequest(db,user,r,record,cache,identityFor(r));
    const approval=prepareApproval(r,record);requireMemoDefaults(c,r,approval);
    await runTransaction(db,async tx=>{const ref=doc(db,'checkhereRequests',r.id),fresh=await tx.get(ref);if(fresh.data()?.status!=='pending'||!sameRequestTarget(fresh.data(),r))throw Error('요청이 이미 처리되었거나 변경됐습니다.');tx.update(ref,{status:'approved',approval,approvedBy:user.email,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});}).finally(invalidateCounts);
    r.status='approved';r.approval=approval;return c;
  }
  async function waitApplied(c,r){
    for(let attempt=0;attempt<72;attempt++){
      await c.refresh();const job=c.state().jobs?.find(j=>j.id===r.id);
      if(job&&job.status!=='running'){invalidateCounts();
        if(job.status!=='verified')throw Error(`${STATUS[job.status]||job.status}: ${job.message||'결과 확인 필요'}`);
        const result=await c.api('reconcile',{approvalId:r.id,idToken:await user.getIdToken()}).finally(invalidateCounts);
        if(result.status!=='verified'||result.platformSaved!==true)throw Error('체크히어는 확인됐지만 플랫폼 DB 저장은 아직 완료되지 않았습니다. 반영 결과 확인을 눌러 주세요.');
        return result;
      }
      await new Promise(resolve=>setTimeout(resolve,2500));
    }
    throw Error('반영 결과 확인 시간이 초과됐습니다. 중복 실행하지 말고 결과 확인을 눌러 주세요.');
  }
  async function bulkReview(column){
    if(working)return;const candidates=visibleRows().filter(r=>r.status==='pending'&&requestColumn(r)===column);
    if(!candidates.length)throw Error('선택한 범위에 승인 대기 요청이 없습니다.');
    const c=await connected(),prepared=[],excluded=[],cache=new Map();
    for(const r of candidates){try{
      if(rows.some(x=>x.id!==r.id&&ACTIVE_STATUSES.includes(x.status)&&requestsOverlap(x,r)))throw Error('동일 항목 중복 요청');
      const record=await previewCurrent(c,r),already=requestMatchesRecord(r,record),judgement=already?{}:judgeRequest(r,record,c);
      const approval=prepareApproval(r,record,{allowAlreadyApplied:true});requireMemoDefaults(c,r,approval);
      prepared.push({r,approval,warning:already?'이미 반영 여부를 원본에서 재확인합니다.':judgement.warning});
    }catch(e){excluded.push(`${r.classId}반 ${r.date} ${r.name}: ${e.message}`);}}
    const modal=$('#review');modal.innerHTML=`<h3>${esc(REQUEST_COLUMNS[column])} · 일괄승인</h3><p>승인 가능 ${prepared.length}건 · 제외 ${excluded.length}건. 아래 요청값을 순서대로 입력하고, 실제 저장값과 플랫폼 DB 반영까지 확인합니다.</p><table><thead><tr><th>반·날짜·학생</th><th>현재 → 요청값</th></tr></thead><tbody>${prepared.map(({r,approval,warning})=>`<tr><th>${esc(r.classId)}반 ${esc(r.date)} ${esc(r.name)}${warning?`<p class="note">${esc(warning)}</p>`:''}</th><td>${approvalFields(r,approval).map(k=>`${esc(approvalLabel(r,approval,k))}: ${esc(approval.before[k]||'공란')} → ${esc(approval.after[k])}`).join('<br>')}</td></tr>`).join('')}</tbody></table>${excluded.length?`<details open><summary>제외 사유</summary><p class="reason">${esc(excluded.join('\n'))}</p></details>`:''}<p id="batchResult" role="status"></p><div class="line"><button id="bulkApproveNow" class="primary" ${prepared.length?'':'disabled'}>${prepared.length}건 승인하고 반영</button><button id="batchClose">닫기</button></div>`;
    modal.showModal();$('#batchClose').onclick=()=>{if(!working)modal.close();};modal.oncancel=e=>{if(working)e.preventDefault();};
    $('#bulkApproveNow').onclick=async()=>{if(working)return;working=true;clearTimeout(timer);$('#bulkApproveNow').disabled=true;$('#batchClose').disabled=true;let count=0;const failures=[],approvalCache=new Map();try{
      for(const {r,approval}of prepared){if(disposed)break;$('#batchResult').textContent=`${count}/${prepared.length}건 완료 · ${r.classId}반 ${r.name} 반영 중`;
        try{if(requestMatchesRecord(r,matchRequest(r,c.state().records))){await confirmExisting(c,r);count++;continue;}const connection=await approveOne(r,approval,approvalCache);await connection.api('apply',{approvalId:r.id,idToken:await user.getIdToken()});await waitApplied(connection,r);count++;}
        catch(e){failures.push(`${r.classId}반 ${r.date} ${r.name}: ${e.message}`);break;}
      }
    }finally{invalidateCounts();working=false;$('#batchClose').disabled=false;$('#batchResult').textContent=`검증 완료 ${count}건 / ${prepared.length}건. ${failures.length?'오류가 발생해 나머지 반영을 중단했습니다.\n'+failures.join('\n'):disposed?'화면 이동으로 나머지 작업을 중단했습니다.':''}`;await refresh();}};
  }

  async function loadFailures(){
    if(working||reading||disposed)return;
    working=true;clearTimeout(timer);message('실패 이력과 이전 재처리 결과를 확인하고 있습니다.');
    try{
      if(admin){
        const ref=collection(db,'checkhereRequests'),[failed,pending]=await within(Promise.all([getDocs(query(ref,where('status','in',RETRYABLE_STATUSES))),getDocs(query(ref,where('status','in',ACTIVE_STATUSES)))]),25000);
        const combined=[...new Map([...rows.filter(r=>!isRetryableRequest(r)&&!ACTIVE_STATUSES.includes(r.status)),...failed.docs.map(d=>({id:d.id,...d.data()})),...pending.docs.map(d=>({id:d.id,...d.data()}))].map(r=>[r.id,r])).values()];
        const {loadRetryHeads}=await import('./checkhere-retry-store.mjs'),result=await loadRetryHeads(db,combined);if(disposed)return;rows=result.rows;retryLinks=result.links;retryResolved=new Set(result.resolved);retryHistory=rows;failuresLoaded=true;
        if(approver)await readIdentities();
      }else failuresLoaded=true;
      render();message('실패·확인 필요 내역입니다. 완료된 재처리는 지난 이력에 보관됩니다.');
    }finally{working=false;if(!disposed)timer=setTimeout(refresh,60000);}
  }
  async function retryReview(candidates){
    if(working)return;if(!approver)throw Error('지정된 관리자만 실패 건을 다시 처리할 수 있습니다.');
    candidates=candidates.filter(isRetryableRequest);
    if(!candidates.length){message('선택한 범위에 다시 처리할 실패 건이 없습니다.');return;}
    const modal=$('#review');
    modal.innerHTML=`<h3>실패 건 다시 처리 · ${candidates.length}건</h3><p>기존 요청과 결과는 보관합니다. 먼저 이전 결과와 실제 체크히어 값을 확인하고, 이미 반영된 항목은 다시 입력하지 않습니다. 남은 항목만 순서대로 반영하고 DB 저장까지 확인합니다.</p><p class="note">변경하는 메모의 시간이 비어 있으면 해당 기본 시간(입실 09:00·퇴실 18:00)을 입력합니다. 기존 시간은 유지합니다.</p><table><thead><tr><th>반·날짜·학생</th><th>다시 처리할 요청</th></tr></thead><tbody>${candidates.map(r=>`<tr><th>${esc(r.classId)}반 · ${esc(r.date)} · ${esc(r.name)}</th><td>${Object.entries(r.changes).map(([k,v])=>`${esc(FIELDS[k])}: ${esc(v||'공란')}`).join('<br>')}</td></tr>`).join('')}</tbody></table><p id="retryResult" role="status"></p><div class="line"><button id="retryNow" class="primary">${candidates.length}건 다시 처리</button><button id="retryClose">닫기</button></div>`;
    modal.showModal();$('#retryClose').onclick=()=>{if(!working)modal.close();};modal.oncancel=e=>{if(working)e.preventDefault();};
    $('#retryNow').onclick=async()=>{
      if(working)return;working=true;clearTimeout(timer);$('#retryNow').disabled=true;$('#retryClose').disabled=true;let completed=0;const errors=[];
      const remember=r=>{const index=rows.findIndex(x=>x.id===r.id);if(index<0)rows.push(r);else rows[index]=r;};
      try{
        const {resolveRetryRequest}=await import('./checkhere-retry-store.mjs'),c=await connected();if(c.state().busy)throw Error('진행 중인 수집·반영 작업이 끝난 뒤 다시 처리해 주세요.');
        for(const source of candidates){
          if(disposed||!host.isConnected)break;
          $('#retryResult').textContent=`${completed}/${candidates.length}건 확인 완료 · ${source.classId}반 ${source.name} 처리 중`;
          try{
            if(rows.some(r=>ACTIVE_STATUSES.includes(r.status)&&requestsOverlap(r,source)))throw Error('같은 항목의 진행 중인 요청이 있습니다. 먼저 반영 결과를 확인해 주세요.');
            const request=await resolveRetryRequest(db,user,source,{onRequest:remember,reconcile:async r=>{
              const result=await c.api('reconcile',{approvalId:r.id,idToken:await user.getIdToken()}).finally(invalidateCounts);await c.refresh();return result;
            }});
            if(request.status==='verified'){
              if(request.result?.platformSaved!==true)throw Error('이전 반영의 DB 저장을 확인하지 못했습니다. 반영 결과 확인이 필요합니다.');
            }else if(request.status==='applying'){
              const result=await c.api('reconcile',{approvalId:request.id,idToken:await user.getIdToken()});
              if(result.status==='running')await waitApplied(c,request);else if(result.status!=='verified'||result.platformSaved!==true)throw Error('기존 재처리가 끝나지 않았습니다. 반영 결과를 먼저 확인해 주세요.');
            }else if(request.status==='approved'){
              await c.api('apply',{approvalId:request.id,idToken:await user.getIdToken()});await waitApplied(c,request);
            }else if(request.status==='pending'){
              const record=await previewCurrent(c,request);
              if(requestMatchesRecord(request,record))await confirmExisting(c,request);
              else {const approval=prepareApproval(request,record);requireMemoDefaults(c,request,approval);const connection=await approveOne(request,approval);await connection.api('apply',{approvalId:request.id,idToken:await user.getIdToken()});await waitApplied(connection,request);}
            }else throw Error('재처리 요청 상태를 확인해 주세요.');
            remember({...request,status:'verified',result:{...request.result,platformSaved:true}});completed++;
          }catch(e){errors.push(`${source.classId}반 ${source.date} ${source.name}: ${e.message}`);break;}
        }
      }catch(e){errors.push(e.message);}
      finally{
        invalidateCounts();working=false;$('#retryClose').disabled=false;
        $('#retryResult').textContent=`검증·DB 저장 완료 ${completed}/${candidates.length}건.${errors.length?' 나머지 처리를 중단했습니다.\n'+errors.join('\n'):disposed?' 화면 이동으로 나머지 처리를 중단했습니다.':''}`;
        if(!disposed)try{await loadFailures();}catch(e){message('처리 후 목록 확인 필요: '+e.message,true);}
      }
    };
  }

  async function previewCurrent(c,r){
    message(`${r.classId}반 ${r.name} · 현재 체크히어 값을 확인하고 있습니다. 수집본이 없으면 자동 수집합니다.`);
    const wasWorking=working;working=true;try{
      const result=await c.api('preview-request',{approvalId:r.id,idToken:await user.getIdToken()});
      if(!result.record)throw Error('현재 체크히어 기록을 확인하지 못했습니다.');
      await c.refresh();return matchRequest(r,[result.record]);
    }finally{working=wasWorking;}
  }
  async function confirmExisting(c,r){
    message(`${r.classId}반 ${r.name} · 이미 반영 여부를 체크히어 원본에서 확인 중입니다.`);
    const result=await c.api('confirm-existing',{approvalId:r.id,idToken:await user.getIdToken()}).finally(invalidateCounts);
    if(result.status==='pending')throw Error(result.message);
    const saved=result.status==='verified'&&result.platformSaved===true?result:await waitApplied(c,r);
    r.status='verified';r.result={...saved,alreadyApplied:true};render();message('이미 반영 · 원본 확인 및 플랫폼 DB 저장 완료');
  }
  async function autoConfirmExisting(){
    const c=controller?.();if(!approver||!active()||working||reading||$('#review').open||!c?.state().connected||c.state().busy||!c.state().capabilities?.includes('approval-current-sync-v1'))return;
    // Only inspect matching collected records; no extra Firestore polling or remote writes.
    const candidates=visibleRows().filter(r=>r.status==='pending').filter(r=>{try{const record=matchRequest(r,c.state().records),key=r.id+':'+record.version;if(checkedExisting.has(key)||!requestMatchesRecord(r,record))return false;return true;}catch{return false;}});
    if(!candidates.length)return;working=true;
    try{for(const r of candidates){if(disposed||!active())break;try{checkedExisting.add(r.id+':'+matchRequest(r,c.state().records).version);await confirmExisting(c,r);}catch(e){message(e.message,true);break;}}}finally{working=false;}
  }

  $('#requestClass').onchange=render;$('#requestDate').onchange=render;
  $('#requestStatus').onchange=action(async()=>{if($('#requestStatus').value==='failures'&&!failuresLoaded)await loadFailures();else render();});
  if($('#retryFailures'))$('#retryFailures').onclick=action(async()=>{if(working)return;$('#requestStatus').value='failures';await loadFailures();await retryReview(visibleRows().filter(isRetryableRequest));});
  $('#refresh').onclick=action(async()=>{checkedExisting.clear();if($('#requestStatus').value==='failures')await loadFailures();else await refresh();});await refresh();
  return {refresh,dispose(){disposed=true;clearTimeout(timer);}};
}
