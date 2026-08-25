from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')
anchor="function parseReasonFor(name,text,status=''){\n  const src=normalizeReasonText(text);if(!src)return{reason:'',confidence:'none',method:'none'};"
insert="function sharedReasonFor(name,text,status=''){\n  const src=normalizeReasonText(text);if(!src)return'';\n  const names=students.map(x=>x.name).filter(Boolean);\n  for(const lineRaw of src.split(/\\n+/)){\n    const line=lineRaw.trim();if(!line||!line.includes(name))continue;\n    const us=line.lastIndexOf('_');if(us<0)continue;\n    const left=line.slice(0,us).replace(/^(?:결석|지각|조퇴|외출|인정출석|인정결석|출석)\\s*\\d*\\s*[-:：]?\\s*/,'').trim();\n    const reason=cleanReason(line.slice(us+1),status);if(!reason)continue;\n    const group=left.split(/[，,]/).map(x=>x.trim().replace(/^[-_:]+|[-_:]+$/g,'')).filter(Boolean);\n    const matched=group.filter(g=>names.includes(g));\n    if(matched.length>=2&&matched.includes(name))return reason;\n  }\n  return'';\n}\nfunction parseReasonFor(name,text,status=''){\n  const src=normalizeReasonText(text);if(!src)return{reason:'',confidence:'none',method:'none'};\n  const shared=sharedReasonFor(name,src,status);if(shared)return{reason:shared,confidence:'high',method:'공동 사유'};"
if "method:'공동 사유'" not in s:
    if anchor not in s: raise SystemExit('anchor not found')
    s=s.replace(anchor,insert,1)
else:
    print('already patched')
    raise SystemExit(0)
p.write_text(s,encoding='utf-8')
print('patched shared reason groups')
