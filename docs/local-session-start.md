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
2. **Cowork 보고 확인**: Drive 폴더 `HINT Claude Code 전달`의 `checkhere-delete-report.md`, 백업 파일(이 PC Downloads의 `master-backup-20261013_*`). 아직 없으면 3·4를 먼저 한다.
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
