// 2기: 마스터시트(출결원장·명부·교육일자) 자료로 출결 화면에 필요한 값을 계산합니다. 화면 없이 시험할 수 있는 순수 함수만 둡니다.
// 2기는 운영총괄 동기화가 없어 '운영총괄과 다름' 충돌 표시·동기화 상태 글이 없습니다. 출결 시간 기준은 그날 기준(beta2-daytimes.mjs, 마스터시트 현장교육 일정) → 없으면 cohort.mjs ruleFor(공장견학 날 10:00~17:00).
import {seconds} from './checkhere/rules.mjs';
import {surveyBaseName} from './survey-identity.mjs';
import {DISEASE,COMPLETION_RATE,COURSE_START,COURSE_END,isIsoDate,mdLabel} from './cohort.mjs';
import {ruleOn,SOURCE_SHEET} from './beta2-daytimes.mjs';

export const B2_TYPES=['출석','지각','조퇴','외출','결석','인정출석','인정지각','인정조퇴','인정외출'];
export const B2_EVIDENCE=['','미제출','반려','확인','해당없음'];
export const B2_PRESENT=new Set(['출석','지각','조퇴','외출','인정지각','인정조퇴','인정외출']);
export const recognizedType=t=>String(t||'').startsWith('인정');
// 사유 표기(병결·병원·병가·진료…)를 질병으로 봅니다.
export const DISEASE_REASON=/병원|병결|병가|진료|질병|입원|통원|수술|치료|검진/;
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
export const courseDays=(bundle,{from='',to=bundle.today}={})=>bundle.days.filter(d=>(!from||d>=from)&&d<=to);
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
export function studentStats(bundle,{cls=null,from='',to=bundle.today}={},index=ledgerIndex(bundle)){
 const days=courseDays(bundle,{from,to});
 return bundle.roster.filter(p=>!cls||p.cls===String(cls)).map(p=>{
  const counts={},evidence=[],disease=[];let enrolled=0;
  for(const d of days){
   const rec=index.get(ledgerKey(p.cls,p.name,d));
   if(!enrolledOn(p,d)&&!rec)continue;enrolled++;
   const t=rec?rec.type:'출석';counts[t]=(counts[t]||0)+1;
   if(rec&&recognizedType(t)&&['미제출','반려'].includes(rec.evApplied||(rec.ev||'미제출')))evidence.push({date:d,type:t,state:rec.evApplied||rec.ev||'미제출',evr:rec.evr||''});
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
// 그것도 없으면 cohort ruleFor(공장견학 날 excursion 또는 cohort.json excursions는 10:00~17:00, 평소 09:00~18:00). 시트 기준으로 다르다고 볼 때는 '(그날 기준 10:00~17:00)'을 붙입니다.
export function compareCheckHere(type,rec,record,{today='',date='',now=null,corrected=false,excursion=false,rule=null}={}){
 if(!record)return {state:'none',text:'체크히어 저장본 없음'};
 let entry,exit,raw;
 try{raw=seconds(Object.hasOwn(record,'rawEntry')&&record.rawEntry!==undefined?record.rawEntry:record.entry);exit=seconds(record.exit);entry=corrected?seconds(record.entry):raw;}catch{return {state:'diff',text:'체크히어 시간 형식 확인 필요'};}
 const RULES=rule||ruleOn(date||record.date,{classId:record.classId??rec?.cls,excursion}),start=seconds(RULES.start),end=seconds(RULES.end),absent=type==='결석'||type==='해당없음';
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
// 중도탈락·수료 위험(출석률이 수료 기준 cohort COMPLETION_RATE % 미만)
export function dropoutRows(stats,{threshold=COMPLETION_RATE}={}){
 const left=stats.filter(s=>s.status&&s.status!=='재학').map(s=>({...s,verdict:s.status}));
 const risk=stats.filter(s=>(!s.status||s.status==='재학')&&s.rate!==null&&s.rate<threshold).map(s=>({...s,verdict:'수료 위험'}));
 return {left,risk};
}
// 교육생 상태(사용자 요청 2026-10-19 ⑦, 관리자 b2RosterStatus → 명부 D·E·I). 재학이 아니면 마지막 출석일(상태 변경일)이 꼭 있어야 합니다(시트와 같은 기준).
export const ROSTER_STATUS=Object.freeze(['재학','중도탈락','조기취업','수료']);
export function checkRosterStatus(f){
 const status=String(f?.status??'').trim(),changed=String(f?.changed??'').trim(),reason=String(f?.reason??'').trim();
 if(!ROSTER_STATUS.includes(status))return `상태는 ${ROSTER_STATUS.join('·')} 가운데 하나를 골라 주세요.`;
 if(status!=='재학'&&!changed)return '마지막 출석일을 넣어 주세요.';
 if(changed&&!isIsoDate(changed))return '마지막 출석일을 날짜로 넣어 주세요.';
 if(status!=='재학'&&changed>COURSE_END)return `마지막 출석일은 2기 교육 기간(${mdLabel(COURSE_START)}~${mdLabel(COURSE_END)}) 안이어야 합니다.`;
 if(reason.length>200)return '사유는 200자 이하로 적어 주세요.';
 return '';
}
