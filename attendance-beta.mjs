import {deriveRecognized} from './attendance-derived-core.mjs';
import {loadSurveyLinks,surveyLink} from './survey-links.mjs';
import {within} from './attendance-io.mjs';
import {lectureEndsOn} from './timetable-core.mjs';
import {excursionFor} from './checkhere-proposal-core.mjs';
import {createProposalReview} from './checkhere-proposals.mjs';
import {doc,getDoc,getDocs,collection,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {GoogleAuthProvider,reauthenticateWithPopup} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {ATTENDANCE_OPTIONS,EVIDENCE_OPTIONS,EVIDENCE_COLORS,emptyStatus,hasExistingReason,portalStatus,evidenceStatus,rewriteReasons,sheetStatus,matchSnapshot} from './attendance-beta-core.mjs';
import {createSheetWriter} from './attendance-beta-sheet.mjs';
import {loadCheckHereDay} from './checkhere-snapshots.mjs';
import {judge} from './checkhere/rules.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
export function createAttendanceBeta({db,user,root,state,render,showErr,reasonFor,colorState,onStatusSaved=()=>{}}){
  let teacherName='',teacherPromise;const statusPreview=new Map();
  let metadata={},snapshots=[],snapshotError='',excursions=[],lectureEnds=[],excursionError='',working=false,loading=false,sequence=0;
  const drafts=new Map();
  const writer=createSheetWriter({
    async authorize(){const provider=new GoogleAuthProvider();provider.addScope('https://www.googleapis.com/auth/spreadsheets');provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');provider.setCustomParameters({login_hint:user.email,prompt:'consent'});const result=await reauthenticateWithPopup(user,provider),credential=GoogleAuthProvider.credentialFromResult(result);if(!credential?.accessToken)throw Error('Google 시트 편집 인증을 완료하지 못했습니다.');return credential.accessToken;},
    async getClassConfig(cid){return (await getDoc(doc(db,'classes',cid))).data()||{};}
  });
  const key=s=>`${s.rowIndex}_${s.name}`;
  const info=s=>metadata[key(s)]||{};
  const currentReason=s=>{const m=info(s);if(m.reasonEntry&&state().raw.split(/\r?\n/).includes(m.reasonEntry))return m.portalReason;return reasonFor(s.name,state().raw,state().students.map(x=>x.name),s.all[state().date.idx]);};
  const rawColor=s=>String(state().backgrounds?.[s.rowIndex+1]?.[state().date.idx+4]||'#ffffff').toLowerCase();
  function displayStatus(s){if(statusPreview.has(key(s)))return statusPreview.get(key(s));const raw=String(s.all[state().date.idx]||'').trim();try{return deriveRecognized(raw,info(s),matchSnapshot(s,state().students,snapshots).record,{excursion:excursions.length>0}).status;}catch{return raw||'해당없음';}}
  function displayEvidence(s){return evidenceStatus(rawColor(s),String(s.all[state().date.idx]||''),info(s),colorState);}
  const proposals=createProposalReview({db,user,root,render,showErr,hasUnsavedReason:()=>drafts.size>0,getContext:s=>({classId:state().classId,date:state().iso,name:s.name,status:displayStatus(s),reason:drafts.get(key(s))??currentReason(s),reasonUnsaved:drafts.has(key(s)),statusSaving:statusPreview.has(key(s)),teacher:matchSnapshot(s,state().students,snapshots).record?.teacher||teacherName,raw:state().raw,excursion:excursions.length>0,record:matchSnapshot(s,state().students,snapshots).record})});
  async function persistMeta(s,patch){const ctx=state(),ref=doc(db,'settings',`attendanceBeta_${ctx.classId}_${ctx.iso}`);metadata={...metadata,[key(s)]:{...info(s),...patch}};try{await setDoc(ref,{classId:ctx.classId,date:ctx.iso,students:{[key(s)]:patch},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true});}catch(e){showErr(new Error('시트 저장은 완료됐지만 포털 세부 구분 저장에 실패했습니다. '+e.message));}}
  function controls(s){
    const status=displayStatus(s),evidence=displayEvidence(s),disabled=(!writer.connected()||working||loading)?'disabled':'';
    const options=ATTENDANCE_OPTIONS.includes(status)?ATTENDANCE_OPTIONS:[status,...ATTENDANCE_OPTIONS];
    const derived=deriveRecognized(String(s.all[state().date.idx]||'').trim(),info(s),matchSnapshot(s,state().students,snapshots).record,{excursion:excursions.length>0});
    return {status:`<select class="beta-status" aria-label="${esc(s.name)} 출결" data-student="${esc(key(s))}" ${disabled}>${options.map(x=>`<option ${x===status?'selected':''}>${esc(x)}</option>`).join('')}</select>${String(s.all[state().date.idx]||'')==='인정출석'?`<small class="derived-basis">${esc(derived.basis)}${derived.review?' · 확인 필요':''}</small>`:''}`,reason:`<input class="beta-reason" aria-label="${esc(s.name)} 사유" maxlength="500" data-student="${esc(key(s))}" value="${esc(drafts.has(key(s))?drafts.get(key(s)):currentReason(s))}" ${working||loading?'disabled':''}>`,evidence:`<select class="beta-evidence" aria-label="${esc(s.name)} 서류제출" data-student="${esc(key(s))}" ${disabled}>${EVIDENCE_OPTIONS.map(x=>`<option ${x===evidence?'selected':''}>${x}</option>`).join('')}</select>`};
  }
  function snapshotCells(s,memoButton=()=> ''){
    const cell=(value,category,field)=>`<div class="cell beta-source"><div class="source-value ${field?'existing-record':''}">${field?'<strong>현재 체크히어 저장값</strong>':''}${value|| (field?'공란 · 사유 없음':'')}</div>${field?proposals.html(s,field):''}${category?memoButton(category):''}</div>`;
    const {record:r,error}=matchSnapshot(s,state().students,snapshots);
    if(snapshotError||!r)return cell(esc(snapshotError||error),'checkhereTimes','times')+cell('—')+cell('—','checkhereEntry','entryMemo')+cell('—','checkhereExit','exitMemo')+cell('—','checkhereOutings');
    const time=r.collectedAt?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(r.collectedAt)):'';
    const audited=judge(r);
    return cell(`${esc(r.rawEntry??r.entry??'—')}<br>→ ${esc(r.exit||'—')}<small>수집 ${esc(time)}</small>`,'checkhereTimes','times')+cell(`${audited.labels.map(esc).join(' · ')}<small>${r.readState==='complete'?'저장본':'상세 수집 실패'}</small>`)+cell(esc(r.entryMemo??'미수집'),'checkhereEntry','entryMemo')+cell(esc(r.exitMemo??'미수집'),'checkhereExit','exitMemo')+cell(r.outings?.map(x=>`${esc(x.start||'—')} ~ ${esc(x.end||'—')}`).join('<br>')||(r.readState==='complete'?'없음':'미확인'),'checkhereOutings');
  }
  function headerState(){const notice=root.querySelector('#lectureEndDay');if(notice){notice.hidden=!lectureEnds.length;notice.innerHTML=lectureEnds.map(e=>`<a href="${esc(surveyLink(state().classId,e))}" target="_blank" rel="noopener">${esc(e.title)} · 모듈 종료일, 만족도조사 필요 ↗</a>`).join(' / ');}const banner=root.querySelector('#excursionDay');if(banner){banner.hidden=!excursions.length&&!excursionError;banner.textContent=excursionError||('견학일 · '+excursions.map(e=>e.title).join(' / ')+' · 실제 운영 시간과 사유를 확인해 주세요.');}const save=root.querySelector('#saveReasons');if(save){save.textContent=`사유 저장${drafts.size?' ('+drafts.size+')':''}`;save.disabled=!drafts.size||working||loading||!writer.connected();}const c=root.querySelector('#sheetConnect');if(c){c.disabled=working||loading;c.textContent=writer.connected()?'내 계정 연결됨':'내 계정 시트 연결';}for(const id of ['classSel','dateSel','reload']){const el=root.querySelector('#'+id);if(el)el.disabled=working||loading;}}
  async function action(fn){if(working||loading)return;working=true;showErr('');render();try{await fn();}catch(e){showErr(e);}finally{working=false;render();}}
  function bind(){
    proposals.bind(state().students);
    const student=id=>state().students.find(s=>key(s)===id);
    root.querySelectorAll('.beta-status').forEach(el=>el.onchange=()=>{const s=student(el.dataset.student),before=displayStatus(s),after=el.value;el.value=before;if(after===before)return;if(!emptyStatus(before)&&!confirm(`${s.name}의 출결을 변경하시겠습니까?\n${before} → ${after}`))return;statusPreview.set(key(s),after);action(async()=>{try{const ctx=state(),raw=String(s.all[ctx.date.idx]||'').trim();await writer.write({classId:ctx.classId,date:ctx.iso,name:s.name,kind:'status',before:raw,after});s.all[ctx.date.idx]=sheetStatus(after);await persistMeta(s,{portalStatus:after,sheetStatus:sheetStatus(after)});onStatusSaved();}finally{statusPreview.delete(key(s));}});});
    root.querySelectorAll('.beta-evidence').forEach(el=>el.onchange=()=>{const s=student(el.dataset.student),before=displayEvidence(s),after=el.value;el.value=before;if(after===before)return;if(!confirm(`${s.name}의 서류제출 상태와 시트 배경색을 변경하시겠습니까?\n${before} → ${after}`))return;action(async()=>{const ctx=state(),color=EVIDENCE_COLORS[after];await writer.write({classId:ctx.classId,date:ctx.iso,name:s.name,kind:'color',before:rawColor(s),after:color});ctx.backgrounds[s.rowIndex+1]??=[];ctx.backgrounds[s.rowIndex+1][ctx.date.idx+4]=color;await persistMeta(s,{evidenceStatus:after,sheetColor:color});});});
    root.querySelectorAll('.beta-reason').forEach(el=>el.oninput=()=>{const s=student(el.dataset.student);if(el.value===currentReason(s))drafts.delete(key(s));else drafts.set(key(s),el.value);proposals.refresh([s]);headerState();});headerState();
  }
  async function saveReasons(){
    const changed=state().students.filter(s=>drafts.has(key(s)));if(!changed.length)return;
    const correcting=changed.filter(s=>hasExistingReason(state().raw,s.name,currentReason(s)));if(correcting.length&&!confirm(`기존 사유를 변경하시겠습니까?\n${correcting.map(s=>s.name).join(', ')}`))return;
    await action(async()=>{const ctx=state(),updates=Object.fromEntries(changed.map(s=>[s.name,drafts.get(key(s))])),next=rewriteReasons(ctx.raw,updates,ctx.students.map(x=>x.name));if(next!==ctx.raw){await writer.write({classId:ctx.classId,date:ctx.iso,name:changed[0].name,kind:'reason',before:ctx.raw,after:next});ctx.setRaw(next);}for(const s of changed){const value=updates[s.name].trim();await persistMeta(s,{portalReason:value,reasonEntry:value?`${s.name}: ${value}`:''});}drafts.clear();});
  }
  root.querySelector('#sheetConnect').onclick=()=>action(async()=>{await writer.connect(state().classId);});
  root.querySelector('#saveReasons').onclick=saveReasons;
  return {controls,snapshotCells,bind,displayStatus,displayEvidence,currentReason,draftReason:s=>drafts.get(key(s))??currentReason(s),snapshotFor:s=>matchSnapshot(s,state().students,snapshots).record,
    proposalExport:s=>proposals.exportFor(s),
    refreshReady:()=>!working&&!loading&&!proposals.isWorking()&&!drafts.size,
    async readRefresh(classId,date){const [meta,records,proposal,published,draft]=await Promise.all([getDoc(doc(db,'settings',`attendanceBeta_${classId}_${date}`)),loadCheckHereDay(db,classId,date),proposals.read(classId,date),getDoc(doc(db,'timetableBetaPublished',String(classId))),getDoc(doc(db,'timetableBetaDrafts',String(classId)))].map(p=>within(p)));return {metadata:meta.data()?.students||{},snapshots:records,proposal,entries:draft.data()?.entries||published.data()?.entries||[]};},
    applyRefresh(data,date){metadata=data.metadata;snapshots=data.snapshots;snapshotError='';excursionError='';excursions=excursionFor(data.entries,date);lectureEnds=lectureEndsOn(data.entries,date);proposals.applyRead(data.proposal);headerState();},
    canNavigate(){if(working||loading||proposals.isWorking())return false;return (!drafts.size&&!proposals.hasEdits())||confirm('저장하지 않은 사유 또는 체크히어 추천 편집값이 있습니다. 이동하면 입력 중인 사유가 사라집니다. 이동하시겠습니까?');},
    async load(classId,date){void loadSurveyLinks().then(()=>headerState());const n=++sequence;loading=true;drafts.clear();metadata={};snapshots=[];snapshotError='';excursions=[];lectureEnds=[];excursionError='';headerState();const results=await Promise.allSettled([getDoc(doc(db,'settings',`attendanceBeta_${classId}_${date}`)),loadCheckHereDay(db,classId,date),proposals.load(classId,date),getDoc(doc(db,'timetableBetaPublished',String(classId))),getDoc(doc(db,'timetableBetaDrafts',String(classId)))].map(p=>within(p)));if(n!==sequence)return;loading=false;teacherName=snapshots[0]?.teacher||'';if(results[0].status==='fulfilled')metadata=results[0].value.data()?.students||{};else showErr(new Error('포털 세부 구분을 불러오지 못했습니다. '+results[0].reason.message));if(results[1].status==='fulfilled')snapshots=results[1].value;else snapshotError='체크히어 저장본 조회 실패 · 다시 읽기 필요';if(results[3].status==='fulfilled'&&results[4].status==='fulfilled'){const published=results[3].value.data(),draft=results[4].value.data();const entries=draft?.entries||published?.entries||[];excursions=excursionFor(entries,date);lectureEnds=lectureEndsOn(entries,date);}else excursionError='견학일 여부 확인 실패 · 시간표를 확인해 주세요.';headerState();if(!teacherPromise)teacherPromise=within(getDocs(collection(db,'users')),12000).then(r=>r.docs.map(d=>d.data())).catch(()=>[]);void teacherPromise.then(users=>{if(n!==sequence)return;const teachers=users.filter(p=>p.active!==false&&p.role==='TEACHER'&&[p.primaryClassId,p.classId,...(p.classIds||[]),...(p.tempClassIds||[])].map(String).includes(String(classId)));teacherName=teachers.length===1?teachers[0].name||'':'';proposals.refresh(state().students);});},
  };
}
