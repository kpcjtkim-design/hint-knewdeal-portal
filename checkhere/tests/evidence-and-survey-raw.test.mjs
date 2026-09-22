import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceReport,evidenceMessage} from '../../attendance-evidence-core.mjs';
import {conductedContexts,collectSurveyRaw,rawSurveyBlock,withoutContacts} from '../../survey-raw-core.mjs';
import {weekRange} from '../../raw-download-core.mjs';
const classes=[1,2,3].map(id=>({id:String(id),course:'임베디드 AI(HW)'}));
const source={id:'s',title:'임베디드AI-HW(SW 테스팅)',module:'직무특화',sheetUrl:'https://docs.google.com/spreadsheets/d/fixture/edit#gid=1'};
const catalog={responseSources:[source],events:classes.map((c,i)=>({id:'e'+c.id,classId:c.id,title:'SW 테스팅',date:['2026-09-04','2026-09-11','2026-09-18'][i]}))};
const schedules=Object.fromEntries(catalog.events.map(e=>[e.classId,{entries:[{id:e.id,lectureId:'lecture',title:e.title,module:'직무특화',date:e.date,day:1}]}]));
const raw={headers:['타임스탬프','성함','소속 반','전화번호','이메일 주소','5점 만족도','10점 추천','건의사항'],rows:[
 {rowNumber:2,values:['2026-09-22','동명이','1반','010-1111-1234','one@example.test',5,10,'=원문']},
 {rowNumber:3,values:['2026-09-22','동명이','1반','010-2222-5678','two@example.test',0,0,'연락 one@example.test 010-1111-1234']},
 {rowNumber:4,values:['2026-09-22','보통','2반','010-3333-8888','three@example.test',4,9,'']},
 {rowNumber:5,values:['2026-09-01','제외','3반','010-3333-7777','four@example.test',3,8,'']},
 {rowNumber:6,values:['2026-09-22','보통','2반','010-3333-8888','three@example.test',4,9,'']}
]};
const identities={'1':[{name:'동명이(98년생)',phoneLast4:'1234'},{name:'동명이(00년생)',phoneLast4:'5678'}]};
test('evidence filters fixed periods, recognized statuses, unknowns and future records without merging same names',()=>{
 const h=(status='미제출')=>({raw:'인정출석',status:'인정지각',evidenceStatus:status});
 const data={'1':{students:[{id:'a',name:'동명',history:{'2026-08-26':h(),'2026-08-27':h('반려'),'2026-09-01':h('확인'),'2026-09-02':h('미해당'),'2026-09-03':h('미확인'),'2026-10-01':h()}}]},'2':{students:[{id:'b',name:'동명',history:{'2026-08-28':h(),'2026-08-29':{raw:'출석',status:'출석',evidenceStatus:'미제출'}}}]},'3':null};
 const r=evidenceReport(data,{from:'2026-08-27',to:'2026-10-22',today:'2026-09-22'});
 assert.equal(r.rows.length,2);assert.equal(r.students,2);assert.equal(r.unknown.length,1);assert.deepEqual(r.missing,['3']);
 assert.equal(evidenceReport(data,{from:'2026-08-27',status:'반려'}).rows.length,1);
 const message=evidenceMessage(r,{from:'2026-08-27',to:'2026-09-22'});assert.match(message,/\[1반\]/);assert.match(message,/\[2반\]/);assert(!message.includes('2026-09-03'));
});
test('conducted dates follow changed timetable and explicit portal date',()=>{
 const changed=structuredClone(schedules);changed['1'].entries[0].date='2026-09-08';
 assert.equal(conductedContexts(catalog,classes,changed).find(c=>c.classId==='1').date,'2026-09-08');
 assert.equal(conductedContexts(catalog,classes,changed,{events:{e1:{date:'2026-09-15'}}}).find(c=>c.classId==='1').date,'2026-09-15');
});
test('two conducted weeks gather classes together once, include late answers and duplicates, remove all contact details',async()=>{
 const calls=[],reads=[],ids=[];
 const r=await collectSurveyRaw({reader:{raw:async url=>{calls.push(url);return raw;}},catalog,classes,readSchedule:async cid=>{reads.push(cid);return schedules[cid];},readIdentities:async cid=>{ids.push(cid);return identities[cid]||[];},...weekRange(6,7),today:'2026-09-22'});
 assert.equal(r.failed,0);assert.equal(r.count,4);assert.equal(r.sourceCount,1);assert.equal(calls.length,1);assert.deepEqual(reads,['1','2','3']);assert.deepEqual(ids,['1','2']);
 const rows=r.tables[0][1];assert.equal(rows.filter(r=>r[0]==='SW 테스팅').length,1);assert(rows.some(r=>r[1]==='동명이(98년생)'));assert(rows.some(r=>r[1]==='동명이(00년생)'));assert(rows.some(r=>r[3]===5&&r[4]===10));assert.equal(rows.filter(r=>r[1]==='보통').length,2);assert(!rows.some(r=>r.includes('제외')));
 const text=JSON.stringify(r.tables);assert(!text.includes('@'));assert(!text.includes('010-'));assert(!text.includes('1234'));assert(!rows.some(r=>r.includes('전화번호')||r.includes('이메일 주소')));assert(text.includes('=원문'));
});
test('one week includes only classes conducting that week even if another class submitted then',async()=>{
 const r=await collectSurveyRaw({reader:{raw:async()=>raw},catalog,classes,readSchedule:async cid=>schedules[cid],readIdentities:async cid=>identities[cid]||[],...weekRange(6,6),today:'2026-09-22'});assert.equal(r.count,2);
});
test('ambiguous classes and homonyms stay reviewable and contact fields never enter review',()=>{
 const r=rawSurveyBlock({...raw,rows:[{rowNumber:2,values:['date','동명이','1반','','',5,10,'']},{rowNumber:3,values:['date','누군가','알수없음','010-4444-9999','x@example.test',5,10,'']} ]},{title:source.title,contexts:[{classId:'1'}],identities});
 assert.equal(r.rows.length,1);assert.equal(r.review.length,2);assert(!JSON.stringify(r).includes('@'));assert(!JSON.stringify(r).includes('9999'));
 assert.throws(()=>rawSurveyBlock({...raw,headers:[...raw.headers,'분반']},{title:'x',contexts:[]}),/반 열/);
});
test('PII in arbitrary text removed while dates, numbers and zero scores stay raw',()=>{
 assert.equal(withoutContacts('a@example.test / 01012345678 / +82 10-1234-5678'),' /  / ');assert.equal(withoutContacts(0),0);assert.equal(withoutContacts('2026-09-22 18:30:00'),'2026-09-22 18:30:00');
});
test('unmapped survey or failed source marks a partial export, never an empty success',async()=>{
 const r=await collectSurveyRaw({reader:{raw:async()=>{throw Error('권한 없음');}},catalog:{...catalog,events:[...catalog.events,{id:'bad',classId:'1',title:'미등록강의',date:'2026-09-04'}]},classes,readSchedule:async cid=>schedules[cid],readIdentities:async()=>[],from:'2026-09-01',to:'2026-09-12',today:'2026-09-22'});assert.equal(r.failed,2);assert.equal(r.count,0);
});
test('cancellation stops before reading raw sources',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(collectSurveyRaw({reader:{raw:async()=>{calls++;return raw;}},catalog,classes,readSchedule:async cid=>{controller.abort();return schedules[cid];},readIdentities:async()=>[],signal:controller.signal}),/abort/i);assert.equal(calls,0);
});
