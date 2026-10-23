// 2기 베타 담임화면 (Vercel 운영포털 탭용 모듈)
// 사용: import { mountTeacherBeta } from './teacher-beta.js';
//       mountTeacherBeta(document.getElementById('beta-root'), { cls: 1, getToken: async () => idToken, endpoint: '/api/teacher-beta' });
// 화면·로직은 Apps Script 담임 포털과 동일. 데이터는 /api/teacher-beta → Apps Script → 마스터시트.
// Shadow DOM 안에 그려서 기존 포털 CSS와 서로 간섭하지 않습니다.
// 포털에 이미 있는 반 정보(머리글)·금주 시간표·만족도 집계는 기존 탭을 쓰고 여기서는 다시 그리지 않습니다.
// 사유 칸은 관리자 출결대조와 같은 공용 도우미(reason-pick.mjs, 사용자 2026-10-20 '담임화면에서도 사유 부분 드롭다운은 관리자 화면 급으로 동일하게 해주기. 기본적인 경고 사항도 바로 캐치 가능하게'):
// 사유 드롭다운 하나 + 종류가 있는 분류는 바로 옆 종류 드롭다운, '기타'는 직접 입력, 인정 출결이면 막힌 항목(자격증 X 종류·일반건강검진)은 고를 수 없고, 고르는 즉시 경고(인정 안 됨·관련성 확인·
// 교육일 아닌 날·취업박람회 추가 증빙·인정 출결 사유 없음)와 증빙 상태(보기만, 운영팀이 정함)가 보입니다. 취업박람회는 추가 증빙 알림.
// 시간 칸 없음(사용자 지시 2026-10-20 '담임화면 출결판에서 입퇴실 및 외출시간 입력하는건 빼줘. 다만 체크히어 메모 추천사유만 남겨둬'): 오른쪽 칸은 유형·사유(드롭다운, 빠른 사유)와
// 체크히어 메모 추천(복사)만. 입실·퇴실·외출 시간은 저장된 값을 보기만 하고, 저장할 때는 저장된 시간을 그대로 다시 보냅니다(portalSave는 빈 칸을 ''로 덮으므로).
// 아무 날짜 기록(사용자 결정 2026-10-20 '수정 자체는 언제든 유연하게'): 시트가 주는 날짜(portalData.days)는 오늘까지의 교육일이라, 교육일이 아닌 날·아직 오지 않은 날의
// 원장 기록(portalData.recs)은 출결판에 칸을 더해 보이고, 「다른 날짜」 칸으로 아무 날이나 열어 기록합니다(시트 출결판 탭에는 교육일만 나옴).
import {isIsoDate,isTrainingDay,DISEASE} from './cohort.mjs';
import {tidyReason,STANDARD,extraEvidence,extraEvidenceStarted,extraNotice,EXTRA_LABEL} from './attendance-reason-catalog.mjs';
import {reasonPickHtml,reasonNotesHtml,pickReasonText,kindInputText,diseaseUsed,diseaseFullText,isDiseaseReason} from './reason-pick.mjs';
import {DUP_TYPE,DUP_RULE,dupParts,sheetWait,isSheetBusy,sheetBusyText} from './beta2-core.mjs'; // '중복' 규칙(지각·조퇴·외출 가운데 둘 이상)·시트 업데이트 대기 안내는 관리자 출결대조와 같은 곳
export function mountTeacherBeta(el, OPT) {
  OPT = OPT || {};
  const R = el.shadowRoot || el.attachShadow({ mode: 'open' });
  R.innerHTML = '<style>' + TB_CSS + '</style><div id="app"></div><div class="toast" id="toast"></div>';
  // '해당없음'(현황 없음, 사용자 2026-10-20): 저장되는 출결 상태(시트 기호 '-', 회색 #E8EAED·#5F6368), 출석률·결석·총원에 넣지 않음. 예전처럼 '기록 지우기(입력 전)'가 아닙니다.
  // 기록이 없는 칸은 '입력 전'(값 '', 고를 수 없음). 기록 지우기는 오른쪽 칸 「기록 지우기」 → portalSave type ''(시트 v14 기준), '출석'은 출석 줄로 저장.
  // '중복'(사용자 2026-10-20 '중복(지+조+외) 이거 시트랑 담임이랑 관리자 넣어줘'): 한 날에 지각·조퇴·외출 가운데 둘 이상(1기 '중복(지각+조퇴+외출)'). 진한 주황 #F9CB9C·#783F04(시트와 같음).
  // 담임은 유형·사유만 고릅니다(시간은 보기만, 운영팀이 출결대조에서 체크히어 기록으로 맞춤). 인정 출결이 아니라 증빙 없음, 결석이 아니라 출석으로 셈.
  const TYPES=['출석','지각','조퇴','외출',DUP_TYPE,'결석','인정출석','인정지각','인정조퇴','인정외출','해당없음'],NONE='해당없음',DUP=DUP_TYPE;
  const CODE={'':['-','k-na'],해당없음:['-','k-none'],[DUP_TYPE]:['중','k-dup'],출석:['출','k-ok'],지각:['지','k-lt'],조퇴:['조','k-lt'],외출:['외','k-lt'],결석:['결','k-ab'],인정출석:['인','k-rc'],인정지각:['인','k-rc'],인정조퇴:['인','k-rc'],인정외출:['인','k-rc']};
  const NEED={지각:'inT',인정지각:'inT',조퇴:'outT',인정조퇴:'outT',외출:'oa',인정외출:'oa'};
  const W='일월화수목금토';
  let S={cls:null,pin:'',d:null,tab:OPT.tab||'today',sel:null,f:null,timer:null,extra:[],custom:false,dayMemos:null,memoDay:'',drafts:new Map(),sigs:null,sigAt:new Map(),sigLoading:null,sigT:0}; // dayMemos: 반·날짜 공통메모(날짜 → 줄), memoDay: 알림으로 연 날(공통메모 줄), extra: 「다른 날짜」로 연 날(반을 바꾸면 비움), custom: 사유 '기타'(직접 입력)를 고른 상태
  const $=s=>R.querySelector(s), app=()=>$('#app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const md=s=>{if(!s)return'';const p=String(s).split('-');if(p.length<3)return s;const d=new Date(+p[0],+p[1]-1,+p[2]);return (+p[1])+'/'+(+p[2])+'('+W[d.getDay()]+')';};
  let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),1800);}
  async function run(fn,...a){return runFor(S.cls,fn,...a);}
  async function runFor(cls,fn,...a){const h={'Content-Type':'application/json'};const tk=OPT.getToken?await OPT.getToken():'';if(tk)h.Authorization='Bearer '+tk;const r=await fetch(OPT.endpoint||'/api/teacher-beta',{method:'POST',headers:h,body:JSON.stringify({action:fn,args:a,cls}),keepalive:fn==='portalSaveBatch'});const j=await r.json().catch(()=>({ok:false,error:'응답 오류'}));if(!j.ok)throw Object.assign(new Error(j.error||'요청 실패'),{code:j.code,attempts:Number(j.attempts)||1,retries:Number(j.retries)||0});return j.data;}

  // 쓰기 대기열(2026-10-21, 100명 동시 입력): 서버가 portalData.queue를 주면(대기열 켜짐) 고른 값을 바로 칸에 보이고 '반영 대기'로 표시한 뒤
  // 0.8초 동안 모아(계속 고르면 최대 3초) portalSaveBatch 한 요청으로 보냅니다. 보낸 뒤 queueStatus로 확인해 반영되면 표시를 지우고,
  // 실패하면 그 칸을 '저장 안 됨'(빨간 테두리)으로 두고 알림 · 고른 값은 남겨 「다시 저장」·「버리기」. 대기열이 꺼져 있으면 예전처럼 한 칸씩 바로 저장합니다.
  // buf: 보낼 것(학생|날짜 → {item,before,cls}), wait: 보낸 것(id → {id,key,item,before,cls}), latest: 학생|날짜의 마지막 id, fail: 실패(학생|날짜 → {item,before,cls,error})
  const Q={on:false,buf:new Map(),wait:new Map(),latest:new Map(),fail:new Map(),timer:null,first:0,sending:null,poll:null};
  const qKey=(n,day)=>n+'|'+day;
  // 행 지문(before, 리허설 안전장치 2026-10-21, 시트 v23): 담임이 본 값과 시트 값이 다르면(운영팀이 그사이 고침) 시트가 'CONFLICT'로 저장하지 않습니다.
  // 출결판(portalData)에는 지문이 없어 자기 반 묶음(b2Bundle, 시트 캐시)을 한 번 더 읽어 학생|날짜 → sig를 둡니다(기록이 없는 칸은 '').
  // 출결판 값과 묶음 값(유형·사유)이 다르면 두 번 읽는 사이에 바뀐 것이라 맞지 않는 값(STALE)을 둬 저장하면 CONFLICT → 새 값을 다시 읽습니다.
  // 지문을 못 읽으면(S.sigs=null) 예전처럼 before 없이 저장합니다. 내 저장이 반영되면 받은 sig로 바꾸고, sig를 모르면(바로 저장 길·지우기) 잠깐 뒤 다시 읽습니다.
  // 같은 칸은 한 번에 하나만 보냅니다(앞 것이 반영되어 새 sig를 안 뒤 다음 값을 보냄).
  const STALE='!stale';
  function sigOf(k,force){if(!S.sigs)return undefined;const v=S.sigs.has(k)?S.sigs.get(k):'';if(v===undefined)return undefined;if(v===STALE)return force?undefined:STALE;return v;}
  function sigSet(k,v){if(!S.sigs)return;S.sigs.set(k,v);S.sigAt.set(k,Date.now());}
  function sigLater(){clearTimeout(S.sigT);S.sigT=setTimeout(()=>{if(Q.wait.size||Q.sending)sigLater();else void loadSigs();},1500);}
  // server: 시트가 준 출결판 값(내 대기 값을 올리기 전). 없으면 지금 출결판.
  function loadSigs(server){
    const c=S.cls,t0=Date.now(),base=server||(S.d&&S.d.recs)||{};
    const job=(async()=>{
      try{
        const b=await run('b2Bundle',String(c));if(c!==S.cls)return;
        const cols=(b&&b.ledgerCols)||[],ix=k=>cols.indexOf(k),iN=ix('name'),iD=ix('date'),iC=ix('cls'),iS=ix('sig'),iT=ix('type'),iR=ix('reason');
        if(iN<0||iD<0||iS<0||!Array.isArray(b.ledger)){S.sigs=null;return;}
        const got=new Map();for(const row of b.ledger){if(iC>=0&&String(row[iC])!==String(c))continue;got.set(row[iN]+'|'+row[iD],{sig:String(row[iS]==null?'':row[iS]),type:String(row[iT]==null?'':row[iT]).trim(),reason:String(row[iR]==null?'':row[iR]).trim()});}
        const recs=base,old=S.sigs,next=new Map(),inFlight=k=>{const id=Q.latest.get(k);return !!id&&Q.wait.has(id);};
        for(const k of new Set([...got.keys(),...Object.keys(recs)])){
          if(old&&(inFlight(k)||(!server&&(Q.buf.has(k)||Q.fail.has(k)))||(S.sigAt.get(k)||0)>t0)){if(old.has(k))next.set(k,old.get(k));continue;} // 내 저장 결과가 더 새로움
          const x=got.get(k),r=recs[k];
          if(x&&r&&x.type===String(r.type||'').trim()&&x.reason===String(r.r||'').trim())next.set(k,x.sig);
          else if(x||r)next.set(k,STALE);
        }
        S.sigs=next;
      }catch(e){if(c===S.cls&&!S.sigs)S.sigs=null;}
    })();
    S.sigLoading=job.finally(()=>{if(S.sigLoading===wait)S.sigLoading=null;});const wait=S.sigLoading;
    return S.sigLoading;
  }
  const recText=r=>!r||!r.type?'입력 전(기록 없음)':r.type+(r.r?' · '+r.r:'');
  function qState(k){const own=m=>{const v=m.get(k);return v&&v.cls===S.cls;};if(own(Q.fail))return 'fail';const id=Q.latest.get(k);if(own(Q.buf)||(id&&Q.wait.get(id)&&Q.wait.get(id).cls===S.cls))return 'wait';const r=S.d&&S.d.recs[k];return r&&r.pending?'wait':'';}
  // 새로 읽은 출결판 위에 아직 반영되지 않은 내 값(보낸 것 → 보낼 것 → 실패 순)을 다시 올립니다.
  // 그사이 바뀜(conflict)은 올리지 않습니다: 칸에는 운영팀이 고친 새 값이 보이고, 내 값은 오른쪽 칸에 초안으로 남습니다.
  function qApply(){
    if(!S.d)return;const put=(k,v)=>{if(v.cls!==S.cls)return;const it=v.item;if(!it.type)delete S.d.recs[k];else S.d.recs[k]=Object.assign({ev:'',evr:''},S.d.recs[k]||{},{type:it.type,inT:it.inT,outT:it.outT,oa:it.oa,ob:it.ob,r:it.r});};
    for(const w of Q.wait.values())if(Q.latest.get(w.key)===w.id)put(w.key,w);for(const [k,v] of Q.buf)put(k,v);for(const [k,v] of Q.fail)if(!v.conflict)put(k,v);
  }
  function qPaint(){
    const mine=[...Q.fail.values()].filter(v=>v.cls===S.cls),n=[...new Set([...Q.buf.keys(),...Q.latest.keys(),...Object.keys((S.d&&S.d.recs)||{})])].filter(k=>qState(k)==='wait').length,c=mine.filter(v=>v.conflict).length,f=mine.length-c,b=$('#qb');
    if(b)b.innerHTML=(n?'<span class="qbadge wait" data-q-wait>반영 대기 '+n+'</span>':'')+(f?'<span class="qbadge fail" data-q-fail>저장 안 됨 '+f+'</span>':'')+(c?'<span class="qbadge fail" data-q-conflicts>운영팀이 그사이 고침 '+c+'</span>':'');
    R.querySelectorAll('.g select[data-n]').forEach(el=>{const k=qKey(el.dataset.n,el.dataset.d),s=qState(k),x=Q.fail.get(k);el.classList.toggle('qwait',s==='wait');el.classList.toggle('qfail',s==='fail');
      if(x&&x.conflict&&x.cls===S.cls){el.dataset.conflict='1';el.title=el.dataset.n+' '+md(el.dataset.d)+' · 운영팀이 그사이 고쳤습니다 · 새 값: '+recText(S.d&&S.d.recs[k]);}else if(el.dataset.conflict){delete el.dataset.conflict;el.title=el.dataset.n+' '+md(el.dataset.d);}});
    qPanel();
  }
  function qPanel(){
    const el=$('#qs');if(!el||!S.sel)return;const k=qKey(S.sel.n,S.sel.day),x=Q.fail.get(k),s=qState(k);
    el.innerHTML=s==='fail'&&x.conflict?'<div class="qerr" role="alert" data-q-conflict>운영팀이 그사이 고쳤습니다 · 새 값: <b data-q-new>'+esc(recText(S.d&&S.d.recs[k]))+'</b><div style="margin-top:4px">내 값(저장 안 됨): <b data-q-mine>'+esc(recText(x.item))+'</b></div><div style="margin-top:6px"><button class="btn sm" id="qretry">내 값으로 다시 저장</button> <button class="ghost" id="qdrop">버리기</button></div></div>'
      :s==='fail'?'<div class="qerr" role="alert">저장되지 않았습니다 · '+esc(x.error)+'<div style="margin-top:6px"><button class="btn sm" id="qretry">다시 저장</button> <button class="ghost" id="qdrop">버리기</button></div></div>':s==='wait'?'<div class="note" data-q-note><span class="qbadge wait">반영 대기</span> 시트에 반영하는 중입니다</div>':'';
    // 내 값으로 다시 저장: 새로 읽은 지문(before)으로 다시 보냅니다(두 번 읽는 사이 바뀜 표시(STALE)는 담임이 고른 것이라 before 없이).
    const a=$('#qretry');if(a)a.onclick=()=>{Q.fail.delete(k);Q.buf.set(k,{item:x.item,before:x.before,cls:x.cls,force:!!x.conflict});if(x.conflict){qApply();if(S.tab==='board')vBoard();}qLater(300);st('반영 대기 · 다시 보냅니다','wait');qPaint();};
    const d=$('#qdrop');if(d)d.onclick=()=>{Q.fail.delete(k);if(x.conflict){if(S.tab==='board')vBoard();else qPaint();st('내 값을 버렸습니다 · 운영팀이 고친 값 그대로입니다','ok');return;}qPaint();reload(true);};
  }
  // 그사이 바뀜: 내 값은 초안(Q.fail conflict)으로 두고, 출결판을 새로 읽어 그 칸에 새 값을 보입니다(여러 칸이 한꺼번에 와도 한 번만 읽음).
  let conflictT=0;
  function qConflict(key,v,msg){
    const nb=Q.buf.get(key);if(nb&&nb.cls===v.cls){Q.buf.delete(key);v=nb;} // 그사이 또 고른 값이 있으면 그것이 내 값
    Q.fail.set(key,{item:v.item,before:v.before,cls:v.cls,error:String(msg||'').replace(/^CONFLICT:\s*/,'')||'운영팀이 그사이 고쳤습니다',conflict:true});
    toast('운영팀이 그사이 고쳤습니다: '+v.item.name+' '+md(v.item.date)+' · 새 값을 불러옵니다');
    if(S.sel&&v.cls===S.cls&&qKey(S.sel.n,S.sel.day)===key)st('운영팀이 그사이 고쳤습니다 · 새 값을 불러오는 중…','err');
    clearTimeout(conflictT);conflictT=setTimeout(()=>{if(v.cls===S.cls)void reload(true);},200);
  }
  function qLater(ms){if(!Q.first)Q.first=Date.now();clearTimeout(Q.timer);Q.timer=setTimeout(qSend,Math.max(0,Math.min(ms,Q.first+3000-Date.now())));}
  function qSave(sel,f,before){
    const key=qKey(sel.n,sel.day),keep=before||{},prev=Q.buf.get(key);
    const item={name:sel.n,date:sel.day,type:f.type,inT:keep.inT||'',outT:keep.outT||'',oa:keep.oa||'',ob:keep.ob||'',r:f.r};
    Q.buf.set(key,{item,before:prev?prev.before:(before?Object.assign({},before):null),cls:S.cls});Q.fail.delete(key);S.drafts.delete(draftKey(sel.n,sel.day)); // 몰림 초안(바로 저장 길)과 겹치지 않게
    if(!f.type)delete S.d.recs[key];else S.d.recs[key]=Object.assign({ev:'',evr:''},S.d.recs[key]||{},f);
    const b=R.querySelector('.g select[data-n="'+window.CSS.escape(sel.n)+'"][data-d="'+sel.day+'"]');if(b&&b.value!==f.type){b.value=f.type;paint(b,f.type);}
    qLater(800);if(S.sel===sel)st('반영 대기 · 곧 시트에 저장합니다','wait');qPaint();
  }
  // 한 번에 하나씩, 같은 반끼리 50건까지 보냅니다(보내는 동안 고른 것은 다음 묶음). 같은 칸의 앞 저장이 아직 반영 전이면 그 칸은 다음 차례에.
  const inFlight=k=>{const id=Q.latest.get(k);return !!id&&Q.wait.has(id);};
  async function qSend(){
    clearTimeout(Q.timer);Q.timer=null;
    if(Q.sending||!Q.buf.size)return Q.sending;
    const first=[...Q.buf.entries()].find(([k])=>!inFlight(k));if(!first)return null;
    const cls=first[1].cls,batch=[...Q.buf.entries()].filter(([k,v])=>v.cls===cls&&!inFlight(k)).slice(0,50);
    batch.forEach(([k])=>Q.buf.delete(k));Q.first=Q.buf.size?Date.now():0;
    Q.sending=(async()=>{
      try{
        if(S.sigLoading)await S.sigLoading; // 지문을 읽는 중이면 기다렸다가 보냄
        // before: 보내는 때의 지문(앞 저장이 반영되며 받은 새 sig 포함). 지문을 모르면 빼서 예전처럼.
        const items=batch.map(([k,v])=>{const b=cls===S.cls?sigOf(k,v.force):undefined;return b===undefined?v.item:Object.assign({},v.item,{before:b});});
        const res=await runFor(cls,'portalSaveBatch',{cls,items});
        if(res&&res.queued&&Array.isArray(res.ids)){batch.forEach(([k,v],i)=>{const id=res.ids[i];Q.wait.set(id,Object.assign({id,key:k},v));Q.latest.set(k,id);});qPoll(1500);}
        else batch.forEach(([k,v],i)=>{if(Q.buf.has(k))return;const r=(res&&res.results||[])[i]||{ok:false,msg:'응답 오류'};if(r.ok){qDone(k,v,r.warn);if(cls===S.cls){sigSet(k,undefined);sigLater();}}else if(r.conflict||/^CONFLICT/.test(String(r.msg||'')))qConflict(k,v,r.msg);else qFail(k,v,sheetWait(r.msg,v.item.type,'다시 저장해 주세요'));});
      }catch(e){batch.forEach(([k,v])=>{if(!Q.buf.has(k))qFail(k,v,e.message);});}
      finally{Q.sending=null;qPaint();if([...Q.buf.keys()].some(k=>!inFlight(k)))qLater(0);}
    })();
    return Q.sending;
  }
  function qPoll(ms){if(!Q.poll&&Q.wait.size)Q.poll=setTimeout(qCheck,ms);}
  async function qCheck(){
    Q.poll=null;if(!Q.wait.size)return;
    try{
      const res=await run('queueStatus',{ids:[...Q.wait.keys()].slice(0,100)});
      for(const it of (res&&res.items)||[]){
        const w=Q.wait.get(it.id);if(!w||(it.status!=='done'&&it.status!=='failed'))continue;
        Q.wait.delete(it.id);if(Q.latest.get(w.key)!==it.id)continue;Q.latest.delete(w.key);
        if(it.status==='done'){qSig(w.key,w,it);qDone(w.key,w,it.warn);}
        else if(/^CONFLICT/.test(String(it.error||'')))qConflict(w.key,w,it.error);
        else if(!Q.buf.has(w.key))qFail(w.key,w,it.error||'시트에 반영하지 못했습니다');
      }
    }catch(e){}
    qPaint();qPoll(2500);if(Q.buf.size&&!Q.timer&&!Q.sending)qLater(0); // 앞 저장을 기다리던 같은 칸
  }
  // 반영된 내 저장의 새 지문: 쓰기는 받은 sig, 바뀐 것 없음은 그대로, 지우기·sig 없음은 잠깐 뒤 묶음에서 다시 읽음(운영팀 메모가 있으면 '출석' 줄로 남기 때문).
  function qSig(key,w,it){
    if(w.cls!==S.cls||!S.sigs)return;
    if(it.action==='none')return;
    if(it.action==='write'&&it.sig)sigSet(key,String(it.sig));else{sigSet(key,undefined);sigLater();}
  }
  function qDone(key,v,warn){
    const r=S.d&&v.cls===S.cls&&S.d.recs[key];if(r)delete r.pending;
    const it=v.item;if(extraEvidenceStarted(v.before&&{type:v.before.type,reason:v.before.r},{type:it.type,reason:it.r}))extraAlert({n:it.name,day:it.date},{type:it.type,r:it.r});
    if(S.sel&&v.cls===S.cls&&qKey(S.sel.n,S.sel.day)===key&&!qState(key)){const w=warnText(warn);syncNote();st(w?'저장했습니다 · '+w:'저장했습니다',w?'warn':'ok');}
  }
  function qFail(key,v,msg){
    Q.fail.set(key,{item:v.item,before:v.before,cls:v.cls,error:msg});
    toast('저장되지 않았습니다: '+v.item.name+' '+md(v.item.date)+' · '+msg);
    if(S.sel&&v.cls===S.cls&&qKey(S.sel.n,S.sel.day)===key)st('저장되지 않았습니다 · '+msg,'err');
  }
  // 다시 열 때(새로고침 포함): 오늘 실패한 내 항목을 '저장 안 됨'으로 되살립니다(대기 중인 값은 서버가 출결판에 덮어 줌).
  async function qRestore(){
    const c=S.cls;try{const res=await run('queueStatus',{cls:String(c)});if(c!==S.cls)return;let n=0;
      for(const it of (res&&res.items)||[]){if(!it.mine||it.status!=='failed')continue;const k=qKey(it.name,it.date);if(Q.fail.has(k)||Q.buf.has(k)||Q.latest.has(k))continue;const r=it.rec||{},conflict=/^CONFLICT/.test(String(it.error||''));
        Q.fail.set(k,{item:{name:it.name,date:it.date,type:r.type||'',inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',r:r.reason||''},before:null,cls:c,error:conflict?String(it.error).replace(/^CONFLICT:\s*/,''):it.error||'시트에 반영하지 못했습니다',...(conflict?{conflict:true}:{})});n++;}
      if(n){qApply();if(S.tab==='board')vBoard();toast('저장되지 않은 칸이 '+n+'개 있습니다 · 빨간 칸을 눌러 다시 저장해 주세요');}
    }catch(e){}
  }
  addEventListener('beforeunload',e=>{if(Q.buf.size||Q.sending){void qSend();e.preventDefault();e.returnValue='';}});
  // 시트 안내 가운데 시간 칸(입실 시간·퇴실 시간·외출 구간)은 담임이 채우지 않으므로 빼고 사유만 보입니다.
  // 중복(시트 계약 2026-10-20): portalSave는 시간 없이 저장하고 warn에 '겹친 시간 둘 이상…나중에 채워도 됩니다'를 붙이므로 그 글은 그대로 안내합니다.
  function warnText(warn){const raw=String(warn||'').trim(),w=raw.replace(/은 나중에 채워도 됩니다$/,'').split('·').filter(x=>x==='사유').join('·');return /겹친 시간/.test(raw)?raw:w?w+'은 나중에 채워도 됩니다':'';}

  async function login(){
    // 2026-10-19: 불러오는 중·준비 중·실패를 담임이 알아듣는 말로, 실패하면 「다시 시도」
    app().innerHTML='<div class="card"><div class="sec">출결 정보</div><div class="note">출결 정보를 불러오는 중입니다…</div></div>';
    S.cls=Number(OPT.cls);S.pin='';S.extra=[];S.dayMemos=null;S.drafts=new Map();S.sigs=null;S.sigAt=new Map();
    try{S.d=await run('portalData',S.cls,'');Q.on=!!S.d.queue;const server=Object.assign({},S.d.recs);qApply();render();void loadSigs(server);loadDayMemos();if(Q.on)qRestore();}catch(err){const wait=err.code==='NOT_CONFIGURED';app().innerHTML='<div class="card"><div class="sec">'+(wait?'출결 입력 준비 중':'출결 정보를 불러오지 못했습니다')+'</div><div class="'+(wait?'note':'err')+'">'+esc(err.message)+'</div>'+(wait?'':'<div class="note" style="margin-top:6px">잠시 뒤 「다시 시도」를 눌러 주세요. 계속 안 되면 운영팀에 알려 주세요.</div><button class="btn" id="retry" style="margin-top:10px">다시 시도</button>')+'</div>';const b=$('#retry');if(b)b.onclick=login;}
  }
  async function reload(keep,say){try{S.d=await run('portalData',S.cls,S.pin);Q.on=!!S.d.queue;const server=Object.assign({},S.d.recs);qApply();if(!keep)S.sel=null;if(S.sel&&!S.timer){const r=S.d.recs[S.sel.n+'|'+S.sel.day],dr=S.drafts.get(draftKey(S.sel.n,S.sel.day));S.f=dr?Object.assign({},dr):r?Object.assign({},r):{type:'',inT:'',outT:'',oa:'',ob:'',r:''};}render();void loadSigs(server);loadDayMemos();if(say)toast('새로 불러왔습니다');}catch(e){toast('새로 불러오지 못했습니다 · '+e.message);}}
  // 반·날짜 공통메모(운영팀이 출결대조에서 남김, 시트 v17 b2DayMemos, 2026-10-20): 출결판 위에 고른 날(알림으로 온 날 → 고른 칸의 날 → 기준일)의 공통메모를 보기만 합니다.
  // 반 전체를 한 번 읽고(새로고침 때 다시) 못 읽으면(시트 v17 배포 전 등) 조용히 보이지 않습니다.
  async function loadDayMemos(){
    const c=S.cls;try{const res=await run('b2DayMemos',{cls:String(c)});if(c!==S.cls)return;S.dayMemos=new Map((res&&res.rows||[]).filter(r=>String(r.cls)===String(c)&&String(r.memo||'').trim()).map(r=>[String(r.date),r]));}
    catch(e){if(c===S.cls)S.dayMemos=new Map();}
    paintDayMemo();
  }
  function paintDayMemo(){
    const el=$('#dm');if(!el||!S.d)return;const day=S.memoDay||(S.sel&&S.sel.day)||S.d.mainDay,r=S.dayMemos&&S.dayMemos.get(day),at=r?r.editedAt||r.at||'':'';
    el.innerHTML=r?'<div class="daymemo" role="note" aria-label="'+esc(md(day)+' 공통메모')+'"><b>공통메모 · '+esc(md(day))+'</b><span>'+esc(String(r.memo).trim())+'</span><small>운영팀'+(at?' · '+esc(at):'')+'</small></div>':'';
  }

  // 2026-10-16 회의: 학습자 평가·현장운영 체크리스트는 없앴고, 민원·이슈는 운영팀과 주고받는 beta2-voc.mjs로 옮겼습니다(2기 베타 담임 화면 '민원·만족도').
  const TABS=[['today','오늘'],['board','출결판'],['reason','출결사유'],['info','반 정보']];
  function render(){
    const d=S.d;
    // 반·과정·담임은 포털 머리글에 이미 있으므로 하위 메뉴와 기준일만 한 줄로 둡니다.
    // hideNav: 2기 베타 담임 화면(6탭 통합)이 바깥 메뉴로 하위 화면을 고릅니다.
    // 2기 담임 첫 화면(hideNav·오늘): 기준일·새로고침 줄을 따로 두지 않고 「오늘 출결」 카드 머리에 붙입니다(사용자 2026-10-21 '보기 좋게').
    const slim=OPT.hideNav&&S.tab==='today';
    let h=(slim?'':'<header class="bar">'+(OPT.hideNav?'':'<nav>'+TABS.map(([k,l])=>'<button data-tab="'+k+'" aria-selected="'+(S.tab===k)+'">'+l+'</button>').join('')+'</nav>')+'<span class="sp"></span><span class="sub">출결 기준일 <b>'+md(d.mainDay)+'</b></span><button id="rf">새로고침</button></header>')+'<main id="v"></main>';
    app().innerHTML=h;
    const rf=$('#rf');if(rf)rf.onclick=()=>reload(true,true);
    R.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{flush();S.tab=b.dataset.tab;render();});
    ({today:vToday,board:vBoard,reason:vReason,info:vInfo})[S.tab]();
  }

  function vToday(){
    const d=S.d;
    // 숫자 칸: 결석·80% 미만이 있으면 빨강, 지각·조퇴·외출이 있으면 주황(0이면 그대로)
    const tone=x=>{const n=parseFloat(x.v);if(!(n>0))return '';return /결석|미만/.test(x.k)?' bad':/지각|조퇴|외출/.test(x.k)?' warn':'';};
    let h='<div class="card today"><div class="sec row"><span>오늘 출결 <small>'+md(d.mainDay)+'</small></span><span class="sp"></span>'+(OPT.hideNav?'<button class="btn sm ghost" id="rf2">새로고침</button>':'')+'</div><div class="sum">'+d.summary.filter(x=>x.k!=='당일 마감').map(x=>'<div class="t'+tone(x)+'"><b>'+esc(x.v)+'</b><span>'+esc(x.k)+'</span></div>').join('')+'</div>';
    // 2026-10-19: 남은 인원을 먼저 말하고 출결판으로 가는 큰 단추(바깥 화면이 onTab을 줄 때)
    const todo=d.kids.filter(k=>!(k.off&&d.mainDay>k.off)&&!d.recs[k.name+'|'+d.mainDay]).length;h+=todo?'<div class="note big">아직 입력하지 않은 학생 <b style="color:var(--orange)">'+todo+'명</b> · 출석한 학생도 「출석」으로 모두 표시해 주세요.</div>':'<div class="note big" style="color:var(--green)">오늘 출결을 모두 입력했습니다.</div>';
    if(OPT.onTab)h+='<button class="btn go" id="goBoard">'+(todo?'출결 입력하기':'출결판 보기')+' →</button>';
    h+='<div class="close"><div class="lab">당일 마감 · 수업이 끝나면 위 숫자를 확인하고 「확인」을 눌러 주세요</div><div class="chips"><button class="chip g" data-close="확인" aria-pressed="'+(d.closed==='확인')+'">확인</button><button class="chip n" data-close="미확인" aria-pressed="'+(d.closed!=='확인')+'">미확인</button></div></div></div>';
    $('#v').innerHTML=h;
    const go=$('#goBoard');if(go)go.onclick=()=>OPT.onTab('board');
    const rf2=$('#rf2');if(rf2)rf2.onclick=()=>reload(true,true);
    R.querySelectorAll('[data-close]').forEach(b=>b.onclick=async()=>{const v=b.dataset.close;S.d.closed=v;vToday();try{await run('portalClose',S.cls,S.pin,v);toast('당일 마감: '+v);}catch(e){toast(e.message);}});
  }

  // 출결판 날짜 칸(최근 먼저): 시트가 준 교육일 + 원장에 기록이 있는 교육일 아닌 날·아직 오지 않은 날 + 「다른 날짜」로 연 날 + 지금 고른 칸의 날.
  // 오늘까지의 교육일 가운데 시트가 주지 않은 오래된 날은 지금처럼 빼고, 그런 날도 「다른 날짜」로 열 수 있습니다.
  const typedDay=x=>isIsoDate(x)&&x>='1900-01-01'&&x<='2999-12-31'; // 날짜 모양(연도를 치는 중간 값 0002-… 넘김). 기간 제한이 아닙니다.
  const offDay=x=>!S.d.days.includes(x)&&!isTrainingDay(x),future=x=>!!S.d.mainDay&&x>S.d.mainDay&&!S.d.days.includes(x);
  function boardDays(){
    const d=S.d,more=new Set(S.extra);
    for(const k of Object.keys(d.recs)){const x=k.slice(k.lastIndexOf('|')+1);if(typedDay(x)&&!d.days.includes(x)&&(offDay(x)||future(x)))more.add(x);}
    if(S.sel&&typedDay(S.sel.day))more.add(S.sel.day);
    if(S.memoDay&&typedDay(S.memoDay))more.add(S.memoDay); // 공통메모 알림으로 연 날
    return [...new Set([...d.days,...more])].sort().reverse();
  }
  const dayTag=x=>offDay(x)?'교육일 아님':future(x)?'예정':'';
  function cellVal(n,day){const k=S.d.kids.find(x=>x.name===n);if(k&&k.off&&day>k.off)return null;const dr=S.drafts.get(draftKey(n,day));if(dr)return dr.type;const r=S.d.recs[n+'|'+day];return r?r.type:'';}
  // 몰려서 저장하지 못한 칸(초안): 반·학생·날짜별로 고친 값을 남겨 출결판·사유 칸에 그대로 보이고 「다시 저장」으로 다시 보냅니다(2026-10-21 부하 시험).
  const draftKey=(n,day)=>S.cls+'|'+n+'|'+day;
  function vBoard(){
    const d=S.d,days=boardDays();
    // 2026-10-19: 안내는 순서대로 짧게, 맨 앞 칸(기준일)에 '오늘'(한국 날짜가 기준일이 아니면 '기준일') 표시, 학생이 없으면 쉬운 말로
    if(!d.kids.length){$('#v').innerHTML='<div class="card"><div class="sec">교육생이 없습니다</div><div class="note">마스터시트 명부에 이 반 교육생이 아직 없습니다. 명단이 비어 있으면 운영팀에 알려 주세요.</div></div>';return;}
    const first=d.mainDay===new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())?'오늘':'기준일';
    let h='<div class="wrap"><div><ol class="steps"><li>학생 칸을 눌러 출석·지각·결석 등을 고르면 바로 저장됩니다.</li><li>지각·조퇴·외출·중복·인정은 오른쪽(휴대폰은 아래) 칸에서 사유를 골라 주세요. 시간은 보기만 합니다.</li></ol><div class="note" style="margin-bottom:6px">아직 입력하지 않은 칸은 「입력 전」으로 보입니다. 회색 「해당없음」은 현황 없음으로 저장되어 출석률·결석에 들지 않습니다.</div><div id="qb" class="qbar"></div><div class="note anyday" style="margin-bottom:6px"><label>다른 날짜 <input type="date" id="anyDay" aria-label="다른 날짜 열기"></label> <span id="anyNote">교육일이 아닌 날·아직 오지 않은 날도 열어 기록할 수 있습니다.</span></div><div id="dm"></div><div class="scroll"><table class="g"><thead><tr><th class="nm">이름</th>'+days.map(x=>{const t=x===d.mainDay,tag=dayTag(x);return '<th class="'+(t?'today':'')+(tag?' off':'')+'" data-day="'+x+'">'+md(x)+(t?'<small>'+first+'</small>':tag?'<small class="tag">'+tag+'</small>':'')+'</th>';}).join('')+'</tr></thead><tbody>';
    d.kids.forEach(k=>{h+='<tr><td class="nm">'+esc(k.name)+(k.status!=='재학'?' <span class="note">'+esc(k.status)+'</span>':'')+'</td>';
      days.forEach(x=>{const tc=x===d.mainDay?'today':'';const v=cellVal(k.name,x);if(v===null){h+='<td class="'+tc+'"></td>';return;}const c=CODE[v]||['-','k-na'];const sel=(S.sel&&S.sel.n===k.name&&S.sel.day===x?' sel':'')+(qState(qKey(k.name,x))?' q'+qState(qKey(k.name,x)):'');const r=d.recs[k.name+'|'+x];const miss=r&&(r.ev==='미제출'||r.ev==='반려'||(!r.ev&&String(r.type).indexOf('인정')===0))?' *':'';
        // 사유가 칸 아래에 바로 보이게(사용자 2026-10-23 '출결 부분 역시 이전보다 사유가 더 명확히 보이도록'): 짧게 한 줄, 전체 글은 마우스를 올리면
        const rr=r&&v&&v!=='출석'?tidyReason(r.r):'';
        h+='<td class="cell '+tc+'"><select class="'+c[1]+sel+'" data-n="'+esc(k.name)+'" data-d="'+x+'" title="'+esc(k.name)+' '+md(x)+(rr?' · '+esc(rr):'')+'">'+(v===''?'<option value="" selected disabled>입력 전</option>':'')+TYPES.map(t=>'<option value="'+t+'"'+(t===v?' selected':'')+'>'+t+(t===v?miss:'')+'</option>').join('')+'</select>'+(rr?'<div class="rs" title="'+esc(rr)+'" data-reason-cell>'+esc(rr)+'</div>':'')+'</td>';});
      h+='</tr>';});
    h+='</tbody></table></div><div class="note" style="margin-top:6px">* 표시: 증빙서류를 아직 내지 않았거나 반려된 칸 (운영팀 확인 중)</div></div><div class="panel" id="pn"></div></div>';
    $('#v').innerHTML=h;
    const pick=(el,keepType)=>{flush();if(!(S.sel&&S.sel.n===el.dataset.n&&S.sel.day===el.dataset.d))S.custom=false;S.sel={n:el.dataset.n,day:el.dataset.d};const r=S.d.recs[S.sel.n+'|'+S.sel.day],dr=S.drafts.get(draftKey(S.sel.n,S.sel.day));S.f=dr?Object.assign({},dr):r?Object.assign({},r):{type:'',inT:'',outT:'',oa:'',ob:'',r:''};R.querySelectorAll('.g select.sel').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');S.memoDay='';paintDayMemo();}; // 공통메모 줄은 고른 칸의 날
    // 다른 날짜: 날짜 모양이면 그날 칸을 열고(이미 있으면 그 칸으로) 첫 학생 칸에 초점. 키보드로 치는 동안은 잠깐(0.5초) 기다립니다.
    const any=$('#anyDay');let anyT=0;
    any.onchange=()=>{clearTimeout(anyT);anyT=setTimeout(()=>{const x=any.value;if(!typedDay(x)||!R.contains(any))return;if(!S.extra.includes(x))S.extra.push(x);vBoard();
      const el=R.querySelector('.g select[data-d="'+x+'"]'),th=R.querySelector('.g th[data-day="'+x+'"]'),tag=dayTag(x);if(th)th.scrollIntoView({block:'nearest',inline:'center'});if(el)el.focus();
      const n=$('#anyNote');if(n)n.textContent=md(x)+(tag==='교육일 아님'?' · 교육일이 아닌 날입니다. 기록할 수 있고, 시트 출결판에는 나오지 않습니다.':tag==='예정'?' · 아직 오지 않은 날입니다. 미리 기록할 수 있습니다.':' 칸을 열었습니다.');},500);};
    R.querySelectorAll('.g select').forEach(el=>{
      el.onfocus=()=>{if(!(S.sel&&S.sel.n===el.dataset.n&&S.sel.day===el.dataset.d)){pick(el);panel(true);}};
      el.onchange=()=>{pick(el);S.f.type=el.value;if(S.f.type===NONE){S.f.r='';S.custom=false;}paint(el,el.value);panel();save();if(innerWidth<=900)$('#pn').scrollIntoView({behavior:'smooth'});};
    });
    panel();paintDayMemo();qPaint();
  }
  function paint(el,v){const c=CODE[v]||['-','k-na'];el.className=c[1]+' sel';const q=qState(qKey(el.dataset.n,el.dataset.d));if(q)el.classList.add('q'+q);}
  function memo(){const f=S.f,t=S.d.teacher||'담임',tm=x=>x||'--:--';if(!f||!f.type||f.type==='출석'||f.type===NONE||f.type===DUP||f.type==='결석')return''; // 중복은 체크히어 메모 모양이 없어 추천하지 않음
    if(f.type==='지각')return'지각_담임:'+t+'('+tm(f.inT)+')';if(f.type==='조퇴')return'조퇴_담임:'+t+'('+tm(f.outT)+')';if(f.type==='외출')return'외출_담임:'+t+'('+tm(f.oa)+'~'+tm(f.ob)+')';
    const r=tidyReason(f.r)||'사유';if(f.type==='인정출석')return'(인정출석)'+r+'_담임:'+t;if(f.type==='인정지각')return'(인정지각)'+r+'_담임:'+t+'('+tm(f.inT)+')';if(f.type==='인정조퇴')return'(인정조퇴)'+r+'_담임:'+t+'('+tm(f.outT)+')';return'(인정외출)'+r+'_담임:'+t+'('+tm(f.oa)+'~'+tm(f.ob)+')';}
  // 사유 칸(관리자 출결대조와 같은 reason-pick.mjs): 드롭다운 하나 + 옆 종류 드롭다운 + 기타 직접 입력
  const recOf=()=>S.sel&&S.d.recs[S.sel.n+'|'+S.sel.day];
  // 질병 인정 한도(사용자 2026-10-23): 그 학생의 다른 날 질병 인정 횟수(출결판 기록 recs)가 DISEASE.max면 병원·질병을 고를 수 없고 저장도 막습니다.
  const usedDisease=()=>{if(!S.sel)return 0;const p=S.sel.n+'|';return diseaseUsed(Object.keys(S.d.recs).filter(k=>k.indexOf(p)===0).map(k=>({date:k.slice(p.length),type:S.d.recs[k].type,reason:S.d.recs[k].r})),S.sel.day);};
  const diseaseFull=()=>usedDisease()>=DISEASE.max;
  const diseaseBlocked=f=>String(f.type||'').indexOf('인정')===0&&isDiseaseReason(f.r)&&diseaseFull();
  function pickHtml(){return reasonPickHtml({reason:S.f.r,type:S.f.type,cls:S.cls,name:S.sel.n,custom:S.custom,diseaseFull:diseaseFull()});}
  // 경고(고르는 즉시, 저장은 막지 않음): 관리자 출결대조와 같은 글 + 인정 출결 사유 없음
  function pickNote(){const f=S.f,r=recOf();return (diseaseBlocked(f)?'<span class="b2-err" style="display:block" data-disease-full>'+esc(diseaseFullText(usedDisease(),DISEASE.max))+'</span>':'')+reasonNotesHtml({type:f.type,reason:f.r,cls:S.cls,offDay:offDay(S.sel.day),rec:r&&{type:r.type,reason:r.r,ev:r.ev},required:true});}
  // 증빙(보기만): 담임은 증빙 상태를 정하지 않습니다(portalSave에 증빙 칸 없음, 운영팀이 출결대조에서 확인). 인정 출결이면 비어 있어도 '증빙 미제출'.
  function evHtml(){
    const f=S.f,st=String(f.ev||'').trim()||(String(f.type).indexOf('인정')===0?'미제출':''),r=recOf(),x=r&&extraEvidence({type:r.type,reason:r.r,ev:r.ev});
    let h='';
    if(st&&st!=='해당없음')h+='<span class="b2-badge '+(st==='확인'?'e-ok':st==='미제출'||st==='반려'?'e-miss':'e-none')+'" data-ev="'+esc(st)+'">증빙 '+esc(st)+'</span>';
    if(x)h+=x.done?'<span class="b2-badge e-ok" title="'+esc(x.label)+'">추가 증빙 '+esc(x.state)+'</span>':'<span class="b2-badge e-extra" title="'+esc(x.label)+'">'+esc(x.label)+' · '+esc(x.state)+'</span>';
    if(st==='반려')h+=f.evr?'<span class="b2-sub">반려: '+esc(f.evr)+'</span>':'<span class="b2-err" style="display:block" data-reason-check="evr">반려 사유가 비어 있습니다 · 운영팀에 확인해 주세요</span>';
    return h?h+'<span class="b2-sub">증빙은 운영팀이 확인합니다</span>':'';
  }
  function syncNote(){const b=$('#rn');if(b)b.innerHTML=pickNote();const e=$('#evb');if(e)e.innerHTML=evHtml();const m=$('#mm');if(m)m.textContent=memo();}
  function syncPick(){const a=$('#rp');if(a){a.innerHTML=pickHtml();bindPick();}syncNote();}
  // 드롭다운에서 고르면 새 글로 칸을 다시 그리고 다음 칸(옆 종류·직접 입력)에 초점, 0.7초 뒤 저장. '기타'를 고른 것만으로는 저장하지 않습니다(직접 쓰면 저장).
  function setReason(text,focus,quiet){S.f.r=text;syncPick();if(focus){const el=$('#rp [data-inline="'+focus+'"]');if(el)el.focus();}if(quiet)st('');else later();}
  function bindPick(){
    R.querySelectorAll('#rp select').forEach(el=>el.onchange=()=>{const p=pickReasonText(S.f.r,el.dataset.inline,el.value);if(p.custom!==null)S.custom=p.custom;setReason(p.text,p.focus,p.custom===true);});
    R.querySelectorAll('#rp input').forEach(el=>{
      el.oninput=()=>{S.f.r=el.dataset.inline==='rapt'?kindInputText(el.dataset.kind,el.value):el.value;if(el.dataset.inline==='reason'){S.custom=true;el.title=el.value;}syncNote();later();};
      el.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save();el.blur();}};
    });
  }
  // 빠른 사유: 지금 목록에 있는 표준 글만(관리자가 숨기면 빠짐). '해당없음'은 사유가 아니라 출결 상태라 여기 없음(사용자 2026-10-20)
  const QUICK=['개인일정','병원','면접','교통사정','예비군'];
  function panel(noFocus){
    if(OPT.onDay&&S.d)OPT.onDay(S.sel?S.sel.day:S.d.mainDay); // 출결판 날짜(고른 칸의 날, 없으면 기준일)를 바깥 화면에(드라이브 폴더 바로가기, 2026-10-21)
    const p=$('#pn');if(!p)return;
    if(!S.sel){p.innerHTML='<h2>사유 입력</h2><div class="note" style="margin-top:6px">출결판에서 학생 칸을 누르면 여기에서 사유를 고르고 체크히어 메모 추천을 볼 수 있습니다.</div>';return;}
    const f=S.f;
    let h='<h2>'+esc(S.sel.n)+'</h2><div class="note">'+md(S.sel.day)+(S.sel.day===S.d.mainDay?' · 오늘':'')+(dayTag(S.sel.day)?' · '+dayTag(S.sel.day):'')+'</div><div class="lab">유형</div><div class="chips">'+TYPES.map(t=>'<button class="chip'+(t===NONE?' none':t===DUP?' dup':'')+'" data-t="'+t+'" aria-pressed="'+(f.type===t)+'"'+(t===DUP?' title="'+DUP_RULE.label+' · 지각·조퇴·외출 가운데 둘 이상"':'')+'>'+t+'</button>').join('')+(recOf()?'<button class="chip" data-clear title="이 날 기록을 지우고 입력 전으로">기록 지우기</button>':'')+'</div>';
    if(!f.type)h+='<div class="note" style="margin-top:10px">아직 입력 전입니다. 위에서 출석 또는 다른 유형을 고르세요.</div>';
    if(f.type===NONE)h+='<div class="note" style="margin-top:10px" data-none-note>해당없음(현황 없음) · 사유·증빙 없이 저장되고 출석률·결석에 들지 않습니다.</div>';
    if(f.type===DUP)h+='<div class="note" style="margin-top:10px" data-dup-note>'+DUP_RULE.label+' · 한 날에 지각·조퇴·외출 가운데 둘 이상입니다. 결석이 아니라 출석으로 세고, 사유는 고르지 않아도 됩니다.</div>';
    if(f.type&&f.type!=='출석'&&f.type!==NONE){
      h+='<div class="lab">'+(f.type.indexOf('인정')===0?'사유 (필수)':'사유')+' · 고르면 바로 저장 · 직접 입력은 Enter</div><div class="rp" id="rp">'+pickHtml()+'</div><div class="evb" id="evb">'+evHtml()+'</div><div class="rn" id="rn">'+pickNote()+'</div><div class="qr">'+QUICK.filter(q=>STANDARD.has(q)).map(q=>{const off=f.type.indexOf('인정')===0&&isDiseaseReason(q)&&diseaseFull();return '<button data-q="'+q+'"'+(off?' disabled title="질병 인정 한도('+DISEASE.max+'회)를 다 썼습니다"':'')+'>'+q+'</button>';}).join('')+'</div>';
      h+=timesView(f);
      const m=memo();if(m)h+='<div class="memo"><span id="mm">'+esc(m)+'</span><button id="cp">복사</button></div>';
    }
    h+='<div id="qs"></div><div class="status" id="st"></div>';
    p.innerHTML=h;qPanel();
    p.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{S.f.type=b.dataset.t;if(S.f.type===NONE){S.f.r='';S.custom=false;}const el=R.querySelector('.g select[data-n="'+window.CSS.escape(S.sel.n)+'"][data-d="'+S.sel.day+'"]');if(el){el.value=S.f.type;paint(el,S.f.type);}panel();save();});
    p.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{S.custom=false;S.f.r=b.dataset.q;syncPick();save();});
    const clr=p.querySelector('[data-clear]');if(clr)clr.onclick=()=>{S.f.type='';S.f.r='';S.custom=false;save().then(()=>{if(S.tab==='board'&&R.contains(p))vBoard();});};
    bindPick();
    const c=$('#cp');if(c)c.onclick=()=>navigator.clipboard.writeText(memo()).then(()=>toast('메모를 복사했습니다'),()=>toast('직접 선택해 복사해 주세요'));
    const first=$('#rp [data-inline="reason"]')||$('#rp [data-inline="rmain"]');if(first&&!f.r&&!noFocus)first.focus();
  }
  // 저장된 시간(보기만). 그 유형에 필요한 시간이 비었으면 '운영팀이 체크히어 기록으로 맞춤'만 알립니다(담임은 입력하지 않음).
  function timesView(f){
    const need=NEED[f.type]||'',shown=[['inT','입실'],['outT','퇴실']].filter(([k])=>f[k]).map(([k,l])=>l+' '+esc(f[k]));
    if(f.oa||f.ob)shown.push('외출 '+esc(f.oa||'--:--')+'~'+esc(f.ob||'--:--'));
    const miss=f.type===DUP?dupParts(f).count<DUP_RULE.minParts:need&&!(need==='oa'?f.oa&&f.ob:f[need]); // 중복: 지각·조퇴·외출 시간이 둘 이상 없으면
    return '<div class="note tv" id="tv" style="margin-top:8px">시간(보기만): '+(shown.length?shown.join(' · '):'없음')+(miss?' · 시간은 운영팀이 체크히어 기록으로 맞춥니다':'')+'</div>';
  }
  function st(t,k){const s=$('#st');if(s){s.textContent=t;s.className='status'+(k?' '+k:'');}}
  function later(){st('입력 중…');clearTimeout(S.timer);S.timer=setTimeout(save,700);}
  function flush(){if(S.timer){clearTimeout(S.timer);S.timer=null;save();}}
  async function save(){
    clearTimeout(S.timer);S.timer=null;if(!S.sel)return;
    const sel=S.sel,f=Object.assign({},S.f,{r:tidyReason(S.f.r)}),before=S.d.recs[sel.n+'|'+sel.day];
    if(diseaseBlocked(f)){st(diseaseFullText(usedDisease(),DISEASE.max),'err');return;} // 질병 인정 한도 넘는 저장은 보내지 않음
    if(Q.on)return qSave(sel,f,before); // 대기열: 바로 칸에 보이고 모아 보냄
    st('저장 중…');
    // 시간은 담임이 고치지 않으므로 저장된 값(없으면 빈 값)을 그대로 보냅니다. portalSave는 보내지 않은 시간을 ''로 덮어 지우기 때문입니다.
    const keep=before||{},key=sel.n+'|'+sel.day;
    if(S.sigLoading)await S.sigLoading.catch(()=>{});
    const seen=sigOf(key); // 행 지문(시트 v23): 운영팀이 그사이 고쳤으면 시트가 {ok:false,conflict:true}
    const item={name:sel.n,date:sel.day,type:f.type,inT:keep.inT||'',outT:keep.outT||'',oa:keep.oa||'',ob:keep.ob||'',r:f.r};
    try{const res=await run('portalSave',Object.assign({cls:S.cls,pin:S.pin},item,seen===undefined?{}:{before:seen}));
      S.drafts.delete(draftKey(sel.n,sel.day)); // 시트가 답했으면(저장·입력 확인 거절 모두) 초안은 끝
      if(!res.ok&&(res.conflict||/^CONFLICT/.test(String(res.msg||'')))){qConflict(key,{item,before:before?Object.assign({},before):null,cls:S.cls},res.msg);qPaint();return;}
      if(!res.ok){st(sheetWait(res.msg,f.type,'다시 골라 주세요'),'err');return;} // 시트가 아직 해당없음·중복을 받지 않으면 '시트 업데이트 대기'
      sigSet(key,undefined);sigLater(); // 바로 저장 길은 새 지문을 돌려주지 않아 잠깐 뒤 묶음에서 다시 읽음
      if(!f.type)delete S.d.recs[key];else S.d.recs[key]=Object.assign({ev:'',evr:''},S.d.recs[key]||{},f);
      if(extraEvidenceStarted(before&&{type:before.type,reason:before.r},{type:f.type,reason:f.r}))extraAlert(sel,f);
      const b=R.querySelector('.g select[data-n="'+window.CSS.escape(sel.n)+'"][data-d="'+sel.day+'"]');if(b&&b.value!==f.type){b.value=f.type;paint(b,f.type);}
      // 시트 안내 가운데 시간 칸(입실 시간·퇴실 시간·외출 구간)은 담임이 채우지 않으므로 빼고 사유만 보입니다.
      // 중복(시트 계약 2026-10-20): portalSave는 시간 없이 저장하고 warn에 '겹친 시간 둘 이상…나중에 채워도 됩니다'를 붙이므로 그 글은 그대로 안내합니다.
      const raw=String(res.warn||'').trim(),w=raw.replace(/은 나중에 채워도 됩니다$/,'').split('·').filter(x=>x==='사유').join('·'),warn=/겹친 시간/.test(raw)?raw:w?w+'은 나중에 채워도 됩니다':'';
      if(S.sel===sel)syncNote(); // 저장된 기록 기준 안내(취업박람회 추가 증빙 배지 등)
      if(S.sel===sel)st(warn?'저장했습니다 · '+warn:'저장했습니다',warn?'warn':'ok');
    }catch(e){
      // 몰림(다시 시도 뒤에도 잠금 시간 초과·동시 실행 초과·응답 늦음): 고친 값은 초안으로 남기고 「다시 저장」을 보입니다. portalSave는 반·이름·날짜로 덮어쓰기라 다시 저장해도 같은 결과입니다.
      if(isSheetBusy(e)){S.drafts.set(draftKey(sel.n,sel.day),Object.assign({},f));if(S.sel===sel)busyNote(e);return;}
      st('저장하지 못했습니다 · '+e.message+' · 다시 골라 주세요','err');
    }
  }
  function busyNote(e){
    st(sheetBusyText(e.retries)+(e.code==='SHEET_TIMEOUT'?' · 저장됐는지 확인되지 않았습니다':'')+' · 고친 값은 남아 있습니다','err');
    const s=$('#st');if(!s)return;const b=document.createElement('button');b.className='chip';b.dataset.resave='';b.textContent='다시 저장';b.style.marginLeft='8px';b.onclick=()=>save();s.appendChild(b);
  }

  // 취업박람회 추가 증빙 알림(반 담임 + 관리자, notify.mjs '추가 증빙'). 알림을 못 남겨도 저장은 그대로입니다(notify가 작은 안내).
  function extraAlert(sel,f){
    const n=extraNotice({cls:S.cls,name:sel.n,date:sel.day,type:f.type});
    if(OPT.notify)return void OPT.notify(n,sel,f);
    import('./notify.mjs').then(m=>m.notify('추가 증빙',{audience:'admins',toClass:String(S.cls),cls:String(S.cls),title:n.title,body:n.body,link:'#b2ledger?cls='+S.cls+'&date='+sel.day})).catch(e=>console.warn('추가 증빙 알림을 남기지 못했습니다',e));
  }
  function vReason(){
    const d=S.d,rows=Object.entries(d.recs).filter(([k,r])=>r.type!=='출석').map(([k,r])=>{const i=k.lastIndexOf('|');return Object.assign({n:k.slice(0,i),day:k.slice(i+1)},r);}).sort((a,b)=>b.day.localeCompare(a.day)||a.n.localeCompare(b.n));
    const flag=r=>{const w=[];if(NEED[r.type]==='inT'&&!r.inT)w.push('입실 시간');if(NEED[r.type]==='outT'&&!r.outT)w.push('퇴실 시간');if(NEED[r.type]==='oa'&&(!r.oa||!r.ob))w.push('외출 구간');if(r.type===DUP&&dupParts(r).count<DUP_RULE.minParts)w.push('지각·조퇴·외출 시간');if(String(r.type).indexOf('인정')===0&&!r.r)w.push('사유');return w.join('·');};
    // 2026-10-20: 취업박람회 추가 증빙(기업면접 확인서) 배지와 '추가 증빙 · 취업박람회' 거르기(못 한 것만)
    const xOf=r=>extraEvidence({type:r.type,reason:r.r,ev:r.ev}),xOpen=r=>{const x=xOf(r);return !!x&&!x.done;},onlyX=!!S.onlyExtra,only=S.onlyMissing&&!onlyX,list=onlyX?rows.filter(xOpen):only?rows.filter(r=>flag(r)):rows;
    // 2026-10-19: 시트 칸 이름(가-3) 대신 쉬운 제목, 비었으면 '없습니다' 한 줄
    const empty=onlyX?'추가 증빙을 기다리는 취업박람회 기록이 없습니다.':only?'빠진 항목이 없습니다.':'지각·결석 등 출석이 아닌 기록이 아직 없습니다.';
    let h='<div class="card"><div class="sec">지각·결석 등 기록</div><div class="chips" style="margin-bottom:10px"><button class="chip" id="all" aria-pressed="'+(!only&&!onlyX)+'">전체 '+rows.length+'</button><button class="chip" id="mis" aria-pressed="'+(!!only)+'">빠진 항목 '+rows.filter(r=>flag(r)).length+'</button><button class="chip" id="xev" aria-pressed="'+onlyX+'">추가 증빙 · 취업박람회 '+rows.filter(xOpen).length+'</button></div>';
    h+='<div style="overflow-x:auto"><table class="list"><thead><tr><th>일자</th><th>이름</th><th>유형</th><th>시간</th><th>사유</th><th>증빙</th><th>빠진 항목</th></tr></thead><tbody>'+list.map(r=>'<tr class="click" data-n="'+esc(r.n)+'" data-d="'+r.day+'"><td>'+md(r.day)+'</td><td>'+esc(r.n)+'</td><td>'+esc(r.type)+'</td><td>'+[r.inT&&'입실 '+r.inT,r.outT&&'퇴실 '+r.outT,r.oa&&'외출 '+r.oa+'~'+(r.ob||'')].filter(Boolean).join(' ')+'</td><td>'+esc(r.r)+'</td><td>'+esc(r.ev||(String(r.type).indexOf('인정')===0?'미제출':''))+(xOf(r)?' <span class="xb'+(xOf(r).done?' ok':'')+'">'+esc(xOf(r).done?'추가 증빙 '+xOf(r).state:EXTRA_LABEL)+'</span>':'')+'</td><td style="color:var(--orange)">'+esc(flag(r))+'</td></tr>').join('')+(list.length?'':'<tr><td colspan="7" class="empty">'+empty+'</td></tr>')+'</tbody></table></div><div class="note" style="margin-top:6px">줄을 누르면 출결판에서 그 칸을 바로 엽니다.</div></div>';
    $('#v').innerHTML=h;
    $('#all').onclick=()=>{S.onlyMissing=false;S.onlyExtra=false;vReason();};$('#mis').onclick=()=>{S.onlyMissing=true;S.onlyExtra=false;vReason();};$('#xev').onclick=()=>{S.onlyExtra=true;S.onlyMissing=false;vReason();};
    R.querySelectorAll('tr.click').forEach(tr=>tr.onclick=()=>{S.tab='board';S.custom=false;S.sel={n:tr.dataset.n,day:tr.dataset.d};S.f=Object.assign({},S.d.recs[S.sel.n+'|'+S.sel.day]);render();if(OPT.onTab)OPT.onTab('board');});
  }

  function vInfo(){
    const d=S.d;
    // 2026-10-19: 제목·안내를 짧게, 줄마다 저장 단추를 누르기 쉬운 크기로(.ghost), 명부가 비면 한 줄 안내
    // 반 임원(반장·부반장·총무·앰버서더, 최초·보궐 이력)은 2026-10-20부터 우리 반 탭 맨 위의 beta2-officers.mjs(b2OfficerSave)가 다룹니다. 예전 portalSaveOfficer 칸은 뺐습니다.
    let h='';
    // 교육생 명부는 보기만(사용자 2026-10-20): 중도탈락·조기취업은 출결 › 중도탈락 탭(beta2-dropouts.mjs, 시트 중도탈락 탭)에서 신청하고 처리는 운영팀이 합니다.
    // 담임이 여기서 상태를 바로 바꾸던 portalSetStatus는 쓰지 않습니다(api/teacher-beta.js가 담임에게는 막음).
    h+='<div class="card"><div class="sec">교육생 명부 ('+d.kids.length+'명)</div><div class="note" style="margin-bottom:8px">중도탈락·조기취업한 학생은 「출결 › 중도탈락」에서 신청해 주세요. 신청하면 상태가 바뀌고 그 날짜 다음 교육일부터 출결판과 총원에서 빠지며, 판정·수료 처리는 운영팀이 합니다.</div>'+(OPT.onTab?'<button class="btn" id="goDropout" style="margin-bottom:10px">중도탈락·조기취업 신청하러 가기 →</button>':'')+'<div style="overflow-x:auto"><table class="list"><thead><tr><th>이름</th><th>상태</th><th>중도탈락·조기취업일</th><th></th></tr></thead><tbody>'+d.kids.map(k=>{const tag=k.status!=='재학'&&k.off?(k.off>d.mainDay?'<span style="color:var(--orange);font-weight:700">예정</span>':'<span style="color:var(--red);font-weight:700">적용</span>'):'';return '<tr><td>'+esc(k.name)+'</td><td>'+esc(k.status||'재학')+'</td><td>'+esc(k.status!=='재학'?k.off:'')+'</td><td>'+tag+'</td></tr>';}).join('')+(d.kids.length?'':'<tr><td colspan="4" class="empty">명부에 교육생이 없습니다. 운영팀에 알려 주세요.</td></tr>')+'</tbody></table></div></div>';
    $('#v').innerHTML=h;
    const gd=$('#goDropout');if(gd)gd.onclick=()=>OPT.onTab('dropout');
  }
  login();
  return { reload: () => reload(true), setClass: c => { OPT.cls = c; S.tab = OPT.tab || 'today'; S.sel = null; login(); },
    setTab: k => { if (S.tab === k || !TABS.some(t => t[0] === k)) return; if (S.d) { flush(); S.tab = k; render(); } else S.tab = k; },
    // 공통메모 알림에서 온 날: 출결판 위 공통메모 줄을 그날로(판에 없는 날이면 칸을 더함). 아직 불러오는 중이면 불러온 뒤 그날로 보입니다.
    showDay: x => { if (!typedDay(x)) return; S.memoDay = x; if (S.d && S.tab === 'board') { flush(); vBoard(); } } };
}

const TB_CSS = "\n.g td.cell .rs{font-size:10px;line-height:1.25;color:#3c4043;max-width:72px;margin:2px auto 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#f1f3f4;border-radius:4px;padding:1px 4px}\n\n.sec.row{display:flex;align-items:center;gap:8px}.sec.row small{font-size:13px;font-weight:600;color:var(--ink2);margin-left:4px}.sec.row .sp{flex:1}\n.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line2);font-weight:600}\n.card.today .sum div{border-radius:10px;background:#f8fafc;padding:10px 6px}.card.today .sum b{font-size:22px;line-height:1.2}.card.today .sum span{display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.card.today .sum .bad{background:#fdecea;border-color:#f4c7c3}.card.today .sum .bad b{color:var(--red)}.card.today .sum .warn{background:#fef7e0;border-color:#fce8b2}.card.today .sum .warn b{color:var(--orange)}\n.card.today{border-radius:10px}.card.today .close{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}.card.today .close .lab{margin:0;font-size:13px}\n\n:host{display:block;--navy:#073763;--ink:#1f1f1f;--ink2:#5f6368;--ink3:#80868b;--line:#dadce0;--line2:#9aa0a6;--blue:#1a73e8;--page:#f1f3f4;--red:#d93025;--orange:#e37400;--green:#188038;\n--ok:#f1f3f4;--okc:#5f6368;--lt:#fce8b2;--ltc:#7a4b00;--ab:#f4c7c3;--abc:#8c1d18;--rc:#b7e1cd;--rcc:#0d5c3c}\n*{box-sizing:border-box}\n#app{margin:0;color:var(--ink);font-size:14px;line-height:1.5}\nbutton,input,select,textarea{font:inherit;color:inherit}\n.bar{background:#fff;border:1px solid var(--line);padding:4px 12px;min-height:48px;display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;position:sticky;top:0;z-index:4}\n.bar .sub{font-size:13px;color:var(--ink2)}\n.bar .sp{flex:1}\n.beta{background:#ffd54f;color:#1f1f1f;font-weight:700;font-size:12px;padding:2px 8px;border-radius:3px}\n.bar #rf{background:#fff;border:1px solid var(--line2);color:var(--ink);border-radius:6px;padding:8px 14px;min-height:38px;cursor:pointer;font-size:13px}\nnav{display:flex;overflow-x:auto;max-width:100%}\nnav button{border:0;background:transparent;padding:10px 12px;cursor:pointer;color:var(--ink2);border-bottom:3px solid transparent;white-space:nowrap}\nnav button[aria-selected=true]{color:var(--ink);font-weight:700;border-bottom-color:var(--navy)}\nmain{padding:14px 0}\n.card{background:#fff;border:1px solid var(--line);padding:14px;margin-bottom:14px}\n.sec{font-size:16px;font-weight:700;margin:0 0 10px}\n.note{font-size:13px;line-height:1.55;color:var(--ink2)}\n.note.big{font-size:14px;color:var(--ink);margin-top:12px}\n.steps{margin:0 0 6px;padding-left:20px;font-size:13px;line-height:1.6}\n.login{max-width:380px;margin:60px auto}\n.login select,.login input{width:100%;padding:9px;border:1px solid var(--line2);border-radius:4px;margin-top:8px}\n.btn{background:var(--navy);color:#fff;border:0;border-radius:6px;padding:9px 16px;min-height:44px;cursor:pointer;font-weight:700;font-size:14px}\n.btn.go{display:inline-flex;align-items:center;margin-top:12px;padding:10px 22px;font-size:15px;background:var(--blue)}\n.ghost{padding:8px 14px;min-height:38px;border:1px solid var(--line2);border-radius:6px;background:#fff;cursor:pointer}\n.btn.block{width:100%;margin-top:10px}\n.err{color:var(--red);font-size:13px;margin-top:6px}\n.week{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));border:1px solid var(--line);overflow-x:auto}\n.wd{padding:8px 10px;border-right:1px solid var(--line);min-height:84px}\n.wd:last-child{border-right:0}\n.wd .h{font-size:12px;color:var(--ink2);border-bottom:3px solid #e00000;margin:-8px -10px 6px;padding:6px 10px 4px}\n.wd.now{background:#e8f0fe}.wd.off{background:var(--page);color:var(--ink3)}\n.wd .s{font-size:13px;font-weight:500}.wd .p{font-size:11px;color:var(--ink3)}\n.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}\n.sum div{border:1px solid var(--line);padding:8px;text-align:center}\n.sum b{display:block;font-size:20px}\n.sum span{font-size:11px;color:var(--ink2)}\n.chips{display:flex;flex-wrap:wrap;gap:6px}\n.chip{border:1px solid var(--line2);background:#fff;padding:8px 14px;min-height:40px;border-radius:6px;cursor:pointer;font-size:14px}\n.chip[aria-pressed=true]{border:2px solid var(--blue);padding:7px 13px;color:var(--blue);font-weight:700}\n.chip.g[aria-pressed=true]{border-color:var(--green);color:var(--green)}\n.chip.r[aria-pressed=true]{border-color:var(--red);color:var(--red)}\n.chip.n[aria-pressed=true]{border-color:var(--line2);color:var(--ink2)}\n.ck{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-bottom:1px solid var(--line);padding:8px 0}\n.ck:last-child{border-bottom:0}\n.wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px}\n@media(max-width:900px){.wrap{grid-template-columns:1fr}}\n.scroll{overflow:auto;max-width:100%;border:1px solid var(--line);background:#fff;max-height:70vh}\ntable.g{border-collapse:separate;border-spacing:0;font-size:12px}\n.g th,.g td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center;white-space:nowrap;background:#fff;padding:0}\n.g thead th{position:sticky;top:0;z-index:2;padding:6px;font-weight:500;color:var(--ink2);border-top:3px solid #e00000;border-bottom:3px solid #e00000}\n.g .nm{position:sticky;left:0;z-index:1;text-align:left;padding:0 10px;min-width:80px}\n.g thead .nm{z-index:3}\n.g th.today,.g td.today{background:#e8f0fe}\n.g thead th small{display:block;font-size:11px;font-weight:700;color:var(--blue)}\n.g thead th.off{color:var(--ink3)}\n.g thead th small.tag{color:var(--ink3);font-weight:500}\n.anyday input{border:1px solid var(--line2);border-radius:6px;padding:4px 6px;font:inherit}\n.g button{all:unset;display:flex;align-items:center;justify-content:center;width:44px;height:30px;cursor:pointer}\n.g button.sel{outline:2px solid var(--blue);outline-offset:-2px}\n.code{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 4px;border-radius:3px;font-weight:700}\n.k-ok{background:#e6f4ea;color:#137333;font-weight:500}.k-na{background:#fff;color:#9aa0a6;font-weight:400}.k-lt{background:var(--lt);color:var(--ltc)}.k-ab{background:var(--ab);color:var(--abc)}.k-rc{background:var(--rc);color:var(--rcc)}\n.panel{background:#fff;border:1px solid var(--line);padding:14px;position:sticky;top:56px;align-self:start}\n.panel h2{margin:0;font-size:16px}\n.lab{font-size:12px;color:var(--ink2);margin:10px 0 4px}\n.in{width:100%;border:1px solid var(--line2);border-radius:6px;padding:9px 10px;min-height:40px}\n.g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}\n.memo{font-family:Consolas,Menlo,monospace;font-size:12px;background:var(--page);border:1px solid var(--line);padding:7px 8px;display:flex;justify-content:space-between;gap:6px;align-items:center;word-break:break-all;margin-top:10px}\n.memo button{border:1px solid var(--line2);background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}\n.status{font-size:12px;margin-top:8px;min-height:16px;color:var(--ink3)}.status.ok{color:var(--green)}.status.warn{color:var(--orange)}.status.err{color:var(--red)}\ntable.list{border-collapse:collapse;width:100%;font-size:13px}\n.list th{text-align:left;font-weight:500;color:var(--ink2);border-top:3px solid #e00000;border-bottom:3px solid #e00000;padding:6px 8px;white-space:nowrap}\n.list td{border-bottom:1px solid var(--line);padding:9px 8px;vertical-align:top}\n.list td.empty{color:var(--ink3);text-align:center;padding:18px 8px}\n.list tr.click{cursor:pointer}.list tr.click:hover td{background:#f8f9fa}\n.form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-items:end}\n.form label{font-size:12px;color:var(--ink2);display:flex;flex-direction:column;gap:3px}\n.form .wide{grid-column:1/-1}\n.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#202124;color:#fff;padding:9px 16px;border-radius:4px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.on{opacity:1}\n:host(.busy){opacity:.6;pointer-events:none}\n.g td.cell{padding:2px}\n.g select{appearance:none;-webkit-appearance:none;border:1px solid transparent;border-radius:4px;width:66px;height:34px;font-size:13px;font-weight:700;text-align:center;text-align-last:center;cursor:pointer;padding:0 2px}\n.g select:focus{outline:2px solid var(--blue);outline-offset:-1px}\n.g select.sel{outline:2px solid var(--blue);outline-offset:-1px}\n.g select.k-na{font-weight:400;border:1px dashed #dadce0}\n.k-none,.chip.none{background:#e8eaed;color:#5f6368}.g select.k-none{font-weight:400}\n.k-dup,.chip.dup{background:#f9cb9c;color:#783f04}\n.rp{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}\n.rp select,.rp input{border:1px solid var(--line2);border-radius:6px;padding:7px 8px;min-height:40px;background:#fff;font-weight:600;min-width:0}\n.rp .b2-rmain{flex:1.4 1 0}.rp .b2-rsub{flex:1 1 0}.rp .b2-reason{flex:1 1 100%;font-weight:400}\n.rp select:focus,.rp input:focus{outline:2px solid var(--blue);outline-offset:-1px}\n.evb,.rn{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}.evb:empty,.rn:empty{display:none}.rn{margin-top:4px}\n.b2-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;background:#f1f5f9;color:#334155}\n.e-ok{background:#dcfce7;color:#166534}.e-miss{background:#fee2e2;color:#b91c1c}.e-none{background:#f1f5f9;color:#64748b}.e-extra{background:#ffedd5;color:#9a3412;box-shadow:inset 0 0 0 1px #fdba74}\n.b2-xnote{display:inline-block;padding:2px 8px;border-radius:6px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:12px;font-weight:800}\n.b2-err{color:var(--red);font-size:12px;font-weight:700}\n.b2-sub{display:block;width:100%;font-size:12px;color:var(--ink2)}\n.xb{display:inline-block;margin-top:3px;padding:1px 7px;border-radius:10px;background:#ffedd5;color:#9a3412;border:1px solid #fdba74;font-size:11px;font-weight:700;white-space:nowrap}\n.xb.ok{background:#dcfce7;color:#166534;border-color:#86efac}\n.qr{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}\n.qr button{border:1px solid var(--line2);background:#fff;border-radius:14px;padding:6px 12px;font-size:13px;cursor:pointer}\n.qr button.na{border-color:var(--navy);color:var(--navy);font-weight:700}\n.daymemo{margin:0 0 8px;padding:8px 12px;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#78350f;font-size:13px;line-height:1.55}\n.daymemo b{margin-right:6px}\n.daymemo span{white-space:pre-wrap;word-break:break-word}\n.daymemo small{display:block;color:#a16207;font-size:11px}\n.qbar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}.qbar:empty{display:none}\n.qbadge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}.qbadge.wait{background:#fef3c7;color:#92400e}.qbadge.fail{background:#fee2e2;color:#b91c1c}\n.g select.qwait{box-shadow:inset 0 0 0 2px #f59e0b}.g select.qfail{box-shadow:inset 0 0 0 2px var(--red)}\n.qerr{margin-top:8px;padding:8px 10px;border:1px solid #fca5a5;background:#fef2f2;color:#b91c1c;border-radius:6px;font-size:13px}\n.btn.sm{min-height:34px;padding:6px 12px;font-size:13px}\n";
