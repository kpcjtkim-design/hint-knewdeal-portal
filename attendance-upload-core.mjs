import {REAL_CLASSES as CLASSES} from './cohort.mjs';// HRD 업로드 반배정은 공식 반만(시험용 테스트반 뺌)
import {surveyBaseName} from './survey-identity.mjs';
// HRD 출결 업로드 양식 (sheet1, 모든 칸 텍스트).
export const UPLOAD_HEADERS=['훈련과정ID','훈련과정회차','훈련생성명','생년월일성별','훈련일자','입실시간','퇴실시간','외출시작시간','외출종료시간'];
export const UPLOAD_WIDTHS=[17.25,12.375,14.625,14.375,16.5,11.75,11.75,11.875,11.875];
// 교육생 명단 '반배정_확정' 문구에서 반을 가려내는 구분어(2기 16개 반, cohort.json rosterKey). 2기 명단의 실제 표기가 다르면 cohort.json만 고칩니다.
export const ASSIGNMENT_KEYS=Object.freeze(Object.fromEntries(CLASSES.map(c=>[c.id,c.rosterKey])));

function birthParts(value){
 if(value instanceof Date&&!Number.isNaN(+value))return [value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate()];
 const m=String(value??'').trim().match(/^(\d{4})\s*[.\-\/년]?\s*(\d{1,2})\s*[.\-\/월]?\s*(\d{1,2})/);
 return m?[+m[1],+m[2],+m[3]]:null;
}
function genderOf(value){
 const s=String(value??'').trim().toLowerCase();
 return /^(남|남성|남자|m|male)$/.test(s)?'M':/^(여|여성|여자|f|female)$/.test(s)?'F':'';
}
// 생년월일 6자리 + 성별 1자리. 1900년대생 남1·여2, 2000년대생 남3·여4.
export function birthGenderCode(birth,gender){
 const p=birthParts(birth),g=genderOf(gender);if(!p||!g)return '';
 const [y,m,d]=p,check=new Date(Date.UTC(y,m-1,d));
 if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d||y<1900||y>2099)return '';
 const digit=y<2000?(g==='M'?1:2):(g==='M'?3:4);
 return String(y%100).padStart(2,'0')+String(m).padStart(2,'0')+String(d).padStart(2,'0')+digit;
}
export const hhmm=t=>{const m=String(t??'').match(/^(\d{1,2}):(\d{2})/);return m?m[1].padStart(2,'0')+m[2]:'';};
export const ymd=date=>String(date).replace(/-/g,'');
const last4=v=>String(v??'').replace(/\D/g,'').slice(-4);
const birthYear=name=>{const m=String(name??'').match(/\((\d{2}|\d{4})년생\)$/);return m?m[1].slice(-2):'';};

// 교육생 명단 시트(2차원 배열)에서 한 반의 이름·성별·생년월일·전화번호만 뽑습니다.
export function rosterFromSheet(rows,classId){
 const key=ASSIGNMENT_KEYS[String(classId)];if(!key)throw Error('반 번호를 확인해 주세요.');
 const at=rows.findIndex(r=>Array.isArray(r)&&['이름','성별','생년월일','반배정_확정'].every(h=>r.map(v=>String(v??'').trim()).includes(h)));
 if(at<0)throw Error("명단에서 '이름·성별·생년월일·반배정_확정' 머리글을 찾지 못했습니다.");
 const head=rows[at].map(v=>String(v??'').trim()),col=h=>head.indexOf(h),phone=head.findIndex(h=>/핸드폰|휴대폰|전화/.test(h));
 return rows.slice(at+1).filter(r=>r&&String(r[col('이름')]??'').trim()&&String(r[col('반배정_확정')]??'').includes(key))
  .map(r=>({name:String(r[col('이름')]).trim(),birth:r[col('생년월일')],gender:r[col('성별')],phone:phone<0?'':String(r[phone]??'')}));
}

function findStudent(record,roster){
 const base=surveyBaseName(record.name);let found=roster.filter(s=>surveyBaseName(s.name)===base);
 if(found.length>1&&record.phoneLast4)found=found.filter(s=>last4(s.phone)===String(record.phoneLast4));
 if(found.length>1&&birthYear(record.name))found=found.filter(s=>String(birthParts(s.birth)?.[0]??'').slice(-2)===birthYear(record.name));
 return found.length===1?{student:found[0]}:{issue:found.length?'동명이인 · 명단에서 한 사람으로 가리지 못했습니다':'교육생 명단에 없는 이름입니다'};
}

// ExcelJS 시트를 앞 40칸까지의 2차원 값 배열로 바꿉니다(수식·서식 문자열은 표시값으로).
const cellValue=v=>v&&typeof v==='object'&&!(v instanceof Date)?(v.result??v.text??(Array.isArray(v.richText)?v.richText.map(t=>t.text).join(''):'')):v;
export function sheetRows(ws){const rows=[];ws.eachRow({includeEmpty:true},(row,i)=>{rows[i-1]=(row.values||[]).slice(1,41).map(cellValue);});return rows;}
// 업로드 양식과 같은 sheet1: 머리글 + 행, 모든 칸 텍스트(@).
export function uploadWorkbook(ExcelJS,rows){
 const book=new ExcelJS.Workbook(),ws=book.addWorksheet('sheet1');
 UPLOAD_WIDTHS.forEach((w,i)=>{const c=ws.getColumn(i+1);c.width=w;c.numFmt='@';});
 for(const values of [UPLOAD_HEADERS,...rows]){const row=ws.addRow(values.map(v=>v===''?null:String(v)));for(let i=1;i<=UPLOAD_HEADERS.length;i++)row.getCell(i).numFmt='@';}
 return book;
}

// 출결 기준은 체크히어 수집 → Firebase 저장본입니다. 입실은 실제 타각(rawEntry), 없으면 교시 기록(entry)을 씁니다.
const entryOf=r=>r.rawEntry??r.entry;
// 체크히어 외출 구간이 없을 때, 체크히어 관리자 메모의 '외출…(HH:MM~HH:MM)'을 씁니다(00:00~00:00은 무시).
function memoOuting(r){
 for(const memo of [r.entryMemo,r.exitMemo]){
  if(!/외출/.test(String(memo??'')))continue;
  const m=String(memo).match(/\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)/);
  if(m&&!(hhmm(m[1])==='0000'&&hhmm(m[2])==='0000'))return {start:m[1],end:m[2]};
 }
 return null;
}
// records: 날짜별 최신 체크히어 기록. 결석·미수집(입퇴실 모두 없음)도 시각을 비운 채 행을 남기고 확인 목록에 표시합니다.
// leavers: 중도포기 학생(이름 → 표시). 마지막 출석일(입실·퇴실 시각이 있는 마지막 날)까지만 행을 만듭니다.
export function buildUploadRows({records,roster,courseId='',round='',leavers=new Map()}){
 const rows=[],issues=[],codes=new Map(),last=new Map(),cut=new Map();let empty=0;
 for(const r of records)if(entryOf(r)||r.exit){const n=surveyBaseName(r.name);if(!last.has(n)||r.date>last.get(n))last.set(n,r.date);}
 const sorted=[...records].sort((a,b)=>a.date.localeCompare(b.date)||String(a.name).localeCompare(String(b.name),'ko'));
 for(const r of sorted){
  const name=surveyBaseName(r.name),note=text=>issues.push({date:r.date,name,issue:text});
  if(leavers.has(name)&&!(last.has(name)&&r.date<=last.get(name))){cut.set(name,(cut.get(name)||0)+1);continue;}
  const match=findStudent(r,roster);let code='';
  if(match.issue)note(match.issue+' · 생년월일성별 칸을 비웠습니다');
  else{code=birthGenderCode(match.student.birth,match.student.gender);if(!code)note('생년월일 또는 성별 형식을 읽지 못해 생년월일성별 칸을 비웠습니다');else codes.set(name,code);}
  const entry=entryOf(r);
  if(!entry&&!r.exit){empty++;note('입실·퇴실 기록이 없어 시각을 비운 채 행을 남겼습니다 (결석 또는 미수집)');}
  else if(!entry)note('입실 시각이 없습니다');
  else if(!r.exit)note('퇴실 시각이 없습니다');
  const detail=(r.outings||[]).filter(o=>o&&o.start),fromMemo=detail.length?null:memoOuting(r);
  const outing=detail[0]||fromMemo,count=Math.max(Number(r.outingCount)||0,detail.length);
  if(detail.length>1)note(`외출 ${detail.length}회 · 첫 구간만 넣었습니다`);
  if(fromMemo)note('외출 시각은 체크히어 관리자 메모 값을 넣었습니다');
  if(!outing&&count)note(`체크히어 외출 ${count}회 · 외출 시각이 수집되지 않아 비웠습니다 (해당 날짜 다시 수집 필요)`);
  else if(outing&&!outing.end)note('외출 종료 시각이 없습니다');
  rows.push([String(courseId),String(round),name,code,ymd(r.date),hhmm(entry),hhmm(r.exit),hhmm(outing?.start),hhmm(outing?.end)]);
 }
 for(const [name,days] of cut)issues.push({date:last.get(name)||'',name,issue:last.has(name)?`${leavers.get(name)} · 마지막 출석일(${last.get(name)}) 다음 ${days}일은 행을 만들지 않았습니다`:`${leavers.get(name)} · 이 기간에 출석 기록이 없어 ${days}일 모두 행을 만들지 않았습니다`});
 issues.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.name.localeCompare(b.name,'ko'));
 return {rows,issues,stats:{rows:rows.length,students:new Set(rows.map(r=>r[2])).size,days:new Set(rows.map(r=>r[4])).size,empty,coded:codes.size,leavers:cut.size,cut:[...cut.values()].reduce((a,b)=>a+b,0)}};
}
