import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurveyReader,createSurveyRequestGate,surveyDelay} from '../../survey-google.mjs';

const url='https://docs.google.com/spreadsheets/d/fixture/edit?gid=1';
const response=(status,data,headers={})=>new Response(JSON.stringify(data),{status,headers});
const quota=(status=429,headers={})=>response(status,{error:{message:"Quota exceeded: Read requests per minute per user",errors:[{reason:'userRateLimitExceeded'}]}},headers);
const success=url=>response(200,String(url).includes('/values/')?{values:[['성명','반','점수'],['가','2반',0]]}:{sheets:[{properties:{sheetId:1,title:'설문지 응답 시트1',gridProperties:{rowCount:2,columnCount:3}}}]});
function clock(){let time=0;const waits=[];return {now:()=>time,waits,sleep:async(ms,signal)=>{signal?.throwIfAborted();waits.push(ms);time+=ms;}};}

test('concurrent readers share a queue with 2.5 seconds between actual requests',async t=>{
 const timer=clock(),gate=createSurveyRequestGate(timer),calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({at:timer.now(),options});return success(url);});
 const a=createSurveyReader(async()=>'fixture',{requestGate:gate}),b=createSurveyReader(async()=>'fixture',{requestGate:gate});
 await Promise.all([a.connect(),b.connect()]);const results=await Promise.all([a.raw(url),b.raw(url)]);
 assert.deepEqual(calls.map(c=>c.at),[0,2500,5000,7500]);assert.equal(results[0].rows[0].values[2],0);
 assert(calls.every(c=>!c.options.body&&!c.options.method));a.clear();b.clear();
});

test('429 waits at least 65 seconds, announces the pause, then resumes the same read',async t=>{
 const timer=clock(),gate=createSurveyRequestGate(timer),calls=[],notices=[];
 t.mock.method(globalThis,'fetch',async u=>{calls.push(timer.now());return calls.length===1?quota():success(u);});
 const reader=createSurveyReader(async()=>'fixture',{requestGate:gate,onWait:e=>notices.push(e)});await reader.connect();
 const result=await reader.raw(url);assert.equal(result.rows.length,1);assert.deepEqual(calls,[0,65000,67500]);
 assert.deepEqual(notices,[{kind:'quota',seconds:65},{kind:'resume'}]);reader.clear();
});

test('quota 403 honors a longer Retry-After; ordinary permission denial is not retried',async t=>{
 const timer=clock(),gate=createSurveyRequestGate(timer),calls=[];let forbidden=false;
 t.mock.method(globalThis,'fetch',async u=>{calls.push(timer.now());if(forbidden)return response(403,{error:{message:'Permission denied'}});return calls.length===1?quota(403,{'Retry-After':'90'}):success(u);});
 const reader=createSurveyReader(async()=>'fixture',{requestGate:gate});await reader.connect();await reader.raw(url);
 assert.deepEqual(calls,[0,90000,92500]);forbidden=true;await assert.rejects(reader.raw(url),/Permission denied/);assert.equal(calls.length,4);reader.clear();
});

test('persistent quota failures stop after four attempts without a tight retry loop',async t=>{
 const timer=clock(),gate=createSurveyRequestGate(timer),calls=[];
 t.mock.method(globalThis,'fetch',async()=>{calls.push(timer.now());return quota();});
 const reader=createSurveyReader(async()=>'fixture',{requestGate:gate});await reader.connect();await assert.rejects(reader.raw(url),/기존 저장 결과는 유지/);
 assert.deepEqual(calls,[0,65000,185000,305000]);reader.clear();
});

for(const cancel of ['request','reader'])test(`${cancel} cancellation interrupts quota waiting before any further fetch`,async t=>{
 let announce;const waiting=new Promise(resolve=>announce=resolve),gate=createSurveyRequestGate({sleep:(ms,signal)=>{announce();return surveyDelay(ms,signal);}});let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return quota();});
 const reader=createSurveyReader(async()=>'fixture',{requestGate:gate}),controller=new AbortController();await reader.connect();
 const pending=reader.raw(url,{signal:controller.signal}),rejected=assert.rejects(pending,e=>e.name==='AbortError');
 await waiting;if(cancel==='request')controller.abort();else reader.clear();await rejected;assert.equal(calls,1);reader.clear();
});
