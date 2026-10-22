// 식비 유무(meal-core.mjs, 2026-10-22): 반 × 교육일 O·X·미정, 바꾼 칸만 was 확인으로 저장.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMeal,cleanPlan,mealOf,applyMealChanges,mealCounts} from '../../meal-core.mjs';

test('cells cycle O → X → blank, and stray values are dropped',()=>{
 assert.deepEqual([nextMeal(''),nextMeal('O'),nextMeal('X')],['O','X','']);
 assert.deepEqual(cleanPlan({'1':{'2026-10-28':'O','2026-10-29':'?','bad':'X'},'x':{'2026-10-28':'O'}}),{'1':{'2026-10-28':'O'}});
});

test('only changed cells are written; a cell another admin changed meanwhile is skipped',()=>{
 const plan={'1':{'2026-10-28':'O'},'2':{'2026-10-28':'X'}};
 const r=applyMealChanges(plan,[{cls:'1',date:'2026-10-28',was:'O',value:''},{cls:'2',date:'2026-10-28',was:'O',value:''},{cls:3,date:'2026-10-29',was:'',value:'O'}]);
 assert.deepEqual(r.plan,{'2':{'2026-10-28':'X'},'3':{'2026-10-29':'O'}});
 assert.equal(r.applied.length,2);
 assert.deepEqual(r.conflicts.map(c=>[c.cls,c.now]),[['2','X']]);
 assert.equal(mealOf(plan,1,'2026-10-28'),'O');
 assert.deepEqual(mealCounts(r.plan,'3',['2026-10-28','2026-10-29']),{O:1,X:0,'':1});
});
