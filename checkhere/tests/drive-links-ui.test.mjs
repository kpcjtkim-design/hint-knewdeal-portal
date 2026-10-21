// 구글 드라이브 폴더 바로가기 화면(drive-links.mjs, 2026-10-21): 관리자 출결대조(도구줄 아래 바·학생 증빙 옆 링크)·반 현황(출결 카드)·내려받기(단위기간 폴더),
// 담임 출결판(담임 종류만 + 다른 날짜 폴더), 목록 준비 중, 파일 수 배지, 클라이언트 기억(반마다 한 번, 파일 수 60초). 실제 index.html + 가짜 Apps Script. 사람·폴더는 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {CLASSES as COHORT_CLASSES} from '../../cohort.mjs';
import {openPortal,TODAY as T_TODAY,YESTERDAY as T_YESTERDAY} from './teacher-fixture.mjs';
import {driveAnswer,url} from './drive-fixture.mjs';

const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const row=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'베타 수정',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
const TODAY='2026-11-05';
const BUNDLE={rev:5,today:TODAY,days:['2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-04','2026-11-05'],
 classes:COHORT_CLASSES.map(c=>({id:c.id,region:c.region,course:c.course,hrdName:'',teacher:'',venue:c.venue,address:'',tab:''})),
 roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','박민지','재학',''],['2','이경수','재학','']],ledgerCols:COLS,
 ledger:[row('2026-11-05','1','박민지','인정출석',{reason:'병원'}),row('2026-11-04','1','박민지','인정출석',{reason:'병원'}),row('2026-11-05','1','고다원','결석')],sync:{}};
const SDK_STUB=`
window.sdkWrites=[];
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...a)=>a;
export const getDoc=async ref=>snap(undefined),getDocFromServer=async ref=>snap(undefined);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'n'});
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=`export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'hint.kpc@gmail.com',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
function answer(body,{built=true}={}){
 const p=body.args?.[0]??{};
 if(body.action==='b2DriveFolders'&&!built)return {builtAt:'',done:false,rows:[]};
 const d=driveAnswer(body.action,p);if(d)return d;
 switch(body.action){
  case 'b2Bundle':return BUNDLE;
  case 'b2Rev':return {rev:BUNDLE.rev,sync:{},voc:{rev:3,admin:0,open:{}}};
  case 'b2Dropouts':return {rev:5,maxAbsence:12,rows:[]};
  case 'b2Docs':return {rev:5,statuses:[],rows:[]};
  case 'b2Vocs':return {state:{rev:3,admin:0,open:{}},statuses:[],types:[],rows:[]};
  case 'b2Schedule':return {rev:5,rows:[]};
  case 'b2DayTimes':return {date:p.date,cls:p.cls,start:'09:00',end:'18:00',lateAfter:'09:10',earlyBefore:'17:50',source:'기본',modules:[]};
  case 'b2LedgerMemos':case 'b2DayMemos':case 'b2ModuleTimes':return {rev:5,rows:[]};
  case 'b2Officers':return {rev:5,roles:[],kinds:[],rows:[],current:{},needs:[]};
  default:return {};
 }
}
async function site(run,opts={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.clock.install({time:'2026-11-05T19:00:00+09:00'});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(u.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(u.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB});
   if(u.hostname!=='fixture.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(u.pathname==='/api/teacher-beta'){const body=route.request().postDataJSON();posts.push(body);return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:answer(body,opts)})});}
   const file=join(base,decodeURIComponent(u.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test/');
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await run(page,posts);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const sent=(posts,action)=>posts.filter(p=>p.action===action).map(p=>p.args[0]);
const links=bar=>bar.locator('a.b2-drive-a').evaluateAll(l=>l.map(a=>[a.dataset.driveKind,a.dataset.level,a.getAttribute('href'),a.target,a.rel]));
const openMenu=async(page,tab)=>{await page.getByRole('button',{name:'출결',exact:true}).click();await page.locator(`.admin-tabs [data-tab="${tab}"]`).click();};

test('admin 반 현황 and 출결대조 show the drive bar for the class and date, with unit folders and a per-student evidence link',async()=>{
 await site(async(page,posts)=>{
  // 반 현황: 출결 카드 맨 아래
  await page.locator('.b2-class[data-class="1"]').click();
  await page.getByRole('heading',{name:'반 현황'}).waitFor();
  const card=page.locator('[data-section="day"] [data-drive]');
  await card.locator('a.b2-drive-a').first().waitFor();
  assert.equal(await card.getAttribute('data-date'),TODAY);
  const N='_blank',R='noopener';
  assert.deepEqual(await links(card),[
   ['manual','date',url('m-1105'),N,R],['evidence','date',url('e-1105'),N,R],['photo','week',url('p-w2'),N,R],
   ['unit','unit',url('u1'),N,R],['unitSheet','unit',url('u1-sheet'),N,R],['unitRequest','unit',url('u1-req'),N,R],['unitEvidence','date',url('u1-ev-1105'),N,R]]);
  assert.match(await card.locator('[data-drive-kind="photo"]').getAttribute('title'),/11\/5\(목\) 날짜 폴더가 없어 WEEK 2 폴더를 엽니다/);
  assert.match(await card.innerText(),/단위기간 ›[\s\S]*3\. 출석인정서류\(11\/5\(목\)\)/);
  assert.match(await card.locator('[data-drive-built]').innerText(),/목록 10\. 21\. 14:23/);
  // 파일 수: 마우스를 올리면 바로(그날 폴더: 수기 0개 → 없음, 출결인정 2개, 사진은 그날 폴더 없음 → 없음)
  await card.hover();
  await card.locator('[data-drive-count="evidence"]',{hasText:'2개'}).waitFor();
  assert.deepEqual(await card.locator('[data-drive-count]').allInnerTexts(),['없음','2개','없음']);
  assert.deepEqual(sent(posts,'b2DriveFolders'),[{cls:'1'}],'one folder read per class');
  assert.deepEqual(sent(posts,'b2DriveCount'),[{cls:'1',date:TODAY,kinds:['manual','evidence','photo']}]);

  // 출결대조: 도구줄 바로 아래 한 줄
  await page.locator('#c2Ledger').click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  const bar=page.locator('.b2-drive-slot [data-drive]');
  await bar.locator('a.b2-drive-a').first().waitFor();
  assert.equal(await page.evaluate(()=>document.querySelector('.b2-toolbar').nextElementSibling.className),'b2-drive-slot','right under the filter bar');
  assert.equal(await bar.getAttribute('data-date'),TODAY);
  assert.equal(await bar.locator('[data-drive-kind="evidence"]').getAttribute('href'),url('e-1105'));
  // 학생 증빙 옆 작은 링크(증빙 드롭다운이 있는 행: 인정출석 박민지·결석 고다원), 출석(증빙 없음) 학생에게는 없음
  const ev=page.locator('tr[data-name="박민지"] [data-drive-ev]');await ev.waitFor();
  assert.deepEqual([await ev.innerText(),await ev.getAttribute('href'),await ev.getAttribute('target'),await ev.getAttribute('rel')],['출결인정자료 폴더',url('e-1105'),'_blank','noopener']);
  assert.equal(await page.locator('tr[data-name="고다원"] [data-drive-ev]').count(),1);
  assert.equal(await page.locator('tr[data-name="김동진"] [data-drive-ev]').count(),0);
  assert.equal(sent(posts,'b2DriveFolders').length,1,'the ledger reuses the class folder list');
  // 날짜를 바꾸면(11/4: 출결인정 그날 폴더 없음 → WEEK 2) 바와 학생 링크가 따라갑니다
  await page.locator('#b2Date').selectOption('2026-11-04');
  await bar.and(page.locator('[data-date="2026-11-04"]')).waitFor();
  assert.deepEqual(await bar.locator('[data-drive-kind="evidence"]').evaluate(a=>[a.dataset.level,a.getAttribute('href')]),['week',url('e-w2')]);
  assert.match(await bar.innerText(),/3\. 출석인정서류(?!\()/);
  await page.locator('tr[data-name="박민지"] [data-drive-ev]',{hasText:'WEEK 2'}).waitFor();
  assert.equal(await page.locator('tr[data-name="박민지"] [data-drive-ev]').getAttribute('href'),url('e-w2'));
  // 반을 바꾸면 그 반 목록(2반: 출결인정자료 반 폴더만, 단위기간 없음)
  await page.locator('#b2Class').selectOption('2');
  await bar.and(page.locator('[data-cls="2"]')).locator('a.b2-drive-a').first().waitFor();
  assert.deepEqual((await links(bar)).map(x=>x.slice(0,2)),[['evidence','class']]);
  assert.match(await bar.innerText(),/이 날이 든 단위기간 폴더가 목록에 없습니다/);
  assert.deepEqual(sent(posts,'b2DriveFolders'),[{cls:'1'},{cls:'2'}]);
 });
});

test('내려받기 lists unit folders 1·2·3 per class and unit, read only when opened',async()=>{
 await site(async(page,posts)=>{
  await openMenu(page,'b2downloads');
  await page.getByRole('heading',{name:'내려받기'}).waitFor();
  const box=page.locator('[data-drive-units]');await box.waitFor();
  await page.waitForTimeout(500);const before=sent(posts,'b2DriveFolders').length; // 출결 메뉴가 먼저 연 출결대조가 읽은 것
  assert.equal(await box.locator('li[data-unit]').count(),0,'nothing is drawn until it is opened');
  await box.locator('summary').click();
  await box.locator('li[data-unit="1단위"]').waitFor();
  assert.deepEqual(await box.locator('li[data-unit]').evaluateAll(l=>l.map(x=>x.dataset.unit)),['1단위','2단위']);
  assert.match(await box.locator('li[data-unit="1단위"] b').innerText(),/1단위 · 10\/28/);
  assert.deepEqual(await box.locator('li[data-unit="2단위"] a').evaluateAll(l=>l.map(a=>[a.dataset.driveKind,a.getAttribute('href'),a.target])),[['unit',url('u2'),'_blank'],['unitSheet',url('u2-sheet'),'_blank'],['unitRequest',url('u2-req'),'_blank'],['unitEvidence',url('u2-ev'),'_blank']]);
  assert.match(await box.innerText(),/폴더 목록 10\. 21\. 14:23 기준/);
  await box.locator('[data-drive-units-class]').selectOption('2');
  await box.getByText('2반 단위기간 폴더가 목록에 없습니다').waitFor();
  assert.deepEqual(sent(posts,'b2DriveFolders').slice(before),[{cls:'1'},{cls:'2'}],'read only when opened, then per class');
 });
});

test('before the index is built the bars show only a muted waiting note and never ask for counts',async()=>{
 await site(async(page,posts)=>{
  await page.locator('.b2-class[data-class="1"]').click();
  const note=page.locator('[data-section="day"] [data-drive] [data-drive-wait]');await note.waitFor();
  assert.equal(await note.innerText(),'폴더 목록 준비 중');
  await page.locator('[data-section="day"] [data-drive]').hover();await page.waitForTimeout(1600);
  assert.equal(sent(posts,'b2DriveCount').length,0);
  assert.equal(sent(posts,'b2DriveIndexBuild').length,0);
 },{built:false});
});

test('client memory: folders once per class while built, again after 2 minutes while not built, counts for 60 seconds',async()=>{
 await site(async page=>{
  const r=await page.evaluate(async()=>{
   const {createBeta2Client,DRIVE_CACHE,forgetBeta2Cache}=await import('/beta2-data.mjs');forgetBeta2Cache();
   const calls=[];let built=false;
   const fetchImpl=async(u,init)=>{const b=JSON.parse(init.body);calls.push(b.action+':'+JSON.stringify(b.args[0]));
    const data=b.action==='b2DriveFolders'?(b.args[0].cls==='1'&&built?{builtAt:'t',done:true,rows:[{cls:'1',kind:'photo',unit:'',date:'',id:'x'}]}:{builtAt:'',done:false,rows:[]}):{counts:{photo:1},max:500};
    return {json:async()=>({ok:true,data})};};
   const c=createBeta2Client({getIdToken:async()=>'t'},{fetchImpl});
   const out={};
   await Promise.all([c.driveFolders({cls:'1'}),c.driveFolders({cls:'1'})]);out.sameTime=calls.length;
   await c.driveFolders({cls:'1'});out.notBuiltCached=calls.length;
   const keep=DRIVE_CACHE.notBuiltMs;DRIVE_CACHE.notBuiltMs=0;built=true;
   await c.driveFolders({cls:'1'});out.retried=calls.length;DRIVE_CACHE.notBuiltMs=keep;
   await c.driveFolders({cls:'1'});await c.driveFolders({cls:'1'});out.builtCached=calls.length;
   await c.driveFolders({cls:'2'});out.otherClass=calls.length;
   await c.driveCount({cls:'1',date:'2026-11-05',kinds:['photo']});await c.driveCount({cls:'1',date:'2026-11-05',kinds:['photo']});out.countCached=calls.length;
   const k2=DRIVE_CACHE.countMs;DRIVE_CACHE.countMs=0;await c.driveCount({cls:'1',date:'2026-11-05',kinds:['photo']});DRIVE_CACHE.countMs=k2;out.countAgain=calls.length;
   out.calls=calls;return out;
  });
  assert.deepEqual([r.sameTime,r.notBuiltCached,r.retried,r.builtCached,r.otherClass,r.countCached,r.countAgain],[1,1,2,2,3,4,5]);
  assert.deepEqual(r.calls.slice(0,3),['b2DriveFolders:{"cls":"1"}','b2DriveFolders:{"cls":"1"}','b2DriveFolders:{"cls":"2"}']);
 });
});

/* ---------- 담임 출결판 ---------- */
const teacherApi=body=>driveAnswer(body.action,body.args?.[0]||{});
test('teacher 출결판: drive bar with teacher kinds only, follows the chosen cell, and opens another date',async()=>{
 const errors=await openPortal(async(page,posts)=>{
  await page.locator('[data-main="attendance"]').click();
  await page.locator('table.g select').first().waitFor();
  const bar=page.locator('[data-sub="board"] [data-drive]');
  await bar.locator('a.b2-drive-a').first().waitFor();
  assert.equal(await page.evaluate(()=>{const b=document.querySelector('[data-sub="board"] .b2-drive-host');return b.nextElementSibling?.shadowRoot?'above the board':'elsewhere';}),'above the board');
  assert.equal(await bar.getAttribute('data-date'),T_TODAY,'the board day (기준일) before any cell is picked');
  assert.deepEqual((await links(bar)).map(x=>x.slice(0,3)),[['manual','week',url('m-w1')],['evidence','date',url('e-1029')],['photo','date',url('p-1029')]]);
  assert.doesNotMatch(await bar.innerText(),/단위기간/,'unit folders are admin-only');
  assert.match(await bar.locator('[data-drive-kind="manual"]').getAttribute('title'),/10\/29\(목\) 날짜 폴더가 없어 WEEK 1 폴더를 엽니다/);
  // 파일 수(그린 뒤 잠깐 있다가): 수기 폴더 없음 · 출결인정 3개 · 사진 500개+
  await bar.locator('[data-drive-count="photo"]',{hasText:'500개+'}).waitFor({timeout:8000});
  assert.deepEqual(await bar.locator('[data-drive-count]').allInnerTexts(),['없음','3개','500개+']);
  // 다른 날짜 폴더: 10/28 → 수기출석도 그날 폴더
  await bar.locator('[data-drive-pick]').fill('2026-10-28');
  await page.locator('[data-sub="board"] [data-drive][data-date="2026-10-28"]').waitFor();
  assert.match(await page.locator('[data-sub="board"] [data-drive]').innerText(),/다른 날짜/);
  assert.deepEqual(await page.locator('[data-sub="board"] [data-drive] [data-drive-kind="manual"]').evaluate(a=>[a.dataset.level,a.getAttribute('href')]),['date',url('m-1028')]);
  await page.locator('[data-drive-reset]').click();
  await page.locator(`[data-sub="board"] [data-drive][data-date="${T_TODAY}"]`).waitFor();
  // 출결판에서 어제 칸을 고르면 바가 그날로
  await page.locator(`table.g select[data-d="${T_YESTERDAY}"]`).first().focus();
  await page.locator(`[data-sub="board"] [data-drive][data-date="${T_YESTERDAY}"]`).waitFor();
  assert.equal(await page.locator('[data-sub="board"] [data-drive] [data-drive-kind="evidence"]').getAttribute('href'),url('e-1028'));
  // 다른 칸(출결 사유)에서는 보이지 않음
  await page.locator('[data-subtab="reason"]').click();
  assert.equal(await page.locator('[data-drive]').evaluateAll(l=>l.filter(e=>e.checkVisibility()).length),0);
  assert.ok(sent(posts,'b2DriveFolders').every(a=>a.cls==='1'));
  assert.equal(sent(posts,'b2DriveFolders').length,1);
 },{api:teacherApi});
 assert.deepEqual(errors,[]);
});

test('teacher 출결판 without a built index shows only the waiting note',async()=>{
 const errors=await openPortal(async page=>{
  await page.locator('[data-main="attendance"]').click();
  await page.locator('table.g select').first().waitFor();
  const note=page.locator('[data-sub="board"] [data-drive] [data-drive-wait]');await note.waitFor();
  assert.equal(await note.innerText(),'폴더 목록 준비 중');
  assert.equal(await page.locator('[data-sub="board"] [data-drive-pick]').count(),1,'the date shortcut is still there');
 });
 assert.deepEqual(errors,[]);
});
