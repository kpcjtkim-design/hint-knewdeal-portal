import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
const base=join(import.meta.dirname,'../..');
const data={attendance:[['이름','','','','9/1'],['가상학생','','','','인정출석']],attendanceBackgrounds:[[],['','','','','#ffffff']],reasons:[['','','','','9/1'],['','','','','인정출석1\n가상학생_병원']]};
async function fixture(page,{period=false,partial=false}={}){
 await page.route('**/*',route=>{
  const u=new URL(route.request().url()),path=u.pathname.slice(1);
  if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const doc=()=>({});export async function getDocFromServer(){window.scheduleReads++;return{data:()=>({entries:[]})}}`});
  if(path==='api/attendance-reader'){const cid=route.request().postDataJSON().classId;return route.fulfill({status:partial&&cid==='2'?503:200,json:partial&&cid==='2'?{ok:false,error:'TEST_FAILURE',message:'시험용 수집 실패',retryable:false}:{ok:true,...data}});}
  if(path==='raw-attendance-store.mjs')return route.fulfill({contentType:'text/javascript',body:`export async function readExportAttendance(){window.storedReads++;return{metadata:{},summary:null,records:[]}}`});
  if(path==='survey-export.mjs')return route.fulfill({contentType:'text/javascript',body:`export async function loadExportXlsx(){return{utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(book,sheet,name)=>book.sheets.push({name,sheet})},writeFile:(book,name)=>window.saved.push({book,name})}}`});
  if(path==='attendance-period-workbook.mjs')return route.fulfill({contentType:'text/javascript',body:`export function buildPeriodWorkbook(){window.builds++;return{xlsx:{writeBuffer:async()=>new Uint8Array([1,2,3])}}}export function readUploadedAttendance(){throw Error('not used')}`});
  if(path==='attendance-period-templates.json')return route.fulfill({json:{}});
  if(path==='')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><dialog id="download"></dialog><script type="module">
   window.saved=[];window.storedReads=0;window.scheduleReads=0;window.builds=0;
   window.ExcelJS={};window.JSZip=class{file(){}async generateAsync(){return new Uint8Array([1,2,3])}};
   HTMLAnchorElement.prototype.click=function(){window.saved.push({name:this.download});};
   const options={db:{},user:{getIdToken:async()=>'fixture'},classes:[{id:'1'},${partial?"{id:'2'}":''}],selected:${partial?"'all'":"'1'"}};
   ${period?`import{mountAttendancePeriod}from'/attendance-period.mjs';window.work=await mountAttendancePeriod(document.querySelector('#host'),options);`:`import{openRawDownload}from'/raw-download.mjs';window.pending=openRawDownload(document.querySelector('#download'),{...options,kind:'attendance'});`}
  </script>`});
  if(/\.(mjs|css)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});
  return route.abort();
 });
 await page.goto('https://fixture.test/');
}

test('attendance RAW waits for simple preflight confirmation; dismiss/reopen reuses fetched data',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await fixture(page);await page.locator('#dlFrom').fill('2026-09-01');await page.locator('#dlTo').fill('2026-09-01');await page.locator('#dlStart').click();
  const modal=page.locator('[data-download-preflight]');await modal.waitFor();
  assert.match(await modal.innerText(),/서류 미제출 \/ 반려\s+1건 \/ 0건/);assert.match(await modal.innerText(),/체크히어 미반영 요청\s+검사하지 않음/);
  assert.equal(await page.evaluate(()=>window.saved.length),0);await modal.locator('[data-close]').click();
  await page.locator('#dlSave').click();await modal.waitFor();await modal.locator('summary').click();await modal.locator('[data-issues] tr').waitFor();
  assert.match(await modal.locator('[data-issues]').innerText(),/가상학생/);await modal.locator('[data-confirm]').click();
  await page.waitForFunction(()=>window.saved.length===1);assert.equal(await page.evaluate(()=>window.storedReads),1);
  assert.deepEqual(await page.evaluate(()=>window.saved[0].book.sheets.map(s=>s.name)),['1반 출결','1반 출결 비교','1반 가-3','1반 DB 출결 기록','수집내역']);
  await page.locator('#dlClose').click();assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('partial RAW requires explicit partial-data confirmation and includes failure audit unchanged',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 try{
  await fixture(page,{partial:true});await page.locator('#dlFrom').fill('2026-09-01');await page.locator('#dlTo').fill('2026-09-01');await page.locator('#dlStart').click();
  await page.locator('#dlStatus').filter({hasText:'1개 원본 수집 실패'}).waitFor();assert.equal(await page.evaluate(()=>window.saved.length),0);
  await page.locator('#dlSave').click();const modal=page.locator('[data-download-preflight]');await modal.waitFor();
  assert.match(await modal.innerText(),/1개 반 수집 실패 · 부분 자료/);assert.match(await modal.innerText(),/2반: 시험용 수집 실패/);
  await modal.getByRole('button',{name:'부분 자료 그대로 다운로드'}).click();await page.waitForFunction(()=>window.saved.length===1);
  assert.match(await page.evaluate(()=>window.saved[0].name),/부분자료/);assert.equal(await page.evaluate(()=>window.storedReads),1);
  assert(await page.evaluate(()=>window.saved[0].book.sheets.find(s=>s.name==='수집내역').sheet.rows.some(r=>r[0]==='2반'&&r[1]==='수집 실패')));await page.locator('#dlClose').click();
 }finally{await browser.close();}
});

test('unit-period XLSX and ZIP both confirm the same prepared data without extra reads or builds',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await fixture(page,{period:true});await page.locator('#periodFrom').fill('2026-09-01');await page.locator('#periodTo').fill('2026-09-01');await page.locator('#periodCheck').click();
  await page.locator('#periodState').filter({hasText:'사전 점검 완료'}).waitFor();await page.locator('#periodGenerate').click();
  await page.getByRole('button',{name:'1반 Excel 다운로드',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.saved.length),0);
  await page.getByRole('button',{name:'1반 Excel 다운로드',exact:true}).click();const modal=page.locator('[data-download-preflight]');await modal.waitFor();await modal.locator('[data-close]').click();assert.equal(await page.evaluate(()=>window.saved.length),0);
  for(const name of ['1반 Excel 다운로드','선택 1개 반 ZIP 다운로드']){
   await page.getByRole('button',{name,exact:true}).click();await modal.waitFor();assert.match(await modal.innerText(),/다운로드 전 확인/);await modal.locator('[data-confirm]').click();
  }
  await page.waitForFunction(()=>window.saved.length===2);assert.deepEqual(await page.evaluate(()=>[window.storedReads,window.scheduleReads,window.builds]),[1,1,1]);
  assert.deepEqual(errors,[]);await page.evaluate(()=>window.work.dispose());
 }finally{await browser.close();}
});
