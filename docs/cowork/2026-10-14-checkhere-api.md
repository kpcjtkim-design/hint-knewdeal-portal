# 체크히어 요청 형식·트리거 상태 확인 — 2026-10-14 (Cowork)

학생 이름·전화번호는 모두 가렸습니다(홍길동·0000). 토큰·쿠키·인증 헤더의 값은 보지도 적지도 않았습니다.
체크히어 주소를 콘솔에서 직접 부르지 않았습니다.
- 코드: 화면이 이미 받아 둔 정적 JS 파일(`/_next/static/chunks/*.js`)을 읽음. Sources에서 보는 것과 같은 내용
- 응답 모양: 화면이 스스로 부른 요청의 응답을 잠깐 감싼 fetch로 엿봄(표시 방식 라디오를 바꾸면 화면이 다시 부름). 끝난 뒤 새로고침해서 감싼 코드를 없앰

## 요약
- **삭제·변경·새로 넣기는 모두 같은 형태의 요청**
  - `history/event/delete`(DELETE)와 `history/event/update`(PUT) 두 가지
  - 본문 공통 항목: `scheduleId, typeEvent, attendeeId, baseTime, existEventId`
  - update에만 있는 항목: `time`(`YYYY-MM-DDTHH:MM:SS`), `memoByAdmin`
  - **빈 칸에 새로 넣을 때도 update**를 쓰고 `existEventId: null`을 보냄. create 경로는 없음
- **인증:** `Authorization: Bearer <session.accessToken>`
  - 값은 NextAuth `getSession()`(= `GET check.ihereapp.com/api/auth/session`)의 `accessToken`
  - 그 밖의 헤더 이름: `Content-Type: application/json`
- **[2] 실제 요청 시험:** 코드만으로 본문 모양이 확실해서 하지 않음
- **[3] 1교시 삭제 시험:** 사용자 결정으로 하지 않음(아래 '[3] 보류 이유')
- **[4] 트리거:** 어제 17:30 이후 b2SyncTick 44번
  - 시간 초과 2번, 실패 1번(Spreadsheets 접근 오류)
  - 실행 시간 합계 약 2,230초(≈37분)
  - onOpen 시간 초과 0번

---

## [1] 요청 형식 (코드 기준)

### 어디에 있나
- API 함수: 웹팩 모듈 `33325` (청크 `5145-1e8da9645216cdd4.js`)
  ```
  HR(update): (0,c.WY)({path:"history/event/update",    method:"PUT",    body:e})
  fe(delete): (0,c.WY)({path:"history/event/delete",    method:"DELETE", body:e})
  Ny:         (0,c.WY)({path:"history/event/normalize", method:"PUT",    body:e})   // '강의시간 출석 정상처리'로 보임
  iv:         (0,c.WY)({path:"history/leave/recognize", method:"PATCH",  body:e})   // 외출 인정/철회로 보임
  zQ:         GET history/attendee/detail/academy/{academyId}/schedule/{scheduleId}/type/{STUDENT}/isRealTime/{true|false}
  mt:         GET history/attend/detail/lecture/academy/{academyId}/schedule/{scheduleId}
  lF:         GET history/attend/times/academy/{academyId}/lecture/{lectureId}/date/{date}
  rT:         GET schedule/list/lecture/{lectureId}/start/{timeStart}/end/{timeEnd}
  ```
- 수정창 `UpdateEventModal`(청크 `7488-d347c985d97ce74a.js`)
  - 위 함수를 react-query `useMutation`으로 감싼 `ee`(update)·`Ev`(delete)를 씀(모듈 `49171`)

### history/event/delete — `DELETE https://checkhere-admin-api.ihereapp.com/api/v3/history/event/delete`
```
{
  scheduleId:  URL 쿼리의 scheduleId,
  typeEvent:   "ATTEND"(교시 칸) | "COMPLETE"(퇴실 칸),
  attendeeId:  학생 행의 attendeeId,
  baseTime:    COMPLETE면 교시 시간표 마지막 칸의 timeEnd, ATTEND면 해당 교시(timeIndex, 없으면 0)의 timeStart,
  existEventId: COMPLETE면 eventList 중 첫 COMPLETE의 eventId,
                ATTEND면 eventList 중 type==="ATTEND" && timeIndex===교시번호 인 것의 eventId (없으면 null)
}
```
- `삭제` 버튼은 칸 값이 `-`가 아닐 때만 보임
- 성공하면 토스트 「시간이 삭제되었습니다.」를 띄우고 출결상세를 다시 불러옴. 확인창은 없음
- 어제 실제로 누른 결과: 200. 퇴실을 지우자 1교시·총 참여 시간도 `-`가 됨

### history/event/update — `PUT https://checkhere-admin-api.ihereapp.com/api/v3/history/event/update`
```
{
  scheduleId, typeEvent, attendeeId, baseTime, existEventId,   // 위 delete와 같은 방식으로 채움
  time:        "{scheduleDate}T{수정 시간}"  예: "2026-10-12T17:50:08"  (수정 시간 칸 = HH:MM:SS 텍스트, maxlength 8)
  memoByAdmin: 관리자 메모 문자열, 비어 있으면 null
}
```
- 수정 시간 칸이 비어 있으면 요청을 보내지 않음. 토스트 「수정할 시간을 입력해주세요.」만 뜸 → **시간을 비워 '변경'하는 방식으로는 지울 수 없음**
- **빈 칸(`-`)에 새로 넣을 때도 같은 update.** 그 종류의 기존 이벤트가 없으므로 `existEventId: null`
  - 빈 칸 수정창의 수정 시간 기본값은 `00:00:00`이고 `삭제` 버튼은 없음
  - 어제 되돌릴 때 실제로 PUT update → 200을 확인함
- 성공 토스트: 「시간이 변경되었습니다.」

### baseTime 값
- 화면 상태 저장소의 `historyLectureDetailTimeSet`(zustand, 모듈 `82801`) 중 교시 `timeStart`/`timeEnd`
- 형식은 출결상세 응답의 `baseTime`과 같은 `YYYY-MM-DDTHH:MM:SS`로 보임
  - 이 반 1교시: `2026-10-12T09:00:00`, 퇴실: `2026-10-12T18:00:00`
- 실제 본문으로 직접 보지는 않음

### 인증·요청 방식 (모듈 `59968`의 `WY`)
- HTTP 라이브러리 ky
  - prefixUrl = `https://checkhere-admin-api.ihereapp.com` + `/api/v3` (모듈 `42139`)
  - timeout 30초, retry 0, cache no-store
- 인증 순서
  1. `secure`(기본 true)일 때 `await getSession()`(next-auth/react → `GET /api/auth/session`)
  2. `session.error === "RefreshTokenError"`면 「세션이 만료되었습니다.」로 실패
  3. `session.accessToken`이 없으면 `/`로 보내고 「인증 정보가 없습니다.」로 실패
- 헤더 이름: `Authorization`(값 = `"Bearer " + session.accessToken`), `Content-Type`(= `application/json`). 본문은 `JSON.stringify(body)`
- 오류 응답 JSON: `{txid, code, message, description, timestamp, data}`. 화면은 `message`를 토스트로 보여 줌

### 출결상세 응답 — `GET …/history/attendee/detail/academy/{academyId}/schedule/{scheduleId}/type/STUDENT/isRealTime/false`
- 맨 위: `txid, code, message, description, timestamp, data`
- `data`: `countMap{ENTER, COMPLETE, ATTEND[]}`, `eventResultList[]`(학생 수만큼), `scheduleDate`
- 학생 한 명(`eventResultList[i]`) 항목
  - `sequence, attendeeId, typeAttendee, name, userName, phone, identifier, duration(ISO, 예 PT9H), seconds`
  - `eventList[]`
  - `leaveEvents{totalLeavedDuration, totalLeavedSeconds, pairs[]}`
- 이벤트(`eventList[j]`) 항목: `eventId(문자열|null), userId, time, baseTime, timeIndex, type, isRecognized, status, memoByAdmin(null|문자열), updatedAt`
  - type 값(이날 1반): `ENTER` 17, `PASS` 16, `COMPLETE` 17, `ATTEND` 1
  - status 값: `NORMAL`, `LATE`(ENTER), `EARLY`(COMPLETE)
- **기록 번호(eventId)가 null인 이벤트 = 다른 기록에서 계산된 값**
  - 체크인한 학생: `ENTER`(번호 있음) + `PASS`(번호 없음, 1교시 칸) + `COMPLETE`(번호 있음)
  - 관리자가 1교시를 넣은 학생(이날 순번 17): `ENTER`(번호 없음) + `ATTEND`(번호 있음, 관리자 메모 있음) + `COMPLETE`
- 가린 예시 — 1반 10/12 순번 2. id는 앞 4자리만 남김
```json
{"sequence":2,"attendeeId":"B21D…","typeAttendee":"STUDENT","name":"홍길동","userName":"(가림)","phone":"0000",
 "identifier":"서울-임베디드 AI (HW)","duration":"PT9H","seconds":32400,
 "leaveEvents":{"totalLeavedDuration":"PT0S","totalLeavedSeconds":0,"pairs":[]},
 "eventList":[
  {"eventId":"401D…","userId":"3B34…","time":"2026-10-12T08:55:31","baseTime":"2026-10-12T09:00:00","timeIndex":0,"type":"ENTER","isRecognized":false,"status":"NORMAL","memoByAdmin":null,"updatedAt":null},
  {"eventId":null,   "userId":"3B34…","time":"2026-10-12T08:55:31","baseTime":"2026-10-12T09:00:00","timeIndex":0,"type":"PASS","isRecognized":false,"status":"NORMAL","memoByAdmin":null,"updatedAt":null},
  {"eventId":"511B…","userId":"3B34…","time":"2026-10-12T17:50:08","baseTime":"2026-10-12T18:00:00","timeIndex":0,"type":"COMPLETE","isRecognized":false,"status":"NORMAL","memoByAdmin":null,"updatedAt":null}]}
```
- 관리자 메모 있는 예(가림): 순번 17 `{"type":"ATTEND","eventId":"83DE…","time":"2026-10-12T08:50:03","baseTime":"2026-10-12T09:00:00","timeIndex":0,"memoByAdmin":"시스템 오류…(22자)","updatedAt":null}`
- 응답에 `updatedAt`이 모두 null이라, 이 값으로는 '관리자가 고친 기록'인지 알 수 없음

## [2] 실제 요청으로 본문 확인 — 하지 않음
- 코드에 본문 모양이 그대로 나와서 '값을 바꾸지 않는 변경' 시험은 하지 않음
- 그래서 실제로 보낸 요청은 없음
- 어제 본 실제 요청: `DELETE …/history/event/delete` 200, `PUT …/history/event/update` 200

## [3] 1교시만 지우기 — 하지 않음 (사용자 결정)
지금 값(10/14 오후 확인, 허용 시간 기반): 입실 08:55:31 · 1교시 08:55:31 · 퇴실 17:50:08 · 외출 0분(-) · 총 9시간 0분, 메모 없음. 바꾸지 않음.

보류 이유
1. 이 학생의 1교시 칸은 `PASS`(eventId null), 곧 입실(ENTER)에서 계산된 값
   - 수정창의 `삭제`는 `typeEvent:"ATTEND"`, **`existEventId: null`**로 요청을 보냄
   - 서버가 이때 무엇을 지울지 코드로는 알 수 없음
   - 만약 실제 입실 기록(ENTER)을 지우면 화면에서 되돌릴 방법이 없음(입실 칸은 수정창이 열리지 않음)
2. 1교시를 다시 넣으면 `ATTEND` 이벤트가 새로 생김
   - 화면 값은 같아 보여도 '관리자가 만든 기록'으로 바뀜(순번 17과 같은 모양)
3. 어제의 퇴실 삭제→되돌리기도 같은 일이 생겼을 가능성이 큼
   - delete로 원래 COMPLETE를 지운 뒤, update(`existEventId: null`)로 새 COMPLETE를 만들었기 때문
   - 지금 COMPLETE의 eventId(`511B…`)가 원래 번호인지는, 원래 번호를 적어 두지 않아서 확인할 수 없음

collector.mjs에 주는 참고
- '지우기'는 그 칸의 기록 번호(eventId)가 있을 때만 안전함(COMPLETE, 관리자 ATTEND)
- 1교시가 `PASS`(번호 없음)인 학생의 1교시 지우기는 따로 막거나, 서버 동작을 운영사에 확인한 뒤 쓰는 게 안전함

## [4] 마스터시트 트리거 (어제 17:30 이후 ~ 오늘 15:30, 읽기만)
- **b2SyncTick: 44번** (30분 간격, :21·:51)
  - 시간 초과 **2번**: 10/14 11:51(361초), 15:21(361초)
  - 실패 **1번**: 10/14 13:51(36초) — 아래 '그 밖의 실패' 참고
  - **실행 시간 합계 약 2,230초(≈37분)**
  - 일과 중(10/14 08:51~15:21) 14번 ≈ 2,000초. 밤(18:51~08:21)은 1~4초씩(운영총괄이 바뀌지 않아 바로 끝남)
- 실행별 걸린 시간 (⏱ = 시간 초과, ✗ = 실패)
  - 10/13: 17:51 133초, 18:21 40초, 18:51 3초, 19:21 1초, 19:51 2초, 20:21 1초, 20:51 2초, 21:21 2초, 21:51 2초, 22:21 4초, 22:51 2초, 23:21 2초, 23:51 3초
  - 10/14 새벽: 00:21 3초, 00:51 1초, 01:21 2초, 01:51 1초, 02:21 1초, 02:51 2초, 03:21 1초, 03:51 2초, 04:21 2초, 04:51 2초, 05:21 2초, 05:51 1초, 06:21 2초, 06:51 4초, 07:21 2초, 07:51 1초, 08:21 2초
  - 10/14 일과: 08:51 64초, 09:21 65초, 09:51 112초, 10:21 66초, 10:51 242초, 11:21 99초, **11:51 361초⏱**, 12:21 139초, 12:51 62초, 13:21 184초, **13:51 36초✗**, 14:21 85초, 14:51 126초, **15:21 361초⏱**
- **onOpen 시간 초과: 0번**. 이 기간 onOpen은 1번(10/14 13:38, 27.8초 완료) — 30초 한도에 거의 닿음
- **그 밖의 실패**
  - `b2SyncTick` 10/14 13:51:44(36.4초) 실패
    - 오류: `Exception: Service Spreadsheets failed while accessing document with id 1KyY…(마스터시트, 가림).`
    - 위치: `at b2WriteLedger_(beta2:378:35)` ← `b2SyncRun_(beta2:523:16)` ← `b2SyncTick(beta2:576:9)`
    - 같은 시각 13:50~13:52에 웹앱 doPost 7번과 onEdit 1번이 함께 돌고 있었음
  - 그 밖의 doPost 13번과 onEdit 1번은 모두 완료됨
- 바꾼 것 없음
