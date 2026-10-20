import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {CLASSES as COHORT_CLASSES} from '../../cohort.mjs';

const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const row=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'1기 동기화',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
const BUNDLE={rev:5,today:'2026-11-05',days:['2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'],
 classes:COHORT_CLASSES.map((c,i)=>({id:c.id,region:c.region,course:c.course,teacher:i===0?'김지아':''})),
 roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','한수빈','중도포기','2026-11-04'],['2','이경수','재학','']],ledgerCols:COLS,
 ledger:[row('2026-11-05','1','고다원','결석',{reason:'개인일정'}),row('2026-11-04','1','김동진','인정출석',{reason:'병원 진료',flag:'확인 필요: 가상 메모'}),row('2026-11-03','1','고다원','인정출석',{reason:'병결'}),row('2026-11-04','1','고다원','인정출석',{reason:'병원'}),row('2026-11-02','1','고다원','인정출석',{reason:'병원'}),row('2026-10-30','1','고다원','인정출석',{reason:'병원 통원'})],
 sync:{checkedAt:Date.now()-120000,changedAt:Date.now()-3600000,last:{errors:[]}}};
const DOCS={rev:5,statuses:['접수','처리중','보완 필요','처리완료','취소'],types:['교육참여확인서','체크히어 출석부','수기 출석부','기타 양식'],delivery:['이메일(PDF)','담임 전달','우편'],
 rows:[{id:'D261013-001',requested:'2026-12-15',cls:'1반(김지아)',name:'고다원',birth:'1999-01-01',detail:'기간: 2026-10-28 ~ 2026-11-13',submitTo:'국취제 운영기관',due:'2026-12-16',status:'접수',memo:'',docType:'출석부',qty:'1',delivery:'이메일(PDF)',requester:'teacher@test.kr',handler:'',handledAt:'',link:'',fixReason:''},
  {id:'D261015-005',requested:'2026-12-17',cls:'4반',name:'이경수',birth:'',detail:'',submitTo:'국민취업제도 운영기관',due:'2026-12-22',status:'처리완료',memo:'',docType:'출석부',qty:'',delivery:'',requester:'운영팀',handler:'',handledAt:'',link:'',fixReason:''}]};

const PORTAL={cls:1,region:'수도권',course:'과정1',teacher:'김지아',place:'본관',mainDay:'2026-11-05',days:['2026-11-05','2026-11-04'],week:[],summary:[{k:'총원',v:2},{k:'출석',v:1}],
 kids:[{name:'고다원',status:'재학',off:''},{name:'김동진',status:'재학',off:''}],recs:{'고다원|2026-11-05':{type:'결석'}},checks:[{label:'오전',items:[{row:5,text:'출석 확인',value:''}]}],closed:'미확인',evals:[],sats:[],vocs:[],officer:{leader:'고다원'}};
// 체크히어 기록: 수정창까지 다 읽은 실시간 기록(동기화 모듈이 요청을 만들 수 있는 모양 — source·readState·version·전화 끝 4자리·담임·강의시간)
const rec=o=>({classId:'1',date:'2026-11-05',outings:[],outingCount:0,collectedAt:'1',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',...o});
const CH_DAYS={'classes/1/checkhereCurrent/2026-11-05':{records:[
 rec({id:'a',version:'va',phoneLast4:'1111',teacher:'김지아',name:'고다원',rawEntry:'09:02:00',entry:'09:02:00',exit:'18:00:00'}),
 rec({id:'b',version:'vb',phoneLast4:'2222',teacher:'김지아',name:'김동진',rawEntry:'09:25:00',entry:'09:25:00',exit:'18:00:00',entryMemo:'지각_담임:김지아(09:25)'})]}};
const SDK_STUB=`
window.sdkWrites=[];window.sdkLoads=(window.sdkLoads||0)+1;window.docStore=window.docStore||{};
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
// doc: 실제 Firestore처럼 빈 구간을 빼고 세어 홀수 구간이면 던집니다(빈 날짜로 classes/반/checkhereCurrent가 되던 일, 2026-10-20).
export const getFirestore=()=>({}),doc=(db,...p)=>{const n=p.join('/').split('/').filter(Boolean).length;if(n%2)throw Error('Invalid document reference. Document references must have an even number of segments, but '+p.join('/')+' has '+n+'.');return {path:p.join('/')};},collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts';
export const getDoc=async ref=>snap(ref.path==='users/teacher@test.kr'?{role:'TEACHER',active:true,primaryClassId:'1'}:ref.path==='classes/1'?{course:'과정1',region:'수도권',coreLinks:{}}:undefined);
export const getDocFromServer=async ref=>snap((window.CH_DAYS||${JSON.stringify(CH_DAYS)})[ref.path]);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
// onSnapshot(ref,cb,err)와 onSnapshot(ref,opts,cb,err)를 모두 받습니다.
export const onSnapshot=(ref,a,b,c)=>{const [cb,err]=typeof a==='function'?[a,b]:[b,c],entry={path:ref.path,cb,err};(window.snapCbs=window.snapCbs||[]).push(entry);return()=>{window.snapCbs=window.snapCbs.filter(x=>x!==entry);};};
// 구독에 문서를 넣는 도우미: 배열이면 컬렉션 조회 결과(체크히어 요청), 객체면 문서 하나(settings·체크히어 그날 문서), null이면 문서 없음
window.pushSnap=(path,docs)=>{
 if(Array.isArray(docs))for(const d of docs)window.docStore[path+'/'+d.id]=d;
 const s=Array.isArray(docs)?{docs:docs.map(({id,...d})=>({id,data:()=>d})),metadata:{fromCache:false,hasPendingWrites:false}}:snap(docs??undefined);
 (window.snapCbs||[]).filter(x=>x.path===path).forEach(x=>x.cb(s));
};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async ref=>snap(window.docStore[ref.path]),set:(ref,data)=>{window.sdkWrites.push(['tx.set',ref.path,data]);},update:(ref,data)=>{window.sdkWrites.push(['tx.update',ref.path,data]);},delete:()=>{}});
export const writeBatch=()=>({set:(ref,data)=>window.sdkWrites.push(['batch.set',ref.path,data]),update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=email=>`
export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(${email?`{email:'${email}',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}`:'null'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml'};

// clock: 브라우저 시계(한국 날짜가 '오늘'인지 정함), days: 체크히어 그날 문서(getDocFromServer)
async function beta(run,{email='hint.kpc@gmail.com',api=()=>null,path='/',clock=null,days=null,access=null}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[],plain=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  if(clock)await page.clock.install({time:clock});
  if(days)await page.addInitScript(d=>{window.CH_DAYS=d;},days);
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
    const custom=await api(body);if(custom)return route.fulfill({contentType:'application/json',body:JSON.stringify(custom)});
    const data=body.action==='portalData'?PORTAL:body.action==='b2Bundle'?BUNDLE:body.action==='b2Rev'?{rev:BUNDLE.rev,sync:BUNDLE.sync}:body.action==='b2Docs'?DOCS:body.action==='b2Save'?{ok:true,rev:6,sig:'new-sig',memo:'지각_담임:김지아(09:25)',evApplied:'해당없음',check:''}:body.action==='b2DocCreate'?{id:'D261013-002',mailed:true}:{};
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})});
   }
   if(access!==null&&url.pathname==='/cohort.mjs')return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,'cohort.mjs'),'utf8').replace(/"teacherAccess": (?:true|false)/,`"teacherAccess": ${access}`)});
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test'+path);
  await run(page,posts,plain);
  assert.deepEqual(errors,[]);
  assert.ok(plain.length>=1,'2기 화면은 Firestore SDK를 그대로 씁니다(1기 보기 전용 가드 없음)');
 }finally{await browser.close();}
}

test('the 2기 site opens the administrator menu on the 2기 home without being indexed',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  assert.deepEqual(await page.locator('.admin-major button').allInnerTexts(),['홈','출결','서류발급','민원·이슈','교육 운영','공지·설정','미리보기']);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex,nofollow');
  assert.equal(await page.title(),'HINT 2기 운영포털');
  assert.match(await page.locator('.portal-role').innerText(),/2기 운영 관리자/);
  await page.getByText('질병 인정 4회 이상').waitFor();
  assert.equal(await page.locator('.b2-alert').first().locator('b').innerText(),'1','고다원 has four hospital recognitions in the ledger');
  assert.equal(await page.locator('.b2-alert').nth(2).locator('b').innerText(),'1','one new document request');
  assert.ok(posts.some(p=>p.action==='b2Bundle'&&p.args[0]==='all'));
  await page.getByRole('button',{name:'출결',exact:true}).click();
  assert.deepEqual(await page.locator('.admin-tabs .tab').allInnerTexts(),['출결대조','출결 현황','교육생 상태','중도탈락·수료','내려받기','체크히어 수집']);
 });
});

test('2기 writes go straight to the 2기 Firestore: no /beta2 view-only guard and no tag',async()=>{
 await beta(async page=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  const result=await page.evaluate(async()=>{
   const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
   await fs.setDoc(fs.doc({},'settings','global'),{notice:'x'});
   await fs.setDoc(fs.doc({},'checkhereRequests','r1'),{status:'pending',reason:'출결대조 입실 → 퇴실 · 지각'});
   await fs.setDoc(fs.doc({},'checkhereRequests','r3'),{status:'pending',reason:'[실시간 베타] 지각 교통 [기준:0a1b2c3d]'});
   return {writes:window.sdkWrites,loads:window.sdkLoads,guard:window.HINT_BETA2};
  });
  assert.deepEqual(result.writes.map(w=>[w[0],w[1],w[2]?.reason]),[['set','settings/global',undefined],['set','checkhereRequests/r1','출결대조 입실 → 퇴실 · 지각'],['set','checkhereRequests/r3','[실시간 베타] 지각 교통 [기준:0a1b2c3d]']]);
  assert.equal(result.loads,1,'one Firestore SDK instance');assert.equal(result.guard,undefined);
  await page.getByRole('button',{name:'공지·설정',exact:true}).click();
  await page.locator('#adminBody').waitFor();
  assert.equal(await page.getByText('보기 전용').count(),0);
 });
});

// 「변경 N건 저장」을 누르고 모아 저장이 끝날 때까지 기다립니다(저장 중에는 '저장 중 3/7').
async function saveChanges(page){await page.locator('#b2SaveAll').click();await page.waitForFunction(()=>/^변경 \d+건 저장$/.test(document.querySelector('#b2SaveAll')?.textContent||''),null,{timeout:15000});}

test('출결대조 shows the ledger next to CheckHere with a slim direct-request line under every student, flags mismatches and saves an edit to the master sheet with the row signature',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  const dong=page.locator('tr[data-name="김동진"]');await dong.waitFor();
  await dong.getByText(/체크히어 지각 09:25/).waitFor();// implied attendance with a late CheckHere check-in is a mismatch
  const go=page.locator('tr[data-name="고다원"]'),goType=go.locator('select[data-inline="type"]');
  assert.equal(await goType.inputValue(),'결석');
  assert.match(await go.innerText(),/체크히어 입실 09:02/,'absence with a CheckHere check-in is a mismatch');
  assert.match(await page.locator('tr[data-name="한수빈"]').innerText(),/재학 기간 아님/);
  assert.equal(await page.locator('tr[data-name="한수빈"] select[data-inline="type"]').isDisabled(),true);
  await page.getByRole('button',{name:'체크히어 불일치'}).click();
  assert.deepEqual(await page.locator('tbody tr[data-name]').evaluateAll(rs=>rs.map(r=>r.dataset.name)),['고다원','김동진']);
  await page.getByRole('button',{name:'전체'}).click();
  // 직접 요청: 토글 없이 학생마다(재학 기간 아닌 행은 빼고) 얇은 한 줄. 길게 설명하는 글은 표 위 안내 하나
  assert.equal(await page.getByRole('button',{name:'직접 요청'}).count(),0,'no toggle');
  await page.locator('tbody[data-student="김동진"] .proposal-box').first().waitFor();
  assert.equal(await page.locator('.proposal-box.compact').count(),6,'times, entry memo and exit memo under 고다원 and 김동진');
  assert.equal(await page.locator('tbody[data-student="한수빈"] .proposal-box').count(),0,'none for the row outside enrollment');
  assert.equal(await page.getByText(/자동 요청: 오늘 출결원장을 저장하면 3초 뒤/).count(),1,'one note above the table');
  assert.match(await page.getByText(/자동 요청: 오늘 출결원장을 저장하면 3초 뒤/).innerText(),/관리자가 운영 포털 「반영 요청·승인」에서 승인할 때만/);
  // 유형을 바꾸면 아직 저장하지 않고, 필요한 시간을 체크히어 값으로 채운 뒤 「변경 N건 저장」을 기다립니다.
  const all=page.locator('#b2SaveAll');
  assert.equal(await all.innerText(),'변경 0건 저장');assert.equal(await all.isDisabled(),true);
  await goType.selectOption('지각');
  assert.equal(await go.locator('input[data-inline="inT"]').inputValue(),'09:02');
  assert.equal(posts.filter(p=>p.action==='b2Save').length,0);
  await setReason(go,'교통');
  assert.equal(await all.innerText(),'변경 1건 저장');
  await all.click();
  await go.getByText('베타 수정').waitFor();
  const save=posts.find(p=>p.action==='b2Save');
  assert.deepEqual(save.args,[{cls:'1',name:'고다원',date:'2026-11-05',type:'지각',inT:'09:02',outT:'',oa:'',ob:'',reason:'교통',ev:'',evr:'',before:'sig-고다원-2026-11-05'}]);
  assert.equal(await goType.inputValue(),'지각');
  await page.locator('#b2BulkNote').getByText('1건 저장',{exact:true}).waitFor();
  assert.equal(await all.innerText(),'변경 0건 저장');
  assert.equal(await go.getByRole('button',{name:'저장',exact:true}).count(),0,'no per-row save button');
  assert.equal(await page.evaluate(()=>window.sdkWrites.length),0,'a past day is never sent to CheckHere automatically');
  await page.locator('#b2Date').selectOption('2026-11-04');
  await page.getByText('이 날 체크히어 저장본 없음').first().waitFor();
  assert.equal(await dong.locator('select[data-inline="type"]').inputValue(),'인정출석');assert.match(await dong.innerText(),/참고: 확인 필요: 가상 메모/,'T열 메모는 참고로만');assert.doesNotMatch(await dong.innerText(),/운영총괄/,'2기는 운영총괄 충돌 표시가 없음');
  assert.equal(await dong.getByRole('button',{name:'운영총괄 값으로'}).count(),0);
 });
});

test('a conflicting save keeps the draft with its reason, sends nothing to CheckHere, and Esc shows the latest row',async()=>{
 let saves=0;
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  const go=page.locator('tr[data-name="고다원"]');await go.waitFor();
  await go.locator('select[data-inline="type"]').selectOption('출석');
  await page.locator('#b2SaveAll').click();
  await go.getByText('그사이 바뀜 · 저장 안 됨 · 시트 최신 값 결석 · 개인일정 · 다시 저장하면 이 값으로 덮어씁니다').waitFor();
  assert.equal(await go.locator('select[data-inline="type"]').inputValue(),'출석','the draft stays');
  await page.locator('#b2BulkNote').getByText('1건 확인 필요',{exact:true}).waitFor();
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장');
  assert.ok(posts.filter(p=>p.action==='b2Bundle').length>=2,'the latest ledger was read');
  await go.locator('select[data-inline="type"]').press('Escape');
  await page.waitForFunction(()=>document.querySelector('tr[data-name="고다원"] select[data-inline="type"]')?.value==='결석');
  assert.equal(await go.getByText(/그사이 바뀜/).count(),0);
  assert.equal(await page.evaluate(()=>window.sdkWrites.length),0);
 },{api:body=>body.action==='b2Save'&&++saves?{ok:false,error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'}:null});
});

test('the document inbox lists requests and a new request is sent with the selected student',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.getByRole('button',{name:'서류발급',exact:true}).click();
  await page.getByRole('heading',{name:'서류발급 신청함'}).waitFor();
  assert.equal(await page.locator('[data-doc]').count(),1,'진행 중 filter hides finished requests');
  await page.getByRole('button',{name:/^전체/}).click();
  assert.equal(await page.locator('[data-doc]').count(),2);
  await page.getByRole('button',{name:'새 신청 작성'}).click();
  await page.locator('select[data-g="name"]').selectOption('김동진');
  await page.locator('[data-doctype="교육참여확인서"]').click();
  await page.locator('[data-doctype="수기 출석부"]').click();
  await page.locator('[data-doctype="기타 양식"]').click();
  await page.locator('input[data-g="docOther"]').fill('국취 출석 확인 양식');
  await page.locator('input[data-g="submitTo"]').fill('국민취업지원제도 운영기관');
  await page.locator('input[data-g="from"]').fill('2026-10-28');
  await page.locator('input[data-g="to"]').fill('2026-11-27');
  await page.getByRole('button',{name:'신청하기'}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-submit]'));
  const create=posts.find(p=>p.action==='b2DocCreate');
  assert.deepEqual(create.args,[{cls:'1',name:'김동진',docType:'교육참여확인서 · 수기 출석부 · 기타 양식(국취 출석 확인 양식)',qty:1,period:'2026-10-28 ~ 2026-11-27',purpose:'',submitTo:'국민취업지원제도 운영기관',due:'',delivery:'카카오톡 개별 전송',memo:''}]);
 });
});

test('출결 현황 combines statistics, evidence and disease views from the ledger (중도탈락·수료 moved to its own screen 2026-10-20)',async()=>{
 await beta(async page=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.getByRole('button',{name:'출결 현황',exact:true}).click();
  await page.getByRole('heading',{name:'출결 현황'}).waitFor();
  assert.deepEqual(await page.locator('.b2-tabs .b2-tab').allInnerTexts(),['출결 통계','증빙서류','질병 인정']);
  await page.getByRole('tab',{name:'질병 인정'}).click();
  await page.getByText('4/6회').waitFor();
  assert.equal(await page.locator('#s2Dropouts').innerText(),'중도탈락·수료','link to the 중도탈락·수료 screen');
 });
});

test('teachers cannot open the 2기 site before teacher access opens (cohort teacherAccess=false)',async()=>{
 await beta(async(page,posts)=>{
  await page.getByText('접근 권한이 없습니다').waitFor();
  assert.equal(posts.length,0);
 },{email:'teacher@test.kr',access:false});
});

test('the teacher preview merges 1기 and 2기 teacher tabs into six tabs with a disease warning on every tab',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.getByRole('button',{name:'미리보기',exact:true}).click();
  await page.locator('[data-main]').first().waitFor();
  assert.deepEqual(await page.locator('[data-main]').allInnerTexts(),['오늘 할 일','출결','서류 발급','민원·설문','시간표·자료','우리 반']);
  await page.locator('.b2-alertbar:not([hidden])').waitFor();
  assert.match(await page.locator('.b2-alertbar').innerText(),/고다원 4\/6회/);
  await page.locator('[data-main="attendance"]').click();
  assert.deepEqual(await page.locator('[data-subtab]').allInnerTexts(),['출결판','출결 사유','출석률','증빙서류','질병 인정','중도탈락']);
  await page.locator('[data-subtab="stats"]').click();
  await page.locator('[data-panel="attendance"] .b2-table').first().waitFor();
  await page.locator('[data-main="documents"]').click();
  await page.locator('#t2Head h2',{hasText:'서류 발급'}).waitFor();await page.locator('[data-panel="documents"] .b2').waitFor();
  assert.equal(await page.locator('.b2-alertbar').isVisible(),true,'the warning stays above every tab');
  assert.equal(posts.filter(p=>p.action==='portalData').length,1,'one teacher-beta instance serves every 2기 pane');
  await page.locator('[data-main="info"]').click();
  await page.locator('[data-main="feedback"]').click();
  assert.equal(posts.filter(p=>p.action==='portalData').length,1);
 });
});

test('the old /beta2 path serves the same 2기 portal (vercel.json sends /beta2 to /)',async()=>{
 await beta(async(page,posts,plain)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  assert.deepEqual(await page.locator('.admin-major button').allInnerTexts(),['홈','출결','서류발급','민원·이슈','교육 운영','공지·설정','미리보기']);
  assert.equal(await page.evaluate(()=>window.HINT_BETA2),undefined);
  assert.ok(plain.length>=1);
  const vercel=JSON.parse(readFileSync(join(base,'vercel.json'),'utf8'));
  assert.deepEqual(vercel.redirects.filter(r=>/^\/beta2/.test(r.source)).map(r=>r.destination),['/','/']);
 },{path:'/beta2'});
});

test('today\'s live CheckHere subscription keeps updating after the master sheet is reloaded, and past days are watched too',async()=>{
 // 브라우저 시계를 2기 교육일(2026-11-06 10:00 한국)로 둡니다(실제 오늘은 개강 전일 수 있음).
 const today='2026-11-06';
 const live={...BUNDLE,today,days:[...BUNDLE.days.filter(d=>d<today),today],ledger:[]};
 await beta(async page=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  await page.locator('tr[data-name="고다원"]').waitFor();
  await page.waitForFunction(p=>(window.snapCbs||[]).some(x=>x.path===p),`classes/1/checkhereCurrent/${today}`);
  const push=async exit=>page.evaluate(([day,exit])=>{const snap={exists:()=>true,data:()=>({records:[{id:'a',classId:'1',date:day,name:'고다원',rawEntry:'09:02:00',entry:'09:02:00',exit,outings:[],outingCount:0,collectedAt:exit}]}),metadata:{fromCache:false,hasPendingWrites:false}};window.snapCbs.filter(x=>x.path===`classes/1/checkhereCurrent/${day}`).forEach(x=>x.cb(snap));},[today,exit]);
  await push('17:00:00');
  await page.locator('tr[data-name="고다원"]').getByText('17:00',{exact:true}).waitFor();
  const before=await page.evaluate(()=>0);void before;
  await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await page.waitForTimeout(300);
  await push('18:05:00');
  await page.locator('tr[data-name="고다원"]').getByText('18:05',{exact:true}).waitFor();
  assert.equal(await page.evaluate(p=>window.snapCbs.filter(x=>x.path===p).length,`classes/1/checkhereCurrent/${today}`),1,'one subscription, not re-subscribed by the sheet reload');
  // 지난 날도 저장본을 먼저 읽고 구독해 검증된 결과가 바로 보입니다.
  await page.locator('#b2Date').selectOption('2026-11-05');
  await page.waitForFunction(()=>(window.snapCbs||[]).some(x=>x.path==='classes/1/checkhereCurrent/2026-11-05'));
  assert.equal(await page.evaluate(p=>window.snapCbs.filter(x=>x.path===p).length,`classes/1/checkhereCurrent/${today}`),0,'the previous day is unsubscribed');
  await page.locator('tr[data-name="김동진"]').getByText('09:25',{exact:true}).waitFor();
 },{clock:'2026-11-06T10:00:00+09:00',api:body=>body.action==='b2Bundle'?{ok:true,data:live}:null});
});

test('before the course starts (no past training day) 출결대조 picks today instead of an empty date and never builds a CheckHere document path without a date',async()=>{
 // 2026-10-20: 개강(10-28) 전에는 오늘까지의 교육일이 없어 날짜가 비고, classes/반/checkhereCurrent 문서 주소가 깨져 모든 반이 '불러오지 못해'를 띄웠습니다.
 const today='2026-10-20',early={...BUNDLE,today,ledger:[]};
 await beta(async page=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  await page.locator('tr[data-name="고다원"]').waitFor();
  assert.equal(await page.locator('#b2Date').inputValue(),today);
  await page.waitForFunction(p=>(window.snapCbs||[]).some(x=>x.path===p),`classes/1/checkhereCurrent/${today}`);
  assert.equal(await page.evaluate(()=>(window.snapCbs||[]).filter(x=>/checkhereCurrent\/?$/.test(x.path)).length),0);
  assert.equal(await page.getByText(/불러오지 못해/).count(),0);
  await page.locator('#b2Class').selectOption('2');
  await page.locator('tr[data-name="이경수"]').waitFor();
  assert.equal(await page.locator('#b2Date').inputValue(),today);
  assert.equal(await page.getByText(/불러오지 못해/).count(),0);
 },{clock:'2026-10-20T10:00:00+09:00',api:body=>body.action==='b2Bundle'?{ok:true,data:early}:null});
});

test('출결대조 records any past day: 「다른 날짜…」 opens a date box, a non-training day saves with a muted note and the sheet notice, memos widen their range, and future days open too with a muted note',async()=>{
 // 사용자 결정 2026-10-20: 교육일이 아닌 날(주말·개강 전)도, 아직 오지 않은 날도 기록·수정('둘다 넓혀'). 목록은 교육일 그대로 + 「다른 날짜…」.
 const SAVE_NOTE='교육일이 아닌 날의 기록입니다.',MEMO_NOTE='교육일이 아닌 날의 메모입니다. 출결판에는 나오지 않습니다.';
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.locator('.b2-class').first().click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  await page.locator('tr[data-name="고다원"]').waitFor();
  const sel=page.locator('#b2Date'),any=page.locator('#b2DateAny'),note=page.locator('#b2DayNote');
  assert.equal(await sel.inputValue(),'2026-11-05');assert.equal(await any.isHidden(),true);assert.equal(await note.innerText(),'');
  assert.equal(await sel.locator('option').last().innerText(),'다른 날짜…');
  await sel.selectOption('__any');
  assert.equal(await sel.inputValue(),'2026-11-05','the list stays on the current day');
  assert.equal(await any.isVisible(),true);assert.equal(await any.getAttribute('max'),null,'no upper limit');assert.equal(await any.getAttribute('min'),null,'no lower limit');
  // 미래도 열림(작은 안내만, 막지 않음). 메모는 그날까지 읽음
  await any.fill('2026-11-06');
  await page.waitForFunction(()=>document.querySelector('#b2Date').value==='2026-11-06');
  assert.match(await sel.locator('option:checked').innerText(),/11\/6\(금\).* · 예정/);
  assert.match(await note.innerText(),/아직 오지 않은 날입니다 · 기록할 수 있습니다/);
  assert.equal(await any.isVisible(),true);
  for(let i=0;i<50&&!posts.some(p=>p.action==='b2LedgerMemos'&&p.args[0].to==='2026-11-06');i++)await page.waitForTimeout(100);
  assert.ok(posts.some(p=>p.action==='b2LedgerMemos'&&p.args[0].to==='2026-11-06'),'memos are read up to the future day');
  assert.equal(await page.getByText('아직 오지 않은 날은 기록할 수 없습니다',{exact:false}).count(),0);
  // 일요일(교육일 아님)
  await any.fill('2026-11-01');
  await page.waitForFunction(()=>document.querySelector('#b2Date').value==='2026-11-01');
  await page.waitForFunction(()=>(window.snapCbs||[]).some(x=>x.path==='classes/1/checkhereCurrent/2026-11-01'));
  assert.match(await sel.locator('option:checked').innerText(),/11\/1\(일\) · 교육일 아님/);
  assert.match(await note.innerText(),/교육일이 아닌 날입니다/);
  assert.equal(await any.isVisible(),true);
  const go=page.locator('tr[data-name="고다원"]');
  await go.locator('select[data-inline="type"]').selectOption('결석');
  await page.locator('#b2SaveAll').click();
  await page.locator('#b2Msg').getByText(SAVE_NOTE).waitFor();
  assert.deepEqual(posts.filter(p=>p.action==='b2Save').map(p=>[p.args[0].date,p.args[0].name,p.args[0].type]),[['2026-11-01','고다원','결석']]);
  // 교육일이 아닌 날의 인정 출결: 막지 않고 행에 경고(사용자 2026-10-20). 같은 값으로 되돌리면 경고도 사라짐
  const offNote=page.locator('tbody[data-student="고다원"] [data-offday-note]');
  await go.locator('select[data-inline="type"]').selectOption('인정출석');
  await offNote.waitFor();assert.equal(await offNote.innerText(),'교육일이 아닌 날의 인정 출결은 통계·증빙에 들지 않습니다');
  await go.locator('select[data-inline="type"]').selectOption('결석');
  for(let i=0;i<30&&await offNote.count();i++)await page.waitForTimeout(100);assert.equal(await offNote.count(),0);
  // 메모: 교육일이 아닌 날도 저장하고 시트 안내를 보임
  await page.locator('tbody[data-student="고다원"] [data-memo-toggle]').click();
  await page.locator('tbody[data-student="고다원"] [data-memo-pick="수기출석 미제출"]').click();
  await page.locator('#b2Msg').getByText(MEMO_NOTE).waitFor();
  assert.equal(posts.find(p=>p.action==='b2LedgerMemo').args[0].date,'2026-11-01');
  // 개강 전 날: 메모 기간이 그날부터로 넓어짐, 교육일로 돌아가면 날짜 칸을 닫음
  await any.fill('2026-10-20');
  await page.waitForFunction(()=>document.querySelector('#b2Date').value==='2026-10-20');
  for(let i=0;i<50&&!posts.some(p=>p.action==='b2LedgerMemos'&&p.args[0].from==='2026-10-20');i++)await page.waitForTimeout(100);
  assert.ok(posts.some(p=>p.action==='b2LedgerMemos'&&p.args[0].from==='2026-10-20'),'memos are read from the earlier day');
  await sel.selectOption('2026-11-04');
  await page.waitForFunction(()=>document.querySelector('#b2Date').value==='2026-11-04');
  assert.equal(await any.isHidden(),true);assert.equal(await note.innerText(),'');
  assert.equal(await sel.locator('option[value="2026-10-20"]').count(),0,'the off day leaves the list once you move away');
 },{clock:'2026-11-05T19:00:00+09:00',api:body=>body.action==='b2Save'?{ok:true,data:{ok:true,rev:6,sig:'new-sig',memo:'',evApplied:'해당없음',check:'',offDay:true,notice:SAVE_NOTE}}:body.action==='b2LedgerMemo'?{ok:true,data:{cls:'1',rev:0,offDay:true,notice:MEMO_NOTE}}:body.action==='b2LedgerMemos'?{ok:true,data:{rows:[]}}:null});
});

/* ---------- 행 안 편집 → 체크히어 자동 반영 (설계 docs/beta2-instant-edit-plan.md 5장·9장 beta2-ui (1)~(14), 사용자 결정 2026-10-14) ----------
 * 가상 반: 1반 담임 '가상담임', 학생 이름은 모두 '가상…'. 브라우저 시계를 2026-11-05 18:30(한국, 2기 교육일)으로 두어 이 날이 '오늘'입니다(오늘만 자동). */
const D='2026-11-05',CLOCK='2026-11-05T18:30:00+09:00',ME='hint.kpc@gmail.com',CUR=`classes/1/checkhereCurrent/${D}`;
const V_NAMES=['가상지각','가상메모','가상변경','가상겹침','가상인정','가상출석','가상보정','가상중복','가상증빙','가상취소'];
const VB={...BUNDLE,classes:BUNDLE.classes.map(c=>c.id==='1'?{...c,teacher:'가상담임'}:c),roster:V_NAMES.map(n=>['1',n,'재학','']),
 ledger:[row(D,'1','가상지각','지각',{inT:'09:25'}),...['가상메모','가상변경','가상겹침','가상인정'].map(n=>row(D,'1',n,'출석')),row(D,'1','가상중복','중복',{reason:'가상 사유'}),row(D,'1','가상증빙','인정출석',{reason:'병원 진료'}),row(D,'1','가상취소','지각',{inT:'09:25'})]};
const vrec=(id,name,o={})=>rec({id,version:'v-'+id,phoneLast4:'0000',teacher:'가상담임',name,rawEntry:'09:02:00',entry:'09:02:00',exit:'18:00:00',entryMemo:'',exitMemo:'',...o});
const LATE_MEMO={rawEntry:'09:25:00',entry:'09:25:00',entryMemo:'지각_담임:가상담임(09:25)'};
const VDAYS={[CUR]:{records:[vrec('r1','가상지각',LATE_MEMO),vrec('r2','가상메모',LATE_MEMO),vrec('r3','가상변경',{rawEntry:'09:25:31',entry:'09:25:31'}),vrec('r4','가상겹침',{rawEntry:'09:25:31',entry:'09:25:31'}),
 vrec('r5','가상인정'),vrec('r6','가상출석'),vrec('r7','가상보정',{rawEntry:'09:25:00',entry:'09:00:00'}),vrec('r8','가상중복',{exitMemo:'조퇴_담임:가상담임(교통)'}),vrec('r9','가상증빙'),vrec('r10','가상취소',LATE_MEMO)]}};
const REQUEST_KEYS=['changes','classId','createdAt','createdBy','date','name','phoneLast4','reason','status','updatedAt'];
const AUTO_REASON=/^\[실시간 베타\] 출결대조 자동 · .+ \[기준:[0-9a-f]{8}\]$/;
const virtual=(extra=()=>null)=>({clock:CLOCK,days:VDAYS,api:async body=>(await extra(body))??(body.action==='b2Bundle'?{ok:true,data:VB}:null)});
const student=(page,name)=>page.locator(`tbody[data-student="${name}"]`);
// 출결대조 사유 칸은 드롭다운(사용자 지시 2026-10-20): 목록에 있는 사유는 고르고, 없으면 '기타' → 직접 입력 칸. 지금 사유 글은 직접 입력 칸, 없으면 드롭다운 값.
const reasonMain=(page,name)=>student(page,name).locator('select[data-inline="rmain"]');
async function setReason(scope,text){const main=scope.locator('select[data-inline="rmain"]');if((await main.locator('option').evaluateAll(o=>o.map(x=>x.value))).includes(text))return void await main.selectOption(text);await main.selectOption('기타');await scope.locator('input[data-inline="reason"]').fill(text);}
async function reasonText(scope){const i=scope.locator('input[data-inline="reason"]');return await i.count()?i.inputValue():scope.locator('select[data-inline="rmain"]').inputValue();}
const typeOf=(page,name)=>student(page,name).locator('select[data-inline="type"]');
const chip=(page,name)=>student(page,name).locator('[data-status]');
const savesOf=(posts,name)=>posts.filter(p=>p.action==='b2Save'&&p.args[0].name===name).map(p=>p.args[0]);
const requestWrites=page=>page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='set'&&w[1].startsWith('checkhereRequests/')).map(([,path,data])=>({path,...data})));
// 요청 목록 구독에 문서를 넣습니다(실제 Firestore의 첫 스냅샷). 시각은 브라우저 시계로 채웁니다.
const pushRequests=(page,docs)=>page.evaluate(docs=>{const t={seconds:Math.floor(Date.now()/1000),nanoseconds:0};window.pushSnap('checkhereRequests',docs.map(d=>({createdAt:t,updatedAt:t,...d})));},docs);
async function openLedger(page){
 await page.getByRole('heading',{name:'2기 홈'}).waitFor();
 await page.locator('.b2-class').first().click();
 await page.getByRole('heading',{name:'출결대조'}).waitFor();
 await page.locator('#b2Live').getByText(/체크히어 (저장본|실시간) · 10명/).waitFor();
 await page.waitForFunction(()=>(window.snapCbs||[]).some(x=>x.path==='checkhereRequests'));
 await pushRequests(page,[]);
}

test('today: an inline save that already matches sends nothing, a real change sends exactly one guarded request 3 seconds later, and its status follows the request',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  // 도구줄 중계 표시: 신호가 없으면 꺼짐(자동 수집·해제 표시만 멈춤, 요청은 됨), 작동 중 신호가 오면 '신호 n분 전'
  await page.locator('#b2Relay').getByText('중계 꺼짐 · 자동 수집·해제 표시 없음 (요청은 가능, 반영은 승인 때)').waitFor();
  const offTitle=await page.locator('#b2Relay .b2-pill').getAttribute('title');
  assert.match(offTitle,/^체크히어 해제 상태는 중계가 켜져 있을 때 보입니다\.\n/);assert.match(offTitle,/\(읽기 전용\)\. 요청은 중계 없이도 만들 수 있습니다/);assert.doesNotMatch(offTitle,/시간 삭제 포함/,'삭제 조건이 닫혀 있으면(규칙 게시 깃발 없음) 도구줄 글처럼 시간 삭제를 말하지 않음');
  await page.evaluate(()=>window.pushSnap('settings/checkhereRelay',{state:'running',busy:false,queue:0,capabilities:['incremental-sync-v1'],build:null,at:{seconds:Math.floor(Date.now()/1000),nanoseconds:0}}));
  await page.locator('#b2Relay').getByText('수집 PC 중계 작동 중 · 신호 방금').waitFor();
  // 중계는 읽기 전용: 켜져 있어도 요청은 사람이 운영 포털에서 승인해야 반영된다고 알립니다(자동 처리 안내 없음).
  const relayTitle=await page.locator('#b2Relay .b2-pill').getAttribute('title');
  assert.match(relayTitle,/읽기 전용/);assert.match(relayTitle,/운영 포털 「반영 요청·승인」에서 승인할 때만 반영됩니다/);assert.doesNotMatch(relayTitle,/자동 처리/);
  // 보정 모드: 교시 기록 09:00으로 맞춘 출석은 일치(실제 입실은 글로만). 지각 메모의 시간은 사유 힌트가 아님.
  await student(page,'가상보정').getByText('일치 · 실제 입실 09:25').waitFor();
  assert.equal(await student(page,'가상지각').getByRole('button',{name:/체크히어 메모/}).count(),0,'지각_담임:…(09:25) is a time, not a reason');
  assert.equal(await student(page,'가상중복').getByRole('button',{name:'체크히어 메모: 교통'}).count(),1);
  // (1) 메모가 이미 맞는 기록을 지각으로 저장 → 체크히어 이미 같음, 요청 없음
  await typeOf(page,'가상메모').selectOption('지각');
  assert.equal(await student(page,'가상메모').locator('input[data-inline="inT"]').inputValue(),'09:25','the needed time is filled from CheckHere');
  await saveChanges(page);
  await chip(page,'가상메모').getByText('체크히어 이미 같음').waitFor();
  assert.deepEqual(savesOf(posts,'가상메모'),[{cls:'1',name:'가상메모',date:D,type:'지각',inT:'09:25',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',before:'sig-가상메모-2026-11-05'}]);
  // (2) 유형 변경 → 저장 → 3초 뒤 정확히 1건, 메모만 바뀌고(초·기본 시간 변경 없음) 근거는 가드를 거친 실시간 요청 모양
  await typeOf(page,'가상변경').selectOption('지각');
  await saveChanges(page);
  await chip(page,'가상변경').getByText('보내기 전').waitFor();
  assert.equal((await requestWrites(page)).length,0,'nothing is written during the 3 seconds');
  await chip(page,'가상변경').getByText('승인 대기').waitFor({timeout:6000});
  await page.waitForTimeout(1500);
  const sent=await requestWrites(page);
  assert.equal(sent.length,1,'exactly one request');
  const [req]=sent;
  assert.match(req.path,/^checkhereRequests\/b2_[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(req).filter(k=>k!=='path').sort(),REQUEST_KEYS,'only the keys the rules allow, no deleteTimes');
  assert.match(req.reason,AUTO_REASON);assert.match(req.reason,/출결대조 자동 · 지각 · 일반 출결/);
  assert.deepEqual([req.classId,req.date,req.name,req.phoneLast4,req.status,req.createdBy],['1',D,'가상변경','0000','pending',ME]);
  assert.deepEqual(req.changes,{entryMemo:'지각_담임:가상담임(09:25)'},'09:25:31 keeps its seconds and no default time is added');
  // (4) 요청 상태: 승인 대기(사람이 운영 포털에서 승인) → 반영 중 → 완료
  const {path,createdAt,updatedAt,...rest}=req,doc={...rest,id:path.split('/')[1]};
  await pushRequests(page,[doc]);
  await chip(page,'가상변경').getByText('승인 대기').waitFor();
  assert.equal(await chip(page,'가상변경').getByRole('button',{name:'요청 취소'}).count(),1,'my pending request can be withdrawn');
  await pushRequests(page,[{...doc,status:'applying'}]);
  await chip(page,'가상변경').getByText('반영 중',{exact:true}).waitFor();
  await pushRequests(page,[{...doc,status:'verified',result:{message:'가상 반영 완료'}}]);
  await chip(page,'가상변경').getByText('완료',{exact:true}).waitFor();
  assert.equal((await requestWrites(page)).length,1);
  // 이미 저장된 행의 사유도 칸을 벗어나면 저장하지 않고 모아 저장으로. 인정 아닌 유형의 사유만 바뀐 저장은 체크히어로 자동 전송하지 않음(S5)
  await setReason(student(page,'가상지각'),'가상 교통');
  await page.getByRole('heading',{name:'출결대조'}).click();
  await page.waitForTimeout(300);
  assert.equal(savesOf(posts,'가상지각').length,0,'leaving the field does not save');
  await saveChanges(page);
  await student(page,'가상지각').getByText('베타 수정').waitFor();
  assert.deepEqual(savesOf(posts,'가상지각'),[{cls:'1',name:'가상지각',date:D,type:'지각',inT:'09:25',outT:'',oa:'',ob:'',reason:'가상 교통',ev:'',evr:'',before:'sig-가상지각-2026-11-05'}]);
  await chip(page,'가상지각').getByText('체크히어 이미 같음').waitFor();
  await page.waitForTimeout(3500);
  assert.equal((await requestWrites(page)).length,1,'a reason-only change of a non-recognized type is not sent');
 },virtual());
});

test('undo within 3 seconds writes no request and saves the previous sheet row back; overlapping slow saves never send the older decision',async()=>{
 let slow=0;
 await beta(async(page,posts)=>{
  await openLedger(page);
  // (3) 되돌리기 → 요청 없음, 시트도 저장 전 값으로(before는 방금 받은 sig)
  await typeOf(page,'가상변경').selectOption('지각');
  await saveChanges(page);
  await chip(page,'가상변경').getByText('보내기 전').waitFor();
  await chip(page,'가상변경').getByRole('button',{name:'되돌리기'}).click();
  await chip(page,'가상변경').getByText('체크히어 반영 취소 · 출결원장도 되돌림').waitFor();
  assert.deepEqual(savesOf(posts,'가상변경').map(s=>[s.type,s.before]),[['지각','sig-가상변경-2026-11-05'],['출석','new-sig']]);
  assert.deepEqual(savesOf(posts,'가상변경')[1],{cls:'1',name:'가상변경',date:D,type:'출석',inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',before:'new-sig'});
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상변경"] select[data-inline="type"]')?.value==='출석');
  // (9) 저장 → 3초 안에 사유를 고쳐 다시 모아 저장(느린 저장) → 앞 보류는 멈추고 예전 값으로 요청이 나가지 않음 → 새 값으로 1건
  await typeOf(page,'가상겹침').selectOption('지각');
  await saveChanges(page);
  await chip(page,'가상겹침').getByText('보내기 전').waitFor();
  await setReason(student(page,'가상겹침'),'교통');
  await page.locator('#b2SaveAll').click();
  await chip(page,'가상겹침').getByText('저장 중 · 체크히어 반영 대기').waitFor();
  await page.waitForTimeout(3500);
  assert.equal((await requestWrites(page)).length,0,'the paused countdown does not send while b2Save is slow');
  await chip(page,'가상겹침').getByText('보내기 전').waitFor({timeout:6000});
  await chip(page,'가상겹침').getByText('승인 대기').waitFor({timeout:6000});
  const sent=await requestWrites(page);
  assert.equal(sent.length,1);assert.equal(sent[0].name,'가상겹침');assert.match(sent[0].reason,/출결대조 자동 · 지각 · 교통 \[기준:/);
  assert.deepEqual(savesOf(posts,'가상겹침').map(s=>[s.type,s.reason,s.before]),[['지각','','sig-가상겹침-2026-11-05'],['지각','교통','new-sig']]);
  await page.waitForTimeout(3500);
  assert.equal((await requestWrites(page)).length,1,'the first decision was never sent');
 },virtual(async body=>{if(body.action==='b2Save'&&body.args[0].name==='가상겹침'&&++slow===2)await new Promise(r=>setTimeout(r,4500));return null;}));
});

test('a past day is never sent automatically: 체크히어 맞추기 runs the same 3-second flow, and its undo also restores the sheet',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  // 브라우저 시계는 9/4라 9/3은 지난 날입니다(사용자 결정: 오늘만 자동).
  await typeOf(page,'가상변경').selectOption('지각');
  await saveChanges(page);
  await chip(page,'가상변경').getByRole('button',{name:'체크히어 맞추기'}).waitFor();
  await page.waitForTimeout(3500);
  assert.equal((await requestWrites(page)).length,0,'saving a past day sends nothing');
  // 방금 저장한 행의 맞추기 → 같은 3초, 되돌리기는 출결원장도 되돌림
  await chip(page,'가상변경').getByRole('button',{name:'체크히어 맞추기'}).click();
  await chip(page,'가상변경').getByText('보내기 전').waitFor();
  await chip(page,'가상변경').getByRole('button',{name:'되돌리기'}).click();
  await chip(page,'가상변경').getByText('체크히어 반영 취소 · 출결원장도 되돌림').waitFor();
  assert.deepEqual(savesOf(posts,'가상변경').map(s=>[s.type,s.before]),[['지각','sig-가상변경-2026-11-05'],['출석','new-sig']]);
  // 이 화면에서 저장하지 않은 행도 지금 시트·기록으로 계산한 맞추기를 누르면 3초 뒤 보냄
  await chip(page,'가상메모').getByRole('button',{name:'체크히어 맞추기'}).click();
  await chip(page,'가상메모').getByText('보내기 전').waitFor();
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[0]==='set'&&w[2]?.name==='가상메모'),null,{timeout:6000});
  const sent=await requestWrites(page);
  assert.equal(sent.length,1);assert.deepEqual([sent[0].name,sent[0].date,sent[0].changes],['가상메모',D,{entryMemo:''}]);assert.match(sent[0].reason,/출결대조 자동 · 출석 · 일반 출결 \[기준:/);
  assert.equal(savesOf(posts,'가상메모').length,0,'no sheet save for a plain suggestion');
 },{...virtual(),clock:'2026-11-06T10:00:00+09:00'});
});

test('holds, disabled time deletion, explicit save, keyboard type changes, 중복 rows and attendance rows without a record',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  // (6) ×는 꺼져 있고 이유를 보임. 지각 행의 입실 ×는 유형 안내
  const entryX=student(page,'가상지각').locator('[data-ch-del="entry"]'),exitX=student(page,'가상지각').locator('[data-ch-del="exit"]');
  assert.equal(await entryX.isDisabled(),true);assert.equal(await exitX.isDisabled(),true);
  const entryTitle=await entryX.getAttribute('title'),exitTitle=await exitX.getAttribute('title');
  assert.match(entryTitle,/Firestore 규칙 게시 필요/);assert.doesNotMatch(entryTitle,/중계/,'중계는 삭제 조건이 아님(2026-12-18)');assert.match(entryTitle,/1교시 기록 번호를 확인하지 못했습니다/);
  assert.match(entryTitle,/유형을 먼저 바꿔 주세요 \(결석으로 바꾸면 지울 수 있는 시간을 함께 지웁니다\)/);
  assert.match(exitTitle,/퇴실 기록 번호를 확인하지 못했습니다/);assert.doesNotMatch(exitTitle,/유형을 먼저/);
  assert.equal(await page.locator('[data-ch-del]:not([disabled])').count(),0,'time deletion is off until the rules flag is on');
  // 결석 저장 → 시간 삭제가 꺼져 있어 보류
  await typeOf(page,'가상보정').selectOption('결석');
  await saveChanges(page);
  await chip(page,'가상보정').getByText('보류 · 체크히어 시간 삭제는 Firestore 규칙 게시·수집 PC 업데이트 후 가능').waitFor();
  assert.equal(savesOf(posts,'가상보정')[0].before,'','a row without a ledger record sends before:\'\'');
  // (5) 인정 유형: 사유 없이 저장 → 입력 필요·포커스, 하나로 분류되지 않는 사유 → 보류
  await typeOf(page,'가상인정').selectOption('인정출석');
  await saveChanges(page);
  await student(page,'가상인정').getByText('입력 필요: 사유').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.inline),'rmain','the reason dropdown gets focus');
  assert.equal(savesOf(posts,'가상인정').length,0);
  await setReason(student(page,'가상인정'),'개인일정');// 사유 드롭다운에서 고름
  await student(page,'가상인정').getByText('입력 필요: 사유').waitFor({state:'detached'});// 고치면 안내도 바로 다시 확인
  await saveChanges(page);
  await chip(page,'가상인정').getByText(/보류 · 인정 사유를 하나로 확인하지 못했습니다/).waitFor();
  assert.deepEqual(savesOf(posts,'가상인정').map(s=>[s.type,s.reason]),[['인정출석','개인일정']]);
  // (12) 닫힌 select에서 키보드로 유형을 바꿔도 저장 전에는 b2Save 없음, Esc는 되돌림
  await typeOf(page,'가상변경').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상변경"] select[data-inline="type"]')?.value==='지각');
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('tbody')?.dataset.student+'/'+document.activeElement?.dataset.inline),'가상변경/type','focus stays on the select after the row redraws');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상변경"] select[data-inline="type"]')?.value==='조퇴');
  assert.equal(await student(page,'가상변경').locator('[data-mark]').innerText(),'저장 전');
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장');
  assert.equal(await student(page,'가상변경').locator('input[data-inline="outT"]').count(),1,'only the time the type needs');
  assert.equal(savesOf(posts,'가상변경').length,0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상변경"] select[data-inline="type"]')?.value==='출석');
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 0건 저장');assert.equal(await student(page,'가상변경').locator('[data-mark]').innerText(),'');
  // (13) 중복 행: '유형 선택 필요', 유효한 유형을 고르기 전에는 사유도 저장하지 않음. Enter는 다음 학생 같은 칸으로(저장 없음)
  assert.equal(await typeOf(page,'가상중복').inputValue(),'');
  assert.match(await typeOf(page,'가상중복').locator('option:checked').innerText(),/유형 선택 필요/);
  await setReason(student(page,'가상중복'),'가상 사유 고침');
  await student(page,'가상중복').locator('input[data-inline="reason"]').press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('tbody')?.dataset.student+'/'+document.activeElement?.dataset.inline),'가상증빙/reason');
  await saveChanges(page);
  await student(page,'가상중복').getByText('입력 필요: 유형').waitFor();
  assert.equal(savesOf(posts,'가상중복').length,0);
  await student(page,'가상중복').getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await student(page,'가상중복').locator('input[data-inline="reason"]').inputValue(),'가상 사유');
  // (11) 기록 없는 출석 행: 사유 칸 꺼짐, unchanged 응답이면 요청 없음
  const noReason=reasonMain(page,'가상출석');
  assert.equal(await noReason.isDisabled(),true);assert.match(await noReason.getAttribute('title'),/출석은 사유를 저장하지 않습니다\(유형을 바꾸면 저장\)/);
  await typeOf(page,'가상출석').selectOption('지각');
  assert.equal(await reasonMain(page,'가상출석').isDisabled(),false);
  await saveChanges(page);
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상출석"] select[data-inline="type"]')?.value==='출석');
  assert.equal(savesOf(posts,'가상출석')[0].before,'');
  await chip(page,'가상출석').getByText('체크히어 이미 같음').waitFor();
  // (7) 체크히어 기록이 새로 와도 입력 중인 사유 칸의 값과 포커스는 그대로, Esc 뒤에 새 기록이 보임
  await reasonMain(page,'가상지각').selectOption('기타');// 목록에 없는 사유는 '기타' → 직접 입력
  const reason=student(page,'가상지각').locator('input[data-inline="reason"]');
  await reason.click();await page.keyboard.type('abc');
  await page.evaluate(([path,days])=>window.pushSnap(path,{records:days[path].records.map(r=>r.name==='가상지각'?{...r,exit:'17:30:00',version:'v-r1b',collectedAt:'2'}:r)}),[CUR,VDAYS]);
  await page.locator('#b2Live').getByText('체크히어 실시간 · 10명').waitFor();
  assert.equal(await reason.inputValue(),'abc');
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('tbody')?.dataset.student+'/'+document.activeElement?.dataset.inline),'가상지각/reason');
  await page.keyboard.press('Escape');
  await student(page,'가상지각').getByText('17:30',{exact:true}).waitFor();
  assert.equal(await reasonText(student(page,'가상지각')),'');assert.equal(await reason.count(),0,'Esc also closes the free-text box');
  assert.equal(savesOf(posts,'가상지각').length,0);
  await page.waitForTimeout(3500);
  assert.equal((await requestWrites(page)).length,0,'none of these rows sends a request');
 },virtual(body=>body.action==='b2Save'&&body.args[0].name==='가상출석'?{ok:true,data:{ok:true,unchanged:true,rev:5}}:null));
});

// 시간 삭제 ×: 기록 번호 표시(entryKind·entryEventId·exitEventId)는 연결 프로그램이 그날 화면 데이터에서 붙입니다. 가상출석은 체크인한 학생(1교시 PASS),
// 가상지각(지각)·가상인정(출석)은 관리자가 1교시를 넣은 학생(ATTEND). 켜지는 조건은 가짜 settings 문서(규칙 게시 깃발)로 켜고, 능력은 마지막 중계 신호(없으면 v2로 봄, 2026-10-16)입니다.
const DEL_DAYS={[CUR]:{records:VDAYS[CUR].records.map(r=>r.name==='가상출석'?{...r,entryKind:'PASS',entryEventId:false,exitEventId:true,enterEventId:true}:r.name==='가상지각'||r.name==='가상인정'?{...r,entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false}:r)}};
test('time deletion ×: off with reasons by default, PASS 1교시 stays locked, and with the gate on × asks, counts down and writes one deletion request',async()=>{
 await beta(async(page,posts)=>{
  const asked=[];let answer=false;page.on('dialog',d=>{asked.push(d.message());void(answer?d.accept():d.dismiss());});
  const askedAt=async n=>{for(let i=0;i<100&&asked.length<n;i++)await page.waitForTimeout(50);assert.equal(asked.length,n);};
  await openLedger(page);
  const x=(name,side)=>student(page,name).locator(`[data-ch-del="${side}"]`);
  // 기본: 모두 꺼짐, title에 이유(규칙 게시 깃발 — 중계는 조건이 아님). PASS 1교시는 그 이유도 보임
  assert.equal(await page.locator('[data-ch-del]:not([disabled])').count(),0);
  assert.match(await x('가상출석','exit').getAttribute('title'),/퇴실 시간 삭제 불가 · Firestore 규칙 게시 필요$/);
  assert.match(await x('가상출석','entry').getAttribute('title'),/입실에서 계산된 1교시는 지울 수 없습니다/);
  // 입실(교시) ×는 실제 입실 옆이 아니라 지울 대상인 '교시 기록' 옆에 있습니다(1교시가 실제 입실과 같아도 따로 보임).
  assert.equal(await student(page,'가상지각').locator('span',{hasText:'교시 기록 09:25'}).locator('[data-ch-del="entry"]').count(),1);
  const V2_NEEDED='1교시 삭제는 수집 PC 프로그램 업데이트 후 가능 (time-delete-v2)',EXIT_FIRST='퇴실이 남아 있으면 1교시만 지울 수 없습니다(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다). 퇴실과 함께 지워 주세요.',TYPE_FIRST='유형을 먼저 바꿔 주세요 (결석으로 바꾸면 지울 수 있는 시간을 함께 지웁니다)';
  // 깃발만 오면(중계 신호 없음) 켜짐(사용자 결정 2026-10-16): 능력은 v2로 보고, 해제 상태를 모르니 title에 '반영할 때 체크히어 마스킹 해제 필요'. 도구줄은 '삭제 요청은 가능'
  await page.evaluate(()=>window.pushSnap('settings/checkhereFeatures',{timeDeleteRules:true}));
  await page.waitForFunction(()=>!document.querySelector('tbody[data-student="가상출석"] [data-ch-del="exit"]')?.disabled);
  await page.locator('#b2Relay').getByText('중계 꺼짐 · 자동 수집·해제 표시 없음 (삭제 요청은 가능, 반영은 승인 때)').waitFor();
  assert.match(await page.locator('#b2Relay .b2-pill').getAttribute('title'),/\(읽기 전용\)\. 요청\(시간 삭제 포함\)은 중계 없이도 만들 수 있습니다/);
  // 신호가 없으면 v2: 관리자 1교시 학생은 퇴실 ×·1교시 × 모두 1교시·퇴실 두 칸(사용자 결정 2026-10-19 "둘 다 삭제돼야 함"). 지각은 1교시를 쓰므로 퇴실 ×도 유형부터
  const BOTH='퇴실과 1교시(09:00~18:00 칸)를 함께 지웁니다. 입실 기록은 남을 수 있습니다';
  for(const side of ['exit','entry'])assert.equal(await x('가상인정',side).getAttribute('title'),`체크히어 ${side==='exit'?'퇴실':'입실(교시)'} 시간 삭제 요청 (관리자 승인 뒤 지움 · ${BOTH} · 반영할 때 체크히어 마스킹 해제 필요)`,side);
  assert.equal(await x('가상지각','exit').getAttribute('title'),`퇴실 시간 삭제 불가 · ${TYPE_FIRST}`);
  assert.equal(await x('가상지각','entry').getAttribute('title'),`입실(교시) 시간 삭제 불가 · ${TYPE_FIRST}`);
  // 옛 연결 프로그램(v1)의 중계 신호가 오면 기록 번호가 있고 유형이 쓰지 않는 칸만 켜지고, 관리자 1교시 ×는 업데이트 안내가 먼저
  await page.evaluate(()=>window.pushSnap('settings/checkhereRelay',{state:'running',busy:false,queue:0,capabilities:['incremental-sync-v1','time-delete-v1'],build:'20261014.2',at:{seconds:Math.floor(Date.now()/1000),nanoseconds:0}}));
  await page.waitForFunction(()=>/\(time-delete-v2\)/.test(document.querySelector('tbody[data-student="가상지각"] [data-ch-del="entry"]')?.title||''));
  assert.equal(await x('가상출석','exit').isDisabled(),false);
  assert.equal(await x('가상출석','entry').isDisabled(),true,'PASS 1교시는 계속 잠김');
  assert.equal(await x('가상출석','entry').getAttribute('title'),'입실(교시) 시간 삭제 불가 · 입실에서 계산된 1교시는 지울 수 없습니다. 퇴실을 지우면 함께 비워집니다.');
  // 관리자 1교시 ×는 잠김(문서 표, v2여도 퇴실이 남아 있으면 '퇴실이 남아 있으면…'으로 잠김 — beta2-checkhere-sync 시험)
  assert.equal(await x('가상지각','entry').isDisabled(),true);
  assert.equal(await x('가상지각','entry').getAttribute('title'),`입실(교시) 시간 삭제 불가 · ${V2_NEEDED} · ${TYPE_FIRST}`);
  // 이 중계는 해제 상태를 알리지 않는 옛 중계라(privacy 없음) 모름 → '반영할 때 해제 필요'
  assert.equal(await x('가상지각','exit').getAttribute('title'),'체크히어 퇴실 시간 삭제 요청 (관리자 승인 뒤 지움 · 관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다 · 반영할 때 체크히어 마스킹 해제 필요)');
  assert.equal(await x('가상지각','exit').isDisabled(),false,'지각은 퇴실을 쓰지 않음(v1은 퇴실만 지움)');
  assert.equal(await x('가상인정','exit').getAttribute('title'),'체크히어 퇴실 시간 삭제 요청 (관리자 승인 뒤 지움 · 관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다 · 반영할 때 체크히어 마스킹 해제 필요)','v1: 퇴실만');
  assert.equal(await x('가상인정','entry').getAttribute('title'),`입실(교시) 시간 삭제 불가 · ${V2_NEEDED}`);
  assert.equal(await x('가상메모','exit').isDisabled(),true,'기록 번호가 없는 칸');
  // 확인창 아니오: 아무것도 시작하지 않음
  await x('가상출석','exit').click();
  await askedAt(1);
  assert.match(asked[0],/가상출석 · 2026-11-05 체크히어 시간 삭제를 요청합니다: 퇴실 18:00/);assert.match(asked[0],/관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에서 지워집니다/);assert.match(asked[0],/1교시\(09:02\)와 총 참여 시간도 비워집니다/);assert.match(asked[0],/체크히어 실제 입실 기록은 남습니다/);
  await page.waitForTimeout(300);assert.equal(await chip(page,'가상출석').getByText('보내기 전').count(),0);
  // 예: 3초 되돌리기 → 시간 삭제 요청 1건(출결원장 저장 없음)
  answer=true;await x('가상출석','exit').click();
  await chip(page,'가상출석').getByText('보내기 전').waitFor();
  assert.equal((await requestWrites(page)).length,0,'nothing is written during the 3 seconds');
  await chip(page,'가상출석').getByText('승인 대기').waitFor({timeout:6000});
  const sent=await requestWrites(page);assert.equal(sent.length,1);
  assert.deepEqual(Object.keys(sent[0]).filter(k=>k!=='path').sort(),[...REQUEST_KEYS,'deleteTimes'].sort());
  assert.deepEqual([sent[0].changes,sent[0].deleteTimes],[{exit:''},['exit']]);
  assert.match(sent[0].reason,/^\[실시간 베타\] 출결대조 시간 삭제 · 퇴실 \[기준:[0-9a-f]{8}\]$/);
  assert.equal(asked.length,2);assert.equal(savesOf(posts,'가상출석').length,0,'the master sheet is not saved');
  // 두 칸 삭제(time-delete-v2)를 아는 연결 프로그램 + 수집 PC 체크히어 탭이 가려짐: 도구줄에 가림(읽기만), ×는 그대로 켜지고 title·확인창에 '반영할 때 체크히어 마스킹 해제 필요'
  await page.evaluate(()=>window.pushSnap('settings/checkhereRelay',{state:'running',busy:false,queue:0,capabilities:['incremental-sync-v1','time-delete-v1','time-delete-v2'],build:'20261016.2',privacy:{state:'masked',leftSec:null,writable:false},at:{seconds:Math.floor(Date.now()/1000),nanoseconds:0}}));
  await page.locator('#b2Relay').getByText('수집 PC 중계 작동 중 · 신호 방금 · 체크히어 가림 · 읽기만').waitFor();
  assert.match(await page.locator('#b2Relay .b2-pill').getAttribute('title'),/^체크히어 가림 — 읽기만 가능 · 수정·삭제하려면 마스킹 해제 필요\n/);
  await page.waitForFunction(()=>!document.querySelector('tbody[data-student="가상인정"] [data-ch-del="entry"]')?.disabled);
  assert.equal(await x('가상인정','exit').getAttribute('title'),`체크히어 퇴실 시간 삭제 요청 (관리자 승인 뒤 지움 · ${BOTH} · 반영할 때 체크히어 마스킹 해제 필요)`,'가려져도 요청은 만듦(승인 대기)');
  assert.equal(await x('가상지각','exit').getAttribute('title'),`퇴실 시간 삭제 불가 · ${TYPE_FIRST}`,'v2: 지각은 퇴실 ×도 1교시를 함께 지우므로 유형부터');
  answer=false;await x('가상인정','exit').click();await askedAt(3);
  assert.match(asked[2],/^가상인정 · 2026-11-05 체크히어 시간 삭제를 요청합니다: 입실\(교시\) 09:02 · 퇴실 18:00\n퇴실과 1교시\(09:00~18:00 칸\)를 함께 지웁니다\. 입실 기록은 남을 수 있습니다\.\n관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에서 지워집니다\.\n반영할 때 체크히어 마스킹 해제 필요\.\n보낼까요\?$/);
  // 예: 두 칸 요청 1건(출결원장 저장 없음)
  answer=true;await x('가상인정','exit').click();await askedAt(4);
  await chip(page,'가상인정').getByText('승인 대기').waitFor({timeout:6000});
  const both=(await requestWrites(page)).filter(w=>w.name==='가상인정');assert.equal(both.length,1);
  assert.deepEqual([both[0].changes,both[0].deleteTimes],[{entry:'',exit:''},['entry','exit']]);
  assert.match(both[0].reason,/^\[실시간 베타\] 출결대조 시간 삭제 · 입실\(교시\)·퇴실 \[기준:[0-9a-f]{8}\]$/);
  assert.equal(savesOf(posts,'가상인정').length,0);
 },{...virtual(),days:DEL_DAYS});
});

test('changing the date during the 3 seconds asks first: no sends nothing, yes sends with the saved class and date (S10)',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  const dialogs=[];
  await typeOf(page,'가상변경').selectOption('지각');
  await saveChanges(page);
  await chip(page,'가상변경').getByText('보내기 전').waitFor();
  page.once('dialog',d=>{dialogs.push(d.message());void d.dismiss();});
  await page.locator('#b2Date').selectOption('2026-11-04');
  await page.getByText('이 날 체크히어 저장본 없음').first().waitFor();
  await page.waitForTimeout(3500);
  assert.deepEqual(dialogs,['체크히어 반영 대기 1건을 지금 보낼까요?']);
  assert.equal((await requestWrites(page)).length,0,'no: nothing is sent and nothing moves to the new date');
  await page.locator('#b2Date').selectOption(D);
  await page.locator('#b2Live').getByText(/체크히어 (저장본|실시간) · 10명/).waitFor();
  await pushRequests(page,[]);
  await typeOf(page,'가상인정').selectOption('인정출석');
  await setReason(student(page,'가상인정'),'병원');
  await saveChanges(page);
  await chip(page,'가상인정').getByText('보내기 전').waitFor();
  page.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
  await page.locator('#b2Date').selectOption('2026-11-04');
  await page.getByText('이 날 체크히어 저장본 없음').first().waitFor();
  const sent=await requestWrites(page);
  assert.equal(dialogs.length,2);assert.equal(sent.length,1);
  assert.deepEqual([sent[0].name,sent[0].date,sent[0].classId],['가상인정',D,'1'],'sent with the saved class and date, not the new one');
  assert.deepEqual(sent[0].changes,{entryMemo:'(인정출석)병원_담임:가상담임'});assert.match(sent[0].reason,AUTO_REASON);
  // 3초 안에 화면을 떠나면(S15) 확인 후 지금 보내고 떠납니다.
  await page.locator('#b2Date').selectOption(D);
  await page.locator('#b2Live').getByText(/체크히어 (저장본|실시간) · 10명/).waitFor();
  await pushRequests(page,[]);
  await typeOf(page,'가상겹침').selectOption('지각');
  await saveChanges(page);
  await chip(page,'가상겹침').getByText('보내기 전').waitFor();
  page.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
  await page.locator('.admin-tabs .tab',{hasText:'출결 현황'}).click();
  await page.getByRole('heading',{name:'출결 현황'}).waitFor();
  assert.equal(dialogs.at(-1),'체크히어 반영 대기 1건이 있습니다. 지금 보내고 화면을 떠날까요?');
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[0]==='set'&&w[2]?.name==='가상겹침'));
  const left=(await requestWrites(page)).filter(w=>w.name==='가상겹침');
  assert.equal(left.length,1);assert.equal(left[0].date,D);assert.deepEqual(left[0].changes,{entryMemo:'지각_담임:가상담임(09:25)'});
 },virtual());
});

test('an evidence-only save never sends automatically but offers 체크히어 맞추기; my pending auto request is withdrawn before a new decision is sent',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  // (14) 내 승인 대기 자동 요청이 있는 학생을 출석으로 되돌림 → 그 요청을 먼저 취소(트랜잭션)하고 새 요청
  const old={id:'b2_old',classId:'1',date:D,name:'가상취소',phoneLast4:'0000',status:'pending',createdBy:ME,changes:{entryMemo:'지각_담임:가상담임(09:25)'},reason:'[실시간 베타] 출결대조 자동 · 지각 · 일반 출결 [기준:0123abcd]'};
  await pushRequests(page,[old]);
  await chip(page,'가상취소').getByText('승인 대기').waitFor();
  assert.equal(await chip(page,'가상취소').getByRole('button',{name:'요청 취소'}).count(),1);
  await typeOf(page,'가상취소').selectOption('출석');
  await saveChanges(page);
  await chip(page,'가상취소').getByText('보내기 전').waitFor();
  assert.match(await chip(page,'가상취소').innerText(),/대기 중인 자동 요청 취소/);
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[0]==='set'&&w[1].startsWith('checkhereRequests/b2_')),null,{timeout:6000});
  const order=await page.evaluate(()=>window.sdkWrites.map(w=>[w[0],w[1],w[2]?.status,w[2]?.changes]));
  const withdrawn=order.findIndex(w=>w[0]==='tx.update'&&w[1]==='checkhereRequests/b2_old'&&w[2]==='withdrawn'),created=order.findIndex(w=>w[0]==='set');
  assert.ok(withdrawn>=0&&withdrawn<created,'withdraw first, then the new request');
  assert.deepEqual(order[created][3],{entryMemo:''});
  // (10) 증빙만 저장(사유 옆 증빙 드롭다운 → 모아 저장) → 자동 요청 없음, 체크히어가 다르면 '체크히어 맞추기'(누르면 같은 3초 흐름)
  await chip(page,'가상증빙').getByRole('button',{name:'체크히어 맞추기'}).waitFor();
  await student(page,'가상증빙').locator('select[data-inline="ev"]').selectOption('확인');
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장','the evidence change is a row draft');
  await saveChanges(page);
  assert.deepEqual(savesOf(posts,'가상증빙'),[{cls:'1',name:'가상증빙',date:D,type:'인정출석',inT:'',outT:'',oa:'',ob:'',reason:'병원 진료',ev:'확인',evr:'',before:'sig-가상증빙-2026-11-05'}]);
  await page.waitForTimeout(3500);
  assert.equal((await requestWrites(page)).filter(w=>w.name==='가상증빙').length,0,'evidence only: no automatic request');
  await chip(page,'가상증빙').getByRole('button',{name:'체크히어 맞추기'}).click();
  await chip(page,'가상증빙').getByText('보내기 전').waitFor();
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[0]==='set'&&w[2]?.name==='가상증빙'),null,{timeout:6000});
  const mine=(await requestWrites(page)).filter(w=>w.name==='가상증빙');
  assert.equal(mine.length,1);assert.deepEqual(mine[0].changes,{entryMemo:'(인정출석)병원_담임:가상담임'});assert.match(mine[0].reason,AUTO_REASON);
 },virtual());
});

test('the 3-second undo survives a press across a second boundary and keyboard focus, the 불일치 filter keeps edited rows, and leaving says waiting holds stop',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  await page.getByRole('button',{name:'체크히어 불일치'}).click();
  await student(page,'가상변경').waitFor();
  // 불일치 필터에서 고친 행은 저장 뒤 일치가 되어도 남아 3초·되돌리기를 보입니다.
  await typeOf(page,'가상변경').selectOption('지각');
  await saveChanges(page);
  const undo=chip(page,'가상변경').getByRole('button',{name:'되돌리기'});
  await undo.waitFor();await undo.scrollIntoViewIfNeeded();// 학생마다 직접 요청 줄이 있어 표가 길어짐(마우스로 직접 누르기 전에 화면 안으로)
  assert.equal(await student(page,'가상변경').count(),1);
  assert.equal(await student(page,'가상지각').count(),0,'the filter still hides untouched matching rows');
  // 누르고 있는 사이 1초가 넘어가도(칩의 초가 바뀌어도) 되돌리기가 사라지지 않음
  const box=await undo.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(1100);await page.mouse.up();
  await chip(page,'가상변경').getByText('체크히어 반영 취소 · 출결원장도 되돌림').waitFor();
  assert.deepEqual(savesOf(posts,'가상변경').map(s=>s.type),['지각','출석']);
  // 키보드: 되돌리기에 둔 포커스가 초가 바뀌어도 그대로라 Enter가 먹힘
  await typeOf(page,'가상겹침').selectOption('지각');
  await saveChanges(page);
  const undo2=chip(page,'가상겹침').getByRole('button',{name:'되돌리기'});
  await undo2.focus();
  const sec=await chip(page,'가상겹침').locator('.b2-sec').innerText();
  await page.waitForTimeout(1100);
  assert.notEqual(await chip(page,'가상겹침').locator('.b2-sec').innerText(),sec,'the seconds still count down');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.act+'/'+document.activeElement?.closest('tbody')?.dataset.student),'undo/가상겹침');
  await page.keyboard.press('Enter');
  await chip(page,'가상겹침').getByText('체크히어 반영 취소 · 출결원장도 되돌림').waitFor();
  assert.deepEqual(savesOf(posts,'가상겹침').map(s=>s.type),['지각','출석']);
  // 떠날 때: 진행 중 요청을 기다리는 보류는 보내지 못하고 멈춘다고 따로 알림
  await page.getByRole('button',{name:'전체'}).click();
  await pushRequests(page,[{id:'other_1',classId:'1',date:D,name:'가상인정',phoneLast4:'0000',status:'pending',createdBy:'other@example.com',changes:{exitMemo:'가상 메모'},reason:'가상 직접 요청'}]);
  await typeOf(page,'가상인정').selectOption('인정출석');
  await setReason(student(page,'가상인정'),'병원');
  await saveChanges(page);
  await chip(page,'가상인정').getByText('보류 · 진행 중 요청이 끝나면 다시 계산해 요청').waitFor();
  const dialogs=[];page.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
  await page.locator('.admin-tabs .tab',{hasText:'출결 현황'}).click();
  await page.getByRole('heading',{name:'출결 현황'}).waitFor();
  assert.deepEqual(dialogs,['진행 중 요청·기록을 기다리는 체크히어 반영 1건은 보내지 못하고 멈춥니다(돌아와서 「체크히어 맞추기」로 보낼 수 있음).\n화면을 떠날까요?']);
  await page.waitForTimeout(500);
  assert.equal((await requestWrites(page)).length,0);
 },virtual());
});

test('changing the class keeps the current class until the new ledger arrives; if it fails the rows and the class stay as they were',async()=>{
 let fail=false;
 await beta(async(page,posts)=>{
  await openLedger(page);
  fail=true;await page.clock.fastForward(21000);// 묶음 캐시(20초)가 지나 새 반을 서버에서 읽어야 함
  await page.locator('#b2Class').selectOption('2');
  await page.locator('#b2Msg').getByText(/2반을 불러오지 못해 1반을 그대로 보입니다/).waitFor();
  assert.equal(await page.locator('#b2Class').inputValue(),'1');
  assert.equal(await page.locator('#b2Table').evaluate(t=>t.inert),false);
  assert.equal(await page.locator('tbody[data-student]').count(),10);
  fail=false;
  await typeOf(page,'가상인정').selectOption('결석');
  await saveChanges(page);
  await student(page,'가상인정').getByText('베타 수정').waitFor();
  assert.equal(savesOf(posts,'가상인정')[0].cls,'1','saved to the class on screen');
 },virtual(body=>fail&&['b2Rev','b2Bundle'].includes(body.action)?{ok:false,error:'가상 연결 실패'}:null));
});

test('evidence sits right after the reason dropdown (사용자 2026-10-20): 반려 opens a required reason box, the batch save sends ev and evr, a conflict keeps the evidence draft, and Esc·새로고침·모두 되돌리기 treat it like any draft',async()=>{
 let n=0;
 await beta(async(page,posts)=>{
  await openLedger(page);
  const dialogs=[];let answer=false;page.on('dialog',d=>{dialogs.push(d.message());void(answer?d.accept():d.dismiss());});
  const s=student(page,'가상증빙'),ev=s.locator('select[data-inline="ev"]'),evr=s.locator('input[data-inline="evr"]'),saveAll=page.locator('#b2SaveAll');
  // 맨 오른쪽 「증빙」 단추·칸은 없고, 증빙은 사유 드롭다운 바로 옆 작은 드롭다운
  assert.deepEqual(await page.locator('#b2Table thead th').allInnerTexts(),['이름','출결원장 (마스터시트)','체크히어','대조']);
  assert.equal(await page.getByRole('button',{name:'증빙',exact:true}).count(),0);
  assert.equal(await ev.evaluate(e=>e.previousElementSibling?.classList.contains('b2-rpick')),true,'right after the reason dropdown');
  assert.deepEqual(await ev.locator('option').allTextContents(),['자동 (인정이면 미제출)','미제출','확인','반려','해당없음']);
  assert.equal(await ev.getAttribute('aria-label'),'가상증빙 증빙');assert.equal(await ev.inputValue(),'');
  const w=await ev.evaluate(e=>e.getBoundingClientRect().width);assert.ok(w>=100&&w<=112,`width ${w}`);
  assert.equal(await evr.count(),0);
  assert.equal(await student(page,'가상출석').locator('select[data-inline="ev"]').count(),0,'출석 rows have no evidence select');
  // 반려 → 옆에 반려 사유 칸(포커스), 비어 있으면 모아 저장이 '반려 사유를 적어 주세요.'로 멈춤
  await ev.selectOption('반려');
  await evr.waitFor();assert.equal(await evr.evaluate(e=>e===document.activeElement),true,'the 반려 reason box takes focus');
  assert.equal(await saveAll.innerText(),'변경 1건 저장');
  await s.locator('[data-mark]').getByText('저장 전').waitFor();
  await saveAll.click();
  await s.getByText('반려 사유를 적어 주세요.').waitFor();
  await page.locator('#b2BulkNote').getByText('1건 확인 필요').waitFor();
  assert.equal(savesOf(posts,'가상증빙').length,0,'nothing is sent without a 반려 reason');
  assert.equal(await evr.evaluate(e=>e===document.activeElement),true,'focus goes to the 반려 reason box');
  await evr.fill('가상 반려 사유');
  assert.equal(await s.getByText('반려 사유를 적어 주세요.').count(),0,'checked again while typing');
  // 그사이 바뀜: 초안(증빙·반려 사유)은 남고 최신 값을 읽은 뒤 다시 저장하면 그 값으로
  await saveChanges(page);
  await s.getByText(/그사이 바뀜 · 저장 안 됨/).waitFor();
  assert.equal(await ev.inputValue(),'반려');assert.equal(await evr.inputValue(),'가상 반려 사유');
  assert.ok(posts.filter(p=>p.action==='b2Bundle').length>=2,'the latest ledger was read');
  await saveChanges(page);
  assert.deepEqual(savesOf(posts,'가상증빙').map(x=>[x.type,x.reason,x.ev,x.evr]),[['인정출석','병원 진료','반려','가상 반려 사유'],['인정출석','병원 진료','반려','가상 반려 사유']]);
  assert.equal(await saveAll.innerText(),'변경 0건 저장');
  assert.equal(await ev.inputValue(),'반려');assert.equal(await evr.inputValue(),'가상 반려 사유','the saved 반려 reason shows in its box');
  assert.equal(await s.getByText('반려: 가상 반려 사유').count(),0,'no second 반려 line under the box');
  // Esc는 증빙 초안도 되돌림
  await ev.selectOption('확인');assert.equal(await evr.count(),0);assert.equal(await saveAll.innerText(),'변경 1건 저장');
  await ev.press('Escape');assert.equal(await ev.inputValue(),'반려');assert.equal(await saveAll.innerText(),'변경 0건 저장');
  // 새로고침은 묻고(아니오면 그대로), 모두 되돌리기는 확인 뒤 시트 값으로
  await ev.selectOption('미제출');
  await page.locator('#b2Reload').click();
  for(let i=0;i<100&&dialogs.length<1;i++)await page.waitForTimeout(50);
  assert.deepEqual(dialogs,['저장하지 않은 출결 수정 1건이 있습니다. 새로 읽으면 사라집니다. 계속할까요?']);
  assert.equal(await ev.inputValue(),'미제출');
  answer=true;await page.locator('#b2RevertAll').click();
  await page.waitForFunction(()=>document.querySelector('#b2SaveAll')?.textContent==='변경 0건 저장');
  assert.equal(await ev.inputValue(),'반려');
  assert.equal(savesOf(posts,'가상증빙').length,2);
 },virtual(body=>body.action==='b2Save'&&body.args[0].name==='가상증빙'&&++n===1?{ok:false,error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'}:null));
});

test('a save-all still running when another date is picked finishes first, then the date changes; leaving the screen waits for it',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  await setReason(student(page,'가상지각'),'가상 교통');
  await setReason(student(page,'가상메모'),'가상 메모 사유');
  await page.locator('#b2SaveAll').click();// 느린 저장 두 건
  await page.locator('#b2SaveAll').getByText('저장 중 1/2').waitFor();
  await page.locator('.admin-tabs .tab',{hasText:'출결 현황'}).click();
  await page.locator('#b2Msg').getByText('출결원장 저장 중입니다. 저장이 끝난 뒤 이동해 주세요.').waitFor();
  await page.locator('#b2Date').selectOption('2026-11-04');
  await page.getByText('이 날 체크히어 저장본 없음').first().waitFor();
  assert.equal(await page.locator('#b2Date').inputValue(),'2026-11-04');
  assert.deepEqual(posts.filter(p=>p.action==='b2Save').map(p=>[p.args[0].name,p.args[0].reason,p.args[0].date]),[['가상지각','가상 교통',D],['가상메모','가상 메모 사유',D]],'both rows saved to the day on screen before the date changed');
  assert.equal(await page.getByRole('heading',{name:'출결대조'}).count(),1);
 },virtual(async body=>{if(body.action==='b2Save')await new Promise(r=>setTimeout(r,1500));return null;}));
});

/* ---------- 모아서 한 번에 저장·얇은 직접 요청 줄(사용자 결정 2026-10-16) ---------- */
test('save-all: leaving a field or Enter never saves; rows save one at a time in screen order with progress and the CheckHere hook runs once per saved row; invalid and conflicting rows keep their drafts; Esc and 모두 되돌리기 revert',async()=>{
 let inflight=0,most=0,vb=VB;const order=[];
 await beta(async(page,posts)=>{
  await openLedger(page);
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());void d.accept();});
  const reason=n=>student(page,n).locator('input[data-inline="reason"]'),all=page.locator('#b2SaveAll');
  await setReason(student(page,'가상지각'),'가상 교통');
  await page.getByRole('heading',{name:'출결대조'}).click();
  await reason('가상지각').press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('tbody')?.dataset.student+'/'+document.activeElement?.dataset.inline),'가상메모/rmain','Enter moves to the reason of the next student (its dropdown when it has no free text)');
  await page.waitForTimeout(300);
  assert.equal(posts.filter(p=>p.action==='b2Save').length,0,'neither blur nor Enter saves');
  assert.equal(await student(page,'가상지각').locator('[data-mark]').innerText(),'저장 전');
  assert.equal(await student(page,'가상지각').locator('tr[data-name]').evaluate(r=>r.classList.contains('dirty')),true);
  await typeOf(page,'가상변경').selectOption('지각');// 체크히어에 닿는 변경 → 요청
  await typeOf(page,'가상겹침').selectOption('지각');// 서버가 CONFLICT
  await typeOf(page,'가상인정').selectOption('인정출석');// 사유 없음 → 입력 필요
  await typeOf(page,'가상취소').selectOption('출석');// 체크히어에 닿는 변경 → 요청
  assert.equal(await all.innerText(),'변경 5건 저장');assert.equal(await page.locator('#b2RevertAll').isDisabled(),false);
  await page.keyboard.press('Control+s');
  await all.getByText('저장 중 2/4').waitFor();
  assert.equal(await typeOf(page,'가상출석').evaluate(e=>e.matches(':disabled')),true,'editing is locked while saving');
  assert.equal(await all.isDisabled(),true);
  await page.waitForFunction(()=>/^변경 \d+건 저장$/.test(document.querySelector('#b2SaveAll')?.textContent||''),null,{timeout:15000});
  assert.equal(await page.locator('#b2BulkNote').innerText(),'3건 저장 · 2건 확인 필요');
  assert.deepEqual(order,['가상지각','가상변경','가상겹침','가상취소'],'screen order, the invalid row is not sent');
  assert.equal(most,1,'one row at a time');
  assert.equal(await typeOf(page,'가상출석').evaluate(e=>e.matches(':disabled')),false,'unlocked after saving');
  // 못 저장한 행은 초안과 이유가 남고, 저장한 행은 초안이 지워짐
  await student(page,'가상인정').getByText('입력 필요: 사유').waitFor();assert.equal(await typeOf(page,'가상인정').inputValue(),'인정출석');
  await student(page,'가상겹침').getByText(/^그사이 바뀜 · 저장 안 됨 · 시트 최신 값 출석 · 다시 저장하면 이 값으로 덮어씁니다$/).waitFor();assert.equal(await typeOf(page,'가상겹침').inputValue(),'지각');
  assert.equal(await all.innerText(),'변경 2건 저장');
  assert.equal(await student(page,'가상지각').locator('[data-mark]').innerText(),'');assert.equal(await reason('가상지각').inputValue(),'가상 교통');
  // 체크히어 저장 후 흐름은 저장한 행마다 한 번: 사유만 바꾼 지각은 '이미 같음', 나머지 두 행은 3초 뒤 요청 한 건씩
  await chip(page,'가상변경').getByText('승인 대기').waitFor({timeout:8000});
  await chip(page,'가상취소').getByText('승인 대기').waitFor({timeout:8000});
  await chip(page,'가상지각').getByText('체크히어 이미 같음').waitFor();
  await page.waitForTimeout(1500);
  assert.deepEqual((await requestWrites(page)).map(w=>[w.name,JSON.stringify(w.changes)]).sort(),[['가상변경','{"entryMemo":"지각_담임:가상담임(09:25)"}'],['가상취소','{"entryMemo":""}']]);
  // Esc는 그 행 초안만 되돌림
  await typeOf(page,'가상인정').press('Escape');
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상인정"] select[data-inline="type"]')?.value==='출석');
  assert.equal(await student(page,'가상인정').getByText('입력 필요: 사유').count(),0);
  assert.equal(await typeOf(page,'가상겹침').inputValue(),'지각');assert.equal(await all.innerText(),'변경 1건 저장');
  // 모두 되돌리기(확인 뒤)
  await page.locator('#b2RevertAll').click();
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상겹침"] select[data-inline="type"]')?.value==='출석');
  assert.deepEqual(dialogs,['저장하지 않은 출결 수정 1건을 모두 되돌릴까요?']);
  assert.equal(await all.innerText(),'변경 0건 저장');assert.equal(await all.isDisabled(),true);assert.equal(await page.locator('#b2RevertAll').isDisabled(),true);
  assert.equal(await student(page,'가상겹침').getByText(/그사이 바뀜/).count(),0);
  assert.equal(posts.filter(p=>p.action==='b2Save').length,4);
  // 입력하던 칸에서 Ctrl+S: 저장하는 동안 잠갔다가 끝나면 그 칸으로 포커스가 돌아옴(확인 필요 행이 없을 때)
  await setReason(student(page,'가상메모'),'가상 메모 사유');await page.keyboard.press('Control+s');
  await page.locator('#b2BulkNote').getByText('1건 저장',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('tbody')?.dataset.student+'/'+document.activeElement?.dataset.inline),'가상메모/reason');
  assert.deepEqual(savesOf(posts,'가상메모').map(s=>s.reason),['가상 메모 사유']);
 },virtual(async body=>{
  if(body.action==='b2Bundle')return {ok:true,data:vb};// 저장한 행은 시트에 남습니다(충돌 뒤 다시 읽어도 앞서 저장한 값 그대로)
  if(body.action!=='b2Save')return null;
  const a=body.args[0],n=a.name;order.push(n);inflight++;most=Math.max(most,inflight);
  await new Promise(r=>setTimeout(r,400));inflight--;
  if(n==='가상겹침')return {ok:false,error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'};
  vb={...vb,ledger:[...vb.ledger.filter(r=>!(r[0]===a.date&&r[2]===n)),row(a.date,a.cls,n,a.type,{inT:a.inT,outT:a.outT,oa:a.oa,ob:a.ob,reason:a.reason,ev:a.ev,evr:a.evr,prov:'베타 수정',sig:'new-sig'})]};
  return null;
 }));
});

test('drafts and direct-request edits ask before leaving, changing the date, reloading or pulling; a background refresh keeps drafts and marks rows that changed underneath',async()=>{
 let vb=VB;
 const sigOf=(name)=>{const r=vb.ledger.find(x=>x[0]===D&&x[2]===name);return r?r[16]:'';};
 await beta(async(page,posts)=>{
  await openLedger(page);
  const dialogs=[];let answer=false;page.on('dialog',d=>{dialogs.push(d.message());void(answer?d.accept():d.dismiss());});
  const asked=async n=>{for(let i=0;i<100&&dialogs.length<n;i++)await page.waitForTimeout(50);assert.equal(dialogs.length,n);};
  await setReason(student(page,'가상지각'),'가상 교통');
  const reason=student(page,'가상지각').locator('input[data-inline="reason"]');
  await page.getByRole('heading',{name:'출결대조'}).click();
  // 다른 화면·날짜·새로고침: 묻고, 아니오면 그대로(2기에는 운영총괄 가져오기가 없음)
  await page.locator('.admin-tabs .tab',{hasText:'출결 현황'}).click();await asked(1);
  assert.equal(dialogs[0],'저장하지 않은 출결 수정 1건이 있습니다. 화면을 떠날까요?');
  assert.equal(await page.getByRole('heading',{name:'출결대조'}).count(),1);
  await page.locator('#b2Date').selectOption('2026-11-04');await asked(2);
  assert.equal(dialogs[1],'저장하지 않은 출결 수정 1건이 있습니다. 날짜를 바꾸면 사라집니다. 바꿀까요?');
  await page.waitForFunction(d=>document.querySelector('#b2Date').value===d,D);
  const bundles=posts.filter(p=>p.action==='b2Bundle').length;
  await page.locator('#b2Reload').click();await asked(3);
  assert.equal(dialogs[2],'저장하지 않은 출결 수정 1건이 있습니다. 새로 읽으면 사라집니다. 계속할까요?');
  assert.equal(posts.filter(p=>p.action==='b2Bundle').length,bundles);assert.equal(await page.getByRole('button',{name:'이 반 운영총괄 가져오기'}).count(),0);
  assert.equal(await reason.inputValue(),'가상 교통');
  assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;}),true,'closing the tab warns');
  // 시트 변경 번호가 바뀌어 다시 읽어도 초안은 그대로, 초안 밑의 행이 바뀐 학생은 '그사이 바뀜'(다른 학생은 새 값)
  vb={...VB,rev:9,ledger:[...VB.ledger.filter(r=>r[2]!=='가상지각'),row(D,'1','가상지각','지각',{inT:'09:25',reason:'시트에서 고침',sig:'sig-changed'}),row(D,'1','가상출석','결석',{sig:'sig-가상출석-new'})]};
  await page.clock.fastForward(31000);
  await page.waitForFunction(()=>document.querySelector('tbody[data-student="가상출석"] select[data-inline="type"]')?.value==='결석');
  assert.equal(await reason.inputValue(),'가상 교통','the draft is kept');
  await student(page,'가상지각').getByText('그사이 바뀜 · 시트 값 지각 · 입실 09:25 · 시트에서 고침').waitFor();
  // 저장은 초안을 시작할 때의 지문으로 → 서버가 거절, 초안은 남고 기준을 최신으로 옮겨 다시 저장하면 덮어씀
  await saveChanges(page);
  await student(page,'가상지각').getByText('그사이 바뀜 · 저장 안 됨 · 시트 최신 값 지각 · 입실 09:25 · 시트에서 고침 · 다시 저장하면 이 값으로 덮어씁니다').waitFor();
  assert.equal(await reason.inputValue(),'가상 교통');
  await saveChanges(page);
  await student(page,'가상지각').getByText('베타 수정').waitFor();
  assert.deepEqual(savesOf(posts,'가상지각').map(s=>[s.reason,s.before]),[['가상 교통','sig-가상지각-2026-11-05'],['가상 교통','sig-changed']]);
  // 직접 요청 추천값만 고쳐도 떠날 때 묻습니다(1기 canNavigate처럼). 예면 떠남
  await page.getByLabel('가상메모 입실·교시 사유 추천사유',{exact:true}).fill('가상 직접 사유');
  await page.getByRole('heading',{name:'출결대조'}).click();
  await page.locator('.admin-tabs .tab',{hasText:'출결 현황'}).click();await asked(4);
  assert.equal(dialogs[3],'저장하지 않은 체크히어 직접 요청 편집값이 있습니다. 화면을 떠날까요?');
  assert.equal(await page.getByRole('heading',{name:'출결대조'}).count(),1);
  answer=true;await page.locator('.admin-tabs .tab',{hasText:'출결 현황'}).click();
  await page.getByRole('heading',{name:'출결 현황'}).waitFor();
  assert.equal(await page.evaluate(()=>window.sdkWrites.filter(w=>w[1].startsWith('checkhereRequests/')).length),0,'editing a suggestion never writes a request');
 },virtual(body=>{
  if(body.action==='b2Bundle')return {ok:true,data:vb};
  if(body.action==='b2Rev')return {ok:true,data:{rev:vb.rev,sync:vb.sync}};
  if(body.action==='b2Save'&&body.args[0].before!==sigOf(body.args[0].name))return {ok:false,error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'};
  return null;
 }));
});

test('the reason input stays moderately narrow with its full text in the tooltip, and every enrolled student shows one slim direct-request line without a toggle',async()=>{
 await beta(async page=>{
  await openLedger(page);
  const r=student(page,'가상증빙').locator('input[data-inline="reason"]'),width=()=>r.evaluate(e=>e.getBoundingClientRect().width);
  assert.ok(await width()>=120&&await width()<=260,`reason width ${await width()}`);
  assert.equal(await r.getAttribute('title'),'병원 진료');
  const long='가상 사유가 아주 길게 이어지는 경우 '.repeat(6).trim();
  await r.fill(long);
  assert.equal(await r.getAttribute('title'),long);assert.ok(await width()<=260,'typing does not widen it');
  await r.press('Escape');
  // 직접 요청: 토글 없이 학생 10명 모두 얇은 한 줄(추천시간 입실·퇴실, 추천사유 입실·퇴실, 상태, 요청 버튼)
  assert.equal(await page.locator('[data-req]').count(),0);assert.equal(await page.getByRole('button',{name:'직접 요청'}).count(),0);
  assert.equal(await page.locator('tr.b2-req-row').count(),10);
  assert.equal(await page.locator('.proposal-box.compact').count(),30);assert.equal(await page.locator('.proposal-box:not(.compact)').count(),0);
  const line=student(page,'가상지각').locator('tr.b2-req-row');
  for(const label of ['가상지각 추천 입실시간','가상지각 추천 퇴실시간','가상지각 입실·교시 사유 추천사유','가상지각 퇴실 사유 추천사유'])assert.equal(await line.getByLabel(label,{exact:true}).count(),1,label);
  assert.equal(await line.locator('.proposal-label').count(),3);assert.equal(await line.locator('[data-proposal-send]').count(),3);
  assert.deepEqual(await line.locator('textarea').evaluateAll(ts=>ts.map(t=>t.rows)),[1,1]);
  const heights=await page.locator('tr.b2-req-row').evaluateAll(rs=>rs.map(x=>Math.round(x.getBoundingClientRect().height)));
  assert.ok(Math.max(...heights)<=34,`one slim line per student: ${heights}`);
  assert.equal(await page.getByText(/자동 요청: 오늘 출결원장을 저장하면 3초 뒤/).count(),1,'the long explanation is one note above the table');
  // 추천값을 고치면 그 줄만 바뀌고(변경 필요·요청 켜짐), 출결원장 초안은 생기지 않음
  const memo=line.getByLabel('가상지각 퇴실 사유 추천사유',{exact:true});
  await memo.fill('가상 퇴실 사유');
  assert.equal(await memo.getAttribute('title'),'가상 퇴실 사유','the slim memo shows its full text in the tooltip');
  await line.locator('[data-proposal-box$="__exitMemo"] .proposal-label').getByText('변경 필요').waitFor();
  assert.equal(await line.locator('[data-proposal-send$="__exitMemo"]').isEnabled(),true);
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 0건 저장');
 },virtual());
});

// 같은 날 결석: 수업 중에는 교시가 늦게 찍힐 수 있어 실제 입실만 남은 기록을 '기록 있음'으로 보지만, 그 학생의 시간 삭제가 확인되면 맞는 것으로 봅니다(⚠가 남지 않게).
test('same-day 결석 compares as matching once the time deletion is verified (the actual entry stays)',async()=>{
 const VB2={...VB,ledger:[...VB.ledger,row(D,'1','가상출석','결석')]};
 const DAYS2={[CUR]:{records:VDAYS[CUR].records.map(r=>r.name==='가상출석'?{...r,entry:null,exit:null,version:'v-r6b'}:r)}};
 await beta(async page=>{
  await openLedger(page);
  await student(page,'가상출석').getByText('체크히어 입실 09:02 · 퇴실 - 기록 있음').waitFor();
  await pushRequests(page,[{id:'b2_00000000-0000-4000-8000-0000000000aa',classId:'1',date:D,name:'가상출석',phoneLast4:'0000',reason:'[실시간 베타] 출결대조 자동 · 결석 · 일반 출결 [기준:0123abcd]',changes:{exit:''},deleteTimes:['exit'],status:'verified',createdBy:ME,result:{message:'체크히어 반영·원본 확인·플랫폼 DB 저장 완료'}}]);
  await student(page,'가상출석').getByText('교시 기록·퇴실 없음 · 실제 입실 09:02 남음').waitFor();
  assert.equal(await student(page,'가상출석').locator('.b2-match.diff').count(),0);
 },{...virtual(body=>body.action==='b2Bundle'?{ok:true,data:VB2}:null),clock:'2026-11-05T15:00:00+09:00',days:DAYS2});
});

/* ---------- 모아 저장·얇은 직접 요청 줄 다듬기(검토 2026-10-19) ---------- */
test('the slim line follows the live request list so an auto request locks its box at once; Enter or a pasted line break never adds a hidden line; its buttons name the student and box; the header stays short',async()=>{
 await beta(async page=>{
  await openLedger(page);
  assert.doesNotMatch(await page.locator('.b2-head',{has:page.getByRole('heading',{name:'출결대조'})}).locator('p').innerText(),/3초|승인/,'approval is explained once, in the note above the table');
  // Enter: 한 줄 사유 칸에 줄바꿈 없이(일치·요청 꺼짐 그대로) 다음 학생 같은 칸으로
  const late=page.getByLabel('가상지각 입실·교시 사유 추천사유',{exact:true}),lateBox=student(page,'가상지각').locator('[data-proposal-box$="__entryMemo"]');
  assert.equal(await late.inputValue(),'지각_담임:가상담임(09:25)');assert.equal(await lateBox.locator('.proposal-label').innerText(),'일치');
  await late.press('Enter');
  assert.equal(await late.inputValue(),'지각_담임:가상담임(09:25)','no hidden line break');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'가상메모 입실·교시 사유 추천사유','Enter moves to the same box of the next student');
  assert.equal(await lateBox.locator('.proposal-label').innerText(),'일치');assert.equal(await page.getByRole('button',{name:'가상지각 추천사유 입실 변경요청'}).isDisabled(),true);
  await page.getByLabel('가상지각 추천 퇴실시간',{exact:true}).press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'가상메모 추천 퇴실시간','the time boxes move the same way');
  // 붙여 넣은 줄바꿈은 띄어쓰기로
  const exit=page.getByLabel('가상지각 퇴실 사유 추천사유',{exact:true});
  await exit.evaluate(el=>{el.focus();el.setSelectionRange(el.value.length,el.value.length);const dt=new DataTransfer();dt.setData('text/plain','가상 첫 줄\r\n가상 둘째 줄');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  assert.equal(await exit.inputValue(),'가상 첫 줄 가상 둘째 줄');assert.equal(await exit.getAttribute('title'),'가상 첫 줄 가상 둘째 줄');
  await page.getByRole('button',{name:'가상지각 추천사유 퇴실 변경요청'}).waitFor();assert.equal(await page.getByRole('button',{name:'가상지각 추천사유 퇴실 변경요청'}).isEnabled(),true);
  // 저장 3초 뒤 자동 요청이 구독에 보이면 그 학생의 직접 요청 칸은 바로 '승인 대기'로 잠깁니다(같은 칸에 두 번째 요청을 만들지 않음).
  await typeOf(page,'가상변경').selectOption('지각');
  await saveChanges(page);
  const box=student(page,'가상변경').locator('[data-proposal-box$="__entryMemo"]'),send=page.getByRole('button',{name:'가상변경 추천사유 입실 변경요청'});
  await box.locator('.proposal-label').getByText('변경 필요').waitFor();assert.equal(await send.isEnabled(),true);
  await chip(page,'가상변경').getByText('승인 대기').waitFor({timeout:8000});
  const sent=await requestWrites(page);assert.equal(sent.length,1);
  const {path,createdAt,updatedAt,...rest}=sent[0];
  await pushRequests(page,[{...rest,id:path.split('/')[1]}]);
  await box.locator('.proposal-label').getByText('승인 대기').waitFor();
  assert.equal(await send.isDisabled(),true);assert.equal(await box.locator('textarea').isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'가상변경 추천사유 입실 요청취소'}).count(),1,'my pending request can be withdrawn from the slim line');
  assert.equal(await page.evaluate(()=>window.sdkWrites.filter(w=>w[1].startsWith('checkhereRequests/')).length),1);
 },virtual());
});

test('a conflict whose latest ledger cannot be read keeps the draft and its base and does not claim a latest value; the next save reads it and shows it',async()=>{
 let fail=false,changed=false;// changed: 첫 저장 시도 뒤 다른 사람이 시트를 고친 것으로 둡니다
 const VB3={...VB,ledger:[...VB.ledger.filter(r=>r[2]!=='가상지각'),row(D,'1','가상지각','지각',{inT:'09:30',reason:'시트에서 고침',sig:'sig-changed'})]};
 await beta(async(page,posts)=>{
  await openLedger(page);
  const s=student(page,'가상지각');
  await setReason(s,'가상 교통');
  fail=true;await saveChanges(page);
  await s.getByText('그사이 바뀜 · 저장 안 됨 · 최신 값을 읽지 못했습니다 · 잠시 뒤 다시 저장해 주세요').waitFor();
  assert.equal(await s.getByText(/시트 최신 값|덮어씁니다/).count(),0,'the old value is not shown as the latest');
  assert.equal(await reasonText(s),'가상 교통');assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장');
  fail=false;await saveChanges(page);
  await s.getByText('그사이 바뀜 · 저장 안 됨 · 시트 최신 값 지각 · 입실 09:30 · 시트에서 고침 · 다시 저장하면 이 값으로 덮어씁니다').waitFor();
  assert.deepEqual(savesOf(posts,'가상지각').map(x=>x.before),['sig-가상지각-2026-11-05','sig-가상지각-2026-11-05'],'the base only moves after the latest row was read');
 },virtual(body=>{
  if(body.action==='b2Save'){changed=true;return {ok:false,error:'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'};}
  if(body.action==='b2Bundle'&&fail)return {ok:false,error:'가상 묶음 읽기 실패'};
  if(body.action==='b2Bundle'&&changed)return {ok:true,data:VB3};
  return null;
 }));
});

test('a reason and an evidence change in one row go in one batch save; the evidence select is locked while it runs and a failed save keeps both drafts',async()=>{
 await beta(async(page,posts)=>{
  await openLedger(page);
  const s=student(page,'가상증빙'),ev=s.locator('select[data-inline="ev"]');
  await setReason(s,'병원 진료 2');
  await ev.selectOption('확인');
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장','one row, one draft');
  await page.locator('#b2SaveAll').click();
  await page.locator('#b2SaveAll').getByText('저장 중 1/1').waitFor();
  assert.equal(await ev.isDisabled(),true,'locked while the batch save runs');
  await page.waitForFunction(()=>/^변경 \d+건 저장$/.test(document.querySelector('#b2SaveAll')?.textContent||''),null,{timeout:15000});
  await s.getByText(/가상 저장 실패/).waitFor();
  assert.equal(await ev.inputValue(),'확인','the chosen evidence stays');assert.equal(await ev.isEnabled(),true);
  assert.equal(await reasonText(s),'병원 진료 2');
  assert.deepEqual(savesOf(posts,'가상증빙').map(x=>[x.reason,x.ev,x.evr]),[['병원 진료 2','확인','']],'reason and evidence in one save');
 },virtual(async body=>{if(body.action==='b2Save'){await new Promise(r=>setTimeout(r,1500));return {ok:false,error:'가상 저장 실패'};}return null;}));
});
