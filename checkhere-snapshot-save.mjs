const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const same=(data,batch)=>data?.classId===batch.classId&&data?.date===batch.date&&canonical(data.records)===canonical(batch.records);

// Content-addressed, immutable batches make repeated clicks and uncertain network
// responses safe to retry. Storage adapters must read from the server, not cache.
export function createSnapshotSaver({read,write,hash=digest}){
  return async function save(records,job,{onProgress=()=>{}}={}){
    if(!records.length)throw Error('저장할 수집 기록이 없습니다.');
    const groups=new Map();
    for(const original of records){
      const {audit,...rest}=original,r=JSON.parse(JSON.stringify(rest));
      if(!/^(?:[1-9]|1[0-7])$/.test(String(r.classId))||!/^2026-\d{2}-\d{2}$/.test(r.date)||!r.id||!r.version||!Number.isFinite(Date.parse(r.collectedAt))||r.source!=='live')throw Error('반·날짜·수집 시각이 확인된 PC 수집 기록만 저장할 수 있습니다.');
      r.classId=String(r.classId);const key=r.classId+'/'+r.date;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
    }
    const batches=[];
    for(const [scope,rows] of groups){
      rows.sort((a,b)=>a.id.localeCompare(b.id));
      if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error(scope+' · 중복 학생 기록을 확인해 주세요.');
      let chunk=[],bytes=0;
      const add=()=>{if(chunk.length)batches.push({classId:rows[0].classId,date:rows[0].date,records:chunk});chunk=[];bytes=0;};
      for(const row of rows){const size=new TextEncoder().encode(canonical(row)).length;if(size>700000)throw Error(scope+' · 한 학생의 기록이 저장 한도를 초과했습니다.');if(chunk.length&&(bytes+size>700000||chunk.length>=100))add();chunk.push(row);bytes+=size;}add();
    }
    let verifiedRecords=0,verifiedBatches=0;
    for(const batch of batches){
      const progress={totalRecords:records.length,totalBatches:batches.length,classId:batch.classId,date:batch.date};
      const id=`v2_${batch.date}_${await hash(canonical(batch))}`;
      try{
        onProgress({...progress,verifiedRecords,verifiedBatches,phase:'saving'});
        const existing=await read(batch.classId,id);
        if(existing){if(!same(existing,batch))throw Error('기존 저장본 내용이 달라 확인이 필요합니다.');}
        else{
          let writeError;try{await write(batch.classId,id,{...batch,jobId:job.id,jobStatus:job.status,source:'checkhere-windows-bridge-v0.2'});}catch(e){writeError=e;}
          onProgress({...progress,verifiedRecords,verifiedBatches,phase:'verifying'});
          const confirmed=await read(batch.classId,id);
          if(!same(confirmed,batch))throw Error(writeError?'저장 결과를 서버에서 확인하지 못했습니다. '+writeError.message:'서버에서 다시 읽은 내용이 수집 기록과 다릅니다.');
        }
        verifiedRecords+=batch.records.length;verifiedBatches++;
        onProgress({...progress,verifiedRecords,verifiedBatches,phase:'verified'});
      }catch(e){throw Object.assign(Error(`DB 저장 확인 ${verifiedRecords}/${records.length}건 · ${batch.classId}반 ${batch.date} 확인 실패\n${e.message}\nPC 수집 기록은 유지됩니다. ‘플랫폼에 저장’을 다시 누르면 확인된 기록은 중복 저장하지 않습니다.`),{verifiedRecords,totalRecords:records.length,classId:batch.classId,date:batch.date});}
    }
    return {verified:true,recordCount:verifiedRecords,batchCount:verifiedBatches,partialCount:records.filter(r=>r.readState!=='complete').length};
  };
}
