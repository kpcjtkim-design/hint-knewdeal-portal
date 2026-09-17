import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('teacher request, administrator approval preview and failure feedback in browser',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true});
  const base=join(import.meta.dirname,'../..');
  try{
    for(const role of ['teacher','staff','approver']){
      const page=await browser.newPage();page.on('dialog',d=>d.accept());
      const email=role==='approver'?'hint.kpc@gmail.com':role+'@example.com';
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const collection=(...x)=>x,doc=(...x)=>({id:x.at(-1)}),query=(...x)=>x,where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,serverTimestamp=()=>({seconds:1});export const getDocFromServer=(...a)=>getDoc(...a);export async function getDoc(){return{data:()=>undefined};}export async function setDoc(ref,data){window.rows.push({id:ref.id,...data});}export async function getDocs(){return{docs:window.rows.map(r=>({id:r.id,data:()=>r}))};}export async function runTransaction(db,fn){return fn({get:async ref=>({data:()=>window.rows.find(r=>r.id===ref.id)}),update(ref,data){Object.assign(window.rows.find(r=>r.id===ref.id),data);}});}`});
        if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountCheckHereRequests} from '/checkhere-requests.mjs';window.rows=[];window.applied=[];const record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'',outings:[]};const controller={refresh:async()=>{},state:()=>({records:[record],jobs:window.jobs||[],capabilities:['approval-current-sync-v1','approved-requests-v1']}),api:async(path,input)=>{window.applied.push({path,input});if(window.failApply)throw Error('연결 끊김 시험');if(path==='apply')window.jobs=[{id:input.approvalId,status:'verified'}];if(path==='reconcile'){window.rows.find(r=>r.id===input.approvalId).status='verified';return{status:'verified',platformSaved:true};}return{};}};await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'${email}',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'}],admin:${role!=='teacher'},controller:()=>controller});</script>`});
        if(['attendance-derived-core.mjs','survey-links.mjs','survey-core.mjs','survey-catalog.json','timetable-holiday.mjs','survey-view.mjs','survey-store.mjs','survey-google.mjs','survey.css','attendance-beta-core.mjs','attendance-rollout.mjs','attendance-io.mjs','attendance-io.mjs','checkhere-requests.mjs','checkhere/approval-core.mjs','checkhere/rules.mjs','attendance-beta-core.mjs','checkhere-request-actions.mjs','timetable-core.mjs','checkhere-proposals.mjs','attendance-reason-parser.mjs','checkhere-proposal-core.mjs'].includes(url.pathname.slice(1)))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,url.pathname.slice(1)),'utf8')});
        return route.abort();
      });
      await page.goto('https://fixture.test/');await page.getByText('수정 요청 작성',{exact:true}).click();
      await page.locator('#date').fill('2026-09-03');await page.locator('#name').fill('가상학생');await page.locator('[data-enable="entryMemo"]').check();await page.locator('#entryMemo').fill('정정 사유');await page.locator('#reason').fill('수기 확인');await page.getByRole('button',{name:'수정 요청 등록',exact:true}).click();
      await page.getByText('승인 대기',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.applied.length),0);
      assert.equal(await page.getByRole('button',{name:'변경 전후 확인',exact:true}).count(),role==='approver'?1:0);assert.equal(await page.locator('[data-bulk-approve]').count(),role==='approver'?3:0);
      if(role==='approver'){
        await page.getByRole('button',{name:'변경 전후 확인',exact:true}).click();await page.getByRole('cell',{name:'기존 사유',exact:true}).waitFor();
        await page.evaluate(()=>{window.failApply=true;});await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
        await page.getByText('연결 끊김 시험',{exact:true}).waitFor();
        const result=await page.evaluate(()=>({row:window.rows[0],calls:window.applied}));assert.equal(result.row.status,'approved');assert.equal(result.row.approval.after.exit,'18:00:00');assert.equal(result.calls[0].path,'apply');assert.equal(result.calls[0].input.approvalId,result.row.id);assert(!('entryMemo'in result.calls[0].input));
        await page.evaluate(()=>{window.failApply=false;});await page.getByRole('button',{name:'승인된 변경 반영',exact:true}).click();await page.getByText('체크히어 반영·플랫폼 DB 저장 완료',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.rows[0].status),'verified');assert.equal(await page.evaluate(()=>window.applied.filter(c=>c.path==='apply').length),2,'failed dispatch then one explicit retry');assert.equal(await page.evaluate(()=>window.applied.filter(c=>c.path==='reconcile').length),1);
      }
      if(role==='teacher'){
        await page.getByRole('button',{name:'요청취소',exact:true}).click();
        await page.getByText('요청취소됨 · 체크히어에 반영하지 않습니다.',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.rows[0].status),'withdrawn');
        assert.equal(await page.evaluate(()=>window.applied.length),0);
        await page.evaluate(()=>window.rows.push({...window.rows[0],id:'other',status:'pending',createdBy:'other@example.com'}));
        await page.getByRole('button',{name:'새로고침',exact:true}).click();
        assert.equal(await page.locator('[data-withdraw="other"]').count(),0,'staff cannot withdraw another staff request');
      }
      if(role!=='teacher')assert.equal(await page.locator('[data-withdraw]').count(),0,'administrator approval view only offers approval/rejection');
      await page.close();
    }
  }finally{await browser.close();}
});

