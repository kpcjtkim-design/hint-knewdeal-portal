// 2기 중도탈락·수료(사용자 요청 2026-10-20: "중도탈락 시트(gid 4002)도 관리자페이지에서 전부 처리"). 화면 없이 시험할 수 있는 순수 함수만 둡니다.
// 원본은 마스터시트 '중도탈락' 탭(A~R, Apps Script b2Dropouts·b2DropoutSave)과 명부 상태(b2Completions·b2RosterStatusMany). 판정(G·H)은 시트가 계산하지 않고 웹이 계산해 보냅니다(여기 suggestVerdict).
// 결석 한도: 2기 60교육일의 80% 출석 → 결석 12일까지 수료 가능, 13일부터 제적 대상(시트 maxAbsence, 스크립트 속성 B2_MAX_ABSENCE로 바꿀 수 있음).
// 17반 테스트반(cohort test)은 목록에는 보이고 합계(숫자 상자)에서는 뺍니다.
import {studentStats,courseDays,ledgerIndex,ledgerKey} from './beta2-core.mjs';
import {ADMINS,COURSE_START,COURSE_END,isIsoDate,isClassId,isTestClass,mdLabel} from './cohort.mjs';

export const DROPOUT_KINDS=Object.freeze(['중도탈락','조기취업']);
export const DROPOUT_VERDICTS=Object.freeze(['수료가능','제적','확인중']);
export const DROPOUT_DOCS=Object.freeze(['O','X','해당없음']);
export const DOC_FIELDS=Object.freeze([['resign','포기사유서'],['offer','채용통보'],['proof','채용인정서류']]);
export const MAX_ABSENCE=12;
// 시트 열(A~R) ↔ b2Dropouts 응답 필드. 화면 머리글·CSV가 같은 순서를 씁니다.
export const DROPOUT_COLUMNS=Object.freeze([['cls','반'],['name','이름'],['kind','구분'],['reason','사유'],['startDate','근로개시일'],['lastDate','마지막 출석일'],['verdict','판정'],['basis','판정 근거'],
 ['docs.resign','포기사유서'],['docs.offer','채용통보'],['docs.proof','채용인정서류'],['contact','연락 확인'],['note','비고'],['by','등록자'],['at','등록시각'],['confirmed','관리자 확인'],['confirmedBy','확인자'],['confirmedAt','확인시각']]);
// 담임이 신청할 때 정하는 칸(나머지 판정·근거·서류·연락 확인·관리자 확인은 관리자만, api/teacher-beta.js가 담임 요청에서 뺍니다).
// 담임은 '신청'만 합니다(사용자 2026-10-20 "담임 화면의 중도탈락은 보다 간단히 '신청' 개념"): 새 줄 만들기와 자기가 신청하고 아직 확인 전인 줄 취소만. 고치기는 운영팀.
export const TEACHER_FIELDS=Object.freeze(['name','kind','reason','startDate','lastDate','note']);

const s=v=>String(v??'').trim();
const md=mdLabel;
export const maxOf=v=>Number(v)>0?Number(v):MAX_ABSENCE;
export const dropoutKey=r=>`${s(r?.cls)}|${s(r?.name)}`;

// 결석 수준(재학생 결석 한도): 한도 초과 = 제적 대상, 한도와 같음 = 한도 도달(1일 더 결석하면 제적), 한도-2 이상 = 주의.
export function absenceLevel(n,max=MAX_ABSENCE){
 max=maxOf(max);
 if(n>max)return {level:'제적 대상',tone:'bad',left:0};
 if(n===max)return {level:'한도 도달',tone:'bad',left:0};
 if(n>=max-2)return {level:'주의',tone:'alert',left:max-n};
 return {level:'',tone:'',left:max-n};
}

// 학생별 결석(교육일·재학 기간만, beta2-core studentStats)과 결석 한도 판정. 결석 많은 순.
// withTest: 전체 반 목록에 테스트반 줄도 넣습니다(합계는 부르는 쪽이 official()로 뺌).
export function absenceRows(bundle,{cls=null,max=MAX_ABSENCE,withTest=true}={}){
 const left=courseDays(bundle,{from:bundle.today?nextDay(bundle.today):'',to:COURSE_END}).length;
 return studentStats(bundle,{cls,withTest:withTest&&!cls}).map(st=>{
  const lv=absenceLevel(st.absent,max);
  return {cls:st.cls,name:st.name,status:st.status,changed:st.changed,days:st.days,absent:st.absent,partial:st.partial,rate:st.rate,remaining:st.status==='재학'?left:0,...lv};
 }).sort((a,b)=>b.absent-a.absent||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko'));
}
const nextDay=iso=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};

// 판정 계산(시트 G·H에 넣을 값). 1기 규칙(dropout-core)과 같은 뜻:
// - 중도탈락: 제적.
// - 조기취업: 근로개시일 직전 교육일까지 출석해야 합니다. 마지막 출석일까지는 출결원장 결석, 그 뒤 근로개시 전 교육일은 미출석(결석)으로 셉니다.
//   근로개시일부터는 출석으로 봅니다. 합이 한도(12일)를 넘으면 제적, 아니면 수료가능. 셀 날이 아직 오지 않았으면 확인중.
export function suggestVerdict(row,bundle,{max=MAX_ABSENCE,index=null}={}){
 max=maxOf(max);
 const kind=s(row?.kind),cls=s(row?.cls),name=s(row?.name),last=s(row?.lastDate),start=s(row?.startDate),today=bundle?.today||'';
 if(kind==='중도탈락')return {verdict:'제적',basis:`중도탈락(조기취업 아님)${last?` · 마지막 출석 ${md(last)}`:''}`,absent:null};
 if(kind!=='조기취업')return {verdict:'확인중',basis:'구분(중도탈락·조기취업)을 골라 주세요.',absent:null};
 if(!isIsoDate(start))return {verdict:'확인중',basis:'근로개시일이 없어 계산하지 못했습니다.',absent:null};
 if(!isIsoDate(last))return {verdict:'확인중',basis:'마지막 출석일이 없어 계산하지 못했습니다.',absent:null};
 if(!bundle?.roster?.some(p=>p.cls===cls&&p.name===name))return {verdict:'확인중',basis:'명부에서 학생을 찾지 못했습니다.',absent:null};
 index=index||ledgerIndex(bundle);
 const required=courseDays(bundle,{to:COURSE_END,cls}).filter(d=>d<start);
 let recorded=0,gap=0,future=0;
 for(const d of required){
  if(d<=last){if(index.get(ledgerKey(cls,name,d))?.type==='결석')recorded++;}
  else gap++;
  if(today&&d>today&&d<=last)future++;
 }
 const absent=recorded+gap,why=`근로개시(${md(start)}) 전 결석 ${absent}일(출결원장 ${recorded}일 + 마지막 출석 뒤 미출석 ${gap}일)`;
 const order=last>=start?' · 마지막 출석일이 근로개시일보다 늦습니다(날짜 확인)':'';
 if(absent>max)return {verdict:'제적',basis:`${why} · 한도 ${max}일 초과${order}`,absent};
 if(future)return {verdict:'확인중',basis:`${why} · 마지막 출석일까지 교육일 ${future}일이 남아 있습니다${order}`,absent};
 return {verdict:'수료가능',basis:`${why} ≤ 한도 ${max}일 · 근로개시 뒤는 출석 간주${order}`,absent};
}

// 입력 확인(Apps Script b2DropoutSave_와 같은 기준 + 날짜 모양). admin=false면 관리자 칸은 보지 않습니다.
export function checkDropout(f,{admin=true}={}){
 const kind=s(f?.kind),last=s(f?.lastDate),start=s(f?.startDate),verdict=s(f?.verdict),docs=f?.docs||{};
 if(!isClassId(s(f?.cls)))return '반을 골라 주세요.';
 if(!s(f?.name))return '이름을 골라 주세요.';
 if(!DROPOUT_KINDS.includes(kind))return `구분은 ${DROPOUT_KINDS.join('·')} 가운데 하나를 골라 주세요.`;
 if(!last)return '마지막 출석일을 넣어 주세요.';
 if(!isIsoDate(last))return '마지막 출석일을 날짜로 넣어 주세요.';
 if(last>COURSE_END)return `마지막 출석일은 2기 교육 기간(${md(COURSE_START)}~${md(COURSE_END)}) 안이어야 합니다.`;
 if(kind==='조기취업'&&!start)return '조기취업은 근로개시일을 넣어 주세요.';
 if(start&&!isIsoDate(start))return '근로개시일을 날짜로 넣어 주세요.';
 if(s(f?.reason).length>200)return '사유는 200자 이하로 적어 주세요.';
 if(s(f?.note).length>300)return '비고는 300자 이하로 적어 주세요.';
 if(!admin)return '';
 if(verdict&&!DROPOUT_VERDICTS.includes(verdict))return `판정은 ${DROPOUT_VERDICTS.join('·')} 가운데 하나입니다.`;
 if(DOC_FIELDS.some(([k])=>s(docs[k])&&!DROPOUT_DOCS.includes(s(docs[k]))))return `서류는 ${DROPOUT_DOCS.join('·')} 가운데 하나로 골라 주세요.`;
 if(s(f?.basis).length>300||s(f?.contact).length>300)return '판정 근거·연락 확인은 300자 이하로 적어 주세요.';
 return '';
}

// 저장 요청(b2DropoutSave 인자). cur(고칠 줄)가 있으면 row·was를 붙입니다. 담임은 담임 칸만 보냅니다.
// confirm은 관리자 확인을 바꿀 때만 보냅니다(보내면 확인자·확인시각을 새로 적으므로).
export function savePayload(form,cur=null,{admin=true}={}){
 const p={cls:s(form.cls),name:s(form.name),kind:s(form.kind),reason:s(form.reason),startDate:s(form.startDate),lastDate:s(form.lastDate),note:s(form.note)};
 if(admin)Object.assign(p,{verdict:s(form.verdict),basis:s(form.basis),docs:Object.fromEntries(DOC_FIELDS.map(([k])=>[k,s(form.docs?.[k])])),contact:s(form.contact)});
 if(admin&&typeof form.confirmed==='boolean'&&form.confirmed!==!!cur?.confirmed)p.confirm=form.confirmed;
 return cur?{row:cur.row,was:{cls:cur.cls,name:cur.name},...p}:p;
}
// 담임 신청(b2DropoutSave 새 줄). 근로개시일은 조기취업일 때만 보냅니다.
export function requestPayload(f){
 const kind=s(f?.kind);
 return {cls:s(f?.cls),name:s(f?.name),kind,reason:s(f?.reason),startDate:kind==='조기취업'?s(f?.startDate):'',lastDate:s(f?.lastDate),note:s(f?.note)};
}
// 담임이 신청한 줄인지(등록자가 cohort.json 관리자가 아닌 이메일). 시트에 손으로 넣은 줄(등록자 없음·'Apps Script')은 담임 신청이 아닙니다.
const ADMIN_EMAILS=new Set((ADMINS||[]).map(e=>String(e).toLowerCase()));
export const byTeacher=(r,admins=ADMIN_EMAILS)=>{const by=s(r?.by).toLowerCase();return by.includes('@')&&!admins.has(by);};
// 담임 화면의 처리 상태: 관리자 확인 전 '접수', 확인 뒤 '확인 완료'.
export const requestState=r=>r?.confirmed?'확인 완료':'접수';
// 담임이 취소할 수 있는 줄: 자기가 신청했고 아직 관리자 확인 전(서버 api/teacher-beta.js와 시트도 같은 기준으로 막습니다).
export const canCancel=(r,me)=>!!r&&!r.confirmed&&!!s(me)&&s(r.by).toLowerCase()===s(me).toLowerCase();
// 시트 줄 → 편집 칸 값
export const formOf=r=>({cls:s(r?.cls),name:s(r?.name),kind:s(r?.kind)||'중도탈락',reason:s(r?.reason),startDate:s(r?.startDate),lastDate:s(r?.lastDate),verdict:s(r?.verdict),basis:s(r?.basis),
 docs:Object.fromEntries(DOC_FIELDS.map(([k])=>[k,s(r?.docs?.[k])])),contact:s(r?.contact),note:s(r?.note),confirmed:!!r?.confirmed});
export function sameForm(a,b){return JSON.stringify(formOf(a))===JSON.stringify(formOf(b));}

// 수료 명단(사용자: "중도탈락 및 수료 명단 직접 사이트에서"): 명부 학생마다 결과와 까닭.
// 결과: 수료(b2Completions: 명부 수료 + 조기취업 수료가능·관리자 확인) · 수료 예정(재학, 결석 한도 안) · 확인 대기(조기취업인데 판정·확인 전) · 미수료(중도탈락·조기취업 제적·결석 한도 초과)
export const OUTCOMES=Object.freeze(['수료','수료 예정','확인 대기','미수료']);
export function completionRows(bundle,{completions=[],dropouts=[],cls=null,max=MAX_ABSENCE,withTest=true}={}){
 max=maxOf(max);
 const done=new Map(completions.map(r=>[dropoutKey(r),r])),drop=new Map(dropouts.map(r=>[dropoutKey(r),r]));
 return studentStats(bundle,{cls,withTest:withTest&&!cls}).map(st=>{
  const key=dropoutKey(st),d=drop.get(key),c=done.get(key),status=st.status||'재학';let outcome,why;
  if(c){outcome='수료';why=c.via==='조기취업 수료'?`조기취업 · 판정 수료가능 · 관리자 확인${d?.confirmedBy?` (${d.confirmedBy})`:''}`:`명부 수료${st.changed?` · ${md(st.changed)}`:''}`;}
  else if(status==='중도탈락'){outcome='미수료';why=`중도탈락${st.changed?` · 마지막 출석 ${md(st.changed)}`:''}${d?.reason?` · ${d.reason}`:''}`;}
  else if(status==='조기취업'){
   if(!d){outcome='확인 대기';why='명부는 조기취업인데 중도탈락 탭에 등록되지 않았습니다.';}
   else if(d.verdict==='제적'){outcome='미수료';why=`조기취업 · 판정 제적${d.basis?` · ${d.basis}`:''}`;}
   else if(d.verdict==='수료가능'){outcome='확인 대기';why='조기취업 · 판정 수료가능 · 관리자 확인 전';}
   else {outcome='확인 대기';why=`조기취업 · ${d.verdict||'판정 전'}`;}
  }
  else if(status==='수료'){outcome='수료';why='명부 수료';}
  else if(st.absent>max){outcome='미수료';why=`결석 ${st.absent}일 · 한도 ${max}일 초과(제적 대상)`;}
  else {outcome='수료 예정';why=`재학 · 결석 ${st.absent}일 / 한도 ${max}일`;}
  return {cls:st.cls,name:st.name,status,changed:st.changed,absent:st.absent,outcome,why};
 }).sort((a,b)=>OUTCOMES.indexOf(a.outcome)-OUTCOMES.indexOf(b.outcome)||Number(a.cls)-Number(b.cls)||a.name.localeCompare(b.name,'ko'));
}
// 공식 합계(숫자 상자): 전체 반이면 테스트반을 뺍니다.
export const official=(rows,cls='all')=>cls==='all'?rows.filter(r=>!isTestClass(r.cls)):rows;

// 여러 명 상태 바꾸기(b2RosterStatusMany, 관리자): Vercel 요청 크기(2만 자) 안에 들게 반마다 나눕니다.
export function statusBatches(items,{size=60}={}){
 const by=new Map();for(const it of items){const k=s(it.cls);if(!by.has(k))by.set(k,[]);by.get(k).push(it);}
 const out=[];for(const list of by.values())for(let i=0;i<list.length;i+=size)out.push(list.slice(i,i+size));
 return out;
}
