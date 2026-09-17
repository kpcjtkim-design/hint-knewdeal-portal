import {loadCheckHereDay,loadLegacyCheckHereDay} from './checkhere-snapshots.mjs';
import {collectionDates} from './attendance-beta-core.mjs';
import {collection,doc,getDoc,getDocFromServer,getDocs,setDoc,query,orderBy,limit,serverTimestamp,runTransaction} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {createCurrentSaver,mergeCurrentRecords} from './checkhere-current-core.mjs';
import {within} from './attendance-io.mjs';
import {mountCheckHere} from './checkhere-ui.mjs?v=20260917-approvalsync1';
import {createRequest,mountCheckHereRequests} from './checkhere-requests.mjs?v=20260917-approvalsync1';
import {canEditCheckHere,createDirectEditor} from './checkhere/direct-edit.mjs';
export async function mountCheckHerePortal(host,{db,user,classes,showRequests=false}){
  if(!user)throw new Error('관리자 로그인이 필요합니다.');
  const canEdit=await canEditCheckHere(user);
  host.innerHTML=(showRequests?'<nav class="admin-tabs" aria-label="체크히어 업무"><button class="tab active" data-ch-view="collect">수집·검수</button><button class="tab" data-ch-view="requests">반영 요청·승인</button></nav>':'')+'<div data-collector-host></div>'+(showRequests?'<div data-requests hidden style="display:none"></div>':'');
  if(showRequests)host.querySelectorAll('[data-ch-view]').forEach(b=>b.onclick=()=>{const approval=b.dataset.chView==='requests';host.querySelector('[data-requests]').hidden=!approval;host.querySelector('[data-collector-host]').hidden=approval;host.querySelector('[data-collector-host]').style.display=approval?'none':'block';host.querySelector('[data-requests]').style.display=approval?'block':'none';host.querySelectorAll('[data-ch-view]').forEach(x=>x.classList.toggle('active',x===b));if(approval)void openRequests();else controller?.render?.();});
  let controller,requests,requestMount;
  const saveSnapshots=createCurrentSaver({
    async read(classId,date){
      const snap=await within(getDocFromServer(doc(db,'classes',classId,'checkhereCurrent',date)),20000,'DB 저장 확인이 지연됩니다. 다시 시도해 주세요.');
      if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('서버 저장 완료를 아직 확인하지 못했습니다.');
      return snap.exists()?snap.data():null;
    },
    readLegacy:(classId,date)=>within(loadLegacyCheckHereDay(db,classId,date),30000),
    async commit(classId,date,rows,legacy,job){
      await within(runTransaction(db,async tx=>{
        const ref=doc(db,'classes',classId,'checkhereCurrent',date),old=await tx.get(ref);
        const previous=old.exists()?old.data().records:legacy;
        const records=mergeCurrentRecords(previous||[],rows,classId,date);
        if(old.exists()&&JSON.stringify(records)===JSON.stringify(previous))return;
        tx.set(ref,{classId,date,records,jobId:job.id,updatedBy:user.email,updatedAt:serverTimestamp()});
      }),30000,'DB 저장 응답이 지연됩니다. 서버 기록을 다시 확인합니다.');
    },
  });
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
    save:saveSnapshots,
    async load(classId,{from,to}){
      const classIds=classId==='all'?Array.from({length:17},(_,i)=>String(i+1)):[classId],records=[];
      for(const cid of classIds)for(const date of collectionDates(from,to))records.push(...await loadCheckHereDay(db,cid,date));
      return records.map(r=>({...r,source:'snapshot'}));

    }
  });
  async function openRequests(){if(requests)return requests.refresh();if(requestMount)return requestMount;requestMount=mountCheckHereRequests(host.querySelector('[data-requests]'),{db,user,classes,admin:true,controller:()=>controller,onCount(n){host.querySelector('[data-ch-view=requests]').textContent=`반영 요청·승인${n?' ('+n+')':''}`;},openCollector(){host.querySelector('[data-ch-view=collect]')?.click();host.querySelector('[data-collector-host]').scrollIntoView({block:'start'});}}).then(work=>{if(host.isConnected)requests=work;else work.dispose();}).catch(e=>{const box=host.querySelector('[data-requests]');if(box)box.textContent='요청 현황을 불러오지 못했습니다. '+e.message;}).finally(()=>{requestMount=null;});return requestMount;}
  const dispose=()=>{stop();requests?.dispose();};dispose.canLeave=()=>stop.canLeave?.()??true;return dispose;
}

