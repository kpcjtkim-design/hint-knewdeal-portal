// 2기 베타 내려받기: 단위기간 출석부 + HRD 출결 업로드 파일(1기 기능 그대로, 체크히어·운영총괄 자료 기준)
import {esc,lifecycle,errorBox} from './beta2-ui.mjs';
export async function mount(host,{db,user,classes}){
 const life=lifecycle(host);let work=null;
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>내려받기</h2><p>단위기간 출석부와 HRD 출결 업로드 파일을 한곳에서 만듭니다.</p></div></div><div class="b2-banner readonly"><strong>1기 기준</strong> 단위기간 출석부는 1기 운영총괄, 업로드 파일은 체크히어 저장본(Firebase)과 마스터시트 명부를 씁니다. 2기 빌딩 때 출석부도 마스터시트 출결원장 기준으로 바꿉니다.</div></div><div id="b2Period"></div>`;
 try{const m=await import('./attendance-period.mjs');if(life.alive())work=await m.mountAttendancePeriod(host.querySelector('#b2Period'),{db,user,classes});}
 catch(e){if(life.alive())host.querySelector('#b2Period').innerHTML=`<div class="b2">${errorBox(e)}</div>`;}
 return {canLeave:()=>work?.canLeave?.()??true,dispose:()=>{life.dispose();work?.dispose?.();}};
}
