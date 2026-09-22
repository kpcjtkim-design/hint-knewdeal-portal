import test from 'node:test';
import assert from 'node:assert/strict';
import {CheckHereCollector} from '../collector.mjs';
import {APPROVER,prepareApproval,proposalFromApproval} from '../approval-core.mjs';
import {applyVerified} from '../writeback.mjs';
import {version} from '../identity.mjs';
import {RULES,normalizeTime} from '../rules.mjs';
import {createApprovalCloud} from '../cloud-approval.mjs';
const makeRecord=patch=>{const r={id:'fixture-record',studentKey:'fixture-key',name:'가상학생',classId:'2',date:'2026-09-14',source:'live',readState:'complete',entry:'09:05:00',exit:'17:55:00',entryMemo:'',exitMemo:'',schedule:'09:00 ~ 18:00',outings:[],outingCount:0,collectedAt:'2026-09-22T01:00:00Z',...patch};return {...r,version:version(r)};};
const makeRequest=changes=>({classId:'2',date:'2026-09-14',name:'가상학생',reason:'직원 요청 검토',changes});
async function apply(patch,changes,{dropTime=false,latestBeforeEdit=null}={}){
 const original=makeRecord(patch),request=makeRequest(changes),approval=prepareApproval(request,original),input=proposalFromApproval({...request,status:'approved',approvedBy:APPROVER,approval});
 let current={...original},field;const values={},writes=[],log=[];
 const page={locator:selector=>({fill:async value=>{values[selector]=value;},waitFor:async()=>{}}),getByRole:()=>({click:async()=>{writes.push(field);current[field]=dropTime?null:values['#modifyTime'];current[field+'Memo']=values['#memoByAdmin'];}})};
 const adapter=new CheckHereCollector('fixture',{page});adapter.closeModal=async()=>{};adapter.read=async()=>({...current,version:version(current)});
 adapter.modal=async(_,f)=>{field=f;if(latestBeforeEdit){current={...current,...latestBeforeEdit};latestBeforeEdit=null;}return {time:current[f],memo:current[f+'Memo']};};
 const result=await applyVerified(adapter,original,input,async e=>log.push(e),request);
 return {result,current,writes,log,approval,request};
}
for(const scenario of [
 {label:'missing entry',patch:{entry:null},changes:{entryMemo:'입실 사유'},entry:normalizeTime(RULES.start),exit:'17:55:00',fields:['entry']},
 {label:'missing exit',patch:{exit:null},changes:{exitMemo:'퇴실 사유'},entry:'09:05:00',exit:normalizeTime(RULES.end),fields:['exit']},
 {label:'both blank but only entry memo requested',patch:{entry:null,exit:null},changes:{entryMemo:'입실 사유'},entry:normalizeTime(RULES.start),exit:null,fields:['entry']},
 {label:'both blank but only exit memo requested',patch:{entry:null,exit:null},changes:{exitMemo:'퇴실 사유'},entry:null,exit:normalizeTime(RULES.end),fields:['exit']},
 {label:'both blank and both memos requested',patch:{entry:null,exit:null},changes:{entryMemo:'입실 사유',exitMemo:'퇴실 사유'},entry:normalizeTime(RULES.start),exit:normalizeTime(RULES.end),fields:['entry','exit']},
 {label:'existing times',patch:{},changes:{entryMemo:'입실 사유',exitMemo:'퇴실 사유'},entry:'09:05:00',exit:'17:55:00',fields:[]},
 {label:'clearing existing memo with missing time',patch:{entry:null,entryMemo:'삭제할 사유'},changes:{entryMemo:''},entry:normalizeTime(RULES.start),exit:'17:55:00',fields:['entry']}
])test('approved memo fills only missing corresponding time: '+scenario.label,async()=>{
 const {result,current,log,approval}=await apply(scenario.patch,scenario.changes);
 assert.equal(result.status,'verified');assert.equal(current.entry,scenario.entry);assert.equal(current.exit,scenario.exit);
 assert.deepEqual(result.results.filter(r=>r.automaticTime).map(r=>r.field),scenario.fields);
 assert.deepEqual(log.filter(e=>e.phase==='before_write'&&e.defaultTime).map(e=>e.field),scenario.fields);
 assert.deepEqual(Object.keys(approval).sort(),['after','before','reason','recordId','version']);
 assert.deepEqual(result.current.entry,scenario.entry);assert.deepEqual(result.current.exit,scenario.exit);
});
test('a real time entered just before saving wins over the planned default',async()=>{
 const {result}=await apply({entry:null},{entryMemo:'요청 사유'},{latestBeforeEdit:{entry:'10:12:13'}});
 assert.equal(result.status,'verified');assert.equal(result.current.entry,'10:12:13');assert(!result.results.some(r=>r.automaticTime));
});
test('already-empty memo never adds missing times',async()=>{
 const r=makeRecord({entry:null,exit:null}),request=makeRequest({entryMemo:''}),approval=prepareApproval(request,r,{allowAlreadyApplied:true});let writes=0;
 const result=await applyVerified({read:async()=>r,write:async()=>writes++},r,proposalFromApproval({...request,status:'approved',approvedBy:APPROVER,approval}),async()=>{},request);
 assert.equal(result.alreadyApplied,true);assert.equal(writes,0);assert.equal(result.current.entry,null);assert.equal(result.current.exit,null);
});
test('approval cannot introduce arbitrary times into unrequested or already recorded fields',()=>{
 const r=makeRecord({entry:null,exit:null}),request=makeRequest({entryMemo:'사유'}),approval=prepareApproval(request,r),approved={...request,status:'approved',approvedBy:APPROVER,approval};
 assert.equal(proposalFromApproval(approved).entry,normalizeTime(RULES.start));
 for(const patch of [{entry:'10:00:00'},{exit:'18:00:00'}])assert.throws(()=>proposalFromApproval({...approved,approval:{...approval,after:{...approval.after,...patch}}}),/일치/);
});
test('memo text saved without its default time is failed, never verified',async()=>{
 const {result}=await apply({entry:null},{entryMemo:'사유'},{dropTime:true});assert.equal(result.status,'failed');assert(!result.results.some(r=>r.state==='verified'));assert(!result.results.some(r=>r.automaticTime));
});
const encode=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:typeof v==='object'?{mapValue:{fields:pack(v)}}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:{integerValue:String(v)};
const pack=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,encode(v)]));
const decode=v=>v.mapValue?unpack(v.mapValue.fields):v.arrayValue?v.arrayValue.values.map(decode):Object.values(v)[0];
const unpack=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,decode(v)]));
test('actual default time and memo reach DB snapshot atomically, and missing verified time cannot mark DB success',async()=>{
 const applied=await apply({entry:null},{entryMemo:'사유'}),id='fixture-default-012345',request={...applied.request,status:'applying',approvedBy:APPROVER,approval:applied.approval,attemptId:'attempt'};let commits=[];
 const cloud=createApprovalCloud({fetchImpl:async(url,options={})=>{
  if(url.endsWith(':commit')){commits.push(JSON.parse(options.body).writes);return Response.json({});}
  if(url.includes('/checkhereCurrent/'))return Response.json({fields:pack({records:[]}),updateTime:'s1'});
  return Response.json({fields:pack(request),updateTime:'r1'});
 }});
 const job={...applied.result,id};const result=await cloud.finish(id,'fixture-token','attempt',job);
 assert.equal(result.platformSaved,true);assert.match(result.message,/누락 시간 자동 입력: 입실 09:00:00/);
 const snapshot=unpack(commits[0].find(w=>w.update.name.includes('/checkhereCurrent/')).update.fields);
 assert.equal(snapshot.records[0].entry,'09:00:00');assert.equal(snapshot.records[0].entryMemo,'사유');assert.equal(commits[0].length,2);
 commits=[];await assert.rejects(()=>cloud.finish(id,'fixture-token','attempt',{...job,current:{...job.current,entry:null}}),/자동 입력 시간/);assert.equal(commits.length,0);
});
