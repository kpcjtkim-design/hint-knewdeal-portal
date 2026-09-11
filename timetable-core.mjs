export const COLLECTIONS={draft:'timetableBetaDrafts',published:'timetableBetaPublished',instructors:'timetableBetaInstructors'};
export const todayKST=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
export const sortEntries=entries=>[...entries].sort((a,b)=>a.date.localeCompare(b.date)||(a.start||'99:99').localeCompare(b.start||'99:99')||a.id.localeCompare(b.id));
export function weekDays(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setUTCDate(d.getUTCDate()+i);return x.toISOString().slice(0,10);});}
export function monthDays(date){const first=date.slice(0,7)+'-01',start=weekDays(first)[0],d=new Date(start+'T12:00:00Z');return Array.from({length:42},(_,i)=>{const x=new Date(d);x.setUTCDate(d.getUTCDate()+i);return x.toISOString().slice(0,10);});}
export function validateEntry(e){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)!==e.date)throw Error('교육일자를 확인해 주세요.');
 if(!e.title?.trim()||!e.course?.trim()||!e.module?.trim())throw Error('과정·모듈·강의를 선택해 주세요.');
 if(e.kind!=='holiday'&&(!Number.isInteger(e.day)||e.day<1||e.day>100))throw Error('강의 일차는 1~100으로 입력해 주세요.');
 if(Boolean(e.start)!==Boolean(e.end))throw Error('시작·종료 시간을 함께 입력해 주세요.');
 if(e.start&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.end)||e.start>=e.end))throw Error('수업 시작·종료 시간을 확인해 주세요.');
 if(!Number.isFinite(e.hours)||e.hours<0||e.hours>24)throw Error('교육시간은 0~24시간으로 입력해 주세요.');
 for(const k of ['title','course','module','venue','note'])if(String(e[k]||'').length>1000)throw Error('입력 내용이 너무 깁니다.');
 return e;
}
export function conflicts(entry,classes,classId){
 if(!entry.instructorId||entry.kind==='holiday')return [];
 return Object.entries(classes).flatMap(([cid,data])=>(data.entries||[]).filter(e=>e.id!==entry.id||cid!==classId).filter(e=>e.kind!=='holiday'&&e.date===entry.date&&e.instructorId===entry.instructorId&&(!e.start||!entry.start||(e.start<entry.end&&entry.start<e.end))).map(e=>({classId:cid,date:e.date,title:e.title,start:e.start,end:e.end})));
}
export function publishEntries(entries,instructors){return sortEntries(entries).map(e=>{const {sourceText,sourceRow,...out}=e;return {...out,instructorName:instructors[e.instructorId]?.name||''};});}
export function visibleToday(entries,today=todayKST()){const sorted=sortEntries(entries);return{today:sorted.filter(e=>e.date===today),next:sorted.find(e=>e.date>today&&e.kind!=='holiday')||null};}
