import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetToCheckHere,liveForm,checkhereChangeKind,canDeleteTime,deleteLeaves,deletionGate,removalSides,validTeacher,isAutoLedgerRequest,AUTO_TEXT,RELAY_STALE_MS,TIME_DELETE_V2_CAPABILITY,V2_NEEDED,UNMASK_ON_APPLY,relayPrivacy,privacyShort,needsUnmaskOnApply,PRIVACY_NEEDS_RELAY} from '../../beta2-checkhere-core.mjs';
import {buildLiveRequest,isLiveRequest,tagOf,isAutoLedgerRequest as sharedAuto,AUTO_TEXT as sharedText} from '../../checkhere-live-core.mjs';
import {memoDefaultTimes} from '../approval-core.mjs';
import {reasonCategory} from '../../checkhere-proposal-core.mjs';
import {ATTEND_DELETE} from '../rules.mjs';

// 가상 학생만 씁니다. 체크히어 기록 한 명(수정창까지 다 읽은 최신 기록)
const DATE='2026-11-05';
const record=(x={})=>({id:'rec-1',version:'v1',classId:'2',date:DATE,name:'가상학생',phoneLast4:'1234',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',
 rawEntry:'09:02:11',entry:'09:02:11',exit:'18:00:05',entryMemo:'',exitMemo:'',outings:[],...x});
const run=(row,rec=record(),opts={})=>sheetToCheckHere({row,record:rec,sheetTeacher:'가상담임',date:DATE,me:'admin@example.com',...opts});
// 보낼 수 있는 결과는 실제 요청 모양으로 만들어 지고, 체크히어가 스스로 시간을 채울 일이 없어야 합니다.
function asRequest(res,rec){
 assert.equal(res.state,'send',JSON.stringify(res));
 const req=buildLiveRequest(rec,liveForm(rec,res.changes),res.text);
 assert.deepEqual(memoDefaultTimes(req.changes,rec),{});
 // 2기는 /beta2 저장 가드가 없어 요청이 그대로 저장됩니다('[2기 베타]' 표시 없음).
 const stored={...req,status:'pending'};
 assert.ok(isLiveRequest(stored));assert.equal(tagOf(stored.reason),tagOf(req.reason));assert.match(stored.reason,/^\[실시간 베타\] 출결대조 자동 · /);
 return req.changes;
}

test('출석 clears both memos and never invents times (memo-only)',()=>{
 const rec=record({entry:'09:25:00',rawEntry:'09:25:00',exit:'17:00:00',entryMemo:'지각_담임:가상담임(09:25)',exitMemo:'조퇴_담임:가상담임(17:00)'});
 assert.deepEqual(asRequest(run({type:'출석'},rec),rec),{entryMemo:'',exitMemo:''});
 assert.equal(run({type:'출석'}).state,'same','nothing to change');
 // 시간이 없는 쪽의 메모 비우기는 조용히 뺍니다(넣으면 체크히어가 18:00을 채움)
 const noExit=record({exit:null,exitMemo:'조퇴_담임:가상담임(17:00)',entryMemo:'x'});
 assert.deepEqual(asRequest(run({type:'출석'},noExit),noExit),{entryMemo:''});
});

test('지각 sets the sheet time only when the minute differs and writes the portal memo; stale 조퇴 memo is cleared',()=>{
 const rec=record({exitMemo:'조퇴_담임:가상담임(17:00)'});
 assert.deepEqual(asRequest(run({type:'지각',inT:'09:25'},rec),rec),{entry:'09:25:00',entryMemo:'지각_담임:가상담임(09:25)',exitMemo:''});
 const same=record({entry:'09:25:31',rawEntry:'09:25:31'});
 assert.deepEqual(asRequest(run({type:'지각',inT:'09:25'},same),same),{entryMemo:'지각_담임:가상담임(09:25)'},'seconds kept when the minute matches');
 assert.equal(run({type:'지각',inT:'09:05'}).state,'hold');
 const r=run({type:'지각',inT:'09:40'},record({rawEntry:'09:35:00',entry:'09:35:00'}));assert.match(r.warnings.join(),/실제 입실과 다름/);
});

test('조퇴 and 외출',()=>{
 const rec=record({entryMemo:'지각_담임:가상담임(09:20)'});
 assert.deepEqual(asRequest(run({type:'조퇴',outT:'16:30'},rec),rec),{exit:'16:30:00',exitMemo:'조퇴_담임:가상담임(16:30)',entryMemo:''});
 assert.equal(run({type:'조퇴',outT:'17:55'}).state,'hold');
 const out=record({outings:[{start:'13:00:00',end:'14:00:00'}]});
 assert.deepEqual(asRequest(run({type:'외출',oa:'13:00',ob:'14:00'},out),out),{entryMemo:'외출_담임:가상담임(13:00~14:00)'});
 assert.match(run({type:'외출',oa:'15:00',ob:'16:00'},out).warnings.join(),/외출 구간/);
 assert.equal(run({type:'외출',oa:'13:00',ob:'14:00'},record({entry:null,rawEntry:null})).state,'hold');
});

test('recognized types send only the classified memo; an unclassifiable reason or a missing time on that side is held',()=>{
 const rec=record();
 assert.deepEqual(asRequest(run({type:'인정출석',reason:'병원 진료'},rec),rec),{entryMemo:'(인정출석)병원_담임:가상담임'});
 assert.deepEqual(asRequest(run({type:'인정지각',reason:'예비군 훈련',inT:'09:40'},rec),rec),{entryMemo:'(인정지각)예비군_담임:가상담임(09:40)'});
 assert.deepEqual(asRequest(run({type:'인정조퇴',reason:'면접',outT:'15:00'},rec),rec),{exitMemo:'(인정조퇴)면접_담임:가상담임(15:00)'});
 assert.match(run({type:'인정출석',reason:'개인일정'}).notes[0],/인정 사유/);
 assert.equal(run({type:'인정출석',reason:'병원 면접'}).state,'hold','two categories');
 const absent=record({entry:null,rawEntry:null,exit:null});
 assert.match(run({type:'인정출석',reason:'병원'},absent).notes[0],/입실 시간이 없는/,'memo-only does not invent 09:00');
 for(const r of ['병가','입원','통원 치료','수술','검진'])assert.equal(reasonCategory(r),'병원',r);
});

// 관리자 1교시(ATTEND) 삭제(2026-10-16 실제 체크히어 확인 뒤 켬): 퇴실이 남아 있으면 1교시만은 못 지우고, 두 칸 삭제는 time-delete-v2 연결 프로그램만.
// 옛 연결 프로그램(v1)이면 예전처럼 결석은 보류(퇴실도 남김), ×로 퇴실만 지울 수 있음.
const EXIT_FIRST='퇴실이 남아 있으면 1교시만 지울 수 없습니다(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다). 퇴실과 함께 지워 주세요.',EXIT_KEPT=' · 퇴실도 그대로 둡니다(퇴실만 지우려면 ×)';
const V2=`1교시 삭제는 수집 PC 프로그램 업데이트 후 가능 (${TIME_DELETE_V2_CAPABILITY})`,BOTH_LEFT='1교시·퇴실 칸은 비워지고 체크히어 입실 기록은 남을 수 있습니다';
// 두 칸(1교시·퇴실)을 한 요청으로 지울 때의 문구(사용자 결정 2026-10-19 "둘 다 삭제돼야 함")
const BOTH_CELLS='퇴실과 1교시(09:00~18:00 칸)를 함께 지웁니다. 입실 기록은 남을 수 있습니다';
test('결석: none without times; held until deletion is enabled; deletes only cells with a record number',()=>{
 assert.equal(ATTEND_DELETE,true,'rules.mjs: 관리자 1교시 삭제 켬(2026-12-18)');assert.equal(V2_NEEDED,V2);
 assert.equal(run({type:'결석'},record({entry:null,rawEntry:null,exit:null})).state,'none');
 assert.match(run({type:'결석'}).notes[0],/시간 삭제는/);
 const checkedIn=record({entryKind:'PASS',exitEventId:true,enterEventId:true});
 for(const deleteV2 of [false,true]){
  const r=run({type:'결석'},checkedIn,{deleteEnabled:true,deleteV2});
  assert.deepEqual([r.state,r.deleteTimes,r.changes],['send',['exit'],{exit:''}],'a checked-in student: only the exit is deleted, the derived period clears with it');
  assert.match(r.warnings.join(),/체크히어 실제 입실 기록은 남습니다/);
 }
 // 관리자가 넣은 1교시(ATTEND): v2면 퇴실과 함께 두 칸(연결 프로그램이 퇴실 먼저), v1이면 보류(퇴실만 지우는 일부 삭제도 보내지 않고 퇴실도 남는다고 알림)
 const admin=record({entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false});
 assert.deepEqual(canDeleteTime(admin,'entry',{v2:true}),{ok:false,reason:EXIT_FIRST},'1교시 칸만(퇴실 없이)은 퇴실이 남아 있으면 잠김 — ×는 removalSides로 두 칸을 함께 지움(2026-10-19)');
 assert.deepEqual(canDeleteTime(admin,'entry',{v2:true,withExit:true}),{ok:true});
 assert.deepEqual(canDeleteTime(admin,'entry',{withExit:true}),{ok:false,reason:V2},'옛 연결 프로그램(v1)은 1교시를 지우지 않음');
 assert.deepEqual(canDeleteTime(admin,'entry'),{ok:false,reason:V2},'v1: 퇴실이 남아 있어도 1교시 × 제목은 업데이트 안내(퇴실과 함께 지우라는 안내는 v1에서 따를 수 없음)');
 assert.match(canDeleteTime(record({entryKind:'PASS',exitEventId:true}),'entry').reason,/입실에서 계산된 1교시/,'v1 too: PASS keeps its own reason');
 assert.match(canDeleteTime(record({entryKind:'ATTEND',entryEventId:false,exitEventId:true}),'entry').reason,/1교시 기록 번호를 확인하지 못했습니다/,'v1 too: a missing number is not fixed by an update');
 assert.deepEqual(canDeleteTime(admin,'exit'),{ok:true});
 const both=run({type:'결석'},admin,{deleteEnabled:true,deleteV2:true});
 assert.deepEqual([both.state,both.deleteTimes,both.changes],['send',['entry','exit'],{entry:'',exit:''}]);
 assert.equal(both.warnings.join(),BOTH_CELLS);
 const old=run({type:'결석'},admin,{deleteEnabled:true});
 assert.deepEqual([old.state,old.deleteTimes,old.changes,old.notes[0]],['hold',[],{},V2+EXIT_KEPT],'v1: 퇴실도 남긴다고 알림(지운 것으로 읽지 않게)');
 // 1교시만 있는 학생(퇴실 없음): v2면 1교시만, v1이면 보류(남길 퇴실이 없음)
 const only=record({entryKind:'ATTEND',entryEventId:true,enterEventId:false,exit:null});
 const onlyV2=run({type:'결석'},only,{deleteEnabled:true,deleteV2:true});assert.deepEqual([onlyV2.state,onlyV2.deleteTimes,onlyV2.changes],['send',['entry'],{entry:''}]);
 assert.deepEqual(canDeleteTime(only,'entry',{v2:true}),{ok:true},'퇴실이 비어 있으면 1교시 ×도 켜짐');
 const onlyV1=run({type:'결석'},only,{deleteEnabled:true});assert.deepEqual([onlyV1.state,onlyV1.notes[0]],['hold',V2]);
 // 체크인한 학생이 1교시에 사유를 저장해 ATTEND가 된 기록: 두 칸만 깨끗이(사용자 결정 2026-10-16) → v2면 1교시·퇴실을 함께 지움(실제 입실은 남음)
 const resaved=record({entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:true});
 assert.deepEqual(canDeleteTime(resaved,'entry',{v2:true,withExit:true}),{ok:true});assert.deepEqual(canDeleteTime(resaved,'exit'),{ok:true});
 assert.deepEqual(run({type:'결석'},resaved,{deleteEnabled:true,deleteV2:true}).deleteTimes,['entry','exit']);
 const held=run({type:'결석'},resaved,{deleteEnabled:true});assert.deepEqual([held.state,held.deleteTimes,held.notes[0]],['hold',[],V2+EXIT_KEPT]);
 // 1교시 기록 번호가 없으면 잠김
 assert.match(canDeleteTime(record({entryKind:'ATTEND',entryEventId:false,exitEventId:true}),'entry',{v2:true,withExit:true}).reason,/1교시 기록 번호를 확인하지 못했습니다/);
 // 체크인했지만 아직 퇴실이 없음: 퇴실을 지우면 비워진다는 안내 대신 지울 칸이 없다고 알림
 const noExit=run({type:'결석'},record({entryKind:'PASS',exit:null,enterEventId:true}),{deleteEnabled:true,deleteV2:true});
 assert.equal(noExit.notes[0],'퇴실 시간이 아직 없어 지울 수 있는 칸이 없습니다(1교시는 입실에서 계산된 값).');assert.doesNotMatch(noExit.notes[0],/퇴실을 지우면/);
 assert.match(canDeleteTime(record({entryKind:'PASS',exitEventId:true}),'entry',{v2:true}).reason,/입실에서 계산된 1교시/,'with an exit the PASS reason stays');
 assert.match(run({type:'결석'},record({entryKind:'PASS',exitEventId:false}),{deleteEnabled:true,deleteV2:true}).notes[0],/퇴실 기록 번호/);
 assert.deepEqual(canDeleteTime(record({exitEventId:true}),'exit'),{ok:true});
 // 남는 것(확인창·경고): 퇴실만 지우면 입실은 남고(관리자 1교시도 남음, v1), 두 칸이면 함께 지운다고, 퇴실이 빈 1교시만이면 두 칸이 빈다고
 assert.equal(deleteLeaves(['exit'],checkedIn),'체크히어 실제 입실 기록은 남습니다');
 assert.equal(deleteLeaves(['exit'],admin),'관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다');
 assert.equal(deleteLeaves(['entry','exit'],admin),BOTH_CELLS);assert.equal(deleteLeaves(['entry']),BOTH_LEFT);
});

// 사용자 결정(2026-10-19, 실제 체크히어 시험): 관리자 1교시(ATTEND) 학생의 퇴실 ×가 퇴실만 지우고 09:00~18:00 칸(1교시)을 남김 → "둘 다 삭제돼야 함".
// removalSides = × 한 번이 지울 칸. v2(time-delete-v2 또는 중계 신호 없음)면 두 칸, 체크인 학생(PASS)의 퇴실 ×는 퇴실만, v1이면 누른 칸만(예전 동작).
test('× with time-delete-v2 clears both cells of an admin 1st-period student; PASS, an empty exit and v1 keep one cell',()=>{
 const admin=record({entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false});
 const resaved=record({entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:true});
 const pass=record({entryKind:'PASS',entryEventId:false,exitEventId:true,enterEventId:true});
 for(const side of ['exit','entry']){
  assert.deepEqual(removalSides(admin,side,{v2:true}),['entry','exit'],`${side} × of an admin 1교시 student: both cells`);
  assert.deepEqual(removalSides(resaved,side,{v2:true}),['entry','exit'],'a checked-in student who saved a memo on the 1교시 (ATTEND) too — 실제 입실은 남음');
  assert.deepEqual(removalSides(admin,side),[side],'v1 (old bridge): only the pressed cell');
  assert.deepEqual(removalSides(admin,side,{v2:false}),[side]);
 }
 // 두 칸의 각 칸은 그대로 지울 수 있음(1교시는 퇴실과 함께)
 assert.deepEqual([canDeleteTime(admin,'exit'),canDeleteTime(admin,'entry',{v2:true,withExit:true})],[{ok:true},{ok:true}]);
 assert.deepEqual(removalSides(pass,'exit',{v2:true}),['exit'],'PASS: CheckHere clears the derived 1교시 with the exit');
 assert.deepEqual(removalSides(pass,'entry',{v2:true}),['entry'],'PASS 1교시 × stays the pressed cell (still refused)');
 assert.match(canDeleteTime(pass,'entry',{v2:true}).reason,/입실에서 계산된 1교시/);
 const noExit=record({entryKind:'ATTEND',entryEventId:true,enterEventId:false,exit:null,exitEventId:false});
 assert.deepEqual(removalSides(noExit,'entry',{v2:true}),['entry'],'exit already empty: 1교시 only, as today');
 assert.deepEqual(removalSides(record({entryKind:'ATTEND',entryEventId:false,exitEventId:true}),'exit',{v2:true}),['exit'],'1교시 without its number (recollect): the exit × stays exit only (the confirm says the 1교시 stays)');
 // 문구: 두 칸이면 함께 지운다고(1교시 칸 이름은 강의시간), 퇴실만이면 예전 그대로
 assert.equal(deleteLeaves(removalSides(admin,'exit',{v2:true}),admin),BOTH_CELLS);
 assert.equal(deleteLeaves(['entry','exit'],record({schedule:'10:00 ~ 17:00'})),'퇴실과 1교시(10:00~17:00 칸)를 함께 지웁니다. 입실 기록은 남을 수 있습니다');
 assert.equal(deleteLeaves(['entry','exit']),BOTH_CELLS,'no schedule: the 2기 default');
 assert.equal(deleteLeaves(removalSides(admin,'exit'),admin),'관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다','v1 exit only');
 assert.equal(deleteLeaves(removalSides(pass,'exit',{v2:true}),pass),'체크히어 실제 입실 기록은 남습니다');
 // 결석 저장은 그대로 두 칸(v2)·퇴실만(PASS)·보류(v1)
 assert.deepEqual(run({type:'결석'},admin,{deleteEnabled:true,deleteV2:true}).deleteTimes,['entry','exit']);
 assert.deepEqual(run({type:'결석'},pass,{deleteEnabled:true,deleteV2:true}).deleteTimes,['exit']);
 assert.equal(run({type:'결석'},admin,{deleteEnabled:true}).state,'hold');
});

test('front conditions: date range, missing or partial record, teacher, schedule, other types',()=>{
 assert.match(sheetToCheckHere({row:{type:'출석'},record:record(),date:'2027-01-23'}).notes[0],/날짜 범위/);
 assert.equal(run({type:'지각',inT:'09:30'},null).state,'none');
 assert.equal(run({type:'지각',inT:'09:30'},record({readState:'partial'})).retryWhen,'record');
 assert.deepEqual(run({type:'지각',inT:'09:30'},record({teacher:'강의(1)'})).changes.entryMemo,'지각_담임:가상담임(09:30)','sheet teacher when the lecture teacher cannot be used');
 assert.match(sheetToCheckHere({row:{type:'지각',inT:'09:30'},record:record({teacher:''}),sheetTeacher:'',date:DATE}).notes[0],/담임 이름/);
 assert.match(run({type:'지각',inT:'09:30'},record({teacher:'다른담임'})).warnings.join(),/담임 이름 다름/);
 const odd=run({type:'지각',inT:'09:30'},record({schedule:'10:00 ~ 18:00'}));assert.equal(odd.changes.entry,undefined);assert.match(odd.warnings.join(),/강의시간/);
 assert.equal(run({type:'중복'}).state,'manual');
 assert.equal(validTeacher('가상[1]'),false);assert.equal(validTeacher(' 가상 '),true);
});

test('in-progress requests: my own pending auto requests are withdrawn first, anything else waits',()=>{
 const mine={id:'b2_a',status:'pending',createdBy:'admin@example.com',reason:`[실시간 베타] ${AUTO_TEXT} · 지각 · x [기준:0123abcd]`};
 const back=run({type:'출석'},record(),{active:[mine]});
 assert.deepEqual([back.state,back.withdraw],['same',['b2_a']],'지각 → 출석 again: withdraw the queued 지각 memo, nothing else to send');
 assert.equal(run({type:'조퇴',outT:'16:00'},record(),{active:[mine]}).withdraw[0],'b2_a');
 const waits=run({type:'조퇴',outT:'16:00'},record(),{active:[{...mine,createdBy:'other@example.com'}]});
 assert.equal(waits.retryWhen,'request');
 // 기다린 뒤에는 다시 계산해 새 요청을 만들 뿐, 체크히어에 자동으로 쓴다고 말하지 않습니다(중계는 읽기 전용, 2026-10-16).
 assert.deepEqual(waits.notes,['진행 중 요청이 끝나면 다시 계산해 요청']);assert.doesNotMatch(waits.notes.join(),/자동 반영/);
 assert.equal(run({type:'조퇴',outT:'16:00'},record(),{active:[{...mine,status:'approved'}]}).retryWhen,'request');
 assert.equal(run({type:'조퇴',outT:'16:00'},record(),{active:[{...mine,status:'verified'}]}).state,'send','finished requests do not block');
 assert.ok(isAutoLedgerRequest(mine));
 assert.equal(isAutoLedgerRequest,sharedAuto,'1기 재처리 제외와 같은 판정(checkhere-live-core.mjs)을 다시 내보냅니다');assert.equal(AUTO_TEXT,sharedText);
});

test('which saves are sent automatically',()=>{
 const p={type:'지각',inT:'09:20',reason:'교통',ev:''};
 assert.equal(checkhereChangeKind(p,{...p,type:'결석'}),'checkhere');
 assert.equal(checkhereChangeKind(p,{...p,inT:'09:30'}),'checkhere');
 assert.equal(checkhereChangeKind(p,{...p,outT:'17:00'}),'none','a time the type does not use');
 assert.equal(checkhereChangeKind(p,{...p,reason:'버스'}),'sheet-only','reason of a plain type is not in the CheckHere memo');
 assert.equal(checkhereChangeKind({type:'인정출석',reason:'병원'},{type:'인정출석',reason:'면접'}),'checkhere');
 assert.equal(checkhereChangeKind({type:'인정출석',reason:'병원',ev:''},{type:'인정출석',reason:'병원',ev:'확인'}),'sheet-only');
 assert.equal(checkhereChangeKind(null,{type:'지각',inT:'09:20'}),'checkhere');
});

// 사용자 결정(2026-10-16): /beta2 삭제 요청은 중계 없이도 만듭니다. 남는 관문은 규칙 게시 깃발과 이 세션의 권한 거절뿐이고,
// 능력은 마지막 중계 신호에서(오래되거나 멈춘 신호도 됨): v2 → 두 칸, v1만 → 퇴실만, 신호·능력 목록 없음 → v2(build 20261016.2), 둘 다 없음 → 업데이트 필요.
test('time deletion needs only the rules flag and no permission-denied; the latest relay signal of any age picks v1 or v2',()=>{
 const now=Date.parse('2026-12-16T03:00:00Z'),ON={timeDeleteRules:true},relay={state:'running',at:now-60000,capabilities:['time-delete-v1']},V2_ON={enabled:true,reasons:[],v2:true};
 assert.deepEqual(deletionGate({features:ON,relay,now}),{enabled:true,reasons:[],v2:false},'v1: 퇴실만');
 assert.deepEqual(deletionGate({relay,now}),{enabled:false,reasons:['Firestore 규칙 게시 필요'],v2:false});
 assert.equal(deletionGate({features:{timeDeleteRules:'true'},relay,now}).enabled,false,'boolean true only');
 assert.deepEqual(deletionGate({features:ON,relay,now,denied:true}),{enabled:false,reasons:['시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다'],v2:false});
 // 중계가 없어도 켜짐: 신호 문서 없음·능력 목록 없음(옛 중계)·빈 목록(연결 프로그램에 닿지 못한 신호) → v2로 봄(반영 때 승인 화면이 v2 없으면 1교시 삭제 거절)
 assert.deepEqual(deletionGate({features:ON}),V2_ON,'no relay signal at all');
 assert.deepEqual(deletionGate({features:ON,relay:null,now}),V2_ON);
 assert.deepEqual(deletionGate({features:ON,relay:{state:'stopped',at:now-86400000},now}),V2_ON,'a signal without a capability list');
 assert.deepEqual(deletionGate({features:ON,relay:{...relay,capabilities:[]},now}),V2_ON,'an empty list = the bridge was not reached');
 assert.deepEqual(deletionGate({relay:null,now}),{enabled:false,reasons:['Firestore 규칙 게시 필요'],v2:true},'v2 alone does not open the gate');
 // 오래된·멈춘·서버 시각 대기 신호도 능력은 그대로 씀(연결 프로그램은 올라가기만 함)
 for(const old of [{...relay,at:now-RELAY_STALE_MS-1},{...relay,at:now-7*86400000},{...relay,state:'stopped'},{...relay,at:null},{...relay,at:{seconds:(now-60000)/1000,nanoseconds:0}},{...relay,at:{toMillis:()=>now-60000}}])
  assert.deepEqual(deletionGate({features:ON,relay:old,now}),{enabled:true,reasons:[],v2:false},JSON.stringify(old));
 const v2={...relay,capabilities:['time-delete-v1',TIME_DELETE_V2_CAPABILITY]};
 assert.deepEqual(deletionGate({features:ON,relay:v2,now}),V2_ON);
 assert.deepEqual(deletionGate({features:ON,relay:{...v2,at:now-RELAY_STALE_MS-1},now}),V2_ON,'a stale v2 signal is still v2');
 assert.deepEqual(deletionGate({features:ON,relay:{...v2,state:'stopped',at:now-86400000},now}),V2_ON,'a stopped v2 signal is still v2');
 assert.deepEqual(deletionGate({features:ON,relay:{state:'running',at:now,capabilities:[TIME_DELETE_V2_CAPABILITY]},now}),V2_ON,'v2 alone');
 // 닿은 신호인데 시간 삭제 능력이 둘 다 없음(옛 연결 프로그램): 오래된 신호여도 업데이트 안내로 꺼짐
 const none={features:ON,relay:{...relay,capabilities:['incremental-sync-v1']},now};
 assert.deepEqual(deletionGate(none),{enabled:false,reasons:['수집 PC 프로그램 업데이트 필요 (time-delete-v2)'],v2:false});
 assert.deepEqual(deletionGate({...none,relay:{...none.relay,state:'stopped',at:now-86400000}}).reasons,['수집 PC 프로그램 업데이트 필요 (time-delete-v2)']);
 // 읽기 전용 중계의 needsUnmask = 사람이 승인한 반영 중 가림에 막힌 수. 가린 동안에도 삭제 요청은 만듭니다(승인 대기, 2026-10-16) — 도구줄에만 보임.
 assert.deepEqual(deletionGate({features:ON,relay:{...relay,needsUnmask:1},now}),{enabled:true,reasons:[],v2:false});
 assert.deepEqual(deletionGate({features:ON,relay:{...v2,privacy:{state:'masked',leftSec:null,writable:false}},now}),V2_ON,'가린 화면은 요청을 막지 않음(반영할 때 해제)');
});

test('the relay privacy (no names) decays with the signal age and gives the short toolbar text',()=>{
 const now=Date.parse('2026-12-18T03:00:00Z'),relay=privacy=>({state:'running',at:now-60000,capabilities:['time-delete-v1'],privacy});
 const open=relayPrivacy(relay({state:'unmasked',leftSec:600,writable:true}),now);
 assert.deepEqual(open,{state:'unmasked',leftSec:540,writable:true,text:'체크히어 해제됨 · 9분 남음 — 수정·삭제 가능'},'신호 뒤 1분이 지남');
 assert.equal(privacyShort(open),'체크히어 해제됨 · 9분 남음');
 const short=relayPrivacy(relay({state:'unmasked',leftSec:200,writable:true}),now);
 assert.deepEqual([short.writable,short.text],[false,'체크히어 해제 시간 140초 남음 — 연장해야 수정·삭제 가능']);assert.equal(privacyShort(short),'체크히어 해제 시간 부족 · 연장 필요');
 const masked=relayPrivacy(relay({state:'masked',leftSec:null,writable:false}),now);
 assert.deepEqual(masked,{state:'masked',leftSec:null,writable:false,text:'체크히어 가림 — 읽기만 가능 · 수정·삭제하려면 마스킹 해제 필요'});assert.equal(privacyShort(masked),'체크히어 가림 · 읽기만');
 assert.equal(privacyShort(relayPrivacy(relay({state:'unknown',leftSec:null,writable:false}),now)),'');
 assert.equal(relayPrivacy({...relay({state:'masked'}),at:now-RELAY_STALE_MS-1},now),null,'a stale signal');
 assert.equal(relayPrivacy({...relay({state:'masked'}),state:'stopped'},now),null);assert.equal(relayPrivacy(relay(undefined),now),null,'an old relay without privacy');
 assert.equal(UNMASK_ON_APPLY,'반영할 때 체크히어 마스킹 해제 필요');
 // 확인창·× title의 '반영할 때 해제 필요': 해제 상태를 모르거나(중계 꺼짐·옛 중계 → null, unknown) 쓸 수 없으면 붙임. 해제됐고 시간이 넉넉할 때만 뺌.
 assert.deepEqual([null,undefined,masked,short,relayPrivacy(relay({state:'unknown',leftSec:null,writable:false}),now),open].map(needsUnmaskOnApply),[true,true,true,true,true,false]);
 assert.equal(PRIVACY_NEEDS_RELAY,'체크히어 해제 상태는 중계가 켜져 있을 때 보입니다');
});

test('memo safety net and in-progress requests',()=>{
 // 시간이 00:00이면 '(00:00)' 메모가 되므로 보내지 않습니다. 메모가 500자를 넘어도 보내지 않습니다.
 assert.match(run({type:'인정지각',reason:'병원',inT:'00:00'}).notes[0],/메모 형식/);
 assert.match(sheetToCheckHere({row:{type:'인정출석',reason:'병원'},record:record({teacher:'가'.repeat(600)}),sheetTeacher:'',date:DATE}).notes[0],/메모 형식/);
 // 다른 사람의 진행 중 요청이 있으면 '이미 같음'(same)·'시간 없음'(none)을 내지 않고 기다립니다.
 const other={id:'x',status:'pending',createdBy:'other@example.com',reason:'운영포털 요청',changes:{entryMemo:'가상'}};
 assert.equal(run({type:'출석'},record(),{active:[other]}).state,'hold');
 assert.equal(run({type:'결석'},record({entry:null,rawEntry:null,exit:null}),{active:[other]}).state,'hold');
});
