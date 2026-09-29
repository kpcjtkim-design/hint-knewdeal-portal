import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('excel sync, move chooser, conflicts, bulk work and teacher change notices',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true}),page=await context.newPage(),errors=[];
 const lectures=[{id:'L1',course:'임베디드 AI(HW)',module:'직무특화',title:'C 프로그래밍',days:2},{id:'L2',course:'임베디드 AI(HW)',module:'직무특화',title:'MCU 프로그래밍',days:2}];
 const row=(cid,n,lecture,day,date)=>({id:`xlsx-${cid}-${n}`,date,course:'임베디드 AI(HW)',module:'직무특화',lectureId:lecture.id,title:lecture.title,day,hours:8,start:'',end:'',instructorId:'',venue:'',online:false,note:'',kind:'class',sourceRow:n,sourceText:lecture.title});
 const week=cid=>[row(cid,5,lectures[0],1,'2026-09-21'),row(cid,6,lectures[0],2,'2026-09-22'),row(cid,7,lectures[1],1,'2026-09-23'),row(cid,8,lectures[1],2,'2026-09-24')];
 const seedOf=(version,classes)=>({version,source:'fixture.xlsx',start:'2026-09-21',end:'2026-09-28',courses:['임베디드 AI(HW)'],modules:['직무특화'],lectures,classes});
 const v1=seedOf('20260911',{'1':{classId:'1',entries:week('1')},'2':{classId:'2',entries:week('2')}});
 const moved=week('1');moved[1]={...moved[1],date:'2026-09-28'};
 const v2=seedOf('20261001',{'1':{classId:'1',entries:moved},'2':{classId:'2',entries:week('2')}});
 const draft1=week('1');draft1[0]={...draft1[0],instructorId:'t1',note:'실습실'};draft1[3]={...draft1[3],date:'2026-09-25'};
 const draft2=week('2');draft2[0]={...draft2[0],instructorId:'t1'};
 const docs={'timetableBetaDrafts/1':{classId:'1',entries:draft1,revision:1},'timetableBetaDrafts/2':{classId:'2',entries:draft2,revision:1,seedVersion:'20261001'},'timetableBetaPublished/1':{classId:'1',entries:draft1.map(e=>({...e,instructorName:e.instructorId?'김강사':''})),revision:1,sourceRevision:1},'timetableBetaInstructors/t1':{name:'김강사',revision:1},'timetableBetaInstructors/t2':{name:'박강사',revision:1}};
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('dialog',d=>d.accept());
 try{
  // Shift only Date to a fixed school day; timers and performance.now keep running.
  await context.addInitScript(()=>{const offset=Date.parse('2026-09-28T10:00:00+09:00')-Date.now(),Real=Date;globalThis.Date=class extends Real{constructor(...a){super(...(a.length?a:[Real.now()+offset]));}static now(){return Real.now()+offset;}};});
  await context.route('**/*',route=>{const u=new URL(route.request().url()),name=u.pathname.slice(1);
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.docs=${JSON.stringify(docs)};export const doc=(db,...p)=>({path:p.join('/')}),collection=doc,serverTimestamp=()=>({seconds:1});export async function getDoc(r){const d=window.docs[r.path];return{exists:()=>!!d,data:()=>structuredClone(d)};}export async function getDocs(r){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith(r.path+'/')&&k.split('/').length===r.path.split('/').length+1).map(([k,v])=>({id:k.split('/').pop(),data:()=>structuredClone(v)}))};}export async function setDoc(r,v){window.docs[r.path]=v;}export async function runTransaction(db,fn){const pending=[];const value=await fn({get:getDoc,set:(r,v)=>pending.push([r.path,v])});for(const[k,v]of pending)window.docs[k]=structuredClone(v);return value;}`});
   if(!name)return route.fulfill({contentType:'text/html;charset=utf-8',body:`<div id="host"></div><script type="module">import{mountTimetableAdmin,mountTeacherTimetable}from'/timetable.mjs';window.mountTeacher=()=>mountTeacherTimetable(document.querySelector('#host'),{db:{},user:{email:'teacher@example.test'},classInfo:{id:'1',course:'임베디드 AI(HW)',venue:'교육장'}});window.work=await mountTimetableAdmin(document.querySelector('#host'),{db:{},user:{email:'admin@example.test'},classes:[{id:'1',course:'임베디드 AI(HW)',venue:'교육장'},{id:'2',course:'임베디드 AI(HW)',venue:'교육장'}]});</script>`});
   if(name==='timetable-seed.json')return route.fulfill({json:v2});
   if(name==='timetable-seeds/20260911.json')return route.fulfill({json:v1});
   if(name==='survey-catalog.json')return route.fulfill({json:{events:[]}});
   if(name==='timetable-reference.json')return route.fulfill({json:{patches:[],additions:[],facilities:[],courses:{},sources:[],version:'fixture'}});
   if(u.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(name)&&!name.split('/').includes('..')&&existsSync(join(base,name)))return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,name),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');
  const docOf=path=>page.evaluate(p=>window.docs[p],path);
  // 1. Excel update: only class 1 is on the old workbook; sheet move applies, portal edits stay.
  await page.getByText('새 엑셀 일정표가 올라왔습니다').waitFor();await page.getByRole('button',{name:'엑셀 변경분 검토'}).click();
  await page.getByText(/1반 · 변경 1건/).waitFor();assert.equal(await page.locator('[data-sync]').count(),1);
  await page.getByRole('button',{name:'선택한 반에 적용'}).click();await page.getByRole('status').getByText(/엑셀 변경분을 1개 반/).waitFor();
  await page.getByRole('button',{name:/^시간표 저장/}).click();await page.getByRole('status').getByText(/시간표 저장 완료/).waitFor();
  let d1=await docOf('timetableBetaDrafts/1');assert.equal(d1.seedVersion,'20261001');
  assert.equal(d1.entries.find(e=>e.id==='xlsx-1-6').date,'2026-09-28','sheet change applied');assert.equal(d1.entries.find(e=>e.id==='xlsx-1-8').date,'2026-09-25','portal move kept');assert.equal(d1.entries.find(e=>e.id==='xlsx-1-5').note,'실습실');
  assert.equal(await page.getByText('새 엑셀 일정표가 올라왔습니다').count(),0);
  // 2. Instructor conflicts show on the cards and in the instructor week.
  await page.locator('#date').fill('2026-09-21');await page.locator('#date').dispatchEvent('change');
  assert.equal(await page.locator('.lesson .warn').count(),2);assert.match(await page.locator('.lesson .warn').first().innerText(),/김강사 일정 겹침/);
  assert.equal(await page.locator('.admin-grid > .grid-head').count(),6,'weekend columns hidden: label + Mon–Fri');
  await page.getByRole('button',{name:'강사 관리',exact:true}).click();await page.getByRole('heading',{name:'강사 주간 일정'}).waitFor();assert.equal(await page.locator('.instructor-week .slot.clash').count(),2);
  await page.getByRole('button',{name:'반별 시간표',exact:true}).click();
  // 3. Dropping onto another lesson offers insert or swap; swap changes only two lessons.
  const c1=page.locator('[data-edit="xlsx-1-5"]'),m1=page.locator('[data-edit="xlsx-1-7"]');await c1.dragTo(m1);
  await page.getByRole('button',{name:/^맞바꾸기/}).click();await page.getByRole('status').getByText(/두 수업의 날짜를 맞바꿨습니다/).waitFor();
  assert.match(await page.locator('[data-edit="xlsx-1-5"]').getAttribute('aria-label'),/2026-09-23/);assert.match(await page.locator('[data-edit="xlsx-1-7"]').getAttribute('aria-label'),/2026-09-21/);
  await page.getByRole('button',{name:'이동 되돌리기'}).click();await page.waitForTimeout(300);// emulated drags end on the next mouse move; let the post-drag click guard lapse
  // 4. Touch-friendly reordering from the lesson editor.
  await page.locator('[data-edit="xlsx-2-5"]').click();await page.getByRole('button',{name:'뒤 수업과 바꾸기 ▶'}).click();await page.getByRole('status').getByText(/날짜를 맞바꿨습니다/).waitFor();
  assert.match(await page.locator('[data-edit="xlsx-2-5"]').getAttribute('aria-label'),/2026-09-22/);await page.getByRole('button',{name:'이동 되돌리기'}).click();
  // 5. Adding without a selected class asks for the class first.
  await page.getByRole('button',{name:'+ 일정 추가'}).click();await page.getByRole('heading',{name:'어느 반에 일정을 추가할까요?'}).waitFor();await page.locator('#pickClass select').selectOption('2');await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('heading',{name:'2반 · 일정 추가'}).waitFor();await page.getByRole('button',{name:'취소',exact:true}).click();
  // 6. Bulk instructor and time for one lecture across both classes.
  await page.getByRole('button',{name:'일괄 작업'}).click();await page.locator('#bulkForm [name=title]').selectOption('MCU 프로그래밍');await page.locator('#bulkForm [name=instructorId]').selectOption({label:'박강사'});await page.locator('#bulkForm [name=start]').fill('09:00');await page.locator('#bulkForm [name=end]').fill('18:00');
  await page.getByRole('button',{name:'미리보기',exact:true}).click();await page.locator('#bulkResult').getByText('2반 · 수업 2건 변경').waitFor();await page.locator('#bulkForm [type=submit]:not([disabled])').waitFor();await page.locator('#bulkForm [type=submit]').click();
  await page.getByRole('button',{name:/^시간표 저장/}).click();await page.getByRole('status').getByText(/시간표 저장 완료/).waitFor();
  const d2=await docOf('timetableBetaDrafts/2');assert.deepEqual(d2.entries.filter(e=>e.title==='MCU 프로그래밍').map(e=>[e.instructorId,e.start,e.end]),[['t2','09:00','18:00'],['t2','09:00','18:00']]);assert.equal(d2.seedVersion,'20261001');
  // 7. Copy one week from class 1 to class 2, replacing class 2's lessons in that week.
  await page.getByRole('button',{name:'일괄 작업'}).click();await page.getByRole('button',{name:'다른 반으로 기간 복사'}).click();await page.locator('#bulkForm [name=source]').selectOption('1');await page.locator('#bulkForm [name=from]').fill('2026-09-21');await page.locator('#bulkForm [name=to]').fill('2026-09-25');
  assert(await page.locator('#bulkForm [name=targets][value="2"]').isChecked(),'same course preselected');
  await page.getByRole('button',{name:'미리보기',exact:true}).click();await page.locator('#bulkResult').getByText(/2반 · 3건 복사 · 기존 4건 교체/).waitFor();await page.locator('#bulkForm [type=submit]:not([disabled])').waitFor();await page.locator('#bulkForm [type=submit]').click();
  await page.getByRole('button',{name:/^시간표 저장/}).click();await page.getByRole('status').getByText(/시간표 저장 완료/).waitFor();
  assert.deepEqual((await docOf('timetableBetaDrafts/2')).entries.map(e=>e.date),['2026-09-21','2026-09-23','2026-09-25']);
  // 8. Publishing records the change teachers should notice.
  await page.locator('#classFilter').selectOption('1');await page.getByRole('button',{name:'선택 반 담임에게 공개'}).click();await page.locator('#publishConfirm:not([disabled])').waitFor();await page.locator('#publishConfirm').click();await page.getByRole('status').getByText('1/1개 반 공개 완료').waitFor();
  const recent=(await docOf('timetableBetaPublished/1')).recentChanges;assert.deepEqual(recent.map(c=>[c.id,c.from,c.to,c.at]),[['xlsx-1-7','2026-09-23','2026-09-23 09:00–18:00','2026-09-28'],['xlsx-1-8','2026-09-25','2026-09-25 09:00–18:00','2026-09-28'],['xlsx-1-6','2026-09-22','2026-09-28','2026-09-28']]);assert.deepEqual(recent[0].fields.sort(),['강사','시작','종료'].sort());
  // 9. Teacher: badge, change panel, print and calendar export.
  await page.evaluate(()=>window.mountTeacher());await page.locator('.changed-badge').first().waitFor();
  assert.equal(await page.locator('.teacher-calendar .schedule-scroll .changed-badge').first().innerText(),'변경됨 · 09/22 → 09/28');
  await page.getByText(/최근 2주 시간표 변경 3건/).waitFor();assert.equal(await page.locator('.change-panel .new').count(),1);await page.getByRole('button',{name:'확인했어요'}).click();assert.equal(await page.locator('.change-panel .new').count(),0);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'캘린더 파일(.ics)'}).click()]);assert.equal(download.suggestedFilename(),'hint-class1-timetable.ics');
  const ics=readFileSync(await download.path(),'utf8');assert.match(ics,/BEGIN:VCALENDAR/);assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,4);
  const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'인쇄·PDF'}).click()]);await popup.waitForLoadState();assert.equal(await popup.locator('tbody tr').count(),4);assert.equal(await popup.locator('.tag').count(),3);await popup.close();
  const out=join(base,'checkhere/test-results');mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'timetable-teacher-changes.png'),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
