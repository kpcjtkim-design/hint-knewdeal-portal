// 2기 출결 현황: 통계·증빙서류·질병 인정·중도탈락을 한 화면의 보기 전환으로 묶었습니다. 자료는 마스터시트 출결원장. 기준(질병 4/6회·수료 80%)은 cohort.json.
import {studentStats,evidenceRows,extraEvidenceRows,diseaseReport,dropoutRows,recognizedType} from './beta2-core.mjs';
import {EXTRA_DOC,EXTRA_LABEL,EXTRA_NOTICE} from './attendance-reason-catalog.mjs';
import {EVIDENCE_PERIODS} from './attendance-evidence-core.mjs';
import {esc,md,badge,extraBadge,classOptions,loading,errorBox,lifecycle,copyText,downloadCsv} from './beta2-ui.mjs';
import {DISEASE,COMPLETION_RATE as PASS,withoutTestClasses} from './cohort.mjs';

export const STATUS_TABS=[['stats','출결 통계'],['evidence','증빙서류'],['disease','질병 인정'],['dropout','중도탈락·수료']];
const pct=v=>v===null?'-':`${v.toFixed(1)}%`;

export async function mount(host,{client,classes,selected,context,teacherClass=null,tab,hideTabs=false}){
 const life=lifecycle(host);
 let extraAll=false,view=tab||context?.tab||'stats',cls=teacherClass?String(teacherClass):String(context?.classId&&context?.tab?context.classId:'all'),period='all',search='',bundle=null,checkhere=null,checkhereFor='';
 host.innerHTML=`<div class="b2">${hideTabs?'':`<div class="b2-head"><div><h2>출결 현황</h2><p>마스터시트 출결원장 기준 통계·증빙서류·질병 인정·중도탈락을 한곳에서 봅니다.</p></div></div><div class="b2-tabs" role="tablist" id="s2Tabs"></div>`}
 <section class="b2-card"><div class="b2-toolbar">${teacherClass?'':`<label class="b2-field">반<select id="s2Class">${classOptions(classes,cls,{all:true})}</select></label>`}
  <label class="b2-field">기간<select id="s2Period">${EVIDENCE_PERIODS.map(p=>`<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>
  <label class="b2-field">이름 찾기<input id="s2Search" autocomplete="off" placeholder="이름"></label><span class="b2-grow"></span>
  <button class="b2-btn" id="s2Copy">명단 복사</button><button class="b2-btn" id="s2Csv">CSV 내려받기</button><button class="b2-btn" id="s2Reload">새로고침</button></div>
  <div id="s2Body">${loading()}</div></section></div>`;
 const $=s=>host.querySelector(s),body=$('#s2Body');
 let current={rows:[],csv:[],copy:''};
 const range=()=>{const p=EVIDENCE_PERIODS.find(x=>x.id===period)||EVIDENCE_PERIODS[0];return {from:p.from,to:p.to<bundle.today?p.to:bundle.today};};
 const stats=()=>{const {from,to}=range();return studentStats(bundle,{cls:cls==='all'?null:cls,from,to}).filter(s=>!search||s.name.includes(search));};
 const classLabel=id=>`${id}반`;
 function table(head,rows){return `<div class="b2-table-wrap"><table class="b2-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${head.length}"><div class="b2-muted b2-pad">해당하는 학생이 없습니다.</div></td></tr>`}</tbody></table></div>`;}
 function statBoxes(items){return `<div class="b2-stats" style="padding-top:12px">${items.map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${esc(l)}</span></div>`).join('')}</div>`;}
 async function render(){
  if(!life.alive()||!bundle)return;
  if(!hideTabs){$('#s2Tabs').innerHTML=STATUS_TABS.map(([k,l])=>`<button class="b2-tab" role="tab" data-view="${k}" aria-selected="${view===k}">${l}</button>`).join('');}
  const list=stats(),{from,to}=range(),title=`${cls==='all'?'전체 반':classLabel(cls)} · ${md(from)} ~ ${md(to)}`;
  if(view==='stats'){
   const sorted=[...list].sort((a,b)=>(a.rate??101)-(b.rate??101)||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko'));
   const active=list.filter(s=>s.status==='재학'&&s.rate!==null),avg=active.length?active.reduce((n,s)=>n+s.rate,0)/active.length:null,low=active.filter(s=>s.rate<PASS).length;
   const rec=s=>Object.entries(s.counts).filter(([k])=>recognizedType(k)).reduce((n,[,v])=>n+v,0);
   body.innerHTML=statBoxes([['학생',list.length],['평균 출석률',pct(avg)],[`${PASS}% 미만`,low,low?'bad':''],['중도탈락 등',list.filter(s=>s.status!=='재학').length]])+table(['반','이름','상태','교육일','출석률','결석','지각','조퇴','외출','인정'],sorted.map(s=>`<tr class="${s.rate!==null&&s.rate<PASS&&s.status==='재학'?'diff':''}"><td>${s.cls}반</td><td class="b2-name">${esc(s.name)}</td><td>${s.status==='재학'?'재학':`${esc(s.status)}${s.changed?' · '+md(s.changed):''}`}</td><td>${s.days}</td><td><b>${pct(s.rate)}</b></td><td>${s.counts['결석']||0}</td><td>${s.counts['지각']||0}</td><td>${s.counts['조퇴']||0}</td><td>${s.counts['외출']||0}</td><td>${rec(s)}</td></tr>`));
   current={csv:[['반','이름','상태','교육일','출석률','결석','지각','조퇴','외출','인정'],...sorted.map(s=>[s.cls,s.name,s.status,s.days,s.rate===null?'':s.rate.toFixed(1),s.counts['결석']||0,s.counts['지각']||0,s.counts['조퇴']||0,s.counts['외출']||0,rec(s)])],copy:[`출결 통계 · ${title}`,...sorted.filter(s=>s.rate!==null&&s.rate<PASS).map(s=>`${s.cls}반 · ${s.name} · ${pct(s.rate)} · 결석 ${s.counts['결석']||0}`)].join('\n')};
  }
  if(view==='evidence'){
   // 취업박람회 추가 증빙(사용자 요청 2026-10-20 ③): 증빙 목록에 '추가 증빙 필요' 배지, 아래에 이행 여부(미제출·반려·확인) 목록 — 못 한 것만/전체
   const rows=evidenceRows(list),extra=extraEvidenceRows(bundle,{cls:cls==='all'?null:cls,from,to}).filter(r=>!search||r.name.includes(search)),open=extra.filter(r=>!r.done),shown=extraAll?extra:open;
   const extraCell=r=>r.extra?' '+extraBadge({state:r.state,done:false,label:EXTRA_LABEL}):'';
   body.innerHTML=statBoxes([['미제출',rows.filter(r=>r.state==='미제출').length,'bad'],['반려 · 보완',rows.filter(r=>r.state==='반려').length,'alert'],['학생',new Set(rows.map(r=>r.cls+r.name)).size],['추가 증빙 미이행',open.length,open.length?'alert':'']])+table(['반','이름','교육일','유형','사유','서류 상태','반려 사유'],rows.map(r=>`<tr><td>${r.cls}반</td><td class="b2-name">${esc(r.name)}</td><td>${md(r.date)}</td><td>${badge(r.type)}</td><td>${esc(r.reason)}</td><td><span class="b2-badge e-miss">${esc(r.state)}</span>${extraCell(r)}</td><td>${esc(r.evr)}</td></tr>`))
    +`<h3 style="margin:16px 14px 8px">추가 증빙 · 취업박람회 (${EXTRA_DOC})</h3><div class="b2-note warn" style="margin:0 14px 8px">${esc(EXTRA_NOTICE)} 증빙이 「확인」이 되면 이행으로 봅니다.</div><div class="b2-chips" style="margin:0 14px 8px"><button class="b2-chip" data-extra="open" aria-pressed="${!extraAll}">미이행 <span class="n">${open.length}</span></button><button class="b2-chip" data-extra="all" aria-pressed="${extraAll}">전체 <span class="n">${extra.length}</span></button></div>`
    +table(['반','이름','교육일','유형','사유','이행 여부'],shown.map(r=>`<tr class="${r.done?'':'diff'}"><td>${r.cls}반</td><td class="b2-name">${esc(r.name)}</td><td>${md(r.date)}</td><td>${badge(r.type)}</td><td>${esc(r.reason)}</td><td>${extraBadge({state:r.state,done:r.done,label:EXTRA_LABEL})}${r.evr?` <span class="b2-sub">반려: ${esc(r.evr)}</span>`:''}</td></tr>`));
   let last='';const lines=[`출결 증빙서류 제출·보완 요청 (${title})`];for(const r of rows){if(last!==r.cls){last=r.cls;lines.push('',`[${r.cls}반]`);}lines.push(`${r.name} · ${md(r.date)} · ${r.type} · ${r.state==='반려'?'반려 · 보완 필요'+(r.evr?` (${r.evr})`:''):'미제출'}${r.extra?` · 추가 증빙: ${EXTRA_DOC}`:''}`);}
   if(!rows.length)lines.push('제출·보완 대상이 없습니다.');
   if(open.length)lines.push('',`[추가 증빙 · 취업박람회 ${EXTRA_DOC}]`,...open.map(r=>`${r.cls}반 · ${r.name} · ${md(r.date)} · ${r.type} · ${r.state}`));
   current={csv:[['반','이름','교육일','유형','사유','서류 상태','반려 사유','추가 증빙'],...rows.map(r=>[r.cls,r.name,r.date,r.type,r.reason,r.state,r.evr,r.extra?EXTRA_DOC:'']),...extra.filter(r=>r.done).map(r=>[r.cls,r.name,r.date,r.type,r.reason,r.state,r.evr,`${EXTRA_DOC} · 이행`])],copy:lines.join('
')};
  }
  if(view==='disease'){
   const ids=cls==='all'?withoutTestClasses(classes).map(c=>String(c.id)):[cls];// 전체는 테스트반 뺌
   if(checkhereFor!==ids.join(',')){body.innerHTML=loading('체크히어 질병 메모 기록과 대조하는 중…');checkhereFor=ids.join(',');checkhere=await client.checkhereDisease(ids);if(!life.alive())return;}
   const report=diseaseReport(list,checkhere||{}),missing=ids.filter(id=>!checkhere?.[id]);
   body.innerHTML=`<div class="b2-note" style="margin:12px 14px 0">출결원장의 인정 기록 중 사유가 병원·병결·병가·진료 등인 날을 셉니다. ${DISEASE.warn}회 주의 · ${DISEASE.max}회 기준 · ${DISEASE.max+1}회부터 초과. 체크히어 '인정○○ + 병원' 메모와 날짜가 다르면 아래 '확인 필요'에 따로 보여 줍니다.</div>`
    +statBoxes([[`${DISEASE.warn}회 이상`,report.rows.length,report.rows.length?'alert':''],[`주의 (${DISEASE.warn}~${DISEASE.max-1}회)`,report.warning],[`${DISEASE.max}회 도달`,report.atLimit,report.atLimit?'alert':''],[`${DISEASE.max}회 초과`,report.exceeded,report.exceeded?'bad':''],['확인 필요',report.review.length,report.review.length?'alert':'']])
    +table(['반','이름','인정 횟수','상태','인정일'],report.rows.map(r=>`<tr class="${r.count>=DISEASE.max?'diff':''}"><td>${r.cls}반</td><td class="b2-name">${esc(r.name)}</td><td><b>${r.count}/${DISEASE.max}회</b></td><td><span class="b2-badge ${r.count>DISEASE.max?'t-absent':r.count===DISEASE.max?'t-late':'t-rec'}">${esc(r.level)}</span></td><td>${r.dates.map(md).join(', ')}</td></tr>`))
    +`<h3 style="margin:16px 14px 8px">확인 필요 · 출결원장과 체크히어 메모가 다른 날</h3>`+table(['반','이름','출결원장에만 있음','체크히어 메모에만 있음'],report.review.map(r=>`<tr><td>${r.cls}반</td><td class="b2-name">${esc(r.name)}</td><td>${r.onlyLedger.map(md).join(', ')||'-'}</td><td>${r.onlyCheckHere.map(md).join(', ')||'-'}</td></tr>`))
    +(missing.length?`<div class="b2-note warn" style="margin:10px 14px">체크히어 집계 저장본이 없는 반: ${missing.map(classLabel).join(', ')} · 이 반은 출결원장 기준만 봅니다.</div>`:'');
   current={csv:[['반','이름','인정 횟수','상태','인정일','출결원장에만','체크히어에만'],...report.rows.map(r=>[r.cls,r.name,r.count,r.level,r.dates.join(' '),r.onlyLedger.join(' '),r.onlyCheckHere.join(' ')])],copy:['질병 인정출석 제한위험자 · 출결원장 기준',...report.rows.map(r=>`${r.cls}반 · ${r.name} · ${r.count}/${DISEASE.max}회 · ${r.level} · ${r.dates.map(md).join(', ')}`)].join('\n')};
  }
  if(view==='dropout'){
   const {left,risk}=dropoutRows(list);
   body.innerHTML=statBoxes([['중도탈락·조기취업 등',left.length],[`수료 위험 (${PASS}% 미만)`,risk.length,risk.length?'bad':'']])+`<h3 style="margin:14px 14px 8px">재학 아님</h3>`+table(['반','이름','상태','변경일','재학 기간 출석률','결석'],left.map(s=>`<tr><td>${s.cls}반</td><td class="b2-name">${esc(s.name)}</td><td>${esc(s.status)}</td><td>${s.changed?md(s.changed):'-'}</td><td>${pct(s.rate)}</td><td>${s.counts['결석']||0}</td></tr>`))
    +`<h3 style="margin:16px 14px 8px">수료 위험 · 출석률 ${PASS}% 미만 재학생</h3>`+table(['반','이름','출석률','결석','교육일'],risk.sort((a,b)=>a.rate-b.rate).map(s=>`<tr class="diff"><td>${s.cls}반</td><td class="b2-name">${esc(s.name)}</td><td><b>${pct(s.rate)}</b></td><td>${s.counts['결석']||0}</td><td>${s.days}</td></tr>`));
   current={csv:[['구분','반','이름','상태','변경일','출석률','결석'],...left.map(s=>['재학 아님',s.cls,s.name,s.status,s.changed,s.rate===null?'':s.rate.toFixed(1),s.counts['결석']||0]),...risk.map(s=>['수료 위험',s.cls,s.name,s.status,'',s.rate.toFixed(1),s.counts['결석']||0])],copy:[`중도탈락·수료 위험 · ${title}`,...left.map(s=>`${s.cls}반 · ${s.name} · ${s.status}${s.changed?' '+md(s.changed):''}`),...risk.map(s=>`${s.cls}반 · ${s.name} · 수료 위험 ${pct(s.rate)}`)].join('\n')};
  }
 }
 async function load(fresh=false){
  try{bundle=await client.bundle(teacherClass?cls:'all',{fresh});if(fresh)checkhereFor='';await render();}catch(e){if(life.alive())body.innerHTML=errorBox(e);}
 }
 host.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;void render();}const x=e.target.closest('[data-extra]');if(x){extraAll=x.dataset.extra==='all';void render();}});
 if($('#s2Class'))$('#s2Class').onchange=e=>{cls=e.target.value;void render();};
 $('#s2Period').onchange=e=>{period=e.target.value;void render();};
 $('#s2Search').oninput=e=>{search=e.target.value.trim();void render();};
 $('#s2Copy').onclick=()=>copyText(current.copy||'');
 $('#s2Csv').onclick=()=>downloadCsv(`출결현황_${STATUS_TABS.find(t=>t[0]===view)[1]}_${cls==='all'?'전체':cls+'반'}.csv`,current.csv||[]);
 $('#s2Reload').onclick=()=>void load(true);
 await load();
 return {dispose:()=>life.dispose(),setView(v){view=v;void render();}};
}
