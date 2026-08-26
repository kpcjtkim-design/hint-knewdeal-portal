from pathlib import Path
p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')
s=s.replace("import {getAuth,GoogleAuthProvider,signInWithPopup} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';","import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';")
needle="const fb=initializeApp(firebaseConfig),auth=getAuth(fb),db=getFirestore(fb),provider=new GoogleAuthProvider();\nprovider.setCustomParameters({prompt:'select_account'});"
repl="const fb=initializeApp(firebaseConfig),auth=getAuth(fb),db=getFirestore(fb),provider=new GoogleAuthProvider();\nprovider.setCustomParameters({prompt:'select_account'});\nsetPersistence(auth,browserLocalPersistence).catch(()=>{});"
if needle in s:
    s=s.replace(needle,repl,1)
old="async function login(){showError('');const res=await signInWithPopup(auth,provider);if(!(await isAdmin(res.user))){await auth.signOut();throw new Error('관리자 권한이 있는 계정만 사용할 수 있습니다.')}token=await res.user.getIdToken();email=(res.user.email||'').toLowerCase();$('#accountText').textContent=`${email} · 관리자 확인 완료 · 운영총괄 Viewer 읽기전용`;$('#app').style.display='block';$('#loginBtn').textContent='관리자 계정 다시 연결';await loadClass('1')}"
new="async function activateAdmin(user){if(!(await isAdmin(user))){await auth.signOut();throw new Error('관리자 권한이 있는 계정만 사용할 수 있습니다.')}const mail=(user.email||'').toLowerCase();if(email===mail&&token&&$('#app').style.display==='block')return;token=await user.getIdToken();email=mail;$('#accountText').textContent=`${email} · 관리자 확인 완료 · 운영총괄 Viewer 읽기전용`;$('#app').style.display='block';$('#loginBtn').textContent='관리자 계정 다시 연결';await loadClass('1')}\nasync function login(){showError('');const res=await signInWithPopup(auth,provider);await activateAdmin(res.user)}"
if old in s:
    s=s.replace(old,new,1)
elif 'async function activateAdmin(user)' not in s:
    raise SystemExit('login anchor not found')
marker="$('#loginBtn').onclick=()=>login().catch(showError);"
if marker in s and "onAuthStateChanged(auth,user=>" not in s:
    s=s.replace(marker,marker+"\nonAuthStateChanged(auth,user=>{if(user)activateAdmin(user).catch(showError)});",1)
p.write_text(s,encoding='utf-8')
print('patched attendance admin session')
