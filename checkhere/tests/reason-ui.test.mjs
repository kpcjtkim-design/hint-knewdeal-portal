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

test('출결대조 사유 칸: 240px 안에 분류·세부(인적성 종류) 드롭다운, 직접 입력, 취업박람회 추가 증빙 배지·거르기·증빙 확인',async()=>{
 await page('/ledger.html',async(p,posts)=>{
  const row=n=>p.locator(`tbody[data-student="${n}"] tr[data-name]`),go=row('고다원'),dong=row('김동진'),park=row('박서연');
  await go.locator('select[data-inline="rcat"]').waitFor();
  // 저장된 글이 드롭다운 위치로: 인적성 · HMAT
  assert.equal(await go.locator('[data-inline="rcat"]').inputValue(),'인적성');assert.equal(await go.locator('[data-inline="rsub"]').inputValue(),'HMAT');
  assert.equal(await go.locator('[data-inline="rsub"]').getAttribute('aria-label'),'고다원 인적성 종류');
  assert.ok((await go.locator('[data-inline="rsub"] option').allTextContents()).includes('L-TAB(롯데)'));
  // 240px 안: 드롭다운 두 개가 한 줄, 사유 글이 그 아래 한 줄
  const box=await go.locator('.b2-rpick').boundingBox(),cat=await go.locator('[data-inline="rcat"]').boundingBox(),sub=await go.locator('[data-inline="rsub"]').boundingBox(),txt=await go.locator('[data-inline="reason"]').boundingBox();
  assert.ok(box.width<=240.5,`width ${box.width}`);assert.equal(Math.round(cat.y),Math.round(sub.y));assert.ok(txt.y>cat.y);assert.ok(Math.abs(txt.width-box.width)<1);
  // 출석 기본 행(기록 없음)은 사유를 저장하지 않으므로 드롭다운도 없습니다.
  assert.equal(await park.locator('[data-inline="rcat"]').count(),0);
  // 취업박람회 인정조퇴(증빙 미제출): 배지와 '추가 증빙' 거르기
  assert.equal(await dong.locator('.e-extra').textContent(),'추가 증빙 필요 · 기업면접 확인서 · 미제출');
  assert.equal(await dong.locator('.b2-xnote').count(),0,'the saved badge already says it, no second notice');
  const chip=p.locator('[data-filter="extra"]');assert.equal(await chip.textContent(),'추가 증빙1');
  await chip.click();assert.deepEqual(await p.locator('tbody tr[data-name]').evaluateAll(rs=>rs.map(r=>r.dataset.name)),['김동진']);
  await p.locator('[data-filter="all"]').click();
  // 종류 바꾸기 → '인적성(GSAT)', 기타 → 괄호 안에 직접
  await go.locator('[data-inline="rsub"]').selectOption('GSAT');
  assert.equal(await go.locator('[data-inline="reason"]').inputValue(),'인적성(GSAT)');assert.equal(await p.locator('#b2SaveAll').textContent(),'변경 1건 저장');
  await go.locator('[data-inline="rsub"]').selectOption('기타');
  assert.equal(await go.locator('[data-inline="reason"]').inputValue(),'인적성()');
  await p.keyboard.type('DCAT');assert.equal(await go.locator('[data-inline="reason"]').inputValue(),'인적성(DCAT)');
  assert.equal(await go.locator('[data-inline="rsub"]').inputValue(),'기타','typing keeps the dropdowns in step');
  // 인정 출결에 인정 분류가 아닌 것(교통)은 짧은 안내, Esc로 되돌림
  await dong.locator('[data-inline="rcat"]').selectOption('교통');
  assert.equal(await dong.locator('[data-inline="reason"]').inputValue(),'교통');assert.match(await dong.innerText(),/교통은 보통 인정 사유가 아닙니다/);
  assert.equal(await dong.locator('.b2-xnote').count(),0);
  await dong.locator('[data-inline="reason"]').press('Escape');assert.equal(await dong.locator('[data-inline="reason"]').inputValue(),'취업박람회');
  // 기록 없는 학생: 결석 → 취업박람회(인정 아님 안내) → 인정출석
  await park.locator('[data-inline="type"]').selectOption('결석');
  await park.locator('[data-inline="rcat"]').selectOption('취업박람회');
  assert.equal(await park.locator('[data-inline="reason"]').inputValue(),'취업박람회');assert.equal(await park.locator('.b2-xnote').textContent(),'추가 증빙 필요 · 기업면접 확인서 (인정 출결일 때)');
  await park.locator('[data-inline="type"]').selectOption('인정출석');assert.equal(await park.locator('.b2-xnote').textContent(),'추가 증빙 필요 · 기업면접 확인서');
  // 직접 쓰면 '기타 (직접 입력)', 다시 분류를 고르면 표준 글
  await park.locator('[data-inline="reason"]').fill('가족 돌봄');assert.equal(await park.locator('[data-inline="rcat"]').inputValue(),'기타');
  await park.locator('[data-inline="rcat"]').selectOption('취업박람회');
  // 모아 저장: 빈 괄호는 지우고 표준 글 그대로
  await p.locator('#b2SaveAll').click();await p.locator('#b2BulkNote').getByText('2건 저장',{exact:true}).waitFor();
  const saved=posts.filter(b=>b.action==='b2Save').map(b=>[b.args[0].name,b.args[0].type,b.args[0].reason]);
  assert.deepEqual(saved,[['고다원','인정출석','인적성(DCAT)'],['박서연','인정출석','취업박람회']]);
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
