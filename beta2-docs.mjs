// 2기 서류발급: 담임 신청 → 마스터시트 '서류발급' 탭 → 관리자 처리. 기재 기간은 2기 교육 기간(cohort.json) 안에서 고릅니다.
import {rosterFor} from './beta2-core.mjs';
// 서류 종류(사용자 결정 2026-10-20): 네 가지 중 여러 개를 한 번에 고릅니다. 시트에는 ' · '로 이어 한 칸(docType)에 적습니다.
// 받는 방법은 카카오톡 개별 전송 하나뿐입니다(국취제 등 다른 방법이 없음, 사용자 2026-10-20).
export const DELIVERY='카카오톡 개별 전송';
export const DOC_KINDS=['교육참여확인서','체크히어 출석부','수기 출석부','기타 양식'],OTHER_KIND='기타 양식';
export const docTypeText=(kinds,other='')=>DOC_KINDS.filter(k=>kinds.includes(k)).map(k=>k===OTHER_KIND?`${k}(${String(other).trim()})`:k).join(' · ');
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {notify} from './notify.mjs';
import {linkFor} from './notify-core.mjs';
import {newClientId,isConflict} from './beta2-data.mjs';
// 리허설 안전장치(시트 v23, 2026-10-21): 새 신청은 clientId(신청 칸을 열 때 하나, 성공하면 새로)를 붙여 두 번 눌러도·다시 보내도 한 건만(repeated:true도 성공).
// 처리 저장은 화면이 본 값 was{status,memo,link,fixReason}을 함께 보내고, 그사이 다른 운영자가 처리했으면(CONFLICT) 새로 읽어 새 값을 보이고 내 입력은 남겨 다시 저장하게 합니다.
export const docWas=d=>({status:String(d?.status??''),memo:String(d?.memo??''),link:String(d?.link??''),fixReason:String(d?.fixReason??'')});

const STATE_CLASS={'접수':'t-rec','처리중':'t-late','보완 필요':'t-absent','처리완료':'e-ok','취소':'t-na'};
const OPEN=['접수','처리중','보완 필요'];
const dday=(due,today)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(due||''))return '';const n=Math.round((Date.parse(due)-Date.parse(today))/864e5);return n<0?`${-n}일 지남`:n===0?'오늘 마감':`D-${n}`;};
const koreaToday=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,10);

// context.classFilter(반 현황 beta2-class.mjs의 링크, 2026-10-20): 관리자 목록을 context.classId 반으로 거른 채 엽니다(알림으로 열 때는 전처럼 전체 반).
export async function mount(host,{client,classes,selected,context,teacherClass=null}){
 const life=lifecycle(host),admin=!teacherClass;
 let data=null,bundle=null,filter=admin?'open':'all',cls=teacherClass?String(teacherClass):context?.classFilter&&context?.classId?String(context.classId):'all',search='',openId='',creating=!admin,form=null,busy=false,err='';
 const today=koreaToday();
 const blank=()=>({clientId:newClientId(),cls:teacherClass?String(teacherClass):String(selected||'1'),name:'',docTypes:[],docOther:'',qty:1,from:'',to:'',purpose:'',submitTo:'',due:'',delivery:DELIVERY,memo:''});
 form=blank();
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>${admin?'서류발급 신청함':'서류발급 신청'}</h2><p>${admin?'신청이 들어오면 포털 알림함으로 바로 알림이 갑니다(메일은 보내지 않음, 사용자 결정 2026-10-20). 처리 상황을 바꾸면 담임 화면과 마스터시트 서류발급 탭에 그대로 보입니다.':'교육생 서류가 필요하면 여기서 신청해 주세요. 신청 즉시 운영팀 알림함에 알림이 가고, 처리 상황을 이 화면에서 확인할 수 있습니다.'}</p></div>${admin?'<button class="b2-btn primary" id="d2New">새 신청 작성</button>':''}</div><div id="d2Form"></div><section class="b2-card"><div class="b2-toolbar" id="d2Tools"></div><div id="d2List" style="padding:0 14px 14px">${loading()}</div></section></div>`;
 const $=s=>host.querySelector(s);
 const roster=()=>bundle?rosterFor(bundle,form.cls).filter(p=>!p.status||p.status==='재학'||p.changed>today):[];
 function formHtml(){
  if(!creating)return '';
  const types=DOC_KINDS;
  return `<section class="b2-card b2-pad" style="margin-bottom:14px"><h3 style="margin-bottom:12px">새 서류발급 신청</h3><div class="b2-form">
   ${admin?`<label class="b2-field">반<select data-g="cls">${classOptions(classes,form.cls)}</select></label>`:''}
   <label class="b2-field ${admin?'':'wide'}">교육생<select data-g="name"><option value="">교육생 선택</option>${roster().map(p=>`<option ${p.name===form.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
   <div class="b2-field wide">서류 종류 (여러 개 고를 수 있음)<div class="b2-chips" style="margin-top:4px">${types.map(t=>`<button class="b2-chip" data-doctype="${esc(t)}" aria-pressed="${form.docTypes.includes(t)}">${esc(t)}</button>`).join('')}</div>${form.docTypes.includes(OTHER_KIND)?`<input data-g="docOther" placeholder="기타 양식 이름(예: 국취 출석 확인 양식)" maxlength="60" value="${esc(form.docOther)}" style="margin-top:6px">`:''}</div>
   <label class="b2-field">기재할 기간 · 시작<input type="date" data-g="from" value="${esc(form.from)}" ></label>
   <label class="b2-field">기재할 기간 · 끝<input type="date" data-g="to" value="${esc(form.to)}"></label>
   <label class="b2-field">제출처 (필수)<input data-g="submitTo" maxlength="100" placeholder="예: 국민취업지원제도 운영기관" value="${esc(form.submitTo)}"></label>
   <label class="b2-field">제출 마감일<input type="date" data-g="due" value="${esc(form.due)}"></label>
   <label class="b2-field">발급 목적<input data-g="purpose" maxlength="100" placeholder="예: 국취제 출석 확인" value="${esc(form.purpose)}"></label>
   <label class="b2-field">수량<input type="number" data-g="qty" min="1" max="10" value="${esc(form.qty)}"></label>
   <div class="b2-field">받는 방법<span style="font-size:13px;font-weight:700;color:var(--b2-ink);padding:8px 0">${esc(DELIVERY)}</span></div>
   <label class="b2-field wide">전달 사항<textarea data-g="memo" maxlength="300" placeholder="예: 생년월일이 서류에 들어가야 합니다">${esc(form.memo)}</textarea></label>
  </div><div class="b2-chips" style="margin-top:12px;align-items:center"><span class="b2-err">${esc(err)}</span><span class="b2-grow"></span>${admin?'<button class="b2-btn" data-cancel>닫기</button>':''}<button class="b2-btn primary" data-submit ${busy?'disabled':''}>${busy?'신청 중…':'신청하기'}</button></div>
  <p class="b2-tiny b2-muted" style="margin:8px 0 0">교육생 생년월일은 마스터시트에 보관된 값으로 운영팀만 확인합니다. 화면에 따로 입력하지 않아도 됩니다.</p></section>`;
 }
 function detailHtml(d){
  if(!admin)return d.fixReason&&d.status==='보완 필요'?`<div class="b2-note warn" style="grid-column:1/-1">보완 요청: ${esc(d.fixReason)}</div>`:'';
  return `<div class="b2-editor" style="grid-column:1/-1" data-doc-edit="${esc(d.id)}"><div class="b2-chips">${(data.statuses||OPEN).map(s=>`<button class="b2-chip" data-status="${esc(s)}" aria-pressed="${(d._status||d.status)===s}">${esc(s)}</button>`).join('')}</div>
   <div class="row"><label class="b2-field b2-grow">발급본 링크<input data-u="link" placeholder="https://drive.google.com/…" value="${esc(d._link??d.link)}"></label><label class="b2-field b2-grow">비고<input data-u="memo" maxlength="300" value="${esc(d._memo??d.memo)}"></label></div>
   ${(d._status||d.status)==='보완 필요'?`<div class="row"><label class="b2-field b2-grow">보완 사유 (담임에게 보임)<input data-u="fixReason" maxlength="300" value="${esc(d._fix??d.fixReason)}"></label></div>`:''}
   <div class="row"><span class="b2-muted b2-small">${d.handler?`최근 처리 ${esc(d.handler)} · ${esc(d.handledAt)}`:'아직 처리 기록 없음'}${d.birth?` · 생년월일 ${esc(d.birth)}`:''}</span><span class="b2-grow"></span><span class="b2-err">${esc(d._err||'')}</span><button class="b2-btn primary" data-update ${busy?'disabled':''}>처리 저장</button></div></div>`;
 }
 function render(){
  if(!life.alive())return;
  $('#d2Form').innerHTML=formHtml();
  if(!data){return;}
  const rows=data.rows.filter(d=>(filter==='all'||(filter==='open'?OPEN.includes(d.status):d.status===filter))&&(cls==='all'||String(d.cls).replace(/반.*$/,'')===cls)&&(!search||`${d.name} ${d.docType} ${d.submitTo} ${d.id}`.includes(search)));
  const count=s=>data.rows.filter(d=>s==='open'?OPEN.includes(d.status):d.status===s).length;
  $('#d2Tools').innerHTML=`<div class="b2-chips">${[['open','진행 중'],...(data.statuses||[]).map(s=>[s,s]),['all','전체']].map(([k,l])=>`<button class="b2-chip" data-filter="${esc(k)}" aria-pressed="${filter===k}">${esc(l)}<span class="n">${k==='all'?data.rows.length:count(k)}</span></button>`).join('')}</div><span class="b2-grow"></span>${admin?`<label class="b2-field">반<select id="d2Class">${classOptions(classes,cls,{all:true})}</select></label>`:''}<label class="b2-field">찾기<input id="d2Search" value="${esc(search)}" placeholder="이름·서류·제출처"></label><button class="b2-btn" id="d2Reload">새로고침</button>`;
  $('#d2List').innerHTML=rows.length?`<div class="b2-docs">${rows.map(d=>{const due=dday(d.due,today),soon=OPEN.includes(d.status)&&/지남|오늘|D-[0-2]$/.test(due);return `<div class="b2-card b2-doc ${openId===d.id?'open':''}" data-doc="${esc(d.id)}" role="button" tabindex="0"><div><span class="b2-badge ${STATE_CLASS[d.status]||''}">${esc(d.status||'접수')}</span><span class="b2-sub">${esc(d.id)}</span><span class="b2-sub">${esc(d.requested?md(d.requested):'')}</span></div><div><b>${esc(d.cls)} · ${esc(d.name)}</b> · ${esc(d.docType||'서류')}${d.qty?` ${esc(d.qty)}부`:''}<span class="b2-sub">${esc(d.detail||'')}${d.submitTo?` · 제출처 ${esc(d.submitTo)}`:''}${d.delivery?` · ${esc(d.delivery)}`:''}</span>${d.memo?`<span class="b2-sub">비고: ${esc(d.memo)}</span>`:''}${d.link?`<span class="b2-sub"><a href="${esc(d.link)}" target="_blank" rel="noopener">발급본 열기 ↗</a></span>`:''}</div><div style="text-align:right">${d.due?`<span class="b2-due ${soon?'soon':''}">${esc(due)}</span><span class="b2-sub">마감 ${esc(md(d.due))}</span>`:''}<span class="b2-sub">${esc(d.requester||'')}</span></div>${openId===d.id?detailHtml(d):''}</div>`;}).join('')}</div>`:'<div class="b2-muted b2-pad">해당하는 신청이 없습니다.</div>';
  if($('#d2Class'))$('#d2Class').onchange=e=>{cls=e.target.value;render();};
  $('#d2Search').oninput=e=>{search=e.target.value.trim();const at=e.target.selectionStart;render();const el=$('#d2Search');el.focus();el.setSelectionRange(at,at);};
  $('#d2Reload').onclick=()=>void load();
 }
 async function load(){
  try{[data,bundle]=await Promise.all([client.docs(teacherClass?{cls:teacherClass}:{}),bundle||client.bundle(teacherClass?String(teacherClass):'all')]);render();}
  catch(e){if(life.alive())$('#d2List').innerHTML=errorBox(e);}
 }
 async function submit(){
  err='';const type=docTypeText(form.docTypes,form.docOther);
  if(!form.name)err='교육생을 골라 주세요.';else if(!form.docTypes.length)err='서류 종류를 하나 이상 골라 주세요.';else if(form.docTypes.includes(OTHER_KIND)&&!form.docOther.trim())err='기타 양식 이름을 적어 주세요.';else if(!form.submitTo.trim())err='제출처를 적어 주세요.';else if(form.from&&form.to&&form.to<form.from)err='기재할 기간의 끝이 시작보다 빠릅니다.';
  if(err)return render();
  busy=true;render();
  try{
   const res=await client.docCreate({clientId:form.clientId,cls:form.cls,name:form.name,docType:type,qty:form.qty,period:form.from||form.to?`${form.from||'?'} ~ ${form.to||'?'}`:'',purpose:form.purpose.trim(),submitTo:form.submitTo.trim(),due:form.due,delivery:form.delivery,memo:form.memo.trim()});
   if(res?.repeated){toast(`이미 접수된 신청입니다 · ${res.id}`);form=blank();creating=!admin;busy=false;await load();return;} // 같은 clientId를 시트가 이미 받음(다시 보냄·두 번 누름): 알림은 처음 한 번만
   toast(`신청했습니다 · ${res.id} · 운영팀 알림함에 알렸습니다`);
   // 포털 알림(notify.mjs): 운영 관리자 알림함에 한 건. 못 남겨도 신청은 그대로(작은 안내만).
   void notify('서류발급',{audience:'admins',cls:form.cls,title:`서류발급 신청 · ${form.cls}반 ${form.name}`,body:[`${type} ${form.qty||1}부`,`제출처 ${form.submitTo.trim()}`,form.due?`마감 ${md(form.due)}`:''].filter(Boolean).join(' · '),link:linkFor('b2docs',{cls:form.cls,id:res.id})});
   form=blank();creating=!admin;busy=false;await load();
  }catch(e){busy=false;err=e.message;render();}
 }
 host.addEventListener('input',e=>{const g=e.target.dataset?.g,u=e.target.dataset?.u;if(g){form[g]=e.target.value;if(g==='cls'){form.name='';render();}}if(u){const d=data.rows.find(x=>x.id===openId);if(d)d[{link:'_link',memo:'_memo',fixReason:'_fix'}[u]]=e.target.value;}});
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');
  if(b?.dataset.filter){filter=b.dataset.filter;render();return;}
  if(b?.dataset.doctype){const t=b.dataset.doctype;form.docTypes=form.docTypes.includes(t)?form.docTypes.filter(x=>x!==t):DOC_KINDS.filter(x=>x===t||form.docTypes.includes(x));render();return;}
  if(b?.hasAttribute('data-submit')){await submit();return;}
  if(b?.hasAttribute('data-cancel')){creating=false;render();return;}
  if(b?.id==='d2New'){creating=true;form=blank();err='';render();return;}
  const d=openId&&data?.rows.find(x=>x.id===openId);
  if(b?.dataset.status&&d){d._status=b.dataset.status;render();return;}
  if(b?.hasAttribute('data-update')&&d){
   busy=true;d._err='';render();
   const mine={_status:d._status||d.status,_memo:d._memo??d.memo,_link:(d._link??d.link)||'',_fix:d._fix??d.fixReason};
   try{
    await client.docUpdate({id:d.id,status:mine._status,memo:mine._memo,link:mine._link,fixReason:mine._fix,was:docWas(d)});
    // 상태가 바뀌면(처리중·보완 필요·처리완료·취소) 그 반 담임 알림함에 한 건(사용자 2026-10-23 "접수되는 대로 처리되고 알람오는 과정"). 못 남겨도 저장은 그대로.
    const moved=mine._status!==(d.status||'접수');
    const clsId=String(d.cls??'').replace(/반.*$/,'').trim(); // 시트 반 칸은 '17반(담임)' 꼴
    if(moved)void notify('서류발급',{audience:'class',cls:clsId,title:`서류발급 ${mine._status} · ${clsId}반 ${d.name}`,body:[d.docType,mine._status==='보완 필요'&&mine._fix?`보완 사유 ${mine._fix}`:'',mine._memo?`비고 ${mine._memo}`:''].filter(Boolean).join(' · '),link:linkFor('b2docs',{cls:clsId,id:d.id})});
    toast(`${d.id} 처리 상황을 저장했습니다.${moved?' · 담임 알림함에 알렸습니다':''}`);busy=false;await load();
   }
   catch(err2){
    busy=false;
    if(isConflict(err2)){ // 새로 읽고 새 값을 보인 뒤 내 입력을 그대로 올려 둡니다(다시 「처리 저장」하면 새 was로 저장)
     await load();const nd=data?.rows.find(x=>x.id===d.id);
     if(nd){Object.assign(nd,mine);nd._err=`그사이 다른 사람이 바꿨습니다 · 새 값: 상태 ${nd.status||'접수'}${nd.memo?` · 비고 ${nd.memo}`:''}${nd.handler?` (${nd.handler})`:''} · 내 입력은 남겨 두었습니다. 다시 「처리 저장」을 누르면 내 값으로 저장합니다.`;openId=nd.id;}
     else toast('그사이 다른 사람이 바꿨습니다 · 그 신청을 다시 찾지 못했습니다');
     render();return;
    }
    d._err=err2.message;render();
   }
   return;
  }
  if(e.target.closest('[data-doc-edit],a,input,textarea,select'))return;
  const card=e.target.closest('[data-doc]');if(card&&admin){openId=openId===card.dataset.doc?'':card.dataset.doc;render();}
 });
 render();await load();
 return {dispose:()=>life.dispose(),canLeave:()=>!(creating&&form&&(form.name||form.submitTo||form.memo))||confirm('작성 중인 서류발급 신청이 있습니다. 화면을 떠날까요?')};
}
