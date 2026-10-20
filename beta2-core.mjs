// 2기: 마스터시트(출결원장·명부·교육일자) 자료로 출결 화면에 필요한 값을 계산합니다. 화면 없이 시험할 수 있는 순수 함수만 둡니다.
// 2기는 운영총괄 동기화가 없어 '운영총괄과 다름' 충돌 표시·동기화 상태 글이 없습니다. 출결 시간 기준은 그날 기준(beta2-daytimes.mjs, 마스터시트 현장교육 일정) → 없으면 cohort.mjs ruleFor(공장견학 날 10:00~17:00).
import {seconds} from './checkhere/rules.mjs';
import {surveyBaseName} from './survey-identity.mjs';
import {ruleFor,DISEASE,COMPLETION_RATE,isIsoDate,isTestClass} from './cohort.mjs';
import {ruleOn,SOURCE_SHEET} from './beta2-daytimes.mjs';
import {extraEvidence} from './attendance-reason-catalog.mjs'; // 취업박람회 추가 증빙(2026-10-20)

export const B2_TYPES=['출석','지각','조퇴','외출','결석','인정출석','인정지각','인정조퇴','인정외출'];
export const B2_EVIDENCE=['','미제출','반려','확인','해당없음'];
export const B2_PRESENT=new Set(['출석','지각','조퇴','외출','인정지각','인정조퇴','인정외출']);
export const recognizedType=t=>String(t||'').startsWith('인정');
// 사유 표기(병결·병원·병가·진료…)를 질병으로 봅니다.
export const DISEASE_REASON=/병원|병결|병가|진료|질병|입원|통원|수술|치료|(?<!일반\s*(?:건강\s*)?)검진/; // 일반건강검진은 질병 인정 아님(규정 0917, 2026-10-20)
export const isDiseaseReason=reason=>DISEASE_REASON.test(String(reason||''));
export const diseaseLevel=n=>n>DISEASE.max?'초과':n===DISEASE.max?`${DISEASE.max}회 도달`:n>=DISEASE.warn?'주의':'';

export function decodeBundle(raw){
 const cols=raw?.ledgerCols||[];
 const ledger=(raw?.ledger||[]).map(row=>Object.fromEntries(cols.map((k,i)=>[k,row[i]??''])));
 // 명부 [반, 이름, 상태, 상태 변경일(마지막 출석일), 상태 사유(시트가 보내면)]
 const roster=(raw?.roster||[]).map(([cls,name,status,changed,reason])=>({cls:String(cls),name:String(name),status:String(status||''),changed:String(changed||''),reason:String(reason??'')}));
 return {rev:Number(raw?.rev)||0,today:String(raw?.today||''),days:[...(raw?.days||[])],classes:raw?.classes||[],roster,ledger,sync:raw?.sync||{}};
}
export const ledgerKey=(cls,name,date)=>`${cls}|${name}|${date}`;
export function ledgerIndex(bundle){
 const map=new Map();for(const r of bundle.ledger)map.set(ledgerKey(r.cls,r.name,r.date),r);return map;
}
export const rosterFor=(bundle,cls)=>bundle.roster.filter(p=>p.cls===String(cls));
// 2기 담임 화면 기준: 재학·빈 상태이거나, 상태 변경일(마지막 출석일)까지는 재학으로 셉니다. 그다음 교육일부터 빠집니다.
export const enrolledOn=(person,date)=>!person.status||person.status==='재학'||(!!person.changed&&person.changed>=date);
// 교육일: 실제 반(1~16)은 교육일자(bundle.days)만. 17반 테스트반(cohort test, 사용자 결정 2026-10-20)은 개강 전에도 시험할 수 있게
// 그 반 출결원장에 기록이 있는 날을 모두 교육일로 봅니다(그 반 학생 모두에게, 기록 없는 학생은 출석). 공식 합계에서 빠지는 것은 그대로(studentStats).
export function classDays(bundle,cls){
 if(cls===null||cls===undefined||!isTestClass(cls))return bundle.days;
 return [...new Set([...bundle.days,...bundle.ledger.filter(r=>String(r.cls)===String(cls)&&isIsoDate(r.date)).map(r=>r.date)])].sort();
}
export const courseDays=(bundle,{from='',to=bundle.today,cls=null}={})=>classDays(bundle,cls).filter(d=>(!from||d>=from)&&d<=to);
export function teacherOf(bundle,cls){return bundle.classes.find(c=>String(c.id)===String(cls))?.teacher||'';}

// 한 반·하루: 명부 순서대로 출결원장 기록(없으면 출석, 재학 전후면 해당없음)
export function dayView(bundle,cls,date,index=ledgerIndex(bundle)){
 return rosterFor(bundle,cls).map((p,i)=>{
  const rec=index.get(ledgerKey(p.cls,p.name,date))||null,enrolled=enrolledOn(p,date);
  return {rowIndex:i,name:p.name,status:p.status,changed:p.changed,enrolled,rec,type:rec?rec.type:enrolled?'출석':'해당없음'};
 });
}
export function dayCounts(rows){
 const c={총원:0,출석:0,결석:0,지각:0,조퇴:0,외출:0,인정:0,중복:0};
 for(const r of rows){
  if(!r.enrolled&&!r.rec)continue;c.총원++;const t=r.type;
  if(t==='결석')c.결석++;else if(recognizedType(t))c.인정++;else if(['지각','조퇴','외출','중복'].includes(t))c[t]++;
 }
 c.출석=c.총원-c.결석;return c;
}

// 학생별 기간 통계: 교육일 중 재학일만 세고, 출석률은 마스터시트와 같이 (재학 교육일 - 결석) / 재학 교육일
// 출결 통계·증빙·질병 인정 모두 교육일만 셉니다(사용자 2026-10-20: 인정 출결은 교육일에만). 실제 반의 교육일이 아닌 날 인정 기록은 offDayRecords로 따로 알립니다.
export function studentStats(bundle,{cls=null,from='',to=bundle.today,withTest=false}={},index=ledgerIndex(bundle)){
 const cache=new Map(),daysOf=c=>cache.get(c)||cache.set(c,courseDays(bundle,{from,to,cls:c})).get(c);
 // 전체(cls 없음) 합계·집계에서는 시험용 테스트반(cohort test)을 뺍니다. 테스트반을 골라 보면 그 반만 보입니다.
 // withTest: 증빙서류·질병 인정 '전체 반' 목록처럼 테스트반 줄도 보여야 할 때(합계는 부르는 쪽에서 테스트반을 뺍니다).
 return bundle.roster.filter(p=>cls?p.cls===String(cls):withTest||!isTestClass(p.cls)).map(p=>{
  const counts={},evidence=[],disease=[];let enrolled=0;
  for(const d of daysOf(p.cls)){
   const rec=index.get(ledgerKey(p.cls,p.name,d));
   if(!enrolledOn(p,d)&&!rec)continue;enrolled++;
   const t=rec?rec.type:'출석';counts[t]=(counts[t]||0)+1;
   if(rec&&recognizedType(t)&&['미제출','반려'].includes(rec.evApplied||(rec.ev||'미제출')))evidence.push({date:d,type:t,state:rec.evApplied||rec.ev||'미제출',evr:rec.evr||'',reason:rec.reason||'',extra:!!extraEvidence(rec)});
   if(rec&&recognizedType(t)&&isDiseaseReason(rec.reason))disease.push(d);
  }
  const absent=counts['결석']||0;
  return {cls:p.cls,name:p.name,status:p.status||'재학',changed:p.changed,days:enrolled,counts,absent,rate:enrolled?(enrolled-absent)/enrolled*100:null,evidence,disease};
 });
}

// 질병 인정 횟수는 출결원장 인정 기록 기준. 체크히어 '인정○○ + 병원' 메모 날짜(checkhere)와 다르면 확인 필요로 따로 보여 줍니다.
// checkhere: {cls: {name: [date…]}} (포털 출결 통계 저장본의 diseaseDates)
export function diseaseReport(stats,checkhere={}){
 const rows=[],review=[];
 for(const s of stats){
  const ch=[...new Set(checkhere[s.cls]?.[s.name]||checkhere[s.cls]?.[surveyBaseName(s.name)]||[])].sort(),mine=[...new Set(s.disease)].sort();
  const onlyLedger=mine.filter(d=>!ch.includes(d)),onlyCheckHere=ch.filter(d=>!mine.includes(d));
  const row={cls:s.cls,name:s.name,count:mine.length,dates:mine,level:diseaseLevel(mine.length),onlyLedger,onlyCheckHere};
  if(row.level)rows.push(row);
  if(onlyLedger.length||onlyCheckHere.length)review.push(row);
 }
 const order=(a,b)=>b.count-a.count||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko');
 return {rows:rows.sort(order),review:review.sort(order),warning:rows.filter(r=>r.count<DISEASE.max).length,atLimit:rows.filter(r=>r.count===DISEASE.max).length,exceeded:rows.filter(r=>r.count>DISEASE.max).length};
}

// 체크히어 기록과 출결원장 유형 대조. record: 체크히어 저장본 한 명(없으면 null)
// corrected(보정 모드, 출결대조): 연결 프로그램이 고치는 교시 기록(entry)으로 지각·결석을 봅니다. 실제 입실(rawEntry)은 체크히어에서 지울 수 없어 남으므로 글로만 알립니다.
// 오늘 교시·퇴실이 모두 비면 교시 기록이 늦게 찍힐 수 있어(퇴실을 지우면 1교시도 비므로 퇴실 전엔 빌 수 있음) 유형과 관계없이 실제 입실로 봅니다. 결석도 같음: 퇴실 전 체크인한 학생이 결석으로 잘못 적힌 것을 숨기지 않습니다.
// 시간 기준은 그날·그 반 규칙: rule을 주면 그것, 아니면 기억해 둔 그날 기준(beta2-daytimes.mjs, 마스터시트 현장교육 일정의 그날 줄 — 견학일 10:00~17:00이면 지각 10:10·조퇴 16:50),
// 그것도 없으면 cohort ruleFor(공장견학 날 excursion 또는 cohort.json excursions는 10:00~17:00, 평소 09:00~18:00). 시트 기준으로 다르다고 볼 때는 '(그날 기준 10:00~17:00)'을 붙입니다. 관리자 시간 조정(overrides)을 주면 그 시간입니다.
export function compareCheckHere(type,rec,record,{today='',date='',now=null,corrected=false,excursion=false,rule=null,overrides=null}={}){
 if(!record)return {state:'none',text:'체크히어 저장본 없음'};
 let entry,exit,raw;
 try{raw=seconds(Object.hasOwn(record,'rawEntry')&&record.rawEntry!==undefined?record.rawEntry:record.entry);exit=seconds(record.exit);entry=corrected?seconds(record.entry):raw;}catch{return {state:'diff',text:'체크히어 시간 형식 확인 필요'};}
 const RULES=rule||(overrides?ruleFor(date||record.date,record.classId??rec?.cls??'',{excursion,items:overrides}):ruleOn(date||record.date,{classId:record.classId??rec?.cls,excursion})),start=seconds(RULES.start),end=seconds(RULES.end),absent=type==='결석'||type==='해당없음';
 if(corrected&&entry===null&&exit===null&&date&&date===today)entry=raw;
 const late=entry!==null&&entry>=start+(RULES.entryGrace+1)*60,early=exit!==null&&exit<end-RULES.exitGrace*60;
 const outing=(record.outings||[]).length>0||Number(record.outingCount)>0;
 const ongoing=date&&date===today&&exit===null&&(now===null||now<end);
 const hhmm=v=>v===null?'':`${String(Math.floor(v/3600)).padStart(2,'0')}:${String(Math.floor(v/60)%60).padStart(2,'0')}`;
 const real=corrected&&raw!==null&&hhmm(raw)!==hhmm(entry)?` · 실제 입실 ${hhmm(raw)}`:'';
 const base=String(type||'출석').replace(/^인정/,'');
 if(type==='인정출석')return {state:'ok',text:'종일 인정'};
 if(absent)return entry!==null||exit!==null?{state:'diff',text:`체크히어 입실 ${hhmm(entry)||'-'} · 퇴실 ${hhmm(exit)||'-'} 기록 있음${real}`}:{state:'ok',text:real?`교시 기록·퇴실 없음${real} 남음`:'입퇴실 없음'};
 if(entry===null&&exit===null)return ongoing?{state:'pending',text:'오늘 입실 기록 아직 없음'}:{state:'diff',text:real?`교시 기록·퇴실 없음${real} · 퇴실 미타각인지 확인`:'체크히어 입퇴실 없음 · 결석 확인'};
 const notes=[];
 if(base==='지각'){if(!late)notes.push(`체크히어 입실 ${hhmm(entry)} · 지각 아님`);else if(rec?.inT&&hhmm(entry)!==rec.inT)notes.push(`입실 시간 다름 (체크히어 ${hhmm(entry)})`);}
 else if(late)notes.push(`체크히어 지각 ${hhmm(entry)}`);
 if(base==='조퇴'){if(exit!==null&&!early)notes.push(`체크히어 퇴실 ${hhmm(exit)} · 조퇴 아님`);else if(rec?.outT&&exit!==null&&hhmm(exit)!==rec.outT)notes.push(`퇴실 시간 다름 (체크히어 ${hhmm(exit)})`);}
 else if(early&&!ongoing)notes.push(`체크히어 조퇴 ${hhmm(exit)}`);
 if(base==='외출'){if(!outing)notes.push('체크히어 외출 기록 없음');}
 else if(outing)notes.push('체크히어 외출 기록 있음');
 if(exit===null&&!ongoing&&base!=='조퇴')notes.push('퇴실 기록 없음');
 if(entry===null)notes.push('입실 기록 없음');
 const day=RULES.source===SOURCE_SHEET&&notes.some(n=>/지각|조퇴/.test(n))?` (그날 기준 ${RULES.start}~${RULES.end})`:'';
 return notes.length?{state:'diff',text:notes.join(' · ')+day+real}:{state:ongoing?'pending':'ok',text:(ongoing?'진행 중 · 지금까지 일치':'일치')+real};
}
// 체크히어 메모에서 사유 힌트: '(인정출석)병원_담임:…' → 병원, '지각_담임:…(교통)' → 교통. 괄호 안이 시간('지각_담임:…(09:25)')이면 사유가 아닙니다.
export function memoReason(memo){
 const s=String(memo||''),a=s.match(/^\s*\((?:인정)?[^)]*\)\s*(.+?)_담임:/);if(a)return a[1].trim();
 const b=s.match(/^(?:지각|조퇴|외출)_담임:[^(]*\((.+)\)$/),r=b?b[1].trim():'';return /^\d{1,2}:\d{2}/.test(r)?'':r;
}

// 체크히어 시간으로 입력 칸 채우기(HH:mm)
export function timesFromRecord(record){
 const t=v=>{const m=String(v||'').match(/^(\d{2}):(\d{2})/);return m?`${m[1]}:${m[2]}`:'';};
 const trip=(record?.outings||[]).find(o=>o?.start)||null;
 return {inT:t(record?Object.hasOwn(record,'rawEntry')&&record.rawEntry?record.rawEntry:record.entry:''),outT:t(record?.exit),oa:t(trip?.start),ob:t(trip?.end)};
}
// 유형에 필요한 시간만 남깁니다(시트 '입력 확인' 규칙과 같음).
export function neededTimes(type,v){
 const base=String(type||'').replace(/^인정/,'');
 return {inT:base==='지각'?v.inT||'':'',outT:base==='조퇴'?v.outT||'':'',oa:base==='외출'?v.oa||'':'',ob:base==='외출'?v.ob||'':''};
}

// 서류: 증빙 미제출·반려 목록
export function evidenceRows(stats){
 return stats.flatMap(s=>s.evidence.map(e=>({cls:s.cls,name:s.name,...e}))).sort((a,b)=>Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko')||a.date.localeCompare(b.date));
}
// 추가 증빙(취업박람회 인정 출결, 사용자 요청 2026-10-20 ③): 이행 여부(미제출·반려·확인)와 함께 모두 보입니다(못 한 것 먼저). 재학 아닌 날도 기록이 있으면 넣고(교육일만), 전체 반이면 테스트반은 뺍니다(withTest면 넣음).
export function extraEvidenceRows(bundle,{cls=null,from='',to=bundle.today,withTest=false}={}){
 const cache=new Map(),daysOf=c=>cache.get(c)||cache.set(c,new Set(courseDays(bundle,{from,to,cls:c}))).get(c);
 return bundle.ledger.filter(r=>(cls?String(r.cls)===String(cls):withTest||!isTestClass(r.cls))&&daysOf(String(r.cls)).has(r.date)).map(r=>({r,x:extraEvidence(r)})).filter(v=>v.x)
  .map(({r,x})=>({cls:String(r.cls),name:r.name,date:r.date,type:r.type,reason:r.reason||'',state:x.state,done:x.done,evr:r.evr||''}))
  .sort((a,b)=>Number(a.done)-Number(b.done)||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko')||a.date.localeCompare(b.date));
}
// 실제 반에서 교육일이 아닌 날(주말·휴일·개강 전·앞날)에 적힌 인정 기록: 통계·증빙·질병 인정에 들지 않으므로 증빙서류 화면 위에 따로 알립니다(사용자 2026-10-20).
// 테스트반은 기록 있는 날이 모두 교육일이라 여기 없습니다. from·to는 빈 값이면 끝이 없습니다.
export function offDayRecords(bundle,{cls=null,from='',to=''}={}){
 const days=new Set(bundle.days);
 return bundle.ledger.filter(r=>recognizedType(r.type)&&!isTestClass(r.cls)&&(!cls||String(r.cls)===String(cls))&&!days.has(r.date)&&(!from||r.date>=from)&&(!to||r.date<=to))
  .map(r=>({cls:String(r.cls),name:r.name,date:r.date,type:r.type,reason:r.reason||'',state:r.evApplied||r.ev||'미제출'}))
  .sort((a,b)=>Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko')||a.date.localeCompare(b.date));
}
// 중도탈락·수료 위험(출석률이 수료 기준 cohort COMPLETION_RATE % 미만)
export function dropoutRows(stats,{threshold=COMPLETION_RATE}={}){
 const left=stats.filter(s=>s.status&&s.status!=='재학').map(s=>({...s,verdict:s.status}));
 const risk=stats.filter(s=>(!s.status||s.status==='재학')&&s.rate!==null&&s.rate<threshold).map(s=>({...s,verdict:'수료 위험'}));
 return {left,risk};
}
// Apps Script 동기화 상태 글(beta2.gs b2Phase_·b2InWindow_). 2기 화면은 쓰지 않습니다. GAS 시험(beta2-sync)이 쓰므로 Apps Script 동기화를 지울 때 함께 지웁니다.
// 자동 동기화 시간 'b2InWindow_'(beta2.gs)와 같은 규칙: '1-5 09:10-18:00'(요일 1=월~7=일) 또는 'always'
const WINDOW_RE=/^([\d,\-\s]+?)\s+(\d{2}:\d{2})\s*[-~]\s*(\d{2}:\d{2})$/,DEFAULT_WINDOW='1-5 09:10-18:00';
function syncWindow(spec,now){
 const s=String(spec||DEFAULT_WINDOW).trim();if(/^(always|항상)$/i.test(s))return {text:'항상',open:true};
 const m=s.match(WINDOW_RE)||DEFAULT_WINDOW.match(WINDOW_RE),days=new Set();
 for(const part of m[1].split(',')){const [a,b=a]=part.trim().split('-').map(Number);for(let d=a;d<=b;d++)days.add(d);}
 const k=new Date(now+9*3600e3),dow=k.getUTCDay()||7,hm=k.toISOString().slice(11,16),key=[...days].join(',');
 const label={'1,2,3,4,5':'평일','1,2,3,4,5,6,7':'매일','6,7':'주말'}[key]||[...days].map(d=>'월화수목금토일'[d-1]).join('·');
 return {text:`${label} ${m[2]}~${m[3]}`,open:days.has(dow)&&hm>=m[2]&&hm<=m[3]};
}
// beta2.gs b2Phase_가 남기는 동기화 단계 이름(B2_SYNC_PHASE·B2_SYNC_CUT) → 화면 말. 'boards n'은 출결판 n번째 차례.
const SYNC_PHASES={start:'시작',drive:'운영총괄 수정 시각 확인',days:'교육일자 읽기',source:'운영총괄 읽기',colours:'증빙 색 확인',lock:'문서 잠금 기다리기',read:'출결원장 읽기',write:'출결원장 쓰기',slim:'입력 확인(Q열) 계산',done:'마무리'};
export const syncPhaseText=phase=>{const s=String(phase||''),m=s.match(/^boards (\d+)$/);return m?`출결판 그리기 ${m[1]}번째 차례`:SYNC_PHASES[s]||'';};
export function syncText(sync,now=Date.now()){
 const ago=t=>{if(!t)return '기록 없음';const m=Math.round((now-t)/60000);return m<1?'방금':m<60?`${m}분 전`:`${Math.round(m/60)}시간 전`;};
 const last=sync?.last,win=syncWindow(sync?.window,now),cutAt=Number(sync?.cutAt)||0,cut=cutAt&&cutAt>(Number(last?.at)||0)?ago(cutAt):'';
 const cutPhase=cut?syncPhaseText(sync?.cut?.phase):'';
 return {checked:ago(sync?.checkedAt||last?.at),changed:ago(sync?.changedAt),error:sync?.error?.message||'',errors:last?.errors||[],stats:last?.stats||null,
  window:win.text,resting:!win.open,cut,cutPhase,cutText:cut?`시간 초과로 중단${cutPhase?`(단계: ${cutPhase})`:''}`:''};
}
// 교육생 상태(사용자 요청 2026-10-19 ⑦, 관리자 b2RosterStatus → 명부 D·E·I). 재학이 아니면 마지막 출석일(상태 변경일)이 꼭 있어야 합니다(시트와 같은 기준).
export const ROSTER_STATUS=Object.freeze(['재학','중도탈락','조기취업','수료']);
export function checkRosterStatus(f){
 const status=String(f?.status??'').trim(),changed=String(f?.changed??'').trim(),reason=String(f?.reason??'').trim();
 if(!ROSTER_STATUS.includes(status))return `상태는 ${ROSTER_STATUS.join('·')} 가운데 하나를 골라 주세요.`;
 if(status!=='재학'&&!changed)return '마지막 출석일을 넣어 주세요.';
 if(changed&&!isIsoDate(changed))return '마지막 출석일을 날짜로 넣어 주세요.';
 // 마지막 출석일은 날짜 모양만 봅니다(교육 기간 밖도 받음, 사용자 결정 2026-10-20). 통계는 교육일만 셉니다.
 if(reason.length>200)return '사유는 200자 이하로 적어 주세요.';
 return '';
}
