import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {firestore} from './retry-fixture.mjs';
test('retry storage is idempotent, preserves original history, reconciles first, and batches resolution reads',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..');
 try{
  await page.route('**/*',route=>{const u=new URL(route.request().url()),file=join(base,u.pathname.slice(1));if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:firestore});if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<script type="module">import * as store from '/checkhere-retry-store.mjs';import * as core from '/checkhere-retry-core.mjs';import {cachedRead} from '/session-read-cache.mjs';window.cachedRead=cachedRead;window.db={};window.store=store;window.core=core;window.trace=[];window.docs={};window.user={email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}})};window.parent={id:'failed-request-000001',classId:'2',date:'2026-09-14',name:'가상',phoneLast4:'',reason:'기존 근거',changes:{entryMemo:'요청 사유'},status:'failed',updatedAt:{seconds:10},createdAt:{seconds:1},createdBy:'staff@example.test'};window.docs['checkhereRequests/'+parent.id]=structuredClone(parent);window.ready=true;</script>`});if(/\.mjs$/.test(file)&&existsSync(file))return route.fulfill({contentType:'text/javascript',body:readFileSync(file,'utf8')});return route.abort();});
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);
  const result=await page.evaluate(async()=>{
   let cacheLoads=0;const readCount=()=>cachedRead(db,user,'operations:requests',async()=>++cacheLoads);await readCount();await readCount();
   const before=JSON.stringify(docs['checkhereRequests/'+parent.id]);const a=await Promise.all([store.ensureRetryRequest(db,user,parent),store.ensureRetryRequest(db,user,parent)]);
   await readCount();const cacheInvalidated=cacheLoads===2;
   const count=trace.filter(r=>r[0]==='set').length,originalUnchanged=before===JSON.stringify(docs['checkhereRequests/'+parent.id]);
   let unauthorized=false;try{await store.ensureRetryRequest(db,{...user,email:'staff@example.test'},parent);}catch{unauthorized=true;}
   const retry=a[0],rpath='checkhereRequests/'+retry.id;docs[rpath].status='unknown';docs[rpath].updatedAt={seconds:100};
   trace.length=0;const final=await store.resolveRetryRequest(db,user,parent,{reconcile:async r=>{trace.push(['reconcile',r.id]);return {status:r.status};}});
   const order=trace.map(r=>r[0]),reconcileFirst=order[0]==='reconcile',historyCount=Object.keys(docs).length;
   docs['checkhereRequests/'+final.id].status='verified';docs['checkhereRequests/'+final.id].result={platformSaved:true};
   const initial=Object.entries(docs).filter(([,r])=>core.isRetryableRequest(r)).map(([p,r])=>({id:p.split('/').at(-1),...r}));trace.length=0;
   const heads=await store.loadRetryHeads(db,initial),batchReads=trace.filter(r=>r[0]==='query').length,individualReads=trace.filter(r=>r[0]==='get').length;
   return {cacheInvalidated,sameId:a[0].id===a[1].id,count,originalUnchanged,unauthorized,reconcileFirst,historyCount,failures:heads.failures.length,resolved:heads.resolved.length,batchReads,individualReads,allowedKeys:Object.keys(a[0]).filter(k=>k!=='id').sort()};
  });
  assert.equal(result.cacheInvalidated,true);assert.equal(result.sameId,true);assert.equal(result.count,1);assert.equal(result.originalUnchanged,true);assert.equal(result.unauthorized,true);assert.equal(result.reconcileFirst,true);assert.equal(result.historyCount,3);assert.equal(result.failures,0);assert.equal(result.resolved,2);assert.equal(result.batchReads,1);assert.equal(result.individualReads,0);
  assert.deepEqual(result.allowedKeys,['changes','classId','createdAt','createdBy','date','name','phoneLast4','reason','status','updatedAt']);
  const recovery=await page.evaluate(async()=>{
   let cacheLoads=0;const readCount=()=>cachedRead(db,user,'operations:requests',async()=>++cacheLoads,{fresh:true});await readCount();
   const source={...parent,id:'failed-lost-response01',updatedAt:{seconds:30}};docs['checkhereRequests/'+source.id]=source;loseCommitResponse=true;let failed=false;try{await store.ensureRetryRequest(db,user,source);}catch{failed=true;}
   await cachedRead(db,user,'operations:requests',async()=>++cacheLoads);const failureInvalidated=cacheLoads===2;
   const next=await store.ensureRetryRequest(db,user,source);const count=trace.filter(r=>r[0]==='set'&&r[1].endsWith(next.id)).length;
   const blocked={...parent,id:'failed-running-00001'};docs['checkhereRequests/'+blocked.id]=blocked;let running=false;try{await store.resolveRetryRequest(db,user,blocked,{reconcile:async()=>({status:'running'})});}catch{running=true;}
   const child=await core.retryRequestId(blocked);return {failureInvalidated,failed,count,running,createdForRunning:!!docs['checkhereRequests/'+child]};
  });
  assert.deepEqual(recovery,{failureInvalidated:true,failed:true,count:1,running:true,createdForRunning:false});
 }finally{await browser.close();}
});
