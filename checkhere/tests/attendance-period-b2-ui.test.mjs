// 2기 관리자 출결 › 내려받기의 단위기간 출석부 화면: 공식 16개 반이 기본 선택(테스트반은 따로), 출결원장 묶음은 한 번만 읽고,
// 다운로드 전 확인을 거쳐 '2기_' 파일 이름으로 내려받습니다. Excel 도구는 가짜로 바꿔 화면 흐름만 봅니다(서식은 attendance-period-b2.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {allClasses,TRAINING_DAYS} from '../../cohort.mjs';
const base=join(import.meta.dirname,'../..');
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'',flag:'',sig:'',...o})[k]);
const RAW={rev:1,today:'2026-11-06',days:[...TRAINING_DAYS],classes:[{id:'1',address:'서울 관악구 관악로 1',hrdName:''}],
 roster:[['1','가상가','재학',''],['1','가상나','중도탈락','2026-11-04'],['2','가상라','재학',''],['17','시험가','재학','']],ledgerCols:COLS,
 ledger:[L('2026-11-02','1','가상가','지각',{reason:'교통'}),L('2026-11-03','1','가상가','인정출석',{reason:'병원(치과)'})],sync:{}};
const FIRESTORE='export const doc=()=>({}),collection=()=>({}),query=()=>({}),where=()=>({}),onSnapshot=()=>()=>{},setDoc=async()=>{},getDoc=async()=>({exists:()=>false,data:()=>null}),getDocs=async()=>({docs:[]}),getDocFromServer=async()=>({exists:()=>false,data:()=>null}),getDocsFromServer=async()=>({docs:[]}),serverTimestamp=()=>0,limit=()=>({}),orderBy=()=>({});';

test('2기 period roster: default real classes, one ledger read, preflight, 2기 file names; test class only on purpose',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>{
   const u=new URL(route.request().url()),path=u.pathname.slice(1);
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:FIRESTORE});
   if(path==='attendance-period-workbook.mjs')return route.fulfill({contentType:'text/javascript',body:`export function buildPeriodWorkbook(E,r,t,p,o){window.builds.push([r.classId,p,o.profile.name,r.students.length]);return{xlsx:{writeBuffer:async()=>new Uint8Array([1])}}}export function readUploadedAttendance(){}`});
   if(path===''){return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="toast"></div><div id="host"></div><script type="module">
    window.saved=[];window.builds=[];window.reads=0;window.ExcelJS={};window.JSZip=class{file(n){(this.names||=[]).push(n)}async generateAsync(){window.zipped=this.names;return new Uint8Array([1])}};
    HTMLAnchorElement.prototype.click=function(){window.saved.push(this.download);};
    const {decodeBundle}=await import('/beta2-core.mjs');const raw=${JSON.stringify(RAW)};
    const client={bundle:async(cls,o)=>{window.reads++;window.bundleArgs=[cls,o];return decodeBundle(raw);}};
    const m=await import('/beta2-downloads.mjs');window.work=await m.mount(document.querySelector('#host'),{db:{},user:{getIdToken:async()=>'x'},classes:${JSON.stringify(allClasses())},client});window.ready=true;
   </script>`});}
   const file=path.split('?')[0];
   if(/\.(mjs|css|json)$/.test(file)&&existsSync(join(base,file)))return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,file),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);
  assert.equal(await page.locator('[data-class]').count(),17);assert.equal(await page.locator('[data-class]:checked').count(),16);assert.equal(await page.locator('[data-class="17"]').isChecked(),false);
  assert.equal(await page.locator('#prFrom').inputValue(),'2026-10-28');assert.equal(await page.locator('#prTo').inputValue(),'2026-11-27');
  await page.locator('#prPeriod').selectOption('2');assert.equal(await page.locator('#prFrom').inputValue(),'2026-11-28');await page.locator('#prPeriod').selectOption('1');
  await page.locator('#prAll').uncheck();assert.equal(await page.locator('[data-class]:checked').count(),0);
  await page.locator('#prAll').check();assert.equal(await page.locator('[data-class="17"]').isChecked(),false,'전체 반 does not add the test class');
  await page.locator('[data-class="17"]').check();assert.equal(await page.locator('#prAll').isChecked(),true);
  await page.locator('#prCheck').click();await page.waitForFunction(()=>/점검 완료|점검 중단/.test(document.querySelector('#prState').textContent));
  assert.equal(await page.evaluate(()=>window.reads),1,'one b2Bundle(all) read for all classes');assert.deepEqual(await page.evaluate(()=>window.bundleArgs),['all',{fresh:true}]);
  const log=await page.locator('#prLog').textContent();assert.match(log,/1반: 학생 2명 \/ 교육일 23일/);assert.match(log,/3반 생성 불가: 마스터시트 명부에 이 반 학생이 없습니다/);assert.match(log,/17반: 학생 1명/);
  assert.match(await page.locator('#prResults').textContent(),/1단위기간/);
  await page.locator('#prGenerate').click();await page.waitForFunction(()=>/생성 완료|생성 중단/.test(document.querySelector('#prState').textContent));
  assert.deepEqual(await page.evaluate(()=>window.builds.map(b=>b[0])),['1','2','17']);assert.equal(await page.evaluate(()=>window.builds[0][2]),'1. 서울(관악구)_모빌리티 AI_서울대_1 단위기간');
  await page.locator('#prDownloads button',{hasText:'1반 Excel'}).first().click();await page.locator('[data-download-preflight] [data-close]').click();
  assert.deepEqual(await page.evaluate(()=>window.saved),[],'closing the preflight downloads nothing');
  await page.locator('#prDownloads button',{hasText:'1반 Excel'}).first().click();await page.locator('[data-download-preflight] [data-confirm]').click();await page.waitForFunction(()=>window.saved.length===1);
  await page.locator('#prDownloads button',{hasText:'ZIP'}).click();assert.match(await page.locator('[data-download-preflight]').textContent(),/생성 불가|수집 실패/);await page.locator('[data-download-preflight] [data-confirm]').click();await page.waitForFunction(()=>window.saved.length===2);
  assert.deepEqual(await page.evaluate(()=>window.saved),['2기_01반_1단위출석부_1028-1127.xlsx','2기_1,2,17반_1단위출석부_1028-1127.zip']);
  assert.deepEqual(await page.evaluate(()=>window.zipped),['2기_01반_1단위출석부_1028-1127.xlsx','2기_02반_1단위출석부_1028-1127.xlsx','2기_17반_1단위출석부_1028-1127.xlsx']);
  assert.ok(await page.locator('#upMake').count(),'the HRD upload tool is still on the same screen');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
