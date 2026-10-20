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
const PAGES={
 '/teacher.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mountTeacherBeta} from '/teacher-beta.js';window.notes=[];window.tb=mountTeacherBeta(document.getElementById('root'),{cls:1,tab:'board',endpoint:'/api/teacher-beta',notify:(n,sel,f)=>window.notes.push({...n,name:sel.n,date:sel.day,r:f.r})});</script>`,
 '/status.html':`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">import {mount} from '/beta2-status.mjs';import {decodeBundle} from '/beta2-core.mjs';import {ensureBeta2Css} from '/beta2-ui.mjs';ensureBeta2Css();
  window.view=await mount(document.getElementById('root'),{client:{bundle:async()=>decodeBundle(${JSON.stringify(RAW)}),checkhereDisease:async()=>({})},classes:[{id:'1'},{id:'2'}],tab:'evidence'});</script>`};

async function page(path,run){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage(),errors=[],posts=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='fixture.test')return route.abort();
   if(PAGES[url.pathname])return route.fulfill({contentType:'text/html;charset=utf-8',body:PAGES[url.pathname]});
   if(url.pathname==='/api/teacher-beta'){const body=route.request().postDataJSON();posts.push(body);return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:body.action==='portalData'?PORTAL:{ok:true}})});}
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
