const normalized=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
// Only the roster's birth-year suffix is an alias, never arbitrary parentheses.
export const surveyBaseName=v=>normalized(v).replace(/\((?:\d{2}|\d{4})년생\)$/,'');
export function phoneLast4(value){
 const text=String(value??'').normalize('NFKC').trim();
 if(!/^[+\d\s().-]+$/.test(text))return '';
 const digits=text.replace(/\D/g,'');
 return digits.length===4||digits.length>=10&&digits.length<=13?digits.slice(-4):'';
}
export function duplicateStudents(targets){
 const groups=new Map();for(const s of targets){const key=surveyBaseName(s.name);if(key){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}}
 return [...groups.values()].filter(g=>g.length>1).flat();
}
export function validateDuplicateIdentities(entries,targets){
 if(!Array.isArray(entries)||entries.length>100)throw Error('동명이인 연결 형식을 확인해 주세요.');
 const duplicates=duplicateStudents(targets),seen=new Set(),tails=new Set();
 const clean=entries.map(entry=>{
  if(Object.keys(entry).some(k=>!['name','phoneLast4'].includes(k)))throw Error('이름과 전화번호 끝 4자리만 저장할 수 있습니다.');
  const name=String(entry.name||'').trim(),key=normalized(name),tail=String(entry.phoneLast4||'');
  if(duplicates.filter(s=>normalized(s.name)===key).length!==1)throw Error('시트에서 구분된 동명이인 이름을 확인해 주세요.');
  if(!/^\d{4}$/.test(tail))throw Error('전화번호 끝 4자리만 입력해 주세요.');
  const groupKey=surveyBaseName(name)+':'+tail;
  if(seen.has(key)||tails.has(groupKey))throw Error('같은 이름의 학생끼리 끝 4자리가 겹쳐 자동 연결할 수 없습니다.');
  seen.add(key);tails.add(groupKey);return {name,phoneLast4:tail};
 });
 for(const entry of clean){const group=duplicates.filter(s=>surveyBaseName(s.name)===surveyBaseName(entry.name));if(group.some(s=>!seen.has(normalized(s.name))))throw Error('같은 이름의 학생 모두 끝 4자리를 입력해 주세요.');}
 return clean;
}
// Caller supplies exactly one class roster and that class's private identity map.
export function createSurveyIdentityMatcher(targets,identities=[]){
 const groups=new Map();for(const s of targets){const key=surveyBaseName(s.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
 const saved=Array.isArray(identities)?identities:[];
 return response=>{
  const key=normalized(response.name),group=groups.get(surveyBaseName(key))||[],exact=group.filter(s=>normalized(s.name)===key);
  if(!group.length)return {candidates:[],target:null};
  if(group.length===1)return {candidates:group,target:exact.length===1?exact[0]:null};
  const tail=phoneLast4(response.phoneLast4??response.phone),hasPhone=String(response.phoneLast4??response.phone??'').trim()!=='';
  if(tail){
   const relevant=saved.filter(s=>surveyBaseName(s.name)===surveyBaseName(key));
   const complete=group.every(s=>relevant.filter(x=>normalized(x.name)===normalized(s.name)&&/^\d{4}$/.test(x.phoneLast4)).length===1)&&relevant.length===group.length&&new Set(relevant.map(x=>x.phoneLast4)).size===group.length;
   const rows=complete?relevant.filter(s=>s.phoneLast4===tail):[];
   const matched=rows.length===1?group.filter(s=>normalized(s.name)===normalized(rows[0].name)):[];
   if(matched.length===1&&(key===surveyBaseName(key)||exact.length===1&&exact[0]===matched[0]))return {candidates:group,target:matched[0]};
  }
  // Preserve explicit roster names for older surveys with no phone field.
  if(!hasPhone&&key!==surveyBaseName(key)&&exact.length===1)return {candidates:group,target:exact[0]};
  return {candidates:group,target:null};
 };
}
