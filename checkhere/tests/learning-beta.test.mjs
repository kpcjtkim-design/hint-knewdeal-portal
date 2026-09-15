import test from 'node:test';import assert from 'node:assert/strict';
import {deriveRecognized,deriveAttendanceClass,targetsFromDerived,attendanceStatistics} from '../../attendance-derived-core.mjs';
import {scoreColumns,summarizeScores} from '../../survey-scores.mjs';
import {moveLesson} from '../../timetable-board.mjs';
const record={readState:'complete',schedule:'09:00 ~ 18:00',entry:'08:55',exit:'17:55',outings:[]};
test('recognized subtypes use actual times, complete outings, manual precedence and uncertain boundaries',()=>{
 assert.equal(deriveRecognized('인정출석',{}, {...record,entry:'13:00'}).status,'인정지각');
 assert.equal(deriveRecognized('인정출석',{}, {...record,exit:'15:00'}).status,'인정조퇴');
 assert.equal(deriveRecognized('인정출석',{}, {...record,entry:'13:00',outings:[{start:'14:00',end:'15:00'}]}).status,'인정외출');
 assert.equal(deriveRecognized('인정출석',{}, {...record,entry:'13:00',exit:'15:00'}).review,true);
 assert.equal(deriveRecognized('인정출석',{}, {...record,rawEntry:'13:00',entry:'09:00'}).status,'인정지각');
 assert.equal(deriveRecognized('인정출석',{}, {...record,entry:'09:10:30'}).review,true);
 assert.equal(deriveRecognized('인정출석',{}, {...record,outingCount:1}).review,true);
 assert.equal(deriveRecognized('인정출석',{},record,{excursion:true}).review,true);
 assert.equal(deriveRecognized('인정출석',{sheetStatus:'인정출석',portalStatus:'인정조퇴'},record).status,'인정조퇴');
 assert.equal(deriveRecognized('인정출석',{},null).review,true);
});
test('dropout needs prior enrollment and trailing explicit statuses; holidays and whole-class missing entry do not expel anyone',()=>{
 const sheet={attendance:[['이름','','','','9/10','9/11','9/12','9/14','9/15','9/16'],['가','','','','출석','출석','해당없음','해당없음','해당없음','해당없음'],['나','','','','해당없음','해당없음','해당없음','해당없음','해당없음','해당없음'],['다','','','','출석','출석','','','출석','해당없음']]};
 const options={classId:'2',today:'2026-09-15'},d=deriveAttendanceClass(sheet,options);
 assert.equal(d.students[0].dropout,true);assert.equal(d.students[0].dropoutDays,2);assert.equal(d.students[1].dropout,false);assert.equal(d.students[2].dropout,false);
 assert.equal(targetsFromDerived(d,'2026-09-10')[0].eligible,false);
 assert.equal(deriveAttendanceClass(sheet,{...options,today:'2026-09-16'}).students[0].dropout,true,'all class not entered retains the last evaluated dropout');
 sheet.attendance[1][8]='출석';assert.equal(deriveAttendanceClass(sheet,options).students[0].dropout,false,'returning status reverses automatic label');
 assert.equal(attendanceStatistics(d).dropouts,1);assert(!d.dates.includes('2026-09-12'));
});
test('insert shifts every intervening lesson and preserves holiday and all IDs',()=>{
 const e=(id,date)=>({id,date,title:id,course:'제조',module:'직무특화',kind:'class',day:1,hours:8,start:'09:00',end:'18:00',note:'keep '+id});
 const entries=[e('a','2026-09-14'),e('b','2026-09-15'),e('c','2026-09-16'),{...e('h','2026-09-17'),kind:'holiday'}];
 const moved=moveLesson(entries,'a','2026-09-16','c');assert.deepEqual(moved.map(e=>e.id),['b','c','a','h']);assert.deepEqual(moved.map(e=>e.date),entries.map(e=>e.date));assert.equal(moved[2].note,'keep a');assert.equal(entries[0].date,'2026-09-14');
 const back=moveLesson(moved,'a','2026-09-14','b');assert.deepEqual(back.map(e=>e.id),entries.map(e=>e.id));assert.throws(()=>moveLesson(entries,'a','2026-09-17'),/휴일/);
});
test('survey ratings exclude identifiers/free text and separate difficulty/NPS from overall; latest duplicate wins',()=>{
 const columns=scoreColumns(['이메일 주소','전화번호','[종합 만족도] 과정 전반에 만족하십니까?','본 교육 난이도는 어떠셨습니까?','추천할 의향이 있다 (0~10점)','좋았던 점을 자유롭게 작성해 주세요.']);
 assert.deepEqual(columns.map(q=>q.kind),['overall','difficulty','recommendation']);
 const response=(time,overall,nps)=>({name:'가',classId:'2반',timestamp:time,scores:columns.map(q=>({...q,value:q.kind==='overall'?overall:q.kind==='recommendation'?nps:3}))});
 const scores=summarizeScores([response('2026. 9. 10. 오전 9:00:00',1,0),response('2026. 9. 10. 오후 1:00:00',5,10),{...response('2026-09-11',1,0),classId:'1반'}],'2',[{name:'가'}]);
 assert.equal(scores.overallAverage,5);assert.equal(scores.overallCount,1);assert.equal(scores.questions.find(q=>q.kind==='recommendation').average,10);assert.equal(scores.questions[0].distribution[4],1);assert(!JSON.stringify(scores).includes('"name"'));
});
