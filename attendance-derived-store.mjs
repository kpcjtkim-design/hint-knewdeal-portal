import {collection,doc,getDoc,getDocs,setDoc,query,where,documentId,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {isoLabel,koreaToday} from './attendance-beta-core.mjs';
import {loadLegacyCheckHereDay} from './checkhere-snapshots.mjs';
import {deriveAttendanceClass} from './attendance-derived-core.mjs';
import {within,readJson} from './attendance-io.mjs';
import {loadCheckHereIdentities} from './checkhere-name-store.mjs';
import {cachedRead,invalidateRead} from './session-read-cache.mjs';
const flightsByDb=new WeakMap();
function flightMap(db,user){let users=flightsByDb.get(db);if(!users){users=new Map();flightsByDb.set(db,users);}const uid=user.uid||user.email;if(!users.has(uid))users.set(uid,new Map());return users.get(uid);}
async function recognitionRecords(db,classId,sheet){
 const a=sheet.attendance||[],dates=(a[0]||[]).map((v,i)=>({date:isoLabel(v),i})).filter(d=>d.i>=4&&d.date&&d.date<=koreaToday()&&a.slice(1).some(r=>String(r[d.i]||'').trim()==='인정출석')).map(d=>d.date);
 // A single bounded current-record query also covers CheckHere hospital
 // recognitions on dates whose Sheet status was later corrected.
 const current=await within(getDocs(query(collection(db,'classes',classId,'checkhereCurrent'),where('date','>=','2026-07-27'),where('date','<=',koreaToday()))),30000);
 const found=new Map(current.docs.map(d=>[d.data().date,d.data().records||[]]));
 const rows=[...found.values()].flat();
 for(let i=0;i<dates.length;i+=30){
  const batch=dates.slice(i,i+30);
  for(const date of batch)if(!found.has(date))rows.push(...await within(loadLegacyCheckHereDay(db,classId,date),30000));
 }
 return rows;
}
const summaryKey=classId=>'attendance-summary:'+String(classId);
export const readAttendanceSummary=(db,classId,{user=null,fresh=false}={})=>cachedRead(db,user,summaryKey(classId),async()=>(await within(getDoc(doc(db,'attendanceBetaSummaries',String(classId))),20000)).data()||null,{fresh});
export function syncAttendanceSummary(db,user,classId,data=null){
 const inFlight=flightMap(db,user),key=String(classId),signature=data?JSON.stringify([data.attendance,data.attendanceBackgrounds||data.backgrounds]):'refresh';
 const pending=inFlight.get(key);if(pending){if(pending.signature===signature)return pending.work;return pending.work.catch(()=>{}).then(()=>syncAttendanceSummary(db,user,classId,data));}
 const work=(async()=>{
  const sheet=data||await readJson('/api/attendance-reader',{classId:key,idToken:await within(user.getIdToken()),allowCache:true},{timeout:55000});
  const [metas,snaps,tt,old,identities]=await Promise.all([
   within(getDocs(query(collection(db,'settings'),where(documentId(),'>=',`attendanceBeta_${key}_`),where(documentId(),'<',`attendanceBeta_${key}_\uf8ff`))),30000),
   recognitionRecords(db,key,sheet),within(getDoc(doc(db,'timetableBetaPublished',key)),30000),readAttendanceSummary(db,key,{user,fresh:true}),loadCheckHereIdentities(db,key,(sheet.attendance||[]).slice(1).map(r=>({name:r[0]})))
  ]);
  const metadata=Object.fromEntries(metas.docs.map(d=>[d.id.slice(-10),d.data().students||{}]));
  const result=deriveAttendanceClass(sheet,{classId:key,metadata,records:snaps,identities,entries:tt.data()?.entries||[]});
  const bytes=new TextEncoder().encode(JSON.stringify(result));let hash=2166136261;for(const n of bytes)hash=Math.imul(hash^n,16777619);const fingerprint=(hash>>>0).toString(16)+':'+bytes.length;
  if(old?.fingerprint===fingerprint)return old;
  const next={...result,fingerprint,syncedAt:new Date().toISOString(),updatedBy:user.email,updatedAt:serverTimestamp()};
  // One scoped summary holds statuses, evidence codes and disease dates,
  // never phone numbers or the original medical memo text.
  if(new TextEncoder().encode(JSON.stringify(next)).length>850000)throw Error('출결 통계가 저장 한도를 초과했습니다. 기간 분할이 필요합니다.');
  try{await within(setDoc(doc(db,'attendanceBetaSummaries',key),next),25000);}finally{invalidateRead(db,user,summaryKey(key));}return next;
 })().finally(()=>inFlight.delete(key));inFlight.set(key,{signature,work});return work;
}
