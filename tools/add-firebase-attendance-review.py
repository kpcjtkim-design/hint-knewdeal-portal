from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

# CSS for editable Firebase-only review UI.
css_anchor='.loading{padding:34px;text-align:center;color:#475569;font-weight:800}'
css_add=css_anchor+'.edit-status,.edit-reason{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:9px 10px;background:#fff;font:inherit}.edit-reason{min-height:40px}.savebar{position:sticky;bottom:12px;margin-top:14px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;z-index:5}.save-meta{font-size:12px;color:#64748b;margin-top:4px}.firebase-mark{display:inline-flex;margin-left:6px;padding:3px 6px;border-radius:999px;background:#ede9fe;color:#6d28d9;font-size:10px;font-weight:900}'
if '.edit-status{' not in s:
    if css_anchor not in s: raise SystemExit('css anchor missing')
    s=s.replace(css_anchor,css_add,1)

# Clarify notice.
s=s.replace('이 테스트는 HINT TEST 사본에 대해 <b>Google Sheets 읽기 전용 권한</b>만 요청합니다. 시트 저장·수정·삭제 코드는 없습니다. 조회한 반/날짜는 Firebase 반 문서에 마지막 검수 기록으로 남깁니다.','이 테스트는 HINT TEST 사본에 대해 <b>Google Sheets 읽기 전용 권한</b>만 요청합니다. <b>수정·저장은 Google Sheet가 아니라 Firebase 검수 DB에만</b> 반영됩니다. 시트 자체를 수정·삭제하는 코드는 없습니다.')

# Save bar under rows.
rows_anchor='<section class="card" style="margin-top:14px"><div id="rows" class="rows"><div class="empty">반과 날짜를 선택해 주세요.</div></div></section>'
savebar=rows_anchor+'\n<section class="card savebar"><div><b id="dirtyText">Firebase 수정 없음</b><div id="saveMeta" class="save-meta">시트값을 기준으로 표시합니다.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="resetReviewBtn" class="btn soft" disabled>Firebase 수정값 초기화</button><button id="saveReviewBtn" class="btn primary" disabled>Firebase에 검수 저장</button></div></section>'
if 'id="saveReviewBtn"' not in s:
    if rows_anchor not in s: raise SystemExit('rows anchor missing')
    s=s.replace(rows_anchor,savebar,1)

# Add editor state.
old="let token='',email='',selectedClass='1',dates=[],students=[],reasonCells={};"
new="let token='',email='',selectedClass='1',dates=[],students=[],reasonCells={},currentLabel='',editRows=[],dirty=false,currentReview=null;"
if old in s: s=s.replace(old,new,1)

# Helper functions before normalizeDate.
anchor="function normalizeDate(v){return String(v||'').trim()}"
helpers=r'''function reviewDocId(label){return `attendanceReview_${selectedClass}_${String(label||'').replace(/[^0-9A-Za-z가-힣_-]+/g,'-')}`}
async function loadReview(label){const r=await getDoc(doc(db,'settings',reviewDocId(label)));return r.exists()?r.data():null}
function reviewMap(review){const m=new Map();for(const x of (review?.overrides||[]))if(x?.name)m.set(String(x.name),x);return m}
function setDirty(v=true){dirty=v;const b=$('#saveReviewBtn'),r=$('#resetReviewBtn');if(b)b.disabled=!dirty;if(r)r.disabled=!currentReview?.overrides?.length;const t=$('#dirtyText');if(t)t.textContent=dirty?'저장하지 않은 Firebase 수정 있음':'Firebase 수정 없음'}
function recalcSummary(){let p=0,a=0,e=0;for(const x of editRows){if(x.status==='출석')p++;else if(x.status==='결석')a++;else if(x.status&&x.status!=='해당없음'&&x.status!=='미입력')e++}$('#sumPresent').textContent=`출석 ${p}`;$('#sumAbsent').textContent=`결석 ${a}`;$('#sumEtc').textContent=`기타 ${e}`}
function bindEditors(){document.querySelectorAll('.edit-status').forEach(el=>el.onchange=()=>{const x=editRows[+el.dataset.i];x.status=el.value;if(x.status==='출석'&&x.reason===x.baseReason)x.reason='';setDirty();recalcSummary()});document.querySelectorAll('.edit-reason').forEach(el=>el.oninput=()=>{editRows[+el.dataset.i].reason=el.value;setDirty()})}
async function saveReview(){if(!currentLabel)return;const overrides=editRows.filter(x=>x.status!==x.baseStatus||String(x.reason||'')!==String(x.baseReason||'')).map(x=>({name:x.name,status:x.status,reason:String(x.reason||'').trim()}));$('#saveReviewBtn').disabled=true;$('#saveReviewBtn').textContent='Firebase 저장 중...';try{await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_TEST',source:'HINT TEST',classId:selectedClass,date:currentLabel,overrides,reviewer:email,updatedAt:serverTimestamp()},{merge:false});currentReview={overrides,reviewer:email};dirty=false;setDirty(false);$('#saveMeta').textContent=`Firebase 저장 완료 · 수정 ${overrides.length}명 · ${email}`;await logView(currentLabel)}catch(e){showError(e)}finally{$('#saveReviewBtn').textContent='Firebase에 검수 저장';$('#saveReviewBtn').disabled=!dirty}}
async function resetReview(){if(!currentLabel||!confirm('이 날짜의 Firebase 관리자 수정값을 모두 비우고 시트 기준으로 되돌릴까요?'))return;await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_TEST',source:'HINT TEST',classId:selectedClass,date:currentLabel,overrides:[],reviewer:email,updatedAt:serverTimestamp()},{merge:false});currentReview={overrides:[],reviewer:email};await renderDate(currentLabel)}
'''+anchor
if 'function reviewDocId(' not in s:
    if anchor not in s: raise SystemExit('normalizeDate anchor missing')
    s=s.replace(anchor,helpers,1)

# loadClass awaits async render.
s=s.replace("$('#dateSelect').value=preferred;renderDate(preferred);await logView(preferred)","$('#dateSelect').value=preferred;await renderDate(preferred);await logView(preferred)",1)

# Replace renderDate with Firebase overlay/editor.
start=s.find('function renderDate(label){')
end=s.find("\n$('#loginBtn').onclick",start)
if start<0 or end<0: raise SystemExit('renderDate block missing')
render=r'''async function renderDate(label){
  currentLabel=label;const d=dates.find(x=>x.label===label);if(!d){$('#rows').innerHTML='<div class="empty">해당 날짜를 찾지 못했습니다.</div>';return}
  const reasonText=reasonCells[label]||'';currentReview=await loadReview(label);const saved=reviewMap(currentReview);editRows=[];
  $('#rows').innerHTML=students.map((s,i)=>{
    const baseStatus=String(s.all[d.idx]||'').trim()||'미입력',parsed=parseReasonFor(s.name,reasonText,baseStatus),baseReason=parsed.reason||'',ov=saved.get(s.name);
    const status=ov?.status??baseStatus,reason=ov?.reason??baseReason;editRows.push({name:s.name,baseStatus,baseReason,status,reason});
    const options=['출석','결석','지각','조퇴','외출','인정출석','인정결석','해당없음','미입력'];
    return `<div class="student"><div class="name">${esc(s.name)}${ov?'<span class="firebase-mark">Firebase 수정</span>':''}</div><div><select class="edit-status" data-i="${i}">${options.map(x=>`<option value="${esc(x)}" ${status===x?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div><input class="edit-reason" data-i="${i}" value="${esc(reason)}" placeholder="사유 없음 / 직접 수정 가능"><div class="save-meta">시트 기준: ${esc(baseStatus)}${baseReason?' · '+esc(baseReason):''}${parsed.method&&parsed.method!=='none'?' · '+esc(parsed.method):''}</div></div></div>`
  }).join('')||'<div class="empty">교육생을 찾지 못했습니다.</div>';
  $('#rawReason').textContent=reasonText||'가-3 사유 없음';bindEditors();dirty=false;setDirty(false);recalcSummary();
  $('#saveMeta').textContent=currentReview?.overrides?.length?`Firebase 수정 ${currentReview.overrides.length}명 저장됨 · ${currentReview.reviewer||'관리자'}`:'Firebase 수정값 없음 · 시트 기준 표시';
}
'''
s=s[:start]+render+s[end:]

# Wire date changes + save/reset.
s=s.replace("$('#dateSelect').onchange=e=>{renderDate(e.target.value);logView(e.target.value)};","$('#dateSelect').onchange=async e=>{if(dirty&&!confirm('저장하지 않은 Firebase 수정이 있습니다. 날짜를 바꿀까요?')){e.target.value=currentLabel;return}await renderDate(e.target.value);await logView(e.target.value)};",1)
s=s.replace("$('#reloadBtn').onclick=()=>loadClass(selectedClass).catch(showError);","$('#reloadBtn').onclick=()=>{if(!dirty||confirm('저장하지 않은 Firebase 수정을 버리고 다시 읽을까요?'))loadClass(selectedClass).catch(showError)};\n$('#saveReviewBtn').onclick=()=>saveReview();\n$('#resetReviewBtn').onclick=()=>resetReview().catch(showError);",1)

p.write_text(s,encoding='utf-8')
print('patched Firebase-only attendance review editor')
