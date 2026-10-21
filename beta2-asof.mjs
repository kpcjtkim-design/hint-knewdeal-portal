// 시험 기준일(운영 리허설, 2026-10-21, 시트 v23 b2Bundle(cls, {asOf})): 개강 전에 '오늘이 그날인 것처럼' 관리자 화면을 봅니다.
// - 관리자만. 이 브라우저 탭(sessionStorage)에만 남고, 저장한 관리자 이메일과 지금 로그인한 이메일이 같을 때만 씁니다.
// - beta2-data.mjs가 관리자 클라이언트(admin:true: 관리자 화면·관리자 담임 미리보기)의 b2Bundle에만 {asOf}를 붙입니다. 시트는 그대로이고 돌려주는 today만 바뀝니다.
// - 실제 담임 화면에는 쓰지 않습니다(담임 클라이언트는 admin:false, api/teacher-beta.js가 담임 요청의 asOf를 빼고, 시트도 담임이면 거절).
// - 켜져 있으면 모든 관리자 화면 위에 빨간 띠 '시험 기준일 … 적용 중 · 실제 오늘이 아닙니다 [끄기]'.
export const AS_OF_KEY='hint.b2.testAsOf';
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isAsOfDate=v=>DATE.test(String(v||''))&&new Date(String(v)+'T00:00:00Z').toISOString().slice(0,10)===String(v);
const listeners=new Set();
function store(){try{return globalThis.sessionStorage||null;}catch{return null;}}
// 지금 쓰는 시험 기준일('' = 꺼짐). user가 있으면 저장한 사람과 같은 이메일일 때만.
export function getTestAsOf(user=null){
 try{
  const raw=store()?.getItem(AS_OF_KEY);if(!raw)return '';
  const v=JSON.parse(raw),date=String(v?.date||''),email=String(v?.email||'').toLowerCase();
  if(!isAsOfDate(date))return '';
  if(user&&String(user.email||'').toLowerCase()!==email)return '';
  return date;
 }catch{return '';}
}
// 켜기(날짜)·끄기(''). 모양이 틀리면 Error. 바뀌면 듣는 쪽(beta2-data 묶음 캐시 비우기·띠 다시 그리기)에 알립니다.
export function setTestAsOf(user,date){
 const d=String(date||'').trim();
 if(d&&!isAsOfDate(d))throw Error('시험 기준일은 2026-12-10처럼 골라 주세요.');
 const before=getTestAsOf(user);
 try{const s=store();if(d)s?.setItem(AS_OF_KEY,JSON.stringify({date:d,email:String(user?.email||'').toLowerCase()}));else s?.removeItem(AS_OF_KEY);}catch{}
 if(before!==d)for(const fn of [...listeners]){try{fn(d);}catch(e){console.warn(e);}}
 return d;
}
export function onTestAsOf(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
export const asOfBannerText=date=>`시험 기준일 ${date} 적용 중 · 실제 오늘이 아닙니다`;
const escHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STYLE=`.b2-asof-banner{position:sticky;top:0;z-index:60;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 14px;background:#b91c1c;color:#fff;font-weight:800;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
.b2-asof-banner button{border:1px solid #fff;background:transparent;color:#fff;border-radius:6px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}
.b2-asof-ctl{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:#475569}.b2-asof-ctl input{border:1px solid #cbd5e1;border-radius:6px;padding:3px 6px;font:inherit}
.b2-asof-ctl button{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:3px 10px;font:inherit;cursor:pointer}.b2-asof-ctl .on{color:#b91c1c;font-weight:800}`;
function ensureStyle(doc){if(doc.querySelector('style[data-b2-asof]'))return;const s=doc.createElement('style');s.dataset.b2Asof='1';s.textContent=STYLE;doc.head.append(s);}
// 관리자 화면: 띠(document.body 맨 위, sticky)와 작은 설정 칸(slot: 관리자 머리 줄). onChange(date)는 켜고 끈 뒤(화면 다시 그리기).
// 관리자 화면을 다시 그릴 때마다 부르므로 앞의 것은 놓습니다(듣는 쪽이 쌓이지 않게).
let mounted=null;
export function mountAsOfControls({slot=null,user,onChange=null,doc=globalThis.document}={}){
 if(!doc)return {dispose(){}};
 mounted?.dispose();
 ensureStyle(doc);
 const paint=()=>{
  const date=getTestAsOf(user);
  let bar=doc.getElementById('b2AsOfBanner');
  if(date){
   if(!bar){bar=doc.createElement('div');bar.id='b2AsOfBanner';bar.className='b2-asof-banner';bar.setAttribute('role','alert');doc.body.prepend(bar);}
   bar.innerHTML=`<span data-asof-text>${escHtml(asOfBannerText(date))}</span><button type="button" data-asof-off>끄기</button>`;
   bar.querySelector('[data-asof-off]').onclick=()=>{setTestAsOf(user,'');onChange?.('');};
  }else bar?.remove();
  if(slot&&slot.isConnected!==false){
   slot.innerHTML=`<span class="b2-asof-ctl" data-asof-ctl><label>시험 기준일 <input type="date" data-asof-input value="${escHtml(date)}" aria-label="시험 기준일"></label><button type="button" data-asof-apply>적용</button>${date?`<span class="on">적용 중</span><button type="button" data-asof-clear>끄기</button>`:''}</span>`;
   slot.querySelector('[data-asof-apply]').onclick=()=>{const v=slot.querySelector('[data-asof-input]').value;try{setTestAsOf(user,v);onChange?.(getTestAsOf(user));}catch(e){alert(e.message);}};
   const c=slot.querySelector('[data-asof-clear]');if(c)c.onclick=()=>{setTestAsOf(user,'');onChange?.('');};
  }
 };
 const off=onTestAsOf(paint);paint();
 const self={paint,dispose(){off();if(mounted===self)mounted=null;}};
 mounted=self;return self;
}
// 로그아웃·담임 화면: 띠를 치웁니다(값은 지우지 않음. 다른 이메일이면 어차피 쓰지 않음).
export function removeAsOfBanner(doc=globalThis.document){mounted?.dispose();doc?.getElementById('b2AsOfBanner')?.remove();}
