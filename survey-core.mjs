import {isoLabel,portalStatus} from './attendance-beta-core.mjs';
export const SURVEY_OWNER='hint.kpc@gmail.com';
export const SURVEY_COLLECTION='surveyBetaSummaries';
export const SURVEY_ATTENDANCE_VERSION='all-lesson-days-v2:';
export function surveyAttendanceDates(event,entries,fallbackDate){
 const dates=[...new Set(entries.filter(e=>e.kind!=='holiday'&&event.lessonIds?.includes(e.id)).map(e=>e.date))].sort();
 return dates.length?dates:[fallbackDate];
}
export const normalizeName=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').trim();
// Exact choices verified in the operational factory/workshop survey form.
const classChoices=['서울대_임베디드AI(HW)','한양대_제조지능화','후인원(A)_임베디드AI(SW)','후인원(B)_제조지능화','충북대 G-테크벤처센터_제조지능화','마이크로웨이브_임베디드AI(HW)','KPC대구지역본부_임베디드AI(SW)','대구상공회의소_제조지능화(1)','경북대_제조지능화(2)','아르피나(A)_임베디드AI(HW)','부산대_임베디드AI(SW)','아르피나(B)_제조지능화(1)','부산경영자총협회_제조지능화(2)','현대차 울산기술교육원_제조지능화','전남대_임베디드AI(SW)','기아 광주교육센터(A)_제조지능화(1)','기아 광주교육센터(B)_제조지능화(2)'];
const classChoiceKey=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const classChoiceIds=new Map(classChoices.map((v,i)=>[classChoiceKey(v),String(i+1)]));
export const classNumber=v=>{const m=String(v||'').trim().match(/^(?:제\s*)?(\d{1,2})\s*(?:반|[.\-_]|$)/);return m&&+m[1]>=1&&+m[1]<=17?String(+m[1]):classChoiceIds.get(classChoiceKey(v))||'';};
export function lessonToken(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/직무특화|\[실습\]|\(고정\)|\(sw\)|\(hw\)|sw전공자대상|hw전공자대상/g,'').replace(/임베디드시스템의이해/g,'임베디드시스템이해').replace(/[\s_\-+·/,()[\]]/g,'').replace('임베디드시스템의이해','임베디드시스템이해').replace('딥러닝기반영상인식','딥러닝기반영상인식').replace('임베디드리눅스시스템','임베디드리눅스').replace(/(?:sw|hw)(?:전공자대상)?$/g,'').replace('건정성','건전성').replace('제조장비건전성관리시스템설계실습','장비건전성관리시스템설계실습');}
function keyTitle(v){const t=lessonToken(v);if(/분해조립/.test(t))return '분해조립';if(/공장.*견학|견학.*공장|공장견학생산공정이론교육/.test(t))return '공장견학';return t;}
export function eventLessons(event,entries){
 const t=keyTitle(event.title),mot=/동기부여\s*-?\s*(\d+)/.exec(event.title);
 return entries.filter(e=>e.kind!=='holiday'&&(mot?e.module==='동기부여'&&e.day===+mot[1]:keyTitle(e.title)===t||t==='ai기반제조데이터분석입문'&&keyTitle(e.title).startsWith(t)||t==='제조장비건전성관리입문'&&keyTitle(e.title).startsWith(t)));
}
export function eventsForClass(catalog,classId,entries){return catalog.events.filter(e=>e.classId===String(classId)&&!(/추석|한글날|대체휴무/.test(e.title))).map(e=>{const matches=eventLessons(e,entries),dates=[...new Set(matches.map(x=>x.date))].sort();return {...e,originalDate:e.date,date:dates.at(-1)||e.date,lessonIds:matches.map(x=>x.id),scheduleMatched:!!matches.length};});}
export function sourceCandidates(event,sources,course){
 const title=keyTitle(event.title),mot=/동기부여\s*-?\s*(\d+)/.exec(event.title),courseKey=String(course||'').toLowerCase().replace(/\(\s*\d+\s*\)\s*$/,'').replace(/[\s()\-]/g,'');
 return sources.filter(s=>{
  if(mot)return s.module==='동기부여'&&s.title.startsWith(mot[1]+'주차');
  if(title==='분해조립')return /분해조립/.test(s.title);
  if(title==='공장견학')return /공장견학.*이론/.test(s.title);
  const raw=s.title.toLowerCase().replace(/\s/g,'');if(!raw.startsWith(courseKey.replace('aihw','ai-hw').replace('aisw','ai-sw'))&&!raw.startsWith(courseKey))return false;let token=lessonToken(s.title.slice(s.title.indexOf('(')+1,-1));
  return token===title||(title==='ai기반제조데이터분석입문'||title==='제조장비건전성관리입문')&&token.startsWith(title);
 });
}
export function responseColumns(headers){
 const choose=(pattern,label)=>{const found=headers.map((x,i)=>pattern.test(String(x))?i:-1).filter(i=>i>=0);if(found.length!==1)throw Error(label+' 열을 하나로 확인하지 못했습니다. 응답 시트 연결을 확인해 주세요.');return found[0];};
 return {name:choose(/성함|성명|이름/,'이름'),classId:choose(/소속반|분반|소속\s*반|몇\s*반/,'반'),timestamp:choose(/타임스탬프|timestamp/i,'응답 시간')};
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
export function summarizeResponses({classId,targets,responses}){
 const counts=new Map(),unknown=[],invalid=[],unscopedNames=new Set();
 for(const r of responses){const cid=classNumber(r.classId);if(!cid){invalid.push('반 확인 필요');if(normalizeName(r.name))unscopedNames.add(normalizeName(r.name));continue;}if(cid!==String(classId))continue;const name=normalizeName(r.name);if(!name){invalid.push('이름 확인 필요');continue;}counts.set(name,(counts.get(name)||0)+1);}
 const rosterCounts=new Map();targets.forEach(s=>rosterCounts.set(normalizeName(s.name),(rosterCounts.get(normalizeName(s.name))||0)+1));
 const answered=[],missing=[],review=[],excluded=[];
 for(const s of targets){const name=normalizeName(s.name),item={id:s.id,name:s.name,status:s.status};if(rosterCounts.get(name)!==1||s.review)review.push({...item,reason:rosterCounts.get(name)!==1?'동명이인 · 자동 연결 제외':'출석 구분 확인 필요'});else if(!s.eligible)excluded.push(item);else if(counts.has(name))answered.push(item);else if(unscopedNames.has(name))review.push({...item,reason:'응답의 반 구분 확인 필요'});else missing.push(item);}
 for(const [name,count]of counts)if(!rosterCounts.has(name))unknown.push({name,count});
 return {answered,missing,review,excluded,unknown,invalidCount:invalid.length,duplicateCount:[...counts.values()].reduce((n,c)=>n+Math.max(0,c-1),0),eligibleCount:answered.length+missing.length};
}
export function sheetIdFromUrl(url){const u=new URL(url);const m=u.hostname==='docs.google.com'&&u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);if(!m)throw Error('Google 응답 스프레드시트 주소를 확인해 주세요.');return m[1];}
