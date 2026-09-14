import test from 'node:test';
import assert from 'node:assert/strict';
import {readUntilReady} from '../../attendance-io.mjs';
import {createReadQueue} from '../../portal-read-cache.mjs';
import {moveLesson} from '../../timetable-board.mjs';
test('temporary Sheet failures retry sequentially, back off, pause while hidden, and stop on cancellation or permission errors',async()=>{
 let calls=0,active=0,max=0,visible=false;const waits=[];
 const value=await readUntilReady(async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--;if(++calls<5)throw Error('temporary');return 'loaded';},{isActive:()=>visible,delays:[5,15,30],pause:async ms=>{waits.push(ms);visible=true;}});
 assert.equal(value,'loaded');assert.equal(max,1);assert.deepEqual(waits,[1000,5,15,30,30]);
 calls=0;await assert.rejects(readUntilReady(async()=>{calls++;throw Object.assign(Error('access denied'),{retryable:false});}),/access denied/);assert.equal(calls,1);
 const c=new AbortController();calls=0;await assert.rejects(readUntilReady(async()=>{calls++;throw Error('temporary');},{signal:c.signal,pause:async()=>{c.abort();}}),{name:'AbortError'});assert.equal(calls,1);
});
test('Drive reads have bounded concurrency, deduplicate identical jobs, and do not cache failures or start detached work',async()=>{
 const q=createReadQueue({concurrency:3,ttl:10000});let count=0,active=0,max=0;
 const task=async()=>{count++;active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,5));active--;return count;};
 await Promise.all(Array.from({length:40},(_,i)=>q.read(String(i%20),task)));assert.equal(count,20);assert.equal(max,3);
 await q.read('1',task);assert.equal(count,20);
 await assert.rejects(q.read('failure',async()=>{throw Error('temporary');}));assert.equal(await q.read('failure',async()=>42),42);
 await assert.rejects(q.read('detached',task,{active:()=>false}),{name:'AbortError'});assert.equal(count,20);
});
test('moving and swapping lesson dates preserve all other fields and never mutate the stored schedule',()=>{
 const entries=[{id:'a',kind:'lesson',date:'2026-09-01',course:'제조지능화',module:'직무특화',title:'A',day:1,hours:8,instructorId:'i'}, {id:'b',kind:'lesson',date:'2026-09-02',course:'제조지능화',module:'직무특화',title:'B',day:1,hours:8,instructorId:'j'}];
 const moved=moveLesson(entries,'a','2026-09-03');assert.equal(entries[0].date,'2026-09-01');assert.deepEqual(moved.find(e=>e.id==='a'),{...entries[0],date:'2026-09-03'});
 const swapped=moveLesson(entries,'a','2026-09-02','b');assert.equal(swapped.find(e=>e.id==='b').date,'2026-09-01');assert.equal(swapped.find(e=>e.id==='a').instructorId,'i');assert.equal(swapped.length,2);
 assert.throws(()=>moveLesson(entries,'a','2026-02-30'));assert.throws(()=>moveLesson(entries,'a','2026-09-03','b'));
});
