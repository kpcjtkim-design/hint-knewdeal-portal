// 담임 화면 출결 › 식비·교육비(사용자 2026-10-22 "담임화면에서 식비 교육비는 출결 부분으로"): 보기만.
// 교육비: 운영팀이 정한 단위기간별 결석 한도(settings/allowanceRule, allowance-core)로 우리 반 학생마다 수령·미수령. 출결은 마스터시트 출결원장(b2Bundle).
// 식비: 운영팀이 시간표 관리 › 식비에서 정한 우리 반 교육일별 O·X(settings/mealPlan). 고치는 것은 운영팀만 합니다.
// 두 설정은 Firestore 규칙 v5부터 담임이 읽을 수 있습니다. 못 읽으면 그 칸만 안내 글을 보입니다(기본값으로 틀린 판정을 보이지 않음).
import {doc,getDoc} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {studentStats} from './beta2-core.mjs';
import {esc,loading,lifecycle,errorBox} from './beta2-ui.mjs';
import {TRAINING_DAYS,UNIT_PERIODS,mdLabel} from './cohort.mjs';
import {setAllowanceRule,validateAllowanceRule,allowanceRule,allowanceUnits,ruleText} from './allowance-core.mjs';
import {cleanPlan,mealOf,mealLabel,mealCounts} from './meal-core.mjs';
const CSS=`.fee .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px}.fee h3{margin:0 0 4px;font-size:16px}.fee .sub{color:#64748b;font-size:12px;margin:0 0 10px}
.fee table{border-collapse:collapse;width:100%}.fee th,.fee td{border-bottom:1px solid #eef2f7;padding:7px 8px;text-align:left;font-size:13px;white-space:nowrap}.fee th{background:#f8fafc;font-weight:800;font-size:12px}
.fee .st{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:800;background:#f1f5f9;color:#475569}.fee .st.ok{background:#e7f6ec;color:#146c2e}.fee .st.bad{background:#fdecea;color:#9f1d14}.fee .st.run{background:#eff6ff;color:#1d4ed8}
.fee tr.off td{color:#94a3b8}.fee .wrap{overflow:auto}.fee .cal{display:grid;grid-template-columns:repeat(5,minmax(44px,1fr));gap:6px;max-width:420px}.fee .cal div{border-radius:8px;padding:6px 4px;text-align:center;font-size:12px;background:#f8fafc;color:#94a3b8}
.fee .cal div b{display:block;font-size:15px}.fee .cal .O{background:#c8ecd4;color:#146c2e}.fee .cal .X{background:#f8cfca;color:#9f1d14}.fee .cal .gap{background:transparent}.fee .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 10px}
.fee select{font:inherit;padding:4px 8px;border:1px solid #cbd5e1;border-radius:8px}.fee .note{color:#64748b;font-size:12px}`;
const tone=s=>s==='수령'?'ok':s==='미수령'||s==='미수령 확정'?'bad':s==='진행 중'?'run':'';
export async function mount(host,{db,client,teacherClass}){
 const life=lifecycle(host),cls=String(teacherClass);
 const months=[...new Set(TRAINING_DAYS.map(d=>d.slice(0,7)))];
 let month='',ruleErr='',mealErr='',plan={},stats=[],today='';
 host.innerHTML=`<div class="fee"><style>${CSS}</style><div id="feeBody">${loading('식비·교육비를 불러오는 중…')}</div></div>`;
 const $=s=>host.querySelector(s);
 async function load(fresh=false){
  const [b,r,m]=await Promise.allSettled([client.bundle(cls,fresh?{fresh:true}:undefined),getDoc(doc(db,'settings','allowanceRule')),getDoc(doc(db,'settings','mealPlan'))]);
  if(!life.alive())return;
  if(b.status==='rejected'){$('#feeBody').innerHTML=errorBox(b.reason);return;}
  today=b.value.today||'';stats=studentStats(b.value,{cls});
  if(r.status==='fulfilled'){const d=r.value.exists()?r.value.data():null,v=d?.rule?validateAllowanceRule(d.rule):null;setAllowanceRule(v?.ok?v.data:null);ruleErr='';}
  else ruleErr='운영팀 교육비 기준을 읽지 못했습니다. 운영팀이 설정 권한을 열면 보입니다.';
  if(m.status==='fulfilled'){plan=cleanPlan(m.value.exists()?m.value.data()?.plan:{});mealErr='';}
  else mealErr='운영팀 식비 표를 읽지 못했습니다. 운영팀이 설정 권한을 열면 보입니다.';
  month||=months.find(x=>today.startsWith(x))||months[0];
  paint();
 }
 function feeHtml(){
  if(ruleErr)return `<div class="card"><h3>교육비</h3><p class="note">${esc(ruleErr)}</p></div>`;
  const rows=[...stats].sort((a,b)=>(a.status==='재학'?0:1)-(b.status==='재학'?0:1)||a.name.localeCompare(b.name,'ko'));
  const fail=rows.filter(s=>s.status==='재학'&&allowanceUnits(s.units).some(a=>a.failed)).length;
  return `<div class="card"><h3>교육비 <span class="note">· 미수령 ${fail}명</span></h3><p class="sub">단위기간마다 결석 한도 안이면 수령합니다 · 기준: ${esc(ruleText(allowanceRule()))} · 기준은 운영팀이 정합니다.</p>
  <div class="wrap"><table><thead><tr><th>이름</th><th>상태</th>${UNIT_PERIODS.map(p=>`<th>${p.no}단위 <span class="note">${mdLabel(p.from)}~${mdLabel(p.to)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(s=>{const al=allowanceUnits(s.units);
   return `<tr class="${s.status==='재학'?'':'off'}"><td><b>${esc(s.name)}</b></td><td>${esc(s.status)}</td>${al.map(a=>`<td>${a.state==='해당없음'?'<span class="note">-</span>':`<span class="st ${tone(a.state)}">${esc(a.state)}</span>${a.state!=='시작 전'?` <span class="note">결석 ${a.count}/${a.limit}일</span>`:''}`}</td>`).join('')}</tr>`;}).join('')||'<tr><td colspan="5" class="note">명부에 학생이 없습니다.</td></tr>'}</tbody></table></div>
  <p class="note">진행 중인 단위기간에서 이미 한도를 넘으면 '미수령 확정'입니다. 인정 출결과 해당없음은 세지 않습니다${allowanceRule().convert?' · 지각·조퇴·외출 3회 = 결석 1일(그 단위기간 회수만)':''}.</p></div>`;
 }
 function mealHtml(){
  if(mealErr)return `<div class="card"><h3>식비</h3><p class="note">${esc(mealErr)}</p></div>`;
  const days=TRAINING_DAYS.filter(d=>d.startsWith(month)),n=mealCounts(plan,cls,days),all=mealCounts(plan,cls,TRAINING_DAYS);
  const col=d=>(new Date(d+'T12:00:00Z').getUTCDay()+6)%7+1; // 월=1 … 금=5, 칸을 요일 줄에 맞춰 놓습니다(빈 요일은 비움)
  const cells=days.map(d=>{const v=mealOf(plan,cls,d);return `<div class="${v}" style="grid-column:${col(d)}" title="${esc(`${mdLabel(d)} ${mealLabel(v)}`)}"><b>${v||'·'}</b>${mdLabel(d)}</div>`;});
  return `<div class="card"><h3>식비</h3><p class="sub">우리 반 교육일별 식비 유무입니다. O 있음 · X 없음 · 점(·)은 아직 정하지 않은 날. 운영팀이 정하고 고칩니다.</p>
  <div class="bar"><label>달 <select id="feeMonth">${months.map(m=>`<option value="${m}" ${m===month?'selected':''}>${+m.slice(5)}월</option>`).join('')}</select></label><span>이 달 O ${n.O}일 · X ${n.X}일 · 미정 ${n['']}일</span><span class="note">전체 기간 O ${all.O}일 / 교육일 ${TRAINING_DAYS.length}일</span></div>
  <div class="cal" aria-label="${+month.slice(5)}월 식비">${['월','화','수','목','금'].map(x=>`<div class="gap"><b style="font-size:12px;color:#64748b">${x}</b></div>`).join('')}${cells.join('')}</div></div>`;
 }
 function paint(){
  if(!life.alive())return;
  $('#feeBody').innerHTML=feeHtml()+mealHtml();
  const sel=$('#feeMonth');if(sel)sel.onchange=e=>{month=e.target.value;paint();};
 }
 await load();
 return {dispose:()=>life.dispose(),reload:()=>load(true)};
}
