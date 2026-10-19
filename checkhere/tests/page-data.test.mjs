import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {studentKey,version} from '../identity.mjs';
import {localTime,readStudent,planFromPageData,sampleIds,sameReading} from '../day-data.mjs';

const DATE='2026-10-29';
// Virtual students in the shape the CheckHere page loads (keys confirmed by the diagnosis).
function student(name,phone,{enter,period='ATTEND',attend=enter,complete,entryMemo=null,exitMemo=null,leaves=[]},iso=t=>`${DATE}T${t}`){
  const ev=(type,t,memo=null)=>({eventId:'e',userId:'u',time:iso(t),baseTime:iso(t),timeIndex:0,type,isRecognized:false,status:'NORMAL',memoByAdmin:memo,updatedAt:null});
  const eventList=[ev('ENTER',enter),ev(period,attend,entryMemo)];
  for(const l of leaves){eventList.push(ev('LEAVE',l.start),ev('COMEBACK',l.end));}
  if(complete)eventList.push(ev('COMPLETE',complete,exitMemo));
  return {sequence:1,attendeeId:'a',typeAttendee:'STUDENT',name,userName:name,phone,identifier:'x',eventList,leaveEvents:{totalLeavedDuration:'',totalLeavedSeconds:0,pairs:leaves.map(l=>({leaveEventId:'l',isRecognized:l.ok,startTime:iso(l.start),judgedEndTime:iso(l.end),endTimeOrNull:iso(l.end),duration:'',seconds:0}))},duration:'',seconds:0};
}
const roster=()=>[
  student('가상하나','01011110001',{enter:'08:55:01',attend:'08:55:01',period:'PASS',complete:'18:00:05'}),
  student('가상둘','01011110002',{enter:'09:20:00',complete:'18:00:00',entryMemo:'(인정지각)병원_담임:가상'}),
  student('가상셋','01011110003',{enter:'08:59:00',complete:'15:00:00',exitMemo:'조퇴_병원',leaves:[{start:'13:00:00',end:'13:40:00',ok:false}]}),
];
test('page data values are read as Korean local times and suspicious entries are refused',()=>{
  assert.equal(localTime('2026-10-29T08:55:01'),'08:55:01');assert.equal(localTime('2026-10-28T23:55:01Z'),'08:55:01');assert.equal(localTime(null),null);assert.equal(localTime('어제'),undefined);
  const s=readStudent(roster()[2]);assert.deepEqual([s.rawEntry,s.entry,s.exit,s.entryMemo,s.exitMemo],['08:59:00','08:59:00','15:00:00','','조퇴_병원']);
  assert.deepEqual(s.outings,[{start:'13:00:00',end:'13:40:00',cutoff:'13:40:00',recognized:false}]);assert.deepEqual(s.problems,[]);
  const odd=roster()[2];odd.eventList[2].memoByAdmin='메모 위치 이상';assert.equal(odd.eventList[2].type,'LEAVE');assert.match(readStudent(odd).problems.join(),/관리자 메모/);
  // 입실(ENTER)의 메모는 어느 칸에도 보이지 않아 읽지 않습니다: 관리자 1교시를 지우거나 되살린 뒤 입실 기록이 그 메모를 달고 남음(2026-10-16 실제 확인)
  const kept=roster()[0];kept.eventList[0].memoByAdmin='지각_담임:가상(09:20)';assert.deepEqual(readStudent(kept).problems,[]);assert.equal(readStudent(kept).entryMemo,'');
  const multi=roster()[0];multi.eventList[1].timeIndex=1;assert.match(readStudent(multi).problems.join(),/교시/);
  const unknown=roster()[0];unknown.eventList[1].type='NEW_KIND';assert.match(readStudent(unknown).problems.join(),/알 수 없는/);
});
const rowsOf=list=>list.map((s,i)=>{const d=readStudent(s),r={classId:'2',date:DATE,name:s.name,studentKey:studentKey(s.name,s.phone),phoneLast4:s.phone.slice(-4),rowIndex:i+2,schedule:'09:00 ~ 18:00',rawEntry:d.rawEntry,entry:d.entry,exit:d.exit,outingCount:d.outings.length,outings:[],entryMemo:null,exitMemo:null,source:'live',readState:'partial',tableSignature:'t'+i};r.id='id'+i;return r;});
test('a student is taken from page data only when every visible value agrees',()=>{
  const list=roster(),rows=rowsOf(list);rows[1].exit='17:59:59';
  const plan=planFromPageData(rows,{data:{eventResultList:list}});
  assert.deepEqual(plan.fallback,['id1']);assert.equal(plan.byId.get('id2').exitMemo,'조퇴_병원');assert.equal(plan.byId.get('id2').readState,'complete');
  assert.equal(plan.byId.get('id2').version,version(plan.byId.get('id2')));
  assert.equal(planFromPageData(rows.slice(0,2),{data:{eventResultList:list}}).byId.size,0,'a roster size mismatch rejects the whole day');
  assert.equal(planFromPageData(rows,{data:{}}).byId.size,0);
  assert.deepEqual(sampleIds(plan.byId.values()),['id2','id0'],'a memo/outing student first, then one more');
  assert.equal(sameReading({entry:'1',exit:null,entryMemo:'',exitMemo:null,outings:[]},{entry:'1',exit:null,entryMemo:null,exitMemo:'',outings:[]}),true);
});

// A browser page shaped like CheckHere's attendance detail, fed by the test's data.
const page=`<!doctype html><meta charset="utf-8"><a href="/account/admin">관리자</a><h2>[2반] 가상강의 (가상담임) | ${DATE} 출석부</h2>
<button id="rt">실제 시간 기반</button><button>초</button><button>표시</button><div id="t"></div><div id="m"></div><script>
window.opens=0;let data=[];const q=new URLSearchParams(location.search);
const hms=v=>{if(!v)return '-';const d=new Date(v);return /Z$/.test(v)?d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour12:false}):v.slice(11,19);};
const of=(s,types)=>s.eventList.find(e=>types.includes(e.type));
async function load(rt){data=(await (await fetch('https://checkhere-admin-api.ihereapp.com/api/v3/history/attendee/detail/academy/A/schedule/'+q.get('scheduleId')+'/type/STUDENT/isRealTime/'+rt)).json()).data.eventResultList;draw();}
function draw(){document.querySelector('#t').innerHTML='<table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td></tr>'+data.map((s,i)=>'<tr><td></td><td>'+(i+1)+'</td><td>'+s.name+'</td><td>'+s.phone.replace(/(\\d{3})(\\d{4})(\\d{4})/,'$1-$2-$3')+'</td></tr>').join('')+'<tr><td>합계</td></tr></table><table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr>'+data.map((s,i)=>'<tr><td>'+hms(of(s,['ENTER'])?.time)+'</td><td onclick="edit('+i+',0)">'+hms(of(s,['ATTEND','PASS'])?.time)+'</td><td onclick="edit('+i+',1)">'+hms(of(s,['COMPLETE'])?.time)+'</td><td onclick="out('+i+')">'+(s.leaveEvents.pairs.length?'40분 ('+s.leaveEvents.pairs.length+')':'0분 (-)')+'</td><td>8시간</td></tr>').join('')+'<tr><td>합계</td></tr></table>';}
function edit(i,exit){window.opens++;const s=data[i],e=of(s,exit?['COMPLETE']:['ATTEND','PASS']),o=(window.override||{})[s.name+(exit?'|exit':'|entry')];document.querySelector('#m').innerHTML='<input id="name" value="'+s.name+'"><input id="prevTime" value="'+(e?hms(e.time):'')+'"><input id="modifyTime" value="'+(e?hms(e.time):'')+'"><input id="memoByAdmin" value="'+(o??e?.memoByAdmin??'')+'"><button onclick="document.querySelector(\\'#m\\').innerHTML=\\'\\'">취소</button>';}
function out(i){window.opens++;const s=data[i];document.querySelector('#m').innerHTML='<p>'+s.name+' 님의 외출 시간 확인</p><table><tr><td></td><td>시작</td><td>종료</td><td>외출 종료 판단 기준</td><td>인정</td></tr>'+s.leaveEvents.pairs.map((p,j)=>'<tr><td>'+(j+1)+'</td><td>'+hms(p.startTime)+'</td><td>'+hms(p.endTimeOrNull)+'</td><td>'+hms(p.judgedEndTime)+'</td><td>'+(p.isRecognized?'O':'X')+'</td></tr>').join('')+'</table><button onclick="document.querySelector(\\'#m\\').innerHTML=\\'\\'">취소</button>';}
document.querySelector('#rt').onclick=()=>load(true);load(false);</script>`;
async function site(state){
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true}),context=await browser.newContext(),p=await context.newPage();p.setDefaultTimeout(5000);
  await context.route('https://check.ihereapp.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:page}));
  await context.route('https://checkhere-admin-api.ihereapp.com/**',r=>r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({code:'OK',data:{eventResultList:state.list}})}));
  await p.goto('https://check.ihereapp.com/history/lecture');
  const c=new CheckHereCollector('fixture',{page:p});return {browser,page:p,c};
}
async function run(c,opts={}){const out=[];await c.collect('2',[DATE],async r=>out.push(r),async()=>{},opts);return out;}
test('a day is read from page data without opening any editor and matches the editor-by-editor read exactly',{timeout:60000},async()=>{
  const state={list:roster()},{browser,page:p,c}=await site(state);
  try{
    const days=[];const fast=await run(c,{pageData:true,onDay:d=>days.push(d)});
    const fastOpens=await p.evaluate(()=>window.opens);
    assert.deepEqual(days.map(d=>d.method),['page-data']);assert.equal(fastOpens,0,'no sample editor in a fast read (2026-10-16)');
    const slow=await run(c);const slowOpens=await p.evaluate(()=>window.opens);
    assert(slowOpens>=6,'editor read opens every editor');
    const v=list=>Object.fromEntries(list.map(r=>[r.id,r.version]));assert.deepEqual(v(fast),v(slow),'identical records either way');
    assert.equal(fast.find(r=>r.name==='가상셋').outings[0].recognized,false);
    // Times sent with a zone are read as Korean time too.
    state.list=roster().map(s=>JSON.parse(JSON.stringify(s).replace(/"(2026-10-29)T(\d\d):(\d\d:\d\d)"/g,(m,d,h,rest)=>`"${+h-9<0?'2026-10-28':d}T${String((+h+15)%24).padStart(2,'0')}:${rest}Z"`)));
    const zoned=await run(c,{pageData:true});assert.deepEqual(v(zoned),v(slow));
  }finally{await browser.close();}
});
test('a fast read never falls back to editors: page data is the source and only the precise read opens them',{timeout:60000},async()=>{
  const state={list:roster()},{browser,page:p,c}=await site(state);
  try{
    await p.addInitScript(()=>{window.override={'가상셋|exit':'수정창에만 있는 메모'};});
    const days=[];const out=await run(c,{pageData:true,onDay:d=>days.push(d)});
    assert.equal(days[0].method,'page-data');assert.equal(out.find(r=>r.name==='가상셋').exitMemo,'조퇴_병원','page data, no editor sample');
    assert.equal(out.length,3);assert.equal(await p.evaluate(()=>window.opens),0);
    const precise=await run(c);assert.equal(precise.find(r=>r.name==='가상셋').exitMemo,'수정창에만 있는 메모','the emergency precise read still uses editors');
  }finally{await browser.close();}
});
test('the bridge reads by page data, skips identical students and still catches a memo changed without any time change',{timeout:60000},async()=>{
  const state={list:roster()},{browser,c}=await site(state);
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/page-data-')),collector:c,port:18931});await new Promise(r=>app.server.listen(18931,'127.0.0.1',r));
  const api=async(path,body)=>(await fetch('http://127.0.0.1:18931/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-hint-key':app.key,connection:'close'},body:body&&JSON.stringify(body)})).json();
  const batch=async()=>{const s=await api('sync-batch',{classIds:['2'],dates:[DATE],mode:'incremental'});for(let i=0;i<400;i++){const j=(await api('state?delta=1')).jobs.find(x=>x.id===s.id);if(j.status!=='running')return j;await new Promise(r=>setTimeout(r,25));}};
  const rows=()=>app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n;
  try{
    c.lectureDates=undefined;
    let j=await batch();assert.equal(j.status,'complete',j.message);assert.equal(j.count,3);assert.equal(j.pageDays,1);assert.equal(j.results[0].method,'page-data');
    j=await batch();assert.equal(j.count,0);assert.equal(j.skipped,3);assert.equal(rows(),3);
    state.list[0].eventList[1].memoByAdmin='나중에 추가한 사유';
    j=await batch();assert.equal(j.count,1,'memo-only change detected without reopening every editor');
    const latest=app.db.prepare("SELECT payload FROM snapshots ORDER BY seq DESC LIMIT 1").get();assert.equal(JSON.parse(latest.payload).entryMemo,'나중에 추가한 사유');
  }finally{app.close();await browser.close();}
});
