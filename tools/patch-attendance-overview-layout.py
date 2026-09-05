from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing target: {label}')
    return text.replace(old, new, 1)

# 1) Attendance overview module: responsive wide layout + manual attendance issue memo
p = Path('attendance-overview.js')
s = p.read_text(encoding='utf-8')

s = replace_once(
    s,
    '.wrap{width:min(1600px,calc(100vw - 32px));margin-left:50%;transform:translateX(-50%)}',
    '.wrap{width:100%;max-width:1760px;margin:0 auto}',
    'overview wrap'
)
s = replace_once(
    s,
    '.workspace{display:grid;grid-template-columns:minmax(430px,1.15fr) minmax(720px,2fr);gap:12px;align-items:start}',
    '.workspace{display:grid;grid-template-columns:minmax(360px,.9fr) minmax(0,2.1fr);gap:12px;align-items:start}',
    'workspace columns'
)
s = replace_once(
    s,
    '.data-head{display:grid;grid-template-columns:minmax(0,1fr) 330px;background:#f8fafc;border-bottom:1px solid #e2e8f0}',
    '.data-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,300px);background:#f8fafc;border-bottom:1px solid #e2e8f0}',
    'data head columns'
)
s = replace_once(
    s,
    '.student-row{display:grid;grid-template-columns:minmax(0,1fr) 330px;border-bottom:1px solid #e2e8f0;min-height:78px}',
    '.student-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,300px);border-bottom:1px solid #e2e8f0;min-height:78px}',
    'student row columns'
)
s = replace_once(
    s,
    '.sheet-side{display:grid;grid-template-columns:120px 110px minmax(220px,1fr);gap:10px;align-items:center;padding:10px 13px}',
    '.sheet-side{display:grid;grid-template-columns:110px 92px minmax(150px,1fr);gap:10px;align-items:center;padding:10px 13px}',
    'sheet side columns'
)
s = replace_once(
    s,
    '@media(max-width:1080px){.workspace{grid-template-columns:1fr}',
    '@media(max-width:1180px){.workspace{grid-template-columns:1fr}',
    'responsive breakpoint'
)

manual_css = '.manual-issue{padding:12px 14px 14px;border-top:1px solid #e2e8f0;background:#fff}.manual-issue-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px}.manual-issue-head strong{font-size:13px}.manual-issue textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:12px;line-height:1.5;background:#fff}.manual-issue-state{font-size:10px;color:#64748b;white-space:nowrap}.preview-panel.full .manual-issue{display:none}'
s = replace_once(s, '@media(max-width:1180px){.workspace', manual_css + '@media(max-width:1180px){.workspace', 'manual issue css')

old_markup = '<div id="viewer" class="viewer-wrap"><div class="viewer-empty">반과 날짜를 불러오는 중입니다.</div></div></article><article class="card data-panel">'
new_markup = '<div id="viewer" class="viewer-wrap"><div class="viewer-empty">반과 날짜를 불러오는 중입니다.</div></div><div class="manual-issue"><div class="manual-issue-head"><strong>수기출석부 이슈 메모</strong><span id="manualIssueState" class="manual-issue-state"></span></div><textarea id="manualIssueMemo" placeholder="예: 2페이지 서명 누락, 14:20 수기 수정 확인 필요 등"></textarea></div></article><article class="card data-panel">'
s = replace_once(s, old_markup, new_markup, 'manual issue markup')

old_refs = "const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),viewer=$('#viewer'),fileSel=$('#fileSel'),openFile=$('#openFile'),fileCount=$('#fileCount'),previewPanel=$('#previewPanel');"
new_refs = "const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),viewer=$('#viewer'),fileSel=$('#fileSel'),openFile=$('#openFile'),fileCount=$('#fileCount'),previewPanel=$('#previewPanel'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState');"
s = replace_once(s, old_refs, new_refs, 'manual issue refs')

old_state = "let readerData=null,dates=[],students=[],reasonCells={},driveFiles=[],memos={},currentIso='',currentClass='1',saveTimers=new Map();"
new_state = "let readerData=null,dates=[],students=[],reasonCells={},driveFiles=[],memos={},manualIssue='',currentIso='',currentClass='1',saveTimers=new Map();"
s = replace_once(s, old_state, new_state, 'manual issue state')

old_load = "async function loadMemos(cid,iso){memos={};try{const s=await getDoc(doc(db,'settings',memoId(cid,iso)));if(s.exists())memos=s.data().memos||{}}catch(e){console.warn('memo load failed',e)}}"
new_load = "async function loadMemos(cid,iso){memos={};manualIssue='';try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'')}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':''}"
s = replace_once(s, old_load, new_load, 'manual issue load')

save_memo = "async function saveMemo(key,value,stateEl){memos={...memos,[key]:String(value||'')};if(!String(value||'').trim())delete memos[key];if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(currentClass,currentIso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:currentClass,date:currentIso,memos,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}"
save_issue = save_memo + "\n  async function saveManualIssue(value,stateEl,cid,iso){const next=String(value||'');if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,manualIssue:next,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso){manualIssue=next;if(stateEl)stateEl.textContent='저장됨'}}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}"
s = replace_once(s, save_memo, save_issue, 'manual issue save function')

height_line = "$('#height').oninput=e=>viewer.style.setProperty('height',`${e.target.value}px`);"
height_plus = height_line + "\n  manualIssueMemo.oninput=()=>{manualIssueState.textContent='입력 중';const cid=currentClass,iso=currentIso,value=manualIssueMemo.value,key=`manualIssue_${cid}_${iso}`;clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveManualIssue(value,manualIssueState,cid,iso).catch(e=>showErr(e)),650))};"
s = replace_once(s, height_line, height_plus, 'manual issue input binding')

p.write_text(s, encoding='utf-8')

# 2) Main portal: make only the overview tab use the full browser width and bust module cache
p = Path('index.html')
s = p.read_text(encoding='utf-8')
old_admin = "async function attendanceOverviewAdmin(user,p){\n  const host=document.getElementById('adminBody');if(!host)return;"
new_admin = "async function attendanceOverviewAdmin(user,p){\n  const host=document.getElementById('adminBody');if(!host)return;\n  const page=document.querySelector('main.page');if(page){page.style.width='calc(100vw - 24px)';page.style.maxWidth='none';page.style.margin='18px auto 50px'}"
s = replace_once(s, old_admin, new_admin, 'overview page width')
s = replace_once(s, '/attendance-overview.js?v=20260906-1', '/attendance-overview.js?v=20260906-2', 'overview cache bust')
p.write_text(s, encoding='utf-8')

print('patched attendance overview layout and manual issue memo')
