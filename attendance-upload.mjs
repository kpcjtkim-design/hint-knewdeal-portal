import {UNIT_PERIODS} from './attendance-period-core.mjs';
import {rosterFromSheet,buildUploadRows,sheetRows,uploadWorkbook} from './attendance-upload-core.mjs';
import {latestSnapshots,koreaToday} from './attendance-beta-core.mjs';
import {loadLegacyCheckHereDay} from './checkhere-snapshots.mjs';
import {within} from './attendance-io.mjs';
import {surveyBaseName} from './survey-identity.mjs';
import {collection,doc,getDocFromServer,getDocsFromServer,query,where} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function weekdays(from,to){
 const out=[];for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=864e5){const d=new Date(t);if(d.getUTCDay()%6)out.push(d.toISOString().slice(0,10));}
 return out;
}

// 단위기간 출석부 화면 아래에서 HRD 출결 업로드 파일을 만듭니다. 결과는 이 화면의 메모리에만 둡니다.
export function mountAttendanceUpload(section,{db,user,classes,loadLibraries}){
 let busy=false,disposed=false,file=null,operation;
 section.innerHTML=`<h2>출결 업로드 파일</h2><p>체크히어에 저장된 입실·퇴실·외출 시각을 HRD 출결 업로드 양식(9칸)으로 내려받습니다. 생년월일성별 7자리는 보관된 생년월일·성별로 이 화면에서 계산하며 따로 저장하지 않습니다.</p>
 <section class="metric-panel"><div class="metric-toolbar">
  <label>단위기간<select id="upPeriod">${UNIT_PERIODS.map(p=>`<option value="${p.id}">${p.id}단위기간 · ${p.from.slice(5)} ~ ${p.to.slice(5)}</option>`).join('')}</select></label>
  <label>반<select id="upClass">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반</option>`).join('')}</select></label>
  <label>교육생 정보<select id="upRosterSource"><option value="sheet">마스터시트 명부 (보관된 생년월일·성별)</option><option value="file">교육생 명단 Excel 파일</option></select></label>
  <label id="upFileLabel" style="display:none">교육생 명단 Excel<input id="upFile" type="file" accept=".xlsx"></label>
  <label>훈련과정ID<input id="upCourse" placeholder="비워 두면 빈칸" autocomplete="off"></label>
  <label>훈련과정회차<input id="upRound" placeholder="비워 두면 빈칸" autocomplete="off"></label>
 </div><button id="upMake" class="primary">업로드 파일 만들기</button></section>
 <p id="upState" role="status">단위기간과 반을 고른 뒤 업로드 파일 만들기를 눌러 주세요.</p><section id="upResult"></section>`;
 const $=s=>section.querySelector(s),state=$('#upState'),result=$('#upResult');
 const say=text=>{if(!disposed)state.textContent=text;};
 const reset=()=>{file=null;result.innerHTML='';};
 const lock=value=>{busy=value;section.querySelectorAll('input,select,button').forEach(e=>e.disabled=value);};
 $('#upRosterSource').onchange=()=>{$('#upFileLabel').style.display=$('#upRosterSource').value==='file'?'':'none';reset();};
 for(const id of ['#upPeriod','#upClass','#upFile','#upCourse','#upRound'])$(id).addEventListener('change',reset);

 async function checkhereRecords(cid,from,to,signal){
  const snap=await within(getDocsFromServer(query(collection(db,'classes',cid,'checkhereCurrent'),where('date','>=',from),where('date','<=',to))),30000,undefined,signal);
  const byDate=new Map(snap.docs.map(d=>{const date=d.data().date||d.id;return [date,latestSnapshots(d.data().records||[],cid,date)];}));
  // 현재 저장본이 없는 평일만 예전 수집 저장본을 하루씩 확인합니다.
  const today=koreaToday();
  for(const date of weekdays(from,to<today?to:today)){
   if(byDate.has(date))continue;signal.throwIfAborted();
   const legacy=await within(loadLegacyCheckHereDay(db,cid,date),30000,undefined,signal);if(legacy.length)byDate.set(date,legacy);
  }
  return {records:[...byDate.values()].flat(),reads:snap.size};
 }
 async function sheetApi(action,cid){
  const token=await within(user.getIdToken(),15000);
  const res=await fetch('/api/teacher-beta',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({action,args:[Number(cid),''],cls:Number(cid)})});
  const j=await res.json().catch(()=>({ok:false,error:'마스터시트 응답을 읽지 못했습니다.'}));
  if(!j.ok)throw Error(j.error||'마스터시트를 읽지 못했습니다.');
  return j.data;
 }
 // 출결원장(유형·외출 시각)과 명부 상태. 중도포기·외출·결석 대조에 씁니다.
 async function masterLedger(cid){
  const d=await sheetApi('portalData',cid)||{},ledger=new Map(),leavers=new Map();
  for(const [k,v] of Object.entries(d.recs||{})){const i=k.lastIndexOf('|');if(i>0)ledger.set(surveyBaseName(k.slice(0,i))+'|'+k.slice(i+1),{type:v?.type,oa:v?.oa,ob:v?.ob});}
  for(const kid of d.kids||[])if(kid?.status&&kid.status!=='재학')leavers.set(surveyBaseName(kid.name),kid.status);
  return {ledger,leavers};
 }
 // 출결원장을 못 읽으면 포털 출결 통계 저장본의 자동 중도포기 표시를 씁니다(읽기 1번).
 async function summaryLeavers(cid,signal){
  const snap=await within(getDocFromServer(doc(db,'attendanceBetaSummaries',cid)),20000,undefined,signal);
  return new Map((snap.data()?.students||[]).filter(s=>s.dropout).map(s=>[surveyBaseName(s.name),'중도포기']));
 }
 async function rosterFromMaster(cid){
  let data;try{data=await sheetApi('portalRoster',cid);}catch(e){throw Error(`${e.message} 교육생 정보를 '교육생 명단 Excel 파일'로 바꿔 만들 수 있습니다.`);}
  const list=(Array.isArray(data)?data:[]).map(s=>({name:String(s.name||''),birth:s.birth,gender:s.gender,phone:''})).filter(s=>s.name);
  if(!list.some(s=>s.birth&&s.gender))throw Error(`마스터시트 명부에 ${cid}반 생년월일·성별이 아직 없습니다. 교육생 명단 Excel 파일로 만들 수 있습니다.`);
  return list;
 }
 async function rosterFromFile(cid){
  const picked=$('#upFile').files[0];if(!picked)throw Error('교육생 명단 Excel 파일을 선택해 주세요.');
  if(picked.size>35*1024*1024)throw Error('Excel 파일은 35MB 이하로 선택해 주세요.');
  const book=new window.ExcelJS.Workbook();await book.xlsx.load(await picked.arrayBuffer());
  for(const ws of [book.getWorksheet('합격자'),...book.worksheets].filter(Boolean)){
   try{const list=rosterFromSheet(sheetRows(ws),cid);if(list.length)return list;}catch{}
  }
  throw Error(`명단 파일에서 ${cid}반 교육생을 찾지 못했습니다. '합격자' 시트의 반배정_확정 칸을 확인해 주세요.`);
 }
 function issuesTable(issues){
  return issues.length?`<details open><summary>확인 필요 ${issues.length}건</summary><div style="overflow-x:auto"><table><thead><tr><th>날짜</th><th>이름</th><th>내용</th></tr></thead><tbody>${issues.map(i=>`<tr><td>${esc(i.date)}</td><td>${esc(i.name)}</td><td>${esc(i.issue)}</td></tr>`).join('')}</tbody></table></div></details>`:'<p>확인할 항목이 없습니다.</p>';
 }

 $('#upMake').onclick=async()=>{
  if(busy)return;reset();operation=new AbortController();const signal=operation.signal;lock(true);
  try{
   const period=UNIT_PERIODS.find(p=>p.id===$('#upPeriod').value),cid=$('#upClass').value;
   say(`${cid}반 ${period.id}단위기간 체크히어 기록을 불러오는 중…`);
   await loadLibraries();signal.throwIfAborted();
   const roster=$('#upRosterSource').value==='file'?await rosterFromFile(cid):await rosterFromMaster(cid);signal.throwIfAborted();
   const {records}=await checkhereRecords(cid,period.from,period.to,signal);
   if(!records.length)throw Error(`${cid}반 ${period.from} ~ ${period.to} 체크히어 저장본이 없습니다. 체크히어 수집·저장을 먼저 확인해 주세요.`);
   say('마스터시트 출결원장과 대조하는 중…');
   let sheet;try{sheet=await masterLedger(cid);}catch(e){sheet={error:e.message};}signal.throwIfAborted();
   let leavers=sheet.leavers;if(!leavers){try{leavers=await summaryLeavers(cid,signal);}catch{leavers=new Map();}}
   const built=buildUploadRows({records,roster,leavers,ledger:sheet.ledger||null,courseId:$('#upCourse').value.trim(),round:$('#upRound').value.trim()});
   const bytes=await uploadWorkbook(window.ExcelJS,built.rows).xlsx.writeBuffer();signal.throwIfAborted();if(disposed)return;
   file={bytes,name:`출결업로드_${cid.padStart(2,'0')}반_${period.id}단위_${period.from.slice(5).replace('-','')}-${period.to.slice(5).replace('-','')}.xlsx`};
   const s=built.stats;
   result.innerHTML=`<p><strong>${esc(file.name)}</strong></p><p>행 ${s.rows}개 · 교육생 ${s.students}명 · 교육일 ${s.days}일 · 생년월일성별 ${s.coded}명 채움 · 입퇴실 빈칸 ${s.empty}행 · 중도포기 ${s.leavers}명(이후 ${s.cut}일 제외)</p>${sheet.ledger?'<p>마스터시트 출결원장과 대조했습니다. 외출 시각이 체크히어에 없으면 출결원장 값을 넣었습니다.</p>':`<p class="muted">출결원장과 대조하지 못했습니다 (${esc(sheet.error)}). 체크히어 기록만으로 만들었고, 중도포기는 포털 출결 통계 저장본으로 가렸습니다.</p>`}<p class="muted">교육생 개인정보(생년월일성별)가 들어 있는 파일입니다. 업로드 후에는 PC에서 지워 주세요.</p><button id="upDownload" class="primary">Excel 다운로드</button>${issuesTable(built.issues)}`;
   $('#upDownload').onclick=()=>{if(!file)return;const url=URL.createObjectURL(new Blob([file.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
   say(`${cid}반 ${period.id}단위기간 업로드 파일을 만들었습니다. 확인 필요 항목을 본 뒤 내려받아 주세요.`);
  }catch(e){if(!disposed)say('만들지 못했습니다 · '+e.message);}
  finally{if(!disposed)lock(false);}
 };
 return {busy:()=>busy,dispose(){disposed=true;operation?.abort();file=null;}};
}
