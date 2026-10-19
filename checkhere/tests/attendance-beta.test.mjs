import test from 'node:test';import assert from 'node:assert/strict';
import {ATTENDANCE_OPTIONS,sheetStatus,EVIDENCE_COLORS,latestTeachingDate,rewriteReasons,latestSnapshots,matchSnapshot,portalStatus,evidenceStatus,hasExistingReason,isoLabel,collectionDates} from '../../attendance-beta-core.mjs';
import {runCollectionQueue} from '../bulk-collect.mjs';
test('portal distinctions map to shared sheet values and latest teaching day excludes future dates',()=>{
  for(const s of ['인정출석','인정지각','인정조퇴','인정외출'])assert.equal(sheetStatus(s),'인정출석');
  assert.equal(EVIDENCE_COLORS.미제출,EVIDENCE_COLORS.반려);assert.equal(EVIDENCE_COLORS.확인,'#ffff00');
  assert.equal(latestTeachingDate([{iso:'2026-09-10'},{iso:'2026-10-22'}],'2026-09-11').iso,'2026-09-10');
  assert.equal(portalStatus('인정출석',{portalStatus:'인정지각',sheetStatus:'인정출석'}),'인정지각');
  assert.equal(portalStatus('결석',{portalStatus:'인정지각',sheetStatus:'인정출석'}),'결석');
  assert.equal(evidenceStatus('#ff0000','인정출석',{sheetColor:'#ff0000',evidenceStatus:'미제출'},()=> '보완필요'),'미제출');
});
test('2기 dates: sheet labels resolve across the year and collection days stay inside the course without holidays',()=>{
  assert.equal(isoLabel('10/28'),'2026-10-28');assert.equal(isoLabel('1/4(월)'),'2027-01-04');assert.equal(isoLabel('2027-01-22'),'2027-01-22');assert.equal(isoLabel('12.31'),'2026-12-31');
  assert.equal(isoLabel('2025-12-01'),'','2기 연도가 아닌 ISO 날짜');assert.equal(isoLabel('이름'),'');
  assert.deepEqual(collectionDates('2026-12-24','2027-01-04','2027-01-10'),['2026-12-24','2026-12-28','2026-12-29','2026-12-30','2027-01-04'],'주말·12/25·12/31·1/1 제외');
  assert.throws(()=>collectionDates('2026-10-27','2026-10-28','2026-11-01'),/수집 기간은 10\/28부터/);
  assert.throws(()=>collectionDates('2027-01-20','2027-01-25','2027-02-01'));
  assert.throws(()=>collectionDates('2026-11-02','2026-11-05','2026-11-03'),'오늘보다 뒤는 안 됨');
});
test('reason edits preserve other students, split explicit shared reasons and reject ambiguity',()=>{
  assert.equal(hasExistingReason('가상가: 파서가 놓친 사유','가상가',''),true);
  assert.equal(hasExistingReason('가상나: 시험','가상가',''),false);
  assert.equal(hasExistingReason('가상가: ','가상가',''),false);
  assert.equal(rewriteReasons('*발생사유\n가상나: 시험',{가상가:'병원'},['가상가','가상나']),'*발생사유\n가상나: 시험\n가상가: 병원');
  assert.equal(rewriteReasons('가상가: 예전\n가상나: 시험',{가상가:'새 사유'},['가상가','가상나']),'가상가: 새 사유\n가상나: 시험');
  assert.equal(rewriteReasons('가상가, 가상나 - 병원',{가상가:'면접'},['가상가','가상나']),'가상가: 면접\n가상나: 병원');
  assert.throws(()=>rewriteReasons('가상가: 지각\n가상가: 조퇴',{가상가:'새 사유'},['가상가']));
  assert.throws(()=>rewriteReasons('가상가: 사유',{가상가:'새 사유'},['가상가','가상가']));
});
test('snapshots use collection time, scope class/date and reject same-name ambiguity',()=>{
  const r={id:'one',classId:'2',date:'2026-09-03',name:'가상가',collectedAt:'2026-09-11T01:00:00Z'};
  const rows=latestSnapshots([{...r,entry:'new'},{...r,entry:'old',collectedAt:'2026-09-10T01:00:00Z'},{...r,id:'other-class',classId:'3'}],'2','2026-09-03');assert.equal(rows.length,1);assert.equal(rows[0].entry,'new');assert(matchSnapshot({name:'가상가'},[{name:'가상가'},{name:'가상가'}],rows).error);
});
// 1기 운영총괄 시트 셀 쓰기(attendance-beta-sheet.mjs) 시험은 1기(cohort1 브랜치)에 남았습니다. 2기는 마스터시트 Apps Script로 씁니다.
test('bulk collection runs all class-days sequentially and reports missing days without dropping the rest',async()=>{
  const calls=[];let job;
  const result=await runCollectionQueue({classIds:['1','2'],dates:['2026-09-03','2026-09-04'],api:async(path,input)=>{calls.push(input);job={id:String(calls.length),status:calls.length===2?'failed':'complete',count:25,message:'fixture'};return job;},refresh:async()=>({jobs:[job]}),sleep:async()=>{}});
  assert.equal(calls.length,4);assert.deepEqual(calls[0],{classId:'1',dates:['2026-09-03']});assert.equal(result.results.filter(x=>x.status==='failed').length,1);
});
