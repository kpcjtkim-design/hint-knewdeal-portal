// 체크히어 학생 번호(attendeeId) ↔ 이 PC의 학생 키(studentKey) 연결. 연결 프로그램 SQLite에만 둡니다(Firestore에 올리지 않음).
// 이름·끝 4자리는 여기에 복사하지 않고, 늘 저장된 원문 기록(records)에서 꺼냅니다.
// source: 'plain-read'(원문 화면에서 확인) | 'stored-match'(저장된 기록으로 이음 — 원문 읽기로 확인되기 전에는 읽기 전용, 쓰기 안 됨).
import {hasMask} from './masking.mjs';
const DAY=86400000,RETIRE_DAYS=21;
const real=r=>r&&r.source==='live'&&typeof r.studentKey==='string'&&r.studentKey&&!hasMask(r.studentKey)&&typeof r.name==='string'&&r.name.trim()&&!hasMask(r.name)&&/^\d{4}$/.test(String(r.phoneLast4||''));
export function createLinkStore(db,{records=()=>[]}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS attendee_links(classId TEXT NOT NULL, attendeeId TEXT NOT NULL, studentKey TEXT NOT NULL, source TEXT NOT NULL, linkedAt TEXT NOT NULL, lastSeen TEXT, PRIMARY KEY(classId,attendeeId));
    CREATE UNIQUE INDEX IF NOT EXISTS attendee_link_student ON attendee_links(classId,studentKey);
    CREATE TABLE IF NOT EXISTS plain_days(classId TEXT NOT NULL, date TEXT NOT NULL, keys TEXT NOT NULL, savedAt TEXT NOT NULL, PRIMARY KEY(classId,date));
    CREATE TABLE IF NOT EXISTS link_conflicts(classId TEXT NOT NULL, attendeeId TEXT NOT NULL, studentKey TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(classId,attendeeId));`);
  // 연결 충돌(같은 학생 번호에 다른 학생 키)은 SQLite에 둡니다: 다시 시작해도 「연결 충돌 정리」가 남게(이름 없음).
  const q={
    byAttendee:db.prepare('SELECT studentKey,source,lastSeen FROM attendee_links WHERE classId=? AND attendeeId=?'),
    byStudent:db.prepare('SELECT attendeeId,source FROM attendee_links WHERE classId=? AND studentKey=?'),
    insert:db.prepare('INSERT INTO attendee_links(classId,attendeeId,studentKey,source,linkedAt,lastSeen) VALUES(?,?,?,?,?,?)'),
    confirm:db.prepare("UPDATE attendee_links SET source='plain-read',lastSeen=MAX(COALESCE(lastSeen,''),?) WHERE classId=? AND attendeeId=?"),
    remove:db.prepare('DELETE FROM attendee_links WHERE classId=? AND attendeeId=?'),
    seen:db.prepare("UPDATE attendee_links SET lastSeen=MAX(COALESCE(lastSeen,''),?) WHERE classId=? AND attendeeId=?"),
    retire:db.prepare('DELETE FROM attendee_links WHERE classId=? AND COALESCE(lastSeen,\'\')<?'),
    day:db.prepare('INSERT INTO plain_days(classId,date,keys,savedAt) VALUES(?,?,?,?) ON CONFLICT(classId,date) DO UPDATE SET keys=excluded.keys,savedAt=excluded.savedAt'),
    lastDay:db.prepare('SELECT date,keys FROM plain_days WHERE classId=? ORDER BY date DESC LIMIT 1'),
    days:db.prepare('SELECT COUNT(*) n FROM plain_days'),
    count:db.prepare("SELECT COUNT(*) n, SUM(source='stored-match') pending FROM attendee_links"),
    conflict:db.prepare('INSERT INTO link_conflicts(classId,attendeeId,studentKey,at) VALUES(?,?,?,?) ON CONFLICT(classId,attendeeId) DO UPDATE SET studentKey=excluded.studentKey,at=excluded.at'),
    unconflict:db.prepare('DELETE FROM link_conflicts WHERE classId=? AND attendeeId=?'),
    conflicts:db.prepare('SELECT classId,attendeeId,studentKey FROM link_conflicts'),
    conflictCount:db.prepare('SELECT COUNT(*) n FROM link_conflicts'),
    clearConflicts:db.prepare('DELETE FROM link_conflicts'),
  };
  const now=()=>new Date().toISOString();
  // 처음 이 build를 켰을 때: 지금까지 저장된 live 기록은 모두 원문 화면에서 읽은 것입니다. 반마다 마지막 '거의 전원' 날을 원문 수집일로 적어 둡니다
  // (요청 학생 한 명만 읽은 날은 빼려고 최근 5일 최대 인원의 80% 이상인 날만. 전체 기간 최대로 보면 명단이 줄어든 반은 나간 학생이 든 옛날을 고름).
  if(!q.days.get().n){
    const byClass=new Map();
    for(const r of records())if(real(r)){const c=String(r.classId);if(!byClass.has(c))byClass.set(c,new Map());const d=byClass.get(c);if(!d.has(r.date))d.set(r.date,new Set());d.get(r.date).add(r.studentKey);}
    for(const [classId,days] of byClass){
      const dates=[...days.keys()].sort(),max=Math.max(...dates.slice(-5).map(d=>days.get(d).size)),date=dates.filter(d=>days.get(d).size>=max*0.8).at(-1);
      if(date)q.day.run(classId,date,JSON.stringify([...days.get(date)]),now());
    }
  }
  const store={
    link:(classId,attendeeId)=>q.byAttendee.get(String(classId),String(attendeeId))||null,
    attendee:(classId,studentKey)=>q.byStudent.get(String(classId),String(studentKey))||null,
    // 이 반 학생 키 → 마지막 원문 이름·끝 4자리(가린 글자가 든 기록은 쓰지 않음)
    identities(classId){
      const out=new Map();
      for(const r of records())if(String(r.classId)===String(classId)&&real(r)){const old=out.get(r.studentKey);if(!old||String(r.date)>=old.date)out.set(r.studentKey,{name:r.name.trim(),phoneLast4:r.phoneLast4,date:String(r.date)});}
      return out;
    },
    record:id=>records().find(r=>r.id===id)||null,
    teacher(classId){let best=null;for(const r of records())if(String(r.classId)===String(classId)&&r.source==='live'&&typeof r.teacher==='string'&&r.teacher.trim()&&!hasMask(r.teacher)&&(!best||String(r.date)>=best.date))best={date:String(r.date),teacher:r.teacher.trim()};return best?.teacher||'';},
    // 이 반을 마지막으로 원문으로 읽은 날과 그날 학생 키들 {date, keys}
    lastPlain(classId){const row=q.lastDay.get(String(classId));if(!row)return null;try{return {date:row.date,keys:new Set(JSON.parse(row.keys))};}catch{return null;}},
    plainDay(classId,date,keys){if(keys.length&&keys.every(k=>typeof k==='string'&&k&&!hasMask(k)))q.day.run(String(classId),date,JSON.stringify([...new Set(keys)]),now());},
    // 저장된 기록으로 잇기(읽기 전용). 이미 다른 연결이 있으면 하지 않습니다.
    match(classId,attendeeId,studentKey){
      classId=String(classId);if(store.link(classId,attendeeId)||store.attendee(classId,studentKey))return false;
      q.insert.run(classId,String(attendeeId),String(studentKey),'stored-match',now(),null);return true;
    },
    // 원문 화면에서 배운 연결. 'stored-match'와 다르면 원문 쪽이 맞습니다(고침). 'plain-read'끼리 다르면 옛 연결을 두고 충돌로 셉니다(그 학생은 건너뜀).
    learn(classId,date,pairs){
      classId=String(classId);const skipped=new Set();
      for(const {attendeeId,studentKey} of pairs){
        const a=store.link(classId,attendeeId),b=store.attendee(classId,studentKey);
        if(a?.studentKey===studentKey){q.confirm.run(date,classId,attendeeId);q.unconflict.run(classId,String(attendeeId));continue;}
        if((a&&a.source==='plain-read')||(b&&b.attendeeId!==attendeeId&&b.source==='plain-read')){q.conflict.run(classId,String(attendeeId),String(studentKey),now());skipped.add(studentKey);continue;}
        if(a)q.remove.run(classId,attendeeId);if(b)q.remove.run(classId,b.attendeeId);
        q.insert.run(classId,String(attendeeId),String(studentKey),'plain-read',now(),date);q.unconflict.run(classId,String(attendeeId));
      }
      return {skipped};
    },
    // 그날 본 학생 번호의 마지막 날을 올리고, 3주 넘게 보이지 않은 번호의 연결은 내려 둡니다(나간 학생).
    seen(classId,date,attendeeIds){
      classId=String(classId);for(const id of attendeeIds)q.seen.run(date,classId,String(id));
      const t=Date.parse(date);if(Number.isFinite(t))q.retire.run(classId,new Date(t-RETIRE_DAYS*DAY).toISOString().slice(0,10));
    },
    // 충돌은 이 PC 화면에서만 풉니다: 해당 연결을 지우면 다음 원문 읽기가 새로 배웁니다.
    clearConflicts(){let n=0;for(const c of q.conflicts.all()){const a=store.link(c.classId,c.attendeeId);if(a){q.remove.run(c.classId,c.attendeeId);n++;}const b=store.attendee(c.classId,c.studentKey);if(b){q.remove.run(c.classId,b.attendeeId);n++;}}q.clearConflicts.run();return n;},
    counts(){const c=q.count.get();return {links:Number(c.n)||0,storedOnly:Number(c.pending)||0,conflicts:Number(q.conflictCount.get().n)||0};},
  };
  return store;
}
