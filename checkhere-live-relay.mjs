// Relay for the live beta. Runs in the designated administrator's portal tab on
// the collector PC: it keeps today's `checkhereCurrent` documents fresh and writes
// the relay signal. One task at a time.
// 읽기 전용(사용자 결정 2026-10-16): 수정 요청을 승인·반영·반려하지 않고, 해제를 알아채도 쓰지 않습니다.
// 체크히어 쓰기는 사람이 운영 포털 「반영 요청·승인」에서 승인할 때만 합니다(index.html → 연결 프로그램 /api/apply).
// 체크히어 해제 상태(privacy)는 연결 프로그램이 셉니다. 중계는 그대로 신호에 옮길 뿐 해제·연장·종료를 하지 않습니다.
import {RELAY_CLASS_IDS,LIVE_HOUR_MS,LIVE_GAP_MS,LIVE_WINDOW,NO_LECTURE,hourPlan,inLiveWindow,koreaClock,koreaHour} from './checkhere-live-core.mjs';
import {privacyState} from './checkhere/rules.mjs';
import {BRIDGE_URL} from './checkhere/cohort-bridge.mjs';

// 2기 연결 프로그램은 127.0.0.1:8766(1기 8765와 따로 돎).
export function createBridgeClient({base=BRIDGE_URL,key,fetchImpl=(...a)=>fetch(...a)}){
  async function call(path,body){
    let r;try{r=await fetchImpl(base+'/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-hint-key':key},body:body?JSON.stringify(body):undefined,cache:'no-store'});}
    catch{throw Object.assign(Error('수집 PC 연결 프로그램에 연결하지 못했습니다.'),{code:'BRIDGE_OFFLINE'});}
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(Error(data.error||`연결 프로그램 오류 (${r.status})`),{status:r.status,code:r.status===409?'BRIDGE_BUSY':r.status===401?'BRIDGE_KEY':'BRIDGE_ERROR'});
    return data;
  }
  return {state:cursor=>call('state?delta=1'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),api:(name,body)=>call(name,body||{})};
}

// 중계 신호(settings/checkhereRelay)에 쓸 내용. 담임도 읽는 문서라 status.current(반·학생 이름)와 lastError 글은 넣지 않습니다.
// 능력 이름은 영문·숫자·_.-만(이름 같은 글이 섞이지 않게), build는 정해진 모양만('20261016.2', 2기 '2기-20261019.1').
const SIGNAL_NAME=/^[\w.-]{1,80}$/,BUILD_NAME=/^(?:[1-9]기-)?\d{8}\.\d{1,3}$/,PRIVACY_STATES=['masked','unmasked','unknown'];
// 연결 프로그램 /api/state의 privacy(없으면 옛 build의 masking 머리말·남은 시간으로 같은 기준 계산) → 상태·남은 초·쓸 수 있는지만(글·이름 없음).
export function bridgePrivacy(s){
  const p=s?.privacy&&typeof s.privacy==='object'?s.privacy:s?.masking&&typeof s.masking==='object'?privacyState(s.masking):null;
  return p&&PRIVACY_STATES.includes(p.state)?{state:p.state,leftSec:Number.isFinite(p.leftSec)?Math.max(0,Math.floor(p.leftSec)):null,writable:p.state==='unmasked'&&p.writable===true}:null;
}
export function relaySignal(status,{capabilities=status?.capabilities,build=status?.build}={},by=null){
  const s=status||{},running=s.state==='running',reachable=s.bridgeOk!==false,unmask=Math.max(0,Math.floor(Number(s.needsUnmask)||0));
  // busy: 중계가 갱신 중이거나 연결 프로그램이 다른 작업 중(멈춘 중계는 바쁘지 않음). queue: 기다리는 수동 갱신 수(요청이 아님).
  return {state:running?'running':'stopped',busy:running&&(Boolean(s.current)||s.bridgeBusy===true),queue:Number(s.queue)||0,
    // 능력은 마지막으로 닿은 연결 프로그램의 목록입니다. 닿지 않아도(bridgeOk false) 비우지 않습니다: /beta2는 마지막 신호의 능력으로 v1·v2를 정하므로(2026-10-16)
    // 빈 목록을 쓰면 옛(v1) 연결 프로그램이 꺼진 동안 '모름 → v2'로 바뀝니다. 연결 프로그램은 올라가기만 하고, 반영 때 승인 화면·연결 프로그램이 다시 확인합니다.
    capabilities:[...new Set((Array.isArray(capabilities)?capabilities:[]).filter(c=>typeof c==='string'&&SIGNAL_NAME.test(c)))],
    build:typeof build==='string'&&BUILD_NAME.test(build)?build:null,lastErrorAt:Number.isFinite(s.lastErrorAt)?s.lastErrorAt:null,by:typeof by==='string'&&by?by:null,
    // 체크히어 가림 때문에 연결 프로그램에서 기다리는 쓰기 수(이름 없음, 연결 프로그램이 셈). 0이면 넣지 않습니다(신호 모양은 그대로).
    ...(unmask?{needsUnmask:unmask}:{}),
    // 체크히어 해제 상태(연결 프로그램에 닿을 때만): {state, leftSec, writable}. /beta2가 도구줄·확인창에 '반영할 때 해제 필요'를 보입니다.
    ...(reachable&&bridgePrivacy(s)?{privacy:bridgePrivacy(s)}:{})};
}

// 읽기만 하므로 수집 능력만 봅니다(승인·미리보기 능력은 운영 포털 승인 화면이 봄).
const REQUIRED=['incremental-sync-v1'];
// 해제로 풀리지 않는 MASKED_* (같은 첫 글자·끝 4자리 학생, 연결 충돌, 저장 요청 확인 실패)
const NOT_UNMASK=/\bMASKED_(?:AMBIGUOUS|CONFLICT|GUARD)\b/;
const textOf=e=>`${String(e?.message||'')} ${String(e?.code||'')}`;
// 체크히어 가림 때문에 못 한 일(연결 프로그램의 MASKED_* 글, 옛 build의 전화번호 글): 해제하면 풀리는 일. 갱신 실패를 오류가 아닌 경고로 남깁니다.
export const maskedFailure=e=>(/\bMASKED_[A-Z]+|전화번호 표시가 필요합니다/.test(String(e?.message||''))||/^MASKED_/.test(String(e?.code||'')))&&!NOT_UNMASK.test(textOf(e));
// 수집 PC에서 사람이 풀어야 하는 일(연결 충돌 정리·연결 프로그램 다시 시작): 해제로는 풀리지 않아 해제 대기 수에 넣지 않습니다(경고로 남김).
// 같은 첫 글자·끝 4자리(MASKED_AMBIGUOUS)는 둘 다 아니라 보통 오류로 남깁니다(체크히어에서 직접 고침).
export const stuckFailure=e=>/\bMASKED_(?:CONFLICT|GUARD)\b/.test(textOf(e));
// 모든 반에 걸리는 가림 문제(섞인 화면, 사람이 해제 창을 쓰는 중, 옛 build): 이번 자동 갱신 한 바퀴를 멈춥니다.
const maskedEveryClass=e=>/\bMASKED_(?:MIXED|UNMASKING)|전화번호 표시가 필요합니다/.test(String(e?.message||''));
// 가림 때문에 연결 프로그램에서 기다리는 쓰기 수(사람이 승인한 반영이 가림에 막힌 것, masking.waitingWrites).
// 해제된 탭이면 0입니다: 그 뒤 반영은 사람이 운영 포털에서 다시 누릅니다(중계는 깨어나 쓰지 않음).
const unmaskCount=m=>m&&m.header!=='unmasked'?Math.max(0,Math.floor(Number(m.waitingWrites)||0)):0;
// 자동 갱신은 시간마다 새로 뽑는 계획(hourPlan)을 따릅니다: 반마다 한 시간에 한 번, 무작위 시각·순서, 서로 gapMs(1분) 넘게. 늦어진 반이 몰려도 1분씩 띄워 읽습니다.
// window: 계획을 세울 창(교육일 08:50~18:40), inWindow(now): 읽기 직전 창 확인, random: 0~1 함수(시험은 고정값). 수동 갱신(이 반 지금 갱신)은 창·계획과 상관없이 먼저 합니다.
export function createLiveRelay({bridge,store,log=()=>{},now=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),classIds=RELAY_CLASS_IDS,pollMs=1500,jobTimeoutMs=10*60*1000,retryMs=60000,inWindow=inLiveWindow,window=LIVE_WINDOW,random=Math.random,gapMs=LIVE_GAP_MS}){
  const mirror=new Map(),saved=new Map(),noLecture=new Map(),manual=[];
  // plan: 이번 시간 계획 {key, date, slots:[{classId, at, done}]}, pauseUntil: 로그인·연결·가림 문제로 자동 갱신을 쉬는 때, lastAutoAt: 마지막 자동 읽기(체크히어에 간 것)
  let cursor=null,capabilities=[],plan=null,pauseUntil=0,lastAutoAt=0,running=false,wake=null,listeners=new Set();
  const status={state:'stopped',lastCycle:null,plan:null,lastError:null,lastErrorAt:null,saves:0,queue:0,current:null,capabilities:[],build:null,bridgeBusy:false,bridgeOk:null,needsUnmask:0,privacy:null};
  const emit=()=>{status.queue=manual.length;for(const f of listeners)f({...status});};
  const note=(text,level='info')=>{log({at:now().toISOString(),level,text});if(level==='error'){status.lastError=text;status.lastErrorAt=now().getTime();}emit();};
  const failNote=e=>note(e.message,maskedFailure(e)||stuckFailure(e)?'warn':'error');
  const today=()=>koreaClock(now()).date;
  const recKey=r=>`${r.version}|${r.collectedAt}`;

  async function refresh(){
    const s=await bridge.state(cursor);capabilities=s.capabilities||[];
    // 중계 신호용으로 연결 프로그램의 능력·build·바쁨·가림 대기 쓰기 수·해제 상태를 상태에 보입니다(바뀔 때만 알림, 남은 초만 바뀌면 조용히 고침).
    const build=typeof s.build==='string'&&s.build?s.build:null,busy=Boolean(s.busy),unmask=unmaskCount(s.masking),privacy=bridgePrivacy(s),pk=p=>p?p.state+'|'+p.writable:'';
    const changed=String(status.capabilities)!==String(capabilities)||status.build!==build||status.bridgeBusy!==busy||status.needsUnmask!==unmask||pk(status.privacy)!==pk(privacy);
    Object.assign(status,{capabilities:[...capabilities],build,bridgeBusy:busy,needsUnmask:unmask,privacy});if(changed)emit();
    if(s.recordsMode==='replace')mirror.clear();
    for(const r of s.records||[])mirror.set(r.id,r);
    cursor=s.cursor;return s;
  }
  async function waitJob(id){
    const until=now().getTime()+jobTimeoutMs;
    for(;;){
      const s=await refresh(),job=(s.jobs||[]).find(j=>j.id===id);
      if(job&&job.status!=='running')return job;
      if(now().getTime()>until)throw Error('연결 프로그램 작업이 오래 걸려 확인을 멈췄습니다. 연결 프로그램 화면에서 상태를 확인해 주세요.');
      await sleep(pollMs);
    }
  }
  // Save complete live records that differ from what this relay last verified.
  async function saveDay(classId,date,job){
    const rows=[...mirror.values()].filter(r=>String(r.classId)===String(classId)&&r.date===date&&r.source==='live'&&r.readState==='complete'&&saved.get(r.id)!==recKey(r));
    if(!rows.length)return 0;
    const clean=rows.map(({audit,...r})=>r);
    await store.saveRecords(clean,job);
    for(const r of rows)saved.set(r.id,recKey(r));status.saves++;return rows.length;
  }
  async function syncClass(classId,date){
    if(noLecture.get(date)?.has(classId))return 'known-none';
    const before=await refresh();if(before.busy)return 'busy';
    let job;
    try{job=await bridge.api('sync',{classId,dates:[date],mode:'incremental'});}
    catch(e){if(e.code==='BRIDGE_BUSY')return 'busy';throw e;}
    job=await waitJob(job.id);
    if(job.status==='failed'&&NO_LECTURE.test(job.message||'')){if(!noLecture.has(date))noLecture.set(date,new Set());noLecture.get(date).add(classId);note(`${classId}반: 오늘 강의가 없어 갱신에서 제외합니다.`);return 'skip';}
    if(job.status==='failed')throw Error(`${classId}반 갱신 실패: ${job.message}`);
    const count=await saveDay(classId,date,job);
    if(count||job.count||job.errors)note(`${classId}반: ${count?`${count}명 DB 반영`:'DB 변경 없음'} · ${job.message}`);
    return 'done';
  }

  // 이번 시간 계획(수만, 이름 없음): 시(HH)·계획한 반 수·끝낸 수·다음 자동 갱신 시각
  const planStatus=()=>plan?{hour:plan.key.slice(11),total:plan.slots.length,done:plan.slots.filter(s=>s.done).length,nextAt:Number.isFinite(nextAuto())?new Date(nextAuto()).toISOString():null}:null;
  // 다음 자동 읽기를 할 수 있는 때(남은 반의 시각, 마지막 읽기+1분, 쉬는 때 중 늦은 것)
  const nextAuto=()=>Math.min(...(plan?.slots||[]).filter(s=>!s.done).map(s=>Math.max(s.at,lastAutoAt+gapMs,pauseUntil)));
  // 시간이 바뀌면(또는 처음) 그 시간 계획을 새로 뽑습니다. 끝내지 못한 지난 시간의 반은 새 계획에 다시 들어갑니다.
  function planHour(){
    const h=koreaHour(now());if(plan?.key===h.key)return;
    if(plan?.slots.length)status.lastCycle={date:plan.date,hour:plan.key.slice(11),finishedAt:now().toISOString(),classes:plan.slots.filter(s=>s.done).length,planned:plan.slots.length};
    plan=hourPlan({now:now(),classIds,window,random,gapMs});plan.slots=plan.slots.map(s=>({...s,done:false}));
  }
  const fatal=e=>e.code==='BRIDGE_OFFLINE'||e.code==='BRIDGE_KEY'||/LOGIN_REQUIRED/.test(e.message)||maskedEveryClass(e);
  // 요청은 보지 않습니다: 수동 갱신(이 반 지금 갱신) → 시간마다 무작위 시각의 자동 갱신(반마다 한 번) 순서로 읽기만 합니다.
  async function step(){
    if(manual.length){const {classId,date}=manual.shift();emit();try{await syncClass(classId,date);}catch(e){failNote(e);}return 'sync';}
    planHour();status.plan=planStatus();
    const t=now().getTime(),slot=plan.slots.find(s=>!s.done&&s.at<=t);
    if(!slot||t<pauseUntil||t<lastAutoAt+gapMs||!inWindow(now()))return 'idle';
    // 1분 간격은 읽기를 시작한 때부터 잽니다(읽는 데 걸린 시간만큼 다음 반이 밀리지 않게).
    status.current=`${slot.classId}반 자동 갱신`;emit();const started=t;
    let result;try{result=await syncClass(slot.classId,plan.date);}
    catch(e){
      result='error';failNote(e);
      // 로그아웃·연결 프로그램 꺼짐·섞인 화면(모든 반에 걸림): 그 반을 남겨 두고 retryMs 뒤에 다시 합니다(반마다 실패를 쌓지 않음).
      if(fatal(e)){pauseUntil=t+retryMs;status.current=null;status.plan=planStatus();emit();return 'idle';}
    }
    finally{status.current=null;}
    if(result==='busy'){emit();return 'busy';}
    slot.done=true;if(result!=='known-none')lastAutoAt=started;
    status.plan=planStatus();emit();return 'sync';
  }
  async function loop(){
    while(running){
      let did;try{did=await step();}catch(e){did='idle';note(e.message,'error');}
      if(!running)break;
      if(did==='idle'||did==='busy'){
        const t=now().getTime(),h=koreaHour(now()),soon=Math.min(nextAuto()-t,h.start+LIVE_HOUR_MS-t,did==='busy'?5000:60000);
        await new Promise(r=>{wake=r;sleep(Math.max(1000,soon)).then(r);});wake=null;
      }
    }
  }
  return {
    status:()=>({...status}),
    // 중계 신호를 쓰기 전에 부릅니다. 일이 없을 때도 연결 프로그램의 능력·바쁨·연결 여부를 새로 봅니다(실패해도 던지지 않음).
    async ping(){let ok;try{await refresh();ok=true;}catch{ok=false;}if(status.bridgeOk!==ok){status.bridgeOk=ok;emit();}return ok;},
    onStatus(f){listeners.add(f);return()=>listeners.delete(f);},
    async start({loop:autoLoop=true}={}){
      if(running)return;
      await refresh();
      if(!REQUIRED.every(c=>capabilities.includes(c)))throw Error('수집 PC의 연결 프로그램이 오래된 버전입니다. 「체크히어 시작.cmd」를 다시 실행해 주세요.');
      running=true;status.state='running';status.lastError=null;status.lastErrorAt=null;
      // 수정 요청 목록은 구독하지 않습니다(승인·반영은 운영 포털에서 사람이 함).
      note('중계를 시작했습니다(읽기 전용). 이 탭을 열어 두세요.');
      if(autoLoop)void loop();
    },
    stop(){running=false;status.state='stopped';wake?.();note('중계를 멈췄습니다.');},
    // A manual refresh also retries a class marked 'no lecture' earlier today.
    syncNow(classId,date=today()){noLecture.get(date)?.delete(String(classId));manual.push({classId:String(classId),date});emit();wake?.();},
    step,
    _debug:{mirror,saved,noLecture,get plan(){return plan;},get pauseUntil(){return pauseUntil;}},
  };
}
