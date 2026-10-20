import {ADMINS,REAL_CLASSES as CLASSES,COHORT,isClassId as anyClassId,isTestClass} from './cohort.mjs';
// 설문은 공식 반만 봅니다(17반 시험용 테스트반은 설문 대상이 아님).
const isClassId=id=>anyClassId(id)&&!isTestClass(id);
const HOLIDAY_NAMES=COHORT.holidays.map(h=>h.name);
import {createSurveyIdentityMatcher,surveyBaseName} from './survey-identity.mjs';
import {isoLabel,portalStatus} from './attendance-beta-core.mjs';
// 2기: 반·과정·휴일·운영 대표 계정은 cohort.mjs. 설문 폼의 반 선택지는 2기 폼이 나오면 실제 글로 다시 확인합니다.
export const SURVEY_OWNER=ADMINS[0];
export const SURVEY_COLLECTION='surveyBetaSummaries';
export const SURVEY_ATTENDANCE_VERSION='all-lesson-days-v2:';
export function surveyAttendanceDates(event,entries,fallbackDate){
 const dates=[...new Set(entries.filter(e=>e.kind!=='holiday'&&event.lessonIds?.includes(e.id)).map(e=>e.date))].sort();
 return dates.length?dates:[fallbackDate];
}
export const normalizeName=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').trim();
// 2기 반 선택지 후보: 반 이름('서울(관악구)_모빌리티 AI_서울대'), 공식 과정명, '장소_과정'. 2기 설문 폼 글이 정해지면 그 글을 cohort.json에 더합니다.
const classChoiceKey=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const classChoiceIds=new Map(CLASSES.flatMap(c=>[c.name,c.official,`${c.venue}_${c.course}`].map(v=>[classChoiceKey(v),c.id])));
export const classNumber=v=>{const m=String(v||'').trim().match(/^(?:제\s*)?(\d{1,2})\s*(?:반|[.\-_]|$)/);return m&&isClassId(String(+m[1]))?String(+m[1]):classChoiceIds.get(classChoiceKey(v))||'';};
export function lessonToken(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/직무특화|\[실습\]|\(고정\)|\(sw\)|\(hw\)|sw전공자대상|hw전공자대상/g,'').replace(/임베디드시스템의이해/g,'임베디드시스템이해').replace(/[\s_\-+·/,()[\]]/g,'').replace('임베디드시스템의이해','임베디드시스템이해').replace('딥러닝기반영상인식','딥러닝기반영상인식').replace('임베디드리눅스시스템','임베디드리눅스').replace(/(?:sw|hw)(?:전공자대상)?$/g,'').replace('건정성','건전성').replace('제조장비건전성관리시스템설계실습','장비건전성관리시스템설계실습');}
function keyTitle(v){const t=lessonToken(v);if(t.startsWith('현직자특강'))return '현직자특강';if(/분해조립/.test(t))return '분해조립';if(/공장.*견학|견학.*공장|공장견학생산공정이론교육/.test(t))return '공장견학';return t;}
export function eventLessons(event,entries){
 const t=keyTitle(event.title),mot=/동기부여\s*-?\s*(\d+)/.exec(event.title);
 return entries.filter(e=>e.kind!=='holiday'&&(mot?e.module==='동기부여'&&e.day===+mot[1]:keyTitle(e.title)===t||t==='ai기반제조데이터분석입문'&&keyTitle(e.title).startsWith(t)||t==='제조장비건전성관리입문'&&keyTitle(e.title).startsWith(t)));
}
export function eventsForClass(catalog,classId,entries){return catalog.events.filter(e=>e.classId===String(classId)&&!HOLIDAY_TITLE.test(e.title)).map(e=>{const matches=eventLessons(e,entries),dates=[...new Set(matches.map(x=>x.date))].sort();return {...e,originalDate:e.date,date:dates.at(-1)||e.date,lessonIds:matches.map(x=>x.id),scheduleMatched:!!matches.length};});}
// Common modules surveyed once per class at the module's last day. 현직자특강 has one form per track.
// 2기 과정: 모빌리티 AI(1·3·6·7·9·10·14반)·제조지능화. 반 과정이 비면 cohort 반 정보로 고릅니다.
const mobilityClasses=new Set(CLASSES.filter(c=>/모빌리티/.test(c.course)).map(c=>c.id));
const HOLIDAY_TITLE=new RegExp(['대체휴무',...HOLIDAY_NAMES].map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'));
const moduleSurveys=new Set(['현직자특강','진로취업','문화체험']);
function surveyTrack(course,classId){const c=String(course||'').normalize('NFKC');if(/모빌리티/.test(c))return '모빌리티';if(/제조/.test(c))return '제조';return classId?mobilityClasses.has(String(classId))?'모빌리티':'제조':'';}
export function sourceCandidates(event,sources,course){
 const title=keyTitle(event.title),mot=/동기부여\s*-?\s*(\d+)/.exec(event.title),courseKey=String(course||'').toLowerCase().replace(/\(\s*\d+\s*\)\s*$/,'').replace(/[\s()\-]/g,'');
 const track=moduleSurveys.has(title)?surveyTrack(course,event.classId):'';
 return sources.filter(s=>{
  if(moduleSurveys.has(title))return s.module===title&&(!s.track||!track||s.track===track);
  if(moduleSurveys.has(s.module))return false;
  if(mot)return s.module==='동기부여'&&s.title.startsWith(mot[1]+'주차');
  if(title==='분해조립')return /분해조립/.test(s.title);
  if(title==='공장견학')return /공장견학.*이론/.test(s.title);
  const raw=s.title.toLowerCase().replace(/\s/g,'');if(!raw.startsWith(courseKey.replace('aihw','ai-hw').replace('aisw','ai-sw'))&&!raw.startsWith(courseKey))return false;let token=lessonToken(s.title.slice(s.title.indexOf('(')+1,-1));
  return token===title||(title==='ai기반제조데이터분석입문'||title==='제조장비건전성관리입문')&&token.startsWith(title);
 });
}
export function responseColumns(headers){
 const choose=(pattern,label)=>{const found=headers.map((x,i)=>pattern.test(String(x))?i:-1).filter(i=>i>=0);if(found.length!==1)throw Error(label+' 열을 하나로 확인하지 못했습니다. 응답 시트 연결을 확인해 주세요.');return found[0];};
 const mapping={name:choose(/성함|성명|이름/,'이름'),classId:choose(/소속반|분반|소속\s*반|몇\s*반/,'반'),timestamp:choose(/타임스탬프|timestamp/i,'응답 시간')};
 const phones=headers.map((h,i)=>/전화|핸드폰|휴대폰|휴대전화|연락처|mobile|phone/i.test(String(h))?i:-1).filter(i=>i>=0);
 if(phones.length===1)mapping.phone=phones[0];return mapping;
}
const participated=new Set(['출석','인정지각','인정조퇴','인정외출','지각','조퇴','외출']);
export function attendanceTargets(data,date,metadata={},includeRecognized=false){
 const a=data.attendance||[],cols=(a[0]||[]).map((v,i)=>i>=4&&isoLabel(v)===date?i:-1).filter(i=>i>=0);
 if(cols.length!==1)throw Error('해당 교육일의 출결 열을 확인하지 못했습니다. 미응답자를 확정하지 않습니다.');
 return a.slice(1).map((r,i)=>{const name=String(r[0]||'').trim(),raw=String(r[cols[0]]||'').trim(),meta=metadata[`${i}_${name}`]||{};let status;try{status=portalStatus(raw,meta);}catch{status=raw;}
  const unresolved=raw==='인정출석'&&!(meta.sheetStatus===raw&&meta.portalStatus);
  return {id:`${i}_${name}`,name,status,eligible:participated.has(status)||(includeRecognized&&status==='인정출석'),review:!name||['','해당없음','미입력','중복'].includes(status)||unresolved&&!includeRecognized};
 }).filter(s=>s.name);
}
export function summarizeResponses({classId,targets,responses,identities=[]}){
 const match=createSurveyIdentityMatcher(targets,identities),counts=new Map(),unknownCounts=new Map(),unresolved=new Set(),unscopedNames=new Set();let invalidCount=0;
 for(const r of responses){
  const cid=classNumber(r.classId);if(!cid){invalidCount++;if(normalizeName(r.name))unscopedNames.add(surveyBaseName(r.name));continue;}if(cid!==String(classId))continue;
  if(!normalizeName(r.name)){invalidCount++;continue;}
  const {target,candidates}=match(r);
  if(target)counts.set(target.id,(counts.get(target.id)||0)+1);
  else if(candidates.length)candidates.forEach(s=>unresolved.add(s.id));
  else {const name=normalizeName(r.name);unknownCounts.set(name,(unknownCounts.get(name)||0)+1);}
 }
 const rosterCounts=new Map();targets.forEach(s=>rosterCounts.set(normalizeName(s.name),(rosterCounts.get(normalizeName(s.name))||0)+1));
 const answered=[],missing=[],review=[],excluded=[];
 for(const s of targets){const item={id:s.id,name:s.name,status:s.status};
  if(rosterCounts.get(normalizeName(s.name))!==1||s.review)review.push({...item,reason:rosterCounts.get(normalizeName(s.name))!==1?'동명이인 · 시트 이름 구분 필요':'출석 구분 확인 필요'});
  else if(!s.eligible)excluded.push(item);
  else if(counts.has(s.id))answered.push(item);
  else if(unresolved.has(s.id))review.push({...item,reason:'동명이인 · 응답 전화번호 확인 필요'});
  else if(unscopedNames.has(surveyBaseName(s.name)))review.push({...item,reason:'응답의 반 구분 확인 필요'});
  else missing.push(item);
 }
 return {answered,missing,review,excluded,unknown:[...unknownCounts].map(([name,count])=>({name,count})),invalidCount,duplicateCount:[...counts.values()].reduce((n,c)=>n+Math.max(0,c-1),0),eligibleCount:answered.length+missing.length};
}
export function sheetIdFromUrl(url){const u=new URL(url);const m=u.hostname==='docs.google.com'&&u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);if(!m)throw Error('Google 응답 스프레드시트 주소를 확인해 주세요.');return m[1];}
