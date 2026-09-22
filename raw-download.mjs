import {weekRange,attendanceTables,surveyBlock,rawWorkbook} from './raw-download-core.mjs';
import {loadExportXlsx} from './survey-export.mjs';
import {rawSourceKey} from './survey-export-core.mjs';
import {readJson,pauseRead} from './attendance-io.mjs';
import {koreaToday} from './attendance-beta-core.mjs';
import {esc} from './metrics-ui.mjs';
import {inspectAttendanceExport,attendanceDownloadPreflight} from './download-preflight-core.mjs';
import {confirmDownloadPreflight} from './download-preflight-ui.mjs';

// Explicit downloads only: sequential reads, no Firestore writes or background polling.
export function openRawDownload(dialog,{kind,classes,selected,user,db,reader,catalog,signal}){
 return new Promise(resolve=>{
  const survey=kind==='survey';let closed=false,controller=null,tables=null,failed=0,preflight=null;
  const finish=()=>{if(closed)return;closed=true;controller?.abort();tables=null;dialog.close();dialog.innerHTML='';dialog.removeEventListener('cancel',cancel);signal?.removeEventListener('abort',finish);resolve();};
  const cancel=e=>{e.preventDefault();finish();};
  dialog.innerHTML=`<h3>${survey?'만족도 원본 이어붙이기':'출결 RAW 다운로드'}</h3><p>${survey?'설문별 원래 문항 아래에 응답을 그대로 이어 붙입니다. 점수·공란·중복 제출도 원문대로 유지합니다. 주차는 7/27이 1주차이며, 한국시간 응답 제출일 기준입니다.':'포털 DB의 인정지각·인정조퇴·인정외출 등 저장 구분을 적용합니다. 시트 원본 비교표, 가-3 원문, DB 출결 기록(서류 상태·메모·후속조치·체크히어 저장본)을 함께 내려받습니다. 변경요청 이력은 제외합니다. DB 기준이 현재 시트와 다르면 시트값을 사용하고 확인 필요로 표시합니다.'}</p><label>반 <select id="dlClass"><option value="all">전체 반</option>${classes.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.id)}반</option>`).join('')}</select></label>${survey?'<label>주차 <select id="dlPeriod"><option value="all">전체 주차</option><option value="range">주차 선택</option></select></label><span id="dlWeeks" style="display:none"><label>시작 주차 <input id="dlFirst" type="number" min="1" max="104" value="1"></label><label>종료 주차 <input id="dlLast" type="number" min="1" max="104" value="1"></label></span>':`<label>시작일 <input id="dlFrom" type="date" value="2026-07-27"></label><label>종료일 <input id="dlTo" type="date" value="${koreaToday()}"></label>`}<p id="dlStatus" role="status">다운로드할 때만 순서대로 읽습니다. Firebase에 원본을 추가 저장하지 않습니다.</p><button id="dlStart">원본 수집 · 다운로드</button><button id="dlSave" style="display:none">수집 자료 다운로드</button><button id="dlClose">닫기</button>`;
  const $=s=>dialog.querySelector(s),status=$('#dlStatus');
  if(survey)$('#dlPeriod').onchange=()=>$('#dlWeeks').style.display=$('#dlPeriod').value==='all'?'none':'inline';
  const lock=value=>dialog.querySelectorAll('input,select,#dlStart,#dlSave').forEach(e=>e.disabled=value);
  $('#dlClose').onclick=finish;dialog.addEventListener('cancel',cancel);signal?.addEventListener('abort',finish,{once:true});if(signal?.aborted){finish();return;}dialog.showModal();
  const save=async()=>{lock(true);try{if(preflight&&!(await confirmDownloadPreflight(preflight,{signal:controller?.signal}))){if(!closed)status.textContent='다운로드를 보류했습니다. 확인 후 수집 자료 다운로드를 누르면 다시 받을 수 있습니다.';return;}const XLSX=await loadExportXlsx();if(closed)return;XLSX.writeFile(rawWorkbook(XLSX,tables),`HINT_${survey?'만족도_원본한판':'출결_RAW'}_${koreaToday()}${failed?'_부분자료':''}.xlsx`,{compression:true});status.textContent='다운로드 완료. 수집내역에서 기간·실패·확인 필요 내역을 확인할 수 있습니다.';}catch(e){if(!closed)status.textContent=e.message;}finally{if(!closed)lock(false);}};
  $('#dlSave').onclick=save;
  $('#dlStart').onclick=async()=>{
   controller=new AbortController();const abort=controller.signal;tables=null;failed=0;preflight=null;lock(true);$('#dlSave').style.display='none';$('#dlClose').textContent='수집 취소';
   try{
    const classId=$('#dlClass').value;let from='',to='';
    if(survey){if($('#dlPeriod').value==='range')({from,to}=weekRange(Number($('#dlFirst').value),Number($('#dlLast').value)));}
    else {from=$('#dlFrom').value;to=$('#dlTo').value;if(!from||!to||from>to)throw Error('시작일과 종료일을 확인해 주세요.');}
    const audit=[['수집 기준','한국시간 응답 제출일 / 출결 교육일'],['기간',from||'전체',to||'전체'],['반',classId],['수집 시작',new Date().toISOString()],[],['원본','결과','상세']];tables=[];
    if(survey){
     const combined=[['만족도 원본 응답 · 설문별 문항 유지'],['제출 기간',from||'전체',to||'전체'],[]],review=[['설문','원본 행','확인 사유','이후 열은 해당 원본 응답 순서']],seen=new Set();let count=0;
     const sources=catalog.responseSources||[];
     if(!sources.length)throw Error('등록된 응답 원본이 없습니다.');
     for(let i=0;i<sources.length;i++){
      abort.throwIfAborted();const source=sources[i],key=rawSourceKey(source.sheetUrl);if(seen.has(key))continue;seen.add(key);status.textContent=`설문 ${i+1}/${sources.length} · ${source.title} 읽는 중…`;
      try{const raw=await reader.raw(source.sheetUrl,{signal:abort});abort.throwIfAborted();const block=surveyBlock(raw,{title:source.title,from,to,classId});for(const row of block.rows)combined.push(row);for(const row of block.review)review.push(row);count+=block.count;audit.push([source.title,'수집 완료',`포함 ${block.count} · 범위 밖 ${block.outside} · 확인 필요 ${block.review.length}`,source.sheetUrl,raw.fetchedAt]);}
      catch(e){abort.throwIfAborted();failed++;audit.push([source.title,'수집 실패',e.message]);}
     }
     tables.push(['설문별 원본 응답',combined],['범위 확인 필요',review]);audit.push(['합계',count+'응답',`확인 필요 ${review.length-1}행`]);
    }else{
     const scope=classId==='all'?classes:classes.filter(c=>String(c.id)===classId),checks=[],failures=[];
     for(let i=0;i<scope.length;i++){
      abort.throwIfAborted();const c=scope[i];status.textContent=`${c.id}반 원본 읽는 중 · ${i+1}/${scope.length}`;
      try{let data;for(let attempt=0;attempt<3;attempt++){try{data=await readJson('/api/attendance-reader',{classId:String(c.id),idToken:await user.getIdToken(),allowCache:true},{signal:abort});break;}catch(e){abort.throwIfAborted();if(e.retryable===false||attempt===2)throw e;await pauseRead(5000*(attempt+1),abort);}}abort.throwIfAborted();const {readExportAttendance}=await import('./raw-attendance-store.mjs');const stored=await readExportAttendance(db,c.id,from,to,abort);abort.throwIfAborted();const parts=attendanceTables(data,c.id,from,to,stored);tables.push(...parts);checks.push(inspectAttendanceExport({classId:c.id,data,stored,from,to,details:parts[1][1]}));audit.push([c.id+'반','수집 완료','포털 DB 저장 구분 우선 · 시트 원본 비교표 포함']);}
      catch(e){abort.throwIfAborted();failed++;failures.push({classId:c.id,message:e.message});audit.push([c.id+'반','수집 실패',e.message]);}
      if(i<scope.length-1)await pauseRead(2500,abort);
     }
     preflight=attendanceDownloadPreflight(checks,{failures,label:`${from} ~ ${to} · ${scope.map(c=>c.id+'반').join(', ')}`});
    }
    abort.throwIfAborted();audit.push(['수집 종료',new Date().toISOString()],['실패',failed]);tables.push(['수집내역',audit]);$('#dlSave').style.display='inline-block';
    if(failed)status.textContent=`${failed}개 원본 수집 실패. 수집 자료 다운로드를 누르면 실패 내역이 포함된 부분 자료를 내려받습니다.`;else await save();
   }catch(e){tables=null;if(!closed)status.textContent='수집 실패 · '+e.message;}
   finally{if(!closed){lock(false);$('#dlClose').textContent='닫기';}}
  };
 });
}
