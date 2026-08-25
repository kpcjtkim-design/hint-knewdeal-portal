const SHEET_ID = '1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34';
const CLASS_SHEETS = {
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

function doGet(){
  return json_({ok:true,service:'HINT Attendance Reader',mode:'READ_ONLY'});
}

function doPost(e){
  try{
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('READER_SECRET');
    if(!secret || body.secret !== secret) throw new Error('UNAUTHORIZED');
    const classId = String(body.classId || '');
    const sheetName = CLASS_SHEETS[classId];
    if(!sheetName) throw new Error('BAD_CLASS');

    // READ ONLY: 이 스크립트에는 setValue/appendRow/delete/insert/update 호출이 없습니다.
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(sheetName);
    if(!sh) throw new Error('SHEET_NOT_FOUND');

    const g2 = sh.getRange('M18:ZZ48').getDisplayValues();
    const g3 = sh.getRange('M50:ZZ51').getDisplayValues();
    return json_({
      ok:true,
      mode:'READ_ONLY',
      source:'K-뉴딜 아카데미 운영총괄',
      classId:classId,
      sheetName:sheetName,
      g2:g2,
      g3:g3
    });
  }catch(err){
    return json_({ok:false,error:String(err && err.message || err)});
  }
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
