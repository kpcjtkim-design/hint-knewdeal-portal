import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

test('automatic recognized types share display and request validation, including persisted approval evidence',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`
    window.docs={};window.metaReads=0;window.docReads=0;export const doc=(...x)=>({path:x.slice(1).join('/')}),collection=(...x)=>x,query=(...x)=>x,where=(...x)=>x,serverTimestamp=()=>({seconds:1});
    export async function getDoc(r){window.docReads++;if(r.path.startsWith('settings/'))window.metaReads++;const v=window.docs[r.path];return{data:()=>v,exists:()=>!!v};}export const getDocFromServer=getDoc;
    export async function getDocs(){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith('checkhereRequests/')).map(([k,v])=>({id:k.split('/')[1],data:()=>v}))};}
    export async function runTransaction(db,fn){return fn({get:getDoc,set:(r,v)=>{window.docs[r.path]=v;},update:(r,v)=>Object.assign(window.docs[r.path],v)});}
   `});
   if(u.pathname==='/api/attendance-reader')return route.fulfill({json:await page.evaluate(()=>({ok:true,attendance:[['이름','','','','9/14'],['가상학생','','','',window.sheetStatus]],reasons:[['','','','','9/14'],['','','','',window.sheetRaw]]}))});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">
    import{createProposalReview,validateSheetSource,validateLinkedRequest}from'/checkhere-proposals.mjs';
    import{deriveRecognized}from'/attendance-derived-core.mjs';
    const user={email:'staff@example.com',getIdToken:async()=>'fixture'},s={name:'가상학생',rowIndex:0};
    window.sheetStatus='인정출석';window.sheetRaw='가상학생: 병원';
    window.record={id:'fixture-record',version:'v1',classId:'2',date:'2026-09-14',name:s.name,teacher:'홍길동',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'12:56:01',exit:'17:50:04',entryMemo:'',exitMemo:'',outings:[]};
    window.context={classId:'2',date:'2026-09-14',studentKey:'0_가상학생',name:s.name,status:'인정지각',reason:'병원',raw:window.sheetRaw,record:window.record,excursion:false};
    const root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML='<div id="rows"></div>';
    const render=()=>{root.querySelector('#rows').innerHTML=review.html(s,'entryMemo');review.bind([s]);};
    const review=createProposalReview({db:{},user,root,getContext:()=>context,render,showErr:e=>{window.problem=e.message},hasUnsavedReason:()=>false});
    window.validate=async()=>{try{await validateSheetSource({},user,context);return'ok';}catch(e){return e.message;}};
    window.display=()=>deriveRecognized(sheetStatus,docs['settings/attendanceBeta_2_2026-09-14']?.students?.['0_가상학생'],context.record,{excursion:context.excursion}).status;
    window.approvalCheck=async()=>{const [path,r]=Object.entries(docs).find(([k])=>k.startsWith('checkhereRequests/'));try{await validateLinkedRequest({},user,{id:path.split('/')[1],...r},record);return'ok';}catch(e){return e.message;}};
    await review.load('2','2026-09-14');render();
   </script>`});
   const path=u.pathname.slice(1);if(['checkhere-proposals.mjs','attendance-derived-core.mjs','checkhere-request-actions.mjs','attendance-reason-parser.mjs','attendance-io.mjs','attendance-beta-core.mjs','checkhere/approval-core.mjs','checkhere/rules.mjs','checkhere-proposal-core.mjs'].includes(path))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.locator('[data-proposal-send]').waitFor();
  assert.equal(await page.evaluate(()=>window.display()),'인정지각');
  assert.equal(await page.evaluate(()=>window.validate()),'ok','unchanged Sheet recognized attendance must match automatic recognized lateness');
  await page.locator('[data-proposal-send]').click();await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'1건 요청 접수 · 0건 실패'}).waitFor();await page.locator('#closeRequests').click();
  assert.equal(await page.evaluate(()=>window.approvalCheck()),'ok','saved evidence preserves absent rawEntry and works at approval');
  assert.equal(await page.evaluate(()=>Object.values(window.docs).find(v=>v.sourceScope).record.rawEntry),'12:56:01');
  // Historical values are not a lock: approve against a fresh preview instead.
  await page.evaluate(()=>{record.entryMemo='다른 직원이 수정한 기존 사유';record.entry='13:15:00';record.outings=[{start:'14:00',end:'14:20'}];});
  assert.equal(await page.evaluate(()=>window.approvalCheck()),'ok','changed current time, memo and outings do not invalidate the immutable target');
  await page.evaluate(()=>{record.name='다른학생';});assert.match(await page.evaluate(()=>window.approvalCheck()),/학생 이름/,'student identity remains protected');
  await page.evaluate(()=>{record.name='가상학생';record.entryMemo='';record.entry='12:56:01';record.outings=[];});
  // An earlier verified time request may normalize the entry time before this memo is approved.
  await page.evaluate(()=>{window.docs['checkhereRequests/verified-times']={status:'verified',approvedBy:'hint.kpc@gmail.com',changes:{entry:'09:00:00'},approval:{recordId:record.id,before:{entry:'12:56:01'},after:{entry:'09:00:00'}}};record.entry='09:00:00';});
  assert.equal(await page.evaluate(()=>window.approvalCheck()),'ok');
  await page.evaluate(()=>{record.entry='12:56:01';window.sheetStatus='결석';});
  assert.match(await page.evaluate(()=>window.validate()),/바뀌었습니다/,'real status changes still block');
  await page.evaluate(()=>{window.sheetStatus='인정출석';window.sheetRaw='가상학생: 면접';});
  assert.match(await page.evaluate(()=>window.validate()),/사유가 바뀌었습니다/);
  await page.evaluate(()=>{window.sheetRaw='가상학생: 병원\n다른학생: 시험';});assert.equal(await page.evaluate(()=>window.validate()),'ok','unrelated student edits do not block');
  const readsBefore=await page.evaluate(()=>window.docReads);
  await page.evaluate(()=>{for(const [k,v]of Object.entries(docs))if(k.startsWith('checkhereProposalSources/')){v.status='인정출석';v.reason='오래된 사유';v.changes={exit:'16:00:00',entry:'09:00:00'};}sheetStatus='결석';sheetRaw='가상학생: 변경된 시트 사유';});
  assert.equal(await page.evaluate(()=>window.approvalCheck()),'ok','archived proposal and changed Sheet are not approval locks');
  await page.evaluate(()=>{for(const k of Object.keys(docs))if(k.startsWith('checkhereProposalSources/'))delete docs[k];});
  assert.equal(await page.evaluate(()=>window.approvalCheck()),'ok','missing archived proposal does not block an existing request');
  assert.equal(await page.evaluate(()=>window.docReads),readsBefore,'approval must not read archived proposals or Sheet metadata');
  await page.evaluate(()=>{sheetRaw='가상학생: 병원';});
  // Use the display algorithm as the oracle, including manual decisions and excursion exceptions.
  for(const scenario of [
   {status:'인정조퇴',record:{entry:'09:00:00',exit:'15:39:59'}},
   {status:'인정외출',record:{entry:'09:00:00',exit:'18:00:00',outingCount:1,outings:[{start:'13:00',end:'14:00',recognized:true}]}},
   {status:'인정출석',record:{entry:null,exit:null}},
   {status:'인정출석',record:{entry:'09:00:00',exit:'18:00:00'}},
   {status:'인정출석',excursion:true,record:{entry:'12:56:01',exit:'18:00:00'}},
   {status:'인정출석',record:{entry:'12:56:01',exit:'18:00:00',exception:'견학'}},
   {status:'인정출석',record:{entry:'09:00:00',exit:'18:00:00',outingCount:2,outings:[{start:'13:00',end:'14:00'}]}},
   {status:'인정조퇴',meta:{sheetStatus:'인정출석',portalStatus:'인정조퇴'},record:{entry:'12:56:01',exit:'15:39:59'}},
   {status:'출석',raw:'출석',record:{entry:'09:00:00',exit:'18:00:00'}}
  ]){
   await page.evaluate(s=>{context.record={...record,outings:[],outingCount:0,exception:null,...s.record};context.excursion=!!s.excursion;context.status=s.status;sheetStatus=s.raw||'인정출석';docs['settings/attendanceBeta_2_2026-09-14']={students:{'0_가상학생':s.meta||{}}};},scenario);
   assert.equal(await page.evaluate(()=>window.display()),scenario.status);
   assert.equal(await page.evaluate(()=>window.validate()),'ok',JSON.stringify(scenario));
  }
  await page.evaluate(()=>{context.record={...record};context.status='인정지각';sheetStatus='인정출석';docs['settings/attendanceBeta_2_2026-09-14']={students:{'0_가상학생':{sheetStatus:'인정출석',portalStatus:'인정조퇴'}}};});
  assert.match(await page.evaluate(()=>window.validate()),/바뀌었습니다/,'a newer manual classification must still block');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
