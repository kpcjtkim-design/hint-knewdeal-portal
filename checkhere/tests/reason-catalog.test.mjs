import test from 'node:test';
import assert from 'node:assert/strict';
import {REASON_CATS,APTITUDE,OTHER,RECOGNIZED,EXTRA_DOC,EXTRA_LABEL,composeReason,splitReason,tidyReason,reasonKind,isJobFair,extraEvidence,extraEvidenceStarted,extraNotice,catOptions,subOptions,typeWarning,catOf} from '../../attendance-reason-catalog.mjs';
import {reasonCategory,suggestReason} from '../../checkhere-proposal-core.mjs';
import {normalizePeriodReason} from '../../attendance-period-core.mjs';
import {reasonFor} from '../../attendance-reason-parser.mjs';
import {isDiseaseReason,decodeBundle,studentStats,evidenceRows,extraEvidenceRows} from '../../beta2-core.mjs';
import {hasHospitalRecognition} from '../../disease-recognition-core.mjs';
import {sheetToCheckHere} from '../../beta2-checkhere-core.mjs';

// 드롭다운이 만드는 표준 글 전부(분류 → 세부, 인적성은 종류)
const ALL=REASON_CATS.flatMap(c=>c.aptitude?APTITUDE.map(([v])=>({c,text:composeReason(c.key,v)})):c.subs.map(s=>({c,text:composeReason(c.key,s.text)})));
// 표준 글 → 체크히어 메모 분류(reasonCategory). 인정 출결에 쓰는 분류는 하나로 정해져야 체크히어로 보냅니다.
const EXPECT={병원:'병원',면접:'면접',인적성:'인적성',취업박람회:'취업박람회',시험:'시험',공가:'공가'};

test('every composed reason is recognised by the existing parsers: CheckHere category, disease, period remarks',()=>{
 assert.ok(ALL.length>=50,'catalog covers the reasons used so far');
 for(const {c,text} of ALL){
  const cat=reasonCategory(text);
  if(c.key==='예비군')assert.equal(cat,text.startsWith('민방위')?'민방위':'예비군',text);
  else if(c.key==='경조사')assert.equal(cat,/상$/.test(text)?text:'경조사',text);
  else if(EXPECT[c.key])assert.equal(cat,EXPECT[c.key],text);
  else assert.equal(cat,'',`${text} is not a recognised (인정) reason`);
  assert.equal(isDiseaseReason(text),c.key==='병원',`disease ${text}`);
  assert.equal(reasonKind(text),c.key==='예비군'?'예비군':c.key,`kind ${text}`);
  if(c.types.some(t=>RECOGNIZED.includes(t)))assert.ok(EXPECT[c.key]||['예비군','경조사'].includes(c.key));
 }
 // 기간 출결 비고(가-3 → 단위기간): '분류(세부)'도 분류로 봅니다.
 for(const [text,want] of [['면접(최종)','면접'],['병원(치과)','병원'],['취업박람회(현장 면접)','취업박람회'],['예비군(동원훈련)','예비군'],['인적성(HMAT)','인적성'],['인적성(NCS)','인적성'],['인적성 HMAT','인적성'],['AI 인적성 검사','인적성'],['인적성(내가 쓴 종류)','인적성'],['시험(자격증)','시험(자격증)'],['개인사정(이사)','개인사정(이사)'],['','개인사정'],['병원','병원'],['채용 박람회','취업박람회']])
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
 for(const [text,cat] of [['병결','병원'],['개인일정','개인사정'],['교통사정','교통'],['면접','면접'],['예비군','예비군'],['병원(감기)','병원']])assert.equal(splitReason(text).cat,cat,text);
 assert.deepEqual(splitReason('병원(감기)'),{cat:'병원',sub:OTHER,custom:'감기'});assert.equal(composeReason('병원',OTHER,'감기'),'병원(감기)');
 assert.deepEqual(splitReason('병원 진료 후 복귀'),{cat:'',sub:'',custom:'병원 진료 후 복귀'});
 assert.deepEqual(splitReason(''),{cat:'',sub:'',custom:''});
 assert.equal(composeReason('',null,' 직접 쓴 사유 '),'직접 쓴 사유');assert.equal(composeReason(OTHER,'','가족 돌봄'),'가족 돌봄');
 assert.equal(composeReason('면접','없는 세부'),'면접','an unknown sub falls back to the category');
 assert.equal(tidyReason(' 인적성( ) '),'인적성');
 // 드롭다운 글: 모든 분류 + 기타, 인적성은 종류 + 기타, 출결과 맞지 않는 분류는 '(인정 아님)'
 const opts=catOptions('면접',{type:'인정출석'});
 for(const c of REASON_CATS)assert.ok(opts.includes(`>${c.label}`),c.label);
 assert.match(opts,/value="면접" selected/);assert.match(opts,/교통 \(인정 아님\)/);assert.match(opts,/기타 \(직접 입력\)/);
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
 assert.deepEqual(extraEvidenceRows(b,{cls:'2'}),[]);assert.equal(extraEvidenceRows(b,{from:'2026-11-05'}).length,1);
 assert.deepEqual(evidenceRows(studentStats(b)).map(r=>[r.name,r.date,r.reason,r.extra]),[['가','2026-11-05','취업박람회(현장 면접)',true],['나','2026-11-06','병원',false]]);
});
