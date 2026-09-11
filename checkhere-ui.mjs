import {runCollectionQueue} from './checkhere/bulk-collect.mjs';
import {collectionDates,koreaToday} from './attendance-beta-core.mjs';
import {judge} from './checkhere/rules.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local=()=>['127.0.0.1','localhost'].includes(location.hostname)&&location.port==='8765';
const time=v=>v||'—';
export async function mountCheckHere(host,ctx={}){
  const root=host.shadowRoot||host.attachShadow({mode:'open'}),css=await(await fetch('/checkhere/ui.css')).text();
  const canEdit=ctx.canEdit??!!(ctx.requestNew||ctx.applyChange);
  let batchRunning=false,batchStopped=false;
  let key='',state={records:[],jobs:[]},pollTimer=null,shownJobs=new Set(),editing=false,cloudShown=false;
  root.innerHTML=`<style>${css}</style><div class="app"><header class="top"><div><div class="brand">HINT / ATTENDANCE REVIEW</div><h1>체크히어 검수</h1><div class="muted">입·퇴실, 관리자 메모, 외출 구간을 한 번에 확인합니다.</div></div><div class="line"><span id="connectionStatus" class="badge">연결 대기</span><button id="connect">체크히어 로그인</button></div></header>
    <details id="pairing" class="card connection"><summary>수집 연결 프로그램 설정</summary><p class="muted">Windows에서는 ‘체크히어 시작.cmd’, macOS에서는 ‘체크히어 시작.command’를 실행하세요. 플랫폼에서는 로컬 화면에 표시된 연결 키를 아래에 입력하면 됩니다. 프로그램을 재시작하면 키가 바뀝니다.</p><div class="line"><input id="keyInput" type="password" autocomplete="off" aria-label="로컬 연결 키" placeholder="연결 키"><button id="pair">연결</button></div><div id="localKey"></div></details>
    <section class="toolbar"><div><label for="class">반</label><select id="class"><option value="all">전체 17개 반</option>${Array.from({length:17},(_,i)=>`<option value="${i+1}" ${i===1?'selected':''}>${i+1}반</option>`).join('')}</select></div><div><label for="from">시작 날짜</label><input id="from" type="date" value="2026-09-03"></div><div><label for="to">종료 날짜</label><input id="to" type="date" value="2026-09-03"></div><button id="bulkPreset">전체반 · 8/27~오늘</button><button id="sync" class="primary">체크히어에서 수집</button><button id="refresh">저장된 기록 조회</button><button id="cancel" hidden>수집 중단</button>${ctx.load?'<button id="loadCloud">플랫폼 저장본 조회</button><button id="saveCloud">플랫폼에 저장</button>':''}</section>
    <div class="notice">기준 09:00–18:00 · 점심 12:00–13:00 제외 · 09:11부터 지각 · 17:50 이전 조퇴. 시간만으로 인정출석을 확정하지 않습니다. 저장본과 상세 수집 실패는 별도로 표시합니다.</div>
    <div id="bulkStatus" role="status"></div><div id="jobStatus" role="status" aria-live="polite"></div><section id="stats" class="stats"></section><div class="filters"><div class="line"><select id="filter" aria-label="검수 상태"><option value="all">전체 기록</option><option value="review">확인 필요</option><option value="memo">사유 확인</option><option value="partial">재수집 필요</option></select><input id="search" placeholder="학생 이름 검색" aria-label="학생 이름 검색"></div><button id="export">검수 결과 내보내기</button></div><div id="table"></div><div class="foot">시간 판정은 검토를 돕는 결과입니다. 정상 시간으로 임의 보정하지 않습니다. 중복 출결은 반영에서 제외합니다.<br>반영 완료는 체크히어를 다시 읽어 시간과 메모가 일치한 경우에만 표시합니다. Google Sheet 및 출결 파일을 수정·삭제하지 않습니다.</div><details><summary>최근 작업 결과</summary><div id="jobs"></div></details></div><div id="overlay"></div><div id="alerts"></div>`;
  const $=s=>root.querySelector(s);
  try{const c=JSON.parse(sessionStorage.getItem('hintWorkContext')||'{}');if(c.classId&&c.date){$('#class').value=c.classId;$('#from').value=c.date;$('#to').value=c.date;}}catch{}
  function alertMessage(title,message){$('#alerts').innerHTML=`<div class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="actions"><button id="alertClose" class="primary">확인</button></div></div></div>`;$('#alertClose').onclick=()=>{$('#alerts').innerHTML='';};$('#alertClose').focus();}
  async function api(path,data){
    if(!key)throw new Error('로컬 연결 키를 먼저 입력해 주세요.');
    let r;try{r=await fetch(`http://127.0.0.1:8765/api/${path}`,{method:data?'POST':'GET',headers:{'x-hint-key':key,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)});}catch{throw new Error('수집 연결 프로그램에 연결하지 못했습니다. Windows의 ‘체크히어 시작.cmd’ 또는 macOS의 ‘체크히어 시작.command’를 실행하고 브라우저의 로컬 네트워크 연결 허용 여부를 확인해 주세요.');}
    const d=await r.json();if(!r.ok)throw new Error(d.error||'요청에 실패했습니다.');return d;
  }
  const selected=()=>state.records.filter(r=>($('#class').value==='all'||String(r.classId)===$('#class').value)&&r.date>=$('#from').value&&r.date<=$('#to').value);
  function render(){
    if(!host.isConnected){clearTimeout(pollTimer);return;}
    $('#connectionStatus').textContent=state.connected?'체크히어 연결됨':key?'로컬 연결됨 · 로그인 확인':'연결 대기';$('#connectionStatus').className=`badge ${state.connected?'good':''}`;
    const busy=state.jobs.find(j=>j.id===state.busy),records=selected().map(r=>({...r,audit:judge(r)}));
    $('#sync').disabled=!!state.busy||batchRunning;$('#connect').disabled=!!state.busy||batchRunning;$('#cancel').hidden=!(busy?.kind==='sync')&&!batchRunning;for(const id of ['class','from','to','bulkPreset','loadCloud','saveCloud'])if($('#'+id))$('#'+id).disabled=batchRunning;
    $('#jobStatus').innerHTML=busy?`<div class="status"><span class="spinner"></span>${esc(busy.kind==='apply'?'체크히어 변경값 확인 중':busy.message)} ${busy.progress?`· ${esc(busy.progress.date)} ${busy.progress.index}/${busy.progress.total} ${esc(busy.progress.name)}`:''}</div>`:state.jobs[0]?`<div class="status">${esc(state.jobs[0].message)} <span class="muted">${esc(state.jobs[0].finishedAt?.replace('T',' ').slice(0,19)||'')}</span></div>`:'';
    const review=records.filter(r=>r.audit.issues.length),missing=records.filter(r=>r.readState!=='complete'||r.source!=='live');
    $('#stats').innerHTML=[['전체 학생·날짜',records.length,''],['확인 필요',review.length,'warn'],['사유 확인',records.filter(r=>r.audit.issues.some(i=>i.code.startsWith('MEMO')||i.code==='RECOGNIZED_MEMO')).length,'warn'],['재수집 필요',missing.length,'bad']].map(([label,n,c])=>`<div class="stat ${c}"><small>${label}</small><strong>${n}</strong></div>`).join('');
    const filter=$('#filter').value,search=$('#search').value.trim();
    const visible=records.filter(r=>(!search||r.name.includes(search))&&(filter==='all'||filter==='review'&&r.audit.issues.length||filter==='memo'&&r.audit.issues.some(i=>i.code.includes('MEMO'))||filter==='partial'&&(r.source!=='live'||r.readState!=='complete'))).sort((a,b)=>a.date.localeCompare(b.date)||a.rowIndex-b.rowIndex);
    $('#table').innerHTML=!visible.length?`<div class="card empty"><h2>${records.length?'조건에 맞는 기록이 없습니다':'반과 날짜를 선택하고 수집하세요'}</h2><p>체크히어 전용 크롬에 로그인하면 관리자 메모까지 가져옵니다.</p></div>`:`<div class="tablewrap"><table><thead><tr><th>학생 / 날짜</th><th>입실 → 퇴실</th><th>시간 판정</th><th>입실·교시 관리자 메모</th><th>퇴실 관리자 메모</th><th>외출 구간</th><th>확인할 사항</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${visible.map(r=>`<tr><td><div class="name">${esc(r.name)}</div><div class="muted">${esc(r.classId)}반 · ${esc(r.date)}</div><div class="muted">식별번호 끝 ${esc(r.phoneLast4||'미확인')}</div></td><td class="times">${esc(time(Object.hasOwn(r,'rawEntry')?r.rawEntry:r.entry))}${r.rawEntry!==undefined&&r.rawEntry!==r.entry?`<div class="muted">교시 기록 ${esc(time(r.entry))}</div>`:''}<br>→ ${esc(time(r.exit))}<div class="muted">${r.audit.minutes===null?'참여시간 미확인':`실제 ${r.audit.minutes}분`}</div></td><td>${r.audit.labels.map(x=>`<span class="badge">${esc(x)}</span>`).join('')}<br><span class="badge ${r.source==='live'&&r.readState==='complete'?'good':'warning'}">${r.source==='live'?(r.readState==='complete'?'상세 수집 완료':'일부 수집 실패'):'과거 저장본'}</span><div class="muted">${esc((r.collectedAt||'').slice(0,10))}</div></td><td class="memo">${r.entryMemo===null||r.entryMemo===undefined?'<span class="muted">아직 읽지 못함</span>':esc(r.entryMemo)||'<span class="muted">메모 없음</span>'}</td><td class="memo">${r.exitMemo===null||r.exitMemo===undefined?'<span class="muted">아직 읽지 못함</span>':esc(r.exitMemo)||'<span class="muted">메모 없음</span>'}</td><td class="times">${r.outings?.length?r.outings.map(t=>`${esc(time(t.start))}<br>~ ${esc(time(t.end))}<br><span class="muted">${t.recognized===true?'교육시간 인정':t.recognized===false?'교육시간 미인정':'인정 여부 미확인'}</span>`).join('<hr>'):r.readState==='complete'?'없음':'미확인'}</td><td class="issues">${r.audit.issues.map(i=>esc(i.text)).join('<br>')||'<span class="badge good">발견된 이상 없음</span>'}${r.readError?`<br>${esc(r.readError)}`:''}${r.exception?`<br><span class="badge good">${esc(r.exception)}</span>`:''}</td>${canEdit?`<td><button data-edit="${esc(r.id)}">검토·수정</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(state.records.find(r=>r.id===b.dataset.edit)));
    $('#jobs').innerHTML=state.jobs.slice(0,10).map(j=>`<p><span class="badge">${esc(j.kind==='sync'?'수집':'반영')} · ${esc(({verified:'검증 완료',complete:'수집 완료',running:'진행 중',partial:'일부 실패',failed:'실패',unknown:'결과 미확인',conflict:'충돌',cancelled:'중단'})[j.status]||j.status)}</span> ${esc(j.message)}</p>`).join('')||'<p class="muted">아직 작업이 없습니다.</p>';
  }
  async function refresh(){
    clearTimeout(pollTimer);state=await api('state');cloudShown=false;render();
    for(const j of state.jobs){
      if(j.status==='running'||shownJobs.has(j.id))continue;shownJobs.add(j.id);
      if(j.kind==='apply'&&Date.now()-Date.parse(j.finishedAt||0)<120000)alertMessage(j.status==='verified'?'체크히어 반영 확인':'체크히어 반영 확인 필요',j.message+(j.cloudError?'\n'+j.cloudError:'')+(j.results?.length?'\n'+j.results.map(x=>`${x.field==='entry'?'입실·교시':'퇴실'}: ${x.state==='verified'?'확인 완료':x.state==='unknown'?'결과 미확인':'실패 또는 충돌'}`).join('\n'):''));
      if(ctx.save&&['complete','partial','verified'].includes(j.status)&&j.finishedAt){
        const batch=state.records.filter(r=>(j.kind==='sync'?r.classId===j.classId&&j.dates.includes(r.date):r.id===j.recordId)&&r.source==='live'&&r.collectedAt>=j.startedAt&&r.collectedAt<=j.finishedAt);
        if(batch.length)try{await ctx.save(batch,j);}catch(e){alertMessage('수집 완료 · 플랫폼 저장 실패',`PC에는 수집 결과가 남아 있습니다. 플랫폼 저장을 다시 시도해 주세요.\n${e.message}`);}
      }
    }
    if(state.busy&&!batchRunning&&host.isConnected)pollTimer=setTimeout(()=>refresh().catch(e=>alertMessage('연결 확인',e.message)),1500);
    return state;
  }
  function openEditor(r){
    if(!canEdit||(!ctx.requestNew&&!ctx.applyChange))return alertMessage('조회 전용','이 계정에서는 체크히어 데이터를 수집하고 조회할 수 있습니다.');
    editing=true;const a=judge(r);$('#overlay').innerHTML=`<div class="backdrop"><section class="drawer" role="dialog" aria-modal="true" aria-label="학생 출결 검토"><header><div><div class="brand">${esc(r.classId)}반 · ${esc(r.date)}</div><h2>${esc(r.name)} 출결 검토</h2></div><button id="closeEdit">닫기</button></header><div class="notice">${a.canApply?'수정 근거와 변경 전후를 확인한 다음 반영하세요.':'현재 기록은 직접 반영할 수 없습니다. 진행중·교시 불일치·중복 여부와 수집 상태를 확인해 주세요.'}</div><div class="grid"><div class="field"><label for="newEntry">교시 시간 (09:00–18:00 칸)</label><input id="newEntry" type="time" step="1" value="${esc(r.entry||'')}"><div class="old">교시 기존 ${esc(time(r.entry))}<br>실제 입실 ${esc(time(Object.hasOwn(r,'rawEntry')?r.rawEntry:r.entry))}</div></div><div class="field"><label for="newExit">퇴실 시간</label><input id="newExit" type="time" step="1" value="${esc(r.exit||'')}"><div class="old">기존 ${esc(time(r.exit))}</div></div></div><div class="field"><label for="newEntryMemo">입실·교시 관리자 메모</label><textarea id="newEntryMemo">${esc(r.entryMemo||'')}</textarea><div class="old">기존: ${esc(r.entryMemo??'미수집')}</div></div><div class="field"><label for="newExitMemo">퇴실 관리자 메모</label><textarea id="newExitMemo">${esc(r.exitMemo||'')}</textarea><div class="old">기존: ${esc(r.exitMemo??'미수집')}</div></div><button id="suggest">시간 기준 사유 초안 넣기</button><div class="field"><label for="changeReason">수정 근거</label><textarea id="changeReason" placeholder="시트·수기출석 등 확인한 근거를 적어 주세요."></textarea></div><div id="preview"></div><div class="actions"><button id="reviewDiff" class="primary" ${a.canApply&&!state.busy&&!cloudShown?'':'disabled'}>변경 전후 확인</button></div><details><summary>현재 판정 근거</summary><p class="muted">${a.issues.map(i=>esc(i.text)).join('<br>')||'시간과 메모에서 발견된 이상 없음'}</p></details></section></div>`;
    $('#closeEdit').onclick=()=>{$('#overlay').innerHTML='';editing=false;};
    $('#suggest').onclick=()=>{for(const [k,v] of Object.entries(a.suggestions))$(k==='entryMemo'?'#newEntryMemo':'#newExitMemo').value=v;$('#preview').innerHTML='';};
    for(const el of root.querySelectorAll('#overlay input,#overlay textarea'))el.addEventListener('input',()=>{$('#preview').innerHTML='';});
    $('#reviewDiff').onclick=()=>{
      const draft={id:r.id,version:r.version,entry:$('#newEntry').value,exit:$('#newExit').value,entryMemo:$('#newEntryMemo').value,exitMemo:$('#newExitMemo').value,reason:$('#changeReason').value.trim(),requestId:crypto.randomUUID()};
      if(!draft.reason)return alertMessage('수정 근거 확인','수정 근거를 입력해 주세요.');
      if(!draft.entry||!draft.exit)return alertMessage('시간 확인','입실·퇴실 시간을 입력해 주세요. 공란으로 지우는 변경은 지원하지 않습니다.');
      const diff=[['entry','입실·교시'],['exit','퇴실'],['entryMemo','입실·교시 메모'],['exitMemo','퇴실 메모']].filter(([k])=>draft[k]!==r[k]);
      if(!diff.length)return alertMessage('변경 없음','수정한 값이 없습니다.');
      $('#preview').innerHTML=`<div class="diff"><strong>${ctx.applyChange?'체크히어에 반영할 변경':'관리자에게 요청할 변경'}</strong>${diff.map(([k,l])=>`<p>${l}<br><span class="muted">${esc(r[k]||'공란')}</span><br>→ ${esc(draft[k])}</p>`).join('')}<div class="actions"><button id="applyNow" class="primary">${ctx.applyChange?'체크히어에 반영':'수정 요청 등록'}</button></div></div>`;
      $('#applyNow').onclick=async()=>{const b=$('#applyNow');b.disabled=true;try{const input={classId:r.classId,date:r.date,name:r.name,phoneLast4:r.phoneLast4||'',reason:draft.reason,changes:Object.fromEntries(diff.map(([k])=>[k,draft[k]]))};const result=ctx.applyChange?await ctx.applyChange(input,r,draft.requestId):await ctx.requestNew(input);$('#overlay').innerHTML='';editing=false;if(ctx.applyChange)alertMessage(result?.status==='verified'?'반영 확인 완료':result?.status==='running'?'반영 진행 중':'반영 결과 확인',result?.message||'최근 작업 결과를 확인해 주세요.');else alertMessage('수정 요청 등록 완료','지정된 관리자가 요청 목록에서 승인하면 반영됩니다.');}catch(e){b.disabled=false;alertMessage(ctx.applyChange?'체크히어 반영 확인 필요':'수정 요청 실패',e.message);}};
    };
    $('#closeEdit').focus();
  }
  const handle=fn=>async()=>{try{await fn();}catch(e){alertMessage('확인 필요',e.message);}};
  $('#pair').onclick=handle(async()=>{key=$('#keyInput').value.trim();await refresh();$('#pairing').open=false;});
  $('#connect').onclick=handle(async()=>{
    const b=$('#connect');b.disabled=true;b.textContent='로그인 창 여는 중…';
    try{const result=await api('connect',{});await refresh();alertMessage(result.connected?'로그인 확인 완료':'체크히어 로그인 창 확인',result.connected?'체크히어에서 수집 버튼을 누르면 됩니다.':result.message+'\n새 창이 보이지 않으면 제공한 ‘체크히어 시작.cmd’를 직접 실행해 주세요.');}
    finally{b.disabled=false;b.textContent='체크히어 로그인';}
  });
  $('#refresh').onclick=handle(refresh);
  $('#cancel').onclick=handle(async()=>{batchStopped=true;await api('cancel',{});});
  $('#bulkPreset').onclick=()=>{$('#class').value='all';$('#from').value='2026-08-27';$('#to').value=[koreaToday(),'2026-10-22'].sort()[0];render();};
  $('#sync').onclick=handle(async()=>{
    if(batchRunning||state.busy)throw Error('진행 중인 작업이 있습니다.');
    const dates=collectionDates($('#from').value,$('#to').value),classIds=$('#class').value==='all'?Array.from({length:17},(_,i)=>String(i+1)):[$('#class').value];
    if(!dates.length)throw Error('평일 강의 날짜를 선택해 주세요.');batchRunning=true;batchStopped=false;clearTimeout(pollTimer);render();
    try{
      const result=await runCollectionQueue({classIds,dates,api,refresh,stopped:()=>batchStopped||!host.isConnected,onProgress:p=>{$('#bulkStatus').innerHTML=`<div class="status">전체 수집 ${p.completed}/${p.total} · ${esc(p.classId)}반 ${esc(p.date)}<br>현재 페이지와 연결 프로그램을 열어두세요.</div>`;}});
      const errors=result.results.filter(x=>x.status!=='complete');$('#bulkStatus').innerHTML=`<div class="status">${result.stopped?'수집 중단':'전체 수집 종료'} · ${result.results.length}/${result.total} 반·날짜 · 확인 필요 ${errors.length}건${errors.length?`<details><summary>미완료·오류 목록</summary>${errors.map(x=>`<p>${esc(x.classId)}반 · ${esc(x.date)} · ${esc(x.message)}</p>`).join('')}</details>`:''}</div>`;
    }finally{batchRunning=false;render();}
  });
  for(const selector of ['#class','#from','#to','#filter','#search'])$(selector).addEventListener(selector==='#search'?'input':'change',render);
  $('#export').onclick=()=>{const data=selected().map(r=>({...r,audit:judge(r)}));if(!data.length)return alertMessage('내보낼 기록 없음','먼저 기록을 수집하거나 저장본을 조회하세요.');const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records:data},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`체크히어_${$('#class').value}반_${$('#from').value}_${$('#to').value}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  if(ctx.save)$('#saveCloud').onclick=handle(async()=>{const records=selected().filter(r=>r.source==='live');if(!records.length)throw new Error('현재 PC에서 수집한 기록이 없습니다.');await ctx.save(records,{id:crypto.randomUUID(),status:'manual_archive'});alertMessage('플랫폼 저장 완료','선택한 반·날짜의 수집 기록을 플랫폼에 보관했습니다.');});
  if(ctx.load)$('#loadCloud').onclick=handle(async()=>{state.records=await ctx.load($('#class').value,{from:$('#from').value,to:$('#to').value});state.busy=null;cloudShown=true;render();});
  render();
  if(local())try{key=(await(await fetch('/api/session')).json()).key;$('#localKey').innerHTML=`<p class="muted">플랫폼 연결 키 · 이 키를 가진 화면에서 수집·반영할 수 있습니다.</p><p class="key">${esc(key)}</p><button id="copyKey">연결 키 복사</button>`;$('#copyKey').onclick=handle(()=>navigator.clipboard.writeText(key));await refresh();}catch(e){alertMessage('시작 확인',e.message);}
  else{$('#pairing').open=true;}
  ctx.onController?.({api,refresh,state:()=>state,select(classId,date){$('#class').value=String(classId);$('#from').value=date;$('#to').value=date;render();}});
  return()=>{clearTimeout(pollTimer);editing=false;};
}
const standalone=document.getElementById('checkhereApp');if(standalone)mountCheckHere(standalone);

