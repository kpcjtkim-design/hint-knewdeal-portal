// 2기 베타 담임 화면: 1기 담임 8개 탭과 2기 베타 6개 탭을 하루 업무 순서대로 6개 탭으로 합쳤습니다(관리자 미리보기 전용).
// 출결판·사유·평가·민원·반 정보는 teacher-beta.js 한 개를 띄워 두고 탭에 따라 옮겨 씁니다(마스터시트 읽기 1번).
import {createBeta2Client} from './beta2-data.mjs';
import {studentStats,diseaseReport} from './beta2-core.mjs';
import {ensureBeta2Css,esc} from './beta2-ui.mjs';

export const TEACHER_TABS=[['today','오늘'],['attendance','출결'],['documents','서류발급'],['feedback','평가·민원'],['schedule','시간표·자료'],['info','반 정보']];
export const TEACHER_SUBS={attendance:[['board','출결판'],['reason','출결사유'],['stats','통계'],['evidence','증빙서류'],['disease','질병 인정']],feedback:[['eval','학습자 평가'],['voc','민원·이슈'],['surveys','만족도조사']],schedule:[['timetable','전체 시간표'],['materials','강의자료'],['links','바로가기']]};
const BETA_PANES=new Set(['today','board','reason','eval','voc','info']);

export async function mountBeta2TeacherLayout(parent,{db,user,classInfo}){
 ensureBeta2Css();
 const hero=parent.querySelector('.hero');if(!hero)return null;
 const following=[];for(let e=hero.nextElementSibling;e;e=e.nextElementSibling)following.push(e);
 const cls=String(classInfo.id),client=createBeta2Client(user,{db});
 const bar=document.createElement('section');bar.className='teacher-context-bar';hero.before(bar);hero.classList.add('teacher-header-class');bar.append(hero);
 const switcher=parent.querySelector('.preview-controls');if(switcher){switcher.classList.add('teacher-header-switch');bar.prepend(switcher);}
 const wrap=document.createElement('div');wrap.className='b2';bar.after(wrap);
 wrap.innerHTML=`<div class="b2-alertbar" id="t2Alert" hidden></div><nav class="b2-tabs" aria-label="담임 업무 메뉴">${TEACHER_TABS.map(([k,l])=>`<button class="b2-tab" data-main="${k}">${l}</button>`).join('')}</nav><nav class="b2-tabs" id="t2Sub" hidden></nav>${TEACHER_TABS.map(([k])=>`<section data-panel="${k}" hidden></section>`).join('')}`;
 const $=s=>wrap.querySelector(s),panel=k=>wrap.querySelector(`[data-panel="${k}"]`);
 // 기존 1기 화면 조각(오늘 할 일·공지·바로가기)은 핸들러를 유지한 채 옮깁니다.
 const tasks=following.find(e=>e.classList.contains('task-grid')),taskHead=tasks?.previousElementSibling,notice=following.find(e=>e.classList.contains('notice')),noticeHead=notice?.previousElementSibling,urgent=parent.querySelector('.urgent-stack');
 const today=panel('today');
 today.innerHTML='<div id="t2Urgent"></div><div id="t2Beta_today"></div><div class="b2-head" style="margin-top:14px"><div><h3>오늘 시간표</h3></div></div><div id="t2Timetable"></div><div id="t2Tasks"></div><details class="b2-card b2-pad" id="t2Notice" style="margin-top:12px"><summary><b>일일 업무 체크리스트 · 공지</b></summary></details>';
 if(urgent)today.querySelector('#t2Urgent').append(urgent);
 if(taskHead)today.querySelector('#t2Tasks').append(taskHead);if(tasks)today.querySelector('#t2Tasks').append(tasks);
 if(notice){const d=today.querySelector('#t2Notice');if(noticeHead)noticeHead.remove();d.append(notice);}
 const links=document.createElement('div');for(const e of following)if(![tasks,taskHead,notice,noticeHead].includes(e))links.append(e);
 panel('documents').innerHTML='<div id="t2Docs"></div>';
 for(const [k,subs] of Object.entries(TEACHER_SUBS))panel(k).innerHTML=subs.map(([s])=>`<div data-sub="${s}" hidden></div>`).join('');
 panel('info').innerHTML='<div data-sub="info"></div>';
 wrap.querySelector('[data-sub="links"]').append(links);

 const works=[],loaded=new Set();let main='today',sub='',beta=null,status=null,disposed=false;
 const betaHost=document.createElement('div');
 const alive=()=>!disposed&&wrap.isConnected;
 const keep=w=>{if(w)works.push(w);return w;};
 async function betaPane(k,slot){
  slot.append(betaHost);
  if(!beta){const m=await import('./teacher-beta.js?v=20261013-b2');if(!alive())return;beta=m.mountTeacherBeta(betaHost,{cls:Number(cls),getToken:()=>user.getIdToken(),endpoint:'/api/teacher-beta',hideNav:true,tab:k,onTab:t=>{if(t==='board')void go('attendance','board');}});}
  else beta.setTab(k);
 }
 async function load(key,slot){
  if(loaded.has(key))return;loaded.add(key);
  try{
   if(key==='timetable-today'){const m=await import('./timetable.mjs');if(alive())keep(await m.mountTeacherTimetable(slot,{db,user,classInfo,compact:true,includeSurveys:false}));}
   if(key==='timetable'){const m=await import('./timetable.mjs');if(alive())keep(await m.mountTeacherTimetable(slot,{db,user,classInfo,includeSurveys:false}));}
   if(key==='materials'){const m=await import('./lecture-materials.mjs');if(alive())keep(await m.mountLectureMaterials(slot,{db,user,classes:[classInfo],teacherClass:classInfo,readOnly:true}));}
   if(key==='surveys'){const m=await import('./survey-view.mjs');if(alive())keep(await m.mountSurveys(slot,{db,user,classes:[classInfo],teacherClass:classInfo}));}
   if(key==='documents'){const m=await import('./beta2-docs.mjs');if(alive())keep(await m.mount(slot,{client,classes:[classInfo],teacherClass:cls}));}
  }catch(e){loaded.delete(key);if(alive())slot.textContent='화면을 불러오지 못했습니다. '+e.message;}
 }
 async function go(m,s){
  if(!alive())return;main=m;sub=s||TEACHER_SUBS[m]?.[0]?.[0]||'';
  wrap.querySelectorAll('[data-main]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.main===main)));
  wrap.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==main;});
  const subs=TEACHER_SUBS[main],nav=$('#t2Sub');nav.hidden=!subs;
  if(subs){nav.innerHTML=subs.map(([k,l])=>`<button class="b2-tab" data-subtab="${k}" aria-selected="${k===sub}">${l}</button>`).join('');panel(main).querySelectorAll('[data-sub]').forEach(d=>{d.hidden=d.dataset.sub!==sub;});}
  if(main==='today'){await betaPane('today',today.querySelector('#t2Beta_today'));await load('timetable-today',today.querySelector('#t2Timetable'));return;}
  if(main==='documents'){await load('documents',panel('documents').querySelector('#t2Docs'));return;}
  if(main==='info'){await betaPane('info',panel('info').querySelector('[data-sub="info"]'));return;}
  const slot=panel(main).querySelector(`[data-sub="${sub}"]`);
  if(BETA_PANES.has(sub)){await betaPane(sub,slot);return;}
  if(['stats','evidence','disease'].includes(sub)){
   slot.append(statusHost);
   if(!status){const m=await import('./beta2-status.mjs');if(!alive())return;status=keep(await m.mount(statusHost,{client,classes:[classInfo],teacherClass:cls,tab:sub,hideTabs:true}));}else status.setView(sub);
   return;
  }
  await load(sub,slot);
 }
 const statusHost=document.createElement('div');
 wrap.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.main)void go(b.dataset.main);if(b.dataset.subtab)void go(main,b.dataset.subtab);if(b.dataset.alertGo)void go('attendance','disease');});
 // 질병 인정 경고: 4회 이상이면 모든 탭 위에 띄웁니다(출결원장 기준, 체크히어 메모와 다르면 함께 표시).
 (async()=>{try{
  const [b,ch]=await Promise.all([client.bundle(cls),client.checkhereDisease([cls])]);if(!alive())return;
  const report=diseaseReport(studentStats(b,{cls}),ch),el=$('#t2Alert');
  if(!report.rows.length&&!report.review.length)return;
  el.hidden=false;el.classList.toggle('hard',report.rows.some(r=>r.count>=6));
  el.innerHTML=`<span>⚠ 질병 인정 ${report.rows.length?report.rows.map(r=>`${esc(r.name)} ${r.count}/6회${r.count>6?' 초과':r.count===6?' 도달':''}`).join(' · '):'4회 이상 없음'}${report.review.length?` · 체크히어 메모와 다른 날 ${report.review.length}명 확인 필요`:''}</span><button data-alert-go="1">자세히</button>`;
 }catch{}})();
 await go('today');
 const dispose=()=>{if(disposed)return;disposed=true;observer.disconnect();works.forEach(w=>w?.dispose?.());};
 const observer=new MutationObserver(()=>{if(!wrap.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
 return {canLeave:()=>works.every(w=>!w?.canLeave||w.canLeave()),dispose};
}
