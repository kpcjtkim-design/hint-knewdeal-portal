import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeReader,readerFailure} from '../../lib/attendance-reader-transport.mjs';
import {within,readJson,readUntilReady} from '../../attendance-io.mjs';
import readerHandler from '../../api/attendance-reader.js';
import colorsHandler from '../../api/attendance-colors.js';
const valid={ok:true,classId:'2',attendance:[['이름','','','','9/3'],['시험학생','','','','출석']],reasons:[['','','','','9/3'],['','','','','']],attendanceBackgrounds:[[],[]]};

test('nonretryable bridge failures survive API serialization and stop browser retries',async t=>{
 let calls=0,pauses=0;
 const invalid=readerFailure(Object.assign(Error('READER_INVALID_DATA'),{retryable:false}));
 assert.equal(invalid.retryable,false);
 t.mock.method(globalThis,'fetch',async()=>{calls++;const {status,...body}=invalid;return Response.json({ok:false,...body},{status});});
 await assert.rejects(readUntilReady(()=>readJson('/reader',{}),{pause:async()=>{pauses++;throw Error('unexpected retry');}}),e=>e.code==='READER_INVALID_DATA'&&e.retryable===false);
 assert.equal(calls,1);assert.equal(pauses,0);
 assert.equal(readerFailure(Object.assign(Error('READER_TIMEOUT'),{retryable:true})).retryable,true);
});
test('reader retries temporary HTML/429 errors, validates shape, and keeps fresh approval reads out of cache',async t=>{
 const original=globalThis.fetch;let calls=0;const diagnostics=[];
 try{
  const read=createBridgeReader({attempts:2,timeout:100,backoff:1,log:d=>diagnostics.push(d)});
  globalThis.fetch=async()=>++calls===1?new Response('<html>upstream error</html>',{status:502,headers:{'content-type':'text/html'}}):Response.json(valid);
  assert.equal((await read('https://bridge.test','2',{allowCache:true})).ok,true);assert.equal(calls,2);
  assert.equal((await read('https://bridge.test','2',{allowCache:true})).readerCached,true);assert.equal(calls,2);
  await read('https://bridge.test','2');assert.equal(calls,3,'approval must read after the source check starts');
  assert.equal(diagnostics[0].code,'READER_BAD_RESPONSE');assert(!JSON.stringify(diagnostics).includes('시험학생'));
  calls=0;globalThis.fetch=async()=>++calls===1?Response.json({ok:false},{status:429}):Response.json(valid);
  assert((await read('https://another.test','2')).ok);assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({...valid,classId:'3'});};
  await assert.rejects(read('https://bridge.test','2'),/INVALID_DATA/);assert.equal(calls,1,'wrong-class data is never cached or retried as success');
  globalThis.fetch=async()=>Response.json({ok:true});await assert.rejects(read('https://bridge.test','2'),/INVALID_DATA/);
 }finally{globalThis.fetch=original;}
});
test('reader timeouts stop, recover on a later read, and coalesce display reads',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  const read=createBridgeReader({attempts:2,timeout:20,backoff:1,log:()=>{}});
  globalThis.fetch=async(_url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))));};
  await assert.rejects(read('https://bridge.test','2'),/READER_TIMEOUT/);assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return Response.json(valid);};
  const before=calls,results=await Promise.all([read('https://bridge.test','2',{allowCache:true}),read('https://bridge.test','2',{allowCache:true})]);assert(results.every(r=>r.ok));assert.equal(calls-before,1);
 }finally{globalThis.fetch=original;}
});
test('browser reads reject invalid success pages and deadlines cleanly recover',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<html>sign in</html>');await assert.rejects(readJson('/reader',{}),/기다리고/);
  globalThis.fetch=async()=>Response.json({ok:false,error:'READER_BAD_RESPONSE'},{status:503});await assert.rejects(readJson('/reader',{}),/일시적으로 불안정/);
  await assert.rejects(within(new Promise(()=>{}),10),/응답이 지연/);assert.equal(await within(Promise.resolve('recovered'),10),'recovered');
  const cancel=new AbortController();const pending=within(new Promise(()=>{}),500,undefined,cancel.signal);cancel.abort();await assert.rejects(pending,{name:'AbortError'});
 }finally{globalThis.fetch=original;}
});

test('database quota exhaustion is shown once without an endless reader retry',async()=>{
 const original=globalThis.fetch;let reads=0,pauses=0;
 try{
  globalThis.fetch=async()=>{reads++;return Response.json({ok:false,error:'DATABASE_QUOTA_EXCEEDED',retryable:false,message:'데이터베이스 일일 한도 초과'},{status:429});};
  await assert.rejects(readUntilReady(()=>readJson('/reader',{}),{pause:async()=>{pauses++;throw Error('unexpected retry');}}),e=>e.code==='DATABASE_QUOTA_EXCEEDED'&&e.retryable===false);
  assert.equal(reads,1);assert.equal(pauses,0);
 }finally{globalThis.fetch=original;}
});
// 2기: 1기 운영총괄 리더 두 곳(/api/attendance-reader·/api/attendance-colors)은 닫혀 있어 로그인·리더 호출 없이 410만 답합니다.
test('both 1기 reader endpoints are closed on the 2기 site and never call the bridge',async()=>{
 const original=globalThis.fetch;let calls=0;
 const call=async(handler,body,method='POST')=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await handler({method,body},res);return res;};
 try{
  globalThis.fetch=async()=>{calls++;return Response.json(valid);};
  for(const handler of [readerHandler,colorsHandler])for(const [body,method] of [[{idToken:'fixture',classId:'2',allowCache:true},'POST'],[{classId:'2'},'POST'],[{},'GET']]){
   const r=await call(handler,body,method);assert.equal(r.code,410);assert.equal(r.body.code,'COHORT2_CLOSED');assert.equal(r.headers['cache-control'],'no-store');
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}

});

// 1기 관리자 계정 판정(운영총괄 리더) 시험은 1기(cohort1 브랜치)에 남았습니다. 2기 리더는 2기 출결원장 기준으로 다시 만들 때 시험을 더합니다.
