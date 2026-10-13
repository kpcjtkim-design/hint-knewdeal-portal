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
