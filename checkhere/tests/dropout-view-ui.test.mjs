import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('sync writes verdicts to blank or portal-written H cells and flags staff entries that disagree',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1500,height:900}}),errors=[];
 const DROP='1ZU6IxnP3CqFQGB1UxC3XB9mhrC40ZArG-0cQGdLqljI',OPS='1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34';
 const days=['7/27','7/28','8/3','8/18','8/19','8/20','8/21','8/28','8/31','9/1','9/2','9/29','9/30'],att=[['','출석률','출석일수','지조외',...days],['가','','','',...days.map(d=>['8/19','8/20'].includes(d)?'결석':'출석')],['나','','','',...days.map(()=>'출석')],['다','','','',...days.map(()=>'출석')]];
 const head=['순번','순번','연락처','반배정','포기사유','근로개시일','포기일(마지막수강일)','결석일수\n(수료가능여부)\n※확인중','문의일정','연락방법','수험번호','유선확인','서류1. 포기사유서','서류2. 채용통보 발표문','서류3. 채용인정서류','비고','반 정보'];
 const faq=[head,['1','가','','','기업 합격(가)','9/1 출근','8/31까지 출석',''],['2','나','','','기업 합격(나)','9/1 출근','8/31까지 출석','제적'],['3','다','','','개인사정 포기','-','8/31까지 출석','결석0회(1차) = 수료가능 · 포털자동(9/29)']].map(r=>{const x=[...r];while(x.length<17)x.push('');x[16]='1반';return x;});faq[0][16]='반 정보';
 const posts=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 try{
  await page.addInitScript(()=>{const offset=Date.parse('2026-09-30T10:00:00+09:00')-Date.now(),Real=Date;globalThis.Date=class extends Real{constructor(...a){super(...(a.length?a:[Real.now()+offset]));}static now(){return Real.now()+offset;}};});
  await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),name=u.pathname.slice(1),path=decodeURIComponent(u.pathname+u.search);
   if(u.hostname==='www.gstatic.com'&&name.endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:`export class GoogleAuthProvider{addScope(){}setCustomParameters(){}static credentialFromResult(){return {accessToken:'token'};}}export async function reauthenticateWithPopup(){return {};}`});
   if(u.hostname==='sheets.googleapis.com'){
    if(path.includes(OPS+'?fields'))return route.fulfill({json:{sheets:Array.from({length:17},(_,i)=>({properties:{title:`${i+1}. 반${i+1}`}}))}});
    if(path.includes(OPS+'/values:batchGet'))return route.fulfill({json:{valueRanges:Array.from({length:17},()=>({values:att}))}});
    if(req.method()==='POST'&&path.includes(DROP+'/values:batchUpdate')){const body=JSON.parse(req.postData());posts.push(body);for(const d of body.data){const row=+d.range.match(/H(\d+)$/)[1];faq[row-1][7]=d.values[0][0];}return route.fulfill({json:{}});}
    if(path.includes(DROP+'/values:batchGet'))return route.fulfill({json:{valueRanges:path.split('ranges=').slice(1).map(r=>{const row=+r.match(/H(\d+)/)[1];return {values:[[faq[row-1][7]]]};})}});
    if(path.includes(DROP+'/values/'))return route.fulfill({json:{values:faq}});
    return route.fulfill({status:404,json:{}});
   }
   if(!name)return route.fulfill({contentType:'text/html;charset=utf-8',body:`<div id="host"></div><script type="module">import{mountDropoutStatus}from'/dropout-view.mjs';window.view=await mountDropoutStatus(document.querySelector('#host'),{user:{email:'admin@example.test'}});</script>`});
   if(u.hostname==='fixture.test'&&/^[\w.-]+\.(?:mjs|css)$/.test(name)&&existsSync(join(base,name)))return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,name),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('button',{name:'동기화 · 판정'}).click();
  await page.getByText(/시트 H열 자동 기록 2건/).waitFor();
  assert.equal(posts.length,1,'one batch write');assert.deepEqual(posts[0].data.map(d=>d.range.split('!')[1]),['H2','H4']);assert.equal(posts[0].valueInputOption,'RAW');
  assert.equal(faq[1][7],'결석2회(1차), 결석0회(근로전) = 수료가능 · 포털자동(9/30)');assert.equal(faq[3][7],'제적 · 포털자동(9/30)');assert.equal(faq[2][7],'제적','staff entry untouched');
  await page.getByText(/담당자 입력과 판정이 다른 1명/).first().waitFor();await page.getByText('포털 판정과 다름: 결석0회(1차), 결석0회(근로전) = 수료가능').waitFor();
  // A second sync with nothing changed writes nothing.
  await page.getByRole('button',{name:'동기화 · 판정'}).click();await page.getByText(/바뀐 판정 없음/).waitFor();assert.equal(posts.length,1);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
