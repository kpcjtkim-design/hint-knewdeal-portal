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

function doGet(e){
  try{
    const classId=String((e&&e.parameter&&e.parameter.classId)||'').trim();
    if(!AR_CLASSES[classId]) throw new Error('BAD_CLASS');
    const ss=SpreadsheetApp.openById(AR_SHEET_ID);
    const sh=ss.getSheetByName(AR_CLASSES[classId]);
    if(!sh) throw new Error('CLASS_SHEET_NOT_FOUND');
    const attendanceRange=sh.getRange('M18:ZZ48');
    const reasonsRange=sh.getRange('M50:ZZ51');
    return arJson_({
      ok:true,
      classId:classId,
      attendance:attendanceRange.getDisplayValues(),
      attendanceBackgrounds:attendanceRange.getBackgrounds(),
      reasons:reasonsRange.getDisplayValues(),
      readOnly:true
    });
  }catch(err){
    return arJson_({ok:false,error:String(err&&err.message||err)});
  }
}
