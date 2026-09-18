import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{join}from'node:path';import{loadPlaywright}from'../collector.mjs';
test('collector merges deltas without losing rows, isolates cloud views and resets a new PC connection',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 const row=(id,memo='')=>({id,version:memo||'v1',rowIndex:1,classId:'2',date:'2026-09-03',name:'가상'+id,readState:'complete',source:'live',entry:'09:00:00',exit:'18:00:00',entryMemo:memo,exitMemo:'',outings:[],schedule:'09:00 ~ 18:00'});
 const replies=[{recordsMode:'replace',cursor:'one:1',records:[row('a'),row('b')]},{recordsMode:'merge',cursor:'one:2',records:[row('a','수정됨')]},{recordsMode:'merge',cursor:'one:2',records:[]},{recordsMode:'merge',cursor:'one:2',records:[]},{recordsMode:'replace',cursor:'two:1',records:[row('c')]}];
 const cursors=[];let stateCalls=0,failNext=false;
 try{
  await page.route('**/*',async route=>{const u=new URL(route.request().url());
   if(u.hostname==='127.0.0.1'){const headers={'access-control-allow-origin':'https://fixture.test','access-control-allow-headers':'x-hint-key,content-type','access-control-allow-private-network':'true'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});cursors.push(u.searchParams.get('cursor'));assert.equal(u.searchParams.get('delta'),'1');if(failNext){failNext=false;return route.fulfill({status:503,headers,json:{error:'가상 연결 오류'}});}return route.fulfill({headers,json:{jobs:[],connected:true,...replies[stateCalls++]}});}
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><div id="host"></div><script type="module">import{mountCheckHere}from'/checkhere-ui.mjs';await mountCheckHere(document.querySelector('#host'),{load:async()=>[${JSON.stringify(row('cloud'))}],save:async()=>({}),onController:c=>window.controller=c});</script>`});
   if(['/checkhere-ui.mjs','/checkhere/bulk-collect.mjs','/attendance-beta-core.mjs','/checkhere-name-core.mjs','/survey-identity.mjs','/checkhere/rules.mjs','/checkhere/ui.css'].includes(u.pathname))return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,u.pathname.slice(1)),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('textbox',{name:'로컬 연결 키'}).fill('fixture-one');await page.getByRole('button',{name:'연결',exact:true}).click();await page.getByText('가상b',{exact:true}).waitFor();
  await page.evaluate(()=>window.controller.refresh());assert.equal(await page.locator('tbody tr').count(),2);await page.getByText('수정됨',{exact:true}).waitFor();
  failNext=true;assert.equal(await page.evaluate(()=>window.controller.refresh().catch(e=>e.message)),'가상 연결 오류');
  await page.evaluate(()=>window.controller.refresh());assert.equal(await page.locator('tbody tr').count(),2);
  await page.getByRole('button',{name:'플랫폼 저장본 조회',exact:true}).click();await page.getByText('가상cloud',{exact:true}).waitFor({timeout:3000});
  await page.evaluate(()=>window.controller.refresh());await page.getByText('가상b',{exact:true}).waitFor();assert.equal(await page.getByText('가상cloud',{exact:true}).count(),0);assert.equal(await page.locator('tbody tr').count(),2);
  await page.locator('summary').filter({hasText:'수집 연결 프로그램 설정'}).click();await page.getByRole('textbox',{name:'로컬 연결 키'}).fill('fixture-two');await page.getByRole('button',{name:'연결',exact:true}).click();await page.getByText('가상c',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),1);
  assert.deepEqual(cursors,[null,'one:1','one:2','one:2','one:2',null]);assert.equal(stateCalls,5);
 }finally{await browser.close();}
});
