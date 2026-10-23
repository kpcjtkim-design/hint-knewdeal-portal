import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createVerify} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import fa from '../../lib/firestore-admin.cjs';
import wq from '../../lib/write-queue.cjs';
import handler,{QUEUE,drainHandler,RETRY_HOOKS} from '../../api/teacher-beta.js';

// 쓰기 대기열(2026-10-21): 서비스 계정 토큰·대기열 넣기·비우기(임대·300건 묶음·결과·재시도·포기)·상태·덮어쓰기를 가짜 Firestore REST·가짜 시트로 시험합니다.
// 시험용 RSA 키는 여기서 만듭니다(진짜 키 아님). 가상 계정·가상 학생만 씁니다.
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const PROJECT='hint-knewdeal-2',SA={type:'service_account',project_id:PROJECT,client_email:'queue@hint-knewdeal-2.iam.gserviceaccount.com',private_key:privateKey,token_uri:'https://oauth2.googleapis.com/token'};
const SHEET='https://script.test/exec',KEY='secret-key-123',ADMIN_EMAIL='hint.kpc@gmail.com',FS='https://firestore.googleapis.com/v1/projects/hint-knewdeal-2/databases/(default)/documents';
const PROFILES={'teacher@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'},tempClassIds:{arrayValue:{values:[{stringValue:'7'}]}}},
 'other@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'5'}}};

// ---------- 가짜 Firestore(REST) ----------
function fakeFirestore(){
 const docs=new Map(),stats={token:0,commit:0,query:0,batchGet:0,get:0,assertions:[]};let tick=0,failCommit=null;
 const stamp=()=>`2026-10-21T00:00:00.${String(++tick).padStart(6,'0')}Z`;
 const path=name=>name.slice(name.indexOf('/documents/')+11);
 const out=p=>({name:`projects/${PROJECT}/databases/(default)/documents/${p}`,fields:docs.get(p).fields,updateTime:docs.get(p).updateTime});
 const val=v=>fa.fromValue(v);
 function commit(body){
  if(failCommit){const f=failCommit;return Response.json({error:{status:f.grpc}},{status:f.status});}
  stats.commit++;
  for(const w of body.writes){const p=path(w.update.name),cur=docs.get(p),c=w.currentDocument;
   if(c?.exists===false&&cur)return Response.json({error:{status:'ALREADY_EXISTS'}},{status:409});
   if(c?.exists===true&&!cur)return Response.json({error:{status:'NOT_FOUND'}},{status:404});
   if(c?.updateTime&&cur?.updateTime!==c.updateTime)return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:400});}
  const results=[];
  for(const w of body.writes){const p=path(w.update.name),cur=docs.get(p),t=stamp();
   let fields;if(w.updateMask){fields={...(cur?.fields||{})};for(const k of w.updateMask.fieldPaths){if(k in w.update.fields)fields[k]=w.update.fields[k];else delete fields[k];}}else fields={...w.update.fields};
   for(const x of w.updateTransforms||[])fields[x.fieldPath]={timestampValue:t};
   docs.set(p,{fields,updateTime:t});results.push({updateTime:t});}
  return Response.json({writeResults:results,commitTime:stamp()});
 }
 function runQuery({structuredQuery:q}){
  stats.query++;
  const col=q.from[0].collectionId,f=q.where?.fieldFilter;
  let list=[...docs.keys()].filter(p=>p.startsWith(col+'/')&&!p.slice(col.length+1).includes('/')).sort();
  if(f)list=list.filter(p=>{const v=val(docs.get(p).fields[f.field.fieldPath]);return f.op==='EQUAL'?v===val(f.value):f.op==='IN'?val(f.value).includes(v):false;});
  assert.deepEqual(q.orderBy,[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],'always ordered by document name (no composite index)');
  list=list.slice(0,q.limit||list.length);
  return Response.json(list.length?list.map(p=>({document:out(p),readTime:'r'})):[{readTime:'r'}]);
 }
 async function fetchImpl(url,init={}){
  url=String(url);
  if(url===SA.token_uri){stats.token++;const a=new URLSearchParams(init.body).get('assertion');stats.assertions.push(a);return Response.json({access_token:'ya29.test-'+stats.token,expires_in:3600});}
  if(url.startsWith(FS+'/users/'))return null;
  if(url.startsWith(FS)){
   assert.match(init.headers.authorization,/^Bearer ya29\.test-/);
   if(url===FS+':commit')return commit(JSON.parse(init.body));
   if(url===FS+':runQuery')return runQuery(JSON.parse(init.body));
   if(url===FS+':batchGet'){stats.batchGet++;return Response.json(JSON.parse(init.body).documents.map(n=>docs.has(path(n))?{found:out(path(n))}:{missing:n}));}
   if(init.method==='GET'){stats.get++;const p=url.slice(FS.length+1);return docs.has(p)?Response.json(out(p)):Response.json({error:{status:'NOT_FOUND'}},{status:404});}
  }
  return null;
 }
 const data=p=>docs.has(p)?fa.fromFields(docs.get(p).fields):null;
 const queue=()=>[...docs.keys()].filter(p=>p.startsWith('writeQueue/')).sort().map(p=>({id:p.slice(11),...data(p)}));
 return {docs,stats,fetchImpl,data,queue,failCommits:f=>{failCommit=f;},
  setLease:(holder,expiresMs)=>docs.set('writeQueueLease/main',{fields:fa.toFields({holder,expiresAt:new Date(expiresMs),at:new Date(0)}),updateTime:stamp()})};
}
// 가짜 시트: b2ApplyQueue는 items 순서대로 결과. answer(items)로 바꿉니다.
function setup(t,{sheet=null,key=JSON.stringify(SA),clock=Date.parse('2026-10-29T10:00:00+09:00')}={}){
 const fs=fakeFirestore(),calls=[],bg=[];let now=clock;
 const old={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY,sa:process.env.FIREBASE_SERVICE_ACCOUNT,sw:process.env.WRITE_QUEUE,sec:process.env.DRAIN_SECRET};
 process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY=KEY;if(key)process.env.FIREBASE_SERVICE_ACCOUNT=key;else delete process.env.FIREBASE_SERVICE_ACCOUNT;delete process.env.WRITE_QUEUE;delete process.env.DRAIN_SECRET;
 const hooks={...RETRY_HOOKS};Object.assign(RETRY_HOOKS,{now:()=>now,sleep:async()=>{},random:()=>0});t.after(()=>Object.assign(RETRY_HOOKS,hooks));
 const opts={...QUEUE.opts};QUEUE.opts.defer=fn=>{bg.push(fn);return 'test';};QUEUE.opts.now=()=>now;QUEUE.state.lastTick=Infinity;QUEUE.opts.log={error(){},warn(){},info(){}};
 let rev=10;
 const answer=sheet||(({action,args})=>{
  if(action==='b2ApplyQueue'){const items=args[0].items;rev++;return Response.json({ok:true,data:{ok:true,rev,applied:items.length,failed:0,results:items.map(i=>({id:i.id,ok:true,action:i.rec.type?'write':'delete',sig:`sig-${i.rec.name}-${rev}`,warn:''}))}});}
  if(action==='portalData')return Response.json({ok:true,data:{cls:3,recs:{'가상가|2026-10-29':{type:'결석',r:'개인일정',ev:'',evr:''}}}});
  return Response.json({ok:true,data:{ok:true}});
 });
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  const own=await fs.fetchImpl(url,init);if(own)return own;
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return idToken.startsWith('tok:')?Response.json({users:[{email:idToken.slice(4)}]}):Response.json({},{status:400});}
  if(url.startsWith(FS+'/users/')){const email=decodeURIComponent(url.split('/users/')[1]);return PROFILES[email]?Response.json({fields:PROFILES[email]}):Response.json({},{status:404});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push(body);return answer(body);}
  throw Error('unexpected fetch '+url);
 });
 t.after(()=>{Object.assign(QUEUE.opts,opts);for(const [k,v] of [['HINT_SHEET_API_URL',old.url],['HINT_SHEET_API_KEY',old.key],['FIREBASE_SERVICE_ACCOUNT',old.sa],['WRITE_QUEUE',old.sw],['DRAIN_SECRET',old.sec]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 return {fs,calls,bg,settle:async()=>{while(bg.length)await bg.shift()();},advance:ms=>{now+=ms;},now:()=>now};
}
function resOf(){return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};}
async function call(body,{email='teacher@test.kr'}={},fn=handler){const res=resOf();await fn({method:'POST',headers:email?{authorization:`Bearer tok:${email}`}:{},body},res);return res;}
const item=(name,o={})=>({name,date:'2026-10-29',type:'지각',inT:'',outT:'',oa:'',ob:'',r:'',...o});
const sheetCalls=(calls,action)=>calls.filter(c=>c.action===action);

test('service account token: RS256 JWT for the datastore scope, verified with the public key, cached until it expires, key text never in errors',async()=>{
 const fs=fakeFirestore();let now=Date.parse('2026-10-21T00:00:00Z');
 const sa=fa.parseServiceAccount(JSON.stringify(SA));
 assert.equal(fa.parseServiceAccount(Buffer.from(JSON.stringify(SA)).toString('base64')).client_email,SA.client_email,'base64 JSON works too');
 assert.equal(fa.parseServiceAccount('{"x":1}'),null);assert.equal(fa.parseServiceAccount('not json'),null);assert.equal(fa.parseServiceAccount(''),null);
 const db=fa.createFirestoreAdmin({serviceAccount:sa,project:PROJECT,fetchImpl:fs.fetchImpl,now:()=>now});
 await db.get('writeQueue/x');await db.runQuery({from:[{collectionId:'writeQueue'}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:1});
 assert.equal(fs.stats.token,1,'one token for many requests');
 const [h,c,s]=fs.stats.assertions[0].split('.');
 assert.deepEqual(JSON.parse(Buffer.from(h,'base64url')),{alg:'RS256',typ:'JWT'});
 const claims=JSON.parse(Buffer.from(c,'base64url'));
 assert.deepEqual({...claims,iat:0,exp:claims.exp-claims.iat},{iss:SA.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:SA.token_uri,iat:0,exp:3600});
 assert.equal(claims.iat,Math.floor(now/1000));
 assert.equal(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey,Buffer.from(s,'base64url')),true,'signed with the service account key');
 now+=3600e3-120e3;await db.get('writeQueue/x');assert.equal(fs.stats.token,1,'still cached 2 minutes before expiry');
 now+=90e3;await db.get('writeQueue/x');assert.equal(fs.stats.token,2,'refreshed in the last minute');
 const bad=fa.createFirestoreAdmin({serviceAccount:sa,project:PROJECT,fetchImpl:async()=>Response.json({error:'invalid_grant'},{status:400}),now:()=>now});
 await assert.rejects(bad.get('x'),e=>e.message==='FIRESTORE_TOKEN_400'&&!e.message.includes('PRIVATE'));
 assert.deepEqual(fa.fromFields(fa.toFields({a:'x',n:3,f:1.5,b:true,l:['y',{z:null}],d:new Date(0)})),{a:'x',n:3,f:1.5,b:true,l:['y',{z:null}],d:'1970-01-01T00:00:00.000Z'});
});

test('the queue turns on only with a valid 2기 service account; WRITE_QUEUE=off turns it off; a wrong project stays off',()=>{
 assert.equal(wq.queueConfig({},PROJECT).enabled,false);
 assert.equal(wq.queueConfig({FIREBASE_SERVICE_ACCOUNT:'{bad'},PROJECT).reason,'bad-key');
 assert.equal(wq.queueConfig({FIREBASE_SERVICE_ACCOUNT:JSON.stringify(SA)},PROJECT).enabled,true);
 assert.equal(wq.queueConfig({FIREBASE_SERVICE_ACCOUNT:JSON.stringify(SA),WRITE_QUEUE:'off'},PROJECT).enabled,false);
 assert.equal(wq.queueConfig({FIREBASE_SERVICE_ACCOUNT:JSON.stringify({...SA,project_id:'hint-knewdeal-1'})},PROJECT).reason,'other-project');
 // 문서 id: 이름순 = 시간순, 같은 밀리초 안에서도 순서대로
 const ids=[wq.queueId(1000),wq.queueId(1000),wq.queueId(1001),wq.queueId(99999999999)];
 assert.deepEqual([...ids].sort(),ids);assert.equal(new Set(ids).size,4);assert.match(ids[0],/^[0-9a-z]{19}$/);
 assert.equal(wq.QUEUE_BATCH,60);assert.equal(wq.kstDay(Date.parse('2026-10-28T15:30:00Z')),'2026-10-29');
});

test('teacher batch save: one Firestore commit, one document per student and date, class forced to the own class, answered at once as queued',async t=>{
 const {fs,calls,bg}=setup(t);
 const res=await call({action:'portalSaveBatch',args:[{cls:9,items:[item('가상가',{inT:'09:40',r:'버스'}),item('가상나',{type:'해당없음'}),item('가상다',{type:'중복'}),item('가상가',{type:''})]}],cls:9});
 assert.equal(res.statusCode,200);
 const {ids,queued}=res.body.data;assert.equal(queued,true);assert.equal(ids.length,4);assert.equal(res.body.ok,true);assert.equal(res.body.data.ok,true);
 assert.equal(fs.stats.commit,1,'one commit for the whole batch');
 const q=fs.queue();assert.deepEqual(q.map(d=>d.id),ids,'document names sort in the order sent');
 assert.deepEqual(q.map(d=>[d.cls,d.name,d.rec.type,d.status,d.bucket,d.role,d.via,d.actor,d.attempts,d.kind]),[
  ['3','가상가','지각','pending','3|open','TEACHER','portalSave','teacher@test.kr',0,'attendance'],
  ['3','가상나','해당없음','pending','3|open','TEACHER','portalSave','teacher@test.kr',0,'attendance'],
  ['3','가상다','중복','pending','3|open','TEACHER','portalSave','teacher@test.kr',0,'attendance'],
  ['3','가상가','','pending','3|open','TEACHER','portalSave','teacher@test.kr',0,'attendance']]);
 assert.deepEqual(q[0].rec,{cls:'3',name:'가상가',date:'2026-10-29',type:'지각',inT:'09:40',outT:'',oa:'',ob:'',reason:'버스',ev:'',evr:''});
 assert.equal(typeof q[0].createdAt,'string','server time');assert.equal(q[0].day,'2026-10-29');
 assert.equal(sheetCalls(calls,'portalSave').length,0,'nothing went to the sheet directly');assert.equal(bg.length>=1,true,'a drain was woken');
 // 모양이 틀리면 바로 거절하고 아무것도 넣지 않습니다
 const before=fs.stats.commit;
 for(const bad of [item('가',{date:'2026-1-5'}),item('가',{type:'지각+조퇴'}),item('',{}),item('가',{inT:'9시'}),item('가',{r:'x'.repeat(501)})]){
  const r=await call({action:'portalSaveBatch',args:[{items:[item('가상가'),bad]}],cls:3});
  assert.deepEqual([r.statusCode,r.body.code],[400,'QUEUE_BAD_ITEM'],JSON.stringify(bad));
 }
 assert.equal((await call({action:'portalSaveBatch',args:[{items:Array.from({length:101},(_,i)=>item('학생'+i))}],cls:3})).body.code,'BAD_REQUEST','101 items');
 assert.equal((await call({action:'portalSaveBatch',args:[{items:[]}],cls:3})).body.code,'BAD_REQUEST');
 assert.equal(fs.stats.commit,before);
 // 하나짜리 portalSave도 대기열로
 const one=await call({action:'portalSave',args:[{cls:3,name:'가상나',date:'2026-10-28',type:'결석',r:'개인일정'}],cls:3});
 assert.equal(one.body.data.queued,true);assert.match(one.body.data.id,/^[0-9a-z]{19}$/);assert.equal(fs.data('writeQueue/'+one.body.data.id).rec.reason,'개인일정');
});

test('admin b2Save is queued with its before signature; class scope and the admin-only rule still hold; Firestore failure falls back to the direct save',async t=>{
 const {fs,calls}=setup(t);
 let res=await call({action:'b2Save',args:[{cls:'4',name:'가상라',date:'2026-10-29',type:'인정지각',inT:'10:00',reason:'면접',ev:'미제출',evr:'',before:'sig-old'}]},{email:ADMIN_EMAIL});
 assert.equal(res.body.data.queued,true);
 const d=fs.data('writeQueue/'+res.body.data.id);
 assert.deepEqual([d.role,d.via,d.before,d.cls,d.rec.ev,d.actor],['ADMIN','b2Save','sig-old','4','미제출',ADMIN_EMAIL]);
 assert.equal((await call({action:'b2Save',args:[{cls:'18',name:'가',date:'2026-10-29',type:'결석'}]},{email:ADMIN_EMAIL})).body.code,'BAD_CLASS');
 assert.equal((await call({action:'b2Save',args:[{name:'가',date:'2026-10-29',type:'결석'}]},{email:ADMIN_EMAIL})).body.code,'BAD_CLASS');
 assert.equal((await call({action:'b2Save',args:[{cls:'3',name:'가',date:'2026-10-29',type:'결석'}]})).body.code,'ADMIN_ONLY');
 assert.equal(calls.length,0);
 // Firestore에 못 넣으면 예전처럼 바로 시트에(담임 한 건·여러 건, 관리자)
 fs.failCommits({status:503,grpc:'UNAVAILABLE'});
 res=await call({action:'portalSave',args:[{cls:3,name:'가상가',date:'2026-10-29',type:'결석',r:''}],cls:3});
 assert.equal(res.statusCode,200);assert.deepEqual(calls.at(-1),{key:KEY,action:'portalSave',args:[{cls:3,name:'가상가',date:'2026-10-29',type:'결석',r:'',pin:''}]});
 res=await call({action:'portalSaveBatch',args:[{items:[item('가상가'),item('가상나',{type:'출석'})]}],cls:3});
 assert.deepEqual(res.body.data,{ok:true,queued:false,results:[{ok:true,msg:'',warn:''},{ok:true,msg:'',warn:''}]});
 assert.deepEqual(sheetCalls(calls,'portalSave').slice(-2).map(c=>[c.args[0].cls,c.args[0].name,c.args[0].type,c.args[0].pin]),[[3,'가상가','지각',''],[3,'가상나','출석','']]);
 res=await call({action:'b2Save',args:[{cls:'4',name:'가상라',date:'2026-10-29',type:'결석'}]},{email:ADMIN_EMAIL});
 assert.equal(calls.at(-1).action,'b2Save');assert.equal(calls.at(-1).role,'ADMIN');
});

test('without a service account nothing changes: saves go straight to the sheet and the batch action saves one by one',async t=>{
 const {fs,calls}=setup(t,{key:null});
 const res=await call({action:'portalSaveBatch',args:[{items:[item('가상가')]}],cls:3});
 assert.equal(res.body.data.queued,false);assert.equal(sheetCalls(calls,'portalSave').length,1);
 await call({action:'portalSave',args:[{cls:3,name:'가상가',date:'2026-10-29',type:'결석'}],cls:3});
 assert.equal(sheetCalls(calls,'portalSave').length,2);
 const st=await call({action:'queueStatus',args:[{ids:['abc']}],cls:3});assert.deepEqual(st.body.data,{enabled:false,items:[]});
 const pd=await call({action:'portalData',args:[3,''],cls:3});assert.equal(pd.body.data.queue,undefined,'teacher board keeps the old one-by-one save');
 assert.equal(fs.stats.commit+fs.stats.query+fs.stats.token,0);
});

test('drain: one lease, oldest first, 60 per sheet call (kind attendance, server admin actor), results become done/failed, lease released',async t=>{
 let n=0;
 const {fs,calls,settle}=setup(t,{sheet:({action,args})=>{
  if(action!=='b2ApplyQueue')return Response.json({ok:true,data:{}});
  const items=args[0].items;n++;
  return Response.json({ok:true,data:{ok:true,rev:100+n,applied:items.length-1,failed:1,results:items.map((i,k)=>k===1?{id:i.id,ok:false,error:'명부에 없는 학생입니다.',cls:i.rec.cls,name:i.rec.name,date:i.rec.date}:{id:i.id,ok:true,action:'write',sig:'s-'+i.rec.name,warn:k===0?'사유은 나중에 채워도 됩니다':''})}});
 }});
 QUEUE.opts.defer=()=>'test'; // 넣는 동안은 비우지 않음
 for(let b=0;b<4;b++)await call({action:'portalSaveBatch',args:[{items:Array.from({length:90},(_,i)=>item(`학생${String(b*90+i).padStart(3,'0')}`))}],cls:3});
 assert.equal(fs.queue().length,360);
 const sum=await QUEUE.drain();
 const applies=sheetCalls(calls,'b2ApplyQueue');
 assert.deepEqual(applies.map(c=>c.args[0].items.length),[60,60,60,60,60,60],'60 at a time');
 assert.deepEqual([applies[0].actor,applies[0].role],[wq.SERVER_ACTOR,'ADMIN']);
 const first=applies[0].args[0].items;
 assert.deepEqual(first.map(i=>i.rec.name),Array.from({length:60},(_,i)=>`학생${String(i).padStart(3,'0')}`),'oldest first');
 assert.deepEqual(Object.keys(first[0]).sort(),['actor','id','kind','rec','role','via']);assert.equal(first[0].kind,'attendance');
 assert.deepEqual(first[0].rec,{cls:'3',name:'학생000',date:'2026-10-29',type:'지각',inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:''});
 assert.deepEqual({rounds:sum.rounds,done:sum.done,failed:sum.failed,busy:sum.busy},{rounds:6,done:354,failed:6,busy:false});
 const q=fs.queue();
 assert.deepEqual([q[0].status,q[0].warn,q[0].sig,q[0].rev,q[0].bucket,typeof q[0].appliedAt],['done','사유은 나중에 채워도 됩니다','s-학생000',101,'3|done','string']);
 assert.deepEqual([q[1].status,q[1].error,q[1].bucket],['failed','명부에 없는 학생입니다.','3|failed|2026-10-29']);
 assert.equal(q[300].rev,106);assert.equal(q.filter(d=>d.status==='applying'||d.status==='pending').length,0);
 assert.equal(fs.data('writeQueueLease/main').holder,'','lease released');
 await settle();
});

test('drain respects a lease held by someone else, takes over an expired one, and the same instance never runs two drains',async t=>{
 const {fs,calls,now}=setup(t);QUEUE.opts.defer=()=>'test';
 await call({action:'portalSaveBatch',args:[{items:[item('가상가')]}],cls:3});
 fs.setLease('other-1',now()+60000);
 assert.equal((await QUEUE.drain()).busy,true);assert.equal(sheetCalls(calls,'b2ApplyQueue').length,0);assert.equal(fs.queue()[0].status,'pending');
 fs.setLease('other-1',now()-1);
 const [a,b]=await Promise.all([QUEUE.drain(),QUEUE.drain()]);
 assert.equal(b.joined,true,'second call joins the running drain');assert.equal(a.done,1);
 assert.equal(sheetCalls(calls,'b2ApplyQueue').length,1);assert.equal(fs.queue()[0].status,'done');
});

test('sheet unreachable: items go back to pending with attempts counted, and after 5 tries become failed with a plain message',async t=>{
 let mode='down';
 const {fs,calls,advance}=setup(t,{sheet:({action})=>{if(action!=='b2ApplyQueue')return Response.json({ok:true,data:{}});if(mode==='down')throw new TypeError('fetch failed');return Response.json({ok:false,error:'Lock timeout'});}});
 QUEUE.opts.defer=()=>'test';
 await call({action:'portalSaveBatch',args:[{items:[item('가상가'),item('가상나')]}],cls:3});
 let s=await QUEUE.drain();
 assert.deepEqual([s.retried,s.error],[2,'SHEET_UNAVAILABLE']);
 let q=fs.queue();assert.deepEqual(q.map(d=>[d.status,d.attempts,d.lastError,d.uncertain]),[['pending',1,'SHEET_UNAVAILABLE',false],['pending',1,'SHEET_UNAVAILABLE',false]]);
 assert.equal(fs.data('writeQueueLease/main').holder,'','a definite failure releases the lease');
 mode='lock';
 for(let i=0;i<3;i++){advance(1000);await QUEUE.drain();}
 q=fs.queue();assert.deepEqual(q.map(d=>[d.status,d.attempts,d.lastError]),[['pending',4,'SHEET_BUSY'],['pending',4,'SHEET_BUSY']]);
 await QUEUE.drain();
 q=fs.queue();assert.deepEqual(q.map(d=>[d.status,d.error,d.lastError,d.bucket]),[['failed',wq.GIVE_UP,'SHEET_BUSY','3|failed|2026-10-29'],['failed',wq.GIVE_UP,'SHEET_BUSY','3|failed|2026-10-29']]);
 assert.equal(sheetCalls(calls,'b2ApplyQueue').length,1+4*5,'lock timeouts are retried inside each drain (lib/sheet-retry.cjs, b2ApplyQueue counts as a safe overwrite), then the item waits for the next drain');
 assert.equal((await QUEUE.drain()).rounds,0,'nothing left to send');
});

test('unknown outcome (unreadable answer): the lease is kept until it expires, and the retry drops before so the item cannot conflict with itself',async t=>{
 let mode='html';const {fs,calls,advance}=setup(t,{sheet:({action,args})=>{
  if(action!=='b2ApplyQueue')return Response.json({ok:true,data:{}});
  if(mode==='html')return new Response('<html>error</html>');
  return Response.json({ok:true,data:{ok:true,rev:3,results:args[0].items.map(i=>({id:i.id,ok:true,action:'write',sig:'new'}))}});}});
 QUEUE.opts.defer=()=>'test';
 await call({action:'b2Save',args:[{cls:'4',name:'가상라',date:'2026-10-29',type:'결석',reason:'',before:'sig-1'}]},{email:ADMIN_EMAIL});
 await QUEUE.drain();
 assert.equal(sheetCalls(calls,'b2ApplyQueue')[0].args[0].items[0].before,'sig-1');
 assert.deepEqual([fs.queue()[0].status,fs.queue()[0].uncertain],['pending',true]);
 assert.notEqual(fs.data('writeQueueLease/main').holder,'','lease kept: the sheet may still be applying it');
 mode='ok';
 assert.equal((await QUEUE.drain()).busy,true,'nobody sends again before the lease expires');
 advance(wq.LEASE_MS+1);
 await QUEUE.drain();
 const sent=sheetCalls(calls,'b2ApplyQueue').at(-1).args[0].items[0];
 assert.equal('before' in sent,false,'before dropped on the uncertain retry');assert.equal(fs.queue()[0].status,'done');
});

test('a stuck applying item (drain died) is sent again after the lease expires; an old sheet without b2ApplyQueue gets the old one-by-one saves',async t=>{
 const {fs,calls,advance,now}=setup(t,{sheet:({action,args})=>{
  if(action==='b2ApplyQueue')return Response.json({ok:false,error:'unknown action'});
  if(action==='portalSave')return Response.json({ok:true,data:args[0].name==='가상나'?{ok:false,msg:'명부에 없는 학생입니다.'}:{ok:true,warn:'사유은 나중에 채워도 됩니다'}});
  if(action==='b2Save')return Response.json({ok:true,data:{ok:true,rev:9,sig:'sig-9'}});
  return Response.json({ok:true,data:{}});}});
 QUEUE.opts.defer=()=>'test';
 await call({action:'portalSaveBatch',args:[{items:[item('가상가',{r:'버스'}),item('가상나')]}],cls:3});
 await call({action:'b2Save',args:[{cls:'4',name:'가상라',date:'2026-10-29',type:'결석',before:'sig-1'}]},{email:ADMIN_EMAIL});
 // 앞선 drain이 applying으로 잡고 죽은 상태
 const p='writeQueue/'+fs.queue()[0].id;fs.docs.get(p).fields.status={stringValue:'applying'};fs.setLease('dead',now()+1000);advance(2000);
 await QUEUE.drain();
 assert.deepEqual(sheetCalls(calls,'portalSave').map(c=>[c.args[0].cls,c.args[0].name,c.args[0].type,c.args[0].r,c.args[0].pin]),[[3,'가상가','지각','버스',''],[3,'가상나','지각','','']]);
 const b2=sheetCalls(calls,'b2Save')[0];assert.deepEqual([b2.args[0].before,b2.actor,b2.role],['sig-1',ADMIN_EMAIL,'ADMIN'],'old path keeps the actor and the before check');
 assert.deepEqual(fs.queue().map(d=>[d.name,d.status,d.warn||d.error||'',d.sig||'']),[['가상가','done','사유은 나중에 채워도 됩니다',''],['가상나','failed','명부에 없는 학생입니다.',''],['가상라','done','','sig-9']]);
 assert.equal(fs.queue()[0].attempts,1);
});

test('queueStatus: my own items by id, my class pending and today failures; another class stays hidden; old pending wakes the drain',async t=>{
 const {fs,bg,advance,settle}=setup(t);QUEUE.opts.defer=fn=>{bg.push(fn);return 'test';};
 const mine=(await call({action:'portalSaveBatch',args:[{items:[item('가상가'),item('가상나')]}],cls:3})).body.data.ids;
 const other=(await call({action:'portalSaveBatch',args:[{items:[item('남의반')]}],cls:5},{email:'other@test.kr'})).body.data.ids;
 bg.length=0; // 아직 비우지 않음
 let st=await call({action:'queueStatus',args:[{ids:[...mine,...other,'../users/x']}],cls:3});
 assert.deepEqual(st.body.data.items.map(x=>[x.name,x.status,x.mine,x.cls]),[['가상가','pending',true,'3'],['가상나','pending',true,'3']],'other class hidden, odd ids ignored');
 assert.equal('actor' in st.body.data.items[0],false,'teachers do not get emails');
 assert.equal(bg.length,0,'fresh items do not wake the drain');
 advance(wq.NUDGE_MS+1);
 st=await call({action:'queueStatus',args:[{ids:mine}],cls:3});assert.equal(bg.length,1,'pending for 8 s → drain woken');
 await settle();
 st=await call({action:'queueStatus',args:[{ids:mine}],cls:3});
 assert.deepEqual(st.body.data.items.map(x=>[x.status,x.sig.startsWith('sig-'),x.rev>0]),[['done',true,true],['done',true,true]]);
 // 반 보기: 대기·실패(오늘)만, 담임은 자기 반
 fs.docs.get('writeQueue/'+mine[1]).fields.status={stringValue:'failed'};fs.docs.get('writeQueue/'+mine[1]).fields.bucket={stringValue:'3|failed|2026-10-29'};fs.docs.get('writeQueue/'+mine[1]).fields.error={stringValue:'명부에 없는 학생입니다.'};
 st=await call({action:'queueStatus',args:[{cls:'5'}],cls:3});
 assert.deepEqual(st.body.data.items.map(x=>[x.name,x.status,x.error]),[['가상나','failed','명부에 없는 학생입니다.']],'a teacher asking for class 5 gets the own class');
 await call({action:'portalSaveBatch',args:[{items:[item('남의반2')]}],cls:5},{email:'other@test.kr'});bg.length=0;
 st=await call({action:'queueStatus',args:[{cls:'5'}]},{email:ADMIN_EMAIL});
 assert.deepEqual(st.body.data.items.map(x=>[x.name,x.status,x.actor]),[['남의반2','pending','other@test.kr']],'admins see any class they pick, with the actor');
 st=await call({action:'queueStatus',args:[{ids:other}]},{email:ADMIN_EMAIL});assert.deepEqual(st.body.data.items.map(x=>[x.name,x.status]),[['남의반','done']]);
});

test(`deletes are capped per sheet call (QUEUE_MAX_DELETES) by cutting the batch at that point, so the order never changes`,async t=>{
 const {fs,calls}=setup(t);QUEUE.opts.defer=()=>'test';
 assert.equal(wq.QUEUE_MAX_DELETES,300,'sheet v22: deletes are fast, the cap equals the batch');
 const M=5;QUEUE.opts.maxDeletes=M;
 const list=[item('쓰기0'),...Array.from({length:M+5},(_,i)=>item('지우기'+i,{type:''})),item('쓰기1')];
 for(let i=0;i<list.length;i+=100)await call({action:'portalSaveBatch',args:[{items:list.slice(i,i+100)}],cls:3});
 const s=await QUEUE.drain();
 const sent=sheetCalls(calls,'b2ApplyQueue').map(c=>c.args[0].items.map(x=>x.rec.name));
 assert.deepEqual(sent.map(x=>x.length),[M+1,6]);assert.equal(sent[0].filter(n=>n.startsWith('지우기')).length,M);
 assert.deepEqual(sent.flat(),list.map(x=>x.name),'same order overall');
 assert.equal(s.done,list.length);assert.equal(fs.queue().every(d=>d.status==='done'),true);
});

test('reads show what is still waiting: portalData recs and b2Bundle rows are overlaid with pending values (pending:true), deletes hide the row',async t=>{
 const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
 const L=(cls,name,type,o={})=>COLS.map(k=>({date:'2026-10-29',cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'확인',evr:'',memo:'m',evApplied:'',check:'',prov:'포털',flag:'',sig:'sig-'+name,...o})[k]);
 const {fs}=setup(t,{sheet:({action})=>action==='b2Bundle'?Response.json({ok:true,data:{rev:5,ledgerCols:[...COLS],ledger:[L('3','가상가','결석'),L('3','가상나','지각'),L('5','남의반','결석')]}})
  :action==='portalData'?Response.json({ok:true,data:{cls:3,recs:{'가상가|2026-10-29':{type:'결석',r:'개인일정',ev:'확인',evr:''},'가상나|2026-10-29':{type:'지각',r:''}}}}):Response.json({ok:true,data:{}})});
 QUEUE.opts.defer=()=>'test';
 await call({action:'portalSaveBatch',args:[{items:[item('가상가',{type:'인정출석',r:'면접'}),item('가상나',{type:''}),item('가상다',{type:'출석'})]}],cls:3});
 const pd=(await call({action:'portalData',args:[3,''],cls:3})).body.data;
 assert.equal(pd.queue,true);
 assert.deepEqual(pd.recs,{'가상가|2026-10-29':{type:'인정출석',r:'면접',ev:'확인',evr:'',inT:'',outT:'',oa:'',ob:'',pending:true},'가상다|2026-10-29':{type:'출석',inT:'',outT:'',oa:'',ob:'',r:'',pending:true}},'teacher items keep the sheet evidence');
 const b=(await call({action:'b2Bundle',args:['all']},{email:ADMIN_EMAIL})).body.data;
 assert.equal(b.ledgerCols.at(-1),'pending');
 const rows=b.ledger.map(r=>Object.fromEntries(b.ledgerCols.map((k,i)=>[k,r[i]??''])));
 assert.deepEqual(rows.map(r=>[r.cls,r.name,r.type,r.reason,r.ev,r.sig,r.pending]),[['3','가상가','인정출석','면접','확인','sig-가상가',true],['5','남의반','결석','','확인','sig-남의반',''],['3','가상다','출석','','','',true]]);
 // 대기열을 못 읽으면 시트 값 그대로
});

test('/api/drain (vercel.json rewrite to /api/teacher-beta?drain=1): the shared secret or a signed-in user can nudge; nobody else',async t=>{
 const {calls}=setup(t);QUEUE.opts.defer=()=>'test';process.env.DRAIN_SECRET='drain-secret-test';
 await call({action:'portalSaveBatch',args:[{items:[item('가상가')]}],cls:3});
 let res=resOf();await handler({method:'POST',url:'/api/teacher-beta?drain=1',query:{drain:'1'},headers:{'x-drain-secret':'wrong'},body:{}},res);
 assert.equal(res.statusCode,401);assert.equal(sheetCalls(calls,'b2ApplyQueue').length,0);
 res=resOf();await drainHandler({method:'POST',headers:{'x-drain-secret':'drain-secret-test'},body:{}},res);
 assert.deepEqual([res.statusCode,res.body.data.done],[200,1]);
 res=resOf();await handler({method:'POST',url:'/api/teacher-beta?drain=1',headers:{authorization:'Bearer tok:teacher@test.kr'},body:{}},res);assert.equal(res.statusCode,200);
 res=resOf();await handler({method:'GET',url:'/api/teacher-beta?drain=1',headers:{},body:{}},res);assert.equal(res.statusCode,405);
 const vj=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(vj.rewrites.find(r=>r.source==='/api/drain'),{source:'/api/drain',destination:'/api/teacher-beta?drain=1'});assert.equal(vj.functions['api/teacher-beta.js'].maxDuration,60);
});

// Vercel 함수는 ../lib/*.mjs를 불러오지 못해 죽습니다(2026-10-21 cfa6071 FUNCTION_INVOCATION_FAILED). 서버 공용 모듈은 .cjs, api 파일끼리도 서로 import하지 않습니다.
test('api functions import only CommonJS shared modules (.cjs) and never another api file',()=>{
 for(const f of readdirSync(new URL('../../api/',import.meta.url)).filter(x=>x.endsWith('.js'))){
  const src=readFileSync(new URL('../../api/'+f,import.meta.url),'utf8'),froms=[...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m=>m[1]).filter(x=>x.startsWith('.'));
  for(const x of froms)assert.match(x,/^\.\.\/lib\/[\w-]+\.cjs$/,f+' imports '+x);
 }
 for(const m of ['write-queue.cjs','firestore-admin.cjs'])assert.match(readFileSync(new URL('../../lib/'+m,import.meta.url),'utf8'),/\nmodule\.exports=\{/,m);
});

test('safety net: any API request wakes the drain when a pending item is older than 30 s (checked at most every 20 s per instance)',async t=>{
 const {fs,bg,advance,settle}=setup(t);QUEUE.opts.defer=()=>'test';
 await call({action:'portalSaveBatch',args:[{items:[item('가상가')]}],cls:3});
 QUEUE.opts.defer=fn=>{bg.push(fn);return 'test';};
 advance(60000);QUEUE.state.lastTick=0;await call({action:'b2Rev',args:[]},{email:ADMIN_EMAIL});
 assert.equal(bg.length,1);await settle();
 assert.equal(fs.queue()[0].status,'done');
 await call({action:'b2Rev',args:[]},{email:ADMIN_EMAIL});assert.equal(bg.length,0,'not again within 20 s');
});

test('rehearsal safeguards (sheet v23): teacher before goes into the queue and b2ApplyQueue, CONFLICT becomes a failed item; a bad before is refused; the direct path passes before and reports conflict',async t=>{
 const CONFLICT='CONFLICT: 운영팀이 그사이 이 기록을 고쳤습니다. 최신 값을 다시 읽어 주세요.';
 const {fs,calls}=setup(t,{sheet:({action,args})=>{
  if(action!=='b2ApplyQueue')return Response.json({ok:true,data:{ok:true}});
  const items=args[0].items;
  return Response.json({ok:true,data:{ok:true,rev:20,results:items.map(i=>i.before==='sig-old'?{id:i.id,ok:false,error:CONFLICT}:{id:i.id,ok:true,action:'write',sig:'sig-new-'+i.rec.name})}});
 }});
 QUEUE.opts.defer=()=>'test';
 const res=await call({action:'portalSaveBatch',args:[{items:[item('가상가',{before:'sig-old'}),item('가상나',{before:''}),item('가상다')]}],cls:3});
 const {ids}=res.body.data;
 assert.deepEqual(fs.queue().map(d=>[d.name,d.role,d.before]),[['가상가','TEACHER','sig-old'],['가상나','TEACHER',''],['가상다','TEACHER',undefined]],'before kept per item (\'\' = the row did not exist)');
 await QUEUE.drain();
 const sent=sheetCalls(calls,'b2ApplyQueue')[0].args[0].items;
 assert.deepEqual(sent.map(i=>[i.rec.name,i.role,i.before]),[['가상가','TEACHER','sig-old'],['가상나','TEACHER',''],['가상다','TEACHER',undefined]],'teacher items carry before to the sheet');
 const st=(await call({action:'queueStatus',args:[{ids}],cls:3})).body.data.items;
 assert.deepEqual(st.map(x=>[x.name,x.status,x.error,x.sig]),[['가상가','failed',CONFLICT,''],['가상나','done','','sig-new-가상나'],['가상다','done','','sig-new-가상다']]);
 // 모양이 틀린 before는 받지 않음(대기열에 넣지 않음)
 for(const before of [{x:1},'x'.repeat(65),'a b'])assert.equal((await call({action:'portalSaveBatch',args:[{items:[item('가상라',{before})]}],cls:3})).body.code,'QUEUE_BAD_ITEM');
 assert.equal((await call({action:'portalSave',args:[{cls:3,...item('가상라',{before:{}})}],cls:3})).body.code,'QUEUE_BAD_ITEM');
 const one=await call({action:'portalSave',args:[{cls:3,...item('가상라',{before:'sig-1'})}],cls:3});
 assert.equal(fs.data('writeQueue/'+one.body.data.id).before,'sig-1','single teacher save keeps before too');
});

test('rehearsal safeguards, direct path (no queue): portalSaveBatch and portalSave send before to the sheet; a sheet conflict comes back as conflict:true',async t=>{
 const {calls}=setup(t,{key:null,sheet:({action,args})=>action==='portalSave'?Response.json({ok:true,data:args[0].before==='sig-old'?{ok:false,conflict:true,msg:'CONFLICT: 운영팀이 그사이 이 기록을 고쳤습니다.'}:{ok:true}}):Response.json({ok:true,data:{}})});
 const res=await call({action:'portalSaveBatch',args:[{items:[item('가상가',{before:'sig-old'}),item('가상나')]}],cls:3});
 assert.deepEqual(res.body.data.results.map(r=>[r.ok,!!r.conflict]),[[false,true],[true,false]]);
 assert.deepEqual(sheetCalls(calls,'portalSave').map(c=>c.args[0].before),['sig-old',undefined]);
 const single=await call({action:'portalSave',args:[{cls:3,...item('가상가',{before:'sig-old'})}],cls:3});
 assert.deepEqual(single.body.data,{ok:false,conflict:true,msg:'CONFLICT: 운영팀이 그사이 이 기록을 고쳤습니다.'});
 assert.equal(sheetCalls(calls,'portalSave').at(-1).args[0].before,'sig-old');
 assert.equal((await call({action:'portalSave',args:[{cls:3,...item('가상가',{before:'no spaces allowed'})}],cls:3})).body.code,'BAD_REQUEST');
});
