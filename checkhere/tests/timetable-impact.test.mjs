import test from 'node:test';
import assert from 'node:assert/strict';
import {timetableImpact,timetableImpactHtml} from '../../timetable-impact.mjs';
import {shiftForHoliday} from '../../timetable-holiday.mjs';
const lesson=(id,date,day=1,extra={})=>({id,date,day,course:'임베디드 AI(HW)',module:'직무특화',lectureId:'testing',title:'SW 테스팅',kind:'class',hours:8,start:'09:00',end:'18:00',...extra});
const before=[lesson('a','2026-09-21'),lesson('b','2026-09-22',2),lesson('c','2026-09-23',1,{lectureId:'other',title:'다른 강의'})];
const catalog={events:[{id:'s1',classId:'1',title:'직무특화_SW 테스팅',date:'2026-09-22'},{id:'s2',classId:'2',title:'직무특화_SW 테스팅',date:'2026-09-22'}]};
test('lecture last day and matched survey move with schedule while other class stays scoped',()=>{
 const after=before.map(e=>e.id==='b'?{...e,date:'2026-09-24'}:e),impact=timetableImpact({classId:'1',before,after,published:before,catalog});
 assert.equal(impact.changes.length,1);assert.deepEqual(impact.ends,[{title:'SW 테스팅',from:'2026-09-22',to:'2026-09-24'}]);
 assert.equal(impact.surveys.length,1);assert.equal(impact.surveys[0].id,'s1');assert.equal(impact.surveys[0].to,'2026-09-24');assert.equal(impact.teacherChanges,1);
});
test('explicit survey date remains fixed even when the class end moves',()=>{
 const config={events:{s1:{date:'2026-09-25'}}},snapshot=JSON.stringify({before,config});
 const impact=timetableImpact({classId:'1',before,after:before.map(e=>e.id==='b'?{...e,date:'2026-09-24'}:e),published:before,catalog,config});
 assert.deepEqual([impact.surveys[0].from,impact.surveys[0].to,impact.surveys[0].fixed],['2026-09-25','2026-09-25',true]);
 assert.match(timetableImpactHtml([impact]),/별도 지정일 유지 · 자동 변경하지 않음/);assert.equal(JSON.stringify({before,config}),snapshot);
});
test('changing an earlier day marks survey participation dates while final day stays unchanged',()=>{
 const impact=timetableImpact({classId:'1',before,after:before.map(e=>e.id==='a'?{...e,date:'2026-09-18'}:e),catalog});
 assert.equal(impact.ends.length,0);assert.equal(impact.surveys.length,1);assert.equal(impact.surveys[0].to,'2026-09-22');assert.equal(impact.surveys[0].datesChanged,true);
});
test('holiday shift reports every moved lesson and keeps holidays out of lecture endings',()=>{
 const shifted=shiftForHoliday(before,'2026-09-22'),impact=timetableImpact({classId:'1',before,after:shifted.entries,catalog});
 assert.equal(impact.changes.length,3);assert.equal(impact.ends.length,2);assert.equal(impact.surveys[0].to,'2026-09-23');assert(!impact.ends.some(e=>e.title==='대체휴일'));
});
test('draft save and publish explanations distinguish teacher visibility and avoid unknown date claims',()=>{
 const impact=timetableImpact({classId:'1',before,after:[...before,lesson('d','2026-09-24',3)],published:before,catalog,configKnown:false});
 const draft=timetableImpactHtml([impact]);assert.match(draft,/공개하기 전까지 그대로 유지/);assert.match(draft,/설문 설정을 읽지 못했습니다/);assert.equal(impact.surveys[0].to,'확인 필요');
 assert.match(timetableImpactHtml([impact],{operation:'publish'}),/공개하면 담임의 오늘의 수업·전체 시간표에 1개 변경/);
});
test('removed or renamed linked lecture reports survey mapping review and escapes user content',()=>{
 const impact=timetableImpact({classId:'1',before,after:before.map(e=>e.lectureId==='testing'?{...e,title:'<script>다른 이름</script>',lectureId:'renamed'}:e),catalog});
 assert.equal(impact.surveys[0].needsReview,true);assert.equal(impact.surveys[0].to,'2026-09-22');
 const html=timetableImpactHtml([impact]);assert(!html.includes('<script>'));assert.match(html,/강의 연결 확인 필요/);
});
test('an unchanged schedule yields no change rows and does not create fake survey dates',()=>{
 const impact=timetableImpact({classId:'1',before,after:structuredClone(before),published:before,catalog});
 assert.deepEqual([impact.changes,impact.ends,impact.surveys],[[],[],[]]);assert.equal(impact.teacherChanges,0);
});
test('new lecture without a survey connection explicitly asks for mapping review',()=>{
 const impact=timetableImpact({classId:'1',before,after:[...before,lesson('x','2026-09-24',1,{title:'새 강의',lectureId:'new'})],catalog});
 assert.deepEqual(impact.unmapped,['새 강의']);assert.match(timetableImpactHtml([impact]),/새 강의: 연결된 설문을 찾지 못했습니다/);
});
