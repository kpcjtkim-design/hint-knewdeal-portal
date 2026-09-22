import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeClassWork,teacherHandoff,safeSurveyLink} from '../../operations-work-core.mjs';
import {SURVEY_ATTENDANCE_VERSION} from '../../survey-core.mjs';
const date='2026-09-22',meta={id:'1',course:'임베디드 AI(HW)'},entries=[{id:'l1',date,title:'SW 테스팅',day:2,module:'직무특화'}],catalog={events:[{id:'e1',classId:'1',title:'SW 테스팅',date,url:'https://forms.gle/example'}],responseSources:[{id:'source1',title:'임베디드 AI-HW(SW 테스팅)'}]};
const configuration={events:{e1:{sourceId:'source1'}}};
function fixture(){return {summary:{asOf:date,dates:[date],fingerprint:'v1',syncedAt:'2026-09-22T01:00:00Z',students:[{id:'0_학생',name:'학생',firstDate:'2026-07-27',history:{[date]:{raw:'해당없음',status:'해당없음'}}}]},timetable:{entries:structuredClone(entries)},surveys:{e1:{date,sourceId:'source1',attendanceFingerprint:SURVEY_ATTENDANCE_VERSION+'v1',scheduleFingerprint:JSON.stringify(entries.map(e=>[e.id,e.date,e.title,e.day])),missing:[{id:'0_학생',name:'학생'}],review:[]}}};}
const options={date,catalog,config:configuration};
test('same-day and period work uses saved evidence and survey identity, excluding pre-entry and withdrawn students',()=>{
 const f=fixture();f.summary.students.push({id:'1_입학전',name:'입학전',firstDate:'2026-09-23',history:{}},{id:'2_포기',name:'포기',firstDate:'2026-07-27',dropout:true,dropoutFrom:'2026-09-20',history:{}},{id:'3_증빙',name:'증빙',firstDate:'2026-07-27',history:{[date]:{raw:'인정출석',status:'인정지각',evidenceStatus:'반려'}}});
 const r=summarizeClassWork(meta,f,options);assert.deepEqual(r.attendance.map(x=>x.name),['학생']);assert.equal(r.evidence.length,1);assert.equal(r.evidence[0].status,'반려');assert.equal(r.surveyItems.length,1);assert.equal(r.surveyUnchecked.length,0);
});
test('failed, absent or stale data is not reported as a completed empty class',()=>{
 const r=summarizeClassWork(meta,{errors:{summary:'permission denied',surveys:'unavailable'}},options);assert.equal(r.covered,false);assert(r.notes.includes('출결 통계 미수집'));assert(r.notes.includes('설문 읽기 실패'));assert.match(teacherHandoff([r]),/먼저 확인/);
 for(const change of [f=>f.surveys.e1.attendanceFingerprint='old',f=>f.surveys.e1.scheduleFingerprint='old',f=>f.surveys.e1.syncError='quota',f=>f.surveys.e1.date='2026-09-21',f=>f.summary.fingerprint='v2']){const f=fixture();change(f);const out=summarizeClassWork(meta,f,options);assert.equal(out.surveyItems.length,0);assert.equal(out.surveyUnchecked.length,1);}
 const f=fixture();f.summary.asOf='2026-09-21';const out=summarizeClassWork(meta,f,options);assert.equal(out.attendance.length,0);assert(out.notes.some(n=>n.includes('기준 교육일')));
});
test('period end filters backlog without changing attendance target, holiday uses latest scheduled day',()=>{
 const f=fixture();const r=summarizeClassWork(meta,f,{...options,from:'2026-07-27',through:'2026-08-26'});assert.equal(r.target,date);assert.equal(r.attendance.length,1);assert.equal(r.surveyItems.length,0);
 f.timetable.entries.push({id:'h',kind:'holiday',date:'2026-09-23'});assert.equal(summarizeClassWork(meta,f,{...options,date:'2026-09-23'}).target,date);
});
test('handoff keeps same-named classmates distinct and contains no internal notes or contact fields',()=>{
 const f=fixture();f.summary.students.push({id:'1_학생',name:'학생',firstDate:'2026-07-27',history:{[date]:{status:'해당없음'}}});f.summary.students[0].email='secret@example.com';f.summary.students[0].phone='010-1234-5678';f.summary.students[0].memo='비공개 질병';
 const r=summarizeClassWork(meta,f,{...options,requests:[{id:'q',classId:'1',date,status:'failed',name:'승인업무학생',reason:'관리자만 확인'}]});const text=teacherHandoff([r]);assert.match(text,/학생 \(동명이인 · 시트 명단 1번째\)/);assert.match(text,/학생 \(동명이인 · 시트 명단 2번째\)/);assert.match(text,/만족도조사 미응답/);assert(!/secret@|010-|질병|승인업무학생|관리자만/.test(text));assert.equal(r.failed.length,1);
 assert.equal(safeSurveyLink('javascript:alert(1)'), '');assert.equal(safeSurveyLink('https://evil.test/'),'');
});
