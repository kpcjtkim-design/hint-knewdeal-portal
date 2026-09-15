const classKey=value=>String(value??'').trim();
const teacherName=value=>{
  const name=String(value??'').trim();
  return name&&!/[\n_():\[\]]/.test(name)?name:'';
};
const unique=names=>[...new Set(names.filter(Boolean))];
const primaryClass=profile=>{
  const explicit=classKey(profile.primaryClassId||profile.classId);
  if(explicit)return explicit;
  // Legacy multi-class access is not itself a homeroom assignment.
  const temporary=(profile.tempClassIds||[]).map(classKey);
  const candidates=unique((profile.classIds||[]).map(classKey).filter(id=>!temporary.includes(id)));
  return candidates.length===1?candidates[0]:'';
};
const recordedNames=(records,classId)=>unique(records.filter(r=>classKey(r.classId)===classKey(classId)).map(r=>teacherName(r.teacher)));

export function resolveClassTeacher({classId,users=[],records=[],record,history=[]}){
  const individual=record&&classKey(record.classId)===classKey(classId)?teacherName(record.teacher):'';
  if(individual)return individual;
  const dayNames=recordedNames(records,classId);
  if(dayNames.length===1)return dayNames[0];
  const assigned=unique(users.filter(p=>p.active!==false&&p.role==='TEACHER'&&primaryClass(p)===classKey(classId)).map(p=>teacherName(p.name)));
  if(assigned.length===1)return assigned[0];
  const historical=recordedNames(history,classId);
  // A saved class teacher can disambiguate duplicate/test accounts, but never
  // override an unambiguous current primary assignment or select another class.
  if(historical.length===1&&(!assigned.length||assigned.includes(historical[0])))return historical[0];
  return '';
}

export function createTeacherResolver({loadUsers,loadHistory,now=Date.now,ttl=300000}){
  let users=[],usersAt=-Infinity,usersPending;
  const histories=new Map(),pending=new Map();
  const get=(classId,records=[],record)=>resolveClassTeacher({classId,users,records,record,history:histories.get(classKey(classId))?.records||[]});
  async function refresh(classId,records=[]){
    if(now()-usersAt>=ttl){
      if(!usersPending)usersPending=Promise.resolve().then(loadUsers).then(data=>{users=data;usersAt=now();}).finally(()=>{usersPending=null;});
      // Retain known names during a transient read failure; retry on next refresh.
      await usersPending.catch(()=>{});
    }
    const id=classKey(classId);
    if(resolveClassTeacher({classId:id,users,records}))return;
    if(now()-(histories.get(id)?.at??-Infinity)<ttl)return;
    if(!pending.has(id))pending.set(id,Promise.resolve().then(()=>loadHistory(id)).then(data=>{histories.set(id,{records:data,at:now()});}).finally(()=>pending.delete(id)));
    await pending.get(id).catch(()=>{});
  }
  return {get,refresh};
}
