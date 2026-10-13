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
      portalRoster: portalRoster
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
function portalRoster(cls) {
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
function setApiKey() {
  const k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', k);
  console.log('API_KEY = ' + k);
}
