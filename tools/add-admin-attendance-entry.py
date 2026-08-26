from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
# The attendance review now lives inside the admin tab. Remove any legacy hero link.
old='<div style="margin-top:16px"><a class="btn btn-primary" href="/attendance-test.html" style="text-decoration:none">출결 자동검증 바로가기</a></div>'
s=s.replace(old,'')
p.write_text(s,encoding='utf-8')
print('kept attendance review inside admin layout')
