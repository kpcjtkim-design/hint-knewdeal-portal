const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
const ATTENDANCE_BRIDGE='https://script.google.com/macros/s/AKfycbzNcSYQf3JORsZRb0QOwlMOnG4sRlUUwW-1s2xF3ypvlbLfrwYQisF1brFUV2f8XGaf/exec';
const UPLOAD_BRIDGE=process.env.RECOGNITION_UPLOAD_BRIDGE||'';
const MAX_BYTES=3*1024*1024;

async function verify(idToken){
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok)throw new Error('LOGIN_REQUIRED');
  const d=await r.json(),u=d.users?.[0];if(!u?.email)throw new Error('LOGIN_REQUIRED');return u.email.toLowerCase();
}
function scalar(v){return v?.stringValue??v?.integerValue??''}
function array(v){return (v?.arrayValue?.values||[]).map(x=>String(scalar(x))).filter(Boolean)}
async function profile(idToken,email){
  if(ADMIN.has(email))return{role:'ADMIN',active:true,classIds:Array.from({length:17},(_,i)=>String(i+1))};
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  const r=await fetch(url,{headers:{authorization:`Bearer ${idToken}`}});if(!r.ok)throw new Error('PROFILE_NOT_FOUND');
  const f=(await r.json()).fields||{},ids=new Set([String(scalar(f.classId)||''),String(scalar(f.primaryClassId)||''),...array(f.classIds),...array(f.tempClassIds)].filter(Boolean));
  return{role:scalar(f.role),active:f.active?.booleanValue===true,classIds:[...ids]};
}
async function attendanceRoster(classId){
  const r=await fetch(`${ATTENDANCE_BRIDGE}?classId=${encodeURIComponent(classId)}`,{redirect:'follow'});const t=await r.text();let d={};try{d=JSON.parse(t)}catch{throw new Error('ROSTER_BAD_RESPONSE')}
  if(!r.ok||!d.ok)throw new Error(d?.error||'ROSTER_ERROR');
  const rows=d.attendance||[];return rows.slice(1).map(x=>String(x?.[0]||'').trim()).filter(Boolean);
}
async function uploadBridge(payload){
  if(!UPLOAD_BRIDGE)throw new Error('UPLOAD_BRIDGE_NOT_CONFIGURED');
  const r=await fetch(UPLOAD_BRIDGE,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow'});const t=await r.text();let d={};try{d=JSON.parse(t)}catch{throw new Error('UPLOAD_BRIDGE_BAD_RESPONSE')}
  if(!r.ok||!d.ok)throw new Error(d?.error||'UPLOAD_BRIDGE_ERROR');return d;
}
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const {idToken,action,classId,student,date,fileName,mimeType,base64}=req.body||{};if(!idToken)throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email),cid=String(classId||'');
    if(!p.active||!['ADMIN','TEACHER'].includes(String(p.role)))throw new Error('ACCESS_DENIED');
    if(!/^([1-9]|1[0-7])$/.test(cid)||!p.classIds.includes(cid))throw new Error('CLASS_NOT_ALLOWED');
    const roster=await attendanceRoster(cid);
    if(action==='context'){
      let bridgeContext={};try{bridgeContext=await uploadBridge({action:'context',idToken,classId:cid})}catch(e){if(String(e.message)!=='UPLOAD_BRIDGE_NOT_CONFIGURED')throw e}
      return res.status(200).json({ok:true,classId:cid,students:roster,officialClassName:bridgeContext.officialClassName||'',bridgeReady:Boolean(UPLOAD_BRIDGE),actorEmail:email});
    }
    if(action!=='upload')throw new Error('BAD_ACTION');
    const name=String(student||'').trim();if(!roster.includes(name))throw new Error('STUDENT_NOT_IN_CLASS');
    if(!/^2026-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('BAD_DATE');
    const raw=String(base64||'');const approx=Math.floor(raw.length*3/4);if(!raw||approx>MAX_BYTES)throw new Error('FILE_TOO_LARGE_3MB');
    const out=await uploadBridge({action:'upload',idToken,classId:cid,student:name,date:String(date),originalFileName:String(fileName||''),mimeType:String(mimeType||'application/octet-stream'),base64:raw});
    return res.status(200).json({...out,actorEmail:email});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
