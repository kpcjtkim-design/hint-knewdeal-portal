from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
old = "['4','운영모니터링','학생 인터뷰 등 운영일지',core.monitoring,'폴더 열기']"
new = "['4','운영모니터링','학생 인터뷰 등 운영일지',core.monitoring,'설문 바로가기']"
if old not in s:
    raise SystemExit('monitoring task button anchor not found')
s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
print('renamed monitoring button to survey shortcut')
