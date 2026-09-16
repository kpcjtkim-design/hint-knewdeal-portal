// Private Apps Script project, owned and authorized by hint.kpc.
// No web-app deployment, raw-response storage, persistent tokens, or Sheet writes.
const SURVEY_ENDPOINT = 'https://hint-knewdealportal.vercel.app/api/survey-sync';
function surveyDueSlot_(now) {
  const date = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, 'Asia/Seoul', 'HH'));
  const minute = Number(Utilities.formatDate(now, 'Asia/Seoul', 'mm'));
  const m = hour === 18 ? [0,10,20,30].filter(x => x <= minute).pop() : 0;
  return date + 'T' + String(hour).padStart(2,'0') + ':' + String(m).padStart(2,'0') + '+09:00';
}
function surveyCall_(body) {
  const response = UrlFetchApp.fetch(SURVEY_ENDPOINT, {method:'post',contentType:'application/json',payload:JSON.stringify(Object.assign({},body,{googleAccessToken:ScriptApp.getOAuthToken()})),muteHttpExceptions:true});
  let data; try { data=JSON.parse(response.getContentText()); } catch(e) { throw Error('SERVER_BAD_RESPONSE'); }
  if(response.getResponseCode() !== 200 || !data.ok) throw Error(data.error || 'SERVER_'+response.getResponseCode());
  return data;
}
function verifySurveyConnection() {
  if(Session.getEffectiveUser().getEmail() !== 'hint.kpc@gmail.com') throw Error('hint.kpc 계정에서 실행해야 합니다.');
  const result=surveyCall_({action:'probe'});
  console.log('중앙 실행 계정 및 포털 권한 확인 완료. 원본 시트는 읽기 전용입니다.');
  return result;
}
function installSurveyScheduler() {
  verifySurveyConnection();
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='surveySchedulerTick')) ScriptApp.newTrigger('surveySchedulerTick').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().setProperty('SURVEY_ENABLED','true');
  console.log('한국시간 매시간 정각 및 18:10/18:20/18:30 예약 활성화. 실행기는 매분 예정 작업을 확인합니다.');
  surveySchedulerTick();
}
function pauseSurveyScheduler() {
  PropertiesService.getScriptProperties().setProperty('SURVEY_ENABLED','false');
  console.log('예약 실행을 일시 정지했습니다.');
}
function surveySchedulerTick() {
  const props=PropertiesService.getScriptProperties();if(props.getProperty('SURVEY_ENABLED')!=='true')return;
  const lock=LockService.getScriptLock();if(!lock.tryLock(1))return;
  const started=Date.now();
  try {
    const slot=surveyDueSlot_(new Date()),saved=props.getProperty('SURVEY_PENDING');
    let job=saved?JSON.parse(saved):null;
    // Finish an interrupted slot explicitly before starting the next one.
    if(job && job.slot!==slot){surveyCall_({action:'finish',slot:job.slot,results:job.results});props.setProperty('SURVEY_LAST_SLOT',job.slot);props.deleteProperty('SURVEY_PENDING');job=null;}
    if(!job){
      if(props.getProperty('SURVEY_LAST_SLOT')===slot)return;
      job={slot,next:1,results:[],attempts:{}};
      surveyCall_({action:'start',slot});props.setProperty('SURVEY_PENDING',JSON.stringify(job));
    }
    // Checkpoint between classes; continue on the next minute if runtime is short.
    while(job.next<=17 && Date.now()-started<180000){
      const cid=String(job.next);
      try {const result=surveyCall_({action:'class',slot:job.slot,classId:cid}).result;result.failures=(result.failures||[]).slice(0,2);job.results.push(result);job.next++;}
      catch(e){job.attempts[cid]=(job.attempts[cid]||0)+1;if(job.attempts[cid]<2){props.setProperty('SURVEY_PENDING',JSON.stringify(job));console.log('재시도 예약: '+cid+'반 · '+e.message);return;}job.results.push({classId:cid,error:String(e.message).replace(/[^A-Z_0-9]/g,'').slice(0,80)});job.next++;}
      props.setProperty('SURVEY_PENDING',JSON.stringify(job));
    }
    if(job.next>17){const result=surveyCall_({action:'finish',slot:job.slot,results:job.results});props.setProperty('SURVEY_LAST_SLOT',job.slot);props.deleteProperty('SURVEY_PENDING');console.log('동기화 '+result.state+' · '+job.slot+' · '+job.results.length+'개 반');}
  } finally {lock.releaseLock();}
}
