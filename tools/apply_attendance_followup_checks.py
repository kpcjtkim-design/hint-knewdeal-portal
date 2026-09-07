from pathlib import Path

p=Path('attendance-overview.js')
s=p.read_text(encoding='utf-8')

def rep(old,new,label):
    global s
    if old not in s: raise SystemExit(f'{label} anchor missing')
    s=s.replace(old,new,1)

# Compact two-button follow-up bar under each memo textarea.
rep(
'.memo-state{display:block;height:12px;margin-top:2px;text-align:right;font-size:8px;color:#64748b;font-weight:700}',
'''.memo-state{display:block;height:10px;margin-top:1px;text-align:right;font-size:8px;color:#64748b;font-weight:700}.followup-wrap{margin-top:2px;padding-top:3px;border-top:1px dashed #e2e8f0}.followup-buttons{display:grid;grid-template-columns:1fr 1fr;gap:4px}.followup-btn{min-width:0;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#64748b;padding:4px 2px;font-size:7.5px;font-weight:900;line-height:1.1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.followup-btn.notified.on{background:#dbeafe;border-color:#93c5fd;color:#1d4ed8}.followup-btn.done.on{background:#dcfce7;border-color:#86efac;color:#166534}.followup-btn:disabled{opacity:.42;cursor:not-allowed}.general-followup{margin-top:6px}.general-followup .followup-btn{font-size:9px;padding:6px 4px}''',
'followup css')

# Backward-compatible data model.
rep(
"function normalizeMemoBundle(v){if(v&&typeof v==='object'&&!Array.isArray(v))return{checkhere:String(v.checkhere||''),documents:String(v.documents||''),manual:String(v.manual||'')};if(typeof v==='string'&&v)return{checkhere:v,documents:'',manual:''};return{checkhere:'',documents:'',manual:''}}",
"""function emptyFollowup(){return{notifiedAt:'',doneAt:''}}
function normalizeFollowup(v){const x=v&&typeof v==='object'?v:{};return{notifiedAt:String(x.notifiedAt||''),doneAt:String(x.doneAt||'')}}
function normalizeMemoBundle(v){
  const out={checkhere:'',documents:'',manual:'',followup:{checkhere:emptyFollowup(),documents:emptyFollowup(),manual:emptyFollowup()}};
  if(typeof v==='string'&&v){out.checkhere=v;return out}
  if(v&&typeof v==='object'&&!Array.isArray(v)){
    out.checkhere=String(v.checkhere||'');out.documents=String(v.documents||'');out.manual=String(v.manual||'');
    const f=v.followup&&typeof v.followup==='object'?v.followup:{};
    out.followup.checkhere=normalizeFollowup(f.checkhere);out.followup.documents=normalizeFollowup(f.documents);out.followup.manual=normalizeFollowup(f.manual);
  }
  return out
}
function followupHasAny(v){const f=normalizeFollowup(v);return Boolean(f.notifiedAt||f.doneAt)}
function formatFollowupAt(v){
  if(!v)return'';const dt=new Date(v);if(Number.isNaN(dt.getTime()))return'';
  try{const parts=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(dt),m=parts.find(x=>x.type==='month')?.value||'',d=parts.find(x=>x.type==='day')?.value||'',h=parts.find(x=>x.type==='hour')?.value||'',mi=parts.find(x=>x.type==='minute')?.value||'';return`${m}/${d} ${h}:${mi}`}catch{return''}
}
function followupButtonText(kind,v){const t=formatFollowupAt(v);if(!t)return kind==='notifiedAt'?'담임 알림':'이행 확인';return kind==='notifiedAt'?`✓ 알림 (${t})`:`✓ 이행 (${t})`}
function followupExport(v){const t=formatFollowupAt(v);return t?`완료 (${t})`:'미확인'}""",
'normalize memo bundle')

# General manual memo follow-up buttons.
rep(
'<textarea id="manualIssueMemo" placeholder="전반적인 출결 특이사항, 전달사항 등을 입력하세요."></textarea></div></div></article>',
'''<textarea id="manualIssueMemo" placeholder="전반적인 출결 특이사항, 전달사항 등을 입력하세요."></textarea><div class="followup-wrap general-followup"><div class="followup-buttons"><button type="button" id="manualNotifyBtn" class="followup-btn notified">담임 알림</button><button type="button" id="manualDoneBtn" class="followup-btn done">이행 확인</button></div></div></div></div></article>''',
'general followup markup')

rep(
"const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),excelExport=$('#excelExport'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState');",
"const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),excelExport=$('#excelExport'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState'),manualNotifyBtn=$('#manualNotifyBtn'),manualDoneBtn=$('#manualDoneBtn');",
'selector')
rep(
"let dates=[],students=[],reasonCells={},memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();",
"let dates=[],students=[],reasonCells={},memos={},manualIssue='',manualIssueFollowup=emptyFollowup(),attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();",
'vars')

rep(
"async function loadMemos(cid,iso){memos={};manualIssue='';try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'')}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':''}",
"async function loadMemos(cid,iso){memos={};manualIssue='';manualIssueFollowup=emptyFollowup();try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'');manualIssueFollowup=normalizeFollowup(data.manualIssueFollowup)}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':'';renderGeneralFollowup()}",
'load memos')

rep(
"""async function saveStudentMemo(key,category,value,stateEl,cid,iso){
    const bundle=normalizeMemoBundle(memos[key]);bundle[category]=String(value||'');memos={...memos,[key]:bundle};if(!bundle.checkhere.trim()&&!bundle.documents.trim()&&!bundle.manual.trim())delete memos[key];const snapshot=JSON.parse(JSON.stringify(memos));if(stateEl)stateEl.textContent='저장 중';
    try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso&&stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}
  }""",
"""async function saveStudentMemo(key,category,value,stateEl,cid,iso){
    const bundle=normalizeMemoBundle(memos[key]);bundle[category]=String(value||'');memos={...memos,[key]:bundle};const hasFollowup=Object.values(bundle.followup||{}).some(f=>followupHasAny(f));if(!bundle.checkhere.trim()&&!bundle.documents.trim()&&!bundle.manual.trim()&&!hasFollowup)delete memos[key];const snapshot=JSON.parse(JSON.stringify(memos));if(stateEl)stateEl.textContent='저장 중';
    try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso&&stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}
  }""",
'save student memo')

anchor="async function saveManualIssue(value,stateEl,cid,iso){const next=String(value||'');if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,manualIssue:next,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso){manualIssue=next;if(stateEl)stateEl.textContent='저장됨'}}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}"
if anchor not in s: raise SystemExit('manual issue save anchor missing')
s=s.replace(anchor,anchor+"""
  function followupControls(key,category,f){
    const x=normalizeFollowup(f),notified=Boolean(x.notifiedAt),done=Boolean(x.doneAt);
    return`<div class="followup-wrap"><div class="followup-buttons"><button type="button" class="followup-btn notified ${notified?'on':''}" data-followup-key="${esc(key)}" data-followup-category="${esc(category)}" data-followup-field="notifiedAt">${esc(followupButtonText('notifiedAt',x.notifiedAt))}</button><button type="button" class="followup-btn done ${done?'on':''}" data-followup-key="${esc(key)}" data-followup-category="${esc(category)}" data-followup-field="doneAt" ${!notified&&!done?'disabled':''}>${esc(followupButtonText('doneAt',x.doneAt))}</button></div></div>`
  }
  function renderGeneralFollowup(){
    const x=normalizeFollowup(manualIssueFollowup),notified=Boolean(x.notifiedAt),done=Boolean(x.doneAt);
    manualNotifyBtn.classList.toggle('on',notified);manualDoneBtn.classList.toggle('on',done);manualDoneBtn.disabled=!notified&&!done;
    manualNotifyBtn.textContent=followupButtonText('notifiedAt',x.notifiedAt);manualDoneBtn.textContent=followupButtonText('doneAt',x.doneAt);
  }
  function syncVisibleMemos(){root.querySelectorAll('.memo').forEach(el=>{const key=el.dataset.key,category=el.dataset.category;if(!key||!category)return;const b=normalizeMemoBundle(memos[key]);b[category]=String(el.value||'');memos={...memos,[key]:b}})}
  async function saveStudentFollowup(key,category,field){
    syncVisibleMemos();const bundle=normalizeMemoBundle(memos[key]),f=normalizeFollowup(bundle.followup?.[category]),turningOff=Boolean(f[field]);
    if(turningOff){const msg=field==='notifiedAt'&&f.doneAt?'담임 알림 체크를 해제하면 이행 확인도 함께 해제됩니다. 계속할까요?':'이 체크를 해제할까요? 기록된 마지막 체크시각도 삭제됩니다.';if(!confirm(msg))return false;f[field]='';if(field==='notifiedAt')f.doneAt=''}
    else{if(field==='doneAt'&&!f.notifiedAt){alert('먼저 「담임 알림」을 체크해 주세요.');return false}f[field]=new Date().toISOString()}
    bundle.followup={...(bundle.followup||{}),[category]:f};memos={...memos,[key]:bundle};const snapshot=JSON.parse(JSON.stringify(memos));
    await setDoc(doc(db,'settings',memoId(currentClass,currentIso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:currentClass,date:currentIso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});return true
  }
  async function toggleGeneralFollowup(field){
    const f=normalizeFollowup(manualIssueFollowup),turningOff=Boolean(f[field]);
    if(turningOff){const msg=field==='notifiedAt'&&f.doneAt?'담임 알림 체크를 해제하면 이행 확인도 함께 해제됩니다. 계속할까요?':'이 체크를 해제할까요? 기록된 마지막 체크시각도 삭제됩니다.';if(!confirm(msg))return;f[field]='';if(field==='notifiedAt')f.doneAt=''}
    else{if(field==='doneAt'&&!f.notifiedAt){alert('먼저 「담임 알림」을 체크해 주세요.');return}f[field]=new Date().toISOString()}
    manualIssueFollowup=f;renderGeneralFollowup();await setDoc(doc(db,'settings',memoId(currentClass,currentIso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:currentClass,date:currentIso,manualIssueFollowup:f,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true})
  }
""",1)

old_render="""rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="cell"><div class="name">${esc(s.name)}</div></div><div class="cell center"><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="cell reason ${reason?'':'none'}">${esc(reason||'-')}</div><div class="cell center"><span class="evidence ${e.cls}">${esc(e.label)}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="체크히어 관련 메모">${esc(bundle.checkhere)}</textarea><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="서류제출 관련 메모">${esc(bundle.documents)}</textarea><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder="수기출석 관련 메모">${esc(bundle.manual)}</textarea><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span></div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';"""
new_render="""rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="cell"><div class="name">${esc(s.name)}</div></div><div class="cell center"><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="cell reason ${reason?'':'none'}">${esc(reason||'-')}</div><div class="cell center"><span class="evidence ${e.cls}">${esc(e.label)}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="체크히어 관련 메모">${esc(bundle.checkhere)}</textarea><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span>${followupControls(key,'checkhere',bundle.followup?.checkhere)}</div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="서류제출 관련 메모">${esc(bundle.documents)}</textarea><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span>${followupControls(key,'documents',bundle.followup?.documents)}</div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder="수기출석 관련 메모">${esc(bundle.manual)}</textarea><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span>${followupControls(key,'manual',bundle.followup?.manual)}</div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';"""
rep(old_render,new_render,'render rows')

old_bind="root.querySelectorAll('.memo').forEach(ta=>{ta.oninput=()=>{const key=ta.dataset.key,category=ta.dataset.category,stateKey=ta.dataset.stateKey,state=root.querySelector(`[data-state=\"${CSS.escape(stateKey)}\"]`),cid=currentClass,iso=currentIso,timerKey=`${cid}_${iso}_${key}_${category}`;if(state)state.textContent='입력 중';clearTimeout(saveTimers.get(timerKey));saveTimers.set(timerKey,setTimeout(()=>saveStudentMemo(key,category,ta.value,state,cid,iso).catch(e=>showErr(e)),650))}})"
rep(old_bind,old_bind+";root.querySelectorAll('.followup-btn[data-followup-key]').forEach(b=>{b.onclick=async()=>{if(b.disabled)return;const key=b.dataset.followupKey,category=b.dataset.followupCategory,field=b.dataset.followupField;b.disabled=true;try{const changed=await saveStudentFollowup(key,category,field);if(changed)renderRows(dateSel.value)}catch(e){showErr(e)}}})",'memo bindings')

# XLSX: add overall and per-cell follow-up checkpoints.
rep(
"""        ['수기출석 관리자메모'],
        [String(manualIssueMemo.value||'')],
        [],
        ['이름','출석현황','사유','서류제출','체크히어 관련 메모','서류제출 관련 메모','수기출석 관련 메모']""",
"""        ['수기출석 관리자메모'],
        [String(manualIssueMemo.value||'')],
        ['수기출석 메모 - 담임 알림',followupExport(manualIssueFollowup.notifiedAt)],
        ['수기출석 메모 - 이행 확인',followupExport(manualIssueFollowup.doneAt)],
        [],
        ['이름','출석현황','사유','서류제출','체크히어 관련 메모','체크히어-담임 알림','체크히어-이행 확인','서류제출 관련 메모','서류제출-담임 알림','서류제출-이행 확인','수기출석 관련 메모','수기출석-담임 알림','수기출석-이행 확인']""",
'xlsx summary/header')
rep(
"aoa.push([st.name,status,reason||'-',e.label,memoValueNow(key,'checkhere'),memoValueNow(key,'documents'),memoValueNow(key,'manual')]);",
"const bundle=normalizeMemoBundle(memos[key]);aoa.push([st.name,status,reason||'-',e.label,memoValueNow(key,'checkhere'),followupExport(bundle.followup.checkhere.notifiedAt),followupExport(bundle.followup.checkhere.doneAt),memoValueNow(key,'documents'),followupExport(bundle.followup.documents.notifiedAt),followupExport(bundle.followup.documents.doneAt),memoValueNow(key,'manual'),followupExport(bundle.followup.manual.notifiedAt),followupExport(bundle.followup.manual.doneAt)]);",
'xlsx student row')
rep("ws['!cols']=[{wch:16},{wch:14},{wch:28},{wch:15},{wch:34},{wch:34},{wch:34}];","ws['!cols']=[{wch:16},{wch:14},{wch:28},{wch:15},{wch:30},{wch:19},{wch:19},{wch:30},{wch:19},{wch:19},{wch:30},{wch:19},{wch:19}];",'xlsx cols')
for old,new in [
("{s:{r:0,c:0},e:{r:0,c:6}}","{s:{r:0,c:0},e:{r:0,c:12}}"),
("{s:{r:4,c:0},e:{r:4,c:6}}","{s:{r:4,c:0},e:{r:4,c:12}}"),
("{s:{r:5,c:0},e:{r:5,c:6}}","{s:{r:5,c:0},e:{r:5,c:12}}"),
("{s:{r:7,c:0},e:{r:7,c:6}}","{s:{r:7,c:0},e:{r:7,c:12}}"),
("{s:{r:8,c:0},e:{r:8,c:6}}","{s:{r:8,c:0},e:{r:8,c:12}}")]: rep(old,new,'xlsx merge')

anchor2="manualIssueMemo.oninput=()=>{manualIssueState.textContent='입력 중';const cid=currentClass,iso=currentIso,value=manualIssueMemo.value,key=`manualIssue_${cid}_${iso}`;clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveManualIssue(value,manualIssueState,cid,iso).catch(e=>showErr(e)),650))};"
rep(anchor2,anchor2+"\n  manualNotifyBtn.onclick=()=>toggleGeneralFollowup('notifiedAt').catch(e=>showErr(e));\n  manualDoneBtn.onclick=()=>toggleGeneralFollowup('doneAt').catch(e=>showErr(e));",'general button bindings')

p.write_text(s,encoding='utf-8')

ip=Path('index.html')
i=ip.read_text(encoding='utf-8')
if 'attendance-overview.js?v=20260906-11' not in i: raise SystemExit('module version anchor missing')
i=i.replace('attendance-overview.js?v=20260906-11','attendance-overview.js?v=20260907-12',1)
ip.write_text(i,encoding='utf-8')
