import defaultCatalog from '../survey-catalog.json' with {type:'json'};
import {createHash} from 'node:crypto';
import {FIREBASE_KEY} from '../checkhere/firebase-public.mjs';
import {createSurveyReader} from '../survey-google.mjs';
import {eventsForClass,sourceCandidates,surveyAttendanceDates,summarizeResponses,SURVEY_ATTENDANCE_VERSION} from '../survey-core.mjs';
import {summarizeScores} from '../survey-scores.mjs';
import {deriveAttendanceClass,targetsFromDerived} from '../attendance-derived-core.mjs';
import {isoLabel,koreaToday,latestSnapshots} from '../attendance-beta-core.mjs';
import {stableSurveyPayload,derivedFingerprint} from '../survey-sync-core.mjs';
import {createSyncStore} from './survey-sync-store.mjs';
const owner='hint.kpc@gmail.com',origin='https://hint-knewdealportal.vercel.app',readers=new Map(),sessions=new Map();
export async function jsonRequest(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(45000)});let d;try{d=await r.json();}catch{throw Error('UPSTREAM_BAD_RESPONSE');}if(!r.ok){const reason=d.error?.details?.find(x=>x.reason)?.reason||String(d.error?.message||'').split(' : ')[0];throw Error(/^[A-Z_]+$/.test(reason)?reason:'UPSTREAM_'+r.status);}return d;}
export async function probeSheets(token){const url=defaultCatalog.responseSources.find(x=>x.sheetUrl)?.sheetUrl,id=url?.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];if(!id)throw Error('RESPONSE_LINK_REQUIRED');await jsonRequest(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId`,{headers:{authorization:'Bearer '+token}});}
export async function authenticateScheduler(token){
 if(typeof token!=='string'||token.length<20||token.length>5000)throw Error('LOGIN_REQUIRED');
 const key=createHash('sha256').update(token).digest('hex'),cached=sessions.get(key);if(cached&&Date.now()-cached.at<60000)return cached.idToken;
 const info=await jsonRequest('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{authorization:'Bearer '+token}});
 if(info.email!==owner||info.email_verified!==true)throw Error('SCHEDULER_OWNER_REQUIRED');
 const d=await jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestUri:origin,postBody:new URLSearchParams({providerId:'google.com',access_token:token}).toString(),returnSecureToken:true})});
 if(d.email!==owner||!d.idToken)throw Error('LOGIN_REQUIRED');
 sessions.clear();sessions.set(key,{idToken:d.idToken,at:Date.now()});return d.idToken;
}
async function readerFor(slot,token){
 for(const [key,v]of readers)if(Date.now()-v.at>600000){v.reader.clear();readers.delete(key);}
 const key=slot+createHash('sha256').update(token).digest('hex');if(readers.has(key))return readers.get(key).reader;
 if(readers.size>=3){for(const v of readers.values())v.reader.clear();readers.clear();}
 const reader=createSurveyReader(async()=>token);await reader.connect();readers.set(key,{reader,at:Date.now()});return reader;
}
export async function syncClassWorker({classId,slot,token,idToken,store=createSyncStore(idToken),readSheet,reader,catalog,now=new Date()}){
 const cid=String(classId);if(!/^([1-9]|1[0-7])$/.test(cid))throw Error('BAD_CLASS');
 catalog??=defaultCatalog;
 const [configDoc,tt,clazz,previous]=await Promise.all([store.get('settings/surveyBetaConfig'),store.get('timetableBetaPublished/'+cid),store.get('classes/'+cid),store.get('attendanceBetaSummaries/'+cid)]);
 const config=configDoc?.data||{},entries=tt?.data.entries||[],today=koreaToday(now),events=eventsForClass(catalog,cid,entries).map(e=>{const c=config.events?.[e.id]||{},candidates=sourceCandidates(e,catalog.responseSources,clazz?.data.course||'');return{...e,date:c.date||e.date,config:c,source:catalog.responseSources.find(s=>s.id===c.sourceId)||(candidates.length===1?candidates[0]:null),url:c.url||e.url||''};}).filter(e=>e.date<=today);
 if(!events.length)return {classId:cid,done:0,failed:0,changed:0,reads:store.metrics.reads,writes:0};
 const sheet=readSheet?await readSheet(cid):await jsonRequest(origin+'/api/attendance-reader',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({classId:cid,idToken,allowCache:true})});
 if(!sheet?.ok&& !Array.isArray(sheet?.attendance))throw Error('ATTENDANCE_UNAVAILABLE');
 const a=sheet.attendance,recognizedDates=(a[0]||[]).flatMap((v,i)=>i>=4&&isoLabel(v)&&isoLabel(v)<=today&&a.slice(1).some(r=>String(r[i]||'').trim()==='인정출석')?[isoLabel(v)]:[]);
 // Only days requiring recognized-status evidence need metadata/snapshot reads.
 const paths=recognizedDates.flatMap(d=>[`settings/attendanceBeta_${cid}_${d}`,`classes/${cid}/checkhereCurrent/${d}`]),evidence=await store.batch(paths),metadata={},records=[];
 for(const d of recognizedDates){metadata[d]=evidence.get(`settings/attendanceBeta_${cid}_${d}`)?.data.students||{};const current=evidence.get(`classes/${cid}/checkhereCurrent/${d}`);if(current)records.push(...(current.data.records||[]));else{const legacy=await store.query(`classes/${cid}`,'checkhereSnapshots','date',d);records.push(...latestSnapshots(legacy.flatMap(x=>x.data.records||[]),cid,d));}}
 const derived=deriveAttendanceClass(sheet,{classId:cid,metadata,records,entries,today});derived.fingerprint=derivedFingerprint(derived);
 if(previous?.data.fingerprint!==derived.fingerprint)await store.save('attendanceBetaSummaries/'+cid,{...derived,syncedAt:now.toISOString(),updatedBy:owner},previous);
 const summaries=new Map((await store.list(`surveyBetaSummaries/${cid}/surveys`)).map(x=>[x.path.split('/').at(-1),x]));
 reader??=await readerFor(slot,token);let done=0,changed=0;const failures=[];
 for(const e of events){try{
  if(!e.scheduleMatched&&!e.config.date)throw Error('SCHEDULE_LINK_REQUIRED');if(!e.source)throw Error('RESPONSE_LINK_REQUIRED');
  let targets;try{targets=targetsFromDerived(derived,surveyAttendanceDates(e,entries,e.date));}catch{throw Error('ATTENDANCE_DATES_REQUIRED');}
  const responses=await reader.responses(e.source.sheetUrl),summary=summarizeResponses({classId:cid,targets,responses});
  const next={...summary,scores:summarizeScores(responses,cid,summary.answered,{scale:Number(e.config.scale||5)}),classId:cid,eventId:e.id,title:e.title,date:e.date,sourceId:e.source.id,url:e.url,syncedAt:now.toISOString(),attendanceFingerprint:SURVEY_ATTENDANCE_VERSION+derived.fingerprint,scheduleFingerprint:JSON.stringify(entries.filter(x=>e.lessonIds.includes(x.id)).map(x=>[x.id,x.date,x.title,x.day])),updatedBy:owner};
  const old=summaries.get(e.id);if(!old||stableSurveyPayload(old.data)!==stableSurveyPayload(next)){await store.save(`surveyBetaSummaries/${cid}/surveys/${e.id}`,next,old);changed++;}done++;
 }catch(error){failures.push({eventId:e.id,code:/^[A-Z_0-9]+$/.test(error.message)?error.message:'RESPONSE_READ_FAILED'});}}
 return {classId:cid,done,changed,failed:failures.length,failures,reads:store.metrics.reads,writes:store.metrics.writes};
}
