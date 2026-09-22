import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAttendanceExport,attendanceDownloadPreflight} from '../../download-preflight-core.mjs';
import {attendanceTables} from '../../raw-download-core.mjs';

const data={attendance:[['이름','','','','9/1','9/2','9/3'],['가상가','','','','인정출석','인정출석',''],['가상나','','','','','인정출석','출석']],reasons:[['','','','','9/1','9/2','9/3'],['','','','','','','']],attendanceBackgrounds:[[],['','','','','#ffffff','#ff0000']]};
const stored={metadata:{'2026-09-02':{'0_가상가':{sheetColor:'#ff0000',evidenceStatus:'반려'}}},summary:{students:[{id:'0_가상가',name:'가상가',history:{'2026-09-02':{raw:'인정출석',status:'인정지각',review:true}}},{id:'1_가상나',name:'가상나',history:{'2026-09-02':{raw:'출석',status:'출석',evidenceStatus:'확인'}}}]},records:[]};
const options={classId:'1',data,stored,from:'2026-09-01',to:'2026-09-03',today:'2026-09-02'};

test('preflight uses collected source colors and metadata, distinguishes unknown, and excludes future blanks',()=>{
 const before=JSON.stringify({data,stored}),tables=attendanceTables(data,'1',options.from,options.to,stored);
 const check=inspectAttendanceExport({...options,details:tables[1][1]});
 assert.deepEqual(check.counts,{classes:1,students:2,cells:6,missing:1,review:2,evidenceMissing:1,evidenceRejected:1,evidenceUnknown:1,future:2});
 assert(check.issues.some(r=>r.name==='가상나'&&r.kind==='서류 미확인'));
 assert(!check.issues.some(r=>r.date==='2026-09-03'));
 assert.equal(JSON.stringify({data,stored}),before,'source and stored export records are unchanged');
 assert.deepEqual(attendanceTables(data,'1',options.from,options.to,stored),tables,'inspection cannot change workbook content');
});

test('period export reuses its parsed review list and saved student IDs without inventing review reasons',()=>{
 const period={dates:['2026-09-01','2026-09-02','2026-09-03'],students:[{id:'0_가상가',name:'가상가',cells:[{date:'2026-09-01',status:'인정지각'},{date:'2026-09-02',status:'인정조퇴'},{date:'2026-09-03',status:''}]},{id:'1_가상나',name:'가상나',cells:[]}],reviews:[['1','가상가','0_가상가','2026-09-01','','','','','가-3 이름 구분 확인'],['1','가상가','0_가상가','2026-09-03','','','','','출결 값 누락']]};
 const result=inspectAttendanceExport({...options,period});
 assert.equal(result.counts.review,1);assert(result.issues.some(i=>i.message==='가-3 이름 구분 확인'));
});

test('saved document status is used only for a matching source status; no colors/summary means unknown',()=>{
 const local={attendance:[['이름','','','','9/1'],['가상','','','','인정출석']]};
 const base={classId:'2',data:local,from:'2026-09-01',to:'2026-09-01',today:'2026-09-02'};
 assert.equal(inspectAttendanceExport(base).counts.evidenceUnknown,1);
 const summary={students:[{id:'0_가상',name:'가상',history:{'2026-09-01':{raw:'인정출석',evidenceStatus:'미제출'}}}]};
 assert.equal(inspectAttendanceExport({...base,stored:{summary}}).counts.evidenceMissing,1);
 summary.students[0].history['2026-09-01'].raw='출석';
 assert.equal(inspectAttendanceExport({...base,stored:{summary}}).counts.evidenceUnknown,1);
});

test('failed classes and unexamined CheckHere requests remain explicit, never zero confirmed problems',()=>{
 const check=inspectAttendanceExport(options),summary=attendanceDownloadPreflight([check],{failures:[{classId:'2',message:'연결 실패'}],label:'선택 범위'});
 assert.equal(summary.counts.classes,1);assert.equal(summary.failures.length,1);
 assert.deepEqual(summary.checkhere,{checked:false,count:null});
 assert.equal(summary.label,'선택 범위');
});
