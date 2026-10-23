// 2기 출결 쓰기 대기열(2026-10-21, 사용자 목표 '100명 동시, 담임 16명이 학생 50명씩 1~2분 안에 입력해도 오류 0, 모두 2기 마스터시트에').
// 담임 portalSave·관리자 b2Save를 바로 Apps Script로 보내지 않고 Firestore writeQueue에 학생·날짜마다 문서 하나로 넣은 뒤 곧바로 '접수'로 답합니다.
// Vercel이 서비스 계정으로 대기열을 비웁니다(drain): writeQueueLease/main 임대(한 번에 한 곳만) → pending(+멈춘 applying)을 오래된 순서(문서 id = 시간순)로 최대 QUEUE_BATCH건
// → applying 표시 → Apps Script b2ApplyQueue 한 번(문서 잠금 한 번) → 항목마다 done/failed. 시트가 안 받으면 pending으로 되돌리고 5번째에 failed('시트에 반영하지 못했습니다').
// 시트 계약(Apps Script, 2026-10-21): b2ApplyQueue {items:[{id,kind:'attendance',actor,role,via,before?,rec:{cls,name,date,type,inT,outT,oa,ob,reason,ev,evr}}]} ≤300,
// 순서대로(같은 학생·날짜는 마지막 값), results는 items와 같은 순서 {id,ok:true,action,sig?,warn?} | {id,ok:false,error,cls,name,date}. 잠금 대기 45초.
// 브라우저는 대기열을 직접 읽지도 쓰지도 않습니다(firestore.rules가 막음). 상태는 /api/teacher-beta queueStatus로, 출결판·출결원장 읽기(portalData·b2Bundle)는 서버가 덮어 보입니다(pending:true).
// CommonJS: Vercel이 api/*.js의 import를 require로 바꾸므로(lib/cohort.cjs와 같은 이유).
const {createHash,timingSafeEqual}=require('node:crypto');
const {createFirestoreAdmin,parseServiceAccount,preconditionFailed,toValue}=require('./firestore-admin.cjs');

const QUEUE_COLLECTION='writeQueue',LEASE_PATH='writeQueueLease/main';
// 한 번에 시트로 보내는 건수. 시트 계약은 ≤300이지만 2026-10-23 16개 반 동시 시험(511건)에서 여러 반에 걸친 300건 한 번이 40초 예산을 넘어
// (시트는 받았는데 시간 초과로 보고 다시 보냄) 60건으로 줄입니다. v21 실측 300건 9.5초는 17반 한 반만이었습니다.
const QUEUE_BATCH=60;
// 한 묶음 안의 지우기(type '') 건수 상한. v21은 지우기 한 건에 약 2.3초라 낮췄다가, 시트 v22(2026-10-21 13:29)부터 300건 지우기 6.1초·쓰기 7.4초·실패 0이라 묶음 크기와 같게 풀었습니다.
// 시트가 다시 느려지면 이 값만 낮추면 됩니다. 넘는 지우기는 그 자리에서 묶음을 끊어 다음 차례로(순서가 바뀌지 않게).
const QUEUE_MAX_DELETES=300;
const ENQUEUE_MAX=100;      // portalSaveBatch 한 요청의 건수
const MAX_ATTEMPTS=5;       // 시트에 못 보낸 횟수가 이만큼이면 failed
const LEASE_MS=120000;      // 임대 시간: 시트 호출(잠금 대기 45초 + 처리)이 끝났을 시간보다 넉넉히. 함수가 죽어도 이 뒤에는 다른 곳이 이어받음
const STALE_MS=30000;       // 안전망: 이보다 오래된 pending이 있으면 아무 요청 때나 drain을 깨움
const NUDGE_MS=8000;        // queueStatus로 물어본 항목이 이보다 오래 pending이면 drain을 깨움
const TICK_MS=20000;        // 안전망 확인은 함수 인스턴스마다 20초에 한 번만(Firestore 읽기 줄임)
const GIVE_UP='시트에 반영하지 못했습니다';
const SERVER_ACTOR='write-queue@vercel';
// 출결 유형(''는 기록 지우기). 담임 출결판·출결대조와 같은 목록(해당없음·중복 포함)
const QUEUE_TYPES=['','출석','지각','조퇴','외출','중복','결석','인정출석','인정지각','인정조퇴','인정외출','해당없음'];
const OPEN=['pending','applying'];
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,TIME=/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,ID=/^[0-9a-z]{12,40}$/;
const kstDay=ms=>new Date(ms+9*3600e3).toISOString().slice(0,10);

// 환경변수: FIREBASE_SERVICE_ACCOUNT(있으면 켜짐), WRITE_QUEUE=off(끄기). 서비스 계정 프로젝트가 2기 프로젝트와 다르면 켜지 않습니다.
function queueConfig(env,project){
 const sw=String(env.WRITE_QUEUE||'').trim().toLowerCase();
 if(['off','0','false','no'].includes(sw))return {enabled:false,reason:'off'};
 const sa=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
 if(!sa)return {enabled:false,reason:env.FIREBASE_SERVICE_ACCOUNT?'bad-key':'no-key'};
 if(project&&sa.project_id!==project)return {enabled:false,reason:'other-project'};
 return {enabled:true,sa,project:project||sa.project_id};
}
// 저장 한 건 모양 확인(서버에서 바로 거절할 것만): 이름·날짜 모양·유형 목록·시간 모양·글 길이. 명부·교육일은 시트가 봅니다.
// via 'portalSave'(담임 출결판: 사유는 r, 증빙은 시트 값 유지) · 'b2Save'(관리자 출결대조: reason·ev·evr)
function queueRec(p,cls,via){
 if(!p||typeof p!=='object'||Array.isArray(p))return null;
 const s=(v,max)=>{const t=String(v??'').trim();return t.length<=max?t:null;};
 const name=s(p.name,60),date=String(p.date??'').trim(),type=String(p.type??'').trim();
 if(!name||!DATE.test(date)||!QUEUE_TYPES.includes(type))return null;
 const rec={cls:String(cls),name,date,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:''};
 for(const k of ['inT','outT','oa','ob']){const v=String(p[k]??'').trim();if(v&&!TIME.test(v))return null;rec[k]=v;}
 const reason=s(via==='portalSave'?p.r:p.reason,500);if(reason===null)return null;rec.reason=reason;
 if(via==='b2Save'){const ev=s(p.ev,40),evr=s(p.evr,500);if(ev===null||evr===null)return null;rec.ev=ev;rec.evr=evr;}
 return rec;
}
// 화면이 본 행 지문(before, 시트 b2Sig_ 8자리. 없던 행은 ''): 담임 출결판도 보냅니다(리허설 안전장치 2026-10-21, 시트 v23이 담임 항목도 비교).
// 없으면 undefined(예전처럼 비교 안 함), 모양이 틀리면 null(거절).
const BEFORE_MAX=64;
function beforeOf(x){const b=x&&typeof x==='object'?x.before:undefined;if(b===undefined||b===null)return undefined;return typeof b==='string'&&b.length<=BEFORE_MAX&&/^[\w!*-]*$/.test(b)?b:null;}
// 문서 id: 밀리초(36진 9자리) + 인스턴스 안 순번(4자리) + 무작위 6자리 → 이름순 = 대략 시간순(Firestore __name__ 순서로 읽음, 복합 색인 필요 없음)
let seq=0;
function queueId(ms){seq=(seq+1)%1679616;return Math.max(0,ms).toString(36).padStart(9,'0')+seq.toString(36).padStart(4,'0')+Math.random().toString(36).slice(2,8).padEnd(6,'0');}
const idMs=id=>parseInt(String(id).slice(0,9),36)||0;
// Vercel 함수: 응답한 뒤에도 일을 끝내게 waitUntil(@vercel/functions가 쓰는 요청 문맥)을 씁니다. 없으면(로컬·시험) 그냥 돌립니다.
function runInBackground(start){
 const promise=start();
 const ctx=globalThis[Symbol.for('@vercel/request-context')]?.get?.();
 if(typeof ctx?.waitUntil==='function'){ctx.waitUntil(promise);return 'waitUntil';}
 return 'detached';
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const query=(where,limit)=>({from:[{collectionId:QUEUE_COLLECTION}],where,orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit});
const eq=(field,value)=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:toValue(value)}});
const isIn=(field,values)=>({fieldFilter:{field:{fieldPath:field},op:'IN',value:toValue(values)}});

// callSheet(action,args,extra): api/teacher-beta.js의 Apps Script 호출(재시도 포함)을 그대로 씁니다.
// resolveClass·b2Args: 반 범위 규칙도 teacher-beta.js 것을 그대로. failText(code): 오류 코드 → 담임에게 보일 한국어.
function createWriteQueue({callSheet,project='',classIds=[],resolveClass,b2Args,failText=c=>c,env=process.env,fetchImpl,now=()=>Date.now(),defer=runInBackground,log=console,maxDeletes=QUEUE_MAX_DELETES}){
 const opts={now,defer,log,env,maxDeletes};
 let cfgKey=null,store=null,leaseSeq=0;const state={running:null,again:false,lastTick:0}; // state: 시험에서 안전망 간격을 맞출 때만 만짐
 const instance=Math.random().toString(36).slice(2,10);
 function fs(){
  const e=opts.env,proj=typeof project==='function'?project():project,key=`${e.FIREBASE_SERVICE_ACCOUNT||''}\u0000${e.WRITE_QUEUE||''}\u0000${proj||''}`;
  if(key!==cfgKey){cfgKey=key;const c=queueConfig(e,proj);store=c.enabled?createFirestoreAdmin({serviceAccount:c.sa,project:c.project,now:()=>opts.now(),...(fetchImpl?{fetchImpl}:{})}):null;}
  return store;
 }
 const enabled=()=>!!fs();
 // 공유 비밀(DRAIN_SECRET)로 /api/drain을 부를 수 있는지(길이가 달라도 시간 차이 없게 해시끼리 비교)
 function secretOk(given){
  const s=String(opts.env.DRAIN_SECRET||'');if(!s||!given)return false;
  const h=v=>createHash('sha256').update(String(v)).digest();return timingSafeEqual(h(s),h(given));
 }
 // 대기열 비우기 깨우기. waitUntil이 없는 곳(응답 뒤 함수가 멈추는 곳)에서 DRAIN_SECRET과 주소를 알면 /api/drain을 따로 깨웁니다(1초만 기다림).
 function kick(req){
  const how=opts.defer(()=>drain().catch(e=>opts.log.error('write_queue_drain',e?.message||e)));
  const host=req?.headers?.['x-forwarded-host']||req?.headers?.host,secret=opts.env.DRAIN_SECRET;
  if(how==='waitUntil'||!secret||!host)return null;
  return Promise.race([(fetchImpl||fetch)(`https://${host}/api/drain`,{method:'POST',headers:{'x-drain-secret':secret}}).catch(()=>{}),sleep(1000)]);
 }

 // ---------- 넣기 ----------
 async function enqueue(user,via,entries,req){
  const f=fs();if(!f)throw Error('QUEUE_OFF');
  const t=opts.now(),docs=entries.map(({rec,before})=>({
   id:queueId(t),actor:user.email,userRole:user.role,role:via==='portalSave'?'TEACHER':'ADMIN',via,kind:'attendance',
   cls:rec.cls,name:rec.name,date:rec.date,key:`${rec.cls}|${rec.name}|${rec.date}`,rec,...(before!==undefined?{before}:{}),
   status:'pending',bucket:`${rec.cls}|open`,day:kstDay(t),attempts:0,createdMs:t}));
  await f.commit(docs.map(d=>f.updateWrite(`${QUEUE_COLLECTION}/${d.id}`,d,{precondition:{exists:false},serverTime:['createdAt','updatedAt']})));
  await kick(req);
  return docs.map(d=>d.id);
 }

 // ---------- 임대(한 번에 한 곳만 비움) ----------
 async function acquire(f){
  const t=opts.now(),holder=`${instance}-${++leaseSeq}`,cur=await f.get(LEASE_PATH);
  if(cur&&cur.data.holder&&(Date.parse(cur.data.expiresAt||'')||0)>t)return null;
  try{
   const [w]=await f.commit([f.updateWrite(LEASE_PATH,{holder,expiresAt:new Date(t+LEASE_MS),at:new Date(t)},{precondition:cur?{updateTime:cur.updateTime}:{exists:false}})]);
   return {holder,updateTime:w?.updateTime};
  }catch(e){if(preconditionFailed(e))return null;throw e;}
 }
 async function release(f,lease){
  try{await f.commit([f.updateWrite(LEASE_PATH,{holder:'',expiresAt:new Date(0),at:new Date(opts.now())},{precondition:{updateTime:lease.updateTime}})]);}
  catch(e){if(!preconditionFailed(e))throw e;}
 }

 // ---------- 비우기 ----------
 const item=d=>{const r=d.data.rec||{},b=d.data.before;
  return {id:d.id,kind:'attendance',actor:d.data.actor,role:d.data.role,via:d.data.via,...(b!==undefined&&b!==null&&!d.uncertain?{before:String(b)}:{}),
   rec:{cls:String(r.cls),name:r.name,date:r.date,type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',reason:r.reason||'',ev:r.ev||'',evr:r.evr||''}};};
 const doneWrite=(f,d,r,rev)=>f.updateWrite(d.path,{status:'done',bucket:`${d.data.cls}|done`,action:String(r.action||''),sig:String(r.sig||''),warn:String(r.warn||''),rev:Number(rev)||0,uncertain:false},
  {mask:['status','bucket','action','sig','warn','rev','uncertain','error','lastError','lease'],serverTime:['updatedAt','appliedAt']});
 const failWrite=(f,d,error,lastError)=>f.updateWrite(d.path,{status:'failed',bucket:`${d.data.cls}|failed|${kstDay(opts.now())}`,error:String(error).slice(0,500),uncertain:false,...(lastError?{lastError:String(lastError).slice(0,300)}:{})},
  {mask:['status','bucket','error','uncertain','lastError','lease'],serverTime:['updatedAt']});
 // 시트에 못 보냄: 다시(pending). uncertain = 시트가 받았는지 모름(시간 초과 등) → 다시 보낼 때 before(그사이 바뀜 확인)를 빼서 자기 자신과 충돌하지 않게.
 const retryWrite=(f,d,msg,uncertain)=>d.attempts>=MAX_ATTEMPTS?failWrite(f,d,GIVE_UP,msg)
  :f.updateWrite(d.path,{status:'pending',lastError:String(msg).slice(0,300),uncertain:!!(uncertain||d.uncertain)},{mask:['status','lastError','uncertain','lease'],serverTime:['updatedAt']});
 // 시트가 아직 b2ApplyQueue를 모르면(배포 전) 예전 저장(portalSave·b2Save)으로 한 건씩. 시간이 모자라면 남은 것은 다음에.
 async function legacy(claimed,deadline){
  const results=[];let rev=0;
  for(const d of claimed){
   if(opts.now()>deadline)break;
   const r=d.data.rec||{};
   try{
    if(d.data.via==='portalSave'){
     const {before}=item(d);
     const out=await callSheet('portalSave',[{cls:Number(r.cls),pin:'',name:r.name,date:r.date,type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',r:r.reason||'',...(before!==undefined?{before}:{})}]);
     if(!out?.ok)results.push({id:d.id,ok:false,error:String(out?.error||GIVE_UP)});
     else if(out.data?.ok===false)results.push({id:d.id,ok:false,error:String(out.data.msg||GIVE_UP)}); // 그사이 바뀜은 msg가 'CONFLICT: …'
     else results.push({id:d.id,ok:true,action:'write',warn:String(out.data?.warn||'')});
    }else{
     const {before}=item(d);
     const out=await callSheet('b2Save',[{cls:String(r.cls),name:r.name,date:r.date,type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',reason:r.reason||'',ev:r.ev||'',evr:r.evr||'',...(before!==undefined?{before}:{})}],{actor:d.data.actor,role:'ADMIN'});
     if(!out?.ok)results.push({id:d.id,ok:false,error:String(out?.error||GIVE_UP)});
     else{rev=Number(out.data?.rev)||rev;results.push({id:d.id,ok:true,action:out.data?.unchanged?'none':'write',sig:String(out.data?.sig||'')});}
    }
   }catch{break;} // 연결 오류: 이것과 남은 것은 다음 차례에
  }
  return {ok:true,data:{ok:true,rev,results}};
 }
 async function round(f,deadline){
  const lease=await acquire(f);if(!lease)return {busy:true};
  let keep=false;
  try{
   const found=await f.runQuery(query(isIn('status',OPEN),QUEUE_BATCH));
   let dels=0;const cut=found.findIndex(d=>!d.data.rec?.type&&++dels>opts.maxDeletes),docs=cut<0?found:found.slice(0,cut);
   if(!docs.length)return {count:0};
   // 멈춘 applying(앞선 drain이 끝을 못 봄)은 시트가 받았는지 모르는 것으로 봅니다.
   const claimed=docs.map(d=>({...d,attempts:(Number(d.data.attempts)||0)+1,uncertain:d.data.status==='applying'||d.data.uncertain===true}));
   await f.commit(claimed.map(d=>f.updateWrite(d.path,{status:'applying',attempts:d.attempts,uncertain:d.uncertain,lease:lease.holder},{mask:['status','attempts','uncertain','lease'],precondition:{exists:true},serverTime:['updatedAt']})));
   let res=null,err=null;
   // 시트 호출 시간 예산은 이 drain의 끝(deadline)까지(lib/sheet-retry.cjs가 그 안에서 몰림 오류만 다시 시도)
   try{res=await callSheet('b2ApplyQueue',[{items:claimed.map(item)}],{actor:SERVER_ACTOR,role:'ADMIN'},{deadline});}catch(e){err=e;}
   if(!err&&res?.ok===false&&/unknown action/i.test(String(res.error||'')))res=await legacy(claimed,deadline);
   const body=res?.data&&Array.isArray(res.data.results)?res.data:res;
   if(err||!res||res.ok===false||body?.ok===false||!Array.isArray(body?.results)){
    // 결과 모름: 시간 초과·읽지 못한 응답·시트가 HTTP 오류로 끝남(lib/sheet-retry.cjs failure 'maybe'). 연결 자체가 안 됨(fetch 실패)·몰림(SHEET_BUSY)은 시트가 쓰지 않음.
    const code=err?.message||String(body?.error||res?.error||'SHEET_ERROR'),uncertain=!!err&&(['SHEET_TIMEOUT','SHEET_BAD_RESPONSE'].includes(code)||(err.failure==='maybe'&&/^HTTP|transient/.test(String(err.detail||''))));
    keep=uncertain; // 시트가 아직 처리 중일 수 있으면 임대를 놓지 않음(만료까지 다른 drain이 같은 항목을 겹쳐 보내지 않게)
    await f.commit(claimed.map(d=>retryWrite(f,d,code,uncertain)));
    return {count:claimed.length,retried:claimed.filter(d=>d.attempts<MAX_ATTEMPTS).length,failed:claimed.filter(d=>d.attempts>=MAX_ATTEMPTS).length,stop:true,error:code};
   }
   const results=body.results,byId=new Map(results.filter(r=>r?.id).map(r=>[String(r.id),r]));
   let done=0,failed=0,retried=0;const writes=[];
   claimed.forEach((d,i)=>{
    const r=String(results[i]?.id)===d.id?results[i]:byId.get(d.id);
    if(!r){retried++;writes.push(retryWrite(f,d,'NO_RESULT',false));return;}
    if(r.ok===true){done++;writes.push(doneWrite(f,d,r,body.rev));}
    else{failed++;writes.push(failWrite(f,d,r.error||GIVE_UP));}
   });
   await f.commit(writes);
   return {count:claimed.length,done,failed,retried,rev:Number(body.rev)||0,more:found.length>docs.length};
  }finally{if(!keep)await release(f,lease).catch(e=>opts.log.error('write_queue_release',e?.message||e));}
 }
 // 한 인스턴스 안에서는 drain 하나만(돌고 있으면 한 번 더 돌라고만 표시). 차례를 시작하는 것은 startWithinMs(20초) 안에서만: 한 차례(300건) ≈ 10초(시트 v22 실측)라 800건이 세 차례 30초 안팎으로 Vercel maxDuration 60초 안에 끝납니다.
 async function drain({budgetMs=40000,startWithinMs=20000}={}){
  const f=fs();if(!f)return {enabled:false};
  if(state.running){state.again=true;return {joined:true};}
  const t0=opts.now(),sum={enabled:true,rounds:0,done:0,failed:0,retried:0,busy:false};
  state.running=(async()=>{
   for(;;){
    state.again=false;
    const r=await round(f,t0+budgetMs);
    if(r.busy){sum.busy=true;break;}
    if(r.count){sum.rounds++;sum.done+=r.done||0;sum.failed+=r.failed||0;sum.retried+=r.retried||0;if(r.error)sum.error=r.error;}
    if(r.stop||(!r.count&&!state.again)||opts.now()-t0>startWithinMs)break;
   }
   return sum;
  })();
  try{return await state.running;}finally{state.running=null;}
 }
 // 안전망(아무 API 요청 때): 30초 넘은 pending이 있으면 drain을 깨웁니다. 인스턴스마다 20초에 한 번만 봅니다.
 function tick(req){
  const t=opts.now();if(state.running||t-state.lastTick<TICK_MS||!fs())return;state.lastTick=t;
  opts.defer(()=>(async()=>{const [d]=await fs().runQuery(query(eq('status','pending'),1));if(d&&opts.now()-(Number(d.data.createdMs)||idMs(d.id))>STALE_MS)await drain();})().catch(e=>opts.log.error('write_queue_tick',e?.message||e)));
  void req;
 }

 // ---------- 상태(queueStatus) ----------
 const view=(d,user)=>{const x=d.data,r=x.rec||{},admin=user.role==='ADMIN';
  return {id:d.id,status:x.status,cls:String(x.cls),name:x.name,date:x.date,type:r.type,via:x.via,mine:x.actor===user.email,...(admin?{actor:x.actor}:{}),
   createdMs:Number(x.createdMs)||idMs(d.id),attempts:Number(x.attempts)||0,error:x.error||'',warn:x.warn||'',sig:x.sig||'',action:x.action||'',rev:Number(x.rev)||0,
   rec:{type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',reason:r.reason||'',...(x.role==='ADMIN'?{ev:r.ev||'',evr:r.evr||''}:{})}};};
 // ids: 내가 넣은 항목(최대 200, 담임은 자기 것·자기 반만). classes: 그 반의 대기·applying + 오늘 실패(담임은 자기 반만).
 async function status(user,{ids=[],classes=[]}={},req){
  const f=fs();if(!f)return {enabled:false,items:[]};
  const want=[...new Set((Array.isArray(ids)?ids:[]).map(String).filter(x=>ID.test(x)))].slice(0,200),docs=new Map();
  for(const d of await f.batchGet(want.map(id=>`${QUEUE_COLLECTION}/${id}`)))docs.set(d.id,d);
  if(classes.length){const today=kstDay(opts.now()),buckets=classes.flatMap(c=>[`${c}|open`,`${c}|failed|${today}`]).slice(0,30);for(const d of await f.runQuery(query(isIn('bucket',buckets),500)))docs.set(d.id,d);}
  const seen=d=>user.role==='ADMIN'||d.data.actor===user.email||(user.classIds||[]).includes(String(d.data.cls));
  const items=[...docs.values()].filter(seen).sort((a,b)=>a.id<b.id?-1:1).map(d=>view(d,user)),t=opts.now();
  if(items.some(x=>OPEN.includes(x.status)&&t-x.createdMs>NUDGE_MS))await kick(req);
  return {enabled:true,now:t,items};
 }

 // ---------- 읽기 덮어쓰기(portalData·b2Bundle) ----------
 async function openDocs(cls){
  const f=fs();if(!f)return null;
  return f.runQuery(query(cls==='all'?isIn('status',OPEN):eq('bucket',`${cls}|open`),1000));
 }
 function overlayPortal(data,docs){
  data.recs=data.recs&&typeof data.recs==='object'?data.recs:{};
  for(const d of docs){const r=d.data.rec||{},key=`${r.name}|${r.date}`;
   if(!r.type){delete data.recs[key];continue;}
   data.recs[key]={...(data.recs[key]||{}),type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',r:r.reason||'',...(d.data.role==='ADMIN'?{ev:r.ev||'',evr:r.evr||''}:{}),pending:true};}
  return data;
 }
 function overlayBundle(data,docs){
  if(!Array.isArray(data.ledgerCols)||!Array.isArray(data.ledger)||!docs.length)return data;
  const cols=data.ledgerCols.includes('pending')?data.ledgerCols:(data.ledgerCols=[...data.ledgerCols,'pending']),ix=Object.fromEntries(cols.map((k,i)=>[k,i]));
  const keyOf=row=>`${row[ix.cls]}|${row[ix.name]}|${row[ix.date]}`,at=new Map(data.ledger.map((row,i)=>[keyOf(row),i])),drop=new Set();
  for(const d of docs){const r=d.data.rec||{},k=`${r.cls}|${r.name}|${r.date}`,i=at.get(k);
   if(!r.type){if(i!==undefined)drop.add(i);continue;}
   const vals={type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',reason:r.reason||'',...(d.data.role==='ADMIN'?{ev:r.ev||'',evr:r.evr||''}:{}),pending:true};
   if(i!==undefined){drop.delete(i);const row=[...data.ledger[i]];for(const [c,v] of Object.entries(vals))if(c in ix)row[ix[c]]=v;data.ledger[i]=row;}
   else{const base={date:r.date,cls:String(r.cls),name:r.name,ev:'',evr:'',memo:'',evApplied:'',check:'',prov:'반영 대기',flag:'',sig:'',...vals};data.ledger.push(cols.map(c=>base[c]??''));at.set(k,data.ledger.length-1);}
  }
  if(drop.size)data.ledger=data.ledger.filter((_,i)=>!drop.has(i));
  return data;
 }
 // api/teacher-beta.js가 시트 응답 뒤 부릅니다. 대기열을 못 읽으면 시트 값 그대로(조용히).
 async function overlay(user,action,body,rest,data){
  if(!data||!enabled()||(action!=='portalData'&&action!=='b2Bundle'))return data;
  if(action==='portalData')data.queue=true; // 담임 출결판: 모아 보내기(portalSaveBatch)·반영 대기 표시를 켭니다
  try{
   const cls=action==='portalData'?String(resolveClass(user,body,action,rest)):String(b2Args(user,'b2Bundle',rest)[0]);
   const docs=await openDocs(cls);
   return action==='portalData'?overlayPortal(data,docs):overlayBundle(data,docs);
  }catch(e){opts.log.warn('write_queue_overlay',e?.message||e);return data;}
 }

 // ---------- api/teacher-beta.js 요청 고리 ----------
 // 대기열이 맡는 요청이면 {status,body}, 아니면 null(그대로 시트로). 대기열에 못 넣으면(Firestore 오류) null → 예전처럼 바로 시트에 저장.
 const ok=data=>({status:200,body:{ok:true,data}});
 async function directBatch(cls,recs,befores=[]){
  const t0=opts.now(),results=[];
  for(const [i,r] of recs.entries()){
   if(opts.now()-t0>40000){results.push({ok:false,msg:'저장할 것이 많아 다 저장하지 못했습니다. 잠시 후 다시 저장해 주세요.',retry:true});continue;}
   try{
    const before=befores[i];
    const out=await callSheet('portalSave',[{cls,pin:'',name:r.name,date:r.date,type:r.type,inT:r.inT,outT:r.outT,oa:r.oa,ob:r.ob,r:r.reason,...(before!==undefined?{before}:{})}]);
    // 시트 v23: before가 다르면 {ok:false, conflict:true, msg:'CONFLICT: 운영팀이 그사이…'}
    results.push(out?.ok?{ok:out.data?.ok!==false,msg:String(out.data?.msg||''),warn:String(out.data?.warn||''),...(out.data?.conflict?{conflict:true}:{})}:{ok:false,msg:String(out?.error||'저장하지 못했습니다.')});
   }catch(e){results.push({ok:false,msg:failText(e.message),retry:true});}
  }
  return {ok:true,queued:false,results};
 }
 async function handle({user,action,rest,body,req}){
  if(action==='queueStatus'){
   const p=rest[0]&&typeof rest[0]==='object'?rest[0]:{},c=p.cls===undefined||p.cls===null?'':String(p.cls),admin=user.role==='ADMIN';
   const classes=!c?[]:c==='all'?(admin?[]:user.classIds):admin?(classIds.includes(c)?[c]:[]):(user.classIds.includes(c)?[c]:user.classIds.slice(0,1));
   return ok(await status(user,{ids:p.ids,classes},req));
  }
  if(action==='portalSaveBatch'){
   const cls=resolveClass(user,body,'portalSave',rest),list=Array.isArray(rest[0]?.items)?rest[0].items:null;
   if(!list||!list.length||list.length>ENQUEUE_MAX)throw Error('BAD_REQUEST');
   const recs=list.map(x=>queueRec(x,cls,'portalSave')),befores=list.map(beforeOf);if(recs.some(r=>!r)||befores.some(b=>b===null))throw Error('QUEUE_BAD_ITEM');
   if(enabled()){try{return ok({ok:true,queued:true,ids:await enqueue(user,'portalSave',recs.map((rec,i)=>({rec,before:befores[i]})),req)});}catch(e){opts.log.error('write_queue_enqueue',e?.message||e);}}
   return ok(await directBatch(cls,recs,befores));
  }
  if((action!=='portalSave'&&action!=='b2Save')||!enabled())return null;
  let rec,before;
  if(action==='portalSave'){rec=queueRec(rest[0],resolveClass(user,body,action,rest),'portalSave');before=beforeOf(rest[0]);if(before===null)throw Error('QUEUE_BAD_ITEM');}
  else{const [p]=b2Args(user,'b2Save',rest);if(!classIds.includes(String(p.cls??'')))throw Error('BAD_CLASS');rec=queueRec(p,p.cls,'b2Save');if(p.before!==undefined&&p.before!==null)before=String(p.before).slice(0,200);}
  if(!rec)throw Error('QUEUE_BAD_ITEM');
  try{const [id]=await enqueue(user,action,[{rec,before}],req);return ok({ok:true,queued:true,id});}
  catch(e){opts.log.error('write_queue_enqueue',e?.message||e);return null;}
 }
 return {opts,state,enabled,secretOk,handle,overlay,tick,drain,status,enqueue,kick};
}
module.exports={BEFORE_MAX,beforeOf,QUEUE_COLLECTION,LEASE_PATH,QUEUE_BATCH,QUEUE_MAX_DELETES,ENQUEUE_MAX,MAX_ATTEMPTS,LEASE_MS,STALE_MS,NUDGE_MS,GIVE_UP,QUEUE_TYPES,SERVER_ACTOR,queueConfig,queueRec,queueId,kstDay,runInBackground,createWriteQueue};
