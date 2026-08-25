from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

if 'TEMPORARY_TEACHER_V1' in s:
    print('temporary teacher patch already applied')
    raise SystemExit(0)
if 'MULTI_CLASS_TEACHER_V1' not in s:
    raise SystemExit('multi-class teacher patch must run first')

old_helper=r'''// MULTI_CLASS_TEACHER_V1
function teacherClassIds(profile){
  const valid=new Set(CLASSES.map(c=>String(c.id)));
  const preferred=String(profile?.primaryClassId||profile?.classId||'');
  const raw=[preferred,...(Array.isArray(profile?.classIds)?profile.classIds:[]),profile?.classId].map(x=>String(x||'')).filter(x=>valid.has(x));
  return [...new Set(raw)];
}
function userAssignedClassIds(profile){return teacherClassIds(profile)}
'''
new_helper=r'''// MULTI_CLASS_TEACHER_V1
// TEMPORARY_TEACHER_V1
function teacherPrimaryClassId(profile){
  const valid=new Set(CLASSES.map(c=>String(c.id)));
  const primary=String(profile?.primaryClassId||profile?.classId||'');
  return valid.has(primary)?primary:'';
}
function teacherTemporaryClassIds(profile){
  const valid=new Set(CLASSES.map(c=>String(c.id)));
  const primary=teacherPrimaryClassId(profile);
  const explicit=Array.isArray(profile?.tempClassIds)?profile.tempClassIds:null;
  const legacy=Array.isArray(profile?.classIds)?profile.classIds:[];
  const raw=(explicit!==null?explicit:legacy.filter(x=>String(x)!==primary)).map(x=>String(x||'')).filter(x=>valid.has(x)&&x!==primary);
  return [...new Set(raw)];
}
function teacherClassIds(profile){
  const primary=teacherPrimaryClassId(profile),temps=teacherTemporaryClassIds(profile);
  return [...new Set([primary,...temps].filter(Boolean))];
}
function userAssignedClassIds(profile){return teacherClassIds(profile)}
'''
if old_helper not in s: raise SystemExit('teacher helper anchor not found')
s=s.replace(old_helper,new_helper,1)

old_switch="const classSwitcher=allowed.length>1?`<section class=\"card teacher-class-switch\"><div><strong>담당 반 선택</strong><div class=\"hint\">현재 계정에 권한이 부여된 반만 표시됩니다.</div></div><div class=\"field\"><label>현재 반</label><select id=\"teacherClassSelect\">${allowed.map(id=>{const m=classMeta(id);return `<option value=\"${id}\" ${id===selected?'selected':''}>${id}반 · ${esc(m.course||'')}</option>`}).join('')}</select></div></section>`:'';"
new_switch="const primaryId=teacherPrimaryClassId(p),tempIds=teacherTemporaryClassIds(p);const classSwitcher=allowed.length>1?`<section class=\"card teacher-class-switch\"><div><strong>담당 반 선택</strong><div class=\"hint\">기본담당반과 임시담당반을 구분해 표시합니다.</div></div><div class=\"field\"><label>현재 반</label><select id=\"teacherClassSelect\">${allowed.map(id=>{const m=classMeta(id),kind=id===primaryId?'기본담당':'임시담당';return `<option value=\"${id}\" ${id===selected?'selected':''}>${id}반 · ${kind} · ${esc(m.course||'')}</option>`}).join('')}</select></div></section>`:'';"
if old_switch not in s: raise SystemExit('teacher switch anchor not found')
s=s.replace(old_switch,new_switch,1)

start=s.find('async function userAdmin(user,p){')
end=s.find('\nasync function settingsAdmin',start)
if start<0 or end<0: raise SystemExit('userAdmin boundaries not found')
new_user=r'''async function userAdmin(user,p){
  const q=await getDocs(collection(db,'users')),users=q.docs.map(d=>({email:d.id,...d.data()})).sort((a,b)=>a.email.localeCompare(b.email));
  document.getElementById('adminBody').innerHTML=`<section class="card panel"><div class="admin-note"><strong>담임 권한 구분:</strong> 기본 담당반은 평소 담당하는 정식 반이고, 임시 담당반은 휴가·부재 등 대체 운영 시에만 추가합니다. 임시 권한은 필요가 끝나면 체크를 해제해 주세요.</div><div class="form-grid"><div class="field"><label>이름</label><input id="uName"></div><div class="field"><label>Google 이메일</label><input id="uEmail"></div><div class="field"><label>권한</label><select id="uRole"><option value="TEACHER">담임</option><option value="ADMIN">운영자</option></select></div><div class="field" id="primaryClassField"><label>기본 담당반</label><select id="uPrimaryClass">${CLASSES.map(c=>`<option value="${c.id}">${c.id}반 · ${esc(c.course)}</option>`).join('')}</select><div class="mini-note">정식으로 담당하는 반 1개를 선택합니다.</div></div><div class="field full" id="tempClassField"><label>임시 담당반 · 복수 선택 가능</label><div class="class-check-grid">${CLASSES.map(c=>`<label class="class-check"><input type="checkbox" name="uTempClass" value="${c.id}">${c.id}반 · ${esc(c.course)}</label>`).join('')}</div><div class="mini-note">다른 담임 부재 시 대신 확인·입력해야 하는 반만 선택합니다.</div></div></div><div class="actions"><button id="saveUser" class="btn btn-primary">권한 저장</button></div><div class="table-wrap"><table><thead><tr><th>이름</th><th>계정</th><th>권한</th><th>기본 담당반</th><th>임시 담당반</th><th></th></tr></thead><tbody>${users.map(u=>{const primary=teacherPrimaryClassId(u),temps=teacherTemporaryClassIds(u);return `<tr><td>${esc(u.name||'')}</td><td>${esc(u.email)}</td><td><span class="badge ${u.role==='ADMIN'?'badge-admin':'badge-teacher'}">${u.role==='ADMIN'?'운영자':'담임'}</span></td><td>${u.role==='TEACHER'?(primary?`${esc(primary)}반`:'미설정'):'전체'}</td><td>${u.role==='TEACHER'?(temps.length?temps.map(id=>`${esc(id)}반`).join(', '):'-'):'-'}</td><td><button class="btn btn-danger delUser" data-email="${esc(u.email)}" ${ADMINS.includes(u.email)?'disabled':''}>삭제</button></td></tr>`}).join('')}</tbody></table></div></section>`;
  const role=document.getElementById('uRole'),primaryField=document.getElementById('primaryClassField'),tempField=document.getElementById('tempClassField'),primarySelect=document.getElementById('uPrimaryClass');
  const syncTemp=()=>{const primary=String(primarySelect.value);document.querySelectorAll('input[name="uTempClass"]').forEach(x=>{x.disabled=String(x.value)===primary;if(x.disabled)x.checked=false})};
  role.onchange=()=>{const show=role.value==='TEACHER';primaryField.style.display=show?'flex':'none';tempField.style.display=show?'flex':'none'};primarySelect.onchange=syncTemp;syncTemp();
  document.getElementById('saveUser').onclick=async()=>{const email=document.getElementById('uEmail').value.trim().toLowerCase(),name=document.getElementById('uName').value.trim(),r=role.value,primary=r==='TEACHER'?String(primarySelect.value):null,tempClassIds=r==='TEACHER'?[...document.querySelectorAll('input[name="uTempClass"]:checked')].map(x=>String(x.value)).filter(x=>x!==primary):[],classIds=r==='TEACHER'?[primary,...tempClassIds]:[];if(!email.includes('@'))return alert('이메일을 확인해 주세요.');if(r==='TEACHER'&&!primary)return alert('기본 담당반을 선택해 주세요.');await setDoc(doc(db,'users',email),{name,role:r,active:true,classId:primary,primaryClassId:primary,tempClassIds,classIds},{merge:true});toast('권한 저장 완료');userAdmin(user,p)};
  document.querySelectorAll('.delUser').forEach(b=>b.onclick=async()=>{const email=b.dataset.email;if(ADMINS.includes(email))return;if(confirm('권한을 삭제할까요?')){await deleteDoc(doc(db,'users',email));toast('삭제 완료');userAdmin(user,p)}})
}'''
s=s[:start]+new_user+s[end:]

p.write_text(s,encoding='utf-8')
print('patched basic vs temporary teacher access')
