import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const row=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'1기 동기화',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
const BUNDLE={rev:5,today:'2026-09-03',days:['2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'],
 classes:Array.from({length:17},(_,i)=>({id:String(i+1),region:'수도권',course:`과정${i+1}`,teacher:i===0?'김지아':''})),
 roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','한수빈','중도포기','2026-09-02'],['2','이경수','재학','']],ledgerCols:COLS,
 ledger:[row('2026-09-03','1','고다원','결석',{reason:'개인일정'}),row('2026-09-02','1','김동진','인정출석',{reason:'병원 진료',flag:'운영총괄 값: 결석'}),row('2026-09-01','1','고다원','인정출석',{reason:'병결'}),row('2026-09-02','1','고다원','인정출석',{reason:'병원'}),row('2026-08-31','1','고다원','인정출석',{reason:'병원'}),row('2026-08-28','1','고다원','인정출석',{reason:'병원 통원'})],
 sync:{checkedAt:Date.now()-120000,changedAt:Date.now()-3600000,last:{errors:[]}}};
const DOCS={rev:5,statuses:['접수','처리중','보완 필요','처리완료','취소'],types:['출석부','교육참여확인서','훈련생 확인서','기타'],delivery:['이메일(PDF)','담임 전달','우편'],
 rows:[{id:'D261013-001',requested:'2026-10-13',cls:'1반(김지아)',name:'고다원',birth:'1999-01-01',detail:'기간: 2026-07-27 ~ 2026-08-14',submitTo:'국취제 운영기관',due:'2026-10-14',status:'접수',memo:'',docType:'출석부',qty:'1',delivery:'이메일(PDF)',requester:'teacher@test.kr',handler:'',handledAt:'',link:'',fixReason:''},
  {id:'1기-5',requested:'2026-08-13',cls:'4반',name:'이경수',birth:'',detail:'',submitTo:'국민취업제도 운영기관',due:'2026-08-18',status:'처리완료',memo:'',docType:'출석부',qty:'',delivery:'',requester:'1기 운영총괄',handler:'',handledAt:'',link:'',fixReason:''}]};

const PORTAL={cls:1,region:'수도권',course:'과정1',teacher:'김지아',place:'본관',mainDay:'2026-09-03',days:['2026-09-03','2026-09-02'],week:[],summary:[{k:'총원',v:2},{k:'출석',v:1}],
 kids:[{name:'고다원',status:'재학',off:''},{name:'김동진',status:'재학',off:''}],recs:{'고다원|2026-09-03':{type:'결석'}},checks:[{label:'오전',items:[{row:5,text:'출석 확인',value:''}]}],closed:'미확인',evals:[],sats:[],vocs:[],officer:{leader:'고다원'}};
const SDK_STUB=`
window.sdkWrites=[];window.sdkLoads=(window.sdkLoads||0)+1;
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts';
export const getDoc=async ref=>snap(ref.path==='users/teacher@test.kr'?{role:'TEACHER',active:true,primaryClassId:'1'}:ref.path==='classes/1'?{course:'과정1',region:'수도권',coreLinks:{}}:undefined);
export const getDocFromServer=async ref=>snap(ref.path==='classes/1/checkhereCurrent/2026-09-03'?{records:[
 {id:'a',classId:'1',date:'2026-09-03',name:'고다원',rawEntry:'09:02:00',entry:'09:02:00',exit:'18:00:00',outings:[],outingCount:0,collectedAt:'1'},
 {id:'b',classId:'1',date:'2026-09-03',name:'김동진',rawEntry:'09:25:00',entry:'09:25:00',exit:'18:00:00',outings:[],outingCount:0,collectedAt:'1',entryMemo:'지각_담임:김지아(09:25)'}]}:undefined);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}}),onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set:(ref,data)=>{window.sdkWrites.push(['tx.set',ref.path,data]);},update:(ref,data)=>{window.sdkWrites.push(['tx.update',ref.path,data]);},delete:()=>{}});
export const writeBatch=()=>({set:(ref,data)=>window.sdkWrites.push(['batch.set',ref.path,data]),update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=email=>`
export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(${email?`{email:'${email}',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}`:'null'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml'};

async function beta(run,{email='hint.kpc@gmail.com',api=()=>null,path='/beta2'}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[],plain=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href===SDK+'firebase-firestore.js'){plain.push(url.href);return route.fulfill({contentType:'text/javascript',body:SDK_STUB});}
   if(url.href===SDK+'firebase-firestore.js?beta2-sdk')return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB(email)});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/beta2'||url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    const custom=api(body);if(custom)return route.fulfill({contentType:'application/json',body:JSON.stringify(custom)});
    const data=body.action==='portalData'?PORTAL:body.action==='b2Bundle'?BUNDLE:body.action==='b2Rev'?{rev:BUNDLE.rev,sync:BUNDLE.sync}:body.action==='b2Docs'?DOCS:body.action==='b2Save'?{ok:true,rev:6,sig:'new-sig',memo:'지각_담임:김지아(09:25)',evApplied:'해당없음',check:''}:body.action==='b2DocCreate'?{id:'D261013-002',mailed:true}:{};
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})});
   }
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test'+path);
  await run(page,posts,plain);
  assert.deepEqual(errors,[]);
  if(path==='/beta2')assert.deepEqual(plain,[],'on /beta2 every Firestore import goes through the write guard');
 }finally{await browser.close();}
}

test('/beta2 opens the compressed administrator menu on the beta home without being indexed',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  assert.deepEqual(await page.locator('.admin-major button').allInnerTexts(),['홈','출결','서류발급','교육 운영','공지·설정','미리보기']);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex,nofollow');
  assert.equal(await page.title(),'HINT 2기 베타');
  assert.match(await page.locator('.portal-role').innerText(),/2기 베타/);
  await page.getByText('질병 인정 4회 이상').waitFor();
  assert.equal(await page.locator('.b2-alert').first().locator('b').innerText(),'1','고다원 has four hospital recognitions in the ledger');
  assert.equal(await page.locator('.b2-alert').nth(2).locator('b').innerText(),'1','one new document request');
  assert.ok(posts.some(p=>p.action==='b2Bundle'&&p.args[0]==='all'));
  await page.getByRole('button',{name:'출결',exact:true}).click();
  assert.deepEqual(await page.locator('.admin-tabs .tab').allInnerTexts(),['출결대조','출결 현황','내려받기','체크히어 수집']);
 });
});

test('on /beta2 shared 1기 data is view-only while CheckHere change requests still save with a beta tag',async()=>{
 await beta(async page=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  const result=await page.evaluate(async()=>{
   const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
   const out={};
   try{await fs.setDoc(fs.doc({},'settings','global'),{notice:'x'});out.settings='saved';}catch(e){out.settings=e.code;}
   try{await fs.updateDoc(fs.doc({},'classes','1'),{x:1});out.update='saved';}catch(e){out.update=e.code;}
   try{await fs.addDoc(fs.collection({},'operationsWork'),{x:1});out.add='saved';}catch(e){out.add=e.code;}
   try{await fs.runTransaction({},async tx=>{tx.set(fs.doc({},'classes','1','checkhereCurrent','2026-09-03'),{});});out.tx='saved';}catch(e){out.tx=e.code;}
   await fs.setDoc(fs.doc({},'checkhereRequests','r1'),{status:'pending',reason:'출결대조 입실 → 퇴실 · 지각'});
   await fs.runTransaction({},async tx=>{tx.set(fs.doc({},'checkhereRequests','r2'),{status:'pending',reason:'[2기 베타] 이미 붙음'});tx.set(fs.doc({},'checkhereProposalSources','checkhereProposalRequest_r2'),{a:1});});
   return {out,writes:window.sdkWrites,loads:window.sdkLoads};
  });
  assert.deepEqual(result.out,{settings:'BETA2_READ_ONLY',update:'BETA2_READ_ONLY',add:'BETA2_READ_ONLY',tx:'BETA2_READ_ONLY'});
  assert.deepEqual(result.writes.map(w=>[w[0],w[1],w[2]?.reason]),[['set','checkhereRequests/r1','[2기 베타] 출결대조 입실 → 퇴실 · 지각'],['tx.set','checkhereRequests/r2','[2기 베타] 이미 붙음'],['tx.set','checkhereProposalSources/checkhereProposalRequest_r2',undefined]]);
  assert.equal(result.loads,1,'one Firestore SDK instance');
  await page.getByRole('button',{name:'공지·설정',exact:true}).click();
  await page.getByText('2기 베타 · 보기 전용').waitFor();
 });
});

test('출결대조 shows the ledger next to CheckHere, flags mismatches and saves to the master sheet with the row signature',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  const dong=page.locator('tr[data-name="김동진"]');await dong.waitFor();
  assert.match(await dong.innerText(),/체크히어 지각 09:25/,'implied attendance with a late CheckHere check-in is a mismatch');
  const go=page.locator('tr[data-name="고다원"]');
  assert.match(await go.innerText(),/결석/);
  assert.match(await go.innerText(),/체크히어 입실 09:02/,'absence with a CheckHere check-in is a mismatch');
  assert.match(await page.locator('tr[data-name="한수빈"]').innerText(),/재학 기간 아님/);
  await page.getByRole('button',{name:'체크히어 불일치'}).click();
  assert.deepEqual(await page.locator('tbody tr[data-name]').evaluateAll(rs=>rs.map(r=>r.dataset.name)),['고다원','김동진']);
  await page.getByRole('button',{name:'전체'}).click();
  await dong.getByRole('button',{name:'체크히어 요청'}).click();
  await page.locator('.proposal-box').first().waitFor();
  assert.equal(await page.locator('.proposal-box').count(),3,'times, entry memo and exit memo request boxes');
  await dong.getByRole('button',{name:'체크히어 요청'}).click();
  assert.equal(await page.locator('.proposal-box').count(),0);
  await go.getByRole('button',{name:'수정'}).click();
  await page.locator('[data-editor] [data-type="지각"]').click();
  await page.getByRole('button',{name:'체크히어 시간 넣기'}).click();
  assert.equal(await page.locator('[data-editor] input[data-f="inT"]').inputValue(),'09:02');
  await page.locator('[data-editor] input[data-f="reason"]').fill('교통');
  await page.getByRole('button',{name:'마스터시트에 저장'}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-editor]'));
  const save=posts.find(p=>p.action==='b2Save');
  assert.deepEqual(save.args,[{cls:'1',name:'고다원',date:'2026-09-03',type:'지각',inT:'09:02',outT:'',oa:'',ob:'',reason:'교통',ev:'',evr:'',before:'sig-고다원-2026-09-03'}]);
  assert.match(await go.innerText(),/지각/);assert.match(await go.innerText(),/베타 수정/);
  await page.locator('#b2Date').selectOption('2026-09-02');
  await page.getByText('이 날 체크히어 저장본 없음').first().waitFor();
  assert.match(await dong.innerText(),/인정출석/);assert.match(await dong.innerText(),/운영총괄 값: 결석/);
  assert.equal(await dong.getByRole('button',{name:'운영총괄 값으로'}).count(),1);
 });
});

test('a conflicting save keeps the edit open and reloads the latest row',async()=>{
 let saves=0;
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  const go=page.locator('tr[data-name="고다원"]');await go.waitFor();
  await go.getByRole('button',{name:'수정'}).click();
  await page.locator('[data-editor] [data-type="출석"]').click();
  await page.getByRole('button',{name:'마스터시트에 저장'}).click();
  await page.getByText('최신 값을 불러왔습니다').waitFor();
  assert.equal(await page.locator('[data-editor]').count(),1);
  assert.ok(posts.filter(p=>p.action==='b2Bundle').length>=2);
 },{api:body=>body.action==='b2Save'&&++saves?{ok:false,error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'}:null});
});

test('the document inbox lists requests and a new request is sent with the selected student',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  await page.getByRole('button',{name:'서류발급',exact:true}).click();
  await page.getByRole('heading',{name:'서류발급 신청함'}).waitFor();
  assert.equal(await page.locator('[data-doc]').count(),1,'진행 중 filter hides finished 1기 requests');
  await page.getByRole('button',{name:/^전체/}).click();
  assert.equal(await page.locator('[data-doc]').count(),2);
  await page.getByRole('button',{name:'새 신청 작성'}).click();
  await page.locator('select[data-g="name"]').selectOption('김동진');
  await page.locator('[data-doctype="교육참여확인서"]').click();
  await page.locator('input[data-g="submitTo"]').fill('국민취업지원제도 운영기관');
  await page.locator('input[data-g="from"]').fill('2026-07-27');
  await page.locator('input[data-g="to"]').fill('2026-08-26');
  await page.getByRole('button',{name:'신청하기'}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-submit]'));
  const create=posts.find(p=>p.action==='b2DocCreate');
  assert.deepEqual(create.args,[{cls:'1',name:'김동진',docType:'교육참여확인서',qty:1,period:'2026-07-27 ~ 2026-08-26',purpose:'',submitTo:'국민취업지원제도 운영기관',due:'',delivery:'이메일(PDF)',memo:''}]);
 });
});

test('출결 현황 combines statistics, evidence, disease and dropout views from the ledger',async()=>{
 await beta(async page=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.getByRole('button',{name:'출결 현황',exact:true}).click();
  await page.getByRole('heading',{name:'출결 현황'}).waitFor();
  assert.deepEqual(await page.locator('.b2-tabs .b2-tab').allInnerTexts(),['출결 통계','증빙서류','질병 인정','중도포기·수료']);
  await page.getByRole('tab',{name:'질병 인정'}).click();
  await page.getByText('4/6회').waitFor();
  await page.getByRole('tab',{name:'중도포기·수료'}).click();
  await page.getByText('한수빈').first().waitFor();
 });
});

test('non-administrators cannot open /beta2',async()=>{
 await beta(async(page,posts)=>{
  await page.getByText('접근 권한이 없습니다').waitFor();
  assert.equal(posts.length,0);
 },{email:'teacher@test.kr'});
});

test('the teacher preview merges 1기 and 2기 teacher tabs into six tabs with a disease warning on every tab',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 베타 홈'}).waitFor();
  await page.getByRole('button',{name:'미리보기',exact:true}).click();
  await page.locator('[data-main]').first().waitFor();
  assert.deepEqual(await page.locator('[data-main]').allInnerTexts(),['오늘','출결','서류발급','평가·민원','시간표·자료','반 정보']);
  await page.locator('.b2-alertbar:not([hidden])').waitFor();
  assert.match(await page.locator('.b2-alertbar').innerText(),/고다원 4\/6회/);
  await page.locator('[data-main="attendance"]').click();
  assert.deepEqual(await page.locator('[data-subtab]').allInnerTexts(),['출결판','출결사유','통계','증빙서류','질병 인정']);
  await page.locator('[data-subtab="stats"]').click();
  await page.locator('[data-panel="attendance"] .b2-table').first().waitFor();
  await page.locator('[data-main="documents"]').click();
  await page.getByRole('heading',{name:'서류발급 신청',exact:true}).waitFor();
  assert.equal(await page.locator('.b2-alertbar').isVisible(),true,'the warning stays above every tab');
  assert.equal(posts.filter(p=>p.action==='portalData').length,1,'one teacher-beta instance serves every 2기 pane');
  await page.locator('[data-main="info"]').click();
  await page.locator('[data-main="feedback"]').click();
  assert.equal(posts.filter(p=>p.action==='portalData').length,1);
 });
});

test('the regular portal path keeps the 1기 menu and the real Firestore SDK',async()=>{
 await beta(async(page,posts,plain)=>{
  await page.locator('.admin-major button').first().waitFor();
  assert.deepEqual(await page.locator('.admin-major button').allInnerTexts(),['운영 현황','출결 관리','교육 운영','공지·자료','운영 설정']);
  assert.equal(await page.locator('meta[name="robots"]').count(),0);
  assert.notEqual(await page.title(),'HINT 2기 베타');
  assert.equal(await page.evaluate(()=>window.HINT_BETA2),undefined);
  assert.ok(plain.length>=1,'the 1기 portal imports the Firestore SDK directly');
  assert.equal(posts.filter(p=>p.action?.startsWith('b2')).length,0);
 },{path:'/'});
});
