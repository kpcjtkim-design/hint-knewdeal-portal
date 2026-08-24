from pathlib import Path
import re

p=Path('index.html')
s=p.read_text(encoding='utf-8')

start=s.find("async function showMissingDatesModal(folderId,label){")
end=s.find("function showGuideModal(){", start)
if start<0 or end<0:
    raise SystemExit('missing-date function not found')

new_func=r'''async function showMissingDatesModal(folderId,label){
  if(!folderId)return;
  let cancelled=false;
  const wrap=document.createElement('div');
  wrap.className='modal-back';
  wrap.innerHTML=`<div class="modal" style="width:min(620px,100%)">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
      <div><h3 style="margin-bottom:6px">${esc(label)} · 미완료 날짜</h3><p class="muted tiny" style="margin:0">실제로 만들어져 있는 날짜 폴더만 확인합니다. 완료될 때까지 잠시 기다려 주세요.</p></div>
      <button id="missingClose" class="btn btn-ghost">닫기</button>
    </div>
    <div id="missingBody" style="margin-top:18px">
      <div style="padding:22px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px"><strong>업로드 현황 확인 중…</strong><span id="missingProgressText" class="tiny muted">준비 중</span></div>
        <div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden"><div id="missingProgressBar" style="height:100%;width:0%;background:#2563eb;transition:width .2s ease"></div></div>
        <div id="missingProgressSub" class="mini-note" style="margin-top:10px">날짜 폴더를 차례대로 확인하고 있습니다.</div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const close=()=>{cancelled=true;wrap.remove()};
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  wrap.querySelector('#missingClose').onclick=close;
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,80)));
  const body=wrap.querySelector('#missingBody'),dates=courseDatesThrough(localDateKey()),missing=[],errors=[];
  let checked=0,existing=0;
  const progress=()=>{
    if(cancelled||!wrap.isConnected)return;
    const pct=dates.length?Math.round(checked/dates.length*100):100;
    wrap.querySelector('#missingProgressText').textContent=`${checked}/${dates.length} · ${pct}%`;
    wrap.querySelector('#missingProgressBar').style.width=`${pct}%`;
    wrap.querySelector('#missingProgressSub').textContent=`확인된 날짜 폴더 ${existing}개 · 미완료 ${missing.length}개${errors.length?` · 오류 ${errors.length}개`:''}`;
  };
  try{
    for(let i=0;i<dates.length&&!cancelled;i+=3){
      const batch=dates.slice(i,i+3);
      const results=await Promise.all(batch.map(async date=>{try{return {date,data:await checkDriveUpload(folderId,date)}}catch(e){return {date,error:e}}}));
      for(const r of results){checked++;if(r.error){errors.push(r.date);continue}if(!dateFolderExistsResult(r.data))continue;existing++;if(!r.data.completed)missing.push(r.date)}
      progress();
      await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,40)));
    }
    if(cancelled||!wrap.isConnected)return;
    if(!missing.length&&!errors.length){body.innerHTML=`<div style="padding:20px;border-radius:14px;background:#f0fdf4;color:#166534;font-weight:900;text-align:center">✓ 현재 존재하는 날짜 폴더는 모두 완료됐습니다.</div><div class="mini-note" style="text-align:center">확인한 날짜 폴더 ${existing}개</div>`;return}
    body.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><span class="status-pill status-x">미완료 ${missing.length}</span><span class="status-pill status-none">날짜 폴더 ${existing}</span>${errors.length?`<span class="status-pill status-none">확인 오류 ${errors.length}</span>`:''}</div>${missing.length?`<div style="display:flex;gap:8px;flex-wrap:wrap">${missing.map(d=>`<span style="padding:9px 11px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:800;font-size:13px">${prettyDate(d)}</span>`).join('')}</div>`:`<div class="muted tiny">미완료 날짜는 없습니다.</div>`}${errors.length?`<div class="mini-note" style="margin-top:14px">확인 오류: ${errors.map(prettyDate).join(', ')}</div>`:''}`;
  }catch(e){if(!cancelled&&wrap.isConnected)body.innerHTML=`<div class="fatal">미완료 날짜를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}
}
'''

s=s[:start]+new_func+s[end:]
old="document.querySelectorAll('.missingDatesBtn').forEach(b=>b.onclick=()=>showMissingDatesModal(b.dataset.folderId,b.dataset.taskLabel));"
new="document.querySelectorAll('.missingDatesBtn').forEach(b=>b.onclick=async()=>{if(b.disabled)return;const t=b.textContent;b.disabled=true;b.textContent='확인 중…';try{await showMissingDatesModal(b.dataset.folderId,b.dataset.taskLabel)}finally{if(document.body.contains(b)){b.disabled=false;b.textContent=t}}});"
if old not in s:
    raise SystemExit('missing-date binding not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('improved missing-date loading UX')
