// Relay for the live beta. Runs in the designated administrator's portal tab on
// the collector PC: it turns marked admin requests into verified CheckHere
// writes and keeps today's `checkhereCurrent` documents fresh. One task at a time.
import {cleanRequest,matchRequest,requestMatchesRecord,prepareApproval,deletedNote} from './checkhere/approval-core.mjs';
import {ACTIVE,CLASS_IDS,LIVE_INTERVAL_MS,NO_LECTURE,baseTag,checkLiveEdit,inLiveWindow,isLiveRequest,koreaClock,stamp,tagOf} from './checkhere-live-core.mjs';
import {requestsOverlap} from './checkhere-proposal-core.mjs';
import {TIME_DELETE_CAPABILITY} from './checkhere/rules.mjs';

export function createBridgeClient({base='http://127.0.0.1:8765',key,fetchImpl=(...a)=>fetch(...a)}){
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
const SIGNAL_NAME=/^[\w.-]{1,80}$/;
export function relaySignal(status,{capabilities=status?.capabilities,build=status?.build}={},by=null){
  const s=status||{},running=s.state==='running',reachable=s.bridgeOk!==false,unmask=Math.max(0,Math.floor(Number(s.needsUnmask)||0));
  // busy: 중계가 요청·갱신을 처리 중이거나 연결 프로그램이 다른 작업 중(멈춘 중계는 바쁘지 않음).
  return {state:running?'running':'stopped',busy:running&&(Boolean(s.current)||s.bridgeBusy===true),queue:Number(s.queue)||0,
    // 연결 프로그램에 닿지 않으면(bridgeOk false) 능력을 알리지 않습니다(/beta2가 시간 삭제를 켜지 않게).
    capabilities:[...new Set((reachable&&Array.isArray(capabilities)?capabilities:[]).filter(c=>typeof c==='string'&&SIGNAL_NAME.test(c)))],
    build:typeof build==='string'&&SIGNAL_NAME.test(build)?build:null,lastErrorAt:Number.isFinite(s.lastErrorAt)?s.lastErrorAt:null,by:typeof by==='string'&&by?by:null,
    // 체크히어 마스킹 해제를 기다리는 요청 수(이름 없음). 0이면 넣지 않습니다(신호 모양은 그대로).
    ...(unmask?{needsUnmask:unmask}:{})};
}

const REQUIRED=['approval-current-sync-v1','live-approval-preview-v1','incremental-sync-v1'],MAX_ATTEMPTS=5;
// 해제로 풀리지 않는 MASKED_* (같은 첫 글자·끝 4자리 학생, 연결 충돌, 저장 요청 확인 실패)
const NOT_UNMASK=/\bMASKED_(?:AMBIGUOUS|CONFLICT|GUARD)\b/;
const textOf=e=>`${String(e?.message||'')} ${String(e?.code||'')}`;
// 체크히어 가림 때문에 못 한 일(연결 프로그램의 MASKED_* 글, 옛 build의 전화번호 글): 요청 탓이 아니라 시도 횟수에 넣지 않고 반려하지 않습니다.
export const maskedFailure=e=>(/\bMASKED_[A-Z]+|전화번호 표시가 필요합니다/.test(String(e?.message||''))||/^MASKED_/.test(String(e?.code||'')))&&!NOT_UNMASK.test(textOf(e));
// 수집 PC에서 사람이 풀어야 하는 일(연결 충돌 정리·연결 프로그램 다시 시작): 요청 탓이 아니므로 세지 않고, 해제 대기 수에도 넣지 않고 길게 쉬었다 봅니다.
// 같은 첫 글자·끝 4자리(MASKED_AMBIGUOUS)는 자동으로 풀리지 않아 보통 실패처럼 세고 반려합니다(체크히어에서 직접 고침).
export const stuckFailure=e=>/\bMASKED_(?:CONFLICT|GUARD)\b/.test(textOf(e));
// 모든 반에 걸리는 가림 문제(섞인 화면, 사람이 해제 창을 쓰는 중, 옛 build): 이번 자동 갱신 한 바퀴를 멈춥니다.
const maskedEveryClass=e=>/\bMASKED_(?:MIXED|UNMASKING)|전화번호 표시가 필요합니다/.test(String(e?.message||''));
// 시간 삭제 요청(deleteTimes): 연결 프로그램이 time-delete-v1을 모르면 대기 중 요청은 체크히어를 읽지 않고 반려하고,
// 이미 승인된 요청은 규칙상 반려할 수 없어 업데이트를 기다립니다(BRIDGE_OLD). 규칙이 게시되지 않아 승인 저장이 거절되면 반려합니다.
export const TIME_DELETE_OLD='수집 PC 프로그램이 아직 체크히어 시간 삭제를 지원하지 않습니다. 「체크히어 시작.cmd」를 최신으로 실행한 뒤 다시 요청해 주세요.';
export const TIME_DELETE_RULES='시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다. 규칙을 게시한 뒤 다시 요청해 주세요.';
// 모양이 이상해도 deleteTimes가 있으면 삭제로 봅니다(능력이 없으면 막는 쪽이 안전).
const deletesTime=r=>{try{return !!cleanRequest(r).deleteTimes;}catch{return r?.deleteTimes!=null&&!(Array.isArray(r.deleteTimes)&&!r.deleteTimes.length);}};
// maskedRetryMs: 가림 때문에 기다리는 요청은 길게 쉬었다 봅니다(검토 10). 연결 프로그램 탭이 해제되면 바로 다시 봅니다.
export function createLiveRelay({bridge,store,user,log=()=>{},now=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),classIds=CLASS_IDS,intervalMs=LIVE_INTERVAL_MS,pollMs=1500,jobTimeoutMs=10*60*1000,retryMs=60000,maskedRetryMs=5*60000,inWindow=inLiveWindow}){
  const queue=new Map(),retryAt=new Map(),attempts=new Map(),ignored=new Set(),mirror=new Map(),saved=new Map(),noLecture=new Map(),manual=[],maskedWait=new Set();
  let cursor=null,capabilities=[],cycle=null,nextCycleAt=0,running=false,wake=null,unwatch=null,listeners=new Set(),active=[],unmaskedSeenAt=0,maskCheckAt=0;
  const status={state:'stopped',lastCycle:null,lastError:null,lastErrorAt:null,processed:0,saves:0,queue:0,current:null,capabilities:[],build:null,bridgeBusy:false,bridgeOk:null,needsUnmask:0};
  const emit=()=>{status.queue=[...queue.values()].length;for(const id of maskedWait)if(!queue.has(id))maskedWait.delete(id);status.needsUnmask=maskedWait.size;for(const f of listeners)f({...status});};
  const note=(text,level='info')=>{log({at:now().toISOString(),level,text});if(level==='error'){status.lastError=text;status.lastErrorAt=now().getTime();}emit();};
  const today=()=>koreaClock(now()).date;
  const recKey=r=>`${r.version}|${r.collectedAt}`;

  async function refresh(){
    const s=await bridge.state(cursor);capabilities=s.capabilities||[];
    // 중계 신호용으로 연결 프로그램의 능력·build·바쁨을 상태에 보입니다(바뀔 때만 알림).
    const build=typeof s.build==='string'&&s.build?s.build:null,busy=Boolean(s.busy);
    if(String(status.capabilities)!==String(capabilities)||status.build!==build||status.bridgeBusy!==busy){Object.assign(status,{capabilities:[...capabilities],build,bridgeBusy:busy});emit();}
    // 연결 프로그램 탭이 가림에서 '원문 표시 중'으로 바뀌는 순간에만 가림 때문에 쉬던 요청을 바로 다시 봅니다(해제 중 계속 막히는 요청이 되풀이되지 않게).
    const unmasked=s.masking?.header==='unmasked';maskCheckAt=now().getTime();
    if(unmasked&&!unmaskedSeenAt&&maskedWait.size){for(const id of maskedWait)retryAt.delete(id);wake?.();}
    unmaskedSeenAt=unmasked?unmaskedSeenAt||maskCheckAt:0;
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
    if(noLecture.get(date)?.has(classId))return 'skip';
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

  async function reject(r,text){await store.reject(r.id,text);queue.delete(r.id);note(`${r.classId}반 ${r.name}: 자동 반영하지 않음 — ${text}`,'warn');}
  // 능력 목록이 오래됐을 수 있어 없으면 한 번 새로 봅니다(체크히어 읽기 없음).
  async function bridgeDeletes(){if(!capabilities.includes(TIME_DELETE_CAPABILITY))await refresh();return capabilities.includes(TIME_DELETE_CAPABILITY);}
  async function finishApply(r,idToken){
    const job=await waitJob(r.id);
    let result=job;
    if(job.status==='verified'&&job.platformSaved!==true)result=await bridge.api('reconcile',{approvalId:r.id,idToken:await user.getIdToken()});
    for(const rec of [job.current].filter(Boolean)){mirror.set(rec.id,rec);if(result.platformSaved===true)saved.set(rec.id,recKey(rec));}
    queue.delete(r.id);status.processed++;
    // 삭제 확인은 작업 글이 아니라 반영 결과(results[].deleted)로 봅니다(플랫폼 저장이 완료 문구를 새로 씀).
    note(`${r.classId}반 ${r.name}: ${result.status==='verified'&&result.platformSaved===true?`체크히어 반영·확인·DB 저장 완료${deletedNote(job.results)}`:`${result.status} · ${result.message||job.message||'결과를 확인해 주세요.'}`}`,result.status==='verified'?'info':'warn');
  }
  async function processRequest(r){
    status.current=`${r.classId}반 ${r.name}`;emit();
    if(!await store.isAdmin(r.createdBy)){ignored.add(r.id);queue.delete(r.id);note(`${r.classId}반 ${r.name}: 관리자가 아닌 계정(${r.createdBy})의 요청이라 건너뜁니다.`,'warn');return;}
    if(!REQUIRED.every(c=>capabilities.includes(c))){await refresh();if(!REQUIRED.every(c=>capabilities.includes(c)))throw Object.assign(Error('수집 PC에서 최신 「체크히어 시작.cmd」를 다시 실행해 주세요.'),{code:'BRIDGE_OLD'});}
    const idToken=await user.getIdToken();
    // Approved earlier but not started (e.g. the tab closed): the bridge re-reads before writing.
    if(r.status==='approved'){
      if(deletesTime(r)&&!await bridgeDeletes())throw Object.assign(Error(`승인된 시간 삭제 요청은 연결 프로그램 업데이트를 기다립니다. ${TIME_DELETE_OLD}`),{code:'BRIDGE_OLD'});
      await bridge.api('apply',{approvalId:r.id,idToken});return finishApply(r,idToken);
    }
    let clean;try{clean=cleanRequest(r);}catch(e){return reject(r,e.message);}
    if(clean.deleteTimes&&!await bridgeDeletes())return reject(r,TIME_DELETE_OLD);
    // 같은 학생·항목에 처리 중인 다른 요청(운영포털 수정 요청 포함)이 있으면 덮어쓰지 않고 반려합니다.
    if(active.some(o=>o.id!==r.id&&ACTIVE.includes(o.status)&&o.changes&&requestsOverlap(o,clean)))return reject(r,'같은 학생·항목에 처리 중인 다른 수정 요청이 있습니다. 운영 포털 수정 요청에서 먼저 정리해 주세요.');
    const identities=await store.identities(clean.classId,clean.name);
    const preview=await bridge.api('preview-request',{approvalId:r.id,idToken});
    const record=matchRequest(r,[preview.record],identities);mirror.set(record.id,record);
    // Viewers should see the value the decision was made on.
    await saveDay(record.classId,record.date,{id:'live-preview-'+r.id,status:'complete'}).catch(e=>note('미리보기 DB 저장 실패: '+e.message,'warn'));
    if(requestMatchesRecord(r,record,identities)){
      const res=await bridge.api('confirm-existing',{approvalId:r.id,idToken});
      if(res.status==='pending')return reject(r,res.message||'체크히어 원본이 요청과 다릅니다.');
      if(res.status==='verified'&&res.platformSaved===true){queue.delete(r.id);status.processed++;note(`${r.classId}반 ${r.name}: 이미 같은 값 · 원본 확인 완료`);return;}
      return finishApply(r,idToken);
    }
    // [기준] 지문은 바뀌는 항목 전부(지우는 시간 포함, clean.changes에 ''로 들어 있음)의 지금 값과 같아야 합니다.
    if(tagOf(r.reason)!==baseTag(record,Object.keys(clean.changes)))return reject(r,'수정 화면을 연 뒤 체크히어 값이 바뀌었습니다. 새 값을 확인하고 다시 수정해 주세요.');
    let judgement;try{judgement=checkLiveEdit(record,clean.changes,capabilities,clean.deleteTimes);}catch(e){return reject(r,e.message);}
    if(Object.keys(judgement.defaults).length&&!capabilities.includes('memo-default-time-v1'))throw Object.assign(Error('수집 PC에서 최신 「체크히어 시작.cmd」를 다시 실행해 주세요.'),{code:'BRIDGE_OLD'});
    let approval;try{approval=prepareApproval(r,record,{identities});}catch(e){return reject(r,e.message);}
    // 연결 프로그램 탭이 가려져 있거나 해제 시간이 모자라면 승인하지 않습니다: 요청은 대기로 남고 해제 뒤 다시 봅니다(시도 횟수에 넣지 않음).
    if(preview.writeBlocked)throw Object.assign(Error(String(preview.writeBlocked.message||'MASKED_WRITE: 체크히어 마스킹 해제 후 반영합니다')),{code:String(preview.writeBlocked.code||'MASKED_WRITE')});
    try{await store.approve(r.id,approval,r);}
    catch(e){if(clean.deleteTimes&&e?.code==='permission-denied')return reject(r,TIME_DELETE_RULES);throw e;}
    await bridge.api('apply',{approvalId:r.id,idToken});
    return finishApply(r,idToken);
  }

  function eligible(){
    const t=now().getTime();
    return [...queue.values()].filter(r=>!ignored.has(r.id)&&(retryAt.get(r.id)||0)<=t).sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt));
  }
  async function step(){
    // 가림 때문에 쉬는 요청이 있으면 연결 프로그램 탭이 해제되었는지 가끔(15초) 봅니다.
    if(maskedWait.size&&now().getTime()-maskCheckAt>15000)await refresh().catch(()=>{});
    const next=eligible()[0];
    if(next){
      try{await processRequest(next);retryAt.delete(next.id);attempts.delete(next.id);maskedWait.delete(next.id);}
      catch(e){
        // Bridge/login problems wait indefinitely; a request that keeps failing on its own is closed.
        // 체크히어 가림(MASKED_*·옛 build의 전화번호 글)도 요청 탓이 아니므로 반려하지 않고 길게 쉬었다 봅니다(해제되면 바로).
        const masked=maskedFailure(e),stuck=stuckFailure(e),infra=masked||stuck||['BRIDGE_OFFLINE','BRIDGE_BUSY','BRIDGE_KEY','BRIDGE_OLD'].includes(e.code)||/LOGIN_REQUIRED/.test(e.message);
        const n=infra?0:(attempts.get(next.id)||0)+1;attempts.set(next.id,n);
        // 바빠서 돌아온 요청(해제 직후 연결 확인 수집 중 등)은 해제 대기 수에서 빼지 않습니다(/beta2 삭제 관문이 잠깐 열리지 않게).
        if(masked)maskedWait.add(next.id);else if(e.code!=='BRIDGE_BUSY')maskedWait.delete(next.id);
        if(n>=MAX_ATTEMPTS&&next.status==='pending'){await store.reject(next.id,`자동 반영을 ${n}번 시도했지만 처리하지 못했습니다: ${e.message}`).catch(()=>{});queue.delete(next.id);note(`${next.classId}반 ${next.name}: ${n}번 실패해 자동 반영을 중단했습니다 — ${e.message}`,'error');}
        else{retryAt.set(next.id,now().getTime()+(masked||stuck?maskedRetryMs:retryMs));note(`${next.classId}반 ${next.name}: ${e.message} (${masked?'체크히어 마스킹 해제 뒤 다시 시도':stuck?'수집 PC에서 정리한 뒤 다시 시도':'잠시 후 다시 시도'})`,masked?'warn':'error');}
      }
      finally{status.current=null;emit();}
      return 'request';
    }
    if(manual.length){const {classId,date}=manual.shift();try{await syncClass(classId,date);}catch(e){note(e.message,'error');}return 'sync';}
    const t=now().getTime();
    if(!cycle&&t>=nextCycleAt&&inWindow(now()))cycle={date:today(),startedAt:t,todo:[...classIds],done:0};
    if(cycle){
      const classId=cycle.todo[0];status.current=`${classId}반 자동 갱신`;emit();
      let result;try{result=await syncClass(classId,cycle.date);}
      catch(e){
        result='error';note(e.message,'error');
        // Logged out or bridge closed: stop this round instead of failing 17 times. 섞인 화면·옛 build의 가림 오류도 모든 반에 걸리므로 멈춥니다.
        if(e.code==='BRIDGE_OFFLINE'||e.code==='BRIDGE_KEY'||/LOGIN_REQUIRED/.test(e.message)||maskedEveryClass(e)){cycle=null;nextCycleAt=t+retryMs;status.current=null;emit();return 'idle';}
      }
      finally{status.current=null;}
      if(result==='busy'){emit();return 'busy';}
      cycle.todo.shift();cycle.done++;
      if(!cycle.todo.length){status.lastCycle={date:cycle.date,finishedAt:now().toISOString(),classes:cycle.done};nextCycleAt=cycle.startedAt+intervalMs;cycle=null;}
      emit();return 'sync';
    }
    return 'idle';
  }
  async function loop(){
    while(running){
      let did;try{did=await step();}catch(e){did='idle';note(e.message,'error');}
      if(!running)break;
      if(did==='idle'||did==='busy'){
        const t=now().getTime(),soon=Math.min(...[...retryAt.values(),nextCycleAt].filter(x=>x>t).map(x=>x-t),did==='busy'?5000:maskedWait.size?15000:60000);
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
      unwatch=store.watchQueue(list=>{
        active=list;
        // retry_·proposal_ 요청은 운영포털 재처리·제안 흐름이 처리합니다(근거 표시를 복사해도 가져가지 않음).
        const live=list.filter(r=>isLiveRequest(r)&&['pending','approved'].includes(r.status)&&!ignored.has(r.id)&&!/^(retry|proposal)_/.test(String(r.id)));
        const ids=new Set(live.map(r=>r.id));for(const id of queue.keys())if(!ids.has(id))queue.delete(id);
        for(const r of live)queue.set(r.id,r);emit();wake?.();
      },e=>note('수정 대기열 구독 오류: '+e.message,'error'));
      note('중계를 시작했습니다. 이 탭을 열어 두세요.');
      if(autoLoop)void loop();
    },
    stop(){running=false;status.state='stopped';unwatch?.();unwatch=null;wake?.();note('중계를 멈췄습니다.');},
    // A manual refresh also retries a class marked 'no lecture' earlier today.
    syncNow(classId,date=today()){noLecture.get(date)?.delete(String(classId));manual.push({classId:String(classId),date});wake?.();},
    step,
    _debug:{queue,mirror,saved,noLecture,get nextCycleAt(){return nextCycleAt;},set nextCycleAt(v){nextCycleAt=v;}},
  };
}
