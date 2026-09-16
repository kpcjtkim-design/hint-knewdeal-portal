// One central scheduler owns these slots. Browsers never start scheduled runs.
export const SURVEY_SYNC_TIMES='매시간 정각 + 매일 18:10 · 18:20 · 18:30 (한국시간)';
export function surveySlot(now=new Date()){
 const k=new Date(now.getTime()+9*3600000),date=k.toISOString().slice(0,10),hour=k.getUTCHours(),minute=k.getUTCMinutes();
 const m=hour===18?[0,10,20,30].filter(x=>x<=minute).at(-1):0;
 return `${date}T${String(hour).padStart(2,'0')}:${String(m).padStart(2,'0')}+09:00`;
}
export function stableSurveyPayload(data){return JSON.stringify(data,(k,v)=>['syncedAt','updatedAt','updatedBy','classId','eventId'].includes(k)?undefined:v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
export function derivedFingerprint(result){const bytes=new TextEncoder().encode(JSON.stringify(result));let hash=2166136261;for(const n of bytes)hash=Math.imul(hash^n,16777619);return(hash>>>0).toString(16)+':'+bytes.length;}
export function syncStateText(state){
 if(!state?.enabled)return '자동 동기화 연결 준비 중';
 const last=state.finishedAt?new Date(state.finishedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
 if(state.state==='running')return `자동 동기화 진행 중 · 예정 ${state.slot?.slice(11,16)||''}`;
 return `${SURVEY_SYNC_TIMES} · ${last?'최근 실행 '+last:'첫 실행 대기'}${state.state==='partial'?' · 일부 반/설문 확인 필요':state.state==='failed'?' · 실행 실패':''}`;
}
