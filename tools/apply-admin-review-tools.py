from pathlib import Path
import re

att=Path('attendance-test.html')
s=att.read_text(encoding='utf-8')
# Hold the unfinished upload feature: remove admin upload UI/runtime.
s=re.sub(r'<button id="recognitionUploadToggle"[^>]*>.*?</button>','',s,count=1,flags=re.S)
s=re.sub(r'<section id="recognitionUploadCard".*?</section>\n','',s,count=1,flags=re.S)
s=re.sub(r'// RECOGNITION_UPLOAD_UI_V1.*?\nfunction verifiedSet', 'function verifiedSet', s, count=1, flags=re.S)
s=re.sub(r"\$\('#recognitionUploadToggle'\).*?submitRecognitionUpload\(\)\.catch\(showError\);",'',s,count=1,flags=re.S)
s=s.replace("await renderDate(e.target.value);await refreshFolderLinks();await refreshRecognitionUploadPanel();await logView(e.target.value)","await renderDate(e.target.value);await refreshFolderLinks();await logView(e.target.value)")
# Requested terminology; legacy unstored/default values now read as 미제출.
s=s.replace('미확인','미제출')
# Import reusable native review tools in standalone test page.
imp="import {mountAdminReviewTools} from '/admin-review-tools.js';\n"
anchor="import {getFirestore,doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';\n"
if imp not in s:
    s=s.replace(anchor,anchor+imp,1)
# Add native review tool host under class overview.
host='<section id="adminReviewToolsHost"></section>\n'
anchor2='</div></section>\n<section class="card" style="margin-top:14px"><div id="rows"'
if host not in s:
    s=s.replace(anchor2,'</div></section>\n'+host+'<section class="card" style="margin-top:14px"><div id="rows"',1)
# Fix missing overview renderer.
fn="""function overviewItemHtml(x,type){
  const ds=x.docState==='확인'?'done':x.docState==='인정불가'?'rejected':'pending';
  const doc=type==='recognized'?`<span class=\"ov-doc-state ${ds}\" data-ov-name=\"${esc(x.name)}\" data-ov-date=\"${esc(x.date)}\">${x.docState==='확인'?'✓ 확인':x.docState==='인정불가'?'인정불가':'미제출'}</span>`:'';
  return `<div class=\"overview-item\"><div class=\"overview-item-top\"><span class=\"overview-item-date\">${esc(x.date)}</span><span class=\"overview-item-name\">${esc(x.name)}</span><span class=\"overview-item-status\">${esc(x.status)}</span></div><div class=\"overview-item-reason\">${esc(x.reason||'사유 미기재')}</div>${doc}</div>`
}
"""
if 'function overviewItemHtml(' not in s:
    s=s.replace('async function renderClassOverview(){',fn+'async function renderClassOverview(){',1)
# Mount the two review tools after class data is loaded.
helper="""async function mountReviewTools(){const host=$('#adminReviewToolsHost'),user=auth.currentUser;if(!host||!user)return;await mountAdminReviewTools(host,{auth,db,user,getState:()=>({selectedClass,currentLabel,dates,students,reasonCells}),parseReasonFor,standardizeReason,normalizeAttendanceStatus})}
"""
if 'async function mountReviewTools()' not in s:
    s=s.replace('async function loadOverviewReviews(){',helper+'async function loadOverviewReviews(){',1)
s=s.replace('renderClassOverview().catch(showError)}','renderClassOverview().catch(showError);mountReviewTools().catch(showError)}',1)
att.write_text(s,encoding='utf-8')

# Remove the paused teacher upload UI from main portal.
idx=Path('index.html')
p=idx.read_text(encoding='utf-8')
p=re.sub(r'// TEACHER_RECOGNITION_UPLOAD_V1.*?\nasync function teacherView', 'async function teacherView', p, count=1, flags=re.S)
p=p.replace("${taskButtons(t[0],t[3],t[4])}${String(t[0])==='5'?`<button class=\"btn btn-primary recognitionUploadToggle\" style=\"margin-top:8px\">자료 업로드</button>`:''}","${taskButtons(t[0],t[3],t[4])}")
p=p.replace('<div id="teacherRecognitionUploadHost"></div>','')
p=re.sub(r"document\.querySelectorAll\('\.recognitionUploadToggle'\).*?;document\.querySelectorAll\('\.guideBtn'\)","document.querySelectorAll('.guideBtn')",p,count=1,flags=re.S)
idx.write_text(p,encoding='utf-8')

# Native builder imports the same review module used by the standalone page.
b=Path('tools/build-native-attendance.py')
bp=b.read_text(encoding='utf-8')
needle='"import {doc,getDoc,setDoc,serverTimestamp} from \'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js\';\\n"\n'
addition='"import {mountAdminReviewTools} from \'/admin-review-tools.js\';\\n"\n'
if addition not in bp:
    bp=bp.replace(needle,needle+'+ '+addition,1)
b.write_text(bp,encoding='utf-8')
print('applied admin review tools, fixed overview renderer, paused upload UI')
