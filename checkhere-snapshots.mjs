import {collection,getDocs,query,where} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {latestSnapshots} from './attendance-beta-core.mjs';
export async function loadCheckHereDay(db,classId,date){
  const snapshots=await getDocs(query(collection(db,'classes',String(classId),'checkhereSnapshots'),where('date','==',date)));
  return latestSnapshots(snapshots.docs.flatMap(d=>d.data().records||[]),classId,date);
}
