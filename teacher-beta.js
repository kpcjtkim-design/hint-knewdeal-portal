// 2기 베타 담임화면 (Vercel 운영포털 탭용 모듈)
// 사용: import { mountTeacherBeta } from './teacher-beta.js';
//       mountTeacherBeta(document.getElementById('beta-root'), { cls: 1, getToken: async () => idToken, endpoint: '/api/teacher-beta' });
// 화면·로직은 Apps Script 담임 포털과 동일. 데이터는 /api/teacher-beta → Apps Script → 마스터시트.
// Shadow DOM 안에 그려서 기존 포털 CSS와 서로 간섭하지 않습니다.
// 포털에 이미 있는 반 정보(머리글)·금주 시간표·만족도 집계는 기존 탭을 쓰고 여기서는 다시 그리지 않습니다.
export function mountTeacherBeta(el, OPT) {
  OPT = OPT || {};
  const R = el.shadowRoot || el.attachShadow({ mode: 'open' });
  R.innerHTML = '<style>' + TB_CSS + '</style><div id="app"></div><div class="toast" id="toast"></div>';
  const TYPES=['해당없음','출석','지각','조퇴','외출','결석','인정출석','인정지각','인정조퇴','인정외출'];
  const CODE={해당없음:['-','k-na'],출석:['출','k-ok'],지각:['지','k-lt'],조퇴:['조','k-lt'],외출:['외','k-lt'],결석:['결','k-ab'],인정출석:['인','k-rc'],인정지각:['인','k-rc'],인정조퇴:['인','k-rc'],인정외출:['인','k-rc']};
  const NEED={지각:'inT',인정지각:'inT',조퇴:'outT',인정조퇴:'outT',외출:'oa',인정외출:'oa'};
  const W='일월화수목금토';
  let S={cls:null,pin:'',d:null,tab:'today',sel:null,f:null,timer:null};
  const $=s=>R.querySelector(s), app=()=>$('#app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const md=s=>{if(!s)return'';const p=String(s).split('-');if(p.length<3)return s;const d=new Date(+p[0],+p[1]-1,+p[2]);return (+p[1])+'/'+(+p[2])+'('+W[d.getDay()]+')';};
  let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),1800);}
  async function run(fn,...a){const h={'Content-Type':'application/json'};const tk=OPT.getToken?await OPT.getToken():'';if(tk)h.Authorization='Bearer '+tk;const r=await fetch(OPT.endpoint||'/api/teacher-beta',{method:'POST',headers:h,body:JSON.stringify({action:fn,args:a,cls:S.cls})});const j=await r.json().catch(()=>({ok:false,error:'응답 오류'}));if(!j.ok)throw Object.assign(new Error(j.error||'요청 실패'),{code:j.code});return j.data;}

  async function login(){
    app().innerHTML='<div class="card" style="margin:20px"><div class="sec">2기 베타 담임화면</div><div class="note">불러오는 중…</div></div>';
    S.cls=Number(OPT.cls);S.pin='';
    try{S.d=await run('portalData',S.cls,'');render();}catch(err){const wait=err.code==='NOT_CONFIGURED';app().innerHTML='<div class="card" style="margin:20px"><div class="sec">'+(wait?'2기 베타 준비 중':'불러오지 못했습니다')+'</div><div class="'+(wait?'note':'err')+'">'+esc(err.message)+'</div></div>';}
  }
  async function reload(keep){try{S.d=await run('portalData',S.cls,S.pin);if(!keep)S.sel=null;render();}catch(e){toast(e.message);}}

  const TABS=[['today','오늘'],['board','출결판'],['reason','출결사유'],['eval','학습자 평가'],['voc','민원·이슈'],['info','반 정보']];
  function render(){
    const d=S.d;
    // 반·과정·담임은 포털 머리글에 이미 있으므로 하위 메뉴와 기준일만 한 줄로 둡니다.
    let h='<header class="bar"><nav>'+TABS.map(([k,l])=>'<button data-tab="'+k+'" aria-selected="'+(S.tab===k)+'">'+l+'</button>').join('')+'</nav><span class="sp"></span><span class="sub">기준일 <b>'+md(d.mainDay)+'</b></span><span class="beta">2기 베타</span><button id="rf">새로고침</button></header><main id="v"></main>';
    app().innerHTML=h;
    $('#rf').onclick=()=>reload(true);
    R.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{flush();S.tab=b.dataset.tab;render();});
    ({today:vToday,board:vBoard,reason:vReason,eval:vEval,voc:vVoc,info:vInfo})[S.tab]();
  }

  function vToday(){
    const d=S.d;
    let h='<div class="card"><div class="sec">오늘 출결 ('+md(d.mainDay)+')</div><div class="sum">'+d.summary.filter(x=>x.k!=='당일 마감').map(x=>'<div><b>'+esc(x.v)+'</b><span>'+esc(x.k)+'</span></div>').join('')+'</div>';
    const todo=d.kids.filter(k=>!(k.off&&d.mainDay>k.off)&&!d.recs[k.name+'|'+d.mainDay]).length;h+='<div class="note" style="margin-top:8px">오늘 아직 입력 전(해당없음): <b style="color:var(--orange)">'+todo+'명</b> · 출결판에서 출석까지 모두 체크해 주세요.</div>';
    h+='<div class="lab">당일 마감 (학습 종료 직후 숫자 확인)</div><div class="chips"><button class="chip g" data-close="확인" aria-pressed="'+(d.closed==='확인')+'">확인</button><button class="chip n" data-close="미확인" aria-pressed="'+(d.closed!=='확인')+'">미확인</button></div></div>';
    h+='<div class="card"><div class="sec">현장운영 체크리스트</div>'+d.checks.map(s=>'<div class="lab" style="font-weight:700;color:var(--ink)">'+esc(s.label)+'</div>'+s.items.map(it=>'<div class="ck"><span>'+esc(it.text)+'</span><span class="chips">'+[['완료','g'],['미완료','r'],['해당없음','n']].map(([v,c])=>'<button class="chip '+c+'" data-row="'+it.row+'" data-v="'+v+'" aria-pressed="'+(it.value===v)+'">'+v+'</button>').join('')+'</span></div>').join('')).join('')+'</div>';
    $('#v').innerHTML=h;
    R.querySelectorAll('[data-close]').forEach(b=>b.onclick=async()=>{const v=b.dataset.close;S.d.closed=v;vToday();try{await run('portalClose',S.cls,S.pin,v);toast('당일 마감: '+v);}catch(e){toast(e.message);}});
    R.querySelectorAll('[data-row]').forEach(b=>b.onclick=async()=>{const row=+b.dataset.row,v=b.dataset.v;let nv='';S.d.checks.forEach(s=>s.items.forEach(it=>{if(it.row===row){it.value=it.value===v?'':v;nv=it.value;}}));vToday();try{await run('portalCheck',S.cls,S.pin,row,nv);}catch(e){toast(e.message);}});
  }

  function cellVal(n,day){const k=S.d.kids.find(x=>x.name===n);if(k&&k.off&&day>k.off)return null;const r=S.d.recs[n+'|'+day];return r?r.type:'해당없음';}
  function vBoard(){
    const d=S.d,days=d.days;
    let h='<div class="wrap"><div><div class="note" style="margin-bottom:6px">입력 전 칸은 「해당없음」으로 비어 있습니다. 칸의 드롭다운으로 출석·지각 등을 고르면 바로 저장됩니다. 사유·시간은 오른쪽(모바일은 아래)에서 선택 입력하며, 사유가 없으면 「해당없음」을 누르세요.</div><div class="scroll"><table class="g"><thead><tr><th class="nm">이름</th>'+days.map((x,i)=>'<th class="'+(i===0?'today':'')+'">'+md(x)+'</th>').join('')+'</tr></thead><tbody>';
    d.kids.forEach(k=>{h+='<tr><td class="nm">'+esc(k.name)+(k.status!=='재학'?' <span class="note">'+esc(k.status)+'</span>':'')+'</td>';
      days.forEach((x,i)=>{const v=cellVal(k.name,x);if(v===null){h+='<td class="'+(i===0?'today':'')+'"></td>';return;}const c=CODE[v]||['-','k-na'];const sel=S.sel&&S.sel.n===k.name&&S.sel.day===x?' sel':'';const r=d.recs[k.name+'|'+x];const miss=r&&(r.ev==='미제출'||r.ev==='반려'||(!r.ev&&String(r.type).indexOf('인정')===0))?' *':'';
        h+='<td class="cell '+(i===0?'today':'')+'"><select class="'+c[1]+sel+'" data-n="'+esc(k.name)+'" data-d="'+x+'" title="'+esc(k.name)+' '+md(x)+'">'+TYPES.map(t=>'<option value="'+t+'"'+(t===v?' selected':'')+'>'+t+(t===v?miss:'')+'</option>').join('')+'</select></td>';});
      h+='</tr>';});
    h+='</tbody></table></div><div class="note" style="margin-top:6px">* 는 증빙 미제출·반려 (본사 확인 중)</div></div><div class="panel" id="pn"></div></div>';
    $('#v').innerHTML=h;
    const pick=(el,keepType)=>{flush();S.sel={n:el.dataset.n,day:el.dataset.d};const r=S.d.recs[S.sel.n+'|'+S.sel.day];S.f=r?Object.assign({},r):{type:'해당없음',inT:'',outT:'',oa:'',ob:'',r:''};R.querySelectorAll('.g select.sel').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');};
    R.querySelectorAll('.g select').forEach(el=>{
      el.onfocus=()=>{if(!(S.sel&&S.sel.n===el.dataset.n&&S.sel.day===el.dataset.d)){pick(el);panel(true);}};
      el.onchange=()=>{pick(el);S.f.type=el.value;paint(el,el.value);panel();save();if(innerWidth<=900)$('#pn').scrollIntoView({behavior:'smooth'});};
    });
    panel();
  }
  function paint(el,v){const c=CODE[v]||['-','k-na'];el.className=c[1]+' sel';}
  function memo(){const f=S.f,t=S.d.teacher||'담임',tm=x=>x||'--:--';if(!f||f.type==='출석'||f.type==='해당없음'||f.type==='결석')return'';
    if(f.type==='지각')return'지각_담임:'+t+'('+tm(f.inT)+')';if(f.type==='조퇴')return'조퇴_담임:'+t+'('+tm(f.outT)+')';if(f.type==='외출')return'외출_담임:'+t+'('+tm(f.oa)+'~'+tm(f.ob)+')';
    const r=f.r||'사유';if(f.type==='인정출석')return'(인정출석)'+r+'_담임:'+t;if(f.type==='인정지각')return'(인정지각)'+r+'_담임:'+t+'('+tm(f.inT)+')';if(f.type==='인정조퇴')return'(인정조퇴)'+r+'_담임:'+t+'('+tm(f.outT)+')';return'(인정외출)'+r+'_담임:'+t+'('+tm(f.oa)+'~'+tm(f.ob)+')';}
  function panel(noFocus){
    const p=$('#pn');if(!p)return;
    if(!S.sel){p.innerHTML='<h2>출결 입력</h2><div class="note" style="margin-top:6px">출결판에서 학생 칸을 눌러 주세요. 입력 전 칸은 해당없음으로 표시됩니다.</div>';return;}
    const f=S.f,need=NEED[f.type]||'',warn=x=>' style="border-color:var(--orange)"';
    let h='<h2>'+esc(S.sel.n)+'</h2><div class="note">'+md(S.sel.day)+(S.sel.day===S.d.mainDay?' · 오늘':'')+'</div><div class="lab">유형</div><div class="chips">'+TYPES.map(t=>'<button class="chip" data-t="'+t+'" aria-pressed="'+(f.type===t)+'">'+t+'</button>').join('')+'</div>';
    if(f.type==='해당없음')h+='<div class="note" style="margin-top:10px">아직 입력 전입니다. 위에서 출석 또는 다른 유형을 고르세요.</div>';
    if(f.type!=='출석'&&f.type!=='해당없음'){
      h+='<div class="lab">사유 (선택 · Enter로 저장)</div><input class="in" id="r" value="'+esc(f.r)+'" placeholder="병원 진료, 교통 지연, 면접…"><div class="qr">'+['해당없음','개인일정','병결','면접','교통사정','예비군'].map(q=>'<button class="'+(q==='해당없음'?'na':'')+'" data-q="'+q+'">'+q+'</button>').join('')+'</div>';
      h+='<div class="g2"><div><div class="lab">입실</div><input class="in" type="time" id="inT" value="'+esc(f.inT)+'"'+(need==='inT'&&!f.inT?warn():'')+'></div><div><div class="lab">퇴실</div><input class="in" type="time" id="outT" value="'+esc(f.outT)+'"'+(need==='outT'&&!f.outT?warn():'')+'></div>';
      h+='<div><div class="lab">외출 시작</div><input class="in" type="time" id="oa" value="'+esc(f.oa)+'"'+(need==='oa'&&!f.oa?warn():'')+'></div><div><div class="lab">외출 종료</div><input class="in" type="time" id="ob" value="'+esc(f.ob)+'"'+(need==='oa'&&!f.ob?warn():'')+'></div></div>';
      const m=memo();if(m)h+='<div class="memo"><span id="mm">'+esc(m)+'</span><button id="cp">복사</button></div>';
      if(f.type.indexOf('인정')===0)h+='<div class="note" style="margin-top:8px">증빙: '+esc(f.ev||'미제출')+(f.evr?' · '+esc(f.evr):'')+' (본사 확인)</div>';
    }
    h+='<div class="status" id="st"></div>';
    p.innerHTML=h;
    p.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{S.f.type=b.dataset.t;const el=R.querySelector('.g select[data-n="'+window.CSS.escape(S.sel.n)+'"][data-d="'+S.sel.day+'"]');if(el){el.value=S.f.type;paint(el,S.f.type);}panel();save();});
    p.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{S.f.r=b.dataset.q;const r=$('#r');if(r)r.value=S.f.r;const m=$('#mm');if(m)m.textContent=memo();save();});
    ['r','inT','outT','oa','ob'].forEach(id=>{const el=$('#'+id);if(!el)return;el.oninput=()=>{S.f[id]=el.value;const m=$('#mm');if(m)m.textContent=memo();later();};el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save();el.blur();}};});
    const c=$('#cp');if(c)c.onclick=()=>navigator.clipboard.writeText(memo()).then(()=>toast('메모를 복사했습니다'),()=>toast('직접 선택해 복사해 주세요'));
    const r=$('#r');if(r&&!r.value&&!noFocus)r.focus();
  }
  function st(t,k){const s=$('#st');if(s){s.textContent=t;s.className='status'+(k?' '+k:'');}}
  function later(){st('입력 중…');clearTimeout(S.timer);S.timer=setTimeout(save,700);}
  function flush(){if(S.timer){clearTimeout(S.timer);S.timer=null;save();}}
  async function save(){
    clearTimeout(S.timer);S.timer=null;if(!S.sel)return;
    const sel=S.sel,f=Object.assign({},S.f);
    st('저장 중…');
    try{const res=await run('portalSave',{cls:S.cls,pin:S.pin,name:sel.n,date:sel.day,type:f.type,inT:f.inT,outT:f.outT,oa:f.oa,ob:f.ob,r:f.r});
      if(!res.ok){st(res.msg,'err');return;}
      const key=sel.n+'|'+sel.day;if(f.type==='해당없음')delete S.d.recs[key];else S.d.recs[key]=Object.assign({ev:'',evr:''},S.d.recs[key]||{},f);
      const b=R.querySelector('.g select[data-n="'+window.CSS.escape(sel.n)+'"][data-d="'+sel.day+'"]');if(b&&b.value!==f.type){b.value=f.type;paint(b,f.type);}
      if(S.sel===sel)st(res.warn?'저장됨 · '+res.warn:'저장됨',res.warn?'warn':'ok');
    }catch(e){st('저장하지 못했습니다: '+e.message,'err');}
  }

  function vReason(){
    const d=S.d,rows=Object.entries(d.recs).filter(([k,r])=>r.type!=='출석').map(([k,r])=>{const i=k.lastIndexOf('|');return Object.assign({n:k.slice(0,i),day:k.slice(i+1)},r);}).sort((a,b)=>b.day.localeCompare(a.day)||a.n.localeCompare(b.n));
    const flag=r=>{const w=[];if(NEED[r.type]==='inT'&&!r.inT)w.push('입실 시간');if(NEED[r.type]==='outT'&&!r.outT)w.push('퇴실 시간');if(NEED[r.type]==='oa'&&(!r.oa||!r.ob))w.push('외출 구간');if(String(r.type).indexOf('인정')===0&&!r.r)w.push('사유');return w.join('·');};
    const only=S.onlyMissing,list=only?rows.filter(r=>flag(r)):rows;
    let h='<div class="card"><div class="sec">출결사유 (가-3)</div><div class="chips" style="margin-bottom:10px"><button class="chip" id="all" aria-pressed="'+(!only)+'">전체 '+rows.length+'</button><button class="chip" id="mis" aria-pressed="'+(!!only)+'">빠진 항목 '+rows.filter(r=>flag(r)).length+'</button></div>';
    h+='<div style="overflow-x:auto"><table class="list"><thead><tr><th>일자</th><th>이름</th><th>유형</th><th>시간</th><th>사유</th><th>증빙</th><th>빠진 항목</th></tr></thead><tbody>'+list.map(r=>'<tr class="click" data-n="'+esc(r.n)+'" data-d="'+r.day+'"><td>'+md(r.day)+'</td><td>'+esc(r.n)+'</td><td>'+esc(r.type)+'</td><td>'+[r.inT&&'입실 '+r.inT,r.outT&&'퇴실 '+r.outT,r.oa&&'외출 '+r.oa+'~'+(r.ob||'')].filter(Boolean).join(' ')+'</td><td>'+esc(r.r)+'</td><td>'+esc(r.ev||(String(r.type).indexOf('인정')===0?'미제출':''))+'</td><td style="color:var(--orange)">'+esc(flag(r))+'</td></tr>').join('')+'</tbody></table></div><div class="note" style="margin-top:6px">줄을 누르면 출결판에서 그 칸을 바로 엽니다.</div></div>';
    $('#v').innerHTML=h;
    $('#all').onclick=()=>{S.onlyMissing=false;vReason();};$('#mis').onclick=()=>{S.onlyMissing=true;vReason();};
    R.querySelectorAll('tr.click').forEach(tr=>tr.onclick=()=>{S.tab='board';S.sel={n:tr.dataset.n,day:tr.dataset.d};S.f=Object.assign({},S.d.recs[S.sel.n+'|'+S.sel.day]);render();});
  }

  function vEval(){
    const d=S.d;
    let h='<div class="card"><div class="sec">학습자 평가</div><div class="form"><label>평가일<input class="in" type="date" id="e_date"></label><label class="wide">평가 과목<input class="in" id="e_subj" placeholder="직무특화_자동차개론"></label><label>응시인원<input class="in" type="number" id="e_n"></label><label>평균점수<input class="in" type="number" step="0.1" id="e_avg"></label><label>최고점<input class="in" type="number" id="e_max"></label><label>최저점<input class="in" type="number" id="e_min"></label><label class="wide">비고<input class="in" id="e_note"></label><button class="btn" id="e_add">추가</button></div>';
    h+='<div style="overflow-x:auto"><table class="list" style="margin-top:12px"><thead><tr><th>평가일</th><th>과목</th><th>응시</th><th>평균</th><th>최고</th><th>최저</th><th>비고</th></tr></thead><tbody>'+(d.evals.length?d.evals.map(x=>'<tr><td>'+md(x.v[1])+'</td><td>'+esc(x.v[2])+'</td><td>'+esc(x.v[3])+'</td><td>'+esc(x.v[4])+'</td><td>'+esc(x.v[5])+'</td><td>'+esc(x.v[6])+'</td><td>'+esc(x.v[7])+'</td></tr>').join(''):'<tr><td colspan="7" class="note">아직 기록이 없습니다.</td></tr>')+'</tbody></table></div><div class="note" style="margin-top:8px">만족도 결과는 「만족도조사」 탭에서 설문 응답으로 자동 집계되므로 여기서 따로 입력하지 않습니다.</div></div>';
    $('#v').innerHTML=h;
    const g=id=>$('#'+id).value;
    $('#e_add').onclick=()=>{if(!g('e_subj')){toast('평가 과목을 적어 주세요');return;}addRow('EVAL',{date:g('e_date'),subj:g('e_subj'),n:g('e_n'),avg:g('e_avg'),max:g('e_max'),min:g('e_min'),note:g('e_note')});};
  }
  async function addRow(kind,vals){R.host.classList.add('busy');try{await run('portalAddRow',S.cls,S.pin,kind,vals);toast('추가했습니다');await reload(true);}catch(e){toast(e.message);}R.host.classList.remove('busy');}

  function vVoc(){
    const d=S.d,today=new Date().toLocaleDateString('sv-SE');
    let h='<div class="card"><div class="sec">민원·이슈 접수</div><div class="form"><label>접수일<input class="in" type="date" id="v_date" value="'+today+'"></label><label>유형<select class="in" id="v_type">'+['해당없음','수업·강사','시설·환경','출결','행정·서류','교육생 고충','안전','기타'].map(x=>'<option>'+x+'</option>').join('')+'</select></label><label>상태<select class="in" id="v_status"><option>접수</option><option>처리중</option><option>완료</option><option>보류</option><option>해당없음</option></select></label><label class="wide">상세내용<textarea class="in" id="v_detail" rows="2"></textarea></label><label class="wide">조치내용<textarea class="in" id="v_action" rows="2"></textarea></label><button class="btn" id="v_add">접수</button></div></div>';
    h+='<div class="card"><div class="sec">접수 내역</div><div style="overflow-x:auto"><table class="list"><thead><tr><th>접수일</th><th>유형</th><th>내용</th><th>상태</th><th>조치</th><th>경과</th></tr></thead><tbody>'+(d.vocs.length?d.vocs.map(x=>'<tr><td>'+md(x.v[0])+'</td><td>'+esc(x.v[4])+'</td><td>'+esc(x.v[5])+'</td><td><select class="in" data-vr="'+x.row+'" style="padding:3px">'+['접수','처리중','완료','보류','해당없음'].map(s=>'<option'+(x.v[6]===s?' selected':'')+'>'+s+'</option>').join('')+'</select></td><td><input class="in" data-va="'+x.row+'" value="'+esc(x.v[7])+'" placeholder="조치내용" style="padding:4px 6px"></td><td>'+esc(x.v[9])+(x.v[9]!==''?'일':'')+'</td></tr>').join(''):'<tr><td colspan="6" class="note">접수된 민원·이슈가 없습니다.</td></tr>')+'</tbody></table></div><div class="note" style="margin-top:6px">상태를 바꾸거나 조치내용을 적으면 바로 저장됩니다. 완료로 바꾸면 처리일이 오늘로 들어갑니다.</div></div>';
    $('#v').innerHTML=h;
    $('#v_add').onclick=()=>{const g=id=>$('#'+id).value;if(!g('v_detail')){toast('상세내용을 적어 주세요');return;}addRow('VOC',{date:g('v_date'),type:g('v_type'),status:g('v_status'),detail:g('v_detail'),action:g('v_action')});};
    const upd=async row=>{const s=R.querySelector('[data-vr="'+row+'"]').value,a=R.querySelector('[data-va="'+row+'"]').value;try{await run('portalUpdateVoc',S.cls,S.pin,Number(row),{status:s,action:a});toast('저장했습니다');}catch(e){toast(e.message);}};
    R.querySelectorAll('[data-vr]').forEach(el=>el.onchange=()=>upd(el.dataset.vr));
    R.querySelectorAll('[data-va]').forEach(el=>el.onchange=()=>upd(el.dataset.va));
  }

  function vInfo(){
    const d=S.d,o=d.officer||{};
    let h='<div class="card"><div class="sec">반 운영 정보</div><div class="form"><label>반장<input class="in" id="o_l" value="'+esc(o.leader)+'"></label><label>부반장<input class="in" id="o_s" value="'+esc(o.sub)+'"></label><label>총무<input class="in" id="o_t" value="'+esc(o.treasurer)+'"></label><label class="wide">비고 (임원 변경 등)<input class="in" id="o_n" value="'+esc(o.note)+'"></label><button class="btn" id="o_save">저장</button></div></div>';
    h+='<div class="card"><div class="sec">교육생 명부 · 중도포기 설정 ('+d.kids.length+'명)</div><div class="note" style="margin-bottom:8px">중도탈락·조기취업 학생은 상태와 포기(예정)일을 넣고 저장하세요. 그 날짜 다음 교육일부터 출결판에서 빠지고 총원에서도 제외됩니다. 미래 날짜를 넣으면 예정으로 표시됩니다.</div><div style="overflow-x:auto"><table class="list"><thead><tr><th>이름</th><th>상태</th><th>포기(예정)일</th><th></th><th></th></tr></thead><tbody>'+d.kids.map((k,i)=>{const tag=k.status!=='재학'&&k.off?(k.off>d.mainDay?'<span style="color:var(--orange);font-weight:700">예정</span>':'<span style="color:var(--red);font-weight:700">적용</span>'):'';return '<tr><td>'+esc(k.name)+'</td><td><select class="in" id="ks'+i+'" style="padding:4px;min-width:96px">'+['재학','중도탈락','조기취업'].map(s=>'<option'+(k.status===s?' selected':'')+'>'+s+'</option>').join('')+'</select></td><td><input class="in" type="date" id="kd'+i+'" value="'+esc(k.off)+'" style="padding:4px;min-width:130px"></td><td><button class="ghost" data-k="'+i+'" style="padding:4px 10px;border:1px solid var(--line2);border-radius:4px;background:#fff;cursor:pointer">저장</button></td><td>'+tag+'</td></tr>';}).join('')+'</tbody></table></div></div>';
    $('#v').innerHTML=h;
    R.querySelectorAll('[data-k]').forEach(b=>b.onclick=async()=>{const i=+b.dataset.k,k=d.kids[i],s=$('#ks'+i).value,dt=$('#kd'+i).value;if(s!=='재학'&&!dt){toast('포기(예정)일을 넣어 주세요');return;}if(s!=='재학'&&!confirm(k.name+' 학생을 '+s+'('+dt+')로 저장할까요? 그 다음 교육일부터 출결판에서 빠집니다.'))return;R.host.classList.add('busy');try{await run('portalSetStatus',S.cls,S.pin,k.name,s,s==='재학'?'':dt);toast('저장했습니다');await reload(true);}catch(e){toast(e.message);}R.host.classList.remove('busy');});
    $('#o_save').onclick=async()=>{try{await run('portalSaveOfficer',S.cls,S.pin,{leader:$('#o_l').value,sub:$('#o_s').value,treasurer:$('#o_t').value,note:$('#o_n').value});toast('저장했습니다');}catch(e){toast(e.message);}};
  }
  login();
  return { reload: () => reload(true), setClass: c => { OPT.cls = c; S.tab = 'today'; S.sel = null; login(); } };
}

const TB_CSS = "\n:host{display:block;--navy:#073763;--ink:#1f1f1f;--ink2:#5f6368;--ink3:#80868b;--line:#dadce0;--line2:#9aa0a6;--blue:#1a73e8;--page:#f1f3f4;--red:#d93025;--orange:#e37400;--green:#188038;\n--ok:#f1f3f4;--okc:#5f6368;--lt:#fce8b2;--ltc:#7a4b00;--ab:#f4c7c3;--abc:#8c1d18;--rc:#b7e1cd;--rcc:#0d5c3c}\n*{box-sizing:border-box}\n#app{margin:0;color:var(--ink);font-size:14px;line-height:1.5}\nbutton,input,select,textarea{font:inherit;color:inherit}\n.bar{background:#fff;border:1px solid var(--line);padding:0 10px;display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;position:sticky;top:0;z-index:4}\n.bar .sub{font-size:12px;color:var(--ink2)}\n.bar .sp{flex:1}\n.beta{background:#ffd54f;color:#1f1f1f;font-weight:700;font-size:12px;padding:2px 8px;border-radius:3px}\n.bar #rf{background:#fff;border:1px solid var(--line2);color:var(--ink);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:12px}\nnav{display:flex;overflow-x:auto;max-width:100%}\nnav button{border:0;background:transparent;padding:10px 12px;cursor:pointer;color:var(--ink2);border-bottom:3px solid transparent;white-space:nowrap}\nnav button[aria-selected=true]{color:var(--ink);font-weight:700;border-bottom-color:var(--navy)}\nmain{padding:14px 0}\n.card{background:#fff;border:1px solid var(--line);padding:14px;margin-bottom:14px}\n.sec{font-size:15px;font-weight:700;margin:0 0 10px}\n.note{font-size:12px;color:var(--ink3)}\n.login{max-width:380px;margin:60px auto}\n.login select,.login input{width:100%;padding:9px;border:1px solid var(--line2);border-radius:4px;margin-top:8px}\n.btn{background:var(--navy);color:#fff;border:0;border-radius:4px;padding:9px 14px;cursor:pointer;font-weight:700}\n.btn.block{width:100%;margin-top:10px}\n.err{color:var(--red);font-size:13px;margin-top:6px}\n.week{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));border:1px solid var(--line);overflow-x:auto}\n.wd{padding:8px 10px;border-right:1px solid var(--line);min-height:84px}\n.wd:last-child{border-right:0}\n.wd .h{font-size:12px;color:var(--ink2);border-bottom:3px solid #e00000;margin:-8px -10px 6px;padding:6px 10px 4px}\n.wd.now{background:#e8f0fe}.wd.off{background:var(--page);color:var(--ink3)}\n.wd .s{font-size:13px;font-weight:500}.wd .p{font-size:11px;color:var(--ink3)}\n.sum{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}\n.sum div{border:1px solid var(--line);padding:8px;text-align:center}\n.sum b{display:block;font-size:20px}\n.sum span{font-size:11px;color:var(--ink2)}\n.chips{display:flex;flex-wrap:wrap;gap:6px}\n.chip{border:1px solid var(--line2);background:#fff;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:13px}\n.chip[aria-pressed=true]{border:2px solid var(--blue);padding:4px 9px;color:var(--blue);font-weight:700}\n.chip.g[aria-pressed=true]{border-color:var(--green);color:var(--green)}\n.chip.r[aria-pressed=true]{border-color:var(--red);color:var(--red)}\n.chip.n[aria-pressed=true]{border-color:var(--line2);color:var(--ink2)}\n.ck{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-bottom:1px solid var(--line);padding:8px 0}\n.ck:last-child{border-bottom:0}\n.wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px}\n@media(max-width:900px){.wrap{grid-template-columns:1fr}}\n.scroll{overflow:auto;max-width:100%;border:1px solid var(--line);background:#fff;max-height:70vh}\ntable.g{border-collapse:separate;border-spacing:0;font-size:12px}\n.g th,.g td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center;white-space:nowrap;background:#fff;padding:0}\n.g thead th{position:sticky;top:0;z-index:2;padding:6px;font-weight:500;color:var(--ink2);border-top:3px solid #e00000;border-bottom:3px solid #e00000}\n.g .nm{position:sticky;left:0;z-index:1;text-align:left;padding:0 10px;min-width:80px}\n.g thead .nm{z-index:3}\n.g th.today,.g td.today{background:#e8f0fe}\n.g button{all:unset;display:flex;align-items:center;justify-content:center;width:44px;height:30px;cursor:pointer}\n.g button.sel{outline:2px solid var(--blue);outline-offset:-2px}\n.code{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 4px;border-radius:3px;font-weight:700}\n.k-ok{background:#e6f4ea;color:#137333;font-weight:500}.k-na{background:#fff;color:#9aa0a6;font-weight:400}.k-lt{background:var(--lt);color:var(--ltc)}.k-ab{background:var(--ab);color:var(--abc)}.k-rc{background:var(--rc);color:var(--rcc)}\n.panel{background:#fff;border:1px solid var(--line);padding:14px;position:sticky;top:56px;align-self:start}\n.panel h2{margin:0;font-size:16px}\n.lab{font-size:12px;color:var(--ink2);margin:10px 0 4px}\n.in{width:100%;border:1px solid var(--line2);border-radius:4px;padding:7px 8px}\n.g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}\n.memo{font-family:Consolas,Menlo,monospace;font-size:12px;background:var(--page);border:1px solid var(--line);padding:7px 8px;display:flex;justify-content:space-between;gap:6px;align-items:center;word-break:break-all;margin-top:10px}\n.memo button{border:1px solid var(--line2);background:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px}\n.status{font-size:12px;margin-top:8px;min-height:16px;color:var(--ink3)}.status.ok{color:var(--green)}.status.warn{color:var(--orange)}.status.err{color:var(--red)}\ntable.list{border-collapse:collapse;width:100%;font-size:13px}\n.list th{text-align:left;font-weight:500;color:var(--ink2);border-top:3px solid #e00000;border-bottom:3px solid #e00000;padding:6px 8px;white-space:nowrap}\n.list td{border-bottom:1px solid var(--line);padding:7px 8px;vertical-align:top}\n.list tr.click{cursor:pointer}.list tr.click:hover td{background:#f8f9fa}\n.form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-items:end}\n.form label{font-size:12px;color:var(--ink2);display:flex;flex-direction:column;gap:3px}\n.form .wide{grid-column:1/-1}\n.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#202124;color:#fff;padding:9px 16px;border-radius:4px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.on{opacity:1}\n:host(.busy){opacity:.6;pointer-events:none}\n.g td.cell{padding:2px}\n.g select{appearance:none;-webkit-appearance:none;border:1px solid transparent;border-radius:3px;width:58px;height:26px;font-size:12px;font-weight:700;text-align:center;text-align-last:center;cursor:pointer;padding:0 2px}\n.g select:focus{outline:2px solid var(--blue);outline-offset:-1px}\n.g select.sel{outline:2px solid var(--blue);outline-offset:-1px}\n.g select.k-na{font-weight:400;border:1px dashed #dadce0}\n.qr{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}\n.qr button{border:1px solid var(--line2);background:#fff;border-radius:12px;padding:2px 9px;font-size:12px;cursor:pointer}\n.qr button.na{border-color:var(--navy);color:var(--navy);font-weight:700}\n";
