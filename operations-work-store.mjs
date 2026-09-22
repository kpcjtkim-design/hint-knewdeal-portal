import {collection,getDocs,query,where} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {cachedRead} from './session-read-cache.mjs';
import {readAttendanceSummary} from './attendance-derived-store.mjs';
import {createTimetableStore} from './timetable-store.mjs';
import {createSurveyStore} from './survey-store.mjs';
import {loadRetryHeads} from './checkhere-retry-store.mjs';
import {ACTIVE_REQUESTS,FAILED_REQUESTS} from './operations-work-core.mjs';
import {within} from './attendance-io.mjs';
export function createWorkStore(db,user){
 const timetable=createTimetableStore(db,user),survey=createSurveyStore(db,user);
 return {
  config:options=>survey.configuration(options),
  async readClass(cid,{fresh=false}={}){
   // Reuse the source stores directly so their existing write invalidation also
   // applies here after a sync or publication in another portal menu.
   const values=await Promise.allSettled([readAttendanceSummary(db,cid,{user,fresh}),timetable.read('published',cid,{fresh}),survey.read(cid,{fresh})]);
   const result={errors:{}};['summary','timetable','surveys'].forEach((key,i)=>{const v=values[i];if(v.status==='fulfilled')result[key]=v.value;else result.errors[key]=String(v.reason?.message||v.reason);});return result;
  },
  requests({fresh=false}={}){return cachedRead(db,user,'operations:requests',async()=>{
   const snap=await within(getDocs(query(collection(db,'checkhereRequests'),where('status','in',[...ACTIVE_REQUESTS,...FAILED_REQUESTS]))),25000);
   const result=await within(loadRetryHeads(db,snap.docs.map(d=>({...d.data(),id:d.id}))),25000);
   // Retry parents remain in history; only unresolved chain heads count here.
   return result.rows.filter(r=>!result.links.has(r.id)&&(ACTIVE_REQUESTS.includes(r.status)||FAILED_REQUESTS.includes(r.status)));
  },{fresh,ttl:60000});}
 };
}
