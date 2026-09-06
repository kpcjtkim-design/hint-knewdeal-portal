const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
const BRIDGE=process.env.ADMIN_DRIVE_REVIEW_BRIDGE||'';
const MONITOR='https://script.google.com/macros/s/AKfycbxE4sXaG3r6CZArdGgFnelj8tai-urVpXJ_gjPHFapmBUhrDk-BK3-xd2oi-Tb-QLt9/exec';

async function verify(idToken){
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok)throw new Error('LOGIN_REQUIRED');
  const d=await r.json(),u=d.users?.[0];if(!u?.email)throw new Error('LOGIN_REQUIRED');return u.email.toLowerCase();
}
async function profile(idToken,email){
  if(ADMIN.has(email))return{role:'ADMIN',active:true};
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  const r=await fetch(url,{headers:{authorization:`Bearer ${idToken}`}});if(!r.ok)throw new Error('PROFILE_NOT_FOUND');
  const f=(await r.json()).fields||{};return{role:f.role?.stringValue||'',active:f.active?.booleanValue===true};
}
async function callBridge(payload){
  if(!BRIDGE)return null;
  try{
    const r=await fetch(BRIDGE,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow'});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{return null}
    if(r.ok&&d&&d.ok===true)return d;
  }catch{}
  return null;
}
async function classFields(idToken,classId){
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/classes/${encodeURIComponent(classId)}`;
  const r=await fetch(url,{headers:{authorization:`Bearer ${idToken}`}});if(!r.ok)throw new Error('CLASS_DOC_NOT_FOUND');
  return (await r.json()).fields||{};
}
function coreLink(fields,key){return fields?.coreLinks?.mapValue?.fields?.[key]?.stringValue||''}
function folderId(url){const m=String(url||'').match(/\/folders\/([A-Za-z0-9_-]+)/);return m?m[1]:''}
function safeFile(f){
  const id=String(f?.fileId||f?.id||'');
  if(!id||!/^[A-Za-z0-9_-]{10,}$/.test(id))return null;
  const name=String(f?.name||'파일');
  const mimeType=String(f?.mimeType||'application/octet-stream');
  if(mimeType==='application/vnd.google-apps.folder')return null;
  return{
    fileId:id,
    name,
    mimeType,
    createdAt:String(f?.createdAt||''),
    updatedAt:String(f?.updatedAt||''),
    size:Number.isFinite(Number(f?.size))?Number(f.size):null,
    fileUrl:`https://drive.google.com/file/d/${id}/view`,
    previewUrl:`https://drive.google.com/file/d/${id}/preview`,
    imageUrl:`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`
  };
}
function isPreviewable(f){
  const mime=String(f?.mimeType||'').toLowerCase();
  const name=String(f?.name||'').toLowerCase();
  return mime==='application/pdf'||mime.startsWith('image/')||/\.(pdf|png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name);
}
function uploadedAt(f){
  const created=Date.parse(String(f?.createdAt||''));
  if(Number.isFinite(created))return created;
  const updated=Date.parse(String(f?.updatedAt||''));
  return Number.isFinite(updated)?updated:0;
}
function compactDate(date){return String(date||'').replace(/\D/g,'').slice(-4)}
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
  const upstreamCount=Number.isFinite(Number(chosen?.fileCount))?Number(chosen.fileCount):(Number.isFinite(Number(primary?.fileCount))?Number(primary.fileCount):0);
  return{
    fileCount:files.length||upstreamCount,
    sourceFileCount:allFiles.length||upstreamCount,
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
}
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const{idToken,action,classId,date,folderKey}=req.body||{};if(!idToken)throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email);if(!p.active||p.role!=='ADMIN')throw new Error('ADMIN_REQUIRED');
    if(action==='status')return res.status(200).json({ok:true,readOnly:true,bridgeReady:true,actorEmail:email});
    if(action!=='list')throw new Error('READ_ONLY_ENDPOINT');
    const cid=String(classId||'');if(!/^([1-9]|1[0-7])$/.test(cid))throw new Error('BAD_CLASS');
    if(!/^2026-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('BAD_DATE');
    const key=String(folderKey||'');if(!['manualAttendance','recognition'].includes(key))throw new Error('BAD_FOLDER_KEY');
    const requestedDate=String(date);
    const bridged=await callBridge({action:'list',idToken,classId:cid,date:requestedDate,folderKey:key});
    if(bridged){
      const dateFolderId=String(bridged.folderId||bridged.dateFolderId||'');
      const dateFolderUrl=String(bridged.folderUrl||bridged.dateFolderUrl||(dateFolderId?`https://drive.google.com/drive/folders/${dateFolderId}`:''));
      const allFiles=(Array.isArray(bridged.files)?bridged.files:[]).map(safeFile).filter(Boolean);
      const files=allFiles.filter(isPreviewable).sort((a,b)=>uploadedAt(b)-uploadedAt(a));
      const sourceCount=Number.isFinite(Number(bridged.fileCount))?Number(bridged.fileCount):allFiles.length;
      return res.status(200).json({ok:true,readOnly:true,classId:cid,date:requestedDate,folderKey:key,fileCount:files.length||sourceCount,sourceFileCount:allFiles.length||sourceCount,files,latestPreviewFile:files[0]||null,dateFolderId,dateFolderUrl,folderId:dateFolderId,folderUrl:dateFolderUrl,exactDateFolder:Boolean(dateFolderId),dateFolderFound:Boolean(dateFolderId),week:weekNoFor(requestedDate),expectedWeek:weekNoFor(requestedDate),expectedDateFolder:compactDate(requestedDate),status:files.length||sourceCount?'COMPLETE':'INCOMPLETE',completed:Boolean(files.length||sourceCount),monitorOk:true,bridgeUsed:true,embeddedFolderUrl:dateFolderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(dateFolderId)}#list`:'',actorEmail:email});
    }
    const fields=await classFields(idToken,cid),root=coreLink(fields,key);if(!root)throw new Error('FOLDER_NOT_SET');
    const out=await monitor(root,requestedDate);
    const dateFolderFound=Boolean(out.dateFolderId)||out.monitorOk===true;
    return res.status(200).json({ok:true,readOnly:true,classId:cid,date:requestedDate,folderKey:key,...out,dateFolderFound,bridgeUsed:false,embeddedFolderUrl:out.exactDateFolder&&out.dateFolderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.dateFolderId)}#list`:'',actorEmail:email});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
