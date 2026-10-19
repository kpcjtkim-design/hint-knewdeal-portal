import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckHereSync,rowCheckHereStatus,requestStatus,resultStatus,timeDeleteBlock,timeDeletePlan,REQUEST_KEYS,STATUS_ACTIONS,TYPE_FIRST} from '../../beta2-checkhere-sync.mjs';
import {holdKey,AUTO_TEXT} from '../../beta2-checkhere-core.mjs';
import {baseTag,isLiveRequest,tagOf} from '../../checkhere-live-core.mjs';
import {beta2RequestData} from '../../beta2-guard-core.mjs';
import {ATTEND_DELETE} from '../rules.mjs';

// 가상 학생만 씁니다. 가짜 Firestore 함수·시계·타이머로 동기화 모듈(설계 4.2 S1~S15)을 시험합니다.
const TODAY='2026-10-14',PAST='2026-10-13',CLS='2',ME='admin@example.com',NAME='가상학생';
const record=(x={})=>({id:'rec-1',version:'v1',classId:CLS,date:TODAY,name:NAME,phoneLast4:'1234',teacher:'가상담임',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',
 rawEntry:'09:02:11',entry:'09:02:11',exit:'18:00:05',entryMemo:'',exitMemo:'',outings:[],...x});
const row=(type,x={})=>({type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',...x});
const LATE=row('지각',{inT:'09:25'}),PRESENT=row('출석');
const settle=()=>new Promise(r=>setImmediate(r));

// st.today: 오늘(바꾸면 자정을 넘긴 것), st.others: 다른 가상 학생의 기록, st.hang: setDoc이 끝나지 않음(오프라인)
function harness({date=TODAY,today=TODAY,rec=record({date}),requests=[],confirm=()=>true,hasDraft=()=>false}={}){
 let t=Date.parse('2026-10-14T01:00:00Z'),seq=0,ids=0;const timers=new Map(),log=[],subs=[];
 const st={date,today,rec,others:{},rows:{},sigs:{},saveError:null,setDocError:null,withdrawError:null,hang:false,confirm,confirms:[],saves:[],releases:[],bundles:0};
 const fs={doc:(db,...p)=>({path:p.join('/')}),collection:(db,...p)=>({path:p.join('/')}),where:(field,op,value)=>({field,op,value}),query:(c,...where)=>({path:c.path,where}),serverTimestamp:()=>'SERVER_TIME',
  setDoc:async(ref,data)=>{if(st.setDocError)throw st.setDocError;log.push(['write',ref.path,data]);if(st.hang)await new Promise(()=>{});},
  onSnapshot:(ref,next,err)=>{const s={ref,next,err,on:true};subs.push(s);return ()=>{s.on=false;};}};
 const client={save:async r=>{st.saves.push(r);if(st.saveError)throw st.saveError;st.sigs[r.name]='sig-undo';return {sig:'sig-undo'};},
  release:async p=>{st.releases.push(p);return {released:1};},
  bundle:async(cls,opts)=>{st.bundles++;assert.equal(opts?.maxAge,0,'다시 보내기 전 변경 번호 확인');return {ledger:Object.entries(st.sigs).map(([name,sig])=>({cls,name,date:st.date,sig}))};}};
 const sync=createCheckHereSync({db:{},user:{email:ME},client,fs,
  withdraw:async id=>{log.push(['withdraw',id]);if(st.withdrawError)throw st.withdrawError;},
  getRecord:(c,d,n)=>c===CLS&&d===st.date?(n===NAME?st.rec:st.others[n]??null):null,getSig:(c,d,n)=>st.sigs[n]??'',getRow:(c,d,n)=>st.rows[n]??null,hasDraft,teacherOf:()=>'가상담임',
  now:()=>t,today:()=>st.today,setTimer:(f,ms)=>{const id=++seq;timers.set(id,{f,at:t+ms});return id;},clearTimer:id=>{timers.delete(id);},
  confirm:text=>{st.confirms.push(text);return st.confirm(text);},uuid:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`});
 const key=holdKey(CLS,date,NAME);
 const live=path=>subs.filter(s=>s.on&&s.ref.path===path);
 return {sync,st,log,subs,key,fs,
  get now(){return t;},
  writes:()=>log.filter(x=>x[0]==='write'),
  async advance(ms){const end=t+ms;for(;;){const due=[...timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;timers.delete(due[0]);t=Math.max(t,due[1].at);due[1].f();await settle();}t=end;await settle();},
  pushRequests(list){for(const s of live('checkhereRequests'))s.next({docs:list.map(({id,...d})=>({id,data:()=>d}))});},
  failRequests(e){for(const s of live('checkhereRequests'))s.err(e);},
  pushSetting(name,data){for(const s of live('settings/'+name))s.next({exists:()=>!!data,data:()=>data});},
  // 화면 저장 흐름: 저장 시작 → b2Save 성공 → afterSave
  save(prevRow,next,sig,{existedBefore=true,name=NAME}={}){const k=holdKey(CLS,date,name);sync.saveStarted(k);st.sigs[name]=sig;st.rows[name]=next;return sync.afterSave(k,{prevRow,row:next,sig,existedBefore});},
  async open(){await sync.setDay(CLS,date);this.pushRequests(requests);}
 };
}
const request=(x={})=>({id:'b2_old',classId:CLS,date:TODAY,name:NAME,phoneLast4:'1234',status:'pending',createdBy:ME,changes:{entryMemo:'지각_담임:가상담임(09:25)'},
 reason:`[실시간 베타] [2기 베타] ${AUTO_TEXT} · 지각 · 일반 출결 [기준:0123abcd]`,createdAt:{seconds:Date.parse('2026-10-14T00:59:00Z')/1000,nanoseconds:0},...x});

test('saving today sends exactly one request 3 seconds later, shaped for the rules and the guard',async()=>{
 const h=harness();await h.open();
 const captured=structuredClone(h.st.rec);
 let s=h.save(PRESENT,LATE,'sig-1');
 assert.deepEqual([s.kind,s.label,s.actions],['countdown','보내기 전 3초 · 되돌리기',['undo']]);
 assert.match(s.detail,/입실 09:25 · 입실 메모 「지각_담임:가상담임\(09:25\)」/);
 await h.advance(2000);assert.equal(h.sync.statusFor(h.key).label,'보내기 전 1초 · 되돌리기');
 await h.advance(999);assert.equal(h.writes().length,0);
 await h.advance(1);assert.equal(h.writes().length,1);
 const [,path,data]=h.writes()[0],id=path.split('/')[1];
 assert.match(path,/^checkhereRequests\/b2_[0-9a-f-]{36}$/);assert.equal(id.length,39);assert.match(id,/^[-\w]{16,80}$/,'연결 프로그램 요청 id 형식');
 assert.deepEqual(Object.keys(data).sort(),['changes','classId','createdAt','createdBy','date','name','phoneLast4','reason','status','updatedAt'],'규칙 허용 키만, deleteTimes 없음');
 assert.deepEqual(REQUEST_KEYS,['classId','date','name','phoneLast4','reason','changes']);
 assert.deepEqual({...data,reason:undefined},{classId:CLS,date:TODAY,name:NAME,phoneLast4:'1234',changes:{entry:'09:25:00',entryMemo:'지각_담임:가상담임(09:25)'},status:'pending',createdBy:ME,createdAt:'SERVER_TIME',updatedAt:'SERVER_TIME',reason:undefined});
 // [기준:…]은 저장 때 화면에 보인 기록으로 만듭니다(S2).
 assert.equal(data.reason,`[실시간 베타] ${AUTO_TEXT} · 지각 · 일반 출결 [기준:${baseTag(captured,['entry','entryMemo'])}]`);
 assert.equal(data.reason,data.reason.trim());assert.match(tagOf(data.reason),/^[0-9a-f]{8}$/);
 const stored=beta2RequestData(path,data);
 assert.match(stored.reason,/^\[실시간 베타\] \[2기 베타\] 출결대조 자동 · 지각 · /);assert.ok(isLiveRequest(stored));assert.equal(tagOf(stored.reason),tagOf(data.reason));
 assert.deepEqual([h.sync.statusFor(h.key).kind,h.sync.statusFor(h.key).label],['pending','승인 대기'],'구독에 보이기 전');
 await h.advance(30000);assert.equal(h.writes().length,1,'once');
 // 요청 상태를 따라갑니다.
 const t0=h.now,mine={id,...data,createdAt:{seconds:t0/1000,nanoseconds:0},updatedAt:{seconds:t0/1000,nanoseconds:0}};
 h.pushRequests([mine]);s=h.sync.statusFor(h.key);assert.deepEqual([s.kind,s.label,s.actions],['pending','승인 대기',['withdraw']]);
 // 중계는 읽기 전용이라 요청은 사람의 승인을 기다립니다(자동 처리 안내 없음).
 await h.advance(91000);assert.match(h.sync.statusFor(h.key).detail,/운영 포털 「반영 요청·승인」에서 승인해야 체크히어에 반영됩니다/);assert.doesNotMatch(h.sync.statusFor(h.key).detail,/자동 처리/);
 h.pushRequests([{...mine,status:'approved'}]);assert.equal(h.sync.statusFor(h.key).label,'승인됨 · 반영 대기');
 h.pushRequests([{...mine,status:'applying',updatedAt:{seconds:(h.now-181000)/1000,nanoseconds:0}}]);assert.equal(h.sync.statusFor(h.key).label,'반영 중 · 결과 확인 필요');
 h.pushRequests([{...mine,status:'verified',result:{message:'체크히어 반영·원본 확인·플랫폼 DB 저장 완료'}}]);
 s=h.sync.statusFor(h.key);assert.deepEqual([s.kind,s.label,s.tone],['verified','완료','ok'],'기록이 아직 새로 오지 않아도 완료');assert.match(s.detail,/저장 완료/);
 h.st.rec=record({version:'v2',entry:'09:25:00',entryMemo:'지각_담임:가상담임(09:25)'});assert.equal(h.sync.statusFor(h.key).label,'완료');
 // 완료 뒤 시트가 다시 바뀌면(다른 경로) 지금 값으로 계산한 맞추기 버튼
 h.st.rows[NAME]=row('지각',{inT:'09:40'});h.st.sigs[NAME]='sig-other';assert.equal(h.sync.statusFor(h.key).label,'체크히어 맞추기');
});

test('undo within 3 seconds writes nothing and saves the previous sheet row back with the new sig',async()=>{
 const h=harness();await h.open();
 h.save(row('조퇴',{outT:'16:00',reason:'가상 사유',ev:'확인'}),LATE,'sig-1');
 await h.advance(1500);
 const r=await h.sync.undo(h.key);assert.equal(r.ok,true);
 assert.deepEqual(h.st.saves,[{cls:CLS,name:NAME,date:TODAY,type:'조퇴',inT:'',outT:'16:00',oa:'',ob:'',reason:'가상 사유',ev:'확인',evr:'',before:'sig-1'}]);
 assert.equal(h.sync.statusFor(h.key).label,'체크히어 반영 취소 · 출결원장도 되돌림');
 await h.advance(10000);assert.equal(h.writes().length,0);assert.deepEqual(h.sync.holds(),[]);
 // 기록이 없던 학생은 '출석'으로 되돌립니다(시트에 출석 행이 남음, 결과는 같음).
 h.save(null,LATE,'sig-2',{existedBefore:false});await h.sync.undo(h.key);
 assert.deepEqual(h.st.saves[1],{cls:CLS,name:NAME,date:TODAY,type:'출석',inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',before:'sig-2'});
 // 되돌리기 저장이 충돌하면 보내지도 않고 알립니다.
 h.st.saveError=Object.assign(Error('그사이 다른 사람이 이 기록을 바꿨습니다.'),{code:'CONFLICT'});
 h.save(PRESENT,LATE,'sig-3');const bad=await h.sync.undo(h.key);
 assert.equal(bad.ok,false);assert.equal(bad.error.code,'CONFLICT');assert.equal(h.sync.statusFor(h.key).label,'되돌리지 못함 · 최신 값 확인');
 await h.advance(10000);assert.equal(h.writes().length,0);
 assert.deepEqual(await h.sync.undo(h.key),{ok:false,reason:'되돌릴 반영 대기가 없습니다'},'nothing left to undo');
 // 보내는 중에는 되돌리지 못하고 이유를 돌려줍니다(화면이 그 행에 알림).
 h.st.saveError=null;h.st.hang=true;h.save(PRESENT,LATE,'sig-4');await h.advance(3000);
 assert.equal(h.sync.statusFor(h.key).label,'보내는 중');
 assert.match((await h.sync.undo(h.key)).reason,/이미 보내는 중입니다/);
});

test('undo of a previous value the sheet would reject only cancels the request (S9)',async()=>{
 const h=harness();await h.open();
 // 운영총괄에서 온 '중복' 행: b2Save가 받지 않는 유형이라 출결원장은 되돌리지 않고, 3초 동안 그렇게 알립니다.
 let s=h.save(row('중복',{reason:'가상 사유'}),LATE,'sig-1');
 assert.equal(s.kind,'countdown');assert.match(s.detail,/되돌리기는 체크히어 반영만 취소 \(이전 유형 '중복'은 출결원장에 다시 저장할 수 없음\)/);
 const r=await h.sync.undo(h.key);assert.deepEqual([r.ok,r.kept],[true,"이전 유형 '중복'"]);
 assert.equal(h.st.saves.length,0);assert.equal(h.sync.statusFor(h.key).label,'체크히어 반영 취소 · 출결원장은 그대로');
 // 시간 없는 지각·사유 없는 인정·반려 사유 없는 반려도 같습니다.
 for(const prev of [row('지각'),row('인정출석'),row('인정출석',{reason:'가상 병원',ev:'반려'})]){
  h.save(prev,row('조퇴',{outT:'16:00'}),'sig-2');assert.equal((await h.sync.undo(h.key)).ok,true);
 }
 assert.equal(h.st.saves.length,0);await h.advance(10000);assert.equal(h.writes().length,0);
 // 운영총괄에서 온 행(출처 '1기 동기화')이면 되돌리기가 '운영총괄 값으로'(b2Release)로 출결원장도 되살립니다.
 s=h.save(row('중복',{reason:'가상 사유',prov:'1기 동기화'}),row('조퇴',{outT:'16:00'}),'sig-3');
 assert.match(s.detail,/되돌리기는 출결원장을 운영총괄 값으로/);
 const back=await h.sync.undo(h.key);assert.deepEqual([back.ok,back.released],[true,true]);
 assert.deepEqual(h.st.releases.at(-1),{cls:CLS,name:NAME,date:h.st.date});assert.equal(h.st.saves.length,0);
 assert.equal(h.sync.statusFor(h.key).label,'체크히어 반영 취소 · 출결원장은 운영총괄 값으로');assert.equal(h.writes().length,0);
 // 입력 중이라 멈춘 3초도 되돌릴 수 있습니다.
 let draft=true;const d=harness({hasDraft:()=>draft});await d.open();
 d.save(PRESENT,LATE,'sig-1');await d.advance(3000);
 s=d.sync.statusFor(d.key);assert.deepEqual([s.label,s.actions],['입력 중 · 체크히어 반영 대기',['undo']]);
 assert.equal((await d.sync.undo(d.key)).ok,true);assert.equal(d.st.saves.at(-1).type,'출석');
 draft=false;await d.advance(5000);assert.equal(d.writes().length,0);
});

test('past days are never sent automatically; 체크히어 맞추기 runs the same 3-second flow',async()=>{
 const h=harness({date:PAST});await h.open();
 let s=h.save(PRESENT,LATE,'sig-1');
 assert.deepEqual([s.kind,s.label,s.actions],['suggest','체크히어 맞추기',['suggest']]);assert.equal(STATUS_ACTIONS.suggest,'체크히어 맞추기');
 await h.advance(10000);assert.equal(h.writes().length,0);assert.deepEqual(h.sync.holds(),[]);
 s=h.sync.suggest(h.key);assert.equal(s.kind,'countdown');
 await h.advance(3000);assert.equal(h.writes().length,1);
 assert.equal(h.writes()[0][2].date,PAST);assert.match(h.writes()[0][2].reason,/출결대조 자동 · 지각 · /);
 // 저장 직후의 맞추기는 그 저장을 이어받아 되돌리기가 출결원장도 되돌립니다.
 h.save(LATE,row('조퇴',{outT:'16:00'}),'sig-2');h.sync.suggest(h.key);await h.sync.undo(h.key);
 assert.equal(h.st.saves.at(-1).type,'지각');assert.equal(h.st.saves.at(-1).before,'sig-2');
 // 이 세션에서 저장하지 않은 행의 맞추기(지금 시트 값으로 계산)는 요청만 취소합니다.
 const k=harness({date:PAST});await k.open();k.st.rows[NAME]=LATE;k.st.sigs[NAME]='sig-x';
 assert.equal(k.sync.statusFor(k.key).label,'체크히어 맞추기','지금 시트와 체크히어로 계산');
 k.sync.suggest(k.key);assert.deepEqual(await k.sync.undo(k.key),{ok:true});
 assert.equal(k.st.saves.length,0);assert.equal(k.sync.statusFor(k.key).label,'체크히어 반영 취소');
 await k.advance(5000);assert.equal(k.writes().length,0);
});

test('sheet-only and unchanged saves never send automatically',async()=>{
 const h=harness();await h.open();
 // 인정 아닌 유형의 사유만 바꿈 → 자동 없음, 체크히어가 다르면 맞추기 버튼
 let s=h.save(row('지각',{inT:'09:25',reason:'교통'}),row('지각',{inT:'09:25',reason:'버스'}),'sig-1');
 assert.equal(s.kind,'suggest');await h.advance(10000);assert.equal(h.writes().length,0);
 // 증빙만 바꿈 + 체크히어가 이미 같음
 h.st.rec=record({entry:'09:25:10',rawEntry:'09:25:10',entryMemo:'지각_담임:가상담임(09:25)'});
 s=h.save(row('지각',{inT:'09:25',ev:''}),row('지각',{inT:'09:25',ev:'확인'}),'sig-2');
 assert.deepEqual([s.kind,s.label],['same','체크히어 이미 같음']);
 // 기록 없던 학생을 출석으로 저장(b2Save unchanged): 보류를 만들지 않음
 h.sync.saveStarted(h.key);s=h.sync.afterSave(h.key,{prevRow:null,row:PRESENT,sig:'',existedBefore:false,unchanged:true});
 assert.deepEqual(h.sync.holds(),[]);await h.advance(10000);assert.equal(h.writes().length,0);
});

test('overlapping saves pause the countdown, keep the first previous row, and a failed save cancels (S4)',async()=>{
 const h=harness();await h.open();
 h.save(PRESENT,LATE,'sig-1');await h.advance(1000);
 h.sync.saveStarted(h.key);assert.equal(h.sync.statusFor(h.key).label,'저장 중 · 체크히어 반영 대기');
 await h.advance(8000);assert.equal(h.writes().length,0,'b2Save가 오래 걸려도 예전 결정이 나가지 않음');
 h.st.sigs[NAME]='sig-2';h.sync.afterSave(h.key,{prevRow:LATE,row:row('조퇴',{outT:'16:00'}),sig:'sig-2'});
 assert.equal(h.sync.statusFor(h.key).label,'보내기 전 3초 · 되돌리기');
 await h.advance(2999);assert.equal(h.writes().length,0);await h.advance(1);
 assert.deepEqual(h.writes().map(w=>w[2].changes),[{exit:'16:00:00',exitMemo:'조퇴_담임:가상담임(16:00)'}]);
 // 되돌리기는 처음 저장 전 값으로
 h.save(PRESENT,LATE,'sig-3');h.sync.saveStarted(h.key);h.st.sigs[NAME]='sig-4';h.sync.afterSave(h.key,{prevRow:LATE,row:row('조퇴',{outT:'16:00'}),sig:'sig-4'});
 await h.sync.undo(h.key);assert.deepEqual([h.st.saves.at(-1).type,h.st.saves.at(-1).before],['출석','sig-4']);
 // 겹친 저장이 원래 값으로 돌아오면 보낼 것이 없습니다.
 h.save(PRESENT,LATE,'sig-5');h.sync.saveStarted(h.key);h.st.sigs[NAME]='sig-6';h.sync.afterSave(h.key,{prevRow:LATE,row:PRESENT,sig:'sig-6'});
 assert.deepEqual(h.sync.holds(),[]);
 // 저장 실패 → 보류 취소
 h.save(PRESENT,LATE,'sig-7');h.sync.saveStarted(h.key);h.sync.saveFailed(h.key,Error('네트워크'));
 assert.equal(h.sync.statusFor(h.key).label,'저장 실패로 체크히어 반영 안 함');
 await h.advance(10000);assert.equal(h.writes().length,1);
});

test('right before sending: a changed sheet cancels, a changed record recomputes and shows 3 seconds again (S3)',async()=>{
 const h=harness();await h.open();
 h.save(PRESENT,LATE,'sig-1');await h.advance(1000);h.st.sigs[NAME]='sig-other';await h.advance(2000);
 let s=h.sync.statusFor(h.key);assert.deepEqual([s.label,s.actions],['시트가 그사이 바뀜 · 요청 안 보냄',['retry']]);assert.equal(h.writes().length,0);
 h.save(PRESENT,LATE,'sig-2');await h.advance(2000);
 const v2=record({version:'v2',entryMemo:'가상 메모'});h.st.rec=v2;await h.advance(1000);
 assert.equal(h.writes().length,0);assert.equal(h.sync.statusFor(h.key).label,'보내기 전 3초 · 되돌리기');
 await h.advance(3000);assert.equal(h.writes().length,1);
 assert.equal(tagOf(h.writes()[0][2].reason),baseTag(v2,['entry','entryMemo']),'새 기록으로 다시 만든 기준');
 // 행에 아직 저장하지 않은 초안이 있으면 기다립니다(초안을 버리면 이어서 보냄).
 let draft=false;const d=harness({hasDraft:()=>draft});await d.open();
 d.save(PRESENT,LATE,'sig-1');draft=true;await d.advance(3000);
 assert.equal(d.sync.statusFor(d.key).label,'입력 중 · 체크히어 반영 대기');await d.advance(5000);assert.equal(d.writes().length,0);
 draft=false;await d.advance(1000);assert.equal(d.writes().length,1);
});

test('a save before the request list arrives waits for it, then counts down',async()=>{
 const h=harness();await h.sync.setDay(CLS,TODAY);
 assert.equal(h.save(PRESENT,LATE,'sig-1').label,'보류 · 체크히어 요청 목록 확인 중');
 await h.advance(5000);assert.equal(h.writes().length,0);
 h.pushRequests([]);assert.equal(h.sync.statusFor(h.key).label,'보내기 전 3초 · 되돌리기');
 await h.advance(3000);assert.equal(h.writes().length,1);
 // 저장이 멈춘 뒤 시트가 그대로인 저장(unchanged)이면 3초를 다시 시작합니다.
 h.save(LATE,row('조퇴',{outT:'16:00'}),'sig-2');h.sync.saveStarted(h.key);
 h.sync.afterSave(h.key,{prevRow:null,row:PRESENT,sig:'sig-2',existedBefore:false,unchanged:true});
 assert.equal(h.sync.statusFor(h.key).kind,'countdown');await h.advance(3000);assert.equal(h.writes().length,2);
});

test('in-progress requests: my pending auto request is withdrawn first; others hold until they finish (S6·S7)',async()=>{
 // 지각 → 조퇴: 대기 중인 내 자동 요청(지각 메모)을 취소한 뒤 보냄
 const h=harness({requests:[request()]});await h.open();
 let s=h.save(LATE,row('조퇴',{outT:'16:00'}),'sig-1');assert.match(s.detail,/대기 중인 자동 요청 취소/);
 await h.advance(3000);
 assert.deepEqual(h.log.map(x=>x[0]==='write'?['write',x[2].changes]:x),[['withdraw','b2_old'],['write',{exit:'16:00:00',exitMemo:'조퇴_담임:가상담임(16:00)'}]]);
 // 지각 → 출석(되돌림): 취소만 하고 보낼 것 없음
 const b=harness({requests:[request()]});await b.open();
 b.save(LATE,PRESENT,'sig-1');await b.advance(3000);
 assert.deepEqual(b.log,[['withdraw','b2_old']]);b.pushRequests([request({status:'withdrawn'})]);assert.equal(b.sync.statusFor(b.key).label,'체크히어 이미 같음');
 // 취소가 실패하면 보류하고, 내 대기 요청이라 '요청 취소'를 보입니다.
 const f=harness({requests:[request()]});await f.open();f.st.withdrawError=Error('이미 승인되었거나 처리 상태가 바뀌어');
 f.save(LATE,row('조퇴',{outT:'16:00'}),'sig-1');await f.advance(3000);
 s=f.sync.statusFor(f.key);assert.equal(f.writes().length,0);assert.equal(s.kind,'hold');assert.match(s.label,/취소하지 못함/);assert.deepEqual(s.actions,['withdraw']);
 // 다른 사람의 진행 중 요청 → 보류, 3초 없음. 그 요청이 반려되면 시트를 다시 확인하고 새 3초로 보냄
 const o=harness({requests:[request({id:'other_1',createdBy:'other@example.com'})]});await o.open();
 s=o.save(PRESENT,LATE,'sig-1');assert.deepEqual([s.kind,s.label,s.actions],['hold','보류 · 진행 중 요청이 끝나면 다시 계산해 요청',[]]);
 await o.advance(10000);assert.equal(o.writes().length,0);assert.equal(o.st.bundles,0);
 o.pushRequests([request({id:'other_1',createdBy:'other@example.com',status:'rejected',reviewNote:'가상 반려'})]);await settle();
 assert.equal(o.st.bundles,1);assert.equal(o.sync.statusFor(o.key).kind,'countdown','미뤄 둔 전송도 새 3초');
 await o.advance(3000);assert.equal(o.writes().length,1);
 // 반영 완료로 끝나면 기록 버전이 바뀐 뒤 다시 계산
 const v=harness({requests:[request({id:'other_2',createdBy:'other@example.com',status:'applying'})]});await v.open();
 v.save(PRESENT,LATE,'sig-1');v.pushRequests([request({id:'other_2',createdBy:'other@example.com',status:'verified',result:{message:'완료'}})]);await settle();
 assert.equal(v.st.bundles,0);assert.equal(v.sync.statusFor(v.key).kind,'hold');
 v.st.rec=record({version:'v2'});v.sync.recordsChanged();await settle();
 assert.equal(v.st.bundles,1);await v.advance(3000);assert.equal(v.writes().length,1);
 // 미뤄 둔 사이 시트가 바뀌면 버림
 const c=harness({requests:[request({id:'other_3',createdBy:'other@example.com'})]});await c.open();
 c.save(PRESENT,LATE,'sig-1');c.st.sigs[NAME]='sig-later';c.pushRequests([request({id:'other_3',createdBy:'other@example.com',status:'withdrawn'})]);await settle();
 assert.equal(c.sync.statusFor(c.key).label,'시트가 그사이 바뀜 · 요청 안 보냄');await c.advance(5000);assert.equal(c.writes().length,0);
 // 내 승인 대기 직접 요청(자동 아님) → 보류 + 요청 취소 버튼
 const m=harness({requests:[request({id:'mine_direct',reason:'[2기 베타] 가상 직접 요청'})]});await m.open();
 s=m.save(PRESENT,LATE,'sig-1');assert.deepEqual([s.kind,s.actions],['hold',['withdraw']]);
 assert.equal(await m.sync.withdraw(m.key),true);assert.deepEqual(m.log,[['withdraw','mine_direct']]);
});

test('changing class or date asks whether to send waiting decisions now (S10)',async()=>{
 const h=harness();await h.open();
 h.save(PRESENT,LATE,'sig-1');await h.advance(1000);
 const out=await h.sync.setDay(CLS,PAST);
 assert.deepEqual(h.st.confirms,['체크히어 반영 대기 1건을 지금 보낼까요?']);assert.equal(out.sent,1);
 assert.equal(h.writes().length,1,'3초를 기다리지 않고 저장해 둔 반·날짜로 보냄');assert.equal(h.writes()[0][2].date,TODAY);
 const q=h.subs.filter(s=>s.on&&s.ref.path==='checkhereRequests');
 assert.equal(q.length,1);assert.deepEqual(q[0].ref.where,[{field:'classId',op:'==',value:CLS},{field:'date',op:'==',value:PAST}],'orderBy 없음');
 assert.equal(h.subs.filter(s=>s.ref.path.startsWith('settings/')).length,2,'settings는 한 번만 구독');
 // 아니오 → 보내지 않음
 const n=harness({confirm:()=>false});await n.open();
 n.save(PRESENT,LATE,'sig-1');const r=await n.sync.setDay('3',TODAY);
 assert.deepEqual(r,{sent:0,cancelled:1,stopped:[],unconfirmed:[]});assert.deepEqual(n.sync.holds(),[]);await n.advance(10000);assert.equal(n.writes().length,0);
 assert.equal(n.sync.statusFor(n.key).kind,'idle','다른 반·날짜의 결과를 보이지 않음(S1)');
 // 보류가 없으면 묻지 않음
 const e=harness();await e.open();await e.sync.setDay(CLS,PAST);assert.deepEqual(e.st.confirms,[]);
 // 진행 중 요청을 기다리던 보류는 보낼 수 없어 멈추고, 조용히 사라지지 않게 그 학생을 돌려줍니다(화면이 알림).
 const w=harness({requests:[request({id:'other_1',createdBy:'other@example.com'})]});await w.open();
 w.save(PRESENT,LATE,'sig-1');assert.equal(w.sync.holds()[0].phase,'waiting');
 assert.deepEqual(await w.sync.setDay(CLS,PAST),{sent:0,cancelled:1,stopped:[NAME],unconfirmed:[]});assert.deepEqual(w.st.confirms,[]);
 // 보낼 것과 기다리는 것이 함께 있으면 확인창에 둘 다 셉니다.
 const b=harness({requests:[request({id:'other_2',name:'가상둘',phoneLast4:'5678',createdBy:'other@example.com'})]});b.st.others['가상둘']=record({id:'rec-2',name:'가상둘',phoneLast4:'5678'});await b.open();
 b.save(PRESENT,LATE,'sig-1');b.save(PRESENT,LATE,'sig-2',{name:'가상둘'});
 const both=await b.sync.setDay(CLS,PAST);
 assert.deepEqual(b.st.confirms,['체크히어 반영 대기 1건을 지금 보낼까요?\n(진행 중 요청·기록을 기다리는 1건은 보내지 못하고 멈춥니다)']);
 assert.deepEqual([both.sent,both.stopped],[1,['가상둘']]);assert.deepEqual(b.writes().map(x=>x[2].name),[NAME]);
});

test('a broken request subscription turns waiting saves into 다시 보내기 and subscribes again',async()=>{
 const h=harness();await h.sync.setDay(CLS,TODAY);
 assert.equal(h.save(PRESENT,LATE,'sig-1').label,'보류 · 체크히어 요청 목록 확인 중');
 h.failRequests(Object.assign(Error('가상 네트워크 끊김'),{code:'unavailable'}));
 let s=h.sync.statusFor(h.key);assert.deepEqual([s.label,s.actions],['체크히어 요청 목록을 읽지 못함 · 다시 보내기',['retry']]);
 assert.deepEqual(h.sync.holds(),[]);assert.equal(h.sync.relay().requestsError,'가상 네트워크 끊김');
 const before=h.subs.filter(x=>x.ref.path==='checkhereRequests').length;
 // 다시 보내기 → 다시 구독하고 목록을 기다렸다가 3초
 s=h.sync.retry(h.key);assert.equal(s.label,'보류 · 체크히어 요청 목록 확인 중');
 assert.equal(h.subs.filter(x=>x.ref.path==='checkhereRequests').length,before+1);
 h.pushRequests([]);assert.equal(h.sync.statusFor(h.key).kind,'countdown');await h.advance(3000);assert.equal(h.writes().length,1);
 // 같은 날 setDay(화면 새로고침)도 끊긴 구독을 다시 겁니다.
 h.failRequests(Error('가상 권한'));await h.sync.setDay(CLS,TODAY);
 assert.equal(h.subs.filter(x=>x.on&&x.ref.path==='checkhereRequests').length,1);assert.equal(h.sync.relay().requestsError,'');
});

test('write errors: permission-denied without deletions is a plain send failure with 다시 보내기 (S13)',async()=>{
 const h=harness();await h.open();
 h.st.setDocError=Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});
 h.save(PRESENT,LATE,'sig-1');await h.advance(3000);
 let s=h.sync.statusFor(h.key);assert.deepEqual([s.kind,s.label,s.actions,s.tone],['error','보내지 못함 · 다시 보내기',['retry'],'bad']);
 assert.equal(h.writes().length,0);assert.doesNotMatch(h.sync.gate().reasons.join(),/아직 게시되지 않았습니다/,'삭제 요청이 아니면 삭제를 끄지 않음');
 h.st.setDocError=null;s=h.sync.retry(h.key);assert.equal(s.kind,'countdown','지금 시트 값으로 다시 계산');
 await h.advance(3000);assert.equal(h.writes().length,1);
});

// 켜지는 조건(G1 규칙 게시 깃발, 중계는 필요 없음 2026-10-16)과 능력(마지막 중계 신호)을 가짜 settings 문서로 넣습니다. gateOn은 옛 연결 프로그램(v1: 퇴실만),
// gateOnV2는 두 칸 삭제(time-delete-v2)를 아는 연결 프로그램. privacy는 중계 신호의 체크히어 해제 상태(없으면 옛 중계 → 모름).
const gateOn=(h,caps=['time-delete-v1'],privacy)=>{h.pushSetting('checkhereFeatures',{timeDeleteRules:true});h.pushSetting('checkhereRelay',{state:'running',at:{seconds:h.now/1000,nanoseconds:0},capabilities:caps,...(privacy?{privacy}:{})});};
const gateOnV2=(h,privacy)=>gateOn(h,['time-delete-v1','time-delete-v2'],privacy);
// 체크인한 학생: 1교시는 입실에서 계산(PASS, 번호 없음), 퇴실만 기록 번호가 있음 / 관리자가 1교시를 넣은 학생: ATTEND 번호 있음
const CHECKED_IN={entryKind:'PASS',entryEventId:false,exitEventId:true,enterEventId:true},ADMIN_ENTRY={entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false};
// 옛 연결 프로그램(v1)이면 관리자 1교시는 지우지 않음. 퇴실이 남아 있으면 1교시만은 못 지움(체크히어가 퇴실 시간으로 다시 채움, rules.mjs)
const V2_NEEDED='1교시 삭제는 수집 PC 프로그램 업데이트 후 가능 (time-delete-v2)',EXIT_FIRST='퇴실이 남아 있으면 1교시만 지울 수 없습니다(체크히어가 퇴실 시간으로 1교시를 다시 채웁니다). 퇴실과 함께 지워 주세요.';
const BOTH_LEFT='1교시·퇴실 칸은 비워지고 체크히어 입실 기록은 남을 수 있습니다',UNMASK=/반영할 때 체크히어 마스킹 해제 필요/;
// 두 칸(1교시·퇴실)을 한 요청으로 지울 때의 확인창 문구(사용자 결정 2026-10-19 "둘 다 삭제돼야 함")
const BOTH_CELLS='퇴실과 1교시(09:00~18:00 칸)를 함께 지웁니다. 입실 기록은 남을 수 있습니다',BOTH_CELLS_RE=/\n퇴실과 1교시\(09:00~18:00 칸\)를 함께 지웁니다\. 입실 기록은 남을 수 있습니다\.\n/;
test('결석 holds while time deletion is off; with the gate on it asks first (S8), 아니오 writes nothing, 예 writes one deleteTimes request',async()=>{
 const h=harness();await h.open();
 let s=h.save(PRESENT,row('결석'),'sig-1');
 assert.deepEqual([s.kind,s.label],['hold','보류 · 체크히어 시간 삭제는 Firestore 규칙 게시·수집 PC 업데이트 후 가능']);
 await h.advance(10000);assert.equal(h.writes().length,0);
 assert.equal(h.sync.gate().enabled,false);assert.match(h.sync.gate().reasons.join(),/규칙 게시 필요/);
 const sent=await h.sync.send(h.key,{deleteTimes:['exit']});assert.equal(sent.ok,false);assert.ok(sent.reasons.length);assert.equal(h.st.confirms.length,0,'꺼져 있으면 묻지도 않음');
 // 깃발이 있어도 닿은 중계 신호의 연결 프로그램이 시간 삭제를 모르면 꺼짐(업데이트 안내)
 h.pushSetting('checkhereFeatures',{timeDeleteRules:true});h.pushSetting('checkhereRelay',{state:'running',at:{seconds:h.now/1000,nanoseconds:0},capabilities:['incremental-sync-v1']});
 assert.deepEqual(h.sync.gate(),{enabled:false,reasons:['수집 PC 프로그램 업데이트 필요 (time-delete-v2)'],v2:false});
 // 켬: 체크인한 학생은 퇴실만 지움(퇴실을 지우면 1교시도 함께 비워짐), 입실 기록은 남음
 const g=harness({rec:record(CHECKED_IN)});await g.open();gateOn(g);
 assert.equal(g.sync.gate().enabled,true);
 const captured=structuredClone(g.st.rec);
 g.st.confirm=()=>false;s=g.save(PRESENT,row('결석'),'sig-1');
 assert.equal(s.kind,'countdown');assert.match(s.detail,/퇴실 \(삭제\)/);assert.match(s.detail,/체크히어 실제 입실 기록은 남습니다/);
 assert.equal(g.st.confirms.length,0,'확인창은 3초 뒤 보내기 직전에');
 await g.advance(3000);
 assert.equal(g.st.confirms.length,1);assert.match(g.st.confirms[0],/가상학생 · 2026-10-14 체크히어 시간 삭제를 요청합니다: 퇴실 18:00/);assert.match(g.st.confirms[0],/관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에서 지워집니다/);
 assert.match(g.st.confirms[0],/퇴실을 지우면 1교시\(09:02\)와 총 참여 시간도 비워집니다/);assert.match(g.st.confirms[0],/체크히어 실제 입실 기록은 남습니다/);
 assert.deepEqual([g.sync.statusFor(g.key).label,g.writes().length],['체크히어 시간 삭제 취소',0],'아니오: 쓰기 0');
 g.st.confirm=()=>true;g.save(row('결석'),PRESENT,'sig-2');g.save(PRESENT,row('결석'),'sig-3');await g.advance(3000);
 assert.equal(g.writes().length,1);
 const [,path,data]=g.writes()[0];
 assert.deepEqual(Object.keys(data).sort(),['changes','classId','createdAt','createdBy','date','deleteTimes','name','phoneLast4','reason','status','updatedAt'],'deleteTimes 키는 삭제 요청에만');
 assert.deepEqual([data.changes,data.deleteTimes],[{exit:''},['exit']],'PASS 1교시는 지우지 않음');
 assert.equal(data.reason,`[실시간 베타] ${AUTO_TEXT} · 결석 · 일반 출결 [기준:${baseTag(captured,['exit'])}]`,'[기준]은 지우는 퇴실을 덮음');
 const stored=beta2RequestData(path,data);assert.ok(isLiveRequest(stored));assert.deepEqual(stored.deleteTimes,['exit']);
 // 관리자가 넣은 1교시(ATTEND 번호)와 옛 연결 프로그램(v1): 예전처럼 결석은 보류, 퇴실만 지우는 일부 삭제도 보내지 않음(퇴실도 남는다고 알림)
 const a=harness({rec:record(ADMIN_ENTRY)});await a.open();gateOn(a);
 assert.equal(a.save(PRESENT,row('결석'),'sig-1').label,'보류 · '+V2_NEEDED+' · 퇴실도 그대로 둡니다(퇴실만 지우려면 ×)');
 await a.advance(5000);assert.deepEqual([a.writes().length,a.st.confirms.length],[0,0]);
 // 퇴실 기록 번호가 없으면(다시 수집 전) 보류
 const n=harness({rec:record({entryKind:'PASS'})});await n.open();gateOn(n);
 assert.equal(n.save(PRESENT,row('결석'),'sig-1').label,'보류 · 퇴실 기록 번호를 확인하지 못했습니다(다시 수집 필요).');
 await n.advance(5000);assert.deepEqual([n.writes().length,n.st.confirms.length],[0,0]);
});

test('a deletion that had to wait is never sent automatically, and permission-denied turns deletion off for the session (S8·S13)',async()=>{
 // 다른 사람의 진행 중 요청 때문에 미뤄 둔 결석: 그 요청이 끝나도 확인 없이 보내지 않고 '체크히어 맞추기'만 남김
 const h=harness({rec:record(CHECKED_IN),requests:[request({id:'other_1',createdBy:'other@example.com',changes:{exitMemo:'가상'}})]});await h.open();gateOn(h);
 assert.equal(h.save(PRESENT,row('결석'),'sig-1').kind,'hold');
 h.st.sigs[NAME]='sig-1';h.pushRequests([request({id:'other_1',createdBy:'other@example.com',changes:{exitMemo:'가상'},status:'rejected'})]);await settle();await h.advance(5000);
 assert.deepEqual([h.writes().length,h.st.confirms.length],[0,0]);assert.equal(h.sync.statusFor(h.key).label,'체크히어 맞추기');
 // 맞추기를 누르면 다시 3초 → 확인 → 보냄
 h.sync.suggest(h.key);await h.advance(3000);assert.equal(h.st.confirms.length,1);assert.equal(h.writes().length,1);
 // 규칙 미게시(권한 거절): 이 세션 동안 삭제를 끄고 이유를 보임(G3)
 const d=harness({rec:record(CHECKED_IN)});await d.open();gateOn(d);
 d.st.setDocError=Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});
 d.save(PRESENT,row('결석'),'sig-1');await d.advance(3000);
 assert.deepEqual([d.sync.statusFor(d.key).kind,d.sync.statusFor(d.key).label],['denied','시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다']);
 assert.equal(d.sync.gate().enabled,false);assert.match(d.sync.gate().reasons.join(),/시간 삭제용 Firestore 규칙이 아직 게시되지 않았습니다/);
 d.st.setDocError=null;d.save(row('결석'),PRESENT,'sig-2');d.save(PRESENT,row('결석'),'sig-3');
 assert.equal(d.sync.statusFor(d.key).kind,'hold','다시 결석으로 저장해도 보내지 않음');await d.advance(5000);assert.equal(d.writes().length,0);
});

test('× deletes one CheckHere time: gate, record numbers and the sheet type decide, it asks, counts down 3 seconds and undo only cancels the request',async()=>{
 const h=harness({rec:record(CHECKED_IN)});await h.open();
 // 꺼져 있음: 이유만, 확인창 없음
 let r=await h.sync.send(h.key,{deleteTimes:['exit']});assert.equal(r.ok,false);assert.match(r.reasons.join(),/Firestore 규칙 게시 필요/);assert.equal(h.st.confirms.length,0);
 gateOn(h);
 // PASS 1교시는 잠김(사용자 결정)
 r=await h.sync.send(h.key,{deleteTimes:['entry']});assert.deepEqual(r,{ok:false,reasons:['입실에서 계산된 1교시는 지울 수 없습니다. 퇴실을 지우면 함께 비워집니다.']});
 // 확인창 아니오: 아무것도 시작하지 않음
 h.st.confirm=()=>false;r=await h.sync.send(h.key,{deleteTimes:['exit']});assert.deepEqual(r,{ok:false,cancelled:true});assert.deepEqual(h.sync.holds(),[]);
 assert.match(h.st.confirms[0],/퇴실 18:00/);assert.match(h.st.confirms[0],/1교시\(09:02\)와 총 참여 시간도 비워집니다/);
 // 예 → 3초 → 되돌리기: 쓰기 없음, 출결원장 저장도 없음
 h.st.confirm=()=>true;r=await h.sync.send(h.key,{deleteTimes:['exit']});assert.equal(r.ok,true);
 let s=h.sync.statusFor(h.key);assert.deepEqual([s.kind,s.label],['countdown','보내기 전 3초 · 되돌리기']);assert.match(s.detail,/퇴실 \(삭제\)/);
 assert.deepEqual((await h.sync.send(h.key,{deleteTimes:['exit']})).reasons,['이 학생의 체크히어 반영 대기가 끝난 뒤 지워 주세요']);
 await h.advance(1500);assert.equal((await h.sync.undo(h.key)).ok,true);
 assert.deepEqual([h.sync.statusFor(h.key).label,h.st.saves.length],['체크히어 반영 취소',0]);await h.advance(5000);assert.equal(h.writes().length,0);
 // 다시 누르고 기다리면 정확히 1건: 출결대조 시간 삭제(자동 요청 표시 없음), [기준]은 그때 본 기록
 const captured=structuredClone(h.st.rec);
 await h.sync.send(h.key,{deleteTimes:['exit']});assert.equal(h.st.confirms.length,3);
 await h.advance(3000);assert.equal(h.st.confirms.length,3,'이미 확인받음');assert.equal(h.writes().length,1);
 const data=h.writes()[0][2];
 assert.deepEqual([data.changes,data.deleteTimes],[{exit:''},['exit']]);
 assert.equal(data.reason,`[실시간 베타] 출결대조 시간 삭제 · 퇴실 [기준:${baseTag(captured,['exit'])}]`);assert.doesNotMatch(data.reason,new RegExp(AUTO_TEXT));
 assert.deepEqual([h.sync.statusFor(h.key).kind,h.sync.statusFor(h.key).label],['pending','승인 대기']);
 // 진행 중 요청이 있으면 지우지 않음
 h.pushRequests([{id:h.writes()[0][1].split('/')[1],...data,createdAt:{seconds:h.now/1000,nanoseconds:0}}]);
 assert.deepEqual((await h.sync.send(h.key,{deleteTimes:['exit']})).reasons,['진행 중 요청이 끝난 뒤 다시 지워 주세요']);
});

test('× follows the sheet type and asks again when the record changes during the 3 seconds',async()=>{
 const h=harness({rec:record(ADMIN_ENTRY)});await h.open();gateOn(h);
 // 지각은 입실 시간을 출결원장이 쓰므로 유형부터(퇴실은 지울 수 있음). 조퇴는 반대. 1교시 ×는 그 이유도 함께 보임 — 옛 연결 프로그램(v1)이면 업데이트 안내가 먼저
 h.st.rows[NAME]=row('지각',{inT:'09:25'});
 assert.deepEqual((await h.sync.send(h.key,{deleteTimes:['entry']})).reasons,[V2_NEEDED,'유형을 먼저 바꿔 주세요 (결석으로 바꾸면 지울 수 있는 시간을 함께 지웁니다)']);
 h.st.rows[NAME]=row('인정조퇴',{outT:'16:00',reason:'병원'});
 assert.match((await h.sync.send(h.key,{deleteTimes:['exit']})).reasons.join(),/유형을 먼저 바꿔 주세요/);
 h.st.rows[NAME]=row('출석');
 assert.deepEqual((await h.sync.send(h.key,{deleteTimes:['entry']})).reasons,[V2_NEEDED]);assert.equal(h.st.confirms.length,0);
 assert.equal((await h.sync.send(h.key,{deleteTimes:['exit']})).ok,true);assert.equal(h.st.confirms.length,1);
 // 3초 안에 기록이 바뀜(다시 수집): 새 기록으로 3초를 다시 보이고, 보내기 직전에 다시 물음(S3·S8)
 h.st.rec=record({...ADMIN_ENTRY,version:'v2',exit:'17:55:00'});await h.advance(3000);
 assert.equal(h.sync.statusFor(h.key).kind,'countdown');assert.equal(h.writes().length,0);
 h.st.confirm=()=>false;await h.advance(3000);
 assert.equal(h.st.confirms.length,2);assert.match(h.st.confirms[1],/퇴실 17:55/);
 const s=h.sync.statusFor(h.key);assert.deepEqual([s.label,s.actions],['체크히어 시간 삭제 취소',[]],'× 결정은 ×를 다시 눌러야 함');assert.equal(h.writes().length,0);
});

test('front conditions keep the sheet save and only show why (date range, missing record, partial record)',async()=>{
 const far=harness({date:'2026-10-23',today:'2026-10-23'});await far.open();
 assert.equal(far.save(PRESENT,LATE,'sig-1').label,'보류 · 규칙 날짜 범위 밖 · 넓히려면 사용자 확인 필요');
 // 기록이 아직 없음(아침 첫 수집 전·다시 읽는 중): '기록 없음'으로 끝내지 않고 기록이 오면 다시 계산해 새 3초
 const none=harness({rec:null});await none.open();
 let s=none.save(PRESENT,LATE,'sig-1');assert.deepEqual([s.kind,s.label,none.sync.holds()[0]?.retryWhen],['hold','보류 · 체크히어 기록 없음 · 기록이 오면 다시 계산해 요청','record']);
 await none.advance(10000);assert.equal(none.writes().length,0);
 none.st.rec=record();none.sync.recordsChanged();await settle();
 assert.equal(none.st.bundles,1);assert.equal(none.sync.statusFor(none.key).kind,'countdown');await none.advance(3000);assert.equal(none.writes().length,1);
 // 결석·출석은 기록이 없으면 체크히어에 할 일이 없어 기다리지 않음(안 온 학생마다 대기가 쌓이지 않게)
 const absent=harness({rec:null});await absent.open();
 assert.deepEqual([absent.save(PRESENT,row('결석'),'sig-1').kind,absent.sync.holds().length],['none',0]);
 // 상세 수집 전 기록 → 보류, 수집이 끝나면 다시 계산해 새 3초
 const part=harness({rec:record({readState:'partial'})});await part.open();
 assert.equal(part.save(PRESENT,LATE,'sig-1').label,'보류 · 체크히어 상세 수집 대기');
 part.st.rec=record({version:'v2'});part.sync.recordsChanged();await settle();
 assert.equal(part.sync.statusFor(part.key).kind,'countdown');await part.advance(3000);assert.equal(part.writes().length,1);
});

test('relay signal, subscriptions and dispose',async()=>{
 const h=harness();
 assert.equal(h.sync.relay().on,false);
 await h.open();
 assert.deepEqual(h.subs.map(s=>s.ref.path).sort(),['checkhereRequests','settings/checkhereFeatures','settings/checkhereRelay']);
 h.pushSetting('checkhereRelay',{state:'running',at:{seconds:(h.now-120000)/1000,nanoseconds:0},capabilities:['incremental-sync-v1'],busy:false,queue:0});
 assert.deepEqual([h.sync.relay().on,h.sync.relay().text],[true,'수집 PC 중계 작동 중 · 신호 2분 전']);
 h.pushSetting('checkhereRelay',{state:'running',at:{seconds:(h.now-4*60000)/1000,nanoseconds:0}});
 // 꺼짐: 자동 수집과 해제 표시만 멈춤. 요청은 만들고 반영은 승인 때. 삭제 조건(규칙 게시 깃발)이 맞을 때만 '삭제 요청은 가능'
 assert.deepEqual([h.sync.relay().on,h.sync.relay().text,h.sync.relay().privacy],[false,'중계 꺼짐 · 자동 수집·해제 표시 없음 (요청은 가능, 반영은 승인 때)',null]);
 h.pushSetting('checkhereFeatures',{timeDeleteRules:true});
 assert.equal(h.sync.relay().text,'중계 꺼짐 · 자동 수집·해제 표시 없음 (삭제 요청은 가능, 반영은 승인 때)');
 h.pushSetting('checkhereRelay',null);assert.deepEqual([h.sync.relay().on,h.sync.gate()],[false,{enabled:true,reasons:[],v2:true}],'문서 없으면 꺼짐 · 삭제는 v2로 켜짐');
 h.save(PRESENT,LATE,'sig-1');assert.equal(h.sync.holds().length,1);
 h.sync.dispose();assert.ok(h.subs.every(s=>!s.on));assert.deepEqual(h.sync.holds(),[]);
 await h.advance(10000);assert.equal(h.writes().length,0);
});

test('flushAll sends countdowns now and drops decisions still waiting (S15)',async()=>{
 const h=harness({requests:[request({id:'other_1',createdBy:'other@example.com'})]});await h.open();
 h.save(PRESENT,LATE,'sig-1');assert.equal(h.sync.holds()[0].phase,'waiting');
 const w=harness();await w.open();w.save(PRESENT,LATE,'sig-1');
 assert.deepEqual(await w.sync.flushAll(),{sent:1,skipped:0,stopped:[],unconfirmed:[]});assert.equal(w.writes().length,1);
 assert.deepEqual(await h.sync.flushAll(),{sent:0,skipped:1,stopped:[NAME],unconfirmed:[]});assert.equal(h.writes().length,0);assert.deepEqual(h.sync.holds(),[]);
 // 떠날 때: 먼저 모든 타이머를 멈추고 기다리던 보류를 끝낸 뒤 보냅니다. 쓰기가 끝나지 않아도(오프라인) 구독을 끊어, 기다리던 보류가 혼자 나가지 않습니다.
 const blocker=request({id:'other_2',name:'가상둘',phoneLast4:'5678',createdBy:'other@example.com'});
 const l=harness({requests:[blocker]});l.st.others['가상둘']=record({id:'rec-2',name:'가상둘',phoneLast4:'5678'});await l.open();
 l.save(PRESENT,LATE,'sig-1');l.save(PRESENT,LATE,'sig-2',{name:'가상둘'});
 assert.deepEqual(l.sync.holds().map(x=>[x.name,x.phase,x.sendable]),[[NAME,'countdown',true],['가상둘','waiting',false]]);
 l.st.hang=true;let done=false;void l.sync.flushAll({leave:true}).then(()=>{done=true;});await settle();
 assert.deepEqual(l.writes().map(x=>x[2].name),[NAME]);assert.ok(l.subs.every(x=>!x.on),'구독 끊김');
 assert.deepEqual(l.sync.holds().map(x=>[x.name,x.phase]),[[NAME,'sending']],'기다리던 보류는 먼저 끝냄');
 l.pushRequests([{...blocker,status:'rejected'}]);await l.advance(10000);
 assert.equal(done,false);assert.deepEqual(l.writes().map(x=>x[2].name),[NAME],'기다리던 학생은 떠난 뒤에도 보내지 않음');
});

test('a missing record, a newer record or a new day never freezes the chip or sends a stale decision',async()=>{
 // 3초 동안 기록을 다시 읽는 중(새로고침): '기록 없음'으로 끝내지 않고 기록이 돌아오면 다시 계산
 const h=harness();await h.open();
 h.save(PRESENT,LATE,'sig-1');await h.advance(1000);h.st.rec=null;await h.advance(2000);
 assert.equal(h.writes().length,0);assert.equal(h.sync.statusFor(h.key).label,'보류 · 체크히어 기록 다시 읽는 중');
 h.st.rec=record();h.sync.recordsChanged();await settle();
 assert.equal(h.sync.statusFor(h.key).kind,'countdown');await h.advance(3000);assert.equal(h.writes().length,1);
 // 결과 안내(이미 같음·기록 없음)는 체크히어 기록이 바뀌면 버리고 지금 값으로 계산(맞추기 버튼)
 const same=harness({rec:record({entry:'09:25:10',rawEntry:'09:25:10',entryMemo:'지각_담임:가상담임(09:25)'})});await same.open();
 assert.equal(same.save(PRESENT,LATE,'sig-1').label,'체크히어 이미 같음');
 same.st.rec=record({version:'v9',entry:'09:25:10',rawEntry:'09:25:10',entryMemo:''});
 let s=same.sync.statusFor(same.key);assert.deepEqual([s.label,s.actions],['체크히어 맞추기',['suggest']]);
 const past=harness({date:PAST,rec:null});await past.open();
 assert.equal(past.save(PRESENT,LATE,'sig-1').kind,'none');
 past.st.rec=record({date:PAST});assert.equal(past.sync.statusFor(past.key).label,'체크히어 맞추기','기록이 온 뒤에는 맞추기');
 // 미뤄 둔 자동 요청이 자정을 넘기면 보내지 않고 맞추기만 남김(오늘만 자동)
 const n=harness({requests:[request({id:'other_1',createdBy:'other@example.com'})]});await n.open();
 n.save(PRESENT,LATE,'sig-1');n.st.today='2026-10-15';
 n.pushRequests([request({id:'other_1',createdBy:'other@example.com',status:'rejected'})]);await settle();
 s=n.sync.statusFor(n.key);assert.deepEqual([s.kind,s.label],['suggest','체크히어 맞추기']);
 await n.advance(10000);assert.equal(n.writes().length,0);
 n.sync.suggest(n.key);await n.advance(3000);assert.equal(n.writes().length,1,'누르면 보냄');assert.equal(n.writes()[0][2].date,TODAY);
 // 3초가 도는 사이 자정을 넘김 → 보내지 않음
 const m=harness();await m.open();m.save(PRESENT,LATE,'sig-1');m.st.today='2026-10-15';await m.advance(3000);
 assert.equal(m.writes().length,0);assert.equal(m.sync.statusFor(m.key).label,'체크히어 맞추기');
});

test('a verified blocker waits until its change shows in the record, not just any newer version (S7)',async()=>{
 const other={id:'other_v',createdBy:'other@example.com',status:'applying',changes:{exitMemo:'가상 퇴실 메모'}};
 const h=harness({requests:[request(other)]});await h.open();
 h.save(PRESENT,LATE,'sig-1');
 // 다른 이유(10분 갱신)로 버전이 먼저 바뀐 뒤 반영 완료가 옴 → 그 변경이 기록에 보일 때까지 기다림
 h.st.rec=record({version:'v1b',exit:'18:00:09'});h.sync.recordsChanged();
 h.pushRequests([request({...other,status:'verified',result:{message:'완료'}})]);await settle();
 assert.equal(h.st.bundles,0);assert.equal(h.sync.statusFor(h.key).label,'보류 · 체크히어 반영 확인 뒤 다시 계산');
 h.st.rec=record({version:'v2',exitMemo:'가상 퇴실 메모'});h.sync.recordsChanged();await settle();
 assert.equal(h.st.bundles,1);assert.equal(h.sync.statusFor(h.key).kind,'countdown');await h.advance(3000);assert.equal(h.writes().length,1);
 // 반영된 기록이 상태보다 먼저 오면 바로 계산
 const f=harness({requests:[request(other)]});await f.open();f.save(PRESENT,LATE,'sig-1');
 f.st.rec=record({version:'v2',exitMemo:'가상 퇴실 메모'});f.sync.recordsChanged();
 f.pushRequests([request({...other,status:'verified',result:{message:'완료'}})]);await settle();
 assert.equal(f.st.bundles,1);assert.equal(f.sync.statusFor(f.key).kind,'countdown');
});

test('a blocker that ends during a save waits for that save and keeps the first previous row (S4·S7)',async()=>{
 const o=harness({requests:[request({id:'other_1',createdBy:'other@example.com'})]});await o.open();
 o.save(PRESENT,LATE,'sig-1');o.sync.saveStarted(o.key);o.st.sigs[NAME]='sig-2';
 o.pushRequests([request({id:'other_1',createdBy:'other@example.com',status:'rejected'})]);await settle();
 assert.equal(o.st.bundles,0,'저장 중에는 다시 계산하지 않음');assert.equal(o.sync.holds()[0].phase,'waiting');
 o.sync.afterSave(o.key,{prevRow:LATE,row:row('조퇴',{outT:'16:00'}),sig:'sig-2'});
 assert.equal(o.sync.statusFor(o.key).kind,'countdown');
 await o.sync.undo(o.key);assert.deepEqual([o.st.saves.at(-1).type,o.st.saves.at(-1).before],['출석','sig-2'],'처음 저장 전 값으로 되돌림');
});

test('체크히어 맞추기 after an evidence-only save never reverts that sheet edit on undo',async()=>{
 const h=harness();await h.open();
 const s=h.save(row('지각',{inT:'09:25',ev:''}),row('지각',{inT:'09:25',ev:'확인'}),'sig-1');assert.equal(s.kind,'suggest');
 assert.equal(h.sync.suggest(h.key).kind,'countdown');
 assert.deepEqual(await h.sync.undo(h.key),{ok:true});assert.equal(h.st.saves.length,0,'증빙 저장은 그대로');
 assert.equal(h.sync.statusFor(h.key).label,'체크히어 반영 취소');await h.advance(5000);assert.equal(h.writes().length,0);
});

test('status chip labels (pure)',()=>{
 const now=Date.parse('2026-10-14T03:00:00Z'),at=ms=>({seconds:(now-ms)/1000,nanoseconds:0}),r=(status,x={})=>({id:'q1',status,createdBy:ME,createdAt:at(10000),updatedAt:at(10000),...x});
 const label=x=>{const s=requestStatus(x,{now,me:ME});return [s.label,s.actions,s.detail];};
 assert.deepEqual(label(r('pending')),['승인 대기',['withdraw'],'']);
 assert.match(label(r('pending',{createdAt:at(91000)}))[2],/승인해야 체크히어에 반영됩니다\(자동으로 쓰지 않음\)/);
 assert.deepEqual(label(r('pending',{createdBy:'other@example.com'}))[1],[]);
 assert.equal(label(r('approved'))[0],'승인됨 · 반영 대기');
 assert.equal(label(r('applying'))[0],'반영 중');
 assert.deepEqual(label(r('applying',{updatedAt:at(181000)})).slice(0,1).concat(label(r('applying',{updatedAt:at(181000)}))[2]),['반영 중 · 결과 확인 필요','결과 확인 필요 · 수집 PC에서 결과 확인']);
 assert.deepEqual(label(r('verified',{result:{message:'가상 완료'}})),['완료',[],'가상 완료']);
 assert.deepEqual(label(r('rejected',{reviewNote:'가상 반려'})),['반려',['retry'],'가상 반려']);
 for(const [s,l] of [['conflict','원본 변경'],['partial','일부 반영'],['failed','반영 실패'],['unknown','결과 미확인']])assert.deepEqual(label(r(s,{result:{message:'m'}})),[l,['retry'],'m']);
 assert.deepEqual(label(r('withdrawn')),['취소',[],'']);
 // 보류 항목이 가장 앞, 진행 중 요청은 대조 결과보다 앞
 assert.equal(rowCheckHereStatus({local:{phase:'countdown',deadline:now+2100},request:r('verified'),now}).label,'보내기 전 3초 · 되돌리기');
 assert.equal(rowCheckHereStatus({local:{phase:'sending'},now}).label,'보내는 중');
 assert.equal(rowCheckHereStatus({local:{phase:'waiting',note:'담임 이름 확인'},now}).label,'보류 · 담임 이름 확인');
 const same={...resultStatus({state:'same',notes:['체크히어 이미 같음'],warnings:[],withdraw:[]}),at:now};
 assert.equal(rowCheckHereStatus({request:r('pending'),target:same,now,me:ME}).label,'승인 대기');
 assert.equal(rowCheckHereStatus({request:r('failed'),target:same,now}).label,'체크히어 이미 같음','이 세션의 더 새 결과');
 assert.equal(rowCheckHereStatus({request:r('failed'),target:{...same,at:now-60000},now}).label,'반영 실패');
 const lazy={...resultStatus({state:'send',changes:{entryMemo:'x'},notes:[],warnings:[],withdraw:[]}),lazy:true};
 const done=r('verified',{changes:{entryMemo:'가상 메모'}});
 assert.equal(rowCheckHereStatus({request:done,target:lazy,now,record:{entryMemo:'가상 메모'}}).label,'체크히어 맞추기','완료가 기록에 보인 뒤 다시 달라짐');
 assert.equal(rowCheckHereStatus({request:done,target:lazy,now,record:{entryMemo:''}}).label,'완료','기록이 아직 새로 오지 않음');
 assert.equal(rowCheckHereStatus({request:r('withdrawn'),target:lazy,now}).label,'체크히어 맞추기');
 assert.equal(rowCheckHereStatus({request:r('failed'),target:lazy,now}).label,'반영 실패');
 assert.equal(rowCheckHereStatus({target:lazy,now}).label,'체크히어 맞추기');
 assert.equal(rowCheckHereStatus({now}).kind,'idle');
 assert.deepEqual([resultStatus({state:'hold',notes:['가상 이유'],warnings:[],withdraw:[]}).label,resultStatus({state:'manual',notes:['중복 출결 · 개별 검토 필요'],warnings:[],withdraw:[]}).label,resultStatus({state:'none',notes:['체크히어 기록 없음 · 이름 연결 확인'],warnings:[],withdraw:[]}).label],['보류 · 가상 이유','중복 출결 · 개별 검토 필요','체크히어 기록 없음 · 이름 연결 확인']);
});

// 검토 반영: 지금 보내기(반·날짜 이동·떠남)는 확인창(S8)을 거치지 않은 시간 삭제를 보내지 않고, 그 학생을 따로 알립니다.
test('changing the day or leaving never sends a deletion that skipped its confirm (S8), and names that student',async()=>{
 const h=harness({rec:record(CHECKED_IN)});await h.open();gateOn(h);
 h.save(PRESENT,row('결석'),'sig-1');await h.advance(1000);
 assert.deepEqual(h.sync.holds().map(x=>[x.phase,x.sendable,x.needsConfirm]),[['countdown',true,true]]);
 const out=await h.sync.setDay(CLS,PAST);
 assert.deepEqual(h.st.confirms,[],'nothing else to send: no question');
 assert.deepEqual(out,{sent:0,cancelled:1,stopped:[],unconfirmed:[NAME]});assert.equal(h.writes().length,0);
 // 보낼 것과 함께면 그 수에서 빼고 따로 적음. '예'여도 삭제는 보내지 않음
 const b=harness({rec:record(CHECKED_IN)});b.st.others['가상둘']=record({id:'rec-2',name:'가상둘',phoneLast4:'5678'});await b.open();gateOn(b);
 b.save(PRESENT,row('결석'),'sig-1');b.save(PRESENT,LATE,'sig-2',{name:'가상둘'});
 const both=await b.sync.setDay(CLS,PAST);
 assert.deepEqual(b.st.confirms,['체크히어 반영 대기 1건을 지금 보낼까요?\n(확인창을 거치지 않은 체크히어 시간 삭제 1건은 보내지 않고 멈춥니다)']);
 assert.deepEqual([both.sent,both.unconfirmed],[1,[NAME]]);assert.deepEqual(b.writes().map(x=>x[2].name),['가상둘']);
 // 떠날 때(flushAll)도 같음
 const l=harness({rec:record(CHECKED_IN)});await l.open();gateOn(l);
 l.save(PRESENT,row('결석'),'sig-1');
 assert.deepEqual(await l.sync.flushAll({leave:true}),{sent:0,skipped:1,stopped:[],unconfirmed:[NAME]});assert.equal(l.writes().length,0);assert.deepEqual(l.st.confirms,[]);
 // ×는 이미 확인받았으므로 지금 보내기로 보냄
 const x=harness({rec:record(CHECKED_IN)});await x.open();gateOn(x);
 assert.equal((await x.sync.send(x.key,{deleteTimes:['exit']})).ok,true);assert.equal(x.sync.holds()[0].needsConfirm,false);
 assert.deepEqual(await x.sync.flushAll(),{sent:1,skipped:0,stopped:[],unconfirmed:[]});assert.deepEqual(x.writes()[0][2].deleteTimes,['exit']);
});

test('a × deletion that fails, is refused or is cancelled offers no 다시 보내기 (it would only recompute the sheet); 결석 deletions keep it',async()=>{
 const del={changes:{exit:''},deleteTimes:['exit']};
 const x=request({...del,reason:'[실시간 베타] [2기 베타] 출결대조 시간 삭제 · 퇴실 [기준:0123abcd]',status:'rejected',reviewNote:'가상 반려'});
 let s=requestStatus(x);assert.deepEqual([s.kind,s.actions],['rejected',[]]);assert.equal(s.detail,'가상 반려 · 체크히어 시간을 지우려면 ×를 다시 눌러 주세요');
 s=requestStatus({...x,status:'failed',result:{message:'가상 실패'}});assert.deepEqual(s.actions,[]);assert.match(s.detail,/×를 다시/);
 // 결석 저장이 만든 자동 삭제 요청은 다시 보내기가 결석을 다시 계산하므로 그대로
 s=requestStatus(request({...del,status:'rejected'}));assert.deepEqual(s.actions,['retry']);
 // 확인 완료: 플랫폼 저장이 완료 문구를 새로 써도 저장된 결과(results)로 삭제 확인을 붙여 보임
 s=requestStatus({...x,status:'verified',result:{message:'체크히어 반영·원본 확인·플랫폼 DB 저장 완료',results:[{field:'exit',state:'verified',deleted:true}]}});
 assert.deepEqual([s.kind,s.detail],['verified','체크히어 반영·원본 확인·플랫폼 DB 저장 완료 · 퇴실 시간 삭제 확인']);
 // × 3초 동안 시트가 바뀌어 멈춤: 다시 보내기 없이 ×를 다시
 const h=harness({rec:record(CHECKED_IN)});await h.open();gateOn(h);
 await h.sync.send(h.key,{deleteTimes:['exit']});h.st.sigs[NAME]='sig-changed';await h.advance(3000);
 s=h.sync.statusFor(h.key);assert.deepEqual([s.kind,s.actions],['cancelled',[]]);assert.match(s.detail,/×를 다시 눌러 주세요/);assert.equal(h.writes().length,0);
 // 쓰기 실패도 같음
 const f=harness({rec:record(CHECKED_IN)});await f.open();gateOn(f);f.st.setDocError=Error('가상 네트워크');
 await f.sync.send(f.key,{deleteTimes:['exit']});await f.advance(3000);
 s=f.sync.statusFor(f.key);assert.deepEqual([s.kind,s.label,s.actions],['error','보내지 못함',[]]);assert.equal(s.detail,'가상 네트워크 · 체크히어 시간을 지우려면 ×를 다시 눌러 주세요');
});

test('a hold note is dropped when the deletion gate or the record numbers change, so 체크히어 맞추기 appears',async()=>{
 // 꺼진 채 결석 → 보류. 켜지면 지금 값으로 다시 계산한 맞추기
 const h=harness({rec:record(CHECKED_IN)});await h.open();
 assert.equal(h.save(PRESENT,row('결석'),'sig-1').label,'보류 · 체크히어 시간 삭제는 Firestore 규칙 게시·수집 PC 업데이트 후 가능');
 gateOn(h);let s=h.sync.statusFor(h.key);assert.deepEqual([s.label,s.actions],['체크히어 맞추기',['suggest']]);
 // 표시 없는 기록 → 보류. 다시 수집해 같은 버전에 표시가 붙으면 맞추기
 const j=harness({rec:record()});await j.open();gateOn(j);
 assert.equal(j.save(PRESENT,row('결석'),'sig-1').label,'보류 · 퇴실 기록 번호를 확인하지 못했습니다(다시 수집 필요).');
 j.st.rec=record(CHECKED_IN);assert.equal(j.st.rec.version,'v1');
 s=j.sync.statusFor(j.key);assert.deepEqual([s.label,s.actions],['체크히어 맞추기',['suggest']]);
 // 결석이 아닌 결정의 안내는 게이트와 상관없이 남음
 const k=harness();await k.open();k.save(PRESENT,row('지각',{inT:'09:05'}),'sig-1');const held=k.sync.statusFor(k.key).label;gateOn(k);assert.equal(k.sync.statusFor(k.key).label,held);
});

test('× is refused outside enrolment and where the sheet type keeps its memo on the entry; the confirm names memos that go with the time',async()=>{
 const h=harness({rec:record({...ADMIN_ENTRY,entryMemo:'(인정출석)병원_담임:가상담임',exitMemo:'조퇴_담임:가상담임(17:00)'})});await h.open();gateOn(h);
 h.st.rows[NAME]={type:'해당없음'};
 assert.deepEqual(await h.sync.send(h.key,{deleteTimes:['exit']}),{ok:false,reasons:['재학 기간이 아닌 학생입니다']});
 for(const type of ['외출','인정외출','인정출석','인정지각'])assert.match((h.st.rows[NAME]=row(type),await h.sync.send(h.key,{deleteTimes:['entry']})).reasons.join(),/유형을 먼저 바꿔 주세요/,type);
 assert.deepEqual(h.st.confirms,[]);
 h.st.rows[NAME]=row('출석');h.st.confirm=()=>false;
 // 관리자 1교시 ×는 잠김(묻지도 않음, v1이라 업데이트 안내). 퇴실 ×는 그 칸의 관리자 사유도 함께 지워진다고 묻고, 1교시 칸은 말하지 않음(1교시와 입실은 남음)
 assert.deepEqual(await h.sync.send(h.key,{deleteTimes:['entry']}),{ok:false,reasons:[V2_NEEDED]});assert.deepEqual(h.st.confirms,[]);
 assert.deepEqual(await h.sync.send(h.key,{deleteTimes:['exit']}),{ok:false,cancelled:true});
 assert.match(h.st.confirms[0],/퇴실 칸의 관리자 사유\(「조퇴_담임:가상담임\(17:00\)」\)도 함께 지워집니다/);assert.doesNotMatch(h.st.confirms[0],/입실\(교시\)/);
 assert.match(h.st.confirms[0],/관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다/);
 // 체크인한 학생이 1교시에 사유를 저장해 ATTEND가 된 기록: v2면 1교시 ×도 퇴실과 함께 두 칸(사용자 결정 2026-10-19, 실제 입실은 남음)
 const r=harness({rec:record({...ADMIN_ENTRY,enterEventId:true})});await r.open();gateOnV2(r);
 assert.equal((await r.sync.send(r.key,{deleteTimes:['entry']})).ok,true);assert.match(r.st.confirms[0],BOTH_CELLS_RE);
 await r.advance(3000);assert.deepEqual([r.writes().length,r.writes()[0][2].deleteTimes],[1,['entry','exit']]);
});

// 두 칸 삭제(time-delete-v2, 2026-10-16 실제 체크히어 확인 뒤 켬): 결석은 관리자 1교시·퇴실을 한 요청으로(연결 프로그램이 퇴실 먼저),
// ×도 퇴실이 있으면 두 칸(2026-10-19, 아래 시험), 퇴실이 빈 1교시 ×는 1교시만. 옛 연결 프로그램(v1)이면 1교시는 잠김. 가린 화면이어도 요청은 만들고 확인창에 해제 필요를 붙임.
test('with time-delete-v2: 결석 deletes the admin 1st period with the exit, × on a 1st period without exit deletes it alone, asks again when the entry changes and names its memo',async()=>{
 assert.equal(ATTEND_DELETE,true);
 // 결석: 관리자가 넣은 1교시(ATTEND 번호)와 퇴실을 함께 지움(두 칸을 함께 지우고 입실 기록은 남을 수 있다고 알림)
 const a=harness({rec:record(ADMIN_ENTRY)});await a.open();gateOnV2(a);
 assert.equal(a.sync.gate().v2,true);
 a.save(PRESENT,row('결석'),'sig-1');await a.advance(3000);
 assert.match(a.st.confirms[0],/입실\(교시\) 09:02 · 퇴실 18:00/);assert.doesNotMatch(a.st.confirms[0],/총 참여 시간/);assert.match(a.st.confirms[0],BOTH_CELLS_RE);
 assert.match(a.st.confirms[0],UNMASK,'privacy를 모르면(옛 중계) 반영할 때 해제 필요를 붙임');
 assert.deepEqual([a.writes()[0][2].changes,a.writes()[0][2].deleteTimes],[{entry:'',exit:''},['entry','exit']]);
 // 퇴실이 남아 있으면 1교시 ×도 두 칸 요청(잠기지 않음, 2026-10-19)
 const x=harness({rec:record(ADMIN_ENTRY)});await x.open();gateOnV2(x);x.st.rows[NAME]=row('출석');
 assert.equal((await x.sync.send(x.key,{deleteTimes:['entry']})).ok,true);await x.advance(3000);
 assert.deepEqual([x.writes()[0][2].changes,x.writes()[0][2].deleteTimes],[{entry:'',exit:''},['entry','exit']]);
 // ×: 퇴실이 빈 관리자 1교시. 지각은 입실 시간을 출결원장이 쓰므로 유형부터. 출석이면 묻고, 3초 안에 1교시가 바뀌면 새 기록으로 다시 물음(S3·S8)
 const NO_EXIT={...ADMIN_ENTRY,exit:null,exitEventId:false};
 const h=harness({rec:record(NO_EXIT)});await h.open();gateOnV2(h);
 h.st.rows[NAME]=row('지각',{inT:'09:25'});
 assert.deepEqual((await h.sync.send(h.key,{deleteTimes:['entry']})).reasons,['유형을 먼저 바꿔 주세요 (결석으로 바꾸면 지울 수 있는 시간을 함께 지웁니다)']);
 h.st.rows[NAME]=row('출석');
 assert.equal((await h.sync.send(h.key,{deleteTimes:['entry']})).ok,true);assert.equal(h.st.confirms.length,1);assert.match(h.st.confirms[0],new RegExp(BOTH_LEFT));
 h.st.rec=record({...NO_EXIT,version:'v2',entry:'09:05:00'});await h.advance(3000);
 assert.equal(h.sync.statusFor(h.key).kind,'countdown');assert.equal(h.writes().length,0);
 h.st.confirm=()=>false;await h.advance(3000);
 assert.equal(h.st.confirms.length,2);assert.match(h.st.confirms[1],/입실\(교시\) 09:05/);assert.equal(h.writes().length,0);
 // 옛 연결 프로그램(v1): 퇴실이 비어 있어도 1교시는 잠김(예전 동작)
 const old=harness({rec:record(NO_EXIT)});await old.open();gateOn(old);old.st.rows[NAME]=row('출석');
 assert.deepEqual((await old.sync.send(old.key,{deleteTimes:['entry']})).reasons,[V2_NEEDED]);assert.deepEqual(old.st.confirms,[]);
 // 확인창은 1교시 칸의 관리자 사유도 함께 지워진다고 알리고, 가린 화면이면 '반영할 때 체크히어 마스킹 해제 필요'를 붙임(요청은 그대로 만듦)
 const m=harness({rec:record({...NO_EXIT,entryMemo:'(인정출석)병원_담임:가상담임'})});await m.open();gateOnV2(m,{state:'masked',leftSec:null,writable:false});
 assert.equal(m.sync.gate().enabled,true,'가림은 요청을 막지 않음');assert.match(m.sync.relay().text,/ · 체크히어 가림 · 읽기만$/);
 m.st.rows[NAME]=row('출석');m.st.confirm=()=>false;
 assert.deepEqual(await m.sync.send(m.key,{deleteTimes:['entry']}),{ok:false,cancelled:true});
 assert.match(m.st.confirms[0],/입실\(교시\) 칸의 관리자 사유\(「\(인정출석\)병원_담임:가상담임」\)도 함께 지워집니다/);
 assert.match(m.st.confirms[0],new RegExp(BOTH_LEFT));assert.doesNotMatch(m.st.confirms[0],/실제 입실 기록은 남습니다/);
 assert.match(m.st.confirms[0],/승인해야 체크히어에서 지워집니다\.\n반영할 때 체크히어 마스킹 해제 필요\.\n보낼까요\?$/);
 m.st.confirm=()=>true;assert.equal((await m.sync.send(m.key,{deleteTimes:['entry']})).ok,true);await m.advance(3000);
 assert.deepEqual([m.writes().length,m.writes()[0][2].deleteTimes],[1,['entry']],'가린 화면에서도 요청 1건(승인 대기)');
 // 해제됐고 남은 시간이 넉넉하면 덧붙이지 않음
 const u=harness({rec:record(CHECKED_IN)});await u.open();gateOnV2(u,{state:'unmasked',leftSec:900,writable:true});u.st.confirm=()=>false;
 await u.sync.send(u.key,{deleteTimes:['exit']});assert.doesNotMatch(u.st.confirms[0],UNMASK);assert.match(u.sync.relay().text,/체크히어 해제됨 · 15분 남음$/);
});

// 사용자 결정(2026-10-16): 삭제 요청은 중계 없이도 만듭니다. 능력은 마지막 중계 신호(오래되거나 멈춰도), 신호가 없으면 v2로 봄(반영 때 승인 화면이 다시 확인).
// 중계가 꺼져 해제 상태를 모르면 도구줄에 해제 표시가 없고, 확인창에는 '반영할 때 체크히어 마스킹 해제 필요'를 붙입니다.
test('without a running relay deletions are still requested: no signal means v2, a stale or stopped signal keeps its capabilities, and the confirm asks to unmask on apply',async()=>{
 const flagOnly=h=>h.pushSetting('checkhereFeatures',{timeDeleteRules:true});
 // 신호 없음: 관리자 1교시 학생 결석 → 두 칸 삭제 요청 1건(승인 대기)
 const a=harness({rec:record(ADMIN_ENTRY)});await a.open();flagOnly(a);
 assert.deepEqual(a.sync.gate(),{enabled:true,reasons:[],v2:true});
 assert.deepEqual([a.sync.relay().on,a.sync.relay().privacy,a.sync.relay().text],[false,null,'중계 꺼짐 · 자동 수집·해제 표시 없음 (삭제 요청은 가능, 반영은 승인 때)']);
 a.save(PRESENT,row('결석'),'sig-1');await a.advance(3000);
 assert.match(a.st.confirms[0],BOTH_CELLS_RE);assert.match(a.st.confirms[0],/승인해야 체크히어에서 지워집니다\.\n반영할 때 체크히어 마스킹 해제 필요\.\n보낼까요\?$/);
 assert.deepEqual([a.writes().length,a.writes()[0][2].changes,a.writes()[0][2].deleteTimes,a.writes()[0][2].status],[1,{entry:'',exit:''},['entry','exit'],'pending']);
 // 오래된(3분 넘음) v2 신호: 중계는 꺼짐이지만 능력은 v2 그대로. 신호의 해제 상태는 모름 → 퇴실 × 확인창에 해제 필요
 const s=harness({rec:record(CHECKED_IN)});await s.open();gateOnV2(s,{state:'unmasked',leftSec:900,writable:true});
 await s.advance(4*60000);
 assert.deepEqual([s.sync.relay().on,s.sync.relay().privacy,s.sync.gate()],[false,null,{enabled:true,reasons:[],v2:true}]);
 s.st.confirm=()=>false;assert.deepEqual(await s.sync.send(s.key,{deleteTimes:['exit']}),{ok:false,cancelled:true});assert.match(s.st.confirms[0],UNMASK);
 // 멈춘 v1 신호(옛 연결 프로그램, 하루 전): 퇴실만. 관리자 1교시 결석은 예전처럼 보류
 const o=harness({rec:record(ADMIN_ENTRY)});await o.open();flagOnly(o);
 o.pushSetting('checkhereRelay',{state:'stopped',at:{seconds:(o.now-86400000)/1000,nanoseconds:0},capabilities:['incremental-sync-v1','time-delete-v1']});
 assert.deepEqual(o.sync.gate(),{enabled:true,reasons:[],v2:false});
 assert.equal(o.save(PRESENT,row('결석'),'sig-1').label,'보류 · '+V2_NEEDED+' · 퇴실도 그대로 둡니다(퇴실만 지우려면 ×)');
 await o.advance(5000);assert.deepEqual([o.writes().length,o.st.confirms.length],[0,0]);
 // 닿은 신호인데 시간 삭제 능력이 없음: 오래돼도 꺼짐(업데이트 안내)
 o.pushSetting('checkhereRelay',{state:'stopped',at:{seconds:(o.now-86400000)/1000,nanoseconds:0},capabilities:['incremental-sync-v1']});
 assert.deepEqual(o.sync.gate(),{enabled:false,reasons:['수집 PC 프로그램 업데이트 필요 (time-delete-v2)'],v2:false});
 assert.equal(o.sync.relay().text,'중계 꺼짐 · 자동 수집·해제 표시 없음 (요청은 가능, 반영은 승인 때)');
});

// 사용자 결정(2026-10-19, 실제 체크히어 시험): 관리자 1교시(ATTEND) 학생의 퇴실 ×가 퇴실만 지우고 09:00~18:00 칸(1교시)을 남김 → "둘 다 삭제돼야 함".
// v2(또는 중계 신호 없음)면 퇴실 ×·1교시 × 모두 1교시·퇴실 두 칸 요청 1건(연결 프로그램이 퇴실 먼저 지우고 두 칸이 빈 것을 확인).
// 체크인 학생(PASS)의 퇴실 ×는 퇴실만(체크히어가 계산된 1교시를 함께 비움), 퇴실이 빈 1교시 ×는 1교시만, 옛 연결 프로그램(v1)이면 예전 동작.
test('2026-10-19: with time-delete-v2 one × clears both cells (the exit and the admin 1st period); PASS stays exit only; v1 is unchanged',async()=>{
 const ASK_BOTH=/체크히어 시간 삭제를 요청합니다: 입실\(교시\) 09:02 · 퇴실 18:00\n퇴실과 1교시\(09:00~18:00 칸\)를 함께 지웁니다\. 입실 기록은 남을 수 있습니다\.\n관리자가 운영 포털 「반영 요청·승인」에서 승인해야 체크히어에서 지워집니다\.\n/;
 const V1={enabled:true,reasons:[],v2:false},V2={enabled:true,reasons:[],v2:true};
 // 순수 계획(화면 ×의 켜짐·title도 같은 함수): 관리자 1교시 학생은 어느 ×든 두 칸, 이유 없음
 for(const side of ['exit','entry']){
  assert.deepEqual(timeDeletePlan({gate:V2,record:record(ADMIN_ENTRY),side}),{sides:['entry','exit'],reasons:[]},side);
  assert.deepEqual(timeDeleteBlock({gate:V2,record:record(ADMIN_ENTRY),side}),[],side+' × is on');
 }
 assert.deepEqual(timeDeletePlan({gate:V2,record:record(CHECKED_IN),side:'exit'}),{sides:['exit'],reasons:[]},'PASS: exit only');
 assert.deepEqual(timeDeletePlan({gate:V2,record:record(CHECKED_IN),side:'entry'}),{sides:['entry'],reasons:['입실에서 계산된 1교시는 지울 수 없습니다. 퇴실을 지우면 함께 비워집니다.']},'PASS 1교시 × stays locked');
 assert.deepEqual(timeDeletePlan({gate:V2,record:record({...ADMIN_ENTRY,exit:null,exitEventId:false}),side:'entry'}),{sides:['entry'],reasons:[]},'exit already empty: 1교시 only');
 assert.deepEqual(timeDeletePlan({gate:V1,record:record(ADMIN_ENTRY),side:'exit'}),{sides:['exit'],reasons:[]},'v1: exit only');
 assert.deepEqual(timeDeletePlan({gate:V1,record:record(ADMIN_ENTRY),side:'entry'}),{sides:['entry'],reasons:[V2_NEEDED]},'v1: 1교시 × locked with the existing reason');
 // 두 칸이면 두 칸 모두 출결원장 유형을 봅니다: 지각(입실을 씀)은 퇴실 ×도, 조퇴(퇴실을 씀)는 1교시 ×도 유형부터
 assert.deepEqual(timeDeletePlan({gate:V2,record:record(ADMIN_ENTRY),side:'exit',type:'지각'}).reasons,[TYPE_FIRST]);
 assert.deepEqual(timeDeletePlan({gate:V2,record:record(ADMIN_ENTRY),side:'entry',type:'조퇴'}).reasons,[TYPE_FIRST]);
 assert.deepEqual(timeDeletePlan({gate:V1,record:record(ADMIN_ENTRY),side:'exit',type:'지각'}).reasons,[],'v1: the exit × of a 지각 student stays as before');
 // 함께 지울 퇴실의 번호가 없으면 1교시 ×도 그 이유로 잠김. 1교시 번호가 없으면 퇴실 ×는 퇴실만(1교시가 남는다고 알림)
 assert.deepEqual(timeDeletePlan({gate:V2,record:record({...ADMIN_ENTRY,exitEventId:false}),side:'entry'}).reasons,['퇴실 기록 번호를 확인하지 못했습니다(다시 수집 필요).']);
 assert.deepEqual(timeDeletePlan({gate:V2,record:record({...ADMIN_ENTRY,entryEventId:false}),side:'exit'}),{sides:['exit'],reasons:[]});
 // 퇴실 ×: 확인창은 두 칸을 함께 지운다고 말하고, 요청 1건이 두 칸을 지움(출결원장 저장 없음)
 const e=harness({rec:record(ADMIN_ENTRY)});await e.open();gateOnV2(e);e.st.rows[NAME]=row('출석');
 const captured=structuredClone(e.st.rec);
 assert.equal((await e.sync.send(e.key,{deleteTimes:['exit']})).ok,true);
 assert.equal(e.st.confirms.length,1);assert.match(e.st.confirms[0],ASK_BOTH);assert.doesNotMatch(e.st.confirms[0],/관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다/);
 assert.match(e.st.confirms[0],/\n반영할 때 체크히어 마스킹 해제 필요\.\n보낼까요\?$/,'해제 상태를 모르면(옛 중계) 반영할 때 해제 필요 — 규칙 그대로');
 const s=e.sync.statusFor(e.key);assert.equal(s.kind,'countdown');assert.equal(s.detail,`입실 (삭제) · 퇴실 (삭제) · ${BOTH_CELLS}`);
 await e.advance(3000);assert.equal(e.writes().length,1);assert.equal(e.st.confirms.length,1,'이미 확인받음');
 const data=e.writes()[0][2];
 assert.deepEqual([data.changes,data.deleteTimes,data.status],[{entry:'',exit:''},['entry','exit'],'pending']);
 assert.equal(data.reason,`[실시간 베타] 출결대조 시간 삭제 · 입실(교시)·퇴실 [기준:${baseTag(captured,['entry','exit'])}]`);
 assert.equal(beta2RequestData(e.writes()[0][1],data).deleteTimes.length,2,'규칙·가드가 받는 모양');assert.equal(e.st.saves.length,0);
 // 1교시 ×(퇴실이 남음): 잠기지 않고 같은 두 칸 요청
 const n=harness({rec:record(ADMIN_ENTRY)});await n.open();gateOnV2(n,{state:'unmasked',leftSec:900,writable:true});n.st.rows[NAME]=row('출석');
 assert.equal((await n.sync.send(n.key,{deleteTimes:['entry']})).ok,true);assert.match(n.st.confirms[0],ASK_BOTH);assert.doesNotMatch(n.st.confirms[0],UNMASK,'해제됐고 시간이 넉넉하면 덧붙이지 않음');
 await n.advance(3000);assert.deepEqual([n.writes().length,n.writes()[0][2].changes,n.writes()[0][2].deleteTimes],[1,{entry:'',exit:''},['entry','exit']]);
 // 중계 신호가 없음(능력 목록 없음 → v2): 퇴실 ×도 두 칸
 const f=harness({rec:record(ADMIN_ENTRY)});await f.open();f.pushSetting('checkhereFeatures',{timeDeleteRules:true});f.st.rows[NAME]=row('출석');
 assert.equal((await f.sync.send(f.key,{deleteTimes:['exit']})).ok,true);await f.advance(3000);assert.deepEqual(f.writes()[0][2].deleteTimes,['entry','exit']);
 // 3초 안에 다시 수집해 기록이 바뀌면 지울 칸을 새 기록으로 다시 정하고 다시 물음(두 칸 그대로, 새 퇴실 시간)
 const c=harness({rec:record(ADMIN_ENTRY)});await c.open();gateOnV2(c);c.st.rows[NAME]=row('출석');
 assert.equal((await c.sync.send(c.key,{deleteTimes:['exit']})).ok,true);
 c.st.rec=record({...ADMIN_ENTRY,version:'v2',exit:'17:55:00'});await c.advance(3000);await c.advance(3000);
 assert.equal(c.st.confirms.length,2);assert.match(c.st.confirms[1],/요청합니다: 입실\(교시\) 09:02 · 퇴실 17:55\n퇴실과 1교시/);assert.deepEqual(c.writes()[0][2].deleteTimes,['entry','exit']);
 // 그사이 퇴실이 이미 지워졌으면(누른 퇴실 ×가 지울 것이 없음) 보내지 않고 멈춤 — 남은 1교시는 그 ×로 따로(1교시만)
 const g=harness({rec:record(ADMIN_ENTRY)});await g.open();gateOnV2(g);g.st.rows[NAME]=row('출석');
 assert.equal((await g.sync.send(g.key,{deleteTimes:['exit']})).ok,true);
 g.st.rec=record({...ADMIN_ENTRY,version:'v2',exit:null,exitEventId:false});await g.advance(3000);await g.advance(3000);
 assert.deepEqual([g.st.confirms.length,g.writes().length,g.sync.statusFor(g.key).label],[1,0,'보류 · 지울 시간이 없습니다.']);
 assert.deepEqual(timeDeletePlan({gate:V2,record:g.st.rec,side:'entry'}),{sides:['entry'],reasons:[]});
 // 지각 학생: 퇴실 ×도 1교시를 함께 지우므로 유형부터(묻지 않음, 쓰기 없음)
 const t=harness({rec:record(ADMIN_ENTRY)});await t.open();gateOnV2(t);t.st.rows[NAME]=row('지각',{inT:'09:25'});
 assert.deepEqual(await t.sync.send(t.key,{deleteTimes:['exit']}),{ok:false,reasons:[TYPE_FIRST]});assert.deepEqual(t.st.confirms,[]);
 // 체크인 학생(PASS): 퇴실 ×는 퇴실만(계산된 1교시가 함께 빈다고 알림)
 const p=harness({rec:record(CHECKED_IN)});await p.open();gateOnV2(p);
 assert.equal((await p.sync.send(p.key,{deleteTimes:['exit']})).ok,true);
 assert.match(p.st.confirms[0],/요청합니다: 퇴실 18:00\n퇴실을 지우면 1교시\(09:02\)와 총 참여 시간도 비워집니다\.\n체크히어 실제 입실 기록은 남습니다\./);assert.doesNotMatch(p.st.confirms[0],/함께 지웁니다/);
 await p.advance(3000);assert.deepEqual([p.writes()[0][2].changes,p.writes()[0][2].deleteTimes],[{exit:''},['exit']]);
 // 옛 연결 프로그램(v1): 퇴실 ×는 퇴실만(관리자 1교시는 남는다고 알림), 1교시 ×는 업데이트 안내로 잠김
 const o=harness({rec:record(ADMIN_ENTRY)});await o.open();gateOn(o);o.st.rows[NAME]=row('출석');
 assert.deepEqual(await o.sync.send(o.key,{deleteTimes:['entry']}),{ok:false,reasons:[V2_NEEDED]});assert.deepEqual(o.st.confirms,[]);
 assert.equal((await o.sync.send(o.key,{deleteTimes:['exit']})).ok,true);
 assert.match(o.st.confirms[0],/요청합니다: 퇴실 18:00\n관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다\./);assert.doesNotMatch(o.st.confirms[0],/함께 지웁니다/);
 await o.advance(3000);assert.deepEqual([o.writes()[0][2].changes,o.writes()[0][2].deleteTimes],[{exit:''},['exit']]);
});

// 확인창(S8)이 말한 칸과 보내는 칸은 같아야 합니다: 3초 동안 중계 신호의 능력이 바뀌어(v1 → v2: 연결 프로그램 업데이트, v2 → v1) 지울 칸이 달라지면
// 받은 확인을 버리고 새 칸으로 다시 묻습니다(아니오면 쓰기 없음). 지금 보내기(반·날짜 이동·떠남)면 묻지 않고 멈춥니다.
test('a confirmed × asks again when the capability changes during the 3 seconds and the cells to delete change (v1 → v2 widens, v2 → v1 narrows)',async()=>{
 const ASK_EXIT=/요청합니다: 퇴실 18:00\n관리자가 넣은 1교시와 체크히어 입실 기록은 남습니다\./,ASK_BOTH=/요청합니다: 입실\(교시\) 09:02 · 퇴실 18:00\n퇴실과 1교시\(09:00~18:00 칸\)를 함께 지웁니다\. 입실 기록은 남을 수 있습니다\./;
 // v1에서 퇴실만 확인 → 3초 안에 v2 신호 → 두 칸으로 다시 물음, 아니오면 보내지 않음
 const a=harness({rec:record(ADMIN_ENTRY)});await a.open();gateOn(a);a.st.rows[NAME]=row('출석');
 assert.equal((await a.sync.send(a.key,{deleteTimes:['exit']})).ok,true);assert.match(a.st.confirms[0],ASK_EXIT);
 gateOnV2(a);a.st.confirm=()=>false;await a.advance(3000);
 assert.equal(a.st.confirms.length,2);assert.match(a.st.confirms[1],ASK_BOTH);
 assert.deepEqual([a.writes().length,a.sync.statusFor(a.key).label],[0,'체크히어 시간 삭제 취소']);
 // 예면 다시 확인한 두 칸을 보냄
 const b=harness({rec:record(ADMIN_ENTRY)});await b.open();gateOn(b);b.st.rows[NAME]=row('출석');
 assert.equal((await b.sync.send(b.key,{deleteTimes:['exit']})).ok,true);
 gateOnV2(b);await b.advance(3000);
 assert.equal(b.st.confirms.length,2);assert.match(b.st.confirms[1],ASK_BOTH);
 assert.deepEqual([b.writes().length,b.writes()[0][2].changes,b.writes()[0][2].deleteTimes],[1,{entry:'',exit:''},['entry','exit']]);
 // v2에서 두 칸 확인 → 3초 안에 v1 신호 → 퇴실만으로 다시 물음(1교시가 남는다고 알림), 예면 퇴실만
 const c=harness({rec:record(ADMIN_ENTRY)});await c.open();gateOnV2(c);c.st.rows[NAME]=row('출석');
 assert.equal((await c.sync.send(c.key,{deleteTimes:['exit']})).ok,true);assert.match(c.st.confirms[0],ASK_BOTH);
 gateOn(c);await c.advance(3000);
 assert.equal(c.st.confirms.length,2);assert.match(c.st.confirms[1],ASK_EXIT);
 assert.deepEqual([c.writes().length,c.writes()[0][2].changes,c.writes()[0][2].deleteTimes],[1,{exit:''},['exit']]);
 // 지금 보내기: 칸이 바뀐 삭제는 묻지 않고 멈추고 그 학생 이름을 알림
 const d=harness({rec:record(ADMIN_ENTRY)});await d.open();gateOn(d);d.st.rows[NAME]=row('출석');
 assert.equal((await d.sync.send(d.key,{deleteTimes:['exit']})).ok,true);
 gateOnV2(d);
 assert.deepEqual(await d.sync.flushAll(),{sent:0,skipped:1,stopped:[],unconfirmed:[NAME]});
 assert.deepEqual([d.st.confirms.length,d.writes().length,d.sync.statusFor(d.key).label],[1,0,'시간 삭제는 확인 없이 보내지 않습니다']);
 // 능력이 바뀌어도 지울 칸이 같으면(체크인 학생의 퇴실 ×) 다시 묻지 않음
 const p=harness({rec:record(CHECKED_IN)});await p.open();gateOn(p);
 assert.equal((await p.sync.send(p.key,{deleteTimes:['exit']})).ok,true);
 gateOnV2(p);await p.advance(3000);
 assert.deepEqual([p.st.confirms.length,p.writes().length,p.writes()[0][2].deleteTimes],[1,1,['exit']]);
});

test('timesDeleted: the newest live request of the student is a verified deletion',async()=>{
 const h=harness();await h.open();
 assert.equal(h.sync.timesDeleted(h.key),false);
 const del=request({id:'b2_del',changes:{exit:''},deleteTimes:['exit'],status:'verified'});
 h.pushRequests([del]);assert.equal(h.sync.timesDeleted(h.key),true);
 h.pushRequests([{...del,status:'rejected'}]);assert.equal(h.sync.timesDeleted(h.key),false);
 h.pushRequests([del,request({id:'b2_new',status:'verified',createdAt:{seconds:Date.parse('2026-10-14T01:00:00Z')/1000,nanoseconds:0}})]);assert.equal(h.sync.timesDeleted(h.key),false,'a newer edit after the deletion');
});
