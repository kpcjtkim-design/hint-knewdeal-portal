const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function fetchJson(url,options={},timeout=6000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    const text=await response.text();let data;
    try{data=JSON.parse(text);}catch{throw Object.assign(Error('READER_BAD_RESPONSE'),{retryable:true,status:response.status,contentType:response.headers.get('content-type')});}
    return {response,data};
  }catch(e){if(controller.signal.aborted)throw Object.assign(Error('READER_TIMEOUT'),{retryable:true});if(e instanceof TypeError)throw Object.assign(Error('READER_UNAVAILABLE'),{retryable:true});throw e;}
  finally{clearTimeout(timer);}
}
export function createBridgeReader({timeout=40000,attempts=1,backoff=600,ttl=30000,log=info=>console.warn('attendance_bridge',JSON.stringify(info))}={}){
  const inflight=new Map(),cache=new Map();
  return async function read(url,classId,{allowCache=false,colorsOnly=false}={}){
    const key=JSON.stringify([url,classId,colorsOnly]);
    const cached=cache.get(key);
    if(allowCache&&cached&&Date.now()-cached.at<ttl)return {...cached.data,readerCached:true};
    // Approval checks always start a new read after the check was requested.
    if(allowCache&&inflight.has(key))return inflight.get(key);
    const task=(async()=>{
      for(let attempt=1;attempt<=attempts;attempt++){
        const started=Date.now();
        try{
          const {response:r,data:d}=await fetchJson(`${url}?classId=${encodeURIComponent(classId)}`,{redirect:'follow'},timeout);
          if(!r.ok)throw Object.assign(Error('READER_UNAVAILABLE'),{status:r.status,retryable:r.status===429||r.status>=500});
          if(!d?.ok)throw Object.assign(Error('READER_ERROR'),{retryable:/timed? ?out|try again|too many|service invoked|internal|일시|시간|초과/i.test(d?.error||'')});
          const valid=colorsOnly?Array.isArray(d.attendanceBackgrounds||d.backgrounds):Array.isArray(d.attendance)&&Array.isArray(d.attendance[0])&&d.attendance[0].length>4&&Array.isArray(d.reasons)&&d.reasons.length>=2;
          if(!valid||(d.classId!=null&&String(d.classId)!==String(classId)))throw Object.assign(Error('READER_INVALID_DATA'),{retryable:false});
          const result={...d,readerReadAt:new Date().toISOString(),readerCached:false};cache.set(key,{at:Date.now(),data:result});return result;
        }catch(e){
          log({classId,attempt,elapsedMs:Date.now()-started,code:e.message,status:e.status,contentType:e.contentType});
          if(!e.retryable||attempt===attempts)throw e;
          await sleep(backoff*attempt);
        }
      }
    })();
    if(allowCache)inflight.set(key,task);
    try{return await task;}finally{if(inflight.get(key)===task)inflight.delete(key);}
  };
}
export const readBridge=createBridgeReader();
export function readerFailure(error){
  const code=String(error.message||error);
  if(code==='LOGIN_REQUIRED')return{status:401,error:code,message:'로그인 상태를 확인해 주세요.'};
  if(['ADMIN_REQUIRED','PROFILE_NOT_FOUND'].includes(code))return{status:403,error:code,message:'관리자 계정 권한을 확인해 주세요.'};
  if(code==='BAD_CLASS')return{status:400,error:code,message:'반 번호를 확인해 주세요.'};
  return{status:code==='READER_TIMEOUT'?504:503,error:code,message:code==='READER_TIMEOUT'?'Google 시트 응답이 늦어 이번 조회를 중단했습니다. 잠시 후 다시 읽어 주세요.':'Google 시트 연결이 일시적으로 불안정합니다. 잠시 후 다시 읽어 주세요.'};
}
