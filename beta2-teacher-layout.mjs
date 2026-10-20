// 2기 담임 화면(담임 로그인·관리자 미리보기 공통): 하루 업무 순서대로 6개 탭. 시간표·강의자료·만족도는 cohort.json features가 켜질 때까지 '11월 중에 열립니다'로 감춥니다.
// 출결판·사유·반 정보는 teacher-beta.js 한 개를 띄워 두고 탭에 따라 옮겨 씁니다(마스터시트 읽기 1번).
// 2026-10-16 회의: 학습자 평가·현장운영 체크리스트는 없앴고, 민원·이슈는 운영팀과 주고받습니다(beta2-voc.mjs, 운영팀 답글 알림).
// 2026-10-19 담임 화면 다듬기: 하위 탭 줄은 지금 큰 탭 것만(예전에는 .b2-tabs의 display:flex가 hidden을 이겨 출결 하위 탭이 다른 탭에 남음),
// 머리말 '오늘 · 날짜 · 반 이름'과 한 줄 안내, 주소 #t/큰탭/하위탭으로 새로고침·뒤로가기·바로 열기, 불러오기 실패는 쉬운 말과 '다시 시도'.
import {createBeta2Client,onBeta2Rev} from './beta2-data.mjs';
import {studentStats,diseaseReport} from './beta2-core.mjs';
import {ensureBeta2Css,esc,md,loading,toast} from './beta2-ui.mjs';
import {loadReasonCatalog} from './reason-catalog-store.mjs';
import {feature,DISEASE,classInfo as cohortClass} from './cohort.mjs';
// 탭 → 열림 표시(cohort.json features). 1기 시간표 시드·1기 설문 카탈로그를 쓰던 화면이라 2기 자료가 생길 때까지 닫습니다.
const LATER={'timetable-today':'timetable',timetable:'timetable',materials:'materials',surveys:'surveys'};
// 담임에게는 짧게(관리자 화면의 FEATURE_LATER_TEXT는 1기 자료 이야기라 담임에게 어렵습니다)
const LATER_TEXT='11월 중에 열립니다. 준비되면 운영팀이 안내합니다.';

export const TEACHER_TABS=[['today','오늘 할 일'],['attendance','출결'],['documents','서류 발급'],['feedback','민원·설문'],['schedule','시간표·자료'],['info','우리 반']];
export const TEACHER_SUBS={attendance:[['board','출결판'],['reason','출결 사유'],['stats','출석률'],['evidence','증빙서류'],['disease','질병 인정'],['dropout','중도탈락']],feedback:[['voc','민원·이슈'],['surveys','만족도 설문']],schedule:[['timetable','시간표'],['materials','강의자료'],['links','바로가기']]};
// 머리말 아래 한 줄 안내: 이 화면에서 무엇을 하는지(서류 발급·민원은 모듈 머리말 대신 이 줄이 설명합니다)
const HINTS={dropout:'중도탈락·조기취업을 신청하고 처리 상태와 수료 여부를 확인합니다. 판정·서류·수료 처리는 운영팀이 합니다.',notify:'운영팀이 보낸 알림(서류 발급·민원 답글 등)을 봅니다. 누르면 그 화면으로 갑니다.',today:'오늘 출결 숫자를 확인하고, 아래 할 일을 차례로 끝내 주세요.',board:'오늘 출결을 입력합니다. 맨 앞 칸이 오늘입니다.',reason:'지각·결석 등의 사유와 시간이 빠진 곳을 찾아 채웁니다.',stats:'학생별 출석률과 결석·지각 횟수를 봅니다.',evidence:'인정 결석·지각에 필요한 증빙서류가 빠진 학생을 봅니다.',disease:`질병으로 인정받은 횟수를 봅니다(${DISEASE.max}회까지 인정).`,
 documents:'교육생에게 필요한 출석부·확인서를 신청합니다. 신청하면 운영팀에 바로 알림이 가고, 처리 상황은 아래 목록에서 봅니다.',voc:'수업·시설·출결 등 운영팀에 알릴 일을 접수하고 답글을 주고받습니다. 운영팀이 답하면 위에 알림이 뜹니다.',surveys:'교육생 만족도 설문 결과를 봅니다.',timetable:'우리 반 전체 시간표를 봅니다.',materials:'강의자료를 열어 봅니다.',links:'자주 쓰는 폴더·양식 바로가기입니다.',info:'반장·부반장·총무·앰버서더(교체는 보궐로 기록)와 교육생 명부(중도탈락·조기취업)를 관리합니다.'};
// 알림함(머리글 종): 탭 줄에는 없는 칸
const NOTIFY_TAB=['notify','알림'];
const BETA_PANES=new Set(['board','reason']),STATUS_VIEWS=new Set(['stats','evidence','disease']);
// 큰 탭·하위 탭 바로잡기: 모르는 큰 탭이면 오늘 할 일, 모르는 하위 탭이면 그 큰 탭의 첫 하위 탭(출결은 출결판)
export function teacherRoute(m,s){if(m==='notify')return ['notify',''];if(!TEACHER_TABS.some(([k])=>k===m))return ['today',''];const subs=TEACHER_SUBS[m];return [m,subs?(subs.some(([k])=>k===s)?s:subs[0][0]):''];}
// 주소 #t/큰탭/하위탭 ↔ 화면(오늘 할 일은 주소 끝을 비웁니다)
export const routeFromHash=hash=>{const [t,m,s]=String(hash||'').replace(/^#/,'').split('/');return t==='t'?teacherRoute(m,s):['today',''];};
const routeHash=(m,s)=>m==='today'?'':`#t/${m}${s?'/'+s:''}`;
const seoulToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export async function mountBeta2TeacherLayout(parent,{db,user,classInfo,preview=false}){
 ensureBeta2Css();
 const hero=parent.querySelector('.hero');if(!hero)return null;
 const following=[];for(let e=hero.nextElementSibling;e;e=e.nextElementSibling)following.push(e);
 const cls=String(classInfo.id),client=createBeta2Client(user,{db}),known=cohortClass(cls),className=`${cls}반 ${known?known.name:classInfo.course||''}`.trim();
 // 사유 목록(관리자 「사유 목록」, settings/reasonCatalog): 출결판 사유 드롭다운보다 먼저 읽습니다(못 읽으면 기본 목록 + 경고 한 번).
 const reasons=loadReasonCatalog(db,user).then(r=>{if(r.firstWarning)toast(r.warning);}).catch(()=>{});
 const bar=document.createElement('section');bar.className='teacher-context-bar';hero.before(bar);hero.classList.add('teacher-header-class');bar.append(hero);
 // 머리 카드의 반 이름도 머리말과 같은 모양(1반 서울(관악구)_모빌리티 AI_서울대)으로
 const eyebrow=hero.querySelector('.eyebrow'),heroTitle=hero.querySelector('h2');if(eyebrow)eyebrow.textContent='우리 반';if(heroTitle)heroTitle.textContent=className;
 const switcher=parent.querySelector('.preview-controls')||parent.querySelector('.teacher-class-switch');if(switcher){switcher.classList.add('teacher-header-switch');bar.prepend(switcher);}
 const wrap=document.createElement('div');wrap.className='b2 t2';bar.after(wrap);
 wrap.innerHTML=`<div class="b2-alertbar" id="t2Alert" hidden></div><div class="b2-vocbar" id="t2Voc" hidden></div><nav class="b2-tabs t2-main" role="tablist" aria-label="담임 업무 메뉴">${TEACHER_TABS.map(([k,l])=>`<button type="button" class="b2-tab" role="tab" data-main="${k}" aria-selected="false">${l}</button>`).join('')}</nav><nav class="b2-tabs t2-sub" id="t2Sub" role="tablist" aria-label="세부 메뉴" hidden></nav><header class="t2-head" id="t2Head"><h2></h2><p class="t2-ctx"></p><p class="t2-hint"></p></header>${TEACHER_TABS.map(([k])=>`<section data-panel="${k}" role="tabpanel" hidden></section>`).join('')}<section data-panel="notify" role="tabpanel" hidden></section>`; // notify: 머리글 종으로 여는 알림함(탭 줄에는 없음)
 const $=s=>wrap.querySelector(s),panel=k=>wrap.querySelector(`[data-panel="${k}"]`),head=$('#t2Head');
 // 담임 홈 화면 조각(오늘 할 일·공지·바로가기)은 핸들러를 유지한 채 옮깁니다. 시간표는 아직 닫혀 있어 할 일 아래로 둡니다.
 const tasks=following.find(e=>e.classList.contains('task-grid')),taskHead=tasks?.previousElementSibling,notice=following.find(e=>e.classList.contains('notice')),noticeHead=notice?.previousElementSibling,urgent=parent.querySelector('.urgent-stack');
 const today=panel('today');
 today.innerHTML='<div id="t2Urgent"></div><div data-slot="today" id="t2Beta_today"></div><div id="t2Tasks"></div><div class="b2-head t2-section"><div><h3>오늘 시간표</h3></div></div><div id="t2Timetable"></div><details class="b2-card b2-pad" id="t2Notice" style="margin-top:12px"><summary><b>일일 업무 체크리스트 · 공지</b></summary></details>';
 if(urgent)today.querySelector('#t2Urgent').append(urgent);
 if(taskHead)today.querySelector('#t2Tasks').append(taskHead);if(tasks)today.querySelector('#t2Tasks').append(tasks);
 if(notice){const d=today.querySelector('#t2Notice');if(noticeHead)noticeHead.remove();d.append(notice);}
 const links=document.createElement('div');for(const e of following)if(![tasks,taskHead,notice,noticeHead].includes(e))links.append(e);
 panel('documents').innerHTML='<div data-slot="documents" id="t2Docs"></div>';
 for(const [k,subs] of Object.entries(TEACHER_SUBS))panel(k).innerHTML=subs.map(([s])=>`<div data-sub="${s}" hidden></div>`).join('');
 panel('info').innerHTML='<div data-slot="officers"></div><div data-slot="info"></div>'; // 반 임원(beta2-officers.mjs, 2026-10-20) 위, teacher-beta.js 명부 아래
 panel('notify').innerHTML='<div data-slot="notify"></div>'; // 알림함 칸(60f364a에서 위 줄 주석 뒤로 붙어 빠졌던 것을 되살림, 2026-10-20)
 wrap.querySelector('[data-sub="links"]').append(links);

 const works=[],loaded=new Set(),tries={};let main='',sub='',beta=null,betaWait=null,status=null,statusWait=null,disposed=false;
 const betaHost=document.createElement('div'),statusHost=document.createElement('div');
 const alive=()=>!disposed&&wrap.isConnected;
 const keep=w=>{if(w)works.push(w);return w;};
 const slotOf=(m,s)=>m==='today'?today.querySelector('[data-slot="today"]'):s?panel(m).querySelector(`[data-sub="${s}"]`):panel(m).querySelector(`[data-slot="${m}"]`);
 // teacher-beta.js가 보여 줄 하위 화면(오늘·출결판·출결 사유·반 정보). 아니면 ''
 const betaTab=()=>main==='today'||main==='info'?main:main==='attendance'&&BETA_PANES.has(sub)?sub:'';
 // 한 번 실패한 파일은 브라우저가 실패를 기억할 수 있어 '다시 시도'는 주소 끝을 바꿔 새로 받습니다.
 const fresh=(path,key)=>tries[key]?`${path}${path.includes('?')?'&':'?'}retry=${tries[key]}`:path;
 function failed(slot,e,key){
  slot.querySelector(':scope>.t2-fail')?.remove();
  const box=document.createElement('div');box.className='b2-note err t2-fail';box.dataset.key=key;
  box.innerHTML=`<span>이 화면을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 「다시 시도」를 눌러 주세요. 계속 안 되면 운영팀에 알려 주세요.<span class="b2-sub">${esc(e?.message||e)}</span></span><button type="button" class="b2-btn" data-retry="1">다시 시도</button>`;
  slot.append(box);
 }
 async function showBeta(slot){
  slot.append(betaHost);
  if(!beta){
   betaWait||=reasons.then(()=>import(fresh('./teacher-beta.js?v=20261020-du1','beta'))).then(m=>{if(alive())beta=m.mountTeacherBeta(betaHost,{cls:Number(cls),getToken:()=>user.getIdToken(),endpoint:'/api/teacher-beta',hideNav:true,tab:betaTab()||'today',onTab:t=>{if(t==='board'||t==='dropout')void go('attendance',t,{push:true});}});}).catch(e=>{betaWait=null;tries.beta=(tries.beta||0)+1;throw e;});
   await betaWait;
  }
  // 파일을 기다리는 사이 다른 탭으로 옮겼으면 지금 탭을 보여 줍니다(한 화면을 두 번 띄우지 않음).
  const k=betaTab();if(beta&&k)beta.setTab(k);
 }
 async function showStatus(slot){
  slot.append(statusHost);
  if(!status){
   statusWait||=import(fresh('./beta2-status.mjs','status')).then(async m=>{if(alive())status=keep(await m.mount(statusHost,{client,classes:[classInfo],teacherClass:cls,tab:STATUS_VIEWS.has(sub)?sub:'stats',hideTabs:true}));}).catch(e=>{statusWait=null;tries.status=(tries.status||0)+1;throw e;});
   await statusWait;
  }
  if(status&&STATUS_VIEWS.has(sub))status.setView(sub);
 }
 const MOUNTS={
  'timetable-today':['./timetable.mjs?v=20261020-tp2',(m,slot)=>m.mountTeacherTimetable(slot,{db,user,classInfo,client,compact:true,includeSurveys:false})],
  timetable:['./timetable.mjs?v=20261020-tp2',(m,slot)=>m.mountTeacherTimetable(slot,{db,user,classInfo,client,includeSurveys:false})],
  materials:['./lecture-materials.mjs',(m,slot)=>m.mountLectureMaterials(slot,{db,user,classes:[classInfo],teacherClass:classInfo,readOnly:true})],
  surveys:['./survey-view.mjs',(m,slot)=>m.mountSurveys(slot,{db,user,classes:[classInfo],teacherClass:classInfo})],
  documents:['./beta2-docs.mjs',(m,slot)=>m.mount(slot,{client,classes:[classInfo],teacherClass:cls})],
  dropout:['./beta2-dropouts.mjs?v=20261020-dr1',(m,slot)=>m.mount(slot,{client,classes:[classInfo],teacherClass:cls,me:user?.email||'',hideHead:true})], // 중도탈락·조기취업 신청(시트 중도탈락 탭, 처리는 운영팀)·수료 확인(보기만), 사용자 2026-10-20
  voc:['./beta2-voc.mjs',(m,slot)=>m.mount(slot,{client,classes:[classInfo],teacherClass:cls,onState:paintVoc})],
  officers:['./beta2-officers.mjs?v=20261020-of1',(m,slot)=>m.mount(slot,{client,classes:[classInfo],teacherClass:cls})], // 반 임원 지정·교체(보궐)·끝내기, 자기 반만
  // 공통메모 알림은 출결판으로 가서 그 날짜 공통메모를 판 위에 보입니다(teacher-beta.js showDay).
  notify:['./notify-inbox.mjs',(m,slot)=>m.mount(slot,{onGo:l=>{const [tm,ts]=m.teacherTarget(l.tab,l.params);void go(tm,ts||'',{push:true}).then(()=>{if(ts==='board'&&l.params?.date)beta?.showDay?.(l.params.date);});}})]
 };
 async function load(key,slot){
  const job=MOUNTS[key];if(!job||loaded.has(key))return;loaded.add(key);
  if(LATER[key]&&!feature(LATER[key])){slot.innerHTML=`<div class="b2-note">${esc(LATER_TEXT)}</div>`;return;}
  slot.innerHTML=loading('불러오는 중입니다…');
  try{const m=await import(fresh(job[0],key));if(alive())keep(await job[1](m,slot));}
  catch(e){loaded.delete(key);tries[key]=(tries[key]||0)+1;if(alive()){slot.innerHTML='';failed(slot,e,key);}}
 }
 // 탭 줄·화면·머리말을 지금 상태에 맞춥니다(기다리는 일 없이 바로).
 function paint(){
  wrap.querySelectorAll('[data-main]').forEach(b=>{const on=b.dataset.main===main;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
  wrap.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==main;});
  // 하위 탭 줄은 지금 큰 탭 것만 그립니다. 하위 탭이 없는 큰 탭이면 비우고 숨깁니다(beta2.css의 [hidden] 규칙과 함께).
  const subs=TEACHER_SUBS[main]||[],nav=$('#t2Sub');
  if(nav.dataset.tabsOf!==main){nav.dataset.tabsOf=main;nav.innerHTML=subs.map(([k,l])=>`<button type="button" class="b2-tab" role="tab" data-subtab="${k}">${l}</button>`).join('');}
  nav.querySelectorAll('[data-subtab]').forEach(b=>{const on=b.dataset.subtab===sub;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
  nav.hidden=!subs.length;
  if(subs.length)panel(main).querySelectorAll('[data-sub]').forEach(d=>{d.hidden=d.dataset.sub!==sub;});
  // 머리말은 지금 큰 탭 화면 맨 위로 옮깁니다: 화면 이름 / 오늘 · 날짜 · 반 이름 / 한 줄 안내
  panel(main).prepend(head);
  head.querySelector('h2').textContent=(subs.find(([k])=>k===sub)||[...TEACHER_TABS,NOTIFY_TAB].find(([k])=>k===main))[1];
  head.querySelector('.t2-ctx').textContent=`오늘 · ${md(seoulToday())} · ${className}`;
  head.querySelector('.t2-hint').textContent=HINTS[sub||main]||'';
 }
 // 주소: 담임 화면은 탭을 누를 때마다 기록을 남겨 뒤로가기로 앞 탭에 갑니다. 관리자 미리보기는 기록을 늘리지 않고 주소만 바꿉니다.
 function remember(push){
  const h=routeHash(main,sub);if((location.hash||'')===h)return;
  const url=location.pathname+location.search+h;
  if(push&&!preview)history.pushState(history.state,'',url);else history.replaceState(history.state,'',url);
 }
 async function go(m,s,{push=false}={}){
  if(!alive())return;
  [main,sub]=teacherRoute(m,s);paint();remember(push);
  const slot=slotOf(main,sub);slot.querySelector(':scope>.t2-fail')?.remove();
  if(main==='info')void load('officers',panel('info').querySelector('[data-slot="officers"]'));
  try{
   if(betaTab())await showBeta(slot);
   else if(STATUS_VIEWS.has(sub))await showStatus(slot);
   else await load(main==='documents'||main==='notify'?main:sub,slot);
  }catch(e){if(alive())failed(slot,e,'');}
  if(main==='today')await load('timetable-today',today.querySelector('#t2Timetable'));
 }
 const onAddress=()=>{const [m,s]=routeFromHash(location.hash);if(m!==main||s!==sub)void go(m,s);};
 addEventListener('popstate',onAddress);addEventListener('hashchange',onAddress);
 wrap.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.main)void go(b.dataset.main,'',{push:true});
  if(b.dataset.subtab)void go(main,b.dataset.subtab,{push:true});
  if(b.dataset.alertGo)void go('attendance','disease',{push:true});
  if(b.dataset.vocGo)void go('feedback','voc',{push:true});
  if(b.dataset.retry){b.closest('.t2-fail')?.remove();void go(main,sub);}
 });
 // 탭 줄에서 ←·→ 키로 옆 탭으로 옮깁니다.
 wrap.addEventListener('keydown',e=>{
  const b=e.target.closest('[role="tab"]');if(!b||!['ArrowLeft','ArrowRight'].includes(e.key))return;
  const list=[...b.parentElement.querySelectorAll('[role="tab"]')],next=list[(list.indexOf(b)+(e.key==='ArrowRight'?1:list.length-1))%list.length];
  e.preventDefault();next.click();next.focus();
 });
 // 운영팀 민원·이슈 답글 알림: 변경 번호 응답(b2Rev의 voc, 시트를 읽지 않음)에 이 반 건수가 옵니다. 1분마다 확인합니다(다른 화면이 방금 확인했으면 그 값).
 function paintVoc(state){
  if(!alive())return;const n=+(state?.teacher||{})[cls]||0,el=$('#t2Voc');el.hidden=!n;
  el.innerHTML=n?`<span>운영팀이 민원·이슈에 답글을 남겼습니다 · ${n}건</span><button type="button" data-voc-go="1">보기</button>`:'';
 }
 const offVoc=onBeta2Rev(r=>paintVoc(r?.voc));
 const vocTimer=setInterval(()=>{if(alive()&&!document.hidden)client.rev().catch(()=>{});},60000);
 client.rev().catch(()=>{});
 // 질병 인정 경고: 4회 이상이면 모든 탭 위에 띄웁니다(출결원장 기준, 체크히어 메모와 다르면 함께 표시).
 (async()=>{try{
  const [b,ch]=await Promise.all([client.bundle(cls),client.checkhereDisease([cls]),reasons]);if(!alive())return; // 질병 판정도 사유 목록을 따름
  const report=diseaseReport(studentStats(b,{cls}),ch),el=$('#t2Alert');
  if(!report.rows.length&&!report.review.length)return;
  el.hidden=false;el.classList.toggle('hard',report.rows.some(r=>r.count>=6));
  el.innerHTML=`<span>⚠ 질병 인정 ${report.rows.length?report.rows.map(r=>`${esc(r.name)} ${r.count}/6회${r.count>6?' 초과':r.count===6?' 도달':''}`).join(' · '):'4회 이상 없음'}${report.review.length?` · 체크히어 메모와 다른 날 ${report.review.length}명 확인 필요`:''}</span><button type="button" data-alert-go="1">자세히</button>`;
 }catch{}})();
 // 알림함: 머리글 종(index.html)이 'hint:notify-open'을 보내면 알림 칸을 엽니다(사용자 요청 2026-10-19). 주소는 #t/notify.
 const openNotify=()=>void go('notify','',{push:true});document.addEventListener('hint:notify-open',openNotify);
 const dispose=()=>{
  if(disposed)return;disposed=true;observer.disconnect();offVoc();clearInterval(vocTimer);removeEventListener('popstate',onAddress);removeEventListener('hashchange',onAddress);document.removeEventListener('hint:notify-open',openNotify);works.forEach(w=>w?.dispose?.());
  // 미리보기를 떠나면 담임 탭 주소(#t/…)를 지웁니다(관리자 화면 주소에 남지 않게).
  if(preview&&/^#t\//.test(location.hash))history.replaceState(history.state,'',location.pathname+location.search);
 };
 const observer=new MutationObserver(()=>{if(!wrap.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
 const [m0,s0]=routeFromHash(location.hash);await go(m0,s0);
 return {canLeave:()=>works.every(w=>!w?.canLeave||w.canLeave()),dispose};
}
