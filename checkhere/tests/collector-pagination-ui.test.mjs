import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{join}from'node:path';import{loadPlaywright}from'../collector.mjs';
test('large collector results render 100 rows, preserve DOM on unchanged refresh, and share concurrent state reads',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();let stateCalls=0;
 const records=Array.from({length:501},(_,i)=>({id:'r'+i,version:'v1',rowIndex:i,classId:'2',date:'2026-09-03',name:'가상'+i,readState:'complete',source:'live',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],schedule:'09:00 ~ 18:00'}));
 try{
  await page.route('**/*',async route=>{const u=new URL(route.request().url());
   if(u.hostname==='127.0.0.1'){const headers={'access-control-allow-origin':'https://fixture.test','access-control-allow-headers':'x-hint-key,content-type','access-control-allow-private-network':'true'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});stateCalls++;return route.fulfill({headers,json:{records,jobs:[],connected:true}});}
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<div id="host"></div><script type="module">import{mountCheckHere}from'/checkhere-ui.mjs';await mountCheckHere(document.querySelector('#host'),{onController:c=>window.controller=c});</script>`});
   if(['/checkhere-ui.mjs','/checkhere/bulk-collect.mjs','/attendance-beta-core.mjs','/checkhere-name-core.mjs','/survey-identity.mjs','/checkhere/rules.mjs','/checkhere/ui.css'].includes(u.pathname))return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,u.pathname.slice(1)),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('textbox',{name:'로컬 연결 키'}).fill('fixture');await page.getByRole('button',{name:'연결',exact:true}).click();await page.getByText('1 / 6페이지 · 501건',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),100);
  await page.evaluate(()=>window.firstRow=document.querySelector('#host').shadowRoot.querySelector('tbody tr'));const before=stateCalls;await page.evaluate(()=>Promise.all([window.controller.refresh(),window.controller.refresh(),window.controller.refresh()]));assert.equal(stateCalls-before,1);assert(await page.evaluate(()=>window.firstRow===document.querySelector('#host').shadowRoot.querySelector('tbody tr')));
  await page.getByRole('button',{name:'다음 100건',exact:true}).click();await page.getByText('2 / 6페이지 · 501건',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),100);
  await page.getByRole('textbox',{name:'학생 이름 검색'}).fill('가상500');await page.getByText('1 / 1페이지 · 1건',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),1);
 }finally{await browser.close();}
});
