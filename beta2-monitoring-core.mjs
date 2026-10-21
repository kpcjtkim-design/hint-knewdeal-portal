// 2기 운영모니터링(사용자 요청 2026-10-21): 1기 '운영모니터링' 설문 링크 대신 김소윤 님 Streamlit '담임 상담일지' 양식(허락 받음)을 그대로 옮긴 화면의 순수 함수.
// 화면(beta2-monitoring.mjs)·시험(beta2-monitoring.test.mjs)이 함께 씁니다. 문항 원문은 웹에 두고 시트 머리글 Q1~Q4 원문은 시트 쪽이 맞춥니다.
// 시트 계약(2기 Apps Script, 2026-10-21 확정):
//  반 운영 점검(반·날짜마다 1건) b2Monitors {cls?,from?,to?} → {rev, items:[{key,label}], low:2, rows:[{row,date,cls,author,scores,notes,flag,confirmed,confirmedBy,confirmedAt,savedAt,editedBy,sig}]}
//   b2MonitorSave {cls,date,scores:{key:1..5}(9개 모두 필수),notes:{key:글(300자)},was?} → {ok,row,flag,sig,rev}. 내용을 고치면 관리자 확인이 풀립니다.
//   b2MonitorConfirm {cls,date,on,was?}(관리자만)
//  교육생 면담 b2Counsels {cls?,name?} → {rev, questions:[{key,label}], special:0.8, rows:[{row,cls,name,round,date,author,kind,answers,savedAt,editedBy,confirmed,confirmedBy,confirmedAt,sig}]}
//   b2CounselSave {cls,name,date,answers:{q1..q4}(각 2000자, 하나 이상),round?,was?,clientId?} → {ok,row,round,kind,rate,sig,rev}. round가 없으면 그 학생의 다음 차수.
//   kind는 저장 시점 누적 출석률 80% 미만이면 '특별상담 대상', 아니면 '일반'(시트가 정함).
//   b2CounselConfirm {cls,name,round,on,was?}(관리자만)
import {KINDS as NOTIFY_KINDS} from './notify-core.mjs';

// ── A. 반 운영 만족도 조사 (원문 그대로) ──
export const SURVEY_TITLE='반 운영 만족도 조사';
export const SURVEY_NOTICE='오늘 하루의 반 전체 운영 상태를 기준으로 평가해 주세요. 학생 개인 만족도가 아닌 담임의 운영 점검 기록입니다.';
export const SCORE_LEGEND=[[5,'매우 우수','문제 없음'],[4,'양호','경미한 보완'],[3,'보통','개선 필요'],[2,'미흡','원인 확인 필요'],[1,'매우 미흡','즉시 확인 필요']];
export const SCORE_LEGEND_TEXT='점수 기준: '+SCORE_LEGEND.map(([n,a,b])=>`${n}점 ${a}(${b})`).join(' · ');
export const LOW_NOTICE='2점 이하 항목이 있으면 관리자 화면에 확인 필요로 표시됩니다.';
export const SURVEY_SAVE='만족도 조사 저장';
export const LOW=2; // 이 점수 이하면 확인 필요(시트 low)
export const NOTE_MAX=300,ANSWER_MAX=2000;
export const ITEMS=Object.freeze([
 {key:'schedule',group:'교육 내용',label:'과정 시간표',desc:'강의 시작·종료 시간, 휴식·점심시간 등 계획된 일정이 실제로 지켜졌는지 확인합니다.'},
 {key:'content',group:'교육 내용',label:'과정 내용',desc:'당일 교육 내용이 과정 목표와 시간표에 맞고 교육생 수준에 적절했는지 확인합니다.'},
 {key:'material',group:'교육 내용',label:'교재 및 교구',desc:'교재, 실습자료 및 필요한 교구가 빠짐없이 준비되고 정상적으로 활용되었는지 확인합니다.'},
 {key:'delivery',group:'강사 역량',label:'강의 전달력',desc:'강사의 목소리, 설명 속도, 내용 구성과 질의응답이 이해하기 쉬웠는지 확인합니다.'},
 {key:'communication',group:'강사 역량',label:'학습자 소통',desc:'강사가 교육생의 질문과 어려움을 확인하고 적절하게 피드백했는지 확인합니다.'},
 {key:'participation',group:'교육생 현황·교육 환경',label:'수업 참여도',desc:'교육생이 수업·실습·질의응답에 집중하고 적극적으로 참여했는지 확인합니다.'},
 {key:'progress',group:'교육생 현황·교육 환경',label:'학습 진도',desc:'계획된 진도가 무리 없이 진행됐고 교육생이 핵심 내용을 따라오고 있는지 확인합니다.'},
 {key:'facility',group:'교육생 현황·교육 환경',label:'교육장 시설',desc:'좌석, 냉난방, 조명, 소음, 청결 등 교육 환경이 수업에 적합했는지 확인합니다.'},
 {key:'equipment',group:'교육생 현황·교육 환경',label:'교육 장비',desc:'PC, 네트워크, 빔프로젝터 및 실습 장비가 정상 작동했는지 확인합니다.'}
].map(Object.freeze));
export const ITEM_KEYS=ITEMS.map(i=>i.key);
export const GROUPS=[...new Set(ITEMS.map(i=>i.group))];

// ── B. 교육생 면담(학생 상담일지, 원문 그대로) ──
export const COUNSEL_TITLE='교육생 면담';
export const STEP1='1단계 · 상담할 학생 선택';
export const SPECIAL_NOTICE='누적 출석률 80% 미만 학생은 특별상담 대상으로 자동 분류됩니다.';
export const SPECIAL='특별상담 대상',NORMAL='일반',NORMAL_LABEL='일반학생';
export const SPECIAL_RATE=80; // 누적 출석률(%) 이 값 미만이면 특별상담 대상(시트 special 0.8)
export const step2Title=name=>`2단계 · ${name} 면담 설문 작성`;
export const SAVE_NOTICE='상담일지를 저장하면 면담 완료로 자동 처리됩니다.';
export const INTERVIEW_TITLE='1. 일반 인터뷰';
export const QUESTIONS=Object.freeze([
 {key:'q1',label:'Q1. 지금까지 진행한 교육에 대해 전반적으로 만족하나요? (어떤 교육이 가장 도움이 되었나요?)'},
 {key:'q2',label:'Q2. 교육과정을 학습하는데 어떤 어려운 점이 있나요? (교육내용, 강사역량, 교육환경 등 개선 필요 사항)'},
 {key:'q3',label:'Q3. 앞으로 교육과정을 이수하는데 예상되는 어려움이나 특별한 개인 사정이 있나요?'},
 {key:'q4',label:'Q4. 기타 특이사항'}
].map(Object.freeze));
export const Q_KEYS=QUESTIONS.map(q=>q.key);
export const COUNSEL_SAVE='상담일지 저장';
export const RECORDS_TITLE='내 반 저장 기록';

// ── 알림 ──
// 확인 필요(2점 이하) 기록을 담임이 저장하면 관리자에게 알림. 종류 '운영모니터링'은 firestore.rules validNotification 종류 목록과 notify-core KINDS에
// 함께 들어가야 저장되므로, KINDS에 아직 없으면 보내지 않습니다(규칙을 게시한 뒤 KINDS에 더하면 켜짐).
export const NOTIFY_KIND='운영모니터링';
export const notifyReady=(kinds=NOTIFY_KINDS)=>(kinds||[]).includes(NOTIFY_KIND);

const ISO=/^\d{4}-\d{2}-\d{2}$/;
export const isIso=v=>ISO.test(String(v||''));
const truthy=v=>v===true||/^(true|y|yes|1|o|확인)$/i.test(String(v??'').trim());
const num=v=>{const n=Number(v);return Number.isInteger(n)&&n>=1&&n<=5?n:null;};

// 시트 줄 → 화면 값(점수는 1~5 정수만, 없는 칸은 null/'').
export function normMonitor(r){
 const s=r?.scores&&typeof r.scores==='object'?r.scores:{},n=r?.notes&&typeof r.notes==='object'?r.notes:{};
 const scores=Object.fromEntries(ITEM_KEYS.map(k=>[k,num(s[k])])),notes=Object.fromEntries(ITEM_KEYS.map(k=>[k,String(n[k]??'')]));
 const flag=r?.flag!==undefined&&r?.flag!==''?truthy(r.flag):lowItems(scores).length>0;
 return {row:Number(r?.row)||0,cls:String(r?.cls??''),date:String(r?.date??'').slice(0,10),author:String(r?.author??''),scores,notes,flag,
  confirmed:truthy(r?.confirmed),confirmedBy:String(r?.confirmedBy??''),confirmedAt:String(r?.confirmedAt??''),savedAt:String(r?.savedAt??''),editedBy:String(r?.editedBy??''),sig:String(r?.sig??'')};
}
export function normCounsel(r){
 const a=r?.answers&&typeof r.answers==='object'?r.answers:{};
 return {row:Number(r?.row)||0,cls:String(r?.cls??''),name:String(r?.name??''),round:Number(r?.round)||0,date:String(r?.date??'').slice(0,10),author:String(r?.author??''),
  kind:String(r?.kind??'')===SPECIAL?SPECIAL:NORMAL,answers:Object.fromEntries(Q_KEYS.map(k=>[k,String(a[k]??'')])),savedAt:String(r?.savedAt??''),editedBy:String(r?.editedBy??''),
  confirmed:truthy(r?.confirmed),confirmedBy:String(r?.confirmedBy??''),confirmedAt:String(r?.confirmedAt??''),sig:String(r?.sig??'')};
}
// 2점 이하 항목(확인 필요)
export const lowItems=(scores,low=LOW)=>ITEMS.filter(i=>{const v=num(scores?.[i.key]);return v!==null&&v<=low;});
export const needsCheck=(scores,low=LOW)=>lowItems(scores,low).length>0;
export function average(scores){const v=ITEM_KEYS.map(k=>num(scores?.[k])).filter(x=>x!==null);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10:null;}

// 담임 입력 확인: 점수 9개 모두 1~5, 특이사항 300자까지. 괜찮으면 ''.
export function checkMonitor(f){
 if(!isIso(f?.date))return '날짜를 골라 주세요.';
 const miss=ITEMS.filter(i=>num(f?.scores?.[i.key])===null);
 if(miss.length)return `점수를 모두 골라 주세요: ${miss.map(i=>i.label).join(', ')}`;
 const long=ITEMS.find(i=>String(f?.notes?.[i.key]??'').length>NOTE_MAX);
 if(long)return `${long.label} 특이사항은 ${NOTE_MAX}자까지입니다.`;
 return '';
}
// 폼 → b2MonitorSave 인자(특이사항은 앞뒤 공백 없이, 빈 칸도 보내 지운 것을 반영). was: 화면이 본 기록의 sig(처음 저장이면 뺌).
export function monitorPayload(f){
 const p={cls:String(f.cls),date:f.date,scores:Object.fromEntries(ITEM_KEYS.map(k=>[k,num(f.scores[k])])),notes:Object.fromEntries(ITEM_KEYS.map(k=>[k,String(f.notes?.[k]??'').trim()]))};
 if(f.was)p.was=String(f.was);
 return p;
}
export function checkCounsel(f){
 if(!String(f?.name||'').trim())return '학생을 골라 주세요.';
 if(!isIso(f?.date))return '면담 날짜를 골라 주세요.';
 if(!Q_KEYS.some(k=>String(f?.answers?.[k]??'').trim()))return '면담 내용을 한 칸 이상 적어 주세요.';
 const long=QUESTIONS.find(q=>String(f?.answers?.[q.key]??'').length>ANSWER_MAX);
 if(long)return `${long.label.slice(0,3)} 답은 ${ANSWER_MAX}자까지입니다.`;
 return '';
}
// 폼 → b2CounselSave 인자. 새 면담(round 없음)은 clientId(한 번 누름 = 한 건), 고치기는 round + was(그 차수의 sig).
export function counselPayload(f){
 const p={cls:String(f.cls),name:String(f.name).trim(),date:f.date,answers:Object.fromEntries(Q_KEYS.map(k=>[k,String(f.answers?.[k]??'').trim()]))};
 if(f.round){p.round=Number(f.round);if(f.was)p.was=String(f.was);}
 else if(f.clientId)p.clientId=String(f.clientId);
 return p;
}

// ── 특별상담 대상·로테이션 ──
// 학생 목록(studentStats 결과: {cls,name,status,rate(%)|null,days})과 면담 기록 → 학생마다 차수·마지막 날짜·다음 차수·구분.
// 로테이션 대상: 재학(상태 없음 포함)·수료. 중도탈락·조기취업은 빼고, 면담 기록이 있으면 '그 밖' 목록으로만 보입니다.
export const ACTIVE=new Set(['','재학','수료']);
export const isSpecial=rate=>rate!==null&&rate!==undefined&&Number.isFinite(Number(rate))&&Number(rate)<SPECIAL_RATE;
export function roundText(n){return n?`${n}차 완료`:'미상담';}
export function rotation(stats,counsels,{cls=null}={}){
 const by=new Map();
 for(const c of counsels||[]){if(cls&&String(c.cls)!==String(cls))continue;const k=`${c.cls}|${c.name}`;(by.get(k)||by.set(k,[]).get(k)).push(c);}
 const students=(stats||[]).filter(s=>(!cls||String(s.cls)===String(cls))&&ACTIVE.has(String(s.status||''))).map(s=>{
  const list=(by.get(`${s.cls}|${s.name}`)||[]).slice().sort((a,b)=>a.round-b.round||a.date.localeCompare(b.date));
  const rounds=list.length?Math.max(...list.map(x=>x.round||0),list.length):0,last=list.reduce((d,x)=>x.date>d?x.date:d,'');
  const rate=s.rate===null||s.rate===undefined?null:Number(s.rate);
  return {cls:String(s.cls),name:s.name,status:s.status||'재학',rate,special:isSpecial(rate),kind:isSpecial(rate)?SPECIAL:NORMAL,rounds,count:list.length,last,next:rounds+1,status2:roundText(rounds),logs:list};
 });
 // 다음 차례: 미상담 먼저(특별상담 대상 먼저), 그다음 차수가 적은 학생, 마지막 면담이 오래된 학생, 이름순
 students.sort((a,b)=>(a.rounds>0)-(b.rounds>0)||(b.special-a.special)||a.rounds-b.rounds||a.last.localeCompare(b.last)||a.name.localeCompare(b.name,'ko'));
 const done=students.filter(s=>s.rounds>0).length,total=students.length;
 return {students,total,done,pending:total-done,percent:total?Math.round(done/total*100):0,special:students.filter(s=>s.special).length,
  specialPending:students.filter(s=>s.special&&!s.rounds).length,logs:students.reduce((n,s)=>n+s.count,0),multi:students.filter(s=>s.rounds>=2).length};
}
// 1단계 거르기: 'special' | 'normal' | 'all'
export const filterStudents=(students,filter)=>filter==='special'?students.filter(s=>s.special):filter==='normal'?students.filter(s=>!s.special):students;

// ── 관리자 ──
// 반 × 날짜 표: dates(오름차순)마다 {state:'none'|'ok'|'flag', confirmed, rec}
export function overview(records,classIds,dates){
 const at=new Map(records.map(r=>[`${r.cls}|${r.date}`,r]));
 return classIds.map(c=>({cls:String(c),cells:dates.map(d=>{const rec=at.get(`${c}|${d}`)||null;return {date:d,rec,state:rec?(rec.flag?'flag':'ok'):'none',confirmed:!!rec?.confirmed};}),
  submitted:dates.filter(d=>at.has(`${c}|${d}`)).length,flags:dates.filter(d=>at.get(`${c}|${d}`)?.flag).length,unconfirmedFlags:dates.filter(d=>{const r=at.get(`${c}|${d}`);return r?.flag&&!r.confirmed;}).length}));
}
export function pickRecords(records,{cls='all',from='',to='',flagOnly=false}={}){
 return records.filter(r=>(cls==='all'||String(r.cls)===String(cls))&&(!from||r.date>=from)&&(!to||r.date<=to)&&(!flagOnly||r.flag))
  .sort((a,b)=>b.date.localeCompare(a.date)||Number(a.cls)-Number(b.cls));
}
// CSV(내려받기): 반 운영 점검 · 상담일지
export function monitorCsv(records){
 const head=['반','날짜','작성자',...ITEMS.flatMap(i=>[`${i.label} 점수`,`${i.label} 특이사항`]),'평균','확인 필요','2점 이하 항목','운영팀 확인','확인자','확인 시각','저장 시각','고친 사람'];
 return [head,...records.map(r=>[r.cls,r.date,r.author,...ITEMS.flatMap(i=>[r.scores[i.key]??'',r.notes[i.key]||'']),average(r.scores)??'',r.flag?'확인 필요':'',lowItems(r.scores).map(i=>i.label).join(', '),r.confirmed?'확인':'',r.confirmedBy,r.confirmedAt,r.savedAt,r.editedBy])];
}
export function counselCsv(logs){
 const head=['반','이름','차수','면담 날짜','구분','작성자',...QUESTIONS.map(q=>q.label),'운영팀 확인','확인자','확인 시각','저장 시각','고친 사람'];
 return [head,...logs.map(c=>[c.cls,c.name,c.round?`${c.round}차`:'',c.date,c.kind,c.author,...Q_KEYS.map(k=>c.answers[k]||''),c.confirmed?'확인':'',c.confirmedBy,c.confirmedAt,c.savedAt,c.editedBy])];
}
// 반마다 로테이션 요약(관리자 표)
export const rotationByClass=(stats,counsels,classIds)=>classIds.map(c=>({cls:String(c),...rotation(stats,counsels,{cls:String(c)})}));
// 담임 알림 글(확인 필요). 보낼 것이 없으면 null.
export function monitorNotice(p,{flag}={}){
 const low=lowItems(p.scores);if(!(flag??low.length))return null;
 return {audience:'admins',cls:String(p.cls),title:`운영모니터링 확인 필요 · ${p.cls}반 ${p.date}`,body:`2점 이하: ${low.map(i=>`${i.label} ${p.scores[i.key]}점`).join(' · ')||'확인 필요'}`};
}
