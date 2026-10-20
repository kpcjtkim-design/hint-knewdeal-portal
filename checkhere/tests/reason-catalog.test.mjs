import test from 'node:test';
import assert from 'node:assert/strict';
import {STANDARD,reasonPick,reasonOptions,REASON_CATS,APTITUDE,CERTS,KINDS,COURSE_CERT_COLUMN,certColumn,certRule,certOf,reasonChecks,isGeneralCheckup,DEFAULT_REASON_CATALOG,cloneCatalog,validateReasonCatalog,setReasonCatalog,resetReasonCatalog,reasonCatalogSource,OTHER,RECOGNIZED,EXTRA_DOC,EXTRA_LABEL,composeReason,splitReason,tidyReason,reasonKind,isJobFair,extraEvidence,extraEvidenceStarted,extraNotice,catOptions,subOptions,typeWarning,catOf} from '../../attendance-reason-catalog.mjs';
import {reasonCategory,suggestReason} from '../../checkhere-proposal-core.mjs';
import {normalizePeriodReason} from '../../attendance-period-core.mjs';
import {reasonFor} from '../../attendance-reason-parser.mjs';
import {isDiseaseReason,decodeBundle,studentStats,evidenceRows,extraEvidenceRows} from '../../beta2-core.mjs';
import {hasHospitalRecognition} from '../../disease-recognition-core.mjs';
import {sheetToCheckHere} from '../../beta2-checkhere-core.mjs';

// 드롭다운이 만드는 표준 글 전부(분류 → 세부, 인적성은 종류)
const ALL=REASON_CATS.flatMap(c=>c.kind?KINDS[c.kind].map(([v])=>({c,text:composeReason(c.key,v)})):c.subs.map(s=>({c,s,text:composeReason(c.key,s.text)})));
// 표준 글 → 체크히어 메모 분류(reasonCategory). 인정 출결에 쓰는 분류는 하나로 정해져야 체크히어로 보냅니다.
const EXPECT={병원:'병원',면접:'면접',인적성:'인적성',취업박람회:'취업박람회',자격증:'시험',공가:'공가'};

test('every composed reason is recognised by the existing parsers: CheckHere category, disease, period remarks',()=>{
 assert.ok(ALL.length>=50,'catalog covers the reasons used so far');
 for(const {c,s,text} of ALL){
  const cat=reasonCategory(text);
  if(s?.recognized===false){assert.equal(cat,'',text);assert.equal(isDiseaseReason(text),false,`disease ${text}`);assert.equal(normalizePeriodReason(text),text);continue;} // 일반건강검진
  if(c.key==='예비군')assert.equal(cat,text.startsWith('민방위')?'민방위':'예비군',text);
  else if(c.key==='경조사')assert.equal(cat,/상$/.test(text)?text:'경조사',text);
  else if(EXPECT[c.key])assert.equal(cat,EXPECT[c.key],text);
  else assert.equal(cat,'',`${text} is not a recognised (인정) reason`);
  assert.equal(isDiseaseReason(text),c.key==='병원',`disease ${text}`);
  assert.equal(reasonKind(text),c.key==='예비군'?'예비군':c.key,`kind ${text}`);
  if(c.types.some(t=>RECOGNIZED.includes(t)))assert.ok(EXPECT[c.key]||['예비군','경조사'].includes(c.key));
 }
 // 기간 출결 비고(가-3 → 단위기간): '분류(세부)'도 분류로 봅니다.
 for(const [text,want] of [['면접(최종)','면접'],['병원(치과)','병원'],['취업박람회(현장 면접)','취업박람회'],['예비군(동원훈련)','예비군'],['인적성(HMAT)','인적성'],['인적성(NCS)','인적성'],['인적성 HMAT','인적성'],['AI 인적성 검사','인적성'],['인적성(내가 쓴 종류)','인적성'],['시험(자격증)','시험(자격증)'],['자격증(전기기사)','자격증(전기기사)'],['병원(진료 위한 검사)','병원'],['개인사정(이사)','개인사정(이사)'],['','개인사정'],['병원','병원'],['채용 박람회','취업박람회']])
  assert.equal(normalizePeriodReason(text),want,text);
 // 가-3 원문에서 이름 뒤 사유로 그대로 읽힙니다(괄호를 지우지 않음).
 assert.equal(reasonFor('홍길동','인정출석 홍길동 인적성(HMAT)',['홍길동']),'인적성(HMAT)');
 assert.equal(reasonFor('홍길동','인정지각: 홍길동_취업박람회(현장 면접)',['홍길동']),'취업박람회(현장 면접)');
});

test('the generic words still follow the old rules: two different reasons stay unresolved, a named funeral and a job-fair interview are one',()=>{
 assert.equal(reasonCategory('병원 면접'),'');assert.equal(reasonCategory('인적성 시험'),'인적성');assert.equal(reasonCategory('GSAT 응시'),'인적성');
 assert.equal(reasonCategory('취업박람회 현장 면접'),'취업박람회');assert.equal(reasonCategory('경조사(조모상)'),'조모상');assert.equal(reasonCategory('경조사'),'경조사');
 assert.equal(reasonCategory('법원 출석'),'공가');assert.equal(reasonCategory('병원 확인 필요'),'');assert.equal(reasonCategory('교통사정'),'');
});

test('2) 인적성 types: HMAT·GSAT… compose 인적성(종류), 기타 takes free text, and CheckHere memos say 인적성',()=>{
 assert.deepEqual(APTITUDE.map(([,l])=>l),['HMAT(현대차그룹)','GSAT(삼성)','SKCT(SK)','LG Way Fit','CJ CAT','L-TAB(롯데)','PAT(포스코)','KT','NCS(공기업)','AI역량검사']);
 assert.equal(composeReason('인적성','HMAT'),'인적성(HMAT)');assert.equal(composeReason('인적성',''),'인적성');
 assert.equal(composeReason('인적성',OTHER,' 두산 DCAT '),'인적성(두산 DCAT)');assert.equal(composeReason('인적성',OTHER,''),'인적성');
 assert.deepEqual(splitReason('인적성(HMAT)'),{cat:'인적성',sub:'HMAT',custom:''});
 assert.deepEqual(splitReason('인적성(두산 DCAT)'),{cat:'인적성',sub:OTHER,custom:'두산 DCAT'});
 assert.deepEqual(splitReason('인적성'),{cat:'인적성',sub:'',custom:''});
 for(const [v] of APTITUDE){const text=composeReason('인적성',v);assert.equal(reasonCategory(text),'인적성',text);assert.equal(normalizePeriodReason(text),'인적성',text);}
 const rec={id:'r',version:'v',readState:'complete',classId:'1',date:'2026-11-05',name:'가상',teacher:'가상담임',rawEntry:'09:40:00',entry:'09:40:00',exit:'18:00:00',outings:[]};
 assert.equal(suggestReason({status:'인정지각',reason:'인적성(GSAT)',record:rec}).text,'(인정지각)인적성_담임:가상담임(09:40)');
 const res=sheetToCheckHere({row:{type:'인정출석',reason:'인적성(HMAT)'},record:{...rec,rawEntry:'09:00:00',entry:'09:00:00',schedule:'09:00 ~ 18:00',source:'live',phoneLast4:'1234'},sheetTeacher:'가상담임',date:'2026-11-05',me:'a@b.c'});
 assert.equal(res.state,'send',JSON.stringify(res));assert.equal(res.changes.entryMemo,'(인정출석)인적성_담임:가상담임');
 const fair=sheetToCheckHere({row:{type:'인정출석',reason:'취업박람회'},record:{...rec,rawEntry:'09:00:00',entry:'09:00:00',schedule:'09:00 ~ 18:00',source:'live',phoneLast4:'1234'},sheetTeacher:'가상담임',date:'2026-11-05',me:'a@b.c'});
 assert.equal(fair.changes.entryMemo,'(인정출석)취업박람회_담임:가상담임','취업박람회 is now a recognised category instead of a hold');
 // 병원 세부는 체크히어 메모에 '병원'으로 가서 질병 인정으로 셉니다.
 const sick=suggestReason({status:'인정지각',reason:'병원(치과)',record:rec}).text;
 assert.equal(sick,'(인정지각)병원_담임:가상담임(09:40)');assert.equal(hasHospitalRecognition({entryMemo:sick}),true);
});

test('saved texts map back to the dropdowns, old quick texts are found, unknown texts stay as free text',()=>{
 for(const {c,text} of ALL){const s=splitReason(text);assert.equal(s.cat,c.key,text);assert.equal(composeReason(s.cat,s.sub,s.custom),text,text);}
 for(const [text,cat] of [['개인일정','개인사정'],['교통사정','교통'],['면접','면접'],['예비군','예비군'],['민방위','예비군'],['병원(감기)','병원']])assert.equal(splitReason(text).cat,cat,text);
 // 목록에서 빠진 옛 글: 분류가 남은 것은 그 분류의 기타(세부 직접 입력), 분류가 없어진 것은 직접 입력(cat ''). 해석기는 그대로입니다.
 assert.deepEqual(splitReason('병결'),{cat:'',sub:'',custom:'병결'});assert.equal(reasonCategory('병결'),'병원');assert.equal(isDiseaseReason('병결'),true);
 assert.deepEqual(splitReason('면접(1차)'),{cat:'면접',sub:OTHER,custom:'1차'});assert.equal(reasonCategory('면접(최종)'),'면접');assert.equal(normalizePeriodReason('면접(1차)'),'면접');
 assert.deepEqual(splitReason('예비군(동원훈련)'),{cat:'예비군',sub:OTHER,custom:'동원훈련'});assert.equal(reasonCategory('예비군(동원훈련)'),'예비군');
 assert.deepEqual(splitReason('취업박람회(현장 면접)'),{cat:'취업박람회',sub:OTHER,custom:'현장 면접'});assert.equal(reasonCategory('취업박람회(현장 면접)'),'취업박람회');
 assert.deepEqual(splitReason('시험(자격증)'),{cat:'',sub:'',custom:'시험(자격증)'});assert.equal(reasonCategory('시험(자격증)'),'시험');assert.equal(reasonKind('시험(자격증)'),'자격증');
 assert.deepEqual(splitReason('병원(검진)'),{cat:'병원',sub:OTHER,custom:'검진'});assert.equal(reasonCategory('병원(검진)'),'병원');assert.equal(isDiseaseReason('병원(검진)'),true);
 assert.deepEqual(splitReason('병원(감기)'),{cat:'병원',sub:OTHER,custom:'감기'});assert.equal(composeReason('병원',OTHER,'감기'),'병원(감기)');
 assert.deepEqual(splitReason('병원 진료 후 복귀'),{cat:'',sub:'',custom:'병원 진료 후 복귀'});
 assert.deepEqual(splitReason(''),{cat:'',sub:'',custom:''});
 assert.equal(composeReason('',null,' 직접 쓴 사유 '),'직접 쓴 사유');assert.equal(composeReason(OTHER,'','가족 돌봄'),'가족 돌봄');
 assert.equal(composeReason('면접','없는 세부'),'면접','an unknown sub falls back to the category');
 assert.equal(tidyReason(' 인적성( ) '),'인적성');
 // 드롭다운 글: 모든 분류 + 기타, 인적성은 종류 + 기타, 출결과 맞지 않는 분류는 '(인정 아님)'
 const opts=catOptions('면접',{type:'인정출석'});
 for(const c of REASON_CATS)assert.ok(opts.includes(`>${c.recognized?'':'(인정 안 됨) '}${c.label}<`),c.label); // 데이터 이름은 그대로, 화면 글에 표시
 assert.match(opts,/value="면접" selected/);assert.match(opts,/>\(인정 안 됨\) 교통</);assert.match(opts,/>\(인정 안 됨\) 취업활동</);assert.match(opts,/>\(인정 안 됨\) 개인사정</);assert.doesNotMatch(opts,/인정 아님/);assert.match(opts,/기타 \(직접 입력\)/);
 assert.match(subOptions('인적성','GSAT'),/value="GSAT" selected>GSAT\(삼성\)/);assert.match(subOptions('인적성'),/종류 고르기/);assert.match(subOptions('인적성'),/기타 \(직접 입력\)/);
 assert.equal(subOptions('없음'),'');assert.equal(typeWarning('인정출석','교통'),'교통은 보통 인정 사유가 아닙니다');assert.equal(typeWarning('지각','교통'),'');
 assert.equal(catOf('취업박람회').extra,EXTRA_DOC);
});

test('3) 취업박람회 + 인정 출결 needs the extra 기업면접 확인서 until evidence is 확인, and starts once for notifications',()=>{
 assert.equal(EXTRA_LABEL,'추가 증빙 필요 · 기업면접 확인서');
 assert.ok(isJobFair('채용 박람회')&&isJobFair('잡페어')&&!isJobFair('면접'));
 assert.equal(extraEvidence({type:'결석',reason:'취업박람회'}),null,'not recognised → no extra evidence');
 assert.equal(extraEvidence({type:'인정출석',reason:'면접'}),null);
 assert.deepEqual(extraEvidence({type:'인정출석',reason:'취업박람회',ev:''}),{state:'미제출',done:false,doc:EXTRA_DOC,label:EXTRA_LABEL});
 assert.equal(extraEvidence({type:'인정조퇴',reason:'취업박람회(현장 면접)',ev:'반려'}).state,'반려');
 assert.equal(extraEvidence({type:'인정지각',reason:'취업박람회',ev:'확인'}).done,true);
 assert.equal(extraEvidence({type:'인정지각',reason:'취업박람회',ev:'',evApplied:'미제출'}).state,'미제출');
 assert.equal(extraEvidenceStarted(null,{type:'인정출석',reason:'취업박람회'}),true);
 assert.equal(extraEvidenceStarted({type:'결석',reason:'취업박람회'},{type:'인정출석',reason:'취업박람회'}),true);
 assert.equal(extraEvidenceStarted({type:'인정출석',reason:'취업박람회'},{type:'인정출석',reason:'취업박람회(현장 면접)'}),false,'already needed → no second notice');
 assert.equal(extraEvidenceStarted({type:'인정출석',reason:'취업박람회'},{type:'인정출석',reason:'면접'}),false);
 assert.equal(extraEvidenceStarted(null,{type:'인정출석',reason:'취업박람회',ev:'확인'}),false,'already confirmed → nothing to ask');
 assert.deepEqual(extraNotice({cls:'3',name:'가상',date:'2026-11-05',type:'인정출석'}),{title:'추가 증빙 필요 · 3반 가상',body:'11/5 인정출석 취업박람회 · 기업면접 확인서 제출이 필요합니다.'});
 const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
 const L=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,reason:'',ev:'',evr:'',evApplied:type.startsWith('인정')?(o.ev||'미제출'):'해당없음',...o})[k]??'');
 const b=decodeBundle({rev:1,today:'2026-11-06',days:['2026-11-04','2026-11-05','2026-11-06'],classes:[],roster:[['1','가','재학',''],['2','나','재학','']],ledgerCols:COLS,
  ledger:[L('2026-11-04','1','가','인정출석',{reason:'취업박람회',ev:'확인'}),L('2026-11-05','1','가','인정조퇴',{reason:'취업박람회(현장 면접)'}),L('2026-11-05','2','나','결석',{reason:'취업박람회'}),L('2026-11-06','2','나','인정출석',{reason:'병원'})]});
 assert.deepEqual(extraEvidenceRows(b).map(r=>[r.cls,r.name,r.date,r.state,r.done]),[['1','가','2026-11-05','미제출',false],['1','가','2026-11-04','확인',true]],'outstanding first, 결석 is not tracked');
 assert.deepEqual(extraEvidenceRows(b,{cls:'2'}),[]);
 // 17반 테스트반: 그 반을 고르면 보이고, 전체 반에서는 빠짐
 const t=decodeBundle({rev:1,today:'2026-11-06',days:['2026-11-05'],classes:[],roster:[['17','시험','재학','']],ledgerCols:COLS,ledger:[L('2026-11-05','17','시험','인정출석',{reason:'취업박람회'})]});
 assert.equal(extraEvidenceRows(t).length,0);assert.equal(extraEvidenceRows(t,{cls:'17'}).length,1);assert.equal(extraEvidenceRows(b,{from:'2026-11-05'}).length,1);
 assert.deepEqual(evidenceRows(studentStats(b)).map(r=>[r.name,r.date,r.reason,r.extra]),[['가','2026-11-05','취업박람회(현장 면접)',true],['나','2026-11-06','병원',false]]);
});

test('출결대조 사유 드롭다운 하나: 표준 글은 그대로 고르고, 인적성은 옆 종류, 목록에 없으면 기타 + 직접 입력',()=>{
 assert.ok(STANDARD.has('병원(치과)')&&STANDARD.has('인적성')&&STANDARD.has('개인일정')&&!STANDARD.has('인적성(HMAT)')&&!STANDARD.has('병원 진료'));
 assert.deepEqual(reasonPick(''),{main:'',kind:'',apt:'',input:false,custom:''});
 assert.deepEqual(reasonPick('면접'),{main:'면접',kind:'',apt:'',input:false,custom:''});
 assert.deepEqual(reasonPick('면접(최종)'),{main:OTHER,kind:'',apt:'',input:true,custom:''},'a removed entry is free text');
 assert.deepEqual(reasonPick('인적성'),{main:'인적성',kind:'인적성',apt:'',input:false,custom:''});
 assert.deepEqual(reasonPick('인적성(HMAT)'),{main:'인적성',kind:'인적성',apt:'HMAT',input:false,custom:''});
 assert.deepEqual(reasonPick('인적성()'),{main:'인적성',kind:'인적성',apt:OTHER,input:true,custom:''});
 assert.deepEqual(reasonPick('인적성(DCAT)'),{main:'인적성',kind:'인적성',apt:OTHER,input:true,custom:'DCAT'});
 assert.deepEqual(reasonPick('자격증(전기기사)'),{main:'자격증',kind:'자격증',apt:'전기기사',input:false,custom:''});
 assert.deepEqual(reasonPick('자격증(정보처리기사)'),{main:'자격증',kind:'자격증',apt:OTHER,input:true,custom:'정보처리기사'});
 assert.deepEqual(reasonPick('시험(자격증)'),{main:OTHER,kind:'',apt:'',input:true,custom:''});
 assert.deepEqual(reasonPick('병원 진료'),{main:OTHER,kind:'',apt:'',input:true,custom:''},'old free texts stay editable');
 assert.deepEqual(reasonPick('',{custom:true}),{main:OTHER,kind:'',apt:'',input:true,custom:''});
 assert.deepEqual(reasonPick('교통',{custom:true}).main,OTHER,'a picked 기타 stays open while typing a listed word');
 const o=reasonOptions('취업박람회',{type:'인정출석',blank:'사유 (필수)'});
 assert.match(o,/^<option value="" >사유 \(필수\)<\/option>/);assert.match(o,/<option value="취업박람회" selected>/);assert.match(o,/<optgroup label="\(인정 안 됨\) 교통">/);assert.match(o,/<option value="취업활동\(채용설명회\)" >\(인정 안 됨\) 취업활동\(채용설명회\)<\/option>/);assert.match(o,/<option value="기타" >기타 \(직접 입력\)<\/option>$/);
 assert.equal((o.match(/<option /g)||[]).length,STANDARD.size+2);
 for(const t of STANDARD)assert.ok(reasonCategory(t)||t==='일반건강검진'||['교통','교통사정','교통(사고)','개인사정','개인일정'].includes(t)||/^(교통|취업활동|개인사정)/.test(t),t);
});

test('목록 개정(사용자 2026-10-20): 병결 없음, 면접·취업박람회 하나, 예비군·민방위 둘, 자격증 시험 + 종류, 인정 안 됨 표시는 화면 글에만',()=>{
 const subs=k=>catOf(k).subs.map(s=>s.text);
 assert.deepEqual(subs('병원'),['병원','병원(치과)','병원(통원 치료)','병원(입원)','병원(수술)','병원(진료 위한 검사)','일반건강검진']);
 assert.deepEqual(subs('면접'),['면접']);assert.deepEqual(subs('취업박람회'),['취업박람회']);assert.deepEqual(subs('예비군'),['예비군','민방위']);
 assert.equal(catOf('시험'),null);assert.equal(catOf('자격증').label,'자격증 시험');assert.match(catOf('자격증').evidence,/응시확인서\(접수확인서 불가\)/);
 assert.deepEqual(REASON_CATS.filter(c=>!c.types.includes('인정출석')).map(c=>[c.key,c.label,c.recognized]),[['교통','교통',false],['취업활동','취업활동',false],['개인사정','개인사정',false]]);
 assert.ok(!STANDARD.has('병결')&&!STANDARD.has('면접(최종)')&&!STANDARD.has('취업박람회(현장 면접)')&&STANDARD.has('자격증')&&STANDARD.has('취업활동(채용설명회)'));
 assert.equal(catOf('취업박람회').extra,EXTRA_DOC);
 // 자격증 종류: FAQ 시트 순서, 값은 괄호 없는 짧은 이름
 assert.deepEqual(CERTS.map(([,l])=>l),['어학시험(토익, 오픽 등)','가스기사','건설안전기사','공조냉동기계기사','금속재료기사','산업안전기사','산업안전산업기사','일반기계기사','전기기사','전기공사기사','품질경영기사','무선설비기사','지게차운전기능사','컴퓨터활용능력','SQLD','데이터분석전문가(ADP)','데이터분석준전문가(ADsP)','ISTQB','AICE','자동차정비산업기사','자동차정비기능사','자동화설비기능사','정보보안기사','정보통신기사']);
 assert.ok(CERTS.every(([v])=>!/[()]/.test(v)));
 assert.equal(composeReason('자격증','전기기사'),'자격증(전기기사)');assert.equal(composeReason('자격증',OTHER,' 정보처리기사 '),'자격증(정보처리기사)');assert.equal(composeReason('자격증',''),'자격증');
 assert.deepEqual(splitReason('자격증(ADsP)'),{cat:'자격증',sub:'ADsP',custom:''});assert.deepEqual(splitReason('자격증(정보처리기사)'),{cat:'자격증',sub:OTHER,custom:'정보처리기사'});
 for(const [v] of CERTS){const t=composeReason('자격증',v);assert.equal(reasonCategory(t),'시험',t);assert.equal(isDiseaseReason(t),false,t);assert.equal(reasonKind(t),'자격증',t);}
 const rec={id:'r',version:'v',readState:'complete',classId:'2',date:'2026-11-05',name:'가상',teacher:'가상담임',rawEntry:'09:40:00',entry:'09:40:00',exit:'18:00:00',outings:[]};
 assert.equal(suggestReason({status:'인정지각',reason:'자격증(전기기사)',record:rec}).text,'(인정지각)시험_담임:가상담임(09:40)');
});

test('자격증 과정별 인정 기준(FAQ Q~S열): 모빌리티 AI·테스트반은 임베디드AI, 제조지능화는 제조지능화 열, X는 인정 출결에서 막고 △는 관련성 확인',()=>{
 assert.deepEqual(COURSE_CERT_COLUMN,{'모빌리티 AI':'emb','제조지능화':'mfg'});
 assert.equal(certColumn('1'),'emb');assert.equal(certColumn('2'),'mfg');assert.equal(certColumn('17'),'emb');assert.equal(certColumn(''),'emb');
 assert.equal(certRule('SQLD','1'),'O');assert.equal(certRule('SQLD','2'),'△');assert.equal(certRule('산업안전산업기사','1'),'△');assert.equal(certRule('산업안전산업기사','2'),'O');
 assert.equal(certRule('자동화설비기능사','1'),'△','시트 빈칸은 △');assert.equal(certRule('정보보안기사','2'),'△');assert.equal(certRule('어학시험','1'),'X');assert.equal(certRule('지게차운전기능사','2'),'X');
 assert.equal(certRule('정보처리기사','1'),'△','목록에 없는 종류는 관련성 확인');
 // 드롭다운: X는 '(인정 안 됨)'이고 인정 출결이면 막힘, 인정이 아닌 출결이면 고를 수 있음, △는 '(관련성 확인 필요)'
 const o=subOptions('자격증','',{type:'인정출석',cls:'2'});
 assert.match(o,/<option value="어학시험"  disabled>\(인정 안 됨\) 어학시험\(토익, 오픽 등\)<\/option>/);assert.match(o,/<option value="지게차운전기능사"  disabled>/);
 assert.match(o,/<option value="SQLD" >SQLD \(관련성 확인 필요\)<\/option>/);assert.match(o,/<option value="전기기사" >전기기사<\/option>/);assert.match(o,/^<option value="" selected>종류 고르기/);assert.match(o,/기타 \(직접 입력\)<\/option>$/);
 assert.match(subOptions('자격증','',{type:'인정출석',cls:'1'}),/<option value="SQLD" >SQLD<\/option>/);
 assert.doesNotMatch(subOptions('자격증','',{type:'결석',cls:'2'}),/disabled/);
 assert.match(subOptions('자격증','어학시험',{type:'인정출석',cls:'2'}),/<option value="어학시험" selected>/,'a saved X stays visible (with a red warning)');
 // 경고: X·일반건강검진은 빨강(error), △·검진 종류 모름은 주의(warn), 인정이 아닌 출결은 없음
 assert.deepEqual(reasonChecks('인정출석','자격증(어학시험)',{cls:'1'}),[{level:'error',text:'(인정 안 됨) 어학시험(토익, 오픽 등) · 임베디드AI 과정 인정 제외'}]);
 assert.deepEqual(reasonChecks('인정출석','자격증(SQLD)',{cls:'2'}),[{level:'warn',text:'SQLD · 관련성 확인 필요(제조지능화 과정)'}]);
 assert.deepEqual(reasonChecks('인정출석','자격증(SQLD)',{cls:'1'}),[]);
 assert.deepEqual(reasonChecks('인정출석','자격증',{cls:'1'}),[{level:'warn',text:'자격증 종류 확인 필요'}]);
 assert.deepEqual(reasonChecks('결석','자격증(어학시험)',{cls:'1'}),[]);
 assert.equal(reasonChecks('인정지각','시험(어학)',{cls:'2'})[0].level,'error','old free text for a language test is also not recognised');
 assert.equal(reasonChecks('인정출석','토익 응시',{cls:'2'})[0].level,'error');
 assert.equal(certOf('면접',''),null);
});

test('검진 구분(규정 0917 「일반건강검진은 불인정」): 진료 위한 검사만 질병 인정, 일반건강검진은 막힌 항목, 옛 병원(검진)은 종류 확인',()=>{
 assert.ok(isGeneralCheckup('일반건강검진')&&isGeneralCheckup('일반 검진')&&!isGeneralCheckup('병원(진료 위한 검사)'));
 assert.equal(isDiseaseReason('일반건강검진'),false);assert.equal(isDiseaseReason('일반 건강 검진'),false);assert.equal(isDiseaseReason('병원(진료 위한 검사)'),true);assert.equal(isDiseaseReason('검진'),true);
 assert.equal(reasonCategory('일반건강검진'),'');assert.equal(reasonCategory('병원(진료 위한 검사)'),'병원');
 const o=reasonOptions('',{type:'인정출석'});
 assert.match(o,/<option value="일반건강검진"  disabled>\(인정 안 됨\) 일반건강검진<\/option>/);
 assert.match(o,/<option value="병원\(진료 위한 검사\)" >병원\(진료 위한 검사\)<\/option>/);
 assert.doesNotMatch(reasonOptions('',{type:'결석'}),/disabled/);
 assert.match(subOptions('병원','',{type:'인정출석'}),/<option value="일반건강검진"  disabled>\(인정 안 됨\) 일반건강검진<\/option>/);
 assert.deepEqual(reasonChecks('인정출석','일반건강검진'),[{level:'error',text:'(인정 안 됨) 일반건강검진 · 진료 위한 검사만 인정됩니다'}]);
 assert.deepEqual(reasonChecks('인정출석','병원(검진)'),[{level:'warn',text:'검진 종류 확인 필요 · 진료 위한 검사만 인정(일반건강검진은 인정 안 됨)'}]);
 assert.deepEqual(reasonChecks('인정출석','병원(진료 위한 검사)'),[]);assert.deepEqual(reasonChecks('결석','일반건강검진'),[]);
 assert.equal(typeWarning('인정출석','개인사정'),'개인사정은 보통 인정 사유가 아닙니다');
});

// 데이터화(사용자 2026-10-20): 해석기가 고정 규칙 대신 사유 목록 데이터의 찾는 말을 씁니다. 기본 목록에서는 옛 고정 규칙(d2005c5)과 결과가 같아야 합니다(옛 기록 해석이 바뀌지 않음).
const OLD={
 category(reason){
  const text=String(reason||'').trim();
  if(!text||/확인\s*필요|불명|미정|아님|취소/.test(text))return '';
  const found=[['병원',/병원|병결|병가|진료|치료|질병|입원|통원|수술|(?<!일반\s*(?:건강\s*)?)검진/],['면접',/면접/],['인적성',/인적성|HMAT|GSAT|SKCT|L-?TAB|AI\s*역량\s*검사/i],['취업박람회',/취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair/i],['예비군',/예비군/],['민방위',/민방위/],['시험',/시험|응시|자격증/],['외조모상',/외조모상/],['외조부상',/외조부상/],['조모상',/(?<!외)조모상/],['조부상',/(?<!외)조부상/],['모친상',/모친상/],['부친상',/부친상/],['경조사',/경조사/],['공가',/공가|법원|관공서/]].filter(([,re])=>re.test(text));
  const has=k=>found.some(([v])=>v===k),funeral=found.some(([v])=>/상$/.test(v));
  const kinds=found.map(([k])=>k).filter(k=>!(k==='시험'&&has('인적성'))&&!(k==='면접'&&has('취업박람회'))&&!(k==='경조사'&&funeral));
  return kinds.length===1?kinds[0]:'';
 },
 disease:r=>/병원|병결|병가|진료|질병|입원|통원|수술|치료|(?<!일반\s*(?:건강\s*)?)검진/.test(String(r||'')),
 period(value){
  const APT=/^(?:(?:AI|온라인)\s*)?인적성(?:\s*검사)?(?:\s*[-:：]?\s*(?:HMAT|GSAT|SKCT|LG\s*Way\s*Fit|CJ\s*CAT|L-?TAB|PAT|KT|NCS|AI\s*역량\s*검사))?$/i;
  const cat=s=>/^(?:병원(?:\s*(?:방문|진료|내원|치료|예약))?|진료)$/.test(s)?'병원':/^(?:(?:기업|취업|회사|1차|최종)\s*)?면접$/.test(s)?'면접':APT.test(s)?'인적성':/^(?:취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair)$/i.test(s)?'취업박람회':/^예비군(?:\s*훈련)?$/.test(s)?'예비군':'';
  const s=String(value||'').trim();if(!s)return '개인사정';const m=s.match(/^([^()]+?)\s*\(\s*[^()]*\)$/);return cat(s)||(m&&cat(m[1].trim()))||s;
 },
 jobFair:t=>/취업\s*박람회|채용\s*박람회|잡\s*페어|job\s*fair/i.test(String(t??'')),
};
const CORPUS=[...STANDARD,...ALL.map(x=>x.text),'','해당없음','병결','병가','병원 진료','진료 후 복귀','검진','건강검진','일반건강검진','일반 검진','일반 건강 검진','병원(검진)','통원 치료','치과','질병','치료','입원','수술',
 '면접(1차)','면접(최종)','면접(화상)','1차 면접','최종 면접','기업 면접','회사면접','면접결석','시험(자격증)','시험(어학)','시험(국가기술자격)','시험(학교)','자격증 시험','토익 응시','기사 시험 응시',
 '예비군(동원훈련)','동원훈련','예비군 훈련','민방위','민방위 교육','예비군 민방위','취업박람회(현장 면접)','취업박람회 현장 면접','채용 박람회','잡페어','잡 페어','job fair','Job Fair',
 '인적성 시험','GSAT 응시','AI 인적성 검사','AI 인적성','온라인 인적성 검사','인적성 HMAT','인적성-GSAT','인적성 검사 LG Way Fit','L-TAB','LTAB','AI역량검사','AI 역량 검사','인적성(내가 쓴 종류)','인적성(DCAT)',
 '경조사(조모상)','외조모상','조모상','외조부상','조부상','부친상 경조사','모친상','결혼','출산','경조사','법원 출석','관공서','공가','투표','천재지변',
 '교통사정','교통','교통 지연','개인사정','개인일정','늦잠','이사','병원 면접','병원 또는 면접 확인 필요','병원 확인 필요','사유 미정','취소','면접 아님','취업 상담','국취제 상담','채용설명회','실업인정교육'];
test('데이터 해석기 = 옛 고정 규칙(기본 목록): 체크히어 분류·질병·기간 비고·추가 증빙이 옛 기록에서 그대로',()=>{
 resetReasonCatalog();
 for(const t of CORPUS){
  assert.equal(reasonCategory(t),OLD.category(t),`category ${JSON.stringify(t)}`);
  assert.equal(isDiseaseReason(t),OLD.disease(t),`disease ${JSON.stringify(t)}`);
  assert.equal(normalizePeriodReason(t),OLD.period(t),`period ${JSON.stringify(t)}`);
  assert.equal(isJobFair(t),OLD.jobFair(t),`job fair ${JSON.stringify(t)}`);
 }
 assert.ok(CORPUS.length>150);
});

test('관리자 목록(settings/reasonCatalog 모양): 바꾸면 드롭다운·해석기가 따르고, 모양이 틀리면 기본값 + 경고',()=>{
 try{
  assert.deepEqual(validateReasonCatalog(DEFAULT_REASON_CATALOG),{ok:true,errors:[],data:cloneCatalog(DEFAULT_REASON_CATALOG)});
  assert.equal(reasonCatalogSource().from,'default');
  const d=cloneCatalog(DEFAULT_REASON_CATALOG),cat=k=>d.cats.find(c=>c.key===k);
  cat('공가').recognized=false;                                   // 인정 끄기 → 체크히어 분류 없음, 화면 '(인정 안 됨)'
  cat('면접').hidden=true;                                         // 숨기기 → 드롭다운에서 빠지지만 옛 기록은 그대로 해석
  cat('병원').subs.push({text:'병원(한방)',label:'한방'});          // 항목 추가
  cat('병원').label='병원·질병(진료)';                              // 이름 바꾸기
  d.cats.unshift({key:'훈련기관',label:'훈련기관 행사',recognized:true,memo:'훈련기관',words:['훈련기관'],evidence:'기관 확인서',subs:[{text:'훈련기관(행사)',label:'행사'}]}); // 분류 추가·순서
  d.kinds['자격증'].items.find(i=>i.value==='SQLD').rules.mfg='X';  // 과정 기준 바꾸기
  d.kinds['자격증'].items.push({value:'정보처리기사',label:'정보처리기사',rules:{emb:'O',mfg:'△'}});
  cat('취업박람회').extra='';                                       // 추가 증빙 끄기
  cat('병원').disease=false;                                       // 질병 판정에서 빼기
  const r=setReasonCatalog(d,{rev:3,updatedBy:'admin@test.kr'});
  assert.deepEqual(r,{ok:true,warning:'',errors:[]});assert.deepEqual([reasonCatalogSource().from,reasonCatalogSource().rev],['saved',3]);
  assert.equal(REASON_CATS[0].key,'훈련기관');assert.equal(reasonCategory('훈련기관(행사)'),'훈련기관');
  assert.equal(reasonCategory('공가(법원 출석)'),'','공가 is no longer recognised');assert.match(catOptions(''),/>\(인정 안 됨\) 공가\(관공서·법원\)</);
  assert.equal(typeWarning('인정출석','공가'),'공가(관공서·법원)은 보통 인정 사유가 아닙니다');
  assert.ok(!reasonOptions('').includes('value="면접"'),'hidden 면접 is not offered');assert.equal(reasonCategory('면접'),'면접','old 면접 records still parse');
  assert.deepEqual(reasonPick('면접'),{main:OTHER,kind:'',apt:'',input:true,custom:''},'a hidden entry shows as free text');
  assert.ok(STANDARD.has('병원(한방)'));assert.match(catOptions(''),/>병원·질병\(진료\)</);
  assert.equal(certRule('SQLD','2'),'X');assert.match(subOptions('자격증','',{type:'인정출석',cls:'1'}),/<option value="정보처리기사" >정보처리기사<\/option>/);
  assert.equal(isJobFair('취업박람회'),false);assert.equal(extraEvidence({type:'인정출석',reason:'취업박람회'}),null);
  assert.equal(isDiseaseReason('병원(치과)'),false);
  // 화면 미리보기는 저장 전 목록으로(지금 목록은 그대로)
  const preview=reasonOptions('',{catalog:DEFAULT_REASON_CATALOG});assert.ok(preview.includes('value="면접"'));assert.ok(!reasonOptions('').includes('value="면접"'));
  // 깨진 문서: 기본값 + 경고
  const bad=cloneCatalog(DEFAULT_REASON_CATALOG);bad.cats[0].subs.push({text:'병원'});
  const w=setReasonCatalog(bad);assert.equal(w.ok,false);assert.match(w.warning,/사유 목록 설정이 올바르지 않아 기본 목록을 씁니다 · 세부 '병원'가 겹칩니다/);
  assert.equal(reasonCatalogSource().from,'default');assert.ok(reasonOptions('').includes('value="면접"'));assert.equal(reasonCategory('공가(투표)'),'공가');
  for(const broken of [null,[],{cats:[]},{...cloneCatalog(DEFAULT_REASON_CATALOG),courses:[]},{...cloneCatalog(DEFAULT_REASON_CATALOG),cats:[{key:'시(험)',label:'x',recognized:true,subs:[{text:'x'}]}]}])
   assert.equal(validateReasonCatalog(broken).ok,false,JSON.stringify(broken)?.slice(0,60));
  const kindBad=cloneCatalog(DEFAULT_REASON_CATALOG);kindBad.kinds['자격증'].items[0].rules.emb='?';assert.match(validateReasonCatalog(kindBad).errors[0],/기준\(O\/△\/X\)/);
 }finally{resetReasonCatalog();}
});
