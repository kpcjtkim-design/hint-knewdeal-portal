// 2기 기수 설정 함수(브라우저·Node 공용, import 하나로 끝나게 자료를 안에 둡니다). 원본은 cohort.json이고 아래 DATA는 그 사본입니다.
// cohort.json을 고친 뒤 node tools/build-cohort.mjs로 사본을 맞춥니다(cohort 시험이 둘이 같은지 확인). Vercel api는 lib/cohort.cjs로 cohort.json을 읽습니다.
// <cohort.json>
const DATA={
  "_notes": [
    "2기 기수 설정 원본입니다. 화면·api·연결 프로그램이 모두 여기서 반·기간·휴일·규칙·Firebase 설정을 읽습니다.",
    "고친 뒤에는 node tools/build-cohort.mjs 로 cohort.mjs 안의 사본을 맞춥니다(cohort 시험이 둘이 같은지 확인합니다).",
    "firebase는 2기 전용 새 프로젝트(hint-knewdeal-2) 웹 설정(공개값)입니다. 1기 Firebase 프로젝트와 섞이지 않게 apiKey·appId가 비어 있으면 로그인을 막습니다(2기 Firebase 설정 필요).",
    "excursions: 반별 공장견학 날짜(그날만 10:00~17:00 기준). 2기 시간표가 나오면 채웁니다. 날짜·반별 시간 조정은 cohort.mjs ruleFor(날짜, 반, overrides)로 넘깁니다(저장·화면은 다음 단계).",
    "sheets.master: 2기 마스터시트 id(웹은 Apps Script API로만 읽고 씀). sheets.dropout: 2기 중도포기자 시트(아직 없음, 비면 중도포기 화면을 닫음).",
    "site.teacherPortalUrl: 2기 담임 PIN 포털(Apps Script doGet). 데이터 API 주소는 비밀값이라 여기에 두지 않고 Vercel 환경변수 HINT_SHEET_API_URL에만 둡니다.",
    "features: false인 화면은 '11월 중 2기 기준으로 열림'으로 감춥니다(1기 운영총괄을 읽던 화면 등)."
  ],
  "id": "2",
  "label": "2기",
  "title": "HINT 2기 운영포털",
  "officialPrefix": "[현대자동차그룹 HINT] ",
  "period": {"start": "2026-10-28", "end": "2027-01-22", "weekBase": "2026-10-26"},
  "holidays": [
    {"date": "2026-12-25", "name": "성탄절"},
    {"date": "2026-12-31", "name": "연말 휴무"},
    {"date": "2027-01-01", "name": "신정"}
  ],
  "unitPeriods": [
    {"no": 1, "from": "2026-10-28", "to": "2026-11-27"},
    {"no": 2, "from": "2026-11-28", "to": "2026-12-27"},
    {"no": 3, "from": "2026-12-28", "to": "2027-01-22"}
  ],
  "rules": {"start": "09:00", "end": "18:00", "lunchStart": "12:00", "lunchEnd": "13:00", "entryGrace": 10, "exitGrace": 10},
  "excursionRule": {"start": "10:00", "end": "17:00", "lunchStart": "12:00", "lunchEnd": "13:00", "entryGrace": 10, "exitGrace": 10},
  "excursions": {},
  "disease": {"warn": 4, "max": 6},
  "completionRate": 80,
  "regions": ["서울", "충청", "대경", "동남", "호남"],
  "courses": ["모빌리티 AI", "제조지능화"],
  "classes": [
    {"id": "1", "region": "서울", "area": "서울(관악구)", "course": "모빌리티 AI", "venue": "서울대", "capacity": 30, "rosterKey": "_서울대"},
    {"id": "2", "region": "서울", "area": "서울(성동구)", "course": "제조지능화", "venue": "한양대", "capacity": 30, "rosterKey": "_한양대"},
    {"id": "3", "region": "충청", "area": "대전(유성구)", "course": "모빌리티 AI", "venue": "후인원A", "capacity": 30, "rosterKey": "후인원A"},
    {"id": "4", "region": "충청", "area": "대전(유성구)", "course": "제조지능화", "venue": "후인원B", "capacity": 31, "rosterKey": "후인원B"},
    {"id": "5", "region": "충청", "area": "청주(청원구)", "course": "제조지능화", "venue": "청주", "capacity": 30, "rosterKey": "_청주"},
    {"id": "6", "region": "대경", "area": "대구(동구)", "course": "모빌리티 AI", "venue": "KPC대구지부", "capacity": 30, "rosterKey": "KPC대구지부"},
    {"id": "7", "region": "대경", "area": "대구(중구)", "course": "모빌리티 AI", "venue": "마이크로웨이브A", "capacity": 30, "rosterKey": "마이크로웨이브A"},
    {"id": "8", "region": "대경", "area": "대구(중구)", "course": "제조지능화", "venue": "마이크로웨이브B", "capacity": 30, "rosterKey": "마이크로웨이브B"},
    {"id": "9", "region": "동남", "area": "부산(금정구)", "course": "모빌리티 AI", "venue": "부산대", "capacity": 30, "rosterKey": "부산대"},
    {"id": "10", "region": "동남", "area": "부산(해운대구)", "course": "모빌리티 AI", "venue": "아르피나A", "capacity": 30, "rosterKey": "아르피나A"},
    {"id": "11", "region": "동남", "area": "부산(해운대구)", "course": "제조지능화", "venue": "아르피나B", "capacity": 30, "rosterKey": "아르피나B"},
    {"id": "12", "region": "동남", "area": "부산(해운대구)", "course": "제조지능화", "venue": "아르피나C", "capacity": 30, "rosterKey": "아르피나C"},
    {"id": "13", "region": "동남", "area": "울산(북구)", "course": "제조지능화", "venue": "울산", "capacity": 30, "rosterKey": "_울산"},
    {"id": "14", "region": "호남", "area": "광주(북구)", "course": "모빌리티 AI", "venue": "전남대", "capacity": 30, "rosterKey": "전남대"},
    {"id": "15", "region": "호남", "area": "광주(서구)", "course": "제조지능화", "venue": "기아오토랜드A", "capacity": 30, "rosterKey": "기아오토랜드A"},
    {"id": "16", "region": "호남", "area": "광주(서구)", "course": "제조지능화", "venue": "기아오토랜드B", "capacity": 30, "rosterKey": "기아오토랜드B"}
  ],
  "checkhere": {"lectureNameRule": "[N반]", "lectureLinks": {}},
  "admins": ["hint.kpc@gmail.com", "kpc.jtkim@gmail.com"],
  "approver": "hint.kpc@gmail.com",
  "teacherAccess": false,
  "firebase": {
    "apiKey": "AIzaSyBAmlzBuD21IGRSK5yT7cpatHuelqn98do",
    "authDomain": "hint-knewdeal-2.firebaseapp.com",
    "projectId": "hint-knewdeal-2",
    "storageBucket": "hint-knewdeal-2.firebasestorage.app",
    "messagingSenderId": "179773915875",
    "appId": "1:179773915875:web:036dab2c2e18b875947bd6"
  },
  "sheetApi": {"urlEnv": "HINT_SHEET_API_URL", "keyEnv": "HINT_SHEET_API_KEY"},
  "sheets": {"master": "1rbe97EuzlECGrRZ0RBLCTNmjm30SMd41RaSQfLfmq6g", "dropout": ""},
  "site": {"url": "https://hint-knewdealportal.vercel.app", "tempUrl": "https://hint-knewdeal-2.vercel.app", "oldSiteUrl": "https://hint-knewdeal-1gi.vercel.app", "teacherPortalUrl": "https://script.google.com/macros/s/AKfycbyohCVKFIBZSoceYUGz1AsVPU9iJkkFWx20ZUkcnR577BwyPB-7RPdu3KSpZad1s5nt/exec"},
  "bridgePort": 8766,
  "storagePrefix": "h2:",
  "filePrefix": "2기_",
  "features": {
    "timetable": false,
    "materials": false,
    "surveys": false,
    "uploads": false,
    "periodRoster": false,
    "operationsWork": false,
    "dropout": false,
    "studentPreview": true
  }
};
// </cohort.json>
const freeze=o=>{if(o&&typeof o==='object'){Object.freeze(o);Object.values(o).forEach(freeze);}return o;};
export const COHORT=freeze(DATA);
export const COHORT_ID=COHORT.id,COHORT_LABEL=COHORT.label,COHORT_TITLE=COHORT.title;

// 반: 지역 순서(서울→충청→대경→동남→호남) 그대로 1~16. name은 공식 반 이름, official은 '[현대자동차그룹 HINT] '을 붙인 과정명입니다.
export const CLASSES=freeze(COHORT.classes.map(c=>({...c,name:`${c.area}_${c.course}_${c.venue}`,official:COHORT.officialPrefix+`${c.area}_${c.course}_${c.venue}`})));
export const CLASS_IDS=freeze(CLASSES.map(c=>c.id));
export const CLASS_COUNT=CLASS_IDS.length;
export const classes=()=>CLASSES.map(c=>({...c}));
export const classInfo=id=>CLASSES.find(c=>c.id===String(id??'').trim())||null;
export const isClassId=id=>CLASS_IDS.includes(String(id??''));
// 반 번호 정규식 조각: 16반이면 '(?:[1-9]|1[0-6])'. Firestore 규칙·연결 프로그램 검사와 같은 모양입니다.
export function classIdPattern(n=CLASS_COUNT){if(!(n>=1&&n<=19))throw Error('반 수는 1~19만 지원합니다.');return n<=9?`[1-${n}]`:n===10?'(?:[1-9]|10)':`(?:[1-9]|1[0-${n-10}])`;}
export const CLASS_ID_RE=new RegExp(`^${classIdPattern()}$`);
export const classLabel=id=>{const c=classInfo(id);return c?`${c.id}반 · ${c.course} · ${c.venue}`:`${String(id??'')}반`;};
export const officialName=id=>classInfo(id)?.official||'';
export const capacityOf=id=>classInfo(id)?.capacity||0;
export const classesInRegion=region=>CLASSES.filter(c=>c.region===region);

// 기간·휴일·교육일. 날짜는 'YYYY-MM-DD'(한국 날짜) 문자열이고, 해를 넘겨도(2026→2027) 문자열 비교가 그대로 맞습니다.
export const PERIOD=COHORT.period,COURSE_START=PERIOD.start,COURSE_END=PERIOD.end,WEEK_BASE=PERIOD.weekBase;
export const HOLIDAYS=freeze(COHORT.holidays.map(h=>h.date));
const HOLIDAY_NAMES=new Map(COHORT.holidays.map(h=>[h.date,h.name]));
export const holidayName=iso=>HOLIDAY_NAMES.get(String(iso))||'';
export const YEARS=freeze((()=>{const out=[];for(let y=+COURSE_START.slice(0,4);y<=+COURSE_END.slice(0,4);y++)out.push(String(y));return out;})());
// 2기 날짜 모양(연도만 봄): /^(?:2026|2027)-\d{2}-\d{2}$/
export const COHORT_DATE_RE=new RegExp(`^(?:${YEARS.join('|')})-\\d{2}-\\d{2}$`);
const day=iso=>new Date(String(iso)+'T00:00:00Z');
export const isIsoDate=v=>{const s=String(v??'');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(day(s).getTime())&&day(s).toISOString().slice(0,10)===s;};
export const inPeriod=iso=>isIsoDate(iso)&&iso>=COURSE_START&&iso<=COURSE_END;
export const isWeekday=iso=>isIsoDate(iso)&&![0,6].includes(day(iso).getUTCDay());
export const isHoliday=iso=>HOLIDAYS.includes(String(iso));
export const isTrainingDay=iso=>inPeriod(iso)&&isWeekday(iso)&&!isHoliday(iso);
export const addDays=(iso,n)=>{const d=day(iso);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
// 교육일 목록(평일 - 휴일). from·to는 기간 안으로 자릅니다.
export function trainingDays({from=COURSE_START,to=COURSE_END}={}){
  const a=from>COURSE_START?from:COURSE_START,b=to<COURSE_END?to:COURSE_END,out=[];
  if(!isIsoDate(a)||!isIsoDate(b))return out;
  for(let d=a;d<=b;d=addDays(d,1))if(isTrainingDay(d))out.push(d);
  return out;
}
export const TRAINING_DAYS=freeze(trainingDays());
// 평일 목록(휴일 포함, 기간 제한 없음). 체크히어 수집 범위 계산처럼 휴일도 그대로 훑어야 할 때 씁니다.
export function weekdaysBetween(from,to){const out=[];if(!isIsoDate(from)||!isIsoDate(to))return out;for(let d=from;d<=to;d=addDays(d,1))if(isWeekday(d))out.push(d);return out;}
// 주차: 2기 첫 주 월요일(2026-10-26)부터 7일씩. 10/28(수)은 1주차입니다.
export const weekNo=iso=>isIsoDate(iso)?Math.floor((day(iso)-day(WEEK_BASE))/604800000)+1:0;
export function weekSchedule(days=TRAINING_DAYS){const groups=new Map();for(const d of days){const w=weekNo(d);if(!groups.has(w))groups.set(w,[]);groups.get(w).push(d);}return [...groups.entries()].map(([week,dates])=>({week,dates}));}

// 'M/D'·'M.D'·'M-D'·'M월 D일'(또는 월·일 숫자 두 개) → 기간에 가장 가까운 해의 ISO 날짜. 10~12월은 2026, 1월은 2027입니다.
export function isoFromMonthDay(m,d){
  if(d===undefined){
    const s=String(m??'').trim();if(isIsoDate(s))return s;
    const x=s.match(/(?:^|\D)(\d{1,2})\s*(?:[/.\-]|월\s*)\s*(\d{1,2})(?:\s*일)?(?:\D|$)/);if(!x)return '';m=x[1];d=x[2];
  }
  const mm=Number(m),dd=Number(d);if(!Number.isInteger(mm)||!Number.isInteger(dd)||mm<1||mm>12||dd<1||dd>31)return '';
  const md=`${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  const gap=iso=>iso<COURSE_START?day(COURSE_START)-day(iso):iso>COURSE_END?day(iso)-day(COURSE_END):0;
  const first=+COURSE_START.slice(0,4),options=[first-1,first,first+1,first+2].map(y=>`${y}-${md}`).filter(isIsoDate);
  return options.sort((a,b)=>gap(a)-gap(b))[0]||'';
}
export const mdLabel=iso=>isIsoDate(iso)?`${+iso.slice(5,7)}/${+iso.slice(8,10)}`:String(iso??'');

// 단위기간(HRD 출석부 단위). label 예: '1단위 · 10/28~11/27'
export const UNIT_PERIODS=freeze(COHORT.unitPeriods.map(p=>({...p,label:`${p.no}단위 · ${mdLabel(p.from)}~${mdLabel(p.to)}`})));
export const unitPeriodOf=iso=>UNIT_PERIODS.find(p=>iso>=p.from&&iso<=p.to)||null;

// 출결 시간 규칙. 공장견학 날은 10:00~17:00(지각 10:10 넘으면, 조퇴 16:50 전), 그 밖은 09:00~18:00(지각 09:10 넘으면, 조퇴 17:50 전).
// 견학 날: cohort.json excursions[반]에 적힌 날짜이거나, 시간표·관리자 조정이 견학이라고 알려 준 경우(excursion:true).
export const RULE_VERSION='HINT-2.0.0-20261019';
export const BASE_RULE=freeze({version:RULE_VERSION,...COHORT.rules,excursion:false,source:'base'});
export const EXCURSION_RULE=freeze({version:RULE_VERSION+'-excursion',...COHORT.excursionRule,excursion:true,source:'excursion'});
export const isExcursionDay=(classId,date)=>(COHORT.excursions?.[String(classId??'')]||[]).includes(String(date??''));
// 관리자 시간 조정 자리(날짜·반별 교시 시간). 저장·화면은 다음 단계이고, 지금은 읽은 값을 overrides로 넘기면 그대로 씁니다.
// 항목: {date:'YYYY-MM-DD', classIds?:['3',…](없거나 비면 그날 전체 반), start?, end?, lunchStart?, lunchEnd?('HH:MM'), entryGrace?, exitGrace?(0~120분), excursion?:true, note?}
// 적용 순서: 기본(견학 날이면 견학 규칙) → 그날 전체 반 항목 → 그 반 항목(같은 단계는 뒤 항목이 이김). 모양이 틀린 항목·합친 결과가 맞지 않으면 버리고 기본을 씁니다.
const HM=/^([01]\d|2[0-3]):[0-5]\d$/,RULE_TIMES=['start','end','lunchStart','lunchEnd'],RULE_GRACES=['entryGrace','exitGrace'];
const minutes=t=>+t.slice(0,2)*60+ +t.slice(3,5),hhmmOf=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function ruleProblems(rule){
  const out=[];for(const k of RULE_TIMES)if(!HM.test(String(rule?.[k]??'')))out.push(k+' 시간 형식(HH:MM)');
  for(const k of RULE_GRACES)if(!Number.isInteger(rule?.[k])||rule[k]<0||rule[k]>120)out.push(k+' 0~120분');
  if(out.length)return out;
  const [s,e,a,b]=RULE_TIMES.map(k=>minutes(rule[k]));
  if(s>=e)out.push('시작이 끝보다 늦음');if(a>b||a<s||b>e)out.push('점심이 수업 시간 밖');if(s+rule.entryGrace>=e-rule.exitGrace)out.push('지각·조퇴 기준이 겹침');
  return out;
}
export function ruleOverrideProblems(o){
  if(!o||typeof o!=='object'||Array.isArray(o))return ['항목 모양'];
  const out=[];if(!isIsoDate(o.date)||!inPeriod(o.date))out.push('교육 기간 안의 날짜');
  if(o.classIds!==undefined&&(!Array.isArray(o.classIds)||o.classIds.some(id=>!isClassId(id))))out.push('반 번호');
  for(const k of RULE_TIMES)if(o[k]!==undefined&&!HM.test(String(o[k])))out.push(k+' 시간 형식(HH:MM)');
  for(const k of RULE_GRACES)if(o[k]!==undefined&&!(Number.isInteger(o[k])&&o[k]>=0&&o[k]<=120))out.push(k+' 0~120분');
  if(o.excursion!==undefined&&typeof o.excursion!=='boolean')out.push('excursion true/false');
  return out;
}
// ruleFor(날짜, 반, overrides): overrides는 위 항목 배열, 또는 {excursion:true(시간표가 견학이라고 할 때), items:[항목…]}.
// 둘째 인자로 {classId, excursion, overrides}를 넘기는 옛 모양도 받습니다. 돌려주는 규칙은 얼린 객체이고 source가 base·excursion·override입니다.
export function ruleFor(date,classId='',overrides=null){
  let opt={};if(classId&&typeof classId==='object'){opt=classId;classId=opt.classId??'';overrides??=opt.overrides??null;}
  const iso=String(date??''),cid=String(classId??'').trim(),o=Array.isArray(overrides)?{items:overrides}:overrides&&typeof overrides==='object'?overrides:{};
  const items=(Array.isArray(o.items)?o.items:[]).filter(x=>x?.date===iso&&!ruleOverrideProblems(x).length&&(!x.classIds?.length||x.classIds.map(String).includes(cid)));
  const ordered=[...items.filter(x=>!x.classIds?.length),...items.filter(x=>x.classIds?.length)];
  const excursion=opt.excursion===true||o.excursion===true||isExcursionDay(cid,iso)||ordered.some(x=>x.excursion===true);
  const base=excursion?EXCURSION_RULE:BASE_RULE;if(!ordered.length)return base;
  const fields={};for(const x of ordered)for(const k of [...RULE_TIMES,...RULE_GRACES])if(x[k]!==undefined)fields[k]=x[k];
  const note=ordered.map(x=>String(x.note??'').trim()).filter(Boolean).join(' · ').slice(0,200);
  const rule={...base,...fields,version:`${base.version}+override:${iso}:${ordered.some(x=>x.classIds?.length)?cid:'all'}`,source:'override',excursion,...(note?{note}:{})};
  return ruleProblems(rule).length?base:freeze(rule);
}
export const scheduleText=rule=>`${rule.start} ~ ${rule.end}`;
// 체크히어 강의시간으로 받아 주는 값: 그날 규칙 + (견학·조정한 날이면) 기본 09:00 ~ 18:00(체크히어 강의는 기본 시간으로 만들어져 있음).
export const acceptedSchedules=rule=>[...new Set([scheduleText(rule),...(rule.source&&rule.source!=='base'?[scheduleText(BASE_RULE)]:[])])];
// 지각은 이 시각을 넘긴 입실(기본 09:10, 견학 10:10), 조퇴는 이 시각 전 퇴실(기본 17:50, 견학 16:50). 'HH:MM'.
export const lateAfter=rule=>hhmmOf(minutes(rule.start)+rule.entryGrace),earlyBefore=rule=>hhmmOf(minutes(rule.end)-rule.exitGrace);

// 질병 인정 경고·한도와 수료 기준(출석률 %).
export const DISEASE=COHORT.disease,COMPLETION_RATE=COHORT.completionRate;

// 계정: 관리자·체크히어 승인자·담임 로그인 허용(개강 전에는 false).
export const ADMINS=COHORT.admins,APPROVER=COHORT.approver,TEACHER_ACCESS=COHORT.teacherAccess===true;
export const isAdminEmail=email=>ADMINS.includes(String(email||'').trim().toLowerCase());

// Firebase(2기 전용 새 프로젝트). apiKey·appId가 비면 null을 돌려 로그인 화면이 '2기 Firebase 설정 필요'로 멈춥니다(1기 프로젝트로 새지 않게).
export const FIREBASE_MISSING_TEXT='2기 Firebase 설정 필요: cohort.json의 firebase(apiKey·appId)를 2기 프로젝트 값으로 채워야 로그인할 수 있습니다.';
export const firebaseReady=()=>!!(COHORT.firebase.apiKey&&COHORT.firebase.appId&&COHORT.firebase.projectId);
export const firebaseConfig=()=>firebaseReady()?{...COHORT.firebase}:null;
export const FIREBASE_PROJECT=COHORT.firebase.projectId,FIREBASE_KEY=COHORT.firebase.apiKey;

// 마스터시트 API 환경변수 이름(Vercel 2기 프로젝트에 값이 들어갑니다). 2기 마스터시트 id, 2기 중도포기자 시트 id(아직 없음 → '').
export const SHEET_API=COHORT.sheetApi,MASTER_SHEET_ID=COHORT.sheets?.master||'',DROPOUT_SHEET_ID=COHORT.sheets?.dropout||'';
// 사이트 주소. oldSiteUrl이 비면 /old 안내를 숨깁니다(/old 넘김은 vercel.json redirects, 같은 주소인지 cohort 시험이 봄). 담임 PIN 포털은 teacherPortalUrl.
export const SITE=COHORT.site,OLD_SITE_URL=COHORT.site.oldSiteUrl||'',TEACHER_PORTAL_URL=COHORT.site.teacherPortalUrl||'';
// 체크히어 연결 프로그램: 2기는 새 폴더·새 기록·포트 8766(1기는 8765).
export const BRIDGE_PORT=COHORT.bridgePort,BRIDGE_URL=`http://127.0.0.1:${COHORT.bridgePort}`;
export const LECTURE_NAME_RULE=COHORT.checkhere.lectureNameRule;
export const lectureTag=id=>LECTURE_NAME_RULE.replace('N',String(id));
// 브라우저 저장 키와 내려받기 파일 이름에 기수를 붙여 같은 주소에 남은 1기 값·파일과 섞이지 않게 합니다.
export const storageKey=key=>COHORT.storagePrefix+key;
export const fileName=name=>String(name).startsWith(COHORT.filePrefix)?String(name):COHORT.filePrefix+name;
// 화면 열림 여부. false인 화면은 FEATURE_LATER_TEXT로 감춥니다.
export const feature=name=>COHORT.features?.[name]===true;
export const FEATURE_LATER_TEXT='11월 중 2기 기준으로 열립니다. 1기 운영총괄·1기 자료를 읽던 화면이라 2기 마스터시트·2기 자료로 다시 만든 뒤 엽니다.';
