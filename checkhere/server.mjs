import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {CheckHereCollector,sameTableRow,presetLecture} from './collector.mjs';
import {DELETE_MARKS,LOCAL_ONLY as PC_ONLY,outward} from './day-data.mjs';
import {judge,RULES,TIME_DELETE_CAPABILITY,TIME_DELETE_V2_CAPABILITY,PRIVACY_STATE_CAPABILITY,PRIVACY_MIN_WRITE_SECONDS,privacyState} from './rules.mjs';
import {applyVerified,confirmAlreadyApplied,planRequest} from './writeback.mjs';
import {EVENT_REQUEST_CAPABILITY,formatWith} from './event-request.mjs';
import {recordFormat,saveFormat,loadFormat,formatSummary} from './format-record.mjs';
import {createApprovalCloud} from './cloud-approval.mjs';
import {readRequestRecord} from './request-record.mjs';
import {proposalFromApproval,prepareApproval,resultText,requestMatchesRecord} from './approval-core.mjs';
import {runProbe} from './probe-network.mjs';
import {summarize} from './probe-core.mjs';
import {runApiProbe,summarizeApi,validDate,dayIds,cleanMessage,API_PROBE_CAPABILITY} from './probe-api.mjs';
import {writeFileSync} from 'node:fs';
import {createLinkStore} from './links.mjs';
import {MASKED,MIN_CLAIM_SECONDS,hasMask,waitsForUnmask,unmaskReason} from './masking.mjs';
import {startUnmask,enterCode,cancelUnmask} from './unmask.mjs';
import {COHORT,CLASSES,CLASS_IDS,HOLIDAYS,LECTURE_NAME_RULE,BRIDGE_PORT,PERIOD_TEXT,classOk,validIso,inPeriod,lectureTag,trainingDays,firebaseReady} from './cohort-bridge.mjs';
import {createRosterStore,parseRoster,rosterKeys,manualFits} from './roster.mjs';
import {createSetupStore,buildReport,reportView,reportCounts,confirmList,pairRow,unpairRow,exportText,SETUP_TEXT,ATTENDEE_ID} from './setup.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=dirname(here);
// build: Start.ps1·「체크히어 시작.command」가 이 줄에서 읽어 비교합니다(다르면 쉬고 있는 연결 프로그램을 다시 띄움). 2기 연결 프로그램은 2기-로 시작합니다.
export const BUILD='2기-20261019.1';
// time-delete-v1: 기록 번호가 있는 칸(퇴실 COMPLETE·1교시 ATTEND)만 지웁니다(collector.deleteTime·requestWrite).
// time-delete-v2: 두 칸 삭제(퇴실 먼저 → 다시 읽기 → 남은 ATTEND 1교시 → 다시 읽어 두 칸 확인, writeback.applyVerified). 퇴실이 남은 1교시만의 삭제는 거절합니다.
// privacy-state-v1: /api/status·/api/state의 privacy(rules.mjs privacyState, 이름 없음). 수정·삭제는 해제·남은 150초일 때만(K4).
// api-probe-v1: 읽기 전용 체크히어 가림 진단(/api/api-probe, probe-api.mjs). 화면이 받은 출결상세 응답만 보고 따로 요청하지 않습니다.
// masked-identity-v1: 체크히어 개인정보 가림 화면에서 학생 번호(attendeeId) 연결로 읽고, 쓰기는 이 탭이 해제된 동안만 합니다(masking.mjs).
export const MASKED_IDENTITY_CAPABILITY='masked-identity-v1';
// event-request-v1: 순차 수정(event-request.mjs). /api/apply·/api/apply-batch의 writer 없음(자동: 순차 요청이 준비되면 그것, 아니면 수정창)·'request'·'editor', 미리보기, 형식 기록(/api/record-format).
// 내장 형식(2026-10-16 기록)으로 보내고, 사람이 해제한 탭의 헤더가 있을 때만 그 탭 안에서 보냅니다(켜기 단계 없음 — 사람의 해제가 관문). 첫 실행은 build마다 1건(「확인했음」 전까지 나머지는 수정창).
export const CAPABILITIES=Object.freeze(['memo-default-time-v1','approved-requests-v1','memo-only-requests-v1','approval-current-sync-v1','live-approval-preview-v1','automatic-request-collection-v1','phone-identity-v1','state-delta-v1','incremental-sync-v1','batch-sync-v1','probe-v1','page-data-v1',TIME_DELETE_CAPABILITY,API_PROBE_CAPABILITY,MASKED_IDENTITY_CAPABILITY,EVENT_REQUEST_CAPABILITY,TIME_DELETE_V2_CAPABILITY,PRIVACY_STATE_CAPABILITY]);
const LOCAL_ONLY=`체크히어 해제·연결 정리·형식 기록·「확인했음」·2기 준비(반→강의 연결·명단)는 수집 PC의 연결 프로그램 화면(127.0.0.1:${BRIDGE_PORT})에서만 합니다.`;
// 순차 수정 안내(이름 없음)
const FIRST_RUN_NOTE=`이 build의 첫 순차 수정 1건을 사람이 확인하기 전이라 이 건은 수정창으로 반영했습니다. 체크히어에서 그 1건을 확인한 뒤 연결 프로그램 화면(127.0.0.1:${BRIDGE_PORT}/writer)에서 「확인했음」을 누르면 순차 수정으로 바뀝니다.`;
const HEADERS_MISSING='EVENT_REQUEST_HEADERS: 체크히어 탭에서 사람이 해제한 헤더를 확인하지 못해 순차 수정을 시작하지 않았습니다(아무것도 보내지 않음). 수집 PC의 체크히어 탭에서 마스킹 해제(또는 연장)를 확인한 뒤 다시 반영해 주세요.';
// 작업 글에 붙이는 가림 요약(이름 없음, 수만)
// unread: 가린 화면에서 읽지 못해 저장된 기록을 그대로 둔 학생(확인 필요로 셈, 새 행을 만들지 않음).
const countView=(j,v)=>{if(v?.view==='masked')j.masked=(j.masked||0)+1;for(const k of ['unlinked','mismatch','conflicts','unread'])if(v?.[k])j[k]=(j[k]||0)+v[k];};
const maskNote=j=>{const n=(j.unlinked||0)+(j.mismatch||0);return `${j.masked?` · 가린 화면 ${j.masked}일`:''}${n?` · 연결 안 됨 ${n}명`:''}${j.unread?` · 가린 화면에서 못 읽음 ${j.unread}명(저장본 유지)`:''}${j.conflicts?` · 연결 충돌 ${j.conflicts}명`:''}`;};
const NO_LECTURE=/강의가 없습니다/;
// 2기 연결 프로그램은 새 data 폴더에서 시작합니다: 2기 시작 전 날짜의 기록(1기 자료)이 있으면 학생 연결·담임이 섞이므로 켜지 않습니다(fail closed).
export const OLD_DATA=n=>`OLD_DATA: 이 data 폴더에 2기 시작(${COHORT.period.start}) 전 기록 ${n}건이 있습니다(1기 자료로 보임). 2기 연결 프로그램은 새 폴더의 새 data에서 시작해 주세요(1기 연결 프로그램은 8765 그대로 둠).`;
const DATE_HINT=`반(1~${CLASS_IDS.length})과 날짜(2기 교육 기간 ${PERIOD_TEXT})를 확인해 주세요.`;
// 시간 삭제 요청(deleteTimes가 비어 있지 않음). 모양이 이상해도 삭제로 봅니다(능력 없으면 거절하는 쪽이 안전).
const deletionRequest=r=>r?.deleteTimes!==undefined&&r?.deleteTimes!==null&&!(Array.isArray(r.deleteTimes)&&!r.deleteTimes.length);
// 플랫폼 저장(finish)이 돌려준 완료 문구에는 시간 삭제 확인이 없어, 이 PC 작업 글에 반영 결과로 다시 붙입니다(중계 기록에 남게).
const withDeleted=(message,j)=>resultText(message,j.results);
// learnTickMs·writeGapMs: 연결 확인 수집을 보는 간격과, 쓰기 시도 뒤(해제 직후 포함) 그 수집을 미루는 시간. 시험만 줄여 씁니다.
// itemGapMs: 묶음 반영에서 건과 건 사이(0.5~1초). recordTimeoutMs: 형식 기록을 기다리는 최대 시간(10분). privacyPollMs: 쉬는 동안 머리말(가림 상태)을 보는 간격(15초).
// collectable(date): 수집할 수 있는 날(기본 2기 교육 기간 안). allowOldData: 시험 전용(2기 전 날짜 기록이 든 data로도 켬).
export function createBridge({dataDir=join(here,'data'),collector=null,port=BRIDGE_PORT,approvalCloud=createApprovalCloud(),capabilities=CAPABILITIES,learnTickMs=3000,writeGapMs=60000,itemGapMs=[500,1000],recordTimeoutMs=10*60000,privacyPollMs=15000,collectable=inPeriod,allowOldData=false}={}){
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
  // 가린 글자(*)가 든 이름·담임·키·끝 4자리는 SQLite에 넣지 않습니다(가린 값이 이름·키가 되지 않게).
  const put=r=>{if(['name','teacher','studentKey','phoneLast4'].some(k=>hasMask(r?.[k])))throw new Error(MASKED.STORE);const payload=JSON.stringify(r),saved=insertSnapshot.run(r.id,payload),seq=Number(saved.lastInsertRowid);snapshots.set(r.id,{seq,record:JSON.parse(payload)});revision=seq;return saved;};
  const latest=()=>[...snapshots.values()].map(x=>x.record);
  const delta=cursor=>{
    const prefix=instance+':',raw=typeof cursor==='string'&&cursor.startsWith(prefix)?cursor.slice(prefix.length):'',since=/^\d+$/.test(raw)?Number(raw):-1;
    const merge=Number.isSafeInteger(since)&&since>=0&&since<=revision;
    return{recordsMode:merge?'merge':'replace',cursor:prefix+revision,records:[...snapshots.values()].filter(x=>!merge||x.seq>since).map(x=>x.record)};
  };
  const get=id=>{const r=db.prepare('SELECT payload FROM snapshots WHERE id=? ORDER BY seq DESC LIMIT 1').get(id);return r?JSON.parse(r.payload):null;};
  const saveJob=j=>{db.prepare('INSERT INTO jobs(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(j.id,JSON.stringify(j));jobs.set(j.id,j);};
  for(const row of db.prepare('SELECT payload FROM jobs').all()){const j=JSON.parse(row.payload);if(j.status==='running'){j.status=j.kind==='apply'?'unknown':'interrupted';j.message='프로그램이 중단되었습니다. 다시 수집해 결과를 확인해 주세요.';saveJob(j);}jobs.set(j.id,j);}
  // 2기는 seed.json(1기 저장본)을 불러오지 않습니다. 2기 시작 전 날짜 기록이 있으면 켜지 않습니다.
  const oldCount=latest().filter(r=>typeof r?.date==='string'&&r.date<COHORT.period.start).length;
  if(oldCount&&!allowOldData){db.close();throw new Error(OLD_DATA(oldCount));}
  // 체크히어 학생 번호 연결(이 PC SQLite만). 수집기는 가린 화면에서 이것과 저장된 원문 기록(2기 명단 포함)으로 학생을 찾습니다.
  const roster=createRosterStore(db),links=createLinkStore(db,{records:latest,roster});
  if(adapter&&typeof adapter==='object'&&!adapter.links)adapter.links=links;
  if(adapter&&typeof adapter==='object'&&!adapter.roster)adapter.roster=roster;
  // 가림 때문에 기다리는 쓰기(요청 번호 → {at: 마지막으로 막힌 시각, status: 'pending'|'approved'}). 중계는 읽기만 하므로(2026-10-16) 다시 반영은
  // 사람이 운영 포털 「반영 요청·승인」에서 합니다. 6분 지나도 다시 오지 않으면(철회·반려를 이 PC는 모름) 잊습니다. 가림이 아닌 결과가 나오면 바로 지웁니다. 해제 사유의 수는 여기서 셉니다.
  const waiting=new Map();let lastWriteCall=0,unmaskedAt=0,unmask=null,lastHeader=null,lastPeek=0;const learnQueue=new Map();
  const prune=()=>{const t=Date.now();for(const [id,w] of waiting)if(t-w.at>6*60000)waiting.delete(id);};
  const wait=(id,message,status)=>{if(waitsForUnmask(message))waiting.set(String(id),{at:Date.now(),status:status==='approved'?'approved':'pending'});else waiting.delete(String(id));};
  // 사람이 보고 누를 해제 사유(실제 할 일). 승인 전 요청은 '승인 대기'로 따로 셉니다.
  // 2기 처음 설치 모드면 아직 확인하지 않은 반 수도 사유에 넣습니다(사람이 반별 확인을 위해 해제).
  const reasonOf=unlinked=>{prune();const w=[...waiting.values()];return unmaskReason({writes:w.length,pending:w.filter(x=>x.status!=='approved').length,unlinked,setup:setupLeft()});};
  const maskingInfo=async()=>{
    const m=typeof adapter.maskingState==='function'?await adapter.maskingState().catch(()=>null):null,c=links.counts();prune();
    // 사람이 전용 크롬에서 직접 해제해도(도우미를 거치지 않아도) 원문 표시로 바뀌는 때 연결 안 된 반을 배울 줄에 넣습니다.
    if(m?.header==='unmasked'&&lastHeader!=='unmasked'){unmaskedAt=Date.now();if(!unmask)queueLearning(m);}if(m?.header)lastHeader=m.header;
    return {view:m?.view??null,header:m?.header??null,remaining:Number.isFinite(m?.remaining)?m.remaining:null,unlinked:Number(m?.unlinked)||0,
      classes:(m?.classes||[]).map(x=>({classId:String(x.classId),date:String(x.date),count:Number(x.count)||0})),
      conflicts:c.conflicts,pendingLinks:c.storedOnly,waitingWrites:waiting.size,unmasking:!!unmask,...(unmask?{reason:unmask.reason}:{}),learning:learnQueue.size,
      // 「마스킹 해제 시작」 옆에 미리 보이는 사유(누르면 이 글 그대로 체크히어에 넣음)
      reasonPreview:reasonOf(Number(m?.unlinked)||0)};
  };
  const endUnmask=(j,status,message)=>{if(unmask?.job===j){clearTimeout(unmask.timer);unmask=null;}Object.assign(j,{status,message,finishedAt:new Date().toISOString()});saveJob(j);if(busy===j.id)busy=null;};
  // 해제된 동안 할 일(검토 E): 기다리는 쓰기는 사람이 운영 포털에서 다시 반영하고(중계는 쓰지 않음), 그 사이가 비면 연결 안 된 학생이 있던 반을 원문으로 한 번씩 읽어 연결을 배웁니다.
  // 기다리는 쓰기가 있으면 해제 직후·쓰기 뒤 1분을 비워 둡니다(사람이 다시 반영하기 전에 배우기가 해제 시간을 먼저 쓰지 않게).
  // 해제 시간이 1분보다 적게 남았거나 다시 가려지면 시작하지 않습니다. 해제(연장·종료)는 사람이 정합니다.
  const queueLearning=m=>{for(const c of m?.classes||[])if(c.count>0)learnQueue.set(String(c.classId),String(c.date));};
  async function learnTick(){
    if(busy||connecting||unmask)return;
    // 쉬는 동안 15초마다 머리말(가림 상태·남은 해제 시간)만 봅니다(화면 글 읽기만, 이동·클릭 없음). 직접 해제한 것도 여기서 알아챕니다.
    if(!learnQueue.size){if(Date.now()-lastPeek<privacyPollMs||!adapter.page||adapter.page.isClosed?.())return;lastPeek=Date.now();await maskingInfo();if(!learnQueue.size||busy||connecting||unmask)return;}
    // 쓰기 시도(바빠서 돌려보낸 것 포함) 뒤 1분은 늘 비워 둡니다: 운영포털이 가린 동안 보내지 않아 기다리는 쓰기가 없어도, 해제 뒤 승인·반영을 누른 사람이 배우기에 밀리지 않게.
    prune();if(Date.now()-(waiting.size?Math.max(lastWriteCall,unmaskedAt):lastWriteCall)<writeGapMs)return;
    const m=typeof adapter.maskingState==='function'?await adapter.maskingState().catch(()=>null):null;
    if(m?.header!=='unmasked'){learnQueue.clear();return;}
    // 남은 시간을 읽지 못하면(타이머 모양이 다름) 배우기도 시작하지 않습니다(안전한 쪽).
    if(!Number.isFinite(m.remaining)||m.remaining<60||busy||connecting||unmask)return;
    const [classId,date]=learnQueue.entries().next().value;learnQueue.delete(classId);
    const claim='start:'+randomUUID();busy=claim;try{await adapter.requireLogin();}catch{if(busy===claim)busy=null;return;}
    startSync(classId,[date],true,{learn:true});
  }
  const learnTimer=setInterval(()=>{void learnTick().catch(()=>{});},learnTickMs);learnTimer.unref?.();
  // Remembered CheckHere addresses survive restarts, so a repeated period
  // collection skips the paged lecture search. The collector re-looks-up any
  // address that no longer opens the right class/day.
  db.exec('CREATE TABLE IF NOT EXISTS places(key TEXT PRIMARY KEY, url TEXT NOT NULL, savedAt TEXT NOT NULL);');
  const placeOk=u=>{try{const x=new URL(u);return x.origin==='https://check.ihereapp.com'&&x.pathname.startsWith('/history/lecture/');}catch{return false;}};
  const remembers=adapter.urls instanceof Map&&adapter.lectureUrls instanceof Map;
  if(remembers)for(const row of db.prepare('SELECT key,url FROM places').all()){if(!placeOk(row.url))continue;const [a,b]=row.key.split('|');if(a==='lecture'&&classOk(b))adapter.lectureUrls.set(b,row.url);else if(classOk(a)&&validIso(b))adapter.urls.set(row.key,row.url);}
  // 사람이 /setup에서 고른 반 → 체크히어 강의(이름 규칙으로 못 찾을 때). 기억한 강의 주소보다 먼저입니다.
  db.exec('CREATE TABLE IF NOT EXISTS lecture_links(classId TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, lectureId TEXT, linkedAt TEXT NOT NULL);');
  const lectureLinksOk=adapter&&adapter.lectureLinks instanceof Map;
  if(lectureLinksOk)for(const row of db.prepare('SELECT classId,label,url,lectureId FROM lecture_links').all())if(classOk(row.classId)&&placeOk(row.url)){adapter.lectureLinks.set(row.classId,{label:row.label,url:row.url,lectureId:row.lectureId||null});if(remembers)adapter.lectureUrls.set(row.classId,row.url);}
  const saveLectureLink=(classId,l)=>db.prepare('INSERT INTO lecture_links(classId,label,url,lectureId,linkedAt) VALUES(?,?,?,?,?) ON CONFLICT(classId) DO UPDATE SET label=excluded.label,url=excluded.url,lectureId=excluded.lectureId,linkedAt=excluded.linkedAt').run(classId,l.label,l.url,l.lectureId||null,new Date().toISOString());
  // ---- 2기 처음 설치 모드(setup.mjs): 이 data에 강의 연결·학생 연결·확인 목록이 하나도 없으면 켭니다. 사람이 /setup에서 끄거나 16개 반이 모두 등록되면 꺼집니다 ----
  const setup=createSetupStore(db);
  if(setup.mode()===null)setup.setMode(!links.counts().links&&!db.prepare('SELECT 1 FROM lecture_links LIMIT 1').get()&&!db.prepare("SELECT 1 FROM places WHERE key LIKE 'lecture|%' LIMIT 1").get()&&!setup.confirmedAll().length);
  const allRegistered=()=>CLASS_IDS.every(c=>!!setup.confirmed(c)?.registeredAt);
  const setupOn=()=>setup.mode()===true&&!allRegistered();
  // 아직 확인하지 않은 반 수(해제 사유에 씀, 설치 모드일 때만)
  const setupLeft=()=>setupOn()?CLASS_IDS.filter(c=>!setup.confirmed(c)).length:0;
  const lectureOf=c=>{const link=adapter.lectureLinks?.get?.(c)||null,preset=presetLecture(c);return link?{mode:link.source==='config'?'config':'manual',label:link.label,checked:!!link.lectureId}:adapter.lectureUrls?.has?.(c)?{mode:'rule'}:preset?{mode:'config',label:preset}:null;};
  // 반마다 확인 요약(수만, 이름 없음): 운영포털 실시간 화면의 등록 표와 이 PC 화면이 함께 씁니다.
  const setupSummary=()=>{
    const counts=roster.counts(),registry=new Map(setup.registry().map(r=>[r.classId,r]));
    return CLASSES.map(c=>{
      const rep=setup.report(c.id),conf=setup.confirmed(c.id),reg=registry.get(c.id);
      return {classId:c.id,lecture:lectureOf(c.id)?.mode||null,roster:{count:counts[c.id]?.count||0,source:counts[c.id]?.source||null},
        check:rep?{date:rep.date,at:rep.at,...reportCounts(rep,roster.entries(c.id))}:null,
        confirmed:conf?{count:conf.students.length,date:conf.date,confirmedAt:conf.confirmedAt,stale:!!rep&&rep.at>conf.confirmedAt,registeredAt:conf.registeredAt,registeredCount:conf.registeredCount,registeredBy:conf.registeredBy}:null,
        registry:reg?{count:reg.count,updatedAt:reg.updatedAt,checkedAt:reg.checkedAt}:null};
    });
  };
  // /setup 화면 상태(이 PC만): 위 요약 + 반 이름·정원·연결 수·확인 결과 보기(이름·끝 4자리·생년월일, 학생 번호 없음)·가린 화면 맞춤 결과. 이름은 이 PC 화면에만 갑니다.
  const setupState=async()=>{
    const m=await maskingInfo(),summary=new Map(setupSummary().map(s=>[s.classId,s])),linkedAt=new Map(db.prepare('SELECT classId,linkedAt FROM lecture_links').all().map(r=>[r.classId,r.linkedAt]));
    const connected=typeof adapter.loggedIn==='function'?await adapter.loggedIn().catch(()=>false):false;
    return {mode:{on:setupOn(),saved:setup.mode(),allRegistered:allRegistered()},connected,busy:!!busy,
      cohort:{label:COHORT.label,period:{start:COHORT.period.start,end:COHORT.period.end},holidays:HOLIDAYS,trainingDays:trainingDays().length,port,build:BUILD,lectureNameRule:LECTURE_NAME_RULE,firebaseReady:firebaseReady()},
      privacy:privacyState(m),masking:{header:m.header,remaining:m.remaining,reasonPreview:m.reasonPreview,unmasking:m.unmasking},
      jobs:[...jobs.values()].filter(j=>j.kind==='setup-check').slice(-3).reverse(),
      classes:CLASSES.map(c=>{
        const s=summary.get(c.id),lecture=lectureOf(c.id),rep=setup.report(c.id),masked=adapter.rosterReport?.get?.(c.id)||null,cl=links.classLinks(c.id);
        return {...s,name:c.name,capacity:c.capacity,tag:lectureTag(c.id),lecture:lecture?{...lecture,linkedAt:linkedAt.get(c.id)||null}:null,
          links:{total:cl.length,plain:cl.filter(l=>l.source==='plain-read').length,roster:cl.filter(l=>String(l.source).startsWith('roster')).length},
          view:rep?reportView(rep,roster.entries(c.id)):null,
          report:masked?{date:masked.date,view:masked.view,at:masked.at,linked:masked.linked,total:masked.total,rows:masked.rows,missing:masked.missing}:null};
      })};
  };
  // 반별 확인 전: 사람이 해제한 원문 화면이고 남은 해제 시간이 넉넉해야 합니다(읽기만 하므로 60초). 해제·연장은 사람이 합니다.
  async function setupGate(minSeconds=60){
    await adapter.readHeader?.();const h=adapter.headerNow?.()||{state:'none',remaining:null};
    if(h.state==='unmasked')return Number.isFinite(h.remaining)&&h.remaining>=minSeconds?null:SETUP_TEXT.TIME;
    // 가림 기능이 없는 옛 가짜 화면(시험 legacyNoMasking)만 머리말 없이 읽습니다.
    return h.state==='none'&&adapter.legacyNoMasking&&!adapter.maskingSeen?null:SETUP_TEXT.UNMASK;
  }
  // 반별 확인 작업(busy는 부르는 쪽이 잡아 둠): 반마다 그날을 빠른 수집(화면 데이터)으로 원문에서 한 번 읽고(학생 연결도 배움), 명단과 맞춘 결과를 이 PC에 둡니다.
  // 작업 글에는 반·수만 넣습니다(이름 없음). 해제가 끝나거나 모자라면 그 반에서 멈춥니다(paused, 사람이 연장·다시 해제한 뒤 이어서).
  function startSetupCheck(classIds,date){
    adapter.cancelled=false;const j={id:randomUUID(),kind:'setup-check',classIds,date,status:'running',startedAt:new Date().toISOString(),total:classIds.length,done:0,results:[],message:'해제된 체크히어 화면에서 반마다 교육생 명단을 읽고 있습니다.'};saveJob(j);busy=j.id;
    const sum=k=>j.results.reduce((n,r)=>n+(Number(r[k])||0),0),tally=()=>`${j.done}/${j.total}개 반 확인 · 맞음 ${sum('matched')} · 명단에 없음 ${sum('unmatched')} · 명단에만 ${sum('missing')} · 겹침 ${sum('ambiguous')}`;
    void(async()=>{try{
      for(const classId of classIds){
        if(adapter.cancelled)break;
        const gate=await setupGate();if(gate){j.status='paused';j.stoppedAt=classId;j.message=`${tally()} · ${classId}반에서 멈춤 — ${gate}`;return;}
        j.current=classId;saveJob(j);let view=null;
        try{
          await adapter.collect(classId,[date],async r=>{const old=get(r.id);if(old?.reference)r.reference=old.reference;if(old?.exception)r.exception=old.exception;put(r);},async()=>{},{pageData:true,sameAsStored:r=>sameStored(r),onView:v=>{view=v?.view||null;}});
          const day=adapter.dayRows;
          if(view!=='plain'||!day||day.view!=='plain'||String(day.classId)!==classId||day.date!==date)throw Error(SETUP_TEXT.MASKED);
          const old=setup.report(classId),rep=setup.saveReport(buildReport({classId,date,rows:day.rows,pairs:old?.pairs,exclude:old?.exclude}));
          j.results.push({classId,status:'checked',...reportCounts(rep,roster.entries(classId))});
        }catch(e){
          j.results.push({classId,status:NO_LECTURE.test(e.message)?'no-lecture':'failed',message:cleanMessage(e.message)});
          // 로그인 만료·가림·해제 창 사용 중은 모든 반에 걸리므로 멈춥니다(사람이 풀고 이어서).
          if(/LOGIN_REQUIRED|MASKED_|SETUP_/.test(e.message)){j.done++;j.status='paused';j.stoppedAt=classId;j.message=`${tally()} · ${classId}반에서 멈춤 — ${cleanMessage(e.message)}`;return;}
        }
        j.done++;saveJob(j);
      }
      const bad=j.results.filter(r=>r.status!=='checked').length;
      j.status=adapter.cancelled?'cancelled':bad?'partial':'complete';j.message=`${tally()}${bad?` · 확인 못 함 ${bad}개 반`:''}`;
    }catch(e){j.status='failed';j.message=cleanMessage(e.message);}finally{delete j.current;j.finishedAt=new Date().toISOString();saveJob(j);rememberPlaces();if(busy===j.id)busy=null;}})();
    return j;
  }
  const rememberPlaces=()=>{
    if(!remembers)return;const now=new Date().toISOString(),current=new Map([...adapter.urls,...[...adapter.lectureUrls].map(([k,v])=>['lecture|'+k,v])].filter(([,v])=>placeOk(v)));
    const upsert=db.prepare('INSERT INTO places(key,url,savedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET url=excluded.url,savedAt=excluded.savedAt WHERE places.url<>excluded.url'),drop=db.prepare('DELETE FROM places WHERE key=?');
    for(const [k,v] of current)upsert.run(k,v,now);for(const row of db.prepare('SELECT key FROM places').all())if(!current.has(row.key))drop.run(row.key);
  };
  // Same student, same complete content as the last stored read (memos included).
  // 시간 삭제 표시(기록 번호)가 다르거나 옛 build의 저장본이라 없으면 한 번 다시 저장합니다(버전은 그대로).
  // 학생 번호(attendeeId)는 버전 밖입니다: 옛 저장본에 없으면 같은 것으로 봅니다(다시 저장하지 않음, 옮겨 쓰기 없음). 둘 다 있고 다르면 다시 저장합니다.
  const sameStored=r=>{const old=snapshots.get(r.id)?.record;return !!old&&old.source==='live'&&old.readState==='complete'&&old.version===r.version&&old.tableSignature===r.tableSignature&&old.studentKey===r.studentKey&&DELETE_MARKS.every(k=>old[k]===r[k])&&(!old.attendeeId||!r.attendeeId||old.attendeeId===r.attendeeId);};
  const journal=(job,event)=>db.prepare('INSERT INTO journal(job,payload) VALUES(?,?)').run(job,JSON.stringify({at:new Date().toISOString(),...event}));
  // 한 반·여러 날 수집 작업(busy는 부르는 쪽이 잡아 둠). learn: 해제된 동안 연결을 배우려는 원문 읽기.
  function startSync(classId,dates,incremental,extra={}){
    adapter.cancelled=false;const j={id:randomUUID(),kind:'sync',classId,dates,status:'running',startedAt:new Date().toISOString(),count:0,errors:0,...(incremental?{mode:'incremental',skipped:0}:{}),...extra,message:extra.learn?'체크히어 학생 연결을 확인하려고 원문 화면을 읽고 있습니다.':'출결 상세를 읽고 있습니다.'};saveJob(j);busy=j.id;
    // Incremental: students whose visible row equals their last complete read
    // keep that record; no editor is opened and no snapshot row is added.
    const unchanged=incremental?row=>{const same=sameTableRow(snapshots.get(row.id)?.record,row);if(same)j.skipped++;return same;}:null;
    void(async()=>{try{
      await adapter.collect(classId,dates,async r=>{const old=get(r.id);if(old?.reference)r.reference=old.reference;if(old?.exception)r.exception=old.exception;put(r);j.count++;if(r.readState!=='complete')j.errors++;saveJob(j);},async progress=>{j.progress=progress;saveJob(j);},{unchanged,onView:v=>{countView(j,v);if(v?.unread)j.errors+=v.unread;},...(incremental?{pageData:true,sameAsStored:r=>{const same=sameStored(r);if(same)j.skipped++;return same;},onDay:d=>{j.method=d.method;if(d.note)j.methodNote=d.note;}}:{})});
      j.status=adapter.cancelled?'cancelled':j.errors?'partial':'complete';j.message=`${j.count}건 수집${incremental?` · 변경 없음 ${j.skipped}건`:''} · 상세 확인 실패 ${j.errors}건${maskNote(j)}`;
    }catch(e){j.status=j.count?'partial':'failed';j.message=e.message;}finally{j.finishedAt=new Date().toISOString();saveJob(j);rememberPlaces();if(busy===j.id)busy=null;}})();
    return j;
  }
  // 정밀 수집(수정창으로 읽기, 비상용)은 가린 화면에서 수정창이 열리지 않으므로 시작 전에 거절합니다(머리말만 봄, 이동·클릭 없음).
  async function refusePreciseWhileMasked(){const m=typeof adapter.maskingState==='function'?await adapter.maskingState().catch(()=>null):null;if(m?.header==='masked'||m?.view==='masked')throw Error(MASKED.PRECISE);}
  // ---- 순차 수정(event-request-v1) ----
  // 켜기 단계는 없습니다(2026-10-16 사용자 결정 「마스킹 해제를 요구하도록만」): 사람이 그 탭을 해제했고 남은 시간이 넉넉하며 탭 안 장치가 해제 헤더를 보았을 때만 보냅니다.
  // 첫 실행: build마다 1건. 쓰기 단계까지 간 첫 건(작업 기록에 before_write — 보냈을 수 있음)은 결과와 상관없이 그 차례를 씁니다. 그 뒤 사람이 「확인했음」(127.0.0.1:8766/writer)을
  // 누를 때까지 나머지는 수정창으로 반영합니다(막지 않음). 첫 건이 확인(verified)·플랫폼 저장까지 끝났으면 「확인했음」이 순차 수정을 켜고,
  // 끝까지 확인되지 않았으면(실패·덜 지워짐·충돌·미확인) 사람이 체크히어 원본을 본 뒤 「확인했음」을 눌러야 1건을 다시 해 봅니다(writer_rearms, 같은 잘못이 건마다 되풀이되지 않게).
  // 같은 건이 순차 요청으로 실패했을 때 수정창으로 저절로 다시 쓰지 않습니다(작업이 남아 다시 보내지 않음).
  db.exec('CREATE TABLE IF NOT EXISTS writer_unlocks(build TEXT PRIMARY KEY, jobId TEXT NOT NULL, at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS writer_rearms(jobId TEXT PRIMARY KEY, build TEXT NOT NULL, at TEXT NOT NULL);');
  const wrote=db.prepare(`SELECT 1 FROM journal WHERE job=? AND payload LIKE '%"phase":"before_write"%' LIMIT 1`),rearmed=db.prepare('SELECT 1 FROM writer_rearms WHERE jobId=?');
  let recorder=null;
  // 쓸 형식: 내장 형식(2026-10-16 기록) 위에 이 PC에서 새로 기록한 형식(있으면)을 덮습니다.
  const formatNow=()=>formatWith(loadFormat(dataDir));
  const firstRun=()=>{
    const unlocked=!!db.prepare('SELECT 1 FROM writer_unlocks WHERE build=?').get(BUILD),mine=[...jobs.values()].filter(j=>j.kind==='apply'&&j.writer==='request'&&j.build===BUILD);
    // 차례를 쓴 건: 끝났고(running 아님) 쓰기 단계까지 갔으며 사람이 다시 해 보기로 확인하지 않은 것. 판단은 가장 최근 건으로 합니다.
    const running=mine.some(j=>j.status==='running'),tried=mine.filter(j=>j.status!=='running'&&!rearmed.get(j.id)&&wrote.get(j.id)).sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt))),last=tried.at(-1);
    const done=last?.status==='verified'&&last.platformSaved===true?last:null,failed=last&&last.status!=='verified'?last:null;
    return {unlocked,waiting:!unlocked&&!!done,failed:!unlocked&&failed?failed.status:null,running,turn:unlocked||(!tried.length&&!running),doneJob:done?.id||null,failedJob:failed?.id||null};
  };
  // /api/state·/api/status용(이름·번호 없음): 쓸 형식 종류(내장+기록), 기록한 종류, 첫 실행 상태, 형식 기록 중인지. armed는 옛 화면을 위해 늘 true(켜기 없음).
  const writerInfo=()=>{const r=firstRun(),recorded=loadFormat(dataDir);return {armed:true,armedUntil:null,builtin:true,formats:Object.keys(formatNow().kinds),recorded:Object.keys(recorded?.kinds||{}),firstRun:{unlocked:r.unlocked,waitingConfirm:r.waiting,failedFirst:r.failed},recording:!!recorder};};
  // 쓰기 방식: 없음 → 'auto'(순차 요청이 준비됐고 첫 실행 차례면 순차, 아니면 수정창), 'editor' 수정창, 'request' 순차(준비 안 되면 거절).
  const writerOf=input=>{if(input.writer===undefined||input.writer===null)return 'auto';if(['editor','request'].includes(input.writer))return input.writer;throw Error('쓰기 방식(writer)을 확인해 주세요.');};
  // writer:'request'를 지정했을 때 읽기·잡기 전: 머리말 '원문 표시 중'과 남은 150초(모자라면 연장은 사람이 정함). 자동은 잡기 전 확인(writeBlocked)만.
  async function requestGate(){
    await adapter.readHeader?.();const h=adapter.headerNow?.()||{state:'none',remaining:null},p=privacyState({header:h.state,remaining:h.remaining});
    if(p.state!=='unmasked')throw Error(MASKED.WRITE);if(!p.writable)throw Error(MASKED.TIME);
  }
  // 승인 하나를 다시 읽고(쓰기 전 확인) 잡습니다(claim). 잡기 전 오류는 던집니다(요청 상태 그대로, 가림이면 해제 대기로 셈).
  // confirmOnly: 이미 같은 값인 승인 대기 요청을 승인·완료로만 바꿉니다(쓰지 않음). 결과 {reply}이면 더 할 일이 없습니다.
  // writer: 'auto'|'editor'|'request'. requestTurn: 첫 실행 규칙상 이 건이 순차 요청을 쓸 차례인지(아니면 수정창, 막지 않음).
  async function claimApproval(approvalId,idToken,{confirmOnly=false,writer='editor',requestTurn=true}={}){
    let record,request,confirmed,identities,reqStatus='approved';
    try{
      let approved=await approvalCloud.get(approvalId,idToken);reqStatus=approved.data?.status;
      // 시간 삭제를 지원하지 않는 연결 프로그램은 읽기·승인(approveExisting)·잡기(claim) 전에 거절합니다. 요청 상태는 그대로 둡니다.
      if(deletionRequest(approved.data)&&!capabilities.includes(TIME_DELETE_CAPABILITY))throw Error('이 연결 프로그램은 체크히어 시간 삭제를 지원하지 않습니다. 수집 PC에서 최신 「체크히어 시작.cmd」를 다시 실행해 주세요.');
      await adapter.requireLogin();
      if(confirmOnly){
        if(approved.data.status!=='pending')return {reply:{status:approved.data.status,...approved.data.result}};
        record=await readRequestRecord(adapter,approved.data,latest(),approved.identities,put);confirmed=record;
        if(!confirmAlreadyApplied(approved.data,record,confirmed,approved.identities)){if(confirmed?.id===record.id)put(confirmed);return {reply:{status:'pending',message:'현재 원본은 요청값과 다릅니다. 승인 대기를 유지합니다.'}};}
        put(confirmed);record=confirmed;approved=await approvalCloud.approveExisting(approved,idToken,outward(confirmed));
      }
      request=approved.data;identities=approved.identities;let proposal=proposalFromApproval(request);
      record=record||await readRequestRecord(adapter,request,latest(),identities,put);
      if(record.id!==proposal.id)throw Error('승인된 학생과 수집된 학생의 식별정보가 다릅니다.');
      const live=prepareApproval(request,record,{allowAlreadyApplied:true,identities});
      proposal={id:record.id,version:record.version,...live.after,reason:live.reason};
      // 잡기(claim) 전 가림 확인(K4): 가린·섞인 화면, 머리말을 읽지 못한 가림 기능 화면, 남은 해제 시간 150초(PRIVACY_MIN_WRITE_SECONDS) 미만이면
      // 요청은 승인 상태 그대로 두고 해제를 기다립니다(MASKED_*, 아무것도 누르지 않음). 잡은 뒤 다시 읽는 동안 시간이 줄므로 넉넉히 봅니다(쓰기 직전은 90초).
      if(!confirmed){const blocked=adapter.writeBlocked?.(record,{minSeconds:Math.max(MIN_CLAIM_SECONDS,PRIVACY_MIN_WRITE_SECONDS)});if(blocked)throw Error(blocked);}
      // 쓰기 방식(그날 화면이 열린 뒤): 순차 요청은 머리말 '원문 표시 중'이고 탭 안 장치가 사람이 해제한 헤더를 보았을 때만(못 봤으면 시간 기준 라디오로 한 번 다시 읽게 함).
      let used='editor',note=null;
      if(!confirmed&&writer!=='editor'){
        const unmasked=adapter.headerNow?.().state==='unmasked',able=typeof adapter.requestWrite==='function'&&typeof adapter.requestReady==='function';
        if(writer==='request'&&!unmasked)throw Error(MASKED.WRITE);
        if(requestTurn&&able&&unmasked&&await adapter.requestReady().catch(()=>false))used='request';
        else if(writer==='request'&&requestTurn)throw Error(HEADERS_MISSING);
        else if(able&&unmasked&&!requestTurn)note=FIRST_RUN_NOTE;
      }
      const attemptId=randomUUID();await approvalCloud.claim(approved,idToken,attemptId);waiting.delete(approvalId);
      const j={id:approvalId,approvalId,attemptId,approvedBy:approved.data.approvedBy,kind:'apply',recordId:record.id,...(used==='request'?{writer:'request',build:BUILD}:{}),...(note?{writerNote:note}:{}),status:'running',startedAt:new Date().toISOString(),message:'승인된 변경 전 값을 다시 확인하고 있습니다.'};saveJob(j);
      return {j,record,proposal,request,identities,confirmed,idToken,writer:used};
    }catch(e){wait(approvalId,e.message,reqStatus);throw e;}
  }
  // 잡은 승인 하나를 반영합니다: 입력(수정창 또는 순차 요청) → 다시 읽어 확인 → 플랫폼 저장. 결과는 작업(j)에 남기고 j를 돌려줍니다.
  async function runApproval({j,record,proposal,request,identities,confirmed,idToken,writer}){
    try{
      const result=confirmed?{status:'verified',alreadyApplied:true,message:'이미 반영 · 원본 확인 완료',results:[],current:confirmed}:await applyVerified(adapter,record,proposal,async e=>journal(j.id,e),request,identities,writer==='request'?{writer:{kind:'request',format:formatNow()}}:{});
      Object.assign(j,result);if(result.current&&!confirmed)put(result.current);
    }catch(e){j.status='failed';j.message=e.message;}finally{
      j.finishedAt=new Date().toISOString();saveJob(j);
      try{const result=await approvalCloud.finish(j.approvalId,idToken,j.attemptId,outward(j));j.cloudSaved=true;j.platformSaved=result?.platformSaved===true;if(result?.message)j.message=withDeleted(result.message,j);delete j.cloudError;}catch(e){j.cloudSaved=false;j.platformSaved=false;j.cloudError='체크히어 원본 확인 후 플랫폼 DB 저장을 완료하지 못했습니다. 결과 확인을 누르면 재입력 없이 저장을 다시 확인합니다. '+e.message;}
      saveJob(j);
    }
    return j;
  }
  // 미리보기: 승인(또는 승인 대기) 요청마다 다시 읽어(읽기만) 바꿀 칸·값을 돌려줍니다. 잡지도 보내지도 않습니다. 이름·번호 값 없음.
  async function previewItems(ids,idToken){
    const format=formatNow(),out=[];
    for(const approvalId of ids){
      try{
        const doc=await approvalCloud.get(approvalId,idToken);
        if(!['pending','approved'].includes(doc.data.status))throw Error('이미 처리된 요청입니다.');
        const current=await readRequestRecord(adapter,doc.data,latest(),doc.identities,put);
        out.push({approvalId,classId:String(current.classId),date:current.date,status:doc.data.status,changes:planRequest(adapter,doc.data,current,doc.identities,format),blocked:adapter.writeBlocked?.(current,{minSeconds:MIN_CLAIM_SECONDS})||null});
      }catch(e){out.push({approvalId,error:cleanMessage(e.message)});}
    }
    return out;
  }
  const authorized=req=>{const raw=req.headers['x-hint-key'];return typeof raw==='string'&&raw.length===key.length&&timingSafeEqual(Buffer.from(raw),Buffer.from(key));};
  const localOrigin=o=>!o||o===`http://127.0.0.1:${port}`||o===`http://localhost:${port}`;
  // 응답에는 이 PC에만 두는 값(체크히어 학생 번호)을 넣지 않습니다(포털·중계·Firestore로 가지 않게).
  const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body,(k,x)=>PC_ONLY.includes(k)?undefined:x));};
  async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)throw new Error('요청이 너무 큽니다.');}return raw?JSON.parse(raw):{};}
  // 2기 처음 설치 화면(/setup)과 기수 설정(루트 cohort.mjs: 원본 cohort.json의 사본을 품고 있어 이 PC 화면은 JSON을 따로 받지 않음).
  const publicFiles={'/setup':'checkhere/setup.html','/checkhere/setup-ui.mjs':'checkhere/setup-ui.mjs','/checkhere/cohort-bridge.mjs':'checkhere/cohort-bridge.mjs','/cohort.mjs':'cohort.mjs','/checkhere-name-core.mjs':'checkhere-name-core.mjs','/survey-identity.mjs':'survey-identity.mjs','/attendance-beta-core.mjs':'attendance-beta-core.mjs','/checkhere/bulk-collect.mjs':'checkhere/bulk-collect.mjs','/':'checkhere.html','/checkhere.html':'checkhere.html','/checkhere-ui.mjs':'checkhere-ui.mjs','/checkhere/ui.css':'checkhere/ui.css','/checkhere/rules.mjs':'checkhere/rules.mjs','/writer':'checkhere/writer.html','/checkhere/writer-ui.mjs':'checkhere/writer-ui.mjs'};
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
        // 가벼운 상태(K2, 이름·기록 없음): build·능력·바쁨·체크히어 가림 상태 한 줄(privacy). 포털·이 PC 화면이 15초마다 봅니다(머리말 글만 읽음).
        if(req.method==='GET'&&url.pathname==='/api/status'){
          const masking=await maskingInfo(),connected=typeof adapter.loggedIn==='function'?await adapter.loggedIn().catch(()=>false):false;
          return send(res,200,{build:BUILD,capabilities,busy,connected,privacy:privacyState(masking),waitingWrites:masking.waitingWrites,requestWriter:writerInfo()});
        }
        if(req.method==='GET'&&url.pathname==='/api/state'){
          const connected=await adapter.loggedIn(),masking=await maskingInfo();
          // Take records, cursor and job progress together, after the await. masking: 화면 가림 상태·남은 해제 시간·수만(이름 없음). privacy: 그 한 줄(rules.mjs privacyState).
          return send(res,200,{rules:RULES,capabilities,build:BUILD,busy,jobs:[...jobs.values()].slice(-20).reverse(),connected,masking,privacy:privacyState(masking),requestWriter:writerInfo(),...(url.searchParams.get('delta')==='1'?delta(url.searchParams.get('cursor')):{records:latest().map(r=>({...r,audit:judge(r)}))})});
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
          if(!classOk(classId)||!Array.isArray(dates)||!dates.length||dates.length>31||new Set(dates).size!==dates.length||dates.some(d=>!validIso(d)||!collectable(d)))throw new Error(`${DATE_HINT} 한 번에 최대 31일입니다.`);
          const incremental=input.mode==='incremental';
          // 로그인 확인(await) 전에 임시 값으로 잠가야 그 틈에 다른 작업이 들어오지 않습니다.
          const claim='start:'+randomUUID();busy=claim;try{await adapter.requireLogin();if(!incremental)await refusePreciseWhileMasked();}catch(e){if(busy===claim)busy=null;throw e;}
          return send(res,202,startSync(classId,dates,incremental));
        }
        // Several classes × a period in one job: no per-day request/poll gaps, one
        // schedule scan per class, a second attempt for failed or partly read days.
        if(url.pathname==='/api/sync-batch'){
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          const classIds=Array.isArray(input.classIds)?[...new Set(input.classIds.map(String))].sort((a,b)=>a-b):[],dates=Array.isArray(input.dates)?[...new Set(input.dates)].sort():[];
          if(!classIds.length||classIds.length>CLASS_IDS.length||classIds.some(c=>!classOk(c))||!dates.length||dates.length>130||!dates.every(d=>validIso(d)&&collectable(d)))throw new Error(`${DATE_HINT} 한 번에 최대 130일입니다.`);
          const mode=input.mode==='full'?'full':'incremental';
          const claim='start:'+randomUUID();busy=claim;try{await adapter.requireLogin();if(mode==='full')await refusePreciseWhileMasked();}catch(e){if(busy===claim)busy=null;throw e;}
          adapter.cancelled=false;
          const j={id:randomUUID(),kind:'batch',classIds,dates,mode,status:'running',startedAt:new Date().toISOString(),total:classIds.length*dates.length,done:0,count:0,skipped:0,errors:0,results:[],message:'선택한 반·기간을 차례로 읽고 있습니다.'};saveJob(j);busy=j.id;
          let savedAt=0;const persist=force=>{const t=Date.now();if(force||t-savedAt>2000){savedAt=t;saveJob(j);}};
          const finish=result=>{result.finishedAt=new Date().toISOString();const i=j.results.findIndex(r=>r.classId===result.classId&&r.date===result.date);if(i>=0)j.results[i]=result;else j.results.push(result);j.done=j.results.length;persist(true);rememberPlaces();return result;};
          const runDay=async(classId,date,attempt)=>{
            const result={classId,date,status:'running',count:0,skipped:0,errors:0,attempt,startedAt:new Date().toISOString()};j.current={classId,date};
            const unchanged=mode==='incremental'?row=>{const same=sameTableRow(snapshots.get(row.id)?.record,row);if(same){result.skipped++;j.skipped++;}return same;}:null;
            try{
              await adapter.collect(classId,[date],async r=>{const old=get(r.id);if(old?.reference)r.reference=old.reference;if(old?.exception)r.exception=old.exception;put(r);result.count++;j.count++;if(r.readState!=='complete'){result.errors++;j.errors++;}persist();},async progress=>{j.progress={...progress,classId};persist();},{unchanged,onView:v=>{countView(result,v);countView(j,v);if(v?.unread){result.errors+=v.unread;j.errors+=v.unread;}},...(mode==='incremental'?{pageData:true,sameAsStored:r=>{const same=sameStored(r);if(same){result.skipped++;j.skipped++;}return same;},onDay:d=>{result.method=d.method;if(d.method==='page-data')j.pageDays=(j.pageDays||0)+1;if(d.note)result.note=d.note;}}:{})});
              result.status=adapter.cancelled?'cancelled':result.errors?'partial':'complete';
            }catch(e){
              result.status=NO_LECTURE.test(e.message)?'no-lecture':'failed';result.message=e.message;
              // 섞인 화면(해제 시간이 끝나는 중 등)·가린 화면의 정밀 수집은 모든 반에 걸리므로 로그인 만료처럼 묶음 전체를 멈춥니다.
              if(/LOGIN_REQUIRED|MASKED_MIXED|MASKED_PRECISE/.test(e.message)){finish(result);throw e;}
            }
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
            // 가림 때문에 못 읽은 날은 두 번째로 읽어도 같으므로 다시 읽지 않습니다(해제 뒤 다시).
            for(const r of j.results.filter(r=>['failed','partial'].includes(r.status)&&!/강의를 찾지 못했습니다|MASKED_/.test(r.message||'')&&!r.masked)){if(adapter.cancelled)break;await runDay(r.classId,r.date,2);}
            const bad=j.results.filter(r=>['failed','partial'].includes(r.status)).length,none=j.results.filter(r=>r.status==='no-lecture').length;
            j.status=adapter.cancelled?'cancelled':bad?'partial':'complete';
            j.message=`${j.done}/${j.total} 반·날짜 · 저장 ${j.count}명${mode==='incremental'?` · 변경 없음 ${j.skipped}명 · 화면 데이터로 읽은 날 ${j.pageDays||0}`:''} · 강의 없음 ${none} · 확인 필요 ${bad}${maskNote(j)}`;
          }catch(e){j.status=j.count?'partial':'failed';j.message=e.message;}finally{delete j.current;j.finishedAt=new Date().toISOString();saveJob(j);rememberPlaces();if(busy===j.id)busy=null;}})();
          return send(res,202,j);
        }
        // Read-only diagnosis inside the bridge: reuses its logged-in dedicated Chrome,
        // so it never fights over the Chrome profile. Writes only data/probe/*.json.
        if(url.pathname==='/api/probe'){
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          const classId=String(input.classId||'1'),date=String(input.date||''),knownUrl=typeof input.url==='string'&&input.url.startsWith('https://check.ihereapp.com/history/lecture/modify?')?input.url:null;
          if(!classOk(classId)||!validIso(date))throw new Error('반과 날짜를 확인해 주세요.');
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
        // 읽기 전용 가림 진단: 같은 전용 크롬으로 두 날의 출결상세 화면을 열고, 화면이 스스로 받은 출결상세 응답만 셉니다.
        // 체크히어에 따로 요청을 보내지 않습니다(토큰·직접 주소 없음). data/probe/api-probe-*.json만 씁니다.
        // 날짜를 비우면 오늘과 직전 교육일. 보고서·요약에는 이름·전화번호·메모·시간·id 값·토큰이 없습니다.
        if(url.pathname==='/api/api-probe'){
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          const classId=String(input.classId||'1'),date1=String(input.date1||'').trim(),date2=String(input.date2||'').trim(),knownUrl=typeof input.url==='string'&&input.url.trim()?input.url.trim():null;
          if(!classOk(classId)||date1&&!validDate(date1)||date2&&!validDate(date2)||date1&&date1===date2||knownUrl&&!dayIds(knownUrl))throw new Error('반, 두 날짜(서로 다른 날) 또는 출결상세 주소를 확인해 주세요.');
          const j={id:randomUUID(),kind:'api-probe',classId,dates:[date1||'auto',date2||'auto'],status:'running',startedAt:new Date().toISOString(),message:'API 진단을 준비하고 있습니다.'};saveJob(j);busy=j.id;
          void(async()=>{try{
            if(!adapter.page||adapter.page.isClosed?.())await adapter.connect();
            for(let i=0;i<90&&!await adapter.loggedIn().catch(()=>false);i++){j.message='전용 크롬에서 체크히어 로그인을 기다리고 있습니다.';await new Promise(r=>setTimeout(r,2000));}
            if(!await adapter.loggedIn().catch(()=>false))throw new Error('LOGIN_REQUIRED: 전용 크롬에서 체크히어에 로그인해 주세요.');
            const report=await runApiProbe({collector:adapter,classId,date1,date2,url:knownUrl,log:t=>{j.message=String(t).trim();}});
            const dir=join(dataDir,'probe');mkdirSync(dir,{recursive:true});
            const file=join(dir,`api-probe-${classId}-${report.dates.join('_')}-${new Date().toISOString().replace(/[:.]/g,'').slice(0,15)}.json`);
            writeFileSync(file,JSON.stringify(report,null,1));
            j.dates=report.dates;j.report=file;j.summary=summarizeApi(report);j.status='complete';j.message='API 진단 완료';
          }catch(e){j.status='failed';j.message=cleanMessage(e.message);}finally{j.finishedAt=new Date().toISOString();saveJob(j);if(busy===j.id)busy=null;}})();
          return send(res,202,j);
        }
        if(url.pathname==='/api/preview-request'){
          await approvalCloud.verify(input.idToken);
          // 바빠서 돌려보낸 쓰기 시도도 '최근 쓰기 시도'로 봅니다(해제 직후 배우기가 중계의 쓰기를 계속 밀어내지 않게).
          if(busy||connecting){lastWriteCall=Date.now();return send(res,409,{error:'진행 중인 작업이 있습니다.'});}
          const tok='preview:'+randomUUID();busy=tok;lastWriteCall=Date.now();let status='pending';try{
            const request=await approvalCloud.get(input.approvalId,input.idToken);status=request.data.status;
            if(!['pending','approved'].includes(request.data.status))throw Error('이미 처리된 요청입니다.');
            const current=await readRequestRecord(adapter,request.data,latest(),request.identities,put);
            // 쓰기가 막힌 화면(가림·해제 시간 부족·연결 확인 전)이면 승인 전에 알립니다: 중계는 승인하지 않고 요청을 대기로 둡니다.
            // 이미 같은 값이면 쓸 것이 없으므로 막지 않습니다(이미 반영 확인은 가린 화면에서도 됨). 잡기 전과 같은 넉넉한 시간 기준을 씁니다.
            const blocked=adapter.writeBlocked?.(current,{minSeconds:MIN_CLAIM_SECONDS})||null;let needsWrite=true;try{needsWrite=!requestMatchesRecord(request.data,current,request.identities);}catch{}
            wait(input.approvalId,blocked&&needsWrite?blocked:'',status);
            return send(res,200,{record:current,...(blocked&&needsWrite?{writeBlocked:{code:blocked.split(':')[0],message:blocked}}:{})});
          }catch(e){wait(input.approvalId,e.message,status);throw e;}finally{if(busy===tok)busy=null;}
        }
        if(url.pathname==='/api/apply'||url.pathname==='/api/confirm-existing'){
          await approvalCloud.verify(input.idToken);
          const approvalId=input.approvalId;if(typeof approvalId!=='string'||!/^[-\w]{16,80}$/.test(approvalId))throw Error('승인된 수정 요청 번호가 필요합니다.');
          // 쓰기 방식: 없음은 자동(순차 요청이 준비되면 그것, 아니면 수정창), 'editor' 수정창, 'request' 순차 요청. 미리보기는 보내지 않습니다.
          const writer=url.pathname==='/api/apply'?writerOf(input):'editor';
          if(input.preview===true&&url.pathname==='/api/apply'){
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
            const tok='preview:'+randomUUID();busy=tok;try{return send(res,200,{preview:true,writer,items:await previewItems([approvalId],input.idToken)});}finally{if(busy===tok)busy=null;}
          }
          if(jobs.get(approvalId)?.approvalId===approvalId)return send(res,200,jobs.get(approvalId));
          if(busy||connecting){lastWriteCall=Date.now();return send(res,409,{error:'진행 중인 작업이 있습니다.'});}
          busy=approvalId;lastWriteCall=Date.now();
          let ctx;
          // 순차 요청 관문(가림·남은 시간)에 막힌 것도 해제를 기다리는 쓰기로 셉니다(해제 사유·「마스킹 해제 시작」·중계 수에 보이게, 요청은 승인 상태 그대로).
          try{if(writer==='request')await requestGate().catch(e=>{wait(approvalId,e.message,'approved');throw e;});ctx=await claimApproval(approvalId,input.idToken,{confirmOnly:url.pathname==='/api/confirm-existing',writer,requestTurn:firstRun().turn});}
          catch(e){if(busy===approvalId)busy=null;throw e;}
          if(ctx.reply){if(busy===approvalId)busy=null;return send(res,200,ctx.reply);}
          void runApproval(ctx).finally(()=>{if(busy===approvalId)busy=null;});
          return send(res,202,ctx.j);
        }
        // 승인된 요청 여러 건을 한 작업으로: 연결 프로그램이 내내 잡고 있어(그 사이 수집·연결 배우기가 탭을 옮기지 않음) 한 건씩
        // 잡기 → 입력 → 다시 읽어 확인 → 플랫폼 저장 → 0.5~1초 쉼 → 다음. 오류·불일치·해제 끝남 중 하나라도 나오면 그 자리에서 멈추고
        // 어디까지 됐는지 남깁니다(이름 없음, 반·날짜·상태만). preview: 보내지 않고 바꿀 목록만 돌려줍니다.
        if(url.pathname==='/api/apply-batch'){
          await approvalCloud.verify(input.idToken);
          const ids=Array.isArray(input.approvalIds)?[...new Set(input.approvalIds)]:[];
          if(!ids.length||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[-\w]{16,80}$/.test(id)))throw Error('승인된 수정 요청 번호 목록(최대 50건)을 확인해 주세요.');
          const writer=writerOf(input);
          if(busy||connecting){lastWriteCall=Date.now();return send(res,409,{error:'진행 중인 작업이 있습니다.'});}
          const claim='apply-batch:'+randomUUID();busy=claim;lastWriteCall=Date.now();
          if(input.preview===true){try{return send(res,200,{preview:true,writer,items:await previewItems(ids,input.idToken)});}finally{if(busy===claim)busy=null;}}
          try{if(writer==='request')await requestGate().catch(e=>{for(const id of ids)wait(id,e.message,'approved');throw e;});await adapter.requireLogin();}catch(e){if(busy===claim)busy=null;throw e;}
          const b={id:randomUUID(),kind:'apply-batch',writer,total:ids.length,done:0,items:[],status:'running',startedAt:new Date().toISOString(),message:'승인된 수정을 한 건씩 반영하고 있습니다.'};saveJob(b);busy=b.id;
          // 첫 실행(「확인했음」 전): 이 묶음에서 순차 요청은 한 건만, 나머지는 수정창(막지 않음).
          let usedRequest=false;
          void(async()=>{try{
            for(const [n,approvalId] of ids.entries()){
              if(n)await new Promise(r=>setTimeout(r,itemGapMs[0]+Math.random()*Math.max(0,itemGapMs[1]-itemGapMs[0])));
              if(jobs.get(approvalId)?.approvalId===approvalId){b.items.push({approvalId,status:'seen',job:jobs.get(approvalId).status});b.stoppedAt={approvalId,step:'seen'};throw Error('이미 이 PC에서 처리한 요청이 있어 멈췄습니다. 결과를 확인해 주세요.');}
              lastWriteCall=Date.now();let ctx;
              try{const fr=firstRun();ctx=await claimApproval(approvalId,input.idToken,{writer,requestTurn:fr.unlocked||(fr.turn&&!usedRequest)});if(ctx.writer==='request')usedRequest=true;}catch(e){b.items.push({approvalId,status:'not-started',message:cleanMessage(e.message)});b.stoppedAt={approvalId,step:'claim'};throw e;}
              if(ctx.reply){b.items.push({approvalId,status:ctx.reply.status});continue;}
              const j=await runApproval(ctx);b.done=n+1;
              b.items.push({approvalId,classId:String(ctx.record.classId),date:ctx.record.date,status:j.status,platformSaved:j.platformSaved===true,writer:ctx.writer});saveJob(b);
              if(j.status!=='verified'||j.platformSaved!==true){b.stoppedAt={approvalId,step:'apply',status:j.status};throw Error(j.status==='verified'?'체크히어 확인 후 플랫폼 DB 저장을 확인하지 못했습니다.':j.message||j.status);}
            }
            b.status='complete';b.message=`${b.done}/${b.total}건 반영·확인·저장 완료`;
          }catch(e){b.status=b.done?'partial':'failed';b.message=`${b.done}/${b.total}건 완료 후 멈춤 · ${cleanMessage(e.message)}`;}finally{b.finishedAt=new Date().toISOString();saveJob(b);if(busy===b.id)busy=null;}})();
          return send(res,202,b);
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
        // ---- 2기 체크히어 학생 번호 등록(운영포털 실시간 화면, 승인 계정 로그인 — 사용자 결정 2026-10-19). 응답은 반·수만(이름·번호 없음) ----
        // summary: 반마다 강의 연결·명단 수·원문 확인 수·확인·등록 상태. registry: 등록된 목록 수를 보고, 이 PC에 명단이 없는 반은 등록 목록을 명단으로 가져옵니다(읽기 전용 연결).
        // register: 이 PC에서 사람이 확인한 반(등록 뒤 다시 확인한 반 포함)을 checkhereIdentities/{반}에 씁니다(이름·끝 4자리·학생 번호만, 다시 읽어 확인).
        if(url.pathname==='/api/identities/summary')return send(res,200,{setup:setupOn(),firebaseReady:firebaseReady(),classes:setupSummary()});
        if(url.pathname==='/api/identities/registry'||url.pathname==='/api/identities/register'){
          const by=await approvalCloud.verify(input.idToken);
          if(typeof approvalCloud.listIdentities!=='function'||typeof approvalCloud.putIdentities!=='function')throw Error('이 연결 프로그램은 체크히어 학생 번호 등록을 지원하지 않습니다.');
          if(url.pathname==='/api/identities/registry'){
            const list=await approvalCloud.listIdentities(input.idToken),imported=[];setup.saveRegistry(list.map(d=>({classId:d.classId,count:d.students.length,updatedAt:d.updatedAt})));
            for(const d of list){
              if(roster.entries(d.classId).length||!d.students.length)continue;
              const valid=d.students.map(s=>({classId:d.classId,name:String(s?.name??'').trim(),last4:String(s?.last4??''),attendeeId:String(s?.attendeeId??'')})).filter(s=>s.name&&!s.name.includes('*')&&/^\d{4}$/.test(s.last4));
              const keyed=rosterKeys(valid,{existing:links.identities(d.classId,{withRoster:false})});if(!keyed.length)continue;
              roster.replace(d.classId,keyed,{source:'registered'});valid.forEach((s,i)=>{if(ATTENDEE_ID.test(s.attendeeId))links.rosterLink(d.classId,s.attendeeId,keyed[i].studentKey,'roster');});imported.push(d.classId);
            }
            return send(res,200,{classes:list.map(d=>({classId:d.classId,count:d.students.length,updatedAt:d.updatedAt})),imported});
          }
          const wanted=Array.isArray(input.classIds)&&input.classIds.length?input.classIds.map(String).filter(classOk):CLASS_IDS,results=[];
          for(const classId of wanted){
            const conf=setup.confirmed(classId);
            if(!conf){results.push({classId,status:'not-confirmed'});continue;}
            if(conf.registeredAt&&input.again!==true){results.push({classId,status:'already',count:conf.registeredCount});continue;}
            try{const saved=await approvalCloud.putIdentities(input.idToken,classId,conf.students,by);setup.markRegistered(classId,{count:saved.count,by,at:saved.updatedAt||new Date().toISOString()});results.push({classId,status:'registered',count:saved.count});}
            catch(e){results.push({classId,status:'failed',message:cleanMessage(e.message)});if(/FIREBASE_CONFIG|IDENTITIES_RULES/.test(e.message))break;}
          }
          return send(res,200,{results,setup:setupOn()});
        }
        // ---- 체크히어 마스킹 해제 도우미(이 PC 화면에서만). 사유는 기다리는 실제 일, 인증번호는 사람이 메일에서 보고 넣은 값 ----
        if(['/api/unmask/','/api/links/','/api/record-format/','/api/request-writer/','/api/setup/'].some(p=>url.pathname.startsWith(p))){
          if(!localOrigin(origin))return send(res,403,{error:LOCAL_ONLY});
          // ---- 2기 준비(이 PC 화면 /setup만): 반→체크히어 강의 연결, 명단 불러오기·사람이 고르는 연결. 이름은 이 화면에만(작업 글·중계·포털로 가지 않음) ----
          if(url.pathname==='/api/setup/state')return send(res,200,await setupState());
          // 설치 모드 켜기·끄기(사람이 이 화면에서). 꺼도 /setup은 그대로 열립니다.
          if(url.pathname==='/api/setup/mode'){setup.setMode(input.on===true);return send(res,200,await setupState());}
          // 반별 확인(사람이 해제한 동안): 고른 반들(없으면 아직 확인하지 않은 반)의 그날을 원문으로 한 번씩 읽습니다.
          if(url.pathname==='/api/setup/check'){
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다. 끝난 뒤 다시 눌러 주세요.'});
            const date=String(input.date||''),wanted=Array.isArray(input.classIds)&&input.classIds.length?[...new Set(input.classIds.map(String))]:CLASS_IDS.filter(c=>!setup.confirmed(c));
            if(!validIso(date)||!collectable(date))throw Error(`날짜(2기 교육 기간 ${PERIOD_TEXT})를 확인해 주세요.`);
            if(!wanted.length||wanted.some(c=>!classOk(c)))throw Error('확인할 반을 골라 주세요.');
            const claim='start:'+randomUUID();busy=claim;
            try{await adapter.requireLogin();const gate=await setupGate();if(gate)throw Error(gate);}catch(e){if(busy===claim)busy=null;throw e;}
            return send(res,202,startSetupCheck(wanted.sort((a,b)=>a-b),date));
          }
          // 사람이 고르는 짝(원문 확인 결과의 명단에 없는 줄 ↔ 명단에만 있는 학생)과 풀기
          if(url.pathname==='/api/setup/pair'||url.pathname==='/api/setup/unpair'){
            const classId=String(input.classId||'');if(!classOk(classId))throw Error('반을 확인해 주세요.');
            const rep=setup.report(classId);if(!rep)throw Error(SETUP_TEXT.NONE);
            setup.saveReport(url.pathname==='/api/setup/pair'?pairRow(rep,roster.entries(classId),String(input.token||''),String(input.studentKey||'')):unpairRow(rep,String(input.token||'')));
            return send(res,200,await setupState());
          }
          // 「이 반 확인」: 마지막 원문 확인 결과에서 뺄 줄(exclude, token)을 빼고 확인 목록을 이 PC에 둡니다(등록은 운영포털에서 승인 계정으로).
          if(url.pathname==='/api/setup/confirm'){
            const classId=String(input.classId||'');if(!classOk(classId))throw Error('반을 확인해 주세요.');
            const rep=setup.report(classId);if(!rep)throw Error(SETUP_TEXT.NONE);
            const out=new Set(Array.isArray(input.exclude)?input.exclude.map(String):[]);rep.exclude=rep.rows.filter(r=>out.has(r.token)&&r.attendeeId).map(r=>r.attendeeId);setup.saveReport(rep);
            setup.confirm(classId,rep.date,confirmList(rep,roster.entries(classId)));return send(res,200,await setupState());
          }
          if(url.pathname==='/api/setup/unconfirm'){const classId=String(input.classId||'');if(!classOk(classId))throw Error('반을 확인해 주세요.');setup.unconfirm(classId);return send(res,200,await setupState());}
          // 내보내기(이 PC 화면만, 학생 번호 포함): 확인 목록 CSV(반, 이름, 끝 4자리, 체크히어 학생 번호) 또는 시트에 붙여 넣는 탭 구분 글. 사람이 시트에 넣을지 정합니다.
          if(url.pathname==='/api/setup/export'){
            const byClass=new Map(setup.confirmedAll().map(c=>[c.classId,c.students]));if(!byClass.size)throw Error('확인한 반이 아직 없습니다.');
            const tab=input.format==='tsv',text=exportText(byClass,{tab});
            res.writeHead(200,{'Content-Type':`${tab?'text/tab-separated-values':'text/csv'}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="checkhere-cohort2-ids-${new Date().toISOString().slice(0,10)}.${tab?'tsv':'csv'}"`});
            return res.end((tab?'':String.fromCharCode(0xfeff))+text);
          }
          if(url.pathname==='/api/setup/lectures'){
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다. 끝난 뒤 다시 눌러 주세요.'});
            const date=validIso(String(input.date||''))?String(input.date):null,tok='setup:'+randomUUID();busy=tok;
            try{await adapter.requireLogin();return send(res,200,await adapter.listLectures({date}));}finally{if(busy===tok)busy=null;}
          }
          if(url.pathname==='/api/setup/link-lecture'){
            const classId=String(input.classId||''),label=typeof input.label==='string'?input.label:'';
            if(!classOk(classId)||!label.trim()||label.length>500)throw Error('반과 연결할 체크히어 강의를 골라 주세요.');
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다. 끝난 뒤 다시 눌러 주세요.'});
            const tok='setup:'+randomUUID();busy=tok;
            try{await adapter.requireLogin();const l=await adapter.linkLecture(classId,label);saveLectureLink(classId,l);rememberPlaces();return send(res,200,await setupState());}finally{if(busy===tok)busy=null;}
          }
          if(url.pathname==='/api/setup/unlink-lecture'){
            const classId=String(input.classId||'');if(!classOk(classId))throw Error('반을 확인해 주세요.');
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다. 끝난 뒤 다시 눌러 주세요.'});
            adapter.unlinkLecture?.(classId);db.prepare('DELETE FROM lecture_links WHERE classId=?').run(classId);rememberPlaces();return send(res,200,await setupState());
          }
          // 명단: 오류 줄이 하나라도 있으면 아무것도 바꾸지 않고 줄 번호·이유만 돌려줍니다(이름·번호 없음). 반마다 통째로 바꿉니다.
          if(url.pathname==='/api/setup/roster'){
            const fixed=input.classId===undefined||input.classId===null||input.classId===''?null:String(input.classId);if(fixed&&!classOk(fixed))throw Error('반을 확인해 주세요.');
            const text=String(input.text??'');if(text.length>200000)throw Error('명단이 너무 깁니다.');
            const {rows,errors}=parseRoster(text,{classId:fixed});
            if(errors.length||!rows.length)return send(res,200,{ok:false,errors:errors.length?errors:[{line:0,reason:'불러올 줄이 없습니다.'}]});
            const imported={};
            for(const classId of [...new Set(rows.map(r=>r.classId))]){
              const keyed=rosterKeys(rows.filter(r=>r.classId===classId),{existing:links.identities(classId,{withRoster:false})});
              roster.replace(classId,keyed);links.dropRosterLinks(classId,new Set(keyed.map(k=>k.studentKey)));adapter.rosterReport?.delete?.(classId);
              imported[classId]={count:keyed.length,dup:keyed.filter(k=>k.dup).length};
            }
            return send(res,200,{ok:true,imported,state:await setupState()});
          }
          if(url.pathname==='/api/setup/roster-clear'){
            const classId=String(input.classId||'');if(!classOk(classId))throw Error('반을 확인해 주세요.');
            roster.clear(classId);links.dropRosterLinks(classId,new Set());adapter.rosterReport?.delete?.(classId);return send(res,200,await setupState());
          }
          // 사람이 고르는 연결: 마지막으로 읽은 날의 연결 안 된 줄(표) 하나 ↔ 명단 학생 하나. 보이는 앞부분·끝 4자리가 맞아야 하고, 원문 읽기로 확인되기 전에는 읽기 전용입니다.
          if(url.pathname==='/api/setup/roster-link'){
            const classId=String(input.classId||'');if(!classOk(classId))throw Error('반을 확인해 주세요.');
            const rep=adapter.rosterReport?.get?.(classId),t=rep?.tokens?.get?.(String(input.token||''));if(!t)throw Error('연결할 줄을 찾지 못했습니다. 그 반을 다시 수집한 뒤 화면을 새로 고쳐 주세요.');
            const entry=roster.entries(classId).find(e=>e.studentKey===String(input.studentKey||''));if(!entry)throw Error('명단 학생을 찾지 못했습니다.');
            if(!manualFits(t,entry))throw Error('보이는 이름 앞부분·전화 끝 4자리가 고른 명단 학생과 맞지 않습니다. 명단을 고쳐 다시 불러오거나 다른 학생을 골라 주세요.');
            if(!links.rosterLink(classId,t.attendeeId,entry.studentKey,'roster-manual'))throw Error('이미 연결된 줄 또는 학생입니다. 화면을 새로 고쳐 주세요.');
            rep.tokens.delete(String(input.token));rep.rows=rep.rows.filter(r=>r.token!==String(input.token));rep.missing=rep.missing.filter(m=>m.studentKey!==entry.studentKey);rep.linked++;
            return send(res,200,await setupState());
          }
          // ---- 형식 기록(4-1): 사람이 해제된 이 탭에서 수정창으로 한 건을 고치는 동안 나가는 변경·삭제 요청 하나의 형식만 적습니다(값·헤더 없음) ----
          // 기록하는 동안 연결 프로그램이 탭을 옮기지 않게 잡아 두고(busy), 그 저장의 확인창(정해진 문구)만 받습니다.
          if(url.pathname==='/api/record-format/start'){
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다. 끝난 뒤 다시 눌러 주세요.'});
            if(!adapter.page||adapter.page.isClosed?.())throw Error('체크히어 로그인 버튼을 먼저 눌러 전용 크롬을 열어 주세요.');
            const h=await adapter.readHeader?.()||{state:'none'};if(h.state==='masked'||h.state==='both')throw Error(MASKED.WRITE);
            const j={id:randomUUID(),kind:'record-format',status:'running',startedAt:new Date().toISOString(),message:'전용 크롬의 그 탭(해제된 탭)에서 수정창으로 한 건을 직접 고쳐 주세요. 첫 변경·삭제 요청 하나의 형식(키·값 종류)만 적습니다.'};saveJob(j);busy=j.id;
            const r=recordFormat({target:typeof adapter.page.context==='function'?adapter.page.context():adapter.page,timeoutMs:recordTimeoutMs});recorder=r;adapter.recording=true;
            void r.done.then(got=>{
              if(!got){j.status='cancelled';j.message='형식 기록을 멈췄습니다(기록한 것 없음).';return;}
              const saved=saveFormat(dataDir,got.entry,{build:BUILD,response:got.response});j.format=formatSummary(saved)[got.entry.op];j.op=got.entry.op;j.response=got.response;
              j.status='complete';j.message=`형식 기록 완료 · ${got.entry.op==='update'?'변경':'삭제'} ${got.entry.method} · 항목 ${got.entry.keys.length}개${got.response?` · 응답 ${got.response.status}`:''}`;
            }).catch(e=>{j.status='failed';j.message=cleanMessage(e.message);}).finally(()=>{adapter.recording=false;if(recorder===r)recorder=null;j.finishedAt=new Date().toISOString();saveJob(j);if(busy===j.id)busy=null;});
            return send(res,202,j);
          }
          if(url.pathname==='/api/record-format/stop'){recorder?.stop();return send(res,200,{ok:true});}
          // ---- 순차 수정 「확인했음」(사람이 이 PC 화면에서만). 켜기·끄기(arm·disarm)는 2026-10-16부터 없음: 옛 화면이 불러도 상태만 돌려줍니다 ----
          if(url.pathname==='/api/request-writer/arm'||url.pathname==='/api/request-writer/disarm')return send(res,200,writerInfo());
          if(url.pathname==='/api/request-writer/confirm'){
            const r=firstRun();if(r.unlocked)return send(res,200,writerInfo());
            // 끝까지 확인되지 않은 첫 건: 사람이 원본을 본 뒤 누르면 그 건을 넘기고 다음 1건만 다시 순차 수정으로 해 봅니다(켜지는 것은 아님).
            if(r.failedJob){db.prepare('INSERT INTO writer_rearms(jobId,build,at) VALUES(?,?,?) ON CONFLICT(jobId) DO NOTHING').run(r.failedJob,BUILD,new Date().toISOString());return send(res,200,writerInfo());}
            if(!r.doneJob)throw Error('확인할 첫 순차 수정이 없습니다. 먼저 1건을 반영하고 체크히어·플랫폼 저장 결과를 확인해 주세요(플랫폼 저장 확인 전이면 운영포털에서 반영 결과 확인을 먼저 눌러 주세요).');
            db.prepare('INSERT INTO writer_unlocks(build,jobId,at) VALUES(?,?,?) ON CONFLICT(build) DO NOTHING').run(BUILD,r.doneJob,new Date().toISOString());return send(res,200,writerInfo());
          }
          if(url.pathname==='/api/unmask/start'){
            if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다. 끝난 뒤 다시 눌러 주세요.'});
            if(!adapter.page||adapter.page.isClosed?.())throw Error('체크히어 로그인 버튼을 먼저 눌러 전용 크롬을 열어 주세요.');
            const m=await maskingInfo(),reason=m.reasonPreview;
            if(!reason)throw Error('지금 체크히어 마스킹 해제가 필요한 일(가림 때문에 기다리는 수정·연결 안 된 학생)이 없습니다.');
            // 사람이 화면에서 본 사유 그대로만 넣습니다. 그 사이 수가 바뀌었으면 다시 보고 누르게 합니다.
            if(input.reason!==reason)return send(res,409,{error:'기다리는 일이 바뀌어 해제 사유가 달라졌습니다. 화면의 새 사유를 확인하고 다시 눌러 주세요.',reason});
            const j={id:randomUUID(),kind:'unmask',status:'running',startedAt:new Date().toISOString(),message:'체크히어 해제 창을 열고 있습니다.'};saveJob(j);busy=j.id;
            try{
              const step=await startUnmask(adapter.page,reason);
              if(step.stage==='done'){await adapter.readHeader?.();endUnmask(j,'complete','이미 해제되어 있습니다.');queueLearning(m);return send(res,200,{stage:'done',reason});}
              j.message='메일로 받은 인증번호 6자리를 연결 프로그램 화면에 넣어 주세요.';saveJob(j);
              const timer=setTimeout(()=>{if(unmask?.job===j)endUnmask(j,'failed','인증번호를 5분 안에 받지 못해 멈췄습니다. 체크히어 창의 해제 창은 직접 닫아 주세요.');},5*60000);timer.unref?.();
              unmask={job:j,reason,timer,classes:m.classes};
              return send(res,200,{stage:'code',reason});
            }catch(e){endUnmask(j,'failed',e.message);throw e;}
          }
          if(url.pathname==='/api/unmask/code'){
            const u=unmask;if(!u)throw Error('먼저 「마스킹 해제 시작」을 눌러 주세요.');
            try{
              const h=await enterCode(adapter.page,String(input.code??''));await adapter.readHeader?.();unmaskedAt=Date.now();lastHeader='unmasked';
              endUnmask(u.job,'complete',`체크히어 해제됨${Number.isFinite(h.remaining)?` · 남은 시간 ${Math.floor(h.remaining/60)}분 ${h.remaining%60}초`:''} · 연장·종료는 체크히어 창에서 직접 누르세요.`);
              queueLearning({classes:u.classes});return send(res,200,{view:'plain',remaining:h.remaining??null});
            }catch(e){
              // 번호를 잘못 넣으면 다시 넣을 수 있게 기다림을 유지합니다. 창 모양이 다르면 멈추고 직접 해제를 부탁합니다.
              if(/UNMASK_UI/.test(e.message))endUnmask(u.job,'failed',e.message);throw e;
            }
          }
          if(url.pathname==='/api/unmask/cancel'){const u=unmask;if(u){await cancelUnmask(adapter.page).catch(()=>false);endUnmask(u.job,'cancelled','체크히어 해제를 취소했습니다.');}return send(res,200,{ok:true});}
          if(url.pathname==='/api/links/clear-conflicts'){if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});return send(res,200,{cleared:links.clearConflicts()});}
        }
        return send(res,404,{error:'지원하지 않는 기능입니다.'});
      }
      // 처음 설치 모드에서는 첫 화면 대신 /setup을 엽니다(첫 화면은 /?main=1).
      if(req.method==='GET'&&url.pathname==='/'&&setupOn()&&url.searchParams.get('main')!=='1'){res.writeHead(302,{Location:'/setup','Cache-Control':'no-store'});return res.end();}
      if(req.method==='GET'&&publicFiles[url.pathname]){
        const ext=url.pathname.endsWith('.mjs')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.json')?'application/json':'text/html';
        res.writeHead(200,{'Content-Type':`${ext}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});return res.end(readFileSync(join(root,publicFiles[url.pathname])));
      }
      return send(res,404,{error:'페이지를 찾지 못했습니다.'});
    }catch(e){return send(res,400,{error:e.message||'요청 처리 오류'});}
  });
  return{server,db,adapter,key,put,links,close:()=>{clearInterval(learnTimer);if(unmask)clearTimeout(unmask.timer);recorder?.stop();server.close();db.close();}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const app=createBridge();app.server.listen(BRIDGE_PORT,'127.0.0.1',()=>console.log(`HINT 체크히어 2기 연결 프로그램(${BUILD}): http://127.0.0.1:${BRIDGE_PORT}  · 2기 준비: http://127.0.0.1:${BRIDGE_PORT}/setup`));
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`이미 실행 중입니다. http://127.0.0.1:${BRIDGE_PORT} 를 열어 주세요.`:e.message);process.exitCode=1;});
}
