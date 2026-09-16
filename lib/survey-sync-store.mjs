import {PROJECT} from '../checkhere/firebase-public.mjs';
const root=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`,nameRoot=`projects/${PROJECT}/databases/(default)/documents`;
export const encodeValue=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(encodeValue)}}:typeof v==='object'?{mapValue:{fields:encodeFields(v)}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}:{stringValue:String(v)};
export const encodeFields=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encodeValue(v)]));
export const decodeValue=v=>'nullValue'in v?null:'mapValue'in v?decodeFields(v.mapValue.fields||{}):'arrayValue'in v?(v.arrayValue.values||[]).map(decodeValue):'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'booleanValue'in v?v.booleanValue:v.stringValue??v.timestampValue??v.referenceValue;
export const decodeFields=f=>Object.fromEntries(Object.entries(f||{}).map(([k,v])=>[k,decodeValue(v)]));
export function createSyncStore(idToken,fetcher=fetch){
 const metrics={reads:0,writes:0};
 async function request(url,body){const r=await fetcher(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+idToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(r.status===404)return null;if(!r.ok)throw Error(r.status===429?'DATABASE_QUOTA_EXCEEDED':r.status===409||d.error?.status==='FAILED_PRECONDITION'?'CONCURRENT_UPDATE':`DATABASE_${r.status}`);return d;}
 const unpack=d=>d?{path:d.name.slice(nameRoot.length+1),data:decodeFields(d.fields),updateTime:d.updateTime}:null;
 async function get(path){metrics.reads++;return unpack(await request(root+'/'+path));}
 async function batch(paths){const out=new Map();for(let i=0;i<paths.length;i+=30){const part=paths.slice(i,i+30);metrics.reads+=part.length;const d=await request(root+':batchGet',{documents:part.map(p=>nameRoot+'/'+p)});for(const row of d||[])if(row.found)out.set(row.found.name.slice(nameRoot.length+1),unpack(row.found));}return out;}
 async function list(path){const out=[];let page='';do{const d=await request(root+'/'+path+'?pageSize=300'+(page?'&pageToken='+encodeURIComponent(page):''));out.push(...(d?.documents||[]).map(unpack));page=d?.nextPageToken||'';}while(page);metrics.reads+=Math.max(1,out.length);return out;}
 async function query(parent,collectionId,field,value){const d=await request(root+(parent?'/'+parent:'')+':runQuery',{structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:encodeValue(value)}}}});const docs=(d||[]).filter(x=>x.document).map(x=>unpack(x.document));metrics.reads+=Math.max(1,docs.length);return docs;}
 async function save(path,data,old){const {updatedAt,...value}=data;if(Buffer.byteLength(JSON.stringify(value))>850000)throw Error('SUMMARY_TOO_LARGE');await request(root+':commit',{writes:[{update:{name:nameRoot+'/'+path,fields:encodeFields(value)},currentDocument:old?.updateTime?{updateTime:old.updateTime}:{exists:false},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]});metrics.writes++;}
 return {get,batch,list,query,save,metrics};
}
