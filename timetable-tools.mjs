import {sortEntries,validateEntry,todayKST} from './timetable-core.mjs';
import {differences} from './timetable-impact.mjs';
const isWeekend=d=>[0,6].includes(new Date(d+'T12:00:00Z').getUTCDay());
export const hideWeekend=(days,entries,show=false)=>show||days.some(d=>isWeekend(d)&&entries.some(e=>e.date===d&&e.kind!=='holiday'))?days:days.filter(d=>!isWeekend(d));

// Swap only the dates of two lessons in one class; each keeps its own times.
export function swapLesson(entries,id,otherId){
 const a=entries.find(e=>e.id===id),b=entries.find(e=>e.id===otherId);
 if(!a||!b||a.kind==='holiday'||b.kind==='holiday')throw Error('맞바꿀 수업을 다시 선택해 주세요. 휴일·휴강은 바꿀 수 없습니다.');
 if(a.date===b.date)return entries;
 validateEntry({...a,date:b.date});validateEntry({...b,date:a.date});
 return sortEntries(entries.map(e=>e.id===a.id?{...e,date:b.date}:e.id===b.id?{...e,date:a.date}:e));
}
// Neighbouring lesson on another date, for touch devices without drag and drop.
export function neighbour(entries,id,step){
 const list=sortEntries(entries.filter(e=>e.kind!=='holiday')),i=list.findIndex(e=>e.id===id);if(i<0)return null;
 for(let j=i+step;j>=0&&j<list.length;j+=step)if(list[j].date!==list[i].date)return list[j];
 return null;
}

// Every lesson whose instructor is booked twice at overlapping (or unknown) times, across all classes.
export function conflictMap(classes,instructors={}){
 const groups=new Map(),out=new Map();
 for(const [cid,data]of Object.entries(classes))for(const e of data.entries||[]){if(!e.instructorId||e.kind==='holiday')continue;const k=e.date+'|'+e.instructorId;if(!groups.has(k))groups.set(k,[]);groups.get(k).push({cid,e});}
 for(const rows of groups.values())if(rows.length>1)for(const a of rows){
  const clash=rows.filter(b=>b!==a&&(!a.e.start||!b.e.start||(a.e.start<b.e.end&&b.e.start<a.e.end)));
  if(clash.length)out.set(a.cid+'|'+a.e.id,`${instructors[a.e.instructorId]?.name||'강사'} 일정 겹침 · `+clash.map(b=>`${b.cid}반 ${b.e.title}${b.e.start?' '+b.e.start+'–'+b.e.end:' (시각 미등록)'}`).join(', '));
 }
 return out;
}

export function classProgress(entries,today=todayKST()){
 const days=[...new Set(entries.filter(e=>e.kind!=='holiday').map(e=>e.date))].sort();
 if(!days.length)return null;
 const last=days.at(-1),dday=Math.round((Date.parse(last)-Date.parse(today))/864e5),current=sortEntries(entries).find(e=>e.kind!=='holiday'&&e.date>=today);
 return {done:days.filter(d=>d<=today).length,total:days.length,last,dday,module:current?.module||''};
}
export const progressText=p=>p?`진행 ${p.done}/${p.total}일 · ${p.dday>0?'수료 D-'+p.dday:p.dday===0?'수료일':'교육 종료'}`:'';

// Bulk instructor, venue, time or mode for matching lessons.
export function bulkAssign(entries,{title='',from='',to='',patch={}}){
 let count=0;
 const next=entries.map(e=>{if(e.kind==='holiday'||(title&&e.title!==title)||(from&&e.date<from)||(to&&e.date>to))return e;const out=validateEntry({...e,...patch});count++;return out;});
 return {entries:count?sortEntries(next):entries,count};
}
// Copy one class's lessons in a period to another class, optionally replacing that class's lessons there.
export function copyPeriod(source,target,{from,to,replace=true,course,lectures=[],makeId}){
 if(!from||!to||from>to)throw Error('복사할 기간을 확인해 주세요.');
 const inRange=e=>e.kind!=='holiday'&&e.date>=from&&e.date<=to,picked=source.filter(inRange);
 if(!picked.length)throw Error('원본 반의 선택 기간에 복사할 수업이 없습니다.');
 const holidays=new Set(target.filter(e=>e.kind==='holiday').map(e=>e.date));
 if(picked.some(e=>holidays.has(e.date)))throw Error('대상 반의 휴일에 수업이 들어갑니다. 기간을 다시 확인해 주세요.');
 const copies=picked.map(e=>{const {seedKey,sourceRow,sourceText,...rest}=e,match=course&&course!==e.course?lectures.find(l=>l.course===course&&l.title===e.title):null;return validateEntry({...rest,id:makeId(),course:course||e.course,lectureId:match?match.id:course&&course!==e.course?'':e.lectureId});});
 const removed=replace?target.filter(inRange):[];
 return {entries:sortEntries([...target.filter(e=>!removed.includes(e)),...copies]),added:copies.length,removed:removed.length};
}

// Changes a teacher should notice, kept for two weeks after each publication.
export function recentChanges(before,after,previous=[],today=todayKST(),days=14){
 const limit=new Date(Date.parse(today)-days*864e5).toISOString().slice(0,10),old=new Map(previous.filter(c=>c.at>=limit).map(c=>[c.id,c]));
 for(const c of differences(before,after)){
  const prior=old.get(c.id),from=prior?prior.from:c.from,fields=[...new Set([...(prior?.fields||[]),...c.fields])];
  // A lesson added and removed again, or moved back to its original slot, is no longer news.
  const undone=prior&&(prior.kind==='추가'&&c.kind==='삭제'||prior.kind==='변경'&&c.kind==='변경'&&from===c.to&&fields.every(f=>['날짜','시작','종료'].includes(f)));
  if(undone){old.delete(c.id);continue;}
  old.set(c.id,{id:c.id,title:c.title,day:c.day||0,kind:prior?.kind==='추가'&&c.kind!=='삭제'?'추가':c.kind,from,to:c.to,fields,at:today});
 }
 return [...old.values()].sort((a,b)=>b.at.localeCompare(a.at)||a.to.localeCompare(b.to)).slice(0,100);
}

// RFC 5545 calendar for a teacher's own calendar app.
const icsText=v=>String(v??'').replace(/[\\;,]/g,m=>'\\'+m).replace(/\r?\n/g,'\\n');
const fold=line=>{const out=[];let s=line;while(s.length>60){out.push(s.slice(0,60));s=' '+s.slice(60);}out.push(s);return out.join('\r\n');};
const nextDay=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);};
export function toIcs(entries,{classId,course=''}={},stamp=new Date()){
 const now=stamp.toISOString().replace(/[-:]/g,'').slice(0,15)+'Z',ymd=d=>d.replace(/-/g,'');
 const events=sortEntries(entries).flatMap(e=>{
  const when=e.start?[`DTSTART;TZID=Asia/Seoul:${ymd(e.date)}T${e.start.replace(':','')}00`,`DTEND;TZID=Asia/Seoul:${ymd(e.date)}T${e.end.replace(':','')}00`]:[`DTSTART;VALUE=DATE:${ymd(e.date)}`,`DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`];
  const detail=[e.module,e.online?'비대면':'',e.instructorName?'강사 '+e.instructorName:'',e.note].filter(Boolean).join(' · ');
  return ['BEGIN:VEVENT',`UID:${icsText(e.id)}-${classId}@hint-knewdeal`,`DTSTAMP:${now}`,...when,`SUMMARY:${icsText(e.kind==='holiday'?'휴일 · '+e.title:e.title+(e.day?' · '+e.day+'일차':''))}`,...(e.venue?[`LOCATION:${icsText(e.venue)}`]:[]),...(detail?[`DESCRIPTION:${icsText(detail)}`]:[]),'END:VEVENT'];
 });
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//HINT//Timetable//KO','CALSCALE:GREGORIAN',`X-WR-CALNAME:${icsText(`HINT ${classId}반 ${course}`.trim())}`,'X-WR-TIMEZONE:Asia/Seoul','BEGIN:VTIMEZONE','TZID:Asia/Seoul','BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:+0900','TZOFFSETTO:+0900','TZNAME:KST','END:STANDARD','END:VTIMEZONE',...events,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
