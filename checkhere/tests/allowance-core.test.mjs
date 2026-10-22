// 교육비 수령 기준(allowance-core.mjs, 2026-10-22): 단위기간마다 결석 한도 N일, 관리자가 바꿈.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_ALLOWANCE_RULE,validateAllowanceRule,setAllowanceRule,allowanceRule,allowanceUnits,allowanceText,ruleText} from '../../allowance-core.mjs';

const u=(no,state,{days=20,absent=0,total=absent}={})=>({no,from:'',to:'',days,absent,total,state});

test('defaults are the 80% allowance of each full unit, and the rule checks its shape',()=>{
 assert.deepEqual({...DEFAULT_ALLOWANCE_RULE.units},{'1':4,'2':3,'3':3});
 assert.equal(validateAllowanceRule({units:{'1':5,'2':2,'3':0},convert:false}).ok,true);
 assert.deepEqual(validateAllowanceRule({units:{'1':5}}).data,{units:{'1':5,'2':3,'3':3},convert:true});
 for(const bad of [{units:{'1':-1}},{units:{'1':1.5}},{units:{'4':2}},{units:{},convert:'yes'},null])assert.equal(validateAllowanceRule(bad).ok,false);
});

test('each unit: within the limit is 수령, over is 미수령 (확정 while running), 3=1 conversion can be switched off',()=>{
 setAllowanceRule({units:{'1':2,'2':2,'3':2},convert:true});
 const r=allowanceUnits([u(1,'이수',{absent:1,total:2}),u(2,'진행 중',{absent:2,total:3}),u(3,'시작 전')]);
 assert.deepEqual(r.map(a=>a.state),['수령','미수령 확정','시작 전']);
 assert.deepEqual(r.map(a=>a.failed),[false,true,false]);
 assert.equal(allowanceText(r[0]),'1단위 수령(결석 2/2일)');
 const fin=allowanceUnits([u(1,'미이수',{absent:3,total:3}),u(2,'진행 중',{absent:1,total:1}),u(3,'이수',{days:0})]);
 assert.deepEqual(fin.map(a=>a.state),['미수령','진행 중','해당없음']);
 setAllowanceRule({units:{'1':2,'2':2,'3':2},convert:false});
 assert.equal(allowanceUnits([u(2,'진행 중',{absent:2,total:3})])[0].state,'진행 중');
 assert.match(ruleText(),/1단위 2일 · 2단위 2일 · 3단위 2일 · 결석만/);
 assert.equal(setAllowanceRule({units:{'1':'x'}}).ok,false);
 assert.deepEqual(allowanceRule().units,{'1':4,'2':3,'3':3});
 setAllowanceRule(null);
});
