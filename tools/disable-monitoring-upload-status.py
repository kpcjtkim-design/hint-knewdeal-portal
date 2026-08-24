from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = "const monitoredTask=n=>['2','3','4','5'].includes(String(n));"
new = "const monitoredTask=n=>['2','3','5'].includes(String(n));"
if old not in s:
    raise SystemExit('monitoredTask pattern not found')
s = s.replace(old, new, 1)

old_cols = "const cols=[['manualAttendance','수기출석본'],['photos','교육사진'],['monitoring','운영모니터링'],['recognition','출결인정자료']];"
new_cols = "const cols=[['manualAttendance','수기출석본'],['photos','교육사진'],['recognition','출결인정자료']];"
if old_cols not in s:
    raise SystemExit('uploadAdmin columns pattern not found')
s = s.replace(old_cols, new_cols, 1)

p.write_text(s, encoding='utf-8')
print('Removed monitoring from upload-status checks.')
