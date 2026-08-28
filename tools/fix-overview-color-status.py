from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

old="""async function renderClassOverview(){
  const sum=$('#overviewSummary'),a=$('#overviewRecognized'),b=$('#overviewMovement'),c=$('#overviewDuplicate');if(!sum||!a||!b||!c||!dates.length)return;
  sum.innerHTML='<span class=\"flag\">전체 날짜 · Firebase 검수값 포함 집계 중…</span>';a.innerHTML=b.innerHTML=c.innerHTML='<div class=\"overview-empty\">불러오는 중…</div>';
  try{
    const reviews=await loadOverviewReviews(),recognized=[],movement=[],duplicate=[];
    for(const d of dates){const reasonText=reasonCells[d.label]||'',review=reviews.get(d.label),saved=reviewMap(review),docReview=documentReviewMap(review);for(const st of students){const baseStatus=String(st.all[d.idx]||'').trim()||'미입력',parsed=parseReasonFor(st.name,reasonText,baseStatus),baseReason=parsed.reason||'',ov=saved.get(st.name),status=ov?.status??baseStatus,reason=standardizeReason(ov?.reason??baseReason);const item={date:d.label,name:st.name,status,reason,docState:docReview.get(st.name)||'미제출'};if(status==='인정출석')recognized.push(item);else if(['지각','조퇴','외출'].includes(status))movement.push(item);else if(status==='중복')duplicate.push(item)}}
    const empty='<div class=\"overview-empty\">해당 내역이 없습니다.</div>';
    a.innerHTML=recognized.length?recognized.map(x=>overviewItemHtml(x,'recognized')).join(''):empty;
    b.innerHTML=movement.length?movement.map(x=>overviewItemHtml(x,'movement')).join(''):empty;
    c.innerHTML=duplicate.length?duplicate.map(x=>overviewItemHtml(x,'duplicate')).join(''):empty;
    const verifiedCount=recognized.filter(x=>x.docState==='확인').length,rejectedCount=recognized.filter(x=>x.docState==='보완필요').length,pendingCount=recognized.filter(x=>x.docState==='미제출').length;
    sum.innerHTML=`<span class=\"flag green\">인정출석 ${recognized.length}</span><span class=\"flag green\">확인 ${verifiedCount}</span><span class=\"flag red\">인정불가 ${rejectedCount}</span><span class=\"flag yellow\">미제출 ${pendingCount}</span><span class=\"flag yellow\">지·조·외 ${movement.length}</span><span class=\"flag orange\">중복 ${duplicate.length}</span>`;
  }catch(e){sum.innerHTML=`<span class=\"flag red\">누적현황 오류 · ${esc(e.message||e)}</span>`;a.innerHTML=b.innerHTML=c.innerHTML='<div class=\"overview-empty\">누적현황을 불러오지 못했습니다.</div>'}
}"""

new="""function overviewColorState(bg){
  let x=String(bg||'').trim().toLowerCase();
  if(/^#[0-9a-f]{3}$/.test(x))x='#'+x.slice(1).split('').map(c=>c+c).join('');
  if(!/^#[0-9a-f]{6}$/.test(x))return'미제출';
  const r=parseInt(x.slice(1,3),16),g=parseInt(x.slice(3,5),16),b=parseInt(x.slice(5,7),16);
  if(r>=242&&g>=242&&b>=242)return'미제출';
  if(r>=180&&g>=135&&b<=190&&Math.abs(r-g)<=110&&g>b+20)return'확인';
  if(r>=175&&g<=185&&b<=185&&r>g+25&&r>b+25)return'보완필요';
  return'미제출';
}
async function renderClassOverview(){
  const sum=$('#overviewSummary'),a=$('#overviewRecognized'),b=$('#overviewMovement'),c=$('#overviewDuplicate');if(!sum||!a||!b||!c||!dates.length)return;
  sum.innerHTML='<span class=\"flag\">전체 날짜 · 시트 색상 포함 집계 중…</span>';a.innerHTML=b.innerHTML=c.innerHTML='<div class=\"overview-empty\">불러오는 중…</div>';
  try{
    if(!attendanceBackgrounds.length)attendanceBackgrounds=await loadAttendanceColors();
    const reviews=await loadOverviewReviews(),recognized=[],movement=[],duplicate=[];
    for(const d of dates){const reasonText=reasonCells[d.label]||'',review=reviews.get(d.label),saved=reviewMap(review);for(const st of students){const baseStatus=String(st.all[d.idx]||'').trim()||'미입력',parsed=parseReasonFor(st.name,reasonText,baseStatus),baseReason=parsed.reason||'',ov=saved.get(st.name),status=ov?.status??baseStatus,reason=standardizeReason(ov?.reason??baseReason),bg=String(attendanceBackgrounds?.[Number(st.rowIndex)+1]?.[Number(d.idx)+4]||''),docState=overviewColorState(bg);const item={date:d.label,name:st.name,status,reason,docState};if(status==='인정출석')recognized.push(item);else if(['지각','조퇴','외출'].includes(status))movement.push(item);else if(status==='중복')duplicate.push(item)}}
    const empty='<div class=\"overview-empty\">해당 내역이 없습니다.</div>';
    a.innerHTML=recognized.length?recognized.map(x=>overviewItemHtml(x,'recognized')).join(''):empty;
    b.innerHTML=movement.length?movement.map(x=>overviewItemHtml(x,'movement')).join(''):empty;
    c.innerHTML=duplicate.length?duplicate.map(x=>overviewItemHtml(x,'duplicate')).join(''):empty;
    const verifiedCount=recognized.filter(x=>x.docState==='확인').length,rejectedCount=recognized.filter(x=>x.docState==='보완필요').length,pendingCount=recognized.filter(x=>x.docState==='미제출').length;
    sum.innerHTML=`<span class=\"flag green\">인정출석 ${recognized.length}</span><span class=\"flag green\">확인 ${verifiedCount}</span><span class=\"flag red\">보완필요 ${rejectedCount}</span><span class=\"flag yellow\">미제출 ${pendingCount}</span><span class=\"flag yellow\">지·조·외 ${movement.length}</span><span class=\"flag orange\">중복 ${duplicate.length}</span>`;
  }catch(e){sum.innerHTML=`<span class=\"flag red\">누적현황 오류 · ${esc(e.message||e)}</span>`;a.innerHTML=b.innerHTML=c.innerHTML='<div class=\"overview-empty\">누적현황을 불러오지 못했습니다.</div>'}
}"""

if old not in s:
    raise SystemExit('overview anchor not found')
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('patched overview color status')
