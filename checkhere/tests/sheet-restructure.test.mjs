import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGas,colName} from './gas-fake.mjs';

// 마스터시트 개편(2026-10-16 회의)·민원·이슈 주고받기·교육일정 가져오기를 가짜 Google 서비스로 시험합니다. 학생·담임은 모두 가상입니다.
const CODE=fileURLToPath(new URL('../../apps-script/master/Code.gs',import.meta.url));
const GS=fileURLToPath(new URL('../../apps-script/beta2/beta2.gs',import.meta.url));
const RS=fileURLToPath(new URL('../../apps-script/beta2/restructure.gs',import.meta.url));
const SOURCE='1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34',MASTER='master-test',BACKUP='backup-copy',OWNER='owner@example.com';
const CLASSES=Array.from({length:17},(_,i)=>i+1);
// 시간표 교육일(O): 10/9(금)은 휴일, 주말은 없음
const DAYS=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16'];
const plain=x=>JSON.parse(JSON.stringify(x));
const iso=(gas,v)=>v instanceof Date?gas.formatDate(v,'Asia/Seoul','yyyy-MM-dd'):'';
const tabName=n=>`${n}. 권역${n}_과정${n}`;
const GONE=['운영총괄(1기) 누적관리','학습자평가','만족도평가','반운영정보','시간표'];

// 반 탭: 실제 마스터처럼 가(5~9행)·나(11~13행)·다(15~48행)·라(51~71행)·바(74행)·사(83행)·아(92행)·자(109행)
function boardTab(gas,m,n){
 const sh=m.add(tabName(n),130,64),q=['E','H','K','N','Q'];
 sh.fill(1,1,[[`${n}반 출결판`]]).fill(3,3,[['반 번호',n]]).fill(5,1,[['가. 금주교육']]).fill(6,1,[['일자']]);
 sh.formula(2,2,'=$E$3&"  ·  "&IFERROR(VLOOKUP($D$3&"반",\'반정보\'!$G$4:$M$20,3,FALSE),"")&"  ·  반장 "&IFERROR(VLOOKUP($D$3,\'반운영정보\'!$A$2:$C$18,3,FALSE),"")');
 sh.fill(7,1,[['과목']]).fill(8,1,[['장소']]).fill(9,1,[['만족도']]);
 q.forEach((c,i)=>{const col=5+3*i;sh.formula(6,col,`=$A$2-WEEKDAY($A$2,3)+${i}`);sh.formula(7,col,`=IF(COUNTIFS('시간표'!$A$2:$A,${c}$6,'시간표'!$G$2:$G,"휴일")>0,"휴일","")`);sh.formula(8,col,`=IFERROR(TEXTJOIN(" / ",TRUE,UNIQUE(FILTER('시간표'!$F$2:$F,'시간표'!$A$2:$A=${c}$6))),"")`);sh.formula(9,col,`=IFERROR(LET(s,INDEX(FILTER('시간표'!$H$2:$H,'시간표'!$A$2:$A=${c}$6),1),r,COUNTIFS('만족도응답'!$B:$B,$D$3),s&r),"")`);});
 sh.fill(11,1,[['나. 오늘 출결']]).fill(12,1,[['총원(재학)','출석','결석','지각','조퇴','외출','인정','출석률','중도탈락·조기취업','80% 미만','당일 마감']]).fill(13,11,[['미확인']]);
 sh.formula(13,10,"=COUNTIFS(C17:C48,\"<\"&'교육일자'!$D$2)");
 sh.fill(15,1,[['다. 출결판']]).fill(16,1,[['이름','상태','누적 출석률','증빙 미결']]).fill(17,1,[[`가상${n}가`,'재학']]);
 sh.fill(51,1,[['라. 현장운영 체크리스트  (10/16)']]).fill(52,1,[['시간','내용','','','체크','','구간 상태']]).fill(53,1,[['강의 시작 전','강의 시작 안내문자']]);
 sh.formula(53,7,'=IF(COUNTIF(E53:E58,"미완료")>0,"미완료","미확인")');sh.validate(53,5,{list:['완료','미완료','해당없음']});
 sh.fill(74,1,[['바. 학습자 평가']]).formula(74,5,'=HYPERLINK("#gid=704","학습자평가 탭에서 입력 →")').formula(75,1,`=IFERROR(QUERY('학습자평가'!A2:H,"select B where A="&$D$3,0),"")`);
 sh.fill(83,1,[['사. 만족도 평가']]).formula(84,1,`=IFERROR(QUERY('만족도평가'!A2:G,"select B where A="&$D$3,0),"")`);
 sh.fill(92,1,[['아. 민원·이슈 (VOC & ISSUE LOG)']]).formula(92,5,'=HYPERLINK("#gid=706","민원이슈 탭에서 입력 →")').formula(93,1,`=IFERROR(QUERY('민원이슈'!A2:J,"select A where B="&$D$3,0),"")`);
 sh.fill(109,1,[['자. 출결사유 (가-3)']]).formula(110,1,`=IFERROR(QUERY({'출결원장'!A2:A},"select Col1",0),"")`);
 return sh;
}
function setup({source=false,now='2026-10-16T19:00:00+09:00',tweak=null}={}){
 const gas=createGas({now,files:[CODE,GS,RS]}),d=s=>gas.date(...s.split('-').map(Number));
 gas.ctx.console={log(){},warn(){},error(){}};
 gas.ctx.Session={getActiveUser:()=>({getEmail:()=>OWNER}),getEffectiveUser:()=>({getEmail:()=>OWNER})}; // 편집기에서 소유자가 실행
 const m=gas.book(MASTER,'HINT 운영 마스터시트 (1기 데이터)',true);
 const home=m.add('홈',40,10).fill(1,1,[['HINT 운영 마스터시트']]);
 home.formula(5,2,'=HYPERLINK("#gid=543367414","운영총괄 대시보드")').formula(5,3,'=HYPERLINK("#gid=1296170338","누적관리")').formula(5,4,'=HYPERLINK("#gid=700","출결 입력 (원장)")').formula(5,5,'=HYPERLINK("https://docs.google.com/spreadsheets/d/x/edit","통합 현황판 ↗")');
 [['명부',701],['시간표',702],['교육일자',600],['반정보',1052485790],['만족도응답',703]].forEach(([t,g],i)=>home.formula(15,2+i,`=HYPERLINK("#gid=${g}","${t}")`));
 [['학습자평가',704],['만족도평가',705],['민원·이슈',706],['반운영정보 (반장·비고)',707]].forEach(([t,g],i)=>home.formula(16,2+i,`=HYPERLINK("#gid=${g}","${t}")`));
 home.formula(16,6,'=HYPERLINK("https://script.google.com/macros/s/fake/exec","담임 포털 (외부 접속) ↗")');
 home.fill(18,1,[['① 본사: 반정보 · 명부 · 시간표를 먼저 채웁니다.']]).fill(21,1,[['④ 반별 출결판 · 가-3 · 대시보드 · 누적관리 · 만족도 응답률은 자동으로 바뀝니다.']]);
 m.add('수식백업',20,4).hideSheet();
 m.add('변경이력',200,8).fill(1,1,[['시각','변경자','경로','반','이름','교육일','이전','이후']]);
 const dash=m.add('운영총괄(1기) 대시보드',60,26).fill(1,1,[['운영총괄(1기) 대시보드']]).fill(3,3,[['가. 출결현황']]);
 dash.fill(25,3,[['나. 현장운영 체크리스트']]).fill(26,3,[['권역','분반','마감','강의 전','강의 중','강의 후','','반 번호','지역','과정명','담임','연락처','교육장소']]);
 CLASSES.forEach((n,i)=>{const r=27+i;dash.fill(r,1,[[tabName(n)]]).fill(r,10,[[n+'반']]);dash.formula(6+i,5,`=IFERROR(INDIRECT("'"&$A${6+i}&"'!A13"),"")`);dash.formula(r,5,`=IFERROR(INDIRECT("'"&$A${r}&"'!K13"),"")`);dash.formula(r,6,`=IFERROR(INDIRECT("'"&$A${r}&"'!G53"),"")`);dash.formula(r,11,`='반정보'!H${4+i}`);});
 dash.validate(27,6,{list:['완료','미완료']}); // 10/16 b2SlimSheet를 멈춘 F27 입력 거부 규칙
 m.add('운영총괄(1기) 누적관리',40,24).formula(12,4,`=IFERROR(INDIRECT("'"&'반정보'!$O4&"'!A13"),"")`);
 const ledger=m.add('출결원장',300,20).fill(1,1,[['일자','반','이름','유형']]).formula(1,17,`={"입력 확인";ARRAYFORMULA(IF(COUNTIF('교육일자'!A2:A,A2:A)=0,"교육일 아님",""))}`);
 m.add('명부',800,8).fill(1,1,[['반','이름','번호','상태','상태 변경일','','생년월일','성별']]).fill(2,1,CLASSES.map(n=>[n,`가상${n}가`,'','재학','','',d('2000-01-01'),'남성']));
 const tt=m.add('시간표',1500,8).fill(1,1,[['일자','대상','구분','과목','강사','장소','교육일','설문명']]);
 tt.fill(2,1,[...DAYS.slice(0,4).map(x=>[d(x),'전체','','','','','O']),[d('2026-10-09'),'전체','','','','','휴일'],...DAYS.slice(4).map(x=>[d(x),'전체','','','','','O'])]);
 m.add('만족도응답',100,6).fill(1,1,[['타임스탬프','반','설문명','비고']]);
 m.add('반운영정보',40,7).fill(1,1,[['반','반명','반장','부반장','총무','비고','수정일']]).fill(2,1,CLASSES.map(n=>n===1?[1,'권역1 과정1','가상반장','','','9/1 반장 바뀜',d('2026-09-01')]:[n,`권역${n} 과정${n}`]));
 m.add('학습자평가',600,9).fill(1,1,[['반','평가일','평가 과목','응시인원','평균점수','최고점','최저점','비고','반명']]);
 m.add('만족도평가',800,8).fill(1,1,[['반','평가 기간','구분','강사명','점수평균','응답수','비고','반명']]);
 const voc=m.add('민원이슈',1000,10).fill(1,1,[['접수일자','반','','','민원유형','상세내용','처리상태','조치내용','처리일','']]);
 voc.formula(1,3,'={"권역";ARRAYFORMULA(IF(B2:B="","",B2:B))}').formula(1,4,'={"분반";ARRAYFORMULA(IF(B2:B="","",B2:B))}').formula(1,10,'={"경과일";ARRAYFORMULA(IF(A2:A="","",TODAY()-A2:A))}');
 const info=m.add('반정보',1000,33).fill(1,7,[['반정보']]).fill(2,7,[['반별 정보를 입력하면 대시보드·누적관리·반별 시트에 자동 반영됩니다.']]).fill(3,7,[['반 번호','지역','과정명','최종 고용24 등록 명칭','담임','연락처','교육장소','최종확인 배송주소','시트명','포털 PIN']]);
 info.fill(4,7,CLASSES.map(n=>[n+'반',`권역${n}`,`과정${n}`,'',`가상담임${n}`,'',`장소${n}`,'',tabName(n),n===1?'4321':'']));
 const days=m.add('교육일자',200,6).fill(1,1,[['교육일자','','운영 기준']]).fill(2,3,[['수료 기준 출석률',0.8],['오늘',d('2026-10-16')],['실시 교육일수',DAYS.length],['메인 교육일',d('2026-10-16')]]);
 days.fill(2,1,DAYS.map(x=>[d(x)])).formula(2,1,`=IFERROR(SORT(UNIQUE(FILTER('시간표'!A2:A, '시간표'!G2:G="O", '시간표'!A2:A<>""))),"")`).formula(3,4,'=TODAY()');
 days.getRange('A2').setNumberFormat('yyyy/mm/dd (ddd)');
 const boards={};CLASSES.forEach(n=>{boards[n]=boardTab(gas,m,n);});
 m.add('서류발급',200,18).fill(1,1,[['신청번호']]);
 m.add('교육생정보',800,5);
 // 개편 전에 만드는 사본(파일 → 사본 만들기). 탭 이름만 같으면 됩니다.
 const copy=gas.book(BACKUP,'마스터 사본');m.sheets.forEach(s=>copy.add(s.name,5,5));
 // 교육일자 A2 배열 수식 계산 흉내: 수식을 새로 쓰면 그 수식이 가리키는 탭(교육일정 C열 O, 또는 시간표 G열 O)으로 A열을 다시 채웁니다.
 gas.hooks.push({when:e=>e.op==='write'&&e.range.sh.name==='교육일자'&&e.range.r<=2&&e.range.r+e.range.nr>2&&e.range.c===1,run:()=>{
  const f=days.getRange('A2').getFormula(),list=[];
  if(/교육일정/.test(f)){const s=m.getSheetByName('교육일정');for(let r=9;r<=s.getLastRow();r++)if(s.get(r,3)==='O')list.push(s.get(r,1));}
  else for(let r=2;r<=tt.getLastRow();r++)if(tt.get(r,7)==='O')list.push(tt.get(r,1));
  for(let r=2;r<200;r++)days.put(r,1,'',true);
  (tweak?.days?tweak.days(list):list).forEach((v,i)=>days.put(2+i,1,v,true));
 }});
 if(source){
  const src=gas.book(SOURCE,'1기 운영총괄');
  src.add('반정보',30,20).fill(4,7,CLASSES.map(n=>[n+'반',`권역${n}`,`과정${n}`]));
  src.add('서류발급요청',10,12);
  src.add('전국 교육일정관리',80,72).fill(3,1,[['교육장소','',...CLASSES.flatMap(n=>[`${n}.과정${n}(장소${n})`,'','',''])]])
   .fill(32,1,[['날짜','요일',...CLASSES.flatMap(()=>['분야','시간','강사','강사연락처'])]])
   .fill(33,1,[['2026-10-12','월',...CLASSES.flatMap(n=>n===2?['직무특화','6','가상강사','010-0000-0000']:['직무특화','8',`가상강사${n}`,'010-0000-0000'])]])
   .fill(34,1,[['2026-10-13','화','소프트스킬','8','가상강사A','']])
   .fill(35,1,[['2026-10-13','화','HINT 골든벨','2','','']])
   .fill(36,1,[['2026-10-17','토','공장견학','8','가상인솔','']]);
 }else gas.scriptProps.setProperty('B2_SOURCE_ID','none');
 gas.scriptProps.setProperty('B2_REV','5');
 return {gas,m,home,dash,ledger,tt,voc,info,days,boards,copy,d};
}
const restructure=env=>{env.gas.scriptProps.setProperty('B2_RESTRUCTURE_BACKUP',BACKUP);return plain(env.gas.call('b2RestructureSheet'));};

test('b2RestructureCheck only reads: it lists the rows, tabs and days it would change and finds nothing blocking on a sheet like the live one',()=>{
 const env=setup(),{gas}=env;gas.resetLog();
 const s=plain(gas.call('b2RestructureCheck'));
 assert.deepEqual(gas.log.writes,[]);
 assert.equal(s.ready,true,JSON.stringify(s.blocked));
 assert.equal(s.boards.length,17);assert.equal(s.boards[0],'1반 51~91행 지움');
 assert.deepEqual([s.officerMoved,s.scheduleRows,s.teachingDays,s.home,s.backup],[1,10,9,true,'없음'],'10 weekday rows (10/9 holiday kept), 9 teaching days');
 assert.deepEqual(s.dropTabs,[...GONE,'수식백업']);
});

test('the sheet is restructured in one locked run: 반정보 Q~U, 교육일정 tab, class tabs, dashboard, home, then the old tabs go',()=>{
 const env=setup(),{gas,m,info,days,boards,dash,home}=env;
 assert.throws(()=>gas.call('b2RestructureSheet'),/사본 만들기/,'a backup copy is required first');
 gas.scriptProps.setProperty('B2_RESTRUCTURE_BACKUP',MASTER);assert.throws(()=>gas.call('b2RestructureSheet'),/이 파일 ID/);
 gas.resetLog();const r=restructure(env);
 assert.equal(r.ok,true);assert.deepEqual(gas.log.outsideLock,[],'every write happens inside the document lock');
 assert.deepEqual([r.boards,r.rowsDeleted,r.officer,r.scheduleDays,r.teachingDays],[17,17*41,1,10,9]);
 // 1. 반정보 Q~U
 assert.deepEqual(info.rows(3,17,2,5),[['반장','부반장','총무','반 운영 비고','반 운영 수정일'],['가상반장','','','9/1 반장 바뀜',gas.date(2026,9,1)]]);
 assert.match(info.get(2,7),/Q~U열/);
 // 2. 교육일정: 운영 기준·반 이름·머리글·날짜(주말 제외, 10/9 휴일)
 const s=m.getSheetByName('교육일정');assert.ok(s,'교육일정 tab');
 assert.equal(m.sheets.indexOf(s),m.sheets.indexOf(info)+1,'placed right after 반정보');
 assert.deepEqual(s.rows(4,4,1,3)[0],['수료 기준 출석률',0.8,'오늘']);
 assert.equal(s.getRange(4,11).getFormula(),"='교육일자'!$D$5");
 assert.match(s.getRange(7,4).getFormula(),/"1반 · "&IFERROR\(VLOOKUP\("1반"/);assert.match(s.getRange(7,36).getFormula(),/"17반 · "/);
 assert.deepEqual(s.rows(8,1,1,6)[0],['날짜','요일','교육일','분야','강사','분야']);assert.equal(s.get(8,37),'강사');
 const rows=s.rows(9,1,10,3).map(([a,b,c])=>[iso(gas,a),b,c]);
 assert.deepEqual(rows,[['2026-10-05','월','O'],['2026-10-06','화','O'],['2026-10-07','수','O'],['2026-10-08','목','O'],['2026-10-09','금','휴일'],['2026-10-12','월','O'],['2026-10-13','화','O'],['2026-10-14','수','O'],['2026-10-15','목','O'],['2026-10-16','금','O']]);
 // 교육일자: 숨김, A2는 교육일정 C열, D2는 교육일정 수료 기준. 날짜 목록은 그대로
 assert.equal(days.isSheetHidden(),true);
 assert.equal(days.getRange('A2').getFormula(),`=IFERROR(SORT(UNIQUE(FILTER('교육일정'!A9:A, '교육일정'!C9:C="O", '교육일정'!A9:A<>""))),"")`);
 assert.equal(days.getRange('D2').getFormula(),"='교육일정'!$E$4");
 assert.deepEqual(days.rows(2,1,9,1).flat().map(v=>iso(gas,v)),DAYS);
 // 3. 반 탭
 const b3=boards[3];
 assert.match(b3.getRange('B2').getFormula(),/반장 "&IFERROR\(VLOOKUP\(\$D\$3&"반",'반정보'!\$G\$4:\$Q\$20,11,FALSE\),""\)$/);
 assert.equal(b3.get(8,1),'강사');assert.deepEqual(b3.rows(9,1,1,19)[0].filter(Boolean),[],'만족도 row cleared');assert.equal(b3.getRange(9,5).getFormula(),'');
 const col=colName(4+(3-1)*2); // 3반 분야 = H열
 assert.equal(b3.getRange(7,5).getFormula(),`=IF(COUNTIFS('교육일정'!$A$9:$A,E$6,'교육일정'!$C$9:$C,"휴일")>0,"휴일",IF(COUNTIF('교육일자'!$A$2:$A,E$6)=0,"교육 없음",IFERROR(TEXTJOIN(" / ",TRUE,FILTER('교육일정'!$${col}$9:$${col},'교육일정'!$A$9:$A=E$6)),"")))`);
 assert.match(b3.getRange(8,17).getFormula(),/'교육일정'!\$I\$9:\$I/,'강사 column next to 분야, Q is the 5th day');
 assert.equal(b3.get(51,1),'아. 민원·이슈 (VOC & ISSUE LOG)','라·바·사 rows are gone and 아 moved up from 92 to 51');
 assert.equal(b3.get(68,1),'자. 출결사유 (가-3)');assert.equal(b3.get(17,1),'가상3가','the board rows stay');
 assert.match(b3.getRange(51,5).getFormula(),/민원이슈 탭 보기 \(주고받기는 운영포털\)/);
 // 4. 대시보드 나 구역
 assert.equal(dash.get(25,3),'나. 누적 출결현황 · 반 운영');
 assert.deepEqual(dash.rows(26,5,1,4)[0],['누적 출석률','누적 결석률','미수료(80%미만)','당일 마감']);assert.deepEqual(dash.rows(26,16,1,2)[0],['반장','민원 미처리']);
 assert.deepEqual(['E','F','G','H','P','Q'].map(c=>dash.getRange(c+'28').getFormula()),[`=IFERROR(AVERAGE('${tabName(2)}'!C17:C48),"")`,'=IF(E28="","",1-E28)',`=IFERROR('${tabName(2)}'!J13,"")`,`=IFERROR('${tabName(2)}'!K13,"")`,"='반정보'!Q5",`=COUNTIFS('민원이슈'!$B$2:$B,2,'민원이슈'!$G$2:$G,"<>완료",'민원이슈'!$G$2:$G,"<>해당없음")`]);
 assert.equal(dash.getRange('F27').getDataValidation(),null,'the F27 reject rule is gone');
 assert.equal(dash.get(44,3),'총계');assert.equal(dash.getRange('Q44').getFormula(),'=SUM(Q27:Q43)');
 // 5. 홈
 const gid=m.getSheetByName('교육일정').getSheetId();
 assert.deepEqual(home.getRange(5,2,1,4).getFormulas()[0].map(f=>f.match(/"([^"]+)"\)$/)[1]),['운영총괄 대시보드','출결 입력 (원장)','교육일정','통합 현황판 ↗']);
 assert.deepEqual(home.getRange(15,2,2,5).getFormulas().flat().filter(Boolean).map(f=>f.match(/"([^"]+)"\)$/)[1]),['명부','교육일정','반정보 (반장·비고 포함)','민원·이슈','만족도응답','서류발급','담임 포털 (외부 접속) ↗']);
 assert.equal(home.getRange(15,3).getFormula(),`=HYPERLINK("#gid=${gid}","교육일정")`);
 assert.doesNotMatch(home.get(21,1),/누적관리/);
 // 6. 지운 탭·남은 탭·민원이슈 머리글·속성
 for(const t of [...GONE,'수식백업'])assert.equal(m.getSheetByName(t),null,t);
 assert.ok(m.getSheetByName('만족도응답'),'만족도응답 stays (만족도 보류)');
 assert.deepEqual(env.voc.rows(1,11,1,6)[0],['번호','접수자','주고받은 기록','마지막 글','마지막 글 시각','담임 확인 시각']);
 assert.equal(JSON.parse(gas.scriptProps.getProperty('B2_RESTRUCTURE')).backup,BACKUP);assert.equal(gas.scriptProps.getProperty('B2_REV'),'6');
 assert.throws(()=>gas.call('b2RestructureSheet'),/이미 개편/,'it runs only once');
});

test('if the teaching days would change, the 교육일자 formula is put back, the new tab removed and nothing else is touched',()=>{
 const env=setup({tweak:{days:list=>list.slice(1)}}),{gas,m,days,boards}=env;
 env.gas.scriptProps.setProperty('B2_RESTRUCTURE_BACKUP',BACKUP);
 assert.throws(()=>gas.call('b2RestructureSheet'),/교육일자 날짜 목록이 달라져.*마친 단계: 반정보 반장 칸, 교육일정 탭, 교육일자 연결/);
 assert.match(days.getRange('A2').getFormula(),/'시간표'!A2:A/);assert.equal(days.getRange('D2').getFormula(),'');assert.equal(days.get(2,4),0.8);
 assert.equal(m.getSheetByName('교육일정'),null);
 for(const t of GONE)assert.ok(m.getSheetByName(t),t+' kept');
 assert.deepEqual(env.info.rows(3,17,2,5).flat().filter(Boolean),[],'반정보 Q~U emptied again so the run can be repeated');
 assert.equal(plain(gas.call('b2RestructureCheck')).blocked.some(x=>/Q3:U3/.test(x)),false);
 assert.equal(boards[1].get(92,1),'아. 민원·이슈 (VOC & ISSUE LOG)','class tabs untouched');
 assert.equal(gas.scriptProps.getProperty('B2_RESTRUCTURE'),null);
});

test('the check blocks instead of guessing: a formula elsewhere still pointing at 시간표, timetable content, data in 학습자평가, a missing backup tab, slim on',()=>{
 let env=setup();env.ledger.formula(1,19,`=COUNTA('시간표'!A:A)`);
 assert.match(plain(env.gas.call('b2RestructureCheck')).blocked.join(),/지울 탭을 참조하는 수식이 1칸.*출결원장!S1→시간표/);
 env=setup();env.tt.put(3,4,'자동차개론',true);
 assert.match(plain(env.gas.call('b2RestructureCheck')).blocked.join(),/과목·강사·장소·설문명이 적힌 줄이 1개/);
 env=setup();env.m.getSheetByName('학습자평가').fill(2,1,[[1,'2026-10-01','과목',20]]);
 assert.match(plain(env.gas.call('b2RestructureCheck')).blocked.join(),/'학습자평가' 탭에 자료가 1줄/);
 env=setup();env.copy.sheets.splice(env.copy.sheets.findIndex(s=>s.name==='시간표'),1);env.gas.scriptProps.setProperty('B2_RESTRUCTURE_BACKUP',BACKUP);
 assert.throws(()=>env.gas.call('b2RestructureSheet'),/백업 사본에 '시간표' 탭이 없습니다/);
 env=setup();env.gas.scriptProps.setProperty('B2_SLIM','1');
 assert.match(plain(env.gas.call('b2RestructureCheck')).blocked.join(),/시트 다듬기\(B2_SLIM=1\)/);
 env=setup();env.boards[5].put(83,1,'',true);
 assert.match(plain(env.gas.call('b2RestructureCheck')).blocked.join(),/5\. 권역5_과정5: '라\.·바\.·사\.·아\.' 구역을 찾지 못했습니다/);
});

test('a web-app visitor cannot run the restructure functions',()=>{
 const env=setup();env.gas.ctx.Session={getActiveUser:()=>({getEmail:()=>''}),getEffectiveUser:()=>({getEmail:()=>OWNER})};
 for(const f of ['b2RestructureCheck','b2RestructureSheet'])assert.throws(()=>env.gas.call(f),/편집기/);
});

test('Code.gs before and after the restructure: officer from 반운영정보 then 반정보 Q~U, week from 시간표 then 교육일정, no checklist or evaluations',()=>{
 const env=setup(),{gas,info}=env;
 gas.run("__API = true");
 let d=plain(gas.call('portalData',1,''));
 assert.deepEqual([d.checks,d.evals,d.sats],[[],[],[]],'old Portal.html still gets empty lists');
 assert.equal(d.officer.leader,'가상반장');
 assert.equal(typeof gas.ctx.portalCheck,'undefined','현장운영 체크리스트 save is gone');
 assert.throws(()=>gas.call('portalAddRow',1,'','EVAL',{subj:'x'}),/없어졌습니다/);
 restructure(env);gas.run("__API = true");
 d=plain(gas.call('portalData',1,''));
 assert.equal(d.officer.leader,'가상반장','read from 반정보 Q after the merge');
 gas.call('portalSaveOfficer',2,'',{leader:'가상2반장',sub:'',treasurer:'',note:'새로'});
 assert.deepEqual(info.rows(5,17,1,4)[0],['가상2반장','','','새로']);assert.ok(info.get(5,21) instanceof Date);
 const s=env.m.getSheetByName('교육일정');s.fill(15,4,[['직무특화','가상강사1']]); // 10/13(화) 1반
 const week=plain(gas.call('portalData',1,'')).week;
 assert.deepEqual(week.map(w=>[w.date,w.off,w.subj,w.place]),[['2026-10-12',false,'',''],['2026-10-13',false,'직무특화','가상강사1'],['2026-10-14',false,'',''],['2026-10-15',false,'',''],['2026-10-16',false,'','']]);
});

test('editing 교육일정 redraws boards only when the teaching-day column changes; editing 민원이슈 only recounts the alerts',()=>{
 const env=setup();restructure(env);const {gas,m}=env,s=m.getSheetByName('교육일정');
 const boardWrites=()=>gas.log.writes.filter(w=>/^\d+\. 권역/.test(w.sheet)).length;
 gas.resetLog();gas.call('onEdit',{range:s.getRange('E12')});
 assert.equal(boardWrites(),0,'분야·강사 edit');assert.equal(gas.scriptProps.getProperty('B2_REV'),'6');
 gas.resetLog();gas.call('onEdit',{range:s.getRange('C13')});
 assert.ok(boardWrites()>0,'교육일 edit redraws');assert.equal(gas.scriptProps.getProperty('B2_REV'),'7');
 env.voc.fill(2,1,[[gas.date(2026,10,16),3,'','','안전','가상 사고']]);
 gas.resetLog();gas.call('onEdit',{range:env.voc.getRange('F2')});
 assert.equal(JSON.parse(gas.scriptProps.getProperty('B2_VOC_STATE')).admin,1);assert.equal(gas.scriptProps.getProperty('B2_REV'),'7','no attendance bump');
});

const as=(gas,email,role)=>gas.run(`__ACTOR = ${JSON.stringify(email)}; __ACTOR_ROLE = ${JSON.stringify(role)};`);
const state=gas=>JSON.parse(gas.scriptProps.getProperty('B2_VOC_STATE'));

test('민원·이슈 goes back and forth: a teacher files it (mail to the office), the office replies and changes the status, the teacher sees it',()=>{
 const env=setup(),{gas,voc}=env;
 as(gas,'teacher3@example.com','TEACHER');gas.resetLog();
 const c=plain(gas.call('b2VocCreate_',{cls:'3',type:'시설·환경',detail:'가상 강의장 냉방\n고장',side:'운영'}));
 assert.deepEqual([c.id,c.mailed,c.state.admin,c.state.open],['V261016-001',true,1,{'3':1}],'a teacher account always writes as 담임');
 assert.deepEqual(gas.log.outsideLock,[]);
 assert.deepEqual(voc.rows(2,1,1,9)[0].map((v,i)=>i===0?iso(gas,v):v),['2026-10-16',3,'','','시설·환경','가상 강의장 냉방\n고장','접수','','']);
 assert.equal(voc.getRange('C1').getFormula().startsWith('={"권역"'),true,'array formulas in C·D·J are left alone');
 assert.deepEqual(voc.rows(1,11,2,4),[['번호','접수자','주고받은 기록','마지막 글'],['V261016-001','teacher3@example.com','','담임']]);
 const mail=gas.log.mails[0];assert.equal(mail.to,'hint.kpc@gmail.com,kpc.jtkim@gmail.com');assert.match(mail.subject,/^\[HINT 민원·이슈\] 3반 · 시설·환경 · 새 접수$/);assert.match(mail.body,/가상담임3/);
 assert.equal(gas.scriptProps.getProperty('B2_REV'),'5','attendance screens are not made to reload');
 // 담임은 작성자 이메일을 보지 않음, 운영은 봄
 assert.equal(plain(gas.call('b2Vocs_',{cls:'3'})).rows[0].author,'');
 as(gas,'hint.kpc@gmail.com','ADMIN');
 const list=plain(gas.call('b2Vocs_',{}));assert.equal(list.rows[0].author,'teacher3@example.com');assert.deepEqual(list.statuses,['접수','처리중','완료','보류']);
 assert.equal(plain(gas.call('b2Rev_')).voc.admin,1,'b2Rev carries the counts without reading the sheet');
 // 운영 답글 + 처리중
 gas.advance(60000);gas.resetLog();
 const r=plain(gas.call('b2VocReply_',{key:'V261016-001',text:'내일 수리 기사 방문',status:'처리중'}));
 assert.deepEqual([r.ok,r.mailed,r.state.admin,r.state.teacher],[true,false,0,{'3':1}]);
 assert.deepEqual(voc.rows(2,7,1,3)[0],['처리중','내일 수리 기사 방문','']);
 const t=plain(gas.call('b2Vocs_',{})).rows[0].thread;
 assert.deepEqual(t.map(x=>[x.at,x.side,x.who,x.text]),[['2026-10-16 19:01','운영','hint.kpc@gmail.com','처리 상태: 접수 → 처리중'],['2026-10-16 19:01','운영','hint.kpc@gmail.com','내일 수리 기사 방문']]);
 // 관리자가 담임 화면 미리보기에서 열면 담임 알림은 그대로, 담임이 열어 봐야 꺼짐. 다른 반 담임은 못 건드림
 assert.equal(plain(gas.call('b2VocSeen_',{key:'V261016-001',side:'담임'})).unchanged,true);assert.deepEqual(state(gas).teacher,{'3':1});
 as(gas,'teacher7@example.com','TEACHER');
 assert.throws(()=>gas.call('b2VocSeen_',{key:'V261016-001',cls:'7'}),/다른 반/);
 as(gas,'teacher3@example.com','TEACHER');gas.advance(60000);
 assert.deepEqual(plain(gas.call('b2VocSeen_',{key:'V261016-001',cls:'3'})).state.teacher,{});
 assert.equal(plain(gas.call('b2VocSeen_',{key:'V261016-001',cls:'3'})).unchanged,true,'only once');
 // 담임 답글(메일) → 운영 답변 대기, 운영이 완료 → 처리일
 gas.advance(60000);gas.resetLog();
 assert.equal(plain(gas.call('b2VocReply_',{key:'V261016-001',cls:'3',text:'감사합니다.\n오후에 확인 부탁드려요'})).mailed,true);
 assert.match(gas.log.mails[0].subject,/답글$/);assert.equal(state(gas).admin,1);
 as(gas,'hint.kpc@gmail.com','ADMIN');gas.advance(60000);
 plain(gas.call('b2VocReply_',{key:'V261016-001',status:'완료'}));
 assert.equal(voc.get(2,7),'완료');assert.equal(iso(gas,voc.get(2,9)),'2026-10-16');assert.equal(voc.get(2,8),'내일 수리 기사 방문','a status-only change keeps the last answer');
 assert.deepEqual([state(gas).admin,state(gas).open,state(gas).teacher],[0,{},{'3':1}],'closed, and the teacher has news (the status change)');
 const lines=String(voc.get(2,13)).split('\n');assert.equal(lines.length,4);assert.match(lines[2],/^\[2026-10-16 19:03 담임 teacher3@example.com\] 감사합니다\. ↵ 오후에 확인 부탁드려요$/);
});

test('an admin previewing the teacher screen can write as 담임; old rows without a number are answered by row and signature and get one',()=>{
 const env=setup(),{gas,voc}=env;
 voc.fill(2,1,[[gas.date(2026,10,10),5,'','','출결','가상 예전 접수','접수','','']]); // 예전 담임 포털로 들어온 기록
 as(gas,'kpc.jtkim@gmail.com','ADMIN');
 assert.equal(plain(gas.call('b2VocCreate_',{cls:'5',type:'기타',detail:'미리보기에서 써 봄',side:'담임'})).mailed,true);
 const rows=plain(gas.call('b2Vocs_',{cls:'5'})).rows,old=rows.find(r=>!r.id);
 assert.deepEqual([old.key,old.lastBy,old.sig.length>0],['R2','담임',true]);assert.equal(state(gas).admin,2,'the old open row counts as waiting');
 assert.throws(()=>gas.call('b2VocReply_',{key:'R2',sig:'wrong',text:'x'}),/찾지 못했습니다/);
 const r=plain(gas.call('b2VocReply_',{key:'R2',sig:old.sig,text:'확인했습니다'}));
 assert.equal(r.id,'V261016-002');assert.equal(voc.get(2,11),'V261016-002');assert.equal(state(gas).admin,1);
 for(const [p,re] of [[{cls:'18',type:'기타',detail:'x'},/반을 골라/],[{cls:'5',type:'없는 유형',detail:'x'},/유형/],[{cls:'5',type:'기타',detail:' '},/내용을/],[{cls:'5',type:'기타',detail:'가'.repeat(2001)},/2000자/]])assert.throws(()=>gas.call('b2VocCreate_',p),re);
 assert.throws(()=>gas.call('b2VocReply_',{key:'V261016-002'}),/답글이나 처리 상태/);
});

test('the old teacher portal (Portal.html) still files 민원·이슈 and the alert counts follow',()=>{
 const env=setup(),{gas}=env;gas.run("__API = true");
 gas.call('portalAddRow',4,'','VOC',{date:'2026-10-16',type:'안전',detail:'가상 예전 화면 접수',status:'접수'});
 assert.equal(state(gas).admin,1);
 gas.call('portalUpdateVoc',4,'',2,{status:'완료',action:'조치함'});
 assert.equal(state(gas).admin,0);
});

test('운영총괄 교육일정표 fills each class\'s 분야·강사 on the next sync, only where it changed, never the 교육일 column',()=>{
 const env=setup({source:true}),{gas,m}=env;
 restructure(env);
 const s=m.getSheetByName('교육일정');
 assert.equal(s.get(14,4),'직무특화','the restructure already filled it once from the source (10/12 is row 14)');
 s.put(14,4,'',true);s.put(12,3,'휴일',true); // 누가 10/12 1반 분야를 지움 · 10/8 교육일을 바꿈
 gas.resetLog();const r=plain(gas.call('b2SyncNow_',{}));
 assert.equal(r.sched,1,JSON.stringify(r.warnings));
 assert.deepEqual(s.rows(14,4,1,4)[0],['직무특화','가상강사1','직무특화 (6시간)','가상강사']);
 assert.deepEqual(s.rows(15,4,1,4)[0],['소프트스킬 / HINT 골든벨 (2시간)','가상강사A','',''],'two source rows on one day are joined; a class without an entry that day is blank');
 assert.equal(s.get(12,3),'휴일','교육일 stays as the master set it');
 assert.match(r.warnings.join(),/교육일정 탭에 없는 날짜 1개.*2026-10-17/);
 assert.ok(gas.scriptProps.getProperty('B2_SRC_SCHED'));
 gas.resetLog();const again=plain(gas.call('b2SyncNow_',{}));
 assert.equal(gas.log.writes.filter(w=>w.sheet==='교육일정').length,0,'unchanged source → no write');assert.equal(again.sched||0,0);
 assert.throws(()=>gas.call('b2ParseSchedule_',[['x']]),/'날짜' 머리글 줄/);
});
