// 체크히어 출결 수정 요청의 형식 기록(2026-10-16, 4-1).
// 사람이 해제해 둔 연결 프로그램 탭에서 수정창으로 한 건을 직접 고칠 때, 그때 나가는 history/event/update·delete 요청 하나의
// 방식(PUT·DELETE), 주소 틀, 본문 구조(키, 값 종류, typeEvent 같은 열거값)만 적습니다. 순차 요청(event-request.mjs)은 이 기록이 있어야 보냅니다.
// 적지 않는 것: 학생·일정·기록 번호 값, 시간·메모 값, 이름·전화, 헤더(인증·쿠키 포함), 응답 글. 헤더는 읽지도 않습니다.
// 파일은 연결 프로그램 data 폴더 안(format/event-request-format.json)에만 둡니다.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
export const FORMAT_VERSION=1;
export const formatFile=dataDir=>join(dataDir,'format','event-request-format.json');
const WRITE=/^\/api\/v3\/history\/event\/(update|delete)$/;
const ORIGIN='https://checkhere-admin-api.ihereapp.com';
// 값을 남기는 열거 키(체크히어 코드 기준 typeEvent: ATTEND | COMPLETE). 그 밖의 키는 종류만 남깁니다.
const ENUMS=new Set(['typeEvent']);
const typeOf=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
// 글 값의 모양만(값은 남기지 않음): 날짜시간 · 번호(16자 이상 영숫자·-) · 빈 글 · 그 밖의 글
const shapeOf=v=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)?'datetime':v===''?'empty':/^[0-9A-Za-z-]{16,}$/.test(v)?'id':'text';
export function describeBody(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const keys=Object.keys(body).filter(k=>/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(k)).sort(),fields={};
  for(const k of keys){
    const v=body[k],t=typeOf(v);
    fields[k]={types:[t],...(t==='string'?{shapes:[shapeOf(v)]}:{}),...(ENUMS.has(k)&&t==='string'&&/^[A-Z][A-Z_]{1,30}$/.test(v)?{values:[v]}:{})};
  }
  return {keys,fields};
}
// 나가는 요청 하나 → 기록 항목(체크히어 변경·삭제 요청이 아니면 null)
export function describeRequest({method,url,body}){
  let u;try{u=new URL(url);}catch{return null;}
  const m=WRITE.exec(u.pathname);if(u.origin!==ORIGIN||!m)return null;
  const shape=describeBody(body);if(!shape)return null;
  return {op:m[1],method:String(method).toUpperCase(),origin:u.origin,path:u.pathname,...shape};
}
// 같은 종류(update·delete)를 다시 기록하면 키는 새 기록으로, 값 종류·열거값은 합칩니다(빈 칸에 넣기·고치기에서 existEventId가 null·글).
export function mergeFormat(old,entry,{build=null,now=new Date().toISOString(),response=null}={}){
  const base=old?.version===FORMAT_VERSION&&old.kinds&&typeof old.kinds==='object'?old:{version:FORMAT_VERSION,kinds:{}};
  const prev=base.kinds[entry.op],fields={};
  for(const k of entry.keys){
    const a=entry.fields[k],b=prev?.keys?.includes(k)?prev.fields?.[k]:null,u=(x,y)=>[...new Set([...(x||[]),...(y||[])])].sort();
    fields[k]={types:u(a.types,b?.types),...(a.shapes||b?.shapes?{shapes:u(a.shapes,b?.shapes)}:{}),...(a.values||b?.values?{values:u(a.values,b?.values)}:{})};
  }
  return {...base,version:FORMAT_VERSION,savedAt:now,...(build?{build}:{}),kinds:{...base.kinds,[entry.op]:{method:entry.method,origin:entry.origin,path:entry.path,keys:entry.keys,fields,...(response?{response}:{}),recordedAt:now}}};
}
export function loadFormat(dataDir){
  try{const file=formatFile(dataDir);if(!existsSync(file))return null;const f=JSON.parse(readFileSync(file,'utf8'));return f?.version===FORMAT_VERSION&&f.kinds&&typeof f.kinds==='object'?f:null;}catch{return null;}
}
export function saveFormat(dataDir,entry,options={}){
  const file=formatFile(dataDir),next=mergeFormat(loadFormat(dataDir),entry,options);
  mkdirSync(join(dataDir,'format'),{recursive:true});writeFileSync(file,JSON.stringify(next,null,1));return next;
}
// 기록 요약(작업 글·화면용): 종류·방식·주소 틀·키 이름만.
export const formatSummary=f=>Object.fromEntries(Object.entries(f?.kinds||{}).map(([op,k])=>[op,{method:k.method,path:k.path,keys:k.keys}]));
const settle=(promise,ms)=>{let t;return Promise.race([promise,new Promise(r=>{t=setTimeout(()=>r(null),ms);})]).finally(()=>clearTimeout(t));};
const token=v=>v===null||v===undefined?null:typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,30}$/.test(v)?v:typeof v==='number'&&Number.isInteger(v)?String(v):'{text}';
// 기록하기: target(전용 크롬의 browser context 또는 page)에서 나가는 첫 변경·삭제 요청 하나만 봅니다. 응답은 상태 번호와 code(열거값)만.
// done은 {entry, response} 또는 null(멈춤·시간 끝)로 끝납니다. 요청을 바꾸거나 막지 않습니다(보기만).
export function recordFormat({target,timeoutMs=10*60000}){
  let finish,timer,closed=false;const done=new Promise(r=>finish=r);
  const off=()=>{clearTimeout(timer);(target.off||target.removeListener)?.call(target,'request',onRequest);};
  const stop=()=>{if(closed)return;closed=true;off();finish(null);};
  async function onRequest(req){
    if(closed)return;const method=req.method();if(!['PUT','DELETE','POST','PATCH'].includes(method))return;
    let body=null;try{body=JSON.parse(req.postData()||'null');}catch{}
    const entry=describeRequest({method,url:req.url(),body});if(!entry)return;
    closed=true;off();
    let response=null;
    try{const res=await settle(req.response(),30000);if(res){let code=null;try{code=token((await settle(res.json(),5000))?.code);}catch{}response={status:res.status(),code};}}catch{}
    finish({entry,response});
  }
  target.on('request',onRequest);timer=setTimeout(stop,timeoutMs);timer.unref?.();
  return {done,stop};
}
