// Read-only diagnostics for the CheckHere collector.
// The report keeps only endpoint shapes, key paths, counts and timings:
// no student names, phone numbers, memo text or attendance times are written.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeKey=k=>typeof k==='number'?'[]':/^[A-Za-z_$][\w$-]{0,48}$/.test(k)?k:/^\d+$/.test(k)?'{n}':'{key}';
export function urlTemplate(raw){
  let u;try{u=new URL(raw);}catch{return '{invalid-url}';}
  const path=u.pathname.split('/').map(s=>{
    const d=decodeURIComponent(s);
    if(!d)return d;if(UUID.test(d))return '{uuid}';if(/^\d{4}-\d{2}-\d{2}$/.test(d))return '{date}';
    if(/^\d+$/.test(d))return '{n}';if(/^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/.test(d))return '{id}';
    return /^[\w.()@%-]{1,60}$/.test(d)?d:'{segment}';
  }).join('/');
  const keys=[...new Set(u.searchParams.keys())].sort();
  return u.host+path+(keys.length?'?'+keys.map(k=>`${safeKey(k)}=…`).join('&'):'');
}
export function flatten(value,segs=[],out=[]){
  if(Array.isArray(value))value.forEach((v,i)=>flatten(v,[...segs,i],out));
  else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))flatten(v,[...segs,k],out);
  else out.push({segs,value});
  return out;
}
export const reportPath=segs=>'$'+segs.map(s=>typeof s==='number'?'[]':'.'+safeKey(s)).join('');
const kst=d=>d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour12:false});
// Every HH:MM:SS reading a JSON primitive can stand for (local string, ISO with zone, epoch).
export function timeReadings(v){
  const out=new Set();
  if(typeof v==='number'){if(v>1e12&&v<4e12)out.add(kst(new Date(v)));else if(v>1e9&&v<4e9)out.add(kst(new Date(v*1000)));}
  else if(typeof v==='string'){
    const m=/(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);if(m)out.add(`${m[1]}:${m[2]}:${m[3]||'00'}`);
    if(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/.test(v)){const d=new Date(v);if(!Number.isNaN(d.getTime()))out.add(kst(d));}
  }
  return [...out];
}
function hintOf(v){
  if(v===null)return 'null';
  if(typeof v==='number')return v>1e12&&v<4e12?'epoch-ms':v>1e9&&v<4e9?'epoch-s':'number';
  if(typeof v!=='string')return typeof v;
  if(!v.trim())return 'empty';if(UUID.test(v))return 'uuid';
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v))return 'iso-datetime';
  if(/^\d{4}-\d{2}-\d{2}$/.test(v))return 'date';if(/^\d{2}:\d{2}(:\d{2})?$/.test(v))return 'time';
  if(/^[\d-]{9,}$/.test(v))return 'digits';return 'text';
}
export function schemaOf(bodies,limit=400){
  const map=new Map();
  for(const b of bodies)for(const {segs,value} of flatten(b.json)){
    const key=b.url+' :: '+reportPath(segs);let s=map.get(key);if(!s)map.set(key,s={path:key,count:0,hints:new Set()});
    s.count++;s.hints.add(hintOf(value));
  }
  return [...map.values()].slice(0,limit).map(s=>({path:s.path,count:s.count,hints:[...s.hints]}));
}
const startsWith=(segs,root)=>root.length<=segs.length&&root.every((s,i)=>segs[i]===s);
// The object owning a student's name: the nearest array element above the name key.
function rootOf(segs){for(let i=segs.length-2;i>=0;i--)if(typeof segs[i]==='number')return segs.slice(0,i+1);return segs.slice(0,-1);}
const FIELDS=[
  ['rawEntry','time',r=>[r.rawEntry]],['entry','time',r=>[r.entry]],['exit','time',r=>[r.exit]],
  ['entryMemo','text',r=>[r.entryMemo]],['exitMemo','text',r=>[r.exitMemo]],
  ['outingStart','time',r=>(r.outings||[]).map(o=>o.start)],['outingEnd','time',r=>(r.outings||[]).map(o=>o.end)],
  ['outingCutoff','time',r=>(r.outings||[]).map(o=>o.cutoff)],
];
export function matchRecords(records,bodies){
  const flat=bodies.map(b=>({url:b.url,entries:flatten(b.json)}));
  const stats=Object.fromEntries(FIELDS.map(([f])=>[f,{compared:0,found:0,minuteOnly:0,paths:{}}]));let studentsFound=0;
  for(const r of records){
    const name=String(r.name||'').trim();
    const scopes=flat.map(b=>({url:b.url,entries:b.entries,roots:name?b.entries.filter(e=>typeof e.value==='string'&&e.value.trim()===name).map(e=>rootOf(e.segs)):[]}));
    if(scopes.some(s=>s.roots.length))studentsFound++;
    for(const [field,kind,get] of FIELDS){
      for(const wanted of get(r)){
        if(wanted===null||wanted===undefined||String(wanted).trim()==='')continue;
        const st=stats[field];st.compared++;const exact=new Set(),minute=new Set();
        const test=(e,b,prefix='')=>{
          if(kind==='text'){if(typeof e.value==='string'&&e.value.trim()===String(wanted).trim())exact.add(prefix+b.url+' :: '+reportPath(e.segs));return;}
          const readings=timeReadings(e.value);
          if(readings.includes(wanted))exact.add(prefix+b.url+' :: '+reportPath(e.segs));
          else if(readings.some(t=>t.slice(0,5)===String(wanted).slice(0,5)))minute.add(prefix+b.url+' :: '+reportPath(e.segs));
        };
        for(const s of scopes)for(const root of s.roots)for(const e of s.entries)if(startsWith(e.segs,root))test(e,s);
        // Memos may live outside the student object (e.g. a separate memo list).
        if(!exact.size&&kind==='text')for(const s of scopes)for(const e of s.entries)test(e,s,'global ');
        if(exact.size)st.found++;else if(minute.size)st.minuteOnly++;
        for(const p of exact.size?exact:minute)st.paths[p]=(st.paths[p]||0)+1;
      }
    }
  }
  for(const st of Object.values(stats))st.paths=Object.fromEntries(Object.entries(st.paths).sort((a,b)=>b[1]-a[1]).slice(0,6));
  return {students:records.length,studentsFound,fields:stats};
}
const status=(fields,names)=>{
  const c=names.reduce((a,n)=>a+fields[n].compared,0),f=names.reduce((a,n)=>a+fields[n].found,0);
  return {compared:c,found:f,status:!c?'unknown':f===c?'yes':f?'partial':'no'};
};
export function verdict(match){
  const f=match.fields;
  return {times:status(f,['rawEntry','entry','exit']),memos:status(f,['entryMemo','exitMemo']),outings:status(f,['outingStart','outingEnd','outingCutoff'])};
}
export function networkSummary(net){
  const out={};
  for(const n of net){
    const p=out[n.phase]??={requests:0,bytes:0,endpoints:{}};p.requests++;p.bytes+=n.bytes||0;
    const k=`${n.method} ${n.url} → ${n.status}`;p.endpoints[k]=(p.endpoints[k]||0)+1;
  }
  return out;
}
const LABEL={yes:'포함됨',partial:'일부만 포함',no:'없음',unknown:'이 날짜엔 비교할 값 없음'};
export function summarize(report){
  const t=report.timings,v=report.verdict,sec=ms=>ms==null?'-':(ms/1000).toFixed(1)+'초';
  const lines=[
    '',`[체크히어 데이터 진단] ${report.classId}반 · ${report.date} · 학생 ${report.students}명`,
    `- 새 방식(화면 로딩 때 받은 데이터만): 표가 보일 때까지 ${sec(t.tableVisible)}`,
    `- 기존 방식: 표 열기 ${sec(t.openDay)} + 학생별 수정창 ${sec(t.modals)} (학생당 평균 ${sec(t.perStudentModal)})`,
    `- 화면 로딩 때 받은 데이터 응답: ${report.network.load?.requests||0}건`,
    `- 데이터 안에 있는지: 입퇴실 시간 ${LABEL[v.times.status]}(${v.times.found}/${v.times.compared}) · 관리자 메모 ${LABEL[v.memos.status]}(${v.memos.found}/${v.memos.compared}) · 외출 구간 ${LABEL[v.outings.status]}(${v.outings.found}/${v.outings.compared})`,
  ];
  const ok=v.times.status==='yes'&&['yes','unknown'].includes(v.memos.status)&&['yes','unknown'].includes(v.outings.status);
  lines.push(ok?'=> 수정창을 열지 않고 수집할 수 있을 가능성이 큽니다.':'=> 일부 항목은 아직 수정창이나 추가 요청이 필요합니다.');
  if(v.memos.status==='unknown'||v.outings.status==='unknown')lines.push('   (메모나 외출이 있는 날짜로 한 번 더 진단하면 확실해집니다.)');
  return lines.join('\n');
}

// Evidence for reading a day without editors: which keys hold the roster
// identity and which event kinds hold each time/memo. Only enum-like tokens
// (e.g. ENTER, 0) are kept; names, phones, times and memo text never are.
const token=v=>typeof v==='number'&&Number.isInteger(v)&&Math.abs(v)<1000?String(v):typeof v==='boolean'?String(v):typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,30}$/.test(v)?v:v==null?'null':'{text}';
export function mappingEvidence(records,bodies,{studentKey}){
  const bump=(o,k)=>{o[k]=(o[k]||0)+1;};
  const out={students:0,nameKeys:{},phoneKeys:{},eventCounts:{},eventShapes:{},fields:{}};
  for(const b of bodies){
    const entries=flatten(b.json);
    for(const r of records){
      const nameHits=entries.filter(e=>typeof e.value==='string'&&e.value.trim()===String(r.name||'').trim());
      if(!nameHits.length)continue;
      const root=rootOf(nameHits[0].segs),inside=entries.filter(e=>startsWith(e.segs,root));
      out.students++;
      for(const e of nameHits)if(startsWith(e.segs,root))bump(out.nameKeys,b.url+' :: '+reportPath(e.segs.slice(root.length)));
      for(const e of inside){
        const digits=String(e.value??'').replace(/\D/g,'');
        if(digits.length>=9&&nameHits.some(n=>studentKey(n.value,digits)===r.studentKey))bump(out.phoneKeys,b.url+' :: '+reportPath(e.segs.slice(root.length)));
      }
      // Events: objects inside an array under the student; describe them by enum fields.
      const events=new Map();
      for(const e of inside){
        const rel=e.segs.slice(root.length),i=rel.findIndex((s,k)=>typeof s==='number'&&k>0);if(i<0)continue;
        const key=JSON.stringify(rel.slice(0,i+1));if(!events.has(key))events.set(key,{list:reportPath(rel.slice(0,i+1)),fields:{}});
        if(rel.length===i+2)events.get(key).fields[rel[i+1]]=e.value;
      }
      const evs=[...events.values()];
      const byList={};for(const ev of evs)(byList[ev.list]??=[]).push(ev);
      for(const [list,items] of Object.entries(byList)){
        bump(out.eventCounts,`${b.url} :: ${list} × ${items.length}`);
        bump(out.eventShapes,`${b.url} :: ${list} = `+items.map(ev=>['type','timeIndex','status','isRecognized'].filter(k=>k in ev.fields).map(k=>`${k}:${token(ev.fields[k])}`).join(',')).join(' | '));
      }
      const wants=[['rawEntry',r.rawEntry],['entry',r.entry],['exit',r.exit],['entryMemo',r.entryMemo],['exitMemo',r.exitMemo]];
      for(const [field,value] of wants){
        if(value==null||String(value).trim()==='')continue;
        for(const ev of evs){
          for(const [k,v] of Object.entries(ev.fields)){
            const hit=field.endsWith('Memo')?typeof v==='string'&&v.trim()===String(value).trim():timeReadings(v).includes(value);
            if(hit)bump(out.fields[field]??={},`${b.url} :: ${ev.list}.${safeKey(k)} @ `+['type','timeIndex','status'].filter(x=>x in ev.fields).map(x=>`${x}:${token(ev.fields[x])}`).join(','));
          }
        }
      }
    }
  }
  return out;
}
