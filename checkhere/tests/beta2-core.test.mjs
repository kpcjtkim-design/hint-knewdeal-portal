import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBundle,dayView,dayCounts,studentStats,diseaseReport,compareCheckHere,timesFromRecord,neededTimes,evidenceRows,dropoutRows,isDiseaseReason,syncText} from '../../beta2-core.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,name,type,o={})=>COLS.map(k=>({date,cls:'1',name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:recognized(type)?(o.ev||'미제출'):'해당없음',check:'',prov:'1기 동기화',flag:'',sig:'s',...o})[k]);
const recognized=t=>t.startsWith('인정');
const RAW={rev:7,today:'2026-09-03',days:['2026-09-01','2026-09-02','2026-09-03','2026-09-04'],classes:[{id:'1',teacher:'김지아'}],
 roster:[['1','가','재학',''],['1','나','중도포기','2026-09-03'],['1','다','',''],['2','라','재학','']],ledgerCols:COLS,
 ledger:[L('2026-09-01','가','지각',{inT:'09:20'}),L('2026-09-02','가','인정출석',{reason:'병원 진료'}),L('2026-09-03','가','인정지각',{reason:'병결',ev:'확인',inT:'09:40'}),
  L('2026-09-01','나','결석'),L('2026-09-02','나','결석'),L('2026-09-02','다','인정조퇴',{reason:'면접',ev:'반려',evr:'날짜 없음',outT:'15:00',flag:'운영총괄 값: 조퇴'})]};

test('bundles decode into rows and a day view follows the roster with implied attendance and leavers',()=>{
 const b=decodeBundle(RAW);
 assert.equal(b.ledger.length,6);assert.equal(b.ledger[0].inT,'09:20');assert.equal(b.roster[1].changed,'2026-09-03');
 const day=dayView(b,'1','2026-09-03');
 assert.deepEqual(day.map(r=>[r.name,r.type,r.enrolled]),[['가','인정지각',true],['나','해당없음',false],['다','출석',true]]);
 assert.deepEqual(dayCounts(dayView(b,'1','2026-09-02')),{총원:3,출석:2,결석:1,지각:0,조퇴:0,외출:0,인정:2,중복:0,확인필요:1});
});

test('student statistics use the master-sheet attendance rate, evidence and disease dates from the ledger',()=>{
 const b=decodeBundle(RAW),s=studentStats(b,{cls:'1'});
 const ga=s.find(x=>x.name==='가'),na=s.find(x=>x.name==='나'),da=s.find(x=>x.name==='다');
 assert.deepEqual([ga.days,ga.absent,Math.round(ga.rate)],[3,0,100]);
 assert.deepEqual(ga.counts,{지각:1,인정출석:1,인정지각:1});
 assert.deepEqual(ga.disease,['2026-09-02','2026-09-03']);
 assert.deepEqual(ga.evidence.map(e=>e.date),['2026-09-02']);
 assert.deepEqual([na.days,na.absent,Math.round(na.rate)],[2,2,0],'days after the change date are not counted');
 assert.deepEqual(da.flags,[{date:'2026-09-02',flag:'운영총괄 값: 조퇴'}]);
 assert.deepEqual(evidenceRows(s).map(e=>[e.name,e.date,e.state]),[['가','2026-09-02','미제출'],['다','2026-09-02','반려']]);
 const {left,risk}=dropoutRows(s);
 assert.deepEqual(left.map(x=>x.name),['나']);assert.deepEqual(risk.map(x=>x.name),[]);
 assert.equal(isDiseaseReason('면접결석'),false);assert.equal(isDiseaseReason('병결'),true);
});

test('disease counts follow the ledger and differences with CheckHere hospital memos are listed for review',()=>{
 const stats=[{cls:'1',name:'가',disease:['2026-09-01','2026-09-02','2026-09-03','2026-09-04']},{cls:'1',name:'나',disease:['2026-09-01']},{cls:'2',name:'라',disease:[]}];
 const r=diseaseReport(stats,{'1':{가:['2026-09-01','2026-09-02','2026-09-05'],나:['2026-09-01']},'2':{라:['2026-09-03']}});
 assert.deepEqual(r.rows.map(x=>[x.name,x.count,x.level]),[['가',4,'주의']]);
 assert.deepEqual(r.review.map(x=>[x.name,x.onlyLedger,x.onlyCheckHere]),[['가',['2026-09-03','2026-09-04'],['2026-09-05']],['라',[],['2026-09-03']]]);
 assert.deepEqual([r.warning,r.atLimit,r.exceeded],[1,0,0]);
});

test('CheckHere times are compared with the ledger type',()=>{
 const rec=(entry,exit,extra={})=>({rawEntry:entry,entry,exit,outings:[],outingCount:0,...extra});
 assert.equal(compareCheckHere('출석',null,rec('08:55:00','18:01:00')).state,'ok');
 assert.match(compareCheckHere('출석',null,rec('09:25:00','18:01:00')).text,/체크히어 지각 09:25/);
 assert.match(compareCheckHere('지각',{inT:'09:20'},rec('09:05:00','18:01:00')).text,/지각 아님/);
 assert.match(compareCheckHere('지각',{inT:'09:20'},rec('09:25:00','18:01:00')).text,/입실 시간 다름/);
 assert.equal(compareCheckHere('지각',{inT:'09:25'},rec('09:25:10','18:01:00')).state,'ok');
 assert.match(compareCheckHere('결석',null,rec('09:00:00',null)).text,/기록 있음/);
 assert.equal(compareCheckHere('결석',null,rec(null,null)).state,'ok');
 assert.match(compareCheckHere('출석',null,rec(null,null)).text,/결석 확인/);
 assert.equal(compareCheckHere('출석',null,rec(null,null),{today:'2026-09-03',date:'2026-09-03',now:9*3600}).state,'pending');
 assert.match(compareCheckHere('외출',null,rec('09:00:00','18:00:00')).text,/외출 기록 없음/);
 assert.match(compareCheckHere('출석',null,rec('09:00:00','18:00:00',{outingCount:1})).text,/외출 기록 있음/);
 assert.equal(compareCheckHere('인정출석',null,rec(null,null)).state,'ok');
 assert.equal(compareCheckHere('출석',null,null).state,'none');
 assert.deepEqual(timesFromRecord({rawEntry:'09:12:30',entry:'09:00:00',exit:'17:40:00',outings:[{start:'13:00:00',end:'14:00:00'}]}),{inT:'09:12',outT:'17:40',oa:'13:00',ob:'14:00'});
 assert.deepEqual(neededTimes('인정조퇴',{inT:'09:00',outT:'15:00',oa:'1',ob:'2'}),{inT:'',outT:'15:00',oa:'',ob:''});
});

test('sync status text is plain Korean',()=>{
 const now=Date.parse('2026-10-13T10:00:00Z');
 const t=syncText({checkedAt:now-3*60000,changedAt:now-2*3600000,last:{errors:['3반: 탭 없음'],stats:{added:1}}},now);
 assert.deepEqual([t.checked,t.changed,t.errors[0]],['3분 전','2시간 전','3반: 탭 없음']);
 assert.equal(syncText({}).checked,'기록 없음');
});

test('the client and Apps Script agree on the ledger row signature',()=>{
 const gas=vm.createContext({});vm.runInContext(readFileSync(new URL('../../apps-script/beta2/beta2.gs',import.meta.url),'utf8'),gas);
 assert.deepEqual(JSON.parse(JSON.stringify(gas.B2_LEDGER_COLS)),COLS);
});
