import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {CheckHereCollector} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {studentKey,recordId,version} from '../identity.mjs';
import {APPROVER,prepareApproval,requestMatchesRecord} from '../approval-core.mjs';
import {ATTEND_DELETE} from '../rules.mjs';
import {createCurrentSaver,mergeCurrentRecords} from '../../checkhere-current-core.mjs';
import {LIVE_MARK,baseTag,buildLiveRequest,editorReason,inLiveWindow,isLiveRequest,koreaClock,requestsFor,tagOf} from '../../checkhere-live-core.mjs';
import {createBridgeClient,createLiveRelay,relaySignal} from '../../checkhere-live-relay.mjs';
import {deletionGate} from '../../beta2-checkhere-core.mjs';

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
// 퇴실이 남아 있으면 1교시만은 지우지 않습니다(체크히어가 퇴실 시간으로 1교시를 다시 채움, 2026-10-16 확인, rules.mjs).
const EXIT_FIRST='퇴실이 남아 있으면 1교시만 지울 수 없습니다(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다). 퇴실과 함께 지워 주세요.';
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
  const both=buildLiveRequest({...live,entry:null},{entry:'',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['entry','exit']});
  assert.deepEqual([both.changes,both.deleteTimes],[{exit:''},['exit']],'the already blank entry is skipped');
  // 관리자가 넣은 1교시(ATTEND)는 퇴실과 함께(두 칸) 지웁니다(2026-10-16 확인 뒤 켬). 퇴실이 남은 채 1교시만은 거절(퇴실만 지우는 일부 요청으로도 바꾸지 않음).
  const two=buildLiveRequest(live,{...form,entry:''},'결석 확인',{deleteTimes:['entry','exit']});
  assert.deepEqual([two.changes,two.deleteTimes],[{entry:'',exit:''},['entry','exit']]);assert.equal(tagOf(two.reason),baseTag(live,['entry','exit']));
  assert.throws(()=>buildLiveRequest(live,{...form,entry:'',exit:'18:00'},'결석 확인',{deleteTimes:['entry']}),{message:EXIT_FIRST});
  assert.throws(()=>buildLiveRequest({...live,exit:null},{entry:'',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['entry','exit']}),{message:EXIT_FIRST},'퇴실 번호가 남아 있으면 퇴실이 빈 것으로 보지 않음');
  assert.throws(()=>buildLiveRequest({...live,exit:null},form,'결석 확인',{deleteTimes:['exit']}),/바뀐 값이 없습니다/);
  assert.throws(()=>buildLiveRequest(live,{...form,exit:'18:00'},'결석 확인',{deleteTimes:['exit']}),/삭제할 시간 칸은 비워/);
  assert.throws(()=>buildLiveRequest(live,{...form,exitMemo:'남길 사유'},'결석 확인',{deleteTimes:['exit']}),/사유는 비워/);
  assert.throws(()=>buildLiveRequest(live,form,'결석 확인',{deleteTimes:['exitMemo']}),/삭제할 시간 항목/);
  assert.throws(()=>buildLiveRequest({...live,entryKind:'PASS'},{...form,entry:'',exit:'18:00'},'결석 확인',{deleteTimes:['entry']}),/계산된 1교시/);
  assert.throws(()=>buildLiveRequest({...live,enterEventId:true},{...form,entry:'',exit:'18:00'},'결석 확인',{deleteTimes:['entry']}),{message:EXIT_FIRST});
  assert.deepEqual(buildLiveRequest({...live,enterEventId:true},{...form,entry:''},'결석 확인',{deleteTimes:['entry','exit']}).deleteTimes,['entry','exit'],'체크인한 학생이 사유를 저장한 1교시도 퇴실과 함께(두 칸만 깨끗이, 2026-10-16)');
});
// 관리자 1교시(ATTEND) 삭제(2026-10-16 켬): 퇴실이 이미 비었으면(번호도 없음) 1교시만 지웁니다.
test('with ATTEND_DELETE on, the admin 1st period is deleted and an already blank exit is skipped',()=>{
  assert.equal(ATTEND_DELETE,true);
  const both=buildLiveRequest({...LIVE,...MARKS,exit:null,exitEventId:false},{entry:'',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['entry','exit']});
  assert.deepEqual([both.changes,both.deleteTimes],[{entry:''},['entry']],'the already blank exit is skipped');
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
  // 그날 화면 데이터(가상): 빠른 수집은 이것만 읽고 수정창(reads)을 열지 않습니다(2026-10-16).
  const at=(t,v)=>`${t.date}T${v}`,entryFrom=row=>{const t=truth.get(row.id);return {sequence:row.rowIndex-1,attendeeId:'att-'+t.studentKey.slice(0,8),name:t.name,phone:'',leaveEvents:{pairs:[]},eventList:[
    ...(t.rawEntry?[{type:'ENTER',time:at(t,t.rawEntry),eventId:t.enterEventId?'e':null,timeIndex:0}]:[]),
    ...(t.entry?[{type:t.entryKind||'ATTEND',time:at(t,t.entry),eventId:t.entryEventId?'a':null,timeIndex:0,memoByAdmin:t.entryMemo||null}]:[]),
    ...(t.exit?[{type:'COMPLETE',time:at(t,t.exit),eventId:t.exitEventId?'c':null,timeIndex:0,memoByAdmin:t.exitMemo||null}]:[])]};};
  const adapter=Object.assign(Object.create(CheckHereCollector.prototype),{
    cancelled:false,loggedIn:async()=>true,requireLogin:async()=>{},dayGapMs:[0,0],lastDayAt:0,
    openDay:async(classId,date)=>{const rows=rowsFor(classId,date);adapter.dayData={data:{eventResultList:rows.map(entryFrom)}};return rows;},planOptions:()=>({entryFor:entryFrom}),readDetails:async row=>details(row),
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
  let commits=0,watches=0;
  const store={
    // 읽기 전용 중계는 요청 목록을 구독하지 않습니다(watches 0이어야 함). 승인은 시험이 사람 대신 부릅니다(approveByPerson).
    watchQueue(cb){watches++;listeners.add(cb);notify();return()=>listeners.delete(cb);},
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
  return {truth,reads,requests,current,store,cloud,adapter,admins,notify,get commits(){return commits;},get watches(){return watches;},
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
  // calls: 중계가 부른 연결 프로그램 작업 이름(읽기 전용이면 'sync'뿐). 시험의 사람 승인(approveByPerson)은 client를 바로 써서 세지 않습니다.
  const calls=[],bridge={state:async c=>{const s=await client.state(c);return addCapabilities.length?{...s,capabilities:[...new Set([...(s.capabilities||[]),...addCapabilities])]}:s;},api:(name,body)=>{calls.push(name);return client.api(name,body);}};
  const relay=createLiveRelay({bridge,store:w.store,log:e=>logs.push(e.text),now:()=>clock,sleep:()=>new Promise(r=>setTimeout(r,2)),pollMs:2,inWindow:()=>true,...opts});
  await relay.start({loop:false});
  return {app,relay,logs,calls,client,advance(ms){clock=new Date(clock.getTime()+ms);},close:()=>{relay.stop();app.close();}};
}
// 운영 포털 「반영 요청·승인」에서 사람이 하는 일(승인 저장 → 연결 프로그램 /api/apply → 결과·DB 저장 확인)을 시험에서 대신합니다.
async function approveByPerson(w,h,id,record){
  await w.store.approve(id,prepareApproval({id,...w.requests.get(id)},record));
  await h.client.api('apply',{approvalId:id,idToken:'approver-token'});
  for(let i=0;i<1000;i++){const job=((await h.client.state()).jobs||[]).find(j=>j.id===id);if(job&&job.status!=='running'&&job.cloudSaved!==undefined)return job;await new Promise(r=>setTimeout(r,10));}
  throw Error('반영 결과 대기 시간 초과');
}
test('10-minute cycle saves a class once, skips unchanged students, re-reads only changed ones and drops classes without a lecture',async()=>{
  const w=world(),h=await harness(w,18791,{classIds:['2','3']});
  try{
    assert(h.relay.status().capabilities.includes('incremental-sync-v1'),'the real bridge capabilities show in the status');
    // 5b: /api/state가 build를 알립니다(옛 연결 프로그램이면 없음).
    const build=h.relay.status().build;assert.ok(build===null||/^\d{8}\.\d+$/.test(build),`build ${build}`);
    assert.equal(await h.relay.step(),'sync');assert.equal(w.day('2').length,2);assert.deepEqual(w.reads,[],'read from page data, no editor');
    assert.equal(await h.relay.step(),'sync');assert.match(h.logs.join('\n'),/3반: 오늘 강의가 없어/);
    assert.equal(await h.relay.step(),'idle','waits for the next 10-minute round');
    h.advance(10*60*1000);w.reads.length=0;const commits=w.commits;
    await h.relay.step();await h.relay.step();
    assert.deepEqual(w.reads,[],'nothing changed: no editor opened');assert.equal(w.commits,commits,'and no DB write');
    [...w.truth.values()].find(t=>t.name==='가상둘').exit='17:30:00';
    h.advance(10*60*1000);await h.relay.step();
    assert.deepEqual(w.reads,[],'the changed student is read from page data too');assert.equal(w.day('2').find(r=>r.name==='가상둘').exit,'17:30:00');assert.equal(w.commits,commits+1);
  }finally{h.close();}
});
// 읽기 전용 중계(사용자 결정 2026-10-16): 어떤 요청도 승인·반영·반려하지 않고, 수집(sync) 말고는 연결 프로그램 작업을 부르지 않습니다.
test('the relay never approves, applies or rejects: every request stays as it was and CheckHere is only read',async()=>{
  const w=world(),h=await harness(w,18792,{classIds:['2']});
  try{
    await h.relay.step();const one=w.day('2').find(r=>r.name==='가상하나'),two=w.day('2').find(r=>r.name==='가상둘');
    const edit=buildLiveRequest(two,{entry:'09:20',exit:'18:00',entryMemo:'(인정지각)병원_담임:가상',exitMemo:''},'진료확인서 제출');
    w.add('live-req-000000000001',edit);
    // 예전에 승인만 되고 반영되지 않은 요청도 중계가 이어서 쓰지 않습니다.
    const early=buildLiveRequest(one,{entry:'09:00',exit:'18:00',entryMemo:'',exitMemo:'조퇴_병원'},'조퇴 확인');
    w.add('live-approved-0000001',{...early,status:'approved',approvedBy:APPROVER,approval:prepareApproval(early,one)});
    w.add('live-delete-000000001',buildLiveRequest(one,{entry:'09:00',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['exit']}));
    w.add('live-teacher-00000001',{...buildLiveRequest(two,{entry:'09:20',exit:'18:00',entryMemo:'x',exitMemo:''},'y'),createdBy:'teacher@example.com'});
    w.add('plain-request-0000001',{classId:'2',date:DATE,name:'가상둘',phoneLast4:'',reason:'일반 요청',changes:{entry:'09:05:00'}});
    w.add('retry_'+'a'.repeat(64),{...buildLiveRequest(two,{entry:'09:20',exit:'18:00',entryMemo:'재처리',exitMemo:''},'재처리'),createdBy:APPROVER});
    // 화면 표가 바뀐 학생(퇴실 17:30)은 다시 읽어 저장하지만, 그 학생 요청도 그대로 둡니다.
    [...w.truth.values()].find(t=>t.name==='가상둘').exit='17:30:00';
    const requests=structuredClone([...w.requests]),truth=structuredClone([...w.truth]);
    h.relay.syncNow('2',DATE);
    for(let i=0;i<6;i++){assert.notEqual(await h.relay.step(),'request');h.advance(5*60000);}
    assert.deepEqual([...w.requests],requests,'no request was approved, claimed, rejected or withdrawn');
    assert.deepEqual([...w.truth],truth,'fake CheckHere only read');
    assert.deepEqual([...new Set(h.calls)],['sync'],'only collection jobs: no preview-request, confirm-existing, apply or reconcile');
    assert.equal(w.watches,0,'the request queue is not even watched');
    assert.equal(w.day('2').find(r=>r.name==='가상둘').exit,'17:30:00','viewers see the newer CheckHere value');
    assert.equal(h.relay.status().needsUnmask,0);assert.equal(Object.hasOwn(h.relay.status(),'processed'),false);
    assert.doesNotMatch(h.logs.join('\n'),/자동 반영|승인|반려/);
    // 실시간 화면은 전화 끝 4자리가 없는 운영포털 요청도 그 학생 것으로 봅니다(수정 버튼 잠금).
    assert.deepEqual(requestsFor(two,[...w.requests].map(([id,d])=>({id,...d}))).map(r=>r.id).sort(),['live-req-000000000001','live-teacher-00000001','plain-request-0000001','retry_'+'a'.repeat(64)]);
  }finally{h.close();}
});
// 쓰기는 사람이 운영 포털에서 승인할 때만: 연결 프로그램이 입력·재확인·DB 저장을 하고, 중계는 그 뒤에도 읽기만 합니다.
test('only a person approving in the portal writes: the bridge enters, verifies and saves; the relay keeps reading',async()=>{
  const w=world({classes:{'2':[['가상하나','01000000001','08:55:00','09:00:00','18:00:00'],['가상둘','01000000002','09:20:00','09:20:00','18:00:00'],['가상셋','01000000003','09:01:00','09:01:00',null]]}}),h=await harness(w,18793,{classIds:['2']});
  try{
    await h.relay.step();const two=w.day('2').find(r=>r.name==='가상둘');
    w.add('live-req-000000000001',buildLiveRequest(two,{entry:'09:20',exit:'18:00',entryMemo:'(인정지각)병원_담임:가상',exitMemo:''},'진료확인서 제출'));
    h.advance(10*60*1000);await h.relay.step();
    assert.equal(w.requests.get('live-req-000000000001').status,'pending','the relay leaves it for a person');
    const job=await approveByPerson(w,h,'live-req-000000000001',two);
    const req=w.requests.get('live-req-000000000001');assert.equal(req.status,'verified',JSON.stringify(job));
    assert.equal([...w.truth.values()].find(t=>t.name==='가상둘').entryMemo,'(인정지각)병원_담임:가상','CheckHere changed');
    assert.equal(w.day('2').find(r=>r.name==='가상둘').entryMemo,'(인정지각)병원_담임:가상','live document updated by the approval');
    assert.equal(req.approvedBy,APPROVER);assert.equal(req.createdBy,'admin@example.com','the editor stays on record');
    // 사유만 넣은 학생(퇴실 없음)은 승인할 때 기본 시간이 함께 들어갑니다(요청 흐름과 같음).
    const three=w.day('2').find(r=>r.name==='가상셋');
    w.add('live-default-00000001',buildLiveRequest(three,{entry:'09:01',exit:'',entryMemo:'',exitMemo:'조퇴_병원'},'조퇴'));
    await approveByPerson(w,h,'live-default-00000001',three);
    const t=[...w.truth.values()].find(x=>x.name==='가상셋');assert.equal(w.requests.get('live-default-00000001').status,'verified');assert.deepEqual([t.exit,t.exitMemo],['18:00:00','조퇴_병원']);
    h.advance(10*60*1000);await h.relay.step();
    assert.deepEqual([...new Set(h.calls)],['sync'],'the relay itself only ran collection jobs');
  }finally{h.close();}
});
// ---- 시간 삭제(설계 6장 5b): 중계는 지우지 않고, 사람이 승인해도 연결 프로그램에 time-delete-v1 능력이 있을 때만 지웁니다 ----
const BASE_CAPS=['memo-default-time-v1','approved-requests-v1','memo-only-requests-v1','approval-current-sync-v1','live-approval-preview-v1','automatic-request-collection-v1','phone-identity-v1','state-delta-v1','incremental-sync-v1','batch-sync-v1','probe-v1','page-data-v1'];
const exitOf=(w,name)=>[...w.truth.values()].find(t=>t.name===name).exit;
test('without time-delete-v1 the relay leaves a deletion alone and the bridge refuses a person\'s approval without reading CheckHere',async()=>{
  const w=world(),h=await harness(w,18961,{classIds:['2'],intervalMs:3600000},{capabilities:BASE_CAPS});
  try{
    await h.relay.step();assert.equal(h.relay.status().capabilities.includes('time-delete-v1'),false);
    const shown=w.day('2').find(r=>r.name==='가상하나');
    w.reads.length=0;w.add('live-delete-000000001',buildLiveRequest(shown,{entry:'09:00',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['exit']}));
    for(let i=0;i<3;i++){assert.equal(await h.relay.step(),'idle');h.advance(61000);}
    assert.equal(w.requests.get('live-delete-000000001').status,'pending','not rejected by the relay');assert.deepEqual(w.reads,[]);
    await assert.rejects(approveByPerson(w,h,'live-delete-000000001',shown),/시간 삭제를 지원하지 않습니다/);
    assert.equal(w.requests.get('live-delete-000000001').status,'approved','kept for the updated collector');
    assert.deepEqual(w.reads,[],'CheckHere is not opened');assert.equal(exitOf(w,'가상하나'),'18:00:00','fake CheckHere untouched');
    assert.deepEqual(h.calls,['sync'],'the relay never tried the deletion');
  }finally{h.close();}
});
test('with time-delete-v1 a deletion waits for a person; once approved the bridge deletes, verifies and saves it',async()=>{
  const w=world(),h=await harness(w,18962,{classIds:['2']},{capabilities:[...BASE_CAPS,'time-delete-v1'],addCapabilities:['time-delete-v1']});
  try{
    await h.relay.step();assert.ok(h.relay.status().capabilities.includes('time-delete-v1'));
    const shown=w.day('2').find(r=>r.name==='가상하나');
    w.add('live-delete-000000004',buildLiveRequest(shown,{entry:'09:00',exit:'',entryMemo:'',exitMemo:''},'결석 확인',{deleteTimes:['exit']}));
    h.advance(10*60*1000);await h.relay.step();
    assert.equal(w.requests.get('live-delete-000000004').status,'pending');assert.equal(exitOf(w,'가상하나'),'18:00:00','nothing deleted before a person approves');
    // 사람 승인 → 수정창 '삭제'(가짜) → 다시 읽어 확인 → 실시간 문서에 반영
    await approveByPerson(w,h,'live-delete-000000004',shown);
    const req=w.requests.get('live-delete-000000004');assert.equal(req.status,'verified',JSON.stringify(req.result));
    assert.equal(req.result.results[0].deleted,true);assert.equal(req.approval.after.exit,'');assert.deepEqual(req.deleteTimes,['exit']);
    assert.equal(exitOf(w,'가상하나'),null,'CheckHere exit deleted');assert.equal([...w.truth.values()].find(t=>t.name==='가상하나').entry,'09:00:00','the other side stays');
    assert.equal(w.day('2').find(r=>r.name==='가상하나').exit,null,'live document shows the deletion');
    assert.deepEqual([...new Set(h.calls)],['sync']);
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
  // 체크히어 해제 상태는 상태·남은 초·쓸 수 있는지만 옮깁니다(글·이름 없음). 연결 프로그램에 닿지 않으면 넣지 않습니다.
  const open={state:'unmasked',leftSec:412.8,writable:true,text:'가상둘 원문'};
  assert.deepEqual(relaySignal({...status,privacy:open},{},APPROVER),{...signal,privacy:{state:'unmasked',leftSec:412,writable:true}});
  assert.deepEqual(relaySignal({...status,privacy:{state:'masked',leftSec:null,writable:true}},{},APPROVER).privacy,{state:'masked',leftSec:null,writable:false},'a masked tab is never writable');
  assert.equal(Object.hasOwn(relaySignal({...status,privacy:open,bridgeOk:false},{},APPROVER),'privacy'),false,'bridge unreachable');
  assert.deepEqual(relaySignal({...status,bridgeOk:false},{},APPROVER).capabilities,caps,'bridge unreachable: the last known capabilities stay');
  assert.equal(Object.hasOwn(relaySignal({...status,privacy:{state:'가상둘'}},{},APPROVER),'privacy'),false,'odd state text is dropped');
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
  // 일이 없을 때도 신호 전에 ping으로 연결 프로그램을 다시 봅니다. 닿지 않으면 해제 상태는 빼고 능력은 마지막으로 본 목록 그대로 알립니다.
  bridgeState={...bridgeState,busy:null,capabilities:[...bridgeState.capabilities,'time-delete-v1']};
  assert.equal(await relay.ping(),true);assert.ok(relaySignal(relay.status(),{},APPROVER).capabilities.includes('time-delete-v1'));assert.equal(relay.status().bridgeBusy,false);
  // 연결 프로그램의 해제 상태(privacy, 옛 build는 masking 머리말·남은 시간)를 신호에 옮김. 남은 초만 바뀌면 알리지 않고 조용히 고침
  bridgeState={...bridgeState,masking:{header:'masked',view:'masked',remaining:null,waitingWrites:0}};const heard=seen.length;
  assert.equal(await relay.ping(),true);assert.deepEqual(relaySignal(relay.status(),{},APPROVER).privacy,{state:'masked',leftSec:null,writable:false});assert(seen.length>heard,'masked → heard');
  bridgeState={...bridgeState,privacy:{state:'unmasked',leftSec:600,writable:true,text:'체크히어 해제됨 · 10분 남음 — 수정·삭제 가능'}};
  await relay.ping();assert.deepEqual(relay.status().privacy,{state:'unmasked',leftSec:600,writable:true});const after=seen.length;
  bridgeState={...bridgeState,privacy:{...bridgeState.privacy,leftSec:540}};await relay.ping();
  assert.equal(relay.status().privacy.leftSec,540);assert.equal(seen.length,after,'only the seconds changed');
  bridgeState={...bridgeState,privacy:undefined,masking:undefined};await relay.ping();assert.equal(Object.hasOwn(relaySignal(relay.status(),{},APPROVER),'privacy'),false,'an old bridge without masking info');
  const reachable=bridgeState;bridgeState=null;
  assert.equal(await relay.ping(),false,'the bridge is off');const off=relaySignal(relay.status(),{},APPROVER);
  // /beta2는 마지막 신호의 능력으로 v1·v2를 정합니다(2026-10-16): 옛(v1) 연결 프로그램이 꺼져도 v2(두 칸 삭제)로 바뀌지 않음
  assert.deepEqual(off.capabilities,reachable.capabilities,'last known capabilities');assert.deepEqual(deletionGate({features:{timeDeleteRules:true},relay:off}),{enabled:true,reasons:[],v2:false},'a v1 bridge stays v1 while unreachable');
  bridgeState=reachable;assert.equal(await relay.ping(),true);assert.equal(relaySignal(relay.status(),{},APPROVER).capabilities.length,4);
  const before=seen.length;relay.stop();
  assert.equal(relaySignal(relay.status(),{},APPROVER).state,'stopped');assert(seen.length>before);
});
