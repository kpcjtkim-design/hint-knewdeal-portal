// 알림함(사용자 요청 2026-10-19, 관리자·담임 모두): 머리글 종(안 읽은 건수)과 '알림' 화면. 자료는 notify.mjs 실시간 저장소(index.html이 로그인 때 시작)에서 받습니다.
// 관리자는 홈 › 알림 탭(beta2-admin.mjs b2notify), 담임은 담임 화면의 알림 칸(beta2-teacher-layout.mjs)에 같은 화면을 띄웁니다. 누르면 읽음으로 바꾸고 그 화면으로 갑니다.
import {inbox} from './notify.mjs';
import {KINDS,parseLink,whenText,createdMs,pickNotifications,teacherTarget} from './notify-core.mjs';
import {esc,toast,ensureBeta2Css} from './beta2-ui.mjs';
export {startInbox,stopInbox,notify} from './notify.mjs';
export {teacherTarget};

export function ensureNotifyCss(){
 if(document.querySelector('link[data-notify-css]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/notify.css?v=20261019-n1';link.dataset.notifyCss='1';document.head.append(link);
}
const BELL='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
// 머리글 종: 안 읽은 건수(99 넘으면 99+). 머리글을 다시 그리면 새 종을 붙이고, 떨어진 옛 종은 다음 알림 때 구독을 끊습니다.
export function mountBell(slot,{onOpen=null}={}){
 const s=inbox();slot.textContent='';if(!s)return ()=>{};
 ensureNotifyCss();
 const b=document.createElement('button');b.type='button';b.className='btn hint-bell';b.innerHTML=`${BELL}<span class="hint-bell-label">알림</span><span class="n" hidden></span>`;b.onclick=()=>onOpen?.();slot.append(b);
 let off=null;
 const paint=()=>{const n=s.unread(),c=b.querySelector('.n'),text=n?`알림 · 안 읽음 ${n}건`:'알림 · 안 읽은 알림 없음';c.hidden=!n;c.textContent=n>99?'99+':String(n);b.setAttribute('aria-label',text);b.title=s.error?`${text} · 불러오기 오류: ${s.error}`:text;b.classList.toggle('has',!!n);};
 off=s.subscribe(()=>{if(!b.isConnected){off?.();return;}paint();});
 return ()=>off?.();
}
const KIND_CLASS={'서류발급':'k-doc','민원':'k-voc','출결대조 메모':'k-memo'};
// 알림 화면. open(tab,ctx): 관리자 화면 이동, onGo(link): 담임 화면처럼 따로 옮길 때(있으면 이것을 씁니다).
export async function mount(host,{open=null,onGo=null}={}){
 ensureBeta2Css();ensureNotifyCss();
 let filter='all',kind='',off=null,disposed=false,busy=false;
 host.innerHTML=`<div class="b2 hint-inbox"><div class="b2-head"><div><h2>알림</h2><p>서류발급 신청, 민원·이슈 글, 출결대조 메모가 생기면 여기에 모입니다. 최근 100건까지 보이고, 누르면 읽음으로 바뀌고 그 화면으로 갑니다.</p></div><button class="b2-btn" data-all-read disabled>모두 읽음</button></div><section class="b2-card"><div class="b2-toolbar" data-tools></div><div data-list style="padding:0 14px 14px"><div class="b2-muted b2-pad">알림을 불러오는 중…</div></div></section></div>`;
 const $=q=>host.querySelector(q),s=inbox();
 if(!s){$('[data-list]').innerHTML='<div class="b2-note err">알림을 불러오지 못했습니다. 다시 로그인해 주세요.</div>';return {dispose(){}};}
 const me=s.email;
 function item(n){
  const unread=s.isUnread(n),when=whenText(createdMs(n)),who=n.from===me?'내가 보냄':n.from||'';
  return `<article class="b2-card hint-note ${unread?'unread':''}" data-note="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(`${unread?'안 읽음 · ':''}${n.kind} · ${n.title}`)}"><span class="dot" aria-hidden="true"></span><div><div class="hint-note-head"><span class="b2-badge ${KIND_CLASS[n.kind]||''}">${esc(n.kind)}</span><b>${esc(n.title)}</b></div>${n.body?`<div class="hint-note-body">${esc(n.body)}</div>`:''}<div class="b2-sub">${[n.cls?`${esc(n.cls)}반`:'',esc(when),esc(who)].filter(Boolean).join(' · ')}</div></div>${unread?`<button class="b2-btn small" data-read="${esc(n.id)}">읽음</button>`:'<span></span>'}</article>`;
 }
 function render(){
  if(disposed||!host.isConnected)return;
  const all=s.list,unread=all.filter(s.isUnread),kinds=[...new Set([...KINDS,...all.map(n=>n.kind).filter(Boolean)])];
  $('[data-all-read]').disabled=busy||!unread.length;
  $('[data-tools]').innerHTML=`<div class="b2-chips">${[['all','전체',all.length],['unread','안 읽음',unread.length]].map(([k,l,n])=>`<button class="b2-chip" data-filter="${k}" aria-pressed="${filter===k}">${l}<span class="n">${n}</span></button>`).join('')}</div><label class="b2-field">종류<select data-kind><option value="">전체 종류</option>${kinds.map(k=>`<option value="${esc(k)}" ${k===kind?'selected':''}>${esc(k)}</option>`).join('')}</select></label><span class="b2-grow"></span>${s.error?`<span class="b2-err">${esc('알림을 다 불러오지 못했습니다: '+s.error)}</span>`:''}`;
  const list=pickNotifications(all,{filter,kind},s.isUnread);
  $('[data-list]').innerHTML=!s.ready?'<div class="b2-muted b2-pad">알림을 불러오는 중…</div>':list.length?`<div class="hint-notes">${list.map(item).join('')}</div>`:`<div class="b2-muted b2-pad">${filter==='unread'?'안 읽은 알림이 없습니다.':'알림이 없습니다.'}</div>`;
 }
 const read=async ids=>{try{return await s.markRead(ids);}catch(e){toast('읽음으로 바꾸지 못했습니다: '+(e?.message||e));return 0;}};
 function go(n){
  void read(n.id);const l=parseLink(n.link);if(!l)return;
  if(onGo)onGo(l);else open?.(l.tab,{classId:l.params.cls||undefined,date:l.params.date||undefined});
 }
 host.addEventListener('change',e=>{if(e.target.matches?.('[data-kind]')){kind=e.target.value;render();}});
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');
  if(b?.dataset.filter){filter=b.dataset.filter;render();return;}
  if(b?.dataset.read){await read(b.dataset.read);return;}
  if(b?.hasAttribute('data-all-read')){busy=true;render();const n=await read(s.list.filter(s.isUnread).map(x=>x.id));busy=false;if(n)toast(`${n}건을 읽음으로 바꿨습니다.`);render();return;}
  const card=e.target.closest('[data-note]');if(!card||b)return;
  const n=s.list.find(x=>x.id===card.dataset.note);if(n)go(n);
 });
 host.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-note]')){e.preventDefault();const n=s.list.find(x=>x.id===e.target.dataset.note);if(n)go(n);}});
 off=s.subscribe(render);
 // '3분 전' 같은 시간 글은 1분마다 다시 씁니다.
 const timer=setInterval(()=>{if(!host.isConnected){clearInterval(timer);return;}render();},60000);
 return {dispose(){disposed=true;off?.();clearInterval(timer);}};
}
