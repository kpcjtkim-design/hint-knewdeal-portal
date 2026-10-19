import {eventLessons} from './survey-core.mjs';
let data,pending;
export async function loadSurveyLinks(){if(data)return data;if(!pending)pending=fetch('/survey-catalog.json').then(r=>{if(!r.ok)throw Error('설문 링크 조회 실패');return r.json();}).then(d=>data=d).catch(()=>null).finally(()=>pending=null);return pending;}
export function surveyLink(classId,entry){
 const found=(data?.events||[]).filter(e=>e.classId===String(classId)&&e.url&&eventLessons(e,[entry]).length);
 const urls=[...new Set(found.map(e=>e.url))];return urls.length===1?urls[0]:data?.sourceUrl||'';
 // 2기: 설문 링크가 없으면 빈 값(1기 운영 시트로 보내지 않음). 2기 카탈로그(survey-catalog.json)에 sourceUrl이 생기면 그 주소.
}
