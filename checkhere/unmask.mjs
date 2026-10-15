// 체크히어 '개인정보 마스킹 해제' 창을 연결 프로그램의 그 탭(전용 크롬)에서 사람 대신 여는 부분만 따로 둡니다.
// 첫 실제 사용 뒤 고치기 쉽게 이 파일 안에서만 선택자를 바꿉니다. 모양이 예상과 다르면 바로 멈추고 사람에게 직접 해제를 부탁합니다.
// 하지 않는 일: 메일함 읽기, 인증번호 만들기·추측, 사유를 지어내기, '연장'·'종료' 누르기, 가림을 코드로 풀기.
// 사유는 연결 프로그램이 기다리는 실제 일(masking.mjs unmaskReason)이고, 인증번호는 사람이 화면에 넣은 값만 칩니다.
import {parseRemaining} from './masking.mjs';
export const UNMASK={
  open:'개인정보 마스킹 해제',
  reasonLabel:'개인정보 마스킹 해제 사유',
  shown:/개인정보\s*원문\s*표시\s*중/,
  // 인증번호 보내기 버튼(문구가 정확하지 않아 넓게 봅니다. 하나만 보여야 누름)
  send:/인증\s*번호\s*(?:발송|전송|받기|요청|보내기)|인증\s*(?:요청|발송)|^\s*(?:발송|전송|재전송)\s*$/,
  confirm:/^\s*(?:확인|인증|인증하기|인증\s*확인|해제|해제하기|완료)\s*$/,
  cancel:/^\s*(?:취소|닫기)\s*$/,
  never:/연장|종료/,
};
const FIELDS='textarea, input[type="text"], input:not([type])';
const CODE='input[maxlength="6"], input[autocomplete="one-time-code"], input[placeholder*="인증"]';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 직접 해제할 때도 그 탭이어야 하고(새 탭은 다시 가려짐), 해제 창이 열린 동안 연결 프로그램은 화면을 옮기지 않습니다(collector.notUnmasking).
const ui=why=>Error(`UNMASK_UI: ${why} 연결 프로그램 전용 크롬의 그 탭에서(새 탭은 다시 가려짐) 직접 「개인정보 마스킹 해제」를 눌러 해제해 주세요. 해제하는 동안 연결 프로그램은 화면을 옮기지 않습니다.`);
async function visible(locator){const out=[];const n=await locator.count();for(let i=0;i<n;i++){const x=locator.nth(i);if(await x.isVisible().catch(()=>false))out.push(x);}return out;}
async function one(locator){const v=await visible(locator);return v.length===1?v[0]:null;}
async function waitOne(find,timeout){const until=Date.now()+timeout;for(;;){const x=await find();if(x)return x;if(Date.now()>=until)return null;await sleep(200);}}
// '연장'·'종료'(또는 그런 글이 붙은 버튼)는 어떤 경우에도 누르지 않습니다.
async function safeClick(button){const text=(await button.innerText().catch(()=>''))||(await button.getAttribute('aria-label').catch(()=>''))||'';if(UNMASK.never.test(text))throw ui('누르면 안 되는 버튼이 골라졌습니다.');await button.click();}
// 머리말만 봅니다(이동·클릭 없음): 'masked' 해제 버튼 | 'unmasked' 원문 표시 중(남은 초) | 'both' | 'none'
export async function headerState(page){
  if(typeof page?.evaluate!=='function')return {state:'none',remaining:null};
  // 보이는 글만 봅니다(innerText: script 안의 문구·숨은 요소 제외 — Next.js 화면은 script에 같은 문구를 담고 있을 수 있음).
  const s=await page.evaluate(open=>{
    const text=(document.body?.innerText||'').replace(/\s+/g,' ');
    const button=[...document.querySelectorAll('button,a,[role="button"]')].some(b=>b.getClientRects().length>0&&b.textContent.replace(/\s+/g,' ').trim()===open);
    const at=text.search(/개인정보\s*원문\s*표시\s*중/);return {button,shown:at>=0?text.slice(at,at+40):''};
  },UNMASK.open);
  const shown=!!s.shown,state=shown&&s.button?'both':shown?'unmasked':s.button?'masked':'none';
  return {state,remaining:shown?parseRemaining(s.shown):null};
}
async function reasonField(page){
  const byLabel=await one(page.getByLabel(UNMASK.reasonLabel));if(byLabel)return byLabel;
  const box=page.locator('[role="dialog"], form, section, div').filter({hasText:UNMASK.reasonLabel}).filter({has:page.locator(FIELDS)});
  if(await box.count()){const inBox=await one(box.last().locator(FIELDS));if(inBox)return inBox;}
  return one(page.getByPlaceholder(/사유/));
}
const codeField=async page=>(await one(page.locator(CODE)))||one(page.getByLabel(/인증\s*번호/));
// 해제 창을 열고 사유를 넣고 인증번호를 보내게 합니다. 인증번호 칸이 보이면 {stage:'code'}.
export async function startUnmask(page,reason,{timeout=10000}={}){
  if(String(reason||'').trim().length<10)throw Error('UNMASK_REASON: 해제 사유(실제 할 일)는 10자 이상이어야 합니다.');
  const now=await headerState(page);
  if(now.state==='unmasked')return {stage:'done',...now};
  if(now.state!=='masked')throw ui('화면에서 「개인정보 마스킹 해제」 버튼을 하나로 찾지 못했습니다.');
  const open=await one(page.getByRole('button',{name:UNMASK.open,exact:true}));if(!open)throw ui('「개인정보 마스킹 해제」 버튼을 하나로 찾지 못했습니다.');
  await safeClick(open);
  const field=await waitOne(()=>reasonField(page),timeout);if(!field)throw ui('해제 사유 칸을 찾지 못했습니다.');
  await field.fill(reason);if(await field.inputValue()!==reason)throw ui('해제 사유를 넣지 못했습니다.');
  const send=await one(page.getByRole('button',{name:UNMASK.send}));if(!send)throw ui('인증번호 보내기 버튼을 하나로 찾지 못했습니다.');
  if(!await send.isEnabled())throw ui('인증번호 보내기 버튼이 눌리지 않는 상태입니다.');
  await safeClick(send);
  const code=await waitOne(()=>codeField(page),timeout);if(!code)throw ui('인증번호 칸을 찾지 못했습니다.');
  return {stage:'code'};
}
// 사람이 연결 프로그램 화면에 넣은 6자리를 그대로 칩니다. 해제되면 머리말 상태를 돌려줍니다.
export async function enterCode(page,code,{timeout=15000}={}){
  if(!/^\d{6}$/.test(String(code||'')))throw Error('UNMASK_CODE: 메일로 받은 인증번호 6자리 숫자를 넣어 주세요.');
  const field=await codeField(page);if(!field)throw ui('인증번호 칸을 찾지 못했습니다.');
  await field.fill(String(code));
  const ok=await one(page.getByRole('button',{name:UNMASK.confirm}));if(!ok)throw ui('인증번호 확인 버튼을 하나로 찾지 못했습니다.');
  await safeClick(ok);
  const until=Date.now()+timeout;
  for(;;){const h=await headerState(page).catch(()=>({state:'none'}));if(h.state==='unmasked')return h;if(Date.now()>=until)break;await sleep(300);}
  throw Error('UNMASK_CODE: 인증번호로 해제되지 않았습니다. 번호를 다시 확인하거나 전용 크롬 창에서 직접 해제해 주세요.');
}
// 해제 창만 닫습니다(취소·닫기 하나일 때). '연장'·'종료'는 누르지 않습니다.
export async function cancelUnmask(page){const b=await one(page.getByRole('button',{name:UNMASK.cancel}));if(b){await safeClick(b);return true;}return false;}
