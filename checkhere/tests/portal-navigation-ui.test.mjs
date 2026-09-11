import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('CheckHere collection and approval panels remain mutually exclusive across shadow roots',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..');
 try{
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   const modules={
    '/checkhere-ui.mjs':`export async function mountCheckHere(host,ctx){host.attachShadow({mode:'open'}).innerHTML='<style>:host{display:block}</style><h2>수집 화면</h2>';ctx.onController({});return()=>{};}`,
    '/checkhere-requests.mjs':`export async function createRequest(){}export async function mountCheckHereRequests(host,ctx){host.attachShadow({mode:'open'}).innerHTML='<style>:host{display:block}</style><h2>승인 화면</h2>';ctx.onCount(3);return{refresh(){},dispose(){}};}`,
    '/checkhere/direct-edit.mjs':`export async function canEditCheckHere(){return false;}export function createDirectEditor(){return()=>{};}`,
    '/checkhere-snapshots.mjs':`export async function loadCheckHereDay(){return[];}`,
    '/attendance-beta-core.mjs':`export function collectionDates(){return[];}`,
   };
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const collection=()=>{},doc=()=>{},getDoc=()=>{},getDocs=()=>{},setDoc=()=>{},query=()=>{},orderBy=()=>{},limit=()=>{},serverTimestamp=()=>{},runTransaction=()=>{};`});
   if(p==='/')return route.fulfill({contentType:'text/html',body:`<div id="host"></div><script type="module">import{mountCheckHerePortal}from'/checkhere-portal.mjs';await mountCheckHerePortal(document.querySelector('#host'),{db:{},user:{email:'staff@example.com'},classes:[{id:'2'}],showRequests:true});</script>`});
   if(modules[p])return route.fulfill({contentType:'text/javascript',body:modules[p]});
   if(p==='/checkhere-portal.mjs')return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,p.slice(1)),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('heading',{name:'수집 화면'}).waitFor();assert.equal(await page.getByRole('heading',{name:'승인 화면'}).isVisible(),false);
  await page.getByRole('button',{name:'반영 요청·승인 (3)'}).click();assert.equal(await page.getByRole('heading',{name:'수집 화면'}).isVisible(),false);assert.equal(await page.getByRole('heading',{name:'승인 화면'}).isVisible(),true);
  await page.getByRole('button',{name:'수집·검수'}).click();assert.equal(await page.getByRole('heading',{name:'수집 화면'}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'승인 화면'}).isVisible(),false);
 }finally{await browser.close();}
});
