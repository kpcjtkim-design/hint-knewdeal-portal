import {readAttendanceSummary,syncAttendanceSummary} from './attendance-derived-store.mjs';
import {EVIDENCE_PERIODS,evidenceReport,evidenceMessage} from './attendance-evidence-core.mjs';
import {koreaToday} from './attendance-beta-core.mjs';
import {esc} from './metrics-ui.mjs';
export async function mountAttendanceEvidence(host,{db,user,classes,teacherClass=null}){
 const scope=teacherClass?[teacherClass]:classes,root=host.shadowRoot||host.attachShadow({mode:'open'});
 root.innerHTML='<link rel="stylesheet" href="/metrics.css"><div id="evidence"></div>';
 const content=root.querySelector('#evidence');let selected=new Set([String(scope[0]?.id)]),loaded=new Set(),data={},period='all',from='2026-07-27',to=koreaToday(),status='outstanding',busy=false,disposed=false,notice='';
 const current=()=>Object.fromEntries([...selected].map(cid=>[cid,data[cid]||null]));
 function render(){if(disposed)return;const report=evidenceReport(current(),{from,to,status}),message=evidenceMessage(report,{from,to});
  const table=rows=>`<div class="metric-table-wrap"><table class="metric-table"><thead><tr><th>반</th><th>학생</th><th>교육일</th><th>출결 구분</th><th>서류 상태</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.classId)}반</td><td>${esc(r.name)}</td><td>${r.date}</td><td>${esc(r.attendance)}</td><td><span class="metric-evidence required">${esc(r.status)}</span></td></tr>`).join('')||'<tr><td colspan="5">해당 내역이 없습니다.</td></tr>'}</tbody></table></div>`;
  content.innerHTML=`<h2>증빙서류 현황</h2><p class="muted">미제출·반려 내역을 모았습니다. 기존 출결 동기화 결과를 사용하며, 기간 선택은 추가 DB 조회 없이 적용됩니다.</p>${teacherClass?'':`<fieldset><legend>조회할 반</legend><div class="metric-toolbar"><button id="evAll">전체 선택</button><button id="evNone">선택 해제</button>${scope.map(c=>`<label><input type="checkbox" data-class="${esc(c.id)}" ${selected.has(String(c.id))?'checked':''}>${esc(c.id)}반</label>`).join('')}</div></fieldset>`}<div class="metric-toolbar"><label>단위기간<select id="evPeriod">${EVIDENCE_PERIODS.map(p=>`<option value="${p.id}" ${period===p.id?'selected':''}>${p.label}</option>`).join('')}<option value="custom" ${period==='custom'?'selected':''}>직접 선택</option></select></label><label>시작일<input id="evFrom" type="date" value="${from}"></label><label>종료일<input id="evTo" type="date" value="${to}" max="${koreaToday()}"></label><label>서류 상태<select id="evStatus">${[['outstanding','미제출 + 반려'],['미제출','미제출'],['반려','반려 · 보완 필요']].map(([v,l])=>`<option value="${v}" ${status===v?'selected':''}>${l}</option>`).join('')}</select></label><button id="evRead">선택 반 조회</button>${teacherClass?'':'<button id="evSync">최신 출결·서류 동기화</button>'}<button id="evCopy" class="primary">전달 문구 복사</button></div><p role="status">${esc(notice)}</p><p><strong>${report.students}명 · ${report.rows.length}건</strong> ${report.missing.length?`· 미수집 ${report.missing.map(x=>esc(x)+'반').join(', ')}`:''}</p><p class="muted">${[...selected].filter(cid=>data[cid]).map(cid=>`${esc(cid)}반: ${esc(data[cid].syncedAt||data[cid].asOf||'시각 미기록')}`).join(' / ')}</p>${from>to?'<p class="warning">시작일이 종료일보다 늦습니다.</p>':''}${table(report.rows)}${report.unknown.length?`<details><summary>서류 상태 미확인 ${report.unknown.length}건 · 제출 요청 명단에서 제외</summary>${table(report.unknown)}</details>`:''}<details><summary>전달 문구 확인</summary><textarea id="evMessage" readonly rows="12" style="width:100%;box-sizing:border-box">${esc(message)}</textarea></details>`;
  const $=s=>root.querySelector(s);
  root.querySelectorAll('[data-class]').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.class):selected.delete(el.dataset.class);render();});
  if($('#evAll'))$('#evAll').onclick=()=>{selected=new Set(scope.map(c=>String(c.id)));render();};if($('#evNone'))$('#evNone').onclick=()=>{selected.clear();render();};
  $('#evPeriod').onchange=e=>{period=e.target.value;const p=EVIDENCE_PERIODS.find(p=>p.id===period);if(p){from=p.from;to=p.to;}render();};
  for(const [id,key]of [['#evFrom','from'],['#evTo','to']])$(id).onchange=e=>{if(key==='from')from=e.target.value;else to=e.target.value;period='custom';render();};
  $('#evStatus').onchange=e=>{status=e.target.value;render();};$('#evRead').onclick=()=>void read(true);
  if($('#evSync'))$('#evSync').onclick=()=>void run(async()=>{for(const cid of selected){if(disposed)return;notice=`${cid}반 동기화 중…`;render();data[cid]=await syncAttendanceSummary(db,user,cid);loaded.add(cid);}notice='선택한 반의 최신 출결·서류를 반영했습니다.';});
  $('#evCopy').onclick=async()=>{try{await navigator.clipboard.writeText(message);notice='전달 문구를 복사했습니다.';render();}catch{const el=$('#evMessage');el.closest('details').open=true;el.select();notice='전달 문구를 선택했습니다. 복사해 주세요.';}};
  if(busy)root.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
 }
 async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){notice='조회 실패 · '+e.message;}finally{busy=false;render();}}
 async function read(force=false){await run(async()=>{for(const cid of selected){if(disposed)return;if(force||!loaded.has(cid)){data[cid]=await readAttendanceSummary(db,cid);loaded.add(cid);}}notice='저장된 서류 상태를 읽었습니다. 최신 정보는 마지막 출결 동기화 기준입니다.';});}
 await read();return {canLeave:()=>!busy,dispose(){disposed=true;}};
}
