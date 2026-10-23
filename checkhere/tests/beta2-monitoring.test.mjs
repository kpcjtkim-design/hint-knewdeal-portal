import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import handler,{b2Args,FIREBASE,ACCESS,counselEditError,MONITOR_KEYS} from '../../api/teacher-beta.js';
import retry from '../../lib/sheet-retry.cjs';
import * as M from '../../beta2-monitoring-core.mjs';
import {KINDS,teacherTarget} from '../../notify-core.mjs';
import {openPortal,BUNDLE,TODAY,YESTERDAY} from './teacher-fixture.mjs';

// 2기 운영모니터링(사용자 요청 2026-10-21): 1기 '운영모니터링' 설문 링크 → 김소윤 님 Streamlit '담임 상담일지' 양식(허락 받음, 문항 그대로).
// 시트(2기 Apps Script v26 b2Monitors·b2MonitorSave·b2MonitorConfirm·b2Counsels·b2CounselSave·b2CounselConfirm)는 아래 가짜가 계약대로 답합니다. 사람 이름은 모두 가상입니다.
const base=join(import.meta.dirname,'../..');
const SPEC_ITEMS=[['schedule','교육 내용','과정 시간표'],['content','교육 내용','과정 내용'],['material','교육 내용','교재 및 교구'],['delivery','강사 역량','강의 전달력'],['communication','강사 역량','학습자 소통'],
 ['participation','교육생 현황·교육 환경','수업 참여도'],['progress','교육생 현황·교육 환경','학습 진도'],['facility','교육생 현황·교육 환경','교육장 시설'],['equipment','교육생 현황·교육 환경','교육 장비']];
const full=(v=4,o={})=>({...Object.fromEntries(M.ITEM_KEYS.map(k=>[k,v])),...o});
const CONFLICT='CONFLICT: 그사이 다른 사람이 바꿨습니다. 새로 읽어 주세요.';

/* ---------- 가짜 마스터시트(계약대로 거절) ---------- */
export function monitorSheet({today=TODAY,special=new Set(['가상학생나'])}={}){
 const s={rev:30,mons:[],logs:[],writes:[],n:0,clientIds:new Map()};
 const fail=m=>{throw new Error(m);};
 const sig=()=>'sig'+(++s.n);
 s.handle=(body)=>{
  const p=body.args?.[0]??{},role=body.role||'TEACHER',actor=body.actor||'teacher@test.kr';
  switch(body.action){
   case 'b2Monitors':return {rev:s.rev,items:M.ITEMS.map(i=>({key:i.key,label:i.label})),low:2,rows:s.mons.filter(r=>(!p.cls||r.cls===String(p.cls))&&(!p.from||r.date>=p.from)&&(!p.to||r.date<=p.to)).map(r=>structuredClone(r))};
   case 'b2MonitorSave':{
    s.writes.push([body.action,p,role]);
    if(!p.cls||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||''))fail('반·날짜를 확인해 주세요.');
    for(const k of M.ITEM_KEYS)if(!Number.isInteger(p.scores?.[k])||p.scores[k]<1||p.scores[k]>5)fail('점수 9개를 모두 넣어 주세요.');
    const cur=s.mons.find(r=>r.cls===String(p.cls)&&r.date===p.date);
    if(p.was!==undefined&&(cur?.sig||'')!==p.was)fail(CONFLICT);
    const flag=M.ITEM_KEYS.some(k=>p.scores[k]<=2),row=cur?.row||s.mons.length+2;
    const next={row,date:p.date,cls:String(p.cls),author:cur?.author||actor,scores:{...p.scores},notes:{...p.notes},flag,confirmed:false,confirmedBy:'',confirmedAt:'',savedAt:`${p.date} 17:0${s.n%10}`,editedBy:cur?actor:'',sig:sig()};
    if(cur)Object.assign(cur,next);else s.mons.push(next);
    s.rev++;return {ok:true,row,flag,sig:next.sig,rev:s.rev};
   }
   case 'b2MonitorConfirm':{
    s.writes.push([body.action,p,role]);if(role!=='ADMIN')fail('관리자만 확인합니다.');
    const cur=s.mons.find(r=>r.cls===String(p.cls)&&r.date===p.date);if(!cur)fail('기록이 없습니다.');
    if(p.was!==undefined&&cur.sig!==p.was)fail(CONFLICT);
    Object.assign(cur,{confirmed:!!p.on,confirmedBy:p.on?actor:'',confirmedAt:p.on?`${today} 18:00`:'',sig:sig()});s.rev++;return {ok:true,rev:s.rev,sig:cur.sig};
   }
   case 'b2Counsels':return {rev:s.rev,questions:M.QUESTIONS.map(q=>({key:q.key,label:q.label})),special:0.8,rows:s.logs.filter(r=>(!p.cls||r.cls===String(p.cls))&&(!p.name||r.name===p.name)).map(r=>structuredClone(r))};
   case 'b2CounselSave':{
    s.writes.push([body.action,p,role]);
    if(!M.Q_KEYS.some(k=>String(p.answers?.[k]||'').trim()))fail('면담 내용을 적어 주세요.');
    if(p.clientId&&s.clientIds.has(p.clientId))return {...s.clientIds.get(p.clientId),repeated:true};
    const kind=special.has(p.name)?'특별상담 대상':'일반';
    let out;
    if(p.round){
     const cur=s.logs.find(r=>r.cls===String(p.cls)&&r.name===p.name&&r.round===p.round);if(!cur)fail('그 면담 기록이 없습니다.');
     if(p.was!==undefined&&cur.sig!==p.was)fail(CONFLICT);
     Object.assign(cur,{date:p.date,answers:{...p.answers},editedBy:actor,confirmed:false,confirmedBy:'',confirmedAt:'',sig:sig()});
     out={ok:true,row:cur.row,round:cur.round,kind:cur.kind,rate:50,sig:cur.sig};
    }else{
     const round=Math.max(0,...s.logs.filter(r=>r.cls===String(p.cls)&&r.name===p.name).map(r=>r.round))+1,row=s.logs.length+2;
     const r={row,cls:String(p.cls),name:p.name,round,date:p.date,author:actor,kind,answers:{...p.answers},savedAt:`${p.date} 15:00`,editedBy:'',confirmed:false,confirmedBy:'',confirmedAt:'',sig:sig()};
     s.logs.push(r);out={ok:true,row,round,kind,rate:special.has(p.name)?50:100,sig:r.sig};
    }
    s.rev++;out.rev=s.rev;if(p.clientId)s.clientIds.set(p.clientId,out);return out;
   }
   case 'b2CounselConfirm':{
    s.writes.push([body.action,p,role]);if(role!=='ADMIN')fail('관리자만 확인합니다.');
    const cur=s.logs.find(r=>r.cls===String(p.cls)&&r.name===p.name&&r.round===Number(p.round));if(!cur)fail('기록이 없습니다.');
    if(p.was!==undefined&&cur.sig!==p.was)fail(CONFLICT);
    Object.assign(cur,{confirmed:!!p.on,confirmedBy:p.on?actor:'',confirmedAt:p.on?`${today} 18:00`:'',sig:sig()});s.rev++;return {ok:true,rev:s.rev};
   }
   case 'b2Rev':return {rev:s.rev,sync:BUNDLE.sync,voc:{rev:1,admin:0,open:{},teacher:{}}};
   default:return null;
  }
 };
 return s;
}

/* ---------- 양식 원문·순수 함수 ---------- */
test('form text is the Streamlit 담임 상담일지 wording: 9 items in 3 groups, legend, notices, Q1–Q4',()=>{
 assert.deepEqual(M.ITEMS.map(i=>[i.key,i.group,i.label]),SPEC_ITEMS);
 assert.deepEqual(MONITOR_KEYS,M.ITEM_KEYS,'server and screen use the same keys (sheet contract: material)');
 assert.equal(M.ITEMS[0].desc,'강의 시작·종료 시간, 휴식·점심시간 등 계획된 일정이 실제로 지켜졌는지 확인합니다.');
 assert.equal(M.ITEMS.at(-1).desc,'PC, 네트워크, 빔프로젝터 및 실습 장비가 정상 작동했는지 확인합니다.');
 assert.equal(M.SURVEY_NOTICE,'오늘 하루의 반 전체 운영 상태를 기준으로 평가해 주세요. 학생 개인 만족도가 아닌 담임의 운영 점검 기록입니다.');
 assert.equal(M.SCORE_LEGEND_TEXT,'점수 기준: 5점 매우 우수(문제 없음) · 4점 양호(경미한 보완) · 3점 보통(개선 필요) · 2점 미흡(원인 확인 필요) · 1점 매우 미흡(즉시 확인 필요)');
 assert.equal(M.LOW_NOTICE,'2점 이하 항목이 있으면 관리자 화면에 확인 필요로 표시됩니다.');
 assert.equal(M.SPECIAL_NOTICE,'누적 출석률 80% 미만 학생은 특별상담 대상으로 자동 분류됩니다.');
 assert.equal(M.SAVE_NOTICE,'상담일지를 저장하면 면담 완료로 자동 처리됩니다.');
 assert.equal(M.step2Title('가상학생가'),'2단계 · 가상학생가 면담 설문 작성');
 assert.deepEqual(M.QUESTIONS.map(q=>q.label),['Q1. 지금까지 진행한 교육에 대해 전반적으로 만족하나요? (어떤 교육이 가장 도움이 되었나요?)','Q2. 교육과정을 학습하는데 어떤 어려운 점이 있나요? (교육내용, 강사역량, 교육환경 등 개선 필요 사항)','Q3. 앞으로 교육과정을 이수하는데 예상되는 어려움이나 특별한 개인 사정이 있나요?','Q4. 기타 특이사항']);
 assert.deepEqual([M.SURVEY_SAVE,M.COUNSEL_SAVE,M.STEP1,M.INTERVIEW_TITLE,M.RECORDS_TITLE],['만족도 조사 저장','상담일지 저장','1단계 · 상담할 학생 선택','1. 일반 인터뷰','내 반 저장 기록']);
});

test('scores: needsCheck (any ≤2), check/payload, sheet rows normalised (flag from the sheet wins)',()=>{
 assert.equal(M.needsCheck(full(3)),false);assert.equal(M.needsCheck(full(3,{facility:2})),true);
 assert.deepEqual(M.lowItems(full(5,{delivery:1,facility:2})).map(i=>i.label),['강의 전달력','교육장 시설']);
 assert.equal(M.average(full(4,{schedule:1})),3.7);
 const f={cls:'1',date:TODAY,scores:full(4,{equipment:null}),notes:{schedule:' 10분 늦게 시작 ',content:''},was:''};
 assert.equal(M.checkMonitor(f),'점수를 모두 골라 주세요: 교육 장비');
 f.scores.equipment=2;assert.equal(M.checkMonitor(f),'');
 assert.equal(M.checkMonitor({...f,notes:{facility:'x'.repeat(301)}}),'교육장 시설 특이사항은 300자까지입니다.');
 const p=M.monitorPayload(f);
 assert.deepEqual(p,{cls:'1',date:TODAY,scores:full(4,{equipment:2}),notes:{...Object.fromEntries(M.ITEM_KEYS.map(k=>[k,''])),schedule:'10분 늦게 시작'}},'no was on a first save');
 assert.equal(M.monitorPayload({...f,was:'sig9'}).was,'sig9');
 const r=M.normMonitor({row:3,date:TODAY,cls:1,author:'t@x',scores:{...full(5),extra:9,content:'7'},notes:{schedule:'a'},flag:false,confirmed:'TRUE',sig:'s'});
 assert.deepEqual([r.cls,r.scores.content,r.scores.extra,r.notes.schedule,r.notes.facility,r.flag,r.confirmed],['1',null,undefined,'a','',false,true]);
 assert.equal(M.normMonitor({scores:full(5,{progress:2})}).flag,true,'no flag from the sheet → computed');
 // 알림: 종류 '운영모니터링'이 아직 규칙·KINDS에 없으면 보내지 않음
 assert.equal(M.notifyReady(KINDS),KINDS.includes('운영모니터링'));assert.equal(M.notifyReady(['운영모니터링']),true);
 assert.deepEqual(M.monitorNotice({cls:'3',date:TODAY,scores:full(4,{facility:2})}),{audience:'admins',cls:'3',title:`운영모니터링 확인 필요 · 3반 ${TODAY}`,body:'2점 이하: 교육장 시설 2점'});
 assert.equal(M.monitorNotice({cls:'3',date:TODAY,scores:full(4)}),null);
 assert.deepEqual(teacherTarget('b2monitor',{cls:'3'}),['monitoring','checkup']);
});

test('counselling rounds 1차→2차, rotation status and order (미상담 first, special first), special-target filter, admin overview and CSV',()=>{
 const stats=[{cls:'1',name:'가',status:'재학',rate:100},{cls:'1',name:'나',status:'재학',rate:50},{cls:'1',name:'다',status:'재학',rate:79.9},{cls:'1',name:'라',status:'중도탈락',rate:20},{cls:'1',name:'마',status:'재학',rate:null},{cls:'2',name:'바',status:'재학',rate:90}];
 const log=(name,round,date,o={})=>M.normCounsel({cls:'1',name,round,date,author:'t@x',kind:'일반',answers:{q1:'좋아요'},sig:`s-${name}-${round}`,...o});
 let logs=[log('가',1,'2026-10-29')];
 let R=M.rotation(stats,logs,{cls:'1'});
 assert.deepEqual(R.students.map(s=>[s.name,s.status2,s.next,s.special]),[['나','미상담',1,true],['다','미상담',1,true],['마','미상담',1,false],['가','1차 완료',2,false]],'중도탈락 is out of the rotation; 미상담 special first');
 assert.deepEqual([R.total,R.done,R.pending,R.percent,R.special,R.specialPending],[4,1,3,25,2,2]);
 logs=[...logs,log('가',2,'2026-11-05'),log('나',1,'2026-10-30')];
 R=M.rotation(stats,logs,{cls:'1'});
 const ga=R.students.find(s=>s.name==='가');
 assert.deepEqual([ga.rounds,ga.status2,ga.last,ga.next,ga.logs.map(l=>l.round)],[2,'2차 완료','2026-11-05',3,[1,2]]);
 assert.deepEqual(R.students.map(s=>s.name),['다','마','나','가'],'then fewer rounds first');
 assert.deepEqual([R.multi,R.logs,R.specialPending],[1,3,1]);
 assert.deepEqual(M.filterStudents(R.students,'special').map(s=>s.name),['다','나']);
 assert.deepEqual(M.filterStudents(R.students,'normal').map(s=>s.name),['마','가']);
 assert.equal(M.filterStudents(R.students,'all').length,4);
 assert.equal(M.isSpecial(80),false);assert.equal(M.isSpecial(79.99),true);assert.equal(M.isSpecial(null),false);
 // 면담 저장 인자: 새 면담 clientId, 고치기 round+was
 const cf={cls:'1',name:' 가 ',date:TODAY,answers:{q1:' 만족 ',q2:'',q3:'',q4:''},clientId:'cid-12345678'};
 assert.deepEqual(M.counselPayload(cf),{cls:'1',name:'가',date:TODAY,answers:{q1:'만족',q2:'',q3:'',q4:''},clientId:'cid-12345678'});
 assert.deepEqual(M.counselPayload({...cf,round:2,was:'s-가-2'}),{cls:'1',name:'가',date:TODAY,answers:{q1:'만족',q2:'',q3:'',q4:''},round:2,was:'s-가-2'});
 assert.equal(M.checkCounsel({...cf,answers:{q1:' '}}),'면담 내용을 한 칸 이상 적어 주세요.');
 // 관리자 표·거르기·CSV
 const mons=[M.normMonitor({cls:'1',date:'2026-10-28',author:'a',scores:full(5),sig:'1'}),M.normMonitor({cls:'1',date:'2026-10-29',author:'a',scores:full(4,{facility:1}),notes:{facility:'에어컨 고장'},sig:'2',confirmed:true,confirmedBy:'hint.kpc@gmail.com'}),M.normMonitor({cls:'17',date:'2026-10-29',author:'b',scores:full(2),sig:'3'})];
 const g=M.overview(mons,['1','2','17'],['2026-10-28','2026-10-29']);
 assert.deepEqual(g.map(r=>[r.cls,r.cells.map(c=>c.state+(c.confirmed?'✓':'')),r.submitted,r.flags,r.unconfirmedFlags]),[['1',['ok','flag✓'],2,1,0],['2',['none','none'],0,0,0],['17',['none','flag'],1,1,1]],'test class 17 counts like any class');
 assert.deepEqual(M.pickRecords(mons,{flagOnly:true}).map(r=>r.cls+r.date),['12026-10-29','172026-10-29']);
 assert.deepEqual(M.pickRecords(mons,{cls:'1',from:'2026-10-29'}).map(r=>r.date),['2026-10-29']);
 const csv=M.monitorCsv([mons[1]]);
 assert.deepEqual(csv[0].slice(0,5),['반','날짜','작성자','과정 시간표 점수','과정 시간표 특이사항']);
 assert.equal(csv[0].length,3+18+8);
 const row=Object.fromEntries(csv[0].map((h,i)=>[h,csv[1][i]]));
 assert.deepEqual([row['교육장 시설 점수'],row['교육장 시설 특이사항'],row['확인 필요'],row['2점 이하 항목'],row['운영팀 확인'],row['확인자']],[1,'에어컨 고장','확인 필요','교육장 시설','확인','hint.kpc@gmail.com']);
 const cc=M.counselCsv([log('가',2,'2026-11-05',{answers:{q1:'좋아요',q4:'없음'},kind:'특별상담 대상'})]);
 assert.deepEqual(cc[0].slice(0,10),['반','이름','차수','면담 날짜','구분','작성자',...M.QUESTIONS.map(q=>q.label)]);
 assert.deepEqual(cc[1].slice(0,10),['1','가','2차','2026-11-05','특별상담 대상','t@x','좋아요','','','없음']);
});

/* ---------- Vercel 중계(api/teacher-beta.js): 담임은 자기 반, 확인은 관리자만, 정해진 칸만 ---------- */
const SHEET='https://script.test/exec',ADMIN_EMAIL='hint.kpc@gmail.com',TEACHER='teacher@test.kr';
const PROFILES={[TEACHER]:{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'1'}},'other@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'1'}}};
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
const sheetFn=sheet=>body=>{try{const d=sheet.handle(body);return d===null?{ok:true,data:{}}:{ok:true,data:d};}catch(e){return {ok:false,error:e.message};}};

test('server scoping: teachers read and save only their class, confirm is admin-only, only contract fields pass, bad input never reaches the sheet',async t=>{
 const calls=backend(t,()=>({ok:true,data:{ok:true,rev:1,rows:[]}}));
 for(const a of [[{}],[{cls:'all'}],[{cls:'5',from:'2026-10-28',to:'2026-11-03',x:1}]])await call({action:'b2Monitors',args:a});
 await call({action:'b2Counsels',args:[{cls:'17',name:'[가상데이터] 학생1'}]});
 assert.deepEqual(calls.map(c=>[c.action,c.args,c.role]),[['b2Monitors',[{}],'ADMIN'],['b2Monitors',[{}],'ADMIN'],['b2Monitors',[{cls:'5',from:'2026-10-28',to:'2026-11-03'}],'ADMIN'],['b2Counsels',[{cls:'17',name:'[가상데이터] 학생1'}],'ADMIN']],'the test class 17 and 가상데이터 names pass like real ones');
 calls.length=0;
 for(const a of [[{}],[{cls:'all'}],[{cls:'9'}]]){await call({action:'b2Monitors',args:a},TEACHER);await call({action:'b2Counsels',args:a},TEACHER);}
 assert.deepEqual(calls.map(c=>[c.action,c.args,c.role,c.actor]),[0,1,2].flatMap(()=>[['b2Monitors',[{cls:'1'}],'TEACHER',TEACHER],['b2Counsels',[{cls:'1'}],'TEACHER',TEACHER]]));
 calls.length=0;
 const res=await call({action:'b2MonitorSave',args:[{cls:'9',date:TODAY,scores:{...full(4),extra:1},notes:{schedule:'늦게 시작',hack:'x'},was:'sig1',author:'x',confirmed:true}]},TEACHER);
 assert.equal(res.statusCode,200);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',date:TODAY,scores:full(4),notes:{...Object.fromEntries(MONITOR_KEYS.map(k=>[k,''])),schedule:'늦게 시작'},was:'sig1'}]);
 await call({action:'b2CounselSave',args:[{cls:'4',name:' 가상학생가 ',date:TODAY,answers:{q1:'좋음',q9:'x'},kind:'일반',clientId:'cid-abcdefgh'}]},TEACHER);
 assert.deepEqual(calls.at(-1).args,[{cls:'1',name:'가상학생가',date:TODAY,answers:{q1:'좋음',q2:'',q3:'',q4:''},clientId:'cid-abcdefgh'}],'kind is decided by the sheet');
 const before=calls.length;
 for(const [body,code] of [
  [{action:'b2MonitorSave',args:[{cls:'1',date:TODAY,scores:full(4,{equipment:6})}]},'BAD_REQUEST'],
  [{action:'b2MonitorSave',args:[{cls:'1',date:TODAY,scores:full(4,{content:undefined})}]},'BAD_REQUEST'],
  [{action:'b2MonitorSave',args:[{cls:'1',date:'10/29',scores:full(4)}]},'BAD_REQUEST'],
  [{action:'b2MonitorSave',args:[{cls:'1',date:TODAY,scores:full(4),notes:{schedule:'x'.repeat(301)}}]},'BAD_REQUEST'],
  [{action:'b2CounselSave',args:[{cls:'1',name:'가',date:TODAY,answers:{q1:' '}}]},'BAD_REQUEST'],
  [{action:'b2CounselSave',args:[{cls:'1',name:'',date:TODAY,answers:{q1:'a'}}]},'BAD_REQUEST'],
  [{action:'b2CounselSave',args:[{cls:'1',name:'가',date:TODAY,answers:{q1:'a'},clientId:'bad id'}]},'BAD_REQUEST'],
  [{action:'b2MonitorConfirm',args:[{cls:'1',date:TODAY,on:true}]},'ADMIN_ONLY'],
  [{action:'b2CounselConfirm',args:[{cls:'1',name:'가',round:1,on:true}]},'ADMIN_ONLY']
 ])assert.equal((await call(body,TEACHER)).body.code,code,JSON.stringify(body).slice(0,90));
 assert.equal(calls.length,before,'nothing reached the sheet');
 // 관리자 확인: 정해진 칸만, on은 참·거짓만
 await call({action:'b2MonitorConfirm',args:[{cls:'17',date:TODAY,on:true,was:'s1',by:'x'}]});
 assert.deepEqual(calls.at(-1).args,[{cls:'17',date:TODAY,on:true,was:'s1'}]);
 await call({action:'b2CounselConfirm',args:[{cls:'3',name:'가',round:'2',on:false}]});
 assert.deepEqual(calls.at(-1).args,[{cls:'3',name:'가',round:2,on:false}]);
 assert.equal((await call({action:'b2MonitorConfirm',args:[{cls:'3',date:TODAY,on:'yes'}]})).body.code,'BAD_REQUEST');
 assert.equal((await call({action:'b2MonitorSave',args:[{date:TODAY,scores:full(4)}]})).body.code,'BAD_CLASS','admins must name the class');
 assert.deepEqual(b2Args({role:'TEACHER',classIds:['1','7']},'b2Monitors',[{cls:'7'}]),[{cls:'7'}],'a temporary class is allowed');
 // 다시 시도 규칙: 읽기·덮어쓰기·확인은 안전, 새 면담은 clientId가 있을 때만
 const kind=(a,p)=>retry.actionKind(a,[p]);
 assert.deepEqual([kind('b2Monitors',{}),kind('b2Counsels',{}),kind('b2MonitorSave',{}),kind('b2MonitorConfirm',{}),kind('b2CounselConfirm',{}),kind('b2CounselSave',{round:2}),kind('b2CounselSave',{clientId:'cid-abcdefgh'}),kind('b2CounselSave',{})],
  ['read','read','write','write','write','write','write','create']);
});

test('server: a teacher may edit only a counselling round they wrote (read first), admins edit any; the sheet answers CONFLICT on a stale was',async t=>{
 const sheet=monitorSheet();
 sheet.logs.push({row:2,cls:'1',name:'가상학생가',round:1,date:YESTERDAY,author:'other@test.kr',kind:'일반',answers:{q1:'a',q2:'',q3:'',q4:''},savedAt:'',editedBy:'',confirmed:false,sig:'old'},
  {row:3,cls:'1',name:'가상학생가',round:2,date:TODAY,author:TEACHER,kind:'일반',answers:{q1:'b',q2:'',q3:'',q4:''},savedAt:'',editedBy:'',confirmed:false,sig:'mine'});
 const calls=backend(t,sheetFn(sheet));
 const edit=(round,was,email=TEACHER)=>call({action:'b2CounselSave',args:[{cls:'1',name:'가상학생가',date:TODAY,answers:{q1:'고침'},round,was}]},email);
 let r=await edit(1,'old');
 assert.deepEqual([r.statusCode,r.body.code],[403,'COUNSEL_EDIT_DENIED']);
 assert.deepEqual(calls.map(c=>c.action),['b2Counsels'],'only the check read');
 assert.deepEqual(calls[0].args,[{cls:'1',name:'가상학생가'}]);
 r=await edit(3,'x');assert.equal(r.body.code,'COUNSEL_GONE');
 r=await edit(2,'stale');assert.deepEqual([r.statusCode,r.body.error],[400,CONFLICT]);
 r=await edit(2,'mine');assert.equal(r.statusCode,200);assert.equal(r.body.data.round,2);
 calls.length=0;r=await edit(1,'old',ADMIN_EMAIL);
 assert.equal(r.statusCode,200);assert.deepEqual(calls.map(c=>c.action),['b2CounselSave'],'admins skip the check');
 assert.equal(counselEditError({cls:'1',name:'가',round:1},[{cls:'1',name:'가',round:'1',author:' Teacher@Test.kr '}],'teacher@test.kr'),'');
});

/* ---------- 담임 화면(운영모니터링 탭) ---------- */
const teacherApi=sheet=>body=>{
 if(!/^b2(Monitor|Counsel)/.test(body.action))return null;
 try{return {body:{ok:true,data:sheet.handle({...body,role:'TEACHER',actor:TEACHER})}};}catch(e){return {body:{ok:false,error:e.message}};}
};
const item=(page,key)=>page.locator(`[data-item="${key}"]`);
async function pickScores(page,scores){for(const [k,v] of Object.entries(scores))await item(page,k).locator(`label.s${v}`).click();}

test('담임: 운영모니터링 › 반 운영 점검 — 원문 양식, 1~5점과 특이사항 저장, 2점 이하는 확인 필요, 다시 열면 채워지고 고치면 was, 그사이 바뀌면 다시 읽기',async()=>{
 const sheet=monitorSheet();
 const errors=await openPortal(async(page,posts)=>{
  assert.deepEqual(await page.locator('[data-main]').allInnerTexts(),['오늘 할 일','출결','서류 발급','민원·설문','운영모니터링','시간표·자료','우리 반']);
  // 오늘 할 일의 4번(예전 1기 설문 링크) → 운영모니터링 탭
  // 카드 단추가 위 탭으로 바로 갑니다(2026-10-21 '오늘 할 일' 개편: 반 운영 점검 · 교육생 면담)
  const task=page.locator('.task-grid [data-t2go="monitoring/checkup"]');await task.waitFor();
  assert.equal(await task.innerText(),'반 운영 점검');
  await task.click();
  await page.locator('[data-view="checkup"]').waitFor();
  assert.deepEqual(await page.locator('#t2Sub [data-subtab]').allInnerTexts(),['반 운영 점검','교육생 면담']);
  const card=page.locator('[data-view="checkup"]');
  const text=await card.innerText();
  for(const s of [M.SURVEY_NOTICE,M.LOW_NOTICE,'5점 매우 우수(문제 없음)','1점 매우 미흡(즉시 확인 필요)','1. 과정 시간표','9. 교육 장비',M.ITEMS[4].desc])assert.ok(text.includes(s),s);
  assert.deepEqual(await card.locator('fieldset legend').allInnerTexts(),['교육 내용','강사 역량','교육생 현황·교육 환경']);
  assert.match(text,/담당 반\s*1반 서울/);assert.match(text,/아직 저장 전/);
  assert.equal(await page.locator('#moDate').inputValue(),TODAY);
  // 다 고르지 않고 저장 → 안내
  await pickScores(page,{schedule:5,content:4});
  await card.getByRole('button',{name:'만족도 조사 저장'}).click();
  assert.match(await card.locator('[data-err]').innerText(),/점수를 모두 골라 주세요: 교재 및 교구, 강의 전달력/);
  assert.equal(posts.filter(p=>p.action==='b2MonitorSave').length,0);
  await pickScores(page,{material:4,delivery:3,communication:4,participation:4,progress:4,facility:2,equipment:5});
  assert.equal(await card.locator('[data-flag]').innerText(),'확인 필요','a 2 shows 확인 필요 before saving');
  await item(page,'facility').locator('[data-note]').fill('에어컨 고장');
  await card.getByRole('button',{name:'만족도 조사 저장'}).click();
  await page.waitForFunction(()=>/저장됨/.test(document.querySelector('#moState')?.textContent||''));
  const first=posts.filter(p=>p.action==='b2MonitorSave').at(-1).args[0];
  assert.deepEqual(first,{cls:'1',date:TODAY,scores:{schedule:5,content:4,material:4,delivery:3,communication:4,participation:4,progress:4,facility:2,equipment:5},notes:{...Object.fromEntries(M.ITEM_KEYS.map(k=>[k,''])),facility:'에어컨 고장'}});
  assert.equal(sheet.mons[0].flag,true);
  // 내 반 저장 기록
  assert.match(await page.locator('#moRec').innerText(),/만족도 제출 이력 1건[\s\S]*확인 필요[\s\S]*교육장 시설/);
  // 다른 날짜로 갔다 돌아오면 채워짐, 고치면 was(지금 sig)
  await page.locator('#moDate').fill(YESTERDAY);await page.locator('#moDate').dispatchEvent('change');
  assert.match(await page.locator('#moState').innerText(),/아직 저장 전/);
  assert.equal(await item(page,'facility').locator('input:checked').count(),0);
  await page.locator('#moRec').getByRole('button',{name:/10\/29/}).click();
  assert.equal(await item(page,'facility').locator('input:checked').getAttribute('value'),'2');
  assert.equal(await item(page,'facility').locator('[data-note]').inputValue(),'에어컨 고장');
  await pickScores(page,{facility:3});
  assert.equal(await card.locator('[data-flag]').count(),0);
  // 그사이 다른 사람이 고침 → CONFLICT → 새로 읽고 값은 그대로, 다시 저장
  sheet.handle({action:'b2MonitorSave',args:[{cls:'1',date:TODAY,scores:full(1),notes:{},was:sheet.mons[0].sig}],actor:'other@test.kr'});
  await page.locator('[data-view="checkup"]').getByRole('button',{name:'만족도 조사 저장'}).click();
  await page.waitForFunction(()=>/그사이 다른 사람이/.test(document.querySelector('[data-view="checkup"] [data-err]')?.textContent||''));
  assert.equal(await item(page,'facility').locator('input:checked').getAttribute('value'),'3','typed values are kept');
  await page.locator('[data-view="checkup"]').getByRole('button',{name:'만족도 조사 저장'}).click();
  await page.waitForFunction(()=>!/그사이/.test(document.querySelector('[data-view="checkup"] [data-err]')?.textContent||'x'));
  const saves=posts.filter(p=>p.action==='b2MonitorSave').map(p=>p.args[0]);
  assert.equal(saves.length,3);assert.equal(saves[1].was,'sig1');assert.equal(saves[2].was,'sig2','the second try carries the fresh sig');
  assert.equal(sheet.mons[0].scores.facility,3);assert.equal(sheet.mons[0].flag,false);
  assert.ok(posts.filter(p=>p.action==='b2Monitors').every(p=>JSON.stringify(p.args)==='[{"cls":"1"}]'));
 },{api:teacherApi(sheet)});
 assert.deepEqual(errors,[]);
});

test('담임: 운영모니터링 › 교육생 면담 — 특별상담 대상(출석률 80% 미만) 거르기, 로테이션 현황, 1차 저장 → 2차, 내 기록 고치기(round·was)',async()=>{
 const sheet=monitorSheet();
 const errors=await openPortal(async(page,posts)=>{
  const card=page.locator('[data-view="counsel"]');await card.waitFor();
  await page.locator('#moStudents').waitFor();
  const text=await card.innerText();
  for(const s of ['1단계 · 상담할 학생 선택',M.SPECIAL_NOTICE])assert.ok(text.includes(s),s);
  assert.match(await page.locator('#moRotation').innerText(),/1회 이상 면담 0\/3명 \(0%\) · 미상담 3명 · 특별상담 대상 미상담 1명/);
  assert.deepEqual(await card.locator('[data-filter]').allInnerTexts(),['특별상담 대상 1명','일반학생 2명','전체 3명']);
  assert.deepEqual(await page.locator('#moStudents tbody tr').evaluateAll(t=>t.map(r=>r.dataset.name)),['가상학생나','가상학생가','가상학생다'],'미상담 special first');
  assert.match(await page.locator('tr[data-name="가상학생나"]').innerText(),/특별상담 대상\s*50%\s*미상담/);
  await card.locator('[data-filter="special"]').click();
  assert.deepEqual(await page.locator('#moStudents tbody tr').evaluateAll(t=>t.map(r=>r.dataset.name)),['가상학생나']);
  await page.locator('[data-filter="normal"]').click();
  assert.deepEqual(await page.locator('#moStudents tbody tr').evaluateAll(t=>t.map(r=>r.dataset.name)),['가상학생가','가상학생다']);
  await page.locator('[data-filter="all"]').click();
  // 1차 면담
  await page.locator('tr[data-name="가상학생가"]').getByRole('button',{name:'1차 면담 작성'}).click();
  const form=page.locator('[data-form]');await form.waitFor();
  const ft=await form.innerText();
  for(const s of ['2단계 · 가상학생가 면담 설문 작성','1반 · 일반학생','대상 교육생','1차 면담',M.SAVE_NOTICE,'1. 일반 인터뷰',...M.QUESTIONS.map(q=>q.label)])assert.ok(ft.includes(s),s);
  await form.getByRole('button',{name:'상담일지 저장'}).click();
  assert.equal(await form.locator('[data-err]').innerText(),'면담 내용을 한 칸 이상 적어 주세요.');
  await form.locator('[data-q="q1"]').fill('실습이 가장 도움이 됐습니다.');await form.locator('[data-q="q3"]').fill('없음');
  await form.getByRole('button',{name:'상담일지 저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  const s1=posts.filter(p=>p.action==='b2CounselSave').at(-1).args[0];
  assert.match(s1.clientId,/^[A-Za-z0-9_-]{8,80}$/);
  assert.deepEqual({...s1,clientId:'x'},{cls:'1',name:'가상학생가',date:TODAY,answers:{q1:'실습이 가장 도움이 됐습니다.',q2:'',q3:'없음',q4:''},clientId:'x'});
  await page.waitForFunction(()=>/1차 완료/.test(document.querySelector('tr[data-name="가상학생가"]')?.textContent||''));
  assert.match(await page.locator('#moRotation').innerText(),/1\/3명 \(33%\)/);
  assert.deepEqual(await page.locator('#moStudents tbody tr').evaluateAll(t=>t.map(r=>r.dataset.name)),['가상학생나','가상학생다','가상학생가'],'counselled students move to the back');
  // 2차 면담: round 없이 저장 → 시트가 2차로
  await page.locator('tr[data-name="가상학생가"]').getByRole('button',{name:'2차 면담 작성'}).click();
  assert.match(await page.locator('#moRound').innerText(),/2차 면담/);
  assert.match(await page.locator('[data-form]').innerText(),/가상학생가 면담 기록 1건[\s\S]*1차[\s\S]*실습이 가장 도움이 됐습니다/);
  await page.locator('[data-form] [data-q="q2"]').fill('진도가 빠릅니다.');
  await page.locator('[data-form]').getByRole('button',{name:'상담일지 저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.deepEqual(sheet.logs.map(l=>[l.name,l.round]),[['가상학생가',1],['가상학생가',2]]);
  await page.waitForFunction(()=>/2차 완료/.test(document.querySelector('tr[data-name="가상학생가"]')?.textContent||''));
  // 내 1차 고치기: round 1 + was
  await page.locator('tr[data-name="가상학생가"]').getByRole('button',{name:'3차 면담 작성'}).click();
  await page.locator('[data-round="1"]').getByRole('button',{name:'고치기'}).click();
  assert.match(await page.locator('#moRound').innerText(),/1차 면담 고치기/);
  assert.equal(await page.locator('[data-form] [data-q="q1"]').inputValue(),'실습이 가장 도움이 됐습니다.');
  await page.locator('[data-form] [data-q="q4"]').fill('추가 상담 필요');
  await page.locator('[data-form]').getByRole('button',{name:'상담일지 저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  const s3=posts.filter(p=>p.action==='b2CounselSave').at(-1).args[0];
  assert.deepEqual([s3.round,s3.was,s3.clientId,s3.answers.q4],[1,'sig1',undefined,'추가 상담 필요']);
  // 특별상담 대상 1차 → 시트가 kind 특별상담 대상
  await page.locator('tr[data-name="가상학생나"]').getByRole('button',{name:'1차 면담 작성'}).click();
  assert.match(await page.locator('[data-form]').innerText(),/1반 · 특별상담 대상/);
  await page.locator('[data-form] [data-q="q3"]').fill('통원 치료');
  await page.locator('[data-form]').getByRole('button',{name:'상담일지 저장'}).click();
  await page.locator('[data-form]').waitFor({state:'detached'});
  assert.equal(sheet.logs.at(-1).kind,'특별상담 대상');
  await page.locator('#moRec [data-rec-tab="counsel"]').click();
  assert.match(await page.locator('#moRec').innerText(),/학생 상담 이력 3건[\s\S]*가상학생나\s*1차\s*특별상담 대상/);
  // 남이 쓴 기록에는 고치기가 없음
  sheet.logs.push({row:9,cls:'1',name:'가상학생다',round:1,date:YESTERDAY,author:'other@test.kr',kind:'일반',answers:{q1:'x',q2:'',q3:'',q4:''},savedAt:'',editedBy:'',confirmed:true,confirmedBy:ADMIN_EMAIL,confirmedAt:'',sig:'o1'});sheet.rev++;
  await page.locator('[data-view="counsel"]').getByRole('button',{name:'새로고침'}).click();
  await page.locator('tr[data-name="가상학생다"]').getByRole('button',{name:'2차 면담 작성'}).click();
  assert.match(await page.locator('[data-round="1"]').innerText(),/운영팀 확인/);
  assert.equal(await page.locator('[data-round="1"]').getByRole('button',{name:'고치기'}).count(),0);
 },{api:teacherApi(sheet),path:'/#t/monitoring/counsel'});
 assert.deepEqual(errors,[]);
});

/* ---------- 관리자 화면(교육 운영 › 운영모니터링) ---------- */
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
const ADMIN_BUNDLE={...BUNDLE,today:'2026-10-30',days:['2026-10-28','2026-10-29','2026-10-30'],
 roster:[...BUNDLE.roster,['3','가상삼가','재학',''],['17','[가상데이터] 학생1','재학',''],['17','[가상데이터] 학생2','재학','']],
 ledger:[...BUNDLE.ledger,BUNDLE.ledgerCols.map(k=>({date:'2026-10-29',cls:'17',name:'[가상데이터] 학생2',type:'결석'})[k]??'')]};
async function adminSite(t,run,sheet){
 backend(t,body=>{if(body.action==='b2Bundle')return {ok:true,data:ADMIN_BUNDLE};if(body.action==='b2Docs')return {ok:true,data:{rev:1,rows:[],statuses:[],types:[],delivery:[]}};if(body.action==='b2Vocs')return {ok:true,data:{rev:1,rows:[]}};return sheetFn(sheet)(body);});
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1360,height:900},acceptDownloads:true}),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.clock.install({time:'2026-10-30T10:00:00+09:00'});
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
  await run(page,posts);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}

test('관리자: 교육 운영 › 운영모니터링 — 반 × 날짜 표(확인 필요 강조), 자세히·운영팀 확인, 확인 필요만, 면담 로테이션·상담일지 확인, CSV 2가지',async t=>{
 const sheet=monitorSheet({today:'2026-10-30'});
 const put=(cls,date,scores,notes={},actor='teacher@test.kr')=>sheet.handle({action:'b2MonitorSave',args:[{cls,date,scores,notes}],actor});
 put('1','2026-10-28',full(5));put('1','2026-10-29',full(4,{facility:1}),{facility:'에어컨 고장'});put('17','2026-10-30',full(3));put('3','2026-10-30',full(2),{},'t3@test.kr');
 sheet.handle({action:'b2CounselSave',args:[{cls:'1',name:'가상학생가',date:'2026-10-29',answers:{q1:'좋습니다',q2:'',q3:'',q4:''}}],actor:'teacher@test.kr'});
 sheet.handle({action:'b2CounselSave',args:[{cls:'17',name:'[가상데이터] 학생1',date:'2026-10-30',answers:{q1:'',q2:'',q3:'',q4:'가상 면담'}}],actor:'t17@test.kr'});
 await adminSite(t,async(page,posts)=>{
  await page.getByRole('button',{name:'교육 운영',exact:true}).click();
  await page.locator('.admin-tabs').getByRole('button',{name:'운영모니터링',exact:true}).click();
  await page.getByRole('heading',{name:'운영모니터링'}).waitFor();
  await page.locator('.mo-grid').waitFor();
  assert.match(await page.locator('.admin-crumb').innerText(),/교육 운영\s+›\s+운영모니터링/);
  assert.deepEqual(await page.locator('.mo-grid thead th').allInnerTexts(),['반','10/28(수)','10/29(목)','10/30(금)','제출','확인 필요']);
  assert.match(await page.locator('.mo-grid tr[data-cls="1"]').innerText(),/1반\s*제출\s*확인 필요\s*·\s*2\/3\s*1/);
  assert.match(await page.locator('.mo-grid tr[data-cls="17"]').innerText(),/17반 · 테스트반\s*·\s*·\s*제출\s*1\/3/,'test class 17 shows normally');
  assert.equal(await page.locator('.mo-grid tr[data-cls="1"]').getAttribute('class'),'hot');
  assert.match(await page.locator('.b2-stats').innerText(),/4\s*제출\s*2\s*확인 필요\s*2\s*확인 필요 · 운영팀 확인 전/);
  // 자세히 → 운영팀 확인
  await page.locator('.mo-grid tr[data-cls="1"] [data-cell="1|2026-10-29"]').click();
  const detail=page.locator('#moDetail');await detail.waitFor();
  assert.match(await detail.innerText(),/1반 · 10\/29\(목\) 반 운영 만족도 조사[\s\S]*확인 필요[\s\S]*작성 teacher@test.kr/);
  assert.match(await detail.locator('tr.hot').innerText(),/교육생 현황·교육 환경\s*교육장 시설\s*1\s*에어컨 고장/);
  assert.equal(await detail.locator('tbody tr').count(),9);
  await detail.getByRole('button',{name:'운영팀 확인'}).click();
  await page.waitForFunction(()=>/운영팀 확인 취소/.test(document.querySelector('#moDetail')?.textContent||''));
  const conf=posts.filter(p=>p.action==='b2MonitorConfirm');
  assert.deepEqual(conf.map(p=>p.args[0]),[{cls:'1',date:'2026-10-29',on:true,was:'sig2'}]);
  assert.equal(sheet.mons.find(r=>r.date==='2026-10-29').confirmedBy,ADMIN_EMAIL);
  assert.match(await page.locator('.mo-grid tr[data-cls="1"]').innerText(),/확인 필요 ✓/);
  // 확인 필요만 + 반 고르기
  await page.locator('#moFlagOnly').check();
  assert.deepEqual(await page.locator('#moList tbody tr').evaluateAll(t=>t.map(r=>r.dataset.key)),['3|2026-10-30','1|2026-10-29']);
  await page.locator('#moClass').selectOption('3');
  assert.deepEqual(await page.locator('#moList tbody tr').evaluateAll(t=>t.map(r=>r.dataset.key)),['3|2026-10-30']);
  assert.equal(await page.locator('.mo-grid tbody tr').count(),1);
  // CSV(만족도): 거른 그대로
  const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'만족도 CSV'}).click()]);
  assert.equal(dl.suggestedFilename(),'2기_운영모니터링_반운영점검_3반_2026-10-17_2026-10-30.csv');
  const csv=readFileSync(await dl.path(),'utf8').replace(/^﻿/,'').split('\r\n');
  assert.equal(csv.length,2);assert.match(csv[0],/^반,날짜,작성자,과정 시간표 점수,과정 시간표 특이사항,/);assert.match(csv[1],/^3,2026-10-30,t3@test.kr,2,,2,/);
  // 교육생 면담: 로테이션(전체 기간), 학생 보기, 상담일지 확인
  await page.locator('#moFlagOnly').uncheck();await page.locator('#moClass').selectOption('all');
  await page.locator('[data-view="counsel"]').click();
  await page.locator('#moRot').waitFor();
  assert.match(await page.locator('#moRot tr[data-cls="1"]').innerText(),/1반\s*3\s*1명 \(33%\)\s*2\s*1\s*0\s*1\s*1/);
  assert.equal(await page.locator('#moRot tr[data-cls="1"]').getAttribute('class'),'hot','특별상담 대상 미상담 → highlighted');
  assert.match(await page.locator('#moRot tr[data-cls="17"]').innerText(),/17반 · 테스트반\s*2\s*1명 \(50%\)\s*1\s*1\s*0\s*1\s*1/,'[가상데이터] 학생2 (absent 1/3) is a special target');
  await page.locator('#moRot tr[data-cls="17"]').getByRole('button',{name:'학생 보기'}).click();
  assert.deepEqual(await page.locator('#moStudents tbody tr').evaluateAll(t=>t.map(r=>r.dataset.name)),['[가상데이터] 학생2','[가상데이터] 학생1']);
  assert.match(await page.locator('tr[data-name="[가상데이터] 학생2"]').innerText(),/특별상담 대상\s*66\.7%\s*미상담/);
  const log=page.locator('details[data-log="17|[가상데이터] 학생1|1"]');
  await log.locator('summary').click();
  assert.match(await log.innerText(),/Q4\. 기타 특이사항\s*가상 면담/);
  await log.getByRole('button',{name:'운영팀 확인'}).click();
  await page.waitForFunction(()=>/운영팀 확인 취소/.test(document.querySelector('details[data-log="17|[가상데이터] 학생1|1"]')?.textContent||''));
  assert.deepEqual(posts.filter(p=>p.action==='b2CounselConfirm').map(p=>p.args[0]),[{cls:'17',name:'[가상데이터] 학생1',round:1,on:true,was:'sig6'}]);
  assert.equal(await page.locator('details[data-log="17|[가상데이터] 학생1|1"]').getAttribute('open'),'','stays open after the re-read');
  const [dl2]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'상담일지 CSV'}).click()]);
  const c2=readFileSync(await dl2.path(),'utf8').replace(/^﻿/,'').split('\r\n');
  assert.equal(dl2.suggestedFilename(),'2기_운영모니터링_상담일지_17반_2026-10-17_2026-10-30.csv');
  assert.equal(c2.length,2);assert.match(c2[1],/^17,\[가상데이터\] 학생1,1차,2026-10-30,일반,t17@test\.kr,,,,가상 면담,확인,hint\.kpc@gmail\.com,/);
  assert.ok(posts.filter(p=>p.action==='b2Monitors'||p.action==='b2Counsels').every(p=>JSON.stringify(p.args)==='[{}]'),'admin reads all classes at once');
 },sheet);
});

test('알림 링크: 관리자 #b2monitor?cls&date는 그 기록을 바로 열고, 담임은 운영모니터링 › 반 운영 점검으로',async t=>{
 const sheet=monitorSheet({today:'2026-10-30'});
 sheet.handle({action:'b2MonitorSave',args:[{cls:'5',date:'2026-10-29',scores:full(4,{equipment:2}),notes:{}}],actor:'t5@test.kr'});
 await adminSite(t,async page=>{
  await page.getByRole('button',{name:'교육 운영',exact:true}).click();
  await page.locator('.admin-tabs').getByRole('button',{name:'운영모니터링',exact:true}).click();
  await page.locator('.mo-grid').waitFor();
  // 관리자 화면 이동(open)이 받는 문맥과 같은 값으로 다시 엽니다.
  const html=await page.evaluate(async()=>{const m=await import('/beta2-monitoring.mjs');const {createBeta2Client}=await import('/beta2-data.mjs');const host=document.createElement('div');document.body.append(host);
   await m.mount(host,{client:createBeta2Client({getIdToken:async()=>'tok-1'},{admin:true}),classes:Array.from({length:17},(_,i)=>({id:String(i+1),course:''})),context:{classId:'5',date:'2026-10-29'}});return host.querySelector('#moDetail')?.innerText||'';});
  assert.match(html,/5반 · 10\/29\(목\) 반 운영 만족도 조사[\s\S]*교육 장비\s*2/);
 },sheet);
});
