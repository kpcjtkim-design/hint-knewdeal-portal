// 2기 내려받기: 단위기간 출석부(1기와 같은 양식, 2기 마스터시트 출결원장 기준, attendance-period-b2.mjs)와 HRD 출결 업로드 파일(체크히어 저장본 + 마스터시트 명부).
// 단위기간 출석부는 cohort.json features.periodRoster가 켜져 있을 때만 보입니다(사용자 2026-10-20 "단위기간 출석부 양식은 같음. 1기 양식이랑").
import {esc,lifecycle,errorBox} from './beta2-ui.mjs';
import {feature,FEATURE_LATER_TEXT,withoutTestClasses} from './cohort.mjs';
export async function mount(host,{db,user,classes:all,client}){
 const classes=withoutTestClasses(all);// HRD 업로드는 공식 반만. 단위기간 출석부는 테스트반도 고를 수 있게(기본은 빠짐) 전체 목록을 넘깁니다.
 const life=lifecycle(host),period=feature('periodRoster');let works=[];
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>내려받기</h2><p>${period?'단위기간 출석부와 HRD 출결 업로드 파일을 한곳에서 만듭니다.':'HRD 출결 업로드 파일을 만듭니다.'}</p></div></div>${period?'<div id="b2PeriodRoster"></div><div id="b2UnitFolders"></div>':`<div class="b2-banner readonly"><strong>단위기간 출석부</strong> ${esc(FEATURE_LATER_TEXT)}</div>`}</div><div id="b2Period"></div>`;
 const slot=host.querySelector('#b2Period');
 // Excel 도구(ExcelJS·JSZip)는 1기 화면과 같은 것을 씁니다. 두 기능은 따로 불러와 한쪽이 실패해도 다른 쪽은 열립니다.
 const libraries=()=>import('./excel-libraries.mjs').then(p=>p.periodLibraries());
 if(period){const roster=host.querySelector('#b2PeriodRoster');
  try{const r=await import('./attendance-period-b2.mjs?v=20261023-cap');if(life.alive())works.push(r.mountB2Period(roster,{client,classes:all,loadLibraries:libraries}));}
  catch(e){if(life.alive())roster.innerHTML=errorBox(e);}
  // 단위기간 폴더 바로가기(drive-links.mjs, 2026-10-21): 반·단위마다 1. 단위기간출석부 · 2. 출석입력요청대장 · 3. 출석인정서류(구글 드라이브). 펼칠 때 읽습니다.
  import('./drive-links.mjs?v=20261021-rd1').then(m=>{if(life.alive())works.push(m.mountUnitFolders(host.querySelector('#b2UnitFolders'),{client,classes}));}).catch(()=>{});}
 try{
  const m=await import('./attendance-upload.mjs');
  if(life.alive()){slot.innerHTML='<link rel="stylesheet" href="/metrics.css"><section id="b2Upload"></section>';const up=m.mountAttendanceUpload(slot.querySelector('#b2Upload'),{db,user,classes,loadLibraries:libraries});works.push({canLeave:()=>!up.busy(),dispose:()=>up.dispose()});}
 }catch(e){if(life.alive())slot.innerHTML=`<div class="b2">${errorBox(e)}</div>`;}
 return {canLeave:()=>works.every(w=>w.canLeave?.()??true),dispose:()=>{life.dispose();works.forEach(w=>w.dispose?.());}};
}
