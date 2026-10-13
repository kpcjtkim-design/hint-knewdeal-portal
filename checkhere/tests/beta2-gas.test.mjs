import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseAttendanceReasons,reasonFor} from '../../attendance-reason-core.mjs';
import {overviewColorState} from '../../attendance-beta-core.mjs';

// Apps Script 파일을 서비스 없이 불러와 순수 함수만 시험합니다.
const gas=vm.createContext({console});
vm.runInContext(readFileSync(new URL('../../apps-script/beta2/beta2.gs',import.meta.url),'utf8'),gas);
const g=name=>gas[name];
const plain=x=>JSON.parse(JSON.stringify(x));

const REASONS=[
 '지각1- 한수빈_교통편문제',
 '인정결석1                   임태종_면접결석',
 '결석2- 고다원_면접준비,  최다운_개인일정                     \n\n인정결석2-최건용_면접, 조오성_면접',
 '외출1- 성진욱_개인일정\n\n인정결석1-고다원_면접\n지각2-최승범_교통사정, 김민재_교통사정',
 '결석2-김민선_개인일정, 배민오_개인일정\n\n지각1- 김진유_개인일정\n조퇴2- 한수빈_개인일정, 최건용_개인일정',
 '*발생사유기재\n\n*사유 없을 시 해당없음으로 기재',
 '지각: 김민수(99년생) 교통, 김민수(02년생) 병원\n결석 - 이승현 개인사정',
 '인정출석\n김민수(99) 병원 진료\n조퇴 이승현(01년생)_면접'
];
const ROSTER=['한수빈','임태종','고다원','최다운','최건용','조오성','성진욱','최승범','김민재','김민선','배민오','김진유','황보재','김민수(99년생)','김민수(02년생)','이승현(98년생)','이승현(01년생)'];

test('the Apps Script reason parser gives the same result as the portal parser',()=>{
 for(const text of REASONS){
  const a=g('b2ParseReasons_')(text,ROSTER),b=parseAttendanceReasons(text,ROSTER);
  assert.equal(JSON.stringify(a),JSON.stringify(b),text);
  for(const name of ROSTER){const r=g('b2ReasonFor_')(name,a);assert.equal(r.reason,reasonFor(name,text,ROSTER),`${name} · ${text}`);}
 }
 assert.equal(g('b2ReasonFor_')('최건용',g('b2ParseReasons_')(REASONS[2],ROSTER)).reason,'면접');
});

test('evidence colours use the portal colour rule',()=>{
 for(const c of ['#ffff00','#ff0000','#ffffff','#fff2cc','#f4cccc','#00ff00','','#ea9999','#ffd966'])assert.equal(g('b2ColorState_')(c),overviewColorState(c),c);
});

const head=['이름','출석률','출석일수','지/조/외/중복','7/27','7/28','7/29','7/30','7/31','8/3','10/14'];
function grid(rows,reasons={}){
 const values=[head];for(let i=0;i<30;i++)values.push(rows[i]||['','','','']);
 values.push([]);
 values.push(['가-3. 출결사유관리','','','',...head.slice(4)]);
 values.push(['*','','','',...head.slice(4).map(h=>reasons[h]||'')]);
 return values;
}
const DAYS=Object.fromEntries(['2026-07-27','2026-07-28','2026-07-29','2026-07-30','2026-07-31','2026-08-03','2026-10-14'].map(d=>[d,true]));

test('one 운영총괄 class tab becomes exception rows with reasons, evidence and dropout dates',()=>{
 const values=grid([
  ['한수빈','','','','지각','출석','출석','출석','출석','출석','출석'],
  ['임태종','','','','출석','출석','출석','인정출석','인정출석','중복',''],
  ['고다원','','','','출석','결석','해당없음','해당없음','해당없음','해당없음',''],
  ['황보재','','','','출석','인정결석','이상한값','출석','출석','중복(지각+외출, 지각+조퇴, 외출+조퇴)',''],
 ],{'7/27':'지각1- 한수빈_교통편문제','7/30':'인정결석1 임태종_면접결석','7/28':'결석1- 고다원:면접준비\n인정출석 황보재_예비군'});
 const bg=values.map(r=>r.map(()=> '#ffffff'));bg[2][7]='#ffff00';bg[2][8]='#ff0000';
 const out=g('b2ParseGrid_')('1',values,bg,'2026-10-13',DAYS);
 assert.deepEqual(plain(out.dates),['2026-07-27','2026-07-28','2026-07-29','2026-07-30','2026-07-31','2026-08-03']);
 const rows=plain(out.records.map(r=>[r.date,r.name,r.type,r.reason,r.ev,r.note]));
 assert.deepEqual(rows,[
  ['2026-07-27','한수빈','지각','교통편문제','',''],
  ['2026-07-30','임태종','인정출석','면접결석','확인',''],
  ['2026-07-31','임태종','인정출석','','반려',''],
  ['2026-08-03','임태종','중복','','','운영총괄 중복 표시 · 유형 확인 필요'],
  ['2026-07-28','고다원','결석','면접준비','',''],
  ['2026-07-28','황보재','인정출석','예비군','',''],
  ['2026-07-29','황보재','이상한값','','','운영총괄 값 확인 필요: 이상한값'],
  ['2026-08-03','황보재','중복','','','운영총괄 중복 표시 · 유형 확인 필요']
 ]);
 assert.deepEqual(JSON.parse(JSON.stringify(out.students)),[{name:'한수빈',dropoutFrom:'',lastDay:''},{name:'임태종',dropoutFrom:'',lastDay:''},{name:'고다원',dropoutFrom:'2026-07-29',lastDay:'2026-07-28'},{name:'황보재',dropoutFrom:'',lastDay:''}]);
 assert.throws(()=>g('b2ParseGrid_')('1',grid([]).map((r,i)=>i===0?[...head.slice(0,5),'7/27']:r),null,'2026-10-13',DAYS),/겹칩니다/);
});

const rec=(date,name,type,extra={})=>({date,cls:'1',name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',...extra});
test('merging keeps edited rows, follows untouched synced rows and flags differences',()=>{
 const sig=g('b2Sig_');
 const synced=rec('2026-07-27','가','지각',{reason:'교통'}),edited=rec('2026-07-28','나','결석',{reason:'개인'}),gone=rec('2026-07-29','다','지각');
 const unknownSame=rec('2026-07-30','라','결석'),unknownDiff=rec('2026-07-30','마','결석'),released=rec('2026-07-31','바','결석'),outside=rec('2026-10-14','사','지각');
 const existing=[
  {rec:synced,prov:'1기 동기화',sig:sig(synced)},
  {rec:edited,prov:'베타 수정',sig:''},
  {rec:gone,prov:'1기 동기화',sig:sig(gone)},
  {rec:unknownSame,prov:'',sig:''},
  {rec:unknownDiff,prov:'',sig:''},
  {rec:released,prov:'1기 동기화',sig:'*'},
  {rec:{...rec('2026-07-27','아','지각'),inT:'09:20'},prov:'1기 동기화',sig:'deadbeef'},
  {rec:outside,prov:'1기 동기화',sig:sig(outside)}
 ];
 const desired=[rec('2026-07-27','가','결석',{reason:'병원'}),rec('2026-07-28','나','지각',{reason:'교통'}),rec('2026-07-30','라','결석'),rec('2026-07-30','마','지각'),rec('2026-07-31','바','인정출석',{reason:'면접',ev:'확인'}),rec('2026-07-27','아','지각'),rec('2026-07-29','자','외출',{note:'메모'})];
 const scope={'1':Object.fromEntries(['2026-07-27','2026-07-28','2026-07-29','2026-07-30','2026-07-31'].map(d=>[d,true]))};
 const {rows,stats,changed}=g('b2Merge_')(existing,desired,scope);
 const view=plain(rows.map(r=>[r.rec.date,r.rec.name,r.rec.type,r.prov,r.flag]));
 assert.deepEqual(view,[
  ['2026-07-27','가','결석','1기 동기화',''],
  ['2026-07-27','아','지각','1기 동기화',''],
  ['2026-07-28','나','결석','베타 수정',"운영총괄 값: 지각 / 사유 '교통'"],
  ['2026-07-29','자','외출','1기 동기화','메모'],
  ['2026-07-30','라','결석','1기 동기화',''],
  ['2026-07-30','마','결석','직접 입력','운영총괄 값: 지각'],
  ['2026-07-31','바','인정출석','1기 동기화',''],
  ['2026-10-14','사','지각','1기 동기화','']
 ]);
 assert.equal(rows.find(r=>r.rec.name==='아').rec.inT,'09:20','지문이 다른 동기화 행은 손댄 행으로 봅니다');
 assert.deepEqual(JSON.parse(JSON.stringify(stats)),{added:1,updated:2,removed:1,adopted:1,flagged:2,kept:1});
 assert.deepEqual(plain(changed),['1']);
 assert.equal(rows.find(r=>r.rec.name==='바').sig,sig(desired[4]));
 const again=g('b2Merge_')(rows.map(r=>({rec:r.rec,prov:r.prov,sig:r.sig,flag:r.flag})),desired,scope);
 assert.deepEqual(plain(again.changed),[],'같은 원본으로 다시 돌리면 바뀌는 것이 없습니다');
});

test('a beta 출석 override stays and is flagged against the source; duplicate rows are flagged',()=>{
 const sig=g('b2Sig_'),a=rec('2026-07-27','가','출석');
 const {rows}=g('b2Merge_')([{rec:a,prov:'베타 수정',sig:''},{rec:rec('2026-07-28','나','결석'),prov:'1기 동기화',sig:sig(rec('2026-07-28','나','결석'))},{rec:rec('2026-07-28','나','결석'),prov:'1기 동기화',sig:'x'}],[rec('2026-07-27','가','지각')],{'1':{'2026-07-27':true,'2026-07-28':true}});
 assert.equal(rows.find(r=>r.rec.name==='가').flag,'운영총괄 값: 지각');
 assert.deepEqual(plain(rows.filter(r=>r.rec.name==='나').map(r=>r.flag)),['같은 학생·날짜 기록이 여러 줄입니다']);
});

test('roster merge adds students, marks dropouts only over 재학/blank and fills birth data by class and birth year',()=>{
 const roster=[{row:2,cls:'1',name:'가',status:'재학',changed:'',birth:'',gender:''},{row:3,cls:'1',name:'나',status:'조기취업',changed:'2026-09-01',birth:'2000-01-01',gender:'남성'}];
 const people=[{cls:'1',name:'가',birth:'1999-05-31',gender:'여성'},{cls:'1',name:'나',birth:'2000-01-01',gender:'남성'},{cls:'9',name:'김민수',birth:'1999-02-03',gender:'남성'},{cls:'9',name:'김민수',birth:'2002-04-05',gender:'남성'},{cls:'9',name:'동명',birth:'2001-01-01',gender:'여성'},{cls:'9',name:'동명',birth:'2001-02-02',gender:'남성'}];
 roster.push({row:4,cls:'1',name:'다',status:'중도포기',changed:'2026-09-10',birth:'2001-01-01',gender:'남성'},{row:5,cls:'1',name:'라',status:'중도포기',changed:'2026-09-01',birth:'2001-01-01',gender:'남성'});
 const out=g('b2MergeRoster_')(roster,{'1':[{name:'가',dropoutFrom:'2026-09-10',lastDay:'2026-09-09'},{name:'나',dropoutFrom:'2026-09-10',lastDay:'2026-09-09'},{name:'다',dropoutFrom:'2026-09-10',lastDay:'2026-09-09'},{name:'라',dropoutFrom:'',lastDay:''}],'9':[{name:'김민수(02년생)',dropoutFrom:''},{name:'동명',dropoutFrom:''}]},people);
 assert.deepEqual(JSON.parse(JSON.stringify(out.updates)),[{status:'중도탈락',changed:'2026-09-09',birth:'1999-05-31',gender:'여성',row:2},{status:'중도탈락',changed:'2026-09-09',row:4},{status:'중도탈락',changed:'2026-09-01',row:5}],'old beta2 wording is migrated to the sheet term');
 assert.deepEqual(JSON.parse(JSON.stringify(out.appends)),[{cls:'9',name:'김민수(02년생)',status:'재학',changed:'',birth:'2002-04-05',gender:'남성'},{cls:'9',name:'동명',status:'재학',changed:'',birth:'',gender:''}]);
});

test('admin saves are validated before touching the sheet',()=>{
 const ctx={days:{'2026-09-01':true,'2026-10-14':true},today:'2026-10-13',rosterHas:true},v=p=>g('b2Validate_')({cls:'1',name:'가',date:'2026-09-01',ev:'',...p},ctx);
 assert.deepEqual(plain(v({type:'지각',inT:'09:20'})),[]);
 assert.match(v({type:'지각'}).join(),/입실 시간/);
 assert.match(v({type:'인정출석'}).join(),/사유가 필요/);
 assert.match(v({type:'외출',oa:'13:00',ob:'12:00'}).join(),/늦어야/);
 assert.match(v({type:'결석',ev:'반려'}).join(),/반려 사유/);
 assert.match(v({type:'결석',date:'2026-10-14'}).join(),/아직 오지 않은/);
 assert.match(v({type:'결석',date:'2026-09-02'}).join(),/교육일이 아닌/);
 assert.match(g('b2Validate_')({cls:'18',name:'가',date:'2026-09-01',type:'결석',ev:''},{...ctx,rosterHas:false}).join(),/반 번호.*명부/);
 assert.deepEqual(plain(v({type:'출석'})),[]);
});

test('1기 document requests map onto the master 서류발급 columns',()=>{
 const d=g('b2DocFromSource_')(['','20260813','4반','이경수','2001.06.23','2026년 7월 27일 ~ 8월 14일','출석부','취업','국민취업제도 운영기관','20260818','처리완료','개인 톡 전달'],6);
 assert.deepEqual(plain(g('B2_DOC_FIELDS').map(k=>d[k])),['1기-6','2026-08-13','4반','이경수','2001.06.23','기간: 2026년 7월 27일 ~ 8월 14일 · 목적: 취업','국민취업제도 운영기관','2026-08-18','처리완료','개인 톡 전달','출석부','','','1기 운영총괄','','','','']);
 assert.equal(g('b2DocFromSource_')(['','','','','x'],7),null);
 assert.equal(Object.keys(g('B2_ACTIONS')).length,9);
});

test('reasons carrying times move into the time columns and board cells use the Code.gs notation',()=>{
 const split=(t,r)=>plain(g('b2SplitReason_')(t,r));
 assert.deepEqual(split('지각','09:14'),{reason:'',inT:'09:14',outT:'',oa:'',ob:''});
 assert.deepEqual(split('조퇴','토익시험 15:53'),{reason:'토익시험',inT:'',outT:'15:53',oa:'',ob:''});
 assert.deepEqual(split('외출','개인일정(9:00-10:00)'),{reason:'개인일정',inT:'',outT:'',oa:'09:00',ob:'10:00'});
 assert.deepEqual(split('인정출석','병결(인)'),{reason:'병결',inT:'',outT:'',oa:'',ob:''});
 assert.deepEqual(split('결석','면접 9:30'),{reason:'면접 9:30',inT:'',outT:'',oa:'',ob:''},'times stay in the reason when the type has no time column');
 assert.equal(g('b2NormType_')('중복(지각+외출, 지각+조퇴, 외출+조퇴)'),'중복');assert.equal(g('b2NormType_')('인정결석'),'인정출석');
 const cell=g('b2BoardCell_'),left={status:'중도탈락',changed:'2026-09-09'};
 assert.equal(cell({type:'인정출석',ev:''},left,'2026-09-01'),'인정출석','no evidence star on the board');
 assert.equal(cell(null,left,'2026-09-09'),'출석');assert.equal(cell(null,left,'2026-09-10'),'','blank after the last attended day');
 assert.equal(g('b2IsConflict_')('사유: 동명이인·이름 경계 확인 필요'),false);assert.equal(g('b2IsConflict_')('운영총괄 값: 증빙 확인'),true);
});
