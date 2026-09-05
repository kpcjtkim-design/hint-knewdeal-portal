const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
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
async function monitor(root,date){
  const rootId=folderId(root);if(!rootId)throw new Error('FOLDER_NOT_SET');
  const u=new URL(MONITOR);u.searchParams.set('folderId',rootId);u.searchParams.set('date',date);
  let d={};
  try{
    const r=await fetch(u,{method:'GET',redirect:'follow',headers:{'User-Agent':'HINT-Admin-ReadOnly-Review/1.0'}});
    if(r.ok)d=await r.json();
  }catch{}
  const df=d?.dateFolder||null;
  const exactId=d?.dateFolderId||(df&&typeof df==='object'&&(df.id||df.folderId))||(typeof df==='string'&&/^[A-Za-z0-9_-]{10,}$/.test(df)?df:'');
  const exactUrl=d?.dateFolderUrl||(df&&typeof df==='object'&&(df.url||df.webViewLink))||(exactId?`https://drive.google.com/drive/folders/${exactId}`:'');
  const useId=exactId||rootId,useUrl=exactUrl||root;
  const rawFiles=Array.isArray(d?.files)?d.files:
    (df&&typeof df==='object'&&Array.isArray(df.files)?df.files:
    (Array.isArray(d?.dateFiles)?d.dateFiles:
    (Array.isArray(d?.folderFiles)?d.folderFiles:[])));
  const files=rawFiles.map(safeFile).filter(Boolean);
  return{
    fileCount:files.length||(Number.isFinite(Number(d?.fileCount))?Number(d.fileCount):0),
    files,
    dateFolderId:exactId||'',
    dateFolderUrl:exactUrl||'',
    folderId:useId,
    folderUrl:useUrl,
    exactDateFolder:Boolean(exactId),
    week:d?.week||null,
    status:d?.status||'',
    completed:d?.completed===true,
    monitorOk:d?.ok===true
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
    const fields=await classFields(idToken,cid),root=coreLink(fields,key);if(!root)throw new Error('FOLDER_NOT_SET');
    const out=await monitor(root,String(date));
    return res.status(200).json({ok:true,readOnly:true,classId:cid,date:String(date),folderKey:key,...out,embeddedFolderUrl:out.exactDateFolder&&out.dateFolderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.dateFolderId)}#list`:'',actorEmail:email});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
