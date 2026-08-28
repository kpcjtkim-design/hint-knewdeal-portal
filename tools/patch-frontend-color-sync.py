from pathlib import Path
p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

# 1. Shared color lookup helper after overviewColorState function block.
anchor="""function overviewColorState(bg){
  let x=String(bg||'').trim().toLowerCase();"""
if anchor not in s:
    raise SystemExit('overviewColorState anchor missing')
# Insert helper before renderClassOverview by replacing exact boundary.
boundary="""}
async function renderClassOverview(){"""
helper="""}
function sheetEvidenceState(student,dateObj,fallback='미제출'){
  if(!student||!dateObj||!Array.isArray(attendanceBackgrounds)||!attendanceBackgrounds.length)return fallback;
  const bg=String(attendanceBackgrounds?.[Number(student.rowIndex)+1]?.[Number(dateObj.idx)+4]||'');
  return overviewColorState(bg);
}
async function renderClassOverview(){"""
if boundary not in s:
    raise SystemExit('renderClassOverview boundary missing')
s=s.replace(boundary,helper,1)

# 2. Overview uses same helper.
old="bg=String(attendanceBackgrounds?.[Number(st.rowIndex)+1]?.[Number(d.idx)+4]||''),docState=overviewColorState(bg)"
new="docState=sheetEvidenceState(st,d,'미제출')"
if old not in s:
    raise SystemExit('overview hardcoded color lookup missing')
s=s.replace(old,new)

# 3. Individual row: sheet color first, Firebase only while color payload has not arrived.
old="""    const docState=docReview.get(s.name)||'미제출';
    const docReviewState=docReview.get(s.name)||'미제출';
    const docHtml=`<div class=\"doc-verify ${status==='인정출석'?'':'hidden'}\" data-doc-wrap=\"${i}\"><label>인정출석 증빙서류 <select class=\"doc-review-select\" data-i=\"${i}\"><option value=\"미제출\" ${docReviewState==='미제출'?'selected':''}>미제출</option><option value=\"확인\" ${docReviewState==='확인'?'selected':''}>확인</option><option value=\"인정불가\" ${docReviewState==='보완필요'?'selected':''}>보완필요</option></select></label><span class=\"doc-save-state\" data-doc-state=\"${i}\">${docReviewState==='미제출'?'선택 시 자동저장':docReviewState+' 저장됨'}</span></div>`;"""
new="""    const firebaseDocState=docReview.get(s.name)||'미제출';
    const docReviewState=sheetEvidenceState(s,d,firebaseDocState);
    const colorAuto=Array.isArray(attendanceBackgrounds)&&attendanceBackgrounds.length>0;
    const docHtml=`<div class=\"doc-verify ${status==='인정출석'?'':'hidden'}\" data-doc-wrap=\"${i}\"><label>인정출석 증빙서류 <select class=\"doc-review-select\" data-i=\"${i}\"><option value=\"미제출\" ${docReviewState==='미제출'?'selected':''}>미제출</option><option value=\"확인\" ${docReviewState==='확인'?'selected':''}>확인</option><option value=\"보완필요\" ${docReviewState==='보완필요'?'selected':''}>보완필요</option></select></label><span class=\"doc-save-state\" data-doc-state=\"${i}\">${colorAuto?'시트 색상 자동반영':(docReviewState==='미제출'?'색상 확인 중':docReviewState+' 저장됨')}</span></div>`;"""
if old not in s:
    raise SystemExit('individual doc state block missing')
s=s.replace(old,new)

# 4. Do not block fast reader. After first render, fetch colors in background then rerender current screen + overview + tools.
old="""await renderDate(preferred);await refreshFolderLinks();await logView(preferred);renderClassOverview().catch(showError);mountReviewTools().catch(showError)}"""
new="""await renderDate(preferred);await refreshFolderLinks();await logView(preferred);renderClassOverview().catch(showError);mountReviewTools().catch(showError);loadAttendanceColors().then(async bg=>{if(Array.isArray(bg)&&bg.length){attendanceBackgrounds=bg;await renderDate(currentLabel||preferred);renderClassOverview().catch(showError);mountReviewTools().catch(showError)}}).catch(()=>{})}"""
if old not in s:
    raise SystemExit('loadClass tail missing')
s=s.replace(old,new)

p.write_text(s,encoding='utf-8')
print('frontend color sync patched')
