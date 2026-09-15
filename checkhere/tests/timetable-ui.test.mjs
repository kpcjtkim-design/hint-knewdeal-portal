import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('timetable imports, edits, conflict-checks, publishes and renders teacher mobile view',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});page.on('dialog',async d=>d.type()==='prompt'?d.accept('새 과정'):d.accept());
 try{
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.docs={};export const doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),serverTimestamp=()=>({seconds:1});export async function getDoc(r){const d=window.docs[r.path];return{exists:()=>!!d,data:()=>structuredClone(d)};}export async function getDocs(r){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith(r.path+'/')).map(([k,v])=>({id:k.split('/').pop(),data:()=>structuredClone(v)}))};}export async function setDoc(r,v){window.docs[r.path]=v;}export async function runTransaction(db,fn){const pending=[];const value=await fn({get:getDoc,set:(r,v)=>pending.push([r.path,v])});for(const[k,v]of pending)window.docs[k]=structuredClone(v);return value;}`});
  if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import{mountTimetableAdmin,mountTeacherTimetable}from'/timetable.mjs';window.mountTeacher=()=>mountTeacherTimetable(document.querySelector('#host'),{db:{},user:{email:'teacher@example.com'},classInfo:{id:'1',course:'임베디드 AI(HW)'}});await mountTimetableAdmin(document.querySelector('#host'),{db:{},user:{email:'admin@example.com'},classes:Array.from({length:17},(_,i)=>({id:String(i+1),course:i===1?'제조지능화':'임베디드 AI(HW)',venue:'교육장'}))});</script>`});
  const name=u.pathname.slice(1);if(['attendance-derived-core.mjs', 'attendance-derived-store.mjs', 'survey-scores.mjs', 'survey-statistics.mjs', 'attendance-statistics.mjs', 'metrics-ui.mjs', 'metrics.css', 'lecture-materials.mjs', 'checkhere/rules.mjs','survey-links.mjs','survey-core.mjs','survey-catalog.json','timetable-holiday.mjs','survey-view.mjs','survey-store.mjs','survey-google.mjs','survey.css','attendance-beta-core.mjs','attendance-rollout.mjs','attendance-io.mjs','timetable.mjs','timetable-board.mjs','timetable-store.mjs','timetable-core.mjs','timetable.css','timetable-seed.json','timetable-reference.mjs','timetable-reference.json'].includes(name))return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,name),'utf8')});return route.abort();
 });
 await page.goto('https://fixture.test/');await page.getByRole('button',{name:'엑셀 기준 17개 반 가져오기'}).click();await page.getByRole('status').getByText(/17\/17개 반 가져오기 완료/).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(window.docs).filter(k=>k.startsWith('timetableBetaDrafts/')).length),17);
 await page.getByRole('button',{name:'강사 관리',exact:true}).click();await page.getByRole('button',{name:'+ 강사 등록'}).click();await page.getByLabel('이름',{exact:true}).fill('시험 강사');await page.getByLabel('연락처',{exact:true}).fill('010-0000-0000');await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByText('시험 강사',{exact:true}).waitFor();
 await page.getByRole('button',{name:'반별 시간표',exact:true}).click();await page.locator('#classFilter').selectOption('1');await page.locator('#date').fill('2026-09-11');await page.locator('#date').dispatchEvent('change');await page.locator('[data-edit]').first().click();assert.deepEqual(errors,[]);await page.locator('#editor select[name=instructorId]').selectOption({label:'시험 강사'});await page.getByRole('button',{name:'편집본 저장',exact:true}).click();await page.getByRole('status').getByText(/편집본을 저장/).waitFor();
 // Dragging edits a local draft only; swapping, undoing and saving preserve unrelated fields.
 const first=page.locator('[data-edit][draggable="true"]').nth(0),second=page.locator('[data-edit][draggable="true"]').nth(1);
 const firstId=await first.getAttribute('data-edit'),secondId=await second.getAttribute('data-edit');
 const beforeDrag=await page.evaluate(()=>structuredClone(window.docs['timetableBetaDrafts/1']));
 const a=beforeDrag.entries.find(e=>e.id===firstId),b=beforeDrag.entries.find(e=>e.id===secondId);
 await first.dragTo(second);await page.getByRole('status').getByText(/수업을 끼워 넣고/).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.docs['timetableBetaDrafts/1']),beforeDrag,'drag does not save');
 assert(await page.getByRole('button',{name:'선택 반 담임에게 공개'}).isDisabled());
 assert.equal(await page.locator(`[data-edit="${firstId}"]`).getAttribute('aria-label'),`1반 ${b.date} ${a.title} 수정`);
 await page.getByRole('button',{name:'이동 되돌리기'}).click();assert.equal(await page.locator(`[data-edit="${firstId}"]`).getAttribute('aria-label'),`1반 ${a.date} ${a.title} 수정`);
 await page.locator(`[data-edit="${firstId}"]`).dragTo(page.locator('[data-drop-date="2026-09-12"]'),{targetPosition:{x:20,y:15}});
 await page.getByRole('button',{name:/^시간표 저장/}).click();await page.getByRole('status').getByText(/시간표 저장 완료/).waitFor();
 const saved=await page.evaluate(()=>window.docs['timetableBetaDrafts/1']);assert.equal(saved.entries.length,beforeDrag.entries.length);assert.deepEqual(saved.entries.find(e=>e.id===firstId),{...a,date:'2026-09-12'});
 await page.getByRole('button',{name:'월간',exact:true}).click();assert.equal(await page.locator('.month-grid .day-cell').count(),42);
 await page.getByRole('button',{name:'전체 일정',exact:true}).click();assert((await page.locator('.calendar-month').count())>=3);
 assert.equal(await page.locator('[data-edit]').count(),saved.entries.length,'whole schedule shows each entry once');
 await page.locator('#classFilter').selectOption('all');assert.equal(await page.locator('[data-calendar-class]').count(),17);assert.equal(await page.locator('[data-calendar-content="2"] [data-edit]').count(),0,'closed classes render lazily');
 await page.locator('[data-calendar-class="2"] summary').click();await page.locator('[data-calendar-content="2"] [data-edit]').first().waitFor();
 await page.locator('#classFilter').selectOption('1');
 const boardOut=join(base,'checkhere/test-results');mkdirSync(boardOut,{recursive:true});await page.screenshot({path:join(boardOut,'timetable-admin-months.png')});
 await page.getByRole('button',{name:'주간',exact:true}).click();
 assert.equal(await page.evaluate(()=>Object.keys(window.docs).filter(k=>k.startsWith('timetableBetaPublished/')).length),0);
 await page.getByRole('button',{name:'선택 반 담임에게 공개'}).click();await page.getByRole('status').getByText(/1\/1개 반 공개 완료/).waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(window.docs['timetableBetaPublished/1']).includes('010-0000')),false);
 const finalLesson=await page.evaluate(()=>{const e=window.docs['timetableBetaDrafts/1'].entries.filter(e=>e.title==='MCU 프로그래밍').sort((a,b)=>a.date.localeCompare(b.date));return e.at(-1);});
 await page.locator('#date').fill(finalLesson.date);await page.locator('#date').dispatchEvent('change');
 await page.locator('.lecture-end.notice').filter({hasText:'MCU 프로그래밍'}).waitFor();
 assert.equal(await page.locator(`[data-edit="${finalLesson.id}"] + .lecture-end`).textContent(),'모듈 종료일, 만족도조사 필요 ↗');
 await page.getByRole('button',{name:'대체휴일 · 일정 순연'}).click();await page.locator('#holidayDate').fill('2026-10-22');await page.getByRole('button',{name:'이동 미리보기'}).click();await page.getByText(/기존 교육 종료일 이후/).waitFor();const holidayBefore=await page.evaluate(()=>JSON.stringify(window.docs['timetableBetaDrafts/1']));await page.getByRole('button',{name:'편집본에 적용'}).click();assert.equal(await page.evaluate(()=>JSON.stringify(window.docs['timetableBetaDrafts/1'])),holidayBefore);await page.getByRole('button',{name:'이동 되돌리기'}).click();assert(await page.getByRole('button',{name:'시간표 저장',exact:true}).isDisabled());
 // A stale editor must not overwrite a concurrent administrative change.
 await page.locator('[data-edit]').first().click();await page.evaluate(()=>window.docs['timetableBetaDrafts/1'].revision++);await page.getByLabel('전달사항',{exact:true}).fill('stale change');await page.getByRole('button',{name:'편집본 저장',exact:true}).click();await page.getByRole('alert').getByText(/다른 관리자/).waitFor();await page.getByRole('button',{name:'취소',exact:true}).click();
 await page.getByRole('button',{name:'과정·강의 관리',exact:true}).click();await page.getByRole('button',{name:'+ 과정',exact:true}).click();await page.getByText('새 과정',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'담임 화면 미리보기',exact:true}).click();await page.getByRole('heading',{name:/오늘의 수업/}).waitFor();
 const out=join(base,'checkhere/test-results');mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'timetable-teacher-desktop.png'),fullPage:true});
 await page.evaluate(()=>window.mountTeacher());assert.equal(await page.getByRole('heading',{name:/오늘의 수업/}).count(),1,await page.locator('#content').first().textContent());assert.equal(await page.getByText('010-0000-0000',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'편집본 저장'}).count(),0);
 await page.locator('#date').fill(finalLesson.date);await page.locator('#date').dispatchEvent('change');
 const endCard=page.locator('.teacher-calendar .schedule-scroll .lesson-container').filter({hasText:'MCU 프로그래밍'}).filter({has:page.locator('.lecture-end')});
 assert.equal(await endCard.count(),1,'published individual lecture final day shown to teacher');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'timetable-teacher-mobile.png'),fullPage:true});assert.equal(await page.locator('.mobile-list').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
