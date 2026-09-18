import test from 'node:test';
import assert from 'node:assert/strict';
import {CheckHereCollector} from '../collector.mjs';
import {readRequestRecord} from '../request-record.mjs';
import {applyVerified} from '../writeback.mjs';
import {version} from '../identity.mjs';

const record=()=>({id:'test',studentKey:'test-key',classId:'9',date:'2026-08-28',name:'가상학생',phoneLast4:'2222',teacher:'가상',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,url:'https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-08-28'});
test('missing snapshot reuses only the freshly verified day; normal reads still reopen CheckHere',async()=>{
 const r=record(),adapter=new CheckHereCollector('fixture',{page:{url:()=>r.url}});let opens=0,details=0;
 adapter.requireLogin=async()=>{};adapter.openDay=async()=>{opens++;adapter.day={classId:r.classId,date:r.date,url:r.url};return[{...r,readState:'partial'}];};
 adapter.tableRecords=async()=>[{...r,readState:'partial'}];adapter.readDetails=async row=>{details++;return{...row,readState:'complete',version:version(row)};};
 const request={classId:r.classId,date:r.date,name:r.name,changes:{entryMemo:'확인'},reason:'가상 근거'};
 const saved=[];await readRequestRecord(adapter,request,[],[],r=>saved.push(r));assert.equal(opens,1);assert.equal(details,1);assert.equal(saved.length,1);
 await adapter.read(r);assert.equal(opens,2,'independent verification must navigate afresh');
 adapter.day.date='2026-08-27';await assert.rejects(()=>adapter.readOpened(r),/반·날짜/);assert.equal(details,2);
 adapter.day.date=r.date;adapter.tableRecords=async()=>[{...r,studentKey:'other'}];await assert.rejects(()=>adapter.readOpened(r),/학생/);assert.equal(details,2);
});
for(const wrong of [{id:'other'},{studentKey:'other'},{classId:'8'},{date:'2026-08-27'}])test('post-write readback never verifies a different student or day '+JSON.stringify(wrong),async()=>{
 const r=record();r.version=version(r);let current={...r},written=0;
 const result=await applyVerified({read:async()=>written?{...current,...wrong}:{...current},write:async(_,field,value)=>{written++;current[field]=value.time;current[field+'Memo']=value.memo;}},r,{...r,entryMemo:'입실 변경',exitMemo:'퇴실 변경',reason:'가상 검증'},async()=>{});
 assert.equal(result.status,'unknown');assert.equal(written,1,'stop before writing the second field');assert.equal(result.current,undefined,'never publish an unrelated record');
});
