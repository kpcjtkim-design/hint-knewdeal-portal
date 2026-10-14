# 2기 베타 출결대조 즉시 수정 · 체크히어 자동 반영 · 시간 삭제 계획 — 2026-10-13

클라우드 세션에서 만든 설계(스크래치패드 `instant-plan.json`: 조사 영역 4개, 계획 11단계, 검토 2건 — 검토 1은 8개, 검토 2는 11개 문제)를 로컬 세션(수집 PC의 Claude Code)이 이어서 구현할 수 있게 저장소로 옮긴 문서다. 원본 JSON은 클라우드 세션 안에만 있어 수집 PC에서는 볼 수 없다. 이 문서가 원본을 대신한다. 이 문서에서 "검토 1-3"은 검토 1의 3번 문제를 뜻한다.
줄 번호는 브랜치 `claude/new-session-810fo5`의 HEAD `1890f91`에서 파일을 다시 열어 확인했다(`1890f91`은 `bf55d12` 다음 커밋으로 문서와 `.vercelignore`만 바뀌었고 코드 파일은 `bf55d12`와 같다). 코드를 고치기 시작하면 줄 번호가 밀리므로 그때마다 다시 확인한다.

사용자 요청 원문:

> 관리자 출결대조에서 바로바로 출결 바꾸고 사유도 바꾸고 체크히어도 바로바로 변경 가능한 형태로 만들어줘. 그리고 시간 삭제 기능도 넣어줘. 아마 이러면 체크히어 수집 코드도 바꿔야겟지?

답: 그렇다. 지금 단계(아래 "지금 할 것")는 수집 PC 연결 프로그램(`checkhere/server.mjs` 등)을 바꾸지 않는다. 시간 삭제는 연결 프로그램(`collector.write`, `writeback`, `server.mjs`)과 공유 모듈을 바꿔야 하고, Cowork 보고서를 받은 뒤에 한다. 10분 자동 수집(읽기)은 바뀌지 않는다.

## 용어 (처음 읽는 세션용)

- **수집 PC / 연결 프로그램(bridge)**: 체크히어 전용 크롬을 띄워 출결을 읽고 쓰는 Windows PC와 그 위에서 도는 `checkhere/server.mjs`(주소 `http://127.0.0.1:8765`). `checkhere/체크히어 시작.cmd` → `Start.ps1`로 실행한다. **build**는 연결 프로그램 버전 문자열(`server.mjs:70`과 `Start.ps1:11`에 같은 값). 값이 다르면 `Start.ps1`이 쉬고 있는 옛 연결 프로그램을 재시작한다.
- **capabilities(능력)**: 연결 프로그램이 `/api/session`·`/api/state`로 알리는 기능 이름 목록(`server.mjs:17`). 예: 이번에 AFTER 단계에서 추가할 `time-delete-v1`.
- **중계(relay) / 중계 탭**: 수집 PC에서 hint.kpc 계정으로 연 `/checkhere-live.html`의 '수집 PC 중계' 패널(`checkhere-live.mjs:161-197`, 로직은 `checkhere-live-relay.mjs`). 관리자가 만든 **실시간 요청**을 골라 체크히어 값을 다시 읽고(미리보기) → 기준 지문 확인 → 승인 → 연결 프로그램 `/api/apply`로 보낸다. 평일 08:50~18:40에는 10분마다 오늘 출결도 다시 수집한다(`checkhere-live-core.mjs:10-11`).
- **중계 신호(heartbeat)**: 이번에 새로 만들 `settings/checkhereRelay` 문서. 중계 탭이 "작동 중, 능력 목록, 마지막 신호 시각"을 약 1분마다 적는다. /beta2는 이것으로 "중계 꺼짐"을 보여 준다. `settings`는 담임도 읽으므로 이름을 넣지 않는다.
- **실시간 요청**: `checkhereRequests` 문서 중 근거(reason)가 `[실시간 베타]`로 시작하고 `[기준:xxxxxxxx]`로 끝나는 것(`isLiveRequest`, `checkhere-live-core.mjs:25`). 중계는 이것만 자동 처리한다.
- **기준 지문(baseTag, `[기준:…]` 태그)**: `baseTag(record, fields)` = 기록 id와 **바뀌는 항목들의 그 시점 값**으로 만든 8자리 16진수 해시(`checkhere-live-core.mjs:23`). 요청을 만들 때 근거 끝에 붙인다. 중계가 체크히어를 다시 읽어 같은 계산을 했을 때 다르면 "그사이 체크히어 값이 바뀜"으로 보고 반려한다(`checkhere-live-relay.mjs:93`). 바뀌지 않는 항목의 변화는 지문에 영향이 없다.
- **record(체크히어 기록)**: `classes/{반}/checkhereCurrent/{날짜}` 문서 안의 학생 1명 기록. **live·complete** = `source==='live' && readState==='complete'`(수정창까지 다 읽은 최신 기록). **rawEntry** = 표 0번 칸 실제 입실(ENTER), **entry** = 1번 칸 교시 입실(ATTEND/PASS), **exit** = 2번 칸 퇴실. 연결 프로그램은 entry·exit와 그 메모만 고칠 수 있다. **version** = 기록 내용 해시(`checkhere/identity.mjs:6`).
- **sig(행 지문) / before / CONFLICT**: 출결원장 한 행(A~K열)의 지문. 저장할 때 화면이 본 sig를 `before`로 보내면 `b2Save`가 그사이 바뀌었는지 보고 `CONFLICT`로 막는다(`apps-script/beta2/beta2.gs:653`). 저장 결과로 새 sig가 돌아온다.
- **진행 중 요청(active)**: 상태가 `pending`(승인 대기) · `approved`(승인됨) · `applying`(반영 중)인 요청.
- **보류(hold)**: 두 곳에서 쓴다. (1) **보류 항목** — 새 동기화 모듈(4.2)이 학생마다 브라우저 메모리에 들고 있는 "아직 체크히어로 보내지 않은 결정". 3초 되돌리기 중이거나, 조건(`retryWhen`)이 풀리길 기다리는 상태다. Firestore에 쓰지 않으며 탭을 닫으면 사라진다. (2) **`hold` 결과** — 대응표(3장)가 "지금은 보내지 않음, 이유 표시"로 낸 결과. `hold` 결과는 보통 보류 항목으로 남아 다시 계산된다.
- **자동 요청 / 직접 요청 / 초안**: 자동 요청 = 이번에 만들 것으로, 출결원장 저장 3초 뒤 동기화 모듈이 만드는 실시간 요청(근거에 `출결대조 자동`이 들어감, `isAutoLedgerRequest`). 직접 요청 = 출결대조에 이미 있는 '체크히어 요청' 제안 패널(`createProposalReview`, `beta2-ledger.mjs:30`)로 관리자가 따로 만드는 요청(이름만 '직접 요청'으로 바꿔 남김). 초안 = 행 안 입력칸에서 고쳤지만 아직 `b2Save`로 보내지 않은 값.
- **가드**: /beta2에서만 Firestore SDK 주소를 `beta2-firestore-guard.mjs`로 돌려(import map, `index.html:6`) 체크히어 요청 경로만 쓰게 하고, 새 요청 근거에 `[2기 베타]`를 넣는 모듈.
- **동기화 확인 / 베타 수정**: 출결원장 T열 '동기화 확인'은 10분 동기화가 운영총괄 값과 다르다고 남긴 표시(출결대조 필터 '동기화 확인', `beta2-core.mjs:28`). /beta2에서 저장한 행은 R열 출처가 '베타 수정'이 되고 T열이 지워지며(`beta2.gs:661`), 그 뒤로 10분 동기화가 그 행을 덮어쓰지 않고, 운영총괄과 다르면 T열에 다시 표시만 한다(`beta2-ledger.mjs:58` 안내문). 행 안 즉시 저장도 똑같다.
- **Cowork**: 사용자 PC 화면 작업(Apps Script 편집기, 체크히어 화면, Drive)을 맡는 Claude. 저장소는 고치지 않는다.
- **NOW / AFTER**: NOW = Cowork 보고서 없이 지금 할 일(연결 프로그램 파일은 안 바꿈). AFTER = Cowork 보고서(체크히어 시간 삭제 방법)를 받은 뒤 할 일.

---

## 0. 꼭 지킬 것

- `checkhere/data/`는 커밋하지 않고 어디에도 올리지 않는다(`.gitignore:1`).
- `firestore.rules`는 이 작업에서 바꾸지 않는다. 시간 삭제용 규칙은 **별도 초안 파일**에만 쓴다. 게시는 사용자가 Firebase 콘솔에서 직접 한다. `firebase deploy`를 실행하지 않는다(`firebase.json`이 `firestore.rules`를 가리키므로 실행하면 그대로 게시된다). `.github/workflows/`에는 규칙을 배포하는 워크플로가 없다(확인함). 커밋 메시지·문서에 "규칙 게시함"처럼 게시를 암시하는 말을 쓰지 않는다.
- 체크히어 실제 기록은 검증된 경로로만 바꾼다: `checkhereRequests` 요청 → 승인 → 연결 프로그램 `/api/apply` → 다시 읽어 확인(`checkhere/writeback.mjs:19-50` `applyVerified`). 수정창을 직접 누르는 임시 스크립트, `collector.write()` 직접 호출, 수동 클릭으로 바꾸지 않는다. 11단계의 실제 삭제 시험도 사용자가 허락한 경우에만, 시험용 학생 1명으로 한 번, **이 같은 요청 → 승인 → `/api/apply` → 다시 읽기 경로로** 한다. (Cowork 작업 요청서 1번 7항의 "사용자가 허락하면 시험용 학생으로 삭제를 한 번 해 보기"는 사용자·Cowork가 체크히어 화면에서 직접 하는 일이고, Claude Code 세션은 하지 않는다.)
- Firestore 규칙과 `cleanRequest`의 날짜 범위는 `2026-07-27`~`2026-10-22`다(`firestore.rules:32` 요청 생성, `firestore.rules:97` `checkhereCurrent` 저장, `checkhere/approval-core.mjs:10`). 2기 날짜까지 넓히려면 사용자 확인을 먼저 받고, 규칙(사용자 게시)과 `cleanRequest`를 함께 바꾼다. 같은 날짜가 박힌 다른 1기 화면 목록은 `docs/checkhere-handoff-review.md` "먼저 지킬 것"에 있다.
- 커밋·push는 사용자가 확인한 뒤에만 한다.
- AFTER 단계(시간 삭제)를 시작하기 전에 `docs/checkhere-handoff-review.md`의 1번(작업 잠금 경쟁), 3번(실시간 요청의 중복 요청 검사), 4번(`retry_` 요청 가로채기)을 먼저 고친다. 그 문서가 "시간 삭제보다 먼저"라고 정한 항목이다.
- 문서·시험·로그·중계 신호(heartbeat)에 학생 이름·전화번호·실제 메모를 넣지 않는다. 시험은 가상 학생만 쓴다.

## 1. 목적과 이미 정한 것

목적: /beta2 출결대조 표에서 행마다 유형·시간·사유를 바로 고치고, 저장하면 마스터시트(출결원장)에 들어간 뒤 체크히어에도 자동으로 같은 상태가 반영되게 한다. 체크히어 입실·퇴실 시간 삭제도 같은 경로로 할 수 있게 준비한다.

### 사용자 결정 (고정)

1. 삭제 대상 = 체크히어의 **입실·퇴실 시간 기록**.
2. 체크히어가 시간을 어떻게 지우는지는 모른다 → **Cowork가 먼저 읽기 전용으로 체크히어를 확인**한다. 작업 문서는 `docs/cowork/2026-10-13-checkhere-delete-and-beta2.md` 1번, 보고서는 Google Drive 폴더 `HINT Claude Code 전달`의 `checkhere-delete-report.md`. 그래서 **진단 프로그램(probe)은 만들지 않는다**(설계 JSON의 1단계는 폐기). 보고서와 캡처는 저장소에 넣지 않는다.
3. /beta2 출결대조에서 저장하면 체크히어에 **자동 반영**한다.
4. 규칙 변경은 **초안만** 준비한다(게시는 사용자).

### 나눠서 하기 (합의됨)

| 지금 할 것 (NOW) | Cowork 보고서를 받은 뒤 (AFTER) |
|---|---|
| `beta2-ledger.mjs` 행 안에서 유형·사유·시간 수정, `저장`·Enter·blur 때 바로 `b2Save`(유형 선택만 바꿔서는 저장하지 않음, 검토 1-4) | 공유 모듈의 삭제 배관: `approval-core` `cleanRequest`의 `deleteTimes`, `rules.mjs` `assertChangeAllowed`의 deletions, `checkhere-live-core` `buildLiveRequest`의 `deleteTimes` |
| 3초 되돌리기 뒤 체크히어 실시간 요청 자동 작성 | `writeback`(삭제 확인), `collector`(`deleteTime`) |
| 행마다 상태 칩 | `server.mjs` 능력 `time-delete-v1`과 게이트 |
| 중계 상태 표시(중계 탭이 `settings/checkhereRelay`에 신호 기록, 이름 없음) | 중계(relay)의 삭제 게이트 |
| 시간 삭제(×) 버튼: 보이되 꺼 두고 이유 표시 | 연결 프로그램 build 올리기 |
| `compareCheckHere` 보정 모드 | |
| 시험 | |
| `firestore.rules` 삭제용 초안을 **별도 파일**로 + 게시 안내(게시 안 함) | |

지금 단계는 `checkhere/` 아래 연결 프로그램 파일을 바꾸지 않는다(시험 파일 제외). 그래서 build를 올릴 필요가 없다.

## 2. 지금 코드 상태

| 파일:줄 | 지금 하는 일 | 이번 작업과의 관계 |
|---|---|---|
| `beta2-ledger.mjs:11` | `memoReason`: 체크히어 메모에서 사유 힌트 추출. `지각_담임:…(09:25)`이면 괄호 안 시간 `09:25`를 사유로 내놓음 | 시간은 사유 힌트로 쓰지 않게 고침(7단계) |
| `beta2-ledger.mjs:29` | `matchFor(row)`: 이름으로 지금 불러온 `records`에서 체크히어 기록 찾기 | 보류(hold)는 이름이 아니라 반·날짜·이름으로 찾아야 함(S1) |
| `beta2-ledger.mjs:30-31` | 기존 '체크히어 요청' 제안 패널(`createProposalReview`), 담임은 `teacherOf(bundle,cls)` | '직접 요청'으로 이름만 바꿔 유지 |
| `beta2-ledger.mjs:34-37` | `compareRow` → `compareCheckHere` | 보정 모드 `corrected:true` 전달 |
| `beta2-ledger.mjs:50-59` | 펼침형 편집기 `editorHtml`(유형 칩·시간·사유·증빙) | 증빙(ev/evr)만 이 편집기로 남김 |
| `beta2-ledger.mjs:60-66` | `rowHtml`. 65행 안내문 "요청 근거 앞에 [2기 베타]가 붙고…" | 행 안 입력칸·상태 칩·× 버튼 추가, 안내문 갱신 |
| `beta2-ledger.mjs:67-77` | `renderRows`: 73행에서 `tbody.innerHTML`을 통째로 바꿈. 76행 `#b2Live` 표시 | 행 단위 패치로 바꿈(입력 중인 칸 보호). 중계 표시는 `#b2Live` 옆 |
| `beta2-ledger.mjs:84-97` | `loadCheckHere`: **오늘만** `watchCheckHereDay`(88-91행), 지난 날은 한 번 읽기(93행). 91행 `life.on`이 불러올 때마다 추가됨 | 모든 날짜 구독, `life.on`은 한 번만 |
| `beta2-ledger.mjs:114-129` | `save`: 121행 `client.save({...,before:form.before})`, 126행 CONFLICT 처리 | 행 안 저장으로 바꿈 |
| `beta2-ledger.mjs:150-151` | 반·날짜 바꾸기(편집 중 확인) | 보류 정리(S10) |
| `beta2-ledger.mjs:155` | `client.watch`: 시트 변경 번호가 바뀌면 다시 읽음(저장 중이면 건너뜀) | 입력 중·저장 중·초안 있으면 건너뜀 |
| `beta2-ledger.mjs:158` | `canLeave` | 보류·저장 중 확인 |
| `beta2-core.mjs:5` | `B2_TYPES`(출석·지각·조퇴·외출·결석·인정4종). `중복` 없음 | 중복 행은 유형 선택 필요 |
| `beta2-core.mjs:10` | `DISEASE_REASON` = 병원·병결·병가·진료·질병·입원·통원·수술·치료·검진 | `reasonCategory` 병원 범위를 이것과 맞춤 |
| `beta2-core.mjs:30` | `teacherOf(bundle,cls)` = 반정보 K열 담임 | 담임 대체값 |
| `beta2-core.mjs:83-106` | `compareCheckHere`: 86행에서 `rawEntry`(실제 입실)를 `entry`(교시)보다 먼저 씀 | 보정 모드 추가(7단계) |
| `beta2-core.mjs:109-113` | `timesFromRecord`: 체크히어 시간을 HH:mm로 | 필요한 시간 미리 채우기 |
| `beta2-core.mjs:115-118` | `neededTimes`: 유형에 필요한 시간만 남기고 나머지 비움 | 저장 값 = 체크히어 계산 입력 |
| `beta2-data.mjs:27-34` | `patch`: 저장 결과(sig·memo…)를 들고 있는 묶음에 반영 | 다시 읽지 않고 행만 갱신 |
| `beta2-data.mjs:35-40` | `save`: 37행 `res.unchanged`면 patch 없이 그대로 돌려줌(sig 없음) | `unchanged` 처리(S5) |
| `beta2-guard-core.mjs:2` | /beta2 쓰기 허용 경로: `checkhereRequests`, `checkhereProposalSources`, `checkhereProposalDrafts`만 | /beta2는 `settings`에 쓰지 않음(읽기만) |
| `beta2-guard-core.mjs:10-15` | `beta2RequestData`: `[실시간 베타]`로 시작하면 바로 뒤에 `[2기 베타]`를 넣음. 그래서 `isLiveRequest`·`tagOf`는 그대로 통과(시험 `checkhere/tests/beta2-ui.test.mjs:102`, `beta2-core.test.mjs:82-87`) | 자동 요청도 이 경로로 표시됨. 직접 `[2기 베타]`를 붙이지 않음 |
| `beta2-firestore-guard.mjs:9-23` | `setDoc`·`addDoc`과 트랜잭션·배치의 `set`만 reason을 고치고(`beta2RequestData`), `updateDoc`·`update`는 그대로 | 요청 취소(withdraw, 트랜잭션 `update`)는 영향 없음 |
| `index.html:6` / `:205` | /beta2 import map: 정확히 `https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js`(쿼리 없음)를 가드 `/beta2-firestore-guard.mjs?v=20261013-b2`로 돌림 / `beta2-admin.mjs?v=20261013-b2` | 새 모듈도 이 주소 그대로 import해야 가드를 거침. `beta2-admin.mjs:4`는 `./beta2-ledger.mjs`를 버전 없이 import |
| `checkhere-live-core.mjs:23-26` | `baseTag`(바뀐 항목의 지금 값 지문), `tagOf`, `isLiveRequest`, `editorReason` | `[기준:…]`은 결정 시점 record로 만듦(S2) |
| `checkhere-live-core.mjs:29-33` | `checkLiveEdit` → `assertChangeAllowed(requested:true)` | AFTER: deletions 전달 |
| `checkhere-live-core.mjs:34-51` | `buildLiveRequest(record, form, reason)`: 35행 live·complete 필요, 39행 빈 시간이면 "시간을 비우는 수정은 지원하지 않습니다.", 43행 메모는 `String(form[k]??'')`(키가 없으면 메모를 **비움**), 46행 `[기준:…]` | 자동 요청은 이 함수로 만듦. 폼은 4칸 모두 record 값으로 채움(`liveForm`) |
| `checkhere-live-core.mjs:52-55` | `requestsFor`(전화 끝 4자리까지 같아야), `stamp`, `LIVE_STATUS` | 상태 칩 |
| `checkhere-live-relay.mjs:28-33` | `refresh`: 연결 프로그램 `/api/state`에서 capabilities | 상태에 capabilities 노출(5a) |
| `checkhere-live-relay.mjs:74-100` | `processRequest`: 75행 `status.current`에 반·이름, 76행 관리자 아닌 계정 요청은 건너뜀(pending으로 남음), 80행 승인됨 처리, 81행 `cleanRequest`, 83행 미리보기 읽기, 87-92행 이미 같으면 confirm-existing, 93행 `[기준]` 불일치면 반려, 94행 `checkLiveEdit`, 96행 `prepareApproval` | 그대로 씀. AFTER: 삭제 게이트 |
| `checkhere-live-relay.mjs:106-118` | 재시도: 112행 연결 문제(`BRIDGE_OFFLINE`·`BRIDGE_BUSY`·`BRIDGE_KEY`·`BRIDGE_OLD`, `LOGIN_REQUIRED`)는 60초마다 끝없이 재시도, 그 외는 pending일 때 5번(`MAX_ATTEMPTS`, 18행) 실패 후 반려(114행). `applying`이 된 요청은 대기열(pending·approved만)에서 빠짐 | 승인된 요청은 반려 불가 → 삭제 게이트는 승인 전에 |
| `checkhere-live-relay.mjs:120` / `:124` | 수동 갱신은 `status.current`를 안 씀 / 자동 갱신은 씀 | 우선순위 취소(선택)와 관계 |
| `checkhere-live.mjs:33` | `changeText`: 빈 값은 `(비움)` | AFTER: 삭제는 `(삭제)` |
| `checkhere-live.mjs:118` | 안내 "시간을 비우는 수정은 지원하지 않습니다." | AFTER 갱신 |
| `checkhere-live.mjs:161-197` | `mountRelay`(중계 탭, hint.kpc 전용) | 중계 신호 기록(5a) |
| `checkhere-live.html:56` | `checkhere-live.mjs?v=20261012-1` | 5a에서 올림 |
| `checkhere/approval-core.mjs:7-25` | `cleanRequest`: 10행 날짜 범위, 18행 빈 시간 거절 "공란으로 지울 수 없습니다" | AFTER: `deleteTimes` |
| `checkhere/approval-core.mjs:26-33` | `sameRequestTarget` | AFTER: `deleteTimes` 비교 |
| `checkhere/approval-core.mjs:41-44` | `requestMatchesRecord`: 문자열 정확히 같아야(지운 시간은 `null`이라 영원히 불일치) | AFTER |
| `checkhere/approval-core.mjs:47-53` | `memoDefaultTimes`: 시간이 빈 쪽 메모가 바뀌면 09:00/18:00 자동 입력. 같은 변경에 그 시간 키가 있으면 안 넣음 | 짝 규칙(대응표)의 근거 |
| `checkhere/approval-core.mjs:54-67` | `prepareApproval`: 65행에서 빈 시간 키를 지움 | AFTER: 지정된 삭제는 남김 |
| `checkhere/approval-core.mjs:68-74` | `proposalFromApproval` | AFTER |
| `checkhere/rules.mjs:14-75` | `judge`: 25행 PERIOD_MISMATCH, 29행 RECOGNIZED_MEMO(`담임:${record.teacher}` 확인), 45-52행 메모 검사 | 메모 담임은 `record.teacher` |
| `checkhere/rules.mjs:77-94` | `assertChangeAllowed`: 84행 바뀌는 쪽에 시간 필요, 92행 capability 검사 패턴 | AFTER: deletions |
| `checkhere/writeback.mjs:8-17` | `validateProposal`: 11행 빈 시간 거절(requested면 통과 후 `assertChangeAllowed`가 거절) | AFTER |
| `checkhere/writeback.mjs:19-50` | `applyVerified`: 33행 `adapter.write(..., {requestedFields})`, 40행 엄격 비교, 47행 마지막 `requestMatchesRecord` | AFTER: 삭제 확인 |
| `checkhere/collector.mjs:27` | 전용 크롬 확인창 처리(쓰기 중 confirm만 수락) | |
| `checkhere/collector.mjs:135` | 표에서 `rawEntry`=0번 칸(실제 입실), `entry`=1번 칸(교시), `exit`=2번 칸 | 입실 삭제가 무엇을 지우는지(Cowork 확인) |
| `checkhere/collector.mjs:156-164` | `modal`(157행 칸 클릭), `closeModal` | |
| `checkhere/collector.mjs:217-230` | `write`: 226행 시간이 비면 "메모를 저장할 시간을 확인하지 못했습니다." | AFTER: 삭제 경로 |
| `checkhere/server.mjs:17` | `CAPABILITIES`(삭제 능력 없음) | AFTER: `time-delete-v1` |
| `checkhere/server.mjs:70` | `/api/session` build `'20261013.4'` | AFTER 단계마다 올림 |
| `checkhere/server.mjs:75-79` | `/api/state`: capabilities는 있고 **build는 없음** | 중계 신호의 build는 AFTER에서 추가 |
| `checkhere/server.mjs:82` | `/api/cancel`: 작업 id 없이 sync·batch 취소 | 우선순위 취소는 보류 |
| `checkhere/server.mjs:171-201` | apply·confirm-existing: 179행 `approvalCloud.get`, 185행 `approveExisting`(pending→approved), 192행 `claim` | AFTER: 게이트는 179행 직후 |
| `checkhere/Start.ps1:11` / `:13` | 실행 중 build가 다르면 재시작 / 작업 중이면 거절 | build 값 함께 올림 |
| `firestore.rules:18-24` | `validChanges`: 시간은 HH:MM:SS만 | 그대로 둠(초안에서도) |
| `firestore.rules:25-68` | `checkhereRequests`: 29행 허용 키, 32행 날짜, 36행 `validChanges(changes)`, 39-58행 승인 계정 전이, 47행 `validChanges(approval.after)`, 60-66행 작성자 취소, 67행 삭제 금지 | 초안 파일에서만 바꿈: 29·36·47행 세 곳 + `deleteTimes` 관리자 조건 1줄(7장의 네 부분) + 도움 함수 추가 |
| `firestore.rules:151-160` | `checkhereProposalSources`(156행 `validChanges`) | 그대로 |
| `firestore.rules:209-212` | `settings`: 관리자·담임 읽기, 관리자 쓰기 | 중계 신호·기능 깃발. 규칙 변경 불필요. 담임이 읽을 수 있으니 이름 금지 |
| `apps-script/beta2/beta2.gs:641-668` | `b2Save`: 653행 `before`가 있을 때만 CONFLICT 검사, **656행 기록 없는 학생을 출석으로 저장하면 `{unchanged:true}`만 돌려주고 아무것도 안 씀(sig 없음, 사유 버려짐)**, 659행 A~K열 덮어쓰기, 661행 출처 '베타 수정'·T열 지움, 666행 `{sig, memo(L열)…}` | Apps Script 변경은 필요 없음 |
| `api/teacher-beta.js:8,11` | `b2Save`를 관리자 전용 동작으로 Apps Script에 중계 | 변경 필요 없음 |
| `apps-script/beta2/beta2.gs:308-326` | `b2Validate_`: 314행 `중복` 거절("유형을 골라 주세요."), 316-321행 필요한 시간·인정 사유 | 행 안 검사도 같게 |
| `checkhere-proposal-core.mjs:7-14` | `reasonCategory`: 10행 병원 = 병원·병결·진료·치료·질병(병가·입원·통원·수술·검진 빠짐). 여러 개 맞거나 없으면 '' | 2단계에서 넓힘 |
| `checkhere-proposal-core.mjs:50` | `requestsOverlap`: 바뀌는 항목이 겹칠 때만 | 자동 경로에서는 쓰지 않음(S6) |
| `checkhere-request-actions.mjs:8-17` | `withdrawRequest`: pending일 때만, 작성자만, 트랜잭션 | 자동 요청 취소 |
| `checkhere-snapshots.mjs:13-19` | `watchCheckHereDay`: `onSnapshot(ref,{includeMetadataChanges:true},cb,err)` | 시험 스텁이 두 형태 모두 받아야 함 |
| `checkhere-retry-store.mjs:18-30` | `ensureRetryRequest`: 27행 `{...cleanRequest(fresh)}`로 새 요청 생성 | 자동·삭제 요청 제외(8단계) |
| `checkhere-requests.mjs:32` / `:43` / `:101-118` / `:134-168` / `:193-199` / `:203` | 승인 판단 / 요청 작성 폼(빈 칸이면 '') / 일괄 승인 / 실패 건 다시 처리 / 이미 같은 요청 자동 확인 / 실패 일괄 재처리 버튼 | AFTER: 삭제 표시·일괄 제외. NOW: 재처리 제외 |
| `checkhere/direct-edit.mjs:17` / `:36` | `cleanRequest` / `assertChangeAllowed` | AFTER: 삭제 거절 |
| `checkhere/cloud-approval.mjs:58-63` / `:65-86` | `approveExisting` / `finish`(73행 `requestMatchesRecord`) | 로직 변경 없음 |
| `checkhere/identity.mjs:6` | `version` = 내용 해시 | 반려·취소로 끝나면 바뀌지 않음(S7) |
| `checkhere-proposals.mjs:114` | 기존 요청 문서와 로컬 입력을 `sameRequestTarget`으로 비교 | 가드가 reason을 바꾸므로 비교 시 `beta2RequestData`를 거친 값으로 |

### 설계 JSON과 현재 코드가 달랐던 곳

- JSON 조사 영역·검토의 줄 번호 중 오래된 것: `checkhere/rules.mjs:151-167` → 실제 `77-94`, `approval-core.mjs:112/137/159/167` → 실제 `18/43/65/72`, `approval-core.mjs:120-127`(`sameRequestTarget`) → 실제 `26-33`, `approval-core.mjs:160`(`approval.reason`) → 실제 `66`, `beta2-guard-core.mjs:31-37`·`33-38` → 실제 `10-15`, `direct-edit.mjs:130` → 실제 `36`, `beta2-data.mjs:85` → 실제 `37`, `collector.mjs:77`(확인창 처리) → 실제 `27`, `collector.mjs:267-280`(`write`, 빈 시간 막기) → 실제 `217-230`(막기는 `226`), `collector.mjs:185,207`(1·2번 칸 클릭) → 실제 `157`, `beta2.gs:658`(A~K 쓰기) → 실제 `659`. JSON 계획 본문(steps)의 줄 번호는 맞았다.
- JSON 대응표(`plan.mapping`)와 3장의 차이: P0(날짜 범위)는 0번 규칙 때문에 이 문서가 더한 것이다. P4는 검토 1-3에 따라 "항목이 겹칠 때만(`requestsOverlap`)"에서 "같은 학생의 진행 중 요청 모두"로 바꿨다. 결석의 지운 쪽 메모 `''`는 검토 2-8에 따라 선택이 됐다. 대응표 원문의 "인정 아닌 유형의 사유만 바꾸면 `same`"은 검토 1-6이 틀렸다고 해서 `checkhereChangeKind`(S5)로 대신한다. 이 네 곳 말고는 원문 그대로다.
- JSON 2단계의 `retryWhen:'evening'`은 대응표 어디에서도 쓰이지 않아 뺐다(진행 중인 날의 인정 유형 퇴실 18:00은 안내만 하고 나중에 `체크히어 맞추기`로).
- JSON 5단계는 요청 우선순위를 위한 `/api/cancel` 호출을 기본으로 넣었지만, 검토 2-2(남이 시작한 일괄 수집 취소, 수동 갱신 유실) 때문에 5b의 "선택(보류 권장)"으로 돌렸다.
- JSON 6단계는 `firestore.rules`를 직접 고치게 되어 있다 → 합의대로 **별도 초안 파일**로 바꾼다(6단계).
- JSON 1단계(진단 프로그램 `probe-modal*`, `수정창진단.cmd`)와 그에 딸린 검토(전용 크롬 확인창 이중 처리, 시험 포트 18931)는 폐기. 단, 새 연결 프로그램 시험은 18931을 쓰지 않는다(이미 `checkhere/tests/page-data.test.mjs:90` 사용).
- JSON 5단계는 중계 신호에 `build`를 넣지만 `/api/state`에는 build가 없다(`server.mjs:78`). 지금 단계는 연결 프로그램을 안 바꾸므로 신호의 `build`는 `null`로 두고, AFTER 단계에서 `/api/state`에 build를 추가한다.
- 중계 신호 문서 이름은 JSON 안에서도 `settings/checkhereRelay`와 `settings/checkhereLiveRelay`가 섞여 있다 → `settings/checkhereRelay`로 정한다. 삭제 능력 이름도 `time-clear-v1`과 섞여 있다 → `time-delete-v1`로 정한다.

## 3. 시트 값 → 체크히어 값 대응표

입력(설계 대응표 그대로):

- `row` = **방금 `b2Save`에 보낸 값** `{type, reason, ...neededTimes(type)}`(시간은 `inT`·`outT`·`oa`·`ob`, HH:mm).
- `record` = 그 학생의 최신 `checkhereCurrent` 기록(구독 중인 그날 문서에서 `matchSnapshot`으로 찾은 것).
- `sheetTeacher` = `teacherOf(bundle, cls)`(반정보 K열 담임, `beta2-core.mjs:30`).
- `date`, `today`, `nowSec`(`koreaNow()`, `beta2-ledger.mjs:12`), `deleteEnabled` = `deletionGate().enabled`(지금은 항상 false), `policy.times` = `'suggest'`(기본) 또는 `'memo-only'`.

출결원장 L열(`rec.memo`)은 **쓰지 않는다**. L열은 1행 ARRAYFORMULA 수식인데 저장소에 없고(머리말 주석만 `apps-script/beta2/beta2.gs:28`), 클라우드 세션이 실제 마스터시트에서 읽기만 해 확인했다. 담임은 반정보 K열에서 찾고, 빈 시간을 `00:00`으로, 빈 담임을 `_담임:(`로, 인정 사유를 분류 없이 원문 그대로 넣는 문제가 있다(실제 시트에 `…(00:00)` 행이 이미 있음). 2기 담임 화면(`teacher-beta.js:70-72`)에도 `--:--`·`담임`·`사유`로 채우는 세 번째 메모 생성기가 있다. 체크히어 메모는 이 둘이 아니라 아래 규칙으로만 만든다.

### 앞 조건 (순서대로)

- **P0 날짜 범위**(설계 대응표에 없는 추가, 0번 규칙): 날짜가 `2026-07-27`~`2026-10-22` 밖이면 `hold`("규칙 날짜 범위 밖 · 넓히려면 사용자 확인 필요"). 시트 저장은 그대로 둔다.
- **P1** record 없음(이름 연결 실패·동명이인) → `none`("체크히어 기록 없음 · 이름 연결 확인"). 시트 저장은 그대로.
- **P2** `record.source!=='live' || readState!=='complete' || !id || !version` → `hold`("체크히어 상세 수집 대기", `retryWhen:'record'`). 감시 중인 record가 complete가 되면 다시 계산한다.
- **P3 담임 T**: `validTeacher(record.teacher)`면 그것, 아니면 `validTeacher(teacherOf(bundle,cls))`, 둘 다 아니면 `hold`("담임 이름 확인"). `validTeacher` = 비어 있지 않고 줄바꿈·`_`·`(`·`)`·`:`·`[`·`]`가 없음. 둘 다 맞는데 다르면 경고만. 메모에 `record.teacher`를 쓰는 이유는 `judge()`가 `담임:${record.teacher}`를 확인하기 때문(`checkhere/rules.mjs:29,51`).
- **P4 진행 중 요청**(검토 반영): 같은 학생(classId·date·name·phoneLast4)의 pending/approved/applying 요청이 **항목이 겹치든 아니든** 있으면, 모두 "내가 만든 pending `출결대조 자동` 요청"일 때만 취소(`withdrawRequest`)하고 계속한다. 그 밖에는 `hold`(`retryWhen:'request'`, 다시 계산 조건은 S7). 진행 중 요청이 남아 있는 동안에는 `same`·`none`을 내지 않는다. (설계 원문은 "항목이 겹치는(`requestsOverlap`) 진행 중 요청만, 끝나고 record version이 바뀐 뒤 다시 보냄"이었다. 검토 1-3·2-5로 바꿨다.)
- **P5** `record.schedule!=='09:00 ~ 18:00'` → 시간은 바꾸지 않음(메모만, `memo-only`).

### 도움 규칙

- `H(v)` = `normalizeTime(v)?.slice(0,5) || ''`(HH:MM). `has(k)` = `!!normalizeTime(record[k])`(record에 그 시간이 있음, null·''·'-'는 없음).
- `setTime(k,hm)`: `H(record[k])!==hm`일 때만 `changes[k]=hm+':00'`. 분이 같으면 체크히어의 초를 그대로 둔다.
- `setMemo(k,text)`: `text!==(record[k]??'')`일 때만.
- `STATUS_MEMO` = `/^\s*(?:\(\s*인정(?:출석|지각|조퇴|외출)\s*\)|(?:지각|조퇴|외출)_담임:)/`
- `clearStale(k)`: record 메모가 `지각_`·`조퇴_`·`외출_담임:` 형식이면 `changes[k]=''`. 인정 메모·자유 메모는 둔다. (설계의 `clearStale(k,{plainOnly:true})`. 설계는 `plainOnly` 없이 `STATUS_MEMO` 전체를 지우는 형태도 정의했지만 대응표는 모두 `plainOnly`로 쓴다.)
- `ongoing` = 오늘이고 18:00 전이고 퇴실 없음. `pastDay` = 지난 날.
- 시간 정책 `policy.times`: `'suggest'`(기본, 기존 `suggestTimes`와 같음) 또는 `'memo-only'`. 기본값은 사용자 확인 필요(10장 1번).

### 유형별

| 시트 유형 | 시트 조건 (아니면 hold) | 체크히어 시간 | 체크히어 메모 (그대로 이 형식) | 반대쪽 메모 | 결과 |
|---|---|---|---|---|---|
| 출석 | — | suggest: 입실이 있고 H>09:10이면 09:00, 입실이 없으면 지난 날만 09:00. 퇴실이 있고 H<17:50이면 18:00, 퇴실이 없으면 지난 날이고 진행 중이 아닐 때만 18:00. memo-only: 안 바꿈 | `entryMemo:''`, `exitMemo:''` (모두 비움) | (위에서 같이) | send / same |
| 지각 | inT > 09:10 ("지각 입실 시간이 09:10 이후가 아닙니다") | `setTime(entry,inT)`(입실이 비면 반드시), 퇴실 그대로 | entryMemo `지각_담임:${T}(${inT})` | exitMemo `clearStale` | send / same. `H(rawEntry)!==inT`면 경고 "실제 입실과 다름 · 교시 기록만 바뀝니다" |
| 조퇴 | outT < 17:50 | `setTime(exit,outT)`(퇴실이 비면 반드시 → 18:00 기본값이 들어가지 않게), 입실 그대로 | exitMemo `조퇴_담임:${T}(${outT})` | entryMemo `clearStale` | send / same |
| 외출 | oa < ob, 체크히어 입실 있음("입실 시간이 없어 외출 사유를 넣을 수 없습니다") | 바꾸지 않음(외출 구간은 쓸 수 없음) | entryMemo `외출_담임:${T}(${oa}~${ob})` (시트의 한 구간) | exitMemo `clearStale` | send / same. 체크히어에 `H(start)===oa && H(end)===ob`인 외출이 없거나 여러 구간이면 경고 |
| 결석 | — | `sides=['entry','exit'].filter(has)`. 삭제 가능할 때만 쪽마다 `changes[side]=''` + `deleteTimes.push(side)`. 시트 E~H는 `neededTimes`로 이미 비어 있음 | 지우는 쪽 메모: 설계 원문은 `changes[side+'Memo']=''`. 검토 2-8로 **선택**이 됨 — Cowork 보고 뒤 `''` 또는 생략으로 결정(7장) | — | 시간 있는 쪽 없음 → `none`(시간 빈 쪽 메모는 건드리지 않음: 지우면 기본 시간이 들어감). 삭제 불가(지금) → `hold`("체크히어 시간 삭제는 Firestore 규칙 게시·수집 PC 업데이트 후 가능"). 메모만 지우면 정상 출석처럼 보이므로 아무것도 보내지 않음 |
| 인정출석 | `cat=reasonCategory(reason)`가 하나("인정 사유를 하나로 확인하지 못했습니다", 2단계에서 병원 범위를 넓힌 뒤 기준). 사유 원문은 보내지 않음 | suggest(기존 `suggestTimes` 값): `setTime(entry,'09:00')`, `setTime(exit,'18:00')`(진행 중이면 퇴실 생략, 안내 "퇴실 18:00은 수업 종료 후 체크히어 맞추기"). memo-only: 안 바꿈 | entryMemo `(인정출석)${cat}_담임:${T}` | exitMemo `clearStale` | send / same |
| 인정지각 | + inT | 〃 | entryMemo `(인정지각)${cat}_담임:${T}(${inT})` | 〃 | 〃 |
| 인정조퇴 | + outT | 〃 | exitMemo `(인정조퇴)${cat}_담임:${T}(${outT})` | entryMemo `clearStale` | 〃 |
| 인정외출 | + oa < ob | 〃 | entryMemo `(인정외출)${cat}_담임:${T}(${oa}~${ob})` | exitMemo `clearStale` | 〃 |
| 중복 · 해당없음 · 그 밖 | — | — | — | — | `manual`("중복 출결 · 개별 검토 필요"). `b2Save`도 중복은 저장 못 함(`beta2.gs:314`) |
| (인정 아닌 유형에서 사유만 바꾼 저장) | — | — | — | — | 설계 원문은 `same`. 체크히어가 대응표와 다르면 사실이 아니므로(검토 1-6) 대응표를 돌리지 않고 `checkhereChangeKind`가 `'sheet-only'`로 본다 → 자동 전송 없음, 결과가 `send`면 `체크히어 맞추기` 버튼만(S5) |

### 짝 규칙 (마지막에 적용)

메모를 바꾸는 쪽(side)에 체크히어 시간이 없고 그 시간도 `changes`에 없으면: 메모를 **비우는** 변경은 조용히 뺀다, 메모를 **넣는** 변경은 `hold`("시간이 없는 쪽에는 사유를 넣을 수 없습니다"). 결과는 반드시 `memoDefaultTimes(changes, record)`가 `{}`여야 하고, `buildLiveRequest` 뒤에도 한 번 더 확인해 아니면 보내지 않는다(`checkhere/approval-core.mjs:47-53`).

### 안전

메모에 `[`, `(00:00)`, `_담임:(`가 들어가거나 500자를 넘으면 `hold`.

### 출력

- `changes`가 비면 `same`("체크히어 이미 같음").
- 아니면 `send`, 요청 근거 text = `출결대조 자동 · ${type} · ${reason||'일반 출결'}` (300자 이하). `buildLiveRequest(record, liveForm(record,changes), text, {deleteTimes})`로 만들면 `[실시간 베타] 출결대조 자동 · … [기준:xxxxxxxx]`가 되고, 저장할 때 가드가 `[실시간 베타] [2기 베타] 출결대조 자동 · … [기준:xxxxxxxx]`로 바꾼다. (`deleteTimes` 인자는 AFTER 단계에서 생긴다. 지금은 결석이 hold라 넘길 일이 없다.)
- `liveForm(record,changes)` = `{entry: changes.entry ?? record.entry ?? '', exit: …, entryMemo: changes.entryMemo ?? record.entryMemo ?? '', exitMemo: …}`. 메모 키를 빼먹으면 `buildLiveRequest`가 메모를 지우므로(`checkhere-live-core.mjs:43`) 4칸을 항상 채운다.

## 4. 새 모듈 설계

### 4.1 `beta2-checkhere-core.mjs` (새 파일, 순수 함수, 화면·Firestore 없음)

```js
export const STATUS_MEMO=/^\s*(?:\(\s*인정(?:출석|지각|조퇴|외출)\s*\)|(?:지각|조퇴|외출)_담임:)/;
export const RELAY_STALE_MS=3*60*1000;          // 신호가 이보다 오래되면 '중계 꺼짐'
export const REQUEST_DATE_RANGE={from:'2026-07-27',to:'2026-10-22'}; // approval-core.mjs:10, firestore.rules:32·97과 같아야 함
export const AUTO_TEXT='출결대조 자동';
export const holdKey=(cls,date,name)=>`${cls}|${date}|${name}`;
export function validTeacher(v){}                // 비어 있지 않고 \n _ ( ) : [ ] 없음
export function liveForm(record,changes){}       // 4칸 모두 채움
// 저장 전·후 행 비교: 'checkhere'(유형, 그 유형이 쓰는 시간, 인정 유형의 사유가 바뀜) | 'sheet-only'(증빙·인정 아닌 사유) | 'none'
export function checkhereChangeKind(prevRow,row){}
// 3장 대응표 그대로. active: 이 학생의 진행 중 요청들, me: 지금 사용자 이메일
export function sheetToCheckHere({row,record,sheetTeacher,date,today,nowSec,deleteEnabled=false,policy={times:'suggest'},active=[],me=''}){}
//  → {state:'send'|'same'|'hold'|'none'|'manual', changes, deleteTimes, text, notes:[], warnings:[], retryWhen?:'record'|'request', withdraw:[id…]}
export const isAutoLedgerRequest=r=>typeof r?.reason==='string'&&r.reason.includes(AUTO_TEXT);
// 상태 칩: local(보류·보내는 중·되돌림), request(이 학생 최신 실시간 요청), target(마지막 계산 결과), now
export function rowCheckHereStatus({local,request,target,now}){}  // → {kind,label,detail,actions:[]}
// 삭제 가능 여부: features=settings/checkhereFeatures, relay=settings/checkhereRelay, denied=이 세션에서 permission-denied 본 적
export function deletionGate({features,relay,denied}){}           // → {enabled, reasons:[]}
```

- `sheetToCheckHere`의 `withdraw`는 P4에서 취소해야 할 "내 pending 자동 요청" id 목록이다. 실제 취소는 4.2가 한다. 취소가 하나라도 실패하면 결과를 `hold('request')`로 바꾼다.
- `rowCheckHereStatus` 라벨: 보내기 전(남은 초 · 되돌리기) / 보내는 중 / 반영 대기(90초 넘으면 "수집 PC 중계가 꺼져 있거나 다른 반을 갱신 중입니다. 켜지면 자동 처리됩니다", 내 요청이면 `요청 취소`) / 반영 준비 / 반영 중(applying 3분 넘으면 "결과 확인 필요 · 수집 PC에서 결과 확인") / 완료(`result.message` 툴팁) / 자동 반영 안 함(`reviewNote`, `다시 보내기`) / 원본 변경·일부 반영·반영 실패·결과 미확인(`result.message`) / 취소 / 보류(이유) / 체크히어 이미 같음 / 체크히어 맞추기(수동 제안) / 체크히어 반영 취소 · 출결원장도 되돌림. 진행 중 요청이 있으면 대조(diff) 상태보다 요청 상태를 앞에 보인다(중계 미리보기가 잠깐 바뀌기 전 값을 저장하기 때문).
- `deletionGate` 이유: `features?.timeDeleteRules!==true` → "Firestore 규칙 게시 필요", 중계 신호 capabilities에 `time-delete-v1` 없음 → "수집 PC 프로그램 업데이트 필요 (time-delete-v1)", `denied` → "시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다". 지금 단계에서는 항상 꺼짐.

### 4.2 `beta2-checkhere-sync.mjs` (새 파일, 브라우저)

Firestore는 정확히 `https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js`(쿼리 없이)로 import한다. 그래야 /beta2 import map이 가드로 돌린다(`index.html:6`, 기존 `checkhere-request-actions.mjs:1`과 같은 방식).

```js
createCheckHereSync({db,user,client,getRecord(cls,date,name),getSig(cls,date,name),teacherOf(cls),onChange,undoMs=3000})
 → {setDay(cls,date), saveStarted(key), saveFailed(key,error),
    afterSave(key,{prevRow,row,sig,existedBefore,unchanged}),
    send(key,{deleteTimes}), suggest(key), undo(key), retry(key), withdraw(key),
    statusFor(key), gate(), relay(), holds(), flushAll(), dispose()}
```

동작 규칙(검토 내용을 모두 요구사항으로 넣었다. 괄호는 근거):

- **S1 키.** 보류·상태·초안은 모두 `holdKey(cls,date,name)`로 다룬다. 이름만으로 찾지 않는다. (검토: 날짜·반을 바꾼 뒤 다른 날 기록으로 요청이 만들어짐)
- **S2 결정 시점 저장.** `afterSave` 때 `{cls,date,name,prevRow,row,sig,existedBefore,sheetTeacher:teacherOf(cls),record}`를 보류에 저장한다. `record`는 그때 화면에 보인 기록의 복사본이다. `[기준:…]` 태그는 **이 record**로 만든다(`buildLiveRequest(captured,…)`). 그래서 중계의 태그 검사(`checkhere-live-relay.mjs:93`)가 관리자가 본 값을 지켜 준다.
- **S3 보내기 직전 확인.** (a) record는 저장해 둔 반·날짜로 찾는다(`getRecord(cls,date,name)`, 지금 화면이 아님). `record.classId===cls && record.date===date`가 아니면 보내지 않는다. (b) 그 학생의 최신 sig(`getSig`)가 보류의 sig와 같아야 한다. 다르면 보류를 취소하고 "시트가 그사이 바뀜 · 자동 반영 안 함". (c) 그 학생에게 저장 중·대기 초안·더 새 저장의 실패가 있으면 보내지 않는다. (d) record version이 저장해 둔 것과 다르면, 삭제가 아니면 새 record로 다시 계산하고 3초를 다시 보인다. 삭제면 중단하고 다시 묻는다(S8).
- **S4 저장 겹침.** `saveStarted(key)`가 오면 그 학생 보류 타이머를 멈춘다. 새 저장이 성공하면(`afterSave`) 보류를 새 값으로 합치고(`prevRow`는 처음 것을 유지해 되돌리기가 원래 상태로 감) 3초를 다시 시작한다. 새 저장이 실패하면(`saveFailed`) 보류를 취소하고 "저장 실패로 체크히어 반영 안 함". (검토: `b2Save`가 3초보다 오래 걸려 예전 결정, 예를 들어 결석 삭제가 나감)
- **S5 자동으로 보내는 경우.** `checkhereChangeKind(prevRow,row)==='checkhere'`일 때만 자동으로 보낸다. 증빙만 바꾼 저장, 인정 아닌 유형의 사유만 바꾼 저장은 자동으로 보내지 않고, 대응표 결과가 `send`면 행에 `체크히어 맞추기` 버튼만 보인다(누르면 같은 3초 흐름). `res.unchanged`(기록 없던 학생을 출석으로 저장, `beta2.gs:656`)는 저장 성공으로 표시한다. `afterSave`에는 `unchanged:true`를 넘기고, `afterSave`는 이때 보류 항목을 만들지 않는다(시트가 바뀌지 않았으므로 자동 전송 없음 — 검토 1-5의 "afterSave 부르지 않기"와 2-9의 "성공으로 처리"를 합친 규칙). 다음 `before`는 `res.unchanged ? (지금 행의 sig || '') : res.sig`다. 기록 없는 행이면 `''`다. 절대 `undefined`로 두지 않는다(`beta2.gs:653`이 `undefined`·`null`이면 충돌 검사를 건너뜀). `client.save`도 이때는 묶음을 고치지 않는다(`beta2-data.mjs:37`). (검토: 관계없는 저장이 체크히어 시간·메모를 다시 씀, unchanged 응답에 sig 없음)
- **S6 진행 중 요청.** P4대로: 같은 학생의 진행 중 요청은 항목이 겹치지 않아도 막는다. 모두 내 pending 자동 요청(`createdBy===user.email && status==='pending' && isLiveRequest(r) && isAutoLedgerRequest(r)`)이면 `withdrawRequest(db,user,id)`로 취소한 뒤 계산한다. 내 pending 직접 요청이면 행에 `요청 취소` 버튼을 보이고 보류. 다른 사람 요청·approved·applying이면 보류("진행 중 요청이 끝나면 자동 반영"). (검토: 지각 → 조퇴로 고쳤는데 둘 다 적용, 지각 → 출석으로 되돌렸는데 지각 메모가 적용) `docs/checkhere-handoff-review.md` 3번을 고치면 중계도 같은 학생·항목에 다른 진행 중 요청이 있는 실시간 요청을 반려한다. 브라우저가 P4로 먼저 막으므로 자동 요청이 여기에 걸리는 것은 경쟁 상황뿐이고, 그때 행은 `자동 반영 안 함` + `다시 보내기`로 보인다.
- **S7 미뤄 둔 전송.** `retryWhen:'request'`: 막던 요청이 `verified`이고 `alreadyApplied`가 아닐 때만 record version이 바뀌길 기다린다. `rejected`·`withdrawn`·`failed`·`conflict`·`partial`·`unknown`·이미 반영이면 곧바로 다시 계산한다(`version`은 내용 해시라 이때는 안 바뀜, `checkhere/identity.mjs:6`). `retryWhen:'record'`: record가 complete가 되면 다시 계산. 다시 보내기 전에는 `client.bundle(cls)`(변경 번호 확인)로 sig를 다시 보고, 다르면 버린다. 다시 계산한 결과는 새 3초 되돌리기로 보인다. (검토: 버전이 안 바뀌어 영원히 안 나감, 미룬 전송이 오래된 시트 값을 씀)
- **S8 삭제.** 결과에 `deleteTimes`가 있으면(결석 포함) 보내기 전에 반드시 `confirm`으로 지울 시간(HH:MM)을 보여 주고 "체크히어 실제 입실 기록은 남을 수 있습니다"를 알린다. 미뤄 둔 뒤에는 삭제를 자동으로 보내지 않는다. 확인창에서 보인 입·퇴실과 record가 다르면 중단하고 다시 묻는다. (검토: 실수로 고른 결석이 확인 없이 시간을 지움, 13:00 늦은 입실을 자동으로 지움)
- **S9 되돌리기.** 타이머를 멈추고 Firestore에 아무것도 쓰지 않는다. **시트도 되돌린다**: `client.save({...prevRow, before: hold.sig})`. 기록이 없던 학생이었으면 `출석` 행이 남는다(결과는 같음). 되돌리기 저장이 CONFLICT면 최신 값을 보이고 "되돌리지 못함 · 최신 값 확인". (검토: 되돌리기가 체크히어만 취소)
- **S10 반·날짜 바꾸기.** `setDay`로 다른 반·날짜로 갈 때 보류가 있으면 `confirm("체크히어 반영 대기 n건을 지금 보낼까요?")`: 예 → 저장해 둔 반·날짜 기준으로 S3 확인 후 보냄, 아니오 → 취소. 보류가 다른 날 record 흐름으로 넘어가지 않는다.
- **S11 쓰기.** `setDoc(doc(db,'checkhereRequests','b2_'+crypto.randomUUID()), {...request, status:'pending', createdBy:user.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp()})`. 다른 키를 넣지 않는다(`firestore.rules:29`). `[2기 베타]`는 가드가 넣는다. 저장된 문서와 로컬 입력을 비교할 일이 있으면 `beta2RequestData(path,{...input,status:'pending'})`를 거친 값과 비교한다(`checkhere-proposals.mjs:114`와 같은 함정). id `b2_`+uuid는 39자라 연결 프로그램의 `/^[-\w]{16,80}$/`(`server.mjs:173`)를 통과한다. 접두사는 `retry_`·`proposal_`을 쓰지 않는다(`docs/checkhere-handoff-review.md` 4번 수정 뒤 중계가 그 접두사를 건너뛴다). 근거(reason)는 앞뒤 공백이 없어야 한다: 승인 때 `approval.reason`이 저장된 reason과 같아야 하기 때문(`firestore.rules:46`, `checkhere/approval-core.mjs:66`). `buildLiveRequest` 결과는 `]`로 끝나고 가드도 공백을 만들지 않는다. 작성자는 관리자여야 한다(중계가 관리자 아닌 계정 요청은 건너뜀, `checkhere-live-relay.mjs:76`. /beta2는 관리자 전용이라 문제없음).
- **S12 안전망.** 보내기 전 `memoDefaultTimes(request.changes, capturedRecord)`가 `{}`가 아니면 보내지 않는다. `cleanRequest`가 날짜 범위로 실패하면 P0 보류로 바꾼다. `buildLiveRequest`의 "바뀐 값이 없습니다."는 `same`으로, "상세 기록이 아직 없습니다"는 `hold('record')`로 바꾼다.
- **S13 오류.** `permission-denied`이고 `deleteTimes`가 있으면 `denied=true`(이 세션 동안 삭제 끔), "시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다". 그 밖은 "보내지 못함 · 다시 보내기".
- **S14 구독.** 반·날짜마다 한 번: `onSnapshot(query(collection(db,'checkhereRequests'), where('classId','==',cls), where('date','==',date)))`(orderBy 없음, 복합 색인 불필요, `stamp(createdAt)`로 정렬), `onSnapshot(doc(db,'settings','checkhereFeatures'))`, `onSnapshot(doc(db,'settings','checkhereRelay'))`. 문서가 없으면 꺼짐으로 본다.
- **S15 떠날 때.** `canLeave`: 저장 중이면 막는다. 보류가 있으면 confirm 후 `flushAll()`(S3·S8 확인을 그대로 거침, 삭제는 이미 확인받은 것만). `beforeunload` 경고. 탭을 그냥 닫으면 체크히어 전송은 사라지지만 대조 열에 불일치가 남는다.

같은 단계에서 1기 재처리 경로를 막는다(검토: 실패한 자동·삭제 요청이 [기준] 확인 없이 며칠 뒤 다시 적용됨): `checkhere-retry-store.mjs:18-30` `ensureRetryRequest`와 `checkhere-requests.mjs:134-168` `retryReview`(실패 건 다시 처리), `:203`(일괄)에서 `isAutoLedgerRequest(r)`이거나 `r.deleteTimes`가 있는 요청은 빼고 "출결대조에서 다시 보내기"를 안내한다.

## 5. 출결대조 화면 동작

### 행 모양

- **출결원장 칸**: 유형 `<select data-inline="type">`(B2_TYPES). 재학 기간 아니고 기록도 없으면 꺼짐("재학 기간 아님"). `중복` 행은 빈 선택지 "유형 선택 필요"가 선택된 채로 보이고, 유효한 유형을 고르기 전에는 사유·시간을 저장하지 않는다. 필요한 시간 칸만(`neededTimes`: 지각류 inT, 조퇴류 outT, 외출류 oa+ob, `type=time`). 사유 `<input data-inline="reason" maxlength=300>`. 기록 없는 출석 행은 사유 칸을 끄고 "출석은 사유를 저장하지 않습니다(유형을 바꾸면 저장)"를 보인다(`beta2.gs:656`). 증빙 배지 옆 `증빙` 버튼은 기존 편집기(`editorHtml`)로 ev/evr만 고친다.
- **체크히어 칸**: 지금처럼 입실 → 퇴실·교시 기록·외출·메모(`beta2-ledger.mjs:43-49`). 입실·퇴실 시간 옆에 × 버튼(`data-ch-del="entry|exit"`). 그 아래 상태 칩 `[data-status]`.
- **도구줄**: `#b2Live` 옆에 중계 표시. 신호가 `RELAY_STALE_MS` 안이면 "수집 PC 중계 작동 중 · 신호 n분 전", 아니면 "중계 꺼짐 · 요청은 반영 대기로 남습니다".
- 기존 '체크히어 요청' 패널은 '직접 요청'으로 이름을 바꿔 둔다. 65행 안내문은 "자동 반영: 출결원장 저장 3초 뒤 [실시간 베타] [2기 베타] 요청이 만들어지고, 수집 PC가 체크히어에 입력한 뒤 다시 읽어 확인합니다. 직접 요청: 아래 칸에서 따로 요청합니다."처럼 바꾼다.

### 저장 규칙 (검토 반영: 선택만 바꿔도 바로 저장하지 않는다)

Windows 크롬에서는 닫힌 select에 포커스가 있을 때 위·아래 화살표만 눌러도 값과 change가 바뀌고, time 칸은 숫자 자리마다 change가 난다. 그래서:

1. 유형을 바꾸면 **아직 저장하지 않는다**. 행에 그 유형에 필요한 칸과 작은 `저장`·`취소` 버튼이 나타난다. 필요한 시간은 체크히어 값으로 미리 채운다(`timesFromRecord(matchFor(row))`).
2. `저장` 클릭 또는 Enter로 저장한다. 인정 유형인데 사유가 없거나 필요한 시간이 없으면 "입력 필요: 사유/입실 시간"을 보이고 그 칸에 포커스, 저장하지 않는다.
3. 유형이 이미 저장된 행에서 시간 칸은 blur·Enter 때, 사유 칸은 blur·Enter 때 값이 바뀌었으면 저장한다. Esc는 되돌린다.
4. 학생마다 저장은 한 번에 하나. 저장 중에 또 바꾸면 마지막 초안만 대기시켰다가 이어서 저장한다. 저장 시작 때 `sync.saveStarted(key)`.
5. 저장 값: `client.save({cls,name,date,type,...neededTimes(type,draft),reason,ev: type==='출석'?'':rec.ev, evr, before: sig})`. 돌아온 `res.sig`가 다음 `before`다(`client.save`가 묶음도 고친다, `beta2-data.mjs:35-40`). `res.unchanged`면 S5.
6. CONFLICT → 최신 값을 불러와 그 행에 "그사이 바뀜 · 최신 값 표시", 체크히어에는 아무것도 보내지 않고 그 학생 보류도 취소. 다른 오류 → 그 행에 오류, `sync.saveFailed(key)`.
7. 성공 → `sync.afterSave(key,{prevRow(저장 전 값, ev/evr 포함), row(방금 보낸 값), sig, existedBefore, unchanged})`. 지금처럼 다시 `client.bundle`을 통째로 읽지 않고(`beta2-ledger.mjs:123`) 고쳐진 묶음으로 그 행만 다시 그린다.

### 상태 흐름

`보내기 전 3…2…1 · 되돌리기` → (Firestore 쓰기) `보내는 중` → `반영 대기` → `반영 준비` → `반영 중` → `완료`. 끝나지 못하면 `자동 반영 안 함`(이유 + `다시 보내기`: 지금 시트·record로 다시 계산, 그대로 다시 보내지 않음) 또는 실패류. 보내지 않는 경우 `체크히어 이미 같음`, `보류: 이유`, `체크히어 맞추기`.

### 다시 그리기

- `renderRows`는 `<tr data-name>`마다 html을 기억하고 바뀐 행만 바꾼다. `document.activeElement`가 들어 있는 행, 초안이 있는 행은 건너뛰고 focusout 때 다시 그린다.
- 상태만 바뀌면 `[data-status]`만 바꾼다. 1초 타이머는 보류가 있을 때만 돈다.
- `loadCheckHere`(`beta2-ledger.mjs:84-97`): 모든 날짜에서 `loadCheckHereDay`로 먼저 읽고(옛 저장본 대체 포함) `watchCheckHereDay`로 갱신을 받는다. 지난 날도 검증된 결과가 바로 보인다. `life.on(unwatch)`은 한 번만 건다.
- `client.watch`(155행)는 저장 중·초안 있음·입력칸 포커스일 때 다시 읽지 않는다.

### × 버튼 (지금은 꺼 둠)

- `sync.gate().enabled`이고 그쪽에 시간이 있을 때만 켠다. 꺼져 있으면 `title`에 이유(`deletionGate` reasons)를 보인다. 지금 단계에서는 항상 꺼져 있다.
- 시트 유형이 그쪽 시간을 쓰면 거절: 지각·인정지각 → 입실, 조퇴·인정조퇴 → 퇴실. "유형을 먼저 바꿔 주세요 (결석으로 바꾸면 입·퇴실을 함께 지웁니다)". `b2Validate_`가 그 시간을 요구하기 때문(`beta2.gs:316-318`).
- 켜진 뒤(AFTER): confirm(지울 시간, 실제 입실 기록이 남을 수 있음) → `sync.send(key,{deleteTimes:[side]})` → 같은 3초 되돌리기.
- 시트의 빈 시간 칸으로 삭제를 추측하지 않는다(시트 inT/outT는 유형이 안 쓰면 늘 비어 있다).

## 6. 단계별 구현 순서

번호는 설계 JSON의 단계 번호를 그대로 썼다. 권장 순서 — NOW: 2 → 7 → 8 → 9 → 5a → 6 → 10a. AFTER: (`docs/checkhere-handoff-review.md` 1·3·4번 먼저) → Cowork 보고서 확인 → 3 → 4 → 5b → 11 → (사용자: 규칙 게시·깃발) → 10b. AFTER 단계는 연결 프로그램 파일을 바꾸는 단계마다 build(`server.mjs:70`과 `Start.ps1:11`)를 같은 새 값으로 올리거나, 여러 단계를 한 push로 묶어 한 번만 올린다(검토 2-11). 재시작하면 연결 키가 새로 만들어지므로(`server.mjs:22`) 중계 탭에 새 키를 다시 넣어야 한다(`docs/checkhere-handoff-review.md` "연결 프로그램 파일을 고칠 때"). 각 단계 시작 전에 시험 전체를 돌려 9장의 기준선과 비교한다.

| 단계 | 언제 | 연결 프로그램 파일 변경·build | 한 줄 |
|---|---|---|---|
| 1 | 폐기 | — | 진단 프로그램 대신 Cowork 보고서 |
| 2 | NOW | 없음 | 순수 모듈 `beta2-checkhere-core.mjs`, 병원 분류 넓히기 |
| 3 | AFTER | 있음 → build 올림 | 공유 삭제 배관(`deleteTimes`) |
| 4 | AFTER | 있음 → build 올림 | 연결 프로그램 삭제 게이트, `deleteTime`은 아직 오류만 |
| 5a | NOW | 없음 | 중계 신호 `settings/checkhereRelay` |
| 5b | AFTER | 있음(`/api/state`에 build) → build 올림 | 중계의 삭제 게이트 |
| 6 | NOW | 없음 | 규칙 초안 별도 파일 + 게시 안내(게시 안 함) |
| 7 | NOW | 없음 | 대조 보정 모드, 사유 힌트 |
| 8 | NOW | 없음 | 동기화 모듈 `beta2-checkhere-sync.mjs`, 1기 재처리 제외 |
| 9 | NOW | 없음 | 행 안 편집 화면 |
| 10a / 10b | NOW / AFTER | 없음 | 문서 |
| 11 | AFTER | 있음 → build 올림 | `collector.deleteTime` 실제 구현, `time-delete-v1` 광고 |

### 1단계 [폐기] Cowork 보고서로 대신

진단 프로그램을 만들지 않는다. 보고서에서 받아야 할 것: 입실 수정창·퇴실 수정창의 입력칸(시간 칸 형식, 비울 수 있는지)과 버튼(`삭제` 유무와 정확한 글자), 수정창 밖 삭제 방법, 0번 칸(실제 입실)에 편집기가 열리는지, 시간을 지우면 관리자 메모도 지워지는지, 입실만·퇴실만 지울 수 있는지, 확인창 문구(사용자가 허락한 시험용 학생 1회만). 이 중 "0번 칸(실제 입실)을 눌러 편집기가 열리는지"와 "시간을 지우면 메모도 지워지는지"는 Cowork 요청서(`docs/cowork/2026-10-13-checkhere-delete-and-beta2.md` 1번)에 따로 적혀 있지 않다. 보고서에 없으면 사용자에게 추가 확인(Cowork 재요청)을 부탁하고, 확인 전에는 3·4·11단계의 해당 결정을 미룬다.

### 2단계 [NOW] 순수 모듈과 사유 분류

- 파일: `beta2-checkhere-core.mjs`(새), `checkhere-proposal-core.mjs`
- 할 일: 4.1의 함수 전부, 3장 대응표 그대로. `checkhere-proposal-core.mjs:10`의 병원 패턴을 `/병원|병결|병가|진료|치료|질병|입원|통원|수술|검진/`으로 넓혀 `beta2-core.mjs:10`과 맞춘다(하나만 맞아야 하는 규칙은 유지, `병원 면접`은 여전히 ''). 1기 추천에도 쓰이는 공유 파일이므로 기존 시험을 함께 돌린다.
- 시험: `checkhere/tests/beta2-checkhere-core.test.mjs`(새), `checkhere/tests/proposal.test.mjs`(9장).

### 3단계 [AFTER] 공유 삭제 배관

- 파일: `checkhere/approval-core.mjs`, `checkhere/rules.mjs`, `checkhere-live-core.mjs`, `checkhere/writeback.mjs`, `checkhere/direct-edit.mjs`, `checkhere-requests.mjs`, (`checkhere/cloud-approval.mjs` 로직 변경 없음)
- 할 일: 7장 "공유 모듈 변경" 그대로. 핵심: 지정되지 않은 `''`는 어디서나 계속 거절, `deleteTimes`는 비어 있지 않을 때만 결과에 넣어 기존 요청 모양을 그대로 둔다, capability 검사는 **삭제를 요청할 때만**.
- 연결 프로그램이 이 파일들을 쓰므로(`server.mjs` → `writeback` → `approval-core`·`rules`) build를 올린다(`server.mjs:70`, `Start.ps1:11`).
- 시험: `approval.test.mjs`, `time-delete.test.mjs`(새), `live-relay.test.mjs`, `direct-edit.test.mjs`, `request-ui.test.mjs`·`bulk-approval-ui.test.mjs`.

### 4단계 [AFTER] 연결 프로그램 쪽 삭제 (아직 실제 삭제 없음)

- 파일: `checkhere/collector.mjs`, `checkhere/server.mjs`, `checkhere/Start.ps1`
- 할 일: `collector.write(record, field, change, {requestedFields, deleteFields=[]}={})`(217행): `modal()` 바로 뒤, `deleteFields.includes(field)`면 `requestedFields`에도 있어야 함(아니면 닫고 오류). 이미 비어 있으면 닫고 `{time:null, memo:before.memo}`. 아니면 `this.deleteTime(...)`. `deleteTime`은 11단계 전까지 수정창을 닫고 `TIME_DELETE_UNSUPPORTED: 체크히어 시간 삭제 방법을 아직 확인하지 못했습니다.`를 던진다. 226행 빈 시간 막기는 삭제가 아닌 쓰기에 그대로. `server.mjs`: `createBridge({..., capabilities=CAPABILITIES})`로 주입 가능하게. 게이트는 `/api/apply`·`/api/confirm-existing` 모두 **179행 `approvalCloud.get` 바로 뒤, 185행 `approveExisting`과 192행 `claim` 전**에 둔다(검토: confirm-existing은 claim 전에 이미 approved로 바꾸므로, 그 뒤에 막으면 규칙상 되돌릴 수 없어 영원히 BRIDGE_OLD로 재시도). `time-delete-v1`은 이 단계에서 아직 넣지 않는다. build를 올린다.
- 시험: `time-delete.test.mjs` 연결 프로그램 부분(포트 18797~18799), `collector.test.mjs`.

### 5단계 — 중계 (5a NOW / 5b AFTER)

**5a [NOW] 중계 신호**
- 파일: `checkhere-live-relay.mjs`, `checkhere-live.mjs`, `checkhere-live.html`
- 할 일: `refresh()`(28-33행)에서 받은 capabilities와 (있으면) build를 `status`에 노출. `mountRelay`(161-197행): 시작·멈춤, 상태·capabilities가 바뀔 때, 작동 중 60초마다 `setDoc(doc(db,'settings','checkhereRelay'), {state, busy, queue, capabilities, build: s.build||null, lastErrorAt, at: serverTimestamp(), by: user.email})`. `status.current`(반·이름이 들어 있음)와 `lastError` 글은 넣지 않는다(담임도 읽을 수 있음, `firestore.rules:210`). 규칙 변경 불필요(관리자 쓰기 허용). `checkhere-live.html:56`의 `?v=`를 올린다.
- 시험: `live-ui.test.mjs`(9장).

**5b [AFTER] 삭제 게이트**
- 파일: `checkhere-live-relay.mjs`, `checkhere-live.mjs`, `checkhere-live.html`, `checkhere/server.mjs`
- 할 일: `processRequest`에서 81행 `cleanRequest` 바로 뒤와 80행 승인됨 분기(`cleanRequest(r)`)에서, `deleteTimes`가 있는데 capabilities에 `time-delete-v1`이 없으면: pending → `reject(r,'수집 PC 프로그램이 아직 체크히어 시간 삭제를 지원하지 않습니다. 「체크히어 시작.cmd」를 최신으로 실행한 뒤 다시 요청해 주세요.')`(체크히어 읽기·쓰기 없음), approved → `BRIDGE_OLD`. 94행 `checkLiveEdit`에 `clean.deleteTimes` 전달. `changeText`(33행)에 `(삭제)`, 118행 안내 갱신, permission-denied는 "규칙 미게시" 문구로. `/api/state`(`server.mjs:78`)에 `build` 추가(build 올림).
- 선택(보류 권장): 요청 우선순위를 위한 `/api/cancel` 사용. 하려면 검토대로 `/api/cancel`에 jobId 인자를 받아 `jobs.get(busy)?.id===jobId && kind==='sync'`일 때만 취소, 중계는 자기가 시작한 sync의 id로만 취소, 수동 갱신도 `status.current`를 쓰고 취소된 수동 갱신은 다시 큐에 넣는다(`server.mjs:82`, `checkhere-live-relay.mjs:120,124`, `collector.mjs:186`). 지금 그대로면 운영자가 시작한 일괄 수집을 취소할 수 있다.
- 시험: `live-relay.test.mjs`.

### 6단계 [NOW] 규칙 초안(별도 파일)과 게시 안내 — 게시하지 않음

- 파일: `checkhere-time-delete.rules.txt`(새, 저장소 루트에 따로 두는 규칙 초안. 기존 `learning-beta.rules.txt`, `survey-firestore.rules.txt`는 조각 파일이지만 이 파일은 통째로 붙여 넣을 수 있는 전체 사본이다), `docs/checkhere-time-delete-rules.md`(새). `firestore.rules`는 **바꾸지 않는다**. 참고: 저장소 루트 파일은 `.vercelignore`에 없어 Vercel 정적 파일로도 올라간다(기존 `.rules.txt`도 같음). 규칙 내용은 비밀이 아니지만, 원하면 `.vercelignore`에 넣는 것을 사용자에게 묻는다.
- 할 일: 초안 파일 = 지금 `firestore.rules` 전체에 7장의 네 부분만 고친 사본(통째로 붙여 넣을 수 있게). 안내 문서는 7장 "게시 안내" 그대로.
- 시험: `firestore-rules-draft.test.mjs`(새, 문자열 검사, 9장).

### 7단계 [NOW] 대조 보정 모드와 사유 힌트

- 파일: `beta2-core.mjs`, `beta2-ledger.mjs`
- 할 일: `compareCheckHere(type, rec, record, {today, date, now, corrected=false})`(83-106행): 보정 모드에서는 지각·결석 판단을 연결 프로그램이 고치는 교시 `entry`로 한다(86행의 `rawEntry` 우선 대신). `rawEntry`가 `entry`와 다르면 ` · 실제 입실 HH:MM`을 붙인다. `entry`가 비어 있어도(시간 삭제 뒤) `entry` 기준이다. 예외: 오늘이고 `entry`·`exit`가 모두 없으면 `rawEntry`로 돌아간다(교시 기록이 늦게 찍힐 수 있음). (설계 본문은 "`rawEntry`와 `entry`가 모두 있고 다를 때"라고 적었지만, 같은 설계의 시험 "결석 + `rawEntry` 09:02 + `entry` null → 보정 모드 `ok`"와 맞추려면 이렇게 읽어야 한다.) 출결대조는 `corrected:true`를 넘긴다 → 검증된 출석 시간 맞추기(09:00)나 결석 삭제가 영원한 불일치로 남지 않는다. `memoReason`(11행): 괄호 안이 시간(`/^\d{1,2}:\d{2}/`)이면 두 번째 정규식을 쓰지 않는다.
- 시험: `beta2-core.test.mjs`(9장).

### 8단계 [NOW] 동기화 모듈과 1기 재처리 제외

- 파일: `beta2-checkhere-sync.mjs`(새), `checkhere-retry-store.mjs`, `checkhere-requests.mjs`
- 할 일: 4.2 전부(S1~S15)와 재처리 제외.
- 시험: 9단계 브라우저 시험, 2단계의 `rowCheckHereStatus`·`deletionGate` 단위 시험, 재처리 시험(9장).

### 9단계 [NOW] 행 안 편집 화면

- 파일: `beta2-ledger.mjs`, `beta2.css`, `index.html`
- 할 일: 5장 전부. `beta2.css`: 행 안 입력칸 크기, 상태 칩 색, × 버튼, 남은 초. `index.html:205`의 `beta2-admin.mjs?v=`를 올린다. 가드와 import map(`index.html:6`)은 그대로. 참고: `beta2-admin.mjs:4`가 `./beta2-ledger.mjs`를 버전 없이 불러오므로 205행을 올려도 ledger·새 모듈 주소는 같다. Vercel 정적 파일은 기본이 재검증이라 보통 문제없지만, 배포 후 강력 새로고침으로 새 코드가 도는지 확인한다.
- 시험: `beta2-ui.test.mjs`(9장).

### 10단계 — 문서 (10a NOW / 10b AFTER)

- **10a [NOW]**: `docs/checkhere-live-beta.md`에 출결대조 자동 흐름·상태 칩·중계 신호, 이 문서 갱신, `docs/cowork/…` 보고서가 오면 결과 반영. 마스터시트 L열 수식은 체크히어에 쓰이지 않는다는 점(맞추는 것은 사용자·Cowork의 선택 사항).
- **10b [AFTER]**: 삭제 게이트와 각 꺼짐 이유의 뜻, build 올림(「체크히어 시작.cmd」가 쉬고 있는 옛 연결 프로그램을 자동 재시작, 작업 중이면 거절 `Start.ps1:13`), `checkhere/README.md`.

### 11단계 [AFTER] `collector.deleteTime`

- 파일: `checkhere/collector.mjs`, `checkhere/server.mjs`, `checkhere/Start.ps1`, `checkhere/tests/collector.test.mjs`, `checkhere/tests/live-relay.test.mjs`
- 할 일: Cowork 보고서대로 구현(예: `#modifyTime`을 비우고 `변경`, 또는 `삭제` 버튼 + 확인창 — `this.saving=true` 동안만 수락, `collector.mjs:27`). `#modifyTime`이 사라질 때까지 기다리고 `{time:null, memo: 삭제 후 예상 메모}`를 돌려준다. 0번 칸(실제 입실)이 편집 가능하면 별도 항목으로 후속 작업, 아니면 "실제 입실은 남음"을 문서화. 체크히어 UI로 지울 수 없으면 `time-delete-v1`을 광고하지 않고 ×를 "체크히어에서 삭제 불가 · 시트만 수정"으로 영구히 끈 뒤 사용자에게 알린다. 가능하면: (a) `deleteTime` 구현과 가상 화면 시험 → (b) `CAPABILITIES`에 `time-delete-v1` 추가, build 올림 → (c) 사용자가 규칙 게시 → (d) 사용자 허락 후 시험용 학생 1명으로 실제 삭제 1회. 직접 클릭이나 `collector.write()` 호출이 아니라 요청 → 승인 → `/api/apply` → 다시 읽어 확인 경로로 한다 → (e) 결과가 맞으면 사용자가 `settings/checkhereFeatures.timeDeleteRules=true`를 만들어 전체가 켜진다. 설계 원문은 "시험 1회 → 능력 추가" 순서였지만, 삭제 요청 문서는 규칙 게시 전에는 만들 수 없고 중계·연결 프로그램은 `time-delete-v1`이 없으면 거절하므로 그 순서로는 할 수 없다. (d)에서는 깃발이 아직 없어 /beta2 ×가 꺼져 있으므로, 시험 요청을 어느 화면에서 만들지는 그때 사용자와 정한다.
- 시험: 보고서의 실제 수정창을 재현한 가상 화면 시험(문서화된 버튼만 누름, 다시 읽어 `null` 확인, 검증 확인창이 뜨면 거짓 성공이 아니라 `failed`), 실제 `CheckHereCollector`로 가상 화면 끝까지 중계 시험, 수집 PC에서 시험용 학생 수동 확인.

## 7. 시간 삭제 설계

### 들어오는 곳

- (a) 출결대조에서 결석으로 저장 → 시간 있는 쪽 모두 삭제(확인창 필수, S8). 시트 E~H는 `neededTimes`+`b2Save`로 이미 비워진다.
- (b) 체크히어 입실·퇴실 옆 × → `{changes:{[side]:''(, [side+'Memo']:'')}, deleteTimes:[side]}`. 같은 3초 되돌리기·상태 칩.
- 시트의 빈 칸으로 삭제를 추측하지 않는다.

### 요청 모양

- 새 선택 필드 `deleteTimes`: `['entry','exit']`의 부분집합, 중복 없음, 정해진 순서, 관리자만, 비어 있지 않을 때만 넣는다.
- 지정된 쪽은 `changes[side]===''`. 지운 쪽 메모는 **선택**: Cowork 보고에서 시간 삭제 때 메모가 함께 지워지거나 함께 비워야 하면 `''`를 넣고, 아니면 넣지 않는다(검토: 메모를 `''`로 못 박으면 체크히어가 메모를 남길 때 모든 삭제가 conflict로 끝남). 규칙 초안은 두 경우 모두 허용한다.
- 지정되지 않은 `''`는 어디서나 계속 거절 → 담임용 요청 폼(`checkhere-requests.mjs:43`, 체크하고 빈칸이면 '')이 삭제가 되지 않고 `approval.test.mjs:9`도 그대로 통과. 삭제가 아닌 요청은 모양이 그대로.

### 켜지는 조건 (모두 필요, 아니면 × 꺼짐·결석은 hold)

- G1 `settings/checkhereFeatures.timeDeleteRules===true`(사용자가 규칙 게시 후 콘솔에서 만듦)
- G2 `settings/checkhereRelay.capabilities`에 `time-delete-v1`(중계 신호가 연결 프로그램 capabilities를 옮김)
- G3 이 세션에서 permission-denied를 보지 않음

겹겹 방어: 중계가 능력 없는 연결 프로그램일 때 pending 삭제 요청을 반려(5b), 연결 프로그램 `/api/apply`·`/api/confirm-existing`이 `get` 직후 거절(4단계), `assertChangeAllowed`가 capabilities가 주어졌는데 능력이 없으면 거절(삭제 요청일 때만), direct-edit는 삭제를 아예 거절, `collector.write`는 11단계 전까지 `TIME_DELETE_UNSUPPORTED`.

### 공유 모듈 변경 (3단계)

- `approval-core.cleanRequest`(7-25행): `input.deleteTimes`(없거나 null → `[]`)는 배열, 중복 없음, `entry`/`exit`만, 아니면 "삭제할 시간 항목을 확인해 주세요.". `''`는 지정된 쪽만 허용(지정 안 된 `''`는 18행 문구 그대로). 지정된 쪽은 반드시 `''`이고 changes에 있어야 함, 그쪽 메모가 있으면 `''`. 23행 퇴실<입실 검사는 둘 다 비어 있지 않을 때만. 결과에는 비어 있지 않을 때만 `deleteTimes`.
- `sameRequestTarget`(26-33행): `JSON(deleteTimes||[])`도 비교.
- `requestMatchesRecord`(41-44행): 지운 쪽은 `!normalizeTime(record[k])`(null·''·'-' 모두 빈 것, try/catch). 나머지는 지금처럼 엄격히.
- `prepareApproval` 65행: `if(!after[k]&&!del.includes(k))delete after[k]` → 지정된 삭제만 `after.entry=''`로 남고, 손대지 않은 빈 값은 지금처럼 지운다.
- `proposalFromApproval`(68-74행): 지운 쪽 `a.after[k]!==''`면 오류. `memoDefaultTimes`는 명시된 `''` 키를 이미 건너뛴다는 주석.
- `rules.mjs`: `export const TIME_DELETE_CAPABILITY='time-delete-v1'`. `assertChangeAllowed(record, changes, {capabilities, requested=false, deletions=[]})`: `blanks=['entry','exit'].filter(k=>own(changes,k)&&!normalizeTime(changes[k]))`가 deletions와 같은 집합이 아니면 "시간을 비우는 변경은 「시간 삭제」 요청으로만 처리합니다.". `deletions.length&&!requested`면 거절(direct-edit 막음). capability는 **`if(deletions.length&&capabilities&&!capabilities.includes(TIME_DELETE_CAPABILITY))throw …`** 형태로만(검토: 무조건 검사하면 지금의 모든 실시간·수동 승인이 거절됨 — 호출부 `checkhere-live-relay.mjs:94`, `checkhere/direct-edit.mjs:36`, `checkhere-requests.mjs:32`가 이미 capabilities를 넘김). 지운 쪽 메모는 `''`만. 84행 필요 시간 검사는 `needs(side)=!deletions.includes(side)&&(그쪽 시간·메모가 바뀜)`. 남은 시간의 역전 검사는 유지. 경고 "체크히어 입실(교시)/퇴실 시간을 삭제합니다. 실제 입실 기록은 남을 수 있습니다.".
- `checkhere-live-core.buildLiveRequest(record, form, reason, {deleteTimes=[]}={})`: 지정된 쪽 폼 시간은 비어 있어야("삭제할 시간 칸은 비워 주세요."). record에 시간이 있으면 `changes[k]=''`(메모는 위 "선택" 규칙대로), 이미 비었으면 건너뜀. 지정 없이 빈 시간이면 계속 오류, 문구에 `비우는`을 남긴다(`live-relay.test.mjs:32`), 예 "시간을 비우는 수정은 「시간 삭제」로만 할 수 있습니다.". `cleanRequest`에 deleteTimes 전달, `checkLiveEdit(record, changes, capabilities, deletions)` → `assertChangeAllowed`.
- `writeback.validateProposal(record, input, {requested, deletions=[]})`: 빈 `next[k]`는 `requested && (!normalizeTime(record[k]) || deletions.includes(k))`일 때만, 아니면 "요청하지 않은 시간 삭제입니다.". `applyVerified`: `deletions=cleanRequest(request).deleteTimes||[]`, `adapter.write`의 옵션에 비어 있지 않을 때만 `deleteFields` 추가(기존 옵션 모양 유지), journal `before_write`에 `deleteTime:true`. 지운 쪽 확인 = 다시 읽은 기록이 live·complete, `!normalizeTime(fresh[timeKey])`, 메모는 어댑터가 알려 준 값과 같음, 반대쪽은 그대로(요청 경로에서도). 결과에 `{deleted:true, rawEntryBefore, rawEntryAfter}`. 이미 빈 쪽은 건너뜀(재시도 안전). 47행 마지막 확인 유지. 메시지에 ` · 입실/퇴실 시간 삭제 확인`.
- `direct-edit.mjs:17` 뒤: `clean.deleteTimes`면 "시간 삭제는 출결대조 실시간 반영으로만 처리합니다.".
- `checkhere-requests.mjs`: `judgeRequest`(32행)는 `cleanRequest(r)`의 deleteTimes를 deletions로. 검토(72행)·일괄(111행)·재처리(139행) 화면에서 '공란' 대신 '삭제'. 일괄 승인에서 삭제 요청은 빼고 "시간 삭제는 개별 승인".
- `cloud-approval.mjs`: 로직 변경 없음(`encode('')`는 빈 문자열, `finish`·`approveExisting`은 바뀐 함수를 거침). 선택: `deleted:true` 결과가 있으면 메시지에 ` · 시간 삭제 확인`.

### 규칙 초안 내용 (`checkhere-time-delete.rules.txt`에만, 게시는 사용자)

`validChanges`(`firestore.rules:18-24`)는 그대로 두고 `checkhereProposalSources`(156행)도 계속 그것을 쓴다. 추가 함수:

```
function hhmmss(v){return v is string && v.matches('([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]');}
function memoOk(c,k){return !(k in c) || (c[k] is string && c[k].size()<=500);}
function reqTimeOk(c,d,k){return (!(k in c) && !(k in d)) || ((k in c) && hhmmss(c[k]) && !(k in d)) || ((k in c) && c[k]=='' && (k in d));}
function deletedMemoBlank(c,d,k,m){return !(k in d) || !(m in c) || c[m]=='';}
function validRequestChanges(c,d){return c is map && c.keys().size()>0 && c.keys().hasOnly(['entry','exit','entryMemo','exitMemo']) && d is list && d.size()<=2 && d.hasOnly(['entry','exit']) && reqTimeOk(c,d,'entry') && reqTimeOk(c,d,'exit') && memoOk(c,'entryMemo') && memoOk(c,'exitMemo') && deletedMemoBlank(c,d,'entry','entryMemo') && deletedMemoBlank(c,d,'exit','exitMemo');}
function afterTimeOk(a,d,k){return ((k in d) && (k in a) && a[k]=='') || (!(k in d) && (!(k in a) || hhmmss(a[k])));}
function validAfter(a,d){return a is map && a.keys().size()>0 && a.keys().hasOnly(['entry','exit','entryMemo','exitMemo']) && d is list && afterTimeOk(a,d,'entry') && afterTimeOk(a,d,'exit') && memoOk(a,'entryMemo') && memoOk(a,'exitMemo');}
```

`checkhereRequests`에서 고치는 네 부분:

1. create 29행: 허용 키 목록에 `'deleteTimes'` 추가.
2. create: `&& (!('deleteTimes' in request.resource.data) || (isAdmin() && request.resource.data.deleteTimes is list && request.resource.data.deleteTimes.size()>0))` 추가.
3. create 36행: `validChanges(request.resource.data.changes)` → `validRequestChanges(request.resource.data.changes, request.resource.data.get('deleteTimes',[]))`.
4. 승인 분기 47행: `validChanges(request.resource.data.approval.after)` → `validAfter(request.resource.data.approval.after, resource.data.get('deleteTimes',[]))`.

반려·취소·applying·결과 분기는 그대로. `deleteTimes`가 없는 요청은 지금과 똑같이 평가된다(하위 호환). 지운 쪽 메모는 없어도, `''`여도 통과한다(`deletedMemoBlank`).

### 게시 안내 (`docs/checkhere-time-delete-rules.md`에 쓸 내용)

1. `firebase deploy`를 실행하지 않는다.
2. Firebase 콘솔 → knewdeal-portal → Firestore → 규칙에서 지금 게시본이 저장소 `firestore.rules`(초안을 만든 커밋 기준)와 같은지 먼저 비교한다. 콘솔은 규칙 전체를 바꾸므로, 다르면 멈추고 Claude Code에 보낸다(안내 문서에 기준 커밋 id와 줄 수, 네 부분을 적어 둔다).
3. 같으면 초안 파일 전체를 붙여 넣거나 네 부분만 손으로 고친다.
4. 규칙 플레이그라운드: hint.kpc로 `checkhereRequests/x` 생성, `changes {entry:'',entryMemo:''}`, `deleteTimes ['entry']` → 허용 / 같은 것에서 `deleteTimes` 없음 → 거부 / 담임 계정 + `deleteTimes` → 거부.
5. 게시(사용자).
6. 데이터 탭에서 `settings/checkhereFeatures` 문서에 `timeDeleteRules`(boolean) `true`. /beta2는 이 깃발을 읽는다. 연결 프로그램이 `time-delete-v1`을 알리기 전에는 깃발이 있어도 ×가 켜지지 않는다(G2). 11단계의 시험용 학생 실제 확인 전이면 깃발은 그 확인 뒤에 만든다.

### Cowork 보고서에 달린 것

- '입실 삭제'가 지우는 것: 교시(1번 칸, ATTEND/PASS)뿐인지, 실제 입실(0번 칸, ENTER, `rawEntry`)도 지울 수 있는지. 0번 칸이 남으면 출결대조 보정 모드는 일치로 보이지만 체크히어에는 실제 입실이 남는다.
- 수정창이 시간을 지우는 방법(비우고 변경 / 삭제 버튼 / 불가). 불가면 삭제 기능은 영구히 꺼 둔다.
- 시간을 지우면 그쪽 관리자 메모도 지워지는지(지운 쪽 메모 `''` 여부, 위 "선택" 규칙).
- 입실만·퇴실만 따로 지울 수 있는지.
- 외출 기록 삭제는 이번 범위가 아니다(보고서에 있으면 기록만).
- 보고서와 캡처는 저장소에 넣지 않는다. 필요한 사실만 이름 없이 문서에 옮긴다.

### 순서 (AFTER)

(`docs/checkhere-handoff-review.md` 1·3·4번 먼저) → 보고서 확인 → 3·4·5b 배관(능력 광고 없음) 내보내기 → 11단계 `deleteTime` 구현·가상 화면 시험 → `time-delete-v1` 추가와 build 올림 → 사용자가 규칙 게시 → 사용자 허락 후 시험용 학생 1회 실제 확인(검증된 요청 경로) → 사용자가 깃발 → × 버튼과 결석 자동 삭제가 켜진다(11단계 (a)~(e)).

## 8. 위험과 대응

| 위험 | 대응 |
|---|---|
| 입실 삭제가 교시(1번 칸)만 지우고 실제 입실(0번 칸)은 남을 수 있음. 출결대조·`judge()`는 실제 입실을 봄 | 보정 모드(7단계), 확인창 문구, Cowork 보고로 확인 전 `time-delete-v1` 광고 안 함 |
| 체크히어 UI로 시간 삭제가 아예 안 될 수 있음(`#modifyTime` 필수, 경고창 등) | 능력 광고 안 함, × 영구 꺼짐 "체크히어에서 삭제 불가 · 시트만 수정" |
| 콘솔 게시가 규칙 전체를 바꿈. 콘솔 게시본이 저장소와 다르면 붙여 넣기로 규칙이 사라짐 | 비교 먼저, 다르면 멈춤, 네 부분 손 적용 |
| `suggest` 정책이 학생이 찍지 않은 시간을 씀(출석 늦은 입실 → 09:00, 이른 퇴실 → 18:00, 인정 → 09:00/18:00). 사람 검토 없이 3초만 | 정책 설정 가능(`memo-only`), 사용자 확인(10장 1번), 되돌리기는 시트까지 |
| 지각·조퇴에서 시트 시간으로 체크히어 교시·퇴실을 덮으면 `rawEntry`와 달라 PERIOD_MISMATCH·MEMO_MISMATCH | 경고 표시, 10장 2번 |
| 담임 이름: 메모는 `record.teacher`(강의명), 반정보 K와 다르면 시트 L열과 체크히어 메모가 다름 | 경고만, 10장 3번 |
| 지연은 몇 초가 아님. 중계 탭(수집 PC hint.kpc)이 돌아야 하고, 요청마다 미리보기 읽기 + 수정창 쓰기 + 다시 읽기, 진행 중 반 갱신이 먼저 끝나야 함 | 중계 신호 표시, 반영 대기 안내. 우선순위 취소는 보류(5b) |
| 오래된 record(최대 10분, 지난 날은 더) | 중계가 `[기준]` 불일치로 반려 → `다시 보내기`는 새 record로 다시 계산, 그대로 재전송 안 함 |
| 취소 후 재전송 경쟁: 읽은 뒤 취소 전에 승인될 수 있음 | `withdrawRequest`는 트랜잭션, 실패하면 hold(S6) |
| 공유 모듈 변경(approval-core, rules, live-core, writeback, collector, server, relay)이 1기 화면과 수집 PC에 영향. 옛 중계 탭·옛 연결 프로그램은 삭제 문서를 잘못 적용하지 않고 거절 | AFTER 단계에서만, `checkhere-live.html` `?v=`, `index.html:205` `?v=`, build(`server.mjs:70`, `Start.ps1:11`) 함께. `Start.ps1`은 바쁜 연결 프로그램 재시작을 거절 |
| 능력 없는 연결 프로그램(다운그레이드)에서 승인된 삭제 요청은 규칙상 반려 불가 → BRIDGE_OLD 무한 재시도 | 중계가 pending 단계에서 거절, 연결 프로그램 게이트를 `get` 직후로(4단계), 다운그레이드 금지 안내 |
| 중계 신호는 담임도 읽음 | 이름·오류 글 금지, `lastErrorAt`만. 작동 중 약 1분에 쓰기 1건 |
| 실시간 스냅샷이 입력 중인 값을 지움 | 행 단위 패치, 포커스·초안 행 건너뜀, 브라우저 시험 |
| 3초 안에 탭을 닫으면 체크히어 전송이 사라짐 | `beforeunload`, `canLeave` 확인, 대조 열 불일치는 남음 |
| 날짜 범위 2026-07-27~2026-10-22 밖(2기 날짜)은 거절 | P0 hold 안내, 넓히기는 사용자 확인 후 규칙(사용자 게시)+`cleanRequest` |
| 같은 행의 직접 요청이 자동 경로와 겹침. 잊힌 직접 요청이 자동 전송을 막음 | 보류 + 내 요청이면 `요청 취소` 버튼(S6) |
| `b2Save`가 수 초 걸려 겹친 저장 사이에 예전 결정이 나감 | S4 |
| 이름만으로 찾다가 다른 반·날짜 기록으로 요청 | S1·S2·S3·S10 |
| 1기 '실패 건 다시 처리'가 오래된 자동·삭제 요청을 [기준] 확인 없이 다시 적용 | 8단계 재처리 제외 |
| 브라우저 캐시로 옛 ledger 코드가 돌 수 있음(`beta2-admin.mjs:4` 버전 없는 import) | 배포 후 강력 새로고침 확인, 필요하면 import에 버전 추가 |
| 행 안 저장은 모두 기존 저장과 같아서 그 행 출처가 '베타 수정'이 되고 T열 동기화 확인이 지워짐(`beta2.gs:661`). 그 뒤 10분 동기화가 그 행을 덮어쓰지 않음. 실수로 저장한 행도 마찬가지 | 명시적 `저장`(5장 저장 규칙), 되돌리기가 시트 값도 되돌림(S9). 운영총괄 값으로 돌리려면 기존 '운영총괄 값으로 되돌리기'(`beta2-ledger.mjs:144-147`) |

## 9. 시험 계획

### 실행

- 클라우드에서 쓴 명령: `cd checkhere && NODE_PATH=/opt/node22/lib/node_modules node --test tests/*.test.mjs`
- Windows 수집 PC: `NODE_PATH` 경로가 다르다. `checkhere`에서 `npm install`(playwright 1.62.1, `checkhere/node_modules/`는 gitignore) 후 `node --test "tests/*.test.mjs"`(Node 24 이상은 따옴표 안 패턴을 직접 펼침, `package.json` engines `>=24`) 또는 `npm test`. 브라우저 시험은 `channel:'chrome'`이라 크롬이 필요하다. 시험은 임시 폴더(`checkhere/test-results/`, gitignore)와 가상 학생만 쓰고, 실행 중인 실제 연결 프로그램(8765)과 `checkhere/data/`는 건드리지 않는다.
- **코드를 바꾸기 전에 로컬 기준선을 먼저 기록한다**(전체 실행, 실패 이름 목록을 저장소 밖이나 `checkhere/test-results/`에 저장). 클라우드 기준선은 377개 중 370 통과, 7 실패(환경 문제)였고 로컬에서는 다를 수 있다:
  - CheckHere collection and approval panels remain mutually exclusive across shadow roots
  - administrators submit explicit targets independently of Sheet and collector diagnostics
  - any administrator reads only identity columns, deduplicates, stores a scoped summary; teachers read summaries only
  - automatic recognized types share display and request validation, including persisted approval evidence
  - beta UI separates initial entry, corrections, reason save and evidence confirmation
  - review opens directly, staff only reads, designated administrator can apply
  - summary queries all current dates once and falls back only for unmigrated recognized days
- 이미 쓰는 시험 포트(`checkhere/tests/*.mjs`에서 확인): 18765, 18766, 18769, 18773, 18781, 18791~18796, 18811~18814, 18872, 18901, 18921, 18931. 8765는 실제 연결 프로그램. 새 연결 프로그램 시험은 18797~18799, 18941 이후를 쓴다(`node --test`는 파일을 병렬로 돌려 EADDRINUSE가 남).

### NOW

- `checkhere/tests/beta2-checkhere-core.test.mjs`(새): 대응표 행마다 한 건. 출석은 두 메모를 비우고 늦은 입실을 `09:00:00`으로, 오늘은 빈 입실을 채우지 않고 18:00 전에는 퇴실을 건너뜀. 지각 09:25 → 분이 다를 때만 `entry:'09:25:00'`, `entryMemo:'지각_담임:{담임}(09:25)'`, 남은 `조퇴_담임:` exitMemo는 비움, inT 09:05 → hold. 조퇴도 같게. 외출 → 메모만, 입실 없으면 hold, 맞는 외출 없으면 경고. 인정 4종 → 분류 메모 + 09:00/18:00, `개인일정` → hold. 결석 → 지금은 hold, 시간 없으면 none(`deleteEnabled:true`일 때 `deleteTimes`+`''` 짝도 미리 시험). 중복 → manual. live·complete 아님 → hold(record). 담임: `record.teacher` 우선, 나쁜 담임 → hold, 불일치 → 경고. 강의시간 다름 → memo-only. 초 보존(record 09:25:31 + 시트 09:25 → 입실 변경 없음). 짝 규칙: 시간 빈 쪽 메모 비우기는 빠지고 넣기는 hold. `[`·`(00:00)`·`_담임:(` → hold. 날짜 범위 밖 → hold(P0). 성질 검사: 모든 `send` 결과에서 `buildLiveRequest(record, liveForm(record,changes), text)`가 성공하고 `memoDefaultTimes(request.changes, record)`가 `{}`. `beta2RequestData('checkhereRequests/x', {...request,status:'pending'})`가 여전히 `isLiveRequest`, `tagOf`는 그대로. `checkhereChangeKind`: 유형 변경·필요 시간 변경·인정 사유 변경 → checkhere, 증빙만·인정 아닌 사유만 → sheet-only, 그 유형이 안 쓰는 시간 → 무시. P4: 같은 학생 진행 중 요청이 항목이 달라도 hold, 내 pending 자동 요청만이면 `withdraw` 목록, 진행 중 요청이 있으면 same·none을 내지 않음(지각 → 조퇴 고침, 지각 → 출석 되돌림 두 경우). `rowCheckHereStatus` 라벨(hold, 보내는 중, pending 90초 지남, approved, applying 3분 지남, verified, rejected, withdrawn, failed). `deletionGate` 이유.
- `checkhere/tests/proposal.test.mjs`: `reasonCategory`가 병가·입원·통원 치료·수술·검진 → `병원`, `병원 면접` → `''`. 기존 35행(`reasonCategory` 기대값)과 17·56행(`requestChanges`가 빈 시간을 거절) 유지.
- `checkhere/tests/beta2-core.test.mjs`: 51~63행 기존 기대값 그대로(`rawEntry===entry`). 새: `rawEntry` 09:25 + `entry` 09:00 → 보정 모드 출석 `ok`와 `실제 입실 09:25`, 보정 없이는 그대로 `diff`. 결석 + `rawEntry` 09:02 + `entry`·`exit` null → 보정 모드 `ok`와 안내. 오늘 + `entry` null + `rawEntry` 있음 → `rawEntry`로 돌아감.
- `checkhere/tests/beta2-ui.test.mjs`:
  - 스텁 고치기: `onSnapshot`이 `(ref,cb,err)`와 `(ref,opts,cb,err)` 모두 받기(지금 31행은 `(ref,opts,cb)`만). `window.pushSnap(path, docs)` 도우미로 요청·settings 문서를 넣음(settings는 `getDoc`이 아니라 구독으로 읽으므로 pushSnap으로, 중계 신호에는 `at` 포함). `getDocFromServer` 기록(28-29행)에 `source:'live'`, `readState:'complete'`, `version`, `phoneLast4`, `teacher`, `schedule:'09:00 ~ 18:00'` 추가. 시험 날짜 2026-09-03은 지난 날이라 채우기 규칙이 적용된다.
  - 가상 기록 `a`(09:02 → 18:00, 메모 없음)는 출석으로 바꿔도 `same`이라 요청이 나가지 않는다(검토). 요청 작성 시험에는 바꿀 것이 있는 기록을 쓴다(예: `a`에 `exitMemo:'조퇴_담임:{담임}(17:00)'` 또는 `entry:'09:25:00'`), 아니면 "체크히어 이미 같음"을 기대한다.
  - 경우: (1) 메모가 이미 맞는 가상 기록 `b`를 지각으로 저장 → `b2Save` 인자에 `type:'지각'`, `inT:'09:25'`, `before:'sig-…'`, 상태 "체크히어 이미 같음", `checkhereRequests` 쓰기 없음. (2) 유형 바꿈 → `저장` → 3초 뒤 `checkhereRequests/b2_*` 쓰기 정확히 1건, reason이 `[실시간 베타] [2기 베타] 출결대조 자동 · `로 시작하고 `[기준:8자리]`로 끝남, 메모 기본 시간·초 변경 없음. (3) 3초 안 되돌리기 → 요청 쓰기 없음, 상태 "체크히어 반영 취소", 두 번째 `b2Save`가 원래 값과 `before:'new-sig'`로 나감. (4) 요청을 pending → applying → verified로 pushSnap → 칩 반영 대기 → 반영 중 → 완료. (5) 인정출석 + `개인일정` → "인정 사유를 하나로" 보류, 쓰기 없음. (6) ×는 기본으로 꺼져 있고 title에 이유, 결석 저장은 hold, 지각 행 ×는 유형 안내. (7) records push 중에도 사유 칸 입력·포커스 유지. (8) 저장 뒤 3초 안에 날짜를 바꿈 → 새 날짜로 요청 안 감, confirm 결과대로(S10). (9) `b2Save` 응답을 늦춘 상태에서 두 번 저장 → 앞 보류가 멈추고 예전 값으로 요청 안 감(S4). (10) 증빙만 저장 → 자동 요청 없음, `체크히어 맞추기` 표시(S5). (11) 기록 없는 출석 행: 사유 칸 꺼짐, `unchanged` 응답이면 요청 없음. (12) 닫힌 select에서 키보드로 유형을 바꿔도 `저장` 전에는 `b2Save` 없음. (13) 중복 행: "유형 선택 필요", 저장 없음. (14) 내 pending 자동 요청이 있는 학생을 출석으로 되돌림 → 취소 트랜잭션 뒤 계산(S6).
  - 기존 시험 유지: 가드 태그(102행), plain import 확인, CONFLICT 다시 읽기(행 안 저장에 맞게 고침), 오늘 구독 1개(236-251행), 지난 날도 이제 구독.
- `checkhere/tests/live-ui.test.mjs`: 중계 시작 → `settings/checkhereRelay`에 capabilities가 있고 학생 이름이 없음, 멈춤 → `state:'stopped'`. 이 시험 파일은 실제 오늘 날짜를 써서 2026-10-23부터 실패하므로(`docs/checkhere-handoff-review.md` 8번) 날짜 고정 수정을 먼저 하거나 함께 한다.
- 재처리 시험(`retry-store-ui.test.mjs`, `retry-requests-ui.test.mjs` 중 맞는 곳): reason에 `출결대조 자동`이 있는 실패 요청은 재처리 대상에서 빠지고 안내가 보임.
- `checkhere/tests/firestore-rules-draft.test.mjs`(새, 에뮬레이터 없음, 문자열 검사): 초안 파일의 create 허용 키에 `deleteTimes`, `validRequestChanges(…, request.resource.data.get('deleteTimes',[]))`, 승인 분기 `validAfter(…, resource.data.get('deleteTimes',[]))`, `checkhereProposalSources`는 `validChanges`. 초안 = `firestore.rules`에서 네 부분만 다름. **`firestore.rules`는 그대로**(`validChanges`가 HH:MM:SS, create 허용 키에 `deleteTimes` 없음).

### AFTER

- `approval.test.mjs`: 9행 유지. `deleteTimes` 요청 허용·정규화, `deleteTimes` 없는 `''` 거절, 지정된 쪽 값이 `''`가 아니거나 메모가 `''`가 아니면 거절, 옛 모양 요청에 `deleteTimes` 키 없음(deepEqual), `prepareApproval`이 지정된 쪽만 `after.entry=''` 유지하고 손대지 않은 빈 값은 지움, `proposalFromApproval`이 지운 쪽 `after.entry!==''` 거절, `requestMatchesRecord`가 null·''을 삭제로 보고 시간이 남으면 실패, `deleteTimes`만 다르면 `sameRequestTarget` 다름.
- `time-delete.test.mjs`(새): `assertChangeAllowed`가 deletions+requested면 `{entry:'',entryMemo:''}` 허용, deletions 없음·requested 없음·capabilities에 능력 없음·지운 쪽 메모 있음이면 거절, **삭제 아닌 요청은 오늘의 capabilities 목록으로 그대로 통과**. `validateProposal`. `applyVerified` 가짜 어댑터: 삭제 지원 → verified + `deleted:true`, 시간이 남음 → failed, 이미 빔 → 건너뜀, 쓰는 중 반대쪽 바뀜 → conflict. 연결 프로그램 부분(포트 18797~18799): 기본 연결 프로그램에 승인된 삭제 요청 `/api/apply` → claim 전 거절, 요청은 approved 그대로. pending 삭제 요청 `/api/confirm-existing` → `approveExisting` 전 거절, 요청은 pending 그대로. 능력 주입 + 가짜 어댑터 → verified, `job.results[0].deleted===true`, cloud finish가 `entry` null 기록 저장.
- `live-relay.test.mjs`: 기존 `/비우는/` 유지. `{deleteTimes:['entry']}` → `{entry:''(,entryMemo:'')}`, 태그가 그 항목을 덮음, 이미 빈 쪽은 그냥 넘어감. 기본 연결 프로그램 + pending 실시간 삭제 요청 → 문구와 함께 반려, 가짜 체크히어 그대로, 미리보기 읽기 없음. 능력 주입 → verified, 메시지에 `삭제 확인`. `relay.status()`에 capabilities·build.
- `direct-edit.test.mjs`: 삭제 거절. `request-ui.test.mjs`·`bulk-approval-ui.test.mjs`: '삭제' 표시, 일괄 제외.
- `collector.test.mjs`: 11단계 전 `deleteFields` 쓰기 → `TIME_DELETE_UNSUPPORTED`, `변경` 안 누름, 수정창 닫힘. 11단계 뒤 보고서 수정창 재현 시험.

## 10. 열린 질문 (사용자 확인 필요)

**2026-10-14 사용자 결정**
- 1번 시간 정책: **`memo-only`**(메모만 보냄). 지각·조퇴처럼 시트에 시간이 있는 유형만 그 시간을 맞추고, 학생이 찍지 않은 시간(출석 09:00/18:00, 인정 유형 09:00/18:00)은 만들지 않는다.
- 체크히어 쓰기 방식: **수정창 버튼**(지금처럼 전용 크롬에서 수정창을 열어 `변경`·`삭제`를 누름). API 직접 호출은 쓰지 않는다. 다시 읽어 확인하는 단계는 그대로.
- 삭제: 기록 번호(eventId)가 있는 칸(퇴실 COMPLETE, 관리자가 넣은 1교시 ATTEND)만(2-2절, `docs/local-session-start.md`).

1. 시간 정책 기본값: `suggest`(출석이면 늦은 입실 09:00·이른 퇴실 18:00으로 맞춤, 인정 유형은 09:00/18:00, 시간 없는 인정출석 날에도 시간이 생김) 또는 `memo-only`(메모만). 확인 전에는 `memo-only`로 시작하는 것도 방법이다.
2. 지각·조퇴에서 체크히어 입실·퇴실이 시트와 다를 때: 시트 값으로 덮기(교시 열이 바뀌고 PERIOD_MISMATCH) 또는 경고만.
3. 담임 이름이 체크히어 강의명(`record.teacher`)과 반정보 K열이 다를 때 메모에 무엇을 쓸지(지금 계획: `record.teacher`).
4. 지난 날짜도 자동으로 보낼지, 오늘만 자동이고 지난 날은 `체크히어 맞추기` 버튼으로만 할지(중계와 `cleanRequest`는 범위 안 모든 날짜를 받음).
5. 저장 방식: 유형은 `저장` 클릭·Enter로 확정(검토 반영안). 마우스로 고를 때만 바로 저장하는 방식을 원하는지.
6. 반대쪽 메모: 포털 형식 상태 메모(`지각_`·`조퇴_`·`외출_담임:`)만 비우는 안으로 괜찮은지.
7. 외출 유형에서 체크히어에 맞는 외출 구간이 없을 때: 경고와 함께 시트 구간으로 메모를 보냄(지금 계획) 또는 막기.
8. 중계 신호(작동 중 약 1분에 쓰기 1건, 담임도 읽을 수 있음, 이름 없음) 괜찮은지.
9. 요청 우선순위를 위한 진행 중 갱신 취소(5b 선택)를 할지.
10. 2기 날짜가 2026-10-22를 넘으면 규칙(사용자 게시)과 `cleanRequest` 날짜 범위를 언제 어디까지 넓힐지.
11. 마스터시트 L열 수식(분류 대신 원문 사유, 빈 시간 `(00:00)`, 빈 담임)을 맞출지. 시트 편집이라 사용자나 Cowork가 해야 한다.
12. 기존 '체크히어 요청' 패널을 '직접 요청'으로 남길지 없앨지.
13. Cowork 보고서로 정해질 것: 입실 삭제의 뜻(교시만/실제 입실까지), 삭제 방법, 지운 쪽 메모 처리, 한쪽만 삭제 가능 여부, 시험용 학생 유무.
14. 되돌리기 범위: 처음 결정문은 "3초 되돌리기 = 체크히어 요청만 취소(출결원장은 저장됨)"였다. 검토 1-4에 따라 이 문서는 **시트 값까지 되돌리게** 바꿨다(S9). 이대로 괜찮은지.
15. 인정 유형 사유가 분류 하나로 정해지지 않을 때(예: `개인일정`, `병원 면접`): 자동 전송을 막음(지금 계획, `hold`) 또는 원문 사유로 보냄(L열 방식, 체크히어 병원 횟수 집계가 깨짐).
16. 중계가 기준 지문 불일치로 반려했을 때: `다시 보내기` 버튼만(지금 계획, 체크히어를 직접 고친 값을 지킴) 또는 새 기록으로 자동 재전송(시트 우선).
17. 시간 삭제를 허용할 날짜: 오늘만, 최근 며칠, 또는 규칙 범위 전체(2026-07-27~2026-10-22).
18. 연결 프로그램이 `time-delete-v1`을 모를 때 중계가 삭제 요청을 바로 반려(지금 계획) 또는 업데이트될 때까지 대기.
