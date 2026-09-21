import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovalCloud} from '../cloud-approval.mjs';
import {applyVerified} from '../writeback.mjs';
import {APPROVER,prepareApproval,proposalFromApproval,requestMatchesRecord} from '../approval-core.mjs';
import {version} from '../identity.mjs';
const record=(patch={})=>{const r={id:'record-1',studentKey:'student-1',classId:'2',date:'2026-09-14',name:'가상학생',phoneLast4:'1234',teacher:'홍길동',source:'live',readState:'complete',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'',outings:[],schedule:'09:00 ~ 18:00',collectedAt:'2026-09-17T01:00:00.000Z',...patch};return{...r,version:version(r)};};
const request=(changes={entryMemo:''})=>({classId:'2',date:'2026-09-14',name:'가상학생',phoneLast4:'1234',reason:'가상 검증 근거',changes});
const enc=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(enc)}}:typeof v==='object'?{mapValue:{fields:pack(v)}}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
const pack=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,enc(v)]));
const dec=v=>'mapValue'in v?unpack(v.mapValue.fields):'arrayValue'in v?(v.arrayValue.values||[]).map(dec):'integerValue'in v?+v.integerValue:Object.values(v)[0];
const unpack=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,dec(v)]));
function fixture({missing=false,fail=false,loseResponse=false,conflict=false}={}){
 const before=record(),clean=request(),id='fixture-request-012345';
 let req={...clean,status:'applying',attemptId:'attempt-0123456789',approvedBy:APPROVER,approval:prepareApproval(clean,before)},rev=1;
 const other=record({id:'other',studentKey:'other',name:'다른학생',duration:12.5});
 let snapshot=missing?null:{classId:'2',date:before.date,records:[before,other],updatedBy:APPROVER,jobId:'old'},snapshotRev=1,commits=0;
 const calls=[],writes=[];
 const cloud=createApprovalCloud({fetchImpl:async(url,options={})=>{
  calls.push(url);if(url.endsWith(':runQuery'))return Response.json([{document:{fields:pack({records:[before,other]})}}]);
  if(url.endsWith(':commit')){
   const list=JSON.parse(options.body).writes;writes.push(list);
   if(fail)return new Response('{}',{status:403});
   if(conflict){conflict=false;snapshot.records.push(record({id:'third',studentKey:'third',name:'추가학생'}));snapshotRev++;return new Response('{}',{status:412});}
   for(const w of list){const isSnapshot=w.update.name.includes('/checkhereCurrent/');assert.deepEqual(w.currentDocument,isSnapshot?(snapshot?{updateTime:'s'+snapshotRev}:{exists:false}):{updateTime:'r'+rev});assert.equal(w.updateTransforms[0].setToServerValue,'REQUEST_TIME');}
   for(const w of list){if(w.update.name.includes('/checkhereCurrent/')){snapshot=unpack(w.update.fields);snapshotRev++;}else {Object.assign(req,unpack(w.update.fields));rev++;}}
   commits++;if(loseResponse){loseResponse=false;throw Error('response lost');}return Response.json({commitTime:'saved'});
  }
  if(url.includes('/checkhereCurrent/'))return snapshot?Response.json({fields:pack(snapshot),updateTime:'s'+snapshotRev}):new Response('{}',{status:404});
  return Response.json({fields:pack(req),updateTime:'r'+rev});
 }});
 const current=record({entryMemo:'',collectedAt:'2026-09-17T02:00:00.000Z'}),job={id,status:'verified',current,results:[],alreadyApplied:true};
 return{cloud,job,id,get req(){return req;},get snapshot(){return snapshot;},get commits(){return commits;},calls,writes};
}
test('completion atomically saves current day and request, preserves other students and decimals, and retries idempotently',async()=>{
 const f=fixture();const result=await f.cloud.finish(f.id,'fixture','attempt-0123456789',f.job);
 assert.equal(result.platformSaved,true);assert.equal(result.alreadyApplied,true);assert.equal(f.req.status,'verified');assert.equal(f.snapshot.records.length,2);assert.equal(f.snapshot.records.find(r=>r.id==='record-1').entryMemo,'');assert.equal(f.snapshot.records.find(r=>r.id==='other').duration,12.5);
 assert.equal(f.writes[0].length,2);assert(!f.calls.some(x=>x.includes('checkhereSnapshots')));await f.cloud.finish(f.id,'fixture','attempt-0123456789',f.job);assert.equal(f.commits,1);
});
test('first current save preserves legacy classmates and concurrent snapshot writes are merged on retry',async()=>{
 for(const options of [{missing:true},{conflict:true}]){const f=fixture(options);await f.cloud.finish(f.id,'fixture','attempt-0123456789',f.job);assert.equal(f.snapshot.records.length,options.conflict?3:2);assert.equal(f.req.result.platformSaved,true);}
});
test('partially applied jobs save the actual readback while retaining partial status',async()=>{
 const f=fixture();const job={...f.job,status:'partial',alreadyApplied:false,current:record({entryMemo:'일부만 저장됨',collectedAt:'2026-09-17T02:00:00.000Z'}),message:'일부 반영 · 재확인'};
 const result=await f.cloud.finish(f.id,'fixture','attempt-0123456789',job);assert.equal(result.platformSaved,true);assert.equal(f.req.status,'partial');assert.equal(f.snapshot.records.find(r=>r.id==='record-1').entryMemo,'일부만 저장됨');assert.equal(result.alreadyApplied,false);
});
test('DB save rejection cannot mark request complete; ambiguous commit can be reconciled without another write',async()=>{
 const failed=fixture({fail:true});await assert.rejects(()=>failed.cloud.finish(failed.id,'fixture','attempt-0123456789',failed.job));assert.equal(failed.req.status,'applying');assert.equal(failed.snapshot.records.find(r=>r.id==='record-1').entryMemo,'기존 사유');
 const lost=fixture({loseResponse:true});await assert.rejects(()=>lost.cloud.finish(lost.id,'fixture','attempt-0123456789',lost.job));assert.equal((await lost.cloud.finish(lost.id,'fixture','attempt-0123456789',lost.job)).platformSaved,true);assert.equal(lost.commits,1);
});
test('missing readback or wrong student cannot mark successful platform save',async()=>{
 for(const current of [null,record({id:'wrong',entryMemo:''}),record({entryMemo:'different'}),record({source:'snapshot',entryMemo:''})]){const f=fixture();await assert.rejects(()=>f.cloud.finish(f.id,'fixture','attempt-0123456789',{...f.job,current}));assert.equal(f.commits,0);assert.equal(f.req.status,'applying');}
});
test('fresh already-matching requested fields complete without writing, preserving unrelated remote changes',async()=>{
 const before=record(),req=request(),input=proposalFromApproval({...req,status:'approved',approvedBy:APPROVER,approval:prepareApproval(req,before)});
 const current=record({entryMemo:'',exitMemo:'다른 직원의 최신 메모',exit:'17:00:00'});let writes=0;
 const result=await applyVerified({read:async()=>current,write:async()=>{writes++;}},before,input,async()=>{},req);
 assert.equal(result.alreadyApplied,true);assert.equal(result.current.exit,'17:00:00');assert.equal(result.current.exitMemo,'다른 직원의 최신 메모');assert.equal(writes,0);
});
test('partial match attempts remaining targets; wrong identity and incomplete reads never write',async()=>{
 const before=record(),req=request({entryMemo:'',exitMemo:'requested'}),input=proposalFromApproval({...req,status:'approved',approvedBy:APPROVER,approval:prepareApproval(req,before)});
 for(const current of [record({entryMemo:''}),record({id:'other',entryMemo:'',exitMemo:'requested'}),record({entryMemo:'',exitMemo:'requested',readState:'partial'})]){
  let writes=0,result;try{result=await applyVerified({read:async()=>current,write:async()=>{writes++;}},before,input,async()=>{},req);}catch{}
  assert.notEqual(result?.status,'verified');assert.equal(writes,current.id===before.id&&current.readState==='complete'?1:0);
 }
});
test('already-empty memo can be approved without inventing missing attendance times',()=>{
 const r=record({entry:'',exit:'',entryMemo:''}),req=request(),approval=prepareApproval(req,r,{allowAlreadyApplied:true});
 assert(!Object.hasOwn(approval.after,'entry'));assert(!Object.hasOwn(approval.after,'exit'));assert.equal(proposalFromApproval({...req,approval,status:'approved',approvedBy:APPROVER}).entry,'');
});
test('unread memo is never treated as a confirmed blank memo',()=>{
 for(const entryMemo of [null,undefined])assert.equal(requestMatchesRecord(request(),record({entryMemo})),false);
});
