import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
import {runProbe} from '../probe-network.mjs';
import {urlTemplate,timeReadings,matchRecords,summarize} from '../probe-core.mjs';

// Virtual students only. Times in the API are UTC ISO strings, as many APIs send them.
const STUDENTS=[
 {userName:'가상하나',phone:'010-1111-0001',realEnterAt:'2026-09-01T00:01:23Z',enter:{time:'09:00:00',memoByAdmin:'지각_담임:가상(교통)'},exit:{time:'18:00:05',memoByAdmin:''},goOuts:[{startAt:'2026-09-01T05:00:00Z',endAt:'2026-09-01T05:30:00Z',cutoffAt:'2026-09-01T05:30:00Z',recognized:false}]},
 {userName:'가상둘',phone:'010-1111-0002',realEnterAt:'2026-08-31T23:55:00Z',enter:{time:'09:00:00',memoByAdmin:''},exit:{time:'18:01:00',memoByAdmin:''},goOuts:[]},
 {userName:'가상셋',phone:'010-1111-0003',realEnterAt:'2026-09-01T00:12:00Z',enter:{time:'09:12:00',memoByAdmin:''},exit:{time:'17:30:00',memoByAdmin:'조퇴_병원진료'},goOuts:[]},
];
const page=`<!doctype html><meta charset="utf-8"><body><a href="/account/admin">관리자</a>
<h2 id="title">[2반] 가상강의 (가상담임) | 2026-09-01 출석부</h2>
<button id="rt">실제 시간 기반</button><button>초</button><button>표시</button><div id="tables"></div><div id="modal"></div>
<script>
const API='https://checkhere-admin-api.ihereapp.com/api/v3';const q=new URLSearchParams(location.search);let data=[];
const kst=iso=>new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour12:false});
async function load(rt){const r=await fetch(API+'/history/attendee/detail/academy/'+q.get('academyId')+'/schedule/'+q.get('scheduleId')+'/type/STUDENT/isRealTime/'+rt);data=(await r.json()).data.attendees;render();}
function render(){
 const roster=data.map((s,i)=>'<tr><td></td><td>'+(i+1)+'</td><td>'+s.userName+'</td><td>'+s.phone+'</td></tr>').join('');
 const times=data.map((s,i)=>'<tr><td>'+kst(s.realEnterAt)+'</td><td onclick="edit('+i+',\\'enter\\')">'+s.enter.time+'</td><td onclick="edit('+i+',\\'exit\\')">'+s.exit.time+'</td><td onclick="outing('+i+')">'+(s.goOuts.length?'30분 ('+s.goOuts.length+')':'0분 (-)')+'</td><td>8시간</td></tr>').join('');
 document.querySelector('#tables').innerHTML='<table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td></tr>'+roster+'<tr><td>출석인원</td></tr></table><table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr>'+times+'<tr><td>합계</td></tr></table>';
}
async function edit(i,f){const s=data[i];let memo=s[f].memoByAdmin;
 if(window.PER_CLICK){const r=await fetch(API+'/history/attend/0f8fad5b-d9cb-469f-a165-70867728950'+i+'/'+f+'/memo');memo=(await r.json()).data.memoByAdmin;}
 document.querySelector('#modal').innerHTML='<input id="name" disabled value="'+s.userName+'"><input id="prevTime" disabled value="'+s[f].time+'"><input id="modifyTime" value="'+s[f].time+'"><input id="memoByAdmin" value="'+memo+'"><button>변경</button><button onclick="closeModal()">취소</button>';}
function closeModal(){document.querySelector('#modal').innerHTML='';}
function outing(i){const s=data[i];document.querySelector('#modal').innerHTML='<p>'+s.userName+' 님의 외출 시간 확인</p><table><tr><td></td><td>외출 시작 시간</td><td>외출 종료 시간</td><td>외출 종료 판단 기준</td><td>강의 시간 인정 여부</td></tr>'+s.goOuts.map((o,j)=>'<tr><td>'+(j+1)+'</td><td>'+kst(o.startAt)+'</td><td>'+kst(o.endAt)+'</td><td>'+kst(o.cutoffAt)+'</td><td>'+(o.recognized?'O':'X')+'</td></tr>').join('')+'</table><button onclick="closeModal()">취소</button>';}
document.querySelector('#rt').onclick=()=>load(true);load(false);
</script>`;
async function fakeSite(context,{perClick=false}={}){
  await context.route('https://check.ihereapp.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:perClick?page.replace('<script>','<script>window.PER_CLICK=true;'):page}));
  await context.route('https://checkhere-admin-api.ihereapp.com/**',route=>{
    const u=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
    if(u.pathname.includes('/attendee/detail/')){
      const attendees=perClick?STUDENTS.map(s=>({...s,enter:{time:s.enter.time},exit:{time:s.exit.time}})):STUDENTS;
      return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({code:200,data:{schedule:{start:'09:00',end:'18:00'},attendees}})});
    }
    const m=/attend\/[0-9a-f-]+?(\d)\/(enter|exit)\/memo$/.exec(u.pathname);
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({data:{memoByAdmin:STUDENTS[+m[1]][m[2]].memoByAdmin}})});
  });
}
async function probe(perClick){
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext(),p=await context.newPage();p.setDefaultTimeout(5000);await fakeSite(context,{perClick});
    const collector=new CheckHereCollector('fixture',{page:p});
    return await runProbe({collector,classId:'2',date:'2026-09-01',log:()=>{}});
  }finally{await browser.close();}
}
test('url templates hide ids and keep only query names',()=>{
  assert.equal(urlTemplate('https://checkhere-admin-api.ihereapp.com/api/v3/history/attendee/detail/academy/ACADEMY-HNGV/schedule/E9897B32-14C7-48B9-925C-39FB949F1E9A/type/STUDENT/isRealTime/true?name=홍길동&phone=01012345678'),
    'checkhere-admin-api.ihereapp.com/api/v3/history/attendee/detail/academy/{id}/schedule/{uuid}/type/STUDENT/isRealTime/true?name=…&phone=…');
  assert.deepEqual(timeReadings('2026-09-01T00:01:23Z'),['00:01:23','09:01:23']);
  assert.deepEqual(timeReadings(Date.parse('2026-09-01T00:01:23Z')),['09:01:23']);
});
test('student keys and Korean object keys never reach the report',()=>{
  const m=matchRecords([{name:'가상',entry:'09:00:00',entryMemo:'메모'}],[{url:'x',json:{byName:{'가상':{name:'가상',in:'09:00:00',memo:'메모'}}}}]);
  assert.equal(m.fields.entry.found,1);assert(!JSON.stringify(m).includes('가상'));assert(!JSON.stringify(m).includes('메모'));
});
test('probe finds times, memos and outings already inside the day JSON, without leaking values',async()=>{
  const report=await probe(false);
  assert.equal(report.students,3);assert.equal(report.detailComplete,3);
  assert.deepEqual(Object.fromEntries(Object.entries(report.verdict).map(([k,v])=>[k,v.status])),{times:'yes',memos:'yes',outings:'yes'});
  assert(Object.keys(report.match.fields.entryMemo.paths).some(p=>p.endsWith('$.data.attendees[].enter.memoByAdmin')));
  assert(Object.keys(report.match.fields.rawEntry.paths).some(p=>p.endsWith('$.data.attendees[].realEnterAt')),'UTC ISO times are matched as Korean time');
  assert(Object.keys(report.match.fields.outingStart.paths).some(p=>p.endsWith('$.data.attendees[].goOuts[].startAt')));
  assert(report.network.load.requests>=1);assert.equal(report.network.modals,undefined,'modals in this site fetch nothing');
  const text=JSON.stringify(report)+summarize(report);
  for(const secret of ['가상하나','가상셋','010-1111','1111','지각_담임','조퇴_병원','09:01:23','ACADEMY-HNGV','E9897B32'])assert(!text.includes(secret),secret);
  assert.match(summarize(report),/수정창을 열지 않고 수집할 수 있을 가능성이 큽니다/);
});
test('probe reports memos missing from the day JSON and shows the per-click endpoint instead',async()=>{
  const report=await probe(true);
  assert.equal(report.verdict.times.status,'yes');assert.equal(report.verdict.memos.status,'no');
  assert.equal(report.modalPhaseMatch.fields.entryMemo.found,report.modalPhaseMatch.fields.entryMemo.compared);
  assert(Object.keys(report.network.modals.endpoints).some(k=>k.includes('/history/attend/{uuid}/enter/memo')));
  assert.match(summarize(report),/일부 항목은 아직/);
});

import http from 'node:http';
import {checkHereDayUrl} from '../probe-network.mjs';
test('pasted CheckHere day addresses are validated',()=>{
  assert.deepEqual(checkHereDayUrl(' https://check.ihereapp.com/history/lecture/modify?tab=STUDENT&scheduleId=x&scheduleDate=2026-09-01 '),{url:'https://check.ihereapp.com/history/lecture/modify?tab=STUDENT&scheduleId=x&scheduleDate=2026-09-01',date:'2026-09-01'});
  assert.equal(checkHereDayUrl('https://evil.example/history/lecture/modify?scheduleDate=2026-09-01'),null);
  assert.equal(checkHereDayUrl('https://check.ihereapp.com/history/lecture?scheduleDate=2026-09-01'),null);
  assert.equal(checkHereDayUrl('아무 글자'),null);
});
test('a response that never finishes and a stuck discovery cannot freeze the diagnosis',{timeout:60000},async()=>{
  // A JSON stream that sends headers and never ends, like a request cut off mid-navigation.
  const open=new Set(),server=http.createServer((req,res)=>{open.add(res);res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});res.write('{"partial":');});
  await new Promise(r=>server.listen(18901,'127.0.0.1',r));
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,args:['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults']});
  try{
    const context=await browser.newContext(),p=await context.newPage();p.setDefaultTimeout(5000);await fakeSite(context);
    await context.route('https://check.ihereapp.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:page.replace('<script>',"<script>fetch('http://127.0.0.1:18901/stream');")}));
    const collector=new CheckHereCollector('fixture',{page:p});
    collector.discover=()=>{throw Error('discovery must be skipped when the address is known');};
    const url='https://check.ihereapp.com/history/lecture/modify?tab=STUDENT&academyId=ACADEMY-HNGV&lectureId=x&scheduleId=E9897B32-14C7-48B9-925C-39FB949F1E9A&scheduleDate=2026-09-01';
    const started=Date.now(),beats=[];
    const report=await runProbe({collector,classId:'2',date:'2026-09-01',url,log:t=>beats.push(t),bodyTimeoutMs:300,settleMs:500,heartbeatMs:200});
    assert(Date.now()-started<20000,'finished despite the open stream');
    assert.equal(report.verdict.memos.status,'yes');
    assert(report.responses.some(r=>r.url.includes('/stream')),'the open stream is still listed');
    const stuck=new CheckHereCollector('fixture',{page:p});stuck.discover=()=>new Promise(()=>{});
    await assert.rejects(runProbe({collector:stuck,classId:'2',date:'2026-09-01',log:t=>beats.push(t),discoverTimeoutMs:300,heartbeatMs:100}),/주소창 주소를 복사해/);
    assert(beats.some(t=>t.includes('진행 중')),'progress is shown while waiting');
  }finally{for(const res of open)res.destroy();server.close();await browser.close();}
});

import {mkdirSync,mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createBridge} from '../server.mjs';
test('the bridge runs the diagnosis with its own logged-in Chrome and saves only the value-free report',{timeout:60000},async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true});
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/probe-bridge-'));
  try{
    const context=await browser.newContext(),p=await context.newPage();p.setDefaultTimeout(5000);await fakeSite(context);
    await p.goto('https://check.ihereapp.com/history/lecture');
    const collector=new CheckHereCollector(dataDir,{page:p});
    const app=createBridge({dataDir,collector,port:18921});await new Promise(r=>app.server.listen(18921,'127.0.0.1',r));
    try{
      const call=async(path,body)=>(await fetch('http://127.0.0.1:18921/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-hint-key':app.key,connection:'close'},body:body&&JSON.stringify(body)})).json();
      const started=await call('probe',{classId:'2',date:'2026-09-01'});assert.equal(started.kind,'probe');
      let job;for(let i=0;i<300;i++){job=(await call('state?delta=1')).jobs.find(j=>j.id===started.id);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,50));}
      assert.equal(job.status,'complete',job.message);assert.match(job.summary,/관리자 메모 포함됨/);
      assert(existsSync(job.report));const text=readFileSync(job.report,'utf8');
      for(const secret of ['가상하나','010-1111','지각_담임'])assert(!text.includes(secret),secret);
      assert.equal(app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n,0,'diagnosis does not touch collected records');
    }finally{app.close();}
  }finally{await browser.close();}
});

import {mappingEvidence} from '../probe-core.mjs';
import {studentKey as keyOf} from '../identity.mjs';
test('mapping evidence names keys and event kinds but no personal values',()=>{
  const json={data:{eventResultList:[{name:'가상하나',userName:'가상하나',phone:'01011110001',eventList:[{type:'ENTER',timeIndex:0,time:'2026-09-03T00:01:23Z',memoByAdmin:null},{type:'ATTEND',timeIndex:1,time:'2026-09-03T00:00:00Z',memoByAdmin:'지각_교통'},{type:'EXIT',timeIndex:2,time:'2026-09-03T09:00:05Z',memoByAdmin:''}],leaveEvents:{pairs:[]}}]}};
  const rec={name:'가상하나',studentKey:keyOf('가상하나','01011110001'),rawEntry:'09:01:23',entry:'09:00:00',exit:'18:00:05',entryMemo:'지각_교통',exitMemo:''};
  const m=mappingEvidence([rec],[{url:'api/attendee/detail/x',json}],{studentKey:keyOf});
  assert.deepEqual(Object.keys(m.phoneKeys),['api/attendee/detail/x :: $.phone']);
  assert.equal(m.fields.rawEntry['api/attendee/detail/x :: $.eventList[].time @ type:ENTER,timeIndex:0'],1);
  assert.equal(m.fields.entry['api/attendee/detail/x :: $.eventList[].time @ type:ATTEND,timeIndex:1'],1);
  assert.equal(m.fields.entryMemo['api/attendee/detail/x :: $.eventList[].memoByAdmin @ type:ATTEND,timeIndex:1'],1);
  assert.equal(m.fields.exit['api/attendee/detail/x :: $.eventList[].time @ type:EXIT,timeIndex:2'],1);
  const text=JSON.stringify(m);for(const s of ['가상하나','0101111','지각_교통','09:01'])assert(!text.includes(s),s);
});
