// Deterministic suggestions. No attendance, evidence, or CheckHere write occurs here.
export const ACTIVE_REQUESTS=['pending','approved','applying'];
export const PROPOSAL_STATUS={pending:'승인 대기',approved:'승인됨 · 반영 대기',applying:'반영 중',verified:'반영 확인 완료',rejected:'반려',conflict:'원본 변경 · 재확인',partial:'일부 반영 · 재확인',failed:'반영 실패',unknown:'결과 미확인'};
const hm=v=>/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v||'')?v.slice(0,5):'';
export const sourceRecord=r=>Object.fromEntries(['id','classId','date','name','phoneLast4','version','entry','rawEntry','exit','entryMemo','exitMemo','outings','teacher','schedule','readState'].map(k=>[k,r?.[k]??null]));
export const sameRecord=(a,b)=>JSON.stringify(sourceRecord(a))===JSON.stringify(sourceRecord(b));
export function reasonCategory(reason){
  const text=String(reason||'').trim();
  if(!text||/확인\s*필요|불명|미정|아님|취소/.test(text))return '';
  const found=[['병원',/병원|병결|진료|치료|질병/],['면접',/면접/],['인적성',/인적성/],['예비군',/예비군/],['민방위',/민방위/],['시험',/시험|응시/],['외조모상',/외조모상/],['외조부상',/외조부상/],['조모상',/(?<!외)조모상/],['조부상',/(?<!외)조부상/],['모친상',/모친상/],['부친상',/부친상/]].filter(([,re])=>re.test(text));
  // An aptitude examination is a single category even when described as an exam.
  const kinds=found.map(([k])=>k).filter(k=>!(k==='시험'&&found.some(([v])=>v==='인적성')));
  return kinds.length===1?kinds[0]:'';
}
export function suggestReason({status,reason,record:r,teacher=r?.teacher||''}){
  const recognized=/^인정(출석|지각|조퇴|외출)$/.test(status),kind=status.replace(/^인정/,'');
  const field=kind==='조퇴'?'exitMemo':'entryMemo';
  const out={field,text:'',teacher,notes:[],supported:recognized||['지각','조퇴','외출'].includes(status),blocked:false};
  if(!out.supported){out.notes.push(status==='중복'?'중복 출결 · 개별 검토 필요':'자동 사유 생성 대상이 아닙니다.');return out;}
  if(!r||r.readState!=='complete'||!r.id||!r.version){out.blocked=true;out.notes.push('체크히어 상세 저장본을 먼저 수집해 주세요.');return out;}
  if(!teacher||/[\n_():]/.test(teacher)){out.notes.push('해당 날짜의 담임 이름 확인 필요');return out;}
  const category=recognized?reasonCategory(reason):'';
  if(recognized&&!category){out.notes.push('인정 사유를 하나로 확인하지 못했습니다. 원문 확인 후 직접 작성해 주세요.');return out;}
  let suffix='';
  if(kind==='지각'){
    const time=hm(r.rawEntry??r.entry);
    if(!time||time<='09:10'){out.notes.push('실제 지각 시간 확인 필요 · 보정된 입실시간일 수 있습니다.');return out;}
    suffix=`(${time})`;
  }else if(kind==='조퇴'){
    const time=hm(r.exit);
    if(!time||time>='17:50'){out.notes.push('실제 조퇴 시간 확인 필요 · 보정된 퇴실시간일 수 있습니다.');return out;}
    suffix=`(${time})`;
  }else if(kind==='외출'){
    if(!r.outings?.length){out.blocked=true;out.notes.push(`${r.classId}반-${r.date}-${r.name}-외출시간없음`);return out;}
    if(r.outingCount>r.outings.length||r.outings.some(x=>!hm(x.start)||!hm(x.end)||hm(x.end)<=hm(x.start))){out.blocked=true;out.notes.push('외출 구간 누락·시간 확인 필요');return out;}
    suffix=`(${r.outings.map(x=>`${hm(x.start)}~${hm(x.end)}`).join(', ')})`;
    if(r.outings.length>1)out.notes.push('외출 구간이 여러 개입니다. 모든 구간을 검토해 주세요.');
  }
  out.text=(recognized?`(${status})${category}`:status)+`_담임:${teacher}${suffix}`;
  if(String(r[field]||'').trim())out.notes.push('기존 체크히어 사유와 교체될 내용을 비교해 주세요.');
  return out;
}
export function assertProposalSource(context,record){
  if(!context?.record||!sameRecord(context.record,record))throw Error('요청 당시 체크히어 기록과 다릅니다. 재수집 후 출결대조에서 제안을 다시 검토해 주세요.');
}
export function requestChanges(record,field,text){
  if(!['entryMemo','exitMemo'].includes(field)||typeof text!=='string'||!text.trim()||text.length>500)throw Error('반영할 사유를 1~500자로 입력해 주세요.');
  if(text===record[field])throw Error('이미 체크히어 기록과 같은 사유입니다.');
  return {[field]:text};
}
