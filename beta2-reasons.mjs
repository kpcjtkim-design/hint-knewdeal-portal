// 공지·설정 › 사유 목록(관리자, 사용자 2026-10-20 '사유 드롭다운을 관리자 측에서 설정할 수 있는 그런 화면 … 자율성 높이게').
// 출결대조·담임 화면의 사유 드롭다운과 해석기(체크히어 메모 분류·질병 판정·기간 비고)가 쓰는 목록(settings/reasonCatalog)을 고칩니다.
// 분류: 추가·이름 바꾸기·순서·숨기기, 인정 여부·질병 포함·추가 증빙·증빙 안내·체크히어 분류·찾는 말. 세부: 추가·이름·인정·숨기기(저장 글은 새로 넣은 것만 고침).
// 종류(인적성·자격증): 추가·이름·과정별 O/△/X·비고·숨기기. 지우기 대신 숨기기(옛 기록 해석 때문에 목록에 남김).
// 옆 종류 드롭다운(사용자 2026-10-20 '경조사 등도 그냥 옆으로 드롭다운'): 보이는 세부가 둘 이상인 분류는 출결 화면에서 분류 하나 + 옆 종류 드롭다운(세부 목록)으로 보입니다.
// 세부 목록이 곧 그 분류의 옆 드롭다운 목록이라 데이터 모양은 그대로이고, 옛 저장본도 그대로 읽힙니다. 미리보기는 출결대조·담임 화면과 같은 공용 칸(reason-pick.mjs).
// 미리보기(출결대조 드롭다운 모양), 저장(rev 확인 트랜잭션, 저장한 사람·시각), 기본값으로 되돌리기(저장해야 적용), 저장하지 않은 변경은 떠날 때 확인.
import {esc,toast,loading,lifecycle} from './beta2-ui.mjs';
import {DEFAULT_REASON_CATALOG,cloneCatalog,validateReasonCatalog,withReasonCatalog,reasonOptions,subOptions,reasonPick,reasonChecks,RULES,OTHER,NA,NOT_RECOGNIZED} from './attendance-reason-catalog.mjs';
import {pickReasonText} from './reason-pick.mjs';
import {readReasonCatalogDoc,saveReasonCatalog} from './reason-catalog-store.mjs';

const STYLE=`.b2r .b2r-grid{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:14px;align-items:start}
.b2r .b2r-cats{display:grid;gap:4px;padding:10px}.b2r .b2r-cat{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--b2-line);border-radius:8px;background:#fff}
.b2r .b2r-cat.on{border-color:#2563eb;background:#eff6ff}.b2r .b2r-cat.off{opacity:.55}.b2r .b2r-cat button.pick{flex:1;text-align:left;background:none;border:0;font:inherit;font-weight:700;cursor:pointer;padding:0}
.b2r .b2r-cat .mv{padding:2px 6px}.b2r .b2r-ed{padding:12px 14px;display:grid;gap:10px}.b2r .b2r-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 12px;align-items:end}
.b2r .b2r-row .wide{grid-column:1/-1}.b2r .b2r-checks{display:flex;flex-wrap:wrap;gap:6px 16px}.b2r .b2r-checks label{display:flex;gap:4px;align-items:center;font-size:13px}
.b2r table input[type=text]{width:100%;min-width:0}.b2r .b2r-add{display:flex;gap:6px;margin-top:6px}.b2r .b2r-add input{flex:1}
.b2r .b2r-pv{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 14px}.b2r .b2r-pv select{max-width:260px}
@media(max-width:820px){.b2r .b2r-grid{grid-template-columns:1fr}}`;
const COURSE_CLASS={emb:'1',mfg:'2'}; // 미리보기: 1반 모빌리티 AI(임베디드AI 기준), 2반 제조지능화
const list=v=>String(v||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
const joinList=a=>(a||[]).join(', ');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function mount(host,{db,user}){
 const life=lifecycle(host);
 let base=null,draft=null,baseline=null,pick=0,msg=null,busy=false,loadErr='',pv={type:'인정출석',course:'emb',main:'',sub:''};
 const fresh=new Set(); // 이번 편집에서 새로 넣은 분류 키·세부 글·종류 값(저장 글이 되는 키는 이것만 고칠 수 있음)
 host.innerHTML=`<div class="b2 b2r"><style>${STYLE}</style><div class="b2-head"><div><h2>사유 목록</h2><p>출결대조·담임 화면의 사유 드롭다운과 체크히어 메모 분류·질병 판정·기간 비고가 쓰는 목록입니다. 저장하면 다음에 화면을 여는 사람부터 적용됩니다. 옛 기록 해석 때문에 지우기 대신 「숨기기」를 씁니다.</p></div></div>
 <div id="rcState"></div><div id="rcMsg"></div><div id="rcBody">${loading('사유 목록을 불러오는 중…')}</div></div>`;
 const $=s=>host.querySelector(s);
 const dirty=()=>!!draft&&!same(draft,baseline);
 const cat=()=>draft?.cats[pick]||null;
 const errors=()=>draft?validateReasonCatalog(draft).errors:[];
 function say(text,kind=''){msg=text?{text,kind}:null;paintMsg();}
 function paintMsg(){const el=$('#rcMsg');if(el)el.innerHTML=msg?`<div class="b2-note ${msg.kind}" style="margin:0 0 10px" role="status">${esc(msg.text)}</div>`:'';}
 async function load({force=false}={}){
  if(!force&&dirty()&&!confirm('저장하지 않은 사유 목록 변경이 있습니다. 버리고 새로 불러올까요?'))return;
  loadErr='';$('#rcBody').innerHTML=loading('사유 목록을 불러오는 중…');
  try{base=await readReasonCatalogDoc(db,user,{fresh:true});}catch(e){base=null;loadErr=e?.message||String(e);}
  if(!life.alive())return;
  const valid=base?.catalog!=null&&validateReasonCatalog(base.catalog).ok;
  draft=cloneCatalog(valid?base.catalog:DEFAULT_REASON_CATALOG);baseline=cloneCatalog(draft);fresh.clear();pick=Math.min(pick,draft.cats.length-1);
  if(base?.catalog!=null&&!valid)say(`저장된 사유 목록이 올바르지 않아 기본 목록을 보여 줍니다(출결 화면도 기본 목록을 씁니다) · ${validateReasonCatalog(base.catalog).errors[0]}`,'warn');
  render();
 }
 function stateHtml(){
  if(loadErr)return `<div class="b2-note err" style="margin:0 0 10px">저장된 사유 목록을 읽지 못했습니다 · ${esc(loadErr)} (기본 목록을 보여 줍니다. 저장은 막습니다)</div>`;
  const when=base?.updatedAt?new Date(base.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
  return `<div class="b2-tiny b2-muted" style="margin:0 0 8px" id="rcSaved">${base?.exists?`저장본 ${base.rev}번 · ${esc(base.updatedBy||'?')}${when?` · ${esc(when)}`:''}`:'저장본 없음 · 코드의 기본 목록을 쓰는 중'}${dirty()?' · <b class="b2-dirty">저장 전 변경 있음</b>':''}</div>`;
 }
 function catsHtml(){
  // '해당없음'(사용자 2026-10-20 부활): 사유 드롭다운 맨 위 고정 항목. 숨기기만(이름 바꾸기·순서·지우기 없음)
  return `<div class="b2r-cats" role="list" aria-label="분류"><div class="b2r-cat ${draft.naHidden?'off':''}" role="listitem" id="rcNa"><b style="flex:1">${NA}</b><span class="b2-badge t-na" title="사유 드롭다운 맨 위 고정 항목 · 저장 글 '${NA}' · 이름 바꾸기·지우기 없음">고정</span><label class="b2-tiny"><input type="checkbox" id="rcNaHidden" ${draft.naHidden?'checked':''}>숨기기</label></div>${draft.cats.map((c,i)=>`<div class="b2r-cat ${i===pick?'on':''} ${c.hidden?'off':''}" role="listitem" data-cat="${i}">
   <button class="b2-btn small ghost mv" data-move="up" data-i="${i}" ${i?'':'disabled'} aria-label="${esc(c.label)} 위로">↑</button><button class="b2-btn small ghost mv" data-move="down" data-i="${i}" ${i<draft.cats.length-1?'':'disabled'} aria-label="${esc(c.label)} 아래로">↓</button>
   <button class="pick" data-pick="${i}">${c.recognized?'':`<span class="b2-muted">${NOT_RECOGNIZED}</span> `}${esc(c.label)}</button>${c.hidden?'<span class="b2-badge t-na">숨김</span>':''}</div>`).join('')}
   <div class="b2r-add"><input type="text" id="rcNewCat" maxlength="20" placeholder="새 분류 이름" aria-label="새 분류 이름"><button class="b2-btn small" id="rcAddCat">분류 추가</button></div></div>`;
 }
 function subsHtml(c){
  const side=c.subs.filter(s=>!s.hidden).length>1;
  return `<div class="b2-tiny b2-muted" id="rcSideNote">${side?`출결 화면에서 사유 드롭다운에는 '${esc(c.label)}' 하나, 바로 옆 종류 드롭다운에 아래 세부(숨긴 것 빼고)가 보입니다. 저장 글은 세부의 저장 글, 분류만 고르면 '${esc(c.key)}', 옆 칸 기타는 '${esc(c.key)}(직접 입력)'.`:`세부가 하나뿐이라 사유 드롭다운에 그 글 하나로 보입니다. 세부를 둘 이상 두면 옆 종류 드롭다운이 생깁니다.`}</div>
   <table class="b2-table"><thead><tr><th>저장 글</th><th>세부 이름</th><th>인정</th><th>숨기기</th></tr></thead><tbody>${c.subs.map((s,i)=>`<tr data-sub="${i}">
   <td>${fresh.has('s:'+s.text)?`<input type="text" data-s="text" data-i="${i}" value="${esc(s.text)}" maxlength="60" aria-label="저장 글">`:`<b>${esc(s.text)}</b>`}</td>
   <td><input type="text" data-s="label" data-i="${i}" value="${esc(s.label||'')}" maxlength="60" aria-label="${esc(s.text)} 세부 이름"></td>
   <td><input type="checkbox" data-scb="recognized" data-i="${i}" ${s.recognized!==false?'checked':''} ${c.recognized?'':'disabled title="분류가 인정 사유가 아닙니다"'} aria-label="${esc(s.text)} 인정"></td>
   <td><input type="checkbox" data-scb="hidden" data-i="${i}" ${s.hidden?'checked':''} aria-label="${esc(s.text)} 숨기기"></td></tr>`).join('')}</tbody></table>
   <div class="b2r-add"><input type="text" id="rcNewSub" maxlength="60" placeholder="새 세부의 저장 글 (예: ${esc(c.key)}(한방))" aria-label="새 세부 저장 글"><button class="b2-btn small" id="rcAddSub">세부 추가</button></div>`;
 }
 function kindsHtml(c){
  const k=draft.kinds[c.kind],courses=draft.courses;
  return `<div class="b2-tiny b2-muted">저장 글은 '${esc(c.key)}(종류 값)'입니다. ${courses.map(x=>`${esc(x.label)}(${esc(x.code||'')})`).join(' · ')} 기준: O 인정 · △ 관련성 확인 필요 · X 인정 출결에서 고를 수 없음 · 빈칸은 기준 없음</div>
   <table class="b2-table"><thead><tr><th>종류 값</th><th>보이는 이름</th>${courses.map(x=>`<th>${esc(x.label)}</th>`).join('')}<th>비고</th><th>숨기기</th></tr></thead><tbody>${k.items.map((it,i)=>`<tr data-kind-row="${i}">
   <td>${fresh.has('k:'+it.value)?`<input type="text" data-k="value" data-i="${i}" value="${esc(it.value)}" maxlength="40" aria-label="종류 값">`:`<b>${esc(it.value)}</b>`}</td>
   <td><input type="text" data-k="label" data-i="${i}" value="${esc(it.label||'')}" maxlength="60" aria-label="${esc(it.value)} 보이는 이름"></td>
   ${courses.map(x=>`<td><select data-kr="${esc(x.key)}" data-i="${i}" aria-label="${esc(it.value)} ${esc(x.label)} 기준"><option value="" ${it.rules?.[x.key]?'':'selected'}>-</option>${RULES.map(r=>`<option ${it.rules?.[x.key]===r?'selected':''}>${r}</option>`).join('')}</select></td>`).join('')}
   <td><input type="text" data-k="note" data-i="${i}" value="${esc(it.note||'')}" maxlength="200" aria-label="${esc(it.value)} 비고"></td>
   <td><input type="checkbox" data-kcb="hidden" data-i="${i}" ${it.hidden?'checked':''} aria-label="${esc(it.value)} 숨기기"></td></tr>`).join('')}</tbody></table>
   <div class="b2r-add"><input type="text" id="rcNewKind" maxlength="40" placeholder="새 종류 값(괄호 없이)" aria-label="새 종류 값"><button class="b2-btn small" id="rcAddKind">종류 추가</button></div>`;
 }
 function editorHtml(){
  const c=cat();if(!c)return '';
  const field=(f,label,v,attrs='')=>`<label class="b2-field">${label}<input type="text" data-c="${f}" value="${esc(v??'')}" ${attrs}></label>`;
  return `<div class="b2r-ed" id="rcEditor"><div class="b2r-row">
   ${fresh.has('c:'+c.key)?field('key','분류 키(저장 글 앞말)',c.key,'maxlength="20"'):`<div class="b2-field">분류 키(저장 글 앞말)<b>${esc(c.key)}</b></div>`}
   ${field('label','분류 이름',c.label,'maxlength="40"')}${field('memo','체크히어 메모 분류',c.memo??'','maxlength="20" placeholder="비우면 보내지 않음"')}</div>
   <div class="b2r-checks"><label><input type="checkbox" data-cb="recognized" ${c.recognized?'checked':''}>인정 사유</label><label><input type="checkbox" data-cb="disease" ${c.disease?'checked':''}>질병 판정에 넣기</label>
    <label><input type="checkbox" data-cb="extraOn" ${c.extra?'checked':''}>추가 증빙</label><label><input type="checkbox" data-cb="hidden" ${c.hidden?'checked':''}>숨기기(드롭다운에서만 빠짐)</label></div>
   <div class="b2r-row">${c.extra?field('extra','추가 증빙 서류',c.extra,'maxlength="60"'):''}<label class="b2-field wide">증빙 안내<input type="text" data-c="evidence" value="${esc(c.evidence||'')}" maxlength="300"></label>
    <label class="b2-field wide">찾는 말(옛 자유 글, 쉼표로)<input type="text" data-c="words" value="${esc(joinList(c.words))}"></label>
    <label class="b2-field wide">기간 비고에서 이 분류로 줄일 글(정확히 같을 때, 쉼표로)<input type="text" data-c="period" value="${esc(joinList(c.period))}"></label></div>
   ${c.kind?kindsHtml(c):subsHtml(c)}</div>`;
 }
 function previewHtml(){
  const errs=errors();
  const html=withReasonCatalog(errs.length?DEFAULT_REASON_CATALOG:draft,()=>{
   const s=reasonPick(pv.main),cls=COURSE_CLASS[pv.course]||'1',text=s.kind?(pv.sub&&pv.sub!==OTHER?pickReasonText(pv.main,'rsub',pv.sub).text:s.kind):pv.main===OTHER?'':pv.main;
   const checks=reasonChecks(pv.type,text,{cls});
   return `<select id="rcPvMain" aria-label="미리보기 사유">${reasonOptions(pv.main,{type:pv.type,blank:'사유 고르기'})}</select>${s.kind?`<select id="rcPvSub" aria-label="미리보기 종류">${subOptions(s.kind,pv.sub,{type:pv.type,cls})}</select>`:''}${checks.map(c=>`<span class="${c.level==='error'?'b2-err':'b2-xnote'}">${esc(c.text)}</span>`).join('')}`;
  });
  return `<section class="b2-card" style="margin-top:12px"><div class="b2-toolbar"><b>미리보기 (출결대조·담임 출결판 드롭다운)</b><label class="b2-field">유형<select id="rcPvType">${['인정출석','인정지각','결석','지각'].map(t=>`<option ${t===pv.type?'selected':''}>${t}</option>`).join('')}</select></label>
   <label class="b2-field">과정 기준<select id="rcPvCourse">${draft.courses.map(c=>`<option value="${esc(c.key)}" ${c.key===pv.course?'selected':''}>${esc(c.label)}</option>`).join('')}</select></label></div>
   <div class="b2r-pv" id="rcPreview">${errs.length?'<span class="b2-err">목록에 고칠 곳이 있어 기본 목록으로 보여 줍니다</span>':''}${html}</div></section>`;
 }
 function errorsHtml(){const e=errors();return e.length?`<div class="b2-note err" id="rcErrors" style="margin:10px 0 0">저장할 수 없습니다 · ${e.map(esc).join(' · ')}</div>`:'';}
 function render(){
  if(!life.alive())return;
  $('#rcState').innerHTML=stateHtml();paintMsg();
  $('#rcBody').innerHTML=`<section class="b2-card"><div class="b2-toolbar"><button class="b2-btn ghost" id="rcReload">새로 불러오기</button><button class="b2-btn ghost" id="rcDefault">기본값으로 되돌리기</button><span class="b2-grow"></span>
   <button class="b2-btn primary" id="rcSave" ${!dirty()||busy||errors().length||loadErr?'disabled':''}>${busy?'저장 중…':dirty()?'변경 저장':'변경 없음'}</button></div>
   <div class="b2r-grid">${catsHtml()}${editorHtml()}</div><div id="rcErrBox" style="padding:0 14px 12px">${errorsHtml()}</div></section><div id="rcPvBox">${previewHtml()}</div>`;
 }
 // 입력 중에는 편집 칸을 다시 그리지 않고(포커스 유지) 상태·목록·미리보기·오류만 고칩니다.
 function paintSide(){
  $('#rcState').innerHTML=stateHtml();
  const save=$('#rcSave');if(save){save.disabled=!dirty()||busy||!!errors().length||!!loadErr;save.textContent=busy?'저장 중…':dirty()?'변경 저장':'변경 없음';}
  const cats=host.querySelector('.b2r-cats');if(cats)cats.outerHTML=catsHtml();
  $('#rcErrBox').innerHTML=errorsHtml();$('#rcPvBox').innerHTML=previewHtml();
 }
 function edit(fn,{redraw=false}={}){fn();if(redraw)render();else paintSide();}
 host.addEventListener('input',e=>{
  const t=e.target,c=cat();if(!c||!draft)return;const i=+t.dataset.i;
  if(t.dataset.c){const f=t.dataset.c;edit(()=>{
   if(f==='words'||f==='period'){const v=list(t.value);if(v.length)c[f]=v;else delete c[f];}
   else if(f==='key'){fresh.delete('c:'+c.key);c.key=t.value.trim();fresh.add('c:'+c.key);}
   else if(f==='memo'){c.memo=t.value.trim();}
   else c[f]=t.value;
  });}
  else if(t.dataset.s){const s=c.subs[i];edit(()=>{if(t.dataset.s==='text'){fresh.delete('s:'+s.text);s.text=t.value.trim();fresh.add('s:'+s.text);}else s.label=t.value;});}
  else if(t.dataset.k){const it=draft.kinds[c.kind].items[i];edit(()=>{if(t.dataset.k==='value'){fresh.delete('k:'+it.value);it.value=t.value.trim();fresh.add('k:'+it.value);}else if(t.dataset.k==='note'){if(t.value)it.note=t.value;else delete it.note;}else it.label=t.value;});}
 });
 host.addEventListener('change',e=>{
  const t=e.target,c=cat();if(!draft)return;const i=+t.dataset.i;
  if(t.id==='rcPvType'){pv.type=t.value;return paintSide();}
  if(t.id==='rcPvCourse'){pv.course=t.value;return paintSide();}
  if(t.id==='rcPvMain'){pv.main=t.value;pv.sub='';return paintSide();}
  if(t.id==='rcPvSub'){pv.sub=t.value;return paintSide();}
  if(t.id==='rcNaHidden'){edit(()=>{if(t.checked)draft.naHidden=true;else delete draft.naHidden;},{redraw:true});return;}
  if(!c)return;
  if(t.dataset.cb){const f=t.dataset.cb;edit(()=>{
   if(f==='extraOn'){if(t.checked)c.extra=c.extra||'추가 증빙 서류';else delete c.extra;}
   else if(f==='recognized'){c.recognized=t.checked;if(!t.checked)c.memo='';else if(!c.memo)c.memo=c.key;}
   else if(t.checked)c[f]=true;else delete c[f];
  },{redraw:true});}
  else if(t.dataset.scb){const s=c.subs[i],f=t.dataset.scb;edit(()=>{if(f==='recognized'){if(t.checked)delete s.recognized;else s.recognized=false;}else if(t.checked)s[f]=true;else delete s[f];},{redraw:true});}
  else if(t.dataset.kcb){const it=draft.kinds[c.kind].items[i];edit(()=>{if(t.checked)it.hidden=true;else delete it.hidden;},{redraw:true});}
  else if(t.dataset.kr){const it=draft.kinds[c.kind].items[i];edit(()=>{it.rules={...(it.rules||{})};if(t.value)it.rules[t.dataset.kr]=t.value;else delete it.rules[t.dataset.kr];if(!Object.keys(it.rules).length)delete it.rules;});}
 });
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||!draft)return;
  if(b.dataset.pick!==undefined){pick=+b.dataset.pick;return render();}
  if(b.dataset.move){const i=+b.dataset.i,j=b.dataset.move==='up'?i-1:i+1;if(j<0||j>=draft.cats.length)return;edit(()=>{[draft.cats[i],draft.cats[j]]=[draft.cats[j],draft.cats[i]];if(pick===i)pick=j;else if(pick===j)pick=i;},{redraw:true});return;}
  if(b.id==='rcAddCat'){
   const label=$('#rcNewCat').value.trim(),key=label.replace(/[()\s]/g,'').slice(0,20);
   if(!key)return say('새 분류 이름을 적어 주세요.','warn');if(draft.cats.some(c=>c.key===key))return say(`'${key}' 분류가 이미 있습니다.`,'warn');
   edit(()=>{draft.cats.push({key,label,recognized:true,memo:key,evidence:'',words:[key],subs:[{text:key,label}]});fresh.add('c:'+key);fresh.add('s:'+key);pick=draft.cats.length-1;},{redraw:true});say(`'${label}' 분류를 넣었습니다. 저장해야 적용됩니다.`);return;
  }
  if(b.id==='rcAddSub'){const c=cat(),text=$('#rcNewSub').value.trim();if(!text)return say('새 세부의 저장 글을 적어 주세요.','warn');
   const label=(text.match(/\(([^()]+)\)$/)||[])[1]||text;edit(()=>{c.subs.push({text,label});fresh.add('s:'+text);},{redraw:true});return;}
  if(b.id==='rcAddKind'){const c=cat(),value=$('#rcNewKind').value.trim();if(!value)return say('새 종류 값을 적어 주세요.','warn');
   const ruled=draft.kinds[c.kind].items.some(x=>x.rules);edit(()=>{draft.kinds[c.kind].items.push({value,label:value,...(ruled?{rules:Object.fromEntries(draft.courses.map(x=>[x.key,'△']))}:{})});fresh.add('k:'+value);},{redraw:true});return;}
  if(b.id==='rcReload'){await load();return;}
  if(b.id==='rcDefault'){if(!confirm('기본 목록(코드에 있는 목록)으로 되돌릴까요? 「변경 저장」을 눌러야 적용됩니다.'))return;edit(()=>{draft=cloneCatalog(DEFAULT_REASON_CATALOG);fresh.clear();pick=0;},{redraw:true});say('기본 목록을 불러왔습니다. 「변경 저장」을 눌러야 적용됩니다.');return;}
  if(b.id==='rcSave'){
   if(busy||!dirty())return;busy=true;paintSide();
   try{const rev=await saveReasonCatalog(db,user,draft,{baseRev:base?.rev||0});busy=false;await load({force:true});say(`저장했습니다 · 저장본 ${rev}번. 다음에 화면을 여는 사람부터 새 목록을 씁니다.`,'');toast('사유 목록을 저장했습니다.');}
   catch(err){busy=false;paintSide();say(err?.message||String(err),'err');}
   return;
  }
 });
 const warn=e=>{if(dirty()){e.preventDefault();e.returnValue='';}};
 addEventListener('beforeunload',warn);life.on(()=>removeEventListener('beforeunload',warn));
 await load({force:true});
 return {
  canLeave(){if(busy){say('저장 중입니다. 끝난 뒤 이동해 주세요.','warn');return false;}return !dirty()||confirm('저장하지 않은 사유 목록 변경이 있습니다. 화면을 떠날까요?');},
  dispose(){life.dispose();}
 };
}
