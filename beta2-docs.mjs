// 2기 서류발급: 담임 신청 → 마스터시트 '서류발급' 탭 → 관리자 처리. 기재 기간은 2기 교육 기간(cohort.json) 안에서 고릅니다.
import {rosterFor} from './beta2-core.mjs';
import {COURSE_START,COURSE_END} from './cohort.mjs';
import {esc,md,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';

const STATE_CLASS={'접수':'t-rec','처리중':'t-late','보완 필요':'t-absent','처리완료':'e-ok','취소':'t-na'};
const OPEN=['접수','처리중','보완 필요'];
const dday=(due,today)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(due||''))return '';const n=Math.round((Date.parse(due)-Date.parse(today))/864e5);return n<0?`${-n}일 지남`:n===0?'오늘 마감':`D-${n}`;};
const koreaToday=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,10);

export async function mount(host,{client,classes,selected,teacherClass=null}){
 const life=lifecycle(host),admin=!teacherClass;
 let data=null,bundle=null,filter=admin?'open':'all',cls=teacherClass?String(teacherClass):'all',search='',openId='',creating=!admin,form=null,busy=false,err='';
 const today=koreaToday();
 const blank=()=>({cls:teacherClass?String(teacherClass):String(selected||'1'),name:'',docType:'출석부',docOther:'',qty:1,from:'',to:'',purpose:'',submitTo:'',due:'',delivery:'이메일(PDF)',memo:''});
 form=blank();
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>${admin?'서류발급 신청함':'서류발급 신청'}</h2><p>${admin?'신청이 들어오면 hint.kpc · kpc.jtkim 메일로 바로 알림이 갑니다. 처리 상황을 바꾸면 담임 화면과 마스터시트 서류발급 탭에 그대로 보입니다.':'교육생 서류가 필요하면 여기서 신청해 주세요. 신청 즉시 운영팀에 메일 알림이 가고, 처리 상황을 이 화면에서 확인할 수 있습니다.'}</p></div>${admin?'<button class="b2-btn primary" id="d2New">새 신청 작성</button>':''}</div><div id="d2Form"></div><section class="b2-card"><div class="b2-toolbar" id="d2Tools"></div><div id="d2List" style="padding:0 14px 14px">${loading()}</div></section></div>`;
 const $=s=>host.querySelector(s);
 const roster=()=>bundle?rosterFor(bundle,form.cls).filter(p=>!p.status||p.status==='재학'||p.changed>today):[];
 function formHtml(){
  if(!creating)return '';
  const types=data?.types||['출석부','교육참여확인서','훈련생 확인서','기타'],delivery=data?.delivery||['이메일(PDF)','담임 전달','우편'];
  return `<section class="b2-card b2-pad" style="margin-bottom:14px"><h3 style="margin-bottom:12px">새 서류발급 신청</h3><div class="b2-form">
   ${admin?`<label class="b2-field">반<select data-g="cls">${classOptions(classes,form.cls)}</select></label>`:''}
   <label class="b2-field ${admin?'':'wide'}">교육생<select data-g="name"><option value="">교육생 선택</option>${roster().map(p=>`<option ${p.name===form.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
   <div class="b2-field wide">서류 종류<div class="b2-chips" style="margin-top:4px">${types.map(t=>`<button class="b2-chip" data-doctype="${esc(t)}" aria-pressed="${form.docType===t}">${esc(t)}</button>`).join('')}</div>${form.docType==='기타'?`<input data-g="docOther" placeholder="서류 이름" maxlength="60" value="${esc(form.docOther)}" style="margin-top:6px">`:''}</div>
   <label class="b2-field">기재할 기간 · 시작<input type="date" data-g="from" value="${esc(form.from)}" min="${COURSE_START}" max="${COURSE_END}"></label>
   <label class="b2-field">기재할 기간 · 끝<input type="date" data-g="to" value="${esc(form.to)}" min="${COURSE_START}" max="${COURSE_END}"></label>
   <label class="b2-field">제출처 (필수)<input data-g="submitTo" maxlength="100" placeholder="예: 국민취업지원제도 운영기관" value="${esc(form.submitTo)}"></label>
   <label class="b2-field">제출 마감일<input type="date" data-g="due" value="${esc(form.due)}" min="${today}"></label>
   <label class="b2-field">발급 목적<input data-g="purpose" maxlength="100" placeholder="예: 국취제 출석 확인" value="${esc(form.purpose)}"></label>
   <label class="b2-field">수량<input type="number" data-g="qty" min="1" max="10" value="${esc(form.qty)}"></label>
   <label class="b2-field">받는 방법<select data-g="delivery">${delivery.map(d=>`<option ${d===form.delivery?'selected':''}>${esc(d)}</option>`).join('')}</select></label>
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
  err='';const type=form.docType==='기타'?form.docOther.trim():form.docType;
  if(!form.name)err='교육생을 골라 주세요.';else if(!type)err='서류 종류를 적어 주세요.';else if(!form.submitTo.trim())err='제출처를 적어 주세요.';else if(form.from&&form.to&&form.to<form.from)err='기재할 기간의 끝이 시작보다 빠릅니다.';
  if(err)return render();
  busy=true;render();
  try{
   const res=await client.docCreate({cls:form.cls,name:form.name,docType:type,qty:form.qty,period:form.from||form.to?`${form.from||'?'} ~ ${form.to||'?'}`:'',purpose:form.purpose.trim(),submitTo:form.submitTo.trim(),due:form.due,delivery:form.delivery,memo:form.memo.trim()});
   toast(`신청했습니다 · ${res.id}${res.mailed?' · 운영팀 메일 알림 완료':' · 메일 알림 실패(시트에는 저장됨)'}`);
   form=blank();creating=!admin;busy=false;await load();
  }catch(e){busy=false;err=e.message;render();}
 }
 host.addEventListener('input',e=>{const g=e.target.dataset?.g,u=e.target.dataset?.u;if(g){form[g]=e.target.value;if(g==='cls'){form.name='';render();}}if(u){const d=data.rows.find(x=>x.id===openId);if(d)d[{link:'_link',memo:'_memo',fixReason:'_fix'}[u]]=e.target.value;}});
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');
  if(b?.dataset.filter){filter=b.dataset.filter;render();return;}
  if(b?.dataset.doctype){form.docType=b.dataset.doctype;render();return;}
  if(b?.hasAttribute('data-submit')){await submit();return;}
  if(b?.hasAttribute('data-cancel')){creating=false;render();return;}
  if(b?.id==='d2New'){creating=true;form=blank();err='';render();return;}
  const d=openId&&data?.rows.find(x=>x.id===openId);
  if(b?.dataset.status&&d){d._status=b.dataset.status;render();return;}
  if(b?.hasAttribute('data-update')&&d){
   busy=true;d._err='';render();
   try{await client.docUpdate({id:d.id,status:d._status||d.status,memo:d._memo??d.memo,link:(d._link??d.link)||'',fixReason:d._fix??d.fixReason});toast(`${d.id} 처리 상황을 저장했습니다.`);busy=false;await load();}
   catch(err2){busy=false;d._err=err2.message;render();}
   return;
  }
  if(e.target.closest('[data-doc-edit],a,input,textarea,select'))return;
  const card=e.target.closest('[data-doc]');if(card&&admin){openId=openId===card.dataset.doc?'':card.dataset.doc;render();}
 });
 render();await load();
 return {dispose:()=>life.dispose(),canLeave:()=>!(creating&&form&&(form.name||form.submitTo||form.memo))||confirm('작성 중인 서류발급 신청이 있습니다. 화면을 떠날까요?')};
}
