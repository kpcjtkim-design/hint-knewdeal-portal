import {readAttendanceSummary,syncAttendanceSummary} from './attendance-derived-store.mjs';
import {DERIVED_VERSION} from './attendance-derived-core.mjs';
import {diseaseRiskReport} from './disease-recognition-core.mjs';
import {koreaToday} from './attendance-beta-core.mjs';
import {esc} from './metrics-ui.mjs';

export async function mountDiseaseRisk(host,{db,user,classes,teacherClass=null}){
 const scope=teacherClass?[teacherClass]:classes,root=host.shadowRoot||host.attachShadow({mode:'open'});
 root.innerHTML='<link rel="stylesheet" href="/metrics.css"><div id="diseaseRisk"></div>';
 const content=root.querySelector('#diseaseRisk');let selected=new Set([String(scope[0]?.id)]),data={},loaded=new Set(),busy=false,disposed=false,notice='';
 const active=()=>!disposed&&host.isConnected&&root.querySelector('#diseaseRisk')===content;
 const current=()=>Object.fromEntries([...selected].map(id=>[id,data[id]?.version===DERIVED_VERSION?data[id]:null]));
 function render(){if(!active())return;
  const report=diseaseRiskReport(current(),{today:koreaToday()});
  content.innerHTML=`<h2>질병 인정출석 제한위험자</h2><p class="muted">체크히어에 실제 저장된 ‘인정출석·인정지각·인정조퇴·인정외출 + 병원’ 관리자 메모만 셉니다. 같은 날 입실·퇴실에 모두 있어도 1회입니다. 4회부터 표시하며 6회가 기준입니다. 이 화면은 출결을 자동 변경하지 않습니다.</p>${teacherClass?'':`<fieldset><legend>조회할 반</legend><div class="metric-toolbar"><button id="riskAll">전체 선택</button><button id="riskNone">선택 해제</button>${scope.map(c=>`<label><input type="checkbox" data-class="${esc(c.id)}" ${selected.has(String(c.id))?'checked':''}>${esc(c.id)}반</label>`).join('')}</div></fieldset>`}<div class="metric-toolbar"><button id="riskRead">선택 반 새로 읽기</button>${teacherClass?'':'<button id="riskSync">최신 출결·체크히어 동기화</button>'}<button id="riskCopy" class="primary">명단 복사</button></div><p class="metric-status" role="status">${esc(notice)}</p><p><strong>4회 이상 ${report.rows.length}명</strong> · 주의 ${report.warning}명 · 6회 도달 ${report.atLimit}명 · 6회 초과 ${report.exceeded}명</p>${report.missing.length?`<p class="warning">집계 전·기존 저장본: ${report.missing.map(id=>esc(id)+'반').join(', ')}. 관리자가 출결 동기화를 실행해야 확인됩니다.</p>`:''}<p class="muted">${[...selected].filter(id=>data[id]?.version===DERIVED_VERSION).map(id=>`${esc(id)}반: ${esc(data[id].syncedAt||'시각 미기록')}`).join(' / ')}</p><div class="metric-table-wrap"><table class="metric-table"><thead><tr><th>반</th><th>학생</th><th>인정 횟수</th><th>상태</th><th>체크히어 인정일</th></tr></thead><tbody>${report.rows.map(row=>`<tr><td>${esc(row.classId)}반</td><td>${esc(row.name)}</td><td><strong>${row.count}/6회</strong></td><td><span class="metric-evidence ${row.count>=6?'required':'confirmed'}">${row.level}</span></td><td>${row.dates.map(esc).join(', ')}</td></tr>`).join('')||'<tr><td colspan="5">집계된 반에서 4회 이상인 학생이 없습니다.</td></tr>'}</tbody></table></div><p class="muted">최종 승인이나 사용 가능 여부는 담당자가 운영 기준과 원본 기록을 확인해 결정합니다. 최신 변경은 동기화 후 이 화면에 반영됩니다.</p>`;
  if(report.reviewRows.length)content.insertAdjacentHTML('beforeend',`<details><summary class="warning">학생 연결 확인 필요 ${report.reviewRows.length}명 · 자동 횟수에 포함하지 않음</summary><div class="metric-table-wrap"><table class="metric-table"><thead><tr><th>반</th><th>학생</th><th>확인할 날짜</th></tr></thead><tbody>${report.reviewRows.map(row=>`<tr><td>${esc(row.classId)}반</td><td>${esc(row.name)}</td><td>${row.dates.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table></div></details>`);
  root.querySelectorAll('[data-class]').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.class):selected.delete(el.dataset.class);render();});
  const $=s=>root.querySelector(s);if($('#riskAll'))$('#riskAll').onclick=()=>{selected=new Set(scope.map(c=>String(c.id)));render();};if($('#riskNone'))$('#riskNone').onclick=()=>{selected.clear();render();};
  $('#riskRead').onclick=()=>void read(true);
  if($('#riskSync'))$('#riskSync').onclick=()=>void run(async()=>{for(const id of selected){if(!active())return;notice=`${id}반 동기화 중…`;render();data[id]=await syncAttendanceSummary(db,user,id);loaded.add(id);}notice='선택한 반의 체크히어 인정 기록을 집계했습니다.';});
  $('#riskCopy').onclick=async()=>{const lines=['질병 인정출석 제한위험자 · 체크히어 저장 메모 기준',...report.rows.map(row=>`${row.classId}반 · ${row.name} · ${row.count}/6회 · ${row.level} · ${row.dates.join(', ')}`)];try{await navigator.clipboard.writeText(lines.join('\n'));notice='명단을 복사했습니다.';}catch{notice='복사에 실패했습니다. 브라우저 권한을 확인해 주세요.';}render();};
  if(busy)root.querySelectorAll('button,input').forEach(el=>el.disabled=true);
 }
 async function run(fn){if(busy||!active())return;busy=true;render();try{await fn();}catch(e){notice='조회 실패 · '+e.message;}finally{busy=false;render();}}
 async function read(fresh=false){await run(async()=>{for(const id of selected){if(!active())return;if(fresh||!loaded.has(id)){data[id]=await readAttendanceSummary(db,id,{user,fresh});loaded.add(id);}}notice='저장된 집계를 읽었습니다. 최신 변경은 마지막 출결 동기화 기준입니다.';});}
 await read();return{canLeave:()=>!busy,dispose(){disposed=true;}};
}
