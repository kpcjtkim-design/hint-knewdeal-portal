import re
from pathlib import Path

# attendance-overview.js
p=Path('attendance-overview.js')
s=p.read_text(encoding='utf-8')

new_style=r'''const STYLE=`
:host{font-family:Pretendard,"Noto Sans KR","Malgun Gothic",system-ui,sans-serif;color:#0f172a}*{box-sizing:border-box}button,select,textarea,input{font:inherit}.wrap{width:100%;max-width:1760px;margin:0 auto}.card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;box-shadow:0 4px 16px rgba(15,23,42,.035)}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:14px 16px;margin-bottom:10px}.field{display:flex;flex-direction:column;gap:5px}.field label{font-size:11px;color:#64748b;font-weight:900}.field select,.field input{border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:9px 11px;min-width:220px}.btn{border:0;border-radius:10px;padding:9px 12px;font-weight:900;cursor:pointer}.btn.soft{background:#eef2ff;color:#3730a3}.btn.dark{background:#0f172a;color:#fff}.btn.ghost{background:#f1f5f9;color:#334155}.btn.folder{width:100%;border:1px solid #c7d2fe;background:#fff;color:#1d4ed8;padding:10px 11px}.btn.folder:hover:not(:disabled){background:#eff6ff}.btn:disabled{opacity:.5;cursor:not-allowed}.spacer{flex:1}.state{font-size:11px;color:#64748b}.autosave-notice{font-size:12px;font-weight:900;color:#dc2626;align-self:center;padding:7px 4px;white-space:nowrap}.hint{font-size:11px;color:#64748b;padding:0 2px 9px}.workspace{display:grid;grid-template-columns:clamp(310px,21vw,370px) minmax(0,1fr);gap:10px;align-items:start}.left-stack{display:grid;gap:10px;min-width:0}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.section-head h3{margin:0;font-size:14px}.section-head p{margin:3px 0 0;font-size:10px;line-height:1.4;color:#64748b}.raw-card,.manual-card{overflow:hidden}.raw-text{margin:0;padding:13px 14px;min-height:330px;max-height:410px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;line-height:1.58;background:#fff;color:#1e293b}.raw-empty{color:#94a3b8}.manual-body{padding:12px 13px}.manual-issue-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;font-size:11px}.manual-issue-head strong{font-size:13px}.manual-issue textarea{width:100%;min-height:122px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:11px;line-height:1.5;background:#fff}.manual-issue-state{font-size:9px;color:#64748b;white-space:nowrap}.folder-area{margin-top:11px;padding-top:11px;border-top:1px solid #e2e8f0}.folder-title{display:flex;align-items:center;gap:7px;margin-bottom:8px;font-size:12px;font-weight:900}.folder-note{margin-left:auto;font-size:9px;color:#94a3b8;font-weight:700}.folder-buttons{display:grid;gap:7px}.data-panel{overflow:hidden;min-width:0}.data-title{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.data-title strong{font-size:13px}.data-title span{font-size:10px;color:#64748b}.table-scroll{overflow:auto}.table-head,.student-row{display:grid;grid-template-columns:82px 88px minmax(125px,.78fr) 94px repeat(3,minmax(165px,1fr));min-width:1110px}.table-head{background:#f8fafc;border-bottom:1px solid #dbe3ee}.table-head>div{padding:10px 9px;font-size:10px;font-weight:900;color:#334155;border-right:1px solid #e2e8f0}.table-head>div:last-child{border-right:0}.rows{max-height:790px;overflow-y:auto;overflow-x:hidden}.student-row{border-bottom:1px solid #e2e8f0;min-height:80px;background:#fff}.student-row:last-child{border-bottom:0}.cell{padding:8px 9px;border-right:1px solid #e2e8f0;display:flex;align-items:center;min-width:0}.cell:last-child{border-right:0}.name{font-weight:900;font-size:12px}.center{justify-content:center}.status{display:inline-flex;width:max-content;padding:5px 8px;border-radius:999px;background:#f1f5f9;font-size:10px;font-weight:900;white-space:nowrap}.status.present{background:#f1f5f9;color:#334155}.status.absent{background:#fee2e2;color:#991b1b}.status.recognized{background:#dbeafe;color:#1d4ed8}.status.special{background:#fef3c7;color:#92400e}.reason{font-size:11px;line-height:1.45;color:#475569;white-space:pre-wrap;word-break:break-word}.reason.none{color:#94a3b8}.evidence{display:inline-flex;width:max-content;max-width:100%;padding:5px 7px;border-radius:999px;font-size:9px;font-weight:900;white-space:nowrap}.evidence.confirmed{background:#dcfce7;color:#166534}.evidence.rejected{background:#fee2e2;color:#991b1b}.evidence.missing{background:#fee2e2;color:#b91c1c}.evidence.required{background:#fee2e2;color:#b91c1c}.evidence.none{background:#f1f5f9;color:#64748b}.memo-cell{display:block;padding:7px 8px}.memo{width:100%;min-height:54px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:7px 8px;font-size:10px;line-height:1.4;background:#fff}.memo:focus{outline:2px solid #bfdbfe;border-color:#60a5fa}.memo-state{display:block;height:12px;margin-top:2px;text-align:right;font-size:8px;color:#64748b;font-weight:700}.empty{padding:40px;text-align:center;color:#64748b}.error{padding:12px 14px;border-radius:11px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;margin-bottom:10px;font-size:11px;white-space:pre-wrap}@media(max-width:1450px){.workspace{grid-template-columns:330px minmax(0,1fr)}.table-head,.student-row{grid-template-columns:76px 82px minmax(115px,.7fr) 88px repeat(3,minmax(145px,1fr));min-width:1010px}.raw-text{min-height:300px;max-height:380px}}@media(max-width:1080px){.workspace{grid-template-columns:1fr}.left-stack{grid-template-columns:1fr 1fr}.raw-text{min-height:260px;max-height:330px}.data-panel{margin-top:0}}@media(max-width:760px){.left-stack{grid-template-columns:1fr}.field{width:100%}.field select{width:100%;min-width:0}.autosave-notice{white-space:normal}.workspace{display:block}.data-panel{margin-top:10px}}
`;'''
s,n=re.subn(r"const STYLE=`.*?`;(?=\n\nconst esc=)",new_style,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'STYLE replacement failed: {n}')

new_markup=r'''  root.innerHTML=`<style>${STYLE}</style><div class="wrap"><div id="err"></div><section class="card toolbar"><div class="field"><label>반</label><select id="classSel">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반 · ${esc(c.course||'')}</option>`).join('')}</select></div><div class="field"><label>교육일자</label><select id="dateSel"><option>불러오는 중…</option></select></div><button id="reload" class="btn soft">↻ 다시 읽기</button><span class="autosave-notice">※ 모든 메모는 저장버튼 없이 자동저장됩니다.</span><div class="spacer"></div><span id="topState" class="state">준비 중…</span></section><div class="hint">원본 Google Sheet와 Google Drive는 읽기만 합니다. 좌측 가-3는 선택 날짜의 원문 셀 내용을 가공 없이 표시하고, 폴더 버튼은 선택 날짜의 정확한 Drive 날짜 폴더로 연결합니다.</div><section class="workspace"><aside class="left-stack"><article class="card raw-card"><div class="section-head"><div><h3>가-3 원문</h3><p>선택한 교육일의 Google Sheet 원문 내용입니다. · 가공하지 않은 원문 텍스트</p></div></div><pre id="rawReason" class="raw-text">Google Sheet를 불러오는 중…</pre></article><article class="card manual-card"><div class="section-head"><div><h3>수기출석 관련 관리자 메모</h3><p>해당 반·날짜 수기출석 전체에 대한 관리자 메모입니다.</p></div></div><div class="manual-body"><div class="manual-issue"><div class="manual-issue-head"><strong>관리자 메모</strong><span id="manualIssueState" class="manual-issue-state"></span></div><textarea id="manualIssueMemo" placeholder="전반적인 출결 특이사항, 전달사항 등을 입력하세요."></textarea></div><div class="folder-area"><div class="folder-title"><span>관련 폴더 바로가기</span><span class="folder-note">선택 날짜 기준 자동 추출</span></div><div class="folder-buttons"><button id="manualFolderBtn" class="btn folder" disabled>📁 수기출석 날짜폴더 찾는 중…</button><button id="recognitionFolderBtn" class="btn folder" disabled>📁 출결인증서류 날짜폴더 찾는 중…</button></div></div></div></article></aside><article class="card data-panel"><div class="data-title"><strong>Google Sheet · 출결현황 + 학생별 관리자 메모</strong><span>이름 / 출석현황 / 사유 / 서류제출 / 체크히어 / 서류제출 / 수기출석</span></div><div class="table-scroll"><div class="table-head"><div>이름</div><div>출석현황</div><div>사유</div><div>서류제출</div><div>체크히어 관련</div><div>서류제출 관련</div><div>수기출석 관련</div></div><div id="rows" class="rows"><div class="empty">불러오는 중…</div></div></div></article></section></div>`;
  const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState'),manualFolderBtn=$('#manualFolderBtn'),recognitionFolderBtn=$('#recognitionFolderBtn');'''
s,n=re.subn(r"  root\.innerHTML=`.*?`;\n  const \$=s=>root\.querySelector\(s\).*?;(?=\n  let dates=)",new_markup,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'markup replacement failed: {n}')

s=s.replace("let dates=[],students=[],reasonCells={},driveFiles=[],memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();","let dates=[],students=[],reasonCells={},memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();",1)

old_getdrive_pat=r"  async function getDrive\(cid,iso\)\{.*?\n  \}(?=\n  function parseReader)"
new_getdrive=r'''  async function getFolder(cid,iso,folderKey){
    const idToken=await user.getIdToken(),base=await post('/api/admin-drive-review',{idToken,action:'list',classId:String(cid),date:iso,folderKey:String(folderKey)});
    if(base.dateFolderId||base.exactDateFolder)return base;
    const rootId=String(base.rootFolderId||((!base.exactDateFolder&&base.folderId)?base.folderId:'')||'');
    if(!rootId)return base;
    let token=driveToken;
    if(!token&&typeof getDriveAccessToken==='function'){try{token=String(await getDriveAccessToken(false)||'');driveToken=token}catch{}}
    if(!token)return base;
    try{const direct=await directDriveLookup(rootId,iso,token);return{...base,...direct,rootFolderId:rootId,rootFolderUrl:base.rootFolderUrl||base.folderUrl||'',bridgeUsed:false}}
    catch(e){return{...base,directDriveError:String(e.message||e),rootFolderId:rootId}}
  }'''
s,n=re.subn(old_getdrive_pat,new_getdrive,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'getFolder replacement failed: {n}')

render_pat=r"  function renderRows\(label\)\{.*?(?=\n  function renderFile\(index=0\))"
new_render=r'''  function renderRawReason(label){
    const raw=String(reasonCells[label]??'');
    rawReason.textContent=raw||'해당 날짜의 가-3 원문이 없습니다.';
    rawReason.classList.toggle('raw-empty',!raw);
  }
  function renderRows(label){
    const d=dates.find(x=>x.label===label);if(!d){rows.innerHTML='<div class="empty">해당 날짜를 찾지 못했습니다.</div>';return}
    const reasonText=reasonCells[label]||'',roster=students.map(x=>x.name);
    rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="cell"><div class="name">${esc(s.name)}</div></div><div class="cell center"><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="cell reason ${reason?'':'none'}">${esc(reason||'-')}</div><div class="cell center"><span class="evidence ${e.cls}">${esc(e.label)}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="체크히어 관련 메모">${esc(bundle.checkhere)}</textarea><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="서류제출 관련 메모">${esc(bundle.documents)}</textarea><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder="수기출석 관련 메모">${esc(bundle.manual)}</textarea><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span></div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';
    root.querySelectorAll('.memo').forEach(ta=>{ta.oninput=()=>{const key=ta.dataset.key,category=ta.dataset.category,stateKey=ta.dataset.stateKey,state=root.querySelector(`[data-state="${CSS.escape(stateKey)}"]`),cid=currentClass,iso=currentIso,timerKey=`${cid}_${iso}_${key}_${category}`;if(state)state.textContent='입력 중';clearTimeout(saveTimers.get(timerKey));saveTimers.set(timerKey,setTimeout(()=>saveStudentMemo(key,category,ta.value,state,cid,iso).catch(e=>showErr(e)),650))}})
  }'''
s,n=re.subn(render_pat,new_render,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'renderRows replacement failed: {n}')

folder_block=r'''  function folderUrlFrom(d){return String(d?.dateFolderUrl||(d?.dateFolderId?`https://drive.google.com/drive/folders/${d.dateFolderId}`:'')||(d?.exactDateFolder?d?.folderUrl:'')||'')}
  function paintFolderButton(btn,label,result){
    btn.dataset.url='';btn.disabled=true;
    if(!result||result.status!=='fulfilled'){btn.textContent=`📁 ${label} · 확인 오류`;return}
    const d=result.value||{},url=folderUrlFrom(d),found=Boolean(d.dateFolderFound||d.exactDateFolder||d.dateFolderId);
    if(url){btn.dataset.url=url;btn.disabled=false;btn.textContent=`📁 ${label} 날짜폴더 바로가기`;return}
    btn.textContent=found?`📁 ${label} · 링크 확인 필요`:`📁 ${label} · 날짜폴더 없음`;
  }
  async function loadFolderLinks(){
    const cid=currentClass,iso=currentIso;
    manualFolderBtn.disabled=true;recognitionFolderBtn.disabled=true;
    manualFolderBtn.textContent='📁 수기출석 날짜폴더 찾는 중…';recognitionFolderBtn.textContent='📁 출결인증서류 날짜폴더 찾는 중…';
    const [manual,recognition]=await Promise.allSettled([getFolder(cid,iso,'manualAttendance'),getFolder(cid,iso,'recognition')]);
    if(cid!==currentClass||iso!==currentIso)return;
    paintFolderButton(manualFolderBtn,'수기출석',manual);paintFolderButton(recognitionFolderBtn,'출결인증서류',recognition);
  }
  async function loadSelectedDate(){showErr('');const label=dateSel.value,d=dates.find(x=>x.label===label);if(!d)return;currentIso=d.iso;topState.textContent=`${currentClass}반 · ${label} 불러오는 중…`;await loadMemos(currentClass,currentIso);renderRawReason(label);renderRows(label);loadFolderLinks().catch(e=>console.warn('folder links failed',e));topState.textContent=`${currentClass}반 · ${label} · ${students.length}명`}
'''
s,n=re.subn(r"  function renderFile\(index=0\)\{.*?(?=  async function loadClass)",folder_block,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'preview/loadDrive removal failed: {n}')

s=s.replace("showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class=\"empty\">Google Sheet를 읽는 중…</div>';","showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class=\"empty\">Google Sheet를 읽는 중…</div>';rawReason.textContent='Google Sheet를 읽는 중…';",1)

handler_pat=r"  fileSel\.onchange=.*?\n  \$\('#full'\)\.onclick=.*?;\n"
new_handlers=r'''  manualFolderBtn.onclick=()=>{const u=manualFolderBtn.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};
  recognitionFolderBtn.onclick=()=>{const u=recognitionFolderBtn.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};
  manualIssueMemo.oninput=()=>{manualIssueState.textContent='입력 중';const cid=currentClass,iso=currentIso,value=manualIssueMemo.value,key=`manualIssue_${cid}_${iso}`;clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveManualIssue(value,manualIssueState,cid,iso).catch(e=>showErr(e)),650))};
'''
s,n=re.subn(handler_pat,new_handlers,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'event handler replacement failed: {n}')

for forbidden in ['id="viewer"','id="fileSel"','id="openFile"','id="full"','수기출석부 미리보기']:
    if forbidden in s: raise SystemExit('old preview UI still present: '+forbidden)
for required in ['id="rawReason"','id="manualFolderBtn"','id="recognitionFolderBtn"','function renderRawReason','data-category="checkhere"','data-category="documents"','data-category="manual"']:
    if required not in s: raise SystemExit('required marker missing: '+required)
p.write_text(s,encoding='utf-8')

# index.html cache bust + description
p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('수기출석부 Drive 미리보기 · 운영총괄 출결/가-3 사유 · 학생별 관리자 메모를 한 화면에서 확인합니다. Sheet와 Drive는 읽기 전용입니다.','가-3 원문 · 선택 날짜 Drive 폴더 바로가기 · 운영총괄 출결현황 · 학생별 관리자 메모를 한 화면에서 확인합니다. Sheet와 Drive는 읽기 전용입니다.',1)
s=s.replace('/attendance-overview.js?v=20260906-8','/attendance-overview.js?v=20260906-9',1)
if '/attendance-overview.js?v=20260906-9' not in s: raise SystemExit('cache bust failed')
p.write_text(s,encoding='utf-8')
