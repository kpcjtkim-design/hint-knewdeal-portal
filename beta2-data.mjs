// 2기 마스터시트 읽기·쓰기. 브라우저 → /api/teacher-beta(로그인 확인) → Apps Script(2기 마스터시트에 붙은 프로젝트) → 마스터시트.
// 2기는 운영총괄 동기화가 없어 '가져오기'(b2SyncNow)·'운영총괄 값으로'(b2Release)를 부르지 않습니다.
// 변경 번호(rev)가 같으면 다시 읽지 않고, 저장한 행은 받은 값으로 바로 고쳐 Vercel·Apps Script 호출을 줄입니다.
import {decodeBundle,ledgerKey,SHEET_BUSY_CODES,sheetBusyText} from './beta2-core.mjs';
import {readAttendanceSummary} from './attendance-derived-store.mjs';

// 읽기 기능(응답 늦음이면 저장 안내가 아니라 서버 글 그대로).
const READS=new Set(['b2Bundle','b2Rev','b2Docs','b2Status','b2Vocs','b2ModuleTimes','b2DayTimes','b2LedgerMemos','b2Dropouts','b2Completions','b2Schedule','b2Officers','b2DayMemos','portalRoster','portalData']);
const bundles=new Map(),schedules=new Map(),officerLists=new Map(),dayMemoLists=new Map();
export function forgetBeta2Cache(){bundles.clear();schedules.clear();officerLists.clear();dayMemoLists.clear();}
// 마지막 변경 번호 응답(b2Rev: rev·sync·voc). 화면마다 클라이언트를 새로 만들어도 함께 씁니다.
// 민원·이슈 알림(beta2-admin.mjs·담임 화면)은 다른 화면이 방금 확인한 값을 그대로 써서 Apps Script 호출을 늘리지 않습니다.
const revListeners=new Set();let lastRev={at:0,value:null};
export function onBeta2Rev(fn){revListeners.add(fn);if(lastRev.value)queueMicrotask(()=>{if(revListeners.has(fn))fn(lastRev.value);});return ()=>revListeners.delete(fn);}
export const lastBeta2Rev=()=>lastRev;
export function createBeta2Client(user,{endpoint='/api/teacher-beta',fetchImpl=(...a)=>fetch(...a),db=null}={}){
 async function call(action,...args){
  const token=await user.getIdToken();
  let res;try{res=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({action,args}),cache:'no-store'});}
  catch{throw Error('마스터시트 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.');}
  const j=await res.json().catch(()=>({ok:false,error:'마스터시트 응답을 읽지 못했습니다.'}));
  // 몰림(SHEET_BUSY·SHEET_TIMEOUT, 서버가 다시 시도한 뒤): busy·attempts·retries를 붙입니다. 쓰기 화면(출결대조 등)은 초안을 남기고 이 글을 보입니다.
  if(!j.ok){const text=String(j.error||'마스터시트 요청을 처리하지 못했습니다.'),code=j.code||(text.startsWith('CONFLICT')?'CONFLICT':''),busy=SHEET_BUSY_CODES.includes(code);
   const msg=code==='SHEET_TIMEOUT'&&!READS.has(action)?sheetBusyText(j.retries)+' · 저장됐는지 확인되지 않았습니다':text.replace(/^CONFLICT:\s*/,'');
   throw Object.assign(Error(msg),{code,busy,attempts:Number(j.attempts)||1,retries:Number(j.retries)||0});}
  return j.data;
 }
 async function rev(){
  const r=await call('b2Rev');
  lastRev={at:Date.now(),value:r};
  for(const fn of [...revListeners]){try{fn(r);}catch(e){console.warn(e);}}
  return r;
 }
 async function bundle(cls='all',{fresh=false,maxAge=20000}={}){
  const key=String(cls),hit=bundles.get(key)||(key!=='all'?bundles.get('all'):null);
  if(hit&&!fresh){
   if(Date.now()-hit.at<maxAge)return hit.bundle;
   const r=await rev();if(r.rev===hit.bundle.rev){hit.at=Date.now();hit.bundle.sync=r.sync;return hit.bundle;}
  }
  const b=decodeBundle(await call('b2Bundle',key));bundles.set(key,{at:Date.now(),bundle:b});return b;
 }
 // 시간표(마스터시트 교육일정, b2Schedule {cls?, from?, to?}): 묶음처럼 변경 번호(rev)가 같으면 다시 읽지 않습니다. 담임은 Vercel이 자기 반으로 고정합니다.
 async function schedule(p={},{fresh=false,maxAge=20000}={}){
  const q={};if(p.cls&&p.cls!=='all')q.cls=String(p.cls);if(p.from)q.from=p.from;if(p.to)q.to=p.to;
  const key=JSON.stringify([q.cls||'all',q.from||'',q.to||'']),hit=schedules.get(key);
  if(hit&&!fresh){
   if(Date.now()-hit.at<maxAge)return hit.data;
   const r=await rev();if(r.rev===hit.data.rev){hit.at=Date.now();return hit.data;}
  }
  const data=await call('b2Schedule',q);schedules.set(key,{at:Date.now(),data});return data;
 }
 // 시간표 고치기(관리자만, b2ScheduleSave {rows:[{cls,date,subject?,hours?,instructor?,was:{subject,instructor,hours?}}]}, 1~200줄, 하나라도 틀리면 아무것도 쓰지 않음).
 // 쓰고 나면 들고 있던 시간표를 버려 다음 읽기가 시트에서 새로 읽게 합니다.
 async function scheduleSave(rows){
  const list=[...rows];let count=0,rev=0;const changed=[];
  try{for(let i=0;i<list.length;i+=200){const r=await call('b2ScheduleSave',{rows:list.slice(i,i+200)});count+=r?.count||0;changed.push(...(r?.changed||[]));rev=r?.rev??rev;}}
  finally{schedules.clear();}
  return {count,changed,rev};
 }
 // 반 임원(마스터시트 '반 임원' 탭 + 반정보 현재 임원, b2Officers {cls?}): 변경 번호(rev)가 같으면 다시 읽지 않습니다. 담임은 Vercel이 자기 반으로 고정합니다.
 // 지정·교체(b2OfficerSave)·끝내기(b2OfficerEnd)는 담임(자기 반)·관리자 모두. 쓰고 나면 들고 있던 목록을 버립니다(실패해도: 그사이 바뀐 경우 새로 읽게).
 async function officers(p={},{fresh=false,maxAge=20000}={}){
  const q=p.cls&&p.cls!=='all'?{cls:String(p.cls)}:{},key=q.cls||'all',hit=officerLists.get(key);
  if(hit&&!fresh){
   if(Date.now()-hit.at<maxAge)return hit.data;
   const r=await rev();if(r.rev===hit.data.rev){hit.at=Date.now();return hit.data;}
  }
  const data=await call('b2Officers',q);officerLists.set(key,{at:Date.now(),data});return data;
 }
 // 반·날짜 공통메모(시트 v17, 2026-10-20): 읽기 b2DayMemos {cls?, from?, to?} → {rev, rows:[{cls,date,memo,by,at,editedBy,editedAt}]}(담임은 Vercel이 자기 반으로 고정),
 // 변경 번호(rev)가 같으면 다시 읽지 않습니다. 쓰기 b2DayMemo {cls,date,memo,was}(관리자만, memo ''면 지움, was가 지금 값과 다르면 '그사이 바뀌었습니다' 거절)
 // → {row,memo,by,at,rev} · 같은 값이면 {unchanged:true}. 쓰고 나면(실패해도) 들고 있던 목록을 버립니다.
 async function dayMemos(p={},{fresh=false,maxAge=20000}={}){
  const q={};if(p.cls&&p.cls!=='all')q.cls=String(p.cls);if(p.from)q.from=p.from;if(p.to)q.to=p.to;
  const key=JSON.stringify([q.cls||'all',q.from||'',q.to||'']),hit=dayMemoLists.get(key);
  if(hit&&!fresh){
   if(Date.now()-hit.at<maxAge)return hit.data;
   const r=await rev();if(r.rev===hit.data.rev){hit.at=Date.now();return hit.data;}
  }
  const data=await call('b2DayMemos',q);dayMemoLists.set(key,{at:Date.now(),data});return data;
 }
 async function dayMemoSave(p){try{return await call('b2DayMemo',p);}finally{dayMemoLists.clear();}}
 // 명단 반영(관리자만, b2RebuildBoards {cls?} → {boards:[{cls,students,rows,grown}],rev}, 시트 v16): 명부에 맞춰 반 탭 출결판을 다시 그립니다. 성공하면 묶음을 버려 새로 읽게 합니다.
 async function rebuildBoards(cls){const r=await call('b2RebuildBoards',cls&&cls!=='all'?{cls:String(cls)}:{});bundles.clear();return r;}
 const officerWrite=async(action,p)=>{try{return await call(action,p);}finally{officerLists.clear();}};
 // 저장 결과를 들고 있는 묶음에 반영합니다(다시 읽지 않음).
 function patch(row,res){
  for(const {bundle:b} of bundles.values()){
   const at=b.ledger.findIndex(r=>ledgerKey(r.cls,r.name,r.date)===ledgerKey(row.cls,row.name,row.date));
   const prev=at>=0?b.ledger[at]:{};
   // 대기열로 반영된 저장(res.queued)은 시트가 메모·증빙 적용·확인 칸을 돌려주지 않아 들고 있던 값(증빙은 고른 값)을 둡니다. 다음 묶음 읽기(변경 번호)가 시트 값으로 바꿉니다.
   const next={...prev,...row,memo:res.memo??(res.queued?prev.memo??'':''),evApplied:res.evApplied??(res.queued?row.ev||prev.evApplied||'':''),check:res.check??(res.queued?prev.check??'':''),prov:'베타 수정',flag:'',sig:res.sig||''};delete next.pending;
   if(at>=0)b.ledger[at]=next;else b.ledger.push(next);
   if(res.rev)b.rev=res.rev;
  }
 }
 // 쓰기 대기열(2026-10-21): 서버가 {queued:true,id}로 답하면(Firestore 대기열에 들어감) 시트에 반영될 때까지 queueStatus로 기다렸다가
 // 예전 b2Save 결과 모양({rev,sig} · {unchanged})으로 돌려줍니다. 기다리는 동안 onQueued(id)로 화면이 '반영 대기'를 보입니다.
 // 실패는 오류로(그사이 바뀜은 code CONFLICT), 55초 넘게 반영되지 않으면 code QUEUE_PENDING(대기열에는 남아 있어 곧 반영될 수 있음).
 let queueOn=false;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function settle(id,{timeout=55000}={}){
  const t0=Date.now();let wait=500;
  for(;;){
   await sleep(wait);wait=Math.min(1500,wait+250);
   let it=null;try{it=(await call('queueStatus',{ids:[id]}))?.items?.find(x=>x.id===id)||null;}catch{}
   if(it?.status==='done')return it.action==='none'?{unchanged:true,rev:it.rev,queued:true}:{ok:true,rev:it.rev,sig:it.sig||'',warn:it.warn||'',queued:true};
   if(it?.status==='failed'){const text=String(it.error||'시트에 반영하지 못했습니다');throw Object.assign(Error(text.replace(/^CONFLICT:\s*/,'')),{code:text.startsWith('CONFLICT')?'CONFLICT':'QUEUE_FAILED'});}
   if(Date.now()-t0>timeout)throw Object.assign(Error('시트 반영을 기다리는 중입니다 · 잠시 뒤 새로 읽어 결과를 확인해 주세요'),{code:'QUEUE_PENDING'});
  }
 }
 async function save(row,{onQueued}={}){
  let res=await call('b2Save',row);
  if(res?.queued){queueOn=true;try{onQueued?.(res.id);}catch{}res=await settle(res.id);}
  if(res.unchanged)return res;
  patch({cls:String(row.cls),name:row.name,date:row.date,type:row.type,inT:row.inT||'',outT:row.outT||'',oa:row.oa||'',ob:row.ob||'',reason:row.reason||'',ev:row.ev||'',evr:row.evr||''},res);
  return res;
 }
 // 체크히어 질병 메모 날짜: 포털 출결 통계 저장본(반마다 1번 읽기, 세션 동안 재사용)
 async function checkhereDisease(classIds){
  if(!db)return {};
  const out={};
  await Promise.all(classIds.map(async cid=>{try{const s=await readAttendanceSummary(db,String(cid),{user});out[cid]=Object.fromEntries((s?.students||[]).map(x=>[x.name,x.diseaseDates||[]]));}catch{out[cid]=null;}}));
  return out;
 }
 // 화면이 보일 때만 변경 번호를 확인합니다. 바뀌면 onChange(rev).
 function watch(onChange,{interval=30000,current=()=>0}={}){
  let timer=null,stopped=false,busy=false;
  const tick=async()=>{if(stopped||busy||document.hidden)return;busy=true;try{const r=await rev();if(!stopped&&r.rev!==current())onChange(r);}catch{}finally{busy=false;}};
  const visible=()=>{if(!document.hidden)void tick();};
  timer=setInterval(tick,interval);document.addEventListener('visibilitychange',visible);
  return ()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 }
 return {
  call,rev,bundle,save,watch,checkhereDisease,queueOn:()=>queueOn,schedule,scheduleSave,officers,rebuildBoards,dayMemos,dayMemoSave,
  officerSave:p=>officerWrite('b2OfficerSave',p),
  officerEnd:p=>officerWrite('b2OfficerEnd',p),
  status:()=>call('b2Status'),
  docs:p=>call('b2Docs',p||{}),
  docCreate:p=>call('b2DocCreate',p),
  docUpdate:p=>call('b2DocUpdate',p),
  vocs:p=>call('b2Vocs',p||{}),
  vocCreate:p=>call('b2VocCreate',p),
  vocReply:p=>call('b2VocReply',p),
  vocSeen:p=>call('b2VocSeen',p),
  roster:cls=>call('portalRoster',Number(cls),''),
  // 중도탈락·수료(마스터시트 '중도탈락' 탭·명부, 2026-10-20): 담임은 Vercel이 자기 반으로 바꿉니다. 여러 명 상태는 관리자만.
  dropouts:p=>call('b2Dropouts',p||{}),
  dropoutSave:p=>call('b2DropoutSave',p),
  completions:p=>call('b2Completions',p||{}),
  rosterStatusMany:rows=>call('b2RosterStatusMany',{rows})
 };
}
