# 체크히어 핸드오프 검토 결과 — 2026-10-13 (검토 대상 커밋 b42d8b5, 줄 번호는 HEAD 1890f91에서 확인)

검토 대상은 커밋 `b42d8b5`(빠른·일괄 수집, 실시간 베타 중계, 진단 도구)다. 클라우드 세션에서 다섯 관점(bridge 연결 프로그램, compat 기존 화면과의 호환, ui 화면, live 실시간 중계, realtime 실시간성·사용량)으로 35건을 찾았고, 각 건마다 검증자 2명이 따로 반박을 시도했다.

- 판정: 검증자 둘 다 반박 못 함 → **확인됨**, 한 명만 반박 → **이견**, 둘 다 반박 → **기각**.
- id는 원본 기록에서 쓰던 이름(`관점#번호`)이다. **id마다 이 문서에 한 번만** 나온다: 확인됨·이견은 '요약 표', 기각은 맨 아래 '기각된 항목' 표. 여러 관점에서 같은 문제를 찾은 건 한 행으로 합치고 id를 모두 적었다(예: 요약 표 2번). 기각된 발견이 확인된 항목과 같은 동작을 다룬 경우에도 합치지 않고 기각 표에 두고 번호로만 서로 가리켰다.
- 확인됨·이견 항목은 **현재 파일을 다시 열어** 문제 줄이 그대로인지 보고 줄 번호를 적었다. `bf55d12` → `1890f91` 사이에는 `.vercelignore`와 `docs/local-session-start.md`만 바뀌어 코드 줄 번호는 두 커밋에서 같다. 고치기 시작하면 줄이 밀리므로 함수 이름과 인용한 코드 조각으로 찾는다.
- 코드는 아직 아무것도 고치지 않았다. 이 문서는 수집 PC(Windows, `checkhere/server.mjs`가 도는 PC)의 로컬 Claude Code 세션이 이어서 고치도록 클라우드 기록을 옮긴 것이다. 원본 기록(작업 journal)은 클라우드 세션 안에만 있어 PC에서는 볼 수 없다. 이 문서보다 `docs/local-session-start.md`를 먼저 읽는다.

결과: 합친 뒤 **확인됨 18건, 이견 3건, 기각 11건**(합치기 전 id 기준 확인됨 21, 이견 3, 기각 11, 모두 35).

## 용어 (처음 읽는 세션용)

- **연결 프로그램(bridge)**: 수집 PC에서 도는 Node 서버 `checkhere/server.mjs`(`http://127.0.0.1:8765`, 이 PC에서만 접속됨). `체크히어 시작.cmd` → `checkhere/Start.ps1`로 켠다. **전용 크롬**(Playwright, 프로필 `checkhere/data/chrome-profile`) 화면 하나로 체크히어를 읽고 쓰며(`checkhere/collector.mjs`), 수집 결과를 `checkhere/data/attendance.sqlite`에 쌓는다. Firebase 자격 증명은 없고, 승인 반영 때만 화면이 넘겨준 hint.kpc ID 토큰으로 Firestore에 쓴다.
- **연결 키**: 연결 프로그램이 켤 때마다 새로 만드는 키(`server.mjs:22`). 화면은 `x-hint-key` 헤더로 보낸다. 키는 이 PC의 로컬 화면에서만 보인다. 다시 켜면 바뀐다.
- **build 값**: `server.mjs:70`과 `Start.ps1:11`의 `'20261013.4'`. 둘이 다르면 `Start.ps1`이 실행 중인 연결 프로그램을 끄고 다시 켠다.
- **작업 잠금(busy)**: 연결 프로그램의 변수 `busy`(`server.mjs:22`). 전용 크롬 화면이 하나뿐이라 한 번에 한 작업만 하도록, 값이 있으면 다른 요청에 409를 돌려준다. 값은 작업 id, `'preview'`, 또는 승인 요청 id.
- **작업(job)**: `kind`가 `sync`(한 반 수집, `/api/sync`), `batch`(여러 반×기간 **일괄 수집**, `/api/sync-batch`), `probe`(진단), `apply`(승인된 변경 반영). `/api/state`는 최근 20개만 돌려준다(`server.mjs:78`).
- **빠른 수집 / 정밀 수집**: `mode:'incremental'` / `'full'`. 빠른 수집은 체크히어 출결상세 화면이 받아 오는 데이터(**화면 데이터**, 주소가 `/isRealTime/true`로 끝나는 응답)로 그날 반 전체를 읽고, 학생 1~2명(**표본**)만 수정창을 열어 같은지 대조한다. 표본이 다르거나 화면 데이터를 못 받으면 그날은 수정창으로 읽는다(**대체 읽기**). 대체 읽기에서도 표에 보이는 행이 지난 완전 수집과 같은 학생은 건너뛴다. 정밀 수집은 모든 학생의 수정창을 연다.
- **version / tableSignature**: 기록 내용의 해시(시간·메모·외출 구간 포함, `checkhere/identity.mjs`) / 표에 보이는 행의 글자(메모 없음, `collector.mjs:134`).
- **checkhereCurrent**: Firestore `classes/{반}/checkhereCurrent/{날짜}` 문서. 반·날짜마다 하나이고 그날 기록 배열 전체가 들어 있다. 출결대조 화면들이 이것을 읽거나 구독한다. 쓰기는 관리자만, 날짜 2026-07-27~10-22만 된다(`firestore.rules:92-100`).
- **checkhereRequests와 요청 상태**: 체크히어 수정 요청 문서. `pending`(반영 대기) → `approved`(승인) → `applying`(연결 프로그램이 **claim**, 즉 '반영 중'으로 바꾼 뒤) → `verified`/`partial`/`failed`/`unknown`/`conflict`. 또는 `rejected`(반려), `withdrawn`(작성자 취소). **ACTIVE** = pending·approved·applying(`checkhere-live-core.mjs:13`). 승인·반려·claim은 지정 관리자 hint.kpc(`APPROVER`, `checkhere/approval-core.mjs:3`)만 한다.
- **승인 경로(검증된 쓰기 경로)**: 요청 → 승인 → `/api/apply`(연결 프로그램이 수정창에 입력하고 `변경`) → 다시 열어 확인(`checkhere/writeback.mjs` `applyVerified`) → 요청 결과와 `checkhereCurrent` 저장. **confirm-existing**(`/api/confirm-existing`)은 체크히어 값이 이미 요청값과 같을 때 쓰지 않고 확인만 하는 경로다.
- **실시간 베타와 중계(relay)**: `/checkhere-live.html`. 관리자는 반·날짜 표를 보고 수정 요청을 낸다. 수집 PC에서 hint.kpc로 연 같은 페이지의 '수집 PC 중계'(**중계**, `checkhere-live-relay.mjs`)가 이 요청을 **사람 확인 없이** 자동 승인·반영하고, 평일 08:50~18:40에는 10분마다 오늘 1~17반을 빠른 수집해 바뀐 기록만 `checkhereCurrent`에 저장한다. 그 탭이 열려 있고, 연결 키를 붙여 넣고 '중계 시작'을 눌렀을 때만 돈다. 오늘 날짜만 다룬다.
- **실시간 요청 표시와 기준 지문**: 실시간 화면이 만든 요청의 근거(`reason`)는 `[실시간 베타]`로 시작하고 `[기준:xxxxxxxx]`로 끝난다. xxxxxxxx는 수정창을 열 때 본 값의 **기준 지문**(함수 `baseTag`, `checkhere-live-core.mjs:23`, FNV-1a 해시)이다. 중계는 반영 직전 체크히어 값으로 지문을 다시 계산해 다르면 반려한다(`checkhere-live-relay.mjs:93`). `isLiveRequest`(`checkhere-live-core.mjs:25`)는 이 표시만 보고 실시간 요청을 가린다.
- **운영포털(1기)**: `index.html`의 관리자 화면. '체크히어' 탭이 `checkhere-portal.mjs` → `checkhere-ui.mjs`(수집·검수)와 `checkhere-requests.mjs`(반영 요청·승인)를 띄운다. 같은 `checkhere-ui.mjs`를 연결 프로그램의 로컬 화면(`checkhere.html`)도 쓴다(이때는 플랫폼 저장 기능이 없다).
- **/beta2(2기 베타)**: 같은 `index.html`을 `/beta2` 주소로 열면 Firestore SDK가 `beta2-firestore-guard.mjs`로 바뀌어 체크히어 수정 요청 외의 쓰기를 막는다(`beta2-guard-core.mjs:2`). '체크히어 수집' 탭은 보기 전용 안내만 붙어 있다.
- **재처리 요청(`retry_`)·제안 요청(`proposal_`)**: 운영포털 '실패 건 다시 처리'가 만드는 `retry_<해시>` id 요청(`checkhere-retry-core.mjs:8`), 출결대조 제안이 만드는 `proposal_<UUID>` id 요청. 실시간 화면이 만드는 요청 id는 UUID다.
- **핸드오프**: 커밋 `b42d8b5`로 들어온 체크히어 변경 묶음.

## 먼저 지킬 것

- `checkhere/data/`(SQLite, 크롬 프로필, `probe/*.json` 진단 결과)는 **절대 커밋하지 않는다**(`.gitignore:1`). 진단 결과에는 실제 학생 정보가 들어 있다.
- `firestore.rules`: 이 문서의 어떤 수정도 규칙 변경이 필요 없다. 규칙 변경이 필요해지면 별도 초안 파일과 게시 안내를 만들고, "게시했다"고 쓰지 않는다. 게시는 사용자가 Firebase 콘솔에서 직접 한다.
- 실제 체크히어 기록은 **승인 → `/api/apply` → 다시 읽어 확인** 경로로만 바꾼다. 시험·디버깅 중에 수정창의 `변경`을 직접 누르거나 `collector.write()`를 직접 부르지 않는다. 중계가 켜져 있을 때 실시간 화면에서 시험 삼아 실제 학생의 수정 요청을 내지 않는다(중계가 사람 확인 없이 바로 반영한다).
- Firestore 규칙과 코드의 날짜 범위는 **2026-10-22까지**다(`firestore.rules:32`, `firestore.rules:97`, `checkhere/approval-core.mjs:10`, `attendance-beta-core.mjs:85`, `checkhere-ui.mjs:144`). 이 문서의 수정은 이 범위를 넓히지 않는다. 2기를 위해 넓히는 일은 사용자 확인 뒤에 한다.
- 커밋·push(=Vercel 배포)는 사용자 확인 뒤에만 한다.
- 로그·보고·대화에 학생 이름과 전화번호를 그대로 붙이지 않는다(예: `김○○`, 끝 4자리 `****`).

## 요약 표

★ = 연결 프로그램 파일(고치면 빌드를 올려야 함, 아래 절차 참고).

**2026-10-14 로컬 세션**: 1·3·4·6번을 이 문서의 '고칠 방법'대로 고쳤다(build `20261014.1`, 시험 `batch-sync.test.mjs`·`live-relay.test.mjs`에 추가). 3번의 2항(제출 때 겹침 검사)은 `checkhere-live.mjs:127`이 이미 같은 학생의 진행 중 요청을 모두 막고 있어 `sameStudent`만 고쳤다. 운영 중인 연결 프로그램에는 아직 반영하지 않았다.

| # | id | 한 줄 요약 | 판정 | 우선순위 | 파일 |
|---|---|---|---|---|---|
| 1 | bridge#1 | 작업 잠금(busy)을 await 뒤에 잡고 주인 확인 없이 풀어, 두 작업이 전용 크롬 한 화면을 동시에 움직일 수 있음 | 확인됨 | 지금 | `checkhere/server.mjs` ★ |
| 2 | compat#1, ui#1 | /beta2 '체크히어 수집' 탭이 끝난 날짜를 자동 저장하다 가드에 막히고 3초마다 끝없이 다시 시도 | 확인됨 | 지금 | `checkhere-ui.mjs`, `checkhere-portal.mjs` |
| 3 | live#2 | 실시간 수정 화면과 중계가 '같은 학생·항목에 진행 중인 다른 요청' 검사를 건너뜀 | 확인됨 | 지금 | `checkhere-live-core.mjs`, `checkhere-live.mjs`, `checkhere-live-relay.mjs` |
| 4 | live#1 | 중계가 운영포털 '실패 건 다시 처리'가 만든 `retry_` 요청까지 가져가 반려, 재처리가 끊김 | 확인됨 | 지금 | `checkhere-live-relay.mjs` |
| 5 | bridge#5, realtime#2 | 끝난 일괄 수집이 최근 작업 20개 밖으로 밀리면 화면을 다시 열어도 DB 저장이 이어지지 않음 | 확인됨 | 지금 | `checkhere/server.mjs` ★, `checkhere-ui.mjs` |
| 6 | bridge#6 | `collect()`가 await 뒤에 중단 표시를 지워 '수집 중단'이 묻힐 수 있음 | 확인됨 | 지금(1번과 함께) | `checkhere/collector.mjs` ★, `checkhere/server.mjs` ★ |
| 7 | compat#2, ui#2 | '여러 반 선택…'에서 '플랫폼 저장본 조회'가 반 번호 `multi`를 읽어 0건으로 보임 | 확인됨 | 지금 | `checkhere-ui.mjs` |
| 8 | compat#3 | `live-ui` 시험이 실제 오늘 날짜를 써서 2026-10-23부터 실패 | 확인됨 | 지금(10-22 전) | `checkhere/tests/live-ui.test.mjs` |
| 9 | bridge#3 | 화면 데이터에서 관리자 메모 항목이 빠지면 저장된 메모가 경고 없이 빈칸으로 덮임 | 확인됨 | 2기 전 | `checkhere/day-data.mjs` ★, `checkhere/collector.mjs` ★, `checkhere/server.mjs` ★ |
| 10 | bridge#2 | 기억한 반 강의 주소를 버리지 않아, 강의가 바뀌면 새 날짜가 모두 '강의 없음'이 됨 | 이견 | 2기 전 | `checkhere/collector.mjs` ★, `checkhere/server.mjs` ★, `docs/checkhere-batch-collect.md` |
| 11 | realtime#5 | 빠른 수집이 바뀐 게 없어도 매번 학생 1~2명의 수정창을 엶 | 확인됨 | 2기 전 | `checkhere/collector.mjs` ★, `checkhere/server.mjs` ★ |
| 12 | ui#3 | 저장 대기열이 길면 새로고침·연결·승인이 대기열이 빌 때까지 멈추고, 그 사이 탭을 닫으면 저장 안 된 날이 저장된 것으로 남음 | 확인됨 | 2기 전 | `checkhere-ui.mjs` |
| 13 | live#4 | confirm-existing이 '반영 대기'가 아닌 상태를 돌려주면 중계가 없는 작업을 10분 기다림 | 확인됨 | 2기 전 | `checkhere-live-relay.mjs` |
| 14 | ui#4 | 일괄 수집 도중 저장 실패가 나면 '수집 종료'라고 표시 | 확인됨 | 여유 있을 때 | `checkhere-ui.mjs` |
| 15 | ui#5 | '최근 작업 결과'에서 일괄 수집·진단 작업이 '반영'(체크히어에 씀)으로 표시 | 확인됨 | 여유 있을 때 | `checkhere-ui.mjs` |
| 16 | ui#6 | 빠른/정밀 수집 설명이 '여러 반 선택' 상자 안에 있어 평소에는 안 보임 | 확인됨 | 여유 있을 때 | `checkhere-ui.mjs` |
| 17 | ui#7 | 빠른 수집 설명이 메모를 다 읽는 것처럼 약속하지만, 대체 읽기 날에는 행이 같은 학생을 건너뜀 | 확인됨 | 여유 있을 때 | `checkhere-ui.mjs`, `docs/checkhere-batch-collect.md` |
| 18 | realtime#8 | 1기 출결대조가 체크히어 갱신 때마다 `users` 전체를 다시 읽음 | 확인됨 | 여유 있을 때 | `attendance-teacher.mjs` |
| 19 | realtime#7 | 1기 출결대조가 반·날짜를 열 때 같은 `checkhereCurrent` 문서를 두 번 읽음 | 확인됨 | 여유 있을 때 | `attendance-overview.js`, `attendance-beta.mjs`, `checkhere-snapshots.mjs` |
| 20 | live#5 | 승인된 실시간 요청이 claim 전에 계속 실패하면 60초마다 끝없이 다시 시도 | 이견 | 여유 있을 때 | `checkhere-live-relay.mjs`, `docs/checkhere-live-beta.md` |
| 21 | realtime#3 | 연결 프로그램이 다시 켜지면 키가 바뀌어 중계가 멈추는데 상태는 '작동 중'으로 보임 | 이견 | 여유 있을 때 | `checkhere-live-relay.mjs`, `checkhere-live.mjs` |

기각 11건은 맨 아래 '기각된 항목' 표에 따로 적었다. 그중 셋은 위 항목과 같은 동작을 다른 각도에서 본 것이라 그 표에 해당 번호(2번, 17번, 21번)를 적어 두었다.

## 연결 프로그램 파일을 고칠 때 (빌드 올리기)

1·5·6·9·10·11번은 연결 프로그램 파일(`checkhere/server.mjs`, `checkhere/collector.mjs`, `checkhere/day-data.mjs`, `checkhere/Start.ps1`, 그리고 server.mjs가 불러오는 다른 `checkhere/*.mjs`)을 고친다. 실행 중인 옛 연결 프로그램은 파일을 바꿔도 그대로 돌기 때문에 빌드 값을 올려 재시작시켜야 한다.

1. `checkhere/server.mjs:70`의 `build:'20261013.4'`와 `checkhere/Start.ps1:11`의 `'20261013.4'`를 **같은 새 값**(예: `20261014.1`)으로 함께 바꾼다. 둘이 다르면 `체크히어 시작.cmd`를 실행할 때마다 연결 프로그램을 죽이고 다시 띄운다.
2. 여러 항목을 고치면 빌드는 한 번만 올린다(예: 1·5·6번을 한 묶음, 9·11번을 다음 묶음).
3. `Start.ps1:13`은 작업이 진행 중이면 재시작을 거부한다. 수집·반영이 없을 때 실행한다.
4. 재시작하면 연결 키가 바뀐다(`server.mjs:22`). **중계 탭에서 '중계 멈춤' → 새 키 붙여넣기 → '중계 시작'**, 운영포털 체크히어 탭에서도 키를 다시 넣는다(21번 참고).
5. `checkhere-ui.mjs`는 연결 프로그램이 요청마다 파일을 새로 읽어 보내므로(`server.mjs:213-215`) 로컬 화면만 볼 때는 재시작이 필요 없다. 운영포털 쪽은 배포(push·병합, 사용자 확인 뒤) 후 반영되고, 관례대로 `checkhere-portal.mjs:6`의 `?v=` 값을 올린다. `checkhere-portal.mjs` 자체를 고치면(2번) `index.html:220`의 `?v=`도 올린다. `checkhere-live*.mjs` 변경은 배포 후 중계 탭을 새로 고쳐야 반영되는데, 새로 고치면 중계가 꺼지므로 키를 붙여 넣고 '중계 시작'을 다시 누른다.

## 수집 PC 로컬 세션에서 시험할 때

- 먼저 `checkhere` 폴더에서 `node --test tests/*.test.mjs`. 가짜 체크히어·가짜 Firestore·가상 학생만 쓴다. 쓰기 경로(반영, 삭제)는 이 시험으로만 확인한다(`live-relay.test.mjs`, `live-ui.test.mjs`). 코드를 바꾸기 전에 이 PC의 기준선(통과·실패 목록)을 먼저 적어 둔다(`docs/local-session-start.md` 4절).
- (2026-10-14에 고침) `live-ui.test.mjs`는 이제 18943 포트에서 연결 프로그램을 열고 화면에 `window.HINT_TEST_BRIDGE`로 알려 준다. 8765로 가는 요청은 시험이 막는다. 그래서 실제 연결 프로그램이 켜져 있어도 돌릴 수 있다.
- 새 시험 6개(`batch-sync`, `batch-ui`, `incremental-sync`, `live-ui`, `page-data`, `probe`)는 설치된 Chrome(`channel:'chrome'`)이 아니라 Playwright 자체 Chromium을 띄운다. 이 PC에 그 브라우저가 없으면 시작하자마자 실패하는데 코드 문제가 아니다. `checkhere` 폴더에서 `npx playwright install chromium`으로 받으면 된다(저장소는 바뀌지 않음). 나머지 화면 시험은 설치된 Chrome을 쓴다.
- 실제 연결 프로그램으로 해도 되는 것: 읽기 전용 수집(`/api/sync`, `/api/sync-batch`), `/api/state`, 409 응답, 수집 중단. 이것들은 체크히어를 읽고 `checkhere/data/attendance.sqlite`에만 쓴다. 단 운영포털 1기 체크히어 탭이 열려 있으면 끝난 날짜가 `checkhereCurrent`에 자동 저장되고, 중계가 켜져 있으면 오늘 바뀐 기록도 저장된다(정상 경로지만 실제 Firestore 쓰기임을 알고 할 것).
- 진단 도구: `체크히어 진단_자동실행.cmd`(`verify-fast.ps1`)는 2반 9/1~9/4를 실제로 정밀 → 빠른 일괄 수집한다(체크히어 읽기 전용, SQLite에 기록 추가, 운영포털 체크히어 탭이 열려 있으면 Firestore에도 저장). `체크히어 데이터진단.cmd`는 연결 프로그램과 같은 크롬 프로필을 쓰므로 연결 프로그램의 전용 크롬이 열려 있으면 실행을 거부한다. 진단 결과 `checkhere/data/probe/*.json`에는 실제 이름이 들어 있다.
- 실제 체크히어 쓰기는 위 '먼저 지킬 것'의 검증된 승인 경로로만. 잠금 경쟁(1번)을 실제 체크히어에서 쓰기로 재현하려 하지 않는다. 가짜 adapter 시험으로 확인한다.
- `checkhere/bridge.log`, `bridge-error.log`(`.gitignore`의 `checkhere/*.log`), `/api/state` 응답에는 실제 이름이 들어 있다. 붙여 넣을 때 이름·전화번호를 가린다.

## 시간 삭제 기능을 넣기 전에

계획 중인 시간 삭제(`docs/beta2-instant-edit-plan.md`, 체크히어 쪽 확인 요청은 `docs/cowork/2026-10-13-checkhere-delete-and-beta2.md` 1번)는 지금 막혀 있는 곳(`checkhere-live-core.mjs:39`, `checkhere-ui.mjs:121`, `checkhere/collector.mjs:226`)을 풀어 `/api/apply` → `write()`로 지우게 된다. 그러면 아래 항목의 위험이 커진다.

- **1번**(잠금 경쟁): 반영 중인 수정창을 다른 흐름이 바꾸면 다른 학생의 시간이 지워질 수 있다. 지운 값은 되돌리기 어렵다. 삭제보다 먼저 고친다.
- **3번**(중복 요청 검사): 실시간 화면에서 지운 시간을 대기 중이던 옛 요청이 다시 넣을 수 있다(반대도 같다).
- **4번**(`retry_` 가로채기): 일부만 지워진 요청을 다시 처리할 때 같은 문제가 생긴다.
- **20번**(승인된 요청 반복): 승인된 삭제 뒤 체크히어 값이 바뀌면 같은 반복이 생긴다. 읽기만이라 위험은 낮다.
- **아래 '따로 적힌 관찰' 1번**(중계 자동 승인): 실시간 화면에서 삭제 요청을 내면 중계가 사람의 변경 전후 확인 없이 지운다. 삭제를 실시간 경로에 붙일지는 사용자에게 먼저 확인한다.

---

## 자세한 항목 (우선순위 순)

각 항목의 id는 요약 표의 같은 번호 행에 있다. '판정'은 검증자들이 인정하면서 고친 사실관계, '고칠 방법'은 검증자 안을 합친 것이다.

### 1. 작업 잠금 경쟁 · 확인됨 · 지금 · ★

**판정**: 검증자 2명 모두 인정했다. 과장된 부분도 있다. 중계 탭 하나만으로는 순서대로 처리해서 경쟁이 안 생기고(`checkhere-live-relay.mjs` `step()`), 로그인된 상태면 틈은 수 ms다. 하지만 중계 탭, 운영포털 체크히어 탭, 요청 화면이 같은 키로 한 연결 프로그램을 쓰므로 실제로 생길 수 있다. `/api/sync`의 이 모양은 핸드오프 전부터 있었고, 핸드오프가 sync-batch에 그대로 복사했다.

**현재 코드**
- `checkhere/server.mjs:88` `if(busy)` 확인 → `:91` `await adapter.requireLogin();` 다음에야 `busy=j.id`. sync-batch도 `:103` 확인 → `:108` await → `:109` `busy=j.id`. 둘 다 `connecting`(`:84-85`)을 보지 않는다.
- 다른 엔드포인트는 확인 직후 바로 잠근다: `:148`(probe), `:164`(preview), `:176`(apply).
- 잠금을 풀 때 주인을 확인하지 않는다: `:98`, `:139`, `:158`, `:169`, `:182`, `:184`, `:194`, `:199` 모두 `busy=null`.
- `checkhere/collector.mjs:33-37` `requireLogin`은 최대 15초 기다린다. 두 흐름이 함께 쓰는 상태: `this.day`(`:118`), `this.dayData`(`:112`, `:120`), `this.saving`(`:228`), 확인창 자동 수락(`:27`).

**문제**: 잠금 확인과 잠금 설정 사이에 await가 있어 그 틈에 다른 요청이 잠금을 잡을 수 있다. 그리고 누가 먼저 끝나든 잠금을 풀어 버려 세 번째 작업까지 들어온다. 그러면 두 작업이 전용 크롬 한 화면을 같이 움직인다.

**실제로 생기는 경우**: 중계의 10분 자동 갱신 `/api/sync`가 `requireLogin`을 기다리는 사이(로그인 직후, 화면 로딩 중)에 운영포털에서 승인·반영이나 미리보기가 들어온다. 그러면 (a) 수집 쪽이 다른 날 화면의 표를 읽어 이 반·날짜 기록으로 저장하고 `checkhereCurrent`까지 올릴 수 있다. (b) 수집이 반영 쪽 수정창을 `취소`로 닫고 다른 학생 창을 연 뒤 반영이 `변경`을 누르면(`collector.mjs:160` 이름 확인 → `:227` 입력 → `:229` 변경), 승인값이 다른 학생에게 들어간다. `checkhere/writeback.mjs:35`는 요청한 학생만 다시 읽어서 이것을 못 잡는다.

**고칠 방법** (검증자 두 안을 합친 것)
1. `/api/sync`(`:88`)와 `/api/sync-batch`(`:103`) 첫 확인을 `if(busy||connecting)return send(res,409,…)`로.
2. 입력 검사(동기)는 그대로 둔다. 그 뒤 await 전에 임시 값으로 잠근다.
   `const claim='start:'+randomUUID();busy=claim;try{await adapter.requireLogin();}catch(e){if(busy===claim)busy=null;throw e;}`
   그다음 작업을 만들고 `adapter.cancelled=false;saveJob(j);busy=j.id;`(6번의 중단 표시 초기화도 여기서 한다). 작업은 requireLogin 뒤에 만들어야 로그아웃 상태에서 '실패' 작업 행이 쌓이지 않는다.
3. 자기 잠금만 푼다.
   - sync·batch·probe의 finally(`:98`, `:139`, `:158`): `if(busy===j.id)busy=null`
   - preview(`:164`, `:169`): `const tok='preview:'+randomUUID();busy=tok;…finally{if(busy===tok)busy=null}`
   - apply/confirm-existing(`:182`, `:184`, `:194`, `:199`): `if(busy===approvalId)busy=null`
4. `/api/cancel`(`:82`)은 그대로 둔다. 임시 값 동안에는 `jobs.get(busy)`가 없어서 아무것도 하지 않는다. 화면(`checkhere-ui.mjs:41` `!!state.busy`)과 중계(`checkhere-live-relay.mjs:53` `before.busy`)는 작업이 아닌 busy 값도 '진행 중'으로 본다.
5. (선택) collector 안에서 화면을 움직이는 메서드(collect, read, openDay, write, readOpened, lectureDates)를 promise 사슬 하나로 묶으면, 앞으로 새 엔드포인트가 잠금을 빠뜨려도 한 화면에 두 흐름이 겹치지 않는다.

**추가할 시험**: `checkhere/tests/batch-sync.test.mjs`에 추가하면 그 파일의 `fakeCollector`·`bridge(c,port)` 도우미를 그대로 쓸 수 있다(다른 시험이 안 쓰는 포트, 예: 18815). `c.requireLogin`을 지연 promise를 기다리게 바꾸고, `/api/sync`를 보낸다(응답은 requireLogin이 끝나야 오므로 await하지 않는다). 풀기 전에 두 번째 `/api/sync-batch`(또는 `/api/preview-request`)를 보낸다 → 두 번째는 409여야 한다. 지금 코드에서는 두 번째도 통과해서 시험이 실패한다. 이어서 먼저 끝난 쪽이 다른 작업의 busy를 지우지 않는지, 첫 작업이 끝나야 `/api/state`의 `busy`가 null이 되는지 확인한다.

**우선순위**: 지금. 시간 삭제 기능보다 반드시 먼저 한다.

### 2. /beta2 자동 저장 무한 재시도 · 확인됨 · 지금

**판정**: 4명 모두 인정했다. 과장된 부분: "예전 화면은 스스로 저장하지 않았다"는 틀렸다. 끝난 sync 작업은 예전부터 한 번씩 자동 저장했다(`checkhere-ui.mjs:101`). 새로 생긴 것은 일괄 수집의 날짜별 자동 저장과 '실패하면 3초마다 다시'다. 1기 예시인 '10-22 이후 날짜'는 `collectionDates`(`attendance-beta-core.mjs:85`)가 막아서 생기지 않는다. 같은 재시도 고리를 '10-22 이후 날짜' 시나리오로 본 다른 발견은 그 때문에 기각됐지만(기각 표 '계속 실패하는 저장(10-22 이후 날짜)을 간격 없이 재시도'), 그 검증자 둘도 /beta2에서 도는 고리는 진짜라고 적었다. 그 남은 부분이 이 항목이다.

**현재 코드**
- `index.html:194` BETA2_GROUPS에 '체크히어 수집' 탭, `:195` BETA2_VIEW_ONLY는 안내 띠만 붙인다, `:220` checkhereAdmin이 `checkhere-portal.mjs`를 띄운다.
- `checkhere-portal.mjs:42`가 /beta2에서도 `save:saveSnapshots`를 넘긴다. 저장은 `:23-28` runTransaction → `tx.set`.
- `beta2-firestore-guard.mjs:16`이 `checkhereCurrent` 쓰기를 막는다(`beta2-guard-core.mjs:2` 허용 목록에 없음, `:6` BETA2_READ_ONLY).
- `checkhere-current-core.mjs:34-40`: 한 번 시도에 읽기 약 3~4건(서버 읽기, 옛 저장본 조회, tx.get, 확인 읽기). `:44`가 오류를 다시 감싸서 `code`가 사라진다. 그래서 `e.code`로 가드 오류를 구별할 수 없다.
- `checkhere-ui.mjs:86-94`: 새로고침 때마다 저장 안 된 날을 큐에 넣는다. `:92` 실패하면 `done.delete(k);markSaved(batch.id,done)` → 다음 폴링에 다시 넣는다. `:106` 일괄 수집 중에는 3초마다 폴링. 또 `:92`가 그 새로고침 때의 오래된 `done` 집합을 localStorage에 덮어써서 나중 폴링이 넣은 키까지 지운다(같은 날이 두 번 큐에 들어감).
- `cloudSaves>0` 동안 `:41` 버튼이 잠기고, `:172` `canLeave`가 false라 `index.html:197`에서 다른 탭으로 못 간다.

**문제**: /beta2는 `checkhereCurrent`에 쓸 수 없는데 화면이 끝난 날마다 저장을 시도하고, 실패한 날을 3초마다 다시 넣는다. 일괄 수집이 끝날 때까지 읽기를 계속 쓰고 관리자는 탭을 옮길 수 없다.

**실제로 생기는 경우**: 관리자가 /beta2 → 출결 → 체크히어 수집에서 여러 날을 수집한다(연결 프로그램 호출은 로컬이라 허용됨). 실패한 날 하나마다 3초에 읽기 3~4건. 1기 포털에서도 '더 최신 수집본', '동일 수집 시각', 크기 한도처럼 계속되는 오류면 같은 고리가 돈다.

**고칠 방법**
1. /beta2에서는 저장 함수를 넘기지 않는다: `checkhere-portal.mjs:42`를 `save:window.HINT_BETA2===true?undefined:saveSnapshots`로. 이것만으로 `checkhere-ui.mjs:85` 일괄 자동 저장, `:101` 작업별 자동 저장, `:166` 수동 저장이 모두 꺼진다.
   - `checkhere-ui.mjs:21`은 `ctx.load`만 있으면 '플랫폼에 저장' 버튼도 그리므로, 이 버튼은 `ctx.save`가 있을 때만 그리게 나눈다. 지금의 `${ctx.load?'<button id="loadCloud">플랫폼 저장본 조회</button><button id="saveCloud">플랫폼에 저장</button>':''}`를 `${ctx.load?'<button id="loadCloud">플랫폼 저장본 조회</button>':''}${ctx.load&&ctx.save?'<button id="saveCloud">플랫폼에 저장</button>':''}`로 바꾼다(`:41`·`:43`은 `$('#saveCloud')`가 없어도 안전하게 짜여 있다). 같은 줄의 `</section>` 바로 뒤에 `${ctx.load&&!ctx.save?'<p class="muted">2기 베타에서는 플랫폼에 저장하지 않습니다 · 저장은 1기 운영포털에서</p>':''}`를 넣는다(`.toolbar`는 flex라 안에 넣지 않는다). `:44`의 '다시 열면 이어서 저장' 문구는 이미 `ctx.save`일 때만 나온다.
2. 1기 쪽 3초 재시도 끊기(`:86-94`).
   - 화면이 열려 있는 동안만 쓰는 `const batchQueued=new Set();`을 `:14` 옆에 둔다. `:89`를 `const k=…;if(done.has(k)||batchQueued.has(k))continue;batchQueued.add(k);`로 바꾼다(기존 `done.add(k)`는 없앤다). `:94`의 즉시 `markSaved(batch.id,done);`도 없앤다.
   - `:92`를 아래처럼 바꾼다. 저장이 성공했을 때만 localStorage를 **새로 읽어** 그 날을 더한다. 실패하면 `batchSaveErrors`에만 적고 최신 작업 상태로 `showBatch`를 부른다(14번). localStorage는 건드리지 않는다.
     ```js
     const dk=`${r.classId}|${r.date}`;
     if(day.length)saveCloud(day,{id:batch.id,status:r.status}).then(()=>{batchSaveErrors.delete(dk);const cur=savedDays(batch.id);cur.add(k);markSaved(batch.id,cur);},e=>{batchSaveErrors.set(dk,e.message);showBatch(state.jobs.find(x=>x.id===batch.id)||state.batch||batch);});
     ```
     (`state.batch`는 5번을 넣은 뒤에만 생긴다. 없으면 그냥 넘어간다.) 저장은 `cloudTail`로 하나씩 돌아서 처리기끼리 겹치지 않는다. 12번의 '탭을 닫으면 저장 안 된 날이 저장된 것으로 남는' 문제도 함께 풀린다.
   - 결과: 한 날짜는 화면을 연 동안 자동으로 한 번만 시도하고, 화면을 다시 열면 한 번 더 시도한다. 그 이상은 '플랫폼에 저장' 버튼으로 한다.
   - (선택) 자동 재시도를 1~2번, 30초 → 2분 간격으로.

**추가할 시험**: `batch-ui.test.mjs`에 save가 항상 실패하는 경우를 추가한다. 연결 프로그램이 busy인 채 여러 번 폴링해도 날짜별 save 호출이 한 번인지, 대기열이 비면 `canLeave`가 true인지 본다. `beta2-ui.test.mjs`에는 /beta2 체크히어 탭에 '플랫폼에 저장' 버튼이 없고 `checkhereCurrent` 쓰기 시도가 없는지 추가한다.

**우선순위**: 지금. 고칠 양이 작고 /beta2를 지금 쓰고 있다. 연결 프로그램 파일이 아니다.

### 3. 실시간 수정의 중복 요청 검사 누락 · 확인됨 · 지금

**판정**: 2명 인정. 과장된 부분: 출결대조 제안은 전화 끝 4자리를 함께 보내므로(`checkhere-proposals.mjs:94`) 대개 맞는다. 시트 이름이 체크히어 이름과 다를 때만 어긋난다. 주된 경로는 운영포털 수정 요청 양식이다. 옛 요청이 '반영 대기'면 덮어쓰기에 사람의 승인이 필요하지만, 옛 요청이 이미 '승인'된 상태면 '승인된 변경 반영'이 확인 창 없이 덮어쓴다(`checkhere/writeback.mjs:27`의 버전 확인은 요청이 있으면 건너뜀). 이쪽이 더 위험하다.

**현재 코드**
- `checkhere-live-core.mjs:52` `sameStudent`가 전화 끝 4자리 완전 일치를 요구한다. `:53` `requestsFor`가 이것을 쓴다.
- `checkhere-live.mjs:94`(active), `:99`(수정 버튼 잠금), `:127`(제출 전 검사)이 모두 `requestsFor`를 쓴다.
- `checkhere-proposal-core.mjs:50` `requestsOverlap`는 빈 끝 4자리를 누구와도 같다고 본다.
- 운영포털 양식 `checkhere-requests.mjs:37`: '전화번호 끝 4자리(선택)'.
- 중계: `checkhere-live-relay.mjs:158`이 실시간 요청만 남기고 나머지를 버린다. `:96-97` 바로 승인. `checkhere-live.mjs:178` watchQueue는 pending·approved만 본다.
- 다른 경로는 모두 거부한다: `checkhere-requests.mjs:67`, `:81`, `:106`, `:150`, `checkhere-proposals.mjs:120`.

**문제**: 실시간 화면과 중계는 같은 학생·같은 항목에 진행 중인 다른 요청이 있어도 모르고 새 수정을 반영한다. 기존 흐름은 이 경우 '먼저 반려·정리'를 요구한다.

**실제로 생기는 경우**: 운영포털에서 끝 4자리 없이 'A 학생 입실 09:05' 요청이 대기 중이다. 다른 관리자가 실시간 화면에서 같은 학생을 09:10으로 고친다 → 중계가 바로 반영한다. 나중에 hint.kpc가 옛 요청을 승인하면 09:05로 되돌아간다. 옛 요청이 이미 승인 상태면 확인 없이 덮어쓴다.

**고칠 방법**
1. 화면: `checkhere-live-core.mjs:52`를 `…&&a.name===b.name&&(!a.phoneLast4||!b.phoneLast4||String(a.phoneLast4)===String(b.phoneLast4))`로. 행 잠금은 학생 단위로 둔다. 행에는 `changes`가 없어서 행에 `requestsOverlap`를 쓰면 오류가 난다.
2. 제출: `checkhere-live.mjs:128` `buildLiveRequest` 다음에 `if(state.requests.some(x=>ACTIVE.includes(x.status)&&x.changes&&requestsOverlap(x,input)))throw Error('같은 학생·항목에 처리 중인 다른 수정 요청이 있습니다.');`. 이 화면의 요청 구독은 그 반·날짜만이라(`:84`) 충분하다. `checkhere-live.mjs`에 `requestsOverlap`를 import한다(`ACTIVE`는 이미 쓰고 있다).
3. 중계
   - `checkhere-live.mjs:178` 조회를 `where('status','in',['pending','approved','applying'])`로.
   - `checkhere-live-relay.mjs:20-21` 근처에 `let active=[];`를 두고, `:157` watchQueue 콜백 첫 줄에서 `active=list;`로 전체 목록을 보관한다. 대기열(`:158`)은 지금처럼 실시간 pending/approved만.
   - `processRequest`의 pending 경로에서 `cleanRequest`(`:81`) 직후, 연결 프로그램을 부르기 전에: `if(active.some(o=>o.id!==r.id&&ACTIVE.includes(o.status)&&o.changes&&requestsOverlap(o,clean)))return reject(r,'같은 학생·항목에 처리 중인 다른 수정 요청이 있습니다. 운영 포털 수정 요청에서 먼저 정리해 주세요.');`
   - 미루지 말고 반려한다. 옛 요청은 며칠 대기할 수 있고, 반려 사유는 화면에 보인다(`checkhere-live.mjs:97`).
   - 중계 파일에 `requestsOverlap`(`checkhere-proposal-core.mjs`, 다른 모듈을 불러오지 않는 파일이라 Node 시험에서도 됨)와 `ACTIVE`(`checkhere-live-core.mjs:13`)를 import한다.
   - 이미 승인된 실시간 요청(`:80` 경로)에는 이 검사를 하지 않는다.
4. (선택, 더 안전) 운영포털 '승인된 변경 반영'이 현재 기록과 `approval.before`가 다르면 거부.

**추가할 시험**: `live-relay.test.mjs`: 일반 대기 요청 `{name, phoneLast4:'', changes:{entry:'09:05:00'}}` + 같은 학생·항목의 실시간 요청 → 가짜 체크히어 값 그대로, 실시간 요청은 rejected. core 단위 시험: 끝 4자리가 빈 요청이 있으면 `requestsFor`가 그 학생에게 그 요청을 돌려줌.

**우선순위**: 지금. 시간 삭제 전에 반드시.

### 4. `retry_` 요청 가로채기 · 확인됨 · 지금

**판정**: 2명 인정. 과장된 부분: 아무것도 안 쓴 'failed' 요청이면 이중 반영은 없다(`server.mjs:174`가 approvalId로 중복을 막음). 혼란스러운 오류만 남는다. 연결 프로그램이 한가하면 운영포털이 먼저 처리하는 경우가 많다. 해로운 경우는 중계의 자동 갱신이 잠금을 잡은 순간 운영포털의 미리보기가 409를 받고 멈춰, 남은 요청을 중계가 가져가는 때다.

**현재 코드**
- `checkhere-retry-store.mjs:27`이 재처리 요청을 `cleanRequest(fresh)`로 만들어 근거의 `[실시간 베타]`·`[기준:…]` 표시를 그대로 복사한다.
- `checkhere-live-core.mjs:25` `isLiveRequest`는 근거 글자만 본다.
- `checkhere-live-relay.mjs:158` id를 보지 않는다. `:93` 지문이 다르면 반려.
- `checkhere-requests.mjs:165` '재처리 요청 상태를 확인해 주세요.'

**문제**: 일부만 반영된 실시간 요청을 운영포털 '실패 건 다시 처리'로 다시 돌리면 `retry_<해시>` 요청이 생기는데, 중계가 이것을 실시간 요청으로 알고 가져가 지문 불일치로 반려한다. id가 정해진 값이라 이후 재처리도 같은 반려 요청을 찾고, 원래 요청은 실패 목록에서 사라진다.

**실제로 생기는 경우**: 수집 PC에서 중계 탭을 연 채 hint.kpc가 운영포털 '실패 건 다시 처리'를 누른다.

**고칠 방법**: `checkhere-live-relay.mjs:158` 필터에 `&&!/^(retry|proposal)_/.test(String(r.id))`를 더한다. `isLiveRequest`는 그대로 둔다(실시간 화면 기록 목록 `checkhere-live.mjs:103`에 계속 보이게). UUID 정규식으로 거르면 기존 시험 id(`live-req-…`)가 깨지므로 쓰지 않는다. `retry_` 요청은 운영포털 재처리 흐름만 처리하고, 중간에 멈추면 운영포털 목록에 대기로 남아 보통 승인 버튼으로 처리된다.

**추가할 시험**: `live-relay.test.mjs`: id `retry_`+64자리 16진수, 실시간 표시 근거, `createdBy` APPROVER인 요청 → `relay.step()` 뒤에도 pending, 승인·반려 없음. `docs/checkhere-live-beta.md` 흐름 3번에 "`retry_`·`proposal_` 요청은 중계가 건드리지 않는다"를 적는다.

**우선순위**: 지금(한 줄 수정).

### 5. 일괄 수집이 최근 20개 밖으로 밀림 · 확인됨 · 지금 · ★

**판정**: 4명 인정. 과장된 부분: 중계 간격은 10분이다(5분 아님). 한 주기가 최대 17개라 첫 주기 뒤에는 아직 18번째로 보이고, 두 번째 주기(약 10~20분 뒤)에 밀린다. PC의 SQLite에는 남아 있어 '플랫폼에 저장'을 직접 누르면 살릴 수 있다.

**현재 코드**
- `checkhere/server.mjs:78` `jobs:[...jobs.values()].slice(-20).reverse()`. `:38` saveJob은 기존 id의 순서를 유지하고, `:39` 재시작 때 넣은 순서대로 다시 읽는다.
- `checkhere-ui.mjs:83` `state.jobs.find(x=>x.kind==='batch')`로만 일괄 작업을 찾는다. `:98-104` 작업별 저장은 일괄 작업을 다루지 않는다(recordId 없음).
- 약속 문구: `checkhere-ui.mjs:44` '이 화면을 닫아도 수집은 계속됩니다. 다시 열면 끝난 날짜를 이어서 DB에 저장합니다', `docs/checkhere-batch-collect.md:9`.
- `checkhere-live-relay.mjs:55` 반마다 sync 작업 1개(주기당 최대 17개).

**문제**: 화면은 최근 20개 작업 안에서만 일괄 작업을 찾는다. 중계가 작업을 20개 넘게 만들면 끝난 일괄 작업이 목록에서 빠지고, 다시 열어도 남은 날짜를 저장하지 않는다. 경고도 없다.

**실제로 생기는 경우**: 관리자가 '전체반 · 7/27~오늘'을 시작하고 화면이 시키는 대로 탭을 닫는다. 일괄 작업이 끝난 뒤 중계가 작업을 20개 넘게 만든다. 다시 열면 지난 날짜 수정분이 Firestore에 올라가지 않는다. 일괄 수집을 두 번 하면 앞 일괄의 남은 날도 같은 식으로 빠진다.

**고칠 방법** (작게)
1. `server.mjs`: `let lastBatchId=null;`. `:39`에서 읽을 때 `kind==='batch'`면 갱신, `:109` sync-batch에서 `saveJob(j)` 다음에 `lastBatchId=j.id`.
2. `:78` `/api/state`: 응답 전에 `const recent=[...jobs.values()].slice(-20).reverse(),extra=url.searchParams.get('batch')==='1'&&lastBatchId&&!recent.some(x=>x.id===lastBatchId)?{batch:jobs.get(lastBatchId)}:{};`를 만들고 응답의 `jobs:`를 `jobs:recent,...extra`로 바꾼다. 즉 요청에 `batch=1`이 있고 마지막 일괄 작업이 최근 20개에 없을 때만 `batch`를 붙인다. 일괄 작업 하나가 결과 2,210건까지 될 수 있고 중계는 1.5초마다 state를 읽으므로(`checkhere-live-relay.mjs:19` pollMs, `:37`) 중계 응답에는 넣지 않는다.
3. `checkhere-ui.mjs:77` state 요청에 `&batch=1`을 붙이고, `:83`을 `const batch=state.jobs.find(x=>x.kind==='batch')||state.batch;`로. 옛 연결 프로그램은 이 필드가 없으니 지금처럼 동작한다.
4. 저장 기록(localStorage `checkhere.batchSaved.<id>`)은 그대로 쓰여 중복 저장은 없다.
- 대안: `GET /api/job?id=` + 화면이 일괄 작업 id를 localStorage에 기억. 다른 브라우저에서 다시 열면 못 쓰므로 위 방법을 권한다.

**추가할 시험**: `batch-ui.test.mjs`: `jobs`에는 sync 20개, 일괄 작업은 `state.batch`에만 → 끝난 날짜가 한 번씩 저장. 연결 프로그램 쪽: 일괄 뒤 sync 20개를 만든 다음 `/api/state?delta=1&batch=1`에는 batch가 있고, `batch=1`이 없으면 없다.

**우선순위**: 지금. 연결 프로그램 파일이라 1·6번과 한 번에 빌드를 올린다.

### 6. 수집 중단이 묻힘 · 확인됨 · 지금(1번과 함께) · ★

**판정**: 2명 인정. 틈은 보통 수~수십 ms(날짜마다 requireLogin 한 번)이고, 중단 버튼이 계속 보여 다시 누르면 된다. 핸드오프가 날짜마다 `collect()`를 부르게 바꿔서 틈이 날짜 수만큼 늘었다.

**현재 코드**: `checkhere/collector.mjs:186` `await this.requireLogin();this.cancelled=false;`(await 뒤에 지움). `checkhere/server.mjs:82` cancel은 표시만 세운다. `:116` 날짜마다 collect, `:129`·`:135` 반복문이 표시를 본다. `:108` 일괄 수집은 시작할 때 이미 한 번 지운다.

**문제·실제 경우**: 다음 날짜의 `collect()`가 requireLogin을 기다리는 순간 '수집 중단'을 누르면 표시가 다시 false가 되어, 최대 17반×130일 일괄 수집이 계속 돈다.

**고칠 방법**: `collector.mjs:186`에서 `this.cancelled=false;`를 지운다. `/api/sync`에서 `adapter.cancelled=false;`를 requireLogin 다음, `busy=j.id` 전에 둔다(1번에서 고친 코드 안). collect를 부르는 곳은 `server.mjs:96`과 `:116`뿐이고, 시험은 새 collector를 만들어 생성자(`:20`)가 false로 시작한다.

**추가할 시험**: `batch-sync.test.mjs`: 가짜 requireLogin을 느리게 하고 그 사이 cancel → 작업이 'cancelled'. 기존 `:72-81` 시험은 readDetails 도중의 cancel만 본다.

**우선순위**: 지금, 1번과 같은 빌드에.

### 7. '여러 반 선택'의 저장본 조회가 0건 · 확인됨 · 지금

**판정**: 4명 인정. 데이터 손실은 없고, 빈 결과로 오해해 필요 없는 재수집을 할 수 있다.

**현재 코드**: `checkhere-ui.mjs:21` `<option value="multi">`, `:34` `classIds()`는 multi를 처리하지만 `:167`은 `ctx.load($('#class').value,…)`로 문자열 `multi`를 넘긴다. `checkhere-portal.mjs:44`는 `all`만 알아서 `['multi']` → `:45` `loadCheckHereDay(db,'multi',date)`. `checkhere-snapshots.mjs:9-11` 문서 없음 → 옛 저장본 조회(날짜당 읽기 2건). 규칙의 읽기는 관리자 여부만 봐서 오류 없이 빈 결과가 온다.

**고칠 방법**: `checkhere-ui.mjs:167`을 아래처럼. `all`일 때 읽기 수는 지금과 같다. `checkhere-portal.mjs`·규칙은 바꾸지 않는다.
`if(ctx.load)$('#loadCloud').onclick=handle(async()=>{const ids=classIds(),range={from:$('#from').value,to:$('#to').value};if(!ids.length)throw Error('조회할 반을 하나 이상 선택해 주세요.');const recs=[];for(const c of ids)recs.push(...await ctx.load(c,range));state.records=recs;state.busy=null;cloudShown=true;render();});`

**추가할 시험**: `batch-ui.test.mjs`: 여러 반 선택으로 3·5반을 고르고 '플랫폼 저장본 조회' → load가 `'3'`, `'5'`로만 불리고 `'multi'`로는 안 불림. 아무 반도 안 고르면 안내가 뜸.

**우선순위**: 지금(한 줄).

### 8. live-ui 시험 날짜 · 확인됨 · 지금(10-22 전) · 2026-10-14 고침(DATE 2026-10-12 고정, 포트 18943)

**판정**: 2명 인정. 이 시험만의 문제이고 제품 코드는 그대로 둔다.

**현재 코드**: `checkhere/tests/live-ui.test.mjs:12` `DATE`가 실제 오늘(서울). 관리자 수정 제출 때 `checkhere-live-core.mjs:48` cleanRequest → `checkhere/approval-core.mjs:10`이 10-22 이후 날짜를 거부 → `:101` 대기가 시간 초과로 실패.

**문제·실제 경우**: 2026-10-23(서울)부터 `node --test tests/*.test.mjs`에서 이 시험이 실패한다. 제품의 날짜 제한은 의도된 것이고 시험만 고치면 된다.

**고칠 방법**: `:12`를 `DATE='2026-10-12'`로. `:91` 대기 다음, `:93` `#relayNow` 클릭 전에 `await relay.page.fill('#date',DATE);`. `:95` 관리자 open 다음에 `await admin.page.fill('#date',DATE);`. 날짜 칸을 바꾸면 화면이 다시 구독하고 `#relayNow`도 그 날짜를 쓴다. `addInitScript`로 Date를 고정하지 않는다(연결 프로그램과 가짜 체크히어는 Node의 실제 시계).

**추가할 시험**: 이 수정 자체. 중계의 자동 주기는 실제 오늘을 돌지만 가짜 체크히어가 '강의가 없습니다'로 답해 그냥 건너뛴다. 이 시험은 실제 포트 8765를 쓰므로 수집 PC에서는 연결 프로그램이 꺼져 있을 때만 돌릴 수 있다(위 '시험할 때' 절).

**우선순위**: 10-22 전에.

### 9. 메모 빈칸 덮어쓰기 · 확인됨 · 2기 전 · ★

**판정**: 2명 인정. 지금 데이터에서는 생기지 않는다(2026-10-12 진단에서 100명 일치, `memoByAdmin`가 온다). 체크히어가 필드 이름을 바꾸거나 뺄 때 생긴다. 첫 행이나 외출 학생에게 메모가 있으면 우연히 잡힌다.

**현재 코드**
- `checkhere/day-data.mjs:18` 없음·null 모두 `''`. `:31` entryMemo/exitMemo를 그렇게 만든다. `:43` 표와의 대조에 메모가 없다. `:54` 표본은 화면 데이터만 보고 고른다.
- `checkhere/collector.mjs:199` 화면 데이터 기록은 `sameAsStored`로 비교 → 다르면 `onRecord`. `checkhere/server.mjs:54` `sameStored`는 version(메모 포함)을 비교해 새 기록으로 저장.
- 중계 `checkhere-live-relay.mjs:44-49` saveDay → `checkhereCurrent`. `checkhere-current-core.mjs:7` 최신 collectedAt이 이김 → Firestore의 메모가 사라진다.
- 약속과 어긋남: `day-data.mjs:2-4` 주석, `docs/checkhere-batch-collect.md:22` '빈 메모로 바꾸지 않음'.

**문제**: 화면 데이터에서 메모 항목이 빠지면 모든 학생이 시간은 맞으니 '일치'로 보고, 저장된 메모를 빈칸으로 덮는다.

**실제로 생기는 경우**: 체크히어가 `memoByAdmin` 이름을 바꾸거나 일부 기록에서 뺀다. 10분 자동 갱신이 주기마다 전체 반에 이것을 퍼뜨린다.

**고칠 방법**
1. 핵심(작고, 체크히어 형식을 가정하지 않음): collect 옵션에 **부작용 없는** 판정 함수 `clearsStoredMemo(fast)`를 추가한다.
   - `server.mjs:54` `sameStored` 옆에 `const clearsStoredMemo=r=>{const old=snapshots.get(r.id)?.record;return !!old&&old.source==='live'&&old.readState==='complete'&&(!!old.entryMemo&&!r.entryMemo||!!old.exitMemo&&!r.exitMemo);};`를 두고, `:96`과 `:116`의 incremental 옵션(`pageData:true,sameAsStored:…`)에 `clearsStoredMemo`를 함께 넘긴다.
   - `collector.mjs:185` collect 옵션 목록에 `clearsStoredMemo=null`을 더하고, `:199`를 `if(fast){if(clearsStoredMemo?.(fast)){await onRecord(await this.readDetails(rows[i]));continue;}if(sameAsStored?.(fast))continue;await onRecord(fast);continue;}`로 바꾼다.
   - 체크히어에서 정말로 메모를 지웠다면 수정창 읽기로 맞게 반영된다. 메모 지우기는 드물어 수정창 여는 수는 거의 늘지 않는다. server의 `sameAsStored`는 `skipped`를 올리는 부작용이 있으니 그것을 재사용하지 않는다.
2. 날짜 단위 항목 확인: `planFromPageData`(`day-data.mjs:35-50`)의 `:37` 다음에 아래를 넣는다. ATTEND/PASS/COMPLETE 기록이 있는데 그중 하나도 `memoByAdmin` 키가 없으면 그날 전체를 수정창으로 읽게 하고 이유를 남긴다.
   ```js
   const memoEvents=list.flatMap(s=>Array.isArray(s?.eventList)?s.eventList:[]).filter(e=>['ATTEND','PASS','COMPLETE'].includes(e?.type));
   if(memoEvents.length&&!memoEvents.some(e=>Object.hasOwn(e,'memoByAdmin')))return {byId:new Map(),fallback:rows.map(r=>r.id),reason:'화면 데이터에 관리자 메모 항목이 없습니다.'};
   ```
   기록마다 키를 엄격히 요구하는 것은 체크히어가 null 필드도 늘 보낸다는 것이 확인된 뒤에만 한다.
3. (선택) 표본은 저장된 기록에 메모가 있는 학생부터 고른다.
4. (선택) 1번으로 수정창을 열어 메모가 실제로 지워진 것이 확인되면 작업 메모(note)에 남긴다.

**추가할 시험**: `page-data.test.mjs`: 이벤트에서 `memoByAdmin`를 뺀 화면 데이터 + 이전에 저장된 메모 → 빠른 수집 뒤에도 메모가 남고 그 학생은 수정창으로 읽힌다. 기존 fixture는 늘 `memoByAdmin`가 있어 깨지지 않는다.

**우선순위**: 2기 전. 11번과 같은 줄(`collector.mjs:189-199`)을 고치므로 같은 빌드에 넣는다.

### 10. 기억한 강의 주소를 버리지 않음 · 이견 · 2기 전 · ★

**인정한 쪽**: `checkhere/collector.mjs:61-69` `openLecture`는 기억한 주소를 확인 없이 쓰고, `lectureUrls`를 지우는 코드가 없다(`:68` set만). `openDay`(`:99-103`)는 날짜 주소만 다시 찾는다. `checkhere/server.mjs:47`이 재시작 때 `lecture|N`을 다시 읽어서 잘못된 주소가 재시작 뒤에도 남는다. 날짜를 못 찾으면 `discover`(`:93`) '강의가 없습니다' → `server.mjs:118` 'no-lecture' → 재시도(`:135`)와 '확인 필요' 수(`:136`)에서 빠진다. `lectureDates`(`collector.mjs:73-74`)도 같은 주소를 써서 `server.mjs:131`이 날짜를 바로 '강의 없음'으로 처리한다. 중계는 그 반을 그날 갱신에서 뺀다(`checkhere-live-relay.mjs:58`). `docs/checkhere-batch-collect.md:17`과 `server.mjs:41-43` 주석은 "다시 찾는다"고 하지만 날짜 주소만 해당한다.

**기각한 쪽**: 계기(강의 교체)가 가정이다. 1기는 반마다 강의 하나로 안정적이고 남은 기간이 짧다. 2기 강의는 날짜 범위(10-22) 밖이라 어차피 의도적인 코드 변경이 필요하다. 1기·2기 `[N반]` 강의가 둘 다 보이면 새 검색은 '동일한 반 또는 날짜가 여러 개입니다'(`collector.mjs:46`)로 실패하거나 먼저 보이는 것을 고를 수 있어, 제안된 고침이 2기에서 확실히 돕지도 않는다. 잘못된 반·날짜 저장은 제목 확인(`:116-117`)이 막는다. 중계 로그와 일괄 요약 '강의 없음 N'으로 드러나 조용하지도 않다.

**정리**: 1기 동안은 피해가 적고, 2기로 넘어갈 때 문제가 된다. 2기 준비 항목으로 다룬다.

**고칠 방법**
1. 지금(문서만): `docs/checkhere-batch-collect.md:17`과 `server.mjs:41-43` 주석을 "반 강의 주소는 다시 찾지 않는다"로 고친다.
2. 2기 전(인정한 쪽 안)
   - `openLecture(classId,{fresh=false})`가 기억한 주소를 썼는지 돌려준다.
   - `discover`: 기억한 주소로 연 강의에서 날짜를 못 찾거나(`findPagedRow`가 null) LOGIN_REQUIRED가 아닌 오류가 나면 `this.lectureUrls.delete(String(classId))` 후 `{fresh:true}`로 한 번 더 찾는다. 그래도 없을 때만 '강의가 없습니다'.
   - `lectureDates`도 remembered를 돌려주고, `server.mjs:125`는 기억한 주소로 훑은 결과로는 `known`(강의 없음 판정)을 만들지 않는다. 또는 요청 날짜가 목록에 없으면 fresh로 다시 훑는다.
   - map에서 지우면 `rememberPlaces`(`server.mjs:48-52`)가 places 행도 지운다.
   - (선택) 시작할 때 `savedAt`이 오래된 `lecture|*` 행은 건너뛴다.
3. 2기 전 사용자 결정이 필요하다: 1기·2기 강의가 둘 다 `[N반]`이면 무엇으로 구별할지(강의 기간 글자 등). 이 결정 없이 새 검색만 넣으면 '여러 개' 오류가 날 수 있다. 2기 시작 때 `checkhere/data/attendance.sqlite`의 `places`에서 `lecture|*` 행을 한 번 지우는 방법도 있다. 로컬 데이터라 커밋 대상이 아니고, 지우기 전에 사용자에게 확인한다.

**추가할 시험**: 가짜 페이지로, 기억한 강의 주소의 일정에는 날짜가 없고 HOME에는 그 날짜가 있는 새 `[N반]` 강의 → `discover` 성공, `lectureUrls`(그리고 places)에 새 주소.

**우선순위**: 2기 전(문서 수정은 지금).

### 11. 바뀐 게 없어도 매번 표본 수정창 · 확인됨 · 2기 전 · ★

**판정**: 2명 인정. '주기당 1~2분'은 수정창 속도에 따라 다르다(대략 반당 몇 초, 주기당 0.5~1.5분). 설계 의도는 '하루 1~2명'(`day-data.mjs:51` 주석)인데 실행마다 연다. `docs/checkhere-live-beta.md:13`의 "행이 같으면 수정창을 열지 않고"와도 어긋난다.

**현재 코드**: `checkhere/collector.mjs:189-194` 표본 `readDetails`가 `:199` `sameAsStored` 확인보다 먼저 돈다. `readDetails`(`:165-179`)는 입실·퇴실 창 + 외출이 있으면 외출 창 → 반마다 2~6개 창. 10분마다 17반.

**문제·실제 경우**: 수업 중 대부분의 주기는 바뀐 학생이 없는데도 반마다 수정창을 2~6번 연다. 하루 수천 번 추가로 체크히어를 조작하고, 뒤 반과 대기 중인 수정 요청이 그만큼 늦어진다. 이때 표본은 결과를 바꾸지 못한다.

**고칠 방법**
판정(같은지)과 집계(`skipped` 세기)를 나눈다. 지금 server의 `sameAsStored`는 판정하면서 `skipped`를 올리므로, 표본 전에 미리 부르면 이중 집계가 된다.
1. `server.mjs:96`의 incremental 옵션을 `sameAsStored:r=>sameStored(r),onSkip:()=>{j.skipped++;}`로, `:116`은 `sameAsStored:r=>sameStored(r),onSkip:()=>{result.skipped++;j.skipped++;}`로 바꾼다(`sameAsStored`는 순수 판정만).
2. `collector.mjs:185` collect 옵션에 `onSkip=null`을 더한다. `:189` `if(plan?.byId.size){` 바로 안에서 행마다 한 번만 판정해 기억한다:
   `const keep=new Map([...plan.byId].map(([id,r])=>[id,!!sameAsStored?.(r)]));const changed=[...plan.byId.values()].filter(r=>!keep.get(r.id));`
3. `:191`의 표본을 `for(const id of changed.length?sampleIds(changed):[])`로 바꾼다. 바뀐 행이 없으면 표본을 건너뛰고(`agreed`가 true로 남음) 화면 데이터 경로로 간다. 표본은 실제로 저장될 행에서 고른다.
4. `:199`에서는 `sameAsStored`를 다시 부르지 않는다: `if(fast){…(9번 검사)…if(keep.get(fast.id)){onSkip?.();continue;}await onRecord(fast);continue;}`.
5. 표본이 어긋나 수정창 경로(`:206`)로 가면 지금처럼 `unchanged`가 센다. 앞에서 센 것이 없으니 이중 집계가 없다. `plan.fallback` 행(`:200`)도 그대로 둔다.
6. collector와 server를 같은 빌드에서 함께 바꾼다(옵션 이름이 맞아야 함). `sameAsStored` 없이 부르는 기존 시험(`page-data.test.mjs:66`)은 `keep`이 모두 false라 지금과 같이 돈다.
- 대안(덜 권함): 반·날짜별로 한 번 일치하면 collector에 기억하고 그날은 표본 생략. 실제로 값을 쓰는 실행에서도 확인을 건너뛰게 된다.
- 9번을 먼저 넣으면 표본이 줄어도 메모 쪽 안전장치가 남는다.

**추가할 시험**: `page-data.test.mjs`(`:67-68` 옆): 같은 날 두 번째 빠른 수집에서 바뀐 게 없으면 수정창 0번, `skipped`는 한 번만 셈. 한 명이 바뀌면 표본이 그 학생에서 나옴.

**우선순위**: 2기 전, 9번과 같은 빌드.

### 12. 저장 대기열이 새로고침을 막음 · 확인됨 · 2기 전

**판정**: 2명 인정, 단 제안된 고침의 절반은 틀렸다(지켜보는 동안 끝난 날만 자동 저장하면 '다시 열면 이어서 저장' 약속이 깨짐). 과장된 부분: '두 번째 관리자 PC'는 연결이 안 된다(연결 프로그램은 127.0.0.1만, `server.mjs:223`). 실제 계기는 수집 PC의 다른 브라우저·프로필·시크릿 창·저장소를 지운 경우, 그리고 탭을 닫았다 다시 연 경우다. '영원히 멈춤'이 아니라 대기열이 빌 때까지(수 분) 멈춘다.

**현재 코드**: `checkhere-ui.mjs:15-18` 저장 기록은 이 브라우저 localStorage에만. `:86-92` 기다리지 않고 큐에 넣는다. `:103` 작업별 저장은 `await saveCloud` → `cloudTail`(`:63`) 뒤에서 기다리고, `:106` 폴링 재설정은 그 다음이다. `:136` #pair와 `checkhere-requests.mjs:62` `connected()`도 같은 refresh를 기다린다. 추가 버그: `:89` 저장 전에 `done`에 넣고 `:94` 바로 localStorage에 써서, 대기 중에 탭을 닫으면 저장 안 된 날이 저장된 것으로 남는다.

**문제·실제 경우**: 새 브라우저에서 연결하거나 일괄 수집 뒤 화면을 다시 열면 끝난 날 수백 개가 차례로 서버 확인을 받는다. 그동안 '연결' 버튼, 진행 표시 폴링, 승인 작업이 모두 기다린다.

**고칠 방법**
1. `:103` await를 없앤다(오류 문구는 지금 것 그대로).
   ```js
   if(batch.length)saveCloud(batch,j).catch(e=>alertMessage('수집 완료 · 플랫폼 저장 실패',`PC에는 수집 결과가 남아 있습니다. 플랫폼 저장을 다시 시도해 주세요.\n${e.message}`));
   ```
2. 저장이 성공한 뒤에만 '저장됨'으로 기록한다. 2번 항목의 2단계와 같은 수정이니 함께 한다.
3. (선택) 뒤에서 도는 일괄 저장은 `cloudSaves`와 따로 세어 `:41` 버튼 잠금과 `:172` canLeave에서 빼고 `#cloudSaveStatus`에만 진행을 보인다.
4. (선택) 새 브라우저 첫 따라잡기: 반마다 `checkhereCurrent` 기간 조회 한 번(`attendance-upload.mjs:36`과 같은 방식)으로 이미 같은 날은 저장됨으로 처리 → 날짜 1,000번 대신 반 17번. 규칙 변경 없음.

**추가할 시험**: `batch-ui.test.mjs`: 빈 localStorage + 끝난 날 다수 + 기간 안에 기록이 있는 옛 sync 작업 → #pair가 대기열이 비기 전에 끝나고 폴링이 계속됨. 대기 중에 화면을 닫았다 열면 저장 안 된 날이 다시 큐에 들어감.

**우선순위**: 2기 전.

### 13. confirm-existing 뒤 10분 대기 · 확인됨 · 2기 전

**판정**: 2명 인정, 드물다. 체크히어가 마침 요청값으로 바뀌어 있고, 몇 초 사이에 작성자가 취소하거나 운영포털에서 반려해야 한다. 'approved'는 대개 운영포털의 반영이 같은 연결 프로그램에 작업을 만들어 스스로 풀리므로, 이 경우 대기열에서 지우면 안 된다(원래 제안 고침의 빈틈).

**현재 코드**: `checkhere/server.mjs:182` 대기 상태가 아니면 작업 없이 상태만 돌려준다. `checkhere-live-relay.mjs:88-91` pending, verified+platformSaved 말고는 모두 `finishApply` → `waitJob`(`:34-42`)이 `jobTimeoutMs`(`:19`, 10분)까지 기다린다. 중계는 한 번에 하나만 하므로 그동안 자동 갱신과 다른 요청이 모두 멈춘다.

**고칠 방법**: `checkhere-live-relay.mjs:91`을 아래로 바꾼다. 작업 응답은 `server.mjs:174`·`:200`에서만 오고 늘 `id=approvalId`이며, `:182` 응답에는 `id`가 없다.
```js
if(res.id===r.id)return finishApply(r,idToken);
if(res.status==='approved'){note(`${r.classId}반 ${r.name}: 다른 관리자가 승인했습니다. 승인된 요청으로 다시 처리합니다.`);return;}
queue.delete(r.id);note(`${r.classId}반 ${r.name}: 자동 반영하지 않음 — 요청 상태가 ${res.status}(으)로 바뀌었습니다.`,'warn');return;
```
(선택) `waitJob`의 첫 refresh에서 그 id의 작업도 없고 busy도 그 id가 아니면 바로 오류.

**추가할 시험**: `live-relay.test.mjs`: confirm-existing이 `{status:'withdrawn'}` → `step()`이 jobTimeoutMs보다 훨씬 빨리 끝남. `{status:'approved'}`면 대기열에 남음.

**우선순위**: 2기 전.

### 14. 진행 중인데 '수집 종료' 표시 · 확인됨 · 여유 있을 때

**판정**: 2명 인정. 표시만 틀리고 데이터 문제는 없다.

**현재 코드**: `checkhere-ui.mjs:59`는 cancelled가 아니면 모두 '수집 종료'. `:92` 실패 처리기가 큐에 넣을 때의 `batch`(status running)로 `showBatch`를 부른다. `:44` 스피너는 계속 돈다. 두 검증자 모두, 원래 제안대로 고치면 늦게 온 실패가 최종 요약을 '진행 중'으로 되돌린다는 빈틈을 지적했다.

**고칠 방법**: (1) `:92`에서 `showBatch(state.jobs.find(x=>x.id===batch.id)||state.batch||batch)`(`state`는 새로고침마다 바뀜). (2) `showBatch`에서 `j.status==='running'`이면 '수집 진행 중' 머리글과 'DB 저장 실패' 블록만 보인다. (3) `:96` 최종 요약은 그대로.

**추가할 시험**: `batch-ui.test.mjs`: running 중 save 실패 → `#bulkStatus`에 '수집 종료'가 없음. 끝난 뒤 늦게 온 실패가 최종 요약을 되돌리지 않음.

**우선순위**: 여유 있을 때. 2번을 고치면 /beta2에서는 안 생기고 1기 네트워크 지연 때만 생긴다.

### 15. 일괄 수집이 '반영'으로 표시 · 확인됨 · 여유 있을 때

**판정**: 2명 인정. 표시만의 문제. 10분 중계는 `sync` 작업을 만들어 '수집'으로 맞게 보이고, 손으로 시작한 일괄 수집과 진단만 틀리게 보인다.

**현재 코드**: `checkhere-ui.mjs:55` `j.kind==='sync'?'수집':'반영'`. `checkhere/server.mjs:109`가 batch, `:148`이 probe 작업을 만든다. `:39` 재시작 때 상태 'interrupted'가 영어 그대로 보인다.

**문제**: 이 포털에서 '반영'은 '체크히어에 썼다'는 뜻이라 직원이 수집을 쓰기로 오해할 수 있다.

**고칠 방법**: `({sync:'수집',batch:'일괄 수집',probe:'진단',apply:'반영'})[j.kind]||j.kind`, 상태표에 `interrupted:'중단됨(프로그램 재시작)'`. (선택) probe의 complete는 '진단 완료'.

**추가할 시험**: `batch-ui.test.mjs`: 일괄 작업 배지가 '일괄 수집 · 수집 완료'.

**우선순위**: 여유 있을 때. 한 줄이라 다른 화면 수정 때 같이 한다.

### 16. 수집 방식 설명이 안 보임 · 확인됨 · 여유 있을 때

**판정**: 2명 인정. 핸드오프가 새로 넣은 배치 실수다.

**현재 코드**: `checkhere-ui.mjs:22` 설명 문단이 `#classPicker`(처음엔 hidden) 안에 있고, `:43`이 multi일 때만 보인다. 수집 방식 선택은 `:21` `#mode`.

**고칠 방법**: 문단을 `#classPicker` 밖, `:21`의 `</section>` 바로 뒤 독립 요소로 옮긴다(`.toolbar`는 flex라 안에 넣으면 줄이 깨짐): `<p id="modeHelp" class="muted" style="margin:-8px 4px 12px">…</p>`. `#mode`에 `aria-describedby="modeHelp"`. `:43`은 그대로. 문구는 17번의 새 문구로.

**추가할 시험**: `batch-ui.test.mjs`: 기본(2반) 화면에서 `#modeHelp`가 보임.

**우선순위**: 여유 있을 때, 17번과 함께.

### 17. 빠른 수집 설명이 너무 많이 약속 · 확인됨 · 여유 있을 때

**판정**: 2명 인정(문구 문제). 수집 동작은 그대로 두는 게 맞다. 같은 경로를 10분 중계가 쓰므로, 대체 읽기 날 모든 학생의 수정창을 열면 효율 목표가 깨진다. 같은 동작을 정확성 버그로 본 다른 발견은 기각됐다(기각 표 '대체 읽기 날 메모만 고친 기록을 못 가져옴': 문서화된 설계이고 다음 화면 데이터 실행에서 회복).

**현재 코드**: `checkhere-ui.mjs:22` '반 전체의 시간·메모·외출을 한 번에… 하나라도 다르면 그날은 수정창 방식으로 다시 읽습니다'. 실제로는 `checkhere/collector.mjs:204-206`(날 전체 대체)과 `:200`(학생별 대체) 모두 `unchanged`로 행이 같은 학생을 건너뛴다(`:14` sameTableRow, `:134` tableSignature에 메모 없음). `checkhere/server.mjs:116`이 `result.method`·`result.note`를 저장하지만 `showBatch`(`checkhere-ui.mjs:57-60`)는 보여 주지 않는다.

**고칠 방법**
1. 문구: '…하나라도 다르면 그날(또는 표와 맞지 않는 학생)은 수정창으로 읽되, 표 값이 지난 수집과 같은 학생은 건너뜁니다. 체크히어에서 메모만 직접 고쳤다면 정밀 수집을 쓰세요.'
2. `showBatch`에 접힌 목록 '수정창으로 읽은 날 N건': `(j.results||[]).filter(r=>r.method==='editor')`, 각 줄 `반 · 날짜 · note`.
3. `docs/checkhere-batch-collect.md:7`에 화면 데이터 읽기와 이 예외를 적는다.
4. collector 동작은 바꾸지 않는다.

**추가할 시험**: `batch-ui.test.mjs`: method 'editor' 결과가 있으면 목록이 보임.

**우선순위**: 여유 있을 때.

### 18. 1기 출결대조의 users 다시 읽기 · 확인됨 · 여유 있을 때

**판정**: 2명 인정. 과장된 부분: 스냅샷은 바뀐 게 있을 때만 오고(중계는 바뀐 행만 저장), 보이는 탭만 해당하며, `users`는 직원 계정 수십 건이다. 그래도 탭 하나에 하루 1~2천 읽기가 될 수 있다. 원래 제안 1안은 틀렸다(캐시된 users로 해결되면 영영 만료되지 않고 `attendance-teacher.test.mjs:38-46`이 깨짐).

**현재 코드**: `attendance-overview.js:280` 구독 → `:350` `replaceSnapshots` → `attendance-beta.mjs:73` refreshTeacher → `:37` `teachers.refresh` → `attendance-teacher.mjs:36` TTL(`:31`, 5분) 확인이 `:42` 해결 확인보다 먼저 → `attendance-beta.mjs:19` `getDocs(collection(db,'users'))`. 중계 주기(10분)가 TTL보다 길어서 바뀐 스냅샷마다 TTL이 이미 지나 있다.

**고칠 방법**: `attendance-teacher.mjs` refresh(`:35`) 맨 앞에 `const id=classKey(classId);if(resolveClassTeacher({classId:id,records}))return;`(users 없이 그날 기록의 담임 이름만으로 정해지면 끝). `:41`의 기존 `const id` 줄은 정리. 나머지는 그대로.

**추가할 시험**: `attendance-teacher.test.mjs`: ttl 100, `refresh('1',[{classId:'1',teacher:'가담임'}])` → 시계를 넘기고 같은 기록으로 다시 → `loadUsers` 0번. 기존 만료 시험은 기록 없이 부르므로 그대로 통과.

**우선순위**: 여유 있을 때(작은 수정이라 언제든).

### 19. 1기 출결대조의 같은 문서 두 번 읽기 · 확인됨 · 여유 있을 때

**판정**: 2명 인정. 핸드오프 전부터 있던 것이고(이전 커밋), 반·날짜를 바꿀 때 읽기 1건이 더 든다. 원래 제안은 불완전하다. `watchCheckHereDay`는 문서가 없으면 아무것도 부르지 않아서(`checkhere-snapshots.mjs:16`) 옛 저장본(`checkhereSnapshots`) 대체 읽기와 오류 표시가 사라진다.

**현재 코드**: `attendance-overview.js:280` `beta.load`(→ `attendance-beta.mjs:78` `loadCheckHereDay` → `checkhere-snapshots.mjs:9` getDocFromServer)를 기다린 뒤 `watchCheckHereDay`(`checkhere-snapshots.mjs:13-19`)를 연다 → 첫 스냅샷을 또 과금 → `attendance-overview.js:349`에서 같아서 버린다.

**고칠 방법**
- 간단안: `beta2-ledger.mjs:88-93`처럼 오늘 날짜일 때만 구독하고 지난 날짜는 한 번만 읽는다. 오늘은 여전히 2건이고, 지난 날짜의 변경은 '다시 읽기' 뒤에 보인다.
- 온전한 안: `watchCheckHereDay`가 서버 확인된 '문서 없음'에 `onRecords(null)`을 부르게 한다(`beta2-ledger.mjs:90` 호출부는 null을 무시하게). `loadSelectedDate`에서 구독을 먼저 열고 첫 서버 확인 콜백을 promise로 만든다 → `beta.load(cid,iso,{checkhere:first})`가 `loadCheckHereDay` 대신 그 값을 쓴다(within 시간 제한, snapshotError 처리 유지). null이면 `loadLegacyCheckHereDay`를 한 번. 이후 콜백만 `pendingSnapshots`/`flushSnapshots`로. epoch 확인은 유지하고, 오래된 epoch면 `stopSnapshots`.

**추가할 시험**: `attendance-read-efficiency-ui.test.mjs`: 날짜를 바꿀 때 `checkhereCurrent` 서버 읽기 1번, 문서 없는 날에도 옛 저장본이 보임.

**우선순위**: 여유 있을 때.

### 20. 승인된 요청의 끝없는 재시도 · 이견 · 여유 있을 때

**인정한 쪽**: `checkhere-live-relay.mjs:114` 반려는 pending일 때만이고, approved는 `:115`로 60초마다 다시 한다. `:80` apply → `checkhere/server.mjs:188-190`(학생 다시 읽기, `prepareApproval`)이 claim(`:192`) 전에 실패하면 계속 실패한다. 규칙(`firestore.rules:52`)상 approved는 applying으로만 바뀔 수 있어 중계가 닫을 수 없다. 막힌 승인 요청이 있으면 그 학생의 수정 버튼과 제출도 잠긴다(`checkhere-live.mjs:99`, `:127`, ACTIVE). `docs/checkhere-live-beta.md:12` "5번 실패하면 반려"는 approved에는 사실이 아니다.

**기각한 쪽**: 승인(`:97`) 몇 초 뒤(`:98`) 같은 검사를 다시 하므로 계속 실패하는 경우는 억지 상황뿐이다. 실제 원인(읽기 시간 초과, 네트워크)은 일시적이라 다시 시도가 맞다. 비용은 1분에 학생 읽기 1건. `ignored`로 빼면 영원히 approved로 남아 더 나쁘다.

**고칠 방법** (작은 쪽)
- approved 요청 실패는 간격을 늘린다: `:115`에서 approved면 `retryMs*2**(n-1)`, 최대 30분.
- 5번째 실패에 한 번 'warn' 로그 '승인된 요청이 계속 실패합니다 · 운영 포털에서 확인 필요'. 계속 시도는 하되 느리게. `ignored`로 빼지 않는다.
- `docs/checkhere-live-beta.md:12` 고치기: 반려는 '반영 대기' 요청에만, 승인된 요청은 간격을 늘려 계속 시도.

**추가할 시험**: `live-relay.test.mjs`: approved 요청의 apply가 계속 400 → 시도 간격이 늘어나고 상태는 approved 유지.

**우선순위**: 여유 있을 때.

### 21. 연결 프로그램 재시작 뒤 키 바뀜 · 이견(검증자 2명 중 1명 인정) · 여유 있을 때

**인정한 쪽(검증자 1명)**: `checkhere/server.mjs:22` 시작할 때마다 새 키, `:73` 키가 다르면 401. `checkhere-live-relay.mjs:12` BRIDGE_KEY, `:112`·`:129`가 일시 오류로 보고 60초마다 같은 죽은 키로 다시 시도한다. `checkhere-live.mjs:190`이 키 칸을 잠가 바꿀 방법이 없고, 상태 칩(`:163`)은 '작동 중' 그대로다. 중계 자신이 "「체크히어 시작.cmd」를 다시 실행해 주세요"라고 안내하는데(`checkhere-live-relay.mjs:77`, `:95`, `:155`), 빌드가 다르면 `Start.ps1:11-18`이 재시작해서 키가 바뀐다.

**기각한 쪽(검증자 1명. 같은 주제의 다른 발견 '재시작 뒤 키가 바뀌면 자동 갱신이 조용히 멈춤'도 검증자 2명이 같은 이유로 기각, 기각 표 참고)**: 조용하지 않다. `lastError`가 빨간 글씨로 '이 PC의 연결 키를 입력해 주세요.'를 보인다(`server.mjs:73` → `checkhere-live.mjs:163`). 재부팅이면 중계 탭도 닫혀 어차피 다시 시작해야 한다. 같은 빌드로 cmd를 다시 실행하면 같은 프로세스, 같은 키다(`Start.ps1:8-11`). 재시작에는 어차피 사람이 PC 앞에 있다. 키를 파일에 고정하면 재시작마다 바뀌던 연결 방식이 약해진다(`server.mjs:74`는 키만 있으면 어느 https 주소든 받음).

**정리**: 키 고정은 하지 않는다. 화면만 조금 고친다.
- BRIDGE_KEY면 `status.state='needs-key'`, 칩을 '연결 키 필요'로, 자동 주기와 요청 처리를 멈추고 "연결 프로그램이 다시 시작되어 연결 키가 바뀌었습니다. 새 키를 붙여 넣어 주세요"를 보인다.
- `#relayKey`를 다시 열고 '키 바꾸기': `createBridgeClient`에 `setKey`, 중계 cursor 초기화, 대기열과 mirror는 유지, 다시 시작.
- `docs/checkhere-live-beta.md:12`를 맞춘다.
- 하지 말 것: 키를 주소(`#k=`)에 넣기(브라우저 기록에 남음), Windows에서 파일 권한 0600에 기대기.
- (선택) /beta2 출결대조의 '체크히어 실시간' 표시(`beta2-ledger.mjs:76`)에 '마지막 저장 HH:MM'을 정보로만. `updatedAt`은 바뀐 게 있을 때만 움직이므로 경고로 쓰면 계속 울린다.

**운영 메모(중요)**: 1·5·6·9·10·11번처럼 빌드를 올리면 Start.ps1이 재시작하고 키가 바뀐다. 이 항목을 고치기 전까지는 **중계 탭에서 '중계 멈춤' → 새 키 붙여넣기 → '중계 시작'**을 꼭 한다.

**추가할 시험**: `live-relay.test.mjs`: 401 → 상태 needs-key, 키를 바꾸면 주기와 대기 요청이 다시 돈다.

**우선순위**: 여유 있을 때.

---

## 검토 중 따로 적힌 관찰 (발견 항목 아님, 검증자 판정 없음)

검토자들이 발견으로 올리지 않고 메모로만 남긴 것이다. 줄 번호는 현재 파일에서 확인했지만 동작은 따로 검증하지 않았다.

1. **사용자에게 확인할 정책**: 중계는 관리자 누구의 실시간 수정이든 hint.kpc 이름으로 **사람의 변경 전후 확인 없이** 자동 승인한다(`checkhere-live-relay.mjs:96-98`). 점검은 기준 지문과 `checkLiveEdit`(`checkhere-live-core.mjs:29-33`, `requested:true`)뿐이라, 지각·조퇴·외출과 겹치는지 같은 일반 승인 제한(`canApply`)을 건너뛴다. 운영포털도 같은 `requested:true` 규칙을 쓰지만 거기서는 사람이 승인한다. 핸드오프 때 정한 설계지만 승인 방식이 바뀐 것이므로, 시간 삭제를 실시간 화면에 붙이기 전에 사용자에게 한 번 확인한다.
2. `applying`에서 멈춘 요청은 중계가 보지 않는다(`checkhere-live.mjs:178`은 pending·approved만 구독). ACTIVE라서 그 학생의 수정 버튼이 잠긴 채로 남고, 수집 PC의 운영포털 '반영 요청·승인'에서 '반영 결과 확인' 버튼(`/api/reconcile`)을 눌러야 풀린다.
3. /beta2에서 승인·반영을 하면 연결 프로그램이 hint.kpc 토큰으로 REST를 통해 `checkhereCurrent`를 쓴다(`checkhere/cloud-approval.mjs:40-44`). 브라우저 쪽 /beta2 저장 가드를 거치지 않는다. 핸드오프 전부터 있던 동작이다.
4. 일괄 수집의 두 번째 시도(`server.mjs:135`)가 `j.count`·`j.skipped`·`j.errors`를 다시 더해서 요약 문구(`:138`)의 숫자가 부풀려진다. 날짜별 결과(`results`)는 맞다.
5. 정밀 수집은 모든 기록에 새 `collectedAt`을 붙이는데 저장 비교(`containsSavedRecords`, `checkhere-current-core.mjs:14-16`)는 `collectedAt`까지 보므로 수집한 날을 모두 다시 쓴다. 17반 전체 기간이면 쓰기 약 1,000건. 설계대로지만 정밀 수집을 자주 돌리지 않는다.
6. **확인 안 된 의심**: `tableSignature`에 외출 칸 글자('N분 (횟수)', `collector.mjs:134`)가 들어간다(`version`에는 없음). 외출 중에 분이 늘어 보이면 그 학생은 10분마다 수정창으로 다시 읽히고 다시 저장될 수 있다. 외출 중인 학생이 있을 때 진단으로 확인한다(결과의 이름·전화번호는 가림).
7. `/api/probe` 작업의 `report`에 PC의 절대 경로(Windows 사용자 이름 포함)가 들어가고(`server.mjs:157`), 연결 키를 가진 HTTPS 화면이 `/api/state`로 볼 수 있다.
8. 중계의 필수 능력 목록(`checkhere-live-relay.mjs:18`)에 `page-data-v1`이 없어, 옛 연결 프로그램(20261012대 build)에서는 화면 데이터 없이 돈다.
9. `Start.ps1:12`는 build가 다를 때 `state?delta=1`을 cursor 없이 불러 모든 기록을 받는다(그래서 90초 제한). `busy`만 필요하다.
10. 운영포털 체크히어 탭이 같은 PC에 열려 있으면 중계가 만든 sync 작업 결과도 자동 저장한다(`checkhere-ui.mjs:101-103`). 대개 이미 저장돼 있어 날마다 읽기 1건이지만, 12번의 대기 문제를 키운다.
11. 중계는 오늘 날짜만 저장한다. 지난 날짜를 체크히어에서 고친 것은 일괄 수집과 운영포털의 자동·수동 저장으로만 `checkhereCurrent`에 올라간다(그래서 5번이 중요하다).

---

## 기각된 항목

11건 모두 검증자 2명이 따로 반박했다. 고칠 필요는 없고, '선택'이라고 적은 것만 여유 있을 때 한다.

| id | 내용 | 기각 이유 |
|---|---|---|
| live#3 | 자동 갱신이 합의한 10분이 아니라 5분 | eccaa18에서 이미 10분으로 고침(`checkhere-live-core.mjs:9-10`, `checkhere-live.mjs:142`, `docs/checkhere-live-beta.md:13`). 주기 연속 실행도 빠른 수집이면 몇 분 안에 끝나 생기기 어렵다. 주기 끝에 최소 쉬는 시간을 두는 건 선택. |
| realtime#1 | /beta2 출결대조가 시트를 다시 읽으면 체크히어 실시간 갱신이 멈춤 | eccaa18에서 이미 고침. 체크히어 구독 전용 번호 `chSeq`(`beta2-ledger.mjs:17`, `:85`, `:90`)와 회귀 시험(`checkhere/tests/beta2-ui.test.mjs:236`). |
| bridge#4 | 대체 읽기 날 메모만 고친 기록을 못 가져옴 | 문서화된 설계(`docs/checkhere-batch-collect.md:7-8`, 메모만 고쳤으면 정밀 수집). 대체 읽기는 실행마다 다시 정해지고 다음 화면 데이터 실행에서 메모 변경을 잡는다(`page-data.test.mjs`의 메모만 바뀐 경우 시험). 남는 문구 문제는 17번. |
| bridge#7 | 진단 discover 시간 초과 뒤에도 크롬을 계속 조작 | `/api/probe`는 손으로 돌리는 `checkhere/probe-run.ps1`만 부른다. 기본값(2반 9/3)은 페이지 넘기기가 없고, 모든 대기에 12~15초 제한이 있어 180초를 넘기 전에 대개 오류로 멈춘다. 원하면 시간 초과 때 discover가 끝날 때까지 기다린 뒤 잠금을 풀기(선택). |
| live#6 | 10-22 이후 멈춤 조건이 없어 저장이 계속 거부됨 | 10-23부터는 1기 강의에 그날이 없어 '강의 없음'으로 그날 제외되고(`checkhere-live-relay.mjs:52`, `:58`) 저장까지 가지 않는다. 2기 사용은 사용자 결정으로 미뤄져 있다(`docs/checkhere-live-beta.md:26`). |
| live#7 | 재시작 뒤 키가 바뀌면 자동 갱신이 조용히 멈춤 | 빨간 오류 줄('이 PC의 연결 키를 입력해 주세요.')로 보이고, 재부팅이면 중계 탭도 닫혀 어차피 다시 시작하며, 같은 빌드로 cmd를 다시 실행하면 키가 그대로다. 같은 주제를 다룬 21번(이견)에서 화면 개선만 한다. 키를 주소(`#k=`)에 넣자는 제안은 브라우저 기록에 남아 쓰지 않는다. |
| realtime#4 | 계속 실패하는 저장(10-22 이후 날짜)을 간격 없이 재시도 | 일괄 수집은 `collectionDates`(`attendance-beta-core.mjs:85`)가 10-22 이후를 막고, 중계는 '강의 없음'으로 저장 전에 멈춘다. 간격도 5분이 아니라 10분. 남는 /beta2 무한 재시도는 2번. |
| realtime#6 | 바뀐 게 없는 일괄 수집 날짜도 서버 읽기 1건 | 문서화된 설계(`docs/checkhere-batch-collect.md:9`, 같으면 읽기 1건·쓰기 없음). 그 읽기가 다른 브라우저·PC 저장분을 확인한다. 10분 자동 갱신은 중계라 바뀐 게 없으면 읽기 0건(`checkhere-live-relay.mjs:45-46`). |
| realtime#9 | 요청 화면의 '해당 날짜 수집'이 정밀 읽기로 문서 전체를 다시 씀 | 핸드오프 전부터 있던 코드(`checkhere-requests.mjs:63`). 지정 관리자가 손으로 누르는 드문 동작이고, 실제 시간은 반·날짜당 약 9초(36초 아님). 메모만 고친 경우까지 보려면 정밀 읽기가 맞다. |
| realtime#10 | 연결 프로그램 jobs 표가 끝없이 커짐 | 핸드오프 전부터 있던 것(`server.mjs:39`, `:78`). 1기 남은 기간 작업량은 작은 sync 작업 수천 건이라 느려지지 않는다. 2기까지 중계를 계속 돌린다면 정리 고려. 정리할 때 'apply' 작업은 남겨야 한다(`server.mjs:174`, `:203-208`이 approvalId로 찾음). |
| ui#8 | 일괄 수집별 localStorage 키가 안 지워져 용량이 참 | 10분 자동 갱신은 중계의 sync라 이 키를 만들지 않는다. 키는 손으로 시작한 일괄 수집만 만들고, 날짜 범위가 10-22까지라 용량이 찰 수 없다. 오래된 `checkhere.batchSaved.*` 정리는 선택. |
