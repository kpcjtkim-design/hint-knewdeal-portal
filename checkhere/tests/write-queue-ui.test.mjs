import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

// 쓰기 대기열 화면(2026-10-21): 담임 출결판은 고른 값을 바로 보이고 '반영 대기' → 0.8초 모아 portalSaveBatch 한 번 → queueStatus로 반영·실패 확인.
// 관리자 출결대조는 b2Save가 '접수'로 답하면 '반영 대기'를 보이고 반영될 때까지 기다린 뒤 예전처럼 저장 완료. 가상 학생만 씁니다.
const base=join(import.meta.dirname,'../..');
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const PORTAL={cls:1,region:'수도권',course:'과정1',teacher:'김지아',place:'본관',mainDay:'2026-11-05',days:['2026-11-05','2026-11-04'],week:[],summary:[{k:'총원',v:3}],
 kids:[{name:'고다원',status:'재학',off:''},{name:'김동진',status:'재학',off:''},{name:'박서연',status:'재학',off:''}],
 recs:{'고다원|2026-11-04':{type:'출석',inT:'',outT:'',oa:'',ob:'',r:'',ev:'',evr:''},'김동진|2026-11-04':{type:'결석',inT:'',outT:'',oa:'',ob:'',r:'개인일정',ev:'',evr:'',pending:true}},closed:'미확인',officer:{},queue:true};
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,reason:'',ev:'',evr:'',evApplied:type.startsWith('인정')?(o.ev||'미제출'):'해당없음',prov:'포털',sig:'s',...o})[k]??'');
const LEDGER={rev:7,today:'2026-11-06',days:['2026-11-05','2026-11-06'],classes:[{id:'1',teacher:'김지아'}],roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','박서연','재학','']],ledgerCols:[...COLS,'pending'],
 ledger:[[...L('2026-11-05','1','고다원','인정출석',{reason:'인적성(HMAT)',sig:'sig-고다원'}),''],[...L('2026-11-05','1','김동진','결석',{reason:'개인일정',sig:'sig-김동진',prov:'반영 대기'}),true]]};
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const SDK_STUB=`window.sdkWrites=window.sdkWrites||[];const snap=d=>({exists:()=>d!==undefined,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=c=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...v)=>v;
export const getDoc=async()=>snap(undefined),getDocFromServer=async()=>snap(undefined),getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const PAGES={
 '/teacher.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mountTeacherBeta} from '/teacher-beta.js';window.notes=[];window.tb=mountTeacherBeta(document.getElementById('root'),{cls:1,tab:'board',endpoint:'/api/teacher-beta',notify:(n,sel,f)=>window.notes.push({...n,name:sel.n,date:sel.day,r:f.r})});</script>`,
 '/ledger.html':`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="root"></div><script type="module">import {mount} from '/beta2-ledger.mjs';import {createBeta2Client} from '/beta2-data.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';import {setNotifyContext} from '/notify.mjs';ensureBeta2Css();
  const user={email:'hint.kpc@gmail.com',getIdToken:async()=>'tok'};setNotifyContext({db:{},user});window.client=createBeta2Client(user,{db:{}});window.view=await mount(document.getElementById('root'),{db:{},user,classes:[{id:'1'}],client:window.client,selected:'1',context:{classId:'1',date:'2026-11-05'}});</script>`};

// queue(body, posts): 대기열 쪽 가짜 답(portalSaveBatch·b2Save·queueStatus). 나머지는 고정 값.
async function page(path,run,{queue}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage(),errors=[],posts=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(PAGES[url.pathname])return route.fulfill({contentType:'text/html;charset=utf-8',body:PAGES[url.pathname]});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    const own=await queue(body,posts);if(own)return route.fulfill({contentType:'application/json',body:JSON.stringify(own)});
    const data=body.action==='portalData'?structuredClone(PORTAL):body.action==='b2Bundle'?structuredClone(LEDGER):body.action==='b2Rev'?{rev:LEDGER.rev,sync:{}}:{ok:true};
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})});
   }
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto('https://fixture.test'+path);
  try{await run(p,posts);}catch(e){e.message+=`\n페이지 오류: ${errors.join(' | ')}`;throw e;}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const of=(posts,a)=>posts.filter(b=>b.action===a);
async function until(p,fn,what){for(let i=0;i<80;i++){if(await fn())return;await p.waitForTimeout(100);}throw Error('기다림 끝: '+what);}

test('teacher board with the queue: picks show at once as 반영 대기, rapid picks go out as ONE portalSaveBatch, done clears the mark, a failure stays as a red draft with 다시 저장',async()=>{
 const status=new Map();let n=0;
 await page('/teacher.html',async(p,posts)=>{
  const cell=(name,d='2026-11-05')=>p.locator(`select[data-n="${name}"][data-d="${d}"]`);
  await cell('고다원').waitFor();
  // 서버가 덮어 준 대기 값(김동진 11/4 결석, pending)은 처음부터 '반영 대기'
  assert.equal(await cell('김동진','2026-11-04').evaluate(e=>e.classList.contains('qwait')),true);
  assert.match(await p.locator('#qb').innerText(),/반영 대기 1/);
  await cell('고다원').selectOption('출석');await cell('김동진').selectOption('지각');await cell('박서연').selectOption('결석');
  // 고르자마자 칸에 보이고 '반영 대기'(아직 아무것도 보내지 않음)
  assert.equal(await cell('박서연').inputValue(),'결석');assert.equal(await cell('박서연').evaluate(e=>e.classList.contains('qwait')&&e.classList.contains('k-ab')),true);
  assert.match(await p.locator('#st').innerText(),/반영 대기/);assert.equal(await p.locator('#qs [data-q-note]').count(),1);
  assert.equal(of(posts,'portalSave').length+of(posts,'portalSaveBatch').length,0,'debounced');
  await until(p,()=>of(posts,'portalSaveBatch').length===1,'batch');
  const sent=of(posts,'portalSaveBatch')[0];
  assert.equal(sent.cls,1);assert.deepEqual(sent.args[0].items.map(i=>[i.name,i.date,i.type]),[['고다원','2026-11-05','출석'],['김동진','2026-11-05','지각'],['박서연','2026-11-05','결석']]);
  assert.equal(of(posts,'portalSave').length,0,'no one-by-one saves');
  assert.match(await p.locator('#qb').innerText(),/반영 대기 4/);
  // 시트 반영: 둘은 done, 박서연은 failed
  status.set('id-0',{status:'done',warn:''});status.set('id-1',{status:'done',warn:''});status.set('id-2',{status:'failed',error:'명부에 없는 학생입니다.'});
  await until(p,async()=>await cell('박서연').evaluate(e=>e.classList.contains('qfail')),'failed mark');
  assert.equal(await cell('고다원').evaluate(e=>e.classList.contains('qwait')),false,'done clears the mark');
  assert.equal(await cell('박서연').inputValue(),'결석','the teacher value stays as a draft');
  assert.match(await p.locator('#qb').innerText(),/저장 안 됨 1/);
  assert.match(await p.locator('#root').evaluate(r=>r.shadowRoot.querySelector('#toast').textContent),/저장되지 않았습니다: 박서연 11\/5\(목\) · 명부에 없는 학생입니다\./);
  assert.match(await p.locator('#qs .qerr').innerText(),/저장되지 않았습니다 · 명부에 없는 학생입니다\./,'panel shows the error (박서연 is selected)');
  await p.locator('#qretry').click();
  await until(p,()=>of(posts,'portalSaveBatch').length===2,'retry batch');
  assert.deepEqual(of(posts,'portalSaveBatch')[1].args[0].items.map(i=>[i.name,i.type]),[['박서연','결석']]);
  assert.equal(await cell('박서연').evaluate(e=>e.classList.contains('qwait')&&!e.classList.contains('qfail')),true);
  status.set('id-3',{status:'done'});
  await until(p,async()=>!(await cell('박서연').evaluate(e=>e.classList.contains('qwait'))),'retry done');
  await until(p,async()=>/저장했습니다/.test(await p.locator('#st').innerText()),'saved text');
  assert.ok(of(posts,'queueStatus').every(b=>Array.isArray(b.args[0].ids)||b.args[0].cls==='1'),'asks only by own ids or own class');
 },{queue:b=>{
  if(b.action==='portalSaveBatch')return {ok:true,data:{ok:true,queued:true,ids:b.args[0].items.map(()=>'id-'+(n++))}};
  if(b.action==='queueStatus')return {ok:true,data:{enabled:true,items:b.args[0].ids?b.args[0].ids.map(id=>({id,status:'pending',...(status.get(id)||{})})):[]}};
  return null;}});
});

test('teacher board: failures from earlier come back as red drafts after reopening; a network error on send also keeps the value',async()=>{
 let down=false;
 await page('/teacher.html',async(p,posts)=>{
  const cell=(name,d)=>p.locator(`select[data-n="${name}"][data-d="${d}"]`);
  await cell('고다원','2026-11-05').waitFor();
  await until(p,async()=>await cell('박서연','2026-11-04').evaluate(e=>e.classList.contains('qfail')),'restored failure');
  assert.equal(await cell('박서연','2026-11-04').inputValue(),'조퇴','the failed value is shown again');
  down=true;await cell('고다원','2026-11-05').selectOption('결석');
  await until(p,async()=>await cell('고다원','2026-11-05').evaluate(e=>e.classList.contains('qfail')),'send failure');
  assert.equal(await cell('고다원','2026-11-05').inputValue(),'결석');assert.match(await p.locator('#qs .qerr').innerText(),/마스터시트에 연결하지 못했습니다/);
 },{queue:b=>{
  if(b.action==='queueStatus'&&b.args[0].cls)return {ok:true,data:{enabled:true,items:[{id:'old-1',status:'failed',mine:true,cls:'1',name:'박서연',date:'2026-11-04',type:'조퇴',error:'시트에 반영하지 못했습니다',rec:{type:'조퇴',inT:'',outT:'',oa:'',ob:'',reason:'병원'}},{id:'old-2',status:'failed',mine:false,cls:'1',name:'김동진',date:'2026-11-04',type:'출석',error:'x',rec:{type:'출석'}}]}};
  if(b.action==='portalSaveBatch'&&down)return {ok:false,code:'SHEET_UNAVAILABLE',error:'마스터시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'};
  return null;}});
});

test('admin ledger with the queue: b2Save answered as queued shows 반영 대기, waits for done, then saves as before (next before = new sig); pending rows from teachers carry a badge; bulk save runs rows together',async()=>{
 const st=new Map();let n=0;
 await page('/ledger.html',async(p,posts)=>{
  const row=nm=>p.locator(`tbody[data-student="${nm}"] tr[data-name]`);
  await row('박서연').locator('select[data-inline="type"]').waitFor();
  assert.equal(await row('김동진').locator('.b2-badge.q-wait').innerText(),'반영 대기','a teacher value still waiting is marked');
  await row('박서연').locator('select[data-inline="type"]').selectOption('결석');
  await p.locator('#b2SaveAll').click();
  await row('박서연').locator('.b2-saving .q-wait').waitFor();
  assert.equal(of(posts,'b2Save').length,1);
  st.set('q-0',{status:'done',action:'write',sig:'sig-new',rev:8});
  await p.locator('#b2BulkNote').getByText('1건 저장',{exact:true}).waitFor();
  assert.equal(await row('박서연').locator('.b2-saving').count(),0);
  assert.equal(await p.evaluate(()=>window.client.queueOn()),true);
  // 다음 저장의 before는 대기열 결과의 새 지문
  await row('박서연').locator('select[data-inline="type"]').selectOption('출석');
  await row('고다원').locator('select[data-inline="type"]').selectOption('결석');
  await p.locator('#b2SaveAll').click();
  await until(p,()=>of(posts,'b2Save').length===3,'both rows sent together without waiting for each other');
  const [a,b]=of(posts,'b2Save').slice(1).map(x=>x.args[0]);
  assert.deepEqual([[a.name,a.before],[b.name,b.before]].sort(),[['고다원','sig-고다원'],['박서연','sig-new']]);
  st.set('q-1',{status:'failed',error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'});st.set('q-2',{status:'failed',error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'});
  await until(p,async()=>(await p.locator('.b2-err').allInnerTexts()).some(t=>/그사이 바뀜/.test(t)),'conflict shown like the direct save');
 },{queue:b=>{
  if(b.action==='b2Save')return {ok:true,data:{ok:true,queued:true,id:'q-'+(n++)}};
  if(b.action==='queueStatus')return {ok:true,data:{enabled:true,items:b.args[0].ids.map(id=>({id,status:'pending',...(st.get(id)||{})}))}};
  return null;}});
});
