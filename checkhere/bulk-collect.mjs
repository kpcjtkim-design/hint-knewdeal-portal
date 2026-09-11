export async function runCollectionQueue({classIds,dates,api,refresh,stopped=()=>false,onProgress=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  const tasks=classIds.flatMap(classId=>dates.map(date=>({classId:String(classId),date}))),results=[];
  for(const task of tasks){
    if(stopped())break;
    onProgress({total:tasks.length,completed:results.length,...task});
    // One class/day per existing server job: a missing lecture cannot discard
    // the rest of the class, and every completed day can be archived.
    const started=await api('sync',{classId:task.classId,dates:[task.date]});
    let job;do{const state=await refresh();job=state.jobs.find(x=>x.id===started.id);if(!job)throw Error('수집 작업 결과를 찾지 못했습니다. 중복 수집 없이 상태를 다시 확인해 주세요.');if(job.status==='running')await sleep(1500);}while(job.status==='running');
    results.push({...task,status:job.status,count:job.count||0,message:job.message||''});
    onProgress({total:tasks.length,completed:results.length,...task,results});
    if(job.status==='cancelled')break;
  }
  return {total:tasks.length,results,stopped:stopped()};
}
