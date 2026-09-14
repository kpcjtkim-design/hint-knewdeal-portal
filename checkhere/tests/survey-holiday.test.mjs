import test from 'node:test';import assert from 'node:assert/strict';
import {shiftForHoliday} from '../../timetable-holiday.mjs';
import {attendanceTargets,summarizeResponses,responseColumns,sourceCandidates,eventsForClass,classNumber} from '../../survey-core.mjs';
import {modernAttendance} from '../../attendance-rollout.mjs';
import {suggestReason} from '../../checkhere-proposal-core.mjs';
const entry=(id,date,kind='class')=>({id,date,kind,course:'임베디드 AI(HW)',module:kind==='holiday'?'휴일':'직무특화',title:kind==='holiday'?'휴일':'SW 테스팅',day:1,hours:8,note:'유지',instructorId:'same'});
test('holiday shifts each date group once, excludes weekends and holidays, preserves records',()=>{
 const before=[entry('a','2026-09-11'),entry('b','2026-09-11'),entry('c','2026-09-14'),entry('h','2026-09-15','holiday'),entry('last','2026-10-22')],copy=structuredClone(before),r=shiftForHoliday(before,'2026-09-11');
 assert.deepEqual(before,copy);assert.equal(r.entries.find(e=>e.id==='a').date,'2026-09-14');assert.equal(r.entries.find(e=>e.id==='b').date,'2026-09-14');assert.equal(r.entries.find(e=>e.id==='c').date,'2026-09-16');assert.equal(r.entries.find(e=>e.id==='h').date,'2026-09-15');assert.equal(r.entries.find(e=>e.id==='a').instructorId,'same');assert.equal(r.lastDate,'2026-10-23');assert.equal(r.entries.length,before.length+1);
 assert.throws(()=>shiftForHoliday(r.entries,'2026-09-11'),/이미 휴일/);assert.throws(()=>shiftForHoliday(before,'2026-09-12'),/주말/);
});
test('attendance survey eligibility excludes absences and unresolved recognized subtypes',()=>{
 const d={attendance:[['이름','','','','9/11'],['가','','','','출석'],['나','','','','인정출석'],['다','','','','인정출석'],['라','','','','결석'],['마','','','','지각'],['바','','','','인정출석']]};
 const t=attendanceTargets(d,'2026-09-11',{'1_나':{sheetStatus:'인정출석',portalStatus:'인정조퇴'},'5_바':{sheetStatus:'인정출석',portalStatus:'인정출석'}});
 const result=summarizeResponses({classId:'2',targets:t,responses:[{name:'가',classId:'2. 한양대'},{name:' 가 ',classId:'2반'},{name:'나',classId:'1반'},{name:'명단외',classId:'2반'}]});
 assert.deepEqual(result.answered.map(x=>x.name),['가']);assert.deepEqual(result.missing.map(x=>x.name),['나','마']);assert.equal(result.review[0].name,'다');assert.deepEqual(result.excluded.map(x=>x.name),['라','바']);assert.equal(result.duplicateCount,1);assert.equal(result.unknown.length,1);assert.throws(()=>attendanceTargets(d,'2026-09-14'),/출결 열/);
});
test('duplicate roster names never counted as answered or missing',()=>{const r=summarizeResponses({classId:'1',targets:[{id:'1',name:'동명',eligible:true},{id:'2',name:'동명',eligible:true}],responses:[{name:'동명',classId:'1반'}]});assert.equal(r.review.length,2);assert.equal(r.eligibleCount,0);});
test('venue choices identify classes; an unrecognized class label cannot create a false nonresponder',()=>{
 assert.equal(classNumber('서울대_임베디드AI(HW)'),'1');assert.equal(classNumber('기아 광주교육센터(B)_제조지능화(2)'),'17');assert.equal(classNumber('후인원(B)_제조지능화'),'4');assert.equal(classNumber('아르피나(A)_임베디드AI(HW)'),'10');assert.equal(classNumber('아르피나(B)_제조지능화(1)'),'12');assert.equal(classNumber('부산경영자총협회_제조지능화(2)'),'13');assert.equal(classNumber('알 수 없는 반'),'');
 const r=summarizeResponses({classId:'1',targets:[{id:'a',name:'가',eligible:true},{id:'b',name:'나',eligible:true}],responses:[{name:'가',classId:'서울대_임베디드AI(HW)'},{name:'나',classId:'미확인 교육장'}]});assert.equal(r.answered.length,1);assert.equal(r.missing.length,0);assert.equal(r.review[0].name,'나');
});
test('response headers must be unique and require class identity',()=>{assert.deepEqual(responseColumns(['타임스탬프','성함을 입력해주세요','소속반']),{name:1,classId:2,timestamp:0});assert.throws(()=>responseColumns(['타임스탬프','성명','성함','분반']),/이름/);});
test('survey matching follows lecture shifts and distinguishes courses',()=>{
 const catalog={events:[{classId:'1',date:'2026-09-11',title:'직무특화_SW 테스팅'}]},entries=[entry('a','2026-09-16'),entry('b','2026-09-17')];assert.equal(eventsForClass(catalog,'1',entries)[0].date,'2026-09-17');
 assert.equal(sourceCandidates(catalog.events[0],[{title:'임베디드AI-HW(SW 테스팅)'},{title:'임베디드AI-SW(SW 테스팅)'}],'임베디드 AI(HW)').length,1);
 const event={title:'AI기반 제조데이터 분석 입문'},sources=[{title:'제조지능화(AI기반 제조데이터 분석 입문)'},{title:'임베디드AI-SW(AI기반 제조데이터 분석 입문)'}];
 for(const course of ['제조지능화','제조지능화(1)','제조지능화(2)','제조지능화(3)'])assert.deepEqual(sourceCandidates(event,sources,course),[sources[0]]);
});
test('modern attendance is pilot-admin only, case insensitive, no teacher rollout',()=>{assert(modernAttendance({email:'HINT.KPC@gmail.com'},{role:'ADMIN',active:true}));assert(modernAttendance({email:'kpc.jtkim@gmail.com'},{role:'ADMIN'}));assert(!modernAttendance({email:'staff@example.com'},{role:'ADMIN'}));assert(!modernAttendance({email:'hint.kpc@gmail.com'},{role:'TEACHER'}));assert(!modernAttendance({email:'hint.kpc@gmail.com'},{role:'ADMIN',active:false}));});
test('recommendation remains useful without collected data and marks missing facts',()=>{const r=suggestReason({status:'인정지각',reason:'병원',teacher:'담임'});assert.match(r.text,/\(인정지각\)병원_담임:담임/);assert.match(r.text,/시간 확인/);assert(r.incomplete);assert.equal(suggestReason({status:'출석'}).text,'');});
