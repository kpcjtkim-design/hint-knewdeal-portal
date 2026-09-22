import {isoLabel,ATTENDANCE_OPTIONS,sheetStatus,koreaToday} from './attendance-beta-core.mjs';
import {parseAttendanceReasons} from './attendance-reason-parser.mjs';
export const UNIT_PERIODS=[{id:'1',from:'2026-07-27',to:'2026-08-26'},{id:'2',from:'2026-08-27',to:'2026-09-26'},{id:'3',from:'2026-09-27',to:'2026-10-22'}];
export const REVIEW_HEADERS=['반','학생명','학생 ID','날짜','운영총괄 출결','DB 출결','적용 출결','가-3 사유','확인 사유','관련 DB 근거','처리 상태'];
export function periodClassId(name){const m=String(name).trim().match(/^(?:제\s*)?0*(\d{1,2})(?:\s*반|\s*[._-])/);return m&&+m[1]>=1&&+m[1]<=17?String(+m[1]):'';}
export function normalizePeriodReason(value){
 const s=String(value||'').trim();if(!s)return '개인사정';
 if(/^(?:병원(?:\s*(?:방문|진료|내원|치료|예약))?|진료)$/.test(s))return'병원';
 if(/^(?:(?:기업|취업|회사|1차|최종)\s*)?면접$/.test(s))return'면접';
 if(/^(?:(?:AI|온라인)\s*)?인적성(?:\s*검사)?$/i.test(s))return'인적성';
 if(/^(?:취업박람회|채용박람회|잡페어|job\s*fair)$/i.test(s))return'취업박람회';
 if(/^예비군(?:\s*훈련)?$/.test(s))return'예비군';
 return s;
}
// Only actual persisted fields are used. Metadata is the administrator's explicit
// selection; summary is automatic and is usable only with matching source status.
export function resolvePeriodStatus(raw,meta,history){
 const issues=[];let status=raw,basis='운영총괄',dbStatus='';
 if(meta&&ATTENDANCE_OPTIONS.includes(meta.portalStatus)&&sheetStatus(meta.portalStatus)===meta.sheetStatus){
  status=meta.portalStatus;basis='관리자 저장 구분';dbStatus=status;
  if(meta.sheetStatus!==raw)issues.push('운영총괄과 관리자 저장 출결 불일치');
 }else if(history){
  dbStatus=history.status||'';
  if(history.raw===raw&&!history.review&&ATTENDANCE_OPTIONS.includes(history.status)){status=history.status;basis='DB 출결 통계 · '+(history.basis||'');}
  else issues.push(history.raw!==raw?'운영총괄과 DB 통계 기준 불일치':'DB 최종 구분 확인 필요');
 }
 if(status==='인정출석'&&!(history?.raw===raw&&!history.review&&history.basis==='시트 인정 · 입퇴실 없음')&&!(meta?.portalStatus==='인정출석'&&meta.sheetStatus==='인정출석'))issues.push('인정출석 세부유형 확인 필요 - DB에 세부 판정 없음');
 if(!raw)issues.push('출결 값 누락');
 if(status&&!ATTENDANCE_OPTIONS.includes(status)&&!status.startsWith('중복'))issues.push('지원 출결 구분 확인 필요');
 return {status,basis,dbStatus,issues};
}
export function preparePeriod({classId,data,stored,from,to,entries=[],uploaded=false}){
 if(!/^2026-\d{2}-\d{2}$/.test(from)||!/^2026-\d{2}-\d{2}$/.test(to)||from>to)throw Error('기간을 확인해 주세요.');
 const a=data.attendance;if(!Array.isArray(a)||!Array.isArray(a[0]))throw Error('출결 원본을 읽지 못했습니다.');
 const holidays=new Set(entries.filter(e=>e.kind==='holiday').map(e=>e.date)),dates=a[0].map((v,col)=>({date:isoLabel(v),col})).filter(d=>d.col>=4&&d.date>=from&&d.date<=to&&!holidays.has(d.date)&&![0,6].includes(new Date(d.date+'T12:00:00Z').getUTCDay())).sort((a,b)=>a.date.localeCompare(b.date));
 if(!dates.length)throw Error('선택 기간의 교육일 열이 없습니다.');
 if(new Set(dates.map(d=>d.date)).size!==dates.length)throw Error('교육일이 중복되어 생성할 수 없습니다.');
 const roster=a.slice(1).map((row,i)=>({name:String(row[0]||'').trim(),id:`${i}_${String(row[0]||'').trim()}`,row})).filter(s=>s.name);
 if(!roster.length)throw Error('학생 명단이 없습니다.');
 if(!Array.isArray(data.reasons)||!Array.isArray(data.reasons[0])||!Array.isArray(data.reasons[1]))throw Error('가-3 원문을 읽지 못했습니다. 사유 없음으로 처리하지 않습니다.');
 const reasons=new Map();(data.reasons[0]).forEach((v,i)=>{const date=isoLabel(v);if(i>=4&&date){if(reasons.has(date))throw Error('가-3 교육일이 중복되었습니다.');reasons.set(date,String(data.reasons[1]?.[i]??''));}});
 if(dates.some(d=>!reasons.has(d.date)))throw Error('일부 교육일의 가-3 날짜 열이 없습니다.');
 const parsedReasons=new Map(dates.map(d=>[d.date,parseAttendanceReasons(reasons.get(d.date),roster.map(s=>s.name))]));
 const reviews=[],stats={students:roster.length,days:dates.length,cells:0,recognizedLate:0,recognizedEarly:0,recognizedOuting:0,personal:0,dropout:0},summary=stored.summary,metadata=stored.metadata||{};
 const students=roster.map(s=>{
  const duplicate=roster.filter(x=>x.name===s.name).length>1;
  const byName=(summary?.students||[]).filter(x=>x.name===s.name),saved=uploaded?(byName.length===1?byName[0]:null):(summary?.students||[]).find(x=>x.id===s.id&&x.name===s.name),id=saved?.id||s.id;
  const add=(date,raw,db,status,reason,message,basis='')=>reviews.push([String(classId),s.name,id,date,raw,db,status,reason,message,basis,'미확인']);
  const cells=dates.map(d=>{
   const raw=String(s.row[d.col]??'').trim(),meta=uploaded&&!saved?null:metadata[d.date]?.[id],history=saved?.history?.[d.date];
   const resolved=resolvePeriodStatus(raw,duplicate&&uploaded?null:meta,duplicate&&uploaded?null:history),src=reasons.get(d.date)||'';
   const parsed=parsedReasons.get(d.date),reasonIssues=parsed.issues.filter(i=>i.name===s.name),ambiguous=reasonIssues.length>0,reason=[...new Set((parsed.byName[s.name]||[]).map(e=>e.reason).filter(Boolean))].join('; ');
   for(const issue of reasonIssues)add(d.date,raw,resolved.dbStatus,resolved.status,'','가-3 '+issue.message);
   if(duplicate&&uploaded)add(d.date,raw,'',resolved.status,reason,'동명이인 DB 식별 필요');
   for(const message of resolved.issues)add(d.date,raw,resolved.dbStatus,resolved.status,reason,message,resolved.basis);
   const abnormal=resolved.status&&resolved.status!=='출석'&&resolved.status!=='해당없음';
   if(abnormal&&!reason&&!ambiguous)stats.personal++;
   if(resolved.status==='인정지각')stats.recognizedLate++;if(resolved.status==='인정조퇴')stats.recognizedEarly++;if(resolved.status==='인정외출')stats.recognizedOuting++;stats.cells++;
   const entries=(parsed.byName[s.name]||[]).map(e=>({...e,status:({'인정결석':'인정출석','출석인정':'인정출석','무단결석':'결석'})[e.status]||e.status})),events=!ambiguous&&new Set(entries.map(e=>e.status).filter(Boolean)).size>1?entries.filter(e=>ATTENDANCE_OPTIONS.includes(e.status)&&e.status!=='출석'&&e.status!=='해당없음').map(e=>({status:e.status,reason:normalizePeriodReason(e.reason)})):[];
   if(events.length>1)add(d.date,raw,resolved.dbStatus,resolved.status,reason,'가-3 복수 출결 사건 - 최종 일 출결 대조 필요',resolved.basis);
   return {date:d.date,raw,...resolved,reason:ambiguous?'사유 확인 필요':normalizePeriodReason(reason),abnormal,events};
  });
  // The existing dropout field is automatic, not an administrator's final status.
  // Confirm its trailing sequence against all currently available source dates.
  let trainingStatus='훈련중';
  if(saved?.dropout){const after=a[0].map((v,col)=>({date:isoLabel(v),col})).filter(d=>d.col>=4&&d.date>=saved.dropoutFrom&&d.date<=koreaToday()&&!holidays.has(d.date)&&![0,6].includes(new Date(d.date+'T12:00:00Z').getUTCDay()));const entered=after.filter(d=>String(s.row[d.col]||'').trim()!=='');
   if(saved.dropoutFrom<=to&&entered.length>=2&&entered.every(d=>s.row[d.col]==='해당없음')){trainingStatus='중도포기';stats.dropout++;}
   else if(saved.dropoutFrom<=to)add('', '', '', '', '', '중도포기 여부 확인 필요 - 후속 기록 불일치');
  }
  return {id,name:s.name,trainingStatus,cells,remarks:cells.filter(c=>c.abnormal||c.events.length>1).flatMap(c=>(c.events.length>1?c.events:[c]).map(e=>`${Number(c.date.slice(5,7))}/${Number(c.date.slice(8))}(${e.status}-${e.reason})`)).join('\n')};
 });
 if(new Set(students.map(s=>s.id)).size!==students.length)throw Error('학생 ID가 중복되어 생성할 수 없습니다.');
 if(stats.cells!==stats.students*stats.days)throw Error('학생·교육일 건수 검증에 실패했습니다.');
 return {classId:String(classId),from,to,dates:dates.map(d=>d.date),students,reviews,stats,reasons:dates.map(d=>[d.date,reasons.get(d.date)||''])};
}
