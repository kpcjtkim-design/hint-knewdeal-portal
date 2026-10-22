// 식비 유무(사용자 2026-10-22 "시간표에 식비 유무 넣을 수 있게... 관리자 관리 측면"): 반 × 교육일마다 O(식비 있음) · X(없음) · 빈칸(미정).
// 저장: Firestore settings/mealPlan {plan:{반:{날짜:'O'|'X'}}, rev, updatedBy, updatedAt}(beta2-meals.mjs). 관리자만 읽고 씁니다.
// 이 파일은 순수 계산(시험용). 칸 바꾸기는 바꾼 칸만 '바꾸기 전 값(was)'과 함께 보내, 그사이 다른 관리자가 같은 칸을 바꿨으면 그 칸만 건너뜁니다.
export const MEAL_VALUES=Object.freeze(['','O','X']);
export const nextMeal=v=>MEAL_VALUES[(Math.max(0,MEAL_VALUES.indexOf(v))+1)%MEAL_VALUES.length];
export const mealLabel=v=>v==='O'?'식비 있음':v==='X'?'식비 없음':'미정';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
// 저장본 정리: 모르는 값·틀린 날짜는 버립니다.
export function cleanPlan(plan){
 const out={};
 for(const [c,days] of Object.entries(plan&&typeof plan==='object'?plan:{})){
  if(!/^\d{1,2}$/.test(c)||!days||typeof days!=='object')continue;
  for(const [d,v] of Object.entries(days))if(DATE.test(d)&&(v==='O'||v==='X'))(out[c]||={})[d]=v;
 }
 return out;
}
export const mealOf=(plan,cls,date)=>plan?.[String(cls)]?.[date]||'';
// changes: [{cls,date,was,value}] → {plan: 새 저장본, applied: [...], conflicts: [{cls,date,was,now,value}]}
export function applyMealChanges(plan,changes){
 const next=cleanPlan(plan),applied=[],conflicts=[];
 for(const ch of changes||[]){
  const c=String(ch.cls),now=mealOf(next,c,ch.date);
  if(!DATE.test(String(ch.date))||!MEAL_VALUES.includes(ch.value))continue;
  if(now!==(ch.was||'')){conflicts.push({...ch,cls:c,now});continue;}
  if(ch.value){(next[c]||={})[ch.date]=ch.value;}else if(next[c]){delete next[c][ch.date];if(!Object.keys(next[c]).length)delete next[c];}
  applied.push({...ch,cls:c});
 }
 return {plan:next,applied,conflicts};
}
// 반마다 O·X·미정 수(days: 그 반 교육일 목록)
export function mealCounts(plan,cls,days){
 const n={O:0,X:0,'':0};for(const d of days)n[mealOf(plan,cls,d)]++;return n;
}
