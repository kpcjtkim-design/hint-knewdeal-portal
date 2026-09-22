import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
const base=join(import.meta.dirname,'../..');

for(const removal of ['detach','replace'])test(`statistics stops after first read when its pending view is ${removal==='detach'?'detached':'replaced'}`,async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',route=>{
   const path=new URL(route.request().url()).pathname.slice(1);
   if(path==='survey-store.mjs')return route.fulfill({contentType:'text/javascript',body:`export function createSurveyStore(){return{read:cid=>{window.reads.push(cid);return new Promise(resolve=>window.release=()=>resolve({}));}}}`});
   if(path==='')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import{mountSurveyStatistics}from'/survey-statistics.mjs';window.reads=[];window.pending=mountSurveyStatistics(document.querySelector('#host'),{db:{},user:{},classes:Array.from({length:17},(_,i)=>({id:String(i+1)}))});window.pending.then(work=>{window.work=work;window.finished=true;});</script>`});
   if(/\.(mjs|css)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>typeof window.release==='function');
  await page.evaluate(mode=>{const host=document.querySelector('#host');window.originalBody=host.shadowRoot.querySelector('#body');if(mode==='detach')host.remove();else host.shadowRoot.innerHTML='<div id="body">다음 화면</div>';window.release();},removal);
  await page.waitForFunction(()=>window.finished,{},{timeout:2000});
  assert.deepEqual(await page.evaluate(()=>window.reads),['1']);
  assert.equal(await page.evaluate(()=>window.originalBody.textContent),'통계를 불러오는 중…');
  if(removal==='replace')assert.equal(await page.locator('#body').innerText(),'다음 화면');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

for(const phase of ['import','mount'])test(`survey chart ${phase} finishing after parent disposal cannot retain a background view`,async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',route=>{
   const path=new URL(route.request().url()).pathname.slice(1);
   if(path==='survey-statistics.mjs')return route.fulfill({contentType:'text/javascript',body:`${phase==='import'?'await new Promise(resolve=>window.releaseChart=resolve);':''}export async function mountSurveyStatistics(){window.chartMounts++;${phase==='mount'?'await new Promise(resolve=>window.releaseChart=resolve);':''}return{dispose(){window.chartDisposals++;}}}`});
   if(path==='survey-store.mjs')return route.fulfill({contentType:'text/javascript',body:`export function createSurveyStore(){return{read:async()=>({}),configuration:async()=>({}),syncStatus:async()=>null}}`});
   if(path==='timetable-store.mjs')return route.fulfill({contentType:'text/javascript',body:`export function createTimetableStore(){return{read:async()=>({entries:[]})}}`});
   if(path==='attendance-derived-store.mjs')return route.fulfill({contentType:'text/javascript',body:`export async function syncAttendanceSummary(){throw Error('must not sync');}`});
   if(path==='survey-catalog.json')return route.fulfill({json:{events:[],responseSources:[]}});
   if(path==='')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import{mountSurveys}from'/survey-view.mjs';window.chartMounts=0;window.chartDisposals=0;window.work=await mountSurveys(document.querySelector('#host'),{db:{},user:{},classes:[{id:'1'}]});</script>`});
   if(/\.(mjs|css)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('button',{name:'응답률 · 만족도 통계'}).click();await page.waitForFunction(()=>typeof window.releaseChart==='function');
  await page.evaluate(()=>{window.work.dispose();window.releaseChart();});
  if(phase==='mount')await page.waitForFunction(()=>window.chartDisposals===1,{},{timeout:2000});else await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.chartMounts),phase==='mount'?1:0);
  assert.equal(await page.evaluate(()=>document.querySelector('#host').shadowRoot.querySelectorAll(':scope > section').length),0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
