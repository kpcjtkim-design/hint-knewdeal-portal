import test from 'node:test';import assert from 'node:assert/strict';import {loadPlaywright,CheckHereCollector} from '../collector.mjs';import {ATTEND_DELETE} from '../rules.mjs';
// 이 파일의 가짜 화면에는 가림 머리말이 없습니다(옛 화면): 시험 전용 legacyNoMasking으로 예전 쓰기 확인을 봅니다(운영은 머리말을 못 읽으면 쓰지 않음, two-cell-delete 시험).
test('real DOM adapter reads both memos and outings; writes only Change',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  try{
    await page.setContent(`<!doctype html><html><body><table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td><td>메모</td></tr><tr><td></td><td>1</td><td>가상학생</td><td>01000000001</td><td>시험</td></tr><tr><td>출석인원</td></tr></table><table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr><tr><td>09:00:00</td><td onclick="edit('entry')">09:00:00</td><td onclick="edit('exit')">18:00:00</td><td onclick="outing()">30분 (1)</td><td>8시간</td></tr><tr><td>1</td></tr></table><div id="modal"></div><script>function neverDelete(){throw Error('NEVER_DELETE')} const data={entry:{time:'09:00:00',memo:'외출_담임:최유정(14:00~14:30)'},exit:{time:'18:00:00',memo:''}};function edit(f){const d=data[f];document.querySelector('#modal').innerHTML='<p>'+(f==='entry'?'1교시':'퇴실')+' 시간 수정</p><input id="name" disabled value="가상학생"><input id="prevTime" disabled value="'+d.time+'"><input id="modifyTime" value="'+d.time+'"><input id="memoByAdmin" value="'+d.memo+'"><button onclick="neverDelete()">삭제</button><button id="change">변경</button><button onclick="closeModal()">취소</button>';document.querySelector('#change').onclick=()=>{data[f]={time:document.querySelector('#modifyTime').value,memo:document.querySelector('#memoByAdmin').value};closeModal();};}function closeModal(){document.querySelector('#modal').innerHTML='';}function outing(){document.querySelector('#modal').innerHTML='<p>가상학생 님의 외출 시간 확인</p><table><tr><td></td><td>외출 시작 시간</td><td>외출 종료 시간</td><td>외출 종료 판단 기준</td><td>강의 시간 인정 여부</td></tr><tr><td></td><td>14:00:00</td><td>14:30:00</td><td>14:30:00</td><td>X</td></tr></table><button onclick="closeModal()">취소</button>';}</script></body></html>`);
    const c=new CheckHereCollector('',{page,legacyNoMasking:true});page.setDefaultTimeout(3000);c.day={classId:'2',date:'2026-09-03',teacher:'최유정'};
    const rows=await c.tableRecords();assert.equal(rows.length,1);const r=await c.readDetails(rows[0]);assert.equal(r.readState,'complete',r.readError);assert.equal(r.entryMemo,'외출_담임:최유정(14:00~14:30)');assert.equal(r.exitMemo,'');assert.deepEqual(r.outings,[{start:'14:00:00',end:'14:30:00',cutoff:'14:30:00',recognized:false}]);
    await c.write(r,'exit',{time:'18:00:00',memo:'시스템오류_담임:최유정'});const after=await c.readDetails((await c.tableRecords())[0]);assert.equal(after.exitMemo,'시스템오류_담임:최유정');
    await assert.rejects(()=>c.modal({...r,name:'다른사람'},'entry'),/일치 확인 실패/);
  }finally{await browser.close();}
});
// 체크히어 출결상세를 흉내 낸 가상 화면(Cowork 확인 동작): 학생 데이터는 화면 데이터 모양(eventResultList)이고 표·수정창은 그것으로 그립니다.
// '삭제' 버튼은 기록이 있는 칸의 수정창에만 있고, 누르면 확인창 없이 그 칸을 지우고 수정창을 닫습니다. 퇴실을 지우면 계산된 1교시(PASS)도 '-'가 됩니다.
const DAY='2026-09-03',iso=t=>`${DAY}T${t}`;
const ev=(type,t,eventId,memoByAdmin=null)=>({eventId,userId:'u',time:iso(t),baseTime:iso(type==='COMPLETE'?'18:00:00':'09:00:00'),timeIndex:0,type,isRecognized:false,status:'NORMAL',memoByAdmin,updatedAt:null});
const STUDENTS=[
  {name:'가상체크인',phone:'01000000011',eventList:[ev('ENTER','08:55:31','ev-enter-1'),ev('PASS','08:55:31',null),ev('COMPLETE','17:50:08','ev-exit-1')]},
  {name:'가상관리자',phone:'01000000012',eventList:[ev('ENTER','08:50:03',null),ev('ATTEND','08:50:03','ev-attend-2','시스템오류_담임:가상담임'),ev('COMPLETE','18:00:00','ev-exit-2')]},
  {name:'가상번호없음',phone:'01000000013',eventList:[ev('ENTER','09:00:00','ev-enter-3'),ev('PASS','09:00:00',null),ev('COMPLETE','18:00:00',null)]},
  {name:'가상빈칸',phone:'01000000014',eventList:[ev('ENTER','09:01:00','ev-enter-4'),ev('PASS','09:01:00',null)]},
  {name:'가상사유저장',phone:'01000000015',eventList:[ev('ENTER','09:20:00','ev-enter-5'),ev('ATTEND','09:20:00','ev-attend-5','지각_담임:가상담임(09:20)'),ev('COMPLETE','17:55:00','ev-exit-5')]},
].map((s,i)=>({sequence:i+1,attendeeId:'a'+i,typeAttendee:'STUDENT',userName:s.name,identifier:'가상',duration:'PT9H',seconds:32400,leaveEvents:{totalLeavedDuration:'PT0S',totalLeavedSeconds:0,pairs:[]},...s}));
const DELETE_PAGE=`<!doctype html><html><body><div id="t"></div><div id="modal"></div><script>
window.students=${JSON.stringify(STUDENTS)};window.clicks={change:0,remove:0,passRemoved:0,attendRemoved:0};
const hms=v=>v?v.slice(11,19):'-',of=(s,types)=>s.eventList.find(e=>types.includes(e.type));
function draw(){document.querySelector('#t').innerHTML='<table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td><td>메모</td></tr>'+students.map((s,i)=>'<tr><td></td><td>'+(i+1)+'</td><td>'+s.name+'</td><td>'+s.phone+'</td><td></td></tr>').join('')+'<tr><td>출석인원</td></tr></table><table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr>'+students.map((s,i)=>'<tr><td>'+hms(of(s,['ENTER'])?.time)+'</td><td onclick="edit('+i+',\\'entry\\')">'+hms(of(s,['ATTEND','PASS'])?.time)+'</td><td onclick="edit('+i+',\\'exit\\')">'+hms(of(s,['COMPLETE'])?.time)+'</td><td>0분 (-)</td><td>'+(of(s,['COMPLETE'])?'9시간':'-')+'</td></tr>').join('')+'<tr><td>1</td></tr></table>';}
function edit(i,f){const s=students[i],e=of(s,f==='exit'?['COMPLETE']:['ATTEND','PASS']);
  document.querySelector('#modal').innerHTML='<div class="react-draggable"><p>'+(f==='entry'?'1교시':'퇴실')+' 시간 수정</p><input id="name" disabled value="'+s.name+'"><input id="prevTime" disabled value="'+hms(e?.time)+'"><input id="modifyTime" value="'+(e?hms(e.time):'00:00:00')+'"><input id="memoByAdmin" value="'+(e?.memoByAdmin??'')+'">'+(e&&!window.noRemove?'<button id="remove">삭제</button>':'')+'<button id="change">변경</button><button onclick="closeModal()">취소</button></div>';
  document.querySelector('#change').onclick=()=>{clicks.change++;closeModal();};
  if(e&&!window.noRemove)document.querySelector('#remove').onclick=()=>{clicks.remove++;if(e.type==='PASS')clicks.passRemoved++;if(e.type==='ATTEND')clicks.attendRemoved++;s.eventList=s.eventList.filter(x=>x!==e&&!(f==='exit'&&x.type==='PASS'));closeModal();draw();};}
function closeModal(){document.querySelector('#modal').innerHTML='';}
draw();</script></body></html>`;
test('time delete presses 삭제 once only for a numbered exit; a 1st period while its exit stays, PASS, number-less, unrequested and stale cells are refused before any click',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  try{
    await page.setContent(DELETE_PAGE);page.setDefaultTimeout(3000);
    const c=new CheckHereCollector('',{page,legacyNoMasking:true});c.day={classId:'2',date:DAY,teacher:'가상담임'};
    // 연결 프로그램이 그날 화면을 열 때 받는 화면 데이터(openDay의 this.dayData)를 흉내 냅니다.
    let rows;const fresh=async()=>{c.dayData=await page.evaluate(()=>({code:'OK',data:{eventResultList:structuredClone(window.students)}}));rows=await c.tableRecords();return rows;};
    const by=name=>rows.find(r=>r.name===name),clicks=()=>page.evaluate(()=>({...window.clicks})),closed=async()=>assert.equal(await page.locator('#modifyTime').count(),0,'the editor is closed');
    const del=f=>({requestedFields:[f],deleteFields:[f]}),blank={time:null,memo:''};
    await fresh();
    // 수정창으로 읽은 기록에도 화면 데이터에서 확인한 기록 번호 표시가 붙습니다(버전에는 들어가지 않음).
    const checkedIn=await c.readDetails(by('가상체크인')),admin=await c.readDetails(by('가상관리자')),none=await c.readDetails(by('가상번호없음')),empty=await c.readDetails(by('가상빈칸')),resaved=await c.readDetails(by('가상사유저장'));
    const marks=r=>[r.entryKind,r.entryEventId,r.exitEventId,r.enterEventId];
    assert.deepEqual([marks(checkedIn),marks(admin),marks(none),marks(empty),marks(resaved)],[['PASS',false,true,true],['ATTEND',true,true,false],['PASS',false,false,true],['PASS',false,false,true],['ATTEND',true,true,true]]);
    assert.equal(admin.entryMemo,'시스템오류_담임:가상담임');
    const saved=c.dayData;c.dayData=null;const unknown=await c.readDetails(by('가상관리자'));
    assert.equal(Object.hasOwn(unknown,'exitEventId'),false,'no page data: no marks, so deletion stays locked');assert.equal(unknown.version,admin.version,'marks never change the version');c.dayData=saved;
    // 거절: PASS 1교시, 번호 없는 퇴실, 요청하지 않은 삭제, 화면 데이터 없음·시간 다름, '삭제' 버튼이 둘.
    // 화면 데이터와 맞는 칸의 거절 이유는 규칙(rules.mjs timeDeleteRefusal)의 문장 그대로입니다.
    await assert.rejects(()=>c.write(checkedIn,'entry',blank,del('entry')),/TIME_DELETE_REFUSED: 입실에서 계산된 1교시는 지울 수 없습니다/);await closed();
    await assert.rejects(()=>c.write(none,'exit',blank,del('exit')),/TIME_DELETE_REFUSED: 퇴실 기록 번호를 확인하지 못했습니다/);await closed();
    await assert.rejects(()=>c.write(admin,'exit',blank,{requestedFields:['exitMemo'],deleteFields:['exit']}),/TIME_DELETE_REFUSED: 요청하지 않은 시간 삭제/);await closed();
    await assert.rejects(()=>c.write(admin,'exit',blank,{deleteFields:['exit']}),/요청하지 않은 시간 삭제/);await closed();
    await assert.rejects(()=>c.write(admin,'exit',{time:'18:00:00',memo:''},del('exit')),/삭제할 시간 칸에 시간이/);await closed();
    c.dayData=null;await assert.rejects(()=>c.write(admin,'exit',blank,del('exit')),/기록 번호가 없는 칸/);await closed();
    c.dayData=structuredClone(saved);c.dayData.data.eventResultList[1].eventList[2].time=iso('17:00:00');
    await assert.rejects(()=>c.write(admin,'exit',blank,del('exit')),/기록 번호가 없는 칸/,'page data that disagrees with the editor is not trusted');await closed();c.dayData=saved;
    // 1교시(ATTEND)는 퇴실이 남아 있는 동안 지우지 않음(체크히어가 퇴실 시간으로 다시 채움, 2026-10-16 확인): 관리자 1교시와 체크인한 학생이 사유를 저장한 칸 모두
    await assert.rejects(()=>c.write(resaved,'entry',blank,del('entry')),/TIME_DELETE_REFUSED: 퇴실이 남아 있으면 1교시만 지울 수 없습니다/);await closed();
    await assert.rejects(()=>c.write(admin,'entry',blank,del('entry')),/TIME_DELETE_REFUSED: 퇴실이 남아 있으면 1교시만 지울 수 없습니다\(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다\)/);await closed();
    // 화면 데이터의 실제 입실만 1초 달라도 믿지 않음(표시를 붙일 때와 같은 기준)
    c.dayData=structuredClone(saved);c.dayData.data.eventResultList[1].eventList[0].time=iso('08:50:04');
    await assert.rejects(()=>c.write(admin,'exit',blank,del('exit')),/기록 번호가 없는 칸/);await closed();c.dayData=saved;
    // 수정창에는 '삭제'가 없고 화면 다른 곳(강의 화면)에만 하나: 그 버튼을 누르지 않음
    await page.evaluate(()=>{window.noRemove=true;window.lectureDeleted=false;document.body.insertAdjacentHTML('afterbegin','<button id="lecture" onclick="window.lectureDeleted=true">삭제</button>');});
    await assert.rejects(()=>c.write(admin,'exit',blank,del('exit')),/삭제 버튼을 하나로/);await closed();
    assert.equal(await page.evaluate(()=>window.lectureDeleted),false,'the button outside the editor is never pressed');
    await page.evaluate(()=>{window.noRemove=false;document.querySelector('#lecture').remove();});
    await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<button id="other">삭제</button>'));
    await assert.rejects(()=>c.write(admin,'exit',blank,del('exit')),/삭제 버튼을 하나로/);await closed();await page.evaluate(()=>document.querySelector('#other').remove());
    assert.deepEqual(await clicks(),{change:0,remove:0,passRemoved:0,attendRemoved:0},'neither 변경 nor 삭제 was pressed');
    // 이미 빈 칸은 누를 것이 없습니다.
    assert.deepEqual(await c.write(empty,'exit',blank,del('exit')),blank);await closed();assert.deepEqual(await clicks(),{change:0,remove:0,passRemoved:0,attendRemoved:0});
    // 퇴실 삭제: 한 번 누르고, 수정창이 닫히고, 1교시(PASS)도 '-'가 되며 입실은 남습니다.
    assert.deepEqual(await c.write(checkedIn,'exit',blank,del('exit')),blank);await closed();assert.equal(c.saving,false);
    assert.deepEqual(await clicks(),{change:0,remove:1,passRemoved:0,attendRemoved:0});
    await fresh();const gone=await c.readDetails(by('가상체크인'));
    assert.deepEqual([gone.rawEntry,gone.entry,gone.exit,gone.exitMemo],['08:55:31',null,null,'']);assert.equal(gone.exitEventId,false);
    // 관리자가 1교시를 넣은 학생: 퇴실만 지워지고 1교시(ATTEND)와 그 사유는 남습니다(2026-10-16 실제 체크히어에서 확인, docs/cowork/2026-10-16-checkhere-write-format.md 2-2).
    assert.deepEqual(await c.write(admin,'exit',blank,del('exit')),blank);await closed();
    await fresh();const adminAfter=await c.readDetails(by('가상관리자'));
    assert.deepEqual([adminAfter.entry,adminAfter.entryMemo,adminAfter.exit,adminAfter.exitEventId,adminAfter.entryEventId],['08:50:03','시스템오류_담임:가상담임',null,false,true]);
    assert.deepEqual(await clicks(),{change:0,remove:2,passRemoved:0,attendRemoved:0},'two exit deletions, one click each, never the 1st period');
  }finally{await browser.close();}
});
// 관리자 1교시(ATTEND) 삭제(2026-10-16 켬): 퇴실을 먼저 지우고 다시 읽은 뒤 1교시를 지우면 두 칸이 비고 실제 입실 기록은 남습니다(한 칸에 한 번씩 누름).
test('the admin period is deleted after its exit, each with one click; both cells end empty',{skip:!ATTEND_DELETE&&'관리자 1교시 삭제 꺼짐(rules.mjs ATTEND_DELETE)'},async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  try{
    await page.setContent(DELETE_PAGE);page.setDefaultTimeout(3000);
    const c=new CheckHereCollector('',{page,legacyNoMasking:true});c.day={classId:'2',date:DAY,teacher:'가상담임'};
    let rows;const fresh=async()=>{c.dayData=await page.evaluate(()=>({code:'OK',data:{eventResultList:structuredClone(window.students)}}));rows=await c.tableRecords();return rows;};
    const by=name=>rows.find(r=>r.name===name),blank={time:null,memo:''},both={requestedFields:['entry','exit'],deleteFields:['entry','exit']};
    await fresh();let admin=await c.readDetails(by('가상관리자'));
    await assert.rejects(()=>c.write(admin,'entry',blank,both),/퇴실이 남아 있으면 1교시만 지울 수 없습니다/,'the 1st period is never first');
    assert.deepEqual(await c.write(admin,'exit',blank,both),blank);
    await fresh();admin=await c.readDetails(by('가상관리자'));assert.deepEqual([admin.entry,admin.exit,admin.exitEventId],['08:50:03',null,false]);
    assert.deepEqual(await c.write(admin,'entry',blank,both),blank);assert.equal(await page.locator('#modifyTime').count(),0,'the editor is closed');
    await fresh();const after=await c.readDetails(by('가상관리자'));
    assert.deepEqual([after.entry,after.entryMemo,after.exit],[null,'',null]);
    assert.deepEqual(await page.evaluate(()=>({...window.clicks})),{change:0,remove:2,passRemoved:0,attendRemoved:1},'one click per cell, exit then ATTEND');
  }finally{await browser.close();}
});

