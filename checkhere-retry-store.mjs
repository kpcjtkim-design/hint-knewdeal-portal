import {collection,doc,getDocs,query,where,documentId,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {APPROVER,cleanRequest,sameRequestTarget} from './checkhere/approval-core.mjs';
import {isRetryableRequest,retryRequestId,retryHeads} from './checkhere-retry-core.mjs';
import {within} from './attendance-io.mjs';
import {invalidateRead} from './session-read-cache.mjs';

export async function loadRetryHeads(db,requests){
 const rows=new Map(requests.map(r=>[r.id,r])),checked=new Set();
 for(let depth=0;depth<20;depth++){
  const ids=[];
  for(const r of rows.values())if(isRetryableRequest(r)&&!checked.has(r.id)){checked.add(r.id);const id=await retryRequestId(r);if(!rows.has(id))ids.push(id);}
  if(!ids.length)return retryHeads([...rows.values()]);
  for(let i=0;i<ids.length;i+=30){const result=await within(getDocs(query(collection(db,'checkhereRequests'),where(documentId(),'in',ids.slice(i,i+30)))),20000);for(const d of result.docs)rows.set(d.id,{id:d.id,...d.data()});}
 }
 throw Error('재처리 이력이 길어 한 번에 확인하지 못했습니다. 요청 목록을 다시 읽어 주세요.');
}

export async function ensureRetryRequest(db,user,parent){
 const identity=await user.getIdTokenResult();
 if(user.email?.toLowerCase()!==APPROVER||identity.claims.email_verified!==true||identity.claims.firebase?.sign_in_provider!=='google.com')throw Error('지정된 Google 관리자만 실패 건을 다시 처리할 수 있습니다.');
 const expectedId=await retryRequestId(parent);
 return within(runTransaction(db,async tx=>{
  const original=await tx.get(doc(db,'checkhereRequests',parent.id)),fresh=original.data();
  if(!fresh||!isRetryableRequest(fresh)||await retryRequestId({id:parent.id,...fresh})!==expectedId||!sameRequestTarget(fresh,parent))throw Error('원래 요청 상태가 바뀌었습니다. 목록을 다시 확인해 주세요.');
  const ref=doc(db,'checkhereRequests',expectedId),existing=await tx.get(ref),data=existing.data();
  if(data){if(data.createdBy!==user.email||!sameRequestTarget(data,fresh))throw Error('보관된 재처리 요청 내용이 다릅니다. 다시 확인해 주세요.');return {id:expectedId,...data};}
  const next={...cleanRequest(fresh),status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  tx.set(ref,next);return {id:expectedId,...next};
 }),25000,'재처리 요청 저장 결과를 확인하지 못했습니다. 다시 처리 버튼을 누르면 같은 요청을 확인합니다.').finally(()=>invalidateRead(db,user,'operations:requests'));
}

// Only request documents are added here. CheckHere writes remain in the existing
// approved collector path, after live preview and already-applied reconciliation.
export async function resolveRetryRequest(db,user,source,{reconcile,onRequest=()=>{}}){
 let request=source;
 for(let depth=0;depth<20;depth++){
  if(!isRetryableRequest(request))return request;
  const result=await reconcile(request);
  if(result?.status==='verified'&&result.platformSaved===true){request={...request,status:'verified',result};onRequest(request);return request;}
  if(['running','applying'].includes(result?.status))throw Error('기존 반영 작업이 아직 진행 중입니다. 결과 확인 후 다시 처리해 주세요.');
  if(!isRetryableRequest(result))throw Error('기존 요청의 처리 결과를 확인하지 못했습니다. 결과 확인 후 다시 처리해 주세요.');
  request=await ensureRetryRequest(db,user,request);onRequest(request);
 }
 throw Error('재처리 이력이 길어 중단했습니다. 마지막 요청의 처리 상태를 확인해 주세요.');
}
