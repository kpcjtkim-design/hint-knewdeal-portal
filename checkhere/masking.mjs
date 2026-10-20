// 체크히어 개인정보 가림(마스킹) 화면에서 학생을 찾는 순수 함수들(화면·DB 없음).
// Cowork 확인(2026-10-15): 가린 화면은 표와 화면 데이터(JSON) 모두 이름 '첫 글자+**', 전화 '010-****-끝4자리'만 줍니다.
// 학생은 체크히어 자신의 attendeeId(날짜가 달라도 같음)로 찾고, 이름·학생 키는 이 PC에 저장된 원문 기록에서 가져옵니다.
// 가린 글자는 이름·키·메모가 되지 않습니다. 오류 글에는 이름·첫 글자·끝 4자리를 넣지 않습니다.
// 할 일: 이 글은 중계 기록·반영 결과에 그대로 보이므로 어디서 무엇을 하면 되는지까지 적습니다.
// 해제는 사람이 합니다(2026-10-16 결정): 연결 프로그램이 연 체크히어 창(같은 탭, 새 탭은 다시 가려짐)에서 직접, 또는 연결 프로그램 화면에서 사람이 누르는 「마스킹 해제 시작」으로.
import {NEEDS_UNMASK_TEXT} from './rules.mjs';
import {BRIDGE_PORT} from './cohort-bridge.mjs';
const WHERE=`연결 프로그램이 연 체크히어 창(같은 탭)에서 마스킹을 해제해 주세요. 직접 하거나 수집 PC의 연결 프로그램 화면(127.0.0.1:${BRIDGE_PORT})에서 「마스킹 해제 시작」을 눌러도 됩니다`;
// 수정·삭제 직전 가림 확인(K4, 2026-10-16)에서 막힐 때의 글: 포털·연결 프로그램이 같은 안내(rules.mjs NEEDS_UNMASK_TEXT)를 보입니다.
export const MASKED={
  MIXED:'MASKED_MIXED: 체크히어 화면의 가림 상태가 섞여 있어 이 날 수집을 멈췄습니다(해제 시간이 끝나는 중일 수 있음). 해제가 끝나거나 다시 가려진 뒤 다시 수집해 주세요.',
  NODATA:'MASKED_NODATA: 가린 화면에서 출결 화면 데이터를 받지 못해 이 날 수집을 멈췄습니다. 잠시 뒤 다시 수집해 주세요. 계속되면 마스킹 해제 후 수집해 주세요.',
  ALIGN:'MASKED_ALIGN: 가린 화면의 표와 화면 데이터 순번이 맞지 않아 이 날 수집을 멈췄습니다. 체크히어 화면 모양이 바뀌었을 수 있으니 담당자에게 알려 주세요.',
  WRITE:`MASKED_WRITE: ${NEEDS_UNMASK_TEXT} ${WHERE}`,
  TIME:'MASKED_TIME: 체크히어 해제 남은 시간을 읽지 못했거나 모자라 수정·삭제를 시작하지 않았습니다. 수집 PC의 체크히어 탭에서 연장(또는 다시 해제)한 뒤 다시 반영해 주세요. 연장·다시 해제는 사람이 체크히어 창에서 정합니다',
  UNLINKED:`MASKED_UNLINKED: 이 학생은 아직 체크히어 학생 번호와 연결되지 않았습니다. 체크히어 마스킹 해제 후 반영합니다. ${WHERE}`,
  READ:`MASKED_READ: 가린 화면에서 이 학생의 화면 데이터가 표와 달라 읽지 못했습니다. 체크히어 마스킹 해제 후 반영합니다. ${WHERE}`,
  TARGET:'MASKED_TARGET: 체크히어가 보내려던 학생·날짜가 연결된 학생과 달라 막았습니다. 다시 수집해 주세요',
  STORE:'MASKED_STORE: 가린 값(*)은 저장하지 않습니다. 체크히어 원문 이름으로 다시 수집해 주세요',
  // 아래 셋은 해제로 풀리지 않습니다(해제 대기 수에 넣지 않음).
  AMBIGUOUS:'MASKED_AMBIGUOUS: 같은 반에 첫 글자·끝 4자리가 같은 학생이 있어 자동 반영하지 않습니다. 체크히어에서 직접 고쳐 주세요',
  CONFLICT:'MASKED_CONFLICT: 체크히어 학생 번호 연결이 예전과 달라 멈췄습니다. 수집 PC 연결 프로그램 화면에서 「연결 충돌 정리」를 누른 뒤 다시 수집해 주세요',
  GUARD:'MASKED_GUARD: 저장할 때 체크히어 변경 요청을 확인하지 못했습니다. 연결 프로그램을 다시 시작할 때까지 체크히어에 쓰지 않습니다. 반영 결과는 체크히어에서 확인해 주세요',
  UNMASKING:'MASKED_UNMASKING: 체크히어 창에서 사람이 마스킹 해제를 진행 중이라 화면을 옮기지 않았습니다. 해제가 끝나면 자동으로 이어 합니다.',
  // 정밀 수집(수정창으로 읽기, 비상용)은 가린 화면에서 수정창이 열리지 않아 조용히 화면 데이터로 바꾸지 않고 거절합니다.
  PRECISE:`MASKED_PRECISE: 정밀 수집(수정창으로 읽기)은 가린 화면에서 할 수 없어 시작하지 않았습니다. 빠른 수집(화면 데이터만)을 쓰거나, ${WHERE}`,
};
// 쓰기를 멈추는 남은 해제 시간(초). 이보다 적으면 새 쓰기를 시작하지 않습니다.
export const MIN_WRITE_SECONDS=90;
// 잡기(claim) 전에는 더 넉넉히 봅니다: 잡은 뒤 다시 읽는 동안(5~15초) 90초 밑으로 내려가면 요청이 '실패'로 끝나므로.
export const MIN_CLAIM_SECONDS=150;
export const isMaskedError=message=>/\bMASKED_[A-Z]+/.test(String(message||''));
// 해제를 기다리면 풀리는 가림 오류인지(같은 서명·연결 충돌·요청 확인 실패는 해제로 풀리지 않음)
export const waitsForUnmask=message=>isMaskedError(message)&&!/\bMASKED_(?:AMBIGUOUS|CONFLICT|GUARD)\b/.test(String(message||''));
export const hasMask=v=>String(v??'').includes('*');
// 보이는 앞부분(별 앞). 두 글자 성·영문 이름처럼 앞이 더 보여도 됩니다(별 개수는 보지 않음).
export const shownPrefix=v=>String(v??'').split('*')[0].trim();
// 끝 4자리는 끝의 숫자 4개만 봅니다(숫자만 모아 뒤 4개를 쓰지 않음).
export const last4Of=v=>/(\d{4})\s*$/.exec(String(v??'').trim())?.[1]||'';
const digits=v=>String(v??'').replace(/\D/g,'');
// 표 한 줄의 모양: 원문(이름에 * 없음, 전화 9자리 이상) | 가림(이름·전화에 *, 보이는 앞부분과 끝 4자리) | 이상함
export function rowKind(name,phone){
  const n=String(name??'').trim(),p=String(phone??'').trim();
  if(n&&!hasMask(n)&&!hasMask(p)&&digits(p).length>=9)return 'plain';
  if(hasMask(n)&&hasMask(p)&&shownPrefix(n)&&last4Of(p))return 'masked';
  return 'odd';
}
// 머리말: 'masked'(해제 버튼) | 'unmasked'(원문 표시 중) | 'both' | 'none'(가림 기능 없는 화면).
// 원문과 가린 줄이 섞이거나 머리말과 표가 다르면 'mixed'(그날 멈춤). 이상한 줄 하나는 그 학생만 연결 안 됨으로 둡니다.
// 머리말이 'both'(해제 버튼과 원문 표시가 함께 보임)이면 읽기는 표로만 정합니다(쓰기는 collector.writeBlocked가 막음): 늘 그런 화면이면 읽기까지 멈추지 않게.
export function detectView(kinds,header='none'){
  const masked=kinds.includes('masked'),plain=kinds.includes('plain');
  if(header==='both')header='none';
  if(masked&&plain)return 'mixed';
  if(masked)return header==='unmasked'?'mixed':'masked';
  if(plain)return header==='masked'?'mixed':'plain';
  return header==='masked'?'masked':'plain';
}
// '개인정보 원문 표시 중 9분 5초' → 545초. 찾지 못하면 null.
export function parseRemaining(text){
  const t=String(text||''),m=/원문\s*표시\s*중\s*(?:(\d+)\s*분)?\s*(?:(\d+)\s*초)?/.exec(t);
  if(m&&(m[1]!==undefined||m[2]!==undefined))return Number(m[1]||0)*60+Number(m[2]||0);
  // 타이머가 '09:30' 모양이어도 읽습니다(실제 모양은 첫 실행에서 확인).
  const c=/원문\s*표시\s*중\s*(\d{1,2}):(\d{2})/.exec(t);return c?Number(c[1])*60+Number(c[2]):null;
}
// 보이는 이름이 같은 학생을 가리킬 수 있는지: 둘 다 원문이면 같아야 하고, 하나라도 가렸으면 보이는 앞부분이 맞아야 합니다.
export function nameFits(a,b){
  const x=String(a??'').trim(),y=String(b??'').trim();if(!x||!y)return false;
  if(!hasMask(x)&&!hasMask(y))return x===y;
  const px=shownPrefix(x),py=shownPrefix(y);if(!px||!py)return false;
  if(hasMask(x)&&hasMask(y))return px.startsWith(py)||py.startsWith(px);
  return hasMask(x)?y.startsWith(px):x.startsWith(py);
}
// 전화: 끝 4자리는 늘 같아야 하고, 둘 다 원문이면 전체가 같아야 합니다.
export const phoneFits=(a,b)=>!!last4Of(a)&&last4Of(a)===last4Of(b)&&(hasMask(a)||hasMask(b)||digits(a).length<9||digits(b).length<9||digits(a)===digits(b));
// 표 줄(순번=seq, 이름, 전화)과 화면 데이터(sequence)를 맞춥니다. 체크히어 표의 순번은 JSON sequence 그 자체(Cowork 확인, 표는 이름순).
// 순번이 하나씩·빠짐없이 맞고 보이는 이름·끝 4자리가 같아야 합니다. 아니면 MASKED_ALIGN.
export function alignRows(rows,list){
  const fail=()=>{throw Error(MASKED.ALIGN);};
  if(!Array.isArray(list)||list.length!==rows.length)fail();
  const bySeq=new Map();
  for(const s of list){const q=Number(s?.sequence);if(!Number.isInteger(q)||bySeq.has(q))fail();bySeq.set(q,s);}
  const used=new Set();
  return rows.map(r=>{
    const q=/^\d+$/.test(String(r.seq??'').trim())?Number(String(r.seq).trim()):NaN,s=bySeq.get(q);
    if(!s||used.has(q)||!nameFits(r.name,s.name)||!phoneFits(r.phone,s.phone))fail();
    used.add(q);return s;
  });
}
// 원문 화면용 줄별 맞춤: 표 순번(=sequence)이 먼저입니다. 원문 줄은 지금처럼 모두 맞아야 하고(하나라도 어긋나면 null — 화면 모양을 의심),
// 전화가 다 보이지 않는 줄(이상한 줄)은 그 줄만 null로 둡니다(그날을 멈추지 않음). 이상한 줄은 보이는 이름·끝 4자리가 있으면 그것도 맞아야 합니다.
export function alignBySeq(rows,list){
  if(!Array.isArray(list)||list.length!==rows.length)return null;
  const bySeq=new Map();
  for(const s of list){const q=Number(s?.sequence);if(!Number.isInteger(q)||bySeq.has(q))return null;bySeq.set(q,s);}
  const used=new Set(),out=[];
  for(const r of rows){
    const q=/^\d+$/.test(String(r.seq??'').trim())?Number(String(r.seq).trim()):NaN,s=used.has(q)?null:bySeq.get(q);
    const plain=(r.kind||rowKind(r.name,r.phone))==='plain';
    const fits=!!s&&nameFits(r.name,s.name)&&(plain?phoneFits(r.phone,s.phone):!last4Of(r.phone)||!last4Of(s.phone)||last4Of(r.phone)===last4Of(s.phone));
    if(!fits){if(plain)return null;out.push(null);continue;}
    used.add(q);out.push(s);
  }
  return out;
}
export const attendeeOf=s=>typeof s?.attendeeId==='string'&&s.attendeeId.trim()?s.attendeeId.trim():null;
const sameSig=(a,b)=>nameFits(a.name,b.name)&&last4Of(a.phone)===last4Of(b.phone);
// 원문 기록(이름 전체·phoneLast4, 전화 없음)의 가린 화면 서명: 첫 글자+끝 4자리(가린 화면이 더 보여 줘도 첫 글자가 가장 넓게 묶음).
export const plainSig=r=>(String(r?.name??'').trim()[0]||'')+'|'+(r?.phoneLast4??last4Of(r?.phone));
// 저장된 기록으로 잇는 것은 마지막 원문 수집일부터 이 날수 안에서만입니다(오래되면 나간 학생 자리를 새 학생이 이어받을 수 있음).
export const STORED_MATCH_DAYS=7;
const dayGap=(a,b)=>(Date.parse(a)-Date.parse(b))/86400000;
// 가린 줄 → 저장된 학생. links: 이 PC의 연결 저장소(createLinkStore), identities: 이 반 학생 키 → {name, phoneLast4, date}(저장된 원문),
// lastPlain: 이 반을 마지막으로 원문으로 읽은 날 {date, keys}. date: 읽는 날. 결과는 줄마다 {studentKey, name, phoneLast4} 또는 {skip: 'unlinked'|'mismatch'}.
// 저장된 기록으로 새로 잇는 것(stored-match)은 아래가 모두 맞을 때만입니다(검토 3):
// 첫 글자+끝 4자리가 이 반의 모든 기록에서 하나, 그 학생이 마지막 원문 수집일에 있었고 그날 이후에도 기록됨, 읽는 날이 그날부터 7일 안,
// 오늘 표에서도 하나, 그 학생이 다른 번호와 이어져 있지 않음.
export function resolveMasked({classId,rows,entries,links,identities=new Map(),lastPlain=null,date=null}){
  const out=[],pool=[...identities].map(([studentKey,v])=>({studentKey,...v}));
  const plainDate=typeof lastPlain?.date==='string'?lastPlain.date:null,recent=!!plainDate&&!!date&&dayGap(date,plainDate)<=STORED_MATCH_DAYS;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],entry=entries[i],attendeeId=attendeeOf(entry);
    if(row.kind!=='masked'&&row.kind!=='plain'||!attendeeId){out.push({skip:'unlinked'});continue;}
    const link=links?.link?.(classId,attendeeId);
    if(link){
      const who=identities.get(link.studentKey);
      if(!who){out.push({skip:'unlinked'});continue;}
      if(!nameFits(row.name,who.name)||last4Of(row.phone)!==who.phoneLast4){out.push({skip:'mismatch'});continue;}
      out.push({studentKey:link.studentKey,name:who.name,phoneLast4:who.phoneLast4,attendeeId,source:link.source});continue;
    }
    const prefix=shownPrefix(row.name),last4=last4Of(row.phone);
    const found=pool.filter(p=>p.name.startsWith(prefix)&&p.phoneLast4===last4);
    const who=found.length===1?found[0]:null;
    const uniqueInHistory=!!who&&pool.filter(p=>p.name[0]===who.name[0]&&p.phoneLast4===last4).length===1;
    const uniqueToday=rows.filter(r=>sameSig(r,row)).length===1;
    // 마지막 원문 수집일에 있었고(그날 이후에도 기록됨) 그날이 오래되지 않았을 때만(나간 학생 자리에 온 새 학생을 막음, 검토 3)
    const onLastPlainDay=!!who&&recent&&!!lastPlain?.keys?.has?.(who.studentKey)&&String(who.date||'')>=plainDate;
    const free=!!who&&!links?.attendee?.(classId,who.studentKey);
    if(!(who&&uniqueInHistory&&uniqueToday&&onLastPlainDay&&free)||!links?.match?.(classId,attendeeId,who.studentKey)){out.push({skip:'unlinked'});continue;}
    out.push({studentKey:who.studentKey,name:who.name,phoneLast4:who.phoneLast4,attendeeId,source:'stored-match'});
  }
  return out;
}
// 그날 표에서 첫 글자+끝 4자리가 다른 학생과 같은 학생 키들(rows: 원문 기록, 전화 없이 phoneLast4만 있음)
export function sharedSigKeys(rows){
  const n=new Map();for(const r of rows){const s=plainSig(r);n.set(s,(n.get(s)||0)+1);}
  return new Set(rows.filter(r=>n.get(plainSig(r))>1).map(r=>r.studentKey));
}
// 원문 화면에서 배울 연결: 순번으로 맞춘 항목의 attendeeId → 표의 학생 키. 그날 첫 글자+끝 4자리가 둘 이상이면
// 화면 데이터가 원문이고 전체 키가 같을 때만 배웁니다(검토 5, 잘못 배운 연결은 오래 믿게 됨).
// 서명은 기록이 실제로 가진 값(이름 첫 글자·phoneLast4)으로 봅니다: 기록에는 전화 전체가 없습니다.
export function linkPairs(rows,entries,keyOf){
  const pairs=[],shared=sharedSigKeys(rows);
  for(let i=0;i<rows.length;i++){
    const row=rows[i],entry=entries[i],attendeeId=attendeeOf(entry);if(!attendeeId||!row.studentKey)continue;
    const unique=!shared.has(row.studentKey);
    const plainData=!hasMask(entry.name)&&!hasMask(entry.phone)&&digits(entry.phone).length>=9;
    if(!unique&&!(plainData&&keyOf(String(entry.name).trim(),entry.phone)===row.studentKey))continue;
    pairs.push({attendeeId,studentKey:row.studentKey,i});
  }
  return pairs;
}
// 가린 화면의 관리자 메모에 별이 2개 이상 이어지면 가려졌을 수 있습니다(Cowork: 지금은 가리지 않음). 저장된 같은 메모일 때만 믿습니다(검토 1).
export const maskedMemo=v=>/\*{2,}/.test(String(v??''));
// 해제 사유: 기다리는 실제 일로 만듭니다(10자 이상). 할 일이 없으면 null(해제하지 않음).
// writes: 가림 때문에 기다리는 수정 요청 수, pending: 그중 아직 승인 전(중계가 확인 뒤 승인·반영)인 수, unlinked: 연결 확인할 학생 수.
// 승인 전 요청을 '승인된'이라고 쓰지 않습니다(사람이 체크히어 기록에 남는 이 글을 미리 보고 누릅니다).
// setup: 2기 처음 설치 모드에서 아직 확인하지 않은 반 수(교육생 명단·체크히어 학생 번호를 원문으로 한 번 확인, setup.mjs).
export function unmaskReason({writes=0,pending=0,unlinked=0,setup=0}={}){
  const w=Math.max(0,Number(writes)||0),p=Math.min(w,Math.max(0,Number(pending)||0)),u=Math.max(0,Number(unlinked)||0),s=Math.max(0,Number(setup)||0),parts=[];
  if(w)parts.push(`체크히어 출결 수정 요청 ${w}건 반영${p?`(승인 대기 ${p}건 포함)`:''}`);
  if(u)parts.push(`${w?'':'체크히어 '}학생 연결 확인 ${u}명 수집`);
  if(s)parts.push(`2기 교육생 명단 확인 ${s}개 반`);
  return parts.length?`${parts.join('·')}(연결 프로그램)`:null;
}
