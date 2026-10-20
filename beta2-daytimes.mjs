// 그날·그 반 교육시간과 지각·조퇴 기준(사용자 요청 2026-10-19 ④: 공장견학·분해조립처럼 HRD 확정 전인 날은 관리자가 시간을 조정).
// 원본은 2기 마스터시트 「현장교육 일정」 탭 O~T(시작·끝·구간·사유·수정자·시각), Apps Script b2ModuleTimes·b2DayTimes·b2ModuleTimeSave(apps-script/beta2/beta2.gs).
// 규칙(Apps Script b2DayTimeOf_와 같음): 그날 그 반 줄 가운데 시작·끝이 다 있는 줄의 가장 이른 시작 ~ 가장 늦은 끝, 없으면 평소 09:00~18:00. 지각은 시작+10분을 넘으면, 조퇴는 끝-10분 전.
// 판정(beta2-core compareCheckHere)은 여기 기억해 둔 그날 기준(b2DayTimes, 반·날짜마다 한 번 읽기)을 먼저 보고, 없거나 못 읽었으면 cohort.mjs ruleFor(평소·견학 기본)로 돌아갑니다.
import {ruleFor,BASE_RULE,EXCURSION_RULE,isIsoDate,isClassId} from './cohort.mjs';

export const SOURCE_DEFAULT='기본',SOURCE_SHEET='현장교육 일정';
// 평소 09:00~18:00, 지각·조퇴 여유 10분, 공장견학 기본 10:00~17:00(사용자 결정 2026-10-19). 응답의 defaults·field가 오면 그 값을 씁니다.
export const DAY_DEFAULTS=Object.freeze({start:BASE_RULE.start,end:BASE_RULE.end,graceMin:BASE_RULE.entryGrace,field:Object.freeze([EXCURSION_RULE.start,EXCURSION_RULE.end])});
// 화면에서 고를 수 있는 시간(관리자 입력 확인). 시트는 HH:mm이면 받습니다.
export const TIME_RANGE=Object.freeze({min:'08:00',max:'20:00'});
const HHMM=/^([01]\d|2[0-3]):([0-5]\d)$/;
export const isHHmm=v=>HHMM.test(String(v??''));
export const minutes=v=>{const m=HHMM.exec(String(v??''));return m?+m[1]*60+ +m[2]:NaN;};
export const hhmmOf=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
// 입력 값 정리: '9:5'·'0930'·'09:30:00' → '09:30'. 못 읽으면 앞뒤 공백만 뺀 그대로(입력 확인이 잡음)
export function cleanTime(v){
 const s=String(v??'').trim(),m=/^(\d{1,2}):?(\d{2})(?::\d{2})?$/.exec(s);
 return m&&+m[1]<24&&+m[2]<60?`${m[1].padStart(2,'0')}:${m[2]}`:s;
}

// 그날 기준 계산(시트와 같은 규칙). rows: b2ModuleTimes rows. 화면 미리보기·저장 전 확인에 씁니다(저장 뒤에는 응답의 day가 원본).
export function dayTimesOf(rows,date,cls,{defaults=DAY_DEFAULTS}={}){
 const hit=(rows||[]).filter(r=>r.date===date&&String(r.cls)===String(cls)&&isHHmm(r.start)&&isHHmm(r.end)&&minutes(r.end)>minutes(r.start));
 const g=Number.isFinite(+defaults.graceMin)?+defaults.graceMin:DAY_DEFAULTS.graceMin;
 const start=hit.length?hit.map(r=>r.start).sort()[0]:defaults.start,end=hit.length?hit.map(r=>r.end).sort().at(-1):defaults.end;
 return {date,cls:String(cls),start,end,lateAfter:hhmmOf(minutes(start)+g),earlyBefore:hhmmOf(minutes(end)-g),source:hit.length?SOURCE_SHEET:SOURCE_DEFAULT,modules:hit.map(({row,module,start,end,part})=>({row,module,start,end,part}))};
}
export const dayRuleText=d=>`지각 기준 ${d.lateAfter} · 조퇴 기준 ${d.earlyBefore}`;
export const dayText=d=>`${d.start}~${d.end} · ${dayRuleText(d)}`;

// b2DayTimes 응답 → 판정 규칙(cohort ruleFor와 같은 모양: start·end·entryGrace·exitGrace). 여유는 lateAfter·earlyBefore에서 거꾸로 셉니다.
export function ruleFromDayTimes(d){
 if(!d||!isHHmm(d.start)||!isHHmm(d.end)||minutes(d.end)<=minutes(d.start))return null;
 const g=DAY_DEFAULTS.graceMin,late=isHHmm(d.lateAfter)?minutes(d.lateAfter)-minutes(d.start):g,early=isHHmm(d.earlyBefore)?minutes(d.end)-minutes(d.earlyBefore):g;
 const sheet=d.source===SOURCE_SHEET;
 return Object.freeze({...BASE_RULE,version:`${BASE_RULE.version}-${sheet?'sheet':'base'}`,start:d.start,end:d.end,entryGrace:late>=0?late:g,exitGrace:early>=0?early:g,
  excursion:sheet,source:sheet?SOURCE_SHEET:SOURCE_DEFAULT,lateAfter:hhmmOf(minutes(d.start)+(late>=0?late:g)),earlyBefore:hhmmOf(minutes(d.end)-(early>=0?early:g))});
}

// 기억: 'cls|date' → {at, rule, day, error}. 같은 페이지의 모든 2기 화면이 함께 씁니다(같은 모듈 주소 ./beta2-daytimes.mjs).
const TTL=10*60000,FAIL_TTL=60000,cache=new Map(),inflight=new Map();
const keyOf=(cls,date)=>`${String(cls??'').trim()}|${String(date??'').trim()}`;
export const dayRule=(cls,date)=>cache.get(keyOf(cls,date))?.rule||null;
export const dayTimesCached=(cls,date)=>cache.get(keyOf(cls,date))?.day||null;
export const dayTimesError=(cls,date)=>cache.get(keyOf(cls,date))?.error||'';
// 저장 응답의 day를 바로 기억합니다(교육시간 조정 화면 → 출결대조가 다시 묻지 않고 새 기준으로 판정).
export function rememberDayTimes(day,{now=Date.now}={}){
 const rule=ruleFromDayTimes(day);if(!rule||!isIsoDate(day.date))return null;
 cache.set(keyOf(day.cls,day.date),{at:now(),rule,day:{...day,cls:String(day.cls)},error:''});return rule;
}
export function forgetDayTimes(cls=null,date=null){for(const k of [...cache.keys()]){const [c,d]=k.split('|');if((cls===null||c===String(cls))&&(date===null||d===date))cache.delete(k);}}
// 판정 규칙: 기억한 그날 기준 → 없으면 cohort 기본(평소 09:00~18:00, cohort.json excursions·excursion이면 10:00~17:00).
export function ruleOn(date,{classId='',excursion=false}={}){return dayRule(classId,date)||ruleFor(date,{classId,excursion});}
// 반·날짜마다 한 번 읽습니다(10분 기억). 못 읽으면 1분 동안 다시 묻지 않고, 전에 읽은 기준이 있으면 그것을, 없으면 기본 기준을 씁니다.
// client: createBeta2Client(...) — call('b2DayTimes',{date,cls})만 씁니다. 판정 기준이 바뀌었으면 true(화면을 다시 그리라는 뜻).
export async function loadDayTimes(client,cls,date,{fresh=false,now=Date.now}={}){
 const c=String(cls??'').trim(),d=String(date??'').trim(),k=keyOf(c,d);
 if(!client?.call||!isClassId(c)||!isIsoDate(d))return false;
 if(inflight.has(k))return inflight.get(k);
 const hit=cache.get(k);
 if(hit&&!fresh&&now()-hit.at<(hit.error?FAIL_TTL:TTL))return false;
 const before=JSON.stringify(hit?.rule||null);
 const run=(async()=>{
  try{const day=await client.call('b2DayTimes',{date:d,cls:c}),rule=ruleFromDayTimes(day);if(!rule)throw Error('그날 교육시간 응답을 읽지 못했습니다.');cache.set(k,{at:now(),rule,day:{...day,cls:c,date:d},error:''});}
  catch(e){cache.set(k,{at:now(),rule:hit?.rule||null,day:hit?.day||null,error:String(e?.message||e)});}
  finally{inflight.delete(k);}
  return JSON.stringify(cache.get(k)?.rule||null)!==before;
 })();
 inflight.set(k,run);return run;
}

// 교육시간 저장 전 확인(관리자 화면). 맞으면 '', 아니면 고칠 것 한 문장. existing: 시트에 있던 줄을 고침(사유 필수).
export function checkModuleTime(f,{existing=false}={}){
 const start=cleanTime(f?.start),end=cleanTime(f?.end),module=String(f?.module??'').trim(),part=String(f?.part??'').trim(),reason=String(f?.reason??'').trim();
 if(!isIsoDate(f?.date))return '날짜를 골라 주세요.';
 // 교육 기간 밖·교육일이 아닌 날도 정할 수 있습니다(사용자 결정 2026-10-20 '수정 자체는 언제든 유연하게'). 날짜 모양만 봅니다.
 if(!isClassId(f?.cls))return '반을 골라 주세요.';
 if(!module)return '모듈 이름을 적어 주세요.';
 if(module.length>60)return '모듈 이름은 60자 이하로 적어 주세요.';
 if(!isHHmm(start)||!isHHmm(end))return '시작·끝 시간은 10:00처럼 넣어 주세요.';
 if(start<TIME_RANGE.min||end>TIME_RANGE.max)return `교육시간은 ${TIME_RANGE.min}~${TIME_RANGE.max} 안에서 정해 주세요.`;
 if(minutes(end)<=minutes(start))return '끝 시간이 시작보다 늦어야 합니다.';
 if(part.length>60)return '구간은 60자 이하로 적어 주세요.';
 if(existing&&!reason)return '시간을 고칠 때는 사유를 적어 주세요. (예: HRD 확정 전 임시)';
 if(reason.length>200)return '사유는 200자 이하로 적어 주세요.';
 return '';
}
