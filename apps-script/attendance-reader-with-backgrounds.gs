const AR_SHEET_ID='1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34';
const AR_CLASSES={
  '1':'1. 수도권_임베디드 AI(HW)',
  '2':'2. 수도권_제조지능화',
  '3':'3. 충청_임베디드 AI(SW)',
  '4':'4. 충청_제조지능화(1)',
  '5':'5. 충청_제조지능화(2)',
  '6':'6. 대경_임베디드 AI(HW)',
  '7':'7. 대경_임베디드 AI(SW)',
  '8':'8. 대경_제조지능화(1)',
  '9':'9. 대경_제조지능화(2)',
  '10':'10. 동남_임베디드 AI(HW)',
  '11':'11. 동남_임베디드 AI(SW)',
  '12':'12. 동남_제조지능화(1)',
  '13':'13. 동남_제조지능화(2)',
  '14':'14. 동남_제조지능화(3)',
  '15':'15. 전라_임베디드 AI(SW)',
  '16':'16. 전라_제조지능화(1)',
  '17':'17. 전라_제조지능화(2)'
};

function arJson_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function arLastAttendanceColumn_(sh){
  const startCol=13; // M
  const maxScan=180; // M부터 충분히 여유 있게 약 180열만 확인
  const header=sh.getRange(18,startCol,1,maxScan).getDisplayValues()[0];
  let last=-1;
  for(let i=0;i<header.length;i++){
    if(String(header[i]||'').trim()) last=i;
  }
  if(last<4) throw new Error('ATTENDANCE_HEADER_NOT_FOUND');
  return startCol+last;
}

function doGet(e){
  try{
    const classId=String((e&&e.parameter&&e.parameter.classId)||'').trim();
    if(!AR_CLASSES[classId]) throw new Error('BAD_CLASS');
    const ss=SpreadsheetApp.openById(AR_SHEET_ID);
    const sh=ss.getSheetByName(AR_CLASSES[classId]);
    if(!sh) throw new Error('CLASS_SHEET_NOT_FOUND');

    const startCol=13; // M
    const lastCol=arLastAttendanceColumn_(sh);
    const width=lastCol-startCol+1;
    const attendanceRange=sh.getRange(18,startCol,31,width);
    const reasonsRange=sh.getRange(50,startCol,2,width);

    const attendance=attendanceRange.getDisplayValues();
    const attendanceBackgrounds=attendanceRange.getBackgrounds();
    const reasons=reasonsRange.getDisplayValues();

    return arJson_({
      ok:true,
      classId:classId,
      attendance:attendance,
      attendanceBackgrounds:attendanceBackgrounds,
      reasons:reasons,
      range:{start:'M18',columns:width},
      readOnly:true
    });
  }catch(err){
    return arJson_({ok:false,error:String(err&&err.message||err)});
  }
}
