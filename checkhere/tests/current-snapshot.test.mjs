import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurrentSaver,mergeCurrentRecords} from '../../checkhere-current-core.mjs';
const record=(id='a',extra={})=>({id,classId:'2',date:'2026-09-03',version:'v1',source:'live',readState:'complete',collectedAt:'2026-09-03T01:00:00Z',entry:'09:00:00',entryMemo:'',...extra});
function fixture({legacy=[],loseResponse=false}={}){
 const docs=new Map(),counts={read:0,write:0,legacy:0};
 const save=createCurrentSaver({
  async read(c,d){counts.read++;return structuredClone(docs.get(c+'/'+d)||null);},
  async readLegacy(){counts.legacy++;return legacy;},
  async commit(c,d,rows,old){const key=c+'/'+d;docs.set(key,{records:mergeCurrentRecords(docs.get(key)?.records||old,rows,c,d)});counts.write++;if(loseResponse)throw Error('lost response');}
 });return {save,docs,counts};
}
test('100 repeat saves keep one latest day document and never append history',async()=>{
 const f=fixture();for(let i=0;i<100;i++)await f.save([record()],{id:'job'});
 assert.equal(f.docs.size,1);assert.equal(f.counts.write,1);assert.equal(f.counts.legacy,1);
 assert.equal(f.counts.read,101);
});
test('50 new collections remain one document; blank memo updates are verified',async()=>{
 const f=fixture();for(let i=0;i<50;i++)await f.save([record('a',{collectedAt:new Date(Date.parse(record().collectedAt)+i*60000).toISOString(),entryMemo:i===49?'':'test'})],{id:'job'});
 assert.equal(f.docs.size,1);assert.equal(f.counts.legacy,1);assert.equal(f.docs.values().next().value.records[0].entryMemo,'');
});
test('partial resave preserves other students and imports legacy on first explicit save',async()=>{
 const f=fixture({legacy:[record('b')]});await f.save([record()],{id:'job'});
 await f.save([record('a',{collectedAt:'2026-09-03T02:00:00Z',version:'v2'})],{id:'job'});
 assert.equal(f.docs.values().next().value.records.length,2);assert.equal(f.counts.legacy,1);
});
test('lost response reconciles from server; older and conflicting writes cannot overwrite',async()=>{
 const f=fixture({loseResponse:true});assert.equal((await f.save([record('a',{collectedAt:'2026-09-03T02:00:00Z'})],{id:'job'})).verified,true);
 await assert.rejects(f.save([record()],{id:'job'}),/lost response|서버 저장값/);
 assert.throws(()=>mergeCurrentRecords([record()],[record('a',{entryMemo:'different'})],'2','2026-09-03'),/동일 수집/);
});
test('unconfirmed write and duplicate student fail with original PC data retained',async()=>{
 const save=createCurrentSaver({read:async()=>null,readLegacy:async()=>[],commit:async()=>{throw Error('offline');}});
 await assert.rejects(save([record()],{id:'job'}),/PC 기록은 유지/);
 await assert.rejects(fixture().save([record(),record()],{id:'job'}),/중복/);
});
