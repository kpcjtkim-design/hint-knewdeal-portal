import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetSeed,sheetClassEntries,overlay,sheetWrites,teacherEntries,baseSourceLabel,SHEET_SOURCE_LABEL} from '../../timetable-source.mjs';
import handler,{b2Args,FIREBASE,ACCESS} from '../../api/teacher-beta.js';
// 2기 시간표 원본 = 마스터시트 교육일정(b2Schedule, 사용자 2026-10-20 '시간표가 여기서 변경되면 담임·관리자 화면에서 반영 … 관리자만 사이트에서 변경 가능').
// 시트 응답은 2기 배포 ① v11 실제 응답 모양(rev·defaults·rows[date,dow,mark,cls,subject,hours,instructor,field,start,end,lateAfter,earlyBefore,source]).

const lesson=(cid,date,lectureId,module,title,day,extra={})=>({id:`x2-${cid}-${date}`,date,course:'모빌리티 AI',module,lectureId,title,day,hours:8,start:'',end:'',instructorId:'',instructorName:'',venue:'',online:false,note:'',kind:'class',event:'',origin:{subject:'both'},sourceRow:9,sourceText:title,...extra});
const seed={version:'20261014',source:'fixture.xlsx',courses:['모빌리티 AI'],modules:['공통행사','디지털스킬','공장견학'],
 lectures:[{id:'t2-1',course:'모빌리티 AI',module:'공통행사',title:'입교식',days:3},{id:'t2-2',course:'모빌리티 AI',module:'디지털스킬',title:'디지털스킬',days:6},{id:'t2-5',course:'모빌리티 AI',module:'공장견학',title:'화성공장 · 견학·이론',days:1},{id:'t2-9',course:'모빌리티 AI',module:'디지털스킬',title:'파이썬 기초',days:2}],
 classes:{'1':{classId:'1',entries:[
  lesson('1','2026-10-28','t2-1','공통행사','입교식',1,{hours:4,instructorName:'조해정',event:'입교식'}),
  lesson('1','2026-10-29','t2-1','공통행사','입교식',2,{instructorName:'조해정',event:'입교식'}),
  lesson('1','2026-11-12','t2-2','디지털스킬','디지털스킬',1),
  lesson('1','2026-11-13','t2-5','공장견학','화성공장 · 견학·이론',1,{sourceText:'화성공장(견학+이론)',venue:'화성공장',event:'공장견학'}),
  {id:'holiday-1-2026-12-25',date:'2026-12-25',course:'모빌리티 AI',module:'휴일',lectureId:'',title:'성탄절',day:0,hours:0,start:'',end:'',instructorId:'',instructorName:'',venue:'',online:false,note:'',kind:'holiday',event:''}]},
  '2':{classId:'2',entries:[lesson('2','2026-10-28','t2-1','공통행사','입교식',1,{event:'입교식'})]}}};
const row=(date,subject,hours,instructor,extra={})=>({date,dow:'',mark:'O',cls:'1',subject,hours,instructor,field:[],start:'09:00',end:'18:00',lateAfter:'09:10',earlyBefore:'17:50',source:'기본',...extra});
const sheet={rev:42,defaults:{start:'09:00',end:'18:00',graceMin:10},rows:[
 row('2026-10-28','입교식',4,'조해정'),row('2026-10-29','입교식',8,'조해정'),
 row('2026-10-31','',0,'',{mark:''}),// 주말: 과목 없음 → 넣지 않음
 row('2026-11-12','파이썬 기초',6,'김강사'),// 엑셀(디지털스킬)과 다른 과목: 시트 값 + 엑셀 과목명 표시, 강의 목록의 같은 이름 강의로
 row('2026-11-13','화성공장(견학+이론)',8,'',{field:[{row:5,module:'화성공장(견학+이론)',start:'10:00',end:'17:00',part:''}],start:'10:00',end:'17:00',lateAfter:'10:10',earlyBefore:'16:50',source:'현장교육 일정'}),
 row('2026-11-16','기업 특강',3,'박강사'),// 엑셀에 없는 날·없는 강의
 row('2026-12-25','',0,'',{mark:'휴일'}),
 {...row('2026-10-28','입교식',4,'조해정'),cls:'17'}]};

test('b2Schedule rows overwrite subject, hours, instructor and times; module, lecture, event and venue are filled from the Excel seed',()=>{
 const s=sheetSeed(seed,sheet),one=s.classes['1'];
 assert.equal(one.sheet,true);assert.equal(s.sheet.rev,42);assert.equal(s.source,'2기 마스터시트 교육일정');
 assert.deepEqual(one.entries.map(e=>e.date),['2026-10-28','2026-10-29','2026-11-12','2026-11-13','2026-11-16','2026-12-25'],'weekend without a subject is skipped');
 const [d1,d2,changed,field,extra,holiday]=one.entries;
 assert.deepEqual([d1.title,d1.hours,d1.instructorName,d1.start,d1.end,d1.module,d1.lectureId,d1.event,d1.day],['입교식',4,'조해정','09:00','18:00','공통행사','t2-1','입교식',1]);
 assert.equal(d2.day,2);assert.equal(d1.seedTitle,undefined);
 assert.deepEqual([changed.title,changed.seedTitle,changed.lectureId,changed.module,changed.hours,changed.instructorName],['파이썬 기초','디지털스킬','t2-9','디지털스킬',6,'김강사'],'sheet subject wins; differing Excel title is kept as a small marker');
 assert.deepEqual([field.title,field.lectureId,field.module,field.event,field.venue,field.start,field.end,field.seedTitle],['화성공장(견학+이론)','t2-5','공장견학','공장견학','화성공장','10:00','17:00',undefined],'Excel source text counts as the same subject');
 assert.deepEqual([extra.title,extra.module,extra.lectureId,extra.hours,extra.day],['기업 특강','기타','',3,1]);
 assert.deepEqual([holiday.kind,holiday.title,holiday.id],['holiday','성탄절','holiday-1-2026-12-25']);
 assert.deepEqual(s.classes['2'],seed.classes['2'],'class without sheet rows keeps the Excel seed');
 assert.equal(s.classes['17'].sheet,true,'test class 17 comes from the sheet too');assert.equal(s.classes['17'].entries[0].module,'공통행사','17 is filled from class 1 Excel');
 assert.equal(baseSourceLabel(s,'1'),SHEET_SOURCE_LABEL);assert.match(baseSourceLabel(seed,'17'),/1반 일정 예시/);
 assert.equal(teacherEntries(one.entries).some(e=>'seedTitle' in e||'sourceText' in e||'origin' in e),false);
 assert.equal(teacherEntries(one.entries)[0].instructorName,'조해정','teachers keep the sheet instructor name');
});

test('site-only details ride on the sheet by date; only real admin changes become b2ScheduleSave rows with the current sheet values as was',()=>{
 const sheetEntries=sheetClassEntries(seed,'1',sheet.rows.filter(r=>r.cls==='1'));
 const site=[{...seed.classes['1'].entries[0],instructorId:'t1',note:'노트북 지참',venue:'본관 301',title:'(예전 제목)',hours:1}];
 const view=overlay(sheetEntries,site),instructors={t1:{name:'조해정'},t2:{name:'최강사'}};
 assert.deepEqual([view[0].instructorId,view[0].note,view[0].venue,view[0].title,view[0].hours],['t1','노트북 지참','본관 301','입교식',4],'site info only, never the sheet fields');
 assert.deepEqual(sheetWrites('1',view,view,sheetEntries,instructors),[],'nothing changed → nothing written');
 assert.deepEqual(sheetWrites('1',view.map(e=>e.date==='2026-10-28'?{...e,note:'다른 메모'}:e),view,sheetEntries,instructors),[],'a note is site-only');
 // 강사만 바꿈 → 강사만 보냄(빠진 값은 시트가 그대로 둠)
 assert.deepEqual(sheetWrites('1',view.map(e=>e.date==='2026-11-12'?{...e,instructorId:'t2'}:e),view,sheetEntries,instructors),
  [{cls:'1',date:'2026-11-12',instructor:'최강사',was:{subject:'파이썬 기초',instructor:'김강사',hours:6}}]);
 // 다른 빈 날로 옮기기 → 옛 날은 비우고 새 날에 씀
 const moved=view.map(e=>e.date==='2026-11-16'?{...e,date:'2026-11-17'}:e);
 assert.deepEqual(sheetWrites('1',moved,view,sheetEntries,instructors),[
  {cls:'1',date:'2026-11-16',subject:'',hours:0,instructor:'',was:{subject:'기업 특강',instructor:'박강사',hours:3}},
  {cls:'1',date:'2026-11-17',subject:'기업 특강',hours:3,instructor:'박강사',was:{subject:'',instructor:'',hours:0}}]);
 // 맞바꾸기 → 두 날 모두 과목·시간·강사
 const a=view.find(e=>e.date==='2026-11-12'),b=view.find(e=>e.date==='2026-11-16');
 const swapped=sheetWrites('1',view.map(e=>e===a?{...a,date:b.date}:e===b?{...b,date:a.date}:e),view,sheetEntries,instructors);
 assert.deepEqual(swapped.map(r=>[r.date,r.subject,r.hours,r.instructor]),[['2026-11-12','기업 특강',3,'박강사'],['2026-11-16','파이썬 기초',6,'김강사']]);
 assert.throws(()=>sheetWrites('1',view.map(e=>e.date==='2026-11-16'?{...e,date:'2026-11-12'}:e),view,sheetEntries,instructors),/하루 한 수업만/);
});

/* ---------- Vercel 중계: b2Schedule 담임은 자기 반, b2ScheduleSave는 관리자만 ---------- */
const SHEET='https://script.test/exec',KEY='secret-key-123',ADMIN_EMAIL='hint.kpc@gmail.com';
const PROFILES={'teacher@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'},tempClassIds:{arrayValue:{values:[{stringValue:'7'}]}}}};
function backend(t){
 const calls=[],saved={...FIREBASE},access=ACCESS.teacher,env={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 Object.assign(FIREBASE,{ready:true,key:'fb-key',project:'hint-test'});process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY=KEY;ACCESS.teacher=true;
 t.after(()=>{Object.assign(FIREBASE,saved);ACCESS.teacher=access;for(const [k,v] of [['HINT_SHEET_API_URL',env.url],['HINT_SHEET_API_KEY',env.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return Response.json({users:[{email:idToken.slice(4)}]});}
  if(url.startsWith('https://firestore.googleapis.com/')){const email=decodeURIComponent(url.split('/users/')[1]);return PROFILES[email]?Response.json({fields:PROFILES[email]}):Response.json({},{status:404});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push(body);return Response.json({ok:true,data:{rows:[],rev:1}});}
  throw Error('unexpected fetch '+url);
 });
 return calls;
}
async function call(body,email=ADMIN_EMAIL){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);return res;
}
test('teachers read only their own class timetable from the sheet and can never write it; admins read all and write with class checks',async t=>{
 const calls=backend(t);
 for(const [arg,want] of [[{cls:'9'},{cls:'3'}],[{},{cls:'3'}],[{cls:'all'},{cls:'3'}],[{cls:'7',from:'2026-11-01'},{cls:'7',from:'2026-11-01'}]]){
  const res=await call({action:'b2Schedule',args:[arg]},'teacher@test.kr');
  assert.equal(res.statusCode,200);assert.deepEqual([calls.at(-1).args,calls.at(-1).role],[[want],'TEACHER'],JSON.stringify(arg));
 }
 const before=calls.length;
 const res=await call({action:'b2ScheduleSave',args:[{rows:[{cls:'3',date:'2026-11-12',subject:'x',was:{subject:'',instructor:''}}]}]},'teacher@test.kr');
 assert.deepEqual([res.statusCode,res.body.code],[403,'ADMIN_ONLY']);assert.equal(calls.length,before,'teacher writes never reach the sheet');
 await call({action:'b2Schedule',args:[{}]});assert.deepEqual([calls.at(-1).args,calls.at(-1).role],[[{}],'ADMIN'],'admin: every class (17 included on the sheet side)');
 await call({action:'b2Schedule',args:[{cls:'17'}]});assert.deepEqual(calls.at(-1).args,[{cls:'17'}]);
 await call({action:'b2ScheduleSave',args:[{rows:[{cls:'1',date:'2026-11-12',instructor:'최강사',was:{subject:'파이썬 기초',instructor:'김강사'}}]}]});
 assert.deepEqual(calls.at(-1).args,[{rows:[{cls:'1',date:'2026-11-12',instructor:'최강사',was:{subject:'파이썬 기초',instructor:'김강사'}}]}]);
 const bad=await call({action:'b2ScheduleSave',args:[{rows:[{cls:'99',date:'2026-11-12',subject:'x',was:{}}]}]});assert.notEqual(bad.statusCode,200,'class numbers are checked per row');
 const teacher={role:'TEACHER',classIds:['3']},admin={role:'ADMIN',classIds:[]};
 assert.deepEqual(b2Args(teacher,'b2Schedule',[]),[{cls:'3'}]);assert.deepEqual(b2Args(admin,'b2Schedule',[{cls:''}]),[{}]);
 assert.deepEqual(b2Args(admin,'b2ScheduleSave',[{cls:'2',date:'2026-11-12',hours:4,was:{subject:'a',instructor:''}}]),[{cls:'2',date:'2026-11-12',hours:4,was:{subject:'a',instructor:''}}]);
});
