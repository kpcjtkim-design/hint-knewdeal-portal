from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

if 'CLASS_OVERVIEW_V1' in s:
    print('class overview already patched')
    raise SystemExit(0)

css='''.class-overview{margin-top:14px;padding:16px}.overview-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.overview-head h3{margin:0 0 5px;font-size:16px}.overview-head p{margin:0;color:#64748b;font-size:12px}.overview-summary{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.overview-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}.overview-block{border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;overflow:hidden}.overview-block h4{margin:0;padding:11px 13px;background:#fff;border-bottom:1px solid #e2e8f0;font-size:13px}.overview-list{display:grid;gap:7px;padding:9px;max-height:430px;overflow:auto}.overview-item{padding:10px 11px;background:#fff;border:1px solid #e2e8f0;border-radius:10px}.overview-item-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12px}.overview-item-date{font-weight:900;color:#1d4ed8}.overview-item-name{font-weight:900}.overview-item-status{padding:3px 6px;border-radius:999px;background:#f1f5f9;font-size:10px;font-weight:900}.overview-item-reason{margin-top:5px;color:#475569;font-size:12px;line-height:1.45}.ov-doc-state{display:inline-flex;margin-top:6px;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:900}.ov-doc-state.done{background:#dcfce7;color:#166534}.ov-doc-state.pending{background:#fee2e2;color:#991b1b}.overview-empty{padding:18px 10px;text-align:center;color:#94a3b8;font-size:12px}@media(max-width:900px){.overview-grid{grid-template-columns:1fr}}'''
s=s.replace('</style>',css+'</style>',1)

anchor='<section class="card validation"><h3>자동 교차검증</h3><div id="validationSummary" class="validation-list"><span class="flag">날짜를 선택하면 검증합니다.</span></div></section>'
block='''<section id="classOverview" class="card class-overview"><div class="overview-head"><div><h3>반별 누적 특이출결</h3><p>현재 선택한 반의 인정출석 · 지각/조퇴/외출 · 중복 내역을 전체 날짜에서 한 번에 확인합니다.</p></div><button id="overviewReloadBtn" class="btn soft">↻ 누적현황 다시 읽기</button></div><div id="overviewSummary" class="overview-summary"><span class="flag">반을 불러오면 자동 집계합니다.</span></div><div class="overview-grid"><div class="overview-block"><h4>인정출석</h4><div id="overviewRecognized" class="overview-list"><div class="overview-empty">불러오는 중…</div></div></div><div class="overview-block"><h4>지각 · 조퇴 · 외출</h4><div id="overviewMovement" class="overview-list"><div class="overview-empty">불러오는 중…</div></div></div><div class="overview-block"><h4>중복</h4><div id="overviewDuplicate" class="overview-list"><div class="overview-empty">불러오는 중…</div></div></div></div></section>'''
if anchor not in s:
    raise SystemExit('validation section anchor not found')
s=s.replace(anchor,anchor+block,1)

insert_anchor="function reviewDocId(label){return `attendanceReviewLive_${selectedClass}_${String(label||'').replace(/[^0-9A-Za-z가-힣_-]+/g,'-')}`}"
helpers=r'''// CLASS_OVERVIEW_V1
function overviewItemHtml(x,kind){
  const reason=x.reason||'사유 미기재';
  const doc=kind==='recognized'?`<span class="ov-doc-state ${x.verified?'done':'pending'}" data-ov-date="${esc(x.date)}" data-ov-name="${esc(x.name)}">${x.verified?'✓ 서류 확인':'서류 미확인'}</span>`:'';
  return `<div class="overview-item"><div class="overview-item-top"><span class="overview-item-date">${esc(x.date)}</span><span class="overview-item-name">${esc(x.name)}</span><span class="overview-item-status">${esc(x.status)}</span></div><div class="overview-item-reason">${esc(reason)}</div>${doc}</div>`
}
function syncOverviewDocumentState(name,date,checked){document.querySelectorAll('.ov-doc-state').forEach(el=>{if(el.dataset.ovName===String(name)&&el.dataset.ovDate===String(date)){el.classList.toggle('done',checked);el.classList.toggle('pending',!checked);el.textContent=checked?'✓ 서류 확인':'서류 미확인'}})}
async function loadOverviewReviews(){
  const out=new Map();
  for(let i=0;i<dates.length;i+=8){const batch=dates.slice(i,i+8);const rows=await Promise.all(batch.map(async d=>{try{return [d.label,await loadReview(d.label)]}catch{return [d.label,null]}}));for(const [k,v] of rows)out.set(k,v)}
  return out
}
async function renderClassOverview(){
  const sum=$('#overviewSummary'),a=$('#overviewRecognized'),b=$('#overviewMovement'),c=$('#overviewDuplicate');if(!sum||!a||!b||!c||!dates.length)return;
  sum.innerHTML='<span class="flag">전체 날짜 · Firebase 검수값 포함 집계 중…</span>';a.innerHTML=b.innerHTML=c.innerHTML='<div class="overview-empty">불러오는 중…</div>';
  try{
    const reviews=await loadOverviewReviews(),recognized=[],movement=[],duplicate=[];
    for(const d of dates){const reasonText=reasonCells[d.label]||'',review=reviews.get(d.label),saved=reviewMap(review),verified=verifiedSet(review);for(const st of students){const baseStatus=String(st.all[d.idx]||'').trim()||'미입력',parsed=parseReasonFor(st.name,reasonText,baseStatus),baseReason=parsed.reason||'',ov=saved.get(st.name),status=ov?.status??baseStatus,reason=standardizeReason(ov?.reason??baseReason);const item={date:d.label,name:st.name,status,reason,verified:verified.has(st.name)};if(status==='인정출석')recognized.push(item);else if(['지각','조퇴','외출'].includes(status))movement.push(item);else if(status==='중복')duplicate.push(item)}}
    const empty='<div class="overview-empty">해당 내역이 없습니다.</div>';
    a.innerHTML=recognized.length?recognized.map(x=>overviewItemHtml(x,'recognized')).join(''):empty;
    b.innerHTML=movement.length?movement.map(x=>overviewItemHtml(x,'movement')).join(''):empty;
    c.innerHTML=duplicate.length?duplicate.map(x=>overviewItemHtml(x,'duplicate')).join(''):empty;
    const verifiedCount=recognized.filter(x=>x.verified).length;
    sum.innerHTML=`<span class="flag green">인정출석 ${recognized.length}</span><span class="flag ${recognized.length===verifiedCount?'green':'red'}">서류확인 ${verifiedCount}/${recognized.length}</span><span class="flag yellow">지·조·외 ${movement.length}</span><span class="flag orange">중복 ${duplicate.length}</span>`;
  }catch(e){sum.innerHTML=`<span class="flag red">누적현황 오류 · ${esc(e.message||e)}</span>`;a.innerHTML=b.innerHTML=c.innerHTML='<div class="overview-empty">누적현황을 불러오지 못했습니다.</div>'}
}
'''
if insert_anchor not in s:
    raise SystemExit('reviewDocId anchor not found')
s=s.replace(insert_anchor,helpers+'\n'+insert_anchor,1)

old="if(state)state.textContent=checked?'서류 확인 저장됨':'확인 해제 저장됨';setDirty(dirty)"
new="if(state)state.textContent=checked?'서류 확인 저장됨':'확인 해제 저장됨';syncOverviewDocumentState(x.name,currentLabel,checked);setDirty(dirty)"
if old not in s:
    raise SystemExit('document save anchor not found')
s=s.replace(old,new,1)

old_load="$('#dateSelect').value=preferred;await renderDate(preferred);await refreshFolderLinks();await logView(preferred)}"
new_load="$('#dateSelect').value=preferred;await renderDate(preferred);await refreshFolderLinks();await logView(preferred);renderClassOverview().catch(showError)}"
if old_load not in s:
    raise SystemExit('loadClass anchor not found')
s=s.replace(old_load,new_load,1)

bind_anchor="$('#resetReviewBtn').onclick=()=>resetReview().catch(showError);"
if bind_anchor not in s:
    raise SystemExit('binding anchor not found')
s=s.replace(bind_anchor,bind_anchor+"\n$('#overviewReloadBtn').onclick=()=>renderClassOverview().catch(showError);",1)

p.write_text(s,encoding='utf-8')
print('patched class-wide attendance overview')
