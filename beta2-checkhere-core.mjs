// 2기 베타 출결대조 → 체크히어 반영 요청: 시트 값 하나를 체크히어 변경 하나로 바꾸는 순수 함수(화면·Firestore 없음).
// 설계: docs/beta2-instant-edit-plan.md 3장(대응표)·4.1. 사용자 결정(2026-10-14): 시간 정책은 '메모만'(memo-only),
// 체크히어 쓰기는 수정창 버튼, 삭제는 기록 번호(eventId)가 있는 칸만.
// 사용자 결정(2026-10-16): 요청은 만들기만 하고 승인 대기로 남습니다. 체크히어 쓰기는 사람이 운영 포털 「반영 요청·승인」에서 승인할 때만(중계는 읽기 전용).
// 사용자 결정(2026-10-16): 삭제는 1교시(09~18 칸)·퇴실 두 칸이 깨끗이 비면 됨(입실 기록은 남아도 됨). 두 칸 삭제는 time-delete-v2 연결 프로그램만(퇴실 → 1교시 순서, 다시 읽어 확인).
// 요청은 가린 화면에서도 만들고(승인 대기), 반영할 때만 사람이 수집 PC 체크히어 탭에서 마스킹을 해제합니다(중계 신호 privacy로 보임).
import {memoDefaultTimes} from './checkhere/approval-core.mjs';
import {TIME_DELETE_V2_CAPABILITY,normalizeTime,privacyState,timeDeleteRefusal} from './checkhere/rules.mjs';
import {ACTIVE,AUTO_TEXT,isAutoLedgerRequest,isLiveRequest,stamp} from './checkhere-live-core.mjs';
import {reasonCategory} from './checkhere-proposal-core.mjs';

export const STATUS_MEMO=/^\s*(?:\(\s*인정(?:출석|지각|조퇴|외출)\s*\)|(?:지각|조퇴|외출)_담임:)/;
const PLAIN_STATUS_MEMO=/^\s*(?:지각|조퇴|외출)_담임:/;
export const RELAY_STALE_MS=3*60*1000;          // 중계 신호가 이보다 오래되면 '중계 꺼짐'
export const REQUEST_DATE_RANGE={from:'2026-07-27',to:'2026-10-22'}; // checkhere/approval-core.mjs cleanRequest, firestore.rules와 같아야 함
export {AUTO_TEXT,isAutoLedgerRequest}; // 1기 재처리 제외도 쓰므로 checkhere-live-core.mjs에 둡니다.
export const TIME_DELETE_CAPABILITY='time-delete-v1';
export {TIME_DELETE_V2_CAPABILITY};
// 관리자 1교시(ATTEND) 삭제는 두 칸 삭제(퇴실 먼저, 다시 읽은 1교시 번호로)를 아는 연결 프로그램에서만 엽니다. 옛 연결 프로그램(v1만)이면 지금처럼 퇴실만 지웁니다.
export const V2_NEEDED=`1교시 삭제는 수집 PC 프로그램 업데이트 후 가능 (${TIME_DELETE_V2_CAPABILITY})`;
// 가린 화면에서 만든 요청의 확인창에 덧붙이는 말(요청은 만들고 승인 대기, 반영할 때 사람이 해제).
export const UNMASK_ON_APPLY='반영할 때 체크히어 마스킹 해제 필요';
export const holdKey=(cls,date,name)=>`${cls}|${date}|${name}`;
// 메모에 넣을 담임 이름: 비어 있지 않고 메모 형식을 깨는 글자가 없어야 합니다.
export const validTeacher=v=>{const s=String(v??'').trim();return !!s&&!/[\n_():[\]]/.test(s);};

const H=v=>{try{return normalizeTime(v)?.slice(0,5)||'';}catch{return '';}};
const has=(record,k)=>!!H(record?.[k]);
const base=type=>String(type||'').replace(/^인정/,'');
const recognized=type=>/^인정(출석|지각|조퇴|외출)$/.test(String(type||''));

// 보낼 폼은 네 칸을 모두 채웁니다(빠진 메모 칸은 buildLiveRequest가 '비움'으로 읽음).
export function liveForm(record,changes){
  const pick=k=>changes[k]??(k==='entry'||k==='exit'?H(record[k])?normalizeTime(record[k]):'':record[k]??'');
  return {entry:pick('entry'),exit:pick('exit'),entryMemo:pick('entryMemo'),exitMemo:pick('exitMemo')};
}

// 저장 전·후 행 비교: 'checkhere'(유형·그 유형이 쓰는 시간·인정 유형 사유가 바뀜) | 'sheet-only'(증빙·인정 아닌 유형의 사유만) | 'none'
export function checkhereChangeKind(prev,row){
  const p=prev||{type:'출석'},r=row||{type:'출석'},t=r.type||'출석';
  if((p.type||'출석')!==t)return 'checkhere';
  const used={지각:['inT'],조퇴:['outT'],외출:['oa','ob']}[base(t)]||[];
  if(used.some(k=>String(p[k]||'')!==String(r[k]||'')))return 'checkhere';
  const reasonChanged=String(p.reason||'').trim()!==String(r.reason||'').trim();
  if(reasonChanged&&recognized(t))return 'checkhere';
  if(reasonChanged||String(p.ev||'')!==String(r.ev||'')||String(p.evr||'')!==String(r.evr||''))return 'sheet-only';
  return 'none';
}

// 체크히어에서 지울 수 있는 칸인지(기록 번호가 있는 칸만, 사용자 결정 2026-10-14). 규칙은 연결 프로그램·운영 포털과 같은 rules.mjs timeDeleteRefusal:
// record.exitEventId 퇴실(COMPLETE) 번호 / record.entryKind 'ATTEND'(관리자가 넣은 1교시)·'PASS'(입실에서 계산된 값) / record.entryEventId / record.enterEventId 입실 번호(체크인한 학생)
// v2 = 중계 신호에 time-delete-v2(아니면 1교시는 잠금), withExit = 같은 요청이 퇴실도 지움(퇴실이 남아 있으면 체크히어가 퇴실 시간으로 1교시를 다시 채워 1교시만은 못 지움).
export function canDeleteTime(record,side,{v2=false,withExit=false}={}){
  if(!has(record,side))return {ok:false,reason:'지울 시간이 없습니다.'};
  // 체크인했지만 아직 퇴실이 없는 학생: 지울 수 있는 칸이 없습니다(퇴실을 지우면 비워진다는 안내는 맞지 않음).
  if(side==='entry'&&record.entryKind==='PASS'&&!has(record,'exit'))return {ok:false,reason:'퇴실 시간이 아직 없어 지울 수 있는 칸이 없습니다(1교시는 입실에서 계산된 값).'};
  // 이유 순서: 기록 자체의 문제(번호 없음·PASS — 업데이트로 풀리지 않음) → 옛 연결 프로그램(v1)이면 업데이트 안내 → 퇴실이 남은 1교시만(퇴실과 함께 지우라는 안내는 v2에서만 따를 수 있음).
  const why=timeDeleteRefusal(record,side,{withExit:true})||(side==='entry'&&!v2?V2_NEEDED:'')||timeDeleteRefusal(record,side,{withExit});
  return why?{ok:false,reason:why}:{ok:true};
}
// 지울 때 남는 것(확인창·경고, 2026-10-16 실제 체크히어에서 확인): 1교시를 지우면(퇴실과 함께, 퇴실 먼저) 1교시·퇴실 칸은 비고 입실 기록은 남을 수 있습니다.
// 퇴실만 지우면 입실은 남고, 관리자가 넣은 1교시도 남습니다(체크인한 학생의 계산된 1교시는 함께 비워짐 → 확인창이 따로 알림).
export const deleteLeaves=(sides,record=null)=>sides.includes('entry')?'1교시·퇴실 칸은 비워지고 체크히어 입실 기록은 남을 수 있습니다':record?.entryKind==='ATTEND'?'관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다':'체크히어 실제 입실 기록은 남습니다';

// 시간 삭제 요청을 만들 수 있는지. features = settings/checkhereFeatures, relay = settings/checkhereRelay, denied = 이 세션에서 permission-denied를 봄
// 켜져도 삭제 요청은 승인 대기로 남고, 사람이 운영 포털 「반영 요청·승인」에서 한 건씩 승인해야 지워집니다(일괄 승인에서 빠짐).
// 중계는 읽기 전용이지만 연결 프로그램 능력(time-delete-v1·v2)을 /beta2에 알리는 유일한 통로라, 작동 중인 중계 신호를 그대로 봅니다.
// v2: 두 칸 삭제(1교시 포함)를 아는 연결 프로그램. 체크히어 가림(privacy)은 막지 않습니다(요청은 승인 대기, 반영할 때 해제).
export function deletionGate({features=null,relay=null,denied=false,now=Date.now()}={}){
  const reasons=[];
  if(features?.timeDeleteRules!==true)reasons.push('Firestore 규칙 게시 필요');
  // at은 Firestore Timestamp(또는 시험의 밀리초 숫자). 멈춤 신호(state:'stopped')는 최근이어도 꺼짐입니다(능력을 확인할 수 없음).
  const at=typeof relay?.at==='number'?relay.at:stamp(relay?.at),fresh=relay?.state==='running'&&at>0&&now-at<=RELAY_STALE_MS;
  if(!fresh)reasons.push('수집 PC 중계가 꺼져 있습니다');
  else if(!(relay.capabilities||[]).includes(TIME_DELETE_CAPABILITY))reasons.push(`수집 PC 프로그램 업데이트 필요 (${TIME_DELETE_CAPABILITY})`);
  // 가린 동안에도 삭제 요청은 만듭니다(승인 대기, 사용자 결정 2026-10-16: 반영할 때만 사람이 해제). 가림에 막힌 승인 쓰기 수(needsUnmask)는 도구줄에만 보입니다.
  if(denied)reasons.push('시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다');
  return {enabled:!reasons.length,reasons,v2:fresh&&(relay.capabilities||[]).includes(TIME_DELETE_V2_CAPABILITY)};
}
// 중계 신호의 needsUnmask(승인한 반영 중 가림에 막힌 수, 연결 프로그램이 셈, 이름 없음) → 알림 글. 없으면 ''.
export const unmaskNote=relay=>Number(relay?.needsUnmask)>0?'체크히어 해제 필요':'';
// 중계 신호의 체크히어 해제 상태(privacy {state,leftSec,writable}, 연결 프로그램이 셈, 이름 없음) → rules.mjs privacyState. 신호는 1분에 한 번이라
// 남은 시간은 신호 뒤 지난 만큼 뺍니다. 중계가 꺼졌거나 옛 중계(privacy 없음)면 null.
export function relayPrivacy(relay,now=Date.now()){
  const p=relay?.privacy,at=typeof relay?.at==='number'?relay.at:stamp(relay?.at);
  if(!p||typeof p!=='object'||relay.state!=='running'||!(at>0)||now-at>RELAY_STALE_MS)return null;
  return privacyState({state:p.state,leftSec:Number.isFinite(p.leftSec)?Math.max(0,Math.floor(p.leftSec-Math.max(0,now-at)/1000)):null});
}
// 도구줄 중계 표시에 붙일 짧은 해제 상태(전체 글 privacyState().text는 title에).
export const privacyShort=p=>!p||p.state==='unknown'?'':p.state==='masked'?'체크히어 가림 · 읽기만':p.writable?`체크히어 해제됨 · ${Math.floor(p.leftSec/60)}분 남음`:'체크히어 해제 시간 부족 · 연장 필요';

/* 3장 대응표. row = 방금 b2Save에 보낸 값 {type, reason, inT, outT, oa, ob}, record = 그 학생의 최신 체크히어 기록,
 * sheetTeacher = 반정보 담임, active = 이 학생의 체크히어 요청들, me = 지금 사용자 이메일.
 * → {state:'send'|'same'|'hold'|'none'|'manual', changes, deleteTimes, text, notes, warnings, retryWhen, withdraw} */
export function sheetToCheckHere({row,record,sheetTeacher='',date='',deleteEnabled=false,deleteV2=false,active=[],me=''}){
  const out={state:'hold',changes:{},deleteTimes:[],text:'',notes:[],warnings:[],withdraw:[]};
  const hold=(note,retryWhen)=>({...out,state:'hold',changes:{},deleteTimes:[],notes:[note],...(retryWhen?{retryWhen}:{})});
  const type=String(row?.type||'출석'),reason=String(row?.reason||'').trim();
  // P0 날짜 범위(규칙·cleanRequest와 같음). 시트 저장은 그대로입니다.
  if(!date||date<REQUEST_DATE_RANGE.from||date>REQUEST_DATE_RANGE.to)return hold('규칙 날짜 범위 밖 · 넓히려면 사용자 확인 필요');
  // P1·P2
  if(!record)return {...out,state:'none',notes:['체크히어 기록 없음 · 이름 연결 확인']};
  if(record.source!=='live'||record.readState!=='complete'||!record.id||!record.version)return hold('체크히어 상세 수집 대기','record');
  // P4 진행 중 요청: 내가 만든 대기 중 자동 요청만 있으면 취소하고 계속, 그 밖에는 기다림
  const running=(active||[]).filter(r=>ACTIVE.includes(r.status));
  if(running.length){
    const mine=running.every(r=>r.status==='pending'&&r.createdBy===me&&isLiveRequest(r)&&isAutoLedgerRequest(r));
    // 끝나면 다시 계산해 새 요청을 만듭니다(체크히어 쓰기는 그 요청을 사람이 승인할 때).
    if(!mine)return hold('진행 중 요청이 끝나면 다시 계산해 요청','request');
    out.withdraw=running.map(r=>r.id);
  }
  if(!['출석','지각','조퇴','외출','결석','인정출석','인정지각','인정조퇴','인정외출'].includes(type))return {...out,state:'manual',notes:['중복 출결 · 개별 검토 필요']};
  // P3 담임: 체크히어 강의의 담임 이름이 우선(judge()가 메모의 담임을 그것과 비교함)
  const T=validTeacher(record.teacher)?String(record.teacher).trim():validTeacher(sheetTeacher)?String(sheetTeacher).trim():'';
  if(!T)return hold('담임 이름 확인');
  if(validTeacher(record.teacher)&&validTeacher(sheetTeacher)&&String(record.teacher).trim()!==String(sheetTeacher).trim())out.warnings.push(`담임 이름 다름 · 메모에는 체크히어 강의 담임(${T})을 씁니다`);
  // P5 강의시간이 다르면 시간은 바꾸지 않습니다.
  const timesAllowed=record.schedule==='09:00 ~ 18:00';
  const changes={};
  const setTime=(k,hm)=>{if(!timesAllowed){out.warnings.push('강의시간이 09:00 ~ 18:00이 아니라 시간은 바꾸지 않습니다');return;}if(H(record[k])!==hm)changes[k]=hm+':00';};
  const setMemo=(k,text)=>{if(text!==(record[k]??''))changes[k]=text;};
  const clearStale=k=>{if(PLAIN_STATUS_MEMO.test(String(record[k]||'')))changes[k]='';};
  const inT=H(row.inT),outT=H(row.outT),oa=H(row.oa),ob=H(row.ob);
  const cat=recognized(type)?reasonCategory(reason):'';
  if(recognized(type)&&!cat)return hold('인정 사유를 하나로 확인하지 못했습니다 · 체크히어 맞추기로 직접 확인');
  switch(type){
    case '출석':
      setMemo('entryMemo','');setMemo('exitMemo','');break;
    case '지각':
      if(!inT||inT<='09:10')return hold('지각 입실 시간이 09:10 이후가 아닙니다');
      setTime('entry',inT);setMemo('entryMemo',`지각_담임:${T}(${inT})`);clearStale('exitMemo');
      if(H(record.rawEntry)&&H(record.rawEntry)!==inT)out.warnings.push('실제 입실과 다름 · 교시 기록만 바뀝니다');
      break;
    case '조퇴':
      if(!outT||outT>='17:50')return hold('조퇴 퇴실 시간이 17:50 전이 아닙니다');
      setTime('exit',outT);setMemo('exitMemo',`조퇴_담임:${T}(${outT})`);clearStale('entryMemo');break;
    case '외출':
      if(!oa||!ob||ob<=oa)return hold('외출 시작·종료 시간을 확인해 주세요');
      if(!has(record,'entry'))return hold('입실 시간이 없어 외출 사유를 넣을 수 없습니다');
      setMemo('entryMemo',`외출_담임:${T}(${oa}~${ob})`);clearStale('exitMemo');
      if((record.outings||[]).filter(o=>H(o.start)===oa&&H(o.end)===ob).length!==1)out.warnings.push('체크히어에 같은 외출 구간이 하나로 확인되지 않습니다');
      break;
    case '결석':{
      const sides=['entry','exit'].filter(k=>has(record,k));
      if(!sides.length)return {...out,state:'none',notes:['체크히어 입·퇴실 시간 없음']};
      if(!deleteEnabled)return hold('체크히어 시간 삭제는 Firestore 규칙 게시·수집 PC 업데이트 후 가능');
      // 체크인한 학생: 지울 수 있는 것은 퇴실뿐이고, 퇴실을 지우면 계산된 1교시도 비워집니다. 입실(실제 입실)은 남습니다.
      // 관리자 1교시(ATTEND): v2 연결 프로그램이면 퇴실과 함께 두 칸을 지웁니다(연결 프로그램이 퇴실 먼저). v1뿐이면 보류(예전 동작).
      const withExit=sides.includes('exit')&&canDeleteTime(record,'exit').ok,del=sides.filter(k=>canDeleteTime(record,k,{v2:deleteV2,withExit:k==='entry'&&withExit}).ok);
      const left=sides.filter(k=>!del.includes(k)&&!(k==='entry'&&record.entryKind==='PASS'&&del.includes('exit')));
      // 퇴실을 못 지우면 그게 먼저인 이유. 1교시만 못 지우면 퇴실도 남기므로(일부 삭제 없음) 그렇게 알립니다('퇴실만 지웁니다'를 지웠다로 읽지 않게).
      if(left.length){const why=canDeleteTime(record,left.includes('exit')?'exit':left[0],{v2:deleteV2,withExit}).reason;return hold(del.includes('exit')?why+' · 퇴실도 그대로 둡니다(퇴실만 지우려면 ×)':why);}
      for(const k of del)changes[k]='';
      out.deleteTimes=['entry','exit'].filter(k=>del.includes(k));
      out.warnings.push(deleteLeaves(out.deleteTimes,record));
      break;
    }
    default:{
      // 인정 유형: 메모만(사용자 결정 memo-only). 학생이 찍지 않은 시간은 만들지 않습니다.
      const k=base(type)==='조퇴'?'exit':'entry',other=k==='entry'?'exit':'entry';
      const tail=base(type)==='지각'?(inT?`(${inT})`:''):base(type)==='조퇴'?(outT?`(${outT})`:''):base(type)==='외출'?(oa&&ob?`(${oa}~${ob})`:''):'';
      if(base(type)==='지각'&&!inT)return hold('인정지각 입실 시간을 넣어 주세요');
      if(base(type)==='조퇴'&&!outT)return hold('인정조퇴 퇴실 시간을 넣어 주세요');
      if(base(type)==='외출'&&(!oa||!ob||ob<=oa))return hold('인정외출 시작·종료 시간을 확인해 주세요');
      setMemo(k+'Memo',`(${type})${cat}_담임:${T}${tail}`);clearStale(other+'Memo');
    }
  }
  // 짝 규칙: 체크히어에 시간이 없는 쪽에는 메모를 넣지 않습니다(넣으면 체크히어가 09:00/18:00을 스스로 채움).
  for(const side of ['entry','exit']){
    const mk=side+'Memo';
    if(!Object.hasOwn(changes,mk)||has(record,side)||Object.hasOwn(changes,side))continue;
    if(changes[mk]==='')delete changes[mk];
    else return hold(side==='entry'?'입실 시간이 없는 학생에게는 사유를 넣을 수 없습니다 · 체크히어 맞추기로 확인':'퇴실 시간이 없는 학생에게는 사유를 넣을 수 없습니다 · 수업 뒤 다시');
  }
  for(const k of ['entryMemo','exitMemo'])if(Object.hasOwn(changes,k)&&(/\[|\(00:00\)|_담임:\(/.test(changes[k])||changes[k].length>500))return hold('메모 형식 확인 필요');
  if(Object.keys(memoDefaultTimes(changes,record)).length)return hold('시간이 없는 쪽에는 사유를 넣을 수 없습니다');
  // 내 대기 중 자동 요청(withdraw)은 취소한 뒤의 결과입니다. 바꿀 것이 없으면 취소만 하고 끝납니다.
  if(!Object.keys(changes).length)return {...out,state:'same',notes:['체크히어 이미 같음']};
  const text=`${AUTO_TEXT} · ${type} · ${reason||'일반 출결'}`.slice(0,300).trim();
  return {...out,state:'send',changes,text};
}
