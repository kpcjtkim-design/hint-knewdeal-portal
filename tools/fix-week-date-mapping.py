from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')

# Add deterministic WEEK mapping based on Monday 2026-07-27 = WEEK 1.
anchor="function courseDatesThrough(endKey=localDateKey()){const end=endKey<COURSE_END?endKey:COURSE_END,out=[];let d=new Date(COURSE_START+'T00:00:00Z');const stop=new Date(end+'T00:00:00Z');while(d<=stop){const key=d.toISOString().slice(0,10),day=d.getUTCDay();if(day!==0&&day!==6&&!COURSE_HOLIDAYS.has(key))out.push(key);d.setUTCDate(d.getUTCDate()+1)}return out}"
addition=anchor+"\nfunction courseWeekNo(key){const start=new Date(COURSE_START+'T00:00:00Z'),d=new Date(String(key)+'T00:00:00Z');return Math.floor((d-start)/604800000)+1}\nfunction courseWeekSchedule(){const groups=new Map();for(const key of courseDatesThrough(COURSE_END)){const w=courseWeekNo(key);if(!groups.has(w))groups.set(w,[]);groups.get(w).push(key)}return [...groups.entries()].map(([week,dates])=>({week,dates}))}"
if 'function courseWeekNo(key)' not in s:
    if anchor not in s: raise SystemExit('courseDatesThrough anchor not found')
    s=s.replace(anchor,addition,1)

# Add WEEK schedule styling.
css_anchor='.upload-detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}'
css_add=css_anchor+'.week-schedule{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.week-chip{padding:9px 11px;border:1px solid #dbe3ee;border-radius:11px;background:#fff;font-size:11px;color:#475569}.week-chip strong{display:block;color:#0f172a;font-size:12px;margin-bottom:4px}'
if '.week-schedule{' not in s:
    if css_anchor not in s: raise SystemExit('upload detail css anchor not found')
    s=s.replace(css_anchor,css_add,1)

# Add all-course WEEK schedule to admin detail.
old='<div id="uploadDetailSummary" class="status-summary" style="margin-top:14px"><span class="status-pill status-none">확인 준비</span></div><div id="uploadDetailBody" class="upload-detail-grid">'
new='<div id="uploadDetailSummary" class="status-summary" style="margin-top:14px"><span class="status-pill status-none">확인 준비</span></div><div id="uploadWeekSchedule" class="week-schedule"></div><div id="uploadDetailBody" class="upload-detail-grid">'
if 'id="uploadWeekSchedule"' not in s:
    if old not in s: raise SystemExit('upload detail summary anchor not found')
    s=s.replace(old,new,1)

old2="const dates=courseDatesThrough(localDateKey()),body=host.querySelector('#uploadDetailBody'),summary=host.querySelector('#uploadDetailSummary');"
new2="const dates=courseDatesThrough(localDateKey()),body=host.querySelector('#uploadDetailBody'),summary=host.querySelector('#uploadDetailSummary'),weekHost=host.querySelector('#uploadWeekSchedule');if(weekHost)weekHost.innerHTML=courseWeekSchedule().map(g=>`<div class=\"week-chip\"><strong>WEEK ${g.week}</strong>${g.dates.map(prettyDate).join(' · ')}</div>`).join('');"
if old2 in s:
    s=s.replace(old2,new2,1)
elif 'weekHost=host.querySelector' not in s:
    raise SystemExit('upload dates anchor not found')

# Put WEEK number on every date card.
for cls,label in [('err','확인 오류'),('done','● 완료'),('none','폴더 없음'),('missing','● 미업로드')]:
    old=f'<div class=\\"upload-day {cls}\\"><strong>${{prettyDate(r.date)}}</strong><span class=\\"day-state\\">{label}</span></div>'
    new=f'<div class=\\"upload-day {cls}\\"><strong>WEEK ${{courseWeekNo(r.date)}} · ${{prettyDate(r.date)}}</strong><span class=\\"day-state\\">{label}</span></div>'
    s=s.replace(old,new)

p.write_text(s,encoding='utf-8')
print('fixed deterministic WEEK/date mapping through course end')
