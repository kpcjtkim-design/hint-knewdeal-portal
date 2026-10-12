import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import handler,{resolveClass,teacherClassIds} from '../../api/teacher-beta.js';

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
 assert.equal(resolveClass(teacher,{cls:7},'portalCheck',[7,'',12,'완료']),7,'temporary class is allowed');
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
 await call({action:'portalCheck',args:[9,'1234',12,'완료'],cls:4},{email:'kpc.jtkim@gmail.com',header:false});
 assert.deepEqual(calls.at(-1).body.args,[4,'',12,'완료'],'body idToken works like other api routes and the PIN is always blank');
 const before=calls.length;
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

const DATA={cls:1,region:'수도권',course:'임베디드 AI(HW)',teacher:'김담임',place:'본관',mainDay:'2026-10-12',days:['2026-10-12','2026-10-08'],
 week:[{date:'2026-10-12',subj:'자동차개론',place:'본관'}],summary:[{k:'총원',v:2},{k:'출석',v:1}],
 kids:[{name:'홍길동',status:'재학',off:''},{name:'김철수',status:'재학',off:''}],recs:{'홍길동|2026-10-12':{type:'출석'}},
 checks:[{label:'오전',items:[{row:5,text:'출석 확인',value:''}]}],closed:'미확인',evals:[],sats:[],vocs:[],officer:{leader:'홍길동'}};
const teacherMarkup='<div id="host"><div class="hero">우리 반</div><div class="section-head">오늘 꼭 할 일</div><div class="task-grid"></div><div class="section-head">공지</div><div class="notice"></div></div>';
async function workspace(api,run,{preview=true}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],outside=[],posts=[];
 const js=body=>route=>route.fulfill({contentType:'text/javascript',body});
 const stub=method=>js(`export async function ${method}(){return{dispose(){}};}`);
 const routes={'/teacher-workspace.mjs':js(readFileSync(join(base,'teacher-workspace.mjs'),'utf8')),'/teacher-beta.js':js(readFileSync(join(base,'teacher-beta.js'),'utf8')),
  '/timetable.mjs':stub('mountTeacherTimetable'),'/attendance-statistics.mjs':stub('mountAttendanceStatistics'),'/survey-view.mjs':stub('mountSurveys')};
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='fixture.test'){outside.push(url.href);return route.abort();}
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:`${teacherMarkup}<script type="module">import{mountTeacherWorkspace}from'/teacher-workspace.mjs';window.workspace=await mountTeacherWorkspace(document.querySelector('#host'),{db:{},user:{getIdToken:async()=>'id-token-1'},classInfo:{id:'1'},preview:${preview}});</script>`});
   if(url.pathname==='/api/teacher-beta'){const r=route.request();posts.push({auth:r.headers().authorization,body:r.postDataJSON()});return route.fulfill({contentType:'application/json',...api(r.postDataJSON())});}
   if(routes[url.pathname])return routes[url.pathname](route);
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.workspace);
  await run(page,posts);
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[],'no request leaves the portal (script.google.com included)');
 }finally{await browser.close();}
}

test('teachers do not see the 2기 베타 tab while it is administrator-only',async()=>{
 await workspace(()=>({status:500,body:'{}'}),async(page,posts)=>{
  assert.equal(await page.locator('[data-teacher-tab]').last().innerText(),'자료·바로가기');
  assert.equal(await page.getByRole('button',{name:'2기 베타',exact:true}).count(),0);
  assert.equal(posts.length,0);
 },{preview:false});
});

test('in administrator preview the 2기 베타 tab is last, mounts lazily once, and shows a setup notice without breaking other tabs',async()=>{
 await workspace(()=>({status:503,body:JSON.stringify({ok:false,code:'NOT_CONFIGURED',error:'데이터 API 연결 전입니다. 운영자가 연결을 마치면 바로 사용할 수 있습니다.'})}),async(page,posts)=>{
  assert.equal(await page.locator('[data-teacher-tab]').last().innerText(),'2기 베타');
  assert.equal(posts.length,0,'nothing is read until the tab opens');
  await page.getByRole('button',{name:'2기 베타',exact:true}).click();
  await page.getByText('데이터 API 연결 전입니다').waitFor();
  assert.equal(await page.getByText('2기 베타 준비 중').isVisible(),true);
  assert.deepEqual(posts,[{auth:'Bearer id-token-1',body:{action:'portalData',args:[1,''],cls:1}}]);
  await page.getByRole('button',{name:'우리 반 홈',exact:true}).click();
  assert.equal(await page.locator('[data-teacher-panel="home"]').isVisible(),true);
  await page.getByRole('button',{name:'2기 베타',exact:true}).click();
  assert.equal(posts.length,1,'returning to the tab does not mount again');
 });
});

test('the beta view leaves duplicated portal sections to their existing tabs',async()=>{
 await workspace(()=>({body:JSON.stringify({ok:true,data:DATA})}),async page=>{
  await page.getByRole('button',{name:'2기 베타',exact:true}).click();
  await page.getByText('오늘 출결 (10/12(월))').waitFor();
  for(const removed of ['금주교육','2기 베타 담임화면','기본 정보'])assert.equal(await page.getByText(removed).count(),0,removed);
  await page.getByRole('button',{name:'학습자 평가',exact:true}).click();
  await page.getByText('「만족도조사」 탭에서').waitFor();
  assert.equal(await page.getByText('만족도 평가').count(),0);
  await page.getByRole('button',{name:'출결판',exact:true}).click();
  assert.equal(await page.locator('table.g select').count(),4);
 });
});
