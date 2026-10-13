// 2기 베타(/beta2) 전용 Firestore 모듈. index.html이 /beta2 주소에서만 import map으로 SDK 주소를 이 파일로 돌립니다.
// 읽기는 그대로, 저장은 beta2-guard-core.mjs가 허용한 체크히어 수정 요청 경로만 통과시킵니다.
export * from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js?beta2-sdk';
import {setDoc as sdkSetDoc,updateDoc as sdkUpdateDoc,addDoc as sdkAddDoc,deleteDoc as sdkDeleteDoc,runTransaction as sdkRunTransaction,writeBatch as sdkWriteBatch} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js?beta2-sdk';
import {beta2Writable,beta2Blocked,beta2RequestData} from './beta2-guard-core.mjs';

const check=ref=>{if(!beta2Writable(ref?.path))throw beta2Blocked(ref?.path);};
const attempt=(ref,run)=>{try{check(ref);}catch(e){return Promise.reject(e);}return run();};
export const setDoc=(ref,data,...rest)=>attempt(ref,()=>sdkSetDoc(ref,beta2RequestData(ref.path,data),...rest));
export const updateDoc=(ref,...rest)=>attempt(ref,()=>sdkUpdateDoc(ref,...rest));
export const deleteDoc=ref=>attempt(ref,()=>sdkDeleteDoc(ref));
export const addDoc=(col,data)=>attempt({path:`${col?.path}/new`},()=>sdkAddDoc(col,beta2RequestData(`${col.path}/new`,data)));
function guarded(target){
 const wrap={
  get:ref=>target.get(ref),
  set(ref,data,...rest){check(ref);target.set(ref,beta2RequestData(ref.path,data),...rest);return wrap;},
  update(ref,...rest){check(ref);target.update(ref,...rest);return wrap;},
  delete(ref){check(ref);target.delete(ref);return wrap;}
 };
 return wrap;
}
export const runTransaction=(db,fn,options)=>sdkRunTransaction(db,tx=>fn(guarded(tx)),options);
export function writeBatch(db){const batch=sdkWriteBatch(db),wrap=guarded(batch);delete wrap.get;wrap.commit=()=>batch.commit();return wrap;}
