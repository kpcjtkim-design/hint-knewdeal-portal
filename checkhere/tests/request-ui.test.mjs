import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
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
        if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountCheckHereRequests} from '/checkhere-requests.mjs';window.rows=[];window.applied=[];const record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'',outings:[]};const controller={refresh:async()=>{},state:()=>({records:[record],jobs:window.jobs||[],capabilities:['approval-current-sync-v1','live-approval-preview-v1','approved-requests-v1']}),api:async(path,input)=>{if(path==='preview-request')return{record};window.applied.push({path,input});if(window.failApply)throw Error('연결 끊김 시험');if(path==='apply')window.jobs=[{id:input.approvalId,status:'verified'}];if(path==='reconcile'){window.rows.find(r=>r.id===input.approvalId).status='verified';return{status:'verified',platformSaved:true};}return{};}};await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'${email}',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'}],admin:${role!=='teacher'},controller:()=>controller});</script>`});
        const file=url.pathname.slice(1);if(url.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(file)&&!file.split('/').includes('..')&&existsSync(join(base,file)))return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,file),'utf8')});
        return route.abort();
      });
      await page.goto('https://fixture.test/');await page.getByText('수정 요청 작성',{exact:true}).click();
      await page.locator('#date').fill('2026-09-03');await page.locator('#name').fill('가상학생');await page.locator('[data-enable="entryMemo"]').check();await page.locator('#entryMemo').fill('정정 사유');await page.locator('#reason').fill('수기 확인');await page.getByRole('button',{name:'수정 요청 등록',exact:true}).click();
      await page.getByText('승인 대기',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.applied.length),0);
      assert.equal(await page.getByRole('button',{name:'요청 승인·반영',exact:true}).count(),role==='approver'?1:0);assert.equal(await page.locator('[data-bulk-approve]').count(),role==='approver'?3:0);
      if(role==='approver'){
        await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();await page.getByRole('cell',{name:'기존 사유',exact:true}).waitFor();
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
// 시간 삭제 요청(deleteTimes, /beta2 출결대조가 만듦): 목록·검토 화면은 '공란' 대신 '삭제', 연결 프로그램에 time-delete-v1이 있어야 승인합니다.
test('a time deletion request shows 삭제, needs time-delete-v1 and approves only the named blank',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),base=join(import.meta.dirname,'../..');
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const collection=(...x)=>x,doc=(...x)=>({id:x.at(-1)}),query=(...x)=>x,where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,serverTimestamp=()=>({seconds:1});export const getDocFromServer=(...a)=>getDoc(...a);export async function getDoc(){return{data:()=>undefined};}export async function setDoc(ref,data){window.rows.push({id:ref.id,...data});}export async function getDocs(){return{docs:window.rows.map(r=>({id:r.id,data:()=>r}))};}export async function runTransaction(db,fn){return fn({get:async ref=>({data:()=>window.rows.find(r=>r.id===ref.id)}),update(ref,data){Object.assign(window.rows.find(r=>r.id===ref.id),data);}});}`});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountCheckHereRequests} from '/checkhere-requests.mjs';window.caps=['approval-current-sync-v1','live-approval-preview-v1','approved-requests-v1'];window.applied=[];
        window.rows=[{id:'b2_00000000-0000-4000-8000-000000000001',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',reason:'[실시간 베타] [2기 베타] 출결대조 시간 삭제 · 퇴실 [기준:0123abcd]',changes:{exit:''},deleteTimes:['exit'],status:'pending',createdBy:'admin@example.com',createdAt:{seconds:1}}];
        const record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'09:00:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],entryKind:'ATTEND',entryEventId:true,exitEventId:true};
        const controller={refresh:async()=>{},state:()=>({records:[record],jobs:window.jobs||[],capabilities:window.caps}),api:async(path,input)=>{if(path==='preview-request')return{record};window.applied.push({path,input});if(path==='apply')window.jobs=[{id:input.approvalId,status:'verified'}];if(path==='reconcile'){window.rows[0].status='verified';return{status:'verified',platformSaved:true};}return{};}};
        await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'}],admin:true,controller:()=>controller});</script>`});
      const file=url.pathname.slice(1);if(url.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(file)&&!file.split('/').includes('..')&&existsSync(join(base,file)))return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,file),'utf8')});
      return route.abort();
    });
    await page.goto('https://fixture.test/');
    await page.getByText('퇴실 시간: (시간 삭제)').waitFor();
    // 능력 없는 연결 프로그램: 승인 화면을 열지 않고 업데이트 안내
    await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();
    await page.locator('#message').getByText(/체크히어 시간 삭제 지원이 필요합니다/).waitFor();
    assert.equal(await page.locator('#review[open]').count(),0);assert.deepEqual(await page.evaluate(()=>window.applied),[]);
    // time-delete-v1: 검토 표는 지금 값 → '삭제', 경고는 실제 입실 기록이 남는다는 안내
    await page.evaluate(()=>window.caps.push('time-delete-v1'));
    await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();
    await page.locator('#review').getByRole('cell',{name:'삭제',exact:true}).waitFor();
    assert.equal(await page.locator('#review').getByRole('cell',{name:'18:00:00',exact:true}).count(),1);
    assert.equal(await page.locator('#review').getByRole('cell',{name:'공란',exact:true}).count(),0);
    assert.match(await page.locator('#review').innerText(),/퇴실 시간을 삭제합니다\. 실제 입실 기록은 남을 수 있습니다/);
    await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
    await page.getByText('체크히어 반영·플랫폼 DB 저장 완료',{exact:true}).waitFor();
    const row=await page.evaluate(()=>window.rows[0]);
    assert.equal(row.status,'verified');assert.deepEqual(row.deleteTimes,['exit']);
    assert.equal(row.approval.after.exit,'','the named side is approved as a deletion');assert.equal(row.approval.after.entry,'09:00:00','the other side stays');
    assert.deepEqual(await page.evaluate(()=>window.applied.map(c=>c.path)),['apply','reconcile']);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

