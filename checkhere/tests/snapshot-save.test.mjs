import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotSaver} from '../../checkhere-snapshot-save.mjs';
const row=(id='one',classId='2')=>({id,version:'v1',classId,date:'2026-07-27',name:'가상학생',source:'live',collectedAt:'2026-09-15T01:00:00Z',readState:'complete',entry:'09:02:00',exit:'17:52:00',entryMemo:'입실 사유',exitMemo:'',outings:[{start:'13:00:00',end:'14:00:00'}]});
const job={id:'job-one',status:'manual_archive'};
test('server round trip checks all fields; repeated manual saves reuse immutable content',async()=>{
  const db=new Map(),writes=[],progress=[];
  const save=createSnapshotSaver({read:async(c,id)=>db.get(c+'/'+id),write:async(c,id,data)=>{writes.push(data);assert(!db.has(c+'/'+id));db.set(c+'/'+id,structuredClone(data));}});
  const result=await save([{...row(),audit:{uiOnly:true}}],job,{onProgress:p=>progress.push(p)});
  assert.equal(result.verified,true);assert.equal(result.recordCount,1);assert.deepEqual(writes[0].records,[row()]);
  await save([row()],{...job,id:'another-click'});assert.equal(writes.length,1);
  assert.equal(progress.at(-1).phase,'verified');assert.equal(progress.at(-1).verifiedRecords,1);
});
test('lost write response succeeds only if the server contains the exact saved data',async()=>{
  let stored;
  const save=createSnapshotSaver({read:async()=>stored,write:async(c,id,data)=>{stored=structuredClone(data);throw Error('response lost');}});
  assert.equal((await save([row()],job)).verified,true);
  const rejected=createSnapshotSaver({read:async()=>null,write:async()=>{throw Error('offline');}});
  await assert.rejects(rejected([row()],job),e=>e.verifiedRecords===0&&e.message.includes('0/1건'));
});
test('a mismatched server memo cannot be reported as saved',async()=>{
  let stored;
  const save=createSnapshotSaver({read:async()=>stored,write:async(c,id,data)=>{stored=structuredClone(data);stored.records[0].entryMemo='다른 사유';}});
  await assert.rejects(save([row()],job),/다시 읽은 내용이/);
});
test('partial multi-class save reports confirmed count and retries without overwriting saved classes',async()=>{
  const db=new Map();let fail=true,writes=0;
  const save=createSnapshotSaver({read:async(c,id)=>db.get(c+'/'+id),write:async(c,id,data)=>{if(c==='3'&&fail)throw Error('network');writes++;db.set(c+'/'+id,data);}});
  const rows=[row(),{...row('two','3'),readState:'partial',entryMemo:null}];
  await assert.rejects(save(rows,job),e=>e.verifiedRecords===1&&e.classId==='3');
  fail=false;const result=await save(rows,job);assert.equal(result.recordCount,2);assert.equal(result.partialCount,1);assert.equal(writes,2);
});
test('large same-day groups are split while duplicate student records are rejected',async()=>{
  const db=new Map(),save=createSnapshotSaver({read:async(c,id)=>db.get(id),write:async(c,id,d)=>db.set(id,d)});
  const result=await save(Array.from({length:101},(_,i)=>row('student-'+i)),job);
  assert.equal(result.recordCount,101);assert.equal(result.batchCount,2);assert.equal(db.size,2);
  await assert.rejects(save([row(),row()],job),/중복 학생/);
});
