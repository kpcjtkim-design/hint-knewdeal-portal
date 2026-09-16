import {PARTNER_HEADERS,collectRawExport} from './survey-export-core.mjs';

let xlsxPromise;
export function loadExportXlsx(){
 if(window.XLSX)return Promise.resolve(window.XLSX);
 if(xlsxPromise)return xlsxPromise;
 xlsxPromise=new Promise((resolve,reject)=>{
  let script=document.querySelector('script[data-hint-xlsx="1"]');
  const timer=setTimeout(()=>reject(Error('엑셀 도구를 불러오지 못했습니다. 다시 시도해 주세요.')),30000);
  const ready=()=>{clearTimeout(timer);window.XLSX?resolve(window.XLSX):reject(Error('엑셀 도구 초기화에 실패했습니다.'));};
  const failed=()=>{clearTimeout(timer);script?.remove();reject(Error('엑셀 도구를 불러오지 못했습니다.'));};
  if(!script){script=document.createElement('script');script.dataset.hintXlsx='1';script.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';script.onload=ready;script.onerror=failed;document.head.append(script);}
  else {script.addEventListener('load',ready,{once:true});script.addEventListener('error',failed,{once:true});}
 }).catch(e=>{xlsxPromise=null;throw e;});return xlsxPromise;
}

export function createExportWorkbook(XLSX,result){
 const workbook=XLSX.utils.book_new(),label=result.failed?'일부 수집 실패 · 수집내역 확인':'다운로드 시점 수집본';
 const tables=[
  ['뉴딜 통합 데이터',[
   ['협업사 제출용 통합 데이터'],['수집 기준',`${label} · ${result.startedAt} ~ ${result.finishedAt}`],
   ['안내','원본 척도·중복 응답 유지. 없는 문항은 공란. 모듈은 개별 강의 종료일 기준. 원본 전체 문항은 원본 응답 시트 참조.'],[],PARTNER_HEADERS,...result.partner]],
  ['원본 응답',[
   ['수집한 응답 원문'],['기준',label],['안내','통합 데이터 행 번호는 첫 응답을 1로 셉니다. 점수·주관식 원문을 보존하며 원본의 빈 응답은 생략합니다.'],[],
   ['통합 데이터 행','응답 원본','원본 탭','원본 행','분반 원문','응답 시각','문항 원문','응답 원문'],...result.original]],
  ['수집내역',result.audit]
 ];
 for(const [name,rows]of tables){
  if(rows.length>1048576||rows.some(row=>row.some(v=>typeof v==='string'&&v.length>32767)))throw Error('Excel의 행 또는 셀 길이 한도를 초과했습니다. 원문을 자르지 않고 중단했습니다. 선택 반으로 범위를 줄여 주세요.');
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols']=name==='뉴딜 통합 데이터'?PARTNER_HEADERS.map((_,i)=>({wch:i===0||i===27?3:[3,21,22,23,25,28,29,39].includes(i)?48:18})):name==='원본 응답'?[10,40,24,10,25,23,55,65].map(wch=>({wch})):[20,45,100,12,28].map(wch=>({wch}));
  if(name!=='수집내역')sheet['!autofilter']={ref:`${name==='뉴딜 통합 데이터'?'B':'A'}5:${name==='뉴딜 통합 데이터'?'AN':'H'}${Math.max(5,rows.length)}`};
  XLSX.utils.book_append_sheet(workbook,sheet,name);
 }
 return workbook;
}

// No Firestore import: download uses Google reads and an in-memory workbook only.
export function openRawExport(dialog,{reader,catalog,classes,selected,readSchedule,config,signal}){
 return new Promise(resolve=>{
  let controller=null,result=null,closed=false;
  const finish=()=>{if(closed)return;closed=true;controller?.abort();result=null;dialog.close();dialog.innerHTML='';dialog.removeEventListener('cancel',cancel);signal?.removeEventListener('abort',finish);resolve();};
  const cancel=e=>{e.preventDefault();finish();};
  dialog.innerHTML='<h3>최신 RAW 한판 다운로드</h3><p>Google 응답 원본을 지금 다시 읽습니다. 5점·10점 등 원래 척도와 주관식을 유지하고, 없는 문항은 빈칸으로 둡니다. 원본 제출 행은 중복을 포함해 보존합니다.</p><label>다운로드 범위<select id="rawScope"><option value="all">전체 반</option><option value="selected">현재 선택 반</option></select></label><p>사이트의 개별 강의 종료일 기준으로 연결합니다. 이름·이메일은 원본에 있을 때 포함됩니다. 수집에는 몇 분 걸릴 수 있습니다.</p><p id="rawProgress" role="status" aria-live="polite">다운로드를 실행할 때만 수집하며 원본 응답을 Firebase에 저장하지 않습니다.</p><button id="rawStart">최신 원본으로 다운로드</button><button id="rawSave" hidden>엑셀 다운로드</button><button id="rawClose">닫기</button>';
  const $=s=>dialog.querySelector(s),progress=$('#rawProgress'),start=$('#rawStart'),save=$('#rawSave'),scope=$('#rawScope');
  // The existing button CSS overrides the browser's default [hidden] style.
  const showSave=visible=>{save.hidden=!visible;save.style.display=visible?'inline-block':'none';};showSave(false);
  $('#rawClose').onclick=finish;dialog.addEventListener('cancel',cancel);signal?.addEventListener('abort',finish,{once:true});if(signal?.aborted){finish();return;}dialog.showModal();
  start.onclick=async()=>{
   controller=new AbortController();result=null;start.disabled=true;scope.disabled=true;showSave(false);$('#rawClose').textContent='수집 취소';
   try{
    result=await collectRawExport({reader,catalog,classes:scope.value==='all'?classes:classes.filter(c=>String(c.id)===String(selected)),readSchedule,config,signal:controller.signal,onProgress:text=>{if(!closed)progress.textContent=text;}});
    if(closed)return;
    progress.textContent=`응답 ${result.partner.length}행 수집 · 강의 연결 확인 ${result.uncertain}행 · 수집 실패 ${result.failed}건. ${result.failed?'일부 원본을 가져오지 못했습니다. 부분 자료에는 실패 내역이 함께 들어갑니다.':'원본 문항과 수집내역을 함께 내려받습니다.'}`;
    save.textContent=result.failed?'부분 자료 다운로드':'엑셀 다운로드';showSave(true);
    if(!result.failed)await save.onclick();
   }catch(e){if(!closed)progress.textContent='수집 실패 · '+e.message;}
   finally{if(!closed){controller=null;start.disabled=false;scope.disabled=false;$('#rawClose').textContent='닫기';}}
  };
  save.onclick=async()=>{
   if(!result||closed)return;save.disabled=true;start.disabled=true;scope.disabled=true;
   try{const XLSX=await loadExportXlsx();if(closed)return;const workbook=createExportWorkbook(XLSX,result),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());XLSX.writeFile(workbook,`HINT_협업사양식_RAW_${date}${result.failed?'_부분자료':''}.xlsx`,{compression:true});progress.textContent=`응답 ${result.partner.length}행 다운로드 완료${result.failed?' · 일부 수집 실패: 수집내역 확인':''}. Firebase에 원본을 저장하지 않았습니다.`;}
   catch(e){if(!closed)progress.textContent='다운로드 실패 · '+e.message;}
   finally{if(!closed){save.disabled=false;start.disabled=false;scope.disabled=false;}}
  };
 });
}
