from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old="const taskButtons=(num,u,label)=>{const n=String(num),id=driveFolderId(u),history=['2','3','5'].includes(n)?`<button type=\"button\" class=\"btn btn-ghost missingDatesBtn\" data-folder-id=\"${esc(id)}\" data-task-label=\"${esc(TASK_LABELS[n]||'업로드')}\" ${id?'':'disabled'}>미완료 날짜 보기</button>`:'';if(n==='2')return `<div class=\"task-actions\">${button(u,label)}<button type=\"button\" class=\"btn btn-soft guideBtn\">스캔하는 법</button>${history}</div>`;if(history)return `<div class=\"task-actions\">${button(u,label)}${history}</div>`;return button(u,label)};"
new="const taskButtons=(num,u,label,classId='')=>{const n=String(num),id=driveFolderId(u),history=['2','3','5'].includes(n)?`<button type=\"button\" class=\"btn btn-ghost missingDatesBtn\" data-folder-id=\"${esc(id)}\" data-task-label=\"${esc(TASK_LABELS[n]||'업로드')}\" ${id?'':'disabled'}>미완료 날짜 보기</button>`:'';if(n==='1'&&classId)return `<div class=\"task-actions\"><button type=\"button\" class=\"btn btn-primary teacherAttendanceBtn\" data-class-id=\"${esc(classId)}\">출결 바로 확인</button>${button(u,'운영시트 입력')}</div>`;if(n==='2')return `<div class=\"task-actions\">${button(u,label)}<button type=\"button\" class=\"btn btn-soft guideBtn\">스캔하는 법</button>${history}</div>`;if(history)return `<div class=\"task-actions\">${button(u,label)}${history}</div>`;return button(u,label)};"
if old in s:
    s=s.replace(old,new,1)
elif 'teacherAttendanceBtn' not in s:
    raise SystemExit('taskButtons anchor not found')
s=s.replace('taskButtons(t[0],t[3],t[4])','taskButtons(t[0],t[3],t[4],c.id)')
old_bind="function bindOpen(){document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openUrl(b.dataset.open))}"
new_bind="function bindOpen(){document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openUrl(b.dataset.open));document.querySelectorAll('.teacherAttendanceBtn').forEach(b=>b.onclick=()=>{const id=String(b.dataset.classId||'');if(id)location.href=`/teacher-attendance.html?classId=${encodeURIComponent(id)}`})}"
if old_bind in s:
    s=s.replace(old_bind,new_bind,1)
elif 'teacherAttendanceBtn' not in s:
    raise SystemExit('bindOpen anchor not found')
p.write_text(s,encoding='utf-8')
print('patched teacher attendance entry')
