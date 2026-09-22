import test from 'node:test';
import assert from 'node:assert/strict';
import {CheckHereCollector,loadPlaywright} from '../collector.mjs';
test('discovery navigation is reused once, but explicit readback reloads the day',async()=>{
 let current='https://check.ihereapp.com/history/lecture',navigations=0;
 const url='https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-09-14',control={nth(){return this;},getByRole(){return this;},waitFor:async()=>{},click:async()=>{},innerText:async()=> '[2반] 강의 (담임) | 2026-09-14 출석부'};
 const page={url:()=>current,goto:async value=>{current=value;navigations++;},getByRole:()=>control,getByText:()=>control};
 const collector=new CheckHereCollector('fixture',{page});collector.requireLogin=async()=>{};collector.discover=async()=>{current=url;return url;};collector.tableRecords=async()=>[];
 await collector.openDay('2','2026-09-14');assert.equal(navigations,0,'discovery already navigated to the verified day');
 await collector.openDay('2','2026-09-14',url);assert.equal(navigations,1,'verification must still reload');
 await collector.openDay('2','2026-09-14');assert.equal(navigations,2,'a fresh collection reloads a day already open');
});
test('read reuses roster from its fresh page load, without scanning it twice',async()=>{
 const url='https://check.ihereapp.com/history/lecture/modify?scheduleDate=2026-09-14',record={name:'가상',studentKey:'key',classId:'2',date:'2026-09-14',url},collector=new CheckHereCollector('fixture',{page:{url:()=>url}});let scans=0;
 collector.openDay=async()=>{scans++;collector.day={classId:record.classId,date:record.date,url};return [record];};collector.tableRecords=async()=>{throw Error('redundant full-table scan');};collector.readDetails=async r=>({...r,readState:'complete'});
 assert.equal((await collector.read(record)).readState,'complete');assert.equal(scans,1);
});
test('row identity fast path avoids full table rescans, handles reordered homonyms, and rejects duplicate identity',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 try{
  const students=Array.from({length:25},(_,i)=>({name:i<2?'동명이인':'가상'+i,phone:'0101234'+String(i).padStart(4,'0')}));
  await page.setContent(`<table><tr><td>명단</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td></tr>${students.map((s,i)=>`<tr><td></td><td>${i+1}</td><td>${s.name}</td><td>${s.phone}</td></tr>`).join('')}<tr><td>합계</td></tr></table><table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr>${students.map(()=>'<tr><td>09:00:00</td><td>09:00:00</td><td>18:00:00</td><td>0분 (-)</td><td>8시간</td></tr>').join('')}<tr><td>합계</td></tr></table>`);
  const collector=new CheckHereCollector('fixture',{page});collector.day={classId:'2',date:'2026-09-14'};const original=collector.tableRecords.bind(collector),records=await original();let fullScans=0;
  collector.tableRecords=async()=>{fullScans++;return original();};
  for(const r of records){assert.equal((await collector.locate(r)).rowIndex,r.rowIndex);assert.equal((await collector.locate(r)).studentKey,r.studentKey);}
  assert.equal(fullScans,0,'50 modal-target checks avoid 50 full parsed roster extractions');
  await page.locator('table').evaluateAll(tables=>{for(const t of tables){const first=t.rows[2],second=t.rows[3];first.parentNode.insertBefore(second,first);}});
  assert.equal((await collector.locate(records[0])).rowIndex,3);assert.equal(fullScans,1,'row movement falls back to safe identity scan');
  await page.locator('table').first().evaluate(t=>{t.rows[2].cells[3].textContent=t.rows[3].cells[3].textContent;});
  await assert.rejects(()=>collector.locate({...records[0],rowIndex:3}),/중복/);
  collector.day.date='2026-09-15';await assert.rejects(()=>collector.locate(records[0]),/반·날짜/);
 }finally{await browser.close();}
});
