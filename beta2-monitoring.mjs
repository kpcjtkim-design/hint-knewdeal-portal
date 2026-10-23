// 2기 운영모니터링(사용자 요청 2026-10-21): 1기 '운영모니터링' 설문 링크를 김소윤 님 Streamlit '담임 상담일지' 양식(허락 받음, 문항 그대로)으로 바꾼 화면.
// 담임(teacherClass): 운영모니터링 탭 › 반 운영 점검(view 'checkup', 반·날짜 1건) · 교육생 면담(view 'counsel', 학생마다 1차·2차…, 로테이션). 맨 아래 '내 반 저장 기록'.
// 관리자: 교육 운영 › 운영모니터링(b2monitor) — 반 × 날짜 제출 표(2점 이하 확인 필요 강조, 운영팀 확인), 거르기(반·기간·확인 필요만), 기록 자세히,
//  면담 로테이션(반마다 1회 이상 면담 비율·차수·특별상담 대상 미상담 강조)과 상담일지(Q1~Q4, 운영팀 확인), CSV 내려받기 2가지.
// 특별상담 대상은 누적 출석률 80% 미만(beta2-core studentStats, 교육일 기준). 저장 때 구분은 시트가 정하고, 목록은 화면이 지금 출석률로 보여 줍니다.
// 시트 계약·문항 원문은 beta2-monitoring-core.mjs. 17반(테스트반)·[가상데이터] 학생도 다른 반·학생과 똑같이 보입니다.
import {esc,md,toast,classOptions,loading,errorBox,lifecycle,downloadCsv} from './beta2-ui.mjs';
import {studentStats} from './beta2-core.mjs';
import {newClientId} from './beta2-data.mjs';
import {isTestClass,classInfo} from './cohort.mjs';
import {linkFor} from './notify-core.mjs';
import * as M from './beta2-monitoring-core.mjs';

const STYLE=`.mo .mo-card{margin-bottom:12px}.mo .mo-card>header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 14px;border-bottom:1px solid var(--b2-line)}
.mo h3{margin:0;font-size:16px}.mo h4{margin:0 0 6px;font-size:14px}.mo .mo-body{padding:12px 14px;display:grid;gap:10px}
.mo .mo-meta{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end}.mo .mo-legend{display:flex;flex-wrap:wrap;gap:6px;font-size:12px}
.mo .mo-legend span{border:1px solid var(--b2-line);border-radius:999px;padding:2px 8px;background:#fff}
.mo fieldset.mo-group{border:1px solid var(--b2-line);border-radius:10px;margin:0;padding:4px 12px 8px}.mo fieldset.mo-group>legend{font-weight:800;font-size:13px;padding:0 6px}
.mo .mo-item{display:grid;grid-template-columns:minmax(200px,1.3fr) auto minmax(180px,1fr);gap:6px 12px;align-items:center;padding:8px 0;border-top:1px dashed var(--b2-line)}
.mo .mo-item:first-of-type{border-top:0}.mo .mo-item .b2-sub{display:block;font-size:12px}.mo .mo-item.low{background:#fff1f2}
.mo .mo-scores{display:flex;gap:4px}.mo .mo-scores label{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:32px;border:1px solid var(--b2-line);border-radius:8px;cursor:pointer;font-weight:700;background:#fff}
.mo .mo-scores input{position:absolute;opacity:0;width:1px;height:1px}.mo .mo-scores label:has(input:checked){background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.mo .mo-scores label.s1:has(input:checked),.mo .mo-scores label.s2:has(input:checked){background:#dc2626;border-color:#dc2626}
.mo .mo-scores label:has(input:focus-visible){outline:2px solid #1d4ed8;outline-offset:2px}.mo .mo-note,.mo textarea{width:100%;box-sizing:border-box}
.mo textarea{min-height:72px;resize:vertical;font:inherit;padding:8px;border:1px solid var(--b2-line);border-radius:8px}
.mo .mo-foot{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}.mo .mo-q{display:grid;gap:4px}.mo .mo-q b{font-size:13px}
.mo .mo-ans{white-space:pre-wrap;margin:2px 0 8px;font-size:13px}.mo .mo-log{border-top:1px solid var(--b2-line);padding:8px 0}.mo .mo-log:first-child{border-top:0}
.mo .mo-grid td,.mo .mo-grid th{text-align:center;white-space:nowrap}.mo .mo-grid td:first-child,.mo .mo-grid th:first-child{text-align:left}
.mo .mo-cell{border:0;background:none;cursor:pointer;padding:2px 4px;font:inherit}.mo .mo-cell.none{color:var(--b2-muted,#94a3b8)}.mo .mo-cell.sel{outline:2px solid #1d4ed8;border-radius:6px}
.mo tr.hot td{background:#fff1f2}.mo .mo-pct{font-weight:800}
@media(max-width:760px){.mo .mo-item{grid-template-columns:1fr}}`;
const classLabel=id=>isTestClass(id)?`${id}반 · 테스트반`:`${id}반`;
const className=id=>{const c=classInfo(id);return c?(c.test?`${c.id}반 · 테스트반`:`${c.id}반 ${c.name||''}`.trim()):`${id}반`;};
export const seoulToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(iso,n)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const pct=r=>r===null||r===undefined?'—':`${Math.round(r*10)/10}%`;
const kindBadge=k=>k===M.SPECIAL?`<span class="b2-badge t-absent">${M.SPECIAL}</span>`:`<span class="b2-badge e-none">${M.NORMAL_LABEL}</span>`;
const roundBadge=n=>n?`<span class="b2-badge e-ok">${n}차 완료</span>`:'<span class="b2-badge t-late">미상담</span>';
const confirmBadge=r=>r.confirmed?`<span class="b2-badge e-ok" title="${esc([r.confirmedBy,r.confirmedAt].filter(Boolean).join(' · '))}">운영팀 확인</span>`:'';
const flagBadge=on=>on?'<span class="b2-badge t-absent" data-flag>확인 필요</span>':'';
const isConflict=e=>e?.code==='CONFLICT'||/그사이/.test(String(e?.message||''));
const defaultNotify=(kind,payload)=>import('./notify.mjs').then(m=>m.notify(kind,payload)).catch(e=>console.warn('운영모니터링 알림을 남기지 못했습니다',e));
// 확인 필요 기록을 담임이 저장하면 관리자에게 알림. 종류가 아직 규칙에 없으면(notifyReady false) 보내지 않습니다.
function tellFlag(notify,p,res,ready){
 if(!ready)return;
 const n=M.monitorNotice(p,{flag:res?.flag??M.needsCheck(p.scores)});if(!n)return;
 try{void notify(M.NOTIFY_KIND,{...n,link:linkFor('b2monitor',{cls:p.cls,date:p.date})});}catch(e){console.warn(e);}
}
const rowsOf=(d,norm)=>(Array.isArray(d?.rows)?d.rows:[]).map(norm);
export const records=d=>rowsOf(d,M.normMonitor);
export const counselLogs=d=>rowsOf(d,M.normCounsel);

function itemsHtml(f,dis){
 let no=0;
 return M.GROUPS.map(g=>`<fieldset class="mo-group"><legend>${esc(g)}</legend>${M.ITEMS.filter(i=>i.group===g).map(i=>{no++;const v=f.scores[i.key];
  return `<div class="mo-item ${v!==null&&v<=M.LOW?'low':''}" data-item="${i.key}"><div><b>${no}. ${esc(i.label)}</b><span class="b2-sub">${esc(i.desc)}</span></div>
  <div class="mo-scores" role="radiogroup" aria-label="${esc(i.label)} 점수">${[1,2,3,4,5].map(n=>`<label class="s${n}" title="${esc(M.SCORE_LEGEND.find(x=>x[0]===n).slice(1).join(' · '))}"><input type="radio" name="mo-${i.key}" value="${n}" data-score="${i.key}" ${v===n?'checked':''} ${dis}>${n}</label>`).join('')}</div>
  <input class="mo-note" data-note="${i.key}" maxlength="${M.NOTE_MAX}" placeholder="특이사항" aria-label="${esc(i.label)} 특이사항" value="${esc(f.notes[i.key]||'')}" ${dis}></div>`;}).join('')}</fieldset>`).join('');
}
function recordDetail(r){
 const low=new Set(M.lowItems(r.scores).map(i=>i.key));
 return `<div class="b2-table-wrap"><table class="b2-table"><thead><tr><th>구분</th><th>항목</th><th>점수</th><th>특이사항</th></tr></thead><tbody>${M.ITEMS.map(i=>`<tr class="${low.has(i.key)?'hot':''}"><td>${esc(i.group)}</td><td>${esc(i.label)}</td><td><b>${esc(r.scores[i.key]??'—')}</b></td><td>${esc(r.notes[i.key]||'')}</td></tr>`).join('')}</tbody></table></div>`;
}
const answersHtml=c=>M.QUESTIONS.map(q=>`<div class="mo-q"><b>${esc(q.label)}</b><div class="mo-ans">${esc(c.answers[q.key]||'')||'<span class="b2-muted">(빈칸)</span>'}</div></div>`).join('');

export async function mount(host,opts={}){return opts.teacherClass?mountTeacher(host,opts):mountAdmin(host,opts);}

/* ───────── 담임 ───────── */
async function mountTeacher(host,{client,teacherClass,view='checkup',me='',notify=defaultNotify,notifyKinds}={}){
 const life=lifecycle(host),cls=String(teacherClass),mine=e=>String(e||'').trim().toLowerCase()===String(me||'').trim().toLowerCase();
 const ready=M.notifyReady(notifyKinds);
 let mons=[],logs=[],stats=null,err='',seq=0,recTab=view==='counsel'?'counsel':'checkup',filter='all';
 const blank=date=>({date,scores:Object.fromEntries(M.ITEM_KEYS.map(k=>[k,null])),notes:Object.fromEntries(M.ITEM_KEYS.map(k=>[k,''])),was:'',author:'',confirmed:false,savedAt:'',dirty:false,saving:false,err:''});
 let form=blank(seoulToday()),cform=null;
 host.innerHTML=`<div class="b2 mo"><style>${STYLE}</style><div id="moMain">${loading('운영모니터링을 불러오는 중…')}</div><div id="moRecords"></div></div>`;
 const $=s=>host.querySelector(s);
 const recOf=date=>mons.find(r=>r.cls===cls&&r.date===date)||null;
 function prefill(date){
  const r=recOf(date),f=blank(date);
  if(r)Object.assign(f,{scores:{...r.scores},notes:{...r.notes},was:r.sig,author:r.author,confirmed:r.confirmed,savedAt:r.savedAt});
  form=f;
 }
 function checkupHtml(){
  const f=form,dis=f.saving?'disabled':'',r=recOf(f.date),flag=M.needsCheck(f.scores);
  return `<section class="b2-card mo-card" data-view="checkup"><header><h3>${esc(M.SURVEY_TITLE)}</h3><span class="b2-grow"></span><button class="b2-btn small" data-act="reload">새로고침</button></header><div class="mo-body">
   <div class="b2-note">${esc(M.SURVEY_NOTICE)}</div>
   <div class="mo-meta"><label class="b2-field">날짜<input type="date" id="moDate" value="${esc(f.date)}" max="${seoulToday()}" ${dis}></label>
    <span><span class="b2-small b2-muted">담당 반</span><br><b>${esc(className(cls))}</b></span>
    <span><span class="b2-small b2-muted">작성자</span><br><b>${esc(f.author||me||'')}</b></span>
    <span id="moState">${r?`<span class="b2-badge e-ok">저장됨</span> <span class="b2-small b2-muted">${esc(r.savedAt||'')}${r.editedBy?` · 고침 ${esc(r.editedBy)}`:''}</span> ${confirmBadge(r)}`:'<span class="b2-badge e-none">아직 저장 전</span>'}</span></div>
   ${r?.confirmed?'<div class="b2-note">운영팀이 확인한 기록입니다. 내용을 고쳐 저장하면 운영팀 확인이 풀리고 다시 확인합니다.</div>':''}
   <div class="mo-legend" aria-label="점수 기준"><b>점수 기준</b>${M.SCORE_LEGEND.map(([n,a,b])=>`<span><b>${n}점</b> ${esc(a)}(${esc(b)})</span>`).join('')}</div>
   <div class="b2-note warn">${esc(M.LOW_NOTICE)}</div>
   ${itemsHtml(f,dis)}
   <div class="mo-foot"><span id="moFlag">${flagBadge(flag)}</span><span class="b2-err" data-err>${esc(f.err||'')}</span><span class="b2-grow"></span><button class="b2-btn primary" data-act="save-checkup" ${dis}>${f.saving?'저장 중…':esc(M.SURVEY_SAVE)}</button></div>
  </div></section>`;
 }
 const rot=()=>M.rotation(stats||[],logs,{cls});
 function counselHtml(){
  if(!stats)return loading('명부·출석률을 불러오는 중…');
  const R=rot(),list=M.filterStudents(R.students,filter),sp=R.students.filter(s=>s.special).length;
  const recent=logs.slice().sort((a,b)=>(b.savedAt||b.date).localeCompare(a.savedAt||a.date)).slice(0,5);
  const step1=`<section class="b2-card mo-card" data-view="counsel"><header><h3>${esc(M.COUNSEL_TITLE)}</h3><span class="b2-grow"></span><button class="b2-btn small" data-act="reload">새로고침</button></header><div class="mo-body">
   <h4>${esc(M.STEP1)}</h4><div class="b2-note">${esc(M.SPECIAL_NOTICE)}</div>
   <div class="b2-note ${R.pending?'warn':''}" id="moRotation">면담 로테이션 · 1회 이상 면담 <span class="mo-pct">${R.done}/${R.total}명 (${R.percent}%)</span> · 미상담 ${R.pending}명${R.specialPending?` · <b>특별상담 대상 미상담 ${R.specialPending}명</b>`:''} · 모든 학생이 한 번씩 면담받도록 미상담 학생부터 차례로 보입니다.</div>
   <div class="b2-chips" role="group" aria-label="학생 구분">${[['special',`${M.SPECIAL} ${sp}명`],['normal',`${M.NORMAL_LABEL} ${R.total-sp}명`],['all',`전체 ${R.total}명`]].map(([k,l])=>`<button class="b2-chip" data-filter="${k}" aria-pressed="${filter===k}">${esc(l)}</button>`).join('')}</div>
   ${list.length?`<div class="b2-table-wrap"><table class="b2-table" id="moStudents"><thead><tr><th>이름</th><th>구분</th><th>누적 출석률</th><th>면담 현황</th><th>마지막 면담</th><th></th></tr></thead><tbody>${list.map(s=>`<tr data-name="${esc(s.name)}" class="${s.special&&!s.rounds?'hot':''}"><td><b>${esc(s.name)}</b></td><td>${kindBadge(s.kind)}</td><td>${pct(s.rate)}</td><td>${roundBadge(s.rounds)}</td><td>${s.last?esc(md(s.last)):'—'}</td><td><button class="b2-btn small ${cform?.name===s.name?'primary':''}" data-pick="${esc(s.name)}">${s.next}차 면담 작성</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="b2-muted">해당하는 학생이 없습니다.</div>'}
   ${recent.length?`<div><b class="b2-small">최근 저장 상담일지</b><ul class="b2-small" style="margin:4px 0 0;padding-left:18px">${recent.map(c=>`<li>${esc(md(c.date))} · ${esc(c.name)} · ${c.round}차 · ${esc(c.author)}</li>`).join('')}</ul></div>`:''}
  </div></section>`;
  return step1+(cform?step2Html(R):'');
 }
 function step2Html(R){
  const f=cform,s=R.students.find(x=>x.name===f.name),hist=(s?.logs||logs.filter(c=>c.name===f.name)).slice().sort((a,b)=>a.round-b.round),dis=f.saving?'disabled':'';
  const editing=f.round?hist.find(h=>h.round===f.round):null,kind=editing?editing.kind:s?.kind||M.NORMAL;
  return `<section class="b2-card mo-card" data-form><header><h3>${esc(M.step2Title(f.name))}</h3><span class="b2-grow"></span><span>${esc(classLabel(cls))} · ${kind===M.SPECIAL?M.SPECIAL:M.NORMAL_LABEL}</span></header><div class="mo-body">
   <div class="mo-meta"><span><span class="b2-small b2-muted">대상 교육생</span><br><b>${esc(f.name)}</b></span>
    <span><span class="b2-small b2-muted">차수</span><br><span class="b2-badge t-rec" id="moRound">${f.round?`${f.round}차 면담 고치기`:`${s?.next||1}차 면담`}</span></span>
    <label class="b2-field">면담 날짜<input type="date" data-c="date" value="${esc(f.date)}" max="${seoulToday()}" ${dis}></label></div>
   <div class="b2-note">${esc(M.SAVE_NOTICE)}</div>
   <h4>${esc(M.INTERVIEW_TITLE)}</h4>
   ${M.QUESTIONS.map(q=>`<label class="mo-q"><b>${esc(q.label)}</b><textarea data-q="${q.key}" maxlength="${M.ANSWER_MAX}" ${dis}>${esc(f.answers[q.key]||'')}</textarea></label>`).join('')}
   <div class="mo-foot"><span class="b2-err" data-err>${esc(f.err||'')}</span><span class="b2-grow"></span><button class="b2-btn primary" data-act="save-counsel" ${dis}>${f.saving?'저장 중…':esc(M.COUNSEL_SAVE)}</button><button class="b2-btn ghost" data-act="cancel-counsel" ${dis}>취소</button></div>
   <div><b class="b2-small">${esc(f.name)} 면담 기록 ${hist.length}건</b>${hist.length?hist.map(h=>`<div class="mo-log" data-round="${h.round}"><div class="mo-foot"><b>${h.round}차</b><span>${esc(md(h.date))}</span>${kindBadge(h.kind)}<span class="b2-small b2-muted">${esc(h.author)}${h.editedBy?` · 고침 ${esc(h.editedBy)}`:''}</span>${confirmBadge(h)}<span class="b2-grow"></span>${mine(h.author)&&!f.saving&&f.round!==h.round?`<button class="b2-btn small" data-edit="${h.round}">고치기</button>`:''}</div>${answersHtml(h)}</div>`).join(''):'<div class="b2-muted b2-small">아직 면담 기록이 없습니다.</div>'}</div>
  </div></section>`;
 }
 function recordsHtml(){
  const ms=mons.filter(r=>r.cls===cls).sort((a,b)=>b.date.localeCompare(a.date)),cs=logs.slice().sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name,'ko')||b.round-a.round);
  const body=recTab==='checkup'?(ms.length?`<table class="b2-table"><thead><tr><th>날짜</th><th>평균</th><th>확인 필요</th><th>운영팀 확인</th><th>작성자</th><th>저장</th></tr></thead><tbody>${ms.map(r=>`<tr data-rec="${esc(r.date)}"><td><button class="b2-btn small ghost" data-open-date="${esc(r.date)}">${esc(md(r.date))}</button></td><td>${esc(M.average(r.scores)??'—')}</td><td>${r.flag?`${flagBadge(true)} <span class="b2-small">${esc(M.lowItems(r.scores).map(i=>i.label).join(', '))}</span>`:''}</td><td>${confirmBadge(r)}</td><td class="b2-small">${esc(r.author)}</td><td class="b2-small b2-muted">${esc(r.savedAt)}</td></tr>`).join('')}</tbody></table>`:'<div class="b2-pad b2-muted">아직 제출한 만족도 조사가 없습니다.</div>')
   :(cs.length?`<table class="b2-table"><thead><tr><th>날짜</th><th>이름</th><th>차수</th><th>구분</th><th>운영팀 확인</th><th>작성자</th></tr></thead><tbody>${cs.map(c=>`<tr><td>${esc(md(c.date))}</td><td>${esc(c.name)}</td><td>${c.round}차</td><td>${kindBadge(c.kind)}</td><td>${confirmBadge(c)}</td><td class="b2-small">${esc(c.author)}</td></tr>`).join('')}</tbody></table>`:'<div class="b2-pad b2-muted">아직 저장한 상담일지가 없습니다.</div>');
  return `<section class="b2-card mo-card" id="moRec"><header><b>${esc(M.RECORDS_TITLE)}</b><span class="b2-grow"></span><div class="b2-chips">${[['checkup',`운영 점검 이력 ${ms.length}건`],['counsel',`학생 상담 이력 ${cs.length}건`]].map(([k,l])=>`<button class="b2-chip" data-rec-tab="${k}" aria-pressed="${recTab===k}">${esc(l)}</button>`).join('')}</div></header><div class="b2-table-wrap">${body}</div></section>`;
 }
 function render(){
  if(!life.alive())return;
  const main=$('#moMain');
  if(err&&!mons.length&&!logs.length){main.innerHTML=errorBox(err);$('#moRecords').innerHTML='';return;}
  main.innerHTML=(err?errorBox(err):'')+(view==='counsel'?counselHtml():checkupHtml());
  $('#moRecords').innerHTML=recordsHtml();
 }
 async function load({fresh=false}={}){
  const n=++seq;
  try{
   const [m,c,b]=await Promise.all([client.monitors({cls},{fresh}),client.counsels({cls},{fresh}),view==='counsel'?client.bundle(cls):null]);
   if(n!==seq||!life.alive())return;
   mons=records(m).filter(r=>r.cls===cls);logs=counselLogs(c).filter(r=>r.cls===cls);if(b)stats=studentStats(b,{cls});err='';
  }catch(e){if(n!==seq||!life.alive())return;err=e;}
  if(!form.dirty&&!form.saving)prefill(form.date);
  render();
 }
 async function saveCheckup(){
  const f=form;if(f.saving)return;
  f.err=M.checkMonitor(f);if(f.err)return render();
  const p=M.monitorPayload({...f,cls});f.saving=true;render();
  try{
   const res=await client.monitorSave(p);
   toast(`${md(p.date)} 반 운영 점검를 저장했습니다${(res?.flag??M.needsCheck(p.scores))?' · 확인 필요로 운영팀에 표시됩니다':''}.`);
   tellFlag(notify,p,res,ready);
   form.dirty=false;form.saving=false;await load({fresh:true});
  }catch(e){
   f.saving=false;
   if(isConflict(e)){await load({fresh:true});const r=recOf(f.date);f.was=r?.sig||'';f.author=r?.author||f.author;
    f.err='그사이 다른 사람이 이 날짜 기록을 바꿨습니다. 새로 읽었으니 아래 「내 반 저장 기록」을 확인하고 다시 저장해 주세요(입력한 값은 그대로 두었습니다).';}
   else f.err=`저장하지 못했습니다: ${e.message}`;
   render();
  }
 }
 function pick(name,round=0){
  if(cform?.saving)return;
  if(cform&&cform.dirty&&!confirm('저장하지 않은 면담 내용이 있습니다. 다른 학생으로 바꿀까요?'))return;
  const h=round?logs.find(c=>c.name===name&&c.round===round):null;
  cform={name,round,date:h?.date||seoulToday(),answers:h?{...h.answers}:Object.fromEntries(M.Q_KEYS.map(k=>[k,''])),was:h?.sig||'',clientId:round?'':newClientId(),dirty:false,saving:false,err:''};
  render();host.querySelector('[data-form] textarea')?.focus();
 }
 async function saveCounsel(){
  const f=cform;if(!f||f.saving)return;
  f.err=M.checkCounsel(f);if(f.err)return render();
  const p=M.counselPayload({...f,cls});f.saving=true;render();
  try{
   const res=await client.counselSave(p);
   toast(`${f.name} ${res?.round||f.round||''}${res?.round||f.round?'차 ':''}상담일지를 저장했습니다 · 면담 완료로 처리했습니다.`);
   cform=null;await load({fresh:true});
  }catch(e){
   f.saving=false;
   if(isConflict(e)){await load({fresh:true});const h=logs.find(c=>c.name===f.name&&c.round===f.round);f.was=h?.sig||'';f.err='그사이 다른 사람이 이 면담 기록을 바꿨습니다. 새로 읽었으니 아래 기록을 확인하고 다시 저장해 주세요(입력한 값은 그대로 두었습니다).';}
   else f.err=`저장하지 못했습니다: ${e.message}`;
   render();
  }
 }
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t||t.disabled)return;
  const a=t.dataset.act;
  if(a==='reload'){void load({fresh:true});return;}
  if(a==='save-checkup'){void saveCheckup();return;}
  if(a==='save-counsel'){void saveCounsel();return;}
  if(a==='cancel-counsel'){if(cform?.dirty&&!confirm('저장하지 않은 면담 내용을 지울까요?'))return;cform=null;render();return;}
  if(t.dataset.filter){filter=t.dataset.filter;render();return;}
  if(t.dataset.pick){pick(t.dataset.pick);return;}
  if(t.dataset.edit){pick(cform.name,Number(t.dataset.edit));return;}
  if(t.dataset.recTab){recTab=t.dataset.recTab;$('#moRecords').innerHTML=recordsHtml();return;}
  if(t.dataset.openDate&&view==='checkup'){setDate(t.dataset.openDate);host.querySelector('[data-view="checkup"]')?.scrollIntoView?.({block:'start'});}
 });
 function setDate(d){
  if(!M.isIso(d)||d===form.date)return;
  if(form.dirty&&!confirm('저장하지 않은 점수가 있습니다. 다른 날짜로 바꿀까요?')){const i=$('#moDate');if(i)i.value=form.date;return;}
  prefill(d);render();
 }
 host.addEventListener('change',ev=>{
  const t=ev.target;
  if(t.id==='moDate'){setDate(t.value);return;}
  if(t.dataset.score){form.scores[t.dataset.score]=Number(t.value);form.dirty=true;form.err='';
   const item=t.closest('.mo-item');item?.classList.toggle('low',Number(t.value)<=M.LOW);const fl=$('#moFlag');if(fl)fl.innerHTML=flagBadge(M.needsCheck(form.scores));const e=host.querySelector('[data-view="checkup"] [data-err]');if(e)e.textContent='';}
  if(t.dataset.c==='date'&&cform){cform.date=t.value;cform.dirty=true;}
 });
 host.addEventListener('input',ev=>{
  const t=ev.target;
  if(t.dataset.note){form.notes[t.dataset.note]=t.value;form.dirty=true;}
  if(t.dataset.q&&cform){cform.answers[t.dataset.q]=t.value;cform.dirty=true;cform.err='';}
 });
 render();await load();
 const editing=()=>(view==='checkup'&&form.dirty)||(view==='counsel'&&!!cform?.dirty);
 return {dispose:()=>life.dispose(),canLeave:()=>!editing()||confirm('저장하지 않은 운영모니터링 입력이 있습니다. 화면을 떠날까요?'),reload:()=>load({fresh:true})};
}

/* ───────── 관리자 ───────── */
async function mountAdmin(host,{client,classes=[],context}={}){
 const life=lifecycle(host),today=seoulToday();
 const ids=classes.map(c=>String(c.id));
 let view='checkup',cls=context?.classId&&ids.includes(String(context.classId))?String(context.classId):'all',to=today,from=addDays(today,-13),flagOnly=false,detail='',openLog='';
 if(context?.date&&M.isIso(context.date)){detail=`${cls}|${context.date}`;if(context.date<from)from=context.date;if(context.date>to)to=context.date;}
 let mons=[],logs=[],bundle=null,err='',seq=0,busy='';
 host.innerHTML=`<div class="b2 mo"><style>${STYLE}</style><div class="b2-head"><div><h2>운영모니터링</h2><p>담임이 매일 쓰는 반 운영 점검(9개 항목, 2점 이하는 확인 필요)와 교육생 면담(상담일지, 학생마다 1차·2차…)을 반별로 확인합니다. 모든 학생이 한 번씩은 면담받도록 로테이션 진행률을 봅니다.</p></div></div>
 <section class="b2-card" style="margin-bottom:12px"><div class="b2-toolbar">
  <div class="b2-chips" role="tablist">${[['checkup','반 운영 점검'],['counsel','교육생 면담']].map(([k,l])=>`<button class="b2-chip" data-view="${k}" aria-pressed="${view===k}">${l}</button>`).join('')}</div>
  <label class="b2-field">반<select id="moClass">${classOptions(classes,cls,{all:true})}</select></label>
  <label class="b2-field">시작<input type="date" id="moFrom" value="${from}"></label><label class="b2-field">끝<input type="date" id="moTo" value="${to}"></label>
  <label class="b2-field" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="moFlagOnly"> 확인 필요만</label>
  <span class="b2-grow"></span><button class="b2-btn" data-act="reload">새로고침</button><button class="b2-btn" data-act="csv-checkup">운영 점검 CSV</button><button class="b2-btn" data-act="csv-counsel">상담일지 CSV</button></div></section>
 <div id="moBody">${loading('운영모니터링을 불러오는 중…')}</div></div>`;
 const $=s=>host.querySelector(s);
 const shown=()=>cls==='all'?ids:[cls];
 const inRange=d=>(!from||d>=from)&&(!to||d<=to);
 function dates(){
  const set=new Set((bundle?.days||[]).filter(d=>inRange(d)&&d<=today));
  for(const r of mons)if(inRange(r.date))set.add(r.date);
  return [...set].sort();
 }
 const stats=()=>bundle?studentStats(bundle,{withTest:true}):[];
 const filteredLogs=()=>logs.filter(c=>(cls==='all'||c.cls===cls)&&inRange(c.date)).sort((a,b)=>b.date.localeCompare(a.date)||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko')||b.round-a.round);
 function checkupHtml(){
  const ds=dates(),grid=M.overview(mons,shown(),ds),list=M.pickRecords(mons,{cls,from,to,flagOnly});
  const rec=detail?mons.find(r=>`${r.cls}|${r.date}`===detail):null;
  // 칸: 미제출 '·', 제출, 확인 필요(빨강), ✓ = 운영팀 확인. '확인 필요만'이면 확인 필요가 아닌 제출 칸은 흐리게(글자만).
  const cell=c=>{const on=detail===`${c.rec?.cls}|${c.date}`;if(c.state==='none')return `<td data-date="${esc(c.date)}"><span class="mo-cell none" title="미제출">·</span></td>`;
   const inner=c.state==='flag'?'<span class="b2-badge t-absent">확인 필요</span>':flagOnly?'제출':'<span class="b2-badge e-ok">제출</span>';
   return `<td data-date="${esc(c.date)}"><button class="mo-cell ${on?'sel':''}" data-cell="${esc(c.rec.cls)}|${esc(c.date)}">${inner}${c.confirmed?' ✓':''}</button></td>`;};
  const totals={sub:grid.reduce((n,g)=>n+g.submitted,0),flags:grid.reduce((n,g)=>n+g.flags,0),open:grid.reduce((n,g)=>n+g.unconfirmedFlags,0)};
  return `<div class="b2-stats" style="margin-bottom:12px">${[['제출',totals.sub],['확인 필요',totals.flags,totals.flags?'bad':''],['확인 필요 · 운영팀 확인 전',totals.open,totals.open?'alert':''],['날짜',ds.length]].map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${esc(l)}</span></div>`).join('')}</div>
  <section class="b2-card mo-card"><header><b>반 × 날짜 제출 현황</b><span class="b2-small b2-muted">✓ = 운영팀 확인 · 칸을 누르면 아래에 자세히</span></header>${ds.length?`<div class="b2-table-wrap"><table class="b2-table mo-grid"><thead><tr><th>반</th>${ds.map(d=>`<th>${esc(md(d))}</th>`).join('')}<th>제출</th><th>확인 필요</th></tr></thead><tbody>${grid.map(g=>`<tr data-cls="${esc(g.cls)}" class="${g.unconfirmedFlags?'hot':''}"><td><b>${esc(classLabel(g.cls))}</b></td>${g.cells.map(cell).join('')}<td>${g.submitted}/${ds.length}</td><td>${g.flags||''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="b2-pad b2-muted">이 기간에 교육일이 없습니다.</div>'}</section>
  ${rec?`<section class="b2-card mo-card" id="moDetail"><header><b>${esc(classLabel(rec.cls))} · ${esc(md(rec.date))} 반 운영 점검</b>${flagBadge(rec.flag)}${confirmBadge(rec)}<span class="b2-small b2-muted">작성 ${esc(rec.author)} · 저장 ${esc(rec.savedAt)}${rec.editedBy?` · 고침 ${esc(rec.editedBy)}`:''}</span><span class="b2-grow"></span><button class="b2-btn small ${rec.confirmed?'ghost':'primary'}" data-confirm-mon="${esc(detail)}" ${busy?'disabled':''}>${rec.confirmed?'운영팀 확인 취소':'운영팀 확인'}</button><button class="b2-btn small ghost" data-act="close-detail">닫기</button></header>${recordDetail(rec)}</section>`:''}
  <section class="b2-card mo-card"><header><b>기록 ${list.length}건</b><span class="b2-small b2-muted">${flagOnly?'확인 필요만 · ':''}${esc(md(from))} ~ ${esc(md(to))}</span></header>${list.length?`<div class="b2-table-wrap"><table class="b2-table" id="moList"><thead><tr><th>날짜</th><th>반</th><th>작성자</th><th>평균</th><th>2점 이하 항목</th><th>확인</th><th></th></tr></thead><tbody>${list.map(r=>`<tr class="${r.flag&&!r.confirmed?'hot':''}" data-key="${esc(r.cls)}|${esc(r.date)}"><td>${esc(md(r.date))}</td><td>${esc(classLabel(r.cls))}</td><td class="b2-small">${esc(r.author)}</td><td>${esc(M.average(r.scores)??'—')}</td><td>${r.flag?`${flagBadge(true)} ${esc(M.lowItems(r.scores).map(i=>`${i.label} ${r.scores[i.key]}점`).join(', '))}`:''}</td><td>${confirmBadge(r)}</td><td><button class="b2-btn small" data-cell="${esc(r.cls)}|${esc(r.date)}">자세히</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="b2-pad b2-muted">해당하는 기록이 없습니다.</div>'}</section>`;
 }
 function counselHtml(){
  const st=stats(),rows=M.rotationByClass(st,logs,shown()),ls=filteredLogs();
  const one=cls!=='all'?M.rotation(st,logs,{cls}):null;
  return `<section class="b2-card mo-card"><header><b>면담 로테이션</b><span class="b2-small b2-muted">전체 기간 기준 · 모든 학생이 한 번씩은 면담받도록</span></header><div class="b2-table-wrap"><table class="b2-table" id="moRot"><thead><tr><th>반</th><th>재학</th><th>1회 이상 면담</th><th>미상담</th><th>면담 건수</th><th>2차 이상</th><th>${M.SPECIAL}</th><th>${M.SPECIAL} 미상담</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-cls="${esc(r.cls)}" class="${r.specialPending?'hot':''}"><td><b>${esc(classLabel(r.cls))}</b></td><td>${r.total}</td><td><span class="mo-pct">${r.done}명 (${r.percent}%)</span></td><td>${r.pending}</td><td>${r.logs}</td><td>${r.multi}</td><td>${r.special}</td><td>${r.specialPending?`<b>${r.specialPending}</b>`:'0'}</td><td>${cls==='all'?`<button class="b2-btn small" data-open-cls="${esc(r.cls)}">학생 보기</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>
  ${one?`<section class="b2-card mo-card"><header><b>${esc(classLabel(cls))} 학생별 면담 현황</b><span class="b2-small b2-muted">미상담 학생부터</span><span class="b2-grow"></span><button class="b2-btn small ghost" data-open-cls="all">전체 반 보기</button></header><div class="b2-table-wrap"><table class="b2-table" id="moStudents"><thead><tr><th>이름</th><th>구분</th><th>누적 출석률</th><th>면담 현황</th><th>마지막 면담</th></tr></thead><tbody>${one.students.map(s=>`<tr data-name="${esc(s.name)}" class="${s.special&&!s.rounds?'hot':''}"><td><b>${esc(s.name)}</b></td><td>${kindBadge(s.kind)}</td><td>${pct(s.rate)}</td><td>${roundBadge(s.rounds)}</td><td>${s.last?esc(md(s.last)):'—'}</td></tr>`).join('')}</tbody></table></div></section>`:''}
  <section class="b2-card mo-card"><header><b>상담일지 ${ls.length}건</b><span class="b2-small b2-muted">${esc(md(from))} ~ ${esc(md(to))}${cls==='all'?' · 전체 반':''}</span></header><div class="mo-body" id="moLogs">${ls.length?ls.slice(0,200).map(c=>{const k=`${c.cls}|${c.name}|${c.round}`;return `<details class="mo-log" data-log="${esc(k)}" ${openLog===k?'open':''}><summary class="mo-foot"><b>${esc(md(c.date))}</b><span>${esc(classLabel(c.cls))} ${esc(c.name)}</span><span class="b2-badge t-rec">${c.round}차</span>${kindBadge(c.kind)}<span class="b2-small b2-muted">${esc(c.author)}</span>${confirmBadge(c)}</summary>${answersHtml(c)}<div class="mo-foot"><span class="b2-grow"></span><button class="b2-btn small ${c.confirmed?'ghost':'primary'}" data-confirm-log="${esc(k)}" ${busy?'disabled':''}>${c.confirmed?'운영팀 확인 취소':'운영팀 확인'}</button></div></details>`;}).join('')+(ls.length>200?'<div class="b2-muted b2-small">200건까지 보입니다. 반이나 기간을 좁히거나 CSV로 받아 주세요.</div>':''):'<div class="b2-muted">이 기간에 상담일지가 없습니다.</div>'}</div></section>`;
 }
 function render(){
  if(!life.alive())return;
  host.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  if(err&&!mons.length&&!logs.length){$('#moBody').innerHTML=errorBox(err);return;}
  $('#moBody').innerHTML=(err?errorBox(err):'')+(view==='counsel'?counselHtml():checkupHtml());
 }
 async function load({fresh=false}={}){
  const n=++seq;
  try{
   const [m,c,b]=await Promise.all([client.monitors({},{fresh}),client.counsels({},{fresh}),client.bundle('all').catch(()=>null)]);
   if(n!==seq||!life.alive())return;
   mons=records(m);logs=counselLogs(c);bundle=b;err='';
  }catch(e){if(n!==seq||!life.alive())return;err=e;}
  render();
 }
 async function confirmMon(key){
  const r=mons.find(x=>`${x.cls}|${x.date}`===key);if(!r||busy)return;busy=key;render();
  try{await client.monitorConfirm({cls:r.cls,date:r.date,on:!r.confirmed,was:r.sig});toast(`${classLabel(r.cls)} ${md(r.date)} ${r.confirmed?'운영팀 확인을 취소했습니다':'운영팀 확인했습니다'}.`);}
  catch(e){toast(isConflict(e)?'그사이 담임이 기록을 고쳤습니다. 새로 읽었으니 내용을 다시 확인해 주세요.':`확인하지 못했습니다: ${e.message}`);}
  busy='';await load({fresh:true});
 }
 async function confirmLog(key){
  const c=logs.find(x=>`${x.cls}|${x.name}|${x.round}`===key);if(!c||busy)return;busy=key;openLog=key;render();
  try{await client.counselConfirm({cls:c.cls,name:c.name,round:c.round,on:!c.confirmed,was:c.sig});toast(`${classLabel(c.cls)} ${c.name} ${c.round}차 면담 ${c.confirmed?'운영팀 확인을 취소했습니다':'운영팀 확인했습니다'}.`);}
  catch(e){toast(isConflict(e)?'그사이 담임이 면담 기록을 고쳤습니다. 새로 읽었으니 내용을 다시 확인해 주세요.':`확인하지 못했습니다: ${e.message}`);}
  busy='';await load({fresh:true});
 }
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t||t.disabled)return;
  if(t.dataset.view){view=t.dataset.view;render();return;}
  if(t.dataset.cell){detail=t.dataset.cell;render();$('#moDetail')?.scrollIntoView?.({block:'nearest'});return;}
  if(t.dataset.confirmMon){void confirmMon(t.dataset.confirmMon);return;}
  if(t.dataset.confirmLog){void confirmLog(t.dataset.confirmLog);return;}
  if(t.dataset.openCls){cls=t.dataset.openCls;$('#moClass').value=cls;render();return;}
  const a=t.dataset.act;
  if(a==='reload')void load({fresh:true});
  if(a==='close-detail'){detail='';render();}
  if(a==='csv-checkup')downloadCsv(`운영모니터링_반운영점검_${cls==='all'?'전체':cls+'반'}_${from}_${to}.csv`,M.monitorCsv(M.pickRecords(mons,{cls,from,to,flagOnly}).slice().reverse()));
  if(a==='csv-counsel')downloadCsv(`운영모니터링_상담일지_${cls==='all'?'전체':cls+'반'}_${from}_${to}.csv`,M.counselCsv(filteredLogs().slice().reverse()));
 });
 host.addEventListener('toggle',ev=>{const d=ev.target;if(d.matches?.('details[data-log]')&&d.open)openLog=d.dataset.log;},true);
 host.addEventListener('change',ev=>{
  const t=ev.target;
  if(t.id==='moClass'){cls=t.value;render();}
  if(t.id==='moFrom'&&M.isIso(t.value)){from=t.value;render();}
  if(t.id==='moTo'&&M.isIso(t.value)){to=t.value;render();}
  if(t.id==='moFlagOnly'){flagOnly=t.checked;render();}
 });
 await load();
 return {dispose:()=>life.dispose(),reload:()=>load({fresh:true})};
}
