import test from 'node:test';import assert from 'node:assert/strict';
import {assertChangeAllowed} from '../rules.mjs';import {applyVerified} from '../writeback.mjs';import {version} from '../identity.mjs';
import {CheckHereCollector} from '../collector.mjs';
const base=()=>({id:'fixture',studentKey:'fixture-key',classId:'9',date:'2026-09-10',name:'가상학생',teacher:'',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0});
test('approved time changes preserve the latest memo in the actual editor, while direct edits still check stale values',async()=>{
 const values={},page={locator:selector=>({fill:async v=>{values[selector]=v;},waitFor:async()=>{}}),getByRole:()=>({click:async()=>{}})},adapter=new CheckHereCollector('fixture',{page});adapter.modal=async()=>({time:'12:00:00',memo:'새 메모'});adapter.closeModal=async()=>{};
 await assert.rejects(()=>adapter.write(base(),'entry',{time:'10:00:00',memo:'이전 메모'}),/직전/);
 const result=await adapter.write(base(),'entry',{time:'10:00:00',memo:'이전 메모'},{requestedFields:['entry']});assert.deepEqual(result,{time:'10:00:00',memo:'새 메모'});assert.equal(values['#memoByAdmin'],'새 메모');assert.equal(values['#modifyTime'],'10:00:00');
});
for(const scenario of [{entry:null,exit:null,rawEntry:'09:05:00'},{entry:'13:00:00',exit:'15:00:00',outings:[{start:'14:00',end:'14:20'}]},{exception:'검토 완료'},{schedule:'10:00 ~ 19:00'},{date:new Date().toISOString().slice(0,10),entry:null,exit:null}])test('approved target replaces old attendance classifications '+JSON.stringify(scenario),async()=>{
 const r={...base(),...scenario};r.version=version(r);const request={classId:r.classId,date:r.date,name:r.name,reason:'관리자 요청',changes:{entry:'09:00:00',exit:'18:00:00'}};
 assert.doesNotThrow(()=>assertChangeAllowed(r,request.changes,{requested:true}));let current={...r},writes=0;
 const result=await applyVerified({read:async()=>({...current}),write:async(_,field,c)=>{writes++;current[field]=c.time;current[field+'Memo']=c.memo;}},r,{...r,...request.changes,reason:request.reason},async()=>{},request);
 assert.equal(result.status,'verified');assert.equal(result.current.entry,'09:00:00');assert.equal(result.current.exit,'18:00:00');assert(writes<=2);
});
test('requested fields win over stale snapshots while unrelated later edits remain intact',async()=>{
 const r={...base(),teacher:'가상'};r.version=version(r);let current={...r,entry:'11:00:00',exitMemo:'나중에 입력된 메모'};current.version=version(current);
 const request={classId:r.classId,date:r.date,name:r.name,reason:'관리자 요청',changes:{entry:'10:00:00'}},writes=[];
 const result=await applyVerified({read:async()=>({...current}),write:async(_,field,c)=>{writes.push(field);current[field]=c.time;current[field+'Memo']=c.memo;current.exit='17:00:00';}},r,{...r,entry:'10:00:00',reason:request.reason},async()=>{},request);
 assert.equal(result.status,'verified');assert.deepEqual(writes,['entry']);assert.equal(result.current.exit,'17:00:00');assert.equal(result.current.exitMemo,'나중에 입력된 메모');
});
test('missing requested times and incomplete or wrong student data still cannot be applied',async()=>{
 assert.throws(()=>assertChangeAllowed({...base(),entry:null},{entryMemo:'사유'},{requested:true}),/시간/);
 assert.doesNotThrow(()=>assertChangeAllowed({...base(),entry:null},{exitMemo:'사유'},{requested:true}));
 assert.throws(()=>assertChangeAllowed({...base(),readState:'partial'},{entry:'09:00:00',exit:'18:00:00'},{requested:true}),/기록/);
 const r=base();r.version=version(r);const request={classId:'9',date:r.date,name:r.name,reason:'가상',changes:{entry:'10:00:00'}};let writes=0;
 const result=await applyVerified({read:async()=>({...r,studentKey:'other'}),write:async()=>writes++},r,{...r,reason:'가상'},async()=>{},request);assert.equal(writes,0);assert.equal(result.status,'conflict');
});
