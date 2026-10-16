import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {version} from '../identity.mjs';

mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
const URL_OF=(c,d)=>`https://check.ihereapp.com/history/lecture/modify?tab=STUDENT&lectureId=L${c}&scheduleId=S${c}${d}&scheduleDate=${d}`;
// A collector whose CheckHere pages are simulated; collect() and the batch logic are real.
// 빠른 수집(incremental)은 그날 화면 데이터만 읽습니다(2026-10-16): openDay가 순번으로 맞춘 화면 데이터 항목을 함께 둡니다.
// failOnce: 그 학생의 화면 데이터가 처음 한 번 표와 달라(읽지 못함) 두 번째 시도에서 읽힙니다. 수정창(readDetails)은 정밀 수집에서만 열립니다.
const entryOf=(row,exit)=>({sequence:1,attendeeId:'att-'+row.id,name:row.name,phone:'',eventList:[{type:'ENTER',time:row.date+'T'+row.rawEntry,eventId:'e',timeIndex:0},{type:'PASS',time:row.date+'T'+row.entry,eventId:null,timeIndex:0},{type:'COMPLETE',time:row.date+'T'+exit,eventId:'c',timeIndex:0}],leaveEvents:{pairs:[]}});
function fakeCollector({lectures,failOnce=new Set(),scan=true}){
  const c=new CheckHereCollector('fixture',{page:{},dayGapMs:[0,0]}),calls={openDay:[],details:[],scans:[]},failed=new Set();
  c.loggedIn=async()=>true;c.requireLogin=async()=>{if(c.loggedOut)throw Error('LOGIN_REQUIRED: 전용 크롬에서 체크히어에 로그인해 주세요.');};
  if(scan)c.lectureDates=async classId=>{calls.scans.push(classId);if(!lectures[classId])throw Error(`${classId}반 강의를 찾지 못했습니다.`);return {dates:Object.keys(lectures[classId]).sort(),complete:true};};
  else c.lectureDates=undefined;
  c.openDay=async(classId,date)=>{
    await c.requireLogin();calls.openDay.push(`${classId}|${date}`);
    const day=lectures[classId]?.[date];if(!day)throw Error(`${date} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);
    c.urls.set(`${classId}|${date}`,URL_OF(classId,date));
    const rows=day.map((s,i)=>({id:`${classId}-${date}-${s.name}`,classId,date,name:s.name,studentKey:'k'+s.name,phoneLast4:'0000',rowIndex:i+2,schedule:'09:00 ~ 18:00',rawEntry:s.in,entry:s.in,exit:s.out,outingCount:0,outings:[],entryMemo:null,exitMemo:null,tableSignature:`${s.in}|${s.out}`,source:'live',readState:'partial',collectedAt:new Date().toISOString()}));
    const entries=new Map(rows.map(r=>{const bad=failOnce.has(r.id)&&!failed.has(r.id);if(bad)failed.add(r.id);return [r.id,entryOf(r,bad?'12:34:56':r.exit)];}));
    c.dayData={data:{eventResultList:[...entries.values()]}};c.planOptions=()=>({entryFor:r=>entries.get(r.id)});
    return rows;
  };
  c.readDetails=async row=>{calls.details.push(row.id);
    const r={...row,entryMemo:'',exitMemo:'',readState:'complete',collectedAt:new Date(Date.now()+calls.details.length).toISOString()};r.version=version(r);return r;};
  return {c,calls};
}
async function bridge(collector,port,dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/batch-'))){
  const app=createBridge({dataDir,collector,port});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const api=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-hint-key':app.key,connection:'close'},body:body&&JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
  const wait=async id=>{for(let i=0;i<500;i++){const s=await api('state?delta=1');const j=s.jobs.find(x=>x.id===id);if(j.status!=='running')return j;await new Promise(r=>setTimeout(r,5));}throw Error('timeout');};
  return {app,api,wait,dataDir,rows:()=>app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n};
}
const lectures=()=>({
  '2':{'2026-09-01':[{name:'가',in:'09:00:00',out:'18:00:00'},{name:'나',in:'09:05:00',out:'18:00:00'}],'2026-09-03':[{name:'가',in:'08:58:00',out:'18:00:00'},{name:'나',in:'09:30:00',out:'17:00:00'}]},
});
test('one batch job covers several classes and a period, rules out non-lecture days from one scan and retries unread students',async()=>{
  const {c,calls}=fakeCollector({lectures:lectures(),failOnce:new Set(['2-2026-09-03-나'])}),b=await bridge(c,18811);
  try{
    const started=await b.api('sync-batch',{classIds:['3','2'],dates:['2026-09-03','2026-09-01','2026-09-02'],mode:'incremental'});
    assert.equal(started.kind,'batch');assert.equal(started.total,6);
    const job=await b.wait(started.id),by=Object.fromEntries(job.results.map(r=>[`${r.classId}|${r.date}`,r]));
    assert.equal(by['2|2026-09-02'].status,'no-lecture');assert(!calls.openDay.includes('2|2026-09-02'),'no paged search for a day the scan ruled out');
    assert.equal(by['2|2026-09-01'].status,'complete');assert.equal(by['2|2026-09-03'].status,'complete','second attempt read the student that failed');
    assert.equal(by['2|2026-09-03'].attempt,2);
    assert.deepEqual(calls.details,[],'fast reads never open an editor, not even for the unread student');
    const latest=JSON.parse(b.app.db.prepare("SELECT payload FROM snapshots WHERE id='2-2026-09-03-나' ORDER BY seq DESC LIMIT 1").get().payload);
    assert.equal(latest.readState,'complete','the retry read the student from page data');
    for(const d of ['2026-09-01','2026-09-02','2026-09-03'])assert.equal(by['3|'+d].status,'failed');
    assert.equal(calls.scans.filter(x=>x==='3').length,1);assert(!calls.openDay.some(x=>x.startsWith('3|')),'a class that does not exist is not retried day by day');
    assert.equal(job.status,'partial');assert.match(job.message,/6\/6 반·날짜/);assert.match(job.message,/강의 없음 1/);
    // Repeating the period reads nobody and adds no history rows.
    const before=b.rows();calls.details.length=0;
    const again=await b.wait((await b.api('sync-batch',{classIds:['2'],dates:['2026-09-01','2026-09-03'],mode:'incremental'})).id);
    assert.deepEqual(calls.details,[]);assert.equal(again.skipped,4);assert.equal(b.rows(),before);assert.equal(again.status,'complete');
    assert.equal(calls.scans.filter(x=>x==='2').length,1,'remembered day addresses skip the schedule scan');
    // Precise mode (emergency) re-reads everyone through editors.
    const precise=await b.wait((await b.api('sync-batch',{classIds:['2'],dates:['2026-09-01'],mode:'full'})).id);
    assert.equal(precise.count,2);assert.equal(precise.skipped,0);assert.equal(calls.details.length,2);
  }finally{b.app.close();}
});
test('remembered addresses survive a restart; a lost login stops the batch instead of failing every day',async()=>{
  const first=fakeCollector({lectures:lectures()}),b1=await bridge(first.c,18812);
  await b1.wait((await b1.api('sync-batch',{classIds:['2'],dates:['2026-09-01','2026-09-03'],mode:'incremental'})).id);b1.app.close();
  const second=fakeCollector({lectures:lectures()});const b2=await bridge(second.c,18813,b1.dataDir);
  try{
    assert.equal(second.c.urls.get('2|2026-09-01'),URL_OF('2','2026-09-01'));
    second.c.loggedOut=false;const job=await b2.wait((await b2.api('sync-batch',{classIds:['2'],dates:['2026-09-01','2026-09-03'],mode:'full'})).id);
    assert.deepEqual(second.calls.scans,[]);assert.equal(job.status,'complete');
    let n=0;second.c.readDetails=async row=>{if(++n===2)second.c.loggedOut=true;const r={...row,entryMemo:'',exitMemo:'',readState:'complete',collectedAt:new Date().toISOString()};r.version=version(r);return r;};
    const lost=await b2.wait((await b2.api('sync-batch',{classIds:['2'],dates:['2026-09-01','2026-09-03'],mode:'full'})).id);
    assert.match(lost.message,/LOGIN_REQUIRED/);assert(lost.results.length<=2);
  }finally{b2.app.close();}
});
test('cancelling stops between days and rejects bad input',async()=>{
  const {c}=fakeCollector({lectures:lectures(),scan:false}),b=await bridge(c,18814);
  try{
    await assert.rejects(b.api('sync-batch',{classIds:['18'],dates:['2026-09-01']}),/반\(1~17\)/);
    await assert.rejects(b.api('sync-batch',{classIds:['2'],dates:['2026-02-30']}),/날짜/);
    const slow=c.readDetails;c.readDetails=async r=>{await new Promise(x=>setTimeout(x,30));return slow(r);};
    const started=await b.api('sync-batch',{classIds:['2'],dates:['2026-09-01','2026-09-03'],mode:'full'});
    await new Promise(r=>setTimeout(r,40));await b.api('cancel',{});
    const job=await b.wait(started.id);assert.equal(job.status,'cancelled');assert(job.results.length<2);
  }finally{b.app.close();}
});
test('schedule scan reads every page once and reports whether it saw them all; a stale remembered address is looked up again',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true}),page=await browser.newPage();
  try{
    await page.setContent(`<table id="t"><tr><td>2026-09-01 (월)</td><td><button>보기</button></td></tr><tr><td>2026.09.02</td><td><button>보기</button></td></tr></table><button>1</button><button onclick="document.querySelector('#t').innerHTML='<tr><td>2026-09-04</td><td><button>보기</button></td></tr>'">2</button>`);
    const c=new CheckHereCollector('',{page});c.openLecture=async()=>{};page.setDefaultTimeout(3000);
    assert.deepEqual(await c.lectureDates('2'),{dates:['2026-09-01','2026-09-02','2026-09-04'],complete:true});
    const key='2|2026-09-01';c.urls.set(key,'https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-09-01&old=1');const seen=[];
    c.openDayOnce=async(classId,date,url)=>{const u=url||await c.discover(classId,date);seen.push(u);if(u.includes('old=1'))throw Error('반·날짜 확인에 실패했습니다.');return ['ok'];};
    c.discover=async(classId,date)=>{if(c.urls.has(`${classId}|${date}`))return c.urls.get(`${classId}|${date}`);const fresh='https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-09-01&new=1';c.urls.set(`${classId}|${date}`,fresh);return fresh;};
    assert.deepEqual(await c.openDay('2','2026-09-01'),['ok']);assert.equal(seen.length,2);assert.match(c.urls.get(key),/new=1/);
    await assert.rejects(c.openDay('2','2026-09-01','https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-09-01&old=1'),/반·날짜 확인/,'a supplied verification address is never swapped');
  }finally{await browser.close();}
});
test('the busy lock is taken before the login wait and only its owner releases it; a cancel while the next day waits for login is kept',{timeout:15000},async()=>{
  const {c,calls}=fakeCollector({lectures:lectures(),scan:false}),b=await bridge(c,18942),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  try{
    let open;const gate=new Promise(r=>open=r);const login=c.requireLogin;c.requireLogin=async()=>{await gate;return login();};
    const first=b.api('sync',{classId:'2',dates:['2026-09-01'],mode:'full'});await sleep(20);
    await assert.rejects(b.api('sync-batch',{classIds:['2'],dates:['2026-09-03']}),/진행 중/,'a second job cannot slip in while the first waits for login');
    await assert.rejects(b.api('sync',{classId:'2',dates:['2026-09-03']}),/진행 중/);
    assert.match(String((await b.api('state?delta=1')).busy),/^start:/);
    open();const job=await b.wait((await first).id);assert.equal(job.status,'complete');
    assert.equal((await b.api('state?delta=1')).busy,null);
    // 다음 날짜가 로그인 확인을 기다리는 동안 누른 '수집 중단'이 지워지지 않습니다.
    calls.openDay.length=0;let waiting=false,go;const hold=new Promise(r=>go=r);
    c.requireLogin=async()=>{if(calls.openDay.length===1&&!waiting){waiting=true;await hold;}};
    const started=await b.api('sync-batch',{classIds:['2'],dates:['2026-09-01','2026-09-03'],mode:'full'});
    for(let i=0;i<200&&!waiting;i++)await sleep(5);assert.ok(waiting);
    await b.api('cancel',{});go();
    const cancelled=await b.wait(started.id);assert.equal(cancelled.status,'cancelled');
    assert.deepEqual(calls.openDay,['2|2026-09-01'],'the second day is not opened');
  }finally{b.app.close();}
});
