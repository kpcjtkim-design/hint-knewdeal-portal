from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old="function heroAdmin(){return `<section class=\"card hero\"><p class=\"eyebrow\">OPERATIONS</p><h2>운영총괄 관리자</h2><div class=\"chips\"><span class=\"chip\">1~17반 전체 조회</span><span class=\"chip\">운영자 권한 관리</span></div></section>`}"
new="function heroAdmin(){return `<section class=\"card hero\"><p class=\"eyebrow\">OPERATIONS</p><h2>운영총괄 관리자</h2><div class=\"chips\"><span class=\"chip\">1~17반 전체 조회</span><span class=\"chip\">운영자 권한 관리</span></div><div style=\"margin-top:16px\"><a class=\"btn btn-primary\" href=\"/attendance-test.html\" style=\"text-decoration:none\">출결 자동검증 바로가기</a></div></section>`}"
if old in s:
    s=s.replace(old,new,1)
elif '출결 자동검증 바로가기' not in s:
    raise SystemExit('heroAdmin anchor not found')
p.write_text(s,encoding='utf-8')
print('patched admin attendance entry')
