import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import handler,{b2Args,FIREBASE,ACCESS} from '../../api/teacher-beta.js';
import {dayTimesOf,dayText,ruleFromDayTimes,rememberDayTimes,forgetDayTimes,dayRule,ruleOn,loadDayTimes,checkModuleTime,cleanTime,DAY_DEFAULTS} from '../../beta2-daytimes.mjs';
import {compareCheckHere,checkRosterStatus,decodeBundle,ROSTER_STATUS} from '../../beta2-core.mjs';

// 2기 관리자 도구(사용자 요청 2026-10-19 ④ 교육시간 조정 · ⑦ 교육생 상태)와 그날 교육시간 기준 판정. 학생·담임은 모두 가상입니다.
const base=join(import.meta.dirname,'../..');

/* ---------- 그날 기준 계산·판정(beta2-daytimes.mjs, beta2-core compareCheckHere) ---------- */
const M=(row,date,cls,module,start,end,part='')=>({row,date,cls,module,start,end,part,reason:'',by:'',at:''});

test('the day rule is the earliest start to the latest end of the timed rows for that class and day, with 10 minutes of grace',()=>{
 const rows=[M(5,'2026-11-13','1','공장견학','10:00','17:00'),M(6,'2026-11-13','1','안전교육','',''),M(7,'2026-11-13','2','공장견학','10:30','16:00'),
  M(8,'2026-11-20','3','분해조립','09:30','16:00'),M(9,'2026-11-20','3','분해조립','13:00','17:30','오후 실습'),M(10,'2026-11-20','3','실차체험','11:00','10:00')];
 const field=dayTimesOf(rows,'2026-11-13','1');
 assert.deepEqual({...field,modules:field.modules.map(m=>m.row)},{date:'2026-11-13',cls:'1',start:'10:00',end:'17:00',lateAfter:'10:10',earlyBefore:'16:50',source:'현장교육 일정',modules:[5]},'rows without times do not count');
 assert.equal(dayText(field),'10:00~17:00 · 지각 기준 10:10 · 조퇴 기준 16:50');
 const parts=dayTimesOf(rows,'2026-11-20','3');
 assert.deepEqual([parts.start,parts.end,parts.lateAfter,parts.earlyBefore],['09:30','17:30','09:40','17:20'],'a part of a module (13:00~17:30) can stretch the day; an end before the start is ignored');
 const plain=dayTimesOf(rows,'2026-11-13','4');
 assert.deepEqual([plain.start,plain.end,plain.lateAfter,plain.earlyBefore,plain.source],['09:00','18:00','09:10','17:50','기본']);
 assert.deepEqual(DAY_DEFAULTS.field,['10:00','17:00'],'공장견학 default (user decision 2026-10-19)');
});

test('a b2DayTimes answer becomes a judging rule, and bad answers fall back to the defaults',()=>{
 const r=ruleFromDayTimes({date:'2026-11-13',cls:'1',start:'10:00',end:'17:00',lateAfter:'10:10',earlyBefore:'16:50',source:'현장교육 일정'});
 assert.deepEqual([r.start,r.end,r.entryGrace,r.exitGrace,r.excursion,r.source,r.lateAfter,r.earlyBefore],['10:00','17:00',10,10,true,'현장교육 일정','10:10','16:50']);
 const wide=ruleFromDayTimes({start:'09:00',end:'18:00',lateAfter:'09:15',earlyBefore:'17:45',source:'기본'});
 assert.deepEqual([wide.entryGrace,wide.exitGrace,wide.excursion],[15,15,false],'grace is read back from lateAfter/earlyBefore');
 for(const bad of [null,{},{start:'10:00'},{start:'10:00',end:'09:00'},{start:'25:00',end:'26:00'}])assert.equal(ruleFromDayTimes(bad),null,JSON.stringify(bad));
 forgetDayTimes();
 assert.equal(ruleOn('2026-11-13',{classId:'1'}).start,'09:00','nothing remembered → cohort default');
 assert.equal(ruleOn('2026-11-13',{classId:'1',excursion:true}).start,'10:00','cohort excursion fallback still works');
});

test('CheckHere comparison uses the remembered day rule: 10:05 is on time on a field day, 10:15 and 16:45 are not',()=>{
 forgetDayTimes();
 const rec=(entry,exit,o={})=>({classId:'1',date:'2026-11-13',entry,exit,outings:[],...o}),opt={today:'2026-11-20',date:'2026-11-13'};
 assert.equal(compareCheckHere('출석',null,rec('10:05:00','17:00:00'),opt).text,'체크히어 지각 10:05 · 체크히어 조퇴 17:00','before the day rule is known the usual 09:00~18:00 applies');
 rememberDayTimes({date:'2026-11-13',cls:'1',start:'10:00',end:'17:00',lateAfter:'10:10',earlyBefore:'16:50',source:'현장교육 일정'});
 assert.deepEqual(compareCheckHere('출석',null,rec('10:05:00','17:00:00'),opt),{state:'ok',text:'일치'});
 assert.deepEqual(compareCheckHere('출석',null,rec('10:10:59','16:50:00'),opt),{state:'ok',text:'일치'},'10:10 and 16:50 are the edges');
 assert.deepEqual(compareCheckHere('출석',null,rec('10:15:00','17:00:00'),opt),{state:'diff',text:'체크히어 지각 10:15 (그날 기준 10:00~17:00)'});
 assert.deepEqual(compareCheckHere('출석',null,rec('10:00:00','16:45:00'),opt),{state:'diff',text:'체크히어 조퇴 16:45 (그날 기준 10:00~17:00)'});
 assert.deepEqual(compareCheckHere('지각',{inT:'10:20'},rec('10:20:00','17:00:00'),opt),{state:'ok',text:'일치'});
 assert.match(compareCheckHere('지각',null,rec('10:08:00','17:00:00'),opt).text,/체크히어 입실 10:08 · 지각 아님/);
 assert.equal(compareCheckHere('출석',null,rec('10:05:00','17:00:00',{classId:'2'}),opt).state,'diff','another class keeps its own rule');
 assert.equal(compareCheckHere('출석',null,rec('10:05:00','18:00:00'),{...opt,rule:ruleFor0900()}).text,'체크히어 지각 10:05','an explicit rule wins');
 // 출결대조처럼 오늘·진행 중이면 그날 끝(17:00) 전까지는 퇴실 없음을 기다립니다
 assert.equal(compareCheckHere('출석',null,rec('10:05:00',null),{today:'2026-11-13',date:'2026-11-13',now:16*3600}).state,'pending');
 forgetDayTimes('1','2026-11-13');assert.equal(dayRule('1','2026-11-13'),null);
});
const ruleFor0900=()=>ruleFromDayTimes({start:'09:00',end:'18:00',lateAfter:'09:10',earlyBefore:'17:50',source:'기본'});

test('loadDayTimes asks once per class and day, shares one request, retries a failure after a minute and keeps the defaults meanwhile',async()=>{
 forgetDayTimes();let t=0;const now=()=>t,calls=[];let fail=false;
 const client={call:async(action,p)=>{calls.push([action,p]);await null;if(fail)throw Error('마스터시트 응답이 늦습니다.');return {date:p.date,cls:p.cls,start:'10:00',end:'17:00',lateAfter:'10:10',earlyBefore:'16:50',source:'현장교육 일정',modules:[]};}};
 const [a,b]=await Promise.all([loadDayTimes(client,'1','2026-11-13',{now}),loadDayTimes(client,1,'2026-11-13',{now})]);
 assert.deepEqual([a,b,calls.length],[true,true,1],'two screens asking at once share one call');
 assert.deepEqual(calls[0],['b2DayTimes',{date:'2026-11-13',cls:'1'}]);
 assert.equal(dayRule('1','2026-11-13').start,'10:00');
 t=5*60000;assert.equal(await loadDayTimes(client,'1','2026-11-13',{now}),false);assert.equal(calls.length,1,'cached for 10 minutes');
 assert.equal(await loadDayTimes(client,'1','2026-11-13',{now,fresh:true}),false,'same rule → nothing to redraw');assert.equal(calls.length,2);
 fail=true;t=30*60000;assert.equal(await loadDayTimes(client,'1','2026-11-13',{now}),false,'a failed refresh keeps the rule it had');assert.equal(dayRule('1','2026-11-13').start,'10:00');
 assert.equal(await loadDayTimes(client,'2','2026-11-13',{now}),false);assert.equal(dayRule('2','2026-11-13'),null,'never read → defaults');
 assert.equal(ruleOn('2026-11-13',{classId:'2'}).start,'09:00');
 const n=calls.length;t+=30000;await loadDayTimes(client,'2','2026-11-13',{now});assert.equal(calls.length,n,'no retry within a minute');
 fail=false;t+=31000;assert.equal(await loadDayTimes(client,'2','2026-11-13',{now}),true);assert.equal(dayRule('2','2026-11-13').start,'10:00');
 for(const [c,d] of [['18','2026-11-13'],['0','2026-11-13'],['1','11/13'],['1','']])assert.equal(await loadDayTimes(client,c,d,{now}),false);
 assert.equal(await loadDayTimes(null,'1','2026-11-14'),false);
 assert.equal(calls.length,n+1,'bad class or date never reaches the sheet');
 forgetDayTimes();
});

test('module-time input is checked before it is sent: HH:mm inside 08:00~20:00, start before end, course dates, reason when editing',()=>{
 const ok={date:'2026-11-13',cls:'1',module:'공장견학',start:'10:00',end:'17:00',part:'',reason:''};
 assert.equal(checkModuleTime(ok),'');
 assert.equal(checkModuleTime(ok,{existing:true}),'시간을 고칠 때는 사유를 적어 주세요. (예: HRD 확정 전 임시)');
 assert.equal(checkModuleTime({...ok,reason:'HRD 확정 전 임시'},{existing:true}),'');
 const cases=[[{date:''},'날짜를 골라 주세요.'],[{date:'2026-10-20'},'2기 교육 기간(10/28~1/22) 안의 날짜를 골라 주세요.'],[{cls:'18'},'반을 골라 주세요.'],[{module:' '},'모듈 이름을 적어 주세요.'],
  [{module:'가'.repeat(61)},'모듈 이름은 60자 이하로 적어 주세요.'],[{start:'열시'},'시작·끝 시간은 10:00처럼 넣어 주세요.'],[{end:''},'시작·끝 시간은 10:00처럼 넣어 주세요.'],[{start:'07:30'},'교육시간은 08:00~20:00 안에서 정해 주세요.'],
  [{end:'20:30'},'교육시간은 08:00~20:00 안에서 정해 주세요.'],[{start:'17:00',end:'10:00'},'끝 시간이 시작보다 늦어야 합니다.'],[{start:'10:00',end:'10:00'},'끝 시간이 시작보다 늦어야 합니다.'],[{part:'가'.repeat(61)},'구간은 60자 이하로 적어 주세요.'],[{reason:'가'.repeat(201)},'사유는 200자 이하로 적어 주세요.']];
 for(const [change,text] of cases)assert.equal(checkModuleTime({...ok,...change}),text,JSON.stringify(change));
 assert.equal(checkModuleTime({...ok,start:'9:30',end:'1500'}),'','9:30 and 1500 are read as 09:30 and 15:00');
 assert.deepEqual(['9:05','0930','09:30:00',' 13:00 ','24:00','x'].map(cleanTime),['09:05','09:30','09:30','13:00','24:00','x']);
});

test('student status input: one of 재학·중도탈락·조기취업·수료, a last attendance day unless 재학, and the roster keeps the sheet reason when sent',()=>{
 assert.deepEqual([...ROSTER_STATUS],['재학','중도탈락','조기취업','수료']);
 assert.equal(checkRosterStatus({status:'재학'}),'');
 assert.equal(checkRosterStatus({status:'중도탈락',changed:'2026-11-10',reason:'개인 사정'}),'');
 assert.equal(checkRosterStatus({status:'중도포기',changed:'2026-11-10'}),'상태는 재학·중도탈락·조기취업·수료 가운데 하나를 골라 주세요.');
 assert.equal(checkRosterStatus({status:'조기취업'}),'마지막 출석일을 넣어 주세요.');
 assert.equal(checkRosterStatus({status:'수료',changed:'11/10'}),'마지막 출석일을 날짜로 넣어 주세요.');
 assert.equal(checkRosterStatus({status:'수료',changed:'2027-02-01'}),'마지막 출석일은 2기 교육 기간(10/28~1/22) 안이어야 합니다.');
 assert.equal(checkRosterStatus({status:'중도탈락',changed:'2026-11-10',reason:'가'.repeat(201)}),'사유는 200자 이하로 적어 주세요.');
 const b=decodeBundle({roster:[['1','가','중도탈락','2026-11-10','취업'],['1','나','재학','']]});
 assert.deepEqual(b.roster.map(p=>[p.status,p.changed,p.reason]),[['중도탈락','2026-11-10','취업'],['재학','','']]);
});

/* ---------- Vercel 중계(api/teacher-beta.js) ---------- */
const SHEET='https://script.test/exec',KEY='secret-key-123',ADMIN_EMAIL='hint.kpc@gmail.com';
const PROFILES={'teacher@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'},tempClassIds:{arrayValue:{values:[{stringValue:'7'}]}}}};
function backend(t,{sheet=body=>Response.json({ok:true,data:{rows:[],echo:body.args}})}={}){
 const calls=[],saved={...FIREBASE},access=ACCESS.teacher,env={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 Object.assign(FIREBASE,{ready:true,key:'fb-key',project:'hint-test'});process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY=KEY;
 t.after(()=>{Object.assign(FIREBASE,saved);ACCESS.teacher=access;for(const [k,v] of [['HINT_SHEET_API_URL',env.url],['HINT_SHEET_API_KEY',env.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return Response.json({users:[{email:idToken.slice(4)}]});}
  if(url.startsWith('https://firestore.googleapis.com/')){const email=decodeURIComponent(url.split('/users/')[1]);return PROFILES[email]?Response.json({fields:PROFILES[email]}):Response.json({},{status:404});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push(body);return sheet(body);}
  throw Error('unexpected fetch '+url);
 });
 return calls;
}
async function call(body,email=ADMIN_EMAIL){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);return res;
}

test('administrators reach every new action with the verified e-mail; class numbers are checked on the server',async t=>{
 const calls=backend(t);
 let res=await call({action:'b2ModuleTimes',args:[{cls:'all',from:'2026-10-28',to:'2027-01-22'}]});
 assert.equal(res.statusCode,200);assert.deepEqual(calls.at(-1),{key:KEY,action:'b2ModuleTimes',args:[{from:'2026-10-28',to:'2027-01-22'}],actor:ADMIN_EMAIL,role:'ADMIN'},'all classes = no cls');
 await call({action:'b2ModuleTimes',args:[{cls:'3'}]});assert.deepEqual(calls.at(-1).args,[{cls:'3'}]);
 await call({action:'b2DayTimes',args:[{date:'2026-11-13',cls:'1'}]});assert.deepEqual(calls.at(-1).args,[{date:'2026-11-13',cls:'1'}]);
 const save={row:5,date:'2026-11-13',cls:'1',module:'공장견학',start:'10:00',end:'17:00',part:'',reason:'견학 업체 일정'};
 await call({action:'b2ModuleTimeSave',args:[save]});assert.deepEqual(calls.at(-1).args,[save]);
 await call({action:'b2RosterStatus',args:[{cls:'2',name:'가상',status:'중도탈락',changed:'2026-11-10',reason:'개인 사정'}]});assert.equal(calls.at(-1).args[0].cls,'2');
 await call({action:'b2LedgerMemo',args:[{cls:'4',name:'가상',date:'2026-11-13',memo:'수기 확인'}]});assert.deepEqual([calls.at(-1).action,calls.at(-1).role],['b2LedgerMemo','ADMIN']);
 await call({action:'b2LedgerMemos',args:[{}]});assert.deepEqual(calls.at(-1).args,[{}]);
 const before=calls.length;
 for(const [action,arg] of [['b2DayTimes',{date:'2026-11-13'}],['b2ModuleTimeSave',{...save,cls:'18'}],['b2RosterStatus',{name:'가'}],['b2LedgerMemo',{cls:'0'}],['b2ModuleTimes',{cls:'99'}]]){
  res=await call({action,args:[arg]});assert.deepEqual([res.statusCode,res.body.code],[400,'BAD_CLASS'],action);
 }
 assert.equal(calls.length,before,'bad class numbers never reach the sheet');
 t.mock.restoreAll();backend(t,{sheet:()=>Response.json({ok:false,error:'unknown action'})});
 res=await call({action:'b2DayTimes',args:[{date:'2026-11-13',cls:'1'}]});assert.deepEqual([res.statusCode,res.body.code],[400,'SHEET_OUTDATED']);
 t.mock.restoreAll();backend(t,{sheet:()=>Response.json({ok:false,error:'끝 시간이 시작보다 늦어야 합니다.'})});
 res=await call({action:'b2ModuleTimeSave',args:[{...save,end:'09:00'}]});assert.deepEqual([res.statusCode,res.body],[400,{ok:false,error:'끝 시간이 시작보다 늦어야 합니다.'}]);
});

test('teachers read module times, day rules and ledger memos only for their own class and can never write them',async t=>{
 const calls=backend(t);
 ACCESS.teacher=false;
 assert.equal((await call({action:'b2DayTimes',args:[{date:'2026-11-13',cls:'3'}]},'teacher@test.kr')).body.code,'ADMIN_ONLY','closed until teacher access opens');
 ACCESS.teacher=true;
 for(const [action,arg,want] of [['b2ModuleTimes',{cls:'9',from:'2026-11-01'},{cls:'3',from:'2026-11-01'}],['b2ModuleTimes',{},{cls:'3'}],['b2ModuleTimes',{cls:'all'},{cls:'3'}],['b2DayTimes',{date:'2026-11-13',cls:'7'},{date:'2026-11-13',cls:'7'}],
  ['b2DayTimes',{date:'2026-11-13',cls:'1'},{date:'2026-11-13',cls:'3'}],['b2LedgerMemos',{},{cls:'3'}],['b2LedgerMemos',{cls:'5',from:'2026-11-01'},{cls:'3',from:'2026-11-01'}]]){
  const res=await call({action,args:[arg]},'teacher@test.kr');
  assert.equal(res.statusCode,200,action);assert.deepEqual([calls.at(-1).args,calls.at(-1).role],[[want],'TEACHER'],`${action} ${JSON.stringify(arg)}`);
 }
 const before=calls.length;
 for(const action of ['b2ModuleTimeSave','b2RosterStatus','b2LedgerMemo']){
  const res=await call({action,args:[{cls:'3',name:'가',date:'2026-11-13',start:'10:00',end:'17:00',module:'공장견학',status:'재학',memo:'x'}]},'teacher@test.kr');
  assert.deepEqual([res.statusCode,res.body.code],[403,'ADMIN_ONLY'],action);
 }
 assert.equal(calls.length,before,'teacher writes never reach the sheet');
 const teacher={role:'TEACHER',classIds:['3','7']},admin={role:'ADMIN',classIds:[]};
 assert.deepEqual(b2Args(teacher,'b2ModuleTimes',[]),[{cls:'3'}]);
 assert.deepEqual(b2Args(admin,'b2ModuleTimes',[]),[{}]);
 assert.deepEqual(b2Args(admin,'b2LedgerMemos',[{cls:'',to:'2026-12-01'}]),[{to:'2026-12-01'}]);
 assert.throws(()=>b2Args(admin,'b2DayTimes',[{date:'2026-11-13'}]),/BAD_CLASS/);
});

/* ---------- 화면(index.html → beta2-admin.mjs → beta2-times.mjs·beta2-roster.mjs·beta2-ledger.mjs) ---------- */
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const SDK_STUB=`
window.sdkWrites=[];const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts';
export const getDoc=async ref=>snap(undefined),getDocFromServer=async ref=>snap((window.CH_DAYS||{})[ref.path]);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=(ref,a,b,c)=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'n'});
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=`export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'${ADMIN_EMAIL}',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};

// 가짜 마스터시트: 현장교육 일정 줄·명부를 들고 저장하면 그대로 고칩니다(Apps Script와 같은 응답 모양).
function fakeSheet(){
 const s={rev:5,today:'2026-11-13',days:['2026-11-12','2026-11-13'],
  modules:[{row:5,date:'2026-11-13',cls:'1',module:'공장견학',start:'10:00',end:'17:00',part:'',reason:'견학 업체 일정',by:'hint.kpc@gmail.com',at:'2026-10-19 10:00'},
   {row:6,date:'2026-11-13',cls:'1',module:'안전교육',start:'',end:'',part:'',reason:'',by:'',at:''},{row:7,date:'2026-11-20',cls:'2',module:'분해조립',start:'',end:'',part:'',reason:'',by:'',at:''}],
  roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','한수빈','중도탈락','2026-11-02','개인 사정'],['2','이경수','재학','']]};
 const day=(date,cls)=>{const d=dayTimesOf(s.modules,date,cls);return d;};
 s.handle=body=>{
  const p=body.args?.[0]||{};
  if(body.action==='b2Bundle')return {rev:s.rev,today:s.today,days:s.days,classes:Array.from({length:16},(_,i)=>({id:String(i+1),region:'서울',course:`과정${i+1}`,teacher:''})),roster:s.roster.filter(r=>p==='all'||body.args[0]==='all'||r[0]===String(body.args[0])),ledgerCols:COLS,ledger:[],sync:{}};
  if(body.action==='b2Rev')return {rev:s.rev,sync:{}};
  if(body.action==='b2Docs')return {rev:s.rev,rows:[],statuses:[],types:[],delivery:[]};
  if(body.action==='b2ModuleTimes')return {rev:s.rev,rows:s.modules.filter(r=>(!p.cls||r.cls===p.cls)&&(!p.from||r.date>=p.from)&&(!p.to||r.date<=p.to)).map(r=>({...r})),defaults:{start:'09:00',end:'18:00',graceMin:10},field:['10:00','17:00']};
  if(body.action==='b2DayTimes')return day(p.date,p.cls);
  if(body.action==='b2ModuleTimeSave'){
   if(p.row){const cur=s.modules.find(r=>r.row===p.row),w=p.was||p;if(!cur||cur.date!==w.date||cur.cls!==w.cls||cur.module!==w.module)throw new Error('그 줄이 바뀌었습니다. 새로 읽어 주세요.');}
   if(p.remove&&!(p.date&&p.cls&&p.module)&&!p.was)throw new Error('지울 줄의 날짜·반·모듈이 필요합니다.');
   if(!p.remove&&(p.start==='')!==(p.end===''))throw new Error('시작·끝을 함께 넣거나 함께 비워 주세요.');
   s.rev++;
   if(p.remove){s.modules=s.modules.filter(r=>r.row!==p.row).map(r=>r.row>p.row?{...r,row:r.row-1}:r);return {ok:true,removed:p.row,rev:s.rev};}
   const at=p.row||Math.max(4,...s.modules.map(r=>r.row))+1,next={row:at,date:p.date,cls:p.cls,module:p.module,start:p.start,end:p.end,part:p.part||'',reason:p.reason||'',by:'hint.kpc@gmail.com',at:'2026-10-19 11:00'};
   s.modules=p.row?s.modules.map(r=>r.row===p.row?next:r):[...s.modules,next];return {ok:true,row:at,day:day(p.date,p.cls),rev:s.rev};
  }
  if(body.action==='b2RosterStatus'){s.rev++;const r=s.roster.find(x=>x[0]===p.cls&&x[1]===p.name);r[2]=p.status;r[3]=p.changed||'';r[4]=p.reason||'';return {ok:true,cls:p.cls,name:p.name,status:p.status,changed:p.changed||'',rev:s.rev};}
  return {};
 };
 return s;
}
// api(body): 값을 돌려주면 그 응답(ok:false면 오류), 약속이면 기다렸다 응답. 없으면 가짜 시트.
async function site(run,{api=()=>null,clock='2026-10-19T10:00:00+09:00',days=null,sheet=fakeSheet()}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>{dialogs.push(d.message());void (page.dialogAnswer?.shift()??true?d.accept():d.dismiss());});
 page.dialogAnswer=[];
 try{
  await page.clock.install({time:clock});
  if(days)await page.addInitScript(d=>{window.CH_DAYS=d;},days);
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   // 시험용 2기 Firebase 값(cohort.json은 아직 비어 있어 로그인 화면에서 멈춤)
   if(url.pathname==='/cohort.mjs')return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,'cohort.mjs'),'utf8').replace('"apiKey": ""','"apiKey": "test-key"').replace('"appId": ""','"appId": "test-app"')});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    let out=await api(body);if(out===null||out===undefined){try{out={ok:true,data:sheet.handle(body)};}catch(e){out={ok:false,error:e.message};}}
    return route.fulfill({status:out.ok?200:400,contentType:'application/json',body:JSON.stringify(out)});
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
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const rowOf=(page,module)=>page.locator('.b2t-row',{hasText:module});

test('교육시간 조정 lists the module rows by day with the day rule, explains the defaults and saves a part of a module with a reason',async()=>{
 const gate=deferred();let hold=false;
 await site(async(page,posts)=>{
  await page.getByRole('button',{name:'교육 운영',exact:true}).click();
  await page.getByRole('heading',{name:'교육시간 조정'}).waitFor();
  assert.equal(await page.locator('.admin-tabs .tab').first().innerText(),'교육시간 조정','first item of 교육 운영');
  const rules=await page.locator('#t2Rules').innerText();
  assert.match(rules,/평소 09:00~18:00 \(지각 기준 09:10 · 조퇴 기준 17:50\)/);assert.match(rules,/공장견학 기본 10:00~17:00 \(지각 기준 10:10 · 조퇴 기준 16:50\)/);
  assert.deepEqual(posts.find(p=>p.action==='b2ModuleTimes').args,[{from:'2026-10-28',to:'2027-01-22'}],'whole course, every class');
  const d13=page.locator('.b2t-day[data-day="2026-11-13|1"]'),d20=page.locator('.b2t-day[data-day="2026-11-20|2"]');
  assert.match(await d13.innerText(),/11\/13\(금\) · 1반[\s\S]*그날 기준 10:00~17:00[\s\S]*지각 기준 10:10 · 조퇴 기준 16:50/);
  assert.match(await d20.innerText(),/평소 기준 09:00~18:00[\s\S]*이 날은 아직 시간을 정한 줄이 없습니다/);
  assert.match(await rowOf(page,'공장견학').innerText(),/10:00~17:00[\s\S]*견학 업체 일정[\s\S]*hint\.kpc@gmail\.com · 2026-10-19 10:00/);
  assert.match(await rowOf(page,'분해조립').innerText(),/시간 미정/);
  await page.getByRole('button',{name:/시간 미정/}).click();
  assert.equal(await page.locator('.b2t-row').count(),2,'filter chip: 안전교육 and 분해조립 have no times');
  await page.getByRole('button',{name:/모든 줄/}).click();
  // 분해조립 오후 실습 13:00~15:00만 정하기: 사유 없이 저장하면 막힘
  await rowOf(page,'분해조립').getByRole('button',{name:'시간 정하기'}).click();
  const ed=page.locator('[data-editor="r7"]');
  await ed.locator('[data-f="start"]').fill('13:00');await ed.locator('[data-f="end"]').fill('15:00');await ed.locator('[data-f="part"]').fill('오후 실습');
  assert.equal(await ed.locator('[data-preview]').innerText(),'저장하면 11/20(금) 2반 그날 기준: 13:00~15:00 · 지각 기준 13:10 · 조퇴 기준 14:50');
  const n=posts.length;await ed.getByRole('button',{name:'저장'}).click();
  assert.equal(await ed.locator('[data-err]').innerText(),'시간을 고칠 때는 사유를 적어 주세요. (예: HRD 확정 전 임시)');assert.equal(posts.length,n,'nothing sent');
  await ed.locator('[data-f="end"]').fill('12:00');await ed.locator('[data-f="reason"]').fill('HRD 확정 전 임시');await ed.getByRole('button',{name:'저장'}).click();
  assert.equal(await ed.locator('[data-err]').innerText(),'끝 시간이 시작보다 늦어야 합니다.');
  await ed.locator('[data-f="end"]').fill('15:00');
  hold=true;await ed.getByRole('button',{name:'저장'}).click();
  // 화면에 먼저 보임(저장 중), 다른 지우기는 잠김
  await rowOf(page,'분해조립').getByText('저장 중…').waitFor();
  assert.match(await rowOf(page,'분해조립').innerText(),/13:00~15:00[\s\S]*구간: 오후 실습|구간: 오후 실습[\s\S]*13:00~15:00/);
  assert.equal(await rowOf(page,'공장견학').getByRole('button',{name:'지우기'}).isDisabled(),true);
  gate.resolve();
  await page.locator('.b2t-day[data-day="2026-11-20|2"]').getByText('그날 기준 13:00~15:00').waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2ModuleTimeSave').map(p=>p.args[0]),[{row:7,was:{date:'2026-11-20',cls:'2',module:'분해조립'},date:'2026-11-20',cls:'2',module:'분해조립',start:'13:00',end:'15:00',part:'오후 실습',reason:'HRD 확정 전 임시'}]);
  await rowOf(page,'분해조립').getByText('hint.kpc@gmail.com · 2026-10-19 11:00').waitFor(); // 시트에서 다시 읽은 값(화면에 먼저 보인 값은 '방금')
  assert.equal(posts.filter(p=>p.action==='b2ModuleTimes').length,2,'read again from the sheet after saving');
  assert.match(await rowOf(page,'분해조립').innerText(),/HRD 확정 전 임시/);
  assert.match(await page.locator('#toast').innerText(),/11\/20\(금\) 2반 분해조립 13:00~15:00 저장 · 그날 기준 13:00~15:00 · 지각 기준 13:10 · 조퇴 기준 14:50/);
 },{api:async b=>{if(b.action==='b2ModuleTimeSave'&&hold){hold=false;await gate.promise;}return null;}});
});

test('교육시간 조정 adds a 공장견학 day with the default button, rolls back a refused save and deletes a row after confirming',async()=>{
 let refuse=true;
 await site(async(page,posts,dialogs)=>{
  await page.getByRole('button',{name:'교육 운영',exact:true}).click();
  await page.getByRole('heading',{name:'교육시간 조정'}).waitFor();await page.locator('.b2t-row').first().waitFor();
  await page.getByRole('button',{name:'새 시간 넣기'}).click();
  const ed=page.locator('[data-editor="new"]');
  await ed.locator('[data-f="date"]').fill('2026-11-27');await ed.locator('[data-f="cls"]').selectOption('3');await ed.locator('[data-f="module"]').fill('공장견학');
  await ed.locator('[data-f="start"]').fill('07:30');await ed.locator('[data-f="end"]').fill('17:00');await ed.getByRole('button',{name:'저장'}).click();
  assert.equal(await ed.locator('[data-err]').innerText(),'교육시간은 08:00~20:00 안에서 정해 주세요.');
  await ed.getByRole('button',{name:'공장견학 기본 10:00~17:00'}).click();
  assert.deepEqual([await ed.locator('[data-f="start"]').inputValue(),await ed.locator('[data-f="end"]').inputValue()],['10:00','17:00']);
  assert.equal(await ed.locator('[data-preview]').innerText(),'저장하면 11/27(금) 3반 그날 기준: 10:00~17:00 · 지각 기준 10:10 · 조퇴 기준 16:50');
  // 시트가 거절하면 넣었던 줄을 빼고 입력값을 그대로 둔 채 이유를 보입니다
  await ed.getByRole('button',{name:'저장'}).click();
  await page.locator('[data-editor="new"] [data-err]',{hasText:'저장하지 못했습니다: 관리자만 할 수 있습니다.'}).waitFor();
  assert.equal(await page.locator('.b2t-day[data-day="2026-11-27|3"]').count(),0,'rolled back');
  assert.equal(await page.locator('[data-editor="new"] [data-f="module"]').inputValue(),'공장견학');
  refuse=false;await page.locator('[data-editor="new"]').getByRole('button',{name:'저장'}).click();
  await page.locator('.b2t-day[data-day="2026-11-27|3"]').getByText('그날 기준 10:00~17:00').waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2ModuleTimeSave').at(-1).args,[{date:'2026-11-27',cls:'3',module:'공장견학',start:'10:00',end:'17:00',part:'',reason:''}],'a new row has no row number and needs no reason');
  await page.locator('.b2t-row[data-key="r8"]').waitFor(); // 시트에서 다시 읽어 새 줄 번호(8)
  // 지우기: 확인창에서 아니오면 그대로, 예면 지우고 다시 읽음
  page.dialogAnswer.push(false);
  await rowOf(page,'견학 업체 일정').getByRole('button',{name:'지우기'}).click();
  assert.match(dialogs.at(-1),/11\/13\(금\) 1반 「공장견학」 10:00~17:00 줄을 마스터시트 현장교육 일정 탭에서 지울까요\?\n그날 기준은 남은 줄로 다시 정해집니다\(없으면 평소 09:00~18:00\)\./);
  assert.equal(posts.filter(p=>p.args?.[0]?.remove).length,0);
  await rowOf(page,'견학 업체 일정').getByRole('button',{name:'지우기'}).click();
  await page.locator('.b2t-day[data-day="2026-11-13|1"]').getByText('평소 기준 09:00~18:00').waitFor();
  assert.deepEqual(posts.filter(p=>p.args?.[0]?.remove).map(p=>p.args[0]),[{row:5,was:{date:'2026-11-13',cls:'1',module:'공장견학'},date:'2026-11-13',cls:'1',module:'공장견학',remove:true}]);
  // 줄 번호가 당겨진 뒤에도(시트에서 다시 읽음) 남은 줄을 바른 번호로 고칩니다
  await page.locator('.b2t-row[data-key="r6"]',{hasText:'분해조립'}).waitFor();
  await rowOf(page,'분해조립').getByRole('button',{name:'시간 정하기'}).click();
  const e2=page.locator('[data-editor="r6"]');await e2.locator('[data-f="start"]').fill('09:30');await e2.locator('[data-f="end"]').fill('16:30');await e2.locator('[data-f="reason"]').fill('업체 확정');await e2.getByRole('button',{name:'저장'}).click();
  await page.locator('.b2t-day[data-day="2026-11-20|2"]').getByText('그날 기준 09:30~16:30').waitFor();
  assert.equal(posts.filter(p=>p.action==='b2ModuleTimeSave').at(-1).args[0].row,6);
 },{api:b=>b.action==='b2ModuleTimeSave'&&!b.args[0].remove&&refuse?{ok:false,error:'관리자만 할 수 있습니다.'}:null});
});

test('교육시간 조정 clears a row to 시간 미정 with was, deletes a prefilled row without times, and a changed row is refused, explained and read again',async()=>{
 await site(async(page,posts,dialogs,sheet)=>{
  await page.getByRole('button',{name:'교육 운영',exact:true}).click();
  await page.getByRole('heading',{name:'교육시간 조정'}).waitFor();await page.locator('.b2t-row').first().waitFor();
  assert.equal(await rowOf(page,'분해조립').getByRole('button',{name:'시간 비우기'}).count(),0,'no times, nothing to clear');
  assert.equal(await rowOf(page,'분해조립').getByRole('button',{name:'지우기'}).count(),1,'a prefilled row without times can be deleted');
  // 시간 비우기: 확인 뒤 시작·끝을 함께 비움(줄은 남음, 시간 미정) → 그날 기준은 평소로
  page.dialogAnswer.push(false);
  await rowOf(page,'견학 업체 일정').getByRole('button',{name:'시간 비우기'}).click();
  assert.match(dialogs.at(-1),/11\/13\(금\) 1반 「공장견학」 10:00~17:00 시간을 비울까요\?\n줄은 남고 '시간 미정'이 됩니다\./);
  assert.equal(posts.filter(p=>p.action==='b2ModuleTimeSave').length,0);
  await rowOf(page,'견학 업체 일정').getByRole('button',{name:'시간 비우기'}).click();
  await page.locator('.b2t-day[data-day="2026-11-13|1"]').getByText('평소 기준 09:00~18:00').waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2ModuleTimeSave').map(p=>p.args[0]),[{row:5,was:{date:'2026-11-13',cls:'1',module:'공장견학'},date:'2026-11-13',cls:'1',module:'공장견학',start:'',end:'',part:'',reason:'시간 미정으로 되돌림'}]);
  await page.locator('.b2t-row[data-key="r5"]').getByText('시간 미정',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.b2t-row.pending')&&!document.querySelector('[data-del][disabled]'));// 시트에서 다시 읽기가 끝남
  // 그사이 시트에서 6번 줄이 다른 줄이 됨 → 지우기는 거절, 이유를 보이고 시트에서 다시 읽음(화면에 남은 옛 줄은 사라짐)
  sheet.modules=sheet.modules.map(r=>r.row===6?{...r,module:'다른 모듈'}:r);
  const reads=posts.filter(p=>p.action==='b2ModuleTimes').length;
  await rowOf(page,'안전교육').getByRole('button',{name:'지우기'}).click();
  assert.match(dialogs.at(-1),/11\/13\(금\) 1반 「안전교육」 \(시간 미정\) 줄을 마스터시트 현장교육 일정 탭에서 지울까요\?/);
  await page.locator('#t2Msg').getByText(/그 줄이 바뀌었습니다\. 새로 읽어 주세요\. 그사이 시트의 줄이 바뀌어 저장하지 않았습니다\. 시트에서 다시 읽었습니다/).waitFor();
  await rowOf(page,'다른 모듈').waitFor();
  assert.equal(await rowOf(page,'안전교육').count(),0);
  assert.equal(posts.filter(p=>p.action==='b2ModuleTimes').length,reads+1,'read again once');
  assert.deepEqual(posts.filter(p=>p.args?.[0]?.remove).map(p=>p.args[0]),[{row:6,was:{date:'2026-11-13',cls:'1',module:'안전교육'},date:'2026-11-13',cls:'1',module:'안전교육',remove:true}]);
  // 고치기도 같은 확인: 열어 둔 사이 줄이 바뀌면 거절·다시 읽음, 편집 칸은 닫힘
  await rowOf(page,'분해조립').getByRole('button',{name:'시간 정하기'}).click();
  sheet.modules=sheet.modules.map(r=>r.row===7?{...r,date:'2026-11-27'}:r);
  const ed=page.locator('[data-editor="r7"]');await ed.locator('[data-f="start"]').fill('13:00');await ed.locator('[data-f="end"]').fill('15:00');await ed.locator('[data-f="reason"]').fill('업체 확정');await ed.getByRole('button',{name:'저장'}).click();
  await page.locator('.b2t-day[data-day="2026-11-27|2"]').waitFor();
  assert.equal(await page.locator('[data-editor]').count(),0);
  assert.match(await page.locator('#t2Msg').innerText(),/그 줄이 바뀌었습니다/);
 });
});

test('교육생 상태 changes a status with the last attendance day after confirming, refreshes the roster and returns a leaver to 재학',async()=>{
 await site(async(page,posts,dialogs,sheet)=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();
  assert.deepEqual(await page.locator('.admin-tabs .tab').allInnerTexts(),['출결대조','출결 현황','교육생 상태','내려받기','체크히어 수집']);
  await page.getByRole('button',{name:'교육생 상태',exact:true}).click();
  await page.getByRole('heading',{name:'교육생 상태'}).waitFor();await page.locator('.b2r-row').first().waitFor();
  assert.deepEqual(await page.locator('.b2r-row .b2-name').allInnerTexts(),['고다원','김동진','한수빈'],'class 1 by default');
  const han=page.locator('.b2r-row[data-key="1|한수빈"]');
  assert.match(await han.innerText(),/현재 중도탈락[\s\S]*마지막 출석 11\/2\(월\)[\s\S]*사유: 개인 사정/);
  assert.match(await page.locator('#r2Views').innerText(),/전체3[\s\S]*재학2[\s\S]*재학 아님1/);
  const kim=page.locator('.b2r-row[data-key="1|김동진"]');
  assert.equal(await kim.getByRole('button',{name:'저장'}).isDisabled(),true,'nothing changed yet');
  assert.equal(await kim.locator('[data-e="changed"]').isDisabled(),true,'no last attendance day while 재학');
  await kim.locator('[data-e="status"]').selectOption('조기취업');
  await page.locator('.b2r-row[data-key="1|김동진"] [data-e="changed"]:not([disabled])').waitFor();
  const n=posts.length;await page.locator('.b2r-row[data-key="1|김동진"]').getByRole('button',{name:'저장'}).click();
  assert.equal(await page.locator('.b2r-row[data-key="1|김동진"] [data-err]').innerText(),'마지막 출석일을 넣어 주세요.');assert.equal(posts.length,n);
  await page.locator('.b2r-row[data-key="1|김동진"] [data-e="changed"]').fill('2026-11-10');await page.locator('.b2r-row[data-key="1|김동진"] [data-e="reason"]').fill('11/11 입사');
  page.dialogAnswer.push(false);await page.locator('.b2r-row[data-key="1|김동진"]').getByRole('button',{name:'저장'}).click();
  assert.equal(dialogs.at(-1),'1반 김동진 학생을 「조기취업」(으)로 바꿀까요?\n마지막 출석일 11/10(화) 다음 교육일부터 출결대조·출결 현황·출석률 계산에서 빠집니다.');
  assert.equal(posts.filter(p=>p.action==='b2RosterStatus').length,0,'cancelled');
  await page.locator('.b2r-row[data-key="1|김동진"]').getByRole('button',{name:'저장'}).click();
  await page.locator('.b2r-row[data-key="1|김동진"]',{hasText:'현재 조기취업'}).waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2RosterStatus').map(p=>p.args[0]),[{cls:'1',name:'김동진',status:'조기취업',changed:'2026-11-10',reason:'11/11 입사'}]);
  assert.match(await page.locator('.b2r-row[data-key="1|김동진"]').innerText(),/마지막 출석 11\/10\(화\)[\s\S]*사유: 11\/11 입사/);
  const bundles=posts.filter(p=>p.action==='b2Bundle').map(p=>p.args[0]);assert.equal(bundles.at(-1),'1','read the class again from the sheet after saving');
  assert.match(await page.locator('#toast').innerText(),/1반 김동진 · 조기취업 \(마지막 출석 11\/10\(화\)\) 저장했습니다\./);
  // 재학으로 되돌리기: 확인창 없이, 마지막 출석일은 비워 보냄
  const before=dialogs.length;
  await han.locator('[data-e="status"]').selectOption('재학');
  await page.locator('.b2r-row[data-key="1|한수빈"]').getByRole('button',{name:'저장'}).click();
  await page.locator('.b2r-row[data-key="1|한수빈"]',{hasText:'현재 재학'}).waitFor();
  assert.equal(dialogs.length,before);
  assert.deepEqual(posts.filter(p=>p.action==='b2RosterStatus').at(-1).args[0],{cls:'1',name:'한수빈',status:'재학',changed:'',reason:'개인 사정'});
  assert.deepEqual(sheet.roster.find(r=>r[1]==='한수빈').slice(2,4),['재학','']);
 });
});

test('a refused status change keeps the input and shows the reason',async()=>{
 await site(async(page,posts)=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();await page.getByRole('button',{name:'교육생 상태',exact:true}).click();
  const go=page.locator('.b2r-row[data-key="1|고다원"]');await go.waitFor();
  await go.locator('[data-e="status"]').selectOption('수료');
  const row=page.locator('.b2r-row[data-key="1|고다원"]');await row.locator('[data-e="changed"]').fill('2027-01-22');await row.getByRole('button',{name:'저장'}).click();
  await row.locator('[data-err]',{hasText:'저장하지 못했습니다: 같은 반에 같은 이름이 명부에 여러 줄입니다. 시트에서 정리해 주세요.'}).waitFor();
  assert.deepEqual([await row.locator('[data-e="status"]').inputValue(),await row.locator('[data-e="changed"]').inputValue()],['수료','2027-01-22']);
  assert.match(await row.innerText(),/현재 재학/);
 },{api:b=>b.action==='b2RosterStatus'?{ok:false,error:'같은 반에 같은 이름이 명부에 여러 줄입니다. 시트에서 정리해 주세요.'}:null});
});

// 출결대조(한 줄 연결): 반·날짜를 열면 b2DayTimes를 한 번 읽고, 견학일 기준으로 다시 판정합니다.
const rec=o=>({classId:'1',date:'2026-11-13',outings:[],outingCount:0,collectedAt:'1',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',...o});
const CH={'classes/1/checkhereCurrent/2026-11-13':{records:[rec({id:'a',version:'va',phoneLast4:'1111',name:'고다원',rawEntry:'10:05:00',entry:'10:05:00',exit:'17:00:00'}),rec({id:'b',version:'vb',phoneLast4:'2222',name:'김동진',rawEntry:'10:15:00',entry:'10:15:00',exit:'17:00:00'})]}};
test('출결대조 reads the day rule once for the class and day and judges a field day with 지각 10:10 · 조퇴 16:50',async()=>{
 await site(async(page,posts)=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  const go=page.locator('tr[data-name="고다원"]'),kim=page.locator('tr[data-name="김동진"]');
  await go.getByText('✓ 일치').waitFor();
  assert.match(await kim.innerText(),/체크히어 지각 10:15 \(그날 기준 10:00~17:00\)/);
  assert.deepEqual(posts.filter(p=>p.action==='b2DayTimes').map(p=>p.args),[[{date:'2026-11-13',cls:'1'}]]);
 },{clock:'2026-11-13T19:00:00+09:00',days:CH});
});
test('출결대조 falls back to 09:00~18:00 when the day rule cannot be read',async()=>{
 await site(async(page,posts)=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();
  const go=page.locator('tr[data-name="고다원"]');await go.getByText(/체크히어 지각 10:05/).waitFor();
  assert.doesNotMatch(await go.innerText(),/그날 기준/);
  assert.equal(posts.filter(p=>p.action==='b2DayTimes').length,1);
 },{clock:'2026-11-13T19:00:00+09:00',days:CH,api:b=>b.action==='b2DayTimes'?{ok:false,error:'마스터시트 응답이 늦습니다. 잠시 후 다시 시도해 주세요.'}:null});
});
