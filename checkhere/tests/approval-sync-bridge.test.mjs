import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {join} from 'node:path';
import {createBridge} from '../server.mjs';import {APPROVER,prepareApproval} from '../approval-core.mjs';import {version} from '../identity.mjs';
test('already-applied endpoint verifies live values, preserves cancellation and retries DB without rewriting CheckHere',async()=>{
 const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/auto-approval-'));let writes=0,reads=0,failSave=true,finishes=0;
 let current={id:'record-auto',studentKey:'fake-student',classId:'2',date:'2026-09-14',name:'가상학생',phoneLast4:'1234',source:'live',readState:'complete',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],schedule:'09:00 ~ 18:00',collectedAt:'2026-09-17T01:00:00.000Z'};current.version=version(current);
 let req={classId:'2',date:current.date,name:current.name,phoneLast4:'1234',reason:'가상 확인',changes:{entryMemo:''},status:'pending'};
 const cloud={verify:async t=>{if(t!=='hint-fixture')throw Error('권한 없음');},get:async id=>({id,data:structuredClone(req)}),approveExisting:async(doc,t,r)=>{assert.equal(req.status,'pending');req={...req,status:'approved',approvedBy:APPROVER,approval:prepareApproval(req,r,{allowAlreadyApplied:true})};return{id:doc.id,data:structuredClone(req)};},claim:async(doc,t,attemptId)=>{assert.equal(req.status,'approved');req.status='applying';req.attemptId=attemptId;},finish:async(id,t,attemptId,job)=>{finishes++;assert.equal(attemptId,req.attemptId);assert.equal(job.current.entryMemo,'');if(failSave)throw Error('DB unavailable');req.status='verified';req.result={platformSaved:true,alreadyApplied:true,message:'이미 반영 · DB 저장 완료'};return req.result;}};
 const adapter={loggedIn:async()=>true,requireLogin:async()=>{},read:async()=>{reads++;return structuredClone(current);},write:async()=>{writes++;throw Error('must not write');}};
 let app=createBridge({dataDir,collector:adapter,port:18766,approvalCloud:cloud});await new Promise(r=>app.server.listen(18766,'127.0.0.1',r));
 const id='auto-request-fixture-001',call=async(path,token='hint-fixture')=>(await fetch('http://127.0.0.1:18766/api/'+path,{method:'POST',headers:{'content-type':'application/json','connection':'close','x-hint-key':app.key},body:JSON.stringify({approvalId:id,idToken:token})})).json();
 try{
  app.put(current);assert.match((await call('confirm-existing','other')).error,/권한/);assert.equal(reads,0);
  current.entryMemo='아직 다름';current.version=version(current);assert.equal((await call('confirm-existing')).status,'pending');assert.equal(req.status,'pending');assert.equal(writes,0);
  current.entryMemo='';current.version=version(current);req.status='withdrawn';assert.equal((await call('confirm-existing')).status,'withdrawn');assert.equal(reads,1);
  req.status='pending';await call('confirm-existing');
  for(let i=0;i<50;i++){const j=JSON.parse(app.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id)?.payload||'{}');if(j.cloudSaved===false)break;await new Promise(r=>setTimeout(r,10));}
  let j=JSON.parse(app.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id).payload);assert.equal(j.status,'verified');assert.equal(j.platformSaved,false);assert.equal(req.status,'applying');assert.equal(j.current.entryMemo,'');assert.equal(writes,0);
  // Reopen the persisted collector job: retry only cloud completion, not remote input.
  app.close();app=createBridge({dataDir,collector:adapter,port:18766,approvalCloud:cloud});await new Promise(r=>app.server.listen(18766,'127.0.0.1',r));failSave=false;
  j=await call('reconcile');assert.equal(j.platformSaved,true);assert.equal(req.status,'verified');assert.equal(writes,0);assert.equal(reads,2);assert.equal(finishes,2);
  assert.equal((await call('confirm-existing')).id,id);assert.equal(writes,0);assert.equal(finishes,2);
 }finally{app.close();}
});
