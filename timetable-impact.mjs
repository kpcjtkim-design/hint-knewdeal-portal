import {lectureEndDays} from './timetable-core.mjs';
import {eventsForClass,eventLessons} from './survey-core.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=['date','start','end','title','lectureId','course','module','day','hours','kind','instructorId','instructorName','venue','note','online'];
const titles={date:'날짜',start:'시작',end:'종료',title:'강의명',lectureId:'강의 연결',course:'과정',module:'모듈',day:'일차',hours:'교육시간',kind:'휴일 구분',instructorId:'강사',instructorName:'강사',venue:'장소',note:'전달사항',online:'수업 방식'};
const endKey=e=>JSON.stringify([e.classId||'',e.course||'',e.lectureId||[e.module||'',e.title?.trim()||'']]);
const dateText=e=>e?`${e.date}${e.start?' '+e.start+'–'+e.end:''}`:'없음';
function differences(before,after){
 const old=new Map(before.map(e=>[e.id,e])),next=new Map(after.map(e=>[e.id,e]));
 return [...new Set([...old.keys(),...next.keys()])].flatMap(id=>{const a=old.get(id),b=next.get(id),changed=fields.filter(k=>(a?.[k]??'')!==(b?.[k]??''));return !a||!b||changed.length?[{id,title:(b||a).title,day:(b||a).day,from:dateText(a),to:dateText(b),kind:!a?'추가':!b?'삭제':'변경',fields:[...new Set(changed.map(k=>titles[k]))]}]:[];});
}
function endings(entries){return new Map(lectureEndDays(entries).map(e=>[endKey(e),{title:e.title,date:e.date}]));}
function surveyDates(catalog,config,cid,entries){
 return new Map(eventsForClass(catalog,cid,entries).map(e=>{const fixed=config.events?.[e.id]?.date,days=entries.filter(x=>e.lessonIds.includes(x.id)).map(x=>x.date).sort();return[e.id,{title:e.title,date:fixed||e.date,fixed:!!fixed,matched:e.scheduleMatched,days:JSON.stringify(days),end:e.scheduleMatched?e.date:''}];}));
}
export function timetableImpact({classId,before=[],after=[],published=[],publicAfter=after,catalog={events:[]},config={},configKnown=true}){
 const changes=differences(before,after),old= endings(before),next=endings(after);
 const ends=[...new Set([...old.keys(),...next.keys()])].flatMap(key=>{const a=old.get(key),b=next.get(key);return a?.date===b?.date?[]:[{title:(b||a).title,from:a?.date||'없음',to:b?.date||'없음'}];});
 const prior=surveyDates(catalog,config,String(classId),before),future=surveyDates(catalog,config,String(classId),after);
 const surveys=[...future].flatMap(([id,b])=>{const a=prior.get(id);if(a?.date===b.date&&a?.days===b.days&&a?.matched===b.matched)return[];return[{id,title:b.title,from:configKnown?a?.date||'없음':'확인 필요',to:configKnown?b.date:'확인 필요',fixed:b.fixed,matched:b.matched,end:b.end,needsReview:!b.matched,datesChanged:a?.days!==b.days}];});
 const scoped=(catalog.events||[]).filter(e=>e.classId===String(classId)),unmapped=[...new Set(ends.filter(e=>!scoped.some(s=>eventLessons(s,[...before,...after].filter(x=>x.title===e.title)).length)).map(e=>e.title))];
 return{classId:String(classId),changes,ends,surveys,unmapped,teacherChanges:differences(published,publicAfter).length,configKnown};
}
export function timetableImpactHtml(impacts,{operation='draft',note=''}={}){
 const rows=impacts.filter(p=>p.changes.length||p.teacherChanges),count=rows.reduce((n,p)=>n+p.changes.length,0),teacherCount=rows.reduce((n,p)=>n+p.teacherChanges,0);
 const table=(headers,body)=>`<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;text-align:left;font-size:12px"><thead><tr>${headers.map(h=>`<th style="padding:7px;border-bottom:1px solid #cbd8e8">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
 const cells=values=>`<tr>${values.map(v=>`<td style="padding:7px;border-bottom:1px solid #e2e8f0;vertical-align:top">${v}</td>`).join('')}</tr>`;
 return `<section class="card timetable-impact" aria-label="시간표 변경 확인" style="margin:12px 0;background:#f7fafc"><h3>시간표 변경 확인</h3><p>${operation==='publish'?`공개하면 담임의 오늘의 수업·전체 시간표에 ${teacherCount}개 변경이 반영됩니다.`:'편집본 저장 단계입니다. 담임 화면과 만족도조사 기준은 공개하기 전까지 그대로 유지됩니다.'}</p>${note?`<p class="muted">${esc(note)}</p>`:''}${rows.length?`<p class="muted">${rows.length}개 반 · ${count}개 일정 변경${operation==='draft'?` · 이후 공개 시 담임 화면 ${teacherCount}개 일정 반영`:''}</p>`:'<p class="muted">현재 비교할 일정 변경이 없습니다.</p>'}${rows.map(p=>`<details ${rows.length===1?'open':''}><summary style="cursor:pointer;font-weight:700;padding:8px 0">${esc(p.classId)}반 · 일정 ${p.changes.length}건 · 강의 종료일 ${p.ends.length}건 · 설문 ${p.surveys.length}건</summary>${p.changes.length?table(['수업','기존','변경'],p.changes.map(r=>cells([`${esc(r.title)}${r.day?' · '+esc(r.day)+'일차':''}<br><small>${esc(r.kind)} · ${esc(r.fields.join(', '))}</small>`,esc(r.from),esc(r.to)])).join('')):'<p class="muted">저장된 편집본의 날짜 변경은 없습니다.</p>'}${p.ends.length?`<h4>개별 강의 마지막 날 · 만족도조사 알림</h4>${table(['강의','기존 종료일','변경 종료일'],p.ends.map(r=>cells([esc(r.title),esc(r.from),esc(r.to)])).join(''))}`:'<p class="muted">개별 강의 마지막 날은 유지됩니다.</p>'}${!p.configKnown?'<p class="dirty">설문 설정을 읽지 못했습니다. 별도 지정일 여부는 만족도조사에서 확인해 주세요.</p>':''}${p.surveys.length?`<h4>만족도조사 기준일</h4>${table(['설문','기존 → 공개 후','확인사항'],p.surveys.map(r=>cells([esc(r.title),`${esc(r.from)} → ${esc(r.to)}`,r.fixed?'별도 지정일 유지 · 자동 변경하지 않음':r.needsReview?'강의 연결 확인 필요 · 기존 설문 기준일 유지':'변경된 강의 마지막 날 적용'])).join(''))}<p class="muted">교육일이 바뀐 설문은 공개 후 응답 동기화 시 참여 대상을 다시 대조합니다. 기존 응답 원본과 별도 지정한 날짜는 변경하지 않습니다.</p>`:'<p class="muted">연결된 설문의 기준일·대상 교육일은 유지됩니다.</p>'}</details>`).join('')}${impacts.flatMap(p=>(p.unmapped||[]).map(title=>`<p class="muted">${esc(p.classId)}반 · ${esc(title)}: 연결된 설문을 찾지 못했습니다. 만족도조사에서 연결을 확인해 주세요.</p>`)).join('')}</section>`;
}
