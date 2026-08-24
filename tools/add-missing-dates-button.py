from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = "const taskButtons=(num,u,label)=>String(num)==='2'?`<div class=\"task-actions\">${button(u,label)}<button type=\"button\" class=\"btn btn-soft guideBtn\">스캔하는 법</button></div>`:button(u,label);"
new = """const TASK_LABELS={'2':'수기출석본','3':'교육사진','5':'출결인정자료'};
const taskButtons=(num,u,label)=>{const n=String(num),id=driveFolderId(u),history=['2','3','5'].includes(n)?`<button type=\"button\" class=\"btn btn-ghost missingDatesBtn\" data-folder-id=\"${esc(id)}\" data-task-label=\"${esc(TASK_LABELS[n]||'업로드')}\" ${id?'':'disabled'}>미완료 날짜 보기</button>`:'';if(n==='2')return `<div class=\"task-actions\">${button(u,label)}<button type=\"button\" class=\"btn btn-soft guideBtn\">스캔하는 법</button>${history}</div>`;if(history)return `<div class=\"task-actions\">${button(u,label)}${history}</div>`;return button(u,label)};"""
if old not in s:
    raise SystemExit('taskButtons anchor not found')
s = s.replace(old, new, 1)

anchor = "function showGuideModal(){const wrap=document.createElement('div');wrap.className='modal-back';"
pos = s.find(anchor)
if pos < 0:
    raise SystemExit('showGuideModal anchor not found')
# insert missing-date helpers immediately before showGuideModal
helpers = r'''const COURSE_START='2026-07-27',COURSE_END='2026-10-22';
const COURSE_HOLIDAYS=new Set(['2026-08-17','2026-09-24','2026-09-25','2026-10-05','2026-10-09']);
function courseDatesThrough(endKey=localDateKey()){const end=endKey<COURSE_END?endKey:COURSE_END,out=[];let d=new Date(COURSE_START+'T00:00:00Z');const stop=new Date(end+'T00:00:00Z');while(d<=stop){const key=d.toISOString().slice(0,10),day=d.getUTCDay();if(day!==0&&day!==6&&!COURSE_HOLIDAYS.has(key))out.push(key);d.setUTCDate(d.getUTCDate()+1)}return out}
function prettyDate(key){const d=new Date(key+'T00:00:00Z'),days=['일','월','화','수','목','금','토'];return `${Number(key.slice(5,7))}/${Number(key.slice(8,10))}(${days[d.getUTCDay()]})`}
async function showMissingDatesModal(folderId,label){if(!folderId)return;const wrap=document.createElement('div');wrap.className='modal-back';wrap.innerHTML=`<div class="modal" style="width:min(600px,100%)"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h3 style="margin-bottom:6px">${esc(label)} · 미완료 날짜</h3><p class="muted tiny" style="margin:0">교육 시작일부터 오늘까지 파일 업로드 여부를 확인합니다.</p></div><button id="missingClose" class="btn btn-ghost">닫기</button></div><div id="missingBody" style="margin-top:18px"><div class="empty">확인 중…</div></div></div>`;document.body.appendChild(wrap);const close=()=>wrap.remove();wrap.addEventListener('click',e=>{if(e.target===wrap)close()});wrap.querySelector('#missingClose').onclick=close;const body=wrap.querySelector('#missingBody'),dates=courseDatesThrough(localDateKey()),missing=[],errors=[];let checked=0;try{for(let i=0;i<dates.length;i+=5){const batch=dates.slice(i,i+5);const results=await Promise.all(batch.map(async date=>{try{return {date,data:await checkDriveUpload(folderId,date)}}catch(e){return {date,error:e}}}));for(const r of results){checked++;if(r.error)errors.push(r.date);else if(!(r.data&&r.data.ok&&r.data.completed))missing.push(r.date)}body.innerHTML=`<div class="empty">확인 중… ${checked}/${dates.length}</div>`}if(!missing.length&&!errors.length){body.innerHTML=`<div style="padding:20px;border-radius:14px;background:#f0fdf4;color:#166534;font-weight:900;text-align:center">✓ 현재까지 미완료 날짜가 없습니다.</div>`;return}body.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><span class="status-pill status-x">미완료 ${missing.length}</span>${errors.length?`<span class="status-pill status-none">확인 오류 ${errors.length}</span>`:''}</div>${missing.length?`<div style="display:flex;gap:8px;flex-wrap:wrap">${missing.map(d=>`<span style="padding:9px 11px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:800;font-size:13px">${prettyDate(d)}</span>`).join('')}</div>`:`<div class="muted tiny">미완료 날짜는 없습니다.</div>`}${errors.length?`<div class="mini-note" style="margin-top:14px">확인 오류: ${errors.map(prettyDate).join(', ')}</div>`:''}`;}catch(e){body.innerHTML=`<div class="fatal">미완료 날짜를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}}
'''
s = s[:pos] + helpers + s[pos:]

old_bind = "document.querySelectorAll('.guideBtn').forEach(b=>b.onclick=showGuideModal);refreshUploadBadges(document,localDateKey());"
new_bind = "document.querySelectorAll('.guideBtn').forEach(b=>b.onclick=showGuideModal);document.querySelectorAll('.missingDatesBtn').forEach(b=>b.onclick=()=>showMissingDatesModal(b.dataset.folderId,b.dataset.taskLabel));refreshUploadBadges(document,localDateKey());"
if old_bind not in s:
    raise SystemExit('teacher button binding anchor not found')
s = s.replace(old_bind, new_bind, 1)

p.write_text(s, encoding='utf-8')
print('patched missing-date buttons')
