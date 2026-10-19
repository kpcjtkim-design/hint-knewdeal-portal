/* ======================================================================
 * HINT 운영 마스터시트 개편 (2026-10-16 회의) · restructure.gs
 *
 * 마스터시트 Apps Script 프로젝트에 새 파일 'restructure'로 추가합니다(Code.gs·beta2와 같은 프로젝트, beta2 함수를 씁니다).
 * 편집기에서만 돕니다(b2EditorOnly_). 순서: b2RestructureCheck(읽기만) → 파일 사본 만들기 → 스크립트 속성
 * B2_RESTRUCTURE_BACKUP = 사본 ID → b2RestructureSheet(바꾸기, 한 번만). 수업 시간 밖(동기화가 돌지 않는 때)에 실행합니다.
 *
 * 바꾸는 것
 *  1. 반정보 Q~U열에 반장·부반장·총무·반 운영 비고·수정일(반운영정보 탭 값을 옮김) → 반운영정보 탭 지움
 *  2. 교육일정 탭(새로): 운영 기준 + 날짜 × 17개 반(분야·강사). 교육일(C열 O·휴일)은 시간표 탭 G열에서 옮김 → 시간표 탭 지움.
 *     교육일자 탭은 숨기고 계산용으로만 둡니다(A열 = 교육일정 C열이 O인 날짜, D2 = 교육일정 수료 기준). 날짜 목록이 바뀌면 멈추고 되돌립니다.
 *  3. 17개 반 탭: 머리글 반장(B2)을 반정보에서, '가. 금주교육' 과목·장소 줄을 교육일정의 분야·강사로, 만족도 줄은 비움(만족도 보류),
 *     '라. 현장운영 체크리스트'·'바. 학습자 평가'·'사. 만족도 평가' 구역 줄을 지움('아. 민원·이슈'가 위로 올라옴)
 *  4. 대시보드 '나.' 구역(현장운영 체크리스트) → 누적 출결현황(누적관리 탭 내용)·당일 마감·반장·민원 미처리 → 누적관리 탭 지움
 *  5. 학습자평가·만족도평가 탭 지움(자료 없음 확인), 남은 '수식백업' 탭 지움(시트 다듬기가 꺼져 있을 때만)
 *  6. 홈 탭 바로가기·사용 순서 글, 반정보 안내 글, 민원이슈 K~P 머리글(주고받기 기록)
 * 그대로 두는 것: 만족도응답 탭(만족도 보류), 출결원장·명부·서류발급·교육생정보, 반 탭 출결판·출결사유.
 * 되돌리기: 자동으로 되돌리지 않습니다. 백업 사본에서 탭을 복사해 오거나 사본을 원본으로 씁니다(README '마스터시트 개편').
 * ====================================================================== */

var B2R = {
  DASH: '운영총괄(1기) 대시보드', CUM: '운영총괄(1기) 누적관리', EVAL: '학습자평가', SAT: '만족도평가', OFFICER: '반운영정보',
  TIMETABLE: '시간표', HOME: '홈', BACKUP: '수식백업',
  DAY_COLS: [5, 8, 11, 14, 17],  // 반 탭 '가. 금주교육' 날짜 칸(E·H·K·N·Q, 6행)
  OFFICER_HEAD: ['반장', '부반장', '총무', '반 운영 비고', '반 운영 수정일'],
  WEEKDAY: '일월화수목금토'
};
// 지우는 탭(지우기 전에 다른 탭 수식이 이 이름을 참조하는지 봅니다)
function b2RGone_() { return [B2R.CUM, B2R.EVAL, B2R.SAT, B2R.OFFICER, B2R.TIMETABLE]; }

/* ---------- 편집기에서 실행 ---------- */

// 읽기만 합니다. 바꿀 것·막는 이유를 로그에 남깁니다(학생 이름 없이 값만).
function b2RestructureCheck() {
  b2EditorOnly_();
  var s = b2RSummary_(b2RPlan_());
  console.log('b2RestructureCheck: ' + JSON.stringify(s));
  return s;
}

// 한 번만 실행합니다. 백업 사본(스크립트 속성 B2_RESTRUCTURE_BACKUP)이 있어야 하고, 점검에서 막는 이유가 없어야 합니다.
function b2RestructureSheet() {
  b2EditorOnly_();
  var ss = b2Ss_(), props = b2Props_(), backupId = String(props.getProperty('B2_RESTRUCTURE_BACKUP') || '').trim();
  if (!backupId) throw new Error('먼저 파일 → 사본 만들기로 백업 사본을 만들고, 그 사본 ID를 스크립트 속성 B2_RESTRUCTURE_BACKUP에 넣어 주세요.');
  if (backupId === ss.getId()) throw new Error('B2_RESTRUCTURE_BACKUP이 이 파일 ID입니다. 사본의 ID를 넣어 주세요.');
  var copy = null;
  try { copy = SpreadsheetApp.openById(backupId); } catch (e) { throw new Error('백업 사본을 열지 못했습니다: ' + b2Msg_(e)); }
  b2RGone_().concat([B2.SHEETS.days, B2.SHEETS.info, B2R.DASH]).forEach(function (name) {
    if (ss.getSheetByName(name) && !copy.getSheetByName(name)) throw new Error("백업 사본에 '" + name + "' 탭이 없습니다. 사본이 맞는지 확인해 주세요.");
  });
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  var done = [], step = function (label, fn) { fn(); SpreadsheetApp.flush(); done.push(label); };
  try {
    var plan = b2RPlan_();
    if (plan.blocked.length) throw new Error('바꾸지 않았습니다: ' + plan.blocked.slice(0, 6).join(' / '));
    // 더하는 일 먼저(반정보 Q~U, 교육일정 탭, 교육일자 수식). 교육일자 날짜 목록이 그대로인지 확인한 뒤에만 다른 탭을 고칩니다.
    step('반정보 반장 칸', function () { b2RWriteOfficer_(plan); });
    step('교육일정 탭', function () { b2RWriteSchedule_(plan); });
    step('교육일자 연결', function () { b2RLinkDays_(plan); });
    var after = b2Days_().list;
    if (after.join(',') !== plan.days.before.join(',')) {
      b2RUnlinkDays_(plan);
      throw new Error('교육일자 날짜 목록이 달라져(전 ' + plan.days.before.length + '일 · 후 ' + after.length + '일) 교육일자 수식을 되돌리고 멈췄습니다');
    }
    step('반 탭 수식', function () { plan.boards.forEach(b2RWriteBoard_); });
    step('대시보드', function () { b2RWriteDash_(plan); });
    step('홈·안내', function () { b2RWriteHome_(plan); b2RWriteNotes_(plan); });
    // 지우는 일은 마지막에(되돌리려면 백업 사본이 필요)
    step('반 탭 구역 지우기', function () { plan.boards.forEach(function (b) { b.sh.deleteRows(b.cut.from, b.cut.to - b.cut.from + 1); b2RFixVocLink_(b, plan); }); });
    step('탭 지우기', function () {
      b2RGone_().concat(plan.dropBackup ? [B2R.BACKUP] : []).forEach(function (name) { var sh = ss.getSheetByName(name); if (sh) ss.deleteSheet(sh); });
      plan.daysSh.hideSheet();
    });
    props.setProperty('B2_RESTRUCTURE', JSON.stringify({ at: Date.now(), backup: backupId, version: '20261016.1' }));
  } catch (e) {
    throw new Error(b2Msg_(e) + '. 마친 단계: ' + (done.join(', ') || '없음') + (done.length > 3 ? '. 되돌리려면 백업 사본에서 탭을 가져오세요(README 마스터시트 개편).' : ''));
  } finally { lock.releaseLock(); }
  b2Bump_();
  try { b2VocRefresh_(); } catch (e) { }
  var filled = null;
  try { filled = b2RFillFromSource_(); } catch (e) { filled = { error: b2Msg_(e) }; }
  var result = { ok: true, steps: done, boards: plan.boards.length, rowsDeleted: plan.boards.reduce(function (n, b) { return n + b.cut.to - b.cut.from + 1; }, 0), officer: plan.officer.moved, scheduleDays: plan.sched.rows.length, teachingDays: plan.days.before.length, schedule: filled };
  console.log('b2RestructureSheet: ' + JSON.stringify(result));
  return result;
}

/* ---------- 계획 (읽기만) ---------- */

function b2RBoard_(sh) {
  if (sh.getMaxRows() < 48 || sh.getMaxColumns() < 17) return 0;
  if (String(sh.getRange('A16').getValue()).trim() !== '이름') return 0;
  var n = Number(sh.getRange('D3').getValue());
  return n >= 1 && n <= 17 ? n : 0;
}
// 수식 안에서 탭 이름을 참조하는지('시간표'!A1 · 시간표!A1)
function b2RRefers_(formula, name) {
  var q = "'" + name.replace(/'/g, "''") + "'!";
  return formula.indexOf(q) >= 0 || (/^[\p{L}\p{N}_]+$/u.test(name) && new RegExp('(^|[^\\p{L}\\p{N}_\'])' + name + '!', 'u').test(formula));
}
function b2RPlan_() {
  var ss = b2Ss_(), props = b2Props_(), plan = { blocked: [], notes: [], boards: [], skip: {} };
  var need = function (name) { var s = ss.getSheetByName(name); if (!s) plan.blocked.push("'" + name + "' 탭이 없습니다"); return s; };
  if (props.getProperty('B2_RESTRUCTURE')) plan.blocked.push('이미 개편했습니다(스크립트 속성 B2_RESTRUCTURE)');
  if (b2SlimOn_()) plan.blocked.push('시트 다듬기(B2_SLIM=1)가 켜져 있습니다. b2RestoreFormulas로 되돌린 뒤 개편하고, 다듬기는 개편 뒤에 다시 하세요');
  if (ss.getSheetByName(B2.SHEETS.sched)) plan.blocked.push("'" + B2.SHEETS.sched + "' 탭이 이미 있습니다");
  plan.info = need(B2.SHEETS.info); plan.daysSh = need(B2.SHEETS.days); plan.dash = need(B2R.DASH); plan.voc = need(B2.SHEETS.voc);
  plan.timetable = need(B2R.TIMETABLE); plan.home = ss.getSheetByName(B2R.HOME);
  plan.dropBackup = !!ss.getSheetByName(B2R.BACKUP) && !b2SlimOn_();
  if (plan.blocked.length) return plan;
  b2RPlanOfficer_(plan, ss);
  b2RPlanSchedule_(plan);
  b2RPlanBoards_(plan, ss);
  b2RPlanDash_(plan, ss);
  b2RPlanHome_(plan);
  // 지울 학습자평가·만족도평가 탭에 자료가 있으면 멈춥니다(지금은 머리글만 있음).
  [B2R.EVAL, B2R.SAT].forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh) return;
    var rows = Math.max(0, sh.getLastRow() - 1);
    if (rows && sh.getRange(2, 1, rows, Math.max(1, sh.getLastColumn())).getValues().some(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); }))
      plan.blocked.push("'" + name + "' 탭에 자료가 " + rows + '줄 있습니다(지우기 전에 옮길 곳을 정해 주세요)');
  });
  var vh = plan.voc.getMaxColumns() >= 16 ? plan.voc.getRange(1, 11, 1, 6).getValues()[0] : [];
  if (vh.some(function (v, i) { return v !== '' && v !== B2_VOC_HEAD[i]; })) plan.blocked.push('민원이슈 K1:P1에 다른 값이 있습니다(주고받기 기록 칸)');
  b2RPlanRefs_(plan, ss);
  return plan;
}
function b2RPlanOfficer_(plan, ss) {
  var info = plan.info, o = { rows: [], moved: 0 };
  if (info.getMaxColumns() < 21) { plan.blocked.push('반정보 열이 U열까지 없습니다'); return; }
  var head = info.getRange(3, 17, 1, 5).getValues()[0], rows = info.getRange(4, 7, 17, 15).getValues();
  if (head.some(function (v) { return v !== '' && v !== null; })) plan.blocked.push('반정보 Q3:U3에 이미 값이 있습니다(반장 칸을 붙일 곳)');
  if (rows.some(function (r) { return r.slice(10).some(function (v) { return v !== '' && v !== null; }); })) plan.blocked.push('반정보 Q4:U20에 이미 값이 있습니다');
  var src = {}, old = ss.getSheetByName(B2R.OFFICER);
  if (old) old.getRange(2, 1, Math.max(1, Math.min(40, old.getMaxRows()) - 1), 7).getValues().forEach(function (r) { var n = Number(r[0]); if (n >= 1 && n <= 17) src[n] = [r[2], r[3], r[4], r[5], r[6]]; });
  rows.forEach(function (r) {
    var m = String(r[0]).trim().match(/^(\d+)반$/), line = m && src[+m[1]] ? src[+m[1]] : ['', '', '', '', ''];
    if (m && src[+m[1]]) { o.moved += line.some(function (v) { return v !== '' && v !== null; }) ? 1 : 0; delete src[+m[1]]; }
    o.rows.push(line);
  });
  var lost = Object.keys(src).filter(function (n) { return src[n].some(function (v) { return v !== '' && v !== null; }); });
  if (lost.length) plan.blocked.push('반운영정보의 ' + lost.join(',') + '반이 반정보에 없습니다');
  plan.officer = o;
}
function b2RPlanSchedule_(plan) {
  var tt = plan.timetable, last = tt.getLastRow(), byDay = {}, extra = 0, classRows = 0;
  var rows = last >= 2 ? tt.getRange(2, 1, last - 1, 8).getValues() : [];
  rows.forEach(function (r) {
    var iso = b2Iso_(r[0]); if (!iso) return;
    var mark = String(r[6] == null ? '' : r[6]).trim(), d = byDay[iso] || (byDay[iso] = '');
    if (mark === 'O') byDay[iso] = 'O'; else if (mark === '휴일' && d !== 'O') byDay[iso] = '휴일';
    if ([2, 3, 4, 5, 7].some(function (k) { return String(r[k] == null ? '' : r[k]).trim(); })) extra++;
    var who = String(r[1] == null ? '' : r[1]).trim(); if (who && who !== '전체') classRows++;
  });
  if (extra) plan.blocked.push('시간표에 구분·과목·강사·장소·설문명이 적힌 줄이 ' + extra + '개 있습니다(교육일정으로 옮길 방법을 정한 뒤 실행)');
  if (classRows) plan.blocked.push('시간표에 대상이 \'전체\'가 아닌 줄이 ' + classRows + '개 있습니다(교육일정 교육일 칸은 모든 반 공통)');
  var isos = Object.keys(byDay).sort(), out = [];
  if (isos.length) {
    for (var d = b2DateValue_(isos[0]), end = b2DateValue_(isos[isos.length - 1]); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      var iso = b2Iso_(d), dow = d.getDay();
      if (byDay[iso] || (dow > 0 && dow < 6)) out.push({ iso: iso, dow: B2R.WEEKDAY.charAt(dow), mark: byDay[iso] || '' });
    }
  }
  var before = b2Days_().list, wanted = out.filter(function (x) { return x.mark === 'O'; }).map(function (x) { return x.iso; });
  if (wanted.join(',') !== before.join(',')) plan.blocked.push('시간표 교육일(O)과 지금 교육일자 목록이 다릅니다(시간표 ' + wanted.length + '일 · 교육일자 ' + before.length + '일)');
  var days = plan.daysSh;
  plan.days = { before: before, a2: days.getRange('A2').getFormula(), d2: days.getRange('D2').getValue(), d2Formula: days.getRange('D2').getFormula(), format: days.getRange('A2').getNumberFormat() };
  if (!/시간표/.test(plan.days.a2)) plan.notes.push('교육일자 A2 수식이 시간표를 참조하지 않습니다(그래도 교육일정을 보게 바꿉니다)');
  plan.sched = { rows: out, cols: 3 + 17 * B2.SCHED.perClass };
}
function b2RPlanBoards_(plan, ss) {
  var S = B2.SCHED;
  ss.getSheets().forEach(function (sh) {
    var n = b2RBoard_(sh); if (!n) return;
    var name = sh.getName(), last = sh.getLastRow(), b = { sh: sh, cls: n, name: name };
    var labels = last >= 49 ? sh.getRange(49, 1, last - 48, 1).getValues().map(function (r) { return String(r[0] == null ? '' : r[0]).trim(); }) : [];
    var at = function (p) { for (var i = 0; i < labels.length; i++) if (labels[i].indexOf(p) === 0) return 49 + i; return 0; };
    var ra = at('라.'), ba = at('바.'), sa = at('사.'), aa = at('아.');
    if (!(ra && ba && sa && aa && ra < ba && ba < sa && sa < aa)) { plan.blocked.push(name + ": '라.·바.·사.·아.' 구역을 찾지 못했습니다"); return; }
    b.cut = { from: ra, to: aa - 1 };
    var top = sh.getRange(7, 1, 3, 1).getValues().map(function (r) { return String(r[0]).trim(); });
    if (top.join('|') !== '과목|장소|만족도') { plan.blocked.push(name + ": '가. 금주교육' 7~9행이 과목·장소·만족도가 아닙니다"); return; }
    var b2f = sh.getRange('B2').getFormula();
    if (b2RRefers_(b2f, B2R.OFFICER)) {
      var fixed = b2f.replace(/IFERROR\(VLOOKUP\(\$D\$3,'반운영정보'!\$A\$2:\$C\$18,3,FALSE\),""\)/g, 'IFERROR(VLOOKUP($D$3&"반",\'반정보\'!$G$4:$Q$20,11,FALSE),"")');
      if (b2RRefers_(fixed, B2R.OFFICER)) { plan.blocked.push(name + ' B2 머리글 수식의 반운영정보 참조를 바꿀 수 없습니다'); return; }
      b.b2 = fixed;
    }
    var sc = b2ColName_(S.firstCol + (n - 1) * S.perClass), tc = b2ColName_(S.firstCol + (n - 1) * S.perClass + 1), T = "'" + B2.SHEETS.sched + "'!";
    var A = T + '$A$' + S.first + ':$A', C = T + '$C$' + S.first + ':$C';
    b.cells = B2R.DAY_COLS.map(function (c) {
      var d = b2ColName_(c) + '$6';
      return { col: c,
        subj: '=IF(COUNTIFS(' + A + ',' + d + ',' + C + ',"휴일")>0,"휴일",IF(COUNTIF(\'교육일자\'!$A$2:$A,' + d + ')=0,"교육 없음",IFERROR(TEXTJOIN(" / ",TRUE,FILTER(' + T + '$' + sc + '$' + S.first + ':$' + sc + ',' + A + '=' + d + ')),"")))',
        who: '=IFERROR(TEXTJOIN(" / ",TRUE,UNIQUE(FILTER(' + T + '$' + tc + '$' + S.first + ':$' + tc + ',' + A + '=' + d + ',' + T + '$' + tc + '$' + S.first + ':$' + tc + '<>""))),"")' };
    });
    plan.skip[name] = { b2: true, rows: [7, 9], cut: [b.cut.from, b.cut.to] };
    plan.boards.push(b);
  });
  if (plan.boards.length !== 17 && !plan.blocked.some(function (x) { return /구역|금주교육|B2/.test(x); })) plan.notes.push('반 탭 ' + plan.boards.length + '개(17개가 아님)');
}
function b2RPlanDash_(plan, ss) {
  var sh = plan.dash, head = sh.getRange(25, 3, 2, 6).getValues();
  if (String(head[0][0]).indexOf('나.') !== 0 || String(head[1][2]).trim() !== '마감' || String(head[1][3]).trim() !== '강의 전') { plan.blocked.push("대시보드 '나. 현장운영 체크리스트' 구역(25~26행) 모양이 다릅니다"); return; }
  if (sh.getMaxColumns() < 17) { plan.blocked.push('대시보드 열이 Q열까지 없습니다'); return; }
  var side = sh.getRange(26, 16, 19, 2).getValues(), tail = sh.getRange(44, 1, 1, 17).getValues()[0];
  if (side.some(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); })) plan.blocked.push('대시보드 P26:Q44에 이미 값이 있습니다(반장·민원 칸을 붙일 곳)');
  plan.dashTotal = !tail.some(function (v) { return v !== '' && v !== null; });
  var names = sh.getRange(27, 1, 17, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var ids = sh.getRange(27, 10, 17, 1).getValues().map(function (r) { var m = String(r[0]).match(/^(\d+)반$/); return m ? +m[1] : 0; });
  names.forEach(function (t, i) { if (!t || !ss.getSheetByName(t)) plan.blocked.push('대시보드 A' + (27 + i) + '의 반 탭(' + (t || '빈 칸') + ')을 찾지 못했습니다'); if (!ids[i]) plan.blocked.push('대시보드 J' + (27 + i) + '에 반 번호가 없습니다'); });
  plan.dashRows = names.map(function (t, i) { return { tab: t, cls: ids[i] }; });
  plan.skip[B2R.DASH] = { range: [25, 5, 44, 17] };
}
function b2RPlanHome_(plan) {
  var h = plan.home; if (!h) { plan.notes.push('홈 탭 없음(바로가기는 그대로)'); return; }
  var f = h.getRange(5, 2, 12, 5).getFormulas();
  if (!/누적관리/.test(f[0][1]) || !/시간표/.test(f[10][1]) || !/반운영정보/.test(f[11][3])) { plan.notes.push('홈 탭 바로가기 모양이 달라 홈은 그대로 둡니다'); return; }
  plan.homeLinks = f;
  plan.skip[B2R.HOME] = { range: [5, 2, 16, 6] };
}
// 지울 탭을 참조하는 수식이 남는지 봅니다(바꿀 칸·지울 줄·지울 탭은 뺌). 남으면 멈춥니다(#REF! 방지).
function b2RPlanRefs_(plan, ss) {
  var gone = b2RGone_(), left = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName(); if (gone.indexOf(name) >= 0 || name === B2R.BACKUP) return;
    var lr = sh.getLastRow(), lc = sh.getLastColumn(); if (!lr || !lc) return;
    var skip = plan.skip[name] || {};
    sh.getRange(1, 1, lr, lc).getFormulas().forEach(function (row, i) {
      row.forEach(function (f, j) {
        if (!f) return;
        var r = i + 1, c = j + 1;
        if (name === B2.SHEETS.days && r === 2 && c === 1) return;
        if (skip.b2 && r === 2 && c === 2) return;
        if (skip.rows && r >= skip.rows[0] && r <= skip.rows[1]) return;
        if (skip.cut && r >= skip.cut[0] && r <= skip.cut[1]) return;
        if (skip.range && r >= skip.range[0] && r <= skip.range[2] && c >= skip.range[1] && c <= skip.range[3]) return;
        gone.forEach(function (g) { if (b2RRefers_(f, g)) left.push(name + '!' + b2ColName_(c) + r + '→' + g); });
      });
    });
  });
  if (left.length) plan.blocked.push('지울 탭을 참조하는 수식이 ' + left.length + '칸 남습니다: ' + left.slice(0, 6).join(', '));
}
function b2RSummary_(plan) {
  return {
    ready: !plan.blocked.length, blocked: plan.blocked, notes: plan.notes,
    boards: plan.boards.map(function (b) { return b.cls + '반 ' + b.cut.from + '~' + b.cut.to + '행 지움'; }),
    officerMoved: plan.officer ? plan.officer.moved : 0, scheduleRows: plan.sched ? plan.sched.rows.length : 0, teachingDays: plan.days ? plan.days.before.length : 0,
    dropTabs: b2RGone_().concat(plan.dropBackup ? [B2R.BACKUP] : []), home: !!plan.homeLinks, backup: b2Props_().getProperty('B2_RESTRUCTURE_BACKUP') ? '있음' : '없음'
  };
}

/* ---------- 쓰기 ---------- */

function b2RWriteOfficer_(plan) {
  plan.info.getRange(3, 17, 1, 5).setValues([B2R.OFFICER_HEAD]);
  plan.info.getRange(4, 17, 17, 5).setValues(plan.officer.rows);
}
function b2RWriteSchedule_(plan) {
  var ss = b2Ss_(), S = B2.SCHED, rows = plan.sched.rows, width = plan.sched.cols, idx = plan.info.getIndex ? plan.info.getIndex() : undefined;
  var sh = idx ? ss.insertSheet(B2.SHEETS.sched, idx) : ss.insertSheet(B2.SHEETS.sched);
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  var need = S.first + rows.length + 30;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.getRange(1, 1, 2, 1).setValues([['교육일정'], ['C열 교육일(O = 교육일 · 휴일)이 교육일자와 출결판 날짜가 됩니다. 반별 분야·강사는 운영총괄 「전국 교육일정관리」에서 자동으로 채웁니다(평일 09:10~18:00, 직접 고치면 다음 동기화가 덮어씀). 동기화를 끈 시트(2기)는 직접 적습니다.']]);
  sh.getRange(4, 4, 1, 8).setValues([['수료 기준 출석률', plan.days.d2 === '' ? 0.8 : plan.days.d2, '오늘', '', '실시 교육일수', '', '메인 교육일', '']]);
  sh.getRange(4, 7).setFormula("='교육일자'!$D$3"); sh.getRange(4, 9).setFormula("='교육일자'!$D$4"); sh.getRange(4, 11).setFormula("='교육일자'!$D$5");
  var labels = [], head = ['날짜', '요일', '교육일'];
  for (var n = 1; n <= 17; n++) {
    labels.push('="' + n + '반 · "&IFERROR(VLOOKUP("' + n + '반",\'반정보\'!$G$4:$I$20,2,FALSE)&" "&VLOOKUP("' + n + '반",\'반정보\'!$G$4:$I$20,3,FALSE),"")', '');
    head.push('분야', '강사');
  }
  sh.getRange(S.head - 1, S.firstCol, 1, labels.length).setFormulas([labels]);
  sh.getRange(S.head, 1, 1, head.length).setValues([head]);
  if (rows.length) {
    sh.getRange(S.first, 1, rows.length, 3).setValues(rows.map(function (x) { return [b2DateValue_(x.iso), x.dow, x.mark]; }));
    sh.getRange(S.first, 1, rows.length, 1).setNumberFormat(plan.days.format || 'yyyy/mm/dd');
  }
  b2RStyleSchedule_(sh, rows.length, width);
}
// 보기 좋게: 머리글 굵게·고정, 반마다 두 칸 묶음, 메인 교육일 줄 파란색·휴일 붉은색·교육 없는 날 흐리게, 교육일 칸 목록(경고만)
function b2RStyleSchedule_(sh, n, width) {
  var S = B2.SCHED, last = S.first + Math.max(1, n) - 1;
  sh.setFrozenRows(S.head); sh.setFrozenColumns(3);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sh.getRange(2, 1).setFontColor('#5f6368');
  sh.getRange(4, 4, 1, 8).setFontWeight('bold');
  sh.getRange(4, 5).setNumberFormat('0%'); sh.getRange(4, 7).setNumberFormat('yyyy/mm/dd'); sh.getRange(4, 11).setNumberFormat('yyyy/mm/dd (ddd)');
  for (var c = S.firstCol; c < S.firstCol + 17 * S.perClass; c += S.perClass) sh.getRange(S.head - 1, c, 1, S.perClass).merge();
  sh.getRange(S.head - 1, 1, 2, width).setFontWeight('bold').setBackground('#e8eaed');
  sh.getRange(S.head, 1, 1, width).setBackground('#073763').setFontColor('#ffffff');
  sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 40); sh.setColumnWidth(3, 56);
  for (var k = 0; k < 17; k++) { sh.setColumnWidth(S.firstCol + k * S.perClass, 160); sh.setColumnWidth(S.firstCol + k * S.perClass + 1, 80); }
  var body = sh.getRange(S.first, 1, last - S.first + 1, width), mk = function () { return SpreadsheetApp.newConditionalFormatRule().setRanges([body]); };
  sh.setConditionalFormatRules([
    mk().whenFormulaSatisfied('=AND($A' + S.first + '<>"",$A' + S.first + '=$K$4)').setBackground('#e8f0fe').setBold(true).build(),
    mk().whenFormulaSatisfied('=$C' + S.first + '="휴일"').setBackground('#fce8e6').setFontColor('#a50e0e').build(),
    mk().whenFormulaSatisfied('=AND($A' + S.first + '<>"",$C' + S.first + '<>"O")').setFontColor('#9aa0a6').build()
  ]);
  sh.getRange(S.first, 3, last - S.first + 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['O', '휴일'], true).setAllowInvalid(true).build());
}
function b2RLinkDays_(plan) {
  var S = B2.SCHED, T = "'" + B2.SHEETS.sched + "'!";
  plan.daysSh.getRange('A2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + T + 'A' + S.first + ':A, ' + T + 'C' + S.first + ':C="O", ' + T + 'A' + S.first + ':A<>""))),"")');
  plan.daysSh.getRange('D2').setFormula('=' + T + '$E$4');
  plan.daysSh.getRange('F1').setValue('A열·D2는 교육일정 탭에서 옵니다(2026-10-16 개편). 이 탭은 계산용으로 숨겨 둡니다.');
  if (String(plan.daysSh.getRange('C6').getValue()).trim() === '메모') plan.daysSh.getRange('D6').setValue('A열은 교육일정 탭에서 교육일=O인 날짜를 자동으로 모음. 직접 고치지 말고 교육일정을 고칠 것.');
}
// 교육일자 날짜가 달라졌을 때: 교육일자 수식을 되돌리고 새 교육일정 탭과 반정보 Q~U를 비웁니다(다시 실행할 수 있게, 바꾸기 전과 같게).
function b2RUnlinkDays_(plan) {
  var d = plan.daysSh;
  plan.info.getRange(3, 17, 18, 5).clearContent();
  if (plan.days.a2) d.getRange('A2').setFormula(plan.days.a2);
  if (plan.days.d2Formula) d.getRange('D2').setFormula(plan.days.d2Formula); else d.getRange('D2').setValue(plan.days.d2);
  d.getRange('F1').setValue('');
  var sh = b2Ss_().getSheetByName(B2.SHEETS.sched); if (sh) b2Ss_().deleteSheet(sh);
  SpreadsheetApp.flush();
}
function b2RWriteBoard_(b) {
  if (b.b2) b.sh.getRange('B2').setFormula(b.b2);
  b.sh.getRange('A8').setValue('강사');
  b.cells.forEach(function (x) { b.sh.getRange(7, x.col).setFormula(x.subj); b.sh.getRange(8, x.col).setFormula(x.who); });
  b.sh.getRange(9, 1, 1, 19).clearContent(); // 만족도 줄(만족도 보류: 현대 측 사이트와 통합할 때 다시)
}
// 대시보드 '나.' 구역: 누적 출결현황(누적관리 탭 가. 구역과 같은 계산) · 당일 마감 · 반 정보(기존 J~O) · 반장 · 민원 미처리
function b2RWriteDash_(plan) {
  var sh = plan.dash;
  sh.getRange(27, 5, 17, 4).clearDataValidations(); // 예전 체크리스트 칸의 입력 거부 규칙(F27 '완료, 미완료')
  sh.getRange(25, 3).setValue('나. 누적 출결현황 · 반 운영');
  sh.getRange(26, 5, 1, 4).setValues([['누적 출석률', '누적 결석률', '미수료(80%미만)', '당일 마감']]);
  sh.getRange(26, 16, 1, 2).setValues([['반장', '민원 미처리']]);
  var tab = function (t) { return "'" + t.replace(/'/g, "''") + "'!"; };
  sh.getRange(27, 5, 17, 4).setFormulas(plan.dashRows.map(function (r, i) {
    var t = tab(r.tab), row = 27 + i;
    return ['=IFERROR(AVERAGE(' + t + 'C17:C48),"")', '=IF(E' + row + '="","",1-E' + row + ')', '=IFERROR(' + t + 'J13,"")', '=IFERROR(' + t + 'K13,"")'];
  }));
  sh.getRange(27, 16, 17, 2).setFormulas(plan.dashRows.map(function (r, i) {
    return ["='반정보'!Q" + (4 + i), "=COUNTIFS('민원이슈'!$B$2:$B," + r.cls + ",'민원이슈'!$G$2:$G,\"<>완료\",'민원이슈'!$G$2:$G,\"<>해당없음\")"];
  }));
  sh.getRange(27, 5, 17, 2).setNumberFormat('0.0%');
  if (plan.dashTotal) {
    sh.getRange(44, 3).setValue('총계');
    sh.getRange(44, 5, 1, 3).setFormulas([['=IFERROR(AVERAGE(E27:E43),"")', '=IF(E44="","",1-E44)', '=SUM(G27:G43)']]);
    sh.getRange(44, 17).setFormula('=SUM(Q27:Q43)');
    sh.getRange(44, 5, 1, 2).setNumberFormat('0.0%');
  }
}
function b2RWriteHome_(plan) {
  var h = plan.home, f = plan.homeLinks; if (!h || !f) return;
  var ss = b2Ss_(), gid = function (name) { var s = ss.getSheetByName(name); return s ? s.getSheetId() : ''; }, link = function (name, label) { return '=HYPERLINK("#gid=' + gid(name) + '","' + label + '")'; };
  h.getRange(5, 2, 1, 4).setFormulas([[f[0][0], f[0][2], link(B2.SHEETS.sched, '교육일정'), f[0][3]]]);
  h.getRange(15, 2, 2, 5).setFormulas([
    [f[10][0], link(B2.SHEETS.sched, '교육일정'), link(B2.SHEETS.info, '반정보 (반장·비고 포함)'), f[11][2], f[10][4]],
    [link(B2.SHEETS.docs, '서류발급'), f[11][4], '', '', '']
  ]);
  h.getRange(18, 1).setValue('① 본사: 반정보 · 명부 · 교육일정을 먼저 채웁니다. 교육일정의 교육일=O 인 날짜가 교육일자와 출결판 날짜가 됩니다.');
  h.getRange(21, 1).setValue('④ 반별 출결판 · 가-3 · 대시보드는 자동으로 바뀝니다. 직접 고치지 않습니다.');
  if (h.getMaxRows() >= 25 && !h.getRange(25, 1).getValue()) h.getRange(25, 1).setValue('⑦ 민원·이슈는 운영포털(2기)에서 담임과 운영팀이 주고받습니다. 이 시트 민원이슈 탭에는 기록이 함께 남습니다.');
}
function b2RWriteNotes_(plan) {
  plan.info.getRange('G2').setValue('반별 정보를 입력하면 대시보드·반별 시트에 자동 반영됩니다. O열 시트명은 탭 이름과 같아야 합니다. Q~U열(반장·부반장·총무·비고)은 담임 포털 \'반 정보\'에서도 저장됩니다.');
  b2VocSheet_(); // 민원이슈 K~P 머리글(지금 탭은 J열까지라 열을 늘림)
}
// 줄을 지운 뒤 '아. 민원·이슈' 머리 줄의 바로가기 글(시트에서 입력 → 포털에서 주고받기)
function b2RFixVocLink_(b, plan) {
  var cell = b.sh.getRange(b.cut.from, 5), f = cell.getFormula();
  if (/민원이슈 탭에서 입력/.test(f)) cell.setFormula('=HYPERLINK("#gid=' + plan.voc.getSheetId() + '","민원이슈 탭 보기 (주고받기는 운영포털) →")');
}
// 개편 직후 한 번: 운영총괄 교육일정표로 분야·강사를 바로 채웁니다(동기화를 기다리지 않게). 동기화를 끈 시트면 건너뜁니다.
function b2RFillFromSource_() {
  var id = b2SourceId_(); if (!id) return { skipped: '동기화를 끈 시트' };
  var src = SpreadsheetApp.openById(id).getSheetByName(B2.SHEETS.srcSched); if (!src) return { skipped: '운영총괄에 전국 교육일정관리 탭 없음' };
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  try { var r = b2FillSchedule_(b2Sheet_(B2.SHEETS.sched), src.getDataRange().getDisplayValues()); SpreadsheetApp.flush(); return { cells: r.cells, missing: r.missing.length }; }
  finally { lock.releaseLock(); }
}
