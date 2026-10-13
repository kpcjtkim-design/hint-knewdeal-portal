// 2기 베타(/beta2) 저장 범위: 1기 Firebase 자료는 보기만 하고, 체크히어 수정 요청 흐름만 저장합니다.
export const BETA2_WRITABLE=[/^checkhereRequests\/[^/]+$/,/^checkhereProposalSources\/[^/]+$/,/^checkhereProposalDrafts\/[^/]+$/];
export const BETA2_TAG='[2기 베타] ';
export const beta2Writable=path=>BETA2_WRITABLE.some(rule=>rule.test(String(path||'')));
export function beta2Blocked(path){
 return Object.assign(new Error('2기 베타에서는 1기 자료를 보기만 할 수 있습니다. 저장은 1기 운영포털에서 해 주세요.'),{code:'BETA2_READ_ONLY',path:String(path||'')});
}
// 새 체크히어 수정 요청은 근거 앞에 [2기 베타]를 붙여 어디서 보낸 요청인지 남깁니다(규칙 상한 1000자).
export function beta2RequestData(path,data){
 if(!/^checkhereRequests\//.test(String(path||''))||!data||typeof data!=='object'||data.status!=='pending'||typeof data.reason!=='string'||data.reason.startsWith(BETA2_TAG))return data;
 return {...data,reason:(BETA2_TAG+data.reason).slice(0,1000)};
}
