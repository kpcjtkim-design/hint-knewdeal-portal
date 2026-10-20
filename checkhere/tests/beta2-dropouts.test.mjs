import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import handler,{b2Args,teacherCancelError,FIREBASE,ACCESS} from '../../api/teacher-beta.js';
import {decodeBundle} from '../../beta2-core.mjs';
import {absenceLevel,absenceRows,suggestVerdict,checkDropout,savePayload,formOf,sameForm,completionRows,official,statusBatches,TEACHER_FIELDS,DROPOUT_COLUMNS,requestPayload,byTeacher,requestState,canCancel} from '../../beta2-dropout-core.mjs';
import {TRAINING_DAYS,COURSE_END} from '../../cohort.mjs';
import {KINDS,teacherTarget} from '../../notify-core.mjs';

// 2기 중도탈락·수료(사용자 요청 2026-10-20: 마스터시트 '중도탈락' 탭(gid 4002)을 관리자 화면에서 모두 처리, 담임이 등록하면 관리자도 손봄). 학생·담임은 모두 가상입니다.
const base=join(import.meta.dirname,'../..');
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const TODAY='2026-12-10',PAST=TRAINING_DAYS.filter(d=>d<=TODAY);
const absent=(cls,name,n)=>PAST.slice(0,n).map(date=>COLS.map(k=>({date,cls,name,type:'결석',evApplied:'해당없음',prov:'베타 수정'})[k]??''));
const ROSTER=()=>[['1','고다원','재학',''],['1','김동진','재학',''],['1','박서연','재학',''],['1','이하늘','재학',''],['1','한수빈','중도탈락','2026-11-02','개인 사정'],['1','최유진','조기취업','2026-11-20','11/23 입사'],['1','정민호','재학',''],
 ['2','이경수','재학',''],['17','테스트갑','재학',''],['17','테스트을','중도탈락','2026-11-05','시험']];
const LEDGER=()=>[...absent('1','고다원',13),...absent('1','김동진',12),...absent('1','박서연',10),...absent('1','최유진',2),...absent('17','테스트갑',13)];
const DROP=(o)=>({startDate:'',verdict:'',basis:'',docs:{resign:'',offer:'',proof:''},contact:'',note:'',by:'teacher@test.kr',at:'2026-11-21 10:00',confirmed:false,confirmedBy:'',confirmedAt:'',...o});
const DROPS=()=>[DROP({row:2,cls:'1',name:'한수빈',kind:'중도탈락',reason:'개인 사정',lastDate:'2026-11-02',verdict:'제적',basis:'중도탈락(조기취업 아님)',docs:{resign:'O',offer:'',proof:''},contact:'11/3 통화',confirmed:true,confirmedBy:'hint.kpc@gmail.com',confirmedAt:'2026-11-04 09:00'}),
 DROP({row:3,cls:'1',name:'최유진',kind:'조기취업',reason:'11/23 입사',startDate:'2026-11-23',lastDate:'2026-11-20',docs:{resign:'',offer:'O',proof:''},contact:'인사팀 확인'}),
 DROP({row:4,cls:'17',name:'테스트을',kind:'중도탈락',reason:'시험',lastDate:'2026-11-05'})];
const rawBundle=(roster=ROSTER(),ledger=LEDGER())=>({rev:7,today:TODAY,days:[...TRAINING_DAYS],classes:Array.from({length:17},(_,i)=>({id:String(i+1)})),roster,ledgerCols:COLS,ledger,sync:{}});

/* ---------- 순수 함수(beta2-dropout-core.mjs) ---------- */
test('the 12-day absence limit: 12 days still completes (80% of 60), 13 is 제적 대상, 10~11 is a warning',()=>{
 assert.equal(TRAINING_DAYS.length,60,'2기 60 training days');
 assert.deepEqual([9,10,11,12,13].map(n=>absenceLevel(n,12).level),['','주의','주의','한도 도달','제적 대상']);
 assert.equal(absenceLevel(10,12).left,2);assert.equal(absenceLevel(5,0).left,7,'no limit from the sheet → 12');
 const b=decodeBundle(rawBundle()),rows=absenceRows(b,{max:12});
 assert.deepEqual(rows.slice(0,4).map(r=>[r.cls,r.name,r.absent,r.level]),[['1','고다원',13,'제적 대상'],['17','테스트갑',13,'제적 대상'],['1','김동진',12,'한도 도달'],['1','박서연',10,'주의']],'test class row is listed');
 assert.equal(official(rows).some(r=>r.cls==='17'),false,'…but not in the official totals');
 assert.equal(absenceRows(b,{cls:'17'}).length,2,'picking the test class shows only it');
 assert.equal(rows.find(r=>r.name==='한수빈').absent,0,'only days up to the last attendance day count');
});

test('verdict: 중도탈락 is 제적; 조기취업 counts ledger absences up to the last day plus missed days before the job start',()=>{
 const b=decodeBundle(rawBundle());
 assert.deepEqual(suggestVerdict({kind:'중도탈락',cls:'1',name:'한수빈',lastDate:'2026-11-02'},b),{verdict:'제적',basis:'중도탈락(조기취업 아님) · 마지막 출석 11/2',absent:null});
 const ok=suggestVerdict({kind:'조기취업',cls:'1',name:'최유진',startDate:'2026-11-23',lastDate:'2026-11-20'},b);
 assert.equal(ok.verdict,'수료가능');assert.equal(ok.absent,2);assert.match(ok.basis,/근로개시\(11\/23\) 전 결석 2일\(출결원장 2일 \+ 마지막 출석 뒤 미출석 0일\) ≤ 한도 12일/);
 // 11/2 마지막 출석, 12/1 근로개시: 그 사이 교육일 20일이 미출석 → 제적
 const gap=suggestVerdict({kind:'조기취업',cls:'1',name:'최유진',startDate:'2026-12-01',lastDate:'2026-11-02'},b);
 assert.equal(gap.verdict,'제적');assert.match(gap.basis,/마지막 출석 뒤 미출석 20일\) · 한도 12일 초과/);
 const soon=suggestVerdict({kind:'조기취업',cls:'1',name:'이하늘',startDate:'2026-12-21',lastDate:'2026-12-18'},b);
 assert.equal(soon.verdict,'확인중');assert.match(soon.basis,/마지막 출석일까지 교육일 6일이 남아 있습니다/);
 assert.equal(suggestVerdict({kind:'조기취업',cls:'1',name:'없는사람',startDate:'2026-12-01',lastDate:'2026-11-30'},b).basis,'명부에서 학생을 찾지 못했습니다.');
 assert.equal(suggestVerdict({kind:'조기취업',cls:'1',name:'최유진',lastDate:'2026-11-20'},b).verdict,'확인중');
});

test('input check mirrors the sheet; teachers send only their fields and confirm is sent only when it changes',()=>{
 const f={cls:'1',name:'가',kind:'중도탈락',lastDate:'2026-11-10'};
 assert.equal(checkDropout(f),'');
 for(const [c,want] of [[{cls:'18'},'반을 골라 주세요.'],[{name:' '},'이름을 골라 주세요.'],[{kind:'중도포기'},'구분은 중도탈락·조기취업 가운데 하나를 골라 주세요.'],[{lastDate:''},'마지막 출석일을 넣어 주세요.'],[{lastDate:'11/10'},'마지막 출석일을 날짜로 넣어 주세요.'],
  [{lastDate:'2027-02-01'},'마지막 출석일은 2기 교육 기간(10/28~1/22) 안이어야 합니다.'],[{kind:'조기취업'},'조기취업은 근로개시일을 넣어 주세요.'],[{reason:'가'.repeat(201)},'사유는 200자 이하로 적어 주세요.'],[{verdict:'합격'},'판정은 수료가능·제적·확인중 가운데 하나입니다.'],
  [{docs:{resign:'예'}},'서류는 O·X·해당없음 가운데 하나로 골라 주세요.'],[{contact:'가'.repeat(301)},'판정 근거·연락 확인은 300자 이하로 적어 주세요.']])assert.equal(checkDropout({...f,...c}),want,JSON.stringify(c));
 assert.equal(checkDropout({...f,verdict:'합격'},{admin:false}),'','teachers never send a verdict');
 const cur=DROPS()[1],form={...formOf(cur),reason:'11/23 ○○ 입사',verdict:'수료가능',confirmed:true};
 assert.deepEqual(savePayload(form,cur,{admin:false}),{row:3,was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',kind:'조기취업',reason:'11/23 ○○ 입사',startDate:'2026-11-23',lastDate:'2026-11-20',note:''});
 assert.deepEqual(Object.keys(savePayload(form,cur)),['row','was','cls','name','kind','reason','startDate','lastDate','note','verdict','basis','docs','contact','confirm']);
 assert.equal(savePayload({...form,confirmed:false},cur).confirm,undefined,'unchanged confirm is not sent (keeps 확인자·확인시각)');
 assert.equal(sameForm(cur,{...cur,at:'later'}),true);assert.equal(sameForm(cur,{...cur,note:'x'}),false);
 assert.deepEqual(TEACHER_FIELDS,['name','kind','reason','startDate','lastDate','note']);
 assert.equal(DROPOUT_COLUMNS.length,18,'sheet columns A~R');
});

test('teacher request helpers: payload has only teacher columns (근로개시일 only for 조기취업), teacher-made rows, state, and who may cancel',()=>{
 assert.deepEqual(requestPayload({cls:'1',name:' 정민호 ',kind:'중도탈락',reason:'이사',startDate:'2026-12-14',lastDate:'2026-12-11',note:'',verdict:'제적',confirmed:true}),{cls:'1',name:'정민호',kind:'중도탈락',reason:'이사',startDate:'',lastDate:'2026-12-11',note:''});
 assert.equal(requestPayload({kind:'조기취업',startDate:'2026-12-14'}).startDate,'2026-12-14');
 assert.deepEqual([byTeacher({by:'teacher@test.kr'}),byTeacher({by:'HINT.KPC@gmail.com'}),byTeacher({by:''}),byTeacher({by:'Apps Script'})],[true,false,false,false],'admins (cohort.json) and hand-entered rows are not teacher requests');
 assert.deepEqual([requestState({confirmed:false}),requestState({confirmed:true})],['접수','확인 완료']);
 const [confirmed,open]=DROPS();
 assert.deepEqual([canCancel(open,'teacher@test.kr'),canCancel(open,'TEACHER@test.kr'),canCancel(open,'other@test.kr'),canCancel(open,''),canCancel(confirmed,'teacher@test.kr')],[true,true,false,false,false]);
});

test('completion list: 명부 수료 and confirmed 조기취업 수료가능 complete; the rest say why not; batches split per class',()=>{
 const b=decodeBundle(rawBundle(ROSTER().map(r=>r[1]==='정민호'?['1','정민호','수료','2027-01-22']:r)));
 const drops=DROPS().map(d=>d.name==='최유진'?{...d,verdict:'수료가능'}:d);
 let rows=completionRows(b,{dropouts:drops,completions:[{cls:'1',name:'정민호',via:'수료'}]});
 const by=n=>rows.find(r=>r.name===n);
 assert.deepEqual([by('정민호').outcome,by('최유진').outcome,by('최유진').why],['수료','확인 대기','조기취업 · 판정 수료가능 · 관리자 확인 전']);
 assert.deepEqual([by('한수빈').outcome,by('한수빈').why],['미수료','중도탈락 · 마지막 출석 11/2 · 개인 사정']);
 assert.deepEqual([by('고다원').outcome,by('고다원').why],['미수료','결석 13일 · 한도 12일 초과(제적 대상)']);
 assert.deepEqual([by('김동진').outcome,by('이하늘').outcome],['수료 예정','수료 예정']);
 assert.ok(rows.some(r=>r.cls==='17'));assert.equal(official(rows).some(r=>r.cls==='17'),false);
 rows=completionRows(b,{dropouts:drops,completions:[{cls:'1',name:'최유진',via:'조기취업 수료'}]});
 assert.equal(rows.find(r=>r.name==='최유진').outcome,'수료');
 const items=[...Array.from({length:70},(_,i)=>({cls:'1',name:'a'+i})),{cls:'2',name:'b'}];
 assert.deepEqual(statusBatches(items).map(p=>[p[0].cls,p.length]),[['1',60],['1',10],['2',1]]);
 assert.ok(KINDS.includes('중도탈락'));assert.deepEqual(teacherTarget('b2dropouts'),['attendance','dropout']);
});

/* ---------- Vercel 중계(api/teacher-beta.js) ---------- */
const SHEET='https://script.test/exec',KEY='secret-key-123',ADMIN_EMAIL='hint.kpc@gmail.com',TEACHER='teacher@test.kr';
const PROFILES={[TEACHER]:{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'1'},tempClassIds:{arrayValue:{values:[{stringValue:'7'}]}}}};
function backend(t,sheet){
 const calls=[],saved={...FIREBASE},access=ACCESS.teacher,env={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 Object.assign(FIREBASE,{ready:true,key:'fb-key',project:'hint-test'});ACCESS.teacher=true;process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY=KEY;
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

test('administrators read every class and send every column; class numbers (also was.cls and each batch row) are checked on the server',async t=>{
 const calls=backend(t,()=>({ok:true,data:{rows:[]}}));
 await call({action:'b2Dropouts',args:[{}]});await call({action:'b2Dropouts',args:[{cls:'all'}]});await call({action:'b2Completions',args:[{cls:'5'}]});
 assert.deepEqual(calls.map(c=>[c.action,c.args,c.role]),[['b2Dropouts',[{}],'ADMIN'],['b2Dropouts',[{}],'ADMIN'],['b2Completions',[{cls:'5'}],'ADMIN']]);
 const full={row:3,was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',kind:'조기취업',reason:'',startDate:'2026-11-23',lastDate:'2026-11-20',verdict:'수료가능',basis:'b',docs:{resign:'',offer:'O',proof:''},contact:'c',note:'',confirm:true};
 await call({action:'b2DropoutSave',args:[full]});assert.deepEqual(calls.at(-1).args,[full],'admin: everything goes through');assert.equal(calls.at(-1).actor,ADMIN_EMAIL);
 const many=[{cls:'1',name:'이하늘',status:'수료',changed:COURSE_END,reason:'수료'}];
 await call({action:'b2RosterStatusMany',args:[{rows:many}]});assert.deepEqual(calls.at(-1).args,[{rows:many}]);
 const before=calls.length;
 for(const [action,arg] of [['b2DropoutSave',{...full,cls:'18'}],['b2DropoutSave',{...full,was:{cls:'0',name:'x'}}],['b2RosterStatusMany',{rows:[...many,{cls:'99',name:'x',status:'수료'}]}],['b2Completions',{cls:'x'}]]){
  const res=await call({action,args:[arg]});assert.deepEqual([res.statusCode,res.body.code],[400,'BAD_CLASS'],JSON.stringify(arg));
 }
 assert.equal(calls.length,before,'bad class numbers never reach the sheet');
});

test('teachers only request (사용자 2026-10-20 신청 개념): own class, teacher columns, new rows only; cancel only their own unconfirmed request; no batch status',async t=>{
 const rows=[...DROPS(),DROP({row:5,cls:'1',name:'이하늘',kind:'중도탈락',reason:'운영팀 등록',lastDate:'2026-12-01',by:ADMIN_EMAIL}),DROP({row:6,cls:'1',name:'박서연',kind:'중도탈락',lastDate:'2026-12-02',by:'Teacher@Test.kr'})];
 const calls=backend(t,body=>body.action==='b2Dropouts'?{ok:true,data:{rev:7,maxAbsence:12,rows:rows.filter(r=>r.cls===body.args[0].cls)}}:{ok:true,data:{ok:true,row:9,rev:8}});
 await call({action:'b2Dropouts',args:[{}]},TEACHER);await call({action:'b2Dropouts',args:[{cls:'5'}]},TEACHER);await call({action:'b2Completions',args:[{cls:'all'}]},TEACHER);await call({action:'b2Dropouts',args:[{cls:'7'}]},TEACHER);
 assert.deepEqual(calls.map(c=>[c.action,c.args[0].cls,c.role]),[['b2Dropouts','1','TEACHER'],['b2Dropouts','1','TEACHER'],['b2Completions','1','TEACHER'],['b2Dropouts','7','TEACHER']],'temporary class 7 is theirs too');
 calls.length=0;
 // 신청(새 줄): 다른 반·관리자 칸·확인·등록자는 빠집니다. 목록을 먼저 읽지 않습니다.
 await call({action:'b2DropoutSave',args:[{cls:'5',name:'정민호',kind:'조기취업',reason:'입사',startDate:'2026-12-14',lastDate:'2026-12-11',note:'n',verdict:'수료가능',basis:'x',docs:{resign:'O'},contact:'y',confirm:true,by:'someone'}]},TEACHER);
 assert.deepEqual(calls.map(c=>[c.action,c.args]),[['b2DropoutSave',[{cls:'1',name:'정민호',kind:'조기취업',reason:'입사',startDate:'2026-12-14',lastDate:'2026-12-11',note:'n'}]]]);
 calls.length=0;
 // 있는 줄 고치기는 거절(시트에 가지 않음): row나 was가 있는 저장
 for(const arg of [{row:3,was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',kind:'조기취업',reason:'11/23 입사(정규직)',startDate:'2026-11-23',lastDate:'2026-11-20'},{row:3,cls:'1',name:'최유진',kind:'조기취업',lastDate:'2026-11-20',startDate:'2026-11-23'},{was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',kind:'중도탈락',lastDate:'2026-11-20'}]){
  const res=await call({action:'b2DropoutSave',args:[arg]},TEACHER);
  assert.deepEqual([res.statusCode,res.body.code,res.body.error],[403,'DROPOUT_REQUEST_ONLY','신청한 뒤에는 고칠 수 없습니다. 고칠 내용은 운영팀에 알려 주세요.'],JSON.stringify(arg));
 }
 assert.equal(calls.length,0,'edits never reach the sheet');
 // 신청 취소: 먼저 그 반 목록을 읽어 자기 신청·확인 전인지 보고, 괜찮으면 row·was·remove만 보냄
 await call({action:'b2DropoutSave',args:[{row:3,was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',remove:true,kind:'중도탈락',verdict:'제적',confirm:true}]},TEACHER);
 assert.deepEqual(calls.map(c=>[c.action,c.args]),[['b2Dropouts',[{cls:'1'}]],['b2DropoutSave',[{cls:'1',name:'최유진',row:3,was:{cls:'1',name:'최유진'},remove:true}]]]);
 calls.length=0;
 await call({action:'b2DropoutSave',args:[{row:6,was:{cls:'1',name:'박서연'},cls:'1',name:'박서연',remove:true}]},TEACHER);
 assert.deepEqual(calls.map(c=>c.action),['b2Dropouts','b2DropoutSave'],'registrant e-mail is compared without case');
 calls.length=0;
 // 거절: 관리자 확인된 줄, 남(관리자)이 넣은 줄, 없는 줄·바뀐 줄, 다른 반 줄(자기 반으로 바뀌어 그 반에서 못 찾음), 줄 번호 없음
 for(const [arg,code,status] of [[{row:2,was:{cls:'1',name:'한수빈'},cls:'1',name:'한수빈'},'DROPOUT_CANCEL_DENIED',403],[{row:5,was:{cls:'1',name:'이하늘'},cls:'1',name:'이하늘'},'DROPOUT_CANCEL_DENIED',403],
  [{row:99,was:{cls:'1',name:'x'},cls:'1',name:'x'},'DROPOUT_GONE',409],[{row:3,was:{cls:'1',name:'다른이름'},cls:'1',name:'다른이름'},'DROPOUT_GONE',409],[{row:4,was:{cls:'17',name:'테스트을'},cls:'17',name:'테스트을'},'DROPOUT_GONE',409]]){
  calls.length=0;
  const res=await call({action:'b2DropoutSave',args:[{...arg,remove:true}]},TEACHER);
  assert.deepEqual([res.statusCode,res.body.code],[status,code],JSON.stringify(arg));
  assert.deepEqual(calls.map(c=>c.action),['b2Dropouts'],'only the read reaches the sheet');
 }
 calls.length=0;
 for(const arg of [{was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',remove:true},{row:3,cls:'1',name:'최유진',remove:true},{row:'x',was:{cls:'1',name:'최유진'},remove:true}]){
  const res=await call({action:'b2DropoutSave',args:[arg]},TEACHER);assert.deepEqual([res.statusCode,res.body.code],[400,'BAD_REQUEST'],JSON.stringify(arg));
 }
 assert.equal(calls.length,0);
 assert.equal(teacherCancelError({row:3,was:{cls:'1',name:'최유진'}},rows,'teacher@test.kr'),'');
 assert.equal(teacherCancelError({row:3,was:{cls:'1',name:'최유진'}},rows,'other@test.kr'),'DROPOUT_CANCEL_DENIED');
 const res=await call({action:'b2RosterStatusMany',args:[{rows:[{cls:'1',name:'이하늘',status:'수료',changed:COURSE_END}]}]},TEACHER);
 assert.deepEqual([res.statusCode,res.body.code,calls.length],[403,'ADMIN_ONLY',0]);
 const teacher={role:'TEACHER',classIds:['1']};
 assert.deepEqual(b2Args(teacher,'b2Completions',[]),[{cls:'1'}]);
 assert.deepEqual(b2Args({role:'ADMIN'},'b2Completions',[{cls:''}]),[{}]);
});

test('teacher cancel: if reading the class rows fails, that error is returned and nothing is removed; admins remove without the read',async t=>{
 const calls=backend(t,body=>body.action==='b2Dropouts'?{ok:false,error:'마스터시트를 읽지 못했습니다.'}:{ok:true,data:{ok:true,removed:3,rev:8}});
 const res=await call({action:'b2DropoutSave',args:[{row:3,was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',remove:true}]},TEACHER);
 assert.deepEqual([res.statusCode,res.body.error],[400,'마스터시트를 읽지 못했습니다.']);
 assert.deepEqual(calls.map(c=>c.action),['b2Dropouts']);
 calls.length=0;
 const ok=await call({action:'b2DropoutSave',args:[{row:3,was:{cls:'1',name:'최유진'},cls:'1',name:'최유진',remove:true}]});
 assert.equal(ok.statusCode,200);assert.deepEqual(calls.map(c=>[c.action,c.role]),[['b2DropoutSave','ADMIN']]);
});

/* ---------- 가짜 마스터시트(Apps Script b2Dropouts_·b2DropoutSave_·b2Completions_·b2RosterStatusMany_와 같은 규칙) ---------- */
function fakeSheet(){
 const s={rev:7,roster:ROSTER(),ledger:LEDGER(),drops:DROPS(),saves:[]};
 const fail=m=>{throw new Error(m);};
 const rosterOf=(c,n)=>s.roster.filter(r=>r[0]===c&&r[1]===n);
 const apply=(c,n,status,changed,reason)=>{const hit=rosterOf(c,n);if(!hit.length)fail('명부에 없는 학생입니다.');Object.assign(hit[0],{2:status,3:changed,4:reason});};
 const back=r=>{const ro=rosterOf(r.cls,r.name)[0];if(ro&&ro[2]===r.kind)apply(r.cls,r.name,'재학','','');};
 const save=(p,role,actor)=>{
  const teacher=role==='TEACHER',row=Number(p.row)||0,was=p.was||p,hasConfirm=typeof p.confirm==='boolean';
  if(teacher&&hasConfirm)fail('관리자 확인은 관리자만 할 수 있습니다.');
  if(!p.remove){if(!/^(?:[1-9]|1[0-7])$/.test(p.cls))fail('반 번호를 확인해 주세요.');if(!p.name)fail('이름을 넣어 주세요.');if(!['중도탈락','조기취업'].includes(p.kind))fail('구분은 중도탈락·조기취업 가운데 하나입니다.');if(!p.lastDate)fail('마지막 출석일을 넣어 주세요.');if(p.kind==='조기취업'&&!p.startDate)fail('조기취업은 근로개시일을 넣어 주세요.');}
  const cur=row?s.drops.find(r=>r.row===row):null;
  if(row&&!cur)fail('그 줄을 찾지 못했습니다. 새로 읽어 주세요.');
  if(cur&&(cur.cls!==String(was.cls)||cur.name!==was.name))fail('그 줄이 바뀌었습니다. 새로 읽어 주세요.');
  if(teacher&&cur&&cur.cls!==p.cls)fail('다른 반 학생입니다.');
  if(teacher&&cur&&cur.confirmed)fail('관리자가 확인한 줄입니다. 고칠 내용은 관리자에게 알려 주세요.');
  if(p.remove){s.drops=s.drops.filter(r=>r!==cur).map(r=>r.row>row?{...r,row:r.row-1}:r);back(cur);s.rev++;return {ok:true,removed:row,rev:s.rev};}
  const dup=s.drops.find(r=>r.cls===p.cls&&r.name===p.name&&r!==cur);if(dup)fail(`이미 등록된 학생입니다(${dup.row}행).`);
  apply(p.cls,p.name,p.kind,p.lastDate,p.reason||'');
  if(cur&&(cur.cls!==p.cls||cur.name!==p.name))back(cur);
  const vals={cls:p.cls,name:p.name,kind:p.kind,reason:p.reason||'',startDate:p.startDate||'',lastDate:p.lastDate,verdict:p.verdict||'',basis:p.basis||'',docs:{resign:p.docs?.resign||'',offer:p.docs?.offer||'',proof:p.docs?.proof||''},contact:p.contact||'',note:p.note||''};
  let at=cur;if(cur)Object.assign(cur,vals);else{at={row:Math.max(1,...s.drops.map(r=>r.row))+1,...vals,by:actor,at:'2026-12-10 10:00',confirmed:false,confirmedBy:'',confirmedAt:''};s.drops.push(at);}
  if(hasConfirm)Object.assign(at,{confirmed:p.confirm,confirmedBy:p.confirm?actor:'',confirmedAt:p.confirm?'2026-12-10 10:05':''});
  s.rev++;return {ok:true,row:at.row,rev:s.rev};
 };
 s.handle=body=>{
  const p=body.args?.[0]??{};
  switch(body.action){
   case 'b2Bundle':{const c=String(body.args?.[0]??'all');return {...rawBundle(s.roster.filter(r=>c==='all'||r[0]===c).map(r=>[...r]),s.ledger.filter(r=>c==='all'||r[1]===c)),rev:s.rev};}
   case 'b2Rev':return {rev:s.rev,sync:{},voc:{rev:1,admin:0,open:{},teacher:{}}};
   case 'b2Docs':return {rev:s.rev,rows:[],statuses:[],types:[],delivery:[]};
   case 'b2Vocs':case 'b2LedgerMemos':case 'b2ModuleTimes':return {rev:s.rev,rows:[]};
   case 'b2Dropouts':if(body.role==='TEACHER'&&!p.cls)fail('반 번호를 확인해 주세요.');return {rev:s.rev,maxAbsence:12,rows:s.drops.filter(r=>!p.cls||r.cls===p.cls).map(r=>structuredClone(r))};
   case 'b2DropoutSave':{const r=save(p,body.role,body.actor);s.saves.push({role:body.role,args:p});return r;}
   case 'b2Completions':{const ok=new Set(s.drops.filter(r=>r.kind==='조기취업'&&r.verdict==='수료가능'&&r.confirmed).map(r=>r.cls+'|'+r.name));
    return {rev:s.rev,rows:s.roster.filter(r=>(!p.cls||r[0]===p.cls)&&(r[2]==='수료'||(r[2]==='조기취업'&&ok.has(r[0]+'|'+r[1])))).map(r=>({cls:r[0],name:r[1],status:r[2],changed:r[3],reason:r[4]||'',via:r[2]==='수료'?'수료':'조기취업 수료'}))};}
   case 'b2RosterStatusMany':{if(body.role!=='ADMIN')fail('관리자만 할 수 있습니다.');const list=p.rows||[];list.forEach((it,i)=>{if(rosterOf(it.cls,it.name).length!==1)fail(`${i+1}번째(${it.name}): 명부에 없는 학생입니다.`);});list.forEach(it=>apply(it.cls,it.name,it.status,it.changed,it.reason));s.rev++;return {ok:true,count:list.length,classes:[...new Set(list.map(i=>i.cls))],rev:s.rev};}
   default:return {};
  }
 };
 return s;
}

/* ---------- 화면(index.html → beta2-admin.mjs → beta2-dropouts.mjs, 담임은 beta2-dropouts.mjs 담임 모드) ---------- */
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
// 담임 모드: 담임 화면 탭에 붙이기 전이라 모듈을 바로 띄웁니다(beta2-teacher-layout.mjs 연결은 담임 화면 작업에서).
const TEACHER_PAGE=`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="host"></div><script type="module">
import {createBeta2Client} from '/beta2-data.mjs';import {mount} from '/beta2-dropouts.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';
ensureBeta2Css();window.notes=[];
const client=createBeta2Client({email:'${TEACHER}',getIdToken:async()=>'tok'});
window.screen2=await mount(document.getElementById('host'),{client,classes:[{id:'1'}],teacherClass:'1',me:'${TEACHER}',notify:async(kind,p)=>{window.notes.push([kind,p]);}});
</script>`;

// 브라우저 → /api/teacher-beta는 실제 api/teacher-beta.js(로그인·반 확인·담임 칸 거르기)를 거쳐 가짜 시트로 갑니다.
async function site(t,run,{email=ADMIN_EMAIL,page:path='/',clock='2026-12-10T10:00:00+09:00',sheet=fakeSheet(),api=()=>null}={}){
 backend(t,body=>{try{return {ok:true,data:sheet.handle(body)};}catch(e){return {ok:false,error:e.message};}});
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>{dialogs.push(d.message());void (page.dialogAnswer?.shift()??true?d.accept():d.dismiss());});
 page.dialogAnswer=[];
 try{
  await page.clock.install({time:clock});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(url.pathname==='/teacher-test.html')return route.fulfill({contentType:'text/html;charset=utf-8',body:TEACHER_PAGE});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    const forced=await api(body);if(forced)return route.fulfill({status:forced.ok?200:400,contentType:'application/json',body:JSON.stringify(forced)});
    const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
    await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);
    return route.fulfill({status:res.statusCode,contentType:'application/json',body:JSON.stringify(res.body)});
   }
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test'+path);
  if(path==='/')await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await run(page,posts,dialogs,sheet);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const openScreen=async page=>{
 await page.getByRole('button',{name:'출결',exact:true}).click();
 assert.deepEqual(await page.locator('.admin-tabs .tab').allInnerTexts(),['출결대조','반 현황','출결 현황','교육생 상태','중도탈락·수료','반 임원','내려받기','체크히어 수집']);
 await page.getByRole('button',{name:'중도탈락·수료',exact:true}).click();
 await page.getByRole('heading',{name:'중도탈락·수료'}).waitFor();await page.locator('tr[data-row]').first().waitFor();
};
const rowOf=(page,name)=>page.locator('tr[data-row]',{hasText:name});
const saves=sheet=>sheet.saves.map(x=>x.args);
const notes=page=>page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='set'&&w[1].startsWith('notifications/')).map(w=>w[2]));

test('관리자: 중도탈락 탭 목록(테스트반은 합계에서 빠짐), 계산 판정으로 관리자 확인, 새로 등록·고치기·지우기와 명부 상태',async t=>{
 await site(t,async(page,posts,dialogs,sheet)=>{
  await openScreen(page);
  assert.deepEqual(await page.locator('#d2Tabs .b2-tab').allInnerTexts(),['중도탈락·조기취업','결석 한도','수료 명단']);
  assert.deepEqual(await page.locator('tr[data-row] .b2-name').allInnerTexts(),['한수빈','최유진','테스트을']);
  const stats=await page.locator('.b2-stats').innerText();
  assert.match(stats,/2\s*등록[\s\S]*1\s*중도탈락[\s\S]*1\s*조기취업[\s\S]*1\s*확인 대기/,'test class row not counted');
  assert.match(await page.locator('#d2Body').innerText(),/테스트반 중도탈락·조기취업 1건은 목록에만 보이고/);
  const choi=rowOf(page,'최유진');
  // 담임이 신청한 줄에는 '담임 신청' 표시(등록자가 cohort.json 관리자가 아님)
  assert.equal(await choi.getByText('담임 신청',{exact:true}).count(),1);
  assert.match(await choi.innerText(),/근로개시 11\/23\(월\)[\s\S]*근로개시 전 2일 \/ 12[\s\S]*판정 전[\s\S]*계산: 수료가능[\s\S]*채용통보 O[\s\S]*연락: 인사팀 확인[\s\S]*확인 대기/);
  assert.match(await rowOf(page,'한수빈').innerText(),/제적[\s\S]*포기사유서 O[\s\S]*확인\s*hint\.kpc@gmail\.com · 2026-11-04 09:00/);
  // 관리자 확인: 판정이 비어 있으면 계산값을 함께 저장, 다른 칸(서류·연락 확인)은 그대로
  page.dialogAnswer.push(false);await choi.getByRole('button',{name:'확인',exact:true}).click();
  assert.equal(dialogs.at(-1),'1반 최유진 (조기취업) 줄을 관리자 확인할까요?\n판정: 수료가능 (계산값을 함께 저장)');assert.equal(sheet.saves.length,0);
  await choi.getByRole('button',{name:'확인',exact:true}).click();
  await rowOf(page,'최유진').getByRole('button',{name:'확인 풀기'}).waitFor();
  const c=saves(sheet).at(-1);
  assert.deepEqual([c.row,c.was,c.verdict,c.confirm,c.docs,c.contact],[3,{cls:'1',name:'최유진'},'수료가능',true,{resign:'',offer:'O',proof:''},'인사팀 확인']);
  assert.match(c.basis,/근로개시\(11\/23\) 전 결석 2일/);
  const sent=await notes(page);assert.deepEqual(sent.map(n=>[n.kind,n.toClass,n.title]),[['중도탈락','1','1반 최유진 조기취업 · 운영팀 확인']],'the class teacher is told');
  // 새로 등록: 반 → 이름(명부) → 날짜, 확인창, 명부 상태도 바뀜
  await page.getByRole('button',{name:'새로 등록'}).click();
  const ed=page.locator('[data-editor="new"]');
  await ed.locator('[data-f="cls"]').selectOption('1');await page.locator('[data-editor="new"] [data-f="name"]').selectOption('고다원');
  await page.locator('[data-editor="new"]').getByRole('button',{name:'저장'}).click();
  assert.equal(await page.locator('[data-editor="new"] [data-err]').innerText(),'마지막 출석일을 넣어 주세요.');assert.equal(sheet.saves.length,1);
  await page.locator('[data-editor="new"] [data-f="lastDate"]').fill('2026-12-01');
  await page.locator('[data-editor="new"] [data-f="reason"]').fill('장기 결석');
  assert.match(await page.locator('[data-editor="new"] [data-suggest]').innerText(),/계산\(결석 한도 12일\): 제적 · 중도탈락\(조기취업 아님\) · 마지막 출석 12\/1/);
  await page.locator('[data-editor="new"]').getByRole('button',{name:'계산값 넣기'}).click();
  assert.equal(await page.locator('[data-editor="new"] [data-f="verdict"]').inputValue(),'제적');
  await page.locator('[data-editor="new"] [data-f="docs.resign"]').selectOption('X');
  await page.locator('[data-editor="new"]').getByRole('button',{name:'저장'}).click();
  await rowOf(page,'고다원').waitFor();
  assert.equal(await rowOf(page,'고다원').getByText('담임 신청',{exact:true}).count(),0,'admin-made row has no teacher badge');
  assert.equal(dialogs.at(-1),'1반 고다원 학생을 「중도탈락」(으)로 등록할까요?\n명부 상태도 함께 바뀌어 마지막 출석일 12/1(화) 다음 교육일부터 출결판·출석률에서 빠집니다.');
  assert.deepEqual(saves(sheet).at(-1),{cls:'1',name:'고다원',kind:'중도탈락',reason:'장기 결석',startDate:'',lastDate:'2026-12-01',note:'',verdict:'제적',basis:'중도탈락(조기취업 아님) · 마지막 출석 12/1',docs:{resign:'X',offer:'',proof:''},contact:''});
  assert.deepEqual(sheet.roster.find(r=>r[1]==='고다원').slice(2,5),['중도탈락','2026-12-01','장기 결석']);
  assert.match(await page.locator('#toast').innerText(),/1반 고다원 · 중도탈락 등록했습니다/);
  // 이미 있는 학생은 새로 넣지 못함(시트도 막지만 먼저 알림)
  await page.getByRole('button',{name:'새로 등록'}).click();
  await page.locator('[data-editor="new"] [data-f="cls"]').selectOption('1');await page.locator('[data-editor="new"] [data-f="name"]').selectOption('한수빈');await page.locator('[data-editor="new"] [data-f="lastDate"]').fill('2026-11-02');
  await page.locator('[data-editor="new"]').getByRole('button',{name:'저장'}).click();
  assert.equal(await page.locator('[data-editor="new"] [data-err]').innerText(),'이미 등록된 학생입니다. 목록에서 그 줄을 고쳐 주세요.');
  await page.locator('[data-editor="new"]').getByRole('button',{name:'닫기'}).click(); // 입력이 있으니 확인창(예)
  // 고치기: 비고·연락 확인만 바꾸면 확인창 없이 저장(명부 상태는 그대로)
  const n=dialogs.length;
  await rowOf(page,'고다원').getByRole('button',{name:'고치기'}).click();
  const e2=page.locator('[data-editor]');await e2.locator('[data-f="contact"]').fill('12/2 본인 통화');await e2.locator('[data-f="note"]').fill('서류 우편 발송');
  await e2.getByRole('button',{name:'저장'}).click();
  await rowOf(page,'고다원').getByText('연락: 12/2 본인 통화').waitFor();
  assert.equal(dialogs.length,n,'no status question for a contact/note change');
  const ed2=saves(sheet).at(-1);assert.deepEqual([ed2.row,ed2.was,ed2.contact,ed2.note,ed2.verdict,ed2.confirm],[5,{cls:'1',name:'고다원'},'12/2 본인 통화','서류 우편 발송','제적',undefined]);
  // 저장하지 않은 입력이 있으면 다른 메뉴로 갈 때 묻습니다(아니오 → 그대로)
  await rowOf(page,'고다원').getByRole('button',{name:'고치기'}).click();await page.locator('[data-editor] [data-f="note"]').fill('바뀜');
  page.dialogAnswer.push(false);await page.getByRole('button',{name:'교육생 상태',exact:true}).click();
  assert.equal(dialogs.at(-1),'저장하지 않은 중도탈락 입력이 있습니다. 화면을 떠날까요?');
  assert.equal(await page.locator('[data-editor] [data-f="note"]').inputValue(),'바뀜');
  // 지우기: 확인창 → 줄이 빠지고 명부는 재학으로
  await page.locator('[data-editor]').getByRole('button',{name:'지우기'}).click();
  assert.match(dialogs.at(-1),/1반 고다원 \(중도탈락\) 줄을 마스터시트 중도탈락 탭에서 지울까요\?\n명부 상태가 아직 「중도탈락」이면 재학으로 되돌립니다\./);
  await rowOf(page,'고다원').waitFor({state:'detached'});
  assert.deepEqual(saves(sheet).at(-1),{row:5,was:{cls:'1',name:'고다원'},cls:'1',name:'고다원',remove:true});
  assert.deepEqual(sheet.roster.find(r=>r[1]==='고다원').slice(2,4),['재학','']);
  // 반 고르기: 17반만
  await page.locator('#d2Class').selectOption('17');
  assert.deepEqual(await page.locator('tr[data-row] .b2-name').allInnerTexts(),['테스트을']);
 });
});

test('관리자: 여러 건 관리자 확인, 결석 한도 12일 판정, 수료 명단과 수료 처리(명부 여러 명)',async t=>{
 const sheet=fakeSheet();sheet.drops.push(DROP({row:5,cls:'2',name:'이경수',kind:'중도탈락',reason:'이사',lastDate:'2026-12-04',by:ADMIN_EMAIL}));sheet.roster.find(r=>r[1]==='이경수').splice(2,2,'중도탈락','2026-12-04');
 await site(t,async(page,posts,dialogs)=>{
  await openScreen(page);
  // 담임 신청 대기: 담임이 신청했고 관리자 확인 전인 줄만(관리자가 넣은 이경수는 빠짐)
  await page.getByRole('button',{name:/^담임 신청 대기/}).click();
  assert.deepEqual(await page.locator('tr[data-row] .b2-name').allInnerTexts(),['최유진','테스트을']);
  await page.getByRole('button',{name:/^확인 대기/}).click();
  assert.deepEqual(await page.locator('tr[data-row] .b2-name').allInnerTexts(),['최유진','테스트을','이경수']);
  await page.locator('[data-pickall]').click();
  await page.locator('#d2Batch').getByText('선택 3건').waitFor();
  await page.locator('#d2Batch').getByRole('button',{name:'관리자 확인'}).click();
  assert.equal(dialogs.at(-1),'3건을 관리자 확인할까요?\n판정이 빈 3건은 계산값을 함께 저장합니다.');
  await page.locator('#toast',{hasText:'3건 관리자 확인을 저장했습니다.'}).waitFor();
  assert.deepEqual(sheet.drops.map(r=>[r.name,r.verdict,r.confirmed]),[['한수빈','제적',true],['최유진','수료가능',true],['테스트을','제적',true],['이경수','제적',true]]);
  // 결석 한도
  await page.getByRole('tab',{name:'결석 한도'}).click();
  const body=page.locator('#d2Body');await body.getByText('2기는 60교육일의 80%').waitFor();
  assert.match(await page.locator('.b2-stats').innerText(),/5\s*재학생[\s\S]*1\s*주의 \(10~11일\)[\s\S]*1\s*한도 도달 \(12일\)[\s\S]*1\s*제적 대상 \(13일~\)/);
  assert.deepEqual(await page.locator('#d2Body tbody tr .b2-name').allInnerTexts(),['고다원','테스트갑','김동진','박서연']);
  assert.match(await body.innerText(),/테스트반 결석 주의 이상 1건은 목록에만/);
  assert.match(await page.locator('tr[data-key="1|고다원"]').innerText(),/13 \/ 12[\s\S]*0일[\s\S]*제적 대상[\s\S]*중도탈락 등록/);
  assert.match(await page.locator('tr[data-key="1|박서연"]').innerText(),/10 \/ 12[\s\S]*2일[\s\S]*주의/);
  // 결석 한도에서 바로 등록 칸 열기
  await page.locator('tr[data-key="1|고다원"]').getByRole('button',{name:'중도탈락 등록'}).click();
  assert.deepEqual([await page.locator('[data-editor="new"] [data-f="cls"]').inputValue(),await page.locator('[data-editor="new"] [data-f="name"]').inputValue()],['1','고다원']);
  await page.locator('[data-editor="new"]').getByRole('button',{name:'닫기'}).click();
  // 수료 명단: 최유진은 확인됐으니 수료(조기취업 수료)
  await page.getByRole('tab',{name:'수료 명단'}).click();await page.locator('#d2Body tbody tr').first().waitFor();
  const rowText=async name=>page.locator(`#d2Body tr[data-key="1|${name}"]`).innerText();
  assert.match(await rowText('최유진'),/수료\s*조기취업 · 판정 수료가능 · 관리자 확인/);
  assert.match(await rowText('고다원'),/미수료\s*결석 13일 · 한도 12일 초과\(제적 대상\)/);
  assert.match(await rowText('한수빈'),/미수료\s*중도탈락 · 마지막 출석 11\/2 · 개인 사정/);
  assert.match(await rowText('이하늘'),/수료 예정\s*재학 · 결석 0일 \/ 한도 12일/);
  assert.match(await page.locator('.b2-stats').innerText(),/1\s*수료[\s\S]*4\s*수료 예정[\s\S]*0\s*확인 대기[\s\S]*3\s*미수료/,'class 17 not counted');
  assert.equal(await page.locator('[data-pickdone="1|고다원"]').count(),0,'over the limit cannot be completed');
  await page.locator('[data-pickdone="1|이하늘"]').check();await page.locator('[data-pickdone="1|정민호"]').check();
  page.dialogAnswer.push(false);await page.getByRole('button',{name:'수료 처리 2'}).click();
  assert.equal(dialogs.at(-1),'2명을 명부에서 「수료」로 바꿀까요?\n교육 마지막 날(1/22(금)) 전입니다.\n상태 변경일은 1/22(금)로 적습니다.');
  assert.equal(posts.filter(p=>p.action==='b2RosterStatusMany').length,0);
  await page.getByRole('button',{name:'수료 처리 2'}).click();
  await page.locator('#d2Body tr[data-key="1|이하늘"]',{hasText:'명부 수료'}).waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2RosterStatusMany').map(p=>p.args[0].rows),[[{cls:'1',name:'이하늘',status:'수료',changed:'2027-01-22',reason:'수료'},{cls:'1',name:'정민호',status:'수료',changed:'2027-01-22',reason:'수료'}]]);
  // 수료 취소
  await page.locator('[data-pickdone="1|정민호"]').check();await page.getByRole('button',{name:'수료 취소 1'}).click();
  await page.locator('#d2Body tr[data-key="1|정민호"]',{hasText:'수료 예정'}).waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2RosterStatusMany').at(-1).args[0].rows,[{cls:'1',name:'정민호',status:'재학',changed:'',reason:''}]);
 },{sheet});
});

test('출결 현황 no longer has its own 중도탈락 view: the header links to the new screen',async t=>{
 await site(t,async page=>{
  await page.getByRole('button',{name:'출결',exact:true}).click();await page.getByRole('button',{name:'출결 현황',exact:true}).click();
  await page.getByRole('heading',{name:'출결 현황'}).waitFor();
  assert.deepEqual(await page.locator('#s2Tabs .b2-tab').allInnerTexts(),['출결 통계','증빙서류','질병 인정']);
  await page.locator('#s2Dropouts').click();
  await page.getByRole('heading',{name:'중도탈락·수료'}).waitFor();
  assert.equal(await page.locator('.admin-tabs .tab.active').innerText(),'중도탈락·수료');
 });
});

test('담임: 신청만(교육생·구분·사유·마지막 출석일·근로개시일·메모), 우리 반 신청 현황은 보기만, 자기 신청·확인 전만 취소, 수료 확인은 보기만',async t=>{
 const sheet=fakeSheet();
 sheet.drops.push(DROP({row:5,cls:'1',name:'박서연',kind:'중도탈락',reason:'운영팀 등록',lastDate:'2026-12-01',by:ADMIN_EMAIL}));sheet.roster.find(r=>r[1]==='박서연').splice(2,2,'중도탈락','2026-12-01');
 await site(t,async(page,posts,dialogs)=>{
  await page.locator('tr[data-row]').first().waitFor();
  assert.deepEqual(await page.locator('#d2Tabs .b2-tab').allInnerTexts(),['중도탈락 신청','수료 확인']);
  for(const sel of ['#d2Class','#d2New','#d2Csv','[data-pick]','[data-pickall]','[data-editor]','[data-f]','[data-batch]','[data-act]'])assert.equal(await page.locator(sel).count(),0,`no ${sel} for teachers`);
  assert.deepEqual(posts.filter(p=>['b2Dropouts','b2Completions'].includes(p.action)).map(p=>[p.action,p.args[0]]),[['b2Dropouts',{cls:'1'}],['b2Completions',{cls:'1'}]]);
  // 우리 반 신청 현황(보기만)
  assert.match(await page.locator('#d2Body').innerText(),/우리 반 신청 현황 \(3건\)/);
  assert.deepEqual(await page.locator('tr[data-row] .b2-name').allInnerTexts(),['한수빈','최유진','박서연']);
  assert.match(await rowOf(page,'한수빈').innerText(),/중도탈락\s*개인 사정[\s\S]*11\/21\(토\) 10:00[\s\S]*마지막 출석 11\/2\(월\)[\s\S]*확인 완료\s*hint\.kpc@gmail\.com · 2026-11-04 09:00\s*제적/);
  assert.doesNotMatch(await rowOf(page,'한수빈').innerText(),/포기사유서|중도탈락\(조기취업 아님\)|11\/3 통화/,'no documents, basis or contact for teachers');
  assert.equal(await rowOf(page,'한수빈').getByRole('button').count(),0,'confirmed: nothing to press');
  assert.match(await rowOf(page,'최유진').innerText(),/조기취업[\s\S]*마지막 출석 11\/20\(금\)\s*근로개시 11\/23\(월\)[\s\S]*접수\s*운영팀 확인 전/);
  assert.deepEqual(await rowOf(page,'최유진').getByRole('button').allInnerTexts(),['신청 취소']);
  assert.match(await rowOf(page,'박서연').innerText(),/hint\.kpc@gmail\.com[\s\S]*접수/);assert.equal(await rowOf(page,'박서연').getByRole('button').count(),0,'not their own request: no cancel');
  // 신청 칸: 재학이고 아직 신청이 없는 학생만, 근로개시일은 조기취업일 때만
  const req=page.locator('[data-request]');
  assert.deepEqual(await req.locator('[data-g="name"] option').allInnerTexts(),['교육생 선택','고다원','김동진','이하늘','정민호']);
  assert.equal(await req.locator('[data-g="startDate"]').count(),0);
  await req.getByRole('button',{name:'신청하기'}).click();
  assert.equal(await page.locator('[data-request] [data-err]').innerText(),'교육생을 골라 주세요.');
  await page.locator('[data-request] [data-g="name"]').selectOption('정민호');await page.locator('[data-request] [data-g="kind"]').selectOption('조기취업');
  await page.locator('[data-request] [data-g="startDate"]').waitFor();
  assert.equal(await page.locator('[data-request] [data-g="name"]').inputValue(),'정민호','choosing the kind keeps the student');
  await page.locator('[data-request] [data-g="lastDate"]').fill('2026-12-11');
  await page.locator('[data-request]').getByRole('button',{name:'신청하기'}).click();
  assert.equal(await page.locator('[data-request] [data-err]').innerText(),'조기취업은 근로개시일을 넣어 주세요.');assert.equal(sheet.saves.length,0);
  await page.locator('[data-request] [data-g="startDate"]').fill('2026-12-14');await page.locator('[data-request] [data-g="reason"]').fill('12/14 ○○㈜ 입사');await page.locator('[data-request] [data-g="note"]').fill('서류는 다음 주');
  page.dialogAnswer.push(false);await page.locator('[data-request]').getByRole('button',{name:'신청하기'}).click();
  assert.equal(dialogs.at(-1),'1반 정민호 학생을 「조기취업」(으)로 신청할까요?\n명부 상태는 운영팀이 확인한 뒤 바뀝니다(마지막 출석일 12/11(금) 다음 교육일부터 출결판·출석률에서 빠짐). 판정·서류·수료 처리는 운영팀이 합니다.');
  assert.equal(sheet.saves.length,0,'declined: nothing sent');
  await page.locator('[data-request]').getByRole('button',{name:'신청하기'}).click();
  await rowOf(page,'정민호').waitFor();
  assert.match(await page.locator('#toast').innerText(),/신청했습니다 · 운영팀이 확인 후 처리합니다/);
  assert.deepEqual(sheet.saves.at(-1),{role:'TEACHER',args:{cls:'1',name:'정민호',kind:'조기취업',reason:'12/14 ○○㈜ 입사',startDate:'2026-12-14',lastDate:'2026-12-11',note:'서류는 다음 주'}});
  assert.deepEqual(sheet.roster.find(r=>r[1]==='정민호').slice(2,4),['조기취업','2026-12-11']);
  assert.deepEqual(await page.evaluate(()=>window.notes),[['중도탈락',{audience:'admins',cls:'1',title:'1반 조기취업 신청 · 정민호',body:'마지막 출석 12/11(금) · 근로개시 12/14(월) · 12/14 ○○㈜ 입사',link:'#b2dropouts?cls=1'}]]);
  assert.equal(await page.locator('[data-request] [data-g="name"]').inputValue(),'','the form is cleared');
  assert.deepEqual(await page.locator('[data-request] [data-g="name"] option').allInnerTexts(),['교육생 선택','고다원','김동진','이하늘'],'a requested student is not offered again');
  assert.match(await rowOf(page,'정민호').innerText(),/조기취업\s*12\/14 ○○㈜ 입사\s*메모: 서류는 다음 주[\s\S]*접수/);
  // 신청 취소: 확인창(아니오 → 그대로), 예 → 줄이 빠지고 명부는 재학, 관리자에게 알림
  page.dialogAnswer.push(false);await rowOf(page,'정민호').getByRole('button',{name:'신청 취소'}).click();
  assert.equal(dialogs.at(-1),'정민호 (조기취업) 신청을 취소할까요?\n운영팀이 확인하기 전이라 명부 상태는 그대로입니다.');
  assert.equal(sheet.drops.some(r=>r.name==='정민호'),true);
  await rowOf(page,'정민호').getByRole('button',{name:'신청 취소'}).click();
  await rowOf(page,'정민호').waitFor({state:'detached'});
  assert.deepEqual(sheet.saves.at(-1),{role:'TEACHER',args:{cls:'1',name:'정민호',row:6,was:{cls:'1',name:'정민호'},remove:true}});
  assert.deepEqual(sheet.roster.find(r=>r[1]==='정민호').slice(2,4),['재학','']);
  assert.equal((await page.evaluate(()=>window.notes)).at(-1)[1].title,'1반 조기취업 신청 취소 · 정민호');
  // 운영팀이 그 사이 확인했으면 서버가 거절하고 줄은 그대로
  sheet.drops.find(r=>r.name==='최유진').confirmed=true;
  await rowOf(page,'최유진').getByRole('button',{name:'신청 취소'}).click();
  await page.locator('#toast',{hasText:'취소하지 못했습니다: 직접 신청하고 운영팀이 아직 확인하지 않은 신청만 취소할 수 있습니다.'}).waitFor();
  assert.equal(sheet.drops.some(r=>r.name==='최유진'),true);
  sheet.drops.find(r=>r.name==='최유진').confirmed=false;
  // 수료 확인: 자기 반만, 결과와 결석 한도(보기만)
  await page.getByRole('tab',{name:'수료 확인'}).click();await page.locator('#d2Body tbody tr').first().waitFor();
  const rowText=async name=>page.locator(`#d2Body tr[data-key="1|${name}"]`).innerText();
  assert.deepEqual(await page.locator('#d2Body tbody tr .b2-name').allInnerTexts(),['김동진','이하늘','정민호','최유진','고다원','박서연','한수빈']);
  assert.match(await rowText('김동진'),/재학\s*12 \/ 12일 한도 도달\s*0일 더 결석하면 한도\s*수료 예정\s*재학 · 결석 12일 \/ 한도 12일/);
  assert.match(await rowText('이하늘'),/0 \/ 12일\s*12일 더 결석하면 한도\s*수료 예정/);
  assert.match(await rowText('고다원'),/13 \/ 12일 제적 대상\s*한도 초과\s*미수료\s*결석 13일 · 한도 12일 초과\(제적 대상\)/);
  assert.match(await rowText('최유진'),/조기취업[\s\S]*확인 대기\s*조기취업 · 판정 전/);
  assert.match(await rowText('한수빈'),/중도탈락[\s\S]*미수료\s*중도탈락 · 마지막 출석 11\/2/);
  assert.match(await page.locator('.b2-stats').innerText(),/0\s*수료[\s\S]*3\s*수료 예정[\s\S]*1\s*확인 대기[\s\S]*3\s*미수료/);
  assert.equal(await page.locator('#d2Body input').count(),0,'no checkboxes');
  assert.deepEqual(await page.locator('#d2Body button:not(.b2-chip)').count(),0,'no 수료 처리 buttons');
  assert.equal(await page.locator('#d2Body').getByText('테스트갑').count(),0,'own class only');
 },{email:TEACHER,page:'/teacher-test.html',sheet});
});
