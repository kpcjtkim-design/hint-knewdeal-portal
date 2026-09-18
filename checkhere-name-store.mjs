import {doc,getDoc} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {within} from './attendance-io.mjs';
import {hasBirthYearName} from './checkhere-name-core.mjs';
const caches=new WeakMap();
export async function loadCheckHereIdentities(db,classId,students){
  if(!students.some(s=>hasBirthYearName(s.name)))return [];
  let cache=caches.get(db);if(!cache){cache=new Map();caches.set(db,cache);}
  const key=String(classId),old=cache.get(key);
  if(old&&Date.now()-old.at<300000)return old.promise;
  const entry={at:Date.now(),promise:null};
  entry.promise=within(getDoc(doc(db,'classes',key)),15000).then(d=>d.data()?.surveyDuplicateIdentities||[]).catch(e=>{if(cache.get(key)===entry)cache.delete(key);throw e;});
  cache.set(key,entry);return entry.promise;
}
