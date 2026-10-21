// 서버 전용 Firestore(REST) 도우미(CommonJS: Vercel이 api/*.js를 require로 바꿔 부름, lib/cohort.cjs와 같은 이유): 2기 Vercel 함수가 서비스 계정으로 Firestore를 읽고 씁니다(브라우저 규칙을 거치지 않음).
// 의존성 없음(node:crypto로 JWT RS256 서명 → Google OAuth 접근 토큰, 만료 1분 전까지 다시 씀).
// 환경변수 FIREBASE_SERVICE_ACCOUNT = Firebase 콘솔 › 프로젝트 설정 › 서비스 계정 › 새 비공개 키 생성으로 받은 JSON 전체(또는 그 JSON을 base64로).
// 키 값은 절대 로그·응답·오류 글에 넣지 않습니다(오류는 'FIRESTORE_403' 같은 코드만).
const {createSign}=require('node:crypto');

const DATASTORE_SCOPE='https://www.googleapis.com/auth/datastore';
const TOKEN_URI='https://oauth2.googleapis.com/token';

// 서비스 계정 JSON 읽기. 모양이 틀리면 null(키 내용은 돌려주지 않음).
function parseServiceAccount(raw){
 const text=String(raw??'').trim();if(!text)return null;
 let sa=null;
 try{sa=JSON.parse(text);}catch{try{sa=JSON.parse(Buffer.from(text,'base64').toString('utf8'));}catch{return null;}}
 if(!sa||typeof sa!=='object'||!sa.client_email||!sa.private_key||!sa.project_id)return null;
 return {client_email:String(sa.client_email),private_key:String(sa.private_key).replace(/\\n/g,'\n'),project_id:String(sa.project_id),token_uri:String(sa.token_uri||TOKEN_URI)};
}
const b64url=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
// JWT(RS256) 만들기: 헤더.클레임.서명
function signJwt(sa,{now=Date.now(),scope=DATASTORE_SCOPE}={}){
 const iat=Math.floor(now/1000),body=`${b64url({alg:'RS256',typ:'JWT'})}.${b64url({iss:sa.client_email,scope,aud:sa.token_uri||TOKEN_URI,iat,exp:iat+3600})}`;
 const sig=createSign('RSA-SHA256').update(body).sign(sa.private_key).toString('base64url');
 return `${body}.${sig}`;
}

// ---------- 값 바꾸기(JS ↔ Firestore REST Value) ----------
function toValue(v){
 if(v===null||v===undefined)return {nullValue:null};
 if(v instanceof Date)return {timestampValue:v.toISOString()};
 if(typeof v==='boolean')return {booleanValue:v};
 if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
 if(typeof v==='string')return {stringValue:v};
 if(Array.isArray(v))return {arrayValue:{values:v.map(toValue)}};
 if(typeof v==='object')return {mapValue:{fields:toFields(v)}};
 return {stringValue:String(v)};
}
const toFields=o=>Object.fromEntries(Object.entries(o||{}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,toValue(v)]));
function fromValue(v){
 if(!v||typeof v!=='object')return null;
 if('stringValue' in v)return v.stringValue;
 if('integerValue' in v)return Number(v.integerValue);
 if('doubleValue' in v)return Number(v.doubleValue);
 if('booleanValue' in v)return v.booleanValue;
 if('timestampValue' in v)return v.timestampValue;
 if('nullValue' in v)return null;
 if('arrayValue' in v)return (v.arrayValue.values||[]).map(fromValue);
 if('mapValue' in v)return fromFields(v.mapValue.fields);
 return null;
}
const fromFields=f=>Object.fromEntries(Object.entries(f||{}).map(([k,v])=>[k,fromValue(v)]));

// fetchImpl·now는 시험에서 바꿉니다.
function createFirestoreAdmin({serviceAccount,project,fetchImpl=(...a)=>fetch(...a),now=()=>Date.now()}){
 const sa=serviceAccount;
 if(!sa)throw Error('FIRESTORE_NOT_CONFIGURED');
 const root=`projects/${project||sa.project_id}/databases/(default)/documents`,api=`https://firestore.googleapis.com/v1/${root}`;
 let cached=null,pendingToken=null;
 async function token(){
  if(cached&&cached.until>now())return cached.value;
  if(pendingToken)return pendingToken;
  pendingToken=(async()=>{
   const r=await fetchImpl(sa.token_uri||TOKEN_URI,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signJwt(sa,{now:now()})}).toString()});
   if(!r.ok)throw Error(`FIRESTORE_TOKEN_${r.status}`);
   const j=await r.json();if(!j.access_token)throw Error('FIRESTORE_TOKEN_EMPTY');
   cached={value:j.access_token,until:now()+Math.max(60,Number(j.expires_in)||3600)*1000-60000};
   return cached.value;
  })();
  try{return await pendingToken;}finally{pendingToken=null;}
 }
 async function request(method,url,body){
  const r=await fetchImpl(url,{method,headers:{authorization:`Bearer ${await token()}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(r.status===401)cached=null; // 다음 요청은 토큰을 새로
  return r;
 }
 const fail=async r=>{let status='';try{status=(await r.json())?.error?.status||'';}catch{}return Object.assign(Error(`FIRESTORE_${r.status}`),{status:r.status,grpc:status});};
 const name=path=>`${root}/${path}`;
 const docOf=d=>d&&{id:d.name.slice(d.name.lastIndexOf('/')+1),name:d.name,path:d.name.slice(root.length+1),data:fromFields(d.fields),updateTime:d.updateTime};
 return {
  root,name,token,
  // 문서 하나(없으면 null)
  async get(path){const r=await request('GET',`${api}/${path}`);if(r.status===404)return null;if(!r.ok)throw await fail(r);return docOf(await r.json());},
  // 여러 문서(없는 것은 빠짐)
  async batchGet(paths){
   if(!paths.length)return [];
   const r=await request('POST',`${api}:batchGet`,{documents:paths.map(name)});if(!r.ok)throw await fail(r);
   return (await r.json()).filter(x=>x.found).map(x=>docOf(x.found));
  },
  // structuredQuery 하나(컬렉션은 최상위)
  async runQuery(structuredQuery){
   const r=await request('POST',`${api}:runQuery`,{structuredQuery});if(!r.ok)throw await fail(r);
   return (await r.json()).filter(x=>x.document).map(x=>docOf(x.document));
  },
  // 쓰기 묶음(최대 500). writes는 REST Write 그대로. 전제조건이 안 맞으면 Error.status 400/409(FAILED_PRECONDITION·ABORTED·ALREADY_EXISTS)
  async commit(writes){
   const out=[];
   for(let i=0;i<writes.length;i+=500){const r=await request('POST',`${api}:commit`,{writes:writes.slice(i,i+500)});if(!r.ok)throw await fail(r);out.push(...((await r.json()).writeResults||[]));}
   return out;
  },
  // 쓰기 모양 도우미
  updateWrite(path,fields,{mask=null,precondition=null,serverTime=[]}={}){
   return {update:{name:name(path),fields:toFields(fields)},...(mask?{updateMask:{fieldPaths:mask}}:{}),...(precondition?{currentDocument:precondition}:{}),...(serverTime.length?{updateTransforms:serverTime.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}:{})};
  }
 };
}
// 전제조건 실패(그사이 다른 쪽이 씀)인지
const preconditionFailed=e=>e?.status===409||(e?.status===400&&e?.grpc==='FAILED_PRECONDITION');
module.exports={DATASTORE_SCOPE,parseServiceAccount,signJwt,toValue,toFields,fromValue,fromFields,createFirestoreAdmin,preconditionFailed};
