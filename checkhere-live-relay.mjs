// Relay for the live beta. Runs in the designated administrator's portal tab on
// the collector PC: it turns marked admin requests into verified CheckHere
// writes and keeps today's `checkhereCurrent` documents fresh. One task at a time.
import {cleanRequest,matchRequest,requestMatchesRecord,prepareApproval} from './checkhere/approval-core.mjs';
import {ACTIVE,CLASS_IDS,LIVE_INTERVAL_MS,NO_LECTURE,baseTag,checkLiveEdit,inLiveWindow,isLiveRequest,koreaClock,stamp,tagOf} from './checkhere-live-core.mjs';
import {requestsOverlap} from './checkhere-proposal-core.mjs';

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

const REQUIRED=['approval-current-sync-v1','live-approval-preview-v1','incremental-sync-v1'],MAX_ATTEMPTS=5;
export function createLiveRelay({bridge,store,user,log=()=>{},now=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),classIds=CLASS_IDS,intervalMs=LIVE_INTERVAL_MS,pollMs=1500,jobTimeoutMs=10*60*1000,retryMs=60000,inWindow=inLiveWindow}){
  const queue=new Map(),retryAt=new Map(),attempts=new Map(),ignored=new Set(),mirror=new Map(),saved=new Map(),noLecture=new Map(),manual=[];
  let cursor=null,capabilities=[],cycle=null,nextCycleAt=0,running=false,wake=null,unwatch=null,listeners=new Set(),active=[];
  const status={state:'stopped',lastCycle:null,lastError:null,processed:0,saves:0,queue:0,current:null};
  const emit=()=>{status.queue=[...queue.values()].length;for(const f of listeners)f({...status});};
  const note=(text,level='info')=>{log({at:now().toISOString(),level,text});if(level==='error')status.lastError=text;emit();};
  const today=()=>koreaClock(now()).date;
  const recKey=r=>`${r.version}|${r.collectedAt}`;

  async function refresh(){
    const s=await bridge.state(cursor);capabilities=s.capabilities||[];
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
  async function finishApply(r,idToken){
    const job=await waitJob(r.id);
    let result=job;
    if(job.status==='verified'&&job.platformSaved!==true)result=await bridge.api('reconcile',{approvalId:r.id,idToken:await user.getIdToken()});
    for(const rec of [job.current].filter(Boolean)){mirror.set(rec.id,rec);if(result.platformSaved===true)saved.set(rec.id,recKey(rec));}
    queue.delete(r.id);status.processed++;
    note(`${r.classId}반 ${r.name}: ${result.status==='verified'&&result.platformSaved===true?'체크히어 반영·확인·DB 저장 완료':`${result.status} · ${result.message||job.message||'결과를 확인해 주세요.'}`}`,result.status==='verified'?'info':'warn');
  }
  async function processRequest(r){
    status.current=`${r.classId}반 ${r.name}`;emit();
    if(!await store.isAdmin(r.createdBy)){ignored.add(r.id);queue.delete(r.id);note(`${r.classId}반 ${r.name}: 관리자가 아닌 계정(${r.createdBy})의 요청이라 건너뜁니다.`,'warn');return;}
    if(!REQUIRED.every(c=>capabilities.includes(c))){await refresh();if(!REQUIRED.every(c=>capabilities.includes(c)))throw Object.assign(Error('수집 PC에서 최신 「체크히어 시작.cmd」를 다시 실행해 주세요.'),{code:'BRIDGE_OLD'});}
    const idToken=await user.getIdToken();
    // Approved earlier but not started (e.g. the tab closed): the bridge re-reads before writing.
    if(r.status==='approved'){await bridge.api('apply',{approvalId:r.id,idToken});return finishApply(r,idToken);}
    let clean;try{clean=cleanRequest(r);}catch(e){return reject(r,e.message);}
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
    if(tagOf(r.reason)!==baseTag(record,Object.keys(clean.changes)))return reject(r,'수정 화면을 연 뒤 체크히어 값이 바뀌었습니다. 새 값을 확인하고 다시 수정해 주세요.');
    let judgement;try{judgement=checkLiveEdit(record,clean.changes,capabilities);}catch(e){return reject(r,e.message);}
    if(Object.keys(judgement.defaults).length&&!capabilities.includes('memo-default-time-v1'))throw Object.assign(Error('수집 PC에서 최신 「체크히어 시작.cmd」를 다시 실행해 주세요.'),{code:'BRIDGE_OLD'});
    let approval;try{approval=prepareApproval(r,record,{identities});}catch(e){return reject(r,e.message);}
    await store.approve(r.id,approval,r);
    await bridge.api('apply',{approvalId:r.id,idToken});
    return finishApply(r,idToken);
  }

  function eligible(){
    const t=now().getTime();
    return [...queue.values()].filter(r=>!ignored.has(r.id)&&(retryAt.get(r.id)||0)<=t).sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt));
  }
  async function step(){
    const next=eligible()[0];
    if(next){
      try{await processRequest(next);retryAt.delete(next.id);attempts.delete(next.id);}
      catch(e){
        // Bridge/login problems wait indefinitely; a request that keeps failing on its own is closed.
        const infra=['BRIDGE_OFFLINE','BRIDGE_BUSY','BRIDGE_KEY','BRIDGE_OLD'].includes(e.code)||/LOGIN_REQUIRED/.test(e.message);
        const n=infra?0:(attempts.get(next.id)||0)+1;attempts.set(next.id,n);
        if(n>=MAX_ATTEMPTS&&next.status==='pending'){await store.reject(next.id,`자동 반영을 ${n}번 시도했지만 처리하지 못했습니다: ${e.message}`).catch(()=>{});queue.delete(next.id);note(`${next.classId}반 ${next.name}: ${n}번 실패해 자동 반영을 중단했습니다 — ${e.message}`,'error');}
        else{retryAt.set(next.id,now().getTime()+retryMs);note(`${next.classId}반 ${next.name}: ${e.message} (잠시 후 다시 시도)`,'error');}
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
        // Logged out or bridge closed: stop this round instead of failing 17 times.
        if(e.code==='BRIDGE_OFFLINE'||e.code==='BRIDGE_KEY'||/LOGIN_REQUIRED/.test(e.message)){cycle=null;nextCycleAt=t+retryMs;status.current=null;emit();return 'idle';}
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
        const t=now().getTime(),soon=Math.min(...[...retryAt.values(),nextCycleAt].filter(x=>x>t).map(x=>x-t),did==='busy'?5000:60000);
        await new Promise(r=>{wake=r;sleep(Math.max(1000,soon)).then(r);});wake=null;
      }
    }
  }
  return {
    status:()=>({...status}),
    onStatus(f){listeners.add(f);return()=>listeners.delete(f);},
    async start({loop:autoLoop=true}={}){
      if(running)return;
      await refresh();
      if(!REQUIRED.every(c=>capabilities.includes(c)))throw Error('수집 PC의 연결 프로그램이 오래된 버전입니다. 「체크히어 시작.cmd」를 다시 실행해 주세요.');
      running=true;status.state='running';status.lastError=null;
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
