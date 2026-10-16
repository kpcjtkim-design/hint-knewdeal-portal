// 체크히어 수집 방향 변경(2026-10-16, 지시 3장): 학생 번호(attendeeId) 1차 키·전화가 안 보이는 줄에서 멈추지 않음(3-1),
// 빠른 수집은 수정창을 열지 않음·정밀 수집은 가린 화면에서 거절(3-2), 첫 스캔으로 날짜 주소를 배워 날마다 주소 이동 한 번(3-3),
// 행 지문은 그대로 두고 학생 번호는 버전 밖 필드(3-4). 가상 학생과 가짜 체크히어(tests/checkhere-fake.mjs)만 씁니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CheckHereCollector,sameTableRow,schedulesOf,pickStudent} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {createLinkStore} from '../links.mjs';
import {version} from '../identity.mjs';
import {alignBySeq,MASKED} from '../masking.mjs';
import {outward} from '../day-data.mjs';
import {fakeSite,roster,urlOf} from './checkhere-fake.mjs';

// 2반 9/1~9/4는 collector.mjs에 주소가 고정돼 있어 다른 날짜를 씁니다.
const D1='2026-10-05',D2='2026-10-06',D3='2026-10-07';
const NEW={attendeeId:'att-ra',name:'라새로',phone:'01000000004',eventList:[]};
mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
const store=records=>createLinkStore(new DatabaseSync(':memory:'),{records:()=>records});
function collector(s,links,options={}){const c=new CheckHereCollector('',{page:s.page,links,dayGapMs:[0,0],...options});for(const [sid,d] of Object.entries(s.w.days))c.urls.set('2|'+d.date,urlOf(sid,d.date));return c;}
async function collect(c,date,options={pageData:true}){const out=[],views=[];await c.collect('2',[date],async r=>{out.push(r);},async()=>{},{...options,onView:v=>views.push(v)});return {records:out,view:views[0]};}
async function bridgeOn(s,port,prefix,options={}){
  const c=new CheckHereCollector('',{page:s.page,dayGapMs:[0,0],...(options.collector||{})});if(options.urls!==false)for(const [sid,d] of Object.entries(s.w.days))c.urls.set(`2|${d.date}`,urlOf(sid,d.date));
  const app=createBridge({dataDir:options.dataDir||mkdtempSync(join(import.meta.dirname,'../test-results/'+prefix)),collector:c,port,approvalCloud:{}});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const headers={'x-hint-key':app.key,'content-type':'application/json',connection:'close'},base=`http://127.0.0.1:${port}/api/`;
  const post=async(path,body={})=>{const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});return {code:r.status,body:await r.json()};};
  const get=async path=>{const r=await fetch(base+path,{headers});return {text:await r.text()};};
  const done=async id=>{for(let i=0;i<600;i++){const j=JSON.parse((await get('state?delta=1')).text).jobs.find(x=>x.id===id);if(j&&j.status!=='running')return j;await new Promise(r=>setTimeout(r,50));}throw Error('작업이 끝나지 않았습니다.');};
  return {app,c,post,get,done};
}

test('page alignment is by sequence first; an odd row alone is left out, a plain row that does not fit drops the whole alignment',()=>{
  const list=[{sequence:2,name:'나**',phone:'010-****-0002',attendeeId:'b'},{sequence:1,name:'가**',phone:'010-****-0001',attendeeId:'a'}];
  const plain=[{seq:'1',name:'가상하나',phone:'010-0000-0001',kind:'plain'},{seq:'2',name:'나가상',phone:'010-0000-0002',kind:'plain'}];
  assert.deepEqual(alignBySeq(plain,list).map(s=>s.attendeeId),['a','b']);
  assert.deepEqual(alignBySeq([plain[0],{seq:'2',name:'나가상',phone:'',kind:'odd'}],list).map(s=>s?.attendeeId),['a','b'],'a row without a phone still aligns by sequence and name');
  assert.deepEqual(alignBySeq([plain[0],{seq:'2',name:'다가상',phone:'',kind:'odd'}],list).map(s=>s?.attendeeId??null),['a',null],'an odd row that does not fit is left alone');
  assert.equal(alignBySeq([{...plain[0],seq:'2'},{...plain[1],seq:'1'}],list),null,'plain rows must all fit');
  assert.equal(alignBySeq(plain,list.slice(1)),null);
  // 학생 번호가 먼저, 없으면 학생 키
  const rows=[{attendeeId:'a',studentKey:'k1'},{attendeeId:'b',studentKey:'k2'},{studentKey:'k3'}];
  assert.deepEqual(pickStudent(rows,{attendeeId:'b',studentKey:'k9'}),[rows[1]]);assert.deepEqual(pickStudent(rows,{studentKey:'k3'}),[rows[2]]);assert.deepEqual(pickStudent(rows,{attendeeId:'x',studentKey:'k1'}),[rows[0]]);
  // 3-4: 학생 번호는 버전·같은 줄 판단을 바꾸지 않고(옛 저장본은 번호 없음), 밖으로 나가는 값에서 빠집니다.
  const r={id:'2_x_k',classId:'2',date:D1,studentKey:'k',name:'가상',schedule:'09:00 ~ 18:00',rawEntry:'09:00:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],tableSignature:'t',source:'live',readState:'complete'};
  assert.equal(version({...r,attendeeId:'att-1'}),version(r),'attendeeId is outside the version');
  assert.equal(sameTableRow(r,{...r,attendeeId:'att-1'}),true,'a stored record from the old build still counts as the same row');
  assert.equal(sameTableRow({...r,attendeeId:'att-2'},{...r,attendeeId:'att-1'}),false,'two different attendee numbers are not the same row');
  assert.deepEqual(outward({records:[{...r,attendeeId:'att-1'}],nested:{attendeeId:'x',keep:1}}),{records:[r],nested:{keep:1}});
  // 일정 목록 JSON: 같은 날짜에 번호가 둘이면 그 날은 버림, 학원 번호는 하나일 때만
  const got=schedulesOf({data:[{scheduleId:'S1',scheduleDate:D1,academyId:'A'},{scheduleId:'S2',timeStart:D2+'T09:00:00',academyId:'A'},{scheduleId:'S3',scheduleDate:D3},{scheduleId:'S4',scheduleDate:D3},{id:'L9',name:'강의'},{scheduleId:'../x',scheduleDate:'2026-10-08'}]});
  assert.deepEqual([...got.dates],[[D1,'S1'],[D2,'S2']]);assert.equal(got.academyId,'A');
});

test('3-1: a row whose phone is not shown no longer stops the day: a linked student is found by attendee number, a new one is counted, every record carries attendeeId',async()=>{
  const s=await fakeSite({S1:{date:D1,students:roster(D1)},S2:{date:D2,students:roster(D2,{extra:[NEW]})}});
  try{
    const stored=[],links=store(stored),c=collector(s,links);
    const first=await collect(c,D1);stored.push(...first.records);
    assert.equal(first.records.length,3);assert.ok(first.records.every(r=>r.readState==='complete'),first.records.map(r=>r.readError).join());
    assert.deepEqual(first.records.map(r=>r.attendeeId).sort(),['att-da','att-ga','att-na']);
    // 다음 날: 나가상(연결됨)과 라새로(처음 옴)의 전화가 표에 보이지 않음. 예전에는 「전화번호 표시가 필요합니다」로 그날 전체가 멈췄습니다.
    s.w.hide=[1,4];
    const second=await collect(c,D2);
    assert.equal(second.records.length,3);assert.equal(second.view.unlinked,1,'only the new student without a link is left out');
    const na1=first.records.find(r=>r.name==='나가상'),na2=second.records.find(r=>r.name==='나가상');
    assert.deepEqual([na2.studentKey,na2.attendeeId,na2.id],[na1.studentKey,'att-na',`2_${D2}_${na1.studentKey}`],'same attendee number on another date → same student key');
    assert.equal(na2.readState,'complete');assert.equal(na2.entryMemo,'지각_담임:가상담임(09:20)');
    assert.equal(await s.page.evaluate(()=>window.clicks.cell),0,'no editor was opened');
    // 연결 없는 학생이 있는 날이어도 원문 줄의 연결은 배웁니다(라새로는 연결 안 됨)
    assert.equal(links.link('2','att-ra'),null);assert.equal(links.link('2','att-na')?.source,'plain-read');
    // 학생 번호가 먼저: 같은 번호의 줄을 다시 찾아 읽습니다(쓰기 재확인과 같은 길, 수정창 없음)
    const again=await c.read(na2);assert.deepEqual([again.id,again.attendeeId,again.readState],[na2.id,'att-na','complete']);
    assert.equal(await s.page.evaluate(()=>window.clicks.cell),0);
  }finally{await s.close();}
});

test('3-4: records stored by the old build (no attendee number) stay unchanged: nothing is re-saved, and no attendee number leaves the bridge',async()=>{
  const s=await fakeSite({S1:{date:D1,students:roster(D1)}});
  const {app,post,get,done}=await bridgeOn(s,18951,'direction-fp-');
  const rows=()=>app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n;
  try{
    let j=await post('sync',{classId:'2',dates:[D1],mode:'incremental'});j=await done(j.body.id);assert.equal(j.status,'complete',j.message);assert.equal(j.count,3);
    // 옛 build 저장본처럼 학생 번호를 뺀 같은 기록을 최신으로 둡니다(버전 그대로).
    for(const p of app.db.prepare('SELECT payload FROM snapshots').all().map(x=>JSON.parse(x.payload))){const {attendeeId,...old}=p;assert.ok(attendeeId);app.put(old);}
    const before=rows();
    j=await post('sync',{classId:'2',dates:[D1],mode:'incremental'});j=await done(j.body.id);
    assert.equal(j.count,0,'no re-save for the old fingerprint');assert.equal(j.skipped,3);assert.equal(rows(),before);
    const state=(await get('state?delta=1')).text,history=(await get('history?id='+encodeURIComponent(JSON.parse(state).records[0].id))).text;
    for(const text of [state,history])assert.ok(!text.includes('attendeeId')&&!text.includes('att-'),'attendee numbers stay on this PC');
  }finally{app.close();await s.close();}
});

test('3-2: a fast read never opens an editor, even for a row that disagrees with the table; precise reading is refused on a masked screen',async()=>{
  const s=await fakeSite({S1:{date:D1,students:roster(D1)}});
  const {app,c,post,done}=await bridgeOn(s,18952,'direction-fast-');
  try{
    // 수정창이 열리지 않는 화면(가린 화면과 같음)이고 한 학생은 표의 퇴실이 화면 데이터와 다름
    s.w.broken=true;s.w.skew=[2];
    let j=await post('sync',{classId:'2',dates:[D1],mode:'incremental'});j=await done(j.body.id);
    assert.equal(j.status,'partial',j.message);assert.equal(j.count,3);assert.equal(j.errors,1);assert.equal(j.method,'page-data');assert.match(j.methodNote,/수정창은 열지 않음/);
    assert.equal(await s.page.evaluate(()=>window.clicks.cell),0,'no sample and no fallback editor');
    const ga=JSON.parse(app.db.prepare("SELECT payload FROM snapshots ORDER BY seq DESC").all().map(x=>x.payload).find(p=>JSON.parse(p).name==='가상하나'));
    assert.equal(ga.readState,'partial');assert.match(ga.readError,/수정창은 열지 않음/);
    // 다시 읽어도 같은 '일부 수집'을 또 쌓지 않습니다
    const n=app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n;j=await post('sync',{classId:'2',dates:[D1],mode:'incremental'});j=await done(j.body.id);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n,n);
    // 가린 화면: 정밀 수집(수정창)은 시작 전에 거절(연결 프로그램), 수집기도 조용히 화면 데이터로 바꾸지 않고 거절
    s.w.mode='masked';await s.page.reload();await c.readHeader();
    for(const [path,body] of [['sync',{classId:'2',dates:[D1]}],['sync-batch',{classIds:['2'],dates:[D1],mode:'full'}]]){
      const r=await post(path,body);assert.equal(r.code,400);assert.match(r.body.error,/MASKED_PRECISE: 정밀 수집\(수정창으로 읽기\)은 가린 화면에서 할 수 없어/);assert.match(r.body.error,/같은 탭/);
    }
    await assert.rejects(()=>c.collect('2',[D1],async()=>{},async()=>{}),/MASKED_PRECISE/);
    assert.equal(await s.page.evaluate(()=>window.clicks.cell),0);
    // 빠른 수집은 가린 화면에서도 됩니다(연결된 학생)
    j=await post('sync',{classId:'2',dates:[D1],mode:'incremental'});j=await done(j.body.id);assert.match(j.message,/가린 화면 1일/);
  }finally{app.close();await s.close();}
});

test('3-3: the first scan learns every day address from the lecture JSON; each day is then one navigation, no 보기 click, no wait for the real-time response, 1-2 s apart',{timeout:120000},async()=>{
  const s=await fakeSite({S1:{date:D1,students:roster(D1)},S2:{date:D2,students:roster(D2)},S3:{date:D3,students:roster(D3)}});
  const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/direction-nav-'));
  const {app,c,post,done}=await bridgeOn(s,18953,'direction-nav-',{urls:false,dataDir,collector:{dayGapMs:[1000,2000]}});
  try{
    assert.deepEqual(new CheckHereCollector('').dayGapMs,[1000,2000],'the default pause between days is 1-2 s');
    s.w.trueDelayMs=8000;// '실제 시간 기반'으로 오는 두 번째 응답이 늦어도 기다리지 않습니다
    let j=await post('sync-batch',{classIds:['2'],dates:[D1,D2,D3],mode:'incremental'});j=await done(j.body.id);
    assert.equal(j.status,'complete',j.message);assert.equal(j.count,9);assert.equal(j.pageDays,3);
    assert.deepEqual([s.w.pages.home,s.w.pages.lecture,s.w.viewClicks,s.w.dayLoads.length],[1,1,0,3],'one scan, no 보기 click for a day, one navigation per day');
    const gaps=s.w.dayLoads.slice(1).map((x,i)=>x.at-s.w.dayLoads[i].at);
    assert.ok(gaps.every(g=>g>=1000),`days are 1-2 s apart: ${gaps}`);assert.ok(gaps.every(g=>g<6500),`no 6-second wait for the second response (the old wait alone made 7 s or more): ${gaps}`);
    const places=app.db.prepare("SELECT key FROM places ORDER BY key").all().map(x=>x.key);
    assert.deepEqual(places,[`2|${D1}`,`2|${D2}`,`2|${D3}`,'lecture|2'],'learned addresses are remembered across restarts');
    assert.equal(c.urls.get(`2|${D2}`),urlOf('S2',D2));
    // 다시 시작해도 배운 주소로 바로 갑니다(스캔 없음)
    app.close();const before={...s.w.pages};
    const again=await bridgeOn(s,18954,'direction-nav2-',{urls:false,dataDir});
    try{j=await again.post('sync',{classId:'2',dates:[D3],mode:'incremental'});j=await again.done(j.body.id);assert.equal(j.status,'complete',j.message);
      assert.deepEqual([s.w.pages.home,s.w.pages.lecture,s.w.viewClicks],[before.home,before.lecture,0]);}finally{again.app.close();}
    // 기억한 주소가 다른 날의 화면 데이터를 열면(일정 번호가 바뀜) 그날을 믿지 않고 다시 찾습니다
    const fresh=new CheckHereCollector('',{page:s.page,dayGapMs:[0,0]});fresh.urls.set(`2|${D1}`,urlOf('S1',D1));s.w.dataDate=D2;
    await assert.rejects(()=>fresh.openDayOnce('2',D1,urlOf('S1',D1)),/화면 데이터 날짜가 다름/);s.w.dataDate=null;
  }finally{try{app.close();}catch{}await s.close();}
});

test('3-3: a single-day sync that does not know the day learns it from the lecture JSON instead of clicking 보기',async()=>{
  const s=await fakeSite({S1:{date:D1,students:roster(D1)},S2:{date:D2,students:roster(D2)}});
  try{
    const c=new CheckHereCollector('',{page:s.page,dayGapMs:[0,0]});
    const url=await c.discover('2',D2);assert.equal(url,urlOf('S2',D2));
    assert.deepEqual([s.w.pages.lecture,s.w.viewClicks],[1,0]);assert.equal(c.urls.get(`2|${D1}`),urlOf('S1',D1),'the other day is remembered too');
    const {records}=await collect(c,D2);assert.equal(records.length,3);assert.equal(s.w.viewClicks,0);
  }finally{await s.close();}
});
