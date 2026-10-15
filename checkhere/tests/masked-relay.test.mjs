// 체크히어 가림(MASKED_*) 때 중계: 요청을 반려하지 않고(시도 횟수에 넣지 않음) 길게 쉬었다 보며, 해제되면 바로 다시 봅니다.
// 중계 신호에는 기다리는 수(needsUnmask)만 넣고(이름 없음), /beta2는 '체크히어 해제 필요'를 보입니다. 가상 학생·가짜 연결 프로그램만 씁니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {version} from '../identity.mjs';
import {APPROVER,prepareApproval} from '../approval-core.mjs';
import {buildLiveRequest} from '../../checkhere-live-core.mjs';
import {createLiveRelay,relaySignal,maskedFailure} from '../../checkhere-live-relay.mjs';
import {deletionGate,unmaskNote} from '../../beta2-checkhere-core.mjs';
import {createCheckHereSync} from '../../beta2-checkhere-sync.mjs';

const DATE='2026-10-14',CAPS=['approval-current-sync-v1','live-approval-preview-v1','incremental-sync-v1','memo-default-time-v1','time-delete-v1','masked-identity-v1'];
const rec=(()=>{const r={id:'2_x_k',classId:'2',date:DATE,name:'가상하나',phoneLast4:'0001',studentKey:'k',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'09:20:00',entry:'09:20:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,teacher:'가상담임',collectedAt:'2026-10-14T01:00:00.000Z'};r.version=version(r);return r;})();
const BLOCK={code:'MASKED_WRITE',message:'MASKED_WRITE: 체크히어 마스킹 해제 후 반영합니다'};
// 가짜 연결 프로그램: masking.header로 탭 상태를, preview·apply가 막히는지를 정합니다.
function fakeBridge({header='masked'}={}){
  const b={header,calls:[],jobs:[],syncJob:null,applyError:null,previewError:null,previewCode:'BRIDGE_ERROR',busyOnce:false};
  b.client={
    state:async()=>({capabilities:CAPS,build:'20261015.3',busy:null,records:[],cursor:'c'+b.calls.length,jobs:b.jobs,masking:{header:b.header,view:b.header==='unmasked'?'plain':'masked'}}),
    api:async(name,body)=>{
      b.calls.push(name);
      if(name==='preview-request'){
        if(b.busyOnce){b.busyOnce=false;throw Object.assign(Error('진행 중인 작업이 있습니다.'),{code:'BRIDGE_BUSY'});}
        if(b.previewError)throw Object.assign(Error(b.previewError),{code:b.previewCode});return {record:structuredClone(rec),...(b.header==='unmasked'?{}:{writeBlocked:BLOCK})};}
      if(name==='apply'){if(b.applyError||b.header!=='unmasked')throw Object.assign(Error(b.applyError||BLOCK.message),{status:400,code:'BRIDGE_ERROR'});b.jobs=[{id:body.approvalId,status:'verified',platformSaved:true,results:[],current:{...structuredClone(rec),entryMemo:'지각_담임:가상담임(09:20)'}}];return {};}
      if(name==='sync'){const id='sync-'+b.calls.length;b.jobs=[{id,...b.syncJob}];return {id};}
      throw Error('unexpected '+name);
    }};
  return b;
}
function fakeStore(list){
  const docs=new Map(list.map(r=>[r.id,r])),rejected=[];let cb=()=>{};
  const push=()=>cb([...docs.values()].map(d=>structuredClone(d)));
  return {docs,rejected,store:{watchQueue(f){cb=f;push();return()=>{};},isAdmin:async()=>true,identities:async()=>[],saveRecords:async()=>{},
    approve:async(id,approval)=>{Object.assign(docs.get(id),{status:'approved',approval,approvedBy:APPROVER});push();},
    reject:async(id,note)=>{rejected.push(id);Object.assign(docs.get(id),{status:'rejected',reviewNote:note});push();}}};
}
function relayFor(bridge,store,clock){
  return createLiveRelay({bridge:bridge.client,store,user:{email:APPROVER,getIdToken:async()=>'t'},now:()=>clock.now,sleep:()=>Promise.resolve(),pollMs:1,inWindow:()=>false,classIds:['2','3']});
}
const edit=()=>({id:'live-masked-000000001',...buildLiveRequest(rec,{entry:'09:20',exit:'18:00',entryMemo:'지각_담임:가상담임(09:20)',exitMemo:''},'버스 지연'),status:'pending',createdBy:'admin@example.com',createdAt:{seconds:1}});

test('masked refusals neither reject nor count a request; needsUnmask is signalled; an unmasked bridge is retried at once',async()=>{
  const clock={now:new Date('2026-10-14T01:00:00Z')},b=fakeBridge(),s=fakeStore([edit()]),relay=relayFor(b,s.store,clock);
  await relay.start({loop:false});
  for(let i=0;i<8;i++){await relay.step();clock.now=new Date(clock.now.getTime()+61000);}
  assert.equal(s.docs.get('live-masked-000000001').status,'pending','never rejected or approved while masked');assert.deepEqual(s.rejected,[]);
  assert.equal(b.calls.filter(c=>c==='preview-request').length,2,'a long backoff: one more look after five minutes, not every minute');
  assert.equal(b.calls.includes('apply'),false,'nothing is approved or written');
  assert.equal(relay.status().needsUnmask,1);
  const signal=relaySignal(relay.status(),{},APPROVER);assert.equal(signal.needsUnmask,1);assert.ok(!JSON.stringify(signal).includes('가상하나'),'the signal carries no names');
  // 연결 프로그램 탭이 해제되면 쉬던 요청을 바로 다시 보고(5분을 기다리지 않음) 승인·반영합니다.
  // 해제 직후 연결 프로그램이 바쁘면(연결 확인 수집 등) 그 요청은 해제 대기 수에 남습니다(/beta2 삭제 관문이 잠깐 열리지 않게).
  b.header='unmasked';b.busyOnce=true;clock.now=new Date(clock.now.getTime()+16000);
  assert.equal(await relay.step(),'request');assert.equal(relay.status().needsUnmask,1,'a busy bridge keeps the request in needsUnmask');
  assert.equal(s.docs.get('live-masked-000000001').status,'pending');clock.now=new Date(clock.now.getTime()+61000);
  assert.equal(await relay.step(),'request');
  assert.equal(s.docs.get('live-masked-000000001').status,'approved');assert.ok(b.calls.includes('apply'));
  assert.equal(relay.status().needsUnmask,0);assert.equal(Object.hasOwn(relaySignal(relay.status(),{},APPROVER),'needsUnmask'),false,'no field when nothing waits (same signal shape as before)');
  relay.stop();
});
test('an approved request refused by a masked bridge, and the old build phone message, stay without attempts or rejection',async()=>{
  const clock={now:new Date('2026-10-14T01:00:00Z')},b=fakeBridge();
  const approved={...edit(),id:'live-approved-0000001',status:'approved',approvedBy:APPROVER};approved.approval=prepareApproval(approved,rec);
  // 옛 build 요청은 다른 항목(퇴실 메모)이라 승인된 요청과 겹치지 않습니다(겹치면 그 규칙으로 반려되므로).
  const oldBuild={id:'live-oldbuild-0000001',...buildLiveRequest(rec,{entry:'09:20',exit:'18:00',entryMemo:'',exitMemo:'가상 메모'},'가상 사유'),status:'pending',createdBy:'admin@example.com',createdAt:{seconds:2}};
  const s=fakeStore([approved,oldBuild]),relay=relayFor(b,s.store,clock);
  b.previewError='학생 식별을 위해 전화번호 표시가 필요합니다.';
  await relay.start({loop:false});
  for(let i=0;i<14;i++){await relay.step();clock.now=new Date(clock.now.getTime()+61000);}
  assert.deepEqual(s.rejected,[],'neither is auto-rejected after five tries');
  assert.equal(s.docs.get('live-approved-0000001').status,'approved');assert.equal(s.docs.get('live-oldbuild-0000001').status,'pending');
  assert.equal(relay.status().needsUnmask,2);
  assert.equal(maskedFailure(Error('MASKED_UNLINKED: …')),true);assert.equal(maskedFailure(Error('해당 반·날짜를 먼저 수집하고 학생 이름을 확인해 주세요.')),false);
  relay.stop();
});
test('a mixed view stops the 17-class round after the first class; a one-class masked failure does not',async()=>{
  const clock={now:new Date('2026-10-14T01:00:00Z')},b=fakeBridge(),s=fakeStore([]);
  const relay=createLiveRelay({bridge:b.client,store:s.store,user:{email:APPROVER,getIdToken:async()=>'t'},now:()=>clock.now,sleep:()=>Promise.resolve(),pollMs:1,inWindow:()=>true,classIds:['2','3','4']});
  await relay.start({loop:false});
  b.syncJob={status:'failed',message:'MASKED_MIXED: 체크히어 화면의 가림 상태가 섞여 있어 이 날 수집을 멈췄습니다.'};
  assert.equal(await relay.step(),'idle','the round stops');assert.equal(b.calls.filter(c=>c==='sync').length,1);
  clock.now=new Date(clock.now.getTime()+61000);
  b.syncJob={status:'failed',message:'MASKED_ALIGN: 가린 화면의 표와 화면 데이터 순번이 맞지 않아 이 날 수집을 멈췄습니다.'};
  assert.equal(await relay.step(),'sync');assert.equal(await relay.step(),'sync','one class failing does not stop the others');
  assert.equal(b.calls.filter(c=>c==='sync').length,3);
  // 사람이 연결 프로그램 탭에서 해제 창을 쓰는 중이면 모든 반이 같으므로 한 바퀴를 멈춥니다(화면을 옮기지 않음)
  clock.now=new Date(clock.now.getTime()+3600000);
  b.syncJob={status:'failed',message:'MASKED_UNMASKING: 체크히어 창에서 사람이 마스킹 해제를 진행 중이라 화면을 옮기지 않았습니다.'};
  assert.equal(await relay.step(),'idle');assert.equal(b.calls.filter(c=>c==='sync').length,4);
  relay.stop();
});
test('an ambiguous same-signature pair is counted and finally rejected; a link conflict waits without counting and is not needs-unmask',async()=>{
  const clock={now:new Date('2026-10-14T01:00:00Z')},b=fakeBridge({header:'unmasked'}),s=fakeStore([edit()]),relay=relayFor(b,s.store,clock);
  b.previewCode='MASKED_CONFLICT';b.previewError='MASKED_CONFLICT: 체크히어 학생 번호 연결이 예전과 달라 멈췄습니다. 수집 PC 연결 프로그램 화면에서 「연결 충돌 정리」를 누른 뒤 다시 수집해 주세요';
  await relay.start({loop:false});
  for(let i=0;i<8;i++){await relay.step();clock.now=new Date(clock.now.getTime()+61000);}
  assert.deepEqual(s.rejected,[]);assert.equal(relay.status().needsUnmask,0,'a conflict is not fixed by an unmask');
  assert.equal(b.calls.filter(c=>c==='preview-request').length,2,'a long backoff, like a masked wait');
  b.previewCode='MASKED_AMBIGUOUS';b.previewError='MASKED_AMBIGUOUS: 같은 반에 첫 글자·끝 4자리가 같은 학생이 있어 자동 반영하지 않습니다. 체크히어에서 직접 고쳐 주세요';
  for(let i=0;i<12;i++){await relay.step();clock.now=new Date(clock.now.getTime()+61000);}
  assert.deepEqual(s.rejected,['live-masked-000000001']);assert.match(s.docs.get('live-masked-000000001').reviewNote,/체크히어에서 직접 고쳐 주세요/);
  relay.stop();
});
test('/beta2: the relay pill and the deletion gate show 체크히어 해제 필요 while requests wait for an unmask',()=>{
  const now=Date.parse('2026-10-14T03:00:00Z'),relay={state:'running',at:now-60000,capabilities:['time-delete-v1'],needsUnmask:2};
  assert.equal(unmaskNote(relay),'체크히어 해제 필요');assert.equal(unmaskNote({...relay,needsUnmask:0}),'');
  assert.deepEqual(deletionGate({features:{timeDeleteRules:true},relay,now}),{enabled:false,reasons:['체크히어 해제 필요']});
  assert.equal(deletionGate({features:{timeDeleteRules:true},relay:{...relay,needsUnmask:0},now}).enabled,true);
  // 출결대조의 중계 표시(sync.relay().text)
  const subs=[];
  const fs={doc:(db,...p)=>({path:p.join('/')}),collection:(db,...p)=>({path:p.join('/')}),where:(f,o,v)=>({f,o,v}),query:(c,...w)=>({path:c.path,w}),serverTimestamp:()=>'T',setDoc:async()=>{},
    onSnapshot:(ref,next)=>{subs.push({ref,next});return()=>{};}};
  const sync=createCheckHereSync({db:{},user:{email:'admin@example.com'},client:{},fs,withdraw:async()=>{},getRecord:()=>null,getSig:()=>'',getRow:()=>null,hasDraft:()=>false,teacherOf:()=>'',
    now:()=>now,today:()=>'2026-10-14',setTimer:()=>0,clearTimer:()=>{},confirm:()=>true,uuid:()=>'00000000-0000-4000-8000-000000000001'});
  return sync.setDay('2','2026-10-14').then(()=>{
    for(const s of subs.filter(s=>s.ref.path==='settings/checkhereRelay'))s.next({exists:()=>true,data:()=>({...relay,at:{seconds:(now-60000)/1000,nanoseconds:0}})});
    const r=sync.relay();assert.equal(r.needsUnmask,2);assert.match(r.text,/수집 PC 중계 작동 중 · 신호 1분 전 · 체크히어 해제 필요 2건/);
    sync.dispose();
  });
});
