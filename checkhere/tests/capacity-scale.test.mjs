// 반별 정원(최신 확정 명단 2026-10-22, 합 511명, 최대 40명)만큼 학생이 들어와도 사이트 계산·출석부가 그대로 맞는지(사용자 2026-10-23 "각 반 인원 반영해서 미리 반영, 문제 없는지 테스트").
// 학생 이름은 모두 가상입니다. 시트 반 탭 출결판 줄 늘리기는 시트 세션(Apps Script growBoard_) 몫이고, 여기서는 웹 계산만 봅니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeBundle,studentStats,dayView,ledgerIndex} from '../../beta2-core.mjs';
import {absenceRows} from '../../beta2-dropout-core.mjs';
import {allowanceUnits} from '../../allowance-core.mjs';
import {prepareB2Period,b2PeriodProfile} from '../../attendance-period-b2-core.mjs';
import {buildPeriodWorkbook} from '../../attendance-period-workbook.mjs';
import {REAL_CLASSES,TRAINING_DAYS,UNIT_PERIODS} from '../../cohort.mjs';

const TEMPLATES=JSON.parse(readFileSync(new URL('../../attendance-period-templates.json',import.meta.url),'utf8'));
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'베타 수정',flag:'',sig:'s',...o})[k]);
const TYPES=['결석','지각','조퇴','외출','인정출석','중복'];
const name=(c,i)=>`가상${c}반-${String(i).padStart(2,'0')}`;
// 16개 반 × 정원, 학생마다 교육일 앞쪽 30일 중 6일에 예외 기록(합 3천여 줄)
function raw(){
 const roster=[],ledger=[],days=TRAINING_DAYS.slice(0,30);
 for(const c of REAL_CLASSES)for(let i=1;i<=c.capacity;i++){
  roster.push([c.id,name(c.id,i),i%17===0?'중도탈락':'재학',i%17===0?days[20]:'']);
  for(let k=0;k<6;k++)ledger.push(L(days[(i*7+k*5)%days.length],c.id,name(c.id,i),TYPES[(i+k)%TYPES.length],{reason:'시험'}));
 }
 return {rev:1,today:days[29],days:[...TRAINING_DAYS],classes:REAL_CLASSES.map(c=>({id:c.id,region:c.region,course:c.course,venue:c.venue,capacity:c.capacity})),roster,ledgerCols:COLS,ledger,sync:{}};
}

test('every class at its full capacity (511 students, up to 40 a class): stats, absence limits and fee units cover everyone, quickly',()=>{
 assert.equal(REAL_CLASSES.reduce((n,c)=>n+c.capacity,0),511);assert.equal(Math.max(...REAL_CLASSES.map(c=>c.capacity)),40);
 const t0=performance.now(),b=decodeBundle(raw()),index=ledgerIndex(b);
 const stats=studentStats(b,{},index),rows=absenceRows(b,{}),ms=performance.now()-t0;
 assert.equal(stats.length,511);assert.equal(rows.length,511);
 for(const c of REAL_CLASSES){
  assert.equal(stats.filter(s=>s.cls===c.id).length,c.capacity,c.id+'반 통계 인원 = 정원');
  const day=dayView(b,c.id,b.today,index);assert(day.length<=c.capacity,c.id+'반 그날 줄');
 }
 for(const s of stats){assert.equal(s.units.length,UNIT_PERIODS.length);assert.equal(allowanceUnits(s.units).length,UNIT_PERIODS.length);}
 assert(ms<8000,`511명 계산 ${Math.round(ms)}ms`);
});

// buildPeriodWorkbook이 쓰는 만큼만 흉내 낸 ExcelJS(attendance-period-b2.test.mjs와 같은 방식)
const parse=a=>{const m=a.match(/^([A-Z]+)(\d+)$/);return [+m[2],[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)];};
class FakeCell{constructor(){this.value=null;this.style={};}get font(){return this.style.font;}set font(v){this.style={...this.style,font:v};}get alignment(){return this.style.alignment;}set alignment(v){this.style={...this.style,alignment:v};}get numFmt(){return this.style.numFmt;}set numFmt(v){this.style={...this.style,numFmt:v};}get formula(){return this.value?.formula;}}
class FakeSheet{
 constructor(name){this.name=name;this.cells=new Map();this.rows=new Map();this.cols=new Map();this.merges=[];this.pageSetup={};this.views=[];this.rowCount=0;}
 getCell(r,c){if(typeof r==='string')[r,c]=parse(r);const k=r+','+c;if(!this.cells.has(k))this.cells.set(k,new FakeCell());this.rowCount=Math.max(this.rowCount,r);return this.cells.get(k);}
 getRow(r){if(!this.rows.has(r))this.rows.set(r,{number:r,height:undefined,font:undefined,eachCell:fn=>[...this.cells].filter(([k])=>+k.split(',')[0]===r).forEach(([,c])=>fn(c))});return this.rows.get(r);}
 getColumn(c){if(!this.cols.has(c))this.cols.set(c,{width:undefined,alignment:undefined});return this.cols.get(c);}
 get columns(){const n=Math.max(0,...[...this.cells.keys()].map(k=>+k.split(',')[1]));return Array.from({length:n},(_,i)=>this.getColumn(i+1));}
 addRow(values){const r=this.rowCount+1;values.forEach((v,i)=>this.getCell(r,i+1).value=v);this.rowCount=r;return this.getRow(r);}
 mergeCells(){}
 eachRow(fn){[...new Set([...this.cells.keys()].map(k=>+k.split(',')[0]))].sort((a,b)=>a-b).forEach(r=>fn(this.getRow(r)));}
}
const FakeExcel={Workbook:class{constructor(){this.calcProperties={};this.worksheets=[];}addWorksheet(name){const s=new FakeSheet(name);this.worksheets.push(s);return s;}}};

test('a 40-student class prints one unit-period attendance sheet row per student and shows its 정원',()=>{
 const b=decodeBundle(raw()),p=UNIT_PERIODS[0],cls=REAL_CLASSES.find(c=>c.capacity===40);
 const r=prepareB2Period({bundle:b,classId:cls.id,from:p.from,to:p.to});
 assert.equal(r.students.length,40);
 const book=buildPeriodWorkbook(FakeExcel,r,TEMPLATES,cls.id,{profile:b2PeriodProfile(TEMPLATES,cls.id,b.classes.find(c=>c.id===cls.id))}),s=book.worksheets[0];
 assert.equal(s.getCell('C11').value,'수강생 전체 40명');assert.equal(s.getCell(9,3).value,'40명');
 const names=Array.from({length:40},(_,i)=>s.getCell(18+i,2).value).filter(Boolean);
 assert.equal(new Set(names).size,40,'18~57행에 40명');
});
