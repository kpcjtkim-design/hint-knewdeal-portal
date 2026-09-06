from pathlib import Path

p=Path('attendance-overview.js')
s=p.read_text(encoding='utf-8')

old='<button id="reload" class="btn soft">↻ 다시 읽기</button><span class="autosave-notice">'
new='<button id="reload" class="btn soft">↻ 다시 읽기</button><button id="excelExport" class="btn dark">⇩ 엑셀 다운로드</button><span class="autosave-notice">'
if old not in s:
    raise SystemExit('toolbar anchor missing')
s=s.replace(old,new,1)

old="const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState');"
new="const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),excelExport=$('#excelExport'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState');"
if old not in s:
    raise SystemExit('selector anchor missing')
s=s.replace(old,new,1)

anchor='  async function loadSelectedDate(){showErr(\'\');const label=dateSel.value,d=dates.find(x=>x.label===label);if(!d)return;currentIso=d.iso;topState.textContent=`${currentClass}반 · ${label} 불러오는 중…`;await loadMemos(currentClass,currentIso);renderRawReason(label);renderRows(label);topState.textContent=`${currentClass}반 · ${label} · ${students.length}명`}\n'
if anchor not in s:
    raise SystemExit('loadSelectedDate anchor missing')

insert=r'''  async function ensureXlsxLib(){
    if(window.XLSX)return window.XLSX;
    await new Promise((resolve,reject)=>{
      const found=document.querySelector('script[data-hint-xlsx="1"]');
      if(found){
        if(window.XLSX){resolve();return}
        const timer=setTimeout(()=>reject(new Error('엑셀 모듈을 불러오지 못했습니다.')),12000);
        found.addEventListener('load',()=>{clearTimeout(timer);resolve()},{once:true});
        found.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('엑셀 모듈을 불러오지 못했습니다.'))},{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      script.async=true;script.dataset.hintXlsx='1';
      const timer=setTimeout(()=>reject(new Error('엑셀 모듈 로딩 시간이 초과되었습니다.')),12000);
      script.onload=()=>{clearTimeout(timer);resolve()};
      script.onerror=()=>{clearTimeout(timer);reject(new Error('엑셀 모듈을 불러오지 못했습니다.'))};
      document.head.appendChild(script);
    });
    if(!window.XLSX)throw new Error('엑셀 모듈 초기화에 실패했습니다.');
    return window.XLSX;
  }
  function memoValueNow(key,category){
    const el=root.querySelector(`.memo[data-key="${CSS.escape(key)}"][data-category="${CSS.escape(category)}"]`);
    if(el)return String(el.value||'');
    return String(normalizeMemoBundle(memos[key])?.[category]||'');
  }
  function exportedAt(){
    try{return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())}
    catch{return new Date().toISOString()}
  }
  async function exportCurrentExcel(){
    const label=dateSel.value,d=dates.find(x=>x.label===label);if(!d)throw new Error('선택한 교육일자를 찾지 못했습니다.');
    const before=excelExport.textContent;excelExport.disabled=true;excelExport.textContent='엑셀 생성 중…';
    try{
      const XLSX=await ensureXlsxLib(),course=String(classes.find(c=>String(c.id)===String(currentClass))?.course||''),reasonText=String(reasonCells[label]??''),roster=students.map(x=>x.name);
      const aoa=[
        ['출결대조'],
        ['반',`${currentClass}반`,'과정',course],
        ['교육일자',currentIso||label,'내보낸 시각',exportedAt()],
        [],
        ['가-3 원문'],
        [reasonText],
        [],
        ['수기출석 관리자메모'],
        [String(manualIssueMemo.value||'')],
        [],
        ['이름','출석현황','사유','서류제출','체크히어 관련 메모','서류제출 관련 메모','수기출석 관련 메모']
      ];
      for(const st of students){
        const status=String(st.all[d.idx]||'').trim()||'미입력',reason=reasonFor(st.name,reasonText,roster,status),e=evidenceFor(st,d,status,attendanceBackgrounds),key=keyFor(st);
        aoa.push([st.name,status,reason||'-',e.label,memoValueNow(key,'checkhere'),memoValueNow(key,'documents'),memoValueNow(key,'manual')]);
      }
      const ws=XLSX.utils.aoa_to_sheet(aoa),wb=XLSX.utils.book_new();
      ws['!cols']=[{wch:16},{wch:14},{wch:28},{wch:15},{wch:34},{wch:34},{wch:34}];
      ws['!merges']=[
        {s:{r:0,c:0},e:{r:0,c:6}},
        {s:{r:4,c:0},e:{r:4,c:6}},
        {s:{r:5,c:0},e:{r:5,c:6}},
        {s:{r:7,c:0},e:{r:7,c:6}},
        {s:{r:8,c:0},e:{r:8,c:6}}
      ];
      ws['!rows']=[];ws['!rows'][0]={hpt:24};ws['!rows'][5]={hpt:90};ws['!rows'][8]={hpt:72};
      XLSX.utils.book_append_sheet(wb,ws,'출결대조');
      const safeDate=String(currentIso||label).replace(/[^0-9A-Za-z가-힣_-]+/g,'-');
      XLSX.writeFile(wb,`${currentClass}반_${safeDate}_출결대조.xlsx`,{compression:true});
    }finally{excelExport.disabled=false;excelExport.textContent=before}
  }
'''
s=s.replace(anchor,insert+anchor,1)

old="  $('#reload').onclick=()=>loadClass(currentClass,dateSel.value,true);\n  manualIssueMemo.oninput="
new="  $('#reload').onclick=()=>loadClass(currentClass,dateSel.value,true);\n  excelExport.onclick=()=>exportCurrentExcel().catch(e=>showErr(e));\n  manualIssueMemo.oninput="
if old not in s:
    raise SystemExit('event anchor missing')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')

p=Path('index.html')
s=p.read_text(encoding='utf-8')
old='attendance-overview.js?v=20260906-10'
new='attendance-overview.js?v=20260906-11'
if old not in s:
    raise SystemExit('index module version anchor missing')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
