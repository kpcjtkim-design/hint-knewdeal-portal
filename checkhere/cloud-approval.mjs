import {APPROVER,proposalFromApproval,matchRequest,prepareApproval,requestMatchesRecord} from './approval-core.mjs';
import {hasBirthYearName} from '../checkhere-name-core.mjs';
import {mergeCurrentRecords,containsSavedRecords} from '../checkhere-current-core.mjs';
import {FIREBASE_KEY,PROJECT} from './firebase-public.mjs';
function decode(v){if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('timestampValue'in v)return v.timestampValue;if('nullValue'in v)return null;if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);if(v.mapValue)return unpack(v.mapValue.fields||{});return null;}
const unpack=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));
function encode(v){if(v===null||v===undefined)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};return{mapValue:{fields:pack(v)}};}
const pack=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,encode(v)]));
export function createApprovalCloud({fetchImpl=fetch}={}){
  const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/checkhereRequests`;
  const documents=base.slice(0,base.lastIndexOf('/')),documentName=`projects/${PROJECT}/databases/(default)/documents`;
  async function call(url,token,options={}){
    const r=await fetchImpl(url,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Object.assign(Error(r.status===409||r.status===412?'다른 작업이 먼저 처리했습니다. 요청 상태를 다시 확인해 주세요.':r.status===401||r.status===403?'로그인 또는 수정 요청 저장 권한을 확인해 주세요.':'서버의 수정 요청을 확인하지 못했습니다.'),{status:r.status});
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
  const identityCache=new Map();
  async function identitiesFor(data,token){
    if(!hasBirthYearName(data.name))return [];
    const key=String(data.classId);if(!/^(?:[1-9]|1[0-7])$/.test(key))throw Error('반을 확인해 주세요.');
    const old=identityCache.get(key);if(old&&Date.now()-old.at<300000)return old.value;
    const raw=await call(`${documents}/classes/${key}`,token),value=unpack(raw.fields||{}).surveyDuplicateIdentities||[];
    identityCache.set(key,{at:Date.now(),value});return value;
  }
  async function get(id,token){
    if(typeof id!=='string'||!/^[-\w]{16,80}$/.test(id))throw Error('수정 요청 번호를 확인해 주세요.');
    const raw=await call(`${base}/${encodeURIComponent(id)}`,token);const data=unpack(raw.fields||{});return{id,data,identities:await identitiesFor(data,token),updateTime:raw.updateTime};
  }
  const commit=(token,writes)=>call(documents+':commit',token,{method:'POST',body:JSON.stringify({writes})});
  const requestWrite=(doc,changes,transforms=[])=>({update:{name:`${documentName}/checkhereRequests/${doc.id}`,fields:pack(changes)},updateMask:{fieldPaths:Object.keys(changes)},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'},...transforms],currentDocument:{updateTime:doc.updateTime}});
  const patch=(doc,token,changes,transforms=[])=>commit(token,[requestWrite(doc,changes,transforms)]);
  async function currentWrite(request,job,token,identities=[]){
    const {audit,...raw}=job.current||{},record=JSON.parse(JSON.stringify(raw));record.classId=String(record.classId);
    matchRequest(request,[record],identities);
    if(record.id!==request.approval?.recordId||!record.version||!Number.isFinite(Date.parse(record.collectedAt)))throw Error('플랫폼에 저장할 원본 확인 기록이 없습니다. 수집 PC에서 다시 확인해 주세요.');
    const path=`classes/${record.classId}/checkhereCurrent/${record.date}`;let old;
    try{old=await call(`${documents}/${path}`,token);}catch(e){if(e.status!==404)throw e;}
    let previous=old?unpack(old.fields||{}).records||[]:[];
    if(!old){
      // Preserve the legacy day if this is its first current-document save.
      const legacy=await call(`${documents}/classes/${record.classId}:runQuery`,token,{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'checkhereSnapshots'}],where:{fieldFilter:{field:{fieldPath:'date'},op:'EQUAL',value:{stringValue:record.date}}}}})});
      previous=legacy.flatMap(x=>x.document?unpack(x.document.fields||{}).records||[]:[]);
    }
    const records=mergeCurrentRecords(previous,[record],record.classId,record.date);
    if(!containsSavedRecords(records,[record]))throw Error('DB에 더 최신 기록이 있어 덮어쓰지 않았습니다. 해당 학생을 다시 수집한 후 결과를 확인해 주세요.');
    if(old&&containsSavedRecords(previous,[record]))return null;
    return {update:{name:`${documentName}/${path}`,fields:pack({classId:record.classId,date:record.date,records,jobId:job.id,updatedBy:APPROVER})},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:old?{updateTime:old.updateTime}:{exists:false}};
  }
  return {verify,get,async approved(id,token){await verify(token);const doc=await get(id,token);proposalFromApproval(doc.data);return doc;},
    async approveExisting(doc,token,record){
      if(doc.data.status!=='pending'||!requestMatchesRecord(doc.data,record,doc.identities))throw Error('승인 대기 요청과 체크히어 원본이 일치하지 않습니다.');
      const approval=prepareApproval(doc.data,record,{allowAlreadyApplied:true,identities:doc.identities});
      await patch(doc,token,{status:'approved',approval,approvedBy:APPROVER},[{fieldPath:'approvedAt',setToServerValue:'REQUEST_TIME'}]);
      return get(doc.id,token);
    },
    async claim(doc,token,attemptId){if(doc.data.status!=='approved')throw Error('이미 반영 중이거나 처리된 요청입니다. 결과 확인을 눌러 주세요.');await patch(doc,token,{status:'applying',attemptId});},
    async finish(id,token,attemptId,job){
      const status=['verified','partial','failed','unknown','conflict'].includes(job.status)?job.status:'unknown';
      for(let attempt=0;attempt<3;attempt++){
        const doc=await get(id,token);
        if(doc.data.attemptId===attemptId&&doc.data.status===status&&doc.data.result?.jobId===job.id&&(status!=='verified'||doc.data.result.platformSaved===true))return doc.data.result;
        if(doc.data.status!=='applying'||doc.data.attemptId!==attemptId)throw Error('서버 작업 상태가 달라 결과를 저장하지 못했습니다.');
        const result={message:job.message||'결과를 다시 확인해 주세요.',jobId:job.id,results:job.results||[],finishedAt:job.finishedAt||new Date().toISOString(),alreadyApplied:job.alreadyApplied===true,platformSaved:false};
        const writes=[];
        if(status==='verified'&&(!job.current||!requestMatchesRecord(doc.data,job.current,doc.identities)||(job.results||[]).some(r=>r.automaticTime&&(r.state!=='verified'||!['entry','exit'].includes(r.field)||job.current[r.field]!==r.automaticTime))))throw Error('원본 재확인 결과가 요청 또는 자동 입력 시간과 달라 완료 처리하지 않았습니다.');
        if(job.current?.readState==='complete'&&job.current.source==='live'){
          const snapshot=await currentWrite(doc.data,job,token,doc.identities);if(snapshot)writes.push(snapshot);
          result.platformSaved=true;
          if(status==='verified'){
            result.message=job.alreadyApplied?'이미 반영 · 원본 확인 및 플랫폼 DB 저장 완료':'체크히어 반영·원본 확인·플랫폼 DB 저장 완료';
            const automatic=(job.results||[]).filter(r=>r.state==='verified'&&r.automaticTime).map(r=>`${r.field==='entry'?'입실':'퇴실'} ${r.automaticTime}`).join(' · ');
            if(automatic)result.message+=' · 누락 시간 자동 입력: '+automatic;
          }
        }
        writes.push(requestWrite(doc,{status,result}));
        try{await commit(token,writes);return result;}catch(e){if(![409,412].includes(e.status)||attempt===2)throw e;}
      }
    }
  };
}
