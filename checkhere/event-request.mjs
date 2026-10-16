// 순차 수정(2026-10-16, 4-2): 승인된 변경 하나를 체크히어 자신의 변경·삭제 요청(history/event/update·delete) 본문으로 만들고,
// 사람이 해제해 둔 연결 프로그램의 그 탭(로그인된 체크히어 화면) 안에서 보냅니다. 수정창으로 할 때와 같은 주소·본문·관리자 세션이므로
// 체크히어의 관리자 수정 기록도 같게 남습니다(우회·은폐 없음).
// - 형식: 2026-10-16 실제 기록(docs/cowork/2026-10-16-checkhere-write-format.md 2·2-1·2-3)의 방식·주소·본문 키를 내장(BUILTIN_FORMAT)해 기록 없이도 씁니다.
//   사람이 「형식 기록」으로 새로 적은 형식(format-record.mjs)이 있으면 그 종류는 그것이 우선합니다. 키가 다르면 보내지 않습니다.
// - 헤더: 화면이 스스로 관리자 API에 보내는 요청의 인증·가림 헤더(authorization, x-privacy-browser-session, x-privacy-unmask-session)를
//   그 탭 안의 장치(privacyHook)가 닫힌 변수에만 두고, 순차 요청도 그 탭 안에서 같은 헤더로 보냅니다. 우리 코드는 값을 돌려받지 않고(evaluate 결과는 있음/없음·상태·code만)
//   읽거나 적거나 저장하지도 않습니다. 다만 Playwright가 화면의 요청·응답 사건(수집기 watch·쓰기 확인 guarded)을 넘길 때 요청 머리(헤더 값 포함)가 연결 프로그램 프로세스 메모리를 잠시 지납니다(우리 코드는 그 헤더를 보지 않음). 해제 헤더가 없으면(사람이 해제하지 않음) 보내지 않습니다 — 체크히어의 가림 확인을 건너뛰지 않습니다.
// - 학생·일정 번호는 이 PC의 연결·그날 화면 데이터에서 가져오고, 밖으로 보내지 않습니다.
export const EVENT_REQUEST_CAPABILITY='event-request-v1';
export const NOT_WIRED='EVENT_REQUEST_NOT_WIRED: 체크히어 요청 형식이 없어 순차 수정을 보내지 않았습니다(수정창 방식은 그대로 쓸 수 있습니다).';
const ORIGIN='https://checkhere-admin-api.ihereapp.com';
const KINDS={update:{method:'PUT',path:'/api/v3/history/event/update'},delete:{method:'DELETE',path:'/api/v3/history/event/delete'}};
const ID=/^[A-Za-z0-9][\w-]{0,79}$/;
// 2026-10-16 실제 체크히어에서 기록한 형식(방식·주소·본문 키만, 값·헤더 없음). 수정: 빈 칸에 넣기는 existEventId null.
export const BUILTIN_FORMAT=Object.freeze({version:1,builtin:true,recordedAt:'2026-10-16',kinds:Object.freeze({
  update:Object.freeze({method:'PUT',origin:ORIGIN,path:KINDS.update.path,keys:Object.freeze(['attendeeId','baseTime','existEventId','memoByAdmin','scheduleId','time','typeEvent'])}),
  delete:Object.freeze({method:'DELETE',origin:ORIGIN,path:KINDS.delete.path,keys:Object.freeze(['attendeeId','baseTime','existEventId','scheduleId','typeEvent'])})})});
// 기록한 형식이 있으면 그 종류만 내장 형식 위에 덮습니다.
export const formatWith=recorded=>({...BUILTIN_FORMAT,...(recorded&&typeof recorded==='object'?recorded:{}),kinds:{...BUILTIN_FORMAT.kinds,...(recorded?.kinds&&typeof recorded.kinds==='object'?recorded.kinds:{})}});
// 화면이 시간 기준을 다시 읽게 하는 두 라디오(읽기만 바뀜, 연장·종료·이동 없음). 해제 헤더를 아직 못 봤을 때 한 번 바꿨다 되돌립니다.
export const BASIS_LABELS=['실제 시간 기반','강의 출석/퇴실 허용 시간 기반'];
// 체크히어 탭 안에서만 도는 장치(addInitScript·evaluate로 넣음, 여러 번 넣어도 한 번만). 이 함수는 화면 안으로 그대로 옮겨지므로 바깥 변수를 쓰지 않습니다.
// 관리자 API로 가는 화면 요청의 세 헤더를 닫힌 변수(kept)에만 둡니다. 바깥에는 seen()(있음/없음·시각)과 send()(결과 ok·status·code)만 보입니다.
export function privacyHook(){
  if(window.__hintPrivacy||location.origin!=='https://check.ihereapp.com')return;
  const ADMIN='https://checkhere-admin-api.ihereapp.com/',NAMES=['authorization','x-privacy-browser-session','x-privacy-unmask-session'];
  const WRITE=/^https:\/\/checkhere-admin-api\.ihereapp\.com\/api\/v3\/history\/event\/(?:update|delete)$/;
  let kept={},at=0,n=0;const send0=window.fetch.bind(window);
  const pairsOf=h=>{try{if(!h)return [];if(typeof Headers!=='undefined'&&h instanceof Headers)return [...h.entries()];return Array.isArray(h)?h:Object.entries(h);}catch{return [];}};
  // 인증 헤더가 있는 마지막 요청의 것으로 바꿉니다(다시 가려져 해제 헤더가 빠지면 보내지 않게).
  const take=(url,pairs)=>{try{if(!String(url||'').startsWith(ADMIN))return;const got={};for(const [k,v] of pairs){const name=String(k).toLowerCase();if(NAMES.includes(name)&&v)got[name]=String(v);}if(got.authorization){kept=got;at=Date.now();n++;}}catch{}};
  window.fetch=function(input,init){try{take(typeof input==='string'?input:input?.url,[...pairsOf(input?.headers),...pairsOf(init?.headers)]);}catch{}return send0(input,init);};
  const X=XMLHttpRequest.prototype,open=X.open,set=X.setRequestHeader,xsend=X.send,meta=new WeakMap();
  X.open=function(m,u,...rest){meta.set(this,{url:String(u),h:[]});return open.call(this,m,u,...rest);};
  X.setRequestHeader=function(k,v){meta.get(this)?.h.push([k,v]);return set.call(this,k,v);};
  X.send=function(b){const x=meta.get(this);if(x)take(x.url,x.h);return xsend.call(this,b);};
  Object.defineProperty(window,'__hintPrivacy',{configurable:false,enumerable:false,writable:false,value:Object.freeze({
    seen:()=>({auth:!!kept.authorization,browser:!!kept['x-privacy-browser-session'],unmask:!!kept['x-privacy-unmask-session'],at,n}),
    send:async(method,url,body)=>{
      if(!WRITE.test(String(url))||!['PUT','DELETE'].includes(method))return {ok:false,code:'FORMAT'};
      if(!kept.authorization||!kept['x-privacy-unmask-session'])return {ok:false,code:'HEADERS'};
      try{
        const r=await send0(url,{method,headers:{...kept,'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(30000)});
        let code=null;try{const j=await r.json();code=typeof j?.code==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(j.code)?j.code:null;}catch{}
        return {ok:r.ok,status:r.status,code};
      }catch{return {ok:false,code:'NETWORK'};}
    }})});
}
// 그날 화면 데이터(순번으로 맞춘 그 학생 항목)에서 이 칸의 체크히어 기록: 1교시는 ATTEND(교시 0, PASS는 입실에서 계산된 것이라 번호 없음), 퇴실은 첫 COMPLETE.
export function eventOf(entry,field){
  const list=Array.isArray(entry?.eventList)?entry.eventList:[];
  return field==='exit'?list.find(e=>e?.type==='COMPLETE')||null:list.find(e=>e?.type==='ATTEND'&&(e.timeIndex??0)===0)||null;
}
// 기준 시간: 그 칸의 기존 기록(1교시는 ATTEND·PASS)의 baseTime, 없으면 강의 시간(09:00 ~ 18:00)의 시작·끝.
function baseTimeOf(entry,field,date,schedule){
  const list=Array.isArray(entry?.eventList)?entry.eventList:[];
  const e=field==='exit'?list.find(x=>x?.type==='COMPLETE'):list.find(x=>['ATTEND','PASS'].includes(x?.type)&&(x.timeIndex??0)===0);
  if(typeof e?.baseTime==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(e.baseTime))return e.baseTime;
  const m=/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/.exec(String(schedule||''));if(!m)return null;
  const [h,mm]=field==='exit'?[m[3],m[4]]:[m[1],m[2]];return `${date}T${h.padStart(2,'0')}:${mm}:00`;
}
// 기록된 형식(format.kinds[op])을 확인합니다: 체크히어 주소·방식이 아니면 쓰지 않습니다(파일을 바꿔 다른 곳으로 보내지 못하게).
export function formatFor(format,op){
  const f=format?.kinds?.[op],k=KINDS[op];if(!f||!k)throw new Error(NOT_WIRED);
  if(f.origin!==ORIGIN||f.path!==k.path||f.method!==k.method||!Array.isArray(f.keys))throw new Error('EVENT_REQUEST_FORMAT: 기록된 요청 형식의 주소·방식이 체크히어 것과 달라 보내지 않았습니다. 형식을 다시 기록해 주세요.');
  return f;
}
// 본문 만들기(10/14 체크히어 코드 기준): scheduleId·typeEvent·attendeeId·baseTime·existEventId, 변경은 time·memoByAdmin(빈 메모는 null).
// 만든 키가 기록된 키와 하나라도 다르면 보내지 않습니다.
export function buildBody(format,{op,field,scheduleId,attendeeId,date,entry,schedule,time,memo}){
  const f=formatFor(format,op),k=KINDS[op];
  if(!ID.test(String(scheduleId||''))||!ID.test(String(attendeeId||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('EVENT_REQUEST_TARGET: 학생·일정 번호를 확인하지 못해 보내지 않았습니다. 다시 수집해 주세요.');
  const baseTime=baseTimeOf(entry,field,date,schedule);if(!baseTime)throw new Error('EVENT_REQUEST_TARGET: 기준 시간을 확인하지 못해 보내지 않았습니다.');
  const body={scheduleId,typeEvent:field==='exit'?'COMPLETE':'ATTEND',attendeeId,baseTime,existEventId:eventOf(entry,field)?.eventId??null};
  if(op==='update'){
    if(!/^\d{2}:\d{2}:\d{2}$/.test(String(time||'')))throw new Error('EVENT_REQUEST_TARGET: 넣을 시간을 확인하지 못해 보내지 않았습니다.');
    body.time=`${date}T${time}`;body.memoByAdmin=memo===''||memo===null||memo===undefined?null:String(memo);
  }else if(!body.existEventId)throw new Error('TIME_DELETE_REFUSED: 기록 번호가 없는 칸은 지우지 않습니다.');
  const keys=Object.keys(body).sort();
  if(keys.join()!==[...f.keys].sort().join())throw new Error('EVENT_REQUEST_FORMAT: 기록된 요청 형식과 본문 항목이 달라 보내지 않았습니다. 형식을 다시 기록해 주세요.');
  return {method:k.method,url:ORIGIN+k.path,body};
}
// 돌아온 값에서 성공 여부·상태 번호·code만 남깁니다(헤더·토큰·응답 글은 화면 밖으로 나오지 않음).
const outcome=r=>({ok:r?.ok===true,...(Number.isInteger(r?.status)?{status:r.status}:{}),code:typeof r?.code==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(r.code)?r.code:null});
// 이 탭에서 사람이 해제한 헤더(인증·해제 세션)를 화면 장치가 보았는지(있음/없음만). 못 봤으면 시간 기준 라디오를 한 번 바꿨다 되돌려 화면이 다시 읽게 하고 잠깐 기다립니다.
export async function privacyHeaders(page,{waitMs=3000}={}){
  if(typeof page?.evaluate!=='function')return false;
  const seen=()=>page.evaluate(()=>{const s=window.__hintPrivacy?.seen();return s?{auth:s.auth===true,unmask:s.unmask===true,n:Number(s.n)||0}:null;}).catch(()=>null);
  await page.evaluate(privacyHook).catch(()=>{});
  let s=await seen();if(s?.auth&&s.unmask)return true;
  const flip=to=>page.evaluate(([labels,to])=>{const radio=t=>[...document.querySelectorAll('label')].find(l=>l.textContent.replace(/\s+/g,' ').trim()===t)?.querySelector('input[type="radio"]');const a=radio(labels[0]),b=radio(labels[1]);if(!a||!b)return null;
    // 둘 다 안 골라져 있으면 끝에 '실제 시간 기반'이 골라지게 합니다(수집기가 쓰는 표시).
    if(to==='other'){const now=a.checked?a:b.checked?b:null;if(!now){b.click();return 0;}(now===a?b:a).click();return now===a?0:1;}(to===0?a:b).click();return to;},[BASIS_LABELS,to]).catch(()=>null);
  const before=s?.n||0,back=await flip('other');if(back===null)return false;
  for(const until=Date.now()+Math.min(1500,waitMs);Date.now()<until&&((await seen())?.n||0)<=before;)await new Promise(r=>setTimeout(r,100));
  await flip(back);
  for(const until=Date.now()+waitMs;Date.now()<until;){await new Promise(r=>setTimeout(r,150));s=await seen();if(s?.auth&&s.unmask)return true;}
  return false;
}
// 로그인·해제된 체크히어 화면 안에서 보냅니다. 헤더는 화면 장치 안에만 있고 돌아오는 것은 성공 여부·상태 번호·code뿐입니다.
export async function sendEvent(page,{method,url,body}){
  if(!/^https:\/\/checkhere-admin-api\.ihereapp\.com\/api\/v3\/history\/event\/(?:update|delete)$/.test(url)||!['PUT','DELETE'].includes(method))throw new Error('EVENT_REQUEST_FORMAT: 체크히어 변경·삭제 주소가 아니라 보내지 않았습니다.');
  await page.evaluate(privacyHook).catch(()=>{});
  return outcome(await page.evaluate(async({method,url,body})=>window.__hintPrivacy?window.__hintPrivacy.send(method,url,body):{ok:false,code:'HEADERS'},{method,url,body}));
}
// 보낸 결과가 성공이 아닐 때의 글(이름·번호 없음). 실제 저장 여부는 늘 다시 읽어 판단합니다(writeback.applyVerified).
export function requestError(result){
  if(result?.code==='HEADERS')return 'EVENT_REQUEST_HEADERS: 체크히어 화면의 해제 헤더(사람이 그 탭에서 해제한 세션)를 확인하지 못해 보내지 않았습니다. 수집 PC의 체크히어 탭에서 마스킹 해제(또는 연장)를 확인한 뒤 다시 반영해 주세요.';
  if(result?.code==='FORMAT')return 'EVENT_REQUEST_FORMAT: 체크히어 변경·삭제 주소가 아니라 보내지 않았습니다.';
  if(result?.code==='NETWORK')return 'EVENT_REQUEST_FAILED: 체크히어 요청이 끝나지 않았습니다(연결 오류). 다시 읽어 결과를 확인합니다.';
  return `EVENT_REQUEST_FAILED: 체크히어가 요청을 받지 않았습니다(상태 ${Number(result?.status)||'?'}${result?.code?` · ${result.code}`:''}).`;
}
