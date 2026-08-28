from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')
s=s.replace("let token='',email='',selectedClass='1',dates=[],students=[],reasonCells={},currentLabel='',editRows=[],dirty=false,currentReview=null;", "let token='',email='',selectedClass='1',dates=[],students=[],reasonCells={},attendanceBackgrounds=[],currentLabel='',editRows=[],dirty=false,currentReview=null;")
s=s.replace("getState:()=>({selectedClass,currentLabel,dates,students,reasonCells})", "getState:()=>({selectedClass,currentLabel,dates,students,reasonCells,attendanceBackgrounds})")
old="const out=await reader(selectedClass);const v=out.attendance||[],header=v[0]||[];dates=header.slice(4).map((x,i)=>({label:normalizeDate(x),idx:i})).filter(x=>x.label);students=v.slice(1).map(r=>({name:String(r[0]||'').trim(),all:r.slice(4)})).filter(x=>x.name);"
new="const out=await reader(selectedClass);const v=out.attendance||[],header=v[0]||[];attendanceBackgrounds=out.attendanceBackgrounds||out.backgrounds||[];dates=header.slice(4).map((x,i)=>({label:normalizeDate(x),idx:i})).filter(x=>x.label);students=v.slice(1).map((r,rowIndex)=>({name:String(r[0]||'').trim(),all:r.slice(4),rowIndex})).filter(x=>x.name);"
if old not in s: raise SystemExit('loadClass marker not found')
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
