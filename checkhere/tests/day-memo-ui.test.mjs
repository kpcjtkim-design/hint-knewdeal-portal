import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import handler,{b2Args,FIREBASE,ACCESS} from '../../api/teacher-beta.js';

// 반·날짜 공통메모(사용자 요청 2026-10-20 '상단 바에 체크히어 불일치 옆에 전체 공통으로 쓸 수 있는 메모 … 담임에게도 알림이 가게',
// 추가 지시 '수기출석 공통메모 사항에서는 사유 오류 넣을 수 있게(시스템오류 누락) 등'). 시트 v17 계약(b2DayMemo·b2DayMemos)은 아래 가짜가 흉내 냅니다.
// 실제 index.html을 열고 Firebase·/api/teacher-beta는 가짜로 답합니다. 사람 이름·이메일은 모두 가상입니다.
const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const A1='hint.kpc@gmail.com',A2='kpc.jtkim@gmail.com',T='teacher@test.kr';
const HAND=['수기출석 사인 미비','수기출석 미제출','수기출석 확인 완료','수기출석 시간 미기재','수기출석 서명 상이'];
const ERRS=['체크히어 시스템 오류','체크히어 기록 누락','입·퇴실 기록 누락','사유 오류(재확인 필요)','단말·네트워크 오류','기타 오류'];
const CONFLICT='그사이 바뀌었습니다. 새로 읽어 주세요.';

/* ---------- Vercel 중계(api/teacher-beta.js) ---------- */
const SHEET='https://script.test/exec',KEY='secret-key-123';
const PROFILES={'teacher@test.kr':{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'}}};
function backend(t,{sheet=body=>Response.json({ok:true,data:{rows:[],echo:body.args}})}={}){
 const calls=[],saved={...FIREBASE},access=ACCESS.teacher,env={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 Object.assign(FIREBASE,{ready:true,key:'fb-key',project:'hint-test'});ACCESS.teacher=true;process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY=KEY;
 t.after(()=>{Object.assign(FIREBASE,saved);ACCESS.teacher=access;for(const [k,v] of [['HINT_SHEET_API_URL',env.url],['HINT_SHEET_API_KEY',env.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  url=String(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){const {idToken}=JSON.parse(init.body);return Response.json({users:[{email:idToken.slice(4)}]});}
  if(url.startsWith('https://firestore.googleapis.com/')){const email=decodeURIComponent(url.split('/users/')[1]);return PROFILES[email]?Response.json({fields:PROFILES[email]}):Response.json({},{status:404});}
  if(url===SHEET){const body=JSON.parse(init.body);calls.push(body);return sheet(body);}
  throw Error('unexpected fetch '+url);
 });
 return calls;
}
async function call(body,email=A1){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer tok:${email}`},body},res);return res;
}

test('the day memo actions: only admins write (class checked, only date·memo·was pass), teachers read their own class only, an old sheet answers SHEET_OUTDATED',async t=>{
 const calls=backend(t);
 let res=await call({action:'b2DayMemo',args:[{cls:'4',date:'2026-11-13',memo:'수기출석 사인 미비',was:'',name:'끼어든 칸',row:9}]});
 assert.equal(res.statusCode,200);
 assert.deepEqual(calls.at(-1),{key:KEY,action:'b2DayMemo',args:[{cls:'4',date:'2026-11-13',memo:'수기출석 사인 미비',was:''}],actor:A1,role:'ADMIN'});
 await call({action:'b2DayMemo',args:[{cls:'4',date:'2026-11-13',memo:''}]});assert.deepEqual(calls.at(-1).args,[{cls:'4',date:'2026-11-13',memo:''}],'clearing sends an empty memo');
 await call({action:'b2DayMemos',args:[{}]});assert.deepEqual(calls.at(-1).args,[{}],'admins read every class');
 await call({action:'b2DayMemos',args:[{cls:'all',from:'2026-11-01'}]});assert.deepEqual(calls.at(-1).args,[{from:'2026-11-01'}]);
 await call({action:'b2DayMemos',args:[{cls:'5'}]});assert.deepEqual(calls.at(-1).args,[{cls:'5'}]);
 const before=calls.length;
 for(const arg of [{cls:'18',date:'2026-11-13',memo:'x'},{date:'2026-11-13',memo:'x'}]){res=await call({action:'b2DayMemo',args:[arg]});assert.deepEqual([res.statusCode,res.body.code],[400,'BAD_CLASS']);}
 res=await call({action:'b2DayMemo',args:[{cls:'3',date:'2026-11-13',memo:'담임이 씀'}]},T);assert.deepEqual([res.statusCode,res.body.code],[403,'ADMIN_ONLY']);
 assert.equal(calls.length,before,'refused writes never reach the sheet');
 for(const [arg,want] of [[{},{cls:'3'}],[{cls:'all'},{cls:'3'}],[{cls:'9',from:'2026-11-01'},{cls:'3',from:'2026-11-01'}]]){
  res=await call({action:'b2DayMemos',args:[arg]},T);
  assert.equal(res.statusCode,200);assert.deepEqual([calls.at(-1).args,calls.at(-1).role],[[want],'TEACHER'],JSON.stringify(arg));
 }
 assert.deepEqual(b2Args({role:'TEACHER',classIds:['3','7']},'b2DayMemos',[{cls:'7'}]),[{cls:'7'}],'a temporary class of the teacher is kept');
 t.mock.restoreAll();backend(t,{sheet:()=>Response.json({ok:false,error:'unknown action'})});
 res=await call({action:'b2DayMemos',args:[{cls:'1'}]});assert.deepEqual([res.statusCode,res.body.code],[400,'SHEET_OUTDATED']);
 t.mock.restoreAll();backend(t,{sheet:()=>Response.json({ok:false,error:CONFLICT})});
 res=await call({action:'b2DayMemo',args:[{cls:'1',date:'2026-11-13',memo:'x',was:'옛 글'}]});assert.deepEqual([res.statusCode,res.body],[400,{ok:false,error:CONFLICT}]);
});

/* ---------- 화면(가짜 시트) ---------- */
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:'해당없음',check:'',prov:'직접 입력',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
const BUNDLE={rev:5,today:'2026-10-28',days:['2026-10-27','2026-10-28','2026-10-29'],classes:Array.from({length:16},(_,i)=>({id:String(i+1),region:'권역',course:`과정${i+1}`,teacher:i===0?'가상담임':''})),
 roster:[['1','고다원','재학',''],['1','김동진','재학',''],['3','가상교육생','재학','']],ledgerCols:COLS,ledger:[L('2026-10-28','1','고다원','결석',{reason:'개인 사정'})],sync:{checkedAt:0,changedAt:0,last:{errors:[]}}};
const PORTAL={cls:1,region:'권역',course:'과정1',teacher:'가상담임',place:'본관',mainDay:'2026-10-28',days:['2026-10-28'],week:[],summary:[{k:'총원',v:2}],kids:[{name:'고다원',status:'재학',off:''},{name:'김동진',status:'재학',off:''}],recs:{},checks:[],closed:'미확인',evals:[],sats:[],vocs:[],officer:{}};
const NOW=Date.now(),SEC=Math.floor(NOW/1000);
const SDK_STUB=`
window.sdkWrites=[];window.docStore=window.docStore||{};window.snapCbs=[];
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/'),id:p[p.length-1]}),collection=(db,...p)=>({path:p.join('/')}),where=(field,op,value)=>({field,op,value}),orderBy=()=>({}),limit=n=>({limit:n}),documentId=()=>'id',serverTimestamp=()=>'ts',arrayUnion=(...v)=>({union:v});
export const query=(c,...cs)=>({path:c.path,filters:cs.filter(x=>x&&x.field)});
const PROFILES={'users/${T}':{role:'TEACHER',active:true,primaryClassId:'1',name:'가상담임'},'classes/1':{course:'과정1',region:'권역',coreLinks:{}}};
export const getDoc=async ref=>snap(window.docStore[ref.path]??PROFILES[ref.path]);
export const getDocFromServer=async()=>snap(undefined);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
const hit=(n,fs)=>fs.every(f=>f.op==='array-contains'?(n[f.field]||[]).includes(f.value):n[f.field]===f.value);
const deliver=e=>{const list=(window.NOTES||[]).filter(n=>hit(n,e.filters||[]));e.cb({docs:list.map(({id,...d})=>({id,data:()=>d}))});};
export const onSnapshot=(ref,a,b,c)=>{const [cb,err]=typeof a==='function'?[a,b]:[b,c],e={path:ref.path,filters:ref.filters,cb,err};window.snapCbs.push(e);if(ref.path==='notifications')setTimeout(()=>{if(window.snapCbs.includes(e))deliver(e);},0);return()=>{window.snapCbs=window.snapCbs.filter(x=>x!==e);};};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async ref=>snap(window.docStore[ref.path]),set(){},update(){},delete(){}});
export const writeBatch=()=>{const ops=[];return {set(){},update:(ref,data)=>ops.push(['batch.update',ref.path,data]),delete(){},commit:async()=>{window.sdkWrites.push(...ops,['batch.commit']);}};};`;
const AUTH_STUB=email=>`
export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'${email}',displayName:'가상',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml'};
const cohortSource=()=>readFileSync(join(base,'cohort.mjs'),'utf8').replace('"apiKey": ""','"apiKey": "fixture-key"').replace('"appId": ""','"appId": "fixture-app"').replace('"teacherAccess": false','"teacherAccess": true');

// days: 시트의 공통메모 줄('반|날짜' → {memo,by,at,editedBy,editedAt}). outdated면 v17 전 시트(Vercel이 SHEET_OUTDATED로 돌려줌).
async function portal(run,{email=A1,notes=[],days=new Map(),outdated=false}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 const fail=(error,code)=>({fail:{ok:false,error,...(code?{code}:{})}});
 const answer=b=>{
  const a=b.action,p=b.args?.[0]||{};
  if(a==='portalData')return PORTAL;if(a==='b2Bundle')return BUNDLE;if(a==='b2Rev')return {rev:BUNDLE.rev,sync:BUNDLE.sync};
  if(a==='b2LedgerMemos')return {rev:BUNDLE.rev,rows:[]};
  if((a==='b2DayMemos'||a==='b2DayMemo')&&outdated)return fail('마스터시트 데이터 API에 아직 없는 기능입니다. Apps Script를 새 코드로 다시 배포해 주세요.','SHEET_OUTDATED');
  if(a==='b2DayMemos')return {rev:BUNDLE.rev,rows:[...days].filter(([k])=>!p.cls||k.startsWith(p.cls+'|')).map(([k,v])=>{const [cls,date]=k.split('|');return {cls,date,editedBy:'',editedAt:'',...v};})};
  if(a==='b2DayMemo'){
   // 시트 v17 계약: was가 지금 값과 다르면 거절, 같은 값이면 unchanged(rev 그대로), 빈 글이면 지움, 아니면 {row,memo,by(처음),at(처음),rev}
   const k=`${p.cls}|${p.date}`,old=days.get(k),cur=old?.memo||'';
   if(String(p.was??'')!==cur)return fail(CONFLICT);
   if(String(p.memo)===cur)return {ok:true,unchanged:true};
   if(!p.memo){days.delete(k);return {ok:true,removed:true,memo:'',rev:BUNDLE.rev};}
   const next={memo:p.memo,by:old?.by||email,at:old?.at||'2026-10-28 10:00',editedBy:old?email:'',editedAt:old?'2026-10-28 10:05':''};days.set(k,next);
   return {ok:true,row:3,memo:p.memo,by:next.by,at:next.at,rev:BUNDLE.rev};
  }
  return {};
 };
 try{
  await page.addInitScript(n=>{window.NOTES=n;},notes);
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href===SDK+'firebase-firestore.js')return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB(email)});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(url.pathname==='/cohort.mjs')return route.fulfill({contentType:'text/javascript',body:cohortSource()});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);const out=answer(body);
    return route.fulfill(out?.fail?{status:400,contentType:'application/json',body:JSON.stringify(out.fail)}:{contentType:'application/json',body:JSON.stringify({ok:true,data:out})});
   }
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test/');
  await run(page,posts);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const sent=(posts,action)=>posts.filter(p=>p.action===action).map(p=>p.args[0]);
const notes=page=>page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='set'&&w[1].startsWith('notifications/')).map(w=>w[2]));
const toastHas=(page,text)=>page.waitForFunction(t=>(document.getElementById('toast')?.textContent||'').includes(t),text,{timeout:5000});
async function openLedger(page){
 await page.getByRole('heading',{name:'2기 홈'}).waitFor();
 await page.getByRole('button',{name:'출결',exact:true}).click();
 await page.getByRole('heading',{name:'출결대조'}).waitFor();
 await page.locator('tr[data-name="고다원"]').waitFor();
}

test('출결대조 공통메모: right after 체크히어 불일치, chips from two groups append, unsaved text guards the date, saving notifies the class teacher and admins, a conflict shows the latest, clearing sends no notice',async()=>{
 const days=new Map([['1|2026-10-27',{memo:'단말 점검일',by:A2,at:'2026-10-27 09:00'}]]);
 await portal(async(page,posts)=>{
  await openLedger(page);
  const chip=page.locator('#b2DayMemoBtn'),box=page.locator('#b2DayMemo'),input=box.locator('[data-daymemo-input]');
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 없음'}).waitFor();
  assert.deepEqual(await page.locator('#b2Filters button').allInnerTexts(),['전체','출석 외','체크히어 불일치','공통메모 없음','추가 증빙0'],'the day memo sits between 체크히어 불일치 and 추가 증빙');
  assert.deepEqual(sent(posts,'b2DayMemos'),[{cls:'1'}],'the class is read once');
  assert.equal(await box.isHidden(),true);
  // 학생 메모에는 수기출석 묶음이 없습니다.
  await page.locator('tbody[data-student="고다원"] [data-memo-toggle]').click();
  assert.equal(await page.locator('tbody[data-student="고다원"] [data-memo-pick^="수기출석"]').count(),0);
  assert.deepEqual(await page.locator('tbody[data-student="고다원"] [data-memo-pick]').allInnerTexts(),['증빙 미제출','증빙 보완 필요','증빙 확인 완료']);
  await page.locator('tbody[data-student="고다원"] [data-memo-close]').click();

  // 열기: 두 묶음(수기출석 · 오류·사유) 빠른 문구와 500자 칸
  await chip.click();
  await input.waitFor();
  assert.equal(await chip.getAttribute('aria-expanded'),'true');
  assert.deepEqual(await box.locator('[data-daymemo-group] .b2-req-head').allInnerTexts(),['수기출석','오류·사유']);
  assert.deepEqual(await box.locator('[data-daymemo-group="수기출석"] [data-daymemo-pick]').allInnerTexts(),HAND);
  assert.deepEqual(await box.locator('[data-daymemo-group="오류·사유"] [data-daymemo-pick]').allInnerTexts(),ERRS);
  assert.equal(await input.getAttribute('maxlength'),'500');
  assert.equal(await box.locator('[data-daymemo-last]').innerText(),'아직 공통메모가 없습니다');
  assert.equal(await box.locator('[data-daymemo-clear]').count(),0,'nothing to clear yet');
  // 문구는 글 끝에 ' · '로 덧붙고(같은 글은 한 번), 저장하지 않습니다.
  await box.locator('[data-daymemo-pick="수기출석 사인 미비"]').click();
  await box.locator('[data-daymemo-pick="체크히어 시스템 오류"]').click();
  await box.locator('[data-daymemo-pick="수기출석 사인 미비"]').click();
  assert.equal(await input.inputValue(),'수기출석 사인 미비 · 체크히어 시스템 오류');
  assert.equal(await input.evaluate(e=>e===document.activeElement),true,'the box keeps the focus');
  await input.press('End');await input.pressSequentially(' (오전)');
  assert.equal(await input.inputValue(),'수기출석 사인 미비 · 체크히어 시스템 오류 (오전)');
  assert.equal(await box.locator('[data-daymemo-count]').innerText(),'29/500자');
  await chip.locator('.b2-dirty',{hasText:'저장 전'}).waitFor();
  assert.equal(sent(posts,'b2DayMemo').length,0,'chips and typing never save');

  // 저장하지 않은 글: 날짜를 바꾸려 하면 묻고, '아니오'면 그대로
  let asked='';page.once('dialog',d=>{asked=d.message();void d.dismiss();});
  await page.locator('#b2Date').selectOption('2026-10-27');
  await page.waitForFunction(()=>document.querySelector('#b2Date').value==='2026-10-28');
  assert.match(asked,/저장하지 않은 공통메모 글이 있습니다\. 날짜를 바꾸면 사라집니다/);
  assert.equal(await input.inputValue(),'수기출석 사인 미비 · 체크히어 시스템 오류 (오전)');
  // 닫기도 묻습니다('아니오'면 열린 채)
  page.once('dialog',d=>void d.dismiss());await box.locator('[data-daymemo-close]').click();
  assert.equal(await box.isHidden(),false);

  // 저장 → 시트 + 담임(toClass)·관리자 알림(담임은 출결판 그날로)
  await box.locator('[data-daymemo-save]').click();
  await toastHas(page,'1반 · 10/28(수) 공통메모를 저장했습니다.');
  assert.deepEqual(sent(posts,'b2DayMemo'),[{cls:'1',date:'2026-10-28',memo:'수기출석 사인 미비 · 체크히어 시스템 오류 (오전)',was:''}]);
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[1].startsWith('notifications/')));
  assert.deepEqual(await notes(page),[{kind:'출결대조 메모',title:'출결대조 공통메모 · 1반 10/28(수)',body:'수기출석 사인 미비 · 체크히어 시스템 오류 (오전)',cls:'1',link:'#b2ledger?cls=1&date=2026-10-28&memo=day',to:[A2],from:A1,readBy:[A1],toRole:'admin',toClass:'1',createdAt:'ts'}]);
  assert.equal(await box.isHidden(),true,'the box closes after saving');
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 · 수기출석 사인 미비 · 체크히어 시스템 오류…'}).waitFor();
  assert.equal(await chip.locator('.b2-dirty').count(),0);
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 0건 저장','the day memo is not a ledger draft');
  // 다시 열면 시트 값과 마지막 저장(고친 사람이 없으면 처음 쓴 사람·시각)
  for(let i=0;i<30&&sent(posts,'b2DayMemos').length<2;i++)await page.waitForTimeout(100);
  await chip.click();
  assert.equal(await input.inputValue(),'수기출석 사인 미비 · 체크히어 시스템 오류 (오전)');
  assert.equal(await box.locator('[data-daymemo-last]').innerText(),`마지막 저장 ${A1} · 2026-10-28 10:00`);
  // 바뀐 것 없이 저장하면 보내지 않고 닫기만
  await box.locator('[data-daymemo-save]').click();
  assert.equal(await box.isHidden(),true);assert.equal(sent(posts,'b2DayMemo').length,1);

  // 그사이 다른 관리자가 고침 → 거절, 최신 값을 다시 읽어 보이고 글은 남김 → 다시 저장하면 덮어씀
  days.set('1|2026-10-28',{memo:'다른 관리자 메모',by:A1,at:'2026-10-28 10:00',editedBy:A2,editedAt:'2026-10-28 10:03'});
  await chip.click();
  await input.fill('오후 수기출석 다시 받음');
  await input.press('Control+s'); // 공통메모 칸에서는 Ctrl+S가 공통메모 저장
  const conflict=box.locator('[data-daymemo-conflict]');await conflict.waitFor();
  assert.equal(await conflict.innerText(),`그사이 바뀜 · 시트 최신 값 「다른 관리자 메모」 (${A2} · 2026-10-28 10:03) · 다시 저장하면 이 글로 덮어씁니다`);
  assert.equal(await input.inputValue(),'오후 수기출석 다시 받음');
  assert.equal(await box.locator('[data-daymemo-last]').innerText(),`마지막 저장 ${A2} · 2026-10-28 10:03`,'editedBy·editedAt win over by·at');
  assert.equal((await notes(page)).length,1,'a refused save sends no notice');
  await box.locator('[data-daymemo-save]').click();
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 · 오후 수기출석 다시 받음'}).waitFor();
  assert.deepEqual(sent(posts,'b2DayMemo').at(-1),{cls:'1',date:'2026-10-28',memo:'오후 수기출석 다시 받음',was:'다른 관리자 메모'});
  await page.waitForFunction(()=>window.sdkWrites.filter(w=>w[1].startsWith('notifications/')).length===2);

  // 날짜를 바꾸면 그날 공통메모
  await page.locator('#b2Date').selectOption('2026-10-27');
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 · 단말 점검일'}).waitFor();
  await page.locator('#b2Date').selectOption('2026-10-28');
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 · 오후 수기출석 다시 받음'}).waitFor();

  // 지우기(확인 뒤): 빈 글로 저장, 알림 없음
  await chip.click();
  let cleared='';page.once('dialog',d=>{cleared=d.message();void d.accept();});
  await box.locator('[data-daymemo-clear]').click();
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 없음'}).waitFor();
  assert.equal(cleared,'1반 10/28(수) 공통메모를 지울까요?');
  assert.deepEqual(sent(posts,'b2DayMemo').at(-1),{cls:'1',date:'2026-10-28',memo:'',was:'오후 수기출석 다시 받음'});
  await toastHas(page,'1반 · 10/28(수) 공통메모를 지웠습니다.');
  assert.equal((await notes(page)).length,2,'clearing sends no notice');
  assert.equal(days.has('1|2026-10-28'),false);
 },{days});
});

test('before the sheet takes day memos (Apps Script v17 not deployed) 출결대조 shows 시트 업데이트 대기 and everything else keeps working; the teacher board just shows no memo',async()=>{
 await portal(async(page,posts)=>{
  await openLedger(page);
  await page.locator('#b2DayMemoBtn',{hasText:'공통메모 · 시트 업데이트 대기'}).waitFor();
  assert.match(await page.locator('#b2DayMemoBtn').getAttribute('title'),/Apps Script v17/);
  await page.locator('#b2DayMemoBtn').click();
  await page.locator('#b2DayMemo [data-daymemo-wait]').waitFor();
  assert.equal(await page.locator('#b2DayMemo [data-daymemo-input]').count(),0,'no editor without the sheet');
  assert.equal(await page.locator('#b2Msg').innerText(),'','no error banner');
  // 나머지는 그대로: 학생 메모·필터
  await page.locator('[data-filter="exceptions"]').click();
  assert.deepEqual(await page.locator('tbody[data-student]').evaluateAll(l=>l.map(x=>x.dataset.student)),['고다원']);
  assert.equal(sent(posts,'b2DayMemo').length,0);
 },{outdated:true});
 await portal(async(page,posts)=>{
  await page.locator('[data-main="attendance"]').click();
  await page.locator('.g select[data-n="고다원"]').first().waitFor();
  for(let i=0;i<30&&!sent(posts,'b2DayMemos').length;i++)await page.waitForTimeout(100);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.daymemo').count(),0);
 },{email:T,outdated:true});
});

test('the class teacher sees that day\'s common memo above the 출결판 (read-only), follows the bell notice to that day, and the admin 반 현황 lists it',async()=>{
 const days=new Map([['1|2026-10-28',{memo:'수기출석 미제출 · 체크히어 기록 누락\n오후 3시 이후 재확인',by:A1,at:'2026-10-28 10:00',editedBy:A2,editedAt:'2026-10-28 11:20'}],['1|2026-10-27',{memo:'단말·네트워크 오류',by:A2,at:'2026-10-27 09:00'}]]);
 const notice={id:'n'+String(1e13-(NOW-60000)).padStart(13,'0')+'-day1',kind:'출결대조 메모',title:'출결대조 공통메모 · 1반 10/27(화)',body:'단말·네트워크 오류',cls:'1',link:'#b2ledger?cls=1&date=2026-10-27&memo=day',to:[A2],toRole:'admin',toClass:'1',from:A1,readBy:[A1],createdAt:{seconds:SEC-60}};
 await portal(async(page,posts)=>{
  await page.locator('[data-main="attendance"]').click();
  const line=page.locator('.daymemo');await line.waitFor();
  assert.equal(await line.locator('b').innerText(),'공통메모 · 10/28(수)');
  assert.equal(await line.locator('span').innerText(),'수기출석 미제출 · 체크히어 기록 누락\n오후 3시 이후 재확인');
  assert.equal(await line.locator('small').innerText(),'운영팀 · 2026-10-28 11:20');
  assert.deepEqual(sent(posts,'b2DayMemos'),[{cls:'1'}]);
  assert.equal(await page.locator('.daymemo textarea, .daymemo button, .daymemo input').count(),0,'read-only');
  // 알림: 종 → 알림 → 공통메모 알림을 누르면 출결판, 그 날짜 공통메모와 그날 칸
  await page.locator('.hint-bell .n',{hasText:'1'}).waitFor();
  await page.locator('.hint-bell').click();
  const panel=page.locator('[data-panel="notify"]');
  await panel.locator('[data-note]',{hasText:'출결대조 공통메모 · 1반 10/27(화)'}).click();
  await page.locator('[data-subtab="board"][aria-selected="true"]').waitFor();
  await page.locator('.daymemo b',{hasText:'공통메모 · 10/27(화)'}).waitFor();
  assert.equal(await page.locator('.daymemo span').innerText(),'단말·네트워크 오류');
  await page.locator('.g th[data-day="2026-10-27"]').waitFor();
  // 학생 칸(10/28)을 고르면 그날 공통메모로
  await page.locator('.g select[data-n="김동진"][data-d="2026-10-28"]').focus();
  await page.locator('.daymemo b',{hasText:'공통메모 · 10/28(수)'}).waitFor();
  assert.equal(sent(posts,'b2DayMemo').length,0,'teachers never write');
 },{email:T,days,notes:[notice]});
 // 관리자 반 현황: '출결대조 메모·알림' 카드에 공통메모(고른 날 먼저)
 await portal(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.locator('.b2-class[data-class="1"]').click();
  await page.getByRole('heading',{name:'반 현황'}).waitFor();
  const card=page.locator('[data-section="memos"]');
  await card.locator('li[data-daymemo]').first().waitFor();
  assert.deepEqual(await card.locator('li[data-daymemo]').evaluateAll(l=>l.map(x=>[x.dataset.daymemo,x.classList.contains('on')])),[['2026-10-28',true],['2026-10-27',false]]);
  assert.match(await card.locator('li[data-daymemo="2026-10-27"]').innerText(),/공통[\s\S]*단말·네트워크 오류/);
  assert.deepEqual(sent(posts,'b2DayMemos'),[{cls:'1'}]);
 },{days});
});
