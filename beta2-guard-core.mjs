// 2기 베타(/beta2) 저장 범위: 1기 Firebase 자료는 보기만 하고, 체크히어 수정 요청 흐름만 저장합니다.
export const BETA2_WRITABLE=[/^checkhereRequests\/[^/]+$/,/^checkhereProposalSources\/[^/]+$/,/^checkhereProposalDrafts\/[^/]+$/];
export const BETA2_TAG='[2기 베타] ';
export const beta2Writable=path=>BETA2_WRITABLE.some(rule=>rule.test(String(path||'')));
export function beta2Blocked(path){
 return Object.assign(new Error('2기 베타에서는 1기 자료를 보기만 할 수 있습니다. 저장은 1기 운영포털에서 해 주세요.'),{code:'BETA2_READ_ONLY',path:String(path||'')});
}
// 새 체크히어 수정 요청은 근거에 [2기 베타]를 붙여 어디서 보낸 요청인지 남깁니다(규칙 상한 1000자).
// 실시간 중계 요청('[실시간 베타]'로 시작, 끝에 '[기준:…]')은 표시 바로 뒤에 넣어 중계가 계속 알아보게 합니다.
export const LIVE_MARK='[실시간 베타]'; // checkhere-live-core.mjs LIVE_MARK와 같아야 합니다.
export function beta2RequestData(path,data){
 if(!/^checkhereRequests\//.test(String(path||''))||!data||typeof data!=='object'||data.status!=='pending'||typeof data.reason!=='string'||data.reason.includes(BETA2_TAG.trim()))return data;
 const reason=data.reason.startsWith(LIVE_MARK)?`${LIVE_MARK} ${BETA2_TAG.trim()}${data.reason.slice(LIVE_MARK.length)}`:BETA2_TAG+data.reason;
 return reason.length<=1000?{...data,reason}:data;
}
