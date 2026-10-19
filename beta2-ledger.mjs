// 2기 베타 출결대조: 마스터시트 출결원장 + 체크히어 실시간 기록. 행 안에서 유형·시간·사유를 바로 고쳐 Apps Script로 시트에 저장하고,
// 오늘 기록은 저장 3초 뒤 체크히어 반영 요청을 만듭니다(beta2-checkhere-sync.mjs, 설계 docs/beta2-instant-edit-plan.md 5장).
// 요청은 승인 대기로 남고, 체크히어 쓰기는 사람이 운영 포털 「반영 요청·승인」에서 승인할 때만입니다(사용자 결정 2026-10-16, 중계는 읽기 전용).
// Firestore 함수는 반드시 아래 주소 그대로 불러옵니다. /beta2 import map이 이 주소를 가드(beta2-firestore-guard.mjs)로 돌려 요청 근거에 [2기 베타]가 붙습니다.
import {doc,setDoc,onSnapshot,query,collection,where,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {dayView,dayCounts,compareCheckHere,memoReason,timesFromRecord,neededTimes,teacherOf,recognizedType,isConflictFlag,B2_TYPES} from './beta2-core.mjs';
import {esc,md,badge,evBadge,syncPill,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {loadCheckHereDay,watchCheckHereDay} from './checkhere-snapshots.mjs';
import {matchSnapshot} from './attendance-beta-core.mjs';
import {loadCheckHereIdentities} from './checkhere-name-store.mjs';
import {createProposalReview} from './checkhere-proposals.mjs';
import {withdrawRequest} from './checkhere-request-actions.mjs';
import {PRIVACY_NEEDS_RELAY,UNMASK_ON_APPLY,deleteLeaves,holdKey,needsUnmaskOnApply} from './beta2-checkhere-core.mjs';
import {createCheckHereSync,STATUS_ACTIONS,timeDeletePlan} from './beta2-checkhere-sync.mjs';
import {RULES,seconds} from './checkhere/rules.mjs';

const FILTERS=[['all','전체'],['exceptions','출석 외'],['diff','체크히어 불일치'],['flag','동기화 확인']];
const EVIDENCE=[['','자동 (인정이면 미제출)'],['미제출','미제출'],['확인','확인'],['반려','반려'],['해당없음','해당없음']];
const TIMES=['inT','outT','oa','ob'],ALL={inT:'x',outT:'x',oa:'x',ob:'x'};
const koreaNow=()=>{const s=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'});return {date:s.slice(0,10),seconds:+s.slice(11,13)*3600+ +s.slice(14,16)*60};};
const hm=v=>/^\d{2}:\d{2}/.test(String(v||''))?String(v).slice(0,5):'';

export async function mount(host,{db,user,classes,client,selected,context}){
 const life=lifecycle(host);
 let cls=String(context?.classId||selected||'1'),date=String(context?.date||''),bundle=null,rows=[],records=[],recordsNote='',identities=[],live='',filter=context?.filter||'all',search='',editing=null,form=null,formErr='';
 const opened=new Set();let proposalsLoaded='',unwatch=null,seq=0,chSeq=0,switching=false,painting=false,flushing=null,pend=null,recordsDay='',saveGen=0;
 // drafts: 행 안 초안(이름 → 값, typed=유형을 바꿔 「저장」·Enter가 필요), notes: 행 안내·오류, jobs: 학생마다 저장 하나(next=대기 중인 마지막 초안, done=끝나면 풀림)
 // pinned: 필터·검색을 바꾼 뒤 손댄 학생(필터에서 빠져도 3초·되돌리기·요청 상태가 보이게 남김, 필터·검색을 다시 바꾸면 풀림)
 const drafts=new Map(),notes=new Map(),jobs=new Map(),bodies=new Map(),drawn=new Map(),stale=new Set(),shown=new Map(),pinned=new Set();
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>출결대조</h2><p>마스터시트 출결원장과 체크히어 기록을 나란히 봅니다. 행에서 유형은 「저장」·Enter로, 시간·사유는 칸을 벗어나거나 Enter로 마스터시트에 바로 저장합니다(Esc는 되돌림). 오늘 기록은 저장 3초 뒤 체크히어 반영 요청을 보내고, 관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에 반영됩니다.</p></div><div id="b2Sync"></div></div>
 <section class="b2-card"><div class="b2-toolbar">
  <label class="b2-field">반<select id="b2Class">${classOptions(classes,cls)}</select></label>
  <label class="b2-field">교육일<select id="b2Date"></select></label>
  <label class="b2-field">이름 찾기<input id="b2Search" placeholder="이름" autocomplete="off"></label>
  <div class="b2-chips" id="b2Filters"></div><span class="b2-grow"></span><span id="b2Live"></span><span id="b2Relay"></span>
  <button class="b2-btn soft" id="b2Pull" title="운영총괄에서 이 반만 지금 가져옵니다">이 반 운영총괄 가져오기</button><button class="b2-btn" id="b2Reload">새로고침</button>
 </div><div class="b2-stats" id="b2Stats"></div><div id="b2Msg" style="padding:0 14px"></div>
 <div class="b2-table-wrap"><table class="b2-table b2-ledger" id="b2Table"><thead><tr><th style="width:130px">이름</th><th>출결원장 (마스터시트)</th><th>체크히어</th><th style="width:200px">대조</th><th style="width:130px"></th></tr></thead><tbody data-empty><tr><td colspan="5">${loading('출결원장을 불러오는 중…')}</td></tr></tbody></table></div></section></div>`;
 const $=s=>host.querySelector(s),table=$('#b2Table');
 const students=()=>rows.map(r=>({rowIndex:r.rowIndex,name:r.name}));
 const rowOf=name=>rows.find(r=>r.name===name)||null;
 const recordOf=name=>recordsDay===`${cls}|${date}`?matchSnapshot({name},students(),records,identities).record||null:null; // 다른 반·날짜 기록은 보이지 않음
 const matchFor=row=>row?.name?recordOf(row.name):null;
 const keyOf=name=>holdKey(cls,date,name);
 const ledgerAt=(c,d,n)=>bundle?.ledger.findLast(r=>String(r.cls)===String(c)&&r.name===n&&r.date===d)||null;
 const pick=r=>({type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',reason:r.reason||'',ev:r.ev||'',evr:r.evr||'',prov:r.prov||''});
 const saved=row=>({type:row.type,inT:row.rec?.inT||'',outT:row.rec?.outT||'',oa:row.rec?.oa||'',ob:row.rec?.ob||'',reason:row.rec?.reason||''});
 const valuesOf=row=>({...saved(row),...drafts.get(row.name)});
 // 저장될 값(유형에 필요한 시간만, 사유 앞뒤 공백 없음)으로 비교합니다.
 const sameAs=(a,b)=>a.type===b.type&&JSON.stringify(neededTimes(a.type,a))===JSON.stringify(neededTimes(b.type,b))&&String(a.reason||'').trim()===String(b.reason||'').trim();
 const hasDraft=name=>drafts.has(name)||(editing===name&&!!form?.dirty);
 const typing=el=>{const a=document.activeElement;return !!a&&!!el&&el.contains(a)&&a.matches('input,select,textarea');};
 const sameDay=day=>day===`${cls}|${date}`;

 const sync=createCheckHereSync({db,user,client,fs:{doc,setDoc,onSnapshot,query,collection,where,serverTimestamp},
  withdraw:id=>withdrawRequest(db,user,id),
  getRecord:(c,d,n)=>String(c)===cls&&d===date?recordOf(n):null,
  getSig:(c,d,n)=>ledgerAt(c,d,n)?.sig||'',
  getRow:(c,d,n)=>{const rec=ledgerAt(c,d,n);if(rec)return pick(rec);const row=String(c)===cls&&d===date?rowOf(n):null;return row&&!row.enrolled?{type:'해당없음'}:null;},
  hasDraft:(c,d,n)=>String(c)===cls&&d===date&&(hasDraft(n)||jobs.get(n)?.next!=null),
  teacherOf:c=>bundle?teacherOf(bundle,c):'',
  // 오늘만 자동: 서버 날짜(묶음 today, 날짜 목록과 같은 기준)와 이 PC의 한국 날짜가 같을 때만 오늘로 봅니다(PC 시계가 틀렸거나 화면을 연 채 자정을 넘기면 자동 없음).
  today:()=>{const pc=koreaNow().date;return bundle?.today&&bundle.today!==pc?'':pc;},
  onChange:changed});
 const proposals=createProposalReview({db,user,root:host,render:()=>renderRows(),showErr:e=>say(e.message,'err'),hasUnsavedReason:()=>drafts.size>0,
  getContext:s=>{const row=rowOf(s.name)||{},record=recordOf(s.name);return {classId:cls,date,name:s.name,phoneLast4:record?.phoneLast4||'',status:row.type||'출석',reason:row.rec?.reason||'',reasonUnsaved:drafts.has(s.name),statusSaving:jobs.has(s.name),teacher:teacherOf(bundle,cls),raw:'',excursion:false,record};}});
 function say(text,kind=''){const el=$('#b2Msg');if(el)el.innerHTML=text?`<div class="b2-note ${kind}" style="margin-bottom:10px">${esc(text)}</div>`:'';}

 function compareRow(row){
  if(!row.enrolled&&!row.rec)return {state:'none',text:'재학 기간 아님'};
  // 보정 모드: 연결 프로그램이 고친 교시 기록으로 대조합니다(시간 맞추기·결석 삭제 뒤 남는 실제 입실은 글로만 표시).
  // 오늘 교시·퇴실이 모두 비면 compareCheckHere는 실제 입실로 봅니다(교시가 늦게 찍힐 수 있음). 결석인데 그 학생의 시간 삭제가 확인됐거나
  // 수업이 끝났으면 기다릴 교시가 없으므로 지난 날처럼 봅니다('교시 기록·퇴실 없음 · 실제 입실 남음', 삭제 뒤 ⚠가 남지 않게).
  const now=koreaNow(),settled=['결석','해당없음'].includes(row.type)&&(now.seconds>=seconds(RULES.end)||sync.timesDeleted(keyOf(row.name)));
  return compareCheckHere(row.type,row.rec,matchFor(row),{today:settled?'':now.date,date,now:now.seconds,corrected:true});
 }
 // 필터·검색은 저장된 값으로 거르지만, 손대는 중이거나 방금 손댄 학생(포커스·초안·저장·안내·증빙 편집·체크히어 반영 대기·pinned)은 남깁니다.
 // 그래야 고친 행이 바로 사라져 3초·되돌리기·요청 상태를 못 보거나, 입력 중인 칸이 지워지며 덜 쓴 값이 저장되는 일이 없습니다.
 function visible(){
  const q=search.trim(),held=new Set(sync.holds().filter(h=>h.cls===cls&&h.date===date).map(h=>h.name));
  const keep=r=>pinned.has(r.name)||held.has(r.name)||jobs.has(r.name)||hasDraft(r.name)||notes.has(r.name)||editing===r.name||typing(bodies.get(r.name));
  return rows.filter(r=>keep(r)||((!q||r.name.includes(q))&&(filter==='all'||(filter==='exceptions'&&r.rec&&r.type!=='출석')||(filter==='diff'&&compareRow(r).state==='diff')||(filter==='flag'&&isConflictFlag(r.rec?.flag)))));
 }
 // × 버튼: 켜지는 조건(deletionGate: 규칙 게시 깃발·권한, 중계는 필요 없음)이 맞고, 기록 번호가 있는 칸이고(canDeleteTime), 출결원장 유형이 그 시간을 쓰지 않을 때만 켭니다.
 // v2(마지막 중계 신호에 time-delete-v2, 신호가 없으면 v2로 봄)면 관리자 1교시(ATTEND) 학생의 퇴실 ×·1교시 ×는 1교시·퇴실 두 칸을 함께 지웁니다(사용자 결정 2026-10-19, timeDeletePlan).
 // 꺼져 있으면 title에 이유를 보입니다(timeDeletePlan().reasons), 켜져 있으면 지울 칸(timeDeletePlan().sides)에 맞는 남는 것을 보입니다. 누르면 확인창 → 3초 되돌리기 → 시간 삭제 요청(sync.send). 가렸거나 해제 상태를 몰라도(중계 꺼짐) 요청은 만들고 title에 해제 필요를 붙입니다.
 // 재학 기간이 아닌 행에는 상태 칩이 없어 3초·되돌리기가 보이지 않으므로 ×를 두지 않습니다.
 function delButton(row,record,side){
  if(!hm(record?.[side])||(!row.enrolled&&!row.rec))return '';
  const plan=timeDeletePlan({gate:sync.gate(),record,side,type:valuesOf(row).type}),why=plan.reasons,label=side==='entry'?'입실(교시)':'퇴실',p=sync.relay().privacy;
  return `<button class="b2-x" data-ch-del="${side}" ${why.length?'disabled':''} title="${esc(why.length?`${label} 시간 삭제 불가 · ${why.join(' · ')}`:`체크히어 ${label} 시간 삭제 요청 (관리자 승인 뒤 지움 · ${deleteLeaves(plan.sides,record)}${needsUnmaskOnApply(p)?` · ${UNMASK_ON_APPLY}`:''})`)}" aria-label="체크히어 ${label} 시간 삭제">×</button>`;
 }
 function checkhereCell(row,record){
  if(!record)return `<span class="b2-muted b2-small">${esc(recordsNote||'저장본 없음')}</span>`;
  const t=v=>v?String(v).slice(0,5):'-',raw=Object.hasOwn(record,'rawEntry')?record.rawEntry:record.entry;
  const trips=(record.outings||[]).filter(o=>o?.start).map(o=>`${t(o.start)}~${t(o.end)}`);
  const memo=[record.entryMemo,record.exitMemo].filter(Boolean).map(esc).join('<br>');
  // 입실(교시) ×는 지울 대상인 1교시 기록 옆에 둡니다(실제 입실 옆이면 입실을 지우는 것으로 보임). 그래서 ×가 있으면 1교시가 실제 입실과 같거나
  // 실제 입실이 없어도 '교시 기록 HH:MM ×'를 같은 줄에 따로 보입니다(행 높이는 그대로).
  const entryX=delButton(row,record,'entry'),period=record.entry&&(entryX||(Object.hasOwn(record,'rawEntry')&&record.rawEntry!==record.entry));
  return `<b>${t(raw)}</b> → <b>${t(record.exit)}</b>${delButton(row,record,'exit')}${period?`<span class="b2-small b2-muted" style="white-space:nowrap"> · 교시 기록 ${t(record.entry)}${entryX}</span>`:''}${trips.length||record.outingCount?`<span class="b2-sub">외출 ${Math.max(trips.length,+record.outingCount||0)}회 ${esc(trips.join(', '))}</span>`:''}${memo?`<span class="b2-sub">${memo}</span>`:''}`;
 }
 // 행 안 입력칸: 유형, 그 유형에 필요한 시간만, 사유. 초안이 있으면 초안 값을 보입니다.
 function inlineHtml(row){
  const v=valuesOf(row),valid=B2_TYPES.includes(v.type),need=valid?neededTimes(v.type,ALL):{},n=esc(row.name);
  const time=(k,label)=>`<label class="b2-mini">${label}<input type="time" data-inline="${k}" value="${esc(v[k]||'')}" aria-label="${n} ${label} 시간"></label>`;
  const noReason=!row.rec&&v.type==='출석',record=matchFor(row),hint=memoReason(record?.entryMemo)||memoReason(record?.exitMemo);
  return `${valid?'':badge(row.type)}<select data-inline="type" aria-label="${n} 출결 유형">${valid?'':'<option value="" selected>유형 선택 필요</option>'}${B2_TYPES.map(t=>`<option value="${t}" ${t===v.type?'selected':''}>${t}</option>`).join('')}</select>${need.inT?time('inT','입실'):''}${need.outT?time('outT','퇴실'):''}${need.oa?time('oa','외출 시작')+time('ob','외출 종료'):''}<input class="b2-reason" data-inline="reason" maxlength="300" value="${esc(v.reason)}" aria-label="${n} 사유" ${noReason?'disabled placeholder="출석은 사유를 저장하지 않습니다(유형을 바꾸면 저장)" title="출석은 사유를 저장하지 않습니다(유형을 바꾸면 저장)"':`placeholder="${recognizedType(v.type)?'사유 (필수)':'사유'}"`}>${hint&&!noReason&&hint!==v.reason?`<button class="b2-btn small ghost" data-hint="${esc(hint)}" title="체크히어 메모의 사유">체크히어 메모: ${esc(hint)}</button>`:''}`;
 }
 function ledgerCell(row){
  const rec=row.rec,flag=isConflictFlag(rec?.flag)?rec.flag:'',note=rec?.flag&&!flag?rec.flag:'';
  if(!row.enrolled&&!rec)return `<div class="b2-inline"><select data-inline="type" disabled aria-label="${esc(row.name)} 출결 유형"><option>해당없음</option></select></div><span class="b2-sub">재학 기간 아님</span>`;
  return `<div class="b2-inline">${inlineHtml(row)}</div><div class="b2-inline-msg" data-msg></div>${evBadge(rec?.evApplied)}${rec?.evr?`<span class="b2-sub">반려: ${esc(rec.evr)}</span>`:''}${rec?.check?`<span class="b2-sub">시트 확인: ${esc(rec.check)}</span>`:''}${rec?`<span class="b2-sub">${esc(rec.prov||'직접 입력')}</span>`:''}${flag?`<span class="b2-flag">${esc(flag)} <button class="b2-btn small warn" data-release>운영총괄 값으로</button></span>`:''}${note?`<span class="b2-sub">참고: ${esc(note)}</span>`:''}`;
 }
 // 증빙 편집기: 증빙(ev)·반려 사유(evr)만 고칩니다. 유형·시간·사유는 행에서 바로 고칩니다.
 function editorHtml(row){
  const f=form,busy=jobs.has(row.name);
  return `<div class="b2-editor" data-editor="${esc(row.name)}"><div class="row"><label class="b2-field">증빙<select data-f="ev">${EVIDENCE.map(([v,l])=>`<option value="${v}" ${f.ev===v?'selected':''}>${l}</option>`).join('')}</select></label>${f.ev==='반려'?`<label class="b2-field b2-grow">반려 사유 (필수)<input data-f="evr" maxlength="300" value="${esc(f.evr)}"></label>`:'<span class="b2-grow"></span>'}
   <span class="b2-err">${esc(formErr)}</span><button class="b2-btn" data-cancel>취소</button><button class="b2-btn primary" data-save ${busy?'disabled':''}>${busy?'저장 중…':'증빙 저장'}</button></div>
  <div class="b2-tiny b2-muted">저장한 기록은 출처가 '베타 수정'이 되어 10분 동기화가 덮어쓰지 않습니다. 운영총괄과 다르면 '동기화 확인'에 표시됩니다.</div></div>`;
 }
 const evidenceOk=row=>!!row.rec&&B2_TYPES.includes(row.type)&&row.type!=='출석';
 // 학생 한 명 = <tbody data-student> 하나. 저장 안내([data-msg])와 상태 칩([data-status])은 비워 두고 따로 채웁니다(초마다 바뀌어도 입력칸을 건드리지 않게).
 function rowHtml(row){
  const cmp=compareRow(row),out=!row.enrolled&&!row.rec,flag=isConflictFlag(row.rec?.flag),record=matchFor(row);
  return `<tr class="${cmp.state==='diff'?'diff':''} ${flag?'flag':''} ${out?'out':''} ${editing===row.name||drafts.get(row.name)?.typed?'editing':''}" data-name="${esc(row.name)}"><td><span class="b2-name">${esc(row.name)}</span>${row.status&&row.status!=='재학'?`<span class="b2-sub">${esc(row.status)}${row.changed?' · '+md(row.changed):''}</span>`:''}</td><td>${ledgerCell(row)}</td><td>${checkhereCell(row,record)}${out?'':'<div class="b2-status" data-status></div>'}</td><td><span class="b2-match ${cmp.state}">${cmp.state==='ok'?'✓ ':cmp.state==='diff'?'⚠ ':''}${esc(cmp.text)}</span></td><td><div class="b2-chips">${evidenceOk(row)?`<button class="b2-btn small ${editing===row.name?'dark':''}" data-edit>${editing===row.name?'닫기':'증빙'}</button>`:''}<button class="b2-btn small soft" data-req aria-pressed="${opened.has(row.name)}">직접 요청</button></div></td></tr>`
   +(editing===row.name?`<tr class="editing"><td colspan="5">${editorHtml(row)}</td></tr>`:'')
   +(opened.has(row.name)?`<tr><td colspan="5"><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${['times','entryMemo','exitMemo'].map(c=>proposals.html({rowIndex:row.rowIndex,name:row.name},c)).join('')}</div><div class="b2-tiny b2-muted">자동 요청: 오늘 출결원장을 저장하면 3초 뒤 [실시간 베타] [2기 베타] 요청이 만들어집니다(지난 날은 「체크히어 맞추기」를 눌러야 보냅니다). 체크히어에는 관리자가 운영 포털 「반영 요청·승인」에서 승인할 때만 수집 PC가 입력하고 다시 읽어 확인합니다. 직접 요청: 위 칸에서 따로 요청하며, 근거 앞에 [2기 베타]가 붙고 관리자가 승인한 뒤 반영됩니다.</div></td></tr>`:'');
 }
 function msgHtml(name){
  const d=drafts.get(name),note=notes.get(name),busy=jobs.has(name);
  return `${d&&(d.typed||note)?`<button class="b2-btn small primary" data-inline-save>저장</button><button class="b2-btn small" data-inline-cancel>취소</button>`:''}${busy?`<span class="b2-saving">저장 중…${jobs.get(name).next?' · 이어서 저장 대기':''}</span>`:''}${note?`<span class="b2-err">${esc(note)}</span>`:''}`;
 }
 // 남은 초는 칩 모양(html)에 넣지 않고 따로 돌려줍니다. 초만 바뀔 때 버튼을 새로 만들지 않아야 누르는 중·키보드 포커스의 「되돌리기」가 사라지지 않습니다.
 function statusHtml(name){
  const s=sync.statusFor(keyOf(name));if(!s?.label&&!s?.actions?.length)return {html:'',sec:null};
  let label=s.label;
  for(const a of s.actions){const t=STATUS_ACTIONS[a];if(label===t)label='';else if(label.endsWith(' · '+t))label=label.slice(0,-t.length-3);}
  const sec=/^보내기 전 (\d+)초$/.exec(label);
  return {sec:sec?sec[1]:null,html:`${label?`<span class="b2-st ${esc(s.tone||'')}" data-kind="${esc(s.kind)}" title="${esc(s.detail||'')}">${sec?'보내기 전 <b class="b2-sec"></b>초':esc(label)}</span>`:''}${s.actions.map(a=>`<button class="b2-btn small ${a==='undo'?'warn':'soft'}" data-act="${a}" title="${esc(s.detail||'')}">${STATUS_ACTIONS[a]}</button>`).join('')}${s.detail?`<span class="b2-sub">${esc(s.detail)}</span>`:''}`};
 }
 const patch=(name,part,html)=>{const el=bodies.get(name)?.querySelector(`[data-${part}]`);if(el&&shown.get(part+'|'+name)!==html){el.innerHTML=html;shown.set(part+'|'+name,html);}return el;};
 const paintMsg=name=>patch(name,'msg',msgHtml(name));
 const paintStatus=name=>{const {html,sec}=statusHtml(name),b=patch(name,'status',html)?.querySelector('.b2-sec');if(b&&sec!=null&&b.textContent!==sec)b.textContent=sec;};
 // 한 학생만 다시 그립니다. 입력칸에 포커스가 있거나 초안이 있는 행은 건너뛰고 focusout 때 다시 그립니다(force는 유형 변경·되돌림처럼 화면이 바뀌어야 할 때, 포커스를 되살림).
 function paint(name,{force=false,bind=true}={}){
  const row=rowOf(name),el=bodies.get(name);if(!row||!el)return;
  const html=rowHtml(row);
  if(drawn.get(name)!==html){
   const focused=typing(el);
   if(!force&&(focused||hasDraft(name)))stale.add(name);
   else{
    const a=focused?document.activeElement:null,sel=a?.dataset.inline?`[data-inline="${a.dataset.inline}"]`:a?.dataset.f?`[data-f="${a.dataset.f}"]`:null;
    let start=null,end=null;try{start=a?.selectionStart??null;end=a?.selectionEnd??null;}catch{}
    if(opened.has(name))proposals.capture([{rowIndex:row.rowIndex,name}]);
    painting=true;
    try{
     el.innerHTML=html;drawn.set(name,html);stale.delete(name);shown.delete('msg|'+name);shown.delete('status|'+name);
     const n=sel&&el.querySelector(sel);if(n&&!n.disabled){n.focus();if(start!==null)try{n.setSelectionRange(start,end);}catch{}}
    }finally{painting=false;}
    if(bind&&opened.has(name))proposals.bind(students());
   }
  }
  paintMsg(name);paintStatus(name);
 }
 function paintRelay(){
  const el=$('#b2Relay');if(!el)return;const r=sync.relay();
  // 중계는 읽기 전용(10분마다 체크히어 기록 갱신)입니다. 요청은 켜져 있어도 자동 처리되지 않고 사람의 승인을 기다립니다.
  // 체크히어 해제 상태(중계 신호 privacy): 가려져 있어도 읽기·요청은 되고, 운영 포털에서 반영할 때만 사람이 수집 PC 체크히어 탭에서 해제합니다.
  // 중계가 꺼지면 해제 상태를 모릅니다(첫 줄). 요청(시간 삭제 포함)은 중계 없이도 만듭니다(2026-10-16). '시간 삭제 포함'은 도구줄 글처럼 삭제 조건(sync.gate())이 맞을 때만.
  const title=[r.privacy?.text||(r.on?'':PRIVACY_NEEDS_RELAY+'.'),r.on?`수집 PC 중계가 체크히어 기록을 10분마다 읽습니다(읽기 전용)${r.busy?' · 작업 중':''}`:`수집 PC의 체크히어 실시간 화면에서 중계를 켜면 체크히어 기록을 10분마다 읽어 옵니다(읽기 전용). 요청${sync.gate().enabled?'(시간 삭제 포함)':''}은 중계 없이도 만들 수 있습니다.`,
   '체크히어 반영 요청은 관리자가 운영 포털 「반영 요청·승인」에서 승인할 때만 반영됩니다.',
   r.needsUnmask?`승인한 반영 ${r.needsUnmask}건이 체크히어 개인정보 가림에 막혀 있습니다. 수집 PC 연결 프로그램의 체크히어 창(같은 탭)에서 직접 해제하거나 연결 프로그램 화면의 「마스킹 해제 시작」을 누른 뒤, 운영 포털에서 다시 반영해 주세요.`:'',r.requestsError?`체크히어 요청 목록 읽기 실패: ${r.requestsError}`:''].filter(Boolean).join('\n');
  const html=`<span class="b2-pill ${r.on&&!r.needsUnmask?'live':'wait'}" title="${esc(title)}">${esc(r.text)}</span>`;if(shown.get('relay')!==html){el.innerHTML=html;shown.set('relay',html);}
 }
 function showEmpty(html){let el=table.querySelector('tbody[data-empty]');if(!el){el=document.createElement('tbody');el.dataset.empty='';table.append(el);}el.innerHTML=`<tr><td colspan="5">${html}</td></tr>`;}
 function renderRows(){
  if(!life.alive()||!bundle)return;
  const list=visible(),counts=dayCounts(rows),diff=rows.filter(r=>compareRow(r).state==='diff').length;
  $('#b2Stats').innerHTML=[['총원',counts.총원],['출석',counts.출석],['결석',counts.결석,counts.결석?'bad':''],['지각',counts.지각],['조퇴',counts.조퇴],['외출',counts.외출],['인정',counts.인정],['체크히어 불일치',diff,diff?'alert':''],['동기화 확인',counts.확인필요,counts.확인필요?'alert':'']].map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${l}</span></div>`).join('');
  $('#b2Filters').innerHTML=FILTERS.map(([k,l])=>`<button class="b2-chip" data-filter="${k}" aria-pressed="${filter===k}">${l}</button>`).join('');
  $('#b2Sync').innerHTML=syncPill(bundle.sync);
  $('#b2Live').innerHTML=live==='live'?`<span class="b2-pill live">체크히어 실시간${records.length?` · ${records.length}명`:''}</span>`:live==='day'?`<span class="b2-pill">체크히어 저장본${records.length?` · ${records.length}명`:''}</span>`:live?`<span class="b2-pill wait">${esc(live)}</span>`:'';
  paintRelay();
  const keep=new Set(list.map(r=>r.name));
  // 빠지는 행을 지울 때 포커스가 빠지며 나는 focusout이 blur 저장을 하지 않게 합니다(입력 중인 행은 visible()이 이미 남김).
  painting=true;
  try{for(const [name,el] of bodies)if(!keep.has(name)){const row=rowOf(name);if(row&&opened.has(name))proposals.capture([{rowIndex:row.rowIndex,name}]);el.remove();bodies.delete(name);drawn.delete(name);stale.delete(name);shown.delete('msg|'+name);shown.delete('status|'+name);}}
  finally{painting=false;}
  if(list.length)table.querySelector('tbody[data-empty]')?.remove();
  else showEmpty(`<div class="b2-muted b2-pad">${rows.length?'조건에 맞는 학생이 없습니다.':'명부에 이 반 학생이 없습니다. 운영총괄 가져오기를 먼저 실행해 주세요.'}</div>`);
  let prev=table.tHead;
  for(const row of list){
   let el=bodies.get(row.name);
   if(!el){el=document.createElement('tbody');el.dataset.student=row.name;bodies.set(row.name,el);}
   if(prev.nextElementSibling!==el)prev.after(el);
   prev=el;paint(row.name,{bind:false});
  }
  if(opened.size)proposals.bind(students());
 }
 // 출결원장 행이 바뀐 학생만 rows를 고칩니다(되돌리기 저장처럼 이 화면 밖에서 묶음이 고쳐진 경우).
 function refreshRow(name){
  const i=rows.findIndex(r=>r.name===name);if(i<0)return false;
  const rec=ledgerAt(cls,date,name);if(rec===rows[i].rec)return false;
  rows[i]={...rows[i],rec,type:rec?rec.type:rows[i].enrolled?'출석':'해당없음'};return true;
 }
 // 동기화 모듈 알림: 학생 키면 그 행의 상태 칩만, null이면 전체(중계 신호·삭제 조건·요청 목록)를 다시 그립니다.
 function changed(key){if(!pend){pend=new Set();queueMicrotask(flushChanged);}pend.add(key??'*');}
 function flushChanged(){
  const keys=pend;pend=null;if(!life.alive()||!bundle)return;
  let full=keys.has('*');const names=[];
  for(const k of keys){if(k==='*')continue;const [c,d,...n]=k.split('|'),name=n.join('|');if(c!==cls||d!==date)continue;names.push(name);if(refreshRow(name))full=true;}
  if(full)return renderRows();
  names.forEach(paintStatus);
 }
 function pickDate(b){const days=b.days.filter(d=>d<=b.today).reverse();return date&&days.includes(date)?date:days[0]||'';}
 function dateOptions(){
  const days=bundle.days.filter(d=>d<=bundle.today).reverse();
  $('#b2Date').innerHTML=days.map(d=>`<option value="${d}" ${d===date?'selected':''}>${md(d)}${d===bundle.today?' · 오늘':''}</option>`).join('');
 }
 // 모든 날짜에서 저장본을 먼저 읽고(옛 저장본 대체 포함) 그날 문서를 구독해 갱신합니다. 구독은 반·날짜가 바뀔 때만 새로 겁니다.
 // 같은 반·날짜를 다시 읽을 때(새로고침)는 새 기록이 올 때까지 지금 기록을 지우지 않습니다(그사이 '기록 없음'으로 계산하지 않게).
 async function loadCheckHere(){
  const n=++chSeq,c=cls,d=date;unwatch?.();unwatch=null;if(recordsDay!==`${c}|${d}`){records=[];recordsNote='';recordsDay=`${c}|${d}`;}live='체크히어 확인 중';renderRows();
  try{
   identities=await loadCheckHereIdentities(db,c,students()).catch(()=>[]);if(n!==chSeq||!life.alive())return;
   const recs=await loadCheckHereDay(db,c,d);if(n!==chSeq||!life.alive())return;
   records=recs;live='day';if(!recs.length)recordsNote='이 날 체크히어 저장본 없음';
  }catch(e){if(n!==chSeq||!life.alive())return;live='체크히어 읽기 실패';recordsNote=e.message;}
  unwatch=watchCheckHereDay(db,c,d,recs=>{if(n!==chSeq||!life.alive())return;records=recs;recordsNote=recs.length?'':'이 날 체크히어 저장본 없음';live='live';sync.recordsChanged();renderRows();},e=>{if(n===chSeq&&life.alive()){live='실시간 연결 끊김';recordsNote=e.message;renderRows();}});
  sync.recordsChanged();renderRows();
 }
 // to: 바꿀 반. 반은 묶음을 다 읽은 뒤에 바꿉니다(그동안 화면·저장은 지금 반 그대로라 반과 학생이 섞이지 않음). 못 읽으면 반 선택을 되돌립니다.
 async function load({fresh=false,keepCheckHere=false,to=cls}={}){
  const n=++seq,from=cls;say('');
  try{
   // 읽는 사이 이 화면의 저장이 끝났으면 그 저장이 빠진 묶음일 수 있어 다시 읽습니다(옛 지문으로 '시트가 바뀜'·옛 값 다시 보내기가 되지 않게).
   let b,gen;do{gen=saveGen;b=await client.bundle(to,{fresh});if(n!==seq||!life.alive())return;fresh=true;}while(gen!==saveGen);
   const next=pickDate(b),moved=next!==date||to!==from;
   // S10: 반·날짜가 바뀌면 화면 값을 바꾸기 전에 동기화 모듈에 먼저 알립니다(남은 반영 대기는 확인 후 보내거나 취소).
   const r=await sync.setDay(to,next);if(n!==seq||!life.alive())return;
   if(to!==from){cls=to;clearEdits();}
   bundle=b;date=next;dateOptions();rows=dayView(bundle,cls,date);
   if(editing&&!rows.some(r=>r.name===editing)){editing=null;form=null;}
   for(const k of [...drafts.keys()])if(!rows.some(r=>r.name===k))drafts.delete(k);
   renderRows();stopped(r);
   if(!keepCheckHere||moved)await loadCheckHere();
   if(opened.size&&proposalsLoaded!==`${cls}|${date}`){proposalsLoaded=`${cls}|${date}`;await proposals.load(cls,date);renderRows();}
  }catch(e){if(n!==seq||!life.alive())return;if(to!==from){$('#b2Class').value=cls;say(`${to}반을 불러오지 못해 ${cls}반을 그대로 보입니다: ${e.message}`,'err');}else showEmpty(errorBox(e));}
 }
 // 반·날짜를 바꿔 멈춘 체크히어 반영 대기(진행 중 요청·기록을 기다리던 것)를 알립니다.
 // 확인창(S8)을 거치지 않아 보내지 않은 체크히어 시간 삭제(결석 저장의 3초)도 알립니다.
 function stopped(r){const text=[r?.stopped?.length?`체크히어 반영을 기다리던 ${r.stopped.join(', ')} 학생은 반·날짜를 바꿔 멈췄습니다. 그 날로 돌아가 「체크히어 맞추기」로 보낼 수 있습니다.`:'',r?.unconfirmed?.length?`${r.unconfirmed.join(', ')} 학생의 체크히어 시간 삭제는 확인창을 거치지 않아 보내지 않았습니다. 그 날로 돌아가 「체크히어 맞추기」(×로 지운 것은 ×)로 다시 보내 주세요.`:''].filter(Boolean).join(' ');if(text)say(text,'warn');}
 function openEditor(row){editing=row.name;formErr='';form={ev:row.rec?.ev||'',evr:row.rec?.evr||'',dirty:false};}

 // 입력 확인(beta2.gs b2Validate_와 같은 기준). 못 지나가면 '입력 필요: …'와 그 칸
 function missing(v){
  if(!B2_TYPES.includes(v.type))return {field:'type',text:'입력 필요: 유형'};
  const need=neededTimes(v.type,ALL);
  if(need.inT&&!v.inT)return {field:'inT',text:'입력 필요: 입실 시간'};
  if(need.outT&&!v.outT)return {field:'outT',text:'입력 필요: 퇴실 시간'};
  if(need.oa&&!v.oa)return {field:'oa',text:'입력 필요: 외출 시작 시간'};
  if(need.ob&&!v.ob)return {field:'ob',text:'입력 필요: 외출 종료 시간'};
  if(need.oa&&v.ob<=v.oa)return {field:'ob',text:'외출 종료가 시작보다 늦어야 합니다'};
  if(recognizedType(v.type)&&!String(v.reason||'').trim())return {field:'reason',text:'입력 필요: 사유'};
  return null;
 }
 function focusField(name,field){const n=bodies.get(name)?.querySelector(`[data-inline="${field}"]`);if(n&&!n.disabled){painting=true;try{n.focus();}finally{painting=false;}}}
 function setDraft(name,field,value){
  const row=rowOf(name);if(!row)return;
  const cur=drafts.get(name),next={...valuesOf(row),typed:!!cur?.typed,[field]:value};
  if(!next.typed&&sameAs(next,saved(row)))drafts.delete(name);else drafts.set(name,next);
 }
 // 유형을 바꾸면 아직 저장하지 않습니다. 필요한 시간은 체크히어 값으로 미리 채우고 「저장」·「취소」를 보입니다.
 function setType(name,type){
  const row=rowOf(name);if(!row)return;
  const t=timesFromRecord(matchFor(row)),need=neededTimes(type,ALL),d={...valuesOf(row),type,typed:true};
  for(const k of TIMES)if(need[k]&&!d[k])d[k]=t[k]||'';
  if(type===saved(row).type&&sameAs(d,saved(row)))drafts.delete(name);else drafts.set(name,d);
  notes.delete(name);paint(name,{force:true});
 }
 function revert(name,field){
  const row=rowOf(name),d=drafts.get(name);notes.delete(name);
  if(row&&d){if(d.typed||field==='type')drafts.delete(name);else{const next={...d,[field]:saved(row)[field]};if(sameAs(next,saved(row)))drafts.delete(name);else drafts.set(name,next);}}
  paint(name,{force:true});
 }
 // 저장: 유형을 바꾼 행은 「저장」·Enter(explicit)로만, 이미 저장된 행의 시간·사유는 blur·Enter 때 바뀌었으면 저장합니다.
 function commit(name,{explicit=false}={}){
  const row=rowOf(name),d=drafts.get(name);if(!row||(!row.enrolled&&!row.rec))return;
  if(!d){if(explicit&&notes.has(name)){notes.delete(name);paintMsg(name);}return;}
  if(d.typed&&!explicit)return;
  const v=valuesOf(row);
  if(sameAs(v,saved(row))){drafts.delete(name);notes.delete(name);paint(name);return;}
  const miss=missing(v);
  if(miss){notes.set(name,miss.text);paintMsg(name);if(explicit)focusField(name,miss.field);return;}
  notes.delete(name);queueSave(name,'inline');
 }
 // 학생마다 저장은 한 번에 하나. 저장 중에 또 저장하면 마지막 초안만 대기시켰다가 이어서 저장합니다.
 function queueSave(name,kind){const j=jobs.get(name);if(j){j.next=kind;paintMsg(name);return;}void runJobs(name,kind);}
 async function runJobs(name,kind){
  let end;const j={next:null,done:new Promise(r=>{end=r;})},day=`${cls}|${date}`;jobs.set(name,j);paintMsg(name);
  try{while(kind&&life.alive()&&sameDay(day)){const ok=await saveOnce(name,kind);kind=ok?j.next:null;j.next=null;}}
  catch(e){if(life.alive())say(e.message,'err');}
  finally{if(jobs.get(name)===j)jobs.delete(name);if(life.alive()&&sameDay(day))paint(name,{force:editing===name});end();} // 증빙 편집기는 '저장 중…' 버튼을 되살림
 }
 async function saveOnce(name,kind){
  const key=keyOf(name),day=`${cls}|${date}`;
  if(kind==='undo'){
   // S9: 3초 안 되돌리기는 요청을 보내지 않고 출결원장도 저장 전 값으로 되돌립니다(동기화 모듈이 client.save를 부름).
   const r=await sync.undo(key);if(r.row&&r.res)saveGen++;if(!life.alive()||!sameDay(day))return false;
   if(r.error?.code==='CONFLICT'||r.released)await load({fresh:true,keepCheckHere:true});
   if(r.released)toast(`${name} · ${md(date)} 체크히어 반영을 취소하고 출결원장을 운영총괄 값으로 되돌렸습니다.`);
   else if(r.ok&&r.row){if(!r.res?.unchanged&&ledgerAt(cls,date,name)?.sig!==r.res?.sig)try{bundle=await client.bundle(cls);}catch{}toast(`${name} · ${md(date)} 체크히어 반영을 취소하고 출결원장을 ${r.row.type}(으)로 되돌렸습니다.`);}
   else if(r.ok&&r.kept)toast(`${name} · ${md(date)} 체크히어 반영을 취소했습니다. 이전 값은 출결원장에 다시 저장할 수 없어 그대로 둡니다.`);
   else if(!r.ok&&r.reason){notes.set(name,`되돌리지 못함 · ${r.reason}`);paintMsg(name);}
   if(!life.alive()||!sameDay(day))return false;
   rows=dayView(bundle,cls,date);renderRows();return !!r.ok;
  }
  const row=rowOf(name);if(!row)return false;
  const rec=row.rec;let v,ev,evr;
  if(kind==='evidence'){
   if(!form||editing!==name)return true;
   v=saved(row);ev=form.ev||'';evr=form.evr||'';formErr='';
   if(!B2_TYPES.includes(v.type)){formErr='유형을 먼저 골라 저장해 주세요.';paint(name,{force:true});return false;}
   if(ev==='반려'&&!evr.trim()){formErr='반려 사유를 적어 주세요.';paint(name,{force:true});return false;}
  }else{
   if(!drafts.has(name))return true;
   v=valuesOf(row);if(sameAs(v,saved(row))){drafts.delete(name);return true;}
   const miss=missing(v);if(miss){notes.set(name,miss.text);paintMsg(name);return false;}
   ev=rec?.ev||'';evr=rec?.evr||'';
  }
  const payload={cls,name,date,type:v.type,...neededTimes(v.type,v),reason:String(v.reason||'').trim(),ev:v.type==='출석'?'':ev,evr:v.type!=='출석'&&ev==='반려'?evr.trim():'',before:rec?.sig||''};
  const prevRow=rec?pick(rec):null,sent={...v};
  sync.saveStarted(key);notes.delete(name);
  if(kind==='evidence')paint(name,{force:true});else paintMsg(name);
  let res;
  try{res=await client.save(payload);saveGen++;}
  catch(e){
   sync.saveFailed(key,e);if(!life.alive()||!sameDay(day))return false;
   if(e.code==='CONFLICT'&&kind==='evidence'){
    // 증빙 편집기는 닫지 않고 고른 증빙·반려 사유를 그대로 둔 채 최신 기록을 불러옵니다(행이 증빙을 받을 수 없게 바뀌었으면 닫음).
    await load({fresh:true,keepCheckHere:true});if(!life.alive()||!sameDay(day))return false;
    const now=rowOf(name);
    if(editing===name&&form&&now&&evidenceOk(now))formErr='그사이 바뀐 기록이 있어 최신 값을 불러왔습니다. 확인 후 다시 저장해 주세요.';
    else{if(editing===name){editing=null;form=null;}notes.set(name,'그사이 바뀜 · 최신 값 표시');}
    paint(name,{force:true});
   }else if(e.code==='CONFLICT'){
    // 그사이 바뀜: 최신 값을 불러와 보이고, 그 학생 초안과 체크히어 반영 대기는 버립니다.
    drafts.delete(name);
    notes.set(name,'그사이 바뀜 · 최신 값 표시');await load({fresh:true,keepCheckHere:true});if(life.alive())paint(name,{force:true});
   }else if(kind==='evidence'){formErr=e.message;paint(name,{force:true});}
   else{notes.set(name,e.message);paintMsg(name);}
   return false;
  }
  // S5: 다음 before는 res.sig, unchanged면 지금 sig(기록 없으면 ''). 결과는 먼저 동기화 모듈에 알립니다('저장 중'으로 멈춘 보류가 남지 않게).
  const sig=res.unchanged?(rec?.sig||''):String(res.sig||'');
  sync.afterSave(key,{prevRow,row:{type:payload.type,inT:payload.inT,outT:payload.outT,oa:payload.oa,ob:payload.ob,reason:payload.reason,ev:payload.ev,evr:payload.evr},sig,existedBefore:!!rec,unchanged:!!res.unchanged});
  if(!life.alive()||!sameDay(day))return false;
  // client.save가 들고 있는 묶음을 고칩니다. 캐시가 바뀌어 이 화면의 묶음이 고쳐지지 않았으면 캐시본으로 바꿉니다(통째로 다시 읽지 않음).
  // 그래도 지문이 다르면 보내기 직전 확인(S3)이 '시트가 그사이 바뀜'으로 멈춥니다.
  if(!res.unchanged&&ledgerAt(cls,date,name)?.sig!==sig){try{bundle=await client.bundle(cls);}catch{}if(!life.alive()||!sameDay(day))return false;}
  rows=dayView(bundle,cls,date);
  const now=rowOf(name);
  if(kind==='inline'&&now&&drafts.has(name)&&sameAs(valuesOf(now),sent))drafts.delete(name);
  if(kind==='evidence'){editing=null;form=null;formErr='';}
  toast(`${name} · ${md(date)} ${payload.type} 저장했습니다.`);
  renderRows();if(kind==='evidence')paint(name,{force:true});
  return true;
 }
 async function act(name,action){
  const key=keyOf(name);
  // 되돌리기는 그 학생의 아직 저장하지 않은 입력도 버립니다(되돌린 뒤 그 초안이 다시 저장되지 않게).
  if(action==='undo'){drafts.delete(name);notes.delete(name);return queueSave(name,'undo');}
  if(action==='withdraw'){try{if(!await sync.withdraw(key))say('취소할 승인 대기 요청이 없습니다.','warn');}catch(e){say(e.message,'err');}return;}
  if(action==='retry')sync.retry(key);else if(action==='suggest')sync.suggest(key);
  paintStatus(name);
 }

 host.addEventListener('input',e=>{
  const t=e.target,k=t.dataset?.inline,name=t.closest?.('tbody[data-student]')?.dataset.student;
  if(k&&k!=='type'&&name){setDraft(name,k,t.value);return;}
  const f=t.dataset?.f;if(f&&f!=='ev'&&form){form[f]=t.value;form.dirty=true;}
 });
 host.addEventListener('change',e=>{
  const t=e.target,name=t.closest?.('tbody[data-student]')?.dataset.student;
  if(t.dataset?.inline==='type'&&name){setType(name,t.value);return;}
  if(t.dataset?.f==='ev'&&form&&editing){form.ev=t.value;form.dirty=true;paint(editing,{force:true});}
 });
 host.addEventListener('keydown',e=>{
  const k=e.target.dataset?.inline,name=e.target.closest?.('tbody[data-student]')?.dataset.student;if(!k||!name||e.isComposing||e.keyCode===229)return;
  if(e.key==='Enter'){e.preventDefault();commit(name,{explicit:true});}
  else if(e.key==='Escape'){e.preventDefault();revert(name,k);}
 });
 // blur 저장, 그리고 포커스 때문에 미뤄 둔 행 다시 그리기
 host.addEventListener('focusout',e=>{
  if(painting)return;
  const tb=e.target.closest?.('tbody[data-student]');if(!tb)return;const name=tb.dataset.student,k=e.target.dataset?.inline;
  if(k&&k!=='type'&&!drafts.get(name)?.typed)commit(name);
  if(!tb.contains(e.relatedTarget))setTimeout(()=>{if(life.alive()&&stale.has(name)&&!typing(tb))paint(name);},0);
 });
 // 손댄 학생은 필터에서 빠져도 남깁니다(pinned). 「되돌리기」는 누르는 순간(pointerdown) 처리합니다: 누르는 사이 칩이 바뀌거나
 // 같은 행 입력칸의 blur 저장으로 버튼이 다시 그려져도 되돌리기가 조용히 사라지지 않게(키보드 Enter·Space는 click으로).
 host.addEventListener('focusin',e=>{const name=e.target.closest?.('tbody[data-student]')?.dataset.student;if(name)pinned.add(name);});
 host.addEventListener('pointerdown',e=>{
  const t=e.target.closest?.('button'),name=t?.closest('tbody[data-student]')?.dataset.student;if(!name)return;pinned.add(name);
  if(e.button===0&&t.dataset.act==='undo'&&!t.disabled)void act(name,'undo');
 });
 host.addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t||!host.contains(t))return;
  if(t.dataset.filter){filter=t.dataset.filter;pinned.clear();renderRows();return;}
  const name=t.closest('tbody[data-student]')?.dataset.student,row=name?rowOf(name):null;if(!row)return;
  if(t.hasAttribute('data-inline-save')){commit(name,{explicit:true});return;}
  if(t.hasAttribute('data-inline-cancel')){drafts.delete(name);notes.delete(name);paint(name,{force:true});return;}
  if(t.dataset.hint){drafts.set(name,{...valuesOf(row),typed:!!drafts.get(name)?.typed,reason:t.dataset.hint});paint(name,{force:true});focusField(name,'reason');return;}
  if(t.dataset.act==='undo'&&e.detail!==0)return; // 마우스·터치는 pointerdown에서 이미 처리
  if(t.dataset.act){await act(name,t.dataset.act);return;}
  if(t.dataset.chDel){
   // 확인창(지울 시간, 실제 입실 기록은 남음)은 sync.send가 띄웁니다. 못 지우면 이유를 알립니다(확인창에서 '아니오'면 조용히 끝).
   const r=await sync.send(keyOf(name),{deleteTimes:[t.dataset.chDel]});if(!r.ok&&r.reasons?.length)say(`${name}: ${r.reasons.join(' · ')}`,'warn');paintStatus(name);return;
  }
  if(t.hasAttribute('data-edit')){
   if(editing===name){if(form?.dirty&&!confirm('저장하지 않은 증빙 수정이 있습니다. 닫을까요?'))return;editing=null;form=null;}
   else{if(editing&&form?.dirty&&!confirm('다른 학생의 저장하지 않은 증빙 수정이 있습니다. 버리고 열까요?'))return;const prev=editing;openEditor(row);if(prev)paint(prev,{force:true});}
   paint(name,{force:true});return;
  }
  if(t.hasAttribute('data-req')){
   if(opened.has(name)){proposals.capture([{rowIndex:row.rowIndex,name}]);opened.delete(name);}
   else{opened.add(name);if(proposalsLoaded!==`${cls}|${date}`){proposalsLoaded=`${cls}|${date}`;paint(name,{force:true});await proposals.load(cls,date);}}
   paint(name,{force:true});return;
  }
  if(t.hasAttribute('data-cancel')){editing=null;form=null;formErr='';paint(name,{force:true});return;}
  if(t.hasAttribute('data-save')){queueSave(name,'evidence');return;}
  if(t.hasAttribute('data-release')){
   if(!confirm(`${name} · ${md(date)} 기록을 운영총괄 값으로 되돌릴까요?\n베타에서 고친 내용은 없어지고 이 반을 운영총괄에서 다시 가져옵니다.`))return;
   t.disabled=true;say('운영총괄에서 이 반을 다시 가져오는 중…');
   try{const r=await client.release({cls,name,date});toast(r.released?'운영총괄 값으로 되돌렸습니다.':'되돌릴 기록이 없습니다.');await load({fresh:true,keepCheckHere:true});}catch(err){say(err.message,'err');}
  }
 });
 // 반·날짜 바꾸기: 저장 중이면 저장이 끝나기를 기다리고(칸을 벗어나며 시작된 blur 저장 때문에 거절하지 않음), 초안은 확인하고,
 // 체크히어 반영 대기는 화면 값을 바꾸기 전에 sync.setDay가 확인합니다(S10). 바꾸는 동안 표는 잠급니다(inert).
 async function leaving(what){
  if(jobs.size){say('출결원장 저장이 끝나면 바꿉니다…');await Promise.allSettled([...jobs.values()].map(j=>j.done));if(!life.alive())return false;say('');}
  return !(drafts.size||(editing&&form?.dirty))||confirm(`저장하지 않은 수정이 있습니다. ${what} 바꿀까요?`);
 }
 function clearEdits(){drafts.clear();notes.clear();pinned.clear();editing=null;form=null;formErr='';opened.clear();}
 async function switchTo(sel,run){
  if(switching){sel.value=sel===$('#b2Class')?cls:date;return;}
  switching=true;table.inert=true;
  try{await run();}finally{switching=false;table.inert=false;if(life.alive()){$('#b2Class').value=cls;$('#b2Date').value=date;}}
 }
 $('#b2Class').onchange=e=>switchTo(e.target,async()=>{const next=e.target.value;if(await leaving('반을'))await load({to:next});});
 $('#b2Date').onchange=e=>switchTo(e.target,async()=>{
  const next=e.target.value;if(!await leaving('날짜를'))return;
  const r=await sync.setDay(cls,next);if(!life.alive())return;
  date=next;clearEdits();rows=dayView(bundle,cls,date);void loadCheckHere();stopped(r);
 });
 $('#b2Search').oninput=e=>{search=e.target.value;pinned.clear();renderRows();};
 $('#b2Reload').onclick=()=>{if(switching)return;if(jobs.size||drafts.size)return say('저장 중이거나 저장하지 않은 수정이 있어 새로 읽지 않았습니다.','warn');void load({fresh:true});};
 $('#b2Pull').onclick=async e=>{if(switching)return;e.target.disabled=true;say(`${cls}반을 운영총괄에서 가져오는 중… (보통 5초 안팎)`);try{const r=await client.syncNow({cls}),s=r?.stats||{};await load({fresh:true,keepCheckHere:true});say(`${cls}반 가져오기 완료 · 추가 ${s.added||0} · 수정 ${s.updated||0} · 삭제 ${s.removed||0} · 확인 필요 ${s.flagged||0}${r?.errors?.length?' · 오류: '+r.errors.join(', '):''}`,r?.errors?.length?'warn':'');}catch(err){say(err.message,'err');}finally{e.target.disabled=false;}};
 // 시트 변경 번호가 바뀌면 다시 읽습니다. 반·날짜를 바꾸는 중·저장 중·초안 있음·행 입력칸 포커스면 이번에는 건너뜁니다(다음 확인 때 다시).
 const stopWatch=client.watch(async()=>{
  const a=document.activeElement,focused=!!a&&host.contains(a)&&a.matches('input,select,textarea')&&!a.closest('.b2-toolbar');
  if(!life.alive()||switching||jobs.size||drafts.size||(editing&&form?.dirty)||focused)return;
  await load({fresh:true,keepCheckHere:true});
 },{current:()=>bundle?.rev||0});
 const warn=e=>{if(jobs.size||drafts.size||sync.holds().length){e.preventDefault();e.returnValue='';}};
 addEventListener('beforeunload',warn);
 // 중계 신호 'n분 전'과 반영 대기 90초·반영 중 3분 안내는 30초마다 다시 봅니다(초 단위 남은 시간은 동기화 모듈이 보류가 있을 때만 알림).
 // × title의 '반영할 때 해제 필요'는 해제 남은 시간이 줄거나 중계 신호가 3분 지나면 시계만으로도 바뀌므로, 바뀌면 행을 다시 그려 ×를 맞춥니다(삭제 조건·v2는 신호가 올 때 다시 그림).
 const gateMark=()=>{const g=sync.gate();return `${g.enabled}|${!!g.v2}|${needsUnmaskOnApply(sync.relay().privacy)}`;};
 let gateOn=gateMark();
 const clock=setInterval(()=>{if(!life.alive())return;paintRelay();const g=gateMark();if(g!==gateOn){gateOn=g;return renderRows();}for(const name of bodies.keys())paintStatus(name);},30000);
 life.on(()=>unwatch?.());life.on(stopWatch);life.on(()=>removeEventListener('beforeunload',warn));life.on(()=>clearInterval(clock));
 await load();
 return {
  // S15: 저장 중이면 막고, 초안은 확인하고, 체크히어 반영 대기는 확인 후 지금 보냅니다(보내기가 끝난 뒤 동기화 모듈을 닫음).
  // 진행 중 요청·기록을 기다리는 보류는 보낼 수 없어 멈춘다는 것을 따로 셉니다. 보내기를 시작하면 구독은 바로 끊습니다(leave).
  canLeave(){
   if(jobs.size){say('출결원장 저장 중입니다. 저장이 끝난 뒤 이동해 주세요.','warn');return false;}
   if((drafts.size||(editing&&form?.dirty))&&!confirm('저장하지 않은 출결 수정이 있습니다. 화면을 떠날까요?'))return false;
   // 확인창(S8)을 거치지 않은 시간 삭제는 떠나면서 보내지 않으므로 따로 셉니다.
   const hs=sync.holds(),asks=hs.filter(h=>h.needsConfirm).length,ready=hs.filter(h=>h.sendable).length-asks,waiting=hs.filter(h=>h.phase==='waiting').length;
   const stop=[waiting?`진행 중 요청·기록을 기다리는 체크히어 반영 ${waiting}건은 보내지 못하고 멈춥니다(돌아와서 「체크히어 맞추기」로 보낼 수 있음).`:'',asks?`확인창을 거치지 않은 체크히어 시간 삭제 ${asks}건은 보내지 않고 멈춥니다(돌아와서 다시 보내 주세요).`:''].filter(Boolean).join('\n');
   if(ready&&!confirm(`체크히어 반영 대기 ${ready}건이 있습니다. 지금 보내고 화면을 떠날까요?${stop?'\n'+stop:''}`))return false;
   if(!ready&&stop&&!confirm(`${stop}\n화면을 떠날까요?`))return false;
   if(hs.length)flushing=sync.flushAll({leave:true}).catch(()=>null);
   return true;
  },
  dispose(){life.dispose();if(flushing)void flushing.finally(()=>sync.dispose());else sync.dispose();}
 };
}
