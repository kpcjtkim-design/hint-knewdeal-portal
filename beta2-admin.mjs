// 2기 베타(/beta2) 관리자 화면 묶음. index.html이 b2로 시작하는 탭을 여기로 넘깁니다. 고른 화면만 불러옵니다.
import {createBeta2Client} from './beta2-data.mjs';
import {ensureBeta2Css,errorBox} from './beta2-ui.mjs';
const SCREENS={b2home:()=>import('./beta2-home.mjs'),b2ledger:()=>import('./beta2-ledger.mjs'),b2status:()=>import('./beta2-status.mjs'),b2downloads:()=>import('./beta2-downloads.mjs'),b2docs:()=>import('./beta2-docs.mjs')};
export async function mountBeta2Admin(host,{db,user,classes,tab,selected,context,open}){
 ensureBeta2Css();
 const client=createBeta2Client(user,{db});
 try{const m=await SCREENS[tab]();if(!host.isConnected)return null;return await m.mount(host,{db,user,classes,client,selected,context,open});}
 catch(e){if(host.isConnected)host.innerHTML=`<div class="b2">${errorBox(e)}</div>`;return null;}
}
