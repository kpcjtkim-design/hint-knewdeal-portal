import {cachedRead,invalidateReadPrefix} from './session-read-cache.mjs';
import {within} from './attendance-io.mjs';
import {doc,getDoc,getDocs,collection,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {COLLECTIONS} from './timetable-core.mjs';
export function createTimetableStore(db,user){
 const stamp=()=>({updatedBy:user.email,updatedAt:serverTimestamp()});
 const ref=(kind,id)=>doc(db,COLLECTIONS[kind],String(id));
 async function read(kind,id,options={}){return cachedRead(db,user,`timetable:${kind}:${id}`,async()=>{const s=await within(getDoc(ref(kind,id)));return s.exists()?s.data():null;},options);}
 async function all(kind,options={}){return cachedRead(db,user,`timetable:${kind}:all`,async()=>{const s=await within(getDocs(collection(db,COLLECTIONS[kind])),25000);return Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));},options);}
 async function save(kind,id,data,expected=0){return runTransaction(db,async tx=>{const r=ref(kind,id),s=await tx.get(r),old=s.exists()?s.data():{};if((old.revision||0)!==expected)throw Error('다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 확인해 주세요.');const next={...data,revision:expected+1,...stamp()};tx.set(r,next);return next;});}
 async function catalog(seed,options={}){const saved=await cachedRead(db,user,'timetable:catalog',async()=>{const s=await within(getDoc(doc(db,'settings','timetableBetaCatalog')));return s.exists()?s.data():null;},options);return saved||{courses:seed.courses,modules:seed.modules,lectures:seed.lectures,revision:0};}
 async function saveCatalog(data,expected){return runTransaction(db,async tx=>{const r=doc(db,'settings','timetableBetaCatalog'),s=await tx.get(r);if((s.exists()?s.data().revision||0:0)!==expected)throw Error('강의 목록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');const next={...data,revision:expected+1,...stamp()};tx.set(r,next);return next;});}
 async function publish(cid,draft,publishedRevision,entries){return runTransaction(db,async tx=>{const dr=ref('draft',cid),pr=ref('published',cid),ds=await tx.get(dr),ps=await tx.get(pr);if(!ds.exists()||ds.data().revision!==draft.revision)throw Error('편집본이 바뀌었습니다. 새로고침 후 공개해 주세요.');if((ps.exists()?ps.data().revision||0:0)!==publishedRevision)throw Error('다른 관리자가 공개본을 변경했습니다. 새로고침해 주세요.');const next={classId:cid,entries,sourceRevision:draft.revision,revision:publishedRevision+1,...stamp()};tx.set(pr,next);return next;});}
 async function saveDrafts(changes){return runTransaction(db,async tx=>{const snapshots=await Promise.all(changes.map(c=>tx.get(ref('draft',c.classId))));for(let i=0;i<changes.length;i++)if((snapshots[i].exists()?snapshots[i].data().revision||0:0)!==changes[i].revision)throw Error('다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 확인해 주세요.');const result={};for(const c of changes){const next={classId:c.classId,entries:c.entries,revision:c.revision+1,...stamp()};tx.set(ref('draft',c.classId),next);result[c.classId]=next;}return result;});}
 async function applyCurriculum(plan){
  return runTransaction(db,async tx=>{
   const references=plan.changes.map(c=>c.kind==='catalog'?doc(db,'settings','timetableBetaCatalog'):ref(c.kind,c.id));
   const snapshots=await Promise.all(references.map(r=>tx.get(r)));
   for(let i=0;i<plan.changes.length;i++)if((snapshots[i].exists()?snapshots[i].data().revision||0:0)!==plan.changes[i].revision)throw Error('확인 중 다른 관리자가 시간표를 변경했습니다. 새로고침 후 다시 확인해 주세요.');
   plan.changes.forEach((c,i)=>tx.set(references[i],{...c.data,revision:c.revision+1,curriculumReference:plan.version,...stamp()}));
  });
 }
 async function mutate(work){invalidateReadPrefix(db,user,'timetable:');try{return await work();}finally{invalidateReadPrefix(db,user,'timetable:');}}
 return {read,all,catalog,save:(...a)=>mutate(()=>save(...a)),saveCatalog:(...a)=>mutate(()=>saveCatalog(...a)),publish:(...a)=>mutate(()=>publish(...a)),saveDrafts:(...a)=>mutate(()=>saveDrafts(...a)),applyCurriculum:(...a)=>mutate(()=>applyCurriculum(...a))};
}
