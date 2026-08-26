from pathlib import Path
import re

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

# 1) Remove 인정결석 from selectable/validated statuses and normalize any legacy/raw value to 중복.
if 'function normalizeAttendanceStatus(' not in s:
    anchor="function normalizeDate(v){return String(v||'').trim()}"
    helper="function normalizeAttendanceStatus(v){const x=String(v||'').trim();return x==='인정결석'?'중복':x}"
    if anchor not in s: raise SystemExit('normalizeDate anchor not found')
    s=s.replace(anchor,helper+'\n'+anchor,1)

s=s.replace("const baseStatus=String(s.all[d.idx]||'').trim()||'미입력'", "const baseStatus=normalizeAttendanceStatus(String(s.all[d.idx]||'').trim()||'미입력')")
s=s.replace("const status=String(st.all[d.idx]||'').trim();if(!abnormal.has(status))continue;", "const status=normalizeAttendanceStatus(String(st.all[d.idx]||'').trim());if(!abnormal.has(status))continue;")
s=s.replace("const abnormal=new Set(['결석','지각','조퇴','외출','인정출석','인정결석','중복']);", "const abnormal=new Set(['결석','지각','조퇴','외출','인정출석','중복']);")
s=s.replace("const f=[],need=['결석','지각','조퇴','외출','인정출석','인정결석'].includes(status);", "const f=[],need=['결석','지각','조퇴','외출','인정출석','중복'].includes(status);")

old_opts="const options=['출석','결석','지각','조퇴','외출','인정출석','인정결석','해당없음','미입력'];"
new_opts="const options=[['출석','출석'],['결석','결석'],['지각','지각'],['조퇴','조퇴'],['외출','외출'],['인정출석','인정출석'],['중복','중복(지각+조퇴+외출)'],['해당없음','해당없음'],['미입력','미입력']];"
if old_opts in s: s=s.replace(old_opts,new_opts,1)
s=s.replace("${options.map(x=>`<option value=\"${esc(x)}\" ${status===x?'selected':''}>${esc(x)}</option>`).join('')}", "${options.map(([v,l])=>`<option value=\"${esc(v)}\" ${status===v?'selected':''}>${esc(l)}</option>`).join('')}")

# 2) Three-state 인정출석 document review. Backward compatible with legacy documentVerified array.
old_verified="function verifiedSet(review){return new Set((review?.documentVerified||[]).map(String))}"
new_verified="""function documentReviewMap(review){const m=new Map();for(const [name,state] of Object.entries(review?.documentReview||{}))m.set(String(name),String(state||'미확인'));for(const name of (review?.documentVerified||[]))if(!m.has(String(name)))m.set(String(name),'확인');return m}\nfunction documentState(review,name){return documentReviewMap(review).get(String(name))||'미확인'}\nfunction verifiedSet(review){return new Set([...documentReviewMap(review)].filter(([,v])=>v==='확인').map(([k])=>k))}"""
if old_verified in s: s=s.replace(old_verified,new_verified,1)

s=re.sub(
    r"async function saveDocumentVerification\(i,checked,el\)\{.*?\n\}",
    """async function saveDocumentReview(i,state,el){const x=editRows[i];if(!x||!currentLabel)return;const next=documentReviewMap(currentReview);const value=['확인','인정불가','미확인'].includes(state)?state:'미확인';if(value==='미확인')next.delete(x.name);else next.set(x.name,value);const stateEl=document.querySelector(`[data-doc-state=\\\"${i}\\\"]`);if(el)el.disabled=true;if(stateEl)stateEl.textContent='저장 중…';try{const documentReview=Object.fromEntries([...next].sort((a,b)=>a[0].localeCompare(b[0],'ko')));const documentVerified=Object.entries(documentReview).filter(([,v])=>v==='확인').map(([k])=>k);await setDoc(doc(db,'settings',reviewDocId(currentLabel)),{type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY',classId:selectedClass,date:currentLabel,documentReview,documentVerified,documentVerifier:email,documentVerifiedAt:serverTimestamp()},{merge:true});currentReview={...(currentReview||{}),documentReview,documentVerified};if(stateEl)stateEl.textContent=value==='확인'?'확인 저장됨':value==='인정불가'?'인정불가 저장됨':'미확인 저장됨';syncOverviewDocumentState(x.name,currentLabel,value);setDirty(dirty)}catch(e){if(stateEl)stateEl.textContent='저장 실패';throw e}finally{if(el)el.disabled=false}}""",
    s, count=1, flags=re.S
)

s=s.replace("document.querySelectorAll('.doc-verify-check').forEach(el=>el.onchange=()=>saveDocumentVerification(+el.dataset.i,el.checked,el).catch(showError));", "document.querySelectorAll('.doc-review-select').forEach(el=>el.onchange=()=>saveDocumentReview(+el.dataset.i,el.value,el).catch(showError));")

s=s.replace("const saved=reviewMap(currentReview),verified=verifiedSet(currentReview);editRows=[];const validationRows=[];", "const saved=reviewMap(currentReview),docReview=documentReviewMap(currentReview);editRows=[];const validationRows=[];")
old_doc=re.compile(r"const docHtml=`<div class=\\\"doc-verify \$\{status==='인정출석'\?'':'hidden'\}\\\" data-doc-wrap=\\\"\$\{i\}\\\"><label><input type=\\\"checkbox\\\" class=\\\"doc-verify-check\\\" data-i=\\\"\$\{i\}\\\" \$\{verified\.has\(s\.name\)\?'checked':''\}> 인정출석 증빙서류 확인</label><span class=\\\"doc-save-state\\\" data-doc-state=\\\"\$\{i\}\\\">\$\{verified\.has\(s\.name\)\?'확인 저장됨':'체크 시 자동저장'\}</span></div>`;")
new_doc="const docReviewState=docReview.get(s.name)||'미확인';\n    const docHtml=`<div class=\"doc-verify ${status==='인정출석'?'':'hidden'}\" data-doc-wrap=\"${i}\"><label>인정출석 증빙서류 <select class=\"doc-review-select\" data-i=\"${i}\"><option value=\"미확인\" ${docReviewState==='미확인'?'selected':''}>미확인</option><option value=\"확인\" ${docReviewState==='확인'?'selected':''}>확인</option><option value=\"인정불가\" ${docReviewState==='인정불가'?'selected':''}>인정불가</option></select></label><span class=\"doc-save-state\" data-doc-state=\"${i}\">${docReviewState==='미확인'?'선택 시 자동저장':docReviewState+' 저장됨'}</span></div>`;"
if old_doc.search(s): s=old_doc.sub(new_doc,s,count=1)
else:
    s=re.sub(r"\s*const docHtml=`<div class=\"doc-verify .*?</div>`;", "\n    "+new_doc, s, count=1, flags=re.S)

s=s.replace(".doc-verify input{width:16px;height:16px}", ".doc-verify input{width:16px;height:16px}.doc-verify select{border:1px solid #86efac;border-radius:8px;padding:6px 8px;background:#fff;font-weight:900;color:#166534}")

# 3) Overview: show three-state status.
s=s.replace("const doc=kind==='recognized'?`<span class=\"ov-doc-state ${x.verified?'done':'pending'}\" data-ov-date=\"${esc(x.date)}\" data-ov-name=\"${esc(x.name)}\">${x.verified?'✓ 서류 확인':'서류 미확인'}</span>`:'';", "const ds=x.docState||'미확인',doc=kind==='recognized'?`<span class=\"ov-doc-state ${ds==='확인'?'done':ds==='인정불가'?'rejected':'pending'}\" data-ov-date=\"${esc(x.date)}\" data-ov-name=\"${esc(x.name)}\">${ds==='확인'?'✓ 확인':ds==='인정불가'?'인정불가':'미확인'}</span>`:'';")
s=s.replace("function syncOverviewDocumentState(name,date,checked){document.querySelectorAll('.ov-doc-state').forEach(el=>{if(el.dataset.ovName===String(name)&&el.dataset.ovDate===String(date)){el.classList.toggle('done',checked);el.classList.toggle('pending',!checked);el.textContent=checked?'✓ 서류 확인':'서류 미확인'}})}", "function syncOverviewDocumentState(name,date,state){document.querySelectorAll('.ov-doc-state').forEach(el=>{if(el.dataset.ovName===String(name)&&el.dataset.ovDate===String(date)){el.classList.toggle('done',state==='확인');el.classList.toggle('rejected',state==='인정불가');el.classList.toggle('pending',state==='미확인');el.textContent=state==='확인'?'✓ 확인':state==='인정불가'?'인정불가':'미확인'}})}")
s=s.replace(".ov-doc-state.pending{background:#fee2e2;color:#991b1b}", ".ov-doc-state.pending{background:#fef3c7;color:#92400e}.ov-doc-state.rejected{background:#fee2e2;color:#991b1b}")
s=s.replace("review=reviews.get(d.label),saved=reviewMap(review),verified=verifiedSet(review);", "review=reviews.get(d.label),saved=reviewMap(review),docReview=documentReviewMap(review);")
s=s.replace("const item={date:d.label,name:st.name,status,reason,verified:verified.has(st.name)};", "const item={date:d.label,name:st.name,status,reason,docState:docReview.get(st.name)||'미확인'};")
s=s.replace("const verifiedCount=recognized.filter(x=>x.verified).length;", "const verifiedCount=recognized.filter(x=>x.docState==='확인').length,rejectedCount=recognized.filter(x=>x.docState==='인정불가').length,pendingCount=recognized.filter(x=>x.docState==='미확인').length;")
s=s.replace("<span class=\"flag ${recognized.length===verifiedCount?'green':'red'}\">서류확인 ${verifiedCount}/${recognized.length}</span>", "<span class=\"flag green\">확인 ${verifiedCount}</span><span class=\"flag red\">인정불가 ${rejectedCount}</span><span class=\"flag yellow\">미확인 ${pendingCount}</span>")

# 4) Save/reset preserve three-state object.
s=s.replace("const overrides=editRows.filter(x=>x.status!==x.baseStatus||String(x.reason||'')!==String(x.baseReason||'')).map(x=>({name:x.name,status:x.status,reason:String(x.reason||'').trim()})),documentVerified=currentReview?.documentVerified||[];", "const overrides=editRows.filter(x=>x.status!==x.baseStatus||String(x.reason||'')!==String(x.baseReason||'')).map(x=>({name:x.name,status:x.status,reason:String(x.reason||'').trim()})),documentReview=currentReview?.documentReview||{},documentVerified=Object.entries(documentReview).filter(([,v])=>v==='확인').map(([k])=>k);")
s=s.replace("overrides,documentVerified,reviewer:email", "overrides,documentReview,documentVerified,reviewer:email")
s=s.replace("currentReview={overrides,documentVerified,reviewer:email};", "currentReview={overrides,documentReview,documentVerified,reviewer:email};")
s=s.replace("서류확인 ${documentVerified.length}명", "서류 확인 ${documentVerified.length}명")
s=s.replace("overrides:[],documentVerified:[],reviewer:email", "overrides:[],documentReview:{},documentVerified:[],reviewer:email")
s=s.replace("currentReview={overrides:[],documentVerified:[],reviewer:email};", "currentReview={overrides:[],documentReview:{},documentVerified:[],reviewer:email};")
s=s.replace("currentReview?.overrides?.length||currentReview?.documentVerified?.length", "currentReview?.overrides?.length||Object.keys(currentReview?.documentReview||{}).length||currentReview?.documentVerified?.length")

s=s.replace("${docHtml}${docHtml}${flagHtml}", "${docHtml}${flagHtml}")

p.write_text(s,encoding='utf-8')
print('patched attendance statuses and three-state document review')
