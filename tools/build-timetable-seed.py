#!/usr/bin/env python3
"""Rebuild timetable-seed.json from the K-뉴딜 아카데미 전체 일정표 workbook.

Usage: python3 tools/build-timetable-seed.py <일정표.xlsx> [--version YYYYMMDD] [--source 파일명] [--check]

The workbook layout: row 2 has class names ("수도권 1반"), row 3 the course,
rows 5+ one line per date (a repeated date adds another event that day).
Each class group is followed by a "시간" column holding the hours.
Lecture ids, the course catalog and existing sourceText mappings are kept
from the current seed so saved Firestore drafts stay linked to the same
lectures. Unknown cell texts stop the build instead of guessing.
"""
import json, re, sys, datetime, pathlib, collections
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / 'timetable-seed.json'
OVERRIDES = ROOT / 'tools' / 'timetable-overrides.json'
HOLIDAY = re.compile(r'연휴|휴무|휴일|한글날|개천절|성탄|신정|현충일|광복절|선거')


def compact(text):
    return re.sub(r'\s+', '', text or '')


def course_of(label):
    label = (label or '').strip()
    return '제조지능화' if label.startswith('제조지능화') else label


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    path = pathlib.Path(args[0])
    version = args[args.index('--version') + 1] if '--version' in args else datetime.date.today().strftime('%Y%m%d')
    old = json.loads(SEED.read_text())
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]

    # Class columns, each group ends with a "시간" column (row 4) holding hours.
    columns, group = [], []
    for col in range(1, ws.max_column + 1):
        name, venue = ws.cell(2, col).value, ws.cell(4, col).value
        match = re.search(r'(\d+)반', str(name or ''))
        if match:
            group.append((col, match.group(1), course_of(ws.cell(3, col).value)))
        elif str(venue or '').strip() == '시간' and group:
            columns += [(c, cid, course, col) for c, cid, course in group]
            group = []
    if len(columns) != len(old['classes']):
        sys.exit(f'반 열을 {len(columns)}개 찾았습니다. 기존 {len(old["classes"])}개 반과 다릅니다.')

    lectures = list(old['lectures'])
    by_title = {(l['course'], compact(l['title'])): l for l in lectures}
    known = {}
    for c in old['classes'].values():
        for e in c['entries']:
            known[(e['course'], e.get('sourceText'))] = e

    unknown = set()

    def classify(course, text):
        if (course, text) in known:
            e = known[(course, text)]
            return {k: e[k] for k in ('module', 'lectureId', 'title', 'online', 'kind')}
        raw = text.strip()
        if HOLIDAY.search(raw):
            return {'module': '휴일', 'lectureId': '', 'title': raw, 'online': False, 'kind': 'holiday'}
        online = raw.startswith('비대면/') or '(비대면)' in raw
        title = re.sub(r'^비대면/|\(비대면\)|\(고정\)|^>', '', raw).strip()
        lecture = by_title.get((course, compact(title)))
        if not lecture:
            unknown.add((course, raw))
            return None
        return {'module': lecture['module'], 'lectureId': lecture['id'], 'title': lecture['title'], 'online': online, 'kind': 'class'}

    classes = {cid: {'classId': cid, 'revision': 0, 'entries': []} for _, cid, _, _ in columns}
    counters = collections.Counter()
    last_date, dates = None, []
    for row in range(5, ws.max_row + 1):
        value = ws.cell(row, 2).value
        if isinstance(value, datetime.datetime):
            last_date = value.date().isoformat()
        elif value not in (None, ''):
            sys.exit(f'{row}행 날짜를 읽을 수 없습니다: {value!r}')
        for col, cid, course, hours_col in columns:
            text = ws.cell(row, col).value
            if not isinstance(text, str) or not text.strip():
                continue
            if not last_date:
                sys.exit(f'{row}행에 날짜가 없습니다.')
            info = classify(course, text)
            if not info:
                continue
            hours = ws.cell(row, hours_col).value
            day = 0
            if info['kind'] != 'holiday':
                counters[(cid, info['lectureId'])] += 1
                day = counters[(cid, info['lectureId'])]
            dates.append(last_date)
            classes[cid]['entries'].append({
                'id': f'xlsx-{cid}-{row}', 'date': last_date, 'course': course,
                'module': info['module'], 'lectureId': info['lectureId'], 'title': info['title'],
                'day': day, 'hours': hours if isinstance(hours, (int, float)) and info['kind'] != 'holiday' else 0,
                'start': '', 'end': '', 'instructorId': '', 'venue': '', 'online': info['online'],
                'note': '', 'kind': info['kind'], 'sourceRow': row, 'sourceText': text,
            })
    if unknown:
        sys.exit('강의 목록에 없는 과목이 있습니다. 강의 목록 또는 이 스크립트의 규칙을 먼저 정해 주세요:\n'
                 + '\n'.join(f'  {c} · {t!r}' for c, t in sorted(unknown)))

    # Operating decisions the workbook may not reflect yet; applying them again is harmless.
    for rule in json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else []:
        if rule['type'] != 'single-session':
            sys.exit(f"알 수 없는 조정 규칙입니다: {rule['type']}")
        for cid, c in classes.items():
            matches = [e for e in c['entries'] if e['kind'] != 'holiday' and compact(e['title']) == compact(rule['title'])]
            if not matches:
                continue
            first = matches[0]
            anchor = next((e for e in c['entries'] if e['date'] == rule['date'] and e['title'] == rule.get('after')), None)
            c['entries'] = [e for e in c['entries'] if e not in matches]
            c['entries'].append({**first, 'id': f"xlsx-{cid}-{anchor['sourceRow'] if anchor else first['sourceRow']}-{compact(rule['title'])}",
                                 'date': rule['date'], 'day': 1, 'online': False, 'note': rule.get('note', ''),
                                 'order': 999 if anchor else 0, 'sourceRow': anchor['sourceRow'] if anchor else first['sourceRow']})
            c['entries'].sort(key=lambda e: (e['date'], e.get('order', 0), e['sourceRow']))

    # Keep catalog day totals in step with the workbook (maximum across classes).
    totals = collections.defaultdict(int)
    for cid, c in classes.items():
        per = collections.Counter(e['lectureId'] for e in c['entries'] if e['kind'] != 'holiday')
        for lid, n in per.items():
            totals[lid] = max(totals[lid], n)
    for l in lectures:
        if totals.get(l['id']):
            l['days'] = totals[l['id']]

    source = args[args.index('--source') + 1] if '--source' in args else old['source']
    seed = {**old, 'version': version, 'source': source,
            'start': min(dates), 'end': max(dates), 'lectures': lectures,
            'classes': {cid: classes[cid] for cid in old['classes']}}

    # Per-class summary keyed like timetable-sync.mjs (lecture + day, holidays by date).
    def key(e):
        return f"h|{e['date']}|{e['title']}" if e['kind'] == 'holiday' else f"c|{e['lectureId']}|{e['day']}"
    fields = ('date', 'module', 'lectureId', 'title', 'day', 'hours', 'kind', 'online', 'note')
    total = 0
    for cid in old['classes']:
        before = {key(e): {'note': '', **e} for e in old['classes'][cid]['entries']}
        after = {key(e): e for e in seed['classes'][cid]['entries']}
        lines = [f"  + {after[k]['date']} {after[k]['title']}" for k in after.keys() - before.keys()]
        lines += [f"  - {before[k]['date']} {before[k]['title']}" for k in before.keys() - after.keys()]
        lines += [f"  ~ {after[k]['title']} {after[k]['day']}일차: " + ', '.join(f"{f} {before[k][f]}→{after[k][f]}" for f in fields if before[k][f] != after[k][f])
                  for k in after.keys() & before.keys() if any(before[k][f] != after[k][f] for f in fields)]
        if lines:
            total += len(lines)
            print(f'{cid}반 · {len(lines)}건'); print('\n'.join(sorted(lines)))
    if not total:
        print('기존 시간표 기준과 달라진 수업이 없습니다.')
        if '--force' not in args:
            return
    if '--check' in args:
        return
    if version == old['version']:
        sys.exit('버전이 기존과 같습니다. --version 으로 새 버전을 지정해 주세요.')
    # The previous version stays available as the merge base for drafts created from it.
    history = ROOT / 'timetable-seeds' / f"{old['version']}.json"
    history.parent.mkdir(exist_ok=True)
    if not history.exists():
        history.write_text(SEED.read_text())
    SEED.write_text(json.dumps(seed, ensure_ascii=False, separators=(',', ':')))
    print(f'{SEED.name} 갱신 · 버전 {version} · {sum(len(c["entries"]) for c in classes.values())}개 일정 · {seed["start"]} ~ {seed["end"]}')

if __name__ == '__main__':
    main()
