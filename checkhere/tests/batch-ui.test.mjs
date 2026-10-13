import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

const base=join(import.meta.dirname,'../..');
const row=(classId,date,name)=>({id:`${classId}-${date}-${name}`,version:'v1',rowIndex:2,classId,date,name,phoneLast4:'0000',readState:'complete',source:'live',entry:'09:00:00',rawEntry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],outingCount:0,schedule:'09:00 ~ 18:00',collectedAt:'2026-09-01T01:00:00Z'});
test('several classes and a period run as one bridge job; each finished day is saved once and the summary lists what needs attention',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true}),page=await browser.newPage();
  const posted=[],saves=[];let phase='idle';
  const job=(status,results,extra={})=>({id:'batch-1',kind:'batch',mode:'full',classIds:['3','5'],dates:['2026-09-01','2026-09-02'],status,total:4,done:results.length,count:3,skipped:0,results,message:'4/4 반·날짜 · 상세 수집 3명 · 강의 없음 1 · 확인 필요 1',...extra});
  const fin=(classId,date,status,message)=>({classId,date,status,message,finishedAt:`2026-10-13T00:0${posted.length}:0${classId}Z`});
  const state=()=>{
    const common={connected:true,capabilities:['batch-sync-v1','state-delta-v1'],recordsMode:'replace',cursor:'c:'+phase};
    if(phase==='idle')return {...common,busy:null,jobs:[],records:[row('2','2026-09-03','둘반')]};
    if(phase==='running')return {...common,busy:'batch-1',jobs:[job('running',[fin('3','2026-09-01','complete')],{progress:{classId:'3',date:'2026-09-02',index:1,total:2,name:'x'}})],records:[row('2','2026-09-03','둘반'),row('3','2026-09-01','삼반a'),row('3','2026-09-01','삼반b')]};
    return {...common,busy:null,jobs:[job('partial',[fin('3','2026-09-01','complete'),fin('3','2026-09-02','no-lecture','체크히어 강의 목록에 없는 날짜'),fin('5','2026-09-01','complete'),fin('5','2026-09-02','failed','반·날짜 확인에 실패했습니다.')])],records:[row('2','2026-09-03','둘반'),row('3','2026-09-01','삼반a'),row('3','2026-09-01','삼반b'),row('5','2026-09-01','오반')]};
  };
  try{
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='127.0.0.1'){
        const headers={'access-control-allow-origin':'https://fixture.test','access-control-allow-headers':'x-hint-key,content-type','access-control-allow-private-network':'true'};
        if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
        if(u.pathname==='/api/sync-batch'){posted.push(JSON.parse(route.request().postData()));phase='running';return route.fulfill({status:202,headers,json:job('running',[])});}
        return route.fulfill({headers,json:state()});
      }
      if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><div id="host"></div><script type="module">import{mountCheckHere}from'/checkhere-ui.mjs';window.saves=[];await mountCheckHere(document.querySelector('#host'),{load:async()=>[],save:async(records,job)=>{window.saves.push({job:job.id,days:[...new Set(records.map(r=>r.classId+'|'+r.date))],n:records.length});return {verified:true,recordCount:records.length,partialCount:0};},onController:c=>window.controller=c});</script>`});
      if(['/checkhere-ui.mjs','/checkhere/bulk-collect.mjs','/attendance-beta-core.mjs','/checkhere-name-core.mjs','/survey-identity.mjs','/checkhere/rules.mjs','/checkhere/ui.css'].includes(u.pathname))return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,u.pathname.slice(1)),'utf8')});
      return route.abort();
    });
    await page.goto('https://fixture.test/');await page.getByRole('textbox',{name:'로컬 연결 키'}).fill('k');await page.getByRole('button',{name:'연결',exact:true}).click();
    await page.getByText('둘반',{exact:true}).waitFor();
    await page.selectOption('#host >> #class','multi');
    await page.locator('#host').getByRole('checkbox',{name:'2반',exact:true}).uncheck();
    await page.locator('#host').getByRole('checkbox',{name:'3반',exact:true}).check();await page.locator('#host').getByRole('checkbox',{name:'5반',exact:true}).check();
    await page.getByText('2개 반 선택').waitFor();
    assert.equal(await page.getByText('둘반',{exact:true}).count(),0,'the table follows the picked classes');
    await page.selectOption('#host >> #mode','full');
    await page.fill('#host >> #from','2026-08-31');await page.fill('#host >> #to','2026-09-06');
    await page.getByRole('button',{name:'체크히어에서 수집'}).click();
    await page.getByText(/2개 반 · 5일/).waitFor();
    assert.deepEqual(posted,[{classIds:['3','5'],dates:['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'],mode:'full'}]);
    await page.getByText(/1\/4 반·날짜 완료/).waitFor();
    assert(await page.locator('#host').getByRole('checkbox',{name:'3반',exact:true}).isDisabled(),'selection is locked while the job runs');
    await page.waitForFunction(()=>window.saves.length===1);
    assert.deepEqual(await page.evaluate(()=>window.saves),[{job:'batch-1',days:['3|2026-09-01'],n:2}]);
    phase='done';await page.evaluate(()=>window.controller.refresh());
    await page.getByText('확인 필요 1건').waitFor();await page.getByText('강의 없는 날 1건').waitFor();
    await page.getByText(/5반 · 2026-09-02 · 반·날짜 확인에 실패했습니다/).waitFor();
    await page.waitForFunction(()=>window.saves.length===2);
    assert.deepEqual((await page.evaluate(()=>window.saves))[1],{job:'batch-1',days:['5|2026-09-01'],n:1},'only days that finished collecting are saved, each once');
    await page.evaluate(()=>window.controller.refresh());await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.saves.length),2,'no re-save on later refreshes');
  }finally{await browser.close();}
});
