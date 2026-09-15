import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('version selection mounts only one reader, remembers individual choice and honors unsaved guard',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..'),loaded=[];
 try{await page.route('**/*',async r=>{const p=new URL(r.request().url()).pathname;
  if(p==='/')return r.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import{mountAttendanceVersion}from'/attendance-version.mjs';window.count={legacy:0,modern:0};window.start=async(email)=>{window.work?.dispose();window.work=await mountAttendanceVersion(document.querySelector('#host'),{user:{email},profile:{role:'ADMIN',active:true}})};await window.start('staff@example.com');</script>`});
  if(['/attendance-legacy.js','/attendance-overview.js'].includes(p)){const name=p.includes('legacy')?'legacy':'modern';loaded.push(name);return r.fulfill({contentType:'text/javascript',body:`export async function mountAttendanceOverview(host){window.count.${name}++;host.innerHTML='<h2>${name} reader</h2>';window.active??=new Set();window.active.add('${name}');const timer=setInterval(()=>{window.polls??={};window.polls.${name}=(window.polls.${name}||0)+1},20);return{canLeave:()=>!window.unsaved,dispose(){clearInterval(timer);window.active.delete('${name}')}}}`});}
  if(['/attendance-version.mjs','/attendance-rollout.mjs'].includes(p))return r.fulfill({contentType:'text/javascript',body:readFileSync(join(base,p),'utf8')});return r.abort();});
  await page.goto('https://fixture.test/');await page.getByRole('heading',{name:'legacy reader'}).waitFor();assert.deepEqual(loaded,['legacy']);
  await page.getByRole('combobox',{name:'화면 선택'}).selectOption('modern');await page.getByRole('heading',{name:'modern reader'}).waitFor();assert.deepEqual(await page.evaluate(()=>[...window.active]),['modern']);
  const oldPolls=await page.evaluate(()=>window.polls?.legacy||0);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.polls?.legacy||0),oldPolls);
  await page.evaluate(()=>window.unsaved=true);await page.getByRole('combobox').selectOption('legacy');assert.equal(await page.getByRole('combobox').inputValue(),'modern');
  await page.evaluate(()=>{window.unsaved=false;return window.start('staff@example.com')});await page.getByRole('heading',{name:'modern reader'}).waitFor();
  for(const email of ['hint.kpc@gmail.com','kpc.jtkim@gmail.com']){await page.evaluate(e=>window.start(e),email);await page.getByRole('heading',{name:'modern reader'}).waitFor();}
  await page.evaluate(()=>window.start('other@example.com'));await page.getByRole('heading',{name:'legacy reader'}).waitFor();await page.evaluate(()=>window.work.dispose());assert.deepEqual(await page.evaluate(()=>[...window.active]),[]);
 }finally{await browser.close();}
});
