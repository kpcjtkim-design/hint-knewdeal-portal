from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

css_anchor='.auto-table th:nth-child(1),.auto-table td:nth-child(1),.auto-table th:nth-child(2),.auto-table td:nth-child(2){text-align:left}'
css_add=css_anchor+'.upload-class-buttons{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 4px}.upload-class-btn{border:0;border-radius:10px;padding:8px 10px;background:#eef2f7;color:#334155;font-weight:900;cursor:pointer}.upload-class-btn.active{background:#0f172a;color:#fff}.upload-detail{margin-top:18px;padding:18px;border:1px solid #dbe3ee;border-radius:15px;background:#f8fafc}.upload-detail-head{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap}.upload-detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.upload-day{padding:11px 12px;border-radius:11px;border:1px solid #e2e8f0;background:#fff}.upload-day strong{display:block;font-size:13px;margin-bottom:5px}.upload-day .day-state{font-size:12px;font-weight:900}.upload-day.done{background:#f0fdf4;border-color:#bbf7d0}.upload-day.done .day-state{color:#166534}.upload-day.missing{background:#fef2f2;border-color:#fecaca}.upload-day.missing .day-state{color:#b91c1c}.upload-day.none{background:#f8fafc}.upload-day.none .day-state{color:#64748b}.upload-day.err{background:#fff7ed;border-color:#fed7aa}.upload-day.err .day-state{color:#9a3412}@media(max-width:900px){.upload-detail-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:680px){.upload-detail-grid{grid-template-columns:repeat(2,1fr)}}'
if '.upload-class-buttons{' not in s:
    if css_anchor not in s:
        raise SystemExit('upload CSS anchor not found')
    s=s.replace(css_anchor,css_add,1)

start=s.find("async function uploadAdmin(user,p,dateValue=localDateKey()){")
end=s.find("async function userAdmin(user,p){",start)
if start<0 or end<0:
    raise SystemExit('uploadAdmin function anchor not found')

new_code=r'''async function renderUploadClassDetail(records,classId,folderKey='manualAttendance'){
  const host=document.getElementById('uploadClassDetail');
  if(!host)return;
  const rec=records.find(x=>String(x.id)===String(classId));
  if(!rec){host.innerHTML='';return}
  const folders=[['manualAttendance','수기출석본'],['photos','교육사진'],['recognition','출결인정자료']],core={...EMPTY,...(rec.data.coreLinks||{})},folderId=driveFolderId(core[folderKey]||''),folderLabel=(folders.find(x=>x[0]===folderKey)||folders[0])[1];
  host.innerHTML=`<div class="upload-detail"><div class="upload-detail-head"><div><h3 style="margin:0">${esc(rec.id)}반 · 날짜별 업로드 확인</h3><div class="mini-note">${esc(rec.course)} · ${esc(rec.venue)}</div></div><div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><div class="field" style="min-width:190px"><label>확인 폴더</label><select id="uploadFolderSelect">${folders.map(([k,l])=>`<option value="${k}" ${k===folderKey?'selected':''}>${l}</option>`).join('')}</select></div><button id="refreshUploadDetail" class="btn btn-soft">↻ 다시 확인</button></div></div><div id="uploadDetailSummary" class="status-summary" style="margin-top:14px"><span class="status-pill status-none">확인 준비</span></div><div id="uploadDetailBody" class="upload-detail-grid"><div class="empty" style="grid-column:1/-1">${folderId?'날짜별 폴더를 확인합니다.':'폴더 링크가 설정되지 않았습니다.'}</div></div></div>`;
  host.querySelector('#uploadFolderSelect').onchange=e=>renderUploadClassDetail(records,classId,e.target.value);
  host.querySelector('#refreshUploadDetail').onclick=()=>renderUploadClassDetail(records,classId,folderKey);
  if(!folderId)return;
  const dates=courseDatesThrough(localDateKey()),body=host.querySelector('#uploadDetailBody'),summary=host.querySelector('#uploadDetailSummary');
  body.innerHTML='';let done=0,missing=0,none=0,err=0,checked=0;const cards=[];
  const paint=()=>{summary.innerHTML=`<span class="status-pill status-o">완료 ${done}</span><span class="status-pill status-x">미업로드 ${missing}</span><span class="status-pill status-none">폴더 없음 ${none}</span>${err?`<span class="status-pill status-none">오류 ${err}</span>`:''}<span class="status-pill status-none">${checked}/${dates.length}</span>`;body.innerHTML=cards.join('')||'<div class="empty" style="grid-column:1/-1">확인 중…</div>'};paint();
  for(let i=0;i<dates.length;i+=4){const batch=dates.slice(i,i+4),results=await Promise.all(batch.map(async date=>{try{return {date,data:await checkDriveUpload(folderId,date)}}catch(e){return {date,error:e}}}));for(const r of results){checked++;if(r.error){err++;cards.push(`<div class="upload-day err"><strong>${prettyDate(r.date)}</strong><span class="day-state">확인 오류</span></div>`);continue}const d=r.data;if(d&&d.ok&&d.completed){done++;cards.push(`<div class="upload-day done"><strong>${prettyDate(r.date)}</strong><span class="day-state">● 완료</span></div>`)}else if(d&&['DATE_FOLDER_NOT_FOUND','WEEK_FOLDER_NOT_FOUND'].includes(d.reason)){none++;cards.push(`<div class="upload-day none"><strong>${prettyDate(r.date)}</strong><span class="day-state">폴더 없음</span></div>`)}else{missing++;cards.push(`<div class="upload-day missing"><strong>${prettyDate(r.date)}</strong><span class="day-state">● 미업로드</span></div>`)}}paint();await new Promise(r=>setTimeout(r,35))}
}
async function uploadAdmin(user,p,dateValue=localDateKey(),selectedClass=''){
  const records=await Promise.all(CLASSES.map(async c=>{const r=await getDoc(doc(db,'classes',c.id));return {...c,data:r.exists()?r.data():{}}}));
  const cols=[['manualAttendance','수기출석본'],['photos','교육사진'],['recognition','출결인정자료']];
  document.getElementById('adminBody').innerHTML=`<section class="card panel"><div class="admin-note"><strong>Drive 자동 업로드 확인:</strong> 선택한 날짜의 전체 반 현황을 보고, 아래 반 버튼을 누르면 해당 반을 날짜별로 상세 확인할 수 있습니다. 파일은 읽기만 하며 수정하지 않습니다.</div><div class="status-toolbar"><div class="field"><label>전체 현황 확인 날짜</label><input id="uploadDate" type="date" value="${esc(dateValue)}"></div><button id="refreshUploads" class="btn btn-soft">↻ 전체 다시 확인</button><div class="auto-summary"><span id="autoComplete" class="status-pill status-o">완료 0</span><span id="autoIncomplete" class="status-pill status-x">미완료 0</span><span id="autoMissing" class="status-pill status-none">폴더 미설정 0</span><span id="autoError" class="status-pill status-none">오류 0</span></div></div><div class="upload-class-buttons">${CLASSES.map(c=>`<button class="upload-class-btn ${String(c.id)===String(selectedClass)?'active':''}" data-upload-class="${c.id}">${c.id}반</button>`).join('')}</div><div id="uploadClassDetail"></div><div class="table-wrap"><table class="upload-table auto-table"><thead><tr><th>반</th><th>과정 / 교육장</th>${cols.map(x=>`<th>${x[1]}</th>`).join('')}</tr></thead><tbody>${records.map(r=>{const core={...EMPTY,...(r.data.coreLinks||{})};return `<tr><td><button class="btn btn-ghost upload-row-class" data-upload-class="${r.id}" style="padding:7px 10px">${r.id}반</button></td><td>${esc(r.course)}<div class="mini-note">${esc(r.venue)}</div></td>${cols.map(([k])=>`<td>${uploadBadge('2',core[k])}</td>`).join('')}</tr>`}).join('')}</tbody></table></div><div class="mini-note">상세보기: 🟢 완료 = 파일 있음 · 🔴 미업로드 = 날짜 폴더는 있으나 파일 없음 · 회색 = 해당 날짜/WEEK 폴더 없음</div></section>`;
  const openClass=id=>{document.querySelectorAll('[data-upload-class]').forEach(b=>b.classList.toggle('active',String(b.dataset.uploadClass)===String(id)));renderUploadClassDetail(records,String(id),'manualAttendance')};
  document.querySelectorAll('[data-upload-class]').forEach(b=>b.onclick=()=>openClass(b.dataset.uploadClass));
  document.getElementById('uploadDate').onchange=e=>uploadAdmin(user,p,e.target.value,selectedClass);
  document.getElementById('refreshUploads').onclick=()=>refreshUploadBadges(document.getElementById('adminBody'),document.getElementById('uploadDate').value||dateValue);
  await refreshUploadBadges(document.getElementById('adminBody'),dateValue);
  if(selectedClass)openClass(selectedClass);
}
'''

s=s[:start]+new_code+s[end:]
p.write_text(s,encoding='utf-8')
print('patched admin per-class upload detail with folder dropdown')
