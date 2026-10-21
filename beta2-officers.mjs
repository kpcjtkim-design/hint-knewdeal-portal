// 2기 반 임원(사용자 결정 2026-10-20: 반장·부반장·총무·앰버서더 4역할, 보궐은 최초 선출과 구분, 담임(자기 반)·관리자 모두 고침).
// 원본은 마스터시트 '반 임원' 탭(이력: 반·역할·이름·구분·시작일·종료일·바뀐 사유·메모·등록자·등록시각, 종료일이 비면 지금 임원)과 반정보 Q·R·S·V(지금 임원).
// Apps Script b2Officers(읽기: 지금 임원·이력·보궐 필요) · b2OfficerSave(지정·교체) · b2OfficerEnd(후임 없이 끝내기). 담임은 Vercel이 자기 반으로 고정합니다.
// 관리자: 출결 › 반 임원(전체 반 표 → 반을 고르면 역할별 지정·교체·끝내기와 이력). 담임: 우리 반 탭 맨 위(beta2-teacher-layout.mjs)에서 자기 반만.
// '보궐 필요'는 지금 임원인데 명부 상태가 중도탈락·조기취업(관리자 확인)인 사람입니다(시트가 needs로 줌). 맨 위에 띄우고 「보궐 지정」으로 바로 엽니다.
// 저장할 때 그 역할의 지금 임원 이름(was.name, 비었으면 '')을 함께 보내, 그사이 다른 사람이 바꿨으면 시트가 거절합니다. 그러면 새로 읽고 다시 확인하게 합니다.
// 앰버서더는 여러 명(10명까지, 사용자 2026-10-21 '엠버서더는 2명이상 가능하게', 시트 B2.OFFICER.multi): current[반]['앰버서더']가 배열이고, 구분에 '추가'가 있습니다.
//  최초·추가는 더하기만(was = 지금 앰버서더 이름 배열, 그사이 바뀌면 거절), 보궐은 누구 대신인지(was:{name}) 골라 그 사람을 끝내고 새 사람을 더합니다. 끝내기도 사람마다(was:{name}).
//  시트가 아직 예전(앰버서더가 객체·null, 구분에 '추가' 없음)이면 앰버서더도 예전처럼 한 명 역할로 다룹니다.
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {isTestClass} from './cohort.mjs';

export const ROLES=['반장','부반장','총무','앰버서더'];
export const KINDS=['최초','보궐','추가']; // '추가'는 앰버서더(여러 명)만
export const AMB='앰버서더',AMB_MAX=10;
// 앞 임원이 바뀐 사유(시트 '바뀐 사유'): 고르고 필요하면 자세히 적습니다. 기타는 적은 말만.
export const CHANGE_REASONS=['중도탈락','조기취업','사퇴','기타'];
const STYLE=`.o2 .o2-roles{display:grid;gap:0}.o2 .o2-role{display:grid;grid-template-columns:90px minmax(160px,1fr) auto;gap:6px 12px;align-items:center;padding:10px 14px;border-top:1px solid var(--b2-line)}
.o2 .o2-role:first-child{border-top:0}.o2 .o2-role b{font-size:13px}.o2 .o2-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.o2 .o2-form{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;padding:12px 14px;background:#f0f9ff;border-top:1px solid var(--b2-line)}.o2 .o2-form .o2-title{flex-basis:100%;font-size:13px}
.o2 .o2-needs ul{margin:6px 0 0;padding-left:18px}.o2 .o2-needs li{margin:4px 0}.o2 .o2-cell .b2-badge{margin-left:4px}.o2 .o2-cell .b2-sub{display:block}
.o2 .o2-people{display:grid;gap:6px}.o2 .o2-person{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px}.o2 .o2-one+.o2-one{margin-top:4px}
.o2 details.o2-hist{border-top:1px solid var(--b2-line)}.o2 details.o2-hist>summary{padding:10px 14px;cursor:pointer;font-size:13px;font-weight:800}
.o2 .o2-cls{margin-bottom:12px}.o2 .o2-cls>header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--b2-line)}
@media(max-width:720px){.o2 .o2-role{grid-template-columns:1fr}.o2 .o2-act{justify-content:flex-start}}`;
const KIND_TONE={'최초':'e-ok','보궐':'t-rec','추가':'t-late'};
const classLabel=id=>isTestClass(id)?`${id}반 · 테스트반`:`${id}반`;
export const seoulToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ISO=/^\d{4}-\d{2}-\d{2}$/;

// 시트가 여러 명 계약(2026-10-21)인지: 구분에 '추가'가 있거나 앰버서더가 배열이면. 아니면(배포 전) 앰버서더도 한 명 역할처럼 다룹니다.
export function multiReady(data){
 if((data?.kinds||[]).includes('추가'))return true;
 return Object.values(data?.current||{}).some(c=>Array.isArray(c?.[AMB]));
}
export const isMulti=(data,role)=>role===AMB&&multiReady(data);
// 지금 그 역할을 맡은 사람들(배열, 없으면 []). 앰버서더는 여러 명, 나머지는 0~1명. 예전 응답(객체·null)도 받습니다.
export function holdersOf(data,cls,role){const v=data?.current?.[String(cls)]?.[role];return (Array.isArray(v)?v:v?[v]:[]).filter(x=>x&&x.name);}
// 지금 그 역할을 맡은 사람(없으면 null). 여러 명 역할이면 첫 사람.
export const currentOf=(data,cls,role)=>holdersOf(data,cls,role)[0]||null;
const hasHistory=(data,cls,role)=>(data?.rows||[]).some(r=>String(r.cls)===String(cls)&&r.role===role);
// 고를 수 있는 구분: 한 명 역할은 최초·보궐. 앰버서더(여러 명)는 최초·추가, 지금 있는 사람이 있으면 보궐(누구 대신)까지.
export function kindsFor(data,cls,role){
 if(!isMulti(data,role))return ['최초','보궐'];
 return holdersOf(data,cls,role).length?['최초','추가','보궐']:['최초','추가'];
}
// 구분 추천: 한 명 역할은 지금 맡은 사람이 있거나 전에 맡았던 기록이 있으면 보궐, 처음이면 최초.
// 앰버서더(여러 명)는 처음이면 최초, 지금 있거나 기록이 있으면 추가(교체는 사람마다 「교체(보궐)」로 엽니다).
export function suggestKind(data,cls,role){
 if(isMulti(data,role))return holdersOf(data,cls,role).length||hasHistory(data,cls,role)?'추가':'최초';
 if(currentOf(data,cls,role))return '보궐';
 return hasHistory(data,cls,role)?'보궐':'최초';
}
export function reasonOf(sel,text){
 const t=String(text||'').trim();
 if(sel==='기타')return t||'기타';
 return [sel,t].filter(Boolean).join(' · ');
}
// 시트가 '그사이 바뀌었습니다'로 거절했는지(다시 읽어야 함)
export const isConflict=e=>e?.code==='CONFLICT'||/그사이 바뀌었/.test(String(e?.message||e||''));
// 폼 → b2OfficerSave / b2OfficerEnd 인자. f.multi(앰버서더 여러 명)면 보궐은 was:{name}(누구 대신), 최초·추가는 was = 지금 앰버서더 이름 배열(f.wasList).
export function savePayload(f){
 const replacing=f.multi?f.kind==='보궐':!!f.was;
 const p={cls:String(f.cls),role:f.role,name:String(f.name||'').trim(),kind:f.kind,start:f.start,was:f.multi&&!replacing?[...(f.wasList||[])]:{name:f.was||''}};
 const reason=replacing&&f.was?reasonOf(f.reasonSel,f.reasonText):'';if(reason)p.reason=reason;
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
 const multi=isMulti(data,f.role),holders=holdersOf(data,f.cls,f.role),target=f.was?holders.find(h=>h.name===f.was)||null:null;
 if(f.mode==='end'){if(!ISO.test(f.end||''))return '종료일을 넣어 주세요.';const cur=multi?target:currentOf(data,f.cls,f.role);if(cur?.start&&f.end<cur.start)return `종료일이 시작일(${md(cur.start)})보다 빠릅니다.`;return '';}
 if(!String(f.name||'').trim())return '이름을 골라 주세요.';
 const kinds=kindsFor(data,f.cls,f.role);
 if(!kinds.includes(f.kind))return `구분(${kinds.join('·')})을 골라 주세요.`;
 if(!ISO.test(f.start||''))return '시작일을 넣어 주세요.';
 if(multi){
  if(holders.some(h=>h.name===String(f.name).trim()))return `이미 ${f.cls}반 ${f.role}입니다.`;
  if(f.kind==='보궐'){
   if(!target)return '누구 대신(보궐)인지 골라 주세요.';
   if(target.start&&f.start<target.start)return `시작일이 ${target.name} 님의 시작일(${md(target.start)})보다 빠릅니다.`;
   return '';
  }
  if(holders.length>=AMB_MAX)return `${f.role}는 ${AMB_MAX}명까지입니다.`;
  return '';
 }
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
 host.innerHTML=`<div class="b2 o2"><style>${STYLE}</style>${teacher?'':`<div class="b2-head"><div><h2>반 임원</h2><p>반장·부반장·총무·앰버서더를 지정하고 바꿉니다. 앰버서더는 여러 명(${AMB_MAX}명까지)이라 사람마다 교체(보궐)·끝내기를 하고 「앰버서더 추가」로 더합니다. 저장하면 마스터시트 「반 임원」 탭에 이력이 남고 반정보의 지금 임원 칸이 바뀝니다. 중간에 바뀐 사람은 「보궐」로 구분합니다.</p></div></div>`}
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
  const td=(c,r)=>{if(!isMulti(data,r)){const cur=currentOf(data,c,r);return cell(cur,cur&&needOf(c,r,cur.name));}
   const hs=holdersOf(data,c,r);return hs.length?hs.map(h=>`<div class="o2-one">${cell(h,needOf(c,r,h.name))}</div>`).join(''):cell(null);};
  return `<section class="b2-card"><div class="b2-table-wrap"><table class="b2-table"><thead><tr><th>반</th>${roles().map(r=>`<th>${esc(r)}</th>`).join('')}<th></th></tr></thead><tbody>${ids.map(c=>`<tr data-cls="${esc(c)}"><td><b>${esc(classLabel(c))}</b></td>${roles().map(r=>`<td class="o2-cell" data-role-cell="${esc(r)}">${td(c,r)}</td>`).join('')}<td><button class="b2-btn small" data-open-cls="${esc(c)}">지정·이력</button></td></tr>`).join('')}</tbody></table></div></section>`;
 }
 function formHtml(c,role){
  const f=form;if(!f||f.cls!==c||f.role!==role)return '';
  const names=rosters.get(c),dis=f.saving?'disabled':'';
  const reasonFields=(label)=>`<label class="b2-field">${label}<select data-f="reasonSel" ${dis}><option value="">사유 선택</option>${CHANGE_REASONS.map(x=>`<option ${x===f.reasonSel?'selected':''}>${x}</option>`).join('')}</select></label><label class="b2-field">사유 자세히<input data-f="reasonText" maxlength="200" value="${esc(f.reasonText)}" placeholder="${f.reasonSel==='기타'?'사유를 적어 주세요':'(선택)'}" ${dis}></label>`;
  const tail=`<span class="b2-err" data-err>${esc(f.err||'')}</span><button class="b2-btn small primary" data-act="submit" ${dis}>${f.saving?'저장 중…':f.mode==='end'?'끝내기':'저장'}</button><button class="b2-btn small ghost" data-act="cancel" ${dis}>취소</button>`;
  if(f.mode==='end')return `<div class="o2-form" data-form><div class="o2-title"><b>${esc(classLabel(c))} ${esc(role)} ${esc(f.was)} 끝내기</b> · 후임 없이 끝내면 반정보 칸${f.multi?'에서 빠집니다':'이 비워집니다'}.</div><label class="b2-field">종료일<input type="date" data-f="end" value="${esc(f.end)}" ${dis}></label>${reasonFields('끝내는 사유')}${tail}</div>`;
  const holders=holdersOf(data,c,role),taken=new Set(f.multi?holders.map(h=>h.name):[f.was]);
  const opts=names?names.filter(n=>!taken.has(n)).map(n=>`<option ${n===f.name?'selected':''}>${esc(n)}</option>`).join(''):'';
  const title=f.multi?(f.kind==='보궐'?`교체(보궐) ${f.was?`· ${esc(f.was)} 대신`:'· 누구 대신인지 골라 주세요'}`:`추가 (지금 ${holders.length}명, ${AMB_MAX}명까지)`):(f.was?`교체 (지금: ${esc(f.was)})`:'지정');
  const whom=f.multi&&f.kind==='보궐'?`<label class="b2-field">누구 대신<select data-f="was" ${dis}><option value="">고르세요</option>${holders.map(h=>`<option ${h.name===f.was?'selected':''}>${esc(h.name)}</option>`).join('')}</select></label>`:'';
  return `<div class="o2-form" data-form><div class="o2-title"><b>${esc(classLabel(c))} ${esc(role)} ${title}</b></div>
   <label class="b2-field">역할<select data-f="role" ${dis}>${roles().map(r=>`<option ${r===f.role?'selected':''}>${esc(r)}</option>`).join('')}</select></label>
   <label class="b2-field">이름 (재학)<select data-f="name" ${dis||(names?'':'disabled')}><option value="">${names?(names.length?'이름 선택':'재학 교육생 없음'):'명부를 불러오는 중…'}</option>${opts}</select></label>
   <label class="b2-field">구분<select data-f="kind" ${dis}>${kindsFor(data,c,role).map(k=>`<option ${k===f.kind?'selected':''}>${k}</option>`).join('')}</select></label>${whom}
   <label class="b2-field">시작일<input type="date" data-f="start" value="${esc(f.start)}" ${dis}></label>
   ${f.was?reasonFields(`${esc(f.was)} 님이 바뀐 사유`):''}
   <label class="b2-field">메모<input data-f="note" maxlength="200" value="${esc(f.note)}" placeholder="(선택)" ${dis}></label>${tail}</div>`;
 }
 function historyHtml(c){
  const rows=(data?.rows||[]).filter(r=>String(r.cls)===c).sort((a,b)=>String(b.start||'').localeCompare(String(a.start||''))||(Number(b.row)||0)-(Number(a.row)||0));
  return `<details class="o2-hist" data-hist="${esc(c)}"><summary>이력 ${rows.length}건</summary>${rows.length?`<div class="b2-table-wrap"><table class="b2-table"><thead><tr><th>역할</th><th>이름</th><th>구분</th><th>기간</th><th>바뀐 사유</th><th>메모</th><th>등록</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.end?'out':''}"><td>${esc(r.role)}</td><td>${esc(r.name)}</td><td><span class="b2-badge ${KIND_TONE[r.kind]||''}">${esc(r.kind||'최초')}</span></td><td>${esc(md(r.start))} ~ ${r.end?esc(md(r.end)):'<b>지금</b>'}</td><td>${esc(r.reason||'')}</td><td>${esc(r.note||'')}</td><td class="b2-small b2-muted">${esc(r.by||'')}${r.at?` · ${esc(r.at)}`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="b2-pad b2-muted">아직 이력이 없습니다.</div>'}</details>`;
 }
 function roleHtml(c,r){
  const busy=form&&form.cls===c&&form.role===r;
  if(!isMulti(data,r)){const cur=currentOf(data,c,r),need=cur&&needOf(c,r,cur.name);
   return `<div data-role="${esc(r)}"><div class="o2-role"><b>${esc(r)}</b><div class="o2-cell">${cell(cur,need)}</div><div class="o2-act">${busy?'':cur?`<button class="b2-btn small ${need?'warn':''}" data-act="replace">교체</button><button class="b2-btn small ghost" data-act="end">끝내기</button>`:'<button class="b2-btn small primary" data-act="assign">지정</button>'}</div></div>${formHtml(c,r)}</div>`;}
  // 앰버서더(여러 명): 사람마다 교체(보궐)·끝내기, 오른쪽에 「앰버서더 추가」(10명이면 막힘)
  const hs=holdersOf(data,c,r),full=hs.length>=AMB_MAX;
  const people=hs.length?hs.map(h=>{const need=needOf(c,r,h.name);return `<div class="o2-person" data-name="${esc(h.name)}"><div class="o2-cell">${cell(h,need)}</div>${busy?'':`<div class="o2-act"><button class="b2-btn small ${need?'warn':''}" data-act="replace">교체(보궐)</button><button class="b2-btn small ghost" data-act="end">끝내기</button></div>`}</div>`;}).join(''):'<div class="o2-cell"><span class="b2-muted">없음</span></div>';
  return `<div data-role="${esc(r)}"><div class="o2-role"><b>${esc(r)}${hs.length?` <span class="b2-small b2-muted">${hs.length}명</span>`:''}</b><div class="o2-people">${people}</div><div class="o2-act">${busy?'':`<button class="b2-btn small primary" data-act="add" ${full?`disabled title="${esc(r)}는 ${AMB_MAX}명까지입니다"`:''}>${esc(r)} 추가</button>`}</div></div>${formHtml(c,r)}</div>`;
 }
 function classHtml(c){
  return `<section class="b2-card o2-cls" data-cls="${esc(c)}"><header><b>${teacher?'반 임원':esc(classLabel(c))}</b><span class="b2-grow"></span>${teacher?'<button class="b2-btn small" id="o2Reload">새로고침</button>':'<button class="b2-btn small ghost" data-open-cls="all">전체 반 보기</button>'}</header>
   <div class="o2-roles">${roles().map(r=>roleHtml(c,r)).join('')}</div>
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
  const multi=isMulti(data,role),hs=holdersOf(data,c,role);
  form={cls:c,role,mode,multi,was:multi?'':hs[0]?.name||'',wasList:hs.map(h=>h.name),name:'',kind:suggestKind(data,c,role),start:seoulToday(),end:seoulToday(),reasonSel:'',reasonText:'',note:'',err:'',saving:false,...pre};
  if(cls==='all'&&!teacher){cls=c;const s=$('#o2Class');if(s)s.value=c;}
  render();
  if(mode!=='end')void names(c);
  host.querySelector('[data-form] select, [data-form] input')?.focus();
 }
 // 역할을 바꾸면 그 역할의 지금 임원·추천 구분을 다시 정합니다.
 function setRole(role){const multi=isMulti(data,role),hs=holdersOf(data,form.cls,role);Object.assign(form,{role,multi,was:multi?'':hs[0]?.name||'',wasList:hs.map(h=>h.name),kind:suggestKind(data,form.cls,role),err:''});render();}
 // 앰버서더 구분: 보궐이면 누구 대신인지 고르게(한 명뿐이면 그 사람), 최초·추가면 대신할 사람 없음.
 function setKind(kind){
  form.kind=kind;form.err='';
  if(form.multi){if(kind!=='보궐')form.was='';else if(!form.was){const hs=holdersOf(data,form.cls,form.role);form.was=hs.length===1?hs[0].name:'';}}
  render();
 }
 async function submit(){
  const f=form;if(!f||f.saving)return;
  f.err=checkForm(f,data);if(f.err)return render();
  if(f.mode==='end'&&!confirm(`${classLabel(f.cls)} ${f.role} ${f.was} 님을 ${md(f.end)}에 끝낼까요?\n후임 없이 끝내면 반정보의 ${f.role} 칸${f.multi?'에서 빠집니다':'이 비워집니다'}.`))return;
  f.saving=true;render();
  try{
   if(f.mode==='end'){await client.officerEnd(endPayload(f));toast(`${classLabel(f.cls)} ${f.role} ${f.was} 님을 끝냈습니다.`);}
   else{await client.officerSave(savePayload(f));toast(`${classLabel(f.cls)} ${f.role}: ${f.name} (${f.kind}${f.multi&&f.was?`, ${f.was} 대신`:''}) 저장했습니다.`);}
   if(form===f)form=null;
   await load({fresh:true,quiet:true});
  }catch(e){
   f.saving=false;
   if(isConflict(e)){
    // 그사이 다른 사람이 바꿈: 새로 읽고, 지금 임원을 다시 맞춘 뒤 확인하게 합니다(입력한 이름·날짜는 그대로).
    // 앰버서더(여러 명)는 대신할·끝낼 사람이 아직 있으면 그대로, 없어졌으면 비웁니다(끝내기는 닫음).
    await load({fresh:true,quiet:true});
    const hs=holdersOf(data,f.cls,f.role);f.multi=isMulti(data,f.role);f.wasList=hs.map(h=>h.name);
    if(f.multi){if(f.was&&!f.wasList.includes(f.was)){f.was='';if(f.mode==='end')form=null;}}
    else{f.was=hs[0]?.name||'';if(f.mode==='end'&&!hs.length)form=null;}
    const now=(f.multi?f.wasList.join(', '):f.was)||'없음';
    f.err=`그사이 다른 사람이 ${f.role}을(를) 바꿨습니다. 새로 읽었으니 지금 임원(${now})을 확인하고 다시 저장해 주세요.`;
    if(!form)toast(f.err);
   }else f.err=`저장하지 못했습니다: ${e.message}`;
   render();
  }
 }
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t||t.disabled)return;
  if(t.id==='o2Reload'){void load({fresh:true});return;}
  if(t.dataset.openCls){if(form&&!form.saving)form=null;cls=t.dataset.openCls;const s=$('#o2Class');if(s)s.value=cls;render();return;}
  if(t.dataset.need!==undefined){const n=needsAll()[Number(t.dataset.need)];if(n)openForm(String(n.cls),n.role,'save',{kind:'보궐',was:n.name,reasonSel:CHANGE_REASONS.includes(n.status)?n.status:''});return;}
  const act=t.dataset.act;if(!act)return;
  if(act==='cancel'){form=null;render();return;}
  if(act==='submit'){void submit();return;}
  const c=t.closest('[data-cls]')?.dataset.cls,role=t.closest('[data-role]')?.dataset.role;if(!c||!role)return;
  const who=t.closest('[data-name]')?.dataset.name; // 앰버서더: 그 사람
  if(act==='end')openForm(c,role,'end',who?{was:who}:{});
  else openForm(c,role,'save',who&&act==='replace'?{was:who,kind:'보궐'}:{});
 });
 const field=ev=>{const t=ev.target;if(!form||!t.dataset?.f)return;
  if(t.dataset.f==='role')return setRole(t.value);
  if(t.dataset.f==='kind')return setKind(t.value);
  if(t.dataset.f==='was'){form.was=t.value;form.err='';return render();}
  form[t.dataset.f]=t.value;form.err='';const e=host.querySelector('[data-form] [data-err]');if(e)e.textContent='';
  if(t.dataset.f==='reasonSel'&&ev.type==='change')render();};
 // 고르는 칸(select)은 input·change가 둘 다 옵니다: 값은 input에서, 다시 그리기(역할·구분·누구 대신·사유 종류)는 change에서 한 번만.
 const ON_CHANGE=['role','kind','was']; // 바꾸면 폼을 다시 그리는 칸: change에서만
 host.addEventListener('input',ev=>{if(!ON_CHANGE.includes(ev.target.dataset?.f))field(ev);});host.addEventListener('change',ev=>{const k=ev.target.dataset?.f;if(ON_CHANGE.includes(k)||k==='reasonSel')field(ev);});
 host.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.matches?.('[data-form] input')){ev.preventDefault();void submit();}});
 const sel=$('#o2Class');if(sel)sel.onchange=ev=>{if(form&&!form.saving)form=null;cls=ev.target.value;render();};
 await load();
 const editing=()=>!!form&&!form.saving&&(form.mode==='end'||!!form.name);
 return {dispose:()=>life.dispose(),canLeave:()=>!editing()||confirm('저장하지 않은 반 임원 입력이 있습니다. 화면을 떠날까요?'),reload:()=>load({fresh:true})};
}
