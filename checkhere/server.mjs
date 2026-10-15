import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {CheckHereCollector,sameTableRow} from './collector.mjs';
import {DELETE_MARKS} from './day-data.mjs';
import {judge,RULES,TIME_DELETE_CAPABILITY} from './rules.mjs';
import {applyVerified,confirmAlreadyApplied} from './writeback.mjs';
import {createApprovalCloud} from './cloud-approval.mjs';
import {readRequestRecord} from './request-record.mjs';
import {proposalFromApproval,prepareApproval,resultText} from './approval-core.mjs';
import {runProbe} from './probe-network.mjs';
import {summarize} from './probe-core.mjs';
import {writeFileSync} from 'node:fs';
const here=dirname(fileURLToPath(import.meta.url)),root=dirname(here);
// build는 Start.ps1의 값과 같아야 합니다(다르면 「체크히어 시작.cmd」가 쉬고 있는 연결 프로그램을 다시 띄웁니다).
const BUILD='20261014.2';
// time-delete-v1: 수정창 '삭제'로 기록 번호가 있는 칸(퇴실 COMPLETE·관리자 1교시 ATTEND)만 지웁니다(collector.deleteTime).
export const CAPABILITIES=Object.freeze(['memo-default-time-v1','approved-requests-v1','memo-only-requests-v1','approval-current-sync-v1','live-approval-preview-v1','automatic-request-collection-v1','phone-identity-v1','state-delta-v1','incremental-sync-v1','batch-sync-v1','probe-v1','page-data-v1',TIME_DELETE_CAPABILITY]);
const NO_LECTURE=/강의가 없습니다/;
// 시간 삭제 요청(deleteTimes가 비어 있지 않음). 모양이 이상해도 삭제로 봅니다(능력 없으면 거절하는 쪽이 안전).
const deletionRequest=r=>r?.deleteTimes!==undefined&&r?.deleteTimes!==null&&!(Array.isArray(r.deleteTimes)&&!r.deleteTimes.length);
// 플랫폼 저장(finish)이 돌려준 완료 문구에는 시간 삭제 확인이 없어, 이 PC 작업 글에 반영 결과로 다시 붙입니다(중계 기록에 남게).
const withDeleted=(message,j)=>resultText(message,j.results);
export function createBridge({dataDir=join(here,'data'),collector=null,port=8765,approvalCloud=createApprovalCloud(),capabilities=CAPABILITIES}={}){
  mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(join(dataDir,'attendance.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots(seq INTEGER PRIMARY KEY, id TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS snapshot_id ON snapshots(id,seq); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY, job TEXT, payload TEXT);');
  const key=randomBytes(32).toString('hex'),adapter=collector||new CheckHereCollector(dataDir),jobs=new Map();let busy=null,connecting=false;
  // SQLite remains the source of truth. Publish a new cursor only after its
  // snapshot is persisted; polling must not re-judge the entire history.
  const instance=randomUUID(),snapshots=new Map();let revision=0;
  for(const row of db.prepare('SELECT seq,id,payload FROM snapshots WHERE seq IN (SELECT MAX(seq) FROM snapshots GROUP BY id)').all()){
    snapshots.set(row.id,{seq:row.seq,record:JSON.parse(row.payload)});revision=Math.max(revision,row.seq);
  }
  const insertSnapshot=db.prepare('INSERT INTO snapshots(id,payload) VALUES(?,?)');
  const put=r=>{const payload=JSON.stringify(r),saved=insertSnapshot.run(r.id,payload),seq=Number(saved.lastInsertRowid);snapshots.set(r.id,{seq,record:JSON.parse(payload)});revision=seq;return saved;};
  const latest=()=>[...snapshots.values()].map(x=>x.record);
  const delta=cursor=>{
    const prefix=instance+':',raw=typeof cursor==='string'&&cursor.startsWith(prefix)?cursor.slice(prefix.length):'',since=/^\d+$/.test(raw)?Number(raw):-1;
    const merge=Number.isSafeInteger(since)&&since>=0&&since<=revision;
    return{recordsMode:merge?'merge':'replace',cursor:prefix+revision,records:[...snapshots.values()].filter(x=>!merge||x.seq>since).map(x=>x.record)};
  };
  const get=id=>{const r=db.prepare('SELECT payload FROM snapshots WHERE id=? ORDER BY seq DESC LIMIT 1').get(id);return r?JSON.parse(r.payload):null;};
  const saveJob=j=>{db.prepare('INSERT INTO jobs(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(j.id,JSON.stringify(j));jobs.set(j.id,j);};
  for(const row of db.prepare('SELECT payload FROM jobs').all()){const j=JSON.parse(row.payload);if(j.status==='running'){j.status=j.kind==='apply'?'unknown':'interrupted';j.message='프로그램이 중단되었습니다. 다시 수집해 결과를 확인해 주세요.';saveJob(j);}jobs.set(j.id,j);}
  const seed=join(dataDir,'seed.json');if(!latest().length&&existsSync(seed))for(const r of JSON.parse(readFileSync(seed,'utf8')))put({...r,source:'snapshot',readState:'partial'});
  // Remembered CheckHere addresses survive restarts, so a repeated period
  // collection skips the paged lecture search. The collector re-looks-up any
  // address that no longer opens the right class/day.
  db.exec('CREATE TABLE IF NOT EXISTS places(key TEXT PRIMARY KEY, url TEXT NOT NULL, savedAt TEXT NOT NULL);');
  const placeOk=u=>{try{const x=new URL(u);return x.origin==='https://check.ihereapp.com'&&x.pathname.startsWith('/history/lecture/');}catch{return false;}};
  const remembers=adapter.urls instanceof Map&&adapter.lectureUrls instanceof Map;
  if(remembers)for(const row of db.prepare('SELECT key,url FROM places').all()){if(!placeOk(row.url))continue;if(/^lecture\|(?:[1-9]|1[0-7])$/.test(row.key))adapter.lectureUrls.set(row.key.slice(8),row.url);else if(/^(?:[1-9]|1[0-7])\|\d{4}-\d{2}-\d{2}$/.test(row.key))adapter.urls.set(row.key,row.url);}
  const rememberPlaces=()=>{
    if(!remembers)return;const now=new Date().toISOString(),current=new Map([...adapter.urls,...[...adapter.lectureUrls].map(([k,v])=>['lecture|'+k,v])].filter(([,v])=>placeOk(v)));
    const upsert=db.prepare('INSERT INTO places(key,url,savedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET url=excluded.url,savedAt=excluded.savedAt WHERE places.url<>excluded.url'),drop=db.prepare('DELETE FROM places WHERE key=?');
    for(const [k,v] of current)upsert.run(k,v,now);for(const row of db.prepare('SELECT key FROM places').all())if(!current.has(row.key))drop.run(row.key);
  };
  // Same student, same complete content as the last stored read (memos included).
  // 시간 삭제 표시(기록 번호)가 다르거나 옛 build의 저장본이라 없으면 한 번 다시 저장합니다(버전은 그대로).
  const sameStored=r=>{const old=snapshots.get(r.id)?.record;return !!old&&old.source==='live'&&old.readState==='complete'&&old.version===r.version&&old.tableSignature===r.tableSignature&&old.studentKey===r.studentKey&&DELETE_MARKS.every(k=>old[k]===r[k]);};
  const journal=(job,event)=>db.prepare('INSERT INTO journal(job,payload) VALUES(?,?)').run(job,JSON.stringify({at:new Date().toISOString(),...event}));
  const authorized=req=>{const raw=req.headers['x-hint-key'];return typeof raw==='string'&&raw.length===key.length&&timingSafeEqual(Buffer.from(raw),Buffer.from(key));};
  const localOrigin=o=>!o||o===`http://127.0.0.1:${port}`||o===`http://localhost:${port}`;
  const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)throw new Error('요청이 너무 큽니다.');}return raw?JSON.parse(raw):{};}
  const publicFiles={'/checkhere-name-core.mjs':'checkhere-name-core.mjs','/survey-identity.mjs':'survey-identity.mjs','/attendance-beta-core.mjs':'attendance-beta-core.mjs','/checkhere/bulk-collect.mjs':'checkhere/bulk-collect.mjs','/':'checkhere.html','/checkhere.html':'checkhere.html','/checkhere-ui.mjs':'checkhere-ui.mjs','/checkhere/ui.css':'checkhere/ui.css','/checkhere/rules.mjs':'checkhere/rules.mjs'};
  const server=http.createServer(async(req,res)=>{
    try{
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,{error:'허용하지 않는 주소입니다.'});
      const url=new URL(req.url,`http://127.0.0.1:${port}`),origin=req.headers.origin;
      if(req.method==='OPTIONS'){
        if(origin&&!localOrigin(origin)&&!origin.startsWith('https://'))return send(res,403,{error:'HTTPS 플랫폼에서 연결해 주세요.'});
        res.writeHead(204,{'Access-Control-Allow-Origin':origin||`http://127.0.0.1:${port}`,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, x-hint-key','Access-Control-Allow-Private-Network':'true','Vary':'Origin'});return res.end();
      }
      if(url.pathname==='/api/session'&&req.method==='GET'){
        if(!localOrigin(origin))return send(res,403,{error:'연결 키는 이 PC 화면에서 확인해 주세요.'});return send(res,200,{key,local:true,build:BUILD,capabilities,pid:process.pid});
      }
      if(url.pathname.startsWith('/api/')){
        if(!authorized(req))return send(res,401,{error:'이 PC의 연결 키를 입력해 주세요.'});
        if(origin&&!localOrigin(origin)){if(!origin.startsWith('https://'))return send(res,403,{error:'HTTPS 플랫폼에서 연결해 주세요.'});res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
        if(req.method==='GET'&&url.pathname==='/api/state'){
          const connected=await adapter.loggedIn();
          // Take records, cursor and job progress together, after the await.
          return send(res,200,{rules:RULES,capabilities,build:BUILD,busy,jobs:[...jobs.values()].slice(-20).reverse(),connected,...(url.searchParams.get('delta')==='1'?delta(url.searchParams.get('cursor')):{records:latest().map(r=>({...r,audit:judge(r)}))})});
        }
        if(req.method==='GET'&&url.pathname==='/api/history'){const id=url.searchParams.get('id');return send(res,200,{snapshots:db.prepare('SELECT payload FROM snapshots WHERE id=? ORDER BY seq DESC LIMIT 20').all(id).map(x=>JSON.parse(x.payload))});}
        if(req.method!=='POST')return send(res,405,{error:'지원하지 않는 요청입니다.'});const input=await body(req);
        if(url.pathname==='/api/cancel'){if(busy&&['sync','batch'].includes(jobs.get(busy)?.kind))adapter.cancelled=true;return send(res,200,{ok:true});}
        if(url.pathname==='/api/connect'){
          if(busy||connecting)return send(res,409,{error:'연결 또는 작업이 진행 중입니다.'});
          connecting=true;try{return send(res,200,await adapter.connect());}finally{connecting=false;}
        }
        if(url.pathname==='/api/sync'){
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});const classId=String(input.classId),dates=input.dates;
          if(!/^(?:[1-9]|1[0-7])$/.test(classId)||!Array.isArray(dates)||!dates.length||dates.length>31||new Set(dates).size!==dates.length||dates.some(d=>!/^202\d-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new Error('반 또는 날짜 범위를 확인해 주세요. 최대 31일입니다.');
          const incremental=input.mode==='incremental';
          // 로그인 확인(await) 전에 임시 값으로 잠가야 그 틈에 다른 작업이 들어오지 않습니다.
          const claim='start:'+randomUUID();busy=claim;try{await adapter.requireLogin();}catch(e){if(busy===claim)busy=null;throw e;}
          adapter.cancelled=false;const j={id:randomUUID(),kind:'sync',classId,dates,status:'running',startedAt:new Date().toISOString(),count:0,errors:0,...(incremental?{mode:'incremental',skipped:0}:{}),message:'출결 상세를 읽고 있습니다.'};saveJob(j);busy=j.id;
          // Incremental: students whose visible row equals their last complete read
          // keep that record; no editor is opened and no snapshot row is added.
          const unchanged=incremental?row=>{const same=sameTableRow(snapshots.get(row.id)?.record,row);if(same)j.skipped++;return same;}:null;
          void(async()=>{try{
            await adapter.collect(classId,dates,async r=>{const old=get(r.id);if(old?.reference)r.reference=old.reference;if(old?.exception)r.exception=old.exception;put(r);j.count++;if(r.readState!=='complete')j.errors++;saveJob(j);},async progress=>{j.progress=progress;saveJob(j);},{unchanged,...(incremental?{pageData:true,sameAsStored:r=>{const same=sameStored(r);if(same)j.skipped++;return same;},onDay:d=>{j.method=d.method;if(d.note)j.methodNote=d.note;}}:{})});
            j.status=adapter.cancelled?'cancelled':j.errors?'partial':'complete';j.message=`${j.count}건 수집${incremental?` · 변경 없음 ${j.skipped}건`:''} · 상세 확인 실패 ${j.errors}건`;
          }catch(e){j.status=j.count?'partial':'failed';j.message=e.message;}finally{j.finishedAt=new Date().toISOString();saveJob(j);rememberPlaces();if(busy===j.id)busy=null;}})();return send(res,202,j);
        }
        // Several classes × a period in one job: no per-day request/poll gaps, one
        // schedule scan per class, a second attempt for failed or partly read days.
        if(url.pathname==='/api/sync-batch'){
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          const validDate=d=>typeof d==='string'&&/^202\d-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
          const classIds=Array.isArray(input.classIds)?[...new Set(input.classIds.map(String))].sort((a,b)=>a-b):[],dates=Array.isArray(input.dates)?[...new Set(input.dates)].sort():[];
          if(!classIds.length||classIds.length>17||classIds.some(c=>!/^(?:[1-9]|1[0-7])$/.test(c))||!dates.length||dates.length>130||!dates.every(validDate))throw new Error('반(1~17)과 날짜를 확인해 주세요. 한 번에 최대 130일입니다.');
          const mode=input.mode==='full'?'full':'incremental';
          const claim='start:'+randomUUID();busy=claim;try{await adapter.requireLogin();}catch(e){if(busy===claim)busy=null;throw e;}
          adapter.cancelled=false;
          const j={id:randomUUID(),kind:'batch',classIds,dates,mode,status:'running',startedAt:new Date().toISOString(),total:classIds.length*dates.length,done:0,count:0,skipped:0,errors:0,results:[],message:'선택한 반·기간을 차례로 읽고 있습니다.'};saveJob(j);busy=j.id;
          let savedAt=0;const persist=force=>{const t=Date.now();if(force||t-savedAt>2000){savedAt=t;saveJob(j);}};
          const finish=result=>{result.finishedAt=new Date().toISOString();const i=j.results.findIndex(r=>r.classId===result.classId&&r.date===result.date);if(i>=0)j.results[i]=result;else j.results.push(result);j.done=j.results.length;persist(true);rememberPlaces();return result;};
          const runDay=async(classId,date,attempt)=>{
            const result={classId,date,status:'running',count:0,skipped:0,errors:0,attempt,startedAt:new Date().toISOString()};j.current={classId,date};
            const unchanged=mode==='incremental'?row=>{const same=sameTableRow(snapshots.get(row.id)?.record,row);if(same){result.skipped++;j.skipped++;}return same;}:null;
            try{
              await adapter.collect(classId,[date],async r=>{const old=get(r.id);if(old?.reference)r.reference=old.reference;if(old?.exception)r.exception=old.exception;put(r);result.count++;j.count++;if(r.readState!=='complete'){result.errors++;j.errors++;}persist();},async progress=>{j.progress={...progress,classId};persist();},{unchanged,...(mode==='incremental'?{pageData:true,sameAsStored:r=>{const same=sameStored(r);if(same){result.skipped++;j.skipped++;}return same;},onDay:d=>{result.method=d.method;if(d.method==='page-data')j.pageDays=(j.pageDays||0)+1;if(d.note)result.note=d.note;}}:{})});
              result.status=adapter.cancelled?'cancelled':result.errors?'partial':'complete';
            }catch(e){result.status=NO_LECTURE.test(e.message)?'no-lecture':'failed';result.message=e.message;if(/LOGIN_REQUIRED/.test(e.message)){finish(result);throw e;}}
            return finish(result);
          };
          void(async()=>{try{
            for(const classId of classIds){
              if(adapter.cancelled)break;let known=null;
              if(typeof adapter.lectureDates==='function'&&dates.some(d=>!adapter.urls?.has?.(`${classId}|${d}`))){
                try{const scan=await adapter.lectureDates(classId);if(scan?.complete&&scan.dates?.length)known={set:new Set(scan.dates),min:scan.dates[0],max:scan.dates.at(-1)};}
                catch(e){if(/LOGIN_REQUIRED/.test(e.message))throw e;if(/강의를 찾지 못했습니다/.test(e.message)){for(const date of dates)finish({classId,date,status:'failed',message:e.message,count:0,skipped:0,errors:0});continue;}}
              }
              for(const date of dates){
                if(adapter.cancelled)break;
                // Only a complete scan whose date range covers the day may rule a lecture out.
                if(known&&!known.set.has(date)&&date>=known.min&&date<=known.max&&!adapter.urls?.has?.(`${classId}|${date}`)){finish({classId,date,status:'no-lecture',message:'체크히어 강의 목록에 없는 날짜',count:0,skipped:0,errors:0});continue;}
                await runDay(classId,date,1);
              }
            }
            for(const r of j.results.filter(r=>['failed','partial'].includes(r.status)&&!/강의를 찾지 못했습니다/.test(r.message||''))){if(adapter.cancelled)break;await runDay(r.classId,r.date,2);}
            const bad=j.results.filter(r=>['failed','partial'].includes(r.status)).length,none=j.results.filter(r=>r.status==='no-lecture').length;
            j.status=adapter.cancelled?'cancelled':bad?'partial':'complete';
            j.message=`${j.done}/${j.total} 반·날짜 · 저장 ${j.count}명${mode==='incremental'?` · 변경 없음 ${j.skipped}명 · 화면 데이터로 읽은 날 ${j.pageDays||0}`:''} · 강의 없음 ${none} · 확인 필요 ${bad}`;
          }catch(e){j.status=j.count?'partial':'failed';j.message=e.message;}finally{delete j.current;j.finishedAt=new Date().toISOString();saveJob(j);rememberPlaces();if(busy===j.id)busy=null;}})();
          return send(res,202,j);
        }
        // Read-only diagnosis inside the bridge: reuses its logged-in dedicated Chrome,
        // so it never fights over the Chrome profile. Writes only data/probe/*.json.
        if(url.pathname==='/api/probe'){
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          const classId=String(input.classId||'2'),date=String(input.date||''),knownUrl=typeof input.url==='string'&&input.url.startsWith('https://check.ihereapp.com/history/lecture/modify?')?input.url:null;
          if(!/^(?:[1-9]|1[0-7])$/.test(classId)||!/^202\d-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))throw new Error('반과 날짜를 확인해 주세요.');
          const j={id:randomUUID(),kind:'probe',classId,date,status:'running',startedAt:new Date().toISOString(),message:'진단을 준비하고 있습니다.'};saveJob(j);busy=j.id;
          void(async()=>{try{
            if(!adapter.page||adapter.page.isClosed?.())await adapter.connect();
            for(let i=0;i<90&&!await adapter.loggedIn().catch(()=>false);i++){j.message='전용 크롬에서 체크히어 로그인을 기다리고 있습니다.';await new Promise(r=>setTimeout(r,2000));}
            if(!await adapter.loggedIn().catch(()=>false))throw new Error('LOGIN_REQUIRED: 전용 크롬에서 체크히어에 로그인해 주세요.');
            const report=await runProbe({collector:adapter,classId,date,url:knownUrl,modal:input.modal!==false,log:t=>{j.message=String(t).trim();}});
            const dir=join(dataDir,'probe');mkdirSync(dir,{recursive:true});
            const file=join(dir,`probe-${classId}-${date}-${new Date().toISOString().replace(/[:.]/g,'').slice(0,15)}.json`);
            writeFileSync(file,JSON.stringify(report,null,1));
            j.report=file;j.summary=summarize(report);j.status='complete';j.message='진단 완료';
          }catch(e){j.status='failed';j.message=e.message;}finally{j.finishedAt=new Date().toISOString();saveJob(j);if(busy===j.id)busy=null;}})();
          return send(res,202,j);
        }
        if(url.pathname==='/api/preview-request'){
          await approvalCloud.verify(input.idToken);
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          const tok='preview:'+randomUUID();busy=tok;try{
            const request=await approvalCloud.get(input.approvalId,input.idToken);
            if(!['pending','approved'].includes(request.data.status))throw Error('이미 처리된 요청입니다.');
            const current=await readRequestRecord(adapter,request.data,latest(),request.identities,put);
            return send(res,200,{record:current});
          }finally{if(busy===tok)busy=null;}
        }
        if(url.pathname==='/api/apply'||url.pathname==='/api/confirm-existing'){
          await approvalCloud.verify(input.idToken);
          const approvalId=input.approvalId;if(typeof approvalId!=='string'||!/^[-\w]{16,80}$/.test(approvalId))throw Error('승인된 수정 요청 번호가 필요합니다.');
          if(jobs.get(approvalId)?.approvalId===approvalId)return send(res,200,jobs.get(approvalId));
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          busy=approvalId;
          let j,record,proposal,request,confirmed,identities;
          try{
            let approved=await approvalCloud.get(approvalId,input.idToken);
            // 시간 삭제를 지원하지 않는 연결 프로그램은 읽기·승인(approveExisting)·잡기(claim) 전에 거절합니다. 요청 상태는 그대로 둡니다.
            if(deletionRequest(approved.data)&&!capabilities.includes(TIME_DELETE_CAPABILITY))throw Error('이 연결 프로그램은 체크히어 시간 삭제를 지원하지 않습니다. 수집 PC에서 최신 「체크히어 시작.cmd」를 다시 실행해 주세요.');
            await adapter.requireLogin();
            if(url.pathname==='/api/confirm-existing'){
              if(approved.data.status!=='pending'){if(busy===approvalId)busy=null;return send(res,200,{status:approved.data.status,...approved.data.result});}
              record=await readRequestRecord(adapter,approved.data,latest(),approved.identities,put);confirmed=record;
              if(!confirmAlreadyApplied(approved.data,record,confirmed,approved.identities)){if(confirmed?.id===record.id)put(confirmed);if(busy===approvalId)busy=null;return send(res,200,{status:'pending',message:'현재 원본은 요청값과 다릅니다. 승인 대기를 유지합니다.'});}
              put(confirmed);record=confirmed;approved=await approvalCloud.approveExisting(approved,input.idToken,confirmed);
            }
            request=approved.data;identities=approved.identities;proposal=proposalFromApproval(request);
            record=record||await readRequestRecord(adapter,request,latest(),identities,put);
            if(record.id!==proposal.id)throw Error('승인된 학생과 수집된 학생의 식별정보가 다릅니다.');
            const live=prepareApproval(request,record,{allowAlreadyApplied:true,identities});
            proposal={id:record.id,version:record.version,...live.after,reason:live.reason};
            const attemptId=randomUUID();await approvalCloud.claim(approved,input.idToken,attemptId);
            j={id:approvalId,approvalId,attemptId,approvedBy:approved.data.approvedBy,kind:'apply',recordId:record.id,status:'running',startedAt:new Date().toISOString(),message:'승인된 변경 전 값을 다시 확인하고 있습니다.'};saveJob(j);
          }catch(e){if(busy===approvalId)busy=null;throw e;}
          const idToken=input.idToken;
          void(async()=>{try{const result=confirmed?{status:'verified',alreadyApplied:true,message:'이미 반영 · 원본 확인 완료',results:[],current:confirmed}:await applyVerified(adapter,record,proposal,async e=>journal(j.id,e),request,identities);Object.assign(j,result);if(result.current&&!confirmed)put(result.current);}catch(e){j.status='failed';j.message=e.message;}finally{
            j.finishedAt=new Date().toISOString();saveJob(j);
            try{const result=await approvalCloud.finish(approvalId,idToken,j.attemptId,j);j.cloudSaved=true;j.platformSaved=result?.platformSaved===true;if(result?.message)j.message=withDeleted(result.message,j);delete j.cloudError;}catch(e){j.cloudSaved=false;j.platformSaved=false;j.cloudError='체크히어 원본 확인 후 플랫폼 DB 저장을 완료하지 못했습니다. 결과 확인을 누르면 재입력 없이 저장을 다시 확인합니다. '+e.message;}
            saveJob(j);if(busy===approvalId)busy=null;
          }})();return send(res,202,j);
        }
        if(url.pathname==='/api/reconcile'){
          await approvalCloud.verify(input.idToken);const doc=await approvalCloud.get(input.approvalId,input.idToken),j=jobs.get(input.approvalId);
          if(j?.status==='running')return send(res,200,j);
          if(doc.data.status!=='applying')return send(res,200,{status:doc.data.status,...doc.data.result});
          const result=j?.approvalId===input.approvalId?j:{id:input.approvalId,status:'unknown',message:'이 PC에 반영 완료 기록이 없습니다. 처리한 PC와 체크히어 원본을 확인해 주세요.'};
          if(j&&j.attemptId!==doc.data.attemptId)throw Error('다른 PC의 작업입니다. 처리한 PC에서 결과를 확인해 주세요.');
          if(!j)throw Error('이 PC에서 시작한 작업이 아닙니다. 처리한 수집 PC에서 결과 확인을 눌러 주세요.');
          const saved=await approvalCloud.finish(input.approvalId,input.idToken,doc.data.attemptId,result);j.cloudSaved=true;j.platformSaved=saved?.platformSaved===true;if(saved?.message)j.message=withDeleted(saved.message,j);delete j.cloudError;saveJob(j);return send(res,200,j);
        }
        return send(res,404,{error:'지원하지 않는 기능입니다.'});
      }
      if(req.method==='GET'&&publicFiles[url.pathname]){
        const ext=url.pathname.endsWith('.mjs')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html';
        res.writeHead(200,{'Content-Type':`${ext}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});return res.end(readFileSync(join(root,publicFiles[url.pathname])));
      }
      return send(res,404,{error:'페이지를 찾지 못했습니다.'});
    }catch(e){return send(res,400,{error:e.message||'요청 처리 오류'});}
  });
  return{server,db,adapter,key,put,close:()=>{server.close();db.close();}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const app=createBridge();app.server.listen(8765,'127.0.0.1',()=>console.log('HINT 체크히어 검수: http://127.0.0.1:8765'));
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'이미 실행 중입니다. http://127.0.0.1:8765 를 열어 주세요.':e.message);process.exitCode=1;});
}
