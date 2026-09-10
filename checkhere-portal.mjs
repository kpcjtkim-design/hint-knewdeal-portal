import {collection,doc,getDoc,getDocs,setDoc,query,orderBy,limit,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {mountCheckHere} from './checkhere-ui.mjs';
import {createRequest,mountCheckHereRequests} from './checkhere-requests.mjs';
export async function mountCheckHerePortal(host,{db,user,classes}){
  if(!user)throw new Error('관리자 로그인이 필요합니다.');
  host.innerHTML='<div data-requests></div><details data-collector><summary style="cursor:pointer;font-weight:800;padding:12px">수집 PC 연결 · 체크히어 기록 보기</summary><div data-collector-host></div></details>';
  let controller,requests;
  const stop=await mountCheckHere(host.querySelector('[data-collector-host]'),{
    onController(c){controller=c;},
    async requestNew(input){await createRequest(db,user,input);await requests?.refresh();},
    async save(records,job){
      const groups=new Map();for(const r of records){const key=`${r.classId}|${r.date}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
      for(const batch of groups.values()){
        const ref=doc(db,'classes',String(batch[0].classId),'checkhereSnapshots',`${job.id}_${batch[0].date}`);
        if((await getDoc(ref)).exists())continue;
        const clean=JSON.parse(JSON.stringify(batch.map(({audit,...r})=>r)));
        await setDoc(ref,{classId:String(batch[0].classId),date:batch[0].date,jobId:job.id,jobStatus:job.status,records:clean,createdAt:serverTimestamp(),createdBy:user.email,source:'checkhere-windows-bridge-v0.1'});
      }
    },
    async load(classId){
      const docs=await getDocs(query(collection(db,'classes',String(classId),'checkhereSnapshots'),orderBy('createdAt','desc'),limit(50))),found=new Map();
      for(const d of docs.docs)for(const r of d.data().records||[])if(!found.has(r.id))found.set(r.id,{...r,source:'snapshot'});
      return[...found.values()];
    }
  });
  requests=await mountCheckHereRequests(host.querySelector('[data-requests]'),{db,user,classes,admin:true,controller:()=>controller,openCollector(){host.querySelector('[data-collector]').open=true;}});
  return()=>{stop();requests.dispose();};
}
