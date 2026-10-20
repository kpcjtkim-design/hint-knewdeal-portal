import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright,CheckHereCollector,sameTableRow} from '../collector.mjs';
import {createBridge} from '../server.mjs';
import {version} from '../identity.mjs';

const row=(id,sig,extra={})=>({id,studentKey:'k'+id,name:'가상'+id,classId:'2',date:'2026-11-02',tableSignature:sig,source:'live',readState:'partial',...extra});
test('only a complete live read with the same visible row is reused',()=>{
  const old={...row('a','09:00|18:00'),readState:'complete'};
  assert.equal(sameTableRow(old,row('a','09:00|18:00')),true);
  assert.equal(sameTableRow(old,row('a','09:00|17:00')),false,'changed time');
  assert.equal(sameTableRow({...old,readState:'partial'},row('a','09:00|18:00')),false,'failed details are retried');
  assert.equal(sameTableRow({...old,source:'snapshot'},row('a','09:00|18:00')),false,'seed snapshots are re-read');
  assert.equal(sameTableRow({...old,tableSignature:undefined},row('a','09:00|18:00')),false,'records from older builds are re-read once');
  assert.equal(sameTableRow(old,row('a','')),false);assert.equal(sameTableRow(null,row('a','x')),false);
});
test('collector opens editors only for rows the predicate does not skip',async()=>{
  const c=new CheckHereCollector('fixture',{page:{}}),read=[];
  c.requireLogin=async()=>{};c.openDay=async()=>[row('a','1'),row('b','2'),row('c','3')];
  c.readDetails=async r=>{read.push(r.id);return {...r,readState:'complete'};};
  const out=[];await c.collect('2',['2026-11-02'],async r=>out.push(r.id),async()=>{},{unchanged:r=>r.id==='b'});
  assert.deepEqual(read,['a','c']);assert.deepEqual(out,['a','c']);
  read.length=0;await c.collect('2',['2026-11-02'],async()=>{},async()=>{});assert.deepEqual(read,['a','b','c'],'the default full collection is unchanged');
});
// 화면 데이터 항목(가상): 표의 입실·1교시·퇴실과 같은 시간
const entryOf=(r,exit=r.exit)=>({sequence:1,attendeeId:'att-'+r.id,name:r.name,phone:'',eventList:[{type:'ENTER',time:'2026-11-02T'+r.rawEntry,eventId:'e',timeIndex:0},{type:'PASS',time:'2026-11-02T'+r.entry,eventId:null,timeIndex:0},{type:'COMPLETE',time:'2026-11-02T'+exit,eventId:'c',timeIndex:0}],leaveEvents:{pairs:[]}});
test('bridge incremental sync reads from page data without editors, skips unchanged students and adds no snapshot rows for them; precise sync opens editors',async()=>{
  const timed=(id,sig,exit)=>row(id,sig,{rawEntry:'09:00:00',entry:'09:00:00',exit,outingCount:0});
  let table=[timed('a','09:00|18:00','18:00:00'),timed('b','09:05|18:00','18:00:00')];const opened=[];
  const adapter=new CheckHereCollector('fixture',{page:{},dayGapMs:[0,0]});
  // 빠른 수집은 그날 화면 데이터만 씁니다(2026-10-16): 순번으로 맞춘 항목을 흉내 냅니다.
  adapter.loggedIn=async()=>true;adapter.requireLogin=async()=>{};adapter.openDay=async()=>{const rows=structuredClone(table);adapter.dayData={data:{eventResultList:rows.map(r=>entryOf(r))}};adapter.planOptions=()=>({entryFor:r=>entryOf(r)});return rows;};
  adapter.readDetails=async r=>{opened.push(r.id);const d={...r,entryMemo:'',exitMemo:'',readState:'complete',collectedAt:new Date().toISOString()};d.version=version(d);return d;};
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const app=createBridge({dataDir:mkdtempSync(join(import.meta.dirname,'../test-results/incremental-')),collector:adapter,port:18781});
  await new Promise(r=>app.server.listen(18781,'127.0.0.1',r));
  const api=async(path,body)=>(await fetch('http://127.0.0.1:18781/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-hint-key':app.key,connection:'close'},body:body&&JSON.stringify(body)})).json();
  const sync=async mode=>{const j=await api('sync',{classId:'2',dates:['2026-11-02'],mode});for(let i=0;i<200;i++){const s=await api('state?delta=1');const job=s.jobs.find(x=>x.id===j.id);if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,5));}throw Error('timeout');};
  const rows=()=>app.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n;
  try{
    let job=await sync('incremental');assert.equal(job.count,2);assert.equal(job.skipped,0);assert.equal(rows(),2);assert.deepEqual(opened,[],'no editor in a fast read');
    opened.length=0;job=await sync('incremental');
    assert.equal(job.status,'complete');assert.equal(job.count,0);assert.equal(job.skipped,2);assert.deepEqual(opened,[]);assert.equal(rows(),2,'no new snapshot rows');
    assert.match(job.message,/변경 없음 2건/);
    table[1].tableSignature='09:05|17:10';table[1].exit='17:10:00';opened.length=0;job=await sync('incremental');
    assert.deepEqual(opened,[]);assert.equal(job.count,1);assert.equal(job.skipped,1);assert.equal(rows(),3);
    opened.length=0;job=await sync();assert.deepEqual(opened,['a','b'],'the precise (emergency) sync still opens every editor');assert.equal(job.mode,undefined);
    const session=await (await fetch('http://127.0.0.1:18781/api/session',{headers:{connection:'close'}})).json();
    assert(session.build>='20261012.1');assert(session.capabilities.includes('incremental-sync-v1'));
  }finally{app.close();}
});
test('table rows carry a visible-row signature that ignores the live participation total',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true}),page=await browser.newPage();
  const html=total=>`<table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td></tr><tr><td></td><td>1</td><td>가상학생</td><td>01000000001</td></tr><tr><td>합계</td></tr></table><table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr><tr><td>08:55:01</td><td>09:00:00</td><td>-</td><td>0분 (-)</td><td>${total}</td></tr><tr><td>합계</td></tr></table>`;
  try{
    const c=new CheckHereCollector('',{page});c.day={classId:'2',date:'2026-11-02'};
    await page.setContent(html('3시간'));const [a]=await c.tableRecords();
    await page.setContent(html('4시간'));const [b]=await c.tableRecords();
    assert.equal(a.tableSignature,'09:00 ~ 18:00|08:55:01|09:00:00|-|0분 (-)');assert.equal(a.tableSignature,b.tableSignature);
    assert.equal(sameTableRow({...a,readState:'complete'},b),true);
  }finally{await browser.close();}
});
