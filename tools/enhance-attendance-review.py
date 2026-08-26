from pathlib import Path
p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

css='.folder-links{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.folder-link{display:inline-flex;align-items:center;gap:6px;padding:9px 11px;border-radius:10px;background:#ecfeff;color:#155e75;text-decoration:none;font-size:12px;font-weight:900;border:1px solid #a5f3fc}.folder-link.fallback{background:#f8fafc;color:#475569;border-color:#cbd5e1}.folder-note{font-size:10px;font-weight:700;opacity:.78}.doc-verify{margin-top:8px;padding:8px 10px;border-radius:10px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:12px;font-weight:900;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.doc-verify.hidden{display:none}.doc-verify input{width:16px;height:16px}.doc-save-state{font-size:10px;color:#64748b}.embedded{background:#f4f7fb}.embedded .wrap{width:100%;margin:0 auto 20px;padding:0 2px}.embedded .top{display:none}.embedded .hero{border-radius:0}.embedded .card{box-shadow:none}'
if '.doc-verify{' not in s:
    s=s.replace('</style>',css+'</style>',1)

old_toolbar='<div class="card toolbar"><div class="field"><label>반 선택</label><select id="classSelect"></select></div><div class="field"><label>날짜 선택</label><select id="dateSelect"></select></div><button id="reloadBtn" class="btn soft">↻ 다시 읽기</button><div class="summary"><span id="sumPresent" class="pill ok">출석 0</span><span id="sumAbsent" class="pill bad">결석 0</span><span id="sumEtc" class="pill warn">기타 0</span></div></div>'
new_toolbar='<div class="card toolbar"><div class="field"><label>반 선택</label><select id="classSelect"></select></div><div class="field"><label>날짜 선택</label><select id="dateSelect"></select></div><button id="reloadBtn" class="btn soft">↻ 다시 읽기</button><div id="folderLinks" class="folder-links"><span class="folder-note">반·날짜를 선택하면 관련 폴더 바로가기가 표시됩니다.</span></div><div class="summary"><span id="sumPresent" class="pill ok">출석 0</span><span id="sumAbsent" class="pill bad">결석 0</span><span id="sumEtc" class="pill warn">기타 0</span></div></div>'
if old_toolbar in s:
    s=s.replace(old_toolbar,new_toolbar,1)
elif 'id="folderLinks"' not in s:
    raise SystemExit('attendance toolbar anchor not found')

if "const EMBED_MODE=" not in s:
    s=s.replace("const READER_API='/api/attendance-reader';", "const READER_API='/api/attendance-reader';\nconst EMBED_MODE=new URLSearchParams(location.search).get('embed')==='1';",1)
    anchor="const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));"
    if anchor in s:
        s=s.replace(anchor,anchor+"\nif(EMBED_MODE)document.body.classList.add('embedded');",1)
    else:
        raise SystemExit('embed anchor not found')

helpers=r'''function driveFolderId(url){const v=String(url||'');const m=v.match(/\/folders\/([A-Za-z0-9_-]+)/);if(m)return m[1];try{return new URL(v).searchParams.get('id')||''}catch{return''}}
function dateLabelToIso(label){const m=String(label||'').match(/(\d{1,2})\D+(\d{1,2})/);if(!m)return'';return `2026-${String(+m[1]).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`}
function monitorFolderUrl(root,data){if(!root)return{url:'',exact:false};const df=data?.dateFolder;const url=data?.dateFolderUrl||(df&&typeof df==='object'&&(df.url||df.webViewLink))||(typeof df==='string'&&/^https?:\/\//.test(df)?df:'');const id=data?.dateFolderId||(df&&typeof df==='object'&&(df.id||df.folderId))||(typeof df==='string'&&/^[A-Za-z0-9_-]{10,}$/.test(df)?df:'');if(url)return{url:String(url),exact:true};if(id)return{url:`https://drive.google.com/drive/folders/${id}`,exact:true};return{url:root,exact:false}}
async function resolveDateFolder(root,label){const id=driveFolderId(root),date=dateLabelToIso(label);if(!root)return{url:'',exact:false};if(!id||!date)return{url:root,exact:false};try{const r=await fetch(`/api/drive-monitor?folderId=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`,{cache:'no-store'});const d=await r.json();return monitorFolderUrl(root,d)}catch{return{url:root,exact:false}}}
async function refreshFolderLinks(){const host=$('#folderLinks');if(!host||!selectedClass||!currentLabel)return;host.innerHTML='<span class="folder-note">폴더 확인 중…</span>';try{const cr=await getDoc(doc(db,'classes',selectedClass)),core=cr.exists()?(cr.data().coreLinks||{}):{},manual=await resolveDateFolder(core.manualAttendance||'',currentLabel),recognition=await resolveDateFolder(core.recognition||'',currentLabel);const item=(x,label)=>x.url?`<a class="folder-link ${x.exact?'':'fallback'}" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${x.exact?'':' · 상위폴더'}<span class="folder-note">↗</span></a>`:'';host.innerHTML=item(manual,'수기출석')+item(recognition,'출결인정자료')||'<span class="folder-note">등록된 관련 폴더가 없습니다.</span>'}catch(e){host.innerHTML='<span class="folder-note">폴더 바로가기를 불러오지 못했습니다.</span>'}}
function verifiedSet(review){return new Set((review?.documentVerified||[]).map(String))}
async function saveDocumentVerification(i,checked,el){const x=editRows[i];if(!x||!currentLabel)return;const next=verifiedSet(currentReview);if(checked)next.add(x.name);else next.delete(x.name);const state=document.querySelector(`[data-doc-state="${i}"]`);if(el)el.disabled=true;if(state)state.textContent='저장 중…';try{const list=[...next].sort((a,b)=>a.localeCompare(b,'ko'));await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:selectedClass,date:currentLabel,documentVerified:list,documentVerifier:email,documentVerifiedAt:serverTimestamp()},{merge:true});currentReview={...(currentReview||{}),documentVerified:list};if(state)state.textContent=checked?'서류 확인 저장됨':'확인 해제 저장됨';setDirty(dirty)}catch(e){if(el)el.checked=!checked;if(state)state.textContent='저장 실패';throw e}finally{if(el)el.disabled=false}}
'''
if 'async function refreshFolderLinks()' not in s:
    anchor='function reviewDocId(label)'
    if anchor not in s: raise SystemExit('review helper insertion anchor not found')
    s=s.replace(anchor,helpers+'\n'+anchor,1)

s=s.replace("function setDirty(v=true){dirty=v;const b=$('#saveReviewBtn'),r=$('#resetReviewBtn');if(b)b.disabled=!dirty;if(r)r.disabled=!currentReview?.overrides?.length;", "function setDirty(v=true){dirty=v;const b=$('#saveReviewBtn'),r=$('#resetReviewBtn');if(b)b.disabled=!dirty;if(r)r.disabled=!(currentReview?.overrides?.length||currentReview?.documentVerified?.length);")

old_bind="function bindEditors(){document.querySelectorAll('.edit-status').forEach(el=>el.onchange=()=>{const x=editRows[+el.dataset.i];x.status=el.value;if(x.status==='출석'&&x.reason===x.baseReason)x.reason='';setDirty();recalcSummary()});document.querySelectorAll('.edit-reason').forEach(el=>el.oninput=()=>{editRows[+el.dataset.i].reason=el.value;setDirty()});document.querySelectorAll('[data-history-i]').forEach(el=>el.onclick=()=>openStudentHistory(+el.dataset.historyI))}"
new_bind="function bindEditors(){document.querySelectorAll('.edit-status').forEach(el=>el.onchange=()=>{const x=editRows[+el.dataset.i];x.status=el.value;if(x.status==='출석'&&x.reason===x.baseReason)x.reason='';const w=document.querySelector(`[data-doc-wrap=\"${el.dataset.i}\"]`);if(w)w.classList.toggle('hidden',x.status!=='인정출석');setDirty();recalcSummary()});document.querySelectorAll('.edit-reason').forEach(el=>el.oninput=()=>{editRows[+el.dataset.i].reason=el.value;setDirty()});document.querySelectorAll('.doc-verify-check').forEach(el=>el.onchange=()=>saveDocumentVerification(+el.dataset.i,el.checked,el).catch(showError));document.querySelectorAll('[data-history-i]').forEach(el=>el.onclick=()=>openStudentHistory(+el.dataset.historyI))}"
if old_bind in s:
    s=s.replace(old_bind,new_bind,1)
elif '.doc-verify-check' not in s:
    raise SystemExit('bindEditors anchor not found')

s=s.replace("const reasonText=reasonCells[label]||'',audit=reasonAudit(reasonText);currentReview=await loadReview(label);const saved=reviewMap(currentReview);editRows=[];const validationRows=[];", "const reasonText=reasonCells[label]||'',audit=reasonAudit(reasonText);currentReview=await loadReview(label);const saved=reviewMap(currentReview),verified=verifiedSet(currentReview);editRows=[];const validationRows=[];")

old_flag="const flagHtml=flags.length?`<div class=\"row-flags\">${flags.map(f=>`<span class=\"flag ${f.c}\">${esc(f.t)}</span>`).join('')}</div>`:'';"
new_flag=old_flag+"\n    const docHtml=`<div class=\"doc-verify ${status==='인정출석'?'':'hidden'}\" data-doc-wrap=\"${i}\"><label><input type=\"checkbox\" class=\"doc-verify-check\" data-i=\"${i}\" ${verified.has(s.name)?'checked':''}> 인정출석 증빙서류 확인</label><span class=\"doc-save-state\" data-doc-state=\"${i}\">${verified.has(s.name)?'확인 저장됨':'체크 시 자동저장'}</span></div>`;"
if old_flag in s and 'const docHtml=' not in s:
    s=s.replace(old_flag,new_flag,1)

old_row="${flagHtml}</div></div>`"
new_row="${docHtml}${flagHtml}</div></div>`"
if old_row in s:
    s=s.replace(old_row,new_row,1)
elif '${docHtml}${flagHtml}' not in s:
    raise SystemExit('document verification row anchor not found')

old_save="async function saveReview(){if(!currentLabel)return;const overrides=editRows.filter(x=>x.status!==x.baseStatus||String(x.reason||'')!==String(x.baseReason||'')).map(x=>({name:x.name,status:x.status,reason:String(x.reason||'').trim()}));$('#saveReviewBtn').disabled=true;$('#saveReviewBtn').textContent='Firebase 저장 중...';try{await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:selectedClass,date:currentLabel,overrides,reviewer:email,updatedAt:serverTimestamp()},{merge:false});currentReview={overrides,reviewer:email};dirty=false;setDirty(false);$('#saveMeta').textContent=`Firebase 저장 완료 · 수정 ${overrides.length}명 · ${email}`;await logView(currentLabel)}catch(e){showError(e)}finally{$('#saveReviewBtn').textContent='Firebase에 검수 저장';$('#saveReviewBtn').disabled=!dirty}}"
new_save="async function saveReview(){if(!currentLabel)return;const overrides=editRows.filter(x=>x.status!==x.baseStatus||String(x.reason||'')!==String(x.baseReason||'')).map(x=>({name:x.name,status:x.status,reason:String(x.reason||'').trim()})),documentVerified=currentReview?.documentVerified||[];$('#saveReviewBtn').disabled=true;$('#saveReviewBtn').textContent='Firebase 저장 중...';try{await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:selectedClass,date:currentLabel,overrides,documentVerified,reviewer:email,updatedAt:serverTimestamp()},{merge:false});currentReview={overrides,documentVerified,reviewer:email};dirty=false;setDirty(false);$('#saveMeta').textContent=`Firebase 저장 완료 · 수정 ${overrides.length}명 · 서류확인 ${documentVerified.length}명 · ${email}`;await logView(currentLabel)}catch(e){showError(e)}finally{$('#saveReviewBtn').textContent='Firebase에 검수 저장';$('#saveReviewBtn').disabled=!dirty}}"
if old_save in s:
    s=s.replace(old_save,new_save,1)
elif 'documentVerified,reviewer:email' not in s:
    raise SystemExit('saveReview anchor not found')

old_reset="async function resetReview(){if(!currentLabel||!confirm('이 날짜의 Firebase 관리자 수정값을 모두 비우고 시트 기준으로 되돌릴까요?'))return;await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:selectedClass,date:currentLabel,overrides:[],reviewer:email,updatedAt:serverTimestamp()},{merge:false});currentReview={overrides:[],reviewer:email};await renderDate(currentLabel)}"
new_reset="async function resetReview(){if(!currentLabel||!confirm('이 날짜의 Firebase 관리자 수정값과 인정출석 서류 확인 상태를 모두 비울까요?'))return;await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:selectedClass,date:currentLabel,overrides:[],documentVerified:[],reviewer:email,updatedAt:serverTimestamp()},{merge:false});currentReview={overrides:[],documentVerified:[],reviewer:email};await renderDate(currentLabel);await refreshFolderLinks()}"
if old_reset in s:
    s=s.replace(old_reset,new_reset,1)

old_load="$('#dateSelect').value=preferred;await renderDate(preferred);await logView(preferred)}"
new_load="$('#dateSelect').value=preferred;await renderDate(preferred);await refreshFolderLinks();await logView(preferred)}"
if old_load in s:
    s=s.replace(old_load,new_load,1)
elif 'await refreshFolderLinks();await logView(preferred)' not in s:
    raise SystemExit('loadClass folder link anchor not found')

old_change="$('#dateSelect').onchange=async e=>{if(dirty&&!confirm('저장하지 않은 Firebase 수정이 있습니다. 날짜를 바꿀까요?')){e.target.value=currentLabel;return}await renderDate(e.target.value);await logView(e.target.value)};"
new_change="$('#dateSelect').onchange=async e=>{if(dirty&&!confirm('저장하지 않은 Firebase 수정이 있습니다. 날짜를 바꿀까요?')){e.target.value=currentLabel;return}await renderDate(e.target.value);await refreshFolderLinks();await logView(e.target.value)};"
if old_change in s:
    s=s.replace(old_change,new_change,1)

resize="if(EMBED_MODE){const sendHeight=()=>{try{parent.postMessage({type:'attendance-test-height',height:document.documentElement.scrollHeight},location.origin)}catch{}};if('ResizeObserver' in window)new ResizeObserver(sendHeight).observe(document.body);window.addEventListener('load',sendHeight);setTimeout(sendHeight,300);setTimeout(sendHeight,1200)}\n"
marker="$('#resetReviewBtn').onclick=()=>resetReview().catch(showError);"
if marker in s and "attendance-test-height" not in s:
    s=s.replace(marker,marker+'\n'+resize,1)

p.write_text(s,encoding='utf-8')
print('enhanced attendance review with embedded layout, document verification, and folder shortcuts')
