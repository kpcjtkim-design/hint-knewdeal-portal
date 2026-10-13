// CheckHere live beta page: any portal administrator sees one class/day live from
// Firestore and submits edits; the designated account's tab on the collector PC
// relays them to CheckHere (see checkhere-live-relay.mjs).
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {getFirestore,doc,getDoc,getDocFromServer,collection,query,where,onSnapshot,setDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {latestSnapshots} from './attendance-beta-core.mjs';
import {judge,normalizeTime} from './checkhere/rules.mjs';
import {APPROVER,sameRequestTarget} from './checkhere/approval-core.mjs';
import {canEditCheckHere} from './checkhere/direct-edit.mjs';
import {createCurrentSaver,mergeCurrentRecords} from './checkhere-current-core.mjs';
import {loadLegacyCheckHereDay} from './checkhere-snapshots.mjs';
import {loadCheckHereIdentities} from './checkhere-name-store.mjs';
import {within} from './attendance-io.mjs';
import {ACTIVE,CLASS_IDS,LIVE_STATUS,buildLiveRequest,editorReason,isLiveRequest,koreaClock,requestsFor,stamp} from './checkhere-live-core.mjs';
import {createBridgeClient,createLiveRelay} from './checkhere-live-relay.mjs';

const firebaseConfig={apiKey:'AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE',authDomain:'knewdeal-portal.firebaseapp.com',projectId:'knewdeal-portal',storageBucket:'knewdeal-portal.firebasestorage.app',messagingSenderId:'1054904032053',appId:'1:1054904032053:web:de18246d426776b54bca7c'};
const fb=initializeApp(firebaseConfig),auth=getAuth(fb),db=getFirestore(fb),provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
const $=s=>document.querySelector(s),app=$('#app'),who=$('#who');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;function toast(text,ms=4000){const t=$('#toast');t.textContent=text;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.style.display='none';},ms);}
const BOOTSTRAP=[APPROVER,'kpc.jtkim@gmail.com'];
const adminCache=new Map();
async function isAdmin(email){
  const key=String(email||'').toLowerCase();if(!key)return false;if(BOOTSTRAP.includes(key))return true;
  if(!adminCache.has(key))adminCache.set(key,getDoc(doc(db,'users',email)).then(d=>d.exists()&&d.data().role==='ADMIN'&&d.data().active!==false).catch(()=>false));
  return adminCache.get(key);
}
const hhmm=t=>t?String(t).slice(0,8):'';
const ago=ms=>{const s=Math.round((Date.now()-ms)/1000);return s<60?'방금':s<3600?`${Math.floor(s/60)}분 전`:`${Math.floor(s/3600)}시간 전`;};
const chipClass=s=>s==='verified'?'ok':['pending','approved','applying'].includes(s)?'wait':s==='rejected'||s==='withdrawn'?'warn':'bad';
const changeText=c=>Object.entries(c||{}).map(([k,v])=>`${{entry:'입실',exit:'퇴실',entryMemo:'입실 사유',exitMemo:'퇴실 사유'}[k]||k}: ${v===''?'(비움)':v}`).join(' · ');

let disposeView=null;
onAuthStateChanged(auth,async user=>{
  disposeView?.();disposeView=null;
  if(!user){
    who.innerHTML='';
    app.innerHTML=`<section><h2>관리자 로그인</h2><p class="muted">운영 포털과 같은 Google 계정으로 로그인합니다. 관리자만 사용할 수 있습니다.</p><button class="primary" id="login">Google 로그인</button> <span id="loginStatus" class="muted"></span></section>`;
    $('#login').onclick=async()=>{try{await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,provider);}catch(e){$('#loginStatus').textContent='로그인 오류: '+(e.code||e.message);}};
    return;
  }
  who.innerHTML=`<span class="muted">${esc(user.email)}</span><button id="logout">로그아웃</button>`;$('#logout').onclick=()=>signOut(auth);
  if(!await isAdmin(user.email)){app.innerHTML='<section><h2>관리자 전용</h2><p class="muted">이 베타 화면은 운영 포털 관리자 계정만 사용할 수 있습니다.</p></section>';return;}
  disposeView=await mountLive(user);
});

async function mountLive(user){
  const relayAllowed=await canEditCheckHere(user).catch(()=>false);
  const today=koreaClock().date;
  const state={classId:sessionStorageGet('live.class')||'2',date:today,records:[],requests:[],updatedAt:null,legacy:false,error:''};
  let unDay=null,unReq=null,previous=new Map();
  app.innerHTML=`
  <section>
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <label>반 <select id="cls">${CLASS_IDS.map(c=>`<option value="${c}">${c}반</option>`).join('')}</select></label>
        <label>날짜 <input type="date" id="date"></label>
        <button id="todayBtn">오늘</button>
      </div>
      <span id="fresh" class="muted"></span>
    </div>
    <p class="note" style="margin:12px 0 0">수정하면 수집 PC가 체크히어에 입력하고, 다시 읽어 확인한 값만 이 표에 반영합니다. 수업 중에는 5분마다 자동으로 갱신됩니다. 수집 PC 중계가 꺼져 있으면 <b>반영 대기</b>로 남아 있다가 켜지면 처리됩니다.</p>
  </section>
  <section><div class="table-wrap"><table><thead><tr><th>학생</th><th>실제 입실</th><th>입실(교시)</th><th>퇴실</th><th>외출</th><th>입실 사유</th><th>퇴실 사유</th><th>판정</th><th>처리 상태</th></tr></thead><tbody id="rows"><tr><td colspan="9" class="muted">불러오는 중…</td></tr></tbody></table></div></section>
  <section><h2>이 반·날짜의 수정 기록</h2><div id="reqs" class="muted">없음</div></section>
  ${relayAllowed?relayMarkup():''}
  <dialog id="edit"></dialog>`;
  $('#cls').value=state.classId;$('#date').value=state.date;
  $('#cls').onchange=()=>{state.classId=$('#cls').value;sessionStorageSet('live.class',state.classId);subscribe();};
  $('#date').onchange=()=>{if($('#date').value){state.date=$('#date').value;subscribe();}};
  $('#todayBtn').onclick=()=>{$('#date').value=state.date=koreaClock().date;subscribe();};

  function subscribe(){
    unDay?.();unReq?.();previous=new Map();state.records=[];state.requests=[];state.updatedAt=null;state.legacy=false;state.error='';render();
    const {classId,date}=state;
    unDay=onSnapshot(doc(db,'classes',classId,'checkhereCurrent',date),async snap=>{
      if(classId!==state.classId||date!==state.date)return;
      if(snap.exists()){const d=snap.data();state.records=latestSnapshots(d.records||[],classId,date);state.updatedAt=stamp(d.updatedAt)||null;state.legacy=false;}
      else{try{state.records=await within(loadLegacyCheckHereDay(db,classId,date),20000);state.legacy=state.records.length>0;}catch{state.records=[];}}
      render();
    },e=>{state.error='출결 문서를 읽지 못했습니다: '+e.message;render();});
    unReq=onSnapshot(query(collection(db,'checkhereRequests'),where('classId','==',classId),where('date','==',date)),snap=>{
      if(classId!==state.classId||date!==state.date)return;
      state.requests=snap.docs.map(d=>({id:d.id,...d.data()}));render();
    },e=>{state.error='수정 기록을 읽지 못했습니다: '+e.message;render();});
  }
  function render(){
    $('#fresh').textContent=state.error||(state.updatedAt?`DB 갱신 ${new Date(state.updatedAt).toLocaleTimeString('ko-KR',{hour12:false})} · ${ago(state.updatedAt)}`:state.legacy?'과거 저장본 표시 중':'');
    $('#fresh').className=state.error?'error':'muted';
    const rows=[...state.records].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    $('#rows').innerHTML=rows.length?rows.map(r=>{
      const reqs=requestsFor(r,state.requests),last=reqs[0],active=reqs.some(x=>ACTIVE.includes(x.status));
      let labels='';try{labels=judge(r).labels.join(', ');}catch{labels='';}
      const changed=previous.has(r.id)&&previous.get(r.id)!==r.version;
      const status=last?`<span class="chip ${chipClass(last.status)}">${esc(LIVE_STATUS[last.status]||last.status)}</span>${last.status==='rejected'&&last.reviewNote?`<br><small>${esc(last.reviewNote)}</small>`:''}${['failed','partial','conflict','unknown'].includes(last.status)&&last.result?.message?`<br><small>${esc(last.result.message)}</small>`:''}`:'';
      const outing=r.outingCount?`${r.outingCount}회${(r.outings||[]).length?'<br><small>'+r.outings.map(o=>`${hhmm(o.start)}~${hhmm(o.end)}`).map(esc).join('<br>')+'</small>':''}`:'-';
      return `<tr data-id="${esc(r.id)}" class="${changed?'changed':''}"><td><b>${esc(r.name)}</b> <small>${esc(r.phoneLast4||'')}</small><br><button data-edit="${esc(r.id)}" style="margin-top:6px;padding:4px 10px" ${active||r.readState!=='complete'||state.legacy?'disabled':''} title="${active?'처리 중인 수정이 있습니다':r.readState!=='complete'?'상세 기록을 아직 읽지 못했습니다':''}">수정</button></td><td class="time">${esc(hhmm(r.rawEntry)||'-')}</td><td class="time">${esc(hhmm(r.entry)||'-')}</td><td class="time">${esc(hhmm(r.exit)||'-')}</td><td class="time">${outing}</td><td class="memo">${esc(r.entryMemo??'…')}</td><td class="memo">${esc(r.exitMemo??'…')}</td><td><small>${esc(labels)}</small></td><td>${status}</td></tr>`;
    }).join(''):`<tr><td colspan="9" class="muted">${state.error?esc(state.error):'아직 이 반·날짜의 저장본이 없습니다. 수업 중이면 자동 갱신 후 표시됩니다.'}</td></tr>`;
    previous=new Map(state.records.map(r=>[r.id,r.version]));
    document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEdit(state.records.find(r=>r.id===b.dataset.edit)));
    const live=[...state.requests].filter(isLiveRequest).sort((a,b)=>stamp(b.createdAt)-stamp(a.createdAt));
    $('#reqs').innerHTML=live.length?live.map(r=>`<div class="req"><span class="chip ${chipClass(r.status)}">${esc(LIVE_STATUS[r.status]||r.status)}</span><b>${esc(r.name)}</b><span>${esc(changeText(r.changes))}</span><small>근거: ${esc(editorReason(r.reason))} · ${esc(r.createdBy)} · ${r.createdAt?new Date(stamp(r.createdAt)).toLocaleTimeString('ko-KR',{hour12:false}):''}</small>${r.reviewNote?`<small class="error">${esc(r.reviewNote)}</small>`:''}${r.result?.message?`<small>${esc(r.result.message)}</small>`:''}${r.status==='pending'&&r.createdBy===user.email?`<button data-withdraw="${esc(r.id)}" style="padding:2px 8px">요청 취소</button>`:''}</div>`).join(''):'<span class="muted">이 반·날짜에 베타로 보낸 수정이 없습니다.</span>';
    document.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=async()=>{
      if(!confirm('이 수정 요청을 취소할까요? 체크히어에는 반영되지 않습니다.'))return;b.disabled=true;
      try{await runTransaction(db,async tx=>{const ref=doc(db,'checkhereRequests',b.dataset.withdraw),fresh=await tx.get(ref);if(fresh.data()?.status!=='pending')throw Error('이미 처리가 시작된 요청입니다.');tx.update(ref,{status:'withdrawn',withdrawnBy:user.email,withdrawnAt:serverTimestamp(),updatedAt:serverTimestamp()});});toast('요청을 취소했습니다.');}
      catch(e){toast(e.message,6000);b.disabled=false;}
    });
  }
  function openEdit(record){
    if(!record)return;const dlg=$('#edit');
    dlg.innerHTML=`<form id="editForm"><h2>${esc(record.name)} <small>${esc(record.classId)}반 · ${esc(record.date)}</small></h2>
      <div class="grid2"><div><label for="fEntry">입실(교시) 시간</label><input id="fEntry" inputmode="numeric" placeholder="09:00" value="${esc(record.entry||'')}"></div><div><label for="fExit">퇴실 시간</label><input id="fExit" inputmode="numeric" placeholder="18:00" value="${esc(record.exit||'')}"></div></div>
      <label for="fEntryMemo">입실 관리자 사유</label><textarea id="fEntryMemo" maxlength="500">${esc(record.entryMemo||'')}</textarea>
      <label for="fExitMemo">퇴실 관리자 사유</label><textarea id="fExitMemo" maxlength="500">${esc(record.exitMemo||'')}</textarea>
      <label for="fReason">수정 근거 (필수)</label><textarea id="fReason" maxlength="900" placeholder="예: 진료확인서 제출, 담임 확인"></textarea>
      <p class="muted"><small>사유만 입력했는데 그쪽 시간이 비어 있으면 기본 시간(입실 09:00 · 퇴실 18:00)이 함께 입력됩니다. 시간을 비우는 수정은 지원하지 않습니다.</small></p>
      <p id="editError" class="error"></p>
      <div class="row" style="justify-content:flex-end"><button type="button" id="cancelEdit">취소</button><button type="submit" class="primary" id="submitEdit">체크히어에 반영 요청</button></div></form>`;
    dlg.showModal();$('#cancelEdit').onclick=()=>dlg.close();
    $('#editForm').onsubmit=async e=>{
      e.preventDefault();const btn=$('#submitEdit');btn.disabled=true;$('#editError').textContent='';
      try{
        const fresh=state.records.find(r=>r.id===record.id);
        if(!fresh||fresh.version!==record.version)throw Error('수정 창을 연 뒤 값이 바뀌었습니다. 창을 닫고 다시 열어 주세요.');
        if(requestsFor(fresh,state.requests).some(x=>ACTIVE.includes(x.status)))throw Error('이 학생에게 처리 중인 수정이 있습니다. 끝난 뒤 다시 시도해 주세요.');
        const input=buildLiveRequest(fresh,{entry:$('#fEntry').value,exit:$('#fExit').value,entryMemo:$('#fEntryMemo').value,exitMemo:$('#fExitMemo').value},$('#fReason').value);
        const id=crypto.randomUUID();
        await setDoc(doc(db,'checkhereRequests',id),{...input,status:'pending',createdBy:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        dlg.close();toast('반영 대기 중입니다. 수집 PC가 체크히어에 입력하고 확인하면 표가 바뀝니다.');
      }catch(err){$('#editError').textContent=err.message;btn.disabled=false;}
    };
  }
  subscribe();
  const stopRelay=relayAllowed?mountRelay(user,()=>state):null;
  const tick=setInterval(()=>{if(state.updatedAt)render();},30000);
  return()=>{unDay?.();unReq?.();clearInterval(tick);stopRelay?.();};
}

function relayMarkup(){return `<section id="relay"><h2>수집 PC 중계 <small class="muted">(지정 관리자 전용)</small></h2>
  <p class="muted">이 PC에서 「체크히어 시작.cmd」를 실행하고 체크히어에 로그인한 뒤, 로컬 화면의 연결 키를 붙여 넣고 시작하세요. 이 탭이 열려 있는 동안 관리자들의 수정을 체크히어에 반영하고, 평일 08:50~18:40에는 5분마다 오늘 출결을 갱신합니다.</p>
  <div class="row"><input id="relayKey" type="password" placeholder="연결 키" autocomplete="off" style="min-width:260px"><button class="primary" id="relayStart">중계 시작</button><button id="relayStop" disabled>중계 멈춤</button><button id="relayNow" disabled>이 반 지금 갱신</button></div>
  <p id="relayStatus" class="muted" style="margin:10px 0 0">꺼져 있음</p><ul class="log" id="relayLog"></ul></section>`;}
// Background tabs throttle page timers to about once a minute; worker timers keep
// job polling responsive while the relay window is not in front.
function workerSleep(){
  try{
    const w=new Worker(URL.createObjectURL(new Blob(['onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)'],{type:'text/javascript'})));
    let n=0;const waits=new Map();w.onmessage=e=>{waits.get(e.data)?.();waits.delete(e.data);};
    return ms=>new Promise(r=>{const id=++n;waits.set(id,r);w.postMessage({id,ms});});
  }catch{return ms=>new Promise(r=>setTimeout(r,ms));}
}
function relayLock(){
  if(!navigator.locks)return Promise.resolve(()=>{});
  return new Promise((resolve,reject)=>navigator.locks.request('hint-checkhere-live-relay',{ifAvailable:true},lock=>{
    if(!lock){reject(Error('이 브라우저의 다른 탭에서 이미 중계 중입니다.'));return;}
    return new Promise(release=>resolve(release));
  }));
}
function mountRelay(user,view){
  let relay=null,release=null;const logs=[],sleep=workerSleep();
  const show=s=>{$('#relayStatus').innerHTML=`${s.state==='running'?'<span class="chip ok">작동 중</span>':'<span class="chip warn">꺼져 있음</span>'} 대기 ${s.queue}건 · 처리 ${s.processed}건${s.current?` · 지금: ${esc(s.current)}`:''}${s.lastCycle?` · 마지막 자동 갱신 ${new Date(s.lastCycle.finishedAt).toLocaleTimeString('ko-KR',{hour12:false})}`:''}${s.lastError?`<br><span class="error">${esc(s.lastError)}</span>`:''}`;};
  const addLog=e=>{logs.unshift(e);logs.length=Math.min(logs.length,40);$('#relayLog').innerHTML=logs.map(x=>`<li class="${x.level}">${new Date(x.at).toLocaleTimeString('ko-KR',{hour12:false})} ${esc(x.text)}</li>`).join('');};
  const saveRecords=createCurrentSaver({
    async read(classId,date){const snap=await within(getDocFromServer(doc(db,'classes',classId,'checkhereCurrent',date)),20000);if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('서버 저장 완료를 아직 확인하지 못했습니다.');return snap.exists()?snap.data():null;},
    readLegacy:(classId,date)=>within(loadLegacyCheckHereDay(db,classId,date),30000),
    async commit(classId,date,rows,legacy,job){
      await within(runTransaction(db,async tx=>{
        const ref=doc(db,'classes',classId,'checkhereCurrent',date),old=await tx.get(ref),previous=old.exists()?old.data().records:legacy;
        const records=mergeCurrentRecords(previous||[],rows,classId,date);
        if(old.exists()&&JSON.stringify(records)===JSON.stringify(previous))return;
        tx.set(ref,{classId,date,records,jobId:String(job.id),updatedBy:user.email,updatedAt:serverTimestamp()});
      }),30000,'DB 저장 응답이 지연됩니다.');
    },
  });
  const store={
    watchQueue:(cb,onError)=>onSnapshot(query(collection(db,'checkhereRequests'),where('status','in',['pending','approved'])),snap=>cb(snap.docs.map(d=>({id:d.id,...d.data()}))),onError),
    approve:(id,approval,r)=>runTransaction(db,async tx=>{const ref=doc(db,'checkhereRequests',id),fresh=await tx.get(ref);if(fresh.data()?.status!=='pending'||!sameRequestTarget(fresh.data(),r))throw Error('요청이 이미 처리되었거나 바뀌었습니다.');tx.update(ref,{status:'approved',approval,approvedBy:user.email,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});}),
    reject:(id,note)=>runTransaction(db,async tx=>{const ref=doc(db,'checkhereRequests',id),fresh=await tx.get(ref);if(fresh.data()?.status!=='pending')return;tx.update(ref,{status:'rejected',reviewNote:String(note).slice(0,1000),reviewedBy:user.email,updatedAt:serverTimestamp()});}),
    isAdmin,identities:(classId,name)=>loadCheckHereIdentities(db,classId,[{name}]),saveRecords,
  };
  $('#relayStart').onclick=async()=>{
    const key=$('#relayKey').value.trim();if(!key)return toast('연결 키를 붙여 넣어 주세요.');
    $('#relayStart').disabled=true;
    try{
      release=await relayLock();
      relay=createLiveRelay({bridge:createBridgeClient({key}),store,user,log:addLog,sleep});
      relay.onStatus(show);await relay.start();
      $('#relayStop').disabled=false;$('#relayNow').disabled=false;$('#relayKey').disabled=true;show(relay.status());
    }catch(e){relay=null;release?.();release=null;$('#relayStart').disabled=false;toast(e.message,6000);addLog({at:new Date().toISOString(),level:'error',text:e.message});}
  };
  $('#relayStop').onclick=()=>{relay?.stop();relay=null;release?.();release=null;$('#relayStart').disabled=false;$('#relayStop').disabled=true;$('#relayNow').disabled=true;$('#relayKey').disabled=false;};
  $('#relayNow').onclick=()=>{const v=view();relay?.syncNow(v.classId,v.date);toast(`${v.classId}반 ${v.date} 갱신을 예약했습니다.`);};
  window.addEventListener('beforeunload',e=>{if(relay){e.preventDefault();e.returnValue='';}});
  return()=>{relay?.stop();release?.();};
}
function sessionStorageGet(k){try{return sessionStorage.getItem(k);}catch{return null;}}
function sessionStorageSet(k,v){try{sessionStorage.setItem(k,v);}catch{}}
