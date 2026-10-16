import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGas} from './gas-fake.mjs';
import {syncText} from '../../beta2-core.mjs';

// beta2.gs 동기화를 가짜 Google 서비스로 끝까지 돌립니다. 학생은 모두 가상입니다(가상1가 …).
const GS=fileURLToPath(new URL('../../apps-script/beta2/beta2.gs',import.meta.url));
const SOURCE='1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34',MASTER='master-test';
const TODAY='2026-10-14',DAYS=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
const CLASSES=Array.from({length:17},(_,i)=>String(i+1));
const NAMES=c=>[`가상${c}가`,`가상${c}나`,`가상${c}다`];
const md=iso=>`${+iso.slice(5,7)}/${+iso.slice(8,10)}`;
const plain=x=>JSON.parse(JSON.stringify(x));
const YELLOW='#ffff00',RED='#ff0000';
const LEDGER_HEAD=['일자','반','이름','유형','입실','퇴실','외출시작','외출종료','사유','증빙','반려사유','메모','코드','','증빙반영','','확인','출처','동기화 지문','동기화 확인'];

// 운영총괄 반 탭 하나: 18행 M열부터 머리글, 19행부터 학생, 50·51행 사유
function fillSourceTab(sh,c,{cells={},reasons={},colors={}}={}){
 sh.fill(18,1,[['다른 표(무시)']]);
 sh.fill(18,13,[['이름','출석률','출석일수','지/조/외/중복',...DAYS.map(md)]]);
 NAMES(c).forEach((n,i)=>sh.fill(19+i,13,[[n,'95%','7','0/0/0/0',...DAYS.map(d=>d>TODAY?'':cells[n+'|'+d]??'출석')]]));
 sh.fill(50,13,[['가-3. 출결사유관리','','','',...DAYS.map(md)]]);
 sh.fill(51,13,[['*','','','',...DAYS.map(d=>reasons[d]||'')]]);
 for(const [k,hex] of Object.entries(colors)){const [n,d]=k.split('|');sh.color(19+NAMES(c).indexOf(n),17+DAYS.indexOf(d),hex);}
}
const sourceSpec=c=>({
 cells:{[`가상${c}가|2026-10-06`]:'지각',[`가상${c}나|2026-10-07`]:'인정결석',[`가상${c}다|2026-10-08`]:'결석'},
 reasons:{'2026-10-06':`지각1- 가상${c}가_교통`,'2026-10-07':`인정결석1- 가상${c}나_면접`,'2026-10-08':`결석1- 가상${c}다_개인일정`},
 colors:{[`가상${c}나|2026-10-07`]:YELLOW}
});
const rec=(c,name,date,type,x={})=>({date,cls:String(c),name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',...x});

// 10/14 아침 운영 상태를 흉내 낸 마스터시트·운영총괄. bf55d12가 한 번 돈 뒤(B2_LEGACY_ADOPTED=1), 이번 코드는 처음 도는 상태.
function setup({sheetsApi=true,now='2026-10-14T10:00:00+09:00'}={}){
 const gas=createGas({now,sheetsApi,files:[GS]}),tabs=gas.run('B2.SOURCE_TABS'),sig=r=>gas.call('b2Sig_',r);
 const logs=[];gas.ctx.console={log:m=>logs.push(String(m)),warn(){},error(){}}; // 단계 기록(console.log)은 시험 출력 대신 여기에 모읍니다.
 const src=gas.book(SOURCE,'1기 운영총괄');
 for(const c of CLASSES)fillSourceTab(src.add(tabs[c],60,30),c,sourceSpec(c));
 src.add('서류발급요청',40,12).fill(5,1,[['1','20261010','4반','가상4가','2001.01.01','10월','출석부','취업','가상기관','20261020','접수','']]);
 src.add('반정보',30,20).fill(4,7,CLASSES.map(c=>[c+'반','지역'+c,'과정'+c,'HRD'+c,'담임'+c,'','장소'+c,'주소'+c]));
 const m=gas.book(MASTER,'마스터',true);
 const ledger=m.add('출결원장',400,20).fill(1,1,[LEDGER_HEAD]);
 const rows=[];
 for(const c of CLASSES){
  const [a,b,d]=NAMES(c);
  if(c==='4')rows.push([rec(c,a,'2026-10-06','결석',{reason:'개인'}),'베타 수정','']);
  else{const r=rec(c,a,'2026-10-06','지각',{reason:'교통'});rows.push([r,'1기 동기화',sig(r)]);}
  const r2=rec(c,b,'2026-10-07','인정출석',{reason:'면접',ev:'확인'});rows.push([r2,'1기 동기화',sig(r2)]);
  rows.push([rec(c,d,'2026-10-08','지각'),'직접 입력','']);
  if(c==='3')rows.push([rec(c,b,'2026-10-12','조퇴',{outT:'15:00'}),'','']);
 }
 rows.sort((x,y)=>x[0].date.localeCompare(y[0].date)||+x[0].cls-+y[0].cls||x[0].name.localeCompare(y[0].name));
 rows.forEach(([r,prov,s],i)=>ledger.fill(2+i,1,[[gas.date(...r.date.split('-').map(Number)),Number(r.cls),r.name,r.type,r.inT,r.outT,r.oa,r.ob,r.reason,r.ev,r.evr,'','','','','','',prov,s,'']]));
 m.add('명부',800,8).fill(1,1,[['반','이름','번호','상태','상태 변경일','','생년월일','성별']]).fill(2,1,CLASSES.flatMap(c=>NAMES(c).map(n=>[Number(c),n,'','재학','','',gas.date(2000,1,1),'남성'])));
 m.add('교육일자',200,6).fill(1,1,[['교육일']]).fill(2,1,DAYS.map(d=>[gas.date(...d.split('-').map(Number))]));
 m.add('반정보',30,20).fill(4,7,CLASSES.map(c=>[c+'반','지역'+c,'과정'+c,'HRD'+c,'담임'+c,'','장소'+c,'주소'+c,String(3000+Number(c))]));
 m.add('서류발급',200,18).fill(1,1,[['신청번호']]);
 m.add('교육생정보',800,4);
 m.add('변경이력',500,8).fill(1,1,[['시각','변경자','경로','반','이름','교육일','이전','이후']])
  .fill(2,1,[[new gas.FakeDate(Date.parse('2026-10-13T15:20:00+09:00')),'Apps Script','1기 동기화','','','','','추가 7']])
  .fill(3,1,[[new gas.FakeDate(Date.parse('2026-10-13T16:00:00+09:00')),'teacher@example.com','포털 · 담임2','2반','가상2다',gas.date(2026,10,8),'출석','지각']]);
 for(const c of CLASSES)m.add(String(3000+Number(c)),80,64).fill(3,4,[[Number(c)]]).fill(16,1,[['이름']]);
 gas.scriptProps.setProperty('B2_LEGACY_ADOPTED','1');gas.scriptProps.setProperty('B2_REV','5');
 gas.scriptProps.setProperty('B2_SRC_SEEN',String(Date.parse('2026-10-13T17:00:00+09:00')));
 return {gas,src,m,ledger,tabs,sig,logs};
}
// 출결원장 행(빈 행 제외)을 읽기 쉬운 모양으로
function ledgerView(env){
 const {gas,ledger}=env,last=ledger.getLastRow(),out=[];
 for(let r=2;r<=last;r++){
  const v=ledger.rows(r,1,1,20)[0];if(!v[0])continue;
  out.push({row:r,date:gas.formatDate(v[0],'Asia/Seoul','yyyy-MM-dd'),cls:String(v[1]),name:v[2],type:v[3],inT:v[4],outT:v[5],reason:v[8],ev:v[9],prov:v[17],sig:v[18],flag:v[19]});
 }
 return out;
}
const find=(env,name,date)=>ledgerView(env).filter(r=>r.name===name&&r.date===date);
const props=env=>env.gas.scriptProps.getProperties();
const last=env=>JSON.parse(props(env).B2_SYNC_LAST||'null');
const masterWrites=(env,sheet)=>env.gas.log.writes.filter(w=>w.book===MASTER&&(!sheet||w.sheet===sheet));
const srcCell=(env,c,name,date)=>[19+NAMES(c).indexOf(name),17+DAYS.indexOf(date)];
function setSource(env,c,name,date,value,reason){
 const sh=env.src.getSheetByName(env.tabs[c]),[r,col]=srcCell(env,c,name,date);
 sh.put(r,col,value);if(reason!==undefined)sh.put(51,col,reason);env.gas.advance(60000);env.src.touch();
}
function tick(env,ms=10*60000){env.gas.advance(ms);env.gas.resetLog();env.gas.call('b2SyncTick');}
function firstRun(env){env.gas.resetLog();env.gas.call('b2SyncTick');return last(env);}

test('first run with this code: all 17 classes, legacy rows follow 운영총괄, human-edited and beta rows stay and are flagged',()=>{
 const env=setup(),res=firstRun(env),{sig}=env;
 assert.equal(res.mode,'api');assert.equal(res.processed.length,17);assert.deepEqual(plain(res.errors),[]);
 assert.equal(res.legacyAdopted,17,'16 legacy 직접 입력 rows + 1 blank-source row; the class-2 row a teacher changed after install is left alone');
 for(const c of CLASSES.filter(c=>c!=='2')){
  const [row]=find(env,`가상${c}다`,'2026-10-08');
  assert.deepEqual([row.type,row.reason,row.prov,row.flag],['결석','개인일정','1기 동기화',''],c);
  assert.equal(row.sig,sig(rec(c,`가상${c}다`,'2026-10-08','결석',{reason:'개인일정'})));
 }
 const [human]=find(env,'가상2다','2026-10-08');
 assert.deepEqual([human.type,human.prov,human.sig,human.flag],['지각','직접 입력','',"운영총괄 값: 결석 / 사유 '개인일정'"]);
 const [beta]=find(env,'가상4가','2026-10-06');
 assert.deepEqual([beta.type,beta.reason,beta.prov,beta.flag],['결석','개인','베타 수정',"운영총괄 값: 지각 / 사유 '교통'"]);
 assert.deepEqual(find(env,'가상3나','2026-10-12'),[],'a legacy row 운영총괄 does not have is cleared');
 assert.deepEqual(plain(res.writes),{patched:18,appended:0,cleared:1,boards:17});
 assert.deepEqual([res.stats.updated,res.stats.removed,res.stats.added,res.stats.flagged],[16,1,0,2]);
 const p=props(env);
 assert.equal(p.B2_LEGACY_ADOPTED,'2');assert.equal(p.B2_BOARD_DAY,TODAY);assert.equal(p.B2_SYNC_DAY,TODAY);assert.equal(+p.B2_SRC_SEEN,env.src.updated);
 assert.equal(p.B2_SYNC_ERROR,undefined);assert.equal(p.B2_SYNC_RUNNING,undefined);
 assert.equal(JSON.parse(p.B2_RUN_USAGE).runs,1);
 assert.deepEqual(env.gas.log.outsideLock,[],'every sheet write happens inside the document lock');
 assert.ok(env.gas.log.locks>=5,'boards beyond the first 4 are drawn in turns, taking the lock again: '+env.gas.log.locks);assert.equal(props(env).B2_PENDING_BOARDS,undefined);
 // 출결판: 최근 교육일이 왼쪽, 지각은 그 칸에, 미래(10/15)는 없음
 const board=env.m.getSheetByName('3001');
 assert.deepEqual(board.rows(17,1,3,1).flat(),NAMES('1'));
 assert.deepEqual(board.rows(16,5,1,8)[0].map(d=>d?env.gas.formatDate(d,'Asia/Seoul','MM/dd'):''),['10/14','10/13','10/12','10/08','10/07','10/06','10/05','']);
 assert.deepEqual(board.rows(17,5,3,7),[['출석','출석','출석','출석','출석','지각','출석'],['출석','출석','출석','출석','인정출석','출석','출석'],['출석','출석','출석','결석','출석','출석','출석']]);
 assert.match(env.m.getSheetByName('변경이력').rows(4,8,1,1)[0][0],/기존 행 맞추기 17/);
});

test('an unchanged source is not read at all; a touched file with the same values writes nothing',()=>{
 const env=setup();firstRun(env);const before=props(env).B2_SYNC_LAST;
 tick(env);
 assert.equal(env.gas.log.drive,1);assert.equal(env.gas.log.api.length,0);assert.equal(env.gas.log.reads.filter(r=>r.book===SOURCE).length,0);
 assert.deepEqual(masterWrites(env),[]);assert.equal(props(env).B2_SYNC_LAST,before);
 env.gas.advance(60000);env.src.touch();tick(env);
 assert.deepEqual(plain(env.gas.log.api),['titles',19],'tab titles, then one batchGet for 17 classes + documents + class info');
 assert.equal(env.gas.log.reads.filter(r=>r.book===SOURCE&&r.kind==='backgrounds').length,4,'colour check rotates through 4 classes');
 assert.deepEqual(masterWrites(env),[],'nothing changed → no sheet writes');
 assert.equal(+props(env).B2_SRC_SEEN,env.src.updated);
});

test('one changed class: only that class is merged, one ledger row is written and only its board is redrawn',()=>{
 const env=setup();firstRun(env);
 setSource(env,'5','가상5나','2026-10-12','조퇴','조퇴1- 가상5나_병원 15:30');tick(env);
 let res=last(env);
 assert.deepEqual(plain(res.processed),['5']);assert.deepEqual(plain(res.writes),{patched:0,appended:1,cleared:0,boards:1});
 const [row]=find(env,'가상5나','2026-10-12');
 assert.deepEqual([row.type,row.outT,row.reason,row.prov],['조퇴','15:30','병원','1기 동기화']);
 const ledgerWrites=masterWrites(env,'출결원장').filter(w=>w.kind==='values');
 assert.ok(ledgerWrites.every(w=>w.r===row.row&&w.nr===1),'only the appended row is written: '+JSON.stringify(ledgerWrites));
 assert.deepEqual([...new Set(masterWrites(env).map(w=>w.sheet))].sort(),['3005','변경이력','출결원장']);
 assert.equal(env.m.getSheetByName('3005').get(18,7),'조퇴','10/12 is the third newest day on the board');
 // 다시 출석으로 바꾸면 그 행을 비운다
 setSource(env,'5','가상5나','2026-10-12','출석','');tick(env);res=last(env);
 assert.deepEqual(plain(res.writes),{patched:0,appended:0,cleared:1,boards:1});
 assert.deepEqual(find(env,'가상5나','2026-10-12'),[]);assert.equal(env.m.getSheetByName('3005').get(18,7),'출석');
});

test('a colour-only change is caught by the rotating check within one lap, even if nobody edits the source again',()=>{
 const env=setup();firstRun(env);
 const sh=env.src.getSheetByName(env.tabs['9']),[r,c]=srcCell(env,'9','가상9나','2026-10-07');
 sh.color(r,c,RED);env.gas.advance(60000);env.src.touch();
 let ticks=0;const ev=()=>find(env,'가상9나','2026-10-07')[0].ev;
 do{tick(env);ticks++;}while(ev()!=='반려'&&ticks<10);
 assert.equal(ev(),'반려');assert.deepEqual(plain(last(env).processed),['9']);
 assert.ok(ticks<=5,'17 classes / 4 per run → at most 5 runs, took '+ticks);
 for(let i=0;i<6;i++)tick(env);
 tick(env);assert.equal(env.gas.log.api.length,0,'after the lap the quick skip is back');
});

test('a portal save marks the class; the next run re-checks it against 운영총괄 even though the source did not change',()=>{
 const env=setup();firstRun(env);
 const [cur]=find(env,'가상6가','2026-10-06'),{gas}=env;
 gas.advance(60000);gas.resetLog();
 const saved=gas.call('b2Save_',{cls:'6',name:'가상6가',date:'2026-10-06',type:'결석',reason:'개인',ev:'',before:cur.sig});
 assert.equal(saved.ok,true);assert.deepEqual(gas.log.outsideLock,[]);
 assert.equal(props(env).B2_DIRTY,'["6"]');
 tick(env);const res=last(env);
 assert.deepEqual(plain(res.processed),['6']);
 const [row]=find(env,'가상6가','2026-10-06');
 assert.deepEqual([row.type,row.prov,row.flag],['결석','베타 수정',"운영총괄 값: 지각 / 사유 '교통'"]);
 assert.equal(props(env).B2_DIRTY,undefined);
});

test('the Sheets API path and the per-tab path read the same values and give the same ledger',()=>{
 const a=setup({sheetsApi:true}),b=setup({sheetsApi:false});
 const ra=firstRun(a),rb=firstRun(b);
 assert.deepEqual([ra.mode,rb.mode],['api','sheet']);
 assert.equal(props(a).B2_SRC_HASH,props(b).B2_SRC_HASH);assert.equal(props(a).B2_SRC_COLOR,props(b).B2_SRC_COLOR);
 assert.deepEqual(ledgerView(a),ledgerView(b));
 assert.equal(a.gas.log.api.length,2);assert.equal(b.gas.log.api.length,0);
});

test('outside 평일 09:10~18:00 the trigger does nothing; B2_SYNC_WINDOW can change the window',()=>{
 const env=setup({now:'2026-10-14T09:05:00+09:00'}),{gas}=env;
 for(const t of ['2026-10-14T09:05:00+09:00','2026-10-14T18:01:00+09:00','2026-10-17T11:00:00+09:00','2026-10-18T11:00:00+09:00']){
  gas.at(t);gas.resetLog();gas.call('b2SyncTick');
  assert.equal(gas.log.drive,0,t);assert.equal(props(env).B2_SYNC_LAST,undefined,t);assert.equal(props(env).B2_RUN_USAGE,undefined,t);
 }
 gas.at('2026-10-14T09:10:00+09:00');gas.call('b2SyncTick');assert.ok(last(env),'09:10 is inside');
 const sat=setup({now:'2026-10-17T11:00:00+09:00'});sat.gas.scriptProps.setProperty('B2_SYNC_WINDOW','always');sat.gas.call('b2SyncTick');assert.ok(last(sat));
 assert.equal(sat.gas.call('b2InWindow_','이상한 값','3','12:00'),true,'a broken setting falls back to the default');
 assert.equal(sat.gas.call('b2InWindow_','1,3 08:00-09:00','3','08:30'),true);assert.equal(sat.gas.call('b2InWindow_','1,3 08:00-09:00','2','08:30'),false);
});

test('a run cut at 6 minutes is recorded by the next run; past the daily cap the trigger runs only every 30 minutes',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 const cutAt=gas.clock.t+60000;gas.scriptProps.setProperty('B2_SYNC_RUNNING',String(cutAt));
 tick(env,3*60000);assert.equal(gas.log.drive,0,'a run started 2 minutes ago may still be going');
 tick(env,8*60000);
 let use=JSON.parse(props(env).B2_RUN_USAGE);
 assert.equal(use.cut,1);assert.ok(use.ms>=6*60000);assert.equal(JSON.parse(props(env).B2_SYNC_CUT).at,cutAt);assert.equal(props(env).B2_SYNC_RUNNING,undefined);
 const state=plain(gas.call('b2SyncState_'));assert.equal(state.cutAt,cutAt);assert.equal(state.window,'1-5 09:10-18:00');assert.equal(state.usage.cut,1);
 use.ms=61*60000;use.lastAt=gas.clock.t;gas.scriptProps.setProperty('B2_RUN_USAGE',JSON.stringify(use));
 tick(env);assert.equal(gas.log.drive,0,'over the cap: wait 30 minutes since the last run');
 tick(env,21*60000);assert.equal(gas.log.drive,1);
});

test('many changed rows: only those rows are written (neighbours in one call), and a cut between values and sync columns is repaired even if the source changes again',()=>{
 const env=setup(),{gas,sig}=env;firstRun(env);
 const rows=()=>Object.fromEntries(ledgerView(env).map(r=>[r.name+'|'+r.date,r.row])),before=rows(),b=c=>'가상'+c+'나';
 for(const c of ['1','2','3','4','5','6','7','8','9','10'])setSource(env,c,b(c),'2026-10-07','인정결석','인정결석1- '+b(c)+'_병원');
 tick(env);const res=last(env);
 assert.deepEqual(plain(res.writes),{patched:10,appended:0,cleared:0,boards:10});assert.deepEqual(rows(),before,'every record keeps its row');
 for(const c of ['1','5','10']){const [r]=find(env,b(c),'2026-10-07');assert.deepEqual([r.reason,r.prov,r.flag],['병원','1기 동기화','']);assert.equal(r.sig,sig(rec(c,b(c),'2026-10-07','인정출석',{reason:'병원',ev:'확인'})));}
 const valueWrites=masterWrites(env,'출결원장').filter(w=>w.kind==='values'&&w.c===1);
 assert.ok(valueWrites.length<10,'neighbouring rows share one write: '+valueWrites.length);
 assert.ok(valueWrites.every(w=>[...Array(w.nr).keys()].every(i=>/나$/.test(env.ledger.get(w.r+i,3)))),'only the changed rows are written');
 assert.equal(find(env,'가상2다','2026-10-08')[0].prov,'직접 입력');assert.equal(find(env,'가상4가','2026-10-06')[0].prov,'베타 수정');
 assert.deepEqual(gas.log.outsideLock,[]);
 // 값을 쓴 뒤, 마지막 동기화 칸을 쓰기 전에 끊김
 for(const c of ['6','7','8'])setSource(env,c,b(c),'2026-10-07','인정결석','인정결석1- '+b(c)+'_면접2');
 gas.hooks.push({when:e=>e.op==='write'&&e.range.sh.name==='출결원장'&&e.range.c===1,run:()=>{throw new Error('Exceeded maximum execution time');},once:true});
 assert.throws(()=>tick(env),/Exceeded/);
 let [mid]=find(env,'가상6나','2026-10-07');assert.deepEqual([mid.reason,mid.prov,mid.sig],['면접2','1기 동기화','*'],'values written, row marked as following 운영총괄');
 assert.equal(find(env,'가상7나','2026-10-07')[0].sig,'*');assert.equal(find(env,'가상4가','2026-10-06')[0].prov,'베타 수정','other rows keep their sync columns');
 setSource(env,'6','가상6나','2026-10-07','인정결석','인정결석1- 가상6나_시험');
 tick(env);[mid]=find(env,'가상6나','2026-10-07');
 assert.deepEqual([mid.reason,mid.prov,mid.flag],['시험','1기 동기화','']);assert.equal(mid.sig,sig(rec('6','가상6나','2026-10-07','인정출석',{reason:'시험',ev:'확인'})));
 assert.equal(find(env,'가상7나','2026-10-07')[0].sig,sig(rec('7','가상7나','2026-10-07','인정출석',{reason:'면접2',ev:'확인'})));
 assert.deepEqual(rows(),before);
});

test('signatures that look like numbers stay text in column S, so they keep matching',()=>{
 const env=setup(),{gas,sig}=env;
 // 숫자처럼 보이는 지문이 나오는 사유를 찾습니다('01234567' 또는 '12345e67' 모양)
 let reason='';for(let i=0;i<20000&&!reason;i++){const r='병원'+i;if(/^0\d{7}$|^\d+e\d+$/.test(sig(rec('13','가상13가','2026-10-06','지각',{reason:r}))))reason=r;}
 assert.ok(reason,'found a number-like signature');
 setSource(env,'13','가상13가','2026-10-06','지각','지각1- 가상13가_'+reason);
 firstRun(env);const [row]=find(env,'가상13가','2026-10-06');
 assert.equal(row.reason,reason);assert.equal(typeof row.sig,'string');assert.equal(row.sig,sig(rec('13','가상13가','2026-10-06','지각',{reason})));
 setSource(env,'13','가상13다','2026-10-13','지각','지각1- 가상13다_교통');tick(env);
 assert.equal(last(env).writes.patched,0,'no signature-only rewrite of the number-like row');
});

test('a board that cannot be drawn is reported and retried a few times without blocking the other boards or the ledger',()=>{
 const env=setup(),{gas}=env,bad=env.m.getSheetByName('3007');bad.maxCols=4;
 let res=firstRun(env);
 assert.match(res.warnings.join('\n'),/^7반 출결판:/m);assert.deepEqual(JSON.parse(props(env).B2_PENDING_BOARDS),['7']);
 assert.equal(env.m.getSheetByName('3006').get(17,1),'가상6가','the other boards are drawn');assert.equal(props(env).B2_BOARD_DAY,TODAY);
 tick(env);tick(env);res=last(env);
 assert.match(res.warnings.join('\n'),/7반 출결판은 3번 실패해/);assert.equal(props(env).B2_PENDING_BOARDS,undefined);
 tick(env);assert.equal(gas.log.drive,1);assert.equal(gas.log.api.length,0,'and then the quick skip is back');
});

test('a one-class sync draws only its own board and leaves the pending boards of the full sync alone',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 gas.scriptProps.setProperty('B2_PENDING_BOARDS',JSON.stringify(['3','4']));
 setSource(env,'14','가상14가','2026-10-13','결석','결석1- 가상14가_병원');
 gas.resetLog();const res=plain(gas.call('b2SyncNow_',{cls:'14'}));
 assert.deepEqual(res.processed,['14']);assert.equal(res.writes.boards,1);
 assert.deepEqual([...new Set(masterWrites(env).filter(w=>/^30\d\d$/.test(w.sheet)).map(w=>w.sheet))],['3014']);
 assert.deepEqual(JSON.parse(props(env).B2_PENDING_BOARDS),['3','4']);
});

test('legacy rows of a class that could not be read are left alone; adoption finishes once that class is read',()=>{
 const env=setup(),{src,tabs}=env,tab=src.getSheetByName(tabs['5']);tab.name='5. 이름 바뀜';
 const res=firstRun(env);
 assert.equal(res.mode,'api','a missing tab does not push the other classes to the slow per-tab read');assert.deepEqual(plain(env.gas.log.api),['titles',18]);assert.match(res.errors.join(),/^5반/);
 assert.equal(res.legacyAdopted,16);
 const [row]=find(env,'가상5다','2026-10-08');assert.deepEqual([row.type,row.prov,row.sig],['지각','직접 입력','']);
 assert.equal(props(env).B2_LEGACY_ADOPTED,'1');assert.equal(JSON.parse(props(env).B2_LEGACY_DONE).length,16);
 tick(env);tick(env);assert.ok(env.gas.log.api.length>0,'the failed class is tried again twice');
 tick(env);assert.equal(env.gas.log.reads.filter(r=>r.book===SOURCE).length,0,'then a class that keeps failing does not stop the quick skip');
 tab.name=tabs['5'];env.gas.advance(60000);src.touch();tick(env);
 const [fixed]=find(env,'가상5다','2026-10-08');assert.deepEqual([fixed.type,fixed.prov],['결석','1기 동기화']);
 assert.equal(props(env).B2_LEGACY_ADOPTED,'2');assert.equal(props(env).B2_LEGACY_DONE,undefined);
});

test('a run cut after the ledger write leaves a note; the next run draws those boards and bumps the change number',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 setSource(env,'11','가상11가','2026-10-13','결석','결석1- 가상11가_병원');
 const rev=+props(env).B2_REV,board=env.m.getSheetByName('3011');
 gas.failures.push({op:'flush',times:1,message:'Exceeded maximum execution time'});
 assert.throws(()=>tick(env),/Exceeded/);
 assert.equal(find(env,'가상11가','2026-10-13')[0].type,'결석');assert.equal(+props(env).B2_REV,rev);
 assert.deepEqual(JSON.parse(props(env).B2_PENDING_BOARDS),['11']);assert.equal(board.get(17,6),'출석');
 tick(env);
 assert.equal(board.get(17,6),'결석');assert.equal(props(env).B2_PENDING_BOARDS,undefined);assert.equal(+props(env).B2_REV,rev+1);
});

test('the row-position check is repeated when a write is retried after a temporary error',()=>{
 const env=setup(),{gas,ledger}=env;firstRun(env);
 setSource(env,'12','가상12가','2026-10-06','결석','결석1- 가상12가_병원');
 const victim=find(env,'가상1가','2026-10-06')[0].row;
 gas.failures.push({sheet:'출결원장',op:'write',times:1,message:'Service Spreadsheets failed while accessing document with id abcdefghijklmnopqrstuvwxyz'});
 gas.hooks.push({when:e=>e.op==='fail',run:()=>ledger.deleteRow(victim),once:true});
 assert.throws(()=>tick(env),/행 위치가 그사이 바뀌어/);assert.deepEqual(plain(gas.log.sleeps),[2000]);
});

test('a temporary Sheets error is retried after a pause; other errors stop the run and are shown, and the next run recovers',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 setSource(env,'7','가상7가','2026-10-13','결석','결석1- 가상7가_병원');
 gas.failures.push({sheet:'출결원장',op:'write',times:1,message:'Exception: Service Spreadsheets failed while accessing document with id 1KyY23_YYXKpe-2Md8BpZFGdJNlmV9r0SP4.'});
 tick(env);let res=last(env);
 assert.deepEqual(plain(gas.log.sleeps),[2000]);assert.equal(res.retries.length,1);
 assert.match(res.retries[0],/^출결원장 쓰기: .*id …/);assert.doesNotMatch(res.retries[0],/1KyY/,'document ids are not kept');
 assert.equal(find(env,'가상7가','2026-10-13')[0].type,'결석');
 setSource(env,'7','가상7가','2026-10-13','조퇴','조퇴1- 가상7가_병원 16:00');
 gas.failures.push({sheet:'출결원장',op:'write',times:1,message:'Exception: 범위를 찾지 못했습니다.'});
 assert.throws(()=>tick(env),/범위를 찾지/);
 assert.match(JSON.parse(props(env).B2_SYNC_ERROR).message,/범위를 찾지/);assert.equal(props(env).B2_SYNC_RUNNING,undefined);
 tick(env);res=last(env);
 assert.deepEqual(plain(res.processed),['7'],'hashes were not saved, so the class is merged again');
 assert.equal(find(env,'가상7가','2026-10-13')[0].type,'조퇴');assert.equal(props(env).B2_SYNC_ERROR,undefined);
});

test('a write cut between the values and the sync columns is repaired by the next run without flagging it as a human edit',()=>{
 const env=setup(),{gas,sig}=env;firstRun(env);
 setSource(env,'8','가상8가','2026-10-06','지각','지각1- 가상8가_병원');
 let n=0;gas.hooks.push({when:e=>e.op==='write'&&e.range.sh.name==='출결원장'&&e.range.c===1&&++n===1,run:()=>{throw new Error('Exceeded maximum execution time');},once:true});
 assert.throws(()=>tick(env),/Exceeded/);
 let [row]=find(env,'가상8가','2026-10-06');
 assert.equal(row.reason,'병원');assert.notEqual(row.sig,sig(rec('8','가상8가','2026-10-06','지각',{reason:'병원'})),'values written, signature not yet');
 tick(env);[row]=find(env,'가상8가','2026-10-06');
 assert.deepEqual([row.reason,row.prov,row.flag],['병원','1기 동기화','']);assert.equal(row.sig,sig(rec('8','가상8가','2026-10-06','지각',{reason:'병원'})));
});

test('if ledger rows move between reading and writing (e.g. a row deleted elsewhere), nothing is written and the next run redoes it',()=>{
 const env=setup(),{gas,ledger}=env;firstRun(env);
 setSource(env,'10','가상10가','2026-10-06','결석','결석1- 가상10가_병원');
 const target=find(env,'가상10가','2026-10-06')[0].row,victim=find(env,'가상1가','2026-10-06')[0].row;
 // 동기화는 출결원장을 A~K, R~T 두 번에 읽습니다. 다 읽은 뒤(R~T) 행이 지워진 경우
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.r===2&&e.range.c===18,run:()=>ledger.deleteRow(victim),once:true});
 assert.throws(()=>tick(env),/행 위치가 그사이 바뀌어/);
 assert.equal(ledger.get(target-1,3),'가상10가','the row that moved up was not overwritten');assert.equal(ledger.get(target-1,4),'지각');
 assert.equal(masterWrites(env,'출결원장').filter(w=>w.kind!=='deleteRow').length,0);
 tick(env);
 assert.deepEqual(find(env,'가상10가','2026-10-06').map(r=>[r.type,r.reason]),[['결석','병원']]);
 assert.deepEqual(gas.log.outsideLock,[]);
 // 지워진 동기화 행은 그 반을 다시 맞출 때(그 반이 바뀌거나 다음 날 첫 실행) 운영총괄 값으로 돌아옵니다.
 assert.equal(find(env,'가상1가','2026-10-06').length,0);
 gas.at('2026-10-15T09:20:00+09:00');gas.resetLog();gas.call('b2SyncTick');
 assert.equal(find(env,'가상1가','2026-10-06').length,1);
});

test('a new day redraws every board once, and a manual one-class sync still works',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 gas.at('2026-10-15T09:20:00+09:00');gas.resetLog();gas.call('b2SyncTick');
 let res=last(env);assert.equal(res.writes.boards,17);assert.equal(props(env).B2_BOARD_DAY,'2026-10-15');
 assert.equal(gas.formatDate(env.m.getSheetByName('3012').get(16,5),'Asia/Seoul','MM/dd'),'10/15');
 tick(env);assert.equal(gas.log.api.length,0);
 setSource(env,'12','가상12다','2026-10-15','지각','지각1- 가상12다_09:20');
 gas.resetLog();res=plain(gas.call('b2SyncNow_',{cls:'12'}));
 assert.deepEqual(res.processed,['12']);assert.equal(find(env,'가상12다','2026-10-15')[0].inT,'09:20');
 assert.deepEqual(gas.log.outsideLock,[]);
});

test('pure helpers: grid keys ignore trailing blanks, rotation wraps, the write plan touches only changed rows',()=>{
 const gas=createGas({files:[GS]}),g=(n,...a)=>plain(gas.call(n,...a));
 assert.equal(gas.call('b2GridKey_',[['a','',''],['b'],[],['']]),gas.call('b2GridKey_',[['a'],['b']]));
 assert.deepEqual(g('b2Rotation_',['1','2','3','4','5'],3,4),{pick:['4','5','1','2'],next:2});
 assert.deepEqual(g('b2Rotation_',[],7,4),{pick:[],next:0});
 const sig=r=>gas.call('b2Sig_',r),a=rec('1','가','2026-10-06','지각'),b=rec('1','나','2026-10-06','결석');
 const orig={2:{rec:a,prov:'1기 동기화',sig:sig(a),flag:''},3:{rec:b,prov:'베타 수정',sig:'',flag:''}};
 const plan=g('b2LedgerPlan_',[{row:2,rec:a,prov:'1기 동기화',sig:sig(a),flag:''},{row:3,rec:b,prov:'베타 수정',sig:'',flag:'운영총괄 값: 지각'},{rec:rec('1','다','2026-10-06','조퇴'),prov:'1기 동기화',sig:'x',flag:''}],[{row:9,cls:'1'}],orig);
 assert.deepEqual(plan.patches,[{row:3,cls:'1',rec:null,meta:['베타 수정','','운영총괄 값: 지각']}]);
 assert.equal(plan.appends.length,1);assert.deepEqual(plan.clears,[9]);
 assert.deepEqual(g('b2Runs_',[{row:3,value:'a'},{row:4,value:'b'},{row:7,value:'c'}]),[{row:3,values:['a','b']},{row:7,values:['c']}]);
 const now=(...k)=>k.map(x=>x?{date:'2026-10-06',cls:'1',name:x}:{date:'',cls:'',name:''});
 const plan2={clears:[3],appends:[{rec:rec('1','라','2026-10-06','지각')}]};
 assert.equal(gas.call('b2RowsAsPlanned_',orig,now('가','나'),3,plan2),true,'unchanged');
 assert.equal(gas.call('b2RowsAsPlanned_',orig,now('가','','라'),3,plan2),true,'half written by this plan: cleared row and appended row');
 assert.equal(gas.call('b2RowsAsPlanned_',orig,now('나'),3,plan2),false,'a row was deleted above');
 assert.equal(gas.call('b2RowsAsPlanned_',orig,now('가','나','마'),3,plan2),false,'someone else appended');
 const rows=[{rec:a,prov:'',sig:''},{rec:b,prov:'직접 입력',sig:''},{rec:rec('2','다','2026-10-06','결석'),prov:'직접 입력',sig:''},{rec:a,prov:'베타 수정',sig:''},{rec:a,prov:'1기 동기화',sig:'abc'}];
 const scope={'1':{'2026-10-06':true},'2':{'2026-10-06':true}};
 assert.equal(gas.call('b2AdoptLegacy_',rows,{'1|나|2026-10-06':true},{'1':{'2026-10-06':true}}),1,'class 2 is not in this run');
 assert.equal(gas.call('b2AdoptLegacy_',rows,{'1|나|2026-10-06':true},scope),1,'the rest of class 2 now');
 assert.deepEqual(rows.map(r=>r.prov),['1기 동기화','직접 입력','1기 동기화','베타 수정','1기 동기화']);
});

test('board drawing problems after the ledger is done only warn: a lock timeout between board turns, a one-class run that cannot draw its board, a class failing on the first run of a day',()=>{
 const env=setup(),{gas}=env;
 gas.hooks.push({when:e=>e.op==='write'&&e.range.sh.name==='3004',run:()=>{gas.lock.other=true;},once:true});
 const res=firstRun(env);gas.lock.other=false;
 assert.match(res.warnings.join('\n'),/출결판 그리기 중단: Lock timeout/);assert.equal(props(env).B2_SYNC_ERROR,undefined,'the finished sync is not reported as an error');
 assert.equal(JSON.parse(props(env).B2_PENDING_BOARDS).length,13);
 tick(env);assert.equal(props(env).B2_PENDING_BOARDS,undefined);assert.equal(env.m.getSheetByName('3017').get(17,1),'가상17가');
 // 한 반 가져오기가 자기 반 출결판을 못 그리면 남은 출결판에 더해 두고, 다음 전체 동기화가 그립니다.
 const b15=env.m.getSheetByName('3015');b15.maxCols=4;
 setSource(env,'15','가상15가','2026-10-13','결석','결석1- 가상15가_병원');
 const one=plain(gas.call('b2SyncNow_',{cls:'15'}));assert.match(one.warnings.join('\n'),/^15반 출결판/m);
 assert.deepEqual(JSON.parse(props(env).B2_PENDING_BOARDS),['15']);
 b15.maxCols=64;tick(env);assert.equal(props(env).B2_PENDING_BOARDS,undefined);assert.equal(b15.get(17,6),'결석');
 // 날이 바뀐 첫 실행에서 읽기에 실패한 반은 운영총괄이 그대로여도 두 번 더 읽어 봅니다.
 env.src.getSheetByName(env.tabs['16']).name='16. 이름 바뀜';
 gas.at('2026-10-15T09:20:00+09:00');gas.resetLog();gas.call('b2SyncTick');
 assert.match(last(env).errors.join(),/16반/);assert.ok(+props(env).B2_COLOR_LAP>=2);
});

/* ---- 실행 시간 안전장치: 6분 한도로 끊기기 전에 단계 경계에서 스스로 멈춤 ---- */
const phases=env=>env.logs.filter(l=>l.startsWith('b2 동기화 단계 ')).map(l=>JSON.parse(l.slice('b2 동기화 단계 '.length)).phase);
const readsLQ=env=>env.gas.log.reads.filter(r=>r.sheet==='출결원장'&&r.c<=17&&r.c+r.nc-1>=12); // L~Q 수식 열에 걸친 읽기

test('the sheet time zone is asked once per run, the trigger marks itself running before touching the spreadsheet, and every phase is recorded',()=>{
 const env=setup(),{gas,m}=env;
 let tz=0,active=0,runningAtFirst=null;const tzOf=m.getSpreadsheetTimeZone.bind(m);m.getSpreadsheetTimeZone=()=>{tz++;return tzOf();};
 const SA=gas.ctx.SpreadsheetApp,getActive=SA.getActiveSpreadsheet;
 SA.getActiveSpreadsheet=()=>{if(!active++)runningAtFirst=gas.scriptProps.getProperty('B2_SYNC_RUNNING');return getActive();};
 const res=firstRun(env);
 assert.equal(res.processed.length,17);
 assert.equal(tz,1,'one time-zone call for a whole first run (ledger dates, 17 boards drawn in turns)');
 assert.ok(runningAtFirst,'B2_SYNC_RUNNING is written before the first spreadsheet call');
 assert.deepEqual(phases(env),['start','drive','days','source','colours','lock','read','write','boards 1','boards 2','boards 3','boards 4','boards 5','done']);
 const crumb=JSON.parse(props(env).B2_SYNC_PHASE);assert.equal(crumb.phase,'done');assert.equal(typeof crumb.ms,'number');
 setSource(env,'5','가상5나','2026-10-12','조퇴','조퇴1- 가상5나_병원 15:30');tz=0;tick(env);
 assert.deepEqual(plain(last(env).processed),['5']);assert.equal(tz,1);
 tz=0;active=0;gas.at('2026-10-14T19:30:00+09:00');gas.call('b2SyncTick');
 assert.deepEqual([tz,active],[0,0],'outside the window the trigger does not touch the spreadsheet');
});

test('a slow 운영총괄 read stops the run before the lock: nothing is written or remembered, and the next run does the work',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 setSource(env,'9','가상9가','2026-10-13','결석','결석1- 가상9가_병원');
 const before=props(env),V=gas.ctx.Sheets.Spreadsheets.Values,batchGet=V.batchGet;
 V.batchGet=function(...a){gas.advance(200000);return batchGet.apply(this,a);}; // 3분 20초 걸린 읽기
 env.logs.length=0;tick(env);let res=last(env);
 assert.equal(res.late,'lock');assert.equal(res.skipped,true);assert.match(res.note,/다음 실행/);
 assert.deepEqual(masterWrites(env),[],'no sheet writes');
 assert.equal(gas.log.reads.filter(r=>r.kind==='backgrounds').length,0,'no colour reads once the time is short');
 for(const k of ['B2_SRC_SEEN','B2_SRC_HASH','B2_SRC_COLOR','B2_COLOR_CURSOR','B2_REV'])assert.equal(props(env)[k],before[k],k);
 assert.deepEqual(phases(env),['start','drive','days','source','colours','done']);
 assert.equal(props(env).B2_SYNC_RUNNING,undefined);assert.equal(props(env).B2_SYNC_ERROR,undefined);
 V.batchGet=batchGet;tick(env);res=last(env);
 assert.deepEqual(plain(res.processed),['9']);assert.equal(find(env,'가상9가','2026-10-13')[0].type,'결석');
});

test('a slow 출결원장 read inside the lock stops before writing anything to it; the next run writes the same change',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 setSource(env,'11','가상11가','2026-10-13','결석','결석1- 가상11가_병원');
 const before=props(env),rows=ledgerView(env);
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===1&&e.range.nc===11,run:()=>gas.advance(250000),once:true});
 env.logs.length=0;tick(env);let res=last(env);
 assert.equal(res.late,'write');assert.deepEqual(masterWrites(env,'출결원장'),[]);assert.deepEqual(ledgerView(env),rows);
 assert.equal(gas.lock.depth,0,'the document lock is released');
 for(const k of ['B2_SRC_SEEN','B2_SRC_HASH','B2_PENDING_BOARDS','B2_REV'])assert.equal(props(env)[k],before[k],k);
 assert.deepEqual(phases(env).slice(-3),['lock','read','done']);
 tick(env);res=last(env);
 assert.deepEqual(plain(res.processed),['11']);assert.equal(find(env,'가상11가','2026-10-13')[0].type,'결석');
});

test('slow board drawing stops between turns and leaves the rest in B2_PENDING_BOARDS; the next run draws only those',()=>{
 const env=setup(),{gas}=env;
 const slow={when:e=>e.op==='write'&&/^30\d\d$/.test(e.range.sh.name),run:()=>gas.advance(8000)};gas.hooks.push(slow); // 출결판 쓰기 한 번에 8초
 const res=firstRun(env);
 assert.equal(res.processed.length,17);assert.equal(find(env,'가상3나','2026-10-12').length,0,'the ledger part finished');
 assert.deepEqual(JSON.parse(props(env).B2_PENDING_BOARDS),['13','14','15','16','17']);
 assert.equal(props(env).B2_BOARD_DAY,TODAY,"today's full redraw goes on from the pending list instead of starting over");
 assert.match(res.warnings.join('\n'),/출결판 5반은 다음 실행에서/);
 assert.deepEqual(phases(env).slice(-4),['boards 1','boards 2','boards 3','done']);
 assert.equal(env.m.getSheetByName('3012').get(17,1),'가상12가');assert.equal(env.m.getSheetByName('3013').get(17,1),'');
 assert.deepEqual(gas.log.outsideLock,[]);
 gas.hooks.splice(gas.hooks.indexOf(slow),1);tick(env);
 assert.equal(props(env).B2_PENDING_BOARDS,undefined);assert.equal(env.m.getSheetByName('3017').get(17,1),'가상17가');
 assert.deepEqual([...new Set(masterWrites(env).filter(w=>/^30\d\d$/.test(w.sheet)).map(w=>w.sheet))].sort(),['3013','3014','3015','3016','3017']);
});

test('a call that timed out is not retried, and a slow temporary error is not retried when the time left cannot cover the pause',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 setSource(env,'7','가상7가','2026-10-13','결석','결석1- 가상7가_병원');
 gas.failures.push({sheet:'출결원장',op:'write',times:1,message:'Exception: Service Spreadsheets timed out while accessing document with id abcdefghijklmnopqrstuvwxyz.'});
 assert.throws(()=>tick(env),/timed out/);assert.deepEqual(plain(gas.log.sleeps),[]);
 assert.match(JSON.parse(props(env).B2_SYNC_ERROR).message,/timed out/);
 gas.failures.push({sheet:'출결원장',op:'write',times:1,message:'Exception: Service Spreadsheets failed while accessing document with id abcdefghijklmnopqrstuvwxyz.'});
 gas.hooks.push({when:e=>e.op==='fail'&&e.sheet==='출결원장',run:()=>gas.advance(200000),once:true}); // 3분 20초 만에 실패
 assert.throws(()=>tick(env),/failed while accessing/);assert.deepEqual(plain(gas.log.sleeps),[]);
 tick(env);assert.equal(find(env,'가상7가','2026-10-13')[0].type,'결석');assert.equal(props(env).B2_SYNC_ERROR,undefined);
});

test('colour reads open 운영총괄 once per run, are not retried, and a failure stops the rotation where it is',()=>{
 const env=setup(),{gas,tabs}=env;firstRun(env);
 const SA=gas.ctx.SpreadsheetApp,openById=SA.openById;let opens=0;SA.openById=id=>{opens++;return openById(id);};
 const bgReads=()=>gas.log.reads.filter(r=>r.book===SOURCE&&r.kind==='backgrounds').map(r=>r.sheet);
 const run=()=>{gas.resetLog();return plain(gas.run('b2Begin_(), b2SyncRun_({reason: "trigger"})'));};
 gas.advance(60000);env.src.touch();
 gas.failures.push({sheet:tabs['2'],op:'read',times:1,message:'Service Spreadsheets failed while accessing document with id abcdefghijklmnopqrstuvwxyz'});
 let res=run();
 assert.equal(opens,1);assert.deepEqual(bgReads(),[tabs['1']],'class 1 read, class 2 failed, classes 3 and 4 wait');
 assert.deepEqual(plain(gas.log.sleeps),[]);assert.match(res.errors.join('\n'),/^2반 색: .*failed while accessing/m);
 assert.deepEqual(res.colorChecked,['1','2']);assert.equal(props(env).B2_COLOR_CURSOR,'2');
 tick(env);assert.deepEqual(bgReads(),['3','4','5','6'].map(c=>tabs[c]),'the next run goes on from class 3');assert.equal(opens,2);
 // 운영총괄을 열지 못하면 여는 시도는 한 번. 값이 바뀐 반은 지금처럼 이번 반영에서 빠지고(다음 실행에서 다시), 돌아가는 확인은 멈춤
 setSource(env,'8','가상8가','2026-10-13','결석','결석1- 가상8가_병원');setSource(env,'10','가상10다','2026-10-13','결석','결석1- 가상10다_병원');
 opens=0;SA.openById=()=>{opens++;throw new Error('Service Spreadsheets failed while accessing document with id abcdefghijklmnopqrstuvwxyz');};
 res=run();
 assert.equal(opens,1);assert.match(res.errors.join('\n'),/^8반 색: 운영총괄 열기/m);assert.match(res.errors.join('\n'),/^10반 색: 운영총괄 열기/m);
 assert.deepEqual(res.colorChecked,[]);assert.deepEqual(gas.log.sleeps,[]);
 assert.equal(find(env,'가상8가','2026-10-13').length,0,'a class whose colours could not be read is not written');
 SA.openById=openById;tick(env);
 assert.deepEqual(plain(last(env).processed),['8','10']);assert.equal(find(env,'가상10다','2026-10-13')[0].type,'결석');
});

test('a temporary Sheets API failure stops a 10-minute run once and the next run tries the API again; a second failure in a row, a non-temporary error or a full run falls back to per-tab reads',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 setSource(env,'3','가상3가','2026-10-13','결석','결석1- 가상3가_병원');
 // 일시 오류는 b2Retry_가 두 번 더 해 보므로 세 번 실패해야 그 실행의 실패입니다.
 const seen=props(env).B2_SRC_SEEN,fail=(m,times=3)=>gas.failures.push({sheet:'Sheets',op:'read',times,message:'API call to sheets.spreadsheets.get failed with error: '+m});
 const classTabs=Object.values(env.tabs),perTab=()=>gas.log.reads.filter(r=>r.book===SOURCE&&r.kind==='display'&&classTabs.includes(r.sheet)).length;
 fail('Internal error encountered.');tick(env);let res=last(env);
 assert.equal(res.mode,'api');assert.match(res.apiError,/Internal error/);assert.match(res.errors.join(),/운영총괄 읽기\(API\)/);
 assert.equal(gas.log.reads.filter(r=>r.book===SOURCE).length,0,'no per-tab reads of 운영총괄');
 assert.deepEqual(masterWrites(env),[]);assert.equal(props(env).B2_SRC_SEEN,seen,'the source is read again next time');assert.equal(props(env).B2_API_FAILS,'1');
 tick(env);res=last(env);assert.equal(res.mode,'api');assert.deepEqual(plain(res.processed),['3']);assert.equal(props(env).B2_API_FAILS,undefined,'a good API read clears the count');
 assert.equal(find(env,'가상3가','2026-10-13')[0].type,'결석');
 // 일시 오류가 두 번 이어지면 두 번째 실행은 반마다 읽기로 넘어가 반영합니다(API가 계속 안 돼도 출결판·저장한 반 다시 맞추기가 멈추지 않게).
 setSource(env,'5','가상5나','2026-10-13','결석','결석1- 가상5나_병원');
 fail('Backend Error');tick(env);assert.equal(last(env).processed,undefined);assert.equal(perTab(),0);
 fail('Backend Error');tick(env);res=last(env);
 assert.equal(res.mode,'sheet');assert.match(res.apiError,/Backend Error/);assert.equal(perTab(),17);assert.deepEqual(plain(res.processed),['5']);
 assert.equal(find(env,'가상5나','2026-10-13')[0].type,'결석');
 setSource(env,'6','가상6나','2026-10-13','결석','결석1- 가상6나_병원');tick(env);assert.equal(last(env).mode,'api');assert.equal(props(env).B2_API_FAILS,undefined);
 // 일시 오류가 아니면(권한 없음·API 꺼짐) 다음 실행도 같으므로 바로 반마다 읽습니다.
 setSource(env,'7','가상7나','2026-10-13','결석','결석1- 가상7나_병원');
 fail('Forbidden',1);tick(env);res=last(env);assert.deepEqual(plain(gas.log.sleeps),[],'not retried');
 assert.equal(res.mode,'sheet');assert.match(res.apiError,/Forbidden/);assert.deepEqual(plain(res.processed),['7']);
 // 전체 다시 맞추기는 처음 실패에도 넘어갑니다.
 setSource(env,'4','가상4나','2026-10-13','결석','결석1- 가상4나_병원');gas.scriptProps.deleteProperty('B2_API_FAILS');
 fail('Internal error encountered.');gas.resetLog();res=plain(gas.call('b2SyncNow_',{}));
 assert.equal(res.mode,'sheet');assert.match(res.apiError,/Internal error/);assert.equal(find(env,'가상4나','2026-10-13')[0].type,'결석');
});

test('per-tab reads stop when the run is short on time: nothing is remembered and the next run reads again',()=>{
 const env=setup({sheetsApi:false}),{gas}=env;firstRun(env);
 setSource(env,'9','가상9가','2026-10-13','결석','결석1- 가상9가_병원');
 const before=props(env);
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.book===env.src&&e.range.sh.name===env.tabs['2'],run:()=>gas.advance(200000),once:true}); // 2반을 읽는 데 3분 20초
 tick(env);const res=last(env);
 const classTabs=Object.values(env.tabs);
 assert.equal(res.late,'lock');assert.equal(gas.log.reads.filter(r=>r.book===SOURCE&&r.kind==='display'&&classTabs.includes(r.sheet)).length,2,'classes 3..17 are not read');
 assert.match(res.errors.join('\n'),/^3반: 실행 시간이 모자라/m);assert.deepEqual(masterWrites(env),[]);
 for(const k of ['B2_SRC_SEEN','B2_SRC_HASH','B2_COLOR_CURSOR'])assert.equal(props(env)[k],before[k],k);
 tick(env);assert.deepEqual(plain(last(env).processed),['9']);assert.equal(find(env,'가상9가','2026-10-13')[0].type,'결석');
});

test('a run killed at the 6-minute limit: the next run stores its last phase in B2_SYNC_CUT and counts it toward the daily cap',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 const started=gas.clock.t+60000;
 let use=JSON.parse(props(env).B2_RUN_USAGE);use.ms=55*60000;gas.scriptProps.setProperty('B2_RUN_USAGE',JSON.stringify(use));
 gas.scriptProps.setProperty('B2_SYNC_RUNNING',String(started));
 gas.scriptProps.setProperty('B2_SYNC_PHASE',JSON.stringify({phase:'read',at:started+95000,ms:95000}));
 gas.advance(2*60000);assert.deepEqual(plain(gas.call('b2SyncState_').running),{at:started,phase:'read',ms:95000},'while it runs, its phase is visible');
 tick(env,8*60000);
 assert.deepEqual(JSON.parse(props(env).B2_SYNC_CUT),{at:started,phase:'read',ms:95000});
 use=JSON.parse(props(env).B2_RUN_USAGE);assert.equal(use.cut,1);assert.equal(use.lastAt,started+6*60000);
 assert.equal(gas.log.drive,0,'55 + 6 minutes is over the daily cap and the killed run counts as the last run: wait 30 minutes');
 assert.equal(props(env).B2_SYNC_RUNNING,undefined);
 const st=plain(gas.call('b2SyncState_'));
 assert.equal(st.cutAt,started);assert.deepEqual(st.cut,{at:started,phase:'read',ms:95000});assert.equal(st.running,null);
 assert.equal(syncText(st,gas.clock.t).cutText,'시간 초과로 중단(단계: 출결원장 읽기)');
 // 예전 값(시작 시각 숫자)도 읽습니다. 단계 기록이 없는(예전) 실행이 끊기면 단계는 빈칸입니다.
 gas.scriptProps.setProperty('B2_SYNC_CUT','1791939660000');assert.equal(gas.call('b2SyncState_').cutAt,1791939660000);
 gas.scriptProps.deleteProperty('B2_SYNC_PHASE');gas.scriptProps.setProperty('B2_SYNC_RUNNING',String(gas.clock.t));
 tick(env,40*60000);assert.deepEqual(JSON.parse(props(env).B2_SYNC_CUT).phase,'');assert.equal(gas.log.drive,1,'30 minutes later it runs again');
});

test('the sync reads 출결원장 A:K and R:T only (never the L:Q formulas) and formats column S only on the rows it writes',()=>{
 const env=setup(),{gas}=env;
 const first=firstRun(env);assert.deepEqual(readsLQ(env),[]);
 const fmt=masterWrites(env,'출결원장').filter(w=>w.kind==='format'&&w.c===19),formatted=fmt.reduce((n,w)=>n+w.nr,0);
 assert.ok(formatted>0&&formatted<=first.writes.patched+first.writes.appended,'only written rows, not the whole column: '+JSON.stringify(fmt.map(w=>[w.r,w.nr])));
 setSource(env,'5','가상5나','2026-10-12','조퇴','조퇴1- 가상5나_병원 15:30');tick(env);
 assert.deepEqual(readsLQ(env),[]);
 const row=find(env,'가상5나','2026-10-12')[0].row;
 assert.deepEqual(masterWrites(env,'출결원장').filter(w=>w.kind==='format'&&w.c===19).map(w=>[w.r,w.nr]),[[row,1]]);
 assert.equal(env.ledger.fmt.get(env.ledger.key(row,19)),'@');
 gas.resetLog();const b=gas.call('b2Bundle_','5');
 assert.ok(readsLQ(env).length>0,'the portal bundle still reads the memo and check columns');assert.equal(b.ledgerCols.length,17);
});

test('runs killed one after another still add up: each cut is saved at once, so the daily cap engages',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 const use=JSON.parse(props(env).B2_RUN_USAGE);use.ms=40*60000;gas.scriptProps.setProperty('B2_RUN_USAGE',JSON.stringify(use));
 // 6분 한도로 끊긴 실행: b2SyncRun_ 안에서 멈추고, 그 뒤의 일(catch·finally)은 속성에 아무것도 남기지 못함
 const real=gas.ctx.b2SyncRun_,P=gas.scriptProps,set=P.setProperty,del=P.deleteProperty;let dead=false,runs=0;
 P.setProperty=function(k,v){return dead?this:set.call(this,k,v);};P.deleteProperty=function(k){return dead?this:del.call(this,k);};
 gas.ctx.b2SyncRun_=()=>{runs++;dead=true;throw new Error('Exceeded maximum execution time');};
 const saved=[];
 for(let i=0;i<4;i++){assert.throws(()=>tick(env),/Exceeded/);dead=false;const u=JSON.parse(props(env).B2_RUN_USAGE);saved.push([u.ms/60000,u.cut]);}
 assert.deepEqual(saved,[[40,0],[46,1],[52,2],[58,3]]);
 tick(env);assert.equal(runs,4,'64 minutes is over the daily cap: the fifth tick waits');assert.equal(JSON.parse(props(env).B2_RUN_USAGE).cut,4);
 assert.equal(props(env).B2_SYNC_RUNNING,undefined);
 gas.ctx.b2SyncRun_=real;tick(env,30*60000);assert.equal(gas.log.drive,1,'30 minutes after the last cut it runs again');
});

test('a roster-only change cut before writing leaves 명부 alone; the next run adds the student, draws the board and bumps the change number',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 env.src.getSheetByName(env.tabs['5']).fill(22,13,[['가상5라','','','',...DAYS.map(d=>d>TODAY?'':'출석')]]);gas.advance(60000);env.src.touch();
 const rev=+props(env).B2_REV,roster=env.m.getSheetByName('명부'),board=env.m.getSheetByName('3005'),last0=roster.getLastRow();
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===1&&e.range.nc===11,run:()=>gas.advance(250000),once:true});
 tick(env);let res=last(env);
 assert.equal(res.late,'write');assert.deepEqual(masterWrites(env),[],'neither 명부 nor 출결원장 is written');
 assert.equal(roster.getLastRow(),last0);assert.equal(+props(env).B2_REV,rev);
 tick(env);res=last(env);
 assert.deepEqual(plain(res.processed),['5']);assert.deepEqual(plain(res.roster),{updated:0,added:1});
 assert.deepEqual(roster.rows(last0+1,1,1,4)[0],[5,'가상5라','','재학']);
 assert.equal(board.get(20,1),'가상5라','the board of that class is drawn with the new student');assert.equal(+props(env).B2_REV,rev+1);
 assert.deepEqual(gas.log.outsideLock,[]);
});

test('if 명부 rows move while the ledger is read, the roster write stops instead of writing over another row; the next run appends after it',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 env.src.getSheetByName(env.tabs['5']).fill(22,13,[['가상5라','','','',...DAYS.map(d=>d>TODAY?'':'출석')]]);gas.advance(60000);env.src.touch();
 const roster=env.m.getSheetByName('명부'),last0=roster.getLastRow();
 // 그사이 누가 명부 맨 아래에 학생을 적음(사람 편집은 문서 잠금을 잡지 않음)
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===1&&e.range.nc===11,run:()=>roster.fill(last0+1,1,[[9,'가상9추가','','재학']]),once:true});
 assert.throws(()=>tick(env),/명부 행 위치가 그사이 바뀌어/);
 assert.deepEqual(roster.rows(last0+1,1,1,2)[0],[9,'가상9추가'],'the row someone typed is kept');
 tick(env);assert.deepEqual(roster.rows(last0+2,1,1,2)[0],[5,'가상5라']);assert.deepEqual(gas.log.outsideLock,[]);
 // 행이 지워져 상태를 바꿀 학생의 행이 밀린 경우도 같음
 setSource(env,'5','가상5다','2026-10-13','해당없음');setSource(env,'5','가상5다','2026-10-14','해당없음');
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===1&&e.range.nc===11,run:()=>roster.deleteRow(2),once:true});
 assert.throws(()=>tick(env),/명부 행 위치가 그사이 바뀌어/);
 assert.ok(!roster.rows(2,4,last0,1).flat().includes('중도탈락'),'no status written on a shifted row');
 tick(env);const r=roster.rows(2,1,last0+1,5).find(x=>x[1]==='가상5다');assert.equal(r[3],'중도탈락');
});

test('a release whose follow-up sync stops early marks the class, so the next run puts the 운영총괄 values into the released rows',()=>{
 const env=setup(),{gas,sig}=env;firstRun(env);
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.c===1&&e.range.nc===11,run:()=>gas.advance(250000),once:true});
 gas.advance(60000);gas.resetLog();const res=plain(gas.call('b2Release_',{cls:'4',name:'가상4가',date:'2026-10-06'}));
 assert.equal(res.released,1);assert.equal(res.sync.late,'write');
 let [row]=find(env,'가상4가','2026-10-06');assert.deepEqual([row.type,row.prov,row.sig],['결석','1기 동기화','*']);
 assert.deepEqual(JSON.parse(props(env).B2_DIRTY),['4']);
 tick(env);assert.deepEqual(plain(last(env).processed),['4']);
 [row]=find(env,'가상4가','2026-10-06');assert.deepEqual([row.type,row.reason,row.prov,row.flag],['지각','교통','1기 동기화','']);
 assert.equal(row.sig,sig(rec('4','가상4가','2026-10-06','지각',{reason:'교통'})));assert.equal(props(env).B2_DIRTY,undefined);
});

test('each date and time is formatted once per run, not once per ledger or roster row, and the next run starts afresh',()=>{
 const env=setup(),{gas}=env;firstRun(env);
 const U=gas.ctx.Utilities,real=U.formatDate,calls=[];U.formatDate=(d,z,p)=>{calls.push(p+'|'+d.getTime());return real(d,z,p);};
 setSource(env,'5','가상5나','2026-10-12','조퇴','조퇴1- 가상5나_병원 15:30');tick(env);
 assert.deepEqual(plain(last(env).processed),['5']);
 const per={};calls.forEach(k=>{per[k]=(per[k]||0)+1;});
 assert.ok(calls.length<ledgerView(env).length,calls.length+' calls for '+ledgerView(env).length+' ledger rows (and 51 roster birth dates)');
 assert.deepEqual(Object.entries(per).filter(([,n])=>n>2),[],'at most the trigger\'s own clock check and b2Today_ share one key');
 // b2Fmt_는 실행 안에서만 기억합니다(b2Begin_이 비움: 다음 실행은 시트 시간대를 다시 물음)
 calls.length=0;gas.run('b2Begin_(); b2ReadLedger_(true)');const once=calls.length;assert.ok(once>0);
 calls.length=0;gas.run('b2ReadLedger_(true)');assert.equal(calls.length,0,'the same run reads the ledger again without formatting');
 calls.length=0;gas.run('b2Begin_(); b2ReadLedger_(true)');assert.equal(calls.length,once,'a new run formats again');
 U.formatDate=real;
});
