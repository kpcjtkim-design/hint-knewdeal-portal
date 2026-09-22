import {exportContexts,rawSourceKey} from './survey-export-core.mjs';
import {classNumber,eventsForClass,sourceCandidates,lessonToken} from './survey-core.mjs';
import {createSurveyIdentityMatcher,phoneLast4} from './survey-identity.mjs';
import {koreaToday} from './attendance-beta-core.mjs';
const contactHeader=v=>/전화|연락처|휴대폰|핸드폰|이메일|전자\s*우편|e[\s-]?mail|phone|mobile|휴대\s*번호/i.test(String(v));
// Also remove contact details pasted into free-text answers. Scores and dates stay unchanged.
export function withoutContacts(value){
 if(typeof value!=='string')return value;
 return value.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi,'').replace(/(?<!\d)(?:\+?82[\s().-]*1[016789]|01[016789])[\s().-]*\d{3,4}[\s().-]*\d{4}(?!\d)/g,'').replace(/(?<!\d)0(?:2|[3-6][1-5])[\s().-]+\d{3,4}[\s().-]+\d{4}(?!\d)/g,'');
}
export function conductedContexts(catalog,classes,schedules,config={}){
 const fallback=exportContexts(catalog,classes,schedules,config),explicit=[],seen=new Set();
 for(const c of classes)for(const e of eventsForClass(catalog,String(c.id),schedules[c.id]?.entries||[])){
  const setting=config.events?.[e.id]||{},candidates=sourceCandidates(e,catalog.responseSources,c.course),source=catalog.responseSources.find(s=>s.id===setting.sourceId)||(candidates.length===1?candidates[0]:null);
  if(!source)continue;
  const date=setting.date||e.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  explicit.push({sourceId:source.id,classId:String(c.id),title:e.title,module:source.module,date});seen.add(source.id+':'+c.id);
 }
 const extra=new Map();
 for(const c of fallback){const key=c.sourceId+':'+c.classId;if(seen.has(key))continue;const source=catalog.responseSources.find(s=>s.id===c.sourceId);let date=c.endDate;
  if(source?.module==='소프트스킬'){
   const days=source.title.match(/(\d+)\s*(?:[~～-]\s*(\d+))?\s*일차/);
   if(days){const dates=(schedules[c.classId]?.entries||[]).filter(e=>e.kind!=='holiday'&&e.module==='소프트스킬'&&Number(e.day)>=Number(days[1])&&Number(e.day)<=Number(days[2]||days[1])).map(e=>e.date).sort();if(!dates.length)continue;date=dates.at(-1);}
  }
  const existing=extra.get(key);if(!existing||existing.date<date)extra.set(key,{...c,title:source?.title||c.title,date});}
 return [...new Map([...explicit,...extra.values()].map(c=>[JSON.stringify([c.sourceId,c.classId,c.date]),c])).values()];
}
export function rawSurveyBlock(raw,{title,contexts,identities={}}){
 const headers=raw.headers||[],width=raw.rows.reduce((n,r)=>Math.max(n,r.values.length),headers.length),keep=Array.from({length:width},(_,i)=>i).filter(i=>!contactHeader(headers[i]||''));
 const classCols=headers.map((h,i)=>/소속\s*반|분반|몇\s*반|^반$/.test(String(h))?i:-1).filter(i=>i>=0);
 if(classCols.length!==1)throw Error('반 열을 하나로 확인하지 못했습니다. 이 원본은 포함하지 않았습니다.');
 const nameCols=headers.map((h,i)=>/성함|성명|이름/.test(String(h))&&!/강사/.test(String(h))?i:-1).filter(i=>i>=0),phoneCols=headers.map((h,i)=>/전화|연락처|휴대폰|핸드폰|phone|mobile/i.test(String(h))?i:-1).filter(i=>i>=0);
 const allowed=new Set(contexts.map(c=>String(c.classId))),matchers=new Map(),rows=[],review=[];let outside=0;
 for(const cid of allowed){const list=identities[cid]||[];matchers.set(cid,createSurveyIdentityMatcher(list.map((s,i)=>({id:String(i),name:s.name})),list));}
 for(const record of raw.rows){
  const values=record.values,cid=classNumber(values[classCols[0]]);
  if(!cid){review.push([title,record.rowNumber,'반 확인 필요 · 원본에서 확인']);continue;}
  if(!allowed.has(cid)){outside++;continue;}
  const clean=keep.map(i=>withoutContacts(values[i]??''));
  if(nameCols.length===1){const ni=nameCols[0],match=matchers.get(cid)({name:values[ni],phoneLast4:phoneCols.length===1?phoneLast4(values[phoneCols[0]]):''});if(match.target)clean[keep.indexOf(ni)]=match.target.name;else if(match.candidates.length>1)review.push([title,record.rowNumber,`${cid}반 ${withoutContacts(values[ni])} · 동명이인 구분 확인 필요`]);}
  rows.push(clean);
 }
 return {headers:keep.map(i=>withoutContacts(headers[i]||`제목 없는 ${i+1}열`)),rows,review,outside,removed:width-keep.length};
}
export async function collectSurveyRaw({reader,catalog,classes,readSchedule,readIdentities,config={},from='2026-07-27',to=koreaToday(),today=koreaToday(),signal,onProgress=()=>{}}){
 const schedules={},identities={},failures=[],review=[['설문','원본 행','확인 사항']],audit=[['기준','설문 실시일 · 포털 지정일 우선, 없으면 시간표 강의 종료일'],['기간',from,to],['응답','해당 기간에 실시한 반의 원본 응답 전체 · 늦은 제출 및 중복 포함'],['개인정보','전화번호·이메일 열 제거. 동명이인 끝 4자리는 내부 대조 후 구분된 이름만 출력'],['점수','원본 5점·10점 유지, 환산 없음'],[],['설문','반','실시일','결과','포함 행']];
 for(const c of classes){signal?.throwIfAborted();onProgress(`${c.id}반 설문 일정 확인 중…`);try{schedules[c.id]=await readSchedule(String(c.id));if(!schedules[c.id])throw Error('공개 시간표 없음');}catch(e){signal?.throwIfAborted();failures.push([c.id+'반 시간표',withoutContacts(e.message)]);}}
 const available=classes.filter(c=>schedules[c.id]),allContexts=conductedContexts(catalog,available,schedules,config),contexts=allContexts.filter(c=>c.date>=from&&c.date<=to&&c.date<=today),bySource=new Map();
 for(const cls of available)for(const event of eventsForClass(catalog,String(cls.id),schedules[cls.id].entries||[])){
  const date=config.events?.[event.id]?.date||event.date,candidates=sourceCandidates(event,catalog.responseSources,cls.course),configured=catalog.responseSources.some(s=>s.id===config.events?.[event.id]?.sourceId);
  if(date>=from&&date<=to&&date<=today&&!configured&&candidates.length!==1)failures.push([`${cls.id}반 ${event.title} · ${date}`,'응답 원본 연결을 하나로 확인하지 못함']);
 }
 for(const c of contexts){const source=catalog.responseSources.find(s=>s.id===c.sourceId);try{const key=rawSourceKey(source.sheetUrl);if(!bySource.has(key))bySource.set(key,{source,contexts:[]});bySource.get(key).contexts.push(c);}catch(e){failures.push([source?.title||c.sourceId,withoutContacts(e.message)]);}}
 for(const cid of new Set(contexts.map(c=>c.classId))){signal?.throwIfAborted();try{identities[cid]=await readIdentities(cid);}catch(e){signal?.throwIfAborted();failures.push([cid+'반 동명이인 정보','구분 정보 조회 실패 · 이름은 원문 유지']);}}
 const blocks=[];let count=0;
 for(const {source,contexts:cs} of bySource.values()){
  signal?.throwIfAborted();onProgress(`${source.title} 원본 읽는 중…`);
  try{const raw=await reader.raw(source.sheetUrl,{signal});signal?.throwIfAborted();const block=rawSurveyBlock(raw,{title:source.title,contexts:cs,identities});
   const titles=[...new Set(cs.map(c=>c.title))],groupTitle=titles.length===1?titles[0]:source.title;
   blocks.push({...block,title:source.title,groupTitle,key:lessonToken(groupTitle),contexts:cs});count+=block.rows.length;for(const row of block.review)review.push(row);
   for(const c of cs)audit.push([source.title,c.classId+'반',c.date,`완료 · 연락처 ${block.removed}열 제외`,block.rows.length]);
  }catch(e){signal?.throwIfAborted();failures.push([source.title,withoutContacts(e.message)]);}
 }
 blocks.sort((a,b)=>a.key.localeCompare(b.key,'ko')||a.title.localeCompare(b.title,'ko'));
 const combined=[['만족도 RAW · 설문별 원본 문항'],['설문 실시 기간',from,to],[]];let last='';
 for(const b of blocks){if(last!==b.key){combined.push([withoutContacts(b.groupTitle)]);last=b.key;}combined.push(['설문',withoutContacts(b.title)],['실시 반·날짜',[...new Set(b.contexts.map(c=>c.classId+'반 '+c.date))].join(' / ')],b.headers);for(const row of b.rows)combined.push(row);combined.push([]);}
 for(const f of failures)audit.push([f[0],'','','실패 · '+f[1]]);audit.push(['합계',`${blocks.length}개 원본`,`${count}응답`,`${failures.length}건 확인 필요`]);
 return {tables:[['만족도 RAW',combined],['확인 필요',review],['수집내역',audit]],count,failed:failures.length,sourceCount:blocks.length};
}
