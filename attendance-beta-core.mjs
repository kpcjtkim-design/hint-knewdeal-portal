export const ATTENDANCE_OPTIONS=['해당없음','출석','결석','지각','조퇴','외출','중복','인정출석','인정지각','인정조퇴','인정외출'];
export const EVIDENCE_OPTIONS=['미해당','미제출','반려','확인'];
export const EVIDENCE_COLORS={미해당:'#ffffff',미제출:'#ff0000',반려:'#ff0000',확인:'#ffff00'};
export const recognized=s=>['인정출석','인정지각','인정조퇴','인정외출'].includes(s);
export const sheetStatus=s=>{if(!ATTENDANCE_OPTIONS.includes(s))throw Error('지원하지 않는 출결 상태입니다.');return recognized(s)?'인정출석':s;};
export const emptyStatus=s=>!String(s||'').trim()||['해당없음','미입력','-'].includes(String(s).trim());
export const koreaToday=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function latestTeachingDate(dates,today=koreaToday()){
  const sorted=[...dates].filter(x=>x.iso).sort((a,b)=>a.iso.localeCompare(b.iso));
  return sorted.filter(x=>x.iso<=today).at(-1)||sorted[0]||null;
}
export function portalStatus(raw,meta){return meta?.sheetStatus===raw&&ATTENDANCE_OPTIONS.includes(meta.portalStatus)&&sheetStatus(meta.portalStatus)===raw?meta.portalStatus:raw||'해당없음';}
export function evidenceStatus(rawColor,rawStatus,meta,colorState){
  if(meta?.sheetColor?.toLowerCase()===String(rawColor).toLowerCase()&&EVIDENCE_OPTIONS.includes(meta.evidenceStatus))return meta.evidenceStatus;
  const kind=colorState(rawColor);if(kind==='확인')return'확인';if(kind==='보완필요')return'반려';return recognized(rawStatus)?'미제출':'미해당';
}
export function columnName(n){if(!Number.isInteger(n)||n<1)throw Error('잘못된 열 번호입니다.');let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
export const quoteSheet=s=>"'"+String(s).replace(/'/g,"''")+"'";
export function isoLabel(v){const s=String(v||'').trim();if(/^2026-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/(?:^|\D)(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\D|$)/);return m?`2026-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:'';}
export function resolveSheetTarget({attendance,reasons,title,sheetId},student,date){
  if(!/^2026-\d{2}-\d{2}$/.test(date)||date<'2026-07-27'||date>'2026-10-22')throw Error('교육일자를 확인해 주세요.');
  const dates=(attendance[0]||[]).map((x,i)=>({iso:isoLabel(x),i})).filter(x=>x.i>=4&&x.iso===date);
  const matches=attendance.slice(1).map((r,i)=>({name:String(r[0]||'').trim(),i})).filter(x=>x.name===student);
  const reasonDates=(reasons[0]||[]).map((x,i)=>({iso:isoLabel(x),i})).filter(x=>x.i>=4&&x.iso===date);
  if(dates.length!==1||matches.length!==1||reasonDates.length!==1)throw Error('학생·교육일자 셀을 하나로 확인하지 못했습니다. 시트의 중복 이름과 날짜를 확인해 주세요.');
  const col=13+dates[0].i,row=19+matches[0].i,reasonCol=13+reasonDates[0].i;
  if(row>48)throw Error('허용된 출결 명단 범위를 벗어났습니다.');
  return {sheetId,title,row,col,reasonRow:51,reasonCol,statusA1:`${quoteSheet(title)}!${columnName(col)}${row}`,reasonA1:`${quoteSheet(title)}!${columnName(reasonCol)}51`,nameA1:`${quoteSheet(title)}!M${row}`,dateA1:`${quoteSheet(title)}!${columnName(col)}18`,reasonDateA1:`${quoteSheet(title)}!${columnName(reasonCol)}50`};
}

// Edit only unambiguous student entries. Unknown layouts stop rather than
// rebuilding the entire day from parser guesses.
export function rewriteReasons(raw,changes,roster){
  const names=roster.map(x=>String(x).trim()).filter(Boolean),targets=new Map();
  for(const [name,value] of Object.entries(changes)){
    if(names.filter(n=>n===name).length!==1)throw Error(`${name}: 동명이인 또는 명단 확인이 필요합니다.`);
    if(typeof value!=='string'||value.length>500||/[\r\n]/.test(value))throw Error('사유는 한 줄, 500자 이내로 입력해 주세요.');
    targets.set(name,value.trim());
  }
  const unique=[...new Set(names)].sort((a,b)=>b.length-a.length);
  const hits=line=>{const result=[];for(const name of unique){let at=0;while((at=line.indexOf(name,at))>=0){if(!result.some(x=>at<x.end&&at+name.length>x.start))result.push({name,start:at,end:at+name.length});at+=name.length;}}return result.sort((a,b)=>a.start-b.start);};
  const lines=String(raw||'').split(/\r?\n/),seen=new Map();
  for(const line of lines)for(const h of hits(line))if(targets.has(h.name))seen.set(h.name,(seen.get(h.name)||0)+1);
  for(const [name,n] of seen)if(n>1)throw Error(`${name}: 가-3에 이름이 여러 번 있어 자동 수정할 수 없습니다. 원문을 확인해 주세요.`);
  const result=[];
  for(const line of lines){
    const h=hits(line);if(!h.some(x=>targets.has(x.name))){result.push(line);continue;}
    if(line.slice(0,h[0].start).trim()&&!/^[\s*•·\d.)\-]*(?:출석|결석|지각|조퇴|외출|인정출석|인정지각|인정조퇴|인정외출)?\s*[:：_\-]?\s*$/.test(line.slice(0,h[0].start)))throw Error('가-3 이름 앞 문맥이 불명확합니다. 원문을 확인해 주세요.');
    if(h.length===1){const name=h[0].name,v=targets.get(name);if(v)result.push(`${name}: ${v}`);continue;}
    const shared=h.slice(0,-1).every((x,i)=>/^[\s,，/·&와과및]+$/.test(line.slice(x.end,h[i+1].start)));
    if(shared){
      const tail=line.slice(h.at(-1).end);if(!/^\s*(?:님)?\s*[:：_\-]/.test(tail))throw Error('공통 사유의 구분 기호가 불명확합니다. 가-3 원문을 확인해 주세요.');
      for(const x of h){const value=targets.has(x.name)?targets.get(x.name):tail.replace(/^\s*(?:님)?\s*[:：_\-]+\s*/,'');if(value)result.push(`${x.name}: ${value}`);}
    }else{
      for(let i=0;i<h.length;i++){const x=h[i],segment=line.slice(x.start,h[i+1]?.start??line.length);if(!/^\s*(?:님)?\s*[:：_\-]/.test(segment.slice(x.name.length)))throw Error('한 줄에 여러 학생의 사유가 섞여 자동 수정할 수 없습니다. 원문을 확인해 주세요.');if(targets.has(x.name)){const value=targets.get(x.name);if(value)result.push(`${x.name}: ${value}`);}else result.push(segment.trim());}
    }
  }
  for(const [name,value] of targets)if(!seen.has(name)&&value)result.push(`${name}: ${value}`);
  return result.join('\n');
}
export function latestSnapshots(records,classId,date){
  const byId=new Map();for(const r of records){if(String(r.classId)!==String(classId)||r.date!==date||!r.id)continue;const prev=byId.get(r.id);if(!prev||String(r.collectedAt||'')>String(prev.collectedAt||''))byId.set(r.id,r);}return [...byId.values()];
}
export function matchSnapshot(student,students,records){
  if(students.filter(x=>x.name===student.name).length!==1)return {error:'동명이인 · 연결 확인 필요'};
  const found=records.filter(x=>x.name.trim()===student.name.trim());return found.length===1?{record:found[0]}:{error:found.length?'동명이인 · 연결 확인 필요':'저장본 없음'};
}
export function collectionDates(from,to){
  const today=koreaToday();if(from<'2026-08-27'||to>today||to>'2026-10-22'||from>to)throw Error('수집 기간은 8/27부터 오늘 또는 교육 종료일까지입니다.');
  if(![from,to].every(x=>/^2026-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x))throw Error('날짜 형식을 확인해 주세요.');
  const days=[];for(let d=new Date(from+'T00:00:00Z');d<=new Date(to+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){if(![0,6].includes(d.getUTCDay()))days.push(d.toISOString().slice(0,10));}return days;
}
