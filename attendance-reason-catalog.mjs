// 출결 사유 목록(사용자 요청 2026-10-20 「지금까지 사유들 종합해서 드롭다운 가능한 건 그렇게」): 1기·2기 코드에서 쓰던 사유를 분류 → 세부로 고르고 표준 사유 글을 만듭니다.
// 표준 글은 '분류' 또는 '분류(세부)'(예: '병원(치과)', '인적성(HMAT)', '자격증(전기기사)'). 기존 해석기(checkhere-proposal-core reasonCategory·attendance-period-core·beta2-core DISEASE_REASON)가 그대로 알아봅니다(시험: reason-catalog.test.mjs).
// 직접 입력(기타)도 되고, 예전에 저장한 글은 그대로 두고 고칠 수 있습니다(splitReason이 못 알아보면 '직접 입력'). 화면 없는 순수 함수 + 드롭다운 <option> 글만 둡니다(teacher-beta.js·beta2-ledger.mjs가 씀).
// 목록 개정(사용자 2026-10-20, 「2026년 K-뉴딜 아카데미사업 출결 관리 기준규정_0917」 기준): 병결 빼기, 면접·취업박람회는 하나씩, 시험 → 자격증(옆에 종류 드롭다운, 인적성과 같은 방식),
// 예비군·민방위 두 가지, 인정 안 되는 분류(교통·취업활동·개인사정)는 이름 앞에 '(인정 안 됨)'. 이 표시는 화면 글에만 붙고 저장 글은 그대로입니다('취업활동(채용설명회)').
// 자격증 종류마다 과정별 인정 기준(O 인정 · △ 관련성 확인 필요 · X 인정 안 됨, FAQ 시트 '자격증 시험 응시 관련 출결문의' Q~S열). X는 인정 출결에서 고를 수 없습니다.
// 검진(사용자 2026-10-20 '일반검진은 불인정인거 명확히'): '병원(진료 위한 검사)'만 인정, '일반건강검진'은 인정 안 됨(질병으로도 세지 않음), 옛 '병원(검진)'은 '검진 종류 확인 필요'.
import {classInfo} from './cohort.mjs';
export const RECOGNIZED=['인정출석','인정지각','인정조퇴','인정외출'],PLAIN=['지각','조퇴','외출','결석'];
export const OTHER='기타'; // 세부 '기타(직접 입력)' 값
export const NOT_RECOGNIZED='(인정 안 됨)',NEEDS_CHECK='(관련성 확인 필요)';
// 취업박람회 추가 증빙(사용자 요청 ③): 인정 출결이면 박람회 참가만으로는 안 되고 기업면접 확인서가 더 있어야 합니다.
export const EXTRA_DOC='기업면접 확인서',EXTRA_LABEL=`추가 증빙 필요 · ${EXTRA_DOC}`,EXTRA_NOTICE=`취업박람회는 추가 증빙이 필요합니다 · ${EXTRA_DOC} 등(박람회 현장 기업면접을 본 확인)을 받아 주세요.`;
// 자격증 인정 기준의 과정 열: Q열 임베디드AI(20010203), R열 제조지능화(15110301).
// 2기 반 과정(cohort.json course) → 기준 열. 사용자 결정 2026-10-20: '모빌리티 AI' 반은 임베디드AI(Q열) 기준. 목록에 없는 과정(17반 테스트반 등)은 DEFAULT_COURSE.
export const CERT_COURSES=[{key:'emb',label:'임베디드AI',code:'20010203'},{key:'mfg',label:'제조지능화',code:'15110301'}];
export const COURSE_CERT_COLUMN={'모빌리티 AI':'emb','제조지능화':'mfg'},DEFAULT_COURSE='emb';
// 인적성 종류(사용자 요청 ②): [값(괄호 안에 들어갈 짧은 이름), 드롭다운에 보이는 이름]. 기타는 직접 입력.
export const APTITUDE=[['HMAT','HMAT(현대차그룹)'],['GSAT','GSAT(삼성)'],['SKCT','SKCT(SK)'],['LG Way Fit','LG Way Fit'],['CJ CAT','CJ CAT'],['L-TAB','L-TAB(롯데)'],['PAT','PAT(포스코)'],['KT','KT'],['NCS','NCS(공기업)'],['AI역량검사','AI역량검사']];
// 자격증 종류(FAQ 시트 순서): [값, 보이는 이름, {emb, mfg} 기준, 비고, 옛 자유 글에서 찾는 말(X만)]. 시트 빈칸은 △(사용자 지시 2026-10-20).
// 값에는 괄호를 넣지 않습니다('자격증(어학시험)'처럼 한 겹만).
const r=(emb,mfg)=>({emb,mfg});
export const CERTS=[
 ['어학시험','어학시험(토익, 오픽 등)',r('X','X'),'',['어학','토익','TOEIC','오픽','OPIc','토플','TOEFL','텝스','TEPS']],
 ['가스기사','가스기사',r('△','△')],
 ['건설안전기사','건설안전기사',r('O','O'),'제조지능화는 취업 직무가 제조 현장직일 때'],
 ['공조냉동기계기사','공조냉동기계기사',r('O','O')],
 ['금속재료기사','금속재료기사',r('△','△')],
 ['산업안전기사','산업안전기사',r('O','O')],
 ['산업안전산업기사','산업안전산업기사',r('△','O')],
 ['일반기계기사','일반기계기사',r('O','O')],
 ['전기기사','전기기사',r('O','O')],
 ['전기공사기사','전기공사기사',r('△','△')],
 ['품질경영기사','품질경영기사',r('△','△')],
 ['무선설비기사','무선설비기사',r('△','△'),'필기·실기 각각 응시확인서'],
 ['지게차운전기능사','지게차운전기능사',r('X','X'),'',['지게차']],
 ['컴퓨터활용능력','컴퓨터활용능력',r('△','△')],
 ['SQLD','SQLD',r('O','△')],
 ['ADP','데이터분석전문가(ADP)',r('O','△')],
 ['ADsP','데이터분석준전문가(ADsP)',r('O','△')],
 ['ISTQB','ISTQB',r('O','△')],
 ['AICE','AICE',r('O','△')],
 ['자동차정비산업기사','자동차정비산업기사',r('O','O')],
 ['자동차정비기능사','자동차정비기능사',r('O','O')],
 ['자동화설비기능사','자동화설비기능사',r('△','O')],
 ['정보보안기사','정보보안기사',r('O','△')],
 ['정보통신기사','정보통신기사',r('O','O')],
];
export const KINDS={인적성:APTITUDE,자격증:CERTS};
const sub=(text,label=text,o={})=>({text,label,...o});
// key: 드롭다운 값(=저장 글 앞말), types: 이 분류를 쓸 수 있는 출결, evidence: 인정일 때 받을 증빙(규정 0917), subs: 세부(표준 글),
// kind: 옆 종류 드롭다운(인적성·자격증, 저장 글 '분류(종류)'), extra: 추가 증빙, 세부 recognized:false는 인정 출결에서 고를 수 없음(일반건강검진).
export const REASON_CATS=[
 {key:'병원',label:'병원·질병',types:[...RECOGNIZED,...PLAIN],evidence:'진료확인서 또는 입·퇴원확인서(병원명·날짜) · 일반건강검진은 인정 안 됨',note:'질병 인정은 4회 주의 · 6회 한도',subs:[sub('병원','병원 진료'),sub('병원(치과)','치과'),sub('병원(통원 치료)','통원 치료'),sub('병원(입원)','입원'),sub('병원(수술)','수술'),sub('병원(진료 위한 검사)','진료 위한 검사'),sub('일반건강검진','일반건강검진',{recognized:false})]},
 {key:'면접',label:'면접',types:[...RECOGNIZED,...PLAIN],evidence:'면접확인서(성명·일시·방식·실제 참석 확인) · 없으면 담당자 확인 메일·문자 등 모두',subs:[sub('면접','기업 면접')]},
 {key:'인적성',label:'인적성',types:[...RECOGNIZED,...PLAIN],evidence:'실제 응시를 확인할 수 있는 서류(응시확인서·취업활동확인서 등)',kind:'인적성',aptitude:true,subs:[]},
 {key:'취업박람회',label:'취업박람회',types:[...RECOGNIZED,...PLAIN],evidence:'기업 면접·1:1 채용상담 확인(성명·일시·기업명·유형·담당자 연락처) · 참가확인서·사진만으로는 안 됨',extra:EXTRA_DOC,subs:[sub('취업박람회')]},
 {key:'예비군',label:'예비군·민방위',types:[...RECOGNIZED,...PLAIN],evidence:'훈련·교육 참석 확인서(필증)',subs:[sub('예비군','예비군 훈련'),sub('민방위','민방위 교육')]},
 {key:'자격증',label:'자격증 시험',types:[...RECOGNIZED,...PLAIN],evidence:'응시확인서(접수확인서 불가) · 과정 관련성 1~2줄',kind:'자격증',subs:[]},
 {key:'경조사',label:'경조사',types:[...RECOGNIZED,...PLAIN],evidence:'가족관계증명서 + 부고·청첩장 등',subs:[sub('부친상'),sub('모친상'),sub('조부상'),sub('조모상'),sub('외조부상'),sub('외조모상'),sub('경조사(본인 결혼)','본인 결혼'),sub('경조사(형제자매 결혼)','형제자매 결혼'),sub('경조사(배우자 출산)','배우자 출산')]},
 {key:'공가',label:'공가(관공서·법원)',types:[...RECOGNIZED,...PLAIN],evidence:'출석요구서·출석 확인서 등 기관 발행 서류',subs:[sub('공가(법원 출석)','법원 출석'),sub('공가(관공서 출석)','관공서 출석'),sub('공가(투표)','투표'),sub('공가(천재지변)','천재지변')]},
 {key:'교통',label:`${NOT_RECOGNIZED} 교통`,types:PLAIN,evidence:'',subs:[sub('교통','교통 지연'),sub('교통사정'),sub('교통(사고)','교통사고')]},
 {key:'취업활동',label:`${NOT_RECOGNIZED} 취업활동`,types:PLAIN,evidence:'',subs:[sub('취업활동(채용설명회)','채용설명회'),sub('취업활동(취업상담)','취업 상담'),sub('취업활동(국취제 상담)','국취제·고용센터')]},
 {key:'개인사정',label:`${NOT_RECOGNIZED} 개인사정`,types:PLAIN,evidence:'',subs:[sub('개인사정'),sub('개인일정'),sub('개인사정(가족 행사)','가족 행사'),sub('개인사정(이사)','이사'),sub('개인사정(늦잠)','늦잠')]},
];
export const catOf=key=>REASON_CATS.find(c=>c.key===key)||null;
const kindCat=key=>{const c=catOf(key);return c?.kind?c:null;};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const recognizedType=t=>RECOGNIZED.includes(String(t||''));
const anyRecognized=t=>/^인정/.test(String(t||'')); // 인정출석·인정지각·…(인정결석 등 옛 이름 포함)
const catRecognized=c=>c.types.some(t=>RECOGNIZED.includes(t));
const subRecognized=(c,s)=>catRecognized(c)&&s.recognized!==false;
const nameOf=c=>c.label.replace(NOT_RECOGNIZED,'').trim(); // 안내 글용 분류 이름('(인정 안 됨) 교통' → '교통')
// 저장 전 다듬기: 빈 괄호('인적성()')·앞뒤 공백을 지웁니다.
export const tidyReason=v=>clean(String(v??'').replace(/\(\s*\)/g,''));
// '분류(종류)' 글 → {key, value, paren}(옆 종류 드롭다운이 있는 분류만)
function kindText(text){
 const m=clean(text).match(/^([^()]+?)(?:\s*\(\s*(.*?)\s*\))?$/),c=m&&kindCat(m[1]);
 return c?{key:c.key,value:m[2]??'',paren:/\(/.test(clean(text))}:null;
}
const kindKnown=(key,v)=>(KINDS[key]||[]).some(([x])=>x===v);
// 분류·세부·직접 입력 → 표준 글. 종류 분류는 '분류(종류)', 종류 기타는 '분류(직접 입력)', 분류 '' 또는 모르는 분류는 직접 입력 글 그대로.
export function composeReason(key,value='',custom=''){
 const c=catOf(key),v=clean(value),x=clean(custom);
 if(!c)return x;
 if(c.kind){const t=v===OTHER?x:v;return t?`${c.key}(${t})`:c.key;}
 if(v===OTHER)return x?`${c.key}(${x})`:c.key;
 return c.subs.some(s=>s.text===v)?v:(c.subs[0]?.text||c.key);
}
// 저장된 글 → 드롭다운 위치 {cat, sub, custom}. 표준 글이 아니면 cat ''(직접 입력, 글은 그대로 고칠 수 있음).
// 목록에서 빠진 옛 글('병결', '시험(자격증)')은 직접 입력, 분류는 있지만 세부가 빠진 글('면접(1차)', '예비군(동원훈련)')은 그 분류의 기타.
export function splitReason(text){
 const s=clean(text);if(!s)return {cat:'',sub:'',custom:''};
 for(const c of REASON_CATS){const hit=c.subs.find(x=>x.text===s);if(hit)return {cat:c.key,sub:hit.text,custom:''};}
 const k=kindText(s);
 if(k)return kindKnown(k.key,k.value)?{cat:k.key,sub:k.value,custom:''}:k.value?{cat:k.key,sub:OTHER,custom:k.value}:{cat:k.key,sub:'',custom:''};
 const o=s.match(/^([^()]+?)\s*\(\s*([^()]+?)\s*\)$/),c=o&&catOf(o[1]);
 if(c&&c.subs.length)return {cat:c.key,sub:OTHER,custom:o[2]};
 return {cat:'',sub:'',custom:s};
}
// 사유 글이 어느 분류인지(배지·거르기용, 넓게 봄). 표준 글이 아니어도 낱말로 찾습니다. 못 찾으면 ''. 옛 '시험(…)'·'응시'는 자격증으로 봅니다.
const WORDS=[['취업박람회',/취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair/i],['인적성',/인적성|HMAT|GSAT|SKCT|L-?TAB|AI\s*역량\s*검사/i],['병원',/병원|병결|병가|진료|치료|질병|입원|통원|수술|검진/],['면접',/면접/],['예비군',/예비군|민방위|동원\s*훈련/],['자격증',/자격증|시험|응시/],['경조사',/경조사|[부모]친상|외?조[부모]상|결혼|출산/],['공가',/공가|법원|관공서|투표|천재지변/],['교통',/교통|차량\s*정체/],['취업활동',/취업\s*(?:상담|컨설팅|활동)|채용\s*설명회|국취제|고용\s*센터/],['개인사정',/개인\s*(?:사정|사유|일정)|늦잠|이사|가족/]];
export function reasonKind(text){const s=String(text??'');return WORDS.find(([,re])=>re.test(s))?.[0]||'';}
export const isJobFair=text=>/취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair/i.test(String(text??''));
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
// 자격증 인정 기준: 반 → 과정 열('emb'|'mfg'), 종류 값 → 'O'|'△'|'X'. 목록에 없는 종류(기타 직접 입력)·종류 없음은 △(관련성 확인 필요).
export const certColumn=cls=>COURSE_CERT_COLUMN[classInfo(cls)?.course]||DEFAULT_COURSE;
export const certCourse=cls=>CERT_COURSES.find(c=>c.key===certColumn(cls))||CERT_COURSES[0];
export function certRule(value,cls){const hit=CERTS.find(([v])=>v===clean(value));return hit?hit[2][certColumn(cls)]||'△':'△';}
// 글 → 자격증 종류 판정 {value,label,rule,course,note} | null. '자격증(종류)'와, 옛 자유 글 중 인정 안 되는 종류의 찾는 말(토익·지게차 등)을 봅니다.
export function certOf(text,cls){
 const t=clean(text),k=kindText(t),course=certCourse(cls);
 if(k?.key==='자격증'){const hit=CERTS.find(([v])=>v===k.value);return {value:k.value,label:hit?hit[1]:k.value||'자격증',rule:hit?hit[2][course.key]||'△':'△',course,note:hit?.[3]||'',known:!!hit};}
 const x=CERTS.find(c=>c[4]&&c[2][course.key]==='X'&&c[4].some(w=>t.toLowerCase().includes(w.toLowerCase())));
 return x?{value:x[0],label:x[1],rule:'X',course,note:x[3]||'',known:true}:null;
}
const GENERAL_CHECKUP=/일반\s*(?:건강\s*)?검진/;
export const isGeneralCheckup=text=>GENERAL_CHECKUP.test(String(text??''));
// 인정 출결 사유 확인(행 경고·배지, 저장은 막지 않음): [{level:'error'|'warn', text}]. 인정이 아닌 출결이면 [].
// error: 자격증 X 종류, 일반건강검진. warn: 자격증 △·종류 없음·직접 입력, 검진 종류를 모르는 글(옛 '병원(검진)').
export function reasonChecks(type,reason,{cls=''}={}){
 const t=clean(reason),out=[];if(!anyRecognized(type)||!t)return out;
 if(isGeneralCheckup(t))out.push({level:'error',text:`${NOT_RECOGNIZED} 일반건강검진 · 진료 위한 검사만 인정됩니다`});
 else if(/검진/.test(t))out.push({level:'warn',text:'검진 종류 확인 필요 · 진료 위한 검사만 인정(일반건강검진은 인정 안 됨)'});
 const c=certOf(t,cls);
 if(c?.rule==='X')out.push({level:'error',text:`${NOT_RECOGNIZED} ${c.label} · ${c.course.label} 과정 인정 제외`});
 else if(c?.rule==='△')out.push({level:'warn',text:c.value?`${c.label} · 관련성 확인 필요(${c.course.label} 과정)`:'자격증 종류 확인 필요'});
 return out;
}
// 드롭다운 <option> 글(escape 포함). 인정 안 되는 분류·세부는 이름 앞에 '(인정 안 됨)'(분류 이름에 이미 있음), 인정 출결에서는 막힌 세부(일반건강검진)를 고를 수 없습니다.
export function catOptions(selected='',{type='',blank='분류 고르기'}={}){
 return `<option value="" ${selected?'':'selected'}>${esc(blank)}</option>`+REASON_CATS.map(c=>`<option value="${esc(c.key)}" ${c.key===selected?'selected':''}>${esc(c.label)}</option>`).join('')+`<option value="${OTHER}" ${selected===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 세부·종류 <option>. opts {type, cls}: 자격증은 반 과정 기준으로 X는 '(인정 안 됨)'(인정 출결이면 막음, 이미 고른 값은 둠), △는 '(관련성 확인 필요)'.
export function subOptions(key,selected='',{type='',cls=''}={}){
 const c=catOf(key);if(!c)return '';
 const lock=anyRecognized(type),col=c.key==='자격증'?certColumn(cls):'';
 const list=c.kind?(KINDS[c.kind]||[]).map(([v,l,rules,note])=>{const rule=rules?.[col]||'';return {text:v,label:rule==='X'?`${NOT_RECOGNIZED} ${l}`:rule==='△'?`${l} ${NEEDS_CHECK}`:l,off:rule==='X',title:note||''};})
  :c.subs.map(s=>({text:s.text,label:subRecognized(c,s)?s.label:`${NOT_RECOGNIZED} ${s.label}`,off:catRecognized(c)&&s.recognized===false,title:''}));
 return (c.kind?`<option value="" ${selected?'':'selected'}>종류 고르기</option>`:'')+list.map(s=>`<option value="${esc(s.text)}" ${s.text===selected?'selected':''}${lock&&s.off&&s.text!==selected?' disabled':''}${s.title?` title="${esc(s.title)}"`:''}>${esc(s.label)}</option>`).join('')+`<option value="${OTHER}" ${selected===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 출결대조 사유 칸 = 드롭다운 하나(사용자 추가 지시 2026-10-20): 지금까지 쓴 표준 글을 분류별 묶음으로, 인적성·자격증은 바로 옆 종류 드롭다운, 목록에 없으면 '기타 (직접 입력)'.
export const STANDARD=new Set(REASON_CATS.flatMap(c=>c.kind?[c.key]:c.subs.map(s=>s.text)));
// 글 → 드롭다운 상태 {main:''|표준 글|종류 분류('인적성'·'자격증')|'기타', kind:옆 종류 드롭다운 분류(''이면 없음), apt:종류 값('', 'HMAT'…, '기타'), input:직접 입력 칸을 보일지, custom:종류 기타 글}.
// custom=true면 '기타'를 고른 상태를 지킵니다.
export function reasonPick(text,{custom=false}={}){
 const t=clean(text),k=kindText(t);
 if(k&&!custom){const known=kindKnown(k.key,k.value);return known?{main:k.key,kind:k.key,apt:k.value,input:false,custom:''}:k.paren?{main:k.key,kind:k.key,apt:OTHER,input:true,custom:k.value}:{main:k.key,kind:k.key,apt:'',input:false,custom:''};}
 if(STANDARD.has(t)&&!custom)return {main:t,kind:'',apt:'',input:false,custom:''};
 return t||custom?{main:OTHER,kind:'',apt:'',input:true,custom:''}:{main:'',kind:'',apt:'',input:false,custom:''};
}
// 사유 드롭다운 <option>: 분류(<optgroup>)마다 표준 글, 인정 안 되는 분류·세부는 '(인정 안 됨) 글', 끝에 '기타 (직접 입력)'.
// 인정 출결이면 막힌 세부(일반건강검진)는 고를 수 없습니다(이미 저장된 값이면 그대로 보임).
export function reasonOptions(main='',{type='',blank='사유 고르기'}={}){
 const lock=anyRecognized(type);
 return `<option value="" ${main?'':'selected'}>${esc(blank)}</option>`+REASON_CATS.map(c=>`<optgroup label="${esc(c.label)}">${(c.kind?[{text:c.key}]:c.subs).map(s=>{const ok=subRecognized(c,s),off=lock&&catRecognized(c)&&s.recognized===false&&s.text!==main;return `<option value="${esc(s.text)}" ${s.text===main?'selected':''}${off?' disabled':''}>${ok?'':`${NOT_RECOGNIZED} `}${esc(s.text)}</option>`;}).join('')}</optgroup>`).join('')+`<option value="${OTHER}" ${main===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 인정 출결인데 인정 분류가 아니면(교통·개인사정·취업활동) 짧은 안내
export const typeWarning=(type,key)=>{const c=catOf(key);return c&&recognizedType(type)&&!c.types.includes(type)?`${nameOf(c)}은 보통 인정 사유가 아닙니다`:'';};
