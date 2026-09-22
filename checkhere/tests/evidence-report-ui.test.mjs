import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
test('teacher home and scoped evidence panel reuse summaries; period changes make no database calls',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>{
   const u=new URL(route.request().url()),path=u.pathname.slice(1);
   if(path==='attendance-derived-store.mjs')return route.fulfill({contentType:'text/javascript',body:`window.reads=[];window.writes=0;export async function readAttendanceSummary(db,cid){window.reads.push(cid);return {classId:cid,latestDate:'2026-09-14',dates:['2026-08-26','2026-09-14'],students:[{id:'a',name:cid+'반가상',history:{'2026-08-26':{raw:'인정출석',status:'인정지각',evidenceStatus:'미제출'},'2026-09-14':{raw:'인정출석',status:'인정조퇴',evidenceStatus:'반려'}}}]};}export async function syncAttendanceSummary(){window.writes++;throw Error('explicit only');}`});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">
    import {mountAttendanceStatistics} from '/attendance-statistics.mjs';import {mountAttendanceEvidence} from '/attendance-evidence.mjs';
    const mode=new URL(location.href).searchParams.get('mode'),options={db:{},user:{email:'fixture@example.test'},classes:[{id:'1'},{id:'2'}],...(mode==='admin'?{}:{teacherClass:{id:'1'}})};
    if(mode==='home')await mountAttendanceStatistics(document.querySelector('#host'),{...options,compact:true});else await mountAttendanceEvidence(document.querySelector('#host'),options);
   </script>`});
   if(/\.(mjs|css)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:path.endsWith('css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/?mode=home');await page.locator('#homeEvidencePeriod').waitFor();assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  await page.locator('#homeEvidencePeriod').selectOption('1');assert.equal(await page.locator('#content table tbody tr').count(),1);assert.match(await page.locator('#content table').innerText(),/미제출/);assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  await page.goto('https://fixture.test/?mode=teacher');await page.locator('#evPeriod').waitFor();assert.equal(await page.locator('[data-class]').count(),0);assert.equal(await page.locator('#evSync').count(),0);assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  await page.locator('#evPeriod').selectOption('2');assert.equal(await page.locator('tbody tr').count(),1);assert.match(await page.locator('tbody').innerText(),/반려/);assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  await page.goto('https://fixture.test/?mode=admin');await page.locator('#evPeriod').waitFor();await page.locator('#evAll').click();assert.deepEqual(await page.evaluate(()=>window.reads),['1']);await page.locator('#evRead').click();await page.locator('#evRead').waitFor({state:'visible'});await page.waitForFunction(()=>window.reads.length===3);
  await page.locator('#evPeriod').selectOption('2');assert.deepEqual(await page.evaluate(()=>window.reads),['1','1','2']);assert.equal(await page.locator('tbody tr').count(),2);assert.match(await page.locator('#evMessage').inputValue(),/\[2반\]/);assert.equal(await page.evaluate(()=>window.writes),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
