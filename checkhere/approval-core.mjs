export const APPROVER = 'hint.kpc@gmail.com';
export const FIELDS = {entry:'입실·교시 시간',exit:'퇴실 시간',entryMemo:'입실·교시 관리자 사유',exitMemo:'퇴실 관리자 사유'};
export const STATUS = {pending:'승인 대기',approved:'승인됨 · 반영 대기',applying:'반영 중',verified:'검증 완료',rejected:'반려',conflict:'원본 변경 · 재확인',partial:'일부 반영 · 재확인',failed:'반영 실패',unknown:'결과 미확인'};
const own = (o,k)=>Object.hasOwn(o,k);
export function cleanRequest(input){
  const classId=String(input.classId||''),date=String(input.date||''),name=String(input.name||'').trim(),phoneLast4=String(input.phoneLast4||'').trim(),reason=String(input.reason||'').trim();
  if(!/^(?:[1-9]|1[0-7])$/.test(classId))throw Error('반을 확인해 주세요.');
  if(!/^2026-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<'2026-07-27'||date>'2026-10-22')throw Error('교육 기간 안의 날짜를 선택해 주세요.');
  if(!name||name.length>60||!reason||reason.length>1000)throw Error('학생 이름과 수정 근거(1,000자 이내)를 입력해 주세요.');
  if(phoneLast4&&!/^\d{4}$/.test(phoneLast4))throw Error('동명이인 구분 번호는 전화번호 끝 4자리입니다.');
  const changes={};
  if(!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw Error('수정할 항목을 선택해 주세요.');
  for(const [k,v] of Object.entries(input.changes)){
    if(!own(FIELDS,k)||typeof v!=='string')throw Error('허용하지 않는 수정 항목입니다.');
    if(k==='entry'||k==='exit'){
      if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v))throw Error('시간을 올바르게 입력해 주세요. 공란으로 지울 수 없습니다.');
      changes[k]=v.length===5?v+':00':v;
    }else{if(v.length>500)throw Error('관리자 사유는 500자 이내로 입력해 주세요.');changes[k]=v;}
  }
  if(!Object.keys(changes).length)throw Error('수정할 항목을 선택해 주세요.');
  if(changes.entry&&changes.exit&&changes.exit<changes.entry)throw Error('퇴실이 입실보다 빠릅니다.');
  return {classId,date,name,phoneLast4,reason,changes};
}
export function matchRequest(request,records){
  const r=cleanRequest(request);
  const found=records.filter(x=>String(x.classId)===r.classId&&x.date===r.date&&x.name.trim()===r.name&&(!r.phoneLast4||x.phoneLast4===r.phoneLast4));
  if(found.length!==1)throw Error(found.length?'동명이인이 있습니다. 요청자의 학생 식별정보를 확인해 주세요.':'해당 반·날짜를 먼저 수집하고 학생 이름을 확인해 주세요.');
  if(found[0].source!=='live'||found[0].readState!=='complete')throw Error('현재 PC에서 해당 학생의 상세 기록을 다시 수집해 주세요.');
  return found[0];
}
export function prepareApproval(request,record){
  const clean=cleanRequest(request);
  matchRequest(clean,[record]);
  const before=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,record[k]??'']));
  const after={...before,...clean.changes};
  if(![after.entry,after.exit].every(v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v))||after.exit<after.entry)throw Error('반영할 입실·퇴실 시간을 확인해 주세요. 시간이 없는 기록은 필요한 시간도 함께 요청해야 합니다.');
  if(Object.keys(FIELDS).every(k=>before[k]===after[k]))throw Error('요청한 값이 이미 체크히어 기록과 같습니다. 변경 없이 확인 후 반려할 수 있습니다.');
  return {recordId:record.id,version:record.version,before,after,reason:clean.reason};
}
export function proposalFromApproval(request){
  if(request.approvedBy!==APPROVER||!['approved','applying'].includes(request.status))throw Error('지정된 관리자의 승인이 필요합니다.');
  const a=request.approval;if(!a||!a.recordId||!a.version)throw Error('승인된 변경 내용을 찾지 못했습니다.');
  const clean=cleanRequest(request),expected={...a.before,...clean.changes};
  if(Object.keys(FIELDS).some(k=>a.after?.[k]!==expected[k])||a.reason!==clean.reason)throw Error('요청 내용과 승인 내용이 일치하지 않습니다.');
  return {id:a.recordId,version:a.version,...a.after,reason:a.reason};
}
