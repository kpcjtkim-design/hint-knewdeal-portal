// Excel 도구(ExcelJS 4.4.0·JSZip 3.10.1)를 한 번만 불러옵니다. 단위기간 출석부(1기·2기)와 HRD 출결 업로드 파일이 함께 씁니다.
let libraryPromise;
export function periodLibraries(){
 if(!libraryPromise)libraryPromise=Promise.all([['ExcelJS','https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'],['JSZip','https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js']].map(([name,src])=>window[name]?Promise.resolve():new Promise((resolve,reject)=>{const s=document.createElement('script'),timer=setTimeout(()=>{s.remove();reject(Error('Excel 도구 연결이 지연됩니다. 다시 시도해 주세요.'));},30000);s.src=src;s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);s.remove();reject(Error('Excel 도구를 불러오지 못했습니다.'));};document.head.append(s);}))).catch(e=>{libraryPromise=null;throw e;});
 return libraryPromise;
}
