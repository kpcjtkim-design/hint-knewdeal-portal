import {runCollectionQueue} from './checkhere/bulk-collect.mjs';
import {collectionDates,koreaToday} from './attendance-beta-core.mjs';
import {judge,NEEDS_UNMASK_TEXT,PRIVACY_UPDATE_TEXT,RULES,normalizeTime,privacyState} from './checkhere/rules.mjs';
// 2기: 반 1~16·교육 기간·연결 프로그램 주소(포트 8766)·저장 키 앞글자는 cohort.mjs에서 읽습니다.
import {CLASS_IDS,REAL_CLASS_IDS,REAL_CLASS_COUNT,COURSE_START,COURSE_END,BRIDGE_URL,BRIDGE_PORT,EXCURSION_RULE,lateAfter,earlyBefore,storageKey} from './cohort.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local=()=>['127.0.0.1','localhost'].includes(location.hostname)&&location.port===String(BRIDGE_PORT);
// 날짜 기본값만: 오늘을 교육 기간 안으로 자른 값(고르는 날짜는 아무 날, 2026-10-20)
const courseDay=d=>d<COURSE_START?COURSE_START:d>COURSE_END?COURSE_END:d;
const time=v=>v||'—';
// 체크히어 해제 상태(연결 프로그램 /api/state의 privacy, 옛 build는 masking으로 같은 기준 계산). 읽기는 가려도 되고, 수정·삭제는 해제·남은 시간이 넉넉할 때만.
const privacyOf=s=>s?.privacy||s?.masking?privacyState(s.privacy||s.masking):null;
export async function mountCheckHere(host,ctx={}){
  const root=host.shadowRoot||host.attachShadow({mode:'open'}),css=await(await fetch('/checkhere/ui.css')).text();
  const canEdit=ctx.canEdit??!!(ctx.requestNew||ctx.applyChange);
  let cloudSaves=0,cloudTail=Promise.resolve();
  let batchRunning=false,batchStopped=false,page=1,lastTableSignature='',refreshPromise=null,disposed=false;const auditCache=new Map();
  let key='',state={records:[],jobs:[]},pollTimer=null,shownJobs=new Set(),editing=false,cloudShown=false;
  let collectorCursor='';const collectorRecords=new Map();
  let batchShown='';const batchSaveErrors=new Map();
  // Days of the latest batch job already saved to the platform, kept per browser so
  // reopening the screen does not re-check hundreds of days.
  const savedKey=id=>storageKey('checkhere.batchSaved.'+id),savedDays=id=>{try{return new Set(JSON.parse(localStorage.getItem(savedKey(id))||'[]'));}catch{return new Set();}};
  const markSaved=(id,set)=>{try{localStorage.setItem(savedKey(id),JSON.stringify([...set]));}catch{}};
  root.innerHTML=`<style>${css}</style><div class="app"><header class="top"><div><div class="brand">HINT / ATTENDANCE REVIEW</div><h1>체크히어 검수</h1><div class="muted">입·퇴실, 관리자 메모, 외출 구간을 한 번에 확인합니다.</div></div><div class="line"><span id="connectionStatus" class="badge">연결 대기</span><button id="connect">체크히어 로그인</button></div></header>
    <details id="pairing" class="card connection"><summary>수집 연결 프로그램 설정</summary><p class="muted">Windows에서는 ‘체크히어 시작.cmd’, macOS에서는 ‘체크히어 시작.command’를 실행하세요. 플랫폼에서는 로컬 화면에 표시된 연결 키를 아래에 입력하면 됩니다. 프로그램을 재시작하면 키가 바뀝니다.</p><div class="line"><input id="keyInput" type="password" autocomplete="off" aria-label="로컬 연결 키" placeholder="연결 키"><button id="pair">연결</button></div><div id="localKey"></div></details>
    <section class="toolbar"><div><label for="class">반</label><select id="class"><option value="all">전체 ${REAL_CLASS_COUNT}개 반</option>${CLASS_IDS.map((id,i)=>`<option value="${id}" ${i===0?'selected':''}>${id}반</option>`).join('')}<option value="multi">여러 반 선택…</option></select></div><div><label for="from">시작 날짜</label><input id="from" type="date" value="${courseDay(koreaToday())}"></div><div><label for="to">종료 날짜</label><input id="to" type="date" value="${courseDay(koreaToday())}"></div><div><label for="mode">수집 방식</label><select id="mode" title="빠른 수집은 수정창을 열지 않고 출결상세 화면이 받는 데이터만 읽습니다(가린 화면에서도 됨). 정밀 수집은 비상용으로 모든 학생의 수정창을 열며, 체크히어 마스킹을 해제한 연결 프로그램 탭에서만 합니다."><option value="incremental">빠른 수집 · 화면 데이터만(클릭 없음)</option><option value="full">정밀 수집 · 수정창으로 읽기(비상용 · 해제 필요)</option></select></div><button id="bulkPreset">전체반 · 7/27~오늘</button><button id="sync" class="primary">체크히어에서 수집</button><button id="refresh">저장된 기록 조회</button><button id="cancel" hidden>수집 중단</button>${ctx.load?'<button id="loadCloud">플랫폼 저장본 조회</button><button id="saveCloud">플랫폼에 저장</button>':''}</section>
    <div id="classPicker" class="card" hidden><div class="line"><strong>수집·조회할 반</strong><button id="pickAll" type="button">전체 선택</button><button id="pickNone" type="button">선택 해제</button><span id="pickCount" class="muted"></span></div><div class="line" style="flex-wrap:wrap;gap:6px 14px;margin-top:8px">${CLASS_IDS.map((id,i)=>`<label style="display:inline-flex;align-items:center;gap:4px;font-weight:500"><input type="checkbox" data-pick="${id}" ${i===0?'checked':''}>${id}반</label>`).join('')}</div><p class="muted">빠른 수집은 체크히어 출결상세 화면이 받는 데이터로 그날 반 전체의 시간·메모·외출을 한 번에 읽습니다. 수정창은 열지 않고(클릭 없음) 표의 시간과 하나하나 대조하며, 저장본과 같은 학생은 건너뜁니다. 개인정보가 가려진 화면에서도 됩니다. 정밀 수집은 비상용으로 모든 학생의 수정창을 엽니다. 가린 화면에서는 수정창이 열리지 않으므로 거절하고 안내합니다: 연결 프로그램의 체크히어 창(같은 탭)에서 마스킹을 해제한 뒤 다시 누르세요.</p></div>
    <section id="maskPanel" class="card connection" hidden><div class="line"><strong id="maskView">체크히어 화면 확인 전</strong><span id="maskCounts" class="muted"></span></div><div id="maskControls"></div><p class="muted">마스킹 해제는 사람이 합니다. 연결 프로그램의 체크히어 창(같은 탭)에서 직접 하거나 「마스킹 해제 시작」을 누르세요(새 탭은 다시 가려집니다). 해제 사유는 실제로 기다리는 일로 넣고, 인증번호는 메일에서 직접 확인해 여기에 넣습니다. 연장·종료는 체크히어 창에서 직접 누르세요.</p></section>
    <div class="notice">기준 ${RULES.start}–${RULES.end} · 점심 ${RULES.lunchStart}–${RULES.lunchEnd} 제외 · ${lateAfter(RULES)} 넘으면 지각 · ${earlyBefore(RULES)} 이전 조퇴(공장견학 날 ${EXCURSION_RULE.start}–${EXCURSION_RULE.end}). 시간만으로 인정출석을 확정하지 않습니다. 저장본과 상세 수집 실패는 별도로 표시합니다.</div>
    <div id="cloudSaveStatus" role="status" aria-live="polite"></div><div id="bulkStatus" role="status"></div><div id="jobStatus" role="status" aria-live="polite"></div><section id="stats" class="stats"></section><div class="filters"><div class="line"><select id="filter" aria-label="검수 상태"><option value="all">전체 기록</option><option value="review">확인 필요</option><option value="memo">사유 확인</option><option value="partial">재수집 필요</option></select><input id="search" placeholder="학생 이름 검색" aria-label="학생 이름 검색"></div><button id="export">검수 결과 내보내기</button></div><div id="table"></div><div class="foot">시간 판정은 검토를 돕는 결과입니다. 정상 시간으로 임의 보정하지 않습니다. 중복 출결은 반영에서 제외합니다.<br>반영 완료는 체크히어를 다시 읽어 시간과 메모가 일치한 경우에만 표시합니다. Google Sheet 및 출결 파일을 수정·삭제하지 않습니다.</div><details><summary>최근 작업 결과</summary><div id="jobs"></div></details></div><div id="overlay"></div><div id="alerts"></div>`;
  const $=s=>root.querySelector(s);
  try{const c=JSON.parse(sessionStorage.getItem(storageKey('hintWorkContext'))||'{}');if(c.classId&&c.date){$('#class').value=c.classId;$('#from').value=c.date;$('#to').value=c.date;}}catch{}
  function alertMessage(title,message){$('#alerts').innerHTML=`<div class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="actions"><button id="alertClose" class="primary">확인</button></div></div></div>`;$('#alertClose').onclick=()=>{$('#alerts').innerHTML='';};$('#alertClose').focus();}
  async function api(path,data){
    if(!key)throw new Error('로컬 연결 키를 먼저 입력해 주세요.');
    let r;try{r=await fetch(`${BRIDGE_URL}/api/${path}`,{method:data?'POST':'GET',headers:{'x-hint-key':key,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(['apply','confirm-existing','preview-request'].includes(path)?90000:30000)});}catch{throw new Error('수집 연결 프로그램에 연결하지 못했습니다. Windows의 ‘체크히어 시작.cmd’ 또는 macOS의 ‘체크히어 시작.command’를 실행하고 브라우저의 로컬 네트워크 연결 허용 여부를 확인해 주세요.');}
    const d=await r.json();if(!r.ok)throw new Error(d.error||'요청에 실패했습니다.');return d;
  }
  // 전체·전체 선택은 공식 반만(시험용 테스트반은 체크히어 강의가 없음). 테스트반은 하나 고르기·여러 반 선택에서 직접 고를 때만.
  const picked=new Set([CLASS_IDS[0]]),ALL=[...REAL_CLASS_IDS];
  const classIds=()=>{const v=$('#class').value;return v==='all'?ALL:v==='multi'?CLASS_IDS.filter(c=>picked.has(c)):[v];};
  const classLabel=()=>{const v=$('#class').value;return v==='all'?'전체':v==='multi'?[...classIds()].join('·')||'선택없음':v;};
  const selected=()=>state.records.filter(r=>($('#class').value==='all'||($('#class').value==='multi'?picked.has(String(r.classId)):String(r.classId)===$('#class').value))&&r.date>=$('#from').value&&r.date<=$('#to').value);
  function render(){
    if(disposed||!host.isConnected||host.hidden){clearTimeout(pollTimer);return;}
    $('#connectionStatus').textContent=state.connected?'체크히어 연결됨':key?'로컬 연결됨 · 로그인 확인':'연결 대기';$('#connectionStatus').title=state.connected?privacyOf(state)?.text||'':'';$('#connectionStatus').className=`badge ${state.connected?'good':''}`;
    const busy=state.jobs.find(j=>j.id===state.busy),records=selected().map(r=>{const fingerprint=JSON.stringify([r.version,r.source,r.readState,r.reference,r.exception]);let cached=auditCache.get(r.id);if(!cached||cached.fingerprint!==fingerprint){cached={fingerprint,audit:judge(r)};auditCache.set(r.id,cached);}return {...r,audit:cached.audit};});
    $('#sync').disabled=!!state.busy||batchRunning||cloudSaves>0;$('#connect').disabled=!!state.busy||batchRunning||cloudSaves>0;$('#refresh').disabled=cloudSaves>0;$('#cancel').hidden=!['sync','batch'].includes(busy?.kind)&&!batchRunning;for(const id of ['class','from','to','mode','bulkPreset','loadCloud','saveCloud','pickAll','pickNone'])if($('#'+id))$('#'+id).disabled=batchRunning||cloudSaves>0||!!busy&&busy.kind==='batch';
    root.querySelectorAll('[data-pick]').forEach(x=>{x.checked=picked.has(x.dataset.pick);x.disabled=batchRunning||!!busy&&busy.kind==='batch';});
    $('#classPicker').hidden=$('#class').value!=='multi';$('#pickCount').textContent=`${picked.size}개 반 선택`;$('#saveCloud')&&($('#saveCloud').disabled ||= !!state.busy);
    $('#jobStatus').innerHTML=busy?.kind==='batch'?`<div class="status"><span class="spinner"></span>${esc(busy.mode==='full'?'정밀 수집':'빠른 수집')} ${busy.done}/${busy.total} 반·날짜 완료 · 상세 ${busy.count}명${busy.mode==='full'?'':` · 변경 없음 ${busy.skipped}명`}${busy.progress?` · 지금 ${esc(busy.progress.classId)}반 ${esc(busy.progress.date)} ${busy.progress.index}/${busy.progress.total}`:''}<br><span class="muted">연결 프로그램이 끝까지 진행합니다. 이 화면을 닫아도 수집은 계속됩니다.${ctx.save?' 다시 열면 끝난 날짜를 이어서 DB에 저장합니다.':''}</span></div>`:busy?`<div class="status"><span class="spinner"></span>${esc(busy.kind==='apply'?'체크히어 변경값 확인 중':busy.message)} ${busy.progress?`· ${esc(busy.progress.date)} ${busy.progress.index}/${busy.progress.total} ${esc(busy.progress.name)}`:''}</div>`:state.jobs[0]?`<div class="status">${esc(state.jobs[0].cloudError||state.jobs[0].message)} <span class="muted">${esc(state.jobs[0].finishedAt?.replace('T',' ').slice(0,19)||'')}</span></div>`:'';
    const review=records.filter(r=>r.audit.issues.length),missing=records.filter(r=>r.readState!=='complete'||r.source!=='live');
    $('#stats').innerHTML=[['전체 학생·날짜',records.length,''],['확인 필요',review.length,'warn'],['사유 확인',records.filter(r=>r.audit.issues.some(i=>i.code.startsWith('MEMO')||i.code==='RECOGNIZED_MEMO')).length,'warn'],['재수집 필요',missing.length,'bad']].map(([label,n,c])=>`<div class="stat ${c}"><small>${label}</small><strong>${n}</strong></div>`).join('');
    const filter=$('#filter').value,search=$('#search').value.trim();
    const matching=records.filter(r=>(!search||r.name.includes(search))&&(filter==='all'||filter==='review'&&r.audit.issues.length||filter==='memo'&&r.audit.issues.some(i=>i.code.includes('MEMO'))||filter==='partial'&&(r.source!=='live'||r.readState!=='complete'))).sort((a,b)=>a.date.localeCompare(b.date)||a.rowIndex-b.rowIndex);
    const pages=Math.max(1,Math.ceil(matching.length/100));page=Math.min(page,pages);const visible=matching.slice((page-1)*100,page*100),signature=JSON.stringify([page,matching.length,visible]);
    if(signature!==lastTableSignature){lastTableSignature=signature;
    $('#table').innerHTML=!visible.length?`<div class="card empty"><h2>${records.length?'조건에 맞는 기록이 없습니다':'반과 날짜를 선택하고 수집하세요'}</h2><p>체크히어 전용 크롬에 로그인하면 관리자 메모까지 가져옵니다.</p></div>`:`<div class="line" style="margin-bottom:12px"><button id="pagePrevious" ${page===1?'disabled':''}>이전 100건</button><span role="status">${page} / ${pages}페이지 · ${matching.length}건</span><button id="pageNext" ${page===pages?'disabled':''}>다음 100건</button></div><div class="tablewrap"><table><thead><tr><th>학생 / 날짜</th><th>입실 → 퇴실</th><th>시간 판정</th><th>입실·교시 관리자 메모</th><th>퇴실 관리자 메모</th><th>외출 구간</th><th>확인할 사항</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${visible.map(r=>`<tr><td><div class="name">${esc(r.name)}</div><div class="muted">${esc(r.classId)}반 · ${esc(r.date)}</div><div class="muted">식별번호 끝 ${esc(r.phoneLast4||'미확인')}</div></td><td class="times">${esc(time(Object.hasOwn(r,'rawEntry')?r.rawEntry:r.entry))}${r.rawEntry!==undefined&&r.rawEntry!==r.entry?`<div class="muted">교시 기록 ${esc(time(r.entry))}</div>`:''}<br>→ ${esc(time(r.exit))}<div class="muted">${r.audit.minutes===null?'참여시간 미확인':`실제 ${r.audit.minutes}분`}</div></td><td>${r.audit.labels.map(x=>`<span class="badge">${esc(x)}</span>`).join('')}<br><span class="badge ${r.source==='live'&&r.readState==='complete'?'good':'warning'}">${r.source==='live'?(r.readState==='complete'?'상세 수집 완료':'일부 수집 실패'):'과거 저장본'}</span><div class="muted">${esc((r.collectedAt||'').slice(0,10))}</div></td><td class="memo">${r.entryMemo===null||r.entryMemo===undefined?'<span class="muted">아직 읽지 못함</span>':esc(r.entryMemo)||'<span class="muted">메모 없음</span>'}</td><td class="memo">${r.exitMemo===null||r.exitMemo===undefined?'<span class="muted">아직 읽지 못함</span>':esc(r.exitMemo)||'<span class="muted">메모 없음</span>'}</td><td class="times">${r.outings?.length?r.outings.map(t=>`${esc(time(t.start))}<br>~ ${esc(time(t.end))}<br><span class="muted">${t.recognized===true?'교육시간 인정':t.recognized===false?'교육시간 미인정':'인정 여부 미확인'}</span>`).join('<hr>'):r.readState==='complete'?'없음':'미확인'}</td><td class="issues">${r.audit.issues.map(i=>esc(i.text)).join('<br>')||'<span class="badge good">발견된 이상 없음</span>'}${r.readError?`<br>${esc(r.readError)}`:''}${r.exception?`<br><span class="badge good">${esc(r.exception)}</span>`:''}</td>${canEdit?`<td><button data-edit="${esc(r.id)}">검토·수정</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(state.records.find(r=>r.id===b.dataset.edit)));
    if($('#pagePrevious'))$('#pagePrevious').onclick=()=>{page--;render();};if($('#pageNext'))$('#pageNext').onclick=()=>{page++;render();};
    }
    paintMask();
    $('#jobs').innerHTML=state.jobs.slice(0,10).map(j=>`<p><span class="badge">${esc(j.kind==='sync'?'수집':/probe$/.test(j.kind)?'진단':j.kind==='unmask'?'체크히어 해제':'반영')} · ${esc(({verified:j.cloudError?'DB 저장 재확인':j.platformSaved?(j.alreadyApplied?'이미 반영 · DB 저장 완료':'반영·DB 저장 완료'):'DB 저장 확인 중',complete:/probe$/.test(j.kind)?'진단 완료':'수집 완료',running:'진행 중',partial:'일부 실패',failed:'실패',unknown:'결과 미확인',conflict:'충돌',cancelled:'중단'})[j.status]||j.status)}</span> ${esc(j.cloudError||j.message)}</p>`).join('')||'<p class="muted">아직 작업이 없습니다.</p>';
  }
  // 체크히어 개인정보 가림(이 PC 화면에서만, 이름 없이 수만): 해제는 사람이 시작하고 인증번호도 사람이 넣습니다.
  let maskStep='',maskReason='',maskControls='';
  function paintMask(){
    // 순차 수정 첫 1건이 확인을 기다리면(build마다) 이 PC 화면에 알립니다. 「확인했음」 단추는 연결 프로그램의 /writer 화면에 있습니다(checkhere/writer.html).
    const el=$('#maskPanel'),m=state.masking||{},fr=state.requestWriter?.firstRun,writerCheck=local()&&(fr?.waitingConfirm===true||!!fr?.failedFirst);if(!el)return;
    if(!local()||(!m.view&&!m.header&&!writerCheck)){el.hidden=true;return;}el.hidden=false;
    // 해제 중인데 남은 시간을 읽지 못하면 쓰지 않으므로(안전한 쪽) 그렇게 보입니다.
    const left=Number.isFinite(m.remaining)?` · 남은 ${Math.floor(m.remaining/60)}분 ${m.remaining%60}초`:m.header==='unmasked'?' · 남은 시간 읽지 못함(쓰기 멈춤)':'';
    // 해제 상태 글(연결 프로그램 쓰기 관문과 같은 기준): 가림이면 읽기만, 해제됐고 남은 시간이 넉넉할 때만 수정·삭제. 섞임·남은 시간 모름은 예전 글.
    const p=privacyOf(state),known=p&&p.state!=='unknown'&&m.view!=='mixed'&&!(m.header==='unmasked'&&!Number.isFinite(m.remaining));
    $('#maskView').textContent=known?p.text:'체크히어 화면: '+(m.header==='unmasked'?'원문 표시 중'+left:m.view==='masked'?'개인정보 가림':m.view==='mixed'?'가림 상태 섞임':m.view==='plain'?'원문':'확인 전');
    $('#maskCounts').textContent=` · 연결 안 된 학생 ${m.unlinked||0}명 · 가림 때문에 기다리는 수정 ${m.waitingWrites||0}건${m.pendingLinks?` · 원문 확인 전 연결 ${m.pendingLinks}명`:''}${m.conflicts?` · 연결 충돌 ${m.conflicts}명`:''}${m.learning?` · 연결 확인 수집 대기 ${m.learning}반`:''}`;
    if(!m.unmasking&&maskStep==='code'&&!state.busy)maskStep='';const coding=maskStep==='code'||m.unmasking;
    // 입력 중인 칸이 지워지지 않게 단추 모양이 바뀔 때만 다시 그립니다.
    const html=coding?`<div class="line"><span class="muted">사유: ${esc(m.reason||maskReason||'기다리는 일')}</span></div><div class="line"><input id="maskCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="메일의 인증번호 6자리" aria-label="체크히어 인증번호"><button id="maskCodeSend" class="primary">인증번호 넣기</button><button id="maskCancel">취소</button></div>`
      // 누르기 전에 체크히어에 넣을 사유를 그대로 보입니다(누른 사람이 체크히어 기록의 이 글을 책임짐).
      :`<div class="line">${m.header!=='unmasked'&&m.reasonPreview?`<button id="maskStart" class="primary">마스킹 해제 시작</button><span class="muted">체크히어에 넣을 사유: ${esc(m.reasonPreview)}</span>`:''}${m.conflicts?'<button id="maskConflicts">연결 충돌 정리</button>':''}${writerCheck?`<span class="muted">${fr?.waitingConfirm===true?'순차 수정 첫 1건이 체크히어·플랫폼 저장까지 확인됐습니다. 체크히어에서 그 값을 본 뒤 이 PC의 '+BRIDGE_URL.replace('http://','')+'/writer에서 「확인했음」을 눌러 주세요.':'순차 수정 첫 1건이 끝까지 확인되지 않았습니다(나머지는 수정창으로 반영). 체크히어 원본을 확인한 뒤 이 PC의 '+BRIDGE_URL.replace('http://','')+'/writer에서 「확인했음」을 누르면 1건을 다시 순차 수정으로 해 봅니다.'}</span>`:''}</div>`;
    if(html===maskControls)return;maskControls=html;$('#maskControls').innerHTML=html;
    // 본 사유를 함께 보냅니다. 그 사이 기다리는 일이 바뀌었으면 연결 프로그램이 거절하고(409) 새 사유를 다시 보여 줍니다.
    if($('#maskStart'))$('#maskStart').onclick=handle(async()=>{$('#maskStart').disabled=true;let r;try{r=await api('unmask/start',{reason:m.reasonPreview});}catch(e){maskControls='';await refresh().catch(()=>{});throw e;}maskReason=r.reason||'';maskStep=r.stage==='code'?'code':'';await refresh();if(r.stage==='done')alertMessage('체크히어 해제됨','이미 원문 표시 중입니다.');});
    if($('#maskCodeSend'))$('#maskCodeSend').onclick=handle(async()=>{const code=$('#maskCode').value.trim();if(!/^\d{6}$/.test(code))throw Error('메일로 받은 인증번호 6자리 숫자를 넣어 주세요.');$('#maskCodeSend').disabled=true;try{const r=await api('unmask/code',{code});maskStep='';await refresh();alertMessage('체크히어 해제됨',`원문 표시 중${Number.isFinite(r.remaining)?` · 남은 ${Math.floor(r.remaining/60)}분 ${r.remaining%60}초`:''}. 기다리던 수정은 운영 포털 「반영 요청·승인」에서 다시 반영해 주세요(자동으로 쓰지 않습니다). 연결 안 된 반은 연결 프로그램이 원문으로 다시 읽습니다. 연장·종료는 체크히어 창에서 직접 누르세요.`);}finally{if($('#maskCodeSend'))$('#maskCodeSend').disabled=false;}});
    if($('#maskCancel'))$('#maskCancel').onclick=handle(async()=>{maskStep='';await api('unmask/cancel',{});await refresh();});
    if($('#maskConflicts'))$('#maskConflicts').onclick=handle(async()=>{const r=await api('links/clear-conflicts',{});await refresh();alertMessage('연결 충돌 정리',`연결 ${r.cleared}개를 지웠습니다. 해제된 화면에서 그 반을 다시 수집하면 새로 연결합니다.`);});
  }
  function showBatch(j){
    const bad=(j.results||[]).filter(r=>['failed','partial','cancelled'].includes(r.status)),none=(j.results||[]).filter(r=>r.status==='no-lecture'),saveFails=[...batchSaveErrors];
    $('#bulkStatus').innerHTML=`<div class="status">${j.status==='cancelled'?'수집 중단':'수집 종료'} · ${esc(j.message)}${bad.length?`<details open><summary>확인 필요 ${bad.length}건</summary>${bad.map(r=>`<p>${esc(r.classId)}반 · ${esc(r.date)} · ${esc(r.message||(r.status==='partial'?'일부 학생 상세를 읽지 못했습니다. 다시 수집해 주세요.':'중단됨'))}</p>`).join('')}</details>`:''}${none.length?`<details><summary>강의 없는 날 ${none.length}건</summary><p>${none.map(r=>`${esc(r.classId)}반 ${esc(r.date)}`).join(', ')}</p></details>`:''}${saveFails.length?`<details open><summary>DB 저장 실패 ${saveFails.length}건 · ‘플랫폼에 저장’으로 다시 저장하세요</summary>${saveFails.map(([k,m])=>`<p>${esc(k.replace('|','반 · '))} · ${esc(m)}</p>`).join('')}</details>`:''}</div>`;
  }
  function saveCloud(records,job){
    cloudSaves++;render();
    const task=cloudTail.catch(()=>{}).then(async()=>{
      const status=$('#cloudSaveStatus');
      try{
        const result=await ctx.save(records,job,{onProgress:p=>{status.textContent=`DB ${p.phase==='verifying'?'내용 확인 중':'저장 중'} · ${p.verifiedRecords}/${p.totalRecords}건 확인 · ${p.classId}반 ${p.date}`;}});
        if(!result?.verified)throw Error('서버 저장 완료를 확인하지 못했습니다. 다시 시도해 주세요.');
        status.textContent=`DB 저장 확인 완료 · ${result.recordCount}건 · 출결대조에 반영됨${result.partialCount?' · 상세 미수집 '+result.partialCount+'건은 재수집 필요':''}`;
        return result;
      }catch(e){status.textContent=e.message;throw e;}
      finally{cloudSaves--;render();}
    });
    cloudTail=task;return task;
  }
  async function refresh(){
    if(refreshPromise)return refreshPromise;refreshPromise=(async()=>{
    clearTimeout(pollTimer);const update=await api('state?delta=1'+(collectorCursor?'&cursor='+encodeURIComponent(collectorCursor):''));
    if(!Array.isArray(update.records))throw new Error('수집 기록을 읽지 못했습니다. 다시 조회해 주세요.');
    if(update.recordsMode==='merge'&&!collectorCursor)throw new Error('수집 연결을 다시 확인해 주세요.');
    if(update.recordsMode!=='merge'){collectorRecords.clear();auditCache.clear();}
    for(const record of update.records)collectorRecords.set(record.id,record);
    collectorCursor=update.cursor||'';state={...update,records:[...collectorRecords.values()]};cloudShown=false;render();
    const batch=state.jobs.find(x=>x.kind==='batch');
    if(batch){
      if(ctx.save){
        const done=savedDays(batch.id);
        for(const r of batch.results||[]){
          if(!['complete','partial'].includes(r.status)||!r.finishedAt)continue;
          const k=`${r.classId}|${r.date}|${r.finishedAt}`;if(done.has(k))continue;done.add(k);
          // The whole day (skipped students included) so the platform mirrors this PC.
          const day=state.records.filter(x=>String(x.classId)===String(r.classId)&&x.date===r.date&&x.source==='live');
          if(day.length)saveCloud(day,{id:batch.id,status:r.status}).then(()=>batchSaveErrors.delete(`${r.classId}|${r.date}`),e=>{batchSaveErrors.set(`${r.classId}|${r.date}`,e.message);done.delete(k);markSaved(batch.id,done);showBatch(batch);});
        }
        markSaved(batch.id,done);
      }
      if(batch.status!=='running'&&batchShown!==batch.id){batchShown=batch.id;showBatch(batch);}
    }
    for(const j of state.jobs){
      if(j.status==='running'||j.kind==='apply'&&j.cloudSaved===undefined||shownJobs.has(j.id))continue;shownJobs.add(j.id);
      if(j.kind==='apply'&&Date.now()-Date.parse(j.finishedAt||0)<120000)alertMessage(j.status==='verified'&&j.platformSaved?'체크히어 반영·DB 저장 완료':'체크히어 반영 확인 필요',j.message+(j.cloudError?'\n'+j.cloudError:'')+(j.results?.length?'\n'+j.results.map(x=>`${x.field==='entry'?'입실·교시':'퇴실'}: ${x.state==='verified'?'확인 완료':x.state==='unknown'?'결과 미확인':'실패 또는 충돌'}`).join('\n'):''));
      if(ctx.save&&(j.kind!=='apply'||!state.capabilities?.includes('approval-current-sync-v1'))&&['complete','partial','verified'].includes(j.status)&&j.finishedAt){
        const batch=state.records.filter(r=>(j.kind==='sync'?r.classId===j.classId&&j.dates.includes(r.date):r.id===j.recordId)&&r.source==='live'&&r.collectedAt>=j.startedAt&&r.collectedAt<=j.finishedAt);
        if(batch.length)try{await saveCloud(batch,j);}catch(e){alertMessage('수집 완료 · 플랫폼 저장 실패',`PC에는 수집 결과가 남아 있습니다. 플랫폼 저장을 다시 시도해 주세요.\n${e.message}`);}
      }
    }
    // 해제된 동안(이 PC 화면)은 남은 시간·연결 확인 수집을 보이려고 5초마다 다시 봅니다.
    if(state.busy&&!batchRunning&&host.isConnected&&!disposed)pollTimer=setTimeout(()=>refresh().catch(e=>alertMessage('연결 확인',e.message)),3000);
    else if(local()&&(state.masking?.header==='unmasked'||state.masking?.learning)&&!batchRunning&&host.isConnected&&!disposed)pollTimer=setTimeout(()=>refresh().catch(()=>{}),5000);
    // 그 밖에(이 PC 화면)는 15초마다 다시 봅니다: 열어 둔 화면이 '기다리는 수정 0건'·옛 해제 상태에 멈춰 「마스킹 해제 시작」·해제 상태 글이 틀리지 않게.
    else if(local()&&!batchRunning&&host.isConnected&&!disposed)pollTimer=setTimeout(()=>refresh().catch(()=>{}),15000);
    return state;
    })();try{return await refreshPromise;}finally{refreshPromise=null;}
  }
  function openEditor(r){
    if(!canEdit||(!ctx.requestNew&&!ctx.applyChange))return alertMessage('조회 전용','이 계정에서는 체크히어 데이터를 수집하고 조회할 수 있습니다.');
    editing=true;const a=judge(r),defaultCapable=state.capabilities?.includes('memo-default-time-v1'),canReview=r.source==='live'&&r.readState==='complete'&&(a.canApply||a.canApplyMemo||defaultCapable&&(!r.entry||!r.exit));$('#overlay').innerHTML=`<div class="backdrop"><section class="drawer" role="dialog" aria-modal="true" aria-label="학생 출결 검토"><header><div><div class="brand">${esc(r.classId)}반 · ${esc(r.date)}</div><h2>${esc(r.name)} 출결 검토</h2></div><button id="closeEdit">닫기</button></header><div class="notice">${canReview?'수정 근거와 변경 전후를 확인한 다음 반영하세요. 변경하는 메모의 시간이 비어 있으면 해당 기본 시간을 미리 표시합니다.':'현재 기록은 직접 반영할 수 없습니다. 진행중·교시 불일치·중복 여부와 수집 상태를 확인해 주세요.'}</div><div class="grid"><div class="field"><label for="newEntry">교시 시간 (09:00–18:00 칸)</label><input id="newEntry" type="time" step="1" value="${esc(r.entry||'')}"><div class="old">교시 기존 ${esc(time(r.entry))}<br>실제 입실 ${esc(time(Object.hasOwn(r,'rawEntry')?r.rawEntry:r.entry))}</div></div><div class="field"><label for="newExit">퇴실 시간</label><input id="newExit" type="time" step="1" value="${esc(r.exit||'')}"><div class="old">기존 ${esc(time(r.exit))}</div></div></div><div class="field"><label for="newEntryMemo">입실·교시 관리자 메모</label><textarea id="newEntryMemo">${esc(r.entryMemo||'')}</textarea><div class="old">기존: ${esc(r.entryMemo??'미수집')}</div></div><div class="field"><label for="newExitMemo">퇴실 관리자 메모</label><textarea id="newExitMemo">${esc(r.exitMemo||'')}</textarea><div class="old">기존: ${esc(r.exitMemo??'미수집')}</div></div><button id="suggest">시간 기준 사유 초안 넣기</button><div class="field"><label for="changeReason">수정 근거</label><textarea id="changeReason" placeholder="시트·수기출석 등 확인한 근거를 적어 주세요."></textarea></div><div id="preview"></div><div class="actions"><button id="reviewDiff" class="primary" ${canReview&&!state.busy&&!cloudShown?'':'disabled'}>변경 전후 확인</button></div><details><summary>현재 판정 근거</summary><p class="muted">${a.issues.map(i=>esc(i.text)).join('<br>')||'시간과 메모에서 발견된 이상 없음'}</p></details></section></div>`;
    $('#closeEdit').onclick=()=>{$('#overlay').innerHTML='';editing=false;};
    $('#suggest').onclick=()=>{for(const [k,v] of Object.entries(a.suggestions))$(k==='entryMemo'?'#newEntryMemo':'#newExitMemo').value=v;$('#preview').innerHTML='';};
    for(const el of root.querySelectorAll('#overlay input,#overlay textarea'))el.addEventListener('input',()=>{$('#preview').innerHTML='';});
    $('#reviewDiff').onclick=()=>{
      const draft={id:r.id,version:r.version,entry:$('#newEntry').value,exit:$('#newExit').value,entryMemo:$('#newEntryMemo').value,exitMemo:$('#newExitMemo').value,reason:$('#changeReason').value.trim(),requestId:crypto.randomUUID()};
      if(!draft.reason)return alertMessage('수정 근거 확인','수정 근거를 입력해 주세요.');
      for(const field of ['entry','exit']){
        draft[field]=normalizeTime(draft[field]);
        if(!draft[field]&&normalizeTime(r[field]))return alertMessage('시간 확인','기존 입실·퇴실 시간을 공란으로 지우는 변경은 지원하지 않습니다.');
      }
      const labels=[['entry','입실·교시'],['exit','퇴실'],['entryMemo','입실·교시 메모'],['exitMemo','퇴실 메모']];
      const diff=labels.filter(([k])=>draft[k]!==(['entry','exit'].includes(k)?normalizeTime(r[k]):r[k]??'')),automatic={};
      for(const [field,setting]of [['entry','start'],['exit','end']])if(diff.some(([k])=>k===field+'Memo')&&!draft[field])automatic[field]=normalizeTime(RULES[setting]);
      if(Object.keys(automatic).length&&ctx.applyChange&&!defaultCapable)return alertMessage('수집 프로그램 업데이트 필요','수집 PC에서 체크히어 시작.cmd를 다시 실행해 주세요. 누락 시간 자동 입력 지원이 필요합니다.');
      const expected={...draft,...automatic};
      if(expected.entry&&expected.exit&&expected.exit<expected.entry)return alertMessage('시간 확인','퇴실 시간이 입실 시간보다 빠릅니다. 시간을 확인해 주세요.');
      if(!diff.length)return alertMessage('변경 없음','수정한 값이 없습니다.');
      $('#preview').innerHTML=`<div class="diff"><strong>${ctx.applyChange?'체크히어에 반영할 변경':'관리자에게 요청할 변경'}</strong>${[...labels.filter(([k])=>Object.hasOwn(automatic,k)),...diff].map(([k,l])=>`<p>${l}${Object.hasOwn(automatic,k)?' · 누락 시간 자동 입력':''}<br><span class="muted">${esc(r[k]||'공란')}</span><br>→ ${esc(expected[k]||'공란')}</p>`).join('')}<div class="actions"><button id="applyNow" class="primary">${ctx.applyChange?'체크히어에 반영':'수정 요청 등록'}</button></div></div>`;
      // 바로 반영(직접 수정)은 보내기 전에 해제 상태를 다시 봅니다. 가려져 있으면 아무것도 만들지 않고 해제 안내만(해제는 사람이 수집 PC 체크히어 탭에서).
      $('#applyNow').onclick=async()=>{const b=$('#applyNow');b.disabled=true;try{if(ctx.applyChange){await refresh();const p=privacyOf(state);if(!p?.writable)throw Error(`${!p?PRIVACY_UPDATE_TEXT:p.state==='unmasked'?p.text:NEEDS_UNMASK_TEXT} 아무것도 바꾸지 않았습니다.`);}const input={classId:r.classId,date:r.date,name:r.name,phoneLast4:r.phoneLast4||'',reason:draft.reason,changes:Object.fromEntries(diff.map(([k])=>[k,draft[k]]))};const result=ctx.applyChange?await ctx.applyChange(input,r,draft.requestId):await ctx.requestNew(input);$('#overlay').innerHTML='';editing=false;if(ctx.applyChange)alertMessage(result?.status==='verified'?'반영 확인 완료':result?.status==='running'?'반영 진행 중':'반영 결과 확인',result?.message||'최근 작업 결과를 확인해 주세요.');else alertMessage('수정 요청 등록 완료','지정된 관리자가 요청 목록에서 승인하면 반영됩니다.');}catch(e){b.disabled=false;alertMessage(ctx.applyChange?'체크히어 반영 확인 필요':'수정 요청 실패',e.message);}};
    };
    $('#closeEdit').focus();
  }
  const handle=fn=>async()=>{try{await fn();}catch(e){alertMessage('확인 필요',e.message);}};
  $('#pair').onclick=handle(async()=>{const nextKey=$('#keyInput').value.trim();if(refreshPromise)await refreshPromise.catch(()=>{});if(key!==nextKey){collectorCursor='';collectorRecords.clear();shownJobs.clear();}key=nextKey;await refresh();$('#pairing').open=false;});
  $('#connect').onclick=handle(async()=>{
    const b=$('#connect');b.disabled=true;b.textContent='로그인 창 여는 중…';
    try{const result=await api('connect',{});await refresh();alertMessage(result.connected?'로그인 확인 완료':'체크히어 로그인 창 확인',result.connected?'체크히어에서 수집 버튼을 누르면 됩니다.':result.message+'\n새 창이 보이지 않으면 제공한 ‘체크히어 시작.cmd’를 직접 실행해 주세요.');}
    finally{b.disabled=false;b.textContent='체크히어 로그인';}
  });
  $('#refresh').onclick=handle(refresh);
  $('#cancel').onclick=handle(async()=>{batchStopped=true;await api('cancel',{});});
  $('#bulkPreset').onclick=()=>{$('#class').value='all';$('#from').value=COURSE_START;$('#to').value=courseDay(koreaToday());render();};
  $('#sync').onclick=handle(async()=>{
    if(batchRunning||state.busy)throw Error('진행 중인 작업이 있습니다.');
    const dates=collectionDates($('#from').value,$('#to').value),chosen=classIds();
    if(!chosen.length)throw Error('수집할 반을 하나 이상 선택해 주세요.');
    if(!dates.length)throw Error('평일 강의 날짜를 선택해 주세요.');
    if(state.capabilities?.includes('batch-sync-v1')){
      // The bridge runs every class/day in one job; this screen only watches and saves.
      const job=await api('sync-batch',{classIds:chosen,dates,mode:$('#mode').value});
      $('#bulkStatus').innerHTML=`<div class="status">${chosen.length}개 반 · ${dates.length}일 (${job.total}건) ${$('#mode').value==='full'?'정밀':'빠른'} 수집을 시작했습니다.</div>`;
      await refresh();return;
    }
    const classIdsForQueue=chosen;batchRunning=true;batchStopped=false;clearTimeout(pollTimer);render();
    try{
      const result=await runCollectionQueue({classIds:classIdsForQueue,dates,api,refresh,stopped:()=>batchStopped||!host.isConnected,onProgress:p=>{$('#bulkStatus').innerHTML=`<div class="status">전체 수집 ${p.completed}/${p.total} · ${esc(p.classId)}반 ${esc(p.date)}<br>현재 페이지와 연결 프로그램을 열어두세요.</div>`;}});
      const errors=result.results.filter(x=>x.status!=='complete');$('#bulkStatus').innerHTML=`<div class="status">${result.stopped?'수집 중단':'전체 수집 종료'} · ${result.results.length}/${result.total} 반·날짜 · 확인 필요 ${errors.length}건${errors.length?`<details><summary>미완료·오류 목록</summary>${errors.map(x=>`<p>${esc(x.classId)}반 · ${esc(x.date)} · ${esc(x.message)}</p>`).join('')}</details>`:''}</div>`;
    }finally{batchRunning=false;render();}
  });
  for(const selector of ['#class','#from','#to','#filter','#search'])$(selector).addEventListener(selector==='#search'?'input':'change',render);
  root.querySelectorAll('[data-pick]').forEach(x=>x.addEventListener('change',()=>{if(x.checked)picked.add(x.dataset.pick);else picked.delete(x.dataset.pick);render();}));
  $('#pickAll').onclick=()=>{for(const c of ALL)picked.add(c);render();};$('#pickNone').onclick=()=>{picked.clear();render();};
  $('#export').onclick=()=>{const data=selected().map(r=>{const fingerprint=JSON.stringify([r.version,r.source,r.readState,r.reference,r.exception]);let cached=auditCache.get(r.id);if(!cached||cached.fingerprint!==fingerprint){cached={fingerprint,audit:judge(r)};auditCache.set(r.id,cached);}return {...r,audit:cached.audit};});if(!data.length)return alertMessage('내보낼 기록 없음','먼저 기록을 수집하거나 저장본을 조회하세요.');const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records:data},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`체크히어_${classLabel()}반_${$('#from').value}_${$('#to').value}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  if(ctx.save)$('#saveCloud').onclick=handle(async()=>{const records=selected().filter(r=>r.source==='live');if(!records.length)throw new Error('현재 PC에서 수집한 기록이 없습니다.');const result=await saveCloud(records,{id:crypto.randomUUID(),status:'manual_archive'});alertMessage('플랫폼 저장 완료',`DB에서 ${result.recordCount}건의 저장 내용을 다시 확인했습니다. 출결대조에서 바로 확인할 수 있습니다.${result.partialCount?' 상세 미수집 '+result.partialCount+'건은 재수집이 필요합니다.':''}`);});
  if(ctx.load)$('#loadCloud').onclick=handle(async()=>{state.records=await ctx.load($('#class').value,{from:$('#from').value,to:$('#to').value});state.busy=null;cloudShown=true;render();});
  render();
  if(local())try{key=(await(await fetch('/api/session')).json()).key;$('#localKey').innerHTML=`<p class="muted">플랫폼 연결 키 · 이 키를 가진 화면에서 수집·반영할 수 있습니다.</p><p class="key">${esc(key)}</p><button id="copyKey">연결 키 복사</button>`;$('#copyKey').onclick=handle(()=>navigator.clipboard.writeText(key));await refresh();}catch(e){alertMessage('시작 확인',e.message);}
  else{$('#pairing').open=true;}
  // status: 가벼운 연결 프로그램 상태(build·능력·해제 상태 privacy만, 기록 없음). 승인 화면이 15초마다·반영 직전에 봅니다.
  ctx.onController?.({api,refresh,render,state:()=>state,status:()=>api('status'),select(classId,date){$('#class').value=String(classId);$('#from').value=date;$('#to').value=date;render();}});
  const dispose=()=>{disposed=true;clearTimeout(pollTimer);auditCache.clear();editing=false;};dispose.canLeave=()=>{if(!cloudSaves)return true;alertMessage('플랫폼 저장 중','DB 저장 확인이 끝난 뒤 이동해 주세요.');return false;};return dispose;
}
const standalone=document.getElementById('checkhereApp');if(standalone)mountCheckHere(standalone);

