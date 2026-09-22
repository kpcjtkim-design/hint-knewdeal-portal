import {collectSurveyRaw} from './survey-raw-core.mjs';
import {weekRange,rawWorkbook} from './raw-download-core.mjs';
import {loadExportXlsx} from './survey-export.mjs';
import {koreaToday} from './attendance-beta-core.mjs';
import {esc} from './metrics-ui.mjs';
export function openSurveyRaw(dialog,options){
 return new Promise(resolve=>{
  let closed=false,controller=null,result=null,label='';
  const finish=()=>{if(closed)return;closed=true;controller?.abort();result=null;dialog.close();dialog.innerHTML='';dialog.removeEventListener('cancel',cancel);options.signal?.removeEventListener('abort',finish);resolve();};
  const cancel=e=>{e.preventDefault();finish();};
  dialog.innerHTML=`<h3>만족도 RAW 다운로드</h3><p>선택 기간에 설문을 실시한 반의 응답을 모읍니다. 같은 강의는 이어 붙이고, 설문마다 원래 문항과 점수·공란·중복 응답을 유지합니다. 늦게 제출한 응답도 포함합니다.</p><p>전화번호·이메일은 파일에서 제외합니다. 동명이인은 끝 4자리로 내부 대조한 이름만 표시합니다.</p><label>반<select id="srClass"><option value="all">전체 반</option>${options.classes.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(options.selected)?'selected':''}>${esc(c.id)}반</option>`).join('')}</select></label><label>실시 기간<select id="srPeriod"><option value="all">전체 주차</option><option value="week">주차 선택</option><option value="date">날짜 선택</option></select></label><div id="srWeeks" hidden><label>시작 주차<input id="srFirst" type="number" min="1" max="13" value="1"></label><label>종료 주차<input id="srLast" type="number" min="1" max="13" value="1"></label><p>7/27~8/2 = 1주차 · 연속 여러 주 선택 가능</p></div><div id="srDates" hidden><label>시작일<input id="srFrom" type="date" value="2026-07-27"></label><label>종료일<input id="srTo" type="date" value="${koreaToday()}"></label></div><p id="srStatus" role="status">포털에 지정한 설문일이 있으면 그 날짜, 없으면 강의 종료일 기준입니다. 필요한 응답 원본만 순서대로 읽으며 Firebase에 원본을 저장하지 않습니다.</p><button id="srStart" class="primary">RAW 다운로드</button><button id="srSave" hidden>수집 자료 다운로드</button><button id="srClose">닫기</button>`;
  const $=s=>dialog.querySelector(s),status=$('#srStatus'),lock=b=>dialog.querySelectorAll('input,select,#srStart,#srSave').forEach(el=>el.disabled=b);
  $('#srPeriod').onchange=()=>{$('#srWeeks').hidden=$('#srPeriod').value!=='week';$('#srDates').hidden=$('#srPeriod').value!=='date';};
  const save=async()=>{const XLSX=await loadExportXlsx();if(closed)return;XLSX.writeFile(rawWorkbook(XLSX,result.tables),`HINT_만족도_RAW_${label}${result.failed?'_부분자료':''}.xlsx`,{compression:true});status.textContent=`${result.count}개 응답 · ${result.sourceCount}개 원본 다운로드 완료. 연락처는 제외했습니다.`;};
  $('#srSave').onclick=async()=>{lock(true);try{await save();}catch(e){status.textContent=e.message;}finally{if(!closed)lock(false);}};
  $('#srStart').onclick=async()=>{controller=new AbortController();lock(true);result=null;$('#srSave').hidden=true;$('#srClose').textContent='수집 취소';try{
   let from='2026-07-27',to=koreaToday();const mode=$('#srPeriod').value,cid=$('#srClass').value;
   if(mode==='week')({from,to}=weekRange(Number($('#srFirst').value),Number($('#srLast').value)));
   if(mode==='date'){from=$('#srFrom').value;to=$('#srTo').value;}
   if(!from||!to||from>to)throw Error('기간을 확인해 주세요.');label=`${from}_${to}_${cid==='all'?'전체반':cid+'반'}`;
   result=await collectSurveyRaw({...options,classes:cid==='all'?options.classes:options.classes.filter(c=>String(c.id)===cid),from,to,signal:controller.signal,onProgress:text=>{if(!closed)status.textContent=text;}});
   controller.signal.throwIfAborted();if(closed)return;
   $('#srSave').hidden=false;
   if(result.failed)status.textContent=`${result.failed}건 확인 필요. 수집 자료 다운로드를 누르면 실패 내역을 포함한 부분 자료를 받습니다.`;
   else if(!result.count)status.textContent='선택한 실시 기간·반에 해당하는 응답이 없습니다. 수집내역을 다운로드해 확인할 수 있습니다.';
   else await save();
  }catch(e){if(!closed)status.textContent='다운로드 실패 · '+e.message;}finally{if(!closed){lock(false);$('#srClose').textContent='닫기';}}};
  $('#srClose').onclick=finish;dialog.addEventListener('cancel',cancel);options.signal?.addEventListener('abort',finish,{once:true});if(options.signal?.aborted){finish();return;}dialog.showModal();
 });
}
