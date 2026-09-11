function normReasonText(v){return String(v||'').replace(/\r/g,'\n').replace(/\n{2,}/g,'\n').trim()}
function cleanReason(v,status=''){
  let s=String(v||'').trim();
  s=s.replace(/^\s*(?:님)?\s*[-_:：=→>\/|,，]+\s*/,'').replace(/^\s*(?:사유|이유)\s*[-_:：=]?\s*/,'').trim();
  s=s.replace(/^(?:출석|결석|지각|조퇴|외출|인정출석|중복)\s*[-_:：]?\s*/,'').trim();
  if(status)s=s.replace(new RegExp('^'+status.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[-_:：]?\\s*'),'').trim();
  return s.replace(/^[-_:：=→>\/|,，\s]+|[-_:：=→>\/|,，\s]+$/g,'').trim();
}
export function reasonFor(name,text,roster,status=''){
  const src=normReasonText(text);if(!src||!name)return'';
  const lines=src.split('\n').map(x=>x.trim()).filter(Boolean),candidates=[];
  const otherNames=roster.filter(n=>n&&n!==name).sort((a,b)=>b.length-a.length);
  for(const line of lines){
    const p=line.indexOf(name);if(p<0)continue;
    let after=line.slice(p+name.length),cut=after.length;
    for(const n of otherNames){const i=after.indexOf(n);if(i>=0&&i<cut)cut=i}
    const direct=cleanReason(after.slice(0,cut),status);if(direct&&direct.length<=180)candidates.push({v:direct,s:7});
    const present=roster.filter(n=>n&&line.includes(n));
    if(present.length>=2){let lastEnd=-1;for(const n of present){const i=line.lastIndexOf(n);if(i>=0)lastEnd=Math.max(lastEnd,i+n.length)}if(lastEnd>=0){const shared=cleanReason(line.slice(lastEnd),status);if(shared&&shared.length<=180)candidates.push({v:shared,s:5})}}
  }
  try{
    const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp(safe+'\\s*(?:님)?\\s*[-_:：=→>\\/|]\\s*([^\\n]{1,180})','g');let m;
    while((m=rx.exec(src))){let raw=m[1];for(const n of otherNames){const i=raw.indexOf(n);if(i>=0)raw=raw.slice(0,i)}const v=cleanReason(raw,status);if(v)candidates.push({v,s:9})}
  }catch{}
  candidates.sort((a,b)=>b.s-a.s||a.v.length-b.v.length);return candidates[0]?.v||'';
}
