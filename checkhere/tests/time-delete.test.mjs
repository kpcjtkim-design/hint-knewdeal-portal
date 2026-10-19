// 체크히어 시간 삭제(deleteTimes) 공유 배관: 규칙·검증·가짜 어댑터 반영(설계 docs/beta2-instant-edit-plan.md 7장, 6장 3단계).
// 실제 체크히어·연결 프로그램(8765)에는 닿지 않습니다. 학생은 모두 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTEND_DELETE,TIME_DELETE_CAPABILITY,assertChangeAllowed,timeDeleteRefusal} from '../rules.mjs';
import {validateProposal,applyVerified} from '../writeback.mjs';
import {prepareApproval,deletedNote} from '../approval-core.mjs';
import {version} from '../identity.mjs';
import {checkLiveEdit} from '../../checkhere-live-core.mjs';

// 오늘(build 20261014.1) 연결 프로그램이 알리는 능력. 시간 삭제 능력은 아직 없습니다.
const TODAY=['memo-default-time-v1','approved-requests-v1','memo-only-requests-v1','approval-current-sync-v1','live-approval-preview-v1','automatic-request-collection-v1','phone-identity-v1','state-delta-v1','incremental-sync-v1','batch-sync-v1','probe-v1','page-data-v1'];
const base=(patch={})=>{const r={id:'fixture-del',studentKey:'fixture-del-key',classId:'9',date:'2026-11-12',name:'가상삭제',phoneLast4:'0009',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'08:55:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,entryKind:'PASS',exitEventId:'ev-exit',enterEventId:true,...patch};r.version=version(r);return r;};
const admin=patch=>base({entryKind:'ATTEND',entryEventId:'ev-period',enterEventId:false,rawEntry:'09:00:00',...patch});
const req=(changes={exit:''},deleteTimes=['exit'])=>({classId:'9',date:'2026-11-12',name:'가상삭제',phoneLast4:'',reason:'[가상] 결석 확인',changes,...(deleteTimes?{deleteTimes}:{})});
// 2026-10-15에 막았던 관리자 1교시(ATTEND) 삭제는 2026-10-16 실제 확인 뒤 켬(rules.mjs ATTEND_DELETE). 옛 규칙은 attend:false로만 봅니다.
// 퇴실이 남은 채 1교시만 지우면 체크히어가 퇴실 시간으로 다시 채우므로, 1교시는 같은 요청이 퇴실도 지울 때(퇴실 먼저) 또는 퇴실이 이미 빈 뒤에만 지웁니다.
const ATTEND_OFF='관리자가 넣은 1교시 삭제는 실제 체크히어에서 확인한 뒤 엽니다(지금은 퇴실만 지웁니다).';
const EXIT_FIRST=/퇴실이 남아 있으면 1교시만 지울 수 없습니다\(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다\)\. 퇴실과 함께 지워 주세요\./;

test('rules: a requested deletion may blank exactly the named side; everything else is refused',()=>{
  const r=admin();
  const ok=assertChangeAllowed(r,{exit:'',exitMemo:''},{requested:true,deletions:['exit']});
  assert.match(ok.warning,/체크히어 입실\(교시\)\/퇴실 시간을 삭제합니다/);
  assert.doesNotThrow(()=>assertChangeAllowed(r,{exit:null},{requested:true,deletions:['exit']}),'null from validateProposal is a blank too');
  assert.throws(()=>assertChangeAllowed(r,{entry:'',entryMemo:''},{requested:true,deletions:['entry']}),EXIT_FIRST,'퇴실이 남은 1교시만의 삭제는 받지 않음');
  assert.doesNotThrow(()=>assertChangeAllowed(r,{entry:'',exit:''},{requested:true,deletions:['entry','exit']}),'두 칸 삭제(퇴실 먼저)');
  assert.doesNotThrow(()=>assertChangeAllowed(admin({exit:null,exitEventId:false}),{entry:''},{requested:true,deletions:['entry']}),'퇴실이 빈 뒤 1교시만');
  // 승인 전에 퇴실이 이미 지워진 두 칸 요청: 빈 퇴실은 번호를 보지 않고(연결 프로그램과 같은 기준) 1교시만 확인 — 운영포털 승인도 받음
  assert.doesNotThrow(()=>assertChangeAllowed(admin({exit:null,exitEventId:false}),{entry:'',exit:''},{requested:true,deletions:['entry','exit']}),'빈 퇴실은 지울 것이 없음');
  assert.throws(()=>assertChangeAllowed(admin({exit:null,exitEventId:false,entryEventId:false}),{entry:'',exit:''},{requested:true,deletions:['entry','exit']}),/1교시 기록 번호를 확인하지 못했습니다/,'the 1st period still needs its number');
  assert.throws(()=>assertChangeAllowed(admin({exitEventId:false}),{entry:'',exit:''},{requested:true,deletions:['entry','exit']}),/퇴실 기록 번호를 확인하지 못했습니다/,'an exit that is there still needs its number');
  assert.throws(()=>assertChangeAllowed(r,{entry:''},{requested:true}),/「시간 삭제」 요청으로만/,'no deletions');
  assert.throws(()=>assertChangeAllowed(r,{entry:'',exit:''},{requested:true,deletions:['entry']}),/「시간 삭제」 요청으로만/,'a blank that was not named');
  assert.throws(()=>assertChangeAllowed(r,{entry:'09:10:00'},{requested:true,deletions:['entry']}),/삭제할 시간 항목/,'a named side that is not blank');
  assert.throws(()=>assertChangeAllowed(r,{entry:''},{deletions:['entry']}),/승인된 「시간 삭제」 요청으로만/,'direct edits never delete');
  assert.throws(()=>assertChangeAllowed(r,{entry:'',entryMemo:'남길 사유'},{requested:true,deletions:['entry']}),/사유는 비워/);
  assert.throws(()=>assertChangeAllowed(base(),{entry:''},{requested:true,deletions:['entry']}),/계산된 1교시/,'PASS 1교시는 지우지 않음');
  assert.doesNotThrow(()=>assertChangeAllowed(base(),{exit:''},{requested:true,deletions:['exit']}),'a checked-in student: only the exit');
});
test('rules: capability is checked only for deletions; non-deletion requests pass with today\'s capabilities',()=>{
  const r=admin();
  assert.equal(TIME_DELETE_CAPABILITY,'time-delete-v1');
  assert.throws(()=>assertChangeAllowed(r,{exit:''},{capabilities:TODAY,requested:true,deletions:['exit']}),/시간 삭제 지원/);
  assert.doesNotThrow(()=>assertChangeAllowed(r,{exit:''},{capabilities:[...TODAY,TIME_DELETE_CAPABILITY],requested:true,deletions:['exit']}));
  assert.doesNotThrow(()=>assertChangeAllowed(r,{exit:''},{requested:true,deletions:['exit']}),'no capability list given: the bridge gate (step 4) decides');
  for(const changes of [{entryMemo:'사유'},{entry:'09:10:00'},{exit:'17:00:00',exitMemo:'조퇴_담임:가상담임(17:00)'}]){
    const j=assertChangeAllowed(r,changes,{capabilities:TODAY,requested:true});assert.doesNotMatch(j.warning,/삭제/);
    assert.doesNotThrow(()=>assertChangeAllowed(r,changes,{capabilities:TODAY,requested:true,deletions:[]}));
  }
  assert.doesNotThrow(()=>assertChangeAllowed(r,{entryMemo:'사유'},{capabilities:TODAY}),'the reviewed memo path is unchanged');
  assert.throws(()=>assertChangeAllowed(r,{entry:''},{capabilities:TODAY}),/「시간 삭제」 요청으로만/,'an unrequested blank is still refused');
  // 중계가 쓰는 checkLiveEdit도 같은 규칙입니다.
  assert.doesNotThrow(()=>checkLiveEdit(r,{entryMemo:'사유'},TODAY));
  assert.throws(()=>checkLiveEdit(r,{exit:''},TODAY,['exit']),/시간 삭제 지원/);
  assert.throws(()=>checkLiveEdit(r,{exit:''},[...TODAY,TIME_DELETE_CAPABILITY]),/「시간 삭제」 요청으로만/);
  assert.deepEqual(checkLiveEdit(r,{exit:'',exitMemo:''},[...TODAY,TIME_DELETE_CAPABILITY],['exit']).defaults,{},'no default time for a deleted side');
});
test('validateProposal: blanks only on the request path, for an already blank side or a named deletion',()=>{
  const r=admin({exitMemo:'조퇴_담임:가상담임(17:00)'}),input={...r,exit:'',reason:'가상',version:r.version};
  assert.equal(validateProposal(r,input,{requested:true,deletions:['exit']}).exit,null);
  assert.equal(validateProposal(r,{...input,exitMemo:''},{requested:true,deletions:['exit']}).exitMemo,'');
  assert.throws(()=>validateProposal(r,input,{requested:true}),/요청하지 않은 시간 삭제/);
  assert.throws(()=>validateProposal(r,input,{requested:true,deletions:['entry']}),/요청하지 않은 시간 삭제/);
  assert.throws(()=>validateProposal(r,input),/시간을 비우는 변경은 지원하지 않습니다/,'the reviewed path message is unchanged');
  assert.throws(()=>validateProposal(r,{...input,exitMemo:'다른 사유'},{requested:true,deletions:['exit']}),/사유는 비워/);
  const gone=admin({exit:null});
  assert.equal(validateProposal(gone,{...gone,exit:'',entryMemo:'새 사유',reason:'가상',version:gone.version},{requested:true,deletions:['exit']}).entryMemo,'새 사유','an already deleted side is not a change');
});

// 가짜 체크히어: 수정창 '삭제'를 흉내 냅니다. clearsPass면 퇴실 삭제가 계산된 1교시(PASS)도 비웁니다(Cowork 확인 동작).
// throwsAfter: 지운 뒤 오류를 냄(수정창 닫힘 대기 시간 초과처럼). between: 승인 뒤 반영 전에 체크히어가 바뀜.
function fake(record,{supports=true,clearsPass=true,keepsTime=false,touch=null,throws=null,throwsAfter=null,between=null}={}){
  let current={...record},read=0;const writes=[],journal=[];
  const adapter={
    read:async()=>{if(read++===0&&between)Object.assign(current,between);return {...current};},
    write:async(r,field,change,options)=>{
      writes.push({field,change,options});
      if(throws)throw Error(throws);
      if(options?.deleteFields?.includes(field)){
        if(!supports)throw Error('TIME_DELETE_UNSUPPORTED: 체크히어 시간 삭제 방법을 아직 확인하지 못했습니다.');
        if(!keepsTime){current[field]=null;current[field+'Memo']='';Object.assign(current,field==='exit'?{exitEventId:false}:{entryKind:null,entryEventId:false});if(field==='exit'&&clearsPass&&current.entryKind==='PASS'){current.entry=null;current.entryMemo='';current.entryKind=null;}}
        if(touch)Object.assign(current,touch);
        if(throwsAfter)throw Error(throwsAfter);
        return {time:null,memo:''};
      }
      current[field]=change.time;current[field+'Memo']=change.memo;return {time:change.time,memo:change.memo};
    },
  };
  return {adapter,writes,journal,log:async e=>journal.push(e),get current(){return current;}};
}
// 연결 프로그램처럼 승인 내용(approval: 승인 때 본 값)이 붙은 요청으로 반영합니다.
const approved=(request,record)=>({...request,approval:prepareApproval(request,record,{allowAlreadyApplied:true})});
const run=(f,record,request,seen=record)=>applyVerified(f.adapter,record,{id:record.id,version:record.version,...prepareApproval(request,record,{allowAlreadyApplied:true}).after,reason:request.reason},f.log,approved(request,seen));

test('applyVerified: a supported deletion is verified, flagged deleted and keeps the actual entry',async()=>{
  const r=admin({exitMemo:'조퇴_담임:가상담임(17:00)'}),f=fake(r),result=await run(f,r,req());
  assert.equal(result.status,'verified',result.message);assert.match(result.message,/ · 퇴실 시간 삭제 확인/);
  assert.equal(result.current.exit,null);assert.equal(result.current.exitMemo,'');assert.equal(result.current.entry,'09:00:00','the other side stays');
  assert.deepEqual(result.results,[{field:'exit',state:'verified',error:null,deleted:true,rawEntryBefore:'09:00:00',rawEntryAfter:'09:00:00'}]);
  assert.deepEqual(f.writes.map(w=>[w.field,w.change.time,w.options]),[['exit',null,{requestedFields:['exit'],deleteFields:['exit']}]]);
  const before=f.journal.find(e=>e.phase==='before_write');assert.equal(before.deleteTime,true);assert.equal(before.field,'exit');
});
test('applyVerified: deleting the exit of a checked-in student also clears the derived period; that is not a failure',async()=>{
  const r=base({entryMemo:'지각_담임:가상담임(09:20)'}),f=fake(r),result=await run(f,r,req());
  assert.equal(result.status,'verified',result.message);assert.equal(result.current.entry,null);assert.equal(result.current.rawEntry,'08:55:00');
  assert.equal(result.results[0].deleted,true);assert.equal(result.results[0].rawEntryBefore,'08:55:00');assert.equal(result.results[0].rawEntryAfter,'08:55:00','the actual entry (ENTER) stays');
  // 체크히어가 계산된 1교시를 남기면(예상 밖) 두 칸이 깨끗하지 않으므로 '덜 지워짐'(포털 결석 v2는 체크인 학생에게 퇴실만 보내 두 칸을 기대함)
  const kept=fake(r,{clearsPass:false}),same=await run(kept,r,req());
  assert.equal(same.status,'partial',same.message);assert.match(same.message,/^덜 지워짐: 1교시 09:00:00\(PASS\) 남음\. 체크히어 원본을 확인해 주세요\.$/);assert.deepEqual(same.results.map(x=>[x.field,x.state,x.deleted]),[['exit','verified',true]]);
  // 1교시도 바꾸는 요청(1교시 사유+퇴실 삭제)은 이 확인을 하지 않습니다(1교시 칸은 요청값으로 확인).
  assert.notEqual((await run(fake(r,{clearsPass:false}),r,req({exit:'',entryMemo:'지각_담임:가상담임(09:00)'}))).message.startsWith('덜 지워짐'),true);
  // 관리자가 넣은 1교시(ATTEND)가 퇴실 삭제로 바뀌면 예상 밖이므로 확인이 필요합니다.
  const a=admin(),odd=fake(a,{touch:{entry:null,entryMemo:''}}),out=await run(odd,a,req());
  assert.equal(out.status,'conflict');assert.match(out.results[0].error,/다른 항목/);assert.equal(out.results[0].deleted,undefined);
});
test('applyVerified: a time that is still there fails, an unsupported collector fails, and nothing claims a deletion',async()=>{
  const r=admin();
  for(const opts of [{keepsTime:true},{supports:false}]){
    const f=fake(r,opts),result=await run(f,r,req());
    assert.equal(result.status,'failed',JSON.stringify(opts));assert.equal(result.results[0].state,'failed');assert.equal(result.results[0].deleted,undefined);assert.equal(f.current.exit,'18:00:00');
    if(opts.supports===false)assert.match(result.results[0].error,/TIME_DELETE_UNSUPPORTED/);
  }
  const changed=fake(r,{touch:{entryMemo:'다른 관리자가 입력'}}),c=await run(changed,r,req());assert.equal(c.status,'conflict','the other side changed while deleting');
});
test('applyVerified: an already blank side is skipped, so retrying is safe',async()=>{
  const gone=admin({exit:null}),f=fake(gone),done=await run(f,gone,req());
  assert.equal(done.status,'verified');assert.equal(done.alreadyApplied,true);assert.equal(f.writes.length,0);
  // 1교시는 이미 지워졌고 퇴실만 남은 상태에서 다시 시도: 퇴실만 지웁니다.
  const half=admin({entry:null}),h=fake(half),both=await run(h,half,req({entry:'',exit:''},['entry','exit']));
  assert.equal(both.status,'verified',both.message);assert.deepEqual(h.writes.map(w=>w.field),['exit']);assert.match(both.message,/퇴실 시간 삭제 확인/);
  // 관리자 1교시와 퇴실이 모두 있으면 퇴실 먼저, 다시 읽은 뒤 1교시(두 칸 삭제). 다시 시도하면 이미 빈 쪽은 건너뜀.
  const full=admin(),g=fake(full),all=await run(g,full,req({entry:'',exit:''},['entry','exit']));
  assert.equal(all.status,'verified',all.message);assert.deepEqual(g.writes.map(w=>w.field),['exit','entry']);assert.deepEqual([g.current.entry,g.current.exit],[null,null]);
  assert.match(all.message,/ · 퇴실·1교시 삭제 확인 · 입실 기록은 남음$/);
  const again=await run(fake(g.current),g.current,req({entry:'',exit:''},['entry','exit']),full);assert.equal(again.alreadyApplied,true);
});
test('applyVerified: a time that changed after approval is never deleted (a retried approved request), and missing record numbers stop before any click',async()=>{
  // 승인 때 퇴실 13:00을 보았는데 반영이 미뤄진 사이 학생이 18:00에 퇴실함 → 18:00은 지우지 않고 conflict로 끝냄
  const seen=admin({exit:'13:00:00'}),now=admin(),f=fake(now),late=await run(f,now,req(),seen);
  assert.equal(late.status,'conflict');assert.match(late.message,/승인 뒤 체크히어 시간이 바뀌어 지우지 않았습니다/);
  assert.equal(f.writes.length,0);assert.equal(f.current.exit,'18:00:00');assert.equal(late.current.exit,'18:00:00','the current read is kept for the platform');
  // 승인 내용이 없는 요청도 지우지 않음
  const bare=fake(now),none=await applyVerified(bare.adapter,now,{...now,exit:'',reason:'가상'},bare.log,req());
  assert.equal(none.status,'conflict');assert.equal(bare.writes.length,0);
  // 승인 뒤 반영 전에 바뀐 경우(첫 읽기에서 보임)도 같음
  const moved=fake(now,{between:{exit:'18:05:00'}}),m=await run(moved,now,req());
  assert.equal(m.status,'conflict');assert.equal(moved.writes.length,0);assert.equal(moved.current.exit,'18:05:00');
  // 기록 번호 표시가 없거나(다시 수집 전·화면 데이터와 다름) 퇴실이 남은 채 1교시만 지우는 요청(체크인한 학생의 ATTEND 포함)이면 누르지 않음
  for(const [record,request,why] of [[admin({exitEventId:undefined,entryKind:undefined}),req(),/퇴실 기록 번호를 확인하지 못했습니다/],[admin({entryEventId:false}),req({entry:''},['entry']),/1교시 기록 번호를 확인하지 못했습니다/],[admin({enterEventId:true}),req({entry:''},['entry']),EXIT_FIRST],[admin(),req({entry:''},['entry']),EXIT_FIRST],[admin({entryEventId:false}),req({entry:'',exit:''},['entry','exit']),/1교시 기록 번호를 확인하지 못했습니다/]]){
    const g=fake(record),out=await run(g,record,request);
    assert.equal(out.status,'conflict',JSON.stringify(record));assert.match(out.message,why);assert.equal(g.writes.length,0);
  }
});
test('applyVerified: the actual entry (ENTER) must survive an exit deletion; a deletion that went through before an error is still verified',async()=>{
  // 퇴실을 지웠는데 실제 입실까지 사라짐: 확인으로 보고하지 않음
  const r=base(),gone=fake(r,{touch:{rawEntry:null}}),out=await run(gone,r,req());
  assert.equal(out.status,'conflict');assert.match(out.results[0].error,/실제 입실 기록이 바뀌었습니다/);assert.equal(out.results[0].deleted,undefined);
  assert.equal(out.results[0].rawEntryBefore,'08:55:00');assert.equal(out.results[0].rawEntryAfter,null);
  // 퇴실이 남은 채 관리자 1교시만 지우는 요청은 누르기 전에 끝납니다(실제 입실 그대로).
  const a=admin(),derived=fake(a,{touch:{rawEntry:null}}),off=await run(derived,a,req({entry:''},['entry']));
  assert.equal(off.status,'conflict');assert.match(off.message,EXIT_FIRST);assert.equal(derived.writes.length,0);assert.equal(derived.current.rawEntry,'09:00:00');
  // 지운 뒤 수정창 닫힘 대기가 시간 초과: 다시 읽은 값(시간·사유 없음)으로 확인합니다. 지운 쪽 사유는 기록과 함께 사라지는 것이 맞음.
  const m=admin({exitMemo:'조퇴_담임:가상담임(17:00)'}),late=fake(m,{throwsAfter:'Timeout 12000ms exceeded'}),res=await run(late,m,req());
  assert.equal(res.status,'verified',res.message);assert.equal(res.results[0].deleted,true);assert.match(res.results[0].error,/Timeout/);assert.equal(res.current.exitMemo,'');
  // 시간은 지워졌는데 사유가 남으면 확인으로 보지 않음
  const stuck=fake(m,{touch:{exitMemo:'조퇴_담임:가상담임(17:00)'}}),s=await run(stuck,m,req());
  assert.equal(s.status,'failed');assert.equal(s.results[0].deleted,undefined);
});
test('deletedNote and the request warning say what else empties',()=>{
  assert.equal(deletedNote([{field:'exit',state:'verified',deleted:true},{field:'entry',state:'verified',deleted:true}]),' · 퇴실·1교시 삭제 확인');
  assert.equal(deletedNote([{field:'exit',state:'verified',deleted:true,rawEntryAfter:'09:00:00'},{field:'entry',state:'verified',deleted:true,rawEntryAfter:'09:00:00'}]),' · 퇴실·1교시 삭제 확인 · 입실 기록은 남음');
  assert.equal(deletedNote([{field:'entry',state:'verified',deleted:true}]),' · 1교시 시간 삭제 확인');
  assert.equal(deletedNote([{field:'exit',state:'conflict'},{field:'entry',state:'verified'}]),'');assert.equal(deletedNote(undefined),'');
  assert.match(assertChangeAllowed(base(),{exit:''},{requested:true,deletions:['exit']}).warning,/퇴실을 지우면 1교시·총 참여 시간도 비워집니다/);
  assert.doesNotMatch(assertChangeAllowed(admin(),{exit:''},{requested:true,deletions:['exit']}).warning,/총 참여 시간|계산된 입실/);
  assert.throws(()=>assertChangeAllowed(admin(),{entry:''},{requested:true,deletions:['entry']}),EXIT_FIRST);
  assert.match(assertChangeAllowed(admin(),{entry:'',exit:''},{requested:true,deletions:['entry','exit']}).warning,/퇴실을 먼저 지운 뒤 1교시를 지워 1교시·퇴실 두 칸을 비웁니다\(입실 기록은 남을 수 있음\)/);
  assert.equal(timeDeleteRefusal(base(),'exit'),'');assert.equal(timeDeleteRefusal(admin(),'exit'),'');
  assert.match(timeDeleteRefusal(admin({enterEventId:true}),'entry'),EXIT_FIRST);
});
test('timeDeleteRefusal: the admin period is on (2026-12-18); it needs its number and an empty exit unless the same request deletes the exit; the old switch is kept for comparison',()=>{
  assert.equal(ATTEND_DELETE,true,'2026-12-18: 실제 체크히어에서 확인함');
  const gone={exit:null,exitEventId:false};
  assert.equal(timeDeleteRefusal(admin(gone),'entry'),'');assert.equal(timeDeleteRefusal(admin(),'entry',{withExit:true}),'');
  assert.match(timeDeleteRefusal(admin(),'entry'),EXIT_FIRST);assert.match(timeDeleteRefusal(admin({exit:null}),'entry'),EXIT_FIRST,'a remaining exit record number counts as an exit');
  // 체크인한 학생이 1교시에 사유를 저장해 생긴 ATTEND도(사용자 결정: 두 칸만 깨끗이) — 실제 입실은 지우지 않음
  assert.equal(timeDeleteRefusal(admin({enterEventId:true,...gone}),'entry'),'');
  assert.match(timeDeleteRefusal(base(),'entry',{withExit:true}),/입실에서 계산된 1교시는 지울 수 없습니다/);
  assert.match(timeDeleteRefusal(admin({entryEventId:false,...gone}),'entry'),/1교시 기록 번호를 확인하지 못했습니다/);
  assert.match(timeDeleteRefusal(admin({exitEventId:false}),'exit'),/퇴실 기록 번호를 확인하지 못했습니다/);
  // 옛 규칙(attend:false, 시험에서만): 관리자 1교시는 막고 체크인한 학생은 퇴실만
  assert.equal(timeDeleteRefusal(admin(),'entry',{attend:false}),ATTEND_OFF);
  assert.match(timeDeleteRefusal(admin({enterEventId:true}),'entry',{attend:false}),/체크인한 학생은 퇴실만 지웁니다/);
  assert.match(timeDeleteRefusal(admin({enterEventId:undefined}),'entry',{attend:false}),/1교시 기록 번호를 확인하지 못했습니다/);
  assert.equal(timeDeleteRefusal(admin(),'exit',{attend:false}),'');
});
test('applyVerified: two cells go exit first, then the 1st period read again; a checked-in student\'s computed period empties with the exit; a 1st period that cannot go is 덜 지워짐',async()=>{
  // 관리자 1교시를 지우면 그것에서 계산된 입실이 함께 비어도 됩니다(입실 번호 없음, writeback.mjs enterKept). 퇴실이 이미 빈 학생.
  const a=admin({exit:null,exitEventId:false}),derived=fake(a,{touch:{rawEntry:null}}),ok=await run(derived,a,req({entry:''},['entry']));
  assert.equal(ok.status,'verified',ok.message);assert.match(ok.message,/ · 1교시 시간 삭제 확인$/);
  // 체크인한 학생(PASS)을 두 칸으로 요청하면 1교시는 지울 칸이 아니므로 누르기 전에 끝냄(포털은 퇴실만 보냄)
  const p=base(),pass=fake(p),refused=await run(pass,p,req({entry:'',exit:''},['entry','exit']));
  assert.equal(refused.status,'conflict');assert.match(refused.message,/입실에서 계산된 1교시는 지울 수 없습니다/);assert.equal(pass.writes.length,0);
  // 체크인한 학생이 사유를 저장해 생긴 ATTEND(입실 번호 있음): 퇴실 → 1교시, 실제 입실은 그대로여야 함
  const c=admin({enterEventId:true,rawEntry:'08:50:00'}),checked=fake(c),both=await run(checked,c,req({entry:'',exit:''},['entry','exit']));
  assert.equal(both.status,'verified',both.message);assert.deepEqual(checked.writes.map(w=>w.field),['exit','entry']);assert.equal(both.current.rawEntry,'08:50:00');
  // 퇴실을 지우자 체크히어가 ATTEND 1교시(와 메모)도 함께 비움(측정 안 된 동작): 두 칸이 비었으니 1교시는 누르지 않고 지운 것으로 적어 verified
  for(const [who,rec] of [['checked-in',admin({enterEventId:true,rawEntry:'08:50:00',entryMemo:'(인정출석)가상_담임:가상담임'})],['admin',admin({entryMemo:'지각_담임:가상담임(09:00)'})]]){
    const gone=fake(rec,{touch:{entry:null,entryMemo:'',entryKind:null,entryEventId:false,...(rec.enterEventId?{}:{rawEntry:null})}}),g=await run(gone,rec,req({entry:'',exit:''},['entry','exit']));
    assert.equal(g.status,'verified',who+': '+g.message);assert.deepEqual(gone.writes.map(w=>w.field),['exit'],who);
    assert.deepEqual(g.results.map(x=>[x.field,x.state,x.deleted]),[['exit','verified',true],['entry','verified',true]],who);assert.match(g.message,/ · 퇴실·1교시 삭제 확인/,who);
    if(rec.enterEventId)assert.equal(g.current.rawEntry,'08:50:00','the real entry stays');
  }
  // 실제 입실(입실 번호 있음)이 바뀌면 두 칸이 비어도 확인이 필요합니다.
  const real=admin({enterEventId:true,rawEntry:'08:50:00'}),moved=await run(fake(real,{touch:{entry:null,entryMemo:'',entryKind:null,entryEventId:false,rawEntry:null}}),real,req({entry:'',exit:''},['entry','exit']));
  assert.notEqual(moved.status,'verified');
  // 1교시가 지워지지 않음(체크히어가 받고도 그대로): 덜 지워짐(남은 종류·시간만), partial
  let n=0;const stuck=fake(admin());const write=stuck.adapter.write;stuck.adapter.write=async(r,field,change,options)=>{n++;if(field==='entry')return {time:null,memo:''};return write(r,field,change,options);};
  const left=await run(stuck,admin(),req({entry:'',exit:''},['entry','exit']));
  assert.equal(left.status,'partial');assert.equal(n,2);assert.match(left.message,/^덜 지워짐: 1교시 09:00:00\(ATTEND\) 남음/);assert.deepEqual(left.results.map(x=>[x.field,x.state]),[['exit','verified'],['entry','failed']]);
  // 퇴실을 지운 뒤 다시 읽었더니 1교시가 번호 없는 PASS로 바뀌어 있음(예상 밖): 1교시는 누르지 않고 덜 지워짐(남은 종류·시간과 이유)
  const odd=fake(admin({enterEventId:true}),{touch:{entryKind:'PASS',entryEventId:false}}),o=await run(odd,admin({enterEventId:true}),req({entry:'',exit:''},['entry','exit']));
  assert.equal(o.status,'partial');assert.match(o.message,/^덜 지워짐: 1교시 09:00:00\(PASS\) 남음 · 입실에서 계산된 1교시는 지울 수 없습니다/);assert.deepEqual(odd.writes.map(w=>w.field),['exit']);
});
test('applyVerified: non-deletion requests keep the old write options and journal entries',async()=>{
  const r=admin(),f=fake(r),result=await run(f,r,req({exitMemo:'조퇴_담임:가상담임(17:00)'},null));
  assert.equal(result.status,'verified');assert.equal(result.message,'체크히어를 다시 열어 변경값을 확인했습니다.');
  assert.deepEqual(f.writes[0].options,{requestedFields:['exitMemo']});assert.equal(Object.hasOwn(f.writes[0].options,'deleteFields'),false);
  assert.equal(Object.hasOwn(f.journal[0],'deleteTime'),false);assert.equal(Object.hasOwn(result.results[0],'deleted'),false);
  // 요청 없이(검수 화면) 시간을 비우면 지금처럼 거절합니다.
  await assert.rejects(()=>applyVerified(fake(r).adapter,r,{...r,exit:'',reason:'가상'},async()=>{}),/시간을 비우는 변경은 지원하지 않습니다/);
});
