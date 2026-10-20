import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import handler,{resolveClass,teacherClassIds,b2Args,vocForTeacher} from '../../api/teacher-beta.js';

const base=join(import.meta.dirname,'../..');
const SHEET='https://script.test/exec',KEY='secret-key-123',ADMIN_EMAIL='hint.kpc@gmail.com';
const PROFILES={
 'teacher@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'},tempClassIds:{arrayValue:{values:[{stringValue:'7'}]}},classIds:{arrayValue:{values:[{stringValue:'8'}]}}},
 'legacy@test.kr':{role:{stringValue:'TEACHER'},classId:{integerValue:'4'}},
 'inactive@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'},active:{booleanValue:false}},
 'staff@test.kr':{role:{stringValue:'STAFF'}}
};
function backend(t,{sheet=()=>Response.json({ok:true,data:{rows:1}})}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return idToken.startsWith('tok:')?Response.json({users:[{email:idToken.slice(4)}]}):Response.json({},{status:400});}
  if(url.startsWith('https://firestore.googleapis.com/')){const email=decodeURIComponent(url.split('/users/')[1]);return PROFILES[email]?Response.json({fields:PROFILES[email]}):Response.json({},{status:404});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push({body,redirect:init.redirect});return sheet(body);}
  throw Error('unexpected fetch '+url);
 });
 return calls;
}
async function call(body,{email='teacher@test.kr',method='POST',header=true}={}){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 const req={method,headers:header&&email?{authorization:`Bearer tok:${email}`}:{},body:header||!email?body:{...body,idToken:`tok:${email}`}};
 await handler(req,res);return res;
}
function withEnv(t,url=SHEET,key=KEY){
 const old={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 if(url)process.env.HINT_SHEET_API_URL=url;else delete process.env.HINT_SHEET_API_URL;
 if(key)process.env.HINT_SHEET_API_KEY=key;else delete process.env.HINT_SHEET_API_KEY;
 t.after(()=>{for(const [k,v] of [['HINT_SHEET_API_URL',old.url],['HINT_SHEET_API_KEY',old.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}

test('the beta is administrator-only for now, so teacher requests never reach the sheet',async t=>{
 withEnv(t);const calls=backend(t);
 for(const email of ['teacher@test.kr','legacy@test.kr']){
  const res=await call({action:'portalData',args:[3,''],cls:3},{email});
  assert.deepEqual([res.statusCode,res.body.code],[403,'ADMIN_ONLY']);assert.match(res.body.error,/관리자만/);
 }
 assert.equal(calls.length,0);
});

test('teacher class rules stay ready for the later rollout: only assigned classes, never the one sent',()=>{
 const teacher={role:'TEACHER',classIds:teacherClassIds(PROFILES['teacher@test.kr'])};
 assert.deepEqual(teacher.classIds,['3','7'],'legacy classIds are ignored once tempClassIds exists');
 assert.deepEqual(teacherClassIds(PROFILES['legacy@test.kr']),['4'],'numeric classId works like index.html');
 assert.equal(resolveClass(teacher,{cls:5},'portalData',[5,'']),3);
 assert.equal(resolveClass(teacher,{cls:7},'portalClose',[7,'','확인']),7,'temporary class is allowed');
 assert.equal(resolveClass(teacher,{cls:8},'portalData',[8,'']),3);
 assert.equal(resolveClass(teacher,{},'portalSave',[{cls:9}]),3);
 assert.throws(()=>resolveClass({role:'TEACHER',classIds:[]},{cls:1},'portalData',[1,'']),/NO_CLASS/);
});

test('the roster with birth dates is administrator-only and an outdated Apps Script is named plainly',async t=>{
 withEnv(t);let calls=backend(t,{sheet:()=>Response.json({ok:true,data:[{name:'가나다',birth:'2000-01-02',gender:'남성'}]})});
 let res=await call({action:'portalRoster',args:[1,''],cls:1},{email:ADMIN_EMAIL});
 assert.equal(res.statusCode,200);assert.deepEqual(calls.at(-1).body,{key:KEY,action:'portalRoster',args:[1,'']});
 res=await call({action:'portalRoster',args:[3,''],cls:3},{email:'teacher@test.kr'});
 assert.deepEqual([res.statusCode,res.body.code],[403,'ADMIN_ONLY']);assert.equal(calls.length,1);
 t.mock.restoreAll();backend(t,{sheet:()=>Response.json({ok:false,error:'unknown action'})});
 res=await call({action:'portalRoster',args:[1,''],cls:1},{email:ADMIN_EMAIL});
 assert.deepEqual([res.statusCode,res.body.code],[400,'SHEET_OUTDATED']);assert.match(res.body.error,/다시 배포/);
});

test('administrators choose the preview class, and bad input never reaches the sheet',async t=>{
 withEnv(t);const calls=backend(t);
 await call({action:'portalData',args:[1,''],cls:1},{email:'hint.kpc@gmail.com'});
 assert.deepEqual(calls.at(-1).body.args,[1,'']);
 await call({action:'portalSave',args:[{cls:2,name:'김철수'}],cls:2},{email:'kpc.jtkim@gmail.com'});
 assert.deepEqual(calls.at(-1).body.args,[{cls:2,name:'김철수',pin:''}]);
 await call({action:'portalClose',args:[9,'1234','확인'],cls:4},{email:'kpc.jtkim@gmail.com',header:false});
 assert.deepEqual(calls.at(-1).body.args,[4,'','확인'],'body idToken works like other api routes and the PIN is always blank');
 const before=calls.length;
 assert.equal((await call({action:'portalCheck',args:[4,'',53,'완료'],cls:4},{email:'hint.kpc@gmail.com'})).body.code,'BAD_ACTION','현장운영 체크리스트 is gone (2026-10-16)');
 assert.equal((await call({action:'portalData',args:[18,''],cls:18},{email:'hint.kpc@gmail.com'})).statusCode,400);
 assert.equal((await call({action:'portalClasses',args:[]},{email:'hint.kpc@gmail.com'})).body.code,'BAD_ACTION');
 assert.equal((await call({action:'portalData',args:[3,'']},{email:null})).statusCode,401);
 assert.equal((await call({action:'portalData',args:[3,'']},{email:'inactive@test.kr'})).statusCode,403);
 assert.equal((await call({action:'portalData',args:[3,'']},{email:'staff@test.kr'})).statusCode,403);
 assert.equal((await call({action:'portalData'},{method:'GET'})).statusCode,405);
 assert.equal(calls.length,before);
});

test('missing configuration and upstream failures become readable messages without leaking the key',async t=>{
 withEnv(t,null,null);let calls=backend(t);
 let res=await call({action:'portalData',args:[3,''],cls:3},{email:ADMIN_EMAIL});
 assert.equal(res.statusCode,503);assert.equal(res.body.code,'NOT_CONFIGURED');assert.match(res.body.error,/데이터 API 연결 전입니다/);assert.equal(calls.length,0);
 t.mock.restoreAll();withEnv(t);
 calls=backend(t,{sheet:()=>Response.json({ok:false,error:'unauthorized'})});
 res=await call({action:'portalData',args:[3,''],cls:3},{email:ADMIN_EMAIL});
 assert.equal(res.statusCode,502);assert.equal(res.body.code,'SHEET_UNAUTHORIZED');
 t.mock.restoreAll();backend(t,{sheet:()=>new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}})});
 res=await call({action:'portalData',args:[3,''],cls:3},{email:ADMIN_EMAIL});
 assert.equal(res.body.code,'SHEET_BAD_RESPONSE');
 t.mock.restoreAll();backend(t,{sheet:()=>Response.json({ok:false,error:'없는 학생입니다.'})});
 res=await call({action:'portalSave',args:[{name:'없음'}],cls:3},{email:ADMIN_EMAIL});
 assert.deepEqual([res.statusCode,res.body],[400,{ok:false,error:'없는 학생입니다.'}]);
 assert.equal(JSON.stringify(res.body).includes(KEY),false);
});

test('2기 베타 sheet actions carry the verified user, are administrator-only now, and class scope is decided on the server',async t=>{
 withEnv(t);const calls=backend(t);
 let res=await call({action:'b2Save',args:[{cls:'3',name:'가',date:'2026-09-01',type:'결석',actor:'fake@evil.kr'}]},{email:ADMIN_EMAIL});
 assert.equal(res.statusCode,200);
 assert.deepEqual(calls.at(-1).body,{key:KEY,action:'b2Save',args:[{cls:'3',name:'가',date:'2026-09-01',type:'결석',actor:'fake@evil.kr'}],actor:ADMIN_EMAIL,role:'ADMIN'},'the actor sent to Apps Script is the verified login, not a body field');
 await call({action:'b2Bundle',args:['all']},{email:ADMIN_EMAIL});
 assert.deepEqual(calls.at(-1).body.args,['all']);
 for(const action of ['b2Bundle','b2Save','b2DocCreate','b2Docs','b2SyncNow']){
  res=await call({action,args:[{cls:'3'}]},{email:'teacher@test.kr'});
  assert.deepEqual([res.statusCode,res.body.code],[403,'ADMIN_ONLY'],action);
 }
 assert.equal((await call({action:'b2Save',args:[{cls:'18'}]},{email:ADMIN_EMAIL})).body.code,'BAD_CLASS');
 assert.equal((await call({action:'b2Save',args:[{note:'x'.repeat(20001)}]},{email:ADMIN_EMAIL})).body.code,'BAD_REQUEST');
 assert.equal(calls.length,2);
 const teacher={role:'TEACHER',classIds:['3','7']},admin={role:'ADMIN',classIds:[]};
 assert.deepEqual(b2Args(teacher,'b2Bundle',['all']),['3'],'teachers never read every class');
 assert.deepEqual(b2Args(teacher,'b2Bundle',['7']),['7']);
 assert.deepEqual(b2Args(teacher,'b2Docs',[{}]),[{cls:'3'}]);
 assert.deepEqual(b2Args(teacher,'b2DocCreate',[{cls:'9',name:'가'}]),[{cls:'3',name:'가'}]);
 // 민원·이슈: 담임은 늘 자기 반(Apps Script가 그 건의 반과 맞는지 확인), 관리자는 전체·고른 반
 assert.deepEqual(b2Args(teacher,'b2Vocs',[{}]),[{cls:'3'}]);
 assert.deepEqual(b2Args(teacher,'b2VocCreate',[{cls:'9',type:'안전',detail:'가'}]),[{cls:'3',type:'안전',detail:'가'}]);
 assert.deepEqual(b2Args(teacher,'b2VocReply',[{key:'V261016-001',text:'답'}]),[{key:'V261016-001',text:'답',cls:'3'}]);
 assert.deepEqual(b2Args(teacher,'b2VocSeen',[{key:'V261016-001',cls:'7'}]),[{key:'V261016-001',cls:'7'}]);
 assert.deepEqual(b2Args(admin,'b2Vocs',[{}]),[{}]);
 assert.deepEqual(b2Args(admin,'b2VocReply',[{key:'V1',status:'완료'}]),[{key:'V1',status:'완료'}]);
 assert.deepEqual(b2Args(admin,'b2VocReply',[{key:'V1',cls:'5'}]),[{key:'V1',cls:'5'}]);
 assert.throws(()=>b2Args(admin,'b2VocReply',[{key:'V1',cls:'18'}]),/BAD_CLASS/);
 assert.deepEqual(vocForTeacher({rev:4,at:1,admin:9,open:{'3':2,'5':1},teacher:{'3':1,'7':2,'9':4}},['3','7']),{rev:4,at:1,teacher:{'3':1,'7':2},open:{'3':2}},'a teacher sees only their own classes and not the admin count');
 assert.deepEqual(b2Args(admin,'b2Docs',[{}]),[{}]);
 assert.deepEqual(b2Args(admin,'b2SyncNow',[{}]),[{}]);
 assert.deepEqual(b2Args(admin,'b2SyncNow',[{cls:'5'}]),[{cls:'5'}]);
 assert.deepEqual(b2Args(admin,'b2DocUpdate',[{id:'D1',status:'처리완료'}]),[{id:'D1',status:'처리완료'}]);
 assert.deepEqual(b2Args(admin,'b2Rev',[{cls:'1'}]),[]);
});

// 2기 담임 화면: teacher-workspace는 6탭 통합 화면(beta2-teacher-layout)을 띄웁니다. 화면 동작은 beta2-ui 시험('the teacher preview … six tabs')이 실제 index.html로 봅니다.
// 1기 8탭 화면 + '2기 베타' 탭 시험은 1기(cohort1 브랜치)에 남았습니다.
test('the 2기 teacher workspace is the six-tab layout backed by /api/teacher-beta, with later screens behind cohort features',()=>{
 const ws=readFileSync(join(base,'teacher-workspace.mjs'),'utf8'),layout=readFileSync(join(base,'beta2-teacher-layout.mjs'),'utf8');
 assert.ok(ws.includes("import('./beta2-teacher-layout.mjs")&&ws.includes('mountBeta2TeacherLayout'));assert.ok(!ws.includes('2기 베타'));
 assert.ok(layout.includes("TEACHER_TABS=[['today','오늘 할 일'],['attendance','출결'],['documents','서류 발급'],['feedback','민원·설문'],['schedule','시간표·자료'],['info','우리 반']]"));
 assert.ok(layout.includes("endpoint:'/api/teacher-beta'")&&layout.includes('feature(LATER[key])'));
});
