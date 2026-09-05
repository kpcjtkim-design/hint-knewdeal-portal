from pathlib import Path
import re

# attendance-overview.js
p = Path('attendance-overview.js')
s = p.read_text(encoding='utf-8')

pat = re.compile(r"function colorState\(bg\)\{.*?\n\}\nfunction evidenceFor\(student,dateObj,status,backgrounds\)\{.*?\n\}", re.S)
new = r'''function overviewColorState(bg){
  let x=String(bg||'').trim().toLowerCase();
  if(/^#[0-9a-f]{3}$/.test(x))x='#'+x.slice(1).split('').map(c=>c+c).join('');
  if(!/^#[0-9a-f]{6}$/.test(x))return'미제출';
  const r=parseInt(x.slice(1,3),16),g=parseInt(x.slice(3,5),16),b=parseInt(x.slice(5,7),16);
  if(r>=242&&g>=242&&b>=242)return'미제출';
  if(r>=180&&g>=135&&b<=190&&Math.abs(r-g)<=110&&g>b+20)return'확인';
  if(r>=175&&g<=185&&b<=185&&r>g+25&&r>b+25)return'보완필요';
  return'미제출';
}
function sheetEvidenceState(student,dateObj,backgrounds,fallback='미제출'){
  if(!student||!dateObj||!Array.isArray(backgrounds)||!backgrounds.length)return fallback;
  const bg=String(backgrounds?.[Number(student.rowIndex)+1]?.[Number(dateObj.idx)+4]||'');
  return overviewColorState(bg);
}
function evidenceFor(student,dateObj,status,backgrounds){
  const raw=String(status||'').trim();
  const x=raw==='인정결석'?'중복':raw;
  const relevant=x==='인정출석'||['결석','지각','조퇴','외출','중복'].includes(x);
  if(!relevant)return{label:'-',cls:'none'};
  const state=sheetEvidenceState(student,dateObj,backgrounds,'미제출');
  if(x==='인정출석'){
    if(state==='확인')return{label:'확인',cls:'confirmed'};
    if(state==='보완필요')return{label:'보완필요',cls:'rejected'};
    return{label:'미제출',cls:'missing'};
  }
  if(state==='보완필요')return{label:'제출 필요',cls:'required'};
  return{label:'-',cls:'none'};
}'''
s, n = pat.subn(new, s, count=1)
if n != 1:
    raise SystemExit('color/evidence block not found')

old = """  function parseReader(out){
    const a=out.attendance||[],h=a[0]||[];dates=h.slice(4).map((x,i)=>({label:normDate(x),idx:i,iso:dateIso(x)})).filter(x=>x.label&&x.iso);students=a.slice(1).map((r,rowIndex)=>({rowIndex,name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);const g=out.reasons||[],rh=(g[0]||[]).slice(4),rr=(g[1]||[]).slice(4);reasonCells={};rh.forEach((d,i)=>reasonCells[normDate(d)]=rr[i]||'');
  }"""
new = """  function parseReader(out){
    const a=out.attendance||[],h=a[0]||[];
    attendanceBackgrounds=Array.isArray(out.attendanceBackgrounds)?out.attendanceBackgrounds:(Array.isArray(out.backgrounds)?out.backgrounds:[]);
    dates=h.slice(4).map((x,i)=>({label:normDate(x),idx:i,iso:dateIso(x)})).filter(x=>x.label&&x.iso);
    students=a.slice(1).map((r,rowIndex)=>({rowIndex,name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);
    const g=out.reasons||[],rh=(g[0]||[]).slice(4),rr=(g[1]||[]).slice(4);reasonCells={};rh.forEach((d,i)=>reasonCells[normDate(d)]=rr[i]||'');
  }"""
if old not in s:
    raise SystemExit('parseReader block not found')
s = s.replace(old, new, 1)

pat = re.compile(r"  async function loadClass\(cid,keepDate='',forceColors=false\)\{.*?\n  \}\n  classSel\.onchange", re.S)
new = """  async function loadClass(cid,keepDate='',forceColors=false){
    showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class=\"empty\">Google Sheet를 읽는 중…</div>';
    const colorClass=currentClass;
    try{
      const out=await getReader(currentClass);parseReader(out);
      dateSel.innerHTML=dates.map(d=>`<option value=\"${esc(d.label)}\">${esc(d.label)}</option>`).join('');
      const preferred=dates.find(x=>x.label===keepDate)?.label||dates.at(-1)?.label||dates[0]?.label||'';dateSel.value=preferred;
      await loadSelectedDate();
      if(Array.isArray(attendanceBackgrounds)&&attendanceBackgrounds.length){
        colorCache.set(colorClass,attendanceBackgrounds);
        try{sessionStorage.setItem(`attendanceOverviewColors_${colorClass}`,JSON.stringify({at:Date.now(),data:attendanceBackgrounds}))}catch{}
        renderRows(dateSel.value);
        topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 출결자동 색상 반영`;
      }else{
        getColorsCached(colorClass,forceColors).then(bg=>{if(currentClass!==colorClass)return;attendanceBackgrounds=bg;renderRows(dateSel.value);topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 출결자동 색상 반영`}).catch(e=>{console.warn('attendance colors failed',e);if(currentClass===colorClass){renderRows(dateSel.value);topState.textContent=`${currentClass}반 · ${dateSel.value} · ${students.length}명 · 색상 조회 실패(미제출 기준)`}})
      }
    }catch(e){showErr(e);rows.innerHTML='<div class=\"empty\">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}
  }
  classSel.onchange"""
s, n = pat.subn(new, s, count=1)
if n != 1:
    raise SystemExit('loadClass block not found')
p.write_text(s, encoding='utf-8')

# api/admin-drive-review.js
p = Path('api/admin-drive-review.js')
s = p.read_text(encoding='utf-8')
start = s.index('async function monitor(root,date){')
end = s.index('\nexport default async function handler', start)
monitor = r'''function compactDate(date){return String(date||'').replace(/\D/g,'').slice(-4)}
function weekNoFor(date){
  const d=new Date(`${date}T00:00:00Z`),start=new Date('2026-07-27T00:00:00Z');
  if(Number.isNaN(d.getTime()))return null;
  return Math.floor((d-start)/604800000)+1;
}
async function monitorRequest(folderId,dateValue){
  if(!folderId)return{};
  const u=new URL(MONITOR);u.searchParams.set('folderId',folderId);u.searchParams.set('date',dateValue);
  try{
    const r=await fetch(u,{method:'GET',redirect:'follow',headers:{'User-Agent':'HINT-Admin-ReadOnly-Review/1.1'}});
    if(r.ok)return await r.json();
  }catch{}
  return{};
}
function resolvedFolder(d){
  const df=d?.dateFolder||null;
  const id=d?.dateFolderId||(df&&typeof df==='object'&&(df.id||df.folderId))||'';
  const url=d?.dateFolderUrl||(df&&typeof df==='object'&&(df.url||df.webViewLink))||(id?`https://drive.google.com/drive/folders/${id}`:'');
  return{id:String(id||''),url:String(url||''),df};
}
function filesFrom(d,df){
  return Array.isArray(d?.files)?d.files:
    (df&&typeof df==='object'&&Array.isArray(df.files)?df.files:
    (Array.isArray(d?.dateFiles)?d.dateFiles:
    (Array.isArray(d?.folderFiles)?d.folderFiles:[])));
}
async function monitor(root,date){
  const rootId=folderId(root);if(!rootId)throw new Error('FOLDER_NOT_SET');
  const mmdd=compactDate(date),week=weekNoFor(date);
  const primary=await monitorRequest(rootId,date);
  const candidates=[primary];
  if(mmdd)candidates.push(await monitorRequest(rootId,mmdd));
  const primaryWeekId=String(primary?.weekFolderId||folderId(primary?.weekFolderUrl||'')||'');
  if(primaryWeekId){
    if(mmdd)candidates.push(await monitorRequest(primaryWeekId,mmdd));
    candidates.push(await monitorRequest(primaryWeekId,date));
  }
  let chosen=primary,folder=resolvedFolder(primary);
  for(const c of candidates){const f=resolvedFolder(c);if(f.id){chosen=c;folder=f;break}}
  const weekFolderId=String(chosen?.weekFolderId||primary?.weekFolderId||primaryWeekId||'');
  const weekFolderUrl=String(chosen?.weekFolderUrl||primary?.weekFolderUrl||(weekFolderId?`https://drive.google.com/drive/folders/${weekFolderId}`:''));
  const rawFiles=filesFrom(chosen,folder.df);
  const allFiles=rawFiles.map(safeFile).filter(Boolean);
  const files=allFiles.filter(isPreviewable).sort((a,b)=>uploadedAt(b)-uploadedAt(a));
  return{
    fileCount:files.length,
    sourceFileCount:allFiles.length||(Number.isFinite(Number(chosen?.fileCount))?Number(chosen.fileCount):0),
    files,
    latestPreviewFile:files[0]||null,
    dateFolderId:folder.id,
    dateFolderUrl:folder.url,
    folderId:folder.id||weekFolderId||rootId,
    folderUrl:folder.url||weekFolderUrl||root,
    exactDateFolder:Boolean(folder.id),
    week:chosen?.week||primary?.week||week||null,
    expectedWeek:week,
    expectedDateFolder:mmdd,
    weekFolderId,
    weekFolderUrl,
    status:chosen?.status||primary?.status||'',
    completed:chosen?.completed===true||primary?.completed===true,
    monitorOk:chosen?.ok===true||primary?.ok===true
  };
}'''
s = s[:start] + monitor + s[end:]
p.write_text(s, encoding='utf-8')

# cache bust
p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = re.sub(r'/attendance-overview\.js\?v=[^`\'\"]+', '/attendance-overview.js?v=20260906-5', s, count=1)
p.write_text(s, encoding='utf-8')

print('patched nested WEEK/MMDD preview + auto verification colors')
