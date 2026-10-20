// 2기 단위기간 출석부 화면(관리자 출결 › 내려받기). 1기와 같은 양식으로, 자료는 2기 마스터시트 출결원장(b2Bundle 'all' 한 번 읽기)입니다.
// 모든 계산과 Excel 생성은 이 브라우저 메모리에서 하고, 시트·DB에는 아무것도 쓰지 않습니다(1기와 같음).
// 순서: 단위기간·반 고르기 → 데이터 점검(묶음 읽기 + 반별 계산 + 요약) → 출석부 생성 → 다운로드 전 확인(download-preflight-ui) → ZIP 또는 반별 Excel.
import {esc} from './beta2-ui.mjs';
import {UNIT_PERIODS,isTestClass,REAL_CLASS_IDS,mdLabel} from './cohort.mjs';
import {ledgerIndex} from './beta2-core.mjs';
import {prepareB2Period,b2PeriodProfile,b2PeriodCheck,b2PeriodFileName,b2PeriodZipName,periodIdFor} from './attendance-period-b2-core.mjs?v=20261020-pr1';
import {buildPeriodWorkbook} from './attendance-period-workbook.mjs?v=20261020-pr1';
import {attendanceDownloadPreflight} from './download-preflight-core.mjs';
import {confirmDownloadPreflight} from './download-preflight-ui.mjs';

export function mountB2Period(host,{client,classes,loadLibraries}){
 let busy=false,disposed=false,prepared=[],files=[],checks=[],failures=[],templates=null,selection=null,operation=null;
 const first=UNIT_PERIODS[0];
 host.innerHTML=`<section class="b2-card"><div class="b2-pad"><h3 style="margin:0 0 4px">단위기간 출석부</h3><p class="b2-muted b2-small" style="margin:0">1기와 같은 HRD 단위기간 출석부 양식(서식·색·수식)으로 반별 Excel을 만듭니다. 출결·사유·증빙·중도탈락은 마스터시트 출결원장과 명부에서 읽고, 결과는 이 화면에서만 만들어 시트에는 아무것도 쓰지 않습니다.</p></div>
 <div class="b2-toolbar"><label class="b2-field">단위기간<select id="prPeriod">${UNIT_PERIODS.map(p=>`<option value="${p.no}">${p.no}단위기간 · ${esc(mdLabel(p.from))} ~ ${esc(mdLabel(p.to))}</option>`).join('')}<option value="custom">사용자 지정</option></select></label>
  <label class="b2-field">시작일<input type="date" id="prFrom" value="${first.from}"></label><label class="b2-field">종료일<input type="date" id="prTo" value="${first.to}"></label></div>
 <div class="b2-toolbar" style="padding-top:0"><label class="b2-mini"><input type="checkbox" id="prAll" checked> 전체 반</label>${classes.map(c=>{const test=isTestClass(c.id);return `<label class="b2-mini"${test?' title="시험용 테스트반: 공식 제출 묶음에는 기본으로 빠집니다."':''}><input type="checkbox" data-class="${esc(c.id)}"${test?' data-test="1"':' checked'}> ${esc(c.id)}반${test?' (테스트반)':''}</label>`;}).join('')}</div>
 <div class="b2-toolbar" style="padding-top:0"><button type="button" class="b2-btn primary" id="prCheck">데이터 점검</button><button type="button" class="b2-btn" id="prGenerate" disabled>점검 결과로 출석부 생성</button><button type="button" class="b2-btn ghost" id="prCancel" disabled>작업 취소</button></div>
 <p id="prState" role="status" class="b2-pad b2-small" style="margin:0;padding-top:0">단위기간과 반을 고른 뒤 데이터 점검을 눌러 주세요.</p>
 <pre id="prResults" class="b2-pad b2-small" style="margin:0;padding-top:0;white-space:pre-wrap;font:inherit"></pre>
 <div id="prDownloads" class="b2-toolbar" style="padding-top:0"></div>
 <details class="b2-pad" style="padding-top:0"><summary class="b2-small">상세 처리 로그</summary><div id="prLog" class="b2-small" style="white-space:pre-wrap;max-height:320px;overflow:auto"></div></details></section>`;
 const $=s=>host.querySelector(s),state=$('#prState'),log=$('#prLog'),boxes=()=>[...host.querySelectorAll('[data-class]')];
 const invalidate=()=>{prepared=[];files=[];checks=[];failures=[];selection=null;$('#prGenerate').disabled=true;$('#prDownloads').innerHTML='';$('#prResults').textContent='';};
 const lock=value=>{busy=value;host.querySelectorAll('input,select,#prCheck,#prGenerate,#prDownloads button').forEach(e=>e.disabled=value);$('#prGenerate').disabled=value||!prepared.length;$('#prCancel').disabled=!value;};
 const write=text=>{if(!disposed){state.textContent=text;log.textContent+=text+'\n';}};
 $('#prPeriod').onchange=()=>{const p=UNIT_PERIODS.find(p=>String(p.no)===$('#prPeriod').value);if(p){$('#prFrom').value=p.from;$('#prTo').value=p.to;}invalidate();};
 for(const id of ['#prFrom','#prTo'])$(id).onchange=()=>{$('#prPeriod').value='custom';invalidate();};
 // '전체 반'은 공식 반만 켜고 끕니다(테스트반은 따로 골라야 들어감).
 $('#prAll').onchange=e=>{boxes().forEach(c=>c.checked=!c.dataset.test&&e.target.checked);invalidate();};
 boxes().forEach(c=>c.onchange=()=>{$('#prAll').checked=boxes().filter(b=>!b.dataset.test).every(b=>b.checked);invalidate();});
 $('#prCancel').onclick=()=>operation?.abort();
 $('#prCheck').onclick=async()=>{
  invalidate();log.textContent='';operation=new AbortController();lock(true);const signal=operation.signal;
  try{
   const from=$('#prFrom').value,to=$('#prTo').value,ids=boxes().filter(c=>c.checked).map(c=>c.dataset.class);
   if(!ids.length||!from||!to||from>to)throw Error('대상 반과 날짜(시작 ≤ 끝)를 골라 주세요.');
   selection={from,to,ids,period:periodIdFor(from,to,$('#prPeriod').value)};
   write('Excel 도구와 출석부 양식을 불러오는 중…');
   await loadLibraries();signal.throwIfAborted();
   if(!templates){const res=await fetch('/attendance-period-templates.json',{signal});if(!res.ok)throw Error('출석부 양식을 불러오지 못했습니다.');templates=await res.json();}
   write('마스터시트 출결원장·명부를 읽는 중…');
   const bundle=await client.bundle('all',{fresh:true});signal.throwIfAborted();
   const index=ledgerIndex(bundle);
   for(const id of ids){
    try{
     const result=prepareB2Period({bundle,classId:id,from,to,index}),profile=b2PeriodProfile(templates,id,bundle.classes.find(c=>String(c.id)===id)||{});
     prepared.push({result,profile});checks.push(b2PeriodCheck(result));const s=result.stats;
     write(`${id}반: 학생 ${s.students}명 / 교육일 ${s.days}일 / ${s.cells}건 · 인정출석 ${s.recognizedFull} · 인정지각 ${s.recognizedLate} · 인정조퇴 ${s.recognizedEarly} · 인정외출 ${s.recognizedOuting} · 중도포기 등 ${s.dropout}명 · 개인사정 ${s.personal} · 확인필요 ${result.reviews.length}건${profile.missing.length?` · 마스터시트 반정보에 ${profile.missing.join('·')} 없음(빈칸)`:''}`);
    }catch(e){failures.push({classId:id,message:e.message});write(`${id}반 생성 불가: ${e.message}`);}
   }
   const sum=key=>prepared.reduce((n,p)=>n+p.result.stats[key],0),count=prepared.reduce((n,p)=>n+p.result.reviews.length,0);
   $('#prResults').textContent=`생성 예정: ${from} ~ ${to} (${selection.period==='사용자지정'?'사용자 지정':selection.period+'단위기간'})\n${prepared.map(p=>p.result.classId+'반').join(', ')||'없음'}\n학생 ${sum('students')}명 · 출결 ${sum('cells')}건 · 확인필요 ${count}건\n인정출석 ${sum('recognizedFull')}건 · 인정지각 ${sum('recognizedLate')}건 · 인정조퇴 ${sum('recognizedEarly')}건 · 인정외출 ${sum('recognizedOuting')}건\n중도포기·조기취업 등 ${sum('dropout')}명 · 사유 없어 개인사정 ${sum('personal')}건${sum('future')?` · 아직 오지 않은 교육일 빈칸 ${sum('future')}건`:''}\n${failures.length?`${failures.length}개 반 생성 불가. 상세 로그를 확인해 주세요.`:''}`;
   write('점검 완료. 요약을 확인한 뒤 출석부 생성을 눌러 주세요.');
  }catch(e){prepared=[];checks=[];write('점검 중단 · '+e.message);}finally{if(!disposed)lock(false);}
 };
 const download=(bytes,name,mime)=>{const url=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
 const checkedDownload=async(ids,perform,includeFailures=false)=>{
  if(busy||disposed)return;operation=new AbortController();lock(true);
  try{const summary=attendanceDownloadPreflight(checks.filter(c=>ids.includes(c.classId)),{label:`${selection.from} ~ ${selection.to} · ${ids.map(id=>id+'반').join(', ')}`,failures:includeFailures?failures:[]});
   if(await confirmDownloadPreflight(summary,{signal:operation.signal})){operation.signal.throwIfAborted();if(!disposed)await perform();}
   else write('다운로드를 보류했습니다. 점검 결과를 확인한 뒤 다시 다운로드할 수 있습니다.');
  }catch(e){write('다운로드 중단 · '+e.message);}finally{if(!disposed)lock(false);}
 };
 $('#prGenerate').onclick=async()=>{
  operation=new AbortController();lock(true);files=[];$('#prDownloads').innerHTML='';
  try{
   for(const {result,profile} of prepared){
    operation.signal.throwIfAborted();write(`${result.classId}반 Excel 생성 중…`);
    const book=buildPeriodWorkbook(window.ExcelJS,result,templates,selection.period,{profile}),bytes=await book.xlsx.writeBuffer();
    files.push({id:result.classId,bytes,name:b2PeriodFileName(result.classId,selection.period,selection.from,selection.to)});
   }
   operation.signal.throwIfAborted();if(disposed)return;
   const zip=document.createElement('button');zip.type='button';zip.className='b2-btn primary';zip.textContent=`선택 ${files.length}개 반 ZIP 다운로드`;
   zip.onclick=()=>checkedDownload(files.map(f=>f.id),async()=>{const z=new window.JSZip();files.forEach(f=>z.file(f.name,f.bytes));const bytes=await z.generateAsync({type:'uint8array',compression:'DEFLATE'});if(!disposed&&!operation.signal.aborted)download(bytes,b2PeriodZipName(files.map(f=>f.id),selection.period,selection.from,selection.to,[...REAL_CLASS_IDS]),'application/zip');},true);
   $('#prDownloads').append(zip);
   for(const file of files){const b=document.createElement('button');b.type='button';b.className='b2-btn small';b.textContent=file.id+'반 Excel';b.onclick=()=>checkedDownload([file.id],()=>download(file.bytes,file.name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));$('#prDownloads').append(b);}
   write(`${files.length}개 반 Excel 생성 완료. 각 파일의 확인필요 시트를 검토한 뒤 마감해 주세요.`);
  }catch(e){files=[];write('생성 중단 · '+e.message);}finally{if(!disposed)lock(false);}
 };
 return {busy:()=>busy,canLeave:()=>!busy,dispose(){disposed=true;operation?.abort();prepared=[];files=[];}};
}
