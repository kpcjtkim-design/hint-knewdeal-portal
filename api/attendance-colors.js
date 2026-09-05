const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
const ATTENDANCE_READER='https://script.google.com/macros/s/AKfycbzNcSYQf3JORsZRb0QOwlMOnG4sRlUUwW-1s2xF3ypvlbLfrwYQisF1brFUV2f8XGaf/exec';
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
async function readBackgrounds(url,classId,userAgent){
  const r=await fetch(`${url}?classId=${encodeURIComponent(classId)}`,{redirect:'follow',headers:{'User-Agent':userAgent}});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{return{backgrounds:[],error:'BAD_RESPONSE'}};
  const backgrounds=Array.isArray(d?.attendanceBackgrounds)?d.attendanceBackgrounds:(Array.isArray(d?.backgrounds)?d.backgrounds:[]);
  if(r.ok&&d?.ok&&backgrounds.length)return{backgrounds,error:''};
  return{backgrounds:[],error:d?.error||(!r.ok?`HTTP_${r.status}`:'EMPTY_BACKGROUNDS')};
}
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const{idToken,classId}=req.body||{};if(!idToken)throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email);if(!p.active||p.role!=='ADMIN')throw new Error('ADMIN_REQUIRED');
    const cid=String(classId||'');if(!/^([1-9]|1[0-7])$/.test(cid))throw new Error('BAD_CLASS');

    const primary=await readBackgrounds(ATTENDANCE_READER,cid,'HINT-Attendance-Colors-SameReader/1.0');
    if(primary.backgrounds.length){
      return res.status(200).json({ok:true,classId:cid,attendanceBackgrounds:primary.backgrounds,readOnly:true,source:'attendance-reader'});
    }

    const fallback=await readBackgrounds(COLOR_READER,cid,'HINT-Attendance-Colors-Fallback/1.0');
    if(fallback.backgrounds.length){
      return res.status(200).json({ok:true,classId:cid,attendanceBackgrounds:fallback.backgrounds,readOnly:true,source:'color-reader-fallback'});
    }

    throw new Error(`COLOR_READER_ERROR:${primary.error||'PRIMARY_EMPTY'}:${fallback.error||'FALLBACK_EMPTY'}`);
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
