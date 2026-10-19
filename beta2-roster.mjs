// 2기 교육생 상태(관리자, 사용자 요청 2026-10-19 ⑦): 교육생별 상태(재학·중도탈락·조기취업·수료)·마지막 출석일·사유를 포털에서 고칩니다.
// 원본은 마스터시트 명부 D(상태)·E(상태 변경일 = 마지막 출석일)·I(상태 사유), Apps Script b2RosterStatus(관리자만, 그 반 출결판도 다시 그림).
// 재학이 아니면 마지막 출석일 다음 교육일부터 출결대조·출결 현황·출석률에서 빠집니다(beta2-core enrolledOn). 저장 뒤에는 2기 화면이 들고 있던 묶음을 비우고 다시 읽습니다.
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {forgetBeta2Cache} from './beta2-data.mjs';
import {ROSTER_STATUS,checkRosterStatus} from './beta2-core.mjs';
import {COURSE_START,COURSE_END} from './cohort.mjs';

const VIEWS=[['all','전체'],['in','재학'],['out','재학 아님']];
const TONE={'재학':'','중도탈락':'t-absent','조기취업':'t-rec','수료':'e-ok'};
const STYLE=`.b2r .b2r-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(150px,1.2fr) 130px 150px minmax(150px,1.4fr) auto;gap:6px 12px;align-items:end;padding:10px 14px;border-top:1px solid var(--b2-line);font-size:13px}
.b2r .b2r-row.dirty{background:#fffbeb}.b2r .b2r-row.saving{opacity:.6}.b2r .b2r-now{align-self:center}.b2r .b2r-act{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
@media(max-width:820px){.b2r .b2r-row{grid-template-columns:1fr 1fr}.b2r .b2r-now,.b2r .b2r-why,.b2r .b2r-act{grid-column:1/-1}.b2r .b2r-act{align-items:flex-start}.b2r .b2-toolbar .b2-field{flex:1 1 140px}}`;
const now=s=>s||'재학';

export async function mount(host,{client,classes,selected,context}){
 const life=lifecycle(host);
 let cls=String(context?.classId||selected||'1'),view='all',search='',bundle=null,err='',seq=0;
 const edits=new Map(); // '반|이름' → {status,changed,reason,err,saving}
 host.innerHTML=`<div class="b2 b2r"><style>${STYLE}</style><div class="b2-head"><div><h2>교육생 상태</h2><p>교육생별 상태(재학·중도탈락·조기취업·수료)를 바꿉니다. 저장하면 마스터시트 명부(상태·상태 변경일·상태 사유)에 바로 적히고 그 반 출결판도 다시 그려집니다.</p></div></div>
 <div class="b2-note" style="margin-bottom:12px">재학이 아니면 마지막 출석일을 꼭 넣어 주세요. 그다음 교육일부터 출결대조·출결 현황·출석률 계산에서 빠집니다. 재학으로 되돌리면 마지막 출석일은 지워집니다.</div>
 <section class="b2-card"><div class="b2-toolbar"><label class="b2-field">반<select id="r2Class">${classOptions(classes,cls,{all:true})}</select></label><div class="b2-chips" id="r2Views"></div>
  <label class="b2-field">이름 찾기<input id="r2Search" autocomplete="off" placeholder="이름"></label><span class="b2-grow"></span><button class="b2-btn" id="r2Reload">새로고침</button></div>
  <div id="r2List">${loading('명부를 불러오는 중…')}</div></section></div>`;
 const $=s=>host.querySelector(s);
 const keyOf=p=>`${p.cls}|${p.name}`;
 const people=()=>(bundle?.roster||[]).filter(p=>cls==='all'||p.cls===cls);
 const person=key=>people().find(p=>keyOf(p)===key)||null;
 const valuesOf=p=>{const e=edits.get(keyOf(p));return {status:e?.status??(ROSTER_STATUS.includes(now(p.status))?now(p.status):''),changed:e?.changed??p.changed??'',reason:e?.reason??p.reason??''};};
 // 바뀐 것이 있는지: 상태·마지막 출석일(재학이면 비움)·사유 중 하나라도 시트 값과 다르면
 const dirty=p=>{const v=valuesOf(p),c=v.status==='재학'?'':v.changed;return !!edits.get(keyOf(p))&&(v.status!==now(p.status)||c!==(now(p.status)==='재학'?'':p.changed||'')||v.reason.trim()!==(p.reason||'').trim());};
 function rowHtml(p){
  const key=keyOf(p),e=edits.get(key)||{},v=valuesOf(p),out=v.status!=='재학',n=esc(p.name),st=now(p.status);
  return `<div class="b2r-row ${dirty(p)?'dirty':''} ${e.saving?'saving':''}" data-key="${esc(key)}"><div class="b2r-now"><span class="b2-name">${n}</span><span class="b2-sub">${esc(p.cls)}반</span></div>
   <div class="b2r-now"><span class="b2-small b2-muted">현재</span> <span class="b2-badge ${TONE[st]??'t-late'}">${esc(st)}</span>${p.changed&&st!=='재학'?`<span class="b2-sub">마지막 출석 ${esc(md(p.changed))}</span>`:''}${p.reason?`<span class="b2-sub">사유: ${esc(p.reason)}</span>`:''}</div>
   <label class="b2-field">바꿀 상태<select data-e="status" aria-label="${n} 바꿀 상태" ${e.saving?'disabled':''}>${ROSTER_STATUS.includes(st)?'':`<option value="" selected disabled>상태 선택 (지금: ${esc(st)})</option>`}${ROSTER_STATUS.map(s=>`<option value="${s}" ${s===v.status?'selected':''}>${s}</option>`).join('')}</select></label>
   <label class="b2-field">마지막 출석일${out?' (필수)':''}<input type="date" data-e="changed" aria-label="${n} 마지막 출석일" min="${COURSE_START}" max="${COURSE_END}" value="${esc(out?v.changed:'')}" ${out&&!e.saving?'':'disabled'}></label>
   <label class="b2-field b2r-why">사유<input data-e="reason" aria-label="${n} 상태 사유" maxlength="200" placeholder="예: 11/20 취업으로 조기취업" value="${esc(v.reason)}" ${e.saving?'disabled':''}></label>
   <div class="b2r-act"><span class="b2-err" data-err>${esc(e.err||'')}</span><button class="b2-btn small primary" data-save ${dirty(p)&&!e.saving?'':'disabled'}>${e.saving?'저장 중…':'저장'}</button></div></div>`;
 }
 function render(){
  if(!life.alive())return;
  const all=people(),count=k=>all.filter(p=>k==='all'||(k==='in')===(now(p.status)==='재학')).length;
  $('#r2Views').innerHTML=VIEWS.map(([k,l])=>`<button class="b2-chip" data-view="${k}" aria-pressed="${view===k}">${l}<span class="n">${bundle?count(k):''}</span></button>`).join('');
  if(!bundle){$('#r2List').innerHTML=err?`<div style="padding:0 14px 14px">${errorBox(err)}</div>`:loading('명부를 불러오는 중…');return;}
  const list=all.filter(p=>edits.has(keyOf(p))||((view==='all'||(view==='in')===(now(p.status)==='재학'))&&(!search||p.name.includes(search)))).sort((a,b)=>Number(a.cls)-Number(b.cls));
  $('#r2List').innerHTML=list.length?list.map(rowHtml).join(''):`<div class="b2-muted b2-pad">${all.length?'조건에 맞는 교육생이 없습니다.':'명부에 이 반 교육생이 없습니다. 마스터시트 명부를 먼저 채워 주세요.'}</div>`;
 }
 // 한 줄만 다시 그립니다(입력 중인 칸이 있으면 그 칸의 포커스를 되살림).
 function paintRow(key){
  const el=host.querySelector(`.b2r-row[data-key="${CSS.escape(key)}"]`),p=person(key);if(!el||!p)return render();
  const a=document.activeElement,sel=el.contains(a)&&a.dataset.e?`[data-e="${a.dataset.e}"]`:null;
  const tmp=document.createElement('div');tmp.innerHTML=rowHtml(p);const next=tmp.firstElementChild;el.replaceWith(next);
  if(sel){const n=next.querySelector(sel);if(n&&!n.disabled)n.focus();}
 }
 async function load({fresh=false,quiet=false}={}){
  const n=++seq;if(!quiet){bundle=null;err='';render();}
  try{const b=await client.bundle(cls,{fresh});if(n!==seq||!life.alive())return;bundle=b;err='';}
  catch(e){if(n!==seq||!life.alive())return;err=e;if(!quiet)bundle=null;}
  render();
 }
 async function save(key){
  const p=person(key),e=edits.get(key);if(!p||!e||e.saving)return;
  const v=valuesOf(p),f={status:v.status,changed:v.status==='재학'?'':v.changed,reason:v.reason.trim()};
  e.err=checkRosterStatus(f);if(e.err){paintRow(key);return;}
  if(f.status!=='재학'&&!confirm(`${p.cls}반 ${p.name} 학생을 「${f.status}」(으)로 바꿀까요?\n마지막 출석일 ${md(f.changed)} 다음 교육일부터 출결대조·출결 현황·출석률 계산에서 빠집니다.`))return;
  e.saving=true;paintRow(key);
  try{
   const res=await client.call('b2RosterStatus',{cls:p.cls,name:p.name,...f});
   edits.delete(key);Object.assign(p,{status:res?.status||f.status,changed:res?.changed??f.changed,reason:f.reason});
   toast(`${p.cls}반 ${p.name} · ${now(p.status)}${p.changed?` (마지막 출석 ${md(p.changed)})`:''} 저장했습니다.`);
   forgetBeta2Cache();render();await load({fresh:true,quiet:true}); // 출결 화면이 들고 있던 묶음(재학 기간 계산)도 새로 읽게
  }catch(x){e.saving=false;e.err=`저장하지 못했습니다: ${x.message}`;if(life.alive())paintRow(key);}
 }
 const edit=(t,key)=>{const p=person(key);if(!p)return null;if(!edits.has(key))edits.set(key,{...valuesOf(p),err:''});const e=edits.get(key);e[t.dataset.e]=t.value;e.err='';return e;};
 host.addEventListener('input',ev=>{const t=ev.target,key=t.closest('[data-key]')?.dataset.key;if(!key||!t.dataset.e||t.dataset.e==='status')return;edit(t,key);
  const row=t.closest('.b2r-row'),p=person(key);row.classList.toggle('dirty',dirty(p));row.querySelector('[data-save]').disabled=!dirty(p);row.querySelector('[data-err]').textContent='';});
 host.addEventListener('change',ev=>{const t=ev.target,key=t.closest('[data-key]')?.dataset.key;if(!key||t.dataset.e!=='status')return;edit(t,key);paintRow(key);});
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t||t.disabled)return;
  if(t.dataset.view){view=t.dataset.view;render();return;}
  const key=t.closest('[data-key]')?.dataset.key;if(key&&t.hasAttribute('data-save'))void save(key);
 });
 host.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.matches?.('.b2r-row input')){const key=ev.target.closest('[data-key]').dataset.key;ev.preventDefault();void save(key);}});
 const unsaved=()=>[...edits.keys()].filter(k=>{const p=person(k);return p&&dirty(p);}).length;
 $('#r2Class').onchange=ev=>{if(unsaved()&&!confirm(`저장하지 않은 상태 변경 ${unsaved()}건이 있습니다. 반을 바꾸면 사라집니다. 바꿀까요?`)){ev.target.value=cls;return;}edits.clear();cls=ev.target.value;void load();};
 $('#r2Search').oninput=ev=>{search=ev.target.value.trim();render();};
 $('#r2Reload').onclick=()=>{if(unsaved()&&!confirm(`저장하지 않은 상태 변경 ${unsaved()}건이 있습니다. 새로 읽으면 사라집니다. 계속할까요?`))return;edits.clear();void load({fresh:true});};
 await load();
 return {dispose:()=>life.dispose(),canLeave:()=>{const n=unsaved();return !n||confirm(`저장하지 않은 상태 변경 ${n}건이 있습니다. 화면을 떠날까요?`);}};
}
