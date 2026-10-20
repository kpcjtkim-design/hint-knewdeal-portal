// 2기 기수 설정(연결 프로그램·중계 공용): 원본은 루트 cohort.json, 함수는 루트 cohort.mjs(브라우저·Node 공용). 여기는 연결 프로그램이 쓰는 이름만 이어 줍니다.
// 1기 값은 cohort1 브랜치에만 있습니다. 2기 Firebase 설정(cohort.json firebase의 apiKey·appId)이 비면 승인·반영·명단 등록(Firestore)은 FIREBASE_MISSING으로 멈추고, 수집·이 PC 화면은 됩니다.
import {isClassId,classInfo,COURSE_START,COURSE_END,COHORT_DATE_RE,isIsoDate} from '../cohort.mjs';
export {COHORT,CLASSES,CLASS_IDS,BRIDGE_PORT,BRIDGE_URL,LECTURE_NAME_RULE,lectureTag,HOLIDAYS,COURSE_START,COURSE_END,inPeriod,isHoliday,isTrainingDay,trainingDays,isoFromMonthDay,firebaseReady,FIREBASE_KEY,FIREBASE_PROJECT,APPROVER} from '../cohort.mjs';
// 반: '1'~'16'만. classOf(반) → {id, name(지역(구)_과정_장소), official, venue, capacity, rosterKey …} 또는 null.
export const classOk=v=>isClassId(String(v??''));
export const classOf=v=>classInfo(v);
export const PERIOD_TEXT=`${COURSE_START}~${COURSE_END}`;
// 날짜: 2026·2027년(교육 기간이 해를 넘음)의 달력에 있는 날. 기간 안인지는 inPeriod로 따로 봅니다.
export const validIso=d=>typeof d==='string'&&COHORT_DATE_RE.test(d)&&isIsoDate(d);
export const FIREBASE_MISSING='FIREBASE_CONFIG: 2기 Firebase 설정 필요 — 연결 프로그램에 2기 Firebase 프로젝트 설정(cohort.json firebase의 apiKey·appId)이 아직 없어 승인·반영·명단 등록(플랫폼 저장)을 하지 않았습니다. 수집은 됩니다. 담당자가 cohort.json을 채운 새 build를 받아 다시 시작해 주세요.';
