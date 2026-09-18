import {collection,doc,getDoc,getDocs,setDoc,query,where,documentId,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {isoLabel,koreaToday} from './attendance-beta-core.mjs';
import {loadLegacyCheckHereDay} from './checkhere-snapshots.mjs';
import {deriveAttendanceClass} from './attendance-derived-core.mjs';
import {within,readJson} from './attendance-io.mjs';
const flightsByDb=new WeakMap();
function flightMap(db,user){let users=flightsByDb.get(db);if(!users){users=new Map();flightsByDb.set(db,users);}const uid=user.uid||user.email;if(!users.has(uid))users.set(uid,new Map());return users.get(uid);}
async function recognitionRecords(db,classId,sheet){
 const a=sheet.attendance||[],dates=(a[0]||[]).map((v,i)=>({date:isoLabel(v),i})).filter(d=>d.i>=4&&d.date&&d.date<=koreaToday()&&a.slice(1).some(r=>String(r[d.i]||'').trim()==='인정출석')).map(d=>d.date);
 const rows=[];
 for(let i=0;i<dates.length;i+=30){
  const batch=dates.slice(i,i+30),current=await within(getDocs(query(collection(db,'classes',classId,'checkhereCurrent'),where('date','in',batch))),30000);
  const found=new Map(current.docs.map(d=>[d.data().date,d.data().records||[]]));
  for(const date of batch)rows.push(...(found.has(date)?found.get(date):await within(loadLegacyCheckHereDay(db,classId,date),30000)));
 }
 return rows;
}
export const readAttendanceSummary=async(db,classId)=>(await within(getDoc(doc(db,'attendanceBetaSummaries',String(classId))),20000)).data()||null;
export function syncAttendanceSummary(db,user,classId,data=null){
 const inFlight=flightMap(db,user),key=String(classId),signature=data?JSON.stringify([data.attendance,data.attendanceBackgrounds||data.backgrounds]):'refresh';
 const pending=inFlight.get(key);if(pending){if(pending.signature===signature)return pending.work;return pending.work.catch(()=>{}).then(()=>syncAttendanceSummary(db,user,classId,data));}
 const work=(async()=>{
  const sheet=data||await readJson('/api/attendance-reader',{classId:key,idToken:await within(user.getIdToken()),allowCache:true},{timeout:55000});
  const [metas,snaps,tt,old]=await Promise.all([
   within(getDocs(query(collection(db,'settings'),where(documentId(),'>=',`attendanceBeta_${key}_`),where(documentId(),'<',`attendanceBeta_${key}_\uf8ff`))),30000),
   recognitionRecords(db,key,sheet),within(getDoc(doc(db,'timetableBetaPublished',key)),30000),readAttendanceSummary(db,key)
  ]);
  const metadata=Object.fromEntries(metas.docs.map(d=>[d.id.slice(-10),d.data().students||{}]));
  const result=deriveAttendanceClass(sheet,{classId:key,metadata,records:snaps,entries:tt.data()?.entries||[]});
  const bytes=new TextEncoder().encode(JSON.stringify(result));let hash=2166136261;for(const n of bytes)hash=Math.imul(hash^n,16777619);const fingerprint=(hash>>>0).toString(16)+':'+bytes.length;
  if(old?.fingerprint===fingerprint)return old;
  const next={...result,fingerprint,syncedAt:new Date().toISOString(),updatedBy:user.email,updatedAt:serverTimestamp()};
  // One scoped summary holds statuses and evidence codes, never phone numbers or medical reasons.
  if(new TextEncoder().encode(JSON.stringify(next)).length>850000)throw Error('출결 통계가 저장 한도를 초과했습니다. 기간 분할이 필요합니다.');
  await within(setDoc(doc(db,'attendanceBetaSummaries',key),next),25000);return next;
 })().finally(()=>inFlight.delete(key));inFlight.set(key,{signature,work});return work;
}
