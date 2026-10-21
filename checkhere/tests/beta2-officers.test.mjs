import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import handler,{b2Args,FIREBASE,ACCESS} from '../../api/teacher-beta.js';
import {suggestKind,reasonOf,savePayload,endPayload,checkForm,isConflict,currentOf,holdersOf,isMulti,kindsFor} from '../../beta2-officers.mjs';
import {openPortal,PORTAL} from './teacher-fixture.mjs';

// 2기 반 임원(사용자 결정 2026-10-20: 반장·부반장·총무·앰버서더, 보궐은 최초와 구분, 담임(자기 반)·관리자 모두 고침).
// 시트(Apps Script v15 b2Officers·b2OfficerSave·b2OfficerEnd)는 가짜로 답합니다. 사람 이름은 모두 가상입니다.
// 앰버서더 여러 명(사용자 2026-10-21 '엠버서더는 2명이상 가능하게', 10명까지): current[반]['앰버서더']는 배열, 구분 '추가'는 앰버서더만.
const base=join(import.meta.dirname,'../..');
const ROLES=['반장','부반장','총무','앰버서더'],KINDS=['최초','보궐','추가'],AMB='앰버서더',AMB_MAX=10;

/* ---------- 가짜 마스터시트('반 임원' 탭 + 명부, 계약대로 거절) ---------- */
function officerSheet(){
 const R=(row,cls,role,name,kind,start,o={})=>({row,cls,role,name,kind,start,end:'',reason:'',note:'',by:'teacher@test.kr',at:start+' 10:00',...o});
 const s={rev:20,today:'2026-11-05',writes:[],
  roster:[['1','고다원','재학',''],['1','김동진','중도탈락','2026-11-02'],['1','박서연','재학',''],['1','이하늘','재학',''],['1','정민호','재학',''],['1','한별','재학',''],['2','이경수','재학',''],['2','최민','재학','']],
  rows:[R(2,'1','반장','김동진','최초','2026-10-28'),R(3,'1','총무','고다원','최초','2026-10-28'),R(4,'2','반장','이경수','최초','2026-10-29')]};
 s.R=R;
 const fail=m=>{throw new Error(m);};
 const cur=(c,role)=>s.rows.find(r=>r.cls===String(c)&&r.role===role&&!r.end)||null;
 const ambs=c=>s.rows.filter(r=>r.cls===String(c)&&r.role===AMB&&!r.end);
 const brief=r=>({row:r.row,name:r.name,kind:r.kind,start:r.start});
 const status=(c,n)=>s.roster.find(r=>r[0]===String(c)&&r[1]===n)?.[2];
 s.view=c=>{
  const ids=c?[String(c)]:['1','2'],current={};
  for(const id of ids){current[id]={};for(const role of ROLES){if(role===AMB){current[id][role]=ambs(id).map(brief);continue;}const r=cur(id,role);current[id][role]=r?brief(r):null;}}
  const needs=s.rows.filter(r=>!r.end&&ids.includes(r.cls)&&['중도탈락','조기취업'].includes(status(r.cls,r.name))).map(r=>({cls:r.cls,role:r.role,name:r.name,status:status(r.cls,r.name),changed:s.roster.find(x=>x[0]===r.cls&&x[1]===r.name)[3],row:r.row}));
  return {rev:s.rev,roles:ROLES,kinds:KINDS,rows:s.rows.filter(r=>ids.includes(r.cls)).map(r=>({...r})),current,needs};
 };
 const add=(p,actor,start)=>{const row=Math.max(...s.rows.map(r=>r.row))+1;s.rows.push(R(row,p.cls,p.role,p.name,p.kind,start,{note:p.note||'',by:actor}));return row;};
 s.save=(p,actor)=>{
  if(!ROLES.includes(p.role))fail('역할을 확인해 주세요.');if(!KINDS.includes(p.kind)||(p.kind==='추가'&&p.role!==AMB))fail('구분을 확인해 주세요.');
  if(p.role===AMB){
   // 앰버서더: 최초·추가는 더하기만(was 없음 또는 지금 이름 배열, 순서 무관), 보궐은 was:{name} 그 사람을 끝내고 더함
   const now=ambs(p.cls),names=now.map(r=>r.name);
   if(p.kind==='보궐'){
    const t=now.find(r=>r.name===p.was?.name);if(!t)fail('그사이 바뀌었습니다. 새로 읽어 주세요.');
    if(names.includes(p.name))fail(`이미 ${p.cls}반 앰버서더입니다.`);if(status(p.cls,p.name)!=='재학')fail('명부에 없는 학생입니다.');
    const start=p.start||s.today;if(start<t.start)fail('시작일이 지금 임원보다 빠릅니다.');
    Object.assign(t,{end:start,reason:p.reason||'보궐 선출'});const row=add(p,actor,start);s.rev++;return {ok:true,row,ended:t.row,rev:s.rev};
   }
   if(p.was!==undefined&&(!Array.isArray(p.was)||[...p.was].sort().join('|')!==[...names].sort().join('|')))fail('그사이 바뀌었습니다. 새로 읽어 주세요.');
   if(names.includes(p.name))fail(`이미 ${p.cls}반 앰버서더입니다.`);if(now.length>=AMB_MAX)fail(`앰버서더는 ${AMB_MAX}명까지입니다.`);
   if(status(p.cls,p.name)!=='재학')fail('명부에 없는 학생입니다.');
   const row=add(p,actor,p.start||s.today);s.rev++;return {ok:true,row,ended:0,rev:s.rev};
  }
  const c=cur(p.cls,p.role);
  if(!p.was||(c?.name||'')!==p.was.name)fail('그사이 바뀌었습니다. 새로 읽어 주세요.');
  if(c&&c.name===p.name)fail(`이미 ${p.cls}반 ${p.role}입니다.`);
  if(status(p.cls,p.name)!=='재학')fail('명부에 없는 학생입니다.');
  const start=p.start||s.today;if(c&&start<c.start)fail('시작일이 지금 임원보다 빠릅니다.');
  if(c)Object.assign(c,{end:start,reason:p.reason||''});
  const row=add(p,actor,start);
  s.rev++;return {ok:true,row,ended:c?.row||0,rev:s.rev};
 };
 s.end=p=>{
  const c=p.role===AMB?ambs(p.cls).find(r=>r.name===p.was?.name):cur(p.cls,p.role);if(!c||!p.was||c.name!==p.was.name)fail('그사이 바뀌었습니다. 새로 읽어 주세요.');
  Object.assign(c,{end:p.end||s.today,reason:p.reason||''});s.rev++;return {ok:true,ended:c.row,rev:s.rev};
 };
 s.handle=body=>{
  const p=body.args?.[0]??{};
  switch(body.action){
   case 'b2Officers':if(body.role==='TEACHER'&&!p.cls)fail('반 번호를 확인해 주세요.');return s.view(p.cls);
   case 'b2OfficerSave':s.writes.push(['save',p,body.role]);return s.save(p,body.actor);
   case 'b2OfficerEnd':s.writes.push(['end',p,body.role]);return s.end(p);
   case 'b2Bundle':{const c=String(body.args?.[0]??'all');return {rev:s.rev,today:s.today,days:[],classes:[],roster:s.roster.filter(r=>c==='all'||r[0]===c).map(r=>[...r]),ledgerCols:[],ledger:[],sync:{}};}
   case 'b2Rev':return {rev:s.rev,sync:{},voc:{rev:1,admin:0,open:{},teacher:{}}};
   case 'b2Docs':return {rev:s.rev,rows:[],statuses:[],types:[],delivery:[]};
   case 'b2Vocs':return {rev:s.rev,rows:[]};
   default:return {};
  }
 };
 return s;
}

/* ---------- 순수 함수(beta2-officers.mjs) ---------- */
test('kind suggestion, reason text, payloads and the form check follow the sheet contract',()=>{
 const d=officerSheet().view();
 assert.equal(currentOf(d,'1','반장').name,'김동진');
 assert.deepEqual(['반장','부반장','총무','앰버서더'].map(r=>suggestKind(d,'1',r)),['보궐','최초','보궐','최초'],'held → 보궐, never held → 최초');
 d.current['1']['반장']=null;assert.equal(suggestKind(d,'1','반장'),'보궐','ended earlier but has history → still 보궐');
 assert.deepEqual([reasonOf('중도탈락',''),reasonOf('사퇴',' 개인 사정 '),reasonOf('기타','이사'),reasonOf('기타',''),reasonOf('','')],['중도탈락','사퇴 · 개인 사정','이사','기타','']);
 const f={cls:'1',role:'반장',mode:'save',was:'김동진',name:'박서연',kind:'보궐',start:'2026-11-03',reasonSel:'중도탈락',reasonText:'',note:' '};
 assert.deepEqual(savePayload(f),{cls:'1',role:'반장',name:'박서연',kind:'보궐',start:'2026-11-03',was:{name:'김동진'},reason:'중도탈락'});
 assert.deepEqual(savePayload({...f,role:'부반장',was:'',kind:'최초'}),{cls:'1',role:'부반장',name:'박서연',kind:'최초',start:'2026-11-03',was:{name:''}},'empty role: was.name is "" and no reason');
 assert.deepEqual(endPayload({cls:'2',role:'반장',was:'이경수',end:'2026-11-05',reasonSel:'사퇴',reasonText:''}),{cls:'2',role:'반장',end:'2026-11-05',was:{name:'이경수'},reason:'사퇴'});
 const d2=officerSheet().view();
 assert.equal(checkForm(f,d2),'');
 assert.equal(checkForm({...f,name:''},d2),'이름을 골라 주세요.');
 assert.equal(checkForm({...f,name:'김동진'},d2),'이미 1반 반장입니다.');
 assert.equal(checkForm({...f,start:'2026-10-01'},d2),'시작일이 지금 반장의 시작일(10/28(수))보다 빠릅니다.');
 assert.equal(checkForm({...f,mode:'end',end:''},d2),'종료일을 넣어 주세요.');
 assert.equal(checkForm({...f,role:'회장'},d2),'역할을 골라 주세요.');
 assert.ok(isConflict(new Error('그사이 바뀌었습니다. 새로 읽어 주세요.')));assert.ok(isConflict({code:'CONFLICT'}));assert.ok(!isConflict(new Error('명부에 없는 학생입니다.')));
 assert.equal(checkForm({...f,kind:'추가'},d2),'구분(최초·보궐)을 골라 주세요.','추가 is for 앰버서더 only');
});

test('앰버서더 여러 명: 배열 holders, 구분 최초·추가·보궐(누구 대신), was 배열/객체, 10명 한도, 예전 응답(객체·null)은 한 명 역할로',()=>{
 const sheet=officerSheet();
 sheet.rows.push(sheet.R(5,'1',AMB,'이하늘','최초','2026-10-28'),sheet.R(6,'1',AMB,'한별','추가','2026-10-30'));
 const d=sheet.view();
 assert.deepEqual(d.current['1'][AMB].map(h=>h.name),['이하늘','한별']);assert.deepEqual(d.current['2'][AMB],[]);
 assert.ok(isMulti(d,AMB));assert.ok(!isMulti(d,'반장'));
 assert.deepEqual(holdersOf(d,'1',AMB).map(h=>h.name),['이하늘','한별']);assert.deepEqual(holdersOf(d,'2',AMB),[]);
 assert.deepEqual(holdersOf(d,'1','반장').map(h=>h.name),['김동진']);assert.deepEqual(holdersOf(d,'1','부반장'),[]);
 assert.deepEqual([kindsFor(d,'1',AMB),kindsFor(d,'2',AMB),kindsFor(d,'1','반장')],[['최초','추가','보궐'],['최초','추가'],['최초','보궐']]);
 assert.deepEqual([suggestKind(d,'1',AMB),suggestKind(d,'2',AMB)],['추가','최초']);
 const add={cls:'1',role:AMB,mode:'save',multi:true,was:'',wasList:['이하늘','한별'],name:'박서연',kind:'추가',start:'2026-11-05',reasonSel:'사퇴',reasonText:'',note:''};
 assert.deepEqual(savePayload(add),{cls:'1',role:AMB,name:'박서연',kind:'추가',start:'2026-11-05',was:['이하늘','한별']},'adding sends the current names, no reason');
 const sub={...add,kind:'보궐',was:'한별',reasonSel:'사퇴'};
 assert.deepEqual(savePayload(sub),{cls:'1',role:AMB,name:'박서연',kind:'보궐',start:'2026-11-05',was:{name:'한별'},reason:'사퇴'});
 assert.deepEqual(endPayload({cls:'1',role:AMB,was:'이하늘',end:'2026-11-05',reasonSel:'',reasonText:''}),{cls:'1',role:AMB,end:'2026-11-05',was:{name:'이하늘'}});
 assert.equal(checkForm(add,d),'');assert.equal(checkForm(sub,d),'');
 assert.equal(checkForm({...add,name:'한별'},d),'이미 1반 앰버서더입니다.');
 assert.equal(checkForm({...sub,was:''},d),'누구 대신(보궐)인지 골라 주세요.');
 assert.equal(checkForm({...sub,start:'2026-10-29'},d),'시작일이 한별 님의 시작일(10/30(금))보다 빠릅니다.');
 assert.equal(checkForm({...add,start:'2026-10-01'},d),'','adding does not depend on earlier starts');
 assert.equal(checkForm({...sub,mode:'end',end:'2026-10-29'},d),'종료일이 시작일(10/30(금))보다 빠릅니다.');
 assert.equal(checkForm({...add,cls:'2',kind:'보궐',was:'한별'},d),'구분(최초·추가)을 골라 주세요.','no one to replace in 2반');
 const full=structuredClone(d);full.current['1'][AMB]=Array.from({length:AMB_MAX},(_,i)=>({row:10+i,name:'가상'+i,kind:'추가',start:'2026-10-28'}));
 assert.equal(checkForm(add,full),'앰버서더는 10명까지입니다.');assert.equal(checkForm({...sub,was:'가상3'},full),'','보궐 still works at 10');
 // 예전 시트(배포 전): 앰버서더가 객체·null, 구분에 '추가' 없음 → 한 명 역할처럼
 const old={rev:1,roles:ROLES,kinds:['최초','보궐'],rows:[],current:{'1':{반장:null,부반장:null,총무:null,[AMB]:{row:3,name:'이하늘',kind:'최초',start:'2026-10-28'}},'2':{반장:null,부반장:null,총무:null,[AMB]:null}},needs:[]};
 assert.ok(!isMulti(old,AMB));
 assert.deepEqual([holdersOf(old,'1',AMB).map(h=>h.name),holdersOf(old,'2',AMB),currentOf(old,'1',AMB).name,currentOf(old,'2',AMB)],[['이하늘'],[],'이하늘',null]);
 assert.deepEqual([suggestKind(old,'1',AMB),kindsFor(old,'1',AMB)],['보궐',['최초','보궐']]);
 assert.equal(checkForm({cls:'1',role:AMB,mode:'save',was:'이하늘',name:'박서연',kind:'보궐',start:'2026-11-05'},old),'');
 assert.deepEqual(savePayload({cls:'1',role:AMB,was:'이하늘',name:'박서연',kind:'보궐',start:'2026-11-05'}),{cls:'1',role:AMB,name:'박서연',kind:'보궐',start:'2026-11-05',was:{name:'이하늘'}});
 // 가짜 시트 계약: 더하기는 was 배열 순서 무관, 다르면 거절, 보궐은 그 사람을 끝냄(사유 없으면 '보궐 선출')
 assert.throws(()=>sheet.save({cls:'1',role:AMB,name:'박서연',kind:'추가',was:['이하늘']},'x'),/그사이 바뀌었습니다/);
 assert.equal(sheet.save({cls:'1',role:AMB,name:'박서연',kind:'추가',was:['한별','이하늘']},'x').ended,0);
 assert.equal(sheet.save({cls:'1',role:AMB,name:'정민호',kind:'보궐',was:{name:'한별'}},'x').ended,6);
 assert.equal(sheet.rows.find(r=>r.row===6).reason,'보궐 선출');
 assert.throws(()=>sheet.save({cls:'1',role:'반장',name:'박서연',kind:'추가',was:{name:'김동진'}},'x'),/구분을 확인/);
});

/* ---------- Vercel 중계(api/teacher-beta.js): 담임은 자기 반으로 고정 ---------- */
const SHEET='https://script.test/exec',ADMIN_EMAIL='hint.kpc@gmail.com',TEACHER='teacher@test.kr';
const PROFILES={[TEACHER]:{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'1'}}};
function backend(t,sheet){
 const calls=[],saved={...FIREBASE},access=ACCESS.teacher,env={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 Object.assign(FIREBASE,{ready:true,key:'fb-key',project:'hint-test'});ACCESS.teacher=true;process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY='secret';
 t.after(()=>{Object.assign(FIREBASE,saved);ACCESS.teacher=access;for(const [k,v] of [['HINT_SHEET_API_URL',env.url],['HINT_SHEET_API_KEY',env.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return Response.json({users:[{email:idToken.slice(4)}]});}
  if(url.startsWith('https://firestore.googleapis.com/')){const email=decodeURIComponent(url.split('/users/')[1]);return PROFILES[email]?Response.json({fields:PROFILES[email]}):Response.json({},{status:404});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push(body);return Response.json(sheet(body));}
  throw Error('unexpected fetch '+url);
 });
 return calls;
}
async function call(body,email=ADMIN_EMAIL){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);return res;
}

test('server scoping: admins read all or one class; teachers are forced to their own class for reads and writes, only contract fields pass',async t=>{
 const calls=backend(t,()=>({ok:true,data:{ok:true,rev:1}}));
 for(const a of [[{}],[{cls:'all'}],[]])await call({action:'b2Officers',args:a});
 await call({action:'b2Officers',args:[{cls:'5'}]});
 assert.deepEqual(calls.map(c=>[c.action,c.args,c.role]),[['b2Officers',[{}],'ADMIN'],['b2Officers',[{}],'ADMIN'],['b2Officers',[{}],'ADMIN'],['b2Officers',[{cls:'5'}],'ADMIN']]);
 calls.length=0;
 // 담임: 반을 비우거나 남의 반을 보내도 자기 반(1반)
 for(const a of [[{}],[{cls:'all'}],[{cls:'9'}]])assert.equal((await call({action:'b2Officers',args:a},TEACHER)).statusCode,200);
 assert.deepEqual(calls.map(c=>[c.args,c.role,c.actor]),Array(3).fill([[{cls:'1'}],'TEACHER',TEACHER]));
 calls.length=0;
 const res=await call({action:'b2OfficerSave',args:[{cls:'9',role:'반장',name:'박서연',kind:'보궐',start:'2026-11-03',reason:'중도탈락',note:'',was:{name:'김동진',cls:'9'},row:2,by:'x',confirm:true}]},TEACHER);
 assert.equal(res.statusCode,200,'teachers may write (not admin-only)');
 assert.deepEqual(calls.at(-1).args,[{cls:'1',role:'반장',name:'박서연',kind:'보궐',start:'2026-11-03',reason:'중도탈락',note:'',was:{name:'김동진'}}]);
 await call({action:'b2OfficerEnd',args:[{cls:'3',role:'총무',end:'2026-11-05',reason:'사퇴',name:'x',was:{name:'고다원'}}]},TEACHER);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',role:'총무',end:'2026-11-05',reason:'사퇴',was:{name:'고다원'}}]);
 await call({action:'b2OfficerSave',args:[{cls:'5',role:'앰버서더',name:'가',kind:'최초',was:{name:''}}]});
 assert.deepEqual(calls.at(-1).args,[{cls:'5',role:'앰버서더',name:'가',kind:'최초',was:{name:''}}],'admins keep the class they chose');
 // 앰버서더 여러 명: 더하기의 was는 이름 배열(문자열로), 끝내기는 객체만(배열은 버림)
 await call({action:'b2OfficerSave',args:[{cls:'9',role:'앰버서더',name:'나',kind:'추가',start:'2026-11-05',was:['가',3,null]}]},TEACHER);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',role:'앰버서더',name:'나',kind:'추가',start:'2026-11-05',was:['가','3','']}]);
 await call({action:'b2OfficerSave',args:[{cls:'1',role:'앰버서더',name:'다',kind:'보궐',was:{name:'가',row:9}}]},TEACHER);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',role:'앰버서더',name:'다',kind:'보궐',was:{name:'가'}}]);
 await call({action:'b2OfficerSave',args:[{cls:'1',role:'앰버서더',name:'라',kind:'최초'}]},TEACHER);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',role:'앰버서더',name:'라',kind:'최초'}],'was may be omitted');
 await call({action:'b2OfficerEnd',args:[{cls:'1',role:'앰버서더',end:'2026-11-05',was:['가']}]},TEACHER);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',role:'앰버서더',end:'2026-11-05'}]);
 await call({action:'b2OfficerSave',args:[{cls:'1',role:'앰버서더',name:'마',kind:'추가',was:Array.from({length:30},(_,i)=>'n'+i)}]});
 assert.equal(calls.at(-1).args[0].was.length,20,'the names array is capped');
 const before=calls.length;
 assert.deepEqual([(await call({action:'b2OfficerSave',args:[{cls:'1',name:'가'}]})).body.code],['BAD_REQUEST'],'role is required');
 assert.deepEqual([(await call({action:'b2OfficerSave',args:[{cls:'18',role:'반장'}]})).body.code],['BAD_CLASS']);
 assert.deepEqual([(await call({action:'b2OfficerEnd',args:[{role:'반장',was:{name:'x'}}]})).body.code],['BAD_CLASS'],'admins must name the class');
 assert.equal(calls.length,before);
 const teacher={role:'TEACHER',classIds:['1','7']};
 assert.deepEqual(b2Args(teacher,'b2Officers',[{cls:'7'}]),[{cls:'7'}],'a temporary class is allowed');
});

/* ---------- 관리자 화면(index.html → 출결 › 반 임원) ---------- */
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const SDK_STUB=`
window.sdkWrites=[];const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...a)=>a;
export const getDoc=async ref=>snap(undefined),getDocFromServer=async ref=>snap(undefined);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=(ref,a,b,c)=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'n'});
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=`export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'${ADMIN_EMAIL}',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
async function adminSite(t,run,sheet=officerSheet()){
 backend(t,body=>{try{return {ok:true,data:sheet.handle(body)};}catch(e){return {ok:false,error:e.message};}});
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[],posts=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>{dialogs.push(d.message());void d.accept();});
 try{
  await page.clock.install({time:'2026-11-05T10:00:00+09:00'});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
    await handler({method:'POST',headers:{authorization:`Bearer tok:${ADMIN_EMAIL}`},body},res);
    return route.fulfill({status:res.statusCode,contentType:'application/json',body:JSON.stringify(res.body)});
   }
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test/');
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await run(page,posts,dialogs,sheet);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const roleRow=(page,role)=>page.locator(`[data-role="${role}"]`);
const writes=sheet=>sheet.writes.map(([k,p])=>[k,p]);

test('관리자: 출결 › 반 임원 — 전체 반 표, 보궐 필요 알림에서 보궐 지정, 빈 역할 최초 지정, 그사이 바뀌면 다시 읽기, 끝내기와 이력',async t=>{
 await adminSite(t,async(page,posts,dialogs,sheet)=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.getByRole('button',{name:'반 임원',exact:true}).click();
  await page.getByRole('heading',{name:'반 임원'}).waitFor();
  await page.locator('tr[data-cls="1"]').waitFor();
  assert.match(await page.locator('.admin-crumb').innerText(),/출결\s+›\s+반 임원/);
  assert.deepEqual(await page.locator('.o2 thead th').allInnerTexts(),['반','반장','부반장','총무','앰버서더','']);
  assert.match(await page.locator('tr[data-cls="1"]').innerText(),/김동진\s*최초\s*보궐 필요\s*10\/28\(수\)부터[\s\S]*없음[\s\S]*고다원\s*최초/);
  assert.match(await page.locator('tr[data-cls="2"]').innerText(),/이경수/);
  // 보궐 필요: 지금 반장인데 명부가 중도탈락
  const needs=page.locator('.o2-needs');
  assert.match(await needs.innerText(),/보궐 필요 1건[\s\S]*1반 반장 김동진 · 중도탈락 11\/2\(월\)/);
  await needs.getByRole('button',{name:'보궐 지정'}).click();
  const form=page.locator('[data-form]');await form.waitFor();
  assert.match(await form.innerText(),/1반 반장 교체 \(지금: 김동진\)/);
  assert.deepEqual([await form.locator('[data-f="kind"]').inputValue(),await form.locator('[data-f="reasonSel"]').inputValue(),await form.locator('[data-f="start"]').inputValue()],['보궐','중도탈락','2026-11-05']);
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  assert.deepEqual(await form.locator('[data-f="name"] option').allInnerTexts(),['이름 선택','고다원','박서연','이하늘','정민호','한별'],'재학 only, the leaving officer is not offered');
  await form.locator('[data-f="name"]').selectOption('박서연');await form.locator('[data-f="start"]').fill('2026-11-03');
  await form.getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1),['save',{cls:'1',role:'반장',name:'박서연',kind:'보궐',start:'2026-11-03',was:{name:'김동진'},reason:'중도탈락'}]);
  assert.equal(sheet.writes.at(-1)[2],'ADMIN');
  await page.waitForFunction(()=>/박서연/.test(document.querySelector('[data-role="반장"]')?.innerText||''));
  assert.match(await roleRow(page,'반장').innerText(),/박서연\s*보궐\s*11\/3\(화\)부터/);
  assert.equal(await page.locator('.o2-needs').count(),0,'no vacancy left');
  // 이력: 김동진 반장은 11/3에 끝나고 바뀐 사유 중도탈락
  await page.locator('details.o2-hist summary').click();
  assert.match(await page.locator('details.o2-hist summary').innerText(),/이력 3건/);
  assert.match(await page.locator('details.o2-hist tbody tr',{hasText:'김동진'}).innerText(),/반장\s*김동진\s*최초\s*10\/28\(수\) ~ 11\/3\(화\)\s*중도탈락/);
  // 빈 역할(부반장): 최초로 지정, was.name은 ''
  await roleRow(page,'부반장').getByRole('button',{name:'지정'}).click();
  assert.equal(await page.locator('[data-form] [data-f="kind"]').inputValue(),'최초');
  assert.equal(await page.locator('[data-form] [data-f="reasonSel"]').count(),0,'nobody to replace → no reason');
  await page.locator('[data-form] [data-f="name"]').selectOption('이하늘');await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1),['save',{cls:'1',role:'부반장',name:'이하늘',kind:'최초',start:'2026-11-05',was:{name:''}}]);
  assert.equal(await page.locator('details.o2-hist').getAttribute('open'),'','history stays open after a re-read');
  // 그사이 다른 사람이 총무를 정민호로 바꿈 → 저장 거절 → 새로 읽고 지금 임원을 다시 맞춤 → 다시 저장
  await roleRow(page,'총무').getByRole('button',{name:'교체'}).click();
  sheet.save({cls:'1',role:'총무',name:'정민호',kind:'보궐',start:'2026-11-04',reason:'사퇴',was:{name:'고다원'}},'teacher@test.kr');
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  await page.locator('[data-form] [data-f="name"]').selectOption('한별');await page.locator('[data-form] [data-f="reasonSel"]').selectOption('사퇴');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.waitForFunction(()=>/그사이/.test(document.querySelector('[data-form] [data-err]')?.textContent||''));
  assert.equal(await page.locator('[data-form] [data-err]').innerText(),'그사이 다른 사람이 총무을(를) 바꿨습니다. 새로 읽었으니 지금 임원(정민호)을 확인하고 다시 저장해 주세요.');
  assert.match(await roleRow(page,'총무').innerText(),/정민호\s*보궐/,'the screen shows the new holder');
  assert.match(await page.locator('[data-form]').innerText(),/교체 \(지금: 정민호\)/);
  assert.equal(await page.locator('[data-form] [data-f="name"]').inputValue(),'한별','typed values are kept');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1),['save',{cls:'1',role:'총무',name:'한별',kind:'보궐',start:'2026-11-05',was:{name:'정민호'},reason:'사퇴'}]);
  assert.match(await roleRow(page,'총무').innerText(),/한별\s*보궐/);
  // 끝내기: 2반 반장, 후임 없이
  await page.locator('#o2Class').selectOption('2');
  await roleRow(page,'반장').getByRole('button',{name:'끝내기'}).click();
  await page.locator('[data-form] [data-f="reasonSel"]').selectOption('기타');await page.locator('[data-form] [data-f="reasonText"]').fill('본인 요청');
  await page.locator('[data-form]').getByRole('button',{name:'끝내기'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.match(dialogs.at(-1),/2반 반장 이경수 님을 11\/5\(목\)에 끝낼까요\?/);
  assert.deepEqual(writes(sheet).at(-1),['end',{cls:'2',role:'반장',end:'2026-11-05',was:{name:'이경수'},reason:'본인 요청'}]);
  assert.match(await roleRow(page,'반장').innerText(),/없음/);
  await roleRow(page,'반장').getByRole('button',{name:'지정'}).click();
  assert.equal(await page.locator('[data-form] [data-f="kind"]').inputValue(),'보궐','vacant after an end → 보궐 suggested');
  await page.getByRole('button',{name:'전체 반 보기'}).click();
  assert.match(await page.locator('tr[data-cls="1"]').innerText(),/박서연\s*보궐[\s\S]*이하늘\s*최초[\s\S]*한별\s*보궐/);
  assert.ok(posts.filter(p=>p.action==='b2Officers').length>=4);
 });
});

test('관리자: 앰버서더 여러 명 — 사람마다 보궐 필요·교체(보궐)·끝내기, 앰버서더 추가(was 배열), 그사이 바뀌면 다시 읽기, 10명이면 추가 막힘',async t=>{
 const sheet=officerSheet();
 sheet.roster.push(['1','윤가람','재학',''],['1','오세린','재학',''],['1','서지우','조기취업','2026-11-04']);
 sheet.rows.push(sheet.R(5,'1',AMB,'이하늘','최초','2026-10-28'),sheet.R(6,'1',AMB,'한별','추가','2026-10-30'),sheet.R(7,'1',AMB,'서지우','최초','2026-10-28'));
 await adminSite(t,async(page,posts,dialogs)=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.getByRole('button',{name:'반 임원',exact:true}).click();
  await page.locator('tr[data-cls="1"]').waitFor();
  assert.match(await page.locator('tr[data-cls="1"] [data-role-cell="앰버서더"]').innerText(),/이하늘\s*최초[\s\S]*한별\s*추가[\s\S]*서지우\s*최초\s*보궐 필요/);
  assert.match(await page.locator('tr[data-cls="2"] [data-role-cell="앰버서더"]').innerText(),/없음/);
  const needs=page.locator('.o2-needs');
  assert.match(await needs.innerText(),/보궐 필요 2건[\s\S]*1반 앰버서더 서지우 · 조기취업 11\/4\(수\)/);
  // 서지우 보궐: 누구 대신이 서지우로 정해지고, 지금 앰버서더는 이름 목록에 없음
  await needs.locator('li',{hasText:'서지우'}).getByRole('button',{name:'보궐 지정'}).click();
  const form=page.locator('[data-form]');await form.waitFor();
  assert.match(await form.innerText(),/1반 앰버서더 교체\(보궐\) · 서지우 대신/);
  assert.deepEqual(await form.locator('[data-f="kind"] option').allInnerTexts(),['최초','추가','보궐']);
  assert.deepEqual([await form.locator('[data-f="kind"]').inputValue(),await form.locator('[data-f="was"]').inputValue(),await form.locator('[data-f="reasonSel"]').inputValue()],['보궐','서지우','조기취업']);
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  assert.deepEqual(await form.locator('[data-f="name"] option').allInnerTexts(),['이름 선택','고다원','박서연','정민호','윤가람','오세린'],'재학, not already an ambassador');
  await form.locator('[data-f="name"]').selectOption('윤가람');
  await form.getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1),['save',{cls:'1',role:AMB,name:'윤가람',kind:'보궐',start:'2026-11-05',was:{name:'서지우'},reason:'조기취업'}]);
  await page.waitForFunction(()=>/윤가람/.test(document.querySelector('[data-role="앰버서더"]')?.innerText||''));
  const amb=roleRow(page,AMB),person=n=>amb.locator(`[data-name="${n}"]`);
  assert.deepEqual(await amb.locator('[data-name]').evaluateAll(els=>els.map(e=>e.dataset.name)),['이하늘','한별','윤가람']);
  assert.match(await amb.locator('.o2-role > b').innerText(),/앰버서더\s*3명/);
  assert.match(await person('윤가람').innerText(),/윤가람\s*보궐\s*11\/5\(목\)부터/);
  assert.match(await page.locator('.o2-needs').innerText(),/보궐 필요 1건[\s\S]*반장 김동진/,'only the class president is left');
  // 앰버서더 추가: 구분 추가, 대신할 사람·사유 없음, was는 지금 이름 배열
  await amb.getByRole('button',{name:'앰버서더 추가'}).click();
  assert.match(await page.locator('[data-form]').innerText(),/1반 앰버서더 추가 \(지금 3명, 10명까지\)/);
  assert.equal(await page.locator('[data-form] [data-f="kind"]').inputValue(),'추가');
  assert.deepEqual([await page.locator('[data-form] [data-f="was"]').count(),await page.locator('[data-form] [data-f="reasonSel"]').count()],[0,0]);
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  await page.locator('[data-form] [data-f="name"]').selectOption('오세린');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1),['save',{cls:'1',role:AMB,name:'오세린',kind:'추가',start:'2026-11-05',was:['이하늘','한별','윤가람']}]);
  await page.waitForFunction(()=>document.querySelectorAll('[data-role="앰버서더"] [data-name]').length===4);
  // 그사이 다른 사람이 정민호를 더함 → 거절 → 새로 읽고 지금 앰버서더를 보여 줌 → 다시 저장하면 새 배열
  await amb.getByRole('button',{name:'앰버서더 추가'}).click();
  sheet.save({cls:'1',role:AMB,name:'정민호',kind:'추가',start:'2026-11-05'},'teacher@test.kr');
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  await page.locator('[data-form] [data-f="name"]').selectOption('박서연');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.waitForFunction(()=>/그사이/.test(document.querySelector('[data-form] [data-err]')?.textContent||''));
  assert.equal(await page.locator('[data-form] [data-err]').innerText(),'그사이 다른 사람이 앰버서더을(를) 바꿨습니다. 새로 읽었으니 지금 임원(이하늘, 한별, 윤가람, 오세린, 정민호)을 확인하고 다시 저장해 주세요.');
  assert.equal(await page.locator('[data-form] [data-f="name"]').inputValue(),'박서연','typed values are kept');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1)[1].was,['이하늘','한별','윤가람','오세린','정민호']);
  // 한 사람 끝내기(한별)
  await page.waitForFunction(()=>document.querySelectorAll('[data-role="앰버서더"] [data-name]').length===6);
  await person('한별').getByRole('button',{name:'끝내기'}).click();
  assert.match(await page.locator('[data-form]').innerText(),/1반 앰버서더 한별 끝내기 · 후임 없이 끝내면 반정보 칸에서 빠집니다/);
  await page.locator('[data-form] [data-f="reasonSel"]').selectOption('사퇴');
  await page.locator('[data-form]').getByRole('button',{name:'끝내기'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.match(dialogs.at(-1),/1반 앰버서더 한별 님을 11\/5\(목\)에 끝낼까요\?\n후임 없이 끝내면 반정보의 앰버서더 칸에서 빠집니다/);
  assert.deepEqual(writes(sheet).at(-1),['end',{cls:'1',role:AMB,end:'2026-11-05',was:{name:'한별'},reason:'사퇴'}]);
  await page.waitForFunction(()=>!document.querySelector('[data-role="앰버서더"] [data-name="한별"]'));
  // 이하늘 교체(보궐): 구분을 추가로 바꾸면 대신할 사람·사유가 빠지고, 다시 보궐이면 누구 대신을 골라야 함
  await person('이하늘').getByRole('button',{name:'교체(보궐)'}).click();
  assert.equal(await page.locator('[data-form] [data-f="was"]').inputValue(),'이하늘');
  await page.locator('[data-form] [data-f="kind"]').selectOption('추가');
  assert.deepEqual([await page.locator('[data-form] [data-f="was"]').count(),await page.locator('[data-form] [data-f="reasonSel"]').count()],[0,0]);
  await page.locator('[data-form] [data-f="kind"]').selectOption('보궐');
  assert.equal(await page.locator('[data-form] [data-f="was"]').inputValue(),'','several ambassadors → choose whom');
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  await page.locator('[data-form] [data-f="name"]').selectOption('고다원');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  assert.equal(await page.locator('[data-form] [data-err]').innerText(),'누구 대신(보궐)인지 골라 주세요.');
  await page.locator('[data-form] [data-f="was"]').selectOption('이하늘');
  assert.match(await page.locator('[data-form]').innerText(),/교체\(보궐\) · 이하늘 대신/);
  assert.equal(await page.locator('[data-form] [data-f="name"]').inputValue(),'고다원');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(writes(sheet).at(-1),['save',{cls:'1',role:AMB,name:'고다원',kind:'보궐',start:'2026-11-05',was:{name:'이하늘'}}]);
  await page.waitForFunction(()=>document.querySelector('[data-role="앰버서더"] [data-name="고다원"]'));
  // 10명이면 추가 막힘(교체는 됨)
  const now=sheet.view('1').current['1'][AMB].length;
  for(let i=now;i<AMB_MAX;i++)sheet.rows.push(sheet.R(100+i,'1',AMB,'가상'+i,'추가','2026-11-05'));
  sheet.rev++;
  await page.locator('#o2Reload').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-role="앰버서더"] [data-name]').length===10);
  assert.equal(await amb.getByRole('button',{name:'앰버서더 추가'}).isDisabled(),true);
  assert.equal(await person('가상9').getByRole('button',{name:'교체(보궐)'}).isDisabled(),false);
  // 반 고르기를 전체로: 표 칸에 모두
  await page.getByRole('button',{name:'전체 반 보기'}).click();
  assert.equal(await page.locator('tr[data-cls="1"] [data-role-cell="앰버서더"] .o2-one').count(),10);
  assert.ok(posts.filter(p=>p.action==='b2Officers').length>=6);
 },sheet);
});

/* ---------- 클라이언트(beta2-data.mjs, 브라우저에서): 변경 번호가 같으면 다시 읽지 않음, 쓰고 나면 버림 ---------- */
test('client.officers caches by class and rev; writes drop the cache even when the sheet refuses',async t=>{
 await adminSite(t,async(page,posts)=>{
  const out=await page.evaluate(async()=>{
   const {createBeta2Client}=await import('/beta2-data.mjs');
   const client=createBeta2Client({getIdToken:async()=>'tok-1'}),seen=[];
   const real=window.fetch;window.fetch=async(u,init)=>{if(String(u).includes('/api/teacher-beta'))seen.push(JSON.parse(init.body).action);return real(u,init);};
   const a=await client.officers({cls:'1'}),b=await client.officers({cls:'1'});const same=a===b;
   await client.officers({cls:'1'},{maxAge:0});const afterRev=[...seen];
   await client.officerSave({cls:'1',role:'부반장',name:'한별',kind:'최초',was:{name:''}});
   const c=await client.officers({cls:'1'});
   let refused='';try{await client.officerEnd({cls:'1',role:'총무',was:{name:'다른사람'}});}catch(e){refused=e.message;}
   await client.officers({cls:'1'});
   window.fetch=real;
   return {same,afterRev,seen,vice:c.current['1']['부반장'].name,refused};
  });
  assert.equal(out.same,true);
  assert.deepEqual(out.afterRev,['b2Officers','b2Rev'],'same rev → no re-read');
  assert.equal(out.vice,'한별');
  assert.match(out.refused,/그사이 바뀌었습니다/);
  assert.deepEqual(out.seen.slice(2),['b2OfficerSave','b2Officers','b2OfficerEnd','b2Officers'],'every write (also a refused one) drops the cache');
 });
});

/* ---------- 담임 화면(우리 반 탭): 예전 portalSaveOfficer 칸 대신 반 임원 카드 ---------- */
test('담임: 우리 반 탭 맨 위에 반 임원(자기 반만), 예전 임원 저장 칸은 없음, 지정하면 b2OfficerSave',async()=>{
 const sheet=officerSheet();
 sheet.roster=PORTAL.kids.map(k=>['1',k.name,'재학','']);
 sheet.rows=[{row:2,cls:'1',role:'반장',name:'가상학생가',kind:'최초',start:'2026-10-28',end:'',reason:'',note:'',by:'teacher@test.kr',at:''}];
 const api=body=>['b2Officers','b2OfficerSave','b2OfficerEnd'].includes(body.action)?sheet.handle({...body,role:'TEACHER',actor:TEACHER}):null;
 const errors=await openPortal(async(page,posts)=>{
  const card=page.locator('.o2-cls');await card.waitFor();
  await page.getByText('교육생 명부 (3명)').waitFor();
  assert.equal(await page.getByRole('button',{name:'임원 저장'}).count(),0,'old officer form is gone');
  assert.equal(await page.locator('#o_l').count(),0);
  assert.equal(await page.locator('#o2Class').count(),0,'no class picker for teachers');
  assert.match(await card.innerText(),/반 임원[\s\S]*반장\s*가상학생가\s*최초[\s\S]*부반장\s*없음[\s\S]*앰버서더\s*없음/);
  assert.deepEqual(posts.filter(p=>p.action==='b2Officers').map(p=>p.args),[[{cls:'1'}]]);
  await roleRow(page,'부반장').getByRole('button',{name:'지정'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
  await page.locator('[data-form] [data-f="name"]').selectOption('가상학생나');
  await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(posts.filter(p=>p.action==='b2OfficerSave').map(p=>p.args),[[{cls:'1',role:'부반장',name:'가상학생나',kind:'최초',start:'2026-10-29',was:{name:''}}]]);
  assert.match(await roleRow(page,'부반장').innerText(),/가상학생나\s*최초/);
  // 앰버서더 여러 명(자기 반): 처음은 최초(was 빈 배열), 다음은 추가(was 지금 이름)
  for(const [who,kind,was] of [['가상학생나','최초',[]],['가상학생다','추가',['가상학생나']]]){
   await roleRow(page,AMB).getByRole('button',{name:'앰버서더 추가'}).click();
   assert.equal(await page.locator('[data-form] [data-f="kind"]').inputValue(),kind);
   await page.waitForFunction(()=>document.querySelectorAll('[data-form] [data-f="name"] option').length>1);
   await page.locator('[data-form] [data-f="name"]').selectOption(who);
   await page.locator('[data-form]').getByRole('button',{name:'저장'}).click();
   await page.locator('[data-form]').waitFor({state:'detached'});
   assert.deepEqual(posts.filter(p=>p.action==='b2OfficerSave').at(-1).args,[{cls:'1',role:AMB,name:who,kind,start:'2026-10-29',was}]);
   await page.waitForFunction(n=>document.querySelector(`[data-role="앰버서더"] [data-name="${n}"]`),who);
  }
  assert.match(await roleRow(page,AMB).innerText(),/앰버서더\s*2명[\s\S]*가상학생나\s*최초[\s\S]*가상학생다\s*추가/);
  assert.equal(posts.some(p=>p.action==='portalSaveOfficer'),false);
 },{api,path:'/#t/info'});
 assert.deepEqual(errors,[]);
});
