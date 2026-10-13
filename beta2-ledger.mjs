// 2기 베타 출결대조: 마스터시트 출결원장 + 체크히어 실시간 기록. 저장은 Apps Script로 시트에 바로 들어갑니다.
import {dayView,dayCounts,compareCheckHere,timesFromRecord,neededTimes,teacherOf,recognizedType,isConflictFlag,B2_TYPES} from './beta2-core.mjs';
import {esc,md,badge,evBadge,syncPill,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {loadCheckHereDay,watchCheckHereDay} from './checkhere-snapshots.mjs';
import {matchSnapshot} from './attendance-beta-core.mjs';
import {loadCheckHereIdentities} from './checkhere-name-store.mjs';
import {createProposalReview} from './checkhere-proposals.mjs';

const FILTERS=[['all','전체'],['exceptions','출석 외'],['diff','체크히어 불일치'],['flag','동기화 확인']];
const EVIDENCE=[['','자동 (인정이면 미제출)'],['미제출','미제출'],['확인','확인'],['반려','반려'],['해당없음','해당없음']];
const memoReason=memo=>{const m=String(memo||'').match(/^\s*\((?:인정)?[^)]*\)\s*(.+?)_담임:/)||String(memo||'').match(/^(?:지각|조퇴|외출)_담임:[^(]*\((.+)\)$/);return m?m[1].trim():'';};
const koreaNow=()=>{const s=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'});return {date:s.slice(0,10),seconds:+s.slice(11,13)*3600+ +s.slice(14,16)*60};};

export async function mount(host,{db,user,classes,client,selected,context}){
 const life=lifecycle(host);
 let cls=String(context?.classId||selected||'1'),date=String(context?.date||''),bundle=null,rows=[],records=[],recordsNote='',identities=[],live='',filter=context?.filter||'all',search='',editing=null,form=null,formErr='',saving=false,error='',loaded=false;
 const opened=new Set();let proposalsLoaded='',unwatch=null,seq=0,chSeq=0;
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>출결대조</h2><p>마스터시트 출결원장과 체크히어 기록을 나란히 봅니다. 저장하면 Google 경고 없이 마스터시트에 바로 들어가고 변경이력에 남습니다.</p></div><div id="b2Sync"></div></div>
 <section class="b2-card"><div class="b2-toolbar">
  <label class="b2-field">반<select id="b2Class">${classOptions(classes,cls)}</select></label>
  <label class="b2-field">교육일<select id="b2Date"></select></label>
  <label class="b2-field">이름 찾기<input id="b2Search" placeholder="이름" autocomplete="off"></label>
  <div class="b2-chips" id="b2Filters"></div><span class="b2-grow"></span><span id="b2Live"></span>
  <button class="b2-btn soft" id="b2Pull" title="운영총괄에서 이 반만 지금 가져옵니다">이 반 운영총괄 가져오기</button><button class="b2-btn" id="b2Reload">새로고침</button>
 </div><div class="b2-stats" id="b2Stats"></div><div id="b2Msg" style="padding:0 14px"></div>
 <div class="b2-table-wrap"><table class="b2-table"><thead><tr><th style="width:130px">이름</th><th>출결원장 (마스터시트)</th><th>체크히어</th><th style="width:220px">대조</th><th style="width:150px"></th></tr></thead><tbody id="b2Rows"><tr><td colspan="5">${loading('출결원장을 불러오는 중…')}</td></tr></tbody></table></div></section></div>`;
 const $=s=>host.querySelector(s),tbody=$('#b2Rows');
 const students=()=>rows.map(r=>({rowIndex:r.rowIndex,name:r.name}));
 const matchFor=row=>{const m=matchSnapshot({name:row.name},students(),records,identities);return m.record||null;};
 const proposals=createProposalReview({db,user,root:host,render:()=>renderRows(),showErr:e=>say(e.message,'err'),hasUnsavedReason:()=>!!editing,
  getContext:s=>{const row=rows.find(r=>r.name===s.name)||{},record=matchFor(row);return {classId:cls,date,name:s.name,phoneLast4:record?.phoneLast4||'',status:row.type||'출석',reason:row.rec?.reason||'',reasonUnsaved:editing===s.name,statusSaving:saving&&editing===s.name,teacher:teacherOf(bundle,cls),raw:'',excursion:false,record};}});
 function say(text,kind=''){const el=$('#b2Msg');if(el)el.innerHTML=text?`<div class="b2-note ${kind}" style="margin-bottom:10px">${esc(text)}</div>`:'';}

 function compareRow(row){
  if(!row.enrolled&&!row.rec)return {state:'none',text:'재학 기간 아님'};
  const now=koreaNow();return compareCheckHere(row.type,row.rec,matchFor(row),{today:now.date,date,now:now.seconds});
 }
 function visible(){
  const q=search.trim();
  return rows.filter(r=>(!q||r.name.includes(q))&&(filter==='all'||(filter==='exceptions'&&r.rec&&r.type!=='출석')||(filter==='diff'&&compareRow(r).state==='diff')||(filter==='flag'&&isConflictFlag(r.rec?.flag))));
 }
 function timeText(rec){if(!rec)return '';const p=[];if(rec.inT)p.push('입실 '+rec.inT);if(rec.outT)p.push('퇴실 '+rec.outT);if(rec.oa||rec.ob)p.push(`외출 ${rec.oa||'?'}~${rec.ob||'?'}`);return p.join(' · ');}
 function checkhereCell(record){
  if(!record)return `<span class="b2-muted b2-small">${esc(recordsNote||'저장본 없음')}</span>`;
  const t=v=>v?String(v).slice(0,5):'-',raw=Object.hasOwn(record,'rawEntry')?record.rawEntry:record.entry;
  const trips=(record.outings||[]).filter(o=>o?.start).map(o=>`${t(o.start)}~${t(o.end)}`);
  const memo=[record.entryMemo,record.exitMemo].filter(Boolean).map(esc).join('<br>');
  return `<b>${t(raw)}</b> → <b>${t(record.exit)}</b>${record.rawEntry&&record.entry&&record.rawEntry!==record.entry?`<span class="b2-sub">교시 기록 ${t(record.entry)}</span>`:''}${trips.length||record.outingCount?`<span class="b2-sub">외출 ${Math.max(trips.length,+record.outingCount||0)}회 ${esc(trips.join(', '))}</span>`:''}${memo?`<span class="b2-sub">${memo}</span>`:''}`;
 }
 function editorHtml(row){
  const f=form,record=matchFor(row),need=neededTimes(f.type,{inT:'x',outT:'x',oa:'x',ob:'x'}),hint=memoReason(record?.entryMemo)||memoReason(record?.exitMemo);
  const time=(k,label)=>`<label class="b2-field">${label}<input type="time" data-f="${k}" value="${esc(f[k]||'')}"></label>`;
  return `<div class="b2-editor" data-editor="${esc(row.name)}"><div class="b2-chips">${B2_TYPES.map(t=>`<button class="b2-chip" data-type="${t}" aria-pressed="${f.type===t}">${t}</button>`).join('')}</div>
  <div class="row">${need.inT?time('inT','입실'):''}${need.outT?time('outT','퇴실'):''}${need.oa?time('oa','외출 시작')+time('ob','외출 종료'):''}${record&&(need.inT||need.outT||need.oa)?'<button class="b2-btn small soft" data-fill>체크히어 시간 넣기</button>':''}
   <label class="b2-field b2-grow">사유${recognizedType(f.type)?' (필수)':''}<input data-f="reason" maxlength="300" value="${esc(f.reason)}" placeholder="${recognizedType(f.type)?'예: 병원 진료, 면접':'선택 입력'}"></label>${hint&&hint!==f.reason?`<button class="b2-btn small ghost" data-hint="${esc(hint)}" title="체크히어 메모의 사유">체크히어 메모: ${esc(hint)}</button>`:''}</div>
  <div class="row"><label class="b2-field">증빙<select data-f="ev">${EVIDENCE.map(([v,l])=>`<option value="${v}" ${f.ev===v?'selected':''}>${l}</option>`).join('')}</select></label>${f.ev==='반려'?`<label class="b2-field b2-grow">반려 사유 (필수)<input data-f="evr" maxlength="300" value="${esc(f.evr)}"></label>`:'<span class="b2-grow"></span>'}
   <span class="b2-err">${esc(formErr)}</span><button class="b2-btn" data-cancel>취소</button><button class="b2-btn primary" data-save ${saving?'disabled':''}>${saving?'저장 중…':'마스터시트에 저장'}</button></div>
  <div class="b2-tiny b2-muted">저장한 기록은 출처가 '베타 수정'이 되어 10분 동기화가 덮어쓰지 않습니다. 운영총괄과 다르면 '동기화 확인'에 표시됩니다.</div></div>`;
 }
 function rowHtml(row){
  const rec=row.rec,cmp=compareRow(row),out=!row.enrolled&&!rec,flag=isConflictFlag(rec?.flag)?rec.flag:'',note=rec?.flag&&!flag?rec.flag:'';
  const ledger=out?'<span class="b2-muted">해당없음 (재학 기간 아님)</span>':`${badge(row.type)} ${rec?`<span class="b2-small">${esc(timeText(rec))}</span>`:''} ${evBadge(rec?.evApplied)}${rec?.reason?`<span class="b2-sub">${esc(rec.reason)}${rec.evr?` · 반려: ${esc(rec.evr)}`:''}</span>`:''}${rec?.check?`<span class="b2-sub">시트 확인: ${esc(rec.check)}</span>`:''}${rec?`<span class="b2-sub">${esc(rec.prov||'직접 입력')}</span>`:''}${flag?`<span class="b2-flag">${esc(flag)} <button class="b2-btn small warn" data-release>운영총괄 값으로</button></span>`:''}${note?`<span class="b2-sub">참고: ${esc(note)}</span>`:''}`;
  return `<tr class="${cmp.state==='diff'?'diff':''} ${flag?'flag':''} ${out?'out':''} ${editing===row.name?'editing':''}" data-name="${esc(row.name)}"><td><span class="b2-name">${esc(row.name)}</span>${row.status&&row.status!=='재학'?`<span class="b2-sub">${esc(row.status)}${row.changed?' · '+md(row.changed):''}</span>`:''}</td><td>${ledger}</td><td>${checkhereCell(matchFor(row))}</td><td><span class="b2-match ${cmp.state}">${cmp.state==='ok'?'✓ ':cmp.state==='diff'?'⚠ ':''}${esc(cmp.text)}</span></td><td><div class="b2-chips"><button class="b2-btn small ${editing===row.name?'dark':''}" data-edit>${editing===row.name?'닫기':'수정'}</button><button class="b2-btn small soft" data-req aria-pressed="${opened.has(row.name)}">체크히어 요청</button></div></td></tr>`
   +(editing===row.name?`<tr class="editing"><td colspan="5">${editorHtml(row)}</td></tr>`:'')
   +(opened.has(row.name)?`<tr><td colspan="5"><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${['times','entryMemo','exitMemo'].map(c=>proposals.html({rowIndex:row.rowIndex,name:row.name},c)).join('')}</div><div class="b2-tiny b2-muted">요청 근거 앞에 [2기 베타]가 붙고, 수집 PC가 승인한 뒤 체크히어에 반영됩니다.</div></td></tr>`:'');
 }
 function renderRows(){
  if(!life.alive()||!bundle)return;
  if(opened.size)proposals.capture(students());
  const list=visible(),counts=dayCounts(rows),diff=rows.filter(r=>compareRow(r).state==='diff').length;
  $('#b2Stats').innerHTML=[['총원',counts.총원],['출석',counts.출석],['결석',counts.결석,counts.결석?'bad':''],['지각',counts.지각],['조퇴',counts.조퇴],['외출',counts.외출],['인정',counts.인정],['체크히어 불일치',diff,diff?'alert':''],['동기화 확인',counts.확인필요,counts.확인필요?'alert':'']].map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${l}</span></div>`).join('');
  $('#b2Filters').innerHTML=FILTERS.map(([k,l])=>`<button class="b2-chip" data-filter="${k}" aria-pressed="${filter===k}">${l}</button>`).join('');
  tbody.innerHTML=list.length?list.map(rowHtml).join(''):`<tr><td colspan="5"><div class="b2-muted b2-pad">${rows.length?'조건에 맞는 학생이 없습니다.':'명부에 이 반 학생이 없습니다. 운영총괄 가져오기를 먼저 실행해 주세요.'}</div></td></tr>`;
  if(opened.size)proposals.bind(students());
  $('#b2Sync').innerHTML=syncPill(bundle.sync);
  $('#b2Live').innerHTML=live==='live'?`<span class="b2-pill live">체크히어 실시간${records.length?` · ${records.length}명`:''}</span>`:live==='day'?`<span class="b2-pill">체크히어 저장본${records.length?` · ${records.length}명`:''}</span>`:live?`<span class="b2-pill wait">${esc(live)}</span>`:'';
 }
 function dateOptions(){
  const days=bundle.days.filter(d=>d<=bundle.today).reverse();
  if(!date||!days.includes(date))date=days[0]||'';
  $('#b2Date').innerHTML=days.map(d=>`<option value="${d}" ${d===date?'selected':''}>${md(d)}${d===bundle.today?' · 오늘':''}</option>`).join('');
 }
 // 체크히어 구독은 반·날짜가 바뀔 때만 새로 겁니다. 마스터시트를 다시 읽어도(seq) 구독은 그대로 둡니다.
 async function loadCheckHere(){
  const n=++chSeq;unwatch?.();unwatch=null;records=[];recordsNote='';live='체크히어 확인 중';
  try{
   identities=await loadCheckHereIdentities(db,cls,students()).catch(()=>[]);
   if(date===koreaNow().date){
    live='체크히어 연결 중';
    unwatch=watchCheckHereDay(db,cls,date,recs=>{if(n!==chSeq||!life.alive())return;records=recs;live='live';renderRows();},e=>{if(n===chSeq){live='실시간 연결 끊김';recordsNote=e.message;renderRows();}});
    life.on(()=>unwatch?.());
   }else{
    const recs=await loadCheckHereDay(db,cls,date);if(n!==chSeq||!life.alive())return;records=recs;live='day';if(!recs.length)recordsNote='이 날 체크히어 저장본 없음';
   }
  }catch(e){if(n===chSeq){live='체크히어 읽기 실패';recordsNote=e.message;}}
  if(n===chSeq)renderRows();
 }
 async function load({fresh=false,keepCheckHere=false}={}){
  const n=++seq;say('');
  try{
   bundle=await client.bundle(cls,{fresh});if(n!==seq||!life.alive())return;
   if(!loaded){loaded=true;}
   dateOptions();rows=dayView(bundle,cls,date);
   if(editing&&!rows.some(r=>r.name===editing)){editing=null;form=null;}
   renderRows();
   if(!keepCheckHere)await loadCheckHere();
   if(opened.size&&proposalsLoaded!==`${cls}|${date}`){proposalsLoaded=`${cls}|${date}`;await proposals.load(cls,date);renderRows();}
  }catch(e){if(n===seq){error=e.message;tbody.innerHTML=`<tr><td colspan="5">${errorBox(e)}</td></tr>`;}}
 }
 function openEditor(row){
  const rec=row.rec;editing=row.name;formErr='';
  form={type:row.type==='해당없음'?'출석':row.type,inT:rec?.inT||'',outT:rec?.outT||'',oa:rec?.oa||'',ob:rec?.ob||'',reason:rec?.reason||'',ev:rec?.ev||'',evr:rec?.evr||'',before:rec?.sig||'',dirty:false};
 }
 async function save(row){
  if(saving)return;formErr='';
  const times=neededTimes(form.type,form);
  if(recognizedType(form.type)&&!form.reason.trim()){formErr='인정 출결은 사유가 필요합니다.';return renderRows();}
  if(form.ev==='반려'&&!form.evr.trim()){formErr='반려 사유를 적어 주세요.';return renderRows();}
  saving=true;renderRows();
  try{
   await client.save({cls,name:row.name,date,type:form.type,...times,reason:form.reason.trim(),ev:form.type==='출석'?'':form.ev,evr:form.ev==='반려'?form.evr.trim():'',before:form.before});
   toast(`${row.name} · ${md(date)} ${form.type} 저장했습니다.`);editing=null;form=null;saving=false;
   const b=await client.bundle(cls);if(!life.alive())return;bundle=b;rows=dayView(bundle,cls,date);renderRows();
  }catch(e){
   saving=false;
   if(e.code==='CONFLICT'){formErr='그사이 다른 곳에서 이 기록이 바뀌어 저장하지 않았습니다. 최신 값을 불러왔으니 확인 후 다시 저장해 주세요.';await load({fresh:true,keepCheckHere:true});const r=rows.find(x=>x.name===row.name);if(r){const keep=form;openEditor(r);form={...form,...keep,before:r.rec?.sig||''};formErr='그사이 바뀐 기록이 있어 최신 값을 불러왔습니다. 확인 후 다시 저장해 주세요.';}renderRows();}
   else{formErr=e.message;renderRows();}
  }
 }
 host.addEventListener('input',e=>{const k=e.target.dataset?.f;if(!k||!form)return;form[k]=e.target.value;form.dirty=true;if(k==='ev')renderRows();});
 host.addEventListener('change',e=>{const k=e.target.dataset?.f;if(k==='ev'&&form){form.ev=e.target.value;renderRows();}});
 host.addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t||!host.contains(t))return;
  const tr=t.closest('[data-name]')||t.closest('tr')?.previousElementSibling,name=t.closest('[data-editor]')?.dataset.editor||tr?.dataset?.name,row=rows.find(r=>r.name===name);
  if(t.dataset.filter){filter=t.dataset.filter;renderRows();return;}
  if(!row)return;
  if(t.hasAttribute('data-edit')){if(editing===row.name){if(form?.dirty&&!confirm('저장하지 않은 수정이 있습니다. 닫을까요?'))return;editing=null;form=null;}else{if(editing&&form?.dirty&&!confirm('다른 학생의 저장하지 않은 수정이 있습니다. 버리고 열까요?'))return;openEditor(row);}renderRows();return;}
  if(t.hasAttribute('data-req')){if(opened.has(row.name))opened.delete(row.name);else{opened.add(row.name);if(proposalsLoaded!==`${cls}|${date}`){proposalsLoaded=`${cls}|${date}`;renderRows();await proposals.load(cls,date);}}renderRows();return;}
  if(t.dataset.type){form.type=t.dataset.type;form.dirty=true;formErr='';renderRows();return;}
  if(t.hasAttribute('data-fill')){Object.assign(form,timesFromRecord(matchFor(row)));form.dirty=true;renderRows();return;}
  if(t.dataset.hint){form.reason=t.dataset.hint;form.dirty=true;renderRows();return;}
  if(t.hasAttribute('data-cancel')){editing=null;form=null;renderRows();return;}
  if(t.hasAttribute('data-save')){await save(row);return;}
  if(t.hasAttribute('data-release')){
   if(!confirm(`${row.name} · ${md(date)} 기록을 운영총괄 값으로 되돌릴까요?\n베타에서 고친 내용은 없어지고 이 반을 운영총괄에서 다시 가져옵니다.`))return;
   t.disabled=true;say('운영총괄에서 이 반을 다시 가져오는 중…');
   try{const r=await client.release({cls,name:row.name,date});toast(r.released?'운영총괄 값으로 되돌렸습니다.':'되돌릴 기록이 없습니다.');await load({fresh:true,keepCheckHere:true});}catch(err){say(err.message,'err');}
  }
 });
 $('#b2Class').onchange=e=>{if(editing&&form?.dirty&&!confirm('저장하지 않은 수정이 있습니다. 반을 바꿀까요?')){e.target.value=cls;return;}cls=e.target.value;editing=null;form=null;opened.clear();void load();};
 $('#b2Date').onchange=e=>{if(editing&&form?.dirty&&!confirm('저장하지 않은 수정이 있습니다. 날짜를 바꿀까요?')){e.target.value=date;return;}date=e.target.value;editing=null;form=null;opened.clear();rows=dayView(bundle,cls,date);renderRows();void loadCheckHere();};
 $('#b2Search').oninput=e=>{search=e.target.value;renderRows();};
 $('#b2Reload').onclick=()=>void load({fresh:true});
 $('#b2Pull').onclick=async e=>{e.target.disabled=true;say(`${cls}반을 운영총괄에서 가져오는 중… (보통 5초 안팎)`);try{const r=await client.syncNow({cls}),s=r?.stats||{};await load({fresh:true,keepCheckHere:true});say(`${cls}반 가져오기 완료 · 추가 ${s.added||0} · 수정 ${s.updated||0} · 삭제 ${s.removed||0} · 확인 필요 ${s.flagged||0}${r?.errors?.length?' · 오류: '+r.errors.join(', '):''}`,r?.errors?.length?'warn':'');}catch(err){say(err.message,'err');}finally{e.target.disabled=false;}};
 const stopWatch=client.watch(async()=>{if(!life.alive()||saving)return;const keep=editing;await load({fresh:true,keepCheckHere:true});if(keep)say('마스터시트가 바뀌어 새로 읽었습니다. 열려 있는 수정 칸은 그대로 두었습니다.');},{current:()=>bundle?.rev||0});
 life.on(stopWatch);
 await load();
 return {canLeave:()=>!(editing&&form?.dirty)||confirm('저장하지 않은 출결 수정이 있습니다. 화면을 떠날까요?'),dispose:()=>life.dispose()};
}
