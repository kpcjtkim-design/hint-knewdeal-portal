import {collection,doc,getDoc,getDocs,setDoc,query,where,documentId,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {deriveAttendanceClass} from './attendance-derived-core.mjs';
import {within,readJson} from './attendance-io.mjs';
const inFlight=new Map();
export const readAttendanceSummary=async(db,classId)=>(await within(getDoc(doc(db,'attendanceBetaSummaries',String(classId))),20000)).data()||null;
export function syncAttendanceSummary(db,user,classId,data=null){
 const key=String(classId);if(inFlight.has(key))return data?inFlight.get(key).catch(()=>{}).then(()=>syncAttendanceSummary(db,user,classId,data)):inFlight.get(key);
 const work=(async()=>{
  const sheet=data||await readJson('/api/attendance-reader',{classId:key,idToken:await within(user.getIdToken()),allowCache:true},{timeout:55000});
  const [metas,snaps,tt,old]=await Promise.all([
   getDocs(query(collection(db,'settings'),where(documentId(),'>=',`attendanceBeta_${key}_`),where(documentId(),'<',`attendanceBeta_${key}_\uf8ff`))),
   getDocs(collection(db,'classes',key,'checkhereSnapshots')),getDoc(doc(db,'timetableBetaPublished',key)),readAttendanceSummary(db,key)
  ].map(p=>within(p,30000)));
  const metadata=Object.fromEntries(metas.docs.map(d=>[d.id.slice(-10),d.data().students||{}]));
  const result=deriveAttendanceClass(sheet,{classId:key,metadata,records:snaps.docs.flatMap(d=>d.data().records||[]),entries:tt.data()?.entries||[]});
  const bytes=new TextEncoder().encode(JSON.stringify(result));let hash=2166136261;for(const n of bytes)hash=Math.imul(hash^n,16777619);const fingerprint=(hash>>>0).toString(16)+':'+bytes.length;
  if(old?.fingerprint===fingerprint)return old;
  const next={...result,fingerprint,syncedAt:new Date().toISOString(),updatedBy:user.email,updatedAt:serverTimestamp()};
  // One scoped summary holds statuses and evidence codes, never phone numbers or medical reasons.
  if(new TextEncoder().encode(JSON.stringify(next)).length>850000)throw Error('출결 통계가 저장 한도를 초과했습니다. 기간 분할이 필요합니다.');
  await within(setDoc(doc(db,'attendanceBetaSummaries',key),next),25000);return next;
 })().finally(()=>inFlight.delete(key));inFlight.set(key,work);return work;
}
