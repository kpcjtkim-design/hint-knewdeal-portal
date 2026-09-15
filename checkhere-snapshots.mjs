import {collection,getDocsFromServer,onSnapshot,query,where} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {latestSnapshots} from './attendance-beta-core.mjs';
export async function loadCheckHereDay(db,classId,date){
  const snapshots=await getDocsFromServer(query(collection(db,'classes',String(classId),'checkhereSnapshots'),where('date','==',date)));
  if(snapshots.metadata?.fromCache||snapshots.metadata?.hasPendingWrites)throw Error('체크히어 DB 저장본의 서버 확인이 필요합니다.');
  return latestSnapshots(snapshots.docs.flatMap(d=>d.data().records||[]),classId,date);
}
export function watchCheckHereDay(db,classId,date,onRecords,onError){
  return onSnapshot(query(collection(db,'classes',String(classId),'checkhereSnapshots'),where('date','==',date)),{includeMetadataChanges:true},snap=>{
    if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)return;
    onRecords(latestSnapshots(snap.docs.flatMap(d=>d.data().records||[]),classId,date));
  },onError);
}
