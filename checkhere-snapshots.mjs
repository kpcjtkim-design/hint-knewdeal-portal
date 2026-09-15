import {collection,doc,getDocFromServer,getDocsFromServer,onSnapshot,query,where} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {latestSnapshots} from './attendance-beta-core.mjs';
export async function loadLegacyCheckHereDay(db,classId,date){
 const snap=await getDocsFromServer(query(collection(db,'classes',String(classId),'checkhereSnapshots'),where('date','==',date)));
 if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('체크히어 DB 저장본의 서버 확인이 필요합니다.');
 return latestSnapshots(snap.docs.flatMap(d=>d.data().records||[]),classId,date);
}
export async function loadCheckHereDay(db,classId,date){
 const snap=await getDocFromServer(doc(db,'classes',String(classId),'checkhereCurrent',date));
 if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('체크히어 DB 저장본의 서버 확인이 필요합니다.');
 return snap.exists()?latestSnapshots(snap.data().records||[],classId,date):loadLegacyCheckHereDay(db,classId,date);
}
export function watchCheckHereDay(db,classId,date,onRecords,onError){
 // Subscribe to one current-day document, never the accumulated history.
 return onSnapshot(doc(db,'classes',String(classId),'checkhereCurrent',date),{includeMetadataChanges:true},snap=>{
  if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!snap.exists())return;
  onRecords(latestSnapshots(snap.data().records||[],classId,date));
 },onError);
}
