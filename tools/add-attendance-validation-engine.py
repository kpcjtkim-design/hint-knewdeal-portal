from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

# CSS
anchor='.firebase-mark{display:inline-flex;margin-left:6px;padding:3px 6px;border-radius:999px;background:#ede9fe;color:#6d28d9;font-size:10px;font-weight:900}'
add=anchor+'.validation{margin-top:12px;padding:13px 15px}.validation h3{margin:0 0 8px;font-size:14px}.validation-list{display:flex;flex-wrap:wrap;gap:7px}.flag{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:900;background:#f1f5f9;color:#475569}.flag.red{background:#fee2e2;color:#991b1b}.flag.orange{background:#ffedd5;color:#9a3412}.flag.yellow{background:#fef3c7;color:#92400e}.flag.green{background:#dcfce7;color:#166534}.student.has-flags{border-color:#f59e0b}.row-flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}'
if '.validation{' not in s:
    s=s.replace(anchor,add,1)

# validation panel
panel_anchor='<div class="parser-note"><b>가-3 자동 추출:</b> AI 없이 학생 명단·가-2 출결·이름 주변 문맥을 함께 사용합니다. 줄바꿈, 언더바, 하이픈, 콜론, 쉼표, 슬래시, “(인)” 표기가 섞여 있어도 최대한 사유만 정리하며, 확실하지 않으면 임의로 만들지 않고 확인 필요로 남깁니다.</div>'
panel=panel_anchor+'\n<section class="card validation"><h3>자동 교차검증</h3><div id="validationSummary" class="validation-list"><span class="flag">날짜를 선택하면 검증합니다.</span></div></section>'
if 'id="validationSummary"' not in s:
    s=s.replace(panel_anchor,panel,1)

# engine helpers before reviewDocId
engine_anchor='function reviewDocId(label){'
engine=r'''const REASON_RULES=[
  [/병원\s*(?:내원|진료|방문)|병원|의원|진료|통원|치료|병가/g,'병원진료'],
  [/예비군|동원\s*훈련|동원훈련|민방위/g,'예비군'],
  [/면접\s*(?:준비|참석|전형)?|취업\s*면접|채용\s*면접/g,'면접'],
  [/개인\s*사정|개인사유/g,'개인사정'],
  [/교통\s*(?:체증|지연)|차량\s*정체|대중교통\s*지연/g,'교통'],
  [/가족\s*(?:행사|사정)|가정\s*사정/g,'가족사정'],
  [/자격증\s*(?:시험|응시)|시험\s*응시/g,'시험'],
  [/취업\s*(?:행사|상담|박람회)|채용\s*박람회/g,'취업활동']
];
function standardizeReason(v){
  let x=String(v||'').trim(); if(!x)return'';
  x=x.replace(/사전\s*통보\s*/g,'').replace(/지각\s*예정/g,'').replace(/병가\s*조퇴/g,'병원진료').replace(/\s+/g,' ').trim();
  for(const [rx,to] of REASON_RULES){rx.lastIndex=0;if(rx.test(x))return to}
  return x;
}
function lev(a,b){a=String(a);b=String(b);const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
function reasonAudit(text){
  const src=normalizeReasonText(text), roster=students.map(x=>x.name).filter(Boolean), rosterSet=new Set(roster), found=[];
  for(const n of roster){let at=0;while((at=src.indexOf(n,at))!==-1){found.push(n);at+=n.length}}
  const unique=[...new Set(found)];
  const claimed=[];for(const m of src.matchAll(/(?:결석|지각|조퇴|외출|인정출석|인정결석)\s*(\d+)/g))claimed.push(+m[1]);
  const claimedMax=claimed.length?Math.max(...claimed):null;
  const tokens=[...new Set((src.match(/[가-힣]{2,4}/g)||[]))].filter(x=>!rosterSet.has(x)&&!/^(결석|지각|조퇴|외출|인정|출석|면접|병원|진료|교통|사유|개인|예정|준비|통보|병가|예비군|훈련|취업|시험)$/.test(x));
  const suspects=[];for(const t of tokens){let best=null;for(const n of roster){const d=lev(t,n);if(d<=1&&(!best||d<best.d))best={raw:t,name:n,d}}if(best)suspects.push(best)}
  const dup=roster.filter((n,i)=>roster.indexOf(n)!==i);
  return{uniqueNames:unique,claimedMax,suspects,duplicates:[...new Set(dup)]};
}
function validateStudent(status,reason,parsed,name,audit){
  const f=[],need=['결석','지각','조퇴','외출','인정출석','인정결석'].includes(status);
  if(need&&!reason)f.push({t:'사유 미기재',c:'red'});
  if(status==='출석'&&reason)f.push({t:'가-2/가-3 불일치',c:'orange'});
  if(parsed?.confidence==='medium')f.push({t:'파싱 확인 필요',c:'yellow'});
  if(audit.duplicates.includes(name))f.push({t:'동명이인 확인',c:'orange'});
  return f;
}
function renderValidation(audit,rows){
  const flags=[];const missing=rows.filter(x=>x.flags.some(f=>f.t==='사유 미기재')).length,mismatch=rows.filter(x=>x.flags.some(f=>f.t==='가-2/가-3 불일치')).length,amb=rows.filter(x=>x.flags.some(f=>f.t==='파싱 확인 필요')).length;
  if(missing)flags.push(`<span class="flag red">사유 미기재 ${missing}명</span>`);if(mismatch)flags.push(`<span class="flag orange">출결/사유 불일치 ${mismatch}명</span>`);if(amb)flags.push(`<span class="flag yellow">파싱 확인 ${amb}명</span>`);
  if(audit.claimedMax!=null&&audit.claimedMax!==audit.uniqueNames.length)flags.push(`<span class="flag orange">가-3 인원수 불일치: 기재 ${audit.claimedMax} / 이름 ${audit.uniqueNames.length}</span>`);
  for(const s of audit.suspects.slice(0,4))flags.push(`<span class="flag yellow">이름 오타 후보 ${esc(s.raw)}→${esc(s.name)}</span>`);
  if(audit.duplicates.length)flags.push(`<span class="flag orange">동명이인 ${audit.duplicates.map(esc).join(', ')}</span>`);
  if(!flags.length)flags.push('<span class="flag green">자동검증상 특이사항 없음</span>');
  $('#validationSummary').innerHTML=flags.join('');
}
function reviewDocId(label){'''
if 'function standardizeReason(' not in s:
    if engine_anchor not in s: raise SystemExit('engine anchor missing')
    s=s.replace(engine_anchor,engine,1)

# Standardize the parsed reason at parse output.
s=s.replace("const best=candidates[0],confidence=best.score>=3?'high':'medium';return{reason:best.reason,confidence,method:best.method};","const best=candidates[0],confidence=best.score>=3?'high':'medium';return{reason:standardizeReason(best.reason),rawReason:best.reason,confidence,method:best.method};",1)
s=s.replace("if(shared)return{reason:shared,confidence:'high',method:'공동 사유'};","if(shared)return{reason:standardizeReason(shared),rawReason:shared,confidence:'high',method:'공동 사유'};",1)

# Replace renderDate with validation-aware version.
start=s.find('async function renderDate(label){')
end=s.find("\n\n$('#loginBtn').onclick",start)
if start<0 or end<0: raise SystemExit('render block missing')
render=r'''async function renderDate(label){
  currentLabel=label;const d=dates.find(x=>x.label===label);if(!d){$('#rows').innerHTML='<div class="empty">해당 날짜를 찾지 못했습니다.</div>';return}
  const reasonText=reasonCells[label]||'',audit=reasonAudit(reasonText);currentReview=await loadReview(label);const saved=reviewMap(currentReview);editRows=[];const validationRows=[];
  $('#rows').innerHTML=students.map((s,i)=>{
    const baseStatus=String(s.all[d.idx]||'').trim()||'미입력',parsed=parseReasonFor(s.name,reasonText,baseStatus),baseReason=parsed.reason||'',ov=saved.get(s.name);
    const status=ov?.status??baseStatus,reason=standardizeReason(ov?.reason??baseReason),flags=validateStudent(status,reason,parsed,s.name,audit);editRows.push({name:s.name,baseStatus,baseReason,status,reason});validationRows.push({name:s.name,flags});
    const options=['출석','결석','지각','조퇴','외출','인정출석','인정결석','해당없음','미입력'];
    const flagHtml=flags.length?`<div class="row-flags">${flags.map(f=>`<span class="flag ${f.c}">${esc(f.t)}</span>`).join('')}</div>`:'';
    return `<div class="student ${flags.length?'has-flags':''}"><div class="name">${esc(s.name)}${ov?'<span class="firebase-mark">Firebase 수정</span>':''}</div><div><select class="edit-status" data-i="${i}">${options.map(x=>`<option value="${esc(x)}" ${status===x?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div><input class="edit-reason" data-i="${i}" value="${esc(reason)}" placeholder="사유 없음 / 직접 수정 가능"><div class="save-meta">시트 기준: ${esc(baseStatus)}${baseReason?' · '+esc(baseReason):''}${parsed.method&&parsed.method!=='none'?' · '+esc(parsed.method):''}</div>${flagHtml}</div></div>`
  }).join('')||'<div class="empty">교육생을 찾지 못했습니다.</div>';
  $('#rawReason').textContent=reasonText||'가-3 사유 없음';renderValidation(audit,validationRows);bindEditors();dirty=false;setDirty(false);recalcSummary();
  $('#saveMeta').textContent=currentReview?.overrides?.length?`Firebase 수정 ${currentReview.overrides.length}명 저장됨 · ${currentReview.reviewer||'관리자'}`:'Firebase 수정값 없음 · 시트 기준 표시';
}
'''
s=s[:start]+render+s[end:]

# version marker
s=s.replace("parser:'RULE_V2'","parser:'VALIDATION_ENGINE_V3'",1)
s=s.replace('<h1>출결 검수 테스트</h1>','<h1>출결 자동검증</h1>',1)
s=s.replace('가-3 자동 추출:</b>','출결 검증 엔진:</b>',1)

p.write_text(s,encoding='utf-8')
print('attendance validation engine V3 patched')
