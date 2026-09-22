import {createWorkStore} from './operations-work-store.mjs';
import {summarizeClassWork,teacherHandoff} from './operations-work-core.mjs';
import {loadSurveyLinks} from './survey-links.mjs';
import {EVIDENCE_PERIODS} from './attendance-evidence-core.mjs';
import {koreaToday} from './attendance-beta-core.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'없음';
export async function mountOperationsWork(host,{db,user,classes,mode='work',canApprove=false,onOpen=()=>{}}){
 const root=host.shadowRoot||host.attachShadow({mode:'open'}),store=createWorkStore(db,user),bundles=new Map(),selected=new Set(classes.map(c=>String(c.id)));
 let disposed=false,busy=false,epoch=0,catalog=null,config={},requests=[],requestError='',configError='',today=koreaToday(),date=today,period='all',reports=[];
 const alive=()=>!disposed&&host.isConnected;
 root.innerHTML=`<link rel="stylesheet" href="/operations-work.css"><section><header><div><small>HINT / OPERATIONS</small><h2>${mode==='handoff'?'담임 전달사항':'오늘 업무 현황'}</h2><p>저장된 출결·설문 결과와 체크히어 요청을 모아 봅니다. 시트 재수집이나 자동 저장은 하지 않습니다.</p></div><button id="refresh">현황 새로 읽기</button></header><div class="filters"><label>기준 날짜 <input id="date" type="date" min="2026-07-27" max="${today}" value="${date}"></label><label>서류·설문·요청 기간 <select id="period">${EVIDENCE_PERIODS.map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</select></label><button id="all">전체 반</button><button id="none">선택 해제</button><div class="classes">${classes.map(c=>`<label><input type="checkbox" data-class="${esc(c.id)}" checked>${esc(c.id)}반</label>`).join('')}</div></div><p id="progress" role="status"></p><div id="summary"></div><div id="details"></div><section id="handoff"><div class="copy-head"><h3>선택 반 전달문</h3><button id="copy" disabled>전달사항 복사</button></div><p>반별·학생별로 묶습니다. 복사 전에 편집할 수 있습니다. 관리자 내부 메모와 체크히어 승인 업무는 포함하지 않습니다.</p><textarea id="message" aria-label="담임 전달사항 편집" rows="14"></textarea><p id="copied" role="status"></p></section></section>`;
 const $=s=>root.querySelector(s),progress=$('#progress');
 $('#handoff').hidden=mode!=='handoff';
 function render(){
  if(!alive())return;const p=EVIDENCE_PERIODS.find(x=>x.id===period),to=date<p.to?date:p.to;
  reports=classes.filter(c=>selected.has(String(c.id))&&bundles.has(String(c.id))).map(c=>summarizeClassWork(c,{...bundles.get(String(c.id)),errors:{...bundles.get(String(c.id)).errors,...(configError?{config:configError}:{})}},{date,through:to,from:p.from,catalog,config,requests,requestError}));
  const count=key=>reports.reduce((n,r)=>n+r[key].length,0),unloaded=classes.filter(c=>selected.has(String(c.id))&&!bundles.has(String(c.id))).length;
  const missingCoverage=key=>reports.filter(r=>!r[key]).length+unloaded,coverageText=(key,label)=>missingCoverage(key)?`${label} ${missingCoverage(key)}개 반`:'';
  $('#summary').innerHTML=`<div class="counts"><div>출결 확인<strong>${reports.some(r=>r.covered)?count('attendance')+'건':'미확인'}</strong><small>반별 기준 교육일 · ${coverageText('covered','미확인')||'조회 완료'}</small></div><div>서류 미제출·반려<strong>${reports.some(r=>r.evidenceCovered)?count('evidence')+'건':'미확인'}</strong><small>선택 기간 누적 · ${coverageText('evidenceCovered','미확인')||'조회 완료'}${count('evidenceUnknown')?' · 상태 미확인 '+count('evidenceUnknown')+'건':''}</small></div><div>설문 미응답<strong>${reports.some(r=>r.surveyCovered)?count('surveyItems')+'건':'미확인'}</strong><small>${coverageText('surveyCovered','미확인')||'저장본 기준'}${count('surveyUnchecked')?' · 대조 확인 '+count('surveyUnchecked')+'개 설문':''}</small></div><div>체크히어 대기 / 실패<strong>${requestError?'미확인':count('pending')+' / '+count('failed')+'건'}</strong><small>재처리로 완료된 원본 제외</small></div></div>${unloaded?`<p class="warn">${unloaded}개 반 불러오는 중 · 아직 집계되지 않았습니다.</p>`:''}${reports.some(r=>r.notes.length)?'<p class="warn">미확인·갱신 필요 항목은 위 숫자에 포함되지 않을 수 있습니다. 아래 반별 확인사항을 함께 확인해 주세요.</p>':''}`;
  $('#details').innerHTML=reports.map(r=>`<details class="class-card"><summary><b>${r.classId}반</b><span>출결 ${r.covered?r.attendance.length:'미확인'} · 서류 ${r.evidenceCovered?r.evidence.length:'미확인'} · 설문 ${r.surveyCovered?r.surveyItems.length:'미확인'} · 요청 ${r.requestError?'미확인':r.pending.length} · 실패 ${r.requestError?'미확인':r.failed.length}</span><em class="${r.notes.length?'warn':''}">${r.notes.length?'자료 확인 필요':'저장 자료 집계'}</em></summary><p class="source">출결 확인 교육일 ${r.target||'미확인'} · 출결 동기화 ${esc(stamp(r.syncedAt))} · 서류·설문·요청 ${r.from>r.through?'선택 기간 시작 전':r.from+' ~ '+r.through}</p>${r.notes.length?`<p class="warn">${r.notes.map(esc).join(' · ')}</p>`:''}<div class="actions"><button data-open="attendanceOverview" data-cid="${r.classId}" data-date="${r.target}">출결대조 열기</button><button data-open="surveys" data-cid="${r.classId}">만족도조사 열기</button>${canApprove?'<button data-open="checkhere">체크히어 요청 처리</button>':''}</div><div data-items="${r.classId}"></div>${r.surveyUnchecked.length?`<p class="warn">설문 동기화 확인: ${r.surveyUnchecked.map(e=>esc(e.title)+' ('+esc(e.label)+')').join(' · ')}</p>`:''}${r.pending.length||r.failed.length?`<p>본부 처리: 승인·반영 대기 ${r.pending.length}건 / 실패 건 다시 처리 ${r.failed.length}건</p>`:''}</details>`).join('')||'<p>반을 선택해 주세요.</p>';
  $('#details').querySelectorAll('.class-card').forEach((card,index)=>{card.ontoggle=()=>{if(card.open&&!card.querySelector('[data-items]').childElementCount){const r=reports[index],box=card.querySelector('[data-items]');box.innerHTML=itemTable(r);const rows=[...r.attendance,...r.evidence,...r.surveyItems,...r.surveyReview];let shown=100;const more=box.querySelector('[data-more]');if(more)more.onclick=()=>{box.querySelector('tbody').insertAdjacentHTML('beforeend',rows.slice(shown,shown+100).map(itemRow).join(''));shown+=100;more.hidden=shown>=rows.length;};}};});
  $('#details').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>onOpen(b.dataset.open,{classId:b.dataset.cid,date:b.dataset.date}));
  if(!busy){$('#message').value=teacherHandoff(reports);$('#copy').disabled=!reports.length;$('#copied').textContent='';}
 }
 const itemRow=i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.date)}</td><td>${esc(i.label)}</td></tr>`;
 function itemTable(r){
  const rows=[...r.attendance,...r.evidence,...r.surveyItems,...r.surveyReview];if(!rows.length)return '<p>확정된 상세 항목이 없습니다.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>학생</th><th>날짜</th><th>확인할 일</th></tr></thead><tbody>${rows.slice(0,100).map(itemRow).join('')}</tbody></table>${rows.length>100?'<button data-more>100건 더 보기</button>':''}</div>`;
 }
 async function load(fresh=false){
  if(busy)return;busy=true;const run=++epoch;$('#refresh').disabled=true;$('#copy').disabled=true;$('#message').disabled=true;progress.textContent='공통 설정과 요청 현황을 읽는 중…';
  try{
   const global=await Promise.allSettled([loadSurveyLinks(),store.config({fresh}),store.requests({fresh})]);if(!alive()||run!==epoch)return;
   catalog=global[0].status==='fulfilled'?global[0].value:null;config=global[1].status==='fulfilled'?global[1].value:{};configError=global[1].status==='rejected'?'설문 설정 읽기 실패':'';requests=global[2].status==='fulfilled'?global[2].value:[];requestError=global[2].status==='rejected'?'요청 읽기 실패':'';
   let done=0;for(const c of classes){if(!alive()||run!==epoch)return;progress.textContent=`${c.id}반 저장자료 확인 중 · ${done}/${classes.length}반`;
    try{bundles.set(String(c.id),await store.readClass(String(c.id),{fresh}));}catch(e){bundles.set(String(c.id),{errors:{summary:e.message,timetable:e.message,surveys:e.message}});}if(!alive()||run!==epoch)return;done++;render();
   }
   progress.textContent=`${done}개 반 확인 · ${stamp(new Date().toISOString())} · 자동 반복 조회 없음 · 같은 로그인에서는 1분간 재사용`;
  }finally{busy=false;if(alive()&&run===epoch){$('#refresh').disabled=false;$('#message').disabled=false;render();}}
 }
 $('#refresh').onclick=()=>void load(true);
 $('#date').onchange=()=>{if(!$('#date').value||$('#date').value>today||$('#date').value<'2026-07-27'){$('#date').value=date;return;}date=$('#date').value;render();};
 $('#period').onchange=()=>{period=$('#period').value;render();};
 root.querySelectorAll('[data-class]').forEach(x=>x.onchange=()=>{x.checked?selected.add(x.dataset.class):selected.delete(x.dataset.class);render();});
 function selectAll(checked){selected.clear();root.querySelectorAll('[data-class]').forEach(x=>{x.checked=checked;if(checked)selected.add(x.dataset.class);});render();}
 $('#all').onclick=()=>selectAll(true);$('#none').onclick=()=>selectAll(false);
 $('#copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#message').value);$('#copied').textContent='복사했습니다. 전달할 대화방에 붙여넣어 주세요.';}catch{$('#message').focus();$('#message').select();$('#copied').textContent='자동 복사를 사용할 수 없습니다. 선택된 내용을 직접 복사해 주세요.';}};
 void load();return {dispose(){disposed=true;epoch++;}};
}
