// 구글 드라이브 폴더 목록(b2DriveFolders) 시험 자료. 폴더 id는 모두 가상입니다.
// 1반: 반 폴더 · WEEK 1(10/28~10/30) · WEEK 2(11/2~11/6) · 1단위·2단위(1·2·3 폴더, 3. 출석인정서류는 날짜 하위 폴더 10/29·11/5). 2반은 출결인정자료 반 폴더 하나.
const R=(cls,kind,unit,date,id,name=id)=>({cls,kind,unit,date,id,name});
export const FOLDER_ROWS=[
 R('1','manual','','','m-cls','1반 수기출석'),R('1','evidence','','','e-cls','1반 출결인정자료'),R('1','photo','','','p-cls','1반 교육사진'),
 R('1','manual','WEEK 1','','m-w1','WEEK 1'),R('1','evidence','WEEK 1','','e-w1','WEEK 1'),R('1','photo','WEEK 1','','p-w1','WEEK 1'),
 R('1','manual','WEEK 1','2026-10-28','m-1028','10.28'),
 R('1','evidence','WEEK 1','2026-10-28','e-1028','10.28'),R('1','evidence','WEEK 1','2026-10-29','e-1029','10.29'),R('1','evidence','WEEK 1','2026-10-30','e-1030','10.30'),
 R('1','photo','WEEK 1','2026-10-28','p-1028','10.28'),R('1','photo','WEEK 1','2026-10-29','p-1029','10.29'),
 R('1','manual','WEEK 2','','m-w2','WEEK 2'),R('1','evidence','WEEK 2','','e-w2','WEEK 2'),R('1','photo','WEEK 2','','p-w2','WEEK 2'),
 R('1','manual','WEEK 2','2026-11-05','m-1105','11.05'),R('1','evidence','WEEK 2','2026-11-02','e-1102','11.02'),R('1','evidence','WEEK 2','2026-11-05','e-1105','11.05'),
 R('1','photo','WEEK 2','2026-11-02','p-1102','11.02'),R('1','photo','WEEK 2','2026-11-06','p-1106','11.06'),
 R('1','unit','1단위','','u1','1단위'),R('1','unitSheet','1단위','','u1-sheet','1. 단위기간출석부'),R('1','unitRequest','1단위','','u1-req','2. 출석입력요청대장'),R('1','unitEvidence','1단위','','u1-ev','3. 출석인정서류'),
 R('1','unitEvidence','1단위','2026-10-29','u1-ev-1029','10.29'),R('1','unitEvidence','1단위','2026-11-05','u1-ev-1105','11.05'),
 R('1','unit','2단위','','u2','2단위'),R('1','unitSheet','2단위','','u2-sheet','1. 단위기간출석부'),R('1','unitRequest','2단위','','u2-req','2. 출석입력요청대장'),R('1','unitEvidence','2단위','','u2-ev','3. 출석인정서류'),
 R('2','evidence','','','e2-cls','2반 출결인정자료')
];
export const BUILT_AT='2026-10-21T14:23:00+09:00';
export const FOLDERS={builtAt:BUILT_AT,done:true,rows:FOLDER_ROWS};
// 가짜 Apps Script 답: 반으로 거르고, 날짜가 있으면 그날 줄 + 날짜 없는 줄(계약과 같음)
export function driveAnswer(action,p={}){
 if(action==='b2DriveFolders')return {...FOLDERS,rows:FOLDER_ROWS.filter(r=>(!p.cls||r.cls===String(p.cls))&&(!p.date||!r.date||r.date===p.date))};
 if(action==='b2DriveCount'){const C={'1|2026-10-29':{manual:null,evidence:3,photo:500},'1|2026-11-05':{manual:0,evidence:2,photo:null}}[`${p.cls}|${p.date}`]||{};return {cls:p.cls,date:p.date,counts:Object.fromEntries((p.kinds||['photo','evidence','manual']).map(k=>[k,C[k]??null])),max:500};}
 return null;
}
export const url=id=>`https://drive.google.com/drive/folders/${id}`;
