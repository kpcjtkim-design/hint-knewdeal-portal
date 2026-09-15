export async function mountTeacherWorkspace(parent,{db,user,classInfo,preview=false}){
 const hero=parent.querySelector('.hero');if(!hero)return;
 const following=[];for(let e=hero.nextElementSibling;e;e=e.nextElementSibling)following.push(e);
 const nav=document.createElement('nav');nav.className='admin-tabs teacher-tabs';nav.setAttribute('aria-label','담임 업무 메뉴');
 const labels={home:'우리 반 홈',timetable:'전체 시간표',attendance:'출결 통계',surveys:'만족도조사',materials:'강의자료',resources:'자료·바로가기'};
 nav.innerHTML=Object.entries(labels).map(([id,label])=>`<button class="tab" data-teacher-tab="${id}">${label}</button>`).join('');hero.after(nav);
 // Move existing nodes, including the class selector, so their handlers stay attached.
 let classHeader=!preview&&parent.querySelector('.topbar');
 if(!classHeader){classHeader=document.createElement('section');classHeader.className='teacher-context-bar';hero.before(classHeader);}
 else classHeader.classList.add('teacher-topbar');
 hero.classList.add('teacher-header-class');
 const actions=classHeader.querySelector('.top-actions');
 classHeader.insertBefore(hero,actions||null);
 const switcher=parent.querySelector(preview?'.preview-controls':'.teacher-class-switch');
 if(switcher){switcher.classList.add('teacher-header-switch');(actions||classHeader).prepend(switcher);}
 const panels={};for(const id of Object.keys(labels)){const panel=document.createElement('section');panel.dataset.teacherPanel=id;panel.hidden=true;panels[id]=panel;nav.after(panel);}
 // Retain existing task/link nodes and their handlers instead of rebuilding them.
 const tasks=following.find(e=>e.classList.contains('task-grid')),taskHead=tasks?.previousElementSibling;
 const notice=following.find(e=>e.classList.contains('notice')),noticeHead=notice?.previousElementSibling;
 for(const e of following){if(e===notice||e===noticeHead)continue;if(e===taskHead||e===tasks)panels.home.append(e);else panels.resources.append(e);}
 const today=document.createElement('section'),announcements=document.createElement('section');announcements.className='teacher-announcements';announcements.setAttribute('aria-label','공지');
 if(noticeHead){const heading=noticeHead.querySelector('h2');if(heading)heading.textContent='공지';announcements.append(noticeHead);}
 const urgent=parent.querySelector('.urgent-stack');if(urgent)announcements.append(urgent);
 if(notice){
  const checklist=document.createElement('details');checklist.className='card daily-checklist';
  const summary=document.createElement('summary');summary.textContent='일일 업무 체크리스트';
  const title=notice.querySelector('.notice-bar strong');if(title)title.hidden=true;
  const copy=notice.querySelector('#copyNotice');if(copy)copy.textContent='체크리스트 복사';
  checklist.append(summary,notice);announcements.append(checklist);
 }
 panels.home.prepend(today,announcements);
 const attendance=document.createElement('section'),surveys=document.createElement('section');attendance.className=surveys.className='card panel';attendance.style.marginTop=surveys.style.marginTop='18px';panels.home.append(attendance,surveys);
 const works=[],loaded=new Set(['home','resources']);let active='home',disposed=false;
 async function show(id){if(disposed)return;active=id;Object.entries(panels).forEach(([key,p])=>{p.hidden=key!==id;p.style.display=key===id?'':'none';});nav.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.teacherTab===id));if(loaded.has(id))return;loaded.add(id);const host=panels[id];host.textContent='불러오는 중…';try{
  let work;const options={db,user,classes:[classInfo],teacherClass:classInfo};
  if(id==='timetable'){const m=await import('./timetable.mjs');host.textContent='';work=await m.mountTeacherTimetable(host,{db,user,classInfo,includeSurveys:false});}
  if(id==='attendance'){const m=await import('./attendance-statistics.mjs');host.textContent='';work=await m.mountAttendanceStatistics(host,options);}
  if(id==='surveys'){const m=await import('./survey-view.mjs');host.textContent='';work=await m.mountSurveys(host,options);}
  if(id==='materials'){const m=await import('./lecture-materials.mjs');host.textContent='';work=await m.mountLectureMaterials(host,{...options,readOnly:preview});}
  if(work){if(disposed)work.dispose?.();else works.push(work);}
 }catch(e){host.textContent='화면을 불러오지 못했습니다. '+e.message;loaded.delete(id);}}
 nav.querySelectorAll('button').forEach(b=>b.onclick=()=>void show(b.dataset.teacherTab));void show('home');
 const options={db,user,classes:[classInfo],teacherClass:classInfo,compact:true};
 await Promise.allSettled([
  import('./timetable.mjs').then(m=>m.mountTeacherTimetable(today,{db,user,classInfo,compact:true,includeSurveys:false})),
  import('./attendance-statistics.mjs').then(m=>m.mountAttendanceStatistics(attendance,{...options,onMore:()=>show('attendance')})),
  import('./survey-view.mjs').then(m=>m.mountSurveys(surveys,{...options,onMore:()=>show('surveys')}))
 ].map(p=>p.then(w=>{if(w)works.push(w);}))).then(results=>{results.forEach((r,i)=>{if(r.status==='rejected')[today,attendance,surveys][i].textContent='요약 조회 실패 · '+r.reason.message;});});
 const dispose=()=>{disposed=true;works.forEach(w=>w.dispose?.());observer.disconnect();};const observer=new MutationObserver(()=>{if(!parent.isConnected||!nav.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});return{dispose};
}
