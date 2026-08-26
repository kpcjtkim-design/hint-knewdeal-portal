from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
needle='<button class="tab ${tab===\'preview\'?\'active\':\'\'}" data-tab="preview">담임 화면 PREVIEW</button><button class="tab ${tab===\'uploads\'?\'active\':\'\'}" data-tab="uploads">업로드 확인</button>'
repl='<button class="tab ${tab===\'preview\'?\'active\':\'\'}" data-tab="preview">담임 화면 PREVIEW</button><button class="tab" id="attendanceAdminBtn">출결 자동검증</button><button class="tab ${tab===\'uploads\'?\'active\':\'\'}" data-tab="uploads">업로드 확인</button>'
if needle in s:
    s=s.replace(needle,repl,1)
elif 'id="attendanceAdminBtn"' not in s:
    raise SystemExit('admin tabs anchor not found')
needle2="document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>adminView(user,p,b.dataset.tab,selected));"
repl2=needle2+"const attendanceBtn=document.getElementById('attendanceAdminBtn');if(attendanceBtn)attendanceBtn.onclick=()=>{location.href='/attendance-test.html'};"
if needle2 in s and 'attendanceBtn.onclick' not in s:
    s=s.replace(needle2,repl2,1)
elif 'attendanceBtn.onclick' not in s:
    raise SystemExit('admin tab binding anchor not found')
p.write_text(s,encoding='utf-8')
print('patched admin attendance entry')
