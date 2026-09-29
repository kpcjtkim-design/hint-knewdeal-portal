import {DROPOUT_SHEET_ID,DROPOUT_TAB,OPERATIONS_SHEET_ID,MAX_TOTAL_ABSENCE,readDropoutRows,classTabs,classAttendance,evaluateAll,verdictLabel} from './dropout-core.mjs';
import {koreaToday,quoteSheet} from './attendance-beta-core.mjs';
const GOOGLE='https://sheets.googleapis.com/v4/spreadsheets/';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=d=>d?`${+d.slice(5,7)}/${+d.slice(8)}`:'';
const KIND={수료가능:'ok',제적:'bad',확인필요:'check'};
// Read only. The Google token lives in this module's memory only.
export async function readDropoutSources(get){
 const q=encodeURIComponent,meta=await get(`${GOOGLE}${OPERATIONS_SHEET_ID}?fields=sheets.properties(title)`);
 const tabs=classTabs((meta.sheets||[]).map(s=>s.properties.title)),ids=Object.keys(tabs).sort((a,b)=>a-b);
 if(ids.length!==17)throw Error(`운영총괄 반별 탭을 17개 확인하지 못했습니다(${ids.length}개).`);
 const [ops,faq]=await Promise.all([
  get(`${GOOGLE}${OPERATIONS_SHEET_ID}/values:batchGet?${ids.map(id=>'ranges='+q(quoteSheet(tabs[id])+'!M18:ZZ48')).join('&')}&valueRenderOption=FORMATTED_VALUE`),
  get(`${GOOGLE}${DROPOUT_SHEET_ID}/values/${q(quoteSheet(DROPOUT_TAB)+'!A1:T300')}?valueRenderOption=FORMATTED_VALUE`)
 ]);
 if((ops.valueRanges||[]).length!==ids.length)throw Error('운영총괄 출결을 전부 읽지 못했습니다.');
 const classes={},failures=[];
 ids.forEach((id,i)=>{try{classes[id]=classAttendance(ops.valueRanges[i].values);}catch(e){failures.push(`${id}반: ${e.message}`);}});
 return {classes,failures,entries:readDropoutRows(faq.values)};
}
export async function mountDropoutStatus(host,{user}){
 const root=host.shadowRoot||host.attachShadow({mode:'open'});let token='',busy=false,disposed=false,results=[],failures=[],filter='all',search='',notice='',error='',loadedAt='',open=new Set();
 root.innerHTML=`<link rel="stylesheet" href="/metrics.css"><style>
 .badge{display:inline-block;padding:3px 9px;border-radius:6px;font-weight:700;font-size:12px}.badge.ok{background:#dcfce7;color:#166534}.badge.bad{background:#fee2e2;color:#991b1b}.badge.check{background:#fef3c7;color:#854d0e}.badge.plan{outline:2px dashed #275fe8;outline-offset:1px}
 .metric-table{white-space:normal;font-size:12px}.metric-table th,.metric-table td{padding:8px;vertical-align:top}.metric-table th,.metric-table .nw{white-space:nowrap}.metric-table .txt{min-width:120px;max-width:220px}.metric-table button{white-space:nowrap;padding:5px 9px}.metric-table td span{white-space:nowrap}.issues{white-space:pre-wrap;color:#9c5800;min-width:180px;max-width:280px}.note{white-space:pre-wrap;color:#62768d;min-width:120px;max-width:200px}.fail{color:#b91c1c}.p-bad{color:#b91c1c;font-weight:700}
 .days{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0}.days span{border:1px solid #dae4ef;border-radius:6px;padding:2px 7px;font-size:12px}.days .결석{background:#fee2e2}.days .지각,.days .조퇴,.days .외출{background:#fef3c7}
 .rules{font-size:12px;color:#526b83;margin:0;padding-left:18px}</style>
 <h2>중도포기 · 수료 판정</h2><ul class="rules"><li>근로개시일(F열) 직전 수업일까지 출석해야 하며, 그 전까지 출석하지 않은 날은 결석으로 계산합니다. 그 이후 날짜는 출석으로 간주합니다.</li><li>포기일(G열)까지는 운영총괄 출결을 사용하고, 아직 입력되지 않은 날은 출석 예정으로 봅니다. 포기일이 오늘 이후면 <b>예정</b>입니다.</li><li>무단 지각·조퇴·외출은 단위기간마다 3회를 결석 1일로 환산합니다. 중복 표기는 2회로 셉니다.</li><li>수료 조건: 단위기간별 결석이 해당 기간 수업일의 절반 미만이고, 전체 무단결석이 ${MAX_TOTAL_ABSENCE}일 이하여야 합니다. 개인사정 포기는 제적입니다.</li></ul>
 <section class="metric-panel"><div class="metric-toolbar"><button id="dropSync" class="primary">동기화 · 판정</button><label>구분<select id="dropFilter"><option value="all">전체</option><option value="수료가능">수료가능</option><option value="제적">제적</option><option value="예정">예정</option><option value="확인필요">확인필요</option></select></label><label>이름 검색<input id="dropSearch" placeholder="이름"></label><a href="https://docs.google.com/spreadsheets/d/${DROPOUT_SHEET_ID}/edit" target="_blank" rel="noopener">중도포기자 시트 열기</a></div><p id="dropState" class="metric-status" role="status"></p><div id="dropCards"></div><div class="metric-table-wrap"><table class="metric-table"><thead><tr><th>순번</th><th>이름</th><th>반</th><th>판정</th><th>포기사유</th><th>근로개시일</th><th>포기일(마지막 수강)</th><th>필수 출석</th><th>근로전 결석</th><th>1차</th><th>2차</th><th>3차</th><th>전체 무단결석</th><th>확인 사항</th><th>시트 기존 메모</th><th></th></tr></thead><tbody id="dropRows"></tbody></table></div></section>`;
 const $=s=>root.querySelector(s);
 async function authorize(){const {GoogleAuthProvider,reauthenticateWithPopup}=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');const p=new GoogleAuthProvider();p.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');p.setCustomParameters({login_hint:user.email});const r=await reauthenticateWithPopup(user,p),c=GoogleAuthProvider.credentialFromResult(r);if(!c?.accessToken)throw Error('Google 시트 연결을 완료하지 못했습니다.');return c.accessToken;}
 async function get(url){const r=await fetch(url,{headers:{authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(40000)}),d=await r.json().catch(()=>({}));if(r.status===401){token='';throw Error('Google 연결이 만료됐습니다. 다시 연결해 주세요.');}if(r.status===403)throw Error('현재 Google 계정에 시트 읽기 권한이 없습니다.');if(!r.ok)throw Error(d.error?.message||`Google Sheets 오류 (${r.status})`);return d;}
 const group=r=>r.verdict==='확인필요'?'확인필요':r.scheduled?'예정':r.verdict;
 function period(r,i){const p=r.periods[i];if(!p)return '';return `<span class="${p.ok?'':'p-bad'}" title="결석 ${p.absent}일 + 지각·조퇴·외출 ${p.partial}회(→${p.converted}일)">${p.total} / ${p.days}</span>`;}
 function render(){
  if(disposed)return;
  $('#dropState').innerHTML=(busy?'불러오는 중…':esc(notice))+(error?`<div class="fail">${esc(error)}</div>`:'')+(failures.length?`<div class="fail">${esc(failures.join('\n'))}</div>`:'');
  const count=g=>results.filter(r=>group(r)===g).length;
  $('#dropCards').innerHTML=results.length?`<div class="metric-cards">${[['전체',results.length,'중도포기자(교육생) 시트'],['수료가능',count('수료가능'),'포기일 도래 · 조건 충족'],['제적',count('제적'),'포기일 도래 · 조건 미충족'],['예정',count('예정'),'포기일이 아직 오지 않음'],['확인필요',count('확인필요'),'시트 입력 확인 필요']].map(([a,b,c])=>`<article><small>${a}</small><strong>${b}</strong><p>${c}</p></article>`).join('')}</div>`:'';
  const q=search.trim(),shown=results.filter(r=>(filter==='all'||group(r)===filter)&&(!q||r.name.includes(q)));
  $('#dropRows').innerHTML=shown.map(r=>{const k=r.no+r.name,detail=open.has(k);return `<tr><td>${esc(r.no.replace(/\.0$/,''))}</td><td class="nw"><b>${esc(r.name)}</b></td><td class="nw">${r.classId?esc(r.classId)+'반':''}</td><td class="nw"><span class="badge ${KIND[r.verdict]}${r.scheduled&&r.verdict!=='확인필요'?' plan':''}">${esc(verdictLabel(r))}</span></td><td class="txt">${esc(r.reason)}</td><td class="txt">${esc(r.startText)}</td><td class="txt">${esc(r.lastText)}${r.lastDate?`<br><small class="muted">${short(r.lastDate)}${r.scheduled?' · 예정':''}</small>`:''}</td><td>${r.requiredUntil?short(r.requiredUntil)+'까지':''}</td><td>${r.periods.length?r.preStartAbsence+'일':''}</td><td>${period(r,0)}</td><td>${period(r,1)}</td><td>${period(r,2)}</td><td>${r.totalAbsence===null?'':`<span class="${r.totalAbsence>MAX_TOTAL_ABSENCE?'p-bad':''}">${r.totalAbsence} / ${MAX_TOTAL_ABSENCE}</span>`}</td><td class="issues">${esc([r.verdict==='제적'?r.basis:'',...r.issues].filter(Boolean).join('\n'))}</td><td class="note">${esc(r.sheetNote)}</td><td>${r.days.length?`<button data-k="${esc(k)}">${detail?'닫기':'일자별'}</button>`:''}</td></tr>${detail?`<tr><td colspan="16"><div class="days">${r.days.filter(d=>d.status!=='출석'||d.basis!=='운영총괄').filter(d=>!(d.status==='출석'&&d.basis==='근로개시 이후 출석 간주')).map(d=>`<span class="${esc(d.status)}" title="${esc(d.basis)}${d.raw?' · 시트: '+esc(d.raw):''}">${short(d.date)} ${esc(d.status)}${d.basis!=='운영총괄'?' · '+esc(d.basis):''}</span>`).join('')||'특이 출결 없음'}</div></td></tr>`:''}`;}).join('')||`<tr><td colspan="16" class="muted">${results.length?'조건에 맞는 학생이 없습니다.':'동기화 · 판정을 누르면 결과가 표시됩니다.'}</td></tr>`;
  root.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{const k=b.dataset.k;open.has(k)?open.delete(k):open.add(k);render();});
  root.querySelectorAll('button').forEach(b=>{if(!b.dataset.k)b.disabled=busy;});$('#dropSync').textContent=busy?'동기화 중…':'동기화 · 판정';
 }
 async function load(){
  if(busy)return;busy=true;error='';render();
  try{if(!token)token=await authorize();const today=koreaToday();let data;try{data=await readDropoutSources(get);}catch(e){if(token)throw e;token=await authorize();data=await readDropoutSources(get);}if(disposed)return;failures=data.failures;results=evaluateAll(data.entries,data.classes,today);loadedAt=new Date().toLocaleTimeString('ko-KR');notice=`${today} 기준 · ${results.length}명 판정 · ${loadedAt} 불러옴 (중도포기자 시트 + 운영총괄 출결 실시간)`;}
  catch(e){error=e.message;}finally{busy=false;render();}
 }
 $('#dropSync').onclick=()=>load();
 $('#dropFilter').onchange=e=>{filter=e.target.value;render();};$('#dropSearch').oninput=e=>{search=e.target.value;render();};
 notice='동기화 · 판정을 누를 때마다 중도포기자 시트와 운영총괄 출결을 새로 읽어 자동 판정합니다. 처음 한 번은 Google 계정 확인 창이 열립니다. 원본 시트는 수정하지 않습니다.';render();
 return {canLeave:()=>true,dispose(){disposed=true;token='';}};
}
