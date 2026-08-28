const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
const BRIDGE=process.env.ADMIN_DRIVE_REVIEW_BRIDGE||'';

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
  if(!BRIDGE)throw new Error('ADMIN_DRIVE_REVIEW_BRIDGE_NOT_CONFIGURED');
  const r=await fetch(BRIDGE,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow'});
  const t=await r.text();let d={};try{d=JSON.parse(t)}catch{throw new Error('ADMIN_DRIVE_REVIEW_BAD_RESPONSE')}
  if(!r.ok||!d.ok)throw new Error(d?.error||'ADMIN_DRIVE_REVIEW_ERROR');return d;
}
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const{idToken,action,classId,date,folderKey,fromDate,toDate}=req.body||{};if(!idToken)throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email);if(!p.active||p.role!=='ADMIN')throw new Error('ADMIN_REQUIRED');
    if(action==='status')return res.status(200).json({ok:true,bridgeReady:Boolean(BRIDGE),actorEmail:email});
    if(action==='list'){
      const cid=String(classId||'');if(!/^([1-9]|1[0-7])$/.test(cid))throw new Error('BAD_CLASS');
      if(!/^2026-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('BAD_DATE');
      if(!['manualAttendance','recognition'].includes(String(folderKey||'')))throw new Error('BAD_FOLDER_KEY');
      const out=await callBridge({action:'list',idToken,classId:cid,date:String(date),folderKey:String(folderKey)});
      return res.status(200).json({...out,actorEmail:email});
    }
    if(action==='renameManual'){
      const start=String(fromDate||'2026-08-27'),end=String(toDate||'');
      if(start<'2026-08-27'||!/^2026-\d{2}-\d{2}$/.test(start)||!/^2026-\d{2}-\d{2}$/.test(end))throw new Error('BAD_DATE_RANGE');
      const out=await callBridge({action:'renameManual',idToken,fromDate:start,toDate:end});
      return res.status(200).json({...out,actorEmail:email});
    }
    throw new Error('BAD_ACTION');
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
