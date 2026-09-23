import {isoLabel,portalStatus,matchSnapshot,latestSnapshots,koreaToday,evidenceStatus,overviewColorState} from './attendance-beta-core.mjs';
import {RULES,seconds} from './checkhere/rules.mjs';
import {hasHospitalRecognition} from './disease-recognition-core.mjs';
import {surveyBaseName} from './survey-identity.mjs';
export const DERIVED_VERSION='20260923-disease1';
export const PARTICIPATED=new Set(['출석','지각','조퇴','외출','인정지각','인정조퇴','인정외출']);
const recognized=new Set(['인정출석','인정지각','인정조퇴','인정외출']);
const validStatus=new Set([...PARTICIPATED,'인정출석','결석','중복']);
export function deriveRecognized(raw,meta={},record=null,{excursion=false}={}){
 const manual=portalStatus(raw,meta);
 if(raw!=='인정출석'){const status=manual.startsWith('중복')?'중복':manual;return {status,review:status==='중복'||(!validStatus.has(status)&&status!=='해당없음'),basis:'시트'};}
 if(meta.sheetStatus===raw&&recognized.has(meta.portalStatus))return {status:manual,review:false,basis:'관리자 구분'};
 const review=basis=>({status:'인정출석',review:true,basis});
 if(!record||record.readState!=='complete')return review('체크히어 상세 저장본 필요');
 if(excursion||record.exception)return review('견학일 · 시간 기준 별도 확인');
 if(record.schedule&&record.schedule!==`${RULES.start} ~ ${RULES.end}`)return review('강의시간 기준 확인');
 try{
  const entry=seconds(Object.hasOwn(record,'rawEntry')?record.rawEntry:record.entry),exit=seconds(record.exit),trips=record.outings||[];
  if(trips.length||record.outingCount>0){
   if(trips.length!==Number(record.outingCount??trips.length)||trips.some(t=>seconds(t.start)===null||seconds(t.end)===null||seconds(t.end)<=seconds(t.start)))return review('외출 구간 확인 필요');
   return {status:'인정외출',review:false,basis:'체크히어 외출 구간',sourceVersion:record.version||record.collectedAt||''};
  }
  if(entry===null&&exit===null)return {status:'인정출석',review:false,basis:'시트 인정 · 입퇴실 없음'};
  if(entry===null||exit===null||exit<entry)return review('입퇴실 기록 불완전');
  const threshold=seconds(RULES.start)+RULES.entryGrace*60;
  if(entry>threshold&&entry<threshold+60)return review('09:10 초 단위 경계 확인');
  const late=entry>=threshold+60,early=exit<seconds(RULES.end)-RULES.exitGrace*60;
  if(late&&early)return review('인정지각·조퇴 중복 확인');
  return {status:late?'인정지각':early?'인정조퇴':'인정출석',review:false,basis:late?'체크히어 입실시간':early?'체크히어 퇴실시간':'시트 인정 · 정상 시간',sourceVersion:record.version||record.collectedAt||''};
 }catch{return review('시간 형식 확인 필요');}
}
export function deriveAttendanceClass(data,{classId,metadata={},records=[],entries=[],identities=[],today=koreaToday()}={}){
 const a=data.attendance||[],holidayDates=new Set(entries.filter(e=>e.kind==='holiday').map(e=>e.date));
 const dates=(a[0]||[]).map((v,i)=>({date:isoLabel(v),col:i})).filter(x=>x.col>=4&&x.date&&x.date<=today&&x.date>='2026-07-27'&&!holidayDates.has(x.date)&&![0,6].includes(new Date(x.date+'T12:00:00Z').getUTCDay())).sort((x,y)=>x.date.localeCompare(y.date));
 if(!dates.length||new Set(dates.map(x=>x.date)).size!==dates.length)throw Error('교육일 열을 확인하지 못했습니다. 기존 통계를 유지합니다.');
 const backgrounds=data.attendanceBackgrounds||data.backgrounds||[];
 const roster=a.slice(1).map((row,i)=>({rowIndex:i,id:`${i}_${String(row[0]||'').trim()}`,name:String(row[0]||'').trim(),row})).filter(s=>s.name);
 const recordDays=new Map(dates.map(d=>[d.date,latestSnapshots(records,classId,d.date)]));
 const latest=dates.at(-1),evaluation=dates.findLast(d=>roster.some(s=>validStatus.has(String(s.row[d.col]||'').trim()))),latestEntered=evaluation?.date===latest.date;
 const students=roster.map(s=>{
  const history={},diseaseDates=[],diseaseReviewDates=[];for(const d of dates){const raw=String(s.row[d.col]||'').trim(),dayRecords=recordDays.get(d.date),record=matchSnapshot(s,roster,dayRecords,identities).record,excursion=entries.some(e=>e.date===d.date&&/공장견학|분해조립|실차체험/.test(e.module+' '+e.title));
   if(hasHospitalRecognition(record))diseaseDates.push(d.date);
   else if(!record&&dayRecords.some(r=>surveyBaseName(r.name)===surveyBaseName(s.name)&&hasHospitalRecognition(r)))diseaseReviewDates.push(d.date);
   const meta=metadata[d.date]?.[s.id],derived=deriveRecognized(raw,meta,record,{excursion}),color=backgrounds[s.rowIndex+1]?.[d.col];
   history[d.date]={raw,...derived,...(recognized.has(raw)||recognized.has(derived.status)?{evidenceStatus:typeof color==='string'&&color.trim()?evidenceStatus(color,raw,meta,overviewColorState):'미확인'}:{})};
  }
  const first=dates.find(d=>validStatus.has(history[d.date].raw))?.date||'';
  let trailing=[];for(let i=dates.findIndex(d=>d.date===evaluation?.date);i>=0;i--){if(history[dates[i].date].raw!=='해당없음')break;trailing.unshift(dates[i].date);}
  const dropout=Boolean(evaluation&&first&&trailing.length>=2&&first<trailing[0]);
  return {id:s.id,name:s.name,firstDate:first,dropout,dropoutFrom:dropout?trailing[0]:'',dropoutDays:dropout?trailing.length:0,diseaseDates,diseaseReviewDates,history};
 });
 return {classId:String(classId),version:DERIVED_VERSION,asOf:today,latestDate:latest.date,latestEntered,dates:dates.map(d=>d.date),students};
}
export function targetsFromDerived(derived,dateOrDates){
 const dates=[...new Set(Array.isArray(dateOrDates)?dateOrDates:[dateOrDates])].sort();
 if(!dates.length||dates.some(d=>!derived?.dates?.includes(d)))throw Error('강의 전체 교육일의 출결 통계가 없습니다. 교육일 연결을 확인해 주세요.');
 return derived.students.map(s=>{
  const days=dates.map(date=>({date,...s.history[date]})),present=days.find(h=>!h.review&&PARTICIPATED.has(h.status));
  const excluded=days.every(h=>!h.review&&['결석','인정출석'].includes(h.status));
  return {id:s.id,name:s.name,status:s.dropout?'중도포기':present?.status||days.at(-1).status,
   eligible:!s.dropout&&!!present,review:!s.dropout&&!present&&!excluded,
   basis:s.dropout?`연속 해당없음 ${s.dropoutDays}일`:present?`${present.date} 참여 · 강의 ${dates.length}개 교육일 대조`:excluded?'강의 모든 교육일 결석·종일 인정':'강의 기간 출결 확인 필요'};
 });
}
export function attendanceStatistics(derived,{from='',to=derived?.latestDate||'',name=''}={}){
 const dates=(derived?.dates||[]).filter(d=>(!from||d>=from)&&d<=to),counts={},daily=dates.map(date=>({date,counts:{}}));
 const students=(derived?.students||[]).filter(s=>!name||s.name.includes(name)).map(s=>{
  const c={};let reviewed=0;for(const [i,d]of dates.entries()){const h=s.history[d];if(d<s.firstDate||!s.firstDate)continue;const status=s.dropout&&d>=s.dropoutFrom?'중도포기':h.status;counts[status]=(counts[status]||0)+1;daily[i].counts[status]=(daily[i].counts[status]||0)+1;c[status]=(c[status]||0)+1;if(h.review)reviewed++;}
  const present=[...PARTICIPATED].reduce((n,k)=>n+(c[k]||0),0),total=present+(c['인정출석']||0)+(c['결석']||0);
  return {...s,counts:c,reviewed,present,total,rate:total?present/total*100:null};
 });
 const present=[...PARTICIPATED].reduce((n,k)=>n+(counts[k]||0),0),total=present+(counts['인정출석']||0)+(counts['결석']||0);
 return {dates,counts,daily,students,present,total,rate:total?present/total*100:null,dropouts:students.filter(s=>s.dropout).length};
}
