import test from 'node:test';import assert from 'node:assert/strict';
import {readDropoutSources} from '../../dropout-view.mjs';
import {DROPOUT_SHEET_ID,OPERATIONS_SHEET_ID} from '../../dropout-core.mjs';
import {FEATURE_LATER_TEXT,feature} from '../../cohort.mjs';
// 2기: 중도포기 화면은 1기 운영총괄(반별 탭 17개)·1기 중도포기자 시트를 읽던 화면이라, 2기 마스터시트·2기 중도포기자 시트로 다시 만들 때까지 닫혀 있습니다.
// 1기 화면 시험(H열 판정 쓰기)은 1기(cohort1 브랜치)에 남았습니다. 판정 규칙은 dropout-core 시험이 봅니다.
test('2기 dropout view stays closed and reads no sheet until the 2기 dropout sheet and feature exist',async()=>{
 assert.equal(feature('dropout'),false);assert.equal(DROPOUT_SHEET_ID,'');assert.equal(OPERATIONS_SHEET_ID,'');
 let calls=0;
 await assert.rejects(readDropoutSources(async()=>{calls++;return {};}),new RegExp(FEATURE_LATER_TEXT.slice(0,10)));
 assert.equal(calls,0,'구글 시트를 부르지 않음');
});
