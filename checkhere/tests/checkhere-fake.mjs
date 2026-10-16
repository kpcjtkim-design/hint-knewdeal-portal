// 가짜 체크히어(가상 학생만, 브라우저 안에서 경로를 가로채 답함). 실제 체크히어·Firebase·127.0.0.1:8765에 닿지 않습니다.
// 화면: 강의 목록(HOME) → 반 강의 화면(일정 목록 JSON으로 날짜 줄과 '보기') → 출결상세(머리말·시간 기준 라디오·표 두 개·수정창).
// 가짜 admin-api: 출결상세 JSON(isRealTime false/true), 일정 목록 JSON, 변경·삭제 요청, 화면 세션(/api/auth/session).
// 2026-10-16 실제 확인한 동작을 흉내 냅니다(docs/cowork/2026-10-16-checkhere-write-format.md):
// - 화면은 관리자 API 요청마다 authorization·x-privacy-browser-session을, 해제된 탭이면 x-privacy-unmask-session도 붙입니다(읽기 GET 포함).
//   쓰기(변경·삭제)는 인증과 해제 헤더가 맞아야 받습니다(아니면 401·403, 바뀌는 것 없음).
// - 퇴실(COMPLETE) 삭제: 체크인한 학생의 계산된 1교시(PASS)도 함께 빔. 관리자 1교시(ATTEND)·입실은 그대로.
// - 퇴실이 남은 채 1교시(ATTEND) 삭제: 남은 기록으로 다시 계산 — 체크인 없는 학생은 입실·1교시가 퇴실 시간이 됨(깨끗하지 않음, 2-1).
// - 퇴실이 빈 뒤 1교시 삭제: 1교시·퇴실 두 칸 빔. 계산된 입실은 번호가 붙고 그 1교시 메모를 단 채 남을 수 있음(leftoverEnter, 2-2).
// - 변경(PUT update)에서 existEventId:null이면 빈 칸(또는 번호 없는 계산된 PASS)에 새로 넣음. 번호가 지금 기록과 다르면 404(옛 번호).
//   번호 있는 기록이 있는 칸에 existEventId:null은 받지 않음(409): 측정한 것은 빈 칸 새로 넣기뿐이고 실제 체크히어는 두 번째 기록을 만들 수 있어 시험이 엄격하게 봄.
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright,CheckHereCollector} from '../collector.mjs';
import {createBridge,BUILD} from '../server.mjs';
import {APPROVER,prepareApproval} from '../approval-core.mjs';
export const ADMIN='https://checkhere-admin-api.ihereapp.com',SITE='https://check.ihereapp.com';
export const iso=(d,t)=>`${d}T${t}`;
export const ev=(d,type,t,eventId,memo=null)=>({eventId,userId:'u-'+type,time:iso(d,t),baseTime:iso(d,type==='COMPLETE'?'18:00:00':'09:00:00'),timeIndex:0,type,isRecognized:false,status:'NORMAL',memoByAdmin:memo,updatedAt:null});
// 가상 학생 셋(이름·번호 모두 가짜). sequence는 이름 순서와 다릅니다(표는 이름순, 데이터는 순번순).
// 나가상: 체크인 없이 관리자가 넣은 학생(입실 번호 없음·관리자 1교시·퇴실). 가상하나·다가상: 체크인한 학생(입실 번호·계산된 1교시 PASS·퇴실).
export function roster(d,{extra=[]}={}){
  const base=[
    {attendeeId:'att-na',name:'나가상',phone:'01000000002',eventList:[ev(d,'ENTER','09:20:00',null),ev(d,'ATTEND','09:20:00','a2','지각_담임:가상담임(09:20)'),ev(d,'COMPLETE','18:00:00','c2')]},
    {attendeeId:'att-ga',name:'가상하나',phone:'01000000001',eventList:[ev(d,'ENTER','08:55:31','e1'),ev(d,'PASS','08:55:31',null),ev(d,'COMPLETE','17:50:08','c1')]},
    {attendeeId:'att-da',name:'다가상',phone:'01000000003',eventList:[ev(d,'ENTER','08:59:00','e3'),ev(d,'PASS','08:59:00',null),ev(d,'COMPLETE','15:00:00','c3','조퇴_담임:가상담임(15:00)')]},
    ...extra,
  ];
  return base.map((s,i)=>({sequence:i+1,attendeeId:s.attendeeId,typeAttendee:'STUDENT',name:s.name,userName:s.name,phone:s.phone,identifier:'가상과정',duration:'PT9H',seconds:32400,eventList:s.eventList,leaveEvents:{totalLeavedDuration:'PT0S',totalLeavedSeconds:0,pairs:[]}}));
}
export const urlOf=(sid,date)=>`${SITE}/history/lecture/modify?tab=STUDENT&academyId=A&lectureId=L2&scheduleId=${sid}&scheduleDate=${date}`;
const maskName=n=>n[0]+'**',maskPhone=p=>'010-****-'+p.slice(-4),showPhone=p=>`${p.slice(0,3)}-${p.slice(3,7)}-${p.slice(7)}`;
// 출결상세 화면(브라우저 안). cfg: mode('masked'|'unmasked'|'legacy'), left(남은 시간 글), hide(전화를 비워 보일 순번), skew(표만 다르게 보일 순번), confirm(저장 전 확인창),
// token(인증, 없으면 헤더 없음)·unmask(해제 세션, 해제된 탭만)·browser(탭 세션).
function dayApp(cfg){
  const $=s=>document.querySelector(s),sid=new URLSearchParams(location.search).get('scheduleId');
  window.clicks={cell:0,change:0,remove:0};let data=[];
  const hms=v=>v?String(v).slice(11,19):'-',of=(s,t)=>s.eventList.find(e=>t.includes(e.type));
  // 체크히어 화면처럼 관리자 API 요청마다 헤더를 붙입니다(해제된 탭만 해제 세션).
  const H=()=>({...(cfg.token?{Authorization:'Bearer '+cfg.token}:{}),'x-privacy-browser-session':cfg.browser,...(cfg.mode==='unmasked'&&cfg.unmask?{'x-privacy-unmask-session':cfg.unmask}:{})});
  const shown=s=>cfg.mode==='masked'?{name:s.name,phone:s.phone}:{name:cfg.plain[s.sequence].name,phone:cfg.hide.includes(s.sequence)?'':cfg.plain[s.sequence].phone};
  window.closeModal=()=>{$('#m').innerHTML='';};
  async function load(rt){const r=await fetch(cfg.api+'/api/v3/history/attendee/detail/academy/A/schedule/'+sid+'/type/STUDENT/isRealTime/'+rt,{headers:H()});if(!r.ok)return;data=(await r.json()).data.eventResultList;draw();}
  function draw(){
    const rows=data.map(s=>({s,v:shown(s)})).sort((a,b)=>a.v.name.localeCompare(b.v.name));
    $('#t').innerHTML='<table><tr><td>대상자</td></tr><tr><td></td><td>순번</td><td>성명</td><td>전화번호</td><td>메모</td></tr>'+rows.map(({s,v})=>'<tr><td></td><td>'+s.sequence+'</td><td>'+v.name+'</td><td>'+v.phone+'</td><td>'+s.identifier+'</td></tr>').join('')+'<tr><td>출석인원</td></tr></table>'
      +'<table><tr><td>강의시간</td></tr><tr><td>입실</td><td>09:00 ~ 18:00</td><td>퇴실</td><td>총 외출 시간(외출횟수)</td><td>총 강의 참여 시간</td></tr>'+rows.map(({s})=>'<tr><td>'+hms(of(s,['ENTER'])?.time)+'</td><td data-seq="'+s.sequence+'" data-f="entry">'+hms(of(s,['ATTEND','PASS'])?.time)+'</td><td data-seq="'+s.sequence+'" data-f="exit">'+(cfg.skew.includes(s.sequence)?'12:34:56':hms(of(s,['COMPLETE'])?.time))+'</td><td>0분 (-)</td><td>8시간</td></tr>').join('')+'<tr><td>합계</td></tr></table>';
    document.querySelectorAll('[data-f]').forEach(td=>td.onclick=()=>edit(+td.dataset.seq,td.dataset.f));
  }
  function edit(seq,f){
    clicks.cell++;if(cfg.mode==='masked'||cfg.broken){$('#toast').textContent='출석 시간을 수정하려면 개인정보 마스킹을 해제해 주세요.';return;}
    const s=data.find(x=>x.sequence===seq),e=of(s,f==='exit'?['COMPLETE']:['ATTEND','PASS']);
    // '삭제'는 기록 번호가 있는 칸의 수정창에만 있습니다(확인창 없이 바로 지움).
    $('#m').innerHTML='<div class="react-draggable"><p>'+(f==='entry'?'1교시':'퇴실')+' 시간 수정</p><input id="name" disabled value="'+shown(s).name+'"><input id="prevTime" disabled value="'+hms(e?.time)+'"><input id="modifyTime" value="'+(e?hms(e.time):'00:00:00')+'"><input id="memoByAdmin" value="'+(e?.memoByAdmin??'')+'">'+(e?.eventId?'<button id="remove">삭제</button>':'')+'<button id="change">변경</button><button onclick="closeModal()">취소</button></div>';
    $('#change').onclick=async()=>{
      clicks.change++;if(cfg.confirm&&!confirm('변경하시겠습니까?'))return;
      const body={scheduleId:sid,typeEvent:f==='exit'?'COMPLETE':'ATTEND',attendeeId:s.attendeeId,baseTime:e?.baseTime??null,existEventId:e?.eventId??null,time:cfg.date+'T'+$('#modifyTime').value,memoByAdmin:$('#memoByAdmin').value||null};
      const r=await fetch(cfg.api+'/api/v3/history/event/update',{method:'PUT',headers:{...H(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(r.ok){closeModal();await load(false);}else $('#toast').textContent='저장하지 못했습니다.';
    };
    if(e?.eventId)$('#remove').onclick=async()=>{
      clicks.remove++;const body={scheduleId:sid,typeEvent:f==='exit'?'COMPLETE':'ATTEND',attendeeId:s.attendeeId,baseTime:e.baseTime,existEventId:e.eventId};
      const r=await fetch(cfg.api+'/api/v3/history/event/delete',{method:'DELETE',headers:{...H(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(r.ok){closeModal();await load(false);}else $('#toast').textContent='삭제하지 못했습니다.';
    };
  }
  if(cfg.mode==='masked')$('#hd').innerHTML='<span>관리자</span><button id="unmask">개인정보 마스킹 해제</button>';
  else if(cfg.mode==='unmasked')$('#hd').innerHTML='<span>개인정보 원문 표시 중 '+cfg.left+'</span><button id="ext">연장</button><button id="end">종료</button>';
  // 시간 기준 라디오: 바꾸면 화면이 그 기준으로 다시 읽습니다(가린 화면의 실제 시간 기반은 다시 읽지 않음).
  $('#rt').onchange=()=>{if(cfg.mode!=='masked')load(true);};$('#allow').onchange=()=>load(false);load(false);
}
// 가짜 체크히어 하나: days = {scheduleId: {date, students}}. 바꿀 수 있는 것(w): mode, left, token(화면 인증, null이면 헤더 없음), unmask(해제 세션 값),
// hide·skew(순번 목록), broken(수정창 안 열림), confirm, plainJson, trueDelayMs, reject(상태 번호, 반영 안 함), applyThenFail(반영하고 500), skewFor(그 학생은 다른 시간으로 반영),
// leftoverEnter(관리자 1교시를 지우면 계산된 입실이 번호·메모를 달고 남음, 기본 켬), renumber(퇴실을 지우면 남은 ATTEND의 기록 번호가 바뀜 — 옛 번호로 지우면 404),
// ignoreDelete(그 종류의 삭제는 200을 주고 지우지 않음 — 덜 지워짐), afterWrite(받은 쓰기 뒤 부름: 시험이 남은 시간 등을 바꿈),
// passStays(퇴실을 지워도 계산된 1교시 PASS가 남음 — 측정과 다른 예외), attendWithExit(퇴실을 지우면 관리자 1교시 ATTEND도 함께 빔 — 측정 안 된 경우).
// 센 것: writes(받은 쓰기 본문), writeAt, auth·privacy(쓰기마다 인증·해제 헤더가 맞았는지), detailUnmask(읽기마다 해제 헤더가 있었는지).
export async function fakeSite(days,{mode='unmasked'}={}){
  const w={mode,days,left:'9분 30초',token:'fake-session-token-0001',unmask:'fake-unmask-session-0001',browser:'fake-browser-session-0001',hide:[],skew:[],broken:false,confirm:false,plainJson:false,trueDelayMs:0,reject:0,applyThenFail:false,skewFor:null,dataDate:null,leftoverEnter:true,renumber:false,ignoreDelete:null,afterWrite:null,passStays:false,attendWithExit:false,
    writes:[],writeAt:[],auth:[],privacy:[],detailUnmask:[],sessionCalls:0,detail:{true:0,false:0},scheduleLists:0,pages:{home:0,lecture:0,day:0},dayLoads:[],viewClicks:0};
  const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext();
  const quiet=f=>route=>f(route).catch(()=>{});
  await context.route('**/*',r=>r.abort().catch(()=>{}));
  const CORS={'access-control-allow-origin':SITE,'access-control-allow-methods':'GET, PUT, DELETE','access-control-allow-headers':'content-type, authorization, x-privacy-browser-session, x-privacy-unmask-session'};
  const studentOf=(sid,attendeeId)=>w.days[sid]?.students.find(x=>x.attendeeId===attendeeId);
  const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:CORS,body:JSON.stringify(body)});
  await context.route(ADMIN+'/**',quiet(async route=>{
    const req=route.request(),u=new URL(req.url()),h=req.headers();
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:CORS});
    const detail=/\/schedule\/([^/]+)\/type\/STUDENT\/isRealTime\/(true|false)$/.exec(u.pathname);
    if(detail){
      w.detail[detail[2]]++;w.detailUnmask.push(h['x-privacy-unmask-session']===w.unmask);if(detail[2]==='true'&&w.trueDelayMs)await new Promise(r=>setTimeout(r,w.trueDelayMs));
      const plain=w.mode==='legacy'||(w.mode==='unmasked'&&w.plainJson),list=(w.days[detail[1]]?.students||[]).map(s=>({...s,...(plain?{}:{name:maskName(s.name),userName:maskName(s.name),phone:maskPhone(s.phone),identifier:'*'})}));
      return json(route,{code:'OK',data:{eventResultList:list,...(w.dataDate?{scheduleDate:w.dataDate}:{})}});
    }
    if(/\/schedule\/list\/lecture\/L2\/start\//.test(u.pathname)){w.scheduleLists++;return json(route,{code:'OK',data:Object.entries(w.days).map(([sid,d])=>({scheduleId:sid,lectureId:'L2',scheduleDate:d.date,timeStart:d.date+'T09:00:00'}))});}
    const write=/\/api\/v3\/history\/event\/(update|delete)$/.exec(u.pathname);
    if(write){
      const body=JSON.parse(req.postData()||'{}'),authOk=!!w.token&&h.authorization===`Bearer ${w.token}`,unmaskOk=w.mode==='legacy'||(w.mode==='unmasked'&&h['x-privacy-unmask-session']===w.unmask);
      w.writes.push(body);w.writeAt.push(Date.now());w.auth.push(authOk);w.privacy.push(unmaskOk);
      if(!authOk)return json(route,{code:'UNAUTHORIZED'},401);
      if(!unmaskOk)return json(route,{code:'PRIVACY_UNMASK_REQUIRED'},403);
      if(w.reject)return json(route,{code:'FAIL'},w.reject);
      const s=studentOf(body.scheduleId,body.attendeeId),d=w.days[body.scheduleId]?.date;if(!s)return json(route,{code:'NOT_FOUND'},404);
      const find=type=>s.eventList.find(x=>x.type===type),hh=t=>String(t).slice(11,19);
      if(write[1]==='delete'){
        const e=s.eventList.find(x=>x.type===body.typeEvent&&x.eventId&&x.eventId===body.existEventId);if(!e)return json(route,{code:'NOT_FOUND'},404);
        if(w.ignoreDelete===e.type){w.afterWrite?.(body);return json(route,{code:'OK'});}
        s.eventList=s.eventList.filter(x=>x!==e);
        if(e.type==='COMPLETE'){
          if(!w.passStays)s.eventList=s.eventList.filter(x=>x.type!=='PASS');// 체크인한 학생의 계산된 1교시도 비움
          if(w.attendWithExit)s.eventList=s.eventList.filter(x=>x.type!=='ATTEND');
          if(w.renumber){const a=find('ATTEND');if(a?.eventId)a.eventId='a-renum-'+w.writes.length;}
        }else{
          const enter=find('ENTER'),exit=find('COMPLETE');
          if(exit){// 퇴실이 남은 채 1교시를 지움: 남은 기록으로 다시 계산(2-1)
            if(enter?.eventId)s.eventList.push(ev(d,'PASS',hh(enter.time),null));
            else{if(enter)enter.time=exit.time;else s.eventList.unshift(ev(d,'ENTER',hh(exit.time),null));s.eventList.push(ev(d,'PASS',hh(exit.time),null));}
          }else if(enter&&!enter.eventId){if(w.leftoverEnter){enter.eventId='enter-left-'+w.writes.length;enter.memoByAdmin=e.memoByAdmin;}else s.eventList=s.eventList.filter(x=>x!==enter);}
        }
      }else{
        const kinds=body.typeEvent==='COMPLETE'?['COMPLETE']:['ATTEND','PASS'];let e=s.eventList.find(x=>kinds.includes(x.type));
        if(body.existEventId&&e?.eventId!==body.existEventId)return json(route,{code:'NOT_FOUND'},404);
        if(!body.existEventId&&e?.eventId)return json(route,{code:'EXIST_EVENT_REQUIRED'},409);
        const time=w.skewFor===body.attendeeId?body.time.slice(0,17)+'01':body.time;
        if(!e){e={eventId:'new-'+w.writes.length,userId:'u',time,baseTime:body.baseTime,timeIndex:0,type:body.typeEvent,isRecognized:false,status:'NORMAL',memoByAdmin:body.memoByAdmin,updatedAt:null};s.eventList.push(e);}
        else{e.time=time;e.memoByAdmin=body.memoByAdmin;if(e.type==='PASS'){e.type='ATTEND';e.eventId='new-'+w.writes.length;}}
        // 빈 1교시에 새로 넣으면 계산된 입실도 그 시간으로(체크인 없는 학생)
        if(body.typeEvent==='ATTEND'&&!find('ENTER'))s.eventList.unshift(ev(d,'ENTER',hh(time),null));
      }
      w.afterWrite?.(body);
      if(w.applyThenFail){w.applyThenFail=false;return json(route,{code:'TIMEOUT'},500);}
      return json(route,{code:'OK'});
    }
    return json(route,{},404);
  }));
  await context.route(SITE+'/**',quiet(async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/auth/session'){w.sessionCalls++;return route.fulfill({contentType:'application/json',body:JSON.stringify(w.token?{accessToken:w.token,user:{}}:{})});}
    const page=(body,head='')=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><a href="/account/admin">관리자</a>${head}${body}`});
    if(u.pathname==='/history/lecture'){w.pages.home++;return page(`<table><tr><td>[2반] 가상강의 (가상담임)</td><td><button onclick="location.href='/history/lecture/L2?academyId=A'">보기</button></td></tr></table>`);}
    if(u.pathname==='/history/lecture/L2'){
      w.pages.lecture++;
      return page(`<table id="t"></table><script>fetch('${ADMIN}/api/v3/schedule/list/lecture/L2/start/2026-08-01T00:00:00/end/2026-12-31T23:59:59').then(r=>r.json()).then(j=>{document.querySelector('#t').innerHTML=j.data.map(s=>'<tr><td>'+s.scheduleDate+'</td><td><button data-u="/history/lecture/modify?tab=STUDENT&academyId=A&lectureId=L2&scheduleId='+s.scheduleId+'&scheduleDate='+s.scheduleDate+'&via=click">보기</button></td></tr>').join('');document.querySelectorAll('[data-u]').forEach(b=>b.onclick=()=>location.href=b.dataset.u);});</script>`);
    }
    if(u.pathname==='/history/lecture/modify'){
      const sid=u.searchParams.get('scheduleId'),day=w.days[sid]||Object.values(w.days)[0];w.pages.day++;w.dayLoads.push({sid,at:Date.now()});if(u.searchParams.get('via')==='click')w.viewClicks++;
      const cfg={api:ADMIN,mode:w.mode,left:w.left,date:day.date,hide:w.hide,skew:w.skew,broken:w.broken,confirm:w.confirm,token:w.token,unmask:w.unmask,browser:w.browser,plain:Object.fromEntries(day.students.map(s=>[s.sequence,{name:s.name,phone:showPhone(s.phone)}]))};
      return page(`<header id="hd"></header><h2>[2반] 가상강의 (가상담임) | ${day.date} 출석부</h2><label><input type="radio" name="basis" id="rt">실제 시간 기반</label><label><input type="radio" name="basis" id="allow" checked>강의 출석/퇴실 허용 시간 기반</label><button>초</button><button>표시</button><div id="t"></div><div id="m"></div><div id="toast"></div><script>(${dayApp.toString()})(${JSON.stringify(cfg)})</script>`);
    }
    return route.fulfill({status:404,body:'{}'});
  }));
  const page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(SITE+'/history/lecture');w.pages.home=0;
  return {w,browser,page,close:()=>browser.close()};
}
// 가짜 승인 저장소(가상 요청만): 확인·읽기·잡기·끝내기. claim 수와 끝낸 결과를 셉니다.
export function fakeCloud(docs,{verifyToken='fixture-admin'}={}){
  const calls={claim:0,finish:0,approveExisting:0};
  return {calls,cloud:{verify:async t=>{if(t!==verifyToken)throw Error('관리자 권한 없음');},
    get:async id=>({id,data:structuredClone(docs.get(id))}),
    claim:async(doc,t,attemptId)=>{calls.claim++;const d=docs.get(doc.id);if(d.status!=='approved')throw Error('이미 반영 중이거나 처리된 요청입니다.');Object.assign(d,{status:'applying',attemptId});},
    approveExisting:async()=>{calls.approveExisting++;throw Error('쓰지 않음');},
    finish:async(id,t,attemptId,job)=>{calls.finish++;const d=docs.get(id);Object.assign(d,{status:job.status,result:{message:job.message,results:job.results||[],platformSaved:job.status==='verified',current:job.current??null}});return d.result;}}};
}
// 가짜 체크히어 + 진짜 연결 프로그램(수집기·서버) + 가짜 승인 저장소. 먼저 한 번 수집해 학생 번호 연결을 배웁니다(가상 학생만, 다른 포트).
// approve(id,이름,changes,deleteTimes?): 그 학생의 지금 저장본으로 승인된 요청을 만듭니다. apply(id,{writer,...}): /api/apply.
export async function bridgeWorld(port,prefix,{sendGapMs=[0,0],itemGapMs=[0,0],date='2026-10-05',bridge={}}={}){
  const s=await fakeSite({S1:{date,students:roster(date)}}),docs=new Map(),fake=fakeCloud(docs);
  const c=new CheckHereCollector('',{page:s.page,dayGapMs:[0,0],sendGapMs});c.urls.set('2|'+date,urlOf('S1',date));
  s.page.on('dialog',d=>c.onDialog(d));// 전용 크롬을 열 때(connect)와 같은 확인창 처리
  mkdirSync(join(import.meta.dirname,'../test-results'),{recursive:true});
  const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/'+prefix));
  const app=createBridge({dataDir,collector:c,port,approvalCloud:fake.cloud,itemGapMs,learnTickMs:600000,...bridge});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const base=`http://127.0.0.1:${port}/api/`,headers=origin=>({'x-hint-key':app.key,'content-type':'application/json',connection:'close',...(origin?{origin}:{})});
  const call=async(path,body={},{origin}={})=>{const r=await fetch(base+path,{method:'POST',headers:headers(origin),body:JSON.stringify(body)});return {code:r.status,body:await r.json()};};
  const get=async path=>(await fetch(base+path,{headers:headers()})).json();
  const state=()=>get('state?delta=1');
  const done=async id=>{for(let i=0;i<600;i++){const j=(await state()).jobs.find(x=>x.id===id);if(j&&j.status!=='running'&&(j.kind!=='apply'||Object.hasOwn(j,'cloudSaved')))return j;await new Promise(r=>setTimeout(r,50));}throw Error('작업이 끝나지 않았습니다.');};
  let j=await call('sync',{classId:'2',dates:[date],mode:'incremental'});j=await done(j.body.id);if(j.status!=='complete')throw Error('첫 수집 실패: '+j.message);
  const record=name=>app.db.prepare('SELECT payload FROM snapshots ORDER BY seq DESC').all().map(x=>JSON.parse(x.payload)).find(r=>r.name===name);
  const approve=(id,name,changes,deleteTimes)=>{const r=record(name),req={classId:'2',date,name,phoneLast4:r.phoneLast4,reason:'가상 사유',changes,...(deleteTimes?{deleteTimes}:{}),status:'approved',createdBy:APPROVER,approvedBy:APPROVER};req.approval=prepareApproval(req,r,{allowAlreadyApplied:true});docs.set(id,req);return id;};
  const apply=(id,extra={})=>call('apply',{approvalId:id,idToken:'fixture-admin',...extra});
  const unlock=()=>app.db.prepare('INSERT INTO writer_unlocks(build,jobId,at) VALUES(?,?,?)').run(BUILD,'fixture',new Date().toISOString());
  // 출결상세 표 한 줄(가상 이름으로): [입실, 1교시, 퇴실]
  const row=async name=>s.page.evaluate(n=>{const roster=[...document.querySelectorAll('table')[0].rows],times=[...document.querySelectorAll('table')[1].rows],i=roster.findIndex(r=>r.cells[2]?.innerText.trim()===n);return i<0?null:[...times[i].cells].slice(0,3).map(c=>c.innerText.trim());},name);
  return {s,w:s.w,docs,fake,c,app,dataDir,date,call,get,state,done,record,approve,apply,unlock,row,close:async()=>{app.close();await s.close();}};
}
