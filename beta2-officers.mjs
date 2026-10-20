// 2기 반 임원(사용자 결정 2026-10-20: 반장·부반장·총무·앰버서더 4역할, 보궐은 최초 선출과 구분, 담임(자기 반)·관리자 모두 고침).
// 원본은 마스터시트 '반 임원' 탭(이력: 반·역할·이름·구분·시작일·종료일·바뀐 사유·메모·등록자·등록시각, 종료일이 비면 지금 임원)과 반정보 Q·R·S·V(지금 임원).
// Apps Script b2Officers(읽기: 지금 임원·이력·보궐 필요) · b2OfficerSave(지정·교체) · b2OfficerEnd(후임 없이 끝내기). 담임은 Vercel이 자기 반으로 고정합니다.
// 관리자: 출결 › 반 임원(전체 반 표 → 반을 고르면 역할별 지정·교체·끝내기와 이력). 담임: 우리 반 탭 맨 위(beta2-teacher-layout.mjs)에서 자기 반만.
// '보궐 필요'는 지금 임원인데 명부 상태가 중도탈락·조기취업(관리자 확인)인 사람입니다(시트가 needs로 줌). 맨 위에 띄우고 「보궐 지정」으로 바로 엽니다.
// 저장할 때 그 역할의 지금 임원 이름(was.name, 비었으면 '')을 함께 보내, 그사이 다른 사람이 바꿨으면 시트가 거절합니다. 그러면 새로 읽고 다시 확인하게 합니다.
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {isTestClass} from './cohort.mjs';

export const ROLES=['반장','부반장','총무','앰버서더'];
export const KINDS=['최초','보궐'];
// 앞 임원이 바뀐 사유(시트 '바뀐 사유'): 고르고 필요하면 자세히 적습니다. 기타는 적은 말만.
export const CHANGE_REASONS=['중도탈락','조기취업','사퇴','기타'];
const STYLE=`.o2 .o2-roles{display:grid;gap:0}.o2 .o2-role{display:grid;grid-template-columns:90px minmax(160px,1fr) auto;gap:6px 12px;align-items:center;padding:10px 14px;border-top:1px solid var(--b2-line)}
.o2 .o2-role:first-child{border-top:0}.o2 .o2-role b{font-size:13px}.o2 .o2-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.o2 .o2-form{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;padding:12px 14px;background:#f0f9ff;border-top:1px solid var(--b2-line)}.o2 .o2-form .o2-title{flex-basis:100%;font-size:13px}
.o2 .o2-needs ul{margin:6px 0 0;padding-left:18px}.o2 .o2-needs li{margin:4px 0}.o2 .o2-cell .b2-badge{margin-left:4px}.o2 .o2-cell .b2-sub{display:block}
.o2 details.o2-hist{border-top:1px solid var(--b2-line)}.o2 details.o2-hist>summary{padding:10px 14px;cursor:pointer;font-size:13px;font-weight:800}
.o2 .o2-cls{margin-bottom:12px}.o2 .o2-cls>header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--b2-line)}
@media(max-width:720px){.o2 .o2-role{grid-template-columns:1fr}.o2 .o2-act{justify-content:flex-start}}`;
const KIND_TONE={'최초':'e-ok','보궐':'t-rec'};
const classLabel=id=>isTestClass(id)?`${id}반 · 테스트반`:`${id}반`;
export const seoulToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ISO=/^\d{4}-\d{2}-\d{2}$/;

// 지금 그 역할을 맡은 사람(없으면 null)
export const currentOf=(data,cls,role)=>data?.current?.[String(cls)]?.[role]||null;
// 구분 추천: 지금 맡은 사람이 있거나 전에 맡았던 기록이 있으면 보궐, 처음이면 최초
export function suggestKind(data,cls,role){
 if(currentOf(data,cls,role))return '보궐';
 return (data?.rows||[]).some(r=>String(r.cls)===String(cls)&&r.role===role)?'보궐':'최초';
}
export function reasonOf(sel,text){
 const t=String(text||'').trim();
 if(sel==='기타')return t||'기타';
 return [sel,t].filter(Boolean).join(' · ');
}
// 시트가 '그사이 바뀌었습니다'로 거절했는지(다시 읽어야 함)
export const isConflict=e=>e?.code==='CONFLICT'||/그사이 바뀌었/.test(String(e?.message||e||''));
// 폼 → b2OfficerSave / b2OfficerEnd 인자
export function savePayload(f){
 const p={cls:String(f.cls),role:f.role,name:String(f.name||'').trim(),kind:f.kind,start:f.start,was:{name:f.was||''}};
 const reason=f.was?reasonOf(f.reasonSel,f.reasonText):'';if(reason)p.reason=reason;
 const note=String(f.note||'').trim();if(note)p.note=note;
 return p;
}
export function endPayload(f){
 const p={cls:String(f.cls),role:f.role,end:f.end,was:{name:f.was||''}};
 const reason=reasonOf(f.reasonSel,f.reasonText);if(reason)p.reason=reason;
 return p;
}
export function checkForm(f,data){
 if(!ROLES.includes(f.role))return '역할을 골라 주세요.';
 if(f.mode==='end'){if(!ISO.test(f.end||''))return '종료일을 넣어 주세요.';const cur=currentOf(data,f.cls,f.role);if(cur?.start&&f.end<cur.start)return `종료일이 시작일(${md(cur.start)})보다 빠릅니다.`;return '';}
 if(!String(f.name||'').trim())return '이름을 골라 주세요.';
 if(!KINDS.includes(f.kind))return '구분(최초·보궐)을 골라 주세요.';
 if(!ISO.test(f.start||''))return '시작일을 넣어 주세요.';
 const cur=currentOf(data,f.cls,f.role);
 if(cur&&cur.name===String(f.name).trim())return `이미 ${f.cls}반 ${f.role}입니다.`;
 if(cur?.start&&f.start<cur.start)return `시작일이 지금 ${f.role}의 시작일(${md(cur.start)})보다 빠릅니다.`;
 return '';
}
const cell=(cur,need)=>cur?`<span class="b2-name">${esc(cur.name)}</span><span class="b2-badge ${KIND_TONE[cur.kind]||''}">${esc(cur.kind||'최초')}</span>${need?'<span class="b2-badge t-absent">보궐 필요</span>':''}${cur.start?`<span class="b2-sub">${esc(md(cur.start))}부터</span>`:''}`:'<span class="b2-muted">없음</span>';

// teacherClass가 있으면 담임 모드(그 반만, 반 고르기 없음). open: 관리자 화면 이동(없어도 됨).
export async function mount(host,{client,classes=[],selected,context,teacherClass=null}={}){
 const life=lifecycle(host),teacher=!!teacherClass;
 let cls=teacher?String(teacherClass):String(context?.classId||'all'),data=null,err='',seq=0,form=null;
 const rosters=new Map(); // 반 → 재학 이름 목록(지정 폼에서 고름)
 host.innerHTML=`<div class="b2 o2"><style>${STYLE}</style>${teacher?'':`<div class="b2-head"><div><h2>반 임원</h2><p>반장·부반장·총무·앰버서더를 지정하고 바꿉니다. 저장하면 마스터시트 「반 임원」 탭에 이력이 남고 반정보의 지금 임원 칸이 바뀝니다. 중간에 바뀐 사람은 「보궐」로 구분합니다.</p></div></div>`}
 ${teacher?'':`<section class="b2-card" style="margin-bottom:12px"><div class="b2-toolbar"><label class="b2-field">반<select id="o2Class">${classOptions(classes,cls,{all:true})}</select></label><span class="b2-grow"></span><button class="b2-btn" id="o2Reload">새로고침</button></div></section>`}
 <div id="o2Needs"></div><div id="o2Body">${loading('반 임원을 불러오는 중…')}</div></div>`;
 const $=s=>host.querySelector(s);
 const needsAll=()=>(data?.needs||[]).filter(n=>cls==='all'||String(n.cls)===cls);
 const needOf=(c,role,name)=>needsAll().find(n=>String(n.cls)===String(c)&&n.role===role&&n.name===name)||null;
 const roles=()=>(data?.roles?.length?data.roles:ROLES);
 const classIds=()=>teacher?[cls]:classes.map(c=>String(c.id));

 function needsHtml(){
  const list=needsAll();if(!data||!list.length)return '';
  return `<div class="b2-note warn o2-needs" style="margin-bottom:12px"><b>보궐 필요 ${list.length}건</b> · 지금 임원인데 명부 상태가 중도탈락·조기취업입니다. 후임을 「보궐」로 지정해 주세요.<ul>${list.map((n,i)=>`<li>${esc(classLabel(n.cls))} ${esc(n.role)} <b>${esc(n.name)}</b> · ${esc(n.status)}${n.changed?` ${esc(md(n.changed))}`:''} <button class="b2-btn small warn" data-need="${i}">보궐 지정</button></li>`).join('')}</ul></div>`;
 }
 function tableHtml(){
  const ids=classIds();
  return `<section class="b2-card"><div class="b2-table-wrap"><table class="b2-table"><thead><tr><th>반</th>${roles().map(r=>`<th>${esc(r)}</th>`).join('')}<th></th></tr></thead><tbody>${ids.map(c=>`<tr data-cls="${esc(c)}"><td><b>${esc(classLabel(c))}</b></td>${roles().map(r=>{const cur=currentOf(data,c,r);return `<td class="o2-cell">${cell(cur,cur&&needOf(c,r,cur.name))}</td>`;}).join('')}<td><button class="b2-btn small" data-open-cls="${esc(c)}">지정·이력</button></td></tr>`).join('')}</tbody></table></div></section>`;
 }
 function formHtml(c,role){
  const f=form;if(!f||f.cls!==c||f.role!==role)return '';
  const names=rosters.get(c),dis=f.saving?'disabled':'';
  const reasonFields=(label)=>`<label class="b2-field">${label}<select data-f="reasonSel" ${dis}><option value="">사유 선택</option>${CHANGE_REASONS.map(x=>`<option ${x===f.reasonSel?'selected':''}>${x}</option>`).join('')}</select></label><label class="b2-field">사유 자세히<input data-f="reasonText" maxlength="200" value="${esc(f.reasonText)}" placeholder="${f.reasonSel==='기타'?'사유를 적어 주세요':'(선택)'}" ${dis}></label>`;
  const tail=`<span class="b2-err" data-err>${esc(f.err||'')}</span><button class="b2-btn small primary" data-act="submit" ${dis}>${f.saving?'저장 중…':f.mode==='end'?'끝내기':'저장'}</button><button class="b2-btn small ghost" data-act="cancel" ${dis}>취소</button>`;
  if(f.mode==='end')return `<div class="o2-form" data-form><div class="o2-title"><b>${esc(classLabel(c))} ${esc(role)} ${esc(f.was)} 끝내기</b> · 후임 없이 끝내면 반정보 칸이 비워집니다.</div><label class="b2-field">종료일<input type="date" data-f="end" value="${esc(f.end)}" ${dis}></label>${reasonFields('끝내는 사유')}${tail}</div>`;
  const opts=names?names.filter(n=>n!==f.was).map(n=>`<option ${n===f.name?'selected':''}>${esc(n)}</option>`).join(''):'';
  return `<div class="o2-form" data-form><div class="o2-title"><b>${esc(classLabel(c))} ${esc(role)} ${f.was?`교체 (지금: ${esc(f.was)})`:'지정'}</b></div>
   <label class="b2-field">역할<select data-f="role" ${dis}>${roles().map(r=>`<option ${r===f.role?'selected':''}>${esc(r)}</option>`).join('')}</select></label>
   <label class="b2-field">이름 (재학)<select data-f="name" ${dis||(names?'':'disabled')}><option value="">${names?(names.length?'이름 선택':'재학 교육생 없음'):'명부를 불러오는 중…'}</option>${opts}</select></label>
   <label class="b2-field">구분<select data-f="kind" ${dis}>${KINDS.map(k=>`<option ${k===f.kind?'selected':''}>${k}</option>`).join('')}</select></label>
   <label class="b2-field">시작일<input type="date" data-f="start" value="${esc(f.start)}" ${dis}></label>
   ${f.was?reasonFields(`${esc(f.was)} 님이 바뀐 사유`):''}
   <label class="b2-field">메모<input data-f="note" maxlength="200" value="${esc(f.note)}" placeholder="(선택)" ${dis}></label>${tail}</div>`;
 }
 function historyHtml(c){
  const rows=(data?.rows||[]).filter(r=>String(r.cls)===c).sort((a,b)=>String(b.start||'').localeCompare(String(a.start||''))||(Number(b.row)||0)-(Number(a.row)||0));
  return `<details class="o2-hist" data-hist="${esc(c)}"><summary>이력 ${rows.length}건</summary>${rows.length?`<div class="b2-table-wrap"><table class="b2-table"><thead><tr><th>역할</th><th>이름</th><th>구분</th><th>기간</th><th>바뀐 사유</th><th>메모</th><th>등록</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.end?'out':''}"><td>${esc(r.role)}</td><td>${esc(r.name)}</td><td><span class="b2-badge ${KIND_TONE[r.kind]||''}">${esc(r.kind||'최초')}</span></td><td>${esc(md(r.start))} ~ ${r.end?esc(md(r.end)):'<b>지금</b>'}</td><td>${esc(r.reason||'')}</td><td>${esc(r.note||'')}</td><td class="b2-small b2-muted">${esc(r.by||'')}${r.at?` · ${esc(r.at)}`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="b2-pad b2-muted">아직 이력이 없습니다.</div>'}</details>`;
 }
 function classHtml(c){
  return `<section class="b2-card o2-cls" data-cls="${esc(c)}"><header><b>${teacher?'반 임원':esc(classLabel(c))}</b><span class="b2-grow"></span>${teacher?'<button class="b2-btn small" id="o2Reload">새로고침</button>':'<button class="b2-btn small ghost" data-open-cls="all">전체 반 보기</button>'}</header>
   <div class="o2-roles">${roles().map(r=>{const cur=currentOf(data,c,r),need=cur&&needOf(c,r,cur.name),busy=form&&form.cls===c&&form.role===r;
    return `<div data-role="${esc(r)}"><div class="o2-role"><b>${esc(r)}</b><div class="o2-cell">${cell(cur,need)}</div><div class="o2-act">${busy?'':cur?`<button class="b2-btn small ${need?'warn':''}" data-act="replace">교체</button><button class="b2-btn small ghost" data-act="end">끝내기</button>`:'<button class="b2-btn small primary" data-act="assign">지정</button>'}</div></div>${formHtml(c,r)}</div>`;}).join('')}</div>
   ${historyHtml(c)}</section>`;
 }
 function render(){
  if(!life.alive())return;
  const openHist=new Set([...host.querySelectorAll('details.o2-hist[open]')].map(d=>d.dataset.hist));
  $('#o2Needs').innerHTML=needsHtml();
  if(!data){$('#o2Body').innerHTML=err?errorBox(err):loading('반 임원을 불러오는 중…');return;}
  $('#o2Body').innerHTML=(err?errorBox(err):'')+(cls==='all'?tableHtml():classHtml(cls));
  host.querySelectorAll('details.o2-hist').forEach(d=>{if(openHist.has(d.dataset.hist))d.open=true;});
 }
 async function load({fresh=false,quiet=false}={}){
  const n=++seq;if(!quiet){err='';if(!data)render();}
  try{const d=await client.officers(teacher?{cls}:{},{fresh});if(n!==seq||!life.alive())return;data=d;err='';}
  catch(e){if(n!==seq||!life.alive())return;err=e;}
  render();
 }
 async function names(c){
  if(rosters.has(c))return;
  try{const b=await client.bundle(c);rosters.set(c,(b?.roster||[]).filter(p=>String(p.cls)===c&&(!p.status||p.status==='재학')).map(p=>p.name));}
  catch(e){rosters.set(c,[]);if(form&&form.cls===c)form.err=`명부를 읽지 못했습니다: ${e.message}`;}
  if(form&&form.cls===c)render();
 }
 function openForm(c,role,mode,pre={}){
  if(form?.saving)return;
  const cur=currentOf(data,c,role);
  form={cls:c,role,mode,was:cur?.name||'',name:'',kind:suggestKind(data,c,role),start:seoulToday(),end:seoulToday(),reasonSel:'',reasonText:'',note:'',err:'',saving:false,...pre};
  if(cls==='all'&&!teacher){cls=c;const s=$('#o2Class');if(s)s.value=c;}
  render();
  if(mode!=='end')void names(c);
  host.querySelector('[data-form] select, [data-form] input')?.focus();
 }
 // 역할을 바꾸면 그 역할의 지금 임원·추천 구분을 다시 정합니다.
 function setRole(role){const cur=currentOf(data,form.cls,role);Object.assign(form,{role,was:cur?.name||'',kind:suggestKind(data,form.cls,role),err:''});render();}
 async function submit(){
  const f=form;if(!f||f.saving)return;
  f.err=checkForm(f,data);if(f.err)return render();
  if(f.mode==='end'&&!confirm(`${classLabel(f.cls)} ${f.role} ${f.was} 님을 ${md(f.end)}에 끝낼까요?\n후임 없이 끝내면 반정보의 ${f.role} 칸이 비워집니다.`))return;
  f.saving=true;render();
  try{
   if(f.mode==='end'){await client.officerEnd(endPayload(f));toast(`${classLabel(f.cls)} ${f.role} ${f.was} 님을 끝냈습니다.`);}
   else{await client.officerSave(savePayload(f));toast(`${classLabel(f.cls)} ${f.role}: ${f.name} (${f.kind}) 저장했습니다.`);}
   if(form===f)form=null;
   await load({fresh:true,quiet:true});
  }catch(e){
   f.saving=false;
   if(isConflict(e)){
    // 그사이 다른 사람이 바꿈: 새로 읽고, 지금 임원을 다시 맞춘 뒤 확인하게 합니다(입력한 이름·날짜는 그대로).
    await load({fresh:true,quiet:true});
    const cur=currentOf(data,f.cls,f.role);f.was=cur?.name||'';if(f.mode==='end'&&!cur)form=null;
    f.err=`그사이 다른 사람이 ${f.role}을(를) 바꿨습니다. 새로 읽었으니 지금 임원(${f.was||'없음'})을 확인하고 다시 저장해 주세요.`;
    if(!form)toast(f.err);
   }else f.err=`저장하지 못했습니다: ${e.message}`;
   render();
  }
 }
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t||t.disabled)return;
  if(t.id==='o2Reload'){void load({fresh:true});return;}
  if(t.dataset.openCls){if(form&&!form.saving)form=null;cls=t.dataset.openCls;const s=$('#o2Class');if(s)s.value=cls;render();return;}
  if(t.dataset.need!==undefined){const n=needsAll()[Number(t.dataset.need)];if(n)openForm(String(n.cls),n.role,'save',{kind:'보궐',reasonSel:CHANGE_REASONS.includes(n.status)?n.status:''});return;}
  const act=t.dataset.act;if(!act)return;
  if(act==='cancel'){form=null;render();return;}
  if(act==='submit'){void submit();return;}
  const c=t.closest('[data-cls]')?.dataset.cls,role=t.closest('[data-role]')?.dataset.role;if(!c||!role)return;
  openForm(c,role,act==='end'?'end':'save');
 });
 const field=ev=>{const t=ev.target;if(!form||!t.dataset?.f)return;
  if(t.dataset.f==='role')return setRole(t.value);
  form[t.dataset.f]=t.value;form.err='';const e=host.querySelector('[data-form] [data-err]');if(e)e.textContent='';
  if(t.dataset.f==='reasonSel'&&ev.type==='change')render();};
 // 고르는 칸(select)은 input·change가 둘 다 옵니다: 값은 input에서, 다시 그리기(역할·사유 종류)는 change에서 한 번만.
 host.addEventListener('input',ev=>{if(ev.target.dataset?.f!=='role')field(ev);});host.addEventListener('change',ev=>{const k=ev.target.dataset?.f;if(k==='role'||k==='reasonSel')field(ev);});
 host.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.matches?.('[data-form] input')){ev.preventDefault();void submit();}});
 const sel=$('#o2Class');if(sel)sel.onchange=ev=>{if(form&&!form.saving)form=null;cls=ev.target.value;render();};
 await load();
 const editing=()=>!!form&&!form.saving&&(form.mode==='end'||!!form.name);
 return {dispose:()=>life.dispose(),canLeave:()=>!editing()||confirm('저장하지 않은 반 임원 입력이 있습니다. 화면을 떠날까요?'),reload:()=>load({fresh:true})};
}
