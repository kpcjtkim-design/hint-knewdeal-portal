import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eventsForClass,sourceCandidates} from '../../survey-core.mjs';
import {surveyLink,loadSurveyLinks} from '../../survey-links.mjs';

// 1기 설문 카탈로그 사본(시험용)을 2기 과정 이름으로 읽습니다: 1기 '임베디드' 트랙 = 2기 '모빌리티' 트랙. 2기 카탈로그(survey-catalog.json)는 아직 비어 있습니다.
const catalog=JSON.parse(readFileSync(new URL('./fixtures/survey-catalog-1gi.json',import.meta.url)));for(const s of catalog.responseSources)if(s.track==='임베디드')s.track='모빌리티';
const form=id=>`https://docs.google.com/forms/d/${id}/viewform`;
const entries=[
 {id:'a',date:'2026-10-02',title:'현직자특강',module:'현직자특강',day:1,kind:'class'},
 {id:'b',date:'2026-10-15',title:'문화체험',module:'문화체험',day:1,kind:'class'},
 {id:'c',date:'2026-10-16',title:'진로취업',module:'진로탐색',day:1,kind:'class'},
 {id:'d',date:'2026-10-21',title:'진로취업',module:'진로탐색',day:4,kind:'class'}
];

test('module-end forms: 진로취업 · 문화체험 · track-specific 현직자특강 on the last module day',async()=>{
 for(const [cid,course,lecture,source] of [['1','모빌리티 AI','1L1ZwCLaG3fsrMnuTX72ObvnwKUq2aAHLBkgia1dWgWc','response-56'],['2','제조지능화','1g4_gKduzaKGy5a58hnJc2G-xd8o60KCR8EGpecGO2ZY','response-55']]){
  const events=Object.fromEntries(eventsForClass(catalog,cid,entries).map(e=>[e.title,e]));
  assert.equal(events['진로취업'].date,'2026-10-21');assert.equal(events['진로취업'].url,form('1_8xTlzjO1asVWQYcbgWjBBgrE2aUDf3eAshCuUKXWb4'));
  assert.equal(events['문화체험'].date,'2026-10-15');assert.equal(events['문화체험'].url,form('1a7YNRUKwvNi-xz-xGjBYiRVinbpSojcdJqXundguAls'));
  assert.deepEqual(sourceCandidates(events['진로취업'],catalog.responseSources,course).map(s=>s.id),['response-58']);
  assert.deepEqual(sourceCandidates(events['문화체험'],catalog.responseSources,course).map(s=>s.id),['response-57']);
  const special=events['현직자특강(비대면)'];assert.ok(special.scheduleMatched);assert.equal(special.date,'2026-10-02');assert.equal(special.url,form(lecture));
  assert.deepEqual(sourceCandidates(special,catalog.responseSources,course).map(s=>s.id),[source]);
  assert.deepEqual(sourceCandidates(special,catalog.responseSources,'').map(s=>s.id),[source]);
 }
 globalThis.fetch=async()=>({ok:true,json:async()=>catalog});await loadSurveyLinks();
 assert.equal(surveyLink('3',entries[0]),form('1L1ZwCLaG3fsrMnuTX72ObvnwKUq2aAHLBkgia1dWgWc'));
 assert.equal(surveyLink('2',entries[0]),form('1g4_gKduzaKGy5a58hnJc2G-xd8o60KCR8EGpecGO2ZY'));
 assert.equal(surveyLink('2',entries[3]),form('1_8xTlzjO1asVWQYcbgWjBBgrE2aUDf3eAshCuUKXWb4'));
});
