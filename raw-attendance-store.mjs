import {collection,doc,getDocFromServer,getDocsFromServer,query,where,documentId} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {within} from './attendance-io.mjs';
// Read only the selected class/date metadata and one saved class summary.
export async function readExportAttendance(db,classId,from,to,signal){
 signal?.throwIfAborted();const id=String(classId);
 const records=[];
 const read=async(ref,label)=>{signal?.throwIfAborted();const snap=await within(getDocsFromServer(ref),30000,undefined,signal);signal?.throwIfAborted();for(const d of snap.docs)records.push({source:label,id:d.id,data:d.data()});return snap;};
 const settings=prefix=>query(collection(db,'settings'),where(documentId(),'>=',`${prefix}_${id}_${from}`),where(documentId(),'<=',`${prefix}_${id}_${to}`));
 const meta=await read(settings('attendanceBeta'),'출결 구분·서류 상태');
 await read(settings('attendanceOverviewMemo'),'메모·후속조치');
 for(const name of ['checkhereCurrent','checkhereSnapshots'])await read(query(collection(db,'classes',id,name),where('date','>=',from),where('date','<=',to)),name==='checkhereCurrent'?'체크히어 현재 저장본':'체크히어 수집 저장본');
 const snap=await within(getDocFromServer(doc(db,'attendanceBetaSummaries',id)),20000,undefined,signal),summary=snap.data()||null;
 if(summary){const scoped={...summary,dates:(summary.dates||[]).filter(d=>d>=from&&d<=to),students:(summary.students||[]).map(s=>({...s,history:Object.fromEntries(Object.entries(s.history||{}).filter(([d])=>d>=from&&d<=to))}))};records.push({source:'출결 통계 저장본',id,data:scoped});}
 signal?.throwIfAborted();return {metadata:Object.fromEntries(meta.docs.map(d=>[d.id.slice(-10),d.data().students||{}])),summary,records};
}
