import {weekDays,monthDays,sortEntries,validateEntry,todayKST,lectureEndDays} from './timetable-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekday=d=>new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',weekday:'short'}).format(new Date(d+'T12:00:00Z'));
export function moveLesson(entries,id,date,swapId=null){
 const source=entries.find(e=>e.id===id),target=swapId&&entries.find(e=>e.id===swapId);
 if(!source||source.kind==='holiday'||(swapId&&!target)||target?.kind==='holiday')throw Error('수업을 선택해 이동해 주세요. 휴일·휴강은 수업 수정에서 변경할 수 있습니다.');
 validateEntry({...source,date});if(source.id===target?.id)return entries;
 if(target&&target.date!==date)throw Error('놓을 날짜가 바뀌었습니다. 다시 이동해 주세요.');
 if(entries.some(e=>e.date===date&&e.kind==='holiday'))throw Error('휴일에는 수업을 넣을 수 없습니다. 휴일 설정을 먼저 확인해 주세요.');
 const ordered=sortEntries(entries.filter(e=>e.kind!=='holiday'));
 const destination=target||ordered.find(e=>e.date===date&&e.id!==id);
 if(!destination)return source.date===date?entries:sortEntries(entries.map(e=>e.id===id?{...e,date}:e));
 const from=ordered.findIndex(e=>e.id===id),to=ordered.findIndex(e=>e.id===destination.id);
 if(from===to)return entries;
 const slots=ordered.map(e=>({date:e.date,start:e.start,end:e.end})),moved=ordered.splice(from,1)[0];ordered.splice(to,0,moved);
 // Insert into the occupied slot and shift the intervening lessons, retaining all IDs.
 const changed=new Map(ordered.map((e,i)=>[e.id,{...e,date:slots[i].date,start:slots[i].start||'',end:slots[i].end||'',order:i}]));
 for(let i=Math.min(from,to);i<=Math.max(from,to);i++){
  const e=ordered[i],slot=slots[i];if(e.start&&e.end&&slot.start&&slot.end){const duration=v=>Number(v.slice(0,2))*60+Number(v.slice(3));if(duration(e.end)-duration(e.start)!==duration(slot.end)-duration(slot.start))throw Error('수업 길이가 다른 시간칸입니다. 세부 수정에서 시간을 확인해 주세요.');}
 }
 return sortEntries(entries.map(e=>changed.get(e.id)||e));
}
export function createTimetableBoard({root,classes,data,lesson,instructors,status,onMove,onError}){
 let current={view:'week',date:todayKST(),shown:classes},drag=null,ignoreClickUntil=0;
 function cells(cid,days,{month='',hideOutside=false}={}){
  const rows=data(cid).entries||[],ends=new Set(lectureEndDays(rows).map(e=>e.id)),byDate=new Map();
  for(const e of sortEntries(rows)){if(!byDate.has(e.date))byDate.set(e.date,[]);byDate.get(e.date).push(e);}
  return days.map(d=>{const outside=month&&d.slice(0,7)!==month,hidden=outside&&hideOutside;
   return `<div class="day-cell ${d===todayKST()?'today':''} ${outside?'outside':''}" ${hidden?'':`data-drop-date="${d}" data-drop-cid="${cid}" aria-label="${cid}반 ${d} 일정 이동 위치"`}><div class="day-num">${d.slice(5).replace('-','/')}</div>${hidden?'':(byDate.get(d)||[]).map(e=>lesson(e,instructors(),true,cid,ends.has(e.id))).join('')+`<button class="add" data-add="${d}" data-cid="${cid}">+ 추가</button>`}</div>`;
  }).join('');
 }
 function calendar(cid){
  const months=current.view==='month'?[current.date.slice(0,7)]:[...new Set((data(cid).entries||[]).map(e=>e.date.slice(0,7)))].sort();
  return (months.length?months:[current.date.slice(0,7)]).map(month=>`<section class="calendar-month"><h4>${month.replace('-','년 ')}월</h4><div class="schedule-scroll calendar-scroll"><div class="month-grid">${['월','화','수','목','금','토','일'].map(d=>`<div class="grid-head">${d}</div>`).join('')}${cells(cid,monthDays(month+'-01'),{month,hideOutside:current.view==='all'})}</div></div></section>`).join('');
 }
 function html(options){
  current={...current,...options};const {shown,view,date}=current;
  if(view==='week'){const days=weekDays(date);return `<div class="schedule-scroll"><div class="admin-grid"><div class="grid-head">반 / 교육일</div>${days.map(d=>`<div class="grid-head">${d.slice(5).replace('-','/')} (${weekday(d)})${d===todayKST()?' · 오늘':''}</div>`).join('')}${shown.map(c=>`<div class="class-label"><b>${c.id}반</b><div class="muted">${esc(c.course)}<br>${esc(c.venue||'')}</div><div class="board-status">${status(c.id)}</div></div>${cells(c.id,days)}`).join('')}</div></div>`;}
  return shown.map((c,i)=>`<details class="calendar-class" data-calendar-class="${c.id}" ${shown.length===1||i===0?'open':''}><summary><b>${c.id}반 · ${esc(c.course)}</b><span>${status(c.id)} · 전체 ${(data(c.id).entries||[]).length}개 일정</span></summary><div data-calendar-content="${c.id}">${shown.length===1||i===0?calendar(c.id):''}</div></details>`).join('');
 }
 const start=e=>{const card=e.target.closest?.('[data-edit]');if(!card)return;const item=data(card.dataset.cid).entries.find(x=>x.id===card.dataset.edit);if(item?.kind==='holiday'){e.preventDefault();return;}drag={cid:card.dataset.cid,id:card.dataset.edit};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-hint-lesson',JSON.stringify(drag));card.classList.add('dragging');};
 const over=e=>{const cell=e.target.closest?.('[data-drop-date]');if(!cell||!drag||cell.dataset.dropCid!==drag.cid)return;e.preventDefault();e.dataTransfer.dropEffect='move';root.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));cell.classList.add('drop-target');};
 const end=()=>{drag=null;ignoreClickUntil=performance.now()+200;root.querySelectorAll('.drop-target,.dragging').forEach(x=>x.classList.remove('drop-target','dragging'));};
 const drop=e=>{const cell=e.target.closest?.('[data-drop-date]');if(!cell||!drag)return;e.preventDefault();const source=drag,card=e.target.closest?.('[data-edit]');end();if(cell.dataset.dropCid!==source.cid){onError('같은 반 안에서 날짜를 옮겨 주세요. 다른 반에 넣으려면 수업 수정의 복사를 사용해 주세요.');return;}try{onMove(source.cid,source.id,cell.dataset.dropDate,card&&card.dataset.edit!==source.id?card.dataset.edit:null);}catch(error){onError(error.message);}};
 const click=e=>{if(e.target.closest?.('[data-edit]')&&performance.now()<ignoreClickUntil){e.preventDefault();e.stopImmediatePropagation();}};
 const toggle=e=>{const el=e.target;if(!el.matches?.('[data-calendar-class]')||!el.open)return;const mount=el.querySelector('[data-calendar-content]');if(!mount.childElementCount)mount.innerHTML=calendar(el.dataset.calendarClass);};
 for(const [event,fn,capture]of [['dragstart',start],['dragover',over],['dragend',end],['drop',drop],['click',click,true],['toggle',toggle,true]])root.addEventListener(event,fn,!!capture);
 return {html,dispose(){for(const [event,fn,capture]of [['dragstart',start],['dragover',over],['dragend',end],['drop',drop],['click',click,true],['toggle',toggle,true]])root.removeEventListener(event,fn,!!capture);}};
}
