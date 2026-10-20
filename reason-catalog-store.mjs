// 사유 목록 설정(사용자 2026-10-20 '사유 드롭다운을 관리자 측에서 설정할 수 있는 그런 화면'): Firestore settings/reasonCatalog
// 문서 모양: {catalog: 사유 목록 JSON(attendance-reason-catalog.mjs DEFAULT_REASON_CATALOG 모양), rev: 저장 번호(1부터), updatedBy: 저장한 관리자 이메일, updatedAt: 서버 시각}
// 읽기: 화면을 열 때 한 번(cachedRead, 5분), 문서가 없으면 기본 목록, 모양이 틀리거나 읽기 실패면 기본 목록 + 작은 경고(warning).
// 쓰기: 관리자만(firestore.rules), rev를 확인하는 트랜잭션(그사이 다른 관리자가 저장했으면 거절).
import {doc,getDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {cachedRead,invalidateRead} from './session-read-cache.mjs';
import {setReasonCatalog,validateReasonCatalog} from './attendance-reason-catalog.mjs';
export const REASON_CATALOG_PATH=['settings','reasonCatalog'];
const KEY='settings:reasonCatalog',ref=db=>doc(db,...REASON_CATALOG_PATH);
const plain=v=>v&&typeof v.toDate==='function'?v.toDate().toISOString():v??null;
const shape=d=>d?{exists:true,catalog:d.catalog??null,rev:Number.isInteger(d.rev)?d.rev:0,updatedBy:String(d.updatedBy||''),updatedAt:plain(d.updatedAt)}:{exists:false,catalog:null,rev:0,updatedBy:'',updatedAt:null};
// 문서 그대로(관리자 화면용, 확인 전) → {exists, catalog, rev, updatedBy, updatedAt}
export async function readReasonCatalogDoc(db,user,{fresh=false}={}){
 return cachedRead(db,user,KEY,async()=>{const s=await getDoc(ref(db));return shape(s.exists()?s.data():null);},{fresh,ttl:300000});
}
const warned=new Set();
// 화면 시작 때: 읽어서 지금 목록으로 씁니다. → {from:'saved'|'default', warning, rev, firstWarning(이번 세션에서 처음 보는 경고면 true)}
export async function loadReasonCatalog(db,user,{fresh=false}={}){
 let r;
 try{
  const d=await readReasonCatalogDoc(db,user,{fresh});
  if(!d.exists||d.catalog==null){setReasonCatalog(null);r={from:'default',warning:'',rev:d.rev};}
  else{const x=setReasonCatalog(d.catalog,{rev:d.rev,updatedBy:d.updatedBy,updatedAt:d.updatedAt});r={from:x.ok?'saved':'default',warning:x.warning,rev:d.rev};}
 }catch(e){const warning='사유 목록 설정을 읽지 못해 기본 목록을 씁니다';setReasonCatalog(null,{warning});r={from:'default',warning,rev:0,error:String(e?.code||e?.message||e)};}
 r.firstWarning=!!r.warning&&!warned.has(r.warning);if(r.warning)warned.add(r.warning);
 return r;
}
// 저장(관리자): baseRev = 편집을 시작할 때 읽은 rev. 그사이 바뀌었으면 code 'conflict'. → 새 rev
export async function saveReasonCatalog(db,user,catalog,{baseRev=0}={}){
 const v=validateReasonCatalog(catalog);
 if(!v.ok)throw Object.assign(new Error(`목록을 저장할 수 없습니다 · ${v.errors[0]}`),{code:'invalid',errors:v.errors});
 const email=String(user?.email||'');
 const rev=await runTransaction(db,async tx=>{
  const s=await tx.get(ref(db)),cur=s.exists()&&Number.isInteger(s.data()?.rev)?s.data().rev:0;
  if(cur!==baseRev)throw Object.assign(new Error('다른 관리자가 그사이 사유 목록을 저장했습니다. 「새로 불러오기」 뒤 다시 고쳐 주세요.'),{code:'conflict',rev:cur});
  const next=cur+1;tx.set(ref(db),{catalog:v.data,rev:next,updatedBy:email,updatedAt:serverTimestamp()});return next;
 });
 invalidateRead(db,user,KEY);
 setReasonCatalog(v.data,{rev,updatedBy:email,updatedAt:new Date().toISOString()});
 return rev;
}
