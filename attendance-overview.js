import {doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const STYLE=`
:host{font-family:Pretendard,"Noto Sans KR","Malgun Gothic",system-ui,sans-serif;color:#0f172a}*{box-sizing:border-box}button,select,textarea,input{font:inherit}.wrap{width:100%;max-width:1760px;margin:0 auto}.card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;box-shadow:0 4px 16px rgba(15,23,42,.035)}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:14px 16px;margin-bottom:10px}.field{display:flex;flex-direction:column;gap:5px}.field label{font-size:11px;color:#64748b;font-weight:900}.field select,.field input{border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:9px 11px;min-width:220px}.btn{border:0;border-radius:10px;padding:9px 12px;font-weight:900;cursor:pointer}.btn.soft{background:#eef2ff;color:#3730a3}.btn.dark{background:#0f172a;color:#fff}.btn.ghost{background:#f1f5f9;color:#334155}.btn.folder{width:100%;border:1px solid #c7d2fe;background:#fff;color:#1d4ed8;padding:10px 11px}.btn.folder:hover:not(:disabled){background:#eff6ff}.btn:disabled{opacity:.5;cursor:not-allowed}.spacer{flex:1}.state{font-size:11px;color:#64748b}.autosave-notice{font-size:12px;font-weight:900;color:#dc2626;align-self:center;padding:7px 4px;white-space:nowrap}.hint{font-size:11px;color:#64748b;padding:0 2px 9px}.workspace{display:grid;grid-template-columns:clamp(310px,21vw,370px) minmax(0,1fr);gap:10px;align-items:start}.left-stack{display:grid;gap:10px;min-width:0}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.section-head h3{margin:0;font-size:14px}.section-head p{margin:3px 0 0;font-size:10px;line-height:1.4;color:#64748b}.raw-card,.manual-card{overflow:hidden}.raw-text{margin:0;padding:13px 14px;min-height:330px;max-height:410px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;line-height:1.58;background:#fff;color:#1e293b}.raw-empty{color:#94a3b8}.manual-body{padding:12px 13px}.manual-issue-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;font-size:11px}.manual-issue-head strong{font-size:13px}.manual-issue textarea{width:100%;min-height:122px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:11px;line-height:1.5;background:#fff}.manual-issue-state{font-size:9px;color:#64748b;white-space:nowrap}.folder-area{margin-top:11px;padding-top:11px;border-top:1px solid #e2e8f0}.folder-title{display:flex;align-items:center;gap:7px;margin-bottom:8px;font-size:12px;font-weight:900}.folder-note{margin-left:auto;font-size:9px;color:#94a3b8;font-weight:700}.folder-buttons{display:grid;gap:7px}.data-panel{overflow:hidden;min-width:0}.data-title{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.data-title strong{font-size:13px}.data-title span{font-size:10px;color:#64748b}.table-scroll{overflow:auto}.table-head,.student-row{display:grid;grid-template-columns:82px 88px minmax(125px,.78fr) 94px repeat(3,minmax(165px,1fr));min-width:1110px}.table-head{background:#f8fafc;border-bottom:1px solid #dbe3ee}.table-head>div{padding:10px 9px;font-size:10px;font-weight:900;color:#334155;border-right:1px solid #e2e8f0}.table-head>div:last-child{border-right:0}.rows{max-height:790px;overflow-y:auto;overflow-x:hidden}.student-row{border-bottom:1px solid #e2e8f0;min-height:80px;background:#fff}.student-row:last-child{border-bottom:0}.cell{padding:8px 9px;border-right:1px solid #e2e8f0;display:flex;align-items:center;min-width:0}.cell:last-child{border-right:0}.name{font-weight:900;font-size:12px}.center{justify-content:center}.status{display:inline-flex;width:max-content;padding:5px 8px;border-radius:999px;background:#f1f5f9;font-size:10px;font-weight:900;white-space:nowrap}.status.present{background:#f1f5f9;color:#334155}.status.absent{background:#fee2e2;color:#991b1b}.status.recognized{background:#dbeafe;color:#1d4ed8}.status.special{background:#fef3c7;color:#92400e}.reason{font-size:11px;line-height:1.45;color:#475569;white-space:pre-wrap;word-break:break-word}.reason.none{color:#94a3b8}.evidence{display:inline-flex;width:max-content;max-width:100%;padding:5px 7px;border-radius:999px;font-size:9px;font-weight:900;white-space:nowrap}.evidence.confirmed{background:#dcfce7;color:#166534}.evidence.rejected{background:#fee2e2;color:#991b1b}.evidence.missing{background:#fee2e2;color:#b91c1c}.evidence.required{background:#fee2e2;color:#b91c1c}.evidence.none{background:#f1f5f9;color:#64748b}.memo-cell{display:block;padding:7px 8px}.memo{width:100%;min-height:54px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:7px 8px;font-size:10px;line-height:1.4;background:#fff}.memo:focus{outline:2px solid #bfdbfe;border-color:#60a5fa}.memo-state{display:block;height:12px;margin-top:2px;text-align:right;font-size:8px;color:#64748b;font-weight:700}.empty{padding:40px;text-align:center;color:#64748b}.error{padding:12px 14px;border-radius:11px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;margin-bottom:10px;font-size:11px;white-space:pre-wrap}@media(max-width:1450px){.workspace{grid-template-columns:330px minmax(0,1fr)}.table-head,.student-row{grid-template-columns:76px 82px minmax(115px,.7fr) 88px repeat(3,minmax(145px,1fr));min-width:1010px}.raw-text{min-height:300px;max-height:380px}}@media(max-width:1080px){.workspace{grid-template-columns:1fr}.left-stack{grid-template-columns:1fr 1fr}.raw-text{min-height:260px;max-height:330px}.data-panel{margin-top:0}}@media(max-width:760px){.left-stack{grid-template-columns:1fr}.field{width:100%}.field select{width:100%;min-width:0}.autosave-notice{white-space:normal}.workspace{display:block}.data-panel{margin-top:10px}}
`;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pad=n=>String(n).padStart(2,'0');
function dateIso(label){
  const s=String(label||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=s.match(/(?:^|\D)(\d{1,2})\s*[\/\.\-]\s*(\d{1,2})(?:\D|$)/);
  return m?`2026-${pad(m[1])}-${pad(m[2])}`:'';
}
function normDate(v){return String(v||'').trim().replace(/\s+/g,' ')}
function normReasonText(v){return String(v||'').replace(/\r/g,'\n').replace(/\n{2,}/g,'\n').trim()}
function cleanReason(v,status=''){
  let s=String(v||'').trim();
  s=s.replace(/^\s*(?:님)?\s*[-_:：=→>\/|,，]+\s*/,'').replace(/^\s*(?:사유|이유)\s*[-_:：=]?\s*/,'').trim();
  s=s.replace(/^(?:출석|결석|지각|조퇴|외출|인정출석|중복)\s*[-_:：]?\s*/,'').trim();
  if(status)s=s.replace(new RegExp('^'+status.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[-_:：]?\\s*'),'').trim();
  return s.replace(/^[-_:：=→>\/|,，\s]+|[-_:：=→>\/|,，\s]+$/g,'').trim();
}
function reasonFor(name,text,roster,status=''){
  const src=normReasonText(text);if(!src||!name)return'';
  const lines=src.split('\n').map(x=>x.trim()).filter(Boolean),candidates=[];
  const otherNames=roster.filter(n=>n&&n!==name).sort((a,b)=>b.length-a.length);
  for(const line of lines){
    const p=line.indexOf(name);if(p<0)continue;
    let after=line.slice(p+name.length),cut=after.length;
    for(const n of otherNames){const i=after.indexOf(n);if(i>=0&&i<cut)cut=i}
    const direct=cleanReason(after.slice(0,cut),status);if(direct&&direct.length<=180)candidates.push({v:direct,s:7});
    const present=roster.filter(n=>n&&line.includes(n));
    if(present.length>=2){let lastEnd=-1;for(const n of present){const i=line.lastIndexOf(n);if(i>=0)lastEnd=Math.max(lastEnd,i+n.length)}if(lastEnd>=0){const shared=cleanReason(line.slice(lastEnd),status);if(shared&&shared.length<=180)candidates.push({v:shared,s:5})}}
  }
  try{
    const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp(safe+'\\s*(?:님)?\\s*[-_:：=→>\\/|]\\s*([^\\n]{1,180})','g');let m;
    while((m=rx.exec(src))){let raw=m[1];for(const n of otherNames){const i=raw.indexOf(n);if(i>=0)raw=raw.slice(0,i)}const v=cleanReason(raw,status);if(v)candidates.push({v,s:9})}
  }catch{}
  candidates.sort((a,b)=>b.s-a.s||a.v.length-b.v.length);return candidates[0]?.v||'';
}
function statusClass(s){const x=String(s||'');if(x==='출석')return'present';if(x==='결석')return'absent';if(x==='인정출석')return'recognized';if(['지각','조퇴','외출','중복'].includes(x))return'special';return''}
function memoId(classId,iso){return`attendanceOverviewMemo_${classId}_${iso}`}
function normalizeMemoBundle(v){if(v&&typeof v==='object'&&!Array.isArray(v))return{checkhere:String(v.checkhere||''),documents:String(v.documents||''),manual:String(v.manual||'')};if(typeof v==='string'&&v)return{checkhere:v,documents:'',manual:''};return{checkhere:'',documents:'',manual:''}}
function overviewColorState(bg){
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
}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok||d.ok===false)throw new Error(d.error||`${url} ${r.status}`);return d}

export async function mountAttendanceOverview(host,ctx){
  if(!host)throw new Error('출석부 한눈에 보기 영역을 찾지 못했습니다.');
  const {auth,db,user,classes=[],driveAccessToken='',getDriveAccessToken=null}=ctx||{};if(!auth||!db||!user)throw new Error('관리자 로그인 세션이 없습니다.');
  const outer=host.closest?.('.attendance-native-shell')||host.parentElement;
  if(outer){outer.style.overflow='visible';outer.style.width='min(1760px, calc(100vw - 32px))';outer.style.maxWidth='none';outer.style.marginLeft='50%';outer.style.transform='translateX(-50%)'}
  const root=host.shadowRoot||host.attachShadow({mode:'open'});
  root.innerHTML=`<style>${STYLE}</style><div class="wrap"><div id="err"></div><section class="card toolbar"><div class="field"><label>반</label><select id="classSel">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}반 · ${esc(c.course||'')}</option>`).join('')}</select></div><div class="field"><label>교육일자</label><select id="dateSel"><option>불러오는 중…</option></select></div><button id="reload" class="btn soft">↻ 다시 읽기</button><span class="autosave-notice">※ 모든 메모는 저장버튼 없이 자동저장됩니다.</span><div class="spacer"></div><span id="topState" class="state">준비 중…</span></section><div class="hint">원본 Google Sheet와 Google Drive는 읽기만 합니다. 좌측 가-3는 선택 날짜의 원문 셀 내용을 가공 없이 표시하고, 폴더 버튼은 선택 날짜의 정확한 Drive 날짜 폴더로 연결합니다.</div><section class="workspace"><aside class="left-stack"><article class="card raw-card"><div class="section-head"><div><h3>가-3 원문</h3><p>선택한 교육일의 Google Sheet 원문 내용입니다. · 가공하지 않은 원문 텍스트</p></div></div><pre id="rawReason" class="raw-text">Google Sheet를 불러오는 중…</pre></article><article class="card manual-card"><div class="section-head"><div><h3>수기출석 관련 관리자 메모</h3><p>해당 반·날짜 수기출석 전체에 대한 관리자 메모입니다.</p></div></div><div class="manual-body"><div class="manual-issue"><div class="manual-issue-head"><strong>관리자 메모</strong><span id="manualIssueState" class="manual-issue-state"></span></div><textarea id="manualIssueMemo" placeholder="전반적인 출결 특이사항, 전달사항 등을 입력하세요."></textarea></div><div class="folder-area"><div class="folder-title"><span>관련 폴더 바로가기</span><span class="folder-note">선택 날짜 기준 자동 추출</span></div><div class="folder-buttons"><button id="manualFolderBtn" class="btn folder" disabled>📁 수기출석 날짜폴더 찾는 중…</button><button id="recognitionFolderBtn" class="btn folder" disabled>📁 출결인증서류 날짜폴더 찾는 중…</button></div></div></div></article></aside><article class="card data-panel"><div class="data-title"><strong>Google Sheet · 출결현황 + 학생별 관리자 메모</strong><span>이름 / 출석현황 / 사유 / 서류제출 / 체크히어 / 서류제출 / 수기출석</span></div><div class="table-scroll"><div class="table-head"><div>이름</div><div>출석현황</div><div>사유</div><div>서류제출</div><div>체크히어 관련</div><div>서류제출 관련</div><div>수기출석 관련</div></div><div id="rows" class="rows"><div class="empty">불러오는 중…</div></div></div></article></section></div>`;
  const $=s=>root.querySelector(s),classSel=$('#classSel'),dateSel=$('#dateSel'),rows=$('#rows'),err=$('#err'),topState=$('#topState'),rawReason=$('#rawReason'),manualIssueMemo=$('#manualIssueMemo'),manualIssueState=$('#manualIssueState'),manualFolderBtn=$('#manualFolderBtn'),recognitionFolderBtn=$('#recognitionFolderBtn');
  let dates=[],students=[],reasonCells={},memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();
  let driveToken=String(driveAccessToken||'');
  const colorCache=new Map(),colorPromises=new Map();
  const showErr=e=>{err.innerHTML=e?`<div class="error">${esc(e.message||e)}</div>`:''};
  async function getReader(cid){const idToken=await user.getIdToken();return post('/api/attendance-reader',{idToken,classId:String(cid)})}
  async function getColorsOnce(cid){
  const idToken=await user.getIdToken();
  const d=await post('/api/attendance-colors',{idToken,classId:String(cid)});
  if(Array.isArray(d.attendanceBackgrounds))return d.attendanceBackgrounds;
  if(Array.isArray(d.backgrounds))return d.backgrounds;
  return [];
}
async function getColors(cid){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const bg=await getColorsOnce(cid);
      if(Array.isArray(bg)&&bg.length)return bg;
      lastError=new Error('색상 데이터가 비어 있습니다.');
    }catch(e){lastError=e}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
  }
  throw lastError||new Error('색상 데이터를 불러오지 못했습니다.');
}
  async function getColorsCached(cid,force=false){
    const id=String(cid),storageKey=`attendanceOverviewColors_${id}`,ttl=180000;
    if(!force&&colorCache.has(id))return colorCache.get(id);
    if(!force){try{const raw=sessionStorage.getItem(storageKey),x=raw?JSON.parse(raw):null;if(x&&Array.isArray(x.data)&&Date.now()-Number(x.at||0)<ttl){colorCache.set(id,x.data);return x.data}}catch{}}
    if(!force&&colorPromises.has(id))return colorPromises.get(id);
    const promise=getColors(id).then(bg=>{const data=Array.isArray(bg)?bg:[];colorCache.set(id,data);try{sessionStorage.setItem(storageKey,JSON.stringify({at:Date.now(),data}))}catch{}return data}).finally(()=>colorPromises.delete(id));
    colorPromises.set(id,promise);return promise;
  }
  function overviewWeekNo(iso){
    const d=new Date(`${iso}T00:00:00Z`),start=new Date('2026-07-27T00:00:00Z');
    if(Number.isNaN(d.getTime()))return null;
    return Math.floor((d-start)/604800000)+1;
  }
  function dateFolderPatterns(iso){
    const mm=iso.slice(5,7),dd=iso.slice(8,10),m=String(Number(mm)),d=String(Number(dd));
    return [mm+dd,m+d,m+'월'+d+'일',m+'.'+d,m+'-'+d,m+'_'+d].map(x=>String(x).replace(/\s+/g,'').toLowerCase());
  }
  function matchesDateFolder(name,iso){
    const n=String(name||'').replace(/\s+/g,'').toLowerCase(),patterns=dateFolderPatterns(iso);
    return patterns.some(p=>n===p||n.startsWith(p+'('));
  }
  async function driveChildren(parentId,token){
    if(!parentId||!token)return[];
    const params=new URLSearchParams();
    params.set('q',`'${parentId}' in parents and trashed = false`);
    params.set('pageSize','1000');
    params.set('supportsAllDrives','true');
    params.set('includeItemsFromAllDrives','true');
    params.set('fields','files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink)');
    const r=await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(r.status===401||r.status===403)throw new Error('GOOGLE_DRIVE_PERMISSION_REQUIRED');
    if(!r.ok)throw new Error(`GOOGLE_DRIVE_API_${r.status}`);
    const d=await r.json();return Array.isArray(d.files)?d.files:[];
  }
  function previewFileMeta(f){
    const id=String(f?.id||''),name=String(f?.name||'파일'),mimeType=String(f?.mimeType||'application/octet-stream').toLowerCase();
    if(!id||mimeType==='application/vnd.google-apps.folder')return null;
    if(!(mimeType==='application/pdf'||mimeType.startsWith('image/')||/\.(pdf|png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name)))return null;
    return{fileId:id,name,mimeType,createdAt:String(f?.createdTime||''),updatedAt:String(f?.modifiedTime||''),size:Number.isFinite(Number(f?.size))?Number(f.size):null,fileUrl:`https://drive.google.com/file/d/${id}/view`,previewUrl:`https://drive.google.com/file/d/${id}/preview`};
  }
  async function directDriveLookup(rootId,iso,token){
    const folderMime='application/vnd.google-apps.folder',weekNo=overviewWeekNo(iso),roots=await driveChildren(rootId,token);
    const weekFolder=roots.find(f=>{if(String(f?.mimeType)!==folderMime)return false;const m=String(f?.name||'').match(/week\s*[-_()]?\s*(\d+)/i);return m&&Number(m[1])===weekNo});
    if(!weekFolder)return{dateFolderFound:false,exactDateFolder:false,dateFolderId:'',dateFolderUrl:'',files:[],fileCount:0,directDriveUsed:true};
    const dateFolders=await driveChildren(weekFolder.id,token),dateFolder=dateFolders.find(f=>String(f?.mimeType)===folderMime&&matchesDateFolder(f?.name,iso));
    if(!dateFolder)return{dateFolderFound:false,exactDateFolder:false,dateFolderId:'',dateFolderUrl:'',files:[],fileCount:0,directDriveUsed:true,weekFolderId:weekFolder.id};
    const raw=await driveChildren(dateFolder.id,token),files=raw.map(previewFileMeta).filter(Boolean).sort((a,b)=>{const ta=Date.parse(a.createdAt)||Date.parse(a.updatedAt)||0,tb=Date.parse(b.createdAt)||Date.parse(b.updatedAt)||0;return tb-ta});
    return{dateFolderFound:true,exactDateFolder:true,dateFolderId:dateFolder.id,dateFolderUrl:`https://drive.google.com/drive/folders/${dateFolder.id}`,folderId:dateFolder.id,folderUrl:`https://drive.google.com/drive/folders/${dateFolder.id}`,files,fileCount:files.length,latestPreviewFile:files[0]||null,directDriveUsed:true,weekFolderId:weekFolder.id,week:weekNo,expectedWeek:weekNo,expectedDateFolder:iso.slice(5,7)+iso.slice(8,10)};
  }
  async function getFolder(cid,iso,folderKey){
    const idToken=await user.getIdToken(),base=await post('/api/admin-drive-review',{idToken,action:'list',classId:String(cid),date:iso,folderKey:String(folderKey)});
    if(base.dateFolderId||base.exactDateFolder)return base;
    const rootId=String(base.rootFolderId||((!base.exactDateFolder&&base.folderId)?base.folderId:'')||'');
    if(!rootId)return base;
    let token=driveToken;
    if(!token&&typeof getDriveAccessToken==='function'){try{token=String(await getDriveAccessToken(false)||'');driveToken=token}catch{}}
    if(!token)return base;
    try{const direct=await directDriveLookup(rootId,iso,token);return{...base,...direct,rootFolderId:rootId,rootFolderUrl:base.rootFolderUrl||base.folderUrl||'',bridgeUsed:false}}
    catch(e){return{...base,directDriveError:String(e.message||e),rootFolderId:rootId}}
  }
  function parseReader(out){
    const a=out.attendance||[],h=a[0]||[];
    attendanceBackgrounds=Array.isArray(out.attendanceBackgrounds)?out.attendanceBackgrounds:(Array.isArray(out.backgrounds)?out.backgrounds:[]);
    dates=h.slice(4).map((x,i)=>({label:normDate(x),idx:i,iso:dateIso(x)})).filter(x=>x.label&&x.iso);
    students=a.slice(1).map((r,rowIndex)=>({rowIndex,name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);
    const g=out.reasons||[],rh=(g[0]||[]).slice(4),rr=(g[1]||[]).slice(4);reasonCells={};rh.forEach((d,i)=>reasonCells[normDate(d)]=rr[i]||'');
  }
  async function loadMemos(cid,iso){memos={};manualIssue='';try{const snap=await getDoc(doc(db,'settings',memoId(cid,iso)));if(snap.exists()){const data=snap.data()||{};memos=data.memos||{};manualIssue=String(data.manualIssue||'')}}catch(e){console.warn('memo load failed',e)}manualIssueMemo.value=manualIssue;manualIssueState.textContent=manualIssue?'저장됨':''}
  function keyFor(s){return`${s.rowIndex}_${s.name}`}
  async function saveStudentMemo(key,category,value,stateEl,cid,iso){
    const bundle=normalizeMemoBundle(memos[key]);bundle[category]=String(value||'');memos={...memos,[key]:bundle};if(!bundle.checkhere.trim()&&!bundle.documents.trim()&&!bundle.manual.trim())delete memos[key];const snapshot=JSON.parse(JSON.stringify(memos));if(stateEl)stateEl.textContent='저장 중';
    try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,memos:snapshot,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso&&stateEl)stateEl.textContent='저장됨'}catch(e){if(stateEl)stateEl.textContent='실패';throw e}
  }
  async function saveManualIssue(value,stateEl,cid,iso){const next=String(value||'');if(stateEl)stateEl.textContent='저장 중';try{await setDoc(doc(db,'settings',memoId(cid,iso)),{type:'ATTENDANCE_OVERVIEW_MEMO',classId:cid,date:iso,manualIssue:next,updatedBy:user.email||'',updatedAt:serverTimestamp()},{merge:true});if(cid===currentClass&&iso===currentIso){manualIssue=next;if(stateEl)stateEl.textContent='저장됨'}}catch(e){if(stateEl)stateEl.textContent='실패';throw e}}
  function renderRawReason(label){
    const raw=String(reasonCells[label]??'');
    rawReason.textContent=raw||'해당 날짜의 가-3 원문이 없습니다.';
    rawReason.classList.toggle('raw-empty',!raw);
  }
  function renderRows(label){
    const d=dates.find(x=>x.label===label);if(!d){rows.innerHTML='<div class="empty">해당 날짜를 찾지 못했습니다.</div>';return}
    const reasonText=reasonCells[label]||'',roster=students.map(x=>x.name);
    rows.innerHTML=students.map((s,i)=>{const status=String(s.all[d.idx]||'').trim()||'미입력',reason=reasonFor(s.name,reasonText,roster,status),e=evidenceFor(s,d,status,attendanceBackgrounds),key=keyFor(s),bundle=normalizeMemoBundle(memos[key]);return`<div class="student-row"><div class="cell"><div class="name">${esc(s.name)}</div></div><div class="cell center"><span class="status ${statusClass(status)}">${esc(status)}</span></div><div class="cell reason ${reason?'':'none'}">${esc(reason||'-')}</div><div class="cell center"><span class="evidence ${e.cls}">${esc(e.label)}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="checkhere" data-state-key="${i}-checkhere" placeholder="체크히어 관련 메모">${esc(bundle.checkhere)}</textarea><span class="memo-state" data-state="${i}-checkhere">${bundle.checkhere?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="documents" data-state-key="${i}-documents" placeholder="서류제출 관련 메모">${esc(bundle.documents)}</textarea><span class="memo-state" data-state="${i}-documents">${bundle.documents?'저장됨':''}</span></div><div class="cell memo-cell"><textarea class="memo" data-key="${esc(key)}" data-category="manual" data-state-key="${i}-manual" placeholder="수기출석 관련 메모">${esc(bundle.manual)}</textarea><span class="memo-state" data-state="${i}-manual">${bundle.manual?'저장됨':''}</span></div></div>`}).join('')||'<div class="empty">교육생이 없습니다.</div>';
    root.querySelectorAll('.memo').forEach(ta=>{ta.oninput=()=>{const key=ta.dataset.key,category=ta.dataset.category,stateKey=ta.dataset.stateKey,state=root.querySelector(`[data-state="${CSS.escape(stateKey)}"]`),cid=currentClass,iso=currentIso,timerKey=`${cid}_${iso}_${key}_${category}`;if(state)state.textContent='입력 중';clearTimeout(saveTimers.get(timerKey));saveTimers.set(timerKey,setTimeout(()=>saveStudentMemo(key,category,ta.value,state,cid,iso).catch(e=>showErr(e)),650))}})
  }
  function folderUrlFrom(d){return String(d?.dateFolderUrl||(d?.dateFolderId?`https://drive.google.com/drive/folders/${d.dateFolderId}`:'')||(d?.exactDateFolder?d?.folderUrl:'')||'')}
  function paintFolderButton(btn,label,result){
    btn.dataset.url='';btn.disabled=true;
    if(!result||result.status!=='fulfilled'){btn.textContent=`📁 ${label} · 확인 오류`;return}
    const d=result.value||{},url=folderUrlFrom(d),found=Boolean(d.dateFolderFound||d.exactDateFolder||d.dateFolderId);
    if(url){btn.dataset.url=url;btn.disabled=false;btn.textContent=`📁 ${label} 날짜폴더 바로가기`;return}
    btn.textContent=found?`📁 ${label} · 링크 확인 필요`:`📁 ${label} · 날짜폴더 없음`;
  }
  async function loadFolderLinks(){
    const cid=currentClass,iso=currentIso;
    manualFolderBtn.disabled=true;recognitionFolderBtn.disabled=true;
    manualFolderBtn.textContent='📁 수기출석 날짜폴더 찾는 중…';recognitionFolderBtn.textContent='📁 출결인증서류 날짜폴더 찾는 중…';
    const [manual,recognition]=await Promise.allSettled([getFolder(cid,iso,'manualAttendance'),getFolder(cid,iso,'recognition')]);
    if(cid!==currentClass||iso!==currentIso)return;
    paintFolderButton(manualFolderBtn,'수기출석',manual);paintFolderButton(recognitionFolderBtn,'출결인증서류',recognition);
  }
  async function loadSelectedDate(){showErr('');const label=dateSel.value,d=dates.find(x=>x.label===label);if(!d)return;currentIso=d.iso;topState.textContent=`${currentClass}반 · ${label} 불러오는 중…`;await loadMemos(currentClass,currentIso);renderRawReason(label);renderRows(label);loadFolderLinks().catch(e=>console.warn('folder links failed',e));topState.textContent=`${currentClass}반 · ${label} · ${students.length}명`}
  async function loadClass(cid,keepDate='',forceColors=false){
    showErr('');currentClass=String(cid);attendanceBackgrounds=[];topState.textContent=`${currentClass}반 시트 읽는 중…`;rows.innerHTML='<div class="empty">Google Sheet를 읽는 중…</div>';rawReason.textContent='Google Sheet를 읽는 중…';
    const colorClass=currentClass;
    try{
      const out=await getReader(currentClass);parseReader(out);
      dateSel.innerHTML=dates.map(d=>`<option value="${esc(d.label)}">${esc(d.label)}</option>`).join('');
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
    }catch(e){showErr(e);rows.innerHTML='<div class="empty">출결 데이터를 불러오지 못했습니다.</div>';topState.textContent='오류'}
  }
  classSel.onchange=()=>loadClass(classSel.value);
  dateSel.onchange=()=>loadSelectedDate();
  $('#reload').onclick=()=>loadClass(currentClass,dateSel.value,true);
  manualFolderBtn.onclick=()=>{const u=manualFolderBtn.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};
  recognitionFolderBtn.onclick=()=>{const u=recognitionFolderBtn.dataset.url;if(u)window.open(u,'_blank','noopener,noreferrer')};
  manualIssueMemo.oninput=()=>{manualIssueState.textContent='입력 중';const cid=currentClass,iso=currentIso,value=manualIssueMemo.value,key=`manualIssue_${cid}_${iso}`;clearTimeout(saveTimers.get(key));saveTimers.set(key,setTimeout(()=>saveManualIssue(value,manualIssueState,cid,iso).catch(e=>showErr(e)),650))};
  await loadClass(classSel.value||'1');
}
