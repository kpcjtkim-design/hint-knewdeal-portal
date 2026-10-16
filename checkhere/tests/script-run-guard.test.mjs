import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createGas} from './gas-fake.mjs';

// 마스터시트 Apps Script 프로젝트(Code.gs + beta2.gs)를 웹 앱 방문자가 어디까지 부를 수 있는지 시험합니다(2026-10-15). 학생은 모두 가상입니다.
// 배포 ①(Vercel 데이터 API)·②(담임 PIN 포털) 모두 doGet으로 Portal.html을 엽니다. 그 화면에서는 이름 끝이 '_'가 아닌
// 모든 최상위 함수를 누구나 google.script.run으로 부를 수 있습니다(웹 앱은 소유자로 실행, 방문자 이메일은 빈 칸이거나 다른 계정).
const CODE=fileURLToPath(new URL('../../apps-script/master/Code.gs',import.meta.url));
const GS=fileURLToPath(new URL('../../apps-script/beta2/beta2.gs',import.meta.url));
const SNIPPET=fileURLToPath(new URL('../../apps-script/teacher-beta-api.gs',import.meta.url));
const VERCEL=fileURLToPath(new URL('../../api/teacher-beta.js',import.meta.url));
const OWNER='owner@example.com',KEY='k'.repeat(64);
const DAYS=['2026-10-12','2026-10-13','2026-10-14'];
const LEDGER_HEAD=['일자','반','이름','유형','입실','퇴실','외출시작','외출종료','사유','증빙','반려사유','메모','코드','','증빙반영','','확인','출처','동기화 지문','동기화 확인'];
const plain=x=>JSON.parse(JSON.stringify(x));

// 이름 끝이 '_'가 아닌 최상위 함수 전부와 누가 부르는지. 함수를 더하면 여기에 넣고, 웹 앱 방문자가 불러도 되는지 정합니다.
const OPEN={
 // Portal.html(run('portal…')) · 웹 앱 입구. portal* 읽기·저장은 반정보 P열 PIN을 확인합니다(checkPin_). portalClasses는 반 이름과 PIN 유무만.
 portal:['doGet','portalClasses','portalData','portalSave','portalCheck','portalClose','portalAddRow','portalUpdateVoc','portalSaveOfficer','portalSetStatus'],
 // Sidebar.html이 0.7초마다 부르는 읽기. 웹 앱에서는 고른 칸이 없어 안내 문구와 역할(담임)만 돌려줍니다.
 sidebarRead:['getSelectionKey','getContext'],
 // 메뉴·단순 트리거. 웹 앱에는 화면(getUi)이 없어 아무 일도 못 하고, onEdit은 e.range(함수)가 있어야 해 JSON 인자로는 못 부릅니다.
 menu:['onOpen','openPanel','openPortal','goHome','goLedger','onEdit'],
 api:['doPost'] // API 키 확인
};
const GUARDED={
 editor:['saveRecord','rebuildAll','setApiKey','b2SlimCheck','b2SlimSheet','b2RestoreFormulas','b2Setup','b2ImportAll','b2InstallTrigger','b2RemoveTrigger'],
 trigger:['b2SyncTick']
};

function setup(){
 const gas=createGas({now:'2026-10-14T10:00:00+09:00',files:[CODE,GS]}),d=iso=>gas.date(...iso.split('-').map(Number));
 const m=gas.book('master-test','마스터',true);
 m.add('홈',50,10);
 m.add('교육일자',200,6).fill(1,1,[['교육일']]).fill(2,1,DAYS.map(x=>[d(x)])).fill(5,4,[[d('2026-10-14')]]);
 m.add('명부',800,8).fill(1,1,[['반','이름','번호','상태','상태 변경일','','생년월일','성별']]).fill(2,1,[
  [1,'가상1가','','재학','','',d('2000-01-01'),'남성'],[1,'가상1나','','재학','','',d('2001-02-03'),'여성'],[2,'가상2가','','재학','','',d('1999-12-31'),'여성']]);
 const ledger=m.add('출결원장',300,20).fill(1,1,[LEDGER_HEAD]).fill(2,1,[[d('2026-10-13'),1,'가상1나','지각','09:20','','','','교통']]);
 m.add('변경이력',200,8).fill(1,1,[['시각','변경자','경로','반','이름','교육일','이전','이후']]);
 // 반정보 G:P, P열이 담임 포털 PIN(1반만 있음)
 m.add('반정보',30,20).fill(4,7,[['1반','지역1','과정1','HRD1','담임1','','장소1','주소1','3001','4321'],['2반','지역2','과정2','HRD2','담임2','','장소2','주소2','3002','']]);
 m.add('시간표',1500,8);
 const boards={};for(const c of [1,2])boards[c]=m.add(String(3000+c),80,64).fill(3,4,[[c]]).fill(16,1,[['이름']]);
 for(const [k,v] of [['B2_REV','5'],['B2_SOURCE_ID','none'],['API_KEY',KEY]])gas.scriptProps.setProperty(k,v);
 as(gas,OWNER);
 return {gas,m,ledger,boards};
}
// who: 부른 사람(Session.getActiveUser). 실행 계정(getEffectiveUser)은 늘 소유자입니다. 편집기·메뉴·패널은 who = 소유자, 웹 앱 방문자는 '' 또는 다른 계정.
function as(gas,who){gas.ctx.Session={getActiveUser:()=>({getEmail:()=>who}),getEffectiveUser:()=>({getEmail:()=>OWNER})};}
// google.script.run 흉내: Apps Script처럼 이름 끝이 '_'인 함수와 함수가 아닌 전역은 부를 수 없고, 인자는 JSON으로만 건너갑니다.
function scriptRun(gas,name,...args){
 if(name.endsWith('_')||typeof gas.ctx[name]!=='function')throw new Error('Script function not found: '+name);
 return gas.ctx[name](...plain(args));
}
const post=(gas,body)=>JSON.parse(gas.call('doPost',{postData:{contents:JSON.stringify(body)}}).getContent());
const usageRuns=gas=>(JSON.parse(gas.scriptProps.getProperty('B2_RUN_USAGE')||'null')||{runs:0}).runs;

test('every top-level function a web-app page can call is on the list: portal, sidebar reads, menus and doPost stay open, the rest is guarded',()=>{
 const names=[CODE,GS].flatMap(f=>[...readFileSync(f,'utf8').matchAll(/^function ([A-Za-z0-9$]+)\s*\(/gm)].map(m=>m[1])).filter(n=>!n.endsWith('_'));
 assert.deepEqual(names.sort(),[...Object.values(OPEN),...Object.values(GUARDED)].flat().sort());
});

test('the data-API functions (portalRoster, b2Bundle, b2Save, b2Docs …) are not reachable through google.script.run any more',()=>{
 const {gas}=setup();as(gas,'');
 const moved=['portalRoster',...Object.keys(gas.run('B2_ACTIONS'))];
 assert.deepEqual(moved.sort(),['b2Bundle','b2DocCreate','b2DocUpdate','b2Docs','b2Release','b2Rev','b2Save','b2Status','b2SyncNow','portalRoster']);
 for(const n of moved){
  assert.throws(()=>scriptRun(gas,n,'1'),/Script function not found/,n);
  assert.equal(typeof gas.ctx[n+'_'],'function',n+'_');
 }
 assert.deepEqual(Object.values(gas.run('B2_ACTIONS')).map(f=>f.name).filter(x=>!x.endsWith('_')),[],'B2_ACTIONS points only at private functions');
 assert.deepEqual(gas.log.reads,[],'nothing was read for the visitor');
});

test('a web-app visitor (blank or another e-mail) is refused by every guarded function and nothing changes',()=>{
 const {gas,ledger}=setup();
 const args={saveRecord:[{cls:1,name:'가상1가',date:'2026-10-14',type:'결석'}],b2SyncTick:[{triggerUid:'7'+'0'.repeat(17)+'1'}]};
 for(const who of ['','visitor@example.com']){
  as(gas,who);gas.resetLog();
  for(const n of [...GUARDED.editor,...GUARDED.trigger])assert.throws(()=>scriptRun(gas,n,...(args[n]||[])),/편집기/,`${n} as '${who}'`);
  assert.deepEqual(gas.log.writes,[],'no sheet writes');
  assert.equal(ledger.getLastRow(),2,'saveRecord wrote nothing (no PIN path into any class)');
  assert.equal(gas.scriptProps.getProperty('API_KEY'),KEY,'setApiKey did not replace the key Vercel uses');
  assert.deepEqual([gas.triggers.length,gas.scriptProps.getProperty('B2_RUN_USAGE'),gas.scriptProps.getProperty('B2_SYNC_RUNNING')],[0,null,null],'no trigger, no sync run');
 }
});

test('the same functions still work from the editor, the sheet menu and the sidebar (caller = owner)',()=>{
 const {gas,ledger,boards}=setup();
 assert.deepEqual(plain(scriptRun(gas,'saveRecord',{cls:1,name:'가상1가',date:'2026-10-14',type:'결석',r:'개인'})),{ok:true,warn:''});
 assert.deepEqual(ledger.rows(3,2,1,4)[0],[1,'가상1가','결석','']);
 gas.resetLog();gas.call('rebuildAll');
 assert.deepEqual([...new Set(gas.log.writes.map(w=>w.sheet).filter(s=>/^30\d\d$/.test(s)))].sort(),['3001','3002']);
 assert.deepEqual(boards[1].rows(17,5,2,3),[['결석','출석','출석'],['출석','지각','출석']],'10/14 · 10/13 · 10/12 for 가상1가 and 가상1나');
 gas.call('setApiKey');
 const key=gas.scriptProps.getProperty('API_KEY');assert.notEqual(key,KEY);assert.equal(key.length,64);
});

test('onEdit (a simple trigger, where the e-mail can be blank) still redraws every board after a teaching-day edit',()=>{
 const {gas,m}=setup();as(gas,'');gas.resetLog();
 gas.call('onEdit',{range:m.getSheetByName('교육일자').getRange('A3')});
 assert.deepEqual([...new Set(gas.log.writes.map(w=>w.sheet).filter(s=>/^30\d\d$/.test(s)))].sort(),['3001','3002']);
});

test('b2SyncTick runs from its own time trigger and from the editor, but not for a visitor, even with a made-up triggerUid',()=>{
 const {gas}=setup();
 gas.call('b2InstallTrigger');const [t]=gas.triggers;assert.equal(t.getHandlerFunction(),'b2SyncTick');
 as(gas,''); // 트리거 실행에서 이메일을 모르는 경우에도 트리거 번호로 확인합니다
 gas.call('b2SyncTick',{triggerUid:t.getUniqueId(),minute:10});assert.equal(usageRuns(gas),1,'time trigger');
 for(const e of [undefined,{},{triggerUid:''},{triggerUid:'7'+'9'.repeat(18)}])
  assert.throws(()=>scriptRun(gas,'b2SyncTick',...(e===undefined?[]:[e])),/편집기에서 직접 실행할 때만/,JSON.stringify(e));
 assert.equal(usageRuns(gas),1,'refused calls neither ran nor counted');assert.equal(gas.scriptProps.getProperty('B2_SYNC_RUNNING'),null);
 as(gas,OWNER);gas.call('b2SyncTick');assert.equal(usageRuns(gas),2,'editor run');
 // 시간 밖에는 확인 전에 그냥 끝납니다(아무것도 하지 않음)
 gas.at('2026-10-14T20:00:00+09:00');as(gas,'');gas.resetLog();scriptRun(gas,'b2SyncTick');
 assert.equal(usageRuns(gas),2);assert.deepEqual(gas.log.writes,[]);
});

test('doPost needs the API key; with it every action Vercel sends still resolves, and portalRoster returns birth date and gender',()=>{
 const {gas,ledger}=setup();as(gas,''); // Vercel 호출: 방문자 이메일 없음
 assert.deepEqual(post(gas,{action:'portalRoster',args:[1]}),{ok:false,error:'unauthorized'});
 assert.deepEqual(post(gas,{key:'wrong',action:'portalRoster',args:[1]}),{ok:false,error:'unauthorized'});
 gas.scriptProps.deleteProperty('API_KEY');assert.deepEqual(post(gas,{key:'',action:'b2Rev'}),{ok:false,error:'unauthorized'},'no key set → nobody');
 gas.scriptProps.setProperty('API_KEY',KEY);
 const src=readFileSync(VERCEL,'utf8'),set=name=>[...src.match(new RegExp(`const ${name}=new Set\\(\\[([^\\]]*)\\]`))[1].matchAll(/'([A-Za-z0-9]+)'/g)].map(x=>x[1]);
 const actions=[...new Set([...set('ALLOWED'),...set('B2_ACTIONS')])];
 assert.equal(actions.length,18);
 for(const action of actions)assert.notEqual(post(gas,{key:KEY,action,args:[]}).error,'unknown action',action);
 for(const action of ['portalRoster_','b2Save_','saveRecord','setApiKey','rebuildAll','b2SyncTick','b2Setup'])assert.deepEqual(post(gas,{key:KEY,action}),{ok:false,error:'unknown action'},action);
 assert.deepEqual(post(gas,{key:KEY,action:'portalRoster',args:[1]}),{ok:true,data:[{name:'가상1가',status:'재학',birth:'2000-01-01',gender:'남성'},{name:'가상1나',status:'재학',birth:'2001-02-03',gender:'여성'}]});
 const saved=post(gas,{key:KEY,action:'b2Save',args:[{cls:'2',name:'가상2가',date:'2026-10-14',type:'결석',before:''}],actor:'admin@example.com',role:'ADMIN'});
 assert.equal(saved.ok,true,saved.error);assert.deepEqual(ledger.rows(3,2,1,3)[0],[2,'가상2가','결석']);
 assert.deepEqual(plain(gas.run('[__API, __ACTOR, __ACTOR_ROLE]')),[false,'',''],'doPost resets its flags');
});

test('the teacher PIN portal still works through google.script.run: class list without PINs, data and saves only with the right PIN',()=>{
 const {gas,ledger}=setup();as(gas,'');
 assert.deepEqual(plain(scriptRun(gas,'portalClasses')),[{no:1,label:'1반 · 지역1 과정1',pin:true},{no:2,label:'2반 · 지역2 과정2',pin:false}]);
 for(const pin of ['0000',''])assert.throws(()=>scriptRun(gas,'portalData',1,pin),/PIN이 맞지 않습니다/);
 assert.deepEqual(plain(scriptRun(gas,'portalData',1,'4321')).kids.map(k=>k.name),['가상1가','가상1나']);
 post(gas,{key:KEY,action:'portalData',args:[1,'']}); // doPost의 PIN 건너뛰기(__API)는 그 실행 안에서만
 assert.throws(()=>scriptRun(gas,'portalData',1,''),/PIN이 맞지 않습니다/);
 assert.throws(()=>scriptRun(gas,'portalSave',{cls:1,pin:'',name:'가상1가',date:'2026-10-14',type:'결석'}),/PIN이 맞지 않습니다/);
 assert.equal(ledger.getLastRow(),2);
 assert.deepEqual(plain(scriptRun(gas,'portalSave',{cls:1,pin:'4321',name:'가상1가',date:'2026-10-14',type:'지각',inT:'09:30'})),{ok:true,warn:''});
 assert.deepEqual(ledger.rows(3,2,1,3)[0],[1,'가상1가','지각']);
});

test('apps-script/teacher-beta-api.gs (the paste-in copy of the data API) matches the end of Code.gs',()=>{
 const tail=f=>readFileSync(f,'utf8').replace(/\r\n/g,'\n').split('\nvar __API = false;\n')[1];
 assert.ok(tail(SNIPPET));assert.equal(tail(SNIPPET),tail(CODE));
});
