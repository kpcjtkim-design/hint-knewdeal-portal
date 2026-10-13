import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {CheckHereCollector} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {studentKey,recordId,version} from '../identity.mjs';
import {APPROVER,prepareApproval,requestMatchesRecord} from '../approval-core.mjs';
import {createCurrentSaver,mergeCurrentRecords} from '../../checkhere-current-core.mjs';
import {LIVE_MARK,baseTag,buildLiveRequest,editorReason,inLiveWindow,isLiveRequest,koreaClock,tagOf} from '../../checkhere-live-core.mjs';
import {createBridgeClient,createLiveRelay} from '../../checkhere-live-relay.mjs';

const DATE='2026-10-12';
test('Korean clock, live window and request tags',()=>{
  assert.deepEqual(koreaClock(new Date('2026-10-12T00:30:00Z')),{date:'2026-10-12',time:'09:30',weekday:1});
  assert.equal(inLiveWindow(new Date('2026-10-12T00:30:00Z')),true);
  assert.equal(inLiveWindow(new Date('2026-10-12T10:00:00Z')),false,'19:00 KST');
  assert.equal(inLiveWindow(new Date('2026-10-11T00:30:00Z')),false,'Sunday');
  const r={id:'x',entry:'09:00:00',entryMemo:'',exit:null};
  assert.equal(baseTag(r,['entryMemo','entry']),baseTag(r,['entry','entryMemo']));
  assert.notEqual(baseTag(r,['entry']),baseTag({...r,entry:'09:01:00'},['entry']));
  assert.equal(baseTag(r,['exit']),baseTag({...r,entry:'10:00:00'},['exit']),'unrelated fields do not invalidate an edit');
  const reason=`${LIVE_MARK} 버스 지연 [기준:${baseTag(r,['entry'])}]`;
  assert.equal(tagOf(reason),baseTag(r,['entry']));assert.equal(isLiveRequest({reason}),true);assert.equal(isLiveRequest({reason:'일반 요청'}),false);
  assert.equal(editorReason(reason),'버스 지연');
});
const live={id:'r1',classId:'2',date:DATE,name:'가상학생',phoneLast4:'0001',studentKey:'k',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'09:12:00',entry:'09:12:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0};
test('editor builds only changed fields and refuses blanks, no-ops and missing reasons',()=>{
  const req=buildLiveRequest(live,{entry:'09:12',exit:'18:00:00',entryMemo:'지각_교통',exitMemo:''},'버스 지연');
  assert.deepEqual(req.changes,{entryMemo:'지각_교통'});assert.equal(req.phoneLast4,'0001');assert(req.reason.startsWith(LIVE_MARK));assert.equal(tagOf(req.reason),baseTag(live,['entryMemo']));
  assert.throws(()=>buildLiveRequest(live,{entry:'09:12:00',exit:'18:00:00',entryMemo:'',exitMemo:''},'x'),/바뀐 값이 없습니다/);
  assert.throws(()=>buildLiveRequest(live,{entry:'',exit:'18:00:00',entryMemo:'',exitMemo:''},'x'),/비우는/);
  assert.throws(()=>buildLiveRequest(live,{entry:'09:00',exit:'18:00',entryMemo:'',exitMemo:''},' '),/근거/);
  assert.throws(()=>buildLiveRequest(live,{entry:'9시',exit:'18:00',entryMemo:'',exitMemo:''},'x'),/형식/);
  assert.throws(()=>buildLiveRequest({...live,readState:'partial'},{entry:'09:00',exit:'18:00',entryMemo:'',exitMemo:''},'x'),/상세 기록/);
  assert.throws(()=>buildLiveRequest(live,{entry:'09:00',exit:'08:00',entryMemo:'',exitMemo:''},'x'),/퇴실이 입실보다/);
});

// ---- A small CheckHere + Firestore world wired to the real bridge server ----
function world({classes={'2':[['가상하나','01000000001','08:55:00','09:00:00','18:00:00'],['가상둘','01000000002','09:20:00','09:20:00','18:00:00']]}}={}){
  const truth=new Map(),reads=[];
  for(const [classId,students] of Object.entries(classes))for(const [name,phone,raw,entry,exit] of students){
    const key=studentKey(name,phone),r={classId,date:DATE,name,studentKey:key,phoneLast4:phone.slice(-4),schedule:'09:00 ~ 18:00',rawEntry:raw,entry,exit,entryMemo:'',exitMemo:'',outings:[],outingCount:0};r.id=recordId(r);truth.set(r.id,r);
  }
  const rowsFor=(classId,date)=>{const list=[...truth.values()].filter(r=>r.classId===String(classId)&&r.date===date);if(!list.length)throw Error(`${date} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);
    return list.map((t,i)=>({...t,rowIndex:i+2,entryMemo:null,exitMemo:null,source:'live',readState:'partial',tableSignature:[t.schedule,t.rawEntry,t.entry,t.exit,t.outingCount].join('|'),collectedAt:new Date().toISOString()}));};
  const details=row=>{reads.push(row.name);const t=truth.get(row.id),r={...row,entry:t.entry,exit:t.exit,entryMemo:t.entryMemo,exitMemo:t.exitMemo,readState:'complete',collectedAt:new Date(Date.now()+reads.length).toISOString()};r.version=version(r);return r;};
  const adapter=Object.assign(Object.create(CheckHereCollector.prototype),{
    cancelled:false,loggedIn:async()=>true,requireLogin:async()=>{},
    openDay:async(classId,date)=>rowsFor(classId,date),readDetails:async row=>details(row),
    read:async record=>details(rowsFor(record.classId,record.date).find(r=>r.id===record.id)),
    readOpened:async record=>details(rowsFor(record.classId,record.date).find(r=>r.id===record.id)),
    write:async(record,field,change)=>{const t=truth.get(record.id);t[field]=change.time||t[field]||(field==='entry'?'09:00:00':'18:00:00');t[field+'Memo']=change.memo;return{time:t[field],memo:t[field+'Memo']};},
  });
  // Firestore stand-in: request documents, current-day documents, listeners.
  const requests=new Map(),current=new Map(),listeners=new Set(),admins=new Set([APPROVER,'admin@example.com']);
  const notify=()=>{const list=[...requests].map(([id,d])=>({id,...structuredClone(d)}));for(const f of listeners)f(list);};
  const saveRecords=createCurrentSaver({
    read:async(c,d)=>current.has(c+'/'+d)?{records:structuredClone(current.get(c+'/'+d))}:null,readLegacy:async()=>[],
    commit:async(c,d,rows)=>{current.set(c+'/'+d,mergeCurrentRecords(current.get(c+'/'+d)||[],rows,c,d));},
  });
  let commits=0;
  const store={
    watchQueue(cb){listeners.add(cb);notify();return()=>listeners.delete(cb);},
    async approve(id,approval){const d=requests.get(id);assert.equal(d.status,'pending');Object.assign(d,{status:'approved',approval,approvedBy:APPROVER});notify();},
    async reject(id,note){const d=requests.get(id);assert.equal(d.status,'pending');Object.assign(d,{status:'rejected',reviewNote:note,reviewedBy:APPROVER});notify();},
    isAdmin:async email=>admins.has(email),identities:async()=>[],
    async saveRecords(records,job){commits++;return saveRecords(records,job);},
  };
  const cloud={
    verify:async t=>{if(t!=='approver-token')throw Error('지정된 Google 관리자 계정만');},
    get:async id=>({id,data:structuredClone(requests.get(id)),identities:[],updateTime:'t'}),
    claim:async(doc,token,attemptId)=>{const d=requests.get(doc.id);assert.equal(d.status,'approved');Object.assign(d,{status:'applying',attemptId});notify();},
    async approveExisting(doc,token,record){const d=requests.get(doc.id);Object.assign(d,{status:'approved',approvedBy:APPROVER,approval:prepareApproval(d,record,{allowAlreadyApplied:true})});notify();return this.get(doc.id);},
    async finish(id,token,attemptId,job){
      const d=requests.get(id);assert.equal(d.attemptId,attemptId);
      if(job.status==='verified'){assert(requestMatchesRecord(d,job.current));await saveRecords([job.current],job);}
      Object.assign(d,{status:job.status,result:{message:job.message,platformSaved:job.status==='verified'}});notify();return d.result;
    },
  };
  return {truth,reads,requests,current,store,cloud,adapter,admins,notify,get commits(){return commits;},
    add(id,data){requests.set(id,{status:'pending',createdBy:'admin@example.com',createdAt:{seconds:requests.size+1},...data});notify();},
    day:c=>current.get(c+'/'+DATE)||[]};
}
async function harness(w,port,opts={}){
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/live-')),collector:w.adapter,port,approvalCloud:w.cloud});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  let clock=new Date('2026-10-12T00:30:00Z');const logs=[];
  const relay=createLiveRelay({bridge:createBridgeClient({base:`http://127.0.0.1:${port}`,key:app.key,fetchImpl:(u,o)=>fetch(u,{...o,headers:{...o.headers,connection:'close'}})}),store:w.store,
    user:{email:APPROVER,getIdToken:async()=>'approver-token'},log:e=>logs.push(e.text),now:()=>clock,sleep:()=>new Promise(r=>setTimeout(r,2)),pollMs:2,inWindow:()=>true,...opts});
  await relay.start({loop:false});
  return {app,relay,logs,advance(ms){clock=new Date(clock.getTime()+ms);},close:()=>{relay.stop();app.close();}};
}
test('10-minute cycle saves a class once, skips unchanged students, re-reads only changed ones and drops classes without a lecture',async()=>{
  const w=world(),h=await harness(w,18791,{classIds:['2','3']});
  try{
    assert.equal(await h.relay.step(),'sync');assert.equal(w.day('2').length,2);assert.deepEqual(w.reads.sort(),['가상둘','가상하나']);
    assert.equal(await h.relay.step(),'sync');assert.match(h.logs.join('\n'),/3반: 오늘 강의가 없어/);
    assert.equal(await h.relay.step(),'idle','waits for the next 10-minute round');
    h.advance(10*60*1000);w.reads.length=0;const commits=w.commits;
    await h.relay.step();await h.relay.step();
    assert.deepEqual(w.reads,[],'nothing changed: no editor opened');assert.equal(w.commits,commits,'and no DB write');
    [...w.truth.values()].find(t=>t.name==='가상둘').exit='17:30:00';
    h.advance(10*60*1000);await h.relay.step();
    assert.deepEqual(w.reads,['가상둘']);assert.equal(w.day('2').find(r=>r.name==='가상둘').exit,'17:30:00');
  }finally{h.close();}
});
test('an admin edit is approved, written to CheckHere, verified and lands in the live document',async()=>{
  const w=world(),h=await harness(w,18792,{classIds:['2']});
  try{
    await h.relay.step();const shown=w.day('2').find(r=>r.name==='가상둘');
    const input=buildLiveRequest(shown,{entry:'09:20',exit:'18:00',entryMemo:'(인정지각)병원_담임:가상',exitMemo:''},'진료확인서 제출');
    w.add('live-req-000000000001',input);
    assert.equal(await h.relay.step(),'request');
    const req=w.requests.get('live-req-000000000001');assert.equal(req.status,'verified',JSON.stringify(req.result)+h.logs.join('\n'));
    assert.equal([...w.truth.values()].find(t=>t.name==='가상둘').entryMemo,'(인정지각)병원_담임:가상','CheckHere changed');
    assert.equal(w.day('2').find(r=>r.name==='가상둘').entryMemo,'(인정지각)병원_담임:가상','live document updated');
    assert.equal(req.approvedBy,APPROVER);assert.equal(req.createdBy,'admin@example.com','the editor stays on record');
  }finally{h.close();}
});
test('stale edits, non-admin and unmarked requests are never written to CheckHere',async()=>{
  const w=world(),h=await harness(w,18793,{classIds:['2']});
  try{
    await h.relay.step();const shown=w.day('2').find(r=>r.name==='가상하나');
    const input=buildLiveRequest(shown,{entry:'09:00',exit:'18:00',entryMemo:'',exitMemo:'조퇴_병원'},'조퇴 확인');
    [...w.truth.values()].find(t=>t.name==='가상하나').exitMemo='다른 관리자가 먼저 입력';
    w.add('live-stale-0000000001',input);await h.relay.step();
    const stale=w.requests.get('live-stale-0000000001');assert.equal(stale.status,'rejected');assert.match(stale.reviewNote,/바뀌었습니다/);
    assert.equal([...w.truth.values()].find(t=>t.name==='가상하나').exitMemo,'다른 관리자가 먼저 입력','not overwritten');
    assert.equal(w.day('2').find(r=>r.name==='가상하나').exitMemo,'다른 관리자가 먼저 입력','viewers see the newer value');
    const fresh=w.day('2').find(r=>r.name==='가상둘');
    w.add('live-teacher-00000001',{...buildLiveRequest(fresh,{entry:'09:20',exit:'18:00',entryMemo:'x',exitMemo:''},'y'),createdBy:'teacher@example.com'});
    w.add('plain-request-0000001',{classId:'2',date:DATE,name:'가상둘',phoneLast4:'0002',reason:'일반 요청',changes:{entryMemo:'z'}});
    assert.equal(await h.relay.step(),'request');assert.equal(w.requests.get('live-teacher-00000001').status,'pending','left for a human');
    assert.equal(await h.relay.step(),'idle','plain requests are not in the beta queue');
    assert.equal(w.requests.get('plain-request-0000001').status,'pending');
    assert.equal([...w.truth.values()].find(t=>t.name==='가상둘').entryMemo,'');
  }finally{h.close();}
});
test('a memo on a student with no exit yet gets the configured default time, as in the request flow',async()=>{
  const w=world({classes:{'2':[['가상셋','01000000003','09:01:00','09:01:00',null]]}}),h=await harness(w,18794,{classIds:['2']});
  try{
    await h.relay.step();const shown=w.day('2')[0];
    w.add('live-default-00000001',buildLiveRequest(shown,{entry:'09:01',exit:'',entryMemo:'',exitMemo:'조퇴_병원'},'조퇴'));
    await h.relay.step();const req=w.requests.get('live-default-00000001');
    assert.equal(req.status,'verified',h.logs.join('\n'));const t=w.truth.values().next().value;assert.equal(t.exit,'18:00:00');assert.equal(t.exitMemo,'조퇴_병원');
  }finally{h.close();}
});
test('a request that keeps failing by itself is closed after five tries; bridge outages are retried without limit',async()=>{
  const w=world(),h=await harness(w,18795,{classIds:['2'],intervalMs:3600000});
  try{
    await h.relay.step();const shown=w.day('2').find(r=>r.name==='가상둘');
    const input=buildLiveRequest(shown,{entry:'09:20',exit:'18:00',entryMemo:'x',exitMemo:''},'y');
    w.add('live-missing-00000001',{...input,name:'없는학생',phoneLast4:''});
    for(let i=0;i<5;i++){assert.equal(await h.relay.step(),'request');h.advance(61000);}
    const req=w.requests.get('live-missing-00000001');assert.equal(req.status,'rejected');assert.match(req.reviewNote,/5번 시도/);
    assert.equal(await h.relay.step(),'idle');
  }finally{h.close();}
  const w2=world(),h2=await harness(w2,18796,{classIds:['2'],intervalMs:3600000});
  try{
    await h2.relay.step();const shown=w2.day('2').find(r=>r.name==='가상둘');
    w2.add('live-offline-00000001',buildLiveRequest(shown,{entry:'09:20',exit:'18:00',entryMemo:'x',exitMemo:''},'y'));
    h2.app.server.close();h2.app.server.closeAllConnections?.();
    for(let i=0;i<7;i++){await h2.relay.step();h2.advance(61000);}
    assert.equal(w2.requests.get('live-offline-00000001').status,'pending','kept for when the collector PC is back');
  }finally{h2.relay.stop();h2.app.db.close();}
});
