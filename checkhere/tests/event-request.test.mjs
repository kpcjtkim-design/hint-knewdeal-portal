// 체크히어 수정 방향 변경(2026-10-16, 지시 4장): 형식 기록(4-1), 순차 수정(4-2), 시험(4-3).
// build 20261016.2: 내장 형식(기록 없이도 씀), 켜기(arm) 없음 — 사람의 마스킹 해제가 관문, 헤더는 체크히어 탭 안에서만(우리 코드가 돌려받는 값 없음 — evaluate 결과·연결 프로그램 JSON에 값이 없는지 봄),
// 기본 쓰기 방식은 준비되면 순차 요청, 첫 실행 1건 뒤 「확인했음」 전까지 나머지는 수정창.
// 가상 학생과 가짜 체크히어(tests/checkhere-fake.mjs)·가짜 승인 저장소만 씁니다. 실제 체크히어·Firebase에는 닿지 않습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {CAPABILITIES} from '../server.mjs';
import {prepareApproval} from '../approval-core.mjs';
import {version} from '../identity.mjs';
import {applyVerified,planRequest} from '../writeback.mjs';
import {buildBody,formatFor,formatWith,sendEvent,eventOf,NOT_WIRED,EVENT_REQUEST_CAPABILITY,BUILTIN_FORMAT} from '../event-request.mjs';
import {describeRequest,describeBody,saveFormat,loadFormat,formatFile} from '../format-record.mjs';
import {ADMIN,roster,bridgeWorld} from './checkhere-fake.mjs';

const D1='2026-11-02',TOKEN='fixture-admin';
mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
// 가상 본문 두 개로 형식을 기록해 둡니다(사람이 수정창으로 한 건씩 고친 것과 같은 모양).
const UPDATE={scheduleId:'S0',typeEvent:'ATTEND',attendeeId:'att-x',baseTime:'2026-10-29T09:00:00',existEventId:null,time:'2026-10-29T09:10:00',memoByAdmin:'가상'};
const DELETE={scheduleId:'S0',typeEvent:'COMPLETE',attendeeId:'att-x',baseTime:'2026-10-29T18:00:00',existEventId:'ev-x'};
const recordBoth=dataDir=>{saveFormat(dataDir,describeRequest({method:'PUT',url:ADMIN+'/api/v3/history/event/update',body:UPDATE}));return saveFormat(dataDir,describeRequest({method:'DELETE',url:ADMIN+'/api/v3/history/event/delete',body:DELETE}));};
const world=(port,prefix,options)=>bridgeWorld(port,prefix,options);
// 화면 안 evaluate가 Node로 돌려준 값을 모두 모읍니다(헤더 값이 나오지 않는지 보려고).
const watchEvaluate=page=>{const seen=[],orig=page.evaluate.bind(page);page.evaluate=async(...a)=>{const r=await orig(...a);seen.push(r);return r;};return seen;};

test('event-request: the built-in 2026-10-16 format builds the same bodies as a recorded one; a recorded kind still overrides; delete needs a record number; other addresses are refused',async()=>{
  const entry=roster(D1)[0],format=recordBoth(mkdtempSync(join(import.meta.dirname,'../test-results/format-unit-')));
  assert.throws(()=>buildBody(null,{op:'update'}),{message:NOT_WIRED});
  assert.deepEqual(Object.keys(BUILTIN_FORMAT.kinds).sort(),['delete','update']);
  for(const kind of ['update','delete'])assert.deepEqual([...BUILTIN_FORMAT.kinds[kind].keys].sort(),format.kinds[kind].keys,'the built-in keys are the recorded keys: '+kind);
  const builtin=formatWith(null);
  const out=buildBody(builtin,{op:'update',field:'exit',scheduleId:'S1',attendeeId:'att-na',date:D1,entry,schedule:'09:00 ~ 18:00',time:'17:00:00',memo:''});
  assert.deepEqual(out,{method:'PUT',url:ADMIN+'/api/v3/history/event/update',body:{scheduleId:'S1',typeEvent:'COMPLETE',attendeeId:'att-na',baseTime:D1+'T18:00:00',existEventId:'c2',time:D1+'T17:00:00',memoByAdmin:null}});
  assert.deepEqual(buildBody(format,{op:'update',field:'exit',scheduleId:'S1',attendeeId:'att-na',date:D1,entry,schedule:'09:00 ~ 18:00',time:'17:00:00',memo:''}),out,'a recorded format gives the same body');
  // 1교시: 관리자 ATTEND의 번호, PASS(입실에서 계산)는 번호 없음(null) — 수정창과 같은 본문
  assert.equal(buildBody(builtin,{op:'update',field:'entry',scheduleId:'S1',attendeeId:'att-na',date:D1,entry,time:'09:30:00',memo:'x'}).body.existEventId,'a2');
  assert.equal(buildBody(builtin,{op:'update',field:'entry',scheduleId:'S1',attendeeId:'att-ga',date:D1,entry:roster(D1)[1],time:'09:30:00',memo:'x'}).body.existEventId,null);
  assert.deepEqual(buildBody(builtin,{op:'delete',field:'exit',scheduleId:'S1',attendeeId:'att-na',date:D1,entry}).body,{scheduleId:'S1',typeEvent:'COMPLETE',attendeeId:'att-na',baseTime:D1+'T18:00:00',existEventId:'c2'});
  assert.deepEqual(buildBody(builtin,{op:'delete',field:'entry',scheduleId:'S1',attendeeId:'att-na',date:D1,entry}).body,{scheduleId:'S1',typeEvent:'ATTEND',attendeeId:'att-na',baseTime:D1+'T09:00:00',existEventId:'a2'});
  assert.throws(()=>buildBody(builtin,{op:'delete',field:'entry',scheduleId:'S1',attendeeId:'att-ga',date:D1,entry:roster(D1)[1]}),/기록 번호가 없는 칸/);
  // 기록한 형식의 키가 다르면(체크히어가 본문을 바꿔 사람이 다시 기록) 그 종류는 기록이 우선합니다 — 지금 본문과 다르면 보내지 않음
  const changed=formatWith({...format,kinds:{update:{...format.kinds.update,keys:[...format.kinds.update.keys,'reason']}}});
  assert.throws(()=>buildBody(changed,{op:'update',field:'exit',scheduleId:'S1',attendeeId:'att-na',date:D1,entry,time:'17:00:00'}),/EVENT_REQUEST_FORMAT/);
  assert.doesNotThrow(()=>buildBody(changed,{op:'delete',field:'exit',scheduleId:'S1',attendeeId:'att-na',date:D1,entry}),'the other kind stays built in');
  // 형식 파일의 주소·방식을 바꿔도 다른 곳으로 보내지 않음
  assert.throws(()=>formatFor({kinds:{update:{...format.kinds.update,origin:'https://example.com'}}},'update'),/EVENT_REQUEST_FORMAT/);
  assert.throws(()=>formatFor(formatWith({kinds:{update:{...format.kinds.update,method:'POST'}}}),'update'),/EVENT_REQUEST_FORMAT/);
  await assert.rejects(()=>sendEvent({evaluate:()=>{throw Error('보내면 안 됨');}},{method:'PUT',url:'https://example.com/api/v3/history/event/update',body:{}}),/EVENT_REQUEST_FORMAT/);
  assert.throws(()=>buildBody(builtin,{op:'update',field:'exit',scheduleId:'',attendeeId:'att-na',date:D1,entry,time:'17:00:00'}),/EVENT_REQUEST_TARGET/);
  assert.equal(eventOf(entry,'exit').eventId,'c2');
  // 내장 형식에도 값·헤더가 없습니다(키·방식·주소만)
  const text=JSON.stringify(BUILTIN_FORMAT);for(const v of ['uthorization','privacy','Bearer','att-','2026-10-16T'])assert.ok(!text.includes(v),v);
  // 형식 기록은 값을 남기지 않습니다(키·종류·열거값만)
  const shape=describeBody(UPDATE),shown=JSON.stringify(shape);
  for(const v of ['S0','att-x','2026-10-29','09:10','가상'])assert.ok(!shown.includes(v),v);
  assert.deepEqual(shape.fields.typeEvent,{types:['string'],shapes:['text'],values:['ATTEND']});
  assert.equal(describeRequest({method:'PUT',url:'https://example.com/api/v3/history/event/update',body:UPDATE}),null,'only CheckHere write requests are recorded');
});

test('4-1: format recording keeps only the method, path and body structure of the one edit a person makes; values, headers and tokens are never stored',async()=>{
  const W=await world(18955,'writer-record-');
  try{
    assert.equal((await W.call('record-format/start',{},{origin:'https://portal.example'})).code,403,'only from this PC\'s bridge screen');
    W.w.confirm=true;
    const started=await W.call('record-format/start');assert.equal(started.code,202,JSON.stringify(started.body));
    assert.equal((await W.call('sync',{classId:'2',dates:[D1],mode:'incremental'})).code,409,'nothing moves the tab while a person records');
    // 사람이 그 탭에서 수정창으로 한 건을 고칩니다(가상): 나가상 퇴실. 저장 확인창(정해진 문구)은 기록 중에 받습니다.
    const p=W.s.page;await p.locator('[data-seq="1"][data-f="exit"]').click();await p.locator('#modifyTime').fill('17:40:00');await p.locator('#memoByAdmin').fill('조퇴_담임:가상담임(17:40)');await p.locator('#change').click();
    const job=await W.done(started.body.id);assert.equal(job.status,'complete',job.message);assert.equal(job.op,'update');assert.deepEqual(job.response,{status:200,code:'OK'});
    const text=readFileSync(formatFile(W.dataDir),'utf8'),f=JSON.parse(text).kinds.update;
    assert.deepEqual([f.method,f.origin,f.path],['PUT',ADMIN,'/api/v3/history/event/update']);
    assert.deepEqual(f.keys,['attendeeId','baseTime','existEventId','memoByAdmin','scheduleId','time','typeEvent']);
    assert.deepEqual([f.fields.typeEvent.values,f.fields.time.shapes,f.fields.existEventId.types],[['COMPLETE'],['datetime'],['string']]);
    for(const v of ['att-na','S1','17:40','18:00','조퇴','가상담임','c2',W.w.token,W.w.unmask,W.w.browser,'Bearer','uthorization','privacy','나가상','0002','ookie',D1])assert.ok(!text.includes(v),'no value is stored: '+v);
    assert.deepEqual(readdirSync(join(W.dataDir,'format')),['event-request-format.json']);
    assert.equal(W.w.writes.length,1,'the person\'s own save went through');assert.deepEqual(W.w.privacy,[true],'with the unmask header of that tab');assert.equal(W.c.recording,false);
    assert.deepEqual((await W.state()).requestWriter.recorded,['update'],'the recorded kind is listed next to the built-in format');
    // 기록 중이 아니면 같은 확인창도 닫고, 기록 중에도 연장·종료 같은 다른 창은 닫습니다.
    assert.equal(await p.evaluate(()=>confirm('변경하시겠습니까?')),false);
    W.c.recording=true;assert.deepEqual(await p.evaluate(()=>[confirm('변경하시겠습니까?'),confirm('원문 표시 시간을 연장하시겠습니까?'),confirm('개인정보 원문 표시를 종료하시겠습니까?')]),[true,false,false]);W.c.recording=false;
    // 멈추면 기록 없음, 파일 그대로
    const again=await W.call('record-format/start');await W.call('record-format/stop');const stopped=await W.done(again.body.id);
    assert.equal(stopped.status,'cancelled');assert.equal(readFileSync(formatFile(W.dataDir),'utf8'),text);
    // 가린 화면에서는 시작하지 않습니다(수정창이 열리지 않음)
    W.w.mode='masked';await p.reload();assert.match((await W.call('record-format/start')).body.error,/MASKED_WRITE/);
  }finally{await W.close();}
});

test('4-2: no arm step and no recording needed; the request writer refuses only a masked screen, under 150 s, or a tab whose unmask header it never saw; the preview sends nothing',async()=>{
  const W=await world(18956,'writer-refuse-');
  const a=W.approve('writer-refuse-00001','나가상',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'}),b=W.approve('writer-refuse-00002','다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'});
  const untouched=()=>{assert.equal(W.w.writes.length,0,'nothing was sent');assert.equal(W.fake.calls.claim,0,'nothing was claimed');assert.equal(W.docs.get(a).status,'approved');};
  const request=id=>W.apply(id,{writer:'request'});
  try{
    assert.ok(CAPABILITIES.includes(EVENT_REQUEST_CAPABILITY));
    // 켜기(arm)는 없어졌습니다: 옛 화면이 불러도 상태만 돌려줍니다(이 PC 화면에서만). 기록 없이도 내장 형식 두 종류.
    assert.equal((await W.call('request-writer/arm',{},{origin:'https://portal.example'})).code,403);
    const info=(await W.call('request-writer/arm')).body;assert.deepEqual([info.armed,info.builtin,info.formats.sort(),info.recorded],[true,true,['delete','update'],[]]);
    W.w.mode='masked';await W.s.page.reload();let r=await request(a);assert.equal(r.code,400);assert.match(r.body.error,/MASKED_WRITE: 체크히어 마스킹 해제가 필요합니다/);untouched();
    // 순차 요청 관문에 막힌 것도 해제를 기다리는 쓰기로 셉니다(「마스킹 해제 시작」 사유·중계 수에 보임). 요청은 승인 상태 그대로.
    let st=(await W.state()).masking;assert.equal(st.waitingWrites,1);assert.match(st.reasonPreview,/체크히어 출결 수정 요청 1건 반영/);
    W.w.mode='unmasked';W.w.left='2분 0초';await W.s.page.reload();r=await request(a);assert.match(r.body.error,/MASKED_TIME/);assert.match(r.body.error,/연장/);untouched();
    assert.equal((await W.get('status')).waitingWrites,1,'the same request is counted once');
    r=await W.call('apply-batch',{approvalIds:[a,b],idToken:TOKEN,writer:'request'});assert.match(r.body.error,/MASKED_TIME/);untouched();assert.equal((await W.get('status')).waitingWrites,2,'a refused batch counts each request');
    // 머리말은 '원문 표시 중'인데 그 탭이 해제 헤더를 붙이지 않음(사람이 해제한 세션이 아님): 순차 요청을 시작하지 않습니다(라디오로 다시 읽게 해 봐도 없음).
    W.w.left='9분 30초';W.w.unmask=null;await W.s.page.reload();const loads=W.w.detail.true+W.w.detail.false;
    r=await request(a);assert.match(r.body.error,/EVENT_REQUEST_HEADERS/);untouched();
    assert.ok(W.w.detail.true+W.w.detail.false>loads,'the time-basis radios made the page read again');
    assert.equal(await W.s.page.locator('#rt').isChecked(),true,'the radios are put back to 실제 시간 기반');
    W.w.unmask='fake-unmask-session-0001';await W.s.page.reload();
    // 미리보기: 바꿀 칸만 돌려주고 보내지도 잡지도 않습니다. 번호·이름 값 없음.
    r=await W.call('apply-batch',{approvalIds:[a,b],idToken:TOKEN,writer:'request',preview:true});assert.equal(r.code,200,JSON.stringify(r.body));
    assert.deepEqual(r.body.items.map(x=>x.changes.map(c=>[c.field,c.op,c.typeEvent,c.before.time,c.after.time,c.wired,c.existEvent])),[[['exit','update','COMPLETE','18:00:00','17:00:00',true,true]],[['exit','update','COMPLETE','15:00:00','16:00:00',true,true]]]);
    const shown=JSON.stringify(r.body);for(const v of ['att-','S1','나가상','다가상','c2','c3'])assert.ok(!shown.includes(v),v);
    untouched();
    assert.equal((await W.call('apply',{approvalId:a,idToken:TOKEN,writer:'request',preview:true})).body.items[0].changes.length,1);untouched();
    // 쓰기 방식 이름이 틀리면 거절
    assert.match((await W.call('apply',{approvalId:a,idToken:TOKEN,writer:'fast'})).body.error,/쓰기 방식/);
  }finally{await W.close();}
});

test('4-2: the default writer is the request writer once ready: the body targets the right attendee, the tab\'s own headers send it from inside the page, no header value reaches Node, and after the first item the rest use the editor until 확인했음',async()=>{
  const W=await world(18957,'writer-first-');
  const a=W.approve('writer-first-000001','나가상',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'}),b=W.approve('writer-first-000002','다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'}),c=W.approve('writer-first-000003','가상하나',{exit:'17:30',exitMemo:'조퇴_담임:가상담임(17:30)'});
  const evaluated=watchEvaluate(W.s.page),used={modal:0,request:0},modal=W.c.modal.bind(W.c),requestWrite=W.c.requestWrite.bind(W.c);
  W.c.modal=async(...x)=>{used.modal++;return modal(...x);};W.c.requestWrite=async(...x)=>{used.request++;return requestWrite(...x);};
  try{
    // 쓰기 방식 없이(포털·직접 수정과 같음): 해제된 탭이고 헤더를 보았으니 순차 요청(이 build의 첫 1건)
    let r=await W.apply(a);assert.equal(r.code,202,JSON.stringify(r.body));
    let j=await W.done(a);assert.equal(j.status,'verified',j.message);assert.equal(j.platformSaved,true);assert.equal(j.writer,'request');
    assert.deepEqual(W.w.writes,[{scheduleId:'S1',typeEvent:'COMPLETE',attendeeId:'att-na',baseTime:D1+'T18:00:00',existEventId:'c2',time:D1+'T17:00:00',memoByAdmin:'조퇴_담임:가상담임(17:00)'}]);
    assert.deepEqual([W.w.auth,W.w.privacy],[[true],[true]],'sent with the tab\'s own authorization and unmask headers');
    assert.deepEqual(await W.s.page.evaluate(()=>({...window.clicks})),{cell:0,change:0,remove:0},'no editor, neither to write nor to re-read');
    const saved=W.docs.get(a);assert.equal(saved.status,'verified');assert.equal(saved.result.current.exit,'17:00:00');assert.equal(saved.result.current.attendeeId,undefined,'the attendee number stays on this PC');
    // 화면 안 장치가 Node로 돌려준 값: 있음/없음·상태·code뿐(헤더 값 없음)
    const back=JSON.stringify(evaluated);for(const v of [W.w.token,W.w.unmask,W.w.browser,'Bearer'])assert.ok(!back.includes(v),'no header value reached Node: '+v);
    const sends=evaluated.filter(x=>x&&typeof x==='object'&&'ok' in x);assert.ok(sends.length>=1);for(const x of sends)assert.ok(Object.keys(x).every(k=>['ok','status','code'].includes(k)),JSON.stringify(x));
    for(const text of [JSON.stringify(await W.state()),JSON.stringify(await W.get('status'))])for(const v of [W.w.token,W.w.unmask,W.w.browser])assert.ok(!text.includes(v),'the bridge never holds a header value');
    // 첫 1건이 확인·저장됨: 「확인했음」 전까지 다음 건은 막지 않고 수정창으로(같은 요청 본문, 화면의 '변경')
    let status=await W.get('status');assert.deepEqual(status.requestWriter.firstRun,{unlocked:false,waitingConfirm:true,failedFirst:null});
    r=await W.apply(b,{writer:'request'});assert.equal(r.code,202,JSON.stringify(r.body));j=await W.done(b);
    assert.equal(j.status,'verified',j.message);assert.equal(j.writer,undefined,'the editor wrote it');assert.match(j.writerNote,/첫 순차 수정 1건을 사람이 확인하기 전이라 이 건은 수정창으로/);
    assert.deepEqual(used,{modal:1,request:1},'one editor write after the request-writer item');assert.equal(W.w.writes.length,2);
    assert.equal((await W.call('request-writer/confirm',{},{origin:'https://portal.example'})).code,403);
    assert.equal((await W.call('request-writer/confirm')).body.firstRun.unlocked,true);
    // 확인 뒤에는 다시 순차 요청
    r=await W.apply(c);j=await W.done(c);assert.equal(j.status,'verified',j.message);assert.equal(j.writer,'request');assert.deepEqual(used,{modal:1,request:2});
    // 인증 헤더를 못 본 탭(로그인 세션 없음): 지정한 순차 요청은 잡기 전에 거절(아무것도 보내지 않음), 자동은 수정창으로(그리고 체크히어가 거절)
    W.w.token=null;const d=W.approve('writer-first-000004','나가상',{exitMemo:'조퇴_담임:가상담임(17:01)'});
    r=await W.apply(d,{writer:'request'});assert.equal(r.code,400);assert.match(r.body.error,/EVENT_REQUEST_HEADERS/);assert.equal(W.docs.get(d).status,'approved');assert.equal(W.w.writes.length,3);assert.equal(W.c.guardBroken,false);
  }finally{await W.close();}
});

test('4-2: a batch holds the bridge, spaces items 0.5-1 s and stops at the first mismatch; the rest is not claimed',{timeout:120000},async()=>{
  const W=await world(18958,'writer-batch-',{sendGapMs:[500,1000],itemGapMs:[500,1000]});W.unlock();
  const ids=[W.approve('writer-batch-000001','가상하나',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'}),W.approve('writer-batch-000002','나가상',{exit:'17:10',exitMemo:'조퇴_담임:가상담임(17:10)'}),W.approve('writer-batch-000003','다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'})];
  try{
    W.w.skewFor='att-na';// 가짜 체크히어가 이 학생만 다른 시간으로 저장(다시 읽으면 불일치)
    const r=await W.call('apply-batch',{approvalIds:ids,idToken:TOKEN,writer:'request'});assert.equal(r.code,202,JSON.stringify(r.body));
    assert.equal((await W.call('sync',{classId:'2',dates:[D1],mode:'incremental'})).code,409,'no collection moves the tab between items');
    const b=await W.done(r.body.id);
    assert.equal(b.status,'partial',b.message);assert.equal(b.done,2);assert.deepEqual(b.items.map(x=>[x.status,x.classId,x.date,x.writer]),[['verified','2',D1,'request'],['failed','2',D1,'request']]);
    assert.equal(b.stoppedAt.approvalId,ids[1]);assert.match(b.message,/2\/3건 완료 후 멈춤/);
    assert.equal(W.docs.get(ids[2]).status,'approved','the third request is not claimed');assert.equal(W.w.writes.length,2);
    assert.ok(W.w.writeAt[1]-W.w.writeAt[0]>=500,'items are spaced');
    for(const v of ['가상하나','나가상','다가상','att-'])assert.ok(!JSON.stringify(b).includes(v),'no names in the batch job: '+v);
  }finally{await W.close();}
});

test('4-2: before 확인했음 a batch sends only its first item with the request writer; the rest go through the editor and are not blocked',{timeout:120000},async()=>{
  const W=await world(18960,'writer-batch-first-');
  const ids=[W.approve('writer-bfirst-000001','가상하나',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'}),W.approve('writer-bfirst-000002','나가상',{exit:'17:10',exitMemo:'조퇴_담임:가상담임(17:10)'}),W.approve('writer-bfirst-000003','다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'})];
  try{
    const r=await W.call('apply-batch',{approvalIds:ids,idToken:TOKEN});assert.equal(r.code,202,JSON.stringify(r.body));
    const b=await W.done(r.body.id);assert.equal(b.status,'complete',b.message);
    assert.deepEqual(b.items.map(x=>[x.status,x.writer]),[['verified','request'],['verified','editor'],['verified','editor']]);
    assert.equal(W.w.writes.length,3);assert.deepEqual(W.w.privacy,[true,true,true]);
    assert.equal((await W.get('status')).requestWriter.firstRun.waitingConfirm,true);
  }finally{await W.close();}
});

test('4-2: a first request-writer item that sent but did not end verified still uses the one first-run turn; the next items go through the editor until a person presses 확인했음, which allows one more try',async()=>{
  const W=await world(18963,'writer-first-fail-');
  const ids=['writer-ffail-000001','writer-ffail-000002','writer-ffail-000003','writer-ffail-000004'];
  W.approve(ids[0],'다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'});W.approve(ids[1],'가상하나',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'});
  W.approve(ids[2],'나가상',{exitMemo:'조퇴_담임:가상담임(18:00)'});W.approve(ids[3],'다가상',{exit:'15:30',exitMemo:'조퇴_담임:가상담임(15:30)'});
  const used={modal:0,request:0},modal=W.c.modal.bind(W.c),requestWrite=W.c.requestWrite.bind(W.c);
  W.c.modal=async(...x)=>{used.modal++;return modal(...x);};W.c.requestWrite=async(...x)=>{used.request++;return requestWrite(...x);};
  try{
    // 첫 1건: 체크히어가 받지 않음(500) — 보냈지만 확인되지 않음
    W.w.reject=500;await W.apply(ids[0]);let j=await W.done(ids[0]);assert.equal(j.status,'failed',j.message);assert.equal(j.writer,'request');W.w.reject=0;
    let fr=(await W.get('status')).requestWriter.firstRun;assert.deepEqual(fr,{unlocked:false,waitingConfirm:false,failedFirst:'failed'});
    // 다음 건은 같은 순차 요청으로 되풀이하지 않고 수정창으로(막지 않음)
    await W.apply(ids[1]);j=await W.done(ids[1]);assert.equal(j.status,'verified',j.message);assert.equal(j.writer,undefined);assert.match(j.writerNote,/첫 순차 수정 1건/);
    assert.deepEqual(used,{modal:1,request:1});
    // 사람이 원본을 보고 「확인했음」: 켜지지는 않고 다음 1건만 다시 순차 요청
    fr=(await W.call('request-writer/confirm')).body.firstRun;assert.deepEqual(fr,{unlocked:false,waitingConfirm:false,failedFirst:null});
    await W.apply(ids[2]);j=await W.done(ids[2]);assert.equal(j.status,'verified',j.message);assert.equal(j.writer,'request');assert.deepEqual(used,{modal:1,request:2});
    assert.equal((await W.get('status')).requestWriter.firstRun.waitingConfirm,true);
    assert.equal((await W.call('request-writer/confirm')).body.firstRun.unlocked,true);
    await W.apply(ids[3]);j=await W.done(ids[3]);assert.equal(j.writer,'request');assert.deepEqual(used,{modal:1,request:3});
  }finally{await W.close();}
});

test('4-2: an unclear send is read again before anything else: a write that landed is verified, and a retry of the same change sends nothing',async()=>{
  const W=await world(18959,'writer-retry-');W.unlock();
  try{
    W.w.applyThenFail=true;// 체크히어는 저장했지만 응답이 오류
    const a=W.approve('writer-retry-000001','가상하나',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'});
    await W.apply(a,{writer:'request'});let j=await W.done(a);
    assert.equal(j.status,'verified',j.message);assert.match(j.results[0].error,/EVENT_REQUEST_FAILED/);assert.equal(W.w.writes.length,1);
    // 같은 변경을 다시 요청: 먼저 읽어 이미 반영됨을 확인하고 보내지 않습니다(사유 중복 없음)
    const again=W.approve('writer-retry-000002','가상하나',{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'});
    await W.apply(again,{writer:'request'});j=await W.done(again);assert.equal(j.status,'verified');assert.equal(j.alreadyApplied,true);assert.equal(W.w.writes.length,1);
    // 미리보기도 이미 같은 값이면 바꿀 칸이 없습니다
    W.docs.get(again).status='approved';assert.deepEqual(planRequest(W.c,W.docs.get(again),W.record('가상하나'),[],formatWith(loadFormat(W.dataDir))),[]);
    // 같은 건이 순차 요청으로 실패해도 수정창으로 저절로 다시 쓰지 않습니다(작업이 남아 다시 보내지 않음)
    W.w.reject=500;const bad=W.approve('writer-retry-000003','다가상',{exit:'16:00',exitMemo:'조퇴_담임:가상담임(16:00)'});
    await W.apply(bad,{writer:'request'});j=await W.done(bad);assert.equal(j.status,'failed');const sent=W.w.writes.length;
    const twice=await W.apply(bad);assert.equal(twice.body.status,'failed','the same job is returned');assert.equal(W.w.writes.length,sent);assert.equal(await W.s.page.evaluate(()=>window.clicks.change),0);
  }finally{await W.close();}
});

test('4-2: updating an occupied 1st period or exit sends that cell\'s current record number; the fake refuses a null number on an occupied cell (it would be a second record)',async()=>{
  const W=await world(18964,'writer-exist-');W.unlock();
  try{
    const a=W.approve('writer-exist-000001','나가상',{entry:'09:30',entryMemo:'지각_담임:가상담임(09:30)'});
    await W.apply(a,{writer:'request'});const j=await W.done(a);assert.equal(j.status,'verified',j.message);assert.equal(j.writer,'request');
    assert.deepEqual(W.w.writes.map(b=>[b.typeEvent,b.existEventId,b.time]),[['ATTEND','a2',D1+'T09:30:00']]);
    // 번호 있는 퇴실 칸에 existEventId:null(새로 넣기)은 받지 않고 바뀌는 것이 없습니다
    const r=await sendEvent(W.s.page,{method:'PUT',url:ADMIN+'/api/v3/history/event/update',body:{scheduleId:'S1',typeEvent:'COMPLETE',attendeeId:'att-ga',baseTime:D1+'T18:00:00',existEventId:null,time:D1+'T17:00:00',memoByAdmin:null}});
    assert.deepEqual(r,{ok:false,status:409,code:'EXIST_EVENT_REQUIRED'});
    assert.deepEqual(W.w.days.S1.students.find(x=>x.attendeeId==='att-ga').eventList.filter(e=>e.type==='COMPLETE').map(e=>[e.eventId,e.time]),[['c1',D1+'T17:50:08']],'still one exit record, unchanged');
  }finally{await W.close();}
});

test('writeback: a write that cannot be read back on a masked screen ends as unknown, not failed (a plain unreadable re-read is still failed)',async()=>{
  const record={classId:'2',date:D1,name:'가상하나',studentKey:'k1',phoneLast4:'0001',teacher:'가상담임',schedule:'09:00 ~ 18:00',rawEntry:'08:55:31',entry:'08:55:31',exit:'17:50:08',entryMemo:'',exitMemo:'',outings:[],outingCount:0,source:'live',readState:'complete',collectedAt:new Date().toISOString()};
  record.id=`2_${D1}_k1`;record.version=version(record);
  const request={classId:'2',date:D1,name:'가상하나',phoneLast4:'0001',reason:'가상 사유',changes:{exit:'17:00',exitMemo:'조퇴_담임:가상담임(17:00)'},status:'approved'};
  const live=prepareApproval(request,record,{allowAlreadyApplied:true});request.approval=live;
  for(const [view,want] of [['masked','unknown'],['plain','failed']]){
    let reads=0;const adapter={view:'plain',writeBlocked:()=>null,read:async()=>++reads===1?structuredClone(record):{...structuredClone(record),readState:'partial'},write:async()=>{adapter.view=view;return {time:'17:00:00',memo:'조퇴_담임:가상담임(17:00)'};}};
    const out=await applyVerified(adapter,record,{id:record.id,version:record.version,...live.after,reason:live.reason},async()=>{},request,[],{writer:{kind:'request',format:null}});
    assert.equal(out.status,want,view);assert.equal(out.results[0].state,want);if(want==='unknown')assert.match(out.results[0].error,/가린 화면/);
  }
});

test('the relay and the portal never name the request writer; the bridge picks it when ready',()=>{
  for(const f of ['checkhere-live-relay.mjs','checkhere-live.mjs','beta2-checkhere-sync.mjs','checkhere-requests.mjs'])assert.ok(!/writer\s*:\s*['"]request/.test(readFileSync(join(import.meta.dirname,'../..',f),'utf8')),f);
});
