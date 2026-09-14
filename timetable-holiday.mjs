import {sortEntries} from './timetable-core.mjs';
const dateOK=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const next=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);};
export function shiftForHoliday(entries,date,{title='대체휴일',id='holiday-'+date}={}){
 if(!dateOK(date))throw Error('휴일 날짜를 확인해 주세요.');
 if([0,6].includes(new Date(date).getUTCDay()))throw Error('주말은 이미 제외됩니다. 평일을 선택해 주세요.');
 if(entries.some(e=>e.date===date&&e.kind==='holiday'))throw Error('이미 휴일인 날짜입니다. 중복 순연하지 않습니다.');
 const holidays=new Set(entries.filter(e=>e.kind==='holiday').map(e=>e.date));holidays.add(date);
 const targets=entries.filter(e=>e.kind!=='holiday'&&e.date>=date);
 if(!targets.length)throw Error('선택한 날짜 이후 이동할 수업이 없습니다.');
 if(targets.some(e=>[0,6].includes(new Date(e.date).getUTCDay())||holidays.has(e.date)&&e.date!==date))throw Error('이미 주말·휴일에 배정된 수업이 있습니다. 해당 일정을 먼저 확인해 주세요.');
 const map=new Map();for(const d of new Set(targets.map(e=>e.date))){let to=next(d);while([0,6].includes(new Date(to).getUTCDay())||holidays.has(to))to=next(to);map.set(d,to);}
 const moved=entries.map(e=>e.kind==='holiday'||!map.has(e.date)?{...e}:{...e,date:map.get(e.date)});
 moved.push({id,date,title:title.trim()||'대체휴일',course:targets[0].course,module:'휴일',lectureId:'',kind:'holiday',day:0,hours:0,start:'',end:'',instructorId:'',venue:'',note:'대체휴일 설정에 따른 평일 순연',online:false});
 return {entries:sortEntries(moved),changes:targets.map(e=>({id:e.id,title:e.title,from:e.date,to:map.get(e.date)})),lastDate:sortEntries(moved).at(-1).date};
}
