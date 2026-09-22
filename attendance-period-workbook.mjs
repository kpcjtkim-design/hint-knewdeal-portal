import {REVIEW_HEADERS,periodClassId} from './attendance-period-core.mjs';
import {isoLabel} from './attendance-beta-core.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
const letters=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const coord=s=>{const m=s.match(/^([A-Z]+)(\d+)$/);return {col:[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:+m[2]};};
export function buildPeriodWorkbook(ExcelJS,result,templates,periodId){
 const p=templates.profiles[result.classId];if(!p)throw Error('해당 반 원본 양식이 없습니다.');
 const book=new ExcelJS.Workbook();book.calcProperties.fullCalcOnLoad=true;
 const sheet=book.addWorksheet(p.name.replace(/_\d+\s*단위기간$/,`_${periodId} 단위기간`).slice(0,31)),last=10+result.dates.length,oldLast=p.widths.length;
 sheet.pageSetup=copy(p.pageSetup);sheet.views=copy(p.views);const styleAt=(r,c)=>templates.styles[p.cells.find(x=>x[0]===r&&x[1]===c)?.[3]]||{};
 for(let c=1;c<=last;c++)sheet.getColumn(c).width=p.widths[c<10?c-1:c===last?oldLast-1:9]||4;
 for(let r=1;r<=17;r++){if(p.heights[r-1])sheet.getRow(r).height=p.heights[r-1];}
 for(const [r,c,value,style]of p.cells){if(r>17||c>=10&&c<oldLast&&r>=15)continue;const nc=c===oldLast?last:c;if(nc>last)continue;const cell=sheet.getCell(r,nc);cell.value=value;cell.style=copy(templates.styles[style]);}
 for(const range of p.merges){const [a,b]=range.split(':').map(coord);if(a.row===15&&a.col>=10&&a.col<oldLast)continue;const ca=a.col===oldLast?last:a.col,cb=b.col===oldLast?last:b.col;if(ca>last||cb>last)continue;sheet.mergeCells(a.row,ca,b.row,cb);}
 sheet.getCell('C13').value=`${result.from} ~ ${result.to}`;sheet.getCell('C11').value=`수강생 전체 ${result.students.length}명`;
 sheet.getCell('A14').value=`포털 DB 대조 · 확인필요 ${result.reviews.length}건 · 확인필요 시트 검토 후 마감`;
 sheet.getCell(15,last).value=`비고(단위기간 ${result.from.slice(5).replace('-','/')}-${result.to.slice(5).replace('-','/')})`;
 for(let i=0;i<result.dates.length;i++){const d=result.dates[i],col=10+i;for(let r=15;r<=17;r++)sheet.getCell(r,col).style=copy(styleAt(r,10));sheet.getCell(16,col).value=new Date(d+'T00:00:00Z');sheet.getCell(16,col).numFmt='m/d';sheet.getCell(17,col).value='일월화수목금토'[new Date(d+'T12:00:00Z').getUTCDay()];}
 for(let start=0;start<result.dates.length;){let end=start;while(end+1<result.dates.length&&result.dates[end+1].slice(0,7)===result.dates[start].slice(0,7))end++;sheet.getCell(15,10+start).value=Number(result.dates[start].slice(5,7));if(end>start)sheet.mergeCells(15,10+start,15,10+end);start=end+1;}
 const colors={...p.colors,인정지각:p.colors['지각'],인정조퇴:p.colors['조퇴'],인정외출:p.colors['외출']};
 for(let i=0;i<result.students.length;i++){
  const s=result.students[i],r=i+18;sheet.getRow(r).height=Math.max(p.heights[17]||22,Math.min(280,(s.remarks.split('\n').length+1)*13));
  for(let c=1;c<=last;c++)sheet.getCell(r,c).style=copy(styleAt(18,c<10?c:c===last?oldLast:10));
  [i+1,s.name,'실업자(일반)',s.trainingStatus].forEach((v,j)=>sheet.getCell(r,j+1).value=v);
  s.cells.forEach((x,j)=>{const cell=sheet.getCell(r,10+j);cell.value=x.status;if(colors[x.status])cell.font={...cell.font,color:copy(colors[x.status])};else if(x.status)throw Error(`${s.name}: ${x.status}의 원본 글자색을 확인하지 못했습니다.`);});
  const range=`$J${r}:$${letters(last-1)}${r}`,count=values=>values.map(v=>`COUNTIF(${range},"${v}")`).join('+'),present=['출석','인정출석','지각','인정지각','조퇴','인정조퇴','외출','인정외출','중복','중복(지각+외출, 지각+조퇴, 외출+조퇴)'],partial=present.slice(2),n=values=>s.cells.filter(c=>values.includes(c.status)).length,days=s.cells.filter(c=>c.status&&c.status!=='해당없음').length;
  const formulas=[`COUNTA(${range})-COUNTIF(${range},"해당없음")`,count(present),count(['결석']),count(partial),`IF(E${r}=0,0,F${r}/E${r})`],values=[days,n(present),n(['결석']),n(partial),days?n(present)/days:0];
  formulas.forEach((formula,j)=>sheet.getCell(r,j+5).value={formula,result:values[j]});sheet.getCell(r,last).value=s.remarks;sheet.getCell(r,last).alignment={...sheet.getCell(r,last).alignment,wrapText:true};
 }
 const review=book.addWorksheet('확인필요');review.addRow(REVIEW_HEADERS);result.reviews.forEach(r=>review.addRow(r));review.columns.forEach(c=>c.width=22);review.getColumn(9).width=48;review.getRow(1).font={bold:true};review.views=[{state:'frozen',ySplit:1}];
 const raw=book.addWorksheet('가-3 원문');raw.addRow(['교육일','가-3 원문']);result.reasons.forEach(r=>raw.addRow(r));raw.getColumn(1).width=16;raw.getColumn(2).width=100;raw.getColumn(2).alignment={wrapText:true};
 sheet.eachRow(row=>row.eachCell(cell=>{if(cell.formula&&/#REF!|\[[^\]]+\.xlsx\]/.test(cell.formula))throw Error('수식 참조 검증에 실패했습니다.');if(typeof cell.value==='string'&&cell.value.length>32767)throw Error('비고 원문이 Excel 셀 길이 한도를 초과했습니다.');}));
 return book;
}
function value(cell){const v=cell.value;return v&&typeof v==='object'&&!(v instanceof Date)?v.result??v.text??(v.richText?.map(x=>x.text).join(''))??'':v??'';}
const dateValue=v=>v instanceof Date?v.toISOString().slice(0,10):isoLabel(v);
export function readUploadedAttendance(book,classId){
 const matches=book.worksheets.filter(s=>periodClassId(s.name)===String(classId)&&!/단위|테스트|test|사본|backup/i.test(s.name));if(matches.length!==1)throw Error(`${classId}반 일반 출결 시트를 하나로 찾지 못했습니다.`);
 const s=matches[0],markers={2:[],3:[]};s.eachRow(row=>row.eachCell(c=>{const m=String(value(c)).match(/^가\s*[-－]\s*([23])\s*[.．]/);if(m&&(!c.isMerged||c.master.address===c.address))markers[m[1]].push({row:row.number,col:c.col});}));
 if(markers[2].length!==1||markers[3].length!==1)throw Error('운영총괄 가-2 출석현황·가-3 사유 영역을 하나로 확인하지 못했습니다.');
 const a=markers[2][0],g=markers[3][0];if(a.col!==g.col||g.row<=a.row)throw Error('운영총괄 출결·가-3 열 배치가 다릅니다.');
 const datesAt=r=>Array.from({length:s.columnCount-a.col+1},(_,i)=>dateValue(value(s.getCell(r,a.col+i)))).filter(Boolean).length;
 const header=[a.row,a.row+1,a.row+2,a.row+3].find(r=>datesAt(r)>=5);
 if(!header||datesAt(g.row)<5)throw Error('운영총괄 출결·가-3 날짜 행을 확인하지 못했습니다.');
 const getRow=r=>Array.from({length:s.columnCount-a.col+1},(_,i)=>{const v=value(s.getCell(r,a.col+i));return v instanceof Date?v.toISOString().slice(0,10):v;});
 if(!dateValue(getRow(header)[4]))throw Error('출결 이름·날짜 열을 확인하지 못했습니다.');
 // Retain empty roster slots so existing row_name keys keep their source indices.
 const attendance=[getRow(header)];for(let r=header+1;r<g.row;r++)attendance.push(getRow(r));
 return {attendance,reasons:[getRow(g.row),getRow(g.row+1)]};
}
