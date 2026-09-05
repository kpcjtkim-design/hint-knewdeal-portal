from pathlib import Path
import re

# Patch the attendance overview to reuse the same evidence-coordinate logic as
# attendance auto-validation, add resilient color loading, and require the
# exact selected-date Drive folder before showing a preview.
p = Path('attendance-overview.js')
s = p.read_text(encoding='utf-8')

old = "async function getColors(cid){const idToken=await user.getIdToken();const d=await post('/api/attendance-colors',{idToken,classId:String(cid)});return Array.isArray(d.attendanceBackgrounds)?d.attendanceBackgrounds:[]}"
new = """async function getColorsOnce(cid){
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
}"""
if old in s:
    s = s.replace(old, new, 1)
elif 'async function getColorsOnce(cid)' not in s:
    raise SystemExit('getColors anchor not found')

# Normalize the same legacy attendance status that the auto-validation screen normalizes.
old = "function evidenceFor(student,dateObj,status,backgrounds){\n  const x=String(status||'').trim();"
new = "function evidenceFor(student,dateObj,status,backgrounds){\n  const raw=String(status||'').trim();\n  const x=raw==='인정결석'?'중복':raw;"
if old in s:
    s = s.replace(old, new, 1)
elif "const raw=String(status||'').trim();" not in s:
    raise SystemExit('evidenceFor anchor not found')

# Replace Drive loading so only the exact selected-date folder is used.
pat = re.compile(r"  async function loadDrive\(\)\{.*?\}\n  async function loadSelectedDate\(\)", re.S)
replacement = """  async function loadDrive(){
    driveFiles=[];fileSel.innerHTML='';openFile.dataset.url='';openFile.disabled=true;
    viewer.innerHTML='<div class=\"viewer-empty\">선택한 날짜의 수기출석부 폴더를 찾는 중…</div>';
    try{
      const d=await getDrive(currentClass,currentIso);
      const exact=Boolean(d.exactDateFolder&&d.dateFolderId);
      if(!exact){
        fileCount.textContent='날짜폴더 없음';
        fileSel.innerHTML='<option value=\"\">정확한 날짜 폴더 없음</option>';
        viewer.innerHTML='<div class=\"viewer-empty\">선택한 교육일자의 정확한 수기출석부 날짜 폴더를 찾지 못했습니다.<br>반·날짜가 맞는지와 Drive 폴더 구성을 확인해 주세요.</div>';
        return;
      }
      driveFiles=Array.isArray(d.files)?d.files:[];
      const folderUrl=d.dateFolderUrl||d.folderUrl||'';
      const embedded=d.embeddedFolderUrl||'';
      const reported=Number.isFinite(Number(d.fileCount))?Number(d.fileCount):driveFiles.length;
      fileCount.textContent=`${reported}개 · 날짜폴더`;
      if(driveFiles.length){
        fileSel.innerHTML=driveFiles.map((f,i)=>`<option value=\"${i}\">${esc(f.name||`파일 ${i+1}`)}</option>`).join('');
        renderFile(0);
        return;
      }
      fileSel.innerHTML='<option value=\"\">파일 목록 없음</option>';
      openFile.disabled=!folderUrl;openFile.dataset.url=folderUrl;
      if(embedded){
        viewer.innerHTML=`<iframe src=\"${esc(embedded)}\" referrerpolicy=\"no-referrer\"></iframe>`;
      }else{
        viewer.innerHTML='<div class=\"viewer-empty\">정확한 날짜 폴더는 찾았지만 미리볼 파일 목록을 받지 못했습니다.<br>날짜 폴더의 파일 목록 연동 상태를 확인해 주세요.</div>';
      }
    }catch(e){
      viewer.innerHTML=`<div class=\"viewer-empty\">수기출석부를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`;
      fileCount.textContent='오류';openFile.disabled=true;
    }
  }
  async function loadSelectedDate()"""
s2, n = pat.subn(replacement, s, count=1)
if n == 1:
    s = s2
elif '정확한 수기출석부 날짜 폴더를 찾지 못했습니다.' not in s:
    raise SystemExit('loadDrive anchor not found')

# Add a resilient background refresh and make class/date changes reuse it.
old = """  async function loadClass(cid,keepDate=''){
    showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class=\"empty\">Google Sheet를 읽는 중…</div>';
    try{const out=await getReader(currentClass);parseReader(out);dateSel.innerHTML=dates.map(d=>`<option value=\"${esc(d.label)}\">${esc(d.label)}</option>`).join('');const preferred=dates.find(x=>x.label===keepDate)?.label||dates.at(-1)?.label||dates[0]?.label||'';dateSel.value=preferred;await loadSelectedDate();const colorClass=currentClass;getColors(colorClass).then(bg=>{if(currentClass!==colorClass)return;attendanceBackgrounds=bg;renderRows(dateSel.value);topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 서류색상 반영`}).catch(e=>{console.warn('attendance colors failed',e);if(currentClass===colorClass)topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 색상 확인 실패`})}catch(e){showErr(e);rows.innerHTML='<div class=\"empty\">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}
  }
  classSel.onchange=()=>loadClass(classSel.value);
  dateSel.onchange=()=>loadSelectedDate();"""
new = """  async function refreshColors(cid){
    const colorClass=String(cid);
    try{
      const bg=await getColors(colorClass);
      if(currentClass!==colorClass)return;
      attendanceBackgrounds=bg;
      renderRows(dateSel.value);
      topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 서류색상 반영`;
    }catch(e){
      console.warn('attendance colors failed',e);
      if(currentClass===colorClass)topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 색상 확인 실패`;
    }
  }
  async function loadClass(cid,keepDate=''){
    showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class=\"empty\">Google Sheet를 읽는 중…</div>';
    try{
      const out=await getReader(currentClass);parseReader(out);
      attendanceBackgrounds=Array.isArray(out.attendanceBackgrounds)?out.attendanceBackgrounds:(Array.isArray(out.backgrounds)?out.backgrounds:[]);
      dateSel.innerHTML=dates.map(d=>`<option value=\"${esc(d.label)}\">${esc(d.label)}</option>`).join('');
      const preferred=dates.find(x=>x.label===keepDate)?.label||dates.at(-1)?.label||dates[0]?.label||'';dateSel.value=preferred;
      await loadSelectedDate();
      if(attendanceBackgrounds.length){renderRows(dateSel.value);topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 서류색상 반영`}
      else refreshColors(currentClass);
    }catch(e){showErr(e);rows.innerHTML='<div class=\"empty\">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}
  }
  classSel.onchange=()=>loadClass(classSel.value);
  dateSel.onchange=async()=>{await loadSelectedDate();if(!attendanceBackgrounds.length)refreshColors(currentClass)};"""
if old in s:
    s = s.replace(old, new, 1)
elif 'async function refreshColors(cid)' not in s:
    raise SystemExit('loadClass/color refresh anchor not found')

p.write_text(s, encoding='utf-8')

# Make the admin Drive endpoint pass through file-list shapes from the existing
# monitor and never embed the class root as if it were the selected date folder.
p = Path('api/admin-drive-review.js')
s = p.read_text(encoding='utf-8')
s = s.replace("  const mimeType=String(f?.mimeType||'application/octet-stream');\n  return{", "  const mimeType=String(f?.mimeType||'application/octet-stream');\n  if(mimeType==='application/vnd.google-apps.folder')return null;\n  return{", 1)
old = "  const files=(Array.isArray(d?.files)?d.files:[]).map(safeFile).filter(Boolean);"
new = """  const rawFiles=Array.isArray(d?.files)?d.files:
    (df&&typeof df==='object'&&Array.isArray(df.files)?df.files:
    (Array.isArray(d?.dateFiles)?d.dateFiles:
    (Array.isArray(d?.folderFiles)?d.folderFiles:[])));
  const files=rawFiles.map(safeFile).filter(Boolean);"""
if old in s:
    s = s.replace(old, new, 1)
elif 'const rawFiles=' not in s:
    raise SystemExit('admin drive file list anchor not found')
old = "return res.status(200).json({ok:true,readOnly:true,classId:cid,date:String(date),folderKey:key,...out,embeddedFolderUrl:out.folderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.folderId)}#list`:'',actorEmail:email});"
new = "return res.status(200).json({ok:true,readOnly:true,classId:cid,date:String(date),folderKey:key,...out,embeddedFolderUrl:out.exactDateFolder&&out.dateFolderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.dateFolderId)}#list`:'',actorEmail:email});"
if old in s:
    s = s.replace(old, new, 1)
elif 'out.exactDateFolder&&out.dateFolderId' not in s:
    raise SystemExit('embedded exact date folder anchor not found')
p.write_text(s, encoding='utf-8')

# Cache-bust the updated overview module.
p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = re.sub(r"/attendance-overview\.js\?v=20260906-[0-9]+", "/attendance-overview.js?v=20260906-3", s, count=1)
p.write_text(s, encoding='utf-8')
print('attendance overview color + exact Drive date folder patch applied')
