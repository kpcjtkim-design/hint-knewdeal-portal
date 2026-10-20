// 2기 내려받기: HRD 출결 업로드 파일(체크히어 저장본 + 마스터시트 명부). 단위기간 출석부는 1기 운영총괄을 읽던 화면이라
// 2기 출결원장 기준으로 다시 만든 뒤 엽니다(cohort.json features.periodRoster, 1단위가 끝나는 11/27 전).
import {esc,lifecycle,errorBox} from './beta2-ui.mjs';
import {feature,FEATURE_LATER_TEXT,withoutTestClasses} from './cohort.mjs';
export async function mount(host,{db,user,classes:all}){
 const classes=withoutTestClasses(all);// HRD 업로드·단위기간 출석부는 공식 반만(시험용 테스트반 뺌)
 const life=lifecycle(host),period=feature('periodRoster');let work=null;
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>내려받기</h2><p>${period?'단위기간 출석부와 HRD 출결 업로드 파일을 한곳에서 만듭니다.':'HRD 출결 업로드 파일을 만듭니다.'}</p></div></div>${period?'':`<div class="b2-banner readonly"><strong>단위기간 출석부</strong> ${esc(FEATURE_LATER_TEXT)}</div>`}</div><div id="b2Period"></div>`;
 const slot=host.querySelector('#b2Period');
 try{
  if(period){const m=await import('./attendance-period.mjs');if(life.alive())work=await m.mountAttendancePeriod(slot,{db,user,classes});}
  else{const [m,p]=await Promise.all([import('./attendance-upload.mjs'),import('./attendance-period.mjs')]);if(life.alive()){slot.innerHTML='<link rel="stylesheet" href="/metrics.css"><section id="b2Upload"></section>';const up=m.mountAttendanceUpload(slot.querySelector('#b2Upload'),{db,user,classes,loadLibraries:p.periodLibraries});work={canLeave:()=>!up.busy(),dispose:()=>up.dispose()};}}
 }catch(e){if(life.alive())slot.innerHTML=`<div class="b2">${errorBox(e)}</div>`;}
 return {canLeave:()=>work?.canLeave?.()??true,dispose:()=>{life.dispose();work?.dispose?.();}};
}
