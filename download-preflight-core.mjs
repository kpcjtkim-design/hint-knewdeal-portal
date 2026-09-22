import {isoLabel,recognized,evidenceStatus,overviewColorState,koreaToday} from './attendance-beta-core.mjs';

// Inspect the export's existing read results only. No requests or storage here.
export function inspectAttendanceExport({classId,data,stored={},from,to,period=null,details=[],today=koreaToday()}){
 const cid=String(classId),matrix=data.attendance||[],dates=(matrix[0]||[]).map((v,col)=>({date:isoLabel(v),col})).filter(d=>d.col>=4&&d.date>=from&&d.date<=to&&(!period||period.dates.includes(d.date)));
 const students=matrix.slice(1).map((row,index)=>({row,index,name:String(row[0]||'').trim()})).filter(s=>s.name),issues=[];
 const counts={classes:1,students:students.length,cells:0,missing:0,review:0,evidenceMissing:0,evidenceRejected:0,evidenceUnknown:0,future:0};
 const backgrounds=data.attendanceBackgrounds||data.backgrounds||[];let detailIndex=1;
 const add=(s,date,kind,message)=>issues.push({classId:cid,name:s.name,date,kind,message});
 for(let index=0;index<students.length;index++){
  const student=students[index],prepared=period?.students[index],id=prepared?.name===student.name?prepared.id:`${student.index}_${student.name}`;
  const saved=stored.summary?.students?.find(s=>s.id===id&&s.name===student.name);
  for(const d of dates){
   const detail=details[detailIndex++],cell=prepared?.cells.find(c=>c.date===d.date),raw=String(student.row[d.col]??'').trim(),status=cell?.status??detail?.[3]??raw;
   counts.cells++;if(d.date>today){counts.future++;continue;}
   if(!raw||raw==='미입력'){counts.missing++;add(student,d.date,'출결 공란','출결 값이 비어 있습니다.');}
   if(!period&&detail?.[6]){counts.review++;add(student,d.date,'출결 확인',String(detail[6]));}
   if(!recognized(raw)&&!recognized(status))continue;
   const meta=stored.metadata?.[d.date]?.[id],history=saved?.history?.[d.date],color=backgrounds[student.index+1]?.[d.col];
   // Missing color data is unknown, never an implicit white/unsubmitted cell.
   const knownColor=typeof color==='string'&&/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color.trim());
   const state=knownColor?evidenceStatus(color,raw,meta,overviewColorState):history?.raw===raw?history.evidenceStatus:null;
   if(state==='미제출'){counts.evidenceMissing++;add(student,d.date,'서류 미제출','증빙서류 미제출');}
   else if(state==='반려'){counts.evidenceRejected++;add(student,d.date,'서류 반려','증빙서류 보완 필요');}
   else if(!['확인','미해당'].includes(state)){counts.evidenceUnknown++;add(student,d.date,'서류 미확인','서류 상태를 확인할 자료가 없습니다.');}
  }
 }
 if(period)for(const row of period.reviews||[]){if(row[3]&&row[3]>today)continue;counts.review++;issues.push({classId:cid,name:String(row[1]||''),date:String(row[3]||''),kind:'출결·사유 확인',message:String(row[8]||'확인 필요')});}
 return {classId:cid,counts,issues};
}

export function attendanceDownloadPreflight(checks,{failures=[],label=''}={}){
 const keys=['classes','students','cells','missing','review','evidenceMissing','evidenceRejected','evidenceUnknown','future'];
 const counts=Object.fromEntries(keys.map(key=>[key,checks.reduce((n,c)=>n+(c.counts[key]||0),0)]));
 return {title:'다운로드 전 확인',label,counts,failures:failures.map(f=>({classId:String(f.classId),message:String(f.message||'자료 수집 실패')})),issues:checks.flatMap(c=>c.issues),checkhere:{checked:false,count:null}};
}
