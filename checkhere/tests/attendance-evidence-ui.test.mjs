import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
test('teacher detail shows saved evidence beside basis, ordered by date, with no reads on student click',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>{
   const u=new URL(route.request().url()),path=u.pathname.slice(1);
   if(path==='attendance-derived-store.mjs')return route.fulfill({contentType:'text/javascript',body:`window.reads=[];export async function readAttendanceSummary(db,cid){window.reads.push(cid);return window.summary;}export async function syncAttendanceSummary(){throw Error('teacher must not sync');}`});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">
    import {mountAttendanceStatistics} from '/attendance-statistics.mjs';
    const states=['확인','반려','미제출','미해당','미확인',undefined],dates=['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14'];
    const history=Object.fromEntries(dates.map((d,i)=>[d,{raw:'인정출석',status:i%2?'인정지각':'인정출석',basis:'시트',review:false,...(states[i]?{evidenceStatus:states[i]}:{})}]).reverse());history['2026-09-15']={raw:'출석',status:'출석',basis:'시트'};
    window.summary={classId:'1',latestDate:'2026-09-15',dates:[...dates,'2026-09-15'],students:[{id:'0_가상',name:'가상',firstDate:'2026-09-07',history}]};
    await mountAttendanceStatistics(document.querySelector('#host'),{db:{},user:{email:'teacher@example.test'},classes:[{id:'1'},{id:'2'}],teacherClass:{id:'1'}});
   </script>`});
   if(/\.(mjs|css)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:path.endsWith('css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('button',{name:'가상',exact:true}).click();
  assert.deepEqual(await page.locator('dialog th').allTextContents(),['교육일','시트','포털 구분','판정 근거','서류제출']);
  assert.deepEqual(await page.locator('dialog tbody tr td:last-child').allTextContents(),['확인','반려','미제출','해당없음','미확인','동기화 필요','—']);
  assert.equal(await page.locator('dialog tbody tr td:first-child').first().innerText(),'2026-09-07');
  assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'가상',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  assert.equal(await page.locator('#statSync').count(),0);assert.equal(await page.locator('#statClass').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
