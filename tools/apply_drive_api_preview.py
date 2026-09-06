from pathlib import Path

# ---- index.html: one-time admin Google Drive metadata read-only OAuth ----
p = Path('index.html')
s = p.read_text(encoding='utf-8')
old_import = "import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';"
new_import = "import { getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';"
if old_import in s:
    s = s.replace(old_import, new_import, 1)
elif 'reauthenticateWithPopup' not in s:
    raise SystemExit('firebase auth import marker missing')

admin_marker = "const ADMINS=['hint.kpc@gmail.com','kpc.jtkim@gmail.com'];"
helpers = r"""
const DRIVE_READ_SCOPE='https://www.googleapis.com/auth/drive.metadata.readonly';
const DRIVE_TOKEN_KEY='hintAdminDriveMetadataToken';
const DRIVE_TOKEN_EXP_KEY='hintAdminDriveMetadataTokenExp';
function cachedDriveAccessToken(){
  try{const token=sessionStorage.getItem(DRIVE_TOKEN_KEY)||'',exp=Number(sessionStorage.getItem(DRIVE_TOKEN_EXP_KEY)||0);if(token&&exp>Date.now()+60000)return token}catch{}
  return'';
}
function clearDriveAccessToken(){try{sessionStorage.removeItem(DRIVE_TOKEN_KEY);sessionStorage.removeItem(DRIVE_TOKEN_EXP_KEY)}catch{}}
async function ensureDriveAccessToken(force=false){
  if(force)clearDriveAccessToken();
  const cached=cachedDriveAccessToken();if(cached)return cached;
  const current=auth.currentUser;if(!current)throw new Error('관리자 로그인이 필요합니다.');
  const driveProvider=new GoogleAuthProvider();
  driveProvider.addScope(DRIVE_READ_SCOPE);
  driveProvider.setCustomParameters({prompt:'consent',login_hint:current.email||'',include_granted_scopes:'true'});
  const result=await reauthenticateWithPopup(current,driveProvider);
  const credential=GoogleAuthProvider.credentialFromResult(result),token=credential&&credential.accessToken||'';
  if(!token)throw new Error('Google Drive 읽기 권한 토큰을 받지 못했습니다.');
  try{sessionStorage.setItem(DRIVE_TOKEN_KEY,token);sessionStorage.setItem(DRIVE_TOKEN_EXP_KEY,String(Date.now()+50*60*1000))}catch{}
  return token;
}
""".strip('\n')
if 'const DRIVE_READ_SCOPE=' not in s:
    if admin_marker not in s: raise SystemExit('admin marker missing')
    s = s.replace(admin_marker, admin_marker+'\n'+helpers, 1)

old_mount = "try{const mod=await import(`/attendance-overview.js?v=20260906-7`);await mod.mountAttendanceOverview(document.getElementById('attendanceOverviewMount'),{auth,db,user,classes:CLASSES})}catch(e){const mount=document.getElementById('attendanceOverviewMount');if(mount)mount.innerHTML=`<div class=\"fatal\">출석부 한눈에 보기를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}"
new_mount = "let driveAccessToken='';try{driveAccessToken=await ensureDriveAccessToken(false)}catch(e){console.warn('Google Drive read-only authorization was not granted',e)}\n  try{const mod=await import(`/attendance-overview.js?v=20260906-8`);await mod.mountAttendanceOverview(document.getElementById('attendanceOverviewMount'),{auth,db,user,classes:CLASSES,driveAccessToken,getDriveAccessToken:ensureDriveAccessToken})}catch(e){const mount=document.getElementById('attendanceOverviewMount');if(mount)mount.innerHTML=`<div class=\"fatal\">출석부 한눈에 보기를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}"
if old_mount in s:
    s = s.replace(old_mount, new_mount, 1)
elif 'v=20260906-8' not in s:
    raise SystemExit('attendanceOverviewAdmin mount marker missing')
p.write_text(s, encoding='utf-8')

# ---- api/admin-drive-review.js: always expose the manual-attendance root id to the admin client ----
p = Path('api/admin-drive-review.js')
s = p.read_text(encoding='utf-8')
old = "  return{\n    fileCount:files.length||upstreamCount,"
new = "  return{\n    rootFolderId:rootId,\n    rootFolderUrl:root,\n    fileCount:files.length||upstreamCount,"
if old in s:
    s = s.replace(old, new, 1)
elif 'rootFolderId:rootId' not in s:
    raise SystemExit('monitor return marker missing')
p.write_text(s, encoding='utf-8')

# ---- attendance-overview.js: Drive API direct folder/file lookup ----
p = Path('attendance-overview.js')
s = p.read_text(encoding='utf-8')
old_ctx = "const {auth,db,user,classes=[]}=ctx||{};if(!auth||!db||!user)throw new Error('관리자 로그인 세션이 없습니다.');"
new_ctx = "const {auth,db,user,classes=[],driveAccessToken='',getDriveAccessToken=null}=ctx||{};if(!auth||!db||!user)throw new Error('관리자 로그인 세션이 없습니다.');"
if old_ctx in s:
    s = s.replace(old_ctx, new_ctx, 1)
elif 'driveAccessToken=' not in s:
    raise SystemExit('ctx marker missing')

old_vars = "let dates=[],students=[],reasonCells={},driveFiles=[],memos={},manualIssue='',attendanceBackgrounds=[],currentIso='',currentClass='1',saveTimers=new Map();"
new_vars = old_vars + "\n  let driveToken=String(driveAccessToken||'');"
if old_vars in s and 'let driveToken=' not in s:
    s = s.replace(old_vars, new_vars, 1)

old_getdrive = "  async function getDrive(cid,iso){const idToken=await user.getIdToken();return post('/api/admin-drive-review',{idToken,action:'list',classId:String(cid),date:iso,folderKey:'manualAttendance'})}"
new_getdrive = r"""  function overviewWeekNo(iso){
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
  async function getDrive(cid,iso){
    const idToken=await user.getIdToken(),base=await post('/api/admin-drive-review',{idToken,action:'list',classId:String(cid),date:iso,folderKey:'manualAttendance'});
    if(Array.isArray(base.files)&&base.files.length)return base;
    const rootId=String(base.rootFolderId||((!base.exactDateFolder&&base.folderId)?base.folderId:'')||'');
    if(!rootId)return base;
    let token=driveToken;
    if(!token&&typeof getDriveAccessToken==='function'){try{token=String(await getDriveAccessToken(false)||'');driveToken=token}catch{}}
    if(!token)return base;
    try{const direct=await directDriveLookup(rootId,iso,token);return{...base,...direct,rootFolderId:rootId,rootFolderUrl:base.rootFolderUrl||base.folderUrl||'',bridgeUsed:false}}
    catch(e){return{...base,directDriveError:String(e.message||e),rootFolderId:rootId}}
  }"""
if old_getdrive in s:
    s = s.replace(old_getdrive, new_getdrive, 1)
elif 'async function directDriveLookup' not in s:
    raise SystemExit('getDrive marker missing')

old_msg = "viewer.innerHTML=reported?'<div class=\"viewer-empty\">날짜 폴더와 파일 업로드는 자동 확인됐지만 미리보기 파일 정보를 받지 못했습니다.<br>읽기 전용 Drive 브리지 연결을 확인해 주세요.</div>':'<div class=\"viewer-empty\">날짜 폴더는 자동으로 확인됐으며 현재 업로드된 수기출석부 파일이 없습니다.</div>';"
new_msg = "viewer.innerHTML=reported?'<div class=\"viewer-empty\">날짜 폴더와 파일 업로드는 확인됐지만 Google Drive 파일 목록 권한을 받지 못했습니다.<br>출석부 한눈에 보기 탭을 다시 열어 Drive 읽기 권한을 연결해 주세요.</div>':'<div class=\"viewer-empty\">날짜 폴더는 자동으로 확인됐으며 현재 업로드된 수기출석부 파일이 없습니다.</div>';"
if old_msg in s:
    s = s.replace(old_msg, new_msg, 1)

old_hint = "원본 Google Sheet와 Google Drive는 읽기만 합니다. 서류제출 상태는 출결 자동검증과 동일한 시트 색상 기준으로 표시합니다."
new_hint = "원본 Google Sheet와 Google Drive는 읽기만 합니다. 수기출석 미리보기는 관리자 Google Drive 읽기 권한으로 WEEK·날짜·파일을 자동 탐색합니다. 서류제출 상태는 출결 자동검증과 동일한 시트 색상 기준으로 표시합니다."
if old_hint in s:
    s = s.replace(old_hint, new_hint, 1)
p.write_text(s, encoding='utf-8')
