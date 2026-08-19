from pathlib import Path
import base64

INDEX = Path('index.html')
IMAGE = Path('scan-guide.jpg')

s = INDEX.read_text(encoding='utf-8')

if 'data-guide="attendanceScan"' in s:
    print('Scan guide already present; nothing to patch.')
    raise SystemExit(0)

old_css = '.modal-back{position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;padding:20px;z-index:50}.modal{width:min(520px,100%);background:#fff;border-radius:20px;padding:23px}.modal h3{margin-top:0}.toast'
new_css = '.modal-back{position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;padding:20px;z-index:50}.modal{width:min(520px,100%);background:#fff;border-radius:20px;padding:23px}.modal h3{margin-top:0}.task-actions{display:flex;flex-direction:column;gap:8px;margin-top:auto}.task-actions .btn{width:100%}.image-modal{width:min(980px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:20px;padding:18px;box-shadow:0 18px 45px rgba(15,23,42,.18)}.image-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.image-modal-head h3{margin:0 0 4px}.image-modal-head p{margin:0;color:#64748b;font-size:13px;line-height:1.5}.image-modal img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid #e2e8f0;background:#fff}.toast'
if old_css not in s:
    raise SystemExit('Safety stop: CSS anchor not found')
s = s.replace(old_css, new_css, 1)

old_button = "const button=(u,label='열기')=>`<button class=\"btn btn-primary\" data-open=\"${esc(good(u))}\" ${good(u)?'':'disabled'}>${good(u)?esc(label):'관리자 등록 필요'}</button>`;"
new_button = old_button + "\nconst taskButtons=(num,u,label)=>String(num)==='2'?`<div class=\"task-actions\">${button(u,label)}<button type=\"button\" class=\"btn btn-soft guideBtn\" data-guide=\"attendanceScan\">스캔하는 법</button></div>`:button(u,label);"
if old_button not in s:
    raise SystemExit('Safety stop: button anchor not found')
s = s.replace(old_button, new_button, 1)

denied = "function denied(user){shell(user,`<div class=\"card empty\"><h2>접근 권한이 없습니다</h2><p>${esc(user.email)}</p><button id=\"retryLogin\" class=\"btn btn-dark\">다른 계정으로 로그인</button></div>`);document.getElementById('retryLogin').onclick=()=>signOut(auth)}"
modal = "function showGuideModal(title,desc,src){const wrap=document.createElement('div');wrap.className='modal-back';wrap.innerHTML=`<div class=\"image-modal\"><div class=\"image-modal-head\"><div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div><button id=\"guideClose\" class=\"btn btn-ghost\">닫기</button></div><img src=\"${src}\" alt=\"${esc(title)}\"></div>`;document.body.appendChild(wrap);const close=()=>wrap.remove();wrap.addEventListener('click',e=>{if(e.target===wrap)close()});wrap.querySelector('#guideClose').onclick=close;document.addEventListener('keydown',function onKey(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',onKey)}})}"
if denied not in s:
    raise SystemExit('Safety stop: denied anchor not found')
s = s.replace(denied, denied + '\n' + modal, 1)

old_map = "${tasks.map(t=>`<article class=\"card task\"><div class=\"num\">${t[0]}</div><h3>${esc(t[1])}</h3><p>${esc(t[2])}</p>${button(t[3],t[4])}</article>`).join('')}"
new_map = "${tasks.map(t=>`<article class=\"card task\"><div class=\"num\">${t[0]}</div><h3>${esc(t[1])}</h3><p>${esc(t[2])}</p>${taskButtons(t[0],t[3],t[4])}</article>`).join('')}"
if old_map not in s:
    raise SystemExit('Safety stop: task anchor not found')
s = s.replace(old_map, new_map, 1)

old_bind = "bindOpen();document.getElementById('copyNotice').onclick=()=>navigator.clipboard.writeText(settings.notice).then(()=>toast('공지문 복사 완료'));document.getElementById('addLink').onclick=()=>linkModal(c.id,p,null,()=>teacherView(user,p));"
new_bind = "bindOpen();document.querySelectorAll('.guideBtn').forEach(b=>b.onclick=()=>showGuideModal('수기 출석부 드라이브 업로드 가이드라인','구글 드라이브 앱에서 문서 스캔 기능으로 수기출석본을 업로드하는 방법입니다.','/scan-guide.jpg'));document.getElementById('copyNotice').onclick=()=>navigator.clipboard.writeText(settings.notice).then(()=>toast('공지문 복사 완료'));document.getElementById('addLink').onclick=()=>linkModal(c.id,p,null,()=>teacherView(user,p));"
if old_bind not in s:
    raise SystemExit('Safety stop: binding anchor not found')
s = s.replace(old_bind, new_bind, 1)

parts = sorted(Path('tools').glob('scan-guide.b64.*'))
if not parts:
    raise SystemExit('Safety stop: image chunks missing')
b64 = ''.join(p.read_text(encoding='utf-8').strip() for p in parts)
IMAGE.write_bytes(base64.b64decode(b64))
INDEX.write_text(s, encoding='utf-8')

# final validations
final = INDEX.read_text(encoding='utf-8')
if 'data-guide="attendanceScan"' not in final or 'showGuideModal' not in final:
    raise SystemExit('Safety stop: final HTML validation failed')
if IMAGE.stat().st_size < 10000:
    raise SystemExit('Safety stop: image validation failed')
print('Safe scan guide patch prepared successfully.')