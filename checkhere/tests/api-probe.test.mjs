import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
import {createBridge,BUILD} from '../server.mjs';
import {runApiProbe,summarizeApi,analyzeBody,compareIds,endpointOf,dayIds,defaultDates,previousWeekday,maskState,keyName,responseEntry,finishReport,cleanMessage} from '../probe-api.mjs';

// Virtual students, ids and token only. The fake CheckHere page and API are Playwright routes:
// nothing leaves this PC, and every other address is aborted.
const TOKEN='FAKE-TOKEN-7Q2W9XK4',ACADEMY='ACADEMY-FAKE',LECTURE='1ECA0000-0000-4000-8000-00000000000A';
const SCHED={'2026-10-15':'5C4ED015-0000-4000-8000-000000000015','2026-10-14':'5C4ED014-0000-4000-8000-000000000014','2026-10-13':'5C4ED013-0000-4000-8000-000000000013'};
const dayUrl=(d,s=SCHED[d])=>`https://check.ihereapp.com/history/lecture/modify?tab=STUDENT&academyId=${ACADEMY}&lectureId=${LECTURE}&scheduleId=${s}&scheduleDate=${d}`;
const API='https://checkhere-admin-api.ihereapp.com/api/v3/';
const S=n=>({attendeeId:`A77E000${n}-0000-4000-8000-0000000000A${n}`,userId:`B5E4000${n}-0000-4000-8000-0000000000B${n}`});
const STUDENTS={
  1:{...S(1),name:'가상하나',phone:'010-1111-0001',memo:'가상메모학번A1',events:[{type:'ENTER',eventId:'CE110001-0000-4000-8000-0000000000C1',t:'08:55:31'},{type:'PASS',eventId:null,t:'08:55:31'},{type:'COMPLETE',eventId:'CE110002-0000-4000-8000-0000000000C2',t:'17:50:08'}]},
  2:{...S(2),name:'가상둘',phone:'010-1111-0002',memo:'',events:[{type:'ENTER',eventId:null,t:'08:50:03'},{type:'ATTEND',eventId:'CE110003-0000-4000-8000-0000000000C3',t:'08:50:03',memo:'가상사유_교통지연'},{type:'COMPLETE',eventId:'CE110004-0000-4000-8000-0000000000C4',t:'17:51:42'}]},
  3:{...S(3),name:'가상셋',phone:'010-1111-0003',memo:'가상메모학번A3',events:[]},
  4:{...S(4),name:'가상넷',phone:'010-1111-0004',memo:'가상메모학번A4',events:[]},
};
const ROSTER={'2026-10-14':[1,2,3],'2026-10-13':[1,2,3],'2026-10-15':[1,2,4]};
const SECRETS=[TOKEN,'7Q2W9XK4','가상','가**','010-','0101111','1111-000','****-000','가상메모','가상사유','교통지연','08:55','17:50','08:50','17:51','09:00:00','A77E000','B5E4000','CE11000','5C4ED01','1ECA0000','ACADEMY-FAKE','admin@example.test','JohnKim','kimms01','Hong_GilDong','johnkim','1234-5678'];
const maskName=s=>s[0]+'**',maskPhone=p=>p.replace(/-\d{4}-/,'-****-');
function detail(date,{apiMasked,roster=ROSTER[date],nullIds=[],idKey='attendeeId'}){
  return {txid:'tx-fake',code:200,message:'OK',description:null,timestamp:`${date}T09:00:00`,data:{countMap:{ENTER:2,COMPLETE:2,ATTEND:[1]},scheduleDate:date,eventResultList:roster.map((n,i)=>{const s=STUDENTS[n];return {
    sequence:i+1,[idKey]:nullIds.includes(n)?null:s.attendeeId,typeAttendee:'STUDENT',name:apiMasked?maskName(s.name):s.name,userName:apiMasked?maskName(s.name):s.name,phone:apiMasked?maskPhone(s.phone):s.phone,
    identifier:apiMasked&&s.memo?'**************':s.memo,duration:'PT9H',seconds:32400,leaveEvents:{totalLeavedDuration:'PT0S',totalLeavedSeconds:0,pairs:[]},
    eventList:s.events.map(e=>({eventId:e.eventId,userId:s.userId,time:`${date}T${e.t}`,baseTime:`${date}T09:00:00`,timeIndex:0,type:e.type,isRecognized:false,status:'NORMAL',memoByAdmin:e.memo?(apiMasked?'********':e.memo):null,updatedAt:null}))};})}};
}
// 가림: 해제 버튼과 가린 명단. 원문: '해제됨' 글자가 든 버튼(글자가 똑같지 않으면 가림 표시로 보지 않음)과 원문 명단.
// null: 머리글이 다른 표(명단을 읽지 못함)와 해제 버튼.
function page(date,{pageMasked,usesRange}){
  const header=pageMasked===false?'<button>개인정보 마스킹 해제됨 09:41</button><button>연장</button><button>종료</button>':'<button>개인정보 마스킹 해제</button>';
  const rows=(ROSTER[date]||[]).map((n,i)=>{const s=STUDENTS[n];return `<tr><td><input type="checkbox"></td><td>${i+1}</td><td>${pageMasked===false?s.name:maskName(s.name)}</td><td>${pageMasked===false?s.phone:maskPhone(s.phone)}</td></tr>`;}).join('');
  return `<!doctype html><meta charset="utf-8"><body><a href="/account/admin">관리자</a><header>${header}</header>
<table><tr><td colspan="4">[2반] 가상강의 출석부</td></tr><tr><td></td><td>순번</td><td>${pageMasked===null?'이름':'성명'}</td><td>전화번호</td></tr>${rows}<tr><td colspan="4">합계</td></tr></table>
<table><tr><td>강의시간</td></tr></table>
<script>const API='${API.slice(0,-1)}',q=new URLSearchParams(location.search);
fetch('/api/auth/session').then(r=>r.json()).then(s=>{if(!s.accessToken)return;const h={headers:{Authorization:'Bearer '+s.accessToken}};
 fetch(API+'/history/attendee/detail/academy/'+q.get('academyId')+'/schedule/'+q.get('scheduleId')+'/type/STUDENT/isRealTime/false',h);
 ${usesRange?"fetch(API+'/schedule/list/lecture/'+q.get('lectureId')+'/start/2026-10-01T00:00:00/end/2026-10-31T23:59:59',h);":''}});</script>`;
}
// Fake CheckHere: the page, its NextAuth session and the read API. Every session read and API request is logged.
async function fakeSite(context,{pageMasked=true,apiMasked=true,usesRange=false,session=true}={}){
  const log=[];await context.route('**/*',route=>route.abort());
  await context.route('https://check.ihereapp.com/**',route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/auth/session'){log.push({host:'session'});return route.fulfill({contentType:'application/json',body:JSON.stringify(session?{user:{name:'가상관리자',email:'admin@example.test'},expires:'2026-11-01T00:00:00.000Z',accessToken:TOKEN}:{})});}
    return route.fulfill({contentType:'text/html; charset=utf-8',body:page(u.searchParams.get('scheduleDate'),{pageMasked,usesRange})});
  });
  await context.route(API.slice(0,-'api/v3/'.length)+'**',async route=>{
    const req=route.request(),u=new URL(req.url()),path=u.pathname.replace('/api/v3/',''),headers={'access-control-allow-origin':'https://check.ihereapp.com','access-control-allow-headers':'authorization, content-type','access-control-allow-methods':'GET'};
    const auth=(await req.allHeaders()).authorization;log.push({host:'api',method:req.method(),path,auth:auth==='Bearer '+TOKEN});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const json=(status,body)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
    if(auth!=='Bearer '+TOKEN)return json(401,{code:401,message:'인증 정보가 없습니다.'});
    const date=Object.keys(SCHED).find(d=>path.includes(SCHED[d]));
    if(/^history\/attendee\/detail\//.test(path))return json(200,detail(date,{apiMasked}));
    if(/^schedule\/list\/lecture\//.test(path))return json(200,{code:200,data:Object.keys(SCHED).map(d=>({scheduleId:SCHED[d],scheduleDate:d}))});
    return json(404,{code:404,message:'없음'});
  });
  return log;
}
const fakeCollector=(p,{noLecture=[]}={})=>{const asked=[];return {page:p,asked,discover:async(c,d)=>{asked.push(d);if(noLecture.includes(d)||!SCHED[d])throw Error(`${d} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);return dayUrl(d);}};};
async function withBrowser(fn){
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true});
  try{const context=await browser.newContext(),p=await context.newPage();p.setDefaultTimeout(5000);return await fn(context,p);}finally{await browser.close();}
}
const reportText=r=>{const {createdAt,...rest}=r;return JSON.stringify(rest)+summarizeApi(r);};
const noSecrets=(text,label='')=>{for(const s of SECRETS)assert(!text.includes(s),`${label} leaked ${s}`);};
// The bridge sends nothing of its own: every session read and API request comes from the page script, once per page load.
const pageOnly=(log,loads)=>{
  const api=log.filter(x=>x.host==='api'&&x.method!=='OPTIONS');
  for(const x of api){assert.equal(x.method,'GET',x.path);assert.match(x.path,/^history\/attendee\/detail\/.+\/isRealTime\/false$|^schedule\/list\//);assert(x.auth,'the page uses its own session');}
  assert.equal(api.filter(x=>x.path.startsWith('history/attendee/detail/')).length,loads,'one attendance-detail read per page load');
  assert.equal(log.filter(x=>x.host==='session').length,loads,'the session is read only by the page itself');
};
const report=bodies=>{const e=bodies.map(([date,b])=>responseEntry(b,date));return finishReport({classId:'2',dates:bodies.map(([d])=>d),pageRequests:{},
  days:e.map((x,i)=>({day:i+1,date:bodies[i][0],page:maskState({table:true,rows:3,phoneMasked:3,nameMasked:3}),response:{found:true,status:200,ok:true,realTime:false,json:true,...x.response}}))},e.map(x=>x.internal));};

test('page requests are counted by endpoint template only, and day addresses give their ids',()=>{
  const d=dayIds(dayUrl('2026-10-14'));assert.deepEqual({...d,url:undefined},{url:undefined,academyId:ACADEMY,lectureId:LECTURE,scheduleId:SCHED['2026-10-14'],date:'2026-10-14'});
  assert.equal(endpointOf(`${API}history/attendee/detail/academy/${ACADEMY}/schedule/${SCHED['2026-10-14']}/type/STUDENT/isRealTime/false`),'history/attendee/detail/academy/{id}/schedule/{id}/type/STUDENT/isRealTime/false');
  assert.equal(endpointOf(`${API}schedule/list/lecture/${LECTURE}/start/2026-10-01T00:00:00/end/2026-10-31T23:59:59`),'schedule/list/lecture/{id}/start/{id}/end/{id}');
  assert.equal(endpointOf(`${API}history/event/delete`),'history/event/delete');assert.equal(endpointOf(`${API}history/event/update?name=x`),'history/event/update?…');
  for(const odd of [`${API}student/010-1234-5678/JohnKim`,`${API}history/attend/times/academy/a/lecture/b/date/2026-10-14/kimms01`,'https://evil.example/api/v3/history/event/delete','아무 글자'])assert.equal(endpointOf(odd),'{other}',odd);
  assert.equal(cleanMessage(`page.goto: Timeout 20000ms exceeded navigating to "${dayUrl('2026-10-14')}"`),'page.goto: Timeout 20000ms exceeded navigating to "check.ihereapp.com/…"');
  assert.equal(dayIds('https://evil.example/history/lecture/modify?academyId=a&lectureId=b&scheduleId=c&scheduleDate=2026-10-14'),null);
  assert.equal(dayIds('https://check.ihereapp.com/history/lecture/modify?academyId=a&lectureId=b/../x&scheduleId=c&scheduleDate=2026-10-14'),null);
  assert.equal(dayIds('https://check.ihereapp.com/history/lecture/modify?academyId=a&lectureId=b&scheduleId=c&scheduleDate=2026-02-30'),null);
  assert.equal(dayIds('아무 글자'),null);
});
test('default dates are today (Korean time) and the weekday before; weekends fall back to Friday',()=>{
  assert.deepEqual(defaultDates(new Date('2026-10-15T03:00:00Z')),{date1:'2026-10-15',date2:'2026-10-14'});
  assert.deepEqual(defaultDates(new Date('2026-10-18T16:00:00Z')),{date1:'2026-10-19',date2:'2026-10-16'},'Monday 01:00 KST is still Sunday in UTC; Monday counts');
  assert.deepEqual(defaultDates(new Date('2026-10-18T03:00:00Z')),{date1:'2026-10-16',date2:'2026-10-15'},'Sunday → Friday');
  assert.equal(previousWeekday('2026-10-19'),'2026-10-16');
});
test('the screen state comes from the roster cells; the unmask button is only a hint',()=>{
  assert.equal(maskState({table:true,rows:3,phoneMasked:3,nameMasked:3}).masked,true);
  assert.equal(maskState({table:true,rows:3,phonePlain:3}).masked,false);
  assert.equal(maskState({table:true,rows:3,phonePlain:2,phoneMasked:1}).masked,null,'mixed cells');
  assert.equal(maskState({table:true,rows:3,phonePlain:3,nameMasked:1}).masked,null,'plain phones but masked names');
  assert.deepEqual(maskState({button:true}),{masked:null,table:false,rows:0,phoneMasked:0,phonePlain:0,nameMasked:0,button:true},'no readable roster');
  assert.equal(maskState().masked,null);
});
test('masked and unmasked student lists are told apart by counts only',()=>{
  const masked=analyzeBody(detail('2026-10-14',{apiMasked:true})),plain=analyzeBody(detail('2026-10-14',{apiMasked:false}));
  const fields=a=>Object.fromEntries(a.students[0].fields.map(f=>[f.key,[f.kind,f.masked,f.plain,f.empty]]));
  assert.deepEqual(fields(masked),{name:['name',3,0,0],userName:['name',3,0,0],phone:['phone',3,0,0],identifier:['memo',2,0,1]});
  assert.deepEqual(fields(plain),{name:['name',0,3,0],userName:['name',0,3,0],phone:['phone',0,3,0],identifier:['memo',0,2,1]});
  const g=masked.students[0];assert.equal(g.path,'$.data.eventResultList');assert.equal(g.records,3);assert.equal(g.attendeeKey,'attendeeId');
  assert.deepEqual(g.ids.find(i=>i.key==='attendeeId'),{key:'attendeeId',present:3,missing:0,unique:true,duplicates:0});
  assert.deepEqual(g.userIdPerStudent,{one:2,several:0,none:1},'the student without records still has an attendeeId');
  const ev=g.events[0];assert.equal(ev.key,'eventList');assert.equal(ev.emptyLists,1);
  assert.deepEqual({...ev.types},{ENTER:{count:2,eventId:1,noEventId:1,memo:0,memoMasked:0,noMemo:2},PASS:{count:1,eventId:0,noEventId:1,memo:0,memoMasked:0,noMemo:1},COMPLETE:{count:2,eventId:2,noEventId:0,memo:0,memoMasked:0,noMemo:2},ATTEND:{count:1,eventId:1,noEventId:0,memo:1,memoMasked:1,noMemo:0}});
  assert.equal(plain.students[0].events[0].types.ATTEND.memoMasked,0);
  assert(masked.shape.paths.some(p=>p.path==='$.data.eventResultList[].phone'&&p.masked===3));
  assert.deepEqual(masked.shape.paths.find(p=>p.path==='$.data.eventResultList'),{path:'$.data.eventResultList',types:['array'],count:1,minLength:3,maxLength:3});
  noSecrets(JSON.stringify([masked.shape,masked.students,plain.shape,plain.students]),'analysis');
  const x=compareIds(masked.internal[0],analyzeBody(detail('2026-10-15',{apiMasked:false})).internal[0]);
  assert.deepEqual(x,{first:3,second:3,common:2,onlyFirst:1,onlySecond:1,userIdCompared:2,userIdSame:2,userIdDifferent:0});
  assert.equal(compareIds(masked.internal[0],null),null);
});
test('students without an attendeeId, another id key or a response for the wrong day never read as a match',()=>{
  const nulls={apiMasked:true,roster:[1,2,3,4],nullIds:[3,4]},r=report([['2026-10-14',detail('2026-10-14',nulls)],['2026-10-13',detail('2026-10-13',nulls)]]);
  assert.deepEqual(r.verdict.attendee,{key:'attendeeId',present:false,missing:[2,2],unique:true,acrossDates:'missing'});
  const s=summarizeApi(r);assert.match(s,/- attendeeId: 없는 학생 있음\(1일째 2명 · 2일째 2명\)/);assert.match(s,/두 날짜 비교: 번호 없는 학생 있음/);assert.doesNotMatch(s,/다시 찾을 수 있어/);
  // attendeeId 대신 studentId만 있으면 그 이름으로 적습니다.
  const alt={apiMasked:true,idKey:'studentId'},r2=report([['2026-10-14',detail('2026-10-14',alt)],['2026-10-13',detail('2026-10-13',alt)]]),s2=summarizeApi(r2);
  assert.deepEqual(r2.verdict.attendee,{key:'studentId',present:true,missing:[0,0],unique:true,acrossDates:'yes'});
  assert.match(s2,/- studentId: 모든 학생에게 있음/);assert.match(s2,/studentId로 날짜가 달라도/);assert.match(s2,/studentId와 포털 학생\(이름·전화번호\) 연결은 학생마다 한 번 원문 확인이 필요합니다/);assert.doesNotMatch(s2,/attendeeId/);
  // 둘째 날 주소가 첫날 응답을 받으면(응답 날짜가 다름) 비교하지 않습니다.
  const r3=report([['2026-10-14',detail('2026-10-14',{apiMasked:true})],['2026-10-13',detail('2026-10-14',{apiMasked:true})]]);
  assert.equal(r3.days[1].response.dateMatches,false);assert.equal(r3.verdict.attendee.acrossDates,'unknown');assert.match(summarizeApi(r3),/응답 날짜가 다름/);
  noSecrets(reportText(r)+reportText(r2)+reportText(r3),'reports');
});
test('unknown shapes never crash and keys that look like values are not written',()=>{
  let deep={};const root=deep;for(let i=0;i<60;i++)deep=deep.next={};
  for(const body of [null,'가상하나',12,true,[],[[[]]],{data:{eventResultList:'x'}},{data:{eventResultList:[null,1,'x',{name:null,phone:12}]}},root,{huge:Array.from({length:300000},(_,i)=>i)},{list:[{phone:'010-1111-0001',eventList:'x',userId:{}}]}]){
    const a=analyzeBody(body);assert(Array.isArray(a.shape.paths));assert(Array.isArray(a.students));
  }
  assert(analyzeBody(root).shape.truncated);assert(analyzeBody({huge:Array.from({length:300000},(_,i)=>i)}).shape.truncated);
  const odd=analyzeBody({'가상하나':{'010-1111-0001':1},[S(1).attendeeId]:2,'01011110001':3,'admin@example.test':4,'0f8fad5bd9cb469fa16570867728950e':5,__proto__x:6});
  assert.deepEqual(odd.shape.paths.map(p=>p.path),['$','$.{key}','$.{key}.{key}','$.{n}']);
  // 로마자 이름·로그인 id·대시 전화번호로 만든 키는 {key}. 기록마다 되풀이되는 필드 이름 모양 키만 그대로 적습니다.
  const roman=analyzeBody({data:{times:{JohnKim:1,kimms01:{n:1},Hong_GilDong:2,johnkim:3,'010-1234-5678':4},list:[{newField:1,JohnKim:1,phone:'010-****-0001'},{newField:2,kimms01:2,phone:'010-****-0002'}]}});
  const paths=roman.shape.paths.map(p=>p.path);assert(paths.includes('$.data.{key}.{key}'),JSON.stringify(paths));assert(paths.includes('$.data.{key}[].newField'),JSON.stringify(paths));
  noSecrets(JSON.stringify([roman.shape,roman.students]),'value keys');
  for(const k of ['eventResultList','attendeeId','memoByAdmin'])assert.equal(keyName(k),k);
  for(const k of ['JohnKim','kimms01','Hong_GilDong','johnkim','__proto__x','010-1234-5678'])assert.equal(keyName(k),'{key}',k);
});
test('a discovery that runs past its time limit keeps the job until it stops clicking',async()=>{
  let done=false;const collector={page:{on(){},off(){},url:()=>'about:blank'},discover:async(c,d)=>{await new Promise(r=>setTimeout(r,300));done=true;return dayUrl(d);}};
  await assert.rejects(runApiProbe({collector,classId:'2',date1:'2026-10-14',date2:'2026-10-13',discoverTimeoutMs:50}),/2026-10-14 출결상세 화면을 찾지 못했습니다/);
  assert.equal(done,true,'the job ends only after the discovery has stopped');
});
test('masked page: only the response the page loads itself, value-free report with masking counts and attendeeId checks',{timeout:60000},async()=>{
  await withBrowser(async(context,p)=>{
    const log=await fakeSite(context,{pageMasked:true,apiMasked:true}),collector=fakeCollector(p),steps=[];
    const r=await runApiProbe({collector,classId:'2',date1:'2026-10-14',date2:'2026-10-13',log:t=>steps.push(t),indicatorWaitMs:1000});
    assert.deepEqual(collector.asked,['2026-10-14','2026-10-13']);assert.deepEqual(r.dates,['2026-10-14','2026-10-13']);assert.equal(r.sameLecture,true);
    for(const d of r.days)assert.deepEqual(d.page,{masked:true,table:true,rows:3,phoneMasked:3,phonePlain:0,nameMasked:3,button:true});
    assert.deepEqual(r.days.map(d=>[d.response.found,d.response.status,d.response.ok,d.response.realTime,d.response.dateMatches,d.response.apiCode]),[[true,200,true,false,true,'200'],[true,200,true,false,true,'200']]);
    assert.equal(r.verdict.page,true);assert.equal(r.verdict.names.state,'masked');assert.equal(r.verdict.names.masked,12);assert.equal(r.verdict.phones.masked,6);assert.deepEqual([r.verdict.memos.masked,r.verdict.memos.empty],[4,2]);
    assert.deepEqual(r.verdict.attendee,{key:'attendeeId',present:true,missing:[0,0],unique:true,acrossDates:'yes'});assert.deepEqual(r.verdict.responses,{found:2,ok:2,total:2});
    assert.deepEqual(r.compare.acrossDates,{first:3,second:3,common:3,onlyFirst:0,onlySecond:0,userIdCompared:2,userIdSame:2,userIdDifferent:0});
    assert.equal(r.pageRequests['GET history/attendee/detail/academy/{id}/schedule/{id}/type/STUDENT/isRealTime/false → 200'],2,JSON.stringify(r.pageRequests));
    const summary=summarizeApi(r);
    assert.match(summary,/체크히어에 따로 보낸 요청: 없음/);assert.match(summary,/1일째 2026-10-14: 화면 가림 \(명단 전화번호 가림 3\/3\) · 출결상세 응답 200 \(허용 시간\)/);
    assert.match(summary,/이름 가림\(가림 12 · 원문 0\)/);assert.match(summary,/attendeeId: 모든 학생에게 있음 · 하루 안에서 겹침 없음 · 두 날짜 공통 3명/);
    assert.match(summary,/attendeeId로 날짜가 달라도 같은 학생을 다시 찾을 수 있어 보입니다/);assert.match(summary,/수집\(읽기\)만 해당: 수정·삭제는 여전히 해제가 필요하고/);assert.doesNotMatch(summary,/참고/);
    noSecrets(reportText(r),'report');noSecrets(steps.join('\n'),'progress');pageOnly(log,2);
  });
});
test('unmasked page with automatic dates: skips a day without a lecture and compares ids across dates',{timeout:60000},async()=>{
  await withBrowser(async(context,p)=>{
    const log=await fakeSite(context,{pageMasked:false,apiMasked:false,usesRange:true}),collector=fakeCollector(p,{noLecture:['2026-10-14']});
    const r=await runApiProbe({collector,classId:'2',now:new Date('2026-10-15T03:00:00Z'),indicatorWaitMs:1000});
    assert.deepEqual(collector.asked,['2026-10-15','2026-10-14','2026-10-13']);assert.deepEqual(r.dates,['2026-10-15','2026-10-13']);assert.deepEqual(r.autoDates,{first:true,second:true});
    assert.deepEqual(r.days.map(d=>[d.page.masked,d.page.button]),[[false,false],[false,false]],'a control that only contains the unmask words is not read as masked');
    assert.equal(r.verdict.names.state,'plain');assert.equal(r.verdict.phones.plain,6);assert.equal(r.verdict.plainUnconfirmed,false);
    assert.deepEqual(r.compare.acrossDates,{first:3,second:3,common:2,onlyFirst:1,onlySecond:1,userIdCompared:2,userIdSame:2,userIdDifferent:0});
    assert.equal(r.verdict.attendee.acrossDates,'partial');const s=summarizeApi(r);assert.match(s,/원문 표시 중/);assert.match(s,/일부만 같습니다/);assert.doesNotMatch(s,/참고/);
    assert.equal(r.pageRequests['GET schedule/list/lecture/{id}/start/{id}/end/{id} → 200'],2,'the page’s own calls are counted by template');
    noSecrets(reportText(r),'report');pageOnly(log,2);
  });
});
test('plain response values while the page is masked or not readable: counted, never written, and flagged for a policy check',{timeout:90000},async()=>{
  for(const pageMasked of [true,null])await withBrowser(async(context,p)=>{
    const log=await fakeSite(context,{pageMasked,apiMasked:false});
    const r=await runApiProbe({collector:fakeCollector(p),classId:'2',date1:'2026-10-14',date2:'2026-10-13',indicatorWaitMs:500});
    assert.equal(r.verdict.page,pageMasked);assert.equal(r.verdict.names.state,'plain');assert.equal(r.verdict.plainUnconfirmed,true);
    const s=summarizeApi(r);assert.match(s,/참고: 화면이 원문 표시로 확인되지 않았는데 출결상세 응답의 이름·전화번호·메모에 원문이 있습니다/);
    if(pageMasked===null)assert.match(s,/화면 확인 못 함 \(학생 명단 표를 읽지 못함\) · 해제 버튼 보임/);
    noSecrets(reportText(r),'report');pageOnly(log,2);
  });
});
test('no page session: nothing is read or compared; one schedule for two dates or a bad address stops early',{timeout:60000},async()=>{
  await withBrowser(async(context,p)=>{
    const log=await fakeSite(context,{session:false});
    const r=await runApiProbe({collector:fakeCollector(p),classId:'2',date1:'2026-10-14',date2:'2026-10-13',indicatorWaitMs:300,responseTimeoutMs:1500});
    assert.deepEqual(r.days.map(d=>d.response),[{found:false},{found:false}]);assert.equal(r.verdict.attendee.acrossDates,'unknown');
    assert.equal(log.filter(x=>x.host==='api').length,0,'no API request at all');assert.match(summarizeApi(r),/두 날 모두 읽지 못해 비교하지 못했습니다/);
    await assert.rejects(runApiProbe({collector:fakeCollector(p),classId:'2',date1:'2026-10-14',date2:'2026-10-12'}),/강의가 없습니다/,'an explicit date is never replaced');
    await assert.rejects(runApiProbe({collector:fakeCollector(p),classId:'2',url:'https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-10-14',date2:'2026-10-13'}),/출결상세 화면 주소/);
    await assert.rejects(runApiProbe({collector:{page:p,discover:async(c,d)=>dayUrl(d,SCHED['2026-10-14'])},classId:'2',date1:'2026-10-14',date2:'2026-10-13'}),/같은 일정 번호/);
  });
});

test('the bridge runs the diagnosis as a keyed job and saves only the value-free report',{timeout:90000},async()=>{
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/api-probe-bridge-'));
  await withBrowser(async(context,p)=>{
    const log=await fakeSite(context,{pageMasked:true,apiMasked:true});await p.goto(dayUrl('2026-10-14'));await p.waitForLoadState('networkidle');const pageOwn=log.length;
    const collector=new CheckHereCollector(dataDir,{page:p});for(const d of ['2026-10-14','2026-10-13'])collector.urls.set(`2|${d}`,dayUrl(d));
    const app=createBridge({dataDir,collector,port:18941});await new Promise(r=>app.server.listen(18941,'127.0.0.1',r));
    try{
      const call=async(path,body,key=app.key)=>{const res=await fetch('http://127.0.0.1:18941/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(key?{'x-hint-key':key}:{}),connection:'close'},body:body&&JSON.stringify(body)});return {status:res.status,body:await res.json()};};
      const session=(await call('session',null,null)).body;assert(session.capabilities.includes('api-probe-v1'));assert.equal(session.build,BUILD);
      const ok={classId:'2',date1:'2026-10-14',date2:'2026-10-13'};
      assert.equal((await call('api-probe',ok,'0'.repeat(64))).status,401,'wrong key');assert.equal((await call('api-probe',ok,null)).status,401,'no key');
      for(const bad of [{...ok,classId:'99'},{...ok,date2:'2026-10-14'},{...ok,date1:'2026-13-01'},{...ok,url:'https://evil.example/history/lecture/modify'}])assert.equal((await call('api-probe',bad)).status,400,JSON.stringify(bad));
      assert.equal(log.length,pageOwn,'rejected requests reach nothing');
      const started=await call('api-probe',ok);assert.equal(started.status,202);assert.equal(started.body.kind,'api-probe');
      assert.equal((await call('api-probe',ok)).status,409,'one diagnosis at a time');
      let job;for(let i=0;i<400;i++){job=(await call('state?delta=1')).body.jobs.find(j=>j.id===started.body.id);if(job.status!=='running')break;assert.equal(job.progress,undefined,'the portal status line keeps its own progress shape');await new Promise(r=>setTimeout(r,50));}
      assert.equal(job.status,'complete',job.message);assert.deepEqual(job.dates,['2026-10-14','2026-10-13']);assert.match(job.summary,/두 날짜 공통 3명/);
      assert(existsSync(job.report));assert.deepEqual(readdirSync(join(dataDir,'probe')).map(f=>f.replace(/-\d{4}-\d{2}-\d{2}T\d{4}\.json$/,'-*.json')),['api-probe-2-2026-10-14_2026-10-13-*.json']);
      const saved=JSON.parse(readFileSync(job.report,'utf8'));assert.equal(saved.verdict.names.state,'masked');assert.equal(saved.source,'page-response');
      noSecrets(reportText(saved),'saved report');noSecrets(JSON.stringify({...job,startedAt:0,finishedAt:0}),'job');
      assert.equal(app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n,0,'diagnosis does not touch collected records');
      assert.equal((await call('state?delta=1')).body.busy,null);pageOnly(log.slice(pageOwn),2);
    }finally{app.close();}
  });
});
