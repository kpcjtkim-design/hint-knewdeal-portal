import {eventLessons} from './survey-core.mjs';
let data,pending;
export async function loadSurveyLinks(){if(data)return data;if(!pending)pending=fetch('/survey-catalog.json').then(r=>{if(!r.ok)throw Error('설문 링크 조회 실패');return r.json();}).then(d=>data=d).catch(()=>null).finally(()=>pending=null);return pending;}
export function surveyLink(classId,entry){
 const found=(data?.events||[]).filter(e=>e.classId===String(classId)&&e.url&&eventLessons(e,[entry]).length);
 const urls=[...new Set(found.map(e=>e.url))];return urls.length===1?urls[0]:data?.sourceUrl||'https://docs.google.com/spreadsheets/d/1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34/edit#gid=2136777389';
}
