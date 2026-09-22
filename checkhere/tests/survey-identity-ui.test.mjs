import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('identity editor saves only duplicate suffixes into existing class settings and rejects full phone numbers',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..');
 try{
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<dialog id="editor"></dialog><script type="module">import{createSurveyStore}from'/survey-store.mjs';import{editSurveyIdentities}from'/survey-identity-editor.mjs';const user={email:'admin@example.test',getIdToken:async()=>'fixture'};window.store=createSurveyStore({},user,{canManage:true});await editSurveyIdentities(document.querySelector('dialog'),{classId:'12',store,user});</script>`});
  if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.saved={course:'unchanged',coreLinks:{photos:'unchanged'}};export const collection=(db,...p)=>p.join('/'),doc=collection,serverTimestamp=()=>0;export async function getDoc(){return{data:()=>structuredClone(window.saved)}}export async function getDocs(){return{docs:[]}}export async function setDoc(){}export async function runTransaction(db,fn){return fn({get:getDoc,update:(ref,value)=>{window.lastWrite=value;Object.assign(window.saved,value)}})}`});
  if(u.pathname==='/api/attendance-reader')return route.fulfill({json:{attendance:[['성명'],['동명(98년생)'],['동명(01년생)'],['단독']]}});
  const name=u.pathname.slice(1);if(u.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(name)&&!name.split('/').includes('..')&&existsSync(join(base,name)))return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,name),'utf8')});return route.abort();
 });
 await page.goto('https://fixture.test/');await page.getByRole('heading',{name:'12반 · 동명이인 연결'}).waitFor();assert.equal(await page.getByRole('textbox').count(),2);
 await page.getByLabel('동명(98년생) 전화번호 끝 4자리').fill('0012');await page.getByLabel('동명(01년생) 전화번호 끝 4자리').fill('0034');await page.getByRole('button',{name:'연결 저장'}).click();await page.getByText(/2명 연결 저장 완료/).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.saved),{course:'unchanged',coreLinks:{photos:'unchanged'},surveyDuplicateIdentities:[{name:'동명(98년생)',phoneLast4:'0012'},{name:'동명(01년생)',phoneLast4:'0034'}]});
 const rejected=await page.evaluate(async()=>{try{await window.store.saveIdentities('12',[{name:'동명(98년생)',phoneLast4:'01012340012'}],[{name:'동명(98년생)'},{name:'동명(01년생)'}]);return false;}catch{return true;}});assert(rejected);
 }finally{await browser.close();}
});
