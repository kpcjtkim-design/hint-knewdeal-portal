// 운영 리허설(관리자 「공지·설정 › 운영 리허설」, 사용자 요청 2026-10-21 "16명 담임이 하루에 동시에 작업 가능한지, 단위기간 등 바쁠 때 관리자들이
// 동시에 작업해도 부하가 없는지, 담임↔관리자·관리자↔관리자 충돌이 없는지 리허설하고 안전장치를 마련"). 만족도·체크히어는 빼고 출결·메모·서류만 봅니다.
// 이 파일은 화면 없이 시나리오만 돌립니다(가짜 API로 시험할 수 있게 client.call 하나만 씁니다).
//
// 보호(꼭 지킴): 쓰기는 모두 guardedCall을 거치고, 17반 또는 이름이 '가상'으로 시작하는 학생이 아니면 보내지 않습니다(REHEARSAL_GUARD).
//   더 조심해서, 17반이어도 이름이 '가상'으로 시작하지 않으면 보내지 않습니다(17반 테스트반 학생은 모두 가상학생01~10).
//   서류 고치기(b2DocUpdate)는 이번 리허설이 만든 신청 번호만. 그 밖의 쓰기 기능은 아예 부르지 않습니다.
// 기록은 개강 전 지난 날짜(5~7월)에 사유 '[리허설]'로만 만들고, 4번 정리가 모두 지웁니다(운영팀 메모가 있으면 지울 때 '출석'으로 남으므로 메모부터 지움).
// 서류발급 신청은 지우는 기능이 없어 '취소'와 비고 '[리허설] …'로 표시합니다(가상N반 학생이면 시트 b2C2FakePurge가 나중에 줄을 지움).
import {decodeBundle} from './beta2-core.mjs';
import {CLASSES} from './cohort.mjs';

export const REHEARSAL_CLASS='17';
export const REASON='[리허설]';
export const DOC_MEMO='[리허설] 운영 리허설 시험 신청 · 지워도 됨';
export const DEFAULTS=Object.freeze({teachers:16,items:50,admins:4,adminSaves:10,docCls:'1',pollMs:2000,timeoutMs:240000,batchMax:100});
// 날짜(개강 전 지난 날, 실제 교육일과 겹치지 않음): 1 담임 7/1부터, 2 운영자 6/1부터, 3 충돌 5/1부터
export const DATE_BASE={teachers:'2026-07-01',admins:'2026-06-01',conflicts:'2026-05-01'};
export const SCENARIOS=[['teachers','1. 담임 16명 동시 입력'],['admins','2. 운영자 동시 작업'],['conflicts','3. 충돌 막기'],['cleanup','4. 정리']];

export function rehearsalTarget(cls,name){
 const c=String(cls??'').trim(),n=String(name??'').trim();
 if(!n.startsWith('가상'))return false;
 return c===REHEARSAL_CLASS||CLASSES.some(x=>String(x.id)===c); // 반 번호는 cohort.json 반 목록 그대로
}
export function guardError(cls,name){return Object.assign(Error(`리허설 보호: ${cls||'?'}반 ${name||'(이름 없음)'}은(는) 리허설 대상(17반·'가상' 학생)이 아니라 보내지 않았습니다.`),{code:'REHEARSAL_GUARD'});}
const READS=new Set(['b2Bundle','b2Rev','b2Docs','queueStatus']);
// 보낼 수 있는지 봅니다. 안 되면 Error(code REHEARSAL_GUARD). docIds: 이번 리허설이 만든 서류 신청 번호.
export function checkGuard(action,args,{docIds=new Set()}={}){
 if(READS.has(action))return;
 const p=args?.[0]&&typeof args[0]==='object'?args[0]:{};
 const one=(cls,name)=>{if(!rehearsalTarget(cls,name))throw guardError(cls,name);};
 if(action==='portalSaveBatch'){const items=Array.isArray(p.items)?p.items:[];if(!items.length)throw guardError(p.cls,'');for(const it of items)one(p.cls,it?.name);return;}
 if(['b2Save','b2LedgerMemo','b2DocCreate'].includes(action)){one(p.cls,p.name);return;}
 if(action==='b2DocUpdate'){if(!docIds.has(String(p.id||'')))throw Object.assign(Error(`리허설 보호: 이번 리허설이 만든 서류 신청(${p.id||'번호 없음'})이 아니라 보내지 않았습니다.`),{code:'REHEARSAL_GUARD'});return;}
 throw Object.assign(Error(`리허설 보호: ${action}은(는) 리허설에서 쓰지 않는 기능입니다.`),{code:'REHEARSAL_GUARD'});
}

export const addDays=(iso,n)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export function percentile(list,p){const a=[...list].filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const i=Math.min(a.length-1,Math.max(0,Math.ceil(p/100*a.length)-1));return a[i];}
export const isRehearsalRow=r=>String(r?.reason||'').startsWith(REASON);
const keyOf=(cls,name,date)=>`${cls}|${name}|${date}`;
const errText=e=>String(e?.message||e||'');
const conflictText=t=>/^CONFLICT/.test(String(t||''))||/그사이/.test(String(t||''));
const isConflictErr=e=>e?.code==='CONFLICT'||conflictText(e?.message);

// 담임 N명이 같은 반(17반)에 각자 다른 날짜로 items건씩: 담임 t는 날짜 [t*d, (t+1)*d) × 학생 → 앞에서 items건(겹치는 학생·날짜 없음)
export function teacherPlan(names,{teachers=DEFAULTS.teachers,items=DEFAULTS.items,base=DATE_BASE.teachers}={}){
 if(!names.length)throw Error('17반 명부에 가상 학생이 없습니다.');
 const per=Math.ceil(items/names.length),plan=[];
 for(let t=0;t<teachers;t++){
  const list=[];
  for(let j=0;j<per&&list.length<items;j++){const date=addDays(base,t*per+j);for(const name of names){if(list.length>=items)break;list.push({name,date});}}
  plan.push(list);
 }
 return plan;
}
export function adminPlan(names,{admins=DEFAULTS.admins,adminSaves=DEFAULTS.adminSaves,base=DATE_BASE.admins}={}){
 if(!names.length)throw Error('17반 명부에 가상 학생이 없습니다.');
 const plan=[];
 for(let w=0;w<admins;w++){const list=[];for(let j=0;j<adminSaves;j++){const k=w*adminSaves+j;list.push({name:names[k%names.length],date:addDays(base,Math.floor(k/names.length))});}plan.push(list);}
 return plan;
}

// client: createBeta2Client(...)(call만 씀) · now·sleep: 시험에서 바꿈 · log(text): 진행 줄
export function createRehearsal({client,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=()=>{},options={}}={}){
 const opt={...DEFAULTS,...options},docIds=new Set(),keys=new Set();
 async function guarded(action,...args){checkGuard(action,args,{docIds});return client.call(action,...args);}
 async function bundle(cls=REHEARSAL_CLASS){return decodeBundle(await guarded('b2Bundle',String(cls)));}
 const fakeNames=(b,cls=REHEARSAL_CLASS)=>[...new Set(b.roster.filter(p=>p.cls===String(cls)&&rehearsalTarget(cls,p.name)).map(p=>p.name))].sort();
 const rowsAt=(b,cls,name,date)=>b.ledger.filter(r=>String(r.cls)===String(cls)&&r.name===name&&r.date===date);
 const sigAt=(b,cls,name,date)=>String(rowsAt(b,cls,name,date)[0]?.sig??'');
 // 보내려는 칸에 리허설이 아닌 기록이 있으면 멈춥니다(다른 시험 자료를 건드리지 않게).
 function preflight(b,list){
  const busy=list.filter(({name,date})=>rowsAt(b,REHEARSAL_CLASS,name,date).some(r=>!isRehearsalRow(r)));
  if(busy.length)throw Error(`17반 ${busy[0].name} ${busy[0].date}에 리허설이 아닌 기록이 있어 멈췄습니다(${busy.length}칸). 날짜를 바꾸거나 그 기록을 먼저 정리해 주세요.`);
 }
 // 대기열 반영 기다리기: 200개씩 queueStatus. 모두 done·failed이거나 시간이 다 되면 끝. appliedAt: 마지막 항목이 끝난 것을 본 때.
 async function waitQueue(ids,{t0=now(),timeoutMs=opt.timeoutMs}={}){
  const want=[...new Set(ids.filter(Boolean))],state=new Map();let appliedAt=0;
  while(want.some(id=>!['done','failed'].includes(state.get(id)?.status))){
   if(now()-t0>timeoutMs)break;
   await sleep(opt.pollMs);
   const open=want.filter(id=>!['done','failed'].includes(state.get(id)?.status));
   for(let i=0;i<open.length;i+=200){
    try{const res=await guarded('queueStatus',{ids:open.slice(i,i+200)});for(const it of res?.items||[])if(want.includes(it.id))state.set(it.id,it);}catch(e){log(`반영 확인 실패(다시 봄): ${errText(e)}`);}
   }
   if(want.every(id=>['done','failed'].includes(state.get(id)?.status)))appliedAt=now();
  }
  const items=want.map(id=>state.get(id)||{id,status:'pending'});
  return {items,done:items.filter(x=>x.status==='done').length,failed:items.filter(x=>x.status==='failed'),pending:items.filter(x=>!['done','failed'].includes(x.status)).length,appliedMs:appliedAt?appliedAt-t0:null};
 }

 // ---------- 1. 담임 16명 동시 입력 ----------
 async function teachers(){
  const b=await bundle(),names=fakeNames(b),plan=teacherPlan(names,opt),all=plan.flat();
  preflight(b,all);
  log(`담임 ${plan.length}명 × ${opt.items}건 = ${all.length}건 · 17반 가상 학생 ${names.length}명 · ${all[0]?.date}~${all.at(-1)?.date}`);
  const t0=now(),latency=[],errors=[],ids=[];let direct=0,directFail=0;
  await Promise.all(plan.map(async(list,t)=>{
   const items=list.map(({name,date})=>{keys.add(keyOf(REHEARSAL_CLASS,name,date));return {name,date,type:'지각',inT:'09:15',outT:'',oa:'',ob:'',r:REASON,before:sigAt(b,REHEARSAL_CLASS,name,date)};});
   for(let i=0;i<items.length;i+=opt.batchMax){
    const part=items.slice(i,i+opt.batchMax),s=now();
    try{const res=await guarded('portalSaveBatch',{cls:REHEARSAL_CLASS,items:part});latency.push(now()-s);
     if(res?.queued&&Array.isArray(res.ids))ids.push(...res.ids);
     else{for(const r of res?.results||[]){direct++;if(!r.ok)directFail++;}}
    }catch(e){latency.push(now()-s);errors.push(`담임 ${t+1}: ${errText(e)}`);}
   }
  }));
  const acceptMs=now()-t0;log(`접수 ${ids.length+direct}건 · ${(acceptMs/1000).toFixed(1)}초 · 요청 실패 ${errors.length}`);
  const q=ids.length?await waitQueue(ids,{t0}):{items:[],done:0,failed:[],pending:0,appliedMs:acceptMs};
  log(`시트 반영 ${q.done}건 · 실패 ${q.failed.length} · 남음 ${q.pending}${q.appliedMs!=null?` · ${(q.appliedMs/1000).toFixed(1)}초`:''}`);
  const v=await verify(all,r=>r.type==='지각'&&isRehearsalRow(r));
  const pass=!errors.length&&!q.failed.length&&!q.pending&&!directFail&&!v.missing.length&&!v.dups.length;
  return {id:'teachers',pass,total:all.length,accepted:ids.length+direct,errors,failed:q.failed.length+directFail,failedSamples:q.failed.slice(0,5).map(x=>`${x.name} ${x.date}: ${x.error}`),pending:q.pending,
   p50:percentile(latency,50),p95:percentile(latency,95),acceptMs,appliedMs:q.appliedMs,missing:v.missing.length,duplicates:v.dups.length,samples:[...v.missing.slice(0,3),...v.dups.slice(0,3)]};
 }
 // 시트(b2Bundle 17반)에서 기대한 칸이 한 줄씩 있는지: 없음(missing)·여러 줄(dups)
 async function verify(list,okRow){
  const b=await bundle(),missing=[],dups=[];
  for(const {name,date} of list){const rows=rowsAt(b,REHEARSAL_CLASS,name,date);if(rows.length>1)dups.push(`${name} ${date} ${rows.length}줄`);else if(!rows.length||!okRow(rows[0]))missing.push(`${name} ${date}`);}
  return {missing,dups};
 }

 // ---------- 2. 운영자 동시 작업(출결대조 저장 K명 + 대조 메모 + 서류 신청·처리) ----------
 async function admins(){
  const b=await bundle(),names=fakeNames(b),plan=adminPlan(names,opt),all=plan.flat();
  preflight(b,all);
  log(`운영자 ${plan.length}명 × ${opt.adminSaves}건 출결대조 저장 · 대조 메모 · 서류 신청`);
  const t0=now(),latency=[],errors=[],ids=[];let direct=0;
  await Promise.all(plan.map(async(list,w)=>{
   for(const {name,date} of list){
    keys.add(keyOf(REHEARSAL_CLASS,name,date));
    const s=now();
    try{const res=await guarded('b2Save',{cls:REHEARSAL_CLASS,name,date,type:'지각',inT:'09:20',outT:'',oa:'',ob:'',reason:REASON,ev:'',evr:'',before:sigAt(b,REHEARSAL_CLASS,name,date)});latency.push(now()-s);if(res?.queued)ids.push(res.id);else direct++;}
    catch(e){latency.push(now()-s);errors.push(`운영자 ${w+1} ${name} ${date}: ${errText(e)}`);}
   }
  }));
  const q=ids.length?await waitQueue(ids,{t0}):{items:[],done:0,failed:[],pending:0,appliedMs:now()-t0};
  // 대조 메모 2건(정리 때 먼저 지움)
  const memos=[];
  for(const {name,date} of all.slice(0,2)){const s=now();try{await guarded('b2LedgerMemo',{cls:REHEARSAL_CLASS,name,date,memo:`${REASON} 대조 메모`,was:''});memos.push({ok:true,ms:now()-s});}catch(e){memos.push({ok:false,ms:now()-s,error:errText(e)});}}
  const docs=await docFlow();
  const pass=!errors.length&&!q.failed.length&&!q.pending&&memos.every(m=>m.ok)&&docs.ok;
  return {id:'admins',pass,total:all.length,accepted:ids.length+direct,errors,failed:q.failed.length,failedSamples:q.failed.slice(0,5).map(x=>`${x.name} ${x.date}: ${x.error}`),pending:q.pending,
   p50:percentile(latency,50),p95:percentile(latency,95),appliedMs:q.appliedMs,memos:memos.filter(m=>m.ok).length+'/'+memos.length,docs};
 }
 // 서류 신청: 같은 clientId로 두 번 → 두 번째는 repeated:true, 같은 번호. 그다음 처리 상태 저장(was).
 async function docStudent(){
  try{const b=await bundle(opt.docCls),n=fakeNames(b,opt.docCls).find(x=>/^가상\d+반-\d+$/.test(x));if(n)return {cls:String(opt.docCls),name:n};}catch{}
  const b=await bundle(),n=fakeNames(b)[0];if(!n)throw Error('서류 신청에 쓸 가상 학생이 없습니다.');return {cls:REHEARSAL_CLASS,name:n};
 }
 async function readDoc(cls,id){const d=await guarded('b2Docs',{cls});return (d?.rows||[]).find(x=>String(x.id)===String(id))||null;}
 const docWas=d=>({status:String(d?.status??''),memo:String(d?.memo??''),link:String(d?.link??''),fixReason:String(d?.fixReason??'')});
 async function createDoc(){
  const who=await docStudent(),clientId=`rh-${now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const p={clientId,cls:who.cls,name:who.name,docType:'교육참여확인서',qty:1,period:'',purpose:`${REASON} 시험 신청`,submitTo:`${REASON} 운영 리허설`,due:'',delivery:'카카오톡 개별 전송',memo:DOC_MEMO};
  checkGuard('b2DocCreate',[p],{docIds});
  const first=await client.call('b2DocCreate',p);if(first?.id)docIds.add(String(first.id));
  const again=await client.call('b2DocCreate',p);
  return {who,id:String(first?.id||''),repeated:again?.repeated===true&&String(again?.id)===String(first?.id)};
 }
 async function docFlow(){
  try{
   const c=await createDoc();log(`서류 신청 ${c.id} · 같은 clientId 다시 보냄 → ${c.repeated?'한 건만(repeated)':'두 건이 됨!'}`);
   const cur=await readDoc(c.who.cls,c.id);if(!cur)return {ok:false,id:c.id,error:'만든 신청을 목록에서 찾지 못했습니다'};
   await guarded('b2DocUpdate',{id:c.id,status:'처리중',memo:DOC_MEMO,link:'',fixReason:'',was:docWas(cur)});
   return {ok:c.repeated,id:c.id,cls:c.who.cls,repeated:c.repeated};
  }catch(e){return {ok:false,error:errText(e)};}
 }

 // ---------- 3. 충돌 막기 ----------
 async function conflicts(){
  const b=await bundle(),names=fakeNames(b);if(names.length<2)throw Error('17반 가상 학생이 2명 이상 있어야 합니다.');
  const A={name:names[0],date:DATE_BASE.conflicts},B={name:names[1],date:addDays(DATE_BASE.conflicts,1)};
  preflight(b,[A,B]);keys.add(keyOf(REHEARSAL_CLASS,A.name,A.date));keys.add(keyOf(REHEARSAL_CLASS,B.name,B.date));
  const row=(x,reason,extra={})=>({cls:REHEARSAL_CLASS,name:x.name,date:x.date,type:'지각',inT:'09:20',outT:'',oa:'',ob:'',reason,ev:'',evr:'',...extra});
  // 저장 한 건의 끝 결과: ok | conflict | error(대기열이면 반영까지 기다림)
  async function settle(p){
   if(p.error)return isConflictErr(p.error)?'conflict':'error:'+errText(p.error);
   const res=p.res;
   if(res?.queued){const q=await waitQueue([res.id||res.ids?.[0]]);const it=q.items[0]||{status:'pending'};return it.status==='done'?'ok':it.status==='failed'?(conflictText(it.error)?'conflict':'error:'+it.error):'error:반영 대기 시간 초과';}
   if(Array.isArray(res?.results)){const r=res.results[0]||{};return r.ok?'ok':r.conflict||conflictText(r.msg)?'conflict':'error:'+r.msg;}
   return 'ok';
  }
  const send=(action,p)=>guarded(action,p).then(res=>({res}),error=>({error}));
  const out=[];
  // (a) 운영자 둘이 같은 줄을 같은 before로 → 하나만 저장, 하나는 CONFLICT
  {const s0=sigAt(b,REHEARSAL_CLASS,A.name,A.date);const [x,y]=await Promise.all([send('b2Save',row(A,`${REASON} A`,{before:s0})),send('b2Save',row(A,`${REASON} B`,{before:s0}))]);
   const r=[await settle(x),await settle(y)];out.push({id:'a',label:'운영자↔운영자 같은 줄 동시 저장',pass:r.filter(v=>v==='ok').length===1&&r.filter(v=>v==='conflict').length===1,results:r});}
  // (b) 운영자가 먼저 고친 뒤, 담임이 예전 before로 저장 → CONFLICT
  {const s0=sigAt(b,REHEARSAL_CLASS,B.name,B.date);const first=await settle(await send('b2Save',row(B,`${REASON} 운영`,{before:s0})));
   const t=await settle(await send('portalSaveBatch',{cls:REHEARSAL_CLASS,items:[{name:B.name,date:B.date,type:'외출',inT:'',outT:'',oa:'',ob:'',r:`${REASON} 담임`,before:s0}]}));
   out.push({id:'b',label:'운영자가 고친 뒤 담임이 옛 값으로 저장',pass:first==='ok'&&t==='conflict',results:[first,t]});}
  // (c) 서류 처리 둘이 같은 was로 → 하나만 저장, 하나는 CONFLICT
  {try{
    const id=[...docIds][0]||(await createDoc()).id,cls=(await docStudent()).cls,cur=await readDoc(cls,id);
    if(!cur)throw Error('서류 신청을 찾지 못했습니다');
    const was=docWas(cur),pick=['접수','처리중'].find(s=>s!==cur.status)||'접수';
    const [x,y]=await Promise.all([send('b2DocUpdate',{id,status:pick,memo:DOC_MEMO,link:'',fixReason:'',was}),send('b2DocUpdate',{id,status:'보완 필요',memo:DOC_MEMO,link:'',fixReason:`${REASON} 보완 요청 시험`,was})]);
    const r=[await settle(x),await settle(y)];out.push({id:'c',label:'서류 처리 둘이 같은 화면 값으로 저장',pass:r.filter(v=>v==='ok').length===1&&r.filter(v=>v==='conflict').length===1,results:r});
   }catch(e){out.push({id:'c',label:'서류 처리 둘이 같은 화면 값으로 저장',pass:false,results:['error:'+errText(e)]});}}
  return {id:'conflicts',pass:out.every(x=>x.pass),checks:out};
 }

 // ---------- 4. 정리 ----------
 // 17반의 '[리허설]' 기록과 이번에 쓴 칸을 모두 지웁니다: 대조 메모 먼저 비우기 → portalSaveBatch 유형 ''(지우기, before = 지금 지문) → 반영 확인 → 다시 읽어 0줄인지.
 // 서류 신청(이번 것 + extraDocIds)은 '취소' + 비고 '[리허설] …'로 표시합니다(지우는 기능 없음).
 async function cleanup({extraDocIds=[]}={}){
  for(const id of extraDocIds)if(id)docIds.add(String(id));
  const target=b=>b.ledger.filter(r=>String(r.cls)===REHEARSAL_CLASS&&rehearsalTarget(r.cls,r.name)&&(isRehearsalRow(r)||keys.has(keyOf(r.cls,r.name,r.date))));
  let b=await bundle(),rows=target(b),memoCleared=0,deleted=0;const errors=[];
  log(`정리할 리허설 기록 ${rows.length}줄`);
  for(const r of rows.filter(r=>String(r.memo||'').trim())){try{await guarded('b2LedgerMemo',{cls:REHEARSAL_CLASS,name:r.name,date:r.date,memo:'',was:String(r.memo)});memoCleared++;}catch(e){errors.push(`메모 ${r.name} ${r.date}: ${errText(e)}`);}}
  for(let round=0;round<2&&rows.length;round++){
   if(round)log(`남은 ${rows.length}줄을 다시 지웁니다`);
   const ids=[];
   for(let i=0;i<rows.length;i+=opt.batchMax){
    const part=rows.slice(i,i+opt.batchMax).map(r=>({name:r.name,date:r.date,type:'',inT:'',outT:'',oa:'',ob:'',r:'',before:String(r.sig??'')}));
    try{const res=await guarded('portalSaveBatch',{cls:REHEARSAL_CLASS,items:part});if(res?.queued)ids.push(...(res.ids||[]));else deleted+=(res?.results||[]).filter(x=>x.ok).length;}catch(e){errors.push(`지우기: ${errText(e)}`);}
   }
   if(ids.length){const q=await waitQueue(ids);deleted+=q.done;}
   b=await bundle();rows=target(b);
  }
  const docs=[];
  for(const id of docIds){try{const who=await docStudent(),cur=await readDoc(who.cls,id);if(!cur){docs.push({id,ok:false,note:'목록에서 찾지 못함'});continue;}
   if(cur.status==='취소'&&cur.memo===DOC_MEMO){docs.push({id,ok:true,note:'이미 취소 표시'});continue;}
   await guarded('b2DocUpdate',{id,status:'취소',memo:DOC_MEMO,link:'',fixReason:'',was:docWas(cur)});docs.push({id,ok:true,note:'취소 표시'});}
   catch(e){docs.push({id,ok:false,note:errText(e)});}}
  return {id:'cleanup',pass:!rows.length&&!errors.length&&docs.every(d=>d.ok),left:rows.length,deleted,memoCleared,errors,docs,leftSamples:rows.slice(0,5).map(r=>`${r.name} ${r.date} ${r.type}`)};
 }
 return {teachers,admins,conflicts,cleanup,verify,waitQueue,docIds,keys,guarded,options:opt};
}

// 요약(화면 카드·settings/rehearsalLast): 시나리오마다 통과·핵심 숫자만(학생 이름 목록은 넣지 않음)
export function summarize(results,{by='',at=new Date().toISOString(),options={}}={}){
 const pick=r=>{if(!r)return null;const {id,pass}=r,o={id,pass};
  for(const k of ['total','accepted','failed','pending','p50','p95','acceptMs','appliedMs','missing','duplicates','left','deleted','memoCleared','memos'])if(r[k]!==undefined&&r[k]!==null)o[k]=r[k];
  if(r.errors?.length)o.errors=r.errors.slice(0,5);if(r.checks)o.checks=r.checks.map(c=>({id:c.id,label:c.label,pass:c.pass,results:c.results}));
  if(r.docs)o.docs=Array.isArray(r.docs)?r.docs.map(d=>({id:d.id,ok:d.ok,note:d.note})):{ok:r.docs.ok,id:r.docs.id||'',repeated:!!r.docs.repeated,...(r.docs.error?{error:r.docs.error}:{})};
  if(r.error)o.error=r.error;return o;};
 const list=SCENARIOS.map(([id,label])=>({label,...(pick(results[id])||{id,skipped:true})}));
 const ran=list.filter(x=>!x.skipped);
 return {at,by,options:{teachers:options.teachers,items:options.items,admins:options.admins,adminSaves:options.adminSaves},pass:ran.length>0&&ran.every(x=>x.pass),scenarios:list};
}
