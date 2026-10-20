// 체크히어 개인정보 가림(마스킹) 화면: 가상 학생만, 가짜 체크히어(브라우저 안 경로 가로채기)만 씁니다. 실제 체크히어·Firebase에 닿지 않습니다.
// Cowork 확인(2026-10-15) 모양: 가린 화면은 표와 화면 데이터 모두 '첫 글자+**'·'010-****-끝4자리', 학번은 '*'만, isRealTime/false만 받음,
// attendeeId는 날짜가 달라도 같음, 표 순번 = JSON sequence(표는 이름순), 가린 화면은 수정창이 열리지 않음(안내 문구만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadPlaywright,CheckHereCollector,acceptsDialog} from '../collector.mjs';
import {createBridge,CAPABILITIES} from '../server.mjs';
import {createLinkStore} from '../links.mjs';
import {MASKED,rowKind,detectView,parseRemaining,nameFits,alignRows,unmaskReason,last4Of,isMaskedError,waitsForUnmask,resolveMasked,linkPairs} from '../masking.mjs';
import {cleanRequest,APPROVER,prepareApproval} from '../approval-core.mjs';
import {buildLiveRequest} from '../../checkhere-live-core.mjs';
import {maskedFailure,stuckFailure} from '../../checkhere-live-relay.mjs';
import {readRequestRecord} from '../request-record.mjs';
import {DELETE_MARKS} from '../day-data.mjs';
import {createCurrentSaver} from '../../checkhere-current-core.mjs';

const DAY0='2026-12-15',DAY='2026-12-16',DAY2='2026-12-17';
const iso=(d,t)=>`${d}T${t}`;
const ev=(d,type,t,eventId,memo=null)=>({eventId,userId:'u-'+type,time:iso(d,t),baseTime:iso(d,type==='COMPLETE'?'18:00:00':'09:00:00'),timeIndex:0,type,isRecognized:false,status:'NORMAL',memoByAdmin:memo,updatedAt:null});
// 가상 학생(이름·번호 모두 가짜). sequence는 이름 순서와 다르게 둡니다(표는 이름순, 데이터는 순번순).
function roster(d,{extra=[],without=[]}={}){
  const base=[
    {attendeeId:'att-da',name:'다가상',phone:'01000000003',eventList:[ev(d,'ENTER','08:59:00','e3'),ev(d,'PASS','08:59:00',null),ev(d,'COMPLETE','15:00:00','c3','조퇴_담임:가상담임(15:00)')],pairs:[{start:'13:00:00',end:'13:40:00',ok:false}]},
    {attendeeId:'att-ga',name:'가상하나',phone:'01000000001',eventList:[ev(d,'ENTER','08:55:31','e1'),ev(d,'PASS','08:55:31',null),ev(d,'COMPLETE','17:50:08','c1')]},
    {attendeeId:'att-ra',name:'라가상',phone:'01000000004',eventList:[]},
    {attendeeId:'att-na',name:'나가상',phone:'01000000002',eventList:[ev(d,'ENTER','09:20:00',null),ev(d,'ATTEND','09:20:00','a2','지각_담임:가상담임(09:20)'),ev(d,'COMPLETE','18:00:00','c2')]},
    ...extra,
  ].filter(s=>!without.includes(s.name));
  return base.map((s,i)=>({sequence:i+1,attendeeId:s.attendeeId,typeAttendee:'STUDENT',name:s.name,userName:s.name,phone:s.phone,identifier:'가상과정',duration:'PT9H',seconds:32400,
    eventList:s.eventList,leaveEvents:{totalLeavedDuration:'PT0S',totalLeavedSeconds:0,pairs:(s.pairs||[]).map(p=>({leaveEventId:'l',isRecognized:p.ok,startTime:iso(d,p.start),judgedEndTime:iso(d,p.end),endTimeOrNull:iso(d,p.end),duration:'',seconds:0}))}}));
}
const DUP={attendeeId:'att-gn',name:'가상하늘',phone:'01099990001',eventList:[]};// 가상하나와 첫 글자·끝 4자리가 같음
const NEW={attendeeId:'att-ba',name:'바새로',phone:'01000000006',eventList:[]};
const LEFT={attendeeId:'att-ma',name:'마가상',phone:'01000000005',eventList:[]};// 나간 학생
const COMER={attendeeId:'att-mz',name:'마새롬',phone:'01055550005',eventList:[]};// 같은 첫 글자·끝 4자리로 새로 온 학생
const maskName=n=>n[0]+'**',maskPhone=p=>'010-****-'+p.slice(-4),showPhone=p=>`${p.slice(0,3)}-${p.slice(3,7)}-${p.slice(7)}`;
const urlOf=(sid,date)=>`https://check.ihereapp.com/history/lecture/modify?tab=STUDENT&academyId=A&lectureId=L&scheduleId=${sid}&scheduleDate=${date}`;

// 가짜 체크히어 출결상세(화면 안에서 돌아가는 부분). 모양: 머리말(해제 버튼 또는 원문 표시 중 타이머), 표 두 개, 수정창(가린 화면에서는 열리지 않음),
// '개인정보 마스킹 해제' 창(사유 칸 → 인증번호 발송 → 6자리 칸 → 확인). 요청은 같은 주소의 /api/v3/…로 보냅니다.
function fakeApp(cfg){
  const $=s=>document.querySelector(s),sid=new URLSearchParams(location.search).get('scheduleId');
  window.clicks={cell:0,maskedCell:0,change:0,unmask:0,send:0,confirm:0,extend:0,end:0};let data=[];
  const hms=v=>v?String(v).slice(11,19):'-',of=(s,t)=>s.eventList.find(e=>t.includes(e.type));
  const shown=s=>cfg.mode==='masked'||(cfg.mode==='mixed'&&s.sequence!==1)?{name:s.name,phone:s.phone}:cfg.plain[s.sequence];
  const toast=t=>{$('#toast').textContent=t;};window.closeModal=()=>{$('#m').innerHTML='';};
  async function load(rt){const r=await fetch('/api/v3/history/attendee/detail/academy/A/schedule/'+sid+'/type/STUDENT/isRealTime/'+rt);if(!r.ok)return;let j;try{j=await r.json();}catch{return;}data=j.data.eventResultList;draw();}
  function draw(){
    const rows=data.map(s=>({s,v:shown(s)})).sort((a,b)=>a.v.name.localeCompare(b.v.name));
    $('#t').innerHTML='<table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td><td>메모</td></tr>'+rows.map(({s,v})=>'<tr><td></td><td>'+s.sequence+'</td><td>'+v.name+'</td><td>'+v.phone+'</td><td>'+s.identifier+'</td></tr>').join('')+'<tr><td>출석인원</td></tr></table>'
      +'<table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr>'+rows.map(({s})=>'<tr><td>'+hms(of(s,['ENTER'])?.time)+'</td><td data-seq="'+s.sequence+'" data-f="entry">'+hms(of(s,['ATTEND','PASS'])?.time)+'</td><td data-seq="'+s.sequence+'" data-f="exit">'+hms(of(s,['COMPLETE'])?.time)+'</td><td data-out="'+s.sequence+'">'+(s.leaveEvents.pairs.length?'40분 ('+s.leaveEvents.pairs.length+')':'0분 (-)')+'</td><td>8시간</td></tr>').join('')+'<tr><td>합계</td></tr></table>';
    document.querySelectorAll('[data-f]').forEach(td=>td.onclick=()=>edit(+td.dataset.seq,td.dataset.f));
    document.querySelectorAll('[data-out]').forEach(td=>td.onclick=()=>out(+td.dataset.out));
  }
  function edit(seq,f){
    clicks.cell++;if(cfg.mode==='masked'){clicks.maskedCell++;toast('출석 시간을 수정하려면 개인정보 마스킹을 해제해 주세요.');return;}
    const s=data.find(x=>x.sequence===seq),e=of(s,f==='exit'?['COMPLETE']:['ATTEND','PASS']),p=shown(s);
    $('#m').innerHTML='<div class="react-draggable"><p>'+(f==='entry'?'1교시':'퇴실')+' 시간 수정</p><input id="name" disabled value="'+p.name+'"><input id="prevTime" disabled value="'+hms(e?.time)+'"><input id="modifyTime" value="'+(e?hms(e.time):'00:00:00')+'"><input id="memoByAdmin" value="'+(e?.memoByAdmin??'')+'"><button id="change">변경</button><button onclick="closeModal()">취소</button></div>';
    $('#change').onclick=async()=>{
      clicks.change++;if(cfg.silent){closeModal();await load(false);return;}const body={scheduleId:sid,typeEvent:f==='exit'?'COMPLETE':'ATTEND',attendeeId:cfg.tamper||s.attendeeId,baseTime:e?.baseTime??null,existEventId:e?.eventId??null,time:cfg.date+'T'+$('#modifyTime').value,memoByAdmin:$('#memoByAdmin').value||null};
      try{const r=await fetch(cfg.api+'/api/v3/history/event/update',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('x');closeModal();await load(false);}catch{toast('저장하지 못했습니다.');}
    };
  }
  function out(seq){
    if(cfg.mode==='masked')return;const s=data.find(x=>x.sequence===seq);
    $('#m').innerHTML='<p>'+shown(s).name+' 님의 외출 시간 확인</p><table><tr><td></td><td>시작</td><td>종료</td><td>외출 종료 판단 기준</td><td>인정</td></tr>'+s.leaveEvents.pairs.map((p,j)=>'<tr><td>'+(j+1)+'</td><td>'+hms(p.startTime)+'</td><td>'+hms(p.endTimeOrNull)+'</td><td>'+hms(p.judgedEndTime)+'</td><td>'+(p.isRecognized?'O':'X')+'</td></tr>').join('')+'</table><button onclick="closeModal()">취소</button>';
  }
  function header(){
    if(cfg.mode==='masked'){
      $('#hd').innerHTML='<span>관리자</span><button id="unmask">개인정보 마스킹 해제</button>';
      $('#unmask').onclick=()=>{
        clicks.unmask++;$('#m').innerHTML='<div role="dialog"><h3>개인정보 마스킹 해제</h3><label for="why">개인정보 마스킹 해제 사유</label><textarea id="why"></textarea><button id="send">인증번호 발송</button><div id="codeBox"></div><button onclick="closeModal()">취소</button></div>';
        $('#send').onclick=()=>{
          if($('#why').value.trim().length<10)return toast('사유를 10자 이상 입력해 주세요.');
          clicks.send++;window.unmaskReason=$('#why').value;$('#codeBox').innerHTML='<input id="code" maxlength="6" placeholder="인증번호 6자리"><button id="ok">확인</button>';
          $('#ok').onclick=async()=>{clicks.confirm++;window.typedCode=$('#code').value;if($('#code').value!=='123456')return toast('인증번호가 다릅니다.');await fetch('/fake/unmask',{method:'POST'});location.reload();};
        };
      };
    }else if(cfg.mode==='unmasked'){
      $('#hd').innerHTML='<span>개인정보 원문 표시 중 '+cfg.left+'</span><button id="ext">연장</button><button id="end">종료</button>';
      $('#ext').onclick=()=>clicks.extend++;$('#end').onclick=()=>clicks.end++;
    }
  }
  header();$('#rt').onclick=()=>{if(cfg.mode!=='masked')load(true);};
  // inline: 표는 그리지만 연결 프로그램이 데이터 응답을 받지 못한 경우를 흉내 냅니다.
  if(cfg.inline){data=cfg.inline;draw();}else load(false);
}
// 가짜 체크히어 하나: 일정(scheduleId)마다 날짜·학생, 화면 모드('masked'|'unmasked'|'legacy'|'mixed'), 받은 변경 요청.
async function site(days,{mode='masked'}={}){
  const w={mode,days,writes:[],left:'9분 30초',tamper:null,noData:false,plainJson:false,silent:false};
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext();
  // 다른 주소는 모두 막습니다(실제 체크히어·외부에 닿지 않게). 뒤에 건 경로가 먼저 돕니다.
  // 화면 이동으로 이미 끝난 요청에 답하면 Playwright가 'Route is already handled'를 냅니다(시험 장치의 경합, 무시).
  const quiet=f=>route=>f(route).catch(()=>{});
  await context.route('**/*',r=>r.abort().catch(()=>{}));
  // 실제처럼 변경 요청은 다른 주소(가짜 admin-api)로 갑니다(연결 프로그램의 요청 확인이 다른 주소의 PUT도 보는지).
  const ADMIN='https://checkhere-admin-api.ihereapp.com',CORS={'access-control-allow-origin':'https://check.ihereapp.com','access-control-allow-methods':'PUT, DELETE','access-control-allow-headers':'content-type'};
  await context.route(ADMIN+'/**',quiet(async route=>{
    const req=route.request(),u=new URL(req.url());
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:CORS});
    if(!/\/history\/event\/(update|delete)$/.test(u.pathname))return route.fulfill({status:404,headers:CORS,body:'{}'});
    const body=JSON.parse(req.postData()||'{}');w.writes.push(body);
    const s=Object.values(w.days).flatMap(d=>d.students).find(x=>x.attendeeId===body.attendeeId),e=s?.eventList.find(x=>body.typeEvent==='COMPLETE'?x.type==='COMPLETE':['ATTEND','PASS'].includes(x.type));
    if(e){e.time=body.time;e.memoByAdmin=body.memoByAdmin;if(e.type==='PASS'){e.type='ATTEND';e.eventId='new';}}
    return route.fulfill({contentType:'application/json',headers:CORS,body:'{"code":"OK"}'});
  }));
  await context.route('https://check.ihereapp.com/**',quiet(async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/fake/unmask'){w.mode='unmasked';return route.fulfill({status:204});}
    const shownList=sid=>{const plain=w.mode==='legacy'||(w.mode==='unmasked'&&w.plainJson);return (w.days[sid]?.students||[]).map(s=>({...s,...(plain?{}:{name:maskName(s.name),userName:maskName(s.name),phone:maskPhone(s.phone),identifier:'*'})}));};
    const m=/\/schedule\/([^/]+)\/type\/STUDENT\/isRealTime\/(true|false)$/.exec(u.pathname);
    if(m)return route.fulfill({contentType:'application/json',body:JSON.stringify({code:'OK',data:{eventResultList:shownList(m[1])}})});
    if(u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
    const sid=u.searchParams.get('scheduleId'),day=w.days[sid]||Object.values(w.days)[0];
    const cfg={api:ADMIN,mode:w.mode,left:w.left,tamper:w.tamper,silent:w.silent,date:day.date,plain:Object.fromEntries(day.students.map(s=>[s.sequence,{name:s.name,phone:showPhone(s.phone)}])),...(w.noData?{inline:shownList(sid)}:{})};
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><a href="/account/admin">관리자</a><header id="hd"></header><h2>[2반] 가상강의 (가상담임) | ${day.date} 출석부</h2><button id="rt">실제 시간 기반</button><button>초</button><button>표시</button><div id="t"></div><div id="m"></div><div id="toast"></div><script>(${fakeApp.toString()})(${JSON.stringify(cfg)})</script>`});
  }));
  const page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(urlOf(Object.keys(days)[0],Object.values(days)[0].date));
  return {w,browser,page,close:()=>browser.close()};
}
// 기록 비교에 쓰는 항목(줄 번호·읽은 시각은 화면 모드마다 다를 수 있음)
const same=r=>({id:r.id,studentKey:r.studentKey,name:r.name,phoneLast4:r.phoneLast4,teacher:r.teacher,schedule:r.schedule,rawEntry:r.rawEntry,entry:r.entry,exit:r.exit,entryMemo:r.entryMemo,exitMemo:r.exitMemo,outings:r.outings,outingCount:r.outingCount,readState:r.readState,version:r.version,tableSignature:r.tableSignature,...Object.fromEntries(DELETE_MARKS.map(k=>[k,r[k]]))});
// 이 가짜 체크히어의 반·날짜 주소를 미리 알려 둔 수집기(강의 목록을 찾지 않음)
function collector(s,links){const c=new CheckHereCollector('',{page:s.page,links});for(const [sid,d] of Object.entries(s.w.days))c.urls.set('2|'+d.date,urlOf(sid,d.date));return c;}
async function collect(c,classId,date){const out=[],views=[];await c.collect(classId,[date],async r=>{out.push(r);},async()=>{},{pageData:true,onView:v=>views.push(v)});return {records:out,view:views[0]};}
const store=(records)=>createLinkStore(new DatabaseSync(':memory:'),{records:()=>records});
const NAMES=['다가상','가상하나','라가상','나가상','가상하늘','바새로','마가상','마새롬','01000000','0001','0002','0003','0004','0005','0006'];

// ---- 순수 함수 ----
test('view detection, remaining time, name fit and alignment follow the Cowork shapes',()=>{
  assert.equal(rowKind('가**','010-****-0001'),'masked');assert.equal(rowKind('가상하나','010-0000-0001'),'plain');
  assert.equal(rowKind('남궁*','010-****-1234'),'masked','a two-syllable prefix is still masked');assert.equal(rowKind('A*** B***','010-****-1234'),'masked');
  assert.equal(rowKind('가상하나','010-****-0001'),'odd');assert.equal(rowKind('가**',''),'odd');
  assert.equal(detectView(['masked','masked','odd'],'masked'),'masked','one odd row does not stop the day');
  assert.equal(detectView(['masked','plain'],'none'),'mixed');assert.equal(detectView(['masked'],'unmasked'),'mixed');assert.equal(detectView(['plain'],'masked'),'mixed');
  assert.equal(detectView(['plain','plain'],'unmasked'),'plain');assert.equal(detectView(['plain'],'none'),'plain');
  assert.deepEqual([detectView(['plain'],'both'),detectView(['masked'],'both'),detectView(['masked','plain'],'both')],['plain','masked','mixed'],'an ambiguous header leaves reading to the table');
  assert.equal(parseRemaining('개인정보 원문 표시 중 9분 5초 연장 종료'),545);assert.equal(parseRemaining('개인정보 원문 표시 중45초'),45);assert.equal(parseRemaining('가림'),null);assert.equal(parseRemaining('개인정보 원문 표시 중 09:30'),570);
  assert.equal(last4Of('010-****-0001'),'0001');assert.equal(last4Of('0001-****'),'','the last four are read only at the end');
  assert.equal(nameFits('가**','가상하나'),true);assert.equal(nameFits('나**','가상하나'),false);assert.equal(nameFits('가*','가***'),true,'the star count is not used');assert.equal(nameFits('가상하나','가상하늘'),false);
  const list=[{sequence:2,name:'나**',phone:'010-****-0002'},{sequence:1,name:'가**',phone:'010-****-0001'}];
  assert.deepEqual(alignRows([{seq:'1',name:'가**',phone:'010-****-0001'},{seq:'2',name:'나**',phone:'010-****-0002'}],list).map(s=>s.sequence),[1,2]);
  assert.throws(()=>alignRows([{seq:'1',name:'나**',phone:'010-****-0002'},{seq:'2',name:'가**',phone:'010-****-0001'}],list),/MASKED_ALIGN/);
  assert.throws(()=>alignRows([{seq:'1',name:'가**',phone:'010-****-0001'}],list),/MASKED_ALIGN/,'a different student count');
  assert.equal(unmaskReason({writes:0,unlinked:0}),null,'no waiting work, no unmask');
  for(const r of [unmaskReason({writes:2}),unmaskReason({unlinked:1}),unmaskReason({writes:1,unlinked:3})])assert.ok(r.length>=10&&/연결 프로그램/.test(r),r);
  // 승인 전 요청이 섞이면 그렇게 적고, '승인된'이라고 쓰지 않습니다(검토: 사유가 실제 할 일과 같아야 함)
  assert.equal(unmaskReason({writes:2}),'체크히어 출결 수정 요청 2건 반영(연결 프로그램)');
  assert.equal(unmaskReason({writes:3,pending:1,unlinked:2}),'체크히어 출결 수정 요청 3건 반영(승인 대기 1건 포함)·학생 연결 확인 2명 수집(연결 프로그램)');
  assert.equal(unmaskReason({unlinked:1}),'체크히어 학생 연결 확인 1명 수집(연결 프로그램)');
  for(const r of [unmaskReason({writes:1,pending:1}),unmaskReason({writes:2,pending:5})])assert.ok(!r.includes('승인된'),r);
  for(const m of Object.values(MASKED)){assert.ok(isMaskedError(m));for(const n of NAMES)assert.ok(!m.includes(n),'messages carry no names or digits');}
  // 글에 할 일과 장소가 있습니다. 해제로 풀리지 않는 것은 해제 대기로 세지 않습니다.
  for(const m of [MASKED.WRITE,MASKED.UNLINKED,MASKED.READ])assert.match(m,/127\.0\.0\.1:8765.*「마스킹 해제 시작」/);
  assert.match(MASKED.NODATA,/잠시 뒤 다시 수집/);assert.match(MASKED.MIXED,/다시 수집/);assert.match(MASKED.ALIGN,/담당자/);
  assert.deepEqual([MASKED.WRITE,MASKED.TIME,MASKED.UNLINKED,MASKED.AMBIGUOUS,MASKED.CONFLICT,MASKED.GUARD,MASKED.UNMASKING].map(waitsForUnmask),[true,true,true,false,false,false,true]);
  assert.deepEqual([MASKED.AMBIGUOUS,MASKED.CONFLICT,MASKED.GUARD,MASKED.UNLINKED].map(m=>[maskedFailure(Error(m)),stuckFailure(Error(m))]),[[false,false],[false,true],[false,true],[true,false]],'the relay counts an ambiguous pair, waits on a conflict without counting it, and only unmask-related errors are needs-unmask');
  assert.equal(maskedFailure(Object.assign(Error('x'),{code:'MASKED_AMBIGUOUS'})),false);
  // 원문 기록(전화 없이 phoneLast4만)도 첫 글자·끝 4자리가 같으면 그날 배우지 않습니다(화면 데이터가 원문이고 전체 키가 같을 때만)
  const recs=[{name:'가상하나',phoneLast4:'0001',studentKey:'k1'},{name:'가상하늘',phoneLast4:'0001',studentKey:'k2'},{name:'나가상',phoneLast4:'0002',studentKey:'k3'}];
  const masked=[{attendeeId:'a1',name:'가**',phone:'010-****-0001'},{attendeeId:'a2',name:'가**',phone:'010-****-0001'},{attendeeId:'a3',name:'나**',phone:'010-****-0002'}];
  assert.deepEqual(linkPairs(recs,masked,()=>null).map(p=>p.studentKey),['k3']);
  assert.deepEqual(linkPairs(recs,[{attendeeId:'a1',name:'가상하나',phone:'01000000001'},{attendeeId:'a2',name:'가상하늘',phone:'01099990001'},masked[2]],(n,p)=>({가상하나:'k1',가상하늘:'k2'})[n]).map(p=>p.studentKey),['k1','k2','k3']);
});
test('the dialog handler accepts only the save confirm while saving; never extend, end or unmask texts',()=>{
  assert.equal(acceptsDialog(true,'confirm','변경하시겠습니까?'),true);assert.equal(acceptsDialog(true,'confirm','출석 시간을 수정하시겠습니까?'),true);
  assert.equal(acceptsDialog(false,'confirm','변경하시겠습니까?'),false,'not outside the write phase');
  assert.equal(acceptsDialog(true,'alert','변경하시겠습니까?'),false);
  for(const text of ['원문 표시 시간을 연장하시겠습니까?','개인정보 원문 표시를 종료하시겠습니까?','개인정보 마스킹을 해제하시겠습니까?','삭제하시겠습니까?','확인','저장되었습니다'])assert.equal(acceptsDialog(true,'confirm',text),false,text);
});
test('masked strings never become stored names: the bridge put, the platform saver and request cleaning refuse them',async()=>{
  assert.throws(()=>cleanRequest({classId:'2',date:DAY,name:'가**',reason:'가상',changes:{entryMemo:'x'}}),/가린 글자/);
  assert.doesNotThrow(()=>cleanRequest({classId:'2',date:DAY,name:'가상하나',reason:'가상',changes:{entryMemo:'x'}}));
  const r={id:'2_x',classId:'2',date:DAY,name:'가**',studentKey:'k',version:'v',collectedAt:new Date().toISOString(),source:'live'};
  const saver=createCurrentSaver({read:async()=>null,readLegacy:async()=>[],commit:async()=>{throw Error('저장하면 안 됨');}});
  await assert.rejects(()=>saver([r],{id:'j'}),/가린 글자/);await assert.rejects(()=>saver([{...r,name:'가상하나',teacher:'가**'}],{id:'j'}),/가린 글자/);
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/masked-put-')),collector:{loggedIn:async()=>true,requireLogin:async()=>{}},port:18983,approvalCloud:{}});
  try{assert.throws(()=>app.put({...r,name:'가**'}),/MASKED_STORE/);assert.throws(()=>app.put({...r,name:'가상하나',phoneLast4:'**01'}),/MASKED_STORE/);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n,0);
    assert.ok(CAPABILITIES.includes('masked-identity-v1'));}finally{app.close();}
});

// ---- 가짜 체크히어로 읽기 ----
test('a masked day read through linked attendee ids gives the same records as a plain read; no editor is opened',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'}),stored=[];
  try{
    const links=store(stored),c=collector(s,links);
    // 1) 해제된 화면(화면 데이터는 가린 채): 지금처럼 원문 표로 읽고, 순번으로 맞춘 학생 번호 연결을 배웁니다.
    const plain=await collect(c,'2',DAY);stored.push(...plain.records);
    assert.equal(plain.view.view,'plain');assert.equal(plain.records.length,4);assert.ok(plain.records.every(r=>r.readState==='complete'),plain.records.map(r=>r.readError).join());
    assert.deepEqual(['att-da','att-ga','att-ra','att-na'].map(a=>links.link('2',a)?.source),['plain-read','plain-read','plain-read','plain-read']);
    // 2) 가린 화면: 같은 날을 다시 읽으면 기록이 같습니다(이름·키·번호·시간·메모·외출·삭제 표시).
    s.w.mode='masked';
    const masked=await collect(c,'2',DAY);
    assert.equal(masked.view.view,'masked');assert.equal(masked.view.unlinked,0);
    assert.deepEqual(masked.records.map(same).sort((a,b)=>a.id.localeCompare(b.id)),plain.records.map(same).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.equal(await s.page.evaluate(()=>window.clicks.cell),0,'no cell was clicked in the masked view');
    const text=JSON.stringify(masked.records);assert.ok(!text.includes('**')&&!text.includes('****'),'no masked string reaches a record');
    assert.equal(masked.records.find(r=>r.name==='나가상').entryMemo,'지각_담임:가상담임(09:20)');assert.deepEqual(masked.records.find(r=>r.name==='다가상').outings,[{start:'13:00:00',end:'13:40:00',cutoff:'13:40:00',recognized:false}]);
    // 3) 같은 원문 기록만 있는 새 PC(연결 없음): 저장된 기록·마지막 원문 수집일로 이어 같은 기록을 만듭니다(읽기 전용 연결).
    const fresh=store(stored),c2=collector(s,fresh);
    const again=await collect(c2,'2',DAY);
    assert.deepEqual(again.records.map(same).sort((a,b)=>a.id.localeCompare(b.id)),plain.records.map(same).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.deepEqual(['att-da','att-ga','att-ra','att-na'].map(a=>fresh.link('2',a)?.source),['stored-match','stored-match','stored-match','stored-match']);
    // 원문 읽기로 확인되기 전의 연결은 쓰기 불가(해제된 화면에서도)
    c2.header={state:'unmasked',remaining:500,at:Date.now()};c2.view='plain';
    assert.match(c2.writeBlocked(again.records[0]),/MASKED_UNLINKED/);
    c2.header={state:'both',remaining:null,at:Date.now()};assert.match(c2.writeBlocked(again.records[0]),/MASKED_WRITE/,'an ambiguous header never allows a write');
  }finally{await s.close();}
});
test('unlinked and duplicate-signature students are skipped and counted; a departed student never lends a newcomer his record',async()=>{
  const s=await site({S13:{date:DAY0,students:roster(DAY0,{extra:[LEFT]})},S14:{date:DAY,students:roster(DAY)},S15:{date:DAY2,students:roster(DAY2,{extra:[DUP,NEW,COMER]})}},{mode:'legacy'}),stored=[];
  try{
    const reader=collector(s,store([]));
    // 지난 원문 수집: 10/13에는 나간 학생이 있고, 마지막 원문 수집일(10/14)에는 없습니다.
    stored.push(...(await collect(reader,'2',DAY0)).records,...(await collect(reader,'2',DAY)).records);
    assert.equal(stored.filter(r=>r.name==='마가상').length,1);
    const links=store(stored);assert.deepEqual([links.lastPlain('2').date,links.lastPlain('2').keys.size],[DAY,4],'the last plain day is 12/16 with four students');
    assert.equal(reader.responses.size,1,'only the day just opened keeps its page data (older days, with plain names, are dropped)');
    s.w.mode='masked';const c=collector(s,links);
    const day=await collect(c,'2',DAY2);
    assert.deepEqual(day.records.map(r=>r.name).sort(),['나가상','다가상','라가상'],'only unique, known students who were on the last plain day');
    assert.equal(day.view.unlinked,4,'가상하나·가상하늘(same signature), 바새로(new), 마새롬(newcomer with a departed signature)');
    assert.equal(links.link('2','att-mz'),null,'the newcomer is not linked to the departed student');assert.equal(links.attendee('2',stored.find(r=>r.name==='마가상').studentKey),null);
    assert.equal(links.link('2','att-ga'),null);assert.equal(links.link('2','att-gn'),null);
    // 연결 안 된 학생에 대한 요청은 '먼저 수집'(시도 횟수에 들어감)이 아니라 해제 대기입니다. 첫 글자·끝 4자리는 이 PC 안에서만 비교합니다.
    assert.equal(c.maskedMiss({name:'가상하나',phoneLast4:''}),true);assert.equal(c.maskedMiss({name:'마새롬',phoneLast4:'0005'}),true);assert.equal(c.maskedMiss({name:'나가상',phoneLast4:'0009'}),false);
    const state=await c.maskingState();assert.deepEqual([state.view,state.unlinked],['masked',4]);for(const n of NAMES)assert.ok(!JSON.stringify(state).includes(n),'state has no names or digits');
    await assert.rejects(()=>c.readOpened({...stored.find(r=>r.name==='가상하나'&&r.date===DAY),date:DAY2,url:urlOf('S15',DAY2)}),/MASKED_UNLINKED/);
  }finally{await s.close();}
});
test('a masked-looking admin memo is never stored: that student stays partial and a request for him waits for an unmask (MASKED_READ)',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'}),stored=[];
  try{
    const c=collector(s,store(stored));stored.push(...(await collect(c,'2',DAY)).records);
    s.w.mode='masked';s.w.days.S14.students.find(x=>x.attendeeId==='att-na').eventList.find(e=>e.type==='ATTEND').memoByAdmin='지각_담임:가**(09:20)';
    const day=await collect(c,'2',DAY),na=day.records.find(r=>r.studentKey===stored.find(x=>x.name==='나가상').studentKey);
    // 저장된 완전한 기록 위에 '일부 수집'을 덮지 않고 확인 필요로만 셉니다(가린 메모도 저장하지 않음)
    assert.equal(na,undefined,'no partial record over the complete one');assert.equal(day.view.unread,1);
    assert.ok(day.records.length===3&&day.records.every(r=>r.readState==='complete'));
    const request={classId:'2',date:DAY,name:'나가상',reason:'가상',changes:{entryMemo:'지각_담임:가상담임(09:30)'}};
    await assert.rejects(()=>readRequestRecord(c,request,stored,[],()=>{throw Error('저장하면 안 됨');}),/MASKED_READ/);
    assert.equal(await s.page.evaluate(()=>window.clicks.cell),0);
  }finally{await s.close();}
});
test('a mixed view and a masked view without page data stop the day before any record',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'mixed'});
  try{
    const c=collector(s,store([])),got=[];
    await assert.rejects(()=>c.collect('2',[DAY],async r=>{got.push(r);},async()=>{}),/MASKED_MIXED/);
    s.w.mode='masked';s.w.noData=true;
    await assert.rejects(()=>c.collect('2',[DAY],async r=>{got.push(r);},async()=>{}),/MASKED_NODATA/);
    assert.equal(got.length,0);assert.equal(await s.page.evaluate(()=>window.clicks.cell),0);
  }finally{await s.close();}
});

// ---- 쓰기 ----
test('writes: refused in the masked view before any click; in the unmasked tab they need a confirmed link, enough time and the right attendee',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'}),stored=[];
  try{
    const links=store(stored),c=collector(s,links);
    stored.push(...(await collect(c,'2',DAY)).records);const target=()=>stored.find(r=>r.name==='나가상');
    // 가린 화면: 거절(MASKED_WRITE), 칸도 누르지 않음, 요청 없음
    s.w.mode='masked';const masked=(await collect(c,'2',DAY)).records.find(r=>r.name==='나가상');
    await assert.rejects(()=>c.write(masked,'exit',{time:'17:00:00',memo:'조퇴_담임:가상담임(17:00)'},{requestedFields:['exit','exitMemo']}),/MASKED_WRITE: 체크히어 마스킹 해제가 필요합니다/);
    assert.deepEqual(await s.page.evaluate(()=>[window.clicks.cell,window.clicks.change]),[0,0]);assert.equal(s.w.writes.length,0);
    // 해제됐지만 남은 시간 80초: 시작하지 않음(MASKED_TIME)
    s.w.mode='unmasked';s.w.left='1분 20초';const short=await c.read(target());
    await assert.rejects(()=>c.write(short,'exit',{time:'17:00:00',memo:''},{requestedFields:['exit']}),/MASKED_TIME/);assert.equal(s.w.writes.length,0);
    // 체크히어가 다른 학생 번호로 보내려 하면 그 요청을 막습니다(MASKED_TARGET, 요청이 나가지 않음)
    s.w.left='9분 30초';s.w.tamper='att-ga';const tampered=await c.read(target());
    await assert.rejects(()=>c.write(tampered,'exit',{time:'17:00:00',memo:''},{requestedFields:['exit']}),/MASKED_TARGET/);
    assert.equal(s.w.writes.length,0,'the aborted request never reached the fake CheckHere');assert.equal(c.saving,false);
    // 맞으면 지금처럼 씁니다: 연결된 학생 번호와 이 날 일정으로 한 번
    s.w.tamper=null;const fine=await c.read(target());
    await c.write(fine,'exit',{time:'17:00:00',memo:'조퇴_담임:가상담임(17:00)'},{requestedFields:['exit','exitMemo']});
    assert.deepEqual(s.w.writes.map(b=>[b.attendeeId,b.scheduleId,b.typeEvent,b.time,b.memoByAdmin]),[['att-na','S14','COMPLETE',`${DAY}T17:00:00`,'조퇴_담임:가상담임(17:00)']]);    const after=await c.read(target());assert.deepEqual([after.exit,after.exitMemo],['17:00:00','조퇴_담임:가상담임(17:00)']);
    // 연결이 다른 학생 번호를 가리키면(예: 잘못 배운 연결) 쓰지 않습니다
    const real=c.links;c.links={...real,attendee:(cls,key)=>key===after.studentKey?{attendeeId:'att-ga',source:'plain-read'}:real.attendee(cls,key)};
    assert.match(c.writeBlocked(after),/MASKED_TARGET/,'a link pointing at another attendee blocks the write');c.links=real;
    assert.equal(await s.page.evaluate(()=>[window.clicks.extend,window.clicks.end].join()),'0,0','never 연장 or 종료');
    // 타이머를 읽지 못하는 모양이면 남은 시간이 있어도 쓰지 않습니다(안전한 쪽)
    s.w.left='(09분 30초)';const odd=await c.read(target());const before=s.w.writes.length;
    await assert.rejects(()=>c.write(odd,'exit',{time:'17:10:00',memo:''},{requestedFields:['exit']}),/MASKED_TIME/);assert.equal(s.w.writes.length,before);
    // 저장했는데 연결 프로그램이 체크히어 변경 요청을 보지 못하면(확인이 우회됨) 멈추고, 다시 시작할 때까지 더 쓰지 않습니다
    s.w.left='9분 30초';s.w.silent=true;const quiet=await c.read(target());
    await assert.rejects(()=>c.write(quiet,'exit',{time:'17:10:00',memo:''},{requestedFields:['exit']}),/MASKED_GUARD/);
    s.w.silent=false;const next=await c.read(target());assert.match(c.writeBlocked(next),/MASKED_GUARD/);
    const changes=await s.page.evaluate(()=>window.clicks.change);await assert.rejects(()=>c.write(next,'exit',{time:'17:10:00',memo:''},{requestedFields:['exit']}),/MASKED_GUARD/);
    assert.equal(await s.page.evaluate(()=>window.clicks.change),changes,'nothing is clicked after the guard was bypassed');
  }finally{await s.close();}
});

// ---- 연결 프로그램: 해제 도우미·상태 ----
// 이 가짜 체크히어 탭을 쓰는 연결 프로그램(127.0.0.1의 시험 포트, 가짜 승인 저장소)
async function bridgeOn(s,port,prefix,options={}){
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const c=new CheckHereCollector('',{page:s.page});for(const [sid,d] of Object.entries(s.w.days))c.urls.set(`2|${d.date}`,urlOf(sid,d.date));
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/'+prefix)),collector:c,port,approvalCloud:{},...options});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const headers={'x-hint-key':app.key,'content-type':'application/json',connection:'close'},base=`http://127.0.0.1:${port}/api/`;
  const post=async(path,body={},extra={})=>{const r=await fetch(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});return {code:r.status,body:await r.json()};};
  const state=async()=>(await fetch(base+'state?delta=1',{headers})).json();
  const done=async id=>{for(let i=0;i<400;i++){const j=(await state()).jobs.find(x=>x.id===id||(!id&&x.learn));if(j&&j.status!=='running')return j;await new Promise(r=>setTimeout(r,50));}throw Error('작업이 끝나지 않았습니다.');};
  return {app,post,state,done};
}
// 해제된 화면에서 한 번 읽어 연결을 배우고, 새 학생이 온 뒤 가린 화면에서 읽으면 그 학생만 연결 안 됨
async function newcomerMasked(s,post,done){
  let j=await post('sync',{classId:'2',dates:[DAY],mode:'incremental'});assert.equal(j.code,202,JSON.stringify(j.body));j=await done(j.body.id);assert.equal(j.status,'complete',j.message);
  s.w.days.S14.students.push(roster(DAY,{extra:[NEW]}).at(-1));s.w.mode='masked';
  j=await post('sync',{classId:'2',dates:[DAY],mode:'incremental'});j=await done(j.body.id);assert.match(j.message,/가린 화면 1일 · 연결 안 됨 1명/);
  return j;
}
test('the unmask helper fills the actual purpose, types only the code a person gives, never extends or ends, and then learns links by a plain read',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'});
  const {app,post,state,done}=await bridgeOn(s,18984,'masked-unmask-');
  try{
    await newcomerMasked(s,post,done);
    const st=await state();assert.deepEqual([st.masking.view,st.masking.unlinked,st.masking.waitingWrites,st.masking.header],['masked',1,0,'masked']);
    const shown=JSON.stringify({masking:st.masking,jobs:st.jobs.map(x=>x.message)});for(const n of NAMES)assert.ok(!shown.includes(n),'state and job messages carry no names: '+n);
    // 다른 화면(HTTPS 플랫폼)에서는 해제를 시작할 수 없습니다
    assert.equal((await post('unmask/start',{},{origin:'https://portal.example'})).code,403);
    // 누르기 전에 사유를 미리 보입니다. 사람이 본 사유와 다르면(그 사이 수가 바뀜) 아무것도 누르지 않고 거절합니다.
    const preview=st.masking.reasonPreview;assert.equal(preview,'체크히어 학생 연결 확인 1명 수집(연결 프로그램)');
    const stale=await post('unmask/start',{reason:'체크히어 출결 수정 요청 9건 반영(연결 프로그램)'});assert.equal(stale.code,409);assert.equal(stale.body.reason,preview);
    assert.equal(await s.page.evaluate(()=>window.clicks.unmask),0,'nothing is clicked for a reason the person did not see');
    // 시작: 해제 창을 열고 실제 할 일로 사유를 넣고 인증번호를 보내게 합니다. 인증번호는 아직 넣지 않습니다.
    const started=await post('unmask/start',{reason:preview});assert.equal(started.code,200,JSON.stringify(started.body));
    assert.deepEqual(started.body,{stage:'code',reason:'체크히어 학생 연결 확인 1명 수집(연결 프로그램)'});
    assert.equal(await s.page.evaluate(()=>window.unmaskReason),started.body.reason);assert.ok(started.body.reason.length>=10);
    assert.deepEqual(await s.page.evaluate(()=>[window.clicks.send,window.clicks.confirm,window.typedCode??null]),[1,0,null],'the code is not typed before a person gives it');
    assert.equal((await state()).masking.unmasking,true);assert.equal((await post('sync',{classId:'2',dates:[DAY]})).code,409,'no job moves the tab while the code is awaited');
    assert.equal((await post('unmask/code',{code:'12a456'})).code,400);assert.equal(await s.page.evaluate(()=>window.clicks.confirm),0);
    const ok=await post('unmask/code',{code:'123456'});assert.equal(ok.code,200,JSON.stringify(ok.body));assert.equal(ok.body.view,'plain');assert.equal(ok.body.remaining,570);
    assert.equal(await s.page.evaluate(()=>window.typedCode),undefined,'the page reloaded after the code');assert.equal(s.w.mode,'unmasked');
    assert.deepEqual(await s.page.evaluate(()=>[window.clicks.extend,window.clicks.end]),[0,0],'never 연장 or 종료');
    // 해제된 동안 연결 안 된 반을 원문으로 다시 읽어 새 학생의 연결을 배웁니다
    const learn=await done(null);assert.equal(learn.status,'complete',learn.message);
    assert.equal(app.links.link('2','att-ba')?.source,'plain-read');assert.equal((await state()).masking.unlinked,0);
  }finally{app.close();await s.close();}
});
test('a person unmasking by hand in the bridge window also starts the link-learning read; the bridge clicks nothing in the unmask window',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'});
  const {app,state,post,done}=await bridgeOn(s,18985,'masked-manual-');
  try{
    await newcomerMasked(s,post,done);assert.equal((await state()).masking.unlinked,1);
    // 사람이 전용 크롬에서 직접 해제(가짜: 원문 화면으로 바꾸고 다시 불러옴). 연결 프로그램은 머리말만 보고 알아챕니다.
    s.w.mode='unmasked';await s.page.reload();
    const learn=await done(null);assert.equal(learn.status,'complete',learn.message);
    assert.equal(app.links.link('2','att-ba')?.source,'plain-read');assert.equal((await state()).masking.unlinked,0);
    assert.deepEqual(await s.page.evaluate(()=>Object.values(window.clicks).slice(3)),[0,0,0,0,0],'no 해제·발송·확인·연장·종료 click by the bridge');
  }finally{app.close();await s.close();}
});
// ---- 검토 반영(2026-10-15): 같은 서명·오래된 원문일·일부 수집 반복·해제 직후 순서·사람의 해제 창·연결 충돌 ----
test('a pair sharing first syllable and last 4 is never linked from masked page data; their writes say MASKED_AMBIGUOUS, and plain page data links both',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY,{extra:[DUP]})}},{mode:'unmasked'}),stored=[];
  try{
    const links=store(stored),c=collector(s,links);
    // 해제된 표(원문)와 가린 화면 데이터: 둘은 순번만으로 구분되므로 배우지 않습니다
    const day=await collect(c,'2',DAY);stored.push(...day.records);
    assert.deepEqual([links.link('2','att-ga'),links.link('2','att-gn')],[null,null]);assert.equal(links.link('2','att-na')?.source,'plain-read');
    const ga=day.records.find(r=>r.name==='가상하나');
    assert.match(c.writeBlocked(ga),/MASKED_AMBIGUOUS/,'not MASKED_UNLINKED: an unmask cannot resolve it');assert.equal(waitsForUnmask(c.writeBlocked(ga)),false);
    // 해제된 화면 데이터가 원문이면 전체 키가 같은 쪽으로 둘 다 배웁니다
    s.w.plainJson=true;await collect(c,'2',DAY);
    assert.deepEqual([links.link('2','att-ga')?.source,links.link('2','att-gn')?.source],['plain-read','plain-read']);
    assert.equal(links.link('2','att-ga').studentKey,ga.studentKey);assert.equal(c.writeBlocked(ga),null);
  }finally{await s.close();}
});
test('stored-match: the first-boot seed looks at recent days (a shrunk roster), and a stale last plain day links nobody',()=>{
  const names=['가','나','다','라','마','바','사','아','자','차'].map((x,i)=>({key:'key-'+i,name:x+'가상',last4:String(1000+i)})),gone=['마가상','바가상','사가상'];
  // 10/01~10/05에는 10명, 10/06~10/10에는 7명(셋이 나감). 전체 최대(10명)로 보면 나간 학생이 든 10/05를 원문 수집일로 고릅니다.
  const records=[];
  for(let d=1;d<=10;d++){const date=`2026-10-${String(d).padStart(2,'0')}`;for(const n of names.filter(n=>d<=5||!gone.includes(n.name)))records.push({id:`2_${date}_${n.key}`,classId:'2',date,source:'live',readState:'complete',studentKey:n.key,name:n.name,phoneLast4:n.last4});}
  const links=store(records),last=links.lastPlain('2');
  assert.deepEqual([last.date,last.keys.size,last.keys.has('key-4')],['2026-10-10',7,false]);
  // 10/15 가린 화면: 나간 마가상과 첫 글자·끝 4자리가 같은 새 학생은 연결하지 않습니다. 남은 학생은 잇습니다.
  const rows=[{seq:'1',name:'마**',phone:'010-****-1004',kind:'masked'},{seq:'2',name:'가**',phone:'010-****-1000',kind:'masked'}],entries=[{attendeeId:'att-new'},{attendeeId:'att-k0'}];
  const got=resolveMasked({classId:'2',date:'2026-10-15',rows,entries,links,identities:links.identities('2'),lastPlain:last});
  assert.deepEqual(got[0],{skip:'unlinked'});assert.deepEqual([got[1].studentKey,got[1].source],['key-0','stored-match']);assert.equal(links.link('2','att-new'),null);
  // 마지막 원문 수집일에서 30일 뒤(새 기수가 같은 반 번호를 씀): 저장된 기록으로는 아무도 잇지 않습니다
  const later=store(records);
  assert.deepEqual(resolveMasked({classId:'2',date:'2026-11-09',rows:[rows[1]],entries:[entries[1]],links:later,identities:later.identities('2'),lastPlain:later.lastPlain('2')}),[{skip:'unlinked'}]);
  assert.equal(later.link('2','att-k0'),null);
});
test('a student the masked view cannot read keeps his complete record: no partial row on every sync, the memo survives, the job says 확인 필요',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)},S15:{date:DAY2,students:roster(DAY2)}},{mode:'unmasked'});
  const {app,post,done}=await bridgeOn(s,18986,'masked-partial-');
  const count=()=>app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n;
  const sync=async date=>{const j=await post('sync',{classId:'2',dates:[date],mode:'incremental'});assert.equal(j.code,202,JSON.stringify(j.body));return done(j.body.id);};
  try{
    let j=await sync(DAY);assert.equal(j.status,'complete',j.message);const before=count();
    // 나가상: 퇴실이 바뀌고 두 번째 교시 기록이 생김(가린 화면 데이터로는 읽을 수 없는 모양)
    for(const d of Object.values(s.w.days)){const na=d.students.find(x=>x.attendeeId==='att-na');na.eventList.find(e=>e.type==='COMPLETE').time=iso(d.date,'17:00:00');na.eventList.push({...ev(d.date,'ATTEND','14:00:00','a9'),timeIndex:1});}
    s.w.mode='masked';
    for(let i=0;i<3;i++){j=await sync(DAY);assert.equal(j.status,'partial',j.message);assert.match(j.message,/가린 화면에서 못 읽음 1명/);assert.equal(count(),before,'no new snapshot row');}
    const latest=JSON.parse(app.db.prepare('SELECT payload FROM snapshots ORDER BY seq DESC').all().map(x=>x.payload).find(p=>JSON.parse(p).name==='나가상'&&JSON.parse(p).date===DAY));
    assert.deepEqual([latest.readState,latest.entryMemo,latest.exit],['complete','지각_담임:가상담임(09:20)','18:00:00'],'the stored complete record stays the latest');
    // 저장된 기록이 없는 날은 '일부 수집'을 한 번만 남기고, 같은 표·같은 이유면 다시 쌓지 않습니다
    j=await sync(DAY2);assert.equal(count(),before+4);j=await sync(DAY2);assert.equal(count(),before+4,'the same partial is not stored again');assert.match(j.message,/가린 화면에서 못 읽음 1명/);
  }finally{app.close();await s.close();}
});
// 가짜 승인 저장소(가상 요청만): 확인·읽기·잡기·끝내기
function fakeCloud(docs){
  const calls={claim:0,finish:0};
  return {calls,cloud:{verify:async t=>{if(t!=='fixture-admin')throw Error('관리자 권한 없음');},
    get:async id=>({id,data:structuredClone(docs.get(id))}),
    claim:async(doc,t,attemptId)=>{calls.claim++;const d=docs.get(doc.id);assert.equal(d.status,'approved');Object.assign(d,{status:'applying',attemptId});},
    finish:async(id,t,attemptId,job)=>{calls.finish++;const d=docs.get(id);Object.assign(d,{status:job.status,result:{message:job.message,platformSaved:job.status==='verified'}});return d.result;}}};
}
test('after an unmask the waiting writes go first: link learning waits, a 2-minute window is refused before approval or claim, and nothing fails',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'}),docs=new Map(),fake=fakeCloud(docs);
  const {app,post,state,done}=await bridgeOn(s,18987,'masked-order-',{approvalCloud:fake.cloud,learnTickMs:200,writeGapMs:4000});
  const ask=(path,id)=>post(path,{approvalId:id,idToken:'fixture-admin'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  try{
    await newcomerMasked(s,post,done);
    const latest=name=>app.db.prepare('SELECT payload FROM snapshots ORDER BY seq DESC').all().map(x=>JSON.parse(x.payload)).find(r=>r.name===name);
    const na=latest('나가상'),da=latest('다가상');
    docs.set('masked-pending-000001',{...buildLiveRequest(na,{entry:'09:20',exit:'17:00',entryMemo:na.entryMemo,exitMemo:'조퇴_담임:가상담임(17:00)'},'가상 사유'),status:'pending',createdBy:APPROVER});
    const approved={...buildLiveRequest(da,{entry:'08:59',exit:'16:00',entryMemo:da.entryMemo,exitMemo:'조퇴_담임:가상담임(16:00)'},'가상 사유'),status:'approved',createdBy:APPROVER,approvedBy:APPROVER};
    approved.approval=prepareApproval(approved,da,{allowAlreadyApplied:true});docs.set('masked-approved-00001',approved);
    // 가린 화면: 미리 보기·반영 모두 쓰기 막힘으로 돌아오고, 사유는 승인 전 요청을 따로 셉니다
    let p=await ask('preview-request','masked-pending-000001');assert.equal(p.code,200,JSON.stringify(p.body));assert.equal(p.body.writeBlocked?.code,'MASKED_WRITE');
    let a=await ask('apply','masked-approved-00001');assert.equal(a.code,400);assert.match(a.body.error,/MASKED_WRITE/);
    let st=await state();assert.equal(st.masking.waitingWrites,2);
    assert.equal(st.masking.reasonPreview,'체크히어 출결 수정 요청 2건 반영(승인 대기 1건 포함)·학생 연결 확인 1명 수집(연결 프로그램)');
    // 마지막 쓰기 시도가 오래된 뒤 사람이 직접 해제합니다(남은 2분). 해제 직후에는 연결 확인 수집이 먼저 돌지 않습니다.
    await sleep(4300);s.w.mode='unmasked';s.w.left='2분 0초';await s.page.reload();
    st=await state();assert.equal(st.masking.header,'unmasked');await sleep(1000);
    assert.equal((await state()).jobs.some(j=>j.learn),false,'right after the unmask, link learning waits for the relay to write');
    // 2분 남음: 승인 전 확인과 잡기 전 확인은 150초 기준이라 막고, 요청은 대기·승인 상태 그대로입니다(실패로 끝나지 않음)
    p=await ask('preview-request','masked-pending-000001');assert.equal(p.body.writeBlocked?.code,'MASKED_TIME');
    a=await ask('apply','masked-approved-00001');assert.equal(a.code,400);assert.match(a.body.error,/MASKED_TIME/);
    assert.deepEqual([docs.get('masked-pending-000001').status,docs.get('masked-approved-00001').status,fake.calls.claim],['pending','approved',0]);
    assert.equal((await state()).jobs.some(j=>j.learn),false);
    // 사람이 연장해 시간이 넉넉하면: 미리 보기는 막히지 않고(대기에서 빠짐), 승인된 요청은 잡고 써서 다시 읽어 확인합니다
    s.w.left='9분 30초';
    p=await ask('preview-request','masked-pending-000001');assert.equal(p.body.writeBlocked,undefined,JSON.stringify(p.body.writeBlocked));
    a=await ask('apply','masked-approved-00001');assert.equal(a.code,202,JSON.stringify(a.body));
    const applied=await done('masked-approved-00001');assert.equal(applied.status,'verified',applied.message);
    assert.deepEqual(s.w.writes.map(b=>[b.attendeeId,b.typeEvent,b.time]),[['att-da','COMPLETE',`${DAY}T16:00:00`]]);
    // 기다리는 쓰기가 끝나면 그때 연결 안 된 반을 원문으로 읽어 배웁니다
    const learn=await done(null);assert.equal(learn.status,'complete',learn.message);
    assert.ok(Date.parse(learn.startedAt)>=Date.parse(applied.finishedAt),'the learn read starts only after the write');
    assert.equal(app.links.link('2','att-ba')?.source,'plain-read');assert.equal((await state()).masking.waitingWrites,0);
  }finally{app.close();await s.close();}
});
test('while a person has the unmask window open in the bridge tab, nothing navigates the tab',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'masked'});
  try{
    const c=collector(s,store([]));
    await s.page.click('#unmask');const url=s.page.url();
    await assert.rejects(()=>c.collect('2',[DAY],async()=>{},async()=>{}),/MASKED_UNMASKING/);
    await assert.rejects(()=>c.openLecture('2'),/MASKED_UNMASKING/);
    assert.equal(s.page.url(),url);assert.equal(await s.page.locator('#why').isVisible(),true,'the unmask window is still open');
  }finally{await s.close();}
});
test('a link conflict (phone changed in CheckHere) skips that student, gives MASKED_CONFLICT for his request, and stays after a restart until 연결 충돌 정리',async()=>{
  const s=await site({S14:{date:DAY,students:roster(DAY)}},{mode:'unmasked'}),stored=[],db=new DatabaseSync(':memory:');
  try{
    const links=createLinkStore(db,{records:()=>stored}),c=collector(s,links);
    stored.push(...(await collect(c,'2',DAY)).records);
    s.w.days.S14.students.find(x=>x.attendeeId==='att-ra').phone='01077770004';
    const again=await collect(c,'2',DAY);
    assert.deepEqual(again.records.map(r=>r.name).sort(),['가상하나','나가상','다가상']);assert.equal(again.view.conflicts,1);
    const request={classId:'2',date:DAY,name:'라가상',reason:'가상',changes:{exitMemo:'가상 메모'}};
    await assert.rejects(()=>readRequestRecord(c,request,stored,[],()=>{throw Error('저장하면 안 됨');}),/MASKED_CONFLICT/,'not the counted 다시 찾지 못함 error');
    // 다시 시작해도(같은 DB로 새 저장소) 충돌이 남고, 정리하면 옛 연결을 지워 다음 원문 읽기가 새로 배웁니다
    const restarted=createLinkStore(db,{records:()=>stored});assert.equal(restarted.counts().conflicts,1);
    assert.equal(restarted.clearConflicts(),1);assert.equal(restarted.counts().conflicts,0);
    c.links=restarted;await collect(c,'2',DAY);assert.equal(restarted.link('2','att-ra')?.source,'plain-read');
  }finally{await s.close();}
});
