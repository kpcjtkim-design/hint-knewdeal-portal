from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')
old='.urgent-alert .urgent-text{white-space:pre-wrap;line-height:1.65;font-size:14px}'
new='.urgent-alert .urgent-text{white-space:pre-wrap;line-height:1.65;font-size:15px}'
if new in s:
    print('urgent notice font already 15px')
elif old in s:
    s=s.replace(old,new,1)
    p.write_text(s,encoding='utf-8')
    print('increased urgent notice font to 15px')
else:
    raise SystemExit('urgent notice font CSS anchor not found')
