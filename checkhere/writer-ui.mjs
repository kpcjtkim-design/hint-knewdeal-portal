// 연결 프로그램의 이 PC 화면(127.0.0.1:8765/writer, 포털 아님): 체크히어 가림 상태 한 줄(15초마다)과 순차 수정 첫 실행 「확인했음」 단추만.
// 이름·번호·헤더 값은 없습니다(연결 프로그램 /api/status의 privacy·requestWriter만 봄). 해제·연장은 사람이 체크히어 탭에서 합니다.
const $=s=>document.querySelector(s);let key='',rearm=false;
// 첫 1건이 끝까지 확인되지 않은 상태(작업 상태 → 글)
const FAILED={failed:'실패',partial:'일부만 확인',conflict:'충돌',unknown:'결과 미확인',interrupted:'중단'};
async function api(path,body){
  const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'x-hint-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'연결 프로그램 응답 오류');return j;
}
async function paint(){
  try{
    const s=await api('status'),w=s.requestWriter||{},f=w.firstRun||{};
    $('#privacy').textContent=s.privacy?.text||'체크히어 해제 상태 확인 중';
    $('#writer').textContent=`순차 수정 형식: ${w.builtin?'내장(2026-10-16 기록)':'없음'}${w.recorded?.length?` + 이 PC 기록(${w.recorded.join('·')})`:''} · 첫 실행: ${f.unlocked?'확인 완료(순차 수정 사용)':f.waitingConfirm?'1건 반영·저장됨 — 체크히어에서 그 기록을 확인한 뒤 「확인했음」(그 전까지 나머지는 수정창)':f.failedFirst?`첫 1건이 끝까지 확인되지 않음(${FAILED[f.failedFirst]||f.failedFirst}) — 체크히어 원본을 확인한 뒤 「확인했음」을 누르면 다음 1건만 다시 순차 수정(그 전까지 나머지는 수정창)`:'아직 없음(다음 반영 1건이 순차 수정)'}`;
    rearm=!f.waitingConfirm&&!!f.failedFirst;$('#confirm').disabled=!f.waitingConfirm&&!f.failedFirst;
  }catch(e){$('#privacy').textContent=e.message;}
}
$('#confirm').onclick=async()=>{
  $('#confirm').disabled=true;
  try{const again=rearm,w=await api('request-writer/confirm',{});$('#note').textContent=w.firstRun?.unlocked?'확인했음 · 이제 순차 수정으로 반영합니다.':again?'확인했음 · 다음 반영 1건만 다시 순차 수정으로 해 봅니다.':'';}catch(e){$('#note').textContent=e.message;}
  await paint();
};
try{key=(await(await fetch('/api/session',{cache:'no-store'})).json()).key||'';}catch{}
await paint();setInterval(()=>{void paint();},15000);
