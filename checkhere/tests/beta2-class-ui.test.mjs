// 2기 반 현황(beta2-class.mjs, 사용자 2026-10-20): 홈 반 카드 → 반 현황, 카드별 자료(반 묶음·중도탈락·서류발급·민원·시간표·메모·체크히어·알림),
// 그 반만 읽는지, 링크가 그 반을 고른 채 그 화면으로 가는지, 17반 테스트반도 고를 수 있는지 봅니다. 가짜 Apps Script 응답과 Firestore SDK 대역을 씁니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {CLASSES as COHORT_CLASSES} from '../../cohort.mjs';

const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const row=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'베타 수정',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
const TODAY='2026-11-05';
const BUNDLE={rev:5,today:TODAY,days:['2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'],
 classes:COHORT_CLASSES.map((c,i)=>({id:c.id,region:c.region,course:c.course,hrdName:i===0?'모빌리티 AI 실무':'',teacher:i===0?'김지아':'',venue:c.venue,address:'',tab:''})),
 roster:[['1','고다원','재학',''],['1','김동진','재학',''],['1','한수빈','중도탈락','2026-11-04'],['1','박민지','재학',''],['2','이경수','재학',''],['17','테스트갑','재학','']],ledgerCols:COLS,
 ledger:[
  row('2026-11-02','1','고다원','결석'),row('2026-11-03','1','고다원','결석'),row('2026-11-05','1','고다원','결석',{reason:'개인일정'}),
  row('2026-11-05','1','김동진','지각',{inT:'10:25',reason:'교통'}),row('2026-10-29','1','김동진','지각',{inT:'09:30'}),row('2026-10-30','1','김동진','조퇴',{outT:'17:00'}),row('2026-11-04','1','김동진','인정출석',{reason:'취업박람회'}),
  row('2026-10-29','1','박민지','인정출석',{reason:'병원'}),row('2026-10-30','1','박민지','인정출석',{reason:'병원'}),row('2026-11-04','1','박민지','인정출석',{reason:'병원 진료'}),row('2026-11-05','1','박민지','인정출석',{reason:'병원'}),
  row('2026-11-05','2','이경수','결석')],
 sync:{}};
const DROPS={rev:5,maxAbsence:3,rows:[{row:2,cls:'1',name:'한수빈',kind:'중도탈락',reason:'개인 사정',startDate:'',lastDate:'2026-11-04',verdict:'제적',basis:'',docs:{},contact:'',note:'',by:'teacher@test.kr',at:'2026-11-04 12:00',confirmed:false,confirmedBy:'',confirmedAt:''},
 {row:3,cls:'2',name:'이경수',kind:'조기취업',reason:'',startDate:'2026-11-10',lastDate:'2026-11-05',verdict:'',basis:'',docs:{},contact:'',note:'',by:'hint.kpc@gmail.com',at:'',confirmed:false,confirmedBy:'',confirmedAt:''}]};
const DOCS={rev:5,statuses:['접수','처리중','보완 필요','처리완료','취소'],rows:[
 {id:'D261104-001',requested:'2026-11-04',cls:'1반(김지아)',name:'고다원',docType:'교육참여확인서',qty:'1',submitTo:'국취제 운영기관',due:'2026-11-07',status:'접수'},
 {id:'D261101-002',requested:'2026-11-01',cls:'1반(김지아)',name:'김동진',docType:'수기 출석부',qty:'',submitTo:'',due:'',status:'처리완료'},
 {id:'D261103-003',requested:'2026-11-03',cls:'4반',name:'다른반',docType:'교육참여확인서',qty:'',submitTo:'',due:'',status:'접수'}]};
const VOCS={state:{rev:3,admin:1,open:{}},statuses:['접수','처리중','완료','보류'],types:['시설·환경'],rows:[
 {key:'k1',id:'V261104-001',cls:'1',type:'시설·환경',status:'접수',date:'2026-11-04',detail:'강의실 에어컨 고장',action:'',thread:[],lastBy:'담임',lastAt:'2026-11-04 10:00',author:'teacher@test.kr',days:1},
 {key:'k2',id:'V261101-001',cls:'1',type:'기타',status:'완료',date:'2026-11-01',detail:'끝난 건',action:'',thread:[],lastBy:'운영',lastAt:'2026-11-02 10:00',author:'',days:''},
 {key:'k3',id:'V261103-001',cls:'2',type:'기타',status:'접수',date:'2026-11-03',detail:'다른 반 건',action:'',thread:[],lastBy:'담임',lastAt:'',author:'',days:2}]};
const SCHEDULE={rev:5,rows:[
 {cls:'1',date:'2026-11-02',subject:'파이썬 기초',instructor:'박강사',hours:8,start:'',end:'',mark:''},
 {cls:'1',date:'2026-11-05',subject:'공장견학',instructor:'',hours:6,start:'10:00',end:'17:00',mark:''},
 {cls:'1',date:'2026-11-09',subject:'다음 주 과목',instructor:'',hours:8,start:'',end:'',mark:''}]};
const DAYTIMES={date:TODAY,cls:'1',start:'10:00',end:'17:00',lateAfter:'10:10',earlyBefore:'16:50',source:'현장교육 일정',modules:[{row:5,module:'공장견학',start:'10:00',end:'17:00',part:''}]};
const MEMOS={rev:5,rows:[{row:2,date:'2026-11-04',cls:'1',name:'김동진',memo:'수기출석 사인 미비',by:'hint.kpc@gmail.com'}]};
const rec=o=>({classId:'1',date:TODAY,outings:[],outingCount:0,collectedAt:'1',source:'live',readState:'complete',...o});
const CH_DAYS={[`classes/1/checkhereCurrent/${TODAY}`]:{records:[rec({id:'a',name:'고다원',rawEntry:'09:02:00',entry:'09:02:00',exit:'17:00:00'}),rec({id:'b',name:'김동진',rawEntry:'10:25:00',entry:'10:25:00',exit:'17:00:00'})]}};
const SDK_STUB=`
window.sdkWrites=[];window.docStore={};
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...a)=>a;
export const getDoc=async ref=>snap(undefined);
export const getDocFromServer=async ref=>{(window.chReads=window.chReads||[]).push(ref.path);return snap(${JSON.stringify(CH_DAYS)}[ref.path]);};
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=(ref,a,b,c)=>{const [cb,err]=typeof a==='function'?[a,b]:[b,c],entry={path:ref.path,cb,err};(window.snapCbs=window.snapCbs||[]).push(entry);return()=>{window.snapCbs=window.snapCbs.filter(x=>x!==entry);};};
window.pushSnap=(path,docs)=>{const s={docs:docs.map(({id,...d})=>({id,data:()=>d})),metadata:{fromCache:false,hasPendingWrites:false}};(window.snapCbs||[]).filter(x=>x.path===path).forEach(x=>x.cb(s));};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'n'});
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}}),writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=`export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'hint.kpc@gmail.com',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
function answer(body){
 const p=body.args?.[0]??{};
 switch(body.action){
  case 'b2Bundle':return BUNDLE;
  case 'b2Rev':return {rev:BUNDLE.rev,sync:{},voc:{rev:3,admin:1,open:{}}};
  case 'b2Dropouts':return {...DROPS,rows:DROPS.rows.filter(r=>!p.cls||r.cls===p.cls)};
  case 'b2Completions':return {rev:5,rows:[]};
  case 'b2Docs':return {...DOCS,rows:DOCS.rows.filter(r=>!p.cls||r.cls.replace(/반.*$/,'')===p.cls)};
  case 'b2Vocs':return {...VOCS,rows:VOCS.rows.filter(r=>!p.cls||r.cls===p.cls)};
  case 'b2Schedule':return {...SCHEDULE,rows:SCHEDULE.rows.filter(r=>(!p.cls||r.cls===p.cls)&&(!p.from||r.date>=p.from)&&(!p.to||r.date<=p.to))};
  case 'b2DayTimes':return p.cls==='1'&&p.date===TODAY?DAYTIMES:{date:p.date,cls:p.cls,start:'09:00',end:'18:00',lateAfter:'09:10',earlyBefore:'17:50',source:'기본',modules:[]};
  case 'b2LedgerMemos':return {...MEMOS,rows:MEMOS.rows.filter(r=>!p.cls||r.cls===p.cls)};
  case 'b2ModuleTimes':return {rev:5,rows:[]};
  // 반 임원(2026-10-20): 1반 반장 한수빈이 중도탈락이라 보궐 필요
  case 'b2Officers':return {rev:5,roles:['반장','부반장','총무','앰버서더'],kinds:['최초','보궐'],rows:[],current:{[p.cls||'1']:p.cls&&p.cls!=='1'?{반장:null,부반장:null,총무:null,앰버서더:null}:{반장:{row:2,name:'한수빈',kind:'최초',start:'2026-10-28'},부반장:{row:4,name:'고다원',kind:'보궐',start:'2026-11-02'},총무:null,앰버서더:{row:3,name:'김동진',kind:'최초',start:'2026-10-28'}}},needs:p.cls&&p.cls!=='1'?[]:[{cls:'1',role:'반장',name:'한수빈',status:'중도탈락',changed:'2026-11-04',row:2}]};
  default:return {};
 }
}

async function site(run){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.clock.install({time:'2026-11-05T19:00:00+09:00'});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(url.pathname==='/api/teacher-beta'){const body=route.request().postDataJSON();posts.push(body);return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:answer(body)})});}
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test/');
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await run(page,posts);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const section=(page,k)=>page.locator(`[data-section="${k}"]`);
const stat=(page,k,label)=>section(page,k).locator(`[data-stat="${label}"] b`).innerText();
async function openOverview(page,cls='1'){
 await page.locator(`.b2-class[data-class="${cls}"]`).click();
 await page.getByRole('heading',{name:'반 현황'}).waitFor();
 await section(page,'info').getByText(`${cls}반 정보`).waitFor();
}
async function backToOverview(page){
 await page.locator('.admin-major button',{hasText:'홈'}).click();
 await page.getByRole('heading',{name:'2기 홈'}).waitFor();
 await openOverview(page);
}
const sent=(posts,action)=>posts.filter(p=>p.action===action).map(p=>p.args[0]);

test('홈 반 카드는 반 현황을 열고, 카드마다 그 반 자료를 보여 줍니다',async()=>{
 await site(async(page,posts)=>{
  assert.match(await page.getByText(/카드를 누르면 그 반 현황/).innerText(),/반 현황/);
  await openOverview(page);
  assert.equal(await page.locator('#c2Class').inputValue(),'1');
  assert.equal(await page.locator('#c2Date').inputValue(),TODAY,'latest teaching day up to today, as the home card passed it');
  assert.equal(await page.locator('.admin-tabs .tab.active').innerText(),'반 현황','menu shows 출결 › 반 현황');

  // 1. 반 정보: 시트 반정보 + 명부 상태별 인원
  const info=section(page,'info');
  assert.match(await info.locator('[data-teacher]').innerText(),/김지아/);
  assert.match(await info.innerText(),/모빌리티 AI 실무/);
  await info.locator('[data-officer="반장"]').waitFor();
  assert.deepEqual(await info.locator('[data-officer]').allInnerTexts(),['한수빈 최초 보궐 필요','고다원 보궐','없음','김동진 최초'],'four officers with 최초/보궐 and 보궐 필요');
  assert.ok(posts.some(b=>b.action==='b2Officers'&&b.args[0]?.cls==='1'));
  assert.equal(await stat(page,'info','총원'),'4');assert.equal(await stat(page,'info','재학'),'3');assert.equal(await stat(page,'info','중도탈락'),'1');

  // 2. 그날 출결: 한수빈(11/4 중도탈락)은 빠지고, 출석 외 세 명이 유형·사유와 함께
  const day=section(page,'day');
  assert.equal(await stat(page,'day','결석'),'1');assert.equal(await stat(page,'day','지각'),'1');assert.equal(await stat(page,'day','인정'),'1');assert.equal(await stat(page,'day','출석'),'2');
  assert.deepEqual(await day.locator('li[data-name] .b2-name').allInnerTexts(),['고다원','김동진','박민지']);
  assert.match(await day.locator('li[data-name="김동진"]').innerText(),/지각[\s\S]*입실 10:25[\s\S]*교통/);
  assert.match(await day.locator('li[data-name="박민지"]').innerText(),/인정출석[\s\S]*증빙 미제출/);
  // 체크히어 대조: 저장본 문서 하나만 읽고, 결석인데 입실 기록이 있는 고다원은 불일치
  // 그날 기준(현장교육 10:00~17:00)을 읽은 뒤의 판정: 김동진 10:25 입실·17:00 퇴실은 지각과 일치
  await day.locator('[data-check-sum]',{hasText:'일치 1 · 불일치 1'}).waitFor();
  assert.match(await day.locator('[data-check-sum]').innerText(),/일치 1 · 불일치 1[\s\S]*고다원/);
  assert.deepEqual(await page.evaluate(()=>window.chReads),[`classes/1/checkhereCurrent/${TODAY}`]);

  // 3. 누적: 결석 한도(시트 maxAbsence 3) · 질병 인정 4회 · 증빙 미제출 · 추가 증빙
  const total=section(page,'total');
  await total.locator('li[data-risk="고다원"]').waitFor();
  assert.match(await total.locator('li[data-risk="고다원"]').innerText(),/한도 도달[\s\S]*결석 3일 \/ 한도 3일/);
  assert.equal(await stat(page,'total','한도 도달'),'1');
  // 환산 결석(사용자 결정 2026-10-20 '3회=1일'): 김동진은 결석 0일이지만 지각·조퇴 3회 → 1일 → 한도 3일의 주의
  assert.deepEqual(await total.locator('li[data-risk]').evaluateAll(l=>l.map(x=>x.dataset.risk)),['고다원','김동진']);
  assert.match(await total.locator('li[data-risk="김동진"]').innerText(),/주의[\s\S]*환산 결석 1일 \/ 한도 3일[\s\S]*결석 0일 \+ 지·조·외 3회\(→ 1일\) = 환산 결석 1일[\s\S]*2일 더 결석하면 한도/);
  assert.equal(await stat(page,'total','주의'),'1');
  assert.match(await total.innerText(),/결석 한도 3일\(넘으면 제적 대상\)은 환산 결석으로 봅니다/);
  assert.equal(await stat(page,'total','질병 인정 4회 이상'),'1');
  assert.equal(await stat(page,'total','증빙 미제출·반려'),'5');
  assert.equal(await stat(page,'total','추가 증빙 미이행'),'1');
  assert.match(await total.innerText(),/박민지 4회/);

  // 4~6. 중도탈락(담임 신청 대기) · 서류발급(진행 중) · 민원(진행 중, 답변 대기): 그 반 것만
  const drop=section(page,'drop');await drop.locator('li[data-drop="한수빈"]').waitFor();
  assert.equal(await stat(page,'drop','담임 신청 대기'),'1');assert.match(await drop.innerText(),/담임 신청/);
  const docs=section(page,'docs');await docs.locator('li[data-doc]').first().waitFor();
  assert.deepEqual(await docs.locator('li[data-doc]').evaluateAll(l=>l.map(x=>x.dataset.doc)),['D261104-001']);
  assert.match(await docs.innerText(),/D-2/);
  const vocs=section(page,'vocs');await vocs.locator('li[data-voc]').first().waitFor();
  assert.deepEqual(await vocs.locator('li[data-voc]').evaluateAll(l=>l.map(x=>x.dataset.voc)),['k1']);
  assert.equal(await stat(page,'vocs','답변 대기'),'1');

  // 7. 이번 주 시간표(11/2~11/6)와 그날 현장교육 시간
  const week=section(page,'week');await week.locator('li[data-day]').first().waitFor();
  assert.deepEqual(await week.locator('li[data-day]').evaluateAll(l=>l.map(x=>x.dataset.day)),['2026-11-02','2026-11-05']);
  assert.equal(await week.locator('li.on').getAttribute('data-day'),TODAY);
  await week.locator('[data-daytime]').waitFor();
  assert.match(await week.locator('[data-daytime]').innerText(),/10:00~17:00[\s\S]*현장교육/);

  // 8. 출결대조 메모(최근 2주)와 이 반 알림
  const memos=section(page,'memos');await memos.locator('li[data-memo="김동진"]').waitFor();
  assert.match(await memos.innerText(),/수기출석 사인 미비/);
  const t={seconds:Math.floor(Date.parse('2026-11-05T18:00:00+09:00')/1000),nanoseconds:0};
  await page.evaluate(([t])=>window.pushSnap('notifications',[{id:'n1',kind:'민원',title:'민원 · 1반 에어컨',cls:'1',to:['hint.kpc@gmail.com'],toRole:'admin',readBy:[],createdAt:t},{id:'n2',kind:'서류발급',title:'서류발급 · 2반',cls:'2',to:[],toRole:'admin',readBy:[],createdAt:t}]),[t]);
  await memos.locator('li[data-note="n1"]').waitFor();
  assert.equal(await memos.locator('li[data-note]').count(),1,'only this class');

  // 읽기는 모두 그 반 것만(서류·민원·중도탈락·시간표·메모)
  assert.deepEqual(sent(posts,'b2Dropouts'),[{cls:'1'}]);
  assert.deepEqual(sent(posts,'b2Docs').at(-1),{cls:'1'});
  assert.deepEqual(sent(posts,'b2Vocs'),[{cls:'1'}]);
  assert.deepEqual(sent(posts,'b2Schedule'),[{cls:'1',from:'2026-11-02',to:'2026-11-06'}]);
  assert.deepEqual(sent(posts,'b2LedgerMemos'),[{cls:'1',from:'2026-10-23',to:TODAY}]);
  assert.deepEqual(sent(posts,'b2Bundle'),['all'],'the home bundle is reused');
 });
});

test('반 현황 링크는 그 반을 고른 채 그 화면으로 가고, 17반 테스트반도 고를 수 있습니다',async()=>{
 await site(async(page,posts)=>{
  await openOverview(page);
  // 출결대조(같은 날짜)
  await page.locator('#c2Ledger').click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  assert.equal(await page.locator('#b2Class').inputValue(),'1');assert.equal(await page.locator('#b2Date').inputValue(),TODAY);
  // 서류발급 신청함: 1반으로 거른 진행 중
  await backToOverview(page);
  await section(page,'docs').locator('li[data-doc]').first().waitFor();
  await section(page,'docs').getByRole('button',{name:'서류발급 신청함'}).click();
  await page.getByRole('heading',{name:'서류발급 신청함'}).waitFor();
  assert.equal(await page.locator('#d2Class').inputValue(),'1');
  await page.locator('[data-doc]').first().waitFor();
  assert.deepEqual(await page.locator('[data-doc]').evaluateAll(l=>l.map(x=>x.dataset.doc)),['D261104-001']);
  // 민원·이슈 처리함: 1반 · 진행 중
  await backToOverview(page);
  await section(page,'vocs').locator('li[data-voc]').first().waitFor();
  await section(page,'vocs').getByRole('button',{name:'민원·이슈 처리함'}).click();
  await page.getByRole('heading',{name:'민원·이슈 처리함'}).waitFor();
  assert.equal(await page.locator('#v2Class').inputValue(),'1');
  assert.equal(await page.locator('[data-filter="open"]').getAttribute('aria-pressed'),'true');
  // 중도탈락·수료: 1반 · 담임 신청 대기
  await backToOverview(page);
  await section(page,'drop').locator('li[data-drop]').first().waitFor();
  await section(page,'drop').getByRole('button',{name:'담임 신청 처리'}).click();
  await page.getByRole('heading',{name:'중도탈락·수료'}).waitFor();
  assert.equal(await page.locator('#d2Class').inputValue(),'1');
  assert.equal(await page.locator('[data-state="teacher"]').getAttribute('aria-pressed'),'true');
  // 질병 인정(출결 현황, 1반)
  await backToOverview(page);
  await section(page,'total').getByRole('button',{name:'질병 인정'}).click();
  await page.locator('.b2-tab[aria-selected="true"]',{hasText:'질병 인정'}).waitFor();
  // 메뉴 출결 › 반 현황(지금 고른 반) → 17반 테스트반
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.locator('.admin-tabs [data-tab="b2class"]').click();
  await page.getByRole('heading',{name:'반 현황'}).waitFor();
  assert.equal(await page.locator('#c2Class').inputValue(),'1');
  await page.locator('#c2Class').selectOption('17');
  await section(page,'info').getByText('17반 정보').waitFor();
  assert.match(await section(page,'info').innerText(),/테스트반/);
  assert.equal(await stat(page,'info','총원'),'1');
  await section(page,'drop').locator('[data-stat="담임 신청 대기"]').waitFor();
  assert.deepEqual(sent(posts,'b2Dropouts').at(-1),{cls:'17'});
  assert.deepEqual(sent(posts,'b2Vocs').at(-1),{cls:'17'});
 });
});
