// 2기 베타 홈: 알림(질병·증빙·서류·동기화) + 17개 반 오늘 출결 + 오늘 업무·담임 전달(1기 기능, 보기 전용)
import {dayView,dayCounts,studentStats,diseaseReport,evidenceRows,isConflictFlag} from './beta2-core.mjs';
import {esc,md,syncPill,toast,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {onBeta2Rev} from './beta2-data.mjs';

const SECTIONS=[['summary','요약'],['work','오늘 업무'],['handoff','담임 전달']];
const MAP_1KI={attendanceOverview:'b2ledger',attendanceStats:'b2status',attendanceEvidence:'b2status',diseaseRisk:'b2status',dropoutStatus:'b2status',attendancePeriod:'b2downloads',preview:'b2teacher'};

export async function mount(host,{db,user,classes,client,open}){
 const life=lifecycle(host);
 let section='summary',bundle=null,docs=null,work=null,error='',voc=null;
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>2기 베타 홈</h2><p>1기 데이터를 2기 방식(마스터시트 + 체크히어)으로 실시간 운영해 보는 비공개 화면입니다.</p></div><div class="b2-chips" style="align-items:center"><span id="h2Sync"></span><button class="b2-btn soft" id="h2Pull">운영총괄 전체 가져오기</button></div></div><div class="b2-tabs" id="h2Tabs"></div><div id="h2Body">${loading()}</div></div>`;
 const $=s=>host.querySelector(s),body=$('#h2Body');
 function tabs(){$('#h2Tabs').innerHTML=SECTIONS.map(([k,l])=>`<button class="b2-tab" data-section="${k}" aria-selected="${section===k}">${l}</button>`).join('');}
 function summary(){
  if(!bundle){body.innerHTML=error?errorBox(error):loading();return;}
  const day=bundle.days.filter(d=>d<=bundle.today).at(-1)||bundle.today,stats=studentStats(bundle,{}),disease=diseaseReport(stats),evidence=evidenceRows(stats);
  const flags=bundle.ledger.filter(r=>isConflictFlag(r.flag)),flagClass=flags[0]?.cls||'1',newDocs=(docs?.rows||[]).filter(d=>d.status==='접수'),openDocs=(docs?.rows||[]).filter(d=>['접수','처리중','보완 필요'].includes(d.status));
  const alert=(n,label,sub,go,hot)=>`<button class="b2-card b2-alert ${hot&&n?'hot':''}" data-go="${esc(go)}"><span class="b2-small b2-muted">${esc(label)}</span><b>${n}</b><span class="b2-tiny b2-muted">${esc(sub)}</span></button>`;
  const index=new Map(bundle.ledger.map(r=>[`${r.cls}|${r.name}|${r.date}`,r]));
  body.innerHTML=`<div class="b2-alerts">${alert(disease.rows.length,'질병 인정 4회 이상',`6회 도달 ${disease.atLimit} · 초과 ${disease.exceeded}`,'b2status:disease',true)}${alert(evidence.length,'증빙 미제출·반려',`${new Set(evidence.map(e=>e.cls+e.name)).size}명`,'b2status:evidence',true)}${alert(newDocs.length,'새 서류발급 신청',`진행 중 ${openDocs.length}건`,'b2docs',true)}${alert(flags.length,'동기화 확인 필요','운영총괄과 다른 베타 수정',`b2ledger:flag:${flagClass}`,true)}${alert(+voc?.admin||0,'민원·이슈 답변 대기',voc?`진행 중 ${Object.values(voc.open||{}).reduce((a,b)=>a+b,0)}건`:'확인 중','b2vocs',true)}</div>
  <div class="b2-head" style="margin-top:18px"><div><h3>${md(day)} 반별 출결</h3><p>카드를 누르면 그 반 출결대조로 갑니다. 마스터시트 출결원장 기준입니다.</p></div></div>
  <div class="b2-grid">${classes.map(c=>{const info=bundle.classes.find(x=>String(x.id)===String(c.id))||{},n=dayCounts(dayView(bundle,c.id,day,index));return `<button class="b2-card b2-class" data-class="${esc(c.id)}"><b>${esc(c.id)}반 · ${esc(info.course||c.course)}</b><span class="b2-sub">${esc(info.region||c.region)} · 담임 ${esc(info.teacher||'미등록')}</span><div class="nums"><span>총원 <b>${n.총원}</b></span><span>출석 <b>${n.출석}</b></span><span style="color:#b91c1c">결석 <b>${n.결석}</b></span><span>지·조·외 <b>${n.지각+n.조퇴+n.외출}</b></span><span>인정 <b>${n.인정}</b></span>${n.확인필요?`<span class="b2-badge t-late">확인 ${n.확인필요}</span>`:''}</div></button>`;}).join('')}</div>`;
 }
 async function showSection(){
  tabs();work?.dispose?.();work=null;
  if(section==='summary'){summary();return;}
  body.innerHTML=`<div class="b2-banner readonly"><strong>보기 전용</strong> 1기 운영포털과 같은 Firebase 자료입니다. 저장은 1기 운영포털에서 해 주세요.</div><div id="h2Work">${loading()}</div>`;
  try{const m=await import('./operations-work.mjs?v=20260922-work1');if(!life.alive()||!$('#h2Work'))return;work=await m.mountOperationsWork($('#h2Work'),{db,user,classes,mode:section,canApprove:false,onOpen:(tab,ctx)=>open(MAP_1KI[tab]||tab,ctx)});life.on(()=>work?.dispose?.());}
  catch(e){if(life.alive())$('#h2Work').innerHTML=errorBox(e);}
 }
 async function load(fresh=false){
  try{[bundle,docs]=await Promise.all([client.bundle('all',{fresh}),client.docs({}).catch(()=>null)]);error='';}catch(e){error=e;}
  if(!life.alive())return;$('#h2Sync').innerHTML=bundle?syncPill(bundle.sync):'';if(section==='summary')summary();
 }
 host.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.section){if(section!==t.dataset.section&&work?.canLeave&&!work.canLeave())return;section=t.dataset.section;void showSection();return;}
  if(t.dataset.class){open('b2ledger',{classId:t.dataset.class,date:bundle?.days.filter(d=>d<=bundle.today).at(-1)});return;}
  if(t.dataset.go){const [tab,a,b]=t.dataset.go.split(':');open(tab,tab==='b2ledger'?{classId:b,filter:a}:a?{tab:a}:{});}
 });
 $('#h2Pull').onclick=async e=>{
  if(!confirm('운영총괄 17개 반을 지금 모두 가져올까요? 30초쯤 걸립니다. (평소에는 10분마다 자동으로 가져옵니다)'))return;
  e.target.disabled=true;e.target.textContent='가져오는 중…';
  try{const r=await client.syncNow({});const s=r?.stats||{};toast(r?.skipped?r.reason:`가져오기 완료 · 추가 ${s.added||0} · 수정 ${s.updated||0} · 삭제 ${s.removed||0} · 확인 필요 ${s.flagged||0}`);await load(true);}
  catch(err){toast(err.message);}finally{e.target.disabled=false;e.target.textContent='운영총괄 전체 가져오기';}
 };
 const stop=client.watch(()=>{if(section==='summary')void load(true);},{current:()=>bundle?.rev||0,interval:60000});life.on(stop);
 // 민원·이슈 건수는 변경 번호 응답(voc)에 함께 옵니다. 바뀌면 카드만 다시 그립니다.
 life.on(onBeta2Rev(r=>{if(!r?.voc||r.voc.rev===voc?.rev)return;voc=r.voc;if(section==='summary'&&bundle)summary();}));
 tabs();await load();
 return {canLeave:()=>work?.canLeave?.()??true,dispose:()=>{work?.dispose?.();life.dispose();}};
}
