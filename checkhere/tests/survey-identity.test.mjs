import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneLast4,validateDuplicateIdentities} from '../../survey-identity.mjs';
import {summarizeResponses,responseColumns} from '../../survey-core.mjs';
import {summarizeScores} from '../../survey-scores.mjs';
const targets=[{id:'a',name:'동명(98년생)',status:'출석',eligible:true},{id:'b',name:'동명(01년생)',status:'지각',eligible:true},{id:'c',name:'단독',status:'출석',eligible:true}];
const identities=[{name:targets[0].name,phoneLast4:'0012'},{name:targets[1].name,phoneLast4:'0034'}];
const response=(phoneLast4,value=5,rest={})=>({classId:'12반',name:'동명',phoneLast4,timestamp:'2026-09-16',scores:[{id:'q1',title:'만족도',kind:'overall',value}],...rest});
const summarize=(responses,extra={})=>summarizeResponses({classId:'12',targets,identities,responses,...extra});
test('within-class phone suffixes match plain names, not the identically named other class',()=>{
 const r=summarize([response('0012'),response('0034',4),response('0012',1,{classId:'9반'})]);
 assert.deepEqual(r.answered.map(s=>s.id),['a','b']);assert.deepEqual(r.missing.map(s=>s.id),['c']);assert.equal(r.duplicateCount,0);assert.equal(r.unknown.length,0);
 assert(!JSON.stringify(r).includes('0012'));assert(!JSON.stringify(r).includes('phone'));
});
test('latest submission deduplicates per resolved student, using the same identity for scores',()=>{
 const responses=[response('0012',1),response('0034',3),response('0012',5,{timestamp:'2026-09-17',name:'동명(98년생)'})],r=summarize(responses),scores=summarizeScores(responses,'12',r.answered,{targets,identities});
 assert.equal(r.duplicateCount,1);assert.equal(scores.respondents,2);assert.equal(scores.overallAverage,4);assert.deepEqual(scores.questions[0].distribution,[0,0,1,0,1]);
});
test('missing, invalid, conflicting and colliding suffixes never answer both students or flag a false nonresponder',()=>{
 for(const rows of [[response('')],[response('9999')],[response('0012',5,{name:'동명(01년생)'})]]){const r=summarize(rows);assert.equal(r.answered.length,0);assert.deepEqual(r.review.map(s=>s.id),['a','b']);}
 for(const map of [[],identities.slice(0,1),identities.map(s=>({...s,phoneLast4:'0012'}))])assert.equal(summarize([response('0012')],{identities:map}).answered.length,0);
 const r=summarize([response('0012'),response('')]);assert.deepEqual(r.answered.map(s=>s.id),['a']);assert.deepEqual(r.review.map(s=>s.id),['b']);
});
test('an explicit birth-tag name still works on historical surveys without phone; exclusions remain exclusions',()=>{
 assert.equal(summarize([response('',5,{name:'동명(98년생)'})]).answered[0].id,'a');
 const r=summarize([response('0034')],{targets:targets.map(s=>s.id==='b'?{...s,eligible:false,status:'결석'}:s)});assert.equal(r.answered.length,0);assert.equal(r.excluded[0].id,'b');
 assert.equal(summarize([{name:'단독',classId:'12반'}]).answered[0].id,'c');
});
test('phone extraction preserves zeros and rejects malformed input; phone header is optional and unambiguous',()=>{
 for(const v of ['010-1234-0012','01012340012','+82 10 1234 0012','0012'])assert.equal(phoneLast4(v),'0012');
 for(const v of ['123','생일 980101','010-1234-****','123456789012345'])assert.equal(phoneLast4(v),'');
 assert.equal(responseColumns(['타임스탬프','성명','분반','핸드폰번호']).phone,3);
 assert.equal(responseColumns(['타임스탬프','성명','분반','전화번호','연락처']).phone,undefined);
});
test('only same-class duplicate students and exactly four phone digits can be stored',()=>{
 assert.deepEqual(validateDuplicateIdentities(identities,targets),identities);
 assert.throws(()=>validateDuplicateIdentities([{name:'단독',phoneLast4:'1234'}],targets),/동명이인/);
 assert.throws(()=>validateDuplicateIdentities([{...identities[0],phone:'01000000000'}],targets),/4자리만 저장/);
 assert.throws(()=>validateDuplicateIdentities(identities.map(x=>({...x,phoneLast4:'0012'})),targets),/겹쳐/);
 assert.throws(()=>validateDuplicateIdentities(identities.slice(0,1),targets),/모두/);
 assert.throws(()=>validateDuplicateIdentities([{...identities[0],phoneLast4:'01012340012'}],targets),/4자리만 입력/);
});
