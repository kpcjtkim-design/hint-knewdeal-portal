import test from 'node:test';
import assert from 'node:assert/strict';
import {hasHospitalRecognition,diseaseRiskReport} from '../../disease-recognition-core.mjs';
import {deriveAttendanceClass} from '../../attendance-derived-core.mjs';

test('only applied hospital recognition memo counts, once per education date',()=>{
 assert.equal(hasHospitalRecognition({entryMemo:'(인정지각)병원_담임:홍길동(10:00)'}),true);
 assert.equal(hasHospitalRecognition({exitMemo:'인정조퇴_병원_담임:홍길동'}),true);
 for(const text of ['(인정지각)면접_담임:홍길동','(인정지각)병원아님_담임:홍길동','병원 방문 예정','(인정외출)인적성_담임:홍길동'])assert.equal(hasHospitalRecognition({entryMemo:text}),false,text);
 const dates=['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-21','2026-09-22'];
 const attendance=[['이름','','','','',...dates],['홍길동','','','','',...dates.map(()=> '인정출석')]];
 const records=dates.map((date,i)=>({id:`1_${date}_student`,classId:'1',date,name:'홍길동',studentKey:'student',collectedAt:`${date}T10:00:00Z`,entryMemo:'(인정지각)병원_담임:홍길동(10:00)',exitMemo:i===0?'(인정조퇴)병원_담임:홍길동(16:00)':'',readState:'complete'}));
 const derived=deriveAttendanceClass({attendance},{classId:'1',records,today:'2026-09-23'});
 assert.deepEqual(derived.students[0].diseaseDates,dates);
 let report=diseaseRiskReport({'1':derived},{today:'2026-09-17'});
 assert.equal(report.rows[0].count,4);assert.equal(report.rows[0].level,'주의');
 report=diseaseRiskReport({'1':derived},{today:'2026-09-18'});
 assert.equal(report.rows[0].count,5);assert.equal(report.rows[0].level,'주의');
 report=diseaseRiskReport({'1':derived},{today:'2026-09-21'});
 assert.equal(report.rows[0].level,'6회 도달');
 report=diseaseRiskReport({'1':derived},{today:'2026-09-23'});
 assert.equal(report.rows[0].level,'초과');
 assert.equal(report.rows[0].count,7);
});

test('one to three dates do not trigger a warning and absent summaries stay unknown',()=>{
 const summary={students:[{id:'a',name:'홍길동',diseaseDates:['2026-09-14','2026-09-15','2026-09-16']} ]};
 const report=diseaseRiskReport({'1':summary,'2':null});
 assert.equal(report.rows.length,0);assert.deepEqual(report.missing,['2']);
});

test('ambiguous same-name records are flagged instead of credited to either student',()=>{
 const attendance=[['이름','','','','2026-09-14'],['동명이인','','','','인정출석'],['동명이인','','','','인정출석']];
 const records=[{id:'1_2026-09-14_a',classId:'1',date:'2026-09-14',name:'동명이인',studentKey:'a',phoneLast4:'1234',entryMemo:'(인정지각)병원_담임:홍길동'}];
 const derived=deriveAttendanceClass({attendance},{classId:'1',records,today:'2026-09-23'});
 const report=diseaseRiskReport({'1':derived});
 assert.equal(report.rows.length,0);assert.equal(report.reviewRows.length,2);
 assert(derived.students.every(s=>s.diseaseDates.length===0&&s.diseaseReviewDates[0]==='2026-09-14'));
});
