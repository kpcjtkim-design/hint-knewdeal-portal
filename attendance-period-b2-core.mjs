// 2기 단위기간 출석부(사용자 2026-10-20 "단위기간 출석부 양식은 같음. 1기 양식이랑"): 1기와 같은 HRD 출석부 양식(attendance-period-templates.json,
// 1기 '1-17반_2단위출석부_0827-0918.zip'에서 뽑은 서식·색·수식)을 쓰고, 자료만 1기 운영총괄 대신 2기 마스터시트 출결원장(b2Bundle)에서 읽습니다.
// 화면 없이 시험할 수 있는 순수 함수만 둡니다. 결과 모양은 1기 preparePeriod와 같아서 같은 buildPeriodWorkbook이 그대로 씁니다.
//  - 교육일: 그 반 교육일자(beta2-core classDays, 마스터시트 교육일자) 가운데 고른 기간 안. 17반 테스트반은 기록 있는 날도 교육일(시험용).
//  - 칸: 출결원장 유형 그대로(출석·지각·조퇴·외출·결석·인정출석·인정지각·인정조퇴·인정외출). 기록이 없으면 출석, 재학이 아닌 날(명부 상태 변경일 뒤)은 해당없음,
//    오늘 뒤의 날은 비워 둡니다(1기 운영총괄의 빈 앞날 칸과 같음).
//  - 비고: 1기와 같은 'M/D(출결-사유)'. 사유는 출결원장 사유를 1기 기간 비고 규칙(normalizePeriodReason, 사유 목록의 '기간 비고 글')으로 줄이고, 비면 개인사정.
//  - 원장 유형 '해당없음'(시트 v14부터 관리자·담임이 고를 수 있음)은 1기 양식의 해당없음 글자색(회색 #999999)으로 그대로 넣고, 훈련일수에서 빠집니다(COUNTA-COUNTIF 식).
//    해당없음이 이어져도 중도포기로 보지 않습니다: 중도포기 등은 명부 상태(중도탈락·조기취업)와 상태 변경일로만 정합니다(1기 preparePeriod의 '뒤 칸이 모두 해당없음' 판정은 2기에서 쓰지 않음).
//  - 원장 유형 '중복'(지각·조퇴·외출 가운데 둘 이상, 2026-10-20)은 1기 양식처럼 '중복'(검은 글자)으로 넣습니다. 1기 수식 그대로 출석일수와 지각·조퇴·외출 칸에 하루씩 들고
//    결석이 아닙니다(1기 운영총괄 '중복(지각+조퇴+외출)'과 같은 셈). 비고는 'M/D(중복-사유)'.
//  - 훈련생 상태: 명부 상태가 재학이 아니고 마지막 출석일(상태 변경일)이 기간 끝 전이면 그 상태(중도탈락은 1기 표기 '중도포기'), 아니면 훈련중.
import {classDays,ledgerIndex,ledgerKey,rosterFor,enrolledOn,recognizedType} from './beta2-core.mjs';
import {normalizePeriodReason} from './attendance-period-core.mjs';
import {classInfo,isIsoDate,UNIT_PERIODS,COHORT,mdLabel} from './cohort.mjs';

export const B2_PERIOD_STATUSES=['출석','지각','조퇴','외출','중복','결석','인정출석','인정지각','인정조퇴','인정외출','해당없음'];
export const B2_REVIEW_HEADERS=['반','학생명','날짜','출결원장 출결','출석부 출결','사유','확인 사유','증빙','처리 상태'];
export const B2_SOURCE_HEADERS=['날짜','학생명','출결','입실','퇴실','외출 시작','외출 끝','사유','증빙','반려 사유','시트 입력 확인'];
// 1기 양식에서 훈련생 상태 칸에 쓰던 말(중도탈락 → 중도포기). 그 밖의 명부 상태(조기취업·수료)는 그대로 씁니다.
const TRAINING_STATUS={중도탈락:'중도포기'};
// 단위기간 번호: 고른 날짜가 한 단위기간 안이면 그 번호, 아니면 '사용자지정'(1기와 같음).
export function periodIdFor(from,to,period=''){
 if(period&&period!=='custom')return String(period);
 return String(UNIT_PERIODS.find(p=>from>=p.from&&to<=p.to)?.no||'사용자지정');
}

export function prepareB2Period({bundle,classId,from,to,index=ledgerIndex(bundle)}){
 const cls=String(classId??'').trim();
 if(!classInfo(cls))throw Error('반 번호를 확인해 주세요.');
 if(![from,to].every(isIsoDate)||from>to)throw Error('기간을 확인해 주세요.');
 const today=String(bundle.today||'');
 const dates=classDays(bundle,cls).filter(d=>d>=from&&d<=to);
 if(!dates.length)throw Error('선택 기간에 이 반 교육일이 없습니다(마스터시트 교육일자).');
 if(new Set(dates).size!==dates.length)throw Error('교육일이 중복되어 생성할 수 없습니다.');
 const roster=rosterFor(bundle,cls);
 if(!roster.length)throw Error('마스터시트 명부에 이 반 학생이 없습니다.');
 const reviews=[],stats={students:roster.length,days:dates.length,cells:0,recognizedLate:0,recognizedEarly:0,recognizedOuting:0,recognizedFull:0,personal:0,dropout:0,future:0,evidenceMissing:0,evidenceRejected:0};
 const add=(name,date,ledgerType,status,reason,message,evidence='')=>reviews.push([cls,name,date,ledgerType,status,reason,message,evidence,'미확인']);
 const names=new Map();for(const p of roster)names.set(p.name,(names.get(p.name)||0)+1);
 const dateSet=new Set(dates),inRange=bundle.ledger.filter(r=>String(r.cls)===cls&&r.date>=from&&r.date<=to);
 // 출석부에 들어가지 않는 원장 기록: 교육일이 아닌 날, 명부에 없는 이름
 for(const r of inRange){
  if(!dateSet.has(r.date))add(r.name,r.date,r.type,'',r.reason||'','교육일이 아닌 날의 출결원장 기록 - 출석부에 넣지 않음');
  else if(!names.has(r.name))add(r.name,r.date,r.type,'',r.reason||'','명부에 없는 이름의 출결원장 기록 - 출석부에 넣지 않음');
 }
 const students=roster.map((p,i)=>{
  if(names.get(p.name)>1&&roster.findIndex(x=>x.name===p.name)===i)add(p.name,'','','','','동명이인 - 출결원장이 반·이름으로만 구분되어 같은 기록을 씁니다. 확인 필요');
  if(p.status&&p.status!=='재학'&&!p.changed)add(p.name,'','','','',`명부 상태 ${p.status} - 마지막 출석일(상태 변경일)이 없어 모든 날을 해당없음으로 둠`);
  const cells=dates.map(d=>{
   let rec=index.get(ledgerKey(cls,p.name,d))||null;const enrolled=enrolledOn(p,d),future=!!today&&d>today;
   // 출결 칸이 빈 원장 줄(증빙·메모만 있는 줄 등)은 기록 없음과 같게 보고 확인필요에 남깁니다.
   if(rec&&!String(rec.type||'').trim()){add(p.name,d,'','',rec.reason||'','출결원장 출결 칸이 비어 있음 - 기록 없음과 같게 처리');rec=null;}
   const status=rec?String(rec.type).trim():enrolled?(future?'':'출석'):'해당없음';
   if(rec&&!B2_PERIOD_STATUSES.includes(status))throw Error(`${p.name} ${d}: 출결원장 출결 '${status}'을(를) 출석부 칸으로 옮길 수 없습니다.`);
   if(rec&&!enrolled)add(p.name,d,status,status,rec.reason||'',`명부 상태 ${p.status}(마지막 출석일 ${p.changed||'-'}) 뒤의 기록 - 원장 값으로 넣음`);
   if(status==='')stats.future++;
   const abnormal=!!status&&status!=='출석'&&status!=='해당없음',raw=String(rec?.reason||'').trim();
   if(abnormal&&!raw)stats.personal++;
   if(status==='인정지각')stats.recognizedLate++;if(status==='인정조퇴')stats.recognizedEarly++;if(status==='인정외출')stats.recognizedOuting++;if(status==='인정출석')stats.recognizedFull++;
   stats.cells++;
   if(rec&&recognizedType(status)){
    const ev=rec.evApplied||rec.ev||'미제출';
    if(ev==='미제출'){stats.evidenceMissing++;add(p.name,d,rec.type,status,raw,'증빙서류 미제출',ev);}
    else if(ev==='반려'){stats.evidenceRejected++;add(p.name,d,rec.type,status,raw,'증빙서류 반려'+(rec.evr?` - ${rec.evr}`:''),ev);}
   }
   if(rec&&String(rec.check||'').trim())add(p.name,d,rec.type,status,raw,'시트 입력 확인: '+String(rec.check).trim(),rec.evApplied||rec.ev||'');
   return {date:d,raw:rec?.type||'',status,reason:abnormal?normalizePeriodReason(raw):'',abnormal,events:[]};
  });
  let trainingStatus='훈련중';
  if(p.status&&p.status!=='재학'&&(!p.changed||p.changed<to)){trainingStatus=TRAINING_STATUS[p.status]||p.status;stats.dropout++;}
  return {id:`${cls}_${i}_${p.name}`,name:p.name,trainingStatus,cells,remarks:cells.filter(c=>c.abnormal).map(c=>`${mdLabel(c.date)}(${c.status}-${c.reason})`).join('\n')};
 });
 if(stats.cells!==stats.students*stats.days)throw Error('학생·교육일 건수 검증에 실패했습니다.');
 const source=inRange.filter(r=>dateSet.has(r.date)).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'ko'))
  .map(r=>[r.date,r.name,r.type,r.inT||'',r.outT||'',r.oa||'',r.ob||'',r.reason||'',r.evApplied||r.ev||'',r.evr||'',r.check||'']);
 return {classId:cls,from,to,dates,students,reviews,stats,reasons:[],
  reviewHeaders:B2_REVIEW_HEADERS,note:`2기 마스터시트 출결원장 기준 · 확인필요 ${reviews.length}건 · 확인필요 시트 검토 후 마감`,
  source:{name:'출결원장 기록',headers:B2_SOURCE_HEADERS,rows:source,widths:[12,12,10,8,8,9,9,30,9,24,30]}};
}

// 반 머리글(1기 양식 1반 파일의 머리 칸 자리 그대로): 제목 A1, 소재지 C4, 훈련과정명 C6, 정원 C9. 시트 이름은 '반. 이름_N 단위기간'(31자 안).
// 1기 ZIP은 1기 반(17개) 파일이라, 2기는 1반 파일 양식 하나에 2기 반 정보를 채워 반마다 만듭니다(서식·열 너비·색·수식은 17개 파일이 모두 같음).
// 훈련기관명·훈련기관유형·주훈련대상은 1기 파일 값(17개 반 모두 같음)을 그대로 둡니다. 소재지·과정명은 마스터시트 반정보(b2Bundle classes의 address·hrdName)를 씁니다.
export const B2_TEMPLATE_BASE='1';
const SHEET_BAD=/[:\\/?*[\]]/g;
export function b2PeriodProfile(templates,classId,sheetClass={}){
 const base=templates?.profiles?.[B2_TEMPLATE_BASE];if(!base)throw Error('출석부 원본 양식(1반)을 찾지 못했습니다.');
 const c=classInfo(classId);if(!c)throw Error('반 번호를 확인해 주세요.');
 const title=c.test?c.name:`${c.area}_${c.course}_${c.venue}`;
 const sheetBase=[`${c.id}. ${title}`,`${c.id}. ${c.course}_${c.venue}`,`${c.id}. ${c.venue}`].map(s=>s.replace(SHEET_BAD,' ')).find(s=>(s+'_9 단위기간').length<=31)||`${c.id}반`;
 const address=String(sheetClass.address||'').trim(),course=String(sheetClass.hrdName||'').trim()||(c.official||title);
 const set={'1,1':`출석부 (${title})`,'4,3':address,'6,3':course,'9,3':`${c.capacity||0}명`};
 const cells=base.cells.map(x=>{const k=`${x[0]},${x[1]}`;return k in set?[x[0],x[1],set[k],x[3]]:[...x];});
 return {...JSON.parse(JSON.stringify(base)),name:`${sheetBase}_1 단위기간`,cells,missing:address?[]:['소재지']};
}

// 내려받기 전 확인(download-preflight-ui confirmDownloadPreflight가 받는 모양). 출결 공란은 2기에 없고(기록 없으면 출석), 앞날은 future로 셉니다.
export function b2PeriodCheck(result){
 const evidence=new Set(['증빙서류 미제출']);
 const issues=result.reviews.map(r=>({classId:r[0],name:String(r[1]||''),date:String(r[2]||''),kind:evidence.has(r[6])||String(r[6]).startsWith('증빙서류 반려')?'서류 확인':'출결·사유 확인',message:String(r[6]||'확인 필요')}));
 const s=result.stats;
 return {classId:result.classId,counts:{classes:1,students:s.students,cells:s.cells,missing:0,review:issues.filter(i=>i.kind!=='서류 확인').length,evidenceMissing:s.evidenceMissing,evidenceRejected:s.evidenceRejected,evidenceUnknown:0,future:s.future},issues};
}

// 파일 이름(1기와 같은 모양에 2기 머리 '2기_'): 2기_01반_1단위출석부_1028-1127.xlsx, 묶음은 2기_1-16반_1단위출석부_1028-1127.zip
const mmdd=iso=>iso.slice(5).replace('-','');
export function b2PeriodFileName(classId,periodId,from,to){return `${COHORT.filePrefix}${String(classId).padStart(2,'0')}반_${periodId}단위출석부_${mmdd(from)}-${mmdd(to)}.xlsx`;}
export function b2PeriodZipName(ids,periodId,from,to,realIds){
 const all=realIds.length&&ids.length===realIds.length&&realIds.every(id=>ids.includes(id));
 return `${COHORT.filePrefix}${all?`${realIds[0]}-${realIds.at(-1)}`:ids.join(',')}반_${periodId}단위출석부_${mmdd(from)}-${mmdd(to)}.zip`;
}
