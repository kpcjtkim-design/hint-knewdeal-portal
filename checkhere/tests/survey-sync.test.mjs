import test from 'node:test';
import assert from 'node:assert/strict';
import {surveySlot,stableSurveyPayload} from '../../survey-sync-core.mjs';
import {encodeFields,decodeFields,createSyncStore} from '../../lib/survey-sync-store.mjs';
import {syncClassWorker,authenticateScheduler} from '../../lib/survey-sync-worker.mjs';
import handler from '../../api/survey-sync.js';
import runtime from '../../lib/survey-sync-runtime.cjs';
test('KST business hours and required evening slots, overnight idle and delayed minute',()=>{
 for(const minute of [0,10,20,30])assert.equal(surveySlot(new Date(`2026-09-16T09:${String(minute).padStart(2,'0')}:00Z`)),`2026-09-16T18:${String(minute).padStart(2,'0')}+09:00`);
 assert.equal(surveySlot(new Date('2026-09-16T09:19:30Z')),'2026-09-16T18:10+09:00');
 assert.equal(surveySlot(new Date('2026-09-16T15:04:00Z')),null);
 assert.equal(surveySlot(new Date('2026-09-15T23:59:00Z')),null);
 assert.equal(surveySlot(new Date('2026-09-16T10:00:00Z')),null);
 assert.equal(surveySlot(new Date('2026-09-16T00:00:00Z')),'2026-09-16T09:00+09:00');
 assert.equal(surveySlot(new Date('2026-09-16T08:59:00Z')),'2026-09-16T17:00+09:00');
});
test('unchanged content ignores only bookkeeping; edited responses remain changes',()=>{
 assert.equal(stableSurveyPayload({answered:[{name:'가'}],syncedAt:'old'}),stableSurveyPayload({syncedAt:'new',answered:[{name:'가'}]}));
 assert.notEqual(stableSurveyPayload({scores:{sum:5}}),stableSurveyPayload({scores:{sum:4}}));
 const data={name:'가',x:0,no:false,a:[1,2,null,{n:5.5}],empty:{}};assert.deepEqual(decodeFields(encodeFields(data)),data);
});
test('unauthenticated and non-owner scheduler requests are denied before data access',async()=>{
 await assert.rejects(authenticateScheduler(''),/LOGIN_REQUIRED/);
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify({email:'someone@example.test',email_verified:true}));};
 try{await assert.rejects(authenticateScheduler('a'.repeat(30)),/SCHEDULER_OWNER_REQUIRED/);assert.equal(calls,1);}finally{global.fetch=original;}
 let status;const res={setHeader(){},status(n){status=n;return this;},json(data){return data;}};
 assert.equal((await handler({method:'POST',body:{}},res)).ok,false);assert.equal(status,403);
});
function fixture(){
 const documents=new Map([
 ['settings/surveyBetaConfig',{events:{}}],['classes/1',{course:'임베디드 AI(HW)'}],
 ['timetableBetaPublished/1',{entries:[{id:'d1',title:'SW 테스팅',date:'2026-09-14',day:1,module:'직무특화'},{id:'d2',title:'SW 테스팅',date:'2026-09-15',day:2,module:'직무특화'}]}]
 ]),writes=[],paths=[],metrics={reads:0,writes:0};
 const wrap=path=>documents.has(path)?{path,data:documents.get(path),updateTime:'version'}:null;
 const store={metrics,async get(path){metrics.reads++;return wrap(path);},async batch(p){paths.push(...p);metrics.reads+=p.length;return new Map(p.filter(x=>documents.has(x)).map(x=>[x,wrap(x)]));},async query(){return[];},async list(prefix){return [...documents.keys()].filter(x=>x.startsWith(prefix+'/')).map(wrap);},async save(path,data){metrics.writes++;writes.push(path);documents.set(path,data);}};
 let responses=[{name:'가',classId:'1반',timestamp:'2026-09-16',scores:[]}];
 const input={store,classId:'1',slot:'2026-09-16T18:00+09:00',now:new Date('2026-09-16T09:00:00Z'),catalog:{events:[{id:'e1',classId:'1',date:'2026-09-15',title:'SW 테스팅',url:''}],responseSources:[{id:'s1',title:'임베디드AI-HW(SW 테스팅)',sheetUrl:'https://docs.google.com/spreadsheets/d/fixture/edit'}]},readSheet:async()=>({ok:true,attendance:[['성명','','','','09/14','09/15'],['가','','','','출석','결석'],['나','','','','결석','결석']]}),reader:{responses:async()=>responses}};
 return {documents,writes,paths,input,setResponses:r=>responses=r};
}
test('central worker reuses participation rules; changed-only writes; fresh response edits update counts',async()=>{
 const f=fixture();let r=await syncClassWorker(f.input);assert.equal(r.done,1);assert.equal(r.changed,1);assert.equal(f.writes.length,2);assert.deepEqual(f.paths,[],'no evidence reads for ordinary attendance');
 const summary=f.documents.get('surveyBetaSummaries/1/surveys/e1');assert.equal(summary.answered.length,1);assert.equal(summary.excluded.length,1);
 f.writes.length=0;r=await syncClassWorker({...f.input,now:new Date('2026-09-16T09:10:00Z')});assert.equal(r.changed,0);assert.equal(f.writes.length,0);
 f.setResponses([]);r=await syncClassWorker(f.input);assert.equal(r.changed,1);assert.equal(f.documents.get('surveyBetaSummaries/1/surveys/e1').missing.length,1);
});
test('unreadable Google source preserves old survey results and reports partial failure',async()=>{
 const f=fixture();await syncClassWorker(f.input);const old=f.documents.get('surveyBetaSummaries/1/surveys/e1');f.writes.length=0;f.input.reader.responses=async()=>{throw Error('denied');};
 const result=await syncClassWorker(f.input);assert.equal(result.failed,1);assert.equal(result.done,0);assert.equal(f.writes.length,0);assert.deepEqual(f.documents.get('surveyBetaSummaries/1/surveys/e1'),old);
});
test('deployed CommonJS bundle executes shared worker and rejects invalid tokens',async()=>{
 const f=fixture();assert.equal((await runtime.syncClassWorker(f.input)).done,1);
 let status;const res={setHeader(){},status(n){status=n;return this;},json(data){return data;}};
 const out=await handler({method:'POST',body:{googleAccessToken:'invalid'}},res);assert.equal(status,403);assert.equal(out.error,'LOGIN_REQUIRED');
});
test('REST writes use compare-and-swap and server timestamp; concurrent update is never overwritten',async()=>{
 let body;const store=createSyncStore('test',async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({error:{status:'FAILED_PRECONDITION'}}),{status:409});});
 await assert.rejects(store.save('surveyBetaSummaries/1/surveys/e1',{x:1,updatedAt:'bad'},{updateTime:'original'}),/CONCURRENT_UPDATE/);
 assert.equal(body.writes[0].currentDocument.updateTime,'original');assert.equal(body.writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');assert(!body.writes[0].update.fields.updatedAt);
});
