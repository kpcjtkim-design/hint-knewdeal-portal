import {resolveSheetTarget,quoteSheet,isoLabel,sheetStatus,EVIDENCE_COLORS} from './attendance-beta-core.mjs';
const GOOGLE='https://sheets.googleapis.com/v4/spreadsheets/';
const rgb=hex=>({red:parseInt(hex.slice(1,3),16)/255,green:parseInt(hex.slice(3,5),16)/255,blue:parseInt(hex.slice(5,7),16)/255});
export function colorHex(v){if(!v)return'#ffffff';return'#'+['red','green','blue'].map(k=>Math.round((v[k]||0)*255).toString(16).padStart(2,'0')).join('');}
function cellValue(cell){return cell?.userEnteredValue?.stringValue??cell?.formattedValue??'';}
function cellColor(cell){const f=cell?.effectiveFormat||cell?.userEnteredFormat||{};return colorHex(f.backgroundColorStyle?.rgbColor||f.backgroundColor);}
export function createSheetWriter({authorize,getClassConfig,fetchImpl=fetch}){
  let token='',busy=false;
  async function api(url,body){
    if(!token)throw Error('먼저 내 Google 계정의 시트 편집 권한을 연결해 주세요.');
    const res=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    const data=await res.json();if(!res.ok){if(res.status===401)token='';throw Error(data.error?.message||`Google Sheets 오류 (${res.status})`);}return data;
  }
  async function layout(classId){
    const config=await getClassConfig(String(classId)),match=String(config.sheetUrl||'').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);if(!match)throw Error('반별 운영 시트 주소가 설정되지 않았습니다.');
    const id=match[1],permission=await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,capabilities(canEdit)&supportsAllDrives=true`);
    if(permission.capabilities?.canEdit!==true)throw Error('현재 Google 계정에 이 시트의 편집 권한이 없습니다.');
    const meta=await api(`${GOOGLE}${id}?fields=sheets(properties(sheetId,title))`),gid=String(config.sheetUrl).match(/[?#&]gid=(\d+)/)?.[1],sheets=(meta.sheets||[]).map(x=>x.properties).filter(x=>new RegExp('^'+String(classId)+'\\.\\s').test(x.title)&&(gid===undefined||String(x.sheetId)===gid));
    if(sheets.length!==1)throw Error('운영 반과 일치하는 시트 탭을 하나로 확인하지 못했습니다. 테스트·복제 탭을 확인해 주세요.');
    const sheet=sheets[0],q=quoteSheet(sheet.title),ranges=[`${q}!M18:ZZ48`,`${q}!M50:ZZ51`];
    const values=await api(`${GOOGLE}${id}/values:batchGet?${ranges.map(x=>'ranges='+encodeURIComponent(x)).join('&')}&valueRenderOption=FORMATTED_VALUE`);
    return {id,title:sheet.title,sheetId:sheet.sheetId,attendance:values.valueRanges?.[0]?.values||[],reasons:values.valueRanges?.[1]?.values||[]};
  }
  async function readCell(id,range){
    const data=await api(`${GOOGLE}${id}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=sheets(data(rowData(values(userEnteredValue,formattedValue,effectiveFormat(backgroundColor,backgroundColorStyle),userEnteredFormat(backgroundColor,backgroundColorStyle)))))`);
    return data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]||{};
  }
  async function write({classId,date,name,kind,before,after}){
    if(busy)throw Error('다른 시트 저장이 진행 중입니다. 완료 후 다시 시도해 주세요.');busy=true;
    try{
      if(!['status','reason','color'].includes(kind))throw Error('허용되지 않는 변경입니다.');
      if(kind==='status')after=sheetStatus(after);
      if(kind==='color'){if(!Object.values(EVIDENCE_COLORS).includes(after))throw Error('허용되지 않는 서류 색입니다.');}
      if(kind==='reason'&&(typeof after!=='string'||after.length>45000))throw Error('가-3 사유 길이를 확인해 주세요.');
      const source=await layout(classId),target=resolveSheetTarget(source,name,date),range=kind==='reason'?target.reasonA1:target.statusA1;
      const original=await readCell(source.id,range);if(original.userEnteredValue?.formulaValue)throw Error('수식이 들어 있는 셀은 덮어쓸 수 없습니다.');
      const current=kind==='color'?cellColor(original):cellValue(original);
      if(current!==String(before??''))throw Error('다른 작업으로 원본이 변경됐습니다. 다시 읽은 후 수정해 주세요.');
      // Recheck student and date identity immediately before the single-cell write.
      const guards=[target.nameA1,kind==='reason'?target.reasonDateA1:target.dateA1];
      const fresh=await api(`${GOOGLE}${source.id}/values:batchGet?${guards.map(x=>'ranges='+encodeURIComponent(x)).join('&')}&valueRenderOption=FORMATTED_VALUE`);
      if(String(fresh.valueRanges?.[0]?.values?.[0]?.[0]||'').trim()!==name||isoLabel(fresh.valueRanges?.[1]?.values?.[0]?.[0])!==date)throw Error('저장 직전 학생 또는 날짜 위치가 바뀌었습니다. 다시 읽어 주세요.');
      const row=(kind==='reason'?target.reasonRow:target.row)-1,col=(kind==='reason'?target.reasonCol:target.col)-1;
      const update=kind==='color'?{userEnteredFormat:{backgroundColorStyle:{rgbColor:rgb(after)}}}:{userEnteredValue:{stringValue:after}};
      const request={updateCells:{range:{sheetId:target.sheetId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:col,endColumnIndex:col+1},rows:[{values:[update]}],fields:kind==='color'?'userEnteredFormat.backgroundColorStyle':'userEnteredValue'}};
      let transportError;try{await api(`${GOOGLE}${source.id}:batchUpdate`,{requests:[request]});}catch(e){transportError=e;}
      let saved;try{saved=await readCell(source.id,range);}catch{throw Error('저장 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다. 시트를 다시 읽어 확인해 주세요.');}
      const actual=kind==='color'?cellColor(saved):cellValue(saved);
      if(actual!==after)throw Error(transportError?`저장 실패 또는 결과 미확인: ${transportError.message}`:'저장 후 값이 요청과 다릅니다. 원본을 확인해 주세요.');
      return {value:actual,range,verified:true};
    }finally{busy=false;}
  }
  return {async connect(classId){token='';try{token=await authorize();await layout(classId);return true;}catch(e){token='';throw e;}},write,connected:()=>!!token,disconnect(){token='';}};
}
