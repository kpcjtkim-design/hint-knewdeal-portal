from pathlib import Path

p=Path('attendance-overview.js')
s=p.read_text(encoding='utf-8')

old_css='.memo-state{display:block;height:12px;margin-top:2px;text-align:right;font-size:8px;color:#64748b;font-weight:700}'
new_css='''.memo-state{display:block;height:11px;margin-top:1px;text-align:right;font-size:8px;color:#64748b;font-weight:700}.followup-wrap{margin-top:3px;padding-top:4px;border-top:1px dashed #e2e8f0}.followup-buttons{display:grid;grid-template-columns:1fr 1fr;gap:4px}.followup-btn{min-width:0;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#64748b;padding:4px 3px;font-size:8px;font-weight:900;line-height:1.15;cursor:pointer;white-space:nowrap}.followup-btn.notified.on{background:#dbeafe;border-color:#93c5fd;color:#1d4ed8}.followup-btn.done.on{background:#dcfce7;border-color:#86efac;color:#166534}.followup-btn:disabled{opacity:.42;cursor:not-allowed}.followup-times{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:2px;min-height:10px}.followup-times span{font-size:7px;line-height:1.2;color:#64748b;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.general-followup{margin-top:7px}.general-followup .followup-btn{font-size:9px;padding:6px 4px}.general-followup .followup-times span{font-size:8px}'''
if old_css not in s: raise SystemExit('memo-state CSS anchor missing')
s=s.replace(old_css,new_css,1)

old_norm="function normalizeMemoBundle(v){if(v&&typeof v==='object'&&!Array.isArray(v))return{checkhere:String(v.checkhere||''),documents:String(v.documents||''),manual:String(v.manual||'')};if(typeof v==='string'&&v)return{checkhere:v,documents:'',manual:''};return{checkhere:'',documents:'',manual:''}}"
new_norm="""function emptyFollowup(){return{notifiedAt:'',doneAt:''}}
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
function followupLabel(v){const t=formatFollowupAt(v);return t?`(${t})`:''}
function followupExport(v){const t=formatFollowupAt(v);return t?`완료 (${t})`:'미확인'}"""
if old_norm not in s: raise SystemExit('normalizeMemoBundle anchor missing')
s=s.replace(old_norm,new_norm,1)

old_general='<textarea id="manualIssueMemo" placeholder="전반적인 출결 특이사항, 전달사항 등을 입력하세요."></textarea></div></div></article>'
new_general='''<textarea id="manualIssueMemo" placeholder="전반적인 출결 특이사항, 전달사항 등을 입력하세요."></textarea><div class="followup-wrap general-followup"><div class="followup-buttons"><button type="button" id="manualNotifyBtn" class="followup-btn notified">담임 알림</button><button type="button" id="manualDoneBtn" class="followup-btn done">이행 확인</button></div><div class="followup-times"><span id="manualNotifyTime"></span><span id="manualDoneTime"></span></div></div></div></div></article>'''
if old_general not in s: raise SystemExit('general memo textarea anchor missing')
s=s.replace(old_general,new_general,1)

old_sel="const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState'),excelExport=$('#excelExport');"
new_sel="const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState'),excelExport=$('#excelExport'),manualNotifyBtn=$('#manualNotifyBtn'),manualDoneBtn=$('#manualDoneBtn'),manualNotifyTime=$('#manualNotifyTime'),manualDoneTime=$('#manualDoneTime');"
if old_sel not in s: raise SystemExit('selector anchor missing')
s=s.replace(old_sel,new_sel,1)
old_vars="let dates=[],students=[],reasonCells={},memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();"
new_vars="let dates=[],students=[],reasonCells={},memos={},manualIssue='',manualIssueFollowup=emptyFollowup(),attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();"
if old_vars not in s: raise SystemExit('vars anchor missing')
s=s.replace(old_vars,new_vars,1)

old_load="async function loadMemos(cid,iso){memos={};manualIssue='';try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'')}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':''}"
new_load="async function loadMemos(cid,iso){memos={};manualIssue='';manualIssueFollowup=emptyFollowup();try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'');manualIssueFollowup=normalizeFollowup(data.manualIssueFollowup)}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':'';renderGeneralFollowup()}"
if old_load not in s: raise SystemExit('loadMemos anchor missing')
s=s.replace(old_load,new_load,1)

old_save="""async function saveStudentMemo(key,category,value,stateEl,cid,iso){
    const bundle=normalizeMemoBundle(memos[key]);bundle[category]=String(value||'');memos={...memos,[key]:bundle};if(!bundle.checkhere.trim()&&!bundle.documents.trim()&&!bundle.manual.trim())delete memos[key];const snapshot=JSON.parse(JSON.stringify(memos));if(stateEl)stateEl.textContent='저장 중';
    try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso&&stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}
  }"""
new_save="""async function saveStudentMemo(key,category,value,stateEl,cid,iso){
    const bundle=normalizeMemoBundle(memos[key]);bundle[category]=String(value||'');memos={...memos,[key]:bundle};const hasFollowup=Object.values(bundle.followup||{}).some(f=>followupHasAny(f));if(!bundle.checkhere.trim()&&!bundle.documents.trim()&&!bundle.manual.trim()&&!hasFollowup)delete memos[key];const snapshot=JSON.parse(JSON.stringify(memos));if(stateEl)stateEl.textContent='저장 중';
    try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso&&stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}
  }"""
if old_save not in s: raise SystemExit('saveStudentMemo anchor missing')
s=s.replace(old_save,new_save,1)

anchor="async function saveManualIssue(value,stateEl,cid,iso){const next=String(value||'');if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,manualIssue:next,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso){manualIssue=next;if(stateEl)stateEl.textContent='저장됨'}}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}"
insert="""
  function followupControls(key,category,f){
    const x=normalizeFollowup(f),notified=Boolean(x.notifiedAt),done=Boolean(x.doneAt);
    return`<div class="followup-wrap"><div class="followup-buttons"><button type="button" class="followup-btn notified ${notified?'on':''}" data-followup-key="${esc(key)}" data-followup-category="${esc(category)}" data-followup-field="notifiedAt">${notified?'✓ 담임 알림':'담임 알림'}</button><button type="button" class="followup-btn done ${done?'on':''}" data-followup-key="${esc(key)}" data-followup-category="${esc(category)}" data-followup-field="doneAt" ${!notified&&!done?'disabled':''}>${done?'✓ 이행 확인':'이행 확인'}</button></div><div class="followup-times"><span>${esc(followupLabel(x.notifiedAt))}</span><span>${esc(followupLabel(x.doneAt))}</span></div></div>`
  }
  function renderGeneralFollowup(){
    const x=normalizeFollowup(manualIssueFollowup),notified=Boolean(x.notifiedAt),done=Boolean(x.doneAt);
    manualNotifyBtn.classList.toggle('on',notified);manualDoneBtn.classList.toggle('on',done);manualDoneBtn.disabled=!notified&&!done;
    manualNotifyBtn.textContent=notified?'✓ 담임 알림':'담임 알림';manualDoneBtn.textContent=done?'✓ 이행 확인':'이행 확인';
    manualNotifyTime.textContent=followupLabel(x.notifiedAt);manualDoneTime.textContent=followupLabel(x.doneAt);
  }
  async function saveStudentFollowup(key,category,field){
    const bundle=normalizeMemoBundle(memos[key]),f=normalizeFollowup(bundle.followup?.[category]),turningOff=Boolean(f[field]);
    if(turningOff){
      const msg=field==='notifiedAt'&&f.doneAt?'담임 알림 체크를 해제하면 이행 확인도 함께 해제됩니다. 계속할까요?':'이 체크를 해제할까요? 기록된 마지막 체크시각도 삭제됩니다.';
      if(!confirm(msg))return false;
      f[field]='';if(field==='notifiedAt')f.doneAt='';
    }else{
      if(field==='doneAt'&&!f.notifiedAt){alert('먼저 「담임 알림」을 체크해 주세요.');return false}
      f[field]=new Date().toISOString();
    }
    bundle[category]=memoValueNow(key,category);bundle.followup={...(bundle.followup||{}),[category]:f};memos={...memos,[key]:bundle};
    await setDoc(doc(db,'settings',memoId(currentClass,currentIso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:currentClass,date:currentIso,memos:{[key]:bundle},updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});
    return true
  }
  async function toggleGeneralFollowup(field){
    const f=normalizeFollowup(manualIssueFollowup),turningOff=Boolean(f[field]);
    if(turningOff){
      const msg=field==='notifiedAt'&&f.doneAt?'담임 알림 체크를 해제하면 이행 확인도 함께 해제됩니다. 계속할까요?':'이 체크를 해제할까요? 기록된 마지막 체크시각도 삭제됩니다.';
      if(!confirm(msg))return;
      f[field]='';if(field==='notifiedAt')f.doneAt='';
    }else{
      if(field==='doneAt'&&!f.notifiedAt){alert('먼저 「담임 알림」을 체크해 주세요.');return}
      f[field]=new Date().toISOString();
    }
    manualIssueFollowup=f;renderGeneralFollowup();
    await setDoc(doc(db,'settings',memoId(currentClass,currentIso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:currentClass,date:currentIso,manualIssueFollowup:f,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true})
  }
"""
if anchor not in s: raise SystemExit('saveManualIssue anchor missing')
s=s.replace(anchor,anchor+insert,1)

old_render="""rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="cell"><div class="name">${esc(s.name)}</div></div><div class="cell center"><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="cell reason ${reason?'':'none'}">${esc(reason||'-')}</div><div class="cell center"><span class="evidence ${e.cls}">${esc(e.label)}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="체크히어 관련 메모">${esc(bundle.checkhere)}</textarea><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="서류제출 관련 메모">${esc(bundle.documents)}</textarea><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder="수기출석 관련 메모">${esc(bundle.manual)}</textarea><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span></div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';"""
new_render="""rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="cell"><div class="name">${esc(s.name)}</div></div><div class="cell center"><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="cell reason ${reason?'':'none'}">${esc(reason||'-')}</div><div class="cell center"><span class="evidence ${e.cls}">${esc(e.label)}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="체크히어 관련 메모">${esc(bundle.checkhere)}</textarea><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span>${followupControls(key,'checkhere',bundle.followup?.checkhere)}</div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="서류제출 관련 메모">${esc(bundle.documents)}</textarea><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span>${followupControls(key,'documents',bundle.followup?.documents)}</div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder="수기출석 관련 메모">${esc(bundle.manual)}</textarea><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span>${followupControls(key,'manual',bundle.followup?.manual)}</div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';"""
if old_render not in s: raise SystemExit('renderRows anchor missing')
s=s.replace(old_render,new_render,1)

old_bind="root.querySelectorAll('.memo').forEach(ta=>{ta.oninput=()=>{const key=ta.dataset.key,category=ta.dataset.category,stateKey=ta.dataset.stateKey,state=root.querySelector(`[data-state=\"${CSS.escape(stateKey)}\"]`),cid=currentClass,iso=currentIso,timerKey=`${cid}_${iso}_${key}_${category}`;if(state)state.textContent='입력 중';clearTimeout(saveTimers.get(timerKey));saveTimers.set(timerKey,setTimeout(()=>saveStudentMemo(key,category,ta.value,state,cid,iso).catch(e=>showErr(e)),650))}})"
new_bind=old_bind+";root.querySelectorAll('.followup-btn[data-followup-key]').forEach(b=>{b.onclick=async()=>{if(b.disabled)return;const key=b.dataset.followupKey,category=b.dataset.followupCategory,field=b.dataset.followupField;b.disabled=true;try{const changed=await saveStudentFollowup(key,category,field);if(changed)renderRows(dateSel.value)}catch(e){showErr(e)}}})"
if old_bind not in s: raise SystemExit('memo binding anchor missing')
s=s.replace(old_bind,new_bind,1)

if "['수기출석 관리자메모',String(manualIssueMemo.value||manualIssue||'')]," not in s: raise SystemExit('xlsx general memo anchor missing')
s=s.replace("['수기출석 관리자메모',String(manualIssueMemo.value||manualIssue||'')],", "['수기출석 관리자메모',String(manualIssueMemo.value||manualIssue||'')],\n        ['수기출석 메모 - 담임 알림',followupExport(manualIssueFollowup.notifiedAt)],\n        ['수기출석 메모 - 이행 확인',followupExport(manualIssueFollowup.doneAt)],",1)
old_header="['이름','출석현황','사유','서류제출','체크히어 관련 메모','서류제출 관련 메모','수기출석 관련 메모']"
new_header="['이름','출석현황','사유','서류제출','체크히어 관련 메모','체크히어-담임 알림','체크히어-이행 확인','서류제출 관련 메모','서류제출-담임 알림','서류제출-이행 확인','수기출석 관련 메모','수기출석-담임 알림','수기출석-이행 확인']"
if old_header not in s: raise SystemExit('xlsx header anchor missing')
s=s.replace(old_header,new_header,1)
old_push="aoa.push([st.name,status,reason||'-',e.label,memoValueNow(key,'checkhere'),memoValueNow(key,'documents'),memoValueNow(key,'manual')]);"
new_push="const bundle=normalizeMemoBundle(memos[key]);aoa.push([st.name,status,reason||'-',e.label,memoValueNow(key,'checkhere'),followupExport(bundle.followup.checkhere.notifiedAt),followupExport(bundle.followup.checkhere.doneAt),memoValueNow(key,'documents'),followupExport(bundle.followup.documents.notifiedAt),followupExport(bundle.followup.documents.doneAt),memoValueNow(key,'manual'),followupExport(bundle.followup.manual.notifiedAt),followupExport(bundle.followup.manual.doneAt)]);"
if old_push not in s: raise SystemExit('xlsx push anchor missing')
s=s.replace(old_push,new_push,1)
old_cols="ws['!cols']=[{wch:16},{wch:14},{wch:28},{wch:15},{wch:34},{wch:34},{wch:34}];"
new_cols="ws['!cols']=[{wch:16},{wch:14},{wch:28},{wch:15},{wch:30},{wch:19},{wch:19},{wch:30},{wch:19},{wch:19},{wch:30},{wch:19},{wch:19}];"
if old_cols not in s: raise SystemExit('xlsx cols anchor missing')
s=s.replace(old_cols,new_cols,1)
s=s.replace("{s:{r:0,c:0},e:{r:0,c:6}}","{s:{r:0,c:0},e:{r:0,c:12}}",1)
s=s.replace("{s:{r:5,c:0},e:{r:5,c:6}}","{s:{r:5,c:0},e:{r:5,c:12}}",1)
if "ws['!rows'][8]={hpt:72};" in s:s=s.replace("ws['!rows'][8]={hpt:72};","ws['!rows'][10]={hpt:72};",1)

anchor2="manualIssueMemo.oninput=()=>{manualIssueState.textContent='입력 중';const cid=currentClass,iso=currentIso,value=manualIssueMemo.value,key=`manualIssue_${cid}_${iso}`;clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveManualIssue(value,manualIssueState,cid,iso).catch(e=>showErr(e)),650))};"
replace2=anchor2+"\n  manualNotifyBtn.onclick=()=>toggleGeneralFollowup('notifiedAt').catch(e=>showErr(e));\n  manualDoneBtn.onclick=()=>toggleGeneralFollowup('doneAt').catch(e=>showErr(e));"
if anchor2 not in s: raise SystemExit('general binding anchor missing')
s=s.replace(anchor2,replace2,1)

p.write_text(s,encoding='utf-8')

ip=Path('index.html')
i=ip.read_text(encoding='utf-8')
if 'attendance-overview.js?v=20260906-11' not in i: raise SystemExit('module version anchor missing')
i=i.replace('attendance-overview.js?v=20260906-11','attendance-overview.js?v=20260907-12',1)
ip.write_text(i,encoding='utf-8')
