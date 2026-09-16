// Vercel's existing project emits API .js as CommonJS. Keep ESM helpers dynamic.
module.exports=async function handler(req,res){
 res.setHeader('cache-control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 try{
  const {googleAccessToken,action,classId,slot,results=[]}=req.body||{};
  if(!googleAccessToken)throw Error('LOGIN_REQUIRED');
  const {authenticateScheduler,syncClassWorker,probeSheets}=await import('../lib/survey-sync-worker.mjs');
  const {createSyncStore}=await import('../lib/survey-sync-store.mjs');
  const {surveySlot,SURVEY_SYNC_TIMES}=await import('../survey-sync-core.mjs');
  const idToken=await authenticateScheduler(googleAccessToken),store=createSyncStore(idToken);
  if(action==='probe'){await store.get('settings/surveyBetaConfig');await probeSheets(googleAccessToken);return res.json({ok:true,ownerVerified:true,schedule:SURVEY_SYNC_TIMES});}
  if(typeof slot!=='string'||!Number.isFinite(Date.parse(slot))||surveySlot(new Date(slot))!==slot||Math.abs(Date.now()-Date.parse(slot))>(action==='finish'?172800000:3600000))throw Error('BAD_SLOT');
  if(action==='class')return res.json({ok:true,result:await syncClassWorker({classId,slot,token:googleAccessToken,idToken,store})});
  if(!['start','finish'].includes(action))throw Error('BAD_ACTION');
  const path='settings/surveyAutoSync',old=await store.get(path),now=new Date().toISOString();
  if(old?.data.slot>slot)throw Error('STALE_SLOT');
  let next={enabled:true,schedule:SURVEY_SYNC_TIMES,slot,updatedBy:'hint.kpc@gmail.com'};
  if(action==='start')next={...next,state:'running',startedAt:now,lastSuccessAt:old?.data.lastSuccessAt||''};
  else{
   if(!Array.isArray(results)||results.length>17||new Set(results.map(x=>String(x.classId))).size!==results.length||results.some(x=>!/^([1-9]|1[0-7])$/.test(x.classId)))throw Error('BAD_RESULTS');
   const failed=results.filter(x=>x.error||x.failed>0).length,complete=results.length===17&&!failed;
   next={...next,state:complete?'complete':results.some(x=>x.done>0)?'partial':'failed',startedAt:old?.data.startedAt||'',finishedAt:now,lastSuccessAt:complete?now:old?.data.lastSuccessAt||'',classes:results.map(x=>({classId:String(x.classId),done:Number(x.done)||0,failed:Number(x.failed)||0,changed:Number(x.changed)||0,reads:Number(x.reads)||0,writes:Number(x.writes)||0,error:x.error?String(x.error).replace(/[^A-Z_0-9]/g,'').slice(0,80):'',failures:(x.failures||[]).slice(0,60).map(f=>({eventId:String(f.eventId).slice(0,100),code:String(f.code).replace(/[^A-Z_0-9]/g,'').slice(0,80)}))}))};
  }
  await store.save(path,next,old);return res.json({ok:true,state:next.state});
 }catch(error){const code=/^[A-Z_0-9]+$/.test(error.message)?error.message:'SYNC_FAILED';return res.status(/REQUIRED/.test(code)?403:/^BAD_|STALE_SLOT/.test(code)?400:503).json({ok:false,error:code});}
}
