// 2기 중도탈락·수료(사용자 요청 2026-10-20: "중도탈락 시트(마스터시트 gid 4002 '중도탈락' 탭)도 관리자페이지에서 전부 처리", "담임 화면에서 중도포기자 등록하면 관리자 측에서도 손볼 수 있게").
// 관리자: 중도탈락 탭 A~R 모든 칸 보기·등록·고치기·관리자 확인(여러 건 한꺼번에)·지우기, 결석 한도(12일) 판정, 수료 명단(b2Completions)과 수료 처리(b2RosterStatusMany).
// 담임(teacherClass, 사용자 2026-10-20 "담임 화면의 중도탈락은 보다 간단히 '신청' 개념임. 완벽한 시트 업무처리는 우리 관리자가 해야함. 물론 수료 유무 등은 담임이 확인만은 가능하게"):
//   짧은 신청 칸(교육생·구분·사유·마지막 출석일·근로개시일·메모) → 신청하기, 아래 '우리 반 신청 현황'(보기만, 자기가 신청하고 확인 전인 줄만 '신청 취소'),
//   '수료 확인'(수료·수료 예정·확인 대기·미수료와 결석 한도, 보기만). 판정·서류·연락 확인·관리자 확인·수료 처리는 운영팀만. 신청하면 관리자에게 알림(notify '중도탈락').
//   신청 뒤 고치기는 없습니다(api/teacher-beta.js가 담임의 기존 줄 고치기를 거절).
// 관리자 목록에는 담임이 신청한 줄에 '담임 신청' 표시, '담임 신청 대기'(담임 신청 · 확인 전) 거르기가 있습니다.
// 저장하면 Apps Script가 명부 상태(D·E·I)도 함께 바꾸고 그 반 출결판을 다시 그립니다. 지우면 명부가 아직 그 구분이면 재학으로 되돌립니다.
// 17반 테스트반은 목록에 '테스트반'으로 보이고 위 숫자 상자(공식 합계)에서는 빠집니다.
import {esc,md,toast,classOptions,loading,errorBox,lifecycle,downloadCsv} from './beta2-ui.mjs';
import {forgetBeta2Cache} from './beta2-data.mjs';
import {ledgerIndex,studentStats} from './beta2-core.mjs';
import {DROPOUT_KINDS,DROPOUT_VERDICTS,DROPOUT_DOCS,DOC_FIELDS,DROPOUT_COLUMNS,OUTCOMES,maxOf,dropoutKey,absenceRows,absenceLevel,suggestVerdict,checkDropout,savePayload,formOf,sameForm,completionRows,official,statusBatches,requestPayload,byTeacher,requestState,canCancel} from './beta2-dropout-core.mjs';
import {COURSE_START,COURSE_END,isTestClass} from './cohort.mjs';
import {linkFor} from './notify-core.mjs';

const ADMIN_VIEWS=[['list','중도탈락·조기취업'],['absence','결석 한도'],['complete','수료 명단']],TEACHER_VIEWS=[['list','중도탈락 신청'],['complete','수료 확인']];
const VERDICT_TONE={'수료가능':'e-ok','제적':'t-absent','확인중':'t-late'},KIND_TONE={'중도탈락':'t-absent','조기취업':'t-rec'},OUTCOME_TONE={'수료':'e-ok','수료 예정':'t-rec','확인 대기':'t-late','미수료':'t-absent'};
const STYLE=`.b2d .b2d-filters{display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:0 14px 10px}
.b2d .b2d-batch{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;background:#f0f9ff;border-top:1px solid var(--b2-line);font-size:13px;font-weight:800}
.b2d .b2d-batch[hidden]{display:none}.b2d td.b2d-act{white-space:nowrap}.b2d td.b2d-act .b2-btn{margin:0 4px 4px 0}
.b2d .b2-editor{margin:10px 14px}.b2d .b2-editor .row .b2-field{flex:1 1 150px}.b2d .b2-editor .row .b2-field.wide{flex:2 1 260px}
.b2d .b2d-check{display:inline-flex;gap:6px;align-items:center;font-size:13px;font-weight:800}
.b2d .b2d-docs{display:flex;gap:4px;flex-wrap:wrap}.b2d .b2-name{white-space:nowrap}.b2d .b2d-date{white-space:nowrap}
.b2d .b2d-req{margin:12px 14px}.b2d .b2d-req h3{margin:0 0 12px}.b2d .b2d-sec{margin:14px 14px 6px;font-size:15px}
@media(max-width:760px){.b2d .b2-editor{margin:10px 8px}.b2d .b2-editor .row .b2-field,.b2d .b2-editor .row .b2-field.wide{flex:1 1 100%}.b2d .b2d-req{margin:10px 8px}}`;
const classLabel=id=>isTestClass(id)?`${id}반 · 테스트반`:`${id}반`;
const dateText=v=>v?md(v):'-';
const defaultNotify=(kind,payload)=>import('./notify.mjs').then(m=>m.notify(kind,payload)).catch(e=>console.warn('중도탈락 알림을 남기지 못했습니다',e));
const statBoxes=items=>`<div class="b2-stats" style="padding-top:12px">${items.map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
const chips=(name,list,cur)=>`<div class="b2-chips" data-chips="${name}">${list.map(([k,l,n])=>`<button class="b2-chip" data-${name}="${esc(k)}" aria-pressed="${cur===k}">${esc(l)}${n===undefined?'':`<span class="n">${n}</span>`}</button>`).join('')}</div>`;
const table=(head,trs,empty='해당하는 줄이 없습니다.')=>`<div class="b2-table-wrap"><table class="b2-table"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${trs.length?trs.join(''):`<tr><td colspan="${head.length}"><div class="b2-muted b2-pad">${esc(empty)}</div></td></tr>`}</tbody></table></div>`;
const tell=(notify,kind,payload)=>{try{void notify(kind,payload);}catch(e){console.warn(e);}};
const TEACHER_BADGE='<span class="b2-badge t-rec" title="담임이 담임 화면에서 신청한 줄">담임 신청</span>';

export async function mount(host,opts={}){
 if(opts.teacherClass)return mountTeacher(host,opts);
 return mountAdmin(host,opts);
}

/* ========== 관리자: 중도탈락 탭 A~R 모두 처리 ========== */
async function mountAdmin(host,{client,classes=[],selected,context,hideHead=false,notify=defaultNotify}={}){
 const life=lifecycle(host),admin=true,VIEWS=ADMIN_VIEWS;
 let view=VIEWS.some(([k])=>k===context?.tab)?context.tab:'list';
 let cls=String(context?.classId||'all'),search='',kindF='all',stateF=['all','wait','teacher','done'].includes(context?.state)?context.state:'all',riskOnly=true,outcomeF='all';
 let rows=[],max=12,bundle=null,completions=[],err='',seq=0,editor=null,busy='',batchNote='';
 const picked=new Set(),pickedDone=new Set();
 host.innerHTML=`<div class="b2 b2d"><style>${STYLE}</style>${hideHead?'':`<div class="b2-head"><div><h2>중도탈락·수료</h2><p>마스터시트 「중도탈락」 탭을 여기서 모두 처리합니다. 저장하면 탭과 명부 상태(재학·중도탈락·조기취업·수료)가 함께 바뀌고 그 반 출결판도 다시 그려집니다. 담임은 담임 화면에서 신청만 하고(「담임 신청」 표시), 판정·서류·확인·수료 처리는 여기서 합니다.</p></div></div>`}
 <div class="b2-tabs" role="tablist" id="d2Tabs"></div>
 <section class="b2-card"><div class="b2-toolbar"><label class="b2-field">반<select id="d2Class">${classOptions(classes,cls,{all:true})}</select></label>
  <label class="b2-field">이름 찾기<input id="d2Search" autocomplete="off" placeholder="이름"></label><span class="b2-grow"></span>
  <button class="b2-btn primary" id="d2New">새로 등록</button><button class="b2-btn" id="d2Csv">CSV 내려받기</button><button class="b2-btn" id="d2Reload">새로고침</button></div>
  <div id="d2Body">${loading('중도탈락 탭을 불러오는 중…')}</div></section></div>`;
 const $=s=>host.querySelector(s),body=$('#d2Body');
 let csv=[];
 const inClass=r=>cls==='all'||String(r.cls)===cls;
 const found=r=>!search||String(r.name).includes(search);
 const rowByNum=n=>rows.find(r=>r.row===Number(n))||null;
 let memo={bundle:null,index:null,stats:null};
 const derived=()=>{if(memo.bundle!==bundle){memo={bundle,index:ledgerIndex(bundle),stats:new Map(studentStats(bundle,{withTest:true}).map(s=>[dropoutKey(s),s]))};}return memo;};
 const suggest=r=>bundle?suggestVerdict(r,bundle,{max,index:derived().index}):{verdict:'',basis:'',absent:null};
 const dirty=()=>!!editor&&!editor.saving&&!sameForm(editor.form,editor.base);
 const leaveOk=what=>!dirty()||confirm(`저장하지 않은 중도탈락 입력이 있습니다. ${what} 사라집니다. 계속할까요?`);
 const testNote=(n,what)=>n?`<div class="b2-note" style="margin:0 14px 10px">테스트반 ${esc(what)} ${n}건은 목록에만 보이고 위 숫자에는 넣지 않았습니다.</div>`:'';

 /* ---------- 편집 칸 ---------- */
 function people(c){return (bundle?.roster||[]).filter(p=>p.cls===String(c));}
 function editorHtml(){
  const f=editor.form,cur=editor.key==='new'?null:rowByNum(editor.key),dis=editor.saving?'disabled':'',sel=(k,list,v,label,blank='')=>`<label class="b2-field">${label}<select data-f="${k}" ${dis}>${blank!==null?`<option value="">${esc(blank)}</option>`:''}${list.map(x=>`<option value="${esc(x)}" ${x===v?'selected':''}>${esc(x)}</option>`).join('')}</select></label>`;
  const names=people(f.cls),known=names.some(p=>p.name===f.name);
  const nameOpts=`<option value="">학생 선택</option>${known||!f.name?'':`<option value="${esc(f.name)}" selected>${esc(f.name)} (명부에 없음)</option>`}${names.map(p=>`<option value="${esc(p.name)}" ${p.name===f.name?'selected':''}>${esc(p.name)}${p.status&&p.status!=='재학'?` (${esc(p.status)})`:''}</option>`).join('')}`;
  const sg=f.cls&&f.name?suggest(f):null;
  return `<div class="b2-editor" data-editor="${esc(editor.key)}"><b>${cur?`${esc(classLabel(cur.cls))} ${esc(cur.name)} 고치기 (시트 ${cur.row}행)`:'새로 등록'}</b>
   <div class="row"><label class="b2-field">반<select data-f="cls" ${dis}><option value="">반 선택</option>${classes.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===f.cls?'selected':''}>${esc(classLabel(c.id))}</option>`).join('')}</select></label>
    <label class="b2-field">이름<select data-f="name" ${dis} aria-label="이름">${nameOpts}</select></label>
    ${sel('kind',DROPOUT_KINDS,f.kind,'구분',null)}
    <label class="b2-field">근로개시일${f.kind==='조기취업'?' (필수)':''}<input type="date" data-f="startDate" value="${esc(f.startDate)}" ${dis}></label>
    <label class="b2-field">마지막 출석일 (필수)<input type="date" data-f="lastDate" min="${isTestClass(f.cls)?'':COURSE_START}" max="${COURSE_END}" value="${esc(f.lastDate)}" ${dis}></label></div>
   <div class="row"><label class="b2-field wide">사유<input data-f="reason" maxlength="200" placeholder="예: 11/20 ○○㈜ 입사, 개인 사정" value="${esc(f.reason)}" ${dis}></label>
    <label class="b2-field wide">비고<input data-f="note" maxlength="300" value="${esc(f.note)}" ${dis}></label></div>
   <div class="row">${sel('verdict',DROPOUT_VERDICTS,f.verdict,'판정','판정 전')}<label class="b2-field wide">판정 근거<input data-f="basis" maxlength="300" value="${esc(f.basis)}" ${dis}></label>
    <button type="button" class="b2-btn soft" data-act="suggest" ${sg&&!editor.saving?'':'disabled'}>계산값 넣기</button></div>
    <div class="b2-sub" data-suggest>${sg?`계산(결석 한도 ${max}일): ${esc(sg.verdict)} · ${esc(sg.basis)}`:'반·이름을 고르면 판정을 계산합니다.'}</div>
    <div class="row">${DOC_FIELDS.map(([k,l])=>sel('docs.'+k,DROPOUT_DOCS,f.docs[k],l,'-')).join('')}<label class="b2-field wide">연락 확인<input data-f="contact" maxlength="300" value="${esc(f.contact)}" ${dis}></label></div>
    <div class="row"><label class="b2d-check"><input type="checkbox" data-f="confirmed" ${f.confirmed?'checked':''} ${dis}> 관리자 확인${cur?.confirmed?` <span class="b2-sub">(${esc(cur.confirmedBy)} · ${esc(cur.confirmedAt)})</span>`:''}</label>${cur&&byTeacher(cur)?`<span class="b2-sub">${TEACHER_BADGE} ${esc(cur.by)} · ${esc(cur.at)}</span>`:''}</div>
   <div class="b2-note">저장하면 명부 상태도 「${esc(f.kind||'구분')}」(으)로 바뀌고 마지막 출석일 다음 교육일부터 출결판·출석률에서 빠집니다.</div>
   <div class="row"><span class="b2-err" data-err>${esc(editor.err||'')}</span><span class="b2-grow"></span>${cur?`<button type="button" class="b2-btn warn" data-act="remove" ${dis}>지우기</button>`:''}<button type="button" class="b2-btn" data-act="cancel" ${dis}>닫기</button><button type="button" class="b2-btn primary" data-act="save" ${dis}>${editor.saving?'저장 중…':'저장'}</button></div></div>`;
 }
 function openEditor(key,form){
  if(editor&&!leaveOk('지금 입력은'))return;
  const base=formOf(form);editor={key:String(key),form:formOf(form),base,err:'',saving:false};view='list';render();
  host.querySelector(`[data-editor="${CSS.escape(String(key))}"] [data-f="${!base.cls?'cls':'name'}"]`)?.focus();
 }
 function paintEditor(){const el=host.querySelector('[data-editor]');if(!el||!editor)return render();const t=document.createElement('div');t.innerHTML=editorHtml();el.replaceWith(t.firstElementChild);}
 function setField(t){
  const k=t.dataset.f,f=editor.form;
  if(k==='confirmed')f.confirmed=t.checked;else if(k.startsWith('docs.'))f.docs[k.slice(5)]=t.value;else f[k]=t.value;
  if(k==='cls')f.name='';editor.err='';
 }

 /* ---------- 저장·확인·지우기 ---------- */
 const confirmNotice=(f,verdict)=>tell(notify,'중도탈락',{audience:'class',cls:f.cls,title:`${f.cls}반 ${f.name} ${f.kind} · 운영팀 확인`,body:`판정 ${verdict||'판정 전'}`,link:linkFor('b2dropouts',{cls:f.cls})});
 async function refresh(){forgetBeta2Cache();await load({fresh:true,quiet:true});}
 async function save(){
  if(!editor||editor.saving)return;
  const cur=editor.key==='new'?null:rowByNum(editor.key),f=editor.form;
  editor.err=checkDropout(f,{admin});
  if(!editor.err&&!people(f.cls).some(p=>p.name===f.name))editor.err='명부에 있는 학생을 골라 주세요.';
  if(!editor.err&&!cur&&rows.some(r=>dropoutKey(r)===dropoutKey(f)))editor.err='이미 등록된 학생입니다. 목록에서 그 줄을 고쳐 주세요.';
  if(editor.err){paintEditor();return;}
  if(sameForm(f,cur||{})&&cur){editor.err='바뀐 것이 없습니다.';paintEditor();return;}
  const changesStatus=!cur||cur.kind!==f.kind||cur.lastDate!==f.lastDate||dropoutKey(cur)!==dropoutKey(f);
  if(changesStatus&&!confirm(`${classLabel(f.cls)} ${f.name} 학생을 「${f.kind}」(으)로 ${cur?'고칠':'등록할'}까요?\n명부 상태도 함께 바뀌어 마지막 출석일 ${md(f.lastDate)} 다음 교육일부터 출결판·출석률에서 빠집니다.`))return;
  editor.saving=true;paintEditor();
  try{
   const payload=savePayload(f,cur,{admin});
   await client.dropoutSave(payload);
   const done={...f},wasConfirm=payload.confirm;editor=null;
   toast(`${classLabel(done.cls)} ${done.name} · ${done.kind} ${cur?'고쳤':'등록했'}습니다.`);
   if(wasConfirm===true)confirmNotice(done,done.verdict);
   await refresh();
  }catch(e){if(!editor)return;editor.saving=false;editor.err=`저장하지 못했습니다: ${e.message}`;if(life.alive())paintEditor();}
 }
 async function remove(){
  const cur=editor&&rowByNum(editor.key);if(!cur||editor.saving)return;
  if(!confirm(`${classLabel(cur.cls)} ${cur.name} (${cur.kind}) 줄을 마스터시트 중도탈락 탭에서 지울까요?\n명부 상태가 아직 「${cur.kind}」이면 재학으로 되돌립니다.`))return;
  editor.saving=true;paintEditor();
  try{
   await client.dropoutSave({row:cur.row,was:{cls:cur.cls,name:cur.name},cls:cur.cls,name:cur.name,remove:true});
   editor=null;toast(`${classLabel(cur.cls)} ${cur.name} 줄을 지웠습니다.`);
   await refresh();
  }catch(e){if(!editor)return;editor.saving=false;editor.err=`지우지 못했습니다: ${e.message}`;if(life.alive())paintEditor();}
 }
 // 관리자 확인(한 건·여러 건): 판정이 비어 있으면 계산값을 함께 저장합니다. 확인을 풀 때는 판정을 그대로 둡니다.
 function confirmForm(r,on){const f=formOf(r);if(on&&!f.verdict){const sg=suggest(r);f.verdict=sg.verdict;f.basis=f.basis||sg.basis;}f.confirmed=on;return f;}
 async function setConfirmed(list,on){
  if(busy||!list.length)return;
  if(dirty()&&!leaveOk('편집 중인 입력은'))return;
  const forms=list.map(r=>[r,confirmForm(r,on)]),blank=forms.filter(([r])=>on&&!r.verdict).length;
  const head=list.length===1?`${classLabel(list[0].cls)} ${list[0].name} (${list[0].kind}) 줄을`:`${list.length}건을`;
  if(!confirm(on?`${head} 관리자 확인할까요?${list.length===1?`\n판정: ${forms[0][1].verdict}${list[0].verdict?'':' (계산값을 함께 저장)'}`:blank?`\n판정이 빈 ${blank}건은 계산값을 함께 저장합니다.`:''}`:`${head} 관리자 확인을 풀까요? 담임이 다시 고칠 수 있게 됩니다.`))return;
  editor=null;busy=on?'확인하는 중…':'확인을 푸는 중…';batchNote='';render();
  const fails=[];let n=0;
  for(const [r,f] of forms){
   try{await client.dropoutSave(savePayload(f,r,{admin:true}));n++;if(on)confirmNotice(f,f.verdict);}
   catch(e){fails.push(`${classLabel(r.cls)} ${r.name}: ${e.message}`);}
   if(!life.alive())return;busy=`${on?'확인하는':'확인을 푸는'} 중… ${n+fails.length}/${forms.length}`;render();
  }
  busy='';picked.clear();batchNote=fails.length?`${fails.length}건은 하지 못했습니다.\n${fails.join('\n')}`:'';
  toast(on?`${n}건 관리자 확인을 저장했습니다.`:`${n}건 확인을 풀었습니다.`);
  await refresh();
 }
 // 수료 처리·수료 취소(명부 상태 여러 명, b2RosterStatusMany). 반마다 나눠 보냅니다.
 async function setCompleted(list,on){
  if(busy||!list.length)return;
  const before=on&&(bundle?.today||'')<COURSE_END?`\n교육 마지막 날(${md(COURSE_END)}) 전입니다.`:'';
  if(!confirm(on?`${list.length}명을 명부에서 「수료」로 바꿀까요?${before}\n상태 변경일은 ${md(COURSE_END)}로 적습니다.`:`${list.length}명의 수료를 취소하고 「재학」으로 되돌릴까요?`))return;
  busy=on?'수료 처리하는 중…':'수료를 취소하는 중…';batchNote='';render();
  const items=list.map(r=>({cls:r.cls,name:r.name,status:on?'수료':'재학',changed:on?COURSE_END:'',reason:on?'수료':''})),fails=[];let n=0;
  for(const part of statusBatches(items)){
   try{const res=await client.rosterStatusMany(part);n+=Number(res?.count)||part.length;}catch(e){fails.push(`${classLabel(part[0].cls)} ${part.length}명: ${e.message}`);}
   if(!life.alive())return;
  }
  busy='';pickedDone.clear();batchNote=fails.length?`하지 못한 것이 있습니다(그 반은 한 명도 바뀌지 않았습니다).\n${fails.join('\n')}`:'';
  toast(`${n}명 ${on?'수료 처리':'수료 취소'}를 저장했습니다.`);
  await refresh();
 }

 /* ---------- 그리기 ---------- */
 function renderList(){
  const waitTeacher=r=>byTeacher(r)&&!r.confirmed,byState=r=>stateF==='all'||(stateF==='teacher'?waitTeacher(r):(stateF==='done')===!!r.confirmed);
  const mine=rows.filter(inClass),off=official(mine,cls),vis=mine.filter(r=>found(r)&&(kindF==='all'||r.kind===kindF)&&byState(r));
  const {stats}=derived();
  const docs=r=>`<div class="b2d-docs">${DOC_FIELDS.map(([k,l])=>`<span class="b2-badge ${r.docs?.[k]==='O'?'e-ok':r.docs?.[k]==='X'?'e-miss':'e-none'}" title="${esc(l)}">${esc(l)} ${esc(r.docs?.[k]||'-')}</span>`).join('')}</div>`;
  const tr=r=>{
   const sg=suggest(r),st=stats.get(dropoutKey(r)),abs=r.kind==='조기취업'&&sg.absent!==null?`근로개시 전 <b>${sg.absent}</b>일 / ${max}`:st?`<b>${st.absent}</b>일 (마지막 출석까지)`:'-';
   const differs=sg.verdict&&r.verdict&&sg.verdict!==r.verdict;
   const acts=`<button class="b2-btn small" data-act="edit" ${busy?'disabled':''}>고치기</button>${r.confirmed?`<button class="b2-btn small ghost" data-act="unconfirm" ${busy?'disabled':''}>확인 풀기</button>`:`<button class="b2-btn small primary" data-act="confirm" ${busy?'disabled':''}>확인</button>`}`;
   return `<tr data-row="${r.row}" class="${editor?.key===String(r.row)?'editing':''} ${differs?'diff':''}"><td><input type="checkbox" data-pick="${r.row}" aria-label="${esc(r.name)} 고르기" ${picked.has(r.row)?'checked':''} ${busy?'disabled':''}></td>
    <td><span class="b2-name">${esc(r.name)}</span><span class="b2-sub">${esc(classLabel(r.cls))}</span>${byTeacher(r)?TEACHER_BADGE:''}</td>
    <td><span class="b2-badge ${KIND_TONE[r.kind]||''}">${esc(r.kind||'-')}</span>${r.reason?`<span class="b2-sub">${esc(r.reason)}</span>`:''}</td>
    <td class="b2d-date">${r.kind==='조기취업'?`근로개시 ${dateText(r.startDate)}<br>`:''}마지막 출석 ${dateText(r.lastDate)}</td><td>${abs}</td>
    <td>${r.verdict?`<span class="b2-badge ${VERDICT_TONE[r.verdict]||''}">${esc(r.verdict)}</span>`:'<span class="b2-badge">판정 전</span>'}${r.basis?`<span class="b2-sub">${esc(r.basis)}</span>`:''}${sg.verdict&&(differs||!r.verdict)?`<span class="b2-sub">계산: ${esc(sg.verdict)} · ${esc(sg.basis)}</span>`:''}</td>
    <td>${docs(r)}</td><td>${r.contact?`<span class="b2-sub">연락: ${esc(r.contact)}</span>`:''}${r.note?`<span class="b2-sub">비고: ${esc(r.note)}</span>`:''}${!r.contact&&!r.note?'-':''}</td>
    <td><span class="b2-sub">${esc(r.by||'-')}${r.at?` · ${esc(r.at)}`:''}</span></td>
    <td>${r.confirmed?`<span class="b2-badge e-ok">확인</span><span class="b2-sub">${esc(r.confirmedBy)}${r.confirmedAt?` · ${esc(r.confirmedAt)}`:''}</span>`:'<span class="b2-badge t-late">확인 대기</span>'}</td>
    <td class="b2d-act">${acts}</td></tr>${editor?.key===String(r.row)?`<tr class="editing"><td colspan="11">${editorHtml()}</td></tr>`:''}`;
  };
  const count=(f)=>off.filter(f).length;
  const head=['<input type="checkbox" data-pickall aria-label="모두 고르기">','이름','구분 · 사유','날짜','결석(계산)','판정','서류','연락 확인 · 비고','등록','관리자 확인',''];
  const pickable=vis.filter(r=>picked.has(r.row));
  csv=[[...DROPOUT_COLUMNS.map(c=>c[1]),'계산 판정','계산 근거'],...vis.map(r=>{const sg=suggest(r);return [...DROPOUT_COLUMNS.map(([k])=>{const v=k.startsWith('docs.')?r.docs?.[k.slice(5)]:r[k];return k==='confirmed'?(v?'TRUE':'FALSE'):v??'';}),sg.verdict,sg.basis];})];
  body.innerHTML=statBoxes([['등록',off.length],['중도탈락',count(r=>r.kind==='중도탈락')],['조기취업',count(r=>r.kind==='조기취업')],['확인 대기',count(r=>!r.confirmed),count(r=>!r.confirmed)?'alert':''],['판정 수료가능',count(r=>r.verdict==='수료가능')],['판정 제적',count(r=>r.verdict==='제적')]])
   +testNote(mine.length-off.length,'중도탈락·조기취업')
   +`<div class="b2d-filters">${chips('kind',[['all','전체',mine.length],...DROPOUT_KINDS.map(k=>[k,k,mine.filter(r=>r.kind===k).length])],kindF)}${chips('state',[['all','전체'],['wait','확인 대기',mine.filter(r=>!r.confirmed).length],['teacher','담임 신청 대기',mine.filter(waitTeacher).length],['done','확인 완료',mine.filter(r=>r.confirmed).length]],stateF)}</div>`
   +(editor?.key==='new'?editorHtml():'')
   +`<div class="b2d-batch" id="d2Batch" ${pickable.length||busy?'':'hidden'}>${busy?esc(busy):`선택 ${pickable.length}건`}<span class="b2-grow"></span><button class="b2-btn small primary" data-batch="confirm" ${busy?'disabled':''}>관리자 확인</button><button class="b2-btn small ghost" data-batch="unconfirm" ${busy?'disabled':''}>확인 풀기</button></div>`
   +(batchNote?`<div class="b2-note err" style="margin:8px 14px;white-space:pre-line">${esc(batchNote)}</div>`:'')
   +table(head,vis.map(tr),mine.length?'조건에 맞는 줄이 없습니다.':'중도탈락 탭에 등록된 학생이 없습니다. 「새로 등록」으로 넣을 수 있습니다.');
 }
 function renderAbsence(){
  const all=absenceRows(bundle,{cls:cls==='all'?null:cls,max}).filter(found),active=all.filter(r=>r.status==='재학'),off=official(active,cls);
  const reg=new Map(rows.map(r=>[dropoutKey(r),r])),risky=r=>!!r.level;
  const list=(riskOnly?active.filter(risky):all);
  csv=[['반','이름','상태','교육일(재학)','결석','남은 결석 가능','남은 교육일','판정','중도탈락 탭'],...list.map(r=>[r.cls,r.name,r.status,r.days,r.absent,r.status==='재학'?r.left:'',r.remaining,r.level,reg.get(dropoutKey(r))?.kind||''])];
  body.innerHTML=`<div class="b2-note" style="margin:12px 14px 0">2기는 60교육일의 80%(48일) 이상 출석해야 수료합니다. 결석 ${max}일까지는 수료할 수 있고 ${max+1}일부터 제적 대상입니다. 결석은 교육일·재학 기간의 출결원장 「결석」만 셉니다(인정 결석 제외).</div>`
   +statBoxes([['재학생',off.length],[`주의 (${max-2}~${max-1}일)`,off.filter(r=>r.level==='주의').length,'alert'],[`한도 도달 (${max}일)`,off.filter(r=>r.level==='한도 도달').length,'bad'],[`제적 대상 (${max+1}일~)`,off.filter(r=>r.level==='제적 대상').length,'bad']])
   +testNote(active.filter(risky).length-off.filter(risky).length,'결석 주의 이상')
   +`<div class="b2d-filters">${chips('risk',[['risk','주의 이상 재학생',active.filter(risky).length],['all','모든 학생',all.length]],riskOnly?'risk':'all')}</div>`
   +table(['반','이름','상태','교육일(재학)','결석','남은 결석 가능','남은 교육일','판정',''],list.map(r=>{const d=reg.get(dropoutKey(r));
    return `<tr class="${r.tone==='bad'?'diff':''}" data-key="${esc(dropoutKey(r))}"><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td>${esc(r.status)}${r.changed&&r.status!=='재학'?`<span class="b2-sub">${md(r.changed)}</span>`:''}</td><td>${r.days}</td><td><b>${r.absent}</b> / ${max}</td><td>${r.status==='재학'?`${r.left}일`:'-'}</td><td>${r.remaining||'-'}</td>
     <td>${r.level?`<span class="b2-badge ${r.tone==='bad'?'t-absent':'t-late'}">${esc(r.level)}</span>`:'-'}</td><td class="b2d-act">${d?`<span class="b2-badge ${KIND_TONE[d.kind]||''}">${esc(d.kind)} 등록됨</span>`:r.status==='재학'&&r.level?`<button class="b2-btn small" data-act="register">중도탈락 등록</button>`:''}</td></tr>`;}),riskOnly?'결석 주의 이상인 재학생이 없습니다.':'학생이 없습니다.');
 }
 function renderComplete(){
  const all=completionRows(bundle,{completions,dropouts:rows,cls:cls==='all'?null:cls,max}).filter(found),off=official(all,cls),list=all.filter(r=>outcomeF==='all'||r.outcome===outcomeF);
  const canPick=r=>(r.outcome==='수료 예정'&&r.status==='재학')||r.status==='수료';
  const sel=list.filter(r=>pickedDone.has(dropoutKey(r))&&canPick(r)),toDone=sel.filter(r=>r.status==='재학'),toUndo=sel.filter(r=>r.status==='수료');
  csv=[['반','이름','명부 상태','결석','결과','까닭'],...list.map(r=>[r.cls,r.name,r.status,r.absent,r.outcome,r.why])];
  body.innerHTML=`<div class="b2-note" style="margin:12px 14px 0">수료: 명부 「수료」와, 조기취업 가운데 판정 「수료가능」이고 관리자 확인까지 된 학생(마스터시트 수료 명단 기준). 수료 예정: 재학 중이고 결석 ${max}일 이하. 교육이 끝나면 수료 예정 학생을 골라 「수료 처리」하면 명부 상태가 수료로 바뀝니다.</div>`
   +statBoxes(OUTCOMES.map(o=>[o,off.filter(r=>r.outcome===o).length,o==='미수료'&&off.some(r=>r.outcome===o)?'bad':o==='확인 대기'&&off.some(r=>r.outcome===o)?'alert':'']))
   +testNote(all.length-off.length,'학생')
   +`<div class="b2d-filters">${chips('outcome',[['all','전체',all.length],...OUTCOMES.map(o=>[o,o,all.filter(r=>r.outcome===o).length])],outcomeF)}</div>`
   +`<div class="b2d-batch" ${sel.length||busy?'':'hidden'}>${busy?esc(busy):`선택 ${sel.length}명`}<span class="b2-grow"></span><button class="b2-btn small primary" data-done="on" ${busy||!toDone.length?'disabled':''}>수료 처리 ${toDone.length||''}</button><button class="b2-btn small ghost" data-done="off" ${busy||!toUndo.length?'disabled':''}>수료 취소 ${toUndo.length||''}</button></div>`
   +(batchNote?`<div class="b2-note err" style="margin:8px 14px;white-space:pre-line">${esc(batchNote)}</div>`:'')
   +table(['<input type="checkbox" data-pickall-done aria-label="모두 고르기">','반','이름','명부 상태','결석','결과','까닭'],list.map(r=>`<tr data-key="${esc(dropoutKey(r))}" class="${r.outcome==='미수료'?'diff':''}"><td>${canPick(r)?`<input type="checkbox" data-pickdone="${esc(dropoutKey(r))}" aria-label="${esc(r.name)} 고르기" ${pickedDone.has(dropoutKey(r))?'checked':''} ${busy?'disabled':''}>`:''}</td><td>${esc(classLabel(r.cls))}</td><td class="b2-name">${esc(r.name)}</td><td>${esc(r.status)}${r.changed&&r.status!=='재학'?`<span class="b2-sub">${md(r.changed)}</span>`:''}</td><td>${r.absent}</td><td><span class="b2-badge ${OUTCOME_TONE[r.outcome]}">${esc(r.outcome)}</span></td><td>${esc(r.why)}</td></tr>`),'학생이 없습니다.');
 }
 function render(){
  if(!life.alive())return;
  $('#d2Tabs').innerHTML=VIEWS.map(([k,l])=>`<button class="b2-tab" role="tab" data-view="${k}" aria-selected="${view===k}">${l}</button>`).join('');
  $('#d2New').hidden=view!=='list';
  if(!bundle){body.innerHTML=err?`<div style="padding:0 14px 14px">${errorBox(err)}</div>`:loading('중도탈락 탭을 불러오는 중…');return;}
  if(view==='list')renderList();else if(view==='absence')renderAbsence();else renderComplete();
 }
 async function load({fresh=false,quiet=false}={}){
  const n=++seq;if(!quiet){bundle=null;err='';render();}
  try{
   const [d,b,c]=await Promise.all([client.dropouts({}),client.bundle('all',{fresh}),client.completions({})]);
   if(n!==seq||!life.alive())return;
   rows=(d?.rows||[]).map(r=>({...r,cls:String(r.cls),row:Number(r.row)}));max=maxOf(d?.maxAbsence);bundle=b;completions=c?.rows||[];err='';
   if(editor&&editor.key!=='new'&&!rowByNum(editor.key))editor=null;
   for(const r of [...picked])if(!rowByNum(r))picked.delete(r);
  }catch(e){if(n!==seq||!life.alive())return;err=e;if(!quiet)bundle=null;else toast(`다시 읽지 못했습니다: ${e.message}`);}
  render();
 }

 /* ---------- 이벤트 ---------- */
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button,input[type="checkbox"]');if(!t||t.disabled)return;
  if(t.dataset.view){if(t.dataset.view===view)return;if(!leaveOk('보기를 바꾸면'))return;editor=null;batchNote='';view=t.dataset.view;render();return;}
  if(t.dataset.kind){kindF=t.dataset.kind;render();return;}
  if(t.dataset.state){stateF=t.dataset.state;render();return;}
  if(t.dataset.risk){riskOnly=t.dataset.risk==='risk';render();return;}
  if(t.dataset.outcome){outcomeF=t.dataset.outcome;render();return;}
  if(t.dataset.pick){const r=Number(t.dataset.pick);if(t.checked)picked.add(r);else picked.delete(r);render();return;}
  if(t.hasAttribute('data-pickall')){const vis=[...host.querySelectorAll('[data-pick]')].map(x=>Number(x.dataset.pick));const on=vis.some(r=>!picked.has(r));vis.forEach(r=>on?picked.add(r):picked.delete(r));render();return;}
  if(t.dataset.pickdone){const k=t.dataset.pickdone;if(t.checked)pickedDone.add(k);else pickedDone.delete(k);render();return;}
  if(t.hasAttribute('data-pickall-done')){const vis=[...host.querySelectorAll('[data-pickdone]')].map(x=>x.dataset.pickdone);const on=vis.some(k=>!pickedDone.has(k));vis.forEach(k=>on?pickedDone.add(k):pickedDone.delete(k));render();return;}
  if(t.dataset.batch){const list=rows.filter(r=>picked.has(r.row)&&inClass(r));void setConfirmed(list.filter(r=>t.dataset.batch==='confirm'?!r.confirmed:r.confirmed),t.dataset.batch==='confirm');return;}
  if(t.dataset.done){const all=completionRows(bundle,{completions,dropouts:rows,cls:cls==='all'?null:cls,max}).filter(r=>pickedDone.has(dropoutKey(r)));void setCompleted(all.filter(r=>t.dataset.done==='on'?r.status==='재학'&&r.outcome==='수료 예정':r.status==='수료'),t.dataset.done==='on');return;}
  const act=t.dataset.act;if(!act)return;
  if(act==='save')return void save();
  if(act==='remove')return void remove();
  if(act==='cancel'){if(!leaveOk('닫으면'))return;editor=null;render();return;}
  if(act==='suggest'&&editor){const sg=suggest(editor.form);editor.form.verdict=sg.verdict;editor.form.basis=sg.basis;paintEditor();return;}
  const tr=t.closest('tr[data-row]'),r=tr&&rowByNum(tr.dataset.row);
  if(act==='edit'&&r){if(editor?.key===String(r.row))return;openEditor(r.row,r);return;}
  if(act==='confirm'&&r)return void setConfirmed([r],true);
  if(act==='unconfirm'&&r)return void setConfirmed([r],false);
  if(act==='register'){const [c,name]=t.closest('tr[data-key]').dataset.key.split('|');openEditor('new',{cls:c,name,kind:'중도탈락'});return;}
 });
 const onField=ev=>{const t=ev.target;if(!editor||!t.dataset?.f||!t.closest('[data-editor]'))return;setField(t);
  if(ev.type==='change'&&['cls','kind','name','startDate','lastDate'].includes(t.dataset.f)){paintEditor();host.querySelector(`[data-editor] [data-f="${t.dataset.f}"]`)?.focus();}
  else{const e=host.querySelector('[data-editor] [data-err]');if(e)e.textContent='';}};
 host.addEventListener('input',onField);host.addEventListener('change',onField);
 host.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.matches?.('[data-editor] input:not([type="checkbox"])')){ev.preventDefault();void save();}});
 $('#d2Class').onchange=ev=>{if(!leaveOk('반을 바꾸면')){ev.target.value=cls;return;}editor=null;picked.clear();pickedDone.clear();batchNote='';cls=ev.target.value;render();};
 $('#d2Search').oninput=ev=>{search=ev.target.value.trim();render();};
 $('#d2New').onclick=()=>openEditor('new',{cls:cls==='all'?'':cls,kind:'중도탈락'});
 $('#d2Reload').onclick=()=>{if(!leaveOk('새로 읽으면'))return;editor=null;void load({fresh:true});};
 $('#d2Csv').onclick=()=>downloadCsv(`중도탈락수료_${(VIEWS.find(v=>v[0]===view)||VIEWS[0])[1].replace(/[·\s]/g,'')}_${cls==='all'?'전체':cls+'반'}.csv`,csv);
 await load();
 return {dispose:()=>life.dispose(),canLeave:()=>!dirty()||confirm('저장하지 않은 중도탈락 입력이 있습니다. 화면을 떠날까요?'),setView(v){if(VIEWS.some(([k])=>k===v)&&leaveOk('보기를 바꾸면')){editor=null;view=v;render();}}};
}

/* ========== 담임: 신청 + 우리 반 신청 현황 + 수료 확인(보기만) ========== */
// me: 담임 이메일(신청 취소는 자기가 신청하고 운영팀 확인 전인 줄만). 서버(api/teacher-beta.js)와 시트도 같은 기준으로 막습니다.
const blankRequest=()=>({name:'',kind:'중도탈락',reason:'',lastDate:'',startDate:'',note:''});
async function mountTeacher(host,{client,teacherClass,me='',context,hideHead=false,notify=defaultNotify}={}){
 const life=lifecycle(host),cls=String(teacherClass);
 let view=TEACHER_VIEWS.some(([k])=>k===context?.tab)?context.tab:'list';
 let rows=[],max=12,bundle=null,completions=[],err='',seq=0,search='',outcomeF='all';
 let form=blankRequest(),formErr='',sending=false,cancelling=0;
 host.innerHTML=`<div class="b2 b2d"><style>${STYLE}</style>${hideHead?'':`<div class="b2-head"><div><h2>중도탈락·조기취업 신청</h2><p>중도탈락·조기취업한 교육생을 신청합니다. 판정·서류·수료 처리는 운영팀이 합니다.</p></div></div>`}
 <div class="b2-tabs" role="tablist" id="d2Tabs"></div>
 <section class="b2-card"><div class="b2-toolbar"><label class="b2-field">이름 찾기<input id="d2Search" autocomplete="off" placeholder="이름"></label><span class="b2-grow"></span><button class="b2-btn" id="d2Reload">새로고침</button></div>
  <div id="d2Body">${loading('중도탈락 신청 현황을 불러오는 중…')}</div></section></div>`;
 const $=s=>host.querySelector(s),body=$('#d2Body');
 const found=r=>!search||String(r.name).includes(search);
 const dirty=()=>!sending&&['name','reason','lastDate','startDate','note'].some(k=>String(form[k]||'').trim());
 // 신청할 수 있는 교육생: 우리 반 명부의 재학생 가운데 아직 신청(중도탈락 탭 줄)이 없는 학생
 const choices=()=>(bundle?.roster||[]).filter(p=>p.cls===cls&&(!p.status||p.status==='재학')&&!rows.some(r=>dropoutKey(r)===dropoutKey(p)));
 const atText=v=>{const m=String(v||'').match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);return m?`${md(m[1])}${m[2]?` ${m[2]}`:''}`:esc(v||'-');};
 function formHtml(){
  const dis=sending?'disabled':'',people=choices(),f=form;
  return `<section class="b2-card b2-pad b2d-req" data-request><h3>중도탈락·조기취업 신청</h3><div class="b2-form">
   <label class="b2-field">교육생 (재학)<select data-g="name" ${dis}><option value="">교육생 선택</option>${people.map(p=>`<option value="${esc(p.name)}" ${p.name===f.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
   <label class="b2-field">구분<select data-g="kind" ${dis}>${DROPOUT_KINDS.map(k=>`<option value="${esc(k)}" ${k===f.kind?'selected':''}>${esc(k)}</option>`).join('')}</select></label>
   <label class="b2-field wide">사유<input data-g="reason" maxlength="200" placeholder="예: 개인 사정, 11/23 ○○㈜ 입사" value="${esc(f.reason)}" ${dis}></label>
   <label class="b2-field">마지막 출석일 (필수)<input type="date" data-g="lastDate" min="${isTestClass(cls)?'':COURSE_START}" max="${COURSE_END}" value="${esc(f.lastDate)}" ${dis}></label>
   ${f.kind==='조기취업'?`<label class="b2-field">근로개시일 (필수)<input type="date" data-g="startDate" value="${esc(f.startDate)}" ${dis}></label>`:'<span></span>'}
   <label class="b2-field wide">메모 (선택)<input data-g="note" maxlength="300" placeholder="운영팀에 전할 말" value="${esc(f.note)}" ${dis}></label>
  </div>${people.length?'':'<div class="b2-note" style="margin-top:10px">신청할 수 있는 재학생이 없습니다.</div>'}
  <div class="b2-chips" style="margin-top:12px;align-items:center"><span class="b2-err" data-err>${esc(formErr)}</span><span class="b2-grow"></span><button class="b2-btn primary" data-submit ${dis}>${sending?'신청 중…':'신청하기'}</button></div>
  <p class="b2-tiny b2-muted" style="margin:8px 0 0">신청하면 운영팀에 알림이 갑니다. 명부 상태는 운영팀이 확인한 뒤 「${esc(f.kind)}」(으)로 바뀌고, 그때 마지막 출석일 다음 교육일부터 출결판·출석률에서 빠집니다. 판정·서류·수료 처리는 운영팀이 합니다.</p></section>`;
 }
 function renderList(){
  const mine=rows.filter(r=>r.cls===cls),vis=mine.filter(found);
  const tr=r=>{
   const mineReq=canCancel(r,me);
   return `<tr data-row="${r.row}"><td><span class="b2-name">${esc(r.name)}</span></td>
    <td><span class="b2-badge ${KIND_TONE[r.kind]||''}">${esc(r.kind||'-')}</span>${r.reason?`<span class="b2-sub">${esc(r.reason)}</span>`:''}${r.note?`<span class="b2-sub">메모: ${esc(r.note)}</span>`:''}</td>
    <td class="b2d-date">${atText(r.at)}${r.by&&r.by.toLowerCase()!==String(me).toLowerCase()?`<span class="b2-sub">${esc(r.by)}</span>`:''}</td>
    <td class="b2d-date">마지막 출석 ${dateText(r.lastDate)}${r.kind==='조기취업'?`<br>근로개시 ${dateText(r.startDate)}`:''}</td>
    <td>${r.confirmed?`<span class="b2-badge e-ok">${requestState(r)}</span>${r.confirmedBy||r.confirmedAt?`<span class="b2-sub">${esc(r.confirmedBy)}${r.confirmedAt?` · ${esc(r.confirmedAt)}`:''}</span>`:''}`:`<span class="b2-badge t-late">${requestState(r)}</span><span class="b2-sub">운영팀 확인 전</span>`}</td>
    <td>${r.verdict?`<span class="b2-badge ${VERDICT_TONE[r.verdict]||''}">${esc(r.verdict)}</span>`:'-'}</td>
    <td class="b2d-act">${mineReq?`<button class="b2-btn small warn" data-cancel-req ${cancelling?'disabled':''}>${cancelling===r.row?'취소 중…':'신청 취소'}</button>`:''}</td></tr>`;
  };
  body.innerHTML=formHtml()
   +`<h3 class="b2d-sec">우리 반 신청 현황 (${mine.length}건)</h3>`
   +`<div class="b2-note" style="margin:0 14px 10px">보기만 합니다. 신청한 뒤 고칠 내용은 운영팀에 알려 주세요. 운영팀 확인 전에는 직접 신청한 줄을 취소할 수 있습니다.</div>`
   +table(['이름','구분 · 사유','신청일','날짜','처리 상태','판정',''],vis.map(tr),mine.length?'조건에 맞는 줄이 없습니다.':'아직 신청한 교육생이 없습니다.');
 }
 function renderComplete(){
  const all=completionRows(bundle,{completions,dropouts:rows,cls,max}).filter(found),list=all.filter(r=>outcomeF==='all'||r.outcome===outcomeF);
  const absence=r=>{if(r.status!=='재학')return `${r.absent}일`;const lv=absenceLevel(r.absent,max);return `<b>${r.absent}</b> / ${max}일${lv.level?` <span class="b2-badge ${lv.tone==='bad'?'t-absent':'t-late'}">${esc(lv.level)}</span>`:''}<span class="b2-sub">${r.absent>max?'한도 초과':`${lv.left}일 더 결석하면 한도`}</span>`;};
  body.innerHTML=`<div class="b2-note" style="margin:12px 14px 0">확인만 합니다(처리는 운영팀). 2기는 60교육일의 80% 이상 출석해야 수료합니다. 결석 ${max}일까지는 수료할 수 있고 ${max+1}일부터 제적 대상입니다(인정 결석 제외).
   수료: 명부 수료, 조기취업 가운데 판정 수료가능 · 운영팀 확인. 수료 예정: 재학 중이고 결석 ${max}일 이하. 확인 대기: 조기취업 판정·확인 전. 미수료: 중도탈락·제적·결석 한도 초과.</div>`
   +statBoxes(OUTCOMES.map(o=>[o,all.filter(r=>r.outcome===o).length,o==='미수료'&&all.some(r=>r.outcome===o)?'bad':o==='확인 대기'&&all.some(r=>r.outcome===o)?'alert':'']))
   +`<div class="b2d-filters">${chips('outcome',[['all','전체',all.length],...OUTCOMES.map(o=>[o,o,all.filter(r=>r.outcome===o).length])],outcomeF)}</div>`
   +table(['이름','명부 상태','결석 / 한도','결과','까닭'],list.map(r=>`<tr data-key="${esc(dropoutKey(r))}" class="${r.outcome==='미수료'?'diff':''}"><td class="b2-name">${esc(r.name)}</td><td>${esc(r.status)}${r.changed&&r.status!=='재학'?`<span class="b2-sub">${md(r.changed)}</span>`:''}</td><td>${absence(r)}</td><td><span class="b2-badge ${OUTCOME_TONE[r.outcome]}">${esc(r.outcome)}</span></td><td>${esc(r.why)}</td></tr>`),'학생이 없습니다.');
 }
 function render(){
  if(!life.alive())return;
  $('#d2Tabs').innerHTML=TEACHER_VIEWS.map(([k,l])=>`<button class="b2-tab" role="tab" data-view="${k}" aria-selected="${view===k}">${l}</button>`).join('');
  if(!bundle){body.innerHTML=err?`<div style="padding:0 14px 14px">${errorBox(err)}</div>`:loading('중도탈락 신청 현황을 불러오는 중…');return;}
  if(view==='list')renderList();else renderComplete();
 }
 function paintForm(focus){const el=host.querySelector('[data-request]');if(!el)return render();const t=document.createElement('div');t.innerHTML=formHtml();el.replaceWith(t.firstElementChild);if(focus)host.querySelector(`[data-request] [data-g="${focus}"]`)?.focus();}
 async function load({fresh=false,quiet=false}={}){
  const n=++seq;if(!quiet){bundle=null;err='';render();}
  try{
   const [d,b,c]=await Promise.all([client.dropouts({cls}),client.bundle(cls,{fresh}),client.completions({cls})]);
   if(n!==seq||!life.alive())return;
   rows=(d?.rows||[]).map(r=>({...r,cls:String(r.cls),row:Number(r.row)}));max=maxOf(d?.maxAbsence);bundle=b;completions=c?.rows||[];err='';
   if(form.name&&!choices().some(p=>p.name===form.name))form.name='';
  }catch(e){if(n!==seq||!life.alive())return;err=e;if(!quiet)bundle=null;else toast(`다시 읽지 못했습니다: ${e.message}`);}
  render();
 }
 async function refresh(){forgetBeta2Cache();await load({fresh:true,quiet:true});}
 const notice=(what,f)=>tell(notify,'중도탈락',{audience:'admins',cls,title:`${cls}반 ${f.kind} ${what} · ${f.name}`,body:`마지막 출석 ${md(f.lastDate)}${f.kind==='조기취업'&&f.startDate?` · 근로개시 ${md(f.startDate)}`:''}${f.reason?` · ${f.reason}`:''}`,link:linkFor('b2dropouts',{cls})});
 async function submit(){
  if(sending)return;
  const f={...form,cls};if(f.kind!=='조기취업')f.startDate='';
  formErr=!f.name?'교육생을 골라 주세요.':checkDropout(f,{admin:false});
  if(!formErr&&!choices().some(p=>p.name===f.name))formErr='명부의 재학생을 골라 주세요.';
  if(formErr){paintForm();return;}
  if(!confirm(`${classLabel(cls)} ${f.name} 학생을 「${f.kind}」(으)로 신청할까요?\n명부 상태는 운영팀이 확인한 뒤 바뀝니다(마지막 출석일 ${md(f.lastDate)} 다음 교육일부터 출결판·출석률에서 빠짐). 판정·서류·수료 처리는 운영팀이 합니다.`))return;
  sending=true;paintForm();
  try{
   await client.dropoutSave(requestPayload(f));
   sending=false;form=blankRequest();formErr='';
   toast('신청했습니다 · 운영팀이 확인 후 처리합니다');
   notice('신청',f);
   await refresh();
  }catch(e){sending=false;formErr=`신청하지 못했습니다: ${e.message}`;if(life.alive())paintForm();}
 }
 async function cancelRequest(r){
  if(cancelling||!canCancel(r,me))return;
  if(!confirm(`${r.name} (${r.kind}) 신청을 취소할까요?\n운영팀이 확인하기 전이라 명부 상태는 그대로입니다.`))return;
  cancelling=r.row;render();
  try{
   await client.dropoutSave({row:r.row,was:{cls:r.cls,name:r.name},cls:r.cls,name:r.name,remove:true});
   cancelling=0;toast(`${r.name} 신청을 취소했습니다.`);notice('신청 취소',r);
   await refresh();
  }catch(e){cancelling=0;toast(`취소하지 못했습니다: ${e.message}`);if(life.alive())render();}
 }
 host.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t||t.disabled)return;
  if(t.dataset.view){if(t.dataset.view===view)return;view=t.dataset.view;render();return;}
  if(t.dataset.outcome){outcomeF=t.dataset.outcome;render();return;}
  if(t.hasAttribute('data-submit'))return void submit();
  if(t.hasAttribute('data-cancel-req')){const r=rows.find(x=>x.row===Number(t.closest('tr[data-row]')?.dataset.row));if(r)void cancelRequest(r);}
 });
 const onField=ev=>{const t=ev.target,k=t.dataset?.g;if(!k||!t.closest('[data-request]'))return;form[k]=t.value;formErr='';
  if(ev.type==='change'&&k==='kind')paintForm('kind');else{const e=host.querySelector('[data-request] [data-err]');if(e)e.textContent='';}};
 host.addEventListener('input',onField);host.addEventListener('change',onField);
 host.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.matches?.('[data-request] input')){ev.preventDefault();void submit();}});
 $('#d2Search').oninput=ev=>{search=ev.target.value.trim();render();};
 $('#d2Reload').onclick=()=>void load({fresh:true});
 await load();
 return {dispose:()=>life.dispose(),canLeave:()=>!dirty()||confirm('보내지 않은 중도탈락 신청 입력이 있습니다. 화면을 떠날까요?'),setView(v){if(TEACHER_VIEWS.some(([k])=>k===v)){view=v;render();}}};
}
