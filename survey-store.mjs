import {cachedRead,invalidateRead} from './session-read-cache.mjs';
import {validateDuplicateIdentities} from './survey-identity.mjs';
import {collection,doc,getDoc,getDocs,setDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {SURVEY_COLLECTION} from './survey-core.mjs';
import {within} from './attendance-io.mjs';
import {stableSurveyPayload} from './survey-sync-core.mjs';
export function createSurveyStore(db,user,{canManage=false}={}){
 const owner=()=>canManage;
 const payload=stableSurveyPayload;

 const api={
  async read(classId,options={}){return cachedRead(db,user,'survey:results:'+classId,async()=>{const s=await within(getDocs(collection(db,SURVEY_COLLECTION,String(classId),'surveys')),15000);return Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));},options);},
  async identities(classId,options={}){return cachedRead(db,user,'survey:identities:'+classId,async()=>(await within(getDoc(doc(db,'classes',String(classId))),15000)).data()?.surveyDuplicateIdentities||[],options);},
  async saveIdentities(classId,entries,targets){
   if(!owner())throw Error('동명이인 연결은 관리자만 가능합니다.');
   const clean=validateDuplicateIdentities(entries,targets),ref=doc(db,'classes',String(classId));
   await within(runTransaction(db,async tx=>{const previous=(await tx.get(ref)).data();if(!previous)throw Error('반 설정을 먼저 확인해 주세요.');if(JSON.stringify(previous.surveyDuplicateIdentities||[])!==JSON.stringify(clean))tx.update(ref,{surveyDuplicateIdentities:clean});}),20000);
   return clean;
  },
  async configuration(options={}){return cachedRead(db,user,'survey:config',async()=>(await within(getDoc(doc(db,'settings','surveyBetaConfig')),15000)).data()||{},options);},
  async syncStatus(options={}){return cachedRead(db,user,'survey:sync-status',async()=>(await within(getDoc(doc(db,'settings','surveyAutoSync')),15000)).data()||null,options);},
  async saveConfig(eventId,config){if(!owner())throw Error('응답 연결은 관리자만 가능합니다.');await within(setDoc(doc(db,'settings','surveyBetaConfig'),{events:{[eventId]:config},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true}));},
  async save(classId,eventId,data){
   if(!owner())throw Error('응답 동기화는 관리자만 가능합니다.');
   return within(runTransaction(db,async tx=>{
    const ref=doc(db,SURVEY_COLLECTION,String(classId),'surveys',eventId),snap=await tx.get(ref),previous=snap.data();
    if(previous&&payload(previous)===payload(data))return previous;
    const next={...data,classId:String(classId),eventId,updatedBy:user.email,updatedAt:serverTimestamp()};
    tx.set(ref,next);return next;
   }),20000);
  },
 };
 async function mutate(key,work){invalidateRead(db,user,key);try{return await work();}finally{invalidateRead(db,user,key);}}
 return {...api,saveIdentities:(cid,...args)=>mutate('survey:identities:'+cid,()=>api.saveIdentities(cid,...args)),saveConfig:(...args)=>mutate('survey:config',()=>api.saveConfig(...args)),save:(cid,...args)=>mutate('survey:results:'+cid,()=>api.save(cid,...args))};
}
