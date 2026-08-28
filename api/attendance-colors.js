const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
const COLOR_READER='https://script.google.com/macros/s/AKfycbzQF_ikT0z-dRzvtX0XybbYlbnNgZau7-L-SPGcD2EtO6oR9Dhh45ye1oz8suSfHXkf/exec';

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
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const{idToken,classId}=req.body||{};if(!idToken)throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email);if(!p.active||p.role!=='ADMIN')throw new Error('ADMIN_REQUIRED');
    const cid=String(classId||'');if(!/^([1-9]|1[0-7])$/.test(cid))throw new Error('BAD_CLASS');
    const r=await fetch(`${COLOR_READER}?classId=${encodeURIComponent(cid)}`,{redirect:'follow',headers:{'User-Agent':'HINT-Attendance-Colors/1.0'}});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{throw new Error('COLOR_READER_BAD_RESPONSE')}
    if(!r.ok||!d.ok)throw new Error(d?.error||'COLOR_READER_ERROR');
    return res.status(200).json({ok:true,classId:cid,attendanceBackgrounds:d.attendanceBackgrounds||d.backgrounds||[],readOnly:true});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
