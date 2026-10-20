import {createRequire} from 'node:module';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {studentKey,recordId,version} from './identity.mjs';
import {normalizeTime,RULES,timeDeleteRefusal} from './rules.mjs';
import {planFromPageData,dayStudent,readStudent,marksOf,entryByKey,DELETE_MARKS} from './day-data.mjs';
import {MASKED,MIN_WRITE_SECONDS,rowKind,detectView,alignRows,alignBySeq,attendeeOf,resolveMasked,linkPairs,sharedSigKeys,nameFits,shownPrefix,last4Of,maskedMemo} from './masking.mjs';
import {headerState,UNMASK} from './unmask.mjs';
import {buildBody,sendEvent,requestError,eventOf,privacyHook,privacyHeaders} from './event-request.mjs';
import {COHORT,CLASS_IDS,REAL_CLASS_IDS,BRIDGE_PORT,lectureTag} from './cohort-bridge.mjs';
import {matchRoster} from './roster.mjs';
import {randomBytes} from 'node:crypto';
const settle=(promise,ms)=>{let t;return Promise.race([promise,new Promise(r=>{t=setTimeout(()=>r(null),ms);})]).finally(()=>clearTimeout(t));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const between=([lo,hi]=[0,0])=>lo+Math.random()*Math.max(0,hi-lo);
// 빠른 수집인데 그날 화면 데이터를 받지 못했을 때(수정창으로 바꿔 읽지 않음). MASKED_가 아니라 묶음 수집의 두 번째 시도에서 다시 봅니다.
export const NO_PAGE_DATA='PAGE_NODATA: 출결 화면 데이터를 받지 못해 이 날 빠른 수집을 멈췄습니다(수정창은 열지 않음). 잠시 뒤 다시 수집해 주세요. 계속되면 정밀 수집(비상용·해제 필요)으로 읽어 주세요.';
// 학생 번호(attendeeId)가 먼저: 기록에 번호가 있고 그 번호의 줄이 있으면 그 줄, 아니면 학생 키(이름+전화)로 찾습니다.
export const pickStudent=(rows,record)=>{const by=record?.attendeeId?rows.filter(r=>r.attendeeId===record.attendeeId):[];return by.length?by:rows.filter(r=>r.studentKey===record?.studentKey);};
// 승인된 요청이 정한 칸만 바꿉니다: 요청하지 않은 시간은 지금 값(빈 칸에 메모만 넣으면 기본 시간), 요청하지 않은 메모는 지금 메모.
// requestedFields가 없으면(직접 수정) 지금 값이 기록과 같아야 합니다. 수정창과 순차 요청·미리보기가 같은 계산을 씁니다.
export function planChange(field,before,change,requestedFields,record){
  let automaticTime;
  if(requestedFields){
    const requestedMemo=requestedFields.includes(field+'Memo');
    if(!requestedFields.includes(field)&&requestedMemo&&!before.time&&change.memo!==before.memo)automaticTime=normalizeTime(RULES[field==='entry'?'start':'end']);
    change={time:requestedFields.includes(field)?change.time:before.time||automaticTime,memo:requestedMemo?change.memo:before.memo};
  }
  else if(before.time!==record[field]||before.memo!==record[`${field}Memo`])throw new Error('반영 직전 값이 달라졌습니다.');
  if(!normalizeTime(change.time))throw new Error('메모를 저장할 시간을 확인하지 못했습니다.');
  return {change,automaticTime};
}
// 쓰는 중에만 받는 저장 확인창(검토 7). 실제 문구는 아직 확인하지 못했습니다: 다른 글(연장·종료·해제 등)은 늘 닫습니다.
// 형식 기록 중(recording)에는 사람이 수정창에서 누른 저장의 확인창도 같은 문구일 때만 받습니다(닫으면 사람의 저장이 취소됨).
export const SAVE_CONFIRM=/^\s*(?:출석\s*)?(?:시간을\s*)?(?:변경|수정|저장)하시겠습니까\s*\??\s*$/;
export const acceptsDialog=(saving,type,message)=>saving&&type==='confirm'&&SAVE_CONFIRM.test(String(message||''))&&!/연장|종료|마스킹|해제|삭제/.test(String(message||''));
// 체크히어 자신의 변경·삭제 요청(쓰는 동안만 봄, 가림과 상관없음)
const WRITE_REQUEST=u=>/\/history\/event\/(?:update|delete)$/.test(u.pathname);
const require=createRequire(import.meta.url);
export function loadPlaywright(){
  try{return require('playwright');}catch{return require(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
}
const HOME='https://check.ihereapp.com/history/lecture';
// ---- 2기 반 → 체크히어 강의 찾기 ----
// 이름 규칙(cohort-bridge lectureNameRule, 예: '[3반]')에 맞는 2기 강의 줄을 강의 목록에서 찾습니다. 1기 강의가 같은 규칙으로 남아 있어도
// 날짜가 둘 이상 보이고 모두 2기 시작 전이면(예: 2026.07.27 ~ 2026.10.22) 고르지 않습니다. 규칙으로 못 찾거나 여럿이면 사람이 이 PC 화면(/setup)에서 직접 연결합니다.
export const lectureLabel=t=>String(t??'').replace(/\s+/g,' ').replace(/\s*보기\s*$/,'').trim();
const datesIn=t=>[...String(t??'').matchAll(/(20\d{2})[-.]\s?(\d{1,2})[-.]\s?(\d{1,2})/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`).sort();
export const oldLectureRow=t=>{const d=datesIn(t);return d.length>=2&&d.at(-1)<COHORT.period.start;};
export const ruleMatches=(t,classId)=>String(t??'').includes(lectureTag(classId))&&!oldLectureRow(t);
// 이름 규칙 자동 연결은 공식 반만(시험용 테스트반은 사람이 강의를 직접 연결할 때만)
export const ruleClass=t=>REAL_CLASS_IDS.find(c=>ruleMatches(t,c))||null;
// 그 날이 줄에 보이는 기간(날짜 둘 이상) 안인지. 알 수 없으면 null.
export const coversDate=(t,date)=>{const d=datesIn(t);return d.length>=2?d[0]<=date&&date<=d.at(-1):null;};
export const SETUP_HINT=`수집 PC 연결 프로그램 화면(127.0.0.1:${BRIDGE_PORT}/setup)의 「반→강의 연결」에서 직접 연결해 주세요.`;
const escapeRe=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// 설정으로 정한 반 → 강의(cohort.json checkhere.lectureLinks {"반": "강의 목록 줄에 든 글"}): 이름 규칙보다 먼저, 이 PC에서 사람이 고른 연결보다는 나중입니다.
export const presetLecture=classId=>{const v=COHORT.checkhere?.lectureLinks?.[String(classId)];return typeof v==='string'&&v.trim()?v.trim():null;};
// 강의 화면 주소(/history/lecture/{강의 번호})의 강의 번호
const lectureIdOf=u=>{try{return /^\/history\/lecture\/([A-Za-z0-9][\w-]{0,79})$/.exec(new URL(u).pathname)?.[1]||null;}catch{return null;}};
// 학생 번호가 둘 다 있으면 같아야 합니다(옛 build 저장본처럼 번호가 없으면 지금처럼 id·키·이름으로만 봄 — 옮겨 쓰기 없음).
export const sameTableRow=(old,row)=>!!old&&!!row?.tableSignature&&old.source==='live'&&old.readState==='complete'&&old.id===row.id&&old.studentKey===row.studentKey&&old.name===row.name&&old.tableSignature===row.tableSignature&&(!old.attendeeId||!row.attendeeId||old.attendeeId===row.attendeeId);
export const dayUrl=(academyId,lectureId,scheduleId,date)=>`${HOME}/modify?tab=STUDENT&academyId=${encodeURIComponent(academyId)}&lectureId=${encodeURIComponent(lectureId)}&scheduleId=${encodeURIComponent(scheduleId)}&scheduleDate=${date}`;
// 강의 화면이 받은 일정 목록 JSON → {dates: 날짜 → 일정 번호, academyId}. 모양을 다 알지 못하므로 날짜 하나와 번호(scheduleId, 없으면 id) 하나가 같이 있는
// 항목만 씁니다. 같은 날짜에 번호가 둘이면 그 날은 버립니다(그날은 지금처럼 '보기'로 찾음).
export function schedulesOf(json){
  const dates=new Map(),bad=new Set(),academies=new Set(),ID=/^[A-Za-z0-9][\w-]{0,79}$/;let n=0;
  const dateOf=v=>[v.scheduleDate,v.date,v.timeStart,v.startTime,v.startDate,v.start].map(x=>/^(20\d{2}-\d{2}-\d{2})(?:$|T|\s)/.exec(String(x??''))?.[1]).find(Boolean)||null;
  const visit=(v,depth)=>{
    if(++n>20000||depth>8||!v||typeof v!=='object')return;
    if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return;}
    if(typeof v.academyId==='string'&&ID.test(v.academyId))academies.add(v.academyId);
    const id=typeof v.scheduleId==='string'?v.scheduleId:'scheduleId' in v?null:typeof v.id==='string'?v.id:null,date=dateOf(v);
    if(id&&ID.test(id)&&date){if(dates.has(date)&&dates.get(date)!==id)bad.add(date);else dates.set(date,id);}
    for(const x of Object.values(v))if(x&&typeof x==='object')visit(x,depth+1);
  };
  visit(json,0);for(const d of bad)dates.delete(d);
  return {dates,academyId:academies.size===1?[...academies][0]:null};
}
export class CheckHereCollector{
  // links: 연결 프로그램이 넣는 학생 번호 연결 저장소(links.mjs). 없으면 가린 화면의 학생은 모두 '연결 안 됨'입니다.
  // dayGapMs: 수집에서 날과 날 사이 쉬는 시간(1~2초, 사람이 화면을 하나씩 여는 간격). sendGapMs: 순차 요청 사이(0.5~1초). 시험만 줄여 씁니다.
  // legacyNoMasking: 시험 전용(가림 기능이 없는 옛 가짜 화면). 운영은 늘 false: 머리말을 읽지 못하면(none) 해제 상태를 모르는 것이라 쓰지 않습니다(K4, privacyState 'unknown'과 같음).
  // roster: 2기 명단 저장소(roster.mjs, 연결 프로그램이 넣음). lectureLinks: 사람이 /setup에서 고른 반 → {label, url, lectureId}(연결 프로그램 SQLite에서 채움).
  // rosterReport: 반마다 마지막으로 읽은 날의 명단 맞춤 결과(이 PC 메모리에만, /setup 화면용 — 학생 번호는 화면에 보내지 않고 짧은 표로만).
  constructor(dataDir,{page=null,links=null,roster=null,dayGapMs=[1000,2000],sendGapMs=[500,1000],legacyNoMasking=false}={}){this.dataDir=dataDir;this.page=page;this.links=links;this.roster=roster;this.lectureLinks=new Map();this.rosterReport=new Map();this.legacyNoMasking=legacyNoMasking;this.context=null;this.urls=new Map();this.lectureUrls=new Map();this.cancelled=false;this.view=null;this.header=null;this.responses=new Map();this.responseSeq=0;this.unlinkedByClass=new Map();this.missing=[];this.guardBroken=false;this.dayGapMs=dayGapMs;this.sendGapMs=sendGapMs;this.lastDayAt=0;this.lastSendAt=0;this.scanning=null;this.scheduleSeen=[];this.recording=false;}
  // 쓰는 중(saving)·형식 기록 중(recording)의 저장 확인창(정해진 문구)만 받고, 그 밖의 창(연장·종료 등)은 모두 닫습니다.
  async onDialog(d){if(acceptsDialog(this.saving||this.recording,d.type(),d.message()))await d.accept();else await d.dismiss();}
  async connect(){
    if(!this.page||this.page.isClosed()){
      const {chromium}=loadPlaywright();
      this.context=await chromium.launchPersistentContext(join(this.dataDir,'chrome-profile'),{channel:'chrome',headless:false,viewport:{width:1440,height:1000},args:['--disable-save-password-bubble']});
      // 탭 하나만 씁니다: 사람이 이 탭에서 푼 마스킹 해제는 그 탭에만 걸립니다(Cowork 2026-10-15).
      // 화면 장치(privacyHook): 그 탭이 관리자 API에 붙이는 인증·해제 헤더를 탭 안의 닫힌 변수에만 두고 순차 요청이 탭 안에서 씁니다(우리 코드는 값을 돌려받거나 읽거나 적거나 저장하지 않음).
      // 주의: Playwright 자체는 화면의 네트워크 사건(아래 watch의 응답 감시, 쓰기 확인 guarded의 page.route)을 넘기며 요청 머리(헤더 값 포함)를 이 프로세스 메모리로 잠시 옮깁니다. 우리 코드는 그 헤더를 보지 않습니다(주소·응답·본문만).
      await this.context.addInitScript(privacyHook);
      this.page=this.context.pages()[0]||await this.context.newPage();this.page.setDefaultTimeout(12000);this.hooked=this.page;
      this.page.on('dialog',d=>this.onDialog(d));
      this.watch();await this.page.goto(HOME);
    }
    await this.page.bringToFront();return{connected:await this.loggedIn(),message:`전용 크롬에서 체크히어 로그인 후 수집을 누르세요. 현재 페이지: ${new URL(this.page.url()).pathname}`};
  }
  // 화면이 스스로 받는 출결상세 데이터(isRealTime true·false)를 일정마다 최근 몇 개만 기억합니다(읽기만, 요청을 보내지 않음).
  watch(){
    const page=this.page;if(!page||this.watched===page||typeof page.on!=='function')return;this.watched=page;
    const asJson=res=>/json/i.test(res.headers()['content-type']||'')?settle(res.json().catch(()=>null),5000):Promise.resolve(null);
    page.on('response',res=>{
      let p;try{p=new URL(res.url()).pathname;}catch{return;}
      // 반 첫 스캔(강의 화면) 동안 화면이 받은 일정 목록: 날짜별 일정 번호를 한 번에 배우려고(learnSchedules) 그 반 것으로만 적어 둡니다.
      const s=/\/schedule\/list\/lecture\/([^/]+)\/start\//.exec(p);
      if(s){if(this.scanning)this.scheduleSeen=[...this.scheduleSeen,{classId:this.scanning,lectureId:decodeURIComponent(s[1]),json:asJson(res)}].slice(-30);return;}
      const m=/\/history\/attendee\/detail\/.*\/schedule\/([^/]+)\/.*\/isRealTime\/(true|false)$/.exec(p);if(!m)return;
      const id=m[1].toLowerCase(),list=this.responses.get(id)||[];list.push({seq:++this.responseSeq,realTime:m[2]==='true',json:asJson(res)});this.responses.set(id,list.slice(-4));
    });
  }
  // 이 날을 연 뒤(mark) 받은 데이터. 화면을 열 때 받은 isRealTime/false를 씁니다(원문·가린 화면 모두, 2026-10-16):
  // '실제 시간 기반'을 눌러 오는 두 번째 응답(true)은 기다리지 않습니다. false가 없을 때만 true를 쓰고, 둘 다 없으면 6초까지 기다립니다.
  async pageData(scheduleId,mark,{timeoutMs=6000}={}){
    const pick=realTime=>(this.responses.get(String(scheduleId||'').toLowerCase())||[]).filter(r=>r.realTime===realTime&&r.seq>mark).at(-1);
    const until=Date.now()+timeoutMs;
    for(;;){
      const late=Date.now()>=until;
      for(const hit of [pick(false),pick(true)]){if(!hit)continue;const json=await hit.json;if(json)return json;}
      if(late)return null;await sleep(100);
    }
  }
  // 머리말을 읽지 못하면(화면 이동 중 등) 마지막 값을 그대로 둡니다.
  // 가림 기능(해제 버튼·원문 표시 중)을 한 번이라도 본 탭은 maskingSeen: 그 뒤 머리말을 읽지 못하면 해제 상태를 모르는 것으로 보고 쓰지 않습니다(writeBlocked).
  async readHeader(){const h=await headerState(this.page).catch(()=>null);if(h){this.header={...h,at:Date.now()};if(h.state!=='none')this.maskingSeen=true;}return this.header||{state:'none',remaining:null,at:Date.now()};}
  // 남은 해제 시간은 마지막으로 본 값에서 지난 시간을 뺍니다.
  headerNow(){const h=this.header;if(!h)return {state:'none',remaining:null};return {state:h.state,remaining:h.remaining===null||h.remaining===undefined?null:Math.max(0,h.remaining-Math.floor((Date.now()-h.at)/1000))};}
  // /api/state용(이름 없음): 표 상태, 머리말, 남은 초, 반별 연결 안 된 학생 수.
  async maskingState(){
    // 화면이 바쁘면 2초만 기다리고 마지막 값을 씁니다(/api/state가 늦어지지 않게).
    if(this.page&&!this.page.isClosed?.()&&!this.saving&&Date.now()-(this.header?.at||0)>2000)await settle(this.readHeader(),2000);
    const h=this.headerNow(),classes=[...this.unlinkedByClass].filter(([,x])=>x.count>0).map(([classId,x])=>({classId,date:x.date,count:x.count}));
    return {view:h.state==='unmasked'?'plain':h.state==='masked'?'masked':this.view,table:this.view,header:h.state,remaining:h.remaining,unlinked:classes.reduce((n,x)=>n+x.count,0),classes};
  }
  async loggedIn(){return !!this.page&&!this.page.isClosed()&&await this.page.locator('a[href$="/account/admin"]').isVisible();}
  // 사람이 이 탭에서 마스킹 해제 창(사유·인증번호)을 쓰는 중이면 화면을 옮기지 않습니다(옮기면 그 창이 사라짐).
  async notUnmasking(){let open=false;try{open=await this.page.getByText(UNMASK.reasonLabel).first().isVisible();}catch{}if(open)throw new Error(MASKED.UNMASKING);}
  async requireLogin(){
    if(!this.page||this.page.isClosed())throw new Error('LOGIN_REQUIRED: 체크히어 로그인 버튼을 먼저 눌러 주세요.');
    await this.notUnmasking();
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
  // 사람이 연결한 강의(/setup)가 먼저, 다음은 기억한 주소, 설정의 반→강의(presetLecture), 없으면 이름 규칙으로 강의 목록에서 찾습니다(찾지 못한 글은 '강의를 찾지 못했습니다' — 중계는 그날 건너뜀).
  async openLecture(classId){
    classId=String(classId);if(this.page&&!this.page.isClosed())await this.notUnmasking();
    this.watch();this.scanning=classId;this.scheduleSeen=this.scheduleSeen.filter(h=>h.classId!==this.scanning);
    const lecture=this.lectureLinks.get(classId)?.url||this.lectureUrls.get(classId);
    if(lecture){await this.page.goto(lecture);await this.requireLogin();return;}
    await this.page.goto(HOME);await this.requireLogin();this.pageNumbers=new Set(['1']);
    const preset=presetLecture(classId),test=preset?t=>String(t??'').includes(preset)&&!oldLectureRow(t):t=>ruleMatches(t,classId),what=preset?'설정한 강의 글':`이름 규칙 ${lectureTag(classId)}`;
    let row;try{row=await this.findPagedRow(test);}catch(e){if(/여러 개/.test(e.message))throw new Error(`${classId}반 ${what}에 맞는 체크히어 강의가 여러 개입니다. ${SETUP_HINT}`);throw e;}
    if(!row)throw new Error(`${classId}반 강의를 찾지 못했습니다(${what}). ${SETUP_HINT}`);
    const label=lectureLabel(await row.textContent().catch(()=>''));
    await row.getByRole('button',{name:'보기',exact:true}).click();await this.page.waitForURL(u=>u.pathname!==new URL(HOME).pathname);
    const observed=new URL(this.page.url());if(observed.origin!==new URL(HOME).origin||!observed.pathname.startsWith('/history/lecture/'))throw new Error('반별 강의 주소를 확인하지 못했습니다.');
    this.lectureUrls.set(String(classId),observed.href);
    if(preset)this.lectureLinks.set(classId,{label,url:observed.href,lectureId:lectureIdOf(observed.href),source:'config'});
  }
  // 이 PC 화면(/setup)용: 체크히어 강의 목록의 모든 쪽을 한 번씩 읽어 줄 글만 돌려줍니다('보기'는 누르지 않음, 강의 이름·기간 글만).
  // date를 주면 그 날이 줄의 기간 안인지(covers)도 붙입니다. classId: 이름 규칙에 맞는 반, old: 1기로 보이는 줄.
  async listLectures({date=null}={}){
    if(this.page&&!this.page.isClosed())await this.notUnmasking();
    await this.page.goto(HOME);await this.requireLogin();this.pageNumbers=new Set(['1']);
    const found=new Map(),visited=new Set();let complete=false;
    for(let attempt=0;attempt<100;attempt++){
      await this.page.getByRole('button',{name:'보기',exact:true}).first().waitFor({state:'visible',timeout:15000});
      const rows=await this.page.getByRole('row').evaluateAll(trs=>trs.map(tr=>({text:tr.textContent||'',view:[...tr.querySelectorAll('button')].some(b=>b.textContent.trim()==='보기')})));
      const signature=rows.map(r=>r.text).join('|');if(visited.has(signature))break;visited.add(signature);
      for(const r of rows){if(!r.view)continue;const label=lectureLabel(r.text);if(label)found.set(label,(found.get(label)||0)+1);}
      const next=(await this.numericPages()).find(n=>!this.pageNumbers.has(n));if(!next){complete=true;break;}
      this.pageNumbers.add(next);await this.page.getByRole('button',{name:next,exact:true}).click();
      await this.page.waitForFunction(previous=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='보기')&&[...document.querySelectorAll('tr')].map(r=>r.textContent).join('|')!==previous,signature,{timeout:15000});
    }
    return {complete,lectures:[...found].map(([label,count])=>({label,count,classId:ruleClass(label),old:oldLectureRow(label),...(date?{covers:coversDate(label,date)}:{})}))};
  }
  // 사람이 고른 강의(목록 줄 글)를 열어 그 반의 강의로 연결합니다. 그 반의 옛 주소(이름 규칙으로 찾은 강의·날짜 주소)는 버립니다. 결과 {label, url, lectureId}.
  async linkLecture(classId,label){
    classId=String(classId);label=lectureLabel(label);if(!label)throw new Error('연결할 체크히어 강의를 골라 주세요.');
    if(this.page&&!this.page.isClosed())await this.notUnmasking();
    await this.page.goto(HOME);await this.requireLogin();this.pageNumbers=new Set(['1']);
    const row=await this.findPagedRow(t=>lectureLabel(t)===label);
    if(!row)throw new Error('고른 체크히어 강의를 목록에서 다시 찾지 못했습니다. 강의 목록을 다시 읽어 주세요.');
    this.watch();this.scanning=classId;this.scheduleSeen=this.scheduleSeen.filter(h=>h.classId!==classId);
    await row.getByRole('button',{name:'보기',exact:true}).click();await this.page.waitForURL(u=>u.pathname!==new URL(HOME).pathname);
    const observed=new URL(this.page.url());if(observed.origin!==new URL(HOME).origin||!observed.pathname.startsWith('/history/lecture/'))throw new Error('고른 강의 주소를 확인하지 못했습니다.');
    // 강의 화면이 받은 일정 목록 요청의 강의 번호(없으면 주소의 lectureId): 날짜 화면이 이 강의 것인지 볼 때 씁니다.
    await this.page.getByRole('button',{name:'보기',exact:true}).first().waitFor({state:'visible',timeout:15000}).catch(()=>{});
    const lectureId=this.scheduleSeen.find(h=>h.classId===classId)?.lectureId||lectureIdOf(observed.href)||observed.searchParams.get('lectureId')||null;
    this.forgetClass(classId);const link={label,url:observed.href,lectureId,source:'manual'};this.lectureLinks.set(classId,link);this.lectureUrls.set(classId,observed.href);
    await this.learnSchedules(classId).catch(()=>0);this.scanning=null;return link;
  }
  // 반의 강의 주소·날짜 주소를 잊습니다(사람이 연결을 바꾸거나 풀 때). 다음 수집이 다시 찾습니다.
  forgetClass(classId){classId=String(classId);this.lectureUrls.delete(classId);for(const k of [...this.urls.keys()])if(k.startsWith(classId+'|'))this.urls.delete(k);}
  unlinkLecture(classId){this.lectureLinks.delete(String(classId));this.forgetClass(classId);}
  // 원문 줄의 학생 키: 2기 명단에 이름·끝 4자리가 똑같은 학생이 한 명이면 그 명단 키(가린 화면에서 명단으로 이은 기록과 같은 기록 id), 아니면 이름+전화 키.
  keyFor(classId,name,phone){const digits=String(phone??'').replace(/\D/g,'');return this.roster?.keyFor?.(classId,String(name??'').trim(),digits.slice(-4))||studentKey(name,digits);}
  // One pass over the class's schedule pages: which dates have a lecture at all.
  // `complete` is false when pages could not all be visited, so callers never
  // treat an unseen date as "no lecture" on partial evidence.
  async lectureDates(classId){
    await this.openLecture(classId);this.pageNumbers=new Set(['1']);
    const dates=new Set(),visited=new Set();let complete=false;
    for(let attempt=0;attempt<100;attempt++){
      await this.page.getByRole('button',{name:'보기',exact:true}).first().waitFor({state:'visible',timeout:15000});
      const texts=await this.page.getByRole('row').allTextContents(),signature=texts.join('|');
      if(visited.has(signature))break;visited.add(signature);
      for(const t of texts)for(const m of t.matchAll(/(20\d{2})[-.](\d{2})[-.](\d{2})/g))dates.add(`${m[1]}-${m[2]}-${m[3]}`);
      const next=(await this.numericPages()).find(n=>!this.pageNumbers.has(n));
      if(!next){complete=true;break;}
      this.pageNumbers.add(next);await this.page.getByRole('button',{name:next,exact:true}).click();
      await this.page.waitForFunction(previous=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='보기')&&[...document.querySelectorAll('tr')].map(r=>r.textContent).join('|')!==previous,signature,{timeout:15000});
    }
    await this.learnSchedules(classId);
    return {dates:[...dates].sort(),complete};
  }
  // 첫 스캔에서 강의 화면이 받은 일정 목록(JSON)으로 날짜별 출결상세 주소를 한 번에 기억합니다(places에 저장됨).
  // 그 뒤로는 날마다 주소 이동 한 번이고 '보기'를 누르지 않습니다. 주소가 틀리면 openDayOnce의 반·날짜 확인에서 걸려 다시 찾습니다.
  // academyId는 이미 아는 이 반 주소나 강의 화면 주소에서, lectureId는 일정 목록 요청 주소에서 가져옵니다. 모르면 배우지 않습니다(지금처럼 '보기').
  async learnSchedules(classId){
    classId=String(classId);const hits=this.scheduleSeen.filter(h=>h.classId===classId);this.scheduleSeen=this.scheduleSeen.filter(h=>h.classId!==classId);
    let academyId=null;const id=v=>typeof v==='string'&&/^[A-Za-z0-9][\w-]{0,79}$/.test(v)?v:null;
    try{academyId=id(new URL(this.lectureUrls.get(classId)||'').searchParams.get('academyId'));}catch{}
    for(const [k,v] of this.urls)if(k.startsWith(classId+'|')){try{academyId=id(new URL(v).searchParams.get('academyId'))||academyId;}catch{}}
    let learned=0;
    for(const h of hits){
      const found=schedulesOf(await h.json),academy=academyId||found.academyId,lectureId=id(h.lectureId);if(!academy||!lectureId)continue;
      for(const [date,scheduleId] of found.dates){const key=`${classId}|${date}`;if(this.urls.has(key))continue;this.urls.set(key,dayUrl(academy,lectureId,scheduleId,date));learned++;}
    }
    return learned;
  }
  async discover(classId,date){
    const key=`${classId}|${date}`;if(this.urls.has(key))return this.urls.get(key);
    await this.openLecture(classId);
    // 강의 목록이 그려진 뒤(일정 목록 응답을 받은 뒤) 그 응답으로 이 날 주소를 알면 '보기'를 누르지 않습니다.
    await this.page.getByRole('button',{name:'보기',exact:true}).first().waitFor({state:'visible',timeout:15000});
    if(await this.learnSchedules(classId)&&this.urls.has(key))return this.urls.get(key);
    this.pageNumbers=new Set(['1']);const target=await this.findPagedRow(t=>t.includes(date)||t.includes(date.replaceAll('-','.')));
    if(!target)throw new Error(`${date} 강의가 없습니다. 휴강 여부를 확인해 주세요.`);
    await target.getByRole('button',{name:'보기',exact:true}).click();await this.page.waitForURL(u=>u.pathname.endsWith('/modify'));
    const url=this.page.url(),parsed=new URL(url);if(parsed.searchParams.get('scheduleDate')!==date)throw new Error('선택한 날짜와 화면이 다릅니다.');this.urls.set(key,url);return url;
  }
  // A remembered day address that no longer opens the right day is forgotten and
  // looked up again once; supplied (verification) addresses are never replaced.
  async openDay(classId,date,url){
    const key=`${classId}|${date}`,remembered=!url&&this.urls.has(key);
    try{return await this.openDayOnce(classId,date,url);}
    // 가림 오류(MASKED_*)는 주소 문제가 아니므로 주소를 다시 찾지 않습니다.
    catch(e){if(!remembered||/LOGIN_REQUIRED|MASKED_/.test(e.message))throw e;this.urls.delete(key);return this.openDayOnce(classId,date);}
  }
  async openDayOnce(classId,date,url){
    // 지난 날들의 화면 데이터(이름·전화 원문이 들 수 있음)는 버립니다: 이 날을 연 뒤(mark 이후) 받은 것만 씁니다.
    await this.requireLogin();this.watch();await this.hookPage();this.responses.clear();const mark=this.responseSeq,beforeDiscovery=this.page.url(),suppliedUrl=!!url;url=url||await this.discover(classId,date);
    // 출결상세 화면이 받는 일정 목록은 반 첫 스캔의 것이 아닙니다(다른 반 번호로 배우지 않게).
    this.scanning=null;
    const u=new URL(url);if(u.origin!=='https://check.ihereapp.com'||u.pathname!=='/history/lecture/modify'||u.searchParams.get('scheduleDate')!==date)throw new Error('출결상세 주소를 확인해 주세요.');
    // Discovery has already loaded a new day. Explicit verification reads still
    // reload it, so a modal's stale local value can never serve as save evidence.
    if(suppliedUrl||beforeDiscovery===this.page.url()||this.page.url()!==url)await this.page.goto(url);
    await this.requireLogin();await this.page.getByRole('table').nth(1).waitFor({state:'visible'});
    // Keep the attendance data the page loads for this day (read-only). 화면을 열 때 받는 isRealTime/false를 씁니다(Cowork 2026-10-15).
    const scheduleId=u.searchParams.get('scheduleId');this.dayData=null;this.day=null;this.view=null;this.missing=[];this.skippedKeys=null;this.skippedRows=[];this.ambiguousKeys=null;this.dayRows=null;
    await this.showRealTime();
    await this.page.getByRole('table').nth(0).getByRole('row').nth(2).getByRole('cell').nth(2).waitFor({state:'visible',timeout:15000});
    await this.tableSettled();
    // 이름 규칙 반은 제목에 반 표시(예: '[3반]')가, 사람이 연결한 반(설정의 반→강의 포함)은 그 강의 번호(주소)가 같아야 합니다. 그런 반도 제목에 다른 반 표시가 있으면 멈춥니다.
    const manual=this.lectureLinks.get(String(classId))||(presetLecture(classId)?{source:'config',lectureId:null}:null),tag=lectureTag(classId),dayLecture=u.searchParams.get('lectureId');
    if(manual?.lectureId&&dayLecture&&dayLecture!==manual.lectureId)throw new Error('반·날짜 확인에 실패했습니다(연결한 강의와 다른 강의 화면).');
    const title=await this.page.getByText(new RegExp(`${manual?'':escapeRe(tag)+'.*'}${date}.*출석부`)).innerText();
    const other=CLASS_IDS.some(c=>c!==String(classId)&&title.includes(lectureTag(c)));
    if(!manual&&!title.includes(tag)||manual&&other||!title.includes(date))throw new Error('반·날짜 확인에 실패했습니다.');
    // 담임 이름에 가린 글자가 있으면 메모(…_담임:)에 쓰지 않게 이 반의 마지막 원문 담임(없으면 빈 값)으로 바꿉니다(검토 2).
    let teacher=/\(([^()]*)\)\s*\|/.exec(title)?.[1]||'';if(teacher.includes('*'))teacher=this.links?.teacher?.(classId)||'';
    this.day={classId:String(classId),date,url,teacher};
    await this.readHeader();
    this.dayData=await this.pageData(scheduleId,mark);
    // 화면 데이터가 다른 날의 것이면(기억한 주소의 일정 번호가 다른 날) 멈춥니다: 기억한 주소는 openDay가 한 번 다시 찾습니다.
    const dataDate=String(this.dayData?.data?.scheduleDate??'').slice(0,10);if(dataDate&&dataDate!==date){this.dayData=null;throw new Error('반·날짜 확인에 실패했습니다(화면 데이터 날짜가 다름).');}
    return this.tableRecords({learn:true});
  }
  // 화면 장치를 이 탭의 다음 화면부터 넣습니다(탭마다 한 번). 이미 열린 화면은 순차 요청 직전에 넣고 다시 읽게 합니다(privacyHeaders).
  async hookPage(){const p=this.page;if(!p||this.hooked===p||typeof p.addInitScript!=='function')return;this.hooked=p;await p.addInitScript(privacyHook).catch(()=>{});}
  // 표시 방식(실제 시간 기반·초·표시)은 이미 골라져 있으면 누르지 않습니다(읽기만 봄). 고른 상태를 읽지 못하면 지금처럼 누릅니다.
  async showRealTime(){
    for(const label of ['실제 시간 기반','초','표시']){
      const box=typeof this.page.getByLabel==='function'?this.page.getByLabel(label,{exact:true}):null;
      if(box&&await box.count().catch(()=>0)===1&&await box.isChecked().catch(()=>false))continue;
      await this.page.getByText(label,{exact:true}).click();
    }
  }
  // 표시 방식을 바꾼 뒤 표가 다시 그려지는 동안 읽지 않게, 시간 표의 글이 잠깐(0.3초) 그대로일 때까지 봅니다(최대 3초, 응답은 기다리지 않음).
  async tableSettled(){
    let last=null,same=0;
    for(let t=0;t<20;t++){const now=await this.page.getByRole('table').nth(1).innerText().catch(()=>null);if(now!==null&&now===last){if(++same>=2)return;}else same=0;last=now;await sleep(150);}
  }
  // 표 두 개를 읽어 화면 상태(원문·가림·섞임)를 정하고 학생 기록을 만듭니다. 섞이면 그날을 멈춥니다(MASKED_MIXED).
  // learn: 이 날을 연 직후 한 번, 원문 화면이면 순번으로 맞춘 학생 번호 연결을 배웁니다.
  async tableRecords({learn=false}={}){
    const tables=await this.page.locator('table').evaluateAll(ts=>ts.slice(0,2).map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim()))));
    if(tables.length!==2||tables[0][1]?.[2]!=='성명'||tables[0][1]?.[3]!=='전화번호'||tables[1][1]?.length!==5||tables[1][1][0]!=='입실'||tables[1][1][2]!=='퇴실')throw new Error('체크히어 표 구조가 달라 수집을 중단했습니다.');
    const roster=tables[0].slice(2,-1),times=tables[1].slice(2,-1);if(!roster.length||roster.length!==times.length)throw new Error('학생 명단과 출결 행 수가 다릅니다.');
    const shown=roster.map(c=>({seq:c[1],name:c[2],phone:c[3],kind:rowKind(c[2],c[3])})),header=this.header?.state||'none';
    const view=detectView(shown.map(s=>s.kind),header);this.view=view;this.aligned=null;this.dayReport={view,unlinked:0,mismatch:0,conflicts:0,unread:0};
    if(view==='mixed')throw new Error(MASKED.MIXED);
    // 표 한 줄 → 기록(이름·키는 원문 화면이면 표에서, 가린 화면이면 저장된 원문 기록에서). 학생 번호(attendeeId)는 이 PC 기록에만, 버전 밖.
    const record=(i,who)=>{
      const t=times[i],count=/\(\s*(\d+)\s*\)/.exec(t[3]);
      if(!count&&!/0분\s*\(\s*-\s*\)/.test(t[3]))throw new Error('외출 횟수를 읽지 못했습니다.');
      // The visible row (not the live-growing participation total) decides whether
      // an incremental collection must reopen this student's editors.
      const tableSignature=[tables[1][1][1],t[0],t[1],t[2],t[3]].map(v=>String(v??'').replace(/\s+/g,' ').trim()).join('|');
      const r={...this.day,name:who.name,studentKey:who.studentKey,phoneLast4:who.phoneLast4,...(who.attendeeId?{attendeeId:who.attendeeId}:{}),rowIndex:i+2,schedule:tables[1][1][1],entry:normalizeTime(t[1]),rawEntry:normalizeTime(t[0]),exit:normalizeTime(t[2]),outingCount:count?+count[1]:0,outings:[],entryMemo:null,exitMemo:null,tableSignature,source:'live',readState:'partial',collectedAt:new Date().toISOString()};r.id=recordId(r);return r;
    };
    if(view==='masked')return this.maskedRecords(shown,record);
    // 원문 화면: 화면 데이터와 표 순번(=sequence)을 줄마다 먼저 맞추고, 맞춘 줄은 체크히어 학생 번호를 붙입니다(학생 맞춤의 1차 키).
    // 전화가 다 보이지 않는 줄은 그날을 멈추지 않고(예전 「전화번호 표시가 필요합니다」), 이미 배운 학생 번호 연결로만 찾습니다. 없으면 그 학생만 연결 안 됨.
    const {classId,date}=this.day,entries=alignBySeq(shown,this.dayData?.data?.eventResultList),seen=new Set(),rows=[],viaLink=new Set(),oddRows=[];let odd=0;
    shown.forEach((s,i)=>{
      const attendeeId=attendeeOf(entries?.[i]);let who;
      if(s.kind!=='plain'){who=this.linkedWho(classId,attendeeId,s);if(!who){odd++;oddRows.push({name:String(s.name??'').trim(),phoneLast4:last4Of(s.phone),studentKey:'',attendeeId,odd:true});return;}viaLink.add(i);}
      else{const phone=String(s.phone).replace(/\D/g,'');who={name:s.name,studentKey:this.keyFor(classId,s.name,phone),phoneLast4:phone.slice(-4)};}
      if(seen.has(who.studentKey))throw new Error('중복된 학생 식별정보가 있습니다.');seen.add(who.studentKey);
      rows.push(record(i,{...who,attendeeId}));
    });
    this.dayReport.unlinked=odd;
    // 그날 원문 표의 학생(처음 설치 확인 setup.mjs용, 이 PC 메모리에만): 이름·끝 4자리·학생 키·학생 번호, 전화가 다 보이지 않은 줄(odd)·연결 충돌(conflict) 표시.
    const dayRows=skip=>({classId:String(classId),date,view:'plain',rows:[...rows.map(r=>({name:r.name,phoneLast4:r.phoneLast4,studentKey:r.studentKey,attendeeId:r.attendeeId||null,...(skip?.has(r.studentKey)?{conflict:true}:{})})),...oddRows]});
    // 화면 데이터와 맞추지 못한 날: 읽기는 표로만 하고 연결은 배우지 않습니다(학생 번호 없음).
    if(!entries){this.dayRows={...dayRows(),rows:dayRows().rows.map(r=>({...r,attendeeId:null}))};if(odd&&(header==='unmasked'||this.unlinkedByClass.has(classId)))this.noteUnlinked(classId,date,odd);this.rosterReport.delete(classId);return rows;}
    const at=r=>r.rowIndex-2;
    this.aligned={data:this.dayData,byId:new Map(rows.filter(r=>entries[at(r)]).map(r=>[r.id,{entry:entries[at(r)],seq:String(shown[at(r)].seq).trim()}]))};
    // 연결 충돌(같은 학생 번호에 다른 학생 키)인 학생은 이 날 내내 건너뜁니다(같은 날 두 번째 기록이 생기지 않게, 검토 11).
    if(!learn||!this.links?.learn){this.dayRows=dayRows(this.skippedKeys);return rows.filter(r=>!this.skippedKeys?.has(r.studentKey));}
    // 배우는 것은 원문 줄(이름+전화)만입니다. 연결로 찾은 줄은 이미 연결돼 있습니다.
    const pairs=linkPairs(rows,rows.map(r=>viaLink.has(at(r))?null:entries[at(r)]),(n,p)=>this.keyFor(classId,n,p)),{skipped}=this.links.learn(classId,date,pairs);this.skippedKeys=skipped;
    // 같은 첫 글자·끝 4자리 학생(원문 화면 데이터로도 가리지 못함)은 해제해도 연결되지 않으므로 쓰기를 따로 알립니다(MASKED_AMBIGUOUS).
    this.ambiguousKeys=sharedSigKeys(rows);
    // 연결 충돌로 건너뛴 학생(이 PC 메모리에만, 요청을 '먼저 수집' 대신 연결 충돌로 알리려고)
    this.skippedRows=rows.filter(r=>skipped.has(r.studentKey)).map(r=>({name:r.name,phoneLast4:r.phoneLast4}));
    this.links.seen?.(classId,date,rows.map(r=>r.attendeeId).filter(Boolean));this.links.plainDay?.(classId,date,rows.map(r=>r.studentKey));
    const kept=rows.filter(r=>!skipped.has(r.studentKey)),learned=new Set([...pairs.map(p=>p.studentKey),...rows.filter(r=>viaLink.has(at(r))).map(r=>r.studentKey)]);
    if(header==='unmasked'||this.unlinkedByClass.has(classId))this.noteUnlinked(classId,date,rows.filter(r=>!learned.has(r.studentKey)||skipped.has(r.studentKey)).length+odd);
    this.dayReport.conflicts=skipped.size;this.noteRoster(classId,date,shown,entries);this.dayRows=dayRows(skipped);
    return kept;
  }
  // 원문 화면의 전화가 다 보이지 않는 줄: 순번으로 맞춘 학생 번호가 이미 연결돼 있고, 저장된 원문 이름·끝 4자리(보이면)가 맞을 때만 그 학생입니다.
  linkedWho(classId,attendeeId,s){
    const link=attendeeId?this.links?.link?.(classId,attendeeId):null,who=link?this.links?.identities?.(classId)?.get(link.studentKey):null;
    if(!who||!nameFits(s.name,who.name)||(last4Of(s.phone)&&last4Of(s.phone)!==who.phoneLast4))return null;
    return {studentKey:link.studentKey,name:who.name,phoneLast4:who.phoneLast4};
  }
  noteUnlinked(classId,date,count){const old=this.unlinkedByClass.get(classId);if(!old||date>=old.date)this.unlinkedByClass.set(classId,{date,count});}
  // 가린 화면: 화면 데이터가 꼭 있어야 하고(MASKED_NODATA), 순번으로 하나씩 맞아야 합니다(MASKED_ALIGN).
  // 학생은 체크히어 학생 번호(attendeeId)의 연결로만 찾고, 이름·키·끝 4자리는 저장된 원문 기록에서 씁니다. 연결 안 된 학생은 건너뛰고 셉니다.
  maskedRecords(shown,record){
    const list=this.dayData?.data?.eventResultList;if(!Array.isArray(list))throw new Error(MASKED.NODATA);
    const entries=alignRows(shown,list),{classId,date}=this.day;
    // 2기 명단: 아직 연결 안 된 가린 줄을 명단 학생과 먼저 잇습니다(읽기 전용 연결 — 원문 읽기로 확인되기 전에는 쓰지 않음).
    this.rosterMatch(classId,shown,entries);
    const found=resolveMasked({classId,date,rows:shown,entries,links:this.links,identities:this.links?.identities?.(classId)||new Map(),lastPlain:this.links?.lastPlain?.(classId)||null});
    this.links?.seen?.(classId,date,found.filter(f=>f.attendeeId).map(f=>f.attendeeId));
    const seen=new Set(),rows=[],byId=new Map();let unlinked=0,mismatch=0;this.missing=[];
    found.forEach((who,i)=>{
      if(who.skip){if(who.skip==='mismatch')mismatch++;else unlinked++;this.missing.push({prefix:shownPrefix(shown[i].name),last4:last4Of(shown[i].phone)});return;}
      if(seen.has(who.studentKey))throw new Error('중복된 학생 식별정보가 있습니다.');seen.add(who.studentKey);
      const r=record(i,who);byId.set(r.id,{entry:entries[i],seq:String(shown[i].seq).trim(),attendeeId:who.attendeeId,source:who.source});rows.push(r);
    });
    this.aligned={data:this.dayData,byId};this.noteUnlinked(classId,date,unlinked+mismatch);
    this.dayReport={view:'masked',unlinked,mismatch,conflicts:0,unread:0};this.noteRoster(classId,date,shown,entries);this.dayRows={classId:String(classId),date,view:'masked',rows:[]};
    return rows;
  }
  // 가린 줄 → 명단 학생(roster.mjs matchRoster: 앞부분+끝 4자리가 명단에서 한 명, 첫 글자+끝 4자리가 명단·그날 표에서 하나, 그 학생이 다른 번호와 이어지지 않음)
  rosterMatch(classId,shown,entries){
    const roster=this.roster?.entries?.(classId)||[];if(!roster.length||!this.links?.rosterLink)return 0;
    const {pairs}=matchRoster({rows:shown,entries,roster,linked:a=>!!this.links.link(classId,a),taken:k=>!!this.links.attendee(classId,k)});
    let n=0;for(const p of pairs)if(this.links.rosterLink(classId,p.attendeeId,p.studentKey,'roster'))n++;return n;
  }
  // 이 반 명단 맞춤 결과(이 PC 메모리, /setup 화면용): 연결 안 된 줄(보이는 이름·끝 4자리·순번·짧은 표) + 연결되지 않은 명단 학생. 학생 번호는 표 안에만 둡니다.
  noteRoster(classId,date,shown,entries){
    const roster=this.roster?.entries?.(classId)||[];if(!roster.length||!this.links?.link){this.rosterReport.delete(String(classId));return;}
    const linked=a=>!!this.links.link(classId,a),{left}=matchRoster({rows:shown,entries,roster,linked,taken:k=>!!this.links.attendee(classId,k)}),tokens=new Map();
    const rows=left.map(l=>{const token=randomBytes(6).toString('hex'),s=shown[l.i];tokens.set(token,{attendeeId:l.attendeeId,name:s.name,phone:s.phone});return {token,seq:String(s.seq??'').trim(),shown:String(s.name??'').trim(),last4:last4Of(s.phone),reason:l.reason};});
    const missing=roster.filter(e=>!this.links.attendee(classId,e.studentKey)).map(e=>({studentKey:e.studentKey,name:e.name,last4:e.last4,dup:e.dup}));
    this.rosterReport.set(String(classId),{date,view:this.view,at:new Date().toISOString(),rows,missing,tokens,linked:entries?entries.filter(e=>e&&linked(attendeeOf(e))).length:0,total:shown.length});
  }
  // 순번으로 맞춘 항목은 그 맞춤에 쓴 화면 데이터가 지금 것일 때만 씁니다(데이터가 바뀌면 다시 맞춤).
  alignedNow(){return this.aligned&&this.dayData&&this.aligned.data===this.dayData?this.aligned.byId:null;}
  alignedOf(record){return this.alignedNow()?.get(record.id)||null;}
  // 그날 화면 데이터에서 이 기록의 학생(순번으로 맞춘 항목이 먼저, 원문 화면은 이름+전화 키로도). 의심스러우면 null.
  dayEntry(record){
    const a=this.alignedOf(record);
    if(a){const d=readStudent(a.entry);return d.problems.length?null:{...d,aligned:true};}
    return this.view==='masked'?null:dayStudent(this.dayData,record.studentKey,(n,p)=>this.keyFor(record.classId,n,p));
  }
  async locate(record){
    // 가린·섞인 화면에서는 표의 이름·전화로 줄을 고를 수 없고 수정창도 열리지 않습니다(Cowork).
    if(this.view==='masked'||this.view==='mixed')throw new Error(MASKED.WRITE);
    if(String(this.day?.classId)!==String(record.classId)||this.day?.date!==record.date||(this.day.url&&this.page.url()!==this.day.url))throw new Error('학생 일치 확인 실패: 반·날짜 화면이 다릅니다.');
    // Read just the target row; still verify its full phone-derived identity and
    // uniqueness before every click. Row moves fall back to the full safe scan.
    if(Number.isInteger(record.rowIndex)&&record.rowIndex>=2){
      const candidate=await this.page.locator('table').evaluateAll((tables,index)=>{
        const [roster,times]=tables,r=roster?.rows[index],header=roster?.rows[1],timeHeader=times?.rows[1];
        if(!r||roster.rows.length!==times?.rows.length||header?.cells[2]?.innerText.trim()!=='성명'||header?.cells[3]?.innerText.trim()!=='전화번호'||timeHeader?.cells.length!==5||timeHeader.cells[0].innerText.trim()!=='입실'||timeHeader.cells[2].innerText.trim()!=='퇴실')return null;
        const name=r.cells[2]?.innerText.trim(),phone=r.cells[3]?.innerText.replace(/\D/g,'');
        const matches=[...roster.rows].slice(2,-1).filter(row=>row.cells[2]?.innerText.trim()===name&&row.cells[3]?.innerText.replace(/\D/g,'')===phone).length;
        return {name,phone,matches,seq:r.cells[1]?.innerText.trim()};
      },record.rowIndex);
      // 화면 데이터와 순번으로 맞춘 학생이면 그 줄의 순번도 같아야 합니다(아니면 표 전체를 다시 봄).
      // 학생 번호가 먼저: 그 번호로 맞춘 줄이면 이름·순번이 같을 때 그 줄입니다(전화가 다 보이지 않는 줄도). 아니면 이름+전화 키.
      const a=this.alignedOf(record),byAttendee=!!a&&!!record.attendeeId&&a.entry?.attendeeId===record.attendeeId&&a.seq===candidate?.seq&&candidate?.name===record.name;
      if(byAttendee||candidate?.phone?.length>=9&&candidate.name===record.name&&this.keyFor(record.classId,candidate.name,candidate.phone)===record.studentKey&&(!a||a.seq===candidate.seq)){
        if(candidate.matches!==1)throw new Error('중복된 학생 식별정보가 있습니다.');return record;
      }
    }
    const list=await this.tableRecords(),found=pickStudent(list,record);if(found.length!==1||found[0].name!==record.name||found[0].studentKey!==record.studentKey)throw new Error('학생 일치 확인 실패');return found[0];
  }
  async modal(record,field){
    const row=await this.locate(record);await this.page.getByRole('table').nth(1).getByRole('row').nth(row.rowIndex).getByRole('cell').nth(field==='entry'?1:2).click();
    await this.page.locator('#modifyTime').waitFor({state:'visible'});
    const data=await this.page.locator('#modifyTime').evaluate(()=>({name:document.querySelector('#name')?.value,time:document.querySelector('#prevTime')?.value,memo:document.querySelector('#memoByAdmin')?.value}));
    if(data.name!==record.name){await this.closeModal();throw new Error('수정 창의 학생이 다릅니다.');}
    if(typeof data.time!=='string'||typeof data.memo!=='string'){await this.closeModal();throw new Error('시간·메모 입력창 구조를 확인하지 못했습니다.');}
    return{time:normalizeTime(data.time),memo:data.memo};
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
    record.version=version(record);record.collectedAt=new Date().toISOString();this.markDeletable(record);return record;
  }
  // 시간 삭제 표시는 그날 화면 데이터에 같은 학생이 한 명뿐이고 1교시·퇴실 시간이 수정창 값과 같을 때만 붙입니다.
  // 확인하지 못하면 붙이지 않습니다(그러면 삭제가 잠깁니다 — 안전한 쪽).
  markDeletable(record){
    for(const k of DELETE_MARKS)delete record[k];
    const d=record.readState==='complete'?this.dayEntry(record):null;
    if(d&&(d.aligned||d.name===record.name)&&d.rawEntry===record.rawEntry&&d.entry===record.entry&&d.exit===record.exit)Object.assign(record,marksOf(d));
    return record;
  }
  // 화면 데이터로 읽을 때 쓸 학생 항목: 학생 번호(순번으로 맞춘 항목)가 먼저(가린 데이터에서도 됨), 원문 화면에서 맞추지 못한 줄만 이름+전화 키로 한 명일 때.
  planOptions(rows){
    const a=this.alignedNow(),memoOk=(r,d)=>this.memoOk(r,d);
    // 가린 화면은 이름+전화 키로 찾지 않습니다(화면 데이터가 원문이어도, 검토 13): 맞춘 항목이 없는 학생은 그대로 '일부 수집'.
    if(this.view==='masked')return {entryFor:r=>a?.get(r.id)?.entry,memoOk};
    // 이름+전화 키는 그날 데이터에 그 학생이 정확히 한 명일 때만 씁니다(표의 한 줄만 읽는 쓰기 확인에서도 됨).
    return {entryFor:r=>a?.get(r.id)?.entry||entryByKey(this.dayData,r.studentKey,(n,p)=>this.keyFor(r.classId,n,p)),memoOk};
  }
  // 가린 메모로 보이는 값(별 2개 이상)은 저장된 같은 메모일 때만 믿습니다(검토 1, Cowork: 지금은 메모를 가리지 않음).
  memoOk(row,d){
    if(!maskedMemo(d.entryMemo)&&!maskedMemo(d.exitMemo))return true;
    const old=this.links?.record?.(row.id);return !!old&&old.entryMemo===d.entryMemo&&old.exitMemo===d.exitMemo;
  }
  unreadable(row){
    const readError=this.view==='masked'?'가린 화면에서 화면 데이터와 표가 달라 이 학생을 읽지 못했습니다. 마스킹 해제 후 다시 수집해 주세요.':'화면 데이터와 표가 달라 이 학생을 읽지 못했습니다(수정창은 열지 않음). 다시 수집하거나 정밀 수집(비상용)으로 확인해 주세요.';
    const r={...row,readError,collectedAt:new Date().toISOString()};r.version=version(r);return r;
  }
  // 요청 학생이 이 날 가린 화면에서 연결 안 된 학생일 수 있는지(첫 글자·끝 4자리를 이 PC 안에서만 비교, 밖으로 보내지 않음, 검토 9)
  maskedMiss(request){
    if(this.view!=='masked')return false;
    const name=String(request?.name||'').trim(),tail=String(request?.phoneLast4||'');
    return this.missing.some(m=>m.prefix&&name.startsWith(m.prefix)&&(!tail||tail===m.last4));
  }
  // 요청 학생이 이 날 원문 화면에서 연결 충돌로 건너뛴 학생인지(이 PC 안에서만 비교)
  conflictMiss(request){
    const name=String(request?.name||'').trim(),tail=String(request?.phoneLast4||'');
    return (this.skippedRows||[]).some(r=>r.name===name&&(!tail||tail===r.phoneLast4));
  }
  // 빠른 수집(pageData, 2026-10-16): 그날 화면 데이터만 읽고 수정창을 열지 않습니다(표본 대조·수정창 대체 읽기 끔 — 가린 화면에서는 열리지 않음).
  // 표 값 대조(planFromPageData)와 저장본과 같으면 건너뛰기는 그대로입니다. 표와 맞지 않는 학생은 수정창으로 넘기지 않습니다.
  // 정밀 수집(pageData 없음, 비상용): 원문 화면에서 학생마다 수정창을 엽니다. 가린 화면이면 조용히 바꾸지 않고 거절합니다(MASKED_PRECISE).
  // unchanged(row): 보이는 줄이 지난 완전한 기록과 같으면 건너뜀. sameAsStored(record): 내용(메모 포함)이 저장본과 같으면 건너뜀.
  // onView({date,view,unlinked,mismatch,conflicts,unread}): 연 날마다 화면 상태와 건너뛴 학생 수(이름 없음). 빠른 수집은 그날을 다 읽은 뒤 부릅니다.
  // 날과 날 사이는 1~2초 쉽니다(pace, 몰아서 열지 않음).
  async collect(classId,dates,onRecord,onProgress,{unchanged=null,pageData=false,sameAsStored=null,onDay=null,onView=null}={}){
    // 중단 표시는 작업을 시작하는 곳(server.mjs)이 지웁니다. 여기서 지우면 날짜 사이에 누른 '수집 중단'이 묻힙니다.
    await this.requireLogin();
    for(const date of dates){
      if(this.cancelled)break;await this.pace();if(this.cancelled)break;
      try{
        const rows=await this.openDay(classId,date);
        if(this.view==='masked'&&!pageData)throw new Error(MASKED.PRECISE);
        if(pageData){
          if(!this.dayData)throw new Error(this.view==='masked'?MASKED.NODATA:NO_PAGE_DATA);
          const plan=planFromPageData(rows,this.dayData,this.planOptions(rows));
          await onDay?.({date,method:'page-data',fallback:plan.fallback.length,note:plan.reason});
          for(const row of rows){
            if(this.cancelled)break;const fast=plan.byId.get(row.id);
            if(fast){if(sameAsStored?.(fast))continue;await onRecord(fast);continue;}
            if(unchanged?.(row))continue;
            // 저장된 완전한 기록 위에 '일부 수집'을 덮지 않고(메모·외출이 사라지고 플랫폼 최신본을 바꿈) 확인 필요로만 셉니다.
            // 같은 표·같은 이유의 '일부 수집'이 이미 최신이면 또 쌓지 않습니다(수집마다 행이 늘지 않게). 다시 수집하거나 정밀 수집으로 봅니다.
            const old=this.links?.record?.(row.id),next=this.unreadable(row);
            if(old?.source==='live'&&(old.readState==='complete'||old.tableSignature===next.tableSignature&&old.readError===next.readError)){this.dayReport.unread++;continue;}
            await onRecord(next);
          }
          await onView?.({date,...this.dayReport});
          continue;
        }
        await onView?.({date,...this.dayReport});
        for(let i=0;i<rows.length;i++){if(this.cancelled)break;if(unchanged?.(rows[i]))continue;await onProgress({date,index:i+1,total:rows.length,name:rows[i].name});await onRecord(await this.readDetails(rows[i]));}
      }finally{this.lastDayAt=Date.now();}
    }
  }
  async pace(){const wait=this.lastDayAt+between(this.dayGapMs)-Date.now();if(this.lastDayAt&&wait>0)await sleep(wait);}
  async readOpened(record,openedRows=null){
    const url=record.url||this.day?.url;
    if(String(this.day?.classId)!==String(record.classId)||this.day?.date!==record.date||this.day?.url!==url||this.page.url()!==url)throw new Error('선택한 반·날짜 화면이 달라 다시 수집해야 합니다.');
    // 학생 번호(attendeeId)가 먼저, 없으면 학생 키로 찾습니다.
    const rows=pickStudent(openedRows||await this.tableRecords(),record);
    // 원문 화면에서 연결 충돌로 건너뛴 학생(전화가 바뀌어 키가 달라졌을 수 있어 같은 이름도 봄)은 '다시 찾지 못함'(시도 횟수에 들어감) 대신
    // 충돌로 알립니다(해제로 풀리지 않음, 「연결 충돌 정리」 뒤 다시 수집).
    if(this.view!=='masked'&&(this.skippedKeys?.has(record.studentKey)||rows.length!==1&&(this.skippedRows||[]).some(r=>r.name===record.name)))throw new Error(MASKED.CONFLICT);
    // 가린 화면에서 이 학생이 없으면 연결 안 된 학생입니다(요청은 해제 뒤 다시, 시도 횟수에 넣지 않음).
    if(rows.length!==1||rows[0].name!==record.name)throw new Error(this.view==='masked'?MASKED.UNLINKED:'해당 학생을 다시 찾지 못했습니다.');
    // 같은 학생 번호인데 학생 키가 다르면(전화·이름이 바뀜) 같은 학생으로 보지 않습니다.
    if(rows[0].studentKey!==record.studentKey)throw new Error(MASKED.CONFLICT);
    const row={...rows[0],reference:record.reference,exception:record.exception};
    // 화면 데이터로 먼저 읽습니다(수정창 없음, 가린 화면은 이것만). 원문 화면에서 표와 맞지 않는 이 학생만 수정창으로 읽습니다(쓰기 재확인 포함, 2026-10-16).
    const fast=this.dayData?planFromPageData([row],this.dayData,this.planOptions([row])).byId.get(row.id):null;
    if(fast)return fast;
    return this.view==='masked'?this.unreadable(row):this.readDetails(row);
  }
  async read(record){const rows=await this.openDay(record.classId,record.date,record.url);return this.readOpened(record,rows);}
  // 쓰기 전 확인(아무것도 누르기 전): 가린·섞인 화면, 남은 해제 시간, 해제된 화면이면 학생 번호 연결(원문 읽기로 확인된 것)과 순번으로 맞춘 학생.
  // 막으면 MASKED_* 글을 돌려줍니다. 표를 읽지 않은 시험용 화면(view 없음)은 지금처럼 둡니다.
  // minSeconds: 남은 해제 시간 기준. 잡기 전(server.mjs)은 MIN_CLAIM_SECONDS로 더 넉넉히 봅니다.
  writeBlocked(record,{minSeconds=MIN_WRITE_SECONDS}={}){
    // 저장 때 체크히어 변경 요청을 한 번이라도 확인하지 못했으면 다시 시작할 때까지 쓰지 않습니다(요청 확인이 우회된 채 쓰지 않게).
    if(this.guardBroken)return MASKED.GUARD;
    if(!this.view)return null;
    if(this.view!=='plain')return MASKED.WRITE;
    const h=this.headerNow();if(h.state==='masked'||h.state==='both')return MASKED.WRITE;
    // 머리말을 읽지 못하면(none: 아직 못 봄·모양이 바뀜·이동 중) 해제 상태를 모르므로 쓰지 않습니다(K4, privacyState 'unknown' → 수정·삭제 불가).
    // 가림 기능이 없는 옛 가짜 화면(시험 legacyNoMasking)만 예전처럼 둡니다. 그런 화면도 머리말을 한 번 보였으면 막습니다.
    if(h.state==='none'&&(this.maskingSeen||!this.legacyNoMasking))return MASKED.WRITE;
    const a=this.alignedOf(record),link=this.links?.attendee?.(record.classId,record.studentKey)||null;
    // 기록의 학생 번호(읽을 때 순번으로 맞춘 것)와 연결·지금 맞춘 번호가 다르면 다른 학생일 수 있어 쓰지 않습니다.
    if(record.attendeeId&&(link&&link.attendeeId!==record.attendeeId||a&&a.entry?.attendeeId!==record.attendeeId))return MASKED.TARGET;
    if(h.state==='unmasked'){
      // 남은 시간을 읽지 못해도(타이머 모양이 다름) 쓰지 않습니다(안전한 쪽).
      if(!Number.isFinite(h.remaining)||h.remaining<minSeconds)return MASKED.TIME;
      if(!link||link.source!=='plain-read')return this.ambiguousKeys?.has(record.studentKey)?MASKED.AMBIGUOUS:MASKED.UNLINKED;
      if(!a||a.entry?.attendeeId!==link.attendeeId)return MASKED.TARGET;
    }else if(link&&a&&a.entry?.attendeeId!==link.attendeeId)return MASKED.TARGET;
    return null;
  }
  // writer: {kind:'request', format} 이면 수정창 대신 순차 요청(requestWrite)으로 넣습니다. 확인·결과 판단(writeback.applyVerified)은 같습니다.
  async write(record,field,change,{requestedFields,deleteFields=[],writer=null}={}){
    if(writer?.kind==='request')return this.requestWrite(record,field,change,{requestedFields,deleteFields,writer});
    // 가린 화면에서는 어떤 경로로도 쓰지 않습니다: 머리말을 다시 보고, 아무것도 누르기 전에 거절합니다(요청은 대기로 남음).
    if(this.view)await this.readHeader();
    const blocked=this.writeBlocked(record);if(blocked)throw new Error(blocked);
    const before=await this.modal(record,field);
    const late=this.writeBlocked(record);if(late){await this.closeModal();throw new Error(late);}
    // 해제된 화면: 수정창의 기존 시간이 순번으로 맞춘 그 학생의 화면 데이터 값과 같아야 합니다(검토 4).
    if(this.headerNow().state==='unmasked'){const d=this.dayEntry(record);if(!d?.aligned||(d[field]??null)!==(before.time??null)){await this.closeModal();throw new Error(MASKED.TARGET);}}
    // 시간 삭제는 승인된 요청이 지정한 쪽만. 이미 비어 있으면 누를 것이 없습니다(다시 시도해도 안전).
    if(deleteFields.includes(field)){
      if(!requestedFields?.includes(field)){await this.closeModal();throw new Error('TIME_DELETE_REFUSED: 요청하지 않은 시간 삭제입니다.');}
      if(change?.time){await this.closeModal();throw new Error('TIME_DELETE_REFUSED: 삭제할 시간 칸에 시간이 들어 있습니다.');}
      if(!before.time){await this.closeModal();return {time:null,memo:before.memo};}
      return this.deleteTime(record,field,before);
    }
    let planned;try{planned=planChange(field,before,change,requestedFields,record);}catch(e){await this.closeModal();throw e;}
    const {change:next,automaticTime}=planned;
    await this.page.locator('#modifyTime').fill(next.time);await this.page.locator('#memoByAdmin').fill(next.memo);
    await this.submit(this.page.getByRole('button',{name:'변경',exact:true}),record);return {...next,...(automaticTime?{automaticTime}:{})};
  }
  // 순차 요청(2026-10-16, 4-2): 사람이 해제해 둔 이 탭 안에서 체크히어 자신의 변경·삭제 요청을 보냅니다(수정창 클릭·창 대기 없음).
  // 머리말이 '원문 표시 중'이고 남은 시간·확인된 연결·순번으로 맞춘 같은 학생 번호일 때만(수정창과 같은 확인), 본문은 내장 형식(기록한 형식이 있으면 그것)으로 만듭니다.
  // 지금 값·기록 번호는 그날 화면 데이터(마지막으로 다시 읽은, 순번으로 맞춘 그 학생)에서 봅니다(요청 때의 옛 번호를 쓰지 않음). 보내기 전 0.5~1초 간격을 둡니다(몰아서 보내지 않음).
  async requestWrite(record,field,change,{requestedFields,deleteFields=[],writer}={}){
    if(this.view)await this.readHeader();
    const blocked=this.writeBlocked(record);if(blocked)throw new Error(blocked);
    if(this.headerNow().state!=='unmasked')throw new Error(MASKED.WRITE);
    const a=this.alignedOf(record),d=this.dayEntry(record);if(!a||!d?.aligned)throw new Error(MASKED.TARGET);
    const op=deleteFields.includes(field)?'delete':'update',before={time:d[field]??null,memo:d[`${field}Memo`]??''};
    let planned;
    if(op==='delete'){
      // 시간 삭제는 수정창 '삭제'와 같은 기준: 승인된 요청이 지정한 쪽, 이미 비면 할 일 없음, 기록 번호가 있고 화면 데이터가 기록과 같을 때만.
      if(!requestedFields?.includes(field))throw new Error('TIME_DELETE_REFUSED: 요청하지 않은 시간 삭제입니다.');
      if(change?.time)throw new Error('TIME_DELETE_REFUSED: 삭제할 시간 칸에 시간이 들어 있습니다.');
      if(!before.time)return {time:null,memo:before.memo};
      if(d.rawEntry!==record.rawEntry||d.entry!==record.entry||d.exit!==record.exit)throw new Error('TIME_DELETE_REFUSED: 기록 번호가 없는 칸은 지우지 않습니다.');
      const why=timeDeleteRefusal(d,field);if(why)throw new Error('TIME_DELETE_REFUSED: '+why);
      planned={change:{time:null,memo:''}};
    }else planned=planChange(field,before,change,requestedFields,record);
    let scheduleId=null;try{scheduleId=new URL(this.day?.url).searchParams.get('scheduleId');}catch{}
    const link=this.links?.attendee?.(record.classId,record.studentKey)||null;
    const req=buildBody(writer?.format,{op,field,scheduleId,attendeeId:link?.attendeeId||a.entry?.attendeeId,date:record.date,entry:a.entry,schedule:record.schedule,time:planned.change.time,memo:planned.change.memo});
    const wait=this.lastSendAt+between(this.sendGapMs)-Date.now();if(this.lastSendAt&&wait>0)await sleep(wait);
    let result;try{result=await this.guarded(record,()=>sendEvent(this.page,req),{close:false,sent:v=>Number.isInteger(v?.status)});}finally{this.lastSendAt=Date.now();}
    if(!result?.ok)throw new Error(requestError(result));
    return {...planned.change,...(planned.automaticTime?{automaticTime:planned.automaticTime}:{})};
  }
  // 순차 요청을 보낼 수 있는지(잡기 전, 그날 화면이 열린 뒤): 머리말 '원문 표시 중'이고 그 탭의 화면 장치가 해제 헤더를 보았을 때만(값은 보지 않음).
  async requestReady(){if(!this.page||this.headerNow().state!=='unmasked')return false;return privacyHeaders(this.page);}
  // 미리보기(보내지 않음): 순차 요청으로 바꿀 칸 하나의 계획. 학생·일정·기록 번호 값은 돌려주지 않습니다(있음/없음만).
  requestPlan(record,field,change,{requestedFields,deleteFields=[],format=null}={}){
    const a=this.alignedOf(record),d=this.dayEntry(record),op=deleteFields.includes(field)?'delete':'update';
    const before={time:(d?d[field]:record[field])??null,memo:(d?d[`${field}Memo`]:record[`${field}Memo`])??''};
    let after=null,automaticTime,error=null;
    try{if(op==='delete')after={time:null,memo:''};else({change:after,automaticTime}=planChange(field,before,change,requestedFields,record));}catch(e){error=e.message;}
    return {field,op,typeEvent:field==='exit'?'COMPLETE':'ATTEND',before,after,...(automaticTime?{automaticTime}:{}),existEvent:a?!!eventOf(a.entry,field)?.eventId:null,wired:!!format?.kinds?.[op],...(error?{error}:{})};
  }
  // 저장(변경·삭제) 누르기. 누르는 동안만 체크히어 자신의 변경·삭제 요청 본문을 보고, 이 날(scheduleId)·순번으로 맞춘 이 학생(attendeeId)이
  // 아니면 그 요청을 막습니다(MASKED_TARGET, 검토 4). 늘 걸어 두지 않습니다(걸어 두면 브라우저 캐시가 꺼짐).
  async submit(button,record){
    await this.guarded(record,async()=>{await button.click();await this.page.locator('#modifyTime').waitFor({state:'hidden'});});
  }
  // 요청 하나를 내보내는 동안(fire: 수정창 저장 누르기 또는 화면 안의 순차 요청)만 체크히어 변경·삭제 요청을 보고 막습니다. fire의 결과를 돌려줍니다.
  // close: 끝나면 수정창 '취소'를 누를지(순차 요청은 연 창이 없으므로 아무것도 누르지 않음).
  // sent(결과): 요청이 실제로 나갔는지. 나갔는데 확인이 보지 못했을 때만 우회로 봅니다(세션이 없어 보내지 않은 순차 요청은 아님).
  async guarded(record,fire,{close=true,sent=()=>true}={}){
    // 연결된 학생 번호가 먼저(해제된 화면은 writeBlocked가 순번으로 맞춘 번호와 같음을 이미 확인), 없으면 순번으로 맞춘 번호.
    const a=this.alignedOf(record),link=this.links?.attendee?.(record.classId,record.studentKey)||null;
    let scheduleId=null;try{scheduleId=this.day?.url?new URL(this.day.url).searchParams.get('scheduleId'):null;}catch{}
    const want={scheduleId,attendeeId:link?.attendeeId||a?.entry?.attendeeId||null,blocked:false,seen:0};
    // 해제된 탭(가림 기능이 있는 체크히어)에서는 이 확인이 마지막 방어선이라, 확인이 우회되면(요청을 못 봄) 알아채고 멈춥니다.
    const mustSee=this.headerNow().state==='unmasked';
    const guard=async route=>{
      // 다른 주소(checkhere-admin-api)로 가는 PUT·DELETE 앞의 CORS 사전 확인(OPTIONS)은 본문이 없고 아무것도 바꾸지 않으므로 그대로 보냅니다.
      if(!['PUT','DELETE','POST','PATCH'].includes(route.request().method()))return route.fallback();
      want.seen++;let body=null;try{body=JSON.parse(route.request().postData()||'null');}catch{}
      if(body&&typeof body==='object'&&(!want.scheduleId||body.scheduleId===want.scheduleId)&&(!want.attendeeId||body.attendeeId===want.attendeeId))return route.fallback();
      want.blocked=true;return route.abort();
    };
    const routed=typeof this.page.route==='function'&&typeof this.page.unroute==='function';if(routed)await this.page.route(WRITE_REQUEST,guard);
    this.saving=true;let timer;
    try{
      const done=Promise.resolve().then(fire);done.catch(()=>{});
      const how=await Promise.race([done.then(value=>({value})),new Promise(r=>{timer=setInterval(()=>{if(want.blocked)r('blocked');},50);})]);
      if(how==='blocked'||want.blocked)throw new Error(MASKED.TARGET);
      // 창이 닫힌 뒤 늦게 나가는 요청도 2초까지 기다려 봅니다. 끝내 못 보면 확인이 우회된 것이므로 더 쓰지 않습니다(실제 저장 여부는 다시 읽어 판단).
      if(mustSee&&routed&&sent(how.value)){for(let t=0;t<40&&!want.seen&&!want.blocked;t++)await sleep(50);if(want.blocked)throw new Error(MASKED.TARGET);if(!want.seen){this.guardBroken=true;throw new Error(MASKED.GUARD);}}
      return how.value;
    }finally{clearInterval(timer);this.saving=false;if(routed)await this.page.unroute(WRITE_REQUEST,guard).catch(()=>{});if(close)await this.closeModal();}
  }
  // 수정창이 열린 채로 부릅니다. 그날 화면 데이터로 이 학생·이 칸의 기록 번호(eventId)를 지금 다시 확인합니다:
  // 퇴실은 COMPLETE 번호, 1교시는 번호 있는 ATTEND(퇴실이 이미 빈 뒤에만 — 두 칸 삭제는 writeback이 퇴실을 먼저 지우고 다시 읽은 뒤 부름). PASS(입실에서 계산)·번호 없음·확인 불가·시간 다름은 지우지 않습니다.
  // 표시를 붙일 때(markDeletable)와 같은 기준으로, 화면 데이터의 실제 입실·1교시·퇴실이 지금 기록과 모두 같을 때만 믿습니다.
  // 체크히어 '삭제'는 확인창 없이 바로 지우고 수정창을 닫습니다(Cowork 확인). 열린 수정창 안에 정확히 하나일 때 한 번만 누릅니다.
  async deleteTime(record,field,before){
    const refuse=async message=>{await this.closeModal();throw new Error('TIME_DELETE_REFUSED: '+message);};
    const d=this.dayEntry(record);
    const agree=!!d&&(d.aligned||d.name===record.name)&&d.rawEntry===record.rawEntry&&d.entry===record.entry&&d.exit===record.exit&&d[field]===before.time;
    if(!agree)return refuse('기록 번호가 없는 칸은 지우지 않습니다.');
    // 거절 이유는 규칙의 문장 그대로(관리자 1교시 삭제가 꺼져 있을 때도 그 이유를 보입니다).
    const why=timeDeleteRefusal(d,field);if(why)return refuse(why);
    // '삭제'는 수정창 안에서만 찾습니다. 수정창이 하나, 그 안에 하나, 화면 전체에도 하나일 때만 누릅니다(강의·학생 삭제 같은 다른 버튼을 누르지 않게).
    const box=this.page.locator('div.react-draggable').filter({has:this.page.locator('#modifyTime')}),button=box.getByRole('button',{name:'삭제',exact:true});
    if(await box.count()!==1||await button.count()!==1||await this.page.getByRole('button',{name:'삭제',exact:true}).count()!==1)return refuse('수정창의 삭제 버튼을 하나로 확인하지 못했습니다.');
    // 지운 뒤 메모는 다시 읽어 확인합니다(비어 있지 않으면 반영 결과가 failed로 끝납니다).
    await this.submit(button,record);return {time:null,memo:''};
  }
}
