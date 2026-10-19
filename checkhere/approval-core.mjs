import {matchingCheckHereRecords,hasBirthYearName} from '../checkhere-name-core.mjs';
import {RULES,normalizeTime} from './rules.mjs';
import {APPROVER as COHORT_APPROVER,CLASS_ID_RE,COHORT_DATE_RE,COURSE_START,COURSE_END,isIsoDate} from '../cohort.mjs';
// 체크히어 승인·반영 계정과 요청 범위(반 1~16, 2기 교육 기간 2026-10-28~2027-01-22)는 cohort.json에서 옵니다.
// firestore.rules checkhereRequests·beta2-checkhere-core.mjs REQUEST_DATE_RANGE와 같은 값이어야 합니다.
export const APPROVER = COHORT_APPROVER;
export const FIELDS = {entry:'입실·교시 시간',exit:'퇴실 시간',entryMemo:'입실·교시 관리자 사유',exitMemo:'퇴실 관리자 사유'};
export const STATUS = {pending:'승인 대기',approved:'승인됨 · 반영 대기',applying:'반영 중',verified:'검증 완료',rejected:'반려',withdrawn:'요청취소',conflict:'원본 변경 · 재확인',partial:'일부 반영 · 재확인',failed:'반영 실패',unknown:'결과 미확인'};
const own = (o,k)=>Object.hasOwn(o,k);
// 빈 시간: null·''·'-' 모두. 읽을 수 없는 값은 빈 것으로 보지 않습니다.
const blankTime=v=>{try{return !normalizeTime(v);}catch{return false;}};
// 시간 삭제 요청(deleteTimes, 관리자만): 지정한 쪽만 changes에 ''로 넣고, 그쪽 사유는 넣지 않거나 ''만.
// 지정하지 않은 ''는 지금처럼 거절하고, 삭제가 아닌 요청은 결과 모양이 그대로입니다(deleteTimes 키 없음).
export function cleanRequest(input){
  const classId=String(input.classId||''),date=String(input.date||''),name=String(input.name||'').trim(),phoneLast4=String(input.phoneLast4||'').trim(),reason=String(input.reason||'').trim();
  if(!CLASS_ID_RE.test(classId))throw Error('반을 확인해 주세요.');
  if(!COHORT_DATE_RE.test(date)||!isIsoDate(date)||date<COURSE_START||date>COURSE_END)throw Error('교육 기간 안의 날짜를 선택해 주세요.');
  if(!name||name.length>60||!reason||reason.length>1000)throw Error('학생 이름과 수정 근거(1,000자 이내)를 입력해 주세요.');
  // 체크히어 가린 이름(가**)으로는 요청하지 않습니다(가린 값이 학생 이름이 되지 않게).
  if(name.includes('*'))throw Error('학생 이름에 가린 글자(*)가 있습니다. 체크히어 원문 이름으로 요청해 주세요.');
  if(phoneLast4&&!/^\d{4}$/.test(phoneLast4))throw Error('동명이인 구분 번호는 전화번호 끝 4자리입니다.');
  const del=input.deleteTimes??[];
  if(!Array.isArray(del)||new Set(del).size!==del.length||del.some(k=>k!=='entry'&&k!=='exit'))throw Error('삭제할 시간 항목을 확인해 주세요.');
  const deleteTimes=['entry','exit'].filter(k=>del.includes(k));
  const changes={};
  if(!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw Error('수정할 항목을 선택해 주세요.');
  for(const [k,v] of Object.entries(input.changes)){
    if(!own(FIELDS,k)||typeof v!=='string')throw Error('허용하지 않는 수정 항목입니다.');
    if(k==='entry'||k==='exit'){
      if(v===''&&deleteTimes.includes(k)){changes[k]='';continue;}
      if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v))throw Error('시간을 올바르게 입력해 주세요. 공란으로 지울 수 없습니다.');
      changes[k]=v.length===5?v+':00':v;
    }else{if(v.length>500)throw Error('관리자 사유는 500자 이내로 입력해 주세요.');changes[k]=v;}
  }
  if(!Object.keys(changes).length)throw Error('수정할 항목을 선택해 주세요.');
  if(deleteTimes.some(k=>changes[k]!==''))throw Error('삭제할 시간 항목을 확인해 주세요.');
  if(deleteTimes.some(k=>own(changes,k+'Memo')&&changes[k+'Memo']!==''))throw Error('삭제하는 시간의 관리자 사유는 비워 주세요.');
  if(changes.entry&&changes.exit&&changes.exit<changes.entry)throw Error('퇴실이 입실보다 빠릅니다.');
  return {classId,date,name,phoneLast4,reason,changes,...(deleteTimes.length?{deleteTimes}:{})};
}
// 반영 결과(results)에서 확인된 시간 삭제 안내(없으면 ''). 연결 프로그램·포털이 같은 글을 씁니다.
// 두 칸(퇴실·1교시): ' · 퇴실·1교시 삭제 확인'(+ 마지막으로 다시 읽은 입실이 남았으면 ' · 입실 기록은 남음'), 한 칸: ' · 퇴실 시간 삭제 확인' / ' · 1교시 시간 삭제 확인'.
export const deletedNote=results=>{
  const done=(Array.isArray(results)?results:[]).filter(r=>r?.state==='verified'&&r.deleted),has=f=>done.some(r=>r.field===f);
  if(!done.length)return '';
  if(has('entry')&&has('exit'))return ` · 퇴실·1교시 삭제 확인${done.at(-1)?.rawEntryAfter?' · 입실 기록은 남음':''}`;
  return ` · ${has('exit')?'퇴실':'1교시'} 시간 삭제 확인`;
};
// 요청 결과(result) 글: 플랫폼 저장(cloud-approval finish)이 완료 문구를 새로 써도 저장된 results로 삭제 확인을 붙여 보입니다.
export const resultText=(message,results)=>{const m=String(message||''),note=deletedNote(results);return note&&!m.includes(note)?m+note:m;};
export function sameRequestTarget(left,right){
  try{
    const a=cleanRequest(left),b=cleanRequest(right);
    return ['classId','date','name','phoneLast4','reason'].every(k=>a[k]===b[k])&&
      JSON.stringify(a.deleteTimes||[])===JSON.stringify(b.deleteTimes||[])&&
      Object.keys(a.changes).length===Object.keys(b.changes).length&&
      Object.keys(a.changes).every(k=>own(b.changes,k)&&a.changes[k]===b.changes[k]);
  }catch{return false;}
}
export function matchRequest(request,records,identities=[]){
  const r=cleanRequest(request);
  const found=matchingCheckHereRecords(r,records,identities);
  if(found.length!==1)throw Error(found.length?'동명이인이 있습니다. 요청자의 학생 식별정보를 확인해 주세요.':hasBirthYearName(r.name)?'동명이인 구분 정보와 체크히어 전화번호 끝 4자리를 확인해 주세요.':'해당 반·날짜를 먼저 수집하고 학생 이름을 확인해 주세요.');
  if(found[0].source!=='live'||found[0].readState!=='complete')throw Error('현재 PC에서 해당 학생의 상세 기록을 다시 수집해 주세요.');
  return found[0];
}
export function requestMatchesRecord(request,record,identities=[]){
  const clean=cleanRequest(request),del=clean.deleteTimes||[];matchRequest(clean,[record],identities);
  // 지운 쪽은 시간이 비었는지만 봅니다. 나머지는 지금처럼 값이 같아야 합니다.
  return Object.entries(clean.changes).every(([k,v])=>del.includes(k)?blankTime(record[k]):typeof record[k]==='string'&&record[k]===v);
}
// CheckHere requires a time in the same editor when saving a changed memo.
// Never synthesize a time for reads, an already-matching memo, or the other side.
// 명시된 시간 키는 건너뜁니다(시간 삭제 요청의 ''도 여기서 시간을 만들지 않음).
// 채우는 시간은 체크히어 강의 기본 시간(RULES 09:00·18:00)입니다. 견학 날에도 체크히어가 스스로 채우는 값·연결 프로그램(collector)이 쓰는 값과 같아야 합니다.
export function memoDefaultTimes(changes,record){
  const times={};
  for(const [field,setting]of [['entry','start'],['exit','end']]){
    if(own(changes,field+'Memo')&&changes[field+'Memo']!==(record[field+'Memo']??'')&&!own(changes,field)&&!normalizeTime(record[field]))times[field]=normalizeTime(RULES[setting]);
  }
  return times;
}
export function prepareApproval(request,record,{allowAlreadyApplied=false,identities=[]}={}){
  const clean=cleanRequest(request);
  matchRequest(clean,[record],identities);
  const before=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,record[k]??'']));
  const after={...before,...memoDefaultTimes(clean.changes,before),...clean.changes};
  const already=Object.keys(FIELDS).every(k=>before[k]===after[k]);
  if(!(already&&allowAlreadyApplied)){
    if(['entry','exit'].some(k=>after[k]&&!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(after[k]))||after.entry&&after.exit&&after.exit<after.entry)throw Error('반영할 입실·퇴실 시간을 확인해 주세요.');
    if(already)throw Error('요청한 값이 이미 체크히어 기록과 같습니다. 원본 확인 후 이미 반영으로 처리해 주세요.');
  }
  // Omitted untouched blanks keep the existing approval schema valid. 지정된 삭제만 after[k]=''로 남깁니다.
  const del=clean.deleteTimes||[];
  for(const k of ['entry','exit'])if(!after[k]&&!del.includes(k))delete after[k];
  return {recordId:record.id,version:record.version,before,after,reason:clean.reason};
}
export function proposalFromApproval(request){
  if(request.approvedBy!==APPROVER||!['approved','applying'].includes(request.status))throw Error('지정된 관리자의 승인이 필요합니다.');
  const a=request.approval;if(!a||!a.recordId||!a.version)throw Error('승인된 변경 내용을 찾지 못했습니다.');
  const clean=cleanRequest(request),expected={...a.before,...memoDefaultTimes(clean.changes,a.before),...clean.changes};
  if(Object.keys(FIELDS).some(k=>(a.after?.[k]??'')!==expected[k])||(clean.deleteTimes||[]).some(k=>a.after?.[k]!=='')||a.reason!==clean.reason)throw Error('요청 내용과 승인 내용이 일치하지 않습니다.');
  return {id:a.recordId,version:a.version,...a.before,...a.after,reason:a.reason};
}
