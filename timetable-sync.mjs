import {sortEntries} from './timetable-core.mjs';
// Excel workbook updates arrive as a new timetable-seed.json. Each draft remembers the seed it came from,
// so a three-way merge keeps portal-only edits (instructor, times, notes, moves the sheet did not touch).
// 2기 첫 엑셀 기준(261014+261007 절충, timetable-seeds/20261014.json). seedVersion 없는 편집본의 병합 기준입니다.
export const ORIGINAL_SEED='20261014';
// note/order are empty in the workbook. 2기: 일정표 강사명(instructorName)·행사 구분(event: 입교식·수료식·공장견학·분해조립)도 엑셀 값입니다.
export const SHEET_FIELDS=['date','course','module','lectureId','title','day','hours','kind','online','note','order','instructorName','event'];
const labels={date:'날짜',course:'과정',module:'모듈',lectureId:'강의',title:'강의명',day:'일차',hours:'교육시간',kind:'휴일 구분',online:'수업 방식',note:'전달사항',order:'같은 날 순서',instructorName:'강사(일정표)',event:'행사 구분'};
// 엑셀 출처 표시(판 대조 origin·review, 원본 행·글자)는 새 기준 값으로 바꾸고, 없는 값은 넣지 않습니다(Firestore는 undefined를 받지 않음).
const sheetMeta=n=>Object.fromEntries(['origin','review','sourceRow','sourceText'].filter(k=>n[k]!==undefined).map(k=>[k,n[k]]));
export const seedKey=e=>e.kind==='holiday'?`h|${e.date}|${e.title}`:`c|${e.lectureId||e.title}|${e.day}`;
export const draftSeedVersion=d=>d?.seedVersion||ORIGINAL_SEED;
export function mergeSeed({classId,base=null,next=[],draft=[],version}){
 const baseByKey=new Map((base||[]).map(e=>[seedKey(e),e])),baseById=new Map((base||[]).map(e=>[e.id,e])),nextByKey=new Map(next.map(e=>[seedKey(e),e]));
 const keyOf=d=>d.seedKey||(baseById.has(d.id)?seedKey(baseById.get(d.id)):!base&&/^(xlsx|x2)-/.test(String(d.id))?seedKey(d):null);
 const draftByKey=new Map(),kept=[];
 for(const d of draft){const k=keyOf(d);if(k&&!draftByKey.has(k))draftByKey.set(k,d);else kept.push(d);}
 const ids=new Set(draft.map(e=>e.id)),out=[...kept],changes=[];
 const text=e=>e?`${e.date}${e.start?' '+e.start+'–'+e.end:''}`:'없음';
 for(const k of new Set([...nextByKey.keys(),...draftByKey.keys()])){
  const n=nextByKey.get(k),b=baseByKey.get(k),d=draftByKey.get(k);
  if(n&&d){
   const {review:_r,...kept}=d,merged={...kept,...sheetMeta(n),seedKey:k},fields=[];let conflict=false;
   for(const f of SHEET_FIELDS){if((n[f]??'')===(d[f]??''))continue;if(b&&(b[f]??'')===(n[f]??''))continue;if(n[f]===undefined)delete merged[f];else merged[f]=n[f];fields.push(labels[f]);if(b&&(d[f]??'')!==(b[f]??''))conflict=true;}
   out.push(merged);if(fields.length)changes.push({kind:'변경',title:n.title,day:n.day,from:text(d),to:text(merged),fields,conflict});
  }else if(n){
   if(b&&SHEET_FIELDS.every(f=>(b[f]??'')===(n[f]??''))){changes.push({kind:'유지',title:n.title,day:n.day,from:'포털에서 삭제',to:'삭제 유지',fields:[],conflict:false,skipped:true});continue;}
   let id=`xlsx-${classId}-${version}-${n.sourceRow??k}`;while(ids.has(id))id+='-1';ids.add(id);
   const {id:_,...rest}=n;out.push({...rest,id,seedKey:k});changes.push({kind:'추가',title:n.title,day:n.day,from:'없음',to:text(n),fields:[],conflict:false});
  }else if(!base||b){changes.push({kind:'삭제',title:d.title,day:d.day,from:text(d),to:'없음',fields:[],conflict:!!(b&&SHEET_FIELDS.some(f=>(b[f]??'')!==(d[f]??'')))});}
  else out.push(d);
 }
 return {classId:String(classId),entries:sortEntries(out),changes:changes.filter(c=>!c.skipped),skipped:changes.filter(c=>c.skipped)};
}
