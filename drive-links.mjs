// 구글 드라이브 폴더 바로가기(사용자 요청 2026-10-21): 담임은 고른 날짜의 수기출석·출결인정자료·교육사진 폴더로 바로 가고,
// 관리자는 출결대조·반 현황에서 그 반·그날 폴더(담임이 올리는 곳)와 그날이 든 단위기간 폴더(1. 단위기간출석부 · 2. 출석입력요청대장 · 3. 출석인정서류)로 갑니다.
// 내려받기 › 단위기간 출석부 아래에는 반·단위마다 1·2·3 폴더 바로가기가 있습니다(mountUnitFolders).
// 폴더 목록은 2기 Apps Script b2DriveFolders({cls?,date?} → {builtAt,done,rows:[{cls,kind,unit,date,id,name}]})가 미리 만들어 둔 목록입니다.
// 목록 만들기(b2DriveIndexBuild, 4.5분)는 편집기에서만 돌리고 웹은 부르지 않습니다. 목록이 아직 없으면(rows 없음·done:false) '폴더 목록 준비 중'만 보입니다.
// 날짜 폴더가 없으면 위로 올라갑니다: 그날 폴더 → 그날이 든 주차(WEEK n) 폴더 → 반 폴더. 어느 단계를 열었는지는 단추 옆 작은 글과 title로 알립니다.
// 그날 폴더 파일 수(b2DriveCount, 500개까지)는 화면을 그린 뒤 잠깐 있다가(또는 마우스를 올리거나 초점이 오면) 읽어 'n개'·'없음'·'?'로 붙입니다. 화면을 막지 않습니다.
// 링크는 새 탭(rel=noopener)으로 엽니다. 스타일은 이 파일이 한 번 넣습니다(beta2.css를 건드리지 않음).
import {esc,md,classOptions} from './beta2-ui.mjs';
import {unitPeriodOf,UNIT_PERIODS,addDays} from './cohort.mjs';

// 날짜 폴더 종류(담임·관리자 공통, 이 순서로 보임)와 단위기간 폴더 종류(관리자만)
export const DATE_KINDS=['manual','evidence','photo'];
export const UNIT_KINDS=['unit','unitSheet','unitRequest','unitEvidence'];
export const KIND_LABEL={manual:'수기출석',evidence:'출결인정자료',photo:'교육사진',unit:'단위기간',unitSheet:'1. 단위기간출석부',unitRequest:'2. 출석입력요청대장',unitEvidence:'3. 출석인정서류'};
export const NOT_BUILT='폴더 목록 준비 중';
export const folderUrl=id=>`https://drive.google.com/drive/folders/${encodeURIComponent(String(id))}`;
const isDay=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const same=(a,b)=>String(a)===String(b);
const isWeek=u=>/^WEEK\s*\d+$/i.test(String(u||'').trim());
const isUnit=u=>/^\d+\s*단위$/.test(String(u||'').trim());
const unitNo=u=>+(/(\d+)/.exec(String(u||''))||[0,0])[1];

// 목록 상태: ready(링크를 그릴 수 있음) · partial(만드는 중이라 일부만) · empty(아직 없음)
export function indexState(data){
 const rows=Array.isArray(data?.rows)?data.rows.filter(r=>r&&r.id):[];
 return {rows,builtAt:data?.builtAt??'',ready:rows.length>0,partial:rows.length>0&&data?.done===false,empty:!rows.length};
}
// 묶음(WEEK n·N단위)마다 날짜 폴더가 있는 기간 [min,max]
function spans(rows,cls,test){
 const m=new Map();
 for(const r of rows){if(!same(r.cls,cls)||!isDay(r.date)||!test(r.unit))continue;const s=m.get(r.unit);if(!s)m.set(r.unit,{min:r.date,max:r.date});else{if(r.date<s.min)s.min=r.date;if(r.date>s.max)s.max=r.date;}}
 return m;
}
// 그날이 든 묶음: 기간 안이면 그것, 아니면 그날 전에 시작했고 끝난 지 6일이 안 된 묶음 가운데 가장 늦게 시작한 것(주말·휴일처럼 사이에 낀 날)
function spanOf(m,date){
 let best=null;
 for(const [u,s] of m){if(date>=s.min&&date<=s.max)return u;if(s.min<=date&&date<=addDays(s.max,6)&&(!best||s.min>m.get(best).min))best=u;}
 return best;
}
export const weekOf=(rows,cls,date)=>isDay(date)?spanOf(spans(rows,cls,isWeek),date):null;
// 그날이 든 단위기간: cohort.json 단위기간(번호)이 목록에 있으면 그것, 아니면 날짜 폴더가 있는 기간으로
export function unitOf(rows,cls,date){
 if(!isDay(date))return null;
 const p=unitPeriodOf(date),hit=p&&rows.find(r=>same(r.cls,cls)&&isUnit(r.unit)&&unitNo(r.unit)===p.no);
 return hit?hit.unit:spanOf(spans(rows,cls,isUnit),date);
}
// 날짜 폴더 고르기: 그날 → 주차(WEEK n) → 반 폴더. 없으면 null.
export function pickFolder(rows,{cls,date,kind}){
 const mine=rows.filter(r=>same(r.cls,cls)&&r.kind===kind);
 if(isDay(date)){const d=mine.find(r=>r.date===date);if(d)return {row:d,level:'date',unit:d.unit||''};}
 const week=weekOf(rows,cls,date),w=week&&mine.find(r=>!r.date&&r.unit===week);if(w)return {row:w,level:'week',unit:week};
 const c=mine.find(r=>!r.date&&!r.unit);return c?{row:c,level:'class',unit:''}:null;
}
// 단위기간 폴더(그 단위 반 폴더·1·2·3): 3. 출석인정서류는 그날 하위 폴더가 있으면 그것, 아니면 단위 폴더
export function pickUnit(rows,{cls,date='',unit=''}){
 const u=unit||unitOf(rows,cls,date);if(!u)return null;
 const at=kind=>{const list=rows.filter(r=>same(r.cls,cls)&&r.kind===kind&&r.unit===u),d=isDay(date)&&list.find(r=>r.date===date);if(d)return {row:d,level:'date',unit:u};const top=list.find(r=>!r.date);return top?{row:top,level:'unit',unit:u}:null;};
 return {unit:u,picks:Object.fromEntries(UNIT_KINDS.map(k=>[k,at(k)]))};
}
// 어느 단계를 여는지 알리는 글(title)과 단추 옆 짧은 글
export function levelTitle(p,{cls,date,kind}){
 const what=KIND_LABEL[kind]||kind,name=p.row.name?` · ${p.row.name}`:'';
 if(p.level==='date')return `${what} · ${md(date)} 날짜 폴더를 엽니다${name}`;
 if(p.level==='week')return `${what} · ${md(date)} 날짜 폴더가 없어 ${p.unit} 폴더를 엽니다${name}`;
 if(p.level==='unit')return `${what} · ${p.unit} 폴더를 엽니다${name}`;
 return `${what} · ${isDay(date)?`${md(date)} 날짜·주차 폴더가 없어 `:''}${cls}반 폴더를 엽니다${name}`;
}
export const levelShort=p=>p.level==='week'?p.unit:p.level==='class'?'반 폴더':'';
// 링크 모양(그리기 전 값): links(날짜 폴더 셋), unit(관리자만, 그날이 든 단위기간)
export function driveLinks(data,{cls,date='',admin=false}={}){
 const st=indexState(data),rows=st.rows;
 const link=(kind,p,label=KIND_LABEL[kind])=>p?{kind,label,url:folderUrl(p.row.id),level:p.level,short:levelShort(p),title:levelTitle(p,{cls,date,kind})}:{kind,label,url:'',level:'',short:'',title:`${KIND_LABEL[kind]} 폴더가 목록에 없습니다`};
 const links=DATE_KINDS.map(k=>link(k,pickFolder(rows,{cls,date,kind:k})));
 let unit=null;
 if(admin){const u=pickUnit(rows,{cls,date});if(u)unit={unit:u.unit,links:UNIT_KINDS.map(k=>link(k,u.picks[k],k==='unit'?u.unit:k==='unitEvidence'&&u.picks[k]?.level==='date'?`${KIND_LABEL[k]}(${md(date)})`:KIND_LABEL[k]))};}
 return {...st,links,unit};
}
// 파일 수 글: 숫자면 'n개'(max 이상이면 'max개+'), 0이나 폴더 없음(null)이면 '없음', 못 읽었으면 '?'
export function countText(n,max=500){
 if(n===undefined)return '';if(n===null)return '없음';if(n==='?'||n===''||!Number.isFinite(+n))return '?';
 const v=+n;return v<=0?'없음':v>=max?`${max}개+`:`${v}개`;
}
const whenText=v=>{if(v===''||v==null)return '';const t=typeof v==='number'?v:Date.parse(v);if(!Number.isFinite(t))return String(v);return new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});};
const failText=e=>e?.code==='SHEET_OUTDATED'?'드라이브 폴더 · 시트 업데이트 대기':'드라이브 폴더 목록을 불러오지 못했습니다';
const fetchFolders=(client,cls)=>client.driveFolders?client.driveFolders({cls}):client.call('b2DriveFolders',{cls});
const fetchCount=(client,p)=>client.driveCount?client.driveCount(p):client.call('b2DriveCount',p);

const CSS=`.b2-drive{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;font-size:12px;line-height:1.3;min-width:0;color:#0f172a}
.b2-drive-k{font-weight:900;color:#334155}.b2-drive-day{color:#64748b;font-weight:700}
.b2-drive-a{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#1d4ed8;font-weight:800;text-decoration:none;white-space:nowrap}
.b2-drive-a:hover{background:#eff6ff;border-color:#93c5fd}.b2-drive-a:focus-visible,.b2-drive-ev:focus-visible{outline:2px solid #2456df;outline-offset:1px}
.b2-drive-a.off{color:#94a3b8;background:#f8fafc;border-style:dashed;cursor:default}
.b2-drive-lv{font-size:10px;font-weight:700;color:#64748b}
.b2-drive-n{font-size:10px;font-weight:800;padding:0 6px;border-radius:999px;background:#e0f2fe;color:#075985}.b2-drive-n:empty{display:none}.b2-drive-n.none{background:#fff7ed;color:#9a3412}.b2-drive-n.unknown{background:#f1f5f9;color:#64748b}
.b2-drive-sep{color:#64748b;font-weight:800;margin-left:4px}
.b2-drive-note{color:#64748b;font-size:11px}
.b2-drive-pick{display:inline-flex;align-items:center;gap:4px;color:#64748b;font-weight:700;margin-left:4px}
.b2-drive-pick input{font:inherit;font-size:12px;border:1px solid #cbd5e1;border-radius:8px;padding:2px 6px;background:#fff;color:#0f172a}
.b2-drive-reset{border:0;background:transparent;color:#1d4ed8;font:inherit;font-size:11px;font-weight:800;cursor:pointer;padding:2px 4px}
.b2-drive-ev{display:inline-block;margin-top:3px;font-size:11px;font-weight:800;color:#1d4ed8;text-decoration:none;white-space:nowrap}.b2-drive-ev:hover{text-decoration:underline}
.b2-drive-units summary{cursor:pointer}.b2-drive-units .b2-drive-units-top{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:10px 0}
.b2-drive-units ul{list-style:none;margin:0;padding:0;display:grid;gap:0}.b2-drive-units li{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;padding:7px 0;border-top:1px solid #e2e8f0}
.b2-drive-units li:first-child{border-top:0}.b2-drive-units li b{min-width:150px;font-size:13px}`;
function ensureDriveCss(){if(typeof document==='undefined'||document.querySelector('style[data-drive-css]'))return;const s=document.createElement('style');s.dataset.driveCss='1';s.textContent=CSS;document.head.append(s);}

const linkHtml=(l,count=null)=>l.url
 ?`<a class="b2-drive-a" data-drive-kind="${esc(l.kind)}" data-level="${esc(l.level)}" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.title)}">${esc(l.label)}${l.short?`<span class="b2-drive-lv">${esc(l.short)}</span>`:''}${count!==null?`<span class="b2-drive-n" data-drive-count="${esc(l.kind)}"></span>`:''}</a>`
 :`<span class="b2-drive-a off" data-drive-kind="${esc(l.kind)}" aria-disabled="true" title="${esc(l.title)}">${esc(l.label)}</span>`;

// 드라이브 바(반·날짜 하나): el을 화면 어디든 붙이고 set(반, 날짜)로 바꿉니다. 같은 반·날짜면 아무 일도 하지 않습니다.
// admin: 단위기간 폴더도 · picker: '다른 날짜 폴더' 날짜 칸(그 바만 다른 날로, 화면 날짜가 바뀌면 풀림) · onChange: 출결인정자료 링크가 바뀌면(evLinkHtml을 다시 그리게)
// countDelay: 그린 뒤 파일 수를 읽기까지 기다리는 시간(ms, 마우스를 올리거나 초점이 오면 바로)
export function createDriveBar({client,admin=false,picker=false,onChange=null,countDelay=1200}={}){
 ensureDriveCss();
 const el=document.createElement('div');el.className='b2-drive-host';
 let cls='',date='',pick='',data=null,err=null,loading=false,seq=0,disposed=false,counts=null,countKey='',countTimer=0,evMark='';
 const day=()=>pick||date,key=()=>`${cls}|${day()}`;
 const model=(d=day())=>data?driveLinks(data,{cls,date:d,admin}):null;
 function paint(){
  if(disposed)return;clearTimeout(countTimer);
  if(!cls){el.innerHTML='';return;}
  const m=model(),head=`<span class="b2-drive-k" title="${esc(m?.builtAt!==''&&m?`폴더 목록 ${whenText(m.builtAt)} 기준`:'구글 드라이브 폴더 바로가기')}">드라이브</span>${day()?`<span class="b2-drive-day">${esc(md(day()))}${pick?' · 다른 날짜':''}</span>`:''}`;
  let body='';
  if(loading&&!data)body='<span class="b2-drive-note">폴더 확인 중…</span>';
  else if(err&&!data)body=`<span class="b2-drive-note" data-drive-error title="${esc(err.message||'')}">${esc(failText(err))}</span>`;
  else if(!m||m.empty)body=`<span class="b2-drive-note" data-drive-wait>${NOT_BUILT}</span>`;
  else{
   body=m.links.map(l=>linkHtml(l,day()?'':null)).join('');
   if(admin)body+=m.unit?`<span class="b2-drive-sep">단위기간 ›</span>${m.unit.links.map(l=>linkHtml(l)).join('')}`:'<span class="b2-drive-sep">단위기간 ›</span><span class="b2-drive-note">이 날이 든 단위기간 폴더가 목록에 없습니다</span>';
   if(m.partial)body+=`<span class="b2-drive-note" data-drive-wait>${NOT_BUILT} · 일부만</span>`;
   if(admin&&m.builtAt!=='')body+=`<span class="b2-drive-note" data-drive-built>목록 ${esc(whenText(m.builtAt))}</span>`;
  }
  const pk=picker?`<label class="b2-drive-pick">다른 날짜 폴더<input type="date" data-drive-pick value="${esc(day())}" aria-label="다른 날짜 폴더 열기"></label>${pick?'<button type="button" class="b2-drive-reset" data-drive-reset>원래 날짜로</button>':''}`:'';
  el.innerHTML=`<div class="b2-drive" data-drive data-cls="${esc(cls)}" data-date="${esc(day())}">${head}${body}${pk}</div>`;
  const inp=el.querySelector('[data-drive-pick]');
  if(inp)inp.onchange=()=>{const v=inp.value;if(!isDay(v))return;pick=v===date?'':v;counts=null;countKey='';paint();};
  const rs=el.querySelector('[data-drive-reset]');if(rs)rs.onclick=()=>{pick='';counts=null;countKey='';paint();};
  paintCounts();
  if(m?.ready&&day()&&countKey!==key())countTimer=setTimeout(loadCounts,countDelay);
 }
 function paintCounts(){
  if(!counts||counts.key!==key())return;
  for(const s of el.querySelectorAll('[data-drive-count]')){
   const k=s.dataset.driveCount,n=counts.error?'?':counts.counts?.[k],t=counts.loading?'':countText(n,counts.max);
   s.textContent=t;s.className=`b2-drive-n${t==='없음'?' none':t==='?'?' unknown':''}`;
   s.title=counts.error?`파일 수를 읽지 못했습니다${counts.error.message?` · ${counts.error.message}`:''}`:n===null?'그날 폴더가 없습니다':n===undefined?'':`그날 폴더 파일 ${n}${+n>=counts.max?'개 이상':'개'}`;
  }
 }
 async function loadCounts(){
  clearTimeout(countTimer);
  const m=model(),k=key();if(disposed||!m?.ready||!day()||countKey===k)return;
  countKey=k;counts={key:k,loading:true};const c=cls,d=day();
  try{const r=await fetchCount(client,{cls:c,date:d,kinds:DATE_KINDS});if(disposed||countKey!==k)return;counts={key:k,counts:r?.counts||{},max:+r?.max||500};}
  catch(e){if(disposed||countKey!==k)return;counts={key:k,error:e};}
  paintCounts();
 }
 el.addEventListener('mouseenter',()=>void loadCounts());el.addEventListener('focusin',()=>void loadCounts());
 async function load(){
  const c=cls,n=++seq;loading=true;err=null;paint();
  try{const d=await fetchFolders(client,c);if(disposed||n!==seq)return;data=d&&typeof d==='object'?d:{};}
  catch(e){if(disposed||n!==seq)return;err=e;data=null;}
  loading=false;paint();changed();
 }
 // 출결인정자료 링크(화면 날짜 기준)가 바뀌면 알립니다.
 function changed(){const h=evLinkHtml();if(h===evMark)return;evMark=h;try{onChange?.();}catch(e){console.warn(e);}}
 function evLinkHtml(){
  const l=model(date)?.links.find(x=>x.kind==='evidence');if(!l?.url||!date)return '';
  return `<a class="b2-drive-ev" data-drive-ev href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.title)}">출결인정자료 폴더${l.short?` · ${esc(l.short)}`:''}</a>`;
 }
 return {
  el,
  set(c,d){
   c=String(c??'');d=isDay(d)?d:'';
   if(c===cls&&d===date)return;
   const moved=c!==cls;if(d!==date)pick='';cls=c;date=d;counts=null;countKey='';
   if(moved){data=null;if(c)void load();else paint();}else{paint();changed();}
  },
  state:()=>({cls,date,day:day(),ready:!!model()?.ready}),
  evLinkHtml,loadCounts,
  reload(){if(cls)void load();},
  dispose(){disposed=true;clearTimeout(countTimer);el.remove();}
 };
}

// 내려받기 › 단위기간 폴더 바로가기(관리자): 반을 고르면 단위마다 그 단위 폴더와 1·2·3 폴더. 펼칠 때 처음 읽습니다.
export function mountUnitFolders(host,{client,classes=[]}){
 ensureDriveCss();
 let cls=String(classes[0]?.id||'1'),seq=0,opened=false,disposed=false;
 host.innerHTML=`<details class="b2-card b2-pad b2-drive-units" data-drive-units style="margin-top:12px"><summary><b>단위기간 폴더 바로가기</b> <span class="b2-small b2-muted">반·단위마다 ${UNIT_KINDS.slice(1).map(k=>esc(KIND_LABEL[k])).join(' · ')} 폴더(구글 드라이브, 새 탭)</span></summary>
 <div class="b2-drive-units-top"><label class="b2-field">반<select data-drive-units-class>${classOptions(classes,cls)}</select></label></div><div data-drive-units-body></div></details>`;
 const box=host.querySelector('details'),body=host.querySelector('[data-drive-units-body]'),sel=host.querySelector('[data-drive-units-class]');
 function draw(data){
  const st=indexState(data),rows=st.rows;
  if(st.empty){body.innerHTML=`<div class="b2-drive-note" data-drive-wait>${NOT_BUILT}</div>`;return;}
  const units=[...new Set(rows.filter(r=>same(r.cls,cls)&&isUnit(r.unit)).map(r=>r.unit))].sort((a,b)=>unitNo(a)-unitNo(b));
  const item=u=>{const p=pickUnit(rows,{cls,unit:u}),per=UNIT_PERIODS.find(x=>x.no===unitNo(u));
   const link=k=>{const x=p.picks[k];return linkHtml(x?{kind:k,label:k==='unit'?'단위 폴더':KIND_LABEL[k],url:folderUrl(x.row.id),level:x.level,short:'',title:levelTitle(x,{cls,date:'',kind:k})}:{kind:k,label:k==='unit'?'단위 폴더':KIND_LABEL[k],url:'',title:`${KIND_LABEL[k]} 폴더가 목록에 없습니다`});};
   return `<li data-unit="${esc(u)}"><b>${esc(per?per.label:u)}</b>${UNIT_KINDS.map(link).join('')}</li>`;};
  body.innerHTML=(units.length?`<ul>${units.map(item).join('')}</ul>`:`<div class="b2-drive-note">${esc(cls)}반 단위기간 폴더가 목록에 없습니다</div>`)
   +(st.partial?`<div class="b2-drive-note" data-drive-wait>${NOT_BUILT} · 일부만</div>`:'')+(st.builtAt!==''?`<div class="b2-drive-note" data-drive-built>폴더 목록 ${esc(whenText(st.builtAt))} 기준</div>`:'');
 }
 async function load(){
  const n=++seq,c=cls;body.innerHTML='<div class="b2-drive-note">폴더 확인 중…</div>';
  try{const d=await fetchFolders(client,c);if(!disposed&&n===seq)draw(d);}
  catch(e){if(!disposed&&n===seq)body.innerHTML=`<div class="b2-drive-note" data-drive-error title="${esc(e?.message||'')}">${esc(failText(e))}</div>`;}
 }
 box.addEventListener('toggle',()=>{if(box.open&&!opened){opened=true;void load();}});
 sel.onchange=()=>{cls=sel.value;if(box.open)void load();else opened=false;};
 return {dispose(){disposed=true;}};
}
