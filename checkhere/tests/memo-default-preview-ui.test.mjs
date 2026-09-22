import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
const base=join(import.meta.dirname,'../..');

async function fixture(page,{modern}){
 await page.route('**/*',route=>{
  const u=new URL(route.request().url()),path=u.pathname.slice(1);
  if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`
   export const collection=(...x)=>x,doc=(...x)=>({id:x.at(-1)}),query=(...x)=>x,where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,serverTimestamp=()=>({seconds:1});
   export const getDocFromServer=(...a)=>getDoc(...a);export async function getDoc(){throw Error('must not read archived proposals');}export async function setDoc(){throw Error('must not create requests');}
   export async function getDocs(){return{docs:window.rows.map(r=>({id:r.id,data:()=>r}))};}
   export async function runTransaction(db,fn){window.transactions++;return fn({get:async ref=>({data:()=>window.rows.find(r=>r.id===ref.id)}),update(ref,data){window.approvals.push(structuredClone(data));Object.assign(window.rows.find(r=>r.id===ref.id),data);}});}
  `});
  if(path==='')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">
   import{mountCheckHereRequests}from'/checkhere-requests.mjs';
   const common={classId:'2',date:'2026-09-03',reason:'가상 검증 사유',status:'pending',createdAt:{seconds:1}};
   window.rows=[{...common,id:'memo-entry',name:'가상입실',changes:{entryMemo:'입실 사유 수정'}},{...common,id:'memo-exit',name:'가상퇴실',changes:{exitMemo:'퇴실 사유 수정'}}];
   window.records=[{name:'가상입실',entry:'',exit:'17:45:23',entryMemo:'기존 입실 사유',exitMemo:'유지할 퇴실 사유'},{name:'가상퇴실',entry:'08:55:07',exit:'',entryMemo:'유지할 입실 사유',exitMemo:'기존 퇴실 사유'}].map((r,i)=>({...common,...r,id:'record-'+i,version:'v1',teacher:'홍길동',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',outings:[]}));
   window.transactions=0;window.approvals=[];window.calls=[];const jobs=[];
   const capabilities=['approval-current-sync-v1','live-approval-preview-v1','approved-requests-v1','memo-only-requests-v1',...(${modern}?['memo-default-time-v1']:[])];
   const controller={state:()=>({records:window.records,jobs,capabilities}),refresh:async()=>{},api:async(path,input)=>{
    const request=window.rows.find(r=>r.id===input.approvalId),record=window.records.find(r=>r.name===request.name);
    if(path==='preview-request')return{record};window.calls.push({path,id:request.id});
    if(path==='apply'){if(request.status!=='approved')throw Error('approval missing');Object.assign(record,request.approval.after,{version:'v2'});request.status='applying';jobs.push({id:request.id,status:'verified'});return{};}
    if(path==='reconcile'){request.status='verified';return{status:'verified',platformSaved:true,message:'체크히어 반영·플랫폼 DB 저장 완료'};}
    throw Error('unexpected action '+path);
   }};
   window.ui=await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture'},classes:[{id:'2'}],admin:true,controller:()=>controller});
  </script>`});
  if(/\.(mjs|js)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,path),'utf8')});
  return route.abort();
 });
 await page.goto('https://fixture.test/');await page.locator('[data-review="memo-entry"]').waitFor();
}

for(const mode of ['single','bulk'])test(`${mode} memo approval previews and stores the missing default time while preserving other fields`,async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await fixture(page,{modern:true});
  for(const [id,column,time] of [['memo-entry','entryMemo','09:00:00'],['memo-exit','exitMemo','18:00:00']]){
   await page.locator(mode==='single'?`[data-review="${id}"]`:`[data-bulk-approve="${column}"]`).click();
   await page.locator('#review[open]').waitFor();const preview=await page.locator('#review').innerText();
   assert.match(preview,/기본시간 자동 입력/);assert(preview.includes(time));
   await page.locator(mode==='single'?'#approve':'#bulkApproveNow').click();
   if(mode==='single')await page.locator('#message').filter({hasText:'체크히어 반영·플랫폼 DB 저장 완료'}).waitFor();
   else{await page.locator('#batchResult').filter({hasText:'검증 완료 1건 / 1건'}).waitFor();await page.locator('#batchClose').click();}
  }
  const result=await page.evaluate(()=>({transactions:window.transactions,approvals:window.approvals,records:window.records,calls:window.calls}));
  assert.equal(result.transactions,2);assert.equal(result.approvals[0].approval.before.entry,'');assert.equal(result.approvals[0].approval.after.entry,'09:00:00');
  assert.equal(result.approvals[0].approval.after.exit,'17:45:23');assert.equal(result.approvals[0].approval.after.exitMemo,'유지할 퇴실 사유');
  assert.equal(result.approvals[1].approval.before.exit,'');assert.equal(result.approvals[1].approval.after.exit,'18:00:00');
  assert.equal(result.approvals[1].approval.after.entry,'08:55:07');assert.equal(result.approvals[1].approval.after.entryMemo,'유지할 입실 사유');
  assert.equal(result.records[0].entry,'09:00:00');assert.equal(result.records[1].exit,'18:00:00');
  assert.deepEqual(result.calls.map(x=>x.path),['apply','reconcile','apply','reconcile']);assert.deepEqual(errors,[]);await page.evaluate(()=>window.ui.dispose());
 }finally{await browser.close();}
});

for(const mode of ['single','bulk'])test(`${mode} memo defaults require a restarted capable collector before any approval transaction`,async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await fixture(page,{modern:false});
  for(const [id,column] of [['memo-entry','entryMemo'],['memo-exit','exitMemo']]){
   await page.locator(mode==='single'?`[data-review="${id}"]`:`[data-bulk-approve="${column}"]`).click();
   if(mode==='single')await page.locator('#message').filter({hasText:'최신 체크히어 시작.cmd를 다시 실행'}).waitFor();
   else{await page.locator('#review[open]').waitFor();assert.match(await page.locator('#review').innerText(),/최신 체크히어 시작.cmd를 다시 실행/);assert(await page.locator('#bulkApproveNow').isDisabled());await page.locator('#batchClose').click();}
  }
  const result=await page.evaluate(()=>({transactions:window.transactions,calls:window.calls,rows:window.rows,records:window.records}));
  assert.equal(result.transactions,0);assert.deepEqual(result.calls,[]);assert(result.rows.every(r=>r.status==='pending'));assert.equal(result.records[0].entry,'');assert.equal(result.records[1].exit,'');assert.deepEqual(errors,[]);await page.evaluate(()=>window.ui.dispose());
 }finally{await browser.close();}
});
