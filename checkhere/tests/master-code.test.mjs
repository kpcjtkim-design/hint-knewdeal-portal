import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGas} from './gas-fake.mjs';

// 마스터시트 Code.gs(출결판·패널·담임 포털)를 가짜 Google 서비스로 돌립니다. 학생은 가상입니다.
const CODE=fileURLToPath(new URL('../../apps-script/master/Code.gs',import.meta.url));
const DAYS=['2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15'];

function setup(){
 const gas=createGas({now:'2026-10-14T10:00:00+09:00',files:[CODE]}),d=iso=>gas.date(...iso.split('-').map(Number));
 const m=gas.book('master-test','마스터',true);
 m.add('홈',50,10);
 const days=m.add('교육일자',120,6).fill(1,1,[['교육일']]).fill(2,1,DAYS.map(x=>[d(x)])).fill(5,4,[[d('2026-10-14')]]);
 const roster=m.add('명부',800,8).fill(1,1,[['반','이름','번호','상태','상태 변경일']]);
 const people=[];for(const c of [1,2,3,5])for(const n of ['가','나'])people.push([c,`가상${c}${n}`,'','재학','']);
 people.push([5,'가상5다','','중도탈락',d('2026-10-08')]);
 roster.fill(2,1,people);
 const ledger=m.add('출결원장',300,20).fill(1,1,[['일자','반','이름','유형']]).fill(2,1,[
  [d('2026-10-08'),1,'가상1가','지각','09:20','','','','교통','',''],
  [d('2026-10-12'),3,'가상3나','결석','','','','','','',''],
  [d('2026-10-13'),5,'가상5가','조퇴','','16:00','','','병원','','']]);
 m.add('변경이력',200,8).fill(1,1,[['시각','변경자','경로','반','이름','교육일','이전','이후']]);
 m.add('반정보',30,20).fill(4,7,[1,2,3,5].map(c=>[c+'반','지역','과정','','담임'+c]));
 m.add('시간표',100,8);
 const boards={};for(const c of [1,2,3,5])boards[c]=m.add(String(3000+c),80,63).fill(3,4,[[c]]).fill(16,1,[['이름']]);
 m.add('메모',10,3); // 작은 탭(출결판 아님)
 return {gas,m,ledger,roster,days,boards,d};
}
const view=(gas,sh)=>({head:sh.rows(16,5,1,6)[0].map(x=>x?gas.formatDate(x,'Asia/Seoul','MM/dd'):''),names:sh.rows(17,1,4,1).flat(),cells:sh.rows(17,5,3,6)});
const boardWrites=(gas,sheet)=>gas.log.writes.filter(w=>/^30\d\d$/.test(w.sheet)&&(!sheet||w.sheet===sheet));

test('opening the sheet only builds the menu and redraws nothing',()=>{
 const {gas}=setup();gas.resetLog();gas.call('onOpen');
 assert.deepEqual(gas.log.writes,[]);assert.equal(gas.log.reads.length,0);
});

test('출결판 새로고침 draws every board from the ledger, reading everything before the first write',()=>{
 const {gas,boards}=setup();gas.resetLog();gas.call('rebuildAll');
 assert.deepEqual(view(gas,boards[1]),{head:['10/14','10/13','10/12','10/08','10/07',''],names:['가상1가','가상1나','',''],cells:[['출석','출석','출석','지각','출석',''],['출석','출석','출석','출석','출석',''],['','','','','','']]});
 assert.deepEqual(view(gas,boards[5]).cells,[['출석','조퇴','출석','출석','출석',''],['출석','출석','출석','출석','출석',''],['','','','출석','출석','']],'a student who left on 10/08 is blank afterwards');
 const firstWrite=Math.min(...gas.log.writes.map(w=>w.seq)),lastRead=Math.max(...gas.log.reads.map(r=>r.seq));
 assert.ok(lastRead<firstWrite,`reads ${lastRead} must all come before writes ${firstWrite}`);
 assert.equal(gas.log.writes.filter(w=>w.kind==='rules').length,4,'colour rules are added once per board');
 gas.resetLog();gas.call('rebuildAll');
 assert.equal(gas.log.writes.filter(w=>w.kind==='rules').length,0,'and not again');
});

test('editing the ledger or roster redraws only the classes in the edited rows',()=>{
 const {gas,ledger,roster,boards,d}=setup();gas.call('rebuildAll');
 ledger.put(3,4,'지각');gas.resetLog();gas.call('onEdit',{range:ledger.getRange('D3')});
 assert.deepEqual([...new Set(boardWrites(gas).map(w=>w.sheet))],['3003']);
 assert.equal(boards[3].get(18,7),'지각');assert.ok(gas.docProps.getProperty('rev'));
 ledger.put(3,2,1);gas.resetLog();gas.call('onEdit',{range:ledger.getRange('A3:K3')});
 assert.deepEqual([...new Set(boardWrites(gas).map(w=>w.sheet))].sort(),['3001','3002','3003','3005'],'class column edited → old class unknown → all boards');
 roster.put(2,4,'중도탈락');roster.put(2,5,d('2026-10-12'));gas.resetLog();gas.call('onEdit',{range:roster.getRange('D2:E2')});
 assert.deepEqual([...new Set(boardWrites(gas).map(w=>w.sheet))],['3001']);
 assert.deepEqual(boards[1].rows(17,5,1,5)[0],['','','출석','지각','출석']);
 gas.resetLog();gas.call('onEdit',{range:gas.run("SpreadsheetApp.getActive().getSheetByName('교육일자')").getRange('A3')});
 assert.equal(new Set(boardWrites(gas).map(w=>w.sheet)).size,4,'teaching days still redraw everything');
});

test('choosing 출석 on a board deletes the ledger row inside the document lock; another type is written inside it too',()=>{
 const {gas,ledger,boards}=setup();gas.call('rebuildAll');
 boards[3].put(18,7,'출석');gas.resetLog();gas.call('onEdit',{range:boards[3].getRange(18,7)});
 assert.equal(gas.log.writes.filter(w=>w.kind==='deleteRow').length,1);
 assert.deepEqual(gas.log.outsideLock.filter(x=>/출결원장|변경이력/.test(x)),[],'deleteRow and its log line run inside the lock');
 assert.equal(ledger.getLastRow(),3);assert.deepEqual(ledger.rows(3,3,1,2)[0],['가상5가','조퇴']);
 gas.lock.other=true;boards[3].put(18,5,'지각');gas.resetLog();gas.call('onEdit',{range:boards[3].getRange(18,5)});
 assert.equal(ledger.getLastRow(),3,'while another run holds the lock nothing is written (onEdit logs the timeout)');
 gas.lock.other=false;gas.call('onEdit',{range:boards[3].getRange(18,5)});
 assert.deepEqual(ledger.rows(4,2,1,3)[0],[3,'가상3나','지각']);
 assert.deepEqual(gas.log.outsideLock.filter(x=>/출결원장/.test(x)),[]);
});
