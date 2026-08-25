from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

if 'MULTI_CLASS_TEACHER_V1' in s:
    print('multi-class teacher patch already applied')
    raise SystemExit(0)

css='''.teacher-class-switch{margin-bottom:14px;padding:14px 16px;display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap}.teacher-class-switch .field{min-width:260px}.teacher-class-switch .hint{font-size:12px;color:#64748b}.class-check-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}.class-check{display:flex;align-items:center;gap:7px;padding:9px 10px;border:1px solid #dbe3ee;border-radius:10px;background:#fff;font-size:12px;font-weight:800}.class-check input{margin:0}@media(max-width:760px){.class-check-grid{grid-template-columns:repeat(2,1fr)}.teacher-class-switch .field{min-width:0;width:100%}}'''
s=s.replace('</style>',css+'</style>',1)

helper=r'''// MULTI_CLASS_TEACHER_V1
function teacherClassIds(profile){
  const valid=new Set(CLASSES.map(c=>String(c.id)));
  const preferred=String(profile?.primaryClassId||profile?.classId||'');
  const raw=[preferred,...(Array.isArray(profile?.classIds)?profile.classIds:[]),profile?.classId].map(x=>String(x||'')).filter(x=>valid.has(x));
  return [...new Set(raw)];
}
function userAssignedClassIds(profile){return teacherClassIds(profile)}
'''
anchor='async function teacherView(user,p)'
idx=s.find(anchor)
if idx<0: raise SystemExit('teacherView anchor not found')
s=s[:idx]+helper+s[idx:]

start=s.find('async function teacherView(user,p)')
end=s.find('\nfunction linkModal',start)
if start<0 or end<0: raise SystemExit('teacherView boundaries not found')
new_teacher=r'''async function teacherView(user,p,selectedClassId=null){try{
  const allowed=teacherClassIds(p);
  if(!allowed.length)return shell(user,`<div class="card empty">담당 반 설정이 없습니다.</div>`);
  const selected=allowed.includes(String(selectedClassId||''))?String(selectedClassId):allowed[0];
  const cr=await getDoc(doc(db,'classes',selected));
  if(!cr.exists())return shell(user,`<div class="card empty">담당 반 설정이 없습니다.</div>`);
  const c={...classMeta(selected),...cr.data(),id:selected},sr=await getDoc(doc(db,'settings','global')),settings=sr.exists()?{...DEFAULTS,...sr.data()}:DEFAULTS,lr=await getDocs(collection(db,'classes',c.id,'customLinks')),links=lr.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>((a.createdAt?.seconds||0)-(b.createdAt?.seconds||0))),core={...EMPTY,...(c.coreLinks||{})},textbook=core.textbook||((c.course||'').includes('제조지능화')?settings.manufacturingTextbook:''),forms=core.forms||settings.officialForms,docReq=core.documentRequest||settings.documentRequest;
  const classSwitcher=allowed.length>1?`<section class="card teacher-class-switch"><div><strong>담당 반 선택</strong><div class="hint">현재 계정에 권한이 부여된 반만 표시됩니다.</div></div><div class="field"><label>현재 반</label><select id="teacherClassSelect">${allowed.map(id=>{const m=classMeta(id);return `<option value="${id}" ${id===selected?'selected':''}>${id}반 · ${esc(m.course||'')}</option>`}).join('')}</select></div></section>`:'';
  const urgentHtml=`<div class="urgent-stack">${settings.commonUrgentActive&&String(settings.commonUrgentText||'').trim()?`<div class="urgent-alert urgent-common"><strong>🚨 전체 긴급 요청</strong><div class="urgent-text">${esc(settings.commonUrgentText)}</div></div>`:''}${c.urgentActive&&String(c.urgentText||'').trim()?`<div class="urgent-alert urgent-class"><strong>🚨 ${esc(c.id)}반 긴급 요청</strong><div class="urgent-text">${esc(c.urgentText)}</div></div>`:''}</div>`;
  const tasks=[['1','출결현황 · 운영체크','출결현황과 현장운영 체크리스트를 입력합니다.',c.sheetUrl,'시트 바로가기'],['2','수기출석본','수기출석 스캔본 업로드',core.manualAttendance,'폴더 열기'],['3','교육사진','강의·실습 사진 업로드',core.photos,'폴더 열기'],['4','운영모니터링','학생 인터뷰 등 운영일지',core.monitoring,'설문 바로가기'],['5','출결인정자료','결석·지각·조퇴·외출 인정자료',core.recognition,'폴더 열기']];
  shell(user,`${classSwitcher}${urgentHtml}${heroTeacher(c,p)}<div class="section-head"><div><h2>오늘 꼭 할 일</h2><p>기본 링크는 운영자만 수정할 수 있습니다.</p></div></div><section class="task-grid">${tasks.map(t=>`<article class="card task">${String(t[0])==='2'?`<div class="num-row"><div class="num">${t[0]}</div><span class="manual-missing-inline" data-folder-id="${esc(driveFolderId(t[3]))}"></span></div>`:`<div class="num">${t[0]}</div>`}<h3>${esc(t[1])}${uploadBadge(t[0],t[3])}</h3><p>${esc(t[2])}</p>${taskButtons(t[0],t[3],t[4])}</article>`).join('')}</section><div class="section-head"><div><h2>필요할 때 바로가기</h2></div></div><section class="quick-grid">${[['서류발급요청','국취제 등',docReq],['교재 확인','담당 과정 교재',textbook],['필요 양식','HINT 공식 양식',forms],['내 반 드라이브','최상위 폴더',core.topDrive]].map(x=>`<button class="card quick" data-open="${esc(good(x[2]))}" ${good(x[2])?'':'disabled'}><div><strong>${esc(x[0])}</strong><small>${good(x[2])?esc(x[1]):'관리자 등록 필요'}</small></div><span class="arrow">›</span></button>`).join('')}</section><div class="section-head"><div><h2>우리 반 추가 바로가기</h2><p>담임이 자기 반에 필요한 버튼을 자유롭게 추가할 수 있습니다.</p></div><button id="addLink" class="btn btn-dark">+ 바로가기 추가</button></div>${links.length?`<section class="custom-grid">${links.map(x=>`<article class="card custom-link"><h3>${esc(x.title)}</h3><p class="muted">${esc(x.description||'추가 바로가기')}</p>${button(x.url,'바로가기')}<div class="link-actions"><button class="btn btn-ghost editLink" data-id="${esc(x.id)}">수정</button><button class="btn btn-danger delLink" data-id="${esc(x.id)}">삭제</button></div></article>`).join('')}</section>`:`<div class="card empty">추가 바로가기가 없습니다.</div>`}<div class="section-head"><h2>매일 공지</h2></div><section class="card notice"><div class="notice-bar"><strong>담임 대상 공지문</strong><button id="copyNotice" class="btn btn-soft">공지 복사</button></div><div class="notice-box">${esc(settings.notice)}</div></section><p class="help">${esc(settings.helpText||'')}</p>`);
  const selector=document.getElementById('teacherClassSelect');if(selector)selector.onchange=e=>teacherView(user,p,e.target.value);
  bindOpen();document.querySelectorAll('.guideBtn').forEach(b=>b.onclick=showGuideModal);document.querySelectorAll('.missingDatesBtn').forEach(b=>b.onclick=async()=>{if(b.disabled)return;const t=b.textContent;b.disabled=true;b.textContent='확인 중…';try{await showMissingDatesModal(b.dataset.folderId,b.dataset.taskLabel)}finally{if(document.body.contains(b)){b.disabled=false;b.textContent=t}}});refreshUploadBadges(document,localDateKey());refreshManualMissingInline(document);document.getElementById('copyNotice').onclick=()=>navigator.clipboard.writeText(settings.notice).then(()=>toast('공지문 복사 완료'));document.getElementById('addLink').onclick=()=>linkModal(c.id,p,null,()=>teacherView(user,p,c.id));document.querySelectorAll('.editLink').forEach(b=>b.onclick=()=>linkModal(c.id,p,links.find(x=>x.id===b.dataset.id),()=>teacherView(user,p,c.id)));document.querySelectorAll('.delLink').forEach(b=>b.onclick=async()=>{if(confirm('삭제할까요?')){await deleteDoc(doc(db,'classes',c.id,'customLinks',b.dataset.id));toast('삭제 완료');teacherView(user,p,c.id)}})
}catch(e){fatal(user,'담임 화면을 불러오지 못했습니다.',e)}}'''
s=s[:start]+new_teacher+s[end:]

start=s.find('async function userAdmin(user,p){')
end=s.find('\nasync function settingsAdmin',start)
if start<0 or end<0: raise SystemExit('userAdmin boundaries not found')
new_user=r'''async function userAdmin(user,p){
  const q=await getDocs(collection(db,'users')),users=q.docs.map(d=>({email:d.id,...d.data()})).sort((a,b)=>a.email.localeCompare(b.email));
  document.getElementById('adminBody').innerHTML=`<section class="card panel"><div class="admin-note">담임 계정에는 여러 반을 동시에 부여할 수 있습니다. 한 반만 가진 담임은 기존처럼 바로 진입하고, 두 반 이상이면 담임 화면에서 반을 선택합니다.</div><div class="form-grid"><div class="field"><label>이름</label><input id="uName"></div><div class="field"><label>Google 이메일</label><input id="uEmail"></div><div class="field"><label>권한</label><select id="uRole"><option value="TEACHER">담임</option><option value="ADMIN">운영자</option></select></div><div class="field full" id="classField"><label>담당 반 · 복수 선택 가능</label><div class="class-check-grid">${CLASSES.map(c=>`<label class="class-check"><input type="checkbox" name="uClass" value="${c.id}">${c.id}반 · ${esc(c.course)}</label>`).join('')}</div><div class="mini-note">첫 번째로 선택한 반을 기본 반으로 저장합니다.</div></div></div><div class="actions"><button id="saveUser" class="btn btn-primary">권한 저장</button></div><div class="table-wrap"><table><thead><tr><th>이름</th><th>계정</th><th>권한</th><th>담당반</th><th></th></tr></thead><tbody>${users.map(u=>{const ids=userAssignedClassIds(u);return `<tr><td>${esc(u.name||'')}</td><td>${esc(u.email)}</td><td><span class="badge ${u.role==='ADMIN'?'badge-admin':'badge-teacher'}">${u.role==='ADMIN'?'운영자':'담임'}</span></td><td>${u.role==='TEACHER'?(ids.length?ids.map(id=>`${esc(id)}반`).join(', '):'미설정'):'전체'}</td><td><button class="btn btn-danger delUser" data-email="${esc(u.email)}" ${ADMINS.includes(u.email)?'disabled':''}>삭제</button></td></tr>`}).join('')}</tbody></table></div></section>`;
  const role=document.getElementById('uRole'),field=document.getElementById('classField');role.onchange=()=>field.style.display=role.value==='TEACHER'?'flex':'none';
  document.getElementById('saveUser').onclick=async()=>{const email=document.getElementById('uEmail').value.trim().toLowerCase(),name=document.getElementById('uName').value.trim(),r=role.value,classIds=[...document.querySelectorAll('input[name="uClass"]:checked')].map(x=>String(x.value));if(!email.includes('@'))return alert('이메일을 확인해 주세요.');if(r==='TEACHER'&&!classIds.length)return alert('담당 반을 1개 이상 선택해 주세요.');const primary=r==='TEACHER'?classIds[0]:null;await setDoc(doc(db,'users',email),{name,role:r,active:true,classId:primary,primaryClassId:primary,classIds:r==='TEACHER'?classIds:[]},{merge:true});toast('권한 저장 완료');userAdmin(user,p)};
  document.querySelectorAll('.delUser').forEach(b=>b.onclick=async()=>{const email=b.dataset.email;if(ADMINS.includes(email))return;if(confirm('권한을 삭제할까요?')){await deleteDoc(doc(db,'users',email));toast('삭제 완료');userAdmin(user,p)}})
}'''
s=s[:start]+new_user+s[end:]

old="teacher=ur.docs.map(d=>({email:d.id,...d.data()})).find(x=>x.role==='TEACHER'&&x.active!==false&&String(x.classId)===String(c.id))"
new="teacher=ur.docs.map(d=>({email:d.id,...d.data()})).find(x=>x.role==='TEACHER'&&x.active!==false&&userAssignedClassIds(x).includes(String(c.id)))"
if old in s:s=s.replace(old,new,1)
else:print('warning: preview teacher matcher anchor not found')

p.write_text(s,encoding='utf-8')
print('patched multi-class teacher permissions UI')
