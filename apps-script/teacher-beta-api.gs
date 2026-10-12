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
    const A = {
      portalClasses: portalClasses, portalData: portalData, portalSave: portalSave,
      portalCheck: portalCheck, portalClose: portalClose, portalAddRow: portalAddRow,
      portalUpdateVoc: portalUpdateVoc, portalSaveOfficer: portalSaveOfficer, portalSetStatus: portalSetStatus
    };
    const fn = A[body.action];
    if (!fn) return out({ ok: false, error: 'unknown action' });
    __API = true;
    try { return out({ ok: true, data: fn.apply(null, body.args || []) }); }
    finally { __API = false; }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

// 편집기에서 한 번 실행하면 API_KEY를 새로 만들고 실행 로그에 보여 줍니다. Vercel 환경변수 HINT_SHEET_API_KEY에 넣으세요.
function setApiKey() {
  const k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', k);
  console.log('API_KEY = ' + k);
}
