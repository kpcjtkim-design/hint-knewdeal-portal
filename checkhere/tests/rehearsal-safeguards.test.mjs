import test from 'node:test';
import assert from 'node:assert/strict';
import {b2Args,wasObject} from '../../api/teacher-beta.js';
import retry from '../../lib/sheet-retry.cjs';
import {CLASS_IDS} from '../../cohort.mjs';
import {checkGuard,rehearsalTarget,createRehearsal,teacherPlan,adminPlan,percentile,summarize,REASON} from '../../beta2-rehearsal-core.mjs';

// 운영 리허설 안전장치(2026-10-21, 시트 v23): api가 새 칸(was·wasStatus·before·clientId·asOf)을 모양을 보고 넘기는지, 다시 시도 규칙, 리허설 보호·시나리오를 가짜 API로 시험합니다.
// 가상 학생·가상 계정만 씁니다. 진짜 API는 부르지 않습니다.
const ADMIN={role:'ADMIN',email:'hint.kpc@gmail.com',classIds:CLASS_IDS},TEACHER={role:'TEACHER',email:'teacher@test.kr',classIds:['3']};

test('api passes the new safeguard fields through with type and size checks',()=>{
 // 서류 처리 was: 정해진 칸만 글자로
 assert.deepEqual(b2Args(ADMIN,'b2DocUpdate',[{id:'D1',status:'처리중',was:{status:'접수',memo:'',link:'',fixReason:'',extra:'x'}}]),[{id:'D1',status:'처리중',was:{status:'접수',memo:'',link:'',fixReason:''}}]);
 assert.throws(()=>b2Args(ADMIN,'b2DocUpdate',[{id:'D1',was:'접수'}]),/BAD_REQUEST/);
 assert.throws(()=>b2Args(ADMIN,'b2DocUpdate',[{id:'D1',was:{memo:'x'.repeat(2001)}}]),/BAD_REQUEST/);
 // 민원 처리 상태 wasStatus
 assert.deepEqual(b2Args(ADMIN,'b2VocReply',[{key:'V1',status:'완료',wasStatus:'처리중'}]),[{key:'V1',status:'완료',wasStatus:'처리중'}]);
 assert.deepEqual(b2Args(TEACHER,'b2VocReply',[{key:'V1',cls:'9',status:'완료',wasStatus:'접수'}]),[{key:'V1',cls:'3',status:'완료',wasStatus:'접수'}]);
 assert.throws(()=>b2Args(ADMIN,'b2VocReply',[{key:'V1',wasStatus:{a:1}}]),/BAD_REQUEST/);
 // 중도탈락 was.sig(관리자 고치기·담임 신청 취소)
 assert.deepEqual(b2Args(ADMIN,'b2DropoutSave',[{row:3,cls:'1',name:'가상1반-01',was:{cls:'1',name:'가상1반-01',sig:'ab12cd34'}}])[0].was,{cls:'1',name:'가상1반-01',sig:'ab12cd34'});
 assert.deepEqual(b2Args(TEACHER,'b2DropoutSave',[{row:3,cls:'3',name:'가상3반-01',remove:true,was:{cls:'3',name:'가상3반-01',sig:'ab12cd34'}}]),[{cls:'3',name:'가상3반-01',row:3,was:{cls:'3',name:'가상3반-01',sig:'ab12cd34'},remove:true}]);
 assert.throws(()=>b2Args(ADMIN,'b2DropoutSave',[{row:3,cls:'1',name:'x',was:{cls:'1',name:'x',sig:'has space'}}]),/BAD_REQUEST/);
 // 모듈 시간 was{date,cls,module,start,end} · 교육생 상태 was{status,changed} · 대조 메모 was(글자)
 assert.deepEqual(b2Args(ADMIN,'b2ModuleTimeSave',[{row:5,cls:'2',date:'2026-11-05',module:'공장견학',start:'10:00',end:'17:00',was:{date:'2026-11-05',cls:'2',module:'공장견학',start:'09:30',end:'',junk:1}}])[0].was,{date:'2026-11-05',cls:'2',module:'공장견학',start:'09:30',end:''});
 assert.deepEqual(b2Args(ADMIN,'b2RosterStatus',[{cls:'2',name:'가상2반-01',status:'중도탈락',changed:'2026-11-05',was:{status:'재학',changed:''}}])[0].was,{status:'재학',changed:''});
 assert.deepEqual(b2Args(ADMIN,'b2LedgerMemo',[{cls:'2',name:'가상2반-01',date:'2026-11-05',memo:'새 메모',was:'옛 메모'}])[0],{cls:'2',name:'가상2반-01',date:'2026-11-05',memo:'새 메모',was:'옛 메모'});
 assert.equal('was' in b2Args(ADMIN,'b2LedgerMemo',[{cls:'2',name:'가',date:'2026-11-05',memo:'m'}])[0],false,'no was = old behaviour');
 assert.deepEqual(b2Args(ADMIN,'b2RosterStatusMany',[{rows:[{cls:'1',name:'가',status:'수료',changed:'2027-01-22',reason:'수료',was:{status:'재학',changed:''}},{cls:'1',name:'나',status:'수료'}]}])[0].rows.map(r=>r.was),[{status:'재학',changed:''},undefined]);
 // 새로 만들기 clientId
 assert.equal(b2Args(TEACHER,'b2DocCreate',[{cls:'3',name:'가',clientId:'4f8e1c2a-1b2c-4d5e-8f90-123456789abc'}])[0].clientId,'4f8e1c2a-1b2c-4d5e-8f90-123456789abc');
 for(const clientId of ['short','has space here','x'.repeat(81),{a:1}])assert.throws(()=>b2Args(TEACHER,'b2VocCreate',[{cls:'3',clientId}]),/BAD_REQUEST/,String(clientId));
 assert.equal(wasObject(undefined,['a']),undefined);assert.throws(()=>wasObject([1],['a']),/BAD_REQUEST/);
});

test('시험 기준일: only administrators can send asOf to b2Bundle; teachers never pass it on; bad dates are refused',()=>{
 assert.deepEqual(b2Args(ADMIN,'b2Bundle',['all',{asOf:'2026-12-10'}]),['all',{asOf:'2026-12-10'}]);
 assert.deepEqual(b2Args(ADMIN,'b2Bundle',['5',{asOf:'2026-12-10'}]),['5',{asOf:'2026-12-10'}]);
 assert.deepEqual(b2Args(ADMIN,'b2Bundle',['5']),['5'],'no asOf = real today');
 assert.deepEqual(b2Args(TEACHER,'b2Bundle',['3',{asOf:'2026-12-10'}]),['3'],'teacher: dropped');
 for(const asOf of ['2026-13-01','12/10','2026-12-1'])assert.throws(()=>b2Args(ADMIN,'b2Bundle',['5',{asOf}]),/BAD_REQUEST/,asOf);
});

test('retry rule: document and VOC creates with a clientId are safe to resend (write), without one they stay create-only',()=>{
 assert.equal(retry.actionKind('b2DocCreate',[{cls:'1',clientId:'abcdef12-3456'}]),'write');
 assert.equal(retry.actionKind('b2VocCreate',[{cls:'1',clientId:'abcdef12-3456'}]),'write');
 assert.equal(retry.actionKind('b2DocCreate',[{cls:'1'}]),'create');
 assert.equal(retry.actionKind('b2VocCreate',[{cls:'1',clientId:'bad id'}]),'create');
 assert.equal(retry.mayRetry('write','lock'),true);assert.equal(retry.mayRetry('write','maybe'),false,'a timeout may still be running, so it is not resent');
});

test('sheet v23 lock wait (45 s) for web writes: Lock timeout / too many simultaneous are retried for the rewrite-safe writes and clientId creates, never for new rows without a contract',async()=>{
 const CID={clientId:'abcdef12-3456'};
 const lockRetried=[['b2DocUpdate',{id:'D1'}],['b2VocSeen',{key:'V1'}],['b2DropoutSave',{row:3,cls:'1',name:'가'}],['b2OfficerSave',{role:'반장',name:'가',kind:'보궐',was:{name:'나'}}],['b2OfficerEnd',{role:'반장'}],
  ['b2LedgerMemo',{cls:'1'}],['b2DayMemo',{cls:'1'}],['b2RosterStatus',{cls:'1'}],['b2RosterStatusMany',{rows:[]}],['b2ScheduleSave',{rows:[]}],['b2DocCreate',{cls:'1',...CID}],['b2VocCreate',{cls:'1',...CID}]];
 const lockNot=[['b2DocCreate',{cls:'1'}],['b2VocCreate',{cls:'1'}],['b2VocReply',{key:'V1',text:'x'}],['portalAddRow',{}],['b2DropoutSave',{cls:'1',name:'가'}],['b2OfficerSave',{role:'앰버서더',name:'가',kind:'추가'}]];
 const run=async(action,p,message,took=1000)=>{let t=0,n=0;
  const fetchImpl=async()=>{n++;t+=took;return n===1?Response.json({ok:false,error:message}):Response.json({ok:true,data:{ok:true}});};
  try{const r=await retry.callSheetWithRetry({url:'u',key:'k',action,args:[p],fetchImpl,now:()=>t,sleep:async ms=>{t+=ms;},random:()=>0});return r.attempts;}catch(e){return 'gave up after '+e.attempts;}};
 for(const [a,p] of lockRetried){assert.equal(await run(a,p,'Lock timeout: another process was holding the lock for too long.'),2,a+' lock');assert.equal(await run(a,p,'too many simultaneous invocations: 31'),2,a+' busy');}
 for(const [a,p] of lockNot)assert.equal(await run(a,p,'Lock timeout: another process was holding the lock for too long.'),'gave up after 1',a+' is not resent on a lock timeout');
 assert.equal(await run('b2VocReply',{key:'V1'},'too many simultaneous invocations: 31'),2,'Apps Script did not run at all, so even a reply can be sent again (unchanged rule)');
 assert.equal(await run('b2DocUpdate',{id:'D1'},'Lock timeout: another process was holding the lock for too long.',46000),'gave up after 1','a lock timeout that already waited over 45 s is not retried');
});

test('rehearsal guard: refuses anything that is not class 17 or a 가상 student, unknown documents and unknown actions',()=>{
 assert.equal(rehearsalTarget('17','가상학생01'),true);assert.equal(rehearsalTarget('3','가상3반-02'),true);
 assert.equal(rehearsalTarget('3','김철수'),false,'real student in a real class');
 assert.equal(rehearsalTarget('17','김철수'),false,'even in class 17 the name must start with 가상');
 assert.equal(rehearsalTarget('18','가상'),false);
 const refuse=(action,args,o)=>assert.throws(()=>checkGuard(action,args,o),e=>e.code==='REHEARSAL_GUARD',action);
 refuse('portalSaveBatch',[{cls:'3',items:[{name:'가상3반-01'},{name:'김철수'}]}]);
 refuse('portalSaveBatch',[{cls:'17',items:[]}]);
 refuse('b2Save',[{cls:'5',name:'박영희'}]);refuse('b2LedgerMemo',[{cls:'17',name:'홍길동'}]);refuse('b2DocCreate',[{cls:'2',name:'이몽룡'}]);
 refuse('b2DocUpdate',[{id:'D9'}],{docIds:new Set(['D1'])});
 refuse('b2RosterStatus',[{cls:'17',name:'가상학생01'}]);refuse('b2RebuildBoards',[{}]);refuse('portalSave',[{cls:'17',name:'가상학생01'}]);
 checkGuard('portalSaveBatch',[{cls:'17',items:[{name:'가상학생01'}]}]);checkGuard('b2DocUpdate',[{id:'D1'}],{docIds:new Set(['D1'])});checkGuard('b2Bundle',['all']);checkGuard('queueStatus',[{ids:[]}]);
});

test('plans: 16 teachers × 50 on distinct student·date cells (no two teachers share a cell), admins on other dates; percentiles',()=>{
 const names=Array.from({length:10},(_,i)=>`가상학생${String(i+1).padStart(2,'0')}`);
 const p=teacherPlan(names,{teachers:16,items:50}),cells=p.flat().map(x=>x.name+'|'+x.date);
 assert.equal(p.length,16);assert.ok(p.every(l=>l.length===50));assert.equal(new Set(cells).size,800);
 assert.deepEqual([p[0][0].date,p[15][49].date],['2026-07-01','2026-09-18']);
 const a=adminPlan(names,{admins:4,adminSaves:10}).flat();assert.equal(new Set(a.map(x=>x.name+'|'+x.date)).size,40);assert.ok(a.every(x=>x.date<'2026-07-01'));
 assert.equal(percentile([5,1,4,2,3],50),3);assert.equal(percentile(Array.from({length:100},(_,i)=>i+1),95),95);assert.equal(percentile([],50),0);
});

// ---------- 가짜 2기 API(시트 + 대기열) ----------
// 시트 v23처럼: before가 지금 지문과 다르면 CONFLICT, 대조 메모가 있는 줄을 지우면 '출석'으로 남김, clientId는 한 번만, 서류 was 확인.
// honest:false면 before·was를 보지 않는 옛 시트(충돌 시나리오가 실패해야 함).
function fakeApi({honest=true}={}){
 const ledger=new Map(),docs=new Map(),once=new Map(),queue=[],writes=[];let qid=0,docSeq=0,rev=1;
 const sig=r=>r?['sig',r.type,r.reason,r.inT,r.oa].join(':'):'';
 const roster=[...Array.from({length:10},(_,i)=>['17',`가상학생${String(i+1).padStart(2,'0')}`,'재학','','']),['17','실제학생','재학','',''],['1','가상1반-01','재학','',''],['1','김철수','재학','','']];
 const cols=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
 const bundle=cls=>({rev,today:'2026-10-21',days:[],classes:[],roster:roster.filter(r=>cls==='all'||r[0]===cls),ledgerCols:cols,
  ledger:[...ledger.values()].filter(r=>cls==='all'||r.cls===cls).map(r=>cols.map(k=>k==='sig'?sig(r):r[k]??''))});
 const conflict=(q)=>honest&&q.before!==undefined&&String(q.before)!==sig(ledger.get(q.key));
 function apply(q){
  if(conflict(q))return {ok:false,error:q.role==='TEACHER'?'CONFLICT: 운영팀이 그사이 이 기록을 고쳤습니다. 최신 값을 다시 읽어 주세요.':'CONFLICT: 그사이 다른 사람이 이 기록을 바꿨습니다.'};
  const cur=ledger.get(q.key);
  if(!q.rec.type){if(!cur)return {ok:true,action:'none'};if(cur.memo){ledger.set(q.key,{...cur,type:'출석',reason:'',inT:'',oa:''});return {ok:true,action:'write',sig:sig(ledger.get(q.key))};}ledger.delete(q.key);return {ok:true,action:'delete'};}
  ledger.set(q.key,{memo:'',...cur,...q.rec});rev++;return {ok:true,action:'write',sig:sig(ledger.get(q.key))};
 }
 const drain=()=>{for(const q of queue.filter(x=>x.status==='pending')){const r=apply(q);Object.assign(q,r.ok?{status:'done',sig:r.sig||'',action:r.action}:{status:'failed',error:r.error});}};
 const enqueue=(role,rec,before)=>{const id='q'+String(++qid).padStart(6,'0');queue.push({id,role,key:`${rec.cls}|${rec.name}|${rec.date}`,rec,before,status:'pending'});return id;};
 async function call(action,...args){
  const p=args[0]||{};
  if(!['b2Bundle','queueStatus','b2Docs'].includes(action))writes.push([action,JSON.parse(JSON.stringify(p))]);
  if(action==='b2Bundle')return bundle(String(p));
  if(action==='portalSaveBatch')return {ok:true,queued:true,ids:p.items.map(it=>enqueue('TEACHER',{cls:String(p.cls),name:it.name,date:it.date,type:it.type,inT:it.inT,oa:it.oa,reason:it.r},it.before))};
  if(action==='b2Save')return {ok:true,queued:true,id:enqueue('ADMIN',{cls:String(p.cls),name:p.name,date:p.date,type:p.type,inT:p.inT,oa:p.oa,reason:p.reason},p.before)};
  if(action==='queueStatus'){drain();return {enabled:true,items:queue.filter(q=>p.ids.includes(q.id)).map(q=>({id:q.id,status:q.status,error:q.error||'',sig:q.sig||'',action:q.action||'',name:q.rec.name,date:q.rec.date}))};}
  if(action==='b2LedgerMemo'){const k=`${p.cls}|${p.name}|${p.date}`,cur=ledger.get(k);if(honest&&p.was!==undefined&&String(p.was)!==(cur?.memo||''))throw Object.assign(Error('그사이 다른 사람이 바꿨습니다. 새로 읽어 주세요.'),{code:'CONFLICT'});
   if(!cur&&!p.memo)return {ok:true,unchanged:true};ledger.set(k,{type:'출석',reason:'',...cur,cls:p.cls,name:p.name,date:p.date,memo:p.memo});return {ok:true};}
  if(action==='b2DocCreate'){if(p.clientId&&once.has(p.clientId))return {...once.get(p.clientId),repeated:true};const id='D'+(++docSeq);docs.set(id,{id,cls:p.cls,name:p.name,status:'접수',memo:p.memo||'',link:'',fixReason:''});const out={ok:true,id,rev};if(p.clientId)once.set(p.clientId,out);return out;}
  if(action==='b2Docs')return {rows:[...docs.values()].filter(d=>!p.cls||d.cls===p.cls)};
  if(action==='b2DocUpdate'){const d=docs.get(p.id);if(honest&&p.was&&['status','memo','link','fixReason'].some(k=>p.was[k]!==undefined&&String(p.was[k])!==String(d[k]??'')))throw Object.assign(Error('그사이 다른 사람이 바꿨습니다. 새로 읽어 주세요.'),{code:'CONFLICT'});Object.assign(d,{status:p.status,memo:p.memo??d.memo,link:p.link??d.link,fixReason:p.fixReason??''});return {ok:true};}
  throw Error('fake api: unexpected '+action);
 }
 return {client:{call},ledger,docs,writes,queue};
}
const run=async(api,options={})=>{let t=0;const r=createRehearsal({client:api.client,now:()=>(t+=7),sleep:async()=>{},options:{teachers:16,items:50,admins:4,adminSaves:10,...options}});
 return {r,teachers:await r.teachers(),admins:await r.admins(),conflicts:await r.conflicts(),cleanup:await r.cleanup()};};

test('rehearsal scenarios with a fake API: 800 teacher items applied once each, admins in parallel, all three conflicts caught, cleanup leaves nothing; every write targets class 17 or a 가상 student',async()=>{
 const api=fakeApi(),res=await run(api);
 assert.equal(res.teachers.pass,true,JSON.stringify(res.teachers));
 assert.deepEqual([res.teachers.total,res.teachers.accepted,res.teachers.failed,res.teachers.missing,res.teachers.duplicates],[800,800,0,0,0]);
 assert.ok(res.teachers.p95>=res.teachers.p50&&res.teachers.appliedMs>0);
 assert.equal(res.admins.pass,true,JSON.stringify(res.admins));assert.equal(res.admins.docs.repeated,true,'same clientId twice = one document');assert.equal(api.docs.size,1);
 assert.equal(res.conflicts.pass,true,JSON.stringify(res.conflicts));
 assert.deepEqual(res.conflicts.checks.map(c=>[c.id,c.results.filter(x=>x==='ok').length,c.results.filter(x=>x==='conflict').length]),[['a',1,1],['b',1,1],['c',1,1]]);
 assert.equal(res.cleanup.pass,true,JSON.stringify(res.cleanup));assert.equal(res.cleanup.left,0);assert.equal(api.ledger.size,0,'memo rows were cleared first, so nothing stays as 출석');
 assert.ok(res.cleanup.memoCleared>=2);assert.deepEqual([...api.docs.values()].map(d=>[d.status,d.memo.startsWith(REASON)]),[['취소',true]]);
 // 보낸 쓰기는 모두 17반 가상 학생(서류는 1반 가상1반-01)·이번 리허설 서류
 for(const [action,p] of api.writes){
  const names=action==='portalSaveBatch'?p.items.map(i=>[p.cls,i.name]):action==='b2DocUpdate'?[]:[[p.cls,p.name]];
  for(const [c,n] of names)assert.ok(String(n).startsWith('가상')&&(c==='17'||c==='1'),`${action} ${c} ${n}`);
 }
 assert.ok(!api.writes.some(([,p])=>JSON.stringify(p).includes('실제학생')||JSON.stringify(p).includes('김철수')));
 const sum=summarize(res,{by:'hint.kpc@gmail.com',options:res.r.options});
 assert.equal(sum.pass,true);assert.deepEqual(sum.scenarios.map(s=>[s.id,s.pass]),[['teachers',true],['admins',true],['conflicts',true],['cleanup',true]]);
 assert.ok(JSON.stringify(sum).length<6000,'summary stays small for settings/rehearsalLast');
});

test('rehearsal against an old sheet that ignores before/was: the conflict scenario fails (so a missing safeguard is visible); existing non-rehearsal rows stop scenario 1',async()=>{
 const res=await run(fakeApi({honest:false}),{teachers:2,items:10,admins:1,adminSaves:2});
 assert.equal(res.teachers.pass,true);assert.equal(res.conflicts.pass,false);
 assert.deepEqual(res.conflicts.checks.map(c=>c.pass),[false,false,false]);
 const api=fakeApi();api.ledger.set('17|가상학생01|2026-07-01',{cls:'17',name:'가상학생01',date:'2026-07-01',type:'결석',reason:'다른 시험',memo:''});
 const r=createRehearsal({client:api.client,now:()=>1,sleep:async()=>{},options:{teachers:2,items:10}});
 await assert.rejects(r.teachers(),/리허설이 아닌 기록이 있어 멈췄습니다/);
 assert.equal(api.writes.length,0,'nothing was sent');
});
