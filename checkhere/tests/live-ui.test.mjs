// End-to-end beta check: two browser tabs (an administrator and the relay tab)
// over a shared fake Firestore, the real bridge server and a fake CheckHere.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {studentKey,recordId,version} from '../identity.mjs';
import {APPROVER,prepareApproval,requestMatchesRecord} from '../approval-core.mjs';
import {mergeCurrentRecords} from '../../checkhere-current-core.mjs';
const ROOT=join(import.meta.dirname,'../..'),DATE=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());

const FAKE={
'firebase-app.js':`export const initializeApp=c=>({c});`,
'firebase-auth.js':`
const user=()=>{const email=window.__fakeUser;if(!email)return null;return {email,getIdToken:async()=>email==='${APPROVER}'?'approver-token':'other-token',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}})};};
export const getAuth=()=>({});export class GoogleAuthProvider{setCustomParameters(){}}
export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user()),0);return()=>{};};
export const signInWithPopup=async()=>{};export const signOut=async()=>{};export const setPersistence=async()=>{};export const browserLocalPersistence={};`,
'firebase-firestore.js':`
const call=(op,...a)=>window.__db(op,...a);const listeners=new Set();
export const getFirestore=()=>({});
export const doc=(db,...p)=>({type:'doc',path:p.join('/'),id:p.at(-1)});
export const collection=(db,...p)=>({type:'collection',path:p.join('/')});
export const where=(field,op,value)=>({field,op,value});
export const query=(c,...filters)=>({type:'query',path:c.path,filters});
export const serverTimestamp=()=>({__ts:true});
const snapDoc=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!=null,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
const read=async t=>t.type==='doc'?snapDoc(t.path,await call('get',t.path)):{docs:(await call('query',t.path,t.filters||[])).map(([p,d])=>snapDoc(p,d)),metadata:{fromCache:false}};
export const getDoc=read,getDocFromServer=read,getDocsFromServer=read,getDocs=read;
export const setDoc=(ref,data)=>call('commit',[{path:ref.path,data,merge:false}]);
export async function runTransaction(db,fn){const writes=[];const tx={get:r=>read(r),set:(r,d)=>writes.push({path:r.path,data:d,merge:false}),update:(r,d)=>writes.push({path:r.path,data:d,merge:true})};const out=await fn(tx);await call('commit',writes);return out;}
export function onSnapshot(target,...rest){
  const cb=rest.find(f=>typeof f==='function'),err=rest.filter(f=>typeof f==='function')[1];let last=null,live=true;
  const run=async()=>{try{const s=await read(target),key=JSON.stringify(target.type==='doc'?s.data():s.docs.map(d=>[d.id,d.data()]));if(live&&key!==last){last=key;cb(s);}}catch(e){err?.(e);}};
  const l={run};listeners.add(l);run();return()=>{live=false;listeners.delete(l);};
}
window.__fakeChanged=()=>{for(const l of listeners)l.run();};`,
};

function fakeCheckHere(){
  const truth=new Map();
  for(const [name,phone,raw,entry,exit] of [['가상하나','01000000001','08:55:00','09:00:00','18:00:00'],['가상둘','01000000002','09:20:00','09:20:00',null]]){
    const r={classId:'2',date:DATE,name,studentKey:studentKey(name,phone),phoneLast4:phone.slice(-4),schedule:'09:00 ~ 18:00',rawEntry:raw,entry,exit,entryMemo:'',exitMemo:'',outings:[],outingCount:0};r.id=recordId(r);truth.set(r.id,r);
  }
  const rows=(c,d)=>{const l=[...truth.values()].filter(r=>r.classId===String(c)&&r.date===d);if(!l.length)throw Error('강의가 없습니다.');return l.map(t=>({...t,entryMemo:null,exitMemo:null,source:'live',readState:'partial',tableSignature:[t.rawEntry,t.entry,t.exit].join('|'),collectedAt:new Date().toISOString()}));};
  let n=0;const details=row=>{const t=truth.get(row.id),r={...row,entry:t.entry,exit:t.exit,entryMemo:t.entryMemo,exitMemo:t.exitMemo,readState:'complete',collectedAt:new Date(Date.now()+ ++n).toISOString()};r.version=version(r);return r;};
  const adapter=Object.assign(Object.create(CheckHereCollector.prototype),{cancelled:false,loggedIn:async()=>true,requireLogin:async()=>{},openDay:async(c,d)=>rows(c,d),readDetails:async r=>details(r),
    read:async rec=>details(rows(rec.classId,rec.date).find(r=>r.id===rec.id)),readOpened:async rec=>details(rows(rec.classId,rec.date).find(r=>r.id===rec.id)),
    write:async(rec,field,change)=>{const t=truth.get(rec.id);t[field]=change.time||t[field];t[field+'Memo']=change.memo;return{time:t[field],memo:t[field+'Memo']};}});
  return {truth,adapter};
}
test('an administrator edits in the beta page; the relay tab writes CheckHere and both tabs see the verified value',{timeout:90000},async()=>{
  const db=new Map([['users/admin@example.com',{role:'ADMIN',active:true}]]),pages=[];let seq=0;
  const now=()=>{const ms=Date.now()+ ++seq;return {seconds:Math.floor(ms/1000),nanoseconds:(ms%1000)*1e6};};
  const resolve=v=>v&&typeof v==='object'?(v.__ts?now():Array.isArray(v)?v.map(resolve):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]))):v;
  const notify=()=>{for(const p of pages)p.evaluate(()=>window.__fakeChanged?.()).catch(()=>{});};
  const commit=writes=>{for(const w of writes){const data=resolve(w.data);db.set(w.path,w.merge?{...(db.get(w.path)||{}),...data}:data);}notify();};
  const ops={get:p=>structuredClone(db.get(p)??null),commit,
    query:(path,filters)=>[...db].filter(([p,d])=>p.startsWith(path+'/')&&p.split('/').length===path.split('/').length+1&&filters.every(f=>f.op==='in'?f.value.includes(d[f.field]):d[f.field]===f.value)).map(([p,d])=>[p,structuredClone(d)])};
  const {truth,adapter}=fakeCheckHere();
  const cloud={verify:async t=>{if(t!=='approver-token')throw Error('지정된 Google 관리자 계정만');},
    get:async id=>({id,data:structuredClone(db.get('checkhereRequests/'+id)),identities:[],updateTime:'t'}),
    claim:async(d,t,attemptId)=>commit([{path:'checkhereRequests/'+d.id,data:{status:'applying',attemptId},merge:true}]),
    async approveExisting(d,t,record){commit([{path:'checkhereRequests/'+d.id,data:{status:'approved',approvedBy:APPROVER,approval:prepareApproval(d.data,record,{allowAlreadyApplied:true})},merge:true}]);return this.get(d.id);},
    async finish(id,t,attemptId,job){
      const req=db.get('checkhereRequests/'+id);assert(job.status!=='verified'||requestMatchesRecord(req,job.current));
      const path=`classes/${job.current.classId}/checkhereCurrent/${job.current.date}`,old=db.get(path);
      const writes=[{path:'checkhereRequests/'+id,data:{status:job.status,result:{message:job.message,platformSaved:true}},merge:true}];
      if(job.current)writes.push({path,data:{classId:job.current.classId,date:job.current.date,records:mergeCurrentRecords(old?.records||[],[job.current],job.current.classId,job.current.date),jobId:job.id,updatedBy:APPROVER,updatedAt:{__ts:true}},merge:false});
      commit(writes);return{platformSaved:true};
    }};
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/live-ui-')),collector:adapter,port:8765,approvalCloud:cloud});
  await new Promise(r=>app.server.listen(8765,'127.0.0.1',r));
  // Real Chrome asks the user to allow local network access once; headless cannot click it.
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,args:['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults']});
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css'};
  async function open(email){
    const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(20000);
    await page.exposeFunction('__db',(op,...a)=>ops[op](...a));
    await page.addInitScript(e=>{window.__fakeUser=e;},email);
    await context.route('https://www.gstatic.com/firebasejs/10.12.5/*',r=>r.fulfill({contentType:'text/javascript',body:FAKE[new URL(r.request().url()).pathname.split('/').pop()]}));
    await context.route('https://portal.test/**',r=>{const p=new URL(r.request().url()).pathname;try{r.fulfill({contentType:types[extname(p)]||'text/plain',body:readFileSync(join(ROOT,p))});}catch{r.fulfill({status:404,body:''});}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('https://portal.test/checkhere-live.html');pages.push(page);return {page,errors};
  }
  try{
    const relay=await open(APPROVER);
    await relay.page.getByText('아직 이 반·날짜의 저장본이 없습니다').waitFor();
    await relay.page.fill('#relayKey',app.key);await relay.page.click('#relayStart');
    await relay.page.getByText('작동 중').waitFor();await relay.page.click('#relayNow');
    await relay.page.locator('#rows tr',{hasText:'가상둘'}).waitFor();
    const admin=await open('admin@example.com');
    assert.equal(await admin.page.locator('#relay').count(),0,'relay controls are approver-only');
    const row=admin.page.locator('#rows tr',{hasText:'가상둘'});await row.waitFor();
    await row.getByRole('button',{name:'수정'}).click();
    await admin.page.fill('#fEntryMemo','(인정지각)병원_담임:가상');await admin.page.fill('#fReason','진료확인서 제출');
    await admin.page.click('#submitEdit');
    await admin.page.locator('#reqs').getByText('진료확인서 제출').waitFor();
    await admin.page.locator('#rows tr',{hasText:'가상둘'}).getByText('반영 완료').waitFor({timeout:30000});
    await admin.page.locator('#rows tr',{hasText:'가상둘'}).getByText('(인정지각)병원_담임:가상').waitFor();
    await relay.page.locator('#rows tr',{hasText:'가상둘'}).getByText('(인정지각)병원_담임:가상').waitFor();
    assert.equal([...truth.values()].find(t=>t.name==='가상둘').entryMemo,'(인정지각)병원_담임:가상','CheckHere written');
    const [reqPath,req]=[...db].find(([p,d])=>p.startsWith('checkhereRequests/')&&d.name==='가상둘');
    assert.equal(req.createdBy,'admin@example.com');assert.equal(req.status,'verified');assert.equal(req.approvedBy,APPROVER);
    assert.deepEqual(Object.keys(req).filter(k=>!['classId','date','name','phoneLast4','reason','changes','createdBy','createdAt','updatedAt','status','approval','approvedBy','approvedAt','attemptId','result'].includes(k)),[],'only fields the existing rules allow');
    const day=db.get(`classes/2/checkhereCurrent/${DATE}`);assert.deepEqual(Object.keys(day).sort(),['classId','date','jobId','records','updatedAt','updatedBy']);
    // Locked while another edit is processing; editing an unchanged form is refused.
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByRole('button',{name:'수정'}).click();
    await admin.page.fill('#fReason','확인');await admin.page.click('#submitEdit');
    await admin.page.getByText('바뀐 값이 없습니다.').waitFor();await admin.page.click('#cancelEdit');
    // With the relay stopped an edit waits; its author can withdraw it.
    await relay.page.click('#relayStop');await relay.page.getByText('꺼져 있음').waitFor();
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByRole('button',{name:'수정'}).click();
    await admin.page.fill('#fExitMemo','조퇴_병원');await admin.page.fill('#fReason','조퇴 확인');await admin.page.click('#submitEdit');
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByText('반영 대기').waitFor();
    assert(await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByRole('button',{name:'수정'}).isDisabled(),'one active edit per student');
    admin.page.once('dialog',d=>d.accept());await admin.page.getByRole('button',{name:'요청 취소'}).click();
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByText('취소',{exact:true}).waitFor();
    assert.equal([...truth.values()].find(t=>t.name==='가상하나').exitMemo,'','withdrawn edits never reach CheckHere');
    assert.deepEqual([...relay.errors,...admin.errors],[]);
    assert.ok(reqPath);
  }finally{await browser.close();app.close();}
});
