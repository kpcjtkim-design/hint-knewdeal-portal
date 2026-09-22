import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

test('direct editor previews only corresponding defaults, preserves real times and sends no unchanged blank fields',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),base=join(import.meta.dirname,'../..');
 try{for(const scenario of [
  {id:'entry-blank',patch:{entry:null,exit:null},memo:'entryMemo',value:'입실 사유',automatic:'입실·교시 · 누락 시간 자동 입력',expectedTime:'09:00:00',missing:'exit'},
  {id:'exit-blank',patch:{exit:null},memo:'exitMemo',value:'퇴실 사유',automatic:'퇴실 · 누락 시간 자동 입력',expectedTime:'18:00:00'},
  {id:'real-times',patch:{},memo:'entryMemo',value:'입실 사유'},
  {id:'clear-memo',patch:{entry:null,exit:null,entryMemo:'삭제할 사유'},memo:'entryMemo',value:'',automatic:'입실·교시 · 누락 시간 자동 입력',expectedTime:'09:00:00',missing:'exit'},
  {id:'clear-time',patch:{},memo:'entryMemo',value:'입실 사유',clearTime:true,error:'시간 확인'},
  {id:'unchanged-blank',patch:{entry:null,exit:null},memo:'entryMemo',value:'',error:'변경 없음'},
  {id:'old-collector',patch:{entry:null,exit:null},memo:'entryMemo',value:'입실 사유',old:true,error:'수집 프로그램 업데이트 필요'}
 ]){
  const page=await browser.newPage(),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  const record={id:'fixture-record',version:'fixture-version',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:05:00',exit:'17:55:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,...scenario.patch};
  const state={records:[record],jobs:[],connected:true,capabilities:['approval-current-sync-v1',...(!scenario.old?['memo-default-time-v1']:[])]};
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='127.0.0.1'){
    const headers={'access-control-allow-origin':'https://fixture.test','access-control-allow-headers':'x-hint-key,content-type','access-control-allow-private-network':'true'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(u.pathname==='/api/apply'){calls.push(route.request().postDataJSON());return route.fulfill({headers,json:{status:'running'}});}
    return route.fulfill({headers,json:state});
   }
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<div id="host"></div><script type="module">
    import {mountCheckHere} from '/checkhere-ui.mjs';import {createDirectEditor} from '/checkhere/direct-edit.mjs';
    window.rows={};let controller;
    const user={email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'};
    const store={get:async id=>rows[id],create:async(id,value)=>rows[id]={...value,status:'pending',createdBy:user.email},approve:async(id,approval)=>Object.assign(rows[id],{status:'approved',approval,approvedBy:user.email})};
    const applyChange=createDirectEditor({user,controller:()=>controller,store});
    await mountCheckHere(document.querySelector('#host'),{canEdit:true,applyChange,onController:c=>controller=c});
   </script>`});
   const path=join(base,u.pathname.slice(1));if(/\.(mjs|css)$/.test(path)&&existsSync(path))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(path,'utf8')});return route.abort();
  });
  try{
   await page.goto('https://fixture.test/');await page.getByRole('textbox',{name:'로컬 연결 키'}).fill('fixture');await page.getByRole('button',{name:'연결',exact:true}).click();
   await page.getByRole('button',{name:'검토·수정',exact:true}).click();await page.locator(scenario.memo==='entryMemo'?'#newEntryMemo':'#newExitMemo').fill(scenario.value);
   if(scenario.clearTime)await page.locator('#newEntry').fill('');
   await page.locator('#changeReason').fill('시험 요청 검토');await page.getByRole('button',{name:'변경 전후 확인',exact:true}).click();
   if(scenario.error){await page.getByRole('heading',{name:scenario.error,exact:true}).waitFor();assert.equal(calls.length,0);assert.deepEqual(await page.evaluate(()=>Object.keys(rows)),[]);}
   else{
    const preview=await page.locator('#preview').innerText();
    if(scenario.automatic){assert(preview.includes(scenario.automatic),scenario.id);assert(preview.includes(scenario.expectedTime));if(scenario.missing)assert(!preview.includes('퇴실 · 누락 시간 자동 입력'));}
    else assert(!preview.includes('누락 시간 자동 입력'));
    await page.getByRole('button',{name:'체크히어에 반영',exact:true}).click();await page.getByRole('heading',{name:'반영 진행 중',exact:true}).waitFor();
    const saved=await page.evaluate(()=>Object.values(rows));assert.equal(saved.length,1);assert.deepEqual(saved[0].changes,{[scenario.memo]:scenario.value});assert.equal(calls.length,1);
    if(scenario.missing)assert(!Object.hasOwn(saved[0].approval.after,scenario.missing));
    if(scenario.id==='exit-blank'||scenario.id==='real-times')assert.equal(saved[0].approval.after.entry,'09:05:00');
   }
   assert.deepEqual(errors,[],scenario.id);
  }finally{await page.close();}
 }}finally{await browser.close();}
});
