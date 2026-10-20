// 2기 교육시간 조정(관리자, 사용자 요청 2026-10-19 ④): 공장견학·분해조립처럼 HRD 확정 시간이 아직 없는 날의 교육시간을 정합니다. 어떤 모듈이든, 모듈 안 일부 시간(구간)만도 됩니다.
// 원본은 마스터시트 「현장교육 일정」 탭 O~T(b2ModuleTimes 읽기 · b2ModuleTimeSave 저장·지움, 관리자만). 그날 그 반 기준(시간 정한 줄의 가장 이른 시작~가장 늦은 끝, 지각·조퇴 10분 여유)은
// 출결대조 판정(beta2-daytimes.mjs → beta2-core compareCheckHere)과 시트 출결원장 '입력 확인'이 같이 씁니다. 저장·지움은 화면에 먼저 보이고(못 하면 되돌림), 끝나면 시트에서 다시 읽습니다
// (줄을 지우면 아래 줄 번호가 당겨지므로 저장마다 다시 읽고, 다시 읽는 동안 다른 저장은 잠급니다).
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {COURSE_START,COURSE_END} from './cohort.mjs';
import {DAY_DEFAULTS,TIME_RANGE,dayTimesOf,dayText,dayRuleText,checkModuleTime,cleanTime,minutes,hhmmOf,isHHmm,rememberDayTimes,forgetDayTimes,SOURCE_SHEET} from './beta2-daytimes.mjs';

const koreaToday=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,10);
const MODULES=['공장견학','분해조립','실차체험'];
const VIEWS=[['all','모든 줄'],['set','시간 정한 줄'],['unset','시간 미정']];
const STYLE=`.b2t .b2t-day{display:flex;justify-content:space-between;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:10px 14px;background:var(--b2-soft);border-top:1px solid var(--b2-line)}.b2t .b2t-day .b2-badge{margin-left:6px}
.b2t .b2t-row{display:grid;grid-template-columns:minmax(140px,1.2fr) 110px minmax(120px,1.3fr) minmax(150px,1fr) auto;gap:6px 12px;align-items:center;padding:9px 14px;border-top:1px solid var(--b2-line);font-size:13px}
.b2t .b2t-row.pending{opacity:.55}.b2t .b2t-row.editing{background:#f0f9ff}.b2t .b2t-act{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.b2t .b2t-edit{padding:12px 14px;border-top:1px dashed #93c5fd;background:#f0f9ff}.b2t .b2t-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end}
.b2t .b2t-form .wide{grid-column:span 2}.b2t .b2t-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.b2t .b2t-preview{font-size:12px;font-weight:800;color:#1d4ed8}
.b2t .b2t-rules{display:grid;gap:4px;margin:0 0 12px}.b2t .b2t-rules b{font-weight:900}
@media(max-width:720px){.b2t .b2t-row{grid-template-columns:1fr auto}.b2t .b2t-why,.b2t .b2t-by,.b2t .b2t-act{grid-column:1/-1}.b2t .b2t-act{justify-content:flex-start}.b2t .b2t-form .wide{grid-column:auto}.b2t .b2-toolbar .b2-field{flex:1 1 140px}}`;

export async function mount(host,{user,classes,client,context}){
 const life=lifecycle(host),today=koreaToday();
 let cls=String(context?.classId||'all'),from=today>COURSE_START&&today<=COURSE_END?today:COURSE_START,to=COURSE_END,view='all';
 let data=null,loadErr='',seq=0,busy=false,editing=null,form=null,formErr='',msg=null,tempSeq=0;
 host.innerHTML=`<div class="b2 b2t"><style>${STYLE}</style><div class="b2-head"><div><h2>교육시간 조정</h2><p>공장견학·분해조립처럼 HRD 확정 시간이 아직 없는 날의 교육시간을 정합니다. 어떤 모듈이든 정할 수 있고, 모듈 안 일부 시간(구간)만 따로 정할 수도 있습니다.</p></div><button class="b2-btn primary" id="t2New">새 시간 넣기</button></div>
 <div class="b2-note b2t-rules" id="t2Rules"></div><div id="t2Form"></div>
 <section class="b2-card"><div class="b2-toolbar"><label class="b2-field">반<select id="t2Class">${classOptions(classes,cls,{all:true})}</select></label>
  <label class="b2-field">시작일<input type="date" id="t2From" value="${from}" min="${COURSE_START}" max="${COURSE_END}"></label><label class="b2-field">끝일<input type="date" id="t2To" value="${to}" min="${COURSE_START}" max="${COURSE_END}"></label>
  <div class="b2-chips" id="t2Views"></div><span class="b2-grow"></span><button class="b2-btn" id="t2Reload">새로고침</button></div>
  <div id="t2Msg" style="padding:0 14px"></div><div id="t2List">${loading('현장교육 일정을 불러오는 중…')}</div></section></div>`;
 const $=s=>host.querySelector(s);
 const defaults=()=>({...DAY_DEFAULTS,...(data?.defaults||{}),field:data?.field||DAY_DEFAULTS.field});
 const keyOf=r=>r.key||`r${r.row}`;
 const rowAt=key=>data?.rows.find(r=>keyOf(r)===key)||null;
 const timed=r=>isHHmm(r.start)&&isHHmm(r.end);
 function say(text,kind=''){msg=text?{text,kind}:null;const el=$('#t2Msg');if(el)el.innerHTML=msg?`<div class="b2-note ${kind}" style="margin:0 0 10px">${esc(msg.text)}</div>`:'';}
 function rules(){
  const d=defaults(),g=+d.graceMin||10,base=dayTimesOf([],'','',{defaults:d}),f=d.field||[];
  const field=f.length===2?{start:f[0],end:f[1],lateAfter:hhmmOf(minutes(f[0])+g),earlyBefore:hhmmOf(minutes(f[1])-g)}:null;
  $('#t2Rules').innerHTML=`<span><b>평소</b> ${esc(base.start)}~${esc(base.end)} (${esc(dayRuleText(base))})</span>${field?`<span><b>공장견학 기본</b> ${esc(field.start)}~${esc(field.end)} (${esc(dayRuleText(field))})</span>`:''}<span>그날 그 반에 시간을 정한 줄이 여러 개면 가장 이른 시작 ~ 가장 늦은 끝이 그날 기준입니다. 시간을 정하지 않은 줄은 기준에 들어가지 않습니다.</span><span>저장하면 마스터시트 「현장교육 일정」 탭에 바로 적히고, 출결대조의 지각·조퇴 판정도 그날 기준을 따릅니다.</span>`;
 }
 // 미리보기: 지금 고치는 값을 넣었을 때의 그날 기준(저장 전 계산, 시트와 같은 규칙)
 function previewOf(f){
  if(!f?.date||!f?.cls)return null;
  const start=cleanTime(f.start),end=cleanTime(f.end),others=(data?.rows||[]).filter(r=>keyOf(r)!==f.key);
  const draft=isHHmm(start)&&isHHmm(end)&&minutes(end)>minutes(start)?[{...f,start,end}]:[];
  return dayTimesOf([...others,...draft],f.date,f.cls,{defaults:defaults()});
 }
 const previewText=f=>{const p=previewOf(f);return p?`저장하면 ${md(f.date)} ${f.cls}반 그날 기준: ${dayText(p)}${p.source===SOURCE_SHEET?'':' (평소)'}`:'날짜와 반을 고르면 그날 기준을 미리 보여 드립니다.';};
 const modulesFor=(date,c)=>[...new Set([...(data?.rows||[]).filter(r=>(!date||r.date===date)&&(!c||String(r.cls)===String(c))).map(r=>r.module).filter(Boolean),...MODULES])];
 function fieldsHtml(f,existing){
  const d=defaults(),fd=d.field||[];
  return `<div class="b2t-form">${existing?'':`<label class="b2-field">날짜<input type="date" data-f="date" value="${esc(f.date)}" min="${COURSE_START}" max="${COURSE_END}"></label>
   <label class="b2-field">반<select data-f="cls"><option value="">반 선택</option>${classOptions(classes,f.cls)}</select></label>
   <label class="b2-field">모듈<input data-f="module" list="t2Modules" maxlength="60" placeholder="예: 공장견학" value="${esc(f.module)}"></label><datalist id="t2Modules">${modulesFor(f.date,f.cls).map(m=>`<option value="${esc(m)}">`).join('')}</datalist>`}
   <label class="b2-field">시작<input type="time" data-f="start" min="${TIME_RANGE.min}" max="${TIME_RANGE.max}" value="${esc(f.start)}"></label>
   <label class="b2-field">끝<input type="time" data-f="end" min="${TIME_RANGE.min}" max="${TIME_RANGE.max}" value="${esc(f.end)}"></label>
   <label class="b2-field">구간 (선택)<input data-f="part" maxlength="60" placeholder="예: 오후 실습만" value="${esc(f.part)}"></label>
   <label class="b2-field wide">${existing?'사유 (필수)':'사유'}<input data-f="reason" maxlength="200" placeholder="예: HRD 확정 전 임시 · 견학 업체 일정" value="${esc(f.reason)}"></label></div>
  <div class="b2t-bar">${fd.length===2?`<button class="b2-btn small soft" data-preset="${esc(fd[0])}|${esc(fd[1])}">공장견학 기본 ${esc(fd[0])}~${esc(fd[1])}</button>`:''}<button class="b2-btn small ghost" data-preset="${esc(d.start)}|${esc(d.end)}">평소 ${esc(d.start)}~${esc(d.end)}</button><span class="b2t-preview" data-preview>${esc(previewText(f))}</span></div>
  <div class="b2t-bar"><span class="b2-err" data-err>${esc(formErr)}</span><span class="b2-grow"></span><button class="b2-btn" data-cancel>취소</button><button class="b2-btn primary" data-save ${busy?'disabled':''}>${busy?'저장 중…':'저장'}</button></div>`;
 }
 function formHtml(){
  if(editing!=='new'||!form)return '';
  return `<section class="b2-card b2-pad" style="margin-bottom:14px" data-editor="new"><h3 style="margin-bottom:10px">새 교육시간</h3>${fieldsHtml(form,false)}<p class="b2-tiny b2-muted" style="margin:8px 0 0">같은 날·같은 모듈의 일부 시간만 다를 때는 구간에 그 부분 이름을 적고 그 시간만 넣어 주세요. (예: 분해조립 · 오후 실습 13:00~15:00)</p></section>`;
 }
 function rowHtml(r){
  const key=keyOf(r),on=editing===key;
  return `<div class="b2t-row ${r.pending?'pending':''} ${on?'editing':''}" data-key="${esc(key)}"><div class="b2t-mod"><b>${esc(r.module||'(모듈 이름 없음)')}</b>${r.part?`<span class="b2-sub">구간: ${esc(r.part)}</span>`:''}</div>
   <div class="b2t-time">${timed(r)?`<b>${esc(r.start)}~${esc(r.end)}</b>`:'<span class="b2-muted">시간 미정</span>'}</div><div class="b2t-why">${r.reason?esc(r.reason):'<span class="b2-muted">사유 없음</span>'}</div>
   <div class="b2t-by b2-small b2-muted">${r.pending?esc(r.pending):r.by?`${esc(r.by)}${r.at?' · '+esc(r.at):''}`:''}</div>
   <div class="b2t-act"><button class="b2-btn small ${on?'dark':''}" data-edit ${r.pending||busy?'disabled':''}>${on?'닫기':timed(r)?'시간 고치기':'시간 정하기'}</button>${r.pending?'':`${timed(r)?`<button class="b2-btn small" data-clear ${busy?'disabled':''}>시간 비우기</button>`:''}<button class="b2-btn small warn" data-del ${busy?'disabled':''}>지우기</button>`}</div></div>
   ${on&&form?`<div class="b2t-edit" data-editor="${esc(key)}">${fieldsHtml(form,true)}</div>`:''}`;
 }
 function render(){
  if(!life.alive())return;
  rules();$('#t2Form').innerHTML=formHtml();say(msg?.text,msg?.kind);
  $('#t2Views').innerHTML=VIEWS.map(([k,l])=>`<button class="b2-chip" data-view="${k}" aria-pressed="${view===k}">${l}<span class="n">${data?data.rows.filter(r=>k==='all'||(k==='set')===timed(r)).length:''}</span></button>`).join('');
  $('#t2New').disabled=editing==='new'||busy;
  const list=$('#t2List');
  if(!data){list.innerHTML=loadErr?`<div style="padding:0 14px 14px">${errorBox(loadErr)}</div>`:loading('현장교육 일정을 불러오는 중…');return;}
  const shown=data.rows.filter(r=>view==='all'||(view==='set')===timed(r)||editing===keyOf(r)),groups=new Map();
  for(const r of shown){const k=`${r.date}|${r.cls}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  const order=[...groups.keys()].sort((a,b)=>{const [da,ca]=a.split('|'),[db,cb]=b.split('|');return da.localeCompare(db)||Number(ca)-Number(cb);});
  list.innerHTML=order.length?order.map(k=>{
   const [date,c]=k.split('|'),day=dayTimesOf(data.rows,date,c,{defaults:defaults()}),sheet=day.source===SOURCE_SHEET;
   const rows=groups.get(k).sort((a,b)=>(a.start||'99').localeCompare(b.start||'99')||(a.row||1e9)-(b.row||1e9));
   return `<div class="b2t-day" data-day="${esc(k)}"><div><b>${esc(md(date))} · ${esc(c)}반</b><span class="b2-badge ${sheet?'t-rec':''}">${sheet?`그날 기준 ${esc(day.start)}~${esc(day.end)}`:`평소 기준 ${esc(day.start)}~${esc(day.end)}`}</span><span class="b2-sub">${esc(dayRuleText(day))}${sheet?'':' · 이 날은 아직 시간을 정한 줄이 없습니다'}</span></div><button class="b2-btn small soft" data-add="${esc(k)}" ${editing==='new'||busy?'disabled':''}>이 날 구간 더하기</button></div>${rows.map(rowHtml).join('')}`;
  }).join(''):`<div class="b2-muted b2-pad">${data.rows.length?'조건에 맞는 줄이 없습니다.':'이 기간·반에는 현장교육 일정 줄이 없습니다. 「새 시간 넣기」로 더할 수 있습니다.'}</div>`;
 }
 async function load({quiet=false}={}){
  const n=++seq;if(!quiet){data=null;loadErr='';render();}
  if(from>to){loadErr='시작일이 끝일보다 늦습니다.';data=null;render();return;}
  try{
   const res=await client.call('b2ModuleTimes',{from,to,...(cls==='all'?{}:{cls})});if(n!==seq||!life.alive())return;
   data={rev:res?.rev||0,defaults:res?.defaults||null,field:res?.field||null,rows:(res?.rows||[]).map(r=>({...r,cls:String(r.cls??''),start:isHHmm(r.start)?r.start:'',end:isHHmm(r.end)?r.end:''}))};loadErr='';
   const r=editing&&editing!=='new'?rowAt(editing):null;if(editing&&editing!=='new'&&(!r||r.date!==form?.date||r.cls!==form?.cls||r.module!==form?.module)){editing=null;form=null;} // 줄 번호가 다른 줄이 됐으면 닫음
  }catch(e){if(n!==seq||!life.alive())return;if(!quiet)data=null;loadErr=e;if(quiet)say(`다시 읽지 못했습니다: ${e.message}`,'warn');}
  render();
 }
 // 시트는 줄 번호(row)와 함께 그 줄의 원래 날짜·반·모듈(was)이 맞는지 보고, 그사이 다른 줄이 됐으면 '그 줄이 바뀌었습니다. 새로 읽어 주세요.'로 거절합니다(2026-10-20).
 const wasOf=r=>({date:r.date,cls:r.cls,module:r.module});
 const CHANGED_RE=/그 줄이 바뀌었습니다/;
 // 거절이 '그 줄이 바뀜'이면 고치던 값을 닫고 이유를 크게 보인 뒤 시트에서 다시 읽습니다. 아니면 false(부른 쪽이 되돌림).
 async function rowChanged(e,before){
  if(!CHANGED_RE.test(String(e?.message||'')))return false;
  if(life.alive()){data.rows=before;editing=null;form=null;formErr='';say(`${e.message} 그사이 시트의 줄이 바뀌어 저장하지 않았습니다. 시트에서 다시 읽었습니다 — 확인한 뒤 다시 해 주세요.`,'err');}
  busy=true;await reload();return true;
 }
 const blank=(date='',c='')=>({key:'new',date,cls:c||(cls==='all'?'':cls),module:'',start:'',end:'',part:'',reason:'',dirty:false});
 function open(key,preset){
  if(form?.dirty&&!confirm('저장하지 않은 교육시간이 있습니다. 버리고 열까요?'))return;
  formErr='';if(key==='new'){editing='new';form={...blank(),...preset};}
  else{const r=rowAt(key);if(!r)return;editing=key;form={key,row:r.row,was:wasOf(r),date:r.date,cls:r.cls,module:r.module,start:r.start,end:r.end,part:r.part||'',reason:'',dirty:false};}
  render();host.querySelector(`[data-editor="${CSS.escape(editing)}"] [data-f="${editing==='new'&&!form.date?'date':'start'}"]`)?.focus();
 }
 function close(){editing=null;form=null;formErr='';render();}
 // 저장: 화면에 먼저 고친 값('저장 중…')을 보이고, 못 하면 줄·입력값을 되돌려 이유를 보입니다. 되면 응답의 그날 기준을 기억하고(출결대조 판정) 시트에서 다시 읽습니다.
 async function save(){
  if(busy||!form)return;
  const existing=editing!=='new',f={...form,start:cleanTime(form.start),end:cleanTime(form.end),module:String(form.module||'').trim(),part:String(form.part||'').trim(),reason:String(form.reason||'').trim()};
  formErr=checkModuleTime(f,{existing});if(formErr){paintErr();return;}
  const before=data.rows,keep={editing,form},payload={...(existing?{row:f.row,was:f.was}:{}),date:f.date,cls:f.cls,module:f.module,start:f.start,end:f.end,part:f.part,reason:f.reason};
  const temp={...payload,key:existing?editing:`new${++tempSeq}`,row:existing?f.row:null,by:'',at:'',pending:'저장 중…'};
  data.rows=existing?data.rows.map(r=>keyOf(r)===editing?temp:r):[...data.rows,temp];
  busy=true;editing=null;form=null;formErr='';say('');render();
  try{
   const res=await client.call('b2ModuleTimeSave',payload);
   if(res?.day)rememberDayTimes(res.day);else forgetDayTimes(f.cls,f.date);
   if(life.alive()){const r={...payload,row:res?.row??temp.row,by:user?.email||'',at:'방금',pending:'다시 읽는 중…'};data.rows=data.rows.map(x=>x===temp?r:x);toast(`${md(f.date)} ${f.cls}반 ${f.module} ${f.start}~${f.end} 저장 · 그날 기준 ${res?.day?dayText(res.day):'다시 읽는 중'}`);}
  }catch(e){
   if(await rowChanged(e,before))return;
   if(life.alive()){data.rows=before;({editing,form}=keep);formErr=`저장하지 못했습니다: ${e.message}`;}
   busy=false;render();return;
  }
  await reload();
 }
 // 저장·지움 뒤 시트에서 다시 읽는 동안은 다른 저장·고치기를 잠급니다(지운 줄 아래 번호가 당겨져 옛 번호로 다른 줄을 고치지 않게).
 async function reload(){render();try{await load({quiet:true});}finally{busy=false;if(data)data.rows=data.rows.map(r=>r.pending?{...r,pending:''}:r);render();}} // 못 읽어도 화면 값은 남김(안내는 load가 보임)
 // 지우기: 「현장교육 일정」 탭에서 그 줄을 지웁니다(확인 뒤). 화면에서 먼저 빼고, 못 하면 되돌립니다. 그날 기준은 남은 줄로 다시 정해집니다.
 async function remove(key){
  const r=rowAt(key);if(!r||busy)return;
  if(!confirm(`${md(r.date)} ${r.cls}반 「${r.module}${r.part?' · '+r.part:''}」 ${timed(r)?`${r.start}~${r.end}`:'(시간 미정)'} 줄을 마스터시트 현장교육 일정 탭에서 지울까요?\n그날 기준은 남은 줄로 다시 정해집니다(없으면 평소 ${defaults().start}~${defaults().end}).`))return;
  const before=data.rows;data.rows=data.rows.filter(x=>x!==r);busy=true;if(editing===key){editing=null;form=null;}say('');render();
  try{await client.call('b2ModuleTimeSave',{row:r.row,was:wasOf(r),date:r.date,cls:r.cls,module:r.module,remove:true});forgetDayTimes(r.cls,r.date);toast(`${md(r.date)} ${r.cls}반 ${r.module} 줄을 지웠습니다.`);}
  catch(e){if(await rowChanged(e,before))return;if(life.alive()){data.rows=before;say(`지우지 못했습니다: ${e.message}`,'err');}busy=false;render();return;}
  await reload();
 }
 // 시간 비우기: 줄은 남기고 시작·끝을 비워 '시간 미정'으로 되돌립니다(확인 뒤, 시작·끝을 함께 비움). 그날 기준은 남은 줄로 다시 정해집니다.
 async function clearTimes(key){
  const r=rowAt(key);if(!r||busy||!timed(r))return;
  if(!confirm(`${md(r.date)} ${r.cls}반 「${r.module}${r.part?' · '+r.part:''}」 ${r.start}~${r.end} 시간을 비울까요?\n줄은 남고 '시간 미정'이 됩니다. 그날 기준은 남은 줄로 다시 정해집니다(없으면 평소 ${defaults().start}~${defaults().end}).`))return;
  const payload={row:r.row,was:wasOf(r),date:r.date,cls:r.cls,module:r.module,start:'',end:'',part:r.part||'',reason:'시간 미정으로 되돌림'};
  const before=data.rows;data.rows=data.rows.map(x=>x===r?{...r,start:'',end:'',pending:'저장 중…'}:x);busy=true;if(editing===key){editing=null;form=null;}say('');render();
  try{const res=await client.call('b2ModuleTimeSave',payload);if(res?.day)rememberDayTimes(res.day);else forgetDayTimes(r.cls,r.date);toast(`${md(r.date)} ${r.cls}반 ${r.module} 시간을 비웠습니다(시간 미정).`);}
  catch(e){if(await rowChanged(e,before))return;if(life.alive()){data.rows=before;say(`시간을 비우지 못했습니다: ${e.message}`,'err');}busy=false;render();return;}
  await reload();
 }
 const paintErr=()=>{const el=host.querySelector(`[data-editor="${CSS.escape(editing||'')}"] [data-err]`);if(el)el.textContent=formErr;else render();};
 const paintPreview=()=>{const el=host.querySelector(`[data-editor="${CSS.escape(editing||'')}"] [data-preview]`);if(el&&form)el.textContent=previewText(form);};
 host.addEventListener('input',e=>{
  const t=e.target;if(!form||!t.dataset.f||!t.closest('[data-editor]'))return;
  form[t.dataset.f]=t.value;form.dirty=true;if(formErr){formErr='';paintErr();}
  if(['date','cls'].includes(t.dataset.f)){const dl=host.querySelector('#t2Modules');if(dl)dl.innerHTML=modulesFor(form.date,form.cls).map(m=>`<option value="${esc(m)}">`).join('');}
  paintPreview();
 });
 host.addEventListener('change',e=>{if(e.target.dataset.f==='cls'&&form){form.cls=e.target.value;form.dirty=true;paintPreview();}});
 host.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t||t.disabled)return;
  if(t.dataset.view){view=t.dataset.view;render();return;}
  if(t.dataset.preset&&form){const [s,en]=t.dataset.preset.split('|'),ed=t.closest('[data-editor]');form.start=s;form.end=en;form.dirty=true;ed.querySelector('[data-f="start"]').value=s;ed.querySelector('[data-f="end"]').value=en;formErr='';paintErr();paintPreview();return;}
  if(t.dataset.add!==undefined){const [date,c]=t.dataset.add.split('|');open('new',{date,cls:c});return;}
  if(t.id==='t2New'){open('new');return;}
  if(t.hasAttribute('data-cancel')){if(form?.dirty&&!confirm('저장하지 않은 교육시간을 버릴까요?'))return;close();return;}
  if(t.hasAttribute('data-save')){void save();return;}
  const key=t.closest('[data-key]')?.dataset.key;
  if(t.hasAttribute('data-edit')&&key){if(editing===key){if(form?.dirty&&!confirm('저장하지 않은 교육시간을 버릴까요?'))return;close();}else open(key);return;}
  if(t.hasAttribute('data-del')&&key){void remove(key);return;}
  if(t.hasAttribute('data-clear')&&key){void clearTimes(key);}
 });
 host.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-editor] input')){e.preventDefault();void save();}});
 $('#t2Class').onchange=e=>{cls=e.target.value;void load();};
 $('#t2From').onchange=e=>{from=e.target.value||COURSE_START;void load();};
 $('#t2To').onchange=e=>{to=e.target.value||COURSE_END;void load();};
 $('#t2Reload').onclick=()=>{if(!busy)void load();};
 await load();
 return {dispose:()=>life.dispose(),canLeave:()=>busy?(say('저장 중입니다. 끝난 뒤 이동해 주세요.','warn'),false):!form?.dirty||confirm('저장하지 않은 교육시간이 있습니다. 화면을 떠날까요?')};
}
