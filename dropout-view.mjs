import {DROPOUT_SHEET_ID,DROPOUT_TAB,OPERATIONS_SHEET_ID,MAX_TOTAL_ABSENCE,readDropoutRows,classTabs,classAttendance,evaluateAll,verdictLabel,documentStatus,oxValue,parseContractCell,contractCellValue,CONTRACT_ITEMS,isPersonal,writeDropoutCell,verdictPlan,writeVerdictCells,AUTO_MARK} from './dropout-core.mjs';
import {koreaToday,quoteSheet} from './attendance-beta-core.mjs';
const GOOGLE='https://sheets.googleapis.com/v4/spreadsheets/';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=d=>d?`${+d.slice(5,7)}/${+d.slice(8)}`:'';
const KIND={수료가능:'ok',제적:'bad',확인필요:'check'},DOC_KIND={완료:'ok',미제출:'bad','입사 후 제출':'check'};
// The Google token lives in this module's memory only. Writes touch only M/N/O document cells and
// H verdict cells that are blank or were written by the portal ("· 포털자동(M/D)").
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
 const root=host.shadowRoot||host.attachShadow({mode:'open'});let token='',busy=false,autoNote='',mismatches=[],disposed=false,results=[],failures=[],filter='all',search='',notice='',error='',loadedAt='',open=new Set(),saving=new Set(),today=koreaToday();
 root.innerHTML=`<link rel="stylesheet" href="/metrics.css"><style>
 .badge{display:inline-block;padding:3px 9px;border-radius:6px;font-weight:700;font-size:12px}.badge.ok{background:#dcfce7;color:#166534}.badge.bad{background:#fee2e2;color:#991b1b}.badge.check{background:#fef3c7;color:#854d0e}.badge.plan{outline:2px dashed #275fe8;outline-offset:1px}
 .metric-table{white-space:normal;font-size:12px}.metric-table th,.metric-table td{padding:8px;vertical-align:top}.metric-table th,.metric-table .nw{white-space:nowrap}.metric-table .txt{min-width:120px;max-width:220px}.metric-table button{white-space:nowrap;padding:5px 9px}.metric-table td span{white-space:nowrap}.issues{white-space:pre-wrap;color:#9c5800;min-width:180px;max-width:280px}.note{white-space:pre-wrap;color:#62768d;min-width:120px;max-width:200px}.fail{color:#b91c1c}.p-bad{color:#b91c1c;font-weight:700}
 .days{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0}.days span{border:1px solid #dae4ef;border-radius:6px;padding:2px 7px;font-size:12px}.days .결석{background:#fee2e2}.days .지각,.days .조퇴,.days .외출{background:#fef3c7}
 .rules{font-size:12px;color:#526b83;margin:0;padding-left:18px}.docs{min-width:230px}.docs label{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:4px 0;font-size:12px}.docs select,.docs input{padding:3px 6px;border-radius:6px;font-size:12px}.docs input{width:120px}.docs small{display:block;color:#9c5800;white-space:pre-wrap}.docs.saving{opacity:.5}</style>
 <h2>중도포기 · 수료 판정</h2><ul class="rules"><li>근로개시일(F열) 직전 수업일까지 출석해야 하며, 그 전까지 출석하지 않은 날은 결석으로 계산합니다. 그 이후 날짜는 출석으로 간주합니다.</li><li>포기일(G열)까지는 운영총괄 출결을 사용하고, 아직 입력되지 않은 날은 출석 예정으로 봅니다. 포기일이 오늘 이후면 <b>예정</b>입니다.</li><li>무단 지각·조퇴·외출은 단위기간마다 3회를 결석 1일로 환산합니다. 중복 표기는 2회로 셉니다.</li><li>수료 조건: 단위기간별 결석이 해당 기간 수업일의 절반 미만이고, 전체 무단결석이 ${MAX_TOTAL_ABSENCE}일 이하여야 합니다. 개인사정 포기는 제적입니다.</li><li>서류: 개인사정 포기는 포기사유서만, 조기취업 포기는 포기사유서 + 기업합격자료 + (입사 후) 근로계약서·고용보험가입확인서가 필요합니다. 서류 칸을 바꾸면 중도포기자 시트 M·N·O열에 바로 저장됩니다.</li><li>동기화할 때마다 판정 결과를 시트 <b>H열(결석일수·수료가능여부)</b>에 "결석2회(1차), 결석1회(근로전) = 수료가능" 형식으로 자동 기록합니다. 비어 있거나 포털이 쓴 칸(끝에 "· 포털자동(날짜)")만 고치고, 담당자가 직접 적은 칸은 그대로 두며 판정이 다르면 표시합니다. 확인필요인 학생은 쓰지 않습니다.</li></ul>
 <section class="metric-panel"><div class="metric-toolbar"><button id="dropSync" class="primary">동기화 · 판정</button><label>구분<select id="dropFilter"><option value="all">전체</option><option value="수료가능">수료가능</option><option value="제적">제적</option><option value="예정">예정</option><option value="확인필요">확인필요</option><option value="docs">서류 미제출</option></select></label><label>이름 검색<input id="dropSearch" placeholder="이름"></label><a href="https://docs.google.com/spreadsheets/d/${DROPOUT_SHEET_ID}/edit" target="_blank" rel="noopener">중도포기자 시트 열기</a></div><p id="dropState" class="metric-status" role="status"></p><div id="dropCards"></div><div class="metric-table-wrap"><table class="metric-table"><thead><tr><th>순번</th><th>이름</th><th>반</th><th>판정</th><th>서류 (시트 M·N·O열)</th><th>포기사유</th><th>근로개시일</th><th>포기일(마지막 수강)</th><th>필수 출석</th><th>근로전 결석</th><th>1차</th><th>2차</th><th>3차</th><th>전체 무단결석</th><th>확인 사항</th><th>시트 H열</th><th></th></tr></thead><tbody id="dropRows"></tbody></table></div></section>`;
 const $=s=>root.querySelector(s);
 async function authorize(){const {GoogleAuthProvider,reauthenticateWithPopup}=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');const p=new GoogleAuthProvider();p.addScope('https://www.googleapis.com/auth/spreadsheets');p.setCustomParameters({login_hint:user.email});const r=await reauthenticateWithPopup(user,p),c=GoogleAuthProvider.credentialFromResult(r);if(!c?.accessToken)throw Error('Google 시트 연결을 완료하지 못했습니다.');return c.accessToken;}
 async function get(url,{method='GET',body}={}){const r=await fetch(url,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(40000)}),d=await r.json().catch(()=>({}));if(r.status===401){token='';throw Error('Google 연결이 만료됐습니다. 동기화를 다시 눌러 주세요.');}if(r.status===403)throw Error(method==='GET'?'현재 Google 계정에 시트 읽기 권한이 없습니다.':'현재 Google 계정에 중도포기자 시트 편집 권한이 없습니다.');if(!r.ok)throw Error(d.error?.message||`Google Sheets 오류 (${r.status})`);return d;}
 const group=r=>r.verdict==='확인필요'?'확인필요':r.scheduled?'예정':r.verdict,matches=r=>filter==='all'||(filter==='docs'?r.docs.state==='미제출':group(r)===filter);
 const ox=(field,value,item='')=>`<select data-doc="${field}"${item?` data-item="${item}"`:''}><option value="" ${value?'':'selected'}>-</option><option ${value==='O'?'selected':''}>O</option><option ${value==='X'?'selected':''}>X</option></select>`;
 function docsCell(r){const d=r.docs,c=parseContractCell(r.contractText);return `<td class="docs${saving.has(r.row)?' saving':''}" data-row="${r.row}"><span class="badge ${DOC_KIND[d.state]}">${d.kind} · ${d.state}</span><label>포기사유서 ${ox('resign',oxValue(r.resignText))}</label>${isPersonal(r)?'':`<label>합격자료 <input data-doc="offer" value="${esc(r.offerText)}" placeholder="예: 합격이메일"></label>${CONTRACT_ITEMS.map(i=>`<label>${i.label==='근로계약서'?'근로계약서 사본':'고용보험가입확인서'} ${ox('contract',c[i.key]?'O':(r.contractText?'X':''),i.key)}</label>`).join('')}`}${d.missing.length?`<small>미제출: ${esc(d.missing.join(', '))}</small>`:''}${d.later.length&&!d.missing.length?`<small>입사 후: ${esc(d.later.join(', '))}</small>`:''}</td>`;}
 function sheetCell(r){const auto=AUTO_MARK.test(r.sheetNote),off=mismatches.find(m=>m.row===r.row);return `${esc(r.sheetNote)}${r.sheetNote?`<br><small class="${auto?'muted':''}">${auto?'포털 자동 기록':'담당자 입력'}</small>`:''}${off?`<br><small class="fail">포털 판정과 다름: ${esc(off.portal)}</small>`:''}`;}
 function period(r,i){const p=r.periods[i];if(!p)return '';return `<span class="${p.ok?'':'p-bad'}" title="결석 ${p.absent}일 + 지각·조퇴·외출 ${p.partial}회(→${p.converted}일)">${p.total} / ${p.days}</span>`;}
 function render(){
  if(disposed)return;
  $('#dropState').innerHTML=(busy?'불러오는 중…':esc(notice))+(autoNote&&!busy?`<div>${esc(autoNote)}</div>`:'')+(error?`<div class="fail">${esc(error)}</div>`:'')+(failures.length?`<div class="fail">${esc(failures.join('\n'))}</div>`:'');
  const count=g=>results.filter(r=>group(r)===g).length;
  $('#dropCards').innerHTML=results.length?`<div class="metric-cards">${[['전체',results.length,'중도포기자(교육생) 시트'],['수료가능',count('수료가능'),'포기일 도래 · 조건 충족'],['제적',count('제적'),'포기일 도래 · 조건 미충족'],['예정',count('예정'),'포기일이 아직 오지 않음'],['확인필요',count('확인필요'),'시트 입력 확인 필요'],['서류 미제출',results.filter(r=>r.docs.state==='미제출').length,'필요 서류 중 빠진 항목 있음']].map(([a,b,c])=>`<article><small>${a}</small><strong>${b}</strong><p>${c}</p></article>`).join('')}</div>`:'';
  const q=search.trim(),shown=results.filter(r=>matches(r)&&(!q||r.name.includes(q)));
  $('#dropRows').innerHTML=shown.map(r=>{const k=r.no+r.name,detail=open.has(k);return `<tr><td>${esc(r.no.replace(/\.0$/,''))}</td><td class="nw"><b>${esc(r.name)}</b></td><td class="nw">${r.classId?esc(r.classId)+'반':''}</td><td class="nw"><span class="badge ${KIND[r.verdict]}${r.scheduled&&r.verdict!=='확인필요'?' plan':''}">${esc(verdictLabel(r))}</span></td>${docsCell(r)}<td class="txt">${esc(r.reason)}</td><td class="txt">${esc(r.startText)}</td><td class="txt">${esc(r.lastText)}${r.lastDate?`<br><small class="muted">${short(r.lastDate)}${r.scheduled?' · 예정':''}</small>`:''}</td><td>${r.requiredUntil?short(r.requiredUntil)+'까지':''}</td><td>${r.periods.length?r.preStartAbsence+'일':''}</td><td>${period(r,0)}</td><td>${period(r,1)}</td><td>${period(r,2)}</td><td>${r.totalAbsence===null?'':`<span class="${r.totalAbsence>MAX_TOTAL_ABSENCE?'p-bad':''}">${r.totalAbsence} / ${MAX_TOTAL_ABSENCE}</span>`}</td><td class="issues">${esc([r.verdict==='제적'?r.basis:'',...r.issues].filter(Boolean).join('\n'))}</td><td class="note">${sheetCell(r)}</td><td>${r.days.length?`<button data-k="${esc(k)}">${detail?'닫기':'일자별'}</button>`:''}</td></tr>${detail?`<tr><td colspan="17"><div class="days">${r.days.filter(d=>d.status!=='출석'||d.basis!=='운영총괄').filter(d=>!(d.status==='출석'&&d.basis==='근로개시 이후 출석 간주')).map(d=>`<span class="${esc(d.status)}" title="${esc(d.basis)}${d.raw?' · 시트: '+esc(d.raw):''}">${short(d.date)} ${esc(d.status)}${d.basis!=='운영총괄'?' · '+esc(d.basis):''}</span>`).join('')||'특이 출결 없음'}</div></td></tr>`:''}`;}).join('')||`<tr><td colspan="17" class="muted">${results.length?'조건에 맞는 학생이 없습니다.':'동기화 · 판정을 누르면 결과가 표시됩니다.'}</td></tr>`;
  root.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{const k=b.dataset.k;open.has(k)?open.delete(k):open.add(k);render();});
  root.querySelectorAll('[data-doc]').forEach(e=>{const cell=e.closest('[data-row]');e.disabled=busy||saving.has(+cell.dataset.row);e.onchange=()=>saveDoc(+cell.dataset.row,e);});root.querySelectorAll('button').forEach(b=>{if(!b.dataset.k)b.disabled=busy;});$('#dropSync').textContent=busy?'동기화 중…':'동기화 · 판정';
 }
 async function saveDoc(rowNo,el){
  const r=results.find(x=>x.row===rowNo);if(!r||saving.has(rowNo))return;const field=el.dataset.doc;let before,after;
  if(field==='resign'){before=r.resignText;after=el.value;}
  else if(field==='offer'){before=r.offerText;after=el.value.trim();}
  else{before=r.contractText;const c=parseContractCell(before);c[el.dataset.item]=el.value==='O';after=contractCellValue(c);}
  if(after===before){render();return;}
  saving.add(rowNo);error='';render();
  try{if(!token)token=await authorize();const res=await writeDropoutCell(get,{row:rowNo,name:r.name,field,before,after});if(disposed)return;
   r[{resign:'resignText',offer:'offerText',contract:'contractText'}[field]]=res.value;r.docs=documentStatus(r,today);notice=`${r.name} · 시트 ${res.range} 저장 완료`;}
  catch(e){error=`${r.name} 저장 실패 · ${e.message}`;}finally{saving.delete(rowNo);render();}
 }
 // 판정이 나면 시트 H열에 자동 기록한다. 실패해도 판정 화면은 그대로 보여 준다.
 async function autoRecord(){
  const plan=verdictPlan(results,today);mismatches=plan.manual;autoNote='';
  const extra=mismatches.length?` · 담당자 입력과 판정이 다른 ${mismatches.length}명 확인 필요`:'';
  if(!plan.writes.length){autoNote=`시트 H열 자동 기록: 바뀐 판정 없음${extra}`;return;}
  try{const {saved,skipped}=await writeVerdictCells(get,plan.writes);for(const w of saved){const r=results.find(x=>x.row===w.row);if(r)r.sheetNote=w.after;}
   autoNote=`시트 H열 자동 기록 ${saved.length}건${saved.length?` (${saved.slice(0,5).map(w=>w.name).join(', ')}${saved.length>5?' 외':''})`:''}${skipped.length?` · 건너뜀 ${skipped.length}건: ${skipped.map(w=>w.name+' '+w.reason).join(', ')}`:''}${extra}`;}
  catch(e){error=`시트 H열 자동 기록 실패 · ${e.message}`;}
 }
 async function load(){
  if(busy||saving.size)return;busy=true;error='';render();
  try{if(!token)token=await authorize();today=koreaToday();let data;try{data=await readDropoutSources(get);}catch(e){if(token)throw e;token=await authorize();data=await readDropoutSources(get);}if(disposed)return;failures=data.failures;results=evaluateAll(data.entries,data.classes,today);results.forEach(r=>r.docs=documentStatus(r,today));await autoRecord();loadedAt=new Date().toLocaleTimeString('ko-KR');notice=`${today} 기준 · ${results.length}명 판정 · ${loadedAt} 불러옴 (중도포기자 시트 + 운영총괄 출결 실시간)`;}
  catch(e){error=e.message;}finally{busy=false;render();}
 }
 $('#dropSync').onclick=()=>load();
 $('#dropFilter').onchange=e=>{filter=e.target.value;render();};$('#dropSearch').oninput=e=>{search=e.target.value;render();};
 notice='동기화 · 판정을 누를 때마다 중도포기자 시트와 운영총괄 출결을 새로 읽어 자동 판정하고, 판정 결과를 시트 H열에 자동 기록합니다. 처음 한 번은 Google 계정 확인 창이 열립니다.';render();
 return {canLeave:()=>!saving.size,dispose(){disposed=true;token='';}};
}
