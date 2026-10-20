// 시간표 기준 일정(원본)의 출처는 이 파일 한 곳입니다.
// 1) 2기 마스터시트 '교육일정'(Apps Script b2Schedule): 날짜별 과목·강사·시간 수·시작·끝의 원본(사용자 2026-10-20
//    '시간표가 여기서 변경되면 담임·관리자 화면에서 반영. 그리고 관리자만 사이트에서 변경 가능. 이러면 시트에도 반영됨').
//    관리자가 사이트에서 고치면 b2ScheduleSave(관리자만)로 시트에 씁니다. 현장교육 시각은 교육시간 조정 화면(b2ModuleTimeSave).
// 2) 엑셀 일정표에서 만든 timetable-seed.json(2기 261014+261007 절충) + 교육과정 분류 보정(timetable-reference.json):
//    모듈·강의 ID·행사 구분·온라인 여부를 같은 반·같은 날 항목에서 보충하고, 시트를 못 읽으면 이것을 씁니다.
// Firestore 편집본·공개본(timetableBetaDrafts·timetableBetaPublished)은 시트를 읽을 때는 사이트에만 있는 정보(등록 강사·장소·전달사항)를
// 날짜별로 얹는 보조(overlay)이고, 시트를 못 읽을 때는 예전처럼 원본 대신 씁니다(담임: 공개본 → 엑셀 원본).
import {correctedSeed} from './timetable-reference.mjs';
import {publishEntries} from './timetable-core.mjs';
import {isTestClass,holidayName} from './cohort.mjs';
export const BASE_SOURCE_LABEL='운영팀 기준 일정(엑셀 원본)';
export const SHEET_SOURCE_LABEL='운영팀 기준 일정(마스터시트)';
export const SHEET_SOURCE_NAME='2기 마스터시트 교육일정';
let memo=null;
async function readExcel(){
 const r=await fetch('/timetable-seed.json',{cache:'no-cache'});if(!r.ok)throw Error('기준 엑셀 일정을 읽지 못했습니다.');const seed=await r.json();
 const rr=await fetch('/timetable-reference.json');if(!rr.ok)throw Error('교육과정 기준을 읽지 못했습니다.');const reference=await rr.json();
 return {seed:correctedSeed(seed,reference),reference};
}
// 엑셀 원본은 같은 페이지에서 한 번만 읽습니다(관리자 새로고침은 fresh).
function loadExcel(fresh){
 if(fresh||!memo)memo=readExcel().catch(e=>{memo=null;throw e;});
 return memo;
}
// 마스터시트 교육일정: client(beta2-data createBeta2Client)가 없으면 로그인 사용자로 만듭니다. 변경 번호(rev)가 같으면 client가 다시 읽지 않습니다.
export async function scheduleClient(client,user){
 if(client)return client;
 if(typeof user?.getIdToken!=='function')return null;
 const m=await import('./beta2-data.mjs');return m.createBeta2Client(user);
}
// {seed, reference, sheet:true|false, sheetError, rev}. 시트를 못 읽거나 비어 있으면 엑셀 원본(sheet:false).
// cls: 담임은 자기 반(서버도 담임 반으로 고정), 관리자는 비우면 전체 반.
export async function loadBaseSchedule({fresh=false,client=null,user=null,cls=''}={}){
 const excel=await loadExcel(fresh);
 let sheet=null,sheetError='';
 try{const c=await scheduleClient(client,user);if(c&&typeof c.schedule==='function')sheet=await c.schedule(cls?{cls:String(cls)}:{},{fresh});}
 catch(e){sheetError=e?.message||String(e);}
 if(!sheet?.rows?.length)return {...excel,sheet:false,sheetError};
 return {seed:sheetSeed(excel.seed,sheet),reference:excel.reference,sheet:true,sheetError:'',rev:sheet.rev??0};
}
const baseClass=(seed,cid)=>seed?.classes?.[cid]||(isTestClass(cid)?seed?.classes?.['1']:null);
// 한 반의 시트 줄 → 시간표 항목. 과목(=강의명)·강사·시간 수·시작·끝은 시트 값, 모듈·강의 ID·행사·온라인·장소는 엑셀의 같은 날 항목에서.
// 엑셀 같은 날 항목과 과목명이 다르면 seedTitle(엑셀 과목명)을 남겨 관리자 화면에 작게 표시합니다(담임에게는 뺌).
// 그 과목과 같은 이름의 강의가 강의 목록에 있으면 그 강의 ID·모듈을 씁니다. 일차는 강의별 날짜순 1, 2, 3…(엑셀과 같은 규칙).
// 휴일(mark '휴일')은 휴일 칸으로, 과목이 빈 날(주말 등)은 넣지 않습니다.
export function sheetClassEntries(seed,classId,rows){
 const cid=String(classId),base=baseClass(seed,cid)?.entries||[],byDate=new Map(base.map(e=>[e.date,e])),course=base.find(e=>e.course)?.course||'';
 const lectures=seed?.lectures||[],text=v=>String(v??'').trim(),out=[];
 for(const r of [...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)))){
  const s=byDate.get(r.date),subject=text(r.subject);
  if(r.mark==='휴일'){out.push(s?.kind==='holiday'?{...s,id:`holiday-${cid}-${r.date}`}:{id:`holiday-${cid}-${r.date}`,date:r.date,course,module:'휴일',lectureId:'',title:holidayName(r.date)||'휴일',day:0,hours:0,start:'',end:'',instructorId:'',instructorName:'',venue:'',online:false,note:'',kind:'holiday',event:''});continue;}
  if(!subject)continue;
  const lesson=s&&s.kind!=='holiday'?s:null,same=!!lesson&&(subject===lesson.title||subject===text(lesson.sourceText));
  const known=same?null:lectures.find(l=>l.title===subject&&(!course||l.course===course));
  const e={id:`x2-${cid}-${r.date}`,date:r.date,course:lesson?.course||course,module:known?.module||lesson?.module||'기타',lectureId:same?lesson.lectureId||'':known?.id||lesson?.lectureId||'',
   title:subject,day:0,hours:Number.isFinite(+r.hours)?+r.hours:0,start:text(r.start),end:text(r.end),instructorId:'',instructorName:text(r.instructor),
   venue:lesson?.venue||'',online:!!lesson?.online,note:'',kind:'class',event:lesson?.event||''};
  if(lesson&&!same)e.seedTitle=lesson.title;
  out.push(e);
 }
 const count=new Map();
 for(const e of out)if(e.kind!=='holiday'){const k=e.lectureId||e.title;count.set(k,(count.get(k)||0)+1);e.day=count.get(k);}
 return out;
}
// 시트 응답 → 엑셀 seed와 같은 모양의 기준 일정(시트에서 온 반은 sheet:true). 시트에 수업이 없는 반은 엑셀 원본 그대로.
export function sheetSeed(seed,sheet){
 const byClass=new Map();for(const r of sheet?.rows||[]){const c=String(r.cls??'');if(!byClass.has(c))byClass.set(c,[]);byClass.get(c).push(r);}
 const classes={...(seed.classes||{})};
 for(const [cid,rows] of byClass){const entries=sheetClassEntries(seed,cid,rows);if(entries.some(e=>e.kind!=='holiday'))classes[cid]={classId:cid,revision:0,entries,sheet:true};}
 return {...seed,classes,source:SHEET_SOURCE_NAME,sheet:{rev:sheet.rev??0}};
}
// 사이트에만 있는 정보: 등록 강사(연락처는 관리자만), 장소, 전달사항. 같은 날 수업(휴일 제외)에 얹습니다.
export const SITE_FIELDS=['instructorId','venue','note'];
export function overlay(sheetEntries,siteEntries=[]){
 const byDate=new Map();for(const e of siteEntries||[])if(e.kind!=='holiday'&&!byDate.has(e.date))byDate.set(e.date,e);
 return sheetEntries.map(e=>{const x=e.kind==='holiday'?null:byDate.get(e.date);if(!x)return e;const out={...e};for(const k of SITE_FIELDS)if(x[k]!==undefined)out[k]=x[k];return out;});
}
// 관리자 수정 → 마스터시트 쓰기 줄(b2ScheduleSave {rows}, 관리자만). 수정 전 화면(before: 시트+사이트 정보)과 비교해 과목·시간 수·강사 중
// 바뀐 값만 보냅니다(빠진 값은 시트가 그대로 둠). was에는 지금 시트 값(sheet)을 넣어, 그사이 시트가 바뀌었으면 Apps Script가 거절합니다.
// 수업이 빠진 날은 과목·강사를 비웁니다. 강사는 등록 강사를 고르면 그 이름, 아니면 일정표 강사명.
// 시트 교육일정은 반마다 하루 한 칸이라 같은 날 두 수업은 받지 않습니다.
export function sheetWrites(classId,next,before,sheet,instructors={}){
 const cid=String(classId);
 const byDate=(list,check)=>{const m=new Map();for(const e of list||[])if(e.kind!=='holiday'){if(check&&m.has(e.date))throw Error(`${cid}반 ${e.date}: 마스터시트 교육일정에는 반마다 하루 한 수업만 적을 수 있습니다. 다른 날로 옮기거나 맞바꿔 주세요.`);if(!m.has(e.date))m.set(e.date,e);}return m;};
 const after=byDate(next,true),prior=byDate(before),raw=byDate(sheet),name=e=>e?String(instructors[e.instructorId]?.name||e.instructorName||'').trim():'';
 const pick=e=>({subject:e?String(e.title||'').trim():'',hours:e?Number(e.hours)||0:0,instructor:name(e)});
 const out=[];
 for(const date of [...new Set([...prior.keys(),...after.keys()])].sort()){
  const a=pick(prior.get(date)),b=pick(after.get(date)),row={cls:cid,date};
  for(const k of ['subject','hours','instructor'])if(a[k]!==b[k])row[k]=b[k];
  if(Object.keys(row).length===2)continue;
  const r=raw.get(date);row.was={subject:r?String(r.title||'').trim():'',instructor:r?String(r.instructorName||'').trim():'',hours:r?Number(r.hours)||0:0};
  out.push(row);
 }
 return out;
}
// 담임에게 보일 모양: 엑셀·시트 출처와 대조 표시(sourceText·origin·review·seedTitle 등)를 빼고 시트 강사명은 그대로 둡니다.
export const teacherEntries=entries=>(entries||[]).map(({sourceText,sourceRow,seedKey,origin,review,seedTitle,...e})=>e);
// 담임에게 보여 줄 우리 반 기준 일정(시트를 못 읽고 공개본도 없을 때): 공개본과 같은 모양(출처·대조 표시 뺌).
// 17반 시험용 테스트반은 엑셀 일정이 없어서 1반 엑셀 일정을 예시로 보여 줍니다.
export function baseClassEntries(seed,classId){
 const c=baseClass(seed,String(classId??''));
 return c?publishEntries(c.entries||[],{}):[];
}
export const baseSourceLabel=(seed,classId)=>{const c=seed?.classes?.[String(classId??'')];return c?.sheet?SHEET_SOURCE_LABEL:BASE_SOURCE_LABEL+(c?'':' · 시험용 반이라 1반 일정 예시');};
