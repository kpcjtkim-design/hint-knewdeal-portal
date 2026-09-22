import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {spawnSync} from 'node:child_process';

const base=join(import.meta.dirname,'../..');
const index=readFileSync(join(base,'index.html'),'utf8');
const teacher=readFileSync(join(base,'teacher-workspace.mjs'),'utf8');
const helper=index.slice(index.indexOf('let adminWork='),index.indexOf('const ADMIN_GROUPS='));
test('production module scripts retain valid syntax',()=>{
 const scripts=[...index.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.ok(scripts.length);
 for(const input of [...scripts,teacher]){
  const result=spawnSync(process.execPath,['--input-type=module','--check'],{input,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }
});
async function fixture(body,routes,run){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body});
   if(path==='/teacher-workspace.mjs')return route.fulfill({contentType:'text/javascript',body:teacher});
   if(routes[path])return routes[path](route);
   return route.abort();
  });
  await page.goto('https://fixture.test/');await run(page);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const js=body=>route=>route.fulfill({contentType:'text/javascript',body});
const deferredStub=name=>js(`export async function mount${name}(host,options){window.started.push({name:'${name}',compact:!!options.compact});await new Promise(resolve=>window.releases.push(resolve));window.live++;return{dispose(){window.disposed++;window.live--;}};}`);
const teacherMarkup='<div id="host"><div class="hero">우리 반</div><div class="section-head">오늘 꼭 할 일</div><div class="task-grid"></div><div class="section-head">공지</div><div class="notice"></div></div>';

test('admin navigation disposes a late mount without replacing the active page cleanup',async()=>{
 await fixture(`<main class="page"><div id="adminBody"></div></main><script type="module">${helper}
 window.pending={};window.disposals=[];window.mount=mountAdminModule;window.work=()=>adminWork;
 window.first=mountAdminModule('/slow.mjs','mount',{});
 </script>`,{
  '/slow.mjs':js(`export async function mount(){await new Promise(resolve=>window.pending.slow=resolve);return{id:'slow',dispose(){window.disposals.push('slow');}};}`),
  '/fast.mjs':js(`export async function mount(){return{id:'fast',dispose(){window.disposals.push('fast');}};}`)
 },async page=>{
  await page.waitForFunction(()=>window.pending.slow);
  await page.evaluate(async()=>{document.querySelector('.page').innerHTML='<div id="adminBody"></div>';await window.mount('/fast.mjs','mount',{});window.pending.slow();await window.first;});
  assert.deepEqual(await page.evaluate(()=>({work:window.work().id,disposed:window.disposals})),{work:'fast',disposed:['slow']});
 });
});

test('admin navigation skips module mounting if the import arrives after leaving',async()=>{
 let releaseImport;
 await fixture(`<main class="page"><div id="adminBody"></div></main><script type="module">${helper}window.mounted=0;window.pendingMount=mountAdminModule('/delayed.mjs','mount',{});</script>`,{
  '/delayed.mjs':async route=>{await new Promise(resolve=>releaseImport=resolve);return route.fulfill({contentType:'text/javascript',body:'export async function mount(){window.mounted++;}'});}
 },async page=>{
  // The route is pending, so no module code or backend read has started.
  await page.waitForFunction(()=>!!window.pendingMount);
  await page.evaluate(()=>document.querySelector('#adminBody').remove());
  releaseImport();await page.evaluate(()=>window.pendingMount);
  assert.equal(await page.evaluate(()=>window.mounted),0);
 });
});

test('teacher teardown owns every late summary and is idempotent',async()=>{
 await fixture(`${teacherMarkup}<script type="module">import{mountTeacherWorkspace}from'/teacher-workspace.mjs';window.started=[];window.releases=[];window.disposed=0;window.live=0;window.pending=mountTeacherWorkspace(document.querySelector('#host'),{db:{},user:{},classInfo:{id:'1'}});</script>`,{
  '/timetable.mjs':deferredStub('TeacherTimetable'),
  '/attendance-statistics.mjs':deferredStub('AttendanceStatistics'),
  '/survey-view.mjs':deferredStub('Surveys')
 },async page=>{
  await page.waitForFunction(()=>window.releases.length===3);
  await page.evaluate(()=>document.querySelector('#host').remove());
  await page.evaluate(async()=>{window.releases.forEach(resolve=>resolve());window.finished=await window.pending;});
  assert.deepEqual(await page.evaluate(()=>({started:window.started.length,disposed:window.disposed,live:window.live})),{started:3,disposed:3,live:0});
  await page.evaluate(()=>{window.finished.dispose();window.finished.dispose();});
  assert.equal(await page.evaluate(()=>window.disposed),3);
 });
});

test('slow legacy settings reads cannot overwrite the next administrator menu',async()=>{
 const settings=index.slice(index.indexOf('async function settingsAdmin('),index.indexOf('function overviewAdmin('));
 await fixture(`<main class="page"><div id="adminBody">settings pending</div></main><script type="module">${helper}
 const db={},DEFAULTS={};const doc=()=>null,getDoc=()=>new Promise(resolve=>window.releaseSettings=()=>resolve({exists:()=>false}));
 ${settings}
 window.pending=settingsAdmin({},{});
 </script>`,{},async page=>{
  await page.waitForFunction(()=>window.releaseSettings);
  await page.evaluate(async()=>{document.querySelector('.page').innerHTML='<div id="adminBody">new menu</div>';window.releaseSettings();await window.pending;});
  assert.equal(await page.locator('#adminBody').innerText(),'new menu');
 });
});

test('auth changes clear the read session and ignore a previous account profile result',async()=>{
 const authHandler=index.slice(index.indexOf('onAuthStateChanged(auth,async user=>'),index.indexOf('\n',index.indexOf('onAuthStateChanged(auth,async user=>')));
 await fixture(`<script type="module">${helper}
 const db={},auth={};window.profiles={};window.events=[];
 const onAuthStateChanged=(_auth,callback)=>window.authChange=callback;
 const clearReadSession=()=>window.events.push('clear'),profileFor=user=>new Promise(resolve=>window.profiles[user.id]=resolve);
 const loginView=()=>window.events.push('login'),denied=()=>window.events.push('denied'),fatal=()=>window.events.push('fatal');
 const adminView=user=>window.events.push('admin:'+user.id),teacherView=user=>window.events.push('teacher:'+user.id);
 ${authHandler}
 </script>`,{},async page=>{
  await page.waitForFunction(()=>window.authChange);
  await page.evaluate(async()=>{const first=window.authChange({id:'old'});await window.authChange(null);window.profiles.old({role:'ADMIN'});await first;const next=window.authChange({id:'new'});window.profiles.new({role:'TEACHER'});await next;});
  assert.deepEqual(await page.evaluate(()=>window.events),['clear','clear','login','clear','teacher:new']);
 });
});

test('teacher navigation respects active work canLeave and mounts each tab once',async()=>{
 const basic=method=>js(`export async function ${method}(){return{dispose(){}};}`);
 await fixture(`${teacherMarkup}<script type="module">import{mountTeacherWorkspace}from'/teacher-workspace.mjs';window.materialMounts=0;window.allowLeave=false;window.workspace=await mountTeacherWorkspace(document.querySelector('#host'),{db:{},user:{},classInfo:{id:'1'}});</script>`,{
  '/timetable.mjs':basic('mountTeacherTimetable'),
  '/attendance-statistics.mjs':basic('mountAttendanceStatistics'),
  '/survey-view.mjs':basic('mountSurveys'),
  '/lecture-materials.mjs':js('export async function mountLectureMaterials(host){window.materialMounts++;host.textContent="자료 편집";return{canLeave:()=>window.allowLeave,dispose(){}};}')
 },async page=>{
  await page.waitForFunction(()=>window.workspace);
  await page.getByRole('button',{name:'강의자료',exact:true}).click();
  await page.waitForFunction(()=>window.materialMounts===1);
  await page.getByRole('button',{name:'우리 반 홈',exact:true}).click();
  assert.equal(await page.locator('[data-teacher-panel="materials"]').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.workspace.canLeave()),false);
  await page.evaluate(()=>window.allowLeave=true);
  await page.getByRole('button',{name:'우리 반 홈',exact:true}).click();
  assert.equal(await page.locator('[data-teacher-panel="home"]').isVisible(),true);
  await page.getByRole('button',{name:'강의자료',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.materialMounts),1);
 });
});
