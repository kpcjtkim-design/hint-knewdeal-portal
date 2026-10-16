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
  SHEETS: { ledger: '출결원장', roster: '명부', days: '교육일자', info: '반정보', docs: '서류발급', people: '교육생정보', log: '변경이력', srcDocs: '서류발급요청',
    voc: '민원이슈', sched: '교육일정', srcSched: '전국 교육일정관리' },
  // 교육일정 탭(2026-10-16 회의: 시간표·교육일자·운영총괄 교육일정표를 한 탭으로): 8행 머리글, 9행부터 날짜 한 줄씩.
  // A 날짜 · B 요일 · C 교육일(O·휴일, 마스터가 정함) · D열부터 반마다 2칸(분야 · 강사). Code.gs SCHED와 같은 값입니다.
  SCHED: { head: 8, first: 9, firstCol: 4, perClass: 2 },
  // 민원·이슈(민원이슈 탭): A~J는 예전 그대로(C·D·J는 1행 배열 수식), K~P에 주고받기 기록을 둡니다.
  VOC_STATUS: ['접수', '처리중', '완료', '보류'],
  VOC_TYPES: ['수업·강사', '시설·환경', '출결', '행정·서류', '교육생 고충', '안전', '기타'],
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
  // 하루 트리거 사용 상한(넘으면 30분에 한 번), 한 번에 그릴 출결판 수, 출결판 실패 허용 횟수,
  // 일시 오류 때 쉬었다 다시 시도하는 간격, 기존 행 맞추기에서 뺄 '사람이 고친 행'을 변경이력에서 찾기 시작하는 날(beta2 설치일)
  // 실행 시간(6분 한도로 끊기면 흔적 없이 멈추므로 그 전에 스스로 멈춤): 한 실행에 쓸 시간(runMs), 남은 시간이 이보다 적으면
  // 잠금을 잡지 않고 쓰기를 다음 실행으로(writeMs, 곧 읽기·색 확인은 runMs-writeMs=3분까지), 출결원장 쓰기 직전(saveMs),
  // 출결판 한 차례(boardMs), 돌아가며 하는 색 확인 한 반(colorMs)에 남겨 둘 시간
  SYNC: { window: '1-5 09:10-18:00', colorPerTick: 4, dailyMs: 3600000, boardsPerLock: 4, boardFails: 3, retryWaits: [2000, 6000], legacySince: '2026-10-13',
    runMs: 300000, writeMs: 120000, saveMs: 60000, boardMs: 30000, colorMs: 30000 },
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
 * (tests/beta2-gas.test.mjs가 두 구현의 결과가 같은지 확인합니다.)
 * 명부 이름이 '(01년생)'뿐이면 기본 이름이 빈 글자라 indexOf('')가 제자리를 돌므로 그 이름은 기본 이름 찾기에서 건너뜁니다. */
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
    for (const name of unique) { const base = b2BaseName_(name); if (!base) continue; let at = 0; while ((at = line.indexOf(base, at)) >= 0) { const end = at + base.length; if (!hits.some(h => at < h.end && end > h.start)) hits.push({ name, names: unique.filter(n => b2BaseName_(n) === base), start: at, end, invalid: true }); at = end; } }
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
// 시트 시간대는 한 실행에 한 번만 묻습니다. 날짜 칸마다 물으면 실행 한 번에 1만 번 넘게 시트를 부르게 되어 6분 한도를 넘깁니다.
var __B2_TZ = '';
function b2Tz_() {
  if (!__B2_TZ) { try { __B2_TZ = b2Ss_().getSpreadsheetTimeZone() || B2.TZ; } catch (e) { __B2_TZ = B2.TZ; } }
  return __B2_TZ;
}
// 한 실행의 시작 시각. 동기화는 남은 시간(B2.SYNC.runMs 기준)을 단계마다 보고, 모자라면 6분 한도에 끊기기 전에 스스로 멈춥니다.
var __B2_T0 = 0, __B2_FMT = {};
function b2Begin_() { __B2_T0 = Date.now(); __B2_TZ = ''; __B2_FMT = {}; }
function b2Elapsed_() { return __B2_T0 ? Date.now() - __B2_T0 : 0; }
// 시작 시각이 없거나 6분보다 오래된 값(이 실행 것이 아님)이면 한도 없음으로 봅니다.
function b2LeftMs_() { var el = b2Elapsed_(); return !__B2_T0 || el > 6 * 60 * 1000 ? Infinity : B2.SYNC.runMs - el; }
// 단계 표시(B2_SYNC_PHASE). 6분 한도로 끊기면 다음 실행이 이 값을 B2_SYNC_CUT에 옮겨 어느 단계에서 멈췄는지 보여 줍니다.
function b2Phase_(phase) {
  var crumb = { phase: phase, at: Date.now(), ms: b2Elapsed_() };
  try { b2Props_().setProperty('B2_SYNC_PHASE', JSON.stringify(crumb)); } catch (e) { }
  console.log('b2 동기화 단계 ' + JSON.stringify(crumb));
}
// 날짜·시간 글자. 출결원장 한 번 읽기에 1만 번 가까이 부르지만 서로 다른 값은 수백 개라, 실행 안에서 바꾼 값을 기억합니다.
function b2Fmt_(d, pattern) { var k = pattern + '|' + d.getTime(); return k in __B2_FMT ? __B2_FMT[k] : (__B2_FMT[k] = Utilities.formatDate(d, b2Tz_(), pattern)); }
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
// lite: 동기화용. A~K(입력)와 R~T(출처·지문·확인)만 두 번에 읽고 L~Q 수식 열은 읽지 않습니다(memo·code·evApplied·check는 빈 값).
function b2ReadLedger_(lite) {
  var sh = b2Sheet_(B2.SHEETS.ledger), last = b2LastRow_(sh, 1), rows = [];
  if (last < 2) return { sh: sh, last: last, rows: rows };
  var fmt = b2Fmt_, v, meta = null;
  if (lite) {
    v = sh.getRange(2, 1, last - 1, B2.COL.input).getValues();
    var mw = Math.min(3, sh.getMaxColumns() - B2.COL.prov + 1);
    meta = mw > 0 ? sh.getRange(2, B2.COL.prov, last - 1, mw).getValues() : [];
  } else v = sh.getRange(2, 1, last - 1, Math.min(B2.COL.width, sh.getMaxColumns())).getValues();
  v.forEach(function (r, i) {
    if (!(r[0] instanceof Date) && !b2Iso_(r[0])) return;
    var m = meta ? meta[i] || [] : [r[17], r[18], r[19]];
    rows.push({
      row: i + 2,
      rec: { date: b2Iso_(r[0]), cls: String(r[1]).trim(), name: String(r[2] || '').trim(), type: String(r[3] || '').trim(), inT: b2Time_(r[4], fmt), outT: b2Time_(r[5], fmt), oa: b2Time_(r[6], fmt), ob: b2Time_(r[7], fmt), reason: String(r[8] || '').trim(), ev: String(r[9] || '').trim(), evr: String(r[10] || '').trim() },
      memo: String(r[11] || ''), code: String(r[12] || ''), evApplied: String(r[14] || ''), check: String(r[16] || ''),
      prov: String(m[0] || '').trim(), sig: String(m[1] || '').trim(), flag: String(m[2] || '').trim()
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
  // S열 서식은 이번에 지문을 쓰는 행에만 겁니다(열 전체에 매번 걸면 큰 시트에서 느립니다). 다른 행은 예전 실행이 이미 걸어 두었습니다.
  // 시트 다듬기(b2SlimSheet)도 S열 전체를 한 번 맞춰 두므로 다듬기 전후 모두 같은 방식입니다.
  var sigRows = plan.patches.filter(function (p) { return p.meta; }).map(function (p) { return { row: p.row, value: 0 }; });
  for (var i = 0; i < k; i++) sigRows.push({ row: last + 1 + i, value: 0 });
  var sigA1 = b2Runs_(sigRows).map(function (run) { return 'S' + run.row + ':S' + (run.row + run.values.length - 1); });
  if (sigA1.length) sh.getRangeList(sigA1).setNumberFormat('@');
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

/* ---------- 시트 다듬기: 무거운 수식을 Apps Script가 쓰는 값으로 (사용자 결정 2026-10-15) ----------
 * 출결원장 Q열(입력 확인: 행마다 COUNTIF로 원장 전체를 훑음)과 반 탭 C·D열(누적 출석률·증빙 미결: COUNTIFS)을 값으로 바꾸고,
 * 운영총괄(1기) 대시보드·누적관리의 INDIRECT(탭 이름) 수식은 직접 참조로 바꿉니다(시트가 바뀔 때마다 다시 계산되지 않게).
 * 편집기에서 b2SlimCheck(비교만, 쓰지 않음) → b2SlimSheet(바꾸기). 되돌리기는 b2RestoreFormulas('수식백업' 탭의 수식 그대로).
 * 바꾼 뒤(B2_SLIM=1)에만 출결원장·명부·교육일자를 쓰는 곳(동기화·b2Save·Code.gs 저장·직접 수정)이 Q값을 다시 계산해 바뀐 칸만 쓰고,
 * 출결판을 그리거나 한 칸 저장할 때 그 반 C·D값을 씁니다(수식을 값으로 바꾼 반 B2_SLIM_TABS만). 바꾸기 전에는 이 코드가 시트를 읽지도 쓰지도 않습니다. */
var B2_SLIM_Q = 17, B2_SLIM_BACKUP = '수식백업';
// 시트 개편(restructure.gs, 2026-10-16 회의) 뒤에는 대시보드 E27:H43이 직접 참조라 바꿀 것이 없고 누적관리 탭은 없습니다(탭 없음 메모도 남기지 않음).
var B2_SLIM_INDIRECT = [['운영총괄(1기) 대시보드', 'E6:J22'], ['운영총괄(1기) 대시보드', 'E27:H43'], ['운영총괄(1기) 누적관리', 'D12:H28']];
var B2_TIME_LATE = 33000 / 86400, B2_TIME_EARLY = 64200 / 86400; // TIME(9,10,0), TIME(17,50,0)

// 시트 날짜 값(1899-12-30 = 0, 시간은 하루의 몇 분의 몇)
function b2DaySerial_(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
function b2IsoSerial_(iso) { var p = String(iso).split('-').map(Number); return b2DaySerial_(p[0], p[1], p[2]); }
// getValues 값 → 수식이 보는 값: 날짜·시간은 시트 날짜 값(ser, 초 단위), 빈 칸은 ''
function b2SheetRows_(values, ser) {
  return (values || []).map(function (r) { return r.map(function (v) { return v instanceof Date ? ser(v) : v == null ? '' : v; }); });
}
// 수식의 &처럼 값을 글자로(숫자는 15자리, 참거짓은 TRUE/FALSE)
function b2SText_(v) { return typeof v === 'number' ? String(parseFloat(v.toPrecision(15))) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v == null ? '' : String(v); }
// 수식의 비교: 숫자 < 글자 < 참거짓 순, 글자는 대소문자 무시, 빈 칸은 숫자와 비교하면 0. 그래서 글자로 든 시간('09:05')은 어떤 시간보다도 큽니다.
function b2SCmp_(a, b) {
  if (a === '' && typeof b === 'number') a = 0;
  if (b === '' && typeof a === 'number') b = 0;
  var rank = function (v) { return typeof v === 'number' ? 0 : typeof v === 'boolean' ? 2 : 1; }, ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 1) { a = String(a).toLowerCase(); b = String(b).toLowerCase(); }
  return a < b ? -1 : a > b ? 1 : 0;
}
function b2SIs_(v, s) { return typeof v === 'string' && v.toLowerCase() === s; }
function b2Trim_(s) { return String(s).replace(/ {2,}/g, ' ').replace(/^ +| +$/g, ''); } // 시트 TRIM: 앞뒤 공백, 겹친 공백
// COUNTIF 와일드카드(* ? ~) → 정규식
function b2Wild_(s) {
  var re = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '~' && /[*?~]/.test(s.charAt(i + 1))) { re += '\\' + s.charAt(++i); continue; }
    re += ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : ch.replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}
// COUNTIF '같음' 조건: 숫자·날짜는 값으로, 글자는 대소문자 무시(* ? ~ 와일드카드). 날짜(2026-10-14)·숫자·TRUE처럼 보이는 글자 조건은 그 값으로 봅니다.
function b2Crit_(crit) {
  var c = crit;
  if (typeof c === 'string') {
    var d = c.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
    if (d) c = b2DaySerial_(+d[1], +d[2], +d[3]);
    else if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(c)) c = Number(c);
    else if (/^(true|false)$/i.test(c)) c = c.toLowerCase() === 'true';
  }
  if (typeof c === 'number') return { num: c, test: function (v) { return v === c; } };
  if (typeof c === 'boolean') return { test: function (v) { return v === c; } };
  c = b2SText_(c);
  if (/[*?~]/.test(c)) { var re = b2Wild_(c); return { test: function (v) { return typeof v === 'string' && re.test(v); } }; }
  var low = c.toLowerCase();
  return { text: low, test: function (v) { return typeof v === 'string' && v.toLowerCase() === low; } };
}
// COUNTIF를 행마다 범위 전체로 돌리지 않게 숫자·글자를 미리 셉니다. 와일드카드·참거짓 조건만 하나씩 봅니다.
function b2CountIndex_(values) {
  var ix = { n: Object.create(null), s: Object.create(null), list: values };
  values.forEach(function (v) {
    if (typeof v === 'number') ix.n[v] = (ix.n[v] || 0) + 1;
    else if (typeof v === 'string' && v !== '') { var k = v.toLowerCase(); ix.s[k] = (ix.s[k] || 0) + 1; }
  });
  return ix;
}
function b2CountIf_(ix, crit) {
  var p = b2Crit_(crit);
  return p.num !== undefined ? ix.n[p.num] || 0 : p.text !== undefined ? ix.s[p.text] || 0 : ix.list.filter(p.test).length;
}
/* 출결원장 Q1 수식(입력 확인)을 행마다 그대로 계산합니다. 조건부 서식(=$Q2<>"")이 이 글자를 보므로 글자까지 같아야 합니다(TRIM 뒤 끝의 ' ·'는 남음).
 * rows: 출결원장 2행부터 A~K(b2SheetRows_), days: 교육일자 A2:A, roster: 명부 A2:B. 돌려주는 값: 행마다 Q 글자('' = 문제 없음·빈 행) */
function b2QValues_(rows, days, roster) {
  var keys = rows.map(function (r) { return r[0] === '' ? '' : b2SText_(r[1]) + '|' + b2SText_(r[2]) + '|' + b2SText_(r[0]); }); // N열 키
  var dup = b2CountIndex_(keys), dayIx = b2CountIndex_(days);
  var people = b2CountIndex_(roster.map(function (r) { return r[1] === '' ? '' : b2SText_(r[0]) + '|' + b2SText_(r[1]); })); // 명부 F열 키
  var has = function (v) { return v !== ''; }, le = function (a, b) { return b2SCmp_(a, b) <= 0; };
  return rows.map(function (r, i) {
    if (r[0] === '') return '';
    var D = r[3], E = r[4], F = r[5], G = r[6], H = r[7], t = '';
    if (b2CountIf_(dup, keys[i]) > 1) t += '중복 기록 · ';
    if ((b2SIs_(D, '지각') || b2SIs_(D, '인정지각')) && !has(E)) t += '입실 시간 없음 · ';
    if ((b2SIs_(D, '조퇴') || b2SIs_(D, '인정조퇴')) && !has(F)) t += '퇴실 시간 없음 · ';
    if ((b2SIs_(D, '외출') || b2SIs_(D, '인정외출')) && (!has(G) || !has(H))) t += '외출 구간 없음 · ';
    if (b2SIs_(D, '지각') && has(E) && le(E, B2_TIME_LATE)) t += '09:10까지는 지각 아님 · ';
    if (b2SIs_(D, '조퇴') && has(F) && le(B2_TIME_EARLY, F)) t += '17:50 이후는 조퇴 아님 · ';
    if (has(G) && has(H) && le(H, G)) t += '외출 종료가 시작보다 빠름 · ';
    if (has(E) && has(F) && le(F, E)) t += '퇴실이 입실보다 빠름 · ';
    if (b2SText_(D).slice(0, 2) === '인정' && !has(r[8])) t += '인정 사유 없음 · ';
    if (b2SIs_(r[9], '반려') && !has(r[10])) t += '반려 사유 없음 · ';
    if (!b2CountIf_(dayIx, r[0])) t += '교육일 아님 · ';
    if (!b2CountIf_(people, b2SText_(r[1]) + '|' + b2SText_(r[2]))) t += '명부에 없는 이름 · ';
    return b2Trim_(t);
  });
}
// 교육일자 D5(주 교육일: 오늘까지의 마지막 교육일, 없으면 첫 교육일)·D4(그날까지 교육일 수). days: A2:A100, today: 오늘(시트 날짜 값)
function b2MainDay_(days, today) {
  var nums = days.filter(function (v) { return typeof v === 'number'; }), past = nums.filter(function (v) { return v <= today; });
  var main = past.length ? Math.max.apply(null, past) : nums.length ? Math.min.apply(null, nums) : 0;
  return { main: main, count: nums.filter(function (v) { return v <= main; }).length };
}
/* 반 탭 C17:D48 수식을 학생마다 계산합니다. C 누적 출석률 = (교육일수 − 주 교육일까지 결석 수) / 교육일수(교육일수 0이면 빈칸),
 * D 증빙 미결 = 증빙(적용: J열, 비었으면 인정 유형은 미제출)이 미제출·반려인 기록 수. 중도탈락 학생도 수식처럼 똑같이 셉니다.
 * rows: 출결원장 A~K(날짜는 시트 날짜 값), cls: 반 탭 D3, names: A17:A48, main·count: 교육일자 D5·D4. 돌려주는 값: [[C, D], …] */
function b2ClassStats_(rows, cls, names, main, count) {
  var inCls = b2Crit_(cls).test, mine = rows.filter(function (r) { return r[0] !== '' && inCls(r[1]); });
  return names.map(function (name) {
    if (name === '' || name == null) return ['', ''];
    var isName = b2Crit_(name).test, absent = 0, open = 0;
    mine.forEach(function (r) {
      if (!isName(r[2])) return;
      if (typeof r[0] === 'number' && r[0] <= main && b2SIs_(r[3], '결석')) absent++;
      var ev = r[9] !== '' ? r[9] : b2SText_(r[3]).slice(0, 2) === '인정' ? '미제출' : '해당없음';
      if (b2SIs_(ev, '미제출') || b2SIs_(ev, '반려')) open++;
    });
    return [count === 0 || count === '' ? '' : (count - absent) / count, open];
  });
}
// 이미 읽은 출결원장 행(b2ReadLedger_·b2Merge_의 rec) → b2ClassStats_ 행. 출결판을 그리는 쪽이 원장을 다시 읽지 않게.
function b2RowFromRec_(rec) { return [b2IsoSerial_(rec.date), Number(rec.cls), rec.name, rec.type, rec.inT, rec.outT, rec.oa, rec.ob, rec.reason, rec.ev, rec.evr]; }

/* INDIRECT("'"&$A6&"'!A13")처럼 탭 이름만 칸에서 가져오는 간접 참조 → 지금 탭 이름으로 된 직접 참조('1. 수도권_…'!A13).
 * resolve(참조 글자) → 그 칸 값(글자, 없으면 null), hasSheet(탭 이름). 칸 참조가 하나가 아니거나, 탭이 없거나, R1C1이면 그대로 두고 left로 셉니다. */
var B2_CELL_REF = /^(?:(?:'((?:[^']|'')+)'|([^'!&"(),\s]+))!)?\$?([A-Z]{1,3})\$?(\d+)$/i;
function b2RefParts_(ref) { var m = String(ref).match(B2_CELL_REF); return m ? { sheet: m[1] ? m[1].replace(/''/g, "'") : m[2] || '', a1: m[3].toUpperCase() + m[4] } : null; }
function b2QuoteEnd_(f, i) { var q = f.charAt(i); for (var j = i + 1; j < f.length; j++) if (f.charAt(j) === q) { if (f.charAt(j + 1) === q) j++; else return j; } return f.length - 1; }
function b2ParenEnd_(f, i) {
  for (var depth = 1; i < f.length; i++) {
    var ch = f.charAt(i);
    if (ch === '"' || ch === "'") i = b2QuoteEnd_(f, i);
    else if (ch === '(') depth++;
    else if (ch === ')' && !--depth) return i;
  }
  return -1;
}
// 맨 바깥의 sep(쉼표·&)로 나눕니다(글자·괄호 안은 그대로).
function b2SplitTop_(s, sep) {
  var parts = [], depth = 0, from = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '"' || ch === "'") i = b2QuoteEnd_(s, i);
    else if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (ch === sep && !depth) { parts.push(s.slice(from, i)); from = i + 1; }
  }
  parts.push(s.slice(from));
  return parts.map(function (p) { return p.trim(); });
}
function b2IndirectRef_(arg, resolve, hasSheet) {
  var args = b2SplitTop_(arg, ','), terms = b2SplitTop_(args[0], '&'), text = '', refs = 0;
  if (args.length > 2 || (args.length === 2 && !/^(TRUE|1)$/i.test(args[1]))) return '';
  for (var k = 0; k < terms.length; k++) {
    var t = terms[k];
    if (/^"(?:[^"]|"")*"$/.test(t)) { text += t.slice(1, -1).replace(/""/g, '"'); continue; }
    if (!B2_CELL_REF.test(t)) return '';
    var v = resolve(t); if (v == null || v === '') return '';
    text += v; refs++;
  }
  var m = text.match(/^'((?:[^']|'')+)'!(.+)$/), name = m ? m[1].replace(/''/g, "'") : '', range = m ? m[2] : '';
  if (!m && (m = text.match(/^([^'!]+)!(.+)$/))) { name = m[1]; range = m[2]; }
  if (refs !== 1 || !name || !/^\$?[A-Z]{1,3}\$?\d*(?::\$?[A-Z]{1,3}\$?\d*)?$/i.test(range) || !hasSheet(name)) return '';
  return b2A1Tab_(name) + '!' + range;
}
function b2DirectRefs_(formula, resolve, hasSheet) {
  var f = String(formula || ''), out = '', done = 0, left = 0, i = 0;
  while (i < f.length) {
    var ch = f.charAt(i), m = /^INDIRECT\s*\(/i.exec(f.slice(i, i + 20));
    if (ch === '"' || ch === "'") { var j = b2QuoteEnd_(f, i); out += f.slice(i, j + 1); i = j + 1; continue; }
    if (m && !/[\w.]/.test(f.charAt(i - 1))) {
      var end = b2ParenEnd_(f, i + m[0].length);
      if (end < 0) { out += f.slice(i); break; }
      var ref = b2IndirectRef_(f.slice(i + m[0].length, end), resolve, hasSheet);
      if (ref) { out += ref; done++; } else { out += f.slice(i, end + 1); left++; }
      i = end + 1; continue;
    }
    out += ch; i++;
  }
  return { formula: out, done: done, left: left };
}

function b2SlimOn_() { return b2Props_().getProperty('B2_SLIM') === '1'; }
// 날짜·시간 값 → 시트 날짜 값(초 단위). 시트 시간대로 읽고(1899년 시간 값도 표시와 같게), 같은 값은 한 번만 바꿉니다.
function b2SerialFn_(tz) {
  var seen = {};
  return function (d) {
    var t = d.getTime();
    if (!(t in seen)) {
      var p = Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss').split(/[- :]/).map(Number);
      seen[t] = b2DaySerial_(p[0], p[1], p[2]) + (p[3] * 3600 + p[4] * 60 + p[5]) / 86400;
    }
    return seen[t];
  };
}
// 교육일자 한 번 읽기: A2:A(Q의 교육일 확인)와 D4·D5(반 탭 C가 쓰는 교육일수·주 교육일). D4·D5가 숫자가 아니면 A2:A100과 오늘로 계산합니다.
function b2SlimDays_(ser) {
  var sh = b2Sheet_(B2.SHEETS.days), v = b2SheetRows_(sh.getRange(1, 1, sh.getMaxRows(), 4).getValues(), ser);
  var col = v.slice(1).map(function (r) { return r[0]; }), info = { main: v[4][3], count: v[3][3] };
  if (typeof info.main !== 'number' || typeof info.count !== 'number') info = b2MainDay_(col.slice(0, 99), b2IsoSerial_(b2Today_()));
  return { col: col, main: info.main, count: info.count };
}
function b2SlimRoster_(ser) { var sh = b2Sheet_(B2.SHEETS.roster); return b2SheetRows_(sh.getRange(2, 1, sh.getMaxRows() - 1, 2).getValues(), ser); }
// 반 탭 찾기: 반정보 O열 탭 이름, 없으면 운영총괄 탭 이름(b2RefreshBoards_와 같음)
function b2SlimBoard_(cls, info) {
  var c = info.filter(function (x) { return x.id === String(cls); })[0];
  return b2Ss_().getSheetByName((c && c.tab) || B2.SOURCE_TABS[cls] || '');
}
// 반 탭 C 수식은 그 탭 A2까지의 결석을 셉니다('출결원장'!$A:$A,"<="&$A$2. 보통 교육일자 D5와 같음). A2가 날짜·숫자가 아니면 D5를 씁니다.
function b2BoardMain_(a2, main) { return typeof a2 === 'number' ? a2 : main; }
// 반 탭 C17:D48에 쓸 값. 기준일(A2)·반 번호(D3)·이름(A17:A48)은 수식처럼 탭에서 읽습니다. A16이 '이름'이 아니면(출결판 아님) null.
function b2SlimBoardValues_(sh, rows, days, ser) {
  var top = b2SheetRows_(sh.getRange(2, 1, 47, 4).getValues(), ser);
  if (top[14][0] !== '이름') return null;
  var body = top.slice(15);
  return { a2: top[0][0], values: b2ClassStats_(rows, top[1][3], body.map(function (r) { return r[0]; }), b2BoardMain_(top[0][0], days.main), days.count), cur: body.map(function (r) { return [r[2], r[3]]; }) };
}
// 시트 다듬기에서 C·D 수식을 값으로 바꾼 반({반: true}). 바꾸지 않은 탭(수식이 없던 탭)의 C17:D48은 쓰지 않습니다.
function b2SlimTabs_() { var o = {}; b2JsonProp_('B2_SLIM_TABS', []).forEach(function (c) { o[String(c)] = true; }); return o; }
// 출결판을 그릴 때 쓸 반 탭 C·D값(바꾸지 않은 반이면 null). slim: b2SlimBase_ 결과, a2: 그 탭 A2 값(getValue)
function b2SlimBoardStats_(slim, cls, names, a2) {
  if (!slim || !slim.tabs[String(cls)]) return null;
  return b2ClassStats_(slim.rows, Number(cls), names, b2BoardMain_(a2 instanceof Date ? slim.ser(a2) : a2, slim.main), slim.count);
}
// 출결판 그리기용: 원장 A~K 값(Code.gs loadBase_가 이미 읽은 것, 또는 b2RowFromRec_ 행: rowsReady)과 교육일자 D4·D5, 바꾼 반 목록
function b2SlimBase_(values, tz, rowsReady) {
  var ser = b2SerialFn_(tz), d = b2SlimDays_(ser);
  return { rows: rowsReady ? values : b2SheetRows_(values, ser), main: d.main, count: d.count, ser: ser, tabs: b2SlimTabs_() };
}

/* 출결원장·명부를 쓴 뒤 문서 잠금 안에서 부릅니다. 시트 다듬기 전(B2_SLIM 없음)이면 바로 끝납니다.
 * 원장 전체로 Q값을 다시 계산해 바뀐 칸만 씁니다(붙은 칸은 한 번에. 고친 행의 중복 짝 행도 여기서 함께 바뀜).
 * opts.classes 반은 탭 C·D값도 씁니다(출결판을 다시 그리지 않는 한 칸 저장용. 그릴 때는 b2RefreshBoards_·Code.gs rebuildBoard_가 씀).
 * opts.onlyIfDirty: 지난 계산이 실패했을 때만(동기화가 쓴 것이 없을 때). 실패해도 저장을 막지 않고 B2_SLIM_DIRTY를 남겨 다음에 다시 계산합니다. */
function b2SlimRefresh_(opts) {
  if (!b2SlimOn_()) return null;
  opts = opts || {};
  var props = b2Props_();
  if (opts.onlyIfDirty && !props.getProperty('B2_SLIM_DIRTY')) return null;
  try {
    // 먼저 표시해 둡니다: 계산 중에 실행 한도(트리거 6분·onEdit 30초)로 끊겨도 다음 호출이 다시 계산하게.
    props.setProperty('B2_SLIM_DIRTY', '1');
    // 읽기를 먼저 모두 하고 쓰기를 몰아서 합니다(섞이면 그때마다 시트가 다시 계산됨).
    var ser = b2SerialFn_(b2Tz_()), sh = b2Sheet_(B2.SHEETS.ledger), n = sh.getMaxRows() - 1;
    var rows = b2SheetRows_(sh.getRange(2, 1, n, B2.COL.input).getValues(), ser), cur = sh.getRange(2, B2_SLIM_Q, n, 1).getValues();
    var days = b2SlimDays_(ser), q = b2QValues_(rows, days.col, b2SlimRoster_(ser)), changed = [];
    var tabs = opts.classes && opts.classes.length ? b2SlimTabs_() : {}, classes = (opts.classes || []).filter(function (c) { return tabs[String(c)]; });
    var info = classes.length ? b2Info_() : [], boards = [];
    classes.forEach(function (c) { var b = b2SlimBoard_(c, info), cd = b && b2SlimBoardValues_(b, rows, days, ser); if (cd) boards.push({ sh: b, values: cd.values }); });
    q.forEach(function (v, i) { if (String(cur[i][0] == null ? '' : cur[i][0]) !== v) changed.push({ row: i + 2, value: [v] }); });
    b2Runs_(changed).forEach(function (run) { sh.getRange(run.row, B2_SLIM_Q, run.values.length, 1).setValues(run.values); });
    boards.forEach(function (b) { b.sh.getRange(17, 3, 32, 2).setValues(b.values); });
    // Q값은 /beta2 묶음(check)에 들어갑니다. 변경 번호를 Q를 쓴 뒤에 다시 올려, 그사이 캐시된 묶음·열린 화면이 새 Q를 읽게 합니다.
    if (changed.length) b2Bump_();
    props.deleteProperty('B2_SLIM_DIRTY');
    return { q: changed.length, boards: boards.length };
  } catch (e) { props.setProperty('B2_SLIM_DIRTY', '1'); return { error: b2Msg_(e) }; }
}
// 동기화가 쓸 것이 없을 때(빠른 건너뛰기·바뀐 것 없음): 지난 Q 계산이 끊기거나 잠금을 못 잡아 B2_SLIM_DIRTY가 남았으면
// (Code.gs 직접 수정·저장 쪽 포함) 여기서 다시 계산합니다. 남은 시간이 모자라거나 잠금이 바쁘면 다음 실행으로 넘깁니다.
function b2SlimPending_() {
  if (!b2Props_().getProperty('B2_SLIM_DIRTY') || !b2SlimOn_() || b2LeftMs_() < B2.SYNC.boardMs) return null;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return null;
  try { b2Phase_('slim'); return b2SlimRefresh_({ onlyIfDirty: true }); } finally { lock.releaseLock(); }
}

// 시트 다듬기 계획(쓰지 않음): Q값·반 탭 C·D값·직접 참조로 바꿀 수식, 백업할 수식, 지금 수식 결과와 계산이 다른 칸.
// strict(b2SlimSheet): 출결원장 Q1에 배열 수식이 없으면 멈춥니다.
function b2SlimPlan_(strict) {
  var ss = b2Ss_(), ser = b2SerialFn_(b2Tz_()), led = b2Sheet_(B2.SHEETS.ledger), n = led.getMaxRows() - 1;
  var rows = b2SheetRows_(led.getRange(2, 1, n, B2.COL.input).getValues(), ser), cur = led.getRange(2, B2_SLIM_Q, n, 1).getValues();
  var q1 = led.getRange(1, B2_SLIM_Q).getFormula(), days = b2SlimDays_(ser), info = b2Info_();
  if (strict && !/ARRAYFORMULA/i.test(q1)) throw new Error('출결원장 Q1에 배열 수식이 없습니다(이미 값이거나 다른 수식). 바꾸지 않았습니다.');
  var plan = { led: led, q: b2QValues_(rows, days.col, b2SlimRoster_(ser)), last: 0, backups: [], boards: [], formulas: [], notes: [], blocked: [], diff: { q: 0, cd: 0, examples: [] } };
  // 입력 거부 규칙(데이터 확인 '입력 거부')이 걸린 칸은 Sheets가 규칙에 맞지 않는 값·수식 결과를 받지 않습니다(2026-10-16 대시보드 F27 '완료, 미완료').
  // 값으로 바꿀 칸(Q·C/D)에 있으면 아무것도 쓰기 전에 멈추고(blocked), 대시보드 수식 칸이면 INDIRECT를 그대로 둡니다(guarded).
  var rejects = function (rg) { return rg.getDataValidations().map(function (r) { return r.map(function (v) { return !!v && !v.getAllowInvalid(); }); }); };
  var same = function (a, b) { return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : b2SText_(a) === b2SText_(b); };
  var diff = function (kind, where, sheet, mine) {
    if (same(sheet, mine)) return;
    plan.diff[kind]++;
    if (plan.diff.examples.length < 5) plan.diff.examples.push(where + " 수식 '" + b2SText_(sheet) + "' / 계산 '" + b2SText_(mine) + "'");
  };
  plan.q.forEach(function (v, i) { if (rows[i][0] !== '') plan.last = i + 1; diff('q', 'Q' + (i + 2), cur[i][0], v); });
  if (q1) plan.backups.push([B2.SHEETS.ledger, 'Q1', q1, 'Q2:Q']);
  // Q열 전체(바꾼 뒤 동기화·저장도 아래 행까지 씀)
  rejects(led.getRange(1, B2_SLIM_Q, led.getMaxRows(), 1)).forEach(function (r, i) { if (r[0]) plan.blocked.push(B2.SHEETS.ledger + '!Q' + (i + 1)); });
  Object.keys(B2.SOURCE_TABS).forEach(function (cls) {
    var sh = b2SlimBoard_(cls, info), cd = sh && b2SlimBoardValues_(sh, rows, days, ser), found = 0;
    if (!cd) { plan.notes.push(cls + '반 출결판 탭 없음'); return; }
    sh.getRange(17, 3, 32, 2).getFormulas().forEach(function (r, i) {
      r.forEach(function (x, j) {
        if (!x) return;
        var col = j ? 'D' : 'C'; found++;
        plan.backups.push([sh.getName(), col + (17 + i), x, /ARRAYFORMULA/i.test(x) && i < 31 ? col + (18 + i) + ':' + col + '48' : '']);
      });
    });
    // 수식이 없어도 비교는 합니다(바꾼 뒤 b2SlimCheck로 값이 맞는지 볼 수 있게).
    cd.values.forEach(function (r, i) { diff('cd', sh.getName() + '!C' + (17 + i), cd.cur[i][0], r[0]); diff('cd', sh.getName() + '!D' + (17 + i), cd.cur[i][1], r[1]); });
    if (cd.a2 !== days.main) plan.notes.push(cls + '반 A2가 교육일자 D5와 다름(' + (typeof cd.a2 === 'number' ? 'C는 수식처럼 A2 기준' : 'A2가 날짜가 아니라 C는 D5 기준') + ')');
    if (found) {
      plan.boards.push({ cls: cls, sh: sh, values: cd.values });
      rejects(sh.getRange(17, 3, 32, 2)).forEach(function (r, i) { r.forEach(function (x, j) { if (x) plan.blocked.push(sh.getName() + '!' + (j ? 'D' : 'C') + (17 + i)); }); });
    } else plan.notes.push(cls + '반 C17:D48에 수식 없음(그대로 둠)');
  });
  var cache = {}, left = [], guarded = [], hasSheet = function (name) { return !!ss.getSheetByName(name); };
  B2_SLIM_INDIRECT.forEach(function (t) {
    var sh = ss.getSheetByName(t[0]);
    if (!sh) { if (!b2Props_().getProperty('B2_RESTRUCTURE')) plan.notes.push(t[0] + ' 탭 없음'); return; }
    var rg = sh.getRange(t[1]), r0 = rg.getRow(), c0 = rg.getColumn(), rej = rejects(rg);
    var resolve = function (ref) {
      var p = b2RefParts_(ref); if (!p) return null;
      var name = p.sheet || t[0], key = name + '!' + p.a1;
      if (!(key in cache)) { var s = ss.getSheetByName(name); cache[key] = s ? b2SText_(s.getRange(p.a1).getValue()) : null; }
      return cache[key];
    };
    rg.getFormulas().forEach(function (row, i) {
      row.forEach(function (x, j) {
        if (!/INDIRECT/i.test(x)) return;
        var a1 = b2ColName_(c0 + j) + (r0 + i);
        if (rej[i][j]) { guarded.push(t[0] + '!' + a1); return; } // 같은 결과라도 다시 넣으면 거부될 수 있어 그대로 둠(백업에도 넣지 않음)
        var res = b2DirectRefs_(x, resolve, hasSheet);
        if (res.left) left.push(t[0] + '!' + a1);
        if (res.done) { plan.backups.push([t[0], a1, x, '']); plan.formulas.push({ sh: sh, row: r0 + i, col: c0 + j, formula: res.formula }); }
      });
    });
  });
  if (left.length) plan.notes.push('INDIRECT를 그대로 둔 칸 ' + left.length + '개: ' + left.slice(0, 5).join(', '));
  if (guarded.length) plan.notes.push('입력 거부 규칙이 있어 INDIRECT를 그대로 둔 칸 ' + guarded.length + '개: ' + guarded.slice(0, 5).join(', '));
  if (plan.blocked.length) {
    var where = plan.blocked.length + '개: ' + plan.blocked.slice(0, 5).join(', ');
    plan.notes.push('입력 거부 규칙이 있어 값으로 바꿀 수 없는 칸 ' + where);
    if (strict) throw new Error("입력 거부 규칙이 있는 칸이 있어 바꾸지 않았습니다(" + where + "). 그 칸의 데이터 확인을 '경고 표시'로 바꾸거나 지운 뒤 다시 실행해 주세요.");
  }
  return plan;
}
function b2ColName_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
function b2SlimSummary_(plan) {
  return { qRows: plan.last, boards: plan.boards.length, formulas: plan.formulas.length, backups: plan.backups.length, differ: plan.diff, notes: plan.notes };
}
// 같은 탭·같은 줄에 붙은 수식 칸끼리 한 번에 쓰기 위해 묶습니다.
function b2SlimRuns_(list) {
  var runs = [];
  list.forEach(function (x) {
    var cur = runs[runs.length - 1];
    if (cur && cur.sh === x.sh && cur.row === x.row && cur.col + cur.values.length === x.col) cur.values.push(x.formula);
    else runs.push({ sh: x.sh, row: x.row, col: x.col, values: [x.formula] });
  });
  return runs;
}
// 편집기에서만 실행하는 함수의 첫 줄. 같은 프로젝트의 웹 앱(doGet 담임 포털, '나로 실행')에서는 끝이 '_'가 아닌 함수를
// 누구나 google.script.run으로 부를 수 있으므로, 부른 사람과 실행 계정이 같을 때만(편집기에서 직접 실행) 진행합니다.
// 웹 앱은 소유자 계정으로 실행되고 방문자 이메일은 빈 칸이거나 다른 계정입니다. 이미 쓰는 이메일 권한이라 새 승인은 없습니다.
function b2EditorOnly_() {
  var who = ''; try { who = Session.getActiveUser().getEmail(); } catch (e) { }
  if (!who || who !== Session.getEffectiveUser().getEmail()) throw new Error('편집기에서 직접 실행할 때만 쓸 수 있습니다(웹 앱으로는 부를 수 없음).');
}
// 바꾸기 전 확인(편집기에서, 쓰지 않음): 지금 수식 결과와 Apps Script 계산이 다른 칸 수·예시와 바꿀 수식 수를 로그에 남깁니다.
function b2SlimCheck() { b2EditorOnly_(); var s = b2SlimSummary_(b2SlimPlan_(false)); console.log('b2SlimCheck: ' + JSON.stringify(s)); return s; }
// 편집기에서 한 번 실행: 바꿀 수식을 숨긴 '수식백업' 탭에 남기고 값·직접 참조로 바꾼 뒤 B2_SLIM=1. 되돌리기 전에는 다시 실행되지 않습니다.
// 전부 바꾸거나 하나도 안 바꿉니다: 백업을 먼저 저장하고(flush) 대시보드 직접 참조 → 출결원장 Q·반 탭 C/D 값 순서로 씁니다.
// 중간에 쓰기가 실패하면 바꾼 칸만 백업 수식으로 되돌리고 백업 탭을 지운 뒤 오류를 냅니다. 값만 바뀌고 B2_SLIM이 꺼진 채
// (코드가 다시 계산하지 않는) 반쯤 바뀐 상태를 남기지 않기 위해서입니다(2026-10-16 대시보드 F27 입력 거부 규칙에 막혀 멈춘 일).
function b2SlimSheet() {
  b2EditorOnly_();
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    var ss = b2Ss_(), props = b2Props_(), back = ss.getSheetByName(B2_SLIM_BACKUP);
    var already = '이미 시트 다듬기를 했습니다. 다시 하려면 먼저 b2RestoreFormulas로 되돌려 주세요.';
    if (props.getProperty('B2_SLIM') === '1') throw new Error(already);
    // 남은 백업 탭: 백업한 수식이 모두 제자리에 있으면(지난 실행이 멈춘 뒤 되돌림) 새 백업으로 덮어쓰고, 바뀐 칸이 있으면 막습니다.
    if (back && back.getLastRow() > 1 && b2RestoreDiff_(ss, b2BackupList_(back)).todo.length) throw new Error(already);
    var plan = b2SlimPlan_(true), led = plan.led;
    // 1) 수식 백업부터 씁니다(중간에 끊겨도 b2RestoreFormulas로 되돌릴 수 있게). 앞에 '를 붙여 글자로 둡니다(그러지 않으면 수식으로 들어감).
    back = back || ss.insertSheet(B2_SLIM_BACKUP);
    if (back.getLastRow() > 1) back.getRange(2, 1, back.getLastRow() - 1, 4).clearContent();
    if (back.getMaxRows() < plan.backups.length + 1) back.insertRowsAfter(back.getMaxRows(), plan.backups.length + 1 - back.getMaxRows());
    back.getRange(1, 1, plan.backups.length + 1, 4).setValues([['탭', '칸', '수식', '되돌릴 때 비울 칸']].concat(plan.backups.map(function (b) { return ["'" + b[0], b[1], "'" + b[2], b[3]]; })));
    back.hideSheet();
    SpreadsheetApp.flush();
    var extended = 0;
    try {
      // 2) 대시보드·누적관리 직접 참조(바꾼 칸만, 같은 줄에 붙은 칸은 한 번에). 입력 거부 규칙 칸은 계획에서 빠져 INDIRECT 그대로입니다.
      //    여기서 멈추면 Q·C/D는 아직 수식이라 시트 값은 그대로 맞습니다.
      b2SlimRuns_(plan.formulas).forEach(function (run) { run.sh.getRange(run.row, run.col, 1, run.values.length).setFormulas([run.values]); });
      SpreadsheetApp.flush();
      // 3) 출결원장: 빈 행이 500보다 적으면 1000행 늘리고 S열(동기화 지문) 서식을 한 번에 글자로. Q1은 머리글만 남기고 Q값을 씁니다.
      extended = led.getMaxRows() - 1 - plan.last < 500 ? 1000 : 0;
      if (extended) led.insertRowsAfter(led.getMaxRows(), extended);
      if (led.getMaxColumns() >= B2.COL.sig) led.getRange(2, B2.COL.sig, led.getMaxRows() - 1, 1).setNumberFormat('@');
      led.getRange(1, B2_SLIM_Q).setValue('입력 확인');
      if (plan.last) led.getRange(2, B2_SLIM_Q, plan.last, 1).setValues(plan.q.slice(0, plan.last).map(function (v) { return [v]; }));
      // 4) 반 탭 C17:D48 값
      plan.boards.forEach(function (b) { b.sh.getRange(17, 3, 32, 2).setValues(b.values); });
      SpreadsheetApp.flush();
    } catch (e) {
      var undone = null, removed = false;
      try {
        undone = b2RestoreList_(ss, plan.backups.map(function (b) { return { tab: b[0], a1: b[1], f: b[2], clear: b[3] }; }));
        b2Bump_(); ss.deleteSheet(back); removed = true;
      } catch (e2) { }
      throw new Error('시트 다듬기를 끝내지 못했습니다(' + b2Msg_(e) + '). ' + (removed ? '바꾼 칸 ' + undone.restored + '개를 수식으로 되돌리고 백업 탭을 지웠습니다. 시트는 바꾸기 전과 같습니다.'
        : undone ? "바꾼 칸은 되돌렸지만 '" + B2_SLIM_BACKUP + "' 탭을 지우지 못했습니다. b2RestoreFormulas를 한 번 실행하면 지워집니다."
        : "되돌리지 못했습니다. 편집기에서 b2RestoreFormulas를 실행해 주세요('" + B2_SLIM_BACKUP + "' 탭에 수식이 남아 있습니다)."));
    }
    // 값으로 바꾼 반만 적어 둡니다. 동기화·저장·출결판 그리기는 이 반의 C17:D48만 씁니다(수식이 없던 탭은 그대로).
    props.setProperty('B2_SLIM_TABS', JSON.stringify(plan.boards.map(function (b) { return b.cls; })));
    props.setProperty('B2_SLIM', '1'); props.deleteProperty('B2_SLIM_DIRTY');
    b2Bump_(); // Q(check)가 수식 결과에서 값으로 바뀜: 묶음 캐시·열린 화면이 다시 읽게
    var s = b2SlimSummary_(plan); s.extendedRows = extended;
    console.log('b2SlimSheet 완료: ' + JSON.stringify(s));
    return s;
  } finally { lock.releaseLock(); }
}
// '수식백업' 탭 → [{tab, a1, f, clear}]. 앞의 '는 글자로 두려고 붙인 것이라 뗍니다.
function b2BackupList_(back) {
  var txt = function (v) { return String(v == null ? '' : v).replace(/^'/, ''); };
  return back.getRange(2, 1, back.getLastRow() - 1, 4).getValues().map(function (r) { return { tab: txt(r[0]), a1: txt(r[1]), f: txt(r[2]), clear: txt(r[3]) }; })
    .filter(function (r) { return r.tab && r.a1 && r.f.charAt(0) === '='; });
}
function b2A1Cell_(a1) {
  var m = /^([A-Z]{1,3})(\d+)$/i.exec(String(a1)); if (!m) return null;
  var col = 0; m[1].toUpperCase().split('').forEach(function (ch) { col = col * 26 + ch.charCodeAt(0) - 64; });
  return { row: +m[2], col: col };
}
// 백업 목록 중 지금 수식이 백업과 다른 칸(되돌릴 칸). 탭마다 백업 칸을 감싸는 범위를 한 번에 읽습니다.
function b2RestoreDiff_(ss, list) {
  var byTab = {}, todo = [], same = 0, missing = [];
  list.forEach(function (r) { (byTab[r.tab] = byTab[r.tab] || []).push(r); });
  Object.keys(byTab).forEach(function (tab) {
    var sh = ss.getSheetByName(tab), items = byTab[tab];
    if (!sh) { items.forEach(function (r) { missing.push(tab + '!' + r.a1); }); return; }
    var cells = items.map(function (r) { return b2A1Cell_(r.a1); }), ok = cells.filter(Boolean), cur = null, r0 = 0, c0 = 0;
    if (ok.length) {
      var rows = ok.map(function (c) { return c.row; }), cols = ok.map(function (c) { return c.col; });
      r0 = Math.min.apply(null, rows); c0 = Math.min.apply(null, cols);
      cur = sh.getRange(r0, c0, Math.max.apply(null, rows) - r0 + 1, Math.max.apply(null, cols) - c0 + 1).getFormulas();
    }
    items.forEach(function (r, i) { var c = cells[i]; if (c && cur[c.row - r0][c.col - c0] === r.f) same++; else todo.push({ sh: sh, r: r }); });
  });
  return { todo: todo, same: same, missing: missing };
}
// 되돌릴 칸만 씁니다: 배열 수식이 펼쳐질 칸의 값을 먼저 지우고 수식을 넣습니다. 지금 수식이 백업과 같은 칸은 건드리지 않습니다
// (바꾸지 않은 칸에 같은 수식을 다시 넣다가 입력 거부 규칙에 막히지 않게. 2026-10-16 대시보드 F27).
function b2RestoreList_(ss, list) {
  var d = b2RestoreDiff_(ss, list);
  d.todo.forEach(function (x) { if (x.r.clear) x.sh.getRange(x.r.clear).clearContent(); });
  d.todo.forEach(function (x) { x.sh.getRange(x.r.a1).setFormula(x.r.f); });
  SpreadsheetApp.flush();
  return { restored: d.todo.length, unchanged: d.same, missing: d.missing };
}
// 편집기에서 실행: '수식백업' 탭의 수식을 되돌립니다(바뀐 칸만). 배열 수식이 펼쳐질 칸의 값을 먼저 지우고, 다 되면 백업 탭을 지웁니다.
// 지난 b2SlimSheet가 멈춘 뒤 남은 백업 탭도 이것으로 지웁니다(바뀐 칸이 없으면 restored 0).
function b2RestoreFormulas() {
  b2EditorOnly_();
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    var ss = b2Ss_(), props = b2Props_(), back = ss.getSheetByName(B2_SLIM_BACKUP);
    if (!back || back.getLastRow() < 2) throw new Error("되돌릴 수식이 없습니다('" + B2_SLIM_BACKUP + "' 탭이 없거나 비었습니다).");
    // 먼저 끕니다: 되살린 배열 수식이 펼쳐질 칸에 Q값을 다시 쓰지 않게(중간에 끊기면 이 함수를 다시 실행하면 됨).
    props.deleteProperty('B2_SLIM'); props.deleteProperty('B2_SLIM_DIRTY'); props.deleteProperty('B2_SLIM_TABS');
    var s;
    try { s = b2RestoreList_(ss, b2BackupList_(back)); }
    catch (e) { throw new Error('수식을 되돌리다 멈췄습니다(' + b2Msg_(e) + "). '" + B2_SLIM_BACKUP + "' 탭은 남겨 두었습니다. 원인을 고친 뒤 다시 실행해 주세요."); }
    b2Bump_(); // Q가 다시 수식 결과가 됨: 묶음 캐시·열린 화면이 다시 읽게
    if (!s.missing.length) ss.deleteSheet(back);
    s.missing = s.missing.slice(0, 10);
    console.log('b2RestoreFormulas 완료: ' + JSON.stringify(s));
    return s;
  } finally { lock.releaseLock(); }
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
    var tab = (info[cls] && info[cls].tab) || B2.SOURCE_TABS[cls], sh = tab && ss.getSheetByName(tab), top = sh && sh.getRange('A2:A16').getValues();
    if (top && String(top[14][0]) === '이름') boards.push({ cls: cls, sh: sh, width: Math.min(60, sh.getMaxColumns() - 4), a2: top[0][0] });
  });
  // 시트 다듬기(b2SlimSheet) 뒤에는 바꾼 반 탭 C·D(누적 출석률·증빙 미결)도 값으로 씁니다. 원장은 다시 읽지 않고 ctx.ledger로 계산합니다.
  var slim = boards.length && b2SlimOn_() ? b2SlimBase_(ctx.ledger.map(function (r) { return b2RowFromRec_(r.rec); }), b2Tz_(), true) : null;
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
    var cd = b2SlimBoardStats_(slim, cls, names.map(function (n) { return n[0]; }), b.a2);
    if (cd) sh.getRange(17, 3, 32, 2).setValues(cd);
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
// 'timed out'은 이미 한도만큼 기다린 호출이라 다시 하지 않고, 남은 실행 시간이 쉬는 시간+방금 시도한 시간보다 적어도 다시 하지 않습니다.
var B2_TRANSIENT = /failed while accessing document|timed out while accessing|Service error|server error occurred|try again|Internal error|Backend Error|currently unavailable|Service unavailable|too many times in a short time|Address unavailable/i;
var __B2_RETRIES = [];
function b2Retry_(label, fn) {
  var waits = B2.SYNC.retryWaits;
  for (var i = 0; ; i++) {
    var t = Date.now();
    try { return fn(); } catch (e) {
      var msg = b2Msg_(e);
      if (i >= waits.length || !B2_TRANSIENT.test(msg) || /timed out/i.test(msg) || b2LeftMs_() < waits[i] + (Date.now() - t)) throw e;
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

// 운영총괄 값 읽기. Google Sheets API 서비스(Sheets)가 추가돼 있으면 반 17개·서류·반정보·교육일정표를 한 번에 읽고,
// 없으면 반마다 읽습니다. extras: 서류발급요청·반정보·전국 교육일정관리도 읽을지(전체 동기화)
// fallback: API가 일시 오류로 실패했을 때도 반마다 읽기로 넘어갈지(전체 다시 맞추기, 또는 지난 실행도 API가 실패함). 10분 실행은 반마다
// 17번 읽다 6분 한도에 걸리기 쉬우므로 처음 한 번은 mode 없이 apiError만 돌려주고 다음 실행이 API로 다시 읽습니다.
// 일시 오류가 아니면(권한 없음·API 꺼짐 등) 다음 실행도 같으므로 바로 반마다 읽습니다. 반마다 읽기는 반마다 남은 시간을 봅니다.
function b2ReadSource_(sourceId, classes, extras, fallback) {
  var G = B2.GRID, h = G.lastRow - G.headerRow + 1, out = { mode: '', grids: {}, docs: null, info: null, sched: null, errors: [], apiError: '', src: null };
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
    try {
      // 없는 탭이 하나라도 있으면 batchGet 전체가 실패하므로, 탭 이름을 먼저 보고 있는 탭만 읽습니다.
      var titles = {};
      ((b2Retry_('운영총괄 탭 목록(API)', function () { return Sheets.Spreadsheets.get(sourceId, { fields: 'sheets.properties.title' }); }) || {}).sheets || [])
        .forEach(function (s) { titles[s.properties && s.properties.title] = true; });
      var found = classes.filter(function (c) { if (titles[B2.SOURCE_TABS[c]]) return true; out.errors.push(c + '반: 운영총괄 탭을 찾지 못했습니다.'); return false; });
      // 교육일정표는 있으면 가져오는 자료라 탭이 없어도 오류로 세지 않습니다(교육일정 탭의 분야·강사만 채움).
      var extra = extras ? [B2.SHEETS.srcDocs, B2.SHEETS.info, B2.SHEETS.srcSched].filter(function (n) { if (titles[n]) return true; if (n !== B2.SHEETS.srcSched) out.errors.push(n + ': 운영총괄 탭을 찾지 못했습니다.'); return false; }) : [];
      var ranges = found.map(function (c) { return b2A1Tab_(B2.SOURCE_TABS[c]) + '!' + G.headerRow + ':' + G.lastRow; });
      extra.forEach(function (n) { ranges.push(b2A1Tab_(n) + (n === B2.SHEETS.srcDocs ? '!A1:Z' : n === B2.SHEETS.info ? '!G4:N20' : '!A1:CZ500')); });
      var vr = ranges.length ? b2Retry_('운영총괄 읽기(API)', function () { return Sheets.Spreadsheets.Values.batchGet(sourceId, { ranges: ranges, valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' }); }).valueRanges || [] : [];
      found.forEach(function (c, i) {
        var rows = (vr[i] && vr[i].values) || [], grid = [];
        for (var r = 0; r < h; r++) grid.push((rows[r] || []).slice(G.nameCol - 1));
        out.grids[c] = grid;
      });
      extra.forEach(function (n, j) {
        var v = (vr[found.length + j] && vr[found.length + j].values) || [];
        if (n === B2.SHEETS.srcDocs) out.docs = v; else if (n === B2.SHEETS.info) out.info = b2Pad2d_(v, 17, 8); else out.sched = v;
      });
      out.mode = 'api';
      return out;
    } catch (e) { out.apiError = b2Msg_(e); out.errors = []; out.grids = {}; out.docs = out.info = out.sched = null; if (!fallback && B2_TRANSIENT.test(out.apiError)) return out; }
  }
  var src = out.src = b2Retry_('운영총괄 열기', function () { return SpreadsheetApp.openById(sourceId); });
  classes.forEach(function (c) {
    // 시간이 모자라면 나머지 반은 읽지 않습니다(short: 이 실행은 아무것도 기억하지 않고 잠금 전에 멈추며, 다음 실행이 다시 읽음).
    if (b2LeftMs_() < B2.SYNC.writeMs) { out.short = true; out.errors.push(c + '반: 실행 시간이 모자라 다음 실행에서 읽습니다.'); return; }
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
    try {
      out.sched = b2Retry_('전국 교육일정관리 읽기', function () { var s = src.getSheetByName(B2.SHEETS.srcSched); return s ? s.getDataRange().getDisplayValues() : null; });
    } catch (e) { out.errors.push(B2.SHEETS.srcSched + ': ' + b2Msg_(e)); }
  }
  out.mode = 'sheet';
  return out;
}
// 증빙 색(배경색)은 시트 방식으로 읽습니다(포털·첫 설치와 같은 기준). 값이 있는 칸 너비까지만 읽습니다.
// 운영총괄은 한 실행에 한 번만 엽니다(열기에 실패하면 그 실행의 나머지 반도 바로 실패). 다시 시도하지 않습니다:
// 색은 다음 실행에서 다시 확인하면 되고, 느리게 실패한 호출을 되풀이하면 실행 시간만 늘어납니다.
function b2ReadBackgrounds_(read, sourceId, cls) {
  var G = B2.GRID;
  if (!read.src) {
    if (read.srcError) throw new Error(read.srcError);
    try { read.src = SpreadsheetApp.openById(sourceId); } catch (e) { read.srcError = '운영총괄 열기: ' + b2Msg_(e); throw new Error(read.srcError); }
  }
  var sh = read.src.getSheetByName(B2.SOURCE_TABS[cls]);
  if (!sh) throw new Error('운영총괄 탭을 찾지 못했습니다.');
  var w = 1; (read.grids[cls] || []).forEach(function (r) { if (r && r.length > w) w = r.length; });
  w = Math.max(1, Math.min(w, sh.getMaxColumns() - G.nameCol + 1));
  return sh.getRange(G.headerRow, G.nameCol, G.lastRow - G.headerRow + 1, w).getBackgrounds();
}
// 포털에서 저장한 반: 다음 동기화가 그 반을 다시 맞춰 T열(동기화 확인)을 새로 적습니다.
function b2MarkDirty_(cls) {
  var list = b2JsonProp_('B2_DIRTY', []);
  if (list.indexOf(String(cls)) < 0) { list.push(String(cls)); b2Props_().setProperty('B2_DIRTY', JSON.stringify(list)); }
}

// opts: {classes: ['3'] (없으면 전체), force: true면 바뀌지 않은 반도 다시 맞춤, reason: 'trigger'|'manual'|'setup'|'release'}
// 반마다 값 지문을 저장해 두고, 값이 바뀐 반·포털에서 저장한 반·색(증빙)이 바뀐 반만 출결원장에 반영합니다.
// 시트 쓰기는 모두 문서 잠금 안에서 하고, 일시 오류는 b2Retry_로 몇 초 쉬고 다시 시도합니다.
// 단계마다 B2_SYNC_PHASE를 남기고 남은 실행 시간을 봅니다. 모자라면 쓰기 전에 멈추고(B2_SYNC_LAST.late) 다음 실행이 처음부터 다시 맞춥니다.
function b2SyncRun_(opts) {
  opts = opts || {};
  __B2_RETRIES = [];
  if (!__B2_T0 || b2Elapsed_() > 6 * 60 * 1000) b2Begin_();
  var props = b2Props_(), started = Date.now(), sourceId = b2SourceId_(), t = {}, read = null, errors = [];
  if (!sourceId) return { skipped: true, reason: '원본 시트가 없어 동기화하지 않습니다(2기 마스터).' };
  b2Phase_('start');
  // 시간이 모자라 멈춘 실행의 기록. 지문·수정 시각을 기억하지 않으므로 다음 실행이 같은 반영을 처음부터 다시 합니다.
  var stop = function (phase, note) {
    var r = { at: Date.now(), ms: Date.now() - started, reason: opts.reason || '', skipped: true, late: phase, note: note, mode: read ? read.mode : '', errors: errors, retries: __B2_RETRIES.slice(), t: t };
    props.setProperty('B2_SYNC_LAST', JSON.stringify(r));
    b2Phase_('done');
    return r;
  };
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
    b2Phase_('drive');
    srcUpdated = b2Retry_('운영총괄 수정 시각', function () { return DriveApp.getFileById(sourceId).getLastUpdated().getTime(); });
    if (!full && !dirty.length && !drawAll && !lap && !pendingAtStart && props.getProperty('B2_SYNC_DAY') === today && srcUpdated <= seenBefore) {
      props.setProperty('B2_SYNC_CHECKED', String(Date.now()));
      var slimQuiet = b2SlimPending_();
      b2Phase_('done');
      return { skipped: true, reason: '운영총괄이 바뀌지 않았습니다.', slim: slimQuiet };
    }
  }
  var wanted = all ? Object.keys(B2.SOURCE_TABS) : opts.classes.map(String).filter(function (c) { return B2.SOURCE_TABS[c]; });
  b2Phase_('days');
  var days = b2Retry_('교육일자 읽기', b2Days_), salt = [B2_SYNC_VERSION, today, b2Hash_(days.list.join(','))].join('|');
  var hashes = b2JsonProp_('B2_SRC_HASH', {}), colors = b2JsonProp_('B2_SRC_COLOR', {});
  if (b2LeftMs_() < B2.SYNC.writeMs) return stop('source', '실행 시간이 모자라 운영총괄 읽기와 반영을 다음 실행으로 미룹니다.');
  b2Phase_('source');
  // API 읽기가 일시 오류로 한 번 실패하면 이번 실행은 끝내고 다음 실행이 API로 다시 읽습니다. 이어서 또 실패하면(B2_API_FAILS) 반마다 읽기로 넘어갑니다.
  var apiFails = +props.getProperty('B2_API_FAILS') || 0;
  read = b2ReadSource_(sourceId, wanted, all, full || apiFails > 0); errors = read.errors.slice();
  if (read.apiError) props.setProperty('B2_API_FAILS', String(apiFails + 1)); else if (apiFails && read.mode === 'api') props.deleteProperty('B2_API_FAILS');
  var warnings = [];
  t.read = Date.now() - started;
  if (read.apiError && !read.mode) {
    // 10분 실행에서 API 읽기가 일시 오류로 처음 실패하면 반마다 읽기로 넘어가지 않고 끝냅니다. 수정 시각을 기억하지 않으므로 다음 실행이 다시 읽습니다.
    errors.push('운영총괄 읽기(API): ' + read.apiError);
    var apiFail = { at: Date.now(), ms: Date.now() - started, reason: opts.reason || '', skipped: true, mode: 'api', apiError: read.apiError, note: '운영총괄을 Sheets API로 읽지 못해 다음 실행에서 다시 읽습니다.', errors: errors, retries: __B2_RETRIES.slice(), t: t };
    props.setProperty('B2_SYNC_LAST', JSON.stringify(apiFail));
    b2Phase_('done');
    return apiFail;
  }
  var nextHash = {}, nextColor = {}, process = [], bgs = {};
  wanted.forEach(function (cls) {
    if (!read.grids[cls]) return;
    nextHash[cls] = b2Hash_(salt + '␞' + b2GridKey_(read.grids[cls]));
    if (full || hashes[cls] !== nextHash[cls] || dirty.indexOf(cls) >= 0 || legacyLeft.indexOf(cls) >= 0) process.push(cls);
  });
  // 증빙 색: 반영할 반은 모두 읽고, 나머지는 실행마다 몇 반씩 돌아가며 확인합니다(색만 바뀐 경우, 17개 반이 약 50분에 한 바퀴).
  // 돌아가며 하는 확인은 색 읽기가 한 번 실패하거나 시간이 모자라면 그 자리에서 멈춥니다. 다음 실행은 시간 때문에 못 본 반부터,
  // 실패한 반은 건너뛰고 그다음 반부터 잇습니다(계속 실패하는 탭이 돌기를 막지 않게. 실패한 반은 다음 바퀴에 다시 봄).
  b2Phase_('colours');
  var cursor = props.getProperty('B2_COLOR_CURSOR'), rot = all && !full ? b2Rotation_(wanted, cursor, B2.SYNC.colorPerTick) : { pick: [], next: +cursor || 0 };
  var colorFailed = false, rotTried = 0, short = !!read.short;
  var readColor = function (cls, queued) {
    try {
      bgs[cls] = b2ReadBackgrounds_(read, sourceId, cls);
      nextColor[cls] = b2Hash_(b2EvidenceKey_(read.grids[cls], bgs[cls]));
      if (!queued && colors[cls] !== nextColor[cls]) process.push(cls);
    } catch (e) {
      errors.push(cls + '반 색: ' + b2Msg_(e)); colorFailed = true;
      if (queued) { process.splice(process.indexOf(cls), 1); delete nextHash[cls]; }
    }
  };
  wanted.filter(function (cls) { return process.indexOf(cls) >= 0; }).forEach(function (cls) {
    // 시간이 모자라면 이 실행은 잠금 전에 멈추므로(아래) 색을 더 읽지 않습니다. 반영하지 않은 반은 지문을 남기지 않아 다음 실행이 다시 맞춥니다.
    if (b2LeftMs_() < B2.SYNC.writeMs) { short = true; process.splice(process.indexOf(cls), 1); delete nextHash[cls]; return; }
    readColor(cls, true);
  });
  for (var ri = 0; ri < rot.pick.length; ri++) {
    var rc = rot.pick[ri];
    if (process.indexOf(rc) >= 0 || !read.grids[rc]) { rotTried++; continue; }
    if (colorFailed || b2LeftMs_() < B2.SYNC.writeMs + B2.SYNC.colorMs) break;
    rotTried++; readColor(rc, false);
  }
  if (rotTried < rot.pick.length) rot = { pick: rot.pick.slice(0, rotTried), next: b2Rotation_(wanted, cursor, rotTried).next };
  t.colors = Date.now() - started - t.read;
  var docsKey = read.docs ? b2Hash_(b2GridKey_(read.docs)) : '', infoKey = read.info ? b2Hash_(b2GridKey_(read.info)) : '';
  var docsChanged = !!read.docs && (full || props.getProperty('B2_SRC_DOCS') !== docsKey);
  var infoChanged = !!read.info && (full || props.getProperty('B2_SRC_INFO') !== infoKey);
  // 교육일정표: 마스터에 교육일정 탭이 있을 때만(시트 개편 뒤) 분야·강사를 채웁니다. 교육일(C열)은 건드리지 않습니다.
  var schedTab = read.sched ? b2Ss_().getSheetByName(B2.SHEETS.sched) : null, schedKey = schedTab ? b2Hash_(b2GridKey_(read.sched)) : '';
  var schedChanged = !!schedTab && (full || props.getProperty('B2_SRC_SCHED') !== schedKey);
  var remember = function (done) {
    Object.keys(nextHash).forEach(function (c) { hashes[c] = nextHash[c]; });
    Object.keys(nextColor).forEach(function (c) { colors[c] = nextColor[c]; });
    props.setProperty('B2_SRC_HASH', JSON.stringify(hashes));
    props.setProperty('B2_SRC_COLOR', JSON.stringify(colors));
    if (all) props.setProperty('B2_COLOR_CURSOR', String(rot.next));
    if (read.docs) props.setProperty('B2_SRC_DOCS', docsKey);
    if (read.info) props.setProperty('B2_SRC_INFO', infoKey);
    if (schedTab && !schedFailed) props.setProperty('B2_SRC_SCHED', schedKey);
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
  var schedFailed = false;
  if (!short && !process.length && !docsChanged && !infoChanged && !schedChanged && !drawAll && !pendingAtStart) {
    var quiet = LockService.getDocumentLock();
    if (quiet.tryLock(10000)) { try { remember([]); } finally { quiet.releaseLock(); } }
    var slimNothing = b2SlimPending_();
    b2Phase_('done');
    return { at: Date.now(), ms: Date.now() - started, reason: opts.reason || '', mode: read.mode, apiError: read.apiError, processed: [], colorChecked: rot.pick, nothing: true, slim: slimNothing, errors: errors, retries: __B2_RETRIES.slice(), t: t };
  }
  // 읽기·색 확인에 오래 걸렸으면(남은 시간 < writeMs) 잠금을 잡지 않고 쓰기를 다음 실행으로 미룹니다.
  if (short || b2LeftMs_() < B2.SYNC.writeMs) return stop('lock', '운영총괄을 읽는 데 오래 걸려 반영은 다음 실행으로 미룹니다.');

  var desired = [], scope = {}, students = {};
  process.forEach(function (cls) {
    try {
      var parsed = b2ParseGrid_(cls, read.grids[cls], bgs[cls], today, days.set);
      desired = desired.concat(parsed.records); students[cls] = parsed.students;
      scope[cls] = {}; parsed.dates.forEach(function (d) { scope[cls][d] = true; });
    } catch (e) { errors.push(cls + '반: ' + b2Msg_(e)); delete nextHash[cls]; delete nextColor[cls]; }
  });
  var done = Object.keys(scope), adoptNow = legacyLeft.filter(function (c) { return done.indexOf(c) >= 0; });

  b2Phase_('lock');
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  var result, t1 = Date.now(), rest = [], failedBoards = [];
  try {
    b2Phase_('read');
    var roster = b2Retry_('명부 읽기', b2ReadRoster_);
    var rm = done.length ? b2MergeRoster_(roster.rows, students, b2Retry_('교육생정보 읽기', b2ReadPeople_)) : { updates: [], appends: [] };
    var ledger = b2Retry_('출결원장 읽기', function () { return b2ReadLedger_(true); }), origByRow = {}, adopted = 0;
    ledger.rows.forEach(function (r) { origByRow[r.row] = { rec: b2Norm_(r.rec), prov: r.prov, sig: r.sig, flag: r.flag }; });
    if (adoptNow.length) {
      var adoptScope = {}; adoptNow.forEach(function (c) { adoptScope[c] = scope[c]; });
      adopted = b2AdoptLegacy_(ledger.rows, b2Retry_('변경이력 읽기', function () { return b2HumanKeys_(B2.SYNC.legacySince); }), adoptScope);
    }
    var merged = b2Merge_(ledger.rows, desired, scope);
    var plan = b2LedgerPlan_(merged.rows, merged.removed, origByRow);
    var writes = plan.patches.length + plan.appends.length + plan.clears.length;
    // 쓰기 전에 남은 시간을 봅니다. 모자라면 명부·출결원장 어느 것도 쓰지 않고 멈춥니다.
    // (명부만 쓰고 멈추면 다음 실행은 명부 차이를 못 봐 그 반 출결판·변경 번호·변경이력을 놓칩니다.)
    if (b2LeftMs_() < B2.SYNC.saveMs) return (result = stop('write', '출결원장을 쓰기 전에 실행 시간이 모자라 다음 실행으로 미룹니다.'));
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
    // 시트 다듬기 뒤: Q값(입력 확인)을 다시 계산해야 한다고 쓰기 전에 적어 둡니다. 쓰기 뒤 끊기거나 쓰기가 'timed out'으로 끝나면
    // 다음 실행은 이미 쓰인 행을 보고 쓸 것이 없다고 판단하므로, 이 표시가 없으면 Q가 낡은 채 남습니다.
    var slimOn = b2SlimOn_();
    if (slimOn && (writes || rm.appends.length)) props.setProperty('B2_SLIM_DIRTY', '1');
    b2Phase_('write');
    // 명부를 먼저 씁니다(출결원장 이름 칸의 명부 데이터 확인 규칙과 맞추기 위해).
    if (rm.updates.length || rm.appends.length) b2Retry_('명부 쓰기', function () { b2WriteRoster_(roster, rm); SpreadsheetApp.flush(); });
    if (writes) b2Retry_('출결원장 쓰기', function () { b2WriteLedgerPlan_(ledger, plan, origByRow); SpreadsheetApp.flush(); });
    t.write = Date.now() - t1;
    // 시트 다듬기 뒤: 출결원장·명부가 바뀌었으면(위 표시) Q값을 다시 계산해 바뀐 칸만 씁니다(지난 계산이 실패했으면 쓴 것이 없어도).
    // 날이 바뀐 첫 실행(drawAll)은 한 번 전체를 다시 맞춥니다(행 삭제·끼워 넣기·정렬처럼 onEdit이 없는 편집, 예전 배포의 저장도 바로잡게).
    // 원장 전체를 읽는 계산이라 남은 시간이 모자라면 B2_SLIM_DIRTY만 남기고 넘깁니다(다음 저장이나 다음 동기화가 계산).
    if (slimOn && (drawAll || props.getProperty('B2_SLIM_DIRTY'))) {
      b2Phase_('slim');
      if (b2LeftMs_() < B2.SYNC.boardMs) { props.setProperty('B2_SLIM_DIRTY', '1'); warnings.push('입력 확인: 실행 시간이 모자라 다음 실행에서 다시 계산합니다.'); }
      else { var slimQ = b2SlimRefresh_(); if (slimQ && slimQ.error) warnings.push('입력 확인: ' + slimQ.error); }
    }
    var infoFilled = infoChanged ? b2Retry_('반정보 채우기', function () { return b2FillInfo_(read.info); }) : 0;
    var docsAdded = docsChanged ? b2Retry_('서류발급 가져오기', function () { return b2ImportDocs_(read.docs); }) : 0;
    // 교육일정 분야·강사는 출결과 상관없어 실패해도 경고로만 남기고(지문을 기억하지 않아 다음 실행이 다시 채움) 변경 번호를 올리지 않습니다.
    var sched = null;
    if (schedChanged) {
      try { sched = b2Retry_('교육일정 채우기', function () { return b2FillSchedule_(schedTab, read.sched); }); }
      catch (e) { schedFailed = true; warnings.push('교육일정: ' + b2Msg_(e)); }
      if (sched && sched.missing.length) warnings.push('교육일정 탭에 없는 날짜 ' + sched.missing.length + '개(운영총괄에는 일정이 있음): ' + sched.missing.slice(0, 5).join(', '));
    }
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
      roster: { updated: rm.updates.length, added: rm.appends.length }, info: infoFilled, docs: docsAdded, sched: sched ? sched.cells : 0, errors: errors, warnings: warnings, retries: __B2_RETRIES.slice(), t: t
    };
    // 출결원장 반영은 여기서 끝났으므로 기록을 먼저 남깁니다. 출결판을 그리다 실패해도 다음 실행이 같은 반영을 되풀이하지 않습니다.
    props.setProperty('B2_SYNC_LAST', JSON.stringify(result));
    if (changes) props.setProperty('B2_SYNC_CHANGED', String(Date.now()));
    remember(done);
    // 출결판: 처음 몇 반은 이 잠금 안에서 그리고, 나머지는 잠금을 놓았다가 몇 반씩 다시 잡아 그립니다(아래).
    // 시간이 모자라면 여기서 그리지 않고 모두 남은 출결판(B2_PENDING_BOARDS)으로 넘깁니다.
    var t2 = Date.now(), firstBoards = b2LeftMs_() < B2.SYNC.boardMs ? [] : boardClasses.slice(0, B2.SYNC.boardsPerLock);
    rest = boardClasses.slice(firstBoards.length);
    if (firstBoards.length) {
      b2Phase_('boards 1');
      var freshRoster = rm.updates.length || rm.appends.length ? b2Retry_('명부 읽기', b2ReadRoster_).rows : roster.rows;
      failedBoards = b2DrawBoardSet_(firstBoards, { ledger: merged.rows, roster: freshRoster, days: days.list, today: today }, warnings);
    }
    if (all) b2PendingBoards_(failedBoards.concat(rest), drawAll && !rest.length, today);
    else if (failedBoards.length) b2AddPendingBoards_(failedBoards);
    t.boards = Date.now() - t2;
  } finally { lock.releaseLock(); }
  // 출결원장 반영은 끝났으므로, 남은 출결판을 그리다 생긴 오류(잠금 대기 초과 등)는 경고로만 남깁니다. 남은 반은 B2_PENDING_BOARDS에 있습니다.
  if (rest.length) {
    try { failedBoards = failedBoards.concat(b2DrawBoardsInTurns_(rest, days.list, today, all, drawAll, failedBoards, warnings, firstBoards.length ? 2 : 1)); }
    catch (e) { warnings.push('출결판 그리기 중단: ' + b2Msg_(e)); if (!all) b2AddPendingBoards_(rest); }
    if (!all && failedBoards.length) b2AddPendingBoards_(failedBoards);
  }
  if (rest.length || warnings.length) {
    result.t.boards = (result.t.boards || 0) + (Date.now() - started - result.t.total);
    result.ms = result.t.total = Date.now() - started; result.retries = __B2_RETRIES.slice(); result.warnings = warnings;
    props.setProperty('B2_SYNC_LAST', JSON.stringify(result));
  }
  b2Phase_('done');
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
// 잠금을 놓은 동안 출결원장·명부가 바뀌었을 수 있으니 매번 다시 읽습니다(출결원장은 A~K·R~T만). 끊기면 B2_PENDING_BOARDS가 남아 다음 실행이 이어서 그립니다(전체 동기화만).
// 차례마다 남은 시간을 보고, 모자라면 남은 반을 B2_PENDING_BOARDS에 두고 멈춥니다(오늘 전체 그리기는 그 목록으로 이어 갑니다).
// turn: 단계 표시에 쓸 첫 차례 번호. 돌려주는 값: 이번에 실패해 다음 실행으로 넘긴 반
function b2DrawBoardsInTurns_(classes, days, today, all, drawAll, failedBefore, warnings, turn) {
  var left = classes.slice(), failed = [];
  turn = turn || 1;
  while (left.length) {
    if (b2LeftMs_() < B2.SYNC.boardMs) {
      warnings.push('실행 시간이 모자라 출결판 ' + left.length + '반은 다음 실행에서 그립니다.');
      if (all) b2PendingBoards_(failedBefore.concat(failed, left), drawAll, today); else b2AddPendingBoards_(left);
      break;
    }
    b2Phase_('boards ' + turn++);
    var chunk = left.slice(0, B2.SYNC.boardsPerLock), lock = LockService.getDocumentLock(); lock.waitLock(30000);
    try {
      var ctx = { ledger: b2Retry_('출결원장 읽기', function () { return b2ReadLedger_(true); }).rows, roster: b2Retry_('명부 읽기', b2ReadRoster_).rows, days: days, today: today };
      failed = failed.concat(b2DrawBoardSet_(chunk, ctx, warnings));
      left = left.slice(chunk.length);
      if (all) b2PendingBoards_(failedBefore.concat(failed, left), drawAll && !left.length, today);
    } finally { lock.releaseLock(); }
  }
  return failed;
}
// 명부 쓰기(b2MergeRoster_ 결과). 같은 칸에 같은 값을 쓰므로 다시 시도해도 결과가 같습니다.
// 명부는 출결원장을 읽은 뒤에 쓰므로, 그사이 행이 밀렸는지(행 삭제·끼워 넣기·정렬, 누가 아래에 학생을 적음) 이름 칸으로 먼저 확인합니다.
var B2_ROSTER_MOVED = '명부 행 위치가 그사이 바뀌어(행 삭제·추가·정렬) 이번 반영을 멈췄습니다. 다음 실행에서 다시 맞춥니다.';
function b2WriteRoster_(roster, rm) {
  var sh = roster.sh, at = roster.last + 1, n = rm.appends.length, nameAt = {};
  roster.rows.forEach(function (r) { nameAt[r.row] = r.name; });
  var top = Math.min(sh.getMaxRows(), Math.max(roster.last, at + n - 1)), now = top >= 2 ? sh.getRange(2, 2, top - 1, 1).getValues() : [];
  var nameOf = function (row) { return String((now[row - 2] || [])[0] || '').trim(); };
  if (rm.updates.some(function (u) { return nameOf(u.row) !== nameAt[u.row]; }) || rm.appends.some(function (a, i) { var v = nameOf(at + i); return v && v !== a.name; })) throw new Error(B2_ROSTER_MOVED);
  rm.updates.forEach(function (u) {
    if (u.status) sh.getRange(u.row, 4, 1, 2).setValues([[u.status, u.changed ? b2DateValue_(u.changed) : '']]);
    if (u.birth || u.gender) {
      var cur = sh.getRange(u.row, 7, 1, 2).getValues()[0];
      sh.getRange(u.row, 7, 1, 2).setValues([[u.birth ? b2DateValue_(u.birth) : cur[0], u.gender || cur[1]]]);
    }
  });
  if (n) {
    if (sh.getMaxRows() < at + n - 1) sh.insertRowsAfter(sh.getMaxRows(), at + n - 1 - sh.getMaxRows());
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

/* 교육일정표: 운영총괄 '전국 교육일정관리' → 마스터 교육일정 탭의 반별 분야·강사(2026-10-16 회의, 사용자 결정: 운영총괄에서 자동)
 * 원본은 '교육장소' 줄에 반 이름(앞 번호 '1.임베디드AI-HW(서울대)'), '날짜' 줄 아래로 날짜마다 한 줄, 반마다 4칸(분야·시간·강사·강사연락처)입니다.
 * 강사연락처는 가져오지 않습니다. 같은 날짜가 두 줄이면 ' / '로 잇고, 시간이 8이 아니면 분야 뒤에 '(n시간)'을 붙입니다.
 * 돌려주는 값: {iso: {반: [분야, 강사]}} */
function b2ParseSchedule_(values) {
  var head = -1, place = -1;
  for (var i = 0; i < values.length; i++) {
    var a = String((values[i] || [])[0] || '').trim();
    if (a === '교육장소' && place < 0) place = i;
    if (a === '날짜') { head = i; break; }
  }
  if (head < 0) throw new Error("운영총괄 교육일정표에서 '날짜' 머리글 줄을 찾지 못했습니다.");
  var hr = values[head] || [], cols = {}, order = 0;
  for (var c = 2; c < hr.length; c++) {
    if (String(hr[c] || '').trim() !== '분야') continue;
    order++;
    var m = String(place >= 0 ? (values[place] || [])[c] || '' : '').trim().match(/^(\d{1,2})\s*\./), n = m ? String(+m[1]) : String(order);
    if (B2.SOURCE_TABS[n] && cols[n] === undefined) cols[n] = c;
  }
  var out = {}, add = function (list, v) { if (v && list.indexOf(v) < 0) list.push(v); };
  for (var r = head + 1; r < values.length; r++) {
    var row = values[r] || [], iso = b2Iso_(row[0]);
    if (!iso) continue;
    Object.keys(cols).forEach(function (n) {
      var c0 = cols[n], subj = String(row[c0] || '').trim(), hours = String(row[c0 + 1] || '').trim(), who = String(row[c0 + 2] || '').trim();
      if (!subj && !who) return;
      var day = out[iso] || (out[iso] = {}), cell = day[n] || (day[n] = [[], []]);
      add(cell[0], subj + (subj && hours && hours !== '8' ? ' (' + hours + '시간)' : ''));
      add(cell[1], who);
    });
  }
  Object.keys(out).forEach(function (iso) { Object.keys(out[iso]).forEach(function (n) { out[iso][n] = [out[iso][n][0].join(' / '), out[iso][n][1].join(' / ')]; }); });
  return out;
}
// 교육일정 탭의 반별 분야·강사 칸을 원본 값으로 맞춥니다. 원본에 일정이 있는 날짜만 고치고(없는 날은 그대로), 바뀐 칸이 있을 때만 한 번에 씁니다.
// 날짜·교육일(A~C)은 쓰지 않습니다. 돌려주는 값: {cells: 바뀐 칸 수, missing: 원본에는 일정이 있는데 탭에 없는 날짜}
function b2FillSchedule_(sh, srcValues) {
  var S = B2.SCHED, parsed = b2ParseSchedule_(srcValues || []), last = b2LastRow_(sh, 1);
  var width = 17 * S.perClass, out = { cells: 0, missing: [] };
  if (sh.getMaxColumns() < S.firstCol + width - 1) throw new Error('교육일정 탭 열이 모자랍니다(반 17개 × 2칸).');
  var dates = last >= S.first ? sh.getRange(S.first, 1, last - S.first + 1, 1).getValues().map(function (r) { return b2Iso_(r[0]); }) : [];
  var at = {}; dates.forEach(function (iso, i) { if (iso && at[iso] === undefined) at[iso] = i; });
  Object.keys(parsed).sort().forEach(function (iso) { if (at[iso] === undefined) out.missing.push(iso); });
  if (!dates.length) return out;
  var cur = sh.getRange(S.first, S.firstCol, dates.length, width).getValues(), next = cur.map(function (r) { return r.slice(); });
  dates.forEach(function (iso, i) {
    var day = parsed[iso]; if (!day) return;
    Object.keys(B2.SOURCE_TABS).forEach(function (n) {
      var want = day[n] || ['', ''], c = (+n - 1) * S.perClass;
      for (var k = 0; k < 2; k++) if (String(next[i][c + k] == null ? '' : next[i][c + k]) !== want[k]) { next[i][c + k] = want[k]; out.cells++; }
    });
  });
  if (out.cells) sh.getRange(S.first, S.firstCol, dates.length, width).setValues(next);
  return out;
}

// 10분 트리거가 부릅니다. 정한 시간(B2.SYNC.window, 기본 평일 09:10~18:00) 밖이면 바로 끝나고,
// 하루 사용 시간이 상한(B2.SYNC.dailyMs)을 넘으면 30분에 한 번만 돕니다. 6분 한도로 끊긴 실행은 다음 실행이 기록합니다.
// 시간 판단은 B2.TZ로 하고 B2_SYNC_RUNNING을 적은 뒤에야 시트를 부릅니다(시트가 느린 날 시간 확인에서 끊겨도 흔적이 남게).
// e: 시간 트리거가 넘기는 이벤트. 트리거·편집기 실행만 받습니다(b2TriggerOnly_). 시간 밖이면 확인 전에 끝나므로 그때는 아무것도 하지 않습니다.
function b2SyncTick(e) {
  b2Begin_();
  var props = b2Props_(), now = new Date();
  var spec = props.getProperty('B2_SYNC_WINDOW') || B2.SYNC.window;
  if (!b2InWindow_(spec, Utilities.formatDate(now, B2.TZ, 'u'), Utilities.formatDate(now, B2.TZ, 'HH:mm'))) return;
  b2TriggerOnly_(e);
  var day = Utilities.formatDate(now, B2.TZ, 'yyyy-MM-dd'), usage = b2JsonProp_('B2_RUN_USAGE', null);
  if (!usage || usage.day !== day) usage = { day: day, ms: 0, runs: 0, cut: 0, lastAt: 0 };
  var running = +props.getProperty('B2_SYNC_RUNNING') || 0;
  if (running && Date.now() - running < 7 * 60 * 1000) return;
  if (running) {
    // 끊긴 실행: 그 실행이 남긴 마지막 단계(B2_SYNC_PHASE)를 B2_SYNC_CUT에 옮기고, 6분을 하루 사용량과 마지막 실행 시각에 넣습니다(상한을 넘었으면 30분 쉼).
    var crumb = b2JsonProp_('B2_SYNC_PHASE', null), mine = !!crumb && +crumb.at >= running;
    usage.cut++; usage.ms += 6 * 60 * 1000; usage.lastAt = Math.max(+usage.lastAt || 0, Math.min(Date.now(), running + 6 * 60 * 1000));
    props.setProperty('B2_SYNC_CUT', JSON.stringify({ at: running, phase: mine ? String(crumb.phase || '') : '', ms: mine ? +crumb.ms || 0 : 0 }));
    // 바로 저장합니다. 이 실행도 끊기면 아래 finally가 돌지 않아, 끊긴 실행이 이어질 때 하루 사용량이 쌓이지 않고 상한이 걸리지 않습니다.
    props.setProperty('B2_RUN_USAGE', JSON.stringify(usage));
  }
  if (usage.ms > B2.SYNC.dailyMs && Date.now() - usage.lastAt < 30 * 60 * 1000) { props.deleteProperty('B2_SYNC_RUNNING'); return; }
  props.setProperty('B2_SYNC_RUNNING', String(__B2_T0));
  var t0 = Date.now();
  try { b2SyncRun_({ force: false, reason: 'trigger' }); }
  catch (e) { props.setProperty('B2_SYNC_ERROR', JSON.stringify({ at: Date.now(), message: b2Msg_(e) })); throw e; }
  finally {
    usage.ms += Date.now() - t0; usage.runs++; usage.lastAt = Date.now();
    props.setProperty('B2_RUN_USAGE', JSON.stringify(usage));
    props.deleteProperty('B2_SYNC_RUNNING');
  }
}

// b2SyncTick의 확인. 시간 트리거 이벤트의 triggerUid가 이 프로젝트 트리거면 진행하고, 아니면 편집기에서 직접 실행했는지 봅니다(b2EditorOnly_).
// 웹 앱 방문자가 google.script.run으로 부르면(가짜 triggerUid 포함) 거절합니다: 동기화를 계속 돌려 문서 잠금·하루 사용량(B2_RUN_USAGE)을 차지하지 않게.
// getProjectTriggers는 b2Status·b2InstallTrigger가 이미 쓰는 권한이라 새 승인은 없습니다.
function b2TriggerOnly_(e) {
  var uid = e && e.triggerUid ? String(e.triggerUid) : '';
  if (uid) { try { if (ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; })) return; } catch (x) { } }
  b2EditorOnly_();
}

/* ---------- 편집기에서 한 번 실행 ---------- */

function b2Setup() {
  b2EditorOnly_();
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
function b2ImportAll() { b2EditorOnly_(); b2Begin_(); console.log(JSON.stringify(b2SyncRun_({ force: true, reason: 'setup' }))); }
function b2InstallTrigger() {
  b2EditorOnly_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'b2SyncTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('b2SyncTick').timeBased().everyMinutes(10).create();
  console.log('10분마다 b2SyncTick 실행을 등록했습니다.');
}
function b2RemoveTrigger() {
  b2EditorOnly_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'b2SyncTick') ScriptApp.deleteTrigger(t); });
}

/* ---------- 포털에서 부르는 함수 (B2_ACTIONS, doPost로만. 이름 끝 '_') ---------- */

var B2_LEDGER_COLS = ['date', 'cls', 'name', 'type', 'inT', 'outT', 'oa', 'ob', 'reason', 'ev', 'evr', 'memo', 'evApplied', 'check', 'prov', 'flag', 'sig'];
// cut: 6분 한도로 끊긴 실행 {at: 시작 시각, phase: 마지막 단계, ms}(예전 값은 시작 시각 숫자), running: 지금 도는 실행 {at, phase, ms}
// all: 이미 읽은 스크립트 속성 전부(getProperties). 화면이 30초마다 부르므로 속성을 한 번에 읽습니다(하루 속성 읽기 한도).
function b2SyncState_(all) {
  all = all || b2Props_().getProperties();
  var get = function (k) { return all[k] == null ? null : all[k]; }, parse = function (k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } };
  var cut = parse('B2_SYNC_CUT'), crumb = parse('B2_SYNC_PHASE'), runAt = +get('B2_SYNC_RUNNING') || 0;
  if (typeof cut === 'number') cut = { at: cut, phase: '', ms: 0 };
  var mine = runAt && crumb && +crumb.at >= runAt, running = runAt ? { at: runAt, phase: mine ? crumb.phase : '', ms: mine ? +crumb.ms || 0 : 0 } : null;
  return { last: parse('B2_SYNC_LAST'), error: parse('B2_SYNC_ERROR'), checkedAt: +get('B2_SYNC_CHECKED') || 0, changedAt: +get('B2_SYNC_CHANGED') || 0, sourceSeen: +get('B2_SRC_SEEN') || 0, window: get('B2_SYNC_WINDOW') || B2.SYNC.window, usage: parse('B2_RUN_USAGE'), cutAt: cut && +cut.at || 0, cut: cut && cut.at ? cut : null, running: running };
}
/* /beta2 묶음 캐시
 * b2Bundle은 출결원장(4,700여 줄)·명부·교육일자·반정보를 모두 읽어 웹 앱으로 20~30초 걸립니다.
 * 한 번 읽을 때 17개 반과 'all'에 쓸 조각을 모두 만들어 스크립트 캐시(6시간)에 넣고, 다음 호출은 시트를 읽지 않습니다.
 * 캐시 표시 = B2_REV + 마스터 파일 Drive 수정 시각: 포털·동기화·Code.gs·시트 직접 편집 어느 쪽으로 고쳐도 표시가 바뀌어 다시 읽습니다.
 * 표시는 시트를 읽기 전에 정합니다. 읽는 사이에 누가 고쳤으면 다음 호출의 표시가 달라지므로 옛 값이 새 표시로 남지 않습니다.
 * rev·today·sync는 캐시하지 않고 호출마다 새로 붙입니다. 캐시를 못 쓰거나 조각이 하나라도 없으면 시트를 읽습니다.
 * 캐시 한 칸은 100KB까지라 3만 글자씩 나눠 넣습니다(한 글자는 UTF-8로 3바이트까지). 머리(head)는 조각을 다 넣은 뒤에 바꿉니다.
 * 지금 출결원장(약 4,800줄)은 25조각 안팎입니다. 100조각(약 9MB)을 넘으면 넣지 않고 매번 시트를 읽습니다.
 * v: 조각 모양(b2BundleParts_)이나 B2_LEDGER_COLS를 바꾸면 올립니다. 표시에 들어가므로 새 코드가 옛 모양 조각을 쓰지 않습니다(배포만으로는 rev·수정 시각이 안 바뀜). */
var B2_CACHE = { v: '1', head: 'b2b:head', ttl: 21600, chunk: 30000, maxChunks: 100, putBatch: 4 };
function b2Cache_() { try { return typeof CacheService === 'undefined' ? null : CacheService.getScriptCache(); } catch (e) { return null; } }
// 수정 시각을 못 읽으면 ''(캐시를 쓰지 않음). 표시 없이 넣으면 바뀐 시트를 알아챌 수 없습니다.
function b2BundleStamp_(rev) { try { return 'v' + B2_CACHE.v + '.' + rev + '.' + DriveApp.getFileById(b2Ss_().getId()).getLastUpdated().getTime(); } catch (e) { return ''; } }
function b2CacheKey_(stamp, part, i) { return 'b2b:' + stamp + ':' + part + ':' + i; }
function b2CacheKeys_(head, names) {
  var keys = [];
  (names || Object.keys(head.parts)).forEach(function (n) { for (var i = 0; i < (head.parts[n] || 0); i++) keys.push(b2CacheKey_(head.stamp, n, i)); });
  return keys;
}
// size 글자씩 자릅니다. 이모지처럼 두 글자로 된 문자는 가르지 않습니다(반쪽 글자는 저장할 때 깨짐).
function b2Chunks_(s, size) {
  var out = [];
  for (var i = 0; i < s.length;) {
    var end = Math.min(s.length, i + size), c = s.charCodeAt(end - 1);
    if (end < s.length && c >= 0xd800 && c <= 0xdbff) end--;
    out.push(s.slice(i, end)); i = end;
  }
  return out;
}
// 시트를 한 번 읽어 조각을 만듭니다: base(교육일·반정보), c1~c17(반별 명부·출결원장), cx(반 칸이 1~17이 아닌 행, 'all'에만 들어감).
// 행 앞에 시트 행 번호를 붙여 두고, 'all'을 만들 때 그 순서로 되돌립니다(캐시 전과 같은 순서).
function b2BundleParts_() {
  var days = b2Days_(), ledger = b2ReadLedger_().rows, roster = b2ReadRoster_().rows, parts = { base: { days: days.list, classes: b2Info_() } };
  var group = function (cls) { var k = 'c' + (B2.SOURCE_TABS[cls] ? cls : 'x'); return parts[k] || (parts[k] = { roster: [], ledger: [] }); };
  roster.forEach(function (r) { group(r.cls).roster.push([r.row, r.cls, r.name, r.status, r.changed]); });
  ledger.forEach(function (r) {
    var x = r.rec;
    group(x.cls).ledger.push([r.row, x.date, x.cls, x.name, x.type, x.inT, x.outT, x.oa, x.ob, x.reason, x.ev, x.evr, r.memo, r.evApplied, r.check, r.prov, r.flag, b2Sig_(x)]);
  });
  return parts;
}
// 조각 → b2Bundle 응답(모양·순서는 캐시 전과 같음). 반 묶음에는 그 반 조각만 씁니다(담임 화면은 자기 반만 받음).
function b2BundleFrom_(parts, cls, live) {
  var names = cls === 'all' ? Object.keys(parts).filter(function (k) { return k !== 'base'; }) : ['c' + cls], roster = [], ledger = [];
  names.forEach(function (n) { if (parts[n]) { roster = roster.concat(parts[n].roster); ledger = ledger.concat(parts[n].ledger); } });
  var byRow = function (a, b) { return a[0] - b[0]; }, cut = function (r) { return r.slice(1); };
  if (names.length > 1) { roster.sort(byRow); ledger.sort(byRow); }
  return { rev: live.rev, today: live.today, days: parts.base.days, classes: parts.base.classes, roster: roster.map(cut), ledgerCols: B2_LEDGER_COLS, ledger: ledger.map(cut), sync: live.sync };
}
function b2CacheHead_(cache) {
  try { var h = JSON.parse(cache.get(B2_CACHE.head) || 'null'); return h && h.stamp && h.parts && h.parts.base ? h : null; } catch (e) { return null; }
}
// cls 묶음에 필요한 조각만 읽습니다('all'은 전부). 하나라도 없거나(먼저 지워짐) 깨졌으면 null → 시트를 읽습니다.
function b2CacheRead_(cache, head, cls) {
  try {
    var names = cls === 'all' ? Object.keys(head.parts) : ['base', 'c' + cls].filter(function (n) { return head.parts[n]; });
    var got = cache.getAll(b2CacheKeys_(head, names)) || {}, parts = {};
    for (var j = 0; j < names.length; j++) {
      var text = [];
      for (var i = 0; i < head.parts[names[j]]; i++) { var v = got[b2CacheKey_(head.stamp, names[j], i)]; if (typeof v !== 'string') return null; text.push(v); }
      parts[names[j]] = JSON.parse(text.join(''));
    }
    return parts;
  } catch (e) { return null; }
}
// 조각을 다 넣은 뒤 머리를 바꾸고 지난 표시의 조각을 지웁니다. 넣다 실패하면 넣던 조각을 지우고 false(응답은 그대로 나감).
function b2CacheWrite_(cache, stamp, parts, old) {
  var entries = {}, counts = {}, keys = null;
  try {
    Object.keys(parts).forEach(function (n) {
      var list = b2Chunks_(JSON.stringify(parts[n]), B2_CACHE.chunk);
      counts[n] = list.length;
      list.forEach(function (v, i) { entries[b2CacheKey_(stamp, n, i)] = v; });
    });
    keys = Object.keys(entries);
    if (keys.length > B2_CACHE.maxChunks) return false;
    for (var i = 0; i < keys.length; i += B2_CACHE.putBatch) {
      var batch = {}; keys.slice(i, i + B2_CACHE.putBatch).forEach(function (k) { batch[k] = entries[k]; });
      cache.putAll(batch, B2_CACHE.ttl);
    }
    cache.put(B2_CACHE.head, JSON.stringify({ stamp: stamp, parts: counts }), B2_CACHE.ttl);
  } catch (e) {
    try { if (keys) cache.removeAll(keys); } catch (e2) { }
    return false;
  }
  try { if (old && old.stamp !== stamp) cache.removeAll(b2CacheKeys_(old)); } catch (e) { }
  return true;
}
// cls: '1'~'17' 또는 'all'. 개인정보(생년월일·성별)는 보내지 않습니다. 묶음 캐시(위)에 있으면 시트를 읽지 않습니다.
// rev는 시트를 읽기 전 값입니다. 읽는 사이에 바뀌었으면 화면이 다음 변경 번호 확인에서 다시 받습니다.
function b2Bundle_(cls) {
  cls = String(cls || 'all');
  if (cls !== 'all' && !B2.SOURCE_TABS[cls]) throw new Error('반 번호를 확인해 주세요.');
  var all = b2Props_().getProperties(), rev = +all.B2_REV || 0, stamp = b2BundleStamp_(rev), cache = stamp ? b2Cache_() : null;
  var head = cache ? b2CacheHead_(cache) : null, parts = head && head.stamp === stamp ? b2CacheRead_(cache, head, cls) : null;
  // 변경 번호가 바뀌면 열린 화면이 거의 함께 다시 부릅니다. 시트는 한 실행만 읽어 캐시를 채우고, 나머지는 잠금을 기다렸다가 그 캐시를 씁니다.
  // (스크립트 잠금은 여기서만 씁니다. 동기화·저장은 문서 잠금이라 서로 막지 않습니다.) 끝내 잠금을 못 잡으면 캐시를 쓰지 않고 시트를 읽습니다.
  if (!parts && cache) {
    var fill = LockService.getScriptLock();
    if (fill.tryLock(20000)) {
      try {
        head = b2CacheHead_(cache); parts = head && head.stamp === stamp ? b2CacheRead_(cache, head, cls) : null;
        if (!parts) { parts = b2BundleParts_(); b2CacheWrite_(cache, stamp, parts, head); }
      } finally { fill.releaseLock(); }
    }
  }
  if (!parts) parts = b2BundleParts_();
  return b2BundleFrom_(parts, cls, { rev: rev, today: b2Today_(), sync: b2SyncState_(all) });
}
// voc: 민원·이슈 알림 건수(B2_VOC_STATE, 글을 쓸 때마다 바뀜). 화면이 이 값만 보고 새 글을 알립니다(시트를 읽지 않음).
function b2Rev_() {
  var all = b2Props_().getProperties(), voc = null;
  try { voc = all.B2_VOC_STATE ? JSON.parse(all.B2_VOC_STATE) : null; } catch (e) { }
  return { rev: +all.B2_REV || 0, sync: b2SyncState_(all), voc: voc };
}
function b2Status_() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'b2SyncTick'; }).length;
  var updated = 0, sourceId = b2SourceId_(); try { if (sourceId) updated = DriveApp.getFileById(sourceId).getLastUpdated().getTime(); } catch (e) { }
  var all = b2Props_().getProperties();
  return { rev: +all.B2_REV || 0, sync: b2SyncState_(all), trigger: triggers > 0, sourceUpdated: updated, source: sourceId ? 'linked' : 'none' };
}
// p: {cls}가 있으면 그 반만(빠름), 없으면 17개 반 전체를 지금 가져옵니다.
function b2SyncNow_(p) {
  b2Begin_();
  var cls = p && p.cls ? [String(p.cls)] : null;
  return b2SyncRun_({ classes: cls, force: true, reason: 'manual' });
}
// 출결원장 한 행 저장. p: {cls,name,date,type,inT,outT,oa,ob,reason,ev,evr,before}
// before: 화면이 본 행 지문(없던 행은 ''). 그사이 바뀌었으면 CONFLICT로 막습니다. type '출석'은 출석으로 되돌림.
function b2Save_(p) {
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
    b2SlimRefresh_({ classes: [cls] }); // 시트 다듬기 뒤: Q값·이 반 탭 C·D값(돌려줄 check가 새 값이 되게 읽기 전에)
    b2MarkDirty_(cls);
    var back = ledger.sh.getRange(row, 1, 1, B2.COL.width).getValues()[0];
    return { ok: true, rev: b2Bump_(), sig: b2Sig_(rec), memo: String(back[11] || ''), evApplied: String(back[14] || ''), check: String(back[16] || '') };
  } finally { lock.releaseLock(); }
}
// 베타에서 고친 행을 운영총괄 값으로 되돌립니다. p: {cls, name, date} 또는 {cls, flagged: true}(그 반 확인 필요 행 전체)
function b2Release_(p) {
  b2Begin_(); // 뒤의 b2SyncRun_이 이 실행의 남은 시간을 셉니다.
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
    if (count) b2Bump_(); // 원본이 없어 아래 동기화를 건너뛰어도 묶음 캐시·열린 화면이 바뀐 출처를 다시 읽게
    // 아래 동기화가 시간이 모자라 멈추거나 오류로 끝나도, 다음 10분 실행이 이 반을 다시 맞춰 '*' 행에 운영총괄 값을 넣게(끝나면 지워짐)
    if (count) b2MarkDirty_(cls);
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
function b2Docs_(p) {
  var cls = p && p.cls ? String(p.cls) : '', admin = __ACTOR_ROLE === 'ADMIN' || !__ACTOR_ROLE;
  return {
    rev: +b2Props_().getProperty('B2_REV') || 0, statuses: B2.DOC_STATUS, types: B2.DOC_TYPES, delivery: B2.DOC_DELIVERY,
    rows: b2ReadDocs_().rows.filter(function (d) { return !cls || String(d.cls).replace(/반.*$/, '') === cls; }).reverse()
      .map(function (d) { var x = {}; B2_DOC_FIELDS.forEach(function (k) { x[k] = d[k]; }); if (!admin) x.birth = ''; return x; })
  };
}
// p: {cls, name, docType, period, purpose, submitTo, due, qty, delivery, memo}
function b2DocCreate_(p) {
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
function b2DocUpdate_(p) {
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

/* 민원·이슈 주고받기 (2026-10-16 회의: 관리자·담임 화면에서 주고받고 처리현황을 보고 알림. 사용자 결정: 포털 알림 + 운영팀 메일)
 * 민원이슈 탭 A~J는 예전 그대로입니다(접수일자·반·권역·분반·민원유형·상세내용·처리상태·조치내용·처리일·경과일, C·D·J는 1행 배열 수식이라 쓰지 않음).
 * K~P를 더합니다: 번호 · 접수자 · 주고받은 기록 · 마지막 글(담임/운영) · 마지막 글 시각 · 담임 확인 시각. 머리글은 처음 쓸 때 붙입니다.
 * 처음 글은 F(상세내용)이고, 그 뒤 답글·처리 상태 변경은 M에 한 줄씩 쌓습니다: '[2026-10-16 14:03 운영 hint.kpc@gmail.com] 내용'
 * (글 안 줄바꿈은 ' ↵ '). 시트에서 바로 읽을 수 있게 글자로 둡니다. H(조치내용)에는 운영팀의 마지막 답글이 들어갑니다(시트·예전 화면용).
 * 알림: 운영 쪽은 '끝나지 않았고 마지막 글이 담임'(답변 대기), 담임 쪽은 '마지막 글이 운영이고 담임이 아직 열어 보지 않음'.
 * 건수는 쓸 때마다 스크립트 속성 B2_VOC_STATE에 두고 b2Rev가 함께 돌려줍니다(화면이 시트를 다시 읽지 않고 알 수 있게).
 * 출결 변경 번호(B2_REV)는 올리지 않습니다(열린 출결 화면이 민원 글 때문에 묶음을 다시 읽지 않게). */
var B2_VOC_HEAD = ['번호', '접수자', '주고받은 기록', '마지막 글', '마지막 글 시각', '담임 확인 시각'];
var B2_VOC_LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (담임|운영) ([^\]]*)\] ?(.*)$/;
var B2_VOC_TEXT_MAX = 2000;
// 담임 화면에서 쓰면 '담임', 처리함에서 쓰면 '운영'. 담임 계정은 언제나 담임이고, 관리자는 담임 화면 미리보기에서 담임 쪽으로 써 볼 수 있습니다.
function b2VocSide_(p) { return __ACTOR_ROLE === 'TEACHER' || (p && p.side === '담임') ? '담임' : '운영'; }
function b2VocLine_(at, side, text) { return '[' + b2Fmt_(at, 'yyyy-MM-dd HH:mm') + ' ' + side + ' ' + b2Actor_().replace(/[\]\n]/g, '') + '] ' + String(text).replace(/\r?\n/g, ' ↵ '); }
function b2VocThread_(raw) {
  return String(raw || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
    var m = s.match(B2_VOC_LINE);
    return m ? { at: m[1], side: m[2], who: m[3], text: m[4].replace(/ ↵ /g, '\n') } : { at: '', side: '', who: '', text: s };
  });
}
function b2VocSig_(r) { return b2Hash_([r.date, r.cls, r.detail].join('|')); }
function b2VocRead_() {
  var sh = b2Ss_().getSheetByName(B2.SHEETS.voc), out = [];
  if (!sh) return { sh: null, rows: out };
  var last = b2LastRow_(sh, 1), w = Math.min(16, sh.getMaxColumns());
  if (last < 2) return { sh: sh, rows: out };
  sh.getRange(2, 1, last - 1, w).getValues().forEach(function (v, i) {
    var g = function (k) { return k < w && v[k] != null ? v[k] : ''; };
    var t = function (k) { var x = g(k); return x instanceof Date ? b2Fmt_(x, 'yyyy-MM-dd HH:mm:ss') : String(x).trim(); };
    if (!b2Iso_(g(0)) && !t(1) && !t(5)) return;
    out.push({ row: i + 2, date: b2Iso_(g(0)), cls: t(1), region: t(2), course: t(3), type: t(4), detail: t(5), status: t(6) || '접수', action: t(7), done: b2Iso_(g(8)), days: t(9),
      id: t(10), author: t(11), raw: t(12), lastBy: t(13), lastAt: t(14), seen: t(15) });
  });
  return { sh: sh, rows: out };
}
function b2VocOpen_(r) { return r.status !== '완료' && r.status !== '해당없음'; }
// 예전 기록(번호·마지막 글 없음)은 담임이 접수한 것으로 봅니다(예전 담임 포털·시트 직접 입력).
function b2VocState_(rows) {
  var st = { admin: 0, open: {}, teacher: {} };
  rows.forEach(function (r) {
    if (!B2.SOURCE_TABS[r.cls]) return;
    var open = b2VocOpen_(r);
    if (open) st.open[r.cls] = (st.open[r.cls] || 0) + 1;
    if (open && r.lastBy !== '운영') st.admin++;
    if (r.lastBy === '운영' && r.lastAt > r.seen) st.teacher[r.cls] = (st.teacher[r.cls] || 0) + 1;
  });
  return st;
}
function b2VocSaveState_(rows) {
  var prev = b2JsonProp_('B2_VOC_STATE', null), st = b2VocState_(rows);
  st.rev = (prev && +prev.rev || 0) + 1; st.at = Date.now();
  b2Props_().setProperty('B2_VOC_STATE', JSON.stringify(st));
  return st;
}
// 시트를 직접 고쳤거나(Code.gs onEdit) 예전 담임 포털로 접수·처리했을 때 알림 건수를 다시 셉니다.
function b2VocRefresh_() { return b2VocSaveState_(b2VocRead_().rows); }
// 쓰기 전에 민원이슈 탭 K~P 머리글을 확인합니다(없으면 붙임).
function b2VocSheet_() {
  var sh = b2Sheet_(B2.SHEETS.voc);
  if (sh.getMaxColumns() < 16) sh.insertColumnsAfter(sh.getMaxColumns(), 16 - sh.getMaxColumns());
  if (String(sh.getRange(1, 11).getValue()).trim() !== B2_VOC_HEAD[0]) sh.getRange(1, 11, 1, B2_VOC_HEAD.length).setValues([B2_VOC_HEAD]);
  return sh;
}
// key: 번호(V…) 또는 번호가 없는 예전 기록이면 'R행번호'(sig로 그 행이 그대로인지 확인).
function b2VocFind_(rows, p) {
  var key = String(p && p.key || ''), hit = null;
  if (/^V/.test(key)) hit = rows.filter(function (r) { return r.id === key; })[0];
  else if (/^R\d+$/.test(key)) hit = rows.filter(function (r) { return !r.id && 'R' + r.row === key && b2VocSig_(r) === String(p.sig || ''); })[0];
  if (!hit) throw new Error('민원·이슈를 찾지 못했습니다(그사이 시트가 바뀌었을 수 있습니다). 새로고침해 주세요.');
  if (__ACTOR_ROLE === 'TEACHER' && hit.cls !== String(p.cls || '')) throw new Error('다른 반 민원·이슈입니다.');
  return hit;
}
function b2VocNewId_(rows, now) {
  var day = b2Fmt_(now, 'yyMMdd'), n = rows.filter(function (r) { return r.id.indexOf('V' + day + '-') === 0; }).length + 1;
  return 'V' + day + '-' + ('00' + n).slice(-3);
}
function b2VocOut_(r, admin) {
  return {
    key: r.id || 'R' + r.row, sig: r.id ? '' : b2VocSig_(r), id: r.id, date: r.date, cls: r.cls, region: r.region, course: r.course, type: r.type, detail: r.detail,
    status: r.status, action: r.action, done: r.done, days: r.days, author: admin ? r.author : '', lastBy: r.lastBy || '담임', lastAt: r.lastAt, seen: r.seen,
    thread: b2VocThread_(r.raw).map(function (x) { return { at: x.at, side: x.side, who: admin ? x.who : '', text: x.text }; })
  };
}
function b2VocMail_(kind, r, text, side) {
  var info = b2Info_().filter(function (c) { return c.id === r.cls; })[0] || {};
  try {
    MailApp.sendEmail({
      to: B2.MAIL.join(','), name: 'HINT 운영포털',
      subject: '[HINT 민원·이슈] ' + r.cls + '반 · ' + (r.type || '민원') + ' · ' + kind,
      body: [kind === '새 접수' ? '새 민원·이슈가 접수됐습니다.' : side + ' 쪽에서 답글을 남겼습니다.', '',
        '번호: ' + (r.id || '-'), '반: ' + r.cls + '반' + (info.teacher ? ' (담임 ' + info.teacher + ')' : ''), '유형: ' + (r.type || '-'), '처리 상태: ' + (r.status || '접수'),
        (kind === '새 접수' ? '내용: ' : '답글: ') + text, '작성: ' + b2Actor_(), '',
        '처리함: ' + B2.BETA_URL + '#vocs', '마스터시트: ' + b2Ss_().getUrl() + '#gid=' + b2Sheet_(B2.SHEETS.voc).getSheetId()].join('\n')
    });
    return true;
  } catch (e) { return false; }
}
// p: {cls} 없으면 전체(관리자). 담임에게는 작성자 이메일을 보내지 않습니다.
function b2Vocs_(p) {
  var cls = p && p.cls ? String(p.cls) : '', admin = __ACTOR_ROLE === 'ADMIN' || !__ACTOR_ROLE;
  var rows = b2VocRead_().rows.filter(function (r) { return B2.SOURCE_TABS[r.cls] && (!cls || r.cls === cls); });
  rows.sort(function (a, b) { return (b.lastAt || b.date).localeCompare(a.lastAt || a.date) || b.row - a.row; });
  return { statuses: B2.VOC_STATUS, types: B2.VOC_TYPES, state: b2JsonProp_('B2_VOC_STATE', null), rows: rows.map(function (r) { return b2VocOut_(r, admin); }) };
}
// 새 민원·이슈. p: {cls, type, detail, side}. 담임 쪽 글이면 운영팀에 메일을 보냅니다.
function b2VocCreate_(p) {
  p = p || {};
  var cls = String(p.cls || '').trim(), type = String(p.type || '').trim(), detail = String(p.detail || '').trim(), side = b2VocSide_(p);
  if (!B2.SOURCE_TABS[cls]) throw new Error('반을 골라 주세요.');
  if (B2.VOC_TYPES.indexOf(type) < 0) throw new Error('유형을 골라 주세요.');
  if (!detail) throw new Error('내용을 적어 주세요.');
  if (detail.length > B2_VOC_TEXT_MAX) throw new Error('내용은 ' + B2_VOC_TEXT_MAX + '자 이하로 적어 주세요.');
  var lock = LockService.getDocumentLock(), now = new Date(), rec, state; lock.waitLock(20000);
  try {
    var sh = b2VocSheet_(), rows = b2VocRead_().rows, row = b2LastRow_(sh, 1) + 1;
    rec = { row: row, id: b2VocNewId_(rows, now), date: b2Iso_(now), cls: cls, type: type, detail: detail, status: '접수' };
    if (sh.getMaxRows() < row) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
    sh.getRange(row, 1, 1, 2).setValues([[b2DateValue_(rec.date), Number(cls)]]);
    sh.getRange(row, 5, 1, 5).setValues([[type, detail, '접수', '', '']]);
    sh.getRange(row, 11, 1, 6).setValues([[rec.id, b2Actor_(), '', side, now, '']]);
    SpreadsheetApp.flush();
    state = b2VocRefresh_();
  } finally { lock.releaseLock(); }
  var mailed = side === '담임' ? b2VocMail_('새 접수', rec, detail, side) : false;
  return { id: rec.id, mailed: mailed, state: state };
}
// 답글·처리 상태. p: {key, sig, cls, text, status, side}. 처리 상태를 바꾸면 그 줄도 기록에 남습니다. 담임 쪽 답글이면 운영팀에 메일을 보냅니다.
function b2VocReply_(p) {
  p = p || {};
  var side = b2VocSide_(p), text = String(p.text || '').trim(), status = String(p.status || '').trim();
  if (status && B2.VOC_STATUS.indexOf(status) < 0) throw new Error('처리 상태를 골라 주세요.');
  if (text.length > B2_VOC_TEXT_MAX) throw new Error('답글은 ' + B2_VOC_TEXT_MAX + '자 이하로 적어 주세요.');
  if (!text && !status) throw new Error('답글이나 처리 상태를 넣어 주세요.');
  var lock = LockService.getDocumentLock(), now = new Date(), r, state, changed; lock.waitLock(20000);
  try {
    var sh = b2VocSheet_(), rows = b2VocRead_().rows;
    r = b2VocFind_(rows, p); changed = !!status && status !== r.status;
    if (!text && !changed) return { ok: true, unchanged: true, state: b2JsonProp_('B2_VOC_STATE', null) };
    var add = [];
    if (changed) add.push(b2VocLine_(now, side, '처리 상태: ' + r.status + ' → ' + status));
    if (text) add.push(b2VocLine_(now, side, text));
    var st = changed ? status : r.status, done = st === '완료' ? b2DateValue_(r.done || b2Iso_(now)) : '';
    var action = side === '운영' && text ? text.replace(/\r?\n/g, ' ').slice(0, 500) : r.action;
    r.id = r.id || b2VocNewId_(rows, now); r.status = st;
    sh.getRange(r.row, 7, 1, 3).setValues([[st, action, done]]);
    sh.getRange(r.row, 11, 1, 5).setValues([[r.id, r.author, (r.raw ? r.raw + '\n' : '') + add.join('\n'), side, now]]);
    SpreadsheetApp.flush();
    state = b2VocRefresh_();
  } finally { lock.releaseLock(); }
  var mailed = side === '담임' && text ? b2VocMail_('답글', r, text, side) : false;
  return { ok: true, id: r.id, mailed: mailed, state: state };
}
// 담임이 운영팀 답글을 열어 봄(담임 쪽 알림 끄기). 담임 계정일 때만 적습니다(관리자가 담임 화면 미리보기에서 열어도 담임 알림은 그대로).
function b2VocSeen_(p) {
  p = p || {};
  if (__ACTOR_ROLE !== 'TEACHER') return { ok: true, unchanged: true };
  var lock = LockService.getDocumentLock(), state; lock.waitLock(20000);
  try {
    var sh = b2VocSheet_(), r = b2VocFind_(b2VocRead_().rows, p);
    if (!(r.lastBy === '운영' && r.lastAt > r.seen)) return { ok: true, unchanged: true };
    sh.getRange(r.row, 16).setValue(new Date());
    SpreadsheetApp.flush();
    state = b2VocRefresh_();
  } finally { lock.releaseLock(); }
  return { ok: true, state: state };
}

// doPost(Code.gs)가 API 키를 확인한 뒤에만 부르는 표. 왼쪽은 Vercel(api/teacher-beta.js)이 보내는 동작 이름(그대로), 오른쪽 함수는 모두 끝이 '_'입니다.
// 끝이 '_'가 아니면 같은 프로젝트 웹 앱(담임 PIN 포털)이 연 화면에서 누구나 google.script.run으로 키 없이 부를 수 있었습니다(2026-10-15 고침).
var B2_ACTIONS = {
  b2Bundle: b2Bundle_, b2Rev: b2Rev_, b2Status: b2Status_, b2SyncNow: b2SyncNow_, b2Save: b2Save_, b2Release: b2Release_,
  b2Docs: b2Docs_, b2DocCreate: b2DocCreate_, b2DocUpdate: b2DocUpdate_,
  b2Vocs: b2Vocs_, b2VocCreate: b2VocCreate_, b2VocReply: b2VocReply_, b2VocSeen: b2VocSeen_
};
