// 2기 단위기간 출석부(사용자 2026-10-20 "단위기간 출석부 양식은 같음. 1기 양식이랑"): 출결원장 → 1기 양식 Excel.
// ExcelJS는 시험 PC에 없어서 buildPeriodWorkbook이 쓰는 만큼만 흉내 내는 가짜 Workbook으로 칸·병합·시트 이름을 봅니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeBundle} from '../../beta2-core.mjs';
import {prepareB2Period,b2PeriodProfile,b2PeriodCheck,b2PeriodFileName,b2PeriodZipName,periodIdFor,B2_REVIEW_HEADERS,B2_SOURCE_HEADERS} from '../../attendance-period-b2-core.mjs';
import {buildPeriodWorkbook} from '../../attendance-period-workbook.mjs';
import {normalizePeriodReason} from '../../attendance-period-core.mjs';
import {TRAINING_DAYS,UNIT_PERIODS,REAL_CLASS_IDS,CLASSES,COURSE_START,COURSE_END,trainingDays,addDays,feature} from '../../cohort.mjs';

const TEMPLATES=JSON.parse(readFileSync(new URL('../../attendance-period-templates.json',import.meta.url),'utf8'));
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?(o.ev||'미제출'):'해당없음',check:'',prov:'베타 수정',flag:'',sig:'s',...o})[k]);
const RAW={rev:3,today:'2026-11-06',days:[...TRAINING_DAYS],
 classes:[{id:'1',region:'서울',course:'모빌리티 AI',hrdName:'[현대자동차그룹 HINT] 모빌리티 AI_서울대',teacher:'김담임',venue:'서울대',address:'서울 관악구 관악로 1'},{id:'2',region:'서울',course:'제조지능화',hrdName:'',venue:'한양대',address:''}],
 roster:[['1','가상가','재학',''],['1','가상나','중도탈락','2026-11-04'],['1','가상다','',''],['2','가상라','재학','']],ledgerCols:COLS,
 ledger:[L('2026-11-02','1','가상가','지각',{inT:'09:20',reason:'교통'}),L('2026-11-03','1','가상가','인정출석',{reason:'병원(치과)'}),L('2026-11-04','1','가상가','인정지각',{reason:'면접(최종)',ev:'반려',evr:'날짜 없음',inT:'10:30'}),
  L('2026-11-05','1','가상다','결석'),L('2026-11-07','1','가상다','인정출석',{reason:'취업박람회'}),L('2026-11-05','1','가상나','출석'),L('2026-11-05','1','모르는이','결석'),
  L('2026-11-06','1','가상다','조퇴',{outT:'15:00',reason:'개인 사정',check:'시간 확인'}),L('2026-11-03','2','가상라','결석')],sync:{}};
const bundle=()=>decodeBundle(RAW);

// buildPeriodWorkbook이 쓰는 ExcelJS 모양만 흉내 냅니다.
const letters=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const parse=a=>{const m=a.match(/^([A-Z]+)(\d+)$/);return [+m[2],[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)];};
class FakeCell{constructor(){this.value=null;this.style={};}get font(){return this.style.font;}set font(v){this.style={...this.style,font:v};}get alignment(){return this.style.alignment;}set alignment(v){this.style={...this.style,alignment:v};}get numFmt(){return this.style.numFmt;}set numFmt(v){this.style={...this.style,numFmt:v};}get formula(){return this.value?.formula;}}
class FakeSheet{
 constructor(name){this.name=name;this.cells=new Map();this.rows=new Map();this.cols=new Map();this.merges=[];this.pageSetup={};this.views=[];this.rowCount=0;}
 getCell(r,c){if(typeof r==='string')[r,c]=parse(r);const k=r+','+c;if(!this.cells.has(k))this.cells.set(k,new FakeCell());this.rowCount=Math.max(this.rowCount,r);return this.cells.get(k);}
 getRow(r){if(!this.rows.has(r))this.rows.set(r,{number:r,height:undefined,font:undefined,eachCell:fn=>[...this.cells].filter(([k])=>+k.split(',')[0]===r).forEach(([,c])=>fn(c))});return this.rows.get(r);}
 getColumn(c){if(!this.cols.has(c))this.cols.set(c,{width:undefined,alignment:undefined});return this.cols.get(c);}
 get columns(){const n=Math.max(0,...[...this.cells.keys()].map(k=>+k.split(',')[1]));return Array.from({length:n},(_,i)=>this.getColumn(i+1));}
 addRow(values){const r=this.rowCount+1;values.forEach((v,i)=>this.getCell(r,i+1).value=v);this.rowCount=r;return this.getRow(r);}
 mergeCells(r1,c1,r2,c2){this.merges.push(`${letters(c1)}${r1}:${letters(c2)}${r2}`);}
 eachRow(fn){[...new Set([...this.cells.keys()].map(k=>+k.split(',')[0]))].sort((a,b)=>a-b).forEach(r=>fn(this.getRow(r)));}
 text(r,c){return this.getCell(r,c).value;}
}
const FakeExcel={Workbook:class{constructor(){this.calcProperties={};this.worksheets=[];}addWorksheet(name){const s=new FakeSheet(name);this.worksheets.push(s);return s;}}};

test('2기 unit periods follow the 1기 rule (start + 1 month - 1 day, last one ends at the course end) and cover the 60 training days',()=>{
 assert.equal(TRAINING_DAYS.length,60);
 const monthEnd=from=>{const d=new Date(from+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return addDays(d.toISOString().slice(0,10),-1);};
 assert.equal(UNIT_PERIODS[0].from,COURSE_START);assert.equal(UNIT_PERIODS.at(-1).to,COURSE_END);
 UNIT_PERIODS.forEach((p,i)=>{if(i<UNIT_PERIODS.length-1){assert.equal(p.to,monthEnd(p.from),p.no+'단위');assert.equal(UNIT_PERIODS[i+1].from,addDays(p.to,1));}});
 assert.deepEqual(UNIT_PERIODS.map(p=>trainingDays({from:p.from,to:p.to}).length),[23,19,18]);
 assert.equal(periodIdFor('2026-11-02','2026-11-06','custom'),'1');assert.equal(periodIdFor('2026-11-20','2026-12-04','custom'),'사용자지정');assert.equal(periodIdFor('x','y','2'),'2');
 assert.equal(feature('periodRoster'),true);
});

test('ledger rows become 1기-shaped period cells: types, implied attendance, leavers, future blanks, remarks and review rows',()=>{
 const p=UNIT_PERIODS[0],r=prepareB2Period({bundle:bundle(),classId:'1',from:p.from,to:p.to});
 assert.equal(r.dates.length,23);assert.equal(r.dates[0],'2026-10-28');assert.ok(!r.dates.includes('2026-11-07'),'weekends are not training days');
 assert.deepEqual(r.students.map(s=>[s.name,s.trainingStatus]),[['가상가','훈련중'],['가상나','중도포기'],['가상다','훈련중']]);
 const cell=(name,date)=>r.students.find(s=>s.name===name).cells.find(c=>c.date===date);
 assert.equal(cell('가상가','2026-11-02').status,'지각');assert.equal(cell('가상가','2026-11-03').status,'인정출석');assert.equal(cell('가상가','2026-11-04').status,'인정지각');
 assert.equal(cell('가상가','2026-11-05').status,'출석','no ledger row = attended');assert.equal(cell('가상가','2026-11-09').status,'','future days stay blank like the 1기 sheet');
 assert.equal(cell('가상나','2026-11-04').status,'출석');assert.equal(cell('가상나','2026-11-05').status,'출석','a row after the last attendance day keeps the ledger value');assert.equal(cell('가상나','2026-11-06').status,'해당없음');assert.equal(cell('가상나','2026-11-27').status,'해당없음');
 assert.equal(cell('가상다','2026-11-05').status,'결석');assert.equal(cell('가상다','2026-11-05').reason,'개인사정','an empty reason becomes 개인사정 like 1기');
 assert.equal(r.students[0].remarks,['11/2(지각-'+normalizePeriodReason('교통')+')','11/3(인정출석-'+normalizePeriodReason('병원(치과)')+')','11/4(인정지각-'+normalizePeriodReason('면접(최종)')+')'].join('\n'));
 assert.equal(normalizePeriodReason('병원(치과)'),'병원');
 assert.deepEqual({cells:r.stats.cells,students:r.stats.students,full:r.stats.recognizedFull,late:r.stats.recognizedLate,personal:r.stats.personal,dropout:r.stats.dropout,miss:r.stats.evidenceMissing,rej:r.stats.evidenceRejected},{cells:69,students:3,full:1,late:1,personal:1,dropout:1,miss:1,rej:1});
 assert.equal(r.stats.future,2*15,'가상가·가상다 have 15 future training days after 11/6');
 const msgs=r.reviews.map(x=>x[1]+'|'+x[2]+'|'+x[6]);
 for(const m of ['가상가|2026-11-03|증빙서류 미제출','가상가|2026-11-04|증빙서류 반려 - 날짜 없음','가상다|2026-11-07|교육일이 아닌 날의 출결원장 기록 - 출석부에 넣지 않음','모르는이|2026-11-05|명부에 없는 이름의 출결원장 기록 - 출석부에 넣지 않음','가상다|2026-11-06|시트 입력 확인: 시간 확인'])assert.ok(msgs.includes(m),m);
 assert.ok(msgs.some(m=>m.startsWith('가상나|2026-11-05|명부 상태 중도탈락')));
 assert.ok(r.reviews.every(x=>x.length===B2_REVIEW_HEADERS.length));
 assert.deepEqual(r.source.headers,B2_SOURCE_HEADERS);assert.equal(r.source.rows.length,7,'all training-day rows of this class in the period (the weekend row and class 2 are left out)');
 const check=b2PeriodCheck(r);assert.equal(check.counts.evidenceMissing,1);assert.equal(check.counts.evidenceRejected,1);assert.equal(check.counts.review,r.reviews.length-2);assert.equal(check.counts.future,30);
 assert.throws(()=>prepareB2Period({bundle:bundle(),classId:'1',from:'2026-11-07',to:'2026-11-08'}),/교육일이 없습니다/);
 assert.throws(()=>prepareB2Period({bundle:bundle(),classId:'99',from:p.from,to:p.to}),/반 번호/);
 const bad=decodeBundle({...RAW,ledger:[L('2026-11-02','1','가상가','인정결석')]}); // 모르는 유형('중복'은 2026-10-20부터 유형)
assert.throws(()=>prepareB2Period({bundle:bad,classId:'1',from:p.from,to:p.to}),/옮길 수 없습니다/);
 const blank=prepareB2Period({bundle:decodeBundle({...RAW,ledger:[L('2026-11-02','1','가상가','',{evr:'메모만'})]}),classId:'1',from:p.from,to:p.to});assert.equal(blank.students[0].cells.find(c=>c.date==='2026-11-02').status,'출석');assert.ok(blank.reviews.some(x=>x[6].startsWith('출결원장 출결 칸이 비어 있음')));
 const later=prepareB2Period({bundle:bundle(),classId:'1',from:'2026-10-28',to:'2026-11-04'});assert.equal(later.students[1].trainingStatus,'훈련중','leaving on/after the period end is still 훈련중 for that period');
});

test("a ledger '해당없음' (selectable by admins and teachers since sheet v14) keeps the template grey and never makes an enrolled student a dropout",()=>{
 const p=UNIT_PERIODS[0],tail=TRAINING_DAYS.filter(d=>d>='2026-11-02'&&d<=p.to);
 const raw={...RAW,today:'2026-11-27',ledger:tail.map(d=>L(d,'1','가상가','해당없음'))};
 const r=prepareB2Period({bundle:decodeBundle(raw),classId:'1',from:p.from,to:p.to}),ga=r.students[0];
 assert.equal(ga.trainingStatus,'훈련중','only the roster status (중도탈락·조기취업 + change date) decides 중도포기');assert.equal(r.stats.dropout,1,'only 가상나 (roster 중도탈락)');
 assert.ok(ga.cells.filter(c=>c.date>='2026-11-02').every(c=>c.status==='해당없음'&&!c.abnormal));assert.equal(ga.remarks,'');
 assert.ok(TEMPLATES.profiles['1'].colors['해당없음'],'the 1기 template has its own 해당없음 colour');
 const book=buildPeriodWorkbook(FakeExcel,r,TEMPLATES,'1',{profile:b2PeriodProfile(TEMPLATES,'1',RAW.classes[0])}),s=book.worksheets[0];
 assert.deepEqual(s.getCell(18,10+r.dates.indexOf('2026-11-02')).font.color,TEMPLATES.profiles['1'].colors['해당없음']);
 assert.equal(s.getCell(18,5).value.result,r.dates.filter(d=>d<'2026-11-02').length,'training days = COUNTA - COUNTIF(해당없음)');
});

test('the test class can be generated on purpose: its ledger days count as training days',()=>{
 const raw={...RAW,roster:[...RAW.roster,['17','시험가','재학','']],ledger:[...RAW.ledger,L('2026-10-20','17','시험가','지각',{reason:'교통'})]};
 const r=prepareB2Period({bundle:decodeBundle(raw),classId:'17',from:'2026-10-19',to:'2026-10-30'});
 assert.deepEqual(r.dates,['2026-10-20','2026-10-28','2026-10-29','2026-10-30']);assert.equal(r.students[0].cells[0].status,'지각');
 const prof=b2PeriodProfile(TEMPLATES,'17',{});assert.match(prof.name,/^17\. 테스트반/);
});

test('one 1기 class template is filled with 2기 class headers; every 2기 sheet name fits Excel limits',()=>{
 const base=TEMPLATES.profiles['1'],prof=b2PeriodProfile(TEMPLATES,'1',RAW.classes[0]);
 for(const k of ['widths','heights','merges','pageSetup','views','colors'])assert.deepEqual(prof[k],base[k],k);
 const at=(p,r,c)=>p.cells.find(x=>x[0]===r&&x[1]===c);
 assert.equal(at(prof,1,1)[2],'출석부 (서울(관악구)_모빌리티 AI_서울대)');assert.equal(at(prof,4,3)[2],'서울 관악구 관악로 1');assert.equal(at(prof,6,3)[2],'[현대자동차그룹 HINT] 모빌리티 AI_서울대');assert.equal(at(prof,9,3)[2],'30명');
 assert.equal(at(prof,3,3)[2],at(base,3,3)[2],'훈련기관명 stays as in the 1기 file');assert.equal(at(prof,15,9)[2],'출석률');
 prof.cells.forEach((c,i)=>assert.equal(c[3],base.cells[i][3],'styles unchanged'));assert.deepEqual(prof.missing,[]);
 const two=b2PeriodProfile(TEMPLATES,'2',RAW.classes[1]);assert.deepEqual(two.missing,['소재지']);assert.equal(at(two,6,3)[2],CLASSES.find(c=>c.id==='2').official,'no 반정보 HRD name → cohort official name');
 for(const c of CLASSES){const n=b2PeriodProfile(TEMPLATES,c.id,{}).name.replace(/_\d+\s*단위기간$/,'_사용자지정 단위기간');assert.ok(n.replace('사용자지정','3').length<=31,n);assert.ok(!/[:\\/?*[\]]/.test(n),n);}
 assert.equal(b2PeriodFileName('1','1','2026-10-28','2026-11-27'),'2기_01반_1단위출석부_1028-1127.xlsx');
 assert.equal(b2PeriodZipName([...REAL_CLASS_IDS],'1','2026-10-28','2026-11-27',[...REAL_CLASS_IDS]),'2기_1-16반_1단위출석부_1028-1127.zip');
 assert.equal(b2PeriodZipName(['1','3'],'2','2026-11-28','2026-12-27',[...REAL_CLASS_IDS]),'2기_1,3반_2단위출석부_1128-1227.zip');
});

test('a workbook for a fake 2기 bundle keeps the 1기 template structure: sheet names, header cells, merges, formulas and colours',()=>{
 const p=UNIT_PERIODS[0],r=prepareB2Period({bundle:bundle(),classId:'1',from:p.from,to:p.to}),profile=b2PeriodProfile(TEMPLATES,'1',RAW.classes[0]),base=TEMPLATES.profiles['1'];
 const book=buildPeriodWorkbook(FakeExcel,r,TEMPLATES,'1',{profile});
 assert.deepEqual(book.worksheets.map(s=>s.name),['1. 서울(관악구)_모빌리티 AI_서울대_1 단위기간','확인필요','출결원장 기록']);
 assert.equal(book.calcProperties.fullCalcOnLoad,true);
 const s=book.worksheets[0],last=10+r.dates.length,oldLast=base.widths.length;
 assert.equal(last,33);
 // 머리 칸(1~15행, 날짜 열 앞 A~I)은 1기 양식과 같은 값·서식(2기 반 정보 칸과 기간·인원 칸만 다름)
 const changed=new Set(['1,1','4,3','6,3','9,3','11,3','13,3','14,1']);
 for(const [row,col,value,style] of base.cells){if(row>15||col>=10)continue;const c=s.getCell(row,col);assert.deepEqual(c.style,TEMPLATES.styles[style],`${row},${col} style`);if(!changed.has(row+','+col))assert.equal(c.value,value,`${row},${col}`);}
 assert.equal(s.text(1,1),'출석부 (서울(관악구)_모빌리티 AI_서울대)');assert.equal(s.text(3,1),'훈련기관명');assert.equal(s.text(13,3),'2026-10-28 ~ 2026-11-27');assert.equal(s.text(11,3),'수강생 전체 3명');
 assert.match(s.text(14,1),/^2기 마스터시트 출결원장 기준 · 확인필요 \d+건/);
 assert.deepEqual([1,2,3,4,5,6,7,8,9].map(c=>s.text(15,c)),['No.','성명','훈련생\n유형','훈련생\n상태','훈련\n일수','출석\n일수','결석\n일수','지/조/외/\n중복','출석률']);
 assert.equal(s.text(15,last),'비고(단위기간 10/28-11/27)');assert.equal(s.text(15,10),10);assert.equal(s.text(15,13),11);
 assert.ok(s.text(16,10) instanceof Date);assert.equal(s.text(16,10).toISOString().slice(0,10),'2026-10-28');assert.equal(s.text(17,10),'수');
 // 병합: 1기 양식의 머리 병합이 마지막 열(비고)까지 늘어나고 월 머리(10월·11월)가 새로 묶임
 for(const m of ['A1:AG1','C3:AG3','A15:A17','I15:I17','AG15:AG17','J15:L15','M15:AF15'])assert.ok(s.merges.includes(m),m);
 // 학생 줄: 1기와 같은 순서·글자·수식·글자색
 assert.deepEqual([1,2,3,4].map(c=>s.text(18,c)),[1,'가상가','실업자(일반)','훈련중']);assert.equal(s.text(19,4),'중도포기');
 assert.equal(s.getCell(18,5).value.formula,'COUNTA($J18:$AF18)-COUNTIF($J18:$AF18,"해당없음")');assert.equal(s.getCell(18,5).value.result,8,'only filled (past) days are counted');
 assert.equal(s.getCell(18,9).value.formula,'IF(E18=0,0,F18/E18)');assert.equal(s.getCell(20,7).value.result,1,'가상다 has one absence');
 const col=d=>10+r.dates.indexOf(d);
 assert.equal(s.text(18,col('2026-11-02')),'지각');assert.deepEqual(s.getCell(18,col('2026-11-02')).font.color,base.colors['지각']);
 assert.deepEqual(s.getCell(18,col('2026-11-04')).font.color,base.colors['지각'],'인정지각 uses the 지각 colour like 1기');
 assert.deepEqual(s.getCell(19,col('2026-11-27')).font.color,base.colors['해당없음']);assert.equal(s.text(18,col('2026-11-27')),'');
 assert.equal(s.text(18,last),r.students[0].remarks);
 const review=book.worksheets[1];assert.deepEqual(B2_REVIEW_HEADERS.map((_,i)=>review.text(1,i+1)),B2_REVIEW_HEADERS);assert.equal(review.rowCount,r.reviews.length+1);
 const src=book.worksheets[2];assert.equal(src.text(1,1),'날짜');assert.equal(src.text(2,2),'가상가');
});

test('the 1기 path of the workbook builder is unchanged when no 2기 options are given',()=>{
 const r={classId:'2',from:'2026-08-27',to:'2026-08-28',dates:['2026-08-27','2026-08-28'],students:[{id:'0_가',name:'가',trainingStatus:'훈련중',cells:[{date:'2026-08-27',status:'출석'},{date:'2026-08-28',status:'결석'}],remarks:'8/28(결석-개인사정)'}],reviews:[],reasons:[['2026-08-27','원문']]};
 const book=buildPeriodWorkbook(FakeExcel,r,TEMPLATES,'2');
 assert.deepEqual(book.worksheets.map(s=>s.name),['2. 수도권_제조지능화_2 단위기간','확인필요','가-3 원문']);
 assert.equal(book.worksheets[0].text(4,3),TEMPLATES.profiles['2'].cells.find(c=>c[0]===4&&c[1]===3)[2]);assert.match(book.worksheets[0].text(14,1),/^포털 DB 대조/);assert.equal(book.worksheets[1].text(1,5),'운영총괄 출결');
});

// '중복'(지각·조퇴·외출 가운데 둘 이상, 2026-10-20 시트 계약): 1기 양식의 '중복' 글자색으로 넣고, 출석일수와 지/조/외/중복 칸에 하루(1회)씩, 결석 아님
test("a ledger '중복' goes into the 1기 sheet as 중복: attended day, counted once in 지/조/외/중복, not an absence, remark M/D(중복-사유)",()=>{
 const p=UNIT_PERIODS[0],raw={...RAW,ledger:[...RAW.ledger,L('2026-11-05','1','가상가','중복',{inT:'09:40',outT:'16:00',reason:'병원'})]};
 const r=prepareB2Period({bundle:decodeBundle(raw),classId:'1',from:p.from,to:p.to}),ga=r.students[0],cell=ga.cells.find(c=>c.date==='2026-11-05');
 assert.deepEqual([cell.status,cell.abnormal],['중복',true]);assert.match(ga.remarks,/11\/5\(중복-/);
 const book=buildPeriodWorkbook(FakeExcel,r,TEMPLATES,'1',{profile:b2PeriodProfile(TEMPLATES,'1',RAW.classes[0])}),s=book.worksheets[0];
 assert.deepEqual(s.getCell(18,10+r.dates.indexOf('2026-11-05')).font.color,TEMPLATES.profiles['1'].colors['중복']);
 // 가상가: 지각(11/2)·인정지각(11/4, 1기 수식은 인정도 셈)·중복(11/5) → 지/조/외/중복 3회(중복 1회), 결석 0, 출석일수 = 훈련일수
 assert.equal(s.getCell(18,7).value.result,0);assert.equal(s.getCell(18,8).value.result,3);assert.equal(s.getCell(18,6).value.result,s.getCell(18,5).value.result);
});
