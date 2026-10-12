import test from 'node:test';
import assert from 'node:assert/strict';
import {birthGenderCode,hhmm,ymd,rosterFromSheet,buildUploadRows,UPLOAD_HEADERS,ASSIGNMENT_KEYS} from '../../attendance-upload-core.mjs';

test('birth-gender code uses the century digit: 1900s male 1 / female 2, 2000s male 3 / female 4',()=>{
 assert.equal(birthGenderCode('1999.05.31','여성'),'9905312');
 assert.equal(birthGenderCode('1996-05-15','남성'),'9605151');
 assert.equal(birthGenderCode('2001.12.24','남성'),'0112243');
 assert.equal(birthGenderCode('2003/04/09','여'),'0304094');
 assert.equal(birthGenderCode(new Date(Date.UTC(2000,0,1)),'M'),'0001013');
 assert.equal(birthGenderCode('20000229','F'),'0002294');
 for(const [birth,gender] of [['2001.02.30','남성'],['01.12.24','남성'],['2001.12.24',''],['','여성'],['2001.12.24','기타']])assert.equal(birthGenderCode(birth,gender),'',`${birth}/${gender}`);
});

test('times and dates use the upload text format',()=>{
 assert.equal(hhmm('09:01:59'),'0901');assert.equal(hhmm('9:05'),'0905');assert.equal(hhmm(null),'');
 assert.equal(ymd('2026-09-01'),'20260901');
 assert.deepEqual(UPLOAD_HEADERS,['훈련과정ID','훈련과정회차','훈련생성명','생년월일성별','훈련일자','입실시간','퇴실시간','외출시작시간','외출종료시간']);
 assert.equal(Object.keys(ASSIGNMENT_KEYS).length,17);
});

test('the roster sheet is read by header names and filtered to one class assignment',()=>{
 const rows=[['■ 교육생 명단'],['No.','기수','구분','지원분야','이름','성별','생년월일','나이','이메일','핸드폰번호','반배정_확정'],
  [1,'','','','가나다','남성','2000.01.02',26,'','010-1111-2222','[현대자동차그룹] 서울(관악구)_임베디드 AI (HW)_서울대'],
  [2,'','','','라마바','여성','1998.03.04',28,'','010-3333-4444','[현대자동차그룹] 서울(성동구)_제조지능화 (스마트팩토리)_한양대'],
  [3,'','','','','','','','','',''],
  [4,'','','','사아자','남성','2002.05.06',24,'','010-5555-6666','[현대자동차그룹] 서울(관악구)_임베디드 AI (HW)_서울대']];
 assert.deepEqual(rosterFromSheet(rows,1).map(s=>s.name),['가나다','사아자']);
 assert.deepEqual(rosterFromSheet(rows,'2').map(s=>s.name),['라마바']);
 assert.equal(rosterFromSheet(rows,1)[0].phone,'010-1111-2222');
 assert.throws(()=>rosterFromSheet([['이름','성별']],1),/머리글/);
});

test('upload rows come from CheckHere times; blank days keep their row and missing data is reported instead of guessed',()=>{
 const roster=[{name:'가나다',birth:'2000.01.02',gender:'남성',phone:'010-1111-2222'},{name:'라마바',birth:'1998.03.04',gender:'여성'},
  {name:'동명',birth:'1999.07.08',gender:'남성',phone:'010-0000-1234'},{name:'동명',birth:'2001.09.10',gender:'여성',phone:'010-0000-5678'}];
 const records=[
  {date:'2026-09-01',name:'라마바',entry:'09:01:30',exit:'17:50:00',outings:[{start:'13:20:00',end:'15:37:00'}]},
  {date:'2026-08-31',name:'가 나다',entry:'08:58:00',exit:'18:02:00',outings:[]},
  {date:'2026-09-01',name:'가나다',entry:null,exit:null,outings:[]},
  {date:'2026-09-01',name:'동명',phoneLast4:'5678',entry:'09:00:00',exit:'18:00:00'},
  {date:'2026-09-02',name:'동명',entry:'09:00:00',exit:null},
  {date:'2026-09-02',name:'없는사람',entry:'09:10:00',exit:'18:00:00',outings:[{start:'10:00:00',end:'10:10:00'},{start:'14:00:00',end:null}]}
 ];
 const {rows,issues,stats}=buildUploadRows({records,roster,courseId:'AIG2026',round:'1'});
 assert.deepEqual(rows,[
  ['AIG2026','1','가나다','0001023','20260831','0858','1802','',''],
  ['AIG2026','1','가나다','0001023','20260901','','','',''],
  ['AIG2026','1','동명','0109104','20260901','0900','1800','',''],
  ['AIG2026','1','라마바','9803042','20260901','0901','1750','1320','1537'],
  ['AIG2026','1','동명','','20260902','0900','','',''],
  ['AIG2026','1','없는사람','','20260902','0910','1800','1000','1010']
 ]);
 assert.deepEqual(stats,{rows:6,students:4,days:3,empty:1,coded:3,leavers:0,cut:0});
 const said=(date,name)=>issues.filter(i=>i.date===date&&i.name===name).map(i=>i.issue).join(' / ');
 assert.equal(said('2026-09-01','가나다'),'입실·퇴실 기록이 없어 시각을 비운 채 행을 남겼습니다 (결석 또는 미수집)');
 assert.match(said('2026-09-02','동명'),/동명이인/);assert.match(said('2026-09-02','동명'),/퇴실 시각이 없습니다/);
 assert.match(said('2026-09-02','없는사람'),/명단에 없는 이름/);assert.match(said('2026-09-02','없는사람'),/외출 2회/);
 assert.equal(said('2026-09-01','라마바'),'');
});

test('the ledger fills missing outing times and marks absences; leavers stop after their last attended day',()=>{
 const roster=[{name:'가나다',birth:'2000.01.02',gender:'남성'},{name:'라마바',birth:'1998.03.04',gender:'여성'},{name:'사아자',birth:'2001.05.06',gender:'남성'},{name:'차카타',birth:'1999.07.08',gender:'여성'}];
 const records=[
  {date:'2026-09-22',name:'차카타',entry:'09:00:00',exit:'18:00:00'},
  {date:'2026-09-23',name:'가나다',entry:'08:55:00',exit:'18:01:00',outingCount:1,outings:[]},
  {date:'2026-09-23',name:'라마바',entry:null,exit:null},
  {date:'2026-09-23',name:'사아자',entry:'09:02:00',exit:'17:58:00',outingCount:2,outings:[],readState:'partial'},
  {date:'2026-09-23',name:'차카타',entry:null,exit:null},
  {date:'2026-09-24',name:'라마바',entry:'09:00:00',exit:'18:00:00'},
  {date:'2026-09-24',name:'차카타',entry:null,exit:null}
 ];
 const ledger=new Map([['가나다|2026-09-23',{type:'외출',oa:'09:00',ob:'10:00'}],['라마바|2026-09-23',{type:'결석'}],['라마바|2026-09-24',{type:'결석'}],['사아자|2026-09-23',{type:'외출',oa:'00:00',ob:'00:00'}]]);
 const {rows,issues,stats}=buildUploadRows({records,roster,ledger,leavers:new Map([['차카타','조기취업']])});
 assert.deepEqual(rows.map(r=>r.slice(2)),[
  ['차카타','9907082','20260922','0900','1800','',''],
  ['가나다','0001023','20260923','0855','1801','0900','1000'],
  ['라마바','9803042','20260923','','','',''],
  ['사아자','0105063','20260923','0902','1758','',''],
  ['라마바','9803042','20260924','0900','1800','','']
 ]);
 assert.equal(stats.leavers,1);assert.equal(stats.cut,2);assert.equal(stats.empty,1);
 const said=(date,name)=>issues.filter(i=>i.date===date&&i.name===name).map(i=>i.issue).join(' / ');
 assert.equal(said('2026-09-23','가나다'),'외출 시각은 출결원장 값을 넣었습니다');
 assert.equal(said('2026-09-23','라마바'),'결석 · 시각을 비운 채 행을 남겼습니다');
 assert.match(said('2026-09-23','사아자'),/외출 기록이 있지만 시각을 찾지 못해 비웠습니다 \(체크히어 외출 2회, 상세 미수집\)/);
 assert.equal(said('2026-09-24','라마바'),'출결원장은 결석인데 체크히어에 입실·퇴실 시각이 있습니다');
 assert.equal(said('2026-09-22','차카타'),'조기취업 · 마지막 출석일(2026-09-22) 다음 2일은 행을 만들지 않았습니다');
 const none=buildUploadRows({records:[{date:'2026-09-01',name:'차카타',entry:null,exit:null}],roster,leavers:new Map([['차카타','중도포기']])});
 assert.equal(none.rows.length,0);assert.match(none.issues[0].issue,/이 기간에 출석 기록이 없어 1일 모두/);
});
