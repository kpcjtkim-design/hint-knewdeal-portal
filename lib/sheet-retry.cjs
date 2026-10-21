// /api/teacher-beta → Apps Script 웹앱 호출의 다시 시도 규칙(2026-10-21 부하 시험: 담임 16명 동시 저장 → 8건 'Lock timeout', 23~45초).
// 시트 쪽은 쓰기를 줄 세우기(queue + drain)로 바꾸는 중이고, 잠금 대기를 길게(45초 권장, 55초 예정) 바꿉니다. 웹 쪽은 그동안 잠깐 몰린 오류만 다시 시도합니다.
// - 시간 예산: 함수 시작부터 55초(vercel.json maxDuration 60초 안). 한 번 호출의 fetch 타임아웃은 남은 예산 안에서 정합니다.
// - 다시 시도는 남은 시간이 15초 넘을 때만. '잠금 시간 초과'가 45초 넘게 걸려 왔으면 다시 시도하지 않고 바로 '잠시 뒤 다시 저장' 안내.
// - 지수 백오프 + 전체 지터(0 ~ min(상한, 기본×2^(n-1))).
// - 읽기는 몰림·네트워크·5xx 모두 다시 시도. 쓰기는 '아직 쓰지 않았음'이 분명한 오류만(같은 값을 다시 써도 같은 결과인 쓰기만).
//   새 줄을 만드는 쓰기(서류 신청·민원 접수·답글·중도탈락 신청·앰버서더 추가 등)는 Apps Script가 아예 실행되지 않았음이 분명한 오류(동시 실행 초과·429·503)만.
// 순수 모듈(fetch·시계·sleep·난수를 넣어 시험합니다). api/ 밖에 두어 Vercel 함수로 따로 열리지 않습니다.

const RETRY_POLICY=Object.freeze({
 budgetMs:55000,      // 함수 시작부터 Apps Script 호출을 끝낼 때까지(인증 확인 포함)
 maxAttemptMs:55000,  // 한 번 호출의 최대 타임아웃(남은 예산이 더 작으면 그만큼)
 minRemainingMs:15000,// 다시 시도하려면 기다린 뒤에도 이만큼 남아야 함
 slowLockMs:45000,    // 잠금 시간 초과가 이보다 오래 걸려 왔으면 다시 시도하지 않음(시트가 이미 오래 기다림)
 maxAttempts:5,
 baseMs:500,
 capMs:4000
});

// 읽기: 몇 번을 다시 불러도 시트가 바뀌지 않습니다.
const READ_ACTIONS=new Set(['portalData','portalRoster','b2Bundle','b2Rev','b2Docs','b2Status','b2Vocs','b2ModuleTimes','b2DayTimes','b2LedgerMemos',
 'b2Dropouts','b2Completions','b2Schedule','b2Officers','b2DayMemos']);
// 같은 값을 다시 써도 결과가 같은 쓰기(반·이름·날짜 등으로 찾아 덮어쓰기, 정해진 칸에 값 넣기, was로 그사이 바뀜 확인).
// b2ApplyQueue(쓰기 대기열 묶음, 2026-10-21): 같은 id 항목을 다시 적용해도 결과가 같고, drain 임대 덕에 다른 묶음과 겹치지 않음.
const IDEMPOTENT_WRITES=new Set(['portalSave','portalClose','portalUpdateVoc','portalSaveOfficer','portalSetStatus',
 'b2Save','b2ApplyQueue','b2DocUpdate','b2VocSeen','b2ModuleTimeSave','b2RosterStatus','b2LedgerMemo','b2RosterStatusMany','b2ScheduleSave',
 'b2OfficerEnd','b2RebuildBoards','b2DayMemo']);
// 새 줄·새 번호를 만드는 쓰기: 두 번 실행되면 두 줄이 생길 수 있습니다.
const CREATE_WRITES=new Set(['portalAddRow','b2DocCreate','b2VocCreate','b2VocReply']);

// 'read' | 'write'(다시 써도 같음) | 'create'(한 번만). 모르는 기능은 'create'(가장 조심스럽게).
function actionKind(action,args=[]){
 if(READ_ACTIONS.has(action))return 'read';
 if(IDEMPOTENT_WRITES.has(action))return 'write';
 const p=args?.[0]&&typeof args[0]==='object'?args[0]:{};
 // 중도탈락: 있는 줄 고치기·지우기(row + was)는 그 줄을 찾아 하므로 다시 해도 같음. 새 신청(row 없음)은 새 줄.
 if(action==='b2DropoutSave')return p.row!==undefined&&p.row!==null&&p.row!==''?'write':'create';
 // 반 임원: 앰버서더 추가(kind '추가', 또는 was가 지금 앰버서더 이름 배열인 최초·추가 저장)는 새 사람을 더하는 쓰기. 지정·보궐(was {name})은 그 자리를 바꿈.
 if(action==='b2OfficerSave')return p.kind==='추가'||Array.isArray(p.was)?'create':'write';
 return 'create';
}

// 오류 종류:
//  'not-run'  Apps Script가 실행되지 않음(동시 실행 초과, HTTP 429·503) → 무엇이든 다시 시도
//  'rate'     서비스 호출 몰림(Service invoked too many times) → 읽기·다시 써도 같은 쓰기
//  'lock'     문서 잠금을 얻지 못함(잠금 대기는 쓰기 전에 합니다) → 읽기·다시 써도 같은 쓰기
//  'maybe'    실행 중이었을 수 있음(실행 시간 초과·서비스 장애·5xx·네트워크·타임아웃) → 읽기만
//  null       다시 시도하지 않음(입력 확인 오류·인증·4xx 등)
const NOT_RUN=/too many simultaneous invocations/i;
const RATE=/Service invoked too many times/i;
const LOCK=/Lock timeout|lock for too long/i;
const MAYBE=/Exceeded maximum execution|Service unavailable|temporarily unavailable/i;
const TRANSIENT_MESSAGE=/Lock timeout|lock for too long|too many simultaneous invocations|Service invoked too many times|Exceeded maximum execution|Service unavailable|temporarily unavailable/i;
function classifyFailure({status=0,message='',network=false,timeout=false}={}){
 if(timeout||network)return 'maybe';
 if(status===429||status===503)return 'not-run';
 const m=String(message||'');
 if(NOT_RUN.test(m))return 'not-run';
 if(RATE.test(m))return 'rate';
 if(LOCK.test(m))return 'lock';
 if(MAYBE.test(m))return 'maybe';
 if(status>=500)return 'maybe';
 return null;
}
const ALLOWED={read:new Set(['not-run','rate','lock','maybe']),write:new Set(['not-run','rate','lock']),create:new Set(['not-run'])};
const mayRetry=(kind,failure)=>!!failure&&!!ALLOWED[kind]?.has(failure);

// n번째 다시 시도(1부터) 앞에서 기다리는 시간: 0 ~ min(capMs, baseMs×2^(n-1)) 사이 고르게(전체 지터).
function backoffMs(n,random=Math.random,policy=RETRY_POLICY){
 const ceil=Math.min(policy.capMs,policy.baseMs*2**Math.max(0,n-1));
 return Math.floor(Math.max(0,Math.min(0.999999,random()))*ceil);
}

// 다시 시도 뒤에도 몰림이면 화면에 보이는 글(beta2-core.mjs sheetBusyText와 같은 글).
function busyText(retries,write=true){
 const tail=retries>0?`(자동 재시도 ${retries}회)`:'';
 return write?`지금 저장이 몰려 잠시 뒤 다시 저장해 주세요${tail}`:`지금 요청이 몰려 잠시 뒤 다시 시도해 주세요${tail}`;
}

const wait=ms=>new Promise(r=>setTimeout(r,ms));
function failure(code,attempts,extra={}){return Object.assign(new Error(code),{attempts,...extra});}

// Apps Script 한 번 호출. 결과: {out}(JSON 응답, 입력 확인 오류 포함) 또는 {fail, code, message}(다시 시도할 수 있는 오류). 다시 시도하지 않는 오류는 throw.
async function sheetAttempt({url,key,action,args,extra={},timeoutMs,fetchImpl=fetch}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
 try{
  // Apps Script는 302로 결과 주소를 돌려주므로 redirect를 따라가야 합니다.
  const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,action,args,...extra}),redirect:'follow',signal:controller.signal});
  const text=await r.text(),status=Number(r.status)||200;
  let data;try{data=JSON.parse(text);}catch{data=undefined;}
  if(data&&typeof data==='object'){
   if(data.ok===false&&data.error==='unauthorized')throw new Error('SHEET_UNAUTHORIZED');
   if(data.ok===false){const f=classifyFailure({status,message:data.error});if(f)return {fail:f,code:'SHEET_BUSY',message:String(data.error||''),out:data};}
   else if(status===429||status>=500){return {fail:classifyFailure({status}),code:status===429||status===503?'SHEET_BUSY':'SHEET_UNAVAILABLE',message:'HTTP '+status};}
   return {out:data};
  }
  // JSON이 아님: Google 오류 페이지(동시 실행 초과 등)나 HTTP 429·5xx면 다시 시도할 수 있는 오류, 아니면 읽지 못한 응답.
  const f=classifyFailure({status,message:text.slice(0,2000)});
  if(f)return {fail:f,code:f==='maybe'&&!TRANSIENT_MESSAGE.test(text)?'SHEET_UNAVAILABLE':'SHEET_BUSY',message:status>=400?'HTTP '+status:'transient page'};
  throw new Error('SHEET_BAD_RESPONSE');
 }catch(e){
  if(controller.signal.aborted)return {fail:'maybe',code:'SHEET_TIMEOUT',message:'timeout'};
  if(e instanceof TypeError)return {fail:'maybe',code:'SHEET_UNAVAILABLE',message:String(e.message||e)};
  throw e;
 }finally{clearTimeout(timer);}
}

// 다시 시도를 포함한 호출. 성공(입력 확인 오류 포함): {out, attempts}. 다시 시도 뒤에도 실패: throw Error(code) + {attempts, retries, kind, failure, detail}.
// code: SHEET_BUSY(몰림·잠금, 화면 글은 busyText) · SHEET_TIMEOUT · SHEET_UNAVAILABLE. 그 밖의 오류(SHEET_UNAUTHORIZED·SHEET_BAD_RESPONSE)는 바로 throw.
async function callSheetWithRetry({url,key,action,args,extra={},deadline,fetchImpl=fetch,now=Date.now,sleep=wait,random=Math.random,policy=RETRY_POLICY,log=null}){
 const kind=actionKind(action,args),end=deadline??now()+policy.budgetMs;
 let attempts=0,last=null;
 for(;;){
  const left=end-now();
  if(left<=0){last=last||{fail:'maybe',code:'SHEET_TIMEOUT',message:'budget'};break;}
  attempts++;
  const started=now();
  let res;
  try{res=await sheetAttempt({url,key,action,args,extra,timeoutMs:Math.min(policy.maxAttemptMs,left),fetchImpl});}
  catch(e){throw Object.assign(e,{attempts});}
  if(!res.fail)return {out:res.out,attempts};
  last=res;
  const took=now()-started;
  if(!mayRetry(kind,res.fail)||attempts>=policy.maxAttempts)break;
  // 시트가 이미 오래 기다린 잠금 시간 초과는 다시 시도하지 않습니다(다시 해도 같은 줄에 또 서게 됨).
  if(res.fail==='lock'&&took>policy.slowLockMs)break;
  const delay=backoffMs(attempts,random,policy);
  if(end-now()-delay<=policy.minRemainingMs)break;
  if(log)log({action,attempt:attempts,failure:res.fail,message:res.message,took,delay});
  await sleep(delay);
 }
 throw failure(last.code,attempts,{retries:attempts-1,kind,failure:last.fail,detail:last.message});
}

module.exports={RETRY_POLICY,READ_ACTIONS,IDEMPOTENT_WRITES,CREATE_WRITES,actionKind,TRANSIENT_MESSAGE,classifyFailure,mayRetry,backoffMs,busyText,sheetAttempt,callSheetWithRetry,ALLOWED};
