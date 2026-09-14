// Deterministic suggestions. No attendance, evidence, or CheckHere write occurs here.
export const ACTIVE_REQUESTS=['pending','approved','applying'];
export const PROPOSAL_STATUS={pending:'승인 대기',approved:'승인됨 · 반영 대기',applying:'반영 중',verified:'반영 확인 완료',rejected:'반려',withdrawn:'요청취소',conflict:'원본 변경 · 재확인',partial:'일부 반영 · 재확인',failed:'반영 실패',unknown:'결과 미확인'};
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
  if(status==='출석')return {field:'entryMemo',fields:['entryMemo','exitMemo'],text:'',clear:true,supported:true,blocked:false,notes:['정상출석 · 사유 공란을 추천합니다. 기존 사유가 있으면 공란 변경요청으로 비울 수 있습니다.']};
  const recognized=/^인정(출석|지각|조퇴|외출)$/.test(status),kind=status.replace(/^인정/,'');
  const field=kind==='조퇴'?'exitMemo':'entryMemo';
  const out={field,text:'',teacher,notes:[],supported:recognized||['지각','조퇴','외출'].includes(status),blocked:false};
  if(!out.supported){out.notes.push(status==='중복'?'중복 출결 · 개별 검토 필요':'자동 사유 생성 대상이 아닙니다.');return out;}
  if(!r||r.readState!=='complete'||!r.id||!r.version){out.incomplete=true;out.notes.push('저장본 미수집 · 시트 기준 미리보기입니다.');}
  if(!teacher||/[\n_():]/.test(teacher)){out.incomplete=true;out.notes.push('해당 날짜의 담임 이름 확인 필요');teacher='[담임 확인]';}
  const category=recognized?reasonCategory(reason):'';
  if(recognized&&!category){out.incomplete=true;out.notes.push('인정 사유를 하나로 확인하지 못했습니다. 원문 확인 후 직접 작성해 주세요.');}
  let suffix='';
  if(kind==='지각'){
    const time=hm(r?.rawEntry??r?.entry);
    if(!time||time<='09:10'){out.incomplete=true;out.notes.push('실제 지각 시간 확인 필요 · 보정된 입실시간일 수 있습니다.');}
    suffix=`(${time&&time>'09:10'?time:'[시간 확인]'})`;
  }else if(kind==='조퇴'){
    const time=hm(r?.exit);
    if(!time||time>='17:50'){out.incomplete=true;out.notes.push('실제 조퇴 시간 확인 필요 · 보정된 퇴실시간일 수 있습니다.');}
    suffix=`(${time&&time<'17:50'?time:'[시간 확인]'})`;
  }else if(kind==='외출'){
    if(!r?.outings?.length){out.blocked=true;out.incomplete=true;out.notes.push(`${r?.classId||''}반-${r?.date||''}-${r?.name||''}-외출시간없음`);suffix='([외출시간 확인])';}
    else if(r.outingCount>r.outings.length||r.outings.some(x=>!hm(x.start)||!hm(x.end)||hm(x.end)<=hm(x.start))){out.blocked=true;out.incomplete=true;out.notes.push('외출 구간 누락·시간 확인 필요');suffix='([외출시간 확인])';}
    else suffix=`(${r.outings.map(x=>`${hm(x.start)}~${hm(x.end)}`).join(', ')})`;
    if(r?.outings?.length>1)out.notes.push('외출 구간이 여러 개입니다. 모든 구간을 검토해 주세요.');
  }
  out.text=(recognized?`(${status})${category||'[사유 확인]'}`:status)+`_담임:${teacher}${suffix}`;
  if(String(r?.[field]||'').trim())out.notes.push('기존 체크히어 사유와 교체될 내용을 비교해 주세요.');
  return out;
}
export function assertProposalSource(context,record){
  if(!context?.record||!sameRecord(context.record,record))throw Error('요청 당시 체크히어 기록과 다릅니다. 재수집 후 출결대조에서 제안을 다시 검토해 주세요.');
}
export const REQUEST_COLUMNS={times:'입실 → 퇴실',entryMemo:'입실·교시 사유',exitMemo:'퇴실 사유'};
export const columnFields=column=>column==='times'?['entry','exit']:[column];
export const requestColumn=r=>Object.keys(r.changes||{}).every(k=>['entry','exit'].includes(k))?'times':Object.keys(r.changes||{}).length===1&&['entryMemo','exitMemo'].includes(Object.keys(r.changes)[0])?Object.keys(r.changes)[0]:'combined';
export const requestsOverlap=(a,b)=>a.classId===b.classId&&a.date===b.date&&a.name===b.name&&(!a.phoneLast4||!b.phoneLast4||a.phoneLast4===b.phoneLast4)&&Object.keys(a.changes).some(k=>Object.hasOwn(b.changes,k));
export function excursionFor(entries,date){return entries.filter(e=>e.date===date&&e.kind!=='holiday'&&(['공장견학','분해조립','실차체험'].includes(e.module)||/분해조립|공장.*견학/.test(e.title||'')));}
export function suggestTimes({status,record:r,excursion=false}){
 const value={entry:r?.entry||'',exit:r?.exit||''},notes=[];
 if(excursion)return {value,notes:['견학일 · 실제 운영 시간을 확인한 뒤 직접 입력해 주세요.']};
 if(/^인정(출석|지각|조퇴|외출)$/.test(status))return {value:{entry:'09:00:00',exit:'18:00:00'},notes:['시트 인정출석 기준의 추천시간입니다. 실제 입퇴실 시각과 구분해 검토해 주세요.']};
 if(status==='출석')return {value:{entry:!hm(value.entry)||hm(value.entry)>'09:10'?'09:00:00':value.entry,exit:!hm(value.exit)||hm(value.exit)<'17:50'?'18:00:00':value.exit},notes:['시트 출석 기준으로 검토할 추천시간입니다. 수정 전 실제 출석 근거를 확인해 주세요.']};
 notes.push(status==='결석'?'결석은 시간 공란이 정상입니다. 시간 삭제는 자동 요청하지 않습니다.':'실제 수집 시간을 유지합니다. 빠진 시각은 확인 후 직접 입력해 주세요.');
 return {value,notes};
}
export function requestChanges(record,field,value){
 if(field==='times'){
  const out={};for(const k of ['entry','exit']){const t=value?.[k];if(!hm(t))throw Error('입실·퇴실 시간을 모두 입력해 주세요.');const v=t.length===5?t+':00':t;if(v!==(record[k]||''))out[k]=v;}
  const entry=out.entry||record.entry,exit=out.exit||record.exit;if(exit<entry)throw Error('퇴실이 입실보다 빠릅니다.');
  if(!Object.keys(out).length)throw Error('현재 체크히어 기록과 같습니다.');return out;
 }
 if(!['entryMemo','exitMemo'].includes(field)||typeof value!=='string'||value.length>500)throw Error('반영할 사유는 500자 이내로 입력해 주세요. 공란도 가능합니다.');
 if(!value.trim())value='';
 if(value===(record[field]||''))throw Error('현재 체크히어 기록과 같습니다.');return {[field]:value};
}
export function assertColumnSource(context,record){
 if(context.sourceScope!=='column-v2')return assertProposalSource(context,record);
 const before=context.record,identity=['id','classId','date','name','phoneLast4','teacher','schedule','readState'];
 if(!before||identity.some(k=>(before[k]??null)!==(record[k]??null))||columnFields(context.column).some(k=>(before[k]||'')!==(record[k]||'')))throw Error('요청 당시 체크히어 기록과 다릅니다. 해당 항목을 다시 수집하고 검토해 주세요.');
}
