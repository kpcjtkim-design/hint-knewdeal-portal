from pathlib import Path
import re


def sub_once(pattern, repl, text, label, flags=0):
    out, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {n}')
    return out


def replace_once(old, new, text, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {n}')
    return text.replace(old, new, 1)

# index.html: hide legacy attendance validation tab, rename overview, remove Drive reauth from entrypoint.
p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = sub_once(r'<button class="tab [^"]*" data-tab="attendance">출결 자동검증</button>', '', s, 'hide attendance tab')
s = sub_once(r'(<button class="tab [^"]*" data-tab="attendanceOverview">)출석부 한눈에 보기(</button>)', r'\1출결대조\2', s, 'rename attendance overview tab')

new_entry = '''async function attendanceOverviewAdmin(user,p){
  const host=document.getElementById('adminBody');if(!host)return;
  host.innerHTML=`<section class="card attendance-native-shell"><div class="attendance-native-head"><h3>출결대조</h3><p>운영총괄 출결·가-3 원문과 학생별 관리자 메모를 한 화면에서 대조합니다. Google Sheet 원본은 읽기 전용입니다.</p></div><div id="attendanceOverviewMount" class="attendance-native-mount"><div class="empty">출결대조 모듈을 불러오는 중…</div></div></section>`;
  try{const mod=await import(`/attendance-overview.js?v=20260906-10`);await mod.mountAttendanceOverview(document.getElementById('attendanceOverviewMount'),{auth,db,user,classes:CLASSES})}catch(e){const mount=document.getElementById('attendanceOverviewMount');if(mount)mount.innerHTML=`<div class="fatal">출결대조를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}
}
'''
s = sub_once(r'async function attendanceOverviewAdmin\(user,p\)\{[\s\S]*?\n\}\n(?=async function urgentAdmin\()', new_entry, s, 'replace attendance overview entry')
p.write_text(s, encoding='utf-8')

# attendance-overview.js: remove Drive/folder UI and code while preserving sheet colors and memo behavior.
p = Path('attendance-overview.js')
s = p.read_text(encoding='utf-8')
s = replace_once("if(!host)throw new Error('출석부 한눈에 보기 영역을 찾지 못했습니다.');", "if(!host)throw new Error('출결대조 영역을 찾지 못했습니다.');", s, 'rename mount error')
s = replace_once("const {auth,db,user,classes=[],driveAccessToken='',getDriveAccessToken=null}=ctx||{};", "const {auth,db,user,classes=[]}=ctx||{};", s, 'remove drive auth ctx')
s = replace_once("<div class=\"hint\">원본 Google Sheet와 Google Drive는 읽기만 합니다. 좌측 가-3는 선택 날짜의 원문 셀 내용을 가공 없이 표시하고, 폴더 버튼은 선택 날짜의 정확한 Drive 날짜 폴더로 연결합니다.</div>", "<div class=\"hint\">원본 Google Sheet는 읽기만 합니다. 좌측 가-3는 선택 날짜의 원문 셀 내용을 가공 없이 표시합니다.</div>", s, 'simplify hint')
folder_markup = '<div class="folder-area"><div class="folder-title"><span>관련 폴더 바로가기</span><span class="folder-note">선택 날짜 기준 자동 추출</span></div><div class="folder-buttons"><button id="manualFolderBtn" class="btn folder" disabled>📁 수기출석 날짜폴더 찾는 중…</button><button id="recognitionFolderBtn" class="btn folder" disabled>📁 출결인증서류 날짜폴더 찾는 중…</button></div></div>'
s = replace_once(folder_markup, '', s, 'remove folder markup')
s = replace_once(",manualFolderBtn=$('#manualFolderBtn'),recognitionFolderBtn=$('#recognitionFolderBtn')", '', s, 'remove folder selectors')
s = replace_once("  let driveToken=String(driveAccessToken||'');\n", '', s, 'remove drive token')
s = sub_once(r'\n  function overviewWeekNo\(iso\)\{[\s\S]*?\n  function parseReader\(out\)\{', '\n  function parseReader(out){', s, 'remove drive lookup block')
s = sub_once(r'\n  function folderUrlFrom\(d\)\{[\s\S]*?\n  async function loadSelectedDate\(\)\{', '\n  async function loadSelectedDate(){', s, 'remove folder helper block')
s = replace_once("renderRawReason(label);renderRows(label);loadFolderLinks().catch(e=>console.warn('folder links failed',e));topState", "renderRawReason(label);renderRows(label);topState", s, 'remove folder loading')
s = s.replace("  manualFolderBtn.onclick=()=>{const u=manualFolderBtn.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};\n", '')
s = s.replace("  recognitionFolderBtn.onclick=()=>{const u=recognitionFolderBtn.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};\n", '')
s = re.sub(r'\.btn\.folder\{[^}]*\}\.btn\.folder:hover:not\(:disabled\)\{[^}]*\}', '', s, count=1)
s = re.sub(r'\.folder-area\{[^}]*\}\.folder-title\{[^}]*\}\.folder-note\{[^}]*\}\.folder-buttons\{[^}]*\}', '', s, count=1)
p.write_text(s, encoding='utf-8')

# Strong assertions: no Drive reauth/folder behavior remains in the compare module.
check = Path('attendance-overview.js').read_text(encoding='utf-8')
for forbidden in ['driveAccessToken','getDriveAccessToken','admin-drive-review','www.googleapis.com/drive','manualFolderBtn','recognitionFolderBtn','관련 폴더 바로가기','loadFolderLinks']:
    if forbidden in check:
        raise SystemExit(f'forbidden token remains in attendance-overview.js: {forbidden}')
if 'overviewColorState(bg)' not in check or '/api/attendance-colors' not in check:
    raise SystemExit('attendance color model/fallback was unexpectedly removed')
if 'data-category="checkhere"' not in check or 'data-category="documents"' not in check or 'data-category="manual"' not in check:
    raise SystemExit('student memo categories were unexpectedly removed')
