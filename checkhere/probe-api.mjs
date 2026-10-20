// Read-only diagnosis of CheckHere masking (2026-10-15: CheckHere now masks names, phones and student memos).
// It opens two class days the way the collector does and reads only the attendance-detail response the
// CheckHere page itself downloads (page.waitForResponse, as collector.openDayOnce does). It sends no request
// of its own: no session token, no direct CheckHere address, no unmasking.
// The report keeps statuses, key paths, types, counts and yes/no answers: no names, phone digits,
// memo text, times, id values or tokens. Nothing is changed in CheckHere or in collected records.
import {validIso,isHoliday} from './cohort-bridge.mjs';
export const API_PROBE_VERSION='20261015.2';
export const API_PROBE_CAPABILITY='api-probe-v1';
const PAGE_ORIGIN='https://check.ihereapp.com',API_ORIGIN='https://checkhere-admin-api.ihereapp.com',API_PREFIX='/api/v3/';
const ID=/^[A-Za-z0-9][\w-]{0,79}$/;
// 날짜: 달력에 있는 날(YYYY-MM-DD, cohort-bridge.validIso).
export const validDate=validIso;
// 출결상세 주소 → 반·날짜 번호(검사만 하고 보고서에는 적지 않음).
export function dayIds(raw){
  let u;try{u=new URL(String(raw||'').trim());}catch{return null;}
  if(u.origin!==PAGE_ORIGIN||u.pathname!=='/history/lecture/modify')return null;
  const q=k=>u.searchParams.get(k)||'',d={url:u.href,academyId:q('academyId'),lectureId:q('lectureId'),scheduleId:q('scheduleId'),date:q('scheduleDate')};
  return ID.test(d.academyId)&&ID.test(d.lectureId)&&ID.test(d.scheduleId)&&validDate(d.date)?d:null;
}
// 화면이 스스로 부른 체크히어 요청은 이 틀 이름으로만 셉니다(그 밖은 {other}). 번호·이름·전화번호가 든 주소 조각은 남지 않습니다.
const TEMPLATES=['history/attendee/detail/academy/{id}/schedule/{id}/type/STUDENT/isRealTime/false','history/attendee/detail/academy/{id}/schedule/{id}/type/STUDENT/isRealTime/true',
  'history/attend/detail/lecture/academy/{id}/schedule/{id}','history/attend/times/academy/{id}/lecture/{id}/date/{id}','schedule/list/lecture/{id}/start/{id}/end/{id}',
  'history/event/update','history/event/delete','history/event/normalize','history/leave/recognize'];
const TEMPLATE_RE=TEMPLATES.map(t=>[t,new RegExp('^'+t.replaceAll('{id}','[^/]+')+'$')]);
export function endpointOf(raw){
  let u;try{u=new URL(raw);}catch{return '{other}';}
  if(u.origin!==API_ORIGIN||!u.pathname.startsWith(API_PREFIX))return '{other}';
  const p=u.pathname.slice(API_PREFIX.length);return (TEMPLATE_RE.find(([,r])=>r.test(p))?.[0]||'{other}')+(u.search?'?…':'');
}
// 기본 날짜: 오늘(한국 시간, 주말이면 직전 금요일)과 그 앞 평일.
export const kstDate=(now=new Date())=>now.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
// 앞 교육일 후보: 주말과 2기 휴일(12/25·12/31·1/1)을 건너뜁니다.
export function previousWeekday(d){const t=new Date(d+'T00:00:00Z');do t.setUTCDate(t.getUTCDate()-1);while([0,6].includes(t.getUTCDay())||isHoliday(t.toISOString().slice(0,10)));return t.toISOString().slice(0,10);}
export function defaultDates(now=new Date()){let d=kstDate(now);if([0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())||isHoliday(d))d=previousWeekday(d);return {date1:d,date2:previousWeekday(d)};}
// 화면 가림은 학생 명단 표(collector.tableRecords와 같은 칸: 첫 표, 3번째 칸 성명, 4번째 칸 전화번호)의 개수로 정합니다.
// 전화번호 칸에 '*'가 있으면 가림, 숫자 9자리 이상이면 원문. 해제 버튼(글자가 똑같은 것)은 참고로만 남깁니다.
export function maskState({table=false,rows=0,phoneMasked=0,phonePlain=0,nameMasked=0,button=false}={}){
  const masked=!table||!rows?null:phoneMasked&&!phonePlain?true:phonePlain&&!phoneMasked&&!nameMasked?false:null;
  return {masked,table,rows,phoneMasked,phonePlain,nameMasked,button};
}

const MAX_NODES=200000,MAX_DEPTH=16,MAX_PATHS=150;
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const typeOf=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const counter=()=>Object.create(null);
// 10/14 보고서의 출결상세 항목 이름은 그대로 적습니다. 다른 키는 필드 이름 모양(영문 소문자로 시작, 숫자·기호 없음)이고
// 같은 자리의 객체 2개 이상에 있을 때만 적습니다. 값으로 만든 키(이름·로그인 id·전화번호·id·날짜)는 {key}입니다.
const KNOWN=new Set(['txid','code','message','description','timestamp','data','countMap','ENTER','PASS','COMPLETE','ATTEND','eventResultList','scheduleDate','sequence','attendeeId','typeAttendee','name','userName','phone','identifier','duration','seconds','leaveEvents','totalLeavedDuration','totalLeavedSeconds','pairs','eventList','eventId','userId','time','baseTime','timeIndex','type','isRecognized','status','memoByAdmin','updatedAt']);
const FIELD=/^[a-z][a-zA-Z]{1,39}$/;
export const keyName=(k,repeated=false)=>typeof k==='number'?'[]':/^\d+$/.test(k)?'{n}':KNOWN.has(k)||repeated&&FIELD.test(k)?k:'{key}';
const SEP='\u0001',AT='\u0000';
// 같은 자리(배열 항목은 한 자리)의 객체 몇 개가 그 키를 갖는지. 원래 키는 메모리에서만 씁니다.
function keyCounts(json){
  const n=new Map();let nodes=0;
  const visit=(v,at,depth)=>{
    if(++nodes>MAX_NODES||depth>MAX_DEPTH)return;
    if(Array.isArray(v)){for(const x of v){if(nodes>MAX_NODES)break;visit(x,at+SEP+'[]',depth+1);}}
    else if(isObj(v))for(const [k,x] of Object.entries(v)){if(nodes>MAX_NODES)break;const id=at+AT+k;n.set(id,(n.get(id)||0)+1);visit(x,at+SEP+k,depth+1);}
  };
  visit(json,'',0);return n;
}
const childName=(counts,at,k)=>keyName(k,(counts.get(at+AT+k)||0)>=2);
// Enum-like tokens only (ENTER, NORMAL, 0, true); anything else is {text}.
const token=v=>v===null||v===undefined?'null':typeof v==='boolean'?String(v):typeof v==='number'&&Number.isInteger(v)&&Math.abs(v)<1000?String(v):typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,30}$/.test(v)?v:'{text}';
const filled=v=>v!==null&&v!==undefined&&typeof v!=='object'&&String(v).trim()!=='';
const textState=v=>!filled(v)?'empty':String(v).includes('*')?'masked':'plain';
// 전화번호는 '*'가 있거나 숫자가 9자리보다 적으면 가림(학생을 가를 수 없음).
const phoneState=v=>!filled(v)?'empty':String(v).includes('*')||String(v).replace(/\D/g,'').length<9?'masked':'plain';
const NAME=/^(?:user|student|attendee|full|real|masked)?name$/i,PHONE=/phone|mobile|cell|^tel(?:no)?$|^hp$/i,MEMO=/memo|identifier|remark|note|comment/i,IDKEY=/^(?:id|uuid)$|(?:Id|ID|_id|Uuid)$/;

// Key paths with their types and counts; '*' strings are counted, never kept.
export function shapeOf(json,counts=keyCounts(json)){
  const map=new Map();let nodes=0,truncated=false;
  const visit=(v,p,at,depth)=>{
    if(++nodes>MAX_NODES||depth>MAX_DEPTH){truncated=true;return;}
    const t=typeOf(v);let s=map.get(p);
    if(!s){if(map.size>=MAX_PATHS)truncated=true;else map.set(p,s={path:p,types:[],count:0});}
    if(s){s.count++;if(!s.types.includes(t))s.types.push(t);if(t==='string'&&v.includes('*'))s.masked=(s.masked||0)+1;if(t==='array'){s.minLength=Math.min(s.minLength??v.length,v.length);s.maxLength=Math.max(s.maxLength??0,v.length);}}
    if(t==='array'){for(const x of v){if(nodes>MAX_NODES)break;visit(x,p+'[]',at+SEP+'[]',depth+1);}}
    else if(t==='object')for(const [k,x] of Object.entries(v)){if(nodes>MAX_NODES)break;visit(x,p+'.'+childName(counts,at,k),at+SEP+k,depth+1);}
  };
  visit(json,'$','',0);return {paths:[...map.values()],truncated};
}
// Arrays of student-like objects (a name, phone or attendeeId key), grouped by key path.
function recordArrays(json,counts){
  const groups=new Map();let nodes=0;
  const visit=(v,p,at,depth)=>{
    if(++nodes>MAX_NODES||depth>MAX_DEPTH)return;
    if(Array.isArray(v)){
      const objs=v.filter(isObj);
      if(objs.some(o=>Object.keys(o).some(k=>NAME.test(k)||PHONE.test(k)||k==='attendeeId'))){if(!groups.has(p))groups.set(p,[]);for(const o of objs)groups.get(p).push(o);return;}
      for(const x of v){if(nodes>MAX_NODES)break;visit(x,p+'[]',at+SEP+'[]',depth+1);}
    }else if(isObj(v))for(const [k,x] of Object.entries(v)){if(nodes>MAX_NODES)break;visit(x,p+'.'+childName(counts,at,k),at+SEP+k,depth+1);}
  };
  visit(json,'$','',0);return groups;
}
const seenKeys=list=>{const n=counter();for(const o of list)if(isObj(o))for(const k of Object.keys(o))n[k]=(n[k]||0)+1;return k=>keyName(k,(n[k]||0)>=2);};
function addEvents(events,key,list,users,evName){
  let ev=events.get(key);if(!ev)events.set(key,ev={key,lists:0,emptyLists:0,events:0,keys:[],types:counter()});
  ev.lists++;if(!list.length)ev.emptyLists++;
  for(const e of list){
    if(!isObj(e))continue;ev.events++;
    for(const k of Object.keys(e)){const n=evName(k);if(!ev.keys.includes(n)&&ev.keys.length<40)ev.keys.push(n);}
    const t=ev.types[token(e.type)]??={count:0,eventId:0,noEventId:0,memo:0,memoMasked:0,noMemo:0};t.count++;
    const idKey='eventId' in e?'eventId':Object.keys(e).find(k=>/^(?:event)?id$/i.test(k));
    if(idKey){if(filled(e[idKey]))t.eventId++;else t.noEventId++;}
    const memoKey='memoByAdmin' in e?'memoByAdmin':Object.keys(e).find(k=>/memo/i.test(k)),m=memoKey?textState(e[memoKey]):'empty';
    if(m==='empty')t.noMemo++;else{t.memo++;if(m==='masked')t.memoMasked++;}
    if(filled(e.userId))users.add(String(e.userId));
  }
}
const idRank=k=>/attendee/i.test(k)?0:/student/i.test(k)?1:/user/i.test(k)?2:3;
function studentGroup(path,list){
  const fields=new Map(),ids=new Map(),events=new Map(),otherMasked=counter(),perRecord=[],userIds={one:0,several:0,none:0},name=seenKeys(list);
  // Event lists: keys holding objects with a type in any record (empty lists of those keys count too).
  const eventKeys=new Set();for(const r of list)for(const [k,v] of Object.entries(r))if(Array.isArray(v)&&v.some(e=>isObj(e)&&'type' in e))eventKeys.add(k);
  const evName=seenKeys(list.flatMap(r=>[...eventKeys].flatMap(k=>Array.isArray(r[k])?r[k]:[])));
  for(const r of list){
    const users=new Set();
    for(const [k,v] of Object.entries(r)){
      const key=name(k),scalar=!isObj(v)&&!Array.isArray(v);
      const kind=!scalar?null:NAME.test(k)?'name':PHONE.test(k)?'phone':MEMO.test(k)?'memo':null;
      if(kind){let f=fields.get(key);if(!f)fields.set(key,f={key,kind,masked:0,plain:0,empty:0});f[kind==='phone'?phoneState(v):textState(v)]++;}
      else if(typeof v==='string'&&v.includes('*'))otherMasked[key]=(otherMasked[key]||0)+1;
      if(scalar&&IDKEY.test(k)){if(!ids.has(k))ids.set(k,[]);if(filled(v))ids.get(k).push(String(v));}
      if(Array.isArray(v)&&eventKeys.has(k))addEvents(events,key,v,users,evName);
    }
    if(filled(r.userId)){users.clear();users.add(String(r.userId));}
    perRecord.push({r,users});userIds[users.size===1?'one':users.size>1?'several':'none']++;
  }
  const idInfo=[...ids].map(([k,vals])=>{const n=new Set(vals).size;return {raw:k,key:name(k),present:vals.length,missing:list.length-vals.length,unique:n===vals.length,duplicates:vals.length-n};});
  const attendeeRaw=ids.has('attendeeId')?'attendeeId':idInfo.filter(i=>!i.missing&&i.unique&&i.present).map(i=>i.raw).sort((a,b)=>idRank(a)-idRank(b))[0]||null;
  // 번호끼리만 비교하는 데 쓰는 값(보고서에는 넣지 않음): 학생 번호 목록, 번호 → userId 한 개.
  const internal={path,attendee:attendeeRaw?ids.get(attendeeRaw):null,users:new Map()};
  if(attendeeRaw)for(const {r,users} of perRecord)if(filled(r[attendeeRaw])&&users.size===1)internal.users.set(String(r[attendeeRaw]),[...users][0]);
  return {report:{path,records:list.length,fields:[...fields.values()],otherMasked,ids:idInfo.map(({raw,...i})=>i),attendeeKey:attendeeRaw&&name(attendeeRaw),userIdPerStudent:userIds,events:[...events.values()]},internal};
}
// One response body → value-free shape and student statistics, plus id lists kept in memory for comparison only.
export function analyzeBody(json){
  const counts=keyCounts(json),students=[],internal=[];
  for(const [path,list] of recordArrays(json,counts)){const g=studentGroup(path,list);students.push(g.report);internal.push(g.internal);}
  return {shape:shapeOf(json,counts),students,internal};
}
export const apiCode=json=>isObj(json)&&'code' in json?token(json.code):undefined;
// 출결상세 응답 하나 → 보고서 항목과 비교용 번호(메모리에만). 응답 날짜가 연 날짜와 같은지는 예/아니오만 남깁니다.
export function responseEntry(json,date){
  const a=analyzeBody(json),code=apiCode(json),response={dateMatches:isObj(json?.data)&&json.data.scheduleDate===date,shape:a.shape,students:a.students};
  if(code!==undefined)response.apiCode=code;
  return {response,internal:a.internal.find(g=>g.attendee)||null};
}
// Two reads compared by student id only (names and phones are never compared).
export function compareIds(a,b){
  if(!a?.attendee||!b?.attendee)return null;
  const A=new Set(a.attendee),B=new Set(b.attendee);let common=0;for(const x of A)if(B.has(x))common++;
  let compared=0,same=0;for(const [id,u] of a.users)if(b.users.has(id)){compared++;if(b.users.get(id)===u)same++;}
  return {first:A.size,second:B.size,common,onlyFirst:A.size-common,onlySecond:B.size-common,userIdCompared:compared,userIdSame:same,userIdDifferent:compared-same};
}
const KINDS=['name','phone','memo'];
export function apiVerdict(r){
  const days=r.days||[],main=days.filter(d=>d.response?.ok&&d.response.students?.length);
  const count=(kind,list=main)=>{const o={masked:0,plain:0,empty:0};for(const d of list)for(const s of d.response.students||[])for(const f of s.fields)if(f.kind===kind){o.masked+=f.masked;o.plain+=f.plain;o.empty+=f.empty;}o.state=!o.masked&&!o.plain?'unknown':!o.plain?'masked':!o.masked?'plain':'mixed';return o;};
  const groups=main.map(d=>d.response.students.find(s=>s.attendeeKey)).filter(Boolean),idOf=g=>g.ids.find(i=>i.key===g.attendeeKey);
  // 번호가 빠진 학생은 날짜가 달라지면 다시 찾을 수 없으므로 '같음'이 될 수 없습니다.
  const missing=groups.map(g=>idOf(g)?.missing??0),x=r.compare?.acrossDates;
  const complete=days.length===2&&main.length===2&&groups.length===2,dated=complete&&days.every(d=>d.response.dateMatches===true);
  const across=!x||!dated?'unknown':x.userIdDifferent||!x.common?'no':missing.some(Boolean)?'missing':x.common===Math.min(x.first,x.second)?'yes':'partial';
  const pages=days.map(d=>d.page?.masked??null),all=v=>pages.length>0&&pages.every(p=>p===v);
  return {page:all(true)?true:all(false)?false:null,names:count('name'),phones:count('phone'),memos:count('memo'),
    // 화면이 원문으로 확인되지 않은 날에 응답의 이름·전화번호·메모가 원문인지.
    plainUnconfirmed:main.some(d=>d.page?.masked!==false&&KINDS.some(k=>count(k,[d]).plain>0)),
    attendee:{key:groups[0]?.attendeeKey||null,present:main.length>0&&groups.length===main.length&&!missing.some(Boolean),missing,unique:groups.length>0&&groups.every(g=>idOf(g)?.unique===true),acrossDates:across},
    responses:{found:days.filter(d=>d.response?.found).length,ok:main.length,total:days.length}};
}
export function finishReport(report,internal){
  report.compare={acrossDates:compareIds(internal[0],internal[1])};report.verdict=apiVerdict(report);return report;
}
const STATE={masked:'가림',plain:'원문',mixed:'가림·원문 섞임',unknown:'항목 없음'};
const ACROSS={yes:'같음',partial:'일부만 같음',no:'다름',missing:'번호 없는 학생 있음',unknown:'비교 못 함'};
const pageText=p=>p?.masked===true?`가림 (명단 전화번호 가림 ${p.phoneMasked}/${p.rows})`:p?.masked===false?`원문 표시 중 (명단 전화번호 원문 ${p.phonePlain}/${p.rows})`
  :`확인 못 함${p?.table?` (명단 ${p.rows}행: 전화번호 가림 ${p.phoneMasked} · 원문 ${p.phonePlain})`:' (학생 명단 표를 읽지 못함)'}${p?.button?' · 해제 버튼 보임':''}`;
const responseText=x=>!x?.found?'받지 못함':`${x.status??''}${x.realTime?' (실제 시간)':' (허용 시간)'}${!x.ok?' · 읽지 못함':x.dateMatches?'':' · 응답 날짜가 다름'}`;
export function summarizeApi(r){
  const v=r.verdict||apiVerdict(r),a=v.attendee,key=a.key||'attendeeId',x=r.compare?.acrossDates,n=o=>`${STATE[o.state]}(가림 ${o.masked} · 원문 ${o.plain})`;
  const lines=['',`[체크히어 API 진단] ${r.classId}반 · ${r.dates.join(' / ')}`,'- 체크히어에 따로 보낸 요청: 없음 (화면이 스스로 받은 출결상세 응답만 셈)',
    ...r.days.map(d=>`- ${d.day}일째 ${d.date}: 화면 ${pageText(d.page)} · 출결상세 응답 ${responseText(d.response)}`),
    `- 출결상세 응답의 학생 정보: 이름 ${n(v.names)} · 전화번호 ${n(v.phones)} · 메모 ${n(v.memos)}`,
    a.key?`- ${key}: ${a.present?'모든 학생에게 있음':a.missing.some(Boolean)?`없는 학생 있음(${a.missing.map((m,i)=>`${i+1}일째 ${m}명`).join(' · ')})`:'한쪽 날 응답에는 없음'} · 하루 안에서 ${a.unique?'겹침 없음':'겹침 있음'}${x?` · 두 날짜 공통 ${x.common}명(첫날 ${x.first} · 둘째 날 ${x.second}) · userId 짝 같음 ${x.userIdSame}/${x.userIdCompared}`:''}`:'- 학생 번호(attendeeId): 없음'];
  const day=r.days.find(d=>d.day===1&&d.response?.ok)?.response.students?.flatMap(s=>s.events)||[];
  const kinds=day.flatMap(e=>Object.entries(e.types).map(([t,s])=>`${t} ${s.count}(번호 있음 ${s.eventId} · 없음 ${s.noEventId}${s.memo?` · 관리자 메모 ${s.memo}, 가림 ${s.memoMasked}`:''})`));
  if(kinds.length)lines.push(`- 첫째 날 기록 종류: ${kinds.join(' · ')}`);
  if(r.sameLecture===false)lines.push('- 두 날짜의 강의 번호가 다릅니다. 같은 반인지 확인해 주세요.');
  if(v.responses.ok<2)lines.push('=> 화면이 받은 출결상세 응답을 두 날 모두 읽지 못해 비교하지 못했습니다. 전용 크롬의 체크히어 로그인과 화면을 확인해 주세요.');
  else if(a.present&&a.unique&&a.acrossDates==='yes')lines.push(`=> 이름·전화번호 없이 ${key}로 날짜가 달라도 같은 학생을 다시 찾을 수 있어 보입니다.`,
    `=> 수집(읽기)만 해당: 수정·삭제는 여전히 해제가 필요하고, ${key}와 포털 학생(이름·전화번호) 연결은 학생마다 한 번 원문 확인이 필요합니다.`);
  else if(a.present&&a.unique&&a.acrossDates==='partial')lines.push(`=> ${key}가 두 날짜에 일부만 같습니다. 학생 변동 때문인지 확인이 필요합니다.`);
  else lines.push(`=> ${key}만으로 학생을 찾기는 아직 어렵습니다. (두 날짜 비교: ${ACROSS[a.acrossDates]})`);
  if(v.plainUnconfirmed)lines.push('=> 참고: 화면이 원문 표시로 확인되지 않았는데 출결상세 응답의 이름·전화번호·메모에 원문이 있습니다(값은 적지 않았습니다). 이 값을 쓰기 전에 체크히어 이용 조건과 개인정보 접근 기록 기준을 먼저 확인해 주세요.');
  return lines.join('\n');
}

async function readMask(page,waitMs){
  if(waitMs>0)await page.waitForFunction(()=>(document.querySelector('table')?.rows.length||0)>3,null,{timeout:waitMs}).catch(()=>{});
  // Only counts and one yes/no leave the page, never cell text.
  return maskState(await page.evaluate(()=>{
    const out={table:false,rows:0,phoneMasked:0,phonePlain:0,nameMasked:0,button:[...document.querySelectorAll('button,[role=button],a')].some(b=>String(b.textContent||'').replace(/\s+/g,' ').trim()==='개인정보 마스킹 해제')};
    const t=document.querySelector('table');if(!t)return out;
    const rows=[...t.rows].map(r=>[...r.cells].map(c=>String(c.innerText||'').trim())),head=rows[1]||[];
    if(head[2]!=='성명'||head[3]!=='전화번호')return out;out.table=true;
    for(const c of rows.slice(2,-1)){
      out.rows++;const name=c[2]||'',phone=c[3]||'';
      if(phone.includes('*'))out.phoneMasked++;else if(phone.replace(/\D/g,'').length>=9)out.phonePlain++;
      if(name.includes('*'))out.nameMasked++;
    }
    return out;
  }).catch(()=>({})));
}
const settle=(promise,ms)=>{let t;return Promise.race([promise,new Promise(r=>{t=setTimeout(()=>r(null),ms);})]).finally(()=>clearTimeout(t));};
const NO_LECTURE=/강의가 없습니다/;
// 오류 문구에 섞인 주소는 호스트만 남깁니다(번호·날짜가 든 경로와 쿼리는 지움).
export const cleanMessage=m=>String(m||'').replace(/https?:\/\/[^\s'"]+/g,u=>{try{return new URL(u).host+'/…';}catch{return '{url}';}}).slice(0,300);

export async function runApiProbe({collector,classId,date1='',date2='',url=null,now=new Date(),log=()=>{},responseTimeoutMs=20000,bodyTimeoutMs=5000,discoverTimeoutMs=180000,indicatorWaitMs=5000,tries=5}){
  const page=collector.page,pageRequests=counter();
  if(!page)throw Error('LOGIN_REQUIRED: 체크히어 로그인 버튼을 먼저 눌러 주세요.');
  // 화면이 스스로 부른 체크히어 API 요청은 틀 이름과 상태만 셉니다.
  const onResponse=res=>{try{
    const req=res.request();if(!['xhr','fetch'].includes(req.resourceType())||new URL(res.url()).origin!==API_ORIGIN)return;
    const k=`${req.method()} ${endpointOf(res.url())} → ${res.status()}`;pageRequests[k]=(pageRequests[k]||0)+1;
  }catch{}};
  const findDay=async(date,auto)=>{
    for(let i=0;i<(auto?tries:1);i++){
      try{
        const pending=Promise.resolve().then(()=>collector.discover(classId,date)),found=await settle(pending,discoverTimeoutMs);
        if(!found){
          // 기다림만 멈추면 화면 찾기는 전용 크롬을 계속 누릅니다. 끝날 때까지 이 작업이 화면을 잡고 있습니다.
          log('화면 찾기가 멈추기를 기다립니다.');await pending.catch(()=>{});
          throw Error(`${Math.round(discoverTimeoutMs/60000)}분 안에 ${date} 출결상세 화면을 찾지 못했습니다.`);
        }
        const d=dayIds(found);if(!d||d.date!==date)throw Error('출결상세 주소에서 반·날짜 번호를 읽지 못했습니다.');return d;
      }catch(e){if(!auto||!NO_LECTURE.test(e.message))throw e;date=previousWeekday(date);}
    }
    throw Error(`최근 ${tries}일 안에 강의가 있는 날을 찾지 못했습니다. 날짜를 직접 넣어 주세요.`);
  };
  // 하루: 출결상세 화면을 열고, 그때 화면이 스스로 받은 이 일정의 출결상세 응답을 바로 개수로 바꿉니다(값은 버림).
  const readDay=async(day,d)=>{
    const mine=res=>{try{const u=new URL(res.url());return u.origin===API_ORIGIN&&res.request().method()==='GET'&&u.pathname.includes('/history/attendee/detail/')&&u.pathname.includes(`/schedule/${d.scheduleId}/`);}catch{return false;}};
    const waiting=page.waitForResponse(mine,{timeout:responseTimeoutMs}).catch(()=>null);
    await page.goto(d.url);await page.getByRole('table').nth(1).waitFor({state:'visible',timeout:20000}).catch(()=>{});
    const res=await waiting,out={day,date:d.date,page:await readMask(page,indicatorWaitMs),response:{found:!!res}};
    if(!res)return {out,internal:null};
    const r=out.response;Object.assign(r,{status:res.status(),ok:res.ok(),realTime:/\/isRealTime\/true$/.test(new URL(res.url()).pathname),json:/json/i.test(res.headers()['content-type']||'')});
    const buf=r.json?await settle(res.body().catch(()=>null),bodyTimeoutMs):null;let json;
    if(buf){r.bytes=buf.length;try{json=JSON.parse(buf.toString('utf8'));}catch{}}
    if(json===undefined){r.ok=false;r.error=r.json&&!buf?'no-body':'not-json';return {out,internal:null};}
    const e=responseEntry(json,d.date);Object.assign(r,e.response);return {out,internal:e.internal};
  };
  let first,second;const days=[],internal=[];
  page.on('response',onResponse);
  try{
    log('1/4 첫째 날 출결상세 주소를 확인합니다.');
    if(url){first=dayIds(url);if(!first)throw Error('체크히어 출결상세 화면 주소(https://check.ihereapp.com/history/lecture/modify?...)를 확인해 주세요.');}
    else first=await findDay(date1||defaultDates(now).date1,!date1);
    log('2/4 둘째 날 출결상세 주소를 확인합니다.');
    second=await findDay(date2||previousWeekday(first.date),!date2);
    if(first.date===second.date)throw Error('서로 다른 두 날짜를 골라 주세요.');
    if(first.scheduleId===second.scheduleId)throw Error('두 날짜의 출결상세 주소가 같은 일정 번호입니다. 서로 다른 날의 화면인지 확인해 주세요.');
    for(const [i,d] of [first,second].entries()){
      log(`${i+3}/4 ${i+1}일째 화면을 열고 화면이 받은 출결상세를 셉니다.`);
      const x=await readDay(i+1,d);days.push(x.out);internal.push(x.internal);
    }
  }finally{page.off('response',onResponse);}
  return finishReport({apiProbeVersion:API_PROBE_VERSION,createdAt:new Date().toISOString(),classId:String(classId),dates:[first.date,second.date],autoDates:{first:!url&&!date1,second:!date2},
    sameLecture:first.lectureId===second.lectureId&&first.academyId===second.academyId,source:'page-response',days,pageRequests},internal);
}
