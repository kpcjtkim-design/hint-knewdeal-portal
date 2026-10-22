// 2기 출결 현황: 통계·증빙서류·질병 인정을 한 화면의 보기 전환으로 묶었습니다. 자료는 마스터시트 출결원장. 기준(질병 4/6회·수료 80%)은 cohort.json.
// 중도탈락·수료는 2026-10-20부터 따로 화면(beta2-dropouts.mjs, 출결 › 중도탈락·수료)에서 마스터시트 중도탈락 탭과 함께 다룹니다. 예전 '중도탈락·수료' 보기로 오면 그 화면을 엽니다.
import {studentStats,evidenceRows,extraEvidenceRows,offDayRecords,diseaseReport,recognizedType} from './beta2-core.mjs';
import {EXTRA_DOC,EXTRA_LABEL,EXTRA_NOTICE} from './attendance-reason-catalog.mjs';
import {EVIDENCE_PERIODS} from './attendance-evidence-core.mjs';
import {esc,md,badge,extraBadge,classOptions,loading,errorBox,lifecycle,copyText,downloadCsv} from './beta2-ui.mjs';
import {DISEASE,COMPLETION_RATE as PASS,isTestClass} from './cohort.mjs';
import {allowanceUnits,allowanceText,ruleText} from './allowance-core.mjs';

export const STATUS_TABS=[['stats','출결 통계'],['evidence','증빙서류'],['disease','질병 인정']];
const pct=v=>v===null?'-':`${v.toFixed(1)}%`;
// '전체 기간'은 시작을 열어 둡니다: 17반 테스트반은 개강 전 기록 날도 교육일로 보므로(beta2-core classDays) 그날도 들어가야 합니다. 실제 반은 교육일자만 세므로 달라지지 않습니다.
// (attendance-evidence-core EVIDENCE_PERIODS는 1기 화면도 쓰므로 그대로 두고 여기서만 바꿉니다.)
const PERIODS=EVIDENCE_PERIODS.map(p=>p.id==='all'?{...p,from:''}:p);
// 반 이름: 테스트반은 '17반 · 테스트반'으로 분명히 보입니다.
const classLabel=id=>isTestClass(id)?`${id}반 · 테스트반`:`${id}반`;

export async function mount(host,{client,classes,selected,context,teacherClass=null,tab,hideTabs=false,open=null}){
 const life=lifecycle(host);
 if((tab||context?.tab)==='dropout'&&open&&!teacherClass){open('b2dropouts',{classId:context?.classId});return {dispose:()=>life.dispose()};}
 let extraAll=false,view=STATUS_TABS.some(([k])=>k===(tab||context?.tab))?tab||context.tab:'stats',cls=teacherClass?String(teacherClass):String(context?.classId&&context?.tab?context.classId:'all'),period='all',search='',bundle=null,checkhere=null,checkhereFor='';
 host.innerHTML=`<div class="b2">${hideTabs?'':`<div class="b2-head"><div><h2>출결 현황</h2><p>마스터시트 출결원장 기준 통계·증빙서류·질병 인정을 한곳에서 봅니다.${open?' 중도탈락·조기취업·수료 명단은 <button type="button" class="b2-btn small soft" id="s2Dropouts">중도탈락·수료</button> 화면에서 처리합니다.':''}</p></div></div><div class="b2-tabs" role="tablist" id="s2Tabs"></div>`}
 <section class="b2-card"><div class="b2-toolbar">${teacherClass?'':`<label class="b2-field">반<select id="s2Class">${classOptions(classes,cls,{all:true})}</select></label>`}
  <label class="b2-field">기간<select id="s2Period">${PERIODS.map(p=>`<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>
  <label class="b2-field">이름 찾기<input id="s2Search" autocomplete="off" placeholder="이름"></label><span class="b2-grow"></span>
  <button class="b2-btn" id="s2Copy">명단 복사</button><button class="b2-btn" id="s2Csv">CSV 내려받기</button><button class="b2-btn" id="s2Reload">새로고침</button></div>
  <div id="s2Body">${loading()}</div></section></div>`;
 const $=s=>host.querySelector(s),body=$('#s2Body');
 let current={rows:[],csv:[],copy:''};
 const range=()=>{const p=PERIODS.find(x=>x.id===period)||PERIODS[0];return {from:p.from,to:p.to<bundle.today?p.to:bundle.today,until:p.to};};
 // withTest: 증빙서류·질병 인정 '전체 반' 목록에는 테스트반 줄도 넣습니다(위 숫자 상자에서는 뺌). 출결 통계는 공식 합계라 넣지 않습니다.
 const stats=({withTest=false}={})=>{const {from,to}=range();return studentStats(bundle,{cls:cls==='all'?null:cls,from,to,withTest:withTest&&cls==='all'}).filter(s=>!search||s.name.includes(search));};
 const official=rows=>cls==='all'?rows.filter(r=>!isTestClass(r.cls)):rows;
 const testNote=(n,what)=>n?`<div class="b2-note" style="margin:8px 14px 0">테스트반 ${esc(what)} ${n}건은 목록에만 보이고 위 숫자에는 넣지 않았습니다.</div>`:'';
 function table(head,rows){return `<div class="b2-table-wrap"><table class="b2-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${head.length}"><div class="b2-muted b2-pad">해당하는 학생이 없습니다.</div></td></tr>`}</tbody></table></div>`;}
 function statBoxes(items){return `<div class="b2-stats" style="padding-top:12px">${items.map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${esc(l)}</span></div>`).join('')}</div>`;}
 async function render(){
  if(!life.alive()||!bundle)return;
  if(!hideTabs){$('#s2Tabs').innerHTML=STATUS_TABS.map(([k,l])=>`<button class="b2-tab" role="tab" data-view="${k}" aria-selected="${view===k}">${l}</button>`).join('');}
  const list=stats({withTest:view==='evidence'||view==='disease'}),{from,to,until}=range(),title=`${cls==='all'?'전체 반':classLabel(cls)} · ${from?md(from):'전체 기간'} ~ ${md(to)}`;
  if(view==='stats'){
   const sorted=[...list].sort((a,b)=>(a.rate??101)-(b.rate??101)||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko'));
   const active=list.filter(s=>s.status==='재학'&&s.rate!==null),avg=active.length?active.reduce((n,s)=>n+s.rate,0)/active.length:null,low=active.filter(s=>s.rate<PASS).length;
   const rec=s=>Object.entries(s.counts).filter(([k])=>recognizedType(k)).reduce((n,[,v])=>n+v,0);
   // 교육비(사용자 2026-10-22, 관리자만): 단위기간마다 결석 한도 N일(공지·설정 › 교육비 기준). 기간 고름과 관계없이 꽉 찬 단위기간 기준.
   const fee=!teacherClass,al=s=>allowanceUnits(s.units),feeFail=fee?list.filter(s=>s.status==='재학'&&al(s).some(a=>a.failed)).length:0;
   const feeCell=s=>`<td>${al(s).filter(a=>a.state!=='해당없음').map(a=>`<span class="b2-badge ${a.failed?'t-absent':a.state==='수령'?'t-rec':'t-na'}" title="${esc(allowanceText(a))}">${a.no}단위 ${esc(a.state)}${a.state!=='시작 전'?` ${a.count}/${a.limit}`:''}</span>`).join(' ')}</td>`;
   body.innerHTML=statBoxes([['학생',list.length],['평균 출석률',pct(avg)],[`${PASS}% 미만`,low,low?'bad':''],['중도탈락 등',list.filter(s=>s.status!=='재학').length],...(fee?[['교육비 미수령',feeFail,feeFail?'bad':'']]:[])])+(fee?`<div class="b2-tiny b2-muted" style="margin:6px 14px 0">교육비 기준: ${esc(ruleText())} · 공지·설정 › 교육비 기준에서 바꿉니다</div>`:'')+table(['반','이름','상태','교육일','출석률','결석','지각','조퇴','외출','중복','인정',...(fee?['교육비(단위기간 결석/한도)']:[])],sorted.map(s=>`<tr class="${s.rate!==null&&s.rate<PASS&&s.status==='재학'?'diff':''}"><td>${esc(classLabel(s.cls))}</td><td class="b2-name">${esc(s.name)}</td><td>${s.status==='재학'?'재학':`${esc(s.status)}${s.changed?' · '+md(s.changed):''}`}</td><td>${s.days}</td><td><b>${pct(s.rate)}</b></td><td>${s.counts['결석']||0}</td><td>${s.counts['지각']||0}</td><td>${s.counts['조퇴']||0}</td><td>${s.counts['외출']||0}</td><td>${s.counts['중복']||0}</td><td>${rec(s)}</td>${fee?feeCell(s):''}</tr>`));
   current={csv:[['반','이름','상태','교육일','출석률','결석','지각','조퇴','외출','중복','인정',...(fee?['교육비']:[])],...sorted.map(s=>[s.cls,s.name,s.status,s.days,s.rate===null?'':s.rate.toFixed(1),s.counts['결석']||0,s.counts['지각']||0,s.counts['조퇴']||0,s.counts['외출']||0,s.counts['중복']||0,rec(s),...(fee?[al(s).filter(a=>a.state!=='해당없음').map(allowanceText).join(' · ')]:[])])],copy:[`출결 통계 · ${title}`,...sorted.filter(s=>s.rate!==null&&s.rate<PASS).map(s=>`${classLabel(s.cls)} · ${s.name} · ${pct(s.rate)} · 결석 ${s.counts['결석']||0}`)].join('\n')};
  }
  if(view==='evidence'){
   // 취업박람회 추가 증빙(사용자 요청 2026-10-20 ③): 증빙 목록에 '추가 증빙 필요' 배지, 아래에 이행 여부(미제출·반려·확인) 목록 — 못 한 것만/전체
   const rows=evidenceRows(list),extra=extraEvidenceRows(bundle,{cls:cls==='all'?null:cls,from,to,withTest:cls==='all'}).filter(r=>!search||r.name.includes(search)),open=extra.filter(r=>!r.done),shown=extraAll?extra:open;
   const extraCell=r=>r.extra?' '+extraBadge({state:r.state,done:false,label:EXTRA_LABEL}):'';
   const real=official(rows),realOpen=official(open);
   // 실제 반의 교육일이 아닌 날 인정 기록은 목록에 넣지 않고 한 줄 안내(펼치면 목록)만 보입니다(사용자 2026-10-20).
   const off=offDayRecords(bundle,{cls:cls==='all'?null:cls,from,to:until}).filter(r=>!search||r.name.includes(search));
   const offNote=off.length?`<details class="b2-note warn" id="s2OffDay" style="margin:12px 14px 0"><summary>교육일이 아닌 날의 인정 기록 ${off.length}건은 통계·증빙에 들지 않습니다</summary>${table(['반','이름','날짜','유형','사유','서류 상태'],off.map(r=>`<tr><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td>${md(r.date)}</td><td>${badge(r.type)}</td><td>${esc(r.reason)}</td><td>${esc(r.state)}</td></tr>`))}</details>`:'';
   body.innerHTML=offNote+statBoxes([['미제출',real.filter(r=>r.state==='미제출').length,'bad'],['반려 · 보완',real.filter(r=>r.state==='반려').length,'alert'],['학생',new Set(real.map(r=>r.cls+r.name)).size],['추가 증빙 미이행',realOpen.length,realOpen.length?'alert':'']])+testNote(rows.length-real.length,'증빙 미제출·반려')+table(['반','이름','교육일','유형','사유','서류 상태','반려 사유'],rows.map(r=>`<tr><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td>${md(r.date)}</td><td>${badge(r.type)}</td><td>${esc(r.reason)}</td><td><span class="b2-badge e-miss">${esc(r.state)}</span>${extraCell(r)}</td><td>${esc(r.evr)}</td></tr>`))
    +`<h3 style="margin:16px 14px 8px">추가 증빙 · 취업박람회 (${EXTRA_DOC})</h3><div class="b2-note warn" style="margin:0 14px 8px">${esc(EXTRA_NOTICE)} 증빙이 「확인」이 되면 이행으로 봅니다.</div><div class="b2-chips" style="margin:0 14px 8px"><button class="b2-chip" data-extra="open" aria-pressed="${!extraAll}">미이행 <span class="n">${open.length}</span></button><button class="b2-chip" data-extra="all" aria-pressed="${extraAll}">전체 <span class="n">${extra.length}</span></button></div>`
    +table(['반','이름','교육일','유형','사유','이행 여부'],shown.map(r=>`<tr class="${r.done?'':'diff'}"><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td>${md(r.date)}</td><td>${badge(r.type)}</td><td>${esc(r.reason)}</td><td>${extraBadge({state:r.state,done:r.done,label:EXTRA_LABEL})}${r.evr?` <span class="b2-sub">반려: ${esc(r.evr)}</span>`:''}</td></tr>`));
   let last='';const lines=[`출결 증빙서류 제출·보완 요청 (${title})`];for(const r of rows){if(last!==r.cls){last=r.cls;lines.push('',`[${classLabel(r.cls)}]`);}lines.push(`${r.name} · ${md(r.date)} · ${r.type} · ${r.state==='반려'?'반려 · 보완 필요'+(r.evr?` (${r.evr})`:''):'미제출'}${r.extra?` · 추가 증빙: ${EXTRA_DOC}`:''}`);}
   if(!rows.length)lines.push('제출·보완 대상이 없습니다.');
   if(open.length)lines.push('',`[추가 증빙 · 취업박람회 ${EXTRA_DOC}]`,...open.map(r=>`${classLabel(r.cls)} · ${r.name} · ${md(r.date)} · ${r.type} · ${r.state}`));
   current={csv:[['반','이름','교육일','유형','사유','서류 상태','반려 사유','추가 증빙'],...rows.map(r=>[r.cls,r.name,r.date,r.type,r.reason,r.state,r.evr,r.extra?EXTRA_DOC:'']),...extra.filter(r=>r.done).map(r=>[r.cls,r.name,r.date,r.type,r.reason,r.state,r.evr,`${EXTRA_DOC} · 이행`])],copy:lines.join('\n')};
  }
  if(view==='disease'){
   const ids=cls==='all'?classes.map(c=>String(c.id)):[cls];// 전체 목록에 테스트반 줄도 보이므로 체크히어 메모도 함께 대조(숫자 상자에서는 뺌)
   if(checkhereFor!==ids.join(',')){body.innerHTML=loading('체크히어 질병 메모 기록과 대조하는 중…');checkhereFor=ids.join(',');checkhere=await client.checkhereDisease(ids);if(!life.alive())return;}
   const report=diseaseReport(list,checkhere||{}),box=cls==='all'?diseaseReport(official(list),checkhere||{}):report,missing=ids.filter(id=>!checkhere?.[id]);
   body.innerHTML=`<div class="b2-note" style="margin:12px 14px 0">출결원장의 인정 기록 중 사유가 병원·병결·병가·진료 등인 날을 셉니다. ${DISEASE.warn}회 주의 · ${DISEASE.max}회 기준 · ${DISEASE.max+1}회부터 초과. 체크히어 '인정○○ + 병원' 메모와 날짜가 다르면 아래 '확인 필요'에 따로 보여 줍니다.</div>`
    +statBoxes([[`${DISEASE.warn}회 이상`,box.rows.length,box.rows.length?'alert':''],[`주의 (${DISEASE.warn}~${DISEASE.max-1}회)`,box.warning],[`${DISEASE.max}회 도달`,box.atLimit,box.atLimit?'alert':''],[`${DISEASE.max}회 초과`,box.exceeded,box.exceeded?'bad':''],['확인 필요',box.review.length,box.review.length?'alert':'']])+testNote(report.rows.length-box.rows.length,`질병 인정 ${DISEASE.warn}회 이상`)
    +table(['반','이름','인정 횟수','상태','인정일'],report.rows.map(r=>`<tr class="${r.count>=DISEASE.max?'diff':''}"><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td><b>${r.count}/${DISEASE.max}회</b></td><td><span class="b2-badge ${r.count>DISEASE.max?'t-absent':r.count===DISEASE.max?'t-late':'t-rec'}">${esc(r.level)}</span></td><td>${r.dates.map(md).join(', ')}</td></tr>`))
    +`<h3 style="margin:16px 14px 8px">확인 필요 · 출결원장과 체크히어 메모가 다른 날</h3>`+table(['반','이름','출결원장에만 있음','체크히어 메모에만 있음'],report.review.map(r=>`<tr><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td>${r.onlyLedger.map(md).join(', ')||'-'}</td><td>${r.onlyCheckHere.map(md).join(', ')||'-'}</td></tr>`))
    +(missing.length?`<div class="b2-note warn" style="margin:10px 14px">체크히어 집계 저장본이 없는 반: ${missing.map(id=>esc(classLabel(id))).join(', ')} · 이 반은 출결원장 기준만 봅니다.</div>`:'');
   current={csv:[['반','이름','인정 횟수','상태','인정일','출결원장에만','체크히어에만'],...report.rows.map(r=>[r.cls,r.name,r.count,r.level,r.dates.join(' '),r.onlyLedger.join(' '),r.onlyCheckHere.join(' ')])],copy:['질병 인정출석 제한위험자 · 출결원장 기준',...report.rows.map(r=>`${classLabel(r.cls)} · ${r.name} · ${r.count}/${DISEASE.max}회 · ${r.level} · ${r.dates.map(md).join(', ')}`)].join('\n')};
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
 if($('#s2Dropouts'))$('#s2Dropouts').onclick=()=>open('b2dropouts',{classId:cls==='all'?undefined:cls});
 await load();
 return {dispose:()=>life.dispose(),setView(v){view=v;void render();}};
}
