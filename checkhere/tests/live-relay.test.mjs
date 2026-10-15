import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {CheckHereCollector} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {studentKey,recordId,version} from '../identity.mjs';
import {APPROVER,prepareApproval,requestMatchesRecord} from '../approval-core.mjs';
import {createCurrentSaver,mergeCurrentRecords} from '../../checkhere-current-core.mjs';
import {LIVE_MARK,baseTag,buildLiveRequest,editorReason,inLiveWindow,isLiveRequest,koreaClock,requestsFor,tagOf} from '../../checkhere-live-core.mjs';
import {TIME_DELETE_OLD,TIME_DELETE_RULES,createBridgeClient,createLiveRelay,relaySignal} from '../../checkhere-live-relay.mjs';

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
// 시간 삭제는 기록 번호 표시가 있는 기록에서만: 관리자가 1교시를 넣은 학생(입실 번호 없음)의 표시
const LIVE=live,MARKS={entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false};
test('editor builds only changed fields and refuses blanks, no-ops and missing reasons',()=>{
  const req=buildLiveRequest(live,{entry:'09:12',exit:'18:00:00',entryMemo:'지각_교통',exitMemo:''},'버스 지연');
  assert.deepEqual(req.changes,{entryMemo:'지각_교통'});assert.equal(req.phoneLast4,'0001');assert(req.reason.startsWith(LIVE_MARK));assert.equal(tagOf(req.reason),baseTag(live,['entryMemo']));
  assert.throws(()=>buildLiveRequest(live,{entry:'09:12:00',exit:'18:00:00',entryMemo:'',exitMemo:''},'x'),/바뀐 값이 없습니다/);
  assert.throws(()=>buildLiveRequest(live,{entry:'',exit:'18:00:00',entryMemo:'',exitMemo:''},'x'),/비우는/);
  assert.throws(()=>buildLiveRequest(live,{entry:'09:00',exit:'18:00',entryMemo:'',exitMemo:''},' '),/근거/);
  assert.throws(()=>buildLiveRequest(live,{entry:'9시',exit:'18:00',entryMemo:'',exitMemo:''},'x'),/형식/);
  assert.throws(()=>buildLiveRequest({...live,readState:'partial'},{entry:'09:00',exit:'18:00',entryMemo:'',exitMemo:''},'x'),/상세 기록/);
  assert.throws(()=>buildLiveRequest(live,{entry:'09:00',exit:'08:00',entryMemo:'',exitMemo:''},'x'),/퇴실이 입실보다/);
  assert.equal(Object.hasOwn(req,'deleteTimes'),false,'an ordinary edit keeps the old request shape');
  assert.throws(()=>buildLiveRequest(live,{entry:'09:12',exit:'',entryMemo:'',exitMemo:''},'x'),/비우는 수정은 「시간 삭제」로만/);
});
// 시간 삭제: 지정한 쪽 폼 시간은 비우고, 체크히어에 시간이 있으면 ''로 보냅니다. [기준] 지문은 지우는 시간도 덮습니다.
test('time deletion builds a blank for the named side, tags it and skips a side that is already blank',()=>{
  const form={entry:'09:12',exit:'',entryMemo:'',exitMemo:''};
  // 기록 번호 표시(연결 프로그램이 붙임)가 없으면 지우지 않습니다.
  assert.throws(()=>buildLiveRequest(LIVE,form,'결석 확인',{deleteTimes:['exit']}),/퇴실 기록 번호를 확인하지 못했습니다/);
  const live={...LIVE,...MARKS};
  const req=buildLiveRequest(live,form,'결석 확인',{deleteTimes:['exit']});
  assert.deepEqual(req.changes,{exit:''});assert.deepEqual(req.deleteTimes,['exit']);assert(req.reason.startsWith(LIVE_MARK));
  assert.equal(tagOf(req.reason),baseTag(live,['exit']));assert.notEqual(tagOf(req.reason),baseTag({...live,exit:'17:00:00'},['exit']),'a changed exit no longer matches the tag');
  const memo={...live,exitMemo:'조퇴_담임:가상(17:00)'},cleared=buildLiveRequest(memo,form,'결석 확인',{deleteTimes:['exit']});
  assert.deepEqual(cleared.changes,{exit:'',exitMemo:''},'clearing that side memo is optional');assert.equal(tagOf(cleared.reason),baseTag(memo,['exit','exitMemo']));
  assert.deepEqual(buildLiveRequest(memo,{...form,exitMemo:memo.exitMemo},'결석 확인',{deleteTimes:['exit']}).changes,{exit:''},'or the memo is left alone');
  const both=buildLiveRequest({...live,exit:null},{entry:'',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['entry','exit']});
  assert.deepEqual([both.changes,both.deleteTimes],[{entry:''},['entry']],'the already blank exit is skipped');
  assert.throws(()=>buildLiveRequest({...live,exit:null},form,'결석 확인',{deleteTimes:['exit']}),/바뀐 값이 없습니다/);
  assert.throws(()=>buildLiveRequest(live,{...form,exit:'18:00'},'결석 확인',{deleteTimes:['exit']}),/삭제할 시간 칸은 비워/);
  assert.throws(()=>buildLiveRequest(live,{...form,exitMemo:'남길 사유'},'결석 확인',{deleteTimes:['exit']}),/사유는 비워/);
  assert.throws(()=>buildLiveRequest(live,form,'결석 확인',{deleteTimes:['exitMemo']}),/삭제할 시간 항목/);
  assert.throws(()=>buildLiveRequest({...live,entryKind:'PASS'},{...form,entry:'',exit:'18:00'},'결석 확인',{deleteTimes:['entry']}),/계산된 1교시/);
  assert.throws(()=>buildLiveRequest({...live,enterEventId:true},{...form,entry:'',exit:'18:00'},'결석 확인',{deleteTimes:['entry']}),/체크인한 학생은 퇴실만/);
});

// ---- A small CheckHere + Firestore world wired to the real bridge server ----
function world({classes={'2':[['가상하나','01000000001','08:55:00','09:00:00','18:00:00'],['가상둘','01000000002','09:20:00','09:20:00','18:00:00']]}}={}){
  const truth=new Map(),reads=[];
  for(const [classId,students] of Object.entries(classes))for(const [name,phone,raw,entry,exit] of students){
    const key=studentKey(name,phone),r={classId,date:DATE,name,studentKey:key,phoneLast4:phone.slice(-4),schedule:'09:00 ~ 18:00',rawEntry:raw,entry,exit,entryMemo:'',exitMemo:'',outings:[],outingCount:0,...MARKS};r.id=recordId(r);truth.set(r.id,r);
  }
  const rowsFor=(classId,date)=>{const list=[...truth.values()].filter(r=>r.classId===String(classId)&&r.date===date);if(!list.length)throw Error(`${date} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);
    return list.map((t,i)=>({...t,rowIndex:i+2,entryMemo:null,exitMemo:null,source:'live',readState:'partial',tableSignature:[t.schedule,t.rawEntry,t.entry,t.exit,t.outingCount].join('|'),collectedAt:new Date().toISOString()}));};
  const details=row=>{reads.push(row.name);const t=truth.get(row.id),r={...row,entry:t.entry,exit:t.exit,entryMemo:t.entryMemo,exitMemo:t.exitMemo,readState:'complete',collectedAt:new Date(Date.now()+reads.length).toISOString()};r.version=version(r);return r;};
  const adapter=Object.assign(Object.create(CheckHereCollector.prototype),{
    cancelled:false,loggedIn:async()=>true,requireLogin:async()=>{},
    openDay:async(classId,date)=>rowsFor(classId,date),readDetails:async row=>details(row),
    read:async record=>details(rowsFor(record.classId,record.date).find(r=>r.id===record.id)),
    readOpened:async record=>details(rowsFor(record.classId,record.date).find(r=>r.id===record.id)),
    write:async(record,field,change,{deleteFields=[]}={})=>{const t=truth.get(record.id);
      // 가짜 수정창 '삭제': 승인된 시간 삭제 요청이 지정한 쪽만 지웁니다(그 칸의 사유·기록 번호도 함께 사라짐).
      if(deleteFields.includes(field)){Object.assign(t,{[field]:null,[field+'Memo']:''},field==='exit'?{exitEventId:false}:{entryKind:null,entryEventId:false});return{time:null,memo:''};}
      t[field]=change.time||t[field]||(field==='entry'?'09:00:00':'18:00:00');t[field+'Memo']=change.memo;return{time:t[field],memo:t[field+'Memo']};},
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
      // 실제 finish(cloud-approval.mjs)처럼 확인 완료면 완료 문구를 새로 쓰고 결과(results)를 남깁니다.
      Object.assign(d,{status:job.status,result:{message:job.status==='verified'?'체크히어 반영·원본 확인·플랫폼 DB 저장 완료':job.message,results:job.results||[],platformSaved:job.status==='verified'}});notify();return d.result;
    },
  };
  return {truth,reads,requests,current,store,cloud,adapter,admins,notify,get commits(){return commits;},
    add(id,data){requests.set(id,{status:'pending',createdBy:'admin@example.com',createdAt:{seconds:requests.size+1},...data});notify();},
    day:c=>current.get(c+'/'+DATE)||[]};
}
// capabilities: 연결 프로그램에 넣을 능력(넣을 수 있는 build에서), addCapabilities: 중계가 보는 능력에 더함(연결 프로그램 쪽이 아직 없을 때의 가짜)
async function harness(w,port,opts={},{capabilities,addCapabilities=[]}={}){
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/live-')),collector:w.adapter,port,approvalCloud:w.cloud,...(capabilities?{capabilities}:{})});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  let clock=new Date('2026-10-12T00:30:00Z');const logs=[];
  const client=createBridgeClient({base:`http://127.0.0.1:${port}`,key:app.key,fetchImpl:(u,o)=>fetch(u,{...o,headers:{...o.headers,connection:'close'}})});
  const bridge=addCapabilities.length?{...client,state:async c=>{const s=await client.state(c);return {...s,capabilities:[...new Set([...(s.capabilities||[]),...addCapabilities])]};}}:client;
  const relay=createLiveRelay({bridge,store:w.store,
    user:{email:APPROVER,getIdToken:async()=>'approver-token'},log:e=>logs.push(e.text),now:()=>clock,sleep:()=>new Promise(r=>setTimeout(r,2)),pollMs:2,inWindow:()=>true,...opts});
  await relay.start({loop:false});
  return {app,relay,logs,advance(ms){clock=new Date(clock.getTime()+ms);},close:()=>{relay.stop();app.close();}};
}
test('10-minute cycle saves a class once, skips unchanged students, re-reads only changed ones and drops classes without a lecture',async()=>{
  const w=world(),h=await harness(w,18791,{classIds:['2','3']});
  try{
    assert(h.relay.status().capabilities.includes('incremental-sync-v1'),'the real bridge capabilities show in the status');
    // 5b: /api/state가 build를 알립니다(옛 연결 프로그램이면 없음).
    const build=h.relay.status().build;assert.ok(build===null||/^\d{8}\.\d+$/.test(build),`build ${build}`);
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
    // 운영포털 '실패 건 다시 처리'가 만든 retry_ 요청은 근거에 실시간 표시가 복사돼 있어도 중계가 가져가지 않습니다.
    w.add('retry_'+'a'.repeat(64),{...buildLiveRequest(fresh,{entry:'09:20',exit:'18:00',entryMemo:'재처리',exitMemo:''},'재처리'),createdBy:APPROVER});
    assert.equal(await h.relay.step(),'idle');assert.equal(w.requests.get('retry_'+'a'.repeat(64)).status,'pending');
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
test('a live edit is refused while another request for the same student and field is in progress, even without phone digits',async()=>{
  const w=world(),h=await harness(w,18941,{classIds:['2']});
  try{
    await h.relay.step();const shown=w.day('2').find(r=>r.name==='가상둘');
    w.add('plain-old-000000000001',{classId:'2',date:DATE,name:'가상둘',phoneLast4:'',reason:'운영포털 요청',changes:{entry:'09:05:00'}});
    w.add('live-late-00000000001',buildLiveRequest(shown,{entry:'09:10',exit:'18:00',entryMemo:'',exitMemo:''},'입실 정정'));
    assert.equal(await h.relay.step(),'request');
    const req=w.requests.get('live-late-00000000001');assert.equal(req.status,'rejected');assert.match(req.reviewNote,/처리 중인 다른 수정 요청/);
    assert.equal([...w.truth.values()].find(t=>t.name==='가상둘').entry,'09:20:00','CheckHere untouched');
    assert.deepEqual(requestsFor(shown,[...w.requests].map(([id,d])=>({id,...d}))).map(r=>r.id).sort(),['live-late-00000000001','plain-old-000000000001'],'the viewer also sees the request without phone digits');
    // 다른 항목(퇴실 메모)만 바꾸는 요청은 겹치지 않으므로 반영됩니다.
    w.add('live-exit-00000000001',buildLiveRequest(shown,{entry:'09:20',exit:'18:00',entryMemo:'',exitMemo:'메모'},'퇴실 메모'));
    await h.relay.step();assert.equal(w.requests.get('live-exit-00000000001').status,'verified',h.logs.join('\n'));
  }finally{h.close();}
});
// ---- 시간 삭제 게이트(설계 6장 5b): 연결 프로그램의 time-delete-v1 능력이 있을 때만 지웁니다 ----
const BASE_CAPS=['memo-default-time-v1','approved-requests-v1','memo-only-requests-v1','approval-current-sync-v1','live-approval-preview-v1','automatic-request-collection-v1','phone-identity-v1','state-delta-v1','incremental-sync-v1','batch-sync-v1','probe-v1','page-data-v1'];
const exitOf=(w,name)=>[...w.truth.values()].find(t=>t.name===name).exit;
test('without time-delete-v1 a pending live deletion is refused without reading CheckHere, and an approved one waits',async()=>{
  const w=world(),h=await harness(w,18961,{classIds:['2'],intervalMs:3600000},{capabilities:BASE_CAPS});
  try{
    await h.relay.step();assert.equal(h.relay.status().capabilities.includes('time-delete-v1'),false);
    const shown=w.day('2').find(r=>r.name==='가상하나');
    const input=buildLiveRequest(shown,{entry:'09:00',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['exit']});
    w.reads.length=0;w.add('live-delete-000000001',input);
    assert.equal(await h.relay.step(),'request');
    const req=w.requests.get('live-delete-000000001');assert.equal(req.status,'rejected');assert.equal(req.reviewNote,TIME_DELETE_OLD);
    assert.match(req.reviewNote,/「체크히어 시작\.cmd」를 최신으로 실행한 뒤 다시 요청해 주세요/);
    assert.deepEqual(w.reads,[],'no preview read: CheckHere is not opened');assert.equal(exitOf(w,'가상하나'),'18:00:00','fake CheckHere untouched');
    // 이미 승인된 삭제 요청은 규칙상 반려할 수 없어 업데이트를 기다립니다(BRIDGE_OLD, 시도 횟수에 넣지 않음).
    w.add('live-delete-000000002',{...input,status:'approved',approvedBy:APPROVER,approval:prepareApproval(input,shown)});
    for(let i=0;i<6;i++){assert.equal(await h.relay.step(),'request');h.advance(61000);}
    assert.equal(w.requests.get('live-delete-000000002').status,'approved','kept for the updated collector');
    assert.match(h.logs.join('\n'),/승인된 시간 삭제 요청은 연결 프로그램 업데이트를 기다립니다/);
    assert.deepEqual(w.reads,[]);assert.equal(exitOf(w,'가상하나'),'18:00:00');
  }finally{h.close();}
});
test('with time-delete-v1 a live deletion is approved, deleted through the bridge, verified and reported as 삭제 확인; unpublished rules reject it',async()=>{
  const w=world(),h=await harness(w,18962,{classIds:['2']},{capabilities:[...BASE_CAPS,'time-delete-v1'],addCapabilities:['time-delete-v1']});
  try{
    await h.relay.step();assert.ok(h.relay.status().capabilities.includes('time-delete-v1'));
    // 규칙 미게시: 승인 저장(approval.after의 '')이 권한 거절되면 그 문구로 반려하고 체크히어는 그대로 둡니다.
    const approve=w.store.approve;w.store.approve=async()=>{throw Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});};
    const two=w.day('2').find(r=>r.name==='가상둘');
    w.add('live-delete-000000003',buildLiveRequest(two,{entry:'09:20',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['exit']}));
    assert.equal(await h.relay.step(),'request');
    assert.deepEqual([w.requests.get('live-delete-000000003').status,w.requests.get('live-delete-000000003').reviewNote],['rejected',TIME_DELETE_RULES]);
    assert.equal(exitOf(w,'가상둘'),'18:00:00');w.store.approve=approve;
    // 능력 있음: 승인 → 수정창 '삭제'(가짜) → 다시 읽어 확인 → 실시간 문서에 반영
    const shown=w.day('2').find(r=>r.name==='가상하나');
    w.add('live-delete-000000004',buildLiveRequest(shown,{entry:'09:00',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['exit']}));
    assert.equal(await h.relay.step(),'request');
    const req=w.requests.get('live-delete-000000004');assert.equal(req.status,'verified',JSON.stringify(req.result)+h.logs.join('\n'));
    assert.equal(req.result.results[0].deleted,true);assert.equal(req.approval.after.exit,'');assert.deepEqual(req.deleteTimes,['exit']);
    assert.equal(exitOf(w,'가상하나'),null,'CheckHere exit deleted');assert.equal([...w.truth.values()].find(t=>t.name==='가상하나').entry,'09:00:00','the other side stays');
    assert.equal(w.day('2').find(r=>r.name==='가상하나').exit,null,'live document shows the deletion');
    assert.match(h.logs.join('\n'),/가상하나: 체크히어 반영·확인·DB 저장 완료 · 퇴실 시간 삭제 확인/);
  }finally{h.close();}
});
// 중계 신호(settings/checkhereRelay)는 담임도 읽으므로 반·학생 이름과 오류 글이 들어가면 안 됩니다.
test('the relay signal carries state, busy, queue, capabilities, build and error time only',()=>{
  const caps=['approval-current-sync-v1','incremental-sync-v1'];
  const status={state:'running',current:'2반 가상둘',lastError:'2반 가상둘: 체크히어 읽기 실패',lastErrorAt:1760229000000,queue:3,processed:4,saves:2,lastCycle:{date:DATE,finishedAt:'x',classes:17},capabilities:caps,build:'20261014.1',bridgeBusy:false};
  const signal=relaySignal(status,{},APPROVER);
  assert.deepEqual(signal,{state:'running',busy:true,queue:3,capabilities:caps,build:'20261014.1',lastErrorAt:1760229000000,by:APPROVER});
  assert(!JSON.stringify(signal).includes('가상둘'),'no student name or error text');
  assert.deepEqual(relaySignal({...status,current:null,bridgeBusy:true},{capabilities:['x-v1','x-v1','가상둘',7],build:'빌드 가상둘'},APPROVER),{state:'running',busy:true,queue:3,capabilities:['x-v1'],build:null,lastErrorAt:1760229000000,by:APPROVER},'bridge busy counts; odd capability or build text is dropped');
  assert.deepEqual(relaySignal({...status,state:'stopped'},{},APPROVER),{state:'stopped',busy:false,queue:3,capabilities:caps,build:'20261014.1',lastErrorAt:1760229000000,by:APPROVER},'a stopped relay is never busy');
  assert.deepEqual(relaySignal(undefined),{state:'stopped',busy:false,queue:0,capabilities:[],build:null,lastErrorAt:null,by:null});
  assert.deepEqual(relaySignal({...status,lastErrorAt:'어제'},{},''),{...signal,lastErrorAt:null,by:null});
});
test('relay status shows the bridge capabilities, build and busy flag, and the time of the last error',async()=>{
  let bridgeState={capabilities:['approval-current-sync-v1','live-approval-preview-v1','incremental-sync-v1'],busy:null,records:[],cursor:'c1'};
  const clock=new Date('2026-10-12T00:30:00Z'),seen=[];
  const relay=createLiveRelay({bridge:{state:async()=>structuredClone(bridgeState),api:async()=>{throw Error('연결 프로그램 가상 오류');}},store:{watchQueue:()=>()=>{}},user:{email:APPROVER},now:()=>clock,inWindow:()=>false});
  relay.onStatus(s=>seen.push(s));
  await relay.start({loop:false});
  assert.deepEqual(relay.status().capabilities,bridgeState.capabilities);assert.equal(relay.status().build,null);assert.equal(relay.status().bridgeBusy,false);
  assert(seen.some(s=>s.capabilities.includes('incremental-sync-v1')),'listeners hear about new capabilities');
  bridgeState={...bridgeState,build:'20261014.1'};relay.syncNow('2',DATE);
  assert.equal(await relay.step(),'sync');
  const s=relay.status();assert.equal(s.build,'20261014.1');assert.equal(s.lastErrorAt,clock.getTime());assert.match(s.lastError,/가상 오류/);
  assert.deepEqual(relaySignal(s,{},APPROVER),{state:'running',busy:false,queue:0,capabilities:bridgeState.capabilities,build:'20261014.1',lastErrorAt:clock.getTime(),by:APPROVER});
  bridgeState={...bridgeState,busy:'job-1'};relay.syncNow('2',DATE);await relay.step();
  assert.equal(relay.status().bridgeBusy,true);assert.equal(relaySignal(relay.status(),{},APPROVER).busy,true,'the bridge is working on something else');
  // 일이 없을 때도 신호 전에 ping으로 연결 프로그램을 다시 봅니다. 닿지 않으면 능력을 알리지 않습니다.
  bridgeState={...bridgeState,busy:null,capabilities:[...bridgeState.capabilities,'time-delete-v1']};
  assert.equal(await relay.ping(),true);assert.ok(relaySignal(relay.status(),{},APPROVER).capabilities.includes('time-delete-v1'));assert.equal(relay.status().bridgeBusy,false);
  const reachable=bridgeState;bridgeState=null;
  assert.equal(await relay.ping(),false,'the bridge is off');assert.deepEqual(relaySignal(relay.status(),{},APPROVER).capabilities,[]);
  bridgeState=reachable;assert.equal(await relay.ping(),true);assert.equal(relaySignal(relay.status(),{},APPROVER).capabilities.length,4);
  const before=seen.length;relay.stop();
  assert.equal(relaySignal(relay.status(),{},APPROVER).state,'stopped');assert(seen.length>before);
});
