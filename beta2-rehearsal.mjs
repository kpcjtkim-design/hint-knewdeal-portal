// 공지·설정 › 운영 리허설(관리자만, 2026-10-21). 시나리오는 beta2-rehearsal-core.mjs(17반·'가상' 학생만 보내는 보호 포함).
// 관리자가 직접 누를 때만 돕니다(자동 실행 없음). 마지막 결과 요약은 Firestore settings/rehearsalLast(관리자만 읽고 씀, firestore.rules settings 규칙)에,
// 못 쓰면 이 브라우저(localStorage)에 남깁니다.
import {esc,toast,lifecycle} from './beta2-ui.mjs';
import {createRehearsal,summarize,SCENARIOS,DEFAULTS,REHEARSAL_CLASS,REASON,DATE_BASE} from './beta2-rehearsal-core.mjs';
import {getTestAsOf} from './beta2-asof.mjs';

export const LAST_PATH=['settings','rehearsalLast'];
const LOCAL_KEY='hint.b2.rehearsalLast';
const STYLE=`.b2rh .b2rh-form{display:flex;gap:10px 14px;flex-wrap:wrap;align-items:end}.b2rh .b2rh-form input{width:90px}
.b2rh .b2rh-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.b2rh .b2rh-log{font:12px/1.5 Consolas,Menlo,monospace;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px 12px;max-height:260px;overflow:auto;white-space:pre-wrap;margin:0}
.b2rh .b2rh-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.b2rh .b2rh-sum>div{border:1px solid var(--b2-line);border-radius:10px;padding:10px 12px;background:#fff}
.b2rh .b2rh-sum b{display:block;font-size:18px}.b2rh .pass{color:#166534}.b2rh .fail{color:#b91c1c}.b2rh table td,.b2rh table th{vertical-align:top}`;
const sec=ms=>ms==null?'-':`${(ms/1000).toFixed(1)}초`;
const msText=ms=>ms==null?'-':`${Math.round(ms)}ms`;
const verdict=x=>x.skipped?'<span class="b2-badge t-na">안 함</span>':x.pass?'<span class="b2-badge e-ok">통과</span>':'<span class="b2-badge t-absent">실패</span>';
function detail(x){
 if(x.skipped)return '';
 const bits=[];
 if(x.total!==undefined)bits.push(`보냄 ${x.total} · 접수 ${x.accepted??'-'} · 반영 실패 ${x.failed??0}${x.pending?` · 남음 ${x.pending}`:''}`);
 if(x.p50!==undefined)bits.push(`접수 지연 p50 ${msText(x.p50)} · p95 ${msText(x.p95)}`);
 if(x.appliedMs!==undefined)bits.push(`모두 반영까지 ${sec(x.appliedMs)}`);
 if(x.missing!==undefined)bits.push(`빠짐 ${x.missing} · 겹침 ${x.duplicates}`);
 if(x.memos)bits.push(`대조 메모 ${x.memos}`);
 if(x.docs&&!Array.isArray(x.docs))bits.push(`서류 신청 ${x.docs.id||'-'} · 두 번 보냄 → ${x.docs.repeated?'한 건(repeated)':'확인 안 됨'}${x.docs.error?` · ${x.docs.error}`:''}`);
 if(x.checks)for(const c of x.checks)bits.push(`${c.pass?'✔':'✘'} ${c.label}: ${(c.results||[]).join(' / ')}`);
 if(x.left!==undefined)bits.push(`지움 ${x.deleted} · 메모 비움 ${x.memoCleared} · 남은 리허설 기록 ${x.left}`);
 if(Array.isArray(x.docs))bits.push(`서류 ${x.docs.map(d=>`${d.id} ${d.note}`).join(', ')||'없음'}`);
 for(const e of x.errors||[])bits.push(`오류: ${e}`);
 if(x.error)bits.push(`멈춤: ${x.error}`);
 return bits.map(b=>`<div class="b2-sub">${esc(b)}</div>`).join('');
}
export function summaryHtml(sum){
 if(!sum)return '<div class="b2-muted">아직 리허설 기록이 없습니다.</div>';
 const s=id=>sum.scenarios.find(x=>x.id===id)||{};
 const t=s('teachers'),a=s('admins');
 const card=(label,value,cls='')=>`<div><span class="b2-small b2-muted">${esc(label)}</span><b class="${cls}">${esc(value)}</b></div>`;
 return `<div class="b2rh-sum" data-rehearsal-summary>${card('전체',sum.pass?'통과':'실패',sum.pass?'pass':'fail')}${SCENARIOS.map(([id,label])=>{const x=s(id);return card(label,x.skipped||!x.id?'안 함':x.pass?'통과':'실패',x.skipped||!x.id?'':x.pass?'pass':'fail');}).join('')}
  ${t.p50!==undefined?card('담임 접수 p50 / p95',`${msText(t.p50)} / ${msText(t.p95)}`):''}${t.appliedMs!==undefined?card(`담임 ${t.total??''}건 모두 반영`,sec(t.appliedMs)):''}${a.p50!==undefined?card('운영자 접수 p50 / p95',`${msText(a.p50)} / ${msText(a.p95)}`):''}</div>
  <div class="b2-table-wrap" style="margin-top:10px"><table class="b2-table" data-rehearsal-table><thead><tr><th>시나리오</th><th>결과</th><th>내용</th></tr></thead><tbody>${sum.scenarios.map(x=>`<tr data-scenario="${esc(x.id)}"><td><b>${esc(x.label)}</b></td><td>${verdict(x)}</td><td>${detail(x)}</td></tr>`).join('')}</tbody></table></div>
  <div class="b2-tiny b2-muted" style="margin-top:6px">${esc(sum.at||'')} · ${esc(sum.by||'')}</div>`;
}
async function fs(){return import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');}
export async function readLast(db){
 try{if(db){const {doc,getDoc}=await fs(),s=await getDoc(doc(db,...LAST_PATH));if(s.exists()&&s.data()?.summary)return s.data().summary;}}catch(e){console.warn('리허설 기록을 읽지 못했습니다',e);}
 try{const raw=localStorage.getItem(LOCAL_KEY);return raw?JSON.parse(raw):null;}catch{return null;}
}
export async function saveLast(db,user,summary){
 const plain=JSON.parse(JSON.stringify(summary));
 try{localStorage.setItem(LOCAL_KEY,JSON.stringify(plain));}catch{}
 if(!db)return 'local';
 try{const {doc,setDoc,serverTimestamp}=await fs();await setDoc(doc(db,...LAST_PATH),{summary:plain,by:String(user?.email||''),updatedAt:serverTimestamp()});return 'firestore';}
 catch(e){console.warn('리허설 기록을 Firestore에 남기지 못했습니다',e);return 'local';}
}
const docIdsOf=sum=>(sum?.scenarios||[]).flatMap(x=>Array.isArray(x.docs)?x.docs.map(d=>d.id):x.docs?.id?[x.docs.id]:[]).filter(Boolean);

// makeRehearsal: 시험에서 가짜 시나리오를 넣을 때(기본은 createRehearsal)
export async function mount(host,{client,user,db,makeRehearsal=createRehearsal,confirmFn=t=>confirm(t)}={}){
 const life=lifecycle(host);
 let running='',last=null,logLines=[];
 const opts={teachers:DEFAULTS.teachers,items:DEFAULTS.items,admins:DEFAULTS.admins,adminSaves:DEFAULTS.adminSaves};
 host.innerHTML=`<div class="b2 b2rh"><style>${STYLE}</style><div class="b2-head"><div><h2>운영 리허설</h2><p>담임 16명이 한꺼번에 출결을 넣고, 바쁜 날 운영자 여럿이 같이 고치고, 담임↔운영·운영↔운영이 같은 칸을 고칠 때 안전장치가 막는지 실제 시트로 시험합니다. 만족도·체크히어는 빼고 봅니다.</p></div></div>
 <div class="b2-note warn" style="margin-bottom:12px" data-rehearsal-guard><b>보호:</b> ${REHEARSAL_CLASS}반(테스트반)과 이름이 '가상'으로 시작하는 학생에게만 씁니다. 그 밖의 학생에게 가는 요청은 화면이 보내지 않습니다. 출결은 개강 전 지난 날짜(${DATE_BASE.conflicts.slice(5)}~7월)에 사유 '${REASON}'로만 만들고 「4. 정리」가 모두 지웁니다. 서류 신청은 지울 수 없어 '취소'와 비고 '${REASON}'로 표시합니다. 시험 중에는 17반 출결판에 잠깐 보일 수 있습니다.</div>
 <section class="b2-card b2-pad" style="margin-bottom:12px"><div class="b2rh-form">
  <label class="b2-field">담임 수<input type="number" min="1" max="16" data-o="teachers" value="${opts.teachers}"></label>
  <label class="b2-field">담임마다 건수<input type="number" min="1" max="100" data-o="items" value="${opts.items}"></label>
  <label class="b2-field">운영자 수<input type="number" min="1" max="8" data-o="admins" value="${opts.admins}"></label>
  <label class="b2-field">운영자마다 저장<input type="number" min="1" max="30" data-o="adminSaves" value="${opts.adminSaves}"></label></div>
  <div class="b2rh-acts" id="rhActs"></div></section>
 <section class="b2-card b2-pad" style="margin-bottom:12px"><h3 style="margin:0 0 10px">결과</h3><div id="rhSum"></div></section>
 <section class="b2-card b2-pad"><h3 style="margin:0 0 10px">진행</h3><pre class="b2rh-log" id="rhLog" aria-live="polite"></pre></section></div>`;
 const $=s=>host.querySelector(s);
 const log=t=>{const line=`${new Date().toLocaleTimeString('ko-KR',{hour12:false})} ${t}`;logLines.push(line);if(logLines.length>400)logLines=logLines.slice(-400);const el=$('#rhLog');if(el){el.textContent=logLines.join('\n');el.scrollTop=el.scrollHeight;}};
 function paint(){
  if(!life.alive())return;
  $('#rhActs').innerHTML=[...SCENARIOS.map(([id,label])=>`<button class="b2-btn ${id==='cleanup'?'warn':''}" data-run="${id}" ${running?'disabled':''}>${esc(running===id?label+' 도는 중…':label)}</button>`),`<button class="b2-btn primary" data-run="all" ${running?'disabled':''}>${running==='all'?'전체 실행 도는 중…':'전체 실행(1·2 함께 → 3 → 4)'}</button>`].join('');
  $('#rhSum').innerHTML=summaryHtml(last);
 }
 host.addEventListener('input',e=>{const k=e.target.dataset?.o;if(k)opts[k]=Math.max(1,Math.min(Number(e.target.max)||100,Math.floor(Number(e.target.value)||1)));});
 async function run(which){
  if(running)return;
  const asOf=getTestAsOf(user);
  const what=which==='all'?'전체(담임 동시 입력과 운영자 동시 작업을 함께 → 충돌 → 정리)':SCENARIOS.find(([id])=>id===which)?.[1];
  if(!confirmFn(`운영 리허설 · ${what}\n\n${REHEARSAL_CLASS}반·가상 학생에게만, 지난 날짜에 '${REASON}' 기록을 만들고${which==='cleanup'||which==='all'?' 지웁니다':' 나중에 「4. 정리」로 지웁니다'}.\n담임 ${opts.teachers}명 × ${opts.items}건, 운영자 ${opts.admins}명 × ${opts.adminSaves}건.${asOf?`\n(시험 기준일 ${asOf}은 리허설 쓰기와 상관없습니다)`:''}\n시작할까요?`))return;
  running=which;logLines=[];paint();log(`시작: ${what}`);
  const r=makeRehearsal({client,log,options:opts}),results={};
  const step=async id=>{try{results[id]=await r[id](id==='cleanup'?{extraDocIds:docIdsOf(last)}:undefined);log(`${SCENARIOS.find(([k])=>k===id)[1]}: ${results[id].pass?'통과':'실패'}`);}catch(e){results[id]={id,pass:false,error:String(e?.message||e)};log(`${id} 멈춤: ${e?.message||e}`);}};
  try{
   if(which==='all'){await Promise.all([step('teachers'),step('admins')]);await step('conflicts');await step('cleanup');}
   else await step(which);
  }finally{
   const prev=last;last=summarize(results,{by:user?.email||'',options:opts});
   // 따로 돌린 시나리오는 앞 기록의 다른 시나리오 결과를 남겨 둡니다(한 화면에서 차례로 돌릴 때).
   if(which!=='all'&&prev?.scenarios)last.scenarios=last.scenarios.map(x=>x.skipped?(prev.scenarios.find(p=>p.id===x.id)||x):x),last.pass=last.scenarios.filter(x=>!x.skipped).every(x=>x.pass);
   const where=await saveLast(db,user,last);
   running='';if(life.alive()){paint();toast(`운영 리허설 ${last.pass?'통과':'실패 있음'} · 결과를 ${where==='firestore'?'공유 기록(settings/rehearsalLast)':'이 브라우저'}에 남겼습니다`);}
  }
 }
 host.addEventListener('click',e=>{const b=e.target.closest('button[data-run]');if(b&&!b.disabled)void run(b.dataset.run);});
 paint();
 readLast(db).then(s=>{if(s&&!last){last=s;paint();}}).catch(()=>{});
 return {dispose:()=>life.dispose(),canLeave:()=>!running||confirmFn('운영 리허설이 도는 중입니다. 화면을 떠나면 진행을 볼 수 없습니다(요청은 계속 갑니다). 떠날까요?')};
}
