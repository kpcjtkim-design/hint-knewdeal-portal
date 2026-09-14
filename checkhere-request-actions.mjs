import {doc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {APPROVER} from './checkhere/approval-core.mjs';

// Withdrawal preserves the request and its evidence. Approval and withdrawal
// both transact from pending, so a collector can never claim a withdrawn request.
export function canWithdraw(request,user,approver=false){
  return request?.status==='pending' && (request.createdBy===user.email || (approver&&user.email?.toLowerCase()===APPROVER));
}
export async function withdrawRequest(db,user,id,approver=false){
  const ref=doc(db,'checkhereRequests',id);
  await runTransaction(db,async tx=>{
    const request=(await tx.get(ref)).data();
    if(request?.status!=='pending')throw Error('이미 승인되었거나 처리 상태가 바뀌어 철회할 수 없습니다. 새로고침 후 확인해 주세요.');
    if(!canWithdraw(request,user,approver))throw Error('본인이 등록한 승인 대기 요청만 철회할 수 있습니다.');
    tx.update(ref,{status:'withdrawn',withdrawnBy:user.email,withdrawnAt:serverTimestamp(),updatedAt:serverTimestamp()});
  });
}
