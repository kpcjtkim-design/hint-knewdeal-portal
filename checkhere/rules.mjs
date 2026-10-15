export const RULES = Object.freeze({version:'HINT-1.2.1-20260910',start:'09:00',end:'18:00',lunchStart:'12:00',lunchEnd:'13:00',entryGrace:10,exitGrace:10});
export function seconds(v){
  if(v===null||v===undefined||v===''||v==='-')return null;
  const m=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(v));
  if(!m||+m[1]>23||+m[2]>59||+(m[3]||0)>59)throw new Error('시간 형식 오류: HH:mm:ss');
  return +m[1]*3600 + +m[2]*60 + +(m[3]||0);
}
export const hhmm=v=>v?String(v).slice(0,5):'';
export function normalizeTime(v){const n=seconds(v);return n===null?null:`${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function unionLength(intervals){
  const sorted=intervals.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);let total=0,end=-Infinity;
  for(const [a,b] of sorted){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;
}
export function judge(r,rules=RULES,now=new Date()){
  const issues=[],labels=[],suggestions={};const add=(code,text)=>issues.push({code,text});
  const actualEntry=Object.hasOwn(r,'rawEntry')?r.rawEntry:r.entry;
  let entry,exit;try{entry=seconds(actualEntry);exit=seconds(r.exit);}catch{add('INVALID_TIME','시간을 해석하지 못했습니다.');return{labels:['판독 확인'],issues,suggestions,canApply:false,minutes:null};}
  const start=seconds(rules.start),end=seconds(rules.end),lunchA=seconds(rules.lunchStart),lunchB=seconds(rules.lunchEnd);
  if(r.schedule!==`${rules.start} ~ ${rules.end}`)add('SCHEDULE','강의시간과 적용 기준이 다릅니다.');
  if(r.source!=='live')add('SNAPSHOT','저장본입니다. 체크히어에서 다시 수집해야 합니다.');
  if(r.readState!=='complete')add('INCOMPLETE','메모 또는 외출 구간을 모두 읽지 못했습니다.');
  const recognized=r.reference?.status==='인정출석',absent=r.reference?.status==='결석';
  const korea=now.toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}),ongoing=r.date===korea.slice(0,10)&&seconds(korea.slice(11,19))<end&&exit===null&&!recognized&&!absent;
  const periodMismatch=Object.hasOwn(r,'rawEntry')&&r.rawEntry!==r.entry;
  if(periodMismatch&&!ongoing)add('PERIOD_MISMATCH','실제 입실과 교시 기록이 다릅니다. 교시 타각·집계 상태를 확인해 주세요.');
  if(r.reference?.historical)add('REFERENCE_OLD','시트 대조값이 과거 저장본입니다. 현재 시트를 확인해 주세요.');
  if(recognized){labels.push(r.reference?.historical?'인정출석 · 과거 시트':'인정출석');if(entry===null||exit===null)add('RECOGNIZED_TIME','인정출석의 입·퇴실 시간이 없습니다.');
    for(const [field,label] of (r.exception?[]:[['entryMemo','입실·교시'],['exitMemo','퇴실']])){
      if(r[field]!==null&&r[field]!==undefined&&(!/^\(인정(?:출석|지각|조퇴|외출)\).+_담임:/.test(r[field])||!r[field].includes(`담임:${r.teacher}`)))add('RECOGNIZED_MEMO',`${label} 인정 유형·상세 사유·담임 양식을 확인해 주세요.`);
    }
  }
  if(ongoing){labels.push('진행중');if(entry===null)add('ENTRY_PENDING','오늘 입실 기록이 아직 없습니다.');}
  else if(entry===null&&exit===null){labels.push(absent?'결석':'미타각 · 결석 확인');if(!absent&&!recognized)add('NO_TIMES','입·퇴실 공란: 시트에서 결석 여부를 확인해야 합니다.');}
  else if(entry===null||exit===null){labels.push('타각 누락');add('MISSING_TIME','입실 또는 퇴실 시간이 없습니다.');}
  if(entry!==null&&exit!==null&&exit<entry)add('REVERSED_TIME','퇴실이 입실보다 빠릅니다.');
  const late=entry!==null&&entry>=start+(rules.entryGrace+1)*60,early=exit!==null&&exit<end-rules.exitGrace*60;
  if(entry!==null&&entry>start+rules.entryGrace*60&&entry<start+(rules.entryGrace+1)*60)add('SECONDS_BOUNDARY','09:10의 초 단위 경계입니다. 초 처리 기준을 확인해 주세요.');
  const trips=r.outings||[],hasOut=trips.length>0||r.outingCount>0;
  if(!recognized){if(late)labels.push('지각');if(early)labels.push('조퇴');if(hasOut)labels.push('외출');}
  const multiple=[late,early,hasOut].filter(Boolean).length>1;
  if(multiple&&!r.exception)add('MULTIPLE','중복 출결: 자동 반영에서 제외합니다.');
  if(absent&&(entry!==null||exit!==null))add('ABSENCE_CONFLICT','시트 결석인데 체크히어 시간이 있습니다.');
  if(r.reference?.status==='외출'&&!hasOut)add('NO_OUTING',`${r.classId}반-${r.date}-${r.name}-외출시간없음`);
  if(!recognized&&/인정/.test(`${r.entryMemo||''} ${r.exitMemo||''}`))add('RECOGNITION_CHECK','인정 메모가 있습니다. 시트의 인정출석 여부를 확인해 주세요.');
  const teacher=r.teacher||'',memo=(type,t)=>`${type}_담임:${teacher}(${t})`;
  if(!teacher&&(late||early||hasOut||recognized))add('TEACHER','강의명에서 담임 정보를 확인하지 못했습니다. 메모의 담임 확인이 필요합니다.');
  function checkMemo(type,field,time){
    const value=r[field];if(value===null||value===undefined)return;
    const expected=memo(type,time);if(teacher)suggestions[field]=expected;
    if(!value.trim())add('MEMO_MISSING',`${type} 관리자 메모가 없습니다.`);
    else if(!value.includes(type)||!value.includes(`담임:${teacher}`)||!value.includes(`(${time})`))add('MEMO_MISMATCH',`${type} 메모의 유형·담임·시간을 확인해 주세요.`);
  }
  if(!recognized&&!multiple&&!r.exception){if(late)checkMemo('지각','entryMemo',hhmm(actualEntry));if(early)checkMemo('조퇴','exitMemo',hhmm(r.exit));}
  if(!recognized&&!r.exception){
    const allMemo=`${r.entryMemo||''} ${r.exitMemo||''}`;
    if(!late&&/지각_담임/.test(allMemo))add('MEMO_STATUS','지각 메모와 실제 입실시간이 다릅니다.');
    if(!early&&/조퇴_담임/.test(allMemo))add('MEMO_STATUS','조퇴 메모와 실제 퇴실시간이 다릅니다.');
    if(!hasOut&&/외출_담임/.test(allMemo)&&r.readState==='complete')add('MEMO_STATUS','외출 메모가 있지만 체크히어 외출 구간이 없습니다.');
  }
  for(const t of trips)if(!t.start||!t.end||t.recognized===null)add('OUTING_INCOMPLETE','외출 시작·종료 또는 인정 여부가 불명확합니다.');
  if(hasOut&&!recognized&&!multiple&&!r.exception&&trips.length===1&&trips[0].start&&trips[0].end)checkMemo('외출','entryMemo',`${hhmm(trips[0].start)}~${hhmm(trips[0].end)}`);
  if(trips.length>1)add('MULTI_OUTING','외출이 여러 구간입니다. 모든 구간의 사유를 확인해 주세요.');
  let minutes=null;
  if(entry!==null&&exit!==null&&exit>=entry){
    const a=Math.max(start,entry),b=Math.min(end,exit),spans=[[lunchA,lunchB]];
    for(const t of trips){try{const x=seconds(t.start),y=seconds(t.end);if(x!==null&&y!==null){if(y<x)add('OUTING_REVERSED','외출 종료가 시작보다 빠릅니다.');else spans.push([x,y]);}}catch{add('OUTING_TIME','외출 시간을 해석하지 못했습니다.');}}
    minutes=Math.max(0,(b-a-unionLength(spans.map(([x,y])=>[Math.max(x,a),Math.min(y,b)])))/60);
    const total=(end-start-unionLength([[Math.max(start,lunchA),Math.min(end,lunchB)]]))/60;
    if(!recognized&&minutes<total*.5){add(minutes>=total*.5-rules.entryGrace-rules.exitGrace?'MINIMUM_BOUNDARY':'MINIMUM','실제 참여가 50% 미만입니다. 유예·인정 시간을 포함한 결석 기준을 확인해 주세요.');}
  }
  if(!labels.length)labels.push(issues.length?'출석 · 확인 필요':'출석');
  if(!recognized&&r.reference?.status&&r.reference.status!=='결석'&&!r.reference.historical&&r.reference.status!=='출석'&&!labels.includes(r.reference.status))add('SHEET_CONFLICT','시트 상태와 체크히어 시간 판정이 다릅니다.');
  const canApplyMemo=r.source==='live'&&r.readState==='complete'&&!!teacher&&!ongoing&&!periodMismatch&&!r.exception&&!issues.some(i=>['SCHEDULE','INVALID_TIME','OUTING_REVERSED','REVERSED_TIME'].includes(i.code));
  return{labels,issues,suggestions,ongoing,periodMismatch,exception:r.exception||null,minutes:minutes===null?null:Math.round(minutes*100)/100,canApply:canApplyMemo&&!multiple,canApplyMemo,ruleVersion:rules.version};
}
// 체크히어 시간 삭제를 할 수 있는 연결 프로그램이 알리는 능력(11단계 전에는 아무도 알리지 않음).
export const TIME_DELETE_CAPABILITY='time-delete-v1';
// 지울 수 있는 칸인지(기록 번호가 있는 칸만, 사용자 결정 2026-10-14). 지울 수 있으면 '', 아니면 이유. 표시는 연결 프로그램이 그날 화면 데이터에서 붙입니다(day-data.mjs DELETE_MARKS):
// exitEventId 퇴실(COMPLETE) 번호, entryKind 'ATTEND'(관리자 1교시)·'PASS'(입실에서 계산), entryEventId 1교시 번호, enterEventId 입실(ENTER) 번호.
// 체크인한 학생(입실 번호 있음)은 1교시에 사유를 저장해 ATTEND가 되었어도 퇴실만 지웁니다(그 1교시 삭제는 확인하지 않은 동작). 표시가 없으면 잠급니다.
// 사용자 결정 2026-10-15: 관리자 1교시(ATTEND) 삭제는 실제 체크히어에서 확인하지 않아 막음. 확인 뒤 켬, 그때까지 퇴실만 지웁니다(docs/checkhere-time-delete-enable.md 4절 끝).
export const ATTEND_DELETE=false;
// attend: 시험에서만 넘깁니다. 운영 호출은 넘기지 않아 위 스위치를 따릅니다.
export function timeDeleteRefusal(record,side,{attend=ATTEND_DELETE}={}){
  if(side==='exit')return record?.exitEventId?'':'퇴실 기록 번호를 확인하지 못했습니다(다시 수집 필요).';
  if(record?.entryKind==='PASS')return '입실에서 계산된 1교시는 지울 수 없습니다. 퇴실을 지우면 함께 비워집니다.';
  if(record?.enterEventId)return '체크인한 학생은 퇴실만 지웁니다(1교시는 관리자 사유를 저장한 기록이라 남깁니다).';
  if(!(record?.entryKind==='ATTEND'&&record.entryEventId&&record.enterEventId===false))return '1교시 기록 번호를 확인하지 못했습니다(다시 수집 필요).';
  return attend?'':'관리자가 넣은 1교시 삭제는 실제 체크히어에서 확인한 뒤 엽니다(지금은 퇴실만 지웁니다).';
}
// Human-reviewed memo edits may describe overlapping attendance without changing its times.
// deletions: 승인된 시간 삭제 요청이 지우는 쪽. 비우는 시간 칸은 이것과 정확히 같아야 하고, 능력 검사는 삭제할 때만 합니다.
export function assertChangeAllowed(record,changes,{capabilities,requested=false,deletions=[]}={}){
  const fields=Object.keys(changes||{}),memoOnly=fields.length>0&&fields.every(k=>['entryMemo','exitMemo'].includes(k)),del=deletions||[];
  if(!fields.length||fields.some(k=>!['entry','exit','entryMemo','exitMemo'].includes(k)))throw Error('변경할 항목을 확인해 주세요.');
  const blanks=['entry','exit'].filter(k=>Object.hasOwn(changes,k)&&!normalizeTime(changes[k]));
  if(blanks.some(k=>!del.includes(k)))throw Error('시간을 비우는 변경은 「시간 삭제」 요청으로만 처리합니다.');
  if(del.some(k=>!blanks.includes(k)))throw Error('삭제할 시간 항목을 확인해 주세요.');
  if(del.length&&!requested)throw Error('시간 삭제는 승인된 「시간 삭제」 요청으로만 처리합니다.');
  if(del.length&&capabilities&&!capabilities.includes(TIME_DELETE_CAPABILITY))throw Error('수집 PC에서 최신 체크히어 시작.cmd를 다시 실행해 주세요. 체크히어 시간 삭제 지원이 필요합니다.');
  if(del.some(k=>Object.hasOwn(changes,k+'Memo')&&changes[k+'Memo']!==''))throw Error('삭제하는 시간의 관리자 사유는 비워 주세요.');
  // 사용자 결정(2026-10-14): 기록 번호가 있는 칸만 지웁니다(PASS 1교시·입실은 지우지 않음).
  for(const k of del){const why=timeDeleteRefusal(record,k);if(why)throw Error(why);}
  const judgement=judge(record);
  if(requested){
    if(record.source!=='live'||record.readState!=='complete')throw Error('학생의 현재 기록을 읽지 못했습니다. 연결 상태를 확인해 주세요.');
    const target={...record,...changes},entry=normalizeTime(target.entry),exit=normalizeTime(target.exit);
    const needs=side=>!del.includes(side)&&fields.some(k=>k===side||k===side+'Memo');
    if((needs('entry')&&!entry)||(needs('exit')&&!exit)||(entry&&exit&&exit<entry))throw Error('반영할 입실·퇴실 시간을 확인해 주세요. 변경하는 항목에는 시간이 필요합니다.');
    // 삭제 경고: 체크인한 학생(PASS)의 퇴실을 지우면 1교시·총 참여 시간도 비고(Cowork 확인), 관리자 1교시를 지우면 그것에서 계산된 입실도 빌 수 있습니다.
    const side=(del.includes('exit')&&record.entryKind==='PASS'?' 퇴실을 지우면 1교시·총 참여 시간도 비워집니다.':'')+(del.includes('entry')?' 관리자가 넣은 1교시를 지우면 그것에서 계산된 입실도 비워질 수 있습니다.':'');
    return{...judgement,memoOnly,warning:del.length?'체크히어 입실(교시)/퇴실 시간을 삭제합니다. 실제 입실 기록은 남을 수 있습니다.'+side:memoOnly?'사유만 변경하며 입퇴실 시간은 유지합니다.':''};
  }
  if(!(memoOnly?judgement.canApplyMemo:judgement.canApply)){
    if(!memoOnly&&judgement.canApplyMemo)throw Error('지각·조퇴·외출이 겹친 기록은 시간을 자동 변경할 수 없습니다. 사유만 변경요청할 수 있습니다.');
    throw Error('진행중·교시 불일치 또는 수집 정보 확인이 필요합니다. 재수집 후 요청해 주세요.');
  }
  const warning=memoOnly&&!judgement.canApply?'지각·조퇴·외출이 겹친 기록입니다. 사유만 변경하며 입퇴실 시간은 유지합니다.':'';
  if(warning&&capabilities&&!capabilities.includes('memo-only-requests-v1'))throw Error('수집 PC에서 최신 체크히어 시작.cmd를 다시 실행해 주세요. 중복 출결의 사유 변경 지원이 필요합니다.');
  return{...judgement,memoOnly,warning};
}
