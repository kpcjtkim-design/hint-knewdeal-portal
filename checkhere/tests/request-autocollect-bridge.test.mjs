import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createBridge} from '../server.mjs';
import {createApprovalCloud} from '../cloud-approval.mjs';
import {prepareApproval,APPROVER} from '../approval-core.mjs';
import {version} from '../identity.mjs';
import {encodeFields,decodeFields} from '../../lib/survey-sync-store.mjs';

test('approval with no local snapshot collects the right homonym, writes only requested fields and commits readback to DB',async()=>{
 const identities=[{name:'가상학생(99년생)',phoneLast4:'1111'},{name:'가상학생(02년생)',phoneLast4:'2222'}];
 let current={id:'target',studentKey:'key2',classId:'9',date:'2026-08-28',name:'가상학생',teacher:'가상',phoneLast4:'2222',source:'live',readState:'complete',outingCount:0,entry:'12:00:00',rawEntry:'12:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',schedule:'09:00 ~ 18:00',outings:[],collectedAt:'2026-09-18T01:00:00Z'};current.version=version(current);
 const request={classId:'9',date:current.date,name:identities[1].name,phoneLast4:'',reason:'가상 확인',changes:{entryMemo:'(인정지각)병원_담임:가상(12:00)'}};
 let data={...request,status:'approved',approvedBy:APPROVER,approval:prepareApproval(request,current,{identities})};
 // A later unrelated memo must be preserved even on a fresh collector PC.
 current.exitMemo='나중에 입력된 퇴실 사유';current.version=version(current);
 const writes=[],dbRecords=[],reads=[];let rosterReads=0,update=1;
 const cloud=createApprovalCloud({fetchImpl:async(url,options={})=>{
  if(url.endsWith('/classes/9'))return new Response(JSON.stringify({fields:encodeFields({surveyDuplicateIdentities:identities})}));
  if(url.includes('/checkhereRequests/'))return new Response(JSON.stringify({fields:encodeFields(data),updateTime:'time-'+update}));
  if(url.includes('/checkhereCurrent/'))return new Response(JSON.stringify({fields:encodeFields({records:[]}),updateTime:'day-time'}));
  if(url.endsWith(':commit')){for(const write of JSON.parse(options.body).writes){if(write.update.name.includes('/checkhereRequests/')){Object.assign(data,decodeFields(write.update.fields));update++;}else dbRecords.push(...decodeFields(write.update.fields).records);}return new Response('{}');}
  throw Error('unexpected route');
 }});cloud.verify=async token=>{if(token!=='fixture')throw Error('권한 없음');};
 const adapter={loggedIn:async()=>true,requireLogin:async()=>{},openDay:async()=>{rosterReads++;return[{...current,id:'other',studentKey:'key1',phoneLast4:'1111'},{...current,readState:'partial'}];},read:async r=>{reads.push(r.id);assert.equal(r.id,'target');return structuredClone(current);},write:async(r,field,value)=>{writes.push({id:r.id,field,...value});current[field]=value.time;current[field+'Memo']=value.memo;current.version=version(current);}};
 const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/request-auto-')),collector:adapter,port:18769,approvalCloud:cloud});await new Promise(r=>app.server.listen(18769,'127.0.0.1',r));
 const id='autocollect-homonym-01',call=async(token='fixture')=>(await fetch('http://127.0.0.1:18769/api/apply',{method:'POST',headers:{'content-type':'application/json','x-hint-key':app.key,'connection':'close'},body:JSON.stringify({approvalId:id,idToken:token})})).json();
 try{
  assert.match((await call('other-admin')).error,/권한/);assert.equal(rosterReads,0);
  const started=await call();assert.equal(started.kind,'apply');
  for(let i=0;i<100&&data.status!=='verified';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(data.status,'verified',JSON.stringify(data.result));assert.equal(data.result.platformSaved,true);assert.equal(rosterReads,1);
  assert.deepEqual(writes,[{id:'target',field:'entry',time:'12:00:00',memo:request.changes.entryMemo}]);
  assert.equal(dbRecords.length,1);assert.equal(dbRecords[0].id,'target');assert.equal(dbRecords[0].exitMemo,'나중에 입력된 퇴실 사유');
  assert.equal(dbRecords[0].entryMemo,request.changes.entryMemo);assert(reads.length>=3);
  await call();assert.equal(writes.length,1,'repeated clicks do not execute again');
 }finally{app.close();}
});
