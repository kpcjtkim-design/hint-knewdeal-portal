import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
// 2기 시간표 원본 = 마스터시트 교육일정(사용자 2026-10-20 '시간표가 여기서 변경되면 담임·관리자 화면에서 반영. 그리고 관리자만 사이트에서 변경 가능. 이러면 시트에도 반영됨').
// 가짜 시트(b2Schedule·b2ScheduleSave 계약 모양)로 담임 보기·관리자 고치기·그사이 바뀜 거절, 그리고 beta2-data의 변경 번호 캐시를 확인합니다.
const firestoreMock=`window.docs=window.initialDocs||{};const pick=r=>r;export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=doc,serverTimestamp=()=>({seconds:1}),query=pick,where=()=>null,orderBy=()=>null,limit=()=>null,documentId=()=>'__id__',onSnapshot=()=>()=>{};
export async function getDoc(r){const d=window.docs[r.path];return{exists:()=>!!d,data:()=>structuredClone(d)};}export const getDocFromServer=getDoc;
export async function getDocs(r){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith(r.path+'/')).map(([k,v])=>({id:k.split('/').pop(),data:()=>structuredClone(v)}))};}export const getDocsFromServer=getDocs;
export async function setDoc(r,v){window.docs[r.path]=v;}export async function runTransaction(db,fn){const pending=[];const value=await fn({get:getDoc,set:(r,v)=>pending.push([r.path,v])});for(const[k,v]of pending)window.docs[k]=structuredClone(v);return value;}`;
const lesson=(cid,date,lectureId,module,title,day,extra={})=>({id:`x2-${cid}-${date}`,date,course:'모빌리티 AI',module,lectureId,title,day,hours:8,start:'',end:'',instructorId:'',instructorName:'',venue:'',online:false,note:'',kind:'class',event:'',sourceText:title,...extra});
const seed={cohort:'2',version:'20261014',source:'fixture.xlsx',start:'2026-10-28',end:'2027-01-22',courses:['모빌리티 AI'],modules:['공통행사','디지털스킬'],
 lectures:[{id:'t2-1',course:'모빌리티 AI',module:'공통행사',title:'입교식',days:3},{id:'t2-2',course:'모빌리티 AI',module:'디지털스킬',title:'디지털스킬',days:6},{id:'t2-9',course:'모빌리티 AI',module:'디지털스킬',title:'파이썬 기초',days:2},{id:'t2-10',course:'모빌리티 AI',module:'디지털스킬',title:'기업 특강',days:1}],
 classes:{'1':{classId:'1',entries:[lesson('1','2026-10-28','t2-1','공통행사','입교식',1,{hours:4,instructorName:'조해정',event:'입교식'}),lesson('1','2026-11-12','t2-2','디지털스킬','디지털스킬',1),lesson('1','2026-11-16','t2-10','디지털스킬','기업 특강',1)]},
  '2':{classId:'2',entries:[lesson('2','2026-10-28','t2-1','공통행사','입교식',1,{event:'입교식'})]}}};
const row=(cls,date,subject,hours,instructor)=>({date,dow:'',mark:'O',cls,subject,hours,instructor,field:[],start:'09:00',end:'18:00',lateAfter:'09:10',earlyBefore:'17:50',source:'기본'});
const sheet={rev:42,rows:[row('1','2026-10-28','입교식',4,'조해정'),row('1','2026-11-12','파이썬 기초',6,'김강사'),row('1','2026-11-16','기업 특강',3,'박강사'),row('1','2026-11-17','',0,''),row('2','2026-10-28','입교식',4,'이강사')]};
// 가짜 시트 클라이언트(beta2-data의 schedule·scheduleSave와 같은 모양). 쓰기는 b2ScheduleSave 계약대로 was가 지금 칸과 다르면 거절, 빠진 값은 그대로.
const fakeClient=`window.sheet=${JSON.stringify(sheet)};window.sheetCalls=[];window.fakeClient={
 async schedule(p={}){window.sheetCalls.push(['schedule',structuredClone(p)]);if(window.sheetDown)throw Error('마스터시트 연결이 끊겼습니다.');return {rev:window.sheet.rev,defaults:{start:'09:00',end:'18:00',graceMin:10},rows:structuredClone(window.sheet.rows.filter(r=>!p.cls||r.cls===p.cls))};},
 async scheduleSave(rows){window.sheetCalls.push(['save',structuredClone(rows)]);if(window.refuse)throw Error(window.refuse);
  rows.forEach((w,i)=>{const r=window.sheet.rows.find(x=>x.cls===w.cls&&x.date===w.date);if(!r)throw Error((i+1)+'번째: 교육일정 탭에 없는 날짜입니다.');if(!w.was||w.was.subject!==r.subject||w.was.instructor!==r.instructor)throw Error((i+1)+'번째('+w.cls+'반 '+w.date+'): 그사이 바뀌었습니다. 새로 읽어 주세요.');});
  for(const w of rows){const r=window.sheet.rows.find(x=>x.cls===w.cls&&x.date===w.date);for(const k of ['subject','hours','instructor'])if(k in w)r[k]=w[k];}
  window.sheet.rev++;return {ok:true,count:rows.length,changed:[],rev:window.sheet.rev};}};`;

test('teachers read the sheet (no publish step, read-only); admins edit it and the sheet is written; stale sheet refusals ask to reload; client caches by change number',async()=>{
 const base=join(import.meta.dirname,'../..'),{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 const docs={'timetableBetaInstructors/t2':{name:'최강사',organization:'',phone:'010-1111-2222',note:'',revision:1}},apiPosts=[];let apiRev=7;
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('dialog',d=>d.accept());
 try{
  await page.route('**/*',route=>{const u=new URL(route.request().url()),name=u.pathname.slice(1);
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:firestoreMock});
   if(!name)return route.fulfill({contentType:'text/html;charset=utf-8',body:`<div id="teacher"></div><div id="admin"></div><script>window.initialDocs=${JSON.stringify(docs)};${fakeClient}</script><script type="module">import{mountTimetableAdmin,mountTeacherTimetable}from'/timetable.mjs';const user=email=>({email});window.mountTeacher=(id,client=window.fakeClient)=>mountTeacherTimetable(document.querySelector('#teacher'),{db:{},user:user('teacher@example.test'),classInfo:{id,course:'모빌리티 AI',venue:'교육장'},client});window.mountAdmin=()=>mountTimetableAdmin(document.querySelector('#admin'),{db:{},user:user('admin@example.test'),classes:[{id:'1',course:'모빌리티 AI',venue:'교육장'},{id:'2',course:'모빌리티 AI',venue:'교육장'}],client:window.fakeClient});window.ready=true;</script>`});
   if(name==='api/teacher-beta'){const body=JSON.parse(route.request().postData());apiPosts.push(body);
    if(body.action==='b2Rev')return route.fulfill({json:{ok:true,data:{rev:apiRev,sync:{}}}});
    if(body.action==='b2Schedule')return route.fulfill({json:{ok:true,data:{rev:apiRev,defaults:{},rows:[row('1','2026-10-28','입교식',4,'조해정')]}}});
    if(body.action==='b2ScheduleSave')return route.fulfill({json:body.args[0].rows.some(r=>r.was?.subject==='stale')?{ok:false,error:'1번째(1반 2026-11-12): 그사이 바뀌었습니다. 새로 읽어 주세요.'}:{ok:true,data:{ok:true,count:body.args[0].rows.length,changed:[],rev:++apiRev}}});}
   if(name==='timetable-seed.json')return route.fulfill({json:seed});
   if(name==='survey-catalog.json')return route.fulfill({json:{events:[]}});
   if(name==='timetable-reference.json')return route.fulfill({json:{patches:[],additions:[],facilities:[],courses:{},sources:[],version:'fixture'}});
   if(u.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(name)&&!name.split('/').includes('..')&&existsSync(join(base,name)))return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,name),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);
  const teacher=page.locator('#teacher'),admin=page.locator('#admin'),docOf=p=>page.evaluate(k=>window.docs[k],p),calls=()=>page.evaluate(()=>window.sheetCalls);
  const showTeacher=async(id,date,client)=>{await page.evaluate(([id,c])=>window.mountTeacher(id,c==='none'?null:undefined),[id,client]);await teacher.getByRole('heading',{name:/오늘의 수업/}).waitFor();await teacher.locator('#date').fill(date);await teacher.locator('#date').dispatchEvent('change');};
  const card=(root,date)=>root.locator('.teacher-calendar .schedule-scroll .day-cell').filter({hasText:date.slice(5).replace('-','/')}).locator('.lesson');
  // 1. Teacher: straight from the sheet (own class only), no publish needed, nothing to edit.
  await showTeacher('1','2026-11-12');
  assert.equal(await teacher.locator('.source-note').innerText(),'운영팀 기준 일정(마스터시트)');
  assert.deepEqual((await calls()).at(-1),['schedule',{cls:'1'}]);
  assert.match(await card(teacher,'2026-11-12').innerText(),/파이썬 기초[\s\S]*09:00–18:00[\s\S]*김강사/);
  assert.equal(await teacher.getByText(/엑셀 과목명/).count(),0,'the Excel/sheet difference marker is for admins only');
  assert.equal(await teacher.locator('[data-edit]').count(),0);assert.equal(await teacher.getByRole('button',{name:/저장|공개/}).count(),0,'teachers cannot change the timetable');
  // 2. Sheet unreachable: published copy, and without one the Excel seed.
  await page.evaluate(()=>{window.sheetDown=true;});await showTeacher('1','2026-11-12');assert.equal(await teacher.locator('.source-note').innerText(),'운영팀 기준 일정(엑셀 원본)');assert.match(await card(teacher,'2026-11-12').innerText(),/디지털스킬/);
  await page.evaluate(()=>{window.docs['timetableBetaPublished/2']={classId:'2',entries:[{id:'p1',date:'2026-10-28',course:'모빌리티 AI',module:'공통행사',lectureId:'t2-1',title:'공개본 입교식',day:1,hours:8,kind:'class',instructorName:''}],revision:1,sourceRevision:1};});
  await showTeacher('2','2026-10-28');assert.equal(await teacher.locator('.source-note').count(),0);assert.match(await card(teacher,'2026-10-28').innerText(),/공개본 입교식/);
  await page.evaluate(()=>{window.sheetDown=false;});
  // 3. Admin: the whole sheet (every class at once); no import/publish buttons; Excel title difference is flagged.
  await page.evaluate(()=>window.mountAdmin());await admin.getByText(/기준 일정: 2기 마스터시트 교육일정 \(변경 번호 42\)/).waitFor();
  assert.deepEqual((await calls()).at(-1),['schedule',{}]);
  assert.equal(await admin.getByRole('button',{name:/가져오기|담임에게 (다시 )?공개|지금 공개/}).count(),0);
  await admin.locator('#classFilter').selectOption('1');await admin.locator('#date').fill('2026-11-12');await admin.locator('#date').dispatchEvent('change');
  assert.match(await admin.locator('[data-edit="x2-1-2026-11-12"]').innerText(),/엑셀 과목명 · 디지털스킬/);
  // 4. Editor: instructor + note → instructor goes to the sheet (only that cell, with was), the note stays on the site.
  await admin.locator('[data-edit="x2-1-2026-11-12"]').click();
  assert.equal(await admin.locator('#entryForm [name=start]').evaluate(x=>x.readOnly),true,'field times are changed on the module-time screen');
  await admin.locator('#entryForm select[name=instructorId]').selectOption({label:'최강사'});await admin.getByLabel('전달사항',{exact:true}).fill('실습실 B');
  await admin.getByRole('button',{name:'편집본 저장',exact:true}).click();await admin.getByRole('status').getByText('저장했습니다 · 마스터시트 1칸 반영').waitFor();
  const save=(await calls()).filter(c=>c[0]==='save').at(-1)[1];
  assert.deepEqual(save,[{cls:'1',date:'2026-11-12',instructor:'최강사',was:{subject:'파이썬 기초',instructor:'김강사',hours:6}}]);
  assert.equal(await page.evaluate(()=>window.sheet.rows.find(r=>r.date==='2026-11-12').instructor),'최강사');assert.deepEqual((await calls()).at(-1),['schedule',{}],'sheet read again after writing');
  assert.equal((await docOf('timetableBetaDrafts/1')).entries.find(e=>e.date==='2026-11-12').note,'실습실 B','site-only note kept in Firestore');
  assert.equal(JSON.stringify(await docOf('timetableBetaPublished/1')).includes('010-1111'),false,'no instructor contact in the teacher copy');
  // 5. Board: move a lesson to an empty day → old day cleared, new day written.
  await admin.locator('#date').fill('2026-11-16');await admin.locator('#date').dispatchEvent('change');
  await admin.locator('[data-edit="x2-1-2026-11-16"]').dragTo(admin.locator('[data-drop-date="2026-11-17"]'),{targetPosition:{x:20,y:15}});
  await admin.getByRole('button',{name:/^시간표 저장/}).click();await admin.getByRole('status').getByText(/시간표 저장 완료 · 마스터시트 2칸 반영/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.sheet.rows.filter(r=>r.cls==='1'&&r.date>='2026-11-16').map(r=>[r.date,r.subject,r.hours,r.instructor])),[['2026-11-16','',0,''],['2026-11-17','기업 특강',3,'박강사']]);
  await admin.locator('[data-edit="x2-1-2026-11-17"]').waitFor();
  // 6. Someone changed the sheet meanwhile: nothing is written, the admin is told to reload.
  await page.evaluate(()=>{window.sheet.rows.find(r=>r.date==='2026-11-17').instructor='다른 강사';});
  const draftRevision=(await docOf('timetableBetaDrafts/1')).revision;
  await page.waitForTimeout(400);// emulated drags end on the next mouse move; let the post-drag click guard lapse
  await admin.locator('[data-edit="x2-1-2026-11-17"]').click();await admin.getByRole('heading',{name:'1반 · 수업 수정'}).waitFor();await admin.locator('#entryForm [name=hours]').fill('4');await admin.getByRole('button',{name:'편집본 저장',exact:true}).click();
  await admin.locator('#formError').getByText(/그사이 바뀌어 아무것도 쓰지 않았습니다.*새로고침/).waitFor();
  assert.equal((await docOf('timetableBetaDrafts/1')).revision,draftRevision,'site info not saved either');assert.equal(await page.evaluate(()=>window.sheet.rows.find(r=>r.date==='2026-11-17').hours),3);
  await admin.getByRole('button',{name:'취소',exact:true}).click();
  // 7. Teacher sees the admin's change (sheet) and the site note (published overlay).
  await showTeacher('1','2026-11-12');assert.match(await card(teacher,'2026-11-12').innerText(),/최강사[\s\S]*실습실 B/);
  // 8. Real beta2-data client: b2Schedule cached by change number, saves in rows, stale refusal passed through.
  const out=await page.evaluate(async()=>{const {createBeta2Client,forgetBeta2Cache}=await import('/beta2-data.mjs');forgetBeta2Cache();const c=createBeta2Client({getIdToken:async()=>'tok'});
   await c.schedule({cls:'1'});await c.schedule({cls:'1'});await c.schedule({cls:'1'},{maxAge:0});return 'ok';});
  assert.equal(out,'ok');
  assert.deepEqual(apiPosts.map(p=>p.action),['b2Schedule','b2Rev'],'second read is fresh enough; third checks only the change number');
  apiRev++;await page.evaluate(async()=>{const {createBeta2Client}=await import('/beta2-data.mjs');await createBeta2Client({getIdToken:async()=>'tok'}).schedule({cls:'1'},{maxAge:0});});
  assert.deepEqual(apiPosts.slice(-2).map(p=>p.action),['b2Rev','b2Schedule'],'change number moved → read again');
  const many=await page.evaluate(async()=>{const {createBeta2Client}=await import('/beta2-data.mjs');const c=createBeta2Client({getIdToken:async()=>'tok'});
   const rows=Array.from({length:201},(_,i)=>({cls:'1',date:'2026-11-12',instructor:'x'+i,was:{subject:'파이썬 기초',instructor:''}}));const r=await c.scheduleSave(rows);
   let stale='';try{await c.scheduleSave([{cls:'1',date:'2026-11-12',subject:'y',was:{subject:'stale',instructor:''}}]);}catch(e){stale=e.message;}return {count:r.count,stale};});
  assert.deepEqual(apiPosts.filter(p=>p.action==='b2ScheduleSave').slice(0,2).map(p=>p.args[0].rows.length),[200,1]);assert.equal(many.count,201);assert.match(many.stale,/그사이 바뀌었습니다/);
  apiPosts.length=0;await page.evaluate(async()=>{const {createBeta2Client}=await import('/beta2-data.mjs');await createBeta2Client({getIdToken:async()=>'tok'}).schedule({cls:'1'});});
  assert.deepEqual(apiPosts.map(p=>p.action),['b2Schedule'],'saving drops the cached timetable');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
