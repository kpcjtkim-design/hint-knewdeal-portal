import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

// 공지·설정 › 사유 목록(beta2-reasons.mjs, 사용자 2026-10-20): 편집·미리보기·저장(rev 트랜잭션)·그사이 저장 거절·기본값으로 되돌리기·깨진 문서·떠날 때 확인,
// 그리고 담임 출결판(teacher-beta.js)이 저장된 목록을 따르는지. Firestore는 window.fsDocs를 쓰는 가짜 SDK입니다(가상 자료만).
const base=join(import.meta.dirname,'../..');
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const SDK_STUB=`window.fsDocs=window.fsDocs||{};window.sdkWrites=window.sdkWrites||[];const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const snap=d=>({exists:()=>d!==undefined,data:()=>clone(d),metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=c=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...v)=>v;
export const getDoc=async ref=>{if(window.fsFail)throw Object.assign(new Error('permission-denied'),{code:'permission-denied'});return snap(window.fsDocs[ref.path]);},getDocFromServer=getDoc,getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>{const sets=[];const r=await fn({get:async ref=>snap(window.fsDocs[ref.path]),set(ref,d){sets.push([ref.path,d]);},update(){},delete(){}});for(const [p,d] of sets){window.fsDocs[p]=clone(d);window.sdkWrites.push(['tx',p,clone(d)]);}return r;},writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const PORTAL={cls:2,region:'서울',course:'제조지능화',teacher:'김지아',place:'본관',mainDay:'2026-11-05',days:['2026-11-05'],week:[],summary:[{k:'총원',v:1}],
 kids:[{name:'고다원',status:'재학',off:''}],recs:{'고다원|2026-11-05':{type:'인정출석',inT:'',outT:'',oa:'',ob:'',r:'면접',ev:'',evr:''}},closed:'미확인',officer:{}};
const PAGES={
 '/admin.html':`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="root"></div><script type="module">import {mount} from '/beta2-reasons.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';import * as cat from '/attendance-reason-catalog.mjs';import * as store from '/reason-catalog-store.mjs';
  ensureBeta2Css();window.cat=cat;window.store=store;window.user={email:'hint.kpc@gmail.com'};window.db={};window.view=await mount(document.getElementById('root'),{db:window.db,user:window.user});</script>`,
 '/teacher.html':`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="root"></div><script type="module">import {loadReasonCatalog} from '/reason-catalog-store.mjs';import {mountTeacherBeta} from '/teacher-beta.js';
  window.load=await loadReasonCatalog({},{email:'teacher@test.kr'});window.tb=mountTeacherBeta(document.getElementById('root'),{cls:2,tab:'board',endpoint:'/api/teacher-beta'});</script>`};

async function page(path,run,{docs={},fail=false}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage(),errors=[],dialogs=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 p.on('dialog',d=>{dialogs.push(d.message());const answer=p.answers?.shift();answer===false?d.dismiss():d.accept();});
 try{
  await p.addInitScript(([d,f])=>{window.fsDocs=d;window.fsFail=f;},[docs,fail]);
  await p.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(PAGES[url.pathname])return route.fulfill({contentType:'text/html;charset=utf-8',body:PAGES[url.pathname]});
   if(url.pathname==='/api/teacher-beta'){const body=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:body.action==='portalData'?PORTAL:{ok:true}})});}
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await p.goto('https://fixture.test'+path);
  try{await run(p,dialogs);}catch(e){e.message+=`\n페이지 오류: ${errors.join(' | ')}`;throw e;}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const saved=p=>p.evaluate(()=>window.fsDocs['settings/reasonCatalog']);
// 미리보기 사유 드롭다운의 분류 이름(맨 앞 '사유 고르기'와 끝 '기타' 빼고). 분류마다 하나(옆 종류 드롭다운 일반화, 사용자 2026-10-20)
const groups=p=>p.locator('#rcPvMain option').evaluateAll(o=>o.map(x=>x.textContent).slice(1,-1).filter(t=>t!=='해당없음'));

test('사유 목록 편집: 이름·인정·숨기기·세부·종류 기준 → 미리보기, 저장(rev·저장한 사람), 저장 뒤 지금 목록도 바뀜',async()=>{
 await page('/admin.html',async(p,dialogs)=>{
  await p.locator('#rcEditor').waitFor();
  assert.match(await p.locator('#rcSaved').textContent(),/저장본 없음 · 코드의 기본 목록을 쓰는 중/);
  assert.equal(await p.locator('#rcSave').isDisabled(),true);
  assert.deepEqual(await groups(p),['병원·질병','면접','인적성','취업박람회','예비군·민방위','자격증 시험','경조사','공가(관공서·법원)','(인정 안 됨) 교통','(인정 안 됨) 취업활동','(인정 안 됨) 개인사정']);
  // 병원·질병 이름 바꾸기 + 세부 추가
  await p.locator('[data-c="label"]').fill('병원·질병(진료)');
  assert.equal((await groups(p))[0],'병원·질병(진료)');assert.match(await p.locator('#rcSaved').textContent(),/저장 전 변경 있음/);assert.equal(await p.locator('#rcSave').isDisabled(),false);
  await p.locator('#rcNewSub').fill('병원(한방)');await p.locator('#rcAddSub').click();
  // '해당없음'(사용자 2026-10-20 부활): 분류 목록 맨 위 고정 항목, 숨기기만(이름 칸·순서 단추 없음) → 저장하면 naHidden
  const na=p.locator('#rcNa');assert.match(await na.textContent(),/해당없음/);assert.match(await na.textContent(),/고정/);
  assert.equal(await na.locator('input[type="text"],button').count(),0,'no rename, move or delete');
  assert.equal(await p.locator('#rcPvMain option[value="해당없음"]').count(),1);
  await p.locator('#rcNaHidden').check();assert.equal(await p.locator('#rcPvMain option[value="해당없음"]').count(),0);
  await p.locator('#rcNaHidden').uncheck();assert.equal(await p.locator('#rcPvMain option[value="해당없음"]').count(),1);await p.locator('#rcNaHidden').check();
  // 세부 목록 = 옆 종류 드롭다운 목록: 미리보기에서 병원·질병을 고르면 옆 칸에 새 세부
  assert.match(await p.locator('#rcSideNote').textContent(),/바로 옆 종류 드롭다운에 아래 세부/);
  assert.equal(await p.locator('#rcPvMain option[value="병원(한방)"]').count(),0);
  await p.locator('#rcPvMain').selectOption('병원');assert.equal(await p.locator('#rcPvSub option[value="병원(한방)"]').textContent(),'한방');
  await p.locator('#rcPvSub').selectOption('병원(한방)');assert.equal(await p.locator('#rcPvSub').inputValue(),'병원(한방)');
  // 면접 숨기기, 공가 인정 끄기, 공가를 맨 위로
  await p.locator('[data-pick="1"]').click();await p.locator('[data-cb="hidden"]').check();
  assert.equal(await p.locator('#rcPvMain option[value="면접"]').count(),0);
  await p.locator('[data-pick="7"]').click();await p.locator('[data-cb="recognized"]').uncheck();
  assert.ok((await groups(p)).includes('(인정 안 됨) 공가(관공서·법원)'));
  for(let i=0;i<7;i++)await p.locator('.b2r-cat.on [data-move="up"]').click();
  assert.equal((await groups(p))[0],'(인정 안 됨) 공가(관공서·법원)');
  // 자격증 SQLD: 제조지능화 X → 미리보기(인정출석·제조지능화)에서 막힘
  await p.locator('.b2r-cat',{hasText:'자격증 시험'}).locator('.pick').click();
  await p.locator('tr[data-kind-row="14"] select[data-kr="mfg"]').selectOption('X');
  await p.locator('#rcPvCourse').selectOption('mfg');await p.locator('#rcPvMain').selectOption('자격증');
  assert.equal(await p.locator('#rcPvSub option[value="SQLD"]').isDisabled(),true);assert.equal(await p.locator('#rcPvSub option[value="SQLD"]').textContent(),'(인정 안 됨) SQLD');
  await p.locator('#rcNewKind').fill('정보처리기사');await p.locator('#rcAddKind').click();
  assert.equal(await p.locator('#rcPvSub option[value="정보처리기사"]').textContent(),'정보처리기사 (관련성 확인 필요)');
  // 분류 추가
  await p.locator('#rcNewCat').fill('훈련기관 행사');await p.locator('#rcAddCat').click();
  assert.ok((await groups(p)).includes('훈련기관 행사'));assert.equal(await p.locator('[data-c="key"]').inputValue(),'훈련기관행사');
  // 저장 전에는 지금 목록 그대로
  assert.equal(await p.evaluate(()=>window.cat.reasonCategoryOf('공가(투표)')),'공가');
  await p.locator('#rcSave').click();
  await p.locator('#rcMsg',{hasText:'저장했습니다 · 저장본 1번'}).waitFor();
  const doc=await saved(p);assert.equal(doc.rev,1);assert.equal(doc.updatedBy,'hint.kpc@gmail.com');assert.equal(doc.updatedAt,'ts');
  assert.equal(doc.catalog.naHidden,true);assert.equal(doc.catalog.cats[0].key,'공가');assert.equal(doc.catalog.cats[0].recognized,false);assert.equal(doc.catalog.cats.find(c=>c.key==='면접').hidden,true);
  assert.equal(doc.catalog.kinds['자격증'].items.find(i=>i.value==='SQLD').rules.mfg,'X');assert.ok(doc.catalog.cats.some(c=>c.key==='훈련기관행사'));
  assert.equal(await p.evaluate(()=>window.cat.validateReasonCatalog(window.fsDocs['settings/reasonCatalog'].catalog).ok),true);
  assert.equal(await p.evaluate(()=>window.cat.reasonCategoryOf('공가(투표)')),'','the saved list applies right away on this screen');
  assert.equal(await p.evaluate(()=>window.cat.reasonCategoryOf('면접')),'면접','hidden entries still parse old records');
  assert.match(await p.locator('#rcSaved').textContent(),/저장본 1번 · hint\.kpc@gmail\.com/);assert.equal(await p.locator('#rcSave').isDisabled(),true);
  assert.deepEqual(dialogs,[]);
 });
});

test('사유 목록: 그사이 다른 관리자가 저장했으면 거절, 기본값으로 되돌리기는 저장해야 적용, 떠날 때 확인',async()=>{
 const docs={'settings/reasonCatalog':{rev:4,updatedBy:'other@test.kr',updatedAt:'2026-10-20T01:00:00.000Z',catalog:null}};
 await page('/admin.html',async(p,dialogs)=>{
  await p.locator('#rcEditor').waitFor();
  docs['settings/reasonCatalog'].catalog=await p.evaluate(()=>{const d=window.cat.cloneCatalog(window.cat.DEFAULT_REASON_CATALOG);d.cats.find(c=>c.key==='교통').hidden=true;return d;});
  await p.evaluate(d=>{window.fsDocs['settings/reasonCatalog']=d;},docs['settings/reasonCatalog']);
  await p.locator('#rcReload').click();await p.locator('#rcSaved',{hasText:'저장본 4번 · other@test.kr'}).waitFor();
  assert.ok(!(await groups(p)).includes('(인정 안 됨) 교통'));
  await p.locator('[data-c="evidence"]').fill('진료확인서');
  // 다른 관리자가 그사이 5번 저장
  await p.evaluate(()=>{window.fsDocs['settings/reasonCatalog'].rev=5;});
  await p.locator('#rcSave').click();
  await p.locator('#rcMsg',{hasText:'다른 관리자가 그사이 사유 목록을 저장했습니다'}).waitFor();
  assert.equal((await saved(p)).rev,5);assert.equal(await p.locator('#rcSave').isDisabled(),false,'the draft is kept');
  // 떠나기: 저장 전 변경 → 확인(취소하면 남음)
  p.answers=[false];assert.equal(await p.evaluate(()=>window.view.canLeave()),false);assert.match(dialogs.at(-1),/저장하지 않은 사유 목록 변경이 있습니다/);
  // 새로 불러오기(버리기 확인) → 기본값으로 되돌리기(확인) → 저장
  p.answers=[true];await p.locator('#rcReload').click();await p.locator('#rcSaved',{hasText:'저장본 5번'}).waitFor();
  p.answers=[true];await p.locator('#rcDefault').click();
  assert.match(await p.locator('#rcMsg').textContent(),/기본 목록을 불러왔습니다/);assert.ok((await groups(p)).includes('(인정 안 됨) 교통'));
  assert.equal((await saved(p)).catalog.cats.find(c=>c.key==='교통').hidden,true,'not applied until saved');
  await p.locator('#rcSave').click();await p.locator('#rcMsg',{hasText:'저장본 6번'}).waitFor();
  assert.deepEqual((await saved(p)).catalog,await p.evaluate(()=>window.cat.cloneCatalog(window.cat.DEFAULT_REASON_CATALOG)));
  assert.equal(await p.evaluate(()=>window.view.canLeave()),true,'nothing unsaved');
 },{docs});
});

test('깨진 문서·읽기 실패: 기본 목록으로 돌아가고 경고(관리자 화면·담임 출결판 모두)',async()=>{
 const broken={'settings/reasonCatalog':{rev:2,updatedBy:'a@test.kr',catalog:{cats:[{key:'병(원)',label:'x',recognized:true,subs:[]}]}}};
 await page('/admin.html',async p=>{
  await p.locator('#rcEditor').waitFor();
  assert.match(await p.locator('#rcMsg').textContent(),/저장된 사유 목록이 올바르지 않아 기본 목록을 보여 줍니다/);
  const r=await p.evaluate(()=>window.store.loadReasonCatalog(window.db,window.user,{fresh:true}));
  assert.equal(r.from,'default');assert.match(r.warning,/사유 목록 설정이 올바르지 않아 기본 목록을 씁니다/);
  assert.equal(await p.evaluate(()=>window.cat.reasonCatalogSource().from),'default');
  assert.equal((await groups(p)).length,11);
 },{docs:broken});
 await page('/teacher.html',async p=>{
  await p.waitForFunction(()=>window.load);
  const r=await p.evaluate(()=>window.load);assert.equal(r.from,'default');assert.equal(r.warning,'사유 목록 설정을 읽지 못해 기본 목록을 씁니다');assert.equal(r.firstWarning,true);
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await p.waitForSelector('#rp [data-inline="rmain"]');
  assert.ok((await p.locator('#rp [data-inline="rmain"] option').allTextContents()).includes('면접'),'default list');
 },{fail:true});
});

test('담임 출결판은 저장된 사유 목록을 따릅니다: 숨긴 분류는 빠지고 옛 기록은 직접 입력, 새 분류·인정 끄기·과정 기준',async()=>{
 const {DEFAULT_REASON_CATALOG,cloneCatalog}=await import('../../attendance-reason-catalog.mjs');
 const d=cloneCatalog(DEFAULT_REASON_CATALOG);
 d.cats.find(c=>c.key==='면접').hidden=true;
 d.cats.find(c=>c.key==='공가').recognized=false;
 d.cats.unshift({key:'훈련기관',label:'훈련기관 행사',recognized:true,memo:'훈련기관',words:['훈련기관'],evidence:'기관 확인서',subs:[{text:'훈련기관(행사)',label:'기관 행사'}]});
 d.kinds['자격증'].items.find(i=>i.value==='전기기사').rules.mfg='X';
 await page('/teacher.html',async p=>{
  await p.waitForFunction(()=>window.load);assert.deepEqual(await p.evaluate(()=>[window.load.from,window.load.warning,window.load.rev]),['saved','',7]);
  const main=p.locator('#rp [data-inline="rmain"]'),sub=p.locator('#rp [data-inline="rsub"]'),free=p.locator('#rp [data-inline="reason"]');
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await main.waitFor();
  const groups=await main.locator('option').evaluateAll(o=>o.map(x=>x.textContent).slice(2,-1));assert.equal(await main.locator('option').nth(1).textContent(),'해당없음');
  assert.equal(groups[0],'훈련기관 행사');assert.ok(!groups.includes('면접'),'hidden');assert.ok(groups.includes('(인정 안 됨) 공가(관공서·법원)'));
  // 저장된 '면접'(숨긴 분류)은 기타 + 글 그대로
  assert.equal(await main.inputValue(),'기타');assert.equal(await free.inputValue(),'면접');
  await main.selectOption('훈련기관(행사)');assert.equal(await main.inputValue(),'훈련기관(행사)');assert.equal(await p.locator('#mm').textContent(),'(인정출석)훈련기관(행사)_담임:김지아');
  // 2반 제조지능화: 전기기사를 X로 바꾼 목록 → 인정출석에서 막힘
  await main.selectOption('자격증');assert.equal(await sub.locator('option[value="전기기사"]').isDisabled(),true);
  await main.selectOption('공가');assert.match(await p.locator('#rn').innerText(),/공가\(관공서·법원\)은 보통 인정 사유가 아닙니다/);
 },{docs:{'settings/reasonCatalog':{rev:7,updatedBy:'hint.kpc@gmail.com',updatedAt:'ts',catalog:d}}});
});
