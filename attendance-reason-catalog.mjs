// 출결 사유 목록(사용자 요청 2026-10-20 「지금까지 사유들 종합해서 드롭다운 가능한 건 그렇게」): 분류 → 세부로 고르고 표준 사유 글('분류' 또는 '분류(세부)')을 만듭니다.
// 목록 개정(사용자 2026-10-20, 「2026년 K-뉴딜 아카데미사업 출결 관리 기준규정_0917」): 병결 빼기, 면접·취업박람회 하나씩, 시험 → 자격증(옆 종류 드롭다운, 인적성과 같은 방식),
// 예비군·민방위 두 가지, 인정 안 되는 분류·세부는 화면 글 앞에 '(인정 안 됨)'(저장 글은 그대로: '취업활동(채용설명회)'), 자격증 종류는 과정별 O/△/X, 일반건강검진은 인정 안 됨.
// 데이터화(사용자 2026-10-20 '사유 드롭다운을 관리자 측에서 설정할 수 있는 그런 화면'): 목록 전체가 JSON 하나(DEFAULT_REASON_CATALOG = 기본값).
// Firestore settings/reasonCatalog(관리자 「공지·설정 › 사유 목록」에서 저장)가 있으면 reason-catalog-store.mjs가 읽어 setReasonCatalog로 바꿉니다(모양이 틀리면 기본값 + 경고).
// 해석기(체크히어 메모 분류 reasonCategoryOf, 질병 판정 isDiseaseText, 기간 비고 periodCategoryOf, 배지 분류 reasonKind)도 같은 데이터의 '찾는 말'로 봅니다.
// 숨긴 분류·세부는 드롭다운에만 안 보이고 옛 기록 해석에는 그대로 씁니다(그래서 지우기보다 숨기기). 화면 없는 순수 함수 + 드롭다운 <option> 글만 둡니다.
// 옆 종류 드롭다운 일반화(사용자 2026-10-20 '경조사 등도 그냥 옆으로 드롭다운 시키는게 낫네? 이런거 가능한건 다 그렇게'): 보이는 세부가 둘 이상인 분류는 인적성·자격증처럼
// 사유 드롭다운에 분류 하나(값 = 분류 키)만 두고 바로 옆 종류 드롭다운에서 세부를 고릅니다. 저장 글은 그대로 세부의 저장 글('병원(치과)'·'부친상'·'교통사정'),
// 분류만 고르면 분류 키('경조사'), 옆 칸 '기타'는 '분류 키(직접 입력)'. 세부가 하나뿐인 분류(면접·취업박람회)는 사유 드롭다운에 그 글 하나. 데이터 모양은 그대로(cats[].subs = 옆 목록).
import {classInfo} from './cohort.mjs';
export const RECOGNIZED=['인정출석','인정지각','인정조퇴','인정외출'],PLAIN=['지각','조퇴','외출','결석'];
export const OTHER='기타'; // 세부 '기타(직접 입력)' 값
// '해당없음'(사용자 2026-10-20 '출결 시트는 관리자든 담임이든 해당없음 선택할 수 있는 항목 부활좀'): 사유 드롭다운 맨 위(빈칸 바로 아래) 고정 항목, 저장 글 그대로 '해당없음'.
// 해석기에는 사유 없음과 같습니다(체크히어 분류·질병·기간 비고·배지 모두 ''). 관리자 「사유 목록」에서는 숨기기만(목록 데이터 naHidden: true), 이름 바꾸기·지우기 없음.
export const NA='해당없음';
export const isNA=text=>String(text??'').replace(/\s+/g,'')===NA;
export const NOT_RECOGNIZED='(인정 안 됨)',NEEDS_CHECK='(관련성 확인 필요)';
export const RULES=['O','△','X']; // 자격증 종류 과정별 기준: O 인정 · △ 관련성 확인 시 인정 가능 · X 인정 제외
const EXCLUDE=/확인\s*필요|불명|미정|아님|취소/; // 체크히어 메모 분류를 정하지 않는 글(고정 규칙)

// ── 기본값(코드에 있는 목록). Firestore에 넣을 수 있게 배열 안에 배열을 두지 않습니다. ──
// cats[]: key(드롭다운 값 = 저장 글 앞말, 괄호 없음), label(화면 이름), recognized(인정 사유인지), disease(질병 판정에 넣을지), memo(체크히어 메모 분류, '' = 분류 안 함),
//   evidence(증빙 안내), extra(추가 증빙 서류 이름, '' = 없음), kind(옆 종류 드롭다운: kinds의 키), words(옛 자유 글에서 찾는 말, 띄어쓰기·대소문자·'-' 무시),
//   except(이 분류로 보지 않을 말), beats(같이 찾아져도 이 분류가 이기는 체크히어 분류), period(기간 비고에서 이 분류로 줄일 글, 정확히 같을 때), periodKinds(period + 종류 이름도),
//   caution({words,text}: 인정 출결이면 주의 배지), hidden(드롭다운에서 숨김),
//   subs[]: text(저장 글), label(세부 이름), recognized:false(인정 출결에서 고를 수 없음), disease, memo, words, except, beats, note, hidden
// kinds{키: {label, items[]: value(괄호 안 글, 괄호 없음), label, rules{과정 키: O|△|X}, note, words(X 종류를 옛 자유 글에서 찾는 말), hidden}}
// courses[]: 자격증 기준 열(Q열 임베디드AI 20010203, R열 제조지능화 15110301), courseMap: 반 과정(cohort.json course) → 기준 열, defaultCourse: 그 밖(17반 테스트반 등)
const DEFAULT={
 version:1,
 courses:[{key:'emb',label:'임베디드AI',code:'20010203'},{key:'mfg',label:'제조지능화',code:'15110301'}],
 courseMap:{'모빌리티 AI':'emb','제조지능화':'mfg'}, // 사용자 결정 2026-10-20: '모빌리티 AI' 반은 임베디드AI(Q열) 기준
 defaultCourse:'emb',
 kinds:{
  인적성:{label:'인적성 종류',items:[{value:'HMAT',label:'HMAT(현대차그룹)'},{value:'GSAT',label:'GSAT(삼성)'},{value:'SKCT',label:'SKCT(SK)'},{value:'LG Way Fit',label:'LG Way Fit'},{value:'CJ CAT',label:'CJ CAT'},{value:'L-TAB',label:'L-TAB(롯데)'},{value:'PAT',label:'PAT(포스코)'},{value:'KT',label:'KT'},{value:'NCS',label:'NCS(공기업)'},{value:'AI역량검사',label:'AI역량검사'}]},
  // FAQ 시트 '자격증 시험 응시 관련 출결문의' 순서와 Q~S열(시트 빈칸은 △, 사용자 지시 2026-10-20)
  자격증:{label:'자격증 종류',items:[
   {value:'어학시험',label:'어학시험(토익, 오픽 등)',rules:{emb:'X',mfg:'X'},words:['어학','토익','TOEIC','오픽','OPIc','토플','TOEFL','텝스','TEPS']},
   {value:'가스기사',label:'가스기사',rules:{emb:'△',mfg:'△'}},
   {value:'건설안전기사',label:'건설안전기사',rules:{emb:'O',mfg:'O'},note:'제조지능화는 취업 직무가 제조 현장직일 때'},
   {value:'공조냉동기계기사',label:'공조냉동기계기사',rules:{emb:'O',mfg:'O'}},
   {value:'금속재료기사',label:'금속재료기사',rules:{emb:'△',mfg:'△'}},
   {value:'산업안전기사',label:'산업안전기사',rules:{emb:'O',mfg:'O'}},
   {value:'산업안전산업기사',label:'산업안전산업기사',rules:{emb:'△',mfg:'O'}},
   {value:'일반기계기사',label:'일반기계기사',rules:{emb:'O',mfg:'O'}},
   {value:'전기기사',label:'전기기사',rules:{emb:'O',mfg:'O'}},
   {value:'전기공사기사',label:'전기공사기사',rules:{emb:'△',mfg:'△'}},
   {value:'품질경영기사',label:'품질경영기사',rules:{emb:'△',mfg:'△'}},
   {value:'무선설비기사',label:'무선설비기사',rules:{emb:'△',mfg:'△'},note:'필기·실기 각각 응시확인서'},
   {value:'지게차운전기능사',label:'지게차운전기능사',rules:{emb:'X',mfg:'X'},words:['지게차']},
   {value:'컴퓨터활용능력',label:'컴퓨터활용능력',rules:{emb:'△',mfg:'△'}},
   {value:'SQLD',label:'SQLD',rules:{emb:'O',mfg:'△'}},
   {value:'ADP',label:'데이터분석전문가(ADP)',rules:{emb:'O',mfg:'△'}},
   {value:'ADsP',label:'데이터분석준전문가(ADsP)',rules:{emb:'O',mfg:'△'}},
   {value:'ISTQB',label:'ISTQB',rules:{emb:'O',mfg:'△'}},
   {value:'AICE',label:'AICE',rules:{emb:'O',mfg:'△'}},
   {value:'자동차정비산업기사',label:'자동차정비산업기사',rules:{emb:'O',mfg:'O'}},
   {value:'자동차정비기능사',label:'자동차정비기능사',rules:{emb:'O',mfg:'O'}},
   {value:'자동화설비기능사',label:'자동화설비기능사',rules:{emb:'△',mfg:'O'}},
   {value:'정보보안기사',label:'정보보안기사',rules:{emb:'O',mfg:'△'}},
   {value:'정보통신기사',label:'정보통신기사',rules:{emb:'O',mfg:'O'}}]},
 },
 cats:[
  {key:'병원',label:'병원·질병',recognized:true,disease:true,memo:'병원',evidence:'진료확인서 또는 입·퇴원확인서(병원명·날짜) · 일반건강검진은 인정 안 됨',note:'질병 인정은 4회 주의 · 6회 한도',
   words:['병원','병결','병가','진료','치료','질병','입원','통원','수술','검진'],period:['병원','병원 방문','병원 진료','병원 내원','병원 치료','병원 예약','진료'],
   caution:{words:['검진'],text:'검진 종류 확인 필요 · 진료 위한 검사만 인정(일반건강검진은 인정 안 됨)'},
   subs:[{text:'병원',label:'병원 진료'},{text:'병원(치과)',label:'치과'},{text:'병원(통원 치료)',label:'통원 치료'},{text:'병원(입원)',label:'입원'},{text:'병원(수술)',label:'수술'},{text:'병원(진료 위한 검사)',label:'진료 위한 검사'},
    {text:'일반건강검진',label:'일반건강검진',recognized:false,words:['일반건강검진','일반검진'],note:'진료 위한 검사만 인정됩니다'}]},
  {key:'면접',label:'면접',recognized:true,memo:'면접',evidence:'면접확인서(성명·일시·방식·실제 참석 확인) · 없으면 담당자 확인 메일·문자 등 모두',words:['면접'],period:['면접','기업 면접','취업 면접','회사 면접','1차 면접','최종 면접'],subs:[{text:'면접',label:'기업 면접'}]},
  {key:'인적성',label:'인적성',recognized:true,memo:'인적성',kind:'인적성',evidence:'실제 응시를 확인할 수 있는 서류(응시확인서·취업활동확인서 등)',words:['인적성','HMAT','GSAT','SKCT','LTAB','AI역량검사'],beats:['시험'],
   period:['인적성','인적성 검사','AI 인적성','AI 인적성 검사','온라인 인적성','온라인 인적성 검사'],periodKinds:true,subs:[]},
  {key:'취업박람회',label:'취업박람회',recognized:true,memo:'취업박람회',extra:'기업면접 확인서',evidence:'기업 면접·1:1 채용상담 확인(성명·일시·기업명·유형·담당자 연락처) · 참가확인서·사진만으로는 안 됨',
   words:['취업박람회','채용박람회','잡페어','job fair'],beats:['면접'],period:['취업박람회','채용박람회','잡페어','job fair'],subs:[{text:'취업박람회',label:'취업박람회'}]},
  {key:'예비군',label:'예비군·민방위',recognized:true,memo:'예비군',evidence:'훈련·교육 참석 확인서(필증)',words:['예비군'],period:['예비군','예비군 훈련'],subs:[{text:'예비군',label:'예비군 훈련'},{text:'민방위',label:'민방위 교육',memo:'민방위'}]},
  {key:'자격증',label:'자격증 시험',recognized:true,memo:'시험',kind:'자격증',evidence:'응시확인서(접수확인서 불가) · 과정 관련성 1~2줄',words:['시험','응시','자격증'],subs:[]},
  {key:'경조사',label:'경조사',recognized:true,memo:'경조사',evidence:'가족관계증명서 + 부고·청첩장 등',words:['경조사'],subs:[
   {text:'부친상',label:'부친상',memo:'부친상',beats:['경조사']},{text:'모친상',label:'모친상',memo:'모친상',beats:['경조사']},{text:'조부상',label:'조부상',memo:'조부상',beats:['경조사'],except:['외조부상']},{text:'조모상',label:'조모상',memo:'조모상',beats:['경조사'],except:['외조모상']},
   {text:'외조부상',label:'외조부상',memo:'외조부상',beats:['경조사']},{text:'외조모상',label:'외조모상',memo:'외조모상',beats:['경조사']},
   {text:'경조사(본인 결혼)',label:'본인 결혼'},{text:'경조사(형제자매 결혼)',label:'형제자매 결혼'},{text:'경조사(배우자 출산)',label:'배우자 출산'}]},
  {key:'공가',label:'공가(관공서·법원)',recognized:true,memo:'공가',evidence:'출석요구서·출석 확인서 등 기관 발행 서류',words:['공가','법원','관공서'],subs:[{text:'공가(법원 출석)',label:'법원 출석'},{text:'공가(관공서 출석)',label:'관공서 출석'},{text:'공가(투표)',label:'투표'},{text:'공가(천재지변)',label:'천재지변'}]},
  {key:'교통',label:'교통',recognized:false,evidence:'',words:['교통','차량 정체'],subs:[{text:'교통',label:'교통 지연'},{text:'교통사정',label:'교통사정'},{text:'교통(사고)',label:'교통사고'}]},
  {key:'취업활동',label:'취업활동',recognized:false,evidence:'',words:['취업 상담','취업 컨설팅','취업 활동','채용 설명회','국취제','고용센터'],subs:[{text:'취업활동(채용설명회)',label:'채용설명회'},{text:'취업활동(취업상담)',label:'취업 상담'},{text:'취업활동(국취제 상담)',label:'국취제·고용센터'}]},
  {key:'개인사정',label:'개인사정',recognized:false,evidence:'',words:['개인사정','개인사유','개인일정','늦잠','이사','가족'],subs:[{text:'개인사정',label:'개인사정'},{text:'개인일정',label:'개인일정'},{text:'개인사정(가족 행사)',label:'가족 행사'},{text:'개인사정(이사)',label:'이사'},{text:'개인사정(늦잠)',label:'늦잠'}]},
 ]};
const freezeDeep=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freezeDeep);Object.freeze(o);}return o;};
export const DEFAULT_REASON_CATALOG=freezeDeep(DEFAULT);
export const cloneCatalog=data=>JSON.parse(JSON.stringify(data));

// ── 모양 확인: 관리자가 저장한 문서가 이 모양이 아니면 기본값으로 돌아갑니다. → {ok, errors[], data(정리한 것)} ──
const str=(v,max)=>typeof v==='string'&&v.trim()!==''&&v.length<=max;
const optStr=(v,max)=>v===undefined||(typeof v==='string'&&v.length<=max);
const strList=(v,maxN,maxLen)=>v===undefined||(Array.isArray(v)&&v.length<=maxN&&v.every(x=>str(x,maxLen)));
const noParen=v=>!/[()]/.test(v);
export function validateReasonCatalog(data){
 const errors=[],e=m=>{if(errors.length<20)errors.push(m);};
 if(!data||typeof data!=='object'||Array.isArray(data))return {ok:false,errors:['목록이 객체가 아닙니다'],data:null};
 const {cats,kinds={},courses,courseMap={},defaultCourse}=data;
 if(data.naHidden!==undefined&&typeof data.naHidden!=='boolean')e(`'${NA}' 숨기기(naHidden)가 참/거짓이 아닙니다`);
 if(!Array.isArray(courses)||!courses.length||courses.length>6||!courses.every(c=>str(c?.key,12)&&str(c?.label,30)&&optStr(c?.code,20)))e('과정 기준(courses) 모양이 틀립니다');
 const courseKeys=new Set((Array.isArray(courses)?courses:[]).map(c=>c?.key));
 if(courseKeys.size!==(courses?.length||0))e('과정 기준 키가 겹칩니다');
 if(!courseKeys.has(defaultCourse))e('기본 과정 기준(defaultCourse)이 과정 기준에 없습니다');
 if(!courseMap||typeof courseMap!=='object'||Object.values(courseMap).some(v=>!courseKeys.has(v)))e('반 과정 → 기준(courseMap)이 틀립니다');
 if(!kinds||typeof kinds!=='object'||Array.isArray(kinds))e('종류(kinds) 모양이 틀립니다');
 for(const [k,v] of Object.entries(kinds||{})){
  if(!str(k,20)||!noParen(k))e(`종류 이름 '${k}'이 틀립니다`);
  if(!v||!Array.isArray(v.items)||v.items.length>80){e(`종류 '${k}' 목록이 틀립니다`);continue;}
  const seen=new Set();
  for(const it of v.items){
   if(!str(it?.value,40)||!noParen(it.value)){e(`종류 '${k}'에 괄호가 있거나 빈 값이 있습니다`);continue;}
   if(seen.has(it.value))e(`종류 '${k}' 값 '${it.value}'이 겹칩니다`);seen.add(it.value);
   if(!str(it.label,60)||!optStr(it.note,200)||!strList(it.words,20,30))e(`종류 '${k}' · '${it.value}' 글이 틀립니다`);
   if(it.rules!==undefined&&(typeof it.rules!=='object'||Object.entries(it.rules).some(([c,r])=>!courseKeys.has(c)||!RULES.includes(r))))e(`종류 '${k}' · '${it.value}' 기준(O/△/X)이 틀립니다`);
  }
 }
 if(!Array.isArray(cats)||!cats.length||cats.length>40)return {ok:false,errors:[...errors,'분류(cats)가 없습니다'],data:null};
 const keys=new Set(),texts=new Set();
 for(const c of cats){
  if(!c||!str(c.key,20)||!noParen(c.key)||c.key===OTHER||c.key===NA){e(`분류 키 '${c?.key??''}'이 틀립니다(괄호·'기타'·'${NA}' 안 됨)`);continue;}
  if(keys.has(c.key))e(`분류 '${c.key}'가 겹칩니다`);keys.add(c.key);
  if(!str(c.label,40))e(`분류 '${c.key}' 이름이 비었습니다`);
  if(typeof c.recognized!=='boolean')e(`분류 '${c.key}' 인정 여부가 없습니다`);
  if(!optStr(c.evidence,300)||!optStr(c.note,200)||!optStr(c.extra,60)||!optStr(c.memo,20))e(`분류 '${c.key}' 안내 글이 틀립니다`);
  if(!strList(c.words,40,30)||!strList(c.except,20,30)||!strList(c.beats,10,20)||!strList(c.period,20,40))e(`분류 '${c.key}' 찾는 말이 틀립니다`);
  if(c.kind!==undefined&&c.kind!==''&&!(kinds&&kinds[c.kind]))e(`분류 '${c.key}'의 종류 '${c.kind}'가 없습니다`);
  if(c.caution!==undefined&&(!c.caution||!strList(c.caution.words,10,30)||!optStr(c.caution.text,200)))e(`분류 '${c.key}' 주의 글이 틀립니다`);
  if(!Array.isArray(c.subs)||c.subs.length>60){e(`분류 '${c.key}' 세부 목록이 틀립니다`);continue;}
  if(!c.kind&&!c.subs.length)e(`분류 '${c.key}'에 세부가 없습니다`);
  for(const s of c.subs){
   if(!s||!str(s.text,60)){e(`분류 '${c.key}'에 빈 세부가 있습니다`);continue;}
   if(s.text===NA)e(`'${NA}'는 고정 항목이라 세부로 넣을 수 없습니다`);
   if(texts.has(s.text))e(`세부 '${s.text}'가 겹칩니다`);texts.add(s.text);
   if(!optStr(s.label,60)||!optStr(s.memo,20)||!optStr(s.note,200)||!strList(s.words,20,30)||!strList(s.except,10,30)||!strList(s.beats,10,20))e(`세부 '${s.text}' 글이 틀립니다`);
   for(const f of ['recognized','disease','hidden'])if(s[f]!==undefined&&typeof s[f]!=='boolean')e(`세부 '${s.text}' ${f}가 참/거짓이 아닙니다`);
  }
  for(const f of ['disease','hidden','periodKinds'])if(c[f]!==undefined&&typeof c[f]!=='boolean')e(`분류 '${c.key}' ${f}가 참/거짓이 아닙니다`);
 }
 if(!cats.some(c=>!c.hidden))e('보이는 분류가 하나도 없습니다');
 return errors.length?{ok:false,errors,data:null}:{ok:true,errors:[],data:cloneCatalog(data)};
}

// ── 데이터 → 쓰기 좋은 모양 ──
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const compact=v=>String(v??'').toLowerCase().replace(/[\s\-:：]/g,'');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function compile(data){
 const kinds=Object.fromEntries(Object.entries(data.kinds||{}).map(([k,v])=>[k,{label:v.label||`${k} 종류`,items:(v.items||[]).map(i=>({...i,label:i.label||i.value}))}]));
 const cats=data.cats.map(c=>{
  const memo=c.memo??(c.recognized?c.key:'');
  const subs=(c.subs||[]).map(s=>({...s,label:s.label||s.text}));
  // 인정 안 되는 세부(일반건강검진)의 글은 분류 찾는 말에서 뺍니다(그 글 안의 '검진'으로 병원이 되지 않게).
  const blockedWords=subs.filter(s=>s.recognized===false).flatMap(s=>s.words?.length?s.words:[s.text]);
  const side=!!c.kind||subs.filter(s=>!s.hidden).length>1; // 옆 종류 드롭다운을 쓰는 분류(종류 목록 또는 보이는 세부 둘 이상)
  return {...c,memo,kind:c.kind||'',side,extra:c.extra||'',evidence:c.evidence||'',types:c.recognized?[...RECOGNIZED,...PLAIN]:PLAIN,subs,
   ruled:!!c.kind&&(kinds[c.kind]?.items||[]).some(i=>i.rules),except:[...(c.except||[]),...blockedWords]};
 });
 // 찾기 항목: 분류 하나 + 따로 정한 세부(찾는 말·체크히어 분류·인정·질병이 다른 것)
 const entries=[];
 cats.forEach((c,order)=>{
  entries.push({cat:c,order,memo:c.memo,recognized:!!c.recognized,disease:!!c.disease,words:(c.words||[]).map(compact).filter(Boolean),except:c.except.map(compact),beats:c.beats||[]});
  for(const s of c.subs){
   const own=s.words||s.memo!==undefined||s.recognized===false||s.disease!==undefined;if(!own)continue;
   const recognized=!!c.recognized&&s.recognized!==false;
   entries.push({cat:c,sub:s,order,memo:s.memo??(recognized?c.memo:''),recognized,disease:s.disease??(!!c.disease&&recognized),words:(s.words||[s.text]).map(compact),except:(s.except||[]).map(compact),beats:s.beats||[]});
  }
 });
 const visible=cats.filter(c=>!c.hidden);
 const standard=new Set(visible.flatMap(c=>c.kind?[c.key]:[...(c.side?[c.key]:[]),...c.subs.filter(s=>!s.hidden).map(s=>s.text)]));
 const extraCat=cats.find(c=>c.extra)||null;
 return {data,naHidden:data.naHidden===true,kinds,cats,visible,entries,standard,extraCat,courses:data.courses,courseMap:data.courseMap||{},defaultCourse:data.defaultCourse};
}
const matches=(e,t)=>{if(!e.words.length)return false;let x=t;for(const w of e.except)if(w)x=x.split(w).join('|');return e.words.some(w=>x.includes(w));};
const alive=hits=>hits.filter(e=>!hits.some(o=>o!==e&&o.memo!==e.memo&&e.memo&&o.beats.includes(e.memo)));

let C=compile(cloneCatalog(DEFAULT));
// 지금 쓰는 목록에서 만든 값(ES 모듈 live binding: setReasonCatalog 뒤에는 가져다 쓰는 쪽도 새 값을 봅니다)
export let REASON_CATS,STANDARD,KINDS,APTITUDE,CERTS,CERT_COURSES,COURSE_CERT_COLUMN,DEFAULT_COURSE,EXTRA_DOC,EXTRA_LABEL,EXTRA_NOTICE;
let source={from:'default',warning:'',rev:0,updatedBy:'',updatedAt:null};
function publish(){
 REASON_CATS=C.cats;STANDARD=C.standard;
 const pairs=k=>(C.kinds[k]?.items||[]).filter(i=>!i.hidden).map(i=>[i.value,i.label,i.rules||{},i.note||'',i.words||[]]);
 KINDS=Object.fromEntries(Object.keys(C.kinds).map(k=>[k,pairs(k)]));APTITUDE=KINDS['인적성']||[];CERTS=KINDS['자격증']||[];
 CERT_COURSES=C.courses;COURSE_CERT_COLUMN=C.courseMap;DEFAULT_COURSE=C.defaultCourse;
 EXTRA_DOC=C.extraCat?.extra||'기업면접 확인서';EXTRA_LABEL=`추가 증빙 필요 · ${EXTRA_DOC}`;
 EXTRA_NOTICE=`${C.extraCat?.key||'취업박람회'}는 추가 증빙이 필요합니다 · ${EXTRA_DOC} 등(박람회 현장 기업면접을 본 확인)을 받아 주세요.`;
}
publish();
// 목록 바꾸기: 모양이 틀리면 기본값 + 경고. meta {rev, updatedBy, updatedAt, from}. → {ok, warning, errors}
export function setReasonCatalog(data,meta={}){
 if(data==null){C=compile(cloneCatalog(DEFAULT));source={from:'default',warning:meta.warning||'',rev:0,updatedBy:'',updatedAt:null};publish();return {ok:!meta.warning,warning:meta.warning||'',errors:[]};}
 const v=validateReasonCatalog(data);
 if(!v.ok){const warning=`사유 목록 설정이 올바르지 않아 기본 목록을 씁니다 · ${v.errors[0]}`;C=compile(cloneCatalog(DEFAULT));source={from:'default',warning,rev:meta.rev||0,updatedBy:'',updatedAt:null};publish();return {ok:false,warning,errors:v.errors};}
 C=compile(v.data);source={from:meta.from||'saved',warning:'',rev:meta.rev||0,updatedBy:meta.updatedBy||'',updatedAt:meta.updatedAt||null};publish();return {ok:true,warning:'',errors:[]};
}
export const resetReasonCatalog=()=>setReasonCatalog(null);
export const reasonCatalogSource=()=>({...source});
export const activeReasonCatalog=()=>cloneCatalog(C.data);
// 저장 전 목록으로 잠깐 그리기(관리자 미리보기): fn 안에서만 data를 쓰고 지금 목록으로 돌아옵니다(동기 함수만).
export function withReasonCatalog(data,fn){const keep=C;try{C=compile(data);return fn();}finally{C=keep;}}

// ── 드롭다운·저장 글 ──
export const catOf=key=>C.cats.find(c=>c.key===key)||null;
export const naShown=()=>!C.naHidden; // 사유 드롭다운·담임 빠른 사유에 '해당없음'을 보일지
const kindCat=key=>{const c=catOf(key);return c?.kind?c:null;};
const kindItems=(key,{all=false}={})=>(C.kinds[key]?.items||[]).filter(i=>all||!i.hidden);
const recognizedType=t=>RECOGNIZED.includes(String(t||''));
const anyRecognized=t=>/^인정/.test(String(t||'')); // 인정출석·인정지각·…(인정결석 등 옛 이름 포함)
const subRecognized=(c,s)=>!!c.recognized&&s.recognized!==false;
const shown=c=>c.recognized?c.label:`${NOT_RECOGNIZED} ${c.label}`; // 인정 안 되는 분류는 이름 앞에 표시
// 저장 전 다듬기: 빈 괄호('인적성()')·앞뒤 공백을 지웁니다.
export const tidyReason=v=>clean(String(v??'').replace(/\(\s*\)/g,''));
function kindText(text){
 const m=clean(text).match(/^([^()]+?)(?:\s*\(\s*(.*?)\s*\))?$/),c=m&&kindCat(m[1]);
 return c?{key:c.key,cat:c,value:m[2]??'',paren:/\(/.test(clean(text))}:null;
}
const kindKnown=(c,v)=>kindItems(c.kind).some(i=>i.value===v);
// 분류·세부·직접 입력 → 표준 글. 종류 분류는 '분류(종류)', 종류 기타는 '분류(직접 입력)', 분류 '' 또는 모르는 분류는 직접 입력 글 그대로.
export function composeReason(key,value='',custom=''){
 const c=catOf(key),v=clean(value),x=clean(custom);
 if(!c)return x;
 if(c.kind){const t=v===OTHER?x:v;return t?`${c.key}(${t})`:c.key;}
 if(v===OTHER)return x?`${c.key}(${x})`:c.key;
 const list=c.subs.filter(s=>!s.hidden);
 if(list.some(s=>s.text===v))return v;
 return c.side?c.key:(list[0]?.text||c.key); // 옆 목록 분류는 세부를 고르기 전이면 분류 키('경조사')
}
// 저장된 글 → 드롭다운 위치 {cat, sub, custom}. 표준 글이 아니면 cat ''(직접 입력, 글은 그대로 고칠 수 있음).
// 목록에서 빠지거나 숨긴 옛 글('병결', '시험(자격증)')은 직접 입력, 분류는 있지만 세부가 빠진 글('면접(1차)', '예비군(동원훈련)')은 그 분류의 기타.
export function splitReason(text){
 const s=clean(text);if(!s)return {cat:'',sub:'',custom:''};
 for(const c of C.visible){const hit=c.subs.find(x=>x.text===s&&!x.hidden);if(hit)return {cat:c.key,sub:hit.text,custom:''};}
 for(const c of C.visible)if(c.side&&!c.kind&&c.key===s)return {cat:c.key,sub:'',custom:''}; // 옆 목록 분류의 키만('경조사')
 const k=kindText(s);
 if(k&&!k.cat.hidden)return kindKnown(k.cat,k.value)?{cat:k.key,sub:k.value,custom:''}:k.value?{cat:k.key,sub:OTHER,custom:k.value}:{cat:k.key,sub:'',custom:''};
 const o=s.match(/^([^()]+?)\s*\(\s*([^()]+?)\s*\)$/),c=o&&catOf(o[1]);
 if(c&&!c.hidden&&c.subs.length)return {cat:c.key,sub:OTHER,custom:o[2]};
 return {cat:'',sub:'',custom:s};
}

// ── 해석기(같은 데이터) ──
// 체크히어 메모 분류(checkhere-proposal-core reasonCategory): 인정 분류 하나로 정해질 때만. 둘 이상이면 ''(사람이 확인).
export function reasonCategoryOf(reason){
 const text=String(reason||'').trim();
 if(!text||EXCLUDE.test(text))return '';
 const t=compact(text),hits=alive(C.entries.filter(e=>matches(e,t)));
 const memos=[...new Set(hits.filter(e=>e.recognized&&e.memo).map(e=>e.memo))];
 return memos.length===1?memos[0]:'';
}
// 질병 판정(beta2-core isDiseaseReason): 질병에 넣는 분류·세부의 찾는 말이 있으면(인정 안 되는 일반건강검진은 아님)
export const isDiseaseText=reason=>{const t=compact(reason);return !!t&&C.entries.some(e=>e.disease&&matches(e,t));};
// 기간 비고(attendance-period-core normalizePeriodReason): 정확히 그 글이면 분류 키
export function periodCategoryOf(text){
 const t=compact(text);if(!t)return '';
 for(const c of C.cats){
  const ps=(c.period||[]).map(compact);if(ps.includes(t))return c.key;
  if(c.periodKinds&&c.kind)for(const p of ps)for(const i of kindItems(c.kind,{all:true}))if(t===p+compact(i.value))return c.key;
 }
 return '';
}
// 사유 글이 어느 분류인지(배지·거르기용, 넓게 봄). 못 찾으면 ''.
export function reasonKind(text){const t=compact(text);if(!t)return '';const hits=alive(C.entries.filter(e=>matches(e,t)));return hits.sort((a,b)=>a.order-b.order)[0]?.cat.key||'';}
// 추가 증빙 분류(기본: 취업박람회 → 기업면접 확인서)
export const isJobFair=text=>{const t=compact(text),c=C.extraCat;return !!c&&!!t&&C.entries.some(e=>e.cat===c&&!e.sub&&matches(e,t));};
// 추가 증빙(추가 증빙 분류 + 인정 출결). rec: {type, reason, ev, evApplied}. → null | {state:'미제출'|'제출'|'반려'|'확인'|'해당없음', done, label}
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
 return {title:`추가 증빙 필요 · ${cls}반 ${name}`,body:`${md} ${type} ${C.extraCat?.key||'취업박람회'} · ${EXTRA_DOC} 제출이 필요합니다.`};
}

// ── 자격증(과정별 기준이 있는 종류) ──
export const certColumn=cls=>C.courseMap[classInfo(cls)?.course]||C.defaultCourse;
export const certCourse=cls=>C.courses.find(c=>c.key===certColumn(cls))||C.courses[0];
const ruledCat=()=>C.cats.find(c=>c.ruled)||null;
export function certRule(value,cls){const c=ruledCat(),hit=c&&kindItems(c.kind,{all:true}).find(i=>i.value===clean(value));return hit?.rules?.[certColumn(cls)]||'△';}
// 글 → 종류 판정 {value,label,rule,course,note,known,cat} | null. '분류(종류)'와, 옛 자유 글 중 인정 안 되는 종류의 찾는 말(토익·지게차 등)을 봅니다.
export function certOf(text,cls){
 const t=clean(text),k=kindText(t),course=certCourse(cls);
 if(k?.cat.ruled){const hit=kindItems(k.cat.kind,{all:true}).find(i=>i.value===k.value);return {cat:k.cat,value:k.value,label:hit?hit.label:k.value||k.key,rule:hit?.rules?.[course.key]||'△',course,note:hit?.note||'',known:!!hit};}
 const low=compact(t);
 for(const c of C.cats.filter(c=>c.ruled)){const x=kindItems(c.kind,{all:true}).find(i=>i.words?.length&&i.rules?.[course.key]==='X'&&i.words.some(w=>low.includes(compact(w))));if(x)return {cat:c,value:x.value,label:x.label,rule:'X',course,note:x.note||'',known:true};}
 return null;
}
export const isGeneralCheckup=text=>{const t=compact(text);return !!t&&C.entries.some(e=>e.sub&&!e.recognized&&e.sub.recognized===false&&matches(e,t));};
// 인정 출결 사유 확인(행 경고·배지, 저장은 막지 않음): [{level:'error'|'warn', text}]. 인정이 아닌 출결이면 [].
// error: 인정 안 되는 세부(일반건강검진), 자격증 X 종류. warn: 분류 주의 낱말(옛 '병원(검진)'), 자격증 △·종류 없음·직접 입력.
export function reasonChecks(type,reason,{cls=''}={}){
 const t=clean(reason),out=[];if(!anyRecognized(type)||!t)return out;
 const low=compact(t),hits=C.entries.filter(e=>matches(e,low));
 const blocked=hits.filter(e=>e.sub?.recognized===false);
 for(const e of blocked)out.push({level:'error',text:`${NOT_RECOGNIZED} ${e.sub.label}${e.sub.note?` · ${e.sub.note}`:''}`});
 if(!blocked.length)for(const c of C.cats)if(c.caution?.words?.length){
  let x=low;for(const w of c.except.map(compact))if(w)x=x.split(w).join('|');
  if(c.caution.words.some(w=>x.includes(compact(w)))){out.push({level:'warn',text:c.caution.text||`${c.label} 종류 확인 필요`});}
 }
 const k=certOf(t,cls);
 if(k?.rule==='X')out.push({level:'error',text:`${NOT_RECOGNIZED} ${k.label} · ${k.course.label} 과정 인정 제외`});
 else if(k?.rule==='△')out.push({level:'warn',text:k.value?`${k.label} · 관련성 확인 필요(${k.course.label} 과정)`:`${k.cat.key} 종류 확인 필요`});
 return out;
}

// ── 드롭다운 <option> 글(escape 포함) ──
// 인정 안 되는 분류·세부는 이름 앞에 '(인정 안 됨)', 인정 출결에서는 막힌 세부(일반건강검진)를 고를 수 없습니다. 숨긴 것은 빼되, 지금 고른 값이면 보입니다.
export function catOptions(selected='',{type='',blank='분류 고르기'}={}){
 return `<option value="" ${selected?'':'selected'}>${esc(blank)}</option>`+C.cats.filter(c=>!c.hidden||c.key===selected).map(c=>`<option value="${esc(c.key)}" ${c.key===selected?'selected':''}>${esc(shown(c))}</option>`).join('')+`<option value="${OTHER}" ${selected===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 세부·종류 <option>. opts {type, cls}: 과정별 기준이 있는 종류는 반 과정 기준으로 X는 '(인정 안 됨)'(인정 출결이면 막음, 이미 고른 값은 둠), △는 '(관련성 확인 필요)'.
export function subOptions(key,selected='',{type='',cls=''}={}){
 const c=catOf(key);if(!c)return '';
 const lock=anyRecognized(type),col=c.ruled?certColumn(cls):'';
 const list=c.kind?kindItems(c.kind).map(i=>{const rule=i.rules?.[col]||'';return {text:i.value,label:rule==='X'?`${NOT_RECOGNIZED} ${i.label}`:rule==='△'?`${i.label} ${NEEDS_CHECK}`:i.label,off:rule==='X',title:i.note||''};})
  :c.subs.filter(s=>!s.hidden||s.text===selected).map(s=>({text:s.text,label:subRecognized(c,s)?s.label:`${NOT_RECOGNIZED} ${s.label}`,off:!!c.recognized&&s.recognized===false,title:''}));
 return (c.side?`<option value="" ${selected?'':'selected'}>종류 고르기</option>`:'')+list.map(s=>`<option value="${esc(s.text)}" ${s.text===selected?'selected':''}${lock&&s.off&&s.text!==selected?' disabled':''}${s.title?` title="${esc(s.title)}"`:''}>${esc(s.label)}</option>`).join('')+`<option value="${OTHER}" ${selected===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 글 → 사유 칸 상태 {main:''|표준 글|옆 목록 분류 키|'기타', kind:옆 종류 드롭다운 분류(''이면 없음), apt:옆 칸 값('', 종류 값·세부 저장 글, '기타'), input:직접 입력 칸을 보일지, custom:옆 칸 기타 글}.
// custom=true면 '기타'를 고른 상태를 지킵니다. 숨긴 세부의 옛 글은 '분류(…)'이면 그 분류 + 옆 칸 기타, 아니면 기타(직접 입력)로 글 그대로.
export function reasonPick(text,{custom=false}={}){
 const t=clean(text),none={main:'',kind:'',apt:'',input:false,custom:''},free={main:OTHER,kind:'',apt:'',input:true,custom:''};
 if(custom)return free;
 if(isNA(t))return {main:NA,kind:'',apt:'',input:false,custom:''}; // 고정 항목(숨겨도 저장된 값이면 보임)
 const k=kindText(t);
 if(k&&!k.cat.hidden){const known=kindKnown(k.cat,k.value);return known?{main:k.key,kind:k.key,apt:k.value,input:false,custom:''}:k.paren?{main:k.key,kind:k.key,apt:OTHER,input:true,custom:k.value}:{main:k.key,kind:k.key,apt:'',input:false,custom:''};}
 for(const c of C.visible){
  if(!c.side||c.kind)continue;
  const hit=c.subs.find(s=>s.text===t&&!s.hidden);if(hit)return {main:c.key,kind:c.key,apt:hit.text,input:false,custom:''};
  if(t===c.key)return {main:c.key,kind:c.key,apt:'',input:false,custom:''};
  const m=t.match(/^([^()]+?)\s*\(\s*([^()]*?)\s*\)$/);if(m&&m[1]===c.key)return {main:c.key,kind:c.key,apt:OTHER,input:true,custom:m[2]};
 }
 if(C.standard.has(t))return {main:t,kind:'',apt:'',input:false,custom:''};
 return t?free:none;
}
// 사유 드롭다운 <option>: 분류마다 하나(옆 목록 분류는 값 = 분류 키, 이름 = 분류 이름 · 세부가 하나뿐이면 값 = 그 저장 글), 인정 안 되는 분류·세부는 '(인정 안 됨) ', 끝에 '기타 (직접 입력)'.
// 인정 출결이면 막힌 세부(일반건강검진 등)는 옆 칸에서 고를 수 없습니다(세부가 하나뿐인 분류면 여기서 막음, 이미 저장된 값이면 그대로 보임). catalog를 주면 그 목록으로 그립니다(관리자 미리보기).
export function reasonOptions(main='',{type='',blank='사유 고르기',catalog=null}={}){
 if(catalog)return withReasonCatalog(catalog,()=>reasonOptions(main,{type,blank}));
 const lock=anyRecognized(type);
 return `<option value="" ${main?'':'selected'}>${esc(blank)}</option>`+(!C.naHidden||main===NA?`<option value="${NA}" ${main===NA?'selected':''}>${NA}</option>`:'')+C.visible.map(c=>{
  if(c.side)return `<option value="${esc(c.key)}" ${c.key===main?'selected':''}>${esc(shown(c))}</option>`;
  const s=c.subs.find(x=>!x.hidden);if(!s)return '';
  const ok=subRecognized(c,s),off=lock&&!!c.recognized&&s.recognized===false&&s.text!==main;
  return `<option value="${esc(s.text)}" ${s.text===main?'selected':''}${off?' disabled':''}>${ok?'':`${NOT_RECOGNIZED} `}${esc(c.label)}</option>`;
 }).join('')+`<option value="${OTHER}" ${main===OTHER?'selected':''}>기타 (직접 입력)</option>`;
}
// 인정 출결인데 인정 분류가 아니면(교통·개인사정·취업활동) 짧은 안내
export const typeWarning=(type,key)=>{const c=catOf(key);return c&&recognizedType(type)&&!c.recognized?`${c.label}은 보통 인정 사유가 아닙니다`:'';};
