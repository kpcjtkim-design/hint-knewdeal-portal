// 계정 문서 읽기 줄이기(2026-10-23 Firebase 무료 한도 초과 사고): 같은 담임의 요청은 10분 동안 계정 문서를 다시 읽지 않고,
// Firebase가 한도(429)로 막으면 24시간 안에 확인했던 계정으로 계속 씁니다. 이름은 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{FIREBASE,ACCESS,cachedProfile,rememberProfile,forgetProfiles} from '../../api/teacher-beta.js';

const SHEET='https://script.test/exec',TEACHER='teacher@test.kr';
function backend(t,{firestore}){
 const reads=[],saved={...FIREBASE},access=ACCESS.teacher,env={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 Object.assign(FIREBASE,{ready:true,key:'fb-key',project:'hint-test'});ACCESS.teacher=true;process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY='secret';forgetProfiles();
 t.after(()=>{Object.assign(FIREBASE,saved);ACCESS.teacher=access;forgetProfiles();for(const [k,v] of [['HINT_SHEET_API_URL',env.url],['HINT_SHEET_API_KEY',env.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return Response.json({users:[{email:idToken.slice(4)}]});}
  if(url.startsWith('https://firestore.googleapis.com/')){reads.push(url);return firestore();}
  if(url===SHEET)return Response.json({ok:true,data:{ok:true,rev:1,sync:{}}});
  throw Error('unexpected fetch '+url);
 });
 return reads;
}
async function call(body,email=TEACHER){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);return res;
}
const PROFILE={fields:{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'1'}}};

test('a teacher profile is read once and reused for the next requests',async t=>{
 const reads=backend(t,{firestore:()=>Response.json(PROFILE)});
 for(let i=0;i<5;i++){const r=await call({action:'b2Rev',args:[]});assert.equal(r.statusCode,200,JSON.stringify(r.body));}
 assert.equal(reads.length,1,'users/{email} read only once');
});

test('when Firebase says 429, a profile confirmed within 24 hours keeps working; without one the old quota error stays',async t=>{
 let quota=false;const reads=backend(t,{firestore:()=>quota?Response.json({},{status:429}):Response.json(PROFILE)});
 assert.equal((await call({action:'b2Rev',args:[]})).statusCode,200);
 forgetProfiles();rememberProfile({email:TEACHER,role:'TEACHER',classIds:['1']},Date.now()-60*60*1000); // 한 시간 전 확인(10분 지남)
 quota=true;
 const r=await call({action:'b2Rev',args:[]});assert.equal(r.statusCode,200,JSON.stringify(r.body));
 assert.equal(reads.length,2,'tried Firebase once more, then used the remembered profile');
 const other=await call({action:'b2Rev',args:[]},'new@test.kr');
 assert.equal(other.body.code,'DATABASE_QUOTA_EXCEEDED');
});

test('cache windows: fresh 10 minutes, stale fallback 24 hours',()=>{
 forgetProfiles();const t0=1_000_000_000;rememberProfile({email:'a@test.kr',role:'TEACHER',classIds:['2']},t0);
 assert.ok(cachedProfile('a@test.kr',t0+9*60*1000));assert.equal(cachedProfile('a@test.kr',t0+11*60*1000),null);
 assert.ok(cachedProfile('a@test.kr',t0+23*3600*1000,{stale:true}));assert.equal(cachedProfile('a@test.kr',t0+25*3600*1000,{stale:true}),null);
 forgetProfiles();
});
