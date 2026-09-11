import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('teacher request, administrator approval preview and failure feedback in browser',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true});
  const base=join(import.meta.dirname,'../..');
  try{
    for(const role of ['teacher','staff','approver']){
      const page=await browser.newPage();
      const email=role==='approver'?'hint.kpc@gmail.com':role+'@example.com';
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const collection=(...x)=>x,doc=(...x)=>({id:x.at(-1)}),query=(...x)=>x,where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,serverTimestamp=()=>({seconds:1});export async function getDoc(){return{data:()=>undefined};}export async function setDoc(ref,data){window.rows.push({id:ref.id,...data});}export async function getDocs(){return{docs:window.rows.map(r=>({id:r.id,data:()=>r}))};}export async function runTransaction(db,fn){return fn({get:async ref=>({data:()=>window.rows.find(r=>r.id===ref.id)}),update(ref,data){Object.assign(window.rows.find(r=>r.id===ref.id),data);}});}`});
        if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountCheckHereRequests} from '/checkhere-requests.mjs';window.rows=[];window.applied=[];const record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'',outings:[]};const controller={refresh:async()=>{},state:()=>({records:[record],capabilities:['approved-requests-v1']}),api:async(path,input)=>{window.applied.push({path,input});if(window.failApply)throw Error('연결 끊김 시험');return{};}};await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'${email}',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'}],admin:${role!=='teacher'},controller:()=>controller});</script>`});
        if(['checkhere-requests.mjs','checkhere/approval-core.mjs','checkhere/rules.mjs','attendance-beta-core.mjs','checkhere-proposals.mjs','checkhere-proposal-core.mjs'].includes(url.pathname.slice(1)))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,url.pathname.slice(1)),'utf8')});
        return route.abort();
      });
      await page.goto('https://fixture.test/');await page.getByText('수정 요청 작성',{exact:true}).click();
      await page.locator('#date').fill('2026-09-03');await page.locator('#name').fill('가상학생');await page.locator('[data-enable="entryMemo"]').check();await page.locator('#entryMemo').fill('정정 사유');await page.locator('#reason').fill('수기 확인');await page.getByRole('button',{name:'수정 요청 등록',exact:true}).click();
      await page.getByText('승인 대기',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.applied.length),0);
      assert.equal(await page.getByRole('button',{name:'변경 전후 확인',exact:true}).count(),role==='approver'?1:0);
      if(role==='approver'){
        await page.getByRole('button',{name:'변경 전후 확인',exact:true}).click();await page.getByRole('cell',{name:'기존 사유',exact:true}).waitFor();
        await page.evaluate(()=>{window.failApply=true;});await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
        await page.getByText('연결 끊김 시험',{exact:true}).waitFor();
        const result=await page.evaluate(()=>({row:window.rows[0],calls:window.applied}));assert.equal(result.row.status,'approved');assert.equal(result.row.approval.after.exit,'18:00:00');assert.equal(result.calls[0].path,'apply');assert.equal(result.calls[0].input.approvalId,result.row.id);assert(!('entryMemo'in result.calls[0].input));
      }
      await page.close();
    }
  }finally{await browser.close();}
});

