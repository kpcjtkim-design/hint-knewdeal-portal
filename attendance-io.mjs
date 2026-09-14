// Deadlines apply to reads. A timed-out write must be reconciled by its request ID.
export function within(promise,ms=15000,message='서버 응답이 지연됩니다. 잠시 후 다시 확인해 주세요.',signal){
  let timer,fail;
  return new Promise((resolve,reject)=>{
    fail=()=>reject(signal?.reason||new DOMException('확인을 중단했습니다.','AbortError'));
    timer=setTimeout(()=>reject(Object.assign(new Error(message),{code:'READ_TIMEOUT'})),ms);
    Promise.resolve(promise).then(resolve,reject);
    if(signal?.aborted){clearTimeout(timer);fail();return;}
    signal?.addEventListener('abort',fail,{once:true});
  }).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',fail);});
}
export async function readJson(url,body,{signal,timeout=55000}={}){
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:controller.signal});
    const text=await r.text();let d;
    try{d=JSON.parse(text);}catch{throw Error('연결 서버가 데이터 대신 오류 화면을 반환했습니다. 잠시 후 다시 읽어 주세요.');}
    if(!d||typeof d!=='object')throw Error('조회 응답이 비어 있습니다. 다시 읽어 주세요.');
    if(!r.ok||d.ok===false)throw Error(d.message||readerMessage(d.error)||`조회 실패 (${r.status})`);
    return d;
  }catch(e){if(controller.signal.aborted){if(signal?.aborted)throw signal.reason||new DOMException('확인을 중단했습니다.','AbortError');throw Error('시트 연결이 오래 걸려 이번 조회를 중단했습니다. 잠시 후 다시 읽어 주세요.');}throw e;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function readerMessage(code){
  if(/READER_BAD_RESPONSE|READER_ERROR|READER_UNAVAILABLE|COLOR_READER/.test(code||''))return 'Google 시트 연결이 일시적으로 불안정합니다. 잠시 후 다시 읽어 주세요.';
  if(/TIMEOUT/.test(code||''))return '시트 연결이 오래 걸려 이번 조회를 중단했습니다. 잠시 후 다시 읽어 주세요.';
  return code;
}
