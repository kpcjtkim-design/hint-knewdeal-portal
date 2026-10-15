import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGas} from './gas-fake.mjs';

// 시트 다듬기(beta2.gs b2SlimSheet): 출결원장 Q열·반 탭 C/D열 수식을 값으로, 대시보드 INDIRECT를 직접 참조로 바꾸고 되돌리기.
// beta2.gs와 Code.gs를 한 프로젝트처럼 같이 불러 가짜 Google 서비스로 돌립니다. 학생은 모두 가상입니다.
const GS=fileURLToPath(new URL('../../apps-script/beta2/beta2.gs',import.meta.url));
const CODE=fileURLToPath(new URL('../../apps-script/master/Code.gs',import.meta.url));
const DAYS=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
const CLASSES=Array.from({length:17},(_,i)=>String(i+1));
const plain=x=>JSON.parse(JSON.stringify(x));

// 시트에 있는 그대로의 수식(2026-10-15 운영 시트)
const Q1F=`={"입력 확인";ARRAYFORMULA(IF(A2:A="","",TRIM(IF(COUNTIF(N2:N,N2:N)>1,"중복 기록 · ","")&IF(((D2:D="지각")+(D2:D="인정지각"))*(E2:E=""),"입실 시간 없음 · ","")&IF(((D2:D="조퇴")+(D2:D="인정조퇴"))*(F2:F=""),"퇴실 시간 없음 · ","")&IF(((D2:D="외출")+(D2:D="인정외출"))*((G2:G="")+(H2:H="")),"외출 구간 없음 · ","")&IF((D2:D="지각")*(E2:E<>"")*(E2:E<=TIME(9,10,0)),"09:10까지는 지각 아님 · ","")&IF((D2:D="조퇴")*(F2:F<>"")*(F2:F>=TIME(17,50,0)),"17:50 이후는 조퇴 아님 · ","")&IF((G2:G<>"")*(H2:H<>"")*(H2:H<=G2:G),"외출 종료가 시작보다 빠름 · ","")&IF((E2:E<>"")*(F2:F<>"")*(F2:F<=E2:E),"퇴실이 입실보다 빠름 · ","")&IF((LEFT(D2:D,2)="인정")*(I2:I=""),"인정 사유 없음 · ","")&IF((J2:J="반려")*(K2:K=""),"반려 사유 없음 · ","")&IF(COUNTIF('교육일자'!A2:A,A2:A)=0,"교육일 아님 · ","")&IF(COUNTIF('명부'!F2:F,B2:B&"|"&C2:C)=0,"명부에 없는 이름 · ",""))))}`;
const N1F=`={"키";ARRAYFORMULA(IF(A2:A="","",B2:B&"|"&C2:C&"|"&A2:A))}`;
const O1F=`={"증빙(적용)";ARRAYFORMULA(IF(A2:A="","",IF(J2:J<>"",J2:J,IF(LEFT(D2:D,2)="인정","미제출","해당없음"))))}`;
const C17F=`=ARRAYFORMULA(IF(A17:A48="","",IF('교육일자'!$D$4=0,"",('교육일자'!$D$4-COUNTIFS('출결원장'!$B:$B,$D$3,'출결원장'!$C:$C,A17:A48,'출결원장'!$D:$D,"결석",'출결원장'!$A:$A,"<="&$A$2))/'교육일자'!$D$4)))`;
const D17F=`=ARRAYFORMULA(IF(A17:A48="","",COUNTIFS('출결원장'!$B:$B,$D$3,'출결원장'!$C:$C,A17:A48,'출결원장'!$O:$O,"미제출")+COUNTIFS('출결원장'!$B:$B,$D$3,'출결원장'!$C:$C,A17:A48,'출결원장'!$O:$O,"반려")))`;
const DASH='운영총괄(1기) 대시보드',CUM='운영총괄(1기) 누적관리';

function base(){
 const gas=createGas({now:'2026-10-14T10:00:00+09:00',files:[GS,CODE],parseTimes:true});
 const d=iso=>gas.date(...iso.split('-').map(Number)),t=(h,m,s=0)=>new gas.FakeDate(1899,11,30,h,m,s);
 const ser=gas.call('b2SerialFn_','Asia/Seoul'),rowsOf=v=>gas.call('b2SheetRows_',v,ser);
 return {gas,d,t,ser,rowsOf,tabs:gas.run('B2.SOURCE_TABS')};
}
const names=c=>['가','나','다','라'].map(n=>`가상${c}${n}`);
// 행: [A일자, B반, C이름, D유형, E입실, F퇴실, G외출시작, H외출종료, I사유, J증빙, K반려사유] → 기대 Q
function ledgerFixture({d,t}){
 const L=(date,cls,name,type,x={})=>[d(date),cls,name,type,x.e??'',x.f??'',x.g??'',x.h??'',x.i??'',x.j??'',x.k??''];
 return [
  [L('2026-10-06',1,'가상1가','결석'),''],
  [L('2026-10-07',1,'가상1나','결석'),''],
  [L('2026-10-07',1,'가상1가','인정출석',{i:'면접'}),''],
  [L('2026-10-08',1,'가상1라','지각',{e:t(9,20),i:'교통'}),'중복 기록 ·'],
  [L('2026-10-08',1,'가상1나','결석'),''],
  [L('2026-10-12',2,'가상2가','지각'),'입실 시간 없음 ·'],
  [L('2026-10-12',1,'가상1다','인정지각'),'입실 시간 없음 · 인정 사유 없음 ·'],
  [L('2026-10-08',1,'가상1라','지각',{e:t(9,30),i:'교통'}),'중복 기록 ·'],
  [L('2026-10-10',2,'가상2나','결석'),'교육일 아님 ·'],
  [L('2026-10-13',2,'없는학생','결석'),'명부에 없는 이름 ·'],
  [L('2026-10-13',1,'가상1나','인정출석',{i:'병원',j:'반려'}),'반려 사유 없음 ·'],
  [L('2026-10-13',1,'가상1다','조퇴',{f:t(17,50)}),'17:50 이후는 조퇴 아님 ·'],
  [L('2026-10-15',1,'가상1가','결석'),'']
 ];
}
// 운영 마스터시트를 흉내 낸 시트: 수식 칸에는 수식과 (지금 시트가 보여 주는) 결과 값을 같이 둡니다.
function master(){
 const env=base(),{gas,d,tabs,rowsOf}=env;
 const m=gas.book('master-test','마스터',true);
 m.add('홈',50,10);
 const days=m.add('교육일자',200,6).fill(1,1,[['교육일']]).fill(2,1,DAYS.map(x=>[d(x)]))
  .formula(3,4,'=TODAY()').formula(4,4,'=COUNTIFS(A2:A100,"<="&D5)').formula(5,4,'=IFERROR(MAX(FILTER(A2:A100,A2:A100<>"",A2:A100<=D3)),MIN(A2:A100))')
  .fill(3,4,[[d('2026-10-14')],[7],[d('2026-10-14')]]);
 const roster=m.add('명부',800,8).fill(1,1,[['반','이름','번호','상태','상태 변경일','','생년월일','성별']]).formula(1,6,'={"키";ARRAYFORMULA(IF(B2:B="","",A2:A&"|"&B2:B))}');
 const people=[];for(const c of CLASSES)for(const n of names(c))people.push([Number(c),n,'',n==='가상1나'?'중도탈락':'재학',n==='가상1나'?d('2026-10-08'):'']);
 roster.fill(2,1,people);
 const fx=ledgerFixture(env),ledger=m.add('출결원장',300,20)
  .fill(1,1,[['일자','반','이름','유형','입실','퇴실','외출시작','외출종료','사유','증빙','반려사유','메모','코드','키','증빙(적용)','','입력 확인','출처','동기화 지문','동기화 확인']])
  .formula(1,14,N1F).formula(1,15,O1F).formula(1,17,Q1F);
 fx.forEach(([r,q],i)=>{ledger.fill(2+i,1,[r]);ledger.fill(2+i,17,[[q]]);});
 m.add('변경이력',200,8).fill(1,1,[['시각','변경자','경로','반','이름','교육일','이전','이후']]);
 m.add('반정보',30,20).fill(4,7,CLASSES.map(c=>[c+'반','지역'+c,'과정'+c,'','담임'+c,'','','',tabs[c]]));
 m.add('시간표',100,8);m.add('서류발급',50,18).fill(1,1,[['신청번호']]);m.add('교육생정보',50,4);
 // 반 탭: 지금 수식 결과(C·D)를 손으로 계산한 값으로 채움(가상1나는 10/08 중도탈락)
 const want={'가상1가':[6/7,1],'가상1나':[5/7,1],'가상1다':[1,1],'가상1라':[1,0],'가상2나':[6/7,0]};
 const boards={};
 for(const c of CLASSES){
  const b=boards[c]=m.add(tabs[c],80,64).fill(2,1,[[d('2026-10-14')]]).fill(3,4,[[Number(c)]]).fill(13,1,[['13행'+c,'B'+c,'C'+c,'D'+c,'E'+c,'F'+c,'G'+c,'H'+c,'I'+c,'J'+c]])
   .fill(16,1,[['이름','상태','누적 출석률','증빙 미결']]).fill(17,1,names(c).map(n=>[n])).formula(17,3,C17F).formula(17,4,D17F);
  b.fill(17,3,names(c).map(n=>want[n]||[1,0]));
 }
 const dash=m.add(DASH,50,12),cum=m.add(CUM,40,10);
 CLASSES.forEach((c,i)=>{
  dash.formula(6+i,1,`='반정보'!O${4+i}`).fill(6+i,1,[[tabs[c]]]).formula(27+i,1,`='반정보'!O${4+i}`).fill(27+i,1,[[tabs[c]]]);
  'ABCDEF'.split('').forEach((col,j)=>dash.formula(6+i,5+j,`=IFERROR(INDIRECT("'"&$A${6+i}&"'!${col}13"),"")`));
  'GHIJ'.split('').forEach((col,j)=>dash.formula(27+i,5+j,`=IFERROR(INDIRECT("'" & $A${27+i} & "'!${col}13"),"")`));
  cum.formula(12+i,4,`=IFERROR(AVERAGE(INDIRECT("'"&'반정보'!$O${4+i}&"'!C17:C48")),"")`);
  'BDEF'.split('').forEach((col,j)=>cum.formula(12+i,5+j,`=IFERROR(INDIRECT("'"&'반정보'!$O${4+i}&"'!${col}13"),"")`));
 });
 dash.formula(22,5,'=IFERROR(INDIRECT($B22&"!A13"),"")'); // B22가 비어 바꿀 수 없음 → 그대로 둠
 dash.f.delete(dash.key(43,8));dash.fill(43,8,[['손으로 적은 값']]); // 수식이 아닌 칸은 건드리지 않음
 return {...env,m,ledger,roster,days,boards,dash,cum,fx};
}
const qCol=env=>env.ledger.rows(2,17,env.ledger.getLastRow()-1,1).map(r=>r[0]);
const qWrites=gas=>gas.log.writes.filter(w=>w.sheet==='출결원장'&&w.c===17&&w.kind==='values');
const cdWrites=(gas,tab)=>gas.log.writes.filter(w=>w.c===3&&w.nc===2&&(!tab||w.sheet===tab));
const slimReads=gas=>gas.log.reads.filter(r=>(r.sheet==='출결원장'&&r.c===17)||(r.sheet==='교육일자'&&r.nc===4));

/* ---------- 순수 계산: 수식과 같은 값 ---------- */

test('Q text: every rule, combinations, duplicates on both rows, the trailing " ·", empty A and second-precision time edges',()=>{
 const {gas,d,t,rowsOf}=base(),day=iso=>[d(iso)];
 // 행마다 다른 학생(s0, s1, …)이라 일부러 만든 중복(같음1·같음2)만 중복입니다.
 let k=0;const L=(date,cls,type,x={})=>[date===''?'':d(date),cls,x.name??'s'+(k++),type,x.e??'',x.f??'',x.g??'',x.h??'',x.i??'',x.j??'',x.k??''];
 const cases=[
  [L('2026-10-13',1,'지각'),'입실 시간 없음 ·'],
  [L('2026-10-13',1,'인정지각',{i:'병원'}),'입실 시간 없음 ·'],
  [L('2026-10-13',1,'조퇴',{i:'x'}),'퇴실 시간 없음 ·'],
  [L('2026-10-13',1,'인정조퇴'),'퇴실 시간 없음 · 인정 사유 없음 ·'],
  [L('2026-10-12',1,'외출',{g:t(10,0)}),'외출 구간 없음 ·'],
  [L('2026-10-12',1,'인정외출',{h:t(11,0),i:'병원'}),'외출 구간 없음 ·'],
  [L('2026-10-08',1,'지각',{e:t(9,10,0)}),'09:10까지는 지각 아님 ·'],
  [L('2026-10-08',1,'지각',{e:t(9,10,30)}),''],
  [L('2026-10-08',1,'지각',{e:t(9,5)}),'09:10까지는 지각 아님 ·'],
  [L('2026-10-08',1,'인정지각',{e:t(9,5),i:'병원'}),'','only 지각, not 인정지각, is checked against 09:10'],
  [L('2026-10-07',1,'조퇴',{f:t(17,50,0)}),'17:50 이후는 조퇴 아님 ·'],
  [L('2026-10-07',1,'조퇴',{f:t(17,49,59)}),''],
  [L('2026-10-07',1,'외출',{g:t(10,0),h:t(10,0)}),'외출 종료가 시작보다 빠름 ·'],
  [L('2026-10-07',1,'외출',{g:t(10,0),h:t(9,59,59)}),'외출 종료가 시작보다 빠름 ·'],
  [L('2026-10-06',1,'지각',{e:t(9,30),f:t(9,30)}),'퇴실이 입실보다 빠름 ·'],
  [L('2026-10-06',1,'지각',{e:t(9,0),f:t(8,0)}),'09:10까지는 지각 아님 · 퇴실이 입실보다 빠름 ·'],
  [L('2026-10-06',1,'인정출석'),'인정 사유 없음 ·'],
  [L('2026-10-06',1,'결석',{j:'반려'}),'반려 사유 없음 ·'],
  [L('2026-10-05',1,'결석',{j:'반려',k:'날짜 없음'}),''],
  [L('2026-10-10',1,'결석'),'교육일 아님 ·'],
  [L('2026-10-05',1,'결석',{name:'없음'}),'명부에 없는 이름 ·'],
  [L('2026-10-05',1,'결석',{name:'s0 '}),'명부에 없는 이름 ·','a trailing space is a different name, as in COUNTIF'],
  [L('2026-10-10',2,'인정조퇴',{name:'s1',j:'반려'}),'퇴실 시간 없음 · 인정 사유 없음 · 반려 사유 없음 · 교육일 아님 · 명부에 없는 이름 ·'],
  [L('2026-10-14',1,'지각',{name:'같음1'}),'중복 기록 · 입실 시간 없음 ·'],
  [L('2026-10-14',1,'지각',{name:'같음1',e:t(9,40)}),'중복 기록 ·'],
  [L('2026-10-14',1,'결석'),''],
  [L('',1,'지각',{name:'같음1'}),'','an empty date is an empty row (and not a third duplicate)'],
  // 시간이 글자로 들어 있으면 시트 비교에서 숫자보다 큼: 지각 '09:05'는 통과, 조퇴 '16:00'은 17:50 이후로 봄
  [L('2026-10-13',1,'지각',{e:'09:05'}),''],
  [L('2026-10-13',1,'조퇴',{f:'16:00'}),'17:50 이후는 조퇴 아님 ·'],
  [L('2026-10-13',1,'결석',{e:t(0,0)}),'','00:00 is a value, not an empty cell']
 ];
 const roster=[...Array(k).keys()].map(i=>[1,'s'+i]).concat([[1,'같음1'],['',''],[2,'']]);
 const rows=rowsOf(cases.map(c=>c[0])),days=rowsOf(DAYS.map(day)).map(r=>r[0]);
 const q=plain(gas.call('b2QValues_',rows,days,roster));
 cases.forEach((c,i)=>assert.equal(q[i],c[1],(c[2]||'')+' row '+i+' '+JSON.stringify(plain(rows[i]))));
 // 반 번호가 글자 '1'이어도 & 결과는 같으므로 같은 키(중복). 이름은 대소문자를 가리지 않음(COUNTIF)
 const more=rowsOf([L('2026-10-05',1,'결석',{name:'Kim'}),L('2026-10-05','1','결석',{name:'kim'})]);
 assert.deepEqual(plain(gas.call('b2QValues_',more,days,[[1,'KIM']])),['중복 기록 ·','중복 기록 ·']);
 assert.equal(gas.call('b2Trim_','  a ·   b · '),'a · b ·');
});

test('class tab C/D: absences up to the main day, pending evidence incl. 인정 without evidence, dropouts counted like everyone, D4=0 and empty names',()=>{
 const env=master(),{gas,d,rowsOf}=env,rows=rowsOf(env.fx.map(x=>x[0])),main=env.ser(d('2026-10-14'));
 const pad=a=>a.concat(Array(32-a.length).fill(''));
 const one=plain(gas.call('b2ClassStats_',rows,1,pad(names('1')),main,7)).slice(0,5);
 assert.deepEqual(one,[[6/7,1],[5/7,1],[1,1],[1,0],['','']],'가: 10/15 absence is after the main day; 나 (dropout): two absences + 반려; 다: 인정지각 without evidence');
 assert.deepEqual(plain(gas.call('b2ClassStats_',rows,2,pad(names('2')),main,7)).slice(0,2),[[1,0],[6/7,0]],'an absence on a non-teaching day still counts, as in COUNTIFS');
 assert.deepEqual(plain(gas.call('b2ClassStats_',rows,1,['가상1가',''],main,0)),[['',1],['','']],'D4=0 → C blank, D still counted');
 // 증빙: J가 있으면 J, 없으면 인정 유형만 미제출
 const ev=rowsOf([[d('2026-10-06'),3,'갑','인정출석','','','','','x','확인',''],[d('2026-10-06'),3,'갑','결석','','','','','','',''],[d('2026-10-07'),3,'갑','지각','','','','','','미제출',''],['',3,'갑','인정출석','','','','','','','']]);
 assert.deepEqual(plain(gas.call('b2ClassStats_',ev,3,['갑'],main,7)),[[6/7,1]]);
 // 주 교육일·교육일수(교육일자 D5·D4)
 const ds=rowsOf(DAYS.map(x=>[d(x)])).map(r=>r[0]).concat(['메모','']),s=iso=>env.ser(d(iso));
 assert.deepEqual(plain(gas.call('b2MainDay_',ds,s('2026-10-14'))),{main:s('2026-10-14'),count:7});
 assert.deepEqual(plain(gas.call('b2MainDay_',ds,s('2026-10-10'))),{main:s('2026-10-08'),count:4},'a weekend uses the last teaching day');
 assert.deepEqual(plain(gas.call('b2MainDay_',ds,s('2026-09-01'))),{main:s('2026-10-05'),count:1},'before the course the first day');
 assert.deepEqual(plain(gas.call('b2MainDay_',[],s('2026-10-14'))),{main:0,count:0});
});

test('INDIRECT tab references become direct references; anything unclear is left alone',()=>{
 const {gas}=base(),vals={'$A6':'1. 수도권_임베디드 AI(HW)',"'반정보'!$O4":'2. 수도권_제조지능화','$A7':'','$A8':'없는 탭','$A9':"Kim's",'$A10':"Kim''s",B5:'x'};
 const sheets=['1. 수도권_임베디드 AI(HW)','2. 수도권_제조지능화',"Kim's",'반정보'];
 const run=f=>plain(gas.call('b2DirectRefs_',f,ref=>ref in vals?vals[ref]:null,n=>sheets.includes(n)));
 assert.deepEqual(run(`=IFERROR(INDIRECT("'"&$A6&"'!A13"),"")`),{formula:`=IFERROR('1. 수도권_임베디드 AI(HW)'!A13,"")`,done:1,left:0});
 assert.deepEqual(run(`=IFERROR(AVERAGE(indirect("'" & '반정보'!$O4 & "'!C17:C48")),"")`),{formula:`=IFERROR(AVERAGE('2. 수도권_제조지능화'!C17:C48),"")`,done:1,left:0});
 assert.equal(run(`=INDIRECT("'"&$A6&"'!A13")+INDIRECT("'"&$A6&"'!B13")`).formula,`='1. 수도권_임베디드 AI(HW)'!A13+'1. 수도권_임베디드 AI(HW)'!B13`);
 assert.equal(run(`=INDIRECT("'"&$A10&"'!$B$13")`).formula,`='Kim''s'!$B$13`,'an escaped apostrophe in the resolved text stays escaped');
 assert.equal(run(`=IF(A1="INDIRECT(",1,2)`).done,0,'text inside a string is not a call');
 // 빈 칸·없는 탭·R1C1·칸 참조 두 개·탭 이름 없는 주소·따옴표가 깨진 이름(원래 수식도 오류)은 그대로
 for(const f of [`=INDIRECT("'"&$A7&"'!A13")`,`=INDIRECT("'"&$A8&"'!A13")`,`=INDIRECT("R13C1",FALSE)`,`=INDIRECT("'"&$A6&"'!"&$A6)`,`=INDIRECT(B5)`,`=INDIRECT("'"&$A9&"'!A13")`])
  assert.deepEqual(run(f),{formula:f,done:0,left:1},f);
});

/* ---------- 바꾸기·되돌리기 ---------- */

test('b2SlimCheck compares without writing; b2SlimSheet backs up every formula, writes the values and direct references, and refuses a second run',()=>{
 const env=master(),{gas,m,ledger,tabs}=env;
 gas.resetLog();const check=plain(gas.call('b2SlimCheck'));
 assert.deepEqual(gas.log.writes,[],'the check writes nothing');
 assert.deepEqual([check.differ.q,check.differ.cd],[0,0],'the Apps Script values equal what the formulas show now: '+check.differ.examples);
 assert.deepEqual([check.qRows,check.boards,check.formulas,check.backups],[13,17,253,288]);
 assert.match(check.notes.join('\n'),/INDIRECT를 그대로 둔 칸 1개: 운영총괄\(1기\) 대시보드!E22/);
 ledger.fill(3,17,[['예전 값']]);assert.equal(gas.call('b2SlimCheck').differ.q,1,'a cell that differs is reported');ledger.fill(3,17,[['']]);

 const maxBefore=ledger.getMaxRows();gas.resetLog();
 const res=plain(gas.call('b2SlimSheet'));
 assert.deepEqual(gas.log.outsideLock,[],'all writes inside the document lock');
 assert.equal(res.extendedRows,1000);assert.equal(ledger.getMaxRows(),maxBefore+1000,'fewer than 500 spare rows → 1000 more');
 assert.equal(ledger.fmt.get(ledger.key(ledger.getMaxRows(),19)),'@','S column is plain text down to the last row');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM'),'1');
 // 수식백업: 숨김, 수식 글자 그대로
 const back=m.getSheetByName('수식백업');assert.ok(back.isSheetHidden());
 const saved=back.rows(2,1,back.getLastRow()-1,4);
 assert.equal(saved.length,288);
 assert.deepEqual(saved[0],['출결원장','Q1',Q1F,'Q2:Q']);
 assert.deepEqual(saved.filter(r=>r[0]===tabs['5']),[[tabs['5'],'C17',C17F,'C18:C48'],[tabs['5'],'D17',D17F,'D18:D48']]);
 assert.deepEqual(saved.find(r=>r[0]===CUM&&r[1]==='D12'),[CUM,'D12',`=IFERROR(AVERAGE(INDIRECT("'"&'반정보'!$O4&"'!C17:C48")),"")`,'']);
 assert.equal(back.f.size,0,'nothing in the backup tab became a formula');
 // 출결원장 Q: 머리글 글자 + 값
 assert.equal(ledger.getRange('Q1').getFormula(),'');assert.equal(ledger.get(1,17),'입력 확인');
 assert.deepEqual(qCol(env),env.fx.map(x=>x[1]));
 assert.equal(ledger.getRange('N1').getFormula(),N1F,'the key and evidence formulas stay');assert.equal(ledger.getRange('O1').getFormula(),O1F);
 // 반 탭 C·D 값
 const b1=m.getSheetByName(tabs['1']);
 assert.deepEqual(b1.rows(17,3,5,2),[[6/7,1],[5/7,1],[1,1],[1,0],['','']]);assert.equal(b1.getRange('C17').getFormula(),'');
 assert.deepEqual(m.getSheetByName(tabs['9']).rows(17,3,2,2),[[1,0],[1,0]]);
 // 대시보드·누적관리: 직접 참조
 const dash=m.getSheetByName(DASH),cum=m.getSheetByName(CUM);
 assert.equal(dash.getRange('E6').getFormula(),`=IFERROR('1. 수도권_임베디드 AI(HW)'!A13,"")`);
 assert.equal(dash.getRange('J21').getFormula(),`=IFERROR('16. 전라_제조지능화(1)'!F13,"")`);
 assert.equal(dash.getRange('H42').getFormula(),`=IFERROR('16. 전라_제조지능화(1)'!J13,"")`);
 assert.equal(cum.getRange('D28').getFormula(),`=IFERROR(AVERAGE('17. 전라_제조지능화(2)'!C17:C48),"")`);
 assert.equal(cum.getRange('E12').getFormula(),`=IFERROR('1. 수도권_임베디드 AI(HW)'!B13,"")`);
 assert.equal(dash.getRange('E22').getFormula(),'=IFERROR(INDIRECT($B22&"!A13"),"")','unclear INDIRECT left alone');
 assert.equal(dash.get(43,8),'손으로 적은 값');assert.equal(dash.getRange('A6').getFormula(),`='반정보'!O4`);
 assert.ok(!gas.log.writes.some(w=>w.sheet===DASH&&w.c===1),'tab-name cells are not touched');
 assert.ok(gas.log.writes.filter(w=>w.kind==='formulas').length<=17*3,'formulas written a row at a time');
 // 두 번째 실행은 막힘(아무것도 쓰지 않음)
 gas.resetLog();
 assert.throws(()=>gas.call('b2SlimSheet'),/이미 시트 다듬기/);
 assert.deepEqual(gas.log.writes,[]);
 gas.scriptProps.deleteProperty('B2_SLIM');assert.throws(()=>gas.call('b2SlimSheet'),/이미 시트 다듬기/,'the backup tab alone also blocks it');
});

test('b2RestoreFormulas puts every formula back exactly, clears the values where arrays spill, and allows migrating again',()=>{
 const env=master(),{gas,m,ledger,tabs}=env,snapshot=()=>m.getSheets().filter(s=>s.name!=='수식백업').map(s=>[s.name,[...s.f].sort((a,b)=>a[0]-b[0])]);
 const before=snapshot();
 gas.call('b2SlimSheet');
 gas.call('b2Save',{cls:'2',name:'가상2다',date:'2026-10-13',type:'지각',inT:'09:05',before:''}); // 값이 하나 더 생긴 뒤 되돌려도
 gas.resetLog();const res=plain(gas.call('b2RestoreFormulas'));
 assert.deepEqual(res,{restored:288,missing:[]});
 assert.deepEqual(gas.log.outsideLock,[]);
 assert.deepEqual(snapshot(),before,'every formula in every tab is exactly as before');
 assert.equal(m.getSheetByName('수식백업'),null,'backup tab removed');assert.equal(gas.scriptProps.getProperty('B2_SLIM'),null);
 assert.deepEqual(ledger.rows(1,17,ledger.getMaxRows(),1).flat().filter(v=>v!==''),[],'Q values cleared so the array formula can spill');
 const b3=m.getSheetByName(tabs['3']);assert.deepEqual(b3.rows(17,3,32,2).flat().filter(v=>v!==''),[],'C17:D48 values cleared');
 assert.equal(m.getSheetByName(DASH).get(43,8),'손으로 적은 값');
 assert.throws(()=>gas.call('b2RestoreFormulas'),/되돌릴 수식이 없습니다/);
 gas.call('b2SlimSheet');assert.equal(gas.scriptProps.getProperty('B2_SLIM'),'1','can migrate again after a restore');
});

/* ---------- 바꾼 뒤에만 도는 계산(훅) ---------- */

test('before the migration every hook is a no-op: no Q / C·D reads or writes from b2Save, Code.gs saves, direct edits or board redraws',()=>{
 const env=master(),{gas,ledger,boards}=env;gas.resetLog();
 gas.call('b2Save',{cls:'2',name:'가상2다',date:'2026-10-13',type:'결석',before:''});
 gas.call('portalSave',{cls:3,pin:'',name:'가상3가',date:'2026-10-13',type:'지각',inT:'09:30'});
 gas.call('portalSave',{cls:1,pin:'',name:'가상1라',date:'2026-10-08',type:'해당없음'});
 const locks=gas.log.locks;
 ledger.put(2,4,'지각');gas.call('onEdit',{range:ledger.getRange('D2')});
 assert.equal(gas.log.locks,locks,'a direct ledger edit takes no lock before the migration');
 gas.call('rebuildAll');
 boards['4'].put(17,5,'결석');gas.call('onEdit',{range:boards['4'].getRange(17,5)});
 assert.equal(gas.log.locks,locks+1,'a board edit takes only the save lock');assert.equal(ledger.get(ledger.getLastRow(),3),'가상4가');
 assert.deepEqual(qWrites(gas),[]);assert.deepEqual(cdWrites(gas),[]);assert.deepEqual(slimReads(gas),[]);
 gas.resetLog();gas.call('rebuildAll');
 assert.deepEqual(gas.log.reads.filter(r=>r.sheet==='출결원장'&&r.c===1&&r.r===2).map(r=>r.nc),[4],'board redraw still reads only A:D of the ledger');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);assert.equal(ledger.getRange('Q1').getFormula(),Q1F);
});

test('after the migration b2Save rewrites only the Q cells that changed and that class tab C/D, and returns the new check text',()=>{
 const env=master(),{gas,ledger,tabs}=env;gas.call('b2SlimSheet');
 gas.resetLog();
 const saved=gas.call('b2Save',{cls:'1',name:'가상1라',date:'2026-10-13',type:'지각',inT:'09:05',before:''});
 const row=ledger.getLastRow();
 assert.equal(saved.check,'09:10까지는 지각 아님 ·','b2Save returns the fresh Q text');
 assert.deepEqual(qWrites(gas).map(w=>[w.r,w.nr]),[[row,1]],'only the new row');
 assert.deepEqual(cdWrites(gas).map(w=>w.sheet),[tabs['1']]);assert.deepEqual(gas.log.outsideLock,[]);
 gas.resetLog();
 gas.call('b2Save',{cls:'1',name:'가상1다',date:'2026-10-13',type:'결석',before:gas.call('b2Sig_',{date:'2026-10-13',cls:'1',name:'가상1다',type:'조퇴',inT:'',outT:'17:50',oa:'',ob:'',reason:'',ev:'',evr:''})});
 assert.equal(ledger.get(13,17),'','the 17:50 note disappears');assert.deepEqual(qWrites(gas).map(w=>w.r),[13]);
 assert.deepEqual(env.m.getSheetByName(tabs['1']).rows(19,3,1,2)[0],[6/7,1],'가상1다 now has one absence');
});

test('after the migration a direct ledger edit updates the edited row and its duplicate partner, and Code.gs board/panel/portal paths call the hooks',()=>{
 const env=master(),{gas,m,ledger,tabs}=env;gas.call('b2SlimSheet');
 // 5행·9행이 같은 학생·날짜(중복). 9행 이름을 고치면 두 행 모두 '중복 기록'이 사라짐
 ledger.put(9,3,'가상1다');gas.resetLog();gas.call('onEdit',{range:ledger.getRange('C9')});
 assert.deepEqual(qWrites(gas).map(w=>[w.r,w.nr]),[[5,1],[9,1]]);assert.deepEqual([ledger.get(5,17),ledger.get(9,17)],['','']);
 assert.deepEqual(cdWrites(gas).map(w=>w.sheet),[tabs['1']],'the board of the edited class is redrawn with C/D');
 assert.deepEqual(m.getSheetByName(tabs['1']).rows(19,3,2,2),[[1,1],[1,0]]);
 // 다시 중복으로 만든 뒤 포털에서 '해당없음' → 앞 행이 지워지고 남은 짝 행의 Q가 고쳐짐(행과 함께 값도 올라감)
 ledger.put(9,3,'가상1라');gas.call('onEdit',{range:ledger.getRange('C9')});assert.equal(ledger.get(5,17),'중복 기록 ·');
 gas.resetLog();assert.equal(gas.call('portalSave',{cls:1,pin:'',name:'가상1라',date:'2026-10-08',type:'해당없음'}).ok,true);
 assert.deepEqual(qWrites(gas).map(w=>w.r),[8],'the partner moved from row 9 to 8 and lost its note');
 assert.deepEqual(qCol(env).slice(0,12),env.fx.filter((x,i)=>i!==3).map((x,i)=>i===6?'':x[1]),'every other Q value moved with its row');
 assert.deepEqual(gas.log.outsideLock.filter(x=>/출결원장/.test(x)),[]);
 // 포털 저장(upsert_): Q + 그 반 C/D
 gas.resetLog();gas.call('portalSave',{cls:3,pin:'',name:'가상3가',date:'2026-10-13',type:'결석'});
 assert.deepEqual(qWrites(gas),[],'a clean new row needs no Q write');assert.deepEqual(cdWrites(gas).map(w=>w.sheet),[tabs['3']]);
 assert.equal(m.getSheetByName(tabs['3']).get(17,3),6/7);
 gas.resetLog();gas.call('portalSave',{cls:3,pin:'',name:'가상3나',date:'2026-10-13',type:'지각'});
 assert.deepEqual(qWrites(gas).map(w=>ledger.get(w.r,17)),['입실 시간 없음 ·']);
 // 출결판에서 여러 칸을 한 번에: 칸마다가 아니라 끝에 한 번만 계산
 const b2=m.getSheetByName(tabs['2']);gas.call('rebuildAll');
 b2.put(18,5,'결석');b2.put(18,6,'인정출석');gas.resetLog();gas.call('onEdit',{range:b2.getRange(18,5,1,2)});
 assert.equal(gas.log.reads.filter(r=>r.sheet==='출결원장'&&r.c===17).length,1,'one Q recompute for the whole paste');
 assert.deepEqual(cdWrites(gas).map(w=>w.sheet),[tabs['2']]);assert.deepEqual(b2.rows(18,3,1,2)[0],[5/7,1],'가상2나: 10/14 결석 + the earlier 10/10 결석, and 10/13 인정출석 without evidence');
 // 패널 저장도 같은 경로(upsert_)
 gas.resetLog();gas.call('saveRecord',{cls:5,name:'가상5나',date:'2026-10-12',type:'인정출석',r:''});
 assert.deepEqual(qWrites(gas).map(w=>ledger.get(w.r,17)),['인정 사유 없음 ·']);
 // 이 모든 저장 뒤에도 시트의 Q·C·D 값이 처음부터 다시 계산한 값과 같음(b2SlimCheck는 바꾼 뒤 확인용으로도 씀)
 const check=plain(gas.call('b2SlimCheck'));assert.deepEqual([check.differ.q,check.differ.cd],[0,0],check.differ.examples.join('\n'));
});

test('after the migration redrawing boards (Code.gs) writes C/D from the same ledger read, still reading everything before writing',()=>{
 const env=master(),{gas,m,tabs}=env;gas.call('b2SlimSheet');
 m.getSheetByName(tabs['1']).fill(17,3,[['x','y']]);
 gas.resetLog();gas.call('rebuildAll');
 assert.equal(new Set(cdWrites(gas).map(w=>w.sheet)).size,17);
 assert.deepEqual(m.getSheetByName(tabs['1']).rows(17,3,2,2),[[6/7,1],[5/7,1]]);
 const firstWrite=Math.min(...gas.log.writes.map(w=>w.seq)),lastRead=Math.max(...gas.log.reads.map(r=>r.seq));
 assert.ok(lastRead<firstWrite,'reads before writes');
 assert.equal(gas.log.reads.filter(r=>r.sheet==='출결원장'&&r.c===1&&r.nc>1).length,1,'one ledger read');
 // 교육일자를 고치면 C(교육일수)와 Q(교육일 아님)가 같이 바뀜
 const days=m.getSheetByName('교육일자');days.fill(10,1,[[env.d('2026-10-10')]]);days.fill(4,4,[[8]]);
 gas.resetLog();gas.call('onEdit',{range:days.getRange('A10')});
 assert.equal(env.ledger.get(10,17),'','10/10 is now a teaching day');
 assert.deepEqual(m.getSheetByName(tabs['1']).rows(17,3,1,2)[0],[7/8,1]);
 // 명부 이름을 고치면 그 이름의 원장 행에 '명부에 없는 이름'
 env.roster.put(4,2,'가상1다(개명)');gas.resetLog();gas.call('onEdit',{range:env.roster.getRange('B4')});
 assert.deepEqual(qWrites(gas).map(w=>[w.r,env.ledger.get(w.r,17)]),[[8,'입실 시간 없음 · 인정 사유 없음 · 명부에 없는 이름 ·'],[13,'17:50 이후는 조퇴 아님 · 명부에 없는 이름 ·']]);
 assert.deepEqual(gas.log.outsideLock.filter(x=>/출결원장/.test(x)),[]);
});

test('a failed Q recompute does not block the save; it leaves B2_SLIM_DIRTY so the next hook call recomputes even without a write',()=>{
 const env=master(),{gas}=env;gas.call('b2SlimSheet');
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===17,run:()=>{throw new Error('Service error');},once:true});
 const saved=gas.call('b2Save',{cls:'2',name:'가상2다',date:'2026-10-13',type:'지각',inT:'09:05',before:''});
 assert.equal(saved.ok,true);assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),'1');
 assert.equal(saved.check,'','the stale value is returned this time');
 assert.equal(gas.call('b2SlimRefresh_',{onlyIfDirty:true}).q,1);
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);assert.equal(env.ledger.get(env.ledger.getLastRow(),17),'09:10까지는 지각 아님 ·');
 assert.equal(gas.call('b2SlimRefresh_',{onlyIfDirty:true}),null,'nothing to do when clean');
});

/* ---------- 동기화와 함께 ---------- */

const md=iso=>`${+iso.slice(5,7)}/${+iso.slice(8,10)}`;
function syncSetup(){
 const env=base(),{gas,d,tabs}=env,SOURCE=gas.run('B2.SOURCE_ID');
 const src=gas.book(SOURCE,'1기 운영총괄'),three=c=>names(c).slice(0,3);
 for(const c of CLASSES){
  const sh=src.add(tabs[c],60,30);
  sh.fill(18,13,[['이름','출석률','출석일수','지/조/외/중복',...DAYS.map(md)]]);
  three(c).forEach((n,i)=>sh.fill(19+i,13,[[n,'','','',...DAYS.map(x=>x>'2026-10-14'?'':(i===0&&x==='2026-10-06'?'결석':'출석'))]]));
  sh.fill(50,13,[['가-3','','','',...DAYS.map(md)]]).fill(51,13,[['*','','','',...DAYS.map(x=>x==='2026-10-06'?`결석1- ${three(c)[0]}_병원`:'')]]);
 }
 src.add('서류발급요청',10,12);src.add('반정보',30,20);
 const m=gas.book('master-test','마스터',true);
 const ledger=m.add('출결원장',400,20).fill(1,1,[['일자','반','이름','유형']]).formula(1,17,Q1F);
 m.add('명부',800,8).fill(1,1,[['반','이름']]).fill(2,1,CLASSES.flatMap(c=>three(c).map(n=>[Number(c),n,'','재학'])));
 m.add('교육일자',200,6).fill(1,1,[['교육일']]).fill(2,1,DAYS.map(x=>[d(x)]));
 m.add('반정보',30,20).fill(4,7,CLASSES.map(c=>[c+'반','','','','','','','',String(3000+Number(c))]));
 m.add('서류발급',200,18).fill(1,1,[['신청번호']]);m.add('교육생정보',800,4);m.add('변경이력',500,8).fill(1,1,[['시각']]);
 for(const c of CLASSES)m.add(String(3000+Number(c)),80,64).fill(3,4,[[Number(c)]]).fill(16,1,[['이름']]).formula(17,3,C17F).formula(17,4,D17F);
 gas.scriptProps.setProperty('B2_LEGACY_ADOPTED','2');
 const setSource=(c,name,date,value,reason)=>{const sh=src.getSheetByName(tabs[c]),col=17+DAYS.indexOf(date);sh.put(19+three(c).indexOf(name),col,value);sh.put(51,col,reason);gas.advance(60000);src.touch();};
 return {...env,src,m,ledger,setSource};
}
const tick=(gas,ms=10*60000)=>{gas.advance(ms);gas.resetLog();gas.call('b2SyncTick');return JSON.parse(gas.scriptProps.getProperty('B2_SYNC_LAST'));};

test('with the sync: before the migration nothing extra happens; after it a changed class writes its Q cell and redraws its board with C/D',()=>{
 const env=syncSetup(),{gas,m,ledger,setSource}=env;
 gas.resetLog();gas.call('b2SyncTick');
 assert.deepEqual(qWrites(gas),[]);assert.deepEqual(cdWrites(gas),[]);assert.deepEqual(slimReads(gas),[]);
 assert.equal(ledger.getRange('Q1').getFormula(),Q1F);
 gas.call('b2SlimSheet');
 assert.deepEqual(ledger.rows(2,17,17,1).flat(),Array(17).fill(''),'synced 결석 rows have no notes');
 assert.equal(m.getSheetByName('3001').get(17,3),6/7);
 setSource('5','가상5나','2026-10-13','지각','지각1- 가상5나_09:05');
 const res=tick(gas);
 assert.deepEqual(plain(res.processed),['5']);assert.equal(res.warnings.length,0,res.warnings);
 const row=ledger.getLastRow();assert.equal(ledger.get(row,3),'가상5나');
 assert.deepEqual(qWrites(gas).map(w=>[w.r,w.nr]),[[row,1]]);assert.equal(ledger.get(row,17),'09:10까지는 지각 아님 ·');
 assert.deepEqual(cdWrites(gas).map(w=>w.sheet),['3005']);
 assert.equal(ledger.fmt.get(ledger.key(row,19)),'@');assert.ok(!gas.log.writes.some(w=>w.sheet==='출결원장'&&w.c===19&&w.kind==='format'&&w.nr>1),'S column is not reformatted as a whole');
 assert.deepEqual(gas.log.outsideLock,[]);
 // 결석으로 바뀌면 C가 줄어듦
 setSource('5','가상5다','2026-10-12','결석','결석1- 가상5다_병원');tick(gas);
 assert.equal(m.getSheetByName('3005').get(19,3),6/7);
 // 바뀐 것이 없는 실행은 Q를 다시 계산하지 않음. 지난 계산이 실패했으면(B2_SLIM_DIRTY) 쓴 것이 없어도 다시 계산
 tick(gas);assert.deepEqual(slimReads(gas),[]);
 gas.resetLog();gas.call('b2SyncNow',{cls:'5'});assert.equal(gas.log.reads.filter(r=>r.sheet==='출결원장'&&r.c===17).length,0,'a one-class run that writes nothing');
 gas.scriptProps.setProperty('B2_SLIM_DIRTY','1');gas.resetLog();gas.call('b2SyncNow',{cls:'5'});
 assert.equal(gas.log.reads.filter(r=>r.sheet==='출결원장'&&r.c===17).length,1);assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
});

/* ---------- 묶음 캐시·실행 시간 한도와 함께 ---------- */

test('after the migration a Code.gs save bumps B2_REV only after Q is written, so a /beta2 bundle cached between the A:K and Q writes is not reused',()=>{
 const env=master(),{gas,ledger,m}=env;gas.call('b2SlimSheet');
 gas.call('b2Bundle','3'); // 캐시를 채움
 let inside=null,dirtyDuring=null;
 // A~K를 쓴 뒤 Q를 다시 계산하는 중에 화면이 묶음을 읽음(그사이 Drive 수정 시각은 바뀜) → 새 A~K와 옛 Q가 그때 표시로 캐시됨
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===17,run:()=>{dirtyDuring=gas.scriptProps.getProperty('B2_SLIM_DIRTY');gas.advance(1000);m.touch();inside=plain(gas.call('b2Bundle','3'));},once:true});
 const rev0=+gas.scriptProps.getProperty('B2_REV')||0;
 assert.equal(gas.call('portalSave',{cls:3,pin:'',name:'가상3나',date:'2026-10-13',type:'지각'}).ok,true);
 const pick=b=>b.ledger.find(r=>r[2]==='가상3나'&&r[0]==='2026-10-13');
 assert.ok(inside&&pick(inside),'the bundle was read mid-save');assert.equal(pick(inside)[13],'','that read saw the old (empty) Q');
 assert.equal(inside.rev,rev0,'B2_REV is not bumped between the A:K write and the Q write');
 assert.equal(dirtyDuring,'1','B2_SLIM_DIRTY is set before computing, so a run cut off mid-way is recomputed next time');
 const after=plain(gas.call('b2Bundle','3'));
 assert.ok(after.rev>inside.rev,'B2_REV was bumped after the Q write');assert.equal(after.rev,rev0+2,'b2SlimRefresh_ (Q changed) and upsert_ bump back to back');
 assert.equal(pick(after)[13],'입실 시간 없음 ·','the next bundle has the new Q');assert.equal(ledger.get(ledger.getLastRow(),17),'입실 시간 없음 ·');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
});

test('after the migration a sync that is short on time after the ledger write skips the Q recompute (phase slim, B2_SLIM_DIRTY) and the next run does it',()=>{
 const env=syncSetup(),{gas,ledger,setSource}=env;
 gas.call('b2SyncTick');gas.call('b2SlimSheet');
 const phases=[],set=gas.scriptProps.setProperty;
 gas.scriptProps.setProperty=function(k,v){if(k==='B2_SYNC_PHASE')phases.push(JSON.parse(v).phase);return set.call(this,k,v);};
 setSource('5','가상5나','2026-10-13','지각','지각1- 가상5나_09:05');
 // 출결원장 A~K를 쓰는 순간 4분 40초가 지난 것으로(남은 시간 < B2.SYNC.boardMs)
 gas.hooks.push({when:e=>e.op==='write'&&e.range.sh.name==='출결원장'&&e.range.c===1&&e.range.nc===11,run:()=>gas.advance(280000),once:true});
 const res=tick(gas),row=ledger.getLastRow();
 assert.equal(ledger.get(row,3),'가상5나','the ledger write itself went through');
 assert.deepEqual(qWrites(gas),[]);assert.deepEqual(slimReads(gas),[]);assert.equal(ledger.get(row,17),'');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),'1');assert.ok(res.warnings.some(w=>/^입력 확인: 실행 시간이 모자라/.test(w)),res.warnings);
 assert.deepEqual(phases.slice(phases.indexOf('write')),['write','slim','done'],'boards are left for the next run too');
 assert.deepEqual(gas.log.outsideLock,[]);
 phases.length=0;const next=tick(gas);
 assert.equal(ledger.get(row,17),'09:10까지는 지각 아님 ·');assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
 assert.ok(phases.includes('slim'));assert.deepEqual(next.warnings,[]);
 assert.deepEqual(cdWrites(gas).map(w=>w.sheet),['3005'],'the pending board is drawn with C/D');
});

test('after the migration a ledger write that lands but ends in a timed-out flush leaves B2_SLIM_DIRTY, so the next run recomputes Q with nothing left to write',()=>{
 const env=syncSetup(),{gas,ledger,setSource}=env;
 gas.call('b2SyncTick');gas.call('b2SlimSheet');
 setSource('5','가상5나','2026-10-13','지각','지각1- 가상5나_09:05');
 gas.failures.push({op:'flush',times:1,message:'Exception: Service Spreadsheets timed out while accessing document with id abcdefghijklmnopqrstuvwxyz.'});
 assert.throws(()=>tick(gas),/timed out/);
 const row=ledger.getLastRow();assert.equal(ledger.get(row,3),'가상5나','the values went in');assert.equal(ledger.get(row,17),'');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),'1','marked before writing');
 const res=tick(gas);assert.deepEqual(plain(res.processed),['5']);assert.equal(res.writes.patched+res.writes.appended,0,'the rows are already there');
 assert.equal(ledger.get(row,17),'09:10까지는 지각 아님 ·');assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
});

test('after the migration a direct edit made while the sync holds the lock leaves B2_SLIM_DIRTY; a quiet sync run recomputes Q, and the first run of a day recomputes it in full',()=>{
 const env=syncSetup(),{gas,ledger}=env;
 gas.call('b2SyncTick');gas.call('b2SlimSheet');
 assert.deepEqual(ledger.rows(2,3,1,2)[0],['가상1가','결석']);
 // 잠금 요청을 기록: 단순 트리거(30초) 안에서 오래 기다리지 않고 잠깐만 시도해야 합니다
 const LS=gas.ctx.LockService,getLock=LS.getDocumentLock,asks=[];
 LS.getDocumentLock=()=>{const l=getLock();return {waitLock(ms){asks.push(['wait',ms]);return l.waitLock(ms);},tryLock(ms){asks.push(['try',ms]);return l.tryLock(ms);},releaseLock:()=>l.releaseLock(),hasLock:()=>l.hasLock()};};
 gas.lock.other=true;ledger.put(2,4,'지각');gas.call('onEdit',{range:ledger.getRange('D2')});gas.lock.other=false;LS.getDocumentLock=getLock;
 assert.deepEqual(asks,[['try',5000]],'one short try, no 20-second wait');
 assert.equal(ledger.get(2,17),'','not recomputed while the lock is busy (onEdit does not wait 20 s)');assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),'1');
 tick(gas);
 assert.equal(gas.log.api.length,0,'quick skip: 운영총괄 is not read');
 assert.equal(ledger.get(2,17),'입실 시간 없음 ·');assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
 assert.deepEqual(gas.log.outsideLock,[]);
 tick(gas);assert.deepEqual(slimReads(gas),[],'nothing pending → no recompute');
 // onEdit이 없는 편집(행 삭제·정렬, 다른 스크립트·예전 배포의 저장)으로 어긋난 Q는 날이 바뀐 첫 실행이 쓴 것이 없어도 바로잡습니다.
 ledger.fill(2,4,[['결석']]);ledger.fill(3,17,[['예전 값']]);gas.at('2026-10-15T09:20:00+09:00');gas.resetLog();gas.call('b2SyncTick');
 const day=JSON.parse(gas.scriptProps.getProperty('B2_SYNC_LAST'));assert.equal(day.writes.patched+day.writes.appended+day.writes.cleared,0,'nothing to write');
 assert.deepEqual([ledger.get(2,17),ledger.get(3,17)],['','']);
});

test('after the migration a direct edit cut off before its Q recompute (boards redrawn after a 교육일자 edit hit the 30-second limit, or a paste fails half-way) leaves B2_SLIM_DIRTY',()=>{
 const env=master(),{gas,m,ledger,tabs,d}=env;gas.call('b2SlimSheet');
 const logged=[];gas.ctx.console={log:e=>logged.push(String(e)),warn(){},error(){}}; // onEdit은 오류를 로그로만 남깁니다
 // 1) 교육일자에 10/10을 넣었는데 17개 반을 그리다 단순 트리거 한도에 걸림 → 그 뒤의 Q 계산까지 못 감
 const days=m.getSheetByName('교육일자');days.fill(10,1,[[d('2026-10-10')]]);
 gas.hooks.push({when:e=>e.op==='write'&&e.range.sh.name===tabs['3'],run:()=>{throw new Error('Exceeded maximum execution time');},once:true});
 gas.call('onEdit',{range:days.getRange('A10')});
 assert.match(logged.join('\n'),/Exceeded maximum execution time/);
 assert.equal(ledger.get(10,17),'교육일 아님 ·','Q is not recomputed yet');assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),'1','marked before the boards were drawn');
 assert.equal(gas.call('b2SlimRefresh_',{onlyIfDirty:true}).q,1);assert.equal(ledger.get(10,17),'');
 // 2) 출결판에서 두 칸을 붙여 넣었는데 둘째 칸 저장이 실패 → 끝의 계산까지 못 감. 첫 칸은 이미 원장에 있음
 const b2=m.getSheetByName(tabs['2']);gas.call('rebuildAll');assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
 b2.put(17,5,'지각');b2.put(17,6,'지각');logged.length=0;
 gas.failures.push({sheet:'출결원장',op:'write',skip:1,times:1,message:'Service Spreadsheets failed while accessing document with id abcdefghijklmnopqrstuvwxyz'});
 gas.call('onEdit',{range:b2.getRange(17,5,1,2)});
 assert.match(logged.join('\n'),/failed while accessing/);
 const row=ledger.getLastRow();assert.deepEqual(ledger.rows(row,3,1,2)[0],['가상2가','지각']);assert.equal(ledger.get(row,17),'','the first cell went in without its Q');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),'1','marked before the first cell was saved');
 assert.equal(gas.call('b2SlimRefresh_',{onlyIfDirty:true}).q,1);assert.equal(ledger.get(row,17),'입실 시간 없음 ·');
 assert.equal(gas.scriptProps.getProperty('B2_SLIM_DIRTY'),null);
});

test("after the migration C counts absences up to the class tab's own A2 like the formula; b2SlimCheck notes a tab whose A2 differs from D5",()=>{
 const env=master(),{gas,m,tabs,d}=env;gas.call('b2SlimSheet');
 const b1=m.getSheetByName(tabs['1']);b1.fill(2,1,[[d('2026-10-07')]]);
 gas.call('rebuildAll');
 assert.deepEqual(b1.rows(17,3,2,2),[[6/7,1],[6/7,1]],'가상1나: only the 10/07 absence is on or before A2');
 let check=plain(gas.call('b2SlimCheck'));assert.deepEqual([check.differ.q,check.differ.cd],[0,0]);
 assert.match(check.notes.join('\n'),/1반 A2가 교육일자 D5와 다름\(C는 수식처럼 A2 기준\)/);
 gas.call('b2Save',{cls:'1',name:'가상1다',date:'2026-10-13',type:'결석',before:gas.call('b2Sig_',{date:'2026-10-13',cls:'1',name:'가상1다',type:'조퇴',inT:'',outT:'17:50',oa:'',ob:'',reason:'',ev:'',evr:''})});
 assert.deepEqual(b1.rows(19,3,1,2)[0],[1,1],'a one-cell save uses A2 too: 10/13 is after A2');
 b1.fill(2,1,[['']]);gas.call('rebuildAll');assert.deepEqual(b1.rows(17,3,3,2),[[6/7,1],[5/7,1],[6/7,1]],'an empty A2 falls back to 교육일자 D5');
 assert.match(plain(gas.call('b2SlimCheck')).notes.join('\n'),/1반 A2가 교육일자 D5와 다름\(A2가 날짜가 아니라 C는 D5 기준\)/);
});

test('after the migration a class tab whose C/D held no formulas is left alone by every writer',()=>{
 const env=master(),{gas,m,tabs}=env,b9=m.getSheetByName(tabs['9']);
 b9.f.delete(b9.key(17,3));b9.f.delete(b9.key(17,4));b9.fill(17,3,[['손으로','적음']]);
 const res=plain(gas.call('b2SlimSheet'));assert.match(res.notes.join('\n'),/9반 C17:D48에 수식 없음/);assert.equal(res.boards,16);
 assert.equal(JSON.parse(gas.scriptProps.getProperty('B2_SLIM_TABS')).includes('9'),false);
 gas.resetLog();gas.call('rebuildAll');
 gas.call('b2Save',{cls:'9',name:'가상9가',date:'2026-10-13',type:'결석',before:''});
 gas.call('portalSave',{cls:9,pin:'',name:'가상9나',date:'2026-10-13',type:'결석'});
 gas.call('portalSetStatus',9,'','가상9다','중도탈락','2026-10-12');
 assert.deepEqual(b9.rows(17,3,1,2)[0],['손으로','적음']);assert.deepEqual(cdWrites(gas,tabs['9']),[]);
 assert.ok(cdWrites(gas,tabs['1']).length>0,'migrated tabs are still written');
 gas.call('b2RestoreFormulas');assert.equal(gas.scriptProps.getProperty('B2_SLIM_TABS'),null);
});

test('after the migration a status change from the teacher portal redraws the names together with C/D',()=>{
 const env=master(),{gas,m,tabs,roster}=env;gas.call('b2SlimSheet');
 const b2=m.getSheetByName(tabs['2']);
 roster.fill(6,1,[[2,'가상2나','','재학','']]);roster.fill(7,1,[[2,'가상2가','','재학','']]); // 명부에서 2반 두 학생 순서가 바뀜(onEdit 없음)
 gas.resetLog();gas.call('portalSetStatus',2,'','가상2다','중도탈락','2026-10-12');
 assert.deepEqual(b2.rows(17,1,2,1).flat(),['가상2나','가상2가']);
 assert.deepEqual(b2.rows(17,3,2,2),[[6/7,0],[1,0]],'C/D follow the names (가상2나 has the 10/10 absence)');
});

test('the migration functions run only for the script owner, not for a web-app visitor through google.script.run; migrating and restoring bump B2_REV',()=>{
 const env=master(),{gas}=env,S=gas.ctx.Session;
 for(const who of ['','visitor@example.com']){
  gas.ctx.Session={getActiveUser:()=>({getEmail:()=>who}),getEffectiveUser:S.getEffectiveUser};gas.resetLog();
  for(const f of ['b2SlimCheck','b2SlimSheet','b2RestoreFormulas','b2Setup','b2ImportAll','b2InstallTrigger','b2RemoveTrigger'])assert.throws(()=>gas.call(f),/편집기에서 직접 실행할 때만/,f+' '+who);
  assert.deepEqual([gas.log.reads.length,gas.log.writes.length,gas.triggers.length],[0,0,0]);assert.equal(gas.scriptProps.getProperty('B2_SLIM'),null);
 }
 gas.ctx.Session=S;
 const rev=()=>+gas.scriptProps.getProperty('B2_REV')||0,r0=rev();
 assert.equal(plain(gas.call('b2SlimSheet')).boards,17);assert.equal(rev(),r0+1,'Q is now values: open /beta2 pages and the bundle cache read again');
 gas.call('b2RestoreFormulas');assert.equal(rev(),r0+2);
});
