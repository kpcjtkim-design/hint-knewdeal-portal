// 2기 베타 마스터시트 읽기·쓰기. 브라우저 → /api/teacher-beta(로그인 확인) → Apps Script → 마스터시트.
// 변경 번호(rev)가 같으면 다시 읽지 않고, 저장한 행은 받은 값으로 바로 고쳐 Vercel·Apps Script 호출을 줄입니다.
import {decodeBundle,ledgerKey} from './beta2-core.mjs';
import {readAttendanceSummary} from './attendance-derived-store.mjs';

const bundles=new Map();
export function forgetBeta2Cache(){bundles.clear();}
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
  if(!j.ok){const text=String(j.error||'마스터시트 요청을 처리하지 못했습니다.');throw Object.assign(Error(text.replace(/^CONFLICT:\s*/,'')),{code:j.code||(text.startsWith('CONFLICT')?'CONFLICT':'')});}
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
 // 저장 결과를 들고 있는 묶음에 반영합니다(다시 읽지 않음).
 function patch(row,res){
  for(const {bundle:b} of bundles.values()){
   const at=b.ledger.findIndex(r=>ledgerKey(r.cls,r.name,r.date)===ledgerKey(row.cls,row.name,row.date));
   const next={...(at>=0?b.ledger[at]:{}),...row,memo:res.memo??'',evApplied:res.evApplied??'',check:res.check??'',prov:'베타 수정',flag:'',sig:res.sig||''};
   if(at>=0)b.ledger[at]=next;else b.ledger.push(next);
   if(res.rev)b.rev=res.rev;
  }
 }
 async function save(row){
  const res=await call('b2Save',row);
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
  call,rev,bundle,save,watch,checkhereDisease,
  release:p=>call('b2Release',p).finally(forgetBeta2Cache),
  syncNow:p=>call('b2SyncNow',p||{}).finally(forgetBeta2Cache),
  status:()=>call('b2Status'),
  docs:p=>call('b2Docs',p||{}),
  docCreate:p=>call('b2DocCreate',p),
  docUpdate:p=>call('b2DocUpdate',p),
  vocs:p=>call('b2Vocs',p||{}),
  vocCreate:p=>call('b2VocCreate',p),
  vocReply:p=>call('b2VocReply',p),
  vocSeen:p=>call('b2VocSeen',p),
  roster:cls=>call('portalRoster',Number(cls),'')
 };
}
