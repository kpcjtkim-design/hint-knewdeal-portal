import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('review opens directly, staff only reads, designated administrator can apply',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),base=join(import.meta.dirname,'../..');
  try{for(const role of ['staff','editor']){
    const page=await browser.newPage({viewport:{width:1600,height:950}}),rows=new Map(),applied=[];
    const record={id:'record-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'퇴실 메모',outings:[]};
    const state={records:[record],jobs:[],connected:true,capabilities:['approved-requests-v1']};
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const collection=(...x)=>x,doc=(...x)=>({id:x.at(-1)}),query=(...x)=>x,where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,serverTimestamp=()=>({seconds:1});export async function setDoc(ref,data){window.rows[ref.id]=data;}export async function getDoc(ref){return{exists:()=>!!window.rows[ref.id],data:()=>window.rows[ref.id]};}export async function getDocs(){return{docs:[]};}export async function runTransaction(db,fn){return fn({get:getDoc,update(ref,data){Object.assign(window.rows[ref.id],data);}});}`});
      if(url.hostname==='127.0.0.1'){
        const headers={'access-control-allow-origin':'https://fixture.test','access-control-allow-headers':'x-hint-key,content-type','access-control-allow-private-network':'true'};
        if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
        if(url.pathname==='/api/apply'){const input=route.request().postDataJSON();applied.push(input);state.jobs=[{id:input.approvalId,kind:'apply',status:'verified',message:'시험 저장 확인',finishedAt:new Date().toISOString()}];return route.fulfill({headers,json:{ok:true}});}
        return route.fulfill({headers,json:state});
      }
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<main style="width:calc(100% - 48px);margin:auto"><div id="host"></div></main><script type="module">import{mountCheckHerePortal}from'/checkhere-portal.mjs';window.rows={};await mountCheckHerePortal(document.querySelector('#host'),{db:{},classes:[{id:'2'}],user:{email:'${role==='editor'?'hint.kpc@gmail.com':'staff@example.com'}',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'fixture-token'}});</script>`});
      const path=url.pathname.slice(1);if(['checkhere-portal.mjs','checkhere-ui.mjs','checkhere-requests.mjs','checkhere/approval-core.mjs','checkhere/direct-edit.mjs','checkhere/rules.mjs','checkhere/ui.css','checkhere-snapshots.mjs','attendance-beta-core.mjs','checkhere/bulk-collect.mjs'].includes(path))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});
      return route.abort();
    });
    await page.goto('https://fixture.test/');await page.getByRole('heading',{name:'체크히어 검수',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'체크히어 수정 요청 · 승인',exact:true}).count(),0);
    assert.equal(await page.getByText('수집 PC 연결 · 체크히어 기록 보기',{exact:true}).count(),0);
    await page.getByRole('textbox',{name:'로컬 연결 키'}).fill('fixture-key');await page.getByRole('button',{name:'연결',exact:true}).click();await page.getByText('가상학생',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'검토·수정',exact:true}).count(),role==='editor'?1:0);
    assert(await page.getByRole('button',{name:'체크히어에서 수집',exact:true}).isVisible());assert((await page.locator('#host').boundingBox()).width>1500);
    if(role==='editor'){
      await page.getByRole('button',{name:'검토·수정',exact:true}).click();await page.getByLabel('입실·교시 관리자 메모',{exact:true}).fill('정정 사유');await page.getByLabel('수정 근거',{exact:true}).fill('수기 확인');await page.getByRole('button',{name:'변경 전후 확인',exact:true}).click();
      assert.equal(applied.length,0);await page.getByRole('button',{name:'체크히어에 반영',exact:true}).click();await page.getByRole('heading',{name:'반영 확인 완료',exact:true}).waitFor();
      const saved=await page.evaluate(()=>Object.values(window.rows));assert.equal(saved.length,1);assert.equal(saved[0].approval.after.exitMemo,'퇴실 메모');assert.equal(saved[0].approval.after.entryMemo,'정정 사유');assert.equal(applied.length,1);assert.deepEqual(Object.keys(applied[0]).sort(),['approvalId','idToken']);
    }else assert.equal(applied.length,0);
    await page.close();
  }}finally{await browser.close();}
});
