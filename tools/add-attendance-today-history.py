from pathlib import Path
p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

css_anchor='.row-flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}'
css_add='''.row-flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.student-name-btn{border:0;background:transparent;padding:0;color:#0f172a;font:inherit;font-weight:900;cursor:pointer;text-align:left;text-decoration:underline;text-decoration-color:#cbd5e1;text-underline-offset:3px}.student-name-btn:hover{color:#1d4ed8}.history-back{position:fixed;inset:0;background:rgba(15,23,42,.48);display:none;place-items:center;padding:20px;z-index:50}.history-back.show{display:grid}.history-modal{width:min(700px,100%);max-height:min(78vh,760px);overflow:auto;background:#fff;border-radius:20px;padding:22px;box-shadow:0 20px 60px rgba(15,23,42,.22)}.history-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.history-head h3{margin:0 0 5px;font-size:20px}.history-list{display:grid;gap:8px;margin-top:16px}.history-item{display:grid;grid-template-columns:88px 120px 1fr;gap:10px;align-items:center;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.history-date{font-weight:900}.history-status{font-size:12px;font-weight:900}.history-reason{font-size:13px;color:#475569}.history-empty{padding:24px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px;margin-top:14px}@media(max-width:620px){.history-item{grid-template-columns:72px 100px 1fr}}'''
assert css_anchor in s, 'css anchor missing'
s=s.replace(css_anchor,css_add,1)

body_anchor='</section></div>\n<script type="module">'
modal='''</section></div><div id="historyBack" class="history-back"><div class="history-modal"><div class="history-head"><div><h3 id="historyTitle">학생 누적 출결</h3><div id="historyMeta" class="save-meta"></div></div><button id="historyClose" class="btn soft">닫기</button></div><div id="historyList" class="history-list"></div></div></div>\n<script type="module">'''
assert body_anchor in s, 'body anchor missing'
s=s.replace(body_anchor,modal,1)

normalize_anchor="function normalizeDate(v){return String(v||'').trim()}"
normalize_new="""function normalizeDate(v){return String(v||'').trim()}\nfunction todayLabel(){try{return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).format(new Date())}catch{return''}}"""
assert normalize_anchor in s, 'normalize anchor missing'
s=s.replace(normalize_anchor,normalize_new,1)

preferred_old="const preferred=dates.find(x=>x.label==='8/24')?.label||dates.at(-1)?.label||dates[0]?.label||'';"
preferred_new="const today=todayLabel(),preferred=dates.find(x=>x.label===today)?.label||dates.at(-1)?.label||dates[0]?.label||'';"
assert preferred_old in s, 'preferred anchor missing'
s=s.replace(preferred_old,preferred_new,1)

name_old="<div class=\"name\">${esc(s.name)}${ov?'<span class=\"firebase-mark\">Firebase 수정</span>':''}</div>"
name_new="<div class=\"name\"><button type=\"button\" class=\"student-name-btn\" data-history-i=\"${i}\">${esc(s.name)}</button>${ov?'<span class=\"firebase-mark\">Firebase 수정</span>':''}</div>"
assert name_old in s, 'name anchor missing'
s=s.replace(name_old,name_new,1)

bind_anchor="function bindEditors(){document.querySelectorAll('.edit-status').forEach(el=>el.onchange=()=>{const x=editRows[+el.dataset.i];x.status=el.value;if(x.status==='출석'&&x.reason===x.baseReason)x.reason='';setDirty();recalcSummary()});document.querySelectorAll('.edit-reason').forEach(el=>el.oninput=()=>{editRows[+el.dataset.i].reason=el.value;setDirty()})}"
history_func="""function bindEditors(){document.querySelectorAll('.edit-status').forEach(el=>el.onchange=()=>{const x=editRows[+el.dataset.i];x.status=el.value;if(x.status==='출석'&&x.reason===x.baseReason)x.reason='';setDirty();recalcSummary()});document.querySelectorAll('.edit-reason').forEach(el=>el.oninput=()=>{editRows[+el.dataset.i].reason=el.value;setDirty()});document.querySelectorAll('[data-history-i]').forEach(el=>el.onclick=()=>openStudentHistory(+el.dataset.historyI))}\nfunction openStudentHistory(i){\n  const st=students[i];if(!st)return;\n  const abnormal=new Set(['결석','지각','조퇴','외출','인정출석','인정결석','중복']);\n  const rows=[];\n  for(const d of dates){\n    const status=String(st.all[d.idx]||'').trim();if(!abnormal.has(status))continue;\n    const raw=reasonCells[d.label]||'',parsed=parseReasonFor(st.name,raw,status),reason=parsed.reason||'';\n    rows.push({date:d.label,status,reason});\n  }\n  $('#historyTitle').textContent=`${st.name} · 누적 출결`;\n  $('#historyMeta').textContent=`${selectedClass}반 · 이상 출결 ${rows.length}건 · 운영총괄 원본 기준 자동추출`;\n  $('#historyList').innerHTML=rows.length?rows.map(x=>`<div class=\"history-item\"><div class=\"history-date\">${esc(x.date)}</div><div class=\"history-status\">${esc(x.status)}</div><div class=\"history-reason\">${esc(x.reason||'사유 미기재')}</div></div>`).join(''):'<div class=\"history-empty\">누적 이상 출결이 없습니다.</div>';\n  $('#historyBack').classList.add('show');\n}\nfunction closeStudentHistory(){$('#historyBack').classList.remove('show')}"""
assert bind_anchor in s, 'bind anchor missing'
s=s.replace(bind_anchor,history_func,1)

end_anchor="$('#loginBtn').onclick=()=>login().catch(showError);"
end_new="""$('#loginBtn').onclick=()=>login().catch(showError);\n$('#historyClose').onclick=closeStudentHistory;$('#historyBack').onclick=e=>{if(e.target.id==='historyBack')closeStudentHistory()};"""
assert end_anchor in s, 'login bind anchor missing'
s=s.replace(end_anchor,end_new,1)

p.write_text(s,encoding='utf-8')
print('patched today default + student cumulative history')
