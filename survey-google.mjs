import {phoneLast4} from './survey-identity.mjs';
import {scoreColumns} from './survey-scores.mjs';
import {responseColumns,sheetIdFromUrl} from './survey-core.mjs';
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
export function surveyDelay(ms,signal){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason||new DOMException('Aborted','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});
}
// One in-memory queue per page, shared by RAW downloads and all survey readers.
// No Firestore polling or writes are needed to enforce the request spacing.
export function createSurveyRequestGate({intervalMs=2500,now=Date.now,sleep=surveyDelay}={}){
 let queue=Promise.resolve(),nextAt=0,cooldownAt=0;
 return {
  defer(ms){cooldownAt=Math.max(cooldownAt,now()+ms);},
  run(task,{signal,onWait=()=>{}}={}){
   const pending=queue.then(async()=>{signal?.throwIfAborted();let notified=false;
    while(Math.max(nextAt,cooldownAt)>now()){
     const delay=Math.max(nextAt,cooldownAt)-now();if(cooldownAt>now()){notified=true;onWait({kind:'quota',seconds:Math.ceil(delay/1000)});}
     await sleep(delay,signal);signal?.throwIfAborted();
    }
    if(notified)onWait({kind:'resume'});nextAt=now()+intervalMs;return task();
   });queue=pending.catch(()=>{});return pending;
  }
 };
}
// The scheduled server worker keeps its bounded request runtime. Its Google
// project differs from the interactive portal connection addressed here.
const browserRequestGate=typeof window!=='undefined'?createSurveyRequestGate():null;
// Read only. The token exists only in this module's memory, never Firestore/storage.
export function createSurveyReader(authorize,{requestGate=browserRequestGate,onWait=()=>{}}={}){
 let token='',rawLastRequest=0,lifetime=new AbortController(),responseRunDepth=0,sessionEpoch=0;const cache=new Map(),pendingResponses=new Map();
 async function get(url,signal){
  signal=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
  let last;const attempts=requestGate?4:3;
  for(let n=0;n<attempts;n++){
   try{
    const read=async()=>{signal.throwIfAborted();const timeout=AbortSignal.timeout(40000),r=await fetch(url,{headers:{authorization:'Bearer '+token},signal:AbortSignal.any([signal,timeout]),cache:'no-store'}),data=await r.json();
     if(r.status===401){token='';throw Error('Google 연결이 만료됐습니다. 응답 시트 연결을 다시 눌러 주세요.');}
     if(!r.ok){
      const e=Error(data.error?.message||'응답 시트를 읽지 못했습니다.'),reasons=[...(data.error?.errors||[]),...(data.error?.details||[])].map(x=>x.reason);
      e.quota=r.status===429||(r.status===403&&(reasons.some(x=>/^(?:userRateLimitExceeded|rateLimitExceeded|RATE_LIMIT_EXCEEDED)$/.test(x))||/Read requests per minute/i.test(e.message)));
      e.retry=e.quota||[500,502,503,504].includes(r.status);
      if(e.quota&&requestGate){const header=r.headers?.get('retry-after'),retryAfter=header?(Number.isFinite(Number(header))?Number(header)*1000:Math.max(0,Date.parse(header)-Date.now())):0;requestGate.defer(Math.max(Math.min(65000*2**n,120000),retryAfter||0));}
      throw e;
     }return data;
    };
    return await(requestGate?requestGate.run(read,{signal,onWait}):read());
   }catch(e){last=e;signal.throwIfAborted();if(!e.retry&&e.name!=='TimeoutError')throw e;if(n<attempts-1&&!(e.quota&&requestGate))await surveyDelay((n+1)*2000,signal);}
  }
  if(last?.quota&&requestGate)throw Error('Google 시트 읽기 한도가 계속 초과되고 있습니다. 같은 계정의 다른 수집 작업이 끝난 뒤 다시 시도해 주세요. 기존 저장 결과는 유지됩니다.');
  throw last;
 }
 async function responses(url){if(!token)throw Error('담당 계정으로 응답 시트를 연결해 주세요.');const id=sheetIdFromUrl(url),u=new URL(url),gid=u.searchParams.get('gid')??new URLSearchParams(u.hash.slice(1)).get('gid'),cacheKey=id+':'+(gid??'auto'),old=cache.get(cacheKey);if(old&&(responseRunDepth>0||Date.now()-old.at<120000))return old.value;
  if(pendingResponses.has(cacheKey))return pendingResponses.get(cacheKey);
  const epoch=sessionEpoch,task=loadResponses(id,gid).then(value=>{if(epoch===sessionEpoch)cache.set(cacheKey,{at:Date.now(),value});return value;});
  pendingResponses.set(cacheKey,task);try{return await task;}finally{if(pendingResponses.get(cacheKey)===task)pendingResponses.delete(cacheKey);}
 }
 async function loadResponses(id,gid){
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id),meta=await get(base+'?fields=sheets.properties'),sheets=(meta.sheets||[]).filter(s=>!s.properties.hidden);
  const candidates=gid!==null?sheets.filter(s=>String(s.properties.sheetId)===gid):sheets.filter(s=>/설문.*응답|form responses/i.test(s.properties.title));const chosen=candidates.length===1?candidates[0]:gid===null&&sheets.length===1?sheets[0]:null;
  if(!chosen)throw Error('응답 탭을 하나로 확인하지 못했습니다. 탭 gid가 포함된 응답 시트 주소를 연결해 주세요.');
  const p=chosen.properties,title=quote(p.title),columns=Math.min(p.gridProperties.columnCount,100),head=await get(base+'/values/'+encodeURIComponent(title+'!A1:'+col(columns-1)+'1')),mapping=responseColumns(head.values?.[0]||[]),scoring=scoreColumns(head.values?.[0]||[]),rows=p.gridProperties.rowCount;
  if(!Number.isInteger(rows)||rows<1||rows>20000)throw Error('응답 시트가 2만 행을 초과했거나 크기를 확인할 수 없습니다. 전용 범위 설정이 필요합니다.');
  // Sheets omits trailing empty values; one bounded read preserves gaps without
  // sending one request for every allocated, but unused, thousand rows.
  const out=[];if(rows>1){const q=new URLSearchParams({majorDimension:'COLUMNS'});for(const index of [...Object.values(mapping),...scoring.map(q=>q.index)])q.append('ranges',`${title}!${col(index)}2:${col(index)}${rows}`);const d=await get(base+'/values:batchGet?'+q),ranges=d.valueRanges||[];if(ranges.length!==Object.keys(mapping).length+scoring.length)throw Error('응답 열을 전부 읽지 못했습니다.');const values=ranges.map(r=>r.values?.[0]||[]),length=Math.max(...values.map(v=>v.length));for(let i=0;i<length;i++){const [name,classId,timestamp]=values.slice(0,3).map(v=>String(v[i]||'')),offset=Object.keys(mapping).length;if(name||classId||timestamp)out.push({name,classId,timestamp,...(mapping.phone!==undefined?{phoneLast4:phoneLast4(values[3][i])|| (String(values[3][i]??'').trim()?'invalid':'')}:{}),scores:scoring.map((q,j)=>({...q,value:String(values[j+offset][i]??'')}))});}}
  return out;
 }
 // Export reads all original columns afresh, separately from cached statistics.
 // Raw answers and Google tokens are never persisted by this reader.
 async function raw(url,{signal}={}){
  if(!token)throw Error('내 계정 응답 시트 연결을 먼저 눌러 주세요.');
  const rawGet=async url=>{signal?.throwIfAborted();if(!requestGate){const delay=Math.max(0,1100-(Date.now()-rawLastRequest));if(delay)await surveyDelay(delay,signal);}signal?.throwIfAborted();rawLastRequest=Date.now();return get(url,signal);};
  const id=sheetIdFromUrl(url),u=new URL(url),gid=u.searchParams.get('gid')??new URLSearchParams(u.hash.slice(1)).get('gid');
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id),meta=await rawGet(base+'?fields=sheets.properties'),sheets=(meta.sheets||[]).filter(s=>!s.properties.hidden);
  const candidates=gid!==null?sheets.filter(s=>String(s.properties.sheetId)===gid):sheets.filter(s=>/설문.*응답|form responses/i.test(s.properties.title));
  const chosen=candidates.length===1?candidates[0]:gid===null&&sheets.length===1?sheets[0]:null;
  if(!chosen)throw Error('응답 탭을 하나로 확인하지 못했습니다. 연결 주소의 gid를 확인해 주세요.');
  const p=chosen.properties,columns=p.gridProperties?.columnCount,rows=p.gridProperties?.rowCount;
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||columns>300||rows>20000)throw Error('응답 시트 크기를 확인해야 합니다. 일부 열이나 행을 잘라서 내려받지 않습니다.');
  const title=quote(p.title),params='?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  let headers=[];const out=[];
  const data=await rawGet(base+'/values/'+encodeURIComponent(`${title}!A1:${col(columns-1)}${rows}`)+params);
  if(!Array.isArray(data.values)&&data.values!==undefined)throw Error('응답 원본 형식이 올바르지 않습니다.');
  (data.values||[]).forEach((values,i)=>{if(i===0){headers=values;return;}if(values.some(v=>v!==''&&v!==null))out.push({rowNumber:i+1,values});});
  return {spreadsheetId:id,gid:p.sheetId,title:p.title,headers,rows:out,fetchedAt:new Date().toISOString()};
 }
 function beginResponseRun(){if(responseRunDepth===0)cache.clear();responseRunDepth++;let ended=false;return()=>{if(ended)return;ended=true;responseRunDepth=Math.max(0,responseRunDepth-1);if(responseRunDepth===0)cache.clear();};}
 return {connected:()=>!!token,async connect(){token=await authorize();sessionEpoch++;cache.clear();pendingResponses.clear();if(lifetime.signal.aborted)lifetime=new AbortController();},responses,raw,beginResponseRun,clear(){sessionEpoch++;lifetime.abort();cache.clear();pendingResponses.clear();responseRunDepth=0;token='';}};
}
