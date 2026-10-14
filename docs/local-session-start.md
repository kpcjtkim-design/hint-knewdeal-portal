# 로컬 세션 시작 문서 (2026-10-13, 클라우드 세션에서 넘김)

수집 PC(체크히어 연결 프로그램을 돌리는 Windows PC)의 로컬 Claude Code 세션이 **가장 먼저 읽는 문서**다. 지금까지는 클라우드 세션이 코드를 쓰고 Cowork가 화면 작업(Apps Script 편집기, 체크히어 화면, Drive)을 했다. 로컬 세션은 둘 사이의 단절 없이 이어서 한다.

## 1. 지켜야 할 규칙 (사용자 지시, 계속 유효)

- 저장소 파일은 사용자가 지시할 때만 바꾼다. **커밋·push·배포·PR 병합은 사용자 확인 후에만** 한다. 작업 브랜치는 `claude/new-session-810fo5`.
- `checkhere/data/`(학생 출결 SQLite, 체크히어 로그인 크롬 프로필)는 **절대 커밋하지 않는다**. `.gitignore`에 들어 있다. 이 폴더 내용을 열어 보거나 다른 곳에 올리지 않는다.
- 실제 체크히어 값은 **확인을 거치는 승인 경로로만** 바꾼다: `checkhereRequests` 요청 → 승인 → 연결 프로그램 `/api/apply` → 다시 열어 확인(`checkhere/writeback.mjs` `applyVerified`) → `checkhereCurrent` 저장. 시험은 가상 학생·가짜 체크히어(`checkhere/tests/`)로 한다.
- 진단·로그·보고서의 학생 이름과 전화번호는 가린다.
- `firestore.rules`는 게시를 전제로 바꾸지 않는다. 규칙 변경이 필요하면 별도 초안 파일과 게시 안내를 만들고, **사용자가 Firebase 콘솔에서 직접 게시**한다.
- Firestore 규칙과 `checkhere/approval-core.mjs` `cleanRequest`의 날짜 범위는 `2026-10-22`까지다. 2기를 위해 넓히는 것은 사용자 확인 후에만 한다.
- Firestore에 출결을 쓰지 않는다(출결의 원본은 마스터시트). 비밀키는 서버(Vercel 환경변수, Apps Script 속성)에만 둔다. 담임은 자기 반만 본다.
- 중요한 결정마다 사용자에게 충분히 묻는다(사용자 요청).

## 2. 지금 상태

브랜치 `claude/new-session-810fo5` = `main`(2ac8f73, PR #10 병합) + 아래 3개. 이 3개는 **아직 main에 없다**(PR은 사용자 확인 후).

| 커밋 | 내용 |
|---|---|
| b42d8b5 | 체크히어 핸드오프 반영: 빠른·일괄 수집, 실시간 베타(`checkhere-live*.mjs`), 진단 도구. 연결 프로그램 build `20261013.4` |
| eccaa18 | 2기 베타 후속: `beta2.gs` 명부 먼저 쓰기·`중도탈락` 통일·기존 행 맞추기·출결판 Code.gs 표기, 출결대조 실시간 반영 버그, 자동 수집 10분 |
| bf55d12 | `/beta2` 가드가 `[실시간 베타]` 표시를 유지하도록 수정, Cowork 작업 요청 문서 |

관련 문서:

- `apps-script/beta2/README.md` — 2기 베타 마스터시트 설치·설치 기록·확인 규칙 완화·**이번 beta2.gs 수정 반영 순서**
- `docs/cowork/2026-10-13-checkhere-delete-and-beta2.md` — Cowork에 맡긴 일(체크히어 삭제 화면 읽기 전용 조사, beta2.gs 재반영, 백업 업로드)
- `docs/beta2-instant-edit-plan.md` — **출결대조 바로 고치기 + 체크히어 자동 반영 + 시간 삭제 설계**(클라우드 설계 워크플로 결과를 옮김)
- `docs/checkhere-handoff-review.md` — **핸드오프 코드 검토 결과**(확인된 문제와 고칠 방법)
- `docs/checkhere-live-beta.md`, `docs/checkhere-batch-collect.md` — 실시간 베타·일괄 수집 설명

## 2-1. Cowork 보고 뒤 상태와 사용자 결정 (2026-10-13 오후)

Cowork 보고서: `docs/cowork/2026-10-13-checkhere-delete-report.md`. 원본과 수정창 HTML, 캡처, 백업은 hint.kpc 드라이브의 `HINT Claude Code 전달` 폴더에 있다.

**지금 운영 상태**
- Apps Script에 저장된 `beta2.gs`는 bf55d12판이고, 트리거는 이 코드로 돈다.
- ~~배포 ①은 아직 버전 7(예전 코드)이다.~~ → 17:26에 버전 8로 해결됐다(아래 후속 결과). 아래 세 줄은 그 전의 상황이다.
  - 그래서 /beta2의 저장(`b2Save`)과 가져오기(`b2SyncNow`)는 예전 코드로 돈다.
  - 예전 코드로 가져오기가 돌면 B2_SYNC_LAST를 예전 형식으로 덮어쓰고, 사유 해석이 예전 방식이라 약 200행을 예전 값으로 되돌릴 수 있다.
  - **사용자가 배포 ①을 새 버전으로 올려야 한다.**
- 새 코드 첫 실행 결과: `legacyAdopted 0`, `updated 202`, `flagged 52`.
- '동기화 확인 필요'를 새 기준(`isConflictFlag`)으로 세면 53이다. 운영 화면(main)은 예전 기준이라 130으로 보인다. 브랜치를 배포해야 53으로 보인다.

**급한 문제: 트리거 실행 시간**
- 운영총괄이 자주 바뀌어 10분마다 전체 동기화가 돈다.
- 15:25~16:35 사이 8번 중 3번이 6분을 넘겨 중단됐다. 8번 합계가 약 26.5분이다.
- 하루 트리거 한도(무료 계정 90분)를 넘을 위험이 있다.

**사용자 결정**
1. 출결원장 `직접 입력` 54행(출처='직접 입력', 지문 빈칸)은 **운영총괄 값으로 한 번 맞춘다**. 첫 설치 때 예전 코드가 붙인 표시이고, 사람이 고친 행이 아니다. 이 중 53행이 충돌로 떠 있다.
2. 자동 동기화는 **평일 09:10~18:00에만** 돈다.
3. Apps Script에 **Google Sheets API 서비스를 추가한다**(17개 반을 한 번에 읽기 위해).
4. 데이터 확인 규칙(명부 D, 출결원장 C)은 '경고'로 둔다.

**작업 중 코드: `docs/wip/2026-10-13-beta2-sync-runtime.patch`**
- 클라우드 세션에서 위 결정대로 고친 `beta2.gs` 변경이다. **아직 시험하지 않았다.**
- 브랜치의 `beta2.gs`는 설치된 bf55d12판 그대로 두었다. 시험 전 코드가 시트에 들어가지 않게 하기 위해서다.
- `git apply docs/wip/2026-10-13-beta2-sync-runtime.patch`로 적용한 뒤 아래 시험을 만들고 통과시키고 나서 커밋한다. 커밋할 때 patch 파일은 지운다.
- 패치 내용:
  - `b2SyncTick`
    - 시간대 밖이면 바로 끝낸다(`B2.SYNC.window`, Script Properties `B2_SYNC_WINDOW`로 바꿀 수 있음).
    - 하루 사용 시간(`B2_RUN_USAGE`)이 60분을 넘으면 30분에 한 번만 돈다.
    - 6분에 끊긴 실행은 `B2_SYNC_RUNNING` 표시가 남아, 다음 실행이 `B2_SYNC_CUT`에 기록한다.
  - `b2ReadSource_`
    - Sheets API가 있으면 `Values.batchGet` 한 번으로 17개 반과 서류발급요청·반정보를 읽는다.
    - 없거나 실패하면 반마다 `getDisplayValues`로 읽는다.
  - 바뀐 반만 반영
    - 반마다 값 지문(`B2_SRC_HASH`)을 남긴다. 지문에는 버전·오늘 날짜·교육일자가 섞인다.
    - 값이 바뀐 반, 포털에서 저장한 반(`B2_DIRTY`, `b2Save`가 표시), 증빙 색이 바뀐 반만 처리한다.
    - 색이 바뀌었는지는 처리할 반 전부와, 나머지 반을 실행마다 4반씩 돌아가며 확인한다(`B2_SRC_COLOR`, `B2_COLOR_CURSOR`).
  - 출결원장 쓰기
    - `b2LedgerPlan_`이 바뀐 행만 고치고, 새 행은 아래에 붙이고, 없어진 동기화 행은 비운다.
    - 고칠 행이 80개를 넘으면 예전처럼 통째로 다시 쓴다.
    - 출결판은 유형이나 명부가 바뀐 반만 다시 그린다. 출결원장을 다시 읽지 않는다.
  - `b2Merge_`
    - 결과에 행 번호(`row`)를 싣고, 지울 행 목록(`removed`)을 돌려준다.
    - 출처가 '1기 동기화'이고 값이 운영총괄과 같으면 지문이 어긋나도 동기화 행으로 본다. 중간에 끊긴 쓰기를 복구하기 위해서다.
  - `b2AdoptLegacy_`: 결정 1을 구현한다. `B2_LEGACY_ADOPTED`를 '2'로 올린다.
  - 성공하면 `B2_SYNC_ERROR`를 지운다. 예전에는 한 번 생긴 오류 표시가 계속 남았다.
  - `b2SyncState_`가 `window`·`usage`·`cutAt`도 보낸다. 화면 표시는 아직 바꾸지 않았다.
- 남은 일:
  - **가짜 Google 서비스로 끝까지 도는 시험** `checkhere/tests/beta2-sync.test.mjs`. 가짜 SpreadsheetApp·DriveApp·PropertiesService·LockService·Utilities·Sheets와 시계를 쓴다.
    - 첫 실행(전체, 54행 맞추기)
    - 안 바뀐 실행(쓰기 0)
    - 한 반만 바뀐 실행(그 반만, 몇 행만 쓰기)
    - 색만 바뀐 경우(돌아가며 확인할 때 잡힘)
    - 포털 저장 뒤(`B2_DIRTY`)
    - API 방식과 시트 방식의 지문이 같은지
    - 시간대 밖·주말
    - 끊긴 실행 기록, 하루 상한
    - 고칠 행이 많을 때 통째로 쓰기
  - 화면 동기화 표시(`beta2-ui.mjs` `syncPill`)에 시간대와 '시간 초과 중단'을 표시한다.
  - 리뷰(쓰기 계획이 행을 잘못 고치지 않는지, 끊긴 쓰기 뒤 복구)를 한다.
  - `apps-script/beta2/README.md`의 반영 순서를 고친다:
    1. 코드 교체
    2. 서비스 + Google Sheets API 추가
    3. 배포 ① 새 버전(사용자)
    4. 첫 실행 뒤 `B2_SYNC_LAST`의 `mode:'api'`, `legacyAdopted 54` 안팎, '동기화 확인 필요' 개수 확인
- 패치를 넣기 전 임시 대책(사용자 판단): Apps Script 편집기 '트리거'에서 `b2SyncTick`을 30분 간격으로 바꾸거나 잠시 지운다(`b2RemoveTrigger`).

**체크히어 시간 삭제 (보고서 요약)**
- 시간을 지우는 길은 수정창의 `삭제` 버튼 하나뿐이다.
  - `getByRole('button',{name:'삭제',exact:true})`
  - 1교시 칸은 table[1]의 nth(1)에서 열리는 「1교시 시간 수정」, 퇴실 칸은 nth(2)에서 열리는 「퇴실 시간 수정」이다.
  - 입실 칸(nth(0))은 눌러도 반응이 없다.
- 창은 `div.react-draggable`이다(MUI Dialog가 아님). 입력 칸은 `#name`·`#prevTime`(disabled), `#modifyTime`(text, maxlength 8), `#memoByAdmin`이다.
- `#modifyTime`은 비울 수 있다. 빈 칸으로 `변경`을 눌렀을 때 어떻게 되는지는 시험하지 않았다.
- 외출 창에는 `인정하기`·`철회하기`만 있다. **외출 기록은 체크히어에서 지우거나 시간을 고칠 수 없다.**
- 창을 열고 닫을 때 API 요청이 없다. 시험용 반·학생도 없다.
- ~~실제 `삭제`는 아직 아무도 눌러 보지 않았다.~~ → 후속 작업에서 확인했다(아래 후속 결과). 아래 두 줄은 그 전의 상황이다.
  - 확인창 문구, 두 번 눌러야 하는지(사용자 말로는 가끔 두 번), 삭제 뒤 칸 표시는 사용자가 직접 눌러 보고 알려 주기로 했다.
  - 그 전에는 `collector.deleteTime`을 실제로 켜지 않는다. 짜더라도 다시 읽어 확인하는 경로와 기능 스위치 뒤에 둔다.

**Cowork 후속 결과 (17:30 무렵, `docs/cowork/2026-10-13-followup.md`)**
- 배포 ①을 **버전 8**(bf55d12)로 올렸다. 배포 ID와 주소는 그대로다. 이제 웹앱도 새 코드로 돈다.
  - 배포 ②(버전 5)는 담임 PIN 포털 주소로 보여 그대로 두었다.
- `b2SyncTick` 트리거를 **임시로 30분 간격**으로 바꿨다.
  - 오늘 13번 실행에 시간 초과 4번, 합계 약 43분이었다.
  - 패치를 넣을 때 `b2InstallTrigger`로 10분 간격으로 되돌린다(패치의 시간대 제한이 그 전제다).
- 새 문제: 시트를 열 때 Code.gs의 `onOpen`이 부르는 `rebuildAll`(17개 반 출결판 다시 그리기)이 단순 트리거 한도 30초를 넘겼다(2번). 명부가 497명으로 늘어난 뒤 생긴 것으로 보인다.
  - beta2의 출결판 그리기와 겹치는 일이니 함께 정리할 것.
- **체크히어 삭제 실제 동작 (1건 지웠다가 되돌림, 원래 값 확인 완료)**
  - `삭제`를 한 번 누르면 확인창 없이 바로 지워지고 수정창이 닫힌다. 요청은 `DELETE …/api/v3/history/event/delete`(200)이다.
  - **퇴실을 지우면 같은 행의 1교시 칸(collector의 entry = nth(1))과 총 강의 참여 시간도 `-`가 된다.** 입실(nth(0))은 그대로다. 다시 읽어 검증할 때 이것을 실패로 보면 안 된다.
  - 1교시만 지우면 어떻게 되는지는 시험하지 않았다.
  - 기록이 없는 칸(`-`)의 수정창: `삭제` 버튼 없음, `#prevTime` = `-`, `#modifyTime` 기본값 `00:00:00`. 시간을 넣고 `변경`하면 새로 생긴다(`PUT …/history/event/update`). 그래서 지운 시간은 되돌릴 수 있다.
  - `history/event/normalize`(PUT)는 '강의시간 출석 정상처리' 버튼용이다. 쓰지 않는다.

**백업**: `master-before-*.txt` 3개와 `master-now-Code.gs.txt`가 드라이브 폴더에 있다. 커밋 전에 비밀값과 개인정보를 확인한다(5절 6번).

## 2-2. Cowork 10/14 확인 결과와 할 일 (`docs/cowork/2026-10-14-checkhere-api.md`)

**체크히어 요청 형식** (화면 코드로 확인. 실제 요청은 보내지 않았다)
- 삭제: `DELETE https://checkhere-admin-api.ihereapp.com/api/v3/history/event/delete`
  - 본문 `{scheduleId, typeEvent:"ATTEND"|"COMPLETE", attendeeId, baseTime, existEventId}`
- 수정: `PUT …/history/event/update`
  - 본문은 위 다섯 항목에 `time:"YYYY-MM-DDTHH:MM:SS"`, `memoByAdmin:문자열|null`을 더한다.
  - 빈 칸에 새로 넣을 때도 update에 `existEventId:null`을 쓴다. create 경로는 없다.
  - 시간을 비우고 `변경`하면 요청이 나가지 않는다. 그래서 지우기는 delete로만 한다.
- 항목 값
  - `baseTime`: COMPLETE면 마지막 교시의 `timeEnd`, ATTEND면 그 교시의 `timeStart`(예: `2026-10-12T09:00:00`).
  - `existEventId`: COMPLETE면 `eventList`의 COMPLETE `eventId`, ATTEND면 `type==="ATTEND" && timeIndex===교시`인 `eventId`, 없으면 null.
- 인증: `Authorization: Bearer <session.accessToken>`. 토큰은 `GET check.ihereapp.com/api/auth/session`에서 받는다. `Content-Type: application/json`.
  - 연결 프로그램의 로그인된 전용 크롬 안에서 보내면 된다. 토큰을 저장하거나 기록하지 않는다.
- 출결상세: `GET …/history/attendee/detail/academy/{ac}/schedule/{id}/type/STUDENT/isRealTime/false`
  - `data.eventResultList[]` 학생마다 `{attendeeId, …, eventList[]}`가 있다.
  - 이벤트는 `{eventId(null 가능), time, baseTime, timeIndex, type: ENTER/PASS/ATTEND/COMPLETE, status, memoByAdmin}`이다.
  - `eventId`가 null이면 다른 기록에서 계산된 값이다.
    - 체크인한 학생: ENTER(번호 있음) + PASS(1교시, 번호 없음) + COMPLETE
    - 관리자가 1교시를 넣은 학생: ENTER(번호 없음) + ATTEND(번호 있음) + COMPLETE

**삭제 안전 규칙 (사용자 결정, 꼭 반영)**
- 지우기는 **`eventId`가 있는 칸에만** 허용한다. 퇴실 COMPLETE와 관리자가 넣은 1교시 ATTEND가 해당한다.
- PASS 1교시(번호 없음)와 ENTER(입실)는 절대 지우지 않는다.
  - ENTER는 화면에서 되돌릴 방법이 없다.
  - PASS를 지울 때 서버가 어떻게 동작하는지 모른다.
  - 화면에서는 × 를 잠그고 이유를 표시한다.
- 지웠다가 다시 넣으면 값은 같아도 새 관리자 기록(새 `eventId`)이 된다. 변경 기록에 남긴다.
- 결과: 체크인한 학생을 '결석'으로 맞출 때 체크히어에서 지울 수 있는 것은 퇴실(COMPLETE)뿐이다.
  - 지우면 1교시와 총 참여 시간은 `-`로 보이고, 입실 시간은 남는다.
  - 화면안(Artifact 「체크히어 실시간 반영 화면안」)의 '결석인데 시간 있음' 처리를 이 기준으로 맞춘다.

**마스터시트 트리거 (10/13 17:30 ~ 10/14 15:30, 30분 간격)**
- `b2SyncTick`은 44번 돌았고 합계 약 37분이다. 일과 중 14번이 약 2,000초를 차지했고, 밤에는 1~4초였다.
- 시간 초과 2번(11:51, 15:21)이 있었다.
- 실패 1번(13:51): `Service Spreadsheets failed while accessing document` @ `b2WriteLedger_`.
  - 같은 때 웹앱 doPost 7번과 onEdit 1번이 함께 돌았다.
  - 패치(`docs/wip/`)의 '바뀐 행만 쓰기'에 더해, **이런 일시 오류는 몇 초 쉬고 다시 시도**하게 넣는다. 쓰기는 문서 잠금 안에서만 한다.
  - 고친 뒤 트리거를 10분으로 되돌린다.
- `onOpen` 시간 초과는 0번이었지만, 13:38에 27.8초로 한도(30초)에 거의 닿았다.
  - 원인: `apps-script/master/Code.gs`(지금 Apps Script와 같음, SHA-256 ef9ad3c0…) 18~28행의 `onOpen`이 메뉴를 만든 뒤 `rebuildAll()`을 부른다. 이 함수는 17개 반 출결판을 다 그린다.
  - 가장 간단한 해결은 `onOpen`에서 `rebuildAll()` 호출을 빼는 것이다. '출결판 새로고침' 메뉴는 남긴다.
  - beta2 동기화와 저장이 바뀐 반의 출결판을 다시 그린다. 이것으로 충분한지 확인하고, Code.gs `onEdit`도 확인한 뒤 바꾼다(사용자 확인).

## 2-3. 로컬 세션 진행 (2026-10-14)

사용자 지시 순서: ① 시험 기준선 → ② 동기화 실행 시간 패치 시험·완성(일시 오류 다시 시도 포함) → ③ onOpen 30초 → ④ 출결대조 바로 고치기 + 체크히어 빠른 반영(삭제는 기록 번호 있는 칸만). Apps Script 반영·배포·트리거 10분 복구는 시험 뒤 사용자 확인을 받고 한다.

- ① 기준선: 4-1절.
- ② `docs/wip` 패치를 적용하고 고쳤다(패치 파일은 커밋할 때 지운다). 시험 `checkhere/tests/beta2-sync.test.mjs`(가짜 Google 서비스 `checkhere/tests/gas-fake.mjs`).
  - 패치에 더한 것: 일시 오류 다시 시도(2초·6초), 쓰기 직전 행 위치 확인, 행 순서를 바꾸지 않는 쓰기(끊겨도 복구되는 순서), 날이 바뀐 첫 실행에 출결판 전체, 남은 출결판 표시(`B2_PENDING_BOARDS`), 색 확인 한 바퀴(`B2_COLOR_LAP`), 기존 행 맞추기를 반마다·이번 실행 범위만, 설치 뒤 사람이 고친 `직접 입력` 행 제외, 단계별 시간 `t`, /beta2 표시(쉬는 시간·시간 초과 중단).
  - 별도 검토(서브 에이전트)에서 나온 6건을 모두 고쳤다(정렬 다시 쓰기 제거, 범위 밖 `*` 표시, 쓰기 순서, 끊긴 뒤 출결판·변경 번호, 다시 시도 때 위치 확인, 오류 반이 빠른 건너뛰기를 막음).
  - 두 번째 검토의 6건도 고쳤다: 바뀐 행만 쓰기(덩어리 다시 쓰기 제거), 출결판 실패를 반마다 가두고 3번 뒤 포기, 쓰다 만 상태의 다시 시도 허용, 오류 반은 새로 읽은 실행 뒤 두 번 더, 한 반 가져오기는 남은 출결판을 건드리지 않음, **S열 지문을 일반 텍스트로**(약 1.6%의 지문이 숫자로 바뀌던 기존 문제).
  - 사용자 결정(2026-10-14): 설치 뒤 사람이 고친 `직접 입력` 행은 맞추기에서 뺀다. 커밋 뒤 Cowork로 반영한다(10분 트리거 복구는 첫 실행 결과를 보고 다시 확인).
- ③ `apps-script/master/Code.gs`: `onOpen`에서 `rebuildAll` 뺌, `rebuildAll` 읽기 먼저·쓰기 나중(결과가 예전과 같음을 확인), `onEdit`은 고친 행의 반만, `removeRow_` 잠금, 잠금 대기 20초, 작은 탭 건너뜀. 시험 `checkhere/tests/master-code.test.mjs`.
  - 남는 점: 평일 09:10 전에는 오늘 열이 출결판에 없다(첫 동기화가 그림, 메뉴로 바로 그릴 수 있음). 2기 마스터처럼 동기화가 없는 시트는 하루 한 번 그리는 트리거가 따로 필요하다.
- ④ 사용자 결정(2026-10-14): 체크히어 쓰기는 **수정창 버튼** 방식, 자동 반영은 **메모만**(`memo-only`), **오늘만 자동**(지난 날은 `체크히어 맞추기` 버튼), 3초 되돌리기는 **출결원장과 요청 모두**. `docs/beta2-instant-edit-plan.md` 10장에 적음.
- ④ 먼저 할 일(삭제 전 필수, 검토 문서): 1번 작업 잠금 경쟁, 3번 중복 요청 검사, 4번 `retry_` 가로채기, 6번 수집 중단 — 고치고 커밋함(사용자 확인 2026-10-14), 연결 프로그램 build `20261014.1`. 운영 중인 연결 프로그램(`Documents\Codex\2026-09-07\gk\hint-attendance-beta`)은 바꾸지 않았다.
- ④ 순수 대응표 모듈 `beta2-checkhere-core.mjs`(시험 `checkhere/tests/beta2-checkhere-core.test.mjs`)와 병원 분류 넓히기(`checkhere-proposal-core.mjs`)도 작업 중이며 커밋 전.
- ②·③은 커밋했고 Apps Script 반영은 Cowork(요청서 아래)로 한다. 반영 전에는 운영 중인 Apps Script가 그대로다.
- 반영 순서·Cowork 요청서: `apps-script/beta2/README.md` 「동기화 실행 시간 줄이기 반영 순서」, `docs/cowork/2026-10-14-sync-runtime-deploy.md`.

## 3. 이 PC에서 준비

1. 저장소를 받는다(비공개 저장소면 Git 로그인 창이 뜬다).
   ```
   git clone https://github.com/kpcjtkim-design/hint-knewdeal-portal
   cd hint-knewdeal-portal
   git checkout claude/new-session-810fo5
   ```
2. 연결 프로그램은 Node 24 이상이 필요하다(`checkhere/package.json` engines). `checkhere` 폴더에서 `npm install`.
3. 지금 운영 중인 연결 프로그램 폴더(Cowork가 쓰던 `hint-attendance-beta`)의 `checkhere/data/`를 새 폴더의 `checkhere/data/`로 **복사만** 하면 수집 이력(빠른·증분 수집 비교 기준)과 저장된 강의 주소가 이어진다. 복사하지 않으면 첫 수집이 느릴 뿐 동작은 같다. 어느 쪽이든 커밋하지 않는다.
4. 그 로그인 프로필이 담긴 zip이 한 번 외부로 전달됐으므로, 체크히어에 **다시 로그인**(가능하면 다른 기기 로그아웃·비밀번호 변경)을 권한다.
5. 실행: `checkhere/체크히어 시작.cmd`. `Start.ps1`은 build 값이 다르면 실행 중인 옛 버전을 다시 시작한다.

## 4. 시험

```
cd checkhere
node --test tests/*.test.mjs
```

- 클라우드에서는 `NODE_PATH=/opt/node22/lib/node_modules`로 돌렸고 환경 탓 실패 7건이 기준선이었다. 이 PC는 환경이 달라 결과가 다를 수 있으니 **코드를 바꾸기 전에 이 PC의 기준선을 먼저 기록**한다.
- 브라우저 시험은 Playwright가 설치된 Chrome을 쓴다.
- `checkhere/tests/live-ui.test.mjs`는 오늘 날짜를 써서 2026-10-23부터 실패한다(검토 문서 참고, 날짜 고정으로 고칠 것).

### 4-1. 수집 PC 기준선 (2026-10-14, 코드 바꾸기 전 6889025)

- 이 PC에는 PATH에 Node가 없다. `Start.ps1`이 쓰는 Codex 런타임 Node를 쓴다: `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`(v24.19.0). playwright 1.62.1도 같은 런타임에 있어 `collector.mjs`의 `loadPlaywright`가 찾는다(`npm install` 안 함). Chrome 155.
- 실행: `checkhere`에서 `"<위 node.exe>" --test tests/*.test.mjs` (약 14분).
- **실제 연결 프로그램이 8765에서 돌고 있으면** `live-ui.test.mjs`는 같은 포트를 열지 못해 실패한다(EADDRINUSE). 실제 연결 프로그램에는 아무 요청도 가지 않는다. 이 시험은 실제 연결 프로그램을 끈 때만 돌리거나 포트를 바꿔야 한다.
- 결과: **380개 중 361 통과, 19 실패**. 실패는 모두 환경·날짜 때문이다.
  - Playwright 내장 Chromium 없음(`chromium.launch`에 `channel:'chrome'` 없음) 10건: `batch-sync`(1), `batch-ui`(1), `incremental-sync`(1), `page-data`(3), `probe`(4). `probe.test.mjs`는 브라우저 실행 실패 뒤 멈춰 있어 그 시험 프로세스만 끝냈다.
  - 화면 요소를 30초 기다리다 실패 6건(혼자 돌려도 같음, Chrome 155의 로컬 네트워크 접근 확인 때문으로 추정): `attendance-beta-ui`, `portal-navigation-ui`, `proposal-source-ui`, `proposal-ui`, `review-ui`, `survey-ui`. 클라우드 기준선 7건 중 6건과 같다.
  - 날짜 고정 안 된 시험 1건: `firestore-efficiency`(오늘 날짜 대신 2026-09-23을 기대). 클라우드 기준선의 나머지 1건과 같다.
  - `live-ui` 1건(위 8765), `approval-sync-bridge` 1건(병렬 실행 중 `test-results/` 폴더가 아직 없어서. 혼자 돌리면 통과).

## 5. 다음 일 (순서)

1. **기준선 기록**(4절).
2. **급한 일: 트리거 실행 시간**(2-1절). 패치 적용 → 가짜 서비스 시험 → 리뷰 → 커밋 → README 반영 순서. 사용자는 배포 ①을 새 버전으로 올린다. Apps Script 반영은 사용자 확인 뒤 Cowork 또는 `clasp`로 한다.
3. **출결대조 바로 고치기**(`docs/beta2-instant-edit-plan.md`의 "지금" 단계): 칸에서 바로 수정·즉시 저장, 3초 되돌리기 후 체크히어 자동 요청, 행별 상태, 중계 상태 표시, 시간 삭제 버튼(잠금 + 이유), Firestore 규칙 초안(별도 파일, 게시는 사용자).
4. **검토 문서의 "지금" 항목 수정**(`docs/checkhere-handoff-review.md`). 연결 프로그램 파일(`server.mjs`, `collector.mjs`, `day-data.mjs`)을 고치면 build 값(`server.mjs`와 `Start.ps1` 두 곳)을 올린다. 특히 busy 잠금 경쟁은 시간 삭제가 `/api/apply`로 들어가기 전에 고친다.
5. **시간 삭제 실제 동작**(Cowork 보고 뒤): 설계 문서의 "Cowork 보고 뒤" 단계. 규칙 초안 게시는 사용자가 한다.
6. **`apps-script/master/`에 백업 추가**: Downloads의 `master-backup-20261013_*`(이전·현재 Code.gs, Sidebar.html, Portal.html). 커밋 전에 키·비밀번호·개인정보가 없는지 확인하고, 있으면 사용자에게 묻는다.
7. **beta2.gs 재반영**: `apps-script/beta2/README.md` "이번 beta2.gs 수정 반영 순서". Apps Script 편집기에서 하거나(Cowork), 사용자가 원하면 `clasp`로 올리고 배포 ①을 새 버전으로 업데이트한다. 반영 뒤 `B2_SYNC_LAST`의 `legacyAdopted`와 출결원장 '동기화 확인' 개수를 기록한다.
8. **PR·병합**: 사용자 확인 후. Vercel 미리보기 배포가 성공하는지 본다.

## 6. 아직 정하지 않은 것

- 2기 교육 날짜(정해지면 반·담임·학생 명단과 함께 2기용으로 다시 빌드, `apps-script/beta2/README.md` "2기 빌딩 때").
- 확인 규칙을 '경고'에서 '거부'로 되돌릴지(명부 D, 출결원장 C — README "데이터 확인 규칙 완화").
- Firestore 규칙·`cleanRequest` 날짜 범위를 2기까지 넓히는 시점.

## 7. 로컬 세션 첫 메시지 예시

> `docs/local-session-start.md`를 먼저 읽고, 거기 적힌 규칙을 지키면서 5절 순서대로 이어서 해줘. 시험 기준선부터 기록하고, Cowork 보고(`checkhere-delete-report.md`)가 있는지 확인해서 알려줘.
