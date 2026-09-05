import {doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const STYLE=`
:host{font-family:Pretendard,"Noto Sans KR","Malgun Gothic",system-ui,sans-serif;color:#0f172a}*{box-sizing:border-box}button,select,textarea,input{font:inherit}.wrap{width:100%;max-width:1760px;margin:0 auto}.card{background:#fff;border:1px solid #e2e8f0;border-radius:17px;box-shadow:0 5px 18px rgba(15,23,42,.04)}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:15px 16px;margin-bottom:12px}.field{display:flex;flex-direction:column;gap:6px}.field label{font-size:11px;color:#64748b;font-weight:900}.field select,.field input{border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:9px 11px;min-width:220px}.btn{border:0;border-radius:10px;padding:9px 12px;font-weight:900;cursor:pointer}.btn.soft{background:#eef2ff;color:#3730a3}.btn.dark{background:#0f172a;color:#fff}.btn.ghost{background:#f1f5f9;color:#334155}.btn:disabled{opacity:.45;cursor:not-allowed}.spacer{flex:1}.state{font-size:11px;color:#64748b}.autosave-notice{font-size:12px;font-weight:900;color:#dc2626;align-self:center;padding:7px 4px;white-space:nowrap}.workspace{display:grid;grid-template-columns:minmax(390px,.82fr) minmax(0,2.18fr);gap:12px;align-items:start}.preview-panel{padding:0;overflow:hidden;position:relative}.panel-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.panel-head h3{margin:0;font-size:14px}.panel-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.file-select{max-width:235px;border:1px solid #cbd5e1;border-radius:9px;padding:7px 9px;background:#fff;font-size:11px}.viewer-wrap{height:var(--viewer-h,700px);background:#0f172a;position:relative}.viewer-wrap iframe{border:0;width:100%;height:100%;display:block;background:#fff}.viewer-empty{height:100%;display:grid;place-items:center;color:#94a3b8;text-align:center;padding:24px;background:#111827;font-size:12px;line-height:1.6}.preview-panel.full{position:fixed;inset:12px;z-index:99999;border-radius:18px;box-shadow:0 30px 80px rgba(15,23,42,.35)}.preview-panel.full .viewer-wrap{height:calc(100vh - 78px)!important}.size-row{display:flex;align-items:center;gap:8px;font-size:11px;color:#64748b}.size-row input{width:100px}.data-panel{overflow:hidden}.data-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(520px,620px);background:#f8fafc;border-bottom:1px solid #e2e8f0}.data-head>div{padding:12px 14px;font-size:12px;font-weight:900}.data-head>div+div{border-left:1px solid #e2e8f0}.rows{max-height:820px;overflow:auto}.student-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(520px,620px);border-bottom:1px solid #e2e8f0;min-height:112px}.student-row:last-child{border-bottom:0}.sheet-side{display:grid;grid-template-columns:100px 82px minmax(150px,1fr) 104px;gap:9px;align-items:center;padding:11px 13px}.memo-side{border-left:1px solid #e2e8f0;padding:8px 10px}.memo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.memo-field{min-width:0}.memo-label{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:5px;font-size:10px;font-weight:900;color:#475569}.name{font-weight:900;font-size:13px}.status{display:inline-flex;width:max-content;padding:5px 8px;border-radius:999px;background:#f1f5f9;font-size:11px;font-weight:900}.status.present{background:#dcfce7;color:#166534}.status.absent{background:#fee2e2;color:#991b1b}.status.special{background:#fef3c7;color:#92400e}.reason{font-size:12px;line-height:1.5;color:#475569;white-space:pre-wrap;word-break:break-word}.reason.none{color:#94a3b8}.evidence{display:inline-flex;width:max-content;max-width:100%;padding:5px 7px;border-radius:999px;font-size:10px;font-weight:900;white-space:nowrap}.evidence.confirmed{background:#dcfce7;color:#166534}.evidence.rejected{background:#fee2e2;color:#991b1b}.evidence.missing{background:#fef3c7;color:#92400e}.evidence.required{background:#fee2e2;color:#b91c1c}.evidence.none{background:#f1f5f9;color:#64748b}.evidence.loading{background:#e0e7ff;color:#3730a3}.memo{width:100%;min-height:72px;resize:vertical;border:1px solid #cbd5e1;border-radius:9px;padding:7px 8px;font-size:11px;line-height:1.4}.memo-state{font-size:9px;color:#64748b;white-space:nowrap;font-weight:700}.empty{padding:42px;text-align:center;color:#64748b}.error{padding:14px 16px;border-radius:12px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;margin-bottom:12px;font-size:12px;white-space:pre-wrap}.hint{font-size:11px;color:#64748b;padding:0 2px 10px}.count{display:inline-flex;padding:5px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10px;font-weight:900}.manual-issue{padding:12px 14px 14px;border-top:1px solid #e2e8f0;background:#fff}.manual-issue-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px}.manual-issue-head strong{font-size:13px}.manual-issue textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:12px;line-height:1.5;background:#fff}.manual-issue-state{font-size:10px;color:#64748b;white-space:nowrap}.preview-panel.full .manual-issue{display:none}.folder-target{padding:7px 12px;border-bottom:1px solid #e2e8f0;background:#fff;font-size:10px;color:#64748b;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.folder-target strong{color:#0f172a}.folder-target a{color:#1d4ed8;font-weight:900;text-decoration:none}.folder-target.warn{background:#fff7ed;color:#9a3412}.viewer-wrap{overflow:auto}@media(max-width:1450px){.data-head,.student-row{grid-template-columns:minmax(0,1fr) minmax(450px,520px)}.memo-grid{grid-template-columns:1fr}.memo{min-height:52px}.student-row{min-height:190px}}@media(max-width:1180px){.workspace{grid-template-columns:1fr}.wrap{width:100%}.viewer-wrap{height:600px}.data-head,.student-row{grid-template-columns:minmax(0,1fr) minmax(360px,440px)}}@media(max-width:820px){.data-head{display:none}.student-row{grid-template-columns:1fr}.memo-side{border-left:0;border-top:1px dashed #e2e8f0}.memo-grid{grid-template-columns:1fr}.sheet-side{grid-template-columns:90px 80px minmax(120px,1fr) 100px}.field{width:100%}.field select{width:100%;min-width:0}.autosave-notice{white-space:normal}.viewer-wrap{height:520px}}@media(max-width:620px){.sheet-side{grid-template-columns:1fr}.student-row{min-height:0}}
`;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pad=n=>String(n).padStart(2,'0');
function dateIso(label){
  const s=String(label||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=s.match(/(?:^|\D)(\d{1,2})\s*[\/\.\-]\s*(\d{1,2})(?:\D|$)/);
  return m?`2026-${pad(m[1])}-${pad(m[2])}`:'';
}
function normDate(v){return String(v||'').trim().replace(/\s+/g,' ')}
function normReasonText(v){return String(v||'').replace(/\r/g,'\n').replace(/\n{2,}/g,'\n').trim()}
function cleanReason(v,status=''){
  let s=String(v||'').trim();
  s=s.replace(/^\s*(?:님)?\s*[-_:：=→>\/|,，]+\s*/,'').replace(/^\s*(?:사유|이유)\s*[-_:：=]?\s*/,'').trim();
  s=s.replace(/^(?:출석|결석|지각|조퇴|외출|인정출석|중복)\s*[-_:：]?\s*/,'').trim();
  if(status)s=s.replace(new RegExp('^'+status.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[-_:：]?\\s*'),'').trim();
  return s.replace(/^[-_:：=→>\/|,，\s]+|[-_:：=→>\/|,，\s]+$/g,'').trim();
}
function reasonFor(name,text,roster,status=''){
  const src=normReasonText(text);if(!src||!name)return'';
  const lines=src.split('\n').map(x=>x.trim()).filter(Boolean),candidates=[];
  const otherNames=roster.filter(n=>n&&n!==name).sort((a,b)=>b.length-a.length);
  for(const line of lines){
    const p=line.indexOf(name);if(p<0)continue;
    let after=line.slice(p+name.length),cut=after.length;
    for(const n of otherNames){const i=after.indexOf(n);if(i>=0&&i<cut)cut=i}
    const direct=cleanReason(after.slice(0,cut),status);if(direct&&direct.length<=180)candidates.push({v:direct,s:7});
    const present=roster.filter(n=>n&&line.includes(n));
    if(present.length>=2){let lastEnd=-1;for(const n of present){const i=line.lastIndexOf(n);if(i>=0)lastEnd=Math.max(lastEnd,i+n.length)}if(lastEnd>=0){const shared=cleanReason(line.slice(lastEnd),status);if(shared&&shared.length<=180)candidates.push({v:shared,s:5})}}
  }
  try{
    const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp(safe+'\\s*(?:님)?\\s*[-_:：=→>\\/|]\\s*([^\\n]{1,180})','g');let m;
    while((m=rx.exec(src))){let raw=m[1];for(const n of otherNames){const i=raw.indexOf(n);if(i>=0)raw=raw.slice(0,i)}const v=cleanReason(raw,status);if(v)candidates.push({v,s:9})}
  }catch{}
  candidates.sort((a,b)=>b.s-a.s||a.v.length-b.v.length);return candidates[0]?.v||'';
}
function statusClass(s){const x=String(s||'');if(x==='출석')return'present';if(x==='결석')return'absent';if(['지각','조퇴','외출','인정출석','중복'].includes(x))return'special';return''}
function memoId(classId,iso){return`attendanceOverviewMemo_${classId}_${iso}`}
function normalizeMemoBundle(v){if(v&&typeof v==='object'&&!Array.isArray(v))return{checkhere:String(v.checkhere||''),documents:String(v.documents||''),manual:String(v.manual||'')};if(typeof v==='string'&&v)return{checkhere:v,documents:'',manual:''};return{checkhere:'',documents:'',manual:''}}
function colorState(bg){
  let x=String(bg||'').trim().toLowerCase();
  if(/^#[0-9a-f]{3}$/.test(x))x='#'+x.slice(1).split('').map(c=>c+c).join('');
  if(!/^#[0-9a-f]{6}$/.test(x))return'missing';
  const r=parseInt(x.slice(1,3),16),g=parseInt(x.slice(3,5),16),b=parseInt(x.slice(5,7),16);
  if(r>=242&&g>=242&&b>=242)return'missing';
  if(r>=180&&g>=135&&b<=190&&Math.abs(r-g)<=110&&g>b+20)return'confirmed';
  if(r>=175&&g<=185&&b<=185&&r>g+25&&r>b+25)return'red';
  return'missing';
}
function evidenceFor(student,dateObj,status,backgrounds){
  const raw=String(status||'').trim();
  const x=raw==='인정결석'?'중복':raw;
  const relevant=x==='인정출석'||['결석','지각','조퇴','외출','중복'].includes(x);
  if(!relevant)return{label:'-',cls:'none'};
  if(!Array.isArray(backgrounds)||!backgrounds.length)return{label:'확인 중…',cls:'loading'};
  const bg=String(backgrounds?.[Number(student.rowIndex)+1]?.[Number(dateObj.idx)+4]||'');
  const c=colorState(bg);
  if(x==='인정출석'){
    if(c==='confirmed')return{label:'확인',cls:'confirmed'};
    if(c==='red')return{label:'보완필요',cls:'rejected'};
    return{label:'미제출',cls:'missing'};
  }
  if(c==='red')return{label:'제출 필요',cls:'required'};
  return{label:'-',cls:'none'};
}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok||d.ok===false)throw new Error(d.error||`${url} ${r.status}`);return d}

export async function mountAttendanceOverview(host,ctx){
  if(!host)throw new Error('출석부 한눈에 보기 영역을 찾지 못했습니다.');
  const {auth,db,user,classes=[]}=ctx||{};if(!auth||!db||!user)throw new Error('관리자 로그인 세션이 없습니다.');
  const outer=host.closest?.('.attendance-native-shell')||host.parentElement;
  if(outer){outer.style.overflow='visible';outer.style.width='min(1760px, calc(100vw - 32px))';outer.style.maxWidth='none';outer.style.marginLeft='50%';outer.style.transform='translateX(-50%)'}
  const root=host.shadowRoot||host.attachShadow({mode:'open'});
  root.innerHTML=`<style>${STYLE}</style><div class="wrap"><div id="err"></div><section class="card toolbar"><div class="field"><label>반</label><select id="classSel">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반 · ${esc(c.course||'')}</option>`).join('')}</select></div><div class="field"><label>교육일자</label><select id="dateSel"><option>불러오는 중…</option></select></div><button id="reload" class="btn soft">↻ 다시 읽기</button><span class="autosave-notice">※ 모든 메모는 저장버튼 없이 자동저장됩니다.</span><div class="spacer"></div><span id="topState" class="state">준비 중…</span></section><div class="hint">원본 Google Sheet와 Google Drive는 읽기만 합니다. 서류제출 상태는 출결 자동검증과 동일한 시트 색상 기준으로 표시합니다.</div><section class="workspace"><article id="previewPanel" class="card preview-panel"><div class="panel-head"><div><h3>수기출석부 미리보기</h3><span id="fileCount" class="count">0개</span></div><div class="panel-actions"><select id="fileSel" class="file-select"></select><button id="openFile" class="btn ghost" disabled>새 창</button><button id="full" class="btn dark">크게 보기</button><span class="size-row">높이 <input id="height" type="range" min="480" max="950" step="10" value="700"></span></div></div><div id="folderTarget" class="folder-target">날짜 폴더 확인 중…</div><div id="viewer" class="viewer-wrap"><div class="viewer-empty">반과 날짜를 불러오는 중입니다.</div></div><div class="manual-issue"><div class="manual-issue-head"><strong>수기출석부 이슈 메모</strong><span id="manualIssueState" class="manual-issue-state"></span></div><textarea id="manualIssueMemo" placeholder="시스템오류 누락, 관리자 서명 누락 등 기재"></textarea></div></article><article class="card data-panel"><div class="data-head"><div>Google Sheet · 이름 / 출석현황 / 가-3 사유 / 서류제출</div><div>학생별 관리자 메모 · 체크히어 / 서류제출 / 수기출석</div></div><div id="rows" class="rows"><div class="empty">불러오는 중…</div></div></article></section></div>`;
  const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),viewer=$('#viewer'),fileSel=$('#fileSel'),openFile=$('#openFile'),fileCount=$('#fileCount'),previewPanel=$('#previewPanel'),folderTarget=$('#folderTarget'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState');
  let dates=[],students=[],reasonCells={},driveFiles=[],memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();
  const colorCache=new Map(),colorPromises=new Map();
  const showErr=e=>{err.innerHTML=e?`<div class="error">${esc(e.message||e)}</div>`:''};
  async function getReader(cid){const idToken=await user.getIdToken();return post('/api/attendance-reader',{idToken,classId:String(cid)})}
  async function getColorsOnce(cid){
  const idToken=await user.getIdToken();
  const d=await post('/api/attendance-colors',{idToken,classId:String(cid)});
  if(Array.isArray(d.attendanceBackgrounds))return d.attendanceBackgrounds;
  if(Array.isArray(d.backgrounds))return d.backgrounds;
  return [];
}
async function getColors(cid){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const bg=await getColorsOnce(cid);
      if(Array.isArray(bg)&&bg.length)return bg;
      lastError=new Error('색상 데이터가 비어 있습니다.');
    }catch(e){lastError=e}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
  }
  throw lastError||new Error('색상 데이터를 불러오지 못했습니다.');
}
  async function getColorsCached(cid,force=false){
    const id=String(cid),storageKey=`attendanceOverviewColors_${id}`,ttl=180000;
    if(!force&&colorCache.has(id))return colorCache.get(id);
    if(!force){try{const raw=sessionStorage.getItem(storageKey),x=raw?JSON.parse(raw):null;if(x&&Array.isArray(x.data)&&Date.now()-Number(x.at||0)<ttl){colorCache.set(id,x.data);return x.data}}catch{}}
    if(!force&&colorPromises.has(id))return colorPromises.get(id);
    const promise=getColors(id).then(bg=>{const data=Array.isArray(bg)?bg:[];colorCache.set(id,data);try{sessionStorage.setItem(storageKey,JSON.stringify({at:Date.now(),data}))}catch{}return data}).finally(()=>colorPromises.delete(id));
    colorPromises.set(id,promise);return promise;
  }
  async function getDrive(cid,iso){const idToken=await user.getIdToken();return post('/api/admin-drive-review',{idToken,action:'list',classId:String(cid),date:iso,folderKey:'manualAttendance'})}
  function parseReader(out){
    const a=out.attendance||[],h=a[0]||[];dates=h.slice(4).map((x,i)=>({label:normDate(x),idx:i,iso:dateIso(x)})).filter(x=>x.label&&x.iso);students=a.slice(1).map((r,rowIndex)=>({rowIndex,name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);const g=out.reasons||[],rh=(g[0]||[]).slice(4),rr=(g[1]||[]).slice(4);reasonCells={};rh.forEach((d,i)=>reasonCells[normDate(d)]=rr[i]||'');
  }
  async function loadMemos(cid,iso){memos={};manualIssue='';try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'')}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':''}
  function keyFor(s){return`${s.rowIndex}_${s.name}`}
  async function saveStudentMemo(key,category,value,stateEl,cid,iso){
    const bundle=normalizeMemoBundle(memos[key]);bundle[category]=String(value||'');memos={...memos,[key]:bundle};if(!bundle.checkhere.trim()&&!bundle.documents.trim()&&!bundle.manual.trim())delete memos[key];const snapshot=JSON.parse(JSON.stringify(memos));if(stateEl)stateEl.textContent='저장 중';
    try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso&&stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}
  }
  async function saveManualIssue(value,stateEl,cid,iso){const next=String(value||'');if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,manualIssue:next,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso){manualIssue=next;if(stateEl)stateEl.textContent='저장됨'}}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}
  function renderRows(label){
    const d=dates.find(x=>x.label===label);if(!d){rows.innerHTML='<div class="empty">해당 날짜를 찾지 못했습니다.</div>';return}
    const reasonText=reasonCells[label]||'',roster=students.map(x=>x.name);
    rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="sheet-side"><div class="name">${esc(s.name)}</div><div><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="reason ${reason?'':'none'}">${esc(reason||'-')}</div><div><span class="evidence ${e.cls}">${esc(e.label)}</span></div></div><div class="memo-side"><div class="memo-grid"><div class="memo-field"><div class="memo-label"><span>체크히어 관련</span><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span></div><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="사유기재 누락, 입퇴실 시간 수기와 불일치">${esc(bundle.checkhere)}</textarea></div><div class="memo-field"><div class="memo-label"><span>서류제출 관련</span><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span></div><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="홍길동 0월0일 미제출/반력">${esc(bundle.documents)}</textarea></div><div class="memo-field"><div class="memo-label"><span>수기출석 관련</span><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span></div><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder='"사유기재 오류 결석이 아닌 인정출석", "학생서명 누락", "입·퇴실 시간 누락", "외출시간 누락" 등 확인사항'>${esc(bundle.manual)}</textarea></div></div></div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';
    root.querySelectorAll('.memo').forEach(ta=>{ta.oninput=()=>{const key=ta.dataset.key,category=ta.dataset.category,stateKey=ta.dataset.stateKey,state=root.querySelector(`[data-state="${CSS.escape(stateKey)}"]`),cid=currentClass,iso=currentIso,timerKey=`${cid}_${iso}_${key}_${category}`;if(state)state.textContent='입력 중';clearTimeout(saveTimers.get(timerKey));saveTimers.set(timerKey,setTimeout(()=>saveStudentMemo(key,category,ta.value,state,cid,iso).catch(e=>showErr(e)),650))}})
  }
  function renderFile(index=0){const f=driveFiles[index];fileCount.textContent=`${driveFiles.length}개`;if(!f){viewer.innerHTML='<div class="viewer-empty">해당 날짜의 수기출석부 파일을 찾지 못했습니다.<br>날짜 폴더가 있다면 Drive에서 파일 업로드 여부를 확인해 주세요.</div>';openFile.disabled=true;return}openFile.disabled=false;openFile.dataset.url=f.fileUrl||'';const src=f.previewUrl||f.fileUrl||'';viewer.innerHTML=src?`<iframe src="${esc(src)}" allow="fullscreen" referrerpolicy="no-referrer"></iframe>`:'<div class="viewer-empty">미리보기 주소가 없습니다.</div>'}
  async function loadDrive(){
    driveFiles=[];fileSel.innerHTML='';openFile.dataset.url='';openFile.disabled=true;
    if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.classList.remove('warn');folderTarget.textContent=`${currentIso} 날짜 폴더 찾는 중…`}
    viewer.innerHTML='<div class="viewer-empty">선택한 교육일자의 정확한 수기출석부 날짜 폴더를 찾는 중…</div>';
    try{
      const d=await getDrive(currentClass,currentIso);
      const exact=Boolean(d.exactDateFolder&&d.dateFolderId);
      const folderUrl=d.dateFolderUrl||d.folderUrl||'';
      if(!exact){
        fileCount.textContent='날짜폴더 없음';
        fileSel.innerHTML='<option value="">정확한 날짜 폴더 없음</option>';
        if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.classList.add('warn');folderTarget.textContent=`${currentIso} 날짜 폴더를 찾지 못함`}
        viewer.innerHTML='<div class="viewer-empty">선택한 교육일자와 정확히 일치하는 수기출석부 날짜 폴더를 찾지 못했습니다.<br>반·날짜 및 Drive 날짜 폴더명을 확인해 주세요.</div>';
        return;
      }
      if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.innerHTML=`<strong>${esc(currentIso)} 날짜 폴더 확인됨</strong>${folderUrl?`<a href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer">날짜 폴더 새 창</a>`:''}`}
      driveFiles=Array.isArray(d.files)?d.files:[];
      const embedded=d.embeddedFolderUrl||'';
      const reported=Number.isFinite(Number(d.fileCount))?Number(d.fileCount):driveFiles.length;
      fileCount.textContent=`${reported}개 · 날짜폴더`;
      if(driveFiles.length){
        fileSel.innerHTML=driveFiles.map((f,i)=>`<option value="${i}">${esc(f.name||`파일 ${i+1}`)}</option>`).join('');
        renderFile(0);
        return;
      }
      fileSel.innerHTML='<option value="">개별 파일 목록 없음</option>';
      openFile.disabled=!folderUrl;openFile.dataset.url=folderUrl;
      if(embedded){
        viewer.innerHTML=`<iframe src="${esc(embedded)}" referrerpolicy="no-referrer"></iframe>`;
      }else{
        viewer.innerHTML='<div class="viewer-empty">정확한 날짜 폴더는 찾았지만 PDF/이미지 파일 목록을 받지 못했습니다.<br>날짜 폴더의 파일 목록 연동을 확인해 주세요.</div>';
      }
    }catch(e){
      if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.classList.add('warn');folderTarget.textContent='날짜 폴더 확인 실패'}
      viewer.innerHTML=`<div class="viewer-empty">수기출석부를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`;
      fileCount.textContent='오류';openFile.disabled=true;
    }
  }
  async function loadSelectedDate(){showErr('');const label=dateSel.value,d=dates.find(x=>x.label===label);if(!d)return;currentIso=d.iso;topState.textContent=`${currentClass}반 · ${label} 불러오는 중…`;await loadMemos(currentClass,currentIso);renderRows(label);loadDrive();topState.textContent=`${currentClass}반 · ${label} · ${students.length}명`}
  async function loadClass(cid,keepDate='',forceColors=false){
    showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class="empty">Google Sheet를 읽는 중…</div>';
    const colorClass=currentClass,colorPromise=getColorsCached(colorClass,forceColors);
    try{
      const out=await getReader(currentClass);parseReader(out);dateSel.innerHTML=dates.map(d=>`<option value="${esc(d.label)}">${esc(d.label)}</option>`).join('');const preferred=dates.find(x=>x.label===keepDate)?.label||dates.at(-1)?.label||dates[0]?.label||'';dateSel.value=preferred;await loadSelectedDate();
      colorPromise.then(bg=>{if(currentClass!==colorClass)return;attendanceBackgrounds=bg;renderRows(dateSel.value);topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 서류색상 반영`}).catch(e=>{console.warn('attendance colors failed',e);if(currentClass===colorClass)topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 색상 확인 실패`})
    }catch(e){showErr(e);rows.innerHTML='<div class="empty">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}
  }
  classSel.onchange=()=>loadClass(classSel.value);
  dateSel.onchange=()=>loadSelectedDate();
  $('#reload').onclick=()=>loadClass(currentClass,dateSel.value,true);
  fileSel.onchange=()=>renderFile(Number(fileSel.value||0));
  openFile.onclick=()=>{const u=openFile.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};
  $('#height').oninput=e=>viewer.style.setProperty('height',`${e.target.value}px`);
  manualIssueMemo.oninput=()=>{manualIssueState.textContent='입력 중';const cid=currentClass,iso=currentIso,value=manualIssueMemo.value,key=`manualIssue_${cid}_${iso}`;clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveManualIssue(value,manualIssueState,cid,iso).catch(e=>showErr(e)),650))};
  $('#full').onclick=e=>{previewPanel.classList.toggle('full');e.currentTarget.textContent=previewPanel.classList.contains('full')?'작게 보기':'크게 보기'};
  await loadClass(classSel.value||'1');
}
