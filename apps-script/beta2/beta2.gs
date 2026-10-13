/* ======================================================================
 * HINT 2기 베타 · 마스터시트 확장 (beta2.gs)
 *
 * 마스터시트(HINT 운영 마스터시트)에 연결된 Apps Script 프로젝트에 새 파일 'beta2'로 추가합니다.
 * - 1기 운영총괄(읽기 전용) → 마스터시트 출결원장·명부·반정보·서류발급 가져오기 (10분마다, 바뀐 때만)
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

/* 출결원장 행 합치기. existing: [{rec, prov, sig, flag}], desired: 운영총괄 기록, scope: {cls: {iso:true}}
 * - 동기화로 들어온 뒤 손대지 않은 행(출처=1기 동기화, 지문 일치 또는 '*')만 운영총괄 값으로 바꾸거나 지웁니다.
 * - 출처가 비어 있고 값이 같은 행은 동기화 행으로 받아들입니다(처음 한 번).
 * - 그 밖의 행은 그대로 두고, 운영총괄과 다르면 T열에 적습니다. */
function b2Merge_(existing, desired, scope) {
  var want = {}, used = {}, seen = {}, out = [], changed = {}, stats = { added: 0, updated: 0, removed: 0, adopted: 0, flagged: 0, kept: 0 };
  desired.forEach(function (d) { want[b2Key_(d)] = d; });
  var push = function (rec, prov, sig, flag, before) {
    out.push({ rec: rec, prov: prov, sig: sig, flag: flag || '' });
    if (before && (before.prov !== prov || before.sig !== sig || (before.flag || '') !== (flag || ''))) changed[rec.cls] = true;
  };
  existing.forEach(function (e) {
    var rec = b2Norm_(e.rec), k = b2Key_(rec), dates = scope[rec.cls];
    if (seen[k]) { push(rec, e.prov, e.sig, '같은 학생·날짜 기록이 여러 줄입니다', e); stats.flagged++; return; }
    seen[k] = true;
    if (!dates || !dates[rec.date]) { out.push({ rec: rec, prov: e.prov, sig: e.sig, flag: e.flag || '' }); return; }
    var d = want[k], cur = b2Sig_(rec), synced = e.prov === B2.PROV_SYNC && (e.sig === cur || e.sig === '*'), unknown = !e.prov && !e.sig;
    if (d) {
      used[k] = true;
      var ds = b2Sig_(d);
      if (synced) {
        if (ds !== cur || e.sig === '*') { push(b2Norm_(d), B2.PROV_SYNC, ds, d.note, e); changed[rec.cls] = true; stats.updated++; }
        else push(rec, B2.PROV_SYNC, cur, d.note, e);
      } else if (unknown && ds === cur) { push(rec, B2.PROV_SYNC, cur, d.note, e); stats.adopted++; }
      else {
        var diff = b2Diff_(rec, d);
        push(rec, e.prov || B2.PROV_DIRECT, e.sig, diff, e);
        if (diff) stats.flagged++; else stats.kept++;
      }
    } else if (synced) { changed[rec.cls] = true; stats.removed++; }
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
  return { rows: out, stats: stats, changed: Object.keys(changed) };
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
function b2WriteLedger_(ledger, rows) {
  var sh = ledger.sh, n = rows.length, oldLast = ledger.last;
  if (sh.getMaxColumns() < B2.COL.width) sh.insertColumnsAfter(sh.getMaxColumns(), B2.COL.width - sh.getMaxColumns());
  if (sh.getMaxRows() < n + 1) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());
  if (n) {
    sh.getRange(2, 1, n, B2.COL.input).setValues(rows.map(function (r) { return b2LedgerValues_(r.rec); }));
    sh.getRange(2, B2.COL.prov, n, 3).setValues(rows.map(function (r) { return [r.prov || '', r.sig || '', r.flag || '']; }));
    var dateFormat = sh.getRange(2, 1).getNumberFormat();
    sh.getRange(2, 1, n, 1).setNumberFormat(/y/.test(dateFormat) ? dateFormat : 'yyyy/mm/dd (ddd)');
    sh.getRange(2, 5, n, 4).setNumberFormat('hh:mm');
  }
  if (oldLast > n + 1) {
    sh.getRange(n + 2, 1, oldLast - n - 1, B2.COL.input).clearContent();
    sh.getRange(n + 2, B2.COL.prov, oldLast - n - 1, 3).clearContent();
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
  classes.forEach(function (cls) {
    var tab = (info[cls] && info[cls].tab) || B2.SOURCE_TABS[cls], sh = tab && ss.getSheetByName(tab);
    if (!sh || String(sh.getRange('A16').getValue()) !== '이름') return;
    var people = ctx.roster.filter(function (p) { return p.cls === String(cls); }).slice(0, 32);
    var width = Math.min(60, sh.getMaxColumns() - 4);
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

function b2ReadSourceClass_(src, cls) {
  var sh = src.getSheetByName(B2.SOURCE_TABS[cls]);
  if (!sh) throw new Error(cls + '반 운영총괄 탭을 찾지 못했습니다.');
  var G = B2.GRID, width = sh.getMaxColumns() - G.nameCol + 1, range = sh.getRange(G.headerRow, G.nameCol, G.lastRow - G.headerRow + 1, width);
  return { values: range.getDisplayValues(), backgrounds: range.getBackgrounds() };
}

// opts: {classes: ['3'] (없으면 전체), force: true면 바뀌지 않았어도 읽음, reason: 'trigger'|'manual'|'setup'}
function b2SyncRun_(opts) {
  opts = opts || {};
  var props = b2Props_(), all = !opts.classes || !opts.classes.length, started = Date.now(), srcUpdated = 0, sourceId = b2SourceId_();
  if (!sourceId) return { skipped: true, reason: '원본 시트가 없어 동기화하지 않습니다(2기 마스터).' };
  if (all) {
    srcUpdated = DriveApp.getFileById(sourceId).getLastUpdated().getTime();
    if (!opts.force && props.getProperty('B2_LEGACY_ADOPTED') === '1' && srcUpdated <= (+props.getProperty('B2_SRC_SEEN') || 0)) {
      props.setProperty('B2_SYNC_CHECKED', String(Date.now()));
      return { skipped: true, reason: '운영총괄이 바뀌지 않았습니다.' };
    }
  }
  var classes = all ? Object.keys(B2.SOURCE_TABS) : opts.classes.map(String).filter(function (c) { return B2.SOURCE_TABS[c]; });
  // 처음 한 번: beta2 설치 전부터 있던 출결원장 행(출처·지문 빈칸)은 운영총괄 값으로 맞춥니다(사용자 결정 2026-10-13).
  var adoptLegacy = all && props.getProperty('B2_LEGACY_ADOPTED') !== '1';
  var src = SpreadsheetApp.openById(sourceId), days = b2Days_(), today = b2Today_();
  var desired = [], scope = {}, students = {}, errors = [];
  classes.forEach(function (cls) {
    try {
      var grid = b2ReadSourceClass_(src, cls), parsed = b2ParseGrid_(cls, grid.values, grid.backgrounds, today, days.set);
      desired = desired.concat(parsed.records); students[cls] = parsed.students;
      scope[cls] = {}; parsed.dates.forEach(function (d) { scope[cls][d] = true; });
    } catch (e) { errors.push(cls + '반: ' + (e && e.message || e)); }
  });
  var srcDocs = null;
  if (all) { try { srcDocs = src.getSheetByName(B2.SHEETS.srcDocs).getDataRange().getDisplayValues(); } catch (e) { errors.push('서류발급요청: ' + (e && e.message || e)); } }
  var srcInfo = null;
  if (all) { try { srcInfo = src.getSheetByName(B2.SHEETS.info).getRange('G4:N20').getDisplayValues(); } catch (e) { errors.push('반정보: ' + (e && e.message || e)); } }

  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  var result;
  try {
    // 명부를 먼저 씁니다(출결원장 이름 칸의 명부 데이터 확인 규칙과 맞추기 위해).
    var roster = b2ReadRoster_(), rm = b2MergeRoster_(roster.rows, students, b2ReadPeople_());
    rm.updates.forEach(function (u) {
      if (u.status) roster.sh.getRange(u.row, 4, 1, 2).setValues([[u.status, u.changed ? b2DateValue_(u.changed) : '']]);
      if (u.birth || u.gender) {
        var cur = roster.sh.getRange(u.row, 7, 1, 2).getValues()[0];
        roster.sh.getRange(u.row, 7, 1, 2).setValues([[u.birth ? b2DateValue_(u.birth) : cur[0], u.gender || cur[1]]]);
      }
    });
    if (rm.appends.length) {
      var at = roster.last + 1;
      if (roster.sh.getMaxRows() < at + rm.appends.length) roster.sh.insertRowsAfter(roster.sh.getMaxRows(), at + rm.appends.length - roster.sh.getMaxRows());
      roster.sh.getRange(at, 1, rm.appends.length, 5).setValues(rm.appends.map(function (a) { return [Number(a.cls), a.name, '', a.status, a.changed ? b2DateValue_(a.changed) : '']; }));
      roster.sh.getRange(at, 7, rm.appends.length, 2).setValues(rm.appends.map(function (a) { return [a.birth ? b2DateValue_(a.birth) : '', a.gender]; }));
    }
    if (rm.updates.length || rm.appends.length) SpreadsheetApp.flush();
    var ledger = b2ReadLedger_(), adopted = 0;
    if (adoptLegacy) ledger.rows.forEach(function (r) { if (!r.prov && !r.sig) { r.prov = B2.PROV_SYNC; r.sig = '*'; adopted++; } });
    var merged = b2Merge_(ledger.rows, desired, scope);
    var dirty = merged.changed.length > 0;
    if (dirty) b2WriteLedger_(ledger, merged.rows);
    var infoFilled = srcInfo ? b2FillInfo_(srcInfo) : 0;
    var docsAdded = srcDocs ? b2ImportDocs_(srcDocs) : 0;
    var boardClasses = merged.changed.slice();
    rm.appends.forEach(function (a) { if (boardClasses.indexOf(a.cls) < 0) boardClasses.push(a.cls); });
    var rowCls = {}; roster.rows.forEach(function (r) { rowCls[r.row] = r.cls; });
    rm.updates.forEach(function (u) { var c = rowCls[u.row]; if (u.status && c && boardClasses.indexOf(c) < 0) boardClasses.push(c); });
    if (opts.reason === 'setup') boardClasses = classes.slice();
    if (boardClasses.length) {
      var freshRoster = b2ReadRoster_().rows, freshLedger = dirty ? b2ReadLedger_().rows : ledger.rows;
      b2RefreshBoards_(boardClasses, { ledger: freshLedger, roster: freshRoster, days: days.list, today: today });
    }
    var s = merged.stats, changes = s.added + s.updated + s.removed + rm.updates.length + rm.appends.length + infoFilled + docsAdded;
    if (adoptLegacy && !errors.length) props.setProperty('B2_LEGACY_ADOPTED', '1');
    if (changes || dirty) b2Bump_();
    if (changes) {
      b2Log_(classes.length === 17 ? '' : classes.join(','), '', '', '', '추가 ' + s.added + ' · 수정 ' + s.updated + ' · 삭제 ' + s.removed + ' · 확인 필요 ' + s.flagged + ' · 명부 ' + (rm.updates.length + rm.appends.length) + ' · 서류 ' + docsAdded, '1기 동기화');
    }
    result = { at: Date.now(), ms: Date.now() - started, reason: opts.reason || '', classes: classes.length, stats: s, legacyAdopted: adopted, roster: { updated: rm.updates.length, added: rm.appends.length }, info: infoFilled, docs: docsAdded, errors: errors };
    props.setProperty('B2_SYNC_LAST', JSON.stringify(result));
    if (changes) props.setProperty('B2_SYNC_CHANGED', String(Date.now()));
    if (all && !errors.length) props.setProperty('B2_SRC_SEEN', String(srcUpdated));
  } finally { lock.releaseLock(); }
  return result;
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

// 10분 트리거가 부릅니다. 운영총괄이 바뀌지 않았으면 바로 끝납니다.
function b2SyncTick() {
  try { b2SyncRun_({ force: false, reason: 'trigger' }); }
  catch (e) { b2Props_().setProperty('B2_SYNC_ERROR', JSON.stringify({ at: Date.now(), message: String(e && e.message || e) })); throw e; }
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
  return { last: parse('B2_SYNC_LAST'), error: parse('B2_SYNC_ERROR'), checkedAt: +p.getProperty('B2_SYNC_CHECKED') || 0, changedAt: +p.getProperty('B2_SYNC_CHANGED') || 0, sourceSeen: +p.getProperty('B2_SRC_SEEN') || 0 };
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
    if (ledger.sh.getMaxColumns() < B2.COL.width) ledger.sh.insertColumnsAfter(ledger.sh.getMaxColumns(), B2.COL.width - ledger.sh.getMaxColumns());
    ledger.sh.getRange(row, 1, 1, B2.COL.input).setValues([b2LedgerValues_(rec)]);
    if (!cur && row > 2) { ledger.sh.getRange(row, 1).setNumberFormat(ledger.sh.getRange(2, 1).getNumberFormat()); ledger.sh.getRange(row, 5, 1, 4).setNumberFormat('hh:mm'); }
    ledger.sh.getRange(row, B2.COL.prov, 1, 3).setValues([[B2.PROV_BETA, '', '']]);
    SpreadsheetApp.flush();
    b2Log_(cls, name, date, cur ? b2Summary_(cur.rec) : '출석', rec.type === '출석' ? '출석' : b2Summary_(rec));
    try { b2BoardTouch_(cls, name, date, rec.type === '출석' ? null : rec, person); } catch (e) { }
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
