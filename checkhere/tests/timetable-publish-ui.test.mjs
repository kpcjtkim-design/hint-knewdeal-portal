import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
// 사용자 2026-10-20 '담임 화면에서 시간표가 안뜸 … 담임 공개도 같이 되게 해줘':
// 마스터시트를 못 읽을 때(여기서는 시트 연결 없음): 공개본이 없으면 담임은 엑셀 원본을 보고, 관리자가 저장하면 담임 공개본도 함께 씁니다.
test('sheet unreadable: teacher falls back to published then the Excel base schedule; admin saves also publish',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 const lecture={id:'L1',course:'모빌리티 AI',module:'디지털스킬',title:'디지털스킬',days:2};
 const row=(cid,n,date,day)=>({id:`x2-${cid}-${date}`,date,course:lecture.course,module:lecture.module,lectureId:lecture.id,title:lecture.title,day,hours:8,start:'',end:'',instructorId:'',instructorName:'조해정',venue:'',online:false,note:'',kind:'class',origin:{subject:'both'},sourceRow:n,sourceText:lecture.title});
 const seed={cohort:'2',version:'20261014',source:'fixture.xlsx',start:'2026-10-28',end:'2027-01-22',courses:[lecture.course],modules:[lecture.module],lectures:[lecture],classes:{'1':{classId:'1',revision:0,entries:[row('1',9,'2026-10-28',1),row('1',10,'2026-10-29',2)]},'2':{classId:'2',revision:0,entries:[row('2',9,'2026-10-28',1)]}}};
 // 1·2반 편집본은 있고 공개본은 아직 없음(운영 지금 상태).
 const docs={'timetableBetaDrafts/1':{classId:'1',entries:seed.classes['1'].entries,revision:1,seedVersion:'20261014'},'timetableBetaDrafts/2':{classId:'2',entries:seed.classes['2'].entries,revision:1,seedVersion:'20261014'}};
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('dialog',d=>d.accept());
 try{
  await page.route('**/*',route=>{const u=new URL(route.request().url()),name=u.pathname.slice(1);
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.docs=${JSON.stringify(docs)};export const doc=(db,...p)=>({path:p.join('/')}),collection=doc,serverTimestamp=()=>({seconds:1});export async function getDoc(r){const d=window.docs[r.path];return{exists:()=>!!d,data:()=>structuredClone(d)};}export async function getDocs(r){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith(r.path+'/')).map(([k,v])=>({id:k.split('/').pop(),data:()=>structuredClone(v)}))};}export async function setDoc(r,v){window.docs[r.path]=v;}export async function runTransaction(db,fn){const pending=[];const value=await fn({get:getDoc,set:(r,v)=>pending.push([r.path,v])});for(const[k,v]of pending)window.docs[k]=structuredClone(v);return value;}`});
   if(!name)return route.fulfill({contentType:'text/html;charset=utf-8',body:`<div id="teacher"></div><div id="admin"></div><script type="module">import{mountTimetableAdmin,mountTeacherTimetable}from'/timetable.mjs';window.mountTeacher=(id,compact=false)=>mountTeacherTimetable(document.querySelector('#teacher'),{db:{},user:{email:'teacher@example.test'},classInfo:{id,course:'모빌리티 AI',venue:'교육장'},compact});window.mountAdmin=()=>mountTimetableAdmin(document.querySelector('#admin'),{db:{},user:{email:'admin@example.test'},classes:[{id:'1',course:'모빌리티 AI',venue:'교육장'},{id:'2',course:'모빌리티 AI',venue:'교육장'}]});window.ready=true;</script>`});
   if(name==='timetable-seed.json')return route.fulfill({json:seed});
   if(name==='survey-catalog.json')return route.fulfill({json:{events:[]}});
   if(name==='timetable-reference.json')return route.fulfill({json:{patches:[],additions:[],facilities:[],courses:{},sources:[],version:'fixture'}});
   if(u.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(name)&&!name.split('/').includes('..')&&existsSync(join(base,name)))return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,name),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);
  const teacher=page.locator('#teacher'),admin=page.locator('#admin'),docOf=p=>page.evaluate(k=>window.docs[k],p);
  const showTeacher=async(id,date='2026-10-28')=>{await page.evaluate(id=>window.mountTeacher(id),id);await teacher.getByRole('heading',{name:/오늘의 수업/}).waitFor();await teacher.locator('#date').fill(date);await teacher.locator('#date').dispatchEvent('change');};
  // 1. Nothing published: teacher sees this class's Excel base schedule with a muted source note.
  await showTeacher('1');
  assert.equal(await teacher.locator('.source-note').innerText(),'운영팀 기준 일정(엑셀 원본)');
  assert.equal(await teacher.locator('.teacher-calendar .schedule-scroll .lesson').count(),2);assert.match(await teacher.locator('.teacher-calendar').innerText(),/조해정/);
  assert.equal(await teacher.getByText('아직 공개된 시간표가 없습니다.').count(),0);
  await showTeacher('2');assert.equal(await teacher.locator('.teacher-calendar .schedule-scroll .lesson').count(),1);
  // 17반(시험용 테스트반)은 엑셀 일정이 없어 1반 일정을 예시로.
  await showTeacher('17');assert.match(await teacher.locator('.source-note').innerText(),/시험용 반이라 1반 일정 예시/);assert.equal(await teacher.locator('.teacher-calendar .schedule-scroll .lesson').count(),2);
  // Compact (홈 '오늘 수업') keeps the note too.
  await page.evaluate(()=>window.mountTeacher('1',true));await teacher.locator('.source-note').waitFor();assert.equal(await teacher.locator('.teacher-calendar').count(),0);
  // 2. Admin: drafts without a published copy → '전체 반 다시 공개' (with the usual review dialog). Opening the screen alone writes nothing.
  await page.evaluate(()=>window.mountAdmin());const now=admin.getByRole('button',{name:'2개 반 담임에게 다시 공개'});await now.waitFor();await admin.getByText(/기준 일정: 엑셀 일정표/).waitFor();
  assert.equal(await page.evaluate(()=>Object.keys(window.docs).filter(k=>k.startsWith('timetableBetaPublished/')).length),0,'opening the screen publishes nothing by itself');
  await now.click();await admin.locator('#publishConfirm:not([disabled])').waitFor();await admin.locator('#publishConfirm').click();await admin.getByRole('status').getByText('2/2개 반 공개 완료',{exact:true}).waitFor();
  const p1=await docOf('timetableBetaPublished/1');assert.equal(p1.sourceRevision,1);assert.deepEqual(p1.entries.map(e=>e.id),seed.classes['1'].entries.map(e=>e.id));assert.equal(p1.entries.some(e=>'sourceText' in e||'origin' in e||'sourceRow' in e),false,'publishEntries strips Excel source fields');assert.equal(p1.entries[0].instructorName,'조해정');
  assert(await docOf('timetableBetaPublished/2'));
  // 3. Editor save writes the draft and the teacher copy in the same flow.
  await admin.locator('#classFilter').selectOption('1');await admin.locator('#date').fill('2026-10-28');await admin.locator('#date').dispatchEvent('change');
  await admin.locator('[data-edit="x2-1-2026-10-28"]').click();await admin.getByLabel('전달사항',{exact:true}).fill('노트북 지참');await admin.getByRole('button',{name:'편집본 저장',exact:true}).click();
  await admin.getByRole('status').getByText(/편집본을 저장했습니다 · 담임 화면에도 1개 반 공개했습니다/).waitFor();
  const d1=await docOf('timetableBetaDrafts/1'),p1b=await docOf('timetableBetaPublished/1');assert.equal(d1.revision,2);assert.equal(p1b.sourceRevision,2);assert.equal(p1b.revision,2);
  assert.equal(p1b.entries.find(e=>e.id==='x2-1-2026-10-28').note,'노트북 지참');assert.deepEqual(p1b.recentChanges.map(c=>[c.id,c.fields]),[['x2-1-2026-10-28',['전달사항']]]);
  assert.equal((await docOf('timetableBetaPublished/2')).revision,1,'other classes untouched');
  // 4. Teacher now reads the published copy: no fallback note.
  await showTeacher('1');assert.equal(await teacher.locator('.source-note').count(),0);assert.match(await teacher.locator('.teacher-calendar').innerText(),/노트북 지참/);
  // 5. Explicit '다시 공개' still works (new published revision, same draft).
  await admin.getByRole('button',{name:'선택 반 담임에게 다시 공개',exact:true}).click();await admin.locator('#publishConfirm:not([disabled])').waitFor();await admin.locator('#publishConfirm').click();await admin.getByRole('status').getByText('1/1개 반 공개 완료',{exact:true}).waitFor();
  assert.equal((await docOf('timetableBetaPublished/1')).revision,3);
  // 6. A concurrent published change: the draft still saves, the failure is reported with what to do.
  await page.evaluate(()=>window.docs['timetableBetaPublished/1'].revision++);
  await admin.locator('[data-edit="x2-1-2026-10-29"]').click();await admin.getByLabel('전달사항',{exact:true}).fill('실습');await admin.getByRole('button',{name:'편집본 저장',exact:true}).click();
  await admin.getByRole('status').getByText(/1반 공개 실패.*다시 공개/).waitFor();assert.equal((await docOf('timetableBetaDrafts/1')).revision,3);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
