import test from 'node:test';
import assert from 'node:assert/strict';
import {PARTNER_HEADERS,partnerMapping,exportContexts,buildRawExport,collectRawExport,rawSourceKey} from '../../survey-export-core.mjs';
import {createSurveyReader} from '../../survey-google.mjs';
import {createExportWorkbook} from '../../survey-export.mjs';

const classes=[{id:'1',course:'임베디드 AI(HW)',venue:'서울대학교'}];
const source={id:'s1',title:'임베디드AI-HW(SW 테스팅)',module:'직무특화',sheetUrl:'https://docs.google.com/spreadsheets/d/mock/edit#gid=10'};
const catalog={events:[{id:'e1',classId:'1',title:'SW 테스팅',date:'2026-09-01'}],responseSources:[source]};
const schedules={'1':{entries:[{id:'a',title:'SW 테스팅',lectureId:'test',module:'직무특화',course:classes[0].course,date:'2026-09-01',day:1},{id:'b',title:'SW 테스팅',lectureId:'test',module:'직무특화',course:classes[0].course,date:'2026-09-04',day:2}]}};
const raw={title:'설문지 응답 시트1',gid:10,fetchedAt:'2026-09-16T02:00:00Z',headers:['타임스탬프','성함','소속반','이메일','전반 만족도','추천 의향','좋았던 점','모듈1'],rows:[{rowNumber:2,values:['2026-09-15','가','1반','a@example.test',5,10,'=원문입니다',4]},{rowNumber:3,values:['2026-09-16','가','1반','a@example.test',3,0,'두 번째',5]}]};
const build=(options={})=>buildRawExport({catalog,classes,schedules,sources:[{...source,raw}],startedAt:'start',finishedAt:'finish',...options});

test('partner layout preserves raw 5/10-point values, zero, text and every original submission',()=>{
 const r=build();assert.equal(PARTNER_HEADERS.length,40);assert.equal(r.partner.length,2);
 assert.equal(r.partner[0][19],5);assert.equal(r.partner[0][20],10);assert.equal(r.partner[1][20],0);assert.equal(r.partner[0][21],'=원문입니다');
 assert.equal(r.partner[0][7],'');assert.equal(r.partner[0][30],'');assert.equal(r.partner[0][34],4);assert.equal(r.partner[0][35],'');
 assert(r.partner.every(row=>row[39].includes('동일 이메일 중복 응답 후보')));assert(r.original.some(row=>row[7]===0));
 assert.match(r.partner[0][39],/강의 종료일: 2026-09-04/);assert(!JSON.stringify(r).includes('firebase'));
});
test('an ambiguous question mapping remains blank and all original answers are retained',()=>{
 const broken={...raw,headers:[...raw.headers,'전반적인 만족도'],rows:[{rowNumber:2,values:[...raw.rows[0].values,2]}]};
 const r=build({sources:[{...source,raw:broken}]});assert.equal(r.partner[0][19],'');assert(r.audit.some(r=>r[0]==='문항 연결 확인'));assert(r.original.some(r=>r[7]===2));
});
test('missing identities are not deduplicated by name and unknown fields remain in raw output',()=>{
 const unknown={...raw,headers:['성명','분반','질문 문구','추천 의향'],rows:[{rowNumber:2,values:['가','1반','답변',9]},{rowNumber:3,values:['가','1반','답변2',8]}]};
 const r=build({sources:[{...source,raw:unknown}]});assert.equal(r.partner.length,2);assert.equal(r.partner[0][4],'');assert(r.original.some(r=>r[6]==='질문 문구'&&r[7]==='답변'));assert(!r.partner[0][39].includes('중복 응답 후보'));
});
test('lecture grouping follows portal end dates, including common courses absent from survey calendar',()=>{
 const soft={id:'soft',title:'소프트 스킬 1-2일차 (1,2반)',module:'소프트스킬'};
 const other={...soft,id:'other',title:'소프트 스킬 1-3일차 (3~17반)'};
 const data={'1':{entries:[{id:'a',lectureId:'soft',title:'소프트스킬',module:'소프트스킬',day:1,date:'2026-07-31'},{id:'b',lectureId:'soft',title:'소프트스킬',module:'소프트스킬',day:3,date:'2026-08-14'}]}};
 const result=exportContexts({events:[],responseSources:[soft,other]},classes,data);
 assert.equal(result.length,1);assert.equal(result[0].sourceId,'soft');assert.equal(result[0].endDate,'2026-08-14');
 data['1'].entries[1].date='2026-08-18';assert.equal(exportContexts({events:[],responseSources:[soft]},classes,data)[0].endDate,'2026-08-18');
});
test('ambiguous course source is never assigned from response timestamp',()=>{
 const twice=structuredClone(schedules);twice['1'].entries.push({id:'c',lectureId:'different',title:'SW 테스팅',module:'직무특화',date:'2026-09-08'});
 const r=build({schedules:twice});assert.equal(r.uncertain,2);assert.equal(r.partner[0][3],'');assert.match(r.partner[0][39],/연결 확인/);
});
test('each physical source is fetched once per export; a new export fetches again; partial failures stay explicit',async()=>{
 let calls=0,reads=0;const reader={raw:async url=>{calls++;if(url.includes('denied'))throw Error('권한 없음');return raw;}};
 const extended={...catalog,responseSources:[source,{...source,id:'alias'},{id:'bad',title:'실패 설문',sheetUrl:'https://docs.google.com/spreadsheets/d/denied/edit'}]};
 const run=()=>collectRawExport({reader,catalog:extended,classes,readSchedule:async()=>{reads++;return schedules['1'];}});
 const a=await run(),b=await run();assert.equal(a.partner.length,2);assert.equal(b.partner.length,2);assert.equal(calls,4);assert.equal(reads,2);assert.equal(a.failed,1);assert(a.audit.some(r=>r[0]==='수집 실패'&&r[1]==='실패 설문'));
 assert.notEqual(rawSourceKey(source.sheetUrl),rawSourceKey(source.sheetUrl.replace('gid=10','gid=11')));
});
test('cancel stops before the next source and does not return a partial success',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(collectRawExport({reader:{raw:async()=>{calls++;controller.abort();return raw;}},catalog:{...catalog,responseSources:[source,{...source,id:'s2',sheetUrl:source.sheetUrl.replace('mock','other')}]},classes,readSchedule:async()=>schedules['1'],signal:controller.signal}),/abort/i);assert.equal(calls,1);
});
test('workbook keeps the template positions and makes formula-looking responses text',()=>{
 const XLSX={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(book,sheet,name)=>book.sheets.push({name,sheet})}};
 const result=createExportWorkbook(XLSX,build());assert.deepEqual(result.sheets.map(s=>s.name),['뉴딜 통합 데이터','원본 응답','수집내역']);assert.deepEqual(result.sheets[0].sheet.rows[4],PARTNER_HEADERS);assert.equal(result.sheets[0].sheet.rows[5][21],'=원문입니다');
});
test('raw Google reader honors hash gid, preserves numeric zero, bypasses cache, and uses GET only',async()=>{
 const old=globalThis.fetch,calls=[];let sequence=0;
 globalThis.fetch=async(url,options)=>{const u=new URL(url);calls.push({u,options});if(u.pathname.includes('/values/')){assert.equal(u.searchParams.get('valueRenderOption'),'UNFORMATTED_VALUE');assert.match(decodeURIComponent(u.pathname),/'설문지 응답 시트2'!A1:D3/);return {ok:true,status:200,json:async()=>({values:[['성명','분반','추천 의향','좋았던 점'],['가','1반',sequence++,'그대로']]})};}return {ok:true,status:200,json:async()=>({sheets:[{properties:{sheetId:1,title:'설문지 응답 시트1',gridProperties:{rowCount:3,columnCount:4}}},{properties:{sheetId:10,title:'설문지 응답 시트2',gridProperties:{rowCount:3,columnCount:4}}}]})};};
 try{const reader=createSurveyReader(async()=>'fixture-only');await reader.connect();const a=await reader.raw(source.sheetUrl),b=await reader.raw(source.sheetUrl);assert.equal(a.rows[0].values[2],0);assert.equal(b.rows[0].values[2],1);assert.equal(calls.length,4);assert(calls.every(c=>!c.options.method&&!c.options.body&&c.options.cache==='no-store'));reader.clear();await assert.rejects(reader.raw(source.sheetUrl),/연결/);}finally{globalThis.fetch=old;}
});
