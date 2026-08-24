from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
old = "const driveFolderId=u=>{const m=String(u||'').match(/\\/folders\\/([A-Za-z0-9_-]+)/);return m?m[1]:''};"
new = "const driveFolderId=u=>{const s=String(u||'');const m=s.match(/\\/folders\\/([A-Za-z0-9_-]+)/);if(m)return m[1];try{const x=new URL(s);return x.searchParams.get('id')||''}catch{return''}};"
if old in s:
    s = s.replace(old, new)
elif new not in s:
    raise SystemExit('driveFolderId pattern not found')
p.write_text(s, encoding='utf-8')
print('Drive folder URL parser supports both /folders/ID and open?id=ID')
