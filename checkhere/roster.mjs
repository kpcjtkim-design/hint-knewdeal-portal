// 2기 명단(반별 이름 + 전화 끝 4자리, 생년월일은 골라 넣음)을 이 PC 연결 프로그램 SQLite에만 둡니다(Firestore·중계·기록 글로 가지 않음). 전체 번호면 학생 키만 만들고 번호는 버립니다.
// 쓰임: 10/28 입교식처럼 원문으로 읽은 적이 없는 반에서 가린 화면(이름 첫 글자+**, 010-****-끝4자리)의 학생을 체크히어 학생 번호(attendeeId)와 잇고, 처음 설치 확인(setup.mjs)에서 원문 명단과 맞춥니다.
// 잇는 기준은 가린 화면 연결(masking.mjs resolveMasked)과 같습니다: 보이는 앞부분+끝 4자리가 명단에서 한 명, 첫 글자+끝 4자리가 명단에서 하나, 그날 표에서도 하나, 그 학생이 다른 번호와 이어져 있지 않음.
// 명단으로 이은 연결(source 'roster'·사람이 고른 'roster-manual')은 읽기 전용입니다: 쓰기는 사람이 해제한 원문 화면에서 다시 확인('plain-read')된 뒤에만(collector.writeBlocked).
// 생년월일은 이 PC 화면에서 동명이인을 사람이 가를 때만 보입니다(등록·내보내기·작업 글에 넣지 않음).
import {hash,studentKey} from './identity.mjs';
import {hasMask,shownPrefix,last4Of,nameFits,attendeeOf} from './masking.mjs';
import {classOk,CLASSES,COHORT} from './cohort-bridge.mjs';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
// 머리말 칸 이름(띄어쓰기 없앤 뒤): 머리말이 있으면 칸 위치를 머리말로 정합니다(번호·이메일 같은 다른 칸이 있어도 됨).
const HEAD={cls:/^(?:반|반번호|반이름|반명|과정|과정명|교육과정|교육장|장소)$/,name:/^(?:이름|성명|학생|학생명|교육생|훈련생|교육생명|훈련생명)$/,phone:/^(?:전화|전화번호|휴대폰|휴대폰번호|휴대전화|핸드폰|연락처|끝4자리|전화끝4자리)$/,birth:/^(?:생년월일|생일|출생일|생년월일\(\d자리\)|birth|birthdate)$/i};
const cellsOf=raw=>{const c=String(raw).split(/\t|,|;/).map(clean);while(c.length&&!c.at(-1))c.pop();return c;};
const unprefixed=t=>t.startsWith(COHORT.officialPrefix.trim())?t.slice(COHORT.officialPrefix.trim().length).trim():t;
// 반 칸: '3', '3반', 반 이름(서울(관악구)_모빌리티 AI_서울대), 공식명([현대자동차그룹 HINT] …), 장소(후인원A), 명단 구분어(_서울대).
export function classFrom(v){
  const t=unprefixed(clean(v));if(!t)return null;
  const n=/^(\d{1,2})\s*반?$/.exec(t)?.[1];if(n)return classOk(String(Number(n)))?String(Number(n)):null;
  return CLASSES.find(c=>c.name===t||c.venue===t||c.rosterKey===t||c.rosterKey.replace(/^_/,'')===t)?.id||null;
}
// 생년월일 → 'YYYY-MM-DD'. 비면 '', 읽을 수 없으면 null. 'YYYY-MM-DD'·'YYYY.MM.DD'·'YYYYMMDD'·'YYMMDD'(30 이상은 19YY)·'YY.MM.DD'.
export function birthOf(v){
  const t=clean(v);if(!t)return '';
  let m=/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(t)||/^(\d{4})(\d{2})(\d{2})$/.exec(t);let y;
  if(m)y=m[1];else{m=/^(\d{2})\s*[-./]?\s*(\d{2})\s*[-./]?\s*(\d{2})$/.exec(t);if(!m)return null;y=(Number(m[1])>=30?'19':'20')+m[1];}
  const iso=`${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`,d=new Date(iso+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso&&iso>='1940-01-01'&&iso<='2015-12-31'?iso:null;
}
// 붙여 넣은 글·CSV → {rows:[{classId,name,last4,birth,phoneKey?}], errors:[{line,reason}]}. 오류 글에는 이름·번호를 넣지 않습니다(줄 번호만).
// 칸: 머리말이 없으면 '이름, 전화', '반, 이름, 전화', '이름, 전화, 생년월일', '반, 이름, 전화, 생년월일'(전화는 전체 번호나 끝 4자리). 구분은 탭·쉼표·세미콜론(엑셀에서 복사한 표도 됨).
// 첫 줄이 머리말(이름·전화…)이면 그 머리말로 칸을 찾습니다. classId(화면에서 고른 반)를 주면 반 칸이 없어도 그 반이고, 다른 반 줄은 오류입니다.
export function parseRoster(text,{classId=null}={}){
  const rows=[],errors=[],fixed=classId===null||classId===undefined||classId===''?null:String(classId);
  if(fixed&&!classOk(fixed))return {rows,errors:[{line:0,reason:'반을 확인해 주세요.'}]};
  const all=String(text??''),lines=(all.charCodeAt(0)===0xfeff?all.slice(1):all).split(/\r?\n/);let cols=null,first=true;
  lines.forEach((raw,i)=>{
    const line=i+1,cells=cellsOf(raw);if(!cells.length)return;
    if(first){first=false;const at=re=>cells.findIndex(c=>re.test(c.replace(/\s/g,'')));if(at(HEAD.name)>=0&&at(HEAD.phone)>=0){cols={cls:at(HEAD.cls),name:at(HEAD.name),phone:at(HEAD.phone),birth:at(HEAD.birth)};return;}}
    let cls=null,name,phone,birth='';
    if(cols)[cls,name,phone,birth]=[cols.cls>=0?cells[cols.cls]:null,cells[cols.name],cells[cols.phone],cols.birth>=0?cells[cols.birth]:''];
    else if(cells.length===2)[name,phone]=cells;
    else if(cells.length===3&&classFrom(cells[0]))[cls,name,phone]=cells;
    else if(cells.length===3&&birthOf(cells[2]))[name,phone,birth]=cells;
    else if(cells.length===4)[cls,name,phone,birth]=cells;
    else return errors.push({line,reason:'칸 수가 다릅니다(이름, 전화 · 반, 이름, 전화 · 생년월일은 맨 뒤).'});
    const c=cls?classFrom(cls):null;
    if(cls&&!c)return errors.push({line,reason:'반을 알 수 없습니다.'});
    if(fixed&&c&&c!==fixed)return errors.push({line,reason:'고른 반과 다른 반 줄입니다.'});
    cls=c||fixed;if(!cls)return errors.push({line,reason:'반을 알 수 없습니다.'});
    name=clean(name);
    if(!name||name.length>60||hasMask(name)||/\d{4}/.test(name))return errors.push({line,reason:'이름을 확인해 주세요(가린 글자·숫자 없이).'});
    const digits=String(phone??'').replace(/\D/g,'');
    if(digits.length!==4&&(digits.length<9||digits.length>11))return errors.push({line,reason:'전화는 전체 번호 또는 끝 4자리여야 합니다.'});
    const b=birthOf(birth);if(b===null)return errors.push({line,reason:'생년월일을 확인해 주세요(예: 1999-03-02, 990302).'});
    rows.push({classId:cls,name,last4:digits.slice(-4),birth:b,...(digits.length>=9?{phoneKey:studentKey(name,digits)}:{})});
  });
  return {rows,errors};
}
// 명단 한 줄의 학생 키: 전체 번호면 원문 읽기와 같은 키(identity.studentKey), 끝 4자리뿐이면 이 반에 이미 저장된 같은 이름·끝 4자리 학생(한 명일 때)의 키,
// 없으면 명단 키(원문 읽기도 이 키를 씀 — collector.keyFor). 같은 반·같은 이름·같은 끝 4자리가 둘이면(dup) 자동으로 잇지 않습니다(사람이 고름).
export function rosterKeys(rows,{existing=new Map()}={}){
  const sig=r=>r.name+'|'+r.last4,n=new Map();for(const r of rows)n.set(sig(r),(n.get(sig(r))||0)+1);
  const seen=new Map();
  return rows.map(r=>{
    const k=sig(r),i=seen.get(k)||0;seen.set(k,i+1);const dup=n.get(k)>1;
    const old=[...existing].filter(([,v])=>v.name===r.name&&v.phoneLast4===r.last4);
    const key=r.phoneKey||(!dup&&old.length===1?old[0][0]:hash(['roster',r.classId,r.name,r.last4,dup?i:0]));
    return {classId:r.classId,name:r.name,last4:r.last4,birth:r.birth||'',studentKey:key,dup};
  });
}
export function createRosterStore(db){
  db.exec('CREATE TABLE IF NOT EXISTS roster(classId TEXT NOT NULL, studentKey TEXT NOT NULL, name TEXT NOT NULL, last4 TEXT NOT NULL, dup INTEGER NOT NULL DEFAULT 0, importedAt TEXT NOT NULL, PRIMARY KEY(classId,studentKey));');
  // 생년월일 칸(골라 넣음, 이 PC만)과 명단 출처('paste' 붙여 넣음 · 'registered' 등록 목록에서 가져옴)
  const cols=new Set(db.prepare('PRAGMA table_info(roster)').all().map(c=>c.name));
  if(!cols.has('birth'))db.exec("ALTER TABLE roster ADD COLUMN birth TEXT NOT NULL DEFAULT ''");
  if(!cols.has('source'))db.exec("ALTER TABLE roster ADD COLUMN source TEXT NOT NULL DEFAULT 'paste'");
  const q={all:db.prepare('SELECT classId,studentKey,name,last4,dup,birth,source FROM roster WHERE classId=? ORDER BY rowid'),clear:db.prepare('DELETE FROM roster WHERE classId=?'),
    put:db.prepare('INSERT INTO roster(classId,studentKey,name,last4,dup,importedAt,birth,source) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(classId,studentKey) DO UPDATE SET name=excluded.name,last4=excluded.last4,dup=excluded.dup,importedAt=excluded.importedAt,birth=excluded.birth,source=excluded.source'),
    counts:db.prepare('SELECT classId,COUNT(*) n,SUM(dup) dup,MAX(source) source FROM roster GROUP BY classId')};
  const cache=new Map();
  const store={
    entries(classId){classId=String(classId);if(!cache.has(classId))cache.set(classId,q.all.all(classId).map(r=>({...r,dup:!!r.dup})));return cache.get(classId);},
    // 반 하나의 명단을 통째로 바꿉니다(그 반 줄만). 키는 rosterKeys로 정합니다. source: 'paste' | 'registered'.
    replace(classId,entries,{source='paste'}={}){
      classId=String(classId);const now=new Date().toISOString();db.exec('BEGIN');
      try{q.clear.run(classId);for(const e of entries)if(e.classId===classId)q.put.run(classId,e.studentKey,e.name,e.last4,e.dup?1:0,now,e.birth||'',source);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      cache.delete(classId);return store.entries(classId);
    },
    clear(classId){q.clear.run(String(classId));cache.delete(String(classId));},
    counts(){return Object.fromEntries(q.counts.all().map(r=>[String(r.classId),{count:Number(r.n)||0,dup:Number(r.dup)||0,source:r.source||'paste'}]));},
    // 원문 줄의 학생 키: 이 반 명단에 이름·끝 4자리가 똑같은 학생이 한 명(dup 아님)이면 그 키, 아니면 null(원문 키를 씀).
    keyFor(classId,name,last4){const hit=store.entries(classId).filter(e=>!e.dup&&e.name===clean(name)&&e.last4===String(last4||''));return hit.length===1?hit[0].studentKey:null;},
    // 이 반 학생 키 → {name, phoneLast4, date:''}(가린 화면에서 연결된 학생의 이름·끝 4자리)
    identities(classId){return new Map(store.entries(classId).map(e=>[e.studentKey,{name:e.name,phoneLast4:e.last4,date:'',source:'roster'}]));},
  };
  return store;
}
// 그날 표 줄(rows: {seq,name,phone,kind}) + 순번으로 맞춘 화면 데이터(entries) + 명단 → 이을 짝과 남는 줄.
// linked(attendeeId): 이미 연결됨, taken(studentKey): 그 학생이 다른 번호와 이어짐. 결과 pairs:[{i,attendeeId,studentKey}], left:[{i,attendeeId,reason}].
// reason: 'none'(명단에 맞는 학생 없음) | 'many'(맞는 학생이 둘 이상이거나 첫 글자·끝 4자리가 명단에서 겹침) | 'today'(그날 표에 같은 모양이 둘) | 'taken'(맞는 학생이 이미 다른 번호와 이어짐).
export function matchRoster({rows,entries,roster,linked=()=>false,taken=()=>false}){
  const pairs=[],left=[],pool=roster.filter(e=>!e.dup),sigOf=r=>shownPrefix(r.name)[0]+'|'+last4Of(r.phone);
  const today=new Map();for(const r of rows){const s=sigOf(r);today.set(s,(today.get(s)||0)+1);}
  const used=new Set();
  rows.forEach((row,i)=>{
    const attendeeId=attendeeOf(entries?.[i]);if(!attendeeId||linked(attendeeId))return;
    const last4=last4Of(row.phone),fit=pool.filter(e=>e.last4===last4&&nameFits(row.name,e.name));
    if(!fit.length)return left.push({i,attendeeId,reason:'none'});
    const who=fit.length===1?fit[0]:null,sameSig=who?roster.filter(e=>e.name[0]===who.name[0]&&e.last4===last4).length:0;
    if(!who||sameSig!==1)return left.push({i,attendeeId,reason:'many'});
    if(today.get(sigOf(row))!==1)return left.push({i,attendeeId,reason:'today'});
    if(taken(who.studentKey)||used.has(who.studentKey))return left.push({i,attendeeId,reason:'taken'});
    used.add(who.studentKey);pairs.push({i,attendeeId,studentKey:who.studentKey});
  });
  return {pairs,left};
}
// 사람이 고르는 연결(이 PC 화면)이 가린 줄과 맞는지: 보이는 앞부분이 이름과 맞고 끝 4자리가 같아야 합니다(다르면 명단을 고쳐 다시 불러옴).
export const manualFits=(row,entry)=>!!row&&!!entry&&last4Of(row.phone)===entry.last4&&nameFits(row.name,entry.name);
