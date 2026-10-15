// CheckHere live beta: shared rules for the viewer and the relay tab.
// Edits travel as ordinary `checkhereRequests`, marked so only beta requests are
// auto-approved, and tagged with the values the editor saw.
import {cleanRequest,memoDefaultTimes} from './checkhere/approval-core.mjs';
import {assertChangeAllowed,normalizeTime} from './checkhere/rules.mjs';

export const LIVE_MARK='[실시간 베타]';
export const LIVE_FIELDS=['entry','exit','entryMemo','exitMemo'];
// 자동 갱신 간격: 10분(사용자 결정 2026-10-13). 바뀐 학생만 상세를 읽고 바뀐 반만 저장합니다.
export const LIVE_INTERVAL_MS=10*60*1000;
export const LIVE_WINDOW={weekdays:[1,2,3,4,5],start:'08:50',end:'18:40'};
export const CLASS_IDS=Array.from({length:17},(_,i)=>String(i+1));
export const ACTIVE=['pending','approved','applying'];

export function koreaClock(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(now).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};
}
export function inLiveWindow(now=new Date(),w=LIVE_WINDOW){const k=koreaClock(now);return w.weekdays.includes(k.weekday)&&k.time>=w.start&&k.time<=w.end;}

// FNV-1a: small, synchronous and identical in the browser and Node.
function fnv(text){let h=0x811c9dc5;for(const ch of text){h^=ch.codePointAt(0);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
export function baseTag(record,fields){return fnv(JSON.stringify([record.id,[...fields].sort().map(k=>[k,record[k]??''])]));}
export const tagOf=reason=>/\[기준:([0-9a-f]{8})\]\s*$/.exec(String(reason||''))?.[1]||null;
export const isLiveRequest=r=>typeof r?.reason==='string'&&r.reason.startsWith(LIVE_MARK)&&!!tagOf(r.reason);
export const editorReason=reason=>String(reason||'').replace(LIVE_MARK,'').replace(/\s*\[기준:[0-9a-f]{8}\]\s*$/,'').trim();
// 2기 베타 출결대조가 만든 자동 요청(근거에 이 글이 들어감). 1기 재처리와 2기 출결대조가 함께 씁니다.
export const AUTO_TEXT='출결대조 자동';
export const isAutoLedgerRequest=r=>typeof r?.reason==='string'&&r.reason.includes(AUTO_TEXT);
// 출결대조 자동 요청과 시간 삭제 요청(deleteTimes)은 [기준] 지문으로 관리자가 본 값을 지킵니다. 1기 '실패 건 다시 처리'는
// 요청을 그대로 복사해 기준 확인 없이 며칠 뒤에도 적용하므로 빼고, 2기 베타 출결대조에서 지금 값으로 다시 계산해 보냅니다.
export const RETRY_IN_LEDGER='출결대조에서 다시 보내기';
export const RETRY_IN_LEDGER_HELP='출결대조 자동·시간 삭제 요청은 여기서 다시 처리하지 않습니다. 2기 베타 출결대조(/beta2)에서 그 학생 행의 「체크히어 맞추기」(오늘은 「다시 보내기」)로 지금 값을 다시 계산해 보내 주세요. 체크히어 시간 옆 ×로 지운 요청은 ×를 다시 눌러 주세요.';
export const retryInLedger=r=>(isLiveRequest(r)&&isAutoLedgerRequest(r))||(Array.isArray(r?.deleteTimes)?r.deleteTimes.length>0:!!r?.deleteTimes);

// The relay and the server approve requests with the request rules (requested:true).
// deletions: 시간 삭제 요청이 지우는 쪽(cleanRequest(r).deleteTimes). 삭제가 아니면 비워 둡니다.
export function checkLiveEdit(record,changes,capabilities,deletions=[]){
  const defaults=memoDefaultTimes(changes,record);
  const judgement=assertChangeAllowed(record,{...changes,...defaults},{capabilities,requested:true,deletions});
  return {...judgement,defaults};
}
// deleteTimes: 지울 쪽('entry'·'exit'). 그쪽 폼 시간은 비워 두고, 체크히어에 시간이 있으면 changes[k]=''로 보냅니다(이미 비었으면 건너뜀).
export function buildLiveRequest(record,form,reason,{deleteTimes=[]}={}){
  if(!record?.id||record.source!=='live'||record.readState!=='complete')throw Error('이 학생은 상세 기록이 아직 없습니다. 다음 자동 갱신 후 다시 수정해 주세요.');
  if(!Array.isArray(deleteTimes)||deleteTimes.some(k=>k!=='entry'&&k!=='exit'))throw Error('삭제할 시간 항목을 확인해 주세요.');
  const changes={};
  for(const k of ['entry','exit']){
    const raw=String(form[k]??'').trim();
    if(deleteTimes.includes(k)){if(raw)throw Error('삭제할 시간 칸은 비워 주세요.');if(normalizeTime(record[k]))changes[k]='';continue;}
    if(!raw){if(normalizeTime(record[k]))throw Error('시간을 비우는 수정은 「시간 삭제」로만 할 수 있습니다.');continue;}
    if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw))throw Error('시간은 09:00 또는 09:00:00 형식으로 입력해 주세요.');
    const t=raw.length===5?raw+':00':raw;if(t!==(normalizeTime(record[k])||''))changes[k]=t;
  }
  for(const k of ['entryMemo','exitMemo']){const v=String(form[k]??'');if(v!==(record[k]??''))changes[k]=v;}
  if(!Object.keys(changes).length)throw Error('바뀐 값이 없습니다.');
  const text=String(reason||'').trim();if(!text)throw Error('수정 근거를 입력해 주세요.');
  // [기준] 지문은 바뀌는 항목(지우는 시간 포함)의 지금 값을 덮습니다.
  const fields=Object.keys(changes),suffix=` [기준:${baseTag(record,fields)}]`,full=`${LIVE_MARK} ${text}${suffix}`;
  if(full.length>1000)throw Error('수정 근거가 너무 깁니다.');
  const removing=['entry','exit'].filter(k=>changes[k]==='');
  const request=cleanRequest({classId:String(record.classId),date:record.date,name:record.name,phoneLast4:record.phoneLast4||'',reason:full,changes,...(removing.length?{deleteTimes:removing}:{})});
  checkLiveEdit(record,request.changes,undefined,request.deleteTimes);
  return request;
}
// 전화 끝 4자리가 한쪽에 없으면(운영포털 양식은 선택 칸) 같은 학생으로 봅니다.
const sameStudent=(a,b)=>String(a.classId)===String(b.classId)&&a.date===b.date&&a.name===b.name&&(!a.phoneLast4||!b.phoneLast4||String(a.phoneLast4)===String(b.phoneLast4));
export const requestsFor=(record,requests)=>requests.filter(r=>sameStudent(r,record)).sort((a,b)=>(stamp(b.createdAt)-stamp(a.createdAt)));
export function stamp(t){if(!t)return 0;if(typeof t.toMillis==='function')return t.toMillis();if(typeof t.seconds==='number')return t.seconds*1000+(t.nanoseconds||0)/1e6;const n=Date.parse(t);return Number.isFinite(n)?n:0;}
export const LIVE_STATUS={pending:'반영 대기',approved:'반영 준비',applying:'반영 중',verified:'반영 완료',rejected:'자동 반영 안 함',withdrawn:'취소',conflict:'원본 변경 · 재확인',partial:'일부 반영 · 재확인',failed:'반영 실패',unknown:'결과 미확인'};
export const NO_LECTURE=/강의가 없습니다|강의를 찾지 못했습니다/;
