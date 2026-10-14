/* ======================================================================
 * HINT 2기 베타 · 마스터시트 확장 (beta2.gs)
 *
 * 마스터시트(HINT 운영 마스터시트)에 연결된 Apps Script 프로젝트에 새 파일 'beta2'로 추가합니다.
 * - 1기 운영총괄(읽기 전용) → 마스터시트 출결원장·명부·반정보·서류발급 가져오기
 *   (평일 09:10~18:00 10분마다, 바뀐 반만. Google Sheets API 서비스를 추가하면 17개 반을 한 번에 읽습니다)
 * - 베타에서 고친 출결 행은 다시 덮어쓰지 않고, 운영총괄과 다르면 T열(동기화 확인)에 적습니다.
 * - 베타 관리자 출결 저장(b2Save), 서류발급 신청·처리, 신청 시 관리자 메일 알림
 * - 포털 화면용 읽기(b2Bundle), 변경 번호(b2Rev), 동기화 상태(b2Status)
 * 포털에서 부르는 함수는 teacher-beta-api.gs의 doPost가 B2_ACTIONS로 받습니다.
 * 처음 설치: b2Setup → b2ImportAll → b2InstallTrigger 순서로 편집기에서 한 번씩 실행합니다.
 * ====================================================================== */

var B2 = {
  SOURCE_ID: '1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34', // 1기 운영총괄 (읽기만 함)
  SOURCE_TABS: {
    '1': '1. 수도권_임베디드 AI(HW)', '2': '2. 수도권_제조지능화', '3': '3. 충청_임베디드 AI(SW)',
    '4': '4. 충청_제조지능화(1)', '5': '5. 충청_제조지능화(2)', '6': '6. 대경_임베디드 AI(HW)',
    '7': '7. 대경_임베디드 AI(SW)', '8': '8. 대경_제조지능화(1)', '9': '9. 대경_제조지능화(2)',
    '10': '10. 동남_임베디드 AI(HW)', '11': '11. 동남_임베디드 AI(SW)', '12': '12. 동남_제조지능화(1)',
    '13': '13. 동남_제조지능화(2)', '14': '14. 동남_제조지능화(3)', '15': '15. 전라_임베디드 AI(SW)',
    '16': '16. 전라_제조지능화(1)', '17': '17. 전라_제조지능화(2)'
  },
  YEAR: 2026,
  COURSE_START: '2026-07-27',
  // 운영총괄 반 탭: M18 머리글(이름·출석률·출석일수·지/조/외/중복·날짜…), 19~48행 학생, 50행 사유 날짜, 51행 사유
  GRID: { headerRow: 18, lastRow: 51, nameCol: 13, dateOffset: 4, studentRows: 30, reasonHead: 32, reasonText: 33 },
  SHEETS: { ledger: '출결원장', roster: '명부', days: '교육일자', info: '반정보', docs: '서류발급', people: '교육생정보', log: '변경이력', srcDocs: '서류발급요청' },
  // 출결원장: A~K 입력, L~Q 수식(1행 ARRAYFORMULA), R 출처, S 동기화 지문, T 동기화 확인
  COL: { input: 11, prov: 18, sig: 19, flag: 20, width: 20 },
  TYPES: ['지각', '조퇴', '외출', '결석', '인정출석', '인정지각', '인정조퇴', '인정외출'],
  EVIDENCE: ['', '미제출', '반려', '확인', '해당없음'],
  ALIASES: { '인정결석': '인정출석', '출석인정': '인정출석', '무단결석': '결석' },
  PROV_SYNC: '1기 동기화',
  PROV_BETA: '베타 수정',
  PROV_DIRECT: '직접 입력',
  DOC_STATUS: ['접수', '처리중', '보완 필요', '처리완료', '취소'],
  DOC_TYPES: ['출석부', '교육참여확인서', '훈련생 확인서', '기타'],
  DOC_DELIVERY: ['이메일(PDF)', '담임 전달', '우편'],
  MAIL: ['hint.kpc@gmail.com', 'kpc.jtkim@gmail.com'],
  BETA_URL: 'https://hint-knewdealportal.vercel.app/beta2',
  // 자동 동기화: 도는 시간(요일 1=월~7=일, Script Properties B2_SYNC_WINDOW로 바꿀 수 있음), 한 번에 색을 확인할 반 수,
  // 읽기에 쓸 수 있는 시간(넘으면 쓰기는 다음 실행으로, 6분 한도), 하루 트리거 사용 상한(넘으면 30분에 한 번), 이보다 많이 바뀌면 출결원장을 통째로 씀,
  // 일시 오류 때 쉬었다 다시 시도하는 간격, 기존 행 맞추기에서 뺄 '사람이 고친 행'을 변경이력에서 찾기 시작하는 날(beta2 설치일)
  SYNC: { window: '1-5 09:10-18:00', colorPerTick: 4, budgetMs: 180000, dailyMs: 3600000, boardsPerLock: 4, boardFails: 3, retryWaits: [2000, 6000], legacySince: '2026-10-13' },
  TZ: 'Asia/Seoul'
};

var __ACTOR = '';      // doPost가 Vercel에서 확인한 사용자 이메일을 넣습니다.
var __ACTOR_ROLE = ''; // 'ADMIN' 또는 'TEACHER'

/* ---------- 순수 함수 (Node 시험에서도 그대로 실행) ---------- */

function b2Pad_(n) { return ('0' + n).slice(-2); }
function b2Hash_(s) {
  var h = 0x811c9dc5; s = String(s);
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}
// '7/27', '07.27', '2026-07-27' → '2026-07-27'
function b2HeaderIso_(v) {
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/(?:^|\D)(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\D|$)/);
  return m ? B2.YEAR + '-' + b2Pad_(+m[1]) + '-' + b2Pad_(+m[2]) : '';
}
function b2Time_(v, fmt) {
  if (v instanceof Date) return fmt ? fmt(v, 'HH:mm') : '';
  var m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? b2Pad_(+m[1]) + ':' + m[2] : '';
}
function b2Norm_(r) {
  return {
    date: String(r.date || ''), cls: String(r.cls == null ? '' : r.cls).trim(), name: String(r.name || '').trim(),
    type: String(r.type || '').trim(), inT: r.inT || '', outT: r.outT || '', oa: r.oa || '', ob: r.ob || '',
    reason: String(r.reason || '').trim(), ev: String(r.ev || '').trim(), evr: String(r.evr || '').trim()
  };
}
function b2Key_(r) { return String(r.cls).trim() + '|' + String(r.name).trim() + '|' + r.date; }
function b2Sig_(r) {
  var n = b2Norm_(r);
  return b2Hash_([n.date, n.cls, n.name, n.type, n.inT, n.outT, n.oa, n.ob, n.reason, n.ev, n.evr].join('␟'));
}
// 증빙 칸 색 → 확인(노랑) · 보완필요(빨강) · 미제출. 포털 attendance-beta-core.mjs overviewColorState와 같은 기준입니다.
function b2ColorState_(bg) {
  var x = String(bg || '').trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(x)) x = '#' + x.slice(1).split('').map(function (c) { return c + c; }).join('');
  if (!/^#[0-9a-f]{6}$/.test(x)) return '미제출';
  var r = parseInt(x.slice(1, 3), 16), g = parseInt(x.slice(3, 5), 16), b = parseInt(x.slice(5, 7), 16);
  if (r >= 242 && g >= 242 && b >= 242) return '미제출';
  if (r >= 180 && g >= 135 && b <= 190 && Math.abs(r - g) <= 110 && g > b + 20) return '확인';
  if (r >= 175 && g <= 185 && b <= 185 && r > g + 25 && r > b + 25) return '보완필요';
  return '미제출';
}

// 운영총괄 값 정리: '중복(지각+외출, …)' 같은 목록 문구는 '중복'으로, 별칭은 시트 유형으로 바꿉니다.
function b2NormType_(raw) { var v = String(raw == null ? '' : raw).trim(); if (B2.ALIASES[v]) return B2.ALIASES[v]; return /^중복/.test(v) ? '중복' : v; }
// 사유에 섞인 시간·표기를 시트 칸으로 옮깁니다: 지각 '09:14' → 입실, 조퇴 → 퇴실, 외출 '(9:00-10:00)' → 외출 시작·종료. 끝의 '(인)'·'(인정)'은 지웁니다.
function b2SplitReason_(type, reason) {
  var base = String(type || '').replace(/^인정/, ''), r = String(reason || '').trim(), out = { reason: '', inT: '', outT: '', oa: '', ob: '' };
  r = r.replace(/\s*[（(]\s*인정?\s*[)）]\s*$/, '').trim();
  var range = r.match(/[（(]?\s*(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})\s*[)）]?/);
  if (range && base === '외출') { out.oa = b2Time_(range[1]); out.ob = b2Time_(range[2]); r = r.replace(range[0], ' '); }
  var one = range ? null : r.match(/[（(]?\s*(\d{1,2}:\d{2})\s*[)）]?/);
  if (one && (base === '지각' || base === '조퇴')) { out[base === '지각' ? 'inT' : 'outT'] = b2Time_(one[1]); r = r.replace(one[0], ' '); }
  out.reason = r.replace(/\s+/g, ' ').replace(/^[\s,，·_:\-]+|[\s,，·_:\-]+$/g, '').trim();
  return out;
}
// T열 중 '운영총괄과 다름' 계열만 충돌로 봅니다(사유 해석 참고 메모는 충돌이 아님).
function b2IsConflict_(flag) { return /^운영총괄 값:|^운영총괄에는|^같은 학생/.test(String(flag || '')); }

/* 동기화 효율용 순수 함수 */
// spec '1-5 09:10-18:00'(요일 1=월~7=일, 쉼표·범위 가능) 또는 'always'. 잘못 적으면 기본값을 씁니다.
function b2InWindow_(spec, dow, hm) {
  var s = String(spec || '').trim();
  if (/^(always|항상)$/i.test(s)) return true;
  var m = s.match(/^([\d,\-\s]+?)\s+(\d{2}:\d{2})\s*[-~]\s*(\d{2}:\d{2})$/) || B2.SYNC.window.match(/^([\d,\-\s]+?)\s+(\d{2}:\d{2})\s*[-~]\s*(\d{2}:\d{2})$/);
  var days = {};
  m[1].split(',').forEach(function (part) {
    var r = part.trim().split('-').map(Number);
    for (var d = r[0]; d <= (r.length > 1 ? r[1] : r[0]); d++) days[d] = true;
  });
  return !!days[+dow] && hm >= m[2] && hm <= m[3];
}
// 끝의 빈 칸·빈 행을 뺀 값 묶음(시트에서 읽은 것과 Sheets API로 읽은 것이 같은 결과가 되게)
function b2GridKey_(values) {
  var rows = (values || []).map(function (r) {
    var a = (r || []).map(function (v) { return String(v == null ? '' : v); });
    while (a.length && a[a.length - 1] === '') a.pop();
    return a;
  });
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
  return JSON.stringify(rows);
}
// 증빙 판단에 쓰는 색만 모은 값(인정 칸의 확인·보완필요·미제출). 색만 바뀐 반을 찾을 때 씁니다.
function b2EvidenceKey_(values, backgrounds) {
  var G = B2.GRID, out = [];
  for (var r = 1; r <= G.studentRows; r++) {
    var row = (values || [])[r] || [];
    for (var c = G.dateOffset; c < row.length; c++) {
      if (b2NormType_(row[c]).indexOf('인정') === 0) out.push(r + ',' + c + ':' + b2ColorState_(((backgrounds || [])[r] || [])[c]));
    }
  }
  return out.join(';');
}
// 반 목록에서 cursor부터 n개(끝나면 처음으로)
function b2Rotation_(list, cursor, n) {
  var pick = [], len = list.length, start = len ? ((+cursor || 0) % len + len) % len : 0;
  for (var i = 0; i < Math.min(n, len); i++) pick.push(list[(start + i) % len]);
  return { pick: pick, next: len ? (start + pick.length) % len : 0 };
}
// 처음 설치 때 예전 코드가 붙인 표시(출처 빈칸 또는 '직접 입력', 지문 빈칸)를 운영총괄 값을 따르는 행으로 바꿉니다(사용자 결정 2026-10-13).
// '베타 수정' 행, 지문이 있는 행, 설치 뒤 사람이 고친 행(skip: 변경이력에 남은 '반|이름|날짜')은 건드리지 않습니다.
// scope({반: {날짜: true}})에 든 행만, 곧 이번 실행이 운영총괄과 맞추는 반·날짜만 바꿉니다. 그래야 '*' 표시가 같은 실행 안에서 실제 지문으로 바뀝니다.
function b2AdoptLegacy_(rows, skip, scope) {
  var n = 0;
  rows.forEach(function (r) {
    if (r.sig || (r.prov && r.prov !== B2.PROV_DIRECT) || (skip && skip[b2Key_(r.rec)])) return;
    if (!scope || !scope[r.rec.cls] || !scope[r.rec.cls][r.rec.date]) return;
    r.prov = B2.PROV_SYNC; r.sig = '*'; n++;
  });
  return n;
}
// 다시 읽은 출결원장 A~C열(now, 2행부터 {date, cls, name})이 읽을 때 그대로이거나, 이 계획(plan)을 쓰다 만 상태인지.
// 비울 행은 비어 있어도 되고, 마지막 행(ledgerLast) 아래에는 이 계획이 붙이는 행이 차례로 있어도 됩니다(일시 오류 뒤 다시 시도).
// 그 밖에 행이 지워지거나 끼워지거나 정렬됐으면 false입니다.
function b2RowsAsPlanned_(origByRow, now, ledgerLast, plan) {
  var cleared = {}, same = function (v, r) { return v.date === r.date && v.cls === String(r.cls) && v.name === r.name; };
  plan.clears.forEach(function (r) { cleared[r] = true; });
  for (var i = 0; i < now.length; i++) {
    var row = i + 2, v = now[i];
    if (row > ledgerLast) { var a = plan.appends[row - ledgerLast - 1]; if (v.date && !(a && same(v, a.rec))) return false; continue; }
    var o = origByRow[row];
    if (cleared[row] && !v.date) continue;
    if (!o) { if (v.date) return false; continue; }
    if (!same(v, o.rec)) return false;
  }
  return true;
}
// 합친 결과를 시트에 쓸 계획: 바뀐 행만 고치기(patch), 새 행은 아래에 붙이기(append), 없어진 동기화 행은 비우기(clear).
// origByRow: 읽을 때의 {rec, prov, sig, flag} (행 번호별). 행 번호는 바꾸지 않고, 바뀌지 않은 행은 건드리지 않습니다.
function b2LedgerPlan_(rows, removed, origByRow) {
  var patches = [], appends = [];
  rows.forEach(function (r) {
    var o = r.row ? origByRow[r.row] : null;
    if (!o) { appends.push(r); return; }
    var input = b2Sig_(o.rec) !== b2Sig_(r.rec);
    var meta = (o.prov || '') !== (r.prov || '') || (o.sig || '') !== (r.sig || '') || (o.flag || '') !== (r.flag || '');
    if (input || meta) patches.push({ row: r.row, cls: r.rec.cls, rec: input ? r.rec : null, meta: meta ? [r.prov || '', r.sig || '', r.flag || ''] : null });
  });
  patches.sort(function (a, b) { return a.row - b.row; });
  var clears = (removed || []).map(function (x) { return x.row; }).filter(Boolean).sort(function (a, b) { return a - b; });
  return { patches: patches, appends: appends, clears: clears, removed: removed || [] };
}
// 행 번호 순으로 정렬된 [{row, value}] → 붙어 있는 행끼리 [{row: 첫 행, values: [...]}] (시트 쓰기 횟수를 줄이기 위해)
function b2Runs_(items) {
  var runs = [];
  items.forEach(function (it) {
    var cur = runs[runs.length - 1];
    if (cur && cur.row + cur.values.length === it.row) cur.values.push(it.value); else runs.push({ row: it.row, values: [it.value] });
  });
  return runs;
}

/* 사유 해석: attendance-reason-core.mjs의 parseAttendanceReasons·reasonFor를 그대로 옮겼습니다.
 * (tests/beta2-gas.test.mjs가 두 구현의 결과가 같은지 확인합니다.) */
var B2_STATUS = '인정출석|인정지각|인정조퇴|인정외출|인정결석|출석인정|무단결석|결석|지각|조퇴|외출|출석|중복';
function b2Word_(c) { return !!c && /[\p{L}\p{N}]/u.test(c); }
function b2BaseName_(s) { return s.replace(/\s*[（(]\s*\d{2,4}\s*년생\s*[)）]\s*$/, '').trim(); }
function b2Connector_(s) { return /^[\s,，·ㆍ/&]*(?:(?:및|와|과|모두|공통)[\s,，·ㆍ/&]*)?$/.test(s); }
function b2First_(m) { return m ? m[1] : ''; }
function b2CleanReason_(text) {
  var s = String(text || '').trim().replace(/^[\s*•·\-_:：=→>\/|,，]+|[\s,，;；/|]+$/g, '');
  s = s.replace(/^(?:님\s*)?(?:사유|이유)\s*[:：_=-]?\s*/, '');
  s = s.replace(new RegExp(`[,，/|;；\\s]+[*•\\s]*(?:${B2_STATUS})\\s*\\d*\\s*[-:：.(]?\\s*$`), '').trim();
  s = s.replace(new RegExp(`^\\(?(${B2_STATUS})\\)?(?=\\s|[:：_(-]|\\d{1,2}[:시]|$)\\s*[:：_-]?\\s*`), '').trim();
  while (s.endsWith(')') && [...s].filter(c => c === ')').length > [...s].filter(c => c === '(').length) s = s.slice(0, -1).trim();
  if (s.startsWith('(') && s.endsWith(')')) { let depth = 0, outer = true; for (let i = 0; i < s.length; i++) { if (s[i] === '(') depth++; if (s[i] === ')') depth--; if (depth === 0 && i < s.length - 1) outer = false; } if (outer && depth === 0) s = s.slice(1, -1).trim(); }
  return /^(해당없음|없음|사유없음|-)$/i.test(s) ? '' : s;
}
function b2ParseReasons_(text, roster) {
  const names = roster.map(n => typeof n === 'string' ? n : n.name).filter(Boolean), raw = String(text == null ? '' : text);
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length), byName = Object.fromEntries(unique.map(n => [n, []])), issues = [], counts = new Map(unique.map(n => [n, names.filter(v => v === n).length]));
  const add = (name, value, line, header = '') => { const reason = b2CleanReason_(value), status = b2First_(String(value).replace(/^[\s_:\-：]+/, '').match(new RegExp(`^\\(?(${B2_STATUS})\\)?(?=\\s|[:：_(-]|$)`))) || header; if (!reason && !status) return; if (counts.get(name) > 1) { issues.push({ name, line, message: '동명이인 식별 필요' }); return; } if (!byName[name].some(e => e.reason === reason && e.status === status)) byName[name].push({ reason, status, line, raw: value }); };
  const aliases = new Map(); for (const name of unique) { const b = name.match(/^(.*?)\s*[（(]\s*(\d{2,4})\s*년생\s*[)）]\s*$/), values = [name]; if (b) for (const year of new Set([b[2], b[2].slice(-2)])) for (const suffix of [`(${year}년생)`, `（${year}년생）`, `(${year})`, year, `${year}년생`]) values.push(b[1].trim() + suffix); for (const alias of values) { if (!aliases.has(alias)) aliases.set(alias, new Set()); aliases.get(alias).add(name); } }
  const tokens = [...aliases].sort((a, b) => b[0].length - a[0].length), lines = raw.replace(/\r\n?/g, '\n').split('\n'); let sectionStatus = '';
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]; if (!line.trim()) { sectionStatus = ''; continue; } const hits = []; let lineStatus = sectionStatus;
    for (const [alias, targets] of tokens) { let at = 0; while ((at = line.indexOf(alias, at)) >= 0) { const end = at + alias.length, after = line.slice(end), left = at === 0 || !b2Word_(line[at - 1]), right = end === line.length || !b2Word_(line[end]) || /^(?:님|와|과)(?=\s|[,，·])/u.test(after) || new RegExp(`^(?:${B2_STATUS}|병원|병가|병결|면접|예비군|개인일정|개인사정|\\d{1,2}:\\d{2})`).test(after), qualifier = /^\s*[（(]\s*\d{2,4}\s*년생\s*[)）]/.test(after);
      if (left && right && !qualifier && !hits.some(h => at < h.end && end > h.start)) hits.push({ name: [...targets][0], names: [...targets], start: at, end, invalid: targets.size !== 1 }); at = end; } }
    for (const name of unique) { const base = b2BaseName_(name); let at = 0; while ((at = line.indexOf(base, at)) >= 0) { const end = at + base.length; if (!hits.some(h => at < h.end && end > h.start)) hits.push({ name, names: unique.filter(n => b2BaseName_(n) === base), start: at, end, invalid: true }); at = end; } }
    hits.sort((a, b) => a.start - b.start);
    for (const hit of hits) if (hit.invalid) for (const name of hit.names) issues.push({ name, line: li + 1, message: '학생명 경계 또는 동명이인 식별표기 확인 필요' });
    if (!hits.length) { const heading = line.trim().replace(/^[*•\s]+/, '').match(new RegExp(`^(${B2_STATUS})\\s*\\d*\\s*[-:：.(]?\\s*$`)); if (heading) sectionStatus = heading[1]; continue; }
    for (let i = 0; i < hits.length;) {
      if (hits[i].invalid) { i++; continue; } let end = i; while (end + 1 < hits.length && !hits[end + 1].invalid && b2Connector_(line.slice(hits[end].end, hits[end + 1].start))) end++;
      const next = hits[end + 1] ? hits[end + 1].start : line.length, segment = line.slice(hits[end].end, next);
      let value = segment; const prefix = line.slice(0, hits[i].start).trim();
      if (!b2CleanReason_(value) && i === 0 && end === hits.length - 1 && /[:：]\s*$/.test(prefix) && !new RegExp(`^(?:[*•\\s]*)(${B2_STATUS})\\s*\\d*[:：]$`).test(prefix)) value = prefix.replace(/[:：]\s*$/, '');
      const header = b2First_(line.slice(i ? hits[i - 1].end : 0, hits[i].start).match(new RegExp(`(?:^|[,，;；/|*•\\s])(${B2_STATUS})\\s*\\d*\\s*[-:：.(]?\\s*$`))) || lineStatus; lineStatus = header;
      for (let j = i; j <= end; j++) { if (counts.get(hits[j].name) > 1) issues.push({ name: hits[j].name, line: li + 1, message: '동명이인 식별 필요' }); else add(hits[j].name, value, li + 1, header); }
      i = end + 1;
    }
  }
  return { byName, issues: [...new Map(issues.map(v => [JSON.stringify(v), v])).values()] };
}
function b2ReasonFor_(name, parsed) {
  if (parsed.issues.some(i => i.name === name)) return { reason: '', issue: true };
  return { reason: [...new Set((parsed.byName[name] || []).map(e => e.reason).filter(Boolean))].join('; '), issue: false };
}

/* 운영총괄 반 탭 한 개(M18:끝열51) → 출결원장에 넣을 예외 기록(출석·해당없음 제외)과 학생 목록.
 * values·backgrounds: getDisplayValues()/getBackgrounds() 결과. days: 교육일자 {iso:true}. */
function b2ParseGrid_(cls, values, backgrounds, today, days) {
  var G = B2.GRID, head = values[0] || [], dates = [], seen = {};
  for (var c = G.dateOffset; c < head.length; c++) {
    var iso = b2HeaderIso_(head[c]);
    if (!iso || iso < B2.COURSE_START || iso > today || (days && !days[iso])) continue;
    if (seen[iso]) throw new Error(cls + '반 운영총괄 날짜 열이 겹칩니다: ' + iso);
    seen[iso] = true; dates.push({ iso: iso, c: c });
  }
  dates.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
  var students = [];
  for (var r = 1; r <= G.studentRows; r++) {
    var row = values[r] || [], name = String(row[0] || '').trim();
    if (name) students.push({ name: name, r: r, row: row });
  }
  var rh = values[G.reasonHead] || [], rt = values[G.reasonText] || [], reasons = {};
  for (c = G.dateOffset; c < rh.length; c++) { var d = b2HeaderIso_(rh[c]); if (d) reasons[d] = String(rt[c] || ''); }
  var names = students.map(function (s) { return s.name; }), parsedCache = {}, records = [];
  var valid = ['출석', '지각', '조퇴', '외출', '결석', '인정출석', '중복'];
  var statusOf = function (s, d) { return b2NormType_(s.row[d.c]); };
  // 중도탈락: 마지막으로 입력된 날짜에서 거꾸로 '해당없음'이 2일 이상 이어지면 그 첫날부터 (포털 통계와 같은 기준)
  var evaluation = -1;
  dates.forEach(function (d, i) { if (students.some(function (s) { return valid.indexOf(statusOf(s, d)) >= 0; })) evaluation = i; });
  var outStudents = students.map(function (s) {
    var first = -1; for (var i = 0; i < dates.length; i++) if (valid.indexOf(statusOf(s, dates[i])) >= 0) { first = i; break; }
    var trailing = []; for (i = evaluation; i >= 0; i--) { if (statusOf(s, dates[i]) !== '해당없음') break; trailing.unshift(dates[i].iso); }
    var dropout = evaluation >= 0 && first >= 0 && trailing.length >= 2 && dates[first].iso < trailing[0];
    // lastDay: 마지막 출석일(해당없음 바로 앞 교육일). 명부 '상태 변경일'에 넣고, 그다음 교육일부터 재학에서 뺍니다(2기 담임 화면 기준).
    var at = dropout ? dates.map(function (d) { return d.iso; }).indexOf(trailing[0]) : -1;
    return { name: s.name, dropoutFrom: dropout ? trailing[0] : '', lastDay: at > 0 ? dates[at - 1].iso : '' };
  });
  students.forEach(function (s) {
    dates.forEach(function (d) {
      var raw = String(s.row[d.c] || '').trim(), type = b2NormType_(raw), notes = [];
      if (!raw || raw === '출석' || raw === '해당없음' || raw === '-' || raw === '미입력') return;
      if (type === '중복') notes.push('운영총괄 중복 표시 · 유형 확인 필요');
      else if (B2.TYPES.indexOf(type) < 0) notes.push('운영총괄 값 확인 필요: ' + raw);
      if (!parsedCache[d.iso]) parsedCache[d.iso] = b2ParseReasons_(reasons[d.iso] || '', names);
      var found = b2ReasonFor_(s.name, parsedCache[d.iso]);
      if (found.issue) notes.push('사유: 동명이인·이름 경계 확인 필요');
      var ev = '';
      if (type.indexOf('인정') === 0) {
        var state = b2ColorState_(((backgrounds || [])[s.r] || [])[d.c]);
        ev = state === '확인' ? '확인' : state === '보완필요' ? '반려' : '';
      }
      var split = b2SplitReason_(type, found.reason);
      records.push({ date: d.iso, cls: String(cls), name: s.name, type: type, inT: split.inT, outT: split.outT, oa: split.oa, ob: split.ob, reason: split.reason, ev: ev, evr: '', note: notes.join(' · ') });
    });
  });
  return { records: records, students: outStudents, dates: dates.map(function (d) { return d.iso; }) };
}

function b2Diff_(cur, want) {
  var parts = [];
  if (cur.type !== want.type) parts.push(want.type);
  if (String(cur.reason || '').trim() !== String(want.reason || '').trim() && want.reason) parts.push("사유 '" + want.reason + "'");
  if (String(cur.ev || '') !== String(want.ev || '') && want.ev) parts.push('증빙 ' + want.ev);
  if (!parts.length && cur.type === want.type) return '';
  return '운영총괄 값: ' + (parts.length ? parts.join(' / ') : want.type);
}

/* 출결원장 행 합치기. existing: [{rec, prov, sig, flag, row}], desired: 운영총괄 기록, scope: {cls: {iso:true}}
 * - 동기화로 들어온 뒤 손대지 않은 행(출처=1기 동기화, 지문 일치 또는 '*')만 운영총괄 값으로 바꾸거나 지웁니다.
 * - 출처가 1기 동기화이고 값이 운영총괄과 같으면 지문이 어긋나도 동기화 행으로 봅니다(중간에 끊긴 쓰기 복구).
 * - 출처가 비어 있고 값이 같은 행은 동기화 행으로 받아들입니다(처음 한 번).
 * - 그 밖의 행은 그대로 두고, 운영총괄과 다르면 T열에 적습니다.
 * 결과 rows에는 읽은 행 번호(row)가 따라가고, removed에는 지울 동기화 행이 들어갑니다. */
function b2Merge_(existing, desired, scope) {
  var want = {}, used = {}, seen = {}, out = [], removed = [], changed = {}, stats = { added: 0, updated: 0, removed: 0, adopted: 0, flagged: 0, kept: 0 };
  desired.forEach(function (d) { want[b2Key_(d)] = d; });
  var push = function (rec, prov, sig, flag, before) {
    out.push({ rec: rec, prov: prov, sig: sig, flag: flag || '', row: before && before.row });
    if (before && (before.prov !== prov || before.sig !== sig || (before.flag || '') !== (flag || ''))) changed[rec.cls] = true;
  };
  existing.forEach(function (e) {
    var rec = b2Norm_(e.rec), k = b2Key_(rec), dates = scope[rec.cls];
    if (seen[k]) { push(rec, e.prov, e.sig, '같은 학생·날짜 기록이 여러 줄입니다', e); stats.flagged++; return; }
    seen[k] = true;
    if (!dates || !dates[rec.date]) { out.push({ rec: rec, prov: e.prov, sig: e.sig, flag: e.flag || '', row: e.row }); return; }
    var d = want[k], cur = b2Sig_(rec), ds = d ? b2Sig_(d) : '';
    var synced = e.prov === B2.PROV_SYNC && (e.sig === cur || e.sig === '*' || (!!d && ds === cur)), unknown = !e.prov && !e.sig;
    if (d) {
      used[k] = true;
      if (synced) {
        if (ds !== cur || e.sig === '*') { push(b2Norm_(d), B2.PROV_SYNC, ds, d.note, e); changed[rec.cls] = true; stats.updated++; }
        else push(rec, B2.PROV_SYNC, cur, d.note, e);
      } else if (unknown && ds === cur) { push(rec, B2.PROV_SYNC, cur, d.note, e); stats.adopted++; }
      else {
        var diff = b2Diff_(rec, d);
        push(rec, e.prov || B2.PROV_DIRECT, e.sig, diff, e);
        if (diff) stats.flagged++; else stats.kept++;
      }
    } else if (synced) { changed[rec.cls] = true; stats.removed++; removed.push({ row: e.row, cls: rec.cls }); }
    else {
      var note = rec.type === '출석' ? '' : '운영총괄에는 이 날 기록 없음(출석)';
      push(rec, e.prov || B2.PROV_DIRECT, e.sig, note, e);
      if (note) stats.flagged++; else stats.kept++;
    }
  });
  desired.forEach(function (d) {
    var k = b2Key_(d); if (used[k] || seen[k]) return;
    var rec = b2Norm_(d); out.push({ rec: rec, prov: B2.PROV_SYNC, sig: b2Sig_(rec), flag: d.note || '' });
    changed[rec.cls] = true; stats.added++;
  });
  out.sort(function (a, b) {
    return a.rec.date < b.rec.date ? -1 : a.rec.date > b.rec.date ? 1 : (+a.rec.cls - +b.rec.cls) || (a.rec.name < b.rec.name ? -1 : a.rec.name > b.rec.name ? 1 : 0);
  });
  return { rows: out, removed: removed, stats: stats, changed: Object.keys(changed) };
}

/* 명부 합치기. roster: [{row, cls, name, status, changed, birth, gender}], students: {cls: [{name, dropoutFrom}]},
 * people: 교육생정보 [{cls, name, birth, gender}] (birth: 'yyyy-MM-dd')
 * - 없는 학생은 추가, 중도탈락은 상태가 비었거나 재학일 때만 바꿈(상태 변경일 = 마지막 출석일), 생년월일·성별은 빈 칸만 채움.
 * - 예전 beta2가 쓴 '중도포기'는 시트 용어 '중도탈락'으로 고칩니다. */
function b2MergeRoster_(roster, students, people) {
  var byKey = {}, updates = [], appends = [];
  roster.forEach(function (r) { byKey[String(r.cls) + '|' + String(r.name).trim()] = r; });
  var personFor = function (cls, name) {
    var base = b2BaseName_(name).replace(/\s/g, ''), year = (name.match(/[（(]\s*(\d{2,4})\s*년생\s*[)）]\s*$/) || [])[1] || '';
    var found = people.filter(function (p) { return String(p.cls) === String(cls) && String(p.name).replace(/\s/g, '') === base; });
    if (found.length > 1 && year) found = found.filter(function (p) { return String(p.birth).slice(0, 4).slice(-year.length) === year; });
    return found.length === 1 ? found[0] : null;
  };
  Object.keys(students).forEach(function (cls) {
    students[cls].forEach(function (s) {
      var cur = byKey[cls + '|' + s.name], person = personFor(cls, s.name);
      if (!cur) {
        appends.push({ cls: cls, name: s.name, status: s.dropoutFrom ? '중도탈락' : '재학', changed: s.dropoutFrom ? (s.lastDay || s.dropoutFrom) : '', birth: person ? person.birth : '', gender: person ? person.gender : '' });
        return;
      }
      var patch = {};
      var want = s.lastDay || s.dropoutFrom;
      if (s.dropoutFrom && (!cur.status || cur.status === '재학' || (cur.status === '중도포기' && cur.changed !== want))) { patch.status = '중도탈락'; patch.changed = want; }
      else if (cur.status === '중도포기') { patch.status = '중도탈락'; patch.changed = cur.changed; }
      if (!cur.birth && person && person.birth) patch.birth = person.birth;
      if (!cur.gender && person && person.gender) patch.gender = person.gender;
      if (Object.keys(patch).length) { patch.row = cur.row; updates.push(patch); }
    });
  });
  return { updates: updates, appends: appends };
}

// 1기 운영총괄 '서류발급요청' 탭(5행부터) → 마스터 서류발급 행
function b2DocFromSource_(row, rowNumber) {
  var t = function (i) { return String(row[i] == null ? '' : row[i]).trim(); };
  if (!t(1) && !t(2) && !t(3)) return null;
  var day = function (s) { var m = s.replace(/\D/g, '').match(/^(\d{4})(\d{2})(\d{2})$/); return m ? m[1] + '-' + m[2] + '-' + m[3] : s; };
  var detail = [t(5) ? '기간: ' + t(5) : '', t(7) ? '목적: ' + t(7) : ''].filter(Boolean).join(' · ');
  return {
    id: '1기-' + rowNumber, requested: day(t(1)), cls: t(2), name: t(3), birth: t(4), detail: detail, submitTo: t(8),
    due: day(t(9)), status: t(10), memo: t(11), docType: t(6), qty: '', delivery: '', requester: '1기 운영총괄', handler: '', handledAt: '', link: '', fixReason: ''
  };
}
var B2_DOC_FIELDS = ['id', 'requested', 'cls', 'name', 'birth', 'detail', 'submitTo', 'due', 'status', 'memo', 'docType', 'qty', 'delivery', 'requester', 'handler', 'handledAt', 'link', 'fixReason'];

function b2Validate_(p, ctx) {
  var e = [], type = String(p.type || '').trim();
  if (!/^(?:[1-9]|1[0-7])$/.test(String(p.cls))) e.push('반 번호를 확인해 주세요.');
  if (!ctx.days[p.date]) e.push('교육일이 아닌 날에는 기록할 수 없습니다.');
  if (p.date > ctx.today) e.push('아직 오지 않은 교육일입니다.');
  if (!ctx.rosterHas) e.push('명부에 없는 학생입니다.');
  if (type !== '출석' && B2.TYPES.indexOf(type) < 0) e.push('유형을 골라 주세요.');
  ['inT', 'outT', 'oa', 'ob'].forEach(function (k) { if (p[k] && !b2Time_(p[k])) e.push('시간은 09:15처럼 입력해 주세요.'); });
  var needA = ['지각', '인정지각'].indexOf(type) >= 0, needB = ['조퇴', '인정조퇴'].indexOf(type) >= 0, needAB = ['외출', '인정외출'].indexOf(type) >= 0;
  if (needA && !p.inT) e.push('입실 시간을 넣어 주세요.');
  if (needB && !p.outT) e.push('퇴실 시간을 넣어 주세요.');
  if (needAB && (!p.oa || !p.ob)) e.push('외출 시작·종료 시간을 넣어 주세요.');
  if (needAB && p.oa && p.ob && b2Time_(p.ob) <= b2Time_(p.oa)) e.push('외출 종료가 시작보다 늦어야 합니다.');
  if (type.indexOf('인정') === 0 && !String(p.reason || '').trim()) e.push('인정 출결은 사유가 필요합니다.');
  if (B2.EVIDENCE.indexOf(String(p.ev || '')) < 0) e.push('증빙 상태를 확인해 주세요.');
  if (p.ev === '반려' && !String(p.evr || '').trim()) e.push('반려 사유를 적어 주세요.');
  if (String(p.reason || '').length > 300 || String(p.evr || '').length > 300) e.push('사유는 300자 이하로 적어 주세요.');
  return e;
}

/* ---------- 시트 읽기·쓰기 ---------- */

function b2Ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function b2Tz_() { try { return b2Ss_().getSpreadsheetTimeZone() || B2.TZ; } catch (e) { return B2.TZ; } }
function b2Fmt_(d, pattern) { return Utilities.formatDate(d, b2Tz_(), pattern); }
function b2Iso_(v) {
  if (v instanceof Date) return b2Fmt_(v, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  return m ? m[1] + '-' + b2Pad_(+m[2]) + '-' + b2Pad_(+m[3]) : '';
}
function b2DateValue_(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function b2Today_() { return b2Fmt_(new Date(), 'yyyy-MM-dd'); }
function b2Sheet_(name) { var sh = b2Ss_().getSheetByName(name); if (!sh) throw new Error("'" + name + "' 탭이 없습니다. b2Setup을 먼저 실행해 주세요."); return sh; }
function b2Actor_() { return __ACTOR || (function () { try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; } })() || 'Apps Script'; }
function b2Props_() { return PropertiesService.getScriptProperties(); }
// 원본(1기 운영총괄) 시트 ID. Script Properties에 B2_SOURCE_ID=none 을 넣으면 동기화를 끕니다(2기 마스터 시트).
function b2SourceId_() { var v = b2Props_().getProperty('B2_SOURCE_ID'); if (v === null) return B2.SOURCE_ID; v = String(v).trim(); return /^(none|없음|-)?$/i.test(v) ? '' : v; }
function b2Bump_() { var p = b2Props_(), n = (+p.getProperty('B2_REV') || 0) + 1; p.setProperty('B2_REV', String(n)); return n; }
function b2LastRow_(sh, col) {
  var v = sh.getRange(1, col || 1, sh.getMaxRows(), 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (v[i][0] !== '' && v[i][0] !== null) return i + 1;
  return 1;
}
function b2Days_() {
  var v = b2Sheet_(B2.SHEETS.days).getRange('A2:A200').getValues(), list = [], set = {};
  v.forEach(function (r) { var iso = b2Iso_(r[0]); if (iso && !set[iso]) { set[iso] = true; list.push(iso); } });
  list.sort();
  return { list: list, set: set };
}
function b2ReadLedger_() {
  var sh = b2Sheet_(B2.SHEETS.ledger), last = b2LastRow_(sh, 1), rows = [];
  if (last < 2) return { sh: sh, last: last, rows: rows };
  var width = Math.min(B2.COL.width, sh.getMaxColumns()), v = sh.getRange(2, 1, last - 1, width).getValues(), fmt = b2Fmt_;
  v.forEach(function (r, i) {
    if (!(r[0] instanceof Date) && !b2Iso_(r[0])) return;
    rows.push({
      row: i + 2,
      rec: { date: b2Iso_(r[0]), cls: String(r[1]).trim(), name: String(r[2] || '').trim(), type: String(r[3] || '').trim(), inT: b2Time_(r[4], fmt), outT: b2Time_(r[5], fmt), oa: b2Time_(r[6], fmt), ob: b2Time_(r[7], fmt), reason: String(r[8] || '').trim(), ev: String(r[9] || '').trim(), evr: String(r[10] || '').trim() },
      memo: String(r[11] || ''), code: String(r[12] || ''), evApplied: String(r[14] || ''), check: String(r[16] || ''),
      prov: String(r[17] || '').trim(), sig: String(r[18] || '').trim(), flag: String(r[19] || '').trim()
    });
  });
  return { sh: sh, last: last, rows: rows };
}
function b2LedgerValues_(rec) {
  return [b2DateValue_(rec.date), Number(rec.cls), rec.name, rec.type, rec.inT, rec.outT, rec.oa, rec.ob, rec.reason, rec.ev, rec.evr];
}
// 출결원장에 쓰기 계획(b2LedgerPlan_)을 씁니다. 행 번호는 바꾸지 않고(정렬·당기기 없음) 바뀐 행만 씁니다. 붙어 있는 행은 한 번에 씁니다.
// 중간에 끊겨도 다음 실행이 b2Merge_로 바로잡을 수 있는 순서로 씁니다:
//  1) 값이 바뀌는 동기화 행의 R:T를 먼저 '1기 동기화'·'*'(운영총괄을 따름)로 → 2) A~K 값과 비울 행 → 3) 마지막 R:T
//  새 행은 R:T를 먼저, A~K를 나중에 씁니다(A가 비면 읽을 때 건너뛰고 다음 실행이 같은 줄에 다시 붙입니다).
// 쓰기 전에 행 위치가 그사이 바뀌었는지 확인합니다(일시 오류로 다시 시도할 때도 매번).
// S열(동기화 지문)은 '일반 텍스트' 서식으로 둡니다. 그러지 않으면 '01234567'·'12345e67' 같은 지문이 숫자로 바뀌어 다시는 맞지 않습니다.
var B2_MOVED = '출결원장 행 위치가 그사이 바뀌어(행 삭제·추가·정렬) 이번 반영을 멈췄습니다. 다음 실행에서 다시 맞춥니다.';
function b2WriteLedgerPlan_(ledger, plan, origByRow) {
  var sh = ledger.sh, W = B2.COL.input, P = B2.COL.prov, last = ledger.last, k = plan.appends.length;
  if (b2LedgerMoved_(ledger, origByRow, plan)) throw new Error(B2_MOVED);
  var dateFormat = k ? sh.getRange(2, 1).getNumberFormat() : '';
  if (sh.getMaxColumns() < B2.COL.width) sh.insertColumnsAfter(sh.getMaxColumns(), B2.COL.width - sh.getMaxColumns());
  if (sh.getMaxRows() < last + k) sh.insertRowsAfter(sh.getMaxRows(), last + k - sh.getMaxRows());
  sh.getRange(2, B2.COL.sig, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  var put = function (col, width, items) { b2Runs_(items).forEach(function (run) { sh.getRange(run.row, col, run.values.length, width).setValues(run.values); }); };
  put(P, 3, plan.patches.filter(function (p) { return p.rec && p.meta && p.meta[0] === B2.PROV_SYNC; })
    .map(function (p) { var o = origByRow[p.row]; return { row: p.row, value: [B2.PROV_SYNC, '*', (o && o.flag) || ''] }; }));
  put(1, W, plan.patches.filter(function (p) { return p.rec; }).map(function (p) { return { row: p.row, value: b2LedgerValues_(p.rec) }; }));
  if (plan.clears.length) {
    var a1 = [];
    b2Runs_(plan.clears.map(function (r) { return { row: r, value: 0 }; })).forEach(function (run) { var e = run.row + run.values.length - 1; a1.push('A' + run.row + ':K' + e, 'R' + run.row + ':T' + e); });
    sh.getRangeList(a1).clearContent();
  }
  put(P, 3, plan.patches.filter(function (p) { return p.meta; }).map(function (p) { return { row: p.row, value: p.meta }; }));
  if (k) {
    var at = last + 1;
    sh.getRange(at, P, k, 3).setValues(plan.appends.map(function (r) { return [r.prov || '', r.sig || '', r.flag || '']; }));
    sh.getRange(at, 1, k, W).setValues(plan.appends.map(function (r) { return b2LedgerValues_(r.rec); }));
    sh.getRange(at, 1, k, 1).setNumberFormat(/y/.test(dateFormat) ? dateFormat : 'yyyy/mm/dd (ddd)');
    sh.getRange(at, 5, k, 4).setNumberFormat('hh:mm');
  }
}
function b2ReadRoster_() {
  var sh = b2Sheet_(B2.SHEETS.roster), last = b2LastRow_(sh, 2), out = [];
  if (last < 2) return { sh: sh, last: last, rows: out };
  sh.getRange(2, 1, last - 1, 8).getValues().forEach(function (r, i) {
    if (!String(r[1] || '').trim()) return;
    out.push({ row: i + 2, cls: String(r[0]).trim(), name: String(r[1]).trim(), id: String(r[2] || ''), status: String(r[3] || '').trim(), changed: b2Iso_(r[4]), birth: b2Iso_(r[6]), gender: String(r[7] || '').trim() });
  });
  return { sh: sh, last: last, rows: out };
}
function b2ReadPeople_() {
  var sh = b2Ss_().getSheetByName(B2.SHEETS.people); if (!sh) return [];
  var last = b2LastRow_(sh, 2); if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().filter(function (r) { return String(r[1] || '').trim(); })
    .map(function (r) { return { cls: String(r[0]).trim(), name: String(r[1]).trim(), birth: b2Iso_(r[2]), gender: String(r[3] || '').trim() }; });
}
function b2Info_() {
  var v = b2Sheet_(B2.SHEETS.info).getRange('G4:O20').getValues();
  return v.filter(function (r) { return /^\d+반$/.test(String(r[0]).trim()); }).map(function (r) {
    return { id: String(r[0]).replace('반', '').trim(), region: String(r[1] || ''), course: String(r[2] || ''), hrdName: String(r[3] || ''), teacher: String(r[4] || ''), phone: String(r[5] || ''), venue: String(r[6] || ''), address: String(r[7] || ''), tab: String(r[8] || '') || B2.SOURCE_TABS[String(r[0]).replace('반', '').trim()] || '' };
  });
}
function b2Log_(cls, name, date, before, after, path) {
  var sh = b2Ss_().getSheetByName(B2.SHEETS.log);
  if (!sh) { sh = b2Ss_().insertSheet(B2.SHEETS.log); sh.appendRow(['시각', '변경자', '경로', '반', '이름', '교육일', '이전', '이후']); sh.setFrozenRows(1); }
  sh.appendRow([new Date(), b2Actor_(), path || '2기 베타', cls ? cls + '반' : '', name || '', date || '', before || '', after || '']);
}
function b2Summary_(r) {
  if (!r) return '없음';
  var t = r.inT && r.outT ? ' ' + r.inT + '~' + r.outT : r.oa && r.ob ? ' ' + r.oa + '~' + r.ob : r.inT ? ' ' + r.inT : r.outT ? ' ' + r.outT : '';
  return r.type + t + (r.reason ? ' (' + r.reason + ')' : '') + (r.ev ? ' / 증빙 ' + r.ev : '') + (r.evr ? ' / 반려: ' + r.evr : '');
}

/* ---------- 반별 출결판(3001~3017) 새로 그리기 ---------- */
// A17:A48 이름, 16행 E열부터 교육일(최근일 먼저), 칸 값은 b2BoardCell_ (Code.gs와 같은 표기).
// 반별 출결판 칸 값은 Code.gs(rebuildBoard_)와 같은 표기: 출결원장 유형 그대로, 기록이 없으면 출석, 상태 변경일(마지막 출석일) 다음부터는 빈칸.
function b2BoardCell_(rec, person, date) {
  if (rec) return rec.type;
  if (person && person.status && person.status !== '재학' && person.changed && date > person.changed) return '';
  return '출석';
}
function b2RefreshBoards_(classes, ctx) {
  var ss = b2Ss_(), info = {}, byKey = {}, mainDay = ctx.today;
  b2Info_().forEach(function (c) { info[c.id] = c; });
  ctx.ledger.forEach(function (r) { byKey[b2Key_(r.rec)] = r.rec; });
  var dates = ctx.days.filter(function (d) { return d <= mainDay; }).reverse().slice(0, 60);
  // 탭 확인(읽기)을 먼저 모두 하고 쓰기를 몰아서 합니다. 읽기와 쓰기가 섞이면 반마다 시트가 다시 계산됩니다.
  var boards = [];
  classes.forEach(function (cls) {
    var tab = (info[cls] && info[cls].tab) || B2.SOURCE_TABS[cls], sh = tab && ss.getSheetByName(tab);
    if (sh && String(sh.getRange('A16').getValue()) === '이름') boards.push({ cls: cls, sh: sh, width: Math.min(60, sh.getMaxColumns() - 4) });
  });
  boards.forEach(function (b) {
    var cls = b.cls, sh = b.sh, width = b.width;
    var people = ctx.roster.filter(function (p) { return p.cls === String(cls); }).slice(0, 32);
    var names = [], grid = [];
    for (var i = 0; i < 32; i++) {
      var p = people[i]; names.push([p ? p.name : '']);
      var row = []; for (var j = 0; j < width; j++) row.push(p && dates[j] ? b2BoardCell_(byKey[cls + '|' + p.name + '|' + dates[j]], p, dates[j]) : '');
      grid.push(row);
    }
    var head = []; for (j = 0; j < width; j++) head.push(dates[j] ? b2DateValue_(dates[j]) : '');
    sh.getRange(17, 1, 32, 1).setValues(names);
    sh.getRange(16, 5, 1, width).setValues([head]);
    sh.getRange(17, 5, 32, width).setValues(grid);
  });
}
function b2BoardTouch_(cls, name, date, rec, person) {
  var info = b2Info_().filter(function (c) { return c.id === String(cls); })[0];
  var sh = b2Ss_().getSheetByName((info && info.tab) || B2.SOURCE_TABS[cls]); if (!sh) return;
  var names = sh.getRange(17, 1, 32, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var head = sh.getRange(16, 5, 1, Math.min(60, sh.getMaxColumns() - 4)).getValues()[0].map(b2Iso_);
  var r = names.indexOf(name), c = head.indexOf(date);
  if (r >= 0 && c >= 0) sh.getRange(17 + r, 5 + c).setValue(b2BoardCell_(rec, person, date));
}

/* ---------- 1기 운영총괄 → 마스터시트 동기화 ---------- */

var B2_SYNC_VERSION = '20261014.1'; // 바꾸면 다음 실행이 17개 반을 모두 다시 맞춥니다.
function b2A1Tab_(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
function b2JsonProp_(key, fallback) { try { var v = b2Props_().getProperty(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
function b2Msg_(e) { return String(e && e.message || e); }
// 일시 오류(예: 'Service Spreadsheets failed while accessing document')는 몇 초 쉬고 다시 시도합니다.
// fn은 여러 번 불러도 결과가 같은 일(같은 칸에 같은 값 쓰기, 읽기)만 넣습니다. 다시 시도한 기록은 실행 결과 retries에 남깁니다.
var B2_TRANSIENT = /failed while accessing document|timed out while accessing|Service error|server error occurred|try again|Internal error|Backend Error|currently unavailable|Service unavailable|too many times in a short time|Address unavailable/i;
var __B2_RETRIES = [];
function b2Retry_(label, fn) {
  var waits = B2.SYNC.retryWaits;
  for (var i = 0; ; i++) {
    try { return fn(); } catch (e) {
      var msg = b2Msg_(e);
      if (i >= waits.length || !B2_TRANSIENT.test(msg)) throw e;
      __B2_RETRIES.push(label + ': ' + msg.replace(/id [\w-]{20,}/g, 'id …').slice(0, 120));
      Utilities.sleep(waits[i]);
    }
  }
}
// 변경이력에서 since(yyyy-MM-dd) 이후 사람이 고친 학생·날짜('반|이름|날짜'). 기존 행 맞추기에서 뺍니다.
function b2HumanKeys_(since) {
  var sh = b2Ss_().getSheetByName(B2.SHEETS.log), keys = {};
  if (!sh) return keys;
  var last = b2LastRow_(sh, 1); if (last < 2) return keys;
  var from = b2DateValue_(since).getTime();
  sh.getRange(2, 1, last - 1, 6).getValues().forEach(function (r) {
    var at = r[0] instanceof Date ? r[0].getTime() : 0, cls = String(r[3] || '').replace(/반.*$/, '').trim(), name = String(r[4] || '').trim(), date = b2Iso_(r[5]);
    if (at >= from && cls && name && date && String(r[2] || '') !== '1기 동기화') keys[cls + '|' + name + '|' + date] = true;
  });
  return keys;
}
// 읽은 뒤 출결원장 행이 밀렸는지(누가 행을 지우거나 끼워 넣거나 정렬함). 이 계획을 쓰다 만 상태는 밀린 것으로 보지 않습니다.
function b2LedgerMoved_(ledger, origByRow, plan) {
  var sh = ledger.sh, last = b2LastRow_(sh, 1), top = Math.max(last, ledger.last);
  if (last > ledger.last + plan.appends.length) return true;
  if (top < 2) return false;
  var now = sh.getRange(2, 1, top - 1, 3).getValues().map(function (r) { return { date: b2Iso_(r[0]), cls: String(r[1]).trim(), name: String(r[2] || '').trim() }; });
  return !b2RowsAsPlanned_(origByRow, now, ledger.last, plan);
}
function b2Pad2d_(rows, h, w) {
  var out = [];
  for (var i = 0; i < h; i++) { var r = (rows || [])[i] || [], a = []; for (var j = 0; j < w; j++) a.push(r[j] == null ? '' : r[j]); out.push(a); }
  return out;
}

// 운영총괄 값 읽기. Google Sheets API 서비스(Sheets)가 추가돼 있으면 반 17개·서류·반정보를 한 번에 읽고,
// 없거나 실패하면 반마다 읽습니다. extras: 서류발급요청·반정보도 읽을지(전체 동기화)
function b2ReadSource_(sourceId, classes, extras) {
  var G = B2.GRID, h = G.lastRow - G.headerRow + 1, out = { mode: '', grids: {}, docs: null, info: null, errors: [], apiError: '', src: null };
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
    try {
      // 없는 탭이 하나라도 있으면 batchGet 전체가 실패하므로, 탭 이름을 먼저 보고 있는 탭만 읽습니다.
      var titles = {};
      ((b2Retry_('운영총괄 탭 목록(API)', function () { return Sheets.Spreadsheets.get(sourceId, { fields: 'sheets.properties.title' }); }) || {}).sheets || [])
        .forEach(function (s) { titles[s.properties && s.properties.title] = true; });
      var found = classes.filter(function (c) { if (titles[B2.SOURCE_TABS[c]]) return true; out.errors.push(c + '반: 운영총괄 탭을 찾지 못했습니다.'); return false; });
      var extra = extras ? [B2.SHEETS.srcDocs, B2.SHEETS.info].filter(function (n) { if (titles[n]) return true; out.errors.push(n + ': 운영총괄 탭을 찾지 못했습니다.'); return false; }) : [];
      var ranges = found.map(function (c) { return b2A1Tab_(B2.SOURCE_TABS[c]) + '!' + G.headerRow + ':' + G.lastRow; });
      extra.forEach(function (n) { ranges.push(b2A1Tab_(n) + (n === B2.SHEETS.srcDocs ? '!A1:Z' : '!G4:N20')); });
      var vr = ranges.length ? b2Retry_('운영총괄 읽기(API)', function () { return Sheets.Spreadsheets.Values.batchGet(sourceId, { ranges: ranges, valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' }); }).valueRanges || [] : [];
      found.forEach(function (c, i) {
        var rows = (vr[i] && vr[i].values) || [], grid = [];
        for (var r = 0; r < h; r++) grid.push((rows[r] || []).slice(G.nameCol - 1));
        out.grids[c] = grid;
      });
      extra.forEach(function (n, j) {
        var v = (vr[found.length + j] && vr[found.length + j].values) || [];
        if (n === B2.SHEETS.srcDocs) out.docs = v; else out.info = b2Pad2d_(v, 17, 8);
      });
      out.mode = 'api';
      return out;
    } catch (e) { out.apiError = b2Msg_(e); out.errors = []; out.grids = {}; out.docs = out.info = null; }
  }
  var src = out.src = b2Retry_('운영총괄 열기', function () { return SpreadsheetApp.openById(sourceId); });
  classes.forEach(function (c) {
    try {
      out.grids[c] = b2Retry_(c + '반 읽기', function () {
        var sh = src.getSheetByName(B2.SOURCE_TABS[c]);
        if (!sh) throw new Error('운영총괄 탭을 찾지 못했습니다.');
        var width = Math.max(1, Math.min(sh.getMaxColumns(), sh.getLastColumn()) - G.nameCol + 1);
        return sh.getRange(G.headerRow, G.nameCol, h, width).getDisplayValues();
      });
    } catch (e) { out.errors.push(c + '반: ' + b2Msg_(e)); }
  });
  if (extras) {
    try { out.docs = b2Retry_('서류발급요청 읽기', function () { return src.getSheetByName(B2.SHEETS.srcDocs).getDataRange().getDisplayValues(); }); } catch (e) { out.errors.push('서류발급요청: ' + b2Msg_(e)); }
    try { out.info = b2Retry_('반정보 읽기', function () { return src.getSheetByName(B2.SHEETS.info).getRange('G4:N20').getDisplayValues(); }); } catch (e) { out.errors.push('반정보: ' + b2Msg_(e)); }
  }
  out.mode = 'sheet';
  return out;
}
// 증빙 색(배경색)은 시트 방식으로 읽습니다(포털·첫 설치와 같은 기준). 값이 있는 칸 너비까지만 읽습니다.
function b2ReadBackgrounds_(read, sourceId, cls) {
  return b2Retry_(cls + '반 색 읽기', function () {
    var G = B2.GRID, src = read.src || (read.src = SpreadsheetApp.openById(sourceId)), sh = src.getSheetByName(B2.SOURCE_TABS[cls]);
    if (!sh) throw new Error('운영총괄 탭을 찾지 못했습니다.');
    var w = 1; (read.grids[cls] || []).forEach(function (r) { if (r && r.length > w) w = r.length; });
    w = Math.max(1, Math.min(w, sh.getMaxColumns() - G.nameCol + 1));
    return sh.getRange(G.headerRow, G.nameCol, G.lastRow - G.headerRow + 1, w).getBackgrounds();
  });
}
// 포털에서 저장한 반: 다음 동기화가 그 반을 다시 맞춰 T열(동기화 확인)을 새로 적습니다.
function b2MarkDirty_(cls) {
  var list = b2JsonProp_('B2_DIRTY', []);
  if (list.indexOf(String(cls)) < 0) { list.push(String(cls)); b2Props_().setProperty('B2_DIRTY', JSON.stringify(list)); }
}

// opts: {classes: ['3'] (없으면 전체), force: true면 바뀌지 않은 반도 다시 맞춤, reason: 'trigger'|'manual'|'setup'|'release'}
// 반마다 값 지문을 저장해 두고, 값이 바뀐 반·포털에서 저장한 반·색(증빙)이 바뀐 반만 출결원장에 반영합니다.
// 시트 쓰기는 모두 문서 잠금 안에서 하고, 일시 오류는 b2Retry_로 몇 초 쉬고 다시 시도합니다.
function b2SyncRun_(opts) {
  opts = opts || {};
  __B2_RETRIES = [];
  var props = b2Props_(), started = Date.now(), sourceId = b2SourceId_(), t = {};
  if (!sourceId) return { skipped: true, reason: '원본 시트가 없어 동기화하지 않습니다(2기 마스터).' };
  var all = !opts.classes || !opts.classes.length, srcUpdated = 0, today = b2Today_();
  var full = !!opts.force || props.getProperty('B2_SYNC_VERSION') !== B2_SYNC_VERSION;
  var dirty = all ? b2JsonProp_('B2_DIRTY', []) : [];
  // 날이 바뀐 뒤 첫 전체 동기화는 17개 반 출결판을 모두 다시 그립니다(새 교육일 열). 시트를 열 때(onOpen)는 그리지 않습니다.
  var drawAll = all && props.getProperty('B2_BOARD_DAY') !== today;
  // 지난 실행이 출결원장을 쓴 뒤 끊겼으면 남은 출결판 그리기와 변경 번호 올리기를 이어서 합니다.
  var pendingAtStart = all && !!props.getProperty('B2_PENDING_BOARDS');
  // 기존 행 맞추기(한 번, 사용자 결정 2026-10-13): 아직 맞추지 않은 반은 반영 대상에 넣고, 그 반을 맞춘 실행에서만 바꿉니다.
  var legacyLeft = [];
  if (all && (+props.getProperty('B2_LEGACY_ADOPTED') || 0) < 2) {
    var legacyDone = b2JsonProp_('B2_LEGACY_DONE', []);
    legacyLeft = Object.keys(B2.SOURCE_TABS).filter(function (c) { return legacyDone.indexOf(c) < 0; });
  }
  // 운영총괄이 바뀐 뒤 색 확인이 17개 반을 한 바퀴 돌 때까지(B2_COLOR_LAP번)는 파일이 그대로여도 계속 돕니다(색만 바꾼 경우를 잡기 위해).
  var lap = +props.getProperty('B2_COLOR_LAP') || 0, seenBefore = +props.getProperty('B2_SRC_SEEN') || 0, newDay = props.getProperty('B2_SYNC_DAY') !== today;
  if (all) {
    srcUpdated = b2Retry_('운영총괄 수정 시각', function () { return DriveApp.getFileById(sourceId).getLastUpdated().getTime(); });
    if (!full && !dirty.length && !drawAll && !lap && !pendingAtStart && props.getProperty('B2_SYNC_DAY') === today && srcUpdated <= seenBefore) {
      props.setProperty('B2_SYNC_CHECKED', String(Date.now()));
      return { skipped: true, reason: '운영총괄이 바뀌지 않았습니다.' };
    }
  }
  var wanted = all ? Object.keys(B2.SOURCE_TABS) : opts.classes.map(String).filter(function (c) { return B2.SOURCE_TABS[c]; });
  var days = b2Retry_('교육일자 읽기', b2Days_), salt = [B2_SYNC_VERSION, today, b2Hash_(days.list.join(','))].join('|');
  var hashes = b2JsonProp_('B2_SRC_HASH', {}), colors = b2JsonProp_('B2_SRC_COLOR', {});
  var read = b2ReadSource_(sourceId, wanted, all), errors = read.errors.slice(), warnings = [];
  t.read = Date.now() - started;
  var nextHash = {}, nextColor = {}, process = [], bgs = {};
  wanted.forEach(function (cls) {
    if (!read.grids[cls]) return;
    nextHash[cls] = b2Hash_(salt + '␞' + b2GridKey_(read.grids[cls]));
    if (full || hashes[cls] !== nextHash[cls] || dirty.indexOf(cls) >= 0 || legacyLeft.indexOf(cls) >= 0) process.push(cls);
  });
  // 증빙 색: 반영할 반은 모두 읽고, 나머지는 실행마다 몇 반씩 돌아가며 확인합니다(색만 바뀐 경우, 17개 반이 약 50분에 한 바퀴).
  var rot = all && !full ? b2Rotation_(wanted, props.getProperty('B2_COLOR_CURSOR'), B2.SYNC.colorPerTick) : { pick: [], next: +props.getProperty('B2_COLOR_CURSOR') || 0 };
  wanted.forEach(function (cls) {
    var queued = process.indexOf(cls) >= 0;
    if (!read.grids[cls] || (!queued && rot.pick.indexOf(cls) < 0)) return;
    try {
      bgs[cls] = b2ReadBackgrounds_(read, sourceId, cls);
      nextColor[cls] = b2Hash_(b2EvidenceKey_(read.grids[cls], bgs[cls]));
      if (!queued && colors[cls] !== nextColor[cls]) process.push(cls);
    } catch (e) {
      errors.push(cls + '반 색: ' + b2Msg_(e));
      if (queued) { process.splice(process.indexOf(cls), 1); delete nextHash[cls]; }
    }
  });
  t.colors = Date.now() - started - t.read;
  var docsKey = read.docs ? b2Hash_(b2GridKey_(read.docs)) : '', infoKey = read.info ? b2Hash_(b2GridKey_(read.info)) : '';
  var docsChanged = !!read.docs && (full || props.getProperty('B2_SRC_DOCS') !== docsKey);
  var infoChanged = !!read.info && (full || props.getProperty('B2_SRC_INFO') !== infoKey);
  var remember = function (done) {
    Object.keys(nextHash).forEach(function (c) { hashes[c] = nextHash[c]; });
    Object.keys(nextColor).forEach(function (c) { colors[c] = nextColor[c]; });
    props.setProperty('B2_SRC_HASH', JSON.stringify(hashes));
    props.setProperty('B2_SRC_COLOR', JSON.stringify(colors));
    if (all) props.setProperty('B2_COLOR_CURSOR', String(rot.next));
    if (read.docs) props.setProperty('B2_SRC_DOCS', docsKey);
    if (read.info) props.setProperty('B2_SRC_INFO', infoKey);
    if (done.length) {
      var left = b2JsonProp_('B2_DIRTY', []).filter(function (c) { return done.indexOf(c) < 0; });
      if (left.length) props.setProperty('B2_DIRTY', JSON.stringify(left)); else props.deleteProperty('B2_DIRTY');
    }
    if (all) {
      // 오류가 난 반은 지문을 저장하지 않으므로 운영총괄이 다시 바뀌거나 색 확인 한 바퀴 동안 다시 읽습니다.
      // 같은 오류가 계속되어도 빠른 건너뛰기가 막히지 않게 수정 시각은 늘 기억합니다(오류는 화면에 보임).
      props.setProperty('B2_SRC_SEEN', String(srcUpdated));
      var laps = full ? 0 : srcUpdated > seenBefore ? Math.ceil(wanted.length / B2.SYNC.colorPerTick) - 1 : Math.max(0, lap - 1);
      // 새로 읽은 실행(전체 다시 맞추기·운영총괄 변경)에서 읽기 오류가 난 반은 운영총괄이 그대로여도 두 번 더 읽어 봅니다. 같은 오류가 계속되면 그 뒤로는 건너뜁니다.
      if (errors.length && (full || newDay || srcUpdated > seenBefore)) laps = Math.max(laps, 2);
      if (laps) props.setProperty('B2_COLOR_LAP', String(laps)); else props.deleteProperty('B2_COLOR_LAP');
      props.setProperty('B2_SYNC_DAY', today);
      props.setProperty('B2_SYNC_VERSION', B2_SYNC_VERSION);
    }
    props.setProperty('B2_SYNC_CHECKED', String(Date.now()));
    props.deleteProperty('B2_SYNC_ERROR');
  };
  if (!process.length && !docsChanged && !infoChanged && !drawAll && !pendingAtStart) {
    var quiet = LockService.getDocumentLock();
    if (quiet.tryLock(10000)) { try { remember([]); } finally { quiet.releaseLock(); } }
    return { at: Date.now(), ms: Date.now() - started, reason: opts.reason || '', mode: read.mode, apiError: read.apiError, processed: [], colorChecked: rot.pick, nothing: true, errors: errors, retries: __B2_RETRIES.slice(), t: t };
  }
  if (Date.now() - started > B2.SYNC.budgetMs) {
    var late = { at: Date.now(), ms: Date.now() - started, reason: opts.reason || '', skipped: true, note: '운영총괄을 읽는 데 오래 걸려 반영은 다음 실행으로 미룹니다.', mode: read.mode, errors: errors, retries: __B2_RETRIES.slice(), t: t };
    props.setProperty('B2_SYNC_LAST', JSON.stringify(late));
    return late;
  }

  var desired = [], scope = {}, students = {};
  process.forEach(function (cls) {
    try {
      var parsed = b2ParseGrid_(cls, read.grids[cls], bgs[cls], today, days.set);
      desired = desired.concat(parsed.records); students[cls] = parsed.students;
      scope[cls] = {}; parsed.dates.forEach(function (d) { scope[cls][d] = true; });
    } catch (e) { errors.push(cls + '반: ' + b2Msg_(e)); delete nextHash[cls]; delete nextColor[cls]; }
  });
  var done = Object.keys(scope), adoptNow = legacyLeft.filter(function (c) { return done.indexOf(c) >= 0; });

  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  var result, t1 = Date.now(), rest = [], failedBoards = [];
  try {
    // 명부를 먼저 씁니다(출결원장 이름 칸의 명부 데이터 확인 규칙과 맞추기 위해).
    var roster = b2Retry_('명부 읽기', b2ReadRoster_);
    var rm = done.length ? b2MergeRoster_(roster.rows, students, b2Retry_('교육생정보 읽기', b2ReadPeople_)) : { updates: [], appends: [] };
    if (rm.updates.length || rm.appends.length) b2Retry_('명부 쓰기', function () { b2WriteRoster_(roster, rm); SpreadsheetApp.flush(); });
    var ledger = b2Retry_('출결원장 읽기', b2ReadLedger_), origByRow = {}, adopted = 0;
    ledger.rows.forEach(function (r) { origByRow[r.row] = { rec: b2Norm_(r.rec), prov: r.prov, sig: r.sig, flag: r.flag }; });
    if (adoptNow.length) {
      var adoptScope = {}; adoptNow.forEach(function (c) { adoptScope[c] = scope[c]; });
      adopted = b2AdoptLegacy_(ledger.rows, b2Retry_('변경이력 읽기', function () { return b2HumanKeys_(B2.SYNC.legacySince); }), adoptScope);
    }
    var merged = b2Merge_(ledger.rows, desired, scope);
    var plan = b2LedgerPlan_(merged.rows, merged.removed, origByRow);
    var writes = plan.patches.length + plan.appends.length + plan.clears.length;
    // 다시 그릴 출결판: 유형이 바뀐 반·명부가 바뀐 반(날이 바뀐 첫 실행·처음 설치는 전부).
    // 전체 동기화는 지난 실행이 남긴 반(B2_PENDING_BOARDS)도 그리고, 쓰기 전에 그릴 반을 적어 두어 쓰기 뒤에 끊기면 다음 실행이 이어서 그립니다.
    var boardClasses = [], addBoard = function (c) { c = String(c); if (c && c !== 'undefined' && boardClasses.indexOf(c) < 0) boardClasses.push(c); };
    if (drawAll || opts.reason === 'setup') wanted.forEach(addBoard);
    plan.patches.forEach(function (p) { if (p.rec) addBoard(p.cls); });
    plan.appends.forEach(function (r) { addBoard(r.rec.cls); });
    plan.removed.forEach(function (r) { addBoard(r.cls); });
    rm.appends.forEach(function (a) { addBoard(a.cls); });
    var rowCls = {}; roster.rows.forEach(function (r) { rowCls[r.row] = r.cls; });
    rm.updates.forEach(function (u) { if (u.status) addBoard(rowCls[u.row]); });
    if (all) { b2JsonProp_('B2_PENDING_BOARDS', []).forEach(addBoard); if (boardClasses.length) props.setProperty('B2_PENDING_BOARDS', JSON.stringify(boardClasses)); }
    if (writes) b2Retry_('출결원장 쓰기', function () { b2WriteLedgerPlan_(ledger, plan, origByRow); SpreadsheetApp.flush(); });
    t.write = Date.now() - t1;
    var infoFilled = infoChanged ? b2Retry_('반정보 채우기', function () { return b2FillInfo_(read.info); }) : 0;
    var docsAdded = docsChanged ? b2Retry_('서류발급 가져오기', function () { return b2ImportDocs_(read.docs); }) : 0;
    var s = merged.stats, changes = s.added + s.updated + s.removed + rm.updates.length + rm.appends.length + infoFilled + docsAdded;
    if (adoptNow.length) {
      var legacyAll = b2JsonProp_('B2_LEGACY_DONE', []); adoptNow.forEach(function (c) { if (legacyAll.indexOf(c) < 0) legacyAll.push(c); });
      if (Object.keys(B2.SOURCE_TABS).every(function (c) { return legacyAll.indexOf(c) >= 0; })) { props.setProperty('B2_LEGACY_ADOPTED', '2'); props.deleteProperty('B2_LEGACY_DONE'); }
      else props.setProperty('B2_LEGACY_DONE', JSON.stringify(legacyAll));
    }
    if (changes || writes || pendingAtStart) b2Bump_();
    if (changes) {
      try {
        b2Log_(done.length === 17 ? '' : done.join(','), '', '', '', '추가 ' + s.added + ' · 수정 ' + s.updated + ' · 삭제 ' + s.removed + ' · 확인 필요 ' + s.flagged + ' · 명부 ' + (rm.updates.length + rm.appends.length) + ' · 서류 ' + docsAdded + (adopted ? ' · 기존 행 맞추기 ' + adopted : ''), '1기 동기화');
      } catch (e) { warnings.push('변경이력: ' + b2Msg_(e)); }
    }
    t.total = Date.now() - started;
    result = {
      at: Date.now(), ms: t.total, reason: opts.reason || '', mode: read.mode, apiError: read.apiError, classes: wanted.length, processed: done, colorChecked: rot.pick,
      stats: s, legacyAdopted: adopted, writes: { patched: plan.patches.length, appended: plan.appends.length, cleared: plan.clears.length, boards: boardClasses.length },
      roster: { updated: rm.updates.length, added: rm.appends.length }, info: infoFilled, docs: docsAdded, errors: errors, warnings: warnings, retries: __B2_RETRIES.slice(), t: t
    };
    // 출결원장 반영은 여기서 끝났으므로 기록을 먼저 남깁니다. 출결판을 그리다 실패해도 다음 실행이 같은 반영을 되풀이하지 않습니다.
    props.setProperty('B2_SYNC_LAST', JSON.stringify(result));
    if (changes) props.setProperty('B2_SYNC_CHANGED', String(Date.now()));
    remember(done);
    // 출결판: 처음 몇 반은 이 잠금 안에서 그리고, 나머지는 잠금을 놓았다가 몇 반씩 다시 잡아 그립니다(아래).
    var t2 = Date.now(), firstBoards = boardClasses.slice(0, B2.SYNC.boardsPerLock);
    rest = boardClasses.slice(firstBoards.length);
    if (firstBoards.length) {
      var freshRoster = rm.updates.length || rm.appends.length ? b2Retry_('명부 읽기', b2ReadRoster_).rows : roster.rows;
      failedBoards = b2DrawBoardSet_(firstBoards, { ledger: merged.rows, roster: freshRoster, days: days.list, today: today }, warnings);
    }
    if (all) b2PendingBoards_(failedBoards.concat(rest), drawAll && !rest.length, today);
    else if (failedBoards.length) b2AddPendingBoards_(failedBoards);
    t.boards = Date.now() - t2;
  } finally { lock.releaseLock(); }
  // 출결원장 반영은 끝났으므로, 남은 출결판을 그리다 생긴 오류(잠금 대기 초과 등)는 경고로만 남깁니다. 남은 반은 B2_PENDING_BOARDS에 있습니다.
  if (rest.length) {
    try { failedBoards = failedBoards.concat(b2DrawBoardsInTurns_(rest, days.list, today, all, drawAll, failedBoards, warnings)); }
    catch (e) { warnings.push('출결판 그리기 중단: ' + b2Msg_(e)); if (!all) b2AddPendingBoards_(rest); }
    if (!all && failedBoards.length) b2AddPendingBoards_(failedBoards);
  }
  if (rest.length || warnings.length) {
    result.t.boards = (result.t.boards || 0) + (Date.now() - started - result.t.total);
    result.ms = result.t.total = Date.now() - started; result.retries = __B2_RETRIES.slice(); result.warnings = warnings;
    props.setProperty('B2_SYNC_LAST', JSON.stringify(result));
  }
  return result;
}
// 출결판 몇 반을 그립니다. 한꺼번에 그리다 실패하면 반마다 따로 그려 실패한 반만 골라냅니다.
// 실패한 반은 B2_BOARD_FAILS에 세고, B2.SYNC.boardFails번 실패하면 더 미루지 않고 경고로만 남깁니다(다음 날 전체 그리기 때 다시 시도).
// 돌려주는 값: 다음 실행에 다시 그릴 반
function b2DrawBoardSet_(classes, ctx, warnings) {
  var fails = b2JsonProp_('B2_BOARD_FAILS', {}), again = [], props = b2Props_();
  var draw = function (list) { b2Retry_('출결판 그리기', function () { b2RefreshBoards_(list, ctx); SpreadsheetApp.flush(); }); };
  var ok = function (c) { delete fails[c]; };
  var bad = function (c, e) {
    fails[c] = (fails[c] || 0) + 1; warnings.push(c + '반 출결판: ' + b2Msg_(e));
    if (fails[c] >= B2.SYNC.boardFails) { delete fails[c]; warnings.push(c + '반 출결판은 ' + B2.SYNC.boardFails + '번 실패해 다음 날 다시 그립니다.'); }
    else again.push(c);
  };
  try { draw(classes); classes.forEach(ok); }
  catch (e) {
    if (classes.length === 1) bad(classes[0], e);
    else classes.forEach(function (c) { try { draw([c]); ok(c); } catch (e2) { bad(c, e2); } });
  }
  if (Object.keys(fails).length) props.setProperty('B2_BOARD_FAILS', JSON.stringify(fails)); else props.deleteProperty('B2_BOARD_FAILS');
  return again;
}
// 전체 동기화의 '다음 실행에 그릴 출결판' 표시. 다 그렸으면(done) 오늘 전체 그리기를 끝낸 것으로 적습니다.
function b2PendingBoards_(list, done, today) {
  var props = b2Props_();
  if (list.length) props.setProperty('B2_PENDING_BOARDS', JSON.stringify(list)); else props.deleteProperty('B2_PENDING_BOARDS');
  if (done) props.setProperty('B2_BOARD_DAY', today);
}
// 한 반 가져오기처럼 일부 반만 맞춘 실행이 그리지 못한 반을 '남은 출결판'에 더합니다(이미 있는 목록은 그대로 둠).
function b2AddPendingBoards_(list) {
  var cur = b2JsonProp_('B2_PENDING_BOARDS', []);
  list.forEach(function (c) { if (cur.indexOf(String(c)) < 0) cur.push(String(c)); });
  if (cur.length) b2Props_().setProperty('B2_PENDING_BOARDS', JSON.stringify(cur));
}
// 남은 출결판을 몇 반씩(B2.SYNC.boardsPerLock) 잠금을 다시 잡아 그립니다. 그 사이 담임 저장(Code.gs)이 잠금을 오래 기다리지 않게 하기 위해서입니다.
// 잠금을 놓은 동안 출결원장·명부가 바뀌었을 수 있으니 매번 다시 읽습니다. 끊기면 B2_PENDING_BOARDS가 남아 다음 실행이 이어서 그립니다(전체 동기화만).
// 돌려주는 값: 이번에 실패해 다음 실행으로 넘긴 반
function b2DrawBoardsInTurns_(classes, days, today, all, drawAll, failedBefore, warnings) {
  var left = classes.slice(), failed = [];
  while (left.length) {
    var chunk = left.slice(0, B2.SYNC.boardsPerLock), lock = LockService.getDocumentLock(); lock.waitLock(30000);
    try {
      var ctx = { ledger: b2Retry_('출결원장 읽기', b2ReadLedger_).rows, roster: b2Retry_('명부 읽기', b2ReadRoster_).rows, days: days, today: today };
      failed = failed.concat(b2DrawBoardSet_(chunk, ctx, warnings));
      left = left.slice(chunk.length);
      if (all) b2PendingBoards_(failedBefore.concat(failed, left), drawAll && !left.length, today);
    } finally { lock.releaseLock(); }
  }
  return failed;
}
// 명부 쓰기(b2MergeRoster_ 결과). 같은 칸에 같은 값을 쓰므로 다시 시도해도 결과가 같습니다.
function b2WriteRoster_(roster, rm) {
  var sh = roster.sh;
  rm.updates.forEach(function (u) {
    if (u.status) sh.getRange(u.row, 4, 1, 2).setValues([[u.status, u.changed ? b2DateValue_(u.changed) : '']]);
    if (u.birth || u.gender) {
      var cur = sh.getRange(u.row, 7, 1, 2).getValues()[0];
      sh.getRange(u.row, 7, 1, 2).setValues([[u.birth ? b2DateValue_(u.birth) : cur[0], u.gender || cur[1]]]);
    }
  });
  if (rm.appends.length) {
    var at = roster.last + 1;
    if (sh.getMaxRows() < at + rm.appends.length - 1) sh.insertRowsAfter(sh.getMaxRows(), at + rm.appends.length - 1 - sh.getMaxRows());
    sh.getRange(at, 1, rm.appends.length, 5).setValues(rm.appends.map(function (a) { return [Number(a.cls), a.name, '', a.status, a.changed ? b2DateValue_(a.changed) : '']; }));
    sh.getRange(at, 7, rm.appends.length, 2).setValues(rm.appends.map(function (a) { return [a.birth ? b2DateValue_(a.birth) : '', a.gender]; }));
  }
}
function b2FillInfo_(srcRows) {
  var sh = b2Sheet_(B2.SHEETS.info), cur = sh.getRange('G4:N20').getValues(), filled = 0;
  var byId = {}; srcRows.forEach(function (r) { byId[String(r[0]).trim()] = r; });
  var next = cur.map(function (r) {
    var s = byId[String(r[0]).trim()]; if (!s) return r;
    return r.map(function (v, i) { if ((v === '' || v === null) && s[i] !== '' && s[i] !== null) { filled++; return s[i]; } return v; });
  });
  if (filled) sh.getRange('G4:N20').setValues(next);
  return filled;
}
function b2ImportDocs_(srcValues) {
  var sh = b2Sheet_(B2.SHEETS.docs), last = b2LastRow_(sh, 1), ids = {};
  var cur = last >= 2 ? sh.getRange(2, 1, last - 1, B2_DOC_FIELDS.length).getValues() : [];
  cur.forEach(function (r, i) { ids[String(r[0])] = { row: i + 2, values: r }; });
  var add = [], updated = 0;
  for (var i = 4; i < srcValues.length; i++) {
    var d = b2DocFromSource_(srcValues[i], i + 1); if (!d) continue;
    var have = ids[d.id];
    if (!have) { add.push(B2_DOC_FIELDS.map(function (k) { return d[k]; })); continue; }
    // 베타에서 처리하지 않은 1기 신청만 처리 상황·비고를 따라갑니다.
    if (!String(have.values[14] || '') && (String(have.values[8]) !== d.status || String(have.values[9]) !== d.memo)) { sh.getRange(have.row, 9, 1, 2).setValues([[d.status, d.memo]]); updated++; }
  }
  if (add.length) sh.getRange(last + 1, 1, add.length, B2_DOC_FIELDS.length).setValues(add);
  return add.length + updated;
}

// 10분 트리거가 부릅니다. 정한 시간(B2.SYNC.window, 기본 평일 09:10~18:00) 밖이면 바로 끝나고,
// 하루 사용 시간이 상한(B2.SYNC.dailyMs)을 넘으면 30분에 한 번만 돕니다. 6분 한도로 끊긴 실행은 다음 실행이 기록합니다.
function b2SyncTick() {
  var props = b2Props_(), now = new Date(), tz = b2Tz_();
  var spec = props.getProperty('B2_SYNC_WINDOW') || B2.SYNC.window;
  if (!b2InWindow_(spec, Utilities.formatDate(now, tz, 'u'), Utilities.formatDate(now, tz, 'HH:mm'))) return;
  var day = b2Today_(), usage = b2JsonProp_('B2_RUN_USAGE', null);
  if (!usage || usage.day !== day) usage = { day: day, ms: 0, runs: 0, cut: 0, lastAt: 0 };
  var running = +props.getProperty('B2_SYNC_RUNNING') || 0;
  if (running && Date.now() - running < 7 * 60 * 1000) return;
  if (running) { usage.cut++; usage.ms += 6 * 60 * 1000; props.setProperty('B2_SYNC_CUT', String(running)); }
  if (usage.ms > B2.SYNC.dailyMs && Date.now() - usage.lastAt < 30 * 60 * 1000) { props.setProperty('B2_RUN_USAGE', JSON.stringify(usage)); props.deleteProperty('B2_SYNC_RUNNING'); return; }
  props.setProperty('B2_SYNC_RUNNING', String(Date.now()));
  var t0 = Date.now();
  try { b2SyncRun_({ force: false, reason: 'trigger' }); }
  catch (e) { props.setProperty('B2_SYNC_ERROR', JSON.stringify({ at: Date.now(), message: b2Msg_(e) })); throw e; }
  finally {
    usage.ms += Date.now() - t0; usage.runs++; usage.lastAt = Date.now();
    props.setProperty('B2_RUN_USAGE', JSON.stringify(usage));
    props.deleteProperty('B2_SYNC_RUNNING');
  }
}

/* ---------- 편집기에서 한 번 실행 ---------- */

function b2Setup() {
  var ss = b2Ss_(), sh = b2Sheet_(B2.SHEETS.ledger);
  if (sh.getMaxColumns() < B2.COL.width) sh.insertColumnsAfter(sh.getMaxColumns(), B2.COL.width - sh.getMaxColumns());
  sh.getRange(1, B2.COL.prov, 1, 3).setValues([['출처', '동기화 지문', '동기화 확인']]);
  if (!ss.getSheetByName(B2.SHEETS.docs)) {
    var d = ss.insertSheet(B2.SHEETS.docs);
    d.getRange(1, 1, 1, 18).setValues([['신청번호', '요청 날짜', '요청반(담임)', '요청 교육생 이름', '생년월일', '요청사항', '제출처', '제출마감일', '처리 상황', '비고', '서류 종류', '수량', '받는 방법', '신청자', '처리자', '처리일시', '발급본 링크', '보완 사유']]);
    d.setFrozenRows(1);
  }
  if (!b2Props_().getProperty('B2_REV')) b2Props_().setProperty('B2_REV', '1');
  console.log('b2Setup 완료: 출결원장 R~T 머리글, 서류발급 탭 확인');
}
// 처음 한 번: 17개 반 전체를 가져오고 반별 출결판까지 새로 그립니다.
function b2ImportAll() { console.log(JSON.stringify(b2SyncRun_({ force: true, reason: 'setup' }))); }
function b2InstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'b2SyncTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('b2SyncTick').timeBased().everyMinutes(10).create();
  console.log('10분마다 b2SyncTick 실행을 등록했습니다.');
}
function b2RemoveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'b2SyncTick') ScriptApp.deleteTrigger(t); });
}

/* ---------- 포털에서 부르는 함수 (B2_ACTIONS) ---------- */

var B2_LEDGER_COLS = ['date', 'cls', 'name', 'type', 'inT', 'outT', 'oa', 'ob', 'reason', 'ev', 'evr', 'memo', 'evApplied', 'check', 'prov', 'flag', 'sig'];
function b2SyncState_() {
  var p = b2Props_(), parse = function (k) { try { return JSON.parse(p.getProperty(k) || 'null'); } catch (e) { return null; } };
  return { last: parse('B2_SYNC_LAST'), error: parse('B2_SYNC_ERROR'), checkedAt: +p.getProperty('B2_SYNC_CHECKED') || 0, changedAt: +p.getProperty('B2_SYNC_CHANGED') || 0, sourceSeen: +p.getProperty('B2_SRC_SEEN') || 0, window: p.getProperty('B2_SYNC_WINDOW') || B2.SYNC.window, usage: parse('B2_RUN_USAGE'), cutAt: +p.getProperty('B2_SYNC_CUT') || 0 };
}
// cls: '1'~'17' 또는 'all'. 개인정보(생년월일·성별)는 보내지 않습니다.
function b2Bundle(cls) {
  cls = String(cls || 'all');
  if (cls !== 'all' && !B2.SOURCE_TABS[cls]) throw new Error('반 번호를 확인해 주세요.');
  var days = b2Days_(), ledger = b2ReadLedger_().rows, roster = b2ReadRoster_().rows;
  var pick = function (x) { return cls === 'all' || x === cls; };
  return {
    rev: +b2Props_().getProperty('B2_REV') || 0, today: b2Today_(), days: days.list, classes: b2Info_(),
    roster: roster.filter(function (r) { return pick(r.cls); }).map(function (r) { return [r.cls, r.name, r.status, r.changed]; }),
    ledgerCols: B2_LEDGER_COLS,
    ledger: ledger.filter(function (r) { return pick(r.rec.cls); }).map(function (r) {
      var x = r.rec; return [x.date, x.cls, x.name, x.type, x.inT, x.outT, x.oa, x.ob, x.reason, x.ev, x.evr, r.memo, r.evApplied, r.check, r.prov, r.flag, b2Sig_(x)];
    }),
    sync: b2SyncState_()
  };
}
function b2Rev() { return { rev: +b2Props_().getProperty('B2_REV') || 0, sync: b2SyncState_() }; }
function b2Status() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'b2SyncTick'; }).length;
  var updated = 0, sourceId = b2SourceId_(); try { if (sourceId) updated = DriveApp.getFileById(sourceId).getLastUpdated().getTime(); } catch (e) { }
  return { rev: +b2Props_().getProperty('B2_REV') || 0, sync: b2SyncState_(), trigger: triggers > 0, sourceUpdated: updated, source: sourceId ? 'linked' : 'none' };
}
// p: {cls}가 있으면 그 반만(빠름), 없으면 17개 반 전체를 지금 가져옵니다.
function b2SyncNow(p) {
  var cls = p && p.cls ? [String(p.cls)] : null;
  return b2SyncRun_({ classes: cls, force: true, reason: 'manual' });
}
// 출결원장 한 행 저장. p: {cls,name,date,type,inT,outT,oa,ob,reason,ev,evr,before}
// before: 화면이 본 행 지문(없던 행은 ''). 그사이 바뀌었으면 CONFLICT로 막습니다. type '출석'은 출석으로 되돌림.
function b2Save(p) {
  p = p || {};
  var cls = String(p.cls || '').trim(), name = String(p.name || '').trim(), date = String(p.date || '').trim();
  var days = b2Days_(), roster = b2ReadRoster_().rows, person = roster.filter(function (r) { return r.cls === cls && r.name === name; })[0];
  var errors = b2Validate_(p, { days: days.set, today: b2Today_(), rosterHas: !!person });
  if (errors.length) throw new Error(errors[0]);
  var rec = b2Norm_({ date: date, cls: cls, name: name, type: p.type, inT: b2Time_(p.inT), outT: b2Time_(p.outT), oa: b2Time_(p.oa), ob: b2Time_(p.ob), reason: p.reason, ev: p.ev, evr: p.ev === '반려' ? p.evr : '' });
  var lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    var ledger = b2ReadLedger_(), key = b2Key_(rec), found = ledger.rows.filter(function (r) { return b2Key_(r.rec) === key; });
    if (found.length > 1) throw new Error('같은 학생·날짜 기록이 출결원장에 여러 줄입니다. 시트에서 한 줄로 정리해 주세요.');
    var cur = found[0] || null, curSig = cur ? b2Sig_(cur.rec) : '';
    if (p.before !== undefined && p.before !== null && String(p.before) !== curSig) {
      var err = new Error('CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다. 최신 값을 다시 읽었습니다.'); throw err;
    }
    if (!cur && rec.type === '출석') return { ok: true, unchanged: true, rev: +b2Props_().getProperty('B2_REV') || 0 };
    var row = cur ? cur.row : b2LastRow_(ledger.sh, 1) + 1;
    // 같은 행에 같은 값을 쓰므로 일시 오류 때 다시 시도해도 됩니다.
    b2Retry_('출결원장 저장', function () {
      if (ledger.sh.getMaxColumns() < B2.COL.width) ledger.sh.insertColumnsAfter(ledger.sh.getMaxColumns(), B2.COL.width - ledger.sh.getMaxColumns());
      if (ledger.sh.getMaxRows() < row) ledger.sh.insertRowsAfter(ledger.sh.getMaxRows(), row - ledger.sh.getMaxRows());
      ledger.sh.getRange(row, 1, 1, B2.COL.input).setValues([b2LedgerValues_(rec)]);
      if (!cur && row > 2) { ledger.sh.getRange(row, 1).setNumberFormat(ledger.sh.getRange(2, 1).getNumberFormat()); ledger.sh.getRange(row, 5, 1, 4).setNumberFormat('hh:mm'); }
      ledger.sh.getRange(row, B2.COL.prov, 1, 3).setValues([[B2.PROV_BETA, '', '']]);
      SpreadsheetApp.flush();
    });
    b2Log_(cls, name, date, cur ? b2Summary_(cur.rec) : '출석', rec.type === '출석' ? '출석' : b2Summary_(rec));
    try { b2BoardTouch_(cls, name, date, rec.type === '출석' ? null : rec, person); } catch (e) { }
    b2MarkDirty_(cls);
    var back = ledger.sh.getRange(row, 1, 1, B2.COL.width).getValues()[0];
    return { ok: true, rev: b2Bump_(), sig: b2Sig_(rec), memo: String(back[11] || ''), evApplied: String(back[14] || ''), check: String(back[16] || '') };
  } finally { lock.releaseLock(); }
}
// 베타에서 고친 행을 운영총괄 값으로 되돌립니다. p: {cls, name, date} 또는 {cls, flagged: true}(그 반 확인 필요 행 전체)
function b2Release(p) {
  p = p || {}; var cls = String(p.cls || '');
  if (!B2.SOURCE_TABS[cls]) throw new Error('반 번호를 확인해 주세요.');
  var lock = LockService.getDocumentLock(), count = 0; lock.waitLock(20000);
  try {
    var ledger = b2ReadLedger_();
    ledger.rows.forEach(function (r) {
      if (r.rec.cls !== cls) return;
      var hit = p.flagged ? (r.prov !== B2.PROV_SYNC && b2IsConflict_(r.flag)) : (r.rec.name === String(p.name || '').trim() && r.rec.date === String(p.date || ''));
      if (!hit) return;
      ledger.sh.getRange(r.row, B2.COL.prov, 1, 2).setValues([[B2.PROV_SYNC, '*']]); count++;
    });
    if (count) b2Log_(cls, p.flagged ? '' : p.name, p.flagged ? '' : p.date, '베타 수정 ' + count + '줄', '운영총괄 값으로 되돌림');
  } finally { lock.releaseLock(); }
  var result = count ? b2SyncRun_({ classes: [cls], force: true, reason: 'release' }) : null;
  return { released: count, sync: result };
}

/* 서류발급 */
function b2ReadDocs_() {
  var sh = b2Sheet_(B2.SHEETS.docs), last = b2LastRow_(sh, 1), out = [];
  if (last < 2) return { sh: sh, last: last, rows: out };
  sh.getRange(2, 1, last - 1, B2_DOC_FIELDS.length).getValues().forEach(function (r, i) {
    var d = { row: i + 2 }; B2_DOC_FIELDS.forEach(function (k, j) { d[k] = r[j] instanceof Date ? (k === 'handledAt' ? b2Fmt_(r[j], 'yyyy-MM-dd HH:mm') : b2Iso_(r[j])) : String(r[j] == null ? '' : r[j]); });
    if (d.id) out.push(d);
  });
  return { sh: sh, last: last, rows: out };
}
// p: {cls} 없으면 전체(관리자). 생년월일은 관리자에게만 보냅니다.
function b2Docs(p) {
  var cls = p && p.cls ? String(p.cls) : '', admin = __ACTOR_ROLE === 'ADMIN' || !__ACTOR_ROLE;
  return {
    rev: +b2Props_().getProperty('B2_REV') || 0, statuses: B2.DOC_STATUS, types: B2.DOC_TYPES, delivery: B2.DOC_DELIVERY,
    rows: b2ReadDocs_().rows.filter(function (d) { return !cls || String(d.cls).replace(/반.*$/, '') === cls; }).reverse()
      .map(function (d) { var x = {}; B2_DOC_FIELDS.forEach(function (k) { x[k] = d[k]; }); if (!admin) x.birth = ''; return x; })
  };
}
// p: {cls, name, docType, period, purpose, submitTo, due, qty, delivery, memo}
function b2DocCreate(p) {
  p = p || {};
  var cls = String(p.cls || '').trim(), name = String(p.name || '').trim(), docType = String(p.docType || '').trim();
  if (!B2.SOURCE_TABS[cls]) throw new Error('반을 골라 주세요.');
  var roster = b2ReadRoster_().rows;
  if (!roster.some(function (r) { return r.cls === cls && r.name === name; })) throw new Error('명부에 없는 교육생입니다.');
  if (!docType) throw new Error('서류 종류를 골라 주세요.');
  if (!String(p.submitTo || '').trim()) throw new Error('제출처를 적어 주세요.');
  if (p.due && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.due))) throw new Error('제출마감일을 확인해 주세요.');
  var qty = Math.max(1, Math.min(10, parseInt(p.qty, 10) || 1));
  ['period', 'purpose', 'submitTo', 'memo', 'docType'].forEach(function (k) { if (String(p[k] || '').length > 300) throw new Error('입력 내용은 300자 이하로 적어 주세요.'); });
  var person = b2ReadPeople_().filter(function (x) { return x.cls === cls && x.name.replace(/\s/g, '') === b2BaseName_(name).replace(/\s/g, ''); });
  var info = b2Info_().filter(function (c) { return c.id === cls; })[0] || {};
  var lock = LockService.getDocumentLock(), id, doc; lock.waitLock(20000);
  try {
    var docs = b2ReadDocs_(), today = b2Fmt_(new Date(), 'yyMMdd'), n = docs.rows.filter(function (d) { return d.id.indexOf('D' + today + '-') === 0; }).length + 1;
    id = 'D' + today + '-' + ('00' + n).slice(-3);
    doc = {
      id: id, requested: b2Today_(), cls: cls + '반' + (info.teacher ? '(' + info.teacher + ')' : ''), name: name, birth: person.length === 1 ? person[0].birth : '',
      detail: [p.period ? '기간: ' + p.period : '', p.purpose ? '목적: ' + p.purpose : ''].filter(Boolean).join(' · '), submitTo: String(p.submitTo).trim(), due: p.due || '',
      status: '접수', memo: String(p.memo || '').trim(), docType: docType, qty: String(qty), delivery: B2.DOC_DELIVERY.indexOf(p.delivery) >= 0 ? p.delivery : B2.DOC_DELIVERY[0],
      requester: b2Actor_(), handler: '', handledAt: '', link: '', fixReason: ''
    };
    docs.sh.getRange(docs.last + 1, 1, 1, B2_DOC_FIELDS.length).setValues([B2_DOC_FIELDS.map(function (k) { return doc[k]; })]);
  } finally { lock.releaseLock(); }
  var mailed = false;
  try {
    MailApp.sendEmail({
      to: B2.MAIL.join(','), name: 'HINT 운영포털',
      subject: '[HINT 서류발급] ' + cls + '반 ' + name + ' · ' + docType + (doc.due ? ' (마감 ' + doc.due + ')' : ''),
      body: ['새 서류발급 신청이 들어왔습니다.', '', '신청번호: ' + id, '반: ' + doc.cls, '교육생: ' + name, '서류: ' + docType + ' ' + doc.qty + '부', '요청사항: ' + (doc.detail || '-'),
        '제출처: ' + doc.submitTo, '제출마감일: ' + (doc.due || '-'), '받는 방법: ' + doc.delivery, '비고: ' + (doc.memo || '-'), '신청자: ' + doc.requester, '',
        '신청함: ' + B2.BETA_URL + '#documents', '마스터시트: ' + b2Ss_().getUrl() + '#gid=' + b2Sheet_(B2.SHEETS.docs).getSheetId()].join('\n')
    });
    mailed = true;
  } catch (e) { }
  b2Bump_();
  return { id: id, mailed: mailed };
}
// 관리자 처리. p: {id, status, memo, link, fixReason}
function b2DocUpdate(p) {
  p = p || {};
  if (B2.DOC_STATUS.indexOf(p.status) < 0) throw new Error('처리 상황을 골라 주세요.');
  if (p.status === '보완 필요' && !String(p.fixReason || '').trim()) throw new Error('보완 사유를 적어 주세요.');
  if (p.link && !/^https:\/\//.test(String(p.link))) throw new Error('발급본 링크는 https://로 시작해야 합니다.');
  var lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    var docs = b2ReadDocs_(), d = docs.rows.filter(function (x) { return x.id === String(p.id); })[0];
    if (!d) throw new Error('신청을 찾지 못했습니다.');
    var row = docs.sh.getRange(d.row, 1, 1, B2_DOC_FIELDS.length).getValues()[0];
    row[8] = p.status; if (p.memo !== undefined) row[9] = String(p.memo || '').slice(0, 300);
    row[14] = b2Actor_(); row[15] = new Date(); if (p.link !== undefined) row[16] = String(p.link || ''); row[17] = p.status === '보완 필요' ? String(p.fixReason || '').slice(0, 300) : '';
    docs.sh.getRange(d.row, 1, 1, B2_DOC_FIELDS.length).setValues([row]);
  } finally { lock.releaseLock(); }
  return { ok: true, rev: b2Bump_() };
}

var B2_ACTIONS = {
  b2Bundle: b2Bundle, b2Rev: b2Rev, b2Status: b2Status, b2SyncNow: b2SyncNow, b2Save: b2Save, b2Release: b2Release,
  b2Docs: b2Docs, b2DocCreate: b2DocCreate, b2DocUpdate: b2DocUpdate
};
