// 체크히어 가림(MASKED_*) 때 중계(읽기 전용, 사용자 결정 2026-10-16): 요청을 보지도 쓰지도 않고, 해제를 알아채도 깨어나 쓰지 않습니다.
// 중계 신호에는 연결 프로그램이 센 '가림에 막힌 쓰기 수'(needsUnmask)만 넣고(이름 없음), /beta2는 '체크히어 해제 필요'를 보입니다. 가상 학생·가짜 연결 프로그램만 씁니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {version} from '../identity.mjs';
import {APPROVER,prepareApproval} from '../approval-core.mjs';
import {buildLiveRequest} from '../../checkhere-live-core.mjs';
import {createLiveRelay,relaySignal,maskedFailure,stuckFailure} from '../../checkhere-live-relay.mjs';
import {deletionGate,unmaskNote} from '../../beta2-checkhere-core.mjs';
import {createCheckHereSync} from '../../beta2-checkhere-sync.mjs';

const DATE='2026-12-16',CAPS=['approval-current-sync-v1','live-approval-preview-v1','incremental-sync-v1','memo-default-time-v1','time-delete-v1','masked-identity-v1'];
const rec=(()=>{const r={id:'2_x_k',classId:'2',date:DATE,name:'가상하나',phoneLast4:'0001',studentKey:'k',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'09:20:00',entry:'09:20:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,teacher:'가상담임',collectedAt:'2026-12-16T01:00:00.000Z'};r.version=version(r);return r;})();
// 가짜 연결 프로그램: masking.header로 탭 상태를, waiting으로 가림에 막힌 쓰기 수(masking.waitingWrites)를 정합니다. 수집(sync) 말고는 부르면 안 됩니다.
function fakeBridge({header='masked'}={}){
  const b={header,waiting:0,remaining:null,calls:[],jobs:[],syncJob:null};
  b.client={
    state:async()=>({capabilities:CAPS,build:'20261015.3',busy:null,records:[],cursor:'c'+b.calls.length,jobs:b.jobs,masking:{header:b.header,view:b.header==='unmasked'?'plain':'masked',remaining:b.remaining,waitingWrites:b.waiting}}),
    api:async(name)=>{
      b.calls.push(name);
      if(name==='sync'){const id='sync-'+b.calls.length;b.jobs=[{id,...b.syncJob}];return {id};}
      throw Error('read-only relay called '+name);
    }};
  return b;
}
function fakeStore(list){
  const docs=new Map(list.map(r=>[r.id,r])),rejected=[];let watched=0;
  const fail=what=>async()=>{throw Error('read-only relay called store.'+what);};
  return {docs,rejected,get watched(){return watched;},store:{watchQueue(){watched++;return()=>{};},saveRecords:async()=>{},approve:fail('approve'),reject:fail('reject')}};
}
function relayFor(bridge,store,clock,{inWindow=()=>false,log}={}){
  return createLiveRelay({bridge:bridge.client,store,now:()=>clock.now,sleep:()=>Promise.resolve(),pollMs:1,inWindow,classIds:['2','3'],random:()=>0,...(log?{log}:{})});
}
const edit=()=>({id:'live-masked-000000001',...buildLiveRequest(rec,{entry:'09:20',exit:'18:00',entryMemo:'지각_담임:가상담임(09:20)',exitMemo:''},'버스 지연'),status:'pending',createdBy:'admin@example.com',createdAt:{seconds:1}});
const approvedEdit=()=>{const r={...edit(),id:'live-approved-0000001',status:'approved',approvedBy:APPROVER};r.approval=prepareApproval(r,rec);return r;};

test('while masked the relay touches no request; needsUnmask is the bridge count of blocked writes; an unmask wakes nothing',async()=>{
  const clock={now:new Date('2026-12-16T01:00:00Z')},b=fakeBridge(),s=fakeStore([edit(),approvedEdit()]),relay=relayFor(b,s.store,clock);
  const before=structuredClone([...s.docs]);
  b.waiting=2;await relay.start({loop:false});
  for(let i=0;i<8;i++){assert.equal(await relay.step(),'idle');clock.now=new Date(clock.now.getTime()+61000);}
  assert.deepEqual([...s.docs],before,'never approved, applied or rejected while masked');assert.deepEqual(s.rejected,[]);assert.equal(s.watched,0,'the queue is not watched');
  assert.deepEqual(b.calls,[],'no preview-request, confirm-existing or apply');
  assert.equal(relay.status().needsUnmask,2,'the bridge counts writes a person approved that masking blocked');
  const signal=relaySignal(relay.status(),{},APPROVER);assert.equal(signal.needsUnmask,2);assert.ok(!JSON.stringify(signal).includes('가상하나'),'the signal carries no names');
  // 해제 상태(privacy)는 연결 프로그램 머리말로 계산한 상태·남은 초·쓸 수 있는지만(이름·글 없음). 가려져도 중계는 읽기만 계속합니다.
  assert.deepEqual(signal.privacy,{state:'masked',leftSec:null,writable:false});
  // 해제되어도 중계는 깨어나 쓰지 않습니다. 다시 반영은 사람이 운영 포털에서 누릅니다(needsUnmask 0: 해제가 아니라 승인 화면 일).
  b.header='unmasked';b.remaining=600;assert.equal(await relay.ping(),true);
  assert.deepEqual(relaySignal(relay.status(),{},APPROVER).privacy,{state:'unmasked',leftSec:600,writable:true},'unmasked by a person, enough time left');
  for(let i=0;i<4;i++){assert.equal(await relay.step(),'idle');clock.now=new Date(clock.now.getTime()+16000);}
  assert.deepEqual(b.calls,[]);assert.deepEqual([...s.docs],before);
  assert.equal(relay.status().needsUnmask,0);assert.equal(Object.hasOwn(relaySignal(relay.status(),{},APPROVER),'needsUnmask'),false,'no field when nothing waits (same signal shape as before)');
  // 다시 가려지고 막힌 쓰기가 없으면 0, 한 건이면 1(ping이 신호 전에 새로 봄)
  b.remaining=100;await relay.ping();assert.deepEqual(relay.status().privacy,{state:'unmasked',leftSec:100,writable:false},'too little time left to start a write');
  b.header='masked';b.remaining=null;b.waiting=0;await relay.ping();assert.equal(relay.status().needsUnmask,0);assert.equal(relay.status().privacy.state,'masked');
  b.waiting=1;await relay.ping();assert.equal(relay.status().needsUnmask,1);
  relay.stop();
});
test('masked errors are only classified (no attempts, no rejection): unmask-related, needs a person at the PC, or neither',()=>{
  assert.equal(maskedFailure(Error('MASKED_UNLINKED: …')),true);assert.equal(maskedFailure(Error('학생 식별을 위해 전화번호 표시가 필요합니다.')),true,'the old build phone message');
  assert.equal(maskedFailure(Error('해당 반·날짜를 먼저 수집하고 학생 이름을 확인해 주세요.')),false);
  assert.deepEqual(['MASKED_CONFLICT: x','MASKED_GUARD: x','MASKED_AMBIGUOUS: x'].map(m=>[maskedFailure(Error(m)),stuckFailure(Error(m))]),[[false,true],[false,true],[false,false]]);
});
// 시간 계획은 고정 무작위(0): 반마다 지금부터 1분 간격. 모든 반에 걸리는 가림(섞인 화면·해제 창 사용 중)은 그 반을 남겨 두고 1분 쉽니다.
test('a mixed view pauses the hourly round at the first class; a one-class masked failure does not',async()=>{
  const clock={now:new Date('2026-12-16T01:00:00Z')},b=fakeBridge(),s=fakeStore([]);
  const relay=createLiveRelay({bridge:b.client,store:s.store,user:{email:APPROVER,getIdToken:async()=>'t'},now:()=>clock.now,sleep:()=>Promise.resolve(),pollMs:1,inWindow:()=>true,classIds:['2','3','4'],random:()=>0});
  await relay.start({loop:false});
  b.syncJob={status:'failed',message:'MASKED_MIXED: 체크히어 화면의 가림 상태가 섞여 있어 이 날 수집을 멈췄습니다.'};
  assert.equal(await relay.step(),'idle','the round stops');assert.equal(b.calls.filter(c=>c==='sync').length,1);
  clock.now=new Date(clock.now.getTime()+61000);
  b.syncJob={status:'failed',message:'MASKED_ALIGN: 가린 화면의 표와 화면 데이터 순번이 맞지 않아 이 날 수집을 멈췄습니다.'};
  assert.equal(await relay.step(),'sync');clock.now=new Date(clock.now.getTime()+60000);assert.equal(await relay.step(),'sync','one class failing does not stop the others');
  assert.equal(b.calls.filter(c=>c==='sync').length,3);
  // 사람이 연결 프로그램 탭에서 해제 창을 쓰는 중이면 모든 반이 같으므로 한 바퀴를 멈춥니다(화면을 옮기지 않음)
  clock.now=new Date(clock.now.getTime()+3600000);
  b.syncJob={status:'failed',message:'MASKED_UNMASKING: 체크히어 창에서 사람이 마스킹 해제를 진행 중이라 화면을 옮기지 않았습니다.'};
  assert.equal(await relay.step(),'idle');assert.equal(b.calls.filter(c=>c==='sync').length,4);
  relay.stop();
});
test('a link conflict in one class is a warning and the round goes on; an ambiguous pair is an error; nothing is rejected',async()=>{
  const clock={now:new Date('2026-12-16T01:00:00Z')},b=fakeBridge({header:'unmasked'}),s=fakeStore([edit()]),logs=[];
  const relay=relayFor(b,s.store,clock,{inWindow:()=>true,log:e=>logs.push(e)});
  await relay.start({loop:false});
  b.syncJob={status:'failed',message:'MASKED_CONFLICT: 체크히어 학생 번호 연결이 예전과 달라 멈췄습니다. 수집 PC 연결 프로그램 화면에서 「연결 충돌 정리」를 누른 뒤 다시 수집해 주세요'};
  assert.equal(await relay.step(),'sync','the other classes still refresh');
  b.syncJob={status:'failed',message:'MASKED_AMBIGUOUS: 같은 반에 첫 글자·끝 4자리가 같은 학생이 있어 반영하지 않습니다. 체크히어에서 직접 고쳐 주세요'};
  clock.now=new Date(clock.now.getTime()+60000);assert.equal(await relay.step(),'sync');
  assert.deepEqual(logs.filter(l=>/MASKED_/.test(l.text)).map(l=>[l.text.match(/MASKED_[A-Z]+/)[0],l.level]),[['MASKED_CONFLICT','warn'],['MASKED_AMBIGUOUS','error']]);
  assert.match(relay.status().lastError,/MASKED_AMBIGUOUS/);assert.equal(relay.status().needsUnmask,0,'a conflict is not fixed by an unmask');
  assert.deepEqual(s.rejected,[]);assert.equal(s.docs.get('live-masked-000000001').status,'pending');assert.deepEqual([...new Set(b.calls)],['sync']);
  relay.stop();
});
test('/beta2: the relay pill shows 체크히어 해제 필요 while approved writes wait for an unmask; deletion requests can still be made',()=>{
  const now=Date.parse('2026-12-16T03:00:00Z'),relay={state:'running',at:now-60000,capabilities:['time-delete-v1'],needsUnmask:2};
  assert.equal(unmaskNote(relay),'체크히어 해제 필요');assert.equal(unmaskNote({...relay,needsUnmask:0}),'');
  // 요청은 가린 동안에도 만들고 승인 대기로 둡니다(반영할 때만 사람이 해제, 2026-10-16).
  assert.deepEqual(deletionGate({features:{timeDeleteRules:true},relay,now}),{enabled:true,reasons:[],v2:false});
  assert.equal(deletionGate({features:{timeDeleteRules:true},relay:{...relay,needsUnmask:0},now}).enabled,true);
  // 출결대조의 중계 표시(sync.relay().text)
  const subs=[];
  const fs={doc:(db,...p)=>({path:p.join('/')}),collection:(db,...p)=>({path:p.join('/')}),where:(f,o,v)=>({f,o,v}),query:(c,...w)=>({path:c.path,w}),serverTimestamp:()=>'T',setDoc:async()=>{},
    onSnapshot:(ref,next)=>{subs.push({ref,next});return()=>{};}};
  const sync=createCheckHereSync({db:{},user:{email:'admin@example.com'},client:{},fs,withdraw:async()=>{},getRecord:()=>null,getSig:()=>'',getRow:()=>null,hasDraft:()=>false,teacherOf:()=>'',
    now:()=>now,today:()=>'2026-12-16',setTimer:()=>0,clearTimer:()=>{},confirm:()=>true,uuid:()=>'00000000-0000-4000-8000-000000000001'});
  return sync.setDay('2','2026-12-16').then(()=>{
    for(const s of subs.filter(s=>s.ref.path==='settings/checkhereRelay'))s.next({exists:()=>true,data:()=>({...relay,at:{seconds:(now-60000)/1000,nanoseconds:0}})});
    const r=sync.relay();assert.equal(r.needsUnmask,2);assert.match(r.text,/수집 PC 중계 작동 중 · 신호 1분 전 · 체크히어 해제 필요 2건/);
    // 중계 신호의 해제 상태: 가림이면 도구줄에 '체크히어 가림 · 읽기만', 전체 글은 privacy.text(title). 가림은 삭제 요청을 막지 않음
    for(const s of subs.filter(s=>s.ref.path==='settings/checkhereRelay'))s.next({exists:()=>true,data:()=>({...relay,needsUnmask:0,privacy:{state:'masked',leftSec:null,writable:false},at:{seconds:(now-60000)/1000,nanoseconds:0}})});
    const m=sync.relay();assert.equal(m.text,'수집 PC 중계 작동 중 · 신호 1분 전 · 체크히어 가림 · 읽기만');assert.equal(m.privacy.text,'체크히어 가림 — 읽기만 가능 · 수정·삭제하려면 마스킹 해제 필요');
    sync.dispose();
  });
});
