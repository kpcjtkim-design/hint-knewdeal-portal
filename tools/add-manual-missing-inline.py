from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

# CSS: inline warning beside task number 2 only.
css_anchor='.num{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-weight:900;font-size:13px;margin-bottom:14px}'
css_add=css_anchor+'.num-row{display:flex;align-items:center;gap:8px;margin-bottom:14px;min-height:30px}.num-row .num{margin-bottom:0;flex:0 0 auto}.manual-missing-inline{color:#dc2626;font-size:11px;font-weight:900;line-height:1.3;word-break:keep-all}'
if '.manual-missing-inline{' not in s:
    if css_anchor not in s:
        raise SystemExit('num CSS anchor not found')
    s=s.replace(css_anchor,css_add,1)

# Teacher card: number 2 gets a red inline missing-date target.
old='<article class="card task"><div class="num">${t[0]}</div><h3>${esc(t[1])}${uploadBadge(t[0],t[3])}</h3>'
new='<article class="card task">${String(t[0])===\'2\'?`<div class="num-row"><div class="num">${t[0]}</div><span class="manual-missing-inline" data-folder-id="${esc(driveFolderId(t[3]))}"></span></div>`:`<div class="num">${t[0]}</div>`}<h3>${esc(t[1])}${uploadBadge(t[0],t[3])}</h3>'
if 'class="manual-missing-inline" data-folder-id=' not in s:
    if old not in s:
        raise SystemExit('teacher task card anchor not found')
    s=s.replace(old,new,1)

# Reuse the same existing-date-folder rule as the missing-date modal.
helper_anchor="function dateFolderExistsResult(d){return d&&d.ok!==false&&!['DATE_FOLDER_NOT_FOUND','WEEK_FOLDER_NOT_FOUND'].includes(d.reason)}"
helper_add=helper_anchor+"\nfunction prettyShortDate(key){return `${Number(key.slice(5,7))}/${Number(key.slice(8,10))}`}\nasync function refreshManualMissingInline(root=document){const el=root.querySelector('.manual-missing-inline[data-folder-id]');if(!el)return;const folderId=el.dataset.folderId;if(!folderId){el.textContent='';return}el.textContent='미업로드 확인 중…';const dates=courseDatesThrough(localDateKey()),missing=[];try{for(let i=0;i<dates.length;i+=4){const batch=dates.slice(i,i+4),results=await Promise.all(batch.map(async date=>{try{return {date,data:await checkDriveUpload(folderId,date)}}catch(e){return {date,error:e}}}));for(const r of results){if(r.error||!dateFolderExistsResult(r.data))continue;if(!r.data.completed)missing.push(r.date)}await new Promise(r=>setTimeout(r,25))}el.textContent=missing.length?`${missing.map(prettyShortDate).join(', ')} 미업로드!`:''}catch(e){el.textContent=''}}"
if 'async function refreshManualMissingInline(' not in s:
    if helper_anchor not in s:
        raise SystemExit('dateFolderExistsResult anchor not found')
    s=s.replace(helper_anchor,helper_add,1)

# Start the inline check in the background after the normal today's badge check.
old_call='refreshUploadBadges(document,localDateKey());document.getElementById(\'copyNotice\')'
new_call='refreshUploadBadges(document,localDateKey());refreshManualMissingInline(document);document.getElementById(\'copyNotice\')'
if 'refreshManualMissingInline(document);document.getElementById(\'copyNotice\')' not in s:
    if old_call not in s:
        raise SystemExit('teacher refresh call anchor not found')
    s=s.replace(old_call,new_call,1)

p.write_text(s,encoding='utf-8')
print('patched inline missing dates for manual attendance only')
