// 체크히어 2기 처음 설치 모드(이 PC만, 연결 프로그램 화면 /setup): 반마다 체크히어 강의 연결·교육생 명단(이 PC에 불러옴 또는 등록됨)을 보고,
// 사람이 마스킹을 해제한 동안 반마다 한 번 원문으로 읽어 명단과 체크히어 학생 번호(attendeeId)를 맞춥니다(맞음·명단에 없음·명단에만·겹침 수).
// 사람이 연결을 고치고 반마다 「이 반 확인」을 누르면 확인 목록(이름·끝 4자리·학생 번호)을 이 PC SQLite에 둡니다.
// 등록: 승인 계정으로 로그인한 운영포털 실시간 화면이 /api/identities/register를 부르면 그 로그인 토큰으로 2기 Firestore checkhereIdentities/{반}(관리자만)에 REST로 씁니다.
// 이름·끝 4자리는 이 PC 화면·이 PC SQLite·등록 문서·내보내기 CSV에만 갑니다. 작업 글·중계 신호·로그에는 수만 넣습니다. 생년월일·전체 전화번호는 등록·내보내기에 넣지 않습니다.
import {randomBytes} from 'node:crypto';
import {hasMask} from './masking.mjs';
import {CLASS_IDS,classOk} from './cohort-bridge.mjs';
export const ATTENDEE_ID=/^[A-Za-z0-9][\w-]{0,79}$/;
// 반 하나에 등록하는 학생 수 한도(정원 30·31명 + 여유, 2기 Firestore 규칙 checkhereIdentities students.size() <= 40과 같음)
export const MAX_STUDENTS=40;
export const SETUP_TEXT={
  UNMASK:'SETUP_UNMASK: 반별 확인은 체크히어 원문 화면에서만 합니다. 연결 프로그램이 연 체크히어 창(같은 탭)에서 사람이 마스킹을 해제한 뒤 다시 눌러 주세요(이 화면의 「마스킹 해제 시작」도 됨).',
  TIME:'SETUP_TIME: 체크히어 해제 남은 시간이 1분보다 적습니다. 체크히어 창에서 연장(또는 다시 해제)한 뒤 「이어서 확인」을 눌러 주세요. 연장·다시 해제는 사람이 정합니다.',
  MASKED:'SETUP_MASKED: 이 반을 읽는 동안 체크히어 화면이 원문이 아니어서 확인하지 못했습니다. 해제한 뒤 이 반을 다시 확인해 주세요.',
  NONE:'이 반은 아직 원문으로 확인하지 않았습니다. 마스킹을 해제한 뒤 「반별 확인」으로 먼저 읽어 주세요.',
};
const now=()=>new Date().toISOString();
const token=()=>randomBytes(6).toString('hex');
const sig=(name,last4)=>String(name??'').trim()+'|'+String(last4??'');
// 원문으로 읽은 그날 표(rows: [{name, phoneLast4, studentKey, attendeeId, odd?, conflict?}]) → 저장할 확인 결과(이 PC SQLite, 학생 번호 포함).
// pairs: {학생 번호: 명단 학생 키}(사람이 고른 짝), exclude: [학생 번호](등록에서 뺄 줄). 다시 읽어도 학생 번호로 이어 갑니다.
export function buildReport({classId,date,rows,view='plain',at=now(),pairs={},exclude=[]}){
  const list=(rows||[]).map(r=>({token:token(),attendeeId:typeof r.attendeeId==='string'&&ATTENDEE_ID.test(r.attendeeId)?r.attendeeId:null,name:String(r.name??'').trim(),last4:String(r.phoneLast4??r.last4??''),studentKey:String(r.studentKey||''),...(r.odd?{odd:true}:{}),...(r.conflict?{conflict:true}:{})}));
  const ids=new Set(list.map(r=>r.attendeeId).filter(Boolean));
  return {classId:String(classId),date,at,view,rows:list,pairs:Object.fromEntries(Object.entries(pairs||{}).filter(([a])=>ids.has(a))),exclude:(exclude||[]).filter(a=>ids.has(a))};
}
// 줄마다 상태(명단과 비교, 이 PC 화면용). 순서: 사람이 고른 짝 → 같은 학생 키(전체 번호 명단·원문 키) → 같은 이름·끝 4자리가 명단·그날 표에서 하나.
// matched(맞음) · paired(사람이 고름) · unmatched(명단에 없음, 체크히어에만) · checkhere(명단 없이 체크히어 명단 그대로) · ambiguous(겹침·전화 안 보임·연결 충돌) · noid(학생 번호 못 읽음, 등록 안 됨)
export function classify(report,roster=[]){
  const byKey=new Map(roster.map(e=>[e.studentKey,e])),bySig=new Map(),today=new Map(),claimed=new Map(),out=new Map();
  for(const e of roster){const s=sig(e.name,e.last4);if(!bySig.has(s))bySig.set(s,[]);bySig.get(s).push(e);}
  for(const r of report.rows){const s=sig(r.name,r.last4);today.set(s,(today.get(s)||0)+1);}
  const claim=(r,e,status)=>{claimed.set(e.studentKey,r.token);out.set(r.token,{status,entry:e});};
  for(const r of report.rows){const e=r.attendeeId?byKey.get(report.pairs?.[r.attendeeId]):null;if(e&&!claimed.has(e.studentKey))claim(r,e,'paired');}
  for(const r of report.rows){if(out.has(r.token)||!r.attendeeId)continue;const e=byKey.get(r.studentKey);if(e&&!claimed.has(e.studentKey))claim(r,e,'matched');}
  for(const r of report.rows){
    if(out.has(r.token))continue;
    if(!r.attendeeId){out.set(r.token,{status:'noid',reason:'학생 번호를 읽지 못함'});continue;}
    if(r.odd){out.set(r.token,{status:'ambiguous',reason:'전화가 다 보이지 않음'});continue;}
    if(!roster.length){out.set(r.token,{status:'checkhere'});continue;}
    const hit=(bySig.get(sig(r.name,r.last4))||[]).filter(e=>!claimed.has(e.studentKey));
    if(!hit.length){out.set(r.token,{status:'unmatched',reason:(bySig.get(sig(r.name,r.last4))||[]).length?'같은 명단 학생이 이미 다른 줄과 맞음':'명단에 없음'});continue;}
    if(hit.length===1&&!hit[0].dup&&today.get(sig(r.name,r.last4))===1){claim(r,hit[0],'matched');continue;}
    out.set(r.token,{status:'ambiguous',reason:hit.length>1||hit[0].dup?'명단에 같은 이름·끝 4자리가 둘 이상':'그날 표에 같은 이름·끝 4자리가 둘'});
  }
  for(const r of report.rows)if(r.conflict&&out.get(r.token))out.get(r.token).conflict=true;
  return {byToken:out,missing:roster.filter(e=>!claimed.has(e.studentKey))};
}
const includable=r=>!!r.attendeeId&&/^\d{4}$/.test(r.last4)&&!!r.name&&!hasMask(r.name)&&r.name.length<=60;
// 확인 목록(등록할 학생): 학생 번호가 있고 빼지 않은 줄. 명단과 맞은 줄은 명단의 이름·끝 4자리(시트와 같은 이름), 나머지는 체크히어 원문 이름·끝 4자리.
export function confirmList(report,roster=[]){
  const {byToken}=classify(report,roster),skip=new Set(report.exclude||[]);
  return report.rows.filter(r=>includable(r)&&!skip.has(r.attendeeId)&&byToken.get(r.token)?.status!=='noid').map(r=>{const e=byToken.get(r.token)?.entry;return {name:e?e.name:r.name,last4:e?e.last4:r.last4,attendeeId:r.attendeeId};});
}
// 수(작업 글·운영포털 요약용, 이름 없음)
export function reportCounts(report,roster=[]){
  const {byToken,missing}=classify(report,roster),n=s=>[...byToken.values()].filter(x=>x.status===s).length;
  return {total:report.rows.length,matched:n('matched')+n('paired'),unmatched:n('unmatched')+n('checkhere'),ambiguous:n('ambiguous')+n('noid'),missing:missing.length,included:confirmList(report,roster).length,roster:roster.length};
}
// 이 PC 화면용 보기(이름·끝 4자리·생년월일 있음, 학생 번호 없음 — 줄은 token으로 고릅니다). 짝 후보: 명단에만 있는 학생 중 이름이나 끝 4자리가 같은 학생(없으면 명단에만 있는 학생 모두).
export function reportView(report,roster=[]){
  const {byToken,missing}=classify(report,roster),skip=new Set(report.exclude||[]);
  const plain=e=>({studentKey:e.studentKey,name:e.name,last4:e.last4,birth:e.birth||'',dup:!!e.dup});
  const rows=report.rows.map(r=>{
    const c=byToken.get(r.token)||{status:'noid'},e=c.entry,open=['unmatched','ambiguous','checkhere'].includes(c.status)&&!!r.attendeeId;
    const near=open?missing.filter(m=>m.name===r.name||m.last4===r.last4):[];
    return {token:r.token,name:r.name,last4:r.last4,status:c.status,reason:c.reason||'',conflict:!!c.conflict,included:includable(r)&&!skip.has(r.attendeeId)&&c.status!=='noid',
      ...(e?{roster:plain(e)}:{}),...(open?{candidates:(near.length?near:missing).map(plain)}:{})};
  });
  return {classId:report.classId,date:report.date,at:report.at,counts:reportCounts(report,roster),rows,missing:missing.map(plain)};
}
// 사람이 고른 짝: 명단에 없는(또는 겹친) 줄 ↔ 명단에만 있는 학생. 이름이나 끝 4자리 하나는 같아야 합니다(둘 다 다르면 다른 학생일 가능성이 커서 막음).
export function pairRow(report,roster,tokenId,studentKey){
  const row=report.rows.find(r=>r.token===tokenId),entry=roster.find(e=>e.studentKey===studentKey);
  if(!row||!row.attendeeId)throw Error('짝지을 체크히어 줄을 찾지 못했습니다. 화면을 새로 고쳐 주세요.');
  if(!entry)throw Error('명단 학생을 찾지 못했습니다. 명단을 다시 확인해 주세요.');
  const {byToken,missing}=classify(report,roster),st=byToken.get(row.token)?.status;
  if(!['unmatched','ambiguous','checkhere'].includes(st))throw Error('이미 명단과 맞은 줄입니다.');
  if(!missing.some(m=>m.studentKey===studentKey))throw Error('그 명단 학생은 이미 다른 줄과 맞았습니다.');
  if(entry.name!==row.name&&entry.last4!==row.last4)throw Error('이름과 끝 4자리가 둘 다 달라 짝지을 수 없습니다. 명단을 고쳐 다시 불러와 주세요.');
  report.pairs={...report.pairs,[row.attendeeId]:studentKey};return report;
}
export function unpairRow(report,tokenId){const row=report.rows.find(r=>r.token===tokenId);if(row?.attendeeId){const p={...report.pairs};delete p[row.attendeeId];report.pairs=p;}return report;}
// 등록 전 검사: 학생마다 이름(가린 글자 없음)·끝 4자리·학생 번호만 남깁니다(생년월일·전화 등 다른 칸은 버림). 학생 번호가 겹치면 거절.
export function cleanStudents(list){
  if(!Array.isArray(list)||!list.length)throw Error('등록할 학생이 없습니다. 반별 확인을 먼저 해 주세요.');
  if(list.length>MAX_STUDENTS)throw Error(`한 반에 ${MAX_STUDENTS}명보다 많아 등록하지 않았습니다.`);
  const out=list.map(s=>({name:String(s?.name??'').trim(),last4:String(s?.last4??''),attendeeId:String(s?.attendeeId??'')}));
  if(out.some(s=>!s.name||s.name.length>60||hasMask(s.name)||!/^\d{4}$/.test(s.last4)||!ATTENDEE_ID.test(s.attendeeId)))throw Error('확인 목록의 이름·끝 4자리·체크히어 학생 번호를 확인해 주세요(가린 글자는 등록하지 않음).');
  if(new Set(out.map(s=>s.attendeeId)).size!==out.length)throw Error('같은 체크히어 학생 번호가 두 번 들어 있습니다. 반별 확인을 다시 해 주세요.');
  return out;
}
// 내보내기(이 PC 화면만): 확인 목록 CSV(반, 이름, 끝 4자리, 체크히어 학생 번호) 또는 시트에 붙여 넣는 탭 구분 글.
const cell=v=>{const t=String(v??'');return /[",\r\n]/.test(t)?`"${t.replace(/"/g,'""')}"`:t;};
export function exportText(byClass,{tab=false}={}){
  const head=['반','이름','전화끝4자리','체크히어ID'],rows=[];
  for(const classId of CLASS_IDS)for(const s of [...(byClass.get(classId)||[])].sort((a,b)=>a.name.localeCompare(b.name,'ko')))rows.push([classId,s.name,s.last4,s.attendeeId]);
  return [head,...rows].map(r=>tab?r.map(v=>String(v).replace(/[\t\r\n]/g,' ')).join('\t'):r.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function createSetupStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS setup_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS setup_checks(classId TEXT PRIMARY KEY, date TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS setup_confirmed(classId TEXT PRIMARY KEY, date TEXT NOT NULL, students TEXT NOT NULL, confirmedAt TEXT NOT NULL, registeredAt TEXT, registeredCount INTEGER, registeredBy TEXT);
    CREATE TABLE IF NOT EXISTS setup_registry(classId TEXT PRIMARY KEY, count INTEGER NOT NULL, updatedAt TEXT, checkedAt TEXT NOT NULL);`);
  const q={meta:db.prepare('SELECT value FROM setup_meta WHERE key=?'),setMeta:db.prepare('INSERT INTO setup_meta(key,value,at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,at=excluded.at'),
    check:db.prepare('SELECT payload FROM setup_checks WHERE classId=?'),putCheck:db.prepare('INSERT INTO setup_checks(classId,date,at,payload) VALUES(?,?,?,?) ON CONFLICT(classId) DO UPDATE SET date=excluded.date,at=excluded.at,payload=excluded.payload'),dropCheck:db.prepare('DELETE FROM setup_checks WHERE classId=?'),
    confirmed:db.prepare('SELECT * FROM setup_confirmed WHERE classId=?'),allConfirmed:db.prepare('SELECT * FROM setup_confirmed'),
    confirm:db.prepare('INSERT INTO setup_confirmed(classId,date,students,confirmedAt,registeredAt,registeredCount,registeredBy) VALUES(?,?,?,?,NULL,NULL,NULL) ON CONFLICT(classId) DO UPDATE SET date=excluded.date,students=excluded.students,confirmedAt=excluded.confirmedAt,registeredAt=NULL,registeredCount=NULL,registeredBy=NULL'),
    unconfirm:db.prepare('DELETE FROM setup_confirmed WHERE classId=?'),registered:db.prepare('UPDATE setup_confirmed SET registeredAt=?,registeredCount=?,registeredBy=? WHERE classId=?'),
    registry:db.prepare('SELECT classId,count,updatedAt,checkedAt FROM setup_registry'),putRegistry:db.prepare('INSERT INTO setup_registry(classId,count,updatedAt,checkedAt) VALUES(?,?,?,?) ON CONFLICT(classId) DO UPDATE SET count=excluded.count,updatedAt=excluded.updatedAt,checkedAt=excluded.checkedAt'),clearRegistry:db.prepare('DELETE FROM setup_registry')};
  const row=r=>r?{classId:r.classId,date:r.date,students:JSON.parse(r.students),confirmedAt:r.confirmedAt,registeredAt:r.registeredAt||null,registeredCount:r.registeredCount??null,registeredBy:r.registeredBy||null}:null;
  return {
    // 설치 모드: null(아직 정하지 않음 — 연결 프로그램이 처음 켤 때 정함) | true | false
    mode(){const v=q.meta.get('mode')?.value;return v===undefined?null:v==='on';},
    setMode(on){q.setMeta.run('mode',on?'on':'off',now());},
    report(classId){const r=q.check.get(String(classId));return r?JSON.parse(r.payload):null;},
    saveReport(r){if(!classOk(r.classId))throw Error('반을 확인해 주세요.');q.putCheck.run(r.classId,r.date,r.at,JSON.stringify(r));return r;},
    dropReport(classId){q.dropCheck.run(String(classId));},
    confirmed(classId){return row(q.confirmed.get(String(classId)));},
    confirmedAll(){return q.allConfirmed.all().map(row);},
    confirm(classId,date,students){q.confirm.run(String(classId),date,JSON.stringify(cleanStudents(students)),now());return row(q.confirmed.get(String(classId)));},
    unconfirm(classId){q.unconfirm.run(String(classId));},
    markRegistered(classId,{count,by,at=now()}){q.registered.run(at,count,by,String(classId));},
    registry(){return q.registry.all();},
    saveRegistry(list){const at=now();db.exec('BEGIN');try{q.clearRegistry.run();for(const r of list)if(classOk(r.classId))q.putRegistry.run(String(r.classId),Number(r.count)||0,r.updatedAt||null,at);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},
  };
}
