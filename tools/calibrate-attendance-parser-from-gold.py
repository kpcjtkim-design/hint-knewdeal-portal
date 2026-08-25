from pathlib import Path

p=Path('attendance-test.html')
s=p.read_text(encoding='utf-8')

if 'GOLD_CALIBRATED_V4' in s:
    print('gold calibrated parser already applied')
    raise SystemExit(0)

start=s.find('function allNamePositions(text){')
end=s.find('function lev(a,b){', start)
if start < 0 or end < 0:
    raise SystemExit('parser boundaries not found')

new_parser=r'''// GOLD_CALIBRATED_V4
function studentAliases(name){
  const out=[String(name||'')];
  const m=String(name||'').match(/^(.+?)\((\d{2})년생\)$/);
  if(m){out.push(m[1]+m[2]);out.push(m[1]+' '+m[2]);}
  return [...new Set(out.filter(Boolean))].sort((a,b)=>b.length-a.length);
}
function allNamePositions(text){
  const out=[];
  for(const st of students){
    if(!st.name)continue;
    for(const alias of studentAliases(st.name)){
      let at=0;
      while((at=text.indexOf(alias,at))!==-1){out.push({name:st.name,alias,start:at,end:at+alias.length});at+=alias.length;}
    }
  }
  const seen=new Set();
  return out.sort((a,b)=>a.start-b.start||(b.end-b.start)-(a.end-a.start)).filter(x=>{const k=x.name+'|'+x.start; if(seen.has(k))return false;seen.add(k);return true});
}
const GOLD_REASON_RULES=[
  [/면접\s*준비|면접준비/g,'면접준비'],
  [/취업\s*박람회|취업박람회/g,'취업박람회'],
  [/채용\s*설명회|채용설명회/g,'채용설명회'],
  [/취업\s*상담|취업상담/g,'취업상담'],
  [/취업\s*컨설팅|취업컨설팅/g,'취업컨설팅'],
  [/취업\s*캠프|취업캠프/g,'취업캠프'],
  [/취업\s*준비|취업준비/g,'취업준비'],
  [/치과\s*(?:진료|치료|내원)?|치과/g,'치과진료'],
  [/병원\s*(?:내원|진료|방문)|병원진료|병원\s*방문|의원\s*(?:내원|진료)?|통원\s*(?:치료|진료)?/g,'병원진료'],
  [/병결|병가|몸살|질병|감기|아파서|컨디션\s*난조/g,'병결'],
  [/예비군|동원\s*훈련|동원훈련|민방위/g,'예비군'],
  [/인적성|인성\s*검사|적성\s*검사/g,'인적성'],
  [/자격\s*증?\s*시험|자격시험|자격증\s*응시/g,'자격시험'],
  [/어학\s*시험|토익|토플|오픽|OPIc|HSK/g,'어학시험'],
  [/시험\s*준비|시험준비/g,'시험준비'],
  [/졸업\s*식|졸업식/g,'졸업식'],
  [/추가\s*합격|추가합격/g,'추가합격'],
  [/국취제|국민취업지원(?:제도)?/g,'국취제'],
  [/주거\s*이전|이사/g,'주거이전'],
  [/학교\s*일정|학사\s*일정/g,'학교일정'],
  [/가족\s*일정|가족행사/g,'가족일정'],
  [/외조모\s*상/g,'외조모상'],
  [/조부모\s*상/g,'조부모상'],
  [/본가\s*방문/g,'본가방문'],
  [/외부\s*교육/g,'외부교육'],
  [/현장\s*실습/g,'현장실습'],
  [/대회\s*준비/g,'대회준비'],
  [/대외\s*활동/g,'대외활동'],
  [/공모전/g,'공모전'],
  [/공정\s*실습/g,'공정실습'],
  [/논문/g,'논문'],
  [/실업\s*급여/g,'실업급여'],
  [/행정\s*업무/g,'행정업무'],
  [/병문안/g,'병문안'],
  [/부동산/g,'부동산'],
  [/안경원/g,'안경원'],
  [/에어컨\s*AS|에어컨AS/gi,'에어컨AS'],
  [/주차/g,'주차'],
  [/멘토링/g,'멘토링'],
  [/퇴임식/g,'퇴임식'],
  [/강의장\s*착오/g,'강의장착오'],
  [/경조사/g,'경조사'],
  [/상담/g,'상담'],
  [/늦잠/g,'늦잠'],
  [/교통|차량\s*정체|대중교통\s*지연/g,'교통'],
  [/여행/g,'여행'],
  [/휴가/g,'휴가'],
  [/검사/g,'검사'],
  [/개인\s*(?:사정|사유|일정)|개인사정|개인일정/g,'개인사정'],
  [/면접\s*(?:참석|전형|응시)?|취업\s*면접|채용\s*면접/g,'면접']
];
function explicitGoldReason(v){
  const x=String(v||'');
  for(const [rx,to] of GOLD_REASON_RULES){rx.lastIndex=0;if(rx.test(x))return to;}
  return'';
}
function stripOperationalNoise(v,status=''){
  let x=String(v||'');
  x=x.replace(/\r/g,' ').replace(/\n/g,' ');
  x=x.replace(/\*+/g,' ').replace(/[()\[\]{},，;；:_|/\\]+/g,' ');
  x=x.replace(/\b\d{1,2}\s*[:시]\s*\d{0,2}\s*분?\s*(?:경|입실|퇴실|조퇴)?/g,' ');
  x=x.replace(/\b(?:오전|오후)\s*(?:조퇴|입실|퇴실)?/g,' ');
  x=x.replace(/\b\d{1,2}:\d{2}\s*(?:입실|퇴실|조퇴)?/g,' ');
  x=x.replace(/(?:당일\s*)?(?:사전|사후)?\s*통보/g,' ');
  x=x.replace(/단순\s*(?:지각|결석|조퇴|외출)/g,' ');
  x=x.replace(/지각\s*예정|지각|결석|조퇴|외출|인정출석|인정결석|출석인정|출결인정|출석/g,' ');
  x=x.replace(/(?:출석인정|인정결석|조퇴|지각|결석|외출)\s*\d+/g,' ');
  x=x.replace(/\b\d+\b/g,' ');
  x=x.replace(/확인\s*중|확인중/g,' ');
  x=x.replace(/응시확인서를?\s*발급해주지\s*않았다고\s*합니다?/g,' ');
  x=x.replace(/받은문자와?\s*완료됐다는?\s*화면\s*캡처\s*대신\s*첨부합니다?/g,' ');
  x=x.replace(/간단한\s*사유\s*물어봤으나\s*대답\s*안하고\s*싶어함/g,' ');
  x=x.replace(/사유\s*없을\s*시\s*해당없음으로\s*기재/g,' ');
  x=x.replace(/사유|이유|해당없음|미기재/g,' ');
  if(status)x=x.replace(new RegExp(escapeRe(status),'g'),' ');
  return x.replace(/[-.]+/g,' ').replace(/\s+/g,' ').trim();
}
function standardizeReason(v,status=''){
  let x=String(v||'').trim();if(!x)return'';
  const explicit=explicitGoldReason(x);if(explicit)return explicit;
  const left=stripOperationalNoise(x,status);
  const explicit2=explicitGoldReason(left);if(explicit2)return explicit2;
  if(!left)return'';
  return left.length>40?left.slice(0,40).trim()+'…':left;
}
function cleanReason(raw,status=''){
  let v=String(raw||'').trim();if(!v)return'';
  const explicit=explicitGoldReason(v);if(explicit)return explicit;
  v=v.split(/\n\s*(?=(?:결석|지각|조퇴|외출|인정출석|인정결석|출석|중복)\s*\d*\s*[-:：]?)/)[0];
  v=v.replace(/^\s*[-_:/,|·→>]+\s*/,'').replace(/^\s*(?:사유|이유)\s*[:：-]?\s*/,'');
  v=v.replace(/\((?:인|인정|인정출석)\)/g,' ').replace(/\[(?:인|인정|인정출석)\]/g,' ');
  v=v.replace(/(?:^|\s)(?:결석|지각|조퇴|외출|인정출석|인정결석|출석|중복)\s*\d*\s*[-:：]?\s*/g,' ');
  v=v.replace(/^\d+\s*[-:：]?\s*/,'').replace(/\s*[|/]+\s*$/,'').replace(/\s+/g,' ').trim();
  v=v.replace(/^[-_:/,|]+|[-_:/,|]+$/g,'').trim();
  if(!v||/^(?:해당없음|없음|무|미기재|사유없음)$/i.test(v))return'';
  if(/^(?:결석|지각|조퇴|외출|인정출석|인정결석|출석|중복)\s*\d*$/.test(v))return'';
  if(status&&v===status)return'';
  return standardizeReason(v,status);
}
function sharedReasonFor(name,text,status=''){
  const src=normalizeReasonText(text);if(!src)return'';
  const aliases=studentAliases(name),names=students.map(x=>x.name).filter(Boolean);
  for(const lineRaw of src.split(/\n+/)){
    const line=lineRaw.trim();if(!line||!aliases.some(a=>line.includes(a)))continue;
    const us=line.lastIndexOf('_');if(us<0)continue;
    const left=line.slice(0,us).replace(/^(?:결석|지각|조퇴|외출|인정출석|인정결석|출석|중복)\s*\d*\s*[-:：]?\s*/,'').trim();
    const reason=cleanReason(line.slice(us+1),status);if(!reason)continue;
    const group=left.split(/[，,]/).map(x=>x.trim().replace(/^[-_:]+|[-_:]+$/g,'')).filter(Boolean);
    const matched=group.filter(g=>names.includes(g)||students.some(st=>studentAliases(st.name).includes(g)));
    if(matched.length>=2&&aliases.some(a=>group.includes(a)||group.includes(name)))return reason;
  }
  return'';
}
function personalFallbackEligible(status,raw){
  if(!['결석','지각','조퇴','외출','인정출석','인정결석','중복'].includes(status))return false;
  const left=stripOperationalNoise(raw,status);
  return !left || /^(?:입실|퇴실|경|분|시)+$/.test(left);
}
function parseReasonFor(name,text,status=''){
  const src=normalizeReasonText(text);if(!src)return{reason:'',confidence:'none',method:'none'};
  const shared=sharedReasonFor(name,src,status);if(shared)return{reason:shared,rawReason:shared,confidence:'high',method:'공동 사유'};
  const positions=allNamePositions(src),mine=positions.filter(x=>x.name===name),candidates=[];
  for(const hit of mine){
    const next=positions.find(x=>x.start>=hit.end&&x.name!==name);
    let end=next?next.start:Math.min(src.length,hit.end+180),tail=src.slice(hit.end,end);
    const section=tail.search(/\n\s*(?:결석|지각|조퇴|외출|인정출석|인정결석|출석|중복)\s*\d*\s*[-:：]?/);if(section>=0)tail=tail.slice(0,section);
    const explicit=explicitGoldReason(tail);if(explicit)candidates.push({reason:explicit,rawReason:tail,score:5,method:'정답사유 규칙'});
    else{
      const cleaned=cleanReason(tail,status);
      if(cleaned)candidates.push({reason:cleaned,rawReason:tail,score:3,method:'이름 뒤 문맥'});
      else if(personalFallbackEligible(status,tail))candidates.push({reason:'개인사정',rawReason:tail,score:4,method:'개인사정 보정'});
    }
  }
  if(!candidates.length){
    for(const alias of studentAliases(name)){
      const safe=escapeRe(alias),lineRx=new RegExp(`(?:^|\\n)[^\\n]{0,45}${safe}[^\\n]{0,100}`,'g');let m;
      while((m=lineRx.exec(src))){const chunk=m[0],after=chunk.slice(chunk.indexOf(alias)+alias.length),explicit=explicitGoldReason(after),cleaned=explicit||cleanReason(after,status);if(cleaned)candidates.push({reason:cleaned,rawReason:after,score:explicit?5:2,method:explicit?'정답사유 규칙':'줄 단위 추출'});else if(personalFallbackEligible(status,after))candidates.push({reason:'개인사정',rawReason:after,score:4,method:'개인사정 보정'});}
    }
  }
  if(!candidates.length)return{reason:'',confidence:'none',method:'미매칭'};
  candidates.sort((a,b)=>b.score-a.score||String(a.reason).length-String(b.reason).length);const best=candidates[0];
  return{reason:best.reason,rawReason:best.rawReason||best.reason,confidence:best.score>=4?'high':best.score>=2?'medium':'low',method:best.method};
}
'''

s=s[:start]+new_parser+s[end:]

# status validation: include duplicated attendance state used in the gold workbook
s=s.replace("const f=[],need=['결석','지각','조퇴','외출','인정출석','인정결석'].includes(status);","const f=[],need=['결석','지각','조퇴','외출','인정출석','인정결석','중복'].includes(status);",1)
s=s.replace("const options=['출석','결석','지각','조퇴','외출','인정출석','인정결석','해당없음','미입력'];","const options=['출석','결석','지각','조퇴','외출','인정출석','인정결석','중복','해당없음','미입력'];",1)

# avoid re-standardizing a gold-calibrated reason without status context
s=s.replace("reason=standardizeReason(ov?.reason??baseReason),flags=validateStudent", "reason=(ov?.reason??baseReason),flags=validateStudent",1)

# update audit marker / user-facing parser description
s=s.replace("parser:'VALIDATION_ENGINE_V3'","parser:'GOLD_CALIBRATED_V4'",1)
s=s.replace("AI 없이 학생 명단·가-2 출결·이름 주변 문맥을 함께 사용합니다.","재검증 엑셀의 500명·1,108건 출결 사유와 개인사정 보정 사례를 기준으로 학생 명단·가-2 출결·가-3 이름 주변 문맥을 함께 사용합니다.",1)

p.write_text(s,encoding='utf-8')
print('patched attendance parser to GOLD_CALIBRATED_V4')
