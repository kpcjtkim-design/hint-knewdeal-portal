import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBundle,dayView,dayCounts,studentStats,diseaseReport,compareCheckHere,memoReason,timesFromRecord,neededTimes,evidenceRows,dropoutRows,isDiseaseReason,syncText,enrolledOn} from '../../beta2-core.mjs';
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
