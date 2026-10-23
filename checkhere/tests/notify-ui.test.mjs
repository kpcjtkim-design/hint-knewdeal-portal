import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

// 알림함·머리글 종(모든 사용자)과 출결대조 메모 빠른 칩(사용자 요청 2026-10-19). 실제 index.html을 열고 Firebase·/api/teacher-beta는 가짜로 답합니다.
// cohort.mjs는 Firebase 값만 채우고 담임 화면을 연 사본으로 줍니다(2기 Firebase 값이 비어 있으면 로그인 화면에서 멈추므로). 사람 이름·이메일은 모두 가상입니다.
const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
const A1='hint.kpc@gmail.com',A2='kpc.jtkim@gmail.com',T='teacher@test.kr';
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:'해당없음',check:'',prov:'직접 입력',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
const BUNDLE={rev:5,today:'2026-10-28',days:['2026-10-27','2026-10-28','2026-10-29'],classes:Array.from({length:16},(_,i)=>({id:String(i+1),region:'권역',course:`과정${i+1}`,teacher:i===0?'가상담임':''})),
 roster:[['1','고다원','재학',''],['1','김동진','재학',''],['3','가상교육생','재학','']],ledgerCols:COLS,ledger:[L('2026-10-28','1','고다원','결석',{reason:'개인 사정'})],sync:{checkedAt:0,changedAt:0,last:{errors:[]}}};
const PORTAL={cls:1,region:'권역',course:'과정1',teacher:'가상담임',place:'본관',mainDay:'2026-10-28',days:['2026-10-28'],week:[],summary:[{k:'총원',v:2}],kids:[{name:'고다원',status:'재학',off:''},{name:'김동진',status:'재학',off:''}],recs:{},checks:[],closed:'미확인',evals:[],sats:[],vocs:[],officer:{}};
const VOCS={statuses:['접수','처리중','완료','보류'],types:['수업·강사','시설·환경','출결','행정·서류','교육생 고충','안전','기타'],state:{rev:3,admin:1,open:{'3':1},teacher:{}},rows:[
 {key:'V261028-001',id:'V261028-001',sig:'s1',date:'2026-10-28',cls:'3',type:'시설·환경',detail:'가상 강의장 냉방 고장',status:'접수',author:'teacher3@test.kr',lastBy:'담임',lastAt:'2026-10-28 10:00:00',seen:'',thread:[],action:'',done:'',days:'1'}]};
const DOCS={rev:5,statuses:['접수','처리중','보완 필요','처리완료','취소'],types:['출석부','교육참여확인서','훈련생 확인서','기타'],delivery:['이메일(PDF)','담임 전달','우편'],rows:[]};
const NOW=Date.now(),SEC=Math.floor(NOW/1000);
const nid=(ms,s)=>'n'+String(1e13-ms).padStart(13,'0')+'-'+s;
const NOTES=[
 {id:nid(NOW-60000,'memo'),kind:'출결대조 메모',title:'출결대조 메모 · 1반 고다원',body:'10/27(화) 수기출석 사인 미비',cls:'1',link:'#b2ledger?cls=1&date=2026-10-27',to:[A1],toRole:'admin',from:A2,readBy:[A2],createdAt:{seconds:SEC-60}},
 {id:nid(NOW-3600000,'docs'),kind:'서류발급',title:'서류발급 신청 · 3반 가상교육생',body:'출석부 1부 · 제출처 가상기관',cls:'3',link:'#b2docs?cls=3&id=D261028-001',to:[A1,A2],toRole:'admin',from:'teacher3@test.kr',readBy:['teacher3@test.kr'],createdAt:{seconds:SEC-3600}},
 {id:nid(NOW-7200000,'voc1'),kind:'민원',title:'민원·이슈 접수 · 3반 시설·환경',body:'가상 강의장 냉방 고장',cls:'3',link:'#b2vocs?cls=3&id=V261028-001',to:[],toRole:'admin',from:'teacher3@test.kr',readBy:['teacher3@test.kr',A1],createdAt:{seconds:SEC-7200}},
 {id:nid(NOW-100000,'voc2'),kind:'민원',title:'민원·이슈 답글 · 1반 행정·서류',body:'확인 중입니다',cls:'1',link:'#b2vocs?cls=1&id=V261028-002',to:[T],toClass:'1',from:A2,readBy:[A2],createdAt:{seconds:SEC-100}}];
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
window.pushNotes=list=>{window.NOTES=list;window.snapCbs.filter(e=>e.path==='notifications').forEach(deliver);};
export const setDoc=async(ref,data)=>{if(window.failNotify&&ref.path.startsWith('notifications/'))throw Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async ref=>snap(window.docStore[ref.path]),set(){},update(){},delete(){}});
export const writeBatch=()=>{const ops=[];return {set(){},update:(ref,data)=>ops.push(['batch.update',ref.path,data]),delete(){},commit:async()=>{window.sdkWrites.push(...ops,['batch.commit']);}};};`;
const AUTH_STUB=email=>`
export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'${email}',displayName:'가상',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml'};
// 2기 Firebase 값은 아직 비어 있어 시험용 값만 채우고, 담임 화면을 엽니다.
const cohortSource=()=>readFileSync(join(base,'cohort.mjs'),'utf8').replace('"apiKey": ""','"apiKey": "fixture-key"').replace('"appId": ""','"appId": "fixture-app"').replace('"teacherAccess": false','"teacherAccess": true');

async function portal(run,{email=A1,notes=NOTES}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],posts=[],memos=new Map([['1|김동진|2026-10-28',{memo:'증빙 미제출',by:A2}]]);
 page.on('pageerror',e=>errors.push(e.message));
 const answer=b=>{
  const a=b.action,p=b.args?.[0]||{};
  if(a==='portalData')return PORTAL;if(a==='b2Bundle')return BUNDLE;if(a==='b2Rev')return {rev:BUNDLE.rev,sync:BUNDLE.sync};
  if(a==='b2Docs')return DOCS;if(a==='b2DocCreate')return {id:'D261028-002',mailed:true,cls:p.cls,kind:'서류발급'};
  if(a==='b2Vocs')return VOCS;if(a==='b2VocReply')return {ok:true,id:p.key,state:VOCS.state};if(a==='b2VocCreate')return {id:'V261028-003',state:VOCS.state};
  if(a==='b2LedgerMemos')return {rev:BUNDLE.rev,rows:[...memos].filter(([k])=>!p.cls||k.startsWith(p.cls+'|')).map(([k,v],i)=>{const [cls,name,date]=k.split('|');return {row:i+2,date,cls,name,memo:v.memo,by:v.by};})};
  if(a==='b2LedgerMemo'){const k=`${p.cls}|${p.name}|${p.date}`;if(p.memo)memos.set(k,{memo:p.memo,by:email});else memos.delete(k);return {ok:true,id:k,cls:p.cls,kind:'출결대조 메모',row:9,rev:BUNDLE.rev+1};}
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
const sent=(posts,action)=>posts.filter(p=>p.action===action).map(p=>p.args[0]);
const notes=page=>page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='set'&&w[1].startsWith('notifications/')).map(w=>w[2]));
const toastHas=(page,text)=>page.waitForFunction(t=>(document.getElementById('toast')?.textContent||'').includes(t),text,{timeout:5000});

test('admins see unread notifications on the header bell, open the 알림 page, filter, mark read and jump to the linked screen',async()=>{
 await portal(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  const bell=page.locator('.hint-bell');
  await page.locator('.hint-bell .n',{hasText:'2'}).waitFor();
  assert.equal(await bell.getAttribute('aria-label'),'알림 · 안 읽음 2건','the read 민원 and the class-only teacher reply do not count');
  await bell.click();
  await page.getByRole('heading',{name:'알림',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.admin-tabs .tab').allInnerTexts(),['홈','알림']);
  assert.deepEqual(await page.locator('[data-note] b').allInnerTexts(),['출결대조 메모 · 1반 고다원','서류발급 신청 · 3반 가상교육생','민원·이슈 접수 · 3반 시설·환경'],'newest first, only mine');
  assert.deepEqual(await page.locator('[data-filter]').allInnerTexts(),['전체3','안 읽음2']);
  await page.locator('[data-filter="unread"]').click();
  assert.equal(await page.locator('[data-note]').count(),2);
  await page.locator('[data-kind]').selectOption('서류발급');
  assert.deepEqual(await page.locator('[data-note] b').allInnerTexts(),['서류발급 신청 · 3반 가상교육생']);
  await page.locator('[data-note] [data-read]').click();
  await page.locator('.hint-bell .n',{hasText:'1'}).waitFor();
  const docsId=NOTES[1].id;
  assert.deepEqual(await page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='update')),[['update',`notifications/${docsId}`,{readBy:{union:[A1]}}]]);
  assert.equal(await page.locator('[data-note]').count(),0,'the unread filter empties');
  await page.getByText('안 읽은 알림이 없습니다.').waitFor();
  // 새 알림이 오면 종 숫자가 바로 올라갑니다.
  await page.evaluate(n=>window.pushNotes([...window.NOTES,n]),{id:'n0000000000001-live',kind:'민원',title:'민원·이슈 답글 · 5반 기타',body:'가상 답글',cls:'5',link:'#b2vocs?cls=5',to:[],toRole:'admin',from:'teacher5@test.kr',readBy:[],createdAt:{seconds:SEC}});
  await page.locator('.hint-bell .n',{hasText:'2'}).waitFor();
  // 출결대조 메모 알림을 누르면 읽음으로 바뀌고 그 반·날짜 출결대조로 갑니다.
  await page.locator('[data-kind]').selectOption('');await page.locator('[data-filter="all"]').click();
  await page.locator('[data-note]',{hasText:'출결대조 메모 · 1반 고다원'}).click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  await page.locator('tr[data-name="고다원"]').waitFor();
  assert.equal(await page.locator('#b2Class').inputValue(),'1');assert.equal(await page.locator('#b2Date').inputValue(),'2026-10-27');
  assert.ok((await page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='update').map(w=>w[1]))).includes(`notifications/${NOTES[0].id}`));
  await page.locator('.hint-bell .n',{hasText:'1'}).waitFor();
 });
});

test('출결대조 memo chips save at once apart from the batch drafts, show next to the name and notify the admins; a failed notification only warns',async()=>{
 await portal(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.getByRole('button',{name:'출결',exact:true}).click();
  await page.getByRole('heading',{name:'출결대조'}).waitFor();
  const go=page.locator('tbody[data-student="고다원"]'),dong=page.locator('tbody[data-student="김동진"]');
  await dong.locator('.b2-memo-tag.has',{hasText:'메모 · 증빙 미제출'}).waitFor();
  assert.deepEqual(sent(posts,'b2LedgerMemos'),[{cls:'1',from:'2026-10-27',to:'2026-10-28'}],'memos for the class period are read once');
  assert.equal(await go.locator('.b2-memo-tag').innerText(),'+ 메모');
  assert.equal(await go.locator('tr[data-memo-row]').isHidden(),true);
  // 김동진 행에 출결 초안을 만들어 둡니다(메모는 이것과 따로 저장).
  await dong.locator('select[data-inline="type"]').selectOption('결석');
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장');
  // 빠른 칩: 누르면 바로 저장 + 알림
  await go.locator('.b2-memo-tag').click();
  // '수기출석 공통메모 사항'은 반·날짜 공통메모(도구줄 「공통메모」)로 옮겨 학생 메모에는 증빙 칩만 남습니다(2026-10-20, day-memo-ui.test.mjs).
  assert.deepEqual(await go.locator('.b2-memo-edit .b2-req-head').allInnerTexts(),['출결대조 메모'],'no 수기출석 group under a student');
  assert.equal(await go.locator('[data-memo-group]').count(),0);
  assert.deepEqual(await go.locator('[data-memo-pick]').allInnerTexts(),['증빙 미제출','증빙 보완 필요','증빙 확인 완료']);
  await go.locator('[data-memo-pick="증빙 보완 필요"]').click();
  await go.locator('.b2-memo-tag.has',{hasText:'메모 · 증빙 보완 필요'}).waitFor();
  await toastHas(page,'고다원 · 10/28(수) 출결대조 메모를 저장했습니다.');
  assert.deepEqual(sent(posts,'b2LedgerMemo'),[{cls:'1',name:'고다원',date:'2026-10-28',memo:'증빙 보완 필요',was:''}],'was = 화면이 본 메모(시트 v23)');
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[1].startsWith('notifications/')));
  const [n1]=await notes(page);
  assert.deepEqual(n1,{kind:'출결대조 메모',title:'출결대조 메모 · 1반 고다원',body:'10/28(수) 증빙 보완 필요',cls:'1',link:'#b2ledger?cls=1&date=2026-10-28',to:[A2],from:A1,readBy:[A1],toRole:'admin',createdAt:'ts'});
  await page.waitForFunction(()=>true);
  await page.waitForTimeout(200);
  assert.equal(sent(posts,'b2LedgerMemos').length,2,'read again after the save');
  assert.equal(await go.locator('[data-memo-pick="증빙 보완 필요"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장','the memo is not a draft and the draft stays');
  assert.equal(await dong.locator('select[data-inline="type"]').inputValue(),'결석');
  assert.equal(sent(posts,'b2Save').length,0);
  // 직접 입력(100자) → Enter 저장. 다른 학생 줄을 열면 앞 줄은 닫힙니다.
  await dong.locator('.b2-memo-tag').click();
  assert.equal(await go.locator('tr[data-memo-row]').isHidden(),true);
  await dong.locator('[data-memo-custom]').click();
  const input=dong.locator('[data-memo-input]');
  assert.equal(await input.inputValue(),'증빙 미제출');assert.equal(await input.getAttribute('maxlength'),'100');
  // 직접 입력 중에는 칩 글이 칸에 덧붙고 저장되지 않습니다. 같은 글은 두 번 붙지 않습니다.
  const memoSaves=sent(posts,'b2LedgerMemo').length;
  await dong.locator('[data-memo-pick="증빙 보완 필요"]').click();
  assert.equal(await input.inputValue(),'증빙 미제출 · 증빙 보완 필요');
  assert.equal(await input.evaluate(e=>e===document.activeElement),true,'the input keeps the focus');
  await dong.locator('[data-memo-pick="증빙 보완 필요"]').click();
  assert.equal(await input.inputValue(),'증빙 미제출 · 증빙 보완 필요','the same text is not added twice');
  assert.equal(sent(posts,'b2LedgerMemo').length,memoSaves,'appending does not save');
  await input.fill('수기출석 사인 늦게 받음');await input.press('Enter');
  await dong.locator('.b2-memo-tag.has',{hasText:'메모 · 수기출석 사인 늦게 받음'}).waitFor();
  assert.deepEqual(sent(posts,'b2LedgerMemo').at(-1),{cls:'1',name:'김동진',date:'2026-10-28',memo:'수기출석 사인 늦게 받음',was:'증빙 미제출'});
  assert.equal(await page.locator('#b2SaveAll').innerText(),'변경 1건 저장');
  // 지우기: 빈 메모로 저장(지움)하고 알림도 남깁니다.
  await dong.locator('[data-memo-clear]').click();
  await dong.locator('.b2-memo-tag',{hasText:'+ 메모'}).waitFor();
  assert.deepEqual(sent(posts,'b2LedgerMemo').at(-1),{cls:'1',name:'김동진',date:'2026-10-28',memo:'',was:'수기출석 사인 늦게 받음'});
  await page.waitForFunction(()=>window.sdkWrites.filter(w=>w[1].startsWith('notifications/')).length===3);
  assert.equal((await notes(page)).at(-1).body,'10/28(수) 메모를 지웠습니다 (전: 수기출석 사인 늦게 받음)');
  // 알림을 못 남겨도 메모는 저장되고 작은 안내만 뜹니다.
  await page.evaluate(()=>{window.failNotify=true;});
  await go.locator('.b2-memo-tag').click();
  await go.locator('[data-memo-pick="증빙 미제출"]').click();
  await go.locator('.b2-memo-tag.has',{hasText:'메모 · 증빙 미제출'}).waitFor();
  await toastHas(page,'알림을 남기지 못했습니다(출결대조 메모) · 저장은 됐습니다');
  assert.equal((await notes(page)).length,3);
  // 모아 저장은 그대로: 김동진 결석 초안만 저장됩니다.
  await page.locator('#b2SaveAll').click();
  await page.waitForFunction(()=>document.querySelector('#b2SaveAll')?.textContent==='변경 0건 저장');
  assert.deepEqual(sent(posts,'b2Save').map(p=>[p.name,p.type]),[['김동진','결석']]);
 });
});

test('민원 replies from the office notify that class\'s teachers and the author; a teacher sees them on the bell and files a 서류발급 that notifies the office',async()=>{
 await portal(async(page,posts)=>{
  await page.getByRole('heading',{name:'2기 홈'}).waitFor();
  await page.getByRole('button',{name:'민원·이슈',exact:true}).click();
  await page.getByRole('heading',{name:'민원·이슈 처리함'}).waitFor();
  await page.locator('[data-voc="V261028-001"] [data-voc-toggle]').click();
  await page.locator('[data-reply]').fill('내일 수리 기사가 방문합니다');
  await page.locator('[data-voc-body] [data-status="처리중"]').click();
  await page.getByRole('button',{name:'보내기'}).click();
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[1].startsWith('notifications/')));
  assert.deepEqual(await notes(page),[{kind:'민원',title:'민원·이슈 답글 · 3반 시설·환경',body:'[처리 상태 처리중] 내일 수리 기사가 방문합니다',cls:'3',link:'#b2vocs?cls=3&id=V261028-001',to:['teacher3@test.kr'],from:A1,readBy:[A1],toClass:'3',createdAt:'ts'}]);
 });
 await portal(async(page,posts)=>{
  await page.locator('[data-main="today"]').waitFor();
  await page.locator('.hint-bell .n',{hasText:'1'}).waitFor();
  await page.locator('.hint-bell').click();
  const panel=page.locator('[data-panel="notify"]');
  await panel.getByRole('heading',{name:'알림',exact:true}).waitFor();
  assert.deepEqual(await panel.locator('[data-note] b').allInnerTexts(),['민원·이슈 답글 · 1반 행정·서류'],'class 1 and my address only');
  await panel.locator('[data-note]').click();
  await page.getByRole('heading',{name:'민원·이슈',exact:true}).waitFor();
  assert.equal(await page.locator('[data-subtab="voc"]').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.hint-bell .n').isHidden(),true);
  assert.deepEqual(await page.evaluate(()=>window.sdkWrites.filter(w=>w[0]==='update').map(w=>[w[1],w[2]])),[[`notifications/${NOTES[3].id}`,{readBy:{union:[T]}}]]);
  // 서류발급 신청 → 운영 관리자 알림
  await page.locator('[data-main="documents"]').click();
  await page.locator('[data-g="name"]').selectOption('김동진');
  await page.locator('[data-doctype="체크히어 출석부"]').click(); // 서류 종류는 고르기(2026-10-20)
  await page.locator('[data-g="submitTo"]').fill('가상 운영기관');
  await page.locator('[data-g="due"]').fill('2026-11-02');
  await page.getByRole('button',{name:'신청하기'}).click();
  await page.waitForFunction(()=>window.sdkWrites.some(w=>w[1].startsWith('notifications/')));
  assert.equal(sent(posts,'b2DocCreate').length,1);
  assert.deepEqual(await notes(page),[{kind:'서류발급',title:'서류발급 신청 · 1반 김동진',body:'체크히어 출석부 1부 · 제출처 가상 운영기관 · 마감 11/2(월)',cls:'1',link:'#b2docs?cls=1&id=D261028-002',to:[A1,A2],from:T,readBy:[T],toRole:'admin',createdAt:'ts'}]);
 },{email:T});
});
