import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as C from '../../cohort.mjs';
import * as N from '../../lib/cohort.cjs';

// 2기 기수 설정(cohort.json 원본, cohort.mjs 사본·함수, lib/cohort.cjs api용)이 사용자 결정(2026-10-19)과 같은지 봅니다.
const json=JSON.parse(readFileSync(new URL('../../cohort.json',import.meta.url),'utf8'));
const NAMES=['서울(관악구)_모빌리티 AI_서울대','서울(성동구)_제조지능화_한양대','대전(유성구)_모빌리티 AI_후인원A','대전(유성구)_제조지능화_후인원B','청주(청원구)_제조지능화_청주','대구(동구)_모빌리티 AI_KPC대구지부','대구(중구)_모빌리티 AI_마이크로웨이브A','대구(중구)_제조지능화_마이크로웨이브B','부산(금정구)_모빌리티 AI_부산대','부산(해운대구)_모빌리티 AI_아르피나A','부산(해운대구)_제조지능화_아르피나B','부산(해운대구)_제조지능화_아르피나C','울산(북구)_제조지능화_울산','광주(북구)_모빌리티 AI_전남대','광주(서구)_제조지능화_기아오토랜드A','광주(서구)_제조지능화_기아오토랜드B'];

test('cohort.mjs carries an exact copy of cohort.json, and the api reader agrees',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(C.COHORT)),json,'node tools/build-cohort.mjs 로 사본을 맞춰 주세요');
 assert.deepEqual(N.CLASS_IDS,[...C.CLASS_IDS]);assert.equal(N.FIREBASE_PROJECT,C.FIREBASE_PROJECT);assert.equal(N.COHORT_DATE_RE.source,C.COHORT_DATE_RE.source);
 assert.equal(N.TEACHER_ACCESS,C.TEACHER_ACCESS);assert.deepEqual(N.ADMINS,[...C.ADMINS]);
});

test('16 classes in the user region order with official names and capacity 30 (class 4: 31)',()=>{
 assert.equal(C.REAL_CLASS_COUNT,16);assert.deepEqual([...C.REAL_CLASS_IDS],Array.from({length:16},(_,i)=>String(i+1)));
 assert.deepEqual(C.REAL_CLASSES.map(c=>c.name),NAMES);
 assert.deepEqual(C.REAL_CLASSES.map(c=>c.official),NAMES.map(n=>'[현대자동차그룹 HINT] '+n));
 assert.deepEqual(C.REAL_CLASSES.map(c=>c.region),['서울','서울','충청','충청','충청','대경','대경','대경','동남','동남','동남','동남','동남','호남','호남','호남']);
 assert.deepEqual([...new Set(C.REAL_CLASSES.map(c=>c.course))],['모빌리티 AI','제조지능화']);
 assert.deepEqual(C.REAL_CLASSES.filter(c=>c.course==='모빌리티 AI').map(c=>c.id),['1','3','6','7','9','10','14']);
 assert.deepEqual(C.REAL_CLASSES.map(c=>c.capacity),C.REAL_CLASS_IDS.map(id=>id==='4'?31:30));
 assert.equal(C.classLabel('12'),'12반 · 제조지능화 · 아르피나C');assert.equal(C.classLabel('17'),'17반 · 테스트반 (시험용)');assert.equal(C.classLabel('18'),'18반');
 // 반 구분어는 서로 겹치지 않아야 명단 '반배정' 문구에서 한 반만 고릅니다.
 for(const a of C.REAL_CLASSES)assert.equal(C.REAL_CLASSES.filter(b=>b.official.includes(a.rosterKey)).length,1,a.rosterKey);
});

test('17반 시험용 테스트반: 화면에는 보이고(allClasses), 공식 결과(realClasses·통계 합계·HRD·자동 수집)에서는 빠짐',async()=>{
 assert.equal(C.CLASS_COUNT,17);assert.equal(C.REAL_CLASS_COUNT,16);
 assert.deepEqual(C.allClasses().map(c=>c.id),C.CLASS_IDS);assert.deepEqual(C.realClasses().map(c=>c.id),C.CLASS_IDS.filter(id=>id!=='17'));
 const t=C.classInfo('17');assert.deepEqual([t.test,t.name,t.official,t.capacity],[true,'테스트반 (시험용)','',10]);
 assert.equal(C.isTestClass('17'),true);assert.equal(C.isTestClass(17),true);assert.equal(C.isTestClass('16'),false);assert.equal(C.isTestClass('18'),false);
 assert.ok(C.CLASSES.filter(c=>c.id!=='17').every(c=>c.test===false));
 assert.deepEqual(C.withoutTestClasses([{id:'1'},{id:'17'},'17','2']).map(x=>x.id??x),['1','2']);
 assert.deepEqual(N.REAL_CLASS_IDS,C.REAL_CLASS_IDS);assert.deepEqual(N.CLASS_IDS,C.CLASS_IDS);
 // 출결 통계 합계: 반을 고르지 않으면 테스트반 학생은 빠지고, 17반을 고르면 그 반만
 const {studentStats}=await import('../../beta2-core.mjs');
 const bundle={today:'2026-10-29',days:['2026-10-28','2026-10-29'],roster:[{cls:'1',name:'가상1',status:'재학'},{cls:'17',name:'가상시험',status:'재학'}],ledger:[]};
 assert.deepEqual(studentStats(bundle,{}).map(s=>s.cls),['1']);assert.deepEqual(studentStats(bundle,{cls:'17'}).map(s=>s.cls),['17']);
 // 체크히어 자동 수집(중계 한 시간 계획)·HRD 반배정은 공식 반만
 const live=await import('../../checkhere-live-core.mjs'),upload=await import('../../attendance-upload-core.mjs');
 assert.deepEqual(live.RELAY_CLASS_IDS,C.REAL_CLASS_IDS);assert.ok(live.CLASS_IDS.includes('17'),'실시간 화면에서 직접 고를 수는 있음');
 assert.equal(upload.ASSIGNMENT_KEYS['17'],undefined);
});

test('class id pattern accepts 1..17 (17 = 시험용 테스트반) only',()=>{
 assert.equal(C.classIdPattern(),'(?:[1-9]|1[0-7])');
 for(const id of C.CLASS_IDS)assert.ok(C.CLASS_ID_RE.test(id)&&C.isClassId(id)&&N.isClassId(id));
 for(const bad of ['0','18','19','01','1 ','',' 1','10a'])assert.ok(!C.CLASS_ID_RE.test(bad)&&!C.isClassId(bad),bad);
});

test('60 training days: weekdays 2026-10-28..2027-01-22 minus 12/25, 12/31, 1/1',()=>{
 assert.equal(C.TRAINING_DAYS.length,60);assert.equal(C.TRAINING_DAYS[0],'2026-10-28');assert.equal(C.TRAINING_DAYS.at(-1),'2027-01-22');
 assert.deepEqual([...C.HOLIDAYS],['2026-12-25','2026-12-31','2027-01-01']);
 for(const h of C.HOLIDAYS){assert.ok(C.isHoliday(h)&&!C.isTrainingDay(h));assert.ok(!C.TRAINING_DAYS.includes(h));assert.ok(C.holidayName(h));}
 for(const d of ['2026-10-27','2027-01-23','2026-10-31','2026-11-01'])assert.ok(!C.isTrainingDay(d),d);
 for(const d of ['2026-10-28','2026-12-24','2026-12-30','2027-01-04','2027-01-22'])assert.ok(C.isTrainingDay(d),d);
 assert.deepEqual(C.trainingDays({from:'2026-12-24',to:'2027-01-05'}),['2026-12-24','2026-12-28','2026-12-29','2026-12-30','2027-01-04','2027-01-05']);
 assert.deepEqual(C.trainingDays({from:'2026-01-01',to:'2026-10-29'}),['2026-10-28','2026-10-29'],'기간 밖은 잘라냄');
});

test('January dates resolve to 2027 and the date pattern accepts both years',()=>{
 const cases={'10/28':'2026-10-28','11/2':'2026-11-02','12.31':'2026-12-31','1/4':'2027-01-04','1월 22일':'2027-01-22','1/22(금)':'2027-01-22','2027-01-05':'2027-01-05','9/30':'2026-09-30','2/10':'2027-02-10','13/1':'','2/30':'',x:''};
 for(const [k,v] of Object.entries(cases))assert.equal(C.isoFromMonthDay(k),v,k);
 assert.equal(C.isoFromMonthDay(1,5),'2027-01-05');assert.equal(C.isoFromMonthDay(10,30),'2026-10-30');
 for(const ok of ['2026-10-28','2027-01-22'])assert.ok(C.COHORT_DATE_RE.test(ok)&&C.inPeriod(ok));
 for(const bad of ['2025-12-01','2028-01-01'])assert.ok(!C.COHORT_DATE_RE.test(bad));
 assert.ok(!C.inPeriod('2026-10-27')&&!C.inPeriod('2027-01-23')&&!C.inPeriod('2027-02-30'));
 assert.ok(N.inPeriod('2027-01-04')&&!N.inPeriod('2026-07-27'));
});

test('weeks start on Monday 2026-10-26 and unit periods cover the course without gaps',()=>{
 assert.equal(C.weekNo('2026-10-28'),1);assert.equal(C.weekNo('2026-10-30'),1);assert.equal(C.weekNo('2026-11-02'),2);assert.equal(C.weekNo('2027-01-04'),11);assert.equal(C.weekNo('2027-01-22'),13);
 const w=C.weekSchedule();assert.deepEqual(w[0],{week:1,dates:['2026-10-28','2026-10-29','2026-10-30']});assert.equal(w.reduce((n,g)=>n+g.dates.length,0),60);
 assert.deepEqual(C.UNIT_PERIODS.map(p=>[p.from,p.to]),[['2026-10-28','2026-11-27'],['2026-11-28','2026-12-27'],['2026-12-28','2027-01-22']]);
 assert.deepEqual(C.UNIT_PERIODS.map(p=>p.label),['1단위 · 10/28~11/27','2단위 · 11/28~12/27','3단위 · 12/28~1/22']);
 assert.equal(C.UNIT_PERIODS[0].from,C.COURSE_START);assert.equal(C.UNIT_PERIODS.at(-1).to,C.COURSE_END);
 for(let i=1;i<C.UNIT_PERIODS.length;i++)assert.equal(C.addDays(C.UNIT_PERIODS[i-1].to,1),C.UNIT_PERIODS[i].from);
 assert.equal(C.unitPeriodOf('2027-01-04').no,3);assert.equal(C.unitPeriodOf('2026-10-27'),null);
});

test('attendance rule: 09:00~18:00 normally, 10:00~17:00 on factory-visit days',()=>{
 const base=C.ruleFor('2026-11-03','1');
 assert.deepEqual([base.start,base.end,base.lunchStart,base.lunchEnd,base.entryGrace,base.exitGrace,base.excursion,base.source],['09:00','18:00','12:00','13:00',10,10,false,'base']);
 assert.equal(base,C.BASE_RULE,'조정이 없으면 기본 규칙 그대로');assert.ok(Object.isFrozen(base));
 assert.deepEqual([C.lateAfter(base),C.earlyBefore(base)],['09:10','17:50']);assert.deepEqual(C.acceptedSchedules(base),['09:00 ~ 18:00']);
 const visit=C.ruleFor('2026-11-03','1',{excursion:true});
 assert.deepEqual([visit.start,visit.end,visit.excursion,visit.source],['10:00','17:00',true,'excursion']);assert.equal(C.scheduleText(visit),'10:00 ~ 17:00');
 assert.deepEqual([C.lateAfter(visit),C.earlyBefore(visit)],['10:10','16:50']);
 assert.deepEqual(C.acceptedSchedules(visit),['10:00 ~ 17:00','09:00 ~ 18:00'],'체크히어 강의는 기본 시간으로 만들어져 있어 함께 받음');
 assert.notEqual(visit.version,base.version);
 // 예전 모양(둘째 인자 객체)도 같은 값
 assert.equal(C.ruleFor('2026-11-03',{classId:'1',excursion:true}),visit);assert.equal(C.ruleFor('2026-11-03',{classId:'1'}),base);
 assert.equal(C.isExcursionDay('1','2026-11-03'),false,'견학 날짜는 시간표가 나오면 cohort.json excursions에 넣습니다');
 assert.deepEqual([C.DISEASE.warn,C.DISEASE.max,C.COMPLETION_RATE],[4,6,80]);
});

test('admin time overrides per date/class: all-class then class entries, invalid entries fall back to the base rule',()=>{
 const items=[
  {date:'2026-11-05',start:'09:30',end:'17:30',note:'전체 행사'},
  {date:'2026-11-05',classIds:['3','4'],start:'10:00',end:'16:00',exitGrace:5,note:'3·4반 이동'},
  {date:'2026-11-06',classIds:['7'],excursion:true},
  {date:'2026-11-09',classIds:['2'],start:'25:00'},
  {date:'2026-11-10',start:'13:00',end:'12:00'},
  {date:'2026-11-11',lunchStart:'08:00'}
 ];
 const all=C.ruleFor('2026-11-05','1',items);
 assert.deepEqual([all.start,all.end,all.source,all.note],['09:30','17:30','override','전체 행사']);assert.ok(Object.isFrozen(all));
 assert.deepEqual([C.lateAfter(all),C.earlyBefore(all)],['09:40','17:20']);assert.deepEqual(C.acceptedSchedules(all),['09:30 ~ 17:30','09:00 ~ 18:00']);
 const three=C.ruleFor('2026-11-05','3',items);
 assert.deepEqual([three.start,three.end,three.exitGrace,three.entryGrace,three.lunchStart],['10:00','16:00',5,10,'12:00'],'반 항목이 전체 항목보다 우선, 안 적은 칸은 그대로');
 assert.equal(three.note,'전체 행사 · 3·4반 이동');assert.notEqual(three.version,all.version);
 assert.equal(C.ruleFor('2026-11-05',4,{items}).start,'10:00','반 번호는 숫자로 와도 됨');
 const seven=C.ruleFor('2026-11-06','7',items);assert.deepEqual([seven.start,seven.end,seven.excursion,seven.source],['10:00','17:00',true,'override'],'조정으로 견학 날 지정');
 assert.equal(C.ruleFor('2026-11-06','8',items),C.BASE_RULE,'다른 반은 기본');
 assert.equal(C.ruleFor('2026-11-09','2',items),C.BASE_RULE,'틀린 시간 항목은 버림');
 assert.equal(C.ruleFor('2026-11-10','1',items),C.BASE_RULE,'합친 결과가 맞지 않으면(시작>끝) 기본');
 assert.equal(C.ruleFor('2026-11-11','1',items),C.BASE_RULE,'점심이 수업 시간 밖이면 기본');
 assert.equal(C.ruleFor('2026-11-05','1',null),C.BASE_RULE);assert.equal(C.ruleFor('2026-11-05','1',{}),C.BASE_RULE);
 // 견학 날 + 조정: 견학 규칙 위에 덧씀. 1월(2027) 날짜도 같은 방식
 const both=C.ruleFor('2026-11-12','5',{excursion:true,items:[{date:'2026-11-12',end:'16:30'}]});assert.deepEqual([both.start,both.end,both.excursion],['10:00','16:30',true]);
 assert.equal(C.ruleFor('2027-01-14','16',[{date:'2027-01-14',classIds:['16'],start:'09:20'}]).start,'09:20');
 // 항목 검사(나중 관리자 화면이 저장 전에 씀)
 assert.deepEqual(C.ruleOverrideProblems({date:'2026-11-05',start:'09:30'}),[]);
 assert.deepEqual(C.ruleOverrideProblems({date:'2026-10-27'}),[],'교육 기간 밖도 받음(2026-10-20)');assert.ok(C.ruleOverrideProblems({date:'2026-13-01'}).length,'날짜 모양');assert.ok(C.ruleOverrideProblems({date:'2027-01-04',classIds:['18']}).length,'반 번호');
 assert.ok(C.ruleOverrideProblems({date:'2027-01-04',entryGrace:-1}).length);assert.ok(C.ruleOverrideProblems([]).length);
 assert.deepEqual(C.ruleOverrideProblems({date:'2027-01-04',classIds:['16'],excursion:true}),[],'1월 날짜·16반');
 assert.deepEqual(C.ruleProblems(C.BASE_RULE),[]);assert.deepEqual(C.ruleProblems(C.EXCURSION_RULE),[]);
});

test('Firebase is the 2기 project; /old goes to the 1기 alias; bridge, storage and file names carry the cohort',()=>{
 assert.equal(C.FIREBASE_PROJECT,'hint-knewdeal-2');
 assert.deepEqual(C.firebaseConfig(),{apiKey:'AIzaSyBAmlzBuD21IGRSK5yT7cpatHuelqn98do',authDomain:'hint-knewdeal-2.firebaseapp.com',projectId:'hint-knewdeal-2',storageBucket:'hint-knewdeal-2.firebasestorage.app',messagingSenderId:'179773915875',appId:'1:179773915875:web:036dab2c2e18b875947bd6'});
 assert.equal(C.firebaseReady(),true);assert.equal(N.FIREBASE_READY,true);assert.equal(N.FIREBASE_KEY,C.FIREBASE_KEY);assert.match(C.FIREBASE_MISSING_TEXT,/2기 Firebase 설정 필요/);
 assert.equal(C.OLD_SITE_URL,'https://hint-knewdeal-1gi.vercel.app');
 const vercel=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8')),to=src=>vercel.redirects.find(r=>r.source===src)?.destination;
 assert.equal(to('/old'),C.OLD_SITE_URL+'/');assert.equal(to('/old/:path*'),C.OLD_SITE_URL+'/:path*');assert.equal(to('/beta2'),'/');
 assert.ok(!(vercel.rewrites||[]).some(r=>/^\/old/.test(r.source)),'/old는 넘김(redirect)만');
 assert.match(C.TEACHER_PORTAL_URL,/^https:\/\/script\.google\.com\/macros\/s\/AKfycbyohCVK[\w-]+\/exec$/);
 assert.equal(C.MASTER_SHEET_ID,'1rbe97EuzlECGrRZ0RBLCTNmjm30SMd41RaSQfLfmq6g');assert.equal(C.DROPOUT_SHEET_ID,'');
 assert.equal(C.BRIDGE_PORT,8766);assert.equal(C.BRIDGE_URL,'http://127.0.0.1:8766');assert.equal(C.lectureTag(3),'[3반]');
 assert.equal(C.storageKey('live.class'),'h2:live.class');assert.equal(C.fileName('출결.xlsx'),'2기_출결.xlsx');assert.equal(C.fileName('2기_출결.xlsx'),'2기_출결.xlsx');
 assert.deepEqual([...C.ADMINS],['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);assert.equal(C.APPROVER,'hint.kpc@gmail.com');
 assert.equal(C.SHEET_API.urlEnv,'HINT_SHEET_API_URL');assert.equal(C.SHEET_API.keyEnv,'HINT_SHEET_API_KEY');
 assert.ok(!JSON.stringify(json).includes('AKfycbzChr0p'),'데이터 API 주소는 cohort.json에 두지 않고 Vercel 환경변수에만');
 assert.equal(C.feature('nope'),false);assert.equal(C.feature('timetable'),true,'2기 시간표(261014+261007 기준) 열림');for(const f of ['materials','surveys','uploads','periodRoster','operationsWork','dropout'])assert.equal(C.feature(f),false,f);
});
