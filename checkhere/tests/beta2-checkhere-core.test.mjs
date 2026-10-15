import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetToCheckHere,liveForm,checkhereChangeKind,canDeleteTime,deletionGate,validTeacher,isAutoLedgerRequest,AUTO_TEXT,RELAY_STALE_MS} from '../../beta2-checkhere-core.mjs';
import {buildLiveRequest,isLiveRequest,tagOf,isAutoLedgerRequest as sharedAuto,AUTO_TEXT as sharedText} from '../../checkhere-live-core.mjs';
import {memoDefaultTimes} from '../approval-core.mjs';
import {beta2RequestData} from '../../beta2-guard-core.mjs';
import {reasonCategory} from '../../checkhere-proposal-core.mjs';

// 가상 학생만 씁니다. 체크히어 기록 한 명(수정창까지 다 읽은 최신 기록)
const DATE='2026-09-03';
const record=(x={})=>({id:'rec-1',version:'v1',classId:'2',date:DATE,name:'가상학생',phoneLast4:'1234',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',
 rawEntry:'09:02:11',entry:'09:02:11',exit:'18:00:05',entryMemo:'',exitMemo:'',outings:[],...x});
const run=(row,rec=record(),opts={})=>sheetToCheckHere({row,record:rec,sheetTeacher:'가상담임',date:DATE,me:'admin@example.com',...opts});
// 보낼 수 있는 결과는 실제 요청 모양으로 만들어 지고, 체크히어가 스스로 시간을 채울 일이 없어야 합니다.
function asRequest(res,rec){
 assert.equal(res.state,'send',JSON.stringify(res));
 const req=buildLiveRequest(rec,liveForm(rec,res.changes),res.text);
 assert.deepEqual(memoDefaultTimes(req.changes,rec),{});
 const stored=beta2RequestData('checkhereRequests/b2_x',{...req,status:'pending'});
 assert.ok(isLiveRequest(stored));assert.equal(tagOf(stored.reason),tagOf(req.reason));assert.match(stored.reason,/^\[실시간 베타\] \[2기 베타\] 출결대조 자동 · /);
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

test('결석: none without times; held until deletion is enabled; deletes only cells with a record number',()=>{
 assert.equal(run({type:'결석'},record({entry:null,rawEntry:null,exit:null})).state,'none');
 assert.match(run({type:'결석'}).notes[0],/시간 삭제는/);
 const checkedIn=record({entryKind:'PASS',exitEventId:true,enterEventId:true});
 const r=run({type:'결석'},checkedIn,{deleteEnabled:true});
 assert.deepEqual([r.state,r.deleteTimes,r.changes],['send',['exit'],{exit:''}],'a checked-in student: only the exit is deleted, the derived period clears with it');
 assert.match(r.warnings.join(),/실제 입실/);
 const admin=record({entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false});
 const both=run({type:'결석'},admin,{deleteEnabled:true});
 assert.deepEqual(both.deleteTimes,['entry','exit']);assert.match(both.warnings.join(),/관리자가 넣은 1교시를 지우면 그것에서 계산된 입실도 비워질 수 있습니다/);assert.doesNotMatch(both.warnings.join(),/실제 입실 기록은 남습니다/);
 // 체크인한 학생이 1교시에 사유를 저장해 ATTEND가 된 기록: 1교시는 지우지 않으므로(확인하지 않은 동작) 결석은 보류, ×로 퇴실만 지울 수 있음
 const resaved=record({entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:true});
 assert.deepEqual(canDeleteTime(resaved,'entry'),{ok:false,reason:'체크인한 학생은 퇴실만 지웁니다(1교시는 관리자 사유를 저장한 기록이라 남깁니다).'});assert.deepEqual(canDeleteTime(resaved,'exit'),{ok:true});
 const held=run({type:'결석'},resaved,{deleteEnabled:true});assert.deepEqual([held.state,held.deleteTimes,held.notes[0]],['hold',[],'체크인한 학생은 퇴실만 지웁니다(1교시는 관리자 사유를 저장한 기록이라 남깁니다).']);
 // 표시가 옛 build 것이라 입실 번호 표시가 없으면 1교시는 잠김
 assert.match(canDeleteTime(record({entryKind:'ATTEND',entryEventId:true,exitEventId:true}),'entry').reason,/1교시 기록 번호를 확인하지 못했습니다/);
 // 체크인했지만 아직 퇴실이 없음: 퇴실을 지우면 비워진다는 안내 대신 지울 칸이 없다고 알림
 const noExit=run({type:'결석'},record({entryKind:'PASS',exit:null,enterEventId:true}),{deleteEnabled:true});
 assert.equal(noExit.notes[0],'퇴실 시간이 아직 없어 지울 수 있는 칸이 없습니다(1교시는 입실에서 계산된 값).');assert.doesNotMatch(noExit.notes[0],/퇴실을 지우면/);
 assert.match(canDeleteTime(record({entryKind:'PASS',exitEventId:true}),'entry').reason,/입실에서 계산된 1교시/,'with an exit the PASS reason stays');
 assert.match(run({type:'결석'},record({entryKind:'PASS',exitEventId:false}),{deleteEnabled:true}).notes[0],/퇴실 기록 번호/);
 assert.deepEqual(canDeleteTime(record({exitEventId:true}),'exit'),{ok:true});
});

test('front conditions: date range, missing or partial record, teacher, schedule, other types',()=>{
 assert.match(sheetToCheckHere({row:{type:'출석'},record:record(),date:'2026-10-23'}).notes[0],/날짜 범위/);
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
 const mine={id:'b2_a',status:'pending',createdBy:'admin@example.com',reason:`[실시간 베타] [2기 베타] ${AUTO_TEXT} · 지각 · x [기준:0123abcd]`};
 const back=run({type:'출석'},record(),{active:[mine]});
 assert.deepEqual([back.state,back.withdraw],['same',['b2_a']],'지각 → 출석 again: withdraw the queued 지각 memo, nothing else to send');
 assert.equal(run({type:'조퇴',outT:'16:00'},record(),{active:[mine]}).withdraw[0],'b2_a');
 assert.equal(run({type:'조퇴',outT:'16:00'},record(),{active:[{...mine,createdBy:'other@example.com'}]}).retryWhen,'request');
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

test('time deletion stays off until rules, relay capability and permissions are all in place',()=>{
 const now=Date.parse('2026-10-14T03:00:00Z'),relay={state:'running',at:now-60000,capabilities:['time-delete-v1']};
 assert.deepEqual(deletionGate({features:{timeDeleteRules:true},relay,now}),{enabled:true,reasons:[]});
 assert.match(deletionGate({relay,now}).reasons.join(),/규칙 게시/);
 assert.match(deletionGate({features:{timeDeleteRules:true},relay:{...relay,capabilities:[]},now}).reasons.join(),/time-delete-v1/);
 assert.match(deletionGate({features:{timeDeleteRules:true},relay:{...relay,at:now-RELAY_STALE_MS-1},now}).reasons.join(),/중계가 꺼져/);
 assert.equal(deletionGate({features:{timeDeleteRules:true},relay,now,denied:true}).enabled,false);
 assert.match(deletionGate({features:{timeDeleteRules:true},relay:{...relay,state:'stopped'},now}).reasons.join(),/중계가 꺼져/,'a recent stop signal is off');
 assert.equal(deletionGate({features:{timeDeleteRules:true},relay:{...relay,at:{seconds:(now-60000)/1000,nanoseconds:0}},now}).enabled,true,'Firestore Timestamp shape');
 assert.equal(deletionGate({features:{timeDeleteRules:true},relay:{...relay,at:{toMillis:()=>now-60000}},now}).enabled,true);
 assert.match(deletionGate({features:{timeDeleteRules:true},relay:{...relay,at:null},now}).reasons.join(),/중계가 꺼져/,'a pending server timestamp');
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
