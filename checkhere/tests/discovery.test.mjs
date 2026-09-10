import test from 'node:test';import assert from 'node:assert/strict';import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
test('delayed lecture rows and paginated dates load before searching',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
  try{
    await page.route('https://check.ihereapp.com/**',async route=>{
      const u=new URL(route.request().url());let html='<a href="/account/admin">관리자</a>';
      if(u.pathname==='/history/lecture')html+=`<table><tbody id="rows"></tbody></table><script>setTimeout(()=>{document.querySelector('#rows').innerHTML='<tr><td>[2반] 가상 강의</td><td><button id="view">보기</button></td></tr>';document.querySelector('#view').onclick=()=>location.href='/history/lecture/fixture?academyId=fixture';},350);</script>`;
      else if(u.pathname.endsWith('/fixture'))html+=`<table><tr><td>기간 2026-09-07 ~ 2026-10-22</td></tr></table><table><tbody id="rows"></tbody></table>${[1,2,3,4].map(i=>`<button onclick="show(${i})">${i}</button>`).join('')}<script>function show(n){document.querySelector('#rows').innerHTML='';setTimeout(()=>{let date=n===4?'2026-09-07':'2026-09-0'+n;let url='/history/lecture/modify?scheduleDate='+date+'&scheduleId=fixture';document.querySelector('#rows').innerHTML='<tr><td>'+date+'</td><td><button id="view">보기</button></td></tr>';document.querySelector('#view').onclick=()=>location.href=url;},350);}show(1);</script>`;
      await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
    });
    const c=new CheckHereCollector('',{page});await page.goto('https://check.ihereapp.com/dashboard/summary');assert.equal(await c.loggedIn(),true);
    const result=await c.discover('2','2026-09-07');assert.equal(new URL(result).searchParams.get('scheduleDate'),'2026-09-07');
  }finally{await browser.close();}
});

