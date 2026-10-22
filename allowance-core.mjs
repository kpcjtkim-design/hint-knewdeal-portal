// 교육비 수령 기준(사용자 2026-10-22 "수료 기준 말고도 교육비 수령기준도 넣어줘. 각 단위기간 별로 N일 결석까지 ㅇㅋ. 그 N일은 유동적으로 관리자가 변경 가능하게").
// 단위기간마다 결석 한도 N일(관리자 「교육비 기준」 화면, Firestore settings/allowanceRule)을 넘지 않으면 그 단위기간 교육비 수령.
// 결석은 단위기간 이수와 같은 셈(beta2-core unitCompletion): 그 단위기간 결석 + floor(그 단위기간 지·조·외 ÷ 3). convert를 끄면 결석만 셉니다.
// 이 파일은 화면 계산만(순수). 읽기·저장은 allowance-store.mjs. 관리 측면이라 관리자 화면에서만 보입니다(담임은 설정 문서를 읽지 못함).
import {UNIT_PERIODS} from './cohort.mjs';

// 기본값: 꽉 찬 단위기간 80% 출석 허용(1단위 23일 → 4일, 2단위 19일 → 3일, 3단위 18일 → 3일). 관리자가 바꾸기 전까지 이 값입니다.
export const DEFAULT_ALLOWANCE_RULE=Object.freeze({units:Object.freeze({'1':4,'2':3,'3':3}),convert:true});
export const MAX_LIMIT=60;
export const ALLOWANCE_FAIL_STATES=Object.freeze(['미수령','미수령 확정']);

// 모양 확인 → {ok, data, errors}. units: 단위 번호(문자) → 0~60 정수. 빠진 단위는 기본값.
export function validateAllowanceRule(rule,periods=UNIT_PERIODS){
 const errors=[],units={};
 if(!rule||typeof rule!=='object')return {ok:false,data:null,errors:['기준 값이 없습니다.']};
 const src=rule.units&&typeof rule.units==='object'?rule.units:{};
 for(const p of periods){
  const k=String(p.no),v=src[k]??DEFAULT_ALLOWANCE_RULE.units[k]??0;
  if(!Number.isInteger(v)||v<0||v>MAX_LIMIT)errors.push(`${k}단위 결석 한도는 0~${MAX_LIMIT} 사이 정수여야 합니다.`);
  else units[k]=v;
 }
 for(const k of Object.keys(src))if(!periods.some(p=>String(p.no)===k))errors.push(`없는 단위기간입니다: ${k}`);
 if(rule.convert!==undefined&&typeof rule.convert!=='boolean')errors.push('3회=결석 1일 환산 여부가 틀렸습니다.');
 return errors.length?{ok:false,data:null,errors}:{ok:true,data:{units,convert:rule.convert!==false},errors:[]};
}

// 지금 쓰는 기준(관리자 화면이 시작할 때 allowance-store loadAllowanceRule로 채웁니다).
let current={...DEFAULT_ALLOWANCE_RULE,units:{...DEFAULT_ALLOWANCE_RULE.units}},meta={from:'default',rev:0,updatedBy:'',updatedAt:null};
export function setAllowanceRule(rule,info={}){
 const v=rule==null?{ok:true,data:{units:{...DEFAULT_ALLOWANCE_RULE.units},convert:true}}:validateAllowanceRule(rule);
 current=v.ok?v.data:{units:{...DEFAULT_ALLOWANCE_RULE.units},convert:true};
 meta={from:rule!=null&&v.ok?'saved':'default',rev:info.rev||0,updatedBy:info.updatedBy||'',updatedAt:info.updatedAt||null};
 return {ok:v.ok,warning:v.ok?'':'교육비 기준 설정이 깨져 기본값을 씁니다'};
}
export const allowanceRule=()=>({units:{...current.units},convert:current.convert});
export const allowanceMeta=()=>({...meta});

// 한 학생의 단위기간 이수 결과(unitCompletion 줄들) → 단위기간별 교육비 판정.
// 상태: 해당없음(재학 교육일 없음) · 시작 전 · 진행 중 · 미수령 확정(진행 중인데 이미 한도 넘음) · 수령 · 미수령(끝난 기간)
export function allowanceUnits(units,rule=allowanceRule()){
 return (units||[]).map(u=>{
  const limit=rule.units[String(u.no)]??0,count=rule.convert?u.total:u.absent,over=count>limit;
  const done=u.state==='이수'||u.state==='미이수';
  const state=!u.days?'해당없음':u.state==='시작 전'?'시작 전':done?(over?'미수령':'수령'):(over?'미수령 확정':'진행 중');
  return {no:u.no,from:u.from,to:u.to,days:u.days,count,limit,left:Math.max(0,limit-count),state,failed:ALLOWANCE_FAIL_STATES.includes(state)};
 });
}
// 짧은 글: '1단위 수령(결석 2/4일)'
export const allowanceText=a=>`${a.no}단위 ${a.state}${a.days&&a.state!=='시작 전'?`(결석 ${a.count}/${a.limit}일)`:''}`;
export const ruleText=(rule=allowanceRule())=>Object.entries(rule.units).map(([k,v])=>`${k}단위 ${v}일`).join(' · ')+(rule.convert?' · 지·조·외 3회=결석 1일':' · 결석만');
