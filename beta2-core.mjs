// 2기 베타: 마스터시트(출결원장·명부·교육일자) 자료로 출결 화면에 필요한 값을 계산합니다. 화면 없이 시험할 수 있는 순수 함수만 둡니다.
import {RULES,seconds} from './checkhere/rules.mjs';
import {surveyBaseName} from './survey-identity.mjs';

export const B2_TYPES=['출석','지각','조퇴','외출','결석','인정출석','인정지각','인정조퇴','인정외출'];
export const B2_EVIDENCE=['','미제출','반려','확인','해당없음'];
export const B2_PRESENT=new Set(['출석','지각','조퇴','외출','인정지각','인정조퇴','인정외출']);
export const recognizedType=t=>String(t||'').startsWith('인정');
// 1기 사유 표기(병결·병원·병가·진료…)와 2기 입력을 모두 질병으로 봅니다.
export const DISEASE_REASON=/병원|병결|병가|진료|질병|입원|통원|수술|치료|검진/;
export const isDiseaseReason=reason=>DISEASE_REASON.test(String(reason||''));
export const diseaseLevel=n=>n>6?'초과':n===6?'6회 도달':n>=4?'주의':'';

export function decodeBundle(raw){
 const cols=raw?.ledgerCols||[];
 const ledger=(raw?.ledger||[]).map(row=>Object.fromEntries(cols.map((k,i)=>[k,row[i]??''])));
 const roster=(raw?.roster||[]).map(([cls,name,status,changed])=>({cls:String(cls),name:String(name),status:String(status||''),changed:String(changed||'')}));
 return {rev:Number(raw?.rev)||0,today:String(raw?.today||''),days:[...(raw?.days||[])],classes:raw?.classes||[],roster,ledger,sync:raw?.sync||{}};
}
export const ledgerKey=(cls,name,date)=>`${cls}|${name}|${date}`;
export function ledgerIndex(bundle){
 const map=new Map();for(const r of bundle.ledger)map.set(ledgerKey(r.cls,r.name,r.date),r);return map;
}
export const rosterFor=(bundle,cls)=>bundle.roster.filter(p=>p.cls===String(cls));
// 2기 담임 화면 기준: 재학·빈 상태이거나, 상태 변경일(마지막 출석일)까지는 재학으로 셉니다. 그다음 교육일부터 빠집니다.
export const enrolledOn=(person,date)=>!person.status||person.status==='재학'||(!!person.changed&&person.changed>=date);
// 출결원장 T열 중 '운영총괄과 다름' 계열만 충돌입니다(사유 해석 참고 메모는 충돌이 아님). beta2.gs b2IsConflict_와 같은 기준.
export const isConflictFlag=flag=>/^운영총괄 값:|^운영총괄에는|^같은 학생/.test(String(flag||''));
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
 const c={총원:0,출석:0,결석:0,지각:0,조퇴:0,외출:0,인정:0,중복:0,확인필요:0};
 for(const r of rows){
  if(!r.enrolled&&!r.rec)continue;c.총원++;const t=r.type;
  if(t==='결석')c.결석++;else if(recognizedType(t))c.인정++;else if(['지각','조퇴','외출','중복'].includes(t))c[t]++;
  if(isConflictFlag(r.rec?.flag))c.확인필요++;
 }
 c.출석=c.총원-c.결석;return c;
}

// 학생별 기간 통계: 교육일 중 재학일만 세고, 출석률은 마스터시트와 같이 (재학 교육일 - 결석) / 재학 교육일
export function studentStats(bundle,{cls=null,from='',to=bundle.today}={},index=ledgerIndex(bundle)){
 const days=courseDays(bundle,{from,to});
 return bundle.roster.filter(p=>!cls||p.cls===String(cls)).map(p=>{
  const counts={},evidence=[],disease=[],flags=[];let enrolled=0;
  for(const d of days){
   const rec=index.get(ledgerKey(p.cls,p.name,d));
   if(!enrolledOn(p,d)&&!rec)continue;enrolled++;
   const t=rec?rec.type:'출석';counts[t]=(counts[t]||0)+1;
   if(rec&&recognizedType(t)&&['미제출','반려'].includes(rec.evApplied||(rec.ev||'미제출')))evidence.push({date:d,type:t,state:rec.evApplied||rec.ev||'미제출',evr:rec.evr||''});
   if(rec&&recognizedType(t)&&isDiseaseReason(rec.reason))disease.push(d);
   if(isConflictFlag(rec?.flag))flags.push({date:d,flag:rec.flag});
  }
  const absent=counts['결석']||0;
  return {cls:p.cls,name:p.name,status:p.status||'재학',changed:p.changed,days:enrolled,counts,absent,rate:enrolled?(enrolled-absent)/enrolled*100:null,evidence,disease,flags};
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
 return {rows:rows.sort(order),review:review.sort(order),warning:rows.filter(r=>r.count<6).length,atLimit:rows.filter(r=>r.count===6).length,exceeded:rows.filter(r=>r.count>6).length};
}

// 체크히어 기록과 출결원장 유형 대조. record: 체크히어 저장본 한 명(없으면 null)
export function compareCheckHere(type,rec,record,{today='',date='',now=null}={}){
 if(!record)return {state:'none',text:'체크히어 저장본 없음'};
 let entry,exit;
 try{entry=seconds(Object.hasOwn(record,'rawEntry')&&record.rawEntry!==undefined?record.rawEntry:record.entry);exit=seconds(record.exit);}catch{return {state:'diff',text:'체크히어 시간 형식 확인 필요'};}
 const start=seconds(RULES.start),end=seconds(RULES.end);
 const late=entry!==null&&entry>=start+(RULES.entryGrace+1)*60,early=exit!==null&&exit<end-RULES.exitGrace*60;
 const outing=(record.outings||[]).length>0||Number(record.outingCount)>0;
 const ongoing=date&&date===today&&exit===null&&(now===null||now<end);
 const hhmm=v=>v===null?'':`${String(Math.floor(v/3600)).padStart(2,'0')}:${String(Math.floor(v/60)%60).padStart(2,'0')}`;
 const base=String(type||'출석').replace(/^인정/,'');
 if(type==='인정출석')return {state:'ok',text:'종일 인정'};
 if(type==='결석'||type==='해당없음')return entry!==null||exit!==null?{state:'diff',text:`체크히어 입실 ${hhmm(entry)||'-'} · 퇴실 ${hhmm(exit)||'-'} 기록 있음`}:{state:'ok',text:'입퇴실 없음'};
 if(entry===null&&exit===null)return ongoing?{state:'pending',text:'오늘 입실 기록 아직 없음'}:{state:'diff',text:'체크히어 입퇴실 없음 · 결석 확인'};
 const notes=[];
 if(base==='지각'){if(!late)notes.push(`체크히어 입실 ${hhmm(entry)} · 지각 아님`);else if(rec?.inT&&hhmm(entry)!==rec.inT)notes.push(`입실 시간 다름 (체크히어 ${hhmm(entry)})`);}
 else if(late)notes.push(`체크히어 지각 ${hhmm(entry)}`);
 if(base==='조퇴'){if(exit!==null&&!early)notes.push(`체크히어 퇴실 ${hhmm(exit)} · 조퇴 아님`);else if(rec?.outT&&exit!==null&&hhmm(exit)!==rec.outT)notes.push(`퇴실 시간 다름 (체크히어 ${hhmm(exit)})`);}
 else if(early&&!ongoing)notes.push(`체크히어 조퇴 ${hhmm(exit)}`);
 if(base==='외출'){if(!outing)notes.push('체크히어 외출 기록 없음');}
 else if(outing)notes.push('체크히어 외출 기록 있음');
 if(exit===null&&!ongoing&&base!=='조퇴')notes.push('퇴실 기록 없음');
 if(entry===null)notes.push('입실 기록 없음');
 return notes.length?{state:'diff',text:notes.join(' · ')}:{state:ongoing?'pending':'ok',text:ongoing?'진행 중 · 지금까지 일치':'일치'};
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
// 중도탈락·수료 위험(출석률 80% 미만)
export function dropoutRows(stats,{threshold=80}={}){
 const left=stats.filter(s=>s.status&&s.status!=='재학').map(s=>({...s,verdict:s.status}));
 const risk=stats.filter(s=>(!s.status||s.status==='재학')&&s.rate!==null&&s.rate<threshold).map(s=>({...s,verdict:'수료 위험'}));
 return {left,risk};
}
export function syncText(sync,now=Date.now()){
 const ago=t=>{if(!t)return '기록 없음';const m=Math.round((now-t)/60000);return m<1?'방금':m<60?`${m}분 전`:`${Math.round(m/60)}시간 전`;};
 const last=sync?.last;
 return {checked:ago(sync?.checkedAt||last?.at),changed:ago(sync?.changedAt),error:sync?.error?.message||'',errors:last?.errors||[],stats:last?.stats||null};
}
