import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('request dialog survives delayed reads, closure, unknown commits and reload without duplicate submissions',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),base=join(import.meta.dirname,'../..');
 try{for(const mode of ['cancel-read','bad-reader','committed-response-lost','unconfirmed-reload','late-transaction']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let readerMode=mode;
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`
    window.docs=JSON.parse(localStorage.getItem('fixtureDocs')||'{}');window.writtenIds=[];
    export const doc=(...x)=>({path:x.slice(1).join('/')}),collection=(...x)=>x,query=(...x)=>x,where=(...x)=>x,serverTimestamp=()=>({seconds:1});
    export async function getDoc(r){const v=window.docs[r.path];return{data:()=>v,exists:()=>!!v};}
    export const getDocFromServer=getDoc;
    export async function getDocs(){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith('checkhereRequests/')).map(([k,v])=>({id:k.split('/')[1],data:()=>v}))};}
    export async function runTransaction(db,fn){
     const tx={get:getDoc,set:(r,v)=>{window.docs[r.path]=v;if(r.path.startsWith('checkhereRequests/'))window.writtenIds.push(r.path);localStorage.setItem('fixtureDocs',JSON.stringify(window.docs));}};
     if(window.txMode==='unconfirmed-reload'||window.txMode==='late-transaction')return new Promise((resolve,reject)=>{window.finishTransaction=()=>fn(tx).then(resolve,reject);});
     const out=await fn(tx);if(window.txMode==='committed-response-lost')return new Promise(()=>{});return out;
    }`});
   if(u.pathname==='/api/attendance-reader'){
    assert.equal(route.request().postDataJSON().fresh,true,'approval source checks bypass display cache');
    if(readerMode==='cancel-read'){await new Promise(r=>setTimeout(r,1000));return route.fulfill({json:{ok:false}}).catch(()=>{});}
    if(readerMode==='bad-reader')return route.fulfill({status:502,contentType:'text/html',body:'<html>upstream</html>'});
    return route.fulfill({json:{ok:true,attendance:[['이름','','','','9/3'],['가상학생','','','','출석']],reasons:[['','','','','9/3'],['','','','','']]}});
   }
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">
    import{createProposalReview}from'/checkhere-proposals.mjs';window.txMode=localStorage.getItem('nextTxMode')||'${mode}';
    const s={name:'가상학생',rowIndex:0},record={id:'fixture-record',version:'v1',classId:'2',date:'2026-09-03',name:s.name,phoneLast4:'1234',teacher:'담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'',outings:[]},root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML='<div id="rows"></div>';
    function render(){root.querySelector('#rows').innerHTML=review.html(s,'entryMemo');review.bind([s]);}
    const review=createProposalReview({db:{},user:{email:'fixture@example.com',getIdToken:async()=>'fixture'},root,getContext:()=>({classId:'2',date:'2026-09-03',name:s.name,status:'출석',reason:'',raw:'',record}),render,showErr:e=>{window.problem=e.message},hasUnsavedReason:()=>false,timeouts:{source:400,read:150,write:200}});window.review=review;await review.load('2','2026-09-03');render();
   </script>`});
   const file=u.pathname.slice(1);if(['attendance-io.mjs','checkhere-proposals.mjs','checkhere-request-actions.mjs','attendance-reason-parser.mjs','attendance-beta-core.mjs','checkhere/approval-core.mjs','checkhere/rules.mjs','checkhere-proposal-core.mjs','timetable-core.mjs'].includes(file))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,file),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.locator('[data-proposal-send]').click();await page.locator('#sendSelected').click();
  const count=()=>page.evaluate(()=>Object.keys(window.docs).filter(k=>k.startsWith('checkhereRequests/')).length);
  if(mode==='cancel-read'){
   await page.getByText(/시트 원본 확인 중/).waitFor();assert(await page.locator('#closeRequests').isEnabled());await page.locator('#closeRequests').click();await page.waitForFunction(()=>!window.review.isWorking());assert.equal(await count(),0);assert(await page.locator('[data-proposal-send]').isEnabled());
  }else if(mode==='bad-reader'){
   await page.getByText(/0건 요청 접수 · 1건 실패/).waitFor();assert(await page.locator('#closeRequests').isEnabled());assert.equal(await count(),0);await page.locator('#closeRequests').click();
   readerMode='ok';await page.evaluate(()=>window.txMode='ok');await page.locator('[data-proposal-send]').click();await page.locator('#sendSelected').click();await page.getByText(/1건 요청 접수 · 0건 실패/).waitFor();assert.equal(await count(),1);
  }else if(mode==='committed-response-lost'){
   await page.getByText(/1건 요청 접수 · 0건 실패/).waitFor();assert.equal(await count(),1);await page.locator('#closeRequests').click();assert(await page.locator('[data-proposal-send]').isDisabled());assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('hintProposalReceipts_v1_fixture@example.com'))).length),0);
  }else{
   await page.getByText(/1건 접수 확인 필요/).waitFor();assert.equal(await count(),0);await page.locator('#closeRequests').click();assert(await page.locator('[data-proposal-send]').isDisabled());
   const originalId=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('hintProposalReceipts_v1_fixture@example.com')))[0].id);
   if(mode==='late-transaction'){await page.evaluate(()=>window.finishTransaction());await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('hintProposalReceipts_v1_fixture@example.com')))[0]?.state==='retry');assert.equal(await count(),0,'late transaction callback must not write after its deadline');await page.evaluate(()=>window.txMode='ok');}
   else{await page.evaluate(()=>localStorage.setItem('nextTxMode','ok'));await page.reload();await page.locator('[data-proposal-receipt]').waitFor();assert(await page.locator('[data-proposal-send]').isDisabled());}
   await page.locator('[data-proposal-receipt]').click();await page.getByText('동일 요청 번호로 재시도 가능',{exact:true}).waitFor();await page.locator('[data-proposal-send]').click();await page.locator('#sendSelected').click();await page.getByText(/1건 요청 접수 · 0건 실패/).waitFor();
   assert.equal(await count(),1);assert.equal(await page.evaluate(()=>window.writtenIds[0]),'checkhereRequests/'+originalId);
  }
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
