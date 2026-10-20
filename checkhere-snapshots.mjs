import {collection,doc,getDocFromServer,getDocsFromServer,onSnapshot,query,where} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {latestSnapshots} from './attendance-beta-core.mjs';
// 날짜가 비면(개강 전이라 고를 교육일이 없을 때 등) 문서 주소가 classes/반/checkhereCurrent로 끝나 Firestore가 '홀수 구간' 오류를 내므로 읽지 않습니다(2026-10-20).
const validDay=date=>/^\d{4}-\d{2}-\d{2}$/.test(String(date??''));
export async function loadLegacyCheckHereDay(db,classId,date){
 if(!validDay(date))return [];
 const snap=await getDocsFromServer(query(collection(db,'classes',String(classId),'checkhereSnapshots'),where('date','==',date)));
 if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('체크히어 DB 저장본의 서버 확인이 필요합니다.');
 return latestSnapshots(snap.docs.flatMap(d=>d.data().records||[]),classId,date);
}
export async function loadCheckHereDay(db,classId,date){
 if(!validDay(date))return [];
 const snap=await getDocFromServer(doc(db,'classes',String(classId),'checkhereCurrent',date));
 if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('체크히어 DB 저장본의 서버 확인이 필요합니다.');
 return snap.exists()?latestSnapshots(snap.data().records||[],classId,date):loadLegacyCheckHereDay(db,classId,date);
}
export function watchCheckHereDay(db,classId,date,onRecords,onError){
 if(!validDay(date))return ()=>{}; // 빈 날짜는 구독하지 않음(위 loadCheckHereDay와 같음)
 // Subscribe to one current-day document, never the accumulated history.
 return onSnapshot(doc(db,'classes',String(classId),'checkhereCurrent',date),{includeMetadataChanges:true},snap=>{
  if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!snap.exists())return;
  onRecords(latestSnapshots(snap.data().records||[],classId,date));
 },onError);
}
