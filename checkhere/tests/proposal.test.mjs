import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestReason,reasonCategory,sourceRecord,assertProposalSource,assertColumnSource,requestChanges,suggestTimes,excursionFor,requestColumn,requestsOverlap} from '../../checkhere-proposal-core.mjs';
const record=()=>({id:'student-record',classId:'2',date:'2026-09-03',name:'가상학생',version:'v1',entry:'13:00:15',exit:'18:00:00',entryMemo:'',exitMemo:'',teacher:'홍길동',outings:[],readState:'complete'});
test('reason suggestions follow recognized templates and map to correct field',()=>{
 const r=record();assert.equal(suggestReason({status:'인정지각',reason:'병원 진료',record:r}).text,'(인정지각)병원_담임:홍길동(13:00)');
 const early=suggestReason({status:'인정조퇴',reason:'면접',record:{...r,exit:'15:01:45'}});assert.equal(early.field,'exitMemo');assert.equal(early.text,'(인정조퇴)면접_담임:홍길동(15:01)');
 assert.equal(suggestReason({status:'인정출석',reason:'산업안전기사 시험',record:r}).text,'(인정출석)시험_담임:홍길동');
 assert.equal(suggestReason({status:'지각',record:r}).text,'지각_담임:홍길동(13:00)');
});

test('time proposals normalize recognized types but preserve actual excursion and abnormal times',()=>{
 for(const status of ['인정출석','인정지각','인정조퇴','인정외출'])assert.deepEqual(suggestTimes({status,record:record()}).value,{entry:'09:00:00',exit:'18:00:00'});
 assert.deepEqual(suggestTimes({status:'인정지각',record:record(),excursion:true}).value,{entry:'13:00:15',exit:'18:00:00'});
 assert.deepEqual(suggestTimes({status:'지각',record:record()}).value,{entry:'13:00:15',exit:'18:00:00'});
 assert.deepEqual(requestChanges(record(),'times',{entry:'09:00',exit:'18:00'}),{entry:'09:00:00'});
 assert.throws(()=>requestChanges(record(),'times',{entry:'',exit:'18:00'}));
 assert.throws(()=>requestChanges(record(),'times',{entry:'18:00',exit:'09:00'}));
 const entries=[{date:'2026-09-11',module:'공장견학',title:'화성공장'},{date:'2026-09-11',module:'실차체험',title:'분해조립'},{date:'2026-09-12',module:'공장견학'},{date:'2026-09-11',module:'직무특화',title:'SW 테스팅'}];
 assert.equal(excursionFor(entries,'2026-09-11').length,2);
});

test('independent column requests remain valid after another column applies; target and identity conflicts stop approval',()=>{
 const r=record(),ctx={sourceScope:'column-v2',column:'entryMemo',record:sourceRecord(r)};
 assert.doesNotThrow(()=>assertColumnSource(ctx,{...r,entry:'09:00:00',version:'v2',exitMemo:'다른 열 승인됨'}));
 assert.throws(()=>assertColumnSource(ctx,{...r,entryMemo:'외부에서 수정'}));
 assert.throws(()=>assertColumnSource(ctx,{...r,id:'different-student'}));
 const timeCtx={...ctx,column:'times'};assert.throws(()=>assertColumnSource(timeCtx,{...r,exit:'17:00:00'}));
 const base={classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234'};
 const a={...base,changes:{entry:'09:00:00'}},b={...base,changes:{entryMemo:'사유'}};
 assert.equal(requestColumn(a),'times');assert.equal(requestColumn(b),'entryMemo');assert(!requestsOverlap(a,b));
 assert(requestsOverlap(a,{...a,changes:{entry:'09:01:00',exit:'18:00:00'}}));
});
test('ambiguous reasons and normalized times never fabricate actual times',()=>{
 assert.equal(reasonCategory('병원 또는 면접 확인 필요'),'');assert.equal(reasonCategory('병원 면접'),'');assert.equal(reasonCategory('인적성 시험'),'인적성');assert.equal(reasonCategory('외조모상'),'외조모상');
 assert.match(suggestReason({status:'인정지각',reason:'병원',record:{...record(),entry:'09:00:00'}}).text,/시간 확인/);
 assert.match(suggestReason({status:'인정지각',reason:'알 수 없음',record:record()}).text,/사유 확인/);
 assert.equal(suggestReason({status:'중복',record:record()}).supported,false);
});
test('outings require all real intervals and retain multiple intervals',()=>{
 assert(suggestReason({status:'외출',record:record()}).blocked);
 const r={...record(),outings:[{start:'13:10:05',end:'14:10:01'},{start:'15:00:00',end:'15:30:00'}],outingCount:2};
 assert.equal(suggestReason({status:'인정외출',reason:'병원',record:r}).text,'(인정외출)병원_담임:홍길동(13:10~14:10, 15:00~15:30)');
 assert(suggestReason({status:'외출',record:{...r,outingCount:3}}).blocked);
});
test('proposal context pins identity and source values, not collection timestamp',()=>{
 const r=record(),ctx={record:sourceRecord(r)};assert.doesNotThrow(()=>assertProposalSource(ctx,{...r,collectedAt:'later'}));
 for(const patch of [{id:'another'},{version:'v2'},{entryMemo:'someone changed it'},{teacher:'다른담임'}])assert.throws(()=>assertProposalSource(ctx,{...r,...patch}));
 assert.deepEqual(requestChanges(r,'entryMemo','새 사유'),{entryMemo:'새 사유'});assert.throws(()=>requestChanges(r,'entry','09:00'));assert.throws(()=>requestChanges(r,'entryMemo',''));
});

test('explicit blank memo changes clear old reasons without permitting time deletion',()=>{
 const r={...record(),entryMemo:'오래된 사유',exitMemo:'오래된 퇴실 사유'};
 assert.deepEqual(requestChanges(r,'entryMemo',''),{entryMemo:''});
 assert.deepEqual(requestChanges(r,'exitMemo','   '),{exitMemo:''});
 assert.throws(()=>requestChanges(r,'times',{entry:'',exit:''}));
 assert.throws(()=>requestChanges(r,'entryMemo','x'.repeat(501)));
 const recommendation=suggestReason({status:'출석',record:r});assert(recommendation.clear);assert.equal(recommendation.text,'');assert.deepEqual(recommendation.fields,['entryMemo','exitMemo']);
});
