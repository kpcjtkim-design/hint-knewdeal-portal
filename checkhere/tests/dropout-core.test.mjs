import test from 'node:test';import assert from 'node:assert/strict';
import {parseSheetDate,readDropoutRows,classTabs,classAttendance,evaluateDropout,evaluateAll,locateStudent,verdictLabel} from '../../dropout-core.mjs';
// 운영총괄 M18:ZZ48 형태: 첫 행 [이름,출석률,출석일수,지조외,날짜...]
function sheet(dates,students){return [['','출석률','출석일수','지/조/외/중복',...dates],...students.map(([name,values])=>[name,'','','',...values])];}
const DAYS=['7/27','7/28','7/29','7/30','7/31','8/3','8/4','8/5','8/6','8/7','8/10','8/11','8/12','8/13','8/14','8/18','8/19','8/20','8/21','8/24','8/25','8/26','8/27','8/28','8/31','9/1','9/2','9/3','9/4','9/7','9/8','9/9','9/10','9/11','9/14','9/15','9/16','9/17','9/18','9/21','9/22','9/23','9/28','9/29','9/30','10/1','10/2','10/6','10/7','10/8','10/12','10/13','10/14','10/15','10/16','10/19','10/20','10/21','10/22'];
const row=(fill,overrides={})=>DAYS.map(d=>overrides[d]??fill(d));
const iso=d=>{const [m,day]=d.split('/');return `2026-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;};
const upTo=(last,after='해당없음')=>d=>iso(d)<=iso(last)?'출석':after;
const entry=(o)=>({no:'1',name:'가',reason:'기업 합격',startText:'9/1 출근',lastText:'8/31까지 출석',sheetNote:'',classId:'1',...o});

test('free-text dates: 까지/출근/포기일 preference, missing dates',()=>{
 assert.equal(parseSheetDate('8/7까지 출석'),'2026-08-07');assert.equal(parseSheetDate('10/1 출근예정'),'2026-10-01');
 assert.equal(parseSheetDate('8/18까지 출석\n8/24-8/27 인정출석(예비군) 예정\n=>8/31 포기일 예정',{prefer:'포기일'}),'2026-08-31');
 assert.equal(parseSheetDate('10월 중 (입사일정 미정)'),'');assert.equal(parseSheetDate('글 남길 예정'),'');assert.equal(parseSheetDate('-'),'');
});
test('sheet rows use headers and Q column class; roster tabs exclude copies',()=>{
 const rows=readDropoutRows([['순번','순번','연락처','반배정','포기사유','근로개시일','포기일(마지막수강일)','결석일수\n(수료가능여부)'],['1','가','','반','사유','9/1 출근','8/7까지 출석','제적','','','','','','','','','4반'],['2','','','','','','']]);
 assert.equal(rows.length,1);assert.equal(rows[0].classId,'4');assert.equal(rows[0].sheetNote,'제적');
 assert.throws(()=>readDropoutRows([['a','b','c']]),/머리글/);
 assert.deepEqual(classTabs(['운영총괄(1기) 대시보드','1. 수도권_임베디드 AI(HW)','1. 수도권_임베디드 AI(HW)_2 단위기간','5. 충청_제조지능화(2)','5. 충청_제조지능화(2)_테스트','시트수정중_1. 수도권_임베디드 AI(HW)의 사본']),{'1':'1. 수도권_임베디드 AI(HW)','5':'5. 충청_제조지능화(2)'});
 assert.throws(()=>classTabs(['3. a','3. b']),/2개/);
});
test('before-start days without attendance are absences; days from start count as attendance',()=>{
 const a=classAttendance(sheet(DAYS,[['가',row(upTo('8/7'))]])),s=a.students[0];
 const r=evaluateDropout(entry({lastText:'8/7까지 출석',startText:'9/1 출근'}),{dates:a.dates,row:s.row},'2026-09-29');
 assert.equal(r.requiredUntil,'2026-08-31');assert.equal(r.preStartAbsence,15);
 assert.equal(r.periods[0].total,12);assert.equal(r.periods[1].total,3);assert.equal(r.periods[2].total,0);
 assert.equal(r.verdict,'제적');assert.match(r.basis,/1단위기간.*절반/);assert.match(r.basis,/전체 무단결석 15일/);
});
test('unexcused late/early/outing: 3 per unit period = 1 absence; 중복 counts twice; 인정출석 is attendance',()=>{
 const a=classAttendance(sheet(DAYS,[['가',row(upTo('8/31'),{'7/27':'지각','7/28':'조퇴','7/29':'외출','7/30':'지각','7/31':'인정출석','8/27':'중복(지각+외출, 지각+조퇴, 외출+조퇴)','8/28':'결석'})]]));
 const r=evaluateDropout(entry(),{dates:a.dates,row:a.students[0].row},'2026-09-29');
 assert.deepEqual(r.periods.map(p=>[p.absent,p.partial,p.converted,p.total]),[[0,4,1,1],[1,2,0,1],[0,0,0,0]]);
 assert.equal(r.totalAbsence,2);assert.equal(r.verdict,'수료가능');assert.equal(verdictLabel(r),'수료가능');
});
test('unit period needs absences under half; total unexcused must not exceed 11',()=>{
 const absentFrom=(from,to)=>d=>iso(d)>=iso(from)&&iso(d)<=iso(to)?'결석':'출석';
 // 1단위기간 22일 중 11일 결석 → 절반 이상 → 제적
 let a=classAttendance(sheet(DAYS,[['가',row(absentFrom('7/27','8/10'))]]));
 let r=evaluateDropout(entry({startText:'10/23 출근',lastText:'10/22까지 출석'}),{dates:a.dates,row:a.students[0].row},'2026-10-23');
 assert.equal(r.periods[0].total,11);assert.equal(r.verdict,'제적');
 // 10일 결석 → 기간 조건은 통과, 전체 10일 → 수료가능
 a=classAttendance(sheet(DAYS,[['가',row(absentFrom('7/27','8/7'))]]));
 r=evaluateDropout(entry({startText:'10/23 출근',lastText:'10/22까지 출석'}),{dates:a.dates,row:a.students[0].row},'2026-10-23');
 assert.equal(r.totalAbsence,10);assert.equal(r.verdict,'수료가능');
 // 기간별로는 통과해도 합계 12일 → 제적
 a=classAttendance(sheet(DAYS,[['가',row(d=>['7/27','7/28','7/29','7/30','8/27','8/28','8/31','9/1','9/28','9/29','9/30','10/1'].includes(d)?'결석':'출석')]]));
 r=evaluateDropout(entry({startText:'10/23 출근',lastText:'10/22까지 출석'}),{dates:a.dates,row:a.students[0].row},'2026-10-23');
 assert.ok(r.periods.every(p=>p.ok));assert.equal(r.totalAbsence,12);assert.equal(r.verdict,'제적');
});
test('future last day is 예정 and unfilled days up to it are planned attendance; sheet data wins before start',()=>{
 const a=classAttendance(sheet(DAYS,[['가',row(d=>iso(d)<='2026-09-29'?'출석':'',{'9/28':'인정출석'})]]));
 const r=evaluateDropout(entry({startText:'10/6 출근',lastText:'10/1까지 출석예정'}),{dates:a.dates,row:a.students[0].row},'2026-09-29');
 assert.equal(r.scheduled,true);assert.equal(r.requiredUntil,'2026-10-02');assert.equal(r.preStartAbsence,1);
 assert.equal(r.days.find(d=>d.date==='2026-09-30').basis,'포기일 전 출석 예정');
 assert.equal(r.days.find(d=>d.date==='2026-10-02').status,'결석');assert.equal(verdictLabel(r),'예정 · 수료가능');
 assert.deepEqual(r.issues,[]);
});
test('personal-reason dropouts are 제적; missing dates need checking',()=>{
 assert.equal(evaluateDropout(entry({reason:'개인사정 포기',startText:'-'}),null,'2026-09-29').verdict,'제적');
 const noStart=evaluateDropout(entry({reason:'기업 합격',startText:'-'}),null,'2026-09-29');assert.equal(noStart.verdict,'확인필요');
 const unknown=evaluateDropout(entry({startText:'10월 중 (입사일정 미정)'}),null,'2026-09-29');assert.equal(unknown.verdict,'확인필요');assert.match(unknown.issues.join(),/근로개시일/);
});
test('student is matched only within the Q-column class unless it is blank',()=>{
 const classes={'6':classAttendance(sheet(DAYS,[['나',row(()=> '출석')]])),'14':classAttendance(sheet(DAYS,[['가',row(()=> '출석')]]))};
 assert.match(locateStudent({name:'가',classId:'6'},classes).issue,/6반.*찾지 못했습니다/);
 assert.equal(locateStudent({name:'가',classId:''},classes).hit.classId,'14');
 const [r]=evaluateAll([entry({classId:'6'})],classes,'2026-09-29');assert.equal(r.verdict,'확인필요');assert.match(r.issues[0],/6반/);
});
