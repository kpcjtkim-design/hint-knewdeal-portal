// 사유 칸 공용 도우미: 관리자 출결대조(beta2-ledger.mjs)와 담임 출결판(teacher-beta.js)이 같은 드롭다운·경고를 씁니다
// (사용자 2026-10-20 '담임화면에서도 사유 부분 드롭다운은 관리자 화면 급으로 동일하게 해주기. 기본적인 경고 사항도 바로 캐치 가능하게').
// 목록·판정은 attendance-reason-catalog.mjs(settings/reasonCatalog가 있으면 그 목록)를 그대로 쓰고, 여기서는 칸의 HTML·고른 값 → 저장 글·경고 글만 만듭니다.
// 칸 모양: 사유 드롭다운 하나(data-inline="rmain") + 옆 목록이 있는 분류(인적성·자격증 종류, 세부가 둘 이상인 병원·경조사·공가·예비군·교통·취업활동·개인사정)는
// 바로 옆 종류 드롭다운(rsub) + 옆 칸 기타면 직접 입력(rapt, data-kind, '분류(글)') + '기타'면 사유 직접 입력(reason).
import {reasonPick,reasonOptions,subOptions,composeReason,tidyReason,typeWarning,reasonChecks,splitReason,STANDARD,OTHER,isNA,isJobFair,extraEvidence,EXTRA_DOC} from './attendance-reason-catalog.mjs';
import {isTestClass} from './cohort.mjs';

export const OFFDAY_RECOGNIZED_NOTE='교육일이 아닌 날의 인정 출결은 통계·증빙에 들지 않습니다'; // 사용자 2026-10-20 '애초에 교육일 날만 인정출결이 되는거 아닌지?': 막지 않고 경고
export const REASON_REQUIRED_NOTE='인정 출결은 사유가 필요합니다'; // 시트 b2Validate_와 같은 말(담임 화면은 고르는 즉시 보임)
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const recognized=t=>String(t||'').startsWith('인정');

// 사유 칸 HTML. name: 학생 이름(aria-label 앞말), custom: '기타'를 고른 상태 지키기, locked: 출석 기본 행처럼 사유를 저장하지 않는 칸.
export function reasonPickHtml({reason='',type='',cls='',name='',custom=false,locked=false}={}){
 const s=reasonPick(reason,{custom}),n=name?`${esc(name)} `:'',need=recognized(type)?'사유 (필수)':'사유',off='출석은 사유를 저장하지 않습니다(유형을 바꾸면 저장)';
 return `<select class="b2-rmain" data-inline="rmain" aria-label="${n}사유" ${locked?`disabled title="${off}"`:`title="${esc(reason||need)}"`}>${reasonOptions(s.main,{type,blank:locked?'사유 없음':need})}</select>`
  +(s.kind?`<select class="b2-rsub" data-inline="rsub" aria-label="${n}${esc(s.kind)} 종류" title="${esc(s.kind)} 종류">${subOptions(s.kind,s.apt,{type,cls})}</select>`:'')
  +(s.kind&&s.input?`<input class="b2-reason" data-inline="rapt" data-kind="${esc(s.kind)}" maxlength="40" value="${esc(s.custom)}" aria-label="${n}${esc(s.kind)} 종류 직접 입력" placeholder="종류 직접 입력">`:'')
  +(s.main===OTHER?`<input class="b2-reason" data-inline="reason" maxlength="300" value="${esc(reason)}" aria-label="${n}사유 직접 입력" placeholder="${need} 직접 입력" title="${esc(reason)}">`:'');
}

// 드롭다운에서 고르기: which 'rmain'|'rsub', cur 지금 글 → {text 새 글, custom '기타' 상태(true/false, 종류 칸이면 그대로 null), focus 다음에 갈 칸(data-inline)}
// 분류를 고르면 표준 글(종류 분류는 분류 키 → 옆 종류 칸으로), '기타'는 직접 입력 칸으로(표준 글이던 칸은 비움, 직접 쓴 글은 그대로),
// 종류를 고르면 '분류(종류)', 종류 기타는 '분류()'(저장 때 빈 괄호는 지움) → 종류 직접 입력 칸으로.
export function pickReasonText(cur,which,value){
 cur=String(cur||'');
 if(which==='rmain'){
  if(value===OTHER)return {text:STANDARD.has(tidyReason(cur))||isNA(cur)||reasonPick(cur).kind?'':cur,custom:true,focus:'reason'};
  return {text:value,custom:false,focus:reasonPick(value).kind?'rsub':'rmain'};
 }
 const k=reasonPick(cur).kind||'인적성';
 return {text:value===OTHER?`${k}()`:composeReason(k,value),custom:null,focus:value===OTHER?'rapt':'rsub'};
}
// 종류 직접 입력 칸(rapt) → 저장 글
export const kindInputText=(kind,value)=>`${kind||'인적성'}(${value})`;

// 사유 경고(저장 전에 고르는 대로 보임, 저장은 막지 않음). 출결대조 행 안내와 같은 글·모양입니다.
// offDay: 그날이 교육일이 아님(17반 테스트반은 경고 없음), rec: 저장된 기록 {type, reason, ev, evApplied}(취업박람회 추가 증빙이 이미 붙었으면 안내 생략),
// required: 인정 출결인데 사유가 비었으면 '인정 출결은 사유가 필요합니다'(담임 화면, 출결대조는 저장 때 '입력 필요: 사유').
// '해당없음'은 두 화면 모두 인정 출결이면 같은 경고(막지 않음, 사용자 2026-10-20 '해당없음' 부활).
export function reasonNotesHtml({type='',reason='',cls='',offDay=false,rec=null,required=false}={}){
 const cat=splitReason(reason).cat||(String(reason||'').trim()?OTHER:''),w=typeWarning(type,cat),off=recognized(type)&&offDay&&!isTestClass(cls);
 const need=recognized(type)&&(isNA(reason)||required&&!tidyReason(reason));
 return `${need?`<span class="b2-err" style="display:block" data-reason-check="required">${REASON_REQUIRED_NOTE}</span>`:''}${off?`<span class="b2-xnote" data-offday-note>${OFFDAY_RECOGNIZED_NOTE}</span>`:''}${isJobFair(reason)&&!extraEvidence(rec)?`<span class="b2-xnote" title="취업박람회는 박람회 참가만으로는 인정되지 않습니다">추가 증빙 필요 · ${EXTRA_DOC}${recognized(type)?'':' (인정 출결일 때)'}</span>`:''}${w?`<span class="b2-sub">${esc(w)}</span>`:''}${reasonChecks(type,reason,{cls}).map(c=>`<span class="${c.level==='error'?'b2-err':'b2-xnote'}" style="display:block" data-reason-check="${c.level}">${esc(c.text)}</span>`).join('')}`;
}
