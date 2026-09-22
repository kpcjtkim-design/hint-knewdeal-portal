import {evidenceReport} from './attendance-evidence-core.mjs';
import {eventsForClass,sourceCandidates,SURVEY_ATTENDANCE_VERSION} from './survey-core.mjs';

export const ACTIVE_REQUESTS=['pending','approved','applying'];
export const FAILED_REQUESTS=['failed','partial','unknown','conflict'];
export function safeSurveyLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['docs.google.com','forms.gle'].includes(u.hostname)?u.href:'';}catch{return '';}}
const dateList=entries=>[...new Set(entries.filter(e=>e.kind!=='holiday').map(e=>e.date))].sort();
export function summarizeClassWork(meta,bundle,{date,through=date,from='2026-07-27',catalog,config={},requests=[],requestError=''}={}){
 const classId=String(meta.id),{summary,timetable,surveys={},errors={}}=bundle||{},entries=timetable?.entries||[],notes=[],attendance=[];
 const days=dateList(entries).filter(d=>d<=date),target=days.at(-1)||(summary?.dates||[]).filter(d=>d<=date).sort().at(-1)||'';
 if(!timetable)notes.push('공개 시간표 미확인');
 if(!summary)notes.push('출결 통계 미수집');
 const covered=!!summary&&!!target&&summary.dates?.includes(target)&&summary.asOf>=target;
 if(summary&&!covered)notes.push('기준 교육일 출결 통계 갱신 필요');
 if(covered)for(const s of summary.students||[]){
  if(s.dropout&&(!s.dropoutFrom||s.dropoutFrom<=target)||s.firstDate&&s.firstDate>target)continue;
  const h=s.history?.[target];
  if(!s.firstDate)attendance.push({classId,id:s.id,name:s.name,date:target,label:'명단·출결 확인',kind:'attendance'});
  else if(!h||['','해당없음','미입력'].includes(h.status||h.raw||''))attendance.push({classId,id:s.id,name:s.name,date:target,label:'출결 입력 확인',kind:'attendance'});
  else if(h.review)attendance.push({classId,id:s.id,name:s.name,date:target,label:'출결 구분 확인',kind:'attendance'});
 }
 const evidence=evidenceReport({[classId]:summary},{from,to:through,today:date});
 if(evidence.unknown.length)notes.push(`서류 상태 미확인 ${evidence.unknown.length}건`);
 const surveyItems=[],surveyReview=[],surveyUnchecked=[];
 if(!catalog||errors.surveys||errors.config||!timetable)notes.push('만족도조사 현황 미확인');
 else for(const e of eventsForClass(catalog,classId,entries)){
  const c=config.events?.[e.id]||{},due=c.date||e.date;if(!due||due<from||due>through)continue;
  const candidates=sourceCandidates(e,catalog.responseSources||[],meta.course),source=(catalog.responseSources||[]).find(x=>x.id===c.sourceId)||(candidates.length===1?candidates[0]:null),s=surveys[e.id];
  const fingerprint=JSON.stringify(entries.filter(x=>e.lessonIds.includes(x.id)).map(x=>[x.id,x.date,x.title,x.day]));
  const stale=!s||!summary||!e.scheduleMatched&&!c.date||!source||s.syncError||s.date!==due||s.sourceId!==source.id||s.scheduleFingerprint!==fingerprint||s.attendanceFingerprint!==SURVEY_ATTENDANCE_VERSION+summary.fingerprint;
  if(stale){surveyUnchecked.push({id:e.id,title:e.title,date:due,label:s?'재동기화 필요':'아직 대조하지 않음'});continue;}
  const common={classId,date:due,title:e.title,eventId:e.id,kind:'survey',url:safeSurveyLink(c.url||e.url),syncedAt:s.syncedAt};
  for(const student of s.missing||[])surveyItems.push({...student,...common,label:`만족도조사 미응답 · ${e.title}`});
  for(const student of s.review||[])surveyReview.push({...student,...common,label:`설문 참여 확인 · ${e.title}`});
  if(s.unknown?.length||s.invalidCount)notes.push(`${e.title}: 응답 명단 확인 필요`);
 }
 if(surveyUnchecked.length)notes.push(`설문 대조 확인 ${surveyUnchecked.length}개`);
 if(surveyReview.length)notes.push(`설문 참여 구분 확인 ${surveyReview.length}건`);
 for(const [key,error]of Object.entries(errors))if(error)notes.push(({summary:'출결',timetable:'시간표',surveys:'설문',config:'설문 설정'}[key]||key)+' 읽기 실패');
 if(requestError)notes.push('체크히어 요청 조회 실패');
 const own=requests.filter(r=>String(r.classId)===classId&&r.date<=through&&r.date>=from),pending=own.filter(r=>ACTIVE_REQUESTS.includes(r.status)),failed=own.filter(r=>FAILED_REQUESTS.includes(r.status));
 return {classId,course:meta.course,target,date,through,from,syncedAt:summary?.syncedAt||'',covered,evidenceCovered:!!summary&&!errors.summary,surveyCovered:!!catalog&&!!timetable&&!errors.surveys&&!errors.config,notes:[...new Set(notes)],attendance,evidence:evidence.rows.map(r=>({...r,kind:'evidence',label:r.status==='반려'?'증빙서류 반려 · 보완 필요':'증빙서류 미제출'})),evidenceUnknown:evidence.unknown,surveyItems,surveyReview,surveyUnchecked,pending,failed,errors,requestError};
}
export function teacherHandoff(reports){
 const blocks=[];
 for(const r of reports){
  const groups=new Map();
  // Stable roster IDs keep classmates with the same name separate. No internal
  // notes, contact details or raw medical reasons enter the teacher message.
  for(const item of [...r.attendance,...r.evidence,...r.surveyItems]){
   if(!item.id)continue;const key=String(item.id);if(!groups.has(key))groups.set(key,{name:item.name,items:[]});
   const lines=groups.get(key).items,text=`${item.date} · ${item.label}${item.url?'\n  '+item.url:''}`;if(!lines.includes(text))lines.push(text);
  }
  const lines=[`[${r.classId}반 담임 전달사항]`,`기준: ${r.date} · 출결 확인 교육일: ${r.target||'미확인'}`];
  const names=new Map();for(const [id,g]of groups){if(!names.has(g.name))names.set(g.name,[]);names.get(g.name).push(id);}
  for(const [id,g]of groups)lines.push('',`${g.name}${names.get(g.name).length>1?' (동명이인 · '+(/^\d+_/.test(id)?'시트 명단 '+(Number(id.split('_')[0])+1)+'번째':'명단 확인')+')':''}`, ...g.items.map(x=>'• '+x));
  if(!groups.size)lines.push('',r.notes.length?'확정해 전달할 항목이 없습니다. 아래 확인사항을 먼저 확인해 주세요.':'저장된 자료에서 전달할 미완료 항목이 없습니다.');
  if(r.notes.length)lines.push('','관리자 확인사항: '+r.notes.join(' / '));
  lines.push('',`마지막 출결 동기화: ${r.syncedAt||'없음'}`,'저장된 결과 기준입니다. 이미 처리했다면 담당자 확인을 부탁드립니다.');blocks.push(lines.join('\n'));
 }
 return blocks.join('\n\n────────────────────\n\n');
}
