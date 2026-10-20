// 출결 사유 목록(사용자 요청 2026-10-20 「지금까지 사유들 종합해서 드롭다운 가능한 건 그렇게」): 1기·2기 코드에서 쓰던 사유를 분류 → 세부로 고르고 표준 사유 글을 만듭니다.
// 표준 글은 '분류' 또는 '분류(세부)'(예: '병원(치과)', '인적성(HMAT)'). 기존 해석기(checkhere-proposal-core reasonCategory·attendance-period-core·beta2-core DISEASE_REASON)가 그대로 알아봅니다(시험: reason-catalog.test.mjs).
// 직접 입력(기타)도 되고, 예전에 저장한 글은 그대로 두고 고칠 수 있습니다(splitReason이 못 알아보면 '직접 입력'). 화면 없는 순수 함수 + 드롭다운 <option> 글만 둡니다(teacher-beta.js·beta2-ledger.mjs가 씀).
export const RECOGNIZED=['인정출석','인정지각','인정조퇴','인정외출'],PLAIN=['지각','조퇴','외출','결석'];
// 인적성 종류(사용자 요청 ②): 값은 괄호 안에 들어갈 짧은 이름, 글은 드롭다운에 보이는 이름. 기타는 직접 입력.
export const APTITUDE=[['HMAT','HMAT(현대차그룹)'],['GSAT','GSAT(삼성)'],['SKCT','SKCT(SK)'],['LG Way Fit','LG Way Fit'],['CJ CAT','CJ CAT'],['L-TAB','L-TAB(롯데)'],['PAT','PAT(포스코)'],['KT','KT'],['NCS','NCS(공기업)'],['AI역량검사','AI역량검사']];
export const OTHER='기타'; // 세부 '기타(직접 입력)' 값
// 취업박람회 추가 증빙(사용자 요청 ③): 인정 출결이면 박람회 참가만으로는 안 되고 기업면접 확인서가 더 있어야 합니다.
export const EXTRA_DOC='기업면접 확인서',EXTRA_LABEL=`추가 증빙 필요 · ${EXTRA_DOC}`,EXTRA_NOTICE=`취업박람회는 추가 증빙이 필요합니다 · ${EXTRA_DOC} 등(박람회 현장 기업면접을 본 확인)을 받아 주세요.`;
const sub=(text,label=text)=>({text,label});
// key: 드롭다운 값, types: 이 분류를 쓸 수 있는 출결, evidence: 인정일 때 받을 증빙, subs: 세부(표준 글), aptitude: 인적성 종류 드롭다운, extra: 추가 증빙
export const REASON_CATS=[
 {key:'병원',label:'병원·질병',types:[...RECOGNIZED,...PLAIN],evidence:'진료확인서·처방전·진료비 영수증 중 하나(병원명·날짜)',note:'질병 인정은 4회 주의 · 6회 한도',subs:[sub('병원','병원 진료'),sub('병원(치과)','치과'),sub('병원(통원 치료)','통원 치료'),sub('병원(입원)','입원'),sub('병원(수술)','수술'),sub('병원(검진)','건강검진'),sub('병결','병결(아파서)')]},
 {key:'면접',label:'면접',types:[...RECOGNIZED,...PLAIN],evidence:'면접확인서(기업 발행) 또는 면접 안내 문자·메일',subs:[sub('면접','기업 면접'),sub('면접(1차)','1차 면접'),sub('면접(최종)','최종 면접'),sub('면접(화상)','화상 면접')]},
 {key:'인적성',label:'인적성',types:[...RECOGNIZED,...PLAIN],evidence:'응시표(수험표) 또는 응시 확인 화면',aptitude:true,subs:[]},
 {key:'취업박람회',label:'취업박람회',types:[...RECOGNIZED,...PLAIN],evidence:'박람회 참가 확인',extra:EXTRA_DOC,subs:[sub('취업박람회'),sub('취업박람회(현장 면접)','현장 면접')]},
 {key:'예비군',label:'예비군·민방위',types:[...RECOGNIZED,...PLAIN],evidence:'훈련·교육 참석 확인서(필증)',subs:[sub('예비군','예비군 훈련'),sub('예비군(동원훈련)','동원훈련'),sub('민방위','민방위 교육')]},
 {key:'시험',label:'시험(자격증·어학)',types:[...RECOGNIZED,...PLAIN],evidence:'응시표(수험표) 또는 응시 확인서',subs:[sub('시험(자격증)','자격증'),sub('시험(국가기술자격)','국가기술자격'),sub('시험(어학)','어학(토익 등)'),sub('시험(학교)','학교 시험')]},
 {key:'경조사',label:'경조사',types:[...RECOGNIZED,...PLAIN],evidence:'가족관계증명서 + 부고·청첩장 등',subs:[sub('부친상'),sub('모친상'),sub('조부상'),sub('조모상'),sub('외조부상'),sub('외조모상'),sub('경조사(본인 결혼)','본인 결혼'),sub('경조사(형제자매 결혼)','형제자매 결혼'),sub('경조사(배우자 출산)','배우자 출산')]},
 {key:'공가',label:'공가(관공서·법원)',types:[...RECOGNIZED,...PLAIN],evidence:'출석요구서·출석 확인서 등 기관 발행 서류',subs:[sub('공가(법원 출석)','법원 출석'),sub('공가(관공서 출석)','관공서 출석'),sub('공가(투표)','투표'),sub('공가(천재지변)','천재지변')]},
 {key:'교통',label:'교통',types:PLAIN,evidence:'',subs:[sub('교통','교통 지연'),sub('교통사정'),sub('교통(사고)','교통사고')]},
 {key:'취업활동',label:'취업활동(설명회·상담)',types:PLAIN,evidence:'',subs:[sub('취업활동(채용설명회)','채용설명회'),sub('취업활동(취업상담)','취업 상담'),sub('취업활동(국취제 상담)','국취제·고용센터')]},
 {key:'개인사정',label:'개인사정',types:PLAIN,evidence:'',subs:[sub('개인사정'),sub('개인일정'),sub('개인사정(가족 행사)','가족 행사'),sub('개인사정(이사)','이사'),sub('개인사정(늦잠)','늦잠')]},
];
export const catOf=key=>REASON_CATS.find(c=>c.key===key)||null;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
// 저장 전 다듬기: 빈 괄호('인적성()')·앞뒤 공백을 지웁니다.
export const tidyReason=v=>clean(String(v??'').replace(/\(\s*\)/g,''));
// 분류·세부·직접 입력 → 표준 글. 인적성은 '인적성(종류)', 인적성 기타는 '인적성(직접 입력)', 분류 '' 또는 모르는 분류는 직접 입력 글 그대로.
export function composeReason(key,value='',custom=''){
 const c=catOf(key),v=clean(value),x=clean(custom);
 if(!c)return x;
 if(c.aptitude){const t=v===OTHER?x:v;return t?`인적성(${t})`:'인적성';}
 if(v===OTHER)return x?`${c.key}(${x})`:c.key;
 return c.subs.some(s=>s.text===v)?v:(c.subs[0]?.text||c.key);
}
// 저장된 글 → 드롭다운 위치 {cat, sub, custom}. 표준 글이 아니면 cat ''(직접 입력, 글은 그대로 고칠 수 있음).
export function splitReason(text){
 const s=clean(text);if(!s)return {cat:'',sub:'',custom:''};
 for(const c of REASON_CATS){const hit=c.subs.find(x=>x.text===s);if(hit)return {cat:c.key,sub:hit.text,custom:''};}
 const m=s.match(/^인적성(?:\s*\(\s*(.*?)\s*\))?$/);
 if(m){const t=m[1]||'';return APTITUDE.some(([v])=>v===t)?{cat:'인적성',sub:t,custom:''}:t?{cat:'인적성',sub:OTHER,custom:t}:{cat:'인적성',sub:'',custom:''};}
 const o=s.match(/^([^()]+?)\s*\(\s*([^()]+?)\s*\)$/),c=o&&catOf(o[1]);
 if(c&&c.subs.length)return {cat:c.key,sub:OTHER,custom:o[2]};
 return {cat:'',sub:'',custom:s};
}
// 사유 글이 어느 분류인지(배지·거르기용, 넓게 봄). 표준 글이 아니어도 낱말로 찾습니다. 못 찾으면 ''.
const WORDS=[['취업박람회',/취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair/i],['인적성',/인적성|HMAT|GSAT|SKCT|L-?TAB|AI\s*역량\s*검사/i],['병원',/병원|병결|병가|진료|치료|질병|입원|통원|수술|검진/],['면접',/면접/],['예비군',/예비군|민방위|동원\s*훈련/],['시험',/시험|응시/],['경조사',/경조사|[부모]친상|외?조[부모]상|결혼|출산/],['공가',/공가|법원|관공서|투표|천재지변/],['교통',/교통|차량\s*정체/],['취업활동',/취업\s*(?:상담|컨설팅|활동)|채용\s*설명회|국취제|고용\s*센터/],['개인사정',/개인\s*(?:사정|사유|일정)|늦잠|이사|가족/]];
export function reasonKind(text){const s=String(text??'');return WORDS.find(([,re])=>re.test(s))?.[0]||'';}
export const isJobFair=text=>/취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair/i.test(String(text??''));
const recognizedType=t=>RECOGNIZED.includes(String(t||''));
// 추가 증빙(취업박람회 + 인정 출결). rec: {type, reason, ev, evApplied}. → null | {state:'미제출'|'제출'|'반려'|'확인'|'해당없음', done, label}
// 이행 여부: ev 빈 칸·미제출 → 미제출, 반려 → 반려(보완), 확인 → 확인(이행). '제출'은 시트 증빙 목록에 생기면 그대로 보입니다(지금 B2.EVIDENCE에는 없음).
export function extraEvidence(rec){
 if(!rec||!recognizedType(rec.type)||!isJobFair(rec.reason))return null;
 const state=String(rec.evApplied||rec.ev||'').trim()||'미제출';
 return {state,done:state==='확인'||state==='해당없음',doc:EXTRA_DOC,label:EXTRA_LABEL};
}
// 저장 전·후: 추가 증빙이 새로 필요해졌는지(알림을 한 번만 남기려고, 이미 「확인」이면 아님). prev 없으면 새 기록.
export const extraEvidenceStarted=(prev,next)=>{const x=extraEvidence(next);return !!x&&!x.done&&!extraEvidence(prev);};
// 알림 글(notify.mjs '추가 증빙'): 반·이름·날짜·유형만(생년월일·전화 없음)
export function extraNotice({cls,name,date,type}){
 const md=String(date||'').replace(/^\d{4}-0?(\d{1,2})-0?(\d{1,2})$/,'$1/$2');
 return {title:`추가 증빙 필요 · ${cls}반 ${name}`,body:`${md} ${type} 취업박람회 · ${EXTRA_DOC} 제출이 필요합니다.`};
}
// 드롭다운 <option> 글(escape 포함). type이 있으면 그 출결에 맞지 않는 분류는 뒤로 빼고 '(인정 아님)'을 붙입니다.
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function catOptions(selected='',{type='',blank='분류 고르기'}={}){
 const off=c=>type&&!c.types.includes(type);
 return `<option value="" ${selected?'':'selected'}>${esc(blank)}</option>`+REASON_CATS.map(c=>`<option value="${esc(c.key)}" ${c.key===selected?'selected':''}>${esc(c.label)}${off(c)?' (인정 아님)':''}</option>`).join('')+`<option value="${OTHER}" ${selected===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
export function subOptions(key,selected=''){
 const c=catOf(key);if(!c)return '';
 const list=c.aptitude?APTITUDE.map(([v,l])=>({text:v,label:l})):c.subs;
 return (c.aptitude?`<option value="" ${selected?'':'selected'}>종류 고르기</option>`:'')+list.map(s=>`<option value="${esc(s.text)}" ${s.text===selected?'selected':''}>${esc(s.label)}</option>`).join('')+`<option value="${OTHER}" ${selected===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 출결대조 사유 칸 = 드롭다운 하나(사용자 추가 지시 2026-10-20): 지금까지 쓴 표준 글을 분류별 묶음으로, 인적성은 바로 옆 종류 드롭다운, 목록에 없으면 '기타 (직접 입력)'.
export const STANDARD=new Set(REASON_CATS.flatMap(c=>c.aptitude?['인적성']:c.subs.map(s=>s.text)));
// 글 → 드롭다운 상태 {main:''|표준 글|'인적성'|'기타', apt:인적성 종류 값('', 'HMAT'…, '기타'), input:직접 입력 칸을 보일지, custom:인적성 기타 글}. custom=true면 '기타'를 고른 상태를 지킵니다.
export function reasonPick(text,{custom=false}={}){
 const t=clean(text),a=t.match(/^인적성(?:\s*\(\s*(.*?)\s*\))?$/);
 if(a&&!custom){const k=a[1]??'',paren=/\(/.test(t),known=APTITUDE.some(([v])=>v===k);return known?{main:'인적성',apt:k,input:false,custom:''}:paren?{main:'인적성',apt:OTHER,input:true,custom:k}:{main:'인적성',apt:'',input:false,custom:''};}
 if(STANDARD.has(t)&&!custom)return {main:t,apt:'',input:false,custom:''};
 return t||custom?{main:OTHER,apt:'',input:true,custom:''}:{main:'',apt:'',input:false,custom:''};
}
// 사유 드롭다운 <option>: 분류(<optgroup>)마다 표준 글, 출결에 맞지 않는 분류는 '(인정 아님)', 끝에 '기타 (직접 입력)'
export function reasonOptions(main='',{type='',blank='사유 고르기'}={}){
 const off=c=>type&&!c.types.includes(type);
 return `<option value="" ${main?'':'selected'}>${esc(blank)}</option>`+REASON_CATS.map(c=>`<optgroup label="${esc(c.label)}${off(c)?' (인정 아님)':''}">${(c.aptitude?[{text:'인적성'}]:c.subs).map(s=>`<option value="${esc(s.text)}" ${s.text===main?'selected':''}>${esc(s.text)}</option>`).join('')}</optgroup>`).join('')+`<option value="${OTHER}" ${main===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 인정 출결인데 인정 분류가 아니면(교통·개인사정·취업활동) 짧은 안내
export const typeWarning=(type,key)=>{const c=catOf(key);return c&&recognizedType(type)&&!c.types.includes(type)?`${c.label}은 보통 인정 사유가 아닙니다`:'';};
