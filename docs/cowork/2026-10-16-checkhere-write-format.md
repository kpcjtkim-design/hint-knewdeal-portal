# 체크히어 수정 요청 형식 기록 — 2026-10-16 (Claude, 사용자 크롬)

사용자가 로그인·마스킹 해제를 직접 했고, Claude가 같은 탭에서 읽기와 한 건 수정·되돌리기를 했다(사용자 허락: "아무거나 하나 수정해 보고 원래대로 복구"). 이름·전화번호·학번·id·토큰 값은 적지 않았다. 화면 안에 형식만 세는 기록기를 붙여 값은 버렸다.

## 1. 읽기 응답 (2반 2026-09-04, `GET …/api/v3/history/attendee/detail/academy/{academy}/schedule/{id}/type/STUDENT/isRealTime/false`)

| | 해제된 탭 | 새 탭(가림) |
|---|---|---|
| 학생 수 | 25 | 25 |
| 이름·전화 가림 | 0 | 25 |
| attendeeId 있는 학생 | 25 | 25 |
| attendeeId 묶음 지문 | `9d767e6f` | `9d767e6f` (같음) |
| 기록(eventList) 수 | 45 | 45 |
| 관리자 메모 있는 기록 / 가림 | 12 / 0 | 12 / 0 |

- 응답 최상위: `txid, code, message, description, timestamp, data`. 학생 목록은 `data.eventResultList`.
- 학생 항목: `sequence, attendeeId, typeAttendee, name, userName, phone, identifier, eventList, leaveEvents, duration, seconds`.
- 기록 항목: `eventId, userId, time, baseTime, timeIndex, type, isRecognized, status, memoByAdmin, updatedAt`. 이 날 type은 `ENTER, PASS, COMPLETE, ATTEND`.
- 결론: attendeeId는 가림·해제와 상관없이 같다. 시간·관리자 메모는 가린 상태에서도 원문이다.
- 주소로 처음 연 화면의 응답은 확장 프로그램 네트워크 기록에 잡히지 않았다. 화면 안 `next.router.push`로 날짜를 바꿀 때의 응답만 잡혔다(연결 프로그램은 Playwright 응답 수신이라 영향 없음).

## 2. 수정 요청 (퇴실 1초 바꿈 → 원래 값으로 되돌림, 두 번 모두 200)

- `PUT https://checkhere-admin-api.ihereapp.com/api/v3/history/event/update`
- 본문 항목·형: `scheduleId:string, typeEvent:string('COMPLETE'), attendeeId:string, time:string('YYYY-MM-DDTHH:MM:SS'), baseTime:string('YYYY-MM-DDTHH:MM:SS'), existEventId:string(있음), memoByAdmin:null(메모 없음)`
- 요청 헤더 이름: `accept, authorization, content-type, x-privacy-browser-session, x-privacy-unmask-session`
  - `x-privacy-browser-session` 값은 그 탭의 sessionStorage `checkhere.privacy.browser-session`에 있다(탭마다 다름 → 해제가 그 탭에만 걸리는 이유).
  - `x-privacy-unmask-session`은 해제 뒤 화면이 붙인다(값 저장 위치는 보지 않음).
  - 순차 쓰기는 해제된 그 탭 안에서 화면과 같은 헤더를 붙여 보내야 한다. 값은 탭 밖으로 꺼내거나 저장하지 않는다.
- 응답 최상위: `txid, code, message, description, timestamp, data`.
- 저장 확인창(브라우저 알림)은 이번에는 뜨지 않았다.
- 수정창에 「메모 마지막 업데이트 시간」 줄이 새로 보였다(관리자 수정 기록).

## 2-1. 삭제 요청 (관리자 1교시 삭제, 사용자가 직접 「삭제」를 누름)

- 대상: 2반 9/4 순번 8. 화면 데이터(새로 받은 9/4 응답)로 확인: ENTER(번호 없음, 계산값), ATTEND(번호 있음, 메모 있음), COMPLETE(번호 있음, 메모 있음) → 체크인 없이 관리자가 넣은 학생.
- `DELETE https://checkhere-admin-api.ihereapp.com/api/v3/history/event/delete`
- 본문 항목·형: `scheduleId:string, typeEvent:string('ATTEND'), attendeeId:string, baseTime:string('YYYY-MM-DDTHH:MM:SS'), existEventId:string(있음)` (time·memoByAdmin 없음)
- 요청 헤더 이름: 수정과 같음(`x-privacy-browser-session`, `x-privacy-unmask-session` 포함)
- 확인창 없이 바로 지워짐.
- **결과: 깔끔히 비지 않음.**

| | 삭제 전 | 삭제 후 |
|---|---|---|
| 입실 | 09:00:00 | 18:00:00 |
| 1교시 | 09:00:00(관리자, 메모) | 18:00:00 |
| 퇴실 | 18:00:00(메모) | 18:00:00(메모) |
| 총 강의 참여 시간 | 9시간 0분 | 0분 |

- 해석: 체크인 기록이 없는 학생은 입실·1교시를 남은 기록 가운데 가장 이른 것(여기서는 퇴실 18:00)으로 다시 계산한다. 그래서 1교시만 지우면 남는다. 결석처럼 다 비우려면 퇴실과 관리자 1교시를 함께 지워야 한다.
- 1교시는 원래 값(`09:00:00`, 메모 원문)으로 되돌린 뒤 다음 시험을 했다.

## 2-2. 퇴실만 삭제 (같은 학생, 권한 모드를 '매번 확인'으로 바꾼 뒤 Claude가 「삭제」)

- `DELETE …/history/event/delete`, 본문 `typeEvent:'COMPLETE'`, 나머지 항목은 2-1과 같음.
- 지우기 전 퇴실 수정창 값(되돌리기용): 시간 `18:00:00`, 관리자 메모 있음(원문은 화면 안에만 보관).

| | 삭제 전 | 삭제 후 |
|---|---|---|
| 입실 | 09:00:00 | 09:00:00 |
| 1교시 | 09:00:00(관리자, 메모) | 09:00:00(관리자, 메모) |
| 퇴실 | 18:00:00(메모) | - |
| 총 강의 참여 시간 | 9시간 0분 | - |

- 해석: 퇴실만 지우면 입실·1교시가 그대로 남는다(체크인 없는 학생이라도 관리자 1교시가 입실 계산의 근거가 됨).
- 이어서 사용자가 남은 관리자 1교시를 수정창 「삭제」로 지움 → 1교시·퇴실·총 시간 '-', **입실 09:00은 남음**. 읽어 보니 남은 것은 `ENTER`(번호 있음, 1교시 메모가 붙음) 하나였다. 체크인 기록이 없는 다른 관리자 입력 학생(순번 11·13·18)의 입실은 번호 없는 계산값(`ENTER` 번호 없음 + `ATTEND#m` + `COMPLETE#m`)이라, 이 입실 기록은 앞선 지우기·되돌리기에서 생긴 것으로 보인다.
- 사용자 결정(2026-10-16): **입실은 남아도 된다. 1교시(09:00~18:00 칸)와 퇴실 두 칸만 깔끔히 비면 된다.**

## 2-3. 두 칸 삭제 — 직접 요청 스크립트 (사용자가 해제된 탭 콘솔에서 실행)

Claude 세션의 탭 안 요청은 안전 검사가 인증 헤더 처리로 보고 막아서, 사용자가 콘솔 스크립트(`scratchpad/clean-delete-test.js`, 순번 8 한 명 전용)를 붙여 넣어 실행했다. 화면이 스스로 보내는 요청(「실제 시간 기반」↔「허용 시간 기반」 전환)에서 헤더를 탭 안에서만 잡아 같은 헤더로 보냈다(값은 출력하지 않음). 헤더 이름: `authorization, x-privacy-browser-session, x-privacy-unmask-session` — 읽기(GET)에도 해제 헤더가 붙는다.

| 단계 | 요청 | 다시 읽은 기록 |
|---|---|---|
| 시작 | — | `ENTER#m 09:00 / ATTEND#m 09:00 / COMPLETE#m 18:00` |
| 퇴실 삭제 | `DELETE` `COMPLETE` + 번호 | `ENTER#m 09:00 / ATTEND#m 09:00` |
| 1교시 삭제 | `DELETE` `ATTEND` + 번호 | `ENTER#m 09:00` → **1교시·퇴실 두 칸 비움, 입실만 남음** |
| 1교시 되돌림 | `PUT update` `ATTEND`, `existEventId:null`, 09:00 + 원래 메모 | `ENTER#m / ATTEND#m 09:00` |
| 퇴실 되돌림 | `PUT update` `COMPLETE`, `existEventId:null`, 18:00 + 원래 메모 | `ENTER#m / ATTEND#m 09:00 / COMPLETE#m 18:00` (원래 시간·메모) |

- 모든 요청 200·`code 0000`. 요청 사이 0.7초, 매 요청 뒤 다시 읽어 확인. 전체 약 10초.
- **결론(운영포털 삭제 규칙):** 두 칸을 비우려면 **퇴실 먼저 → 다시 읽기 → 1교시가 번호 있는 관리자 기록(`ATTEND`)으로 남았으면 지움 → 다시 읽어 두 칸 확인**. 1교시를 먼저 지우면 체크히어가 남은 퇴실로 1교시를 다시 채운다(2-1). 퇴실이 남아 있는 동안 1교시만 지우는 요청은 받지 않는다.
- 빈 칸에 다시 넣기는 `PUT update` + `existEventId:null`로 된다(2026-10-14 기록과 같음).

## 3. 되돌린 결과

- 2반 9/4 순번 6의 퇴실: 17:50:12 → 17:50:13 → 17:50:12. 표 값은 원래와 같다. 관리자 메모는 건드리지 않았다(빈칸).
- 처음 누른 줄이 잘못돼 다른 학생의 퇴실 수정창(빈칸)이 열렸으나 「취소」로 닫았다(요청 없음).

## 4. 연결 프로그램 반영 (build 20261016.2, 2026-10-16)

- 삭제 순서: 퇴실 먼저 → 다시 읽기 → 1교시가 번호 있는 ATTEND로 남았으면 그 다시 읽은 번호로 삭제 → 다시 읽어 두 칸 확인(`writeback.applyVerified`, 수정창·순차 요청 같음). 덜 지워지면 `partial`, `덜 지워짐: …`(종류·시간만). 퇴실이 남은 채 1교시만 지우는 요청은 누르기 전에 거절(2-1). 남은 입실 기록(`ENTER`, 번호·메모)은 읽기에서 문제로 보지 않음(입실 메모는 화면 어느 칸에도 안 보임).
- 쓰기 관문: 해제·남은 150초 이상일 때만 잡고, 칸마다 쓰기 직전 머리말을 다시 읽어 90초 밑이면 멈춤(`MASKED_*`, 아무것도 누르지 않음). 해제·연장·종료는 사람이 함.
- 순차 쓰기: 2-3의 방법 그대로(화면이 스스로 보내는 관리자 API 요청에서 세 헤더를 탭 안에서만 잡고 같은 헤더로 탭 안에서 보냄). 우리 코드는 헤더 값을 돌려받지 않음 — 돌아오는 것은 있음/없음·상태 번호·code뿐이고 읽거나 저장하지 않음. 다만 Playwright가 화면의 요청·응답 사건(수집기의 응답 감시, 쓰기 확인의 page.route)을 넘기며 요청 머리(헤더 값 포함)가 연결 프로그램 프로세스 메모리를 잠시 지남(우리 코드는 그 헤더를 보지 않음). 헤더를 못 봤으면 「실제 시간 기반」↔「강의 출석/퇴실 허용 시간 기반」 라디오를 한 번 바꿨다 되돌림. 형식은 2·2-1의 키를 내장. 켜기 단계 없음(사람의 해제가 관문), build마다 첫 1건 뒤 「확인했음」(127.0.0.1:8765/writer) 전까지 나머지는 수정창(쓰기 단계까지 간 첫 건은 끝까지 확인되지 않아도 차례를 씀 — 그때 「확인했음」은 다음 1건만 다시 순차로).
- 가짜 체크히어(`checkhere/tests/checkhere-fake.mjs`)가 이 문서의 동작(2-1 다시 채움, 2-2·2-3 두 칸 비움과 남는 입실, 퇴실과 함께 비는 PASS, `existEventId:null` 새로 넣기, 해제 헤더 없는 쓰기 거절)을 흉내 내고 시험은 그것으로만 돕니다(`two-cell-delete.test.mjs`, `event-request.test.mjs`). 실제 체크히어에서 이 build로 반영해 본 기록은 아직 없음.
