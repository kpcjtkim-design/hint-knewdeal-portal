import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurveyReader,createSurveyRequestGate} from '../../survey-google.mjs';

const url='https://docs.google.com/spreadsheets/d/fixture/edit?gid=7';
const headers=['성명','소속반','타임스탬프','휴대전화','전반 만족도','추천 의향'];
const meta={sheets:[{properties:{sheetId:7,title:'설문지 응답',gridProperties:{rowCount:20000,columnCount:6}}}]};
function fixture(t){
 let now=0;const calls=[],gate=createSurveyRequestGate({now:()=>now,sleep:async ms=>{now+=ms;}});
 // A long empty middle gap must not cause early termination or change row numbers.
 const values=Array.from({length:15001},()=>[]);values[0]=headers;
 values[1]=['가','1반','2026-09-01','010-0000-1234',5,0];
 values[15000]=['가','1반','2026-09-01','010-0000-1234',5,0];
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(input);calls.push(u);
  if(u.pathname.includes('/values:batchGet')){
   const ranges=u.searchParams.getAll('ranges');assert.equal(ranges.length,6);
   assert(ranges.every(r=>/^'설문지 응답'![A-F]2:[A-F]20000$/.test(r)));
   return Response.json({valueRanges:ranges.map((range,i)=>({range,values:[values.slice(1).map(row=>row[i]??'')]}))});
  }
  if(u.pathname.includes('/values/'))return Response.json({values:decodeURIComponent(u.pathname).endsWith('!A1:F1')?[headers]:values});
  return Response.json(meta);
 });
 const reader=createSurveyReader(async()=>'fixture',{requestGate:gate});return {reader,calls};
}

test('20,000 allocated rows need three statistics requests and retain responses after empty gaps',async t=>{
 const {reader,calls}=fixture(t);await reader.connect();const data=await reader.responses(url);
 assert.equal(calls.length,3,'was metadata + header + 20 row chunks = 22 requests');
 assert.equal(data.length,2);assert.equal(data[1].name,'가');assert.equal(data[0].scores[1].value,'0');
 assert.equal(data[0].phoneLast4,'1234');assert(!JSON.stringify(data).includes('010-0000'));
 reader.clear();
});

test('20,000 allocated RAW rows need two requests, preserve duplicates/gaps/zero, and refetch each export',async t=>{
 const {reader,calls}=fixture(t);await reader.connect();const first=await reader.raw(url),second=await reader.raw(url);
 assert.equal(calls.length,4,'was 41 requests for each export');
 assert.deepEqual(first.headers,headers);assert.deepEqual(first.rows.map(r=>r.rowNumber),[2,15001]);
 assert.equal(first.rows[0].values[5],0);assert.deepEqual(first.rows,second.rows);
 assert.equal(first.rows.length,2,'duplicate submissions are retained');reader.clear();
});

test('concurrent statistics reads coalesce; explicit operation reuses expired cache and next run starts fresh',async t=>{
 const {reader,calls}=fixture(t);await reader.connect();let clock=0;t.mock.method(Date,'now',()=>clock);
 const release=reader.beginResponseRun();const [a,b]=await Promise.all([reader.responses(url),reader.responses(url)]);
 assert.equal(calls.length,3);assert.deepEqual(a,b);clock=300000;
 assert.equal((await reader.responses(url)).length,2);assert.equal(calls.length,3,'reuse a common survey for later classes in the same operation');
 release();release();const end=reader.beginResponseRun();await reader.responses(url);assert.equal(calls.length,6);end();reader.clear();
});

test('oversized RAW sheets still fail rather than truncate',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({sheets:[{properties:{sheetId:7,title:'설문지 응답',gridProperties:{rowCount:20001,columnCount:6}}}]});});
 const reader=createSurveyReader(async()=>'fixture');await reader.connect();await assert.rejects(reader.raw(url),/잘라서/);assert.equal(calls,1);reader.clear();
});
