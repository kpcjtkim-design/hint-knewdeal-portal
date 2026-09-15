const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function mergeCurrentRecords(previous,incoming,classId,date){
 const rows=new Map();
 for(const r of [...previous,...incoming]){
  if(String(r.classId)!==String(classId)||r.date!==date||!r.id)throw Error('저장본의 반·날짜·학생 식별자를 확인해 주세요.');
  const old=rows.get(r.id);
  if(!old||String(r.collectedAt)>String(old.collectedAt))rows.set(r.id,r);
  else if(r.collectedAt===old.collectedAt&&canonical(r)!==canonical(old))throw Error('동일 수집 시각의 기록이 서로 다릅니다. 다시 수집해 주세요.');
 }
 const result=[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
 if(result.length>1000||new TextEncoder().encode(canonical(result)).length>850000)throw Error('하루 저장본의 크기 한도를 초과했습니다. PC 기록은 유지됩니다.');
 return result;
}
export function containsSavedRecords(saved,incoming){
 const byId=new Map(saved.map(r=>[r.id,r]));
 return incoming.every(r=>canonical(byId.get(r.id))===canonical(r));
}
// Only the explicit platform-save action calls this. Page reads never write.
export function createCurrentSaver({read,readLegacy,commit,onSaved=()=>{}}){
 return async(records,job,{onProgress=()=>{}}={})=>{
  if(!records.length)throw Error('저장할 수집 기록이 없습니다.');
  const groups=new Map();
  for(const original of records){
   const {audit,...rest}=original,r=JSON.parse(JSON.stringify(rest));r.classId=String(r.classId);
   if(!/^(?:[1-9]|1[0-7])$/.test(r.classId)||!/^2026-\d{2}-\d{2}$/.test(r.date)||!r.id||!r.version||!Number.isFinite(Date.parse(r.collectedAt))||r.source!=='live')throw Error('PC에서 수집한 반·날짜·시간이 확인된 기록만 저장할 수 있습니다.');
   const key=r.classId+'/'+r.date;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
  }
  let verifiedRecords=0,verifiedBatches=0;
  for(const rows of groups.values()){
   const {classId,date}=rows[0],progress={classId,date,totalRecords:records.length,totalBatches:groups.size};
   try{
    if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('같은 날짜에 중복된 학생 기록이 있습니다.');
    onProgress({...progress,verifiedRecords,verifiedBatches,phase:'saving'});
    const old=await read(classId,date);
    if(!containsSavedRecords(old?.records||[],rows)){
     const legacy=old?[]:await readLegacy(classId,date);
     let error;try{await commit(classId,date,rows,legacy,job);}catch(e){error=e;}
     onProgress({...progress,verifiedRecords,verifiedBatches,phase:'verifying'});
     const confirmed=await read(classId,date);
     if(!containsSavedRecords(confirmed?.records||[],rows))throw error||Error('서버 저장값이 수집 기록과 다릅니다. 더 최신 수집본이 있는지도 확인해 주세요.');
    }
    verifiedRecords+=rows.length;verifiedBatches++;onSaved(classId,date);
    onProgress({...progress,verifiedRecords,verifiedBatches,phase:'verified'});
   }catch(e){throw Object.assign(Error(`DB 저장 확인 ${verifiedRecords}/${records.length}건 · ${classId}반 ${date} 확인 실패\n${e.message}\nPC 기록은 유지됩니다. 다시 저장하면 이미 확인된 기록은 중복 저장하지 않습니다.`),{verifiedRecords,totalRecords:records.length,classId,date});}
  }
  return {verified:true,recordCount:verifiedRecords,batchCount:verifiedBatches,partialCount:records.filter(r=>r.readState!=='complete').length};
 };
}
