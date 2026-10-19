// 연결 프로그램의 이 PC 화면(127.0.0.1:8766/setup, 2기 처음 설치 — 포털 아님): 로그인·마스킹 상태, 반→체크히어 강의 연결, 명단 불러오기,
// 해제한 동안 반별 확인(맞음·명단에 없음·명단에만·겹침) → 사람이 고치고 「이 반 확인」, 내보내기(CSV·표 복사). 등록은 운영포털 실시간 화면(승인 계정)에서 합니다.
// 연결 프로그램 /api/setup/*·/api/unmask/*·/api/connect만 부릅니다(이 PC 주소에서만 받음). 이름은 이 화면에만 그리고 저장·기록하지 않습니다.
import {COHORT,CLASS_IDS,inPeriod,trainingDays} from './cohort-bridge.mjs';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let key='',state=null,lectures=[],selected=CLASS_IDS[0],unmaskStage=null,poll=null;const excluded=new Map();
const STATUS={matched:['ok','맞음'],paired:['ok','직접 짝'],unmatched:['warn','명단에 없음'],checkhere:['muted','체크히어 명단'],ambiguous:['bad','겹침'],noid:['bad','학생 번호 없음']};
const REASON={none:'명단에 맞는 학생 없음',many:'명단에 같은 첫 글자·끝 4자리가 여럿',today:'그날 표에 같은 모양이 둘',taken:'맞는 학생이 이미 다른 번호와 연결됨'};
const LECTURE={manual:'직접 연결',rule:'이름 규칙',config:'설정'};
async function api(path,body,{raw=false}={}){
  const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'x-hint-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  if(raw&&r.ok)return r.text();
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'연결 프로그램 응답 오류');return j;
}
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const firstDay=()=>{const t=today(),days=trainingDays();return inPeriod(t)?(days.filter(d=>d<=t).at(-1)||days[0]):t<COHORT.period.start?days[0]:days.at(-1);};
const when=v=>v?new Date(v).toLocaleString('ko-KR',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const sameName=(shown,name)=>{const p=String(shown||'').split('*')[0].trim();return !!p&&(shown.includes('*')?name.startsWith(p):shown.trim()===name);};
const cls=id=>state.classes.find(c=>c.classId===id);
function paintTop(){
  const c=state.cohort,m=state.mode;
  $('#cohort').innerHTML=`${esc(c.label)} · 교육 기간 ${esc(c.period.start)} ~ ${esc(c.period.end)}(교육일 ${c.trainingDays}일, 휴일 ${c.holidays.map(esc).join('·')}) · 포트 ${c.port} · build ${esc(c.build)} · 강의 이름 규칙 <b>${esc(c.lectureNameRule)}</b> · Firebase ${c.firebaseReady?'<span class="ok">설정됨</span>':'<span class="bad">2기 설정 필요(승인·반영·등록 멈춤, 수집은 됨)</span>'}`;
  $('#mode').innerHTML=`${m.on?'<span class="pill">처음 설치 모드</span> 연결 프로그램 첫 화면 대신 이 화면이 열립니다.':m.allRegistered?'<span class="pill">설치 끝</span> 16개 반이 모두 등록됐습니다.':'<span class="pill">설치 모드 꺼짐</span>'} <button id="modeBtn">${m.on?'처음 설치 모드 끝내기':'처음 설치 모드 다시 켜기'}</button>`;
  $('#modeBtn').onclick=()=>run($('#modeBtn'),async()=>{state=await api('setup/mode',{on:!state.mode.on});paint();return '';},'#connNote');
  $('#connNote').textContent=state.connected?'체크히어 로그인됨':'체크히어 로그인 전(전용 크롬에서 로그인)';
  const p=state.privacy,mk=state.masking;$('#privacy').textContent=p?.text||'체크히어 해제 상태 확인 중';
  $('#unmask').innerHTML=unmaskStage==='code'?`<div class="line"><label style="margin:0">메일로 받은 인증번호 <input id="code" inputmode="numeric" maxlength="6" style="width:120px"></label><button id="codeBtn" class="primary">인증번호 넣기</button><button id="cancelBtn">해제 취소</button><span id="unmaskNote" class="muted"></span></div>`
    :mk.header!=='unmasked'&&mk.reasonPreview?`<div class="line"><button id="unmaskBtn" class="primary">마스킹 해제 시작</button><span class="muted">체크히어에 넣을 사유: ${esc(mk.reasonPreview)}</span><span id="unmaskNote" class="muted"></span></div>`:'';
  if($('#unmaskBtn'))$('#unmaskBtn').onclick=()=>run($('#unmaskBtn'),async()=>{const r=await api('unmask/start',{reason:state.masking.reasonPreview});unmaskStage=r.stage==='code'?'code':null;await refresh();return r.stage==='done'?'이미 해제되어 있습니다.':'';},'#unmaskNote');
  if($('#codeBtn'))$('#codeBtn').onclick=()=>run($('#codeBtn'),async()=>{await api('unmask/code',{code:$('#code').value.trim()});unmaskStage=null;await refresh();return '해제됨 · 연장·종료는 체크히어 창에서 직접 누르세요.';},'#unmaskNote');
  if($('#cancelBtn'))$('#cancelBtn').onclick=()=>run($('#cancelBtn'),async()=>{await api('unmask/cancel',{});unmaskStage=null;await refresh();return '';},'#unmaskNote');
}
function paintLectures(){
  $('#lectureRows').innerHTML=state.classes.map(c=>{
    const now=c.lecture?`<span class="pill">${esc(LECTURE[c.lecture.mode]||c.lecture.mode)}</span>${c.lecture.label?esc(c.lecture.label):`${esc(c.tag)}로 찾음`}`:`<span class="muted">아직 없음(수집 때 ${esc(c.tag)}로 찾음)</span>`;
    const opts=lectures.map((l,i)=>`<option value="${i}"${l.classId===c.classId&&!l.old?' selected':''}>${l.classId?`[${esc(l.classId)}반 규칙] `:''}${l.old?'(1기로 보임) ':''}${l.covers===false?'(그 날 기간 밖) ':''}${esc(l.label)}</option>`).join('');
    return `<tr><td>${esc(c.classId)}반</td><td>${esc(c.name)}<div class="muted">정원 ${c.capacity}명 · 명단 ${c.roster.count}명 · 연결 ${c.links.total}명(원문 확인 ${c.links.plain})</div></td><td>${now}</td>
      <td>${lectures.length?`<select data-pick="${esc(c.classId)}"><option value="">고르세요</option>${opts}</select>`:'<span class="muted">먼저 강의 목록을 읽어 주세요</span>'}</td>
      <td><button data-link="${esc(c.classId)}"${lectures.length?'':' disabled'}>연결</button>${c.lecture?.mode==='manual'?` <button data-unlink="${esc(c.classId)}">연결 풀기</button>`:''}</td></tr>`;
  }).join('');
  document.querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>run(b,async()=>{const id=b.dataset.link,i=$(`[data-pick="${id}"]`)?.value;if(i===''||i===undefined)throw Error('연결할 강의를 골라 주세요.');state=await api('setup/link-lecture',{classId:id,label:lectures[Number(i)].label});paint();return `${id}반 연결했습니다.`;},'#lectureNote'));
  document.querySelectorAll('[data-unlink]').forEach(b=>b.onclick=()=>run(b,async()=>{state=await api('setup/unlink-lecture',{classId:b.dataset.unlink});paint();return `${b.dataset.unlink}반 직접 연결을 풀었습니다(다음 수집은 이름 규칙으로 찾음).`;},'#lectureNote'));
}
function paintClasses(){
  $('#classRows').innerHTML=state.classes.map(c=>{
    const k=c.check,f=c.confirmed;
    return `<tr data-row="${esc(c.classId)}" class="${c.classId===selected?'sel':''}" style="cursor:pointer"><td>${esc(c.classId)}반</td><td>${c.lecture?esc(LECTURE[c.lecture.mode]||c.lecture.mode):'<span class="muted">이름 규칙</span>'}</td>
      <td class="num">${c.roster.count?`${c.roster.count}명${c.roster.source==='registered'?' (등록 목록)':''}`:'<span class="muted">없음</span>'}${c.registry?`<div class="muted">DB 등록 ${c.registry.count}명</div>`:''}</td>
      <td class="num">${k?`${esc(k.date)} · <span class="ok">${k.matched}</span> · <span class="warn">${k.unmatched}</span> · <span class="warn">${k.missing}</span> · <span class="bad">${k.ambiguous}</span> <span class="muted">(${k.total}명 읽음)</span>`:'<span class="muted">아직</span>'}</td>
      <td class="num">${f?`<span class="ok">${f.count}명 확인</span> ${esc(when(f.confirmedAt))}${f.stale?' <span class="warn">확인 뒤 다시 읽음</span>':''}`:'<span class="muted">아직</span>'}</td>
      <td class="num">${f?.registeredAt?`<span class="ok">등록 ${f.registeredCount}명</span> ${esc(when(f.registeredAt))}`:f?'<span class="warn">등록 대기</span>':''}</td></tr>`;
  }).join('');
  document.querySelectorAll('[data-row]').forEach(tr=>tr.onclick=()=>{selected=tr.dataset.row;paintClasses();paintDetail();});
  const job=state.jobs[0];$('#checkNote').textContent=job?`${job.status==='running'?'읽는 중':job.status==='paused'?'멈춤':job.status==='complete'?'끝':job.status} · ${job.message||''}`:'';
}
function paintDetail(){
  const c=cls(selected);if(!c){$('#detail').innerHTML='';return;}
  const v=c.view,out=excluded.get(c.classId)||new Set(),busy=state.busy;
  const rows=v?v.rows.map(r=>{
    const [klass,label]=STATUS[r.status]||['muted',r.status],paired=r.status==='paired',open=!!r.candidates;
    return `<tr><td><input type="checkbox" data-inc="${esc(r.token)}"${r.included&&!out.has(r.token)?' checked':''}${r.status==='noid'?' disabled':''}></td><td>${esc(r.name)} · ${esc(r.last4)}</td><td class="${klass}">${esc(label)}${r.reason?`<div class="muted">${esc(r.reason)}</div>`:''}${r.conflict?'<div class="bad">연결 충돌 — 첫 화면의 「연결 충돌 정리」 뒤 다시 읽기</div>':''}</td>
      <td>${r.roster?`${esc(r.roster.name)} · ${esc(r.roster.last4)}${r.roster.birth?` · ${esc(r.roster.birth)}`:''}`:''}${paired?` <button data-unpair="${esc(r.token)}">짝 풀기</button>`:''}${open&&r.candidates.length?`<select data-cand="${esc(r.token)}"><option value="">명단 학생과 짝짓기</option>${r.candidates.map(m=>`<option value="${esc(m.studentKey)}">${esc(m.name)} · ${esc(m.last4)}${m.birth?` · ${esc(m.birth)}`:''}${m.dup?' (명단 겹침)':''}</option>`).join('')}</select> <button data-pair="${esc(r.token)}">짝</button>`:''}</td></tr>`;}).join(''):'';
  const masked=c.report;
  const mrows=masked?masked.rows.map(x=>{const fits=masked.missing.filter(m=>m.last4===x.last4&&sameName(x.shown,m.name));
    return `<tr><td>${esc(x.seq)}</td><td>${esc(x.shown)} · ${esc(x.last4)}</td><td class="muted">${esc(REASON[x.reason]||x.reason)}</td><td>${fits.length?`<select data-student="${esc(x.token)}"><option value="">명단 학생 고르기</option>${fits.map(m=>`<option value="${esc(m.studentKey)}">${esc(m.name)} · ${esc(m.last4)}${m.dup?' (명단 겹침)':''}</option>`).join('')}</select> <button data-mpair="${esc(x.token)}">연결</button>`:'<span class="muted">맞는 명단 학생 없음</span>'}</td></tr>`;}).join(''):'';
  $('#detail').innerHTML=`<h3 style="margin:18px 0 6px">${esc(c.classId)}반 · ${esc(c.name)}</h3>
    <div class="line"><button id="checkOne"${busy?' disabled':''}>이 반 원문으로 다시 읽기</button>${v?`<button id="confirmOne" class="primary">이 반 확인(${v.rows.filter(r=>r.included&&!out.has(r.token)).length}명)</button>`:''}${c.confirmed?'<button id="unconfirmOne">확인 취소</button>':''}${c.roster.count?'<button id="maskedOne">가린 화면으로 명단 맞추기(해제 전)</button>':''}<span id="detailNote" class="muted"></span></div>
    ${v?`<p class="status">${esc(v.date)} 원문 확인 ${esc(when(v.at))} · 체크히어 ${v.counts.total}명 · 맞음 ${v.counts.matched} · 명단에 없음 ${v.counts.unmatched} · 명단에만 ${v.counts.missing} · 겹침 ${v.counts.ambiguous} · 확인 목록 ${v.counts.included}명${c.roster.count?'':' (명단 없음: 체크히어 원문 명단으로 확인)'}</p>
      <div class="tablewrap"><table><thead><tr><th>넣기</th><th>체크히어(원문 이름 · 끝 4자리)</th><th>상태</th><th>명단 학생</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${v.missing.length?`<p class="warn">체크히어에서 못 찾은 명단 학생 ${v.missing.length}명: ${v.missing.map(m=>`${esc(m.name)}(${esc(m.last4)}${m.birth?`·${esc(m.birth)}`:''})`).join(', ')}</p>`:''}`
      :'<p class="muted">아직 원문으로 확인하지 않았습니다. 마스킹을 해제한 뒤 「이 반 원문으로 다시 읽기」나 위 「확인 안 된 반 모두 읽기」를 눌러 주세요.</p>'}
    ${masked&&masked.rows.length?`<p class="status">가린 화면 맞춤 ${esc(masked.date)}(${masked.view==='masked'?'가린 화면':'원문 화면'}) · 연결 ${masked.linked}/${masked.total}명 · 연결 안 된 줄 ${masked.rows.length}</p><div class="tablewrap"><table><thead><tr><th>순번</th><th>체크히어 표(보이는 이름 · 끝 4자리)</th><th>저절로 잇지 못한 이유</th><th>명단 학생</th></tr></thead><tbody>${mrows}</tbody></table></div>`:''}`;
  document.querySelectorAll('[data-inc]').forEach(b=>b.onchange=()=>{const s=excluded.get(c.classId)||new Set();if(b.checked)s.delete(b.dataset.inc);else s.add(b.dataset.inc);excluded.set(c.classId,s);paintDetail();});
  document.querySelectorAll('[data-pair]').forEach(b=>b.onclick=()=>run(b,async()=>{const studentKey=$(`[data-cand="${b.dataset.pair}"]`)?.value;if(!studentKey)throw Error('명단 학생을 골라 주세요.');state=await api('setup/pair',{classId:c.classId,token:b.dataset.pair,studentKey});paint();return '짝지었습니다.';},'#detailNote'));
  document.querySelectorAll('[data-unpair]').forEach(b=>b.onclick=()=>run(b,async()=>{state=await api('setup/unpair',{classId:c.classId,token:b.dataset.unpair});paint();return '짝을 풀었습니다.';},'#detailNote'));
  document.querySelectorAll('[data-mpair]').forEach(b=>b.onclick=()=>run(b,async()=>{const studentKey=$(`[data-student="${b.dataset.mpair}"]`)?.value;if(!studentKey)throw Error('명단 학생을 골라 주세요.');state=await api('setup/roster-link',{classId:c.classId,token:b.dataset.mpair,studentKey});paint();return '연결했습니다(읽기 전용, 원문 화면에서 확인되면 쓰기도 됨).';},'#detailNote'));
  if($('#checkOne'))$('#checkOne').onclick=()=>startCheck([c.classId],$('#checkOne'),'#detailNote');
  if($('#confirmOne'))$('#confirmOne').onclick=()=>run($('#confirmOne'),async()=>{state=await api('setup/confirm',{classId:c.classId,exclude:[...out]});excluded.delete(c.classId);paint();return `${c.classId}반 확인 ${cls(c.classId).confirmed.count}명 — 등록은 운영포털 실시간 화면에서 합니다.`;},'#detailNote');
  if($('#unconfirmOne'))$('#unconfirmOne').onclick=()=>run($('#unconfirmOne'),async()=>{state=await api('setup/unconfirm',{classId:c.classId});paint();return '확인을 취소했습니다.';},'#detailNote');
  if($('#maskedOne'))$('#maskedOne').onclick=()=>run($('#maskedOne'),async()=>{const job=await api('sync',{classId:c.classId,dates:[$('#checkDate').value],mode:'incremental'});const j=await waitJob(job.id);state=await api('setup/state',{});paint();return `${c.classId}반: ${j.message||j.status}`;},'#detailNote');
}
function paint(){paintTop();paintLectures();paintClasses();paintDetail();}
// 글은 일이 끝난 뒤 다시 찾은 칸에 씁니다(그 사이 화면을 다시 그리면 옛 칸이 사라짐).
async function run(button,task,note){button.disabled=true;$(note).textContent='처리 중…';let text;try{text=await task()||'';}catch(e){text=e.message;}finally{button.disabled=false;}if($(note))$(note).textContent=text;}
async function refresh(){state=await api('setup/state',{});paint();return state;}
async function waitJob(id){let j={status:'running'};for(let i=0;i<900&&j.status==='running';i++){await new Promise(r=>setTimeout(r,1500));j=(await api('state?delta=1')).jobs.find(x=>x.id===id)||j;if(i%2===0)await refresh();}return j;}
function startCheck(classIds,button,note){return run(button,async()=>{const job=await api('setup/check',{date:$('#checkDate').value,...(classIds?{classIds}:{})});await refresh();const j=await waitJob(job.id);await refresh();return `${j.status==='paused'?'멈춤':j.status==='complete'?'끝':j.status} · ${j.message||''}`;},note);}
$('#connect').onclick=()=>run($('#connect'),async()=>{const r=await api('connect',{});await refresh();return r.message||'';},'#connNote');
$('#readLectures').onclick=()=>run($('#readLectures'),async()=>{const r=await api('setup/lectures',{date:$('#lectureDate').value});lectures=r.lectures||[];paint();return `강의 ${lectures.length}개${r.complete?'':' (목록 쪽을 다 보지 못함)'} · 규칙에 맞는 2기 강의 ${lectures.filter(l=>l.classId&&!l.old).length}개`;},'#lectureNote');
$('#importRoster').onclick=()=>run($('#importRoster'),async()=>{
  const r=await api('setup/roster',{classId:$('#rosterClass').value,text:$('#rosterText').value});
  if(!r.ok)return '불러오지 않았습니다 — '+r.errors.slice(0,8).map(e=>`${e.line?e.line+'줄':''} ${e.reason}`).join(' / ')+(r.errors.length>8?` 외 ${r.errors.length-8}건`:'');
  state=r.state;paint();$('#rosterText').value='';return '불러왔습니다: '+Object.entries(r.imported).map(([c,x])=>`${c}반 ${x.count}명${x.dup?`(겹침 ${x.dup})`:''}`).join(', ');
},'#rosterNote');
$('#checkAll').onclick=()=>startCheck(null,$('#checkAll'),'#checkNote');
// 내보내기: 연결 프로그램이 확인 목록을 CSV·탭 구분 글로 줍니다(이 PC 화면에서만, 학생 번호 포함).
$('#csv').onclick=()=>run($('#csv'),async()=>{const text=await api('setup/export',{format:'csv'},{raw:true}),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([String.fromCharCode(0xfeff)+text],{type:'text/csv;charset=utf-8'}));a.download=`체크히어_2기_학생번호_${today()}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);return 'CSV를 내려받았습니다.';},'#exportNote');
$('#copy').onclick=()=>run($('#copy'),async()=>{const text=await api('setup/export',{format:'tsv'},{raw:true});await navigator.clipboard.writeText(text);return `표를 복사했습니다(${text.trim().split('\n').length-1}명) — 시트에 붙여 넣으세요.`;},'#exportNote');
$('#rosterClass').innerHTML+=CLASS_IDS.map(c=>`<option value="${c}">${c}반</option>`).join('');
for(const id of ['#lectureDate','#checkDate']){$(id).value=firstDay();$(id).min=COHORT.period.start;$(id).max=COHORT.period.end;}
try{key=(await(await fetch('/api/session',{cache:'no-store'})).json()).key||'';await refresh();poll=setInterval(()=>{if(!document.hidden)void api('setup/state',{}).then(s=>{state=s;paintTop();paintClasses();}).catch(()=>{});},15000);}catch(e){$('#cohort').textContent='연결 프로그램에 연결하지 못했습니다: '+e.message;}
