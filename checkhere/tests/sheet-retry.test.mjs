import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {RETRY_POLICY,actionKind,classifyFailure,mayRetry,backoffMs,busyText,callSheetWithRetry,READ_ACTIONS,IDEMPOTENT_WRITES,CREATE_WRITES} from '../../lib/sheet-retry.cjs';
import {sheetBusyText,isSheetBusy} from '../../beta2-core.mjs';
import handler,{RETRY_HOOKS} from '../../api/teacher-beta.js';

// /api/teacher-beta → Apps Script 다시 시도 규칙(2026-10-21 부하 시험: 담임 16명 동시 저장 → 8건 'Lock timeout', 23~45초).
// 가짜 시계(now)·가짜 sleep·가짜 fetch로 봅니다. 실제로 기다리지 않습니다.
const LOCK='Lock timeout: another process was holding the lock for too long.';
const base=join(import.meta.dirname,'../..');
function clock(start=1_000_000){const c={t:start,sleeps:[],now:()=>c.t,sleep:async ms=>{c.sleeps.push(ms);c.t+=ms;}};return c;}
// steps: 호출마다 {ms, json|text|status|network|hang}. 마지막 것을 계속 씁니다.
function sheet(c,steps){
 const calls=[];
 const fetchImpl=async(url,init)=>{
  const s=steps[Math.min(calls.length,steps.length-1)];calls.push({body:JSON.parse(init.body),at:c.t,signal:init.signal});
  c.t+=s.ms||0;
  if(s.network)throw new TypeError('fetch failed');
  if(s.text!==undefined)return new Response(s.text,{status:s.status||200,headers:{'content-type':'text/html'}});
  return Response.json(s.json??{ok:true,data:{ok:true}},{status:s.status||200});
 };
 return {calls,fetchImpl};
}
const run=(c,f,action,args=[{}],more={})=>callSheetWithRetry({url:'https://script.test/exec',key:'k',action,args,fetchImpl:f.fetchImpl,now:c.now,sleep:c.sleep,random:()=>0.5,...more});

test('error classes: lock and concurrency errors are transient, validation errors and plain 4xx never are',()=>{
 assert.equal(classifyFailure({message:LOCK}),'lock');
 assert.equal(classifyFailure({message:'Lock timeout'}),'lock');
 assert.equal(classifyFailure({message:'Script invoked too many simultaneous invocations'}),'not-run');
 assert.equal(classifyFailure({message:'Service invoked too many times in a short time: exec qps.'}),'rate');
 assert.equal(classifyFailure({message:'Exceeded maximum execution time'}),'maybe');
 assert.equal(classifyFailure({message:'Service unavailable: Spreadsheets'}),'maybe');
 assert.equal(classifyFailure({message:'We are temporarily unavailable'}),'maybe');
 assert.equal(classifyFailure({status:429}),'not-run');
 assert.equal(classifyFailure({status:503}),'not-run');
 assert.equal(classifyFailure({status:500}),'maybe');
 assert.equal(classifyFailure({status:502}),'maybe');
 assert.equal(classifyFailure({network:true}),'maybe');
 assert.equal(classifyFailure({timeout:true}),'maybe');
 for(const message of ['유형을 골라 주세요.','없는 학생입니다.','CONFLICT: 그사이 바뀌었습니다','unauthorized','unknown action'])assert.equal(classifyFailure({message}),null,message);
 for(const status of [400,401,403,404,409])assert.equal(classifyFailure({status}),null,String(status));
});

test('which actions may be retried: reads always, overwrite-style writes before the write, creating writes only when Apps Script never ran',()=>{
 for(const a of ['portalData','b2Bundle','b2Rev','b2Dropouts','b2Officers','b2DayMemos'])assert.equal(actionKind(a),'read',a);
 for(const a of ['portalSave','b2Save','portalClose','b2DayMemo','b2RosterStatusMany','b2ScheduleSave','b2LedgerMemo','b2OfficerEnd','b2VocSeen'])assert.equal(actionKind(a),'write',a);
 for(const a of ['b2DocCreate','b2VocCreate','b2VocReply','portalAddRow','somethingNew'])assert.equal(actionKind(a),'create',a);
 assert.equal(actionKind('b2DropoutSave',[{cls:'3',name:'가'}]),'create','new dropout request makes a new row');
 assert.equal(actionKind('b2DropoutSave',[{cls:'3',row:12,was:{cls:'3',name:'가'},remove:true}]),'write','cancel/edit finds the row by row + was');
 assert.equal(actionKind('b2OfficerSave',[{cls:'3',role:'앰버서더',kind:'추가',name:'나',was:['가']}]),'create');
 assert.equal(actionKind('b2OfficerSave',[{cls:'3',role:'앰버서더',kind:'최초',name:'가',was:[]}]),'create','multi-holder add (was = list)');
 assert.equal(actionKind('b2OfficerSave',[{cls:'3',role:'반장',kind:'보궐',name:'나',was:{name:'가'}}]),'write');
 for(const s of [READ_ACTIONS,IDEMPOTENT_WRITES])for(const a of s)assert.equal(CREATE_WRITES.has(a),false,a);
 // 표: 읽기는 모두, 쓰기는 not-run·rate·lock, 만들기는 not-run만
 const F=['not-run','rate','lock','maybe',null];
 assert.deepEqual(F.map(f=>mayRetry('read',f)),[true,true,true,true,false]);
 assert.deepEqual(F.map(f=>mayRetry('write',f)),[true,true,true,false,false]);
 assert.deepEqual(F.map(f=>mayRetry('create',f)),[true,false,false,false,false]);
});

test('backoff is full jitter between 0 and min(cap, base x 2^(n-1))',()=>{
 for(let n=1;n<=8;n++){
  const ceil=Math.min(RETRY_POLICY.capMs,RETRY_POLICY.baseMs*2**(n-1));
  assert.equal(backoffMs(n,()=>0),0);
  const hi=backoffMs(n,()=>0.9999999);assert.ok(hi<ceil&&hi>=ceil-1,`n=${n}: ${hi} < ${ceil}`);
  for(let i=0;i<50;i++){const d=backoffMs(n);assert.ok(d>=0&&d<ceil&&d<=RETRY_POLICY.capMs);}
 }
 assert.ok(RETRY_POLICY.budgetMs<=55000&&RETRY_POLICY.maxAttemptMs<=55000,'stays inside vercel.json maxDuration 60s');
 const vercel=JSON.parse(readFileSync(join(base,'vercel.json'),'utf8'));
 assert.equal(vercel.functions['api/teacher-beta.js'].maxDuration,60);
});

test('portalSave: two lock timeouts then success → saved on the 3rd attempt, waits within backoff bounds',async()=>{
 const c=clock(),f=sheet(c,[{ms:8000,json:{ok:false,error:LOCK}},{ms:8000,json:{ok:false,error:LOCK}},{ms:900,json:{ok:true,data:{ok:true,warn:''}}}]);
 const r=await run(c,f,'portalSave',[{cls:3,name:'가',date:'2026-11-05',type:'결석'}]);
 assert.equal(r.attempts,3);assert.deepEqual(r.out,{ok:true,data:{ok:true,warn:''}});
 assert.equal(f.calls.length,3);assert.deepEqual(f.calls[2].body,f.calls[0].body,'the same upsert is sent again');
 assert.deepEqual(c.sleeps,[backoffMs(1,()=>0.5),backoffMs(2,()=>0.5)]);
});

test('validation errors and unknown failures are returned at once (no retry)',async()=>{
 for(const json of [{ok:true,data:{ok:false,msg:'유형을 골라 주세요.'}},{ok:false,error:'없는 학생입니다.'},{ok:false,error:'CONFLICT: 그사이 바뀌었습니다'}]){
  const c=clock(),f=sheet(c,[{ms:300,json}]);
  const r=await run(c,f,'b2Save',[{cls:'3'}]);assert.equal(r.attempts,1);assert.deepEqual(r.out,json);assert.deepEqual(c.sleeps,[]);
 }
 const c=clock(),f=sheet(c,[{ms:100,status:404,text:'<html>not found</html>'}]);
 await assert.rejects(run(c,f,'portalData'),e=>e.message==='SHEET_BAD_RESPONSE'&&e.attempts===1);
 const c2=clock(),f2=sheet(c2,[{ms:100,json:{ok:false,error:'unauthorized'}}]);
 await assert.rejects(run(c2,f2,'portalData'),e=>e.message==='SHEET_UNAUTHORIZED'&&e.attempts===1);
});

test('HTTP 429/503 and Google error pages are retried; 5xx and network errors only for reads',async()=>{
 let c=clock(),f=sheet(c,[{ms:200,status:429,text:'Too Many Requests'},{ms:200,status:503,text:'<html>Service Unavailable</html>'},{ms:500,json:{ok:true,data:{ok:true}}}]);
 assert.equal((await run(c,f,'b2VocCreate',[{cls:'3',type:'안전',detail:'가'}])).attempts,3,'429/503: Apps Script never ran, safe even for a create');
 c=clock();f=sheet(c,[{ms:200,text:'<html>Script invoked too many simultaneous invocations</html>'},{ms:500,json:{ok:true,data:{}}}]);
 assert.equal((await run(c,f,'b2DocCreate',[{cls:'3'}])).attempts,2);
 c=clock();f=sheet(c,[{ms:200,status:500,text:'<html>Internal error</html>'}]);
 await assert.rejects(run(c,f,'portalSave',[{}]),e=>e.message==='SHEET_UNAVAILABLE'&&e.attempts===1&&e.retries===0,'500 may have run: a write is not retried');
 c=clock();f=sheet(c,[{ms:200,status:500,text:'<html>Internal error</html>'},{ms:200,json:{ok:true,data:{rows:[]}}}]);
 assert.equal((await run(c,f,'b2Bundle',['3'])).attempts,2,'a read is retried');
 c=clock();f=sheet(c,[{ms:50,network:true}]);
 await assert.rejects(run(c,f,'b2Save',[{}]),e=>e.message==='SHEET_UNAVAILABLE'&&e.attempts===1);
 c=clock();f=sheet(c,[{ms:50,network:true},{ms:50,json:{ok:true,data:{rev:3}}}]);
 assert.equal((await run(c,f,'b2Rev',[])).attempts,2);
 c=clock();f=sheet(c,[{ms:3000,json:{ok:false,error:'Exceeded maximum execution time'}}]);
 await assert.rejects(run(c,f,'b2Save',[{}]),e=>e.message==='SHEET_BUSY'&&e.attempts===1,'execution may have written: not retried for a write');
 c=clock();f=sheet(c,[{ms:300,json:{ok:false,error:'Service invoked too many times in a short time: exec qps.'}},{ms:300,json:{ok:true,data:{ok:true}}}]);
 assert.equal((await run(c,f,'portalSave',[{}])).attempts,2);
});

test('creating writes are not retried on a lock timeout (the error alone does not prove nothing was written)',async()=>{
 for(const [action,args] of [['b2VocCreate',[{cls:'3'}]],['b2VocReply',[{key:'V1'}]],['b2DocCreate',[{cls:'3'}]],['b2DropoutSave',[{cls:'3',name:'가'}]],['b2OfficerSave',[{cls:'3',role:'앰버서더',kind:'추가',was:['가']}]],['portalAddRow',[3,'','VOC',{}]]]){
  const c=clock(),f=sheet(c,[{ms:20000,json:{ok:false,error:LOCK}},{ms:100,json:{ok:true,data:{}}}]);
  await assert.rejects(run(c,f,action,args),e=>e.message==='SHEET_BUSY'&&e.attempts===1&&e.retries===0&&e.kind==='create',action);
  assert.equal(f.calls.length,1,action);
 }
});

test('time budget: stops when 15 s or less would remain, never exceeds 55 s, and per-attempt timeout fits what is left',async()=>{
 // 잠금 시간 초과가 20초마다: 1번째(0~20s) → 다시(20~40s) → 남은 ~15s 이하라 그만
 let c=clock(),start=c.t,f=sheet(c,[{ms:20000,json:{ok:false,error:LOCK}}]);
 await assert.rejects(run(c,f,'portalSave',[{}]),e=>e.message==='SHEET_BUSY'&&e.attempts===2&&e.retries===1);
 assert.ok(c.t-start<=RETRY_POLICY.budgetMs);
 for(const call of f.calls)assert.ok(start+RETRY_POLICY.budgetMs-call.at>RETRY_POLICY.minRemainingMs,'each attempt started with more than 15 s left');
 // 빠른 동시 실행 초과(0.3초)는 최대 5번까지
 c=clock();start=c.t;f=sheet(c,[{ms:300,json:{ok:false,error:'too many simultaneous invocations'}}]);
 await assert.rejects(run(c,f,'b2Bundle',['all'],{random:()=>0.9999}),e=>e.message==='SHEET_BUSY'&&e.attempts===RETRY_POLICY.maxAttempts);
 assert.ok(c.t-start<=RETRY_POLICY.budgetMs);
 for(const [i,ms] of c.sleeps.entries())assert.ok(ms<Math.min(RETRY_POLICY.capMs,RETRY_POLICY.baseMs*2**i));
 // 시트가 이미 45초 넘게 잠금을 기다렸으면 다시 시도하지 않음(남은 시간과 상관없이)
 c=clock();f=sheet(c,[{ms:46000,json:{ok:false,error:LOCK}}]);
 await assert.rejects(run(c,f,'b2Bundle',['all'],{deadline:c.t+200000}),e=>e.message==='SHEET_BUSY'&&e.attempts===1);
 // 함수 시작 뒤 이미 시간이 지났으면(인증 확인 등) 그만큼 줄어든 예산: 남은 30초 → 1번 실패 20초 뒤 남은 10초라 그만
 c=clock();f=sheet(c,[{ms:20000,json:{ok:false,error:LOCK}}]);
 await assert.rejects(run(c,f,'portalSave',[{}],{deadline:c.t+30000}),e=>e.attempts===1);
});

test('a hung Apps Script call is aborted at the remaining budget and reported as SHEET_TIMEOUT',async()=>{
 const hang=async(url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 const t0=Date.now();
 await assert.rejects(callSheetWithRetry({url:'u',key:'k',action:'portalSave',args:[{}],fetchImpl:hang,deadline:Date.now()+80}),e=>e.message==='SHEET_TIMEOUT'&&e.attempts===1);
 assert.ok(Date.now()-t0<2000);
});

test('busy text: server and client say the same thing, with the retry count',()=>{
 for(const n of [0,1,3,4])assert.equal(busyText(n),sheetBusyText(n));
 assert.equal(busyText(3),'지금 저장이 몰려 잠시 뒤 다시 저장해 주세요(자동 재시도 3회)');
 assert.equal(busyText(0),'지금 저장이 몰려 잠시 뒤 다시 저장해 주세요');
 assert.equal(busyText(2,false),'지금 요청이 몰려 잠시 뒤 다시 시도해 주세요(자동 재시도 2회)');
 assert.equal(isSheetBusy({code:'SHEET_BUSY'}),true);assert.equal(isSheetBusy({code:'SHEET_TIMEOUT'}),true);assert.equal(isSheetBusy({code:'CONFLICT'}),false);
 // 클라이언트: 2기 데이터 클라이언트·담임 출결판 저장이 몰림을 알아보고 초안을 남김
 const data=readFileSync(join(base,'beta2-data.mjs'),'utf8'),tb=readFileSync(join(base,'teacher-beta.js'),'utf8');
 assert.ok(data.includes('SHEET_BUSY_CODES.includes(code)')&&data.includes('retries:Number(j.retries)'));
 assert.ok(tb.includes('if(isSheetBusy(e)){S.drafts.set(draftKey(sel.n,sel.day)')&&tb.includes("S.drafts.delete(draftKey(sel.n,sel.day)); // 시트가 답했으면"));
});

// /api/teacher-beta 전체: 가짜 Firebase·가짜 Apps Script
const SHEET='https://script.test/exec',ADMIN_EMAIL='hint.kpc@gmail.com';
function backend(t,sheetFn){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return Response.json({users:[{email:idToken.slice(4)}]});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push(body);return sheetFn(body,calls.length);}
  throw Error('unexpected fetch '+url);
 });
 return calls;
}
async function call(body,email=ADMIN_EMAIL){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);return res;
}
function env(t){
 const old={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY='secret';
 const c=clock();Object.assign(RETRY_HOOKS,{sleep:c.sleep,now:c.now,random:()=>0.5});
 t.after(()=>{Object.assign(RETRY_HOOKS,{sleep:undefined,now:undefined,random:undefined});for(const [k,v] of [['HINT_SHEET_API_URL',old.url],['HINT_SHEET_API_KEY',old.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 return c;
}

test('handler: a save that succeeds after lock timeouts reports attempts; one that never gets the lock says 잠시 뒤 다시 저장',async t=>{
 let c=env(t),calls=backend(t,(b,n)=>{c.t+=5000;return Response.json(n<3?{ok:false,error:LOCK}:{ok:true,data:{ok:true,warn:''}});});
 let res=await call({action:'portalSave',args:[{cls:3,name:'가',date:'2026-11-05',type:'결석'}],cls:3});
 assert.equal(res.statusCode,200);assert.deepEqual(res.body,{ok:true,data:{ok:true,warn:''},attempts:3});assert.equal(res.headers['x-sheet-attempts'],'3');assert.equal(calls.length,3);
 t.mock.restoreAll();
 calls=backend(t,()=>{c.t+=5000;return Response.json({ok:false,error:LOCK});});
 res=await call({action:'b2Save',args:[{cls:'3',name:'가',date:'2026-11-05',type:'결석'}]});
 assert.equal(res.statusCode,503);assert.equal(res.body.code,'SHEET_BUSY');assert.equal(res.body.attempts,calls.length);assert.equal(res.body.retries,calls.length-1);
 assert.equal(res.body.error,`지금 저장이 몰려 잠시 뒤 다시 저장해 주세요(자동 재시도 ${calls.length-1}회)`);
 assert.ok(calls.length>=2&&calls.length<=RETRY_POLICY.maxAttempts);
 t.mock.restoreAll();
 calls=backend(t,()=>{c.t+=5000;return Response.json({ok:false,error:LOCK});});
 res=await call({action:'b2VocCreate',args:[{cls:'3',type:'안전',detail:'가'}]});
 assert.deepEqual([res.statusCode,res.body.code,res.body.error,calls.length],[503,'SHEET_BUSY','지금 저장이 몰려 잠시 뒤 다시 저장해 주세요',1],'a create is sent once');
 t.mock.restoreAll();
 calls=backend(t,()=>{c.t+=5000;return Response.json({ok:false,error:'too many simultaneous invocations'});});
 res=await call({action:'b2Bundle',args:['all']});
 assert.equal(res.body.error,`지금 요청이 몰려 잠시 뒤 다시 시도해 주세요(자동 재시도 ${calls.length-1}회)`);
 t.mock.restoreAll();
 calls=backend(t,()=>Response.json({ok:true,data:{ok:false,msg:'유형을 골라 주세요.'}}));
 res=await call({action:'portalSave',args:[{cls:3,name:'가'}],cls:3});
 assert.deepEqual([res.statusCode,res.body,calls.length,res.headers['x-sheet-attempts']],[200,{ok:true,data:{ok:false,msg:'유형을 골라 주세요.'}},1,'1'],'a validation answer is passed through once');
});

test('handler: the whole request (auth included) stays inside the 55 s budget',async t=>{
 const c=env(t);
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){c.t+=4000;return Response.json({users:[{email:ADMIN_EMAIL}]});}
  c.t+=12000;return Response.json({ok:false,error:LOCK});
 });
 const t0=c.t,res=await call({action:'portalSave',args:[{cls:3,name:'가'}],cls:3});
 assert.equal(res.body.code,'SHEET_BUSY');assert.ok(c.t-t0<=RETRY_POLICY.budgetMs,`${c.t-t0}ms`);
 // 4s(인증) + 12s → 남은 39s → 다시 → 28s(+기다림) → 남은 ~27s → 다시 → 40s → 남은 15s 이하라 그만
 assert.equal(res.body.attempts,3);
});
