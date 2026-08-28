from pathlib import Path
import re

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

# 1) 증빙 상태 용어 통일: 확인 / 보완필요 / 미제출
s=s.replace("'인정불가'","'보완필요'").replace('>인정불가<','>보완필요<').replace('인정불가 저장됨','보완필요 저장됨').replace('인정불가 사유','보완필요 사유')

# 2) 메인 Reader와 색상 Reader 분리. 메인 출결은 기존 빠른 Reader, 색은 검수 도구 로드시 별도 호출.
old="async function mountReviewTools(){const host=$('#adminReviewToolsHost'),user=auth.currentUser;if(!host||!user)return;await mountAdminReviewTools(host,{auth,db,user,getState:()=>({selectedClass,currentLabel,dates,students,reasonCells,attendanceBackgrounds}),parseReasonFor,standardizeReason,normalizeAttendanceStatus})}"
new="""async function loadAttendanceColors(){
  const user=auth.currentUser;if(!user||!selectedClass)return[];
  try{
    const idToken=await user.getIdToken();
    const r=await fetch('/api/attendance-colors',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken,classId:String(selectedClass)})});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}
    if(r.ok&&d.ok&&Array.isArray(d.attendanceBackgrounds))return d.attendanceBackgrounds;
  }catch(e){console.warn('attendance colors failed',e)}
  return[];
}
async function mountReviewTools(){const host=$('#adminReviewToolsHost'),user=auth.currentUser;if(!host||!user)return;if(!attendanceBackgrounds.length)attendanceBackgrounds=await loadAttendanceColors();await mountAdminReviewTools(host,{auth,db,user,getState:()=>({selectedClass,currentLabel,dates,students,reasonCells,attendanceBackgrounds}),parseReasonFor,standardizeReason,normalizeAttendanceStatus})}"""
if old not in s: raise SystemExit('mountReviewTools anchor not found')
s=s.replace(old,new)

# 3) 사유 파서 강화
pat=re.compile(r"function parseReasonFor\(name,text,status=''\)\{.*?\n\}\nconst REASON_RULES=",re.S)
replacement=r'''function parseReasonFor(name,text,status=''){
  const src=normalizeReasonText(text);if(!src)return{reason:'',confidence:'none',method:'none'};
  const shared=sharedReasonFor(name,src,status);if(shared)return{reason:standardizeReason(shared),rawReason:shared,confidence:'high',method:'공동 사유'};
  const roster=students.map(x=>x.name).filter(Boolean),positions=allNamePositions(src),mine=positions.filter(x=>x.name===name),candidates=[];
  const push=(raw,score,method)=>{const reason=cleanReason(raw,status);if(reason&&reason!==name)candidates.push({reason,score,method})};
  for(const hit of mine){
    const lineStart=Math.max(0,src.lastIndexOf('\n',hit.start-1)+1),lineEnd0=src.indexOf('\n',hit.end),lineEnd=lineEnd0<0?src.length:lineEnd0,line=src.slice(lineStart,lineEnd);
    const local=hit.start-lineStart,after=line.slice(local+name.length);
    const others=roster.filter(n=>n!==name).map(n=>({n,i:after.indexOf(n)})).filter(x=>x.i>=0).sort((a,b)=>a.i-b.i);
    let direct=others.length?after.slice(0,others[0].i):after;
    direct=direct.replace(/^\s*(?:님)?\s*[-_:：=→>\/|,，]+\s*/,'').replace(/^\s*(?:사유|이유)\s*[-_:：=]?\s*/,'');
    push(direct, /^\s*(?:님)?\s*[-_:：=→>\/|]/.test(after)?6:5, '이름 뒤 직접 추출');

    const lineNames=positions.filter(x=>x.start>=lineStart&&x.start<lineEnd);
    if(lineNames.length>=2&&lineNames.some(x=>x.name===name)){
      const last=lineNames[lineNames.length-1];
      const suffix=src.slice(last.end,lineEnd).replace(/^\s*[-_:：=→>\/|,，]+\s*/,'');
      push(suffix,5,'동일 줄 공동 사유');
    }

    const before=line.slice(0,local).replace(/^(?:결석|지각|조퇴|외출|인정출석|인정결석|출석|중복)\s*\d*\s*[-:：]?\s*/,'');
    const prevName=[...lineNames].filter(x=>x.end<=hit.start).at(-1);
    const safeBefore=prevName?src.slice(prevName.end,hit.start):before;
    push(safeBefore,2,'이름 앞 문맥');

    const next=positions.find(x=>x.start>=hit.end&&x.name!==name);
    if(next){
      let between=src.slice(hit.end,next.start).replace(/^\s*[-_:：=→>\/|,，]+\s*/,'');
      push(between,4,'다음 이름 전 추출');
    }
  }

  try{
    const safe=escapeRe(name),rx=new RegExp(`${safe}\\s*(?:님)?\\s*[-_:：=→>\\/|]\\s*([^\\n]{1,90})`,'g');let m;
    while((m=rx.exec(src))){let raw=m[1];for(const n of roster){if(n===name)continue;const i=raw.indexOf(n);if(i>=0)raw=raw.slice(0,i)}push(raw,7,'명시 구분자 추출')}
  }catch{}

  if(!candidates.length)return{reason:'',confidence:'none',method:'미매칭'};
  const bad=/^(?:명|명\s*[-:：]|사유|이유|인정|출석|결석|지각|조퇴|외출|중복)$/;
  const filtered=candidates.filter(x=>!bad.test(x.reason));
  if(!filtered.length)return{reason:'',confidence:'none',method:'미매칭'};
  filtered.sort((a,b)=>b.score-a.score||a.reason.length-b.reason.length);
  const best=filtered[0],second=filtered[1];
  const confidence=best.score>=5&&(!second||best.score>second.score||best.reason===second.reason)?'high':'medium';
  return{reason:standardizeReason(best.reason),rawReason:best.reason,confidence,method:best.method};
}
const REASON_RULES='''
s2,n=pat.subn(lambda m: replacement,s,count=1)
if n!=1: raise SystemExit(f'parseReasonFor replace failed: {n}')
s=s2
p.write_text(s,encoding='utf-8')
print('patched attendance-test.html')
