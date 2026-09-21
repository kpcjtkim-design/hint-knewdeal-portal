import {isoLabel,portalStatus,ATTENDANCE_OPTIONS,sheetStatus} from './attendance-beta-core.mjs';
import {classNumber} from './survey-core.mjs';
export const WEEK_START='2026-07-27';
export function weekRange(first,last){
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>104)throw Error('주차 범위를 확인해 주세요.');
 const day=n=>new Date(Date.parse(WEEK_START+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 return {from:day((first-1)*7),to:day(last*7-1)};
}
export function responseDate(value){
 if(typeof value==='number'&&Number.isFinite(value))return new Date(Math.floor(value-25569)*86400000).toISOString().slice(0,10);
 const s=String(value??'').trim();
 if(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s)){
  const d=new Date(s);return Number.isNaN(+d)?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(d);
 }
 const m=s.match(/^(\d{4})\s*[년.\/-]\s*(\d{1,2})\s*[월.\/-]\s*(\d{1,2})(?:\D|$)/);
 if(!m)return '';const date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
 const parsed=new Date(date+'T00:00:00Z');return Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===date?date:'';
}
export function attendanceTables(data,cid,from,to,{metadata={},summary=null,records=[]}={}){
 if(!Array.isArray(data.attendance)||!Array.isArray(data.attendance[0]))throw Error('출결 원본 형식을 확인하지 못했습니다.');
 const pick=matrix=>{const indices=(matrix[0]||[]).map((v,i)=>({i,date:isoLabel(v)})).filter(x=>x.i>=4&&x.date&&x.date>=from&&x.date<=to).map(x=>x.i);return indices.length?matrix.map(row=>[...Array.from({length:4},(_,i)=>row[i]??''),...indices.map(i=>row[i]??'')]):[];};
 const attendance=pick(data.attendance),reasons=pick(data.reasons||[]);
 const portal=attendance.map(r=>[...r]),details=[['반','이름','교육일','포털 출결','시트 원본 출결','적용 근거','확인 필요','통계 저장 시각']];
 for(let row=1;row<attendance.length;row++){
  const name=String(attendance[row][0]||'').trim();if(!name)continue;
  const id=`${row-1}_${name}`,saved=summary?.students?.find(s=>s.id===id&&s.name===name);
  for(let col=4;col<attendance[row].length;col++){
   const date=isoLabel(attendance[0][col]),original=attendance[row][col],raw=String(original??'').trim(),meta=metadata[date]?.[id],history=saved?.history?.[date];
   let status=original,basis='시트 원본',review='';
   if(meta?.sheetStatus===raw&&ATTENDANCE_OPTIONS.includes(meta.portalStatus)&&sheetStatus(meta.portalStatus)===raw){status=portalStatus(raw,meta);basis='포털 DB 관리자 구분';}
   else if(history?.raw===raw&&ATTENDANCE_OPTIONS.includes(history.status)){status=history.status;basis='포털 DB 통계 · '+(history.basis||'저장 구분');review=history.review?'확인 필요':'';}
   else if(meta?.portalStatus||history?.status)review='시트 변경 또는 DB 기준 불일치';
   portal[row][col]=status;details.push([String(cid),name,date,status,original,basis,review,summary?.syncedAt||'']);
  }
 }
 const stored=[['저장 구분','문서 ID','항목 경로','값']];
 const flatten=(source,id,value,path='')=>{
  if(value&&typeof value.toDate==='function'){stored.push([source,id,path,value.toDate().toISOString()]);return;}
  if(value!==null&&typeof value==='object'&&Object.keys(value).length){for(const [key,v]of Object.entries(value))flatten(source,id,v,path?path+'.'+key:key);return;}
  stored.push([source,id,path,value!==null&&typeof value==='object'?JSON.stringify(value):value??'null']);
 };
 for(const record of records)flatten(record.source,record.id,record.data);
 return [[`${cid}반 출결`,portal.length?portal:[['선택 기간의 교육일 없음']]], [`${cid}반 출결 비교`,details],[`${cid}반 가-3`,reasons.length?reasons:[['선택 기간의 가-3 원문 없음']]],[`${cid}반 DB 출결 기록`,stored]];
}
export function surveyBlock(raw,{title,from='',to='',classId='all'}){
 const find=pattern=>raw.headers.map((v,i)=>pattern.test(String(v))?i:-1).filter(i=>i>=0);
 const times=find(/타임스탬프|timestamp|응답\s*(일시|시간)/i),classes=find(/소속\s*반|분반|몇\s*반|^반$/);
 const rows=[],review=[];let outside=0;
 for(const record of raw.rows){
  const values=record.values;
  if(classId!=='all'){
   const cid=classes.length===1?classNumber(values[classes[0]]):'';
   if(!cid){review.push([title,record.rowNumber,'반 확인 불가',...values]);continue;}
   if(cid!==String(classId)){outside++;continue;}
  }
  if(from||to){
   const date=times.length===1?responseDate(values[times[0]]):'';
   if(!date){review.push([title,record.rowNumber,'응답 제출일 확인 불가',...values]);continue;}
   if(from&&date<from||to&&date>to){outside++;continue;}
  }
  rows.push(values);
 }
 return {rows:[[title],['원본 탭',raw.title,'포함 응답',rows.length],raw.headers,...rows,[]],count:rows.length,review,outside};
}
export function rawWorkbook(XLSX,tables){
 const book=XLSX.utils.book_new();
 for(const [name,rows]of tables){
  if(rows.length>1048576||rows.some(row=>row.length>16384||row.some(v=>typeof v==='string'&&v.length>32767)))throw Error('Excel 한도를 초과했습니다. 기간이나 반을 줄여 주세요. 원문은 자르지 않았습니다.');
  const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=Array.from({length:Math.max(1,...rows.slice(0,20).map(r=>r.length))},()=>({wch:22}));
  XLSX.utils.book_append_sheet(book,sheet,name);
 }return book;
}
