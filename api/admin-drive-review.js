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
async function monitor(root,date){
  const id=folderId(root);if(!id)throw new Error('FOLDER_NOT_SET');
  const u=new URL(MONITOR);u.searchParams.set('folderId',id);u.searchParams.set('date',date);
  const r=await fetch(u,{method:'GET',redirect:'follow',headers:{'User-Agent':'HINT-Admin-ReadOnly-Review/1.0'}});if(!r.ok)throw new Error('DRIVE_MONITOR_UPSTREAM_ERROR');
  const d=await r.json();if(d.ok!==true)throw new Error(d.error||d.reason||'DRIVE_MONITOR_ERROR');
  const df=d.dateFolder||null;
  const dateFolderId=d.dateFolderId||(df&&typeof df==='object'&&(df.id||df.folderId))||(typeof df==='string'&&/^[A-Za-z0-9_-]{10,}$/.test(df)?df:'');
  const dateFolderUrl=d.dateFolderUrl||(df&&typeof df==='object'&&(df.url||df.webViewLink))||(dateFolderId?`https://drive.google.com/drive/folders/${dateFolderId}`:'');
  return{fileCount:Number.isFinite(Number(d.fileCount))?Number(d.fileCount):0,dateFolderId:dateFolderId||'',dateFolderUrl:dateFolderUrl||root,week:d.week||null,status:d.status||'',completed:d.completed===true};
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
    const fields=await classFields(idToken,cid),root=coreLink(fields,key),out=await monitor(root,String(date));
    return res.status(200).json({ok:true,readOnly:true,classId:cid,date:String(date),folderKey:key,...out,embeddedFolderUrl:out.dateFolderId?`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(out.dateFolderId)}#list`:'',actorEmail:email});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
