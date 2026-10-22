// 공지·설정 › 교육비 기준(사용자 2026-10-22): 단위기간마다 결석 몇 일까지 교육비를 받는지(N일) 관리자가 정합니다.
// 판정은 출결 현황(통계 '교육비' 칸)·반 현황(교육비 미수령)에서 보입니다(allowance-core.mjs). 저장: settings/allowanceRule(allowance-store.mjs).
import {esc,loading,lifecycle,toast} from './beta2-ui.mjs';
import {UNIT_PERIODS,trainingDays,mdLabel} from './cohort.mjs';
import {DEFAULT_ALLOWANCE_RULE,MAX_LIMIT,validateAllowanceRule,ruleText} from './allowance-core.mjs';
import {readAllowanceDoc,saveAllowanceRule} from './allowance-store.mjs';
const STYLE=`.b2al table{border-collapse:collapse;width:100%;max-width:760px;background:#fff}.b2al th,.b2al td{border:1px solid #e2e8f0;padding:9px 10px;text-align:left;font-size:13px}
.b2al th{background:#f8fafc;font-weight:800}.b2al input[type=number]{width:72px;font:inherit;font-size:14px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px}
.b2al .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.b2al label.chk{display:inline-flex;gap:6px;align-items:center;font-size:13px}`;
export async function mount(host,{db,user}){
 const life=lifecycle(host);
 let base=null,draft=null,busy=false,loadErr='';
 host.innerHTML=`<div class="b2 b2al"><style>${STYLE}</style><div class="b2-head"><div><h2>교육비 기준</h2><p>단위기간마다 결석이 몇 일까지면 교육비를 받는지 정합니다. 출결 현황(통계)과 반 현황에서 학생별 수령·미수령으로 보입니다. 수료 판정과는 따로입니다.</p></div></div><div id="alBody">${loading('교육비 기준을 불러오는 중…')}</div></div>`;
 const $=s=>host.querySelector(s);
 const full=p=>trainingDays({from:p.from,to:p.to}).length;
 async function load(){
  loadErr='';$('#alBody').innerHTML=loading('교육비 기준을 불러오는 중…');
  try{base=await readAllowanceDoc(db,user,{fresh:true});}catch(e){base=null;loadErr=e?.message||String(e);}
  if(!life.alive())return;
  const v=base?.rule?validateAllowanceRule(base.rule):null;
  draft=v?.ok?v.data:{units:{...DEFAULT_ALLOWANCE_RULE.units},convert:true};
  render();
 }
 function render(){
  const when=base?.updatedAt?new Date(base.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
  $('#alBody').innerHTML=`${loadErr?`<div class="b2-note err">저장된 기준을 읽지 못했습니다 · ${esc(loadErr)} (기본값을 보여 줍니다. 저장은 막습니다)</div>`:''}
  <div class="b2-tiny b2-muted" style="margin:0 0 10px">${base?.exists?`저장본 ${base.rev}번 · ${esc(base.updatedBy||'?')}${when?` · ${esc(when)}`:''}`:'저장본 없음 · 기본값(꽉 찬 단위기간 80% 출석 허용) 사용 중'}</div>
  <table><thead><tr><th>단위기간</th><th>기간</th><th>교육일</th><th>결석 한도(N일)</th><th>참고: 80% 출석 허용</th></tr></thead><tbody>${UNIT_PERIODS.map(p=>{const d=full(p);return `<tr><td><b>${p.no}단위</b></td><td>${mdLabel(p.from)}~${mdLabel(p.to)}</td><td>${d}일</td><td><input type="number" min="0" max="${MAX_LIMIT}" step="1" data-unit="${p.no}" value="${draft.units[String(p.no)]}" aria-label="${p.no}단위 결석 한도"> 일까지 수령</td><td>${Math.floor(d*0.2+1e-9)}일</td></tr>`;}).join('')}</tbody></table>
  <div class="row"><label class="chk"><input type="checkbox" id="alConvert" ${draft.convert?'checked':''}> 지각·조퇴·외출 3회 = 결석 1일로 셈(그 단위기간 회수만, 단위기간 이수와 같은 셈)</label></div>
  <div class="row"><button class="b2-btn" id="alSave" ${busy||loadErr?'disabled':''}>저장</button><button class="b2-btn ghost" id="alReload">새로 불러오기</button><span class="b2-tiny b2-muted">지금 기준: ${esc(ruleText(draft))}</span></div>
  <div class="b2-note">한도와 같으면 수령, 넘으면 미수령입니다. 진행 중인 단위기간에서 이미 한도를 넘은 학생은 '미수령 확정'으로 보입니다. 인정 출결(인정출석·인정지각 등)과 해당없음은 세지 않습니다.</div>`;
  host.querySelectorAll('[data-unit]').forEach(i=>i.oninput=()=>{const n=Number(i.value);draft.units[i.dataset.unit]=i.value!==''&&Number.isInteger(n)?n:NaN;});
  $('#alConvert').onchange=e=>{draft.convert=e.target.checked;};
  $('#alReload').onclick=()=>void load();
  $('#alSave').onclick=async()=>{
   const v=validateAllowanceRule(draft);if(!v.ok){toast(v.errors[0]);return;}
   busy=true;render();
   try{const rev=await saveAllowanceRule(db,user,v.data,{baseRev:base?.rev||0});busy=false;toast(`교육비 기준을 저장했습니다(저장본 ${rev}번)`);await load();}
   catch(e){busy=false;toast(e.message);if(life.alive())render();}
  };
 }
 await load();
 return {dispose(){}};
}
