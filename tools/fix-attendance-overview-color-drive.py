from pathlib import Path
import re

p=Path('attendance-overview.js')
s=p.read_text(encoding='utf-8')

# 1) Same color endpoint as attendance auto-validation, but retry cold/slow responses.
old="async function getColors(cid){const idToken=await user.getIdToken();const d=await post('/api/attendance-colors',{idToken,classId:String(cid)});return Array.isArray(d.attendanceBackgrounds)?d.attendanceBackgrounds:[]}"
new="""async function getColorsOnce(cid){
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
    s=s.replace(old,new,1)
elif 'async function getColorsOnce(cid)' not in s:
    raise SystemExit('getColors anchor not found')

# Normalize legacy status exactly as attendance auto-validation does.
old="function evidenceFor(student,dateObj,status,backgrounds){\n  const x=String(status||'').trim();"
new="function evidenceFor(student,dateObj,status,backgrounds){\n  const raw=String(status||'').trim();\n  const x=raw==='인정결석'?'중복':raw;"
if old in s:
    s=s.replace(old,new,1)
elif "const raw=String(status||'').trim();" not in s:
    raise SystemExit('evidenceFor anchor not found')

# 2) Require exact selected-date folder; never silently fall back to class root.
pat=re.compile(r"  async function loadDrive\(\)\{.*?\n  \}\n  async function loadSelectedDate\(\)",re.S)
replacement="""  async function loadDrive(){
    driveFiles=[];fileSel.innerHTML='';openFile.dataset.url='';openFile.disabled=true;
    if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.classList.remove('warn');folderTarget.textContent=`${currentIso} 날짜 폴더 찾는 중…`}
    viewer.innerHTML='<div class=\"viewer-empty\">선택한 교육일자의 정확한 수기출석부 날짜 폴더를 찾는 중…</div>';
    try{
      const d=await getDrive(currentClass,currentIso);
      const exact=Boolean(d.exactDateFolder&&d.dateFolderId);
      const folderUrl=d.dateFolderUrl||d.folderUrl||'';
      if(!exact){
        fileCount.textContent='날짜폴더 없음';
        fileSel.innerHTML='<option value=\"\">정확한 날짜 폴더 없음</option>';
        if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.classList.add('warn');folderTarget.textContent=`${currentIso} 날짜 폴더를 찾지 못함`}
        viewer.innerHTML='<div class=\"viewer-empty\">선택한 교육일자와 정확히 일치하는 수기출석부 날짜 폴더를 찾지 못했습니다.<br>반·날짜 및 Drive 날짜 폴더명을 확인해 주세요.</div>';
        return;
      }
      if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.innerHTML=`<strong>${esc(currentIso)} 날짜 폴더 확인됨</strong>${folderUrl?`<a href=\"${esc(folderUrl)}\" target=\"_blank\" rel=\"noopener noreferrer\">날짜 폴더 새 창</a>`:''}`}
      driveFiles=Array.isArray(d.files)?d.files:[];
      const embedded=d.embeddedFolderUrl||'';
      const reported=Number.isFinite(Number(d.fileCount))?Number(d.fileCount):driveFiles.length;
      fileCount.textContent=`${reported}개 · 날짜폴더`;
      if(driveFiles.length){
        fileSel.innerHTML=driveFiles.map((f,i)=>`<option value=\"${i}\">${esc(f.name||`파일 ${i+1}`)}</option>`).join('');
        renderFile(0);
        return;
      }
      fileSel.innerHTML='<option value=\"\">개별 파일 목록 없음</option>';
      openFile.disabled=!folderUrl;openFile.dataset.url=folderUrl;
      if(embedded){
        viewer.innerHTML=`<iframe src=\"${esc(embedded)}\" referrerpolicy=\"no-referrer\"></iframe>`;
      }else{
        viewer.innerHTML='<div class=\"viewer-empty\">정확한 날짜 폴더는 찾았지만 PDF/이미지 파일 목록을 받지 못했습니다.<br>날짜 폴더의 파일 목록 연동을 확인해 주세요.</div>';
      }
    }catch(e){
      if(typeof folderTarget!=='undefined'&&folderTarget){folderTarget.classList.add('warn');folderTarget.textContent='날짜 폴더 확인 실패'}
      viewer.innerHTML=`<div class=\"viewer-empty\">수기출석부를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`;
      fileCount.textContent='오류';openFile.disabled=true;
    }
  }
  async function loadSelectedDate()"""
s2,n=pat.subn(replacement,s,count=1)
if n==1:
    s=s2
elif '선택한 교육일자와 정확히 일치하는 수기출석부 날짜 폴더' not in s:
    raise SystemExit('loadDrive anchor not found')

# If the optimized color cache is present, the retried getColors above is automatically reused.
# If not, make date changes retry colors when the previous class-level load failed.
if 'getColorsCached' not in s:
    s=s.replace("  dateSel.onchange=()=>loadSelectedDate();","  dateSel.onchange=async()=>{await loadSelectedDate();if(!attendanceBackgrounds.length){try{attendanceBackgrounds=await getColors(currentClass);renderRows(dateSel.value)}catch(e){console.warn('attendance colors failed',e)}}};",1)

p.write_text(s,encoding='utf-8')

# 3) Broaden the read-only Drive response to accept file metadata wherever the existing
# monitor returns it, and only embed the exact date folder.
p=Path('api/admin-drive-review.js')
s=p.read_text(encoding='utf-8')
if "mimeType==='application/vnd.google-apps.folder'" not in s:
    s=s.replace("  const mimeType=String(f?.mimeType||'application/octet-stream');\n  return{","  const mimeType=String(f?.mimeType||'application/octet-stream');\n  if(mimeType==='application/vnd.google-apps.folder')return null;\n  return{",1)
old="  const files=(Array.isArray(d?.files)?d.files:[]).map(safeFile).filter(Boolean);"
new="""  const rawFiles=Array.isArray(d?.files)?d.files:
    (df&&typeof df==='object'&&Array.isArray(df.files)?df.files:
    (Array.isArray(d?.dateFiles)?d.dateFiles:
    (Array.isArray(d?.folderFiles)?d.folderFiles:[])));
  const files=rawFiles.map(safeFile).filter(Boolean);"""
if old in s:
    s=s.replace(old,new,1)
elif 'const rawFiles=' not in s:
    raise SystemExit('admin drive files anchor not found')
old="return res.status(200).json({ok:true,readOnly:true,classId:cid,date:String(date),folderKey:key,...out,embeddedFolderUrl:out.folderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.folderId)}#list`:'',actorEmail:email});"
new="return res.status(200).json({ok:true,readOnly:true,classId:cid,date:String(date),folderKey:key,...out,embeddedFolderUrl:out.exactDateFolder&&out.dateFolderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.dateFolderId)}#list`:'',actorEmail:email});"
if old in s:
    s=s.replace(old,new,1)
elif 'out.exactDateFolder&&out.dateFolderId' not in s:
    raise SystemExit('exact embedded folder anchor not found')
p.write_text(s,encoding='utf-8')

# Cache bust.
p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=re.sub(r"/attendance-overview\.js\?v=20260906-[0-9]+","/attendance-overview.js?v=20260906-4",s,count=1)
p.write_text(s,encoding='utf-8')
print('overview color retry + exact date Drive preview patch applied')
