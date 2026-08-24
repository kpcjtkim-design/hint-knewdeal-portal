const FIREBASE_KEY='AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const PROJECT='knewdeal-portal';
const BRIDGE='https://script.google.com/macros/s/AKfycbxE4sXaG3r6CZArdGgFnelj8tai-urVpXJ_gjPHFapmBUhrDk-BK3-xd2oi-Tb-QLt9/exec';
const ADMIN=new Set(['hint.kpc@gmail.com','kpc.jtkim@gmail.com']);

async function verify(idToken){
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok) throw new Error('LOGIN_REQUIRED');
  const d=await r.json(); const u=d.users?.[0]; if(!u?.email) throw new Error('LOGIN_REQUIRED');
  return u.email.toLowerCase();
}
async function profile(idToken,email){
  if(ADMIN.has(email)) return {role:'ADMIN',classId:'1',active:true};
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  const r=await fetch(url,{headers:{authorization:`Bearer ${idToken}`}}); if(!r.ok) throw new Error('PROFILE_NOT_FOUND');
  const f=(await r.json()).fields||{};
  return {role:f.role?.stringValue,classId:f.classId?.stringValue,active:f.active?.booleanValue===true};
}
async function bridge(payload){
  const r=await fetch(BRIDGE,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow'});
  const t=await r.text(); let d; try{d=JSON.parse(t)}catch{throw new Error('BRIDGE_NOT_READY')};
  if(!r.ok||!d.ok) throw new Error(d?.error||'BRIDGE_ERROR'); return d;
}
export default async function handler(req,res){
  try{
    if(req.method!=='POST') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const {idToken,action,date,records}=req.body||{}; if(!idToken) throw new Error('LOGIN_REQUIRED');
    const email=await verify(idToken),p=await profile(idToken,email);
    if(!p.active||(!ADMIN.has(email)&&String(p.classId)!=='1')) throw new Error('CLASS_NOT_ALLOWED');
    if(!['read','save'].includes(action)) throw new Error('BAD_ACTION');
    const out=await bridge({scope:'ATTENDANCE_TEST',action,classId:'1',date,records:action==='save'?records:undefined,actorEmail:email});
    res.setHeader('cache-control','no-store'); return res.status(200).json({...out,actorEmail:email});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)})}
}
