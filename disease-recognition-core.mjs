// Only an applied CheckHere memo is evidence of a hospital recognition.
// Count one education date once even when both entry and exit memos mention it.
const hospitalRecognition=/^\s*(?:\(\s*인정(?:출석|지각|조퇴|외출)\s*\)|인정(?:출석|지각|조퇴|외출))\s*[_:：(（\s-]*병원(?=$|[\s_:：)）(（])/u;
export function hasHospitalRecognition(record){
 return Boolean(record&&[record.entryMemo,record.exitMemo].some(value=>hospitalRecognition.test(String(value||''))));
}
export function diseaseRiskReport(summaries,{today='9999-12-31'}={}){
 const rows=[],reviewRows=[],missing=[];
 for(const [classId,summary] of Object.entries(summaries)){
  if(!summary){missing.push(classId);continue;}
  for(const student of summary.students||[]){
   const dates=[...new Set((student.diseaseDates||[]).filter(date=>date<=today))].sort();
   const reviewDates=[...new Set((student.diseaseReviewDates||[]).filter(date=>date<=today))].sort();
   if(reviewDates.length)reviewRows.push({classId,id:student.id,name:student.name,dates:reviewDates});
   if(dates.length<4)continue;
   rows.push({classId,id:student.id,name:student.name,count:dates.length,dates,level:dates.length>6?'초과':dates.length===6?'6회 도달':'주의'});
  }
 }
 rows.sort((a,b)=>b.count-a.count||Number(a.classId)-Number(b.classId)||a.name.localeCompare(b.name,'ko'));
 return {rows,reviewRows,missing,warning:rows.filter(row=>row.count<6).length,atLimit:rows.filter(row=>row.count===6).length,exceeded:rows.filter(row=>row.count>6).length};
}
