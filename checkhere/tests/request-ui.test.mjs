import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';import {PRIVACY_UPDATE_TEXT} from '../rules.mjs';
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
        if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountCheckHereRequests} from '/checkhere-requests.mjs';window.rows=[];window.applied=[];const record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'',outings:[]};const controller={refresh:async()=>{},state:()=>({records:[record],jobs:window.jobs||[],privacy:{state:'unmasked',leftSec:900},capabilities:['approval-current-sync-v1','live-approval-preview-v1','approved-requests-v1']}),api:async(path,input)=>{if(path==='preview-request')return{record};window.applied.push({path,input});if(window.failApply)throw Error('연결 끊김 시험');if(path==='apply')window.jobs=[{id:input.approvalId,status:'verified'}];if(path==='reconcile'){window.rows.find(r=>r.id===input.approvalId).status='verified';return{status:'verified',platformSaved:true};}return{};}};await mountCheckHereRequests(document.querySelector('#host'),{db:{},user:{email:'${email}',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'},classes:[{id:'2'}],admin:${role!=='teacher'},controller:()=>controller});</script>`});
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
// 체크히어 탭이 가려져 있으면(privacy) 승인·반영하지 않고 해제 안내만, 요청은 승인 대기 그대로(2026-10-16). 1교시가 든 삭제는 time-delete-v2, 퇴실이 남은 1교시만은 거절.
test('a time deletion request shows 삭제, needs time-delete-v1 and approves only the named blank',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),base=join(import.meta.dirname,'../..');
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const collection=(...x)=>x,doc=(...x)=>({id:x.at(-1)}),query=(...x)=>x,where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,serverTimestamp=()=>({seconds:1});export const getDocFromServer=(...a)=>getDoc(...a);export async function getDoc(){return{data:()=>undefined};}export async function setDoc(ref,data){window.rows.push({id:ref.id,...data});}export async function getDocs(){return{docs:window.rows.map(r=>({id:r.id,data:()=>r}))};}export async function runTransaction(db,fn){return fn({get:async ref=>({data:()=>window.rows.find(r=>r.id===ref.id)}),update(ref,data){Object.assign(window.rows.find(r=>r.id===ref.id),data);}});}`});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountCheckHereRequests} from '/checkhere-requests.mjs';window.caps=['approval-current-sync-v1','live-approval-preview-v1','approved-requests-v1'];window.applied=[];window.privacy={state:'masked',leftSec:null};
        window.rows=[{id:'b2_00000000-0000-4000-8000-000000000001',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',reason:'[실시간 베타] [2기 베타] 출결대조 시간 삭제 · 퇴실 [기준:0123abcd]',changes:{exit:''},deleteTimes:['exit'],status:'pending',createdBy:'admin@example.com',createdAt:{seconds:1}}];
        const record=window.record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',rawEntry:'09:00:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],entryKind:'ATTEND',entryEventId:true,exitEventId:true};
        const controller={select:()=>{},refresh:async()=>{},state:()=>({records:[record],jobs:window.jobs||[],capabilities:window.caps,privacy:window.privacy}),api:async(path,input)=>{if(path==='preview-request')return{record};window.applied.push({path,input});if(path==='apply')window.jobs=[{id:input.approvalId,status:'verified'}];if(path==='reconcile'){window.rows[0].status='verified';return{status:'verified',platformSaved:true};}return{};}};
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
    // 가린 화면: 검토 창 안내에 해제 필요, 누르면 승인하지 않고(승인 대기 그대로) 창 안·상태 줄에 안내, 연결 프로그램에 아무것도 보내지 않음
    const UNMASK='체크히어 마스킹 해제가 필요합니다. 수집 PC의 체크히어 탭에서 해제(또는 연장)한 뒤 다시 반영해 주세요.';
    assert.match(await page.locator('#approveNote').innerText(),new RegExp(UNMASK.replace(/[.()]/g,'\\$&')));
    assert.equal(await page.locator('#privacy').innerText(),' · 체크히어 가림 — 읽기만 가능 · 수정·삭제하려면 마스킹 해제 필요');
    await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
    await page.locator('#approveNote').getByText(UNMASK+' 요청은 그대로 둡니다.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.rows[0].status),'pending','not approved, not failed, not rejected');assert.deepEqual(await page.evaluate(()=>window.applied),[]);
    // 해제됐지만 남은 시간이 모자람(150초 미만): 그 글로 거절
    await page.evaluate(()=>{window.privacy={state:'unmasked',leftSec:100};});
    await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
    await page.locator('#approveNote').getByText('체크히어 해제 시간 100초 남음 — 연장해야 수정·삭제 가능 요청은 그대로 둡니다.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.rows[0].status),'pending');assert.deepEqual(await page.evaluate(()=>window.applied),[]);
    // 가림 상태를 알리지 않는 옛 연결 프로그램(privacy·masking 없음): 해제로는 풀리지 않으므로 업데이트 안내, 보내지 않음
    await page.evaluate(()=>{window.privacy=undefined;});
    await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
    await page.locator('#approveNote').getByText(PRIVACY_UPDATE_TEXT+' 요청은 그대로 둡니다.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.rows[0].status),'pending');assert.deepEqual(await page.evaluate(()=>window.applied),[]);
    // 사람이 해제(남은 시간 넉넉): 승인·반영
    await page.evaluate(()=>{window.privacy={state:'unmasked',leftSec:900};});
    await page.getByRole('button',{name:'승인하고 체크히어에 반영',exact:true}).click();
    await page.getByText('체크히어 반영·플랫폼 DB 저장 완료',{exact:true}).waitFor();
    const row=await page.evaluate(()=>window.rows[0]);
    assert.equal(row.status,'verified');assert.deepEqual(row.deleteTimes,['exit']);
    assert.equal(row.approval.after.exit,'','the named side is approved as a deletion');assert.equal(row.approval.after.entry,'09:00:00','the other side stays');
    assert.deepEqual(await page.evaluate(()=>window.applied.map(c=>c.path)),['apply','reconcile']);
    assert.equal(await page.locator('#privacy').innerText(),' · 체크히어 해제됨 · 15분 남음 — 수정·삭제 가능');
    // 1교시만 지우는 요청(퇴실이 남음): v2가 없으면 업데이트 안내, v2여도 퇴실이 남은 1교시만은 거절(rules.mjs). 승인 화면을 열지 않음
    await page.evaluate(()=>window.rows.push({id:'b2_00000000-0000-4000-8000-000000000002',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',reason:'[실시간 베타] [2기 베타] 출결대조 시간 삭제 · 입실(교시) [기준:0123abcd]',changes:{entry:''},deleteTimes:['entry'],status:'pending',createdBy:'admin@example.com',createdAt:{seconds:2}}));
    await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByText('입실·교시 시간: (시간 삭제)').waitFor();
    await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();
    await page.locator('#message').getByText(/1교시 삭제는 time-delete-v2 지원이 필요합니다/).waitFor();
    // 두 칸 삭제 요청(/beta2는 중계 신호가 없으면 v2로 보고 만듦, 2026-10-16)도 v2 없는 연결 프로그램에는 보내지 않음(같은 안내, 퇴실도 지우지 않음, 승인 대기 그대로)
    await page.evaluate(()=>{Object.assign(window.rows[1],{changes:{entry:'',exit:''},deleteTimes:['entry','exit']});document.querySelector('#host').shadowRoot.querySelector('#message').textContent='';});
    await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByText('퇴실 시간: (시간 삭제)').nth(1).waitFor();
    await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();
    await page.locator('#message').getByText('수집 PC에서 최신 체크히어 시작.cmd를 다시 실행해 주세요. 1교시 삭제는 time-delete-v2 지원이 필요합니다. 그 전에는 이 요청을 반영할 수 없습니다. 업데이트 뒤 다시 승인하거나 반려해 주세요.',{exact:true}).waitFor();
    assert.equal(await page.locator('#review[open]').count(),0);assert.equal(await page.evaluate(()=>window.rows[1].status),'pending');
    assert.deepEqual(await page.evaluate(()=>window.applied.map(c=>c.path)),['apply','reconcile'],'nothing more was sent');
    await page.evaluate(()=>Object.assign(window.rows[1],{changes:{entry:''},deleteTimes:['entry']}));
    await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByText('퇴실 시간: (시간 삭제)').nth(1).waitFor({state:'detached'});
    await page.evaluate(()=>window.caps.push('time-delete-v2'));
    await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();
    await page.locator('#message').getByText('퇴실이 남아 있으면 1교시만 지울 수 없습니다(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다). 퇴실과 함께 지워 주세요.',{exact:true}).waitFor();
    assert.equal(await page.locator('#review[open]').count(),0);assert.equal(await page.evaluate(()=>window.rows[1].status),'pending');
    assert.deepEqual(await page.evaluate(()=>window.applied.map(c=>c.path)),['apply','reconcile'],'nothing more was sent');
    // 「해당 날짜 수집」은 빠른 수집(mode incremental, 가린 화면에서도 읽힘). mode 없는 정밀 수집은 가린 화면에서 연결 프로그램이 거절합니다.
    await page.getByRole('button',{name:'해당 날짜 수집',exact:true}).click();await page.locator('#message').getByText(/해당 날짜를 수집 중입니다/).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.applied.at(-1)),{path:'sync',input:{classId:'2',dates:['2026-09-03'],mode:'incremental'}});
    // 승인 전에 퇴실이 이미 지워진 두 칸 요청: 빈 퇴실은 번호를 보지 않고(연결 프로그램과 같은 기준) 남은 1교시를 지울 승인 화면이 열림
    await page.evaluate(()=>{Object.assign(window.record,{exit:null,exitEventId:false});Object.assign(window.rows[1],{changes:{entry:'',exit:''},deleteTimes:['entry','exit']});});
    await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByText('퇴실 시간: (시간 삭제)').nth(1).waitFor();
    await page.getByRole('button',{name:'요청 승인·반영',exact:true}).click();await page.locator('#review[open]').waitFor();
    assert.doesNotMatch(await page.locator('#message').innerText(),/기록 번호를 확인하지 못했습니다/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

