import {createRequire} from 'node:module';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {studentKey,recordId,version} from './identity.mjs';
import {normalizeTime} from './rules.mjs';
const require=createRequire(import.meta.url);
export function loadPlaywright(){
  try{return require('playwright');}catch{return require(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
}
const HOME='https://check.ihereapp.com/history/lecture';
const CLASS2='A66812D9-3028-4E8E-BA35-B09CD29B9BDB';
const SCHEDULES={
 '2026-08-27':'6D96EB21-FF3B-4B0F-A2B5-C7AE448BEF09','2026-08-28':'95AEBDCC-1636-4D70-929A-F145E831DE97',
 '2026-08-31':'29A17CA5-27EB-4EF5-AAFC-366488BA2F70','2026-09-01':'E9897B32-14C7-48B9-925C-39FB949F1E9A',
 '2026-09-02':'30225A67-2191-4028-AED0-F674D97B5D0E','2026-09-03':'5872F188-21FE-4781-9A7D-13D2F208822F','2026-09-04':'EC306A74-D30D-4298-861A-49E4E9351DE2'};
export class CheckHereCollector{
  constructor(dataDir,{page=null}={}){this.dataDir=dataDir;this.page=page;this.context=null;this.urls=new Map();this.cancelled=false;}
  async connect(){
    if(!this.page||this.page.isClosed()){
      const {chromium}=loadPlaywright();
      this.context=await chromium.launchPersistentContext(join(this.dataDir,'chrome-profile'),{channel:'chrome',headless:false,viewport:{width:1440,height:1000},args:['--disable-save-password-bubble']});
      this.page=this.context.pages()[0]||await this.context.newPage();this.page.setDefaultTimeout(12000);
      // Accept only a save confirmation inside this adapter's explicit write phase.
      this.page.on('dialog',async d=>{if(this.saving&&d.type()==='confirm')await d.accept();else await d.dismiss();});
      await this.page.goto(HOME);
    }
    await this.page.bringToFront();return{connected:await this.loggedIn(),message:`전용 크롬에서 체크히어 로그인 후 수집을 누르세요. 현재 페이지: ${new URL(this.page.url()).pathname}`};
  }
  async loggedIn(){return !!this.page&&!this.page.isClosed()&&await this.page.locator('a[href$="/account/admin"]').isVisible();}
  async requireLogin(){
    if(!this.page||this.page.isClosed())throw new Error('LOGIN_REQUIRED: 체크히어 로그인 버튼을 먼저 눌러 주세요.');
    try{await this.page.locator('a[href$="/account/admin"]').waitFor({state:'visible',timeout:15000});}
    catch{throw new Error('LOGIN_REQUIRED: 전용 크롬에서 체크히어에 로그인해 주세요.');}
  }
  async numericPages(){return [...new Set((await this.page.getByRole('button').allTextContents()).map(x=>x.trim()).filter(x=>/^\d+$/.test(x)))].sort((a,b)=>+a-+b);}
  async findPagedRow(test){
    const visited=new Set();
    for(let attempt=0;attempt<100;attempt++){
      await this.page.getByRole('button',{name:'보기',exact:true}).first().waitFor({state:'visible',timeout:15000});
      const rows=this.page.getByRole('row'),texts=await rows.allTextContents();
      const matches=[];
      for(let i=0;i<texts.length;i++)if(test(texts[i])&&await rows.nth(i).getByRole('button',{name:'보기',exact:true}).count())matches.push({text:texts[i],i});
      if(matches.length>1)throw new Error('동일한 반 또는 날짜가 여러 개입니다. 선택을 확인해 주세요.');
      if(matches.length===1)return rows.nth(matches[0].i);
      const signature=texts.join('|');if(visited.has(signature))throw new Error('페이지 탐색이 반복되어 중단했습니다.');visited.add(signature);
      const pages=await this.numericPages();let changed=false;
      for(const n of pages){
        if(this.pageNumbers?.has(n))continue;(this.pageNumbers??=new Set()).add(n);
        await this.page.getByRole('button',{name:n,exact:true}).click();
        await this.page.waitForFunction(previous=>{
          const rows=[...document.querySelectorAll('tr')].map(r=>r.textContent),buttons=[...document.querySelectorAll('button')];
          return buttons.some(b=>b.textContent.trim()==='보기')&&rows.join('|')!==previous;
        },signature,{timeout:15000});changed=true;break;
      }
      if(!changed)return null;
    }throw new Error('조회 페이지 수가 너무 많습니다.');
  }
  async discover(classId,date){
    const key=`${classId}|${date}`;if(this.urls.has(key))return this.urls.get(key);
    if(String(classId)==='2'&&SCHEDULES[date]){const url=`${HOME}/modify?tab=STUDENT&academyId=ACADEMY-HNGV&lectureId=${CLASS2}&scheduleId=${SCHEDULES[date]}&scheduleDate=${date}`;this.urls.set(key,url);return url;}
    await this.page.goto(HOME);await this.requireLogin();this.pageNumbers=new Set(['1']);
    const row=await this.findPagedRow(t=>t.includes(`[${classId}반]`));if(!row)throw new Error(`${classId}반 강의를 찾지 못했습니다.`);
    await row.getByRole('button',{name:'보기',exact:true}).click();await this.page.waitForURL(u=>u.pathname!==new URL(HOME).pathname);
    this.pageNumbers=new Set(['1']);const target=await this.findPagedRow(t=>t.includes(date)||t.includes(date.replaceAll('-','.')));
    if(!target)throw new Error(`${date} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);
    await target.getByRole('button',{name:'보기',exact:true}).click();await this.page.waitForURL(u=>u.pathname.endsWith('/modify'));
    const url=this.page.url(),parsed=new URL(url);if(parsed.searchParams.get('scheduleDate')!==date)throw new Error('선택한 날짜와 화면이 다릅니다.');this.urls.set(key,url);return url;
  }
  async openDay(classId,date,url){
    await this.requireLogin();url=url||await this.discover(classId,date);
    const u=new URL(url);if(u.origin!=='https://check.ihereapp.com'||u.pathname!=='/history/lecture/modify'||u.searchParams.get('scheduleDate')!==date)throw new Error('출결상세 주소를 확인해 주세요.');
    await this.page.goto(url);await this.requireLogin();await this.page.getByRole('table').nth(1).waitFor({state:'visible'});
    await this.page.getByText('실제 시간 기반',{exact:true}).click();await this.page.getByText('초',{exact:true}).click();await this.page.getByText('표시',{exact:true}).click();
    await this.page.getByRole('table').nth(0).getByRole('row').nth(2).getByRole('cell').nth(2).waitFor({state:'visible',timeout:15000});
    const title=await this.page.getByText(new RegExp(`\\[${classId}반\\].*${date}.*출석부`)).innerText();
    if(!title.includes(`[${classId}반]`)||!title.includes(date))throw new Error('반·날짜 확인에 실패했습니다.');
    this.day={classId:String(classId),date,url,teacher:/\(([^()]*)\)\s*\|/.exec(title)?.[1]||''};
    return this.tableRecords();
  }
  async tableRecords(){
    const tables=await this.page.locator('table').evaluateAll(ts=>ts.slice(0,2).map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim()))));
    if(tables.length!==2||tables[0][1]?.[2]!=='성명'||tables[0][1]?.[3]!=='전화번호'||tables[1][1]?.length!==5||tables[1][1][0]!=='입실'||tables[1][1][2]!=='퇴실')throw new Error('체크히어 표 구조가 달라 수집을 중단했습니다.');
    const roster=tables[0].slice(2,-1),times=tables[1].slice(2,-1);if(!roster.length||roster.length!==times.length)throw new Error('학생 명단과 출결 행 수가 다릅니다.');
    const seen=new Set();return roster.map((cells,i)=>{
      const name=cells[2],phone=cells[3].replace(/\D/g,'');if(phone.length<9)throw new Error('학생 식별을 위해 전화번호 표시가 필요합니다.');
      const key=studentKey(name,phone);if(seen.has(key))throw new Error('중복된 학생 식별정보가 있습니다.');seen.add(key);
      const t=times[i],count=/\(\s*(\d+)\s*\)/.exec(t[3]);
      if(!count&&!/0분\s*\(\s*-\s*\)/.test(t[3]))throw new Error('외출 횟수를 읽지 못했습니다.');
      const r={...this.day,name,studentKey:key,phoneLast4:phone.slice(-4),rowIndex:i+2,schedule:tables[1][1][1],entry:normalizeTime(t[1]),rawEntry:normalizeTime(t[0]),exit:normalizeTime(t[2]),outingCount:count?+count[1]:0,outings:[],entryMemo:null,exitMemo:null,source:'live',readState:'partial',collectedAt:new Date().toISOString()};r.id=recordId(r);return r;
    });
  }
  async locate(record){const list=await this.tableRecords(),found=list.filter(r=>r.studentKey===record.studentKey);if(found.length!==1||found[0].name!==record.name)throw new Error('학생 일치 확인 실패');return found[0];}
  async modal(record,field){
    const row=await this.locate(record);await this.page.getByRole('table').nth(1).getByRole('row').nth(row.rowIndex).getByRole('cell').nth(field==='entry'?1:2).click();
    await this.page.locator('#modifyTime').waitFor({state:'visible'});
    if(await this.page.locator('#name').inputValue()!==record.name){await this.closeModal();throw new Error('수정 창의 학생이 다릅니다.');}
    return{time:normalizeTime(await this.page.locator('#prevTime').inputValue()),memo:await this.page.locator('#memoByAdmin').inputValue()};
  }
  async closeModal(){const b=this.page.getByRole('button',{name:'취소',exact:true});if(await b.count())await b.click();}
  async readDetails(record){
    try{
      for(const field of ['entry','exit']){const data=await this.modal(record,field);record[field]=data.time;record[`${field}Memo`]=data.memo;await this.closeModal();}
      if(record.outingCount){
        const row=await this.locate(record);await this.page.getByRole('table').nth(1).getByRole('row').nth(row.rowIndex).getByRole('cell').nth(3).click();
        await this.page.getByText(`${record.name} 님의 외출 시간 확인`,{exact:true}).waitFor({state:'visible'});
        const cells=await this.page.locator('table').nth(2).evaluate(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim())));
        if(!cells[0]?.join('|').includes('외출 종료 판단 기준'))throw new Error('외출 상세 구조가 다릅니다.');
        record.outings=cells.slice(1).map(c=>({start:normalizeTime(c[1]),end:normalizeTime(c[2]),cutoff:normalizeTime(c[3]),recognized:c[4]==='X'?false:c[4]==='O'?true:null}));
        if(record.outings.length!==record.outingCount)throw new Error('외출 횟수와 상세 구간 수가 다릅니다.');await this.closeModal();
      }
      record.readState='complete';
    }catch(e){record.readState='partial';record.readError=e.message;await this.closeModal();}
    record.version=version(record);record.collectedAt=new Date().toISOString();return record;
  }
  async collect(classId,dates,onRecord,onProgress){
    await this.requireLogin();this.cancelled=false;
    for(const date of dates){if(this.cancelled)break;const rows=await this.openDay(classId,date);
      for(let i=0;i<rows.length;i++){if(this.cancelled)break;await onProgress({date,index:i+1,total:rows.length,name:rows[i].name});await onRecord(await this.readDetails(rows[i]));}
    }
  }
  async read(record){const rows=await this.openDay(record.classId,record.date,record.url);const row=rows.find(r=>r.studentKey===record.studentKey);if(!row)throw new Error('해당 학생을 다시 찾지 못했습니다.');return this.readDetails({...row,reference:record.reference,exception:record.exception});}
  async write(record,field,change){
    const before=await this.modal(record,field);
    if(before.time!==record[field]||before.memo!==record[`${field}Memo`]){await this.closeModal();throw new Error('반영 직전 값이 달라졌습니다.');}
    await this.page.locator('#modifyTime').fill(change.time);await this.page.locator('#memoByAdmin').fill(change.memo);
    this.saving=true;
    try{await this.page.getByRole('button',{name:'변경',exact:true}).click();await this.page.locator('#modifyTime').waitFor({state:'hidden'});}finally{this.saving=false;await this.closeModal();}
  }
}
