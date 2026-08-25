from pathlib import Path
import re

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

s=s.replace('HINT TEST · 관리자 출결 검수','운영총괄 · 관리자 출결 검수')
s=s.replace('ADMIN TEST · HINT TEST 사본만','ADMIN · 운영총괄 읽기전용')
s=s.replace('1~17반의 가-2 출결과 가-3 사유를 읽기 전용으로 확인합니다.','실제 운영총괄 1~17반의 가-2 출결과 가-3 사유를 읽기 전용으로 확인합니다.')
s=s.replace('이 테스트는 HINT TEST 사본에 대해 <b>Google Sheets 읽기 전용 권한</b>만 요청합니다. <b>수정·저장은 Google Sheet가 아니라 Firebase 검수 DB에만</b> 반영됩니다. 시트 자체를 수정·삭제하는 코드는 없습니다.','<b>운영총괄 원본은 hint.kpc@gmail.com의 Viewer 권한으로 읽기만 합니다.</b> 관리자 수정·저장은 Google Sheet가 아니라 <b>Firebase 검수 DB에만</b> 반영됩니다. 시트 자체를 수정·삭제하는 코드는 없습니다.')
s=s.replace('관리자 Google 로그인','관리자 로그인')
s=s.replace('관리자 계정으로 로그인해 주세요.','관리자 계정으로 로그인하면 운영총괄을 바로 읽습니다.')

# Remove Sheets OAuth scope. Firebase Google sign-in remains only for administrator authentication.
s=s.replace("provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');provider.setCustomParameters({prompt:'select_account'});","provider.setCustomParameters({prompt:'select_account'});")
s=s.replace("const SHEET_ID='1QDsPWGY8NKkoFovNxUiqea1z-_c1nQxW0AtIUl-A6jU',API='https://sheets.googleapis.com/v4/spreadsheets';","const READER_API='/api/attendance-reader';")

# Replace direct Google Sheets API helpers with server-side reader.
pat=r"async function api\(url\)\{.*?\}\nasync function valuesGet\(sheet,range\)\{.*?\}\n"
rep="""async function reader(classId){\n  const r=await fetch(READER_API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token,classId:String(classId)})});\n  const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}\n  if(!r.ok||!d.ok)throw new Error(d?.error||`${r.status} ${t}`);\n  return d;\n}\n"""
s,n=re.subn(pat,rep,s,flags=re.S)
if n!=1: raise SystemExit(f'reader helper replace count={n}')

# Firebase login only: no Sheets access token.
pat=r"async function login\(\)\{.*?\}\nasync function loadClass\(classId\)\{.*?\}\nasync function logView"
rep="""async function login(){showError('');const res=await signInWithPopup(auth,provider);if(!(await isAdmin(res.user))){await auth.signOut();throw new Error('관리자 권한이 있는 계정만 사용할 수 있습니다.')}token=await res.user.getIdToken();email=(res.user.email||'').toLowerCase();$('#accountText').textContent=`${email} · 관리자 확인 완료 · 운영총괄 Viewer 읽기전용`;$('#app').style.display='block';$('#loginBtn').textContent='관리자 계정 다시 연결';await loadClass('1')}\nasync function loadClass(classId){showError('');selectedClass=String(classId);const c=CLASSES.find(x=>x.id===selectedClass);if(!c)return;$('#rows').innerHTML='<div class=\"loading\">운영총괄에서 출결을 읽는 중…</div>';$('#heroTitle').textContent=`${c.id}반 · 출결 검수`;const out=await reader(selectedClass);const v=out.attendance||[],header=v[0]||[];dates=header.slice(4).map((x,i)=>({label:normalizeDate(x),idx:i})).filter(x=>x.label);students=v.slice(1).map(r=>({name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);const g3=out.reasons||[],rh=(g3[0]||[]).slice(4),rr=(g3[1]||[]).slice(4);reasonCells={};rh.forEach((d,i)=>reasonCells[normalizeDate(d)]=rr[i]||'');$('#dateSelect').innerHTML=dates.map(d=>`<option value=\"${esc(d.label)}\">${esc(d.label)}</option>`).join('');const preferred=dates.find(x=>x.label==='8/24')?.label||dates.at(-1)?.label||dates[0]?.label||'';$('#dateSelect').value=preferred;await renderDate(preferred);await logView(preferred)}\nasync function logView"""
s,n=re.subn(pat,rep,s,flags=re.S)
if n!=1: raise SystemExit(f'login/load replace count={n}')

s=s.replace("source:'HINT TEST'","source:'운영총괄_READ_ONLY'")
s=s.replace("mode:'READ_ONLY',parser:'RULE_V2'","mode:'READ_ONLY_VIEWER',parser:'RULE_V2'")
s=s.replace("type:'ATTENDANCE_REVIEW_TEST'","type:'ATTENDANCE_REVIEW'")
s=s.replace("source:'HINT TEST'","source:'운영총괄_READ_ONLY'")

p.write_text(s,encoding='utf-8')
print('switched attendance-test to live read-only attendance reader')
