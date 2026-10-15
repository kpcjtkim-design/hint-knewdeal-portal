import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGas} from './gas-fake.mjs';

// /beta2 묶음 캐시(beta2.gs b2Bundle)와 변경 번호(B2_REV) 올리기(beta2.gs·Code.gs)를 가짜 Google 서비스로 시험합니다. 학생은 모두 가상입니다.
const GS=fileURLToPath(new URL('../../apps-script/beta2/beta2.gs',import.meta.url));
const CODE=fileURLToPath(new URL('../../apps-script/master/Code.gs',import.meta.url));
const MASTER='master-test',SOURCE='source-test';
const DAYS=['2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
const CLASSES=[1,2,3,5],ALL=Array.from({length:17},(_,i)=>String(i+1));
const LEDGER_HEAD=['일자','반','이름','유형','입실','퇴실','외출시작','외출종료','사유','증빙','반려사유','메모','코드','','증빙반영','','확인','출처','동기화 지문','동기화 확인'];
const plain=x=>JSON.parse(JSON.stringify(x));
const md=iso=>`${+iso.slice(5,7)}/${+iso.slice(8,10)}`;
const L=(date,cls,name,type,x={})=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',code:'',evApplied:'',check:'',prov:'',sig:'',flag:'',...x});
// 반 칸이 0인 행(cx 조각)이 중간에 끼어 있어 'all'의 시트 순서 되살리기를 확인합니다.
const ROWS=[
 L('2026-10-07',1,'가상1가','지각',{inT:'09:20',reason:'교통',memo:'지각_담임1:가상1가(09:20)',code:'C1',evApplied:'해당없음',check:'OK',prov:'1기 동기화',sig:'0a1b2c3d'}),
 L('2026-10-07',3,'가상3나','결석',{reason:'개인',prov:'베타 수정',flag:"운영총괄 값: 지각 / 사유 '교통'"}),
 L('2026-10-08',0,'가상무반','결석',{reason:'반 칸 오류'}),
 L('2026-10-08',2,'가상2가','인정출석',{reason:'면접',ev:'확인',evApplied:'확인',prov:'1기 동기화'}),
 L('2026-10-12',5,'가상5나','조퇴',{outT:'16:00',reason:'병원',prov:'직접 입력'}),
 L('2026-10-13',1,'가상1나','외출',{oa:'10:00',ob:'11:00',reason:'은행'}),
 L('2026-10-13',17,'가상17가','지각',{inT:'09:40'}),
 L('2026-10-14',3,'가상3가','지각',{inT:'09:30',reason:'버스'})
];
// 캐시 전 b2Bundle 그대로(응답 모양·순서의 기준)
const OLD_BUNDLE=`(function (cls) {
  cls = String(cls || 'all');
  var days = b2Days_(), ledger = b2ReadLedger_().rows, roster = b2ReadRoster_().rows;
  var pick = function (x) { return cls === 'all' || x === cls; };
  return {
    rev: +b2Props_().getProperty('B2_REV') || 0, today: b2Today_(), days: days.list, classes: b2Info_(),
    roster: roster.filter(function (r) { return pick(r.cls); }).map(function (r) { return [r.cls, r.name, r.status, r.changed]; }),
    ledgerCols: B2_LEDGER_COLS,
    ledger: ledger.filter(function (r) { return pick(r.rec.cls); }).map(function (r) {
      var x = r.rec; return [x.date, x.cls, x.name, x.type, x.inT, x.outT, x.oa, x.ob, x.reason, x.ev, x.evr, r.memo, r.evApplied, r.check, r.prov, r.flag, b2Sig_(x)];
    }),
    sync: b2SyncState_()
  };
})`;

function setup({files=[GS],cache=true,now='2026-10-14T10:00:00+09:00',extra=[]}={}){
 const gas=createGas({now,files,cache}),d=iso=>gas.date(...iso.split('-').map(Number));
 const m=gas.book(MASTER,'마스터',true);
 const days=m.add('교육일자',200,6).fill(1,1,[['교육일']]).fill(2,1,DAYS.map(x=>[d(x)])).fill(5,4,[[d('2026-10-14')]]);
 const people=[];
 for(const c of CLASSES){people.push([c,`가상${c}가`,'','재학','','',d('2000-01-01'),'남성'],[c,`가상${c}나`,'','재학','','',d('2000-01-01'),'여성']);if(c===2)people.push(['','가상무반','','재학','','','','']);}
 people.push([5,'가상5다','','중도탈락',d('2026-10-08'),'','',''],[17,'가상17가','','재학','','','','']);
 const roster=m.add('명부',800,8).fill(1,1,[['반','이름','번호','상태','상태 변경일','','생년월일','성별']]).fill(2,1,people);
 const ledger=m.add('출결원장',2000,20).fill(1,1,[LEDGER_HEAD]);
 [...ROWS,...extra].forEach((r,i)=>ledger.fill(2+i,1,[[d(r.date),r.cls,r.name,r.type,r.inT,r.outT,r.oa,r.ob,r.reason,r.ev,r.evr,r.memo,r.code,'',r.evApplied,'',r.check,r.prov,r.sig,r.flag]]));
 m.add('변경이력',200,8).fill(1,1,[['시각','변경자','경로','반','이름','교육일','이전','이후']]);
 const info=m.add('반정보',30,20).fill(4,7,[...CLASSES,17].map(c=>[c+'반','지역'+c,'과정'+c,'HRD'+c,'담임'+c,'','장소'+c,'주소'+c,String(3000+c),'']));
 m.add('시간표',100,8);
 const boards={};for(const c of CLASSES)boards[c]=m.add(String(3000+c),80,64).fill(3,4,[[c]]).fill(16,1,[['이름']]);
 gas.scriptProps.setProperty('B2_REV','5');gas.scriptProps.setProperty('B2_SOURCE_ID','none');
 const old=files.includes(GS)?gas.run(OLD_BUNDLE):null;
 return {gas,m,d,days,roster,ledger,info,boards,old};
}
const bundle=(env,cls)=>{env.gas.resetLog();return plain(env.gas.call('b2Bundle',cls));};
const sheetReads=env=>env.gas.log.reads.filter(r=>r.book===MASTER);
const rev=env=>+env.gas.scriptProps.getProperty('B2_REV');
const head=env=>{const e=env.gas.cacheStore.get('b2b:head');return e?JSON.parse(e.v):null;};
const stampOf=(env,r)=>'v'+env.gas.run('B2_CACHE.v')+'.'+r+'.'+env.m.updated; // 캐시 형식 번호 + B2_REV + Drive 수정 시각
const rowOf=(b,name,date)=>b.ledger.filter(r=>r[2]===name&&r[0]===date);
// 캐시를 채우고 다음 호출이 시트를 읽지 않는 상태로 만듭니다.
function primed(env){bundle(env,'all');bundle(env,'all');assert.equal(sheetReads(env).length,0,'primed: a hit reads nothing');}
// act가 B2_REV를 올리고, 다음 호출이 시트를 다시 읽어 바뀐 값을 돌려주는지
function invalidates(env,label,act,check){
 primed(env);const before=rev(env);act();
 assert.ok(rev(env)>before,label+': B2_REV goes up');
 const b=bundle(env,'all');
 assert.ok(sheetReads(env).some(r=>r.sheet==='출결원장'&&r.nc===20),label+': the next call reads the ledger again');
 assert.equal(b.rev,rev(env),label+': and returns the new rev');
 check(b);
}

test('a miss reads the four tabs once and stores every class; later calls for any class or all read nothing and equal the uncached bundle',()=>{
 const env=setup(),{gas,old}=env,want=Object.fromEntries(['all',...ALL].map(c=>[c,JSON.stringify(old(c))]));
 gas.resetLog();const first=gas.call('b2Bundle','3');
 assert.equal(JSON.stringify(first),want['3']);
 assert.deepEqual([...new Set(sheetReads(env).map(r=>r.sheet))].sort(),['교육일자','명부','반정보','출결원장']);
 assert.equal(sheetReads(env).filter(r=>r.sheet==='출결원장'&&r.nc===20).length,1,'the ledger is read once for all classes');
 assert.equal(gas.log.drive,1,'one Drive call for the master file time');
 const h=head(env);
 assert.equal(h.stamp,stampOf(env,5));
 for(const p of ['base','c1','c2','c3','c5','c17','cx'])assert.ok(h.parts[p]>=1,p);
 for(const c of ['3','5','7','all','1','17','2']){
  gas.resetLog();const b=gas.call('b2Bundle',c);
  assert.equal(gas.log.reads.length,0,c+': a hit touches no sheet');assert.equal(JSON.stringify(b),want[c],c+': same as before the cache');
 }
 assert.deepEqual(gas.log.cache.map(x=>x.op),['get','getAll'],'a hit is one head read and one chunk read');
 // L·O·Q열(메모·증빙반영·확인)도 그대로 나갑니다.
 const [r]=rowOf(bundle(env,'1'),'가상1가','2026-10-07');
 assert.deepEqual([r[11],r[12],r[13],r[14],r[16]],['지각_담임1:가상1가(09:20)','해당없음','OK','1기 동기화',gas.call('b2Sig_',{date:'2026-10-07',cls:'1',name:'가상1가',type:'지각',inT:'09:20',reason:'교통'})]);
});

test('class bundles carry only their own class, and all keeps the sheet order including rows whose class is not 1..17',()=>{
 const env=setup();bundle(env,'all');
 for(const c of ALL){
  const b=bundle(env,c);assert.equal(sheetReads(env).length,0);
  assert.ok(b.ledger.every(r=>r[1]===c)&&b.roster.every(r=>r[0]===c),c);
 }
 assert.deepEqual(bundle(env,'3').ledger.map(r=>r[2]),['가상3나','가상3가']);
 const all=bundle(env,'all');
 assert.deepEqual(all.ledger.map(r=>r[2]),ROWS.map(r=>r.name),'sheet order');
 assert.deepEqual(all.roster.map(r=>r[1]).slice(2,5),['가상2가','가상2나','가상무반']);
 assert.equal(all.classes.length,5);
});

test('rev, today and the sync state are read fresh on every hit',()=>{
 const env=setup({now:'2026-10-14T22:00:00+09:00'}),{gas}=env;
 const a=bundle(env,'2');assert.equal(a.today,'2026-10-14');assert.equal(a.sync.last,null);
 gas.scriptProps.setProperty('B2_SYNC_LAST',JSON.stringify({at:1,processed:['2']}));gas.scriptProps.setProperty('B2_SYNC_CHECKED','123');
 let b=bundle(env,'2');assert.equal(sheetReads(env).length,0);
 assert.deepEqual(b.sync.last,{at:1,processed:['2']});assert.equal(b.sync.checkedAt,123);
 gas.at('2026-10-15T00:30:00+09:00');b=bundle(env,'2');
 assert.equal(sheetReads(env).length,0,'still cached after midnight');assert.equal(b.today,'2026-10-15');
 gas.at('2026-10-15T04:00:01+09:00');b=bundle(env,'2');
 assert.ok(sheetReads(env).length>0,'after 6 hours the cache has expired');
 assert.deepEqual(b,plain(env.old('2')));
});

test('b2Save, b2Release and a sync that writes bump B2_REV, and the next call reads the sheet again',()=>{
 const env=setup(),{gas}=env;
 invalidates(env,'b2Save',()=>{
  const res=gas.call('b2Save',{cls:'3',name:'가상3가',date:'2026-10-13',type:'결석',reason:'개인',ev:'',before:''});
  assert.equal(res.ok,true);
 },b=>assert.deepEqual(rowOf(b,'가상3가','2026-10-13').map(r=>[r[3],r[8],r[14]]),[['결석','개인','베타 수정']]));
 assert.deepEqual(gas.log.outsideLock,[]);
 invalidates(env,'b2Release (no source, so the sync is skipped)',()=>{
  assert.equal(gas.call('b2Release',{cls:'3',name:'가상3나',date:'2026-10-07'}).released,1);
 },b=>assert.equal(rowOf(b,'가상3나','2026-10-07')[0][14],'1기 동기화'));
 // 한 반 가져오기: 운영총괄 5반 탭(가상)에서 가상5가 10/13 결석이 새로 들어옵니다.
 const tab=gas.run("B2.SOURCE_TABS['5']"),src=gas.book(SOURCE,'1기 운영총괄').add(tab,60,30);
 src.fill(18,13,[['이름','출석률','출석일수','지/조/외/중복',...DAYS.map(md)]]);
 const cells={'가상5가|2026-10-13':'결석','가상5나|2026-10-12':'조퇴'};
 ['가상5가','가상5나'].forEach((n,i)=>src.fill(19+i,13,[[n,'','','',...DAYS.map(x=>x>'2026-10-14'?'':cells[n+'|'+x]||'출석')]]));
 src.fill(50,13,[['사유','','','',...DAYS.map(md)]]).fill(51,13,[['*','','','',...DAYS.map(x=>({'2026-10-13':'결석1- 가상5가_병원','2026-10-12':'조퇴1- 가상5나_병원 16:00'})[x]||'')]]);
 gas.scriptProps.setProperty('B2_SOURCE_ID',SOURCE);
 invalidates(env,'b2SyncNow',()=>{
  const res=plain(gas.call('b2SyncNow',{cls:'5'}));assert.deepEqual(res.processed,['5']);assert.equal(res.writes.appended,1);
 },b=>assert.deepEqual(rowOf(b,'가상5가','2026-10-13').map(r=>[r[3],r[8],r[14]]),[['결석','병원','1기 동기화']]));
 assert.deepEqual(gas.log.outsideLock,[]);
});

test('Code.gs writes to 출결원장·명부 and direct edits of the four tabs bump B2_REV; other edits keep the cache',()=>{
 const env=setup({files:[CODE,GS]}),{gas,d,ledger,roster,days,info,boards}=env;
 invalidates(env,'portalSave → upsert_',()=>{
  assert.equal(gas.call('portalSave',{cls:3,pin:'',name:'가상3가',date:'2026-10-13',type:'지각',inT:'09:15',r:'버스'}).ok,true);
 },b=>assert.deepEqual(rowOf(b,'가상3가','2026-10-13').map(r=>[r[3],r[4],r[8]]),[['지각','09:15','버스']]));
 invalidates(env,'portalSave 해당없음 → removeRow_',()=>{
  gas.call('portalSave',{cls:3,pin:'',name:'가상3가',date:'2026-10-14',type:'해당없음'});
 },b=>assert.deepEqual(rowOf(b,'가상3가','2026-10-14'),[]));
 invalidates(env,'portalSetStatus',()=>{
  gas.call('portalSetStatus',3,'','가상3나','중도탈락','2026-10-12');
 },b=>assert.deepEqual(b.roster.find(r=>r[1]==='가상3나'),['3','가상3나','중도탈락','2026-10-12']));
 gas.call('rebuildAll');
 invalidates(env,'a board cell (onEdit → upsert_)',()=>{
  boards[1].put(17,5,'결석');gas.call('onEdit',{range:boards[1].getRange(17,5)});
 },b=>assert.equal(rowOf(b,'가상1가','2026-10-14')[0][3],'결석'));
 assert.deepEqual(gas.log.outsideLock.filter(x=>/출결원장/.test(x)),[]);
 invalidates(env,'direct edit of 출결원장',()=>{
  ledger.put(2,4,'조퇴');gas.call('onEdit',{range:ledger.getRange('D2')});
 },b=>assert.equal(rowOf(b,'가상1가','2026-10-07')[0][3],'조퇴'));
 invalidates(env,'direct edit of 명부',()=>{
  roster.put(3,4,'조기취업');roster.put(3,5,d('2026-10-13'));gas.call('onEdit',{range:roster.getRange('D3:E3')});
 },b=>assert.deepEqual(b.roster.find(r=>r[1]==='가상1나'),['1','가상1나','조기취업','2026-10-13']));
 invalidates(env,'direct edit of 교육일자',()=>{
  days.put(8,1,d('2026-10-16'));gas.call('onEdit',{range:days.getRange('A8')});
 },b=>assert.ok(b.days.includes('2026-10-16')));
 invalidates(env,'direct edit of 반정보',()=>{
  info.put(4,11,'새담임1');gas.call('onEdit',{range:info.getRange('K4')});
 },b=>assert.equal(b.classes.find(c=>c.id==='1').teacher,'새담임1'));
 // 교육일자는 시간표에서 올 수 있으므로(onEdit도 같이 다룸) 시간표 편집도 올립니다.
 const tt=env.m.getSheetByName('시간표');
 invalidates(env,'direct edit of 시간표',()=>{tt.put(2,3,'과목');gas.call('onEdit',{range:tt.getRange('C2')});},b=>assert.deepEqual(b.days,[...DAYS,'2026-10-16']));
 primed(env);const before=rev(env);
 boards[1].put(5,1,'메모');gas.call('onEdit',{range:boards[1].getRange('A5')});
 assert.equal(rev(env),before,'an edit above the student rows of a board is not /beta2 data');bundle(env,'all');assert.equal(sheetReads(env).length,0);
});

test('Code.gs still works without beta2.gs and leaves B2_REV alone',()=>{
 const env=setup({files:[CODE]}),{gas}=env,logged=[];
 gas.ctx.console={log:(...a)=>logged.push(a.map(String).join(' '))}; // onEdit·bumpBeta2_가 삼킨 오류도 여기 남습니다.
 assert.equal(gas.run('typeof b2Bump_'),'undefined');
 assert.equal(gas.call('portalSave',{cls:3,pin:'',name:'가상3가',date:'2026-10-13',type:'지각',inT:'09:15'}).ok,true);
 gas.call('portalSave',{cls:3,pin:'',name:'가상3가',date:'2026-10-13',type:'해당없음'});
 gas.call('portalSetStatus',3,'','가상3나','중도탈락','2026-10-12');
 env.ledger.put(2,4,'조퇴');gas.call('onEdit',{range:env.ledger.getRange('D2')});
 assert.equal(rev(env),5);assert.deepEqual(logged,[],'no swallowed errors');
});

test('a Drive time change alone invalidates the cache, and the old version is removed when the new one is stored',()=>{
 const env=setup(),{gas,m,ledger}=env;primed(env);
 const oldStamp=head(env).stamp;
 ledger.put(9,9,'다른 사유');gas.advance(60000);m.touch(); // 다른 스크립트·API가 고친 경우(onEdit 없음): 수정 시각만 바뀜
 const b=bundle(env,'3');
 assert.ok(sheetReads(env).length>0);assert.equal(b.rev,5);assert.equal(rowOf(b,'가상3가','2026-10-14')[0][8],'다른 사유');
 assert.equal(head(env).stamp,stampOf(env,5));
 assert.deepEqual([...gas.cacheStore.keys()].filter(k=>k.startsWith('b2b:'+oldStamp+':')),[],'chunks of the old stamp are removed');
 bundle(env,'all');assert.equal(sheetReads(env).length,0);
});

test('an edit that lands while a miss is reading the sheet is picked up by the next call',()=>{
 const env=setup(),{gas,ledger}=env;
 gas.hooks.push({when:e=>e.op==='read'&&e.range.sh.name==='출결원장'&&e.range.nc===20,run:()=>{ledger.put(2,4,'결석');gas.call('b2Bump_');},once:true});
 const first=bundle(env,'1');
 assert.equal(first.rev,5,'rev is taken before the sheet is read');assert.equal(rowOf(first,'가상1가','2026-10-07')[0][3],'지각');
 const next=bundle(env,'1');
 assert.ok(sheetReads(env).length>0,'the stored version is for rev 5, so rev 6 reads again');
 assert.equal(next.rev,6);assert.equal(rowOf(next,'가상1가','2026-10-07')[0][3],'결석');
});

test('a bundle bigger than one cache value is split into pieces under 100 KB and comes back the same',()=>{
 const reason='가나다라마바사아자차카타파하 병원 진료 후 등원 확인서 제출 예정😀'.repeat(3);
 const extra=Array.from({length:1500},(_,i)=>L(DAYS[i%5],9,'가상9학생'+i,'지각',{inT:'09:'+String(10+i%50),reason,memo:'지각_담임9:가상9학생'+i,prov:'1기 동기화'}));
 const env=setup({extra}),{gas,old}=env,want=JSON.stringify(old('9')),wantAll=JSON.stringify(old('all'));
 bundle(env,'9');
 const h=head(env);assert.ok(h.parts.c9>=5,'class 9 is split: '+h.parts.c9);assert.equal(h.parts.c3,1);
 for(const [k,e] of gas.cacheStore)assert.ok(Buffer.byteLength(e.v,'utf8')<=100*1024,k);
 gas.resetLog();assert.equal(JSON.stringify(gas.call('b2Bundle','9')),want);assert.equal(sheetReads(env).length,0);
 gas.resetLog();assert.equal(JSON.stringify(gas.call('b2Bundle','all')),wantAll);assert.equal(sheetReads(env).length,0);
 assert.ok(gas.log.cache.filter(x=>x.op==='getAll')[0].n>h.parts.c9);
 // 두 글자로 된 문자(이모지)는 조각 경계에서 갈라지지 않습니다.
 assert.deepEqual(plain(gas.call('b2Chunks_','ab😀cd',3)),['ab','😀c','d']);
 assert.deepEqual(plain(gas.call('b2Chunks_','abcdef',3)),['abc','def']);
 // 너무 크면(조각 수 상한) 넣지 않고 매번 시트를 읽습니다.
 const big=setup({extra});big.gas.run('B2_CACHE.maxChunks = 3');
 assert.equal(JSON.stringify(big.gas.call('b2Bundle','9')),want);assert.equal(head(big),null);
 bundle(big,'9');assert.ok(sheetReads(big).length>0);
});

test('cache problems fall back to reading the sheet',()=>{
 // CacheService 없음
 let env=setup({cache:false});
 for(const c of ['3','all']){bundle(env,'3');const b=bundle(env,c);assert.ok(sheetReads(env).length>0);assert.deepEqual(b,plain(env.old(c)));}
 // 읽기 오류 한 번 → 잠금을 잡은 뒤 다시 본 캐시를 씀. 두 번이면 시트를 읽고 다시 채움
 env=setup();let {gas}=env;primed(env);
 gas.failures.push({op:'cacheRead',times:1,message:'Service error: Cache'});
 let b=bundle(env,'2');assert.equal(sheetReads(env).length,0);assert.deepEqual(b,plain(env.old('2')));
 gas.failures.push({op:'cacheRead',times:2,message:'Service error: Cache'});
 b=bundle(env,'2');assert.ok(sheetReads(env).length>0);assert.deepEqual(b,plain(env.old('2')));
 bundle(env,'2');assert.equal(sheetReads(env).length,0,'filled again');
 // 쓰기 오류 → 응답은 그대로, 넣던 조각은 지우고 다음 호출이 다시 읽음
 env=setup();gas=env.gas;
 gas.failures.push({op:'cacheWrite',times:1,message:'Service error: Cache'});
 b=bundle(env,'5');assert.deepEqual(b,plain(env.old('5')));assert.equal(head(env),null);assert.equal(gas.cacheStore.size,0);
 // 조각은 들어갔는데 머리 쓰기가 실패 → 들어간 조각도 지움
 gas.failures.push({op:'cacheWrite',skip:1,times:1,message:'Service error: Cache'});
 b=bundle(env,'5');assert.deepEqual(b,plain(env.old('5')));assert.ok(gas.log.cache.some(x=>x.op==='putAll'));
 assert.equal(head(env),null);assert.equal(gas.cacheStore.size,0,'pieces of a half-written version are removed');
 bundle(env,'5');assert.ok(sheetReads(env).length>0);bundle(env,'5');assert.equal(sheetReads(env).length,0);
 // 조각 하나가 먼저 지워짐(캐시 공간 부족) → 다시 읽음
 const h=head(env),lost=`b2b:${h.stamp}:c5:0`;assert.ok(gas.cacheStore.delete(lost));
 b=bundle(env,'5');assert.ok(sheetReads(env).length>0);assert.deepEqual(b,plain(env.old('5')));
 bundle(env,'5');assert.equal(sheetReads(env).length,0);
 // 머리가 깨짐 → 다시 읽음
 gas.cacheStore.set('b2b:head',{v:'{broken',exp:gas.clock.t+60000});
 bundle(env,'all');assert.ok(sheetReads(env).length>0);bundle(env,'all');assert.equal(sheetReads(env).length,0);
 // Drive 수정 시각을 못 읽음 → 캐시를 쓰지도 읽지도 않음
 env=setup();gas=env.gas;gas.ctx.DriveApp={getFileById(){throw new Error('Drive unavailable');}};
 for(let i=0;i<2;i++){b=bundle(env,'1');assert.ok(sheetReads(env).length>0);assert.deepEqual(gas.log.cache,[]);assert.deepEqual(b,plain(env.old('1')));}
});

test('concurrent misses: a caller that waited for the fill lock uses what the holder stored; without the lock it reads the sheet and stores nothing',()=>{
 const env=setup(),{gas}=env,LS=gas.ctx.LockService,real=LS.getScriptLock;
 // 잠금을 기다리는 동안 다른 실행이 시트를 읽어 캐시를 채우고 잠금을 놓은 것처럼
 const other='(function () { var c = b2Cache_(); b2CacheWrite_(c, b2BundleStamp_(+b2Props_().getProperty("B2_REV") || 0), b2BundleParts_(), b2CacheHead_(c)); })()';
 LS.getScriptLock=()=>({tryLock(){gas.run(other);gas.resetLog();return true;},releaseLock(){}});
 let b=plain(gas.call('b2Bundle','3'));
 assert.equal(sheetReads(env).length,0,'the waiting call reads no sheet');assert.deepEqual(b,plain(env.old('3')));
 gas.cacheStore.clear();LS.getScriptLock=()=>({tryLock:()=>false,releaseLock(){}});
 b=bundle(env,'3');assert.ok(sheetReads(env).length>0);assert.deepEqual(b,plain(env.old('3')));assert.equal(head(env),null,'no cache write without the lock');
 LS.getScriptLock=real;bundle(env,'3');assert.equal(head(env).stamp,stampOf(env,5));
});

test('a cache stored by code with another format number is not used',()=>{
 const env=setup(),{gas}=env;primed(env);
 gas.run("B2_CACHE.v = '2'"); // 새 배포가 조각 모양을 바꾸고 형식 번호를 올림(rev·수정 시각은 그대로)
 const b=bundle(env,'all');assert.ok(sheetReads(env).length>0,'the old-format pieces are ignored');assert.deepEqual(b,plain(env.old('all')));
 assert.equal(head(env).stamp,stampOf(env,5));bundle(env,'all');assert.equal(sheetReads(env).length,0);
});

test('b2Rev, b2Status and a cached b2Bundle read the script properties in one call',()=>{
 const env=setup(),{gas}=env;primed(env);
 const P=gas.scriptProps,get=P.getProperty,all=P.getProperties;let one=0,many=0;
 P.getProperty=function(k){one++;return get.call(this,k);};P.getProperties=function(){many++;return all.call(this);};
 gas.scriptProps.setProperty('B2_SYNC_LAST',JSON.stringify({at:7}));
 const r=plain(gas.call('b2Rev'));assert.deepEqual([one,many],[0,1]);assert.deepEqual([r.rev,r.sync.last],[5,{at:7}]);
 one=many=0;const b=bundle(env,'3');assert.deepEqual([one,many],[0,1],'a cache hit');assert.equal(b.sync.last.at,7);
 one=many=0;gas.call('b2Status');assert.deepEqual([one,many],[1,1],'b2Status also reads B2_SOURCE_ID');
});
