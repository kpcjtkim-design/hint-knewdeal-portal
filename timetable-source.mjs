// 시간표 기준 일정(편집 전 원본)의 출처는 이 파일 한 곳입니다.
// 지금은 엑셀 일정표에서 만든 timetable-seed.json(2기 261014+261007 절충)에 교육과정 분류 보정(timetable-reference.json)을 얹은 것이고,
// 2기 마스터시트 '교육일정'이 실시간으로 열리면(Apps Script b2Schedule 등) loadBaseSchedule 안의 읽는 곳만 바꾸면 됩니다.
// 관리자 편집·공개본(Firestore timetableBetaDrafts·timetableBetaPublished)은 이 원본 위에 쌓입니다.
import {correctedSeed} from './timetable-reference.mjs';
import {publishEntries} from './timetable-core.mjs';
import {isTestClass} from './cohort.mjs';
export const BASE_SOURCE_LABEL='운영팀 기준 일정(엑셀 원본)';
let memo=null;
async function readBase(){
 const r=await fetch('/timetable-seed.json',{cache:'no-cache'});if(!r.ok)throw Error('기준 엑셀 일정을 읽지 못했습니다.');const seed=await r.json();
 const rr=await fetch('/timetable-reference.json');if(!rr.ok)throw Error('교육과정 기준을 읽지 못했습니다.');const reference=await rr.json();
 return {seed:correctedSeed(seed,reference),reference};
}
// fresh: 관리자 새로고침처럼 다시 읽기. 담임 화면은 같은 화면 안에서 한 번만 읽습니다(오늘 수업·전체 일정이 함께 씀).
export function loadBaseSchedule({fresh=false}={}){
 if(fresh||!memo)memo=readBase().catch(e=>{memo=null;throw e;});
 return memo;
}
// 담임에게 아직 공개본이 없을 때 보여 줄 우리 반 일정: 관리자가 편집 전에 보는 그 원본을 공개본과 같은 모양(엑셀 출처·판 대조 표시 뺌)으로.
// 17반 시험용 테스트반은 엑셀 일정이 없어서 1반 일정을 예시로 보여 줍니다.
const baseClass=(seed,cid)=>seed?.classes?.[cid]||(isTestClass(cid)?seed?.classes?.['1']:null);
export function baseClassEntries(seed,classId){
 const c=baseClass(seed,String(classId??''));
 return c?publishEntries(c.entries||[],{}):[];
}
export const baseSourceLabel=(seed,classId)=>BASE_SOURCE_LABEL+(seed?.classes?.[String(classId??'')]?'':' · 시험용 반이라 1반 일정 예시');
