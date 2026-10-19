// 2기 기간·날짜 해석(해를 넘김)은 cohort.mjs 한 곳에서 읽습니다.
import {COURSE_START,COURSE_END,COHORT_DATE_RE,isIsoDate,isoFromMonthDay,isHoliday,mdLabel,weekdaysBetween} from './cohort.mjs';
import {matchingCheckHereRecords} from './checkhere-name-core.mjs';
import {surveyBaseName} from './survey-identity.mjs';
export const ATTENDANCE_OPTIONS=['해당없음','출석','결석','지각','조퇴','외출','중복','인정출석','인정지각','인정조퇴','인정외출'];
export const EVIDENCE_OPTIONS=['미해당','미제출','반려','확인'];
export const EVIDENCE_COLORS={미해당:'#ffffff',미제출:'#ff0000',반려:'#ff0000',확인:'#ffff00'};
export const recognized=s=>['인정출석','인정지각','인정조퇴','인정외출'].includes(s);
export const sheetStatus=s=>{if(!ATTENDANCE_OPTIONS.includes(s))throw Error('지원하지 않는 출결 상태입니다.');return recognized(s)?'인정출석':s;};
export const emptyStatus=s=>!String(s||'').trim()||['해당없음','미입력','-'].includes(String(s).trim());
export function hasExistingReason(raw,name,parsed=''){
  if(String(parsed||'').trim())return true;
  return String(raw||'').split(/\r?\n/).some(line=>{const at=line.indexOf(name);return at>=0&&!!line.slice(at+name.length).replace(/^[\s:：_\-]+/,'').trim();});
}
export const koreaToday=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function latestTeachingDate(dates,today=koreaToday()){
  const sorted=[...dates].filter(x=>x.iso).sort((a,b)=>a.iso.localeCompare(b.iso));
  return sorted.filter(x=>x.iso<=today).at(-1)||sorted[0]||null;
}
export function portalStatus(raw,meta){return meta?.sheetStatus===raw&&ATTENDANCE_OPTIONS.includes(meta.portalStatus)&&sheetStatus(meta.portalStatus)===raw?meta.portalStatus:raw||'해당없음';}
export function overviewColorState(bg){
  let x=String(bg||'').trim().toLowerCase();
  if(/^#[0-9a-f]{3}$/.test(x))x='#'+x.slice(1).split('').map(c=>c+c).join('');
  if(!/^#[0-9a-f]{6}$/.test(x))return'미제출';
  const r=parseInt(x.slice(1,3),16),g=parseInt(x.slice(3,5),16),b=parseInt(x.slice(5,7),16);
  if(r>=242&&g>=242&&b>=242)return'미제출';
  if(r>=180&&g>=135&&b<=190&&Math.abs(r-g)<=110&&g>b+20)return'확인';
  if(r>=175&&g<=185&&b<=185&&r>g+25&&r>b+25)return'보완필요';
  return'미제출';
}
export function evidenceStatus(rawColor,rawStatus,meta,colorState){
  if(meta?.sheetColor?.toLowerCase()===String(rawColor).toLowerCase()&&EVIDENCE_OPTIONS.includes(meta.evidenceStatus))return meta.evidenceStatus;
  const kind=colorState(rawColor);if(kind==='확인')return'확인';if(kind==='보완필요')return'반려';return recognized(rawStatus)?'미제출':'미해당';
}
export function columnName(n){if(!Number.isInteger(n)||n<1)throw Error('잘못된 열 번호입니다.');let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
export const quoteSheet=s=>"'"+String(s).replace(/'/g,"''")+"'";
// 시트 날짜 글('10/28', '1/4(월)', '2027-01-04')을 2기 날짜로: M/D는 cohort isoFromMonthDay(10~12월 2026, 1월 2027), ISO는 2기 연도(2026·2027)만.
// 1기 운영총괄 칸 배치(resolveSheetTarget, M18:ZZ48·51행)는 2기에서 쓰지 않아 뺐습니다(2기는 마스터시트 Apps Script로 씀).
export function isoLabel(v){const s=String(v||'').trim();if(isIsoDate(s))return COHORT_DATE_RE.test(s)?s:'';return isoFromMonthDay(s);}

// Edit only unambiguous student entries. Unknown layouts stop rather than
// rebuilding the entire day from parser guesses.
export function rewriteReasons(raw,changes,roster){
  const names=roster.map(x=>String(x).trim()).filter(Boolean),targets=new Map();
  for(const [name,value] of Object.entries(changes)){
    if(names.filter(n=>n===name).length!==1)throw Error(`${name}: 동명이인 또는 명단 확인이 필요합니다.`);
    if(typeof value!=='string'||value.length>500||/[\r\n]/.test(value))throw Error('사유는 한 줄, 500자 이내로 입력해 주세요.');
    targets.set(name,value.trim());
  }
  const unique=[...new Set(names)].sort((a,b)=>b.length-a.length);
  const hits=line=>{const result=[];for(const name of unique){let at=0;while((at=line.indexOf(name,at))>=0){if(!result.some(x=>at<x.end&&at+name.length>x.start))result.push({name,start:at,end:at+name.length});at+=name.length;}}return result.sort((a,b)=>a.start-b.start);};
  const lines=String(raw||'').split(/\r?\n/),seen=new Map();
  for(const line of lines)for(const h of hits(line))if(targets.has(h.name))seen.set(h.name,(seen.get(h.name)||0)+1);
  for(const [name,n] of seen)if(n>1)throw Error(`${name}: 가-3에 이름이 여러 번 있어 자동 수정할 수 없습니다. 원문을 확인해 주세요.`);
  const result=[];
  for(const line of lines){
    const h=hits(line);if(!h.some(x=>targets.has(x.name))){result.push(line);continue;}
    if(line.slice(0,h[0].start).trim()&&!/^[\s*•·\d.)\-]*(?:출석|결석|지각|조퇴|외출|인정출석|인정지각|인정조퇴|인정외출)?\s*[:：_\-]?\s*$/.test(line.slice(0,h[0].start)))throw Error('가-3 이름 앞 문맥이 불명확합니다. 원문을 확인해 주세요.');
    if(h.length===1){const name=h[0].name,v=targets.get(name);if(v)result.push(`${name}: ${v}`);continue;}
    const shared=h.slice(0,-1).every((x,i)=>/^[\s,，/·&와과및]+$/.test(line.slice(x.end,h[i+1].start)));
    if(shared){
      const tail=line.slice(h.at(-1).end);if(!/^\s*(?:님)?\s*[:：_\-]/.test(tail))throw Error('공통 사유의 구분 기호가 불명확합니다. 가-3 원문을 확인해 주세요.');
      for(const x of h){const value=targets.has(x.name)?targets.get(x.name):tail.replace(/^\s*(?:님)?\s*[:：_\-]+\s*/,'');if(value)result.push(`${x.name}: ${value}`);}
    }else{
      for(let i=0;i<h.length;i++){const x=h[i],segment=line.slice(x.start,h[i+1]?.start??line.length);if(!/^\s*(?:님)?\s*[:：_\-]/.test(segment.slice(x.name.length)))throw Error('한 줄에 여러 학생의 사유가 섞여 자동 수정할 수 없습니다. 원문을 확인해 주세요.');if(targets.has(x.name)){const value=targets.get(x.name);if(value)result.push(`${x.name}: ${value}`);}else result.push(segment.trim());}
    }
  }
  for(const [name,value] of targets)if(!seen.has(name)&&value)result.push(`${name}: ${value}`);
  return result.join('\n');
}
export function latestSnapshots(records,classId,date){
  const byId=new Map();for(const r of records){if(String(r.classId)!==String(classId)||r.date!==date||!r.id)continue;const prev=byId.get(r.id);if(!prev||String(r.collectedAt||'')>String(prev.collectedAt||''))byId.set(r.id,r);}return [...byId.values()];
}
export function matchSnapshot(student,students,records,identities=[]){
  if(students.filter(x=>x.name===student.name).length!==1)return {error:'동명이인 · 연결 확인 필요'};
  const found=matchingCheckHereRecords(student,records,identities);return found.length===1?{record:found[0]}:{error:found.length?'동명이인 · 연결 확인 필요':records.some(x=>surveyBaseName(x.name)===surveyBaseName(student.name))?'동명이인 · 구분 정보 확인 필요':'저장본 없음'};
}
// 체크히어 저장본을 읽을 날짜: 2기 교육 기간(cohort) 안, 오늘까지의 평일에서 휴일(12/25·12/31·1/1)을 뺀 날.
export function collectionDates(from,to,today=koreaToday()){
  if(![from,to].every(x=>COHORT_DATE_RE.test(String(x))&&isIsoDate(x)))throw Error('날짜 형식을 확인해 주세요.');
  if(from<COURSE_START||to>today||to>COURSE_END||from>to)throw Error(`수집 기간은 ${mdLabel(COURSE_START)}부터 오늘 또는 교육 종료일(${mdLabel(COURSE_END)})까지입니다.`);
  return weekdaysBetween(from,to).filter(d=>!isHoliday(d));
}
