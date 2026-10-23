import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

// 운영 리허설 안전장치 화면(2026-10-21, 시트 v23): 그사이 바뀜(CONFLICT)이면 새로 읽어 새 값을 보이고 내 입력은 남겨 다시 저장하게 하는지,
// 화면마다 보내는 was·before·clientId, 시험 기준일 띠·b2Bundle asOf, 운영 리허설 화면을 가짜 API로 봅니다. 가상 학생·가상 계정만 씁니다.
const base=join(import.meta.dirname,'../..');
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const SDK_STUB=`window.sdkWrites=window.sdkWrites||[];const snap=d=>({exists:()=>d!==undefined,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=c=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...v)=>v;
export const getDoc=async ref=>snap(window.sdkDocs?.[ref.path]),getDocFromServer=async()=>snap(undefined),getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const USER="{email:'hint.kpc@gmail.com',getIdToken:async()=>'tok'}";
const head=`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="slot"></div><div id="root"></div>`;
const admin=(mod,extra='')=>`${head}<script type="module">import {mount} from '/${mod}';import {createBeta2Client} from '/beta2-data.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';import {setNotifyContext} from '/notify.mjs';ensureBeta2Css();
 const user=${USER};setNotifyContext({db:{},user});window.client=createBeta2Client(user,{db:{},admin:true});${extra}window.view=await mount(document.getElementById('root'),{db:{},user,classes:[{id:'1',course:'과정1'},{id:'2',course:'과정2'}],client:window.client,selected:'1',context:{classId:'1',date:'2026-11-05'}});</script>`;
const PAGES={
 '/teacher.html':`${head}<script type="module">import {mountTeacherBeta} from '/teacher-beta.js';window.tb=mountTeacherBeta(document.getElementById('root'),{cls:1,tab:'board',endpoint:'/api/teacher-beta'});</script>`,
 '/docs.html':admin('beta2-docs.mjs'),'/roster.html':admin('beta2-roster.mjs'),'/times.html':admin('beta2-times.mjs'),'/dropouts.html':admin('beta2-dropouts.mjs'),'/ledger.html':admin('beta2-ledger.mjs'),
 '/asof.html':`${head}<script type="module">import {mountAsOfControls,setTestAsOf} from '/beta2-asof.mjs';import {createBeta2Client} from '/beta2-data.mjs';
  const user=${USER};window.adminClient=createBeta2Client(user,{admin:true});window.teacherClient=createBeta2Client({email:'teacher@test.kr',getIdToken:async()=>'t'});window.setAsOf=d=>setTestAsOf(user,d);
  window.changes=[];mountAsOfControls({slot:document.getElementById('slot'),user,onChange:d=>window.changes.push(d)});window.ready=true;</script>`,
 '/rehearsal.html':`${head}<script type="module">import {mount} from '/beta2-rehearsal.mjs';const user=${USER};
  const fake=({log})=>({teachers:async()=>{log('담임 시작');return {id:'teachers',pass:true,total:800,accepted:800,failed:0,pending:0,p50:120,p95:480,acceptMs:2900,appliedMs:51000,missing:0,duplicates:0,errors:[]};},
   admins:async()=>({id:'admins',pass:true,total:40,accepted:40,failed:0,pending:0,p50:300,p95:900,appliedMs:20000,memos:'2/2',docs:{ok:true,id:'D9',repeated:true},errors:[]}),
   conflicts:async()=>({id:'conflicts',pass:false,checks:[{id:'a',label:'운영자↔운영자 같은 줄 동시 저장',pass:true,results:['ok','conflict']},{id:'b',label:'운영자가 고친 뒤 담임이 옛 값으로 저장',pass:false,results:['ok','ok']},{id:'c',label:'서류 처리 둘이 같은 화면 값으로 저장',pass:true,results:['conflict','ok']}]}),
   cleanup:async o=>{window.cleanupArgs=o;return {id:'cleanup',pass:true,left:0,deleted:842,memoCleared:2,errors:[],docs:[{id:'D9',ok:true,note:'취소 표시'}]};}});
  window.view=await mount(document.getElementById('root'),{client:{},user,db:{},makeRehearsal:fake,confirmFn:t=>{(window.asked||(window.asked=[])).push(t);return true;}});</script>`
};
async function page(path,run,{api=()=>null,init=null}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage(),errors=[],posts=[],dialogs=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>{dialogs.push(d.message());void d.accept();});
 try{
  if(init)await p.addInitScript(init);
  await p.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(PAGES[url.pathname])return route.fulfill({contentType:'text/html;charset=utf-8',body:PAGES[url.pathname]});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    let out=await api(body,posts);if(out===null||out===undefined)out={ok:true,data:{ok:true}};
    return route.fulfill({status:out.ok?200:400,contentType:'application/json',body:JSON.stringify(out)});
   }
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await p.goto('https://fixture.test'+path);
  try{await run(p,posts,dialogs);}catch(e){e.message+=`\n페이지 오류: ${errors.join(' | ')}`;throw e;}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const of=(posts,a)=>posts.filter(b=>b.action===a);
async function until(p,fn,what,n=120){for(let i=0;i<n;i++){if(await fn())return;await p.waitForTimeout(100);}throw Error('기다림 끝: '+what);}
const ok=data=>({ok:true,data});
const CONFLICT_T='CONFLICT: 운영팀이 그사이 이 기록을 고쳤습니다. 최신 값을 다시 읽어 주세요.',CONFLICT_A='CONFLICT: 그사이 다른 사람이 바꿨습니다. 새로 읽어 주세요.';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,reason:'',ev:'',evr:'',evApplied:'해당없음',prov:'포털',sig:'',...o})[k]??'');
const bundleOf=(rows,roster=[['1','가상가','재학',''],['1','가상나','재학','']],today='2026-11-06')=>({rev:7,today,days:['2026-11-05','2026-11-06'],classes:[{id:'1',teacher:'가상담임'},{id:'2',teacher:'가상담임2'}],roster,ledgerCols:COLS,ledger:rows});
const portalOf=(recs,queue=true)=>({cls:1,region:'서울',course:'과정1',teacher:'가상담임',place:'본관',mainDay:'2026-11-05',days:['2026-11-05','2026-11-04'],week:[],summary:[{k:'총원',v:2}],
 kids:[{name:'가상가',status:'재학',off:''},{name:'가상나',status:'재학',off:''}],recs,closed:'미확인',officer:{},...(queue?{queue:true}:{})});
const rec=(type,r='')=>({type,inT:'',outT:'',oa:'',ob:'',r,ev:'',evr:''});

test('teacher board (queue): before = the row sig from the class bundle; a CONFLICT shows the new value on that cell, keeps my value; 내 값으로 다시 저장 re-sends with the new before; 버리기 keeps the office value',async()=>{
 let phase=1,n=0;const st=new Map();
 const PORTAL={1:portalOf({'가상가|2026-11-05':rec('출석')}),2:portalOf({'가상가|2026-11-05':rec('결석','운영 확인')}),3:portalOf({'가상가|2026-11-05':rec('지각'),'가상나|2026-11-05':rec('해당없음')})};
 const BUNDLE={1:bundleOf([L('2026-11-05','1','가상가','출석',{sig:'sig-A1'})]),2:bundleOf([L('2026-11-05','1','가상가','결석',{reason:'운영 확인',sig:'sig-A2'})]),3:bundleOf([L('2026-11-05','1','가상가','지각',{sig:'sig-A3'}),L('2026-11-05','1','가상나','해당없음',{sig:'sig-B1'})])};
 await page('/teacher.html',async(p,posts)=>{
  const R=s=>p.locator('#root').locator(s),cell=(name,d='2026-11-05')=>R(`select[data-n="${name}"][data-d="${d}"]`);
  await cell('가상가').waitFor();await until(p,()=>of(posts,'b2Bundle').length>=1,'sig bundle');
  assert.deepEqual(of(posts,'b2Bundle')[0].args,['1'],'own class bundle for row signatures');
  await cell('가상가').selectOption('지각');
  await until(p,()=>of(posts,'portalSaveBatch').length===1,'batch 1');
  assert.deepEqual(of(posts,'portalSaveBatch')[0].args[0].items.map(i=>[i.name,i.type,i.before]),[['가상가','지각','sig-A1']]);
  st.set('id-0',{status:'failed',error:CONFLICT_T});phase=2;
  await R('[data-q-conflict]').waitFor({timeout:12000});
  await until(p,async()=>/결석 · 운영 확인/.test(await R('[data-q-conflict]').innerText()),'new value shown');
  assert.match(await R('[data-q-conflict]').innerText(),/운영팀이 그사이 고쳤습니다 · 새 값: 결석 · 운영 확인[\s\S]*내 값\(저장 안 됨\): 지각/);
  assert.equal(await cell('가상가').inputValue(),'결석','the cell shows the office value');
  assert.equal(await cell('가상가').evaluate(e=>e.classList.contains('qfail')&&/새 값: 결석/.test(e.title)),true,'red border + the new value on the cell');
  assert.match(await R('#qb').innerText(),/운영팀이 그사이 고침 1/);
  await until(p,()=>of(posts,'b2Bundle').length>=2,'sigs read again');
  await R('#qretry').click();
  await until(p,()=>of(posts,'portalSaveBatch').length===2,'batch 2');
  assert.deepEqual(of(posts,'portalSaveBatch')[1].args[0].items.map(i=>[i.name,i.type,i.before]),[['가상가','지각','sig-A2']],'re-sent with the new before');
  assert.equal(await cell('가상가').inputValue(),'지각');
  st.set('id-1',{status:'done',action:'write',sig:'sig-A3'});phase=3;
  await until(p,async()=>!(await cell('가상가').evaluate(e=>e.classList.contains('qwait')||e.classList.contains('qfail'))),'done');
  // 기록이 없는 칸은 before ''(없던 행)
  await cell('가상나').selectOption('출석');
  await until(p,()=>of(posts,'portalSaveBatch').length===3,'batch 3');
  assert.deepEqual(of(posts,'portalSaveBatch')[2].args[0].items.map(i=>[i.name,i.before]),[['가상나','']]);
  st.set('id-2',{status:'failed',error:CONFLICT_T});
  await until(p,async()=>/새 값: 해당없음/.test(await R('#qs').innerText()),'second conflict',150);
  await R('#qdrop').click();
  assert.equal(await R('[data-q-conflict]').count(),0);
  assert.equal(await cell('가상나').inputValue(),'해당없음','discard keeps the office value');
  await p.waitForTimeout(1200);assert.equal(of(posts,'portalSaveBatch').length,3,'nothing re-sent after 버리기');
 },{api:b=>{
  if(b.action==='portalData')return ok(structuredClone(PORTAL[phase]));
  if(b.action==='b2Bundle')return ok(structuredClone(BUNDLE[phase]));
  if(b.action==='portalSaveBatch')return ok({ok:true,queued:true,ids:b.args[0].items.map(()=>'id-'+(n++))});
  if(b.action==='queueStatus')return ok({enabled:true,items:(b.args[0].ids||[]).map(id=>({id,status:'pending',...(st.get(id)||{})}))});
  if(b.action==='b2DayMemos')return ok({rows:[]});
  return null;}});
});

test('teacher board (direct save, no queue): portalSave sends before; {conflict:true} shows the new value; re-saving goes out with the fresh before',async()=>{
 let phase=1;
 await page('/teacher.html',async(p,posts)=>{
  const R=s=>p.locator('#root').locator(s),cell=n=>R(`select[data-n="${n}"][data-d="2026-11-05"]`);
  await cell('가상가').waitFor();await until(p,()=>of(posts,'b2Bundle').length>=1,'sigs');
  await cell('가상가').selectOption('결석');
  await until(p,()=>of(posts,'portalSave').length===1,'portalSave');
  assert.equal(of(posts,'portalSave')[0].args[0].before,'sig-A1');
  await until(p,async()=>/새 값: 지각/.test(await R('#qs').innerText()),'conflict box');
  await R('#qretry').click();
  await until(p,()=>of(posts,'portalSaveBatch').length===1,'re-save');
  assert.deepEqual(of(posts,'portalSaveBatch')[0].args[0].items.map(i=>[i.type,i.before]),[['결석','sig-A2']]);
  await until(p,async()=>/저장했습니다/.test(await R('#st').innerText()),'saved');
 },{api:b=>{
  if(b.action==='portalData')return ok(portalOf({'가상가|2026-11-05':phase===1?rec('출석'):rec('지각')},false));
  if(b.action==='b2Bundle')return ok(bundleOf([phase===1?L('2026-11-05','1','가상가','출석',{sig:'sig-A1'}):L('2026-11-05','1','가상가','지각',{sig:'sig-A2'})]));
  if(b.action==='portalSave'){phase=2;return ok({ok:false,conflict:true,msg:CONFLICT_T});}
  if(b.action==='portalSaveBatch')return ok({ok:true,queued:false,results:[{ok:true,msg:'',warn:''}]});
  if(b.action==='b2DayMemos')return ok({rows:[]});
  return null;}});
});

test('서류발급: 처리 저장 sends was; CONFLICT reads again, shows the new value and keeps my edit; 새 신청 carries one clientId per form (kept on retry) and repeated:true counts as done',async()=>{
 let doc={id:'D1',cls:'1',name:'가상가',docType:'교육참여확인서',status:'접수',memo:'',link:'',fixReason:'',requested:'2026-11-05'},updates=0,creates=0;
 await page('/docs.html',async(p,posts)=>{
  await p.locator('[data-doc="D1"]').click();
  await p.locator('[data-status="처리완료"]').click();await p.locator('[data-u="memo"]').fill('발급 완료');
  await p.locator('[data-update]').click();
  await p.locator('.b2-err',{hasText:'그사이 다른 사람이 바꿨습니다'}).waitFor();
  assert.deepEqual(of(posts,'b2DocUpdate')[0].args[0],{id:'D1',status:'처리완료',memo:'발급 완료',link:'',fixReason:'',was:{status:'접수',memo:'',link:'',fixReason:''}});
  assert.match(await p.locator('[data-doc="D1"] .b2-err').innerText(),/새 값: 상태 처리중 · 비고 다른 운영자 메모 .*내 입력은 남겨 두었습니다/);
  assert.equal(await p.locator('[data-status="처리완료"]').getAttribute('aria-pressed'),'true','my status stays picked');
  assert.equal(await p.locator('[data-u="memo"]').inputValue(),'발급 완료','my memo stays');
  await p.locator('[data-update]').click();
  await until(p,()=>of(posts,'b2DocUpdate').length===2,'second update');
  assert.deepEqual(of(posts,'b2DocUpdate')[1].args[0].was,{status:'처리중',memo:'다른 운영자 메모',link:'',fixReason:''},'re-save uses the new value as was');
  // 상태가 바뀐 저장은 그 반 담임 알림함(toClass)에 한 건(사용자 2026-10-23), 실패한 첫 저장은 알리지 않음
  await until(p,()=>p.evaluate(()=>window.sdkWrites.some(w=>w[1].startsWith('notifications/'))),'teacher notification');
  const sent=await p.evaluate(()=>window.sdkWrites.filter(w=>w[1].startsWith('notifications/')).map(w=>w[2]));
  assert.equal(sent.length,1);assert.equal(sent[0].kind,'서류발급');assert.equal(sent[0].toClass,'1');assert.equal(sent[0].toRole,undefined);
  assert.match(sent[0].title,/서류발급 처리완료 · 1반 가상가/);assert.match(sent[0].body,/비고 발급 완료/);
  // 새 신청: 몰림으로 실패 → 같은 clientId로 다시 → repeated
  await p.locator('#d2New').click();
  await p.locator('[data-g="name"]').selectOption('가상나');await p.locator('[data-doctype="교육참여확인서"]').click();await p.locator('[data-g="submitTo"]').fill('가상 제출처');
  await p.locator('[data-submit]').click();
  await p.locator('#d2Form .b2-err',{hasText:'몰려'}).waitFor();
  await p.locator('[data-submit]').click();
  await until(p,()=>of(posts,'b2DocCreate').length===2,'retry create');
  const [a,b]=of(posts,'b2DocCreate').map(x=>x.args[0].clientId);
  assert.match(a,/^[A-Za-z0-9_-]{8,80}$/);assert.equal(a,b,'same form → same clientId');
  await p.locator('#toast',{hasText:'이미 접수된 신청입니다 · D2'}).waitFor();
 },{api:b=>{
  if(b.action==='b2Docs')return ok({rev:1,rows:[structuredClone(doc)],statuses:['접수','처리중','보완 필요','처리완료','취소']});
  if(b.action==='b2Bundle')return ok(bundleOf([]));
  if(b.action==='b2DocUpdate'){updates++;if(updates===1){doc={...doc,status:'처리중',memo:'다른 운영자 메모',handler:'ops2@test.kr'};return {ok:false,error:CONFLICT_A};}doc={...doc,...b.args[0]};return ok({ok:true});}
  if(b.action==='b2DocCreate'){creates++;return creates===1?{ok:false,code:'SHEET_BUSY',error:'지금 저장이 몰려 잠시 뒤 다시 저장해 주세요'}:ok({ok:true,id:'D2',repeated:true});}
  if(b.action==='b2Rev')return ok({rev:1,sync:{}});
  return null;}});
});

test('교육생 상태: was {status, changed}; CONFLICT reads the roster again and keeps my edit; 명단 반영 전체 goes one class at a time with progress',async()=>{
 let roster=[['1','가상가','재학','',''],['1','가상나','재학','','']],saves=0;
 await page('/roster.html',async(p,posts,dialogs)=>{
  const row=p.locator('.b2r-row[data-key="1|가상가"]');await row.waitFor();
  await row.locator('[data-e="status"]').selectOption('중도탈락');
  await row.locator('[data-e="changed"]').fill('2026-11-12');await row.locator('[data-e="reason"]').fill('가상 사유');
  await row.locator('[data-save]').click();
  await p.locator('.b2r-row[data-key="1|가상가"] [data-err]',{hasText:'그사이 다른 사람이 바꿨습니다'}).waitFor();
  assert.deepEqual(of(posts,'b2RosterStatus')[0].args[0].was,{status:'재학',changed:''});
  assert.match(await p.locator('.b2r-row[data-key="1|가상가"] [data-err]').innerText(),/지금 값: 조기취업 \(마지막 출석 11\/10\(화\)\) · 내 입력은 남겨 두었습니다/);
  assert.equal(await p.locator('.b2r-row[data-key="1|가상가"] [data-e="status"]').inputValue(),'중도탈락');
  await p.locator('.b2r-row[data-key="1|가상가"] [data-save]').click();
  await until(p,()=>of(posts,'b2RosterStatus').length===2,'second save');
  assert.deepEqual(of(posts,'b2RosterStatus')[1].args[0].was,{status:'조기취업',changed:'2026-11-10'});
  // 명단 반영 · 전체: 반 하나씩
  await p.locator('#r2Class').selectOption('all');await p.locator('#r2Rebuild').click();
  assert.match(dialogs.at(-1),/반 하나씩 차례로/);
  await p.locator('[data-rebuilt]').waitFor({timeout:10000});
  assert.deepEqual(of(posts,'b2RebuildBoards').map(x=>x.args[0]),[{cls:'1'},{cls:'2'}]);
  assert.deepEqual(await p.locator('[data-rebuilt] li').allInnerTexts(),['1반 학생 2명, 출결판 40줄(+0줄 늘림)','2반 학생 0명, 출결판 40줄(+0줄 늘림)']);
 },{api:async b=>{
  if(b.action==='b2Bundle')return ok(bundleOf([],roster));
  if(b.action==='b2Rev')return ok({rev:7,sync:{}});
  if(b.action==='b2RosterStatus'){saves++;if(saves===1){roster=[['1','가상가','조기취업','2026-11-10','취업'],roster[1]];return {ok:false,error:CONFLICT_A};}return ok({ok:true,status:'중도탈락',changed:'2026-11-12',rev:9});}
  if(b.action==='b2RebuildBoards'){const c=b.args[0].cls;await new Promise(r=>setTimeout(r,150));return ok({boards:[{cls:c,students:c==='1'?2:0,rows:40,grown:0}],rev:10});}
  return null;}});
});

test('교육시간 조정: was carries the start·end seen; CONFLICT reads again, reopens my edit with the new times',async()=>{
 let rows=[{row:5,date:'2026-11-13',cls:'1',module:'공장견학',start:'10:00',end:'17:00',part:'',reason:'',by:'',at:''}],saves=0;
 await page('/times.html',async(p,posts)=>{
  await p.locator('.b2t-row[data-key="r5"]').waitFor();
  await p.locator('.b2t-row[data-key="r5"] [data-edit]').click();
  const ed=p.locator('[data-editor="r5"]');await ed.locator('[data-f="start"]').fill('10:30');await ed.locator('[data-f="reason"]').fill('업체 확정');
  await ed.locator('[data-save]').click();
  await p.locator('[data-editor="r5"] [data-err]',{hasText:'그사이 다른 사람이 시간을 바꿨습니다'}).waitFor();
  assert.deepEqual(of(posts,'b2ModuleTimeSave')[0].args[0].was,{date:'2026-11-13',cls:'1',module:'공장견학',start:'10:00',end:'17:00'});
  assert.match(await p.locator('[data-editor="r5"] [data-err]').innerText(),/새 값: 09:30~17:00/);
  assert.equal(await p.locator('[data-editor="r5"] [data-f="start"]').inputValue(),'10:30','my time stays');
  await p.locator('[data-editor="r5"] [data-save]').click();
  await until(p,()=>of(posts,'b2ModuleTimeSave').length===2,'second save');
  assert.deepEqual(of(posts,'b2ModuleTimeSave')[1].args[0].was,{date:'2026-11-13',cls:'1',module:'공장견학',start:'09:30',end:'17:00'});
 },{api:b=>{
  if(b.action==='b2ModuleTimes')return ok({rev:1,rows:structuredClone(rows),defaults:{start:'09:00',end:'18:00',graceMin:10},field:['10:00','17:00']});
  if(b.action==='b2ModuleTimeSave'){saves++;if(saves===1){rows=[{...rows[0],start:'09:30',by:'ops2@test.kr',at:'방금'}];return {ok:false,error:CONFLICT_A};}return ok({ok:true,row:5,rev:3});}
  if(b.action==='b2DayTimes')return ok({date:'2026-11-13',cls:'1',start:'10:30',end:'17:00',lateAfter:'10:40',earlyBefore:'16:50',source:'현장교육 일정'});
  return null;}});
});

test('중도탈락: 고치기 sends was.sig; CONFLICT reads again, keeps my edit and the next save uses the new sig',async()=>{
 const R=(o={})=>({row:4,cls:'1',name:'가상가',kind:'중도탈락',reason:'개인 사정',startDate:'',lastDate:'2026-11-05',verdict:'',basis:'',docs:{resign:'',offer:'',proof:''},contact:'',note:'',by:'hint.kpc@gmail.com',at:'2026-11-05 10:00',confirmed:false,confirmedBy:'',confirmedAt:'',sig:'s1',...o});
 let rows=[R()],saves=0;
 await page('/dropouts.html',async(p,posts)=>{
  await p.locator('tr[data-row="4"] [data-act="edit"]').click();
  await p.locator('[data-editor] [data-f="note"]').fill('담임 통화 완료');
  await p.locator('[data-editor] [data-act="save"]').click();
  await p.locator('[data-editor] [data-err]',{hasText:'그사이 다른 사람이 이 줄을 고쳤습니다'}).waitFor();
  assert.deepEqual(of(posts,'b2DropoutSave')[0].args[0].was,{cls:'1',name:'가상가',sig:'s1'});
  assert.match(await p.locator('[data-editor] [data-err]').innerText(),/새 값: 중도탈락 · 판정 제적 · 확인 전/);
  assert.equal(await p.locator('[data-editor] [data-f="note"]').inputValue(),'담임 통화 완료','my edit stays');
  await p.locator('[data-editor] [data-act="save"]').click();
  await until(p,()=>of(posts,'b2DropoutSave').length===2,'second save');
  assert.deepEqual(of(posts,'b2DropoutSave')[1].args[0].was,{cls:'1',name:'가상가',sig:'s2'});
 },{api:b=>{
  if(b.action==='b2Dropouts')return ok({rows:structuredClone(rows),maxAbsence:12});
  if(b.action==='b2Bundle')return ok(bundleOf([],[['1','가상가','중도탈락','2026-11-05',''],['1','가상나','재학','','']]));
  if(b.action==='b2Completions')return ok({rows:[]});
  if(b.action==='b2Rev')return ok({rev:7,sync:{}});
  if(b.action==='b2DropoutSave'){saves++;if(saves===1){rows=[R({verdict:'제적',sig:'s2'})];return {ok:false,error:CONFLICT_A};}return ok({ok:true,rev:9});}
  return null;}});
});

test('출결대조 메모: was = the memo on screen; CONFLICT reads the memos again, shows the new memo and keeps my text for 저장',async()=>{
 let memo='',saves=0;
 await page('/ledger.html',async(p,posts)=>{
  const body=p.locator('tbody[data-student="가상가"]');await body.locator('[data-memo-toggle]').waitFor();
  await body.locator('[data-memo-toggle]').click();
  await body.locator('[data-memo-pick="증빙 미제출"]').click();
  await body.locator('.b2-err',{hasText:'그사이 다른 사람이 메모를 바꿨습니다'}).waitFor();
  assert.deepEqual(of(posts,'b2LedgerMemo')[0].args[0],{cls:'1',name:'가상가',date:'2026-11-05',memo:'증빙 미제출',was:''});
  assert.match(await body.locator('.b2-err').innerText(),/새 메모: 증빙 확인 완료 · 내 글은 칸에 남겨 두었습니다/);
  assert.equal(await body.locator('[data-memo-input]').inputValue(),'증빙 미제출');
  await body.locator('[data-memo-save]').click();
  await until(p,()=>of(posts,'b2LedgerMemo').length===2,'second memo save');
  assert.equal(of(posts,'b2LedgerMemo')[1].args[0].was,'증빙 확인 완료');
 },{api:b=>{
  if(b.action==='b2Bundle')return ok(bundleOf([L('2026-11-05','1','가상가','출석',{sig:'sA'})]));
  if(b.action==='b2Rev')return ok({rev:7,sync:{}});
  if(b.action==='b2LedgerMemos')return ok({rows:memo?[{cls:'1',name:'가상가',date:'2026-11-05',memo,by:'ops2@test.kr'}]:[]});
  if(b.action==='b2LedgerMemo'){saves++;if(saves===1){memo='증빙 확인 완료';return {ok:false,error:CONFLICT_A};}memo=b.args[0].memo;return ok({ok:true,cls:'1',rev:8});}
  if(b.action==='b2DayMemos')return ok({rev:7,rows:[]});
  if(b.action==='b2DayTimes')return ok({date:'2026-11-05',cls:'1',start:'09:00',end:'18:00',lateAfter:'09:10',earlyBefore:'17:50',source:'기본'});
  return null;}});
});

test('시험 기준일: the admin control turns on a red sticky banner; admin bundles send {asOf} and get their own cache; the teacher client never sends it; 끄기 clears',async()=>{
 await page('/asof.html',async(p,posts)=>{
  await p.waitForFunction(()=>window.ready);
  assert.equal(await p.locator('#b2AsOfBanner').count(),0);
  await p.locator('[data-asof-input]').fill('2026-12-10');await p.locator('[data-asof-apply]').click();
  await p.locator('#b2AsOfBanner').waitFor();
  assert.equal(await p.locator('#b2AsOfBanner [data-asof-text]').innerText(),'시험 기준일 2026-12-10 적용 중 · 실제 오늘이 아닙니다');
  assert.equal(await p.locator('#b2AsOfBanner').evaluate(e=>getComputedStyle(e).position),'sticky');
  assert.deepEqual(await p.evaluate(()=>window.changes),['2026-12-10']);
  const today=await p.evaluate(async()=>(await window.adminClient.bundle('3')).today);
  assert.equal(today,'2026-12-10');
  assert.deepEqual(of(posts,'b2Bundle').at(-1).args,['3',{asOf:'2026-12-10'}]);
  await p.evaluate(()=>window.teacherClient.bundle('3',{fresh:true}));
  assert.deepEqual(of(posts,'b2Bundle').at(-1).args,['3'],'teacher client: no asOf');
  // 다른 이메일로 로그인하면 쓰지 않음
  assert.equal(await p.evaluate(async()=>(await import('/beta2-asof.mjs')).getTestAsOf({email:'other@test.kr'})),'');
  await p.locator('#b2AsOfBanner [data-asof-off]').click();
  assert.equal(await p.locator('#b2AsOfBanner').count(),0);
  await p.evaluate(()=>window.adminClient.bundle('3'));
  assert.deepEqual(of(posts,'b2Bundle').at(-1).args,['3'],'off: real today again (cache was dropped)');
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('hint.b2.testAsOf')),null);
  await assert.rejects(p.evaluate(()=>window.setAsOf('2026-13-40')),/2026-12-10처럼/);
 },{api:b=>{
  if(b.action==='b2Bundle'){const o=b.args[1];return ok({...bundleOf([]),today:o?.asOf||'2026-10-21',...(o?.asOf?{asOf:o.asOf}:{})});}
  if(b.action==='b2Rev')return ok({rev:7,sync:{}});
  return null;}});
});

test('운영 리허설 screen: asks first, runs 1·2 together then 3 and 4, shows pass/fail per scenario with p50/p95 and applied time, saves the summary to settings/rehearsalLast',async()=>{
 await page('/rehearsal.html',async p=>{
  await p.locator('[data-rehearsal-guard]').waitFor();
  assert.match(await p.locator('[data-rehearsal-guard]').innerText(),/17반\(테스트반\)과 이름이 '가상'으로 시작하는 학생에게만/);
  assert.match(await p.locator('#rhSum').innerText(),/아직 리허설 기록이 없습니다/);
  await p.locator('button[data-run="all"]').click();
  await p.locator('[data-rehearsal-table]').waitFor();
  assert.match((await p.evaluate(()=>window.asked))[0],/운영 리허설 · 전체[\s\S]*17반·가상 학생에게만[\s\S]*담임 16명 × 50건/);
  const rows=await p.locator('[data-rehearsal-table] tbody tr').evaluateAll(trs=>trs.map(tr=>[tr.dataset.scenario,tr.children[1].innerText.trim()]));
  assert.deepEqual(rows,[['teachers','통과'],['admins','통과'],['conflicts','실패'],['cleanup','통과']]);
  const sum=await p.locator('[data-rehearsal-summary]').innerText();
  assert.match(sum,/전체\s*실패/);assert.match(sum,/담임 접수 p50 \/ p95\s*120ms \/ 480ms/);assert.match(sum,/담임 800건 모두 반영\s*51\.0초/);
  assert.match(await p.locator('tr[data-scenario="conflicts"]').innerText(),/✘ 운영자가 고친 뒤 담임이 옛 값으로 저장: ok \/ ok/);
  assert.match(await p.locator('tr[data-scenario="cleanup"]').innerText(),/지움 842 · 메모 비움 2 · 남은 리허설 기록 0/);
  const w=await p.evaluate(()=>window.sdkWrites);
  assert.equal(w.length,1);assert.equal(w[0][1],'settings/rehearsalLast');assert.equal(w[0][2].by,'hint.kpc@gmail.com');
  assert.deepEqual(w[0][2].summary.scenarios.map(s=>[s.id,s.pass]),[['teachers',true],['admins',true],['conflicts',false],['cleanup',true]]);
  assert.match(await p.locator('#rhLog').innerText(),/담임 시작/);
  // 4. 정리만 다시: 앞 기록의 서류 번호를 넘김
  await p.locator('button[data-run="cleanup"]').click();
  await until(p,async()=>(await p.evaluate(()=>window.sdkWrites.length))===2,'second save');
  assert.deepEqual(await p.evaluate(()=>window.cleanupArgs),{extraDocIds:['D9','D9']});
 });
});
