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
 '/teacher17.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mountTeacherBeta} from '/teacher-beta.js';window.notes=[];window.tb=mountTeacherBeta(document.getElementById('root'),{cls:17,tab:'board',endpoint:'/api/teacher-beta',notify:()=>{}});</script>`,
 '/status-test.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mount} from '/beta2-status.mjs';import {decodeBundle} from '/beta2-core.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';ensureBeta2Css();
  window.view=await mount(document.getElementById('root'),{client:{bundle:async()=>decodeBundle(${JSON.stringify(RAW_T)}),checkhereDisease:async()=>({})},classes:[{id:'1'},{id:'17'}],tab:'evidence'});</script>`,
 '/status.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mount} from '/beta2-status.mjs';import {decodeBundle} from '/beta2-core.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';ensureBeta2Css();
  window.view=await mount(document.getElementById('root'),{client:{bundle:async()=>decodeBundle(${JSON.stringify(RAW)}),checkhereDisease:async()=>({})},classes:[{id:'1'},{id:'2'}],tab:'evidence'});</script>`};

async function page(path,run,{portal=PORTAL,ledger=LEDGER}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage(),errors=[],posts=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  let rev=ledger.rev;
  await p.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(PAGES[url.pathname])return route.fulfill({contentType:'text/html;charset=utf-8',body:PAGES[url.pathname]});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON(),a=body.args?.[0];posts.push(body);
    const data=body.action==='portalData'?portal:body.action==='b2Bundle'?{...ledger,rev}:body.action==='b2Rev'?{rev,sync:{}}:body.action==='b2Save'?{ok:true,rev:++rev,sig:`sig-${a.name}-${rev}`,memo:'',evApplied:a.ev||(a.type.startsWith('인정')?'미제출':'해당없음'),check:''}:{ok:true};
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

// 담임 사유 칸 = 관리자 출결대조와 같은 공용 도우미(reason-pick.mjs, 사용자 2026-10-20 '담임화면에서도 사유 부분 드롭다운은 관리자 화면 급으로 동일하게')
const T={main:p=>p.locator('#rp select[data-inline="rmain"]'),sub:p=>p.locator('#rp select[data-inline="rsub"]'),free:p=>p.locator('#rp input[data-inline="reason"]'),apt:p=>p.locator('#rp input[data-inline="rapt"]')};
const shadowFocus=p=>p.evaluate(()=>document.querySelector('#root').shadowRoot.activeElement?.dataset.inline||'');
async function saved(p,posts,n){for(let i=0;i<50&&saves(posts).length<n;i++)await p.waitForTimeout(100);return saves(posts).at(-1);}
test('teacher 사유 = 관리자와 같은 드롭다운 하나: 인적성은 바로 옆 종류, 기타는 직접 입력, 빠른 사유도 목록 값, 체크히어 메모 추천이 고르는 대로 바뀜',async()=>{
 await page('/teacher.html',async(p,posts)=>{
  const {main,sub,free,apt}=T,mm=p.locator('#mm');
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await main(p).waitFor();
  // 저장된 '인적성(HMAT)'은 사유 드롭다운 '인적성' + 바로 옆 종류 'HMAT', 직접 입력 칸 없음(관리자 출결대조와 같은 모양)
  assert.equal(await main(p).inputValue(),'인적성');assert.equal(await sub(p).inputValue(),'HMAT');assert.equal(await free(p).count(),0);
  assert.equal(await main(p).getAttribute('aria-label'),'고다원 사유');assert.equal(await sub(p).getAttribute('aria-label'),'고다원 인적성 종류');
  assert.deepEqual(await sub(p).locator('option').allTextContents(),['종류 고르기','HMAT(현대차그룹)','GSAT(삼성)','SKCT(SK)','LG Way Fit','CJ CAT','L-TAB(롯데)','PAT(포스코)','KT','NCS(공기업)','AI역량검사','기타 (직접 입력)']);
  assert.deepEqual(await main(p).locator('optgroup').evaluateAll(g=>g.map(x=>x.label)),['병원·질병','면접','인적성','취업박람회','예비군·민방위','자격증 시험','경조사','공가(관공서·법원)','(인정 안 됨) 교통','(인정 안 됨) 취업활동','(인정 안 됨) 개인사정']);
  const a=await main(p).boundingBox(),b=await sub(p).boundingBox();assert.equal(Math.round(a.y),Math.round(b.y),'the type box sits right beside');assert.ok(b.x>a.x);
  assert.equal(await mm.textContent(),'(인정출석)인적성(HMAT)_담임:김지아');
  // 종류를 바꾸면 메모 추천이 바로 바뀌고 0.7초 뒤 저장
  await sub(p).selectOption('GSAT');assert.equal(await mm.textContent(),'(인정출석)인적성(GSAT)_담임:김지아');
  assert.equal((await saved(p,posts,1)).r,'인적성(GSAT)');
  // 종류 기타 → 옆 종류 직접 입력 칸(초점), Enter로 저장
  await sub(p).selectOption('기타');assert.equal(await shadowFocus(p),'rapt');
  await p.keyboard.type('DCAT');assert.equal(await mm.textContent(),'(인정출석)인적성(DCAT)_담임:김지아');await p.keyboard.press('Enter');
  assert.equal((await saved(p,posts,2)).r,'인적성(DCAT)');assert.equal(await sub(p).inputValue(),'기타');assert.equal(await apt(p).inputValue(),'DCAT');
  // 표준 글 하나를 고르면 옆 칸이 사라짐
  await main(p).selectOption('병원(치과)');assert.equal(await sub(p).count(),0);assert.equal(await mm.textContent(),'(인정출석)병원(치과)_담임:김지아');
  assert.equal((await saved(p,posts,3)).r,'병원(치과)');
  // 기타 → 직접 입력 칸(표준 글이던 칸은 비움, 고르기만으로는 저장 안 함), 쓰고 Enter
  await main(p).selectOption('기타');assert.equal(await free(p).inputValue(),'');assert.equal(await shadowFocus(p),'reason');
  await p.keyboard.type('가족 돌봄');await p.keyboard.press('Enter');
  assert.equal((await saved(p,posts,4)).r,'가족 돌봄');assert.equal(saves(posts).length,4,'picking 기타 alone saved nothing');assert.equal(await main(p).inputValue(),'기타');
  // 빠른 사유는 목록 값으로 드롭다운을 맞추고, 인정 출결에 인정 분류가 아니면 바로 안내
  await p.locator('[data-q="교통사정"]').click();assert.equal(await main(p).inputValue(),'교통사정');assert.equal(await free(p).count(),0);
  assert.match(await p.locator('#rn').innerText(),/교통은 보통 인정 사유가 아닙니다/);
  assert.equal((await saved(p,posts,5)).r,'교통사정');
  // 해당없음 = 사유 비우기 → 인정 출결은 사유가 필요하다는 경고가 바로
  await p.locator('[data-q="해당없음"]').click();assert.equal(await main(p).inputValue(),'');
  assert.equal(await p.locator('#rn [data-reason-check="required"]').textContent(),'인정 출결은 사유가 필요합니다');
  assert.equal(await mm.textContent(),'(인정출석)사유_담임:김지아');
  assert.equal((await saved(p,posts,6)).r,'');
  assert.ok(!(await p.locator('[data-q]').allTextContents()).includes('병결'),'quick reasons no longer offer 병결');
  assert.equal(await p.evaluate(()=>window.notes.length),0,'no extra-evidence notice for other reasons');
 });
});

test('teacher 취업박람회: 고르는 즉시 추가 증빙 안내, 저장하면 배지와 담임·관리자 알림 한 번, 출결사유에서 미이행만 거르기',async()=>{
 await page('/teacher.html',async(p,posts)=>{
  const {main,free}=T;
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await main(p).waitFor();
  assert.equal(await p.locator('#rn .b2-xnote').count(),0);
  await main(p).selectOption('취업박람회');assert.equal(await p.locator('#rn .b2-xnote').textContent(),'추가 증빙 필요 · 기업면접 확인서','before saving');
  await p.waitForFunction(()=>window.notes.length===1);
  assert.deepEqual(await p.evaluate(()=>window.notes[0]),{title:'추가 증빙 필요 · 1반 고다원',body:'11/5 인정출석 취업박람회 · 기업면접 확인서 제출이 필요합니다.',name:'고다원',date:'2026-11-05',r:'취업박람회'});
  assert.equal(saves(posts).at(-1).r,'취업박람회');
  // 저장되면 안내 대신 저장된 기록의 배지(관리자 출결대조와 같음)
  await p.locator('#evb .e-extra').waitFor();assert.equal(await p.locator('#evb .e-extra').textContent(),'추가 증빙 필요 · 기업면접 확인서 · 미제출');assert.equal(await p.locator('#rn .b2-xnote').count(),0);
  // 직접 고쳐도(이미 필요) 알림은 다시 남기지 않습니다.
  await main(p).selectOption('기타');await free(p).fill('취업박람회(현장 면접)');await free(p).press('Enter');await p.waitForTimeout(400);
  assert.equal(saves(posts).at(-1).r,'취업박람회(현장 면접)');assert.equal(await p.evaluate(()=>window.notes.length),1);
  // 인정이 아닌 결석이면 안내만(이행 추적 없음)
  await p.locator('[data-t="결석"]').click();await p.waitForTimeout(400);
  assert.equal(await p.locator('#rn .b2-xnote').textContent(),'추가 증빙 필요 · 기업면접 확인서 (인정 출결일 때)');assert.equal(await p.locator('#evb .e-extra').count(),0);
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

test('teacher 기본 경고를 고르는 즉시(관리자와 같은 글): 교육일 아닌 날 인정(17반 테스트반 빼고), 증빙 미제출·반려 사유 없음(보기만), 사유 없음',async()=>{
 const R=(type,o={})=>({type,inT:'',outT:'',oa:'',ob:'',r:'',ev:'',evr:'',...o});
 const portal={...PORTAL,recs:{...PORTAL.recs,'고다원|2026-11-01':R('인정출석',{r:'병원'}),'김동진|2026-11-05':R('인정출석',{r:'면접',ev:'반려'}),'김동진|2026-11-04':R('인정조퇴',{r:'취업박람회',outT:'15:00',ev:'확인'})}};
 for(const path of ['/teacher.html','/teacher17.html'])await page(path,async p=>{
  const {main}=T;
  await p.locator('select[data-n="고다원"][data-d="2026-11-01"]').focus();await main(p).waitFor();
  assert.equal(await p.locator('#rn [data-offday-note]').count(),path==='/teacher.html'?1:0,path);
  if(path!=='/teacher.html')return;
  assert.equal(await p.locator('#rn [data-offday-note]').textContent(),'교육일이 아닌 날의 인정 출결은 통계·증빙에 들지 않습니다');
  assert.equal(await p.locator('#evb [data-ev]').textContent(),'증빙 미제출');assert.equal(await p.locator('#evb select').count(),0,'teachers do not set evidence');
  // 결석으로 바꾸면 인정 경고·증빙 배지가 사라짐
  await p.locator('[data-t="결석"]').click();assert.equal(await p.locator('#rn [data-offday-note]').count(),0);assert.equal(await p.locator('#evb [data-ev]').count(),0);
  // 반려인데 반려 사유가 없으면 빨간 안내
  await p.locator('select[data-n="김동진"][data-d="2026-11-05"]').focus();await p.waitForFunction(()=>/김동진/.test(document.querySelector('#root').shadowRoot.querySelector('#pn h2')?.textContent||''));
  assert.equal(await p.locator('#evb [data-ev]').textContent(),'증빙 반려');assert.match(await p.locator('#evb [data-reason-check="evr"]').textContent(),/반려 사유가 비어 있습니다/);
  // 확인된 취업박람회: 증빙 확인·추가 증빙 확인
  await p.locator('select[data-n="김동진"][data-d="2026-11-04"]').focus();await p.waitForFunction(()=>/11\/4/.test(document.querySelector('#root').shadowRoot.querySelector('#pn .note')?.textContent||''));
  assert.deepEqual(await p.locator('#evb .b2-badge').allTextContents(),['증빙 확인','추가 증빙 확인']);
  // 사유를 고르면 메모 추천이 바로 바뀜
  await main(p).selectOption('예비군');assert.equal(await p.locator('#mm').textContent(),'(인정조퇴)예비군_담임:김지아(15:00)');
 },{portal});
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
  assert.deepEqual(groups,['병원·질병','면접','인적성','취업박람회','예비군·민방위','자격증 시험','경조사','공가(관공서·법원)','(인정 안 됨) 교통','(인정 안 됨) 취업활동','(인정 안 됨) 개인사정']);
  const values=await main(go).locator('option').evaluateAll(o=>o.map(x=>x.value));
  for(const v of ['병결','면접(최종)','시험(자격증)','취업박람회(현장 면접)'])assert.ok(!values.includes(v),`${v} is no longer listed`);
  for(const v of ['병원','병원(치과)','병원(진료 위한 검사)','일반건강검진','면접','인적성','취업박람회','예비군','민방위','자격증','조모상','공가(법원 출석)','교통사정','개인일정','기타'])assert.ok(values.includes(v),v);
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
  // 사유 바로 옆 증빙 드롭다운(사용자 2026-10-20): 취업박람회 안내는 title, 「확인」을 모아 저장하면 이행
  const ev=dong.locator('select[data-inline="ev"]');
  assert.equal(await ev.evaluate(e=>e.previousElementSibling?.classList.contains('b2-rpick')),true);
  assert.match(await ev.getAttribute('title'),/취업박람회 · 추가 증빙 기업면접 확인서까지 받았으면 「확인」/);
  await ev.selectOption('확인');assert.equal(await p.locator('#b2SaveAll').textContent(),'변경 1건 저장');
  await p.locator('#b2SaveAll').click();
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
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await T.main(p).waitFor();
  await T.main(p).selectOption('취업박람회');
  await p.waitForFunction(()=>(window.sdkWrites||[]).some(w=>w[1].startsWith('notifications/')));
  const n=await p.evaluate(()=>window.sdkWrites.find(w=>w[1].startsWith('notifications/'))[2]);
  assert.equal(n.kind,'추가 증빙');assert.equal(n.title,'추가 증빙 필요 · 1반 고다원');assert.equal(n.toRole,'admin');assert.equal(n.toClass,'1');assert.equal(n.link,'#b2ledger?cls=1&date=2026-11-05');assert.equal(n.from,'teacher@test.kr');
  assert.ok(n.to.length>0&&!n.to.includes('teacher@test.kr'),'administrators are named, the sender is not');
 });
});

test('담임 출결판 아무 날짜(사용자 결정 2026-10-20): 교육일이 아닌 날·아직 오지 않은 날의 원장 기록은 칸을 더해 보이고, 「다른 날짜」로 아무 날이나 열어 바로 저장',async()=>{
 const R=(type,o={})=>({type,inT:'',outT:'',oa:'',ob:'',r:'',ev:'',evr:'',...o});
 const portal={...PORTAL,recs:{...PORTAL.recs,'고다원|2026-11-01':R('결석'),'김동진|2026-11-09':R('출석')}};
 await page('/teacher.html',async(p,posts)=>{
  const root=p.locator('#root');await root.locator('table.g').waitFor();
  assert.deepEqual(await root.locator('table.g thead th[data-day]').evaluateAll(t=>t.map(x=>x.dataset.day)),['2026-11-09','2026-11-05','2026-11-04','2026-11-01'],'최근 먼저, 원장 기록이 있는 일요일·미래 교육일 칸을 더함');
  assert.match(await root.locator('th[data-day="2026-11-01"]').innerText(),/교육일 아님/);assert.match(await root.locator('th[data-day="2026-11-09"]').innerText(),/예정/);
  assert.match(await root.locator('th[data-day="2026-11-05"]').innerText(),/기준일|오늘/,'기준일 표시는 그대로 기준일 칸에');
  assert.equal(await root.locator('select[data-n="고다원"][data-d="2026-11-01"]').inputValue(),'결석');
  const any=root.locator('#anyDay');assert.equal(await any.getAttribute('min'),null);assert.equal(await any.getAttribute('max'),null);
  await any.fill('2026-11-07');
  await root.locator('th[data-day="2026-11-07"]').waitFor();
  assert.match(await root.locator('#anyNote').innerText(),/교육일이 아닌 날입니다/);
  await root.locator('select[data-n="김동진"][data-d="2026-11-07"]').selectOption('결석');
  for(let i=0;i<50&&!saves(posts).length;i++)await p.waitForTimeout(100);
  assert.deepEqual(saves(posts).map(s=>[s.name,s.date,s.type]),[['김동진','2026-11-07','결석']]);
  assert.match(await root.locator('#pn').innerText(),/교육일 아님/,'오른쪽 칸에도 작은 안내');
 },{portal});
});

test('담임 출결판 시간 칸 없음(사용자 지시 2026-10-20): 입실·퇴실·외출 입력칸은 없고 저장된 시간은 보기만, 사유 드롭다운·체크히어 메모 추천은 남고, 저장 때 저장된 시간을 그대로 보냄',async()=>{
 const portal={...PORTAL,recs:{...PORTAL.recs,'김동진|2026-11-04':{type:'인정조퇴',inT:'',outT:'15:00',oa:'',ob:'',r:'취업박람회',ev:'',evr:''},'고다원|2026-11-04':{type:'지각',inT:'',outT:'',oa:'',ob:'',r:'',ev:'',evr:''}}};
 await page('/teacher.html',async(p,posts)=>{
  const root=p.locator('#root');await root.locator('table.g').waitFor();
  await root.locator('select[data-n="김동진"][data-d="2026-11-04"]').focus();
  const pn=root.locator('#pn');await pn.locator('#tv').waitFor();
  assert.equal(await pn.locator('input[type="time"]').count(),0,'시간 입력칸 없음');
  for(const id of ['inT','outT','oa','ob'])assert.equal(await pn.locator('#'+id).count(),0,id);
  assert.match(await pn.locator('#tv').innerText(),/시간\(보기만\): 퇴실 15:00/);
  assert.equal(await pn.locator('select[data-inline="rmain"]').count(),1,'사유 드롭다운');assert.equal(await pn.locator('input[data-inline="reason"]').count(),0,'직접 입력은 기타일 때만');
  assert.match(await pn.locator('#mm').innerText(),/^\(인정조퇴\)취업박람회_담임:김지아\(15:00\)$/,'체크히어 메모 추천(저장된 시간으로)');
  assert.equal(await pn.locator('#cp').count(),1,'메모 복사');
  await pn.locator('[data-q="면접"]').click();
  for(let i=0;i<50&&!saves(posts).length;i++)await p.waitForTimeout(100);
  const s=saves(posts)[0];assert.deepEqual([s.name,s.date,s.type,s.r,s.inT,s.outT,s.oa,s.ob],['김동진','2026-11-04','인정조퇴','면접','','15:00','',''],'저장된 시간을 그대로 보냄');
  // 지각인데 입실 시간이 없으면: 담임은 넣지 않고 운영팀이 맞춘다는 안내만
  await root.locator('select[data-n="고다원"][data-d="2026-11-04"]').focus();
  await p.waitForFunction(()=>/고다원/.test(document.querySelector('#root').shadowRoot.querySelector('#pn h2')?.textContent||''));
  assert.match(await pn.locator('#tv').innerText(),/없음 · 시간은 운영팀이 체크히어 기록으로 맞춥니다/);
  assert.match(await pn.locator('#mm').innerText(),/^지각_담임:김지아\(--:--\)$/);
 },{portal});
});

// 목록 개정(사용자 2026-10-20): 자격증 시험 + 옆 종류 드롭다운(인적성과 같은 방식), 과정별 X는 인정 출결에서 막고 저장된 X는 빨간 경고, △는 주의 배지, 일반건강검진은 막힌 항목
test('출결대조 자격증: 옆 종류 드롭다운, X(어학시험·지게차) 막기·빨간 경고, △ 주의, 일반건강검진 막기, 옛 병원(검진)은 검진 종류 확인',async()=>{
 const ledger={...LEDGER,ledger:[L('2026-11-05','1','고다원','인정출석',{reason:'자격증(어학시험)',sig:'sig-고다원'}),L('2026-11-05','1','김동진','인정조퇴',{reason:'병원(검진)',outT:'15:00',sig:'sig-김동진'})]};
 await page('/ledger.html',async(p,posts)=>{
  const row=n=>p.locator(`tbody[data-student="${n}"] tr[data-name]`),go=row('고다원'),dong=row('김동진'),park=row('박서연');
  const main=r=>r.locator('select[data-inline="rmain"]'),sub=r=>r.locator('select[data-inline="rsub"]');
  await main(go).waitFor();
  // 저장된 인정출석 + 어학시험(1반 모빌리티 AI → 임베디드AI 기준 X): 그대로 보이고 빨간 경고
  assert.equal(await main(go).inputValue(),'자격증');assert.equal(await sub(go).inputValue(),'어학시험');assert.equal(await sub(go).getAttribute('aria-label'),'고다원 자격증 종류');
  assert.equal(await go.locator('[data-reason-check="error"]').textContent(),'(인정 안 됨) 어학시험(토익, 오픽 등) · 임베디드AI 과정 인정 제외');
  assert.equal(await go.locator('[data-reason-check="error"]').evaluate(e=>e.classList.contains('b2-err')),true);
  assert.equal(await sub(go).locator('option[value="지게차운전기능사"]').isDisabled(),true);assert.equal(await sub(go).locator('option[value="어학시험"]').isDisabled(),false,'the saved value stays selectable');
  // 사유 칸 240px 안에 사유 + 종류, 그 옆 증빙 드롭다운(110px)
  const box=await go.locator('.b2-rpick').boundingBox(),evb=await go.locator('select[data-inline="ev"]').boundingBox();
  assert.ok(box.width<=240.5,`width ${box.width}`);assert.ok(Math.abs(evb.width-110)<1,`ev ${evb.width}`);assert.ok(evb.x>=box.x+box.width-1);
  // 옛 '병원(검진)'은 기타(직접 입력)로 보이고 '검진 종류 확인 필요' 주의
  assert.equal(await main(dong).inputValue(),'기타');assert.match(await dong.locator('[data-reason-check="warn"]').textContent(),/^검진 종류 확인 필요/);
  // 새 기록: 인정출석 → 자격증 → 종류 칸(포커스), X는 막힘, △는 '(관련성 확인 필요)'과 주의 배지
  await park.locator('[data-inline="type"]').selectOption('인정출석');
  assert.equal(await main(park).locator('option[value="일반건강검진"]').isDisabled(),true,'일반건강검진 cannot be picked for 인정 출결');
  assert.equal(await main(park).locator('option[value="일반건강검진"]').textContent(),'(인정 안 됨) 일반건강검진');
  await main(park).selectOption('자격증');
  assert.equal(await sub(park).evaluate(e=>e===document.activeElement),true,'the type box takes focus');
  assert.equal(await sub(park).locator('option[value="어학시험"]').isDisabled(),true);assert.equal(await sub(park).locator('option[value="어학시험"]').textContent(),'(인정 안 됨) 어학시험(토익, 오픽 등)');
  assert.equal(await sub(park).locator('option[value="가스기사"]').textContent(),'가스기사 (관련성 확인 필요)');
  await sub(park).selectOption('가스기사');assert.equal(await park.locator('[data-reason-check="warn"]').textContent(),'가스기사 · 관련성 확인 필요(임베디드AI 과정)');
  await sub(park).selectOption('기타');const kind=park.locator('input[data-inline="rapt"]');assert.equal(await kind.evaluate(e=>e===document.activeElement),true);
  await p.keyboard.type('정보처리기사');assert.equal(await main(park).inputValue(),'자격증');
  // 인정이 아닌 출결이면 X도 고를 수 있음
  await go.locator('[data-inline="type"]').selectOption('결석');
  assert.equal(await sub(go).locator('option[value="지게차운전기능사"]').isDisabled(),false);assert.equal(await go.locator('[data-reason-check]').count(),0);
  await p.locator('#b2SaveAll').click();await p.locator('#b2BulkNote').getByText('2건 저장',{exact:true}).waitFor();
  assert.deepEqual(posts.filter(b=>b.action==='b2Save').map(b=>[b.args[0].name,b.args[0].type,b.args[0].reason]),[['고다원','결석','자격증(어학시험)'],['박서연','인정출석','자격증(정보처리기사)']]);
  assert.equal(await sub(park).inputValue(),'기타');assert.equal(await park.locator('input[data-inline="rapt"]').inputValue(),'정보처리기사');
  assert.equal(await park.locator('[data-reason-check="warn"]').textContent(),'정보처리기사 · 관련성 확인 필요(임베디드AI 과정)','after saving the caution stays');
 },{ledger});
});

test('담임 사유 자격증: 사유 드롭다운 자격증 → 바로 옆 종류(관리자와 같음), X는 인정 출결에서 막힘, △는 주의, 일반건강검진 막힘·빨간 경고',async()=>{
 const portal={...PORTAL,recs:{...PORTAL.recs,'고다원|2026-11-05':{type:'인정출석',inT:'',outT:'',oa:'',ob:'',r:'자격증(전기기사)',ev:'',evr:''}}};
 await page('/teacher.html',async(p,posts)=>{
  const {main,sub,free,apt}=T;
  await p.locator('select[data-n="고다원"][data-d="2026-11-05"]').focus();await main(p).waitFor();
  assert.equal(await main(p).inputValue(),'자격증');assert.equal(await sub(p).inputValue(),'전기기사');assert.equal(await sub(p).getAttribute('aria-label'),'고다원 자격증 종류');
  // 1반 모빌리티 AI → 임베디드AI 기준: 어학시험 X는 막힘
  assert.equal(await sub(p).locator('option[value="어학시험"]').isDisabled(),true);assert.equal(await sub(p).locator('option[value="어학시험"]').textContent(),'(인정 안 됨) 어학시험(토익, 오픽 등)');
  assert.equal(await p.locator('[data-reason-check]').count(),0,'전기기사 is O');
  await sub(p).selectOption('컴퓨터활용능력');
  assert.equal(await p.locator('#rn [data-reason-check="warn"]').textContent(),'컴퓨터활용능력 · 관련성 확인 필요(임베디드AI 과정)','caution right away');
  assert.equal(await p.locator('#mm').textContent(),'(인정출석)자격증(컴퓨터활용능력)_담임:김지아');
  assert.equal((await saved(p,posts,1)).r,'자격증(컴퓨터활용능력)');
  await sub(p).selectOption('기타');assert.equal(await shadowFocus(p),'rapt');
  await p.keyboard.type('정보처리기사');await p.keyboard.press('Enter');
  assert.equal((await saved(p,posts,2)).r,'자격증(정보처리기사)');assert.equal(await sub(p).inputValue(),'기타');assert.equal(await apt(p).inputValue(),'정보처리기사');
  assert.equal(await p.locator('#rn [data-reason-check="warn"]').textContent(),'정보처리기사 · 관련성 확인 필요(임베디드AI 과정)');
  // 자격증을 다시 고르면 옆 종류 칸으로 초점
  await main(p).selectOption('면접');await main(p).selectOption('자격증');assert.equal(await shadowFocus(p),'rsub');
  // 일반건강검진은 인정 출결에서 막힘, 직접 쓰면 빨간 경고
  assert.equal(await main(p).locator('option[value="일반건강검진"]').isDisabled(),true);assert.equal(await main(p).locator('option[value="일반건강검진"]').textContent(),'(인정 안 됨) 일반건강검진');
  await main(p).selectOption('기타');await free(p).fill('일반건강검진');
  assert.equal(await p.locator('#rn [data-reason-check="error"]').textContent(),'(인정 안 됨) 일반건강검진 · 진료 위한 검사만 인정됩니다');
  assert.equal(await p.locator('#rn [data-reason-check="error"]').evaluate(e=>e.classList.contains('b2-err')),true,'red');
  // 결석이면 막지 않음
  await p.locator('[data-t="결석"]').click();await p.waitForTimeout(300);
  assert.equal(await main(p).locator('option[value="일반건강검진"]').isDisabled(),false);assert.equal(await p.locator('[data-reason-check]').count(),0);
 },{portal});
});
