import test from 'node:test';import assert from 'node:assert/strict';
import {ATTENDANCE_OPTIONS,sheetStatus,EVIDENCE_COLORS,latestTeachingDate,resolveSheetTarget,rewriteReasons,latestSnapshots,matchSnapshot,portalStatus,evidenceStatus,hasExistingReason} from '../../attendance-beta-core.mjs';
import {createSheetWriter} from '../../attendance-beta-sheet.mjs';
import {runCollectionQueue} from '../bulk-collect.mjs';
test('portal distinctions map to shared sheet values and latest teaching day excludes future dates',()=>{
  for(const s of ['인정출석','인정지각','인정조퇴','인정외출'])assert.equal(sheetStatus(s),'인정출석');
  assert.equal(EVIDENCE_COLORS.미제출,EVIDENCE_COLORS.반려);assert.equal(EVIDENCE_COLORS.확인,'#ffff00');
  assert.equal(latestTeachingDate([{iso:'2026-09-10'},{iso:'2026-10-22'}],'2026-09-11').iso,'2026-09-10');
  assert.equal(portalStatus('인정출석',{portalStatus:'인정지각',sheetStatus:'인정출석'}),'인정지각');
  assert.equal(portalStatus('결석',{portalStatus:'인정지각',sheetStatus:'인정출석'}),'결석');
  assert.equal(evidenceStatus('#ff0000','인정출석',{sheetColor:'#ff0000',evidenceStatus:'미제출'},()=> '보완필요'),'미제출');
});
test('cell targets require unique student and matching attendance and reason dates',()=>{
  const source={attendance:[['이름','','','','9/3','9/4'],['가상가'],['가상나']],reasons:[['','','','','9/4','9/3'],[]],title:"2. O'Brien",sheetId:7};
  const t=resolveSheetTarget(source,'가상나','2026-09-03');assert.equal(t.statusA1,"'2. O''Brien'!Q20");assert.equal(t.reasonA1,"'2. O''Brien'!R51");
  assert.throws(()=>resolveSheetTarget({...source,attendance:[...source.attendance,['가상나']]},'가상나','2026-09-03'));
});
test('reason edits preserve other students, split explicit shared reasons and reject ambiguity',()=>{
  assert.equal(hasExistingReason('가상가: 파서가 놓친 사유','가상가',''),true);
  assert.equal(hasExistingReason('가상나: 시험','가상가',''),false);
  assert.equal(hasExistingReason('가상가: ','가상가',''),false);
  assert.equal(rewriteReasons('*발생사유\n가상나: 시험',{가상가:'병원'},['가상가','가상나']),'*발생사유\n가상나: 시험\n가상가: 병원');
  assert.equal(rewriteReasons('가상가: 예전\n가상나: 시험',{가상가:'새 사유'},['가상가','가상나']),'가상가: 새 사유\n가상나: 시험');
  assert.equal(rewriteReasons('가상가, 가상나 - 병원',{가상가:'면접'},['가상가','가상나']),'가상가: 면접\n가상나: 병원');
  assert.throws(()=>rewriteReasons('가상가: 지각\n가상가: 조퇴',{가상가:'새 사유'},['가상가']));
  assert.throws(()=>rewriteReasons('가상가: 사유',{가상가:'새 사유'},['가상가','가상가']));
});
test('snapshots use collection time, scope class/date and reject same-name ambiguity',()=>{
  const r={id:'one',classId:'2',date:'2026-09-03',name:'가상가',collectedAt:'2026-09-11T01:00:00Z'};
  const rows=latestSnapshots([{...r,entry:'new'},{...r,entry:'old',collectedAt:'2026-09-10T01:00:00Z'},{...r,id:'other-class',classId:'3'}],'2','2026-09-03');assert.equal(rows.length,1);assert.equal(rows[0].entry,'new');assert(matchSnapshot({name:'가상가'},[{name:'가상가'},{name:'가상가'}],rows).error);
});
function writerFixture({canEdit=true,formula=false,concurrent=false,loseResponse=false}={}){
  const calls=[];let value='해당없음',color={red:1,green:1,blue:1};
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});let data={};
    if(url.includes('drive/v3'))data={capabilities:{canEdit}};
    else if(url.endsWith(':batchUpdate')){const update=JSON.parse(options.body).requests[0].updateCells,v=update.rows[0].values[0];if(v.userEnteredValue)value=v.userEnteredValue.stringValue;else color=v.userEnteredFormat.backgroundColorStyle.rgbColor;if(loseResponse)throw Error('response lost');}
    else if(url.includes('/values:batchGet')){const ranges=new URL(url).searchParams.getAll('ranges');data=ranges[0].includes('M18:ZZ48')?{valueRanges:[{values:[['이름','','','','9/3'],['가상가']]},{values:[['','','','','9/3'],['','','','','가상가: 시험']]}]}:{valueRanges:[{values:[['가상가']]},{values:[['9/3']]}]};}
    else if(url.includes('includeGridData'))data={sheets:[{data:[{rowData:[{values:[{userEnteredValue:formula?{formulaValue:'=A1'}:{stringValue:concurrent?'다른 입력':value},formattedValue:concurrent?'다른 입력':value,effectiveFormat:{backgroundColor:color}}]}]}]}]};
    else data={sheets:[{properties:{sheetId:1,title:'2. 수도권_제조지능화'}}]};
    return new Response(JSON.stringify(data),{status:200});
  };
  return{writer:createSheetWriter({authorize:async()=>'fixture-token',getClassConfig:async()=>({sheetUrl:'https://docs.google.com/spreadsheets/d/test-sheet/edit'}),fetchImpl}),calls};
}
test('writer sends only one exact cell value and independently verifies after lost response',async()=>{
  const {writer,calls}=writerFixture({loseResponse:true});await writer.connect('2');const result=await writer.write({classId:'2',date:'2026-09-03',name:'가상가',kind:'status',before:'해당없음',after:'인정외출'});assert(result.verified);
  const writes=calls.filter(x=>x.url.endsWith(':batchUpdate'));assert.equal(writes.length,1);const request=JSON.parse(writes[0].options.body).requests[0].updateCells;
  assert.deepEqual(request.range,{sheetId:1,startRowIndex:18,endRowIndex:19,startColumnIndex:16,endColumnIndex:17});assert.equal(request.fields,'userEnteredValue');assert.equal(request.rows[0].values[0].userEnteredValue.stringValue,'인정출석');
});
test('writer refuses missing editor permission, formulas and changed source without any write',async()=>{
  for(const config of [{canEdit:false},{formula:true},{concurrent:true}]){const {writer,calls}=writerFixture(config);await assert.rejects(async()=>{await writer.connect('2');await writer.write({classId:'2',date:'2026-09-03',name:'가상가',kind:'status',before:'해당없음',after:'출석'});});assert.equal(calls.filter(x=>x.url.endsWith(':batchUpdate')).length,0);}
});
test('color write preserves values and all unrelated format fields',async()=>{
  const {writer,calls}=writerFixture();await writer.connect('2');await writer.write({classId:'2',date:'2026-09-03',name:'가상가',kind:'color',before:'#ffffff',after:'#ff0000'});const update=JSON.parse(calls.find(x=>x.url.endsWith(':batchUpdate')).options.body).requests[0].updateCells;
  assert.equal(update.fields,'userEnteredFormat.backgroundColorStyle');assert(!update.rows[0].values[0].userEnteredValue);
});
test('bulk collection runs all class-days sequentially and reports missing days without dropping the rest',async()=>{
  const calls=[];let job;
  const result=await runCollectionQueue({classIds:['1','2'],dates:['2026-09-03','2026-09-04'],api:async(path,input)=>{calls.push(input);job={id:String(calls.length),status:calls.length===2?'failed':'complete',count:25,message:'fixture'};return job;},refresh:async()=>({jobs:[job]}),sleep:async()=>{}});
  assert.equal(calls.length,4);assert.deepEqual(calls[0],{classId:'1',dates:['2026-09-03']});assert.equal(result.results.filter(x=>x.status==='failed').length,1);
});
