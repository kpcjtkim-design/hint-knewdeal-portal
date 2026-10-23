export async function mountTeacherWorkspace(parent,{db,user,classInfo,preview=false}){
 // 2기 담임 화면(담임 로그인·관리자 미리보기 공통)은 6탭 통합 화면(beta2-teacher-layout.mjs, 마스터시트 기준)입니다.
 // 1기 8탭 화면(출결 통계·증빙·질병 인정 등 1기 출결 저장본 기준)은 cohort1 브랜치에 남았습니다.
 const m=await import('./beta2-teacher-layout.mjs?v=20261023-top');return m.mountBeta2TeacherLayout(parent,{db,user,classInfo,preview});
}
