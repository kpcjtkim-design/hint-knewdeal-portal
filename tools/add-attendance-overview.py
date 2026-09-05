from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

if "data-tab=\"attendanceOverview\"" not in s:
    old='<button class="tab ${tab===\'attendance\'?\'active\':\'\'}" data-tab="attendance">출결 자동검증</button>'
    new=old+'<button class="tab ${tab===\'attendanceOverview\'?\'active\':\'\'}" data-tab="attendanceOverview">출석부 한눈에 보기</button>'
    if old not in s:
        raise SystemExit('attendance tab anchor not found')
    s=s.replace(old,new,1)

route="if(tab==='attendance')await attendanceAdmin(user,p);if(tab==='uploads')await uploadAdmin(user,p);"
if "if(tab==='attendanceOverview')await attendanceOverviewAdmin(user,p);" not in s:
    repl="if(tab==='attendance')await attendanceAdmin(user,p);if(tab==='attendanceOverview')await attendanceOverviewAdmin(user,p);if(tab==='uploads')await uploadAdmin(user,p);"
    if route not in s:
        raise SystemExit('attendance route anchor not found')
    s=s.replace(route,repl,1)

if 'async function attendanceOverviewAdmin(user,p)' not in s:
    anchor='async function urgentAdmin(user,p,selected=\'1\')'
    fn="""async function attendanceOverviewAdmin(user,p){
  const host=document.getElementById('adminBody');if(!host)return;
  host.innerHTML=`<section class=\"card attendance-native-shell\"><div class=\"attendance-native-head\"><h3>출석부 한눈에 보기</h3><p>수기출석부 Drive 미리보기 · 운영총괄 출결/가-3 사유 · 학생별 관리자 메모를 한 화면에서 확인합니다. Sheet와 Drive는 읽기 전용입니다.</p></div><div id=\"attendanceOverviewMount\" class=\"attendance-native-mount\"><div class=\"empty\">한눈에 보기 모듈을 불러오는 중…</div></div></section>`;
  try{const mod=await import(`/attendance-overview.js?v=20260906-1`);await mod.mountAttendanceOverview(document.getElementById('attendanceOverviewMount'),{auth,db,user,classes:CLASSES})}catch(e){const mount=document.getElementById('attendanceOverviewMount');if(mount)mount.innerHTML=`<div class=\"fatal\">출석부 한눈에 보기를 불러오지 못했습니다.<br>${esc(e.message||e)}</div>`}
}
"""
    if anchor not in s:
        raise SystemExit('urgent admin anchor not found')
    s=s.replace(anchor,fn+anchor,1)

p.write_text(s,encoding='utf-8')
print('attendance overview UI patched')
