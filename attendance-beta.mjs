import {doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {GoogleAuthProvider,reauthenticateWithPopup} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {ATTENDANCE_OPTIONS,EVIDENCE_OPTIONS,EVIDENCE_COLORS,emptyStatus,hasExistingReason,portalStatus,evidenceStatus,rewriteReasons,sheetStatus,matchSnapshot} from './attendance-beta-core.mjs';
import {createSheetWriter} from './attendance-beta-sheet.mjs';
import {loadCheckHereDay} from './checkhere-snapshots.mjs';
import {judge} from './checkhere/rules.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
export function createAttendanceBeta({db,user,root,state,render,showErr,reasonFor,colorState}){
  let metadata={},snapshots=[],snapshotError='',working=false,loading=false,sequence=0;
  const drafts=new Map();
  const writer=createSheetWriter({
    async authorize(){const provider=new GoogleAuthProvider();provider.addScope('https://www.googleapis.com/auth/spreadsheets');provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');provider.setCustomParameters({login_hint:user.email,prompt:'consent'});const result=await reauthenticateWithPopup(user,provider),credential=GoogleAuthProvider.credentialFromResult(result);if(!credential?.accessToken)throw Error('Google 시트 편집 인증을 완료하지 못했습니다.');return credential.accessToken;},
    async getClassConfig(cid){return (await getDoc(doc(db,'classes',cid))).data()||{};}
  });
  const key=s=>`${s.rowIndex}_${s.name}`;
  const info=s=>metadata[key(s)]||{};
  const currentReason=s=>{const m=info(s);if(m.reasonEntry&&state().raw.split(/\r?\n/).includes(m.reasonEntry))return m.portalReason;return reasonFor(s.name,state().raw,state().students.map(x=>x.name),s.all[state().date.idx]);};
  const rawColor=s=>String(state().backgrounds?.[s.rowIndex+1]?.[state().date.idx+4]||'#ffffff').toLowerCase();
  function displayStatus(s){const raw=String(s.all[state().date.idx]||'').trim();try{return portalStatus(raw,info(s));}catch{return raw||'해당없음';}}
  function displayEvidence(s){return evidenceStatus(rawColor(s),String(s.all[state().date.idx]||''),info(s),colorState);}
  async function persistMeta(s,patch){const ctx=state(),ref=doc(db,'settings',`attendanceBeta_${ctx.classId}_${ctx.iso}`);metadata={...metadata,[key(s)]:{...info(s),...patch}};try{await setDoc(ref,{classId:ctx.classId,date:ctx.iso,students:{[key(s)]:patch},updatedBy:user.email,updatedAt:serverTimestamp()},{merge:true});}catch(e){showErr(new Error('시트 저장은 완료됐지만 포털 세부 구분 저장에 실패했습니다. '+e.message));}}
  function controls(s){
    const status=displayStatus(s),evidence=displayEvidence(s),disabled=(!writer.connected()||working||loading)?'disabled':'';
    const options=ATTENDANCE_OPTIONS.includes(status)?ATTENDANCE_OPTIONS:[status,...ATTENDANCE_OPTIONS];
    return {status:`<select class="beta-status" aria-label="${esc(s.name)} 출결" data-student="${esc(key(s))}" ${disabled}>${options.map(x=>`<option ${x===status?'selected':''}>${esc(x)}</option>`).join('')}</select>`,reason:`<input class="beta-reason" aria-label="${esc(s.name)} 사유" maxlength="500" data-student="${esc(key(s))}" value="${esc(drafts.has(key(s))?drafts.get(key(s)):currentReason(s))}" ${working||loading?'disabled':''}>`,evidence:`<select class="beta-evidence" aria-label="${esc(s.name)} 서류제출" data-student="${esc(key(s))}" ${disabled}>${EVIDENCE_OPTIONS.map(x=>`<option ${x===evidence?'selected':''}>${x}</option>`).join('')}</select>`};
  }
  function snapshotCells(s){
    if(snapshotError)return`<div class="cell beta-source" style="grid-column:span 5">${esc(snapshotError)}</div>`;
    const {record:r,error}=matchSnapshot(s,state().students,snapshots);if(!r)return`<div class="cell beta-source" style="grid-column:span 5">${esc(error)}</div>`;
    const time=r.collectedAt?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(r.collectedAt)):'';
    const audited=judge(r),cell=x=>`<div class="cell beta-source">${x}</div>`;
    return cell(`${esc(r.rawEntry??r.entry??'—')}<br>→ ${esc(r.exit||'—')}<small>수집 ${esc(time)}</small>`)+cell(`${audited.labels.map(esc).join(' · ')}<small>${r.readState==='complete'?'저장본':'상세 수집 실패'}</small>`)+cell(esc(r.entryMemo??'미수집'))+cell(esc(r.exitMemo??'미수집'))+cell(r.outings?.map(x=>`${esc(x.start||'—')} ~ ${esc(x.end||'—')}`).join('<br>')||(r.readState==='complete'?'없음':'미확인'));
  }
  function headerState(){const save=root.querySelector('#saveReasons');if(save){save.textContent=`사유 저장${drafts.size?' ('+drafts.size+')':''}`;save.disabled=!drafts.size||working||loading||!writer.connected();}const c=root.querySelector('#sheetConnect');if(c){c.disabled=working||loading;c.textContent=writer.connected()?'내 계정 연결됨':'내 계정 시트 연결';}for(const id of ['classSel','dateSel','reload']){const el=root.querySelector('#'+id);if(el)el.disabled=working||loading;}}
  async function action(fn){if(working||loading)return;working=true;showErr('');render();try{await fn();}catch(e){showErr(e);}finally{working=false;render();}}
  function bind(){
    const student=id=>state().students.find(s=>key(s)===id);
    root.querySelectorAll('.beta-status').forEach(el=>el.onchange=()=>{const s=student(el.dataset.student),before=displayStatus(s),after=el.value;el.value=before;if(after===before)return;if(!emptyStatus(before)&&!confirm(`${s.name}의 출결을 변경하시겠습니까?\n${before} → ${after}`))return;action(async()=>{const ctx=state(),raw=String(s.all[ctx.date.idx]||'').trim();await writer.write({classId:ctx.classId,date:ctx.iso,name:s.name,kind:'status',before:raw,after});s.all[ctx.date.idx]=sheetStatus(after);await persistMeta(s,{portalStatus:after,sheetStatus:sheetStatus(after)});});});
    root.querySelectorAll('.beta-evidence').forEach(el=>el.onchange=()=>{const s=student(el.dataset.student),before=displayEvidence(s),after=el.value;el.value=before;if(after===before)return;if(!confirm(`${s.name}의 서류제출 상태와 시트 배경색을 변경하시겠습니까?\n${before} → ${after}`))return;action(async()=>{const ctx=state(),color=EVIDENCE_COLORS[after];await writer.write({classId:ctx.classId,date:ctx.iso,name:s.name,kind:'color',before:rawColor(s),after:color});ctx.backgrounds[s.rowIndex+1]??=[];ctx.backgrounds[s.rowIndex+1][ctx.date.idx+4]=color;await persistMeta(s,{evidenceStatus:after,sheetColor:color});});});
    root.querySelectorAll('.beta-reason').forEach(el=>el.oninput=()=>{const s=student(el.dataset.student);if(el.value===currentReason(s))drafts.delete(key(s));else drafts.set(key(s),el.value);headerState();});headerState();
  }
  async function saveReasons(){
    const changed=state().students.filter(s=>drafts.has(key(s)));if(!changed.length)return;
    const correcting=changed.filter(s=>hasExistingReason(state().raw,s.name,currentReason(s)));if(correcting.length&&!confirm(`기존 사유를 변경하시겠습니까?\n${correcting.map(s=>s.name).join(', ')}`))return;
    await action(async()=>{const ctx=state(),updates=Object.fromEntries(changed.map(s=>[s.name,drafts.get(key(s))])),next=rewriteReasons(ctx.raw,updates,ctx.students.map(x=>x.name));if(next!==ctx.raw){await writer.write({classId:ctx.classId,date:ctx.iso,name:changed[0].name,kind:'reason',before:ctx.raw,after:next});ctx.setRaw(next);}for(const s of changed){const value=updates[s.name].trim();await persistMeta(s,{portalReason:value,reasonEntry:value?`${s.name}: ${value}`:''});}drafts.clear();});
  }
  root.querySelector('#sheetConnect').onclick=()=>action(async()=>{await writer.connect(state().classId);});
  root.querySelector('#saveReasons').onclick=saveReasons;
  return {controls,snapshotCells,bind,displayStatus,displayEvidence,currentReason,draftReason:s=>drafts.get(key(s))??currentReason(s),snapshotFor:s=>matchSnapshot(s,state().students,snapshots).record,
    canNavigate(){if(working||loading)return false;return !drafts.size||confirm('저장하지 않은 사유가 있습니다. 이동하면 입력 중인 사유가 사라집니다. 이동하시겠습니까?');},
    async load(classId,date){const n=++sequence;loading=true;drafts.clear();metadata={};snapshots=[];snapshotError='';headerState();const results=await Promise.allSettled([getDoc(doc(db,'settings',`attendanceBeta_${classId}_${date}`)),loadCheckHereDay(db,classId,date)]);if(n!==sequence)return;loading=false;if(results[0].status==='fulfilled')metadata=results[0].value.data()?.students||{};else showErr(new Error('포털 세부 구분을 불러오지 못했습니다. '+results[0].reason.message));if(results[1].status==='fulfilled')snapshots=results[1].value;else snapshotError='체크히어 저장본 조회 실패 · 다시 읽기 필요';headerState();},
  };
}
