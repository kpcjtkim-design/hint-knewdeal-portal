import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,existsSync}from'node:fs';import{join}from'node:path';import{loadPlaywright}from'../collector.mjs';
test('review applies only metadata atomically and rejects a stale migration without partial writes',async()=>{
 const base=join(import.meta.dirname,'../..'),seed=JSON.parse(readFileSync(join(base,'timetable-seed.json'),'utf8')),docs={};
 // 2기 기준에는 교정(patches)이 없어 시험용 교정 하나(1반 모빌리티 AI 화성공장 견학 이름)를 붙여 화면 흐름을 봅니다.
 const reference=JSON.parse(readFileSync(join(base,'timetable-reference.json'),'utf8')),visit=seed.lectures.find(l=>l.course==='모빌리티 AI'&&l.title==='화성공장 · 견학·이론');
 reference.patches=[{id:visit.id,before:{course:visit.course,module:visit.module,title:visit.title},after:{title:'화성공장 · 견학',venue:'화성공장 정문'}}];
 docs['settings/timetableBetaCatalog']={courses:seed.courses,modules:seed.modules,lectures:seed.lectures,revision:1};
 for(const [cid,c]of Object.entries(seed.classes)){docs['timetableBetaDrafts/'+cid]={...c,revision:2};docs['timetableBetaPublished/'+cid]={...c,revision:1,sourceRevision:2};}
 const{chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',async route=>{const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.docs=${JSON.stringify(docs)};export const doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),serverTimestamp=()=>({seconds:1});export async function getDoc(r){const d=window.docs[r.path];return{exists:()=>!!d,data:()=>structuredClone(d)};}export async function getDocs(r){return{docs:Object.entries(window.docs).filter(([k])=>k.startsWith(r.path+'/')).map(([k,v])=>({id:k.split('/').pop(),data:()=>structuredClone(v)}))};}export async function setDoc(){throw Error("unexpected material write")}export async function runTransaction(db,fn){const pending=[];const value=await fn({get:getDoc,set:(r,v)=>pending.push([r.path,v])});for(const[k,v]of pending)window.docs[k]=structuredClone(v);return value;}`});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import{mountTimetableAdmin}from'/timetable.mjs';import{CLASSES}from'/cohort.mjs';await mountTimetableAdmin(document.querySelector('#host'),{db:{},user:{email:'admin@example.com'},classes:CLASSES});</script>`});
   const name=u.pathname.slice(1);if(name==='timetable-reference.json')return route.fulfill({json:reference});if(u.hostname==='fixture.test'&&/^(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|css|json)$/.test(name)&&!name.split('/').includes('..')&&existsSync(join(base,name)))return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript',body:readFileSync(join(base,name),'utf8')});return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByRole('button',{name:'시트 기준 분류 반영'}).click();
  await page.evaluate(()=>window.docs['timetableBetaDrafts/1'].revision++);const before=await page.evaluate(()=>JSON.stringify(window.docs));
  await page.getByRole('button',{name:'분류 반영',exact:true}).click();await page.getByRole('alert').getByText(/다른 관리자/).waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(window.docs)),before);
  await page.getByRole('button',{name:'취소',exact:true}).click();await page.getByRole('button',{name:'↻ 새로고침',exact:true}).click();await page.getByRole('status').getByText('최신 시간표를 읽었습니다.').waitFor();
  await page.getByRole('button',{name:'시트 기준 분류 반영'}).click();await page.getByRole('button',{name:'분류 반영',exact:true}).click();await page.getByRole('status').getByText(/시트 기준 분류 반영 완료/).waitFor();
  assert.equal(await page.getByRole('button',{name:'시트 기준 분류 반영'}).count(),0);
  const after=await page.evaluate(()=>window.docs);assert.equal(Object.keys(after).length,Object.keys(docs).length);
  for(const [path,d]of Object.entries(docs))if(d.entries)assert.deepEqual(after[path].entries.map(e=>[e.id,e.date,e.day,e.hours,e.start,e.end]),d.entries.map(e=>[e.id,e.date,e.day,e.hours,e.start,e.end]));
  await page.getByRole('button',{name:'과정·강의 관리',exact:true}).click();await page.getByRole('heading',{name:'공장견학 · 분해조립 장소'}).waitFor();assert.equal(await page.getByRole('cell',{name:'선문대',exact:true}).count(),1,'3·4·5반 한 줄');assert.equal(await page.getByRole('cell',{name:'공장견학 이론만(견학 일정 없음)',exact:true}).count(),1);await page.getByText('반별 교육장소 · 견학·분해조립 날짜').click();await page.getByRole('cell',{name:/대구무역회관/}).waitFor();assert.match(await page.locator('.curriculum-reference').innerText(),/261014_K-뉴딜_아카데미_2기 일정표_직무기초\.xlsx/);
  await page.getByRole('button',{name:'반별 시간표',exact:true}).click();await page.locator('#classFilter').selectOption('1');await page.locator('#date').fill('2026-11-13');await page.locator('#date').dispatchEvent('change');await page.getByRole('button',{name:'1반 2026-11-13 화성공장 · 견학 수정',exact:true}).click();assert.equal(await page.getByLabel('장소',{exact:true}).inputValue(),'화성공장','일정표 장소 유지');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
