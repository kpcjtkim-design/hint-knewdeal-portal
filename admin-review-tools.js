import {doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const isoFromLabel=label=>{const m=String(label||'').match(/(\d{1,2})\D+(\d{1,2})/);return m?`2026-${String(+m[1]).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`:''};
const reviewId=(cid,label)=>`attendanceReviewLive_${cid}_${String(label||'').replace(/[^0-9A-Za-z가-힣_-]+/g,'-')}`;
const manualId=(cid,iso)=>`manualAttendanceReview_${cid}_${String(iso||'').replace(/[^0-9A-Za-z가-힣_-]+/g,'-')}`;
const absenceListId=cid=>`attendanceAbsenceList_${cid}`;
const normalizeDocState=v=>String(v||'')==='미확인'?'미제출':(['확인','미제출','인정불가'].includes(String(v||''))?String(v):'미제출');

async function api(user,payload){
  const idToken=await user.getIdToken();
  const r=await fetch('/api/admin-drive-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken,...payload})});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}
  if(!r.ok||!d.ok)throw new Error(d?.error||'ADMIN_DRIVE_REVIEW_ERROR');
  return d;
}
async function loadAttendanceReview(db,cid,label){const r=await getDoc(doc(db,'settings',reviewId(cid,label)));return r.exists()?r.data():{}}
function overrideMap(review){const m=new Map();for(const x of (review?.overrides||[]))if(x?.name)m.set(String(x.name),x);return m}
function docMap(review){const out={};for(const [k,v] of Object.entries(review?.documentReview||{}))out[k]=normalizeDocState(v);for(const n of (review?.documentVerified||[]))if(!out[n])out[n]='확인';return out}
function docNotes(review){return {...(review?.documentReviewNotes||{})}}

export async function mountAdminReviewTools(host,ctx){
  if(!host||!ctx?.db||!ctx?.user)return;
  host.innerHTML=`<style>
  .art-wrap{margin-top:14px}.art-buttons{display:flex;gap:8px;flex-wrap:wrap}.art-btn{border:0;border-radius:11px;padding:10px 14px;font-weight:900;cursor:pointer}.art-btn:disabled{opacity:.45;cursor:not-allowed}.art-primary{background:#0f172a;color:#fff}.art-soft{background:#eef2ff;color:#3730a3}.art-danger{background:#fee2e2;color:#991b1b}.art-panel{display:none;margin-top:12px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:16px}.art-panel.show{display:block}.art-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.art-head h3{margin:0 0 5px}.art-note{font-size:12px;color:#64748b;line-height:1.55}.art-row{display:grid;grid-template-columns:80px 100px minmax(150px,1fr) 120px minmax(180px,1fr) auto auto;gap:8px;align-items:center;padding:10px;border-bottom:1px solid #e2e8f0}.art-row:last-child{border-bottom:0}.art-row select,.art-row textarea,.art-tools select,.art-tools input,.art-absence-form input,.art-absence-form select,.art-absence-form textarea,.art-file-select{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:8px;background:#fff}.art-row textarea{min-height:38px}.art-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:900}.art-ok{background:#dcfce7;color:#166534}.art-warn{background:#fef3c7;color:#92400e}.art-bad{background:#fee2e2;color:#991b1b}.art-summary{margin-top:10px;padding:11px;border-radius:11px;background:#f8fafc;white-space:pre-wrap;font-size:12px;color:#475569;max-height:260px;overflow:auto}.art-tools{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:12px 0}.art-field{display:flex;flex-direction:column;gap:5px;min-width:180px}.art-field label{font-size:11px;font-weight:900;color:#475569}.art-preview{margin-top:12px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#f8fafc}.art-preview-head{padding:10px 12px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #e2e8f0}.art-preview-body{background:#fff;min-height:520px}.art-preview iframe{width:100%;height:620px;border:0;background:#fff}.art-preview img{display:block;max-width:100%;max-height:720px;margin:0 auto;object-fit:contain;background:#fff}.art-file-picker{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#fff}.art-file-picker label{font-size:11px;font-weight:900;color:#475569}.art-file-picker select{min-width:280px;max-width:100%}.art-empty{padding:24px;text-align:center;color:#64748b}.art-manual-save{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:12px}.art-manual-save textarea{min-width:280px;min-height:60px;border:1px solid #cbd5e1;border-radius:9px;padding:9px}.art-divider{height:1px;background:#e2e8f0;margin:18px 0}.art-absence{margin-top:16px;padding:14px;border:1px solid #dbe3ee;border-radius:14px;background:#f8fafc}.art-absence h4{margin:0 0 5px;font-size:14px}.art-absence-form{display:grid;grid-template-columns:minmax(170px,1fr) 150px minmax(220px,1.4fr) auto;gap:9px;align-items:end;margin-top:12px}.art-absence-list{display:grid;gap:7px;margin-top:12px}.art-absence-item{display:grid;grid-template-columns:100px 110px minmax(150px,1fr) minmax(180px,1.2fr) auto auto;gap:8px;align-items:center;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;font-size:12px}.art-absence-item b{font-size:13px}.art-muted{color:#64748b}.art-modal-back{position:fixed;inset:0;background:rgba(15,23,42,.55);display:grid;place-items:center;padding:22px;z-index:9999}.art-modal{width:min(1200px,96vw);max-height:92vh;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.28)}.art-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid #e2e8f0}.art-modal iframe{width:100%;height:82vh;border:0;background:#fff}.art-modal img{display:block;max-width:100%;max-height:82vh;margin:auto;object-fit:contain}@media(max-width:980px){.art-row{grid-template-columns:1fr 1fr}.art-preview iframe{height:480px}.art-absence-form,.art-absence-item{grid-template-columns:1fr 1fr}}
  </style>
  <div class="art-wrap"><div class="art-buttons"><button id="artRecognitionBtn" class="art-btn art-primary">출결인증자료 검수</button><button id="artManualBtn" class="art-btn art-soft">수기출석 검수</button></div><section id="artRecognitionPanel" class="art-panel"></section><section id="artManualPanel" class="art-panel"></section></div>`;
  const rp=host.querySelector('#artRecognitionPanel'),mp=host.querySelector('#artManualPanel');
  host.querySelector('#artRecognitionBtn').onclick=async()=>{rp.classList.toggle('show');mp.classList.remove('show');if(rp.classList.contains('show'))await renderRecognition(rp,ctx)};
  host.querySelector('#artManualBtn').onclick=async()=>{mp.classList.toggle('show');rp.classList.remove('show');if(mp.classList.contains('show'))await renderManual(mp,ctx)};
}

async function collectRecognized(ctx){
  const {db,getState,parseReasonFor,standardizeReason,normalizeAttendanceStatus}=ctx,s=getState(),out=[];
  for(const d of s.dates){
    const review=await loadAttendanceReview(db,s.selectedClass,d.label),ov=overrideMap(review),dm=docMap(review),notes=docNotes(review),reasonText=s.reasonCells[d.label]||'';
    for(const st of s.students){
      const baseStatus=normalizeAttendanceStatus(String(st.all[d.idx]||'').trim()||'미입력'),parsed=parseReasonFor(st.name,reasonText,baseStatus),o=ov.get(st.name),status=o?.status??baseStatus;
      if(status!=='인정출석')continue;
      out.push({label:d.label,iso:isoFromLabel(d.label),name:st.name,reason:standardizeReason(o?.reason??parsed.reason??''),state:normalizeDocState(dm[st.name]),note:String(notes[st.name]||'')});
    }
  }
  return out;
}
function normalizeFiles(d){
  return (Array.isArray(d?.files)?d.files:[]).map((f,i)=>{
    const id=String(f.fileId||f.id||'');
    const mime=String(f.mimeType||'');
    const name=String(f.name||`파일 ${i+1}`);
    const fileUrl=String(f.fileUrl||f.url||(id?`https://drive.google.com/file/d/${id}/view`:''));
    const previewUrl=String(f.previewUrl||(id?`https://drive.google.com/file/d/${id}/preview`:''));
    const imageUrl=String(f.imageUrl||(id?`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`:''));
    return{id,name,mimeType:mime,fileUrl,previewUrl,imageUrl,createdAt:String(f.createdAt||'')};
  }).filter(f=>f.id||f.previewUrl||f.fileUrl);
}
function isImage(f){return /^image\//i.test(f.mimeType)||/\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name)}
function previewNodeHtml(f){
  if(!f)return'<div class="art-empty">선택한 파일이 없습니다.</div>';
  if(isImage(f))return`<img src="${esc(f.imageUrl||f.fileUrl)}" alt="${esc(f.name)}" loading="lazy">`;
  return`<iframe src="${esc(f.previewUrl||f.fileUrl)}" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}
function directFilesPreviewHtml(d,title){
  const files=normalizeFiles(d);
  if(!files.length){
    const fallback=d.embeddedFolderUrl?`<iframe src="${esc(d.embeddedFolderUrl)}" loading="lazy"></iframe>`:'<div class="art-empty">파일 목록을 아직 받을 수 없습니다.</div>';
    return `<div class="art-preview-head"><div><b>${esc(title)}</b><div class="art-note">현재 Drive 모니터가 파일 ID를 반환하지 않아 폴더 보기로 표시합니다.</div></div>${d.folderUrl?`<a href="${esc(d.folderUrl)}" target="_blank" rel="noopener noreferrer">원본 폴더 열기 ↗</a>`:''}</div>${fallback}`;
  }
  const first=files[0];
  const picker=files.length>1?`<div class="art-file-picker"><label>미리볼 파일</label><select class="art-file-select">${files.map((f,i)=>`<option value="${i}">${i+1}. ${esc(f.name)}</option>`).join('')}</select><span class="art-note">파일 ${files.length}개</span></div>`:'';
  return `<div class="art-preview-head"><div><b>${esc(title)}</b><div class="art-note">PDF/JPG 원본 파일 직접 미리보기 · Drive 읽기전용</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="art-current-file-link" href="${esc(first.fileUrl||'#')}" target="_blank" rel="noopener noreferrer">현재 파일 새 창 ↗</a><button type="button" class="art-btn art-soft art-open-file-large">크게 보기</button></div></div>${picker}<div class="art-preview-body">${previewNodeHtml(first)}</div>`;
}
function bindDirectPreview(container,d,title){
  const files=normalizeFiles(d);if(!files.length)return;
  let idx=0;const body=container.querySelector('.art-preview-body'),sel=container.querySelector('.art-file-select'),link=container.querySelector('.art-current-file-link'),large=container.querySelector('.art-open-file-large');
  const paint=()=>{const f=files[idx];if(body)body.innerHTML=previewNodeHtml(f);if(link)link.href=f.fileUrl||f.previewUrl||'#';if(large)large.onclick=()=>openLargeFile(f,title)};
  if(sel)sel.onchange=()=>{idx=Math.max(0,Math.min(files.length-1,+sel.value||0));paint()};
  paint();
}
function openLargeFile(f,title){
  if(!f)return;const back=document.createElement('div');back.className='art-modal-back';back.innerHTML=`<div class="art-modal"><div class="art-modal-head"><div><b>${esc(title||'파일 미리보기')}</b><div class="art-note">${esc(f.name)}</div></div><button type="button" class="art-btn art-soft art-modal-close">닫기</button></div><div class="art-preview-body">${previewNodeHtml(f)}</div></div>`;document.body.appendChild(back);back.querySelector('.art-modal-close').onclick=()=>back.remove();back.onclick=e=>{if(e.target===back)back.remove()};
}

async function renderRecognition(panel,ctx){
  const s=ctx.getState();panel.innerHTML='<div class="art-empty">인정출석 내역을 불러오는 중…</div>';
  try{
    const rows=await collectRecognized(ctx);
    panel.innerHTML=`<div class="art-head"><div><h3>${esc(s.selectedClass)}반 · 출결인증자료 검수</h3><div class="art-note">인정출석 사유를 확인하고 서류 판정과 메모를 Firebase에 저장합니다. Drive 원본은 읽기만 합니다.</div></div><button id="artRecognitionCopy" class="art-btn art-soft">미제출·인정불가 모아보기</button></div><div id="artRecognitionSummary" class="art-summary"></div><div id="artRecognitionRows">${rows.length?rows.map((x,i)=>`<div class="art-row" data-ri="${i}"><b>${esc(x.label)}</b><b>${esc(x.name)}</b><div>${esc(x.reason||'사유 미기재')}</div><select class="art-doc-state"><option value="미제출" ${x.state==='미제출'?'selected':''}>미제출</option><option value="확인" ${x.state==='확인'?'selected':''}>확인</option><option value="인정불가" ${x.state==='인정불가'?'selected':''}>인정불가</option></select><textarea class="art-doc-note" placeholder="인정불가 사유 메모">${esc(x.note)}</textarea><button type="button" class="art-btn art-soft art-doc-preview">서류 보기</button><button type="button" class="art-btn art-primary art-doc-save">저장</button></div>`).join(''):'<div class="art-empty">인정출석 내역이 없습니다.</div>'}</div><div id="artRecognitionPreview" class="art-preview" style="display:none"></div>
    <div class="art-divider"></div>
    <section class="art-absence"><div class="art-head"><div><h4>결석처리 명단</h4><div class="art-note">인정출석 중 서류미비 등으로 최종 결석 처리한 건을 별도로 기록합니다.</div></div><button id="artAbsenceCopy" class="art-btn art-soft">명단 복사</button></div><div class="art-absence-form"><div class="art-field"><label>학생 이름 검색</label><input id="artAbsenceName" list="artAbsenceNames" placeholder="이름 입력"><datalist id="artAbsenceNames">${[...new Set(rows.map(x=>x.name))].sort((a,b)=>a.localeCompare(b,'ko')).map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist></div><div class="art-field"><label>인정출석 날짜</label><select id="artAbsenceDate" disabled><option value="">학생 먼저 선택</option></select></div><div class="art-field"><label>결석처리 사유</label><textarea id="artAbsenceReason" placeholder="예: 필수 증빙서류 미제출"></textarea></div><button id="artAbsenceSave" type="button" class="art-btn art-danger">결석처리 저장</button></div><div id="artAbsenceHint" class="art-note" style="margin-top:8px"></div><div id="artAbsenceList" class="art-absence-list"></div></section>`;

    const paintSummary=()=>{const bad=rows.filter(x=>x.state==='미제출'||x.state==='인정불가'),txt=bad.map(x=>`${s.selectedClass}반 · ${x.label} · ${x.name} · ${x.reason||'사유 미기재'} · ${x.state}${x.note?' · '+x.note:''}`).join('\n');panel.querySelector('#artRecognitionSummary').textContent=`전체 ${rows.length}건 · 확인 ${rows.filter(x=>x.state==='확인').length} · 미제출 ${rows.filter(x=>x.state==='미제출').length} · 인정불가 ${rows.filter(x=>x.state==='인정불가').length}${txt?'\n\n'+txt:''}`};
    const save=async(i)=>{const x=rows[i],row=panel.querySelector(`[data-ri="${i}"]`),btn=row.querySelector('.art-doc-save'),state=row.querySelector('.art-doc-state').value,note=row.querySelector('.art-doc-note').value.trim();btn.disabled=true;btn.textContent='저장 중…';try{const r=await loadAttendanceReview(ctx.db,s.selectedClass,x.label),dm=docMap(r),notes=docNotes(r);dm[x.name]=state;if(note)notes[x.name]=note;else delete notes[x.name];const verified=Object.entries(dm).filter(([,v])=>v==='확인').map(([k])=>k);await setDoc(doc(ctx.db,'settings',reviewId(s.selectedClass,x.label)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:s.selectedClass,date:x.label,documentReview:dm,documentReviewNotes:notes,documentVerified:verified,documentVerifier:ctx.user.email||'',documentVerifiedAt:serverTimestamp()},{merge:true});x.state=state;x.note=note;paintSummary();btn.textContent='저장됨';setTimeout(()=>{if(document.body.contains(btn))btn.textContent='저장'},900)}finally{btn.disabled=false}};
    panel.querySelectorAll('.art-row').forEach((row,i)=>{
      row.querySelector('.art-doc-save').onclick=()=>save(i).catch(e=>alert(e.message||e));
      row.querySelector('.art-doc-preview').onclick=async()=>{
        const box=panel.querySelector('#artRecognitionPreview'),x=rows[i];box.style.display='block';box.innerHTML='<div class="art-empty">Drive 제출서류 확인 중…</div>';
        try{const d=await api(ctx.user,{action:'list',classId:s.selectedClass,date:x.iso,folderKey:'recognition'});box.innerHTML=directFilesPreviewHtml(d,`${x.label} · ${x.name} · 출결인증자료`);bindDirectPreview(box,d,`${x.label} · ${x.name}`);box.scrollIntoView({behavior:'smooth',block:'nearest'})}catch(e){box.innerHTML=`<div class="art-empty">파일을 불러오지 못했습니다. · ${esc(e.message||e)}</div>`}
      };
    });
    paintSummary();
    panel.querySelector('#artRecognitionCopy').onclick=async()=>{const bad=rows.filter(x=>x.state==='미제출'||x.state==='인정불가'),txt=bad.map(x=>`${s.selectedClass}반\t${x.label}\t${x.name}\t${x.reason||'사유 미기재'}\t${x.state}\t${x.note||''}`).join('\n');try{await navigator.clipboard.writeText(txt);panel.querySelector('#artRecognitionCopy').textContent='복사 완료'}catch{panel.querySelector('#artRecognitionSummary').textContent=txt||'해당 내역이 없습니다.'}};

    await bindAbsenceList(panel,ctx,rows);
  }catch(e){panel.innerHTML=`<div class="art-empty">출결인증자료 검수를 불러오지 못했습니다. · ${esc(e.message||e)}</div>`}
}
async function bindAbsenceList(panel,ctx,rows){
  const s=ctx.getState(),nameEl=panel.querySelector('#artAbsenceName'),dateEl=panel.querySelector('#artAbsenceDate'),reasonEl=panel.querySelector('#artAbsenceReason'),hint=panel.querySelector('#artAbsenceHint'),list=panel.querySelector('#artAbsenceList'),saveBtn=panel.querySelector('#artAbsenceSave');
  const snap=await getDoc(doc(ctx.db,'settings',absenceListId(s.selectedClass)));let items=Array.isArray(snap.exists()?snap.data().items:[])?snap.data().items:[];
  const render=()=>{list.innerHTML=items.length?items.slice().sort((a,b)=>String(b.iso).localeCompare(String(a.iso))).map((x,i)=>`<div class="art-absence-item" data-ai="${i}"><b>${esc(x.name)}</b><span>${esc(x.label||x.iso)}</span><span>${esc(x.originalReason||'인정출석 사유 미기재')}</span><span>${esc(x.reason||'결석처리 사유 미기재')}</span><button class="art-btn art-soft art-absence-edit" type="button">수정</button><button class="art-btn art-danger art-absence-del" type="button">삭제</button></div>`).join(''):'<div class="art-empty">저장된 결석처리 명단이 없습니다.</div>';list.querySelectorAll('.art-absence-del').forEach((b,i)=>b.onclick=async()=>{items.splice(i,1);await persist();render()});list.querySelectorAll('.art-absence-edit').forEach((b,i)=>b.onclick=()=>{const x=items[i];nameEl.value=x.name;fillDates();dateEl.value=x.iso;reasonEl.value=x.reason||'';hint.textContent=`수정 중 · 기존 인정출석 사유: ${x.originalReason||'사유 미기재'}`})};
  const persist=()=>setDoc(doc(ctx.db,'settings',absenceListId(s.selectedClass)),{type:'ATTENDANCE_ABSENCE_LIST',classId:s.selectedClass,items,reviewer:ctx.user.email||'',updatedAt:serverTimestamp()},{merge:false});
  const fillDates=()=>{const name=nameEl.value.trim(),matches=rows.filter(x=>x.name===name);dateEl.disabled=!matches.length;dateEl.innerHTML=matches.length?matches.map(x=>`<option value="${esc(x.iso)}">${esc(x.label)} · ${esc(x.reason||'사유 미기재')}</option>`).join(''):'<option value="">해당 학생의 인정출석 내역 없음</option>';hint.textContent=matches.length?`인정출석 ${matches.length}건 중 날짜를 선택하세요.`:'이름을 정확히 입력하세요.'};
  nameEl.oninput=fillDates;
  saveBtn.onclick=async()=>{const name=nameEl.value.trim(),iso=dateEl.value,reason=reasonEl.value.trim(),src=rows.find(x=>x.name===name&&x.iso===iso);if(!src)return alert('학생과 인정출석 날짜를 선택해 주세요.');if(!reason)return alert('결석처리 사유를 입력해 주세요.');const item={name,iso,label:src.label,originalReason:src.reason||'',reason,updatedBy:ctx.user.email||'',updatedAt:new Date().toISOString()};const idx=items.findIndex(x=>x.name===name&&x.iso===iso);if(idx>=0)items[idx]=item;else items.push(item);await persist();reasonEl.value='';render();hint.textContent='결석처리 명단에 저장했습니다.'};
  panel.querySelector('#artAbsenceCopy').onclick=async()=>{const txt=items.map(x=>`${s.selectedClass}반\t${x.label||x.iso}\t${x.name}\t${x.originalReason||''}\t${x.reason||''}`).join('\n');try{await navigator.clipboard.writeText(txt);panel.querySelector('#artAbsenceCopy').textContent='복사 완료'}catch{hint.textContent=txt||'저장된 명단이 없습니다.'}};
  render();
}

async function renderManual(panel,ctx){
  const s=ctx.getState(),dateOpts=s.dates.map(d=>`<option value="${esc(isoFromLabel(d.label))}" ${isoFromLabel(d.label)===isoFromLabel(s.currentLabel)?'selected':''}>${esc(d.label)}</option>`).join('');
  panel.innerHTML=`<div class="art-head"><div><h3>${esc(s.selectedClass)}반 · 수기출석 검수</h3><div class="art-note">PDF/JPG 파일 자체를 화면에서 바로 확인합니다. 파일이 여러 개면 선택해 볼 수 있습니다. Drive 원본은 읽기만 합니다.</div></div></div><div class="art-tools"><div class="art-field"><label>검수 일자</label><select id="artManualDate">${dateOpts}</select></div><button id="artManualLoad" class="art-btn art-soft">파일 불러오기</button><button id="artManualNeeds" class="art-btn art-soft">보완필요 모아보기</button></div><div id="artManualBody"><div class="art-empty">날짜를 선택해 주세요.</div></div><div id="artManualSummary" class="art-summary">저장된 보완필요 내역을 모아볼 수 있습니다.</div>`;
  const load=async()=>{
    const iso=panel.querySelector('#artManualDate').value,body=panel.querySelector('#artManualBody');body.innerHTML='<div class="art-empty">Drive 파일 확인 중…</div>';
    try{
      const d=await api(ctx.user,{action:'list',classId:s.selectedClass,date:iso,folderKey:'manualAttendance'}),saved=await getDoc(doc(ctx.db,'settings',manualId(s.selectedClass,iso))),rv=saved.exists()?saved.data():{},files=normalizeFiles(d),auto=Number(d.fileCount||files.length)>0?'':'미제출';
      body.innerHTML=`<div class="art-preview">${directFilesPreviewHtml(d,`${iso} · 수기출석`)}</div><div class="art-manual-save"><div class="art-field"><label>검수 결과</label><select id="artManualState" ${auto?'disabled':''}><option value="확인" ${(rv.status||'')==='확인'?'selected':''}>확인</option><option value="보완필요" ${(rv.status||'')==='보완필요'?'selected':''}>보완필요</option></select></div><textarea id="artManualNote" placeholder="보완필요 사유">${esc(rv.note||'')}</textarea><button id="artManualSave" class="art-btn art-primary">검수 저장</button><span class="art-pill ${auto?'art-bad':rv.status==='보완필요'?'art-warn':'art-ok'}">${esc(auto||rv.status||'미검수')}</span></div>`;
      bindDirectPreview(body,d,`${iso} · 수기출석`);
      body.querySelector('#artManualSave').onclick=async()=>{const status=auto||body.querySelector('#artManualState').value,note=body.querySelector('#artManualNote').value.trim(),btn=body.querySelector('#artManualSave');btn.disabled=true;btn.textContent='저장 중…';try{await setDoc(doc(ctx.db,'settings',manualId(s.selectedClass,iso)),{type:'MANUAL_ATTENDANCE_REVIEW',classId:s.selectedClass,date:iso,status,note,reviewer:ctx.user.email||'',updatedAt:serverTimestamp(),source:'DRIVE_READ_ONLY',fileCount:Number(d.fileCount||files.length),dateFolderId:d.dateFolderId||'',selectedFiles:files.map(f=>({fileId:f.id,name:f.name,mimeType:f.mimeType}))},{merge:false});body.querySelector('.art-pill').textContent=status;btn.textContent='저장됨';setTimeout(()=>{if(document.body.contains(btn))btn.textContent='검수 저장'},900)}finally{btn.disabled=false}};
    }catch(e){body.innerHTML=`<div class="art-empty">파일을 불러오지 못했습니다. · ${esc(e.message||e)}</div>`}
  };
  panel.querySelector('#artManualLoad').onclick=()=>load();panel.querySelector('#artManualDate').onchange=()=>load();await load();
  panel.querySelector('#artManualNeeds').onclick=async()=>{const bad=[];for(const d of s.dates){const iso=isoFromLabel(d.label),r=await getDoc(doc(ctx.db,'settings',manualId(s.selectedClass,iso)));if(r.exists()&&r.data().status==='보완필요')bad.push({date:d.label,...r.data()})}const txt=bad.map(x=>`${s.selectedClass}반 · ${x.date} · 보완필요 · ${x.note||'사유 미기재'}`).join('\n');panel.querySelector('#artManualSummary').textContent=txt||'저장된 보완필요 내역이 없습니다.'};
}
