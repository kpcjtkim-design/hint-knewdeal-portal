// 시간표 관리 › 식비(사용자 2026-10-22, 관리자만): 반 × 교육일 표에서 칸을 눌러 O(식비 있음) → X(없음) → 빈칸(미정)으로 바꾸고 「저장」.
// 머리 날짜를 누르면 그날 16개 반을, 반 이름 옆 「이 달 O」를 누르면 그 반 이 달 빈칸을 한꺼번에 채웁니다. CSV로 반별 식비 일수를 내려받습니다.
// 저장은 바꾼 칸만(was 확인, meal-core applyMealChanges): 그사이 다른 관리자가 같은 칸을 바꿨으면 그 칸만 건너뛰고 알려 줍니다.
import {doc,getDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {TRAINING_DAYS,mdLabel} from './cohort.mjs';
import {cleanPlan,mealOf,nextMeal,mealLabel,applyMealChanges,mealCounts} from './meal-core.mjs';
const ref=db=>doc(db,'settings','mealPlan');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DOW=['일','월','화','수','목','금','토'],dow=d=>DOW[new Date(d+'T12:00:00Z').getUTCDay()];
const CSS=`.ml{font-size:13px;color:#0f172a}.ml .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}.ml .grow{flex:1}
.ml button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:6px 12px}.ml button.primary{background:#1F4E8C;color:#fff;border-color:#1F4E8C;font-weight:800}.ml button:disabled{opacity:.5;cursor:default}
.ml select{font:inherit;padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px}.ml .wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:10px;background:#fff;max-height:70vh}
.ml table{border-collapse:separate;border-spacing:0;min-width:100%}.ml th,.ml td{border-bottom:1px solid #eef2f7;border-right:1px solid #eef2f7;padding:0;text-align:center;white-space:nowrap}
.ml thead th{position:sticky;top:0;background:#f8fafc;z-index:2;font-weight:700;padding:5px 4px;font-size:11px}.ml thead th button{border:0;background:transparent;padding:2px 4px;font-size:11px;line-height:1.3}
.ml tbody th{position:sticky;left:0;background:#fff;z-index:1;text-align:left;padding:4px 8px;font-weight:700;font-size:12px}.ml tbody th small{display:block;font-weight:500;color:#64748b}
.ml td button.c{border:0;border-radius:0;width:34px;height:30px;padding:0;font-weight:900;background:#fff;color:#94a3b8}.ml td button.c.O{background:#e7f6ec;color:#188038}.ml td button.c.X{background:#fdecea;color:#b42318}
.ml td button.c.dirty{outline:2px solid #e37400;outline-offset:-2px}.ml td.sum{padding:4px 8px;font-size:12px;color:#334155;background:#fafbfc}.ml .note{color:#64748b;font-size:12px;margin:8px 0 0}.ml .msg{margin:0 0 8px;padding:8px 10px;border-radius:8px;background:#eff6ff}.ml .msg.err{background:#fdecea;color:#8c1d18}
.ml .hol{color:#b42318}`;
export function mountMeals(host,{db,user,classes}){
 const months=[...new Set(TRAINING_DAYS.map(d=>d.slice(0,7)))];
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()).slice(0,7);
 let month=months.includes(today)?today:months[0],base={plan:{},rev:0,updatedBy:'',updatedAt:null},pending=new Map(),msg=null,busy=false,loaded=false,disposed=false;
 const el=document.createElement('div');el.className='ml';host.append(el);
 const key=(c,d)=>`${c}|${d}`,value=(c,d)=>pending.has(key(c,d))?pending.get(key(c,d)):mealOf(base.plan,c,d);
 const set=(c,d,v)=>{const was=mealOf(base.plan,c,d);if(v===was)pending.delete(key(c,d));else pending.set(key(c,d),v);};
 async function load(){
  try{const s=await getDoc(ref(db)),x=s.exists()?s.data():{};base={plan:cleanPlan(x.plan),rev:Number.isInteger(x.rev)?x.rev:0,updatedBy:String(x.updatedBy||''),updatedAt:x.updatedAt?.toDate?.()?.toISOString?.()||null};}
  catch(e){msg={text:`식비 저장본을 읽지 못했습니다 · ${e.message||e}`,err:true};}
  loaded=true;paint();
 }
 async function save(){
  if(busy||!pending.size)return;busy=true;paint();
  const changes=[...pending].map(([k,v])=>{const [cls,date]=k.split('|');return {cls,date,was:mealOf(base.plan,cls,date),value:v};});
  try{
   const r=await runTransaction(db,async tx=>{
    const s=await tx.get(ref(db)),x=s.exists()?s.data():{},cur=Number.isInteger(x.rev)?x.rev:0,res=applyMealChanges(x.plan,changes);
    if(res.applied.length)tx.set(ref(db),{plan:res.plan,rev:cur+1,updatedBy:String(user?.email||''),updatedAt:serverTimestamp()});
    return res;
   });
   pending.clear();await load();
   msg=r.conflicts.length?{text:`${r.applied.length}칸 저장 · ${r.conflicts.length}칸은 그사이 다른 관리자가 바꿔 건너뛰었습니다(${r.conflicts.slice(0,5).map(c=>`${c.cls}반 ${mdLabel(c.date)} ${mealLabel(c.now)}`).join(', ')}). 표는 최신 저장본입니다.`,err:true}:{text:`${r.applied.length}칸 저장했습니다.`};
  }catch(e){msg={text:`저장하지 못했습니다 · ${e.message||e} (바꾼 칸은 그대로 남아 있습니다)`,err:true};}
  busy=false;paint();
 }
 function csv(){
  const head=['반',...TRAINING_DAYS,'식비 있음','식비 없음','미정'],rows=classes.map(c=>{const n=mealCounts(base.plan,c.id,TRAINING_DAYS);return [`${c.id}반`,...TRAINING_DAYS.map(d=>mealOf(base.plan,c.id,d)),n.O,n.X,n['']];});
  const text='﻿'+[head,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download='HINT2기_식비.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 }
 function paint(){
  if(disposed)return;
  if(!loaded){el.innerHTML='<style>'+CSS+'</style><p>식비 표를 불러오는 중…</p>';return;}
  const days=TRAINING_DAYS.filter(d=>d.startsWith(month)),when=base.updatedAt?new Date(base.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
  el.innerHTML=`<style>${CSS}</style>${msg?`<div class="msg ${msg.err?'err':''}" role="status">${esc(msg.text)}</div>`:''}
  <div class="bar"><label>달 <select data-month>${months.map(m=>`<option value="${m}" ${m===month?'selected':''}>${+m.slice(5)}월</option>`).join('')}</select></label>
  <button data-fill-month>이 달 빈칸 모두 O</button><span class="grow"></span>
  <span>${base.rev?`저장본 ${base.rev}번 · ${esc(base.updatedBy)}${when?` · ${esc(when)}`:''}`:'저장본 없음'}</span>
  <button data-undo ${pending.size&&!busy?'':'disabled'}>바꾼 칸 되돌리기</button><button data-csv>CSV 내려받기</button><button class="primary" data-save ${pending.size&&!busy?'':'disabled'}>${busy?'저장 중…':`저장${pending.size?` (${pending.size}칸)`:''}`}</button></div>
  <div class="wrap"><table><thead><tr><th>반</th>${days.map(d=>`<th><button data-col="${d}" title="${esc(mdLabel(d))} 16개 반 한꺼번에 바꾸기">${+d.slice(5,7)}/${+d.slice(8)}<br>${dow(d)}</button></th>`).join('')}<th>이 달 O·X·미정</th><th>전체 O</th></tr></thead>
  <tbody>${classes.map(c=>{const m=mealCounts({[c.id]:Object.fromEntries(days.map(d=>[d,value(c.id,d)]))},c.id,days),all=TRAINING_DAYS.filter(d=>value(c.id,d)==='O').length;
   return `<tr><th>${esc(c.id)}반 <button data-row="${esc(c.id)}" style="padding:1px 6px;font-size:11px">이 달 O</button><small>${esc(c.course||'')} · ${esc(c.venue||'')}</small></th>${days.map(d=>{const v=value(c.id,d),dirty=pending.has(key(c.id,d));return `<td><button class="c ${v}${dirty?' dirty':''}" data-cell="${esc(c.id)}|${d}" title="${esc(`${c.id}반 ${mdLabel(d)}: ${mealLabel(v)}`)}${dirty?' (저장 전)':''}" aria-label="${esc(`${c.id}반 ${mdLabel(d)} ${mealLabel(v)}`)}">${v||'·'}</button></td>`;}).join('')}<td class="sum">${m.O} · ${m.X} · ${m['']}</td><td class="sum"><b>${all}</b>/${TRAINING_DAYS.length}일</td></tr>`;}).join('')}</tbody></table></div>
  <p class="note">칸을 누를 때마다 O(식비 있음) → X(없음) → ·(미정)으로 바뀝니다. 주황 테두리는 저장 전 칸입니다. 교육일(주말·공휴일 뺀 날)만 보입니다. 담임 화면에는 보이지 않습니다.</p>`;
  const $=s=>el.querySelector(s);
  $('[data-month]').onchange=e=>{month=e.target.value;msg=null;paint();};
  $('[data-save]').onclick=()=>void save();$('[data-csv]').onclick=csv;
  $('[data-undo]').onclick=()=>{pending.clear();msg=null;paint();};
  $('[data-fill-month]').onclick=()=>{for(const c of classes)for(const d of days)if(!value(c.id,d))set(c.id,d,'O');msg=null;paint();};
  el.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [c,d]=b.dataset.cell.split('|');set(c,d,nextMeal(value(c,d)));paint();});
  el.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{const d=b.dataset.col,v=nextMeal(value(classes[0]?.id,d));for(const c of classes)set(c.id,d,v);paint();});
  el.querySelectorAll('[data-row]').forEach(b=>b.onclick=()=>{const c=b.dataset.row;for(const d of days)if(!value(c,d))set(c,d,'O');paint();});
 }
 paint();void load();
 return {el,dirty:()=>pending.size>0,dispose(){disposed=true;el.remove();}};
}
