import {scoreColumns} from './survey-scores.mjs';
import {responseColumns,sheetIdFromUrl} from './survey-core.mjs';
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
// Read only. The token exists only in this module's memory, never Firestore/storage.
export function createSurveyReader(authorize){
 let token='',rawLastRequest=0;const cache=new Map();
 async function get(url,signal){let last;for(let n=0;n<3;n++){try{signal?.throwIfAborted();const timeout=AbortSignal.timeout(40000),r=await fetch(url,{headers:{authorization:'Bearer '+token},signal:signal?AbortSignal.any([signal,timeout]):timeout,cache:'no-store'});const data=await r.json();if(r.status===401){token='';throw Error('Google 연결이 만료됐습니다. 응답 시트 연결을 다시 눌러 주세요.');}if(!r.ok){const e=Error(data.error?.message||'응답 시트를 읽지 못했습니다.');e.retry=[429,500,502,503,504].includes(r.status);throw e;}return data;}catch(e){last=e;signal?.throwIfAborted();if(!e.retry&&e.name!=='TimeoutError')throw e;if(n<2)await new Promise(r=>setTimeout(r,(n+1)*2000));}}throw last;}
 async function responses(url){if(!token)throw Error('담당 계정으로 응답 시트를 연결해 주세요.');const id=sheetIdFromUrl(url),u=new URL(url),gid=u.searchParams.get('gid')??new URLSearchParams(u.hash.slice(1)).get('gid'),cacheKey=id+':'+(gid??'auto'),old=cache.get(cacheKey);if(old&&Date.now()-old.at<120000)return old.value;
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id),meta=await get(base+'?fields=sheets.properties'),sheets=(meta.sheets||[]).filter(s=>!s.properties.hidden);
  const candidates=gid!==null?sheets.filter(s=>String(s.properties.sheetId)===gid):sheets.filter(s=>/설문.*응답|form responses/i.test(s.properties.title));const chosen=candidates.length===1?candidates[0]:gid===null&&sheets.length===1?sheets[0]:null;
  if(!chosen)throw Error('응답 탭을 하나로 확인하지 못했습니다. 탭 gid가 포함된 응답 시트 주소를 연결해 주세요.');
  const p=chosen.properties,title=quote(p.title),columns=Math.min(p.gridProperties.columnCount,100),head=await get(base+'/values/'+encodeURIComponent(title+'!A1:'+col(columns-1)+'1')),mapping=responseColumns(head.values?.[0]||[]),scoring=scoreColumns(head.values?.[0]||[]),rows=p.gridProperties.rowCount;
  if(rows>20000)throw Error('응답 시트가 2만 행을 초과했습니다. 전용 범위 설정이 필요합니다.');
  const out=[];for(let start=2;start<=rows;start+=1000){const end=Math.min(rows,start+999),q=new URLSearchParams({majorDimension:'COLUMNS'});for(const index of [...Object.values(mapping),...scoring.map(q=>q.index)])q.append('ranges',`${title}!${col(index)}${start}:${col(index)}${end}`);const d=await get(base+'/values:batchGet?'+q),ranges=d.valueRanges||[];if(ranges.length!==3+scoring.length)throw Error('응답 열을 전부 읽지 못했습니다.');const values=ranges.map(r=>r.values?.[0]||[]),length=Math.max(...values.map(v=>v.length));for(let i=0;i<length;i++){const [name,classId,timestamp]=values.slice(0,3).map(v=>String(v[i]||''));if(name||classId||timestamp)out.push({name,classId,timestamp,scores:scoring.map((q,j)=>({...q,value:String(values[j+3][i]??'')}))});}}
  cache.set(cacheKey,{at:Date.now(),value:out});return out;
 }
 // Export reads all original columns afresh, separately from cached statistics.
 // Raw answers and Google tokens are never persisted by this reader.
 async function raw(url,{signal}={}){
  if(!token)throw Error('내 계정 응답 시트 연결을 먼저 눌러 주세요.');
  const rawGet=async url=>{signal?.throwIfAborted();const delay=Math.max(0,1100-(Date.now()-rawLastRequest));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));signal?.throwIfAborted();rawLastRequest=Date.now();return get(url,signal);};
  const id=sheetIdFromUrl(url),u=new URL(url),gid=u.searchParams.get('gid')??new URLSearchParams(u.hash.slice(1)).get('gid');
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id),meta=await rawGet(base+'?fields=sheets.properties'),sheets=(meta.sheets||[]).filter(s=>!s.properties.hidden);
  const candidates=gid!==null?sheets.filter(s=>String(s.properties.sheetId)===gid):sheets.filter(s=>/설문.*응답|form responses/i.test(s.properties.title));
  const chosen=candidates.length===1?candidates[0]:gid===null&&sheets.length===1?sheets[0]:null;
  if(!chosen)throw Error('응답 탭을 하나로 확인하지 못했습니다. 연결 주소의 gid를 확인해 주세요.');
  const p=chosen.properties,columns=p.gridProperties?.columnCount,rows=p.gridProperties?.rowCount;
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||columns>300||rows>20000)throw Error('응답 시트 크기를 확인해야 합니다. 일부 열이나 행을 잘라서 내려받지 않습니다.');
  const title=quote(p.title),params='?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  let headers=[];const out=[];
  for(let start=1;start<=rows;start+=500){
   const data=await rawGet(base+'/values/'+encodeURIComponent(`${title}!A${start}:${col(columns-1)}${Math.min(rows,start+499)}`)+params);
   if(!Array.isArray(data.values)&&data.values!==undefined)throw Error('응답 원본 형식이 올바르지 않습니다.');
   (data.values||[]).forEach((values,i)=>{if(start===1&&i===0){headers=values;return;}if(values.some(v=>v!==''&&v!==null))out.push({rowNumber:start+i,values});});
  }
  return {spreadsheetId:id,gid:p.sheetId,title:p.title,headers,rows:out,fetchedAt:new Date().toISOString()};
 }
 return {connected:()=>!!token,async connect(){token=await authorize();cache.clear();},responses,raw,clear(){cache.clear();token='';}};
}
