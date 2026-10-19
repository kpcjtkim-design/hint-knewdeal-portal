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
 assert.equal(C.CLASS_COUNT,16);assert.deepEqual([...C.CLASS_IDS],Array.from({length:16},(_,i)=>String(i+1)));
 assert.deepEqual(C.CLASSES.map(c=>c.name),NAMES);
 assert.deepEqual(C.CLASSES.map(c=>c.official),NAMES.map(n=>'[현대자동차그룹 HINT] '+n));
 assert.deepEqual(C.CLASSES.map(c=>c.region),['서울','서울','충청','충청','충청','대경','대경','대경','동남','동남','동남','동남','동남','호남','호남','호남']);
 assert.deepEqual([...new Set(C.CLASSES.map(c=>c.course))],['모빌리티 AI','제조지능화']);
 assert.deepEqual(C.CLASSES.filter(c=>c.course==='모빌리티 AI').map(c=>c.id),['1','3','6','7','9','10','14']);
 assert.deepEqual(C.CLASSES.map(c=>c.capacity),C.CLASS_IDS.map(id=>id==='4'?31:30));
 assert.equal(C.classLabel('12'),'12반 · 제조지능화 · 아르피나C');assert.equal(C.classLabel('17'),'17반');
 // 반 구분어는 서로 겹치지 않아야 명단 '반배정' 문구에서 한 반만 고릅니다.
 for(const a of C.CLASSES)assert.equal(C.CLASSES.filter(b=>b.official.includes(a.rosterKey)).length,1,a.rosterKey);
});

test('class id pattern accepts 1..16 only',()=>{
 assert.equal(C.classIdPattern(),'(?:[1-9]|1[0-6])');
 for(const id of C.CLASS_IDS)assert.ok(C.CLASS_ID_RE.test(id)&&C.isClassId(id)&&N.isClassId(id));
 for(const bad of ['0','17','18','01','1 ','',' 1','10a'])assert.ok(!C.CLASS_ID_RE.test(bad)&&!C.isClassId(bad),bad);
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
 const base=C.ruleFor('2026-11-03',{classId:'1'});
 assert.deepEqual([base.start,base.end,base.lunchStart,base.lunchEnd,base.entryGrace,base.exitGrace,base.excursion],['09:00','18:00','12:00','13:00',10,10,false]);
 const visit=C.ruleFor('2026-11-03',{classId:'1',excursion:true});
 assert.deepEqual([visit.start,visit.end,visit.excursion],['10:00','17:00',true]);assert.equal(C.scheduleText(visit),'10:00 ~ 17:00');
 assert.notEqual(visit.version,base.version);
 assert.equal(C.isExcursionDay('1','2026-11-03'),false,'견학 날짜는 시간표가 나오면 cohort.json excursions에 넣습니다');
 assert.deepEqual([C.DISEASE.warn,C.DISEASE.max,C.COMPLETION_RATE],[4,6,80]);
});

test('Firebase fails closed until the 2기 project values are filled; bridge, storage and file names carry the cohort',()=>{
 assert.equal(C.FIREBASE_PROJECT,'hint-knewdeal-2');
 if(!json.firebase.apiKey||!json.firebase.appId){assert.equal(C.firebaseConfig(),null);assert.equal(C.firebaseReady(),false);assert.equal(N.FIREBASE_READY,false);assert.match(C.FIREBASE_MISSING_TEXT,/2기 Firebase 설정 필요/);}
 else assert.equal(C.firebaseConfig().projectId,'hint-knewdeal-2');
 assert.equal(C.BRIDGE_PORT,8766);assert.equal(C.BRIDGE_URL,'http://127.0.0.1:8766');assert.equal(C.lectureTag(3),'[3반]');
 assert.equal(C.storageKey('live.class'),'h2:live.class');assert.equal(C.fileName('출결.xlsx'),'2기_출결.xlsx');assert.equal(C.fileName('2기_출결.xlsx'),'2기_출결.xlsx');
 assert.deepEqual([...C.ADMINS],['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);assert.equal(C.APPROVER,'hint.kpc@gmail.com');
 assert.equal(C.SHEET_API.urlEnv,'HINT_SHEET_API_URL');assert.equal(C.SHEET_API.keyEnv,'HINT_SHEET_API_KEY');
 assert.equal(typeof C.OLD_SITE_URL,'string');assert.equal(C.feature('nope'),false);
});
