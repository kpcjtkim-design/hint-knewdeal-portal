import {surveyBaseName} from './survey-identity.mjs';
const normalize=value=>String(value??'').normalize('NFKC').replace(/\s/g,'');
export const hasBirthYearName=name=>/\((?:\d{2}|\d{4})년생\)$/.test(normalize(name));

// Reuse the class's existing survey identity map. Never rename a collected
// record: its real name/studentKey must still locate the same CheckHere row.
export function checkHerePhoneFor(student,identities=[]){
  const name=normalize(student.name),base=surveyBaseName(name);
  const group=identities.filter(x=>surveyBaseName(x.name)===base);
  const explicit=String(student.phoneLast4||'');
  if(explicit&&!/^\d{4}$/.test(explicit))return null;
  if(!group.length)return explicit;
  if(group.length<2||group.some(x=>!/^\d{4}$/.test(String(x.phoneLast4||'')))||
    new Set(group.map(x=>normalize(x.name))).size!==group.length||
    new Set(group.map(x=>x.phoneLast4)).size!==group.length)return null;
  const mapped=group.find(x=>normalize(x.name)===name);
  if(mapped)return explicit&&explicit!==mapped.phoneLast4?null:mapped.phoneLast4;
  // A bare-name manual request must specify which of the registered students.
  return explicit&&group.some(x=>x.phoneLast4===explicit)?explicit:null;
}

export function matchingCheckHereRecords(student,records,identities=[]){
  const name=normalize(student.name),base=surveyBaseName(name),tail=checkHerePhoneFor(student,identities);
  if(!name||tail===null)return [];
  return records.filter(record=>{
    if(student.classId!=null&&String(record.classId)!==String(student.classId))return false;
    if(student.date!=null&&record.date!==student.date)return false;
    const actual=normalize(record.name);
    if(surveyBaseName(actual)!==base||tail&&record.phoneLast4!==tail)return false;
    if(actual===name)return true;
    // Birth-year aliases need a phone match; two different explicit aliases
    // never match, even if an upstream phone value is wrong.
    return !!tail&&!(hasBirthYearName(actual)&&hasBirthYearName(name));
  });
}
