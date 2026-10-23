import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {sortEntries,weekDays,monthDays,validateEntry,conflicts,publishEntries,visibleToday,lectureEndDays,lectureEndsOn,startDate,isOffDay} from '../../timetable-core.mjs';
import {REAL_CLASS_IDS as CLASS_IDS,TRAINING_DAYS,HOLIDAYS,classInfo} from '../../cohort.mjs';// 시간표는 공식 16반(17반 시험용 테스트반 없음)
const seed=JSON.parse(readFileSync(new URL('../../timetable-seed.json',import.meta.url)));
// 2기 기준: 261014(최신)+261007 절충, 1007판 15반 과정명 한 줄 밀림 바로잡음(사용자 확인 2026-10-19).
test('2기 seed: 16 classes, one lesson on each of the 60 training days, cohort holidays, no invented times or contacts',()=>{
 assert.equal(seed.cohort,'2');assert.equal(seed.version,'20261022');assert.deepEqual(Object.keys(seed.classes),[...CLASS_IDS]);assert.equal(TRAINING_DAYS.length,60);
 for(const [cid,c]of Object.entries(seed.classes)){
  // 12반(부산대 제조지능화, 최신 명단 2026-10-22): 일정표에 맞는 열이 없어 휴일 칸만(운영팀 새 일정 대기, 지어내지 않음)
  if(cid==='12'){assert.deepEqual(c.entries.map(e=>e.kind),HOLIDAYS.map(()=>'holiday'));assert.deepEqual(seed.merge.classes['12'].days,0);continue;}
  const lessons=c.entries.filter(e=>e.kind!=='holiday');assert.deepEqual(lessons.map(e=>e.date),[...TRAINING_DAYS],cid+'반 교육일');
  assert.deepEqual(c.entries.filter(e=>e.kind==='holiday').map(e=>e.date),[...HOLIDAYS],cid+'반 휴일 칸');assert(!lessons.some(e=>isOffDay(e.date)));
  assert.equal(new Set(c.entries.map(e=>e.id)).size,c.entries.length);
  for(const e of c.entries){validateEntry(e);assert.equal(e.course,classInfo(cid).course);assert.equal(e.instructorId,'');assert.equal(e.start,'');assert.equal(e.end,'');assert(!e.review,'판끼리 다른 칸 없음(2026-10-19 기준 충돌 0건)');}
  for(const e of lessons)assert(['1014','1007','both',''].includes(e.origin.subject)&&e.origin.hours===(cid==='8'?'1007':'both')); // 8반은 1007판에만 열
  assert.deepEqual(lessons.filter(e=>e.event==='입교식').map(e=>e.date),['2026-10-28','2026-10-29','2026-10-30']);assert.deepEqual(lessons.filter(e=>e.event==='수료식').map(e=>e.date),['2027-01-22']);
  assert.equal(lessons.filter(e=>e.event==='분해조립').length,1);assert.equal(lessons.filter(e=>/^공장견학/.test(e.event)).length,1);
  assert.equal(lessons.reduce((n,e)=>n+e.hours,0),cid==='10'?460:464,cid+'반 시간 합계(10반은 아르피나 제조지능화 1 열: 공장견학 이론 4시간)');
 }
 // 반 열 대응(확정 명단 2026-10-22): 8반(대구상공회의소)은 1007판 X열에만, 마이크로웨이브 모빌리티 열(R)은 두 판 모두 뺌.
 assert.deepEqual(seed.merge.columns['1014'],{1:'C',2:'F',3:'I',4:'L',5:'O',6:'U',7:'X',9:'AA',10:'AG',11:'AJ',13:'AM',14:'AP',15:'AS',16:'AV'});
 assert.deepEqual(seed.merge.columns['1007'],{1:'C',2:'F',3:'I',4:'L',5:'O',6:'U',8:'X',7:'AA',9:'AD',10:'AJ',11:'AM',13:'AP',14:'AS',15:'AV',16:'AY'});
 assert.match(seed.merge.excluded['1014'][1],/^AD\(부산대/);assert.match(seed.merge.excluded['1007'][1],/^AG\(.*부산대/);
 assert.match(seed.merge.excluded['1007'][0],/^R\(.*마이크로웨이브/);assert.match(seed.merge.excluded['1014'][0],/^R\(마이크로웨이브/);assert.deepEqual(seed.merge.aligned.map(a=>[a.sheet,a.classId,a.from,a.changed]),[['1007','15','2026-12-02',29]]);
 const c15=Object.fromEntries(seed.classes['15'].entries.map(e=>[e.date,e.title]));
 assert.deepEqual([c15['2026-12-02'],c15['2026-12-04'],c15['2026-12-14'],c15['2026-12-18'],c15['2027-01-21'],c15['2027-01-22']],['AI기반 제조데이터 분석 입문','광주공장 · 견학·이론','폴리텍대 · 분해조립','직무특화 컨퍼런스 2','프로그램','수료식']);
 assert.equal(c15['2026-11-27'],'직무특화 (세부 과목 미정)','두 판 모두 과목 칸이 빈 날은 지어내지 않음');
 assert.equal(seed.classes['2'].entries.find(e=>e.date==='2026-11-27').origin.subject,'1014','1007판 빈칸을 1014판 값으로');
 assert.equal(seed.classes['3'].entries.find(e=>e.date==='2026-11-13').origin.subject,'1007','1014판 빈칸을 1007판 값으로');
 assert.equal(seed.classes['1'].entries.find(e=>e.date==='2026-11-12').online,true);assert.equal(seed.classes['1'].entries.find(e=>e.date==='2026-11-13').venue,'화성공장');
});
test('calendar handles cross-month and cross-year weeks, starts inside the cohort period and shows the next actual class',()=>{
 assert.equal(weekDays('2026-12-31')[0],'2026-12-28');assert.equal(weekDays('2026-12-31')[6],'2027-01-03');assert.equal(monthDays('2026-12-01').length,42);
 assert.deepEqual([startDate('2026-10-20'),startDate('2026-11-17'),startDate('2027-02-01')],['2026-10-28','2026-11-17','2027-01-22']);
 assert.equal(isOffDay('2026-12-25'),true);assert.equal(isOffDay('2026-12-24'),false);
 const v=visibleToday(seed.classes['1'].entries,'2026-12-31');assert.equal(v.today.length,1);assert.equal(v.today[0].kind,'holiday');assert.equal(v.next.date,'2027-01-04');
});
test('teacher copy drops sheet provenance and falls back to the workbook instructor name',()=>{
 const e={...seed.classes['3'].entries.find(e=>e.instructorName),review:['instructor']},p=publishEntries([e],{});
 assert.equal(p[0].instructorName,e.instructorName);assert(!('origin' in p[0])&&!('review' in p[0])&&!('sourceText' in p[0]));
 assert.equal(publishEntries([{...e,instructorId:'t'}],{t:{name:'등록 강사'}})[0].instructorName,'등록 강사');
});
test('invalid times rejected; instructor conflicts and privacy-safe publication',()=>{
 const e={id:'one',date:'2026-09-11',course:'course',module:'module',title:'test',day:1,hours:8,kind:'class',start:'09:00',end:'18:00',instructorId:'i'};
 assert.throws(()=>validateEntry({...e,end:'08:00'}));assert.throws(()=>validateEntry({...e,end:''}));assert.throws(()=>validateEntry({...e,day:0}));
 assert.equal(conflicts(e,{'2':{entries:[{...e,id:'two'}]}},'1').length,1);
 assert.equal(conflicts(e,{'1':{entries:[e]}},'1').length,0);
 const p=publishEntries([{...e,sourceText:'original'}],{i:{name:'강사',phone:'private',note:'private'}});
 assert.equal(p[0].instructorName,'강사');assert(!JSON.stringify(p).includes('private'));assert(!('sourceText' in p[0]));
});

test('lecture completion uses each lecture last scheduled date, isolated by class and course',()=>{
 const make=(id,title,date,extra={})=>({id,title,date,lectureId:title,course:'HW',module:'직무특화',day:1,kind:'class',...extra});
 const rows=[make('a','SW 테스팅','2026-09-01'),make('b','SW 테스팅','2026-09-03'),make('c','MCU','2026-09-10'),make('d','MCU','2026-09-11'),make('holiday','MCU','2026-09-12',{kind:'holiday'}),make('e','SW 테스팅','2026-09-02',{course:'SW'}),make('f','SW 테스팅','2026-09-01',{classId:'2'})];
 assert.deepEqual(lectureEndDays(rows).map(e=>e.id),['b','d','e','f']);
 assert.deepEqual(lectureEndsOn(rows,'2026-09-03').map(e=>e.title),['SW 테스팅']);
 assert.equal(lectureEndsOn(rows,'2026-09-12').length,0);
 rows.push(make('g','SW 테스팅','2026-09-15'));
 assert.equal(lectureEndsOn(rows,'2026-09-03').length,0,'schedule extension moves the notice');
 assert.equal(lectureEndsOn([...rows,{...rows.at(-1),id:'g2'}],'2026-09-15').length,1,'same-date lecture sessions produce one notice');
});
