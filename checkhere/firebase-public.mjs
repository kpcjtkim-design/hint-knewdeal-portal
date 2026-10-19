// 2기 Firebase 공개 웹 식별자(관리자 비밀이 아님). 값은 루트 cohort.json(cohort.mjs) 한 곳에서 옵니다: 아직 비어 있으면(2기 설정 미정) 승인·반영·명단 등록 경로가 FIREBASE_MISSING으로 멈춥니다.
export {FIREBASE_KEY,FIREBASE_PROJECT as PROJECT,firebaseReady,FIREBASE_MISSING} from './cohort-bridge.mjs';
