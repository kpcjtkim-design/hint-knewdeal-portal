import {collection,doc,getDoc,getDocs,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {SURVEY_COLLECTION} from './survey-core.mjs';
import {within} from './attendance-io.mjs';
export function createSurveyStore(db,user,{canManage=false}={}){
 const owner=()=>canManage;
 return {
  async read(classId){const s=await within(getDocs(collection(db,SURVEY_COLLECTION,String(classId),'surveys')),15000);return Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));},
  async configuration(){return (await within(getDoc(doc(db,'settings','surveyBetaConfig')),15000)).data()||{};},
  async saveConfig(eventId,config){if(!owner())throw Error('응답 연결은 관리자만 가능합니다.');await within(setDoc(doc(db,'settings','surveyBetaConfig'),{events:{[eventId]:config},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true}));},
  async save(classId,eventId,data){if(!owner())throw Error('응답 동기화는 관리자만 가능합니다.');await within(setDoc(doc(db,SURVEY_COLLECTION,String(classId),'surveys',eventId),{...data,classId:String(classId),eventId,updatedBy:user.email,updatedAt:serverTimestamp()}),20000);},
 };
}
