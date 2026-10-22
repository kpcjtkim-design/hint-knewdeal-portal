// 교육비 기준 읽기·저장(allowance-core.mjs): Firestore settings/allowanceRule {rule:{units,convert}, rev, updatedBy, updatedAt}
// 관리자만 읽고 씁니다(firestore.rules settings: 관리자 쓰기). 저장은 rev를 확인하는 트랜잭션(그사이 다른 관리자가 저장했으면 거절).
import {doc,getDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {cachedRead,invalidateRead} from './session-read-cache.mjs';
import {setAllowanceRule,validateAllowanceRule} from './allowance-core.mjs';
const KEY='settings:allowanceRule',ref=db=>doc(db,'settings','allowanceRule');
const plain=v=>v&&typeof v.toDate==='function'?v.toDate().toISOString():v??null;
const shape=d=>d?{exists:true,rule:d.rule??null,rev:Number.isInteger(d.rev)?d.rev:0,updatedBy:String(d.updatedBy||''),updatedAt:plain(d.updatedAt)}:{exists:false,rule:null,rev:0,updatedBy:'',updatedAt:null};
export async function readAllowanceDoc(db,user,{fresh=false}={}){
 return cachedRead(db,user,KEY,async()=>{const s=await getDoc(ref(db));return shape(s.exists()?s.data():null);},{fresh,ttl:300000});
}
// 화면 시작 때 → {from, warning, rev}. 못 읽으면 기본값 + 경고.
export async function loadAllowanceRule(db,user,{fresh=false}={}){
 try{const d=await readAllowanceDoc(db,user,{fresh});const x=setAllowanceRule(d.exists?d.rule:null,d);return {from:d.exists&&x.ok?'saved':'default',warning:x.warning,rev:d.rev};}
 catch(e){setAllowanceRule(null);return {from:'default',warning:'교육비 기준 설정을 읽지 못해 기본값을 씁니다',rev:0,error:String(e?.code||e?.message||e)};}
}
export async function saveAllowanceRule(db,user,rule,{baseRev=0}={}){
 const v=validateAllowanceRule(rule);
 if(!v.ok)throw Object.assign(new Error(v.errors[0]),{code:'invalid'});
 const email=String(user?.email||'');
 const rev=await runTransaction(db,async tx=>{
  const s=await tx.get(ref(db)),cur=s.exists()&&Number.isInteger(s.data()?.rev)?s.data().rev:0;
  if(cur!==baseRev)throw Object.assign(new Error('다른 관리자가 그사이 교육비 기준을 저장했습니다. 「새로 불러오기」 뒤 다시 고쳐 주세요.'),{code:'conflict',rev:cur});
  tx.set(ref(db),{rule:v.data,rev:cur+1,updatedBy:email,updatedAt:serverTimestamp()});return cur+1;
 });
 invalidateRead(db,user,KEY);setAllowanceRule(v.data,{rev,updatedBy:email,updatedAt:new Date().toISOString()});
 return rev;
}
