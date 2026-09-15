const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);
const BRIDGE='https://script.google.com/macros/s/AKfycbzNcSYQf3JORsZRb0QOwlMOnG4sRlUUwW-1s2xF3ypvlbLfrwYQisF1brFUV2f8XGaf/exec';

async function verify(idToken){
  const {response:r,data:d}=await fetchJson(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})
  });
  if(!r.ok)throw new Error('LOGIN_REQUIRED');
  const u=d.users?.[0];
  if(!u?.email)throw new Error('LOGIN_REQUIRED');
  return u.email.toLowerCase();
}
async function profile(idToken,email){
  if(ADMIN.has(email))return{role:'ADMIN',active:true};
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  const {response:r,data:d}=await fetchJson(url,{headers:{authorization:`Bearer ${idToken}`}});
  if(!r.ok&&(r.status===429||d.error?.status==='RESOURCE_EXHAUSTED'))throw new Error('DATABASE_QUOTA_EXCEEDED');
  if(!r.ok)throw new Error(r.status===401?'LOGIN_REQUIRED':r.status===404?'PROFILE_NOT_FOUND':r.status===403?'PROFILE_READ_FORBIDDEN':'PROFILE_UNAVAILABLE');
  const f=d.fields||{};
  return{role:f.role?.stringValue,active:f.active===undefined||f.active?.booleanValue===true};
}
import {fetchJson,readBridge,readerFailure} from '../lib/attendance-reader-transport.cjs';
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const{idToken,classId}=req.body||{};
    if(!idToken)throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email);
    if(!p.active||p.role!=='ADMIN')throw new Error('ADMIN_REQUIRED');
    const n=Number(classId);if(!Number.isInteger(n)||n<1||n>17)throw new Error('BAD_CLASS');
    const out=await readBridge(BRIDGE,String(n),{allowCache:req.body.allowCache===true&&req.body.fresh!==true});
    return res.status(200).json({...out,viewer:email});
  }catch(e){const {status,...failure}=readerFailure(e);return res.status(status).json({ok:false,...failure});}
}
