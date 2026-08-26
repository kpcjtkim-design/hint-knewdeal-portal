from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')

# Convert the old navigation-only attendance tab to an in-page admin tab.
s=s.replace('<button class="tab" id="attendanceAdminBtn">출결 자동검증</button>', '<button class="tab ${tab===\'attendance\'?\'active\':\'\'}" data-tab="attendance">출결 자동검증</button>')
s=s.replace("const attendanceBtn=document.getElementById('attendanceAdminBtn');if(attendanceBtn)attendanceBtn.onclick=()=>{location.href='/attendance-test.html'};", '')

# If the tab does not exist yet, insert it next to preview/uploads.
needle='<button class="tab ${tab===\'preview\'?\'active\':\'\'}" data-tab="preview">담임 화면 PREVIEW</button><button class="tab ${tab===\'uploads\'?\'active\':\'\'}" data-tab="uploads">업로드 확인</button>'
repl='<button class="tab ${tab===\'preview\'?\'active\':\'\'}" data-tab="preview">담임 화면 PREVIEW</button><button class="tab ${tab===\'attendance\'?\'active\':\'\'}" data-tab="attendance">출결 자동검증</button><button class="tab ${tab===\'uploads\'?\'active\':\'\'}" data-tab="uploads">업로드 확인</button>'
if needle in s:
    s=s.replace(needle,repl,1)
elif "data-tab=\"attendance\"" not in s:
    raise SystemExit('admin attendance tab anchor not found')

# Render the attendance page inside the admin layout instead of navigating away.
if '.attendance-frame-shell{' not in s:
    s=s.replace('</style>', '.attendance-frame-shell{padding:0;overflow:hidden}.attendance-frame-head{padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.attendance-frame-head h3{margin:0 0 5px;font-size:17px}.attendance-frame-head p{margin:0;color:#64748b;font-size:12px}.attendance-frame{display:block;width:100%;height:1150px;border:0;background:#f4f7fb}</style>',1)

anchor="async function urgentAdmin(user,p,selected='1'){"
fn="function attendanceAdmin(user,p){const host=document.getElementById('adminBody');if(!host)return;host.innerHTML=`<section class=\"card attendance-frame-shell\"><div class=\"attendance-frame-head\"><h3>출결 자동검증</h3><p>운영총괄 원본은 읽기 전용이며, 검수값과 인정출석 서류 확인 상태만 Firebase에 저장됩니다.</p></div><iframe id=\"attendanceFrame\" class=\"attendance-frame\" src=\"/attendance-test.html?embed=1\" title=\"출결 자동검증\"></iframe></section>`;if(!window.__attendanceResizeBound){window.__attendanceResizeBound=true;window.addEventListener('message',e=>{if(e.origin!==location.origin||e.data?.type!=='attendance-test-height')return;const f=document.getElementById('attendanceFrame');if(f)f.style.height=`${Math.max(780,Number(e.data.height)||0)}px`})}}\n"
if 'function attendanceAdmin(user,p)' not in s:
    if anchor not in s: raise SystemExit('attendanceAdmin insertion anchor not found')
    s=s.replace(anchor,fn+anchor,1)

needle2="if(tab==='preview')await adminPreview(user,p,selected);if(tab==='uploads')await uploadAdmin(user,p);"
repl2="if(tab==='preview')await adminPreview(user,p,selected);if(tab==='attendance')attendanceAdmin(user,p);if(tab==='uploads')await uploadAdmin(user,p);"
if needle2 in s:
    s=s.replace(needle2,repl2,1)
elif "if(tab==='attendance')attendanceAdmin(user,p);" not in s:
    raise SystemExit('admin attendance render anchor not found')

p.write_text(s,encoding='utf-8')
print('embedded admin attendance review')
