// 두 칸 삭제(time-delete-v2, 2026-10-16)와 가림 확인(privacy-state-v1): 연결 프로그램(K2·K3·K4)을 가짜 체크히어로 시험합니다.
// 가짜 체크히어는 실제 확인한 동작을 흉내 냅니다(tests/checkhere-fake.mjs 머리말): 퇴실 먼저 → 1교시 순서면 두 칸이 비고 입실 기록은 남을 수 있음,
// 퇴실이 남은 채 1교시를 지우면 퇴실 시간으로 다시 채움, 체크인한 학생의 계산된 1교시(PASS)는 퇴실과 함께 빔, 해제 헤더 없는 쓰기는 거절.
// 가상 학생·가짜 승인 저장소만 씁니다(포트 18972~18982, 18988). 실제 체크히어·Firebase·127.0.0.1:8765에 닿지 않습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createBridge,BUILD} from '../server.mjs';
import {TIME_DELETE_V2_CAPABILITY,PRIVACY_STATE_CAPABILITY,NEEDS_UNMASK_TEXT,privacyState} from '../rules.mjs';
import {MASKED,waitsForUnmask} from '../masking.mjs';
import {CheckHereCollector} from '../collector.mjs';
import {bridgeWorld} from './checkhere-fake.mjs';

const TOKEN='fixture-admin',BOTH={entry:'',exit:''};
mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
const bodies=w=>w.writes.map(b=>[b.typeEvent,b.existEventId,Object.hasOwn(b,'time')?'update':'delete']);

test('request writer: deletes the exit first, re-reads, deletes the admin 1st period by its re-read number, and verifies both cells are empty (the entry record may stay)',async()=>{
  const W=await bridgeWorld(18972,'two-cell-request-');
  try{
    W.w.renumber=true;// 퇴실을 지우면 남은 ATTEND의 기록 번호가 바뀜: 요청 때의 옛 번호(a2)로 지우면 체크히어가 404
    const id=W.approve('two-cell-req-00001','나가상',BOTH,['entry','exit']);
    const r=await W.apply(id);assert.equal(r.code,202,JSON.stringify(r.body));
    const j=await W.done(id);
    assert.equal(j.status,'verified',j.message);assert.equal(j.writer,'request');assert.equal(j.platformSaved,true);
    assert.deepEqual(bodies(W.w),[['COMPLETE','c2','delete'],['ATTEND','a-renum-1','delete']],'exit first, then the 1st period by the number read after the exit was gone');
    assert.deepEqual([W.w.auth,W.w.privacy],[[true,true],[true,true]]);
    assert.match(j.message,/ · 퇴실·1교시 삭제 확인 · 입실 기록은 남음$/);
    assert.deepEqual(j.results.map(x=>[x.field,x.state,x.deleted]),[['exit','verified',true],['entry','verified',true]]);
    assert.deepEqual(await W.row('나가상'),['09:20:00','-','-'],'both cells are empty on the CheckHere screen; the entry record stays');
    const saved=W.docs.get(id).result.current;assert.deepEqual([saved.entry,saved.exit,saved.rawEntry,saved.entryMemo,saved.exitMemo],[null,null,'09:20:00','','']);
    assert.equal(saved.attendeeId,undefined);
    // 연결 프로그램 쪽 기록도 두 칸이 빈 상태(입실 기록이 1교시 메모를 달고 남아도 읽기는 됨)
    assert.equal(W.record('나가상').readState,'complete');assert.deepEqual([W.record('나가상').entry,W.record('나가상').exit],[null,null]);
  }finally{await W.close();}
});

test('editor writer: the same order through the edit window 삭제 button and the same clean result',async()=>{
  const W=await bridgeWorld(18973,'two-cell-editor-');
  try{
    W.w.renumber=true;
    const id=W.approve('two-cell-edit-0001','나가상',BOTH,['entry','exit']);
    await W.apply(id,{writer:'editor'});const j=await W.done(id);
    assert.equal(j.status,'verified',j.message);assert.equal(j.writer,undefined);
    assert.deepEqual(bodies(W.w),[['COMPLETE','c2','delete'],['ATTEND','a-renum-1','delete']]);
    assert.match(j.message,/퇴실·1교시 삭제 확인/);assert.deepEqual(await W.row('나가상'),['09:20:00','-','-']);
  }finally{await W.close();}
});

test('not clean: when the 1st period survives, the job ends partial with 덜 지워짐 and what is left (types and times only); a short unmask time stops before the second cell',async()=>{
  const W=await bridgeWorld(18974,'two-cell-partial-');
  try{
    W.w.ignoreDelete='ATTEND';// 체크히어가 1교시 삭제를 받고도 지우지 않음
    const a=W.approve('two-cell-part-0001','나가상',BOTH,['entry','exit']);
    await W.apply(a);let j=await W.done(a);
    assert.equal(j.status,'partial',j.message);assert.match(j.message,/^덜 지워짐: 1교시 09:20:00\(ATTEND\) 남음/);
    for(const v of ['나가상','att-','a2','c2'])assert.ok(!j.message.includes(v),'no name or number in the message: '+v);
    assert.equal(W.docs.get(a).status,'partial');assert.deepEqual(bodies(W.w),[['COMPLETE','c2','delete'],['ATTEND','a2','delete']]);
    // 가림 확인(K4)이 칸 사이에도: 퇴실을 지운 뒤 남은 해제 시간이 90초 밑이면 1교시는 누르지도 보내지도 않고 덜 지워짐으로 끝냅니다.
    const V=await bridgeWorld(18975,'two-cell-short-');
    try{
      V.w.afterWrite=()=>{V.w.left='1분 0초';};
      const b=V.approve('two-cell-short-001','나가상',BOTH,['entry','exit']);
      await V.apply(b);j=await V.done(b);
      assert.equal(j.status,'partial',j.message);assert.match(j.message,/^덜 지워짐: 1교시 09:20:00\(ATTEND\) 남음 · MASKED_TIME/);
      assert.deepEqual(bodies(V.w),[['COMPLETE','c2','delete']],'only the exit was sent');assert.deepEqual(await V.row('나가상'),['09:20:00','09:20:00','-']);
    }finally{await V.close();}
  }finally{await W.close();}
});

test('the 1st period alone is refused while the exit is there (CheckHere would refill it from the exit); once the exit is gone it is deleted alone',async()=>{
  const W=await bridgeWorld(18976,'two-cell-entry-');
  try{
    const only=W.approve('two-cell-entry-001','나가상',{entry:''},['entry']);
    await W.apply(only);let j=await W.done(only);
    assert.equal(j.status,'conflict',j.message);assert.match(j.message,/퇴실이 남아 있으면 1교시만 지울 수 없습니다\(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다\)/);
    assert.equal(W.w.writes.length,0,'nothing was sent');
    // 퇴실만 지우기는 그대로: 관리자 1교시와 입실은 남음
    const exit=W.approve('two-cell-entry-002','나가상',{exit:''},['exit']);
    await W.apply(exit);j=await W.done(exit);assert.equal(j.status,'verified',j.message);assert.match(j.message,/ · 퇴실 시간 삭제 확인$/);
    assert.deepEqual(await W.row('나가상'),['09:20:00','09:20:00','-']);
    // 퇴실이 빈 뒤에는 1교시만의 삭제도 됩니다(두 칸이 빔)
    const after=W.approve('two-cell-entry-003','나가상',{entry:''},['entry']);
    await W.apply(after);j=await W.done(after);assert.equal(j.status,'verified',j.message);assert.match(j.message,/ · 1교시 시간 삭제 확인$/);
    assert.deepEqual(await W.row('나가상'),['09:20:00','-','-']);
    assert.deepEqual(bodies(W.w),[['COMPLETE','c2','delete'],['ATTEND','a2','delete']]);
  }finally{await W.close();}
});

test('the fake models the measured CheckHere: deleting the admin 1st period while the exit stays refills entry and 1st period from the exit (why the bridge never does that)',async()=>{
  const W=await bridgeWorld(18977,'two-cell-model-');
  try{
    // 사람이 그 탭에서 직접 1교시 '삭제'를 누른 경우(2-1): 입실·1교시·퇴실이 모두 18:00
    const p=W.s.page;await p.locator('[data-seq="1"][data-f="entry"]').click();await p.locator('#remove').click();await p.locator('#modifyTime').waitFor({state:'hidden'});
    for(let i=0;i<40&&(await W.row('나가상'))?.[1]!=='18:00:00';i++)await new Promise(r=>setTimeout(r,50));
    assert.deepEqual(await W.row('나가상'),['18:00:00','18:00:00','18:00:00']);
    // 해제 헤더 없는 쓰기는 체크히어가 받지 않습니다(바뀌는 것 없음)
    W.w.unmask=null;await p.reload();await p.locator('[data-seq="3"][data-f="exit"]').click();await p.locator('#remove').click();
    for(let i=0;i<40&&W.w.privacy.length<2;i++)await new Promise(r=>setTimeout(r,50));
    assert.deepEqual(W.w.privacy,[true,false]);assert.equal((await W.row('다가상'))[2],'15:00:00');
  }finally{await W.close();}
});

test('a checked-in student: deleting the exit also empties the computed 1st period (PASS) and keeps the real entry; the PASS cell itself is never a deletion target',async()=>{
  const W=await bridgeWorld(18978,'two-cell-pass-');
  try{
    const exit=W.approve('two-cell-pass-0001','가상하나',{exit:''},['exit']);
    await W.apply(exit);let j=await W.done(exit);
    assert.equal(j.status,'verified',j.message);assert.match(j.message,/ · 퇴실 시간 삭제 확인$/);
    assert.deepEqual(await W.row('가상하나'),['08:55:31','-','-']);assert.deepEqual(bodies(W.w),[['COMPLETE','c1','delete']]);
    assert.equal(j.results[0].rawEntryAfter,'08:55:31');
    const both=W.approve('two-cell-pass-0002','다가상',BOTH,['entry','exit']);
    await W.apply(both);j=await W.done(both);assert.equal(j.status,'conflict');assert.match(j.message,/입실에서 계산된 1교시는 지울 수 없습니다/);assert.equal(W.w.writes.length,1);
    // 체크히어가 퇴실을 지우고도 계산된 1교시를 남기면(측정과 다른 예외) 두 칸이 깨끗하지 않으므로 완료가 아니라 덜 지워짐(/beta2 결석 v2는 체크인 학생에게 퇴실만 보냄)
    W.w.passStays=true;const kept=W.approve('two-cell-pass-0003','다가상',{exit:''},['exit']);
    await W.apply(kept);j=await W.done(kept);assert.equal(j.status,'partial',j.message);assert.match(j.message,/^덜 지워짐: 1교시 08:59:00\(PASS\) 남음/);
    assert.deepEqual(await W.row('다가상'),['08:59:00','08:59:00','-']);assert.equal(W.docs.get(kept).status,'partial');
  }finally{await W.close();}
});

test('two cells: if CheckHere empties the admin 1st period together with the exit, the job is verified without a second delete (both cells are empty)',async()=>{
  const W=await bridgeWorld(18982,'two-cell-together-');
  try{
    W.w.attendWithExit=true;// 측정 안 된 경우: 퇴실 삭제가 관리자 1교시도 함께 비움
    const id=W.approve('two-cell-tog-00001','나가상',BOTH,['entry','exit']);
    await W.apply(id);const j=await W.done(id);
    assert.equal(j.status,'verified',j.message);assert.match(j.message,/ · 퇴실·1교시 삭제 확인/);
    assert.deepEqual(bodies(W.w),[['COMPLETE','c2','delete']],'nothing left to press for the 1st period');
    assert.deepEqual(j.results.map(x=>[x.field,x.state,x.deleted]),[['exit','verified',true],['entry','verified',true]]);
    assert.deepEqual(await W.row('나가상'),['09:20:00','-','-']);
  }finally{await W.close();}
});

test('the write gate (K4) on every path: masked or under 150 s never claims or sends — apply without a writer (portal and direct edit), editor, request, batch, deletion and retry',{timeout:180000},async()=>{
  const W=await bridgeWorld(18979,'two-cell-gate-');
  const ids=[W.approve('gate-memo-00000001','가상하나',{exitMemo:'조퇴_담임:가상담임(17:50)'}),W.approve('gate-delete-000001','나가상',BOTH,['entry','exit']),W.approve('retry_gate-0000001','다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'})];
  const untouched=()=>{assert.equal(W.w.writes.length,0,'nothing was sent');assert.equal(W.fake.calls.claim,0,'nothing was claimed');for(const id of ids)assert.equal(W.docs.get(id).status,'approved');};
  try{
    for(const [mode,left,code,text] of [['masked','9분 30초','MASKED_WRITE',NEEDS_UNMASK_TEXT],['unmasked','2분 0초','MASKED_TIME','연장']]){
      W.w.mode=mode;W.w.left=left;await W.s.page.reload();await W.c.readHeader();
      for(const id of ids)for(const writer of [undefined,'editor','request']){
        const r=await W.apply(id,writer?{writer}:{});assert.equal(r.code,400,JSON.stringify(r.body));assert.match(r.body.error,new RegExp(code));assert.ok(r.body.error.includes(text),r.body.error);assert.ok(waitsForUnmask(r.body.error),'it waits for a person to unmask');
      }
      const b=await W.call('apply-batch',{approvalIds:ids,idToken:TOKEN});
      if(b.code===202){const done=await W.done(b.body.id);assert.equal(done.status,'failed');assert.equal(done.items[0].status,'not-started');assert.match(done.items[0].message,new RegExp(code));}
      else assert.match(b.body.error,new RegExp(code));
      untouched();
      const status=await W.get('status');assert.equal(status.privacy.writable,false);assert.equal(status.privacy.state,mode);
      assert.equal(waitsForUnmask((await W.state()).jobs.find(j=>j.kind==='apply-batch')?.message||code),true);
    }
    // 머리말을 읽지 못하면(none) 해제 상태를 모르는 것: 이 프로그램이 머리말을 한 번도 보지 못했어도(새로 띄운 뒤 모양이 바뀐 화면 등) 쓰지 않습니다(privacyState 'unknown'과 같음).
    // 가림 기능이 없는 옛 가짜 화면(시험 legacyNoMasking)만 예전처럼 두고, 그런 화면도 머리말을 한 번 보였으면 막습니다.
    const none=()=>({state:'none',remaining:null,at:Date.now()});
    const c=new CheckHereCollector('');c.view='plain';c.header=none();
    assert.equal(c.writeBlocked({}),MASKED.WRITE,'a fresh bridge that never recognised the header does not write');assert.equal(privacyState({header:'none'}).writable,false);
    const legacy=new CheckHereCollector('',{legacyNoMasking:true});legacy.view='plain';legacy.header=none();
    assert.equal(legacy.writeBlocked({}),null,'a legacy test screen without the masking feature');legacy.maskingSeen=true;assert.equal(legacy.writeBlocked({}),MASKED.WRITE);
  }finally{await W.close();}
});

test('/api/status and /api/state carry the privacy line (no names); the bridge announces time-delete-v2 and privacy-state-v1 with build 20261016.2',async()=>{
  const W=await bridgeWorld(18980,'two-cell-status-');
  try{
    assert.equal(BUILD,'20261016.2');
    let s=await W.get('status');
    assert.equal(s.build,'20261016.2');for(const c of [TIME_DELETE_V2_CAPABILITY,PRIVACY_STATE_CAPABILITY])assert.ok(s.capabilities.includes(c),c);
    assert.equal(s.privacy.state,'unmasked');assert.equal(s.privacy.writable,true);assert.ok(s.privacy.leftSec>500&&s.privacy.leftSec<=570,String(s.privacy.leftSec));assert.match(s.privacy.text,/^체크히어 해제됨 · 9분 남음 — 수정·삭제 가능$/);
    const state=await W.state();assert.deepEqual(Object.keys(state.privacy).sort(),['leftSec','state','text','writable']);assert.equal(state.privacy.state,'unmasked');
    for(const text of [JSON.stringify(s),JSON.stringify(state.privacy)])for(const v of ['나가상','가상하나','att-','0001'])assert.ok(!text.includes(v),v);
    W.w.mode='masked';await W.s.page.reload();await W.c.readHeader();s=await W.get('status');
    assert.deepEqual(s.privacy,privacyState({header:'masked'}));assert.equal(s.privacy.text,'체크히어 가림 — 읽기만 가능 · 수정·삭제하려면 마스킹 해제 필요');
    W.w.mode='unmasked';W.w.left='2분 0초';await W.s.page.reload();await W.c.readHeader();s=await W.get('status');
    assert.equal(s.privacy.writable,false);assert.match(s.privacy.text,/^체크히어 해제 시간 1\d\d초 남음 — 연장해야 수정·삭제 가능$/);
    // 키 없으면 401, HTTPS 포털 origin은 CORS로 받음(읽기)
    assert.equal((await fetch(`http://127.0.0.1:18980/api/status`)).status,401);
    const cors=await fetch(`http://127.0.0.1:18980/api/status`,{headers:{'x-hint-key':W.app.key,origin:'https://portal.example'}});assert.equal(cors.headers.get('access-control-allow-origin'),'https://portal.example');
    // 이 PC 화면(/writer): 가림 한 줄과 「확인했음」 단추만(포털 화면은 바뀌지 않음)
    const page=await (await fetch('http://127.0.0.1:18980/writer')).text();assert.match(page,/확인했음/);assert.match(page,/writer-ui\.mjs/);
  }finally{await W.close();}
});

test('the bridge keeps reading the masking header while idle (about every 15 s, no navigation or clicks)',async()=>{
  let peeks=0;const adapter={page:{isClosed:()=>false},loggedIn:async()=>true,maskingState:async()=>{peeks++;return {view:'masked',header:'masked',remaining:null,unlinked:0,classes:[]};}};
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/privacy-poll-')),collector:adapter,port:18981,approvalCloud:{},learnTickMs:20,privacyPollMs:60});
  try{
    await new Promise(r=>setTimeout(r,500));
    assert.ok(peeks>=3&&peeks<=12,`peeked ${peeks} times in 0.5 s at a 60 ms interval`);
  }finally{app.close();}
});

test('after a person unmasks, link learning waits a minute after any write attempt even when no write is waiting (the portal no longer sends while masked), so the approver is not pushed out',async()=>{
  let header='masked',collects=0;const at=()=>Date.now();
  const adapter={page:{isClosed:()=>false},loggedIn:async()=>true,requireLogin:async()=>{},collect:async()=>{collects++;},
    maskingState:async()=>header==='masked'?{view:'masked',header,remaining:null,unlinked:1,classes:[{classId:'2',date:'2026-11-02',count:1}]}:{view:'plain',header,remaining:600,unlinked:1,classes:[{classId:'2',date:'2026-11-02',count:1}]}};
  const cloud={verify:async()=>{},get:async()=>{throw Error('가상: 요청 없음');}};
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/learn-yield-')),collector:adapter,port:18988,approvalCloud:cloud,learnTickMs:20,privacyPollMs:20,writeGapMs:700});
  await new Promise(r=>app.server.listen(18988,'127.0.0.1',r));
  try{
    // 승인하는 사람이 반영을 눌렀다가(돌려보내져도 쓰기 시도) 그 사이 해제가 보임: 기다리는 쓰기는 없음
    const r=await fetch('http://127.0.0.1:18988/api/preview-request',{method:'POST',headers:{'x-hint-key':app.key,'content-type':'application/json'},body:JSON.stringify({approvalId:'learn-yield-0000001',idToken:'t'})});
    assert.equal(r.status,400);const tried=at();header='unmasked';
    for(;at()-tried<450;)await new Promise(r=>setTimeout(r,25));
    assert.equal(collects,0,'learning does not start within the write gap after a write attempt');
    for(let i=0;i<80&&!collects;i++)await new Promise(r=>setTimeout(r,25));
    assert.equal(collects,1,'it starts once the gap has passed');assert.ok(at()-tried>=700);
  }finally{app.close();}
});
