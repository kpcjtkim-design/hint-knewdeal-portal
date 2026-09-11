import {loadCheckHereDay} from './checkhere-snapshots.mjs';
import {collectionDates} from './attendance-beta-core.mjs';
import {collection,doc,getDoc,getDocs,setDoc,query,orderBy,limit,serverTimestamp,runTransaction} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {mountCheckHere} from './checkhere-ui.mjs?v=20260911-beta1';
import {createRequest,mountCheckHereRequests} from './checkhere-requests.mjs';
import {canEditCheckHere,createDirectEditor} from './checkhere/direct-edit.mjs';
export async function mountCheckHerePortal(host,{db,user,classes,showRequests=false}){
  if(!user)throw new Error('관리자 로그인이 필요합니다.');
  const canEdit=await canEditCheckHere(user);
  host.innerHTML=(showRequests?'<div data-requests></div>':'')+'<div data-collector-host></div>';
  let controller,requests;
  const applyChange=createDirectEditor({user,controller:()=>controller,store:{
    async get(id){const snap=await getDoc(doc(db,'checkhereRequests',id));return snap.exists()?snap.data():null;},
    async create(id,input){await setDoc(doc(db,'checkhereRequests',id),{...input,status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});},
    async approve(id,approval){await runTransaction(db,async tx=>{const ref=doc(db,'checkhereRequests',id),fresh=await tx.get(ref);if(fresh.data()?.status!=='pending')throw Error('이미 처리된 변경입니다. 다시 확인해 주세요.');tx.update(ref,{status:'approved',approval,approvedBy:user.email,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});});}
  }});
  const stop=await mountCheckHere(host.querySelector('[data-collector-host]'),{
    canEdit,
    applyChange:canEdit&&!showRequests?applyChange:undefined,
    requestNew:canEdit&&showRequests?async input=>{await createRequest(db,user,input);await requests?.refresh();}:undefined,
    onController(c){controller=c;},
    async save(records,job){
      const groups=new Map();for(const r of records){const key=`${r.classId}|${r.date}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
      for(const batch of groups.values()){
        const ref=doc(db,'classes',String(batch[0].classId),'checkhereSnapshots',`${job.id}_${batch[0].date}`);
        if((await getDoc(ref)).exists())continue;
        const clean=JSON.parse(JSON.stringify(batch.map(({audit,...r})=>r)));
        await setDoc(ref,{classId:String(batch[0].classId),date:batch[0].date,jobId:job.id,jobStatus:job.status,records:clean,createdAt:serverTimestamp(),createdBy:user.email,source:'checkhere-windows-bridge-v0.1'});
      }
    },
    async load(classId,{from,to}){
      const classIds=classId==='all'?Array.from({length:17},(_,i)=>String(i+1)):[classId],records=[];
      for(const cid of classIds)for(const date of collectionDates(from,to))records.push(...await loadCheckHereDay(db,cid,date));
      return records.map(r=>({...r,source:'snapshot'}));

    }
  });
  if(showRequests)requests=await mountCheckHereRequests(host.querySelector('[data-requests]'),{db,user,classes,admin:true,controller:()=>controller,openCollector(){host.querySelector('[data-collector-host]').scrollIntoView({block:'start'});}});
  return()=>{stop();requests?.dispose();};
}

