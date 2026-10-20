import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {CLASS_IDS} from '../../cohort.mjs';

// /beta2 민원·이슈(2026-10-16 회의): 운영팀 처리함·홈 알림·어느 화면에서나 보이는 '답변 대기' 알림, 담임 화면 접수·답글 알림.
// 실제 index.html을 열고 Firebase·/api/teacher-beta는 가짜로 답합니다(beta2-ui.test.mjs와 같은 방식). 사람 이름은 모두 가상입니다.
const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const BUNDLE={rev:5,today:'2026-12-18',days:['2026-12-17','2026-12-18'],classes:CLASS_IDS.map(id=>({id,region:'권역',course:`과정${id}`,teacher:`가상담임${id}`})),
 roster:[['1','가상학생','재학','']],ledgerCols:['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'],ledger:[],sync:{checkedAt:Date.now()-60000,changedAt:Date.now()-3600000,last:{errors:[]}}};
const PORTAL={cls:1,region:'권역',course:'과정1',teacher:'가상담임1',place:'본관',mainDay:'2026-12-18',days:['2026-12-18'],week:[],summary:[{k:'총원',v:1}],kids:[{name:'가상학생',status:'재학',off:''}],recs:{},checks:[],closed:'미확인',evals:[],sats:[],vocs:[],officer:{}};
const STATE={rev:3,at:1,admin:2,open:{'1':2,'3':1},teacher:{'1':1}};
const row=o=>({sig:'',id:o.key.startsWith('V')?o.key:'',region:'권역',course:'과정',action:'',done:'',days:'1',author:'',seen:'',thread:[],...o});
const VOCS={statuses:['접수','처리중','완료','보류'],types:['수업·강사','시설·환경','출결','행정·서류','교육생 고충','안전','기타'],state:STATE,rows:[
 row({key:'V261016-001',date:'2026-12-18',cls:'3',type:'시설·환경',detail:'가상 강의장 냉방 고장',status:'접수',author:'teacher3@test.kr',lastBy:'담임',lastAt:'2026-12-18 10:00:00'}),
 row({key:'V261016-002',date:'2026-12-18',cls:'1',type:'행정·서류',detail:'가상 서류 질문',status:'처리중',lastBy:'운영',lastAt:'2026-12-18 11:00:00',thread:[{at:'2026-12-18 11:00',side:'운영',who:'',text:'확인 중입니다'}]}),
 row({key:'R7',sig:'s7',date:'2026-12-12',cls:'1',type:'출결',detail:'가상 예전 접수',status:'처리중',lastBy:'담임',lastAt:''}),
 row({key:'V261015-001',date:'2026-12-17',cls:'1',type:'기타',detail:'가상 끝난 건',status:'완료',lastBy:'운영',lastAt:'2026-12-17 15:00:00',seen:'2026-12-17 16:00:00',thread:[{at:'2026-12-17 15:00',side:'운영',who:'hint.kpc@gmail.com',text:'조치 완료'}]})
]};
const SDK_STUB=`
window.sdkWrites=[];window.docStore={};
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts';
export const getDoc=async ref=>snap(ref.path==='classes/1'?{course:'과정1',region:'권역',coreLinks:{}}:undefined);
export const getDocFromServer=async()=>snap(undefined);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=(ref,a,b,c)=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}});
export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=`
export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'hint.kpc@gmail.com',displayName:'운영',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml'};

async function beta(run,{state=STATE}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 let cur=structuredClone(state);
 const answer=body=>{
  const a=body.action,p=body.args?.[0]||{};
  if(a==='portalData')return PORTAL;
  if(a==='b2Bundle')return BUNDLE;
  if(a==='b2Rev')return {rev:BUNDLE.rev,sync:BUNDLE.sync,voc:cur};
  if(a==='b2Docs')return {rev:5,statuses:[],types:[],delivery:[],rows:[]};
  if(a==='b2Vocs')return {...VOCS,state:cur};
  if(a==='b2VocReply'){cur={...cur,rev:cur.rev+1,admin:Math.max(0,cur.admin-1)};return {ok:true,id:p.key.startsWith('R')?'V261016-009':p.key,state:cur};}
  if(a==='b2VocCreate'){cur={...cur,rev:cur.rev+1,admin:cur.admin+(p.side==='담임'?1:0)};return {id:'V261016-003',state:cur};}
  if(a==='b2VocSeen'){cur={...cur,rev:cur.rev+1,teacher:{}};return {ok:true,state:cur};}
  return {};
 };
 try{
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href===SDK+'firebase-firestore.js'||url.href===SDK+'firebase-firestore.js?beta2-sdk')return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
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
  await run(page,posts);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
// 포털 알림(index.html #toast). teacher-beta.js 그림자 DOM에도 #toast가 있어 문서의 것만 봅니다.
const toastHas=(page,text)=>page.waitForFunction(t=>(document.getElementById('toast')?.textContent||'').includes(t),text,{timeout:5000});
const sent=(posts,action)=>posts.filter(p=>p.action===action).map(p=>p.args[0]);

test('the office sees waiting 민원·이슈 on the home card and in a pill on every 2기 screen, opens the 처리함 and answers with a status',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  const card=page.locator('.b2-alert',{hasText:'민원·이슈 답변 대기'});
  await card.locator('b',{hasText:'2'}).waitFor();
  assert.match(await card.innerText(),/진행 중 3건/);
  const pill=page.locator('.b2-vocpill');await pill.waitFor();
  assert.equal(await pill.innerText(),'민원·이슈 답변 대기 2건');
  assert.equal(posts.filter(p=>p.action==='b2Vocs').length,0,'the counts come with the revision check; the sheet rows are not read for the home');
  await page.getByRole('button',{name:'서류발급',exact:true}).click();
  await page.getByRole('heading',{name:'서류발급 신청함'}).waitFor();
  assert.equal(await pill.isVisible(),true,'the pill stays on other screens');
  await pill.click();
  await page.getByRole('heading',{name:'민원·이슈 처리함'}).waitFor();
  assert.equal(await page.locator('.b2-vocpill').count(),0,'no pill on the inbox itself');
  assert.deepEqual(await page.locator('[data-voc]').evaluateAll(els=>els.map(e=>e.dataset.voc)),['V261016-001','R7'],'답변 대기 first: open and the last word is the teacher\'s');
  assert.deepEqual(await page.locator('[data-filter]').allInnerTexts(),['답변 대기2','진행 중3','완료1','전체4']);
  await page.locator('[data-voc="V261016-001"]').click();
  assert.match(await page.locator('.b2-msg').first().innerText(),/담임\s*· teacher3@test\.kr[\s\S]*가상 강의장 냉방 고장/);
  await page.locator('[data-reply]').fill('내일 수리 기사가 방문합니다');
  await page.locator('[data-voc-body] [data-status="처리중"]').click();
  assert.equal(await page.locator('[data-reply]').inputValue(),'내일 수리 기사가 방문합니다','the draft survives the redraw');
  const before=posts.filter(p=>p.action==='b2Vocs').length;
  await page.getByRole('button',{name:'보내기'}).click();
  await toastHas(page,'보냈습니다');
  await page.waitForTimeout(300);
  assert.deepEqual(sent(posts,'b2VocReply'),[{key:'V261016-001',sig:'',cls:'3',text:'내일 수리 기사가 방문합니다',status:'처리중',side:'운영'}]);
  assert.ok(posts.filter(p=>p.action==='b2Vocs').length>before,'the list is read again');
  // 운영팀이 대신 접수
  await page.getByRole('button',{name:'새로 접수'}).click();
  await page.locator('[data-type="안전"]').click();
  await page.locator('[data-f="detail"]').fill('가상 전화 접수');
  await page.getByRole('button',{name:'접수하기'}).click();
  await page.waitForTimeout(300);
  assert.deepEqual(sent(posts,'b2VocCreate'),[{cls:'1',type:'안전',detail:'가상 전화 접수',side:'운영'}]);
 });
});

test('a new teacher post while the office is on another screen raises the pill count and a notice',async()=>{
 await beta(async(page,posts)=>{
  await page.locator('.b2-vocpill',{hasText:'답변 대기 2건'}).waitFor();
  await page.getByRole('button',{name:'출결',exact:true}).click();
  // 담임이 새로 접수함 → 다음 변경 번호 확인(어느 화면이 했든)에서 답변 대기가 3건으로 옵니다.
  await page.route('**/api/teacher-beta',async route=>{
   const body=route.request().postDataJSON();if(body.action!=='b2Rev')return route.fallback();posts.push(body);
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:{rev:5,sync:BUNDLE.sync,voc:{rev:9,admin:3,open:{'1':3},teacher:{}}}})});
  });
  await page.evaluate(async()=>{const {createBeta2Client}=await import('/beta2-data.mjs');await createBeta2Client({getIdToken:async()=>'tok-1'}).rev();});
  await page.locator('.b2-vocpill',{hasText:'답변 대기 3건'}).waitFor();
  await toastHas(page,'새 민원·이슈 글이 왔습니다 · 답변 대기 3건');
 });
});

test('the teacher screen shows an office-reply bar, files new 민원·이슈 as 담임 and marks a reply as read',async()=>{
 await beta(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.getByRole('button',{name:'미리보기',exact:true}).click();
  const bar=page.locator('#t2Voc:not([hidden])');await bar.waitFor();
  assert.match(await bar.innerText(),/운영팀이 민원·이슈에 답글을 남겼습니다 · 1건/);
  assert.equal(await page.locator('#t2Alert').isVisible(),false,'the empty disease bar stays hidden');
  await bar.getByRole('button',{name:'보기'}).click();
  assert.deepEqual(await page.locator('[data-subtab]').allInnerTexts(),['민원·이슈','만족도 설문'],'학습자 평가 is gone');
  await page.locator('#t2Head h2',{hasText:'민원·이슈'}).waitFor();
  assert.deepEqual(sent(posts,'b2Vocs').at(-1),{cls:'1'});
  assert.deepEqual(await page.locator('[data-voc]').evaluateAll(els=>els.map(e=>e.dataset.voc)),['V261016-002','R7','V261015-001'],'only this class');
  assert.match(await page.locator('[data-voc="V261016-002"]').innerText(),/운영팀 답글/);
  await page.locator('[data-voc="V261016-002"]').click();
  await page.waitForTimeout(300);
  assert.deepEqual(sent(posts,'b2VocSeen'),[{key:'V261016-002',sig:'',cls:'1',side:'담임'}]);
  await page.locator('#t2Voc[hidden]').waitFor({state:'attached'});
  assert.match(await page.locator('.b2-msg.ops').innerText(),/운영팀[\s\S]*확인 중입니다/);
  await page.locator('[data-type="교육생 고충"]').click();
  await page.locator('[data-f="detail"]').fill('가상 교육생 상담 요청');
  await page.getByRole('button',{name:'접수하기'}).click();
  await page.waitForTimeout(300);
  assert.deepEqual(sent(posts,'b2VocCreate'),[{cls:'1',type:'교육생 고충',detail:'가상 교육생 상담 요청',side:'담임'}]);
  await toastHas(page,'접수했습니다 · V261016-003');
 });
});
