import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBundle,dayView,dayCounts,studentStats,diseaseReport,compareCheckHere,memoReason,timesFromRecord,neededTimes,evidenceRows,extraEvidenceRows,offDayRecords,classDays,dropoutRows,isDiseaseReason,syncText,enrolledOn} from '../../beta2-core.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,name,type,o={})=>COLS.map(k=>({date,cls:'1',name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:recognized(type)?(o.ev||'미제출'):'해당없음',check:'',prov:'1기 동기화',flag:'',sig:'s',...o})[k]);
const recognized=t=>t.startsWith('인정');
const RAW={rev:7,today:'2026-11-05',days:['2026-11-03','2026-11-04','2026-11-05','2026-11-06'],classes:[{id:'1',teacher:'김지아'}],
 roster:[['1','가','재학',''],['1','나','중도탈락','2026-11-04'],['1','다','',''],['2','라','재학','']],ledgerCols:COLS,
 ledger:[L('2026-11-03','가','지각',{inT:'09:20'}),L('2026-11-04','가','인정출석',{reason:'병원 진료'}),L('2026-11-05','가','인정지각',{reason:'병결',ev:'확인',inT:'09:40'}),
  L('2026-11-03','나','결석'),L('2026-11-04','나','결석'),L('2026-11-04','다','인정조퇴',{reason:'면접',ev:'반려',evr:'날짜 없음',outT:'15:00',flag:'운영총괄 값: 조퇴'})]};

test('bundles decode into rows and a day view follows the roster with implied attendance and leavers',()=>{
 const b=decodeBundle(RAW);
 assert.equal(b.ledger.length,6);assert.equal(b.ledger[0].inT,'09:20');assert.equal(b.roster[1].changed,'2026-11-04');
 const day=dayView(b,'1','2026-11-05');
 assert.deepEqual(day.map(r=>[r.name,r.type,r.enrolled]),[['가','인정지각',true],['나','해당없음',false],['다','출석',true]]);
 assert.deepEqual(dayCounts(dayView(b,'1','2026-11-04')),{총원:3,출석:2,결석:1,지각:0,조퇴:0,외출:0,인정:2,중복:0});
});

test('student statistics use the master-sheet attendance rate, evidence and disease dates from the ledger',()=>{
 const b=decodeBundle(RAW),s=studentStats(b,{cls:'1'});
 const ga=s.find(x=>x.name==='가'),na=s.find(x=>x.name==='나'),da=s.find(x=>x.name==='다');
 assert.deepEqual([ga.days,ga.absent,Math.round(ga.rate)],[3,0,100]);
 assert.deepEqual(ga.counts,{지각:1,인정출석:1,인정지각:1});
 assert.deepEqual(ga.disease,['2026-11-04','2026-11-05']);
 assert.deepEqual(ga.evidence.map(e=>e.date),['2026-11-04']);
 assert.deepEqual([na.days,na.absent,Math.round(na.rate)],[2,2,0],'the change date is the last attended day; later days are not counted');
 assert.equal(enrolledOn({status:'중도탈락',changed:'2026-11-04'},'2026-11-04'),true);assert.equal(enrolledOn({status:'중도탈락',changed:'2026-11-04'},'2026-11-05'),false);
 // 2기는 운영총괄 동기화가 없어 T열 '운영총괄 값' 충돌 표시를 세지 않습니다.
 assert.equal(da.flags,undefined);
 assert.deepEqual(evidenceRows(s).map(e=>[e.name,e.date,e.state]),[['가','2026-11-04','미제출'],['다','2026-11-04','반려']]);
 const {left,risk}=dropoutRows(s);
 assert.deepEqual(left.map(x=>x.name),['나']);assert.deepEqual(risk.map(x=>x.name),[]);
 assert.equal(isDiseaseReason('면접결석'),false);assert.equal(isDiseaseReason('병결'),true);
});

test('records on days that are not training days (weekend, before the course) are shown for that day but never counted in rates, absences, evidence or disease',()=>{
 // 사용자 결정 2026-10-20: 교육일이 아닌 날도 기록할 수 있지만, 통계는 교육일 목록(bundle.days)에 있는 날만 셉니다(courseDays).
 const off=['2026-11-01','2026-10-20'],b=decodeBundle({...RAW,ledger:[...RAW.ledger,L(off[0],'가','결석'),L(off[1],'가','인정출석',{reason:'병원 진료'}),L(off[0],'다','결석')]});
 const before=studentStats(decodeBundle(RAW),{cls:'1'}),after=studentStats(b,{cls:'1'});
 assert.deepEqual(after.map(x=>[x.name,x.days,x.absent,x.rate,x.counts,x.evidence,x.disease]),before.map(x=>[x.name,x.days,x.absent,x.rate,x.counts,x.evidence,x.disease]));
 assert.deepEqual(diseaseReport(after).rows,diseaseReport(before).rows);
 assert.deepEqual(studentStats(b,{cls:'1',from:'2026-10-01'}).find(x=>x.name==='가').absent,0,'a wider period still counts only training days');
 assert.deepEqual(dayView(b,'1',off[0]).map(r=>[r.name,r.type]),[['가','결석'],['나','출석'],['다','결석']],'the day view of a non-training day still shows its records');
});

test('real classes: recognized records on non-training days (before the course, today 10/20, a future weekend) stay out of evidence and disease and are listed apart',()=>{
 // 사용자 2026-10-20: 인정 출결은 교육일에만. 실제 반의 교육일 아닌 날 인정 기록은 증빙·질병 인정에 넣지 않고 offDayRecords로 따로 알립니다.
 const off=[L('2026-10-20','가','인정출석',{reason:'병원 진료'}),L('2026-11-08','다','인정출석',{reason:'면접'}),L('2026-11-01','가','결석')];
 const b=decodeBundle({...RAW,ledger:[...RAW.ledger,...off]}),before=studentStats(decodeBundle(RAW),{cls:'1'}),after=studentStats(b,{cls:'1'});
 assert.deepEqual(evidenceRows(after),evidenceRows(before));
 assert.deepEqual(after.map(x=>[x.days,x.rate,x.counts,x.disease]),before.map(x=>[x.days,x.rate,x.counts,x.disease]));
 assert.deepEqual(offDayRecords(b).map(r=>[r.cls,r.name,r.date,r.type,r.state]),[['1','가','2026-10-20','인정출석','미제출'],['1','다','2026-11-08','인정출석','미제출']],'absences are not recognized records; future days are listed too');
 assert.deepEqual(offDayRecords(b,{from:'2026-10-28',to:'2026-11-05'}),[],'the period filter applies');
 assert.deepEqual(offDayRecords(b,{cls:'2'}),[]);
 assert.deepEqual(classDays(b,'1'),RAW.days);
});

test('test class 17: every date with a ledger record counts as a training day (before the course too), shown when picked or with withTest, never in official totals',()=>{
 // 17반 테스트반(cohort test, 사용자 결정 2026-10-20): 개강 전에도 시험할 수 있게 그 반 원장 기록이 있는 날은 모두 교육일입니다.
 const T=(date,name,type,o={})=>L(date,name,type,{cls:'17',...o});
 const raw={...RAW,roster:[...RAW.roster,['17','테스트가','재학',''],['17','테스트나','재학','']],
  ledger:[...RAW.ledger,T('2026-10-20','테스트가','인정출석',{reason:'병원 진료'}),T('2026-10-18','테스트가','인정조퇴',{reason:'병결',outT:'15:00'}),T('2026-10-19','테스트가','인정출석',{reason:'병원(치과)'}),T('2026-10-21','테스트가','인정지각',{reason:'병원',inT:'10:00'}),
   T('2026-10-20','테스트나','결석'),T('2026-10-25','테스트나','인정출석',{reason:'취업박람회'}),T('2026-11-20','테스트나','인정출석',{reason:'면접'})]};
 const b=decodeBundle(raw);
 assert.deepEqual(classDays(b,'17'),['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-25','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-20']);
 const t=studentStats(b,{cls:'17'}),ga=t.find(x=>x.name==='테스트가'),na=t.find(x=>x.name==='테스트나');
 assert.deepEqual([ga.days,ga.absent],[8,0],'10/18·19·20·21·25 and 11/3·4·5 up to today 11/5');
 assert.deepEqual([na.days,na.absent,Math.round(na.rate)],[8,1,88],'a classmate without a record that day is present');
 assert.deepEqual(evidenceRows(t).map(e=>[e.name,e.date,e.state]),[['테스트가','2026-10-18','미제출'],['테스트가','2026-10-19','미제출'],['테스트가','2026-10-20','미제출'],['테스트가','2026-10-21','미제출'],['테스트나','2026-10-25','미제출']],'the 11/20 record is after today');
 assert.deepEqual(diseaseReport(t).rows.map(r=>[r.cls,r.name,r.count,r.level]),[['17','테스트가',4,'주의']]);
 assert.deepEqual(extraEvidenceRows(b,{cls:'17'}).map(r=>[r.name,r.date]),[['테스트나','2026-10-25']]);
 // 전체(공식): 테스트반 없음 · withTest: 목록에 함께
 const all=studentStats(b,{}),withTest=studentStats(b,{withTest:true});
 assert.equal(all.some(x=>x.cls==='17'),false);
 assert.deepEqual(all.map(x=>[x.name,x.days,x.rate,x.evidence,x.disease]),studentStats(decodeBundle(RAW),{}).map(x=>[x.name,x.days,x.rate,x.evidence,x.disease]),'real classes are unchanged');
 assert.deepEqual(evidenceRows(withTest).filter(e=>e.cls==='17').length,5);
 assert.deepEqual(diseaseReport(all).rows,[]);assert.deepEqual(diseaseReport(withTest).rows.map(r=>r.name),['테스트가']);
 assert.deepEqual(extraEvidenceRows(b,{}),[]);assert.deepEqual(extraEvidenceRows(b,{withTest:true}).map(r=>r.cls),['17']);
 assert.deepEqual(offDayRecords(b),[],'test-class days are training days, never off-day records');
});

test('disease counts follow the ledger and differences with CheckHere hospital memos are listed for review',()=>{
 const stats=[{cls:'1',name:'가',disease:['2026-11-03','2026-11-04','2026-11-05','2026-11-06']},{cls:'1',name:'나',disease:['2026-11-03']},{cls:'2',name:'라',disease:[]}];
 const r=diseaseReport(stats,{'1':{가:['2026-11-03','2026-11-04','2026-11-07'],나:['2026-11-03']},'2':{라:['2026-11-05']}});
 assert.deepEqual(r.rows.map(x=>[x.name,x.count,x.level]),[['가',4,'주의']]);
 assert.deepEqual(r.review.map(x=>[x.name,x.onlyLedger,x.onlyCheckHere]),[['가',['2026-11-05','2026-11-06'],['2026-11-07']],['라',[],['2026-11-05']]]);
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
 assert.equal(compareCheckHere('출석',null,rec(null,null),{today:'2026-11-05',date:'2026-11-05',now:9*3600}).state,'pending');
 assert.match(compareCheckHere('외출',null,rec('09:00:00','18:00:00')).text,/외출 기록 없음/);
 assert.match(compareCheckHere('출석',null,rec('09:00:00','18:00:00',{outingCount:1})).text,/외출 기록 있음/);
 assert.equal(compareCheckHere('인정출석',null,rec(null,null)).state,'ok');
 assert.equal(compareCheckHere('출석',null,null).state,'none');
 assert.deepEqual(timesFromRecord({rawEntry:'09:12:30',entry:'09:00:00',exit:'17:40:00',outings:[{start:'13:00:00',end:'14:00:00'}]}),{inT:'09:12',outT:'17:40',oa:'13:00',ob:'14:00'});
 assert.deepEqual(neededTimes('인정조퇴',{inT:'09:00',outT:'15:00',oa:'1',ob:'2'}),{inT:'',outT:'15:00',oa:'',ob:''});
});

test('출결대조 보정 모드는 연결 프로그램이 고치는 교시 기록으로 보고 남은 실제 입실은 글로 알린다',()=>{
 const rec=(rawEntry,entry,exit,extra={})=>({rawEntry,entry,exit,outings:[],outingCount:0,...extra}),fix={corrected:true};
 // 출석 시간 맞추기(교시 09:00) 뒤: 실제 입실 09:25가 남아도 일치
 const fixed=rec('09:25:00','09:00:00','18:01:00');
 assert.deepEqual(compareCheckHere('출석',null,fixed,fix),{state:'ok',text:'일치 · 실제 입실 09:25'});
 assert.deepEqual(compareCheckHere('출석',null,fixed),{state:'diff',text:'체크히어 지각 09:25'},'보정 없이는 지금처럼 실제 입실로 봄');
 assert.deepEqual(compareCheckHere('지각',{inT:'09:25'},rec('09:30:00','09:25:00','18:01:00'),fix),{state:'ok',text:'일치 · 실제 입실 09:30'});
 assert.deepEqual(compareCheckHere('지각',{inT:'09:20'},rec('09:25:00','09:00:00','18:01:00'),fix),{state:'diff',text:'체크히어 입실 09:00 · 지각 아님 · 실제 입실 09:25'});
 assert.deepEqual(compareCheckHere('출석',null,rec('09:02:11','09:02:00','18:01:00'),fix),{state:'ok',text:'일치'},'분이 같으면 실제 입실을 덧붙이지 않음');
 // 결석 삭제 뒤: 퇴실과 교시가 비고 실제 입실만 남음
 const deleted=rec('09:02:00',null,null);
 assert.deepEqual(compareCheckHere('결석',null,deleted,fix),{state:'ok',text:'교시 기록·퇴실 없음 · 실제 입실 09:02 남음'});
 assert.deepEqual(compareCheckHere('결석',null,deleted),{state:'diff',text:'체크히어 입실 09:02 · 퇴실 - 기록 있음'});
 assert.deepEqual(compareCheckHere('결석',null,rec('09:02:00',null,'18:00:00'),fix),{state:'diff',text:'체크히어 입실 - · 퇴실 18:00 기록 있음 · 실제 입실 09:02'},'퇴실이 남으면 불일치');
 assert.deepEqual(compareCheckHere('결석',null,rec(null,null,null),fix),{state:'ok',text:'입퇴실 없음'});
 assert.deepEqual(compareCheckHere('출석',null,deleted,fix),{state:'diff',text:'교시 기록·퇴실 없음 · 실제 입실 09:02 · 퇴실 미타각인지 확인'});
 assert.deepEqual(compareCheckHere('출석',null,rec('09:02:00',null,'18:00:00'),fix),{state:'diff',text:'입실 기록 없음 · 실제 입실 09:02'});
 // 오늘 교시·퇴실이 모두 비면 교시 기록이 늦게 찍힐 수 있어 실제 입실로 돌아감
 const today={today:'2026-11-05',date:'2026-11-05',now:10*3600,corrected:true};
 assert.deepEqual(compareCheckHere('출석',null,rec('09:25:00',null,null),today),{state:'diff',text:'체크히어 지각 09:25'});
 assert.deepEqual(compareCheckHere('출석',null,rec('09:02:00',null,null),today),{state:'pending',text:'진행 중 · 지금까지 일치'});
 assert.deepEqual(compareCheckHere('출석',null,rec(null,null,null),today),{state:'pending',text:'오늘 입실 기록 아직 없음'});
 assert.deepEqual(compareCheckHere('결석',null,deleted,today),{state:'diff',text:'체크히어 입실 09:02 · 퇴실 - 기록 있음'},'오늘 퇴실 전 체크인한 학생이 결석으로 적히면 불일치(결석도 실제 입실로 돌아감)');
 assert.deepEqual(compareCheckHere('결석',null,rec(null,null,null),today),{state:'ok',text:'입퇴실 없음'});
 assert.deepEqual(compareCheckHere('결석',null,deleted,{...today,today:'2026-11-06'}),{state:'ok',text:'교시 기록·퇴실 없음 · 실제 입실 09:02 남음'},'지난 날은 삭제 뒤 모습이면 일치');
 // 교시 기록만 있는 저장본(실제 입실 없음)과 예전 저장본(rawEntry 칸 없음)
 assert.deepEqual(compareCheckHere('출석',null,rec(null,'09:00:00','18:00:00'),fix),{state:'ok',text:'일치'});
 assert.deepEqual(compareCheckHere('출석',null,{entry:'09:25:00',exit:'18:00:00',outings:[]},fix),{state:'diff',text:'체크히어 지각 09:25'});
 assert.equal(compareCheckHere('출석',null,rec('9:25','09:00:00','18:00:00'),fix).text,'체크히어 시간 형식 확인 필요');
});

test('체크히어 메모의 사유 힌트는 시간을 사유로 내놓지 않는다',()=>{
 assert.equal(memoReason('지각_담임:가상담임(09:25)'),'');
 assert.equal(memoReason('조퇴_담임:가상담임(17:00)'),'');
 assert.equal(memoReason('외출_담임:가상담임(13:00~14:00)'),'');
 assert.equal(memoReason('(인정출석)병원_담임:가상담임'),'병원');
 assert.equal(memoReason('(인정지각)병원_담임:가상담임(09:40)'),'병원');
 assert.equal(memoReason('지각_담임:가상담임(교통)'),'교통');
 assert.equal(memoReason(''),'');assert.equal(memoReason(null),'');
});

test('sync status text is plain Korean',()=>{
 const now=Date.parse('2026-12-15T10:00:00Z');
 const t=syncText({checkedAt:now-3*60000,changedAt:now-2*3600000,last:{errors:['3반: 탭 없음'],stats:{added:1}}},now);
 assert.deepEqual([t.checked,t.changed,t.errors[0]],['3분 전','2시간 전','3반: 탭 없음']);
 assert.equal(syncText({}).checked,'기록 없음');
 // 2026-10-13 10:00Z = 화요일 19:00 KST → 평일 09:10~18:00 밖
 assert.deepEqual([t.window,t.resting,t.cut],['평일 09:10~18:00',true,'']);
 const wed=Date.parse('2026-12-16T03:00:00Z');
 assert.equal(syncText({window:'1-5 09:10-18:00'},wed).resting,false);
 assert.equal(syncText({window:'always'},Date.parse('2026-12-19T03:00:00Z')).resting,false);
 assert.equal(syncText({window:'6-7 10:00-12:00'},wed).window,'주말 10:00~12:00');
 assert.equal(syncText({cutAt:wed-20*60000,last:{at:wed-30*60000}},wed).cut,'20분 전','a cut after the last finished run is shown');
 assert.equal(syncText({cutAt:wed-40*60000,last:{at:wed-30*60000}},wed).cut,'','an older cut is not');
 // 끊긴 단계(beta2.gs B2_SYNC_CUT.phase)를 쉬운 말로
 const cut={cutAt:wed-20*60000,cut:{at:wed-20*60000,phase:'read',ms:95000},last:{at:wed-30*60000}};
 assert.deepEqual([syncText(cut,wed).cutPhase,syncText(cut,wed).cutText],['출결원장 읽기','시간 초과로 중단(단계: 출결원장 읽기)']);
 assert.equal(syncText({...cut,cut:{at:cut.cutAt,phase:'boards 3',ms:250000}},wed).cutText,'시간 초과로 중단(단계: 출결판 그리기 3번째 차례)');
 assert.equal(syncText({...cut,cut:{at:cut.cutAt,phase:'source',ms:1000}},wed).cutText,'시간 초과로 중단(단계: 운영총괄 읽기)');
 assert.equal(syncText({...cut,cut:{at:cut.cutAt,phase:'slim',ms:290000}},wed).cutText,'시간 초과로 중단(단계: 입력 확인(Q열) 계산)');
 assert.equal(syncText({cutAt:wed-20*60000,last:{at:wed-30*60000}},wed).cutText,'시간 초과로 중단','an old numeric cut has no phase');
 assert.deepEqual([syncText({...cut,last:{at:wed-10*60000}},wed).cutText,syncText({},wed).cutPhase],['',''],'nothing once a later run finished');
});

test('the client and Apps Script agree on the ledger row signature',()=>{
 const gas=vm.createContext({});vm.runInContext(readFileSync(new URL('../../apps-script/beta2/beta2.gs',import.meta.url),'utf8'),gas);
 assert.deepEqual(JSON.parse(JSON.stringify(gas.B2_LEDGER_COLS)),COLS);
});

test('2기 has no /beta2 save guard: live relay requests keep the reason exactly as written',async()=>{
 const {existsSync}=await import('node:fs');
 assert.equal(existsSync(new URL('../../beta2-guard-core.mjs',import.meta.url)),false,'1기 보기 전용 가드는 2기에 없음');
 const {LIVE_MARK,isLiveRequest,editorReason,tagOf}=await import('../../checkhere-live-core.mjs');
 const live={status:'pending',reason:`${LIVE_MARK} 지각 교통 [기준:0a1b2c3d]`};
 assert.equal(isLiveRequest(live),true);assert.equal(tagOf(live.reason),'0a1b2c3d');assert.equal(editorReason(live.reason),'지각 교통');
});

// '해당없음'(현황 없음, 사용자 2026-10-20 '출결상태에서 현황없음을 시트 담임 관리자에 만들라고'): 저장되는 출결 상태
test("'해당없음' is a saved type: that day leaves the enrolled days, absences, totals, evidence and disease; CheckHere entries on it still show as a difference",async()=>{
 const {B2_TYPES}=await import('../../beta2-core.mjs'),{absenceRows,suggestVerdict}=await import('../../beta2-dropout-core.mjs'),{sheetToCheckHere}=await import('../../beta2-checkhere-core.mjs');
 assert.equal(B2_TYPES.at(-1),'해당없음');
 const raw={...RAW,ledger:[...RAW.ledger,L('2026-11-03','다','해당없음'),L('2026-11-05','다','해당없음',{reason:'병원'})]},b=decodeBundle(raw);
 const da=studentStats(b,{cls:'1'}).find(x=>x.name==='다');
 assert.deepEqual([da.days,da.absent,da.rate,da.counts],[1,0,100,{인정조퇴:1}],'two 해당없음 days are neither enrolled days nor absences');
 assert.deepEqual(da.disease,[]);assert.deepEqual(da.evidence.map(e=>e.date),['2026-11-04']);
 const row=dayView(b,'1','2026-11-05').find(r=>r.name==='다');assert.deepEqual([row.type,row.enrolled,!!row.rec],['해당없음',true,true]);
 assert.deepEqual(dayCounts(dayView(b,'1','2026-11-05')),{총원:1,출석:1,결석:0,지각:0,조퇴:0,외출:0,인정:1,중복:0},'counted like the rows before or after enrolment');
 assert.deepEqual(dayCounts(dayView(decodeBundle(RAW),'1','2026-11-05')),{총원:2,출석:2,결석:0,지각:0,조퇴:0,외출:0,인정:1,중복:0});
 const ab=absenceRows(b,{cls:'1'}).find(x=>x.name==='다');assert.deepEqual([ab.days,ab.absent],[1,0]);
 // 조기취업 판정: 출결원장 결석만 셉니다(해당없음은 결석이 아님)
 const v=suggestVerdict({kind:'조기취업',cls:'1',name:'다',lastDate:'2026-11-05',startDate:'2026-11-06'},b);assert.equal(v.absent,0);
 // 체크히어 대조: 해당없음은 결석처럼 보고 기록이 있으면 차이(유지)
 const rec=(entry,exit)=>({rawEntry:entry,entry,exit,outings:[],outingCount:0});
 assert.equal(compareCheckHere('해당없음',null,rec('09:00:00','18:00:00')).state,'diff');assert.match(compareCheckHere('해당없음',null,rec('09:00:00','18:00:00')).text,/기록 있음/);
 assert.equal(compareCheckHere('해당없음',null,rec(null,null)).state,'ok');
 // 체크히어 반영: 해당없음은 보내지 않음(개별 검토 · 체크히어 그대로)
 const live={id:'r',version:'v',readState:'complete',classId:'1',date:'2026-11-05',name:'다',teacher:'김지아',rawEntry:'09:00:00',entry:'09:00:00',exit:'18:00:00',outings:[],schedule:'09:00 ~ 18:00',source:'live',phoneLast4:'1234'};
 const res=sheetToCheckHere({row:{type:'해당없음',reason:''},record:live,sheetTeacher:'김지아',date:'2026-11-05',me:'a@b.c'});
 assert.equal(res.state,'manual');assert.deepEqual(res.changes,{});assert.match(res.notes[0],/해당없음/);
});

// '중복'(사용자 2026-10-20 '중복(지+조+외) 이거 시트랑 담임이랑 관리자 넣어줘', 시트 계약 2026-10-20): 지각·조퇴·외출 가운데 둘 이상인 날
test("'중복' is a saved type: attended (not absent), its own bucket, counted once in 지·조·외; times need two of 입실·퇴실·외출; CheckHere compares the parts",async()=>{
 const core=await import('../../beta2-core.mjs'),{absenceRows,suggestVerdict}=await import('../../beta2-dropout-core.mjs'),{sheetToCheckHere}=await import('../../beta2-checkhere-core.mjs');
 const {B2_TYPES,DUP_TYPE,DUP_RULE,dupParts,dupCheck,dupWarning,requiredTimes,dupTimesFromRecord,partialCount,sheetWait}=core;
 assert.deepEqual(B2_TYPES,['출석','지각','조퇴','외출','중복','결석','인정출석','인정지각','인정조퇴','인정외출','해당없음'],'sheet B2.TYPES order with 출석 first');
 assert.equal(DUP_TYPE,'중복');assert.deepEqual([DUP_RULE.minParts,DUP_RULE.absent,DUP_RULE.partialWeight],[2,false,1]);
 assert.deepEqual([partialCount('지각'),partialCount('중복'),partialCount('결석'),partialCount('인정지각')],[1,1,0,0]);
 // 통계: 중복 날은 재학일·출석, 결석 아님, counts.중복, 지·조·외 합계(partial)에 1회
 const raw={...RAW,ledger:[...RAW.ledger,L('2026-11-05','다','중복',{inT:'09:40',outT:'16:00'}),L('2026-11-03','다','지각',{inT:'09:30'})]},b=decodeBundle(raw);
 const da=studentStats(b,{cls:'1'}).find(x=>x.name==='다');
 assert.deepEqual([da.days,da.absent,da.rate,da.counts,da.partial],[3,0,100,{지각:1,인정조퇴:1,중복:1},2]);
 assert.equal(studentStats(b,{cls:'1'}).find(x=>x.name==='가').partial,1,'가: one 지각');
 assert.deepEqual(dayCounts(dayView(b,'1','2026-11-05')),{총원:2,출석:2,결석:0,지각:0,조퇴:0,외출:0,인정:1,중복:1});
 const ab=absenceRows(b,{cls:'1'}).find(x=>x.name==='다');assert.deepEqual([ab.absent,ab.partial],[0,2]);
 assert.equal(suggestVerdict({kind:'조기취업',cls:'1',name:'다',lastDate:'2026-11-05',startDate:'2026-11-06'},b).absent,0,'중복 is not an absence');
 // 시간: 입실(지각)·퇴실(조퇴)·외출(시작+종료) 가운데 둘 이상, 외출은 짝·순서(시트 b2Save와 같은 기준, 관리자는 저장 전에 막음)
 assert.equal(dupParts({inT:'09:40',oa:'13:00'}).count,1,'half an outing is not an outing');
 assert.equal(dupCheck({inT:'09:40',outT:'16:00'}),null);assert.equal(dupCheck({outT:'16:00',oa:'13:00',ob:'14:00'}),null);
 assert.equal(dupCheck({inT:'09:40'}).text,'중복은 입실(지각)·퇴실(조퇴)·외출 시간 가운데 둘 이상을 넣어 주세요.');assert.equal(dupCheck({}).field,'inT');
 assert.deepEqual(dupCheck({inT:'09:40',oa:'13:00'}),{field:'ob',text:'입력 필요: 외출 종료 시간'});
 assert.deepEqual(dupCheck({inT:'09:40',oa:'14:00',ob:'13:00'}),{field:'ob',text:'외출 종료가 시작보다 늦어야 합니다'});
 assert.match(dupWarning('중복',{inT:'09:40'}),/둘 이상을 넣어 주세요 · 지금 지각$/);assert.equal(dupWarning('중복',{inT:'09:40',outT:'16:00'}),'');assert.equal(dupWarning('지각',{}),'');
 assert.deepEqual(requiredTimes('중복'),{inT:'',outT:'',oa:'',ob:''});assert.deepEqual(requiredTimes('지각'),{inT:'x',outT:'',oa:'',ob:''});
 assert.deepEqual(neededTimes('중복',{inT:'09:40',outT:'',oa:'13:00',ob:'14:00'}),{inT:'09:40',outT:'',oa:'13:00',ob:'14:00'},'all entered times are saved');
 // 고를 때 미리 채우기: 체크히어에서 실제 지각·조퇴·외출인 부분만(정시 입실은 비움)
 const rec=(entry,exit,extra={})=>({rawEntry:entry,entry,exit,outings:[],outingCount:0,...extra});
 assert.deepEqual(dupTimesFromRecord(rec('08:55:00','16:00:00',{outings:[{start:'13:00:00',end:'14:00:00'}],outingCount:1})),{inT:'',outT:'16:00',oa:'13:00',ob:'14:00'});
 assert.deepEqual(dupTimesFromRecord(rec('09:40:00','18:01:00')),{inT:'09:40',outT:'',oa:'',ob:''});
 // 체크히어 대조: 체크히어의 지각·조퇴 자체는 차이가 아님. 원장에 적힌 부분이 체크히어와 맞는지, 체크히어로 둘 이상인지
 assert.equal(compareCheckHere('중복',{inT:'09:40',outT:'16:00'},rec('09:40:00','16:00:00')).state,'ok');
 assert.equal(compareCheckHere('중복',null,rec('09:40:00','16:00:00')).state,'ok','teacher rows without times: CheckHere shows two parts');
 assert.match(compareCheckHere('중복',{inT:'09:40',outT:'16:00'},rec('09:00:00','16:00:00')).text,/지각 아님/);
 assert.match(compareCheckHere('중복',null,rec('09:40:00','18:01:00')).text,/체크히어로는 지각·조퇴·외출 1가지 · 중복은 2가지 이상/);
 assert.match(compareCheckHere('중복',{inT:'09:40',oa:'13:00',ob:'14:00'},rec('09:40:00','18:01:00')).text,/외출 기록 없음/);
 // 체크히어 반영: 그대로 개별 검토(보내지 않음)
 const live={id:'r',version:'v',readState:'complete',classId:'1',date:'2026-11-05',name:'다',teacher:'김지아',rawEntry:'09:40:00',entry:'09:40:00',exit:'16:00:00',outings:[],schedule:'09:00 ~ 18:00',source:'live',phoneLast4:'1234'};
 const res=sheetToCheckHere({row:{type:'중복',reason:'',inT:'09:40',outT:'16:00'},record:live,sheetTeacher:'김지아',date:'2026-11-05',me:'a@b.c'});
 assert.equal(res.state,'manual');assert.deepEqual(res.changes,{});assert.deepEqual(res.notes,['중복 출결 · 개별 검토 필요']);
 // 시트가 아직 중복을 받지 않으면 기다림 안내(해당없음과 같음)
 assert.match(sheetWait('유형을 골라 주세요.','중복'),/^시트 업데이트 대기 · 마스터시트가 아직 중복을 받지 않습니다/);assert.equal(sheetWait('유형을 골라 주세요.','지각'),'유형을 골라 주세요.');
});
