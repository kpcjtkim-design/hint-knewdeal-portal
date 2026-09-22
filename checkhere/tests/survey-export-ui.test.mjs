import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

test('admin downloads fresh raw without Firebase writes; partial failure requires explicit download; teacher cannot export',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1400,height:1000}}),base=join(import.meta.dirname,'../..');
 let value=10,fail=false,googleReads=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const catalog={events:[{id:'event',classId:'1',title:'SW 테스팅',date:'2026-09-03'}],responseSources:[{id:'source',title:'임베디드AI-HW(SW 테스팅)',sheetUrl:'https://docs.google.com/spreadsheets/d/raw-fixture/edit#gid=3'}]};
 try{
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:`export class GoogleAuthProvider{addScope(scope){if(scope!=='https://www.googleapis.com/auth/spreadsheets.readonly')throw Error('unexpected scope');}setCustomParameters(){}static credentialFromResult(){return{accessToken:'fixture'}}}export async function reauthenticateWithPopup(){return{}}`});
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.writes=0;window.reads=[];export const doc=(db,...p)=>({path:p.join('/')}),collection=doc,query=(ref)=>ref,where=()=>{},documentId=()=>{},onSnapshot=()=>()=>{};export async function getDoc(r){window.reads.push(r.path);const value=r.path==='timetableBetaPublished/1'?{entries:[{id:'a',lectureId:'sw',module:'직무특화',title:'SW 테스팅',date:'2026-09-03',day:1}]}:undefined;return{exists:()=>!!value,data:()=>value};}export async function getDocs(r){window.reads.push(r.path);return{docs:[]};}export const getDocFromServer=getDoc,getDocsFromServer=getDocs;export const serverTimestamp=()=>0;export function setDoc(){window.writes++;throw Error('unexpected Firestore write');}export const runTransaction=setDoc;`});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<main id="host"></main><script type="module">import{mountSurveys}from'/survey-view.mjs';window.downloads=[];window.XLSX={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(book,sheet,name)=>book.sheets.push({name,sheet})},writeFile:(book,name)=>window.downloads.push({book,name})};window.mount=async teacher=>{window.work?.dispose();window.work=await mountSurveys(document.querySelector('#host'),{db:{},user:{email:'fixture@example.test'},classes:[{id:'1',course:'임베디드 AI(HW)'}],teacherClass:teacher?{id:'1'}:null});};await window.mount(false);</script>`});
   if(u.pathname==='/survey-catalog.json')return route.fulfill({json:catalog});
   if(u.hostname==='sheets.googleapis.com'){
    googleReads++;assert.equal(req.method(),'GET');assert(!req.postData());
    if(fail)return route.fulfill({status:403,json:{error:{message:'응답 시트 권한 없음'}}});
    if(u.pathname.includes('/values/'))return route.fulfill({json:{values:[['타임스탬프','성명','분반','이메일','전반만족도','추천 의향','좋았던 점'],['2026-09-16','가','1반','a@example.test',5,value,'=원본 문장']]}});
    return route.fulfill({json:{sheets:[{properties:{sheetId:3,title:'설문지 응답 시트1',gridProperties:{rowCount:2,columnCount:7}}}]}});
   }
   if(u.hostname==='fixture.test'&&/^\/[\w.-]+\.(?:mjs|css)$/.test(u.pathname))return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(base,u.pathname.slice(1)),'utf8')});
   if(u.pathname==='/checkhere/rules.mjs')return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,'checkhere/rules.mjs'),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('button',{name:'내 계정 응답 시트 연결'}).click();await page.getByText('응답 시트 연결 완료.',{exact:false}).waitFor();assert.equal(googleReads,0);assert.equal(await page.evaluate(()=>window.writes),0);
  const run=async()=>{await page.getByRole('button',{name:'만족도 RAW 다운로드',exact:true}).click();await page.getByRole('dialog').waitFor({state:'visible'});assert.equal(await page.getByRole('button',{name:'엑셀 다운로드',exact:true}).count(),0);await page.screenshot({path:join(base,'checkhere/test-results/survey-raw-export.png')});await page.getByRole('button',{name:'RAW 다운로드',exact:true}).click();};
  await run();await page.waitForFunction(()=>window.downloads.length===1);let file=await page.evaluate(()=>window.downloads[0]);const answer=file.book.sheets[0].sheet.rows.find(r=>r[1]==='가');assert.deepEqual(answer,['2026-09-16','가','1반',5,10,'=원본 문장']);assert(!JSON.stringify(file.book).includes('@'));assert.equal(await page.locator('#surveyStackExport').count(),0);assert(!file.name.includes('부분자료'));assert.equal(await page.evaluate(()=>window.writes),0);
  await page.getByRole('button',{name:'닫기',exact:true}).click();value=7;await run();await page.waitForFunction(()=>window.downloads.length===2);file=await page.evaluate(()=>window.downloads[1]);assert.equal(file.book.sheets[0].sheet.rows.find(r=>r[1]==='가')[4],7);assert.equal(googleReads,4);
  await page.getByRole('button',{name:'닫기',exact:true}).click();fail=true;await run();await page.getByRole('button',{name:'수집 자료 다운로드',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.downloads.length),2);await page.getByRole('button',{name:'수집 자료 다운로드',exact:true}).click();await page.waitForFunction(()=>window.downloads.length===3);assert.match((await page.evaluate(()=>window.downloads[2])).name,/_부분자료/);assert.equal(await page.evaluate(()=>window.writes),0);
  await page.getByRole('button',{name:'닫기',exact:true}).click();await page.evaluate(()=>window.mount(true));await page.getByRole('heading',{name:'우리 반 만족도조사'}).waitFor();assert.equal(await page.getByRole('button',{name:'만족도 RAW 다운로드',exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
