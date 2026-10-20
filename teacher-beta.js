// 2기 베타 담임화면 (Vercel 운영포털 탭용 모듈)
// 사용: import { mountTeacherBeta } from './teacher-beta.js';
//       mountTeacherBeta(document.getElementById('beta-root'), { cls: 1, getToken: async () => idToken, endpoint: '/api/teacher-beta' });
// 화면·로직은 Apps Script 담임 포털과 동일. 데이터는 /api/teacher-beta → Apps Script → 마스터시트.
// Shadow DOM 안에 그려서 기존 포털 CSS와 서로 간섭하지 않습니다.
// 포털에 이미 있는 반 정보(머리글)·금주 시간표·만족도 집계는 기존 탭을 쓰고 여기서는 다시 그리지 않습니다.
// 사유 칸은 관리자 출결대조와 같은 공용 도우미(reason-pick.mjs, 사용자 2026-10-20 '담임화면에서도 사유 부분 드롭다운은 관리자 화면 급으로 동일하게 해주기. 기본적인 경고 사항도 바로 캐치 가능하게'):
// 사유 드롭다운 하나 + 종류가 있는 분류는 바로 옆 종류 드롭다운, '기타'는 직접 입력, 인정 출결이면 막힌 항목(자격증 X 종류·일반건강검진)은 고를 수 없고, 고르는 즉시 경고(인정 안 됨·관련성 확인·
// 교육일 아닌 날·취업박람회 추가 증빙·인정 출결 사유 없음)와 증빙 상태(보기만, 운영팀이 정함)가 보입니다. 취업박람회는 추가 증빙 알림.
// 시간 칸 없음(사용자 지시 2026-10-20 '담임화면 출결판에서 입퇴실 및 외출시간 입력하는건 빼줘. 다만 체크히어 메모 추천사유만 남겨둬'): 오른쪽 칸은 유형·사유(드롭다운, 빠른 사유)와
// 체크히어 메모 추천(복사)만. 입실·퇴실·외출 시간은 저장된 값을 보기만 하고, 저장할 때는 저장된 시간을 그대로 다시 보냅니다(portalSave는 빈 칸을 ''로 덮으므로).
// 아무 날짜 기록(사용자 결정 2026-10-20 '수정 자체는 언제든 유연하게'): 시트가 주는 날짜(portalData.days)는 오늘까지의 교육일이라, 교육일이 아닌 날·아직 오지 않은 날의
// 원장 기록(portalData.recs)은 출결판에 칸을 더해 보이고, 「다른 날짜」 칸으로 아무 날이나 열어 기록합니다(시트 출결판 탭에는 교육일만 나옴).
import {isIsoDate,isTrainingDay} from './cohort.mjs';
import {tidyReason,STANDARD,extraEvidence,extraEvidenceStarted,extraNotice,EXTRA_LABEL} from './attendance-reason-catalog.mjs';
import {reasonPickHtml,reasonNotesHtml,pickReasonText,kindInputText} from './reason-pick.mjs';
export function mountTeacherBeta(el, OPT) {
  OPT = OPT || {};
  const R = el.shadowRoot || el.attachShadow({ mode: 'open' });
  R.innerHTML = '<style>' + TB_CSS + '</style><div id="app"></div><div class="toast" id="toast"></div>';
  const TYPES=['해당없음','출석','지각','조퇴','외출','결석','인정출석','인정지각','인정조퇴','인정외출'];
  const CODE={해당없음:['-','k-na'],출석:['출','k-ok'],지각:['지','k-lt'],조퇴:['조','k-lt'],외출:['외','k-lt'],결석:['결','k-ab'],인정출석:['인','k-rc'],인정지각:['인','k-rc'],인정조퇴:['인','k-rc'],인정외출:['인','k-rc']};
  const NEED={지각:'inT',인정지각:'inT',조퇴:'outT',인정조퇴:'outT',외출:'oa',인정외출:'oa'};
  const W='일월화수목금토';
  let S={cls:null,pin:'',d:null,tab:OPT.tab||'today',sel:null,f:null,timer:null,extra:[],custom:false}; // extra: 「다른 날짜」로 연 날(반을 바꾸면 비움), custom: 사유 '기타'(직접 입력)를 고른 상태
  const $=s=>R.querySelector(s), app=()=>$('#app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const md=s=>{if(!s)return'';const p=String(s).split('-');if(p.length<3)return s;const d=new Date(+p[0],+p[1]-1,+p[2]);return (+p[1])+'/'+(+p[2])+'('+W[d.getDay()]+')';};
  let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),1800);}
  async function run(fn,...a){const h={'Content-Type':'application/json'};const tk=OPT.getToken?await OPT.getToken():'';if(tk)h.Authorization='Bearer '+tk;const r=await fetch(OPT.endpoint||'/api/teacher-beta',{method:'POST',headers:h,body:JSON.stringify({action:fn,args:a,cls:S.cls})});const j=await r.json().catch(()=>({ok:false,error:'응답 오류'}));if(!j.ok)throw Object.assign(new Error(j.error||'요청 실패'),{code:j.code});return j.data;}

  async function login(){
    // 2026-10-19: 불러오는 중·준비 중·실패를 담임이 알아듣는 말로, 실패하면 「다시 시도」
    app().innerHTML='<div class="card"><div class="sec">출결 정보</div><div class="note">출결 정보를 불러오는 중입니다…</div></div>';
    S.cls=Number(OPT.cls);S.pin='';S.extra=[];
    try{S.d=await run('portalData',S.cls,'');render();}catch(err){const wait=err.code==='NOT_CONFIGURED';app().innerHTML='<div class="card"><div class="sec">'+(wait?'출결 입력 준비 중':'출결 정보를 불러오지 못했습니다')+'</div><div class="'+(wait?'note':'err')+'">'+esc(err.message)+'</div>'+(wait?'':'<div class="note" style="margin-top:6px">잠시 뒤 「다시 시도」를 눌러 주세요. 계속 안 되면 운영팀에 알려 주세요.</div><button class="btn" id="retry" style="margin-top:10px">다시 시도</button>')+'</div>';const b=$('#retry');if(b)b.onclick=login;}
  }
  async function reload(keep,say){try{S.d=await run('portalData',S.cls,S.pin);if(!keep)S.sel=null;render();if(say)toast('새로 불러왔습니다');}catch(e){toast('새로 불러오지 못했습니다 · '+e.message);}}

  // 2026-10-16 회의: 학습자 평가·현장운영 체크리스트는 없앴고, 민원·이슈는 운영팀과 주고받는 beta2-voc.mjs로 옮겼습니다(2기 베타 담임 화면 '민원·만족도').
  const TABS=[['today','오늘'],['board','출결판'],['reason','출결사유'],['info','반 정보']];
  function render(){
    const d=S.d;
    // 반·과정·담임은 포털 머리글에 이미 있으므로 하위 메뉴와 기준일만 한 줄로 둡니다.
    // hideNav: 2기 베타 담임 화면(6탭 통합)이 바깥 메뉴로 하위 화면을 고릅니다.
    let h='<header class="bar">'+(OPT.hideNav?'':'<nav>'+TABS.map(([k,l])=>'<button data-tab="'+k+'" aria-selected="'+(S.tab===k)+'">'+l+'</button>').join('')+'</nav>')+'<span class="sp"></span><span class="sub">출결 기준일 <b>'+md(d.mainDay)+'</b></span><button id="rf">새로고침</button></header><main id="v"></main>';
    app().innerHTML=h;
    $('#rf').onclick=()=>reload(true,true);
    R.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{flush();S.tab=b.dataset.tab;render();});
    ({today:vToday,board:vBoard,reason:vReason,info:vInfo})[S.tab]();
  }

  function vToday(){
    const d=S.d;
    let h='<div class="card"><div class="sec">오늘 출결 ('+md(d.mainDay)+')</div><div class="sum">'+d.summary.filter(x=>x.k!=='당일 마감').map(x=>'<div><b>'+esc(x.v)+'</b><span>'+esc(x.k)+'</span></div>').join('')+'</div>';
    // 2026-10-19: 남은 인원을 먼저 말하고 출결판으로 가는 큰 단추(바깥 화면이 onTab을 줄 때)
    const todo=d.kids.filter(k=>!(k.off&&d.mainDay>k.off)&&!d.recs[k.name+'|'+d.mainDay]).length;h+=todo?'<div class="note big">아직 입력하지 않은 학생 <b style="color:var(--orange)">'+todo+'명</b> · 출석한 학생도 「출석」으로 모두 표시해 주세요.</div>':'<div class="note big" style="color:var(--green)">오늘 출결을 모두 입력했습니다.</div>';
    if(OPT.onTab)h+='<button class="btn go" id="goBoard">'+(todo?'출결 입력하기':'출결판 보기')+' →</button>';
    h+='<div class="lab">당일 마감 · 수업이 끝나면 위 숫자를 확인하고 「확인」을 눌러 주세요</div><div class="chips"><button class="chip g" data-close="확인" aria-pressed="'+(d.closed==='확인')+'">확인</button><button class="chip n" data-close="미확인" aria-pressed="'+(d.closed!=='확인')+'">미확인</button></div></div>';
    $('#v').innerHTML=h;
    const go=$('#goBoard');if(go)go.onclick=()=>OPT.onTab('board');
    R.querySelectorAll('[data-close]').forEach(b=>b.onclick=async()=>{const v=b.dataset.close;S.d.closed=v;vToday();try{await run('portalClose',S.cls,S.pin,v);toast('당일 마감: '+v);}catch(e){toast(e.message);}});
  }

  // 출결판 날짜 칸(최근 먼저): 시트가 준 교육일 + 원장에 기록이 있는 교육일 아닌 날·아직 오지 않은 날 + 「다른 날짜」로 연 날 + 지금 고른 칸의 날.
  // 오늘까지의 교육일 가운데 시트가 주지 않은 오래된 날은 지금처럼 빼고, 그런 날도 「다른 날짜」로 열 수 있습니다.
  const typedDay=x=>isIsoDate(x)&&x>='1900-01-01'&&x<='2999-12-31'; // 날짜 모양(연도를 치는 중간 값 0002-… 넘김). 기간 제한이 아닙니다.
  const offDay=x=>!S.d.days.includes(x)&&!isTrainingDay(x),future=x=>!!S.d.mainDay&&x>S.d.mainDay&&!S.d.days.includes(x);
  function boardDays(){
    const d=S.d,more=new Set(S.extra);
    for(const k of Object.keys(d.recs)){const x=k.slice(k.lastIndexOf('|')+1);if(typedDay(x)&&!d.days.includes(x)&&(offDay(x)||future(x)))more.add(x);}
    if(S.sel&&typedDay(S.sel.day))more.add(S.sel.day);
    return [...new Set([...d.days,...more])].sort().reverse();
  }
  const dayTag=x=>offDay(x)?'교육일 아님':future(x)?'예정':'';
  function cellVal(n,day){const k=S.d.kids.find(x=>x.name===n);if(k&&k.off&&day>k.off)return null;const r=S.d.recs[n+'|'+day];return r?r.type:'해당없음';}
  function vBoard(){
    const d=S.d,days=boardDays();
    // 2026-10-19: 안내는 순서대로 짧게, 맨 앞 칸(기준일)에 '오늘'(한국 날짜가 기준일이 아니면 '기준일') 표시, 학생이 없으면 쉬운 말로
    if(!d.kids.length){$('#v').innerHTML='<div class="card"><div class="sec">교육생이 없습니다</div><div class="note">마스터시트 명부에 이 반 교육생이 아직 없습니다. 명단이 비어 있으면 운영팀에 알려 주세요.</div></div>';return;}
    const first=d.mainDay===new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())?'오늘':'기준일';
    let h='<div class="wrap"><div><ol class="steps"><li>학생 칸을 눌러 출석·지각·결석 등을 고르면 바로 저장됩니다.</li><li>지각·조퇴·외출·인정은 오른쪽(휴대폰은 아래) 칸에서 사유를 골라 주세요. 시간은 보기만 합니다.</li></ol><div class="note" style="margin-bottom:6px">아직 입력하지 않은 칸은 「해당없음」으로 보입니다.</div><div class="note anyday" style="margin-bottom:6px"><label>다른 날짜 <input type="date" id="anyDay" aria-label="다른 날짜 열기"></label> <span id="anyNote">교육일이 아닌 날·아직 오지 않은 날도 열어 기록할 수 있습니다.</span></div><div class="scroll"><table class="g"><thead><tr><th class="nm">이름</th>'+days.map(x=>{const t=x===d.mainDay,tag=dayTag(x);return '<th class="'+(t?'today':'')+(tag?' off':'')+'" data-day="'+x+'">'+md(x)+(t?'<small>'+first+'</small>':tag?'<small class="tag">'+tag+'</small>':'')+'</th>';}).join('')+'</tr></thead><tbody>';
    d.kids.forEach(k=>{h+='<tr><td class="nm">'+esc(k.name)+(k.status!=='재학'?' <span class="note">'+esc(k.status)+'</span>':'')+'</td>';
      days.forEach(x=>{const tc=x===d.mainDay?'today':'';const v=cellVal(k.name,x);if(v===null){h+='<td class="'+tc+'"></td>';return;}const c=CODE[v]||['-','k-na'];const sel=S.sel&&S.sel.n===k.name&&S.sel.day===x?' sel':'';const r=d.recs[k.name+'|'+x];const miss=r&&(r.ev==='미제출'||r.ev==='반려'||(!r.ev&&String(r.type).indexOf('인정')===0))?' *':'';
        h+='<td class="cell '+tc+'"><select class="'+c[1]+sel+'" data-n="'+esc(k.name)+'" data-d="'+x+'" title="'+esc(k.name)+' '+md(x)+'">'+TYPES.map(t=>'<option value="'+t+'"'+(t===v?' selected':'')+'>'+t+(t===v?miss:'')+'</option>').join('')+'</select></td>';});
      h+='</tr>';});
    h+='</tbody></table></div><div class="note" style="margin-top:6px">* 표시: 증빙서류를 아직 내지 않았거나 반려된 칸 (운영팀 확인 중)</div></div><div class="panel" id="pn"></div></div>';
    $('#v').innerHTML=h;
    const pick=(el,keepType)=>{flush();if(!(S.sel&&S.sel.n===el.dataset.n&&S.sel.day===el.dataset.d))S.custom=false;S.sel={n:el.dataset.n,day:el.dataset.d};const r=S.d.recs[S.sel.n+'|'+S.sel.day];S.f=r?Object.assign({},r):{type:'해당없음',inT:'',outT:'',oa:'',ob:'',r:''};R.querySelectorAll('.g select.sel').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');};
    // 다른 날짜: 날짜 모양이면 그날 칸을 열고(이미 있으면 그 칸으로) 첫 학생 칸에 초점. 키보드로 치는 동안은 잠깐(0.5초) 기다립니다.
    const any=$('#anyDay');let anyT=0;
    any.onchange=()=>{clearTimeout(anyT);anyT=setTimeout(()=>{const x=any.value;if(!typedDay(x)||!R.contains(any))return;if(!S.extra.includes(x))S.extra.push(x);vBoard();
      const el=R.querySelector('.g select[data-d="'+x+'"]'),th=R.querySelector('.g th[data-day="'+x+'"]'),tag=dayTag(x);if(th)th.scrollIntoView({block:'nearest',inline:'center'});if(el)el.focus();
      const n=$('#anyNote');if(n)n.textContent=md(x)+(tag==='교육일 아님'?' · 교육일이 아닌 날입니다. 기록할 수 있고, 시트 출결판에는 나오지 않습니다.':tag==='예정'?' · 아직 오지 않은 날입니다. 미리 기록할 수 있습니다.':' 칸을 열었습니다.');},500);};
    R.querySelectorAll('.g select').forEach(el=>{
      el.onfocus=()=>{if(!(S.sel&&S.sel.n===el.dataset.n&&S.sel.day===el.dataset.d)){pick(el);panel(true);}};
      el.onchange=()=>{pick(el);S.f.type=el.value;paint(el,el.value);panel();save();if(innerWidth<=900)$('#pn').scrollIntoView({behavior:'smooth'});};
    });
    panel();
  }
  function paint(el,v){const c=CODE[v]||['-','k-na'];el.className=c[1]+' sel';}
  function memo(){const f=S.f,t=S.d.teacher||'담임',tm=x=>x||'--:--';if(!f||f.type==='출석'||f.type==='해당없음'||f.type==='결석')return'';
    if(f.type==='지각')return'지각_담임:'+t+'('+tm(f.inT)+')';if(f.type==='조퇴')return'조퇴_담임:'+t+'('+tm(f.outT)+')';if(f.type==='외출')return'외출_담임:'+t+'('+tm(f.oa)+'~'+tm(f.ob)+')';
    const r=tidyReason(f.r)||'사유';if(f.type==='인정출석')return'(인정출석)'+r+'_담임:'+t;if(f.type==='인정지각')return'(인정지각)'+r+'_담임:'+t+'('+tm(f.inT)+')';if(f.type==='인정조퇴')return'(인정조퇴)'+r+'_담임:'+t+'('+tm(f.outT)+')';return'(인정외출)'+r+'_담임:'+t+'('+tm(f.oa)+'~'+tm(f.ob)+')';}
  // 사유 칸(관리자 출결대조와 같은 reason-pick.mjs): 드롭다운 하나 + 옆 종류 드롭다운 + 기타 직접 입력
  const recOf=()=>S.sel&&S.d.recs[S.sel.n+'|'+S.sel.day];
  function pickHtml(){return reasonPickHtml({reason:S.f.r,type:S.f.type,cls:S.cls,name:S.sel.n,custom:S.custom});}
  // 경고(고르는 즉시, 저장은 막지 않음): 관리자 출결대조와 같은 글 + 인정 출결 사유 없음
  function pickNote(){const f=S.f,r=recOf();return reasonNotesHtml({type:f.type,reason:f.r,cls:S.cls,offDay:offDay(S.sel.day),rec:r&&{type:r.type,reason:r.r,ev:r.ev},required:true});}
  // 증빙(보기만): 담임은 증빙 상태를 정하지 않습니다(portalSave에 증빙 칸 없음, 운영팀이 출결대조에서 확인). 인정 출결이면 비어 있어도 '증빙 미제출'.
  function evHtml(){
    const f=S.f,st=String(f.ev||'').trim()||(String(f.type).indexOf('인정')===0?'미제출':''),r=recOf(),x=r&&extraEvidence({type:r.type,reason:r.r,ev:r.ev});
    let h='';
    if(st&&st!=='해당없음')h+='<span class="b2-badge '+(st==='확인'?'e-ok':st==='미제출'||st==='반려'?'e-miss':'e-none')+'" data-ev="'+esc(st)+'">증빙 '+esc(st)+'</span>';
    if(x)h+=x.done?'<span class="b2-badge e-ok" title="'+esc(x.label)+'">추가 증빙 '+esc(x.state)+'</span>':'<span class="b2-badge e-extra" title="'+esc(x.label)+'">'+esc(x.label)+' · '+esc(x.state)+'</span>';
    if(st==='반려')h+=f.evr?'<span class="b2-sub">반려: '+esc(f.evr)+'</span>':'<span class="b2-err" style="display:block" data-reason-check="evr">반려 사유가 비어 있습니다 · 운영팀에 확인해 주세요</span>';
    return h?h+'<span class="b2-sub">증빙은 운영팀이 확인합니다</span>':'';
  }
  function syncNote(){const b=$('#rn');if(b)b.innerHTML=pickNote();const e=$('#evb');if(e)e.innerHTML=evHtml();const m=$('#mm');if(m)m.textContent=memo();}
  function syncPick(){const a=$('#rp');if(a){a.innerHTML=pickHtml();bindPick();}syncNote();}
  // 드롭다운에서 고르면 새 글로 칸을 다시 그리고 다음 칸(옆 종류·직접 입력)에 초점, 0.7초 뒤 저장. '기타'를 고른 것만으로는 저장하지 않습니다(직접 쓰면 저장).
  function setReason(text,focus,quiet){S.f.r=text;syncPick();if(focus){const el=$('#rp [data-inline="'+focus+'"]');if(el)el.focus();}if(quiet)st('');else later();}
  function bindPick(){
    R.querySelectorAll('#rp select').forEach(el=>el.onchange=()=>{const p=pickReasonText(S.f.r,el.dataset.inline,el.value);if(p.custom!==null)S.custom=p.custom;setReason(p.text,p.focus,p.custom===true);});
    R.querySelectorAll('#rp input').forEach(el=>{
      el.oninput=()=>{S.f.r=el.dataset.inline==='rapt'?kindInputText(el.dataset.kind,el.value):el.value;if(el.dataset.inline==='reason'){S.custom=true;el.title=el.value;}syncNote();later();};
      el.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save();el.blur();}};
    });
  }
  // 빠른 사유: 지금 목록에 있는 표준 글만(관리자가 숨기면 빠짐), '해당없음'은 사유 비우기
  const QUICK=['해당없음','개인일정','병원','면접','교통사정','예비군'];
  function panel(noFocus){
    const p=$('#pn');if(!p)return;
    if(!S.sel){p.innerHTML='<h2>사유 입력</h2><div class="note" style="margin-top:6px">출결판에서 학생 칸을 누르면 여기에서 사유를 고르고 체크히어 메모 추천을 볼 수 있습니다.</div>';return;}
    const f=S.f;
    let h='<h2>'+esc(S.sel.n)+'</h2><div class="note">'+md(S.sel.day)+(S.sel.day===S.d.mainDay?' · 오늘':'')+(dayTag(S.sel.day)?' · '+dayTag(S.sel.day):'')+'</div><div class="lab">유형</div><div class="chips">'+TYPES.map(t=>'<button class="chip" data-t="'+t+'" aria-pressed="'+(f.type===t)+'">'+t+'</button>').join('')+'</div>';
    if(f.type==='해당없음')h+='<div class="note" style="margin-top:10px">아직 입력 전입니다. 위에서 출석 또는 다른 유형을 고르세요.</div>';
    if(f.type!=='출석'&&f.type!=='해당없음'){
      h+='<div class="lab">'+(f.type.indexOf('인정')===0?'사유 (필수)':'사유')+' · 고르면 바로 저장 · 직접 입력은 Enter</div><div class="rp" id="rp">'+pickHtml()+'</div><div class="evb" id="evb">'+evHtml()+'</div><div class="rn" id="rn">'+pickNote()+'</div><div class="qr">'+QUICK.filter(q=>q==='해당없음'||STANDARD.has(q)).map(q=>'<button class="'+(q==='해당없음'?'na':'')+'" data-q="'+q+'"'+(q==='해당없음'?' title="사유 비우기"':'')+'>'+q+'</button>').join('')+'</div>';
      h+=timesView(f);
      const m=memo();if(m)h+='<div class="memo"><span id="mm">'+esc(m)+'</span><button id="cp">복사</button></div>';
    }
    h+='<div class="status" id="st"></div>';
    p.innerHTML=h;
    p.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{S.f.type=b.dataset.t;const el=R.querySelector('.g select[data-n="'+window.CSS.escape(S.sel.n)+'"][data-d="'+S.sel.day+'"]');if(el){el.value=S.f.type;paint(el,S.f.type);}panel();save();});
    p.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{S.custom=false;S.f.r=b.dataset.q==='해당없음'?'':b.dataset.q;syncPick();save();});
    bindPick();
    const c=$('#cp');if(c)c.onclick=()=>navigator.clipboard.writeText(memo()).then(()=>toast('메모를 복사했습니다'),()=>toast('직접 선택해 복사해 주세요'));
    const first=$('#rp [data-inline="reason"]')||$('#rp [data-inline="rmain"]');if(first&&!f.r&&!noFocus)first.focus();
  }
  // 저장된 시간(보기만). 그 유형에 필요한 시간이 비었으면 '운영팀이 체크히어 기록으로 맞춤'만 알립니다(담임은 입력하지 않음).
  function timesView(f){
    const need=NEED[f.type]||'',shown=[['inT','입실'],['outT','퇴실']].filter(([k])=>f[k]).map(([k,l])=>l+' '+esc(f[k]));
    if(f.oa||f.ob)shown.push('외출 '+esc(f.oa||'--:--')+'~'+esc(f.ob||'--:--'));
    const miss=need&&!(need==='oa'?f.oa&&f.ob:f[need]);
    return '<div class="note tv" id="tv" style="margin-top:8px">시간(보기만): '+(shown.length?shown.join(' · '):'없음')+(miss?' · 시간은 운영팀이 체크히어 기록으로 맞춥니다':'')+'</div>';
  }
  function st(t,k){const s=$('#st');if(s){s.textContent=t;s.className='status'+(k?' '+k:'');}}
  function later(){st('입력 중…');clearTimeout(S.timer);S.timer=setTimeout(save,700);}
  function flush(){if(S.timer){clearTimeout(S.timer);S.timer=null;save();}}
  async function save(){
    clearTimeout(S.timer);S.timer=null;if(!S.sel)return;
    const sel=S.sel,f=Object.assign({},S.f,{r:tidyReason(S.f.r)}),before=S.d.recs[sel.n+'|'+sel.day];
    st('저장 중…');
    // 시간은 담임이 고치지 않으므로 저장된 값(없으면 빈 값)을 그대로 보냅니다. portalSave는 보내지 않은 시간을 ''로 덮어 지우기 때문입니다.
    const keep=before||{};
    try{const res=await run('portalSave',{cls:S.cls,pin:S.pin,name:sel.n,date:sel.day,type:f.type,inT:keep.inT||'',outT:keep.outT||'',oa:keep.oa||'',ob:keep.ob||'',r:f.r});
      if(!res.ok){st(res.msg,'err');return;}
      const key=sel.n+'|'+sel.day;if(f.type==='해당없음')delete S.d.recs[key];else S.d.recs[key]=Object.assign({ev:'',evr:''},S.d.recs[key]||{},f);
      if(extraEvidenceStarted(before&&{type:before.type,reason:before.r},{type:f.type,reason:f.r}))extraAlert(sel,f);
      const b=R.querySelector('.g select[data-n="'+window.CSS.escape(sel.n)+'"][data-d="'+sel.day+'"]');if(b&&b.value!==f.type){b.value=f.type;paint(b,f.type);}
      // 시트 안내 가운데 시간 칸(입실 시간·퇴실 시간·외출 구간)은 담임이 채우지 않으므로 빼고 사유만 보입니다.
      const w=String(res.warn||'').replace(/은 나중에 채워도 됩니다$/,'').split('·').filter(x=>x==='사유').join('·'),warn=w?w+'은 나중에 채워도 됩니다':'';
      if(S.sel===sel)syncNote(); // 저장된 기록 기준 안내(취업박람회 추가 증빙 배지 등)
      if(S.sel===sel)st(warn?'저장했습니다 · '+warn:'저장했습니다',warn?'warn':'ok');
    }catch(e){st('저장하지 못했습니다 · '+e.message+' · 다시 골라 주세요','err');}
  }

  // 취업박람회 추가 증빙 알림(반 담임 + 관리자, notify.mjs '추가 증빙'). 알림을 못 남겨도 저장은 그대로입니다(notify가 작은 안내).
  function extraAlert(sel,f){
    const n=extraNotice({cls:S.cls,name:sel.n,date:sel.day,type:f.type});
    if(OPT.notify)return void OPT.notify(n,sel,f);
    import('./notify.mjs').then(m=>m.notify('추가 증빙',{audience:'admins',toClass:String(S.cls),cls:String(S.cls),title:n.title,body:n.body,link:'#b2ledger?cls='+S.cls+'&date='+sel.day})).catch(e=>console.warn('추가 증빙 알림을 남기지 못했습니다',e));
  }
  function vReason(){
    const d=S.d,rows=Object.entries(d.recs).filter(([k,r])=>r.type!=='출석').map(([k,r])=>{const i=k.lastIndexOf('|');return Object.assign({n:k.slice(0,i),day:k.slice(i+1)},r);}).sort((a,b)=>b.day.localeCompare(a.day)||a.n.localeCompare(b.n));
    const flag=r=>{const w=[];if(NEED[r.type]==='inT'&&!r.inT)w.push('입실 시간');if(NEED[r.type]==='outT'&&!r.outT)w.push('퇴실 시간');if(NEED[r.type]==='oa'&&(!r.oa||!r.ob))w.push('외출 구간');if(String(r.type).indexOf('인정')===0&&!r.r)w.push('사유');return w.join('·');};
    // 2026-10-20: 취업박람회 추가 증빙(기업면접 확인서) 배지와 '추가 증빙 · 취업박람회' 거르기(못 한 것만)
    const xOf=r=>extraEvidence({type:r.type,reason:r.r,ev:r.ev}),xOpen=r=>{const x=xOf(r);return !!x&&!x.done;},onlyX=!!S.onlyExtra,only=S.onlyMissing&&!onlyX,list=onlyX?rows.filter(xOpen):only?rows.filter(r=>flag(r)):rows;
    // 2026-10-19: 시트 칸 이름(가-3) 대신 쉬운 제목, 비었으면 '없습니다' 한 줄
    const empty=onlyX?'추가 증빙을 기다리는 취업박람회 기록이 없습니다.':only?'빠진 항목이 없습니다.':'지각·결석 등 출석이 아닌 기록이 아직 없습니다.';
    let h='<div class="card"><div class="sec">지각·결석 등 기록</div><div class="chips" style="margin-bottom:10px"><button class="chip" id="all" aria-pressed="'+(!only&&!onlyX)+'">전체 '+rows.length+'</button><button class="chip" id="mis" aria-pressed="'+(!!only)+'">빠진 항목 '+rows.filter(r=>flag(r)).length+'</button><button class="chip" id="xev" aria-pressed="'+onlyX+'">추가 증빙 · 취업박람회 '+rows.filter(xOpen).length+'</button></div>';
    h+='<div style="overflow-x:auto"><table class="list"><thead><tr><th>일자</th><th>이름</th><th>유형</th><th>시간</th><th>사유</th><th>증빙</th><th>빠진 항목</th></tr></thead><tbody>'+list.map(r=>'<tr class="click" data-n="'+esc(r.n)+'" data-d="'+r.day+'"><td>'+md(r.day)+'</td><td>'+esc(r.n)+'</td><td>'+esc(r.type)+'</td><td>'+[r.inT&&'입실 '+r.inT,r.outT&&'퇴실 '+r.outT,r.oa&&'외출 '+r.oa+'~'+(r.ob||'')].filter(Boolean).join(' ')+'</td><td>'+esc(r.r)+'</td><td>'+esc(r.ev||(String(r.type).indexOf('인정')===0?'미제출':''))+(xOf(r)?' <span class="xb'+(xOf(r).done?' ok':'')+'">'+esc(xOf(r).done?'추가 증빙 '+xOf(r).state:EXTRA_LABEL)+'</span>':'')+'</td><td style="color:var(--orange)">'+esc(flag(r))+'</td></tr>').join('')+(list.length?'':'<tr><td colspan="7" class="empty">'+empty+'</td></tr>')+'</tbody></table></div><div class="note" style="margin-top:6px">줄을 누르면 출결판에서 그 칸을 바로 엽니다.</div></div>';
    $('#v').innerHTML=h;
    $('#all').onclick=()=>{S.onlyMissing=false;S.onlyExtra=false;vReason();};$('#mis').onclick=()=>{S.onlyMissing=true;S.onlyExtra=false;vReason();};$('#xev').onclick=()=>{S.onlyExtra=true;S.onlyMissing=false;vReason();};
    R.querySelectorAll('tr.click').forEach(tr=>tr.onclick=()=>{S.tab='board';S.custom=false;S.sel={n:tr.dataset.n,day:tr.dataset.d};S.f=Object.assign({},S.d.recs[S.sel.n+'|'+S.sel.day]);render();if(OPT.onTab)OPT.onTab('board');});
  }

  function vInfo(){
    const d=S.d,o=d.officer||{};
    // 2026-10-19: 제목·안내를 짧게, 줄마다 저장 단추를 누르기 쉬운 크기로(.ghost), 명부가 비면 한 줄 안내
    let h='<div class="card"><div class="sec">반 임원</div><div class="form"><label>반장<input class="in" id="o_l" value="'+esc(o.leader)+'"></label><label>부반장<input class="in" id="o_s" value="'+esc(o.sub)+'"></label><label>총무<input class="in" id="o_t" value="'+esc(o.treasurer)+'"></label><label class="wide">비고 (임원 변경 등)<input class="in" id="o_n" value="'+esc(o.note)+'"></label><button class="btn" id="o_save">임원 저장</button></div></div>';
    // 교육생 명부는 보기만(사용자 2026-10-20): 중도탈락·조기취업은 출결 › 중도탈락 탭(beta2-dropouts.mjs, 시트 중도탈락 탭)으로 등록하고 운영팀이 확인하면 명부 상태가 바뀝니다.
    // 담임이 여기서 상태를 바로 바꾸던 portalSetStatus는 쓰지 않습니다(api/teacher-beta.js가 담임에게는 막음).
    h+='<div class="card"><div class="sec">교육생 명부 ('+d.kids.length+'명)</div><div class="note" style="margin-bottom:8px">중도탈락·조기취업한 학생은 「출결 › 중도탈락」에서 등록해 주세요. 운영팀이 확인하면 상태가 바뀌고, 그 날짜 다음 교육일부터 출결판과 총원에서 빠집니다.</div>'+(OPT.onTab?'<button class="btn" id="goDropout" style="margin-bottom:10px">중도탈락·조기취업 등록하러 가기 →</button>':'')+'<div style="overflow-x:auto"><table class="list"><thead><tr><th>이름</th><th>상태</th><th>중도탈락·조기취업일</th><th></th></tr></thead><tbody>'+d.kids.map(k=>{const tag=k.status!=='재학'&&k.off?(k.off>d.mainDay?'<span style="color:var(--orange);font-weight:700">예정</span>':'<span style="color:var(--red);font-weight:700">적용</span>'):'';return '<tr><td>'+esc(k.name)+'</td><td>'+esc(k.status||'재학')+'</td><td>'+esc(k.status!=='재학'?k.off:'')+'</td><td>'+tag+'</td></tr>';}).join('')+(d.kids.length?'':'<tr><td colspan="4" class="empty">명부에 교육생이 없습니다. 운영팀에 알려 주세요.</td></tr>')+'</tbody></table></div></div>';
    $('#v').innerHTML=h;
    const gd=$('#goDropout');if(gd)gd.onclick=()=>OPT.onTab('dropout');
    $('#o_save').onclick=async()=>{try{await run('portalSaveOfficer',S.cls,S.pin,{leader:$('#o_l').value,sub:$('#o_s').value,treasurer:$('#o_t').value,note:$('#o_n').value});toast('저장했습니다');}catch(e){toast(e.message);}};
  }
  login();
  return { reload: () => reload(true), setClass: c => { OPT.cls = c; S.tab = OPT.tab || 'today'; S.sel = null; login(); },
    setTab: k => { if (S.tab === k || !TABS.some(t => t[0] === k)) return; if (S.d) { flush(); S.tab = k; render(); } else S.tab = k; } };
}

const TB_CSS = "\n:host{display:block;--navy:#073763;--ink:#1f1f1f;--ink2:#5f6368;--ink3:#80868b;--line:#dadce0;--line2:#9aa0a6;--blue:#1a73e8;--page:#f1f3f4;--red:#d93025;--orange:#e37400;--green:#188038;\n--ok:#f1f3f4;--okc:#5f6368;--lt:#fce8b2;--ltc:#7a4b00;--ab:#f4c7c3;--abc:#8c1d18;--rc:#b7e1cd;--rcc:#0d5c3c}\n*{box-sizing:border-box}\n#app{margin:0;color:var(--ink);font-size:14px;line-height:1.5}\nbutton,input,select,textarea{font:inherit;color:inherit}\n.bar{background:#fff;border:1px solid var(--line);padding:4px 12px;min-height:48px;display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;position:sticky;top:0;z-index:4}\n.bar .sub{font-size:13px;color:var(--ink2)}\n.bar .sp{flex:1}\n.beta{background:#ffd54f;color:#1f1f1f;font-weight:700;font-size:12px;padding:2px 8px;border-radius:3px}\n.bar #rf{background:#fff;border:1px solid var(--line2);color:var(--ink);border-radius:6px;padding:8px 14px;min-height:38px;cursor:pointer;font-size:13px}\nnav{display:flex;overflow-x:auto;max-width:100%}\nnav button{border:0;background:transparent;padding:10px 12px;cursor:pointer;color:var(--ink2);border-bottom:3px solid transparent;white-space:nowrap}\nnav button[aria-selected=true]{color:var(--ink);font-weight:700;border-bottom-color:var(--navy)}\nmain{padding:14px 0}\n.card{background:#fff;border:1px solid var(--line);padding:14px;margin-bottom:14px}\n.sec{font-size:16px;font-weight:700;margin:0 0 10px}\n.note{font-size:13px;line-height:1.55;color:var(--ink2)}\n.note.big{font-size:14px;color:var(--ink);margin-top:12px}\n.steps{margin:0 0 6px;padding-left:20px;font-size:13px;line-height:1.6}\n.login{max-width:380px;margin:60px auto}\n.login select,.login input{width:100%;padding:9px;border:1px solid var(--line2);border-radius:4px;margin-top:8px}\n.btn{background:var(--navy);color:#fff;border:0;border-radius:6px;padding:9px 16px;min-height:44px;cursor:pointer;font-weight:700;font-size:14px}\n.btn.go{display:inline-flex;align-items:center;margin-top:12px;padding:10px 22px;font-size:15px;background:var(--blue)}\n.ghost{padding:8px 14px;min-height:38px;border:1px solid var(--line2);border-radius:6px;background:#fff;cursor:pointer}\n.btn.block{width:100%;margin-top:10px}\n.err{color:var(--red);font-size:13px;margin-top:6px}\n.week{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));border:1px solid var(--line);overflow-x:auto}\n.wd{padding:8px 10px;border-right:1px solid var(--line);min-height:84px}\n.wd:last-child{border-right:0}\n.wd .h{font-size:12px;color:var(--ink2);border-bottom:3px solid #e00000;margin:-8px -10px 6px;padding:6px 10px 4px}\n.wd.now{background:#e8f0fe}.wd.off{background:var(--page);color:var(--ink3)}\n.wd .s{font-size:13px;font-weight:500}.wd .p{font-size:11px;color:var(--ink3)}\n.sum{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}\n.sum div{border:1px solid var(--line);padding:8px;text-align:center}\n.sum b{display:block;font-size:20px}\n.sum span{font-size:11px;color:var(--ink2)}\n.chips{display:flex;flex-wrap:wrap;gap:6px}\n.chip{border:1px solid var(--line2);background:#fff;padding:8px 14px;min-height:40px;border-radius:6px;cursor:pointer;font-size:14px}\n.chip[aria-pressed=true]{border:2px solid var(--blue);padding:7px 13px;color:var(--blue);font-weight:700}\n.chip.g[aria-pressed=true]{border-color:var(--green);color:var(--green)}\n.chip.r[aria-pressed=true]{border-color:var(--red);color:var(--red)}\n.chip.n[aria-pressed=true]{border-color:var(--line2);color:var(--ink2)}\n.ck{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-bottom:1px solid var(--line);padding:8px 0}\n.ck:last-child{border-bottom:0}\n.wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px}\n@media(max-width:900px){.wrap{grid-template-columns:1fr}}\n.scroll{overflow:auto;max-width:100%;border:1px solid var(--line);background:#fff;max-height:70vh}\ntable.g{border-collapse:separate;border-spacing:0;font-size:12px}\n.g th,.g td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center;white-space:nowrap;background:#fff;padding:0}\n.g thead th{position:sticky;top:0;z-index:2;padding:6px;font-weight:500;color:var(--ink2);border-top:3px solid #e00000;border-bottom:3px solid #e00000}\n.g .nm{position:sticky;left:0;z-index:1;text-align:left;padding:0 10px;min-width:80px}\n.g thead .nm{z-index:3}\n.g th.today,.g td.today{background:#e8f0fe}\n.g thead th small{display:block;font-size:11px;font-weight:700;color:var(--blue)}\n.g thead th.off{color:var(--ink3)}\n.g thead th small.tag{color:var(--ink3);font-weight:500}\n.anyday input{border:1px solid var(--line2);border-radius:6px;padding:4px 6px;font:inherit}\n.g button{all:unset;display:flex;align-items:center;justify-content:center;width:44px;height:30px;cursor:pointer}\n.g button.sel{outline:2px solid var(--blue);outline-offset:-2px}\n.code{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 4px;border-radius:3px;font-weight:700}\n.k-ok{background:#e6f4ea;color:#137333;font-weight:500}.k-na{background:#fff;color:#9aa0a6;font-weight:400}.k-lt{background:var(--lt);color:var(--ltc)}.k-ab{background:var(--ab);color:var(--abc)}.k-rc{background:var(--rc);color:var(--rcc)}\n.panel{background:#fff;border:1px solid var(--line);padding:14px;position:sticky;top:56px;align-self:start}\n.panel h2{margin:0;font-size:16px}\n.lab{font-size:12px;color:var(--ink2);margin:10px 0 4px}\n.in{width:100%;border:1px solid var(--line2);border-radius:6px;padding:9px 10px;min-height:40px}\n.g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}\n.memo{font-family:Consolas,Menlo,monospace;font-size:12px;background:var(--page);border:1px solid var(--line);padding:7px 8px;display:flex;justify-content:space-between;gap:6px;align-items:center;word-break:break-all;margin-top:10px}\n.memo button{border:1px solid var(--line2);background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}\n.status{font-size:12px;margin-top:8px;min-height:16px;color:var(--ink3)}.status.ok{color:var(--green)}.status.warn{color:var(--orange)}.status.err{color:var(--red)}\ntable.list{border-collapse:collapse;width:100%;font-size:13px}\n.list th{text-align:left;font-weight:500;color:var(--ink2);border-top:3px solid #e00000;border-bottom:3px solid #e00000;padding:6px 8px;white-space:nowrap}\n.list td{border-bottom:1px solid var(--line);padding:9px 8px;vertical-align:top}\n.list td.empty{color:var(--ink3);text-align:center;padding:18px 8px}\n.list tr.click{cursor:pointer}.list tr.click:hover td{background:#f8f9fa}\n.form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-items:end}\n.form label{font-size:12px;color:var(--ink2);display:flex;flex-direction:column;gap:3px}\n.form .wide{grid-column:1/-1}\n.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#202124;color:#fff;padding:9px 16px;border-radius:4px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.on{opacity:1}\n:host(.busy){opacity:.6;pointer-events:none}\n.g td.cell{padding:2px}\n.g select{appearance:none;-webkit-appearance:none;border:1px solid transparent;border-radius:4px;width:66px;height:34px;font-size:13px;font-weight:700;text-align:center;text-align-last:center;cursor:pointer;padding:0 2px}\n.g select:focus{outline:2px solid var(--blue);outline-offset:-1px}\n.g select.sel{outline:2px solid var(--blue);outline-offset:-1px}\n.g select.k-na{font-weight:400;border:1px dashed #dadce0}\n.rp{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}\n.rp select,.rp input{border:1px solid var(--line2);border-radius:6px;padding:7px 8px;min-height:40px;background:#fff;font-weight:600;min-width:0}\n.rp .b2-rmain{flex:1.4 1 0}.rp .b2-rsub{flex:1 1 0}.rp .b2-reason{flex:1 1 100%;font-weight:400}\n.rp select:focus,.rp input:focus{outline:2px solid var(--blue);outline-offset:-1px}\n.evb,.rn{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}.evb:empty,.rn:empty{display:none}.rn{margin-top:4px}\n.b2-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;background:#f1f5f9;color:#334155}\n.e-ok{background:#dcfce7;color:#166534}.e-miss{background:#fee2e2;color:#b91c1c}.e-none{background:#f1f5f9;color:#64748b}.e-extra{background:#ffedd5;color:#9a3412;box-shadow:inset 0 0 0 1px #fdba74}\n.b2-xnote{display:inline-block;padding:2px 8px;border-radius:6px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:12px;font-weight:800}\n.b2-err{color:var(--red);font-size:12px;font-weight:700}\n.b2-sub{display:block;width:100%;font-size:12px;color:var(--ink2)}\n.xb{display:inline-block;margin-top:3px;padding:1px 7px;border-radius:10px;background:#ffedd5;color:#9a3412;border:1px solid #fdba74;font-size:11px;font-weight:700;white-space:nowrap}\n.xb.ok{background:#dcfce7;color:#166534;border-color:#86efac}\n.qr{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}\n.qr button{border:1px solid var(--line2);background:#fff;border-radius:14px;padding:6px 12px;font-size:13px;cursor:pointer}\n.qr button.na{border-color:var(--navy);color:var(--navy);font-weight:700}\n";
