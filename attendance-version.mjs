import {modernAttendance} from './attendance-rollout.mjs';

// Only the selected view is imported and mounted. A view switch disposes its reads first.
export async function mountAttendanceVersion(host,ctx){
 const key='hintAttendanceView:'+String(ctx.user.email||'').trim().toLowerCase();
 let selected=modernAttendance(ctx.user,ctx.profile)?'modern':'legacy';
 try{const saved=localStorage.getItem(key);if(['modern','legacy'].includes(saved))selected=saved;}catch{}
 host.innerHTML='<section class="card attendance-native-shell"><div class="attendance-native-head"><h3>출결대조</h3><label style="display:flex;align-items:center;gap:10px;margin:10px 0">화면 선택 <select id="attendanceVersion" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px"><option value="legacy">구버전 · 조회와 메모</option><option value="modern">신버전 · 입력과 체크히어 대조</option></select></label><p id="attendanceVersionHint"></p></div><div id="attendanceVersionBody"></div></section>';
 const select=host.querySelector('#attendanceVersion'),body=host.querySelector('#attendanceVersionBody'),hint=host.querySelector('#attendanceVersionHint');
 let work=null,disposed=false,epoch=0;
 async function show(version){
  if(work?.canLeave&&!work.canLeave()){select.value=selected;return;}
  selected=version;select.value=version;const n=++epoch;work?.dispose?.();work=null;
  const mount=document.createElement('div');mount.id='attendanceOverviewMount';mount.className='attendance-native-mount';body.replaceChildren(mount);
  hint.textContent=version==='modern'?'시트 입력·체크히어 추천사유 대조 · 현재 선택한 화면만 데이터를 읽습니다.':'시트 조회·포털 관리자 메모 · 현재 선택한 화면만 데이터를 읽습니다.';
  try{const mod=await import(version==='modern'?'./attendance-overview.js?v=20260915-admin2':'./attendance-legacy.js?v=20260915-admin2');
   if(disposed||n!==epoch||!mount.isConnected)return;
   const next=await mod.mountAttendanceOverview(mount,ctx);
   if(disposed||n!==epoch||!mount.isConnected)next?.dispose?.();else work=next;
  }catch(e){if(n===epoch&&!disposed)mount.textContent='출결대조를 불러오지 못했습니다. '+e.message;}
 }
 select.onchange=async()=>{const requested=select.value;await show(requested);if(selected===requested)try{localStorage.setItem(key,selected);}catch{}};
 void show(selected);
 return {canLeave:()=>work?.canLeave?.()??true,dispose(){disposed=true;epoch++;work?.dispose?.();work=null;body.replaceChildren();}};
}
