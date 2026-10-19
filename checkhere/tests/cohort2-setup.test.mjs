// 2기 연결 프로그램: 명단 불러오기(생년월일 선택), 반→강의 이름 규칙·직접 연결, 처음 설치 모드(반별 원문 확인 → 사람이 확인 → 운영포털에서 승인 계정으로 등록), 내보내기.
// 가상 학생·가짜 체크히어·가짜 승인 저장소만 씁니다(포트 18601~18609). 실제 체크히어·Firebase·127.0.0.1:8765/8766에 닿지 않습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createBridge,BUILD,OLD_DATA} from '../server.mjs';
import {CheckHereCollector,ruleMatches,ruleClass,oldLectureRow,lectureLabel,presetLecture} from '../collector.mjs';
import {parseRoster,rosterKeys,birthOf,classFrom,createRosterStore} from '../roster.mjs';
import {buildReport,reportView,reportCounts,confirmList,pairRow,cleanStudents,exportText,createSetupStore} from '../setup.mjs';
import {createApprovalCloud} from '../cloud-approval.mjs';
import {unmaskReason} from '../masking.mjs';
import {studentKey,recordId,version} from '../identity.mjs';
import {CLASS_IDS,BRIDGE_PORT,validIso,classOk,FIREBASE_MISSING} from '../cohort-bridge.mjs';
import {fakeSite,roster as fakeRoster} from './checkhere-fake.mjs';

const D='2026-10-28',NAMES=['가상하나','가상둘','가상셋','가상넷','가상다섯','가상여섯','01011110001'];
mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
const dir=p=>mkdtempSync(join(import.meta.dirname,'../test-results/'+p));
test('2기 값: 16개 반, 포트 8766, 2026·2027 날짜, build',()=>{
  assert.deepEqual(CLASS_IDS,Array.from({length:16},(_,i)=>String(i+1)));assert.equal(classOk('16'),true);assert.equal(classOk('17'),false);
  assert.equal(BRIDGE_PORT,8766);assert.match(BUILD,/^2기-\d{8}\.\d+$/);
  assert.equal(validIso('2027-01-22'),true);assert.equal(validIso('2028-01-03'),false);assert.equal(validIso('2026-02-30'),false);
  assert.match(OLD_DATA(3),/2026-10-28.*새 폴더/);
});
test('명단: 칸·머리말·반 이름·생년월일(선택), 오류는 줄 번호만',()=>{
  assert.deepEqual([classFrom('3'),classFrom('3반'),classFrom('후인원A'),classFrom('_서울대'),classFrom('서울대'),classFrom('[현대자동차그룹 HINT] 대전(유성구)_제조지능화_후인원B'),classFrom('17'),classFrom('1기 2반')],['3','3','3','1','1','4',null,null]);
  assert.deepEqual([birthOf(''),birthOf('1999-03-02'),birthOf('1999.3.2'),birthOf('19990302'),birthOf('990302'),birthOf('020101'),birthOf('1999-02-30'),birthOf('가나')],['','1999-03-02','1999-03-02','1999-03-02','1999-03-02','2002-01-01',null,null]);
  const head=parseRoster('반,이름,연락처,생년월일\n3,가상하나,010-1111-0001,1999-03-02\n3,가상둘,0002,\n후인원A,가상셋,0003,990302');
  assert.deepEqual(head.errors,[]);assert.deepEqual(head.rows.map(r=>[r.classId,r.name,r.last4,r.birth,!!r.phoneKey]),[['3','가상하나','0001','1999-03-02',true],['3','가상둘','0002','',false],['3','가상셋','0003','1999-03-02',false]]);
  assert.equal(head.rows[0].phoneKey,studentKey('가상하나','01011110001'),'a full phone gives the same key as a plain read');
  assert.ok(!JSON.stringify(head.rows).includes('01011110001'),'the full phone is not kept');
  const bare=parseRoster('가상하나\t0001\t1999-03-02\n가상둘,0002',{classId:'5'});assert.deepEqual(bare.rows.map(r=>[r.classId,r.name,r.birth]),[['5','가상하나','1999-03-02'],['5','가상둘','']]);
  const bad=parseRoster('3,가상하나,123\n17,가상둘,0002\n3,가*,0003\n3,가상넷,0004,1999-13-01\n4,가상다섯,0005',{classId:'3'});
  assert.deepEqual(bad.errors.map(e=>e.line),[1,2,3,4,5]);assert.ok(!NAMES.some(n=>JSON.stringify(bad.errors).includes(n)),'no names in errors');
  const keys=rosterKeys([{classId:'3',name:'가상넷',last4:'0004'},{classId:'3',name:'가상넷',last4:'0004'},{classId:'3',name:'가상하나',last4:'0001'}]);
  assert.deepEqual(keys.map(k=>k.dup),[true,true,false]);assert.notEqual(keys[0].studentKey,keys[1].studentKey);
});
test('강의 찾기: [N반] 규칙, 1기 기간 줄은 고르지 않음, 설정한 반→강의 없음(기본)',()=>{
  assert.equal(ruleMatches('[3반] 대전 모빌리티 2026.10.28 ~ 2027.01.22','3'),true);assert.equal(ruleMatches('[13반] 어딘가','3'),false);assert.equal(ruleMatches('[1반] 서울','11'),false);
  assert.equal(oldLectureRow('[2반] 가상 2026.07.27 ~ 2026.10.22'),true);assert.equal(ruleMatches('[2반] 가상 2026.07.27 ~ 2026.10.22','2'),false,'a 1기 lecture with the same tag is skipped');
  assert.equal(ruleClass('[16반] 광주 2026-10-28 ~ 2027-01-22'),'16');assert.equal(ruleClass('[17반] 1기'),null);
  assert.equal(lectureLabel('  [2반]  가상   보기 '),'[2반] 가상');assert.equal(presetLecture('3'),null);
});
test('처음 설치 확인 결과: 맞음·명단에 없음·명단에만·겹침, 사람이 고른 짝, 확인 목록은 이름·끝 4자리·학생 번호만',()=>{
  const r=rosterKeys(parseRoster('3,가상하나,010-1111-0001,1999-03-02\n3,가상둘,0002\n3,가상셋,0003\n3,가상넷,0004\n3,가상넷,0004').rows);
  const rows=[{name:'가상하나',phoneLast4:'0001',studentKey:studentKey('가상하나','01011110001'),attendeeId:'att-1'},{name:'가상둘',phoneLast4:'0002',studentKey:'k2',attendeeId:'att-2'},{name:'가상다섯',phoneLast4:'0005',studentKey:'k5',attendeeId:'att-5'},
    {name:'가상넷',phoneLast4:'0004',studentKey:'k4a',attendeeId:'att-4a'},{name:'가상넷',phoneLast4:'0004',studentKey:'k4b',attendeeId:'att-4b'},{name:'가상여섯',phoneLast4:'0006',studentKey:'k6',attendeeId:null}];
  const rep=buildReport({classId:'3',date:D,rows});
  assert.deepEqual(reportCounts(rep,r),{total:6,matched:2,unmatched:1,ambiguous:3,missing:3,included:5,roster:5});
  const v=reportView(rep,r),by=n=>v.rows.filter(x=>x.name===n);
  assert.deepEqual(v.rows.map(x=>x.status),['matched','matched','unmatched','ambiguous','ambiguous','noid']);assert.equal(by('가상하나')[0].roster.birth,'1999-03-02');
  assert.ok(!JSON.stringify(v).includes('att-'),'no CheckHere ids in the screen view');
  assert.throws(()=>pairRow(rep,r,by('가상다섯')[0].token,r.find(e=>e.name==='가상셋').studentKey),/둘 다 달라/);
  pairRow(rep,r,by('가상넷')[0].token,r.find(e=>e.name==='가상넷').studentKey);assert.equal(reportView(rep,r).rows[3].status,'paired');
  assert.throws(()=>pairRow(rep,r,by('가상하나')[0].token,r.find(e=>e.name==='가상셋').studentKey),/이미 명단과 맞은/);
  rep.exclude=['att-5'];const list=confirmList(rep,r);
  assert.deepEqual(list,[{name:'가상하나',last4:'0001',attendeeId:'att-1'},{name:'가상둘',last4:'0002',attendeeId:'att-2'},{name:'가상넷',last4:'0004',attendeeId:'att-4a'},{name:'가상넷',last4:'0004',attendeeId:'att-4b'}]);
  // 명단이 없으면 체크히어 원문 명단 그대로(사람이 확인)
  const none=buildReport({classId:'4',date:D,rows:rows.slice(0,2)});assert.deepEqual(reportView(none,[]).rows.map(x=>x.status),['checkhere','checkhere']);assert.equal(confirmList(none,[]).length,2);
  assert.deepEqual(cleanStudents([{name:'가상하나',last4:'0001',attendeeId:'att-1',birth:'1999-03-02',phone:'01011110001'}]),[{name:'가상하나',last4:'0001',attendeeId:'att-1'}],'birthdate and phone are dropped');
  assert.throws(()=>cleanStudents([{name:'가**',last4:'0001',attendeeId:'att-1'}]),/가린 글자/);assert.throws(()=>cleanStudents([{name:'가',last4:'0001',attendeeId:'a-1'},{name:'나',last4:'0002',attendeeId:'a-1'}]),/두 번/);
  const csv=exportText(new Map([['3',list]])),tsv=exportText(new Map([['3',list]]),{tab:true});
  assert.equal(csv.split('\r\n')[0],'반,이름,전화끝4자리,체크히어ID');assert.ok(csv.includes('3,가상하나,0001,att-1'));assert.ok(tsv.includes('3\t가상둘\t0002\tatt-2'));
  assert.ok(!csv.includes('1999-03-02')&&!csv.includes('01011110001'),'no birthdate or full phone in the export');
  assert.match(unmaskReason({setup:16}),/2기 교육생 명단 확인 16개 반/);assert.equal(unmaskReason({}),null);
});
// ---- 연결 프로그램(가짜 수집기): 처음 설치 모드 전체 흐름 ----
function stubAdapter(days){
  const a=Object.assign(Object.create(CheckHereCollector.prototype),{cancelled:false,lectureLinks:new Map(),lectureUrls:new Map(),urls:new Map(),rosterReport:new Map(),header:{state:'masked',remaining:null},collected:[],
    loggedIn:async()=>true,requireLogin:async()=>{},readHeader:async()=>a.header,headerNow:()=>a.header,connect:async()=>({connected:true,message:'가짜'}),
    maskingState:async()=>({view:a.header.state==='unmasked'?'plain':'masked',header:a.header.state,remaining:a.header.remaining,unlinked:0,classes:[]}),
    async collect(classId,dates,onRecord,onProgress,{sameAsStored,onView}={}){
      const date=dates[0];a.collected.push(classId+'|'+date);if(!days[classId])throw Error(`${date} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);
      if(a.header.state!=='unmasked'){a.dayRows={classId,date,view:'masked',rows:[]};await onView?.({date,view:'masked'});return;}
      const rows=days[classId].map(s=>{const phone=s.phone.replace(/\D/g,''),r={classId,date,name:s.name,studentKey:a.keyFor(classId,s.name,phone),phoneLast4:phone.slice(-4),attendeeId:s.attendeeId,schedule:'09:00 ~ 18:00',rawEntry:'09:00:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,source:'live',readState:'complete',tableSignature:'x',collectedAt:new Date().toISOString()};r.id=recordId(r);r.version=version(r);return r;});
      a.links.learn(classId,date,rows.map(r=>({attendeeId:r.attendeeId,studentKey:r.studentKey})));
      a.dayRows={classId:String(classId),date,view:'plain',rows:rows.map(r=>({name:r.name,phoneLast4:r.phoneLast4,studentKey:r.studentKey,attendeeId:r.attendeeId}))};
      for(const r of rows)if(!sameAsStored?.(r))await onRecord(r);await onView?.({date,view:'plain',unlinked:0});
    }});
  return a;
}
function identityCloud(){
  const saved=new Map(),calls=[];
  return {saved,calls,cloud:{verify:async t=>{if(t!=='approver-token')throw Error('체크히어 수정은 지정된 Google 관리자 계정만 승인·반영할 수 있습니다.');return 'hint.kpc@gmail.com';},
    listIdentities:async()=>{calls.push('list');return [...saved].map(([classId,d])=>({classId,students:structuredClone(d.students),updatedAt:d.updatedAt,updatedBy:d.updatedBy}));},
    putIdentities:async(t,classId,students,by)=>{calls.push('put:'+classId);const list=cleanStudents(students);saved.set(classId,{students:list,updatedBy:by,updatedAt:'2026-10-28T03:00:00Z'});return {classId,count:list.length,updatedAt:'2026-10-28T03:00:00Z'};}}};
}
async function serve(app,port){await new Promise(r=>app.server.listen(port,'127.0.0.1',r));const base=`http://127.0.0.1:${port}`;
  const call=async(path,body={},{origin}={})=>{const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'x-hint-key':app.key,'content-type':'application/json',connection:'close',...(origin?{origin}:{})},body:JSON.stringify(body)});const text=await r.text();let json=null;try{json=JSON.parse(text);}catch{}return {code:r.status,body:json,text};};
  const done=async id=>{for(let i=0;i<400;i++){const j=(await(await fetch(base+'/api/state?delta=1',{headers:{'x-hint-key':app.key,connection:'close'}})).json()).jobs.find(x=>x.id===id);if(j&&j.status!=='running')return j;await new Promise(r=>setTimeout(r,25));}throw Error('작업 대기 시간 초과');};
  return {base,call,done};}
test('처음 설치 모드: 첫 화면은 /setup, 해제된 동안 반별 확인, 사람이 확인, 운영포털에서 승인 계정으로 등록(이름·끝 4자리·학생 번호만), 작업 글·요약에는 이름 없음',{timeout:60000},async()=>{
  const days={'3':[{name:'가상하나',phone:'010-1111-0001',attendeeId:'att-1'},{name:'가상둘',phone:'010-2222-0002',attendeeId:'att-2'},{name:'가상다섯',phone:'010-5555-0005',attendeeId:'att-5'}],'4':[{name:'가상여섯',phone:'010-6666-0006',attendeeId:'att-6'}]};
  const adapter=stubAdapter(days),ids=identityCloud(),dataDir=dir('setup-');
  const app=createBridge({dataDir,collector:adapter,port:18601,approvalCloud:ids.cloud,learnTickMs:600000}),{base,call,done}=await serve(app,18601);
  try{
    // 처음 설치: 첫 화면(/)은 /setup으로, /?main=1·/checkhere.html은 그대로
    const home=await fetch(base+'/',{redirect:'manual',headers:{connection:'close'}});assert.equal(home.status,302);assert.equal(home.headers.get('location'),'/setup');
    assert.match(await(await fetch(base+'/?main=1',{headers:{connection:'close'}})).text(),/checkhereApp/);assert.match(await(await fetch(base+'/checkhere.html',{headers:{connection:'close'}})).text(),/checkhereApp/);
    assert.match(await(await fetch(base+'/setup',{headers:{connection:'close'}})).text(),/setupApp/);assert.match(await(await fetch(base+'/cohort.mjs',{headers:{connection:'close'}})).text(),/hint-knewdeal-2/);
    let s=(await call('setup/state')).body;assert.equal(s.mode.on,true);assert.equal(s.classes.length,16);assert.equal(s.cohort.port,18601);assert.deepEqual(s.cohort.holidays,['2026-12-25','2026-12-31','2027-01-01']);assert.equal(s.cohort.trainingDays,60);
    assert.match(s.masking.reasonPreview,/2기 교육생 명단 확인 16개 반/,'the unmask reason names the real work');
    // 다른 주소(포털)에서는 이 PC 화면 기능을 쓰지 못함
    assert.equal((await call('setup/state',{},{origin:'https://portal.example'})).code,403);
    // 명단(3반만): 생년월일은 이 PC에만
    const imp=await call('setup/roster',{text:'반,이름,전화,생년월일\n3,가상하나,010-1111-0001,1999-03-02\n3,가상둘,0002\n3,가상셋,0003'});assert.equal(imp.body.ok,true,imp.text);assert.deepEqual(imp.body.imported,{'3':{count:3,dup:0}});
    // 가린 화면·남은 시간 부족이면 시작하지 않음(해제·연장은 사람이)
    assert.match((await call('setup/check',{date:D})).body.error,/SETUP_UNMASK/);
    adapter.header={state:'unmasked',remaining:30};assert.match((await call('setup/check',{date:D})).body.error,/SETUP_TIME/);
    assert.match((await call('setup/check',{date:'2026-10-27'})).body.error,/교육 기간/);
    adapter.header={state:'unmasked',remaining:600};
    const started=await call('setup/check',{date:D,classIds:['3','4','5']});assert.equal(started.code,202,started.text);
    const job=await done(started.body.id);assert.equal(job.status,'partial',job.message);
    assert.deepEqual(job.results.map(r=>[r.classId,r.status]),[['3','checked'],['4','checked'],['5','no-lecture']]);
    assert.deepEqual(job.results[0],{classId:'3',status:'checked',total:3,matched:2,unmatched:1,ambiguous:0,missing:1,included:3,roster:3});
    assert.match(job.message,/3\/3개 반 확인 · 맞음 2 · 명단에 없음 2 · 명단에만 1 · 겹침 0/);
    const stateText=JSON.stringify((await(await fetch(base+'/api/state?delta=1',{headers:{'x-hint-key':app.key,connection:'close'}})).json()).jobs);
    for(const n of ['가상하나','가상둘','가상다섯','가상여섯','att-1'])assert.ok(!stateText.includes(n),'job messages carry counts only: '+n);
    s=(await call('setup/state')).body;const c3=s.classes.find(c=>c.classId==='3');
    assert.deepEqual(c3.view.rows.map(r=>[r.name,r.status]),[['가상하나','matched'],['가상둘','matched'],['가상다섯','unmatched']]);assert.deepEqual(c3.view.missing.map(m=>m.name),['가상셋']);
    assert.equal(c3.view.rows[0].roster.birth,'1999-03-02');assert.ok(!JSON.stringify(s).includes('att-'),'no CheckHere ids on the screen');
    assert.equal(c3.links.plain,3,'the plain read learned the links');
    // 사람이 고침: 다섯 ↔ 셋은 이름·끝 4자리가 둘 다 달라 막고, 다섯은 빼고 확인
    const five=c3.view.rows.find(r=>r.name==='가상다섯');assert.match((await call('setup/pair',{classId:'3',token:five.token,studentKey:c3.view.missing[0].studentKey})).body.error,/둘 다 달라/);
    s=(await call('setup/confirm',{classId:'3',exclude:[five.token]})).body;assert.equal(s.classes.find(c=>c.classId==='3').confirmed.count,2);
    s=(await call('setup/confirm',{classId:'4'})).body;assert.equal(s.classes.find(c=>c.classId==='4').confirmed.count,1);
    assert.match((await call('setup/confirm',{classId:'5'})).body.error,/원문으로 확인하지 않았습니다/);
    // 내보내기(이 PC 화면만): CSV·탭 구분, 생년월일·전체 번호 없음
    const csv=await call('setup/export',{format:'csv'});assert.equal(csv.code,200);assert.ok(csv.text.startsWith('반,이름,전화끝4자리,체크히어ID'));
    assert.ok(csv.text.includes('3,가상하나,0001,att-1')&&csv.text.includes('4,가상여섯,0006,att-6')&&!csv.text.includes('가상다섯'));assert.ok(!csv.text.includes('1999-03-02')&&!csv.text.includes('01011110001'));
    assert.ok((await call('setup/export',{format:'tsv'})).text.includes('3\t가상둘\t0002\tatt-2'));
    const raw=new Uint8Array(await(await fetch(base+'/api/setup/export',{method:'POST',headers:{'x-hint-key':app.key,'content-type':'application/json',connection:'close'},body:'{}'})).arrayBuffer());assert.deepEqual([...raw.slice(0,3)],[0xef,0xbb,0xbf],'CSV starts with a BOM for Excel');
    assert.equal((await call('setup/export',{},{origin:'https://portal.example'})).code,403);
    // 운영포털(승인 계정): 요약은 수만, 등록은 확인한 반만, 이름·끝 4자리·학생 번호만
    const sum=await call('identities/summary',{},{origin:'https://portal.example'});assert.equal(sum.code,200);
    for(const n of ['가상하나','가상둘','att-1','1999'])assert.ok(!sum.text.includes(n),'summary has counts only: '+n);
    assert.deepEqual(sum.body.classes.find(c=>c.classId==='3').confirmed.count,2);assert.equal(sum.body.setup,true);
    assert.match((await call('identities/register',{idToken:'other-token'},{origin:'https://portal.example'})).body.error,/지정된 Google 관리자/);
    const reg=await call('identities/register',{idToken:'approver-token'},{origin:'https://portal.example'});assert.equal(reg.code,200,reg.text);
    assert.deepEqual(reg.body.results.filter(r=>r.status!=='not-confirmed'),[{classId:'3',status:'registered',count:2},{classId:'4',status:'registered',count:1}]);
    for(const n of ['가상하나','att-1'])assert.ok(!reg.text.includes(n),'register reply has counts only');
    assert.deepEqual(ids.saved.get('3').students,[{name:'가상하나',last4:'0001',attendeeId:'att-1'},{name:'가상둘',last4:'0002',attendeeId:'att-2'}]);assert.equal(ids.saved.get('3').updatedBy,'hint.kpc@gmail.com');
    assert.ok(ids.saved.get('3').students.every(x=>Object.keys(x).join()==='name,last4,attendeeId'),'no birthdate or phone in Firestore');
    assert.deepEqual((await call('identities/register',{idToken:'approver-token',classIds:['3']},{origin:'https://portal.example'})).body.results,[{classId:'3',status:'already',count:2}]);
    // 등록 목록 보기: 이 PC에 명단이 없는 반은 등록 목록을 명단으로 가져옴(읽기 전용 연결)
    ids.saved.set('7',{students:[{name:'가상일곱',last4:'0007',attendeeId:'att-7'},{name:'가상여덟',last4:'0008',attendeeId:'att-8'}],updatedBy:'hint.kpc@gmail.com',updatedAt:'2026-10-28T04:00:00Z'});
    const rg=await call('identities/registry',{idToken:'approver-token'},{origin:'https://portal.example'});assert.deepEqual(rg.body.imported,['4','7'],'classes without a local roster (4 had only the CheckHere list)');assert.ok(!rg.text.includes('가상일곱'));
    assert.deepEqual(rg.body.classes.map(c=>[c.classId,c.count]).sort(),[['3',2],['4',1],['7',2]]);
    s=(await call('setup/state')).body;const c7=s.classes.find(c=>c.classId==='7');assert.deepEqual([c7.roster.count,c7.roster.source,c7.links.roster,c7.registry.count],[2,'registered',2,2]);
    assert.deepEqual(app.links.classLinks('7').map(l=>l.source),['roster','roster'],'registered ids stay read-only until a plain read');
    // 설치 모드 끄기 → 첫 화면 그대로
    s=(await call('setup/mode',{on:false})).body;assert.equal(s.mode.on,false);assert.equal((await fetch(base+'/',{redirect:'manual',headers:{connection:'close'}})).status,200);
  }finally{app.close();}
  // 다시 켜도 설치 모드는 사람이 정한 대로(꺼짐), 연결이 남은 data에서는 처음 설치로 보지 않음
  const again=createBridge({dataDir,collector:stubAdapter(days),port:18601,approvalCloud:ids.cloud,learnTickMs:600000});
  try{const {call:c2}=await serve(again,18601);assert.equal((await c2('setup/state')).body.mode.on,false);}finally{again.close();}
});
test('1기 data 폴더(2기 시작 전 기록)로는 켜지지 않음, 2기 Firebase 설정이 비면 등록·승인은 아무것도 보내지 않고 멈춤',async()=>{
  const dataDir=dir('old-data-'),db=new DatabaseSync(join(dataDir,'attendance.sqlite'));
  db.exec('CREATE TABLE snapshots(seq INTEGER PRIMARY KEY, id TEXT NOT NULL, payload TEXT NOT NULL)');db.prepare('INSERT INTO snapshots(id,payload) VALUES(?,?)').run('2_2026-10-15_k',JSON.stringify({id:'2_2026-10-15_k',classId:'2',date:'2026-10-15',name:'가상'}));db.close();
  assert.throws(()=>createBridge({dataDir,collector:stubAdapter({}),port:18603}),/OLD_DATA/);
  const sent=[],cloud=createApprovalCloud();
  await assert.rejects(cloud.verify('token'),e=>e.code==='FIREBASE_CONFIG'&&e.message===FIREBASE_MISSING);
  await assert.rejects(cloud.putIdentities('token','3',[{name:'가상하나',last4:'0001',attendeeId:'att-1'}],'x'),/FIREBASE_CONFIG/);assert.deepEqual(sent,[]);
});
test('등록 REST: checkhereIdentities/{반}에 이름·끝 4자리·학생 번호만, 서버 시각, 다시 읽어 다르면 실패, 권한 없으면 규칙 안내',async()=>{
  const docs=new Map(),seen=[];let tamper=false,deny=false;
  const fetchImpl=async(url,opt={})=>{
    const u=String(url);seen.push({u,body:opt.body?JSON.parse(opt.body):null});if(deny)return {ok:false,status:403,json:async()=>({})};
    if(u.endsWith(':commit')){for(const w of JSON.parse(opt.body).writes){const fields=structuredClone(w.update.fields);if(tamper)fields.students.arrayValue.values.pop();fields.updatedAt={timestampValue:'2026-10-28T03:00:00Z'};docs.set(w.update.name.split('/documents/')[1],fields);}return {ok:true,json:async()=>({})};}
    const path=u.split('/documents/')[1].split('?')[0];
    if(path==='checkhereIdentities')return {ok:true,json:async()=>({documents:[...docs].filter(([p])=>p.startsWith('checkhereIdentities/')).map(([p,f])=>({name:'projects/x/databases/(default)/documents/'+p,fields:f}))})};
    return docs.has(path)?{ok:true,json:async()=>({fields:docs.get(path)})}:{ok:false,status:404,json:async()=>({})};
  };
  const cloud=createApprovalCloud({fetchImpl}),students=[{name:'가상하나',last4:'0001',attendeeId:'att-1',birth:'1999-03-02'},{name:'가상둘',last4:'0002',attendeeId:'att-2'}];
  assert.deepEqual(await cloud.putIdentities('t','3',students,'hint.kpc@gmail.com'),{classId:'3',count:2,updatedAt:'2026-10-28T03:00:00Z'});
  const write=seen.find(x=>x.u.endsWith(':commit')).body.writes[0];
  assert.match(write.update.name,/projects\/hint-knewdeal-2\/databases\/\(default\)\/documents\/checkhereIdentities\/3$/);
  assert.deepEqual(Object.keys(write.update.fields).sort(),['classId','students','updatedBy']);assert.deepEqual(write.updateTransforms,[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]);
  assert.deepEqual(write.update.fields.students.arrayValue.values.map(v=>Object.keys(v.mapValue.fields).join()),['name,last4,attendeeId','name,last4,attendeeId']);
  assert.ok(!JSON.stringify(write).includes('1999-03-02'),'no birthdate');
  assert.deepEqual((await cloud.listIdentities('t')).map(d=>[d.classId,d.students.length]),[['3',2]]);
  tamper=true;await assert.rejects(cloud.putIdentities('t','4',students,'x'),/다시 읽은 목록/);tamper=false;
  await assert.rejects(cloud.putIdentities('t','17',students,'x'),/반을 확인/);
  deny=true;await assert.rejects(cloud.putIdentities('t','3',students,'x'),/IDENTITIES_RULES/);
});
// ---- 가짜 체크히어(브라우저): 이름 규칙·1기 강의 건너뛰기·직접 연결, 가린 화면의 명단 맞춤과 사람이 고르는 연결, 해제 뒤 반별 확인 ----
test('가짜 체크히어: [2반] 2기 강의를 고르고(1기 줄은 건너뜀), 이름이 다른 강의는 사람이 직접 연결, 가린 화면에서 명단으로 잇고 남은 줄은 사람이 연결, 해제 뒤 반별 확인',{timeout:120000},async()=>{
  const students=fakeRoster(D,{extra:[{attendeeId:'att-gn',name:'가나다',phone:'01000000009',eventList:[]}]});
  const s=await fakeSite({S1:{date:D,students}},{mode:'masked'});
  s.w.home=[{label:'[2반] 1기 가상강의 (가상담임) 2026.07.27 ~ 2026.10.22',lecture:'L1'},{label:'[2반] 2기 가상강의 (가상담임) 2026.10.28 ~ 2027.01.22',lecture:'L2'},{label:'HINT 모빌리티 가상 (가상담임) 2026.10.28 ~ 2027.01.22',lecture:'L5'}];
  const c=new CheckHereCollector('',{page:s.page,dayGapMs:[0,0]}),ids=identityCloud();
  const app=createBridge({dataDir:dir('setup-site-'),collector:c,port:18602,approvalCloud:ids.cloud,learnTickMs:600000}),{call,done}=await serve(app,18602);
  try{
    assert.equal((await call('setup/roster',{text:'2,나가상,0002,1998-01-01\n2,나영희,0002\n2,가상하나,010-0000-0001\n2,다가상,0003'})).body.ok,true);
    // 가린 화면 빠른 수집: 이름 규칙으로 2기 강의(L2), 명단으로 가상하나·다가상을 잇고(첫 글자+끝 4자리가 하나), 나**(둘)·가나다(명단에 없음)는 남김
    let j=await done((await call('sync',{classId:'2',dates:[D],mode:'incremental'})).body.id);assert.notEqual(j.status,'failed',j.message);
    assert.match(c.lectureUrls.get('2'),/\/history\/lecture\/L2\b/,'the 1기 row with the same tag is skipped');
    assert.deepEqual(app.links.classLinks('2').map(l=>l.source).sort(),['roster','roster']);
    let st=(await call('setup/state')).body,rep=st.classes.find(x=>x.classId==='2').report;
    assert.deepEqual(rep.rows.map(r=>[r.shown,r.last4,r.reason]).sort(),[['가**','0009','none'],['나**','0002','many']]);assert.deepEqual(rep.missing.map(m=>m.name).sort(),['나가상','나영희']);
    const na=rep.rows.find(r=>r.last4==='0002'),young=rep.missing.find(m=>m.name==='나영희');
    assert.match((await call('setup/roster-link',{classId:'2',token:rep.rows.find(r=>r.last4==='0009').token,studentKey:young.studentKey})).body.error,/맞지 않습니다/);
    st=(await call('setup/roster-link',{classId:'2',token:na.token,studentKey:rep.missing.find(m=>m.name==='나가상').studentKey})).body;assert.equal(st.classes.find(x=>x.classId==='2').links.roster,3);
    // 해제(가짜 화면에서 사람이 한 것으로): 반별 확인 → 원문 확인, 명단 연결은 원문 확인(plain-read)으로 바뀜
    s.w.mode='unmasked';await s.page.reload();
    const started=await call('setup/check',{date:D,classIds:['2']});assert.equal(started.code,202,started.text);j=await done(started.body.id);assert.equal(j.status,'complete',j.message);
    st=(await call('setup/state')).body;const v=st.classes.find(x=>x.classId==='2').view;
    assert.deepEqual(v.rows.map(r=>[r.name,r.status]).sort(),[['가나다','unmatched'],['가상하나','matched'],['나가상','matched'],['다가상','matched']]);assert.deepEqual(v.missing.map(m=>m.name),['나영희']);
    assert.deepEqual(app.links.classLinks('2').map(l=>l.source),['plain-read','plain-read','plain-read','plain-read']);
    // 이름 규칙에 맞지 않는 강의: 목록 읽기 → 5반에 사람이 직접 연결 → 그 강의 화면으로 수집(제목에 [5반] 없어도 됨)
    const list=(await call('setup/lectures',{date:D})).body;assert.equal(list.complete,true);
    assert.deepEqual(list.lectures.map(l=>[l.classId,l.old,l.covers]),[[null,true,false],['2',false,true],[null,false,true]]);
    st=(await call('setup/link-lecture',{classId:'5',label:list.lectures[2].label})).body;assert.deepEqual([st.classes.find(x=>x.classId==='5').lecture.mode,st.classes.find(x=>x.classId==='5').lecture.checked],['manual',true]);
    j=await done((await call('sync',{classId:'5',dates:[D],mode:'incremental'})).body.id);assert.notEqual(j.status,'failed',j.message);assert.equal(j.count,4);
  }finally{app.close();await s.close();}
});
