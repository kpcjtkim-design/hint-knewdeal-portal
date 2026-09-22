import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';import {firestore} from './retry-fixture.mjs';
test('work request counts exclude retry ancestors and reuse read-only queries until invalidated',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..');
 try{
 await page.route('**/*',r=>{const u=new URL(r.request().url()),name=u.pathname.slice(1);
  if(u.hostname==='www.gstatic.com')return r.fulfill({contentType:'text/javascript',body:firestore});
  const stubs={'attendance-derived-store.mjs':'export const readAttendanceSummary=async()=>null;','timetable-store.mjs':'export const createTimetableStore=()=>({read:async()=>null});','survey-store.mjs':'export const createSurveyStore=()=>({read:async()=>({}),configuration:async()=>({})});'};
  if(stubs[name])return r.fulfill({contentType:'text/javascript',body:stubs[name]});
  if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:`<script type="module">import{createWorkStore}from'/operations-work-store.mjs';import{retryRequestId}from'/checkhere-retry-core.mjs';import{invalidateRead}from'/session-read-cache.mjs';window.db={};window.user={uid:'admin'};window.docs={};window.trace=[];const a={id:'failure1',classId:'1',date:'2026-09-22',status:'failed',updatedAt:{seconds:1}},b={...a,id:'failure2'};for(const p of[a,b])docs['checkhereRequests/'+p.id]=p;docs['checkhereRequests/'+await retryRequestId(a)]={...a,status:'verified',result:{platformSaved:true}};docs['checkhereRequests/'+await retryRequestId(b)]={...b,status:'pending'};window.store=createWorkStore(db,user);window.invalidate=()=>invalidateRead(db,user,'operations:requests');window.ready=true;</script>`});
  if(u.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.mjs$/.test(name)&&existsSync(join(base,name)))return r.fulfill({contentType:'text/javascript',body:readFileSync(join(base,name),'utf8')});return r.abort();
 });await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);
 const result=await page.evaluate(async()=>{const first=await store.requests(),count=trace.length,second=await store.requests(),cached=trace.length===count;invalidate();await store.requests();return{first:first.map(r=>r.status),second:second.map(r=>r.status),cached,invalidated:trace.length>count,writes:trace.filter(r=>['set','update'].includes(r[0])).length};});
 assert.deepEqual(result,{first:['pending'],second:['pending'],cached:true,invalidated:true,writes:0});
 }finally{await browser.close();}
});
