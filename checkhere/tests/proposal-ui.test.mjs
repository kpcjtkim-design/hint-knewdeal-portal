import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('inline recommendations, manual edits, three independent requests, column bulk requests and source conflicts',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.docs={};export const doc=(...x)=>({path:x.slice(1).join('/')}),collection=(...x)=>x,query=(...x)=>x,where=(...x)=>x,serverTimestamp=()=>({seconds:Date.now()/1000});export const getDocFromServer=(...a)=>getDoc(...a);export async function getDoc(r){const v=window.docs[r.path];return{data:()=>v,exists:()=>!!v};}const merge=(a,b)=>{for(const[k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){if(!a[k])a[k]={};merge(a[k],v);}else a[k]=v;}return a;};export async function getDocs(){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith('checkhereRequests/')).map(([k,v])=>({id:k.split('/')[1],data:()=>v}))};}export async function runTransaction(db,fn){return fn({get:getDoc,update:(r,v)=>Object.assign(window.docs[r.path],v),set:(r,v)=>{window.docs[r.path]=merge(window.docs[r.path]||{},v);}});}`});
   if(u.pathname==='/api/attendance-reader')return route.fulfill({json:{ok:true,attendance:[['이름','','','','9/3'],['가상학생','','','','인정출석'],['다른학생','','','','인정출석']],reasons:[['','','','','9/3'],['','','','',await page.evaluate(()=>window.sheetRaw)]]}});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import{createProposalReview,validateLinkedRequest}from'/checkhere-proposals.mjs';window.record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'홍길동',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'13:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[]};window.s={name:'가상학생',rowIndex:0};window.context={classId:'2',date:'2026-09-03',name:'가상학생',status:'인정지각',reason:'병원',raw:'가상학생: 병원',record};window.sheetRaw=context.raw;const user={email:'staff@example.com',getIdToken:async()=>'fixture'};window.docs['settings/attendanceBeta_2_2026-09-03']={students:{'0_가상학생':{portalStatus:'인정지각',sheetStatus:'인정출석'}}};const host=document.querySelector('#host'),root=host.attachShadow({mode:'open'});window.students=[s];root.innerHTML='<div id=rows></div>';function render(){root.querySelector('#rows').innerHTML=['times','entryMemo','exitMemo'].map(c=>'<button data-proposal-bulk='+c+'>'+c+' 일괄요청</button>').join('')+window.students.map(student=>['times','entryMemo','exitMemo'].map(c=>review.html(student,c)).join('')).join('');review.bind(window.students);}const review=createProposalReview({db:{},user,root,getContext:student=>student===s?context:({...context,name:student.name,status:'인정출석',reason:'시험',record:{...record,name:student.name,id:'second-record',entry:'09:00:00'}}),render,showErr:e=>{window.problem=e.message},hasUnsavedReason:()=>!!window.unsaved});window.refreshProposals=()=>review.refresh(window.students);window.reload=async()=>{await review.load('2','2026-09-03');render();};window.validate=async()=>{const [id,r]=Object.entries(window.docs).find(([k,v])=>k.startsWith('checkhereRequests/')&&v.changes.entryMemo);try{await validateLinkedRequest({},user,{id:id.split('/')[1],...r},record);return 'ok';}catch(e){return e.message;}};await window.reload();</script>`});
   const p=u.pathname.slice(1);if(['attendance-io.mjs','checkhere-request-actions.mjs','timetable-core.mjs','checkhere-proposals.mjs','attendance-reason-parser.mjs','checkhere-proposal-core.mjs','attendance-beta-core.mjs','checkhere/approval-core.mjs','checkhere/rules.mjs'].includes(p))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,p),'utf8')});return route.abort();
  });

  await page.goto('https://fixture.test/');
  const memo=page.getByLabel('가상학생 입실·교시 사유 추천사유',{exact:true});
  await memo.waitFor();assert.equal(await memo.inputValue(),'(인정지각)병원_담임:홍길동(13:00)');
  assert.equal(await page.getByLabel('가상학생 추천 입실시간').inputValue(),'09:00:00');
  const count=()=>page.evaluate(()=>Object.keys(window.docs).filter(k=>k.startsWith('checkhereRequests/')).length);
  const open=column=>page.locator(`[data-proposal-bulk="${column}"]`).click();
  const close=()=>page.locator('#closeRequests').click();
  await memo.fill('(인정지각)병원_담임:홍길동(13:01)');assert.equal(await count(),0,'editing never writes CheckHere requests');
  await page.evaluate(()=>window.unsaved=true);await open('entryMemo');assert.equal(await count(),0,'preview only');
  await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'0건 요청 접수 · 1건 실패'}).waitFor();assert.match(await page.locator('#requestResult').innerText(),/시트에 저장하지 않은 사유/);await close();
  await page.evaluate(()=>window.unsaved=false);await open('entryMemo');await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'1건 요청 접수 · 0건 실패'}).waitFor();await close();
  assert.equal(await count(),1);assert(await memo.isDisabled());
  assert.equal(await page.evaluate(()=>Object.values(window.docs).find(v=>v.changes?.entryMemo)?.changes.entryMemo),'(인정지각)병원_담임:홍길동(13:01)');
  await open('times');await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'1건 요청 접수 · 0건 실패'}).waitFor();await close();assert.equal(await count(),2,'entry reason does not block time request');
  await page.getByLabel('가상학생 퇴실 사유 추천사유',{exact:true}).fill('관리자가 확인한 퇴실 사유');
  await page.locator('[data-proposal-send="0_가상학생__exitMemo"]').click();await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'1건 요청 접수 · 0건 실패'}).waitFor();await close();assert.equal(await count(),3,'third column can be requested independently');
  await page.evaluate(()=>window.record.entry='14:00:00');assert.match(await page.evaluate(()=>window.validate()),/실제 시간이 바뀌었습니다/);await page.evaluate(()=>window.record.entry='13:00:00');
  await page.evaluate(async()=>{const r=Object.values(window.docs).find(v=>v.changes?.entry);r.status='verified';r.approvedBy='hint.kpc@gmail.com';r.approval={recordId:'record-id',before:{entry:'13:00:00',exit:'18:00:00'},after:{entry:'09:00:00',exit:'18:00:00'}};await window.reload();});
  assert(await page.locator('[data-proposal-send="0_가상학생__times"]').isDisabled(),'verified writes must not be requested again from an old platform snapshot');
  await page.getByText('반영 확인 완료 · 재수집 후 플랫폼에 저장해 주세요.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.validate()),'ok');
  await page.evaluate(()=>{window.sheetRaw+='\n다른학생: 시험';window.record.version='v2';window.record.entry='09:00:00';});assert.equal(await page.evaluate(()=>window.validate()),'ok','earlier time approval and other student reason do not invalidate memo request');
  await page.evaluate(()=>window.record.entryMemo='다른 직원의 수정');assert.match(await page.evaluate(()=>window.validate()),/기록과 다릅니다/);
  await page.evaluate(()=>{window.record.entryMemo='';window.sheetRaw='가상학생: 면접\n다른학생: 시험';});assert.match(await page.evaluate(()=>window.validate()),/바뀌었습니다/);
  await page.evaluate(async()=>{for(const[k,v]of Object.entries(window.docs))if(k.startsWith('checkhereRequests/'))v.status='rejected';window.context.reason='면접';window.context.raw=window.sheetRaw;window.record.entry='13:00:00';await window.reload();});
  assert.equal(await memo.inputValue(),'(인정지각)병원_담임:홍길동(13:01)');assert(await page.locator('[data-proposal-send="0_가상학생__entryMemo"]').isDisabled());
  await page.locator('[data-proposal-reset="0_가상학생__entryMemo"]').click();assert.equal(await memo.inputValue(),'(인정지각)면접_담임:홍길동(13:00)');
  // Add a second row, retaining the first row's saved draft. Both must be reviewed before the bulk write.
  await page.evaluate(async()=>{window.students.push({name:'다른학생',rowIndex:1});await window.reload();});
  await page.locator('[data-proposal-reset="0_가상학생__entryMemo"]').click();
  await open('entryMemo');assert.equal(await page.locator('#sendSelected').innerText(),'2건 변경요청');assert.equal(await count(),3);
  await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'2건 요청 접수 · 0건 실패'}).waitFor();await close();assert.equal(await count(),5);
  // Withdrawal changes only pending status, preserves history, and permits a fresh request.
  await page.locator('[data-proposal-withdraw="0_가상학생__entryMemo"]').click();
  await page.waitForFunction(()=>Object.values(window.docs).some(v=>v.status==='withdrawn'));
  assert.equal(await count(),5);assert(await memo.isEnabled());
  assert.equal(await page.evaluate(()=>Object.values(window.docs).find(v=>v.status==='withdrawn').createdBy),'staff@example.com');
  const cancelledValue=await memo.inputValue();
  await page.locator('[data-proposal-send="0_가상학생__entryMemo"]').click();await page.locator('#sendSelected').click();await page.locator('#requestResult').filter({hasText:'1건 요청 접수 · 0건 실패'}).waitFor();await close();
  assert.equal(await count(),6,'identical reason after cancellation creates a new request ID');
  assert.equal(await page.evaluate(()=>Object.values(window.docs).find(v=>v.name==='가상학생'&&v.status==='pending').changes.entryMemo),cancelledValue);
  await page.locator('[data-proposal-withdraw="0_가상학생__entryMemo"]').click();await page.waitForFunction(()=>Object.values(window.docs).filter(v=>v.status==='withdrawn').length===2);
  // Untouched auto drafts follow new Sheet data. Manual edits are retained with a review signal.
  await page.evaluate(()=>{window.context.reason='시험';window.refreshProposals();});
  assert.equal(await memo.inputValue(),'(인정지각)시험_담임:홍길동(13:00)');
  await memo.fill('직접 검토한 사유');
  await page.evaluate(()=>{window.context.reason='병원';window.refreshProposals();});
  assert.equal(await memo.inputValue(),'직접 검토한 사유');
  assert(await page.locator('[data-proposal-send="0_가상학생__entryMemo"]').isDisabled());
  await page.locator('[data-proposal-reset="0_가상학생__entryMemo"]').click();
  await page.evaluate(()=>{window.context.status='출석';window.record.entryMemo='지각으로 잘못 남은 사유';window.refreshProposals();});
  assert.equal(await memo.inputValue(),'','normal attendance recommends an intentional empty memo');
  await page.locator('[data-proposal-send="0_가상학생__entryMemo"]').click();
  await page.getByRole('cell',{name:'공란(사유 없음)',exact:true}).waitFor();await close();
  // An approval winning the race prevents withdrawal without deleting either request.
  await page.evaluate(()=>{Object.values(window.docs).find(v=>v.name==='다른학생'&&v.status==='pending').status='approved';});
  await page.locator('[data-proposal-withdraw="1_다른학생__entryMemo"]').click();
  await page.waitForFunction(()=>window.problem?.includes('취소할 수 없습니다'));
  assert.equal(await page.evaluate(()=>Object.values(window.docs).find(v=>v.name==='다른학생'&&v.changes)?.status),'approved');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
