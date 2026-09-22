import {recognized,koreaToday} from './attendance-beta-core.mjs';
export const EVIDENCE_PERIODS=[
 {id:'all',label:'전체 기간',from:'2026-07-27',to:'2026-10-22'},
 {id:'1',label:'1단위 · 7/27~8/26',from:'2026-07-27',to:'2026-08-26'},
 {id:'2',label:'2단위 · 8/27~9/26',from:'2026-08-27',to:'2026-09-26'},
 {id:'3',label:'3단위 · 9/27~10/22',from:'2026-09-27',to:'2026-10-22'}
];
export function evidenceReport(summaries,{from='2026-07-27',to=koreaToday(),status='outstanding',today=koreaToday()}={}){
 const rows=[],unknown=[],missing=[];
 for(const [cid,summary] of Object.entries(summaries)){
  if(!summary){missing.push(cid);continue;}
  for(const student of summary.students||[])for(const [date,h]of Object.entries(student.history||{})){
   if(date<from||date>to||date>today||!recognized(h.raw)&&!recognized(h.status))continue;
   const item={classId:cid,id:student.id,name:student.name,date,attendance:h.status||h.raw,status:h.evidenceStatus};
   if(!['미해당','미제출','반려','확인'].includes(h.evidenceStatus)){unknown.push({...item,status:'미확인'});continue;}
   if(['미제출','반려'].includes(h.evidenceStatus)&&(status==='outstanding'||status===h.evidenceStatus))rows.push(item);
  }
 }
 const sort=(a,b)=>Number(a.classId)-Number(b.classId)||String(a.name).localeCompare(String(b.name),'ko')||a.date.localeCompare(b.date);
 rows.sort(sort);unknown.sort(sort);
 return {rows,unknown,missing,students:new Set(rows.map(r=>r.classId+':'+r.id)).size};
}
export function evidenceMessage(report,{from,to}){
 const lines=[`출결 증빙서류 제출·보완 요청 (${from} ~ ${to})`];let cid='';
 for(const r of report.rows){if(cid!==r.classId){cid=r.classId;lines.push('',`[${cid}반]`);}lines.push(`${r.name} · ${r.date} · ${r.attendance} · ${r.status==='반려'?'반려 · 보완 필요':'미제출'}`);}
 if(!report.rows.length)lines.push('조회된 제출·보완 대상이 없습니다.');
 lines.push('','마지막 출결 동기화 기준입니다. 이미 제출했다면 담당자 확인을 부탁드립니다.');
 if(report.unknown.length||report.missing.length)lines.push(`별도 확인 필요: 서류 상태 미확인 ${report.unknown.length}건 / 미수집 ${report.missing.length}개 반 (위 요청 명단에 포함하지 않음)`);
 return lines.join('\n');
}
