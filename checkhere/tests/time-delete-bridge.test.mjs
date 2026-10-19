// 연결 프로그램의 시간 삭제 게이트(설계 docs/beta2-instant-edit-plan.md 6장 4·11단계): 능력이 없으면 읽기·승인·잡기 전에 거절하고,
// 능력이 있으면 승인된 삭제 요청이 다시 읽어 확인한 뒤 플랫폼 저장까지 갑니다. 가짜 체크히어·가짜 클라우드만 씁니다(포트 18797~18799, 18965, 18966).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createBridge,CAPABILITIES} from '../server.mjs';
import {APPROVER,prepareApproval} from '../approval-core.mjs';
import {TIME_DELETE_CAPABILITY} from '../rules.mjs';
import {version} from '../identity.mjs';

const OLD=CAPABILITIES.filter(c=>c!==TIME_DELETE_CAPABILITY);
// 체크인한 가상 학생: 1교시는 입실에서 계산된 값(PASS), 퇴실에는 기록 번호가 있습니다.
const base=(patch={})=>{const r={id:'fixture-bridge-del',studentKey:'fixture-bridge-key',classId:'9',date:'2026-11-12',name:'가상삭제',phoneLast4:'0009',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'08:55:00',entry:'08:55:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,collectedAt:'2026-11-12T09:00:00.000Z',entryKind:'PASS',entryEventId:false,exitEventId:true,enterEventId:true,...patch};r.version=version(r);return r;};
const request=(record,status,patch={})=>{const r={classId:'9',date:record.date,name:record.name,phoneLast4:'0009',reason:'[가상] 결석 확인',changes:{exit:''},deleteTimes:['exit'],status,createdBy:APPROVER,...patch};if(status==='approved'){r.approvedBy=APPROVER;r.approval=prepareApproval(r,record,{allowAlreadyApplied:true});}return r;};
// 가짜 체크히어 어댑터: 수정창 '삭제'를 흉내 냅니다(퇴실을 지우면 계산된 1교시도 함께 비움 — Cowork 확인 동작).
function fakeAdapter(record){
  let current=structuredClone(record);const calls={reads:0,logins:0,writes:[]};
  const adapter={loggedIn:async()=>true,requireLogin:async()=>{calls.logins++;},
    read:async()=>{calls.reads++;return structuredClone(current);},
    write:async(r,field,change,options)=>{
      calls.writes.push({field,change,options});
      if(!options?.deleteFields?.includes(field)){current={...current,[field]:change.time,[field+'Memo']:change.memo};current.version=version(current);return {...change};}
      current={...current,[field]:null,[field+'Memo']:'',...(field==='exit'?{exitEventId:false,...(current.entryKind==='PASS'?{entry:null,entryMemo:'',entryKind:null}:{})}:{entryKind:null,entryEventId:false}),collectedAt:new Date().toISOString()};current.version=version(current);
      return {time:null,memo:''};
    }};
  return {adapter,calls,get current(){return current;}};
}
function fakeCloud(docs){
  const calls={get:0,claim:0,approveExisting:0,finish:[]};
  const cloud={verify:async t=>{if(t!=='fixture-admin')throw Error('관리자 권한 없음');},
    get:async id=>{calls.get++;return {id,data:structuredClone(docs.get(id))};},
    approveExisting:async(doc,t,record)=>{calls.approveExisting++;const d=docs.get(doc.id);assert.equal(d.status,'pending');Object.assign(d,{status:'approved',approvedBy:APPROVER,approval:prepareApproval(d,record,{allowAlreadyApplied:true})});return {id:doc.id,data:structuredClone(d)};},
    claim:async(doc,t,attemptId)=>{calls.claim++;const d=docs.get(doc.id);assert.equal(d.status,'approved');Object.assign(d,{status:'applying',attemptId});},
    // 실제 finish(cloud-approval.mjs)처럼 확인 완료면 완료 문구를 새로 쓰고 결과(results)를 남깁니다.
    finish:async(id,t,attemptId,job)=>{const d=docs.get(id);assert.equal(attemptId,d.attemptId);calls.finish.push(structuredClone(job.current));Object.assign(d,{status:job.status,result:{message:job.status==='verified'?'체크히어 반영·원본 확인·플랫폼 DB 저장 완료':job.message,results:job.results||[],platformSaved:job.status==='verified'}});return d.result;}};
  return {cloud,calls};
}
async function bridge(port,record,docs,capabilities){
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const f=fakeAdapter(record),c=fakeCloud(docs);
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/time-delete-')),collector:f.adapter,port,approvalCloud:c.cloud,...(capabilities?{capabilities}:{})});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));app.put(record);
  const headers={'x-hint-key':app.key,'content-type':'application/json',connection:'close'};
  const post=async(path,approvalId)=>{const res=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:'POST',headers,body:JSON.stringify({approvalId,idToken:'fixture-admin'})});return {code:res.status,body:await res.json()};};
  const get=async path=>(await fetch(`http://127.0.0.1:${port}/api/${path}`,{headers})).json();
  const job=async id=>{for(let i=0;i<200;i++){const j=JSON.parse(app.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id)?.payload||'{}');if(j.status&&j.status!=='running'&&Object.hasOwn(j,'cloudSaved'))return j;await new Promise(r=>setTimeout(r,10));}throw Error('작업이 끝나지 않았습니다.');};
  return {app,f,c,post,get,job,close:()=>app.close()};
}

test('a bridge without time-delete-v1 refuses deletion requests before reading, approving or claiming; request states stay',async()=>{
  const record=base(),docs=new Map([['fixture-delete-approved-01',request(record,'approved')],['fixture-delete-pending-001',request(record,'pending')],['fixture-memo-approved-001',request(record,'approved',{changes:{exitMemo:'조퇴_담임:가상담임(17:00)'},deleteTimes:undefined})]]);
  const b=await bridge(18797,record,docs,OLD);
  try{
    const session=await (await fetch('http://127.0.0.1:18797/api/session')).json();
    assert.equal(session.build,'20261016.2');assert.equal(session.capabilities.includes(TIME_DELETE_CAPABILITY),false,'the injected list is what the bridge announces');
    const state=await b.get('state?delta=1');assert.equal(state.build,'20261016.2','/api/state carries the build');assert.equal(state.capabilities.includes(TIME_DELETE_CAPABILITY),false);
    const applied=await b.post('apply','fixture-delete-approved-01');
    assert.equal(applied.code,400);assert.match(applied.body.error,/시간 삭제를 지원하지 않습니다/);
    assert.equal(docs.get('fixture-delete-approved-01').status,'approved','an approved deletion stays approved (not claimed)');
    const confirmed=await b.post('confirm-existing','fixture-delete-pending-001');
    assert.equal(confirmed.code,400);assert.match(confirmed.body.error,/시간 삭제를 지원하지 않습니다/);
    assert.equal(docs.get('fixture-delete-pending-001').status,'pending','a pending deletion stays pending (not approved)');
    assert.deepEqual([b.c.calls.claim,b.c.calls.approveExisting,b.f.calls.reads,b.f.calls.logins,b.f.calls.writes.length],[0,0,0,0,0],'nothing was read, approved, claimed or written');
    assert.equal(b.app.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0,'no job was started');
    assert.equal((await b.get('state?delta=1')).busy,null,'the bridge is free again');
    // 삭제가 아닌 요청은 같은 연결 프로그램에서 지금처럼 진행됩니다(게이트는 삭제에만).
    const memo=await b.post('apply','fixture-memo-approved-001');assert.equal(memo.code,202,JSON.stringify(memo.body));assert.equal(b.c.calls.claim,1);
    const done=await b.job('fixture-memo-approved-001');assert.equal(done.status,'verified',done.message);assert.equal(Object.hasOwn(b.f.calls.writes[0].options,'deleteFields'),false);
  }finally{b.close();}
});

test('a bridge with time-delete-v1 deletes an approved exit, verifies it by re-reading and saves the blank exit to the platform',async()=>{
  const record=base({entryMemo:'지각_담임:가상담임(09:20)'}),docs=new Map([['fixture-delete-approved-02',request(record,'approved')]]);
  const b=await bridge(18798,record,docs);
  try{
    const session=await (await fetch('http://127.0.0.1:18798/api/session')).json();
    assert(session.capabilities.includes(TIME_DELETE_CAPABILITY),'the default bridge announces time deletion');assert.equal(session.build,'20261016.2');
    const started=await b.post('apply','fixture-delete-approved-02');assert.equal(started.code,202,JSON.stringify(started.body));
    const j=await b.job('fixture-delete-approved-02');
    assert.equal(j.status,'verified',j.message);assert.equal(j.results[0].deleted,true);assert.equal(j.results[0].field,'exit');
    assert.equal(j.results[0].rawEntryAfter,'08:55:00','the actual entry stays');
    assert.equal(j.message,'체크히어 반영·원본 확인·플랫폼 DB 저장 완료 · 퇴실 시간 삭제 확인','the platform message gets the deletion note back from the results');
    assert.equal(docs.get('fixture-delete-approved-02').result.results[0].deleted,true);
    assert.deepEqual(b.f.calls.writes.map(w=>[w.field,w.change.time,w.options]),[['exit',null,{requestedFields:['exit'],deleteFields:['exit']}]]);
    assert.equal(b.c.calls.finish.length,1);const saved=b.c.calls.finish[0];
    assert.equal(saved.exit,null,'the platform receives the deleted exit');assert.equal(saved.entry,null,'and the period derived from the entry');assert.equal(saved.rawEntry,'08:55:00');
    assert.equal(j.cloudSaved,true);assert.equal(docs.get('fixture-delete-approved-02').status,'verified');
    const latest=JSON.parse(b.app.db.prepare('SELECT payload FROM snapshots WHERE id=? ORDER BY seq DESC LIMIT 1').get(record.id).payload);assert.equal(latest.exit,null,'the bridge keeps the verified result');
    const journal=b.app.db.prepare('SELECT payload FROM journal WHERE job=?').all('fixture-delete-approved-02').map(x=>JSON.parse(x.payload));
    assert.equal(journal.find(e=>e.phase==='before_write').deleteTime,true);
  }finally{b.close();}
});

test('a bridge with time-delete-v1 confirms a pending deletion that is already blank without writing to CheckHere',async()=>{
  const record=base({exit:null,entry:null,entryKind:null,exitEventId:false}),docs=new Map([['fixture-delete-pending-002',request(base(),'pending')]]);
  const b=await bridge(18799,record,docs);
  try{
    const started=await b.post('confirm-existing','fixture-delete-pending-002');assert.equal(started.code,202,JSON.stringify(started.body));
    const j=await b.job('fixture-delete-pending-002');
    assert.equal(j.status,'verified',j.message);assert.equal(j.alreadyApplied,true);assert.equal(b.c.calls.approveExisting,1);assert.equal(b.f.calls.writes.length,0);
    assert.equal(b.c.calls.finish[0].exit,null);
  }finally{b.close();}
});

// 승인 뒤 반영이 미뤄진 사이(로그인 만료·다른 작업 중) 퇴실이 바뀌면, 다시 시도할 때 확인받지 않은 시간을 지우지 않고 원본 변경으로 끝냅니다.
test('an approved deletion whose time changed after approval ends as conflict without pressing 삭제',async()=>{
  const seen=base({exit:'13:00:00'}),now=base(),docs=new Map([['fixture-delete-stale-0001',request(seen,'approved')]]);
  const b=await bridge(18965,now,docs);
  try{
    const started=await b.post('apply','fixture-delete-stale-0001');assert.equal(started.code,202,JSON.stringify(started.body));
    const j=await b.job('fixture-delete-stale-0001');
    assert.equal(j.status,'conflict',j.message);assert.match(j.message,/승인 뒤 체크히어 시간이 바뀌어 지우지 않았습니다/);
    assert.equal(b.f.calls.writes.length,0);assert.equal(b.f.current.exit,'18:00:00','the unconfirmed 18:00 exit stays');
    assert.equal(docs.get('fixture-delete-stale-0001').status,'conflict','the request ends instead of being retried forever');
    assert.equal(b.c.calls.finish[0].exit,'18:00:00','the platform gets the current read');
  }finally{b.close();}
});

// 관리자가 넣은 1교시(ATTEND) 삭제(2026-10-16 켬): 퇴실이 남은 채 1교시만 지우는 승인은 누르지 않고 원본 변경(conflict)으로 끝내고(체크히어가 퇴실 시간으로 다시 채움),
// 두 칸 삭제는 퇴실 먼저 → 다시 읽기 → 1교시 → 다시 읽어 두 칸 확인 뒤 플랫폼 저장까지 갑니다. 옛 포털이 보낸 1교시만의 삭제도 연결 프로그램이 막습니다.
test('the admin 1st period: alone it is refused while the exit stays; with the exit it is deleted after the exit and both cells are verified empty',async()=>{
  const record=base({rawEntry:'09:00:00',entry:'09:00:00',entryKind:'ATTEND',entryEventId:true,enterEventId:false});
  const docs=new Map([['fixture-delete-attend-001',request(record,'approved',{changes:{entry:''},deleteTimes:['entry']})],['fixture-delete-attend-002',request(record,'approved',{changes:{entry:'',exit:''},deleteTimes:['entry','exit']})]]);
  const b=await bridge(18966,record,docs);
  try{
    let started=await b.post('apply','fixture-delete-attend-001');assert.equal(started.code,202,JSON.stringify(started.body));
    let j=await b.job('fixture-delete-attend-001');
    assert.equal(j.status,'conflict',j.message);assert.match(j.message,/퇴실이 남아 있으면 1교시만 지울 수 없습니다/);
    assert.equal(b.f.calls.writes.length,0);assert.deepEqual([b.f.current.entry,b.f.current.exit],['09:00:00','18:00:00'],'nothing was pressed');
    assert.equal(docs.get('fixture-delete-attend-001').status,'conflict');
    started=await b.post('apply','fixture-delete-attend-002');assert.equal(started.code,202,JSON.stringify(started.body));
    j=await b.job('fixture-delete-attend-002');
    assert.equal(j.status,'verified',j.message);assert.deepEqual(b.f.calls.writes.map(w=>[w.field,w.options.deleteFields]),[['exit',['entry','exit']],['entry',['entry','exit']]],'exit first');
    assert.equal(j.message,'체크히어 반영·원본 확인·플랫폼 DB 저장 완료 · 퇴실·1교시 삭제 확인 · 입실 기록은 남음');
    const saved=b.c.calls.finish.at(-1);assert.deepEqual([saved.entry,saved.exit,saved.rawEntry],[null,null,'09:00:00']);
  }finally{b.close();}
});
