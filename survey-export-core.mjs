import {classNumber,eventsForClass,eventLessons,sourceCandidates,lessonToken,sheetIdFromUrl} from './survey-core.mjs';
import {lectureEndDays} from './timetable-core.mjs';

// The partner's columns stay in their original order. No score is rescaled.
export const PARTNER_HEADERS=['','차수코드','트랙','과정명','이메일','성명','분반','강사 전문성1','강사 전달력1','강사 피드백1','상호작용1','강사 전문성2','강사 전달력2','강사 피드백2','상호작용2','난이도','교육운영','교육장소','교육방법','전반만족도','NPS','좋았던 점','건의사항','보완점','견학 이해','기억되는 장면','산업 이해','','소감','향후 적용 계획','강사전문성 평균','강사 전달력','강사 피드백','상호작용','모듈1','모듈2','모듈3','모듈4','모듈5','비고'];
const normalized=v=>String(v??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const present=v=>v!==undefined&&v!==null&&v!=='';
export function rawSourceKey(url){const u=new URL(url);return sheetIdFromUrl(url)+'#'+(u.searchParams.get('gid')??new URLSearchParams(u.hash.slice(1)).get('gid')??'auto');}

export function partnerMapping(headers){
 const mapping=new Map(),unmapped=[];
 for(let index=0;index<headers.length;index++){
  const title=String(headers[index]??'').trim(),t=normalized(title);if(!t)continue;
  let column=PARTNER_HEADERS.findIndex((h,i)=>i>0&&i<39&&h&&normalized(h)===t);
  if(column<0){
   if(/이메일|e-?mail/i.test(t))column=4;
   else if(/성함|성명|이름/.test(t)&&!/강사/.test(t))column=5;
   else if(/소속반|분반|몇반/.test(t))column=6;
   else if(/난이도/.test(t))column=15;
   else if(/추천.*의향|^nps$/.test(t))column=20;
   else if(/전반.*만족|종합만족/.test(t))column=19;
   else if(/좋았던점/.test(t))column=21;
   else if(/건의/.test(t))column=22;
   else if(/보완점|개선사항/.test(t))column=23;
   else if(/견학.*이해/.test(t))column=24;
   else if(/기억.*장면/.test(t))column=25;
   else if(/산업.*이해/.test(t))column=26;
   else if(/향후.*적용/.test(t))column=29;
   else if(/소감/.test(t))column=28;
   else if(/교육운영/.test(t))column=16;
   else if(/교육장소|교육장시설/.test(t))column=17;
   else if(/교육방법/.test(t))column=18;
   else if(/강사.*전문성.*평균/.test(t))column=30;
   else {
    const instructor=t.match(/강사(?:번호)?([12])|([12])번강사/),number=Number(instructor?.[1]||instructor?.[2]||1);
    const kind=/전문성|전문지식/.test(t)?0:/전달력/.test(t)?1:/피드백/.test(t)?2:/상호작용/.test(t)?3:-1;
    if(kind>=0&&/강사|상호작용/.test(t))column=7+(number-1)*4+kind;
    else {const module=t.match(/모듈([1-5])(?:\]|[.):]|만족|평가|$)/);if(module)column=33+Number(module[1]);}
   }
  }
  if(column>0&&column<39){if(!mapping.has(column))mapping.set(column,[]);mapping.get(column).push(index);}
  else unmapped.push(index);
 }
 return {mapping,unmapped};
}

function classAllowed(title,cid){
 const range=title.match(/(\d+)\s*[~～-]\s*(\d+)\s*반/);if(range)return +cid>=+range[1]&&+cid<=+range[2];
 const list=title.match(/\((\d+(?:\s*반)?(?:\s*,\s*\d+(?:\s*반)?)+)\s*반?\)/);
 if(list)return [...list[1].matchAll(/\d+/g)].some(m=>+m[0]===+cid);
 return true;
}
const lectureKey=e=>e.lectureId||JSON.stringify([e.course||'',e.module||'',e.title||'']);
// Use the same per-lecture end date as the portal's "모듈 종료일" indicator.
export function exportContexts(catalog,classes,schedules,config={}){
 const contexts=[];
 for(const cls of classes){
  const cid=String(cls.id),entries=schedules[cid]?.entries||[],ends=lectureEndDays(entries),last=new Map(ends.map(e=>[lectureKey(e),e]));
  const add=(source,matches)=>{for(const entry of matches){const end=last.get(lectureKey(entry));if(!end)continue;contexts.push({sourceId:source.id,classId:cid,title:end.title,module:end.module,endDate:end.date,lectureId:lectureKey(end),course:cls.course||end.course||'',venue:cls.venue||''});}};
  for(const e of eventsForClass(catalog,cid,entries)){
   const configured=catalog.responseSources.find(s=>s.id===config.events?.[e.id]?.sourceId),candidates=sourceCandidates(e,catalog.responseSources,cls.course),source=configured||(candidates.length===1?candidates[0]:null);
   if(source)add(source,eventLessons(e,entries));
  }
  // Early common courses are present in the timetable but not all in the survey calendar.
  for(const source of catalog.responseSources){
   if(!classAllowed(source.title,cid))continue;
   let matches=ends.filter(e=>sourceCandidates({title:e.title},[source],cls.course).length);
   if(['소프트스킬','디지털스킬'].includes(source.module))matches=ends.filter(e=>normalized(e.module)===normalized(source.module));
   if(source.module==='그룹특화'&&!matches.length){
    if(/천안/.test(source.title))matches=ends.filter(e=>/실차|현장/.test(e.title)&&/천안/.test(e.title));
    else if(/울산.*6반/.test(source.title)&&['6','7'].includes(cid))matches=ends.filter(e=>/실차|현장/.test(e.title)&&/울산/.test(e.title));
   }
   add(source,matches);
  }
 }
 return [...new Map(contexts.map(c=>[JSON.stringify([c.sourceId,c.classId,c.lectureId]),c])).values()];
}

function oneValue(mapping,column,values){const indices=mapping.get(column)||[];return indices.length===1?(values[indices[0]]??''):'';}
export function buildRawExport({catalog,classes,schedules,config={},sources,failures=[],startedAt,finishedAt}){
 const contexts=exportContexts(catalog,classes,schedules,config),allowed=new Set(classes.map(c=>String(c.id))),classMap=new Map(classes.map(c=>[String(c.id),c]));
 const partner=[],original=[],audit=[['수집 시작',startedAt],['수집 종료',finishedAt],['자료 구분','다운로드 시 수집한 RAW 응답. 최종 확정본이나 출결 대상자 통계가 아닙니다.'],['점수','5점·10점 등 원본 값 유지. 환산·평균·NPS 계산 없음.'],['모듈','사이트와 같은 개별 강의 종료일 기준. 설문에서 묻지 않은 모듈별 점수는 공란.'],['중복','원본 제출 행을 모두 보존. 같은 이메일·반·설문의 반복 제출은 후보 표시만 합니다.'],[],['구분','응답 원본','내용','건수','수집 시각']];
 const seen=new Map();let uncertain=0;
 for(const source of sources){
  const {raw}=source,{mapping,unmapped}=partnerMapping(raw.headers),timeIndices=raw.headers.map((h,i)=>/타임스탬프|timestamp/i.test(String(h))?i:-1).filter(i=>i>=0);
  audit.push(['수집 성공',source.title,raw.title,raw.rows.length,raw.fetchedAt]);
  for(const [column,indices]of mapping)if(indices.length>1)audit.push(['문항 연결 확인',source.title,PARTNER_HEADERS[column]+'에 여러 문항이 대응하여 공란 처리: '+indices.map(i=>raw.headers[i]).join(' / ')]);
  for(const index of unmapped)audit.push(['원문 보존',source.title,`${index+1}열: ${raw.headers[index]}`]);
  for(const record of raw.rows){
   const values=record.values,rawClass=oneValue(mapping,6,values),cid=classNumber(rawClass);if(cid&&!allowed.has(cid))continue;
   const notes=[],row=Array(PARTNER_HEADERS.length).fill('');
   for(const [column]of mapping)row[column]=oneValue(mapping,column,values);
   const cls=classMap.get(cid),ids=source.sourceIds||[source.id],candidates=[...new Map(contexts.filter(c=>ids.includes(c.sourceId)&&c.classId===cid).map(c=>[c.lectureId,c])).values()];
   const courseIndices=raw.headers.map((h,i)=>/^(?:수강)?(?:과정명|강의명|과목명)$/.test(normalized(h))?i:-1).filter(i=>i>=0),answerTitle=courseIndices.length===1?String(values[courseIndices[0]]||''):'';
   const narrowed=answerTitle?candidates.filter(c=>lessonToken(c.title)===lessonToken(answerTitle)):candidates,context=narrowed.length===1?narrowed[0]:null;
   if(cls&&!present(row[2]))row[2]=cls.course||'';
   if(context){if(!present(row[3]))row[3]=context.title;notes.push('모듈: '+context.module,'강의 종료일: '+context.endDate);}
   else {notes.push('시간표 강의 연결 확인 필요');uncertain++;}
   if(!cid)notes.push('분반 연결 확인 필요');
   if([...mapping.values()].some(a=>a.length>1))notes.push('중복된 문항 연결은 공란 · 원본 응답 참조');
   const email=String(row[4]||'').trim().toLowerCase(),key=email&&cid?JSON.stringify([source.id,cid,email]):'';
   if(key){const previous=seen.get(key);if(previous!==undefined){notes.push('동일 이메일 중복 응답 후보');if(!partner[previous][39].includes('동일 이메일 중복 응답 후보'))partner[previous][39]+=' · 동일 이메일 중복 응답 후보';}else seen.set(key,partner.length);}
   else notes.push('원본 보존 · 학생 식별값 부족 시 자동 중복 제거 안 함');
   const timestamp=timeIndices.length===1?(values[timeIndices[0]]??''):'';
   notes.push('원본: '+source.title,'원본 행: '+record.rowNumber,'응답 시각: '+timestamp);
   row[39]=notes.join(' · ');partner.push(row);
   for(let i=0;i<Math.max(raw.headers.length,values.length);i++)if(present(values[i]))original.push([partner.length,source.title,raw.title,record.rowNumber,rawClass,timestamp,raw.headers[i]||`제목 없는 ${i+1}열`,values[i]]);
  }
 }
 for(const failure of failures)audit.push(['수집 실패',failure.title,failure.message]);
 audit.push(['합계','',`협업사 양식 ${partner.length}행 · 강의 연결 확인 ${uncertain}행 · 수집 실패 ${failures.length}건`,partner.length]);
 return {partner,original,audit,uncertain,failed:failures.length,startedAt,finishedAt};
}

export async function collectRawExport({reader,catalog,classes,readSchedule,config={},onProgress=()=>{},signal}){
 const startedAt=new Date().toISOString(),schedules={},failures=[],sources=[],readSources=new Map();
 for(const cls of classes){signal?.throwIfAborted();onProgress(`${cls.id}반 시간표 확인 중`);try{const schedule=await readSchedule(String(cls.id));if(!schedule)throw Error('공개 시간표가 없습니다.');schedules[String(cls.id)]=schedule;}catch(e){signal?.throwIfAborted();failures.push({title:cls.id+'반 시간표',message:e.message});}}
 const all=catalog.responseSources||[];
 for(let i=0;i<all.length;i++){
  signal?.throwIfAborted();const source=all[i];onProgress(`응답 원본 ${i+1}/${all.length} · ${source.title}`);
  try{const key=rawSourceKey(source.sheetUrl);if(!readSources.has(key))readSources.set(key,reader.raw(source.sheetUrl,{signal}));const raw=await readSources.get(key),existing=sources.find(s=>s.key===key);if(existing)existing.sourceIds.push(source.id);else sources.push({...source,key,sourceIds:[source.id],raw});}
  catch(e){signal?.throwIfAborted();failures.push({title:source.title,message:e.message});}
 }
 signal?.throwIfAborted();onProgress('원본 문항을 양식에 연결하는 중');
 return buildRawExport({catalog,classes,schedules,config,sources,failures,startedAt,finishedAt:new Date().toISOString()});
}
