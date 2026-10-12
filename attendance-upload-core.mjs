import {surveyBaseName} from './survey-identity.mjs';
// HRD 출결 업로드 양식 (sheet1, 모든 칸 텍스트).
export const UPLOAD_HEADERS=['훈련과정ID','훈련과정회차','훈련생성명','생년월일성별','훈련일자','입실시간','퇴실시간','외출시작시간','외출종료시간'];
export const UPLOAD_WIDTHS=[17.25,12.375,14.625,14.375,16.5,11.75,11.75,11.875,11.875];
// 교육생 명단 '반배정_확정' 문구에서 반을 가려내는 구분어.
export const ASSIGNMENT_KEYS={1:'_서울대',2:'_한양대',3:'후인원A',4:'후인원B',5:'_청주',6:'마이크로웨이브',7:'KPC대구지부',8:'대구상공회의소',9:'경북대',10:'아르피나A',11:'부산대',12:'아르피나B',13:'부산경총',14:'_울산',15:'전남대',16:'기아오토랜드A',17:'기아오토랜드B'};

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

// records: 날짜별 최신 체크히어 기록. 결석·미수집(입퇴실 모두 없음)은 행을 만들지 않고 확인 목록에 남깁니다.
export function buildUploadRows({records,roster,courseId='',round=''}){
 const rows=[],issues=[],codes=new Map();let skipped=0;
 const sorted=[...records].sort((a,b)=>a.date.localeCompare(b.date)||String(a.name).localeCompare(String(b.name),'ko'));
 for(const r of sorted){
  const name=surveyBaseName(r.name),note=text=>issues.push({date:r.date,name,issue:text});
  if(!r.entry&&!r.exit){skipped++;note('입실·퇴실 기록이 없어 행을 만들지 않았습니다 (결석 또는 미수집)');continue;}
  const match=findStudent(r,roster);let code='';
  if(match.issue)note(match.issue+' · 생년월일성별 칸을 비웠습니다');
  else{code=birthGenderCode(match.student.birth,match.student.gender);if(!code)note('생년월일 또는 성별 형식을 읽지 못해 생년월일성별 칸을 비웠습니다');else codes.set(name,code);}
  if(!r.entry)note('입실 시각이 없습니다');
  if(!r.exit)note('퇴실 시각이 없습니다');
  const outings=(r.outings||[]).filter(o=>o&&o.start);
  if(outings.length>1)note(`외출 ${outings.length}회 · 첫 구간만 넣었습니다`);
  if(outings[0]&&!outings[0].end)note('외출 종료 시각이 없습니다');
  rows.push([String(courseId),String(round),name,code,ymd(r.date),hhmm(r.entry),hhmm(r.exit),hhmm(outings[0]?.start),hhmm(outings[0]?.end)]);
 }
 return {rows,issues,stats:{rows:rows.length,students:new Set(rows.map(r=>r[2])).size,days:new Set(rows.map(r=>r[4])).size,skipped,coded:codes.size}};
}
