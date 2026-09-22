import {UNIT_PERIODS,preparePeriod} from './attendance-period-core.mjs';
import {buildPeriodWorkbook,readUploadedAttendance} from './attendance-period-workbook.mjs';
import {readExportAttendance} from './raw-attendance-store.mjs';
import {within,readJson,pauseRead} from './attendance-io.mjs';
import {doc,getDocFromServer} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
let libraryPromise;
export function periodLibraries(){
 if(!libraryPromise)libraryPromise=Promise.all([['ExcelJS','https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'],['JSZip','https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js']].map(([name,src])=>window[name]?Promise.resolve():new Promise((resolve,reject)=>{const s=document.createElement('script'),timer=setTimeout(()=>{s.remove();reject(Error('Excel 도구 연결이 지연됩니다. 다시 시도해 주세요.'));},30000);s.src=src;s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);s.remove();reject(Error('Excel 도구를 불러오지 못했습니다.'));};document.head.append(s);}))).catch(e=>{libraryPromise=null;throw e;});
 return libraryPromise;
}
export async function mountAttendancePeriod(host,{db,user,classes}){
 const root=host.shadowRoot||host.attachShadow({mode:'open'});let busy=false,prepared=[],files=[],disposed=false,templates=null,selection=null;
 root.innerHTML=`<link rel="stylesheet" href="/metrics.css"><style>.period-classes{display:flex;flex-wrap:wrap;gap:12px;padding:16px}.period-classes label{display:flex;align-items:center;gap:4px}.period-classes input{width:auto}#periodResults{white-space:pre-wrap}#periodDownloads{display:flex;flex-wrap:wrap;gap:8px}.period-source{padding:16px}details{margin:16px 0}#periodLog{white-space:pre-wrap;max-height:320px;overflow:auto}</style><h2>단위기간 출석부 생성</h2><p>운영총괄 출석부와 포털 출결 DB를 대조하여 단위기간 출석부를 생성합니다. 저장된 인정 세부구분, 가-3 사유와 중도포기 여부를 반영합니다.</p><section class="metric-panel"><div class="metric-toolbar"><label>운영총괄 파일<select id="periodSource"><option value="google">Google Sheet에서 불러오기</option><option value="file">Excel 파일 업로드</option></select></label><label id="periodFileLabel" style="display:none">운영총괄 Excel<input id="periodFile" type="file" accept=".xlsx"></label><label>단위기간<select id="periodSelect">${UNIT_PERIODS.map(p=>`<option value="${p.id}">${p.id}단위기간 · ${p.from.slice(5)} ~ ${p.to.slice(5)}</option>`).join('')}<option value="custom">사용자 지정</option></select></label><label>시작일<input type="date" id="periodFrom" value="2026-07-27"></label><label>종료일<input type="date" id="periodTo" value="2026-08-26"></label></div><div class="period-classes"><label><input type="checkbox" id="periodAll" checked>전체 선택</label>${classes.map(c=>`<label><input type="checkbox" data-class="${c.id}" checked>${c.id}반</label>`).join('')}</div><p class="muted">원본 ZIP의 반별 양식·색상·수식을 사용합니다. 원본 데이터는 변경하지 않으며 결과 파일은 이 화면의 메모리에서만 생성합니다.</p><button id="periodCheck" class="primary">데이터 점검</button> <button id="periodGenerate" disabled>점검 결과로 출석부 생성</button> <button id="periodCancel" disabled>작업 취소</button></section><p id="periodState" role="status">단위기간과 반을 선택한 뒤 데이터 점검을 눌러 주세요.</p><section id="periodResults" class="metric-panel"></section><div id="periodDownloads"></div><details><summary>상세 처리 로그</summary><div id="periodLog"></div></details>`;
 const $=s=>root.querySelector(s),state=$('#periodState'),log=$('#periodLog');let operation;
 const invalidate=()=>{prepared=[];files=[];selection=null;$('#periodGenerate').disabled=true;$('#periodDownloads').innerHTML='';$('#periodResults').textContent='';};
 const lock=value=>{busy=value;root.querySelectorAll('input,select,#periodCheck,#periodGenerate').forEach(e=>e.disabled=value);$('#periodGenerate').disabled=value||!prepared.length;$('#periodCancel').disabled=!value;};
 const write=text=>{if(!disposed){state.textContent=text;log.textContent+=text+'\n';}};
 $('#periodSelect').onchange=()=>{const p=UNIT_PERIODS.find(p=>p.id===$('#periodSelect').value);if(p){$('#periodFrom').value=p.from;$('#periodTo').value=p.to;}invalidate();};
 for(const id of ['#periodFrom','#periodTo'])$(id).onchange=()=>{$('#periodSelect').value='custom';invalidate();};
 $('#periodSource').onchange=()=>{$('#periodFileLabel').style.display=$('#periodSource').value==='file'?'block':'none';invalidate();};$('#periodFile').onchange=invalidate;
 $('#periodAll').onchange=e=>{root.querySelectorAll('[data-class]').forEach(c=>c.checked=e.target.checked);invalidate();};root.querySelectorAll('[data-class]').forEach(c=>c.onchange=()=>{$('#periodAll').checked=[...root.querySelectorAll('[data-class]')].every(c=>c.checked);invalidate();});
 $('#periodCancel').onclick=()=>operation?.abort();
 $('#periodCheck').onclick=async()=>{
  invalidate();log.textContent='';operation=new AbortController();lock(true);const signal=operation.signal;
  try{
   const from=$('#periodFrom').value,to=$('#periodTo').value,ids=[...root.querySelectorAll('[data-class]:checked')].map(c=>c.dataset.class),period=$('#periodSelect').value;
   if(!ids.length||!from||!to||from>to||from<'2026-07-27'||to>'2026-10-22')throw Error('대상 반과 교육기간 안의 날짜를 선택해 주세요.');
   selection={from,to,ids,period:period==='custom'?(UNIT_PERIODS.find(p=>from>=p.from&&to<=p.to)?.id||'사용자지정'):period};
   await periodLibraries();signal.throwIfAborted();if(!templates){const res=await fetch('/attendance-period-templates.json',{signal});if(!res.ok)throw Error('반별 양식을 불러오지 못했습니다.');templates=await res.json();}
   let uploaded=null;if($('#periodSource').value==='file'){const file=$('#periodFile').files[0];if(!file)throw Error('운영총괄 Excel 파일을 선택해 주세요.');if(file.size>35*1024*1024)throw Error('Excel 파일은 35MB 이하로 선택해 주세요.');uploaded=new window.ExcelJS.Workbook();await uploaded.xlsx.load(await file.arrayBuffer());}
   for(let i=0;i<ids.length;i++){
    signal.throwIfAborted();const id=ids[i];write(`${id}반 데이터를 불러오는 중 · ${i+1}/${ids.length}`);
    try{
     const data=uploaded?readUploadedAttendance(uploaded,id):await readJson('/api/attendance-reader',{classId:id,idToken:await within(user.getIdToken(),15000,undefined,signal),allowCache:true},{signal});
     const stored=await readExportAttendance(db,id,from,to,signal,{classificationOnly:true}),schedule=await within(getDocFromServer(doc(db,'timetableBetaPublished',id)),20000,undefined,signal);signal.throwIfAborted();
     const result=preparePeriod({classId:id,data,stored,from,to,entries:schedule.data()?.entries||[],uploaded:!!uploaded});prepared.push(result);write(`${id}반: 학생 ${result.stats.students}명 / 교육일 ${result.stats.days}일 / ${result.stats.cells}건 · 인정지각 ${result.stats.recognizedLate} · 인정조퇴 ${result.stats.recognizedEarly} · 인정외출 ${result.stats.recognizedOuting} · 중도포기 ${result.stats.dropout} · 개인사정 ${result.stats.personal} · 확인필요 ${result.reviews.length}건`);
    }catch(e){signal.throwIfAborted();write(`${id}반 생성 불가: ${e.message}`);}
    if(i<ids.length-1)await pauseRead(2500,signal);
   }
   const count=prepared.reduce((n,r)=>n+r.reviews.length,0),sum=key=>prepared.reduce((n,r)=>n+r.stats[key],0);$('#periodResults').textContent=`생성 예정: ${from} ~ ${to}\n${prepared.map(r=>r.classId+'반').join(', ')}\n학생 ${sum('students')}명 · 출결 ${sum('cells')}건 · 확인필요 ${count}건\n인정지각 ${sum('recognizedLate')}건 · 인정조퇴 ${sum('recognizedEarly')}건 · 인정외출 ${sum('recognizedOuting')}건\n중도포기 ${sum('dropout')}명 · 개인사정 자동 적용 ${sum('personal')}건\n${ids.length-prepared.length}개 반 수집 실패. 상세 로그와 확인필요 목록을 검토해 주세요.`;
   write('사전 점검 완료. 아래 요약을 확인한 뒤 출석부 생성을 눌러 주세요.');
  }catch(e){prepared=[];write('점검 중단 · '+e.message);}finally{if(!disposed)lock(false);}
 };
 const download=(bytes,name,mime)=>{const url=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
 $('#periodGenerate').onclick=async()=>{
  operation=new AbortController();lock(true);files=[];$('#periodDownloads').innerHTML='';
  try{
   for(const r of prepared){operation.signal.throwIfAborted();write(`${r.classId}반 Excel 생성 중…`);const book=buildPeriodWorkbook(window.ExcelJS,r,templates,selection.period),bytes=await book.xlsx.writeBuffer();files.push({id:r.classId,bytes,name:`${r.classId.padStart(2,'0')}반_${selection.period}단위출석부_${selection.from.slice(5).replace('-','')}-${selection.to.slice(5).replace('-','')}.xlsx`});}
   operation.signal.throwIfAborted();if(disposed)return;const zipButton=document.createElement('button');zipButton.textContent=`선택 ${files.length}개 반 ZIP 다운로드`;zipButton.onclick=async()=>{zipButton.disabled=true;try{const zip=new window.JSZip();files.forEach(f=>zip.file(f.name,f.bytes));const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});if(!disposed)download(bytes,`${files.length===17?'1-17':files.map(f=>f.id).join(',')}반_${selection.period}단위출석부_${selection.from.slice(5).replace('-','')}-${selection.to.slice(5).replace('-','')}.zip`,'application/zip');}finally{zipButton.disabled=false;}};$('#periodDownloads').append(zipButton);
   for(const file of files){const b=document.createElement('button');b.textContent=file.id+'반 Excel 다운로드';b.onclick=()=>download(file.bytes,file.name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');$('#periodDownloads').append(b);}
   write(`${files.length}개 반 Excel 생성 완료. 확인필요 시트를 검토한 뒤 마감해 주세요.`);
  }catch(e){files=[];write('생성 중단 · '+e.message);}finally{if(!disposed)lock(false);}
 };
 return {canLeave:()=>!busy,dispose(){disposed=true;operation?.abort();prepared=[];files=[];}};
}
