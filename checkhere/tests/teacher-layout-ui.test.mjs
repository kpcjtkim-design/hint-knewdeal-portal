import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortal} from './teacher-fixture.mjs';

// 2기 담임 화면(beta2-teacher-layout.mjs): 큰 탭 ↔ 하위 탭 전환, 주소(뒤로가기·새로고침·바로 열기), 머리말, 휴대폰 폭, 불러오기 실패 안내.
// 2026-10-19 사용자 보고: 출결 탭을 눌렀다가 다른 탭을 누르면 출결 하위 탭이 그대로 보이던 버그(.b2-tabs의 display:flex가 hidden을 이김).
const KEYS=['today','attendance','documents','feedback','schedule','info'];
const TABS=['오늘 할 일','출결','서류 발급','민원·설문','시간표·자료','우리 반'];
const SUBS={attendance:[['board','출결판'],['reason','출결 사유'],['stats','출석률'],['evidence','증빙서류'],['disease','질병 인정'],['dropout','중도탈락']],feedback:[['voc','민원·이슈'],['surveys','만족도 설문']],schedule:[['timetable','시간표'],['materials','강의자료'],['links','바로가기']]};
// 지금 화면에 보이는 것: 고른 큰 탭, 보이는 하위 탭 글자·고른 하위 탭, 보이는 큰 탭 화면·하위 칸, 주소
const state=page=>page.evaluate(()=>{const v=e=>e.checkVisibility();return {
 main:[...document.querySelectorAll('[data-main][aria-selected="true"]')].map(b=>b.dataset.main),
 subs:[...document.querySelectorAll('[data-subtab]')].filter(v).map(b=>b.textContent),
 sub:[...document.querySelectorAll('[data-subtab][aria-selected="true"]')].filter(v).map(b=>b.dataset.subtab),
 panels:[...document.querySelectorAll('[data-panel]')].filter(v).map(p=>p.dataset.panel),
 slots:[...document.querySelectorAll('[data-panel] [data-sub]')].filter(v).map(d=>d.dataset.sub),
 hash:location.hash};});
const expected=(m,s=SUBS[m]?.[0][0])=>({main:[m],subs:(SUBS[m]||[]).map(x=>x[1]),sub:s?[s]:[],panels:[m],slots:s?[s]:[]});
const pick=async(page,m,s)=>{await page.locator(`[data-main="${m}"]`).click();if(s)await page.locator(`[data-subtab="${s}"]`).click();};
const same=async(page,m,s,msg)=>{const {hash,...now}=await state(page);assert.deepEqual(now,expected(m,s),msg);};

for(const as of ['teacher','admin'])test(`every top tab shows only its own sub-tabs and one active tab after any switch (${as==='teacher'?'담임 로그인':'관리자 미리보기'})`,async()=>{
 const errors=await openPortal(async page=>{
  assert.deepEqual(await page.locator('[data-main]').allInnerTexts(),TABS);
  await same(page,'today',undefined,'첫 화면은 오늘 할 일');
  for(const a of KEYS)for(const b of KEYS){
   if(a===b)continue;
   const deep=SUBS[a]?.at(-1)[0];// 하위 탭이 있으면 마지막 하위 탭까지 들어갔다가 옮깁니다.
   await pick(page,a,deep);await same(page,a,deep,`${a}/${deep}`);
   await pick(page,b);await same(page,b,undefined,`${a}/${deep} → ${b}`);
  }
  // 하위 탭끼리 옮겨도 하위 탭 줄은 그대로, 칸은 하나만
  for(const [s] of SUBS.attendance){await pick(page,'attendance',s);await same(page,'attendance',s,'출결 › '+s);}
  // 다른 큰 탭에 다녀오면 출결은 늘 출결판(오늘 칸이 맨 앞)부터
  await pick(page,'attendance','disease');await pick(page,'documents');await pick(page,'attendance');await same(page,'attendance','board');
 },{as});
 assert.deepEqual(errors,[]);
});

test('a slow screen never brings back the tab you left, and one 출결 screen serves every pane',async()=>{
 let release;const slow=new Promise(r=>{release=r;});
 const errors=await openPortal(async(page,posts)=>{
  // 오늘 할 일이 출결 화면 파일(teacher-beta.js)을 기다리는 사이 출결 › 출결판으로 갑니다.
  await pick(page,'attendance');release();
  await page.locator('table.g select').first().waitFor();
  await same(page,'attendance','board');
  assert.equal(await page.locator('table.g').count(),1,'the board, not the today card, is drawn');
  assert.equal(posts.filter(p=>p.action==='portalData').length,1,'the attendance screen is mounted once');
  // 서류 발급 파일을 기다리는 사이 반 정보로 옮기면 반 정보가 그대로 남습니다.
  await pick(page,'info');await page.getByText('교육생 명부 (3명)').waitFor();
  await same(page,'info');
  await pick(page,'today');await page.getByText('오늘 출결 (10/29(목))').waitFor();
  assert.equal(posts.filter(p=>p.action==='portalData').length,1);
 },{files:p=>p==='/teacher-beta.js'?{hold:slow}:null});
 assert.deepEqual(errors,[]);
});

test('the address keeps the tab: back, forward, refresh and a shared link open the same screen',async()=>{
 const waitFor=(page,m,s)=>page.waitForFunction(([m,s])=>document.querySelector('[data-main][aria-selected="true"]')?.dataset.main===m&&(document.querySelector('#t2Sub [aria-selected="true"]')?.dataset.subtab||'')===s,[m,s]);
 let errors=await openPortal(async page=>{
  await pick(page,'attendance','reason');
  assert.equal((await state(page)).hash,'#t/attendance/reason');
  await page.goBack();await waitFor(page,'attendance','board');await same(page,'attendance','board');
  await page.goBack();await waitFor(page,'today','');await same(page,'today');assert.equal((await state(page)).hash,'');
  await page.goForward();await waitFor(page,'attendance','board');
  await pick(page,'feedback','surveys');await page.reload();await page.locator('[data-main]').first().waitFor();await waitFor(page,'feedback','surveys');await same(page,'feedback','surveys','refresh keeps the tab');
 });
 assert.deepEqual(errors,[]);
 errors=await openPortal(async page=>{await waitFor(page,'attendance','stats');await same(page,'attendance','stats');},{path:'/#t/attendance/stats'});
 assert.deepEqual(errors,[]);
 errors=await openPortal(async page=>{await same(page,'attendance','board','unknown sub-tab → first sub-tab');},{path:'/#t/attendance/nope'});
 assert.deepEqual(errors,[]);
 errors=await openPortal(async page=>{await same(page,'today',undefined,'unknown tab → today');},{path:'/#t/nope/x'});
 assert.deepEqual(errors,[]);
 // 관리자 미리보기는 브라우저 기록을 늘리지 않고(뒤로가기는 관리자 화면 그대로), 미리보기를 떠나면 주소를 비웁니다.
 errors=await openPortal(async page=>{
  const before=await page.evaluate(()=>history.length);
  await pick(page,'attendance','stats');
  assert.equal((await state(page)).hash,'#t/attendance/stats');
  assert.equal(await page.evaluate(()=>history.length),before);
  await page.locator('.admin-major button',{hasText:'홈'}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-main]')&&location.hash==='');
 },{as:'admin'});
 assert.deepEqual(errors,[]);
});

test('teachers see plain tab names, a "오늘 · 날짜 · 반" header, a today-first 출결 and no admin-only labels',async()=>{
 const errors=await openPortal(async page=>{
  const head=page.locator('#t2Head');
  assert.equal(await head.locator('h2').innerText(),'오늘 할 일');
  assert.equal(await head.locator('.t2-ctx').innerText(),'오늘 · 10/29(목) · 1반 서울(관악구)_모빌리티 AI_서울대');
  assert.equal(await page.locator('.teacher-context-bar h2').innerText(),'1반 서울(관악구)_모빌리티 AI_서울대');
  await page.getByText('오늘 출결 (10/29(목))').waitFor();
  assert.match(await page.getByText('아직 입력하지 않은 학생').innerText(),/아직 입력하지 않은 학생 1명/);
  // 오늘 할 일의 첫 버튼이 출결판으로 갑니다(오늘 칸이 맨 앞, '오늘' 표시).
  await page.getByRole('button',{name:'출결 입력하기'}).click();
  await same(page,'attendance','board');
  assert.equal(await head.locator('h2').innerText(),'출결판');
  assert.equal(await head.locator('.t2-ctx').innerText(),'오늘 · 10/29(목) · 1반 서울(관악구)_모빌리티 AI_서울대');
  assert.equal(await page.locator('table.g thead th').nth(1).innerText(),'10/29(목)\n오늘');
  for(const [m,s] of [['attendance','reason'],['documents'],['feedback','voc'],['schedule','links'],['info']]){
   await pick(page,m,s);
   assert.equal(await head.locator('.t2-ctx').innerText(),'오늘 · 10/29(목) · 1반 서울(관악구)_모빌리티 AI_서울대',m);
   assert.ok((await head.locator('.t2-hint').innerText()).length>5,'a one-line hint says what the screen is for: '+m);
  }
  // 2기 시간표는 열림(cohort features.timetable, feat-timetable2). 아직 닫힌 강의자료는 쉬운 말로 '11월 중에 열립니다'.
  await pick(page,'schedule','materials');
  assert.equal(await page.locator('[data-sub="materials"]').innerText(),'11월 중에 열립니다. 준비되면 운영팀이 안내합니다.');
  await pick(page,'schedule','timetable');
  assert.notEqual(await page.locator('[data-sub="timetable"]').innerText(),'11월 중에 열립니다. 준비되면 운영팀이 안내합니다.');
  for(const text of ['2기 베타','관리자 등록 필요','현장운영 체크리스트','1기','가-3'])assert.equal(await page.getByText(text).count(),0,text);
 });
 assert.deepEqual(errors,[]);
});

test('on a phone the tabs are big enough to tap and the page never scrolls sideways',async()=>{
 const errors=await openPortal(async page=>{
  const wide=()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  const small=sel=>page.locator(sel).evaluateAll(els=>els.filter(e=>e.checkVisibility()).map(e=>[e.textContent,Math.round(e.getBoundingClientRect().height)]).filter(([,h])=>h<44));
  for(const m of KEYS){
   await pick(page,m);await page.waitForTimeout(300);
   assert.ok(await wide()<=0,`no sideways scroll on ${m}`);
   assert.deepEqual(await small('[data-main],[data-subtab]'),[],m);
  }
  await pick(page,'attendance');await page.locator('table.g select').first().waitFor();
  assert.ok(await wide()<=0,'the board scrolls inside its own box');
 },{viewport:{width:390,height:844}});
 assert.deepEqual(errors,[]);
});

test('loading problems are said in plain words with a retry button',async()=>{
 let failData=true,failDocs=true;
 const errors=await openPortal(async(page,posts)=>{
  await page.getByText('출결 정보를 불러오지 못했습니다').waitFor();
  await page.locator('[data-panel="today"]').getByText('마스터시트 응답이 늦습니다.').waitFor();
  failData=false;
  await page.locator('[data-panel="today"]').getByRole('button',{name:'다시 시도'}).click();
  await page.getByText('오늘 출결 (10/29(목))').waitFor();
  assert.equal(posts.filter(p=>p.action==='portalData').length,2);
  await pick(page,'documents');
  await page.getByText('이 화면을 불러오지 못했습니다').waitFor();
  failDocs=false;
  await page.locator('[data-panel="documents"]').getByRole('button',{name:'다시 시도'}).click();
  await page.locator('[data-panel="documents"]').getByRole('button',{name:'신청하기'}).waitFor();
  assert.equal(await page.getByText('이 화면을 불러오지 못했습니다').count(),0);
 },{api:b=>b.action==='portalData'&&failData?{status:502,body:{ok:false,error:'마스터시트 응답이 늦습니다.'}}:null,files:p=>p==='/beta2-docs.mjs'&&failDocs?{status:404}:null});
 assert.deepEqual(errors,[]);
});

test('출결 › 중도탈락 tab opens the dropout registration for the own class, and 우리 반 roster is view-only with a link there (사용자 2026-10-20)',async()=>{
 let posts=[];
 const errors=await openPortal(async page=>{
  await pick(page,'attendance','dropout');await same(page,'attendance','dropout','출결 › 중도탈락');
  assert.equal((await state(page)).hash,'#t/attendance/dropout');
  const slot=page.locator('[data-panel="attendance"] [data-sub="dropout"]');
  await slot.locator('.b2d').waitFor();
  assert.equal(await page.locator('#t2Head h2').innerText(),'중도탈락');
  // 담임은 신청만(사용자 2026-10-20): 신청 칸 + 신청 현황, 수료 확인(보기만). 관리자 처리(새로 등록·고치기·확인·수료 처리)는 없음
  await slot.getByRole('button',{name:'신청하기'}).waitFor();
  assert.deepEqual(await slot.locator('#d2Tabs .b2-tab').allInnerTexts(),['중도탈락 신청','수료 확인']);
  assert.equal(await slot.locator('#d2New,[data-act="edit"],[data-act="confirm"],[data-done]').count(),0);
  for(let i=0;i<50&&!posts.some(b=>b.action==='b2Dropouts');i++)await page.waitForTimeout(100);
  assert.ok(posts.some(b=>b.action==='b2Dropouts'),'reads the dropout tab');
  // 우리 반: 명부는 보기만(상태 고르기·저장 없음), 등록 단추는 중도탈락 탭으로
  await pick(page,'info');
  const go=page.locator('[data-panel="info"] #goDropout');await go.waitFor();
  assert.equal(await go.innerText(),'중도탈락·조기취업 신청하러 가기 →');
  assert.equal(await page.locator('[data-panel="info"] select[id^="ks"]').count(),0,'no status select');
  assert.equal(await page.locator('[data-panel="info"] [data-k]').count(),0,'no save button');
  await go.click();await page.waitForFunction(()=>location.hash==='#t/attendance/dropout');
  await same(page,'attendance','dropout','등록 단추 → 출결 › 중도탈락');
  assert.ok(!posts.some(b=>b.action==='portalSetStatus'));
 },{api:b=>{posts.push(b);return null;}});
 assert.deepEqual(errors,[]);
});
