from pathlib import Path
import re

p=Path('attendance-overview.js')
s=p.read_text(encoding='utf-8')

# Extra UI for exact date-folder feedback.
if '.folder-target{' not in s:
    s=s.replace('@media(max-width:1450px)', '.folder-target{padding:7px 12px;border-bottom:1px solid #e2e8f0;background:#fff;font-size:10px;color:#64748b;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.folder-target strong{color:#0f172a}.folder-target a{color:#1d4ed8;font-weight:900;text-decoration:none}.folder-target.warn{background:#fff7ed;color:#9a3412}.viewer-wrap{overflow:auto}@media(max-width:1450px)', 1)

if 'id="folderTarget"' not in s:
    s=s.replace('<div id="viewer" class="viewer-wrap">', '<div id="folderTarget" class="folder-target">날짜 폴더 확인 중…</div><div id="viewer" class="viewer-wrap">', 1)
    s=s.replace("previewPanel=$('#previewPanel'),manualIssueMemo=", "previewPanel=$('#previewPanel'),folderTarget=$('#folderTarget'),manualIssueMemo=", 1)

old_decl="let dates=[],students=[],reasonCells={},driveFiles=[],memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();"
if old_decl in s and 'colorCache=new Map()' not in s:
    s=s.replace(old_decl, old_decl+"\n  const colorCache=new Map(),colorPromises=new Map();", 1)

if 'async function getColorsCached' not in s:
    pat=r"(  async function getColors\(cid\)\{[^\n]+\}\n)"
    m=re.search(pat,s)
    if not m:
        raise SystemExit('getColors anchor not found')
    extra="""  async function getColorsCached(cid,force=false){
    const id=String(cid),storageKey=`attendanceOverviewColors_${id}`,ttl=180000;
    if(!force&&colorCache.has(id))return colorCache.get(id);
    if(!force){try{const raw=sessionStorage.getItem(storageKey),x=raw?JSON.parse(raw):null;if(x&&Array.isArray(x.data)&&Date.now()-Number(x.at||0)<ttl){colorCache.set(id,x.data);return x.data}}catch{}}
    if(!force&&colorPromises.has(id))return colorPromises.get(id);
    const promise=getColors(id).then(bg=>{const data=Array.isArray(bg)?bg:[];colorCache.set(id,data);try{sessionStorage.setItem(storageKey,JSON.stringify({at:Date.now(),data}))}catch{}return data}).finally(()=>colorPromises.delete(id));
    colorPromises.set(id,promise);return promise;
  }
"""
    s=s[:m.end()]+extra+s[m.end():]

new_drive="""  async function loadDrive(){
    driveFiles=[];fileSel.innerHTML='';folderTarget.classList.remove('warn');folderTarget.textContent=`${currentIso} 날짜 폴더 찾는 중…`;viewer.innerHTML='<div class="viewer-empty">선택한 교육일자의 수기출석부 폴더를 찾는 중…</div>';
    try{
      const d=await getDrive(currentClass,currentIso),exact=d.exactDateFolder===true;
      const folderUrl=d.dateFolderUrl||d.folderUrl||'';
      if(exact){folderTarget.innerHTML=`<strong>${esc(currentIso)} 날짜 폴더 확인됨</strong>${folderUrl?`<a href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer">날짜 폴더 새 창</a>`:''}`}
      else{folderTarget.classList.add('warn');folderTarget.innerHTML=`<strong>${esc(currentIso)} 날짜 폴더를 정확히 찾지 못했습니다.</strong>${folderUrl?`<a href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer">수기출석 최상위 폴더</a>`:''}`}
      driveFiles=Array.isArray(d.files)?d.files:[];
      fileCount.textContent=`${driveFiles.length||Number(d.fileCount||0)}개`;
      fileSel.innerHTML=driveFiles.length?driveFiles.map((f,i)=>`<option value="${i}">${esc(f.name||`파일 ${i+1}`)}</option>`).join(''):'<option value="">개별 파일 목록 없음</option>';
      if(driveFiles.length){renderFile(0);return}
      openFile.disabled=!folderUrl;openFile.dataset.url=folderUrl||'';
      if(exact&&d.embeddedFolderUrl){
        viewer.innerHTML=`<iframe src="${esc(d.embeddedFolderUrl)}" referrerpolicy="no-referrer" allow="fullscreen"></iframe>`;
        if(Number(d.fileCount||0)>0)folderTarget.innerHTML+=`<span>· 파일 ${Number(d.fileCount)}개 감지 · 개별 파일 메타데이터 대기</span>`;
      }else if(exact){viewer.innerHTML='<div class="viewer-empty">날짜 폴더는 찾았지만 개별 PDF/이미지 파일 정보를 받지 못했습니다.<br>날짜 폴더 새 창에서 업로드 파일을 확인해 주세요.</div>'}
      else{viewer.innerHTML='<div class="viewer-empty">선택한 교육일자와 일치하는 날짜 폴더를 찾지 못했습니다.<br>다른 날짜를 선택하거나 Drive 폴더명을 확인해 주세요.</div>'}
    }catch(e){folderTarget.classList.add('warn');folderTarget.textContent='날짜 폴더 확인 실패';viewer.innerHTML=`<div class="viewer-empty">수기출석부를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`;fileCount.textContent='오류';openFile.disabled=true}
  }"""
s,n=re.subn(r"  async function loadDrive\(\)\{.*?\n  async function loadSelectedDate", new_drive+"\n  async function loadSelectedDate", s, count=1, flags=re.S)
if n!=1:
    raise SystemExit('loadDrive replacement failed')

new_class="""  async function loadClass(cid,keepDate='',forceColors=false){
    showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class="empty">Google Sheet를 읽는 중…</div>';
    const colorClass=currentClass,colorPromise=getColorsCached(colorClass,forceColors);
    try{
      const out=await getReader(currentClass);parseReader(out);dateSel.innerHTML=dates.map(d=>`<option value="${esc(d.label)}">${esc(d.label)}</option>`).join('');const preferred=dates.find(x=>x.label===keepDate)?.label||dates.at(-1)?.label||dates[0]?.label||'';dateSel.value=preferred;await loadSelectedDate();
      colorPromise.then(bg=>{if(currentClass!==colorClass)return;attendanceBackgrounds=bg;renderRows(dateSel.value);topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 서류색상 반영`}).catch(e=>{console.warn('attendance colors failed',e);if(currentClass===colorClass)topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 색상 확인 실패`})
    }catch(e){showErr(e);rows.innerHTML='<div class="empty">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}
  }"""
s,n=re.subn(r"  async function loadClass\(cid,keepDate=''\)\{.*?\n  \}\n  classSel\.onchange", new_class+"\n  classSel.onchange", s, count=1, flags=re.S)
if n!=1:
    # Already upgraded signature case.
    s,n=re.subn(r"  async function loadClass\(cid,keepDate='',forceColors=false\)\{.*?\n  \}\n  classSel\.onchange", new_class+"\n  classSel.onchange", s, count=1, flags=re.S)
if n!=1:
    raise SystemExit('loadClass replacement failed')

s=s.replace("$('#reload').onclick=()=>loadClass(currentClass,dateSel.value);", "$('#reload').onclick=()=>loadClass(currentClass,dateSel.value,true);", 1)

# Force browsers to load the new overview module.
ip=Path('index.html')
idx=ip.read_text(encoding='utf-8')
idx=re.sub(r'/attendance-overview\.js\?v=20260906-\d+', '/attendance-overview.js?v=20260906-3', idx)
ip.write_text(idx,encoding='utf-8')

p.write_text(s,encoding='utf-8')
print('optimized color caching and exact date-folder preview')
