// 2기 관리자 화면 묶음. index.html이 b2로 시작하는 탭을 여기로 넘깁니다. 고른 화면만 불러옵니다.
import {createBeta2Client,onBeta2Rev,lastBeta2Rev} from './beta2-data.mjs';
import {ensureBeta2Css,errorBox,toast} from './beta2-ui.mjs';
import {loadReasonCatalog} from './reason-catalog-store.mjs';
const SCREENS={b2home:()=>import('./beta2-home.mjs?v=20261020-du1'),b2class:()=>import('./beta2-class.mjs?v=20261020-tt2'),b2ledger:()=>import('./beta2-ledger.mjs?v=20261020-du1'),b2status:()=>import('./beta2-status.mjs'),b2downloads:()=>import('./beta2-downloads.mjs?v=20261020-tt2'),b2docs:()=>import('./beta2-docs.mjs?v=20261020-co1'),b2vocs:()=>import('./beta2-voc.mjs?v=20261020-co1'),
 b2times:()=>import('./beta2-times.mjs'),b2roster:()=>import('./beta2-roster.mjs?v=20261020-rb1'),b2notify:()=>import('./notify-inbox.mjs'),b2dropouts:()=>import('./beta2-dropouts.mjs?v=20261020-tt2'),b2reasons:()=>import('./beta2-reasons.mjs'),
 b2officers:()=>import('./beta2-officers.mjs?v=20261020-of1')}; // 교육시간 조정·교육생 상태(2026-10-19) b2notify: 홈 › 알림(알림함) b2dropouts: 출결 › 중도탈락·수료(2026-10-20) b2reasons: 공지·설정 › 사유 목록(2026-10-20) b2officers: 출결 › 반 임원(2026-10-20) b2class: 출결 › 반 현황(홈 반 카드, 2026-10-20)
export async function mountBeta2Admin(host,{db,user,classes,tab,selected,context,open}){
 ensureBeta2Css();
 const client=createBeta2Client(user,{db});
 watchVoc(client,open,tab);
 // 사유 목록(settings/reasonCatalog)을 먼저 읽어 드롭다운·해석기가 같은 목록을 씁니다(문서가 깨졌거나 못 읽으면 기본 목록 + 경고 한 번).
 const reasons=loadReasonCatalog(db,user).then(r=>{if(r.firstWarning)toast(r.warning);}).catch(()=>{});
 try{const [m]=await Promise.all([SCREENS[tab](),reasons]);if(!host.isConnected)return null;return await m.mount(host,{db,user,classes,client,selected,context,open});}
 catch(e){if(host.isConnected)host.innerHTML=`<div class="b2">${errorBox(e)}</div>`;return null;}
}

// 민원·이슈 실시간 알림(2026-10-16 회의): 관리자 어느 화면에 있든 '답변 대기' 건수를 오른쪽 아래에 띄우고, 새 글이 오면 알립니다.
// 건수는 변경 번호 응답(b2Rev의 voc, 시트를 읽지 않음)으로 압니다. 다른 화면이 1분 안에 확인했으면 따로 묻지 않습니다.
let vocWatch=null;
function watchVoc(client,open,tab){
 if(vocWatch){vocWatch.client=client;vocWatch.open=open;vocWatch.tab=tab;vocWatch.paint();return;}
 const w=vocWatch={client,open,tab,count:null,el:null,paint:()=>{}};
 w.paint=()=>{
  const n=w.count||0;
  if(!n||w.tab==='b2vocs'){w.el?.remove();w.el=null;return;}
  if(!w.el){w.el=document.createElement('button');w.el.className='b2-vocpill';w.el.type='button';w.el.onclick=()=>w.open?.('b2vocs');document.body.append(w.el);}
  w.el.textContent=`민원·이슈 답변 대기 ${n}건`;
 };
 onBeta2Rev(r=>{
  const v=r?.voc;if(!v)return;
  const n=+v.admin||0,before=w.count;w.count=n;w.paint();
  if(before!==null&&n>before){toast(`새 민원·이슈 글이 왔습니다 · 답변 대기 ${n}건`);w.el?.classList.add('hot');setTimeout(()=>w.el?.classList.remove('hot'),4000);}
 });
 const tick=()=>{if(document.hidden||Date.now()-lastBeta2Rev().at<55000)return;w.client.rev().catch(()=>{});};
 setInterval(tick,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
 tick();
}
