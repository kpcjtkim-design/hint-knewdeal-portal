const ATT_TEST_SHEET_ID = '1QDsPWGY8NKkoFovNxUiqea1z-_c1nQxW0AtIUl-A6jU';
const ATT_TEST_CLASS_SHEET = '1. 수도권_임베디드 AI(HW)';
const ATT_TEST_BACKUP_SHEET = '출결_백업_TEST';
const FIREBASE_WEB_API_KEY = 'AIzaSyBL8YBAPyoGlcVX7T3tjgazncMHjHUY1DE';
const ATT_ALLOWED_ADMINS = ['hint.kpc@gmail.com','kpc.jtkim@gmail.com'];

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.scope !== 'ATTENDANCE_TEST') return jsonResponse({ok:false,error:'BAD_SCOPE'});
    const email = verifyFirebaseToken_(body.idToken);
    if (!email || String(email).toLowerCase() !== String(body.actorEmail || '').toLowerCase()) return jsonResponse({ok:false,error:'AUTH_MISMATCH'});
    if (body.classId !== '1') return jsonResponse({ok:false,error:'CLASS_NOT_ALLOWED'});
    if (body.action === 'read') return jsonResponse(readAttendanceTest_(email));
    if (body.action === 'save') return jsonResponse(saveAttendanceTest_(email, body.date, body.records || []));
    return jsonResponse({ok:false,error:'BAD_ACTION'});
  } catch (err) {
    return jsonResponse({ok:false,error:String(err && err.message ? err.message : err)});
  }
}

function verifyFirebaseToken_(idToken) {
  if (!idToken) throw new Error('LOGIN_REQUIRED');
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_WEB_API_KEY), {
    method:'post', contentType:'application/json', payload:JSON.stringify({idToken:idToken}), muteHttpExceptions:true
  });
  if (r.getResponseCode() !== 200) throw new Error('LOGIN_REQUIRED');
  const d = JSON.parse(r.getContentText() || '{}');
  const email = d.users && d.users[0] && d.users[0].email;
  if (!email) throw new Error('LOGIN_REQUIRED');
  return String(email).toLowerCase();
}

function readAttendanceTest_(email) {
  const ss = SpreadsheetApp.openById(ATT_TEST_SHEET_ID);
  const sh = ss.getSheetByName(ATT_TEST_CLASS_SHEET);
  if (!sh) throw new Error('CLASS_SHEET_NOT_FOUND');
  const g2 = sh.getRange('M18:BD45').getDisplayValues();
  const g3 = sh.getRange('M50:BD51').getDisplayValues();
  const header = g2[0] || [];
  const dates = header.slice(4).filter(Boolean);
  const reasonHeader = (g3[0] || []).slice(4);
  const reasonRow = (g3[1] || []).slice(4);
  const reasonByDate = {};
  reasonHeader.forEach((d,i)=>{ if(d) reasonByDate[d]=reasonRow[i]||''; });
  const rows = g2.slice(1).filter(r=>String(r[0]||'').trim());
  const recordsByDate = {};
  dates.forEach((date,di)=>{
    recordsByDate[date] = rows.map(r=>({name:String(r[0]||'').trim(),status:String(r[4+di]||'').trim(),reason:parseReasonFor_(String(r[0]||'').trim(), reasonByDate[date]||'')}));
  });
  return {ok:true,dates:dates,selectedDate:dates.indexOf('8/24')>=0?'8/24':(dates[0]||''),recordsByDate:recordsByDate};
}

function saveAttendanceTest_(email, date, records) {
  if (!date) throw new Error('DATE_REQUIRED');
  if (!Array.isArray(records) || !records.length) throw new Error('RECORDS_REQUIRED');
  const allowedStatus = {'출석':1,'결석':1,'지각':1,'조퇴':1,'외출':1,'인정출석':1,'해당없음':1,'':1};
  records.forEach(r=>{ if(!r.name || !allowedStatus[String(r.status||'')]) throw new Error('INVALID_RECORD'); });
  const ss = SpreadsheetApp.openById(ATT_TEST_SHEET_ID);
  const sh = ss.getSheetByName(ATT_TEST_CLASS_SHEET);
  if (!sh) throw new Error('CLASS_SHEET_NOT_FOUND');
  const header = sh.getRange('Q18:BD18').getDisplayValues()[0];
  const idx = header.indexOf(date);
  if (idx < 0) throw new Error('DATE_NOT_FOUND');
  const col = 17 + idx;
  const names = sh.getRange(19,13,27,1).getDisplayValues().map(r=>String(r[0]||'').trim());
  const current = sh.getRange(19,col,27,1).getDisplayValues().map(r=>r[0]);
  const reasonHeader = sh.getRange('Q50:BD50').getDisplayValues()[0];
  const reasonIdx = reasonHeader.indexOf(date);
  if (reasonIdx < 0) throw new Error('REASON_DATE_NOT_FOUND');
  const reasonCol = 17 + reasonIdx;
  const oldReason = sh.getRange(51,reasonCol).getDisplayValue();
  const byName = {}; records.forEach(r=>byName[String(r.name).trim()]={status:String(r.status||''),reason:String(r.reason||'').trim()});
  const nextStatuses = names.map((n,i)=> n && byName[n] ? [byName[n].status] : [current[i]]);
  const newReason = buildReasonSummary_(names,byName);
  ensureBackupSheet_(ss);
  const backup = ss.getSheetByName(ATT_TEST_BACKUP_SHEET);
  backup.appendRow([new Date(),email,'1',date,JSON.stringify(Object.fromEntries(names.map((n,i)=>[n,current[i]]).filter(x=>x[0]))),oldReason,JSON.stringify(Object.fromEntries(names.map((n,i)=>[n,nextStatuses[i][0]]).filter(x=>x[0]))),newReason]);
  sh.getRange(19,col,27,1).setValues(nextStatuses);
  sh.getRange(51,reasonCol).setValue(newReason);
  SpreadsheetApp.flush();
  const verifyStatuses = sh.getRange(19,col,27,1).getDisplayValues().map(r=>r[0]);
  const verifyReason = sh.getRange(51,reasonCol).getDisplayValue();
  for (let i=0;i<27;i++) if(String(verifyStatuses[i]||'')!==String(nextStatuses[i][0]||'')) throw new Error('VERIFY_FAILED_STATUS');
  if(String(verifyReason||'')!==String(newReason||'')) throw new Error('VERIFY_FAILED_REASON');
  return {ok:true,saved:true,date:date};
}

function parseReasonFor_(name,text){
  if(!name||!text)return'';
  const lines=String(text).split(/\n+/);
  for(const line of lines){
    const p=line.trim();
    if(p.indexOf(name+'_')===0) return p.slice(name.length+1).replace(/\(인\)$/,'').trim();
    if(p.indexOf(name+'-')===0) return p.slice(name.length+1).replace(/\(인\)$/,'').trim();
    if(p.indexOf(name+':')===0) return p.slice(name.length+1).replace(/\(인\)$/,'').trim();
  }
  return'';
}

function buildReasonSummary_(names,byName){
  const groups={결석:[],지각:[],조퇴:[],외출:[],인정결석:[]};
  names.forEach(name=>{
    if(!name||!byName[name])return;
    const r=byName[name],st=r.status;
    if(!st||st==='출석'||st==='해당없음')return;
    const key=st==='인정출석'?'인정결석':st;
    if(groups[key])groups[key].push(name+'_'+(r.reason||'사유미기재'));
  });
  const out=[];
  ['결석','지각','조퇴','외출','인정결석'].forEach(k=>{if(groups[k].length)out.push(k+groups[k].length+'\n'+groups[k].join('\n'));});
  return out.length?out.join('\n\n'):'해당없음';
}

function ensureBackupSheet_(ss){
  let sh=ss.getSheetByName(ATT_TEST_BACKUP_SHEET);
  if(!sh){sh=ss.insertSheet(ATT_TEST_BACKUP_SHEET);sh.getRange('A1:H1').setValues([['저장시각','계정','반','날짜','기존 출결 JSON','기존 가-3','신규 출결 JSON','신규 가-3']]);}
}
