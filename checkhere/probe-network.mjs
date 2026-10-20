// Read-only diagnostic: opens one class/day the way the collector does, records
// the data the CheckHere page itself downloads, and compares it with the
// existing modal-based read. It never clicks 변경 and sends no extra API calls.
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {CheckHereCollector} from './collector.mjs';
import {urlTemplate,schemaOf,matchRecords,verdict,networkSummary,summarize,mappingEvidence} from './probe-core.mjs';
import {studentKey} from './identity.mjs';
import {CLASS_IDS,classOk,validIso} from './cohort-bridge.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export const PROBE_VERSION='20261013.2';
// A response body can stay open forever (streams, requests cut off by a navigation).
// Never let one block the diagnosis.
const settle=(promise,ms,fallback)=>{let timer;return Promise.race([promise,new Promise(r=>{timer=setTimeout(()=>r(fallback),ms);})]).finally(()=>clearTimeout(timer));};
export function checkHereDayUrl(raw){
  let u;try{u=new URL(String(raw||'').trim());}catch{return null;}
  if(u.origin!=='https://check.ihereapp.com'||u.pathname!=='/history/lecture/modify'||!/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('scheduleDate')||''))return null;
  return {url:u.href,date:u.searchParams.get('scheduleDate')};
}

export async function runProbe({collector,classId,date,url:knownUrl=null,modal=true,limit=Infinity,log=console.log,bodyTimeoutMs=5000,settleMs=6000,heartbeatMs=10000,discoverTimeoutMs=180000}){
  const page=collector.page,context=page.context(),net=[],bodies=[],pending=[],timings={};
  let phase='idle',phaseStart=performance.now();
  const onResponse=res=>{
    const req=res.request();if(!['xhr','fetch'].includes(req.resourceType()))return;
    const entry={phase,at:Math.round(performance.now()-phaseStart),method:req.method(),url:urlTemplate(res.url()),status:res.status(),contentType:(res.headers()['content-type']||'').split(';')[0].trim()};
    net.push(entry);const bodyPhase=phase,length=Number(res.headers()['content-length']);if(Number.isFinite(length))entry.bytes=length;
    if(!/json/i.test(entry.contentType))return;
    pending.push((async()=>{try{const buf=await settle(res.body(),bodyTimeoutMs,null);if(!buf){entry.bodyError='timeout';return;}entry.bytes=buf.length;bodies.push({phase:bodyPhase,url:entry.url,json:JSON.parse(buf.toString('utf8'))});}catch(e){entry.bodyError=String(e?.message||e).slice(0,80);}})());
  };
  const step=async(name,fn)=>{
    phase=name;phaseStart=performance.now();const started=phaseStart;
    const beat=setInterval(()=>{let where='';try{where=new URL(page.url()).pathname;}catch{}log(`   …진행 중 ${Math.round((performance.now()-started)/1000)}초 · 현재 화면 ${where}`);},heartbeatMs);
    try{return await fn();}finally{clearInterval(beat);timings[name]=Math.round(performance.now()-phaseStart);await settle(Promise.allSettled(pending.splice(0)),settleMs);}
  };
  context.on('response',onResponse);
  try{
    log(knownUrl?'1/4 붙여 넣은 출결상세 주소를 사용합니다.':'1/4 반·날짜 화면 주소를 찾습니다. (강의 목록을 넘겨 보며 찾느라 시간이 걸릴 수 있습니다)');
    const url=knownUrl||await step('discover',()=>settle(collector.discover(classId,date),discoverTimeoutMs,null));
    if(!url)throw Error(`${Math.round(discoverTimeoutMs/60000)}분 안에 반·날짜 화면을 찾지 못했습니다. 체크히어에서 해당 날짜의 출결상세 화면을 열고 주소창 주소를 복사해, 진단 시작 때 붙여 넣어 주세요.`);
    log('2/4 새 방식: 화면을 한 번 열고 받은 데이터를 기록합니다.');
    await step('load',async()=>{
      await page.goto(url);await page.getByRole('table').nth(1).waitFor({state:'visible',timeout:20000});
      timings.tableVisible=Math.round(performance.now()-phaseStart);
      await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
    });
    log('3/4 기존 방식: 표를 열고 옵션(실제 시간·초·표시)을 적용합니다.');
    const rows=await step('openDay',()=>collector.openDay(classId,date,url));
    const records=[];
    if(modal){
      const list=rows.slice(0,limit);
      await step('modals',async()=>{for(const [i,row] of list.entries()){log(`4/4 기존 방식: 학생별 수정창 읽기 ${i+1}/${list.length}`);records.push(await collector.readDetails({...row}));}});
      timings.perStudentModal=list.length?Math.round(timings.modals/list.length):null;
    }
    const compared=records.length?records:rows,dayBodies=bodies.filter(b=>['load','openDay'].includes(b.phase));
    const match=matchRecords(compared,dayBodies);
    return {
      probeVersion:PROBE_VERSION,createdAt:new Date().toISOString(),classId:String(classId),date,
      students:rows.length,detailed:records.length,detailComplete:records.filter(r=>r.readState==='complete').length,
      timings,network:networkSummary(net),
      responses:net.map(({phase,at,method,url,status,contentType,bytes})=>({phase,at,method,url,status,contentType,bytes})),
      jsonSchema:schemaOf(dayBodies),match,verdict:verdict(match),
      modalPhaseMatch:modal?matchRecords(compared,bodies.filter(b=>b.phase==='modals')):null,
      mapping:mappingEvidence(compared,dayBodies.filter(b=>/attendee\/detail/.test(b.url)),{studentKey}),
    };
  }finally{context.off('response',onResponse);}
}

const LOCKED=/ProcessSingleton|already in use|SingletonLock|user data dir|profile.*(in use|locked)/i;
async function waitForLogin(collector,log,minutes=5){
  if(await collector.loggedIn())return;
  log('전용 크롬 창에서 체크히어에 로그인해 주세요. 로그인되면 자동으로 이어서 진행합니다. (최대 5분)');
  const until=Date.now()+minutes*60000;
  while(Date.now()<until){
    if(collector.page.isClosed())throw Error('전용 크롬 창이 닫혔습니다.');
    if(await collector.loggedIn().catch(()=>false))return;
    await new Promise(r=>setTimeout(r,2000));
  }
  throw Error('5분 안에 로그인을 확인하지 못했습니다.');
}
function parseArgs(argv){
  const a={};for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--class')a.classId=argv[++i];else if(k==='--date')a.date=argv[++i];else if(k==='--limit')a.limit=Number(argv[++i]);else if(k==='--no-modal')a.modal=false;else if(k==='--yes')a.modal=true;else if(k==='--url')a.url=argv[++i];else if(k==='--no-url')a.url='';}
  return a;
}
async function main(){
  const log=console.log,args=parseArgs(process.argv.slice(2));
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let classId=args.classId||(await rl.question(`진단할 반 번호(1~${CLASS_IDS.length}) [기본 1]: `)).trim()||'1';
  const pasted=args.url??(await rl.question('체크히어 출결상세 화면 주소가 있으면 붙여 넣으세요 (없으면 Enter, 자동으로 찾습니다): ')).trim();
  const known=pasted?checkHereDayUrl(pasted):null;
  if(pasted&&!known)throw Error('체크히어 출결상세 화면 주소(https://check.ihereapp.com/history/lecture/modify?...)를 붙여 넣어 주세요.');
  let date=known?.date||args.date||(await rl.question('날짜 YYYY-MM-DD (수업이 있었던 지난 평일, 메모·외출이 있던 날이면 더 좋습니다): ')).trim();
  let modal=args.modal;
  if(modal===undefined)modal=!/^n/i.test((await rl.question('기존 방식(학생별 수정창)도 같이 재서 비교할까요? 몇 분 걸립니다 [Y/n]: ')).trim());
  rl.close();
  if(!classOk(classId))throw Error(`반 번호는 1~${CLASS_IDS.length} 사이로 입력해 주세요.`);
  if(!validIso(date))throw Error('날짜는 2026-10-28 형식으로 입력해 주세요.');
  const dataDir=join(here,'data'),collector=new CheckHereCollector(dataDir);
  log('전용 크롬을 엽니다. (검수 프로그램과 같은 로그인 세션을 씁니다)');
  try{await collector.connect();}
  catch(e){if(LOCKED.test(e.message))throw Error('검수 프로그램의 전용 크롬이 이미 열려 있습니다. 그 크롬 창을 닫은 뒤 다시 실행해 주세요.');throw e;}
  try{
    await waitForLogin(collector,log);
    const report=await runProbe({collector,classId,date,url:known?.url||null,modal,limit:args.limit>0?args.limit:Infinity,log});
    const dir=join(dataDir,'probe');mkdirSync(dir,{recursive:true});
    const file=join(dir,`probe-${classId}-${date}-${new Date().toISOString().replace(/[:.]/g,'').slice(0,15)}.json`);
    writeFileSync(file,JSON.stringify(report,null,1));
    log(summarize(report));log(`\n결과 파일(학생 이름·번호·메모 내용 없음): ${file}`);
  }finally{await collector.context?.close().catch(()=>{});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(e=>{console.error('\n진단 중단: '+(e?.message||e));process.exitCode=1;});
