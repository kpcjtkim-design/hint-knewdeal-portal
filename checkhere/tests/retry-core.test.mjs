import test from 'node:test';
import assert from 'node:assert/strict';
import {retryRequestId,retryHeads,RETRYABLE_STATUSES} from '../../checkhere-retry-core.mjs';
const parent={id:'original-request-00001',status:'failed',updatedAt:{seconds:100,nanoseconds:1},attemptId:'attempt-original'};
test('retry ids are stable for network retries, change with terminal revision, and stay within collector id format',async()=>{
 const id=await retryRequestId(parent);assert.match(id,/^retry_[a-f0-9]{64}$/);assert.equal(id,await retryRequestId(structuredClone(parent)));
 for(const patch of [{status:'partial'},{updatedAt:{seconds:100,nanoseconds:2}},{attemptId:'other'}])assert.notEqual(id,await retryRequestId({...parent,...patch}));
 await assert.rejects(()=>retryRequestId({...parent,status:'verified'}));assert.deepEqual(RETRYABLE_STATUSES,['failed','partial','unknown','conflict']);
});
test('only unresolved terminal leaves are actionable and old failure history remains',async()=>{
 const child={...parent,id:await retryRequestId(parent),status:'unknown',updatedAt:{seconds:101}},complete={...parent,id:await retryRequestId(child),status:'verified',result:{platformSaved:true}};
 const result=await retryHeads([parent,child,complete]);assert.equal(result.rows.length,3);assert.equal(result.failures.length,0);assert.deepEqual(result.resolved,[parent.id,child.id]);assert.equal(result.links.get(parent.id),child.id);
 const unresolved=await retryHeads([parent,child]);assert.deepEqual(unresolved.failures.map(r=>r.id),[child.id]);
 const active=await retryHeads([parent,{...child,status:'pending'}]);assert.equal(active.failures.length,0);assert.equal(active.resolved.length,0);
});
