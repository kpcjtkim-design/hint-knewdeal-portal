# 체크히어 시간 삭제 Firestore 규칙 초안 — 게시 안내 (2026-10-14)

2기 베타 시간 삭제(설계 `docs/beta2-instant-edit-plan.md` 6장 6단계, 7장 "규칙 초안 내용")에 필요한 규칙을 **별도 초안 파일** `checkhere-time-delete.rules.txt`(저장소 루트)에만 적었다. 저장소의 `firestore.rules`는 바꾸지 않았고, 이 초안은 아직 Firebase에 반영되지 않은 상태다. 반영(게시)은 사용자가 Firebase 콘솔에서 직접 한다.

초안은 조각이 아니라 **통째 사본**이다. 지금 `firestore.rules` 전체에 아래 "고치는 네 부분"과 추가 함수만 더했으므로 콘솔 편집기에 그대로 붙여 넣을 수 있다(기존 `learning-beta.rules.txt`, `survey-firestore.rules.txt`는 조각 파일이라 다르다).

## 기준

- 기준 커밋: `123e0d3881f3289d7a4e3f7e731efbe430be3d4e` (브랜치 `claude/new-session-810fo5`, 초안을 만들 때의 HEAD)
- 그 커밋의 `firestore.rules`: **214줄**. 이 파일을 마지막으로 바꾼 커밋은 `9f52eb2`(2026-09-15)다.
- 초안 `checkhere-time-delete.rules.txt`: **223줄** = 214줄 + 추가 함수 8줄(주석 1줄 포함) + create 조건 1줄.
- 두 파일이 "네 부분과 추가 함수만" 다른지는 `checkhere/tests/firestore-rules-draft.test.mjs`가 확인한다. 나중에 `firestore.rules`가 바뀌면 이 시험이 실패하므로, 그때는 초안을 새 `firestore.rules`로 다시 만들고 이 문서의 기준 커밋·줄 수도 고친다.

## 게시 안내

1. `firebase deploy`를 실행하지 않는다. (`firebase.json`이 `firestore.rules`를 가리키므로, 실행하면 초안이 아니라 저장소 규칙이 그대로 올라간다.)
2. Firebase 콘솔 → knewdeal-portal → Firestore → 규칙에서 지금 게시본이 저장소 `firestore.rules`(기준 커밋 `123e0d3`, 214줄)와 같은지 먼저 비교한다. 콘솔은 규칙 전체를 바꾸므로, 다르면 멈추고 Claude Code에 보낸다(콘솔 내용을 복사해 붙여 주면 된다).
3. 같으면 초안 파일 전체를 붙여 넣거나 네 부분만 손으로 고친다(아래 "고치는 네 부분").
4. 규칙 플레이그라운드: hint.kpc로 `checkhereRequests/x` 생성, `changes {entry:'',entryMemo:''}`, `deleteTimes ['entry']` → 허용 / 같은 것에서 `deleteTimes` 없음 → 거부 / 담임 계정 + `deleteTimes` → 거부.
   - 인증: Google 로그인, 이메일 확인됨(`email_verified` true).
   - 문서 예(가상 학생): `classId '2'`, `date '2026-10-14'`(규칙 날짜 범위 2026-07-27~2026-10-22 안), `name '가상학생'`, `phoneLast4 '1234'`, `reason '규칙 시험'`, `changes {entry:'', entryMemo:''}`(map), `deleteTimes ['entry']`(array), `createdBy` = 로그인한 이메일, `status 'pending'`, `createdAt`·`updatedAt` = 요청 시각.
   - `createdAt==request.time`·`updatedAt==request.time` 조건을 플레이그라운드에서 맞출 수 없으면 "허용" 경우도 그 줄(초안 47행)에서 거부된다. 그때는 결과 화면이 가리키는 거부 줄이 47행인지, 그리고 `deleteTimes` 관련 줄(초안 37·44·45행)에서 막히지 않았는지를 본다. "거부" 두 경우는 각각 45행(`validRequestChanges`), 44행(`isAdmin()`)에서 막혀야 한다.
   - 담임 경우는 `users`에 TEACHER로 있는 계정을 쓰고 `classId`를 그 담임 반으로 맞춘다(플레이그라운드는 실제 `users` 문서를 읽는다).
   - (선택) 하위 호환: `deleteTimes` 없이 `changes {entry:'09:00:00'}` → 지금처럼 허용.
5. 게시(사용자).
6. 데이터 탭에서 `settings/checkhereFeatures` 문서에 `timeDeleteRules`(boolean) `true`. /beta2는 이 깃발을 읽는다. 2026-10-16부터 중계는 필요 없다(G2 없음): 깃발이 있으면 삭제 조건이 열리고(×는 기록 번호가 있는 칸만), 마지막 중계 신호가 시간 삭제 능력을 모르는 옛 연결 프로그램일 때만 꺼진다(`docs/checkhere-time-delete-enable.md` 0-1절). 체크히어에 시험용 학생이 없고 삭제 요청은 깃발이 켜진 /beta2에서만 만들어지므로, 깃발을 켠 뒤 첫 실제 삭제를 지켜보는 순서는 `docs/checkhere-time-delete-enable.md` 4절을 따른다.

## 고치는 네 부분

줄 번호는 "`firestore.rules`(기준 커밋) → 초안"이다.

**추가 함수** (24행 `validChanges` 끝 바로 뒤, `match /checkhereRequests` 앞 → 초안 25~32행)

```
    // CheckHere time deletion: only sides listed in deleteTimes may be '' (administrators only).
    function hhmmss(v){return v is string && v.matches('([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]');}
    function memoOk(c,k){return !(k in c) || (c[k] is string && c[k].size()<=500);}
    function reqTimeOk(c,d,k){return (!(k in c) && !(k in d)) || ((k in c) && hhmmss(c[k]) && !(k in d)) || ((k in c) && c[k]=='' && (k in d));}
    function deletedMemoBlank(c,d,k,m){return !(k in d) || !(m in c) || c[m]=='';}
    function validRequestChanges(c,d){return c is map && c.keys().size()>0 && c.keys().hasOnly(['entry','exit','entryMemo','exitMemo']) && d is list && d.size()<=2 && d.hasOnly(['entry','exit']) && reqTimeOk(c,d,'entry') && reqTimeOk(c,d,'exit') && memoOk(c,'entryMemo') && memoOk(c,'exitMemo') && deletedMemoBlank(c,d,'entry','entryMemo') && deletedMemoBlank(c,d,'exit','exitMemo');}
    function afterTimeOk(a,d,k){return ((k in d) && (k in a) && a[k]=='') || (!(k in d) && (!(k in a) || hhmmss(a[k])));}
    function validAfter(a,d){return a is map && a.keys().size()>0 && a.keys().hasOnly(['entry','exit','entryMemo','exitMemo']) && d is list && afterTimeOk(a,d,'entry') && afterTimeOk(a,d,'exit') && memoOk(a,'entryMemo') && memoOk(a,'exitMemo');}
```

1. **create 허용 키** (29행 → 37행): 목록의 `'changes',` 뒤에 `'deleteTimes',`를 넣는다.
   ```
           && request.resource.data.keys().hasOnly(['classId','date','name','phoneLast4','reason','changes','deleteTimes','createdBy','createdAt','updatedAt','status'])
   ```
2. **create 관리자 조건** (새 줄 → 초안 44행, 3번 줄 바로 위):
   ```
           && (!('deleteTimes' in request.resource.data) || (isAdmin() && request.resource.data.deleteTimes is list && request.resource.data.deleteTimes.size()>0))
   ```
3. **create 변경 검사** (36행 → 45행):
   ```
           && validRequestChanges(request.resource.data.changes, request.resource.data.get('deleteTimes',[]))
   ```
   (원래: `&& validChanges(request.resource.data.changes)`. 156행 `checkhereProposalSources`에도 같은 글이 있으니 그쪽은 고치지 않는다.)
4. **승인 분기** (47행 → 56행):
   ```
             && validAfter(request.resource.data.approval.after, resource.data.get('deleteTimes',[])))
   ```
   (원래: `&& validChanges(request.resource.data.approval.after))`. 끝 괄호 세 개는 `get`, `validAfter`, 승인 분기를 닫는다.)

## 그대로 두는 것

- `validChanges` 함수, `checkhereProposalSources`(초안 165행)의 `validChanges`.
- `checkhereRequests`의 read, 반려·applying·결과 분기, 작성자 취소(withdrawn), delete 금지.
- 날짜 범위 2026-07-27~2026-10-22(요청 생성, `checkhereCurrent`). 다른 컬렉션 규칙 전부.
- `deleteTimes`가 없는 요청은 지금과 똑같이 평가된다(하위 호환). 담임 요청 폼이 만드는 지정되지 않은 `''`는 계속 거부된다.

## 초안이 허용하는 삭제 요청 모양

- `deleteTimes`: 관리자만, 비어 있지 않은 list, 2개 이하, `'entry'`·`'exit'`만.
- 지정한 쪽은 `changes`에 `''`가 있어야 한다. 지정하지 않은 쪽의 `''`는 거부.
- 지운 쪽 메모는 없어도, `''`여도 통과한다(`deletedMemoBlank`). 다른 글자가 있으면 거부.
- 승인 값(`approval.after`): 지운 쪽은 `''`로 남아 있어야 하고, 나머지 시간은 지금처럼 `HH:MM:SS`.
- 규칙은 중복(`['entry','entry']`)을 따로 막지 않는다. 지정한 쪽이 `''`여야 하는 조건은 그대로라 더 지울 수 있는 것은 없고, 중복 거절은 `cleanRequest`(3단계)가 맡는다.

## Vercel 정적 파일

- 저장소 루트의 `.rules.txt` 파일은 `.vercelignore`에 없어 Vercel 정적 파일로도 올라간다(기존 `learning-beta.rules.txt`, `survey-firestore.rules.txt`, `firestore.rules`도 같다). 규칙 내용은 비밀이 아니다. 규칙은 서버가 검사하므로 내용을 알아도 우회할 수 없고, 같은 내용이 `firestore.rules`로 이미 올라가 있다.
- 원하면 `.vercelignore`에 `checkhere-time-delete.rules.txt`(또는 `*.rules.txt`) 한 줄을 넣어 뺄 수 있다. 이 작업에서는 `.vercelignore`를 고치지 않았다. 이 안내 문서는 `docs/`가 이미 `.vercelignore`에 있어 올라가지 않는다.

## 시험

- `checkhere` 폴더에서 `node --test tests/firestore-rules-draft.test.mjs`. 에뮬레이터 없이 두 파일의 글자를 비교하고, 추가 함수 글을 JS로 옮겨 가상 값으로 허용·거부를 확인한다(`deleteTimes` 없는 요청은 `validChanges`와 결과가 같음, 위 4번의 플레이그라운드 경우 등).
- 이 시험은 Firestore 규칙 **문법**은 확인하지 못한다. 콘솔 편집기가 게시 전에 문법 오류를 표시하므로 붙여 넣은 뒤 오류 표시가 없는지 보고, 4번 플레이그라운드로 확인한다.
