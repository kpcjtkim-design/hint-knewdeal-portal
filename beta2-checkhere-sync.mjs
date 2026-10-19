// 2기 출결대조 → 체크히어 반영 요청(브라우저 쪽 흐름). 출결원장 저장 3초 뒤 실시간 요청을 만들고, 되돌리기·보류·다시 계산을 맡습니다.
// 사용자 결정(2026-10-16): 만든 요청은 승인 대기로 남습니다. 체크히어 쓰기는 사람이 운영 포털 「반영 요청·승인」에서 승인할 때만(중계는 읽기 전용).
// 설계: docs/beta2-instant-edit-plan.md 4.2(S1~S15). 사용자 결정(2026-10-14): 오늘만 자동(지난 날은 '체크히어 맞추기'를 눌러 같은 3초 흐름),
// 3초 되돌리기는 출결원장과 요청을 모두 되돌림. 시간 삭제 요청(deleteTimes)은 켜지는 조건(G1 규칙 게시 깃발·G3 권한 거절 없음, 중계는 필요 없음 2026-10-16)이
// 모두 맞을 때만 씁니다(결석 저장과 × 버튼). 지우기는 기록 번호가 있는 칸만(canDeleteTime), 보내기 전 확인창 필수(S8).
// 1교시(관리자 ATTEND) 삭제는 v2일 때만(마지막 중계 신호에 time-delete-v2, 신호가 없으면 v2로 봄): 결석은 1교시·퇴실 두 칸, 1교시 ×는 퇴실이 비어 있을 때만(2026-10-16).
// 가린 화면(중계 신호 privacy)이거나 중계가 꺼져 해제 상태를 몰라도 요청은 만듭니다(승인 대기). 확인창에 '반영할 때 체크히어 마스킹 해제 필요'를 붙입니다.
// Firestore 함수(fs)·시계·타이머는 화면이 넘깁니다(출결대조는 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'에서 import한 함수).
// 이 파일은 https 주소를 import하지 않습니다(Node 시험). 2기는 운영총괄 동기화가 없어 되돌리기는 출결원장 저장(b2Save)만 씁니다.
import {memoDefaultTimes,resultText} from './checkhere/approval-core.mjs';
import {ACTIVE,LIVE_STATUS,buildLiveRequest,isAutoLedgerRequest,isLiveRequest,koreaClock,requestsFor,stamp} from './checkhere-live-core.mjs';
import {RELAY_STALE_MS,UNMASK_ON_APPLY,canDeleteTime,checkhereChangeKind,deleteLeaves,deletionGate,liveForm,needsUnmaskOnApply,privacyShort,relayPrivacy,sheetToCheckHere,unmaskNote} from './beta2-checkhere-core.mjs';
import {B2_EVIDENCE,B2_TYPES,neededTimes,recognizedType} from './beta2-core.mjs';

// firestore.rules checkhereRequests create 허용 키 중 요청 내용(나머지는 status·createdBy·createdAt·updatedAt).
// deleteTimes는 시간 삭제 요청에만, 비어 있지 않을 때만 넣습니다(2기 firestore.rules가 허용, 게시 전에는 권한 거절 → S13).
export const REQUEST_KEYS=['classId','date','name','phoneLast4','reason','changes'];
// × 버튼이 그 시간을 지울 수 없는 이유들(없으면 켬). gate = deletionGate 결과, type = 지금 출결원장 유형(초안 포함).
// 지각류는 입실, 조퇴류는 퇴실 시간을 출결원장이 요구하고(beta2.gs b2Validate_), 외출류·인정출석은 사유를 입실(1교시) 칸 메모에 씁니다
// (지우면 그 메모도 사라지고 시간이 없는 쪽에는 사유를 다시 넣을 수 없음). 그래서 그 칸은 유형을 먼저 바꿔야 합니다.
export const TYPE_FIRST='유형을 먼저 바꿔 주세요 (결석으로 바꾸면 지울 수 있는 시간을 함께 지웁니다)';
// 1교시 ×는 그 칸만 지우므로(퇴실 없이) 퇴실이 비어 있을 때만, 그리고 v2 연결 프로그램일 때만 켭니다(canDeleteTime).
export function timeDeleteBlock({gate:g,record,side,type='출석'}){
  const why=[...(g?.reasons||[])],can=canDeleteTime(record,side,{v2:!!g?.v2});
  if(!can.ok)why.push(can.reason);
  if((side==='entry'&&/^(?:인정)?(?:지각|외출)$|^인정출석$/.test(type))||(side==='exit'&&/^(인정)?조퇴$/.test(type)))why.push(TYPE_FIRST);
  return why;
}
// × 결정은 출결원장에서 다시 계산할 수 없어 '다시 보내기'를 두지 않고 ×를 다시 누르게 합니다.
const REMOVE_AGAIN='체크히어 시간을 지우려면 ×를 다시 눌러 주세요';
export const PENDING_SLOW_MS=90*1000,APPLYING_SLOW_MS=3*60*1000;
export const STATUS_ACTIONS={undo:'되돌리기',withdraw:'요청 취소',retry:'다시 보내기',suggest:'체크히어 맞추기'};
const ROW_KEYS=['type','inT','outT','oa','ob','reason','ev','evr'];
const FIELD={entry:'입실',exit:'퇴실',entryMemo:'입실 메모',exitMemo:'퇴실 메모'};
const parseKey=key=>{const [cls='',date='',...n]=String(key).split('|');return {cls,date,name:n.join('|')};};
const clone=v=>v==null?null:JSON.parse(JSON.stringify(v));
const pickRow=r=>({...Object.fromEntries(ROW_KEYS.map(k=>[k,String(r?.[k]??'')])),type:String(r?.type||'출석')});
// 서버 시각이 아직 없는(방금 쓴) 요청을 가장 새것으로 봅니다(requestsFor는 0으로 봐서 맨 뒤로 감).
const madeAt=r=>r?.createdAt?stamp(r.createdAt):Infinity;
const newestFirst=(a,b)=>{const x=madeAt(a),y=madeAt(b);return x===y?0:y>x?1:-1;};
export const changeText=changes=>Object.entries(changes||{}).map(([k,v])=>`${FIELD[k]||k} ${/Memo$/.test(k)?(v?`「${v}」`:'(비움)'):(v?String(v).slice(0,5):'(삭제)')}`).join(' · ');
// 요청의 변경이 기록에 보이는지(시간은 HH:MM까지만 비교)
const shows=(record,changes)=>!!record&&Object.entries(changes||{}).every(([k,v])=>/^(entry|exit)$/.test(k)?String(record[k]??'').slice(0,5)===String(v??'').slice(0,5):String(record[k]??'')===String(v??''));
const hhmm=v=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(v||''));return m?m[1].padStart(2,'0')+':'+m[2]:'';};
// 기록 버전 + 시간 삭제 표시(checkhere/day-data.mjs DELETE_MARKS와 같은 키). 표시는 버전에 들어가지 않아 다시 수집으로 붙어도 버전이 그대로입니다.
const MARK_KEYS=['entryKind','entryEventId','exitEventId','enterEventId'];
const verOf=r=>r?[r.version??'',...MARK_KEYS.map(k=>String(r[k]??''))].join('|'):null;
// S8 확인창: 지울 시간(HH:MM)과 남는 것. 체크인한 학생(1교시 PASS)은 퇴실을 지우면 1교시·총 참여 시간도 '-'가 됩니다(Cowork 확인).
const DEL_LABEL={entry:'입실(교시)',exit:'퇴실'};
// 그 칸의 관리자 사유도 기록과 함께 지워집니다. 1교시를 지우면 1교시·퇴실 칸이 비고 입실 기록은 남을 수 있습니다(deleteLeaves, 2026-10-16 확인).
// 보내는 것은 삭제 요청이고, 체크히어에서 지우는 것은 관리자가 운영 포털에서 한 건씩 승인할 때입니다. 가린 화면이거나 해제 상태를 모르면(중계 꺼짐·옛 중계) 그때 해제가 필요하다고 덧붙입니다(privacy).
const deleteQuestion=(name,date,record,sides,privacy=null)=>`${name} · ${date} 체크히어 시간 삭제를 요청합니다: ${sides.map(k=>`${DEL_LABEL[k]} ${hhmm(record?.[k])||'-'}`).join(' · ')}`
  +(sides.includes('exit')&&!sides.includes('entry')&&record?.entryKind==='PASS'&&hhmm(record?.entry)?`\n퇴실을 지우면 1교시(${hhmm(record.entry)})와 총 참여 시간도 비워집니다.`:'')
  +sides.filter(k=>String(record?.[k+'Memo']??'').trim()).map(k=>`\n${DEL_LABEL[k]} 칸의 관리자 사유(「${record[k+'Memo']}」)도 함께 지워집니다.`).join('')
  +`\n${deleteLeaves(sides,record)}.\n관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에서 지워집니다.${needsUnmaskOnApply(privacy)?`\n${UNMASK_ON_APPLY}.`:''}\n보낼까요?`;
// 되돌리기 저장(b2Save)이 받아 줄 이전 값인지(beta2.gs b2Validate_와 같은 기준). 못 받으면 그 이유 — 시트에 직접 적힌 '중복'·시간 없는 지각 같은 값은
// 출결원장에 다시 저장할 수 없으므로 되돌리기는 체크히어 반영만 취소합니다.
export function restoreBlock(p){
  if(!B2_TYPES.includes(p.type))return `이전 유형 '${p.type}'`;
  const need=neededTimes(p.type,{inT:'x',outT:'x',oa:'x',ob:'x'});
  if(['inT','outT','oa','ob'].some(k=>need[k]&&!hhmm(p[k])))return '이전 값에 필요한 시간이 없음';
  if(need.oa&&hhmm(p.ob)<=hhmm(p.oa))return '이전 외출 시간 확인 필요';
  if(recognizedType(p.type)&&!p.reason.trim())return '이전 인정 사유가 비어 있음';
  if(!B2_EVIDENCE.includes(p.ev)||(p.ev==='반려'&&!p.evr.trim()))return '이전 증빙 값 확인 필요';
  if(p.reason.length>300||p.evr.length>300)return '이전 사유가 300자를 넘음';
  return '';
}

/* 상태 칩: {kind,label,detail,actions,tone}. actions는 STATUS_ACTIONS의 키(화면 버튼). tone: wait·ok·warn·bad·muted
 * local = 이 학생의 보류 항목(보내기 전·저장 중·보내는 중·되돌리는 중·보류), request = 이 학생의 최신 실시간 요청,
 * target = 이 세션의 마지막 결과(at 있음) 또는 지금 시트·기록으로 계산한 결과(lazy). 진행 중 요청은 대조 결과보다 앞에 보입니다. */
const S=(kind,label,o={})=>({kind,label,detail:'',actions:[],tone:'wait',...o});
const HOLD=(note,o={})=>S('hold',`보류 · ${note}`,{tone:'warn',...o});
const CANCEL=(label,o={})=>S('cancelled',label,{tone:'warn',actions:['retry'],...o}); // 취소된 결정은 '다시 보내기'(지금 값으로 다시 계산)로 이어 갈 수 있습니다.
// 요청은 사람이 승인해야 체크히어에 쓰이므로 기다림은 '승인 대기', 반려도 사람이 한 것입니다(운영 포털 STATUS와 같은 말).
export function requestStatus(r,{now=Date.now(),me=''}={}){
  const label={pending:'승인 대기',approved:'승인됨 · 반영 대기',applying:'반영 중',verified:'완료',rejected:'반려',withdrawn:'취소',conflict:'원본 변경',partial:'일부 반영',failed:'반영 실패',unknown:'결과 미확인'}[r.status]||LIVE_STATUS[r.status]||String(r.status||'');
  const o={requestId:r.id};
  if(r.status==='pending')return S('pending',label,{...o,detail:r.createdAt&&now-stamp(r.createdAt)>PENDING_SLOW_MS?'관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에 반영됩니다(자동으로 쓰지 않음)':'',actions:me&&r.createdBy===me?['withdraw']:[]});
  if(r.status==='approved')return S('approved',label,o);
  if(r.status==='applying'){const t=stamp(r.updatedAt)||stamp(r.approvedAt)||stamp(r.createdAt);return t&&now-t>APPLYING_SLOW_MS?S('applying','반영 중 · 결과 확인 필요',{...o,detail:'결과 확인 필요 · 수집 PC에서 결과 확인',tone:'warn'}):S('applying',label,o);}
  if(r.status==='verified')return S('verified',label,{...o,detail:resultText(r.result?.message,r.result?.results),tone:'ok'}); // 시간 삭제 확인은 저장된 results로 붙임
  if(r.status==='withdrawn')return S('withdrawn',label,{...o,tone:'muted'});
  // × 요청(시간 삭제이고 출결대조 자동이 아님): '다시 보내기'는 출결원장으로 다시 계산할 뿐이라 두지 않고 ×를 다시 누르게 합니다.
  const removal=Array.isArray(r.deleteTimes)&&r.deleteTimes.length>0&&!isAutoLedgerRequest(r),retry=removal?[]:['retry'],more=d=>removal?[d,REMOVE_AGAIN].filter(Boolean).join(' · '):d;
  if(r.status==='rejected')return S('rejected',label,{...o,detail:more(r.reviewNote||''),actions:retry,tone:'warn'});
  return S(r.status||'unknown',label,{...o,detail:more(r.result?.message||''),actions:retry,tone:'bad'}); // conflict·partial·failed·unknown
}
// sheetToCheckHere 결과(보내지 않는 경우와 수동 제안)
export function resultStatus(res){
  const note=res?.notes?.[0]||'',detail=[...(res?.notes||[]).slice(1),...(res?.warnings||[])].join(' · ');
  if(res?.state==='send'||res?.withdraw?.length)return S('suggest',STATUS_ACTIONS.suggest,{actions:['suggest'],detail:[changeText(res.changes),...(res.withdraw?.length?['대기 중인 자동 요청 취소']:[]),...(res.warnings||[])].filter(Boolean).join(' · ')});
  if(res?.state==='same')return S('same','체크히어 이미 같음',{tone:'ok',detail});
  if(res?.state==='hold')return HOLD(note||'확인 필요',{detail});
  if(res?.state==='manual')return S('manual',note||'개별 검토 필요',{tone:'warn',detail});
  return S('none',note||'체크히어 기록 없음',{tone:'muted',detail});
}
function localStatus(h,now){
  if(h.phase==='countdown')return S('countdown',`보내기 전 ${Math.max(0,Math.ceil((h.deadline-now)/1000))}초 · 되돌리기`,{actions:['undo'],detail:h.detail||''});
  if(h.phase==='paused')return h.draft?S('paused','입력 중 · 체크히어 반영 대기',{actions:['undo'],detail:h.detail||''}):S('paused','저장 중 · 체크히어 반영 대기');
  if(h.phase==='sending')return S('sending','보내는 중');
  if(h.phase==='undoing')return S('undoing','되돌리는 중');
  return HOLD(h.note||'다시 계산 대기',{actions:h.mineBlocking?['withdraw']:[],detail:h.detail||''}); // waiting
}
// record = 지금 화면의 체크히어 기록(반영 완료 뒤 기록이 아직 새로 오지 않은 동안 '맞추기'가 깜빡이지 않게)
export function rowCheckHereStatus({local=null,request=null,target=null,now=Date.now(),me='',record=null}={}){
  if(local)return localStatus(local,now);
  if(!request)return target||S('idle','',{tone:'muted'});
  if(ACTIVE.includes(request.status)||target?.requestId===request.id)return requestStatus(request,{now,me});
  if(target&&!target.lazy&&(target.at??0)>=Math.max(madeAt(request),stamp(request.updatedAt)))return target;
  // 끝난 요청 뒤에 시트가 다시 달라졌으면 맞추기 버튼을 보입니다(실패류는 '다시 보내기'가 같은 일을 함).
  const applied=request.status==='verified'&&shows(record,request.changes);
  if(target?.lazy&&target.kind==='suggest'&&(request.status==='withdrawn'||applied))return target;
  return requestStatus(request,{now,me});
}

/* createCheckHereSync: 출결대조 한 화면에 하나. 키는 holdKey(cls,date,name)(S1).
 * 필요한 것: db, user(email), client(createBeta2Client: save·bundle), fs{doc,setDoc,onSnapshot,query,collection,where,serverTimestamp},
 * withdraw(id) (withdrawRequest(db,user,id)), getRecord(cls,date,name)(화면에 보이는 체크히어 기록), getSig(cls,date,name)(출결원장 행 지문, 없으면 ''),
 * getRow(cls,date,name)(지금 출결원장 값 {type,inT,outT,oa,ob,reason,ev,evr}, 없으면 null — 맞추기·다시 보내기·상태 계산),
 * hasDraft(cls,date,name)(행 안 초안 있음, 선택), teacherOf(cls), today()('YYYY-MM-DD', 한국 날짜), now(), setTimer, clearTimer, confirm, uuid, onChange(key|null), undoMs */
export function createCheckHereSync({db,user,client,fs,withdraw:withdrawById,getRecord,getSig,getRow=null,hasDraft=()=>false,teacherOf=()=>'',
  now=()=>Date.now(),today=()=>koreaClock(new Date(now())).date,setTimer=(f,ms)=>setTimeout(f,ms),clearTimer=id=>clearTimeout(id),
  confirm:ask=text=>globalThis.confirm(text),uuid=()=>globalThis.crypto.randomUUID(),onChange=()=>{},undoMs=3000}){
  const holds=new Map(),notes=new Map(),saving=new Set(),inflight=new Set(),me=String(user?.email||'');
  let day=null,requests=[],reqReady=false,reqError='',features=null,relayDoc=null,denied=false,disposed=false,frozen=false,unsubDay=null,unsubSettings=[],ticker=null;
  const emit=key=>{if(!disposed)try{onChange(key??null);}catch{}};
  const onDay=(cls,date)=>!!day&&cls===day.cls&&date===day.date;
  const sigOf=(cls,date,name)=>String(getSig(cls,date,name)??'');
  const gate=()=>deletionGate({features,relay:relayDoc,denied});
  // 결과 안내가 계산된 때의 삭제 조건(켜짐·v2). 바뀌면 그 안내를 버리고 다시 계산합니다.
  const gateMark=()=>{const g=gate();return g.enabled?(g.v2?'v2':'on'):'off';};
  const privacy=()=>relayPrivacy(relayDoc,now());
  const studentRequests=(cls,date,name)=>onDay(cls,date)?requestsFor({classId:cls,date,name,phoneLast4:getRecord(cls,date,name)?.phoneLast4||''},requests).sort(newestFirst):[];
  // S2 결정 시점 저장: 그때 화면에 보인 기록의 복사본으로 [기준:…]을 만듭니다.
  // manual = 되돌리기가 체크히어 요청만 취소(이 세션 저장을 이어받지 않은 맞추기), asked = 사람이 누른 맞추기·다시 보내기(오늘이 아니어도 보냄)
  function capture(key,{prevRow,row,sig,existedBefore=true,manual=false,asked=false}){
    const {cls,date,name}=parseKey(key),prev=existedBefore===false||!prevRow?pickRow({type:'출석'}):pickRow(prevRow);
    return {key,cls,date,name,prevRow:prev,row:pickRow(row),sig:String(sig??''),existedBefore:existedBefore!==false,keepSheet:manual?'':restoreBlock(prev),
      sheetTeacher:String(teacherOf(cls)||''),record:clone(getRecord(cls,date,name)),manual,asked,phase:'new',timer:null,deadline:0};
  }
  const compute=h=>h.remove?removeResult(h):sheetToCheckHere({row:h.row,record:h.record,sheetTeacher:h.sheetTeacher,date:h.date,deleteEnabled:gate().enabled,deleteV2:gate().v2,active:studentRequests(h.cls,h.date,h.name),me});
  // × 버튼의 결정(h.remove = 지울 쪽): 출결원장은 그대로 두고 그 시간만 지웁니다. 보내기 직전에도 지금 기록·조건으로 다시 봅니다.
  function removeResult(h){
    const out={state:'hold',changes:{},deleteTimes:[],text:'',notes:[],warnings:[],withdraw:[]},r=h.record;
    if(!r||r.source!=='live'||r.readState!=='complete'||!r.id||!r.version)return {...out,notes:['체크히어 상세 수집 대기 · 다시 지워 주세요']};
    if(studentRequests(h.cls,h.date,h.name).some(x=>ACTIVE.includes(x.status)))return {...out,notes:['진행 중 요청이 끝난 뒤 다시 지워 주세요']};
    const why=[...new Set(h.remove.flatMap(side=>timeDeleteBlock({gate:gate(),record:r,side,type:h.row.type})))];
    if(why.length)return {...out,notes:why};
    const deleteTimes=['entry','exit'].filter(k=>h.remove.includes(k));
    return {...out,state:'send',changes:Object.fromEntries(deleteTimes.map(k=>[k,''])),deleteTimes,text:`출결대조 시간 삭제 · ${deleteTimes.map(k=>DEL_LABEL[k]).join('·')}`,warnings:[deleteLeaves(deleteTimes,r)]};
  }
  const stop=h=>{if(h?.timer!=null){clearTimer(h.timer);h.timer=null;}};
  const setNote=(key,status)=>{if(status)notes.set(key,{...status,at:now()});else notes.delete(key);};
  // 결과 안내에는 계산에 쓴 기록 버전과 시간 삭제 표시(ver), 시간 삭제를 계산한 결정(결석·×)이면 그때 켜짐 여부(gate)를 붙여, 바뀌면 버리고
  // 지금 값으로 다시 계산해 보입니다(기록 없음·이미 같음·삭제 보류가 굳지 않게). 표시는 버전에 들어가지 않아 따로 봅니다(checkhere/day-data.mjs DELETE_MARKS).
  const KEEP=new Set(['error','denied','undo-failed','undone']);
  const deciding=h=>!!h.remove||h.row?.type==='결석';
  const stamped=(h,status)=>({...status,ver:verOf(h.record),...(deciding(h)?{gate:gateMark()}:{})});
  function finish(h,status){
    stop(h);if(holds.get(h.key)===h)holds.delete(h.key);
    // × 결정: 출결원장으로 다시 계산하는 '다시 보내기'를 빼고 ×를 다시 누르게 합니다.
    if(h.remove&&status?.actions?.includes('retry'))status={...status,label:status.label.replace(/ · 다시 보내기$/,''),actions:status.actions.filter(a=>a!=='retry'),detail:[status.detail,REMOVE_AGAIN].filter(Boolean).join(' · ')};
    if(status)setNote(h.key,status.requestId||KEEP.has(status.kind)||'ver' in status?status:stamped(h,status));emit(h.key);return status;
  }
  function tick(){ticker=null;if(disposed)return;const keys=[...holds.values()].filter(h=>h.phase==='countdown').map(h=>h.key);if(!keys.length)return;keys.forEach(emit);ticker=setTimer(tick,1000);}
  function countdown(h,res){
    if(frozen)return finish(h,CANCEL('화면을 떠나 체크히어 반영 대기를 멈췄습니다'));
    stop(h);Object.assign(h,{phase:'countdown',deadline:now()+undoMs,draft:false,lastRes:res,detail:[changeText(res.changes),...(res.withdraw?.length?['대기 중인 자동 요청 취소']:[]),...(res.warnings||[]),...(h.keepSheet?[`되돌리기는 체크히어 반영만 취소 (${h.keepSheet}은 출결원장에 다시 저장할 수 없음)`]:[])].filter(Boolean).join(' · ')});
    h.timer=setTimer(()=>void fire(h.key),undoMs);holds.set(h.key,h);if(ticker==null)ticker=setTimer(tick,1000);emit(h.key);
  }
  function wait(h,retryWhen,note,blockers=[]){stop(h);Object.assign(h,{phase:'waiting',retryWhen,note,blockers});holds.set(h.key,h);emit(h.key);}
  // 계산 결과에 따라: 보낼 것(또는 취소할 내 자동 요청)이 있으면 3초, 다시 계산할 조건이 있으면 보류, 아니면 끝(S5·S7)
  function applyResult(h,res){
    if(res.state==='send'||res.withdraw.length){
      // 오늘만 자동(사용자 결정): 미뤄 둔 자동 요청이 그날을 넘겼으면 보내지 않고 '체크히어 맞추기'만 남깁니다.
      if(!h.asked&&h.date!==today())return finish(h,{...resultStatus(res),sig:h.sig});
      return countdown(h,res);
    }
    // 저장 때 체크히어 기록이 아직 없었으면(첫 수집 전·다시 읽는 중) 기록이 오면 다시 계산합니다. 출석·결석은 기록이 없으면 체크히어에 할 일이 없어
    // 기다리지 않습니다(안 온 학생마다 대기가 쌓이지 않게). 그 안내는 기록이 오면 버려지고 지금 값으로 다시 계산해 보입니다.
    if(res.state==='none'&&!h.record&&!h.asked&&!['출석','결석'].includes(h.row.type))return wait(h,'record','체크히어 기록 없음 · 기록이 오면 다시 계산해 요청');
    if(res.state==='hold'&&res.retryWhen)return wait(h,res.retryWhen,res.notes[0],res.retryWhen==='request'?studentRequests(h.cls,h.date,h.name).filter(r=>ACTIVE.includes(r.status)).map(r=>r.id):[]);
    finish(h,{...resultStatus(res),sig:h.sig});
  }

  const FAIL=e=>S('error','보내지 못함 · 다시 보내기',{detail:String(e?.message||e),actions:['retry'],tone:'bad'});
  // 타이머·구독에서 부르므로 예상 못 한 오류도 그 행의 '보내지 못함'으로 끝냅니다(멈춘 보류가 남지 않게).
  async function fire(key,opts){try{return await attempt(key,opts);}catch(e){const h=holds.get(key);if(h&&!disposed)finish(h,FAIL(e));return null;}}
  // S3 보내기 직전 확인 → S6 취소 → S8 삭제 확인 → S12 안전망 → S11 쓰기 → S13 오류
  // unconfirmed: 지금 보내기(flush) 중 확인창(S8)을 거치지 않아 멈춘 시간 삭제의 학생 이름을 모읍니다(화면이 알림).
  async function attempt(key,{flush=false,unconfirmed=null}={}){
    const h=holds.get(key);if(!h||disposed||!['countdown','paused','waiting'].includes(h.phase))return null;
    stop(h);
    if(saving.has(key)){if(flush)return void finish(h,CANCEL('저장 중이라 체크히어로 보내지 않았습니다'));Object.assign(h,{phase:'paused',draft:false});emit(key);return null;}
    if(!flush&&hasDraft(h.cls,h.date,h.name)){Object.assign(h,{phase:'paused',draft:true});h.timer=setTimer(()=>void fire(key),1000);emit(key);return null;}
    if(!onDay(h.cls,h.date))return void finish(h,CANCEL('반·날짜가 바뀌어 체크히어로 보내지 않았습니다'));
    if(!reqReady){if(flush)return void finish(h,CANCEL('체크히어 요청 목록을 읽지 못해 보내지 않았습니다'));h.counted=true;wait(h,'load','체크히어 요청 목록 확인 중');return null;}
    const sheetSig=sigOf(h.cls,h.date,h.name);
    if(sheetSig!==h.sig)return void finish(h,CANCEL('시트가 그사이 바뀜 · 요청 안 보냄',{actions:['retry'],sig:sheetSig}));
    const cur=getRecord(h.cls,h.date,h.name);
    // 저장 때 본 기록이 지금 화면에 없음(새로고침·다시 읽는 중): '기록 없음'으로 끝내지 않고 기록이 다시 오면 계산합니다.
    if(!cur&&h.record){if(flush)return void finish(h,CANCEL('체크히어 기록을 다시 읽는 중이라 보내지 않았습니다'));return void wait(h,'record','체크히어 기록 다시 읽는 중');}
    if(cur&&(String(cur.classId)!==h.cls||cur.date!==h.date))return void finish(h,CANCEL('다른 반·날짜 기록이라 체크히어로 보내지 않았습니다'));
    if((cur?.version||'')!==(h.record?.version||'')){
      // 체크히어 기록이 그사이 바뀜: 새 기록으로 다시 계산하고 3초를 다시 보입니다(지금 보내는 중이면 바로 보냄, 삭제는 다시 물어야 해서 멈춤).
      h.record=clone(cur);h.deleteOk=false;const res=compute(h);
      if(!flush)return void applyResult(h,res);
      return commit(h,res,{flush,unconfirmed});
    }
    const res=compute(h);
    if(!flush&&!h.asked&&h.date!==today()&&(res.state==='send'||res.withdraw.length))return void finish(h,{...resultStatus(res),sig:h.sig}); // 오늘만 자동
    return commit(h,res,{flush,unconfirmed});
  }
  function commit(h,res,{flush=false,unconfirmed=null}={}){
    if(res.deleteTimes.length){
      // S8: 미뤄 둔 뒤·지금 보내기(반·날짜 이동·떠남)에는 삭제를 확인 없이 보내지 않습니다. 지금 보내기면 그 학생 이름을 알립니다.
      // × 결정이면 finish가 '다시 보내기' 대신 ×를 다시 누르라고 안내합니다.
      if(!h.deleteOk&&(h.deferred||flush)){if(flush)unconfirmed?.push(h.name);return void finish(h,flush?CANCEL('시간 삭제는 확인 없이 보내지 않습니다'):h.remove?CANCEL('체크히어 시간 삭제 멈춤'):{...resultStatus(res),sig:h.sig});}
      if(!h.deleteOk){
        if(!ask(deleteQuestion(h.name,h.date,h.record,res.deleteTimes,privacy())))return void finish(h,CANCEL('체크히어 시간 삭제 취소'));
        h.deleteOk=true;
      }
    }
    if(res.state!=='send'&&!res.withdraw.length)return void applyResult(h,res);
    h.phase='sending';emit(h.key);
    const run=(async()=>{
      const gone=()=>disposed||holds.get(h.key)!==h;
      for(const id of res.withdraw){
        try{await withdrawById(id);}catch(e){if(!gone())wait(h,'request','대기 중인 자동 요청을 취소하지 못함 · 진행 중 요청이 끝나면 다시 계산해 요청',[id]);return null;}
        if(gone())return null;
      }
      if(res.state!=='send')return void finish(h,{...resultStatus({...res,withdraw:[]}),sig:h.sig});
      let request;
      // [기준:…]은 저장 때 본 기록(S2)으로, 지우는 시간까지 덮습니다. 지울 쪽 폼 시간은 liveForm이 ''로 채웁니다.
      try{request=buildLiveRequest(h.record,liveForm(h.record,res.changes),res.text,{deleteTimes:res.deleteTimes});}
      catch(e){
        const m=String(e?.message||e);
        if(/바뀐 값이 없습니다/.test(m))return void finish(h,{...resultStatus({...res,state:'same',notes:['체크히어 이미 같음'],withdraw:[]}),sig:h.sig});
        if(/상세 기록이 아직 없습니다/.test(m))return void wait(h,'record','체크히어 상세 수집 대기');
        if(/교육 기간 안의 날짜/.test(m))return void finish(h,HOLD('규칙 날짜 범위 밖 · 넓히려면 사용자 확인 필요',{sig:h.sig}));
        return void finish(h,HOLD(m,{sig:h.sig}));
      }
      if(Object.keys(memoDefaultTimes(request.changes,h.record)).length)return void finish(h,HOLD('시간이 없는 쪽에는 사유를 넣을 수 없습니다',{sig:h.sig}));
      const id='b2_'+uuid(),data={...Object.fromEntries(REQUEST_KEYS.map(k=>[k,request[k]])),...(request.deleteTimes?.length?{deleteTimes:[...request.deleteTimes]}:{}),reason:String(request.reason).trim(),status:'pending',createdBy:me,createdAt:fs.serverTimestamp(),updatedAt:fs.serverTimestamp()};
      try{await fs.setDoc(fs.doc(db,'checkhereRequests',id),data);}
      catch(e){
        if(e?.code==='permission-denied'&&res.deleteTimes.length){denied=true;emit(null);return void finish(h,S('denied','시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다',{tone:'bad'}));}
        return void finish(h,FAIL(e));
      }
      if(!disposed)finish(h,S('pending','승인 대기',{requestId:id})); // 구독에 요청이 보이면 요청 상태로 바뀝니다.
      return id;
    })().catch(e=>{if(!disposed&&holds.get(h.key)===h)finish(h,FAIL(e));return null;});
    inflight.add(run);run.then(()=>inflight.delete(run));
    return run;
  }
  // S7 미뤄 둔 전송: 시트 변경 번호를 확인해 sig가 같을 때만 지금 기록으로 다시 계산하고 새 3초를 보입니다.
  async function recompute(h){
    // 같은 학생의 저장이 진행 중이면 기다립니다(afterSave가 처음 저장 전 값을 지켜 합친 뒤 다시 계산, S4).
    if(h.busy||disposed||saving.has(h.key))return;h.busy=true;
    try{
      let sig;
      try{const b=await client.bundle(h.cls,{maxAge:0});sig=String((b?.ledger||[]).find(r=>String(r.cls)===h.cls&&r.name===h.name&&r.date===h.date)?.sig??'');}catch{return;}
      if(disposed||holds.get(h.key)!==h||h.phase!=='waiting'||saving.has(h.key))return;
      if(sig!==h.sig)return void finish(h,CANCEL('시트가 그사이 바뀜 · 요청 안 보냄',{actions:['retry'],sig:sigOf(h.cls,h.date,h.name)}));
      Object.assign(h,{record:clone(getRecord(h.cls,h.date,h.name)),deferred:true,deleteOk:false,waitVersion:undefined,waitChanges:undefined});
      applyResult(h,compute(h));
    }catch(e){if(!disposed&&holds.get(h.key)===h)finish(h,FAIL(e));}finally{h.busy=false;}
  }
  function onRequests(list){
    requests=list;reqReady=true;reqError='';
    const byId=new Map(list.map(r=>[r.id,r]));
    for(const [k,n] of notes)if(n.requestId&&byId.has(n.requestId))notes.delete(k);
    for(const h of [...holds.values()]){
      if(h.phase!=='waiting')continue;
      if(h.retryWhen==='load'){if(h.counted)void fire(h.key);else try{applyResult(h,compute(h));}catch(e){finish(h,FAIL(e));}continue;}
      if(h.retryWhen!=='request')continue;
      const docs=(h.blockers||[]).map(id=>byId.get(id)).filter(Boolean);
      if(docs.some(d=>ACTIVE.includes(d.status)))continue;
      // 반영 완료면 그 변경이 기록에 보이거나 기록 버전이 지금보다 바뀐 뒤(새 기록으로) 계산. 반려·취소·실패·이미 반영은 버전이 안 바뀌므로 바로 계산(identity.mjs version = 내용 해시)
      const done=docs.filter(d=>d.status==='verified'&&!d.result?.alreadyApplied);
      if(done.length){Object.assign(h,{retryWhen:'record',waitVersion:getRecord(h.cls,h.date,h.name)?.version??null,waitChanges:Object.assign({},...done.map(d=>d.changes||{})),note:'체크히어 반영 확인 뒤 다시 계산'});recordsChanged(h);continue;}
      void recompute(h);
    }
    emit(null);
  }
  // 요청 목록 구독이 끊김(네트워크·권한): 목록을 기다리던 보류는 '다시 보내기'로 바꾸고, 다시 보내기·같은 날 setDay·다음 저장이 다시 구독합니다.
  function onRequestsError(e){
    reqError=String(e?.message||e);reqReady=false;
    for(const h of [...holds.values()])if(h.phase==='waiting'&&h.retryWhen==='load')finish(h,S('error','체크히어 요청 목록을 읽지 못함 · 다시 보내기',{detail:reqError,actions:['retry'],tone:'bad'}));
    emit(null);
  }
  function subscribeDay(){
    const {cls,date}=day;requests=[];reqReady=false;reqError='';unsubDay?.();
    unsubDay=fs.onSnapshot(fs.query(fs.collection(db,'checkhereRequests'),fs.where('classId','==',cls),fs.where('date','==',date)),
      snap=>{if(!disposed&&onDay(cls,date))onRequests((snap?.docs||[]).map(d=>({id:d.id,...d.data()})));},
      e=>{if(!disposed&&onDay(cls,date))onRequestsError(e);});
  }
  // 화면이 체크히어 기록을 새로 받을 때마다 부릅니다(S7 'record').
  function recordsChanged(only=null){
    for(const h of only?[only]:[...holds.values()]){
      if(h.phase!=='waiting'||h.retryWhen!=='record')continue;
      const cur=getRecord(h.cls,h.date,h.name);
      if(!(cur?.source==='live'&&cur.readState==='complete'&&cur.id&&cur.version))continue;
      if(h.waitChanges&&!shows(cur,h.waitChanges)&&cur.version===h.waitVersion)continue;
      void recompute(h);
    }
    if(!only)emit(null);
  }
  function subscribeSettings(){
    const watch=(name,set)=>fs.onSnapshot(fs.doc(db,'settings',name),snap=>{set(snap?.exists?.()?snap.data():null);emit(null);},()=>{set(null);emit(null);});
    unsubSettings=[watch('checkhereFeatures',v=>{features=v;}),watch('checkhereRelay',v=>{relayDoc=v;})];
  }
  const sendable=h=>h.phase==='countdown'||(h.phase==='paused'&&!saving.has(h.key));
  const busy=h=>h.phase==='sending'||h.phase==='undoing';
  // 보낼 수 있지만 시간 삭제 확인창(S8)을 아직 거치지 않은 결정(결석 저장의 3초): 지금 보내기로는 보내지 않습니다.
  const needsConfirm=h=>sendable(h)&&!h.deleteOk&&!!h.lastRes?.deleteTimes?.length;
  // 구독을 끊고 새 타이머를 만들지 않습니다(화면을 떠날 때). 이미 시작한 쓰기는 끝까지 갑니다.
  function freeze(){frozen=true;if(ticker!=null)clearTimer(ticker);ticker=null;for(const h of holds.values())if(!busy(h))stop(h);unsubDay?.();unsubDay=null;unsubSettings.forEach(f=>f?.());unsubSettings=[];}
  // S15: 3초를 기다리지 않고 지금 보냅니다(S3 확인은 그대로). 다시 계산을 기다리던 보류는 멈추고(stopped: 그 학생 이름),
  // 확인창(S8)을 거치지 않은 시간 삭제는 보내지 않습니다(unconfirmed: 그 학생 이름, 화면이 알림).
  // 먼저 모든 타이머를 멈추고 보낼 수 없는 보류를 끝내 둡니다(보내는 동안 다른 보류가 제 타이머·구독으로 따로 나가지 않게). leave면 쓰기를 시작한 뒤 구독도 끊습니다.
  async function flushAll({leave=false,why='화면을 떠나 체크히어 반영 대기를 멈췄습니다'}={}){
    let sent=0,skipped=0;const stopped=[],unconfirmed=[],list=[...holds.values()];
    if(ticker!=null)clearTimer(ticker);ticker=null;
    for(const h of list){if(busy(h))continue;stop(h);if(!sendable(h)){if(h.phase==='waiting')stopped.push(h.name);finish(h,CANCEL(why));skipped++;}}
    const runs=list.filter(h=>holds.get(h.key)===h&&sendable(h)).map(h=>fire(h.key,{flush:true,unconfirmed}));
    if(leave)freeze();
    for(const id of await Promise.all(runs))if(id)sent++;else skipped++;
    await Promise.allSettled([...inflight]);
    return {sent,skipped,stopped,unconfirmed};
  }
  // 다시 보내기·체크히어 맞추기: 지금 시트 값과 기록으로 다시 계산해 같은 3초 흐름으로 보냅니다(지난 날도). 이 세션의 체크히어에 닿는 저장 직후(시트 지문이 그대로)면
  // 그 저장의 되돌릴 값을 이어받아 되돌리기가 출결원장도 되돌리고, 아니면 되돌리기는 체크히어 요청만 취소합니다.
  function recalc(key){
    const {cls,date,name}=parseKey(key);
    if(disposed||frozen||!onDay(cls,date)||!getRow)return null;
    if(reqError)subscribeDay();
    const old=holds.get(key);if(old&&old.phase!=='waiting')return statusFor(key);
    if(old)finish(old,null);
    const row=getRow(cls,date,name),sig=sigOf(cls,date,name),saved=notes.get(key)?.save;
    if(row?.type==='해당없음')return statusFor(key);
    const ctx=saved&&saved.sig===sig?{prevRow:saved.prevRow,existedBefore:saved.existedBefore}:{prevRow:row,existedBefore:!!row,manual:true};
    const h=capture(key,{...ctx,row:row||{type:'출석'},sig,asked:true});
    if(!reqReady)wait(h,'load','체크히어 요청 목록 확인 중');else applyResult(h,compute(h));
    return statusFor(key);
  }
  function lazy(cls,date,name){
    if(!getRow||!onDay(cls,date)||!reqReady)return null;
    const row=getRow(cls,date,name);if(row?.type==='해당없음')return null;
    try{return {...resultStatus(sheetToCheckHere({row:pickRow(row||{type:'출석'}),record:getRecord(cls,date,name),sheetTeacher:String(teacherOf(cls)||''),date,deleteEnabled:gate().enabled,deleteV2:gate().v2,active:studentRequests(cls,date,name),me})),lazy:true};}catch{return null;}
  }
  function statusFor(key){
    const {cls,date,name}=parseKey(key),h=holds.get(key),list=studentRequests(cls,date,name);
    const local=h?{phase:h.phase,deadline:h.deadline,note:h.note,detail:h.detail,draft:h.draft,mineBlocking:h.phase==='waiting'&&list.some(r=>(h.blockers||[]).includes(r.id)&&r.status==='pending'&&r.createdBy===me)}:null;
    let target=notes.get(key)||null;
    // 그 뒤 시트나 체크히어 기록이 바뀐 결과는 버리고 지금 값으로 계산해 보입니다.
    if(target&&!target.requestId&&((target.sig!=null&&sigOf(cls,date,name)!==target.sig)||(target.ver!==undefined&&target.ver!==verOf(getRecord(cls,date,name)))||(target.gate!==undefined&&target.gate!==gateMark())))target=null;
    return rowCheckHereStatus({local,request:list.find(isLiveRequest)||null,target:target||lazy(cls,date,name),now:now(),me,record:onDay(cls,date)?getRecord(cls,date,name):null});
  }
  // × 버튼(send의 deleteTimes): 지금 지울 수 있는지 보고, 확인창(S8)에서 '예'일 때만 3초를 시작합니다(그 뒤 보내기 직전 확인 S3은 그대로).
  function removeTimes(key,sides){
    const {cls,date,name}=parseKey(key);
    if(!Array.isArray(sides)||new Set(sides).size!==sides.length||sides.some(k=>k!=='entry'&&k!=='exit'))return {ok:false,reasons:['삭제할 시간 항목을 확인해 주세요.']};
    if(disposed||frozen||!onDay(cls,date))return {ok:false,reasons:['반·날짜가 바뀌어 지우지 않았습니다']};
    if(saving.has(key)||hasDraft(cls,date,name))return {ok:false,reasons:['출결원장 저장·입력이 끝난 뒤 지워 주세요']};
    if(holds.has(key))return {ok:false,reasons:['이 학생의 체크히어 반영 대기가 끝난 뒤 지워 주세요']};
    if(!reqReady)return {ok:false,reasons:['체크히어 요청 목록을 확인하는 중입니다 · 잠시 뒤 다시 지워 주세요']};
    const row=getRow?.(cls,date,name)||null;
    // 재학 기간이 아닌 행에는 상태 칩이 없어 3초·되돌리기가 보이지 않습니다(맞추기·다시 보내기도 막음).
    if(row?.type==='해당없음')return {ok:false,reasons:['재학 기간이 아닌 학생입니다']};
    const h=capture(key,{prevRow:row,row:row||{type:'출석'},sig:sigOf(cls,date,name),manual:true,asked:true});
    h.remove=[...sides];
    const res=compute(h);
    if(res.state!=='send')return {ok:false,reasons:res.notes};
    if(!ask(deleteQuestion(name,date,h.record,res.deleteTimes,privacy())))return {ok:false,cancelled:true};
    h.deleteOk=true;countdown(h,res);
    return {ok:true,status:statusFor(key)};
  }

  return {
    // S10·S14: 반·날짜를 바꾸기 전에(화면의 기록·시트 값을 바꾸기 전에) await 합니다. 남은 보류는 확인 후 보내거나 취소합니다.
    // 진행 중 요청·기록을 기다리던 보류는 보낼 수 없어 멈추고 그 학생 이름을 stopped로 돌려줍니다(화면이 알림). 같은 날이면 끊긴 요청 구독만 다시 겁니다.
    // 확인창(S8)을 거치지 않은 시간 삭제(결석 저장의 3초)는 보내지 않고 멈추며, 묻는 글에 따로 세고 이름을 unconfirmed로 돌려줍니다.
    async setDay(cls,date){
      cls=String(cls);date=String(date);const out={sent:0,cancelled:0,stopped:[],unconfirmed:[]};
      if(disposed||frozen)return out;
      if(onDay(cls,date)){if(reqError){subscribeDay();emit(null);}return out;}
      const ready=[...holds.values()].filter(sendable),asks=ready.filter(needsConfirm).length,waiting=[...holds.values()].filter(h=>!sendable(h)&&!busy(h)).length;
      if(ready.length>asks&&ask(`체크히어 반영 대기 ${ready.length-asks}건을 지금 보낼까요?${asks?`\n(확인창을 거치지 않은 체크히어 시간 삭제 ${asks}건은 보내지 않고 멈춥니다)`:''}${waiting?`\n(진행 중 요청·기록을 기다리는 ${waiting}건은 보내지 못하고 멈춥니다)`:''}`)){const r=await flushAll({why:'체크히어 반영 취소 (반·날짜 이동)'});out.sent=r.sent;out.cancelled=r.skipped;out.stopped.push(...r.stopped);out.unconfirmed.push(...r.unconfirmed);}
      for(const h of [...holds.values()])if(!busy(h)){if(h.phase==='waiting')out.stopped.push(h.name);else if(needsConfirm(h))out.unconfirmed.push(h.name);finish(h,CANCEL('체크히어 반영 취소 (반·날짜 이동)'));out.cancelled++;}
      if(disposed)return out;
      for(const k of [...notes.keys()]){const p=parseKey(k);if(p.cls!==cls||p.date!==date)notes.delete(k);}
      day={cls,date};
      if(!unsubSettings.length)subscribeSettings();
      subscribeDay();
      emit(null);return out;
    },
    // S4 저장 겹침: 저장이 시작되면 그 학생의 3초를 멈춥니다.
    saveStarted(key){if(disposed)return;saving.add(key);const h=holds.get(key);if(h?.phase==='countdown'){stop(h);Object.assign(h,{phase:'paused',draft:false});emit(key);}},
    saveFailed(key){if(disposed)return;saving.delete(key);const h=holds.get(key);if(h&&h.phase!=='sending'&&h.phase!=='undoing')finish(h,CANCEL('저장 실패로 체크히어 반영 안 함'));},
    // 저장 성공 뒤. row = 방금 b2Save에 보낸 값, prevRow = 저장 전 값(ev·evr 포함), sig = 저장 결과 지문, unchanged = 기록 없던 학생을 출석으로 저장(시트 그대로)
    afterSave(key,{prevRow=null,row,sig,existedBefore=true,unchanged=false}={}){
      if(disposed)return null;saving.delete(key);
      const old=holds.get(key),merge=!!old&&!old.manual&&['countdown','paused','waiting'].includes(old.phase);
      if(unchanged){if(old?.phase==='paused')countdown(old,old.lastRes||{changes:{}});else if(!old)notes.delete(key);emit(key);return statusFor(key);}
      if(old&&old.phase!=='sending'&&old.phase!=='undoing')finish(old,null);
      // 겹친 저장은 처음 저장 전 값을 지켜 되돌리기가 원래 상태로 갑니다.
      const h=capture(key,{prevRow:merge?old.prevRow:prevRow,existedBefore:merge?old.existedBefore:existedBefore,row,sig});
      const kind=checkhereChangeKind(h.prevRow,h.row),auto=kind==='checkhere'&&h.date===today()&&onDay(h.cls,h.date);
      if(auto){if(!reqReady){if(reqError)subscribeDay();wait(h,'load','체크히어 요청 목록 확인 중');}else applyResult(h,compute(h));return statusFor(key);}
      // 자동으로 보내지 않는 저장(증빙·인정 아닌 사유만, 지난 날): 결과만 보이고 보낼 것이 있으면 '체크히어 맞추기'(S5).
      // 맞추기가 이 저장을 이어받아 되돌리기로 출결원장까지 되돌리는 것은 체크히어에 닿는 저장(지난 날 유형·시간·인정 사유)일 때만입니다(증빙만 바꾼 저장은 되돌리지 않음).
      const res=reqReady&&onDay(h.cls,h.date)?compute(h):null;
      setNote(key,res?{...stamped(h,resultStatus(res)),sig:h.sig,...(kind==='checkhere'?{save:{prevRow:h.prevRow,existedBefore:h.existedBefore,sig:h.sig}}:{})}:null);
      emit(key);return statusFor(key);
    },
    suggest:recalc,
    retry:recalc,
    // 지금 보내기(3초를 건너뜀). deleteTimes가 있으면 × 버튼: 켜지는 조건·기록 번호·유형을 확인하고 확인창(S8)을 거쳐
    // 같은 3초 되돌리기로 시간 삭제 요청을 보냅니다(되돌리기는 체크히어 요청만 취소, 출결원장은 그대로). 못 지우면 {ok:false,reasons}.
    async send(key,{deleteTimes=[]}={}){
      if(deleteTimes?.length)return removeTimes(key,deleteTimes);
      const h=holds.get(key);if(h&&sendable(h)){const id=await fire(key,{flush:true});return {ok:!!id,id:id||null};}
      return {ok:false,status:recalc(key)};
    },
    // S9 되돌리기: 타이머를 멈추고 Firestore에는 아무것도 쓰지 않으며, 출결원장도 저장 전 값으로 되돌립니다(기록 없던 학생은 '출석').
    // 입력 중이라 멈춘 3초(paused·저장 중 아님)도 되돌릴 수 있습니다. 되돌릴 수 없으면 {ok:false,reason}.
    // 이전 값이 출결원장에 다시 저장할 수 없는 값(keepSheet)이면 체크히어 반영만 취소하고 출결원장은 그대로 둡니다.
    async undo(key){
      const h=holds.get(key);
      if(!h||!(h.phase==='countdown'||(h.phase==='paused'&&!saving.has(key))))return {ok:false,reason:!h?'되돌릴 반영 대기가 없습니다':h.phase==='sending'?'이미 보내는 중입니다 · 반영 대기가 되면 「요청 취소」로 취소해 주세요':h.phase==='undoing'?'되돌리는 중입니다':h.phase==='paused'?'저장 중이라 지금은 되돌릴 수 없습니다':'보내기 전 3초가 아니라 되돌릴 수 없습니다'};
      stop(h);h.phase='undoing';emit(key);
      if(h.manual){finish(h,S('undone','체크히어 반영 취소',{tone:'muted'}));return {ok:true};}
      if(h.keepSheet){finish(h,S('undone','체크히어 반영 취소 · 출결원장은 그대로',{tone:'warn',detail:`${h.keepSheet}은 출결원장에 다시 저장할 수 없어 되돌리지 않았습니다`}));return {ok:true,kept:h.keepSheet};}
      const p=h.prevRow,row={cls:h.cls,name:h.name,date:h.date,type:p.type,inT:p.inT,outT:p.outT,oa:p.oa,ob:p.ob,reason:p.reason.trim(),ev:p.ev,evr:p.ev==='반려'?p.evr.trim():'',before:h.sig};
      try{const res=await client.save(row);finish(h,S('undone','체크히어 반영 취소 · 출결원장도 되돌림',{tone:'muted'}));return {ok:true,row,res};}
      catch(e){finish(h,S('undo-failed',e?.code==='CONFLICT'?'되돌리지 못함 · 최신 값 확인':`되돌리지 못함 · ${e?.message||e}`,{tone:'bad'}));return {ok:false,row,error:e};}
    },
    // '요청 취소': 이 학생의 내 승인 대기 요청(보류를 막는 요청 먼저). 실패는 그대로 던집니다.
    async withdraw(key){
      const {cls,date,name}=parseKey(key),h=holds.get(key),mine=studentRequests(cls,date,name).filter(r=>r.status==='pending'&&r.createdBy===me);
      const r=mine.find(x=>(h?.blockers||[]).includes(x.id))||mine.find(isLiveRequest)||mine[0];
      if(!r)return false;await withdrawById(r.id);return true;
    },
    statusFor,
    recordsChanged:()=>recordsChanged(),
    gate,
    relay(){
      const s=relayDoc,at=typeof s?.at==='number'?s.at:stamp(s?.at),t=now(),on=s?.state==='running'&&at>0&&t-at<=RELAY_STALE_MS,min=Math.floor((t-at)/60000);
      // privacy: 수집 PC 체크히어 탭의 해제 상태(중계 신호, 이름 없음). 가려져 있어도 읽기·요청은 되고, 반영할 때만 사람이 해제합니다.
      const unmask=on?unmaskNote(s):'',p=on?privacy():null,short=privacyShort(p);
      return {on,at:at||null,busy:!!s?.busy,queue:Number(s?.queue)||0,capabilities:[...(s?.capabilities||[])],build:s?.build||null,requestsError:reqError,needsUnmask:on?Number(s?.needsUnmask)||0:0,privacy:p,
        // 중계는 읽기 전용이라 꺼져도 요청(시간 삭제 요청 포함, 2026-10-16)은 만들고 늘 사람의 승인을 기다립니다. 멈추는 것은 체크히어 기록 자동 수집과 해제 상태 표시뿐입니다.
        // '삭제 요청은 가능'은 삭제 조건(규칙 게시 깃발·권한)이 맞을 때만 붙입니다.
        text:on?`수집 PC 중계 작동 중 · 신호 ${min<1?'방금':min+'분 전'}${unmask?` · ${unmask} ${Number(s.needsUnmask)}건`:''}${short?` · ${short}`:''}`:`중계 꺼짐 · 자동 수집·해제 표시 없음 (${gate().enabled?'삭제 ':''}요청은 가능, 반영은 승인 때)`};
    },
    // needsConfirm: 확인창(S8)을 거치지 않은 시간 삭제라 지금 보내기(떠남·반·날짜 이동)로는 보내지 않는 결정
    holds:()=>[...holds.values()].map(h=>({key:h.key,cls:h.cls,date:h.date,name:h.name,phase:h.phase,sendable:sendable(h),needsConfirm:needsConfirm(h),retryWhen:h.retryWhen||null,deadline:h.deadline||null})),
    // 이 학생의 가장 최근 실시간 요청이 확인된 시간 삭제인지(출결대조가 같은 날 삭제 뒤 남는 실제 입실을 결석과 맞는 것으로 봄)
    timesDeleted(key){const {cls,date,name}=parseKey(key),r=studentRequests(cls,date,name).find(isLiveRequest);return r?.status==='verified'&&Array.isArray(r.deleteTimes)&&r.deleteTimes.length>0;},
    flushAll,
    dispose(){if(disposed)return;disposed=frozen=true;for(const h of holds.values())stop(h);holds.clear();if(ticker!=null)clearTimer(ticker);ticker=null;unsubDay?.();unsubSettings.forEach(f=>f?.());unsubSettings=[];}
  };
}
