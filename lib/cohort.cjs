// Vercel api용 2기 설정(CommonJS). Vercel이 api/*.js의 import를 require로 바꾸므로 .mjs 대신 이 파일이 cohort.json을 읽습니다.
// 화면은 cohort.mjs를 씁니다. 두 파일 모두 원본은 cohort.json 하나입니다.
const COHORT=require('../cohort.json');
const CLASS_IDS=COHORT.classes.map(c=>String(c.id));
const ADMINS=COHORT.admins.map(e=>String(e).toLowerCase());
const FIREBASE_KEY=COHORT.firebase.apiKey||'';
const FIREBASE_PROJECT=COHORT.firebase.projectId||'';
const FIREBASE_READY=!!(COHORT.firebase.apiKey&&COHORT.firebase.appId&&COHORT.firebase.projectId);
const TEACHER_ACCESS=COHORT.teacherAccess===true;
const SHEET_API=COHORT.sheetApi;
const PERIOD=COHORT.period;
const YEARS=[];for(let y=+PERIOD.start.slice(0,4);y<=+PERIOD.end.slice(0,4);y++)YEARS.push(String(y));
const COHORT_DATE_RE=new RegExp(`^(?:${YEARS.join('|')})-\\d{2}-\\d{2}$`);
const isClassId=id=>CLASS_IDS.includes(String(id??''));
const inPeriod=iso=>COHORT_DATE_RE.test(String(iso||''))&&iso>=PERIOD.start&&iso<=PERIOD.end;
const feature=name=>COHORT.features?.[name]===true;
module.exports={COHORT,CLASS_IDS,ADMINS,FIREBASE_KEY,FIREBASE_PROJECT,FIREBASE_READY,TEACHER_ACCESS,SHEET_API,PERIOD,COHORT_DATE_RE,isClassId,inPeriod,feature};
