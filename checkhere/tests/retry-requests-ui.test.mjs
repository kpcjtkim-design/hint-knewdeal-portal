import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {firestore} from './retry-fixture.mjs';
const base=join(import.meta.dirname,'../..');
// 가짜 Firestore와 가짜 수집 PC 연결 위에 요청 화면을 엽니다. script는 window.ready=true로 끝나야 합니다.
async function open(script){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>{const u=new URL(route.request().url()),file=join(base,u.pathname.slice(1));if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:firestore});if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">${script}</script>`});if(/\.(mjs|css|json)$/.test(file)&&existsSync(file))return route.fulfill({contentType:file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(file,'utf8')});return route.abort();});
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);return {browser,page,errors};
 }catch(e){await browser.close();throw e;}
}
const failedScript=`
   import {mountCheckHereRequests} from '/checkhere-requests.mjs';
   window.trace=[];window.calls=[];window.docs={};window.fail=true;window.originals=[];
   const common={classId:'2',date:'2026-11-16',phoneLast4:'',reason:'기존 근거',status:'failed',updatedAt:{seconds:10},createdAt:{seconds:1},createdBy:'staff@example.test'};
   for(let i=1;i<=4;i++){const r={...common,id:'failed-original-0000'+i,name:'가상'+i,classId:i===4?'3':'2',changes:{entryMemo:'요청 사유 '+i}};originals.push(structuredClone(r));docs['checkhereRequests/'+r.id]=r;}
   const done={...common,id:'completed-request-001',name:'완료학생',status:'verified',changes:{entryMemo:'완료'},result:{platformSaved:true}};docs['checkhereRequests/'+done.id]=done;
   const records=originals.map((r,i)=>({...r,id:'record-'+i,version:'v1',source:'live',readState:'complete',teacher:'가상담임',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:i===0?r.changes.entryMemo:'기존',exitMemo:'',outings:[]}));const jobs=[];
   const controller={state:()=>({records,jobs,privacy:{state:'unmasked',leftSec:900},capabilities:['approval-current-sync-v1','live-approval-preview-v1','memo-default-time-v1']}),refresh:async()=>{},api:async(path,input)=>{
    const r=docs['checkhereRequests/'+input.approvalId];calls.push({path,id:input.approvalId,name:r?.name});if(!r)throw Error('missing request');
    if(path==='reconcile'){if(r.status==='applying'){r.status='verified';r.result={platformSaved:true,message:'DB 저장 완료'};}return {status:r.status,...r.result};}
    if(path==='preview-request')return {record:records.find(x=>x.name===r.name)};
    if(path==='confirm-existing'){r.status='verified';r.result={platformSaved:true,alreadyApplied:true,message:'이미 반영 · DB 저장 완료'};return {status:'verified',...r.result};}
    if(path==='apply'){if(r.status!=='approved')throw Error('not approved');if(window.fail&&r.name==='가상2'){r.status='failed';r.updatedAt={seconds:200};r.result={message:'연결 오류 시험'};jobs.push({id:input.approvalId,status:'failed',message:'연결 오류 시험'});}else{Object.assign(records.find(x=>x.name===r.name),r.approval.after);r.status='applying';jobs.push({id:input.approvalId,status:'verified'});}return {};}
    throw Error('unexpected '+path);
   }};
   window.ui=await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'},{id:'3'}],admin:true,controller:()=>controller});window.ready=true;
`;
test('filtered retries reconcile first, skip already-applied values, preserve originals and stop before remaining failures',async()=>{
 const {browser,page,errors}=await open(failedScript);
 try{
  await page.locator('#requestClass').selectOption('2');await page.locator('#requestDate').fill('2026-11-16');
  await page.locator('#retryFailures').click();await page.locator('#retryNow').waitFor();assert.equal(await page.locator('#retryNow').innerText(),'3건 다시 처리');await page.locator('#retryNow').click();
  await page.locator('#retryResult').filter({hasText:'검증·DB 저장 완료 1/3건.'}).waitFor();assert.match(await page.locator('#retryResult').innerText(),/나머지 처리를 중단/);
  const first=await page.evaluate(()=>({calls,originalsUnchanged:originals.every(r=>JSON.stringify(docs['checkhereRequests/'+r.id])===JSON.stringify(r)),retryDocs:Object.entries(docs).filter(([p])=>p.includes('/retry_')).map(([p,r])=>({path:p,...r}))}));
  assert.equal(first.originalsUnchanged,true);assert.equal(first.retryDocs.length,2);assert.deepEqual(first.calls.filter(c=>c.path==='apply').map(c=>c.name),['가상2']);assert(first.calls.some(c=>c.path==='confirm-existing'&&c.name==='가상1'));assert(!first.calls.some(c=>c.name==='가상3'||c.name==='가상4'||c.name==='완료학생'));
  for(const apply of first.calls.filter(c=>c.path==='apply'))assert(first.calls.findIndex(c=>c.path==='preview-request'&&c.id===apply.id)<first.calls.indexOf(apply));
  await page.locator('#retryClose').click();await page.evaluate(()=>window.fail=false);await page.locator('#retryFailures').click();await page.locator('#retryNow').waitFor();assert.equal(await page.locator('#retryNow').innerText(),'2건 다시 처리');await page.locator('#retryNow').click();await page.locator('#retryResult').filter({hasText:'검증·DB 저장 완료 2/2건.'}).waitFor();await page.locator('#retryClose').click();
  await page.locator('#requestStatus').selectOption('failures');assert.equal(await page.locator('#list article').count(),0);
  await page.locator('#requestStatus').selectOption('history');assert((await page.locator('#list article').count())>=6,'original and retried histories remain visible');
  const end=await page.evaluate(()=>({originalsUnchanged:originals.every(r=>JSON.stringify(docs['checkhereRequests/'+r.id])===JSON.stringify(r)),other:docs['checkhereRequests/failed-original-00004'].status,calls}));assert.equal(end.originalsUnchanged,true);assert.equal(end.other,'failed');assert.equal(end.calls.filter(c=>c.path==='apply'&&c.name==='가상1').length,0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
// 출결대조 자동 요청(근거에 '출결대조 자동')과 시간 삭제 요청(deleteTimes)은 1기에서 다시 처리하지 않습니다.
const ledgerScript=`
   import {mountCheckHereRequests} from '/checkhere-requests.mjs';
   window.trace=[];window.calls=[];window.docs={};window.originals=[];
   const common={classId:'2',date:'2026-11-16',phoneLast4:'',reason:'기존 근거',status:'failed',updatedAt:{seconds:10},createdAt:{seconds:1},createdBy:'hint.kpc@gmail.com'};
   for(const r of [{...common,id:'failed-plain-request-01',name:'가상일반',changes:{entryMemo:'요청 사유'}},{...common,id:'failed-auto-ledger-0001',name:'가상자동',reason:'[실시간 베타] [2기 베타] 출결대조 자동 · 지각 · 가상 사유 [기준:0123abcd]',changes:{entryMemo:'지각_담임:가상담임(09:30)'}},{...common,id:'failed-time-delete-0001',name:'가상삭제',changes:{exit:''},deleteTimes:['exit']}]){originals.push(structuredClone(r));docs['checkhereRequests/'+r.id]=r;}
   const records=originals.map((r,i)=>({...r,id:'record-'+i,version:'v1',source:'live',readState:'complete',teacher:'가상담임',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:r.changes.entryMemo||'',exitMemo:'',outings:[]}));
   const controller={state:()=>({records,jobs:[],privacy:{state:'unmasked',leftSec:900},capabilities:['approval-current-sync-v1','live-approval-preview-v1','memo-default-time-v1']}),refresh:async()=>{},api:async(path,input)=>{
    const r=docs['checkhereRequests/'+input.approvalId];calls.push({path,id:input.approvalId,name:r?.name});if(!r)throw Error('missing request');
    if(path==='reconcile')return {status:r.status,...r.result};
    if(path==='preview-request')return {record:records.find(x=>x.name===r.name)};
    if(path==='confirm-existing'){r.status='verified';r.result={platformSaved:true,alreadyApplied:true,message:'이미 반영 · DB 저장 완료'};return {status:'verified',...r.result};}
    throw Error('unexpected '+path);
   }};
   window.ui=await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'}],admin:true,controller:()=>controller});window.ready=true;
`;
test('failed auto-ledger and time-delete requests are left out of retries and point to the ledger resend',async()=>{
 const {browser,page,errors}=await open(ledgerScript),row=name=>page.locator('#list article',{hasText:name}),guide=/출결대조에서 다시 보내기 · 출결대조 자동·시간 삭제 요청은 여기서 다시 처리하지 않습니다\. 2기 베타 출결대조\(\/beta2\)에서 그 학생 행의 「체크히어 맞추기」/;
 try{
  await page.locator('#requestClass').selectOption('2');await page.locator('#requestDate').fill('2026-11-16');
  for(const name of ['가상자동','가상삭제']){assert.equal(await row(name).locator('[data-retry]').count(),0,name+': no single retry');assert.equal(await row(name).locator('[data-retry-ledger]').isDisabled(),true);assert.match(await row(name).innerText(),guide);}
  assert.equal(await row('가상일반').locator('[data-retry]').isEnabled(),true,'ordinary failures keep the single retry button');assert.doesNotMatch(await row('가상일반').innerText(),/출결대조에서 다시 보내기/);
  await page.locator('#retryFailures').click();await page.locator('#retryNow').waitFor();assert.equal(await page.locator('#retryNow').innerText(),'1건 다시 처리');
  assert.match(await page.locator('#retryLedger').innerText(),/출결대조 자동·시간 삭제 요청 2건은 여기서 다시 처리하지 않습니다 · 출결대조에서 다시 보내기/);assert.deepEqual(await page.locator('#review tbody th').allInnerTexts(),['2반 · 2026-11-16 · 가상일반']);
  await page.locator('#retryNow').click();await page.locator('#retryResult').filter({hasText:'검증·DB 저장 완료 1/1건.'}).waitFor();await page.locator('#message').filter({hasText:'실패·확인 필요 내역입니다'}).waitFor();await page.locator('#retryClose').click();
  const after=await page.evaluate(()=>({names:[...new Set(calls.map(c=>c.name))],ledgerUnchanged:originals.slice(1).every(r=>JSON.stringify(docs['checkhereRequests/'+r.id])===JSON.stringify(r)),retryDocs:Object.entries(docs).filter(([p])=>p.includes('/retry_')).map(([,r])=>r.name)}));
  assert.deepEqual(after,{names:['가상일반'],ledgerUnchanged:true,retryDocs:['가상일반']});
  assert.deepEqual((await page.locator('#list article').allInnerTexts()).map(t=>/가상자동|가상삭제/.exec(t)?.[0]).sort(),['가상삭제','가상자동'],'ledger failures stay in the failure list with the guide');
  await page.locator('#retryFailures').click();await page.locator('#message').filter({hasText:'다시 처리할 실패 건이 없습니다. 출결대조 자동·시간 삭제 요청 2건은 여기서 다시 처리하지 않습니다 · 출결대조에서 다시 보내기'}).waitFor();
  assert.equal(await page.locator('#review').evaluate(d=>d.open),false,'nothing to retry: no dialog');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
