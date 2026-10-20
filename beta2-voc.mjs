// 2기 베타 민원·이슈(2026-10-16 회의): 담임 접수·답글 ↔ 운영팀 처리함(처리 상태·답글).
// 마스터시트 민원이슈 탭에 함께 남고, 알림은 포털 화면으로만 합니다(beta2.gs b2Voc*, 메일 없음). teacherClass가 있으면 담임 화면, 없으면 처리함.
import {onBeta2Rev,lastBeta2Rev} from './beta2-data.mjs';
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {notify} from './notify.mjs';
import {linkFor} from './notify-core.mjs';

const STATE_CLASS={'접수':'t-rec','처리중':'t-late','완료':'e-ok','보류':'t-na','해당없음':'t-na'};
const TYPES=['수업·강사','시설·환경','출결','행정·서류','교육생 고충','안전','기타'];
export const vocOpen=r=>r.status!=='완료'&&r.status!=='해당없음';
// 운영팀이 답할 차례: 끝나지 않았고 마지막 글이 담임(예전 기록 포함)
export const vocWaiting=r=>vocOpen(r)&&r.lastBy!=='운영';
// 담임이 아직 보지 않은 운영팀 답글
export const vocUnseen=r=>r.lastBy==='운영'&&String(r.lastAt||'')>String(r.seen||'');
const when=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);return m?`${+m[2]}/${+m[3]}${m[4]?` ${m[4]}:${m[5]}`:''}`:'';};

export async function mount(host,{client,classes,selected,teacherClass=null,onState=null}){
 const life=lifecycle(host),admin=!teacherClass,side=admin?'운영':'담임';
 let data=null,filter=admin?'wait':'all',cls=teacherClass?String(teacherClass):'all',search='',openKey='',busy=false,err='',vocRev=null,creating=!admin;
 const form={cls:teacherClass?String(teacherClass):String(selected||'1'),type:'',detail:''},drafts={};
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>${admin?'민원·이슈 처리함':'민원·이슈'}</h2><p>${admin?'담임이 접수하거나 답글을 달면 여기와 홈, 화면 오른쪽 아래에 알림이 뜹니다. 답글과 처리 상태는 담임 화면과 마스터시트 민원이슈 탭에 그대로 남습니다.':'운영팀과 민원·이슈를 주고받습니다. 접수하거나 답글을 달면 운영팀에 바로 알림이 가고, 운영팀 답글과 처리 상태를 여기서 확인합니다.'}</p></div>${admin?'<button class="b2-btn" id="v2New">새로 접수</button>':''}</div><div id="v2Form"></div><section class="b2-card"><div class="b2-toolbar" id="v2Tools"></div><div id="v2List" style="padding:0 14px 14px">${loading()}</div></section></div>`;
 const $=s=>host.querySelector(s);
 const draft=key=>drafts[key]||(drafts[key]={text:'',status:'',err:''});
 const filters=admin?[['wait','답변 대기'],['open','진행 중'],['완료','완료'],['all','전체']]:[['all','전체'],['unseen','새 답글'],['open','진행 중'],['완료','완료']];
 const match=(r,k)=>k==='all'||(k==='wait'?vocWaiting(r):k==='open'?vocOpen(r):k==='unseen'?vocUnseen(r):r.status===k);
 function formHtml(){
  if(!creating)return '';
  const types=data?.types||TYPES;
  return `<section class="b2-card b2-pad" style="margin-bottom:14px"><h3 style="margin-bottom:12px">${admin?'운영팀이 대신 접수':'새 민원·이슈 접수'}</h3><div class="b2-form">
   ${admin?`<label class="b2-field">반<select data-f="cls">${classOptions(classes,form.cls)}</select></label>`:''}
   <div class="b2-field ${admin?'':'wide'}">유형<div class="b2-chips" style="margin-top:4px">${types.map(t=>`<button class="b2-chip" data-type="${esc(t)}" aria-pressed="${form.type===t}">${esc(t)}</button>`).join('')}</div></div>
   <label class="b2-field wide">내용<textarea data-f="detail" maxlength="2000" rows="4" placeholder="무슨 일인지, 관련된 사람, 지금까지 한 조치를 적어 주세요">${esc(form.detail)}</textarea></label>
  </div><div class="b2-chips" style="margin-top:12px;align-items:center"><span class="b2-err">${esc(err)}</span><span class="b2-grow"></span>${admin?'<button class="b2-btn" data-cancel>닫기</button>':''}<button class="b2-btn primary" data-create ${busy?'disabled':''}>${busy?'접수 중…':'접수하기'}</button></div></section>`;
 }
 function thread(r){
  const msgs=[{side:'담임',who:r.author,at:r.date,text:r.detail},...r.thread];
  // 예전 기록(주고받기 전): 조치내용만 있으면 운영팀 답글처럼 보여 줍니다.
  if(!r.thread.length&&r.action)msgs.push({side:'운영',who:'',at:r.done||'',text:r.action});
  return `<div class="b2-voc-thread">${msgs.map(m=>`<div class="b2-msg ${m.side===side?'mine':''} ${m.side==='운영'?'ops':''}"><div class="b2-msg-head"><b>${esc(m.side==='운영'?'운영팀':m.side||'기록')}</b>${m.who?` · ${esc(m.who)}`:''}<span>${esc(when(m.at))}</span></div><div class="b2-msg-text">${esc(m.text)}</div></div>`).join('')}</div>`;
 }
 function editor(r){
  const d=draft(r.key),statuses=data.statuses||['접수','처리중','완료','보류'];
  return `<div class="b2-editor"><label class="b2-field">답글<textarea data-reply rows="3" maxlength="2000" placeholder="${admin?'담임에게 보낼 답글·조치 내용':'운영팀에 보낼 답글'}">${esc(d.text)}</textarea></label>
   <div class="row"><div class="b2-chips">${statuses.map(s=>`<button class="b2-chip" data-status="${esc(s)}" aria-pressed="${(d.status||r.status)===s}">${esc(s)}</button>`).join('')}</div><span class="b2-grow"></span><span class="b2-err">${esc(d.err)}</span><button class="b2-btn primary" data-send ${busy?'disabled':''}>${busy?'보내는 중…':'보내기'}</button></div>
   <p class="b2-tiny b2-muted" style="margin:0">처리 상태만 바꿔도 보낼 수 있습니다. ${admin?'답글은 담임 화면에 바로 보이고 마스터시트 조치내용에도 남습니다.':'답글을 보내면 운영팀 화면에 알림이 뜹니다.'}</p></div>`;
 }
 function card(r){
  const open=openKey===r.key,last=r.thread.at(-1);
  const flag=admin?(vocWaiting(r)?'<span class="b2-badge t-absent">답변 대기</span>':''):(vocUnseen(r)?'<span class="b2-badge t-absent">운영팀 답글</span>':'');
  const recent=last?`${last.side==='운영'?'운영팀':last.side||'기록'} ${when(last.at)}`:`접수 ${when(r.lastAt||r.date)}`;
  const age=vocOpen(r)&&r.days!==''?` · ${esc(r.days)}일째`:'';
  // 머리 줄만 펼치기 버튼입니다(펼친 카드 안에 답글 칸·버튼이 있어 카드 전체를 버튼으로 두지 않음).
  return `<div class="b2-card b2-voc ${open?'open':''}" data-voc="${esc(r.key)}">
   <div class="b2-voc-top" data-voc-toggle role="button" tabindex="0" aria-expanded="${open}"><span class="b2-badge ${STATE_CLASS[r.status]||''}">${esc(r.status)}</span>${flag}<b>${esc(r.cls)}반 · ${esc(r.type||'민원')}</b><span class="b2-muted b2-small">${esc(r.id||'예전 기록')} · ${esc(md(r.date))}${age}</span><span class="b2-grow"></span><span class="b2-muted b2-small">최근 ${esc(recent)}</span></div>
   ${open?`<div data-voc-body>${thread(r)}${editor(r)}</div>`:`<div class="b2-voc-preview">${esc(String(r.detail||'').slice(0,160))}</div>`}
  </div>`;
 }
 function render(){
  if(!life.alive())return;
  $('#v2Form').innerHTML=formHtml();
  if(!data)return;
  const mine=data.rows.filter(r=>cls==='all'||r.cls===cls),list=mine.filter(r=>match(r,filter)&&(!search||`${r.id} ${r.type} ${r.detail} ${r.action}`.includes(search)));
  $('#v2Tools').innerHTML=`<div class="b2-chips">${filters.map(([k,l])=>`<button class="b2-chip" data-filter="${esc(k)}" aria-pressed="${filter===k}">${esc(l)}<span class="n">${mine.filter(r=>match(r,k)).length}</span></button>`).join('')}</div><span class="b2-grow"></span>${admin?`<label class="b2-field">반<select id="v2Class">${classOptions(classes,cls,{all:true})}</select></label>`:''}<label class="b2-field">찾기<input id="v2Search" value="${esc(search)}" placeholder="번호·유형·내용"></label><button class="b2-btn" id="v2Reload">새로고침</button>`;
  $('#v2List').innerHTML=list.length?`<div class="b2-docs">${list.map(card).join('')}</div>`:`<div class="b2-muted b2-pad">${filter==='wait'?'답변을 기다리는 민원·이슈가 없습니다.':'해당하는 민원·이슈가 없습니다.'}</div>`;
 }
 async function load(){
  try{data=await client.vocs(teacherClass?{cls:teacherClass}:{});if(data.state){vocRev=data.state.rev;onState?.(data.state);}render();}
  catch(e){if(life.alive())$('#v2List').innerHTML=errorBox(e);}
 }
 const took=state=>{if(state){vocRev=state.rev;onState?.(state);}};
 // 포털 알림(notify.mjs, 사용자 요청 2026-10-19): 담임이 쓰면 운영 관리자에게, 운영팀이 쓰면 그 반 담임(접수한 담임 계정도)에게. 못 남겨도 글은 그대로(작은 안내만).
 const tell=({cls,id,title,body,author=''})=>void notify('민원',{...(admin?{audience:'class',to:/@/.test(author)?[author]:[]}:{audience:'admins'}),cls,title,body,link:linkFor('b2vocs',{cls,id})});
 async function create(){
  err='';
  if(!form.type)err='유형을 골라 주세요.';else if(!form.detail.trim())err='내용을 적어 주세요.';
  if(err)return render();
  busy=true;render();
  try{
   const res=await client.vocCreate({cls:form.cls,type:form.type,detail:form.detail.trim(),side});
   toast(`접수했습니다 · ${res.id}`);
   tell({cls:form.cls,id:res.id,title:`민원·이슈 접수 · ${form.cls}반 ${form.type}`,body:form.detail});
   form.type='';form.detail='';creating=!admin;busy=false;openKey=res.id;took(res.state);await load();
  }catch(e){busy=false;err=e.message;render();}
 }
 async function send(r){
  const d=draft(r.key),text=d.text.trim(),status=d.status&&d.status!==r.status?d.status:'';
  if(!text&&!status){d.err='답글을 적거나 처리 상태를 고르세요.';render();return;}
  busy=true;d.err='';render();
  try{
   const res=await client.vocReply({key:r.key,sig:r.sig,cls:r.cls,text,status,side});
   delete drafts[r.key];busy=false;if(res.id&&res.id!==r.key)openKey=res.id; // 예전 기록은 이때 번호가 생깁니다
   toast(res.unchanged?'바뀐 것이 없습니다.':'보냈습니다');took(res.state);
   if(!res.unchanged)tell({cls:r.cls,id:res.id||r.key,title:`민원·이슈 ${text?'답글':'처리 상태'} · ${r.cls}반 ${r.type||''}`,body:[status?`[처리 상태 ${status}]`:'',text].filter(Boolean).join(' '),author:r.author});
   await load();
  }catch(e){busy=false;d.err=e.message;render();}
 }
 async function seen(r){
  try{const res=await client.vocSeen({key:r.key,sig:r.sig,cls:r.cls,side:'담임'});r.seen=r.lastAt;took(res.state);if(life.alive())render();}catch{}
 }
 host.addEventListener('input',e=>{
  const t=e.target,f=t.dataset?.f;
  if(f){form[f]=t.value;if(f==='cls')render();return;}
  if(t.hasAttribute?.('data-reply')&&openKey){draft(openKey).text=t.value;return;}
  if(t.id==='v2Search'){search=t.value.trim();const at=t.selectionStart;render();const el=$('#v2Search');el.focus();el.setSelectionRange(at,at);}
 });
 host.addEventListener('change',e=>{if(e.target.id==='v2Class'){cls=e.target.value;render();}});
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');
  if(b?.dataset.filter){filter=b.dataset.filter;render();return;}
  if(b?.dataset.type){form.type=b.dataset.type;render();return;}
  if(b?.hasAttribute('data-create')){await create();return;}
  if(b?.hasAttribute('data-cancel')){creating=false;err='';render();return;}
  if(b?.id==='v2New'){creating=true;err='';render();return;}
  if(b?.id==='v2Reload'){void load();return;}
  const r=openKey&&data?.rows.find(x=>x.key===openKey);
  if(b?.dataset.status&&r){draft(r.key).status=b.dataset.status===r.status?'':b.dataset.status;render();return;}
  if(b?.hasAttribute('data-send')&&r){await send(r);return;}
  if(e.target.closest('[data-voc-body],a,input,textarea,select'))return;
  const c=e.target.closest('[data-voc]');if(!c)return;
  openKey=openKey===c.dataset.voc?'':c.dataset.voc;render();
  const x=data?.rows.find(y=>y.key===openKey);if(x&&!admin&&vocUnseen(x))void seen(x);
 });
 host.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-voc-toggle]')){e.preventDefault();e.target.click();}});
 // 새 글: 어느 화면이든 변경 번호를 확인하면(b2Rev의 voc.rev) 목록을 다시 읽습니다. 30초 안에 다른 화면이 확인했으면 따로 묻지 않습니다.
 life.on(onBeta2Rev(r=>{const v=r?.voc;if(v&&vocRev!==null&&v.rev!==vocRev&&!busy){vocRev=v.rev;void load();}}));
 const timer=setInterval(()=>{if(document.hidden||busy||!life.alive())return;if(Date.now()-lastBeta2Rev().at<25000)return;client.rev().catch(()=>{});},30000);
 life.on(()=>clearInterval(timer));
 render();await load();
 const typing=()=>Object.values(drafts).some(d=>d.text.trim())||(creating&&form.detail.trim());
 return {dispose:()=>life.dispose(),canLeave:()=>!typing()||confirm('보내지 않은 민원·이슈 글이 있습니다. 화면을 떠날까요?')};
}
