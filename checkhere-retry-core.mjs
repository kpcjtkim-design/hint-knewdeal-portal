export const RETRYABLE_STATUSES=Object.freeze(['failed','partial','unknown','conflict']);
export const isRetryableRequest=request=>RETRYABLE_STATUSES.includes(request?.status);
const stamp=value=>value&&typeof value==='object'?[value.seconds??value._seconds??'',value.nanoseconds??value._nanoseconds??''].join(':'):String(value||'');
export async function retryRequestId(request){
 if(!isRetryableRequest(request)||typeof request?.id!=='string'||!request.id||request.id.length>1500||request.id.includes('/'))throw Error('다시 처리할 실패 요청을 확인해 주세요.');
 const revision=[request.id,request.status,stamp(request.updatedAt)||stamp(request.createdAt),request.attemptId||'',request.result?.jobId||'',request.result?.finishedAt||''];
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(revision)));
 return 'retry_'+[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
// A failed parent is history once its deterministic child exists. Return only
// terminal leaves; pending/complete children already have their own real status.
export async function retryHeads(rows){
 const byId=new Map(rows.map(r=>[r.id,r])),links=new Map();
 for(const r of rows)if(isRetryableRequest(r)){const id=await retryRequestId(r);if(byId.has(id))links.set(r.id,id);}
 const headOf=request=>{let current=request;const seen=new Set();while(links.has(current.id)){if(seen.has(current.id))throw Error('재처리 연결을 확인하지 못했습니다.');seen.add(current.id);current=byId.get(links.get(current.id));}return current;};
 return {rows:[...byId.values()],links,failures:rows.filter(r=>isRetryableRequest(r)&&!links.has(r.id)),resolved:rows.filter(r=>{const head=headOf(r);return isRetryableRequest(r)&&head.status==='verified'&&head.result?.platformSaved===true;}).map(r=>r.id)};
}
