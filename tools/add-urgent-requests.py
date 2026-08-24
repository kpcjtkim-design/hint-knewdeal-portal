from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

# 1) CSS: prominent, persistent urgent banners
css_anchor='.auto-table th:nth-child(1),.auto-table td:nth-child(1),.auto-table th:nth-child(2),.auto-table td:nth-child(2){text-align:left}'
css_add='''.auto-table th:nth-child(1),.auto-table td:nth-child(1),.auto-table th:nth-child(2),.auto-table td:nth-child(2){text-align:left}.urgent-stack{display:grid;gap:10px;margin-bottom:16px}.urgent-alert{border-radius:16px;padding:17px 19px;border:2px solid;font-weight:800;box-shadow:0 7px 20px rgba(127,29,29,.10)}.urgent-alert strong{display:block;font-size:15px;margin-bottom:7px}.urgent-alert .urgent-text{white-space:pre-wrap;line-height:1.65;font-size:14px}.urgent-common{background:#fff1f2;border-color:#e11d48;color:#881337}.urgent-class{background:#fff7ed;border-color:#f97316;color:#9a3412}.urgent-admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.urgent-box{padding:18px;border:1px solid #e2e8f0;border-radius:15px;background:#f8fafc}.urgent-box h3{margin:0 0 5px}.urgent-box textarea{width:100%;min-height:145px;border:1px solid #cbd5e1;border-radius:11px;padding:11px 12px;margin-top:10px}.urgent-toggle{display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px;font-weight:800}@media(max-width:680px){.urgent-admin-grid{grid-template-columns:1fr}}'''
if css_anchor in s and '.urgent-stack{' not in s:
    s=s.replace(css_anchor,css_add,1)

# 2) Add urgent HTML to teacher view immediately above MY CLASS hero
teacher_anchor=",docReq=core.documentRequest||settings.documentRequest;const tasks="
if teacher_anchor in s and 'const urgentHtml=' not in s:
    urgent_expr=",docReq=core.documentRequest||settings.documentRequest;const urgentHtml=`<div class=\"urgent-stack\">${settings.commonUrgentActive&&String(settings.commonUrgentText||'').trim()?`<div class=\"urgent-alert urgent-common\"><strong>🚨 전체 긴급 요청</strong><div class=\"urgent-text\">${esc(settings.commonUrgentText)}</div></div>`:''}${c.urgentActive&&String(c.urgentText||'').trim()?`<div class=\"urgent-alert urgent-class\"><strong>🚨 ${esc(c.id)}반 긴급 요청</strong><div class=\"urgent-text\">${esc(c.urgentText)}</div></div>`:''}</div>`;const tasks="
    s=s.replace(teacher_anchor,urgent_expr,1)

teacher_shell="shell(user,`${heroTeacher(c,p)}"
if teacher_shell in s and 'shell(user,`${urgentHtml}${heroTeacher(c,p)}' not in s:
    s=s.replace(teacher_shell,"shell(user,`${urgentHtml}${heroTeacher(c,p)}",1)

# 3) Add admin tab
old_tabs='<button class="tab ${tab===\'classes\'?\'active\':\'\'}" data-tab="classes">반별 설정</button><button class="tab ${tab===\'preview\'?\'active\':\'\'}" data-tab="preview">담임 화면 PREVIEW</button>'
new_tabs='<button class="tab ${tab===\'classes\'?\'active\':\'\'}" data-tab="classes">반별 설정</button><button class="tab ${tab===\'urgent\'?\'active\':\'\'}" data-tab="urgent">🚨 긴급 요청</button><button class="tab ${tab===\'preview\'?\'active\':\'\'}" data-tab="preview">담임 화면 PREVIEW</button>'
if old_tabs in s and 'data-tab="urgent"' not in s:
    s=s.replace(old_tabs,new_tabs,1)

# 4) Route urgent tab
route_anchor="if(tab==='classes')await classAdmin(user,p,selected);if(tab==='preview')await adminPreview(user,p,selected);"
route_new="if(tab==='classes')await classAdmin(user,p,selected);if(tab==='urgent')await urgentAdmin(user,p,selected);if(tab==='preview')await adminPreview(user,p,selected);"
if route_anchor in s and "if(tab==='urgent')" not in s:
    s=s.replace(route_anchor,route_new,1)

# 5) Admin urgent request editor
func_anchor='async function classAdmin(user,p,selected){'
if func_anchor in s and 'async function urgentAdmin(' not in s:
    urgent_func=r'''async function urgentAdmin(user,p,selected='1'){
  const sr=await getDoc(doc(db,'settings','global')),settings=sr.exists()?{...DEFAULTS,...sr.data()}:DEFAULTS;
  const cr=await getDoc(doc(db,'classes',String(selected))),c=cr.exists()?{...classMeta(selected),...cr.data(),id:String(selected)}:classMeta(selected);
  document.getElementById('adminBody').innerHTML=`<section class="card panel"><div class="admin-note"><strong>긴급 요청:</strong> 활성화된 요청은 담임 로그인 화면 최상단에 계속 표시되며, 운영자가 해제할 때까지 사라지지 않습니다.</div><div class="urgent-admin-grid"><div class="urgent-box"><h3>🚨 전체 반 공통 긴급 요청</h3><div class="mini-note">1~17반 모든 담임에게 동시에 표시됩니다.</div><label class="urgent-toggle"><input id="commonUrgentActive" type="checkbox" ${settings.commonUrgentActive?'checked':''}> 현재 발송 상태</label><textarea id="commonUrgentText" placeholder="예: 오늘 17시까지 출결인정자료 누락 여부를 반드시 확인해 주세요.">${esc(settings.commonUrgentText||'')}</textarea><div class="actions"><button id="clearCommonUrgent" class="btn btn-ghost">해제</button><button id="saveCommonUrgent" class="btn btn-danger">공통 긴급 요청 발송</button></div></div><div class="urgent-box"><h3>🚨 반별 개별 긴급 요청</h3><div class="mini-note">선택한 반 담임에게만 표시됩니다.</div><div class="field" style="margin-top:10px"><label>대상 반</label><select id="urgentClassSelect">${CLASSES.map(x=>`<option value="${x.id}" ${x.id===String(selected)?'selected':''}>${x.id}반 · ${esc(x.course)}</option>`).join('')}</select></div><label class="urgent-toggle"><input id="classUrgentActive" type="checkbox" ${c.urgentActive?'checked':''}> 현재 발송 상태</label><textarea id="classUrgentText" placeholder="예: 1반은 오늘 수기출석본 8/20 자료를 다시 확인해 주세요.">${esc(c.urgentText||'')}</textarea><div class="actions"><button id="clearClassUrgent" class="btn btn-ghost">해제</button><button id="saveClassUrgent" class="btn btn-danger">이 반 긴급 요청 발송</button></div></div></div></section>`;
  document.getElementById('urgentClassSelect').onchange=e=>urgentAdmin(user,p,e.target.value);
  document.getElementById('saveCommonUrgent').onclick=async()=>{const text=document.getElementById('commonUrgentText').value.trim();if(!text)return alert('공통 긴급 요청 내용을 입력해 주세요.');await setDoc(doc(db,'settings','global'),{commonUrgentText:text,commonUrgentActive:true,commonUrgentUpdatedAt:serverTimestamp()},{merge:true});toast('전체 반 긴급 요청 발송 완료');urgentAdmin(user,p,String(selected))};
  document.getElementById('clearCommonUrgent').onclick=async()=>{await setDoc(doc(db,'settings','global'),{commonUrgentActive:false,commonUrgentUpdatedAt:serverTimestamp()},{merge:true});toast('공통 긴급 요청 해제 완료');urgentAdmin(user,p,String(selected))};
  document.getElementById('saveClassUrgent').onclick=async()=>{const text=document.getElementById('classUrgentText').value.trim();if(!text)return alert('반별 긴급 요청 내용을 입력해 주세요.');await setDoc(doc(db,'classes',String(selected)),{urgentText:text,urgentActive:true,urgentUpdatedAt:serverTimestamp()},{merge:true});toast(`${selected}반 긴급 요청 발송 완료`);urgentAdmin(user,p,String(selected))};
  document.getElementById('clearClassUrgent').onclick=async()=>{await setDoc(doc(db,'classes',String(selected)),{urgentActive:false,urgentUpdatedAt:serverTimestamp()},{merge:true});toast(`${selected}반 긴급 요청 해제 완료`);urgentAdmin(user,p,String(selected))};
}
'''
    s=s.replace(func_anchor,urgent_func+func_anchor,1)

p.write_text(s,encoding='utf-8')
print('patched urgent requests')
