from pathlib import Path
import json,re

att=Path('attendance-test.html')
idx=Path('index.html')
out=Path('attendance-native.js')

s=att.read_text(encoding='utf-8')
style=re.search(r'<style>(.*?)</style>',s,re.S)
script=re.search(r'<script type="module">(.*?)</script>',s,re.S)
if not style or not script:
    raise SystemExit('attendance source blocks not found')
css=style.group(1).replace(':root{',':host{')
body=s[s.find('<body>')+6:s.find('<script type="module">')]
app_start=body.find('<section id="app"')
history_start=body.find('<div id="historyBack"')
if app_start<0 or history_start<0:
    raise SystemExit('attendance app markup not found')
app_html=body[app_start:history_start]
if app_html.endswith('</div>'):
    app_html=app_html[:-6]
app_html=app_html.replace('id="app" style="display:none"','id="app" style="display:block"',1)
history_html=body[history_start:].strip()
markup=(
    '<div id="errorBox"></div>'
    '<span id="accountText" hidden></span><span id="heroTitle" hidden></span>'
    '<button id="loginBtn" hidden></button>'
    + app_html + history_html
)

js=script.group(1)
pos=js.find("const READER_API=")
if pos<0:
    raise SystemExit('READER_API anchor not found')
js=js[pos:]
js=re.sub(r"const EMBED_MODE=.*?;\s*",'',js,count=1)
js=js.replace("if(EMBED_MODE)document.body.classList.add('embedded');",'')
js=js.replace('document.querySelectorAll','root.querySelectorAll').replace('document.querySelector','root.querySelector')
js=re.sub(r"async function login\(\)\{.*?\}\s*",'',js,count=1,flags=re.S)
js=js.replace("$('#loginBtn').onclick=()=>login().catch(showError);",'')
js=re.sub(r"onAuthStateChanged\(auth,user=>\{if\(user\)activateAdmin\(user\)\.catch\(showError\)\}\);",'',js,count=1)
js=re.sub(r"if\(EMBED_MODE\)\{const sendHeight=.*?setTimeout\(sendHeight,1200\)\}",'',js,count=1,flags=re.S)
js=js.replace("await auth.signOut();throw new Error('관리자 권한이 있는 계정만 사용할 수 있습니다.')","throw new Error('관리자 권한이 있는 계정만 사용할 수 있습니다.')")

module=(
"import {doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';\n"
+ 'const ATTENDANCE_CSS='+json.dumps(css,ensure_ascii=False)+';\n'
+ 'const ATTENDANCE_MARKUP='+json.dumps(markup,ensure_ascii=False)+';\n'
+ "export async function mountAttendanceAdminNative(host,ctx){\n"
+ "  if(!host)throw new Error('출결 화면을 표시할 영역이 없습니다.');\n"
+ "  const {auth,db,user}=ctx||{};if(!auth||!db||!user)throw new Error('관리자 로그인 세션을 찾지 못했습니다.');\n"
+ "  const root=host.shadowRoot||host.attachShadow({mode:'open'});\n"
+ "  root.innerHTML='<style>'+ATTENDANCE_CSS+'</style>'+ATTENDANCE_MARKUP;\n"
+ js
+ "\nawait activateAdmin(user);\n"
+ "}\n"
)
out.write_text(module,encoding='utf-8')

p=idx.read_text(encoding='utf-8')
old_css='.attendance-frame-shell{padding:0;overflow:hidden}.attendance-frame-head{padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.attendance-frame-head h3{margin:0 0 5px;font-size:17px}.attendance-frame-head p{margin:0;color:#64748b;font-size:12px}.attendance-frame{display:block;width:100%;height:1150px;border:0;background:#f4f7fb}'
new_css='.attendance-native-shell{padding:0;overflow:hidden}.attendance-native-head{padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.attendance-native-head h3{margin:0 0 5px;font-size:17px}.attendance-native-head p{margin:0;color:#64748b;font-size:12px}.attendance-native-mount{min-height:640px;background:#f4f7fb;padding:14px}'
if old_css in p:
    p=p.replace(old_css,new_css,1)

pat=r"(?:async\s+)?function attendanceAdmin\(user,p\)\{.*?\}\nasync function urgentAdmin"
m=re.search(pat,p,re.S)
if not m:
    raise SystemExit('attendanceAdmin function not found')
new_func="""async function attendanceAdmin(user,p){
  const host=document.getElementById('adminBody');if(!host)return;
  host.innerHTML=`<section class=\"card attendance-native-shell\"><div class=\"attendance-native-head\"><h3>출결 자동검증</h3><p>운영총괄 원본은 읽기 전용이며, 검수값과 인정출석 서류 확인 상태만 Firebase에 저장됩니다. 관리자 로그인 세션을 그대로 사용합니다.</p></div><div id=\"attendanceNativeMount\" class=\"attendance-native-mount\"><div class=\"empty\">출결 검증 모듈을 불러오는 중…</div></div></section>`;
  try{const mod=await import(`/attendance-native.js?v=20260826-native2`);await mod.mountAttendanceAdminNative(document.getElementById('attendanceNativeMount'),{auth,db,user})}catch(e){const mount=document.getElementById('attendanceNativeMount');if(mount)mount.innerHTML=`<div class=\"fatal\">출결 자동검증을 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}
}
async function urgentAdmin"""
p=p[:m.start()]+new_func+p[m.end():]
p=p.replace("if(tab==='attendance')attendanceAdmin(user,p);","if(tab==='attendance')await attendanceAdmin(user,p);")
idx.write_text(p,encoding='utf-8')
print('built native attendance module and replaced iframe admin view')
