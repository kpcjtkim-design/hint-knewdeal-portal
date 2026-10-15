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
// 날짜는 요청 허용 범위(2026-07-27~2026-10-22) 안으로 고정합니다(docs/checkhere-handoff-review.md 8번).
// 연결 프로그램은 수집 PC의 실제 연결 프로그램(8765)과 겹치지 않는 포트에서 열고, 화면에는 HINT_TEST_BRIDGE로 알려 줍니다.
const ROOT=join(import.meta.dirname,'../..'),DATE='2026-10-12',PORT=18943,BRIDGE=`http://127.0.0.1:${PORT}`;
const NAMES=['가상하나','가상둘','01000000001','01000000002'],SIGNAL_KEYS=['at','build','busy','by','capabilities','lastErrorAt','queue','state'];
const until=async(f,what,ms=20000)=>{for(const end=Date.now()+ms;!f();){if(Date.now()>end)throw Error(what+' 대기 시간 초과');await new Promise(r=>setTimeout(r,50));}};

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
  // 화면 코드가 시험용 연결 주소를 받는지 먼저 확인합니다. 아니면 실제 연결 프로그램(8765)에 닿을 수 있어 브라우저를 열지 않습니다.
  assert.match(readFileSync(join(ROOT,'checkhere-live.mjs'),'utf8'),/HINT_TEST_BRIDGE[\s\S]*createBridgeClient\(\{base:BRIDGE,/,'checkhere-live.mjs must take the test bridge address');
  const db=new Map([['users/admin@example.com',{role:'ADMIN',active:true}]]),pages=[],signals=[],realBridge=[];let seq=0;
  const now=()=>{const ms=Date.now()+ ++seq;return {seconds:Math.floor(ms/1000),nanoseconds:(ms%1000)*1e6};};
  const resolve=v=>v&&typeof v==='object'?(v.__ts?now():Array.isArray(v)?v.map(resolve):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]))):v;
  const notify=()=>{for(const p of pages)p.evaluate(()=>window.__fakeChanged?.()).catch(()=>{});};
  const commit=writes=>{for(const w of writes){const data=resolve(w.data);if(w.path==='settings/checkhereRelay')signals.push(structuredClone(data));db.set(w.path,w.merge?{...(db.get(w.path)||{}),...data}:data);}notify();};
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
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/live-ui-')),collector:adapter,port:PORT,approvalCloud:cloud});
  await new Promise(r=>app.server.listen(PORT,'127.0.0.1',r));
  // Real Chrome asks the user to allow local network access once; headless cannot click it.
  // 다른 화면 시험처럼 설치된 Chrome을 씁니다. 브라우저를 못 열면 연결 프로그램을 닫고 끝냅니다(안 닫으면 시험이 끝나지 않음).
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults']}).catch(e=>{app.close();throw e;});
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css'};
  async function open(email){
    const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(20000);
    await page.exposeFunction('__db',(op,...a)=>ops[op](...a));
    await page.addInitScript(({email,bridge})=>{window.__fakeUser=email;window.HINT_TEST_BRIDGE=bridge;},{email,bridge:BRIDGE});
    // 안전장치: 실제 연결 프로그램 포트로 가는 요청은 막고 기록합니다(시험 끝에 0건이어야 함).
    for(const host of ['127.0.0.1','localhost'])await context.route(`http://${host}:8765/**`,r=>{realBridge.push(r.request().url());r.abort();});
    await context.route('https://www.gstatic.com/firebasejs/10.12.5/*',r=>r.fulfill({contentType:'text/javascript',body:FAKE[new URL(r.request().url()).pathname.split('/').pop()]}));
    await context.route('https://portal.test/**',r=>{const p=new URL(r.request().url()).pathname;try{r.fulfill({contentType:types[extname(p)]||'text/plain',body:readFileSync(join(ROOT,p))});}catch{r.fulfill({status:404,body:''});}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('https://portal.test/checkhere-live.html');pages.push(page);return {page,errors};
  }
  try{
    const relay=await open(APPROVER);
    await relay.page.getByText('아직 이 반·날짜의 저장본이 없습니다').waitFor();
    await relay.page.fill('#date',DATE);
    const startedAt=Date.now();
    await relay.page.fill('#relayKey',app.key);await relay.page.click('#relayStart');
    await relay.page.getByText('작동 중').waitFor();
    // 중계 신호: 시작하면 settings/checkhereRelay에 작동 중·연결 프로그램 능력이 바로 적힙니다.
    await until(()=>db.get('settings/checkhereRelay')?.state==='running','중계 신호(작동 중)');
    const on=db.get('settings/checkhereRelay');
    assert.deepEqual(Object.keys(on).sort(),SIGNAL_KEYS,'no class, student or error text in the signal');
    assert(['approval-current-sync-v1','live-approval-preview-v1','incremental-sync-v1'].every(c=>on.capabilities.includes(c)),JSON.stringify(on));
    assert.equal(on.by,APPROVER);assert.equal(typeof on.at.seconds,'number');assert(on.build===null||typeof on.build==='string');assert.equal(on.lastErrorAt,null);
    await relay.page.click('#relayNow');
    await relay.page.locator('#rows tr',{hasText:'가상둘'}).waitFor();
    const admin=await open('admin@example.com');
    await admin.page.fill('#date',DATE);
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
    // 안내: 시간 칸을 비우는 수정은 여기서 하지 않고, 체크히어 시간 삭제는 /beta2 출결대조에서 합니다.
    await admin.page.getByText(/체크히어 시간 삭제는 2기 베타 출결대조\(\/beta2\)에서 결석으로 저장하거나 체크히어 시간 옆 ×로 합니다/).waitFor();
    await admin.page.fill('#fReason','확인');await admin.page.click('#submitEdit');
    await admin.page.getByText('바뀐 값이 없습니다.').waitFor();await admin.page.click('#cancelEdit');
    // With the relay stopped an edit waits; its author can withdraw it.
    await relay.page.click('#relayStop');await relay.page.getByText('꺼져 있음').waitFor();
    // 멈추면 state:'stopped'를 한 번 씁니다. 작동 중에는 1분에 한 번을 넘지 않고, 어떤 신호에도 학생 이름·번호가 없습니다.
    await until(()=>db.get('settings/checkhereRelay')?.state==='stopped','중계 신호(멈춤)');
    const off=db.get('settings/checkhereRelay'),ranMs=Date.now()-startedAt;
    assert.deepEqual(Object.keys(off).sort(),SIGNAL_KEYS);assert.equal(off.busy,false);assert.deepEqual(off.capabilities,on.capabilities);
    assert(signals.length>=2&&signals.length<=2+Math.floor(ranMs/60000),`signal writes ${signals.length} in ${ranMs}ms`);
    assert.equal(signals.filter(s=>s.state==='stopped').length,1,'one stop signal');
    for(const s of signals){const text=JSON.stringify(s);assert(!NAMES.some(n=>text.includes(n)),text);}
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByRole('button',{name:'수정'}).click();
    await admin.page.fill('#fExitMemo','조퇴_병원');await admin.page.fill('#fReason','조퇴 확인');await admin.page.click('#submitEdit');
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByText('반영 대기').waitFor();
    assert(await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByRole('button',{name:'수정'}).isDisabled(),'one active edit per student');
    admin.page.once('dialog',d=>d.accept());await admin.page.getByRole('button',{name:'요청 취소'}).click();
    await admin.page.locator('#rows tr',{hasText:'가상하나'}).getByText('취소',{exact:true}).waitFor();
    assert.equal([...truth.values()].find(t=>t.name==='가상하나').exitMemo,'','withdrawn edits never reach CheckHere');
    // 시간 삭제 요청(/beta2 출결대조가 만듦)은 요청 목록에 '(삭제)'로, 사유 칸의 ''는 '(비움)'으로 보입니다.
    db.set('checkhereRequests/live-delete-ui-000001',{classId:'2',date:DATE,name:'가상하나',phoneLast4:'0001',reason:'[실시간 베타] [2기 베타] 출결대조 시간 삭제 · 퇴실 [기준:0123abcd]',changes:{exit:'',exitMemo:''},deleteTimes:['exit'],status:'rejected',reviewNote:'가상 반려',createdBy:'admin@example.com',createdAt:now(),updatedAt:now()});notify();
    await admin.page.locator('#reqs').getByText('퇴실: (삭제) · 퇴실 사유: (비움)').waitFor();
    assert.deepEqual([...relay.errors,...admin.errors],[]);
    assert.deepEqual(realBridge,[],'the real bridge port is never contacted');
    assert.ok(reqPath);
  }finally{await browser.close();app.close();}
});
