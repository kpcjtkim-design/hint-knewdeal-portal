import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

// Synthetic browser fixture: real summary store/views, no Firebase or production access.
async function fixture(run){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>{
   const u=new URL(route.request().url()),path=u.pathname.slice(1);
   if(path.endsWith('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:`
    export const doc=(db,...parts)=>parts.join('/'),collection=doc,where=(...v)=>v,documentId=()=>'',query=(...v)=>v,serverTimestamp=()=>null;
    export async function getDoc(path){window.fixture.reads.push(path);if(window.fixture.block===path)await new Promise(r=>window.fixture.release=r);const value=structuredClone(window.fixture.docs[path]);return {data:()=>value,exists:()=>value!==undefined};}
    export async function getDocs(){return {docs:[]};}
    export async function setDoc(path,value){window.fixture.writes.push(path);window.fixture.docs[path]=structuredClone(value);}
   `});
   if(path==='checkhere-snapshots.mjs')return route.fulfill({contentType:'text/javascript',body:'export async function loadLegacyCheckHereDay(){return [];}'});
   if(path==='checkhere-name-store.mjs')return route.fulfill({contentType:'text/javascript',body:'export async function loadCheckHereIdentities(){return [];}'});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`
    <div id="home"></div><div id="stats"></div><div id="evidence"></div>
    <script type="module">
     import {mountAttendanceStatistics} from '/attendance-statistics.mjs';
     import {mountAttendanceEvidence} from '/attendance-evidence.mjs';
     import {readAttendanceSummary,syncAttendanceSummary} from '/attendance-derived-store.mjs';
     const summary=cid=>({classId:cid,latestDate:'2026-09-14',dates:['2026-09-14'],students:[{id:'0_가상',name:'가상',firstDate:'2026-09-14',history:{'2026-09-14':{raw:'인정출석',status:'인정지각',basis:'관리자 구분',evidenceStatus:'미제출'}}}]});
     window.fixture={reads:[],writes:[],docs:{'attendanceBetaSummaries/1':summary('1'),'attendanceBetaSummaries/2':summary('2'),'attendanceBetaSummaries/3':summary('3'),'timetableBetaPublished/1':{entries:[]}}};
     window.api={mountAttendanceStatistics,mountAttendanceEvidence,readAttendanceSummary,syncAttendanceSummary};
     window.options={db:{},user:{uid:'fixture-admin',email:'admin@example.test'},classes:[{id:'1'},{id:'2'},{id:'3'}]};
     window.ready=true;
    </script>`});
   if(/\.(mjs|css)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:path.endsWith('css')?'text/css':'text/javascript',body:readFileSync(join(base,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://attendance-fixture.test/');await page.waitForFunction(()=>window.ready);await run(page);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const summaryReads=page=>page.evaluate(()=>fixture.reads.filter(p=>p.startsWith('attendanceBetaSummaries/')));

test('teacher home, statistics and evidence share a summary; filters stay local and explicit refresh reads fresh',()=>fixture(async page=>{
 await page.evaluate(async()=>{
  const opts={...options,teacherClass:options.classes[0]};
  await api.mountAttendanceStatistics(document.querySelector('#home'),{...opts,compact:true});
  await api.mountAttendanceStatistics(document.querySelector('#stats'),opts);
  await api.mountAttendanceEvidence(document.querySelector('#evidence'),opts);
 });
 assert.deepEqual(await summaryReads(page),['attendanceBetaSummaries/1']);
 await page.locator('#homeEvidencePeriod').selectOption('2');await page.locator('#evPeriod').selectOption('2');
 await page.locator('#statDates').click();await page.locator('#statStudents').click();
 assert.deepEqual(await summaryReads(page),['attendanceBetaSummaries/1']);
 await page.locator('#evRead').click();await page.locator('#evRead').waitFor({state:'visible'});
 await page.waitForFunction(()=>fixture.reads.filter(p=>p.startsWith('attendanceBetaSummaries/')).length===2);
 assert.equal(await page.locator('#evAll').count(),0);assert.equal(await page.locator('#statClass').count(),0);
 await page.locator('#statRead').click();await page.waitForFunction(()=>fixture.reads.filter(p=>p.startsWith('attendanceBetaSummaries/')).length===3);
 assert.deepEqual(await summaryReads(page),Array(3).fill('attendanceBetaSummaries/1'));
}));

test('discarded initial view and all-class views stop issuing later summary reads',()=>fixture(async page=>{
 await page.evaluate(()=>{fixture.block='attendanceBetaSummaries/1';window.initial=api.mountAttendanceStatistics(document.querySelector('#stats'),options);});
 await page.waitForFunction(()=>!!fixture.release);
 await page.evaluate(async()=>{document.querySelector('#stats').shadowRoot.innerHTML='<p>replacement view</p>';fixture.block='';fixture.release();await initial;});
 assert.equal(await page.locator('#stats p').innerText(),'replacement view');
 await page.evaluate(async()=>{window.evidence=await api.mountAttendanceEvidence(document.querySelector('#evidence'),options);});
 await page.locator('#evAll').click();
 await page.evaluate(()=>{fixture.block='attendanceBetaSummaries/1';fixture.release=null;});
 await page.locator('#evRead').click();await page.waitForFunction(()=>!!fixture.release);
 await page.evaluate(async()=>{evidence.dispose();document.querySelector('#evidence').remove();fixture.block='';fixture.release();});
 // Queue a task after the read continuation; no arbitrary network/timer wait is needed.
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 assert(!((await summaryReads(page)).some(p=>p.endsWith('/2')||p.endsWith('/3'))));
 await page.evaluate(async()=>{window.stats=await api.mountAttendanceStatistics(document.querySelector('#stats'),options);fixture.block='attendanceBetaSummaries/2';fixture.release=null;});
 await page.locator('#statClass').selectOption('all');await page.waitForFunction(()=>!!fixture.release);
 await page.evaluate(()=>{stats.dispose();document.querySelector('#stats').remove();fixture.block='';fixture.release();});
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 assert(!((await summaryReads(page)).some(p=>p.endsWith('/3'))));
}));

test('successful summary sync invalidates the shared read result and unchanged sync avoids a second write',()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  const {db,user}=options,sheet={attendance:[['이름','','','','9/14'],['가상','','','','출석']]};
  await api.readAttendanceSummary(db,'1',{user});
  const updated=await api.syncAttendanceSummary(db,user,'1',sheet);
  const after=await api.readAttendanceSummary(db,'1',{user});
  await api.syncAttendanceSummary(db,user,'1',sheet);
  return {status:after.students[0].history['2026-09-14'].status,sameFingerprint:updated.fingerprint===after.fingerprint,writes:fixture.writes,reads:fixture.reads.filter(p=>p.startsWith('attendanceBetaSummaries/'))};
 });
 assert.equal(result.status,'출석');assert.equal(result.sameFingerprint,true);assert.deepEqual(result.writes,['attendanceBetaSummaries/1']);assert.equal(result.reads.length,4);
}));
