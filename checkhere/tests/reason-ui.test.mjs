import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

// 사유 드롭다운(사용자 요청 2026-10-20 ①②③): 담임 출결판 사유 칸(teacher-beta.js)과 출결 현황 › 증빙서류(beta2-status.mjs)를 작은 시험 페이지에 띄워 봅니다. 가상 학생만 씁니다.
const base=join(import.meta.dirname,'../..');
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const PORTAL={cls:1,region:'수도권',course:'과정1',teacher:'김지아',place:'본관',mainDay:'2026-11-05',days:['2026-11-05','2026-11-04'],week:[],summary:[{k:'총원',v:2}],
 kids:[{name:'고다원',status:'재학',off:''},{name:'김동진',status:'재학',off:''}],
 recs:{'고다원|2026-11-05':{type:'인정출석',inT:'',outT:'',oa:'',ob:'',r:'인적성(HMAT)',ev:'',evr:''},'김동진|2026-11-04':{type:'인정조퇴',inT:'',outT:'15:00',oa:'',ob:'',r:'취업박람회',ev:'',evr:''}},closed:'미확인',officer:{}};
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,reason:'',ev:'',evr:'',evApplied:type.startsWith('인정')?(o.ev||'미제출'):'해당없음',prov:'포털',sig:'s',...o})[k]??'');
const RAW={rev:3,today:'2026-11-06',days:['2026-11-04','2026-11-05','2026-11-06'],classes:[{id:'1',teacher:'김지아'},{id:'2',teacher:''}],roster:[['1','고다원','재학',''],['1','김동진','재학',''],['2','이경수','재학','']],ledgerCols:COLS,
 ledger:[L('2026-11-04','1','고다원','인정출석',{reason:'취업박람회',ev:'확인'}),L('2026-11-05','1','김동진','인정조퇴',{reason:'취업박람회(현장 면접)',outT:'15:00'}),L('2026-11-05','2','이경수','인정지각',{reason:'인적성(GSAT)',inT:'10:00'}),L('2026-11-06','2','이경수','인정출석',{reason:'취업박람회',ev:'반려',evr:'날짜 없음'})]};
// 17반 테스트반·교육일 아닌 날(사용자 2026-10-20): 실제 반의 개강 전 인정 기록은 안내 한 줄로만, 테스트반은 기록 있는 날이 모두 교육일이라 목록에 '17반 · 테스트반'으로
const RAW_T={rev:4,today:'2026-11-06',days:['2026-11-04','2026-11-05','2026-11-06'],classes:[{id:'1',teacher:'김지아'},{id:'17',teacher:''}],roster:[['1','고다원','재학',''],['17','시험가','재학',''],['17','시험나','재학','']],ledgerCols:COLS,
 ledger:[L('2026-10-20','1','고다원','인정출석',{reason:'병원'}),L('2026-11-05','1','고다원','인정지각',{reason:'교통',inT:'10:00'}),
  ...['2026-10-17','2026-10-18','2026-10-19','2026-10-20'].map(d=>L(d,'17','시험가','인정출석',{reason:'병원 진료'}))]};
// 출결대조(beta2-ledger.mjs): 진짜 2기 클라이언트(beta2-data.mjs)가 가짜 /api/teacher-beta와 이야기합니다. 지난 날(11/5)이라 체크히어 자동 요청은 없습니다.
const LEDGER={rev:7,today:'2026-11-06',days:['2026-11-05','2026-11-06'],classes:[{id:'1',teacher:'김지아'}],roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','박서연','재학','']],ledgerCols:COLS,
 ledger:[L('2026-11-05','1','고다원','인정출석',{reason:'인적성(HMAT)',sig:'sig-고다원'}),L('2026-11-05','1','김동진','인정조퇴',{reason:'취업박람회',outT:'15:00',sig:'sig-김동진'})]};
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const SDK_STUB=`window.sdkWrites=window.sdkWrites||[];const snap=d=>({exists:()=>d!==undefined,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=c=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...v)=>v;
export const getDoc=async()=>snap(undefined),getDocFromServer=async()=>snap(undefined),getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const PAGES={
 '/ledger.html':`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="root"></div><script type="module">import {mount} from '/beta2-ledger.mjs';import {createBeta2Client} from '/beta2-data.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';import {setNotifyContext} from '/notify.mjs';ensureBeta2Css();
  const user={email:'hint.kpc@gmail.com',getIdToken:async()=>'tok'};setNotifyContext({db:{},user});window.view=await mount(document.getElementById('root'),{db:{},user,classes:[{id:'1'}],client:createBeta2Client(user,{db:{}}),selected:'1',context:{classId:'1',date:'2026-11-05'}});</script>`,
 '/teacher-notify.html':`<!doctype html><meta charset="utf-8"><div id="toast"></div><div id="root"></div><script type="module">import {mountTeacherBeta} from '/teacher-beta.js';import {setNotifyContext} from '/notify.mjs';setNotifyContext({db:{},user:{email:'teacher@test.kr'}});window.tb=mountTeacherBeta(document.getElementById('root'),{cls:1,tab:'board',endpoint:'/api/teacher-beta'});</script>`,
 '/teacher.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mountTeacherBeta} from '/teacher-beta.js';window.notes=[];window.tb=mountTeacherBeta(document.getElementById('root'),{cls:1,tab:'board',endpoint:'/api/teacher-beta',notify:(n,sel,f)=>window.notes.push({...n,name:sel.n,date:sel.day,r:f.r})});</script>`,
 '/status-test.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mount} from '/beta2-status.mjs';import {decodeBundle} from '/beta2-core.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';ensureBeta2Css();
  window.view=await mount(document.getElementById('root'),{client:{bundle:async()=>decodeBundle(${JSON.stringify(RAW_T)}),checkhereDisease:async()=>({})},classes:[{id:'1'},{id:'17'}],tab:'evidence'});</script>`,
 '/status.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mount} from '/beta2-status.mjs';import {decodeBundle} from '/beta2-core.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';ensureBeta2Css();
  window.view=await mount(document.getElementById('root'),{client:{bundle:async()=>decodeBundle(${JSON.stringify(RAW)}),checkhereDisease:async()=>({})},classes:[{id:'1'},{id:'2'}],tab:'evidence'});</script>`};

async function page(path,run){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage(),errors=[],posts=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  let rev=LEDGER.rev;
  await p.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(PAGES[url.pathname])return route.fulfill({contentType:'text/html;charset=utf-8',body:PAGES[url.pathname]});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON(),a=body.args?.[0];posts.push(body);
    const data=body.action==='portalData'?PORTAL:body.action==='b2Bundle'?{...LEDGER,rev}:body.action==='b2Rev'?{rev,sync:{}}:body.action==='b2Save'?{ok:true,rev:++rev,sig:`sig-${a.name}-${rev}`,memo:'',evApplied:a.ev||(a.type.startsWith('인정')?'미제출':'해당없음'),check:''}:{ok:true};
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
const saves=posts=>posts.filter(b=>b.action==='portalSave').map(b=>b.args[0]);

test('teacher 사유: 분류 → 세부·인적성 종류 드롭다운이 표준 글을 만들고, 직접 입력·저장된 글도 그대로 고칩니다',async()=>{
 await page('/teacher.html',async(p,posts)=>{
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();
  // 저장된 '인적성(HMAT)'은 분류 인적성 · 종류 HMAT로 보입니다.
  await p.waitForSelector('#rc');
  assert.equal(await p.locator('#rc').inputValue(),'인적성');assert.equal(await p.locator('#rs').inputValue(),'HMAT');assert.equal(await p.locator('#r').inputValue(),'인적성(HMAT)');
  assert.equal(await p.locator('#rs').getAttribute('aria-label'),'인적성 종류');
  assert.deepEqual(await p.locator('#rs option').allTextContents(),['종류 고르기','HMAT(현대차그룹)','GSAT(삼성)','SKCT(SK)','LG Way Fit','CJ CAT','L-TAB(롯데)','PAT(포스코)','KT','NCS(공기업)','AI역량검사','기타 (직접 입력)']);
  const cats=await p.locator('#rc option').allTextContents();
  for(const l of ['병원·질병','면접','인적성','취업박람회','예비군·민방위','시험(자격증·어학)','경조사','공가(관공서·법원)','교통 (인정 아님)','취업활동(설명회·상담) (인정 아님)','개인사정 (인정 아님)','기타 (직접 입력)'])assert.ok(cats.includes(l),l);
  // 종류를 바꾸면 '인적성(GSAT)'으로 저장(입력이 멈추면 0.7초 뒤)
  await p.locator('#rs').selectOption('GSAT');assert.equal(await p.locator('#r').inputValue(),'인적성(GSAT)');
  await p.waitForFunction(()=>document.querySelector('#root').shadowRoot.querySelector('#st').textContent.startsWith('저장'));
  await p.waitForTimeout(900);assert.equal(saves(posts).at(-1).r,'인적성(GSAT)');
  // 기타(직접 입력): 괄호 안에 바로 적고 Enter로 저장
  await p.locator('#rs').selectOption('기타');assert.equal(await p.locator('#r').inputValue(),'인적성()');
  await p.keyboard.type('DCAT');await p.keyboard.press('Enter');
  await p.waitForTimeout(400);assert.equal(saves(posts).at(-1).r,'인적성(DCAT)');
  assert.equal(await p.locator('#rs').inputValue(),'기타');
  // 다른 분류: 병원 → 첫 세부, 세부 고르기
  await p.locator('#rc').selectOption('병원');assert.equal(await p.locator('#r').inputValue(),'병원');
  await p.locator('#rs').selectOption('병원(치과)');assert.equal(await p.locator('#r').inputValue(),'병원(치과)');
  await p.waitForTimeout(900);assert.equal(saves(posts).at(-1).r,'병원(치과)');
  // 직접 쓰면 분류는 '기타 (직접 입력)'
  await p.locator('#r').fill('가족 돌봄');assert.equal(await p.locator('#rc').inputValue(),'기타');assert.equal(await p.locator('#rs').count(),0);
  await p.locator('#r').press('Enter');await p.waitForTimeout(400);assert.equal(saves(posts).at(-1).r,'가족 돌봄');
  // 빠른 단추도 드롭다운을 맞춥니다
  await p.locator('[data-q="교통사정"]').click();assert.equal(await p.locator('#rc').inputValue(),'교통');assert.equal(await p.locator('#rs').inputValue(),'교통사정');
  assert.equal(await p.evaluate(()=>window.notes.length),0,'no extra-evidence notice for other reasons');
 });
});

test('teacher 취업박람회: 추가 증빙 안내·배지, 저장하면 담임·관리자 알림 한 번, 출결사유에서 미이행만 거르기',async()=>{
 await page('/teacher.html',async(p,posts)=>{
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await p.waitForSelector('#rc');
  assert.equal(await p.locator('.xn').count(),0);
  await p.locator('#rc').selectOption('취업박람회');assert.equal(await p.locator('#r').inputValue(),'취업박람회');
  assert.match(await p.locator('.xn').textContent(),/취업박람회는 추가 증빙이 필요합니다 · 기업면접 확인서/);
  assert.equal(await p.locator('.xn .xb').textContent(),'추가 증빙 필요 · 기업면접 확인서 · 미제출');
  await p.waitForFunction(()=>window.notes.length===1);
  assert.deepEqual(await p.evaluate(()=>window.notes[0]),{title:'추가 증빙 필요 · 1반 고다원',body:'11/5 인정출석 취업박람회 · 기업면접 확인서 제출이 필요합니다.',name:'고다원',date:'2026-11-05',r:'취업박람회'});
  assert.equal(saves(posts).at(-1).r,'취업박람회');
  // 세부를 바꿔도(이미 필요) 알림은 다시 남기지 않습니다.
  await p.locator('#rs').selectOption('취업박람회(현장 면접)');await p.waitForTimeout(900);
  assert.equal(saves(posts).at(-1).r,'취업박람회(현장 면접)');assert.equal(await p.evaluate(()=>window.notes.length),1);
  // 인정이 아닌 결석이면 안내만(이행 추적 없음)
  await p.locator('[data-t="결석"]').click();await p.waitForTimeout(300);
  assert.match(await p.locator('.xn').textContent(),/인정출석·인정지각·인정조퇴·인정외출일 때/);assert.equal(await p.locator('.xn .xb').count(),0);
  await p.locator('[data-t="인정출석"]').click();await p.waitForTimeout(300);
  assert.equal(await p.evaluate(()=>window.notes.length),2,'결석 → 인정출석 needs the document again');
  // 출결사유: 추가 증빙 거르기와 배지
  await p.evaluate(()=>window.tb.setTab('reason'));
  assert.equal(await p.locator('#xev').textContent(),'추가 증빙 · 취업박람회 2');
  await p.locator('#xev').click();
  assert.deepEqual(await p.locator('tr.click td:nth-child(2)').allTextContents(),['고다원','김동진']);
  assert.deepEqual(await p.locator('tr.click .xb').allTextContents(),['추가 증빙 필요 · 기업면접 확인서','추가 증빙 필요 · 기업면접 확인서']);
  await p.locator('#all').click();assert.equal(await p.locator('#xev').getAttribute('aria-pressed'),'false');
 });
});

test('출결 현황 › 증빙서류: 취업박람회 추가 증빙 배지와 이행 여부 목록(미이행/전체)',async()=>{
 await page('/status.html',async p=>{
  await p.waitForSelector('[data-extra="open"]');
  const stat=await p.locator('.b2-stat').allTextContents();assert.ok(stat.includes('2추가 증빙 미이행'),stat.join('|'));
  // 증빙 목록: 사유 칸, 취업박람회 줄에 '추가 증빙 필요 · 기업면접 확인서'
  const ev=p.locator('.b2-table').first();
  assert.deepEqual(await ev.locator('thead th').allTextContents(),['반','이름','교육일','유형','사유','서류 상태','반려 사유']);
  assert.deepEqual(await ev.locator('.e-extra').allTextContents(),['추가 증빙 필요 · 기업면접 확인서 · 미제출','추가 증빙 필요 · 기업면접 확인서 · 반려']);
  const extra=p.locator('.b2-table').nth(1);
  assert.deepEqual(await extra.locator('tbody tr td:nth-child(2)').allTextContents(),['김동진','이경수']);
  assert.match(await p.locator('.b2-note.warn').first().textContent(),/기업면접 확인서/);
  await p.locator('[data-extra="all"]').click();
  assert.deepEqual(await p.locator('.b2-table').nth(1).locator('tbody tr td:nth-child(6)').allTextContents(),['추가 증빙 필요 · 기업면접 확인서 · 미제출','추가 증빙 필요 · 기업면접 확인서 · 반려 반려: 날짜 없음','추가 증빙 확인']);
  await p.selectOption('#s2Class','2');
  assert.deepEqual(await p.locator('.b2-table').nth(1).locator('tbody tr td:nth-child(2)').allTextContents(),['이경수']);
 });
});

test('출결 현황: 실제 반 교육일 아닌 날 인정 기록은 안내 한 줄만, 17반 테스트반은 개강 전 기록도 증빙서류·질병 인정 목록에(전체 반에도, 숫자 상자는 빼고)',async()=>{
 await page('/status-test.html',async p=>{
  const main=n=>p.locator('#s2Body > .b2-table-wrap .b2-table').nth(n),col=(n,i)=>main(n).locator(`tbody tr td:nth-child(${i})`).allTextContents();
  await p.waitForSelector('#s2OffDay');
  assert.match(await p.locator('#s2OffDay summary').textContent(),/교육일이 아닌 날의 인정 기록 1건은 통계·증빙에 들지 않습니다/);
  assert.deepEqual(await p.locator('#s2OffDay tbody tr td:nth-child(3)').allTextContents(),['10/20(화)'],'펼치면 목록');
  assert.deepEqual(await col(0,1),['1반','17반 · 테스트반','17반 · 테스트반','17반 · 테스트반','17반 · 테스트반']);
  assert.deepEqual(await col(0,3),['11/5(목)','10/17(토)','10/18(일)','10/19(월)','10/20(화)'],'실제 반 10/20 기록은 목록에 없음');
  const stat=await p.locator('.b2-stat').allTextContents();assert.ok(stat.includes('1미제출')&&stat.includes('1학생'),stat.join('|'));
  assert.match(await p.locator('#s2Body').textContent(),/테스트반 증빙 미제출·반려 4건은 목록에만 보이고 위 숫자에는 넣지 않았습니다/);
  await p.selectOption('#s2Class','17');
  assert.deepEqual(await col(0,2),['시험가','시험가','시험가','시험가']);
  assert.equal(await p.locator('#s2OffDay').count(),0);
  assert.ok((await p.locator('.b2-stat').allTextContents()).includes('4미제출'));
  await p.selectOption('#s2Class','all');
  await p.evaluate(()=>window.view.setView('disease'));
  await p.waitForSelector('#s2Body > .b2-table-wrap');
  assert.deepEqual(await col(0,1),['17반 · 테스트반']);assert.deepEqual(await col(0,3),['4/6회']);
  assert.ok((await p.locator('.b2-stat').allTextContents()).includes('04회 이상'),'공식 숫자 상자는 테스트반 제외');
  assert.match(await p.locator('#s2Body').textContent(),/테스트반 질병 인정 4회 이상 1건은 목록에만/);
  await p.evaluate(()=>window.view.setView('stats'));
  assert.deepEqual(await col(0,1),['1반'],'출결 통계 전체 합계에는 테스트반 없음');
 });
});

test('출결대조 사유 칸 = 드롭다운 하나(240px): 지금까지 쓴 사유, 인적성은 바로 옆 종류, 기타는 직접 입력, 모아 저장, 취업박람회 추가 증빙 배지·거르기·알림',async()=>{
 await page('/ledger.html',async(p,posts)=>{
  const row=n=>p.locator(`tbody[data-student="${n}"] tr[data-name]`),go=row('고다원'),dong=row('김동진'),park=row('박서연');
  const main=r=>r.locator('select[data-inline="rmain"]'),sub=r=>r.locator('select[data-inline="rsub"]'),free=r=>r.locator('input[data-inline="reason"]');
  await main(go).waitFor();
  // 저장된 '인적성(HMAT)': 사유 드롭다운 '인적성', 바로 옆 종류 드롭다운 'HMAT', 직접 입력 칸 없음
  assert.equal(await main(go).inputValue(),'인적성');assert.equal(await sub(go).inputValue(),'HMAT');assert.equal(await free(go).count(),0);
  assert.equal(await sub(go).getAttribute('aria-label'),'고다원 인적성 종류');
  assert.deepEqual(await sub(go).locator('option').allTextContents(),['종류 고르기','HMAT(현대차그룹)','GSAT(삼성)','SKCT(SK)','LG Way Fit','CJ CAT','L-TAB(롯데)','PAT(포스코)','KT','NCS(공기업)','AI역량검사','기타 (직접 입력)']);
  const groups=await main(go).locator('optgroup').evaluateAll(g=>g.map(x=>x.label));
  assert.deepEqual(groups,['병원·질병','면접','인적성','취업박람회','예비군·민방위','시험(자격증·어학)','경조사','공가(관공서·법원)','교통 (인정 아님)','취업활동(설명회·상담) (인정 아님)','개인사정 (인정 아님)']);
  const values=await main(go).locator('option').evaluateAll(o=>o.map(x=>x.value));
  for(const v of ['병원','병원(치과)','병결','면접(최종)','인적성','취업박람회','예비군','민방위','시험(자격증)','조모상','공가(법원 출석)','교통사정','개인일정','기타'])assert.ok(values.includes(v),v);
  // 240px 안, 종류 드롭다운은 같은 줄 바로 옆
  const box=await go.locator('.b2-rpick').boundingBox(),a=await main(go).boundingBox(),b=await sub(go).boundingBox();
  assert.ok(box.width<=240.5,`width ${box.width}`);assert.equal(Math.round(a.y),Math.round(b.y));assert.ok(b.x>a.x);
  // 출석 기본 행(기록 없음)은 사유 드롭다운이 잠김
  assert.equal(await main(park).isDisabled(),true);
  // 취업박람회 인정조퇴(증빙 미제출): 배지와 '추가 증빙' 거르기(저장된 배지가 있으면 같은 안내를 또 보이지 않음)
  assert.equal(await main(dong).inputValue(),'취업박람회');assert.equal(await sub(dong).count(),0);
  assert.equal(await dong.locator('.e-extra').textContent(),'추가 증빙 필요 · 기업면접 확인서 · 미제출');assert.equal(await dong.locator('.b2-xnote').count(),0);
  const chip=p.locator('[data-filter="extra"]');assert.equal(await chip.textContent(),'추가 증빙1');
  await chip.click();assert.deepEqual(await p.locator('tbody tr[data-name]').evaluateAll(rs=>rs.map(r=>r.dataset.name)),['김동진']);
  await p.locator('[data-filter="all"]').click();
  // 종류 바꾸기 → '인적성(GSAT)' 초안, 종류 기타 → 바로 옆 직접 입력 칸
  await sub(go).selectOption('GSAT');assert.equal(await p.locator('#b2SaveAll').textContent(),'변경 1건 저장');
  await sub(go).selectOption('기타');
  const apt=go.locator('input[data-inline="rapt"]');assert.equal(await apt.evaluate(e=>e===document.activeElement),true,'the type box takes focus');
  await p.keyboard.type('DCAT');assert.equal(await sub(go).inputValue(),'기타');assert.equal(await main(go).inputValue(),'인적성');
  // 인정 출결에 인정 분류가 아닌 것(교통)은 짧은 안내, Esc로 되돌림
  await main(dong).selectOption('교통');assert.match(await dong.innerText(),/교통은 보통 인정 사유가 아닙니다/);
  await main(dong).press('Escape');assert.equal(await main(dong).inputValue(),'취업박람회');
  // 기록 없는 학생: 결석 → 취업박람회(인정 아님 안내) → 인정출석
  await park.locator('[data-inline="type"]').selectOption('결석');
  await main(park).selectOption('취업박람회');assert.equal(await park.locator('.b2-xnote').textContent(),'추가 증빙 필요 · 기업면접 확인서 (인정 출결일 때)');
  await park.locator('[data-inline="type"]').selectOption('인정출석');assert.equal(await park.locator('.b2-xnote').textContent(),'추가 증빙 필요 · 기업면접 확인서');
  // 목록에 없으면 '기타' → 직접 입력 칸(표준 글이던 칸은 비움), 다시 목록에서 고르면 칸이 사라짐
  await main(park).selectOption('기타');assert.equal(await free(park).inputValue(),'');assert.equal(await free(park).evaluate(e=>e===document.activeElement),true);
  await free(park).fill('가족 돌봄');assert.equal(await main(park).inputValue(),'기타');
  await main(park).selectOption('취업박람회');assert.equal(await free(park).count(),0);
  // 모아 저장: 빈 괄호 없이 표준 글
  await p.locator('#b2SaveAll').click();await p.locator('#b2BulkNote').getByText('2건 저장',{exact:true}).waitFor();
  assert.deepEqual(posts.filter(b=>b.action==='b2Save').map(b=>[b.args[0].name,b.args[0].type,b.args[0].reason]),[['고다원','인정출석','인적성(DCAT)'],['박서연','인정출석','취업박람회']]);
  // 저장된 '인적성(DCAT)'은 종류 기타 + 'DCAT'
  assert.equal(await sub(go).inputValue(),'기타');assert.equal(await go.locator('input[data-inline="rapt"]').inputValue(),'DCAT');
  await park.locator('.e-extra').waitFor();assert.equal(await p.locator('[data-filter="extra"]').textContent(),'추가 증빙2');
  // 증빙 편집기: 취업박람회 안내, 「확인」으로 저장하면 이행
  await dong.locator('[data-edit]').click();
  assert.match(await p.locator('.b2-editor').innerText(),/취업박람회 · 추가 증빙 기업면접 확인서까지 받았으면 「확인」/);
  await p.locator('.b2-editor [data-f="ev"]').selectOption('확인');await p.locator('.b2-editor [data-save]').click();
  await dong.locator('.b2-badge.e-ok',{hasText:'추가 증빙 확인'}).waitFor();
  assert.equal(await p.locator('[data-filter="extra"]').textContent(),'추가 증빙1');
  assert.deepEqual(posts.filter(b=>b.action==='b2Save').at(-1).args[0].ev,'확인');
  const sent=await p.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='set'&&w[1].startsWith('notifications/')).map(w=>w[2]));
  assert.equal(sent.length,1,JSON.stringify(sent));
  const n=sent[0];assert.equal(n.kind,'추가 증빙');assert.equal(n.title,'추가 증빙 필요 · 1반 박서연');assert.equal(n.body,'11/5 인정출석 취업박람회 · 기업면접 확인서 제출이 필요합니다.');
  assert.equal(n.toRole,'admin');assert.equal(n.toClass,'1');assert.equal(n.cls,'1');assert.equal(n.link,'#b2ledger?cls=1&date=2026-11-05');assert.equal(n.from,'hint.kpc@gmail.com');
 });
});

test('teacher 취업박람회 저장은 실제 알림 모듈(notify.mjs)로 반 담임·관리자 알림 한 건을 남깁니다',async()=>{
 await page('/teacher-notify.html',async p=>{
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await p.waitForSelector('#rc');
  await p.locator('#rc').selectOption('취업박람회');
  await p.waitForFunction(()=>(window.sdkWrites||[]).some(w=>w[1].startsWith('notifications/')));
  const n=await p.evaluate(()=>window.sdkWrites.find(w=>w[1].startsWith('notifications/'))[2]);
  assert.equal(n.kind,'추가 증빙');assert.equal(n.title,'추가 증빙 필요 · 1반 고다원');assert.equal(n.toRole,'admin');assert.equal(n.toClass,'1');assert.equal(n.link,'#b2ledger?cls=1&date=2026-11-05');assert.equal(n.from,'teacher@test.kr');
  assert.ok(n.to.length>0&&!n.to.includes('teacher@test.kr'),'administrators are named, the sender is not');
 });
});
