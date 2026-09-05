import {doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const STYLE=`
:host{font-family:Pretendard,"Noto Sans KR","Malgun Gothic",system-ui,sans-serif;color:#0f172a}*{box-sizing:border-box}button,select,textarea,input{font:inherit}.wrap{width:min(1600px,calc(100vw - 32px));margin-left:50%;transform:translateX(-50%)}.card{background:#fff;border:1px solid #e2e8f0;border-radius:17px;box-shadow:0 5px 18px rgba(15,23,42,.04)}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:15px 16px;margin-bottom:12px}.field{display:flex;flex-direction:column;gap:6px}.field label{font-size:11px;color:#64748b;font-weight:900}.field select,.field input{border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:9px 11px;min-width:220px}.btn{border:0;border-radius:10px;padding:9px 12px;font-weight:900;cursor:pointer}.btn.soft{background:#eef2ff;color:#3730a3}.btn.dark{background:#0f172a;color:#fff}.btn.ghost{background:#f1f5f9;color:#334155}.btn:disabled{opacity:.45;cursor:not-allowed}.spacer{flex:1}.state{font-size:11px;color:#64748b}.workspace{display:grid;grid-template-columns:minmax(430px,1.15fr) minmax(720px,2fr);gap:12px;align-items:start}.preview-panel{padding:0;overflow:hidden;position:relative}.panel-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.panel-head h3{margin:0;font-size:14px}.panel-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.file-select{max-width:250px;border:1px solid #cbd5e1;border-radius:9px;padding:7px 9px;background:#fff;font-size:11px}.viewer-wrap{height:var(--viewer-h,700px);background:#0f172a;position:relative}.viewer-wrap iframe{border:0;width:100%;height:100%;display:block;background:#fff}.viewer-empty{height:100%;display:grid;place-items:center;color:#94a3b8;text-align:center;padding:24px;background:#111827;font-size:12px;line-height:1.6}.preview-panel.full{position:fixed;inset:12px;z-index:99999;border-radius:18px;box-shadow:0 30px 80px rgba(15,23,42,.35)}.preview-panel.full .viewer-wrap{height:calc(100vh - 78px)!important}.size-row{display:flex;align-items:center;gap:8px;font-size:11px;color:#64748b}.size-row input{width:110px}.data-panel{overflow:hidden}.data-head{display:grid;grid-template-columns:minmax(0,1fr) 330px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.data-head>div{padding:12px 14px;font-size:12px;font-weight:900}.data-head>div+div{border-left:1px solid #e2e8f0}.rows{max-height:760px;overflow:auto}.student-row{display:grid;grid-template-columns:minmax(0,1fr) 330px;border-bottom:1px solid #e2e8f0;min-height:78px}.student-row:last-child{border-bottom:0}.sheet-side{display:grid;grid-template-columns:120px 110px minmax(220px,1fr);gap:10px;align-items:center;padding:10px 13px}.memo-side{border-left:1px solid #e2e8f0;padding:9px 10px;display:flex;align-items:center;gap:8px}.name{font-weight:900;font-size:13px}.status{display:inline-flex;width:max-content;padding:5px 8px;border-radius:999px;background:#f1f5f9;font-size:11px;font-weight:900}.status.present{background:#dcfce7;color:#166534}.status.absent{background:#fee2e2;color:#991b1b}.status.special{background:#fef3c7;color:#92400e}.reason{font-size:12px;line-height:1.5;color:#475569;white-space:pre-wrap;word-break:break-word}.reason.none{color:#94a3b8}.memo{width:100%;min-height:52px;resize:vertical;border:1px solid #cbd5e1;border-radius:9px;padding:8px 9px;font-size:12px;line-height:1.4}.memo-state{width:48px;flex:0 0 48px;font-size:10px;color:#64748b;text-align:center}.empty{padding:42px;text-align:center;color:#64748b}.error{padding:14px 16px;border-radius:12px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;margin-bottom:12px;font-size:12px;white-space:pre-wrap}.hint{font-size:11px;color:#64748b;padding:0 2px 10px}.count{display:inline-flex;padding:5px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10px;font-weight:900}@media(max-width:1080px){.workspace{grid-template-columns:1fr}.wrap{width:100%;margin-left:0;transform:none}.viewer-wrap{height:600px}.data-head,.student-row{grid-template-columns:minmax(0,1fr) 300px}.memo-side{min-width:0}}@media(max-width:720px){.sheet-side{grid-template-columns:1fr}.data-head{display:none}.student-row{grid-template-columns:1fr}.memo-side{border-left:0;border-top:1px dashed #e2e8f0}.field{width:100%}.field select{width:100%;min-width:0}.viewer-wrap{height:520px}}
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
    let after=line.slice(p+name.length);
    let cut=after.length;
    for(const n of otherNames){const i=after.indexOf(n);if(i>=0&&i<cut)cut=i}
    const direct=cleanReason(after.slice(0,cut),status);if(direct&&direct.length<=180)candidates.push({v:direct,s:7});
    const present=roster.filter(n=>n&&line.includes(n));
    if(present.length>=2){
      let lastEnd=-1;for(const n of present){const i=line.lastIndexOf(n);if(i>=0)lastEnd=Math.max(lastEnd,i+n.length)}
      if(lastEnd>=0){const shared=cleanReason(line.slice(lastEnd),status);if(shared&&shared.length<=180)candidates.push({v:shared,s:5})}
    }
  }
  try{
    const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp(safe+'\\s*(?:님)?\\s*[-_:：=→>\\/|]\\s*([^\\n]{1,180})','g');let m;
    while((m=rx.exec(src))){let raw=m[1];for(const n of otherNames){const i=raw.indexOf(n);if(i>=0)raw=raw.slice(0,i)}const v=cleanReason(raw,status);if(v)candidates.push({v,s:9})}
  }catch{}
  candidates.sort((a,b)=>b.s-a.s||a.v.length-b.v.length);
  return candidates[0]?.v||'';
}
function statusClass(s){const x=String(s||'');if(x==='출석')return'present';if(x==='결석')return'absent';if(['지각','조퇴','외출','인정출석','중복'].includes(x))return'special';return''}
function memoId(classId,iso){return`attendanceOverviewMemo_${classId}_${iso}`}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok||d.ok===false)throw new Error(d.error||`${url} ${r.status}`);return d}

export async function mountAttendanceOverview(host,ctx){
  if(!host)throw new Error('출석부 한눈에 보기 영역을 찾지 못했습니다.');
  const {auth,db,user,classes=[]}=ctx||{};if(!auth||!db||!user)throw new Error('관리자 로그인 세션이 없습니다.');
  const root=host.shadowRoot||host.attachShadow({mode:'open'});
  root.innerHTML=`<style>${STYLE}</style><div class="wrap"><div id="err"></div><section class="card toolbar"><div class="field"><label>반</label><select id="classSel">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반 · ${esc(c.course||'')}</option>`).join('')}</select></div><div class="field"><label>교육일자</label><select id="dateSel"><option>불러오는 중…</option></select></div><button id="reload" class="btn soft">↻ 다시 읽기</button><div class="spacer"></div><span id="topState" class="state">준비 중…</span></section><div class="hint">원본 Google Sheet와 Google Drive는 읽기만 합니다. 관리자 메모만 Firebase에 저장됩니다.</div><section class="workspace"><article id="previewPanel" class="card preview-panel"><div class="panel-head"><div><h3>수기출석부 미리보기</h3><span id="fileCount" class="count">0개</span></div><div class="panel-actions"><select id="fileSel" class="file-select"></select><button id="openFile" class="btn ghost" disabled>새 창</button><button id="full" class="btn dark">크게 보기</button><span class="size-row">높이 <input id="height" type="range" min="480" max="950" step="10" value="700"></span></div></div><div id="viewer" class="viewer-wrap"><div class="viewer-empty">반과 날짜를 불러오는 중입니다.</div></div></article><article class="card data-panel"><div class="data-head"><div>Google Sheet · 이름 / 출석현황 / 가-3 사유</div><div>학생별 관리자 메모</div></div><div id="rows" class="rows"><div class="empty">불러오는 중…</div></div></article></section></div>`;
  const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),viewer=$('#viewer'),fileSel=$('#fileSel'),openFile=$('#openFile'),fileCount=$('#fileCount'),previewPanel=$('#previewPanel');
  let readerData=null,dates=[],students=[],reasonCells={},driveFiles=[],memos={},currentIso='',currentClass='1',saveTimers=new Map();
  const showErr=e=>{err.innerHTML=e?`<div class="error">${esc(e.message||e)}</div>`:''};
  async function getReader(cid){const idToken=await user.getIdToken();return post('/api/attendance-reader',{idToken,classId:String(cid)})}
  async function getDrive(cid,iso){const idToken=await user.getIdToken();return post('/api/admin-drive-review',{idToken,action:'list',classId:String(cid),date:iso,folderKey:'manualAttendance'})}
  function parseReader(out){
    readerData=out;const a=out.attendance||[],h=a[0]||[];dates=h.slice(4).map((x,i)=>({label:normDate(x),idx:i,iso:dateIso(x)})).filter(x=>x.label&&x.iso);students=a.slice(1).map((r,rowIndex)=>({rowIndex,name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);const g=out.reasons||[],rh=(g[0]||[]).slice(4),rr=(g[1]||[]).slice(4);reasonCells={};rh.forEach((d,i)=>reasonCells[normDate(d)]=rr[i]||'');
  }
  async function loadMemos(cid,iso){memos={};try{const s=await getDoc(doc(db,'settings',memoId(cid,iso)));if(s.exists())memos=s.data().memos||{}}catch(e){console.warn('memo load failed',e)}}
  function keyFor(s){return`${s.rowIndex}_${s.name}`}
  async function saveMemo(key,value,stateEl){memos={...memos,[key]:String(value||'')};if(!String(value||'').trim())delete memos[key];if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(currentClass,currentIso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:currentClass,date:currentIso,memos,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}
  function renderRows(label){const d=dates.find(x=>x.label===label);if(!d){rows.innerHTML='<div class="empty">해당 날짜를 찾지 못했습니다.</div>';return}const reasonText=reasonCells[label]||'',roster=students.map(x=>x.name);rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),key=keyFor(s),memo=memos[key]||'';return`<div class="student-row"><div class="sheet-side"><div class="name">${esc(s.name)}</div><div><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="reason ${reason?'':'none'}">${esc(reason||'-')}</div></div><div class="memo-side"><textarea class="memo" data-key="${esc(key)}" placeholder="관리자 메모">${esc(memo)}</textarea><span class="memo-state" data-state="${i}">${memo?'저장됨':''}</span></div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';root.querySelectorAll('.memo').forEach((ta,i)=>{ta.oninput=()=>{const key=ta.dataset.key,state=root.querySelector(`[data-state="${i}"]`);if(state)state.textContent='입력 중';clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveMemo(key,ta.value,state).catch(e=>showErr(e)),650))}})}
  function renderFile(index=0){const f=driveFiles[index];fileCount.textContent=`${driveFiles.length}개`;if(!f){viewer.innerHTML='<div class="viewer-empty">해당 날짜의 수기출석부 파일을 찾지 못했습니다.<br>날짜 폴더가 있다면 Drive에서 파일 업로드 여부를 확인해 주세요.</div>';openFile.disabled=true;return}openFile.disabled=false;openFile.dataset.url=f.fileUrl||'';const src=f.previewUrl||f.fileUrl||'';viewer.innerHTML=src?`<iframe src="${esc(src)}" allow="fullscreen" referrerpolicy="no-referrer"></iframe>`:'<div class="viewer-empty">미리보기 주소가 없습니다.</div>'}
  async function loadDrive(){driveFiles=[];fileSel.innerHTML='';viewer.innerHTML='<div class="viewer-empty">수기출석부를 Drive에서 불러오는 중…</div>';try{const d=await getDrive(currentClass,currentIso);driveFiles=Array.isArray(d.files)?d.files:[];fileSel.innerHTML=driveFiles.length?driveFiles.map((f,i)=>`<option value="${i}">${esc(f.name||`파일 ${i+1}`)}</option>`).join(''):'<option value="">파일 없음</option>';renderFile(0);if(!driveFiles.length&&d.embeddedFolderUrl){viewer.innerHTML=`<iframe src="${esc(d.embeddedFolderUrl)}" referrerpolicy="no-referrer"></iframe>`;openFile.disabled=!d.folderUrl;openFile.dataset.url=d.folderUrl||''}}catch(e){viewer.innerHTML=`<div class="viewer-empty">수기출석부를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`;fileCount.textContent='오류';openFile.disabled=true}}
  async function loadSelectedDate(){showErr('');const label=dateSel.value,d=dates.find(x=>x.label===label);if(!d)return;currentIso=d.iso;topState.textContent=`${currentClass}반 · ${label} 불러오는 중…`;await loadMemos(currentClass,currentIso);renderRows(label);loadDrive();topState.textContent=`${currentClass}반 · ${label} · ${students.length}명`}
  async function loadClass(cid,keepDate=''){showErr('');currentClass=String(cid);topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class="empty">Google Sheet를 읽는 중…</div>';try{const out=await getReader(currentClass);parseReader(out);dateSel.innerHTML=dates.map(d=>`<option value="${esc(d.label)}">${esc(d.label)}</option>`).join('');const preferred=dates.find(x=>x.label===keepDate)?.label||dates.at(-1)?.label||dates[0]?.label||'';dateSel.value=preferred;await loadSelectedDate()}catch(e){showErr(e);rows.innerHTML='<div class="empty">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}}
  classSel.onchange=()=>loadClass(classSel.value);
  dateSel.onchange=()=>loadSelectedDate();
  $('#reload').onclick=()=>loadClass(currentClass,dateSel.value);
  fileSel.onchange=()=>renderFile(Number(fileSel.value||0));
  openFile.onclick=()=>{const u=openFile.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};
  $('#height').oninput=e=>viewer.style.setProperty('height',`${e.target.value}px`);
  $('#full').onclick=e=>{previewPanel.classList.toggle('full');e.currentTarget.textContent=previewPanel.classList.contains('full')?'작게 보기':'크게 보기'};
  await loadClass(classSel.value||'1');
}
