/* ---------- 데이터 API (Vercel 운영포털 '2기 베타 담임화면' 전용) ----------
 * 화면 없이 JSON만 주고받습니다. Vercel 서버가 비밀키(API_KEY)로만 호출합니다.
 * 담임은 이 주소를 직접 열지 않으므로 Google 배너·권한 경고를 보지 않습니다.
 * 설치: Code.gs 맨 아래에 붙여 넣고, checkPin_ 안에 아래 한 줄을 추가합니다.
 *   if (!r) throw new Error('없는 반입니다.');
 *   if (__API) return r;          // ← 추가: API 호출은 Vercel이 담임 권한을 이미 확인함
 */
var __API = false;

function doPost(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!key || body.key !== key) return out({ ok: false, error: 'unauthorized' });
    const A = Object.assign({
      portalClasses: portalClasses, portalData: portalData, portalSave: portalSave,
      portalCheck: portalCheck, portalClose: portalClose, portalAddRow: portalAddRow,
      portalUpdateVoc: portalUpdateVoc, portalSaveOfficer: portalSaveOfficer, portalSetStatus: portalSetStatus,
      portalRoster: portalRoster_ // 끝이 '_'인 함수는 google.script.run으로 부를 수 없음(생년월일·성별)
    }, typeof B2_ACTIONS === 'object' ? B2_ACTIONS : {}); // beta2.gs가 있으면 2기 베타 기능도 받습니다.
    const fn = A[body.action];
    if (!fn) return out({ ok: false, error: 'unknown action' });
    __API = true;
    // Vercel이 로그인 확인을 마친 사용자 이메일·역할(beta2.gs 변경이력·서류 신청자에 씀)
    if (typeof __ACTOR !== 'undefined') { __ACTOR = String(body.actor || ''); __ACTOR_ROLE = String(body.role || ''); }
    try { return out({ ok: true, data: fn.apply(null, body.args || []) }); }
    finally { __API = false; if (typeof __ACTOR !== 'undefined') { __ACTOR = ''; __ACTOR_ROLE = ''; } }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

// 출결 업로드 파일용: 한 반의 명부(이름·상태·생년월일·성별). Vercel이 관리자 요청만 넘깁니다.
// 끝이 '_'라 doPost(API 키 확인)로만 부릅니다. 예전 이름(portalRoster)은 담임 포털 화면에서 google.script.run으로 PIN 없이 불렸습니다(2026-10-15).
function portalRoster_(cls) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('명부');
  if (!sh) throw new Error('명부 탭이 없습니다.');
  const v = sh.getDataRange().getValues(), h = v[0].map(String);
  const at = name => h.indexOf(name), c = at('반'), n = at('이름'), st = at('상태'), b = at('생년월일'), g = at('성별');
  if (c < 0 || n < 0 || b < 0 || g < 0) throw new Error('명부에 반·이름·생년월일·성별 칸이 필요합니다.');
  const day = x => x instanceof Date ? Utilities.formatDate(x, 'Asia/Seoul', 'yyyy-MM-dd') : String(x || '').trim();
  return v.slice(1).filter(r => String(r[c]) === String(cls) && String(r[n]).trim())
    .map(r => ({ name: String(r[n]).trim(), status: st < 0 ? '' : String(r[st] || ''), birth: day(r[b]), gender: String(r[g] || '').trim() }));
}

// 편집기에서 한 번 실행하면 API_KEY를 새로 만들고 실행 로그에 보여 줍니다. Vercel 환경변수 HINT_SHEET_API_KEY에 넣으세요.
// 편집기에서만 돕니다(웹 앱 방문자가 키를 바꿔 Vercel 연결을 끊지 못하게).
function setApiKey() {
  editorOnly_();
  const k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', k);
  console.log('API_KEY = ' + k);
}

// 편집기·시트 메뉴·패널에서만 부르는 함수의 첫 줄(beta2.gs b2EditorOnly_와 같은 판단).
// 같은 프로젝트의 웹 앱(doGet 담임 포털·데이터 API, 둘 다 '나로 실행')이 연 화면에서는 끝이 '_'가 아닌 모든 함수를 누구나 google.script.run으로 부를 수 있습니다.
// 웹 앱은 소유자 계정으로 실행되고 방문자 이메일은 빈 칸이거나 다른 계정이라, 부른 사람과 실행 계정이 같을 때만 진행합니다. 이미 쓰는 이메일 권한이라 새 승인은 없습니다.
function editorOnly_() {
  let who = ''; try { who = Session.getActiveUser().getEmail(); } catch (e) { }
  if (!who || who !== Session.getEffectiveUser().getEmail()) throw new Error('편집기·시트 메뉴에서만 쓸 수 있습니다(웹 앱으로는 부를 수 없음).');
}
