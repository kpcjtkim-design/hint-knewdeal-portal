# 체크히어 시간 삭제 켜는 순서 (2026-10-14)

/beta2 출결대조에서 체크히어 퇴실 시간(기록 번호가 있는 칸)을 지우는 기능을 실제로 켜는 순서다. 코드는 들어가 있지만 아래 **세 관문이 모두 열려야** 켜진다(`beta2-checkhere-core.mjs` `deletionGate`). 하나라도 닫혀 있으면 /beta2의 ×는 꺼져 있고 결석 저장은 '보류'로 남는다.

| 관문 | 무엇 | 누가 |
|---|---|---|
| G1 | `settings/checkhereFeatures.timeDeleteRules` = `true` | 사용자(Firebase 콘솔) |
| G2 | 중계 신호 `settings/checkhereRelay`가 `state:'running'`, 3분 안, `capabilities`에 `time-delete-v1` | 수집 PC에서 새 연결 프로그램 + 중계 탭 |
| G3 | 그 화면에서 Firestore 권한 거절(permission-denied)을 보지 않음 | 규칙 게시(사용자) |

삭제 안전 규칙(사용자 결정 2026-10-14): 기록 번호(eventId)가 있는 칸만 지운다. 퇴실(COMPLETE)과 관리자가 넣은 1교시(ATTEND)가 해당하고, 체크인으로 계산된 1교시(PASS)와 실제 입실(ENTER)은 절대 지우지 않는다. 체크인한 학생은 1교시에 사유를 저장한 적이 있어도 퇴실만 지운다(`checkhere/rules.mjs` `timeDeleteRefusal`). 지우기는 수정창의 `삭제` 버튼으로만 하고, 다시 열어 확인한다(`checkhere/writeback.mjs` `applyVerified`). 승인 뒤 체크히어 시간이 바뀌었으면 지우지 않고 '원본 변경'으로 끝난다.

## 1. 웹 코드 배포 (사용자 확인 후)

1. 브랜치 커밋 → push → PR 병합 → Vercel 배포. 바뀌는 화면: /beta2 출결대조, 1기 운영포털 체크히어 요청 목록, `/checkhere-live.html`(중계 탭).
2. 배포 뒤 /beta2와 중계 탭을 **강력 새로고침**(Ctrl+Shift+R). `beta2-admin.mjs`가 `beta2-ledger.mjs`·`beta2-checkhere-sync.mjs`를 버전 없이 불러오므로 옛 코드가 남을 수 있다.
3. 확인: /beta2 출결대조 도구줄에 '중계 꺼짐' 또는 '수집 PC 중계 작동 중' 표시가 보이면 새 코드다.

## 2. 수집 PC 연결 프로그램 바꾸기 (build `20261014.2`)

지금 운영 중인 연결 프로그램은 다른 폴더(`Documents\Codex\2026-09-07\gk\hint-attendance-beta`)에서 돈다. 이 저장소 폴더로 옮기거나 그 폴더를 새 코드로 바꾼다.

1. 수집·반영이 없는 시간에 한다(`Start.ps1`은 작업 중이면 재시작을 거절한다).
2. 이 저장소로 옮길 때: 옛 폴더의 `checkhere/data/`를 이 저장소 `checkhere/data/`로 **복사만** 한다(수집 이력·강의 주소·로그인 프로필, 커밋 금지). 복사하지 않으면 전용 크롬에서 체크히어에 다시 로그인한다.
3. 이 저장소의 `checkhere/체크히어 시작.cmd`를 실행한다. 옛 연결 프로그램(build `20261014.1` 이하)이 돌고 있으면 끄고 새 것을 띄운다.
4. 연결 키가 바뀐다. 중계 탭에서 '중계 멈춤' → 새 키 붙여넣기 → '중계 시작'. 운영포털 체크히어 탭도 새 키를 넣는다.
5. G2 확인: Firebase 콘솔 데이터 탭에서 `settings/checkhereRelay`를 연다.
   - `state` = `running`, `at`이 1~2분 안, `build` = `20261014.2`, `capabilities`에 `time-delete-v1`.
   - 중계 탭은 작동 중 약 1분마다 이 문서를 고친다. 학생 이름은 들어 있지 않다.

## 3. 규칙 게시 (사용자)

`docs/checkhere-time-delete-rules.md`의 '게시 안내' 1~5번. 게시 전에는 삭제 요청 문서를 만들 수 없다(G3).

## 4. 깃발 켜기와 첫 실제 삭제

체크히어에는 시험용 반·학생이 없다(Cowork 확인). 그래서 첫 삭제는 **실제로 지워야 하는 경우**(예: 결석인 학생에게 퇴실 시간이 잘못 남은 경우)에 사용자가 지켜보며 한다. 삭제 요청은 /beta2의 ×와 결석 저장에서만 만들어지고, 이 화면은 깃발(G1)이 있어야 켜지므로 깃발을 먼저 켠다.

1. 데이터 탭에서 `settings/checkhereFeatures` 문서에 `timeDeleteRules`(boolean) `true`.
2. /beta2 출결대조에서 그 학생 행: 퇴실 옆 ×가 켜졌는지 본다(꺼져 있으면 title에 이유). × → 확인창(지울 시간과 '실제 입실 기록은 남습니다') → 3초 되돌리기 → 요청 1건.
3. 중계가 처리한 뒤 확인할 것:
   - 체크히어 화면(새로고침): 퇴실 `-`, 1교시와 총 참여 시간도 `-`(체크인 학생), 입실 시간은 그대로.
   - 요청 상태 '완료', 결과 글에 '퇴실 시간 삭제 확인'(1기 요청 목록·/beta2 상태 칩). Firestore `result.message`에는 이 글이 없고 `result.results[].deleted`로 보인다.
   - `classes/{반}/checkhereCurrent/{날짜}`의 그 학생 `exit`가 비었음.
4. 이상하면 바로 5절로 끈다.

**관리자가 넣은 1교시(ATTEND) 삭제는 실제 체크히어에서 확인한 적이 없다.** 코드는 체크인하지 않은 학생(입실 기록 번호 없음)의 ATTEND 1교시만 허용한다. 처음에는 퇴실 삭제만 쓰고, 1교시 삭제는 Cowork나 사용자가 한 번 확인한 뒤에 쓰기를 권한다.

## 5. 끄기와 되돌리기

- 끄기: `settings/checkhereFeatures.timeDeleteRules`를 `false`로 바꾸거나 문서를 지운다(G1). 중계를 멈춰도 새 삭제는 반영되지 않는다(대기로 남음).
- 잘못 지운 퇴실 되돌리기: 같은 칸에 시간을 다시 넣는다(/beta2 직접 요청이나 1기 요청으로 퇴실 시간 요청). 체크히어는 새 관리자 기록(새 기록 번호)으로 만든다. 지우고 다시 넣은 일은 변경 기록에 남는다.
- 실제 입실(ENTER)은 체크히어 화면에서 되돌릴 방법이 없다. 그래서 어떤 경로로도 지우지 않는다.

## 6. 참고

- 삭제 요청은 1기 '실패 건 다시 처리'와 일괄 승인에서 빠진다(개별 승인만, `checkhere-live-core.mjs` `retryInLedger`).
- 직접 수정(연결 프로그램 화면의 바로 수정)은 삭제를 받지 않는다.
- 연결 프로그램이 `time-delete-v1`을 모르면(옛 build) 중계가 대기 중인 삭제 요청을 반려하고, 연결 프로그램도 `/api/apply` 전에 거절한다.
