// 2기 담임·운영 화면 ↔ Apps Script 데이터 API 중계. 담임 브라우저는 script.google.com을 직접 부르지 않습니다.
// 환경변수(2기 Vercel 프로젝트): HINT_SHEET_API_URL (2기 마스터시트 Apps Script 웹앱 /exec 주소), HINT_SHEET_API_KEY (setApiKey로 만든 값). 이름은 cohort.json sheetApi.
// 반·관리자·Firebase(2기 전용 프로젝트)·담임 열림은 cohort.json(lib/cohort.cjs)에서 읽습니다. Firebase 설정이 비면 로그인 확인 전에 막습니다.
import cohort from '../lib/cohort.cjs';
const {CLASS_IDS,ADMINS,SHEET_API}=cohort;
const ADMIN=new Set(ADMINS);
// 시험은 이 값을 바꿔 씁니다(cohort.json firebase가 비어 있어도 시험할 수 있게).
export const FIREBASE={key:cohort.FIREBASE_KEY,project:cohort.FIREBASE_PROJECT,ready:cohort.FIREBASE_READY};
// 2기 마스터시트 기능(apps-script/beta2/beta2.gs). 담임에게 열 때도 자기 반으로만 읽고 신청합니다.
// 민원·이슈(b2Voc*)는 담임·운영이 주고받습니다(2026-10-16 회의). 현장운영 체크리스트(portalCheck)는 없어졌습니다.
// 2기는 운영총괄 동기화가 없어 b2SyncNow(가져오기)·b2Release(운영총괄 값으로)를 받지 않습니다(Apps Script에 남아 있어도 웹에서 부르지 않음).
// 모듈 시간(현장교육 일정 O~T, 견학일 지각·조퇴 기준)·교육생 상태·출결대조 메모(2026-10-19, 2기 배포 ① 버전 3): 읽기 3개는 담임도 자기 반만, 쓰기 3개는 관리자만.
const B2_ACTIONS=new Set(['b2Bundle','b2Rev','b2Docs','b2DocCreate','b2Status','b2Save','b2DocUpdate','b2Vocs','b2VocCreate','b2VocReply','b2VocSeen',
 'b2ModuleTimes','b2DayTimes','b2LedgerMemos','b2ModuleTimeSave','b2RosterStatus','b2LedgerMemo']);
const ALLOWED=new Set(['portalData','portalSave','portalClose','portalAddRow','portalUpdateVoc','portalSaveOfficer','portalSetStatus','portalRoster',...B2_ACTIONS]);
// 생년월일·성별이 담긴 명부, 출결 저장·동기화·서류 처리, 교육시간 조정·교육생 상태·출결대조 메모 쓰기는 담임에게 열어도 관리자만 씁니다(Apps Script도 TEACHER를 거절).
const ADMIN_ACTIONS=new Set(['portalRoster','b2Status','b2Save','b2DocUpdate','b2ModuleTimeSave','b2RosterStatus','b2LedgerMemo']);
// 담임 열림: cohort.json teacherAccess(개강 전 false). index.html 담임 로그인도 같은 값을 봅니다.
export const ACCESS={teacher:cohort.TEACHER_ACCESS};
// 담임 화면에 그대로 보이므로 오류는 한국어 문장으로 돌려줍니다.
const FAILURES={
  LOGIN_REQUIRED:[401,'로그인이 필요합니다. 다시 로그인해 주세요.'],
  PROFILE_NOT_FOUND:[403,'계정 정보를 찾지 못했습니다. 운영자에게 문의해 주세요.'],
  ACCESS_DENIED:[403,'2기 화면을 볼 권한이 없습니다.'],
  ADMIN_ONLY:[403,'담임 화면은 개강 준비 중이라 지금은 관리자만 볼 수 있습니다.'],
  FIREBASE_NOT_CONFIGURED:[503,'2기 Firebase 설정 필요: 운영자가 cohort.json에 2기 Firebase 값을 넣으면 열립니다.'],
  NO_CLASS:[403,'담당 반 설정이 없습니다.'],
  BAD_CLASS:[400,'반 번호가 올바르지 않습니다.'],
  BAD_REQUEST:[400,'요청 형식이 올바르지 않습니다.'],
  BAD_ACTION:[400,'지원하지 않는 요청입니다.'],
  DATABASE_QUOTA_EXCEEDED:[503,'계정 확인이 잠시 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'],
  NOT_CONFIGURED:[503,'데이터 API 연결 전입니다. 운영자가 연결을 마치면 바로 사용할 수 있습니다.'],
  SHEET_UNAUTHORIZED:[502,'데이터 API 인증에 실패했습니다. 운영자에게 알려 주세요.'],
  SHEET_TIMEOUT:[504,'마스터시트 응답이 늦습니다. 잠시 후 다시 시도해 주세요.'],
  SHEET_BAD_RESPONSE:[502,'마스터시트 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'],
  SHEET_UNAVAILABLE:[502,'마스터시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.']
};

const scalar=v=>String(v?.stringValue??v?.integerValue??'');
const list=v=>v?.arrayValue?(v.arrayValue.values||[]).map(scalar):null;
// index.html의 teacherClassIds와 같은 규칙: 기본담당반 + 임시담당반(tempClassIds가 있으면 예전 classIds는 무시).
export function teacherClassIds(f){
  const raw=scalar(f.primaryClassId)||scalar(f.classId),primary=CLASS_IDS.includes(raw)?raw:'';
  const explicit=list(f.tempClassIds),temps=(explicit!==null?explicit:list(f.classIds)||[]).filter(x=>CLASS_IDS.includes(x)&&x!==primary);
  return [...new Set([primary,...temps].filter(Boolean))];
}
async function verifyUser(idToken){
  if(!FIREBASE.ready||!FIREBASE.key||!FIREBASE.project)throw new Error('FIREBASE_NOT_CONFIGURED');
  if(!idToken)throw new Error('LOGIN_REQUIRED');
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE.key}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok)throw new Error('LOGIN_REQUIRED');
  const email=String((await r.json()).users?.[0]?.email||'').toLowerCase();
  if(!email)throw new Error('LOGIN_REQUIRED');
  if(ADMIN.has(email))return{email,role:'ADMIN',classIds:CLASS_IDS};
  const p=await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE.project}/databases/(default)/documents/users/${encodeURIComponent(email)}`,{headers:{authorization:`Bearer ${idToken}`}});
  if(p.status===429)throw new Error('DATABASE_QUOTA_EXCEEDED');
  if(!p.ok)throw new Error(p.status===401?'LOGIN_REQUIRED':'PROFILE_NOT_FOUND');
  const f=(await p.json()).fields||{},role=scalar(f.role);
  if(f.active!==undefined&&f.active?.booleanValue!==true)throw new Error('ACCESS_DENIED');
  if(role==='ADMIN')return{email,role,classIds:CLASS_IDS};
  if(role!=='TEACHER')throw new Error('ACCESS_DENIED');
  return{email,role,classIds:teacherClassIds(f)};
}
// 관리자는 미리보기에서 고른 반을 씁니다. 담임은 담당반 밖의 반 번호를 보내면 기본담당반으로 덮어씁니다.
export function resolveClass(user,body,action,args){
  const requested=String(body.cls??(action==='portalSave'?args[0]?.cls:args[0])??'');
  if(user.role==='ADMIN'){if(!CLASS_IDS.includes(requested))throw new Error('BAD_CLASS');return Number(requested);}
  if(!user.classIds.length)throw new Error('NO_CLASS');
  return Number(user.classIds.includes(requested)?requested:user.classIds[0]);
}
// beta2 요청 인자: 반 번호는 서버에서 정합니다(관리자는 고른 반·전체, 담임은 담당반).
export function b2Args(user,action,rest){
  const p=rest[0]&&typeof rest[0]==='object'&&!Array.isArray(rest[0])?{...rest[0]}:{},admin=user.role==='ADMIN';
  const own=c=>{const s=String(c??'');if(admin){if(!CLASS_IDS.includes(s))throw new Error('BAD_CLASS');return s;}if(!user.classIds.length)throw new Error('NO_CLASS');return user.classIds.includes(s)?s:user.classIds[0];};
  if(action==='b2Bundle'){const c=String(rest[0]??'all');return [admin&&c==='all'?'all':own(c)];}
  if(action==='b2Docs'||action==='b2Vocs')return [admin&&!p.cls?{}:{cls:own(p.cls)}];
  if(action==='b2DocCreate'||action==='b2VocCreate')return [{...p,cls:own(p.cls)}];
  // 답글·확인: 담임은 늘 자기 반을 붙여 보내고 Apps Script가 그 건의 반과 맞는지 봅니다. 관리자는 반 없이도 됩니다.
  if(action==='b2VocReply'||action==='b2VocSeen')return [admin&&p.cls===undefined?p:{...p,cls:own(p.cls)}];
  if(action==='b2Rev'||action==='b2Status')return [];
  // 모듈 시간·대조 메모 목록: 담임은 늘 자기 반(cls를 붙임), 관리자는 고른 반이나 반 없이(또는 'all') 전체. 그날 기준(b2DayTimes)은 반이 꼭 있어야 합니다.
  if(action==='b2ModuleTimes'||action==='b2LedgerMemos'){const {cls,...q}=p;return [admin&&(cls===undefined||cls===''||cls==='all')?q:{...q,cls:own(cls)}];}
  // 그날 기준 읽기·관리자 쓰기(모듈 시간·교육생 상태·대조 메모): 반 번호를 서버에서 확인해 붙입니다.
  if(['b2DayTimes','b2ModuleTimeSave','b2RosterStatus','b2LedgerMemo'].includes(action))return [{...p,cls:own(p.cls)}];
  return [{...p,...(p.cls!==undefined?{cls:own(p.cls)}:{})}];
}
export function vocForTeacher(voc,classIds){
 const pick=o=>Object.fromEntries(Object.entries(o||{}).filter(([k])=>classIds.includes(String(k))));
 return {rev:voc.rev,at:voc.at,teacher:pick(voc.teacher),open:pick(voc.open)};
}
async function callSheet(action,args,extra={}){
  const url=process.env[SHEET_API.urlEnv],key=process.env[SHEET_API.keyEnv];
  if(!url||!key)throw new Error('NOT_CONFIGURED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
  try{
    // Apps Script는 302로 결과 주소를 돌려주므로 redirect를 따라가야 합니다.
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,action,args,...extra}),redirect:'follow',signal:controller.signal});
    const text=await r.text();let data;
    try{data=JSON.parse(text);}catch{throw new Error('SHEET_BAD_RESPONSE');}
    if(data?.ok===false&&data.error==='unauthorized')throw new Error('SHEET_UNAUTHORIZED');
    return data;
  }catch(e){if(controller.signal.aborted)throw new Error('SHEET_TIMEOUT');if(e instanceof TypeError)throw new Error('SHEET_UNAVAILABLE');throw e;}
  finally{clearTimeout(timer);}
}
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST만 지원합니다.'});
    let body=req.body||{};
    if(typeof body==='string'){try{body=JSON.parse(body||'{}');}catch{throw new Error('BAD_REQUEST');}}
    const bearer=String(req.headers?.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1];
    const user=await verifyUser(bearer||body.idToken);
    if(user.role!=='ADMIN'&&(!ACCESS.teacher||ADMIN_ACTIONS.has(body.action)))throw new Error('ADMIN_ONLY');
    const {action}=body,rest=Array.isArray(body.args)?body.args:[];
    if(!ALLOWED.has(action))throw new Error('BAD_ACTION');
    if(JSON.stringify(rest).length>20000)throw new Error('BAD_REQUEST');
    let out;
    if(B2_ACTIONS.has(action))out=await callSheet(action,b2Args(user,action,rest),{actor:user.email,role:user.role});
    else{
      const cls=resolveClass(user,body,action,rest);
      const args=action==='portalSave'?[{...(rest[0]&&typeof rest[0]==='object'?rest[0]:{}),cls,pin:''}]:[cls,'',...rest.slice(2)];
      out=await callSheet(action,args);
    }
    if(!out?.ok&&out?.error==='unknown action')return res.status(400).json({ok:false,code:'SHEET_OUTDATED',error:'마스터시트 데이터 API에 아직 없는 기능입니다. Apps Script를 새 코드로 다시 배포해 주세요.'});
    // 민원·이슈 알림 건수: 담임에게는 자기 반 건수만 보냅니다.
    if(out?.ok&&user.role!=='ADMIN'&&out.data?.voc)out.data.voc=vocForTeacher(out.data.voc,user.classIds);
    return res.status(out?.ok?200:400).json(out?.ok?{ok:true,data:out.data}:{ok:false,error:String(out?.error||'요청을 처리하지 못했습니다.')});
  }catch(e){
    const [status,error]=FAILURES[e.message]||[500,'요청을 처리하지 못했습니다.'];
    if(!FAILURES[e.message])console.error('teacher_beta',e);
    return res.status(status).json({ok:false,code:FAILURES[e.message]?e.message:'UNEXPECTED',error});
  }
}
