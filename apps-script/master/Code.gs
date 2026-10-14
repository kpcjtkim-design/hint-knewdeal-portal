/**
 * HINT 2기 마스터시트 · 출결 입력 (v2)
 * - 반별 출결판 칸에서 드롭다운으로 고르면 바로 원장에 반영
 * - 사유·시간은 오른쪽 패널에서 선택 입력 (필수 아님, 자동 저장)
 */

const CFG = {
  LEDGER: '출결원장', LOG: '변경이력', DAYS: '교육일자', ROSTER: '명부', INFO: '반정보',
  HDR_ROW: 16, FIRST_ROW: 17, LAST_ROW: 48, FIRST_COL: 5, MAX_DAYS: 59,
  HQ_EMAILS: ['hint.kpc@gmail.com'],
  TYPES: ['지각', '조퇴', '외출', '결석', '인정출석', '인정지각', '인정조퇴', '인정외출'],
  BOARD_LIST: ['해당없음', '출석', '지각', '조퇴', '외출', '결석', '인정출석', '인정지각', '인정조퇴', '인정외출']
};
// 원장 열: A일자 B반 C이름 D유형 E입실 F퇴실 G외출시작 H외출종료 I사유 J증빙 K반려사유

/* ---------- 메뉴 · 열기 ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('HINT')
    .addItem('출결 입력 패널 열기', 'openPanel')
    .addItem('출결판 새로고침', 'rebuildAll')
    .addItem('담임 포털 열기 (외부 접속 링크)', 'openPortal')
    .addSeparator()
    .addItem('홈으로 이동', 'goHome')
    .addItem('출결원장으로 이동', 'goLedger')
    .addToUi();
  // 열 때는 출결판을 다시 그리지 않습니다. 17개 반을 그리면 단순 트리거 한도(30초)에 걸립니다(2026-10-14).
  // beta2 동기화가 바뀐 반과 날이 바뀐 첫 실행에 모든 반을 그립니다. 바로 보려면 메뉴 'HINT > 출결판 새로고침'.
}

function openPanel() {
  // 넓은 떠 있는 창. 열어 둔 채로 시트 칸을 계속 누를 수 있습니다.
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setWidth(460).setHeight(640);
  SpreadsheetApp.getUi().showModelessDialog(html, '출결 입력');
}

function openPortal() {
  const url = ScriptApp.getService().getUrl() || '';
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5">' +
    '<p style="margin:0 0 8px">담임은 아래 주소로 시트 없이 접속합니다. 반을 고르고 PIN을 넣으면 됩니다.</p>' +
    '<input id="u" readonly value="' + url + '" style="width:100%;padding:6px;font-size:12px" onclick="this.select()">' +
    '<p style="margin:10px 0 0"><a href="' + url + '" target="_blank" style="background:#073763;color:#fff;padding:7px 12px;border-radius:4px;text-decoration:none">새 창에서 열기</a></p>' +
    '</div>').setWidth(480).setHeight(170);
  SpreadsheetApp.getUi().showModalDialog(html, '담임 포털');
}

function goHome() { SpreadsheetApp.getActive().getSheetByName('홈').activate(); }
function goLedger() { SpreadsheetApp.getActive().getSheetByName(CFG.LEDGER).activate(); }

/* ---------- 출결판 다시 그리기 ---------- */

function rebuildAll() { rebuildBoards_(null); }

// classes: 다시 그릴 반 번호 목록(null이면 모두). 읽기(탭 찾기·색 규칙 확인)를 먼저 모두 하고 쓰기를 몰아서 합니다.
// 읽기와 쓰기가 섞이면 반마다 시트가 다시 계산되어 느려집니다.
function rebuildBoards_(classes) {
  const ss = SpreadsheetApp.getActive();
  const base = loadBase_(), boards = [];
  ss.getSheets().forEach(sh => {
    const n = boardNo_(sh);
    if (n && (!classes || classes.indexOf(n) >= 0)) boards.push({ sh: sh, n: n, rules: sh.getConditionalFormatRules() });
  });
  boards.forEach(b => rebuildBoard_(b.sh, b.n, base, b.rules));
}

function loadBase_() {
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const daysSh = ss.getSheetByName(CFG.DAYS);
  const mainDay = fmtDate_(daysSh.getRange('D5').getValue(), tz);
  const days = daysSh.getRange('A2:A100').getValues().flat().filter(x => x instanceof Date).map(x => fmtDate_(x, tz))
    .filter(d => d <= mainDay).sort().reverse().slice(0, CFG.MAX_DAYS);
  const roster = ss.getSheetByName(CFG.ROSTER).getRange('A2:E800').getValues().filter(r => r[1] !== '');
  const L = ss.getSheetByName(CFG.LEDGER), last = lastRow_(L);
  const led = {};
  if (last >= 2) L.getRange(2, 1, last - 1, 4).getValues().forEach(v => {
    if (v[0] instanceof Date) led[Number(v[1]) + '|' + String(v[2]).trim() + '|' + fmtDate_(v[0], tz)] = v[3];
  });
  return { tz: tz, mainDay: mainDay, days: days, roster: roster, led: led };
}

function boardNo_(sh) {
  if (sh.getMaxRows() < CFG.LAST_ROW || sh.getMaxColumns() < CFG.FIRST_COL) return 0; // 작은 탭은 출결판이 아님(A16을 읽으면 오류)
  if (sh.getRange('A16').getValue() !== '이름') return 0;
  const n = Number(sh.getRange('D3').getValue());
  return n >= 1 && n <= 17 ? n : 0;
}

// rules: 미리 읽어 둔 조건부 서식(rebuildBoards_). 없으면 여기서 읽습니다.
function rebuildBoard_(sh, cls, base, rules) {
  const tz = base.tz;
  const kids = base.roster.filter(r => Number(r[0]) === cls).slice(0, CFG.LAST_ROW - CFG.FIRST_ROW + 1);
  const rows = CFG.LAST_ROW - CFG.FIRST_ROW + 1, cols = CFG.MAX_DAYS;
  const hdr = [Array.from({ length: cols }, (_, i) => base.days[i] ? parseDate_(base.days[i]) : '')];
  const names = [], grid = [];
  for (let i = 0; i < rows; i++) {
    const k = kids[i];
    names.push([k ? String(k[1]).trim() : '']);
    const line = [];
    for (let j = 0; j < cols; j++) {
      const d = base.days[j];
      if (!k || !d) { line.push(''); continue; }
      const off = k[3] && k[3] !== '재학' && k[4] ? fmtDate_(k[4] instanceof Date ? k[4] : new Date(k[4]), tz) : '';
      if (off && d > off) { line.push(''); continue; }
      line.push(base.led[cls + '|' + String(k[1]).trim() + '|' + d] || '출석');
    }
    grid.push(line);
  }
  sh.getRange(CFG.HDR_ROW, CFG.FIRST_COL, 1, cols).setValues(hdr);
  sh.getRange(CFG.FIRST_ROW, 1, rows, 1).setValues(names);
  const body = sh.getRange(CFG.FIRST_ROW, CFG.FIRST_COL, rows, cols);
  body.setValues(grid);
  body.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CFG.BOARD_LIST, true).setAllowInvalid(true).build());
  ensureColors_(sh, body, rules || sh.getConditionalFormatRules());
}

function ensureColors_(sh, body, rules) {
  const has = rules.some(r => { const c = r.getBooleanCondition(); return c && c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.TEXT_EQUAL_TO && String(c.getCriteriaValues()[0]) === '출석'; });
  if (has) return;
  const mk = () => SpreadsheetApp.newConditionalFormatRule().setRanges([body]);
  const add = [
    mk().whenTextEqualTo('출석').setFontColor('#B0B4B8').build(),
    mk().whenFormulaSatisfied('=OR(E17="지각",E17="조퇴",E17="외출")').setBackground('#FCE8B2').setFontColor('#7A4B00').setBold(true).build(),
    mk().whenTextEqualTo('결석').setBackground('#F4C7C3').setFontColor('#8C1D18').setBold(true).build(),
    mk().whenTextStartsWith('인정').setBackground('#B7E1CD').setFontColor('#0D5C3C').setBold(true).build()
  ];
  sh.setConditionalFormatRules(add.concat(rules));
}

/* ---------- 칸을 직접 고칠 때 (드롭다운) ---------- */

function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), name = sh.getName();
  try {
    if (name === '시간표' || name === CFG.DAYS) { rebuildAll(); return; }
    // 명부·원장은 고친 행의 반만 다시 그립니다(17개 반을 모두 그리면 단순 트리거 30초 한도에 걸릴 수 있음).
    if (name === CFG.ROSTER) { rebuildBoards_(editedClasses_(e.range, 1)); return; }
    if (name === CFG.LEDGER) { touch_(); rebuildBoards_(editedClasses_(e.range, 2)); return; }
    const cls = boardNo_(sh);
    if (!cls) return;
    const r0 = e.range.getRow(), c0 = e.range.getColumn(), nr = e.range.getNumRows(), nc = e.range.getNumColumns();
    if (r0 + nr - 1 < CFG.FIRST_ROW || r0 > CFG.LAST_ROW || c0 + nc - 1 < CFG.FIRST_COL) return;
    const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    const vals = e.range.getValues();
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const row = r0 + i, col = c0 + j;
      if (row < CFG.FIRST_ROW || row > CFG.LAST_ROW || col < CFG.FIRST_COL) continue;
      const stu = String(sh.getRange(row, 1).getValue() || '').trim();
      const d = sh.getRange(CFG.HDR_ROW, col).getValue();
      if (!stu || !(d instanceof Date)) continue;
      const v = String(vals[i][j] || '').trim();
      const date = fmtDate_(d, tz);
      if (!v || v === '출석' || v === '해당없음') removeRow_(cls, stu, date, '드롭다운');
      else if (CFG.TYPES.indexOf(v) >= 0) upsert_({ cls: cls, name: stu, date: date, type: v }, true, '드롭다운');
    }
    touch_();
  } catch (err) { console.log(err); }
}

// 고친 행들의 반 번호(classCol: 반이 적힌 열). 반 칸 자체를 고쳤으면 예전 반을 알 수 없으므로 null(모든 반).
function editedClasses_(range, classCol) {
  const c0 = range.getColumn(), c1 = c0 + range.getNumColumns() - 1, r0 = Math.max(2, range.getRow()), r1 = range.getRow() + range.getNumRows() - 1;
  if (c0 <= classCol && classCol <= c1) return null;
  if (r1 < r0) return [];
  const out = [];
  range.getSheet().getRange(r0, classCol, r1 - r0 + 1, 1).getValues().forEach(x => {
    const n = Number(x[0]);
    if (n >= 1 && n <= 17 && out.indexOf(n) < 0) out.push(n);
  });
  return out;
}

/* ---------- 패널이 부르는 함수 ---------- */

function getSelectionKey() {
  const sh = SpreadsheetApp.getActiveSheet(), r = sh.getActiveRange();
  const rev = PropertiesService.getDocumentProperties().getProperty('rev') || '0';
  return r ? sh.getSheetId() + ':' + r.getRow() + ':' + r.getColumn() + ':' + rev : '';
}

function getContext() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), cell = sh.getActiveCell(), tz = ss.getSpreadsheetTimeZone();
  const base = { role: isHQ_() ? '본사' : '담임', mainDay: fmtDate_(ss.getSheetByName(CFG.DAYS).getRange('D5').getValue(), tz) };
  const cls = boardNo_(sh);
  if (cls) {
    const row = cell.getRow(), col = cell.getColumn();
    if (row < CFG.FIRST_ROW || row > CFG.LAST_ROW) return Object.assign(base, { none: true, hint: '출결판에서 학생 칸을 눌러 주세요.' });
    const stu = String(sh.getRange(row, 1).getValue() || '').trim();
    if (!stu) return Object.assign(base, { none: true, hint: '빈 줄입니다. 명부에 학생을 먼저 등록해 주세요.' });
    const d = sh.getRange(CFG.HDR_ROW, Math.max(col, CFG.FIRST_COL)).getValue();
    if (!(d instanceof Date)) return Object.assign(base, { none: true, hint: '날짜가 없는 열입니다.' });
    return Object.assign(base, ctx_(cls, stu, fmtDate_(d, tz), tz));
  }
  if (sh.getName() === CFG.LEDGER && cell.getRow() >= 2) {
    const v = sh.getRange(cell.getRow(), 1, 1, 3).getValues()[0];
    if (v[0] instanceof Date && v[1] && v[2]) return Object.assign(base, ctx_(Number(v[1]), String(v[2]).trim(), fmtDate_(v[0], tz), tz));
  }
  return Object.assign(base, { none: true, hint: '반별 출결판 탭에서 학생 칸을 눌러 주세요.' });
}

function ctx_(cls, stu, date, tz) {
  const f = findRow_(cls, stu, date, tz), info = classInfo_(cls);
  return { none: false, cls: cls, name: stu, date: date, teacher: info.teacher, record: f ? f.record : null };
}

// 패널 저장: 유형이 '출석'이면 기록 삭제, 아니면 저장. 사유·시간은 선택.
function saveRecord(p) {
  if (!rosterHas_(p.cls, p.name)) return { ok: false, msg: '명부에 없는 학생입니다.' };
  if (!p.type || p.type === '출석') { removeRow_(p.cls, p.name, p.date, '패널'); setCell_(p, '출석'); touch_(); return { ok: true }; }
  if (CFG.TYPES.indexOf(p.type) < 0) return { ok: false, msg: '유형을 골라 주세요.' };
  upsert_(p, false, '패널');
  setCell_(p, p.type);
  touch_();
  return { ok: true, warn: warn_(p) };
}

/* ---------- 원장 쓰기 ---------- */

function upsert_(p, typeOnly, via) {
  const lock = LockService.getDocumentLock(); lock.waitLock(20000); // beta2 동기화가 잠금을 잡고 있을 수 있어 20초까지 기다림(단순 트리거 한도 30초)
  try {
    const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName(CFG.LEDGER);
    const f = findRow_(p.cls, p.name, p.date, tz);
    const old = f ? f.record : { type: '', inT: '', outT: '', oa: '', ob: '', r: '', ev: '', evr: '' };
    const hq = isHQ_();
    const n = typeOnly ? Object.assign({}, old, { type: p.type }) : {
      type: p.type, inT: p.inT || '', outT: p.outT || '', oa: p.oa || '', ob: p.ob || '', r: (p.r || '').trim(),
      ev: hq ? (p.ev || '') : old.ev, evr: hq ? (p.ev === '반려' ? (p.evr || '') : '') : old.evr
    };
    const row = f ? f.row : Math.max(2, lastRow_(sh) + 1);
    sh.getRange(row, 1, 1, 11).setValues([[parseDate_(p.date), p.cls, p.name, n.type, n.inT, n.outT, n.oa, n.ob, n.r, n.ev, n.evr]]);
    log_(p, f ? sum_(old) : '출석', sum_(n), via);
  } finally { lock.releaseLock(); }
}

// 행을 지우면 아래 행 번호가 모두 당겨지므로, beta2 동기화(행 번호로 씀)와 겹치지 않게 문서 잠금 안에서 지웁니다.
function removeRow_(cls, stu, date, via) {
  const lock = LockService.getDocumentLock(); lock.waitLock(20000); // beta2 동기화가 잠금을 잡고 있을 수 있어 20초까지 기다림(단순 트리거 한도 30초)
  try {
    const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
    const f = findRow_(cls, stu, date, tz);
    if (!f) return;
    ss.getSheetByName(CFG.LEDGER).deleteRow(f.row);
    log_({ cls: cls, name: stu, date: date }, sum_(f.record), '출석', via);
  } finally { lock.releaseLock(); }
}

function setCell_(p, value) {
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const sh = ss.getSheets().find(s => boardNo_(s) === Number(p.cls));
  if (!sh) return;
  const names = sh.getRange(CFG.FIRST_ROW, 1, CFG.LAST_ROW - CFG.FIRST_ROW + 1, 1).getValues().flat().map(x => String(x).trim());
  const dates = sh.getRange(CFG.HDR_ROW, CFG.FIRST_COL, 1, CFG.MAX_DAYS).getValues()[0].map(x => fmtDate_(x, tz));
  const i = names.indexOf(p.name), j = dates.indexOf(p.date);
  if (i >= 0 && j >= 0) sh.getRange(CFG.FIRST_ROW + i, CFG.FIRST_COL + j).setValue(value);
}

/* ---------- 도우미 ---------- */

function warn_(p) {
  const w = [];
  if ((p.type === '지각' || p.type === '인정지각') && !p.inT) w.push('입실 시간');
  if ((p.type === '조퇴' || p.type === '인정조퇴') && !p.outT) w.push('퇴실 시간');
  if ((p.type === '외출' || p.type === '인정외출') && (!p.oa || !p.ob)) w.push('외출 구간');
  if (p.type.indexOf('인정') === 0 && !(p.r || '').trim()) w.push('사유');
  return w.length ? w.join('·') + '은 나중에 채워도 됩니다' : '';
}

function findRow_(cls, stu, date, tz) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.LEDGER), last = lastRow_(sh);
  if (last < 2) return null;
  const vals = sh.getRange(2, 1, last - 1, 11).getValues();
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v[0] instanceof Date && Number(v[1]) === Number(cls) && String(v[2]).trim() === stu && fmtDate_(v[0], tz) === date)
      return { row: i + 2, record: { type: v[3], inT: t_(v[4], tz), outT: t_(v[5], tz), oa: t_(v[6], tz), ob: t_(v[7], tz), r: v[8] || '', ev: v[9] || '', evr: v[10] || '' } };
  }
  return null;
}

function lastRow_(sh) {
  const col = sh.getRange('A1:A' + sh.getMaxRows()).getValues();
  for (let i = col.length - 1; i >= 0; i--) if (col[i][0] !== '' && col[i][0] !== null) return i + 1;
  return 1;
}

function classInfo_(cls) {
  const r = SpreadsheetApp.getActive().getSheetByName(CFG.INFO).getRange('G4:M20').getValues().find(x => String(x[0]) === cls + '반') || [];
  return { teacher: r[4] || '' };
}

function rosterHas_(cls, stu) {
  return SpreadsheetApp.getActive().getSheetByName(CFG.ROSTER).getRange('A2:B800').getValues().some(x => Number(x[0]) === Number(cls) && String(x[1]).trim() === stu);
}

function isHQ_() {
  if (__PORTAL) return false; // 포털 저장은 항상 담임 권한
  const e = (Session.getActiveUser().getEmail() || '').toLowerCase();
  return !!e && CFG.HQ_EMAILS.map(x => x.toLowerCase()).indexOf(e) >= 0;
}

function touch_() { PropertiesService.getDocumentProperties().setProperty('rev', String(Date.now())); }

function log_(p, before, after, via) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.LOG);
  if (!sh) { sh = ss.insertSheet(CFG.LOG); sh.appendRow(['시각', '변경자', '경로', '반', '이름', '교육일', '이전', '이후']); sh.setFrozenRows(1); }
  sh.appendRow([new Date(), Session.getActiveUser().getEmail() || '담임', via, p.cls + '반', p.name, p.date, before, after]);
}

function sum_(r) {
  const t = [r.inT && '입실 ' + r.inT, r.outT && '퇴실 ' + r.outT, r.oa && '외출 ' + r.oa + '~' + (r.ob || '')].filter(Boolean).join(' ');
  return (r.type || '') + (t ? ' ' + t : '') + (r.r ? ' (' + r.r + ')' : '');
}

function fmtDate_(d, tz) { return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : ''; }
function t_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '').trim());
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function parseDate_(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

/* ---------- 웹 포털 (배포 → 웹 앱) · 담임 통합 화면 ---------- */
// 담임은 반 + PIN(반정보 P열)으로 들어옵니다. 포털에서 하는 모든 저장은 '담임' 권한으로 처리됩니다(증빙은 바꾸지 않음).

var __PORTAL = false;
const CHECK_ROWS = { first: 53, last: 71, sections: [['강의 시작 전', 53, 58], ['강의 중', 59, 65], ['강의 종료 후', 66, 71]] };
const SUB = { EVAL: '학습자평가', SAT: '만족도평가', VOC: '민원이슈', OFFICER: '반운영정보' };

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Portal')
    .setTitle('HINT 담임 포털')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function portalClasses() {
  const rows = SpreadsheetApp.getActive().getSheetByName(CFG.INFO).getRange('G4:P20').getValues();
  return rows.filter(r => r[0]).map(r => ({ no: Number(String(r[0]).replace('반', '')), label: r[0] + ' · ' + r[1] + ' ' + r[2], pin: !!String(r[9] || '').trim() }));
}

function checkPin_(cls, pin) {
  const r = SpreadsheetApp.getActive().getSheetByName(CFG.INFO).getRange('G4:P20').getValues().find(x => String(x[0]) === cls + '반');
  if (!r) throw new Error('없는 반입니다.');
  if (__API) return r;          // API 호출은 Vercel이 담임 권한을 이미 확인함
  const need = String(r[9] || '').trim();
  if (need && String(pin || '').trim() !== need) throw new Error('PIN이 맞지 않습니다.');
  return r;
}

function classSheet_(cls) { return SpreadsheetApp.getActive().getSheets().find(s => boardNo_(s) === Number(cls)); }

function portalData(cls, pin) {
  cls = Number(cls);
  const info = checkPin_(cls, pin);
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), base = loadBase_();
  const kids = base.roster.filter(r => Number(r[0]) === cls).map(r => ({
    name: String(r[1]).trim(), status: r[3] || '재학',
    off: r[3] && r[3] !== '재학' && r[4] ? fmtDate_(r[4] instanceof Date ? r[4] : new Date(r[4]), tz) : ''
  }));
  const L = ss.getSheetByName(CFG.LEDGER), last = lastRow_(L), recs = {};
  if (last >= 2) L.getRange(2, 1, last - 1, 11).getValues().forEach(v => {
    if (v[0] instanceof Date && Number(v[1]) === cls)
      recs[String(v[2]).trim() + '|' + fmtDate_(v[0], tz)] = { type: v[3], inT: t_(v[4], tz), outT: t_(v[5], tz), oa: t_(v[6], tz), ob: t_(v[7], tz), r: v[8] || '', ev: v[9] || '', evr: v[10] || '' };
  });
  const sh = classSheet_(cls);
  const sumHdr = sh ? sh.getRange('A12:K12').getDisplayValues()[0] : [];
  const sumVal = sh ? sh.getRange('A13:K13').getDisplayValues()[0] : [];
  const checks = [];
  if (sh) {
    const txt = sh.getRange(CHECK_ROWS.first, 2, CHECK_ROWS.last - CHECK_ROWS.first + 1, 1).getDisplayValues();
    const val = sh.getRange(CHECK_ROWS.first, 5, CHECK_ROWS.last - CHECK_ROWS.first + 1, 1).getDisplayValues();
    CHECK_ROWS.sections.forEach(([label, a, b]) => {
      const items = [];
      for (let r = a; r <= b; r++) items.push({ row: r, text: txt[r - CHECK_ROWS.first][0], value: val[r - CHECK_ROWS.first][0] });
      checks.push({ label: label, items: items });
    });
  }
  return {
    cls: cls, region: info[1], course: info[2], teacher: info[4] || '', place: info[6] || '',
    mainDay: base.mainDay, days: base.days, kids: kids, recs: recs,
    week: week_(cls, info, base, tz),
    summary: sumHdr.map((h, i) => ({ k: h, v: sumVal[i] })).filter(x => x.k),
    closed: sumVal[10] || '', checks: checks,
    evals: subRows_(SUB.EVAL, cls, 0, 8, tz),
    sats: subRows_(SUB.SAT, cls, 0, 7, tz),
    vocs: subRows_(SUB.VOC, cls, 1, 10, tz),
    officer: officer_(cls)
  };
}

function week_(cls, info, base, tz) {
  const m = parseDate_(base.mainDay), dow = (m.getDay() + 6) % 7;
  const mon = new Date(m.getFullYear(), m.getMonth(), m.getDate() - dow);
  const track = String(info[2] || '').replace(/\(\d\)$/, '');
  const rows = SpreadsheetApp.getActive().getSheetByName('시간표').getRange('A2:H1500').getValues().filter(r => r[0] instanceof Date);
  const out = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i), ds = fmtDate_(d, tz);
    const hit = rows.filter(r => fmtDate_(r[0], tz) === ds && ['전체', cls + '반', info[1], track].indexOf(String(r[1])) >= 0);
    const off = hit.some(r => r[6] === '휴일');
    out.push({ date: ds, off: off, subj: hit.map(r => [r[2], r[3]].filter(Boolean).join(' ')).filter(Boolean).join(' / '), place: hit.map(r => r[5]).filter(Boolean).filter((x, j, a) => a.indexOf(x) === j).join(' / '), survey: hit.map(r => r[7]).filter(Boolean).join(' / ') });
  }
  return out;
}

function subRows_(name, cls, clsCol, ncol, tz) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return [];
  const last = lastRow_(sh);
  if (last < 2) return [];
  const out = [];
  sh.getRange(2, 1, last - 1, ncol).getValues().forEach((v, i) => {
    if (Number(v[clsCol]) !== Number(cls)) return;
    out.push({ row: i + 2, v: v.map(x => x instanceof Date ? fmtDate_(x, tz) : x) });
  });
  return out.reverse();
}

function officer_(cls) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SUB.OFFICER);
  if (!sh) return {};
  const r = sh.getRange('A2:G18').getValues().find(x => Number(x[0]) === Number(cls)) || [];
  return { leader: r[2] || '', sub: r[3] || '', treasurer: r[4] || '', note: r[5] || '' };
}

/* --- 저장 --- */

function portalSave(p) {
  const info = checkPin_(Number(p.cls), p.pin);
  __PORTAL = true;
  try {
    p.cls = Number(p.cls);
    if (!rosterHas_(p.cls, p.name)) return { ok: false, msg: '명부에 없는 학생입니다.' };
    // 포털: '해당없음' = 아직 입력 전(기록 삭제), '출석' = 출석 확인을 원장에 남김
    if (!p.type || p.type === '해당없음') { removeRow_(p.cls, p.name, p.date, '포털 · ' + (info[4] || '담임')); setCell_(p, '출석'); touch_(); return { ok: true }; }
    if (p.type !== '출석' && CFG.TYPES.indexOf(p.type) < 0) return { ok: false, msg: '유형을 골라 주세요.' };
    upsert_(p, false, '포털 · ' + (info[4] || '담임'));
    setCell_(p, p.type);
    touch_();
    return { ok: true, warn: warn_(p) };
  } finally { __PORTAL = false; }
}

function portalCheck(cls, pin, row, value) {
  checkPin_(Number(cls), pin);
  if (row < CHECK_ROWS.first || row > CHECK_ROWS.last) throw new Error('잘못된 항목입니다.');
  classSheet_(cls).getRange(row, 5).setValue(value || '');
  return { ok: true };
}

function portalClose(cls, pin, value) {
  checkPin_(Number(cls), pin);
  classSheet_(cls).getRange('K13').setValue(value === '확인' ? '확인' : '미확인');
  return { ok: true };
}

function portalAddRow(cls, pin, kind, vals) {
  checkPin_(Number(cls), pin);
  const ss = SpreadsheetApp.getActive(), name = SUB[kind];
  if (!name) throw new Error('잘못된 요청입니다.');
  const sh = ss.getSheetByName(name), row = lastRow_(sh) + 1;
  const d = s => s ? parseDate_(s) : '';
  let line;
  if (kind === 'EVAL') line = [Number(cls), d(vals.date), vals.subj || '', num_(vals.n), num_(vals.avg), num_(vals.max), num_(vals.min), vals.note || ''];
  else if (kind === 'SAT') line = [Number(cls), vals.period || '', vals.kind || '전체', vals.teacher || '', num_(vals.score), num_(vals.n), vals.note || ''];
  else if (kind === 'VOC') { sh.getRange(row, 1, 1, 2).setValues([[d(vals.date), Number(cls)]]); sh.getRange(row, 5, 1, 5).setValues([[vals.type || '기타', vals.detail || '', vals.status || '접수', vals.action || '', d(vals.done)]]); return { ok: true }; }
  else throw new Error('잘못된 요청입니다.');
  sh.getRange(row, 1, 1, line.length).setValues([line]);
  return { ok: true };
}

function portalUpdateVoc(cls, pin, row, vals) {
  checkPin_(Number(cls), pin);
  const sh = SpreadsheetApp.getActive().getSheetByName(SUB.VOC);
  if (Number(sh.getRange(row, 2).getValue()) !== Number(cls)) throw new Error('다른 반 기록입니다.');
  sh.getRange(row, 7, 1, 3).setValues([[vals.status || '접수', vals.action || '', vals.done ? parseDate_(vals.done) : (vals.status === '완료' ? new Date() : '')]]);
  return { ok: true };
}

function portalSaveOfficer(cls, pin, o) {
  checkPin_(Number(cls), pin);
  const sh = SpreadsheetApp.getActive().getSheetByName(SUB.OFFICER);
  const ids = sh.getRange('A2:A18').getValues().flat().map(Number);
  const i = ids.indexOf(Number(cls));
  if (i < 0) throw new Error('반운영정보에 반이 없습니다.');
  sh.getRange(i + 2, 3, 1, 5).setValues([[o.leader || '', o.sub || '', o.treasurer || '', o.note || '', new Date()]]);
  return { ok: true };
}

function num_(x) { const n = Number(x); return x === '' || x === null || isNaN(n) ? '' : n; }

/* --- 교육생 상태 · 중도포기(예정)일 (담임 설정) --- */
function portalSetStatus(cls, pin, name, status, date) {
  const info = checkPin_(Number(cls), pin);
  cls = Number(cls);
  const STAT = ['재학', '중도탈락', '조기취업'];
  if (STAT.indexOf(status) < 0) throw new Error('상태를 골라 주세요.');
  if (status !== '재학' && !date) throw new Error('포기(예정)일을 넣어 주세요.');
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName(CFG.ROSTER);
  const rows = sh.getRange('A2:E800').getValues();
  const i = rows.findIndex(r => Number(r[0]) === cls && String(r[1]).trim() === name);
  if (i < 0) throw new Error('명부에 없는 학생입니다.');
  const before = (rows[i][3] || '재학') + (rows[i][4] ? ' ' + fmtDate_(rows[i][4] instanceof Date ? rows[i][4] : new Date(rows[i][4]), tz) : '');
  sh.getRange(i + 2, 4, 1, 2).setValues([[status, status === '재학' ? '' : parseDate_(date)]]);
  log_({ cls: cls, name: name, date: date || '' }, '명부 ' + before, '명부 ' + status + (date && status !== '재학' ? ' ' + date : ''), '포털 · ' + (info[4] || '담임'));
  const board = classSheet_(cls);
  if (board) rebuildBoard_(board, cls, loadBase_());
  touch_();
  return { ok: true };
}

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
