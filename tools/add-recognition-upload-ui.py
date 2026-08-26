from pathlib import Path
import re

# ---------- attendance admin source ----------
p=Path('attendance-test.html'); s=p.read_text(encoding='utf-8')
if 'RECOGNITION_UPLOAD_UI_V1' not in s:
    css='''.recognition-upload-card{margin-top:12px;padding:15px;display:none}.recognition-upload-card.show{display:block}.recognition-upload-grid{display:grid;grid-template-columns:1.2fr .8fr 1.3fr;gap:10px;align-items:end}.recognition-upload-grid .field input,.recognition-upload-grid .field select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#fff}.recognition-file-preview{margin-top:10px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;word-break:break-all}.recognition-upload-actions{display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap}.recognition-upload-state{font-size:11px;color:#64748b}@media(max-width:780px){.recognition-upload-grid{grid-template-columns:1fr}}'''
    s=s.replace('</style>',css+'</style>',1)
    s=s.replace('<div class="summary"><span id="sumPresent"', '<button id="recognitionUploadToggle" class="btn primary">출결인정자료 업로드</button><div class="summary"><span id="sumPresent"',1)
    anchor='</div>\n<div class="notice"><b>안전 설정:'
    panel='''</div>\n<section id="recognitionUploadCard" class="card recognition-upload-card"><div class="recognition-upload-grid"><div class="field"><label>학생 이름</label><select id="recognitionStudent"><option>명단 불러오는 중…</option></select></div><div class="field"><label>업로드 일자</label><input id="recognitionDate" type="date" readonly></div><div class="field"><label>파일 선택 · 최대 3MB</label><input id="recognitionFile" type="file" accept=".pdf,image/*,.hwp,.hwpx,.doc,.docx"></div></div><div id="recognitionFilePreview" class="recognition-file-preview">학생과 파일을 선택하면 공식 파일명이 표시됩니다.</div><div class="recognition-upload-actions"><button id="recognitionUploadBtn" class="btn primary" disabled>선택 파일 업로드</button><span id="recognitionUploadState" class="recognition-upload-state">반정보 J열의 공식 반명칭을 사용합니다.</span></div></section>\n<div class="notice"><b>안전 설정:'''
    if anchor not in s: raise SystemExit('attendance toolbar anchor not found')
    s=s.replace(anchor,panel,1)
    helper=r'''
// RECOGNITION_UPLOAD_UI_V1
let recognitionOfficialName='',recognitionContextClass='';
function recognitionExt(name){const m=String(name||'').match(/(\.[A-Za-z0-9]{1,8})$/);return m?m[1].toLowerCase():''}
function recognitionMmdd(iso){return String(iso||'').replace(/-/g,'').slice(4,8)}
function recognitionPreview(){const st=$('#recognitionStudent')?.value||'',f=$('#recognitionFile')?.files?.[0],d=$('#recognitionDate')?.value||'';const out=$('#recognitionFilePreview'),btn=$('#recognitionUploadBtn');if(!out||!btn)return;const name=recognitionOfficialName&&st&&d?`${recognitionOfficialName}_${st}_${recognitionMmdd(d)}${f?recognitionExt(f.name):''}`:'';out.textContent=name?`저장 파일명: ${name}`:'학생과 파일을 선택하면 공식 파일명이 표시됩니다.';btn.disabled=!(name&&f&&f.size<=3*1024*1024)}
async function recognitionApi(payload){const r=await fetch('/api/recognition-upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token,...payload})});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok||!d.ok)throw new Error(d?.error||'UPLOAD_API_ERROR');return d}
async function refreshRecognitionUploadPanel(force=false){const card=$('#recognitionUploadCard');if(!card||(!card.classList.contains('show')&&!force))return;const iso=dateLabelToIso(currentLabel);$('#recognitionDate').value=iso;if(recognitionContextClass!==selectedClass||force){const state=$('#recognitionUploadState');if(state)state.textContent='공식 반명칭과 학생명단 확인 중…';const ctx=await recognitionApi({action:'context',classId:selectedClass});recognitionContextClass=selectedClass;recognitionOfficialName=ctx.officialClassName||'';$('#recognitionStudent').innerHTML=(ctx.students||[]).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')||'<option value="">학생 없음</option>';if(state)state.textContent=ctx.bridgeReady?(recognitionOfficialName?`공식 반명칭: ${recognitionOfficialName}`:'반정보 J열 공식 반명칭을 찾지 못했습니다.'):'업로드 브리지 연결 전입니다.'}recognitionPreview()}
async function submitRecognitionUpload(){const f=$('#recognitionFile')?.files?.[0],student=$('#recognitionStudent')?.value,date=$('#recognitionDate')?.value,state=$('#recognitionUploadState'),btn=$('#recognitionUploadBtn');if(!f||!student||!date)return;if(f.size>3*1024*1024)throw new Error('파일은 3MB 이하만 업로드할 수 있습니다.');btn.disabled=true;if(state)state.textContent='업로드 중…';const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.onerror=reject;r.readAsDataURL(f)});try{const out=await recognitionApi({action:'upload',classId:selectedClass,student,date,fileName:f.name,mimeType:f.type||'application/octet-stream',base64:data});if(state)state.textContent=`업로드 완료 · ${out.fileName}`;$('#recognitionFile').value='';recognitionPreview();await refreshFolderLinks()}finally{btn.disabled=false}}
'''
    ins='function verifiedSet(review)'
    if ins not in s: raise SystemExit('attendance helper anchor not found')
    s=s.replace(ins,helper+'\n'+ins,1)
    s=s.replace("$('#dateSelect').onchange=async e=>{if(dirty&&!confirm('저장하지 않은 Firebase 수정이 있습니다. 날짜를 바꿀까요?')){e.target.value=currentLabel;return}await renderDate(e.target.value);await refreshFolderLinks();await logView(e.target.value)};", "$('#dateSelect').onchange=async e=>{if(dirty&&!confirm('저장하지 않은 Firebase 수정이 있습니다. 날짜를 바꿀까요?')){e.target.value=currentLabel;return}await renderDate(e.target.value);await refreshFolderLinks();await refreshRecognitionUploadPanel();await logView(e.target.value)};",1)
    bottom="$('#overviewReloadBtn').onclick=()=>renderClassOverview().catch(showError);"
    bind=bottom+"\n$('#recognitionUploadToggle').onclick=()=>{const c=$('#recognitionUploadCard');c.classList.toggle('show');if(c.classList.contains('show'))refreshRecognitionUploadPanel(true).catch(showError)};$('#recognitionStudent').onchange=recognitionPreview;$('#recognitionFile').onchange=recognitionPreview;$('#recognitionUploadBtn').onclick=()=>submitRecognitionUpload().catch(showError);"
    if bottom not in s: raise SystemExit('attendance bottom anchor not found')
    s=s.replace(bottom,bind,1)
    p.write_text(s,encoding='utf-8')

# ---------- teacher main ----------
p=Path('index.html'); s=p.read_text(encoding='utf-8')
if 'TEACHER_RECOGNITION_UPLOAD_V1' not in s:
    css='''.recognition-uploader{margin-top:14px;padding:18px}.recognition-uploader h3{margin:0 0 5px}.recognition-uploader-grid{display:grid;grid-template-columns:1fr 180px 1fr;gap:12px;align-items:end;margin-top:13px}.recognition-uploader-grid input,.recognition-uploader-grid select{width:100%;border:1px solid #cbd5e1;border-radius:11px;padding:11px 12px;background:#fff}.recognition-name-preview{margin-top:11px;padding:11px 13px;border-radius:11px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;word-break:break-all}.recognition-uploader-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:11px}.recognition-uploader-state{font-size:11px;color:#64748b}@media(max-width:760px){.recognition-uploader-grid{grid-template-columns:1fr}}'''
    s=s.replace('</style>',css+'</style>',1)
    helper=r'''
// TEACHER_RECOGNITION_UPLOAD_V1
function recognitionUploadExt(name){const m=String(name||'').match(/(\.[A-Za-z0-9]{1,8})$/);return m?m[1].toLowerCase():''}
function recognitionUploadMmdd(iso){return String(iso||'').replace(/-/g,'').slice(4,8)}
async function recognitionUploadApi(user,payload){const idToken=await user.getIdToken();const r=await fetch('/api/recognition-upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken,...payload})});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok||!d.ok)throw new Error(d?.error||'UPLOAD_API_ERROR');return d}
async function renderTeacherRecognitionUploader(user,classId){const host=document.getElementById('teacherRecognitionUploadHost');if(!host)return;host.innerHTML='<section class="card recognition-uploader"><div class="empty">학생명단과 공식 반명칭을 불러오는 중…</div></section>';try{const ctx=await recognitionUploadApi(user,{action:'context',classId:String(classId)}),date=localDateKey();host.innerHTML=`<section class="card recognition-uploader"><h3>출결인정자료 업로드</h3><div class="mini-note">학생 이름과 날짜만 선택하면 반정보 J열의 공식 반명칭으로 파일명이 자동 생성됩니다.</div><div class="recognition-uploader-grid"><div class="field"><label>학생 이름</label><select id="teacherRecognitionStudent">${(ctx.students||[]).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></div><div class="field"><label>일자</label><input id="teacherRecognitionDate" type="date" value="${esc(date)}"></div><div class="field"><label>파일 · 최대 3MB</label><input id="teacherRecognitionFile" type="file" accept=".pdf,image/*,.hwp,.hwpx,.doc,.docx"></div></div><div id="teacherRecognitionPreview" class="recognition-name-preview"></div><div class="recognition-uploader-actions"><button id="teacherRecognitionSubmit" class="btn btn-primary" disabled>업로드</button><span id="teacherRecognitionState" class="recognition-uploader-state">${ctx.bridgeReady?(ctx.officialClassName?`공식 반명칭: ${esc(ctx.officialClassName)}`:'공식 반명칭 확인 필요'):'업로드 브리지 연결 전'}</span></div></section>`;const official=ctx.officialClassName||'',student=document.getElementById('teacherRecognitionStudent'),dateEl=document.getElementById('teacherRecognitionDate'),file=document.getElementById('teacherRecognitionFile'),preview=document.getElementById('teacherRecognitionPreview'),submit=document.getElementById('teacherRecognitionSubmit'),state=document.getElementById('teacherRecognitionState');const paint=()=>{const f=file.files?.[0],name=official&&student.value&&dateEl.value?`${official}_${student.value}_${recognitionUploadMmdd(dateEl.value)}${f?recognitionUploadExt(f.name):''}`:'';preview.textContent=name?`저장 파일명: ${name}`:'학생·날짜·파일을 선택해 주세요.';submit.disabled=!(name&&f&&f.size<=3*1024*1024)};[student,dateEl,file].forEach(x=>x.onchange=paint);paint();submit.onclick=async()=>{const f=file.files?.[0];if(!f||f.size>3*1024*1024)return alert('3MB 이하 파일을 선택해 주세요.');submit.disabled=true;state.textContent='업로드 중…';try{const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.onerror=reject;r.readAsDataURL(f)}),out=await recognitionUploadApi(user,{action:'upload',classId:String(classId),student:student.value,date:dateEl.value,fileName:f.name,mimeType:f.type||'application/octet-stream',base64});state.textContent=`업로드 완료 · ${out.fileName}`;file.value='';paint();toast('출결인정자료 업로드 완료')}catch(e){state.textContent=`업로드 실패 · ${e.message||e}`;alert(e.message||e);paint()}}}catch(e){host.innerHTML=`<section class="card recognition-uploader"><div class="fatal">업로드 화면을 준비하지 못했습니다.<br>${esc(e.message||e)}</div></section>`}}
'''
    anchor='async function teacherView('
    if anchor not in s: raise SystemExit('teacherView anchor not found')
    s=s.replace(anchor,helper+'\n'+anchor,1)
    a=s.index('async function teacherView('); b=s.index('function linkModal',a); seg=s[a:b]
    old='${taskButtons(t[0],t[3],t[4])}</article>'
    new='${taskButtons(t[0],t[3],t[4])}${String(t[0])===\'5\'?`<button class="btn btn-primary recognitionUploadToggle" style="margin-top:8px">자료 업로드</button>`:\'\'}</article>'
    if old not in seg: raise SystemExit('teacher task button anchor not found')
    seg=seg.replace(old,new,1)
    marker='</section><div class="section-head"><div><h2>필요할 때 바로가기</h2>'
    if marker not in seg: raise SystemExit('teacher task grid end anchor not found')
    seg=seg.replace(marker,'</section><div id="teacherRecognitionUploadHost"></div><div class="section-head"><div><h2>필요할 때 바로가기</h2>',1)
    bind='bindOpen();'
    if bind not in seg: raise SystemExit('teacher bind anchor not found')
    seg=seg.replace(bind,bind+"document.querySelectorAll('.recognitionUploadToggle').forEach(b=>b.onclick=()=>{const h=document.getElementById('teacherRecognitionUploadHost');if(h&&h.innerHTML.trim()){h.innerHTML='';return}renderTeacherRecognitionUploader(user,c.id)});",1)
    s=s[:a]+seg+s[b:]
    p.write_text(s,encoding='utf-8')
print('recognition upload UI patched')
