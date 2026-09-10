import {APPROVER,cleanRequest,matchRequest,prepareApproval} from './approval-core.mjs';
import {judge} from './rules.mjs';
const requestKey=r=>{const clean=cleanRequest(r);return JSON.stringify({...clean,changes:Object.fromEntries(Object.entries(clean.changes).sort(([a],[b])=>a.localeCompare(b)))});};

export async function canEditCheckHere(user){
  if(user?.email?.toLowerCase()!==APPROVER)return false;
  const {claims}=await user.getIdTokenResult();
  return claims.email_verified===true&&claims.firebase?.sign_in_provider==='google.com';
}

// Keep the existing immutable approval record and server authorization behind
// the designated administrator's single 'apply' action.
export function createDirectEditor({user,controller,store}){
  return async function applyChange(input,shownRecord,operationId){
    if(!await canEditCheckHere(user))throw Error('지정된 관리자만 체크히어를 수정할 수 있습니다.');
    if(!/^[a-f0-9-]{36}$/i.test(operationId||''))throw Error('변경 식별정보가 없습니다. 검수 화면을 다시 열어 주세요.');
    const clean=cleanRequest(input),c=controller();
    await c.refresh();
    if(!c.state().capabilities?.includes('approved-requests-v1'))throw Error('수집 PC에서 최신 체크히어 시작 프로그램을 실행해 주세요.');
    let request=await store.get(operationId);
    if(request){
      if(requestKey(request)!==requestKey(clean)||request.createdBy!==user.email)throw Error('저장된 변경 내용이 다릅니다. 다시 검토해 주세요.');
      if(request.status==='verified')return {status:'verified',message:'이미 반영하고 저장값을 확인한 변경입니다.'};
      if(request.status==='applying'){
        const result=await c.api('reconcile',{approvalId:operationId,idToken:await user.getIdToken(true)});
        await c.refresh();return {status:result.status,message:result.message||'기존 반영 결과를 확인했습니다.'};
      }
      if(!['pending','approved'].includes(request.status))throw Error('이 변경은 이미 처리되었습니다. 자동으로 다시 반영하지 않습니다. 체크히어를 다시 수집해 확인해 주세요.');
    }
    if(c.state().busy)throw Error('진행 중인 수집 또는 반영이 끝난 뒤 다시 시도해 주세요.');
    if(!request||request.status==='pending'){
      const record=matchRequest(clean,c.state().records);
      if(record.id!==shownRecord.id||record.version!==shownRecord.version)throw Error('검토 중 출결 기록이 변경됐습니다. 다시 열어 변경 전후를 확인해 주세요.');
      if(!judge(record).canApply)throw Error('중복·진행중·교시 불일치 등 확인이 필요하여 수정할 수 없습니다.');
      const approval=prepareApproval(clean,record);
      if(!request)await store.create(operationId,clean);
      await store.approve(operationId,approval);
    }
    try{await c.api('apply',{approvalId:operationId,idToken:await user.getIdToken()});}
    catch(e){throw Error('반영 요청 결과를 확인하지 못했습니다. 같은 창에서 다시 누르면 기존 처리 상태를 확인합니다. '+e.message);}
    await c.refresh();
    const job=c.state().jobs?.find(j=>j.id===operationId);
    if(job&&job.status!=='running')return {status:job.status,message:job.message+(job.cloudError?' '+job.cloudError:'')};
    return {status:'running',message:'체크히어 반영을 시작했습니다. 저장된 시간과 메모를 다시 읽어 결과를 표시합니다.'};
  };
}
