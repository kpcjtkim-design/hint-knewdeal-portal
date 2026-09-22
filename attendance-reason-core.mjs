const STATUS='인정출석|인정지각|인정조퇴|인정외출|인정결석|출석인정|무단결석|결석|지각|조퇴|외출|출석|중복';
const word=c=>!!c&&/[\p{L}\p{N}]/u.test(c);
const baseName=s=>s.replace(/\s*[（(]\s*\d{2,4}\s*년생\s*[)）]\s*$/,'').trim();
const connector=s=>/^[\s,，·ㆍ/&]*(?:(?:및|와|과|모두|공통)[\s,，·ㆍ/&]*)?$/.test(s);
function cleanReason(text){
 let s=String(text||'').trim().replace(/^[\s*•·\-_:：=→>\/|,，]+|[\s,，;；/|]+$/g,'');
 s=s.replace(/^(?:님\s*)?(?:사유|이유)\s*[:：_=-]?\s*/,'');
 s=s.replace(new RegExp(`[,，/|;；\\s]+[*•\\s]*(?:${STATUS})\\s*\\d*\\s*[-:：.(]?\\s*$`),'').trim();
 s=s.replace(new RegExp(`^\\(?(${STATUS})\\)?(?=\\s|[:：_(-]|\\d{1,2}[:시]|$)\\s*[:：_-]?\\s*`),'').trim();
 while(s.endsWith(')')&&[...s].filter(c=>c===')').length>[...s].filter(c=>c==='(').length)s=s.slice(0,-1).trim();
 if(s.startsWith('(')&&s.endsWith(')')){let depth=0,outer=true;for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(depth===0&&i<s.length-1)outer=false;}if(outer&&depth===0)s=s.slice(1,-1).trim();}
 return /^(해당없음|없음|사유없음|-)$/i.test(s)?'':s;
}
const cache=new Map();
export function parseAttendanceReasons(text,roster){
 const names=roster.map(n=>typeof n==='string'?n:n.name).filter(Boolean),raw=String(text??''),key=JSON.stringify([raw,names]);if(cache.has(key))return cache.get(key);
 const unique=[...new Set(names)].sort((a,b)=>b.length-a.length),byName=Object.fromEntries(unique.map(n=>[n,[]])),issues=[],counts=new Map(unique.map(n=>[n,names.filter(v=>v===n).length]));
 const add=(name,value,line,header='')=>{const reason=cleanReason(value),status=String(value).replace(/^[\s_:\-：]+/,'').match(new RegExp(`^\\(?(${STATUS})\\)?(?=\\s|[:：_(-]|$)`))?.[1]||header;if(!reason&&!status)return;if(counts.get(name)>1){issues.push({name,line,message:'동명이인 식별 필요'});return;}if(!byName[name].some(e=>e.reason===reason&&e.status===status))byName[name].push({reason,status,line,raw:value});};
 const aliases=new Map();for(const name of unique){const b=name.match(/^(.*?)\s*[（(]\s*(\d{2,4})\s*년생\s*[)）]\s*$/),values=[name];if(b)for(const year of new Set([b[2],b[2].slice(-2)]))for(const suffix of [`(${year}년생)`,`（${year}년생）`,`(${year})`,year,`${year}년생`])values.push(b[1].trim()+suffix);for(const alias of values){if(!aliases.has(alias))aliases.set(alias,new Set());aliases.get(alias).add(name);}}
 const tokens=[...aliases].sort((a,b)=>b[0].length-a[0].length),lines=raw.replace(/\r\n?/g,'\n').split('\n');let sectionStatus='';
 for(let li=0;li<lines.length;li++){
  const line=lines[li];if(!line.trim()){sectionStatus='';continue;}const hits=[];let lineStatus=sectionStatus;
  for(const [alias,targets]of tokens){let at=0;while((at=line.indexOf(alias,at))>=0){const end=at+alias.length,after=line.slice(end),left=at===0||!word(line[at-1]),right=end===line.length||!word(line[end])||/^(?:님|와|과)(?=\s|[,，·])/u.test(after)||new RegExp(`^(?:${STATUS}|병원|병가|병결|면접|예비군|개인일정|개인사정|\\d{1,2}:\\d{2})`).test(after),qualifier=/^\s*[（(]\s*\d{2,4}\s*년생\s*[)）]/.test(after);
   if(left&&right&&!qualifier&&!hits.some(h=>at<h.end&&end>h.start))hits.push({name:[...targets][0],names:[...targets],start:at,end,invalid:targets.size!==1});at=end;}}
  // Ambiguous names still bound the preceding student's reason; never absorb
  // unmatched names and their reasons into an earlier student's value.
  for(const name of unique){const base=baseName(name);let at=0;while((at=line.indexOf(base,at))>=0){const end=at+base.length;if(!hits.some(h=>at<h.end&&end>h.start))hits.push({name,names:unique.filter(n=>baseName(n)===base),start:at,end,invalid:true});at=end;}}
  hits.sort((a,b)=>a.start-b.start);
  for(const hit of hits)if(hit.invalid)for(const name of hit.names)issues.push({name,line:li+1,message:'학생명 경계 또는 동명이인 식별표기 확인 필요'});
  if(!hits.length){const heading=line.trim().replace(/^[*•\s]+/,'').match(new RegExp(`^(${STATUS})\\s*\\d*\\s*[-:：.(]?\\s*$`));if(heading)sectionStatus=heading[1];continue;}
  for(let i=0;i<hits.length;){
   if(hits[i].invalid){i++;continue;}let end=i;while(end+1<hits.length&&!hits[end+1].invalid&&connector(line.slice(hits[end].end,hits[end+1].start)))end++;
   const next=hits[end+1]?.start??line.length,segment=line.slice(hits[end].end,next);
   let value=segment;const prefix=line.slice(0,hits[i].start).trim();
   if(!cleanReason(value)&&i===0&&end===hits.length-1&&/[:：]\s*$/.test(prefix)&&!new RegExp(`^(?:[*•\\s]*)(${STATUS})\\s*\\d*[:：]$`).test(prefix))value=prefix.replace(/[:：]\s*$/,'');
   const header=line.slice(i?hits[i-1].end:0,hits[i].start).match(new RegExp(`(?:^|[,，;；/|*•\\s])(${STATUS})\\s*\\d*\\s*[-:：.(]?\\s*$`))?.[1]||lineStatus;lineStatus=header;
   for(let j=i;j<=end;j++){if(counts.get(hits[j].name)>1)issues.push({name:hits[j].name,line:li+1,message:'동명이인 식별 필요'});else add(hits[j].name,value,li+1,header);}
   i=end+1;
  }
 }
 const result={byName,issues:[...new Map(issues.map(v=>[JSON.stringify(v),v])).values()]};if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
export function reasonFor(name,text,roster,status=''){
 const parsed=parseAttendanceReasons(text,roster);if(parsed.issues.some(i=>i.name===name))return'';
 return [...new Set((parsed.byName[name]||[]).map(e=>e.reason).filter(Boolean))].join('; ');
}
