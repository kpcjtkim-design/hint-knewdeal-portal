import {APPROVER,proposalFromApproval} from './approval-core.mjs';
import {FIREBASE_KEY,PROJECT} from './firebase-public.mjs';
function decode(v){if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('timestampValue'in v)return v.timestampValue;if('nullValue'in v)return null;if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);if(v.mapValue)return unpack(v.mapValue.fields||{});return null;}
const unpack=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));
function encode(v){if(v===null||v===undefined)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return{integerValue:String(v)};if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};return{mapValue:{fields:pack(v)}};}
const pack=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,encode(v)]));
export function createApprovalCloud({fetchImpl=fetch}={}){
  const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/checkhereRequests`;
  async function call(url,token,options={}){
    const r=await fetchImpl(url,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error(r.status===409||r.status===412?'다른 작업이 먼저 처리했습니다. 요청 상태를 다시 확인해 주세요.':r.status===401||r.status===403?'로그인 또는 수정 요청 저장 권한을 확인해 주세요.':'서버의 수정 요청을 확인하지 못했습니다.');
    return r.json();
  }
  async function verify(token){
    if(typeof token!=='string'||token.length>10000)throw Error('운영 포털에서 지정된 관리자 계정으로 로그인해 주세요.');
    const r=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('관리자 로그인이 만료되었습니다. 포털에 다시 로그인해 주세요.');
    const user=(await r.json()).users?.[0];let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw Error('로그인을 확인할 수 없습니다.');}
    if(user?.email?.toLowerCase()!==APPROVER||user.emailVerified!==true||claims.aud!==PROJECT||claims.iss!==`https://securetoken.google.com/${PROJECT}`||claims.exp*1000<=Date.now()||claims.firebase?.sign_in_provider!=='google.com')throw Error('체크히어 수정은 지정된 Google 관리자 계정만 승인·반영할 수 있습니다.');
    return APPROVER;
  }
  async function get(id,token){
    if(typeof id!=='string'||!/^[-\w]{16,80}$/.test(id))throw Error('수정 요청 번호를 확인해 주세요.');
    const raw=await call(`${base}/${encodeURIComponent(id)}`,token);return{id,data:unpack(raw.fields||{}),updateTime:raw.updateTime};
  }
  async function patch(doc,token,changes){
    const name=`projects/${PROJECT}/databases/(default)/documents/checkhereRequests/${doc.id}`;
    const data=await call(`${base.substring(0,base.indexOf('/documents/'))}/documents:commit`,token,{method:'POST',body:JSON.stringify({writes:[{update:{name,fields:pack(changes)},updateMask:{fieldPaths:Object.keys(changes)},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:doc.updateTime}}]})});
    return data;
  }
  return {verify,get,async approved(id,token){await verify(token);const doc=await get(id,token);proposalFromApproval(doc.data);return doc;},
    async claim(doc,token,attemptId){if(doc.data.status!=='approved')throw Error('이미 반영 중이거나 처리된 요청입니다. 결과 확인을 눌러 주세요.');await patch(doc,token,{status:'applying',attemptId});},
    async finish(id,token,attemptId,job){
      const doc=await get(id,token);if(doc.data.status!=='applying'||doc.data.attemptId!==attemptId)throw Error('서버 작업 상태가 달라 결과를 저장하지 못했습니다.');
      const status=['verified','partial','failed','unknown','conflict'].includes(job.status)?job.status:'unknown';
      await patch(doc,token,{status,result:{message:job.message||'결과를 다시 확인해 주세요.',jobId:job.id,results:job.results||[],finishedAt:job.finishedAt||new Date().toISOString()}});
    }
  };
}
