// 2기 반 현황(관리자, 사용자 요청 2026-10-20 "관리자화면에서 각 반 맨처음에 클릭하면 단순 출결뿐만 아니라 여러 현황 한번에 볼 수 있는 그런거"):
// 홈의 반 카드를 누르거나 출결 › 반 현황에서 반을 고르면, 그 반의 여러 현황을 한 화면 카드로 봅니다. 보기만 하고, 처리는 카드 안 링크로 그 화면(그 반을 고른 채)에서 합니다.
// 카드마다 따로 불러오고 따로 오류를 보입니다(한 곳을 못 읽어도 나머지는 그대로). 읽기는 모두 그 반 것만(b2Bundle 반 묶음 · b2Dropouts·b2Docs·b2Vocs·b2Schedule·b2LedgerMemos {cls}).
// 묶음·시간표는 beta2-data.mjs 기억(변경 번호 rev가 같으면 다시 읽지 않음)을 그대로 쓰고, 홈이 이미 받은 전체 묶음이 있으면 그것을 씁니다.
// 다시 읽기: 변경 번호가 바뀌면(client.watch, 홈과 같은 1분) 묶음·메모만, 민원·이슈는 변경 번호 응답의 voc가 바뀔 때만, 나머지는 「새로고침」으로.
// 체크히어 대조 요약은 그날 저장본 문서 하나(classes/반/checkhereCurrent/날짜)를 한 번 읽습니다(실시간 구독 없음, 날짜·반을 바꿀 때만 다시).
// 17반 테스트반도 고를 수 있고 똑같이 보입니다(공식 합계에서만 빠짐).
import {dayView,dayCounts,studentStats,diseaseReport,evidenceRows,extraEvidenceRows,rosterFor,classDays,courseDays,ledgerIndex,compareCheckHere,recognizedType,convertedText,convertedUnitsText} from './beta2-core.mjs';
import {absenceRows,byTeacher,maxOf,MAX_ABSENCE} from './beta2-dropout-core.mjs';
import {esc,md,badge,evBadge,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {onBeta2Rev} from './beta2-data.mjs';
import {loadDayTimes,dayTimesCached,ruleOn,SOURCE_SHEET} from './beta2-daytimes.mjs';
import {vocOpen,vocWaiting} from './beta2-voc.mjs';
import {inbox} from './notify.mjs';
import {createdMs,whenText} from './notify-core.mjs';
import {DISEASE,isTestClass,addDays,classInfo} from './cohort.mjs';

const DOC_OPEN=['접수','처리중','보완 필요'];
const DOC_TONE={'접수':'t-rec','처리중':'t-late','보완 필요':'t-absent'},VOC_TONE={'접수':'t-rec','처리중':'t-late','보류':'t-na'},STATUS_TONE={'재학':'','중도탈락':'t-absent','조기취업':'t-rec','수료':'e-ok'};
const OFFICERS=[['leader','반장'],['subLeader','부반장'],['viceLeader','부반장'],['treasurer','총무'],['ambassador','앰버서더']];
const W='일월화수목금토';
const STYLE=`.b2c .b2c-top{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:0 0 12px}
.b2c .b2c-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:12px;align-items:start}
.b2c .b2c-card{padding:14px 16px;display:grid;gap:10px;min-width:0}
.b2c .b2c-card>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.b2c .b2c-card>header h3{flex:1 1 auto}
.b2c .b2c-nums{display:flex;gap:6px;flex-wrap:wrap}.b2c .b2c-nums .b2-stat{min-width:64px;padding:6px 10px}.b2c .b2c-nums .b2-stat b{font-size:16px}
.b2c .b2c-list{display:grid;gap:0;margin:0;padding:0;list-style:none}
.b2c .b2c-list li{display:flex;gap:6px 8px;align-items:center;flex-wrap:wrap;padding:7px 0;border-top:1px solid var(--b2-line);font-size:13px;min-width:0}
.b2c .b2c-list li:first-child{border-top:0}.b2c .b2c-list .b2-sub{flex-basis:100%;margin-top:0}
.b2c .b2c-list li.on{background:#f0f9ff;margin:0 -8px;padding:7px 8px;border-radius:8px}
.b2c .b2c-links{display:flex;gap:6px;flex-wrap:wrap}
.b2c .b2c-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px}.b2c .b2c-kv dt{color:var(--b2-sub);font-weight:800;font-size:12px}.b2c .b2c-kv dd{margin:0;min-width:0;word-break:break-word}
.b2c .b2c-wide{grid-column:1/-1}
@media(max-width:640px){.b2c .b2c-top .b2-field{flex:1 1 140px}.b2c .b2c-card{padding:12px}}`;

const koreaNow=()=>{const s=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'});return {date:s.slice(0,10),seconds:+s.slice(11,13)*3600+ +s.slice(14,16)*60};};
const hms=v=>{const m=/^(\d{2}):(\d{2})/.exec(String(v||''));return m?+m[1]*3600+ +m[2]*60:null;};
const mondayOf=iso=>{const d=new Date(iso+'T00:00:00Z');return addDays(iso,-((d.getUTCDay()+6)%7));};
const dday=(due,today)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(due||''))return '';const n=Math.round((Date.parse(due)-Date.parse(today))/864e5);return n<0?`${-n}일 지남`:n===0?'오늘 마감':`D-${n}`;};
const pct=v=>v===null||!Number.isFinite(v)?'-':`${Math.round(v*10)/10}%`;
const nums=items=>`<div class="b2c-nums">${items.map(([l,n,k])=>`<div class="b2-stat ${k||''}" data-stat="${esc(l)}"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
const list=(items,empty)=>items.length?`<ul class="b2c-list">${items.join('')}</ul>`:`<div class="b2-muted b2-small">${esc(empty)}</div>`;
// 링크 단추: 누르면 open(tab, ctx). 반은 늘 지금 고른 반으로 붙입니다(아래 click).
const go=(label,tab,ctx={},kind='')=>`<button class="b2-btn small ${kind}" data-open="${esc(tab)}" data-ctx="${esc(JSON.stringify(ctx))}">${esc(label)}</button>`;
const timesOf=r=>{const t=String(r?.type||'').replace(/^인정/,'');return t==='지각'&&r.inT?`입실 ${r.inT}`:t==='조퇴'&&r.outT?`퇴실 ${r.outT}`:t==='외출'&&r.oa?`외출 ${r.oa}~${r.ob||''}`:'';};

export async function mount(host,{db,user,classes=[],client,selected,context,open}){
 const life=lifecycle(host);
 let cls=String(context?.classId||selected||classes[0]?.id||'1'),date=String(context?.date||'');
 // 카드별 상태: {loading, data, error}. key: bundle·drop·docs·vocs·sched·memos·check
 const parts={},seqs={};
 let vocRev=null;
 host.innerHTML=`<div class="b2 b2c"><style>${STYLE}</style><div class="b2-head"><div><h2>반 현황</h2><p>한 반의 출결·누적·중도탈락·서류발급·민원·시간표·메모를 한 화면에서 봅니다. 보기만 하는 화면이고, 처리는 카드 안 단추로 그 화면(이 반을 고른 채)에서 합니다.</p></div></div>
 <div class="b2c-top"><label class="b2-field">반<select id="c2Class">${classOptions(classes,cls)}</select></label><label class="b2-field">날짜<select id="c2Date"><option value="">불러오는 중…</option></select></label><span class="b2-grow"></span>
  <button class="b2-btn primary" id="c2Ledger">이 날 출결대조 열기</button><button class="b2-btn" id="c2Reload">새로고침</button></div>
 <div class="b2c-grid" id="c2Grid"></div></div>`;
 const $=s=>host.querySelector(s),grid=$('#c2Grid');
 const SECTIONS=[['info','반 정보'],['day','출결'],['total','누적'],['drop','중도탈락·수료'],['docs','서류발급'],['vocs','민원·이슈'],['week','이번 주 시간표'],['memos','출결대조 메모·알림']];
 grid.innerHTML=SECTIONS.map(([k,l])=>`<section class="b2-card b2c-card" data-section="${k}" aria-label="${esc(l)}"><header><h3>${esc(l)}</h3></header>${loading()}</section>`).join('');
 const card=(k,title,body,links='')=>{const el=grid.querySelector(`[data-section="${k}"]`);if(el)el.innerHTML=`<header><h3>${title}</h3>${links?`<div class="b2c-links">${links}</div>`:''}</header>${body}`;if(el&&k==='day')driveAttach(el);};
 // 드라이브 폴더 바로가기(drive-links.mjs, 사용자 요청 2026-10-21): 출결 카드 맨 아래 작은 한 줄(그 반·고른 날짜, 그날이 든 단위기간 1·2·3). 카드를 다시 그려도 같은 바를 옮겨 붙입니다.
 let drive=null;const driveAttach=el=>{if(!drive)return;el.append(drive.el);drive.set(cls,date);};
 import('./drive-links.mjs?v=20261021-dl1').then(m=>{if(!life.alive())return;drive=m.createDriveBar({client,admin:true});life.on(()=>drive.dispose());const el=grid.querySelector('[data-section="day"]');if(el)driveAttach(el);}).catch(()=>{});
 const state=(k,label)=>{const p=parts[k];return !p||p.loading&&!p.data?loading(label):p.error&&!p.data?errorBox(p.error):'';};

 // 한 카드의 자료를 읽습니다(늦게 온 이전 반·날짜 결과는 버림). quiet: 다시 읽는 동안 전 값을 그대로 보임.
 async function fetchPart(k,fn,{quiet=false}={}){
  const n=seqs[k]=(seqs[k]||0)+1,p=parts[k]=quiet?{...(parts[k]||{}),loading:true}:{loading:true};
  if(!quiet)paint(k);
  try{const data=await fn();if(n!==seqs[k]||!life.alive())return;parts[k]={data};}
  catch(e){if(n!==seqs[k]||!life.alive())return;parts[k]=p.data?{data:p.data,error:e}:{error:e};}
  paint(k);
 }
 const bundle=()=>parts.bundle?.data||null;
 // 반 정보: cohort.json 반(지역·과정·교육장) 위에 마스터시트 반정보(b2Info_: 지역·과정·HRD 과정명·담임·연락처·교육장·주소)에서 값이 있는 칸만 얹습니다.
 const info=()=>{const sheet=(bundle()?.classes||[]).find(c=>String(c.id)===cls)||{};return {...(classInfo(cls)||{}),...Object.fromEntries(Object.entries(sheet).filter(([,v])=>v!==''&&v!==null&&v!==undefined))};};
 const days=()=>{const b=bundle();if(!b)return [];return classDays(b,cls).filter(d=>d<=b.today);};
 const maxAbs=()=>maxOf(parts.drop?.data?.maxAbsence||MAX_ABSENCE);

 function paintDates(){
  const b=bundle(),sel=$('#c2Date');if(!b){sel.innerHTML='<option value="">불러오는 중…</option>';return;}
  const list=[...days()].reverse();if(date&&!list.includes(date))list.unshift(date);
  sel.innerHTML=list.length?list.map(d=>`<option value="${d}" ${d===date?'selected':''}>${esc(md(d))}${d===b.today?' · 오늘':''}</option>`).join(''):`<option value="${esc(date)}">${esc(md(date))}</option>`;
 }

 /* ---------- 카드 ---------- */
 function paintInfo(){
  const s=state('bundle','반 정보를 불러오는 중…');if(s)return card('info','반 정보',s);
  const c=info(),roster=rosterFor(bundle(),cls),count=st=>roster.filter(p=>(p.status||'재학')===st).length;
  const officers=OFFICERS.map(([k,l])=>[l,c.officers?.[k]??c[k]]).filter(([,v])=>String(v??'').trim());
  // 반 임원(마스터시트 '반 임원' 탭, b2Officers, 2026-10-20): 읽혔으면 네 역할 모두 최초·보궐(앰버서더는 추가도)과 '보궐 필요'를 함께, 아직이면 반정보 값만.
  // 앰버서더는 여러 명(2026-10-21, 배열): 모두 ', '로 잇습니다. 예전 응답(객체·null)도 받습니다.
  const od=parts.officers?.data,now=od?.current?.[cls],needs=(od?.needs||[]).filter(n=>String(n.cls)===cls);
  const holders=v=>(Array.isArray(v)?v:v?[v]:[]).filter(o=>o&&o.name),tone={'보궐':'t-rec','추가':'t-late'};
  const officerRows=now?(od.roles?.length?od.roles:['반장','부반장','총무','앰버서더']).map(role=>{const list=holders(now[role]);
   return `<dt>${esc(role)}</dt><dd data-officer="${esc(role)}">${list.length?list.map(o=>`<span class="b2c-officer">${esc(o.name)} <span class="b2-badge ${tone[o.kind]||'e-ok'}">${esc(o.kind||'최초')}</span>${needs.some(n=>n.role===role&&n.name===o.name)?' <span class="b2-badge t-absent">보궐 필요</span>':''}</span>`).join(', '):'<span class="b2-muted">없음</span>'}</dd>`;}).join(''):officers.map(([l,v])=>`<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`).join('');
  card('info',`${esc(cls)}반 정보${isTestClass(cls)?' <span class="b2-badge t-na">테스트반</span>':''}`,
   `<dl class="b2c-kv"><dt>지역</dt><dd>${esc(c.region||'-')}${c.area&&c.area!==c.region?` · ${esc(c.area)}`:''}</dd><dt>과정</dt><dd>${esc(c.course||'-')}${c.hrdName?`<span class="b2-sub">${esc(c.hrdName)}</span>`:''}</dd><dt>교육장</dt><dd>${esc(c.venue||'-')}${c.address?`<span class="b2-sub">${esc(c.address)}</span>`:''}</dd><dt>담임</dt><dd data-teacher>${esc(c.teacher||'미등록')}${c.phone?` · ${esc(c.phone)}`:''}</dd>${officerRows}</dl>
   ${nums([['총원',roster.length],['재학',count('재학')],['중도탈락',count('중도탈락'),count('중도탈락')?'bad':''],['조기취업',count('조기취업')],['수료',count('수료')]])}`,
   go('교육생 상태','b2roster')+go('반 임원','b2officers'));
 }
 function dayRows(){const b=bundle();return dayView(b,cls,date,ledgerIndex(b));}
 function paintDay(){
  const s=state('bundle','출결을 불러오는 중…');if(s)return card('day','출결',s);
  const rows=dayRows(),n=dayCounts(rows),na=n.해당없음??rows.filter(r=>r.rec?.type==='해당없음').length;
  const others=rows.filter(r=>(r.enrolled||r.rec)&&r.type!=='출석');
  const item=r=>`<li data-name="${esc(r.name)}"><b class="b2-name">${esc(r.name)}</b>${badge(r.type)}${recognizedType(r.type)?evBadge(r.rec?.evApplied||r.rec?.ev||'미제출'):''}${timesOf(r.rec)?`<span class="b2-small b2-muted">${esc(timesOf(r.rec))}</span>`:''}${r.rec?.reason?`<span class="b2-sub">${esc(r.rec.reason)}</span>`:''}</li>`;
  card('day',`${esc(md(date))} 출결`,
   `${nums([['출석',n.출석],['결석',n.결석,n.결석?'bad':''],['지각',n.지각,n.지각?'alert':''],['조퇴',n.조퇴,n.조퇴?'alert':''],['외출',n.외출,n.외출?'alert':''],['중복',n.중복,n.중복?'alert':''],['인정',n.인정],['해당없음',na]])}
   <div class="b2-tiny b2-muted">총원 ${n.총원}명(그날 재학) · 출석에는 지각·조퇴·외출·중복·인정이 들어갑니다. 마스터시트 출결원장 기준.</div>
   <div data-check>${checkHtml(rows)}</div>
   ${list(others.map(item),'출석 외 학생이 없습니다.')}`,
   go('출결대조','b2ledger',{date},'primary'));
 }
 function checkHtml(rows){
  if(!db)return '';
  const p=parts.check;if(!p||p.loading&&!p.data)return '<div class="b2-small b2-muted">체크히어 대조 확인 중…</div>';
  if(p.error&&!p.data)return `<div class="b2-small b2-muted">체크히어 대조를 못 읽었습니다: ${esc(p.error.message||p.error)}</div>`;
  const {records,identities,match}=p.data;if(p.data.key!==`${cls}|${date}`)return '';
  if(!records.length)return '<div class="b2-small b2-muted">체크히어: 이 날 저장본 없음</div>';
  const now=koreaNow(),end=hms(ruleOn(date,{classId:cls}).end),students=rows.map(r=>({rowIndex:r.rowIndex,name:r.name})),c={ok:0,diff:0,pending:0,none:0},diffs=[];
  for(const r of rows){
   if(!r.enrolled&&!r.rec)continue;
   const settled=['결석','해당없음'].includes(r.type)&&end!==null&&now.seconds>=end;
   const record=match({name:r.name},students,records,identities).record||null,res=compareCheckHere(r.type,r.rec,record,{today:settled?'':now.date,date,now:now.seconds,corrected:true});
   c[res.state]=(c[res.state]||0)+1;if(res.state==='diff')diffs.push(`${r.name}: ${res.text}`);
  }
  return `<div class="b2-small" data-check-sum><b>체크히어 대조</b> · <span style="color:var(--b2-green)">일치 ${c.ok}</span> · <span style="color:var(--b2-amber)">불일치 ${c.diff}</span>${c.pending?` · 진행 중 ${c.pending}`:''}${c.none?` · 저장본 없음 ${c.none}`:''}${diffs.length?`<span class="b2-sub">${esc(diffs.slice(0,4).join(' / '))}${diffs.length>4?` 외 ${diffs.length-4}명`:''}</span>`:''}</div>`;
 }
 function paintTotal(){
  const s=state('bundle','누적 출결을 계산하는 중…');if(s)return card('total','누적',s);
  const b=bundle(),max=maxAbs(),stats=studentStats(b,{cls}),sum=stats.reduce((a,x)=>({d:a.d+x.days,ab:a.ab+x.absent,p:a.p+x.partial}),{d:0,ab:0,p:0}); // p: 지·조·외 합계(중복 1회)
  const rate=sum.d?(sum.d-sum.ab)/sum.d*100:null,taught=courseDays(b,{cls}).length,total=classDays(b,cls).length;
  const rowsAll=absenceRows(b,{cls,max}),risk=rowsAll.filter(r=>r.status==='재학'&&r.level),lv=l=>risk.filter(r=>r.level===l).length;
  // 단위기간 미이수(사용자 결정 2026-10-20 기간별 80% 출석, beta2-core unitCompletion): 재학생 가운데 끝난 기간 미이수 또는 진행 중 미이수 확정. 표시만(수료 판정과 별개).
  const unitFail=rowsAll.filter(r=>r.status==='재학'&&r.unitFailed.length);
  const disease=diseaseReport(stats).rows,evidence=evidenceRows(stats),extra=extraEvidenceRows(b,{cls}).filter(r=>!r.done);
  // 결석 한도 위험은 환산 결석(결석 + 지·조·외 단위기간마다 3회 = 1일, 사용자 결정 2026-10-20)으로 봅니다(absenceRows level). 지·조·외가 있으면 나눔을 함께 보입니다.
  const item=r=>`<li data-risk="${esc(r.name)}"><b class="b2-name">${esc(r.name)}</b><span class="b2-badge ${r.tone==='bad'?'t-absent':'t-late'}">${esc(r.level)}</span><span class="b2-small">환산 결석 ${r.total}일 / 한도 ${max}일</span>${r.partial?`<span class="b2-sub" data-conv title="${esc(convertedUnitsText(r.conv))}">${esc(convertedText(r.conv))}</span>`:''}<span class="b2-small b2-muted">${r.level==='주의'?`${r.left}일 더 결석하면 한도`:r.level==='한도 도달'?'1일 더 결석하면 제적 대상':'한도 초과'}${r.remaining?` · 남은 교육일 ${r.remaining}일`:''}</span></li>`;
  card('total','누적',
   `${nums([['반 출석률',pct(rate)],['교육일',`${taught}/${total}`],['지·조·외(중복 포함)',sum.p],['제적 대상',lv('제적 대상'),lv('제적 대상')?'bad':''],['한도 도달',lv('한도 도달'),lv('한도 도달')?'bad':''],['주의',lv('주의'),lv('주의')?'alert':''],['단위 미이수',unitFail.length,unitFail.length?'bad':'']])}
   <div class="b2-tiny b2-muted">출석률 = (재학 교육일 − 결석) ÷ 재학 교육일, 오늘까지 교육일만 셉니다. 결석 한도 ${max}일(넘으면 제적 대상)은 환산 결석으로 봅니다: 결석 + 지·조·외(중복 포함) 단위기간마다 3회 = 1일.</div>
   ${list(risk.slice(0,5).map(item),'결석 한도 주의 이상 재학생이 없습니다.')}${risk.length>5?`<div class="b2-tiny b2-muted">외 ${risk.length-5}명</div>`:''}
   ${unitFail.length?`<div class="b2-small" data-unit-fail>단위기간 미이수(기간별 80% 출석, 표시만): ${unitFail.slice(0,5).map(r=>`${esc(r.name)} ${r.unitFailed.map(u=>`${u.no}단위 ${u.state}`).join('·')}`).join(' · ')}${unitFail.length>5?` 외 ${unitFail.length-5}명`:''}</div>`:''}
   ${nums([[`질병 인정 ${DISEASE.warn}회 이상`,disease.length,disease.length?'alert':''],['증빙 미제출·반려',evidence.length,evidence.length?'alert':''],['추가 증빙 미이행',extra.length,extra.length?'alert':'']])}
   ${disease.length?`<div class="b2-small">질병 인정: ${disease.slice(0,5).map(d=>`${esc(d.name)} ${d.count}회${d.level&&d.level!=='주의'?`(${esc(d.level)})`:''}`).join(' · ')}</div>`:''}`,
   go('결석 한도','b2dropouts',{tab:'absence'})+go('질병 인정','b2status',{tab:'disease'})+go('증빙서류','b2status',{tab:'evidence'}));
 }
 function paintDrop(){
  const s=state('drop','중도탈락 탭을 불러오는 중…');if(s)return card('drop','중도탈락·수료',s,go('중도탈락·수료','b2dropouts',{tab:'list'}));
  const rows=(parts.drop.data?.rows||[]).filter(r=>String(r.cls)===cls),wait=rows.filter(r=>byTeacher(r)&&!r.confirmed),open=rows.filter(r=>!r.confirmed),done=rows.filter(r=>r.confirmed);
  const kind=k=>done.filter(r=>r.kind===k).length;
  const item=r=>`<li data-drop="${esc(r.name)}"><b class="b2-name">${esc(r.name)}</b><span class="b2-badge ${r.kind==='중도탈락'?'t-absent':'t-rec'}">${esc(r.kind)}</span>${byTeacher(r)?'<span class="b2-badge t-rec">담임 신청</span>':''}<span class="b2-small b2-muted">마지막 출석 ${esc(r.lastDate?md(r.lastDate):'-')}${r.verdict?` · 판정 ${esc(r.verdict)}`:''}</span>${r.reason?`<span class="b2-sub">${esc(r.reason)}</span>`:''}</li>`;
  card('drop','중도탈락·수료',
   `${nums([['담임 신청 대기',wait.length,wait.length?'alert':''],['확인 대기',open.length,open.length?'alert':''],['확인 · 중도탈락',kind('중도탈락')],['확인 · 조기취업',kind('조기취업')]])}
   ${list(open.slice(0,5).map(item),'관리자 확인을 기다리는 줄이 없습니다.')}`,
   go(wait.length?'담임 신청 처리':'중도탈락·수료','b2dropouts',{tab:'list',state:wait.length?'teacher':'all'},wait.length?'primary':'')+go('수료 명단','b2dropouts',{tab:'complete'}));
 }
 function paintDocs(){
  const s=state('docs','서류발급 신청을 불러오는 중…');if(s)return card('docs','서류발급',s,go('서류발급 신청함','b2docs',{classFilter:true}));
  const today=bundle()?.today||koreaNow().date,rows=(parts.docs.data?.rows||[]).filter(d=>String(d.cls).replace(/반.*$/,'')===cls&&DOC_OPEN.includes(d.status));
  const item=d=>`<li data-doc="${esc(d.id)}"><span class="b2-badge ${DOC_TONE[d.status]||''}">${esc(d.status)}</span><b class="b2-name">${esc(d.name)}</b><span class="b2-small">${esc(d.docType||'서류')}${d.qty?` ${esc(d.qty)}부`:''}</span>${d.due?`<span class="b2-small b2-muted">${esc(dday(d.due,today))}</span>`:''}<span class="b2-sub">${esc(d.id)}${d.submitTo?` · 제출처 ${esc(d.submitTo)}`:''}</span></li>`;
  card('docs','서류발급',`${nums([['진행 중',rows.length,rows.length?'alert':''],['새 신청(접수)',rows.filter(d=>d.status==='접수').length]])}${list(rows.slice(0,5).map(item),'진행 중인 서류발급 신청이 없습니다.')}`,go('서류발급 신청함','b2docs',{classFilter:true}));
 }
 function paintVocs(){
  const s=state('vocs','민원·이슈를 불러오는 중…');if(s)return card('vocs','민원·이슈',s,go('민원·이슈 처리함','b2vocs',{classFilter:true}));
  const rows=(parts.vocs.data?.rows||[]).filter(r=>String(r.cls)===cls&&vocOpen(r)),wait=rows.filter(vocWaiting);
  const item=r=>`<li data-voc="${esc(r.key||r.id)}"><span class="b2-badge ${VOC_TONE[r.status]||''}">${esc(r.status)}</span>${vocWaiting(r)?'<span class="b2-badge t-absent">답변 대기</span>':''}<b>${esc(r.type||'민원')}</b><span class="b2-small b2-muted">${esc(r.id||'')} · ${esc(md(r.date))}</span><span class="b2-sub">${esc(String(r.detail||'').slice(0,80))}</span></li>`;
  card('vocs','민원·이슈',`${nums([['진행 중',rows.length,rows.length?'alert':''],['답변 대기',wait.length,wait.length?'bad':'']])}${list(rows.slice(0,5).map(item),'진행 중인 민원·이슈가 없습니다.')}`,go('민원·이슈 처리함','b2vocs',{classFilter:true}));
 }
 function paintWeek(){
  const links=go('시간표','timetable')+go('교육시간 조정','b2times');
  const s=state('sched','이번 주 시간표를 불러오는 중…');if(s)return card('week','이번 주 시간표',s,links);
  const mon=mondayOf(date),fri=addDays(mon,4),rows=(parts.sched.data?.rows||[]).filter(r=>String(r.cls)===cls&&r.date>=mon&&r.date<=fri).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const dt=dayTimesCached(cls,date),field=dt&&dt.source===SOURCE_SHEET;
  const item=r=>`<li class="${r.date===date?'on':''}" data-day="${esc(r.date)}"><b>${esc(md(r.date))}</b>${r.mark==='휴일'?'<span class="b2-badge t-na">휴일</span>':`<span>${esc(r.subject||'-')}</span>${r.instructor?`<span class="b2-small b2-muted">강사 ${esc(r.instructor)}</span>`:''}${r.hours?`<span class="b2-small b2-muted">${esc(r.hours)}시간</span>`:''}${r.start&&r.end?`<span class="b2-small b2-muted">${esc(r.start)}~${esc(r.end)}</span>`:''}`}</li>`;
  card('week',`이번 주 시간표 <span class="b2-small b2-muted">${esc(md(mon))}~${esc(md(fri))}</span>`,
   `${dt?`<div class="b2-small" data-daytime>${esc(md(date))} 교육시간 <b>${esc(dt.start)}~${esc(dt.end)}</b> · 지각 기준 ${esc(dt.lateAfter)} · 조퇴 기준 ${esc(dt.earlyBefore)}${field?` <span class="b2-badge t-late">현장교육</span>${(dt.modules||[]).map(m=>`<span class="b2-sub">${esc(m.module)}${m.part?` · ${esc(m.part)}`:''} ${esc(m.start)}~${esc(m.end)}</span>`).join('')}`:''}</div>`:''}
   ${list(rows.map(item),'이번 주 시간표가 마스터시트 교육일정에 없습니다.')}`,links);
 }
 function paintMemos(){
  const s=state('memos','출결대조 메모를 불러오는 중…');
  const rows=s?[]:(parts.memos.data?.rows||[]).filter(r=>String(r.cls)===cls&&String(r.memo||'').trim()).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.name).localeCompare(String(b.name),'ko'));
  const item=r=>`<li data-memo="${esc(r.name)}"><button class="b2-btn small ghost" data-open="b2ledger" data-ctx="${esc(JSON.stringify({date:r.date}))}">${esc(md(r.date))}</button><b class="b2-name">${esc(r.name)}</b><span>${esc(r.memo)}</span>${r.by?`<span class="b2-small b2-muted">${esc(r.by)}</span>`:''}</li>`;
  // 반·날짜 공통메모(시트 v17 b2DayMemos, 2026-10-20): 고른 날짜 것과 최근 2주 것(최신 먼저 3개). 시트가 아직 v17 전이면 '시트 업데이트 대기'만.
  const dm=parts.daymemos,from=addDays(bundle()?.today||koreaNow().date,-13),dayRows=(dm?.data?.rows||[]).filter(r=>String(r.cls)===cls&&String(r.memo||'').trim()&&(r.date===date||r.date>=from)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const dayItem=r=>`<li data-daymemo="${esc(r.date)}" class="${r.date===date?'on':''}"><button class="b2-btn small ghost" data-open="b2ledger" data-ctx="${esc(JSON.stringify({date:r.date}))}">${esc(md(r.date))}</button><span class="b2-badge t-late">공통</span><span>${esc(r.memo)}</span>${r.editedBy||r.by?`<span class="b2-small b2-muted">${esc(r.editedBy||r.by)}</span>`:''}</li>`;
  const dayList=dm?.error?.code==='SHEET_OUTDATED'?'<div class="b2-tiny b2-muted" data-daymemo-wait>공통메모 · 시트 업데이트 대기</div>':dm?.data?list([...dayRows.filter(r=>r.date===date),...dayRows.filter(r=>r.date!==date).slice(0,3)].map(dayItem),''):'';
  const box=inbox(),notes=(box?.list||[]).filter(n=>String(n.cls||'')===cls).slice(0,5);
  const note=n=>`<li data-note="${esc(n.id)}">${box.isUnread?.(n)?'<span class="b2-badge t-absent">안 읽음</span>':''}<span class="b2-badge">${esc(n.kind)}</span><span>${esc(n.title||'')}</span><span class="b2-small b2-muted">${esc(whenText(createdMs(n)))}</span></li>`;
  card('memos','출결대조 메모·알림',
   `${dayList}${s||`<div class="b2-tiny b2-muted">최근 2주 · 날짜를 누르면 그날 출결대조로 갑니다.</div>${list(rows.slice(0,8).map(item),'최근 2주 출결대조 메모가 없습니다.')}${rows.length>8?`<div class="b2-tiny b2-muted">외 ${rows.length-8}건</div>`:''}`}
   ${box?`<div class="b2-small"><b>이 반 알림</b></div>${list(notes.map(note),box.ready?'이 반 알림이 없습니다.':'알림을 불러오는 중…')}`:''}`,
   go('알림함','b2notify'));
 }
 const PAINT={bundle:()=>{paintDates();paintInfo();paintDay();paintTotal();paintWeek();},drop:()=>{paintDrop();paintTotal();},docs:paintDocs,vocs:paintVocs,sched:paintWeek,memos:paintMemos,daymemos:paintMemos,check:paintDay,daytimes:()=>{paintDay();paintWeek();},officers:paintInfo};
 function paint(k){if(life.alive())PAINT[k]?.();}

 /* ---------- 읽기 ---------- */
 function loadDay(){
  if(!date)return;
  const c=cls,d=date;
  void loadDayTimes(client,c,d).then(()=>{if(c===cls&&d===date)paint('daytimes');}).catch(()=>{});
  if(db)void fetchPart('check',async()=>{
   const [{loadCheckHereDay},{matchSnapshot},{loadCheckHereIdentities}]=await Promise.all([import('./checkhere-snapshots.mjs'),import('./attendance-beta-core.mjs'),import('./checkhere-name-store.mjs')]);
   const students=rosterFor(bundle(),c).map((p,i)=>({rowIndex:i,name:p.name}));
   const [identities,records]=await Promise.all([loadCheckHereIdentities(db,c,students).catch(()=>[]),loadCheckHereDay(db,c,d)]);
   return {key:`${c}|${d}`,records,identities,match:matchSnapshot};
  });
 }
 async function loadBundle({fresh=false,quiet=false}={}){
  const before=date;
  await fetchPart('bundle',()=>client.bundle(cls,{fresh}),{quiet});
  const b=bundle();if(!b||!life.alive())return;
  const list=days();if(!date)date=list.at(-1)||b.today;
  paintDates();PAINT.bundle();
  if(!quiet||date!==before){loadDay();void loadSchedule(fresh&&!quiet);}
 }
 function loadSchedule(fresh=false){const mon=mondayOf(date||koreaNow().date);return fetchPart('sched',()=>client.schedule({cls,from:mon,to:addDays(mon,4)},{fresh}));}
 function loadMemos(quiet=false){const to=bundle()?.today||koreaNow().date;if(client.dayMemos)void fetchPart('daymemos',()=>client.dayMemos({cls}),{quiet:true});return fetchPart('memos',()=>client.call('b2LedgerMemos',{cls,from:addDays(to,-13),to}),{quiet});} // 공통메모는 반 전체(변경 번호가 같으면 다시 읽지 않음)
 function loadAll(fresh=false){
  for(const k of ['check','sched'])delete parts[k];
  void loadBundle({fresh});
  void fetchPart('drop',()=>client.dropouts({cls}));
  if(client.officers)void fetchPart('officers',()=>client.officers({cls},{fresh}));
  void fetchPart('docs',()=>client.docs({cls}));
  void fetchPart('vocs',async()=>{const d=await client.vocs({cls});if(d?.state)vocRev=d.state.rev;return d;});
  void loadMemos();
 }

 /* ---------- 이벤트 ---------- */
 $('#c2Class').onchange=e=>{cls=e.target.value;date='';vocRev=null;for(const k of Object.keys(parts))delete parts[k];for(const k of Object.keys(seqs))seqs[k]++; // 앞 반의 늦은 응답은 버림
 paintDates();loadAll();};
 $('#c2Date').onchange=e=>{const before=mondayOf(date||e.target.value);date=e.target.value;delete parts.check;PAINT.bundle();paint('memos');loadDay();if(mondayOf(date)!==before)void loadSchedule();};
 $('#c2Ledger').onclick=()=>open?.('b2ledger',{classId:cls,date:date||undefined});
 $('#c2Reload').onclick=()=>loadAll(true);
 grid.addEventListener('click',e=>{
  const b=e.target.closest('button[data-open]');if(!b)return;
  let ctx={};try{ctx=JSON.parse(b.dataset.ctx||'{}');}catch{}
  open?.(b.dataset.open,{...ctx,classId:cls});
 });
 // 변경 번호가 바뀌면(홈과 같은 1분 확인) 묶음·메모만 다시 읽습니다. 민원·이슈는 변경 번호 응답의 voc가 바뀔 때만.
 life.on(client.watch(()=>{void loadBundle({fresh:true,quiet:true});void loadMemos(true);},{current:()=>bundle()?.rev||0,interval:60000}));
 life.on(onBeta2Rev(r=>{if(!r?.voc||vocRev===null||r.voc.rev===vocRev)return;vocRev=r.voc.rev;void fetchPart('vocs',()=>client.vocs({cls}),{quiet:true});}));
 const box=inbox();if(box)life.on(box.subscribe(()=>{if(parts.memos&&!parts.memos.loading)paint('memos');}));

 loadAll();
 return {dispose:()=>life.dispose()};
}
