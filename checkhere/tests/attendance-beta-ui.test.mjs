import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {loadPlaywright} from '../collector.mjs';
test('beta UI separates initial entry, corrections, reason save and evidence confirmation',async()=>{
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),base=join(import.meta.dirname,'../..'),page=await browser.newPage({viewport:{width:1920,height:1050}});
  const names=['가상가','가상나'],statuses=['해당없음','출석'],colors=['#ffffff','#ffffff'],writes=[];let raw='가상나: 시험',dialogs=[],answer=true;
  const rgb=h=>({red:parseInt(h.slice(1,3),16)/255,green:parseInt(h.slice(3,5),16)/255,blue:parseInt(h.slice(5,7),16)/255});
  page.on('dialog',async d=>{dialogs.push(d.message());if(answer)await d.accept();else await d.dismiss();});
  await page.addInitScript(()=>{const Original=Date;window.Date=class extends Original{constructor(...args){super(...(args.length?args:['2026-09-11T03:00:00Z']));}static now(){return new Original('2026-09-11T03:00:00Z').getTime();}};});
  const attendance=()=>[['이름','','','','9/10','9/11','10/22'],...names.map((n,i)=>[n,'','','','출석',statuses[i],'해당없음'])];
  const reasons=()=>[['','','','','9/10','9/11','10/22'],['','','','','',raw,'']];
  try{
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.hostname==='www.gstatic.com'&&url.pathname.endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:`export class GoogleAuthProvider{addScope(){}setCustomParameters(){}static credentialFromResult(){return{accessToken:'fixture-token'}}}export async function reauthenticateWithPopup(){return{};}`});
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`window.docs={};export const doc=(...a)=>({path:a.slice(1).join('/')}),collection=(...a)=>a,query=(...a)=>a,where=(...a)=>a,serverTimestamp=()=>({seconds:1});const merge=(a,b)=>{for(const[k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};merge(a[k],v);}else a[k]=v;}return a;};export async function getDoc(ref){const value=ref.path.startsWith('classes/')?{sheetUrl:'https://docs.google.com/spreadsheets/d/fixture-sheet/edit'}:window.docs[ref.path];return{exists:()=>!!value,data:()=>value};}export async function setDoc(ref,data){window.docs[ref.path]=merge(window.docs[ref.path]||{},data);}export async function getDocs(){return{docs:[{data:()=>({records:[{id:'ch1',classId:'1',date:'2026-09-11',name:'가상가',source:'live',readState:'complete',collectedAt:'2026-09-11T01:00:00Z',schedule:'09:00 ~ 18:00',teacher:'담임',entry:'09:00:00',exit:'18:00:00',entryMemo:'수집된 입실 메모',exitMemo:'수집된 퇴실 메모',outings:[]}]})}]};}`});
      if(url.hostname==='www.googleapis.com')return route.fulfill({json:{capabilities:{canEdit:true}}});
      if(url.hostname==='sheets.googleapis.com'){
        if(url.pathname.endsWith(':batchUpdate')){const body=request.postDataJSON(),u=body.requests[0].updateCells,v=u.rows[0].values[0];writes.push(u);if(u.range.startRowIndex===50)raw=v.userEnteredValue.stringValue;else if(v.userEnteredValue)statuses[u.range.startRowIndex-18]=v.userEnteredValue.stringValue;else{const c=v.userEnteredFormat.backgroundColorStyle.rgbColor;colors[u.range.startRowIndex-18]='#'+['red','green','blue'].map(k=>Math.round(c[k]*255).toString(16).padStart(2,'0')).join('');}return route.fulfill({json:{}});}
        if(url.pathname.endsWith('/values:batchGet')){const ranges=url.searchParams.getAll('ranges');return route.fulfill({json:ranges[0].includes('M18:ZZ48')?{valueRanges:[{values:attendance()},{values:reasons()}]}:{valueRanges:[{values:[[names[Number(/M(\d+)/.exec(ranges[0])[1])-19]]]},{values:[['9/11']]}]}});}
        if(url.searchParams.has('includeGridData')){const range=url.searchParams.get('ranges'),row=Number(/[A-Z]+(\d+)$/.exec(range)[1]),value=row===51?raw:statuses[row-19],color=row===51?'#ffffff':colors[row-19];return route.fulfill({json:{sheets:[{data:[{rowData:[{values:[{userEnteredValue:{stringValue:value},formattedValue:value,effectiveFormat:{backgroundColor:rgb(color)}}]}]}]}]}});}
        return route.fulfill({json:{sheets:[{properties:{sheetId:10,title:'1. 수도권_임베디드 AI(HW)'}}]}});
      }
      if(url.pathname==='/api/attendance-reader')return route.fulfill({json:{ok:true,attendance:attendance(),reasons:reasons(),attendanceBackgrounds:[[],...colors.map(c=>['','','','','#ffffff',c,'#ffffff'])]}});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<section class="attendance-native-shell"><div id="host"></div></section><script type="module">import{mountAttendanceOverview}from'/attendance-overview.js';await mountAttendanceOverview(document.querySelector('#host'),{auth:{},db:{},user:{email:'staff@example.com',getIdToken:async()=>'fixture-token'},classes:[{id:'1',course:'과정'}]});</script>`});
      const path=url.pathname.slice(1);if(['attendance-overview.js','attendance-beta.mjs','attendance-beta-core.mjs','attendance-beta-sheet.mjs','checkhere-snapshots.mjs','checkhere/rules.mjs'].includes(path))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,path),'utf8')});
      return route.abort();
    });
    await page.goto('https://fixture.test/');await page.getByLabel('가상가 출결').waitFor();assert.equal(await page.locator('#dateSel').inputValue(),'9/11');assert(await page.getByLabel('가상가 출결').isDisabled());await page.getByText('수집된 입실 메모',{exact:true}).waitFor();
    await page.getByRole('button',{name:'내 계정 시트 연결',exact:true}).click();await page.getByRole('button',{name:'내 계정 연결됨',exact:true}).waitFor();
    await page.getByLabel('가상가 출결').selectOption('출석');await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('.beta-status').disabled===false);assert.equal(statuses[0],'출석');assert.equal(dialogs.length,0);
    answer=false;await page.getByLabel('가상가 출결').selectOption('결석');assert.equal(statuses[0],'출석');assert.equal(dialogs.length,1);
    answer=true;await page.getByLabel('가상가 출결').selectOption('인정지각');await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('.beta-status').disabled===false);assert.equal(statuses[0],'인정출석');assert.equal(await page.getByLabel('가상가 출결').inputValue(),'인정지각');
    let n=writes.length,c=dialogs.length;await page.getByLabel('가상가 사유').fill('첫 사유');assert.equal(writes.length,n);await page.getByRole('button',{name:/^사유 저장/}).click();await page.getByRole('button',{name:'사유 저장',exact:true}).waitFor();assert.equal(dialogs.length,c);assert(raw.includes('가상나: 시험'));assert(raw.includes('가상가: 첫 사유'));
    await page.getByLabel('가상가 사유').fill('사유 정정');await page.getByRole('button',{name:/^사유 저장/}).click();await page.getByRole('button',{name:'사유 저장',exact:true}).waitFor();assert.equal(dialogs.length,c+1);assert(raw.includes('가상가: 사유 정정'));
    c=dialogs.length;await page.getByLabel('가상가 서류제출').selectOption('반려');await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('.beta-evidence').disabled===false);assert.equal(colors[0],'#ff0000');assert.equal(dialogs.length,c+1);
    await page.getByLabel('가상가 서류제출').selectOption('미제출');await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('.beta-evidence').disabled===false);assert.equal(colors[0],'#ff0000');assert.equal(dialogs.length,c+2);
    await page.getByRole('button',{name:'↻ 다시 읽기',exact:true}).click();await page.getByLabel('가상가 출결').waitFor();await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('.beta-status').disabled===false);assert.equal(await page.getByLabel('가상가 출결').inputValue(),'인정지각');assert.equal(await page.getByLabel('가상가 서류제출').inputValue(),'미제출');
    await page.locator('[data-docmemo]').first().click();await page.getByLabel('서류제출 관련 메모',{exact:true}).fill('서류 추가 확인');await page.getByRole('button',{name:'닫기',exact:true}).click();await page.locator('[data-docmemo]').first().getByText('● 메모 있음',{exact:true}).waitFor();
    await page.evaluate(()=>{window.docs['settings/attendanceOverviewMemo_1_2026-09-11'].memos['0_가상가'].checkhere='이전 통합 메모';window.docs['settings/attendanceOverviewMemo_1_2026-09-11'].memos['0_가상가'].manual='수기 기존 메모';});
    await page.getByRole('button',{name:'↻ 다시 읽기',exact:true}).click();await page.getByRole('button',{name:'가상가 입퇴실 관련 메모',exact:true}).waitFor();
    assert.equal(await page.locator('.table-head > div').count(),10);assert.equal(await page.locator('[data-category="checkhere"]').count(),0);
    assert.equal(await page.locator('.student-row').nth(1).locator('[data-column-memo]').count(),4);
    await page.getByRole('button',{name:'가상가 입퇴실 관련 메모',exact:true}).click();await page.getByRole('button',{name:'기존 통합 체크히어 메모 보기',exact:true}).click();assert.equal(await page.getByLabel('기존 통합 체크히어 메모',{exact:true}).inputValue(),'이전 통합 메모');await page.getByRole('button',{name:'닫기',exact:true}).click();
    const categories={checkhereTimes:'입퇴실 관련 메모',checkhereEntry:'입실 관리자메모 관련 메모',checkhereExit:'퇴실 관리자메모 관련 메모',checkhereOutings:'외출구간 관련 메모'};
    for(const [category,label] of Object.entries(categories)){
      await page.getByRole('button',{name:'가상가 '+label,exact:true}).click();await page.getByLabel(label,{exact:true}).fill(category+' 별도 저장');
      if(category==='checkhereTimes'){await page.getByRole('dialog').getByRole('button',{name:'담임 알림',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/✓ 알림/}).waitFor();assert(await page.getByRole('dialog').getByRole('button',{name:'이행 확인',exact:true}).isEnabled());}
      await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'가상가 '+label,exact:true}).getByText('● 메모 있음').waitFor();
    }
    await page.getByRole('button',{name:'↻ 다시 읽기',exact:true}).click();await page.locator('[data-category="manual"]').first().waitFor();
    const memo=await page.evaluate(()=>window.docs['settings/attendanceOverviewMemo_1_2026-09-11'].memos['0_가상가']);
    for(const c of Object.keys(categories))assert.equal(memo[c],c+' 별도 저장');assert.equal(memo.checkhere,'이전 통합 메모');assert.equal(memo.manual,'수기 기존 메모');assert.equal(memo.documents,'서류 추가 확인');assert(memo.followup.checkhereTimes.notifiedAt);
    await page.getByRole('button',{name:'가상가 외출구간 관련 메모',exact:true}).click();assert.equal(await page.getByLabel('외출구간 관련 메모',{exact:true}).inputValue(),'checkhereOutings 별도 저장');await page.getByRole('button',{name:'닫기',exact:true}).click();
    for(const width of [1280,1920]){
      await page.setViewportSize({width,height:1050});
      const geometry=await page.evaluate(()=>{const root=document.querySelector('#host').shadowRoot,scroller=root.querySelector('.table-scroll');scroller.scrollLeft=scroller.scrollWidth;const outer=scroller.getBoundingClientRect(),last=root.querySelector('.student-row .cell:last-child textarea').getBoundingClientRect();const heads=[...root.querySelectorAll('.table-head>div')],cells=[...root.querySelector('.student-row').children];return {inside:last.left>=outer.left&&last.right<=outer.right,width:last.width,aligned:heads.every((h,i)=>Math.abs(h.getBoundingClientRect().left-cells[i].getBoundingClientRect().left)<2)};});
      assert(geometry.inside,'manual memo must remain fully reachable by horizontal scroll');assert(geometry.width>=200);assert(geometry.aligned,'header and row columns must align');
    }
    await page.evaluate(()=>{window.XLSX={utils:{aoa_to_sheet:rows=>(window.exportedRows=rows,{}),book_new:()=>({}),book_append_sheet(){}},writeFile(){}};});
    await page.getByRole('button',{name:'⇩ 엑셀 다운로드',exact:true}).click();
    const exported=await page.evaluate(()=>window.exportedRows),header=exported.find(r=>r[0]==='이름'),student=exported.find(r=>r[0]==='가상가');
    for(const [category,label]of Object.entries(categories))assert.equal(student[header.indexOf(label)],category+' 별도 저장');
    const out=join(base,'checkhere/test-results');mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'attendance-beta-desktop.png'),fullPage:true});
    assert(writes.every(x=>x.range.endRowIndex-x.range.startRowIndex===1&&x.range.endColumnIndex-x.range.startColumnIndex===1));
  }finally{await browser.close();}
});
