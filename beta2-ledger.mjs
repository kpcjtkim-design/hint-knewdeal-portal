// 2기 출결대조: 마스터시트 출결원장 + 체크히어 실시간 기록. 행 안에서 유형·시간·사유를 고쳐 두고(초안) 「변경 N건 저장」·Ctrl+S로 모아서
// 한 행씩 차례로 Apps Script를 거쳐 시트에 저장하고, 오늘 기록은 저장 3초 뒤 체크히어 반영 요청을 만듭니다(beta2-checkhere-sync.mjs, 설계 docs/beta2-instant-edit-plan.md 5장).
// 모아서 저장·학생 아래 얇은 직접 요청 줄(checkhere-proposals.mjs compact)은 사용자 결정 2026-10-16입니다.
// 요청은 승인 대기로 남고, 체크히어 쓰기는 사람이 운영 포털 「반영 요청·승인」에서 승인할 때만입니다(사용자 결정 2026-10-16, 중계는 읽기 전용).
// Firestore 함수는 아래 SDK 주소에서 바로 불러옵니다(2기 전용 Firebase 프로젝트라 1기 자료 저장 가드가 없습니다). 2기에는 운영총괄 동기화가 없어 '운영총괄 가져오기·되돌리기·동기화 확인'도 없습니다.
// 아무 날짜 기록(사용자 결정 2026-10-20 '둘다 넓혀', '수정 자체는 언제든 유연하게'): 교육일이 아닌 날(주말·휴일·개강 전·종강 뒤)도, 아직 오지 않은 날도 고르고 기록·메모할 수 있습니다.
// 날짜 목록은 오늘까지의 교육일 그대로이고 「다른 날짜…」를 고르면 옆에 날짜 칸이 열립니다. 교육일이 아닌 날은 평소 기준(09:00~18:00)으로 대조하고, 교육일이 아니거나 미래인 날은 작은 안내만 보입니다(막지 않음).
// 통계(출석률 등, beta2-core studentStats)는 지금처럼 교육일만 셉니다.
// 출결대조 메모(사용자 요청 2026-10-19): 이름 아래 「+ 메모」→ 증빙 빠른 칩·직접 입력(100자)을 누르면 바로 b2LedgerMemo로 저장하고 관리자 알림(notify.mjs)을 남깁니다. 출결 초안과 따로라 「변경 N건 저장」에 세지 않습니다.
// 직접 입력 칸이 열려 있으면 칩 글을 칸에 덧붙입니다.
// 공통메모(사용자 요청 2026-10-20 '상단 바에 체크히어 불일치 옆에 전체 공통으로 쓸 수 있는 메모 … 담임에게도 알림이 가게'): 이 반·이 날짜의 모든 학생과 그날 업무에 대한
// 공통 코멘트 하나(시트 v17 b2DayMemo·b2DayMemos). 거르기 칩 줄의 「체크히어 불일치」 바로 뒤 「공통메모」를 누르면 도구줄 아래 편집 칸이 열립니다.
// 학생 메모에 있던 '수기출석 공통메모 사항' 칩은 여기로 옮겼고 오류·사유 칩이 더해졌습니다(DAY_MEMO_PICKS, 누르면 글 끝에 ' · '로 덧붙임, 저장은 「저장」).
// 저장(빈 글이 아니고 실제로 바뀐 때)하면 그 반 담임과 운영 관리자에게 알림('출결대조 메모' 종류, 담임은 출결판 그날로). 지우기는 알림 없음.
// 증빙(사용자 요청 2026-10-20 '맨 오른쪽 증빙이 그냥 사유 옆으로 드롭다운 형태로'): 오른쪽 「증빙」 단추·편집기 대신 사유 드롭다운 바로 옆 작은 드롭다운(data-inline="ev"),
// 반려면 그 옆에 반려 사유 칸(data-inline="evr"). 유형·사유와 같은 초안이라 「변경 N건 저장」·Esc·모두 되돌리기·떠날 때 확인을 그대로 탑니다.
import {doc,setDoc,onSnapshot,query,collection,where,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {dayView,dayCounts,compareCheckHere,memoReason,timesFromRecord,neededTimes,requiredTimes,teacherOf,recognizedType,B2_TYPES,DUP_TYPE,dupWarning,dupCheck,dupTimesFromRecord,sheetWait} from './beta2-core.mjs';
import {esc,md,badge,evBadge,extraBadge,toast,classOptions,loading,errorBox,lifecycle} from './beta2-ui.mjs';
import {loadCheckHereDay,watchCheckHereDay} from './checkhere-snapshots.mjs';
import {matchSnapshot} from './attendance-beta-core.mjs';
import {loadCheckHereIdentities} from './checkhere-name-store.mjs';
import {createProposalReview} from './checkhere-proposals.mjs';
import {withdrawRequest} from './checkhere-request-actions.mjs';
import {PRIVACY_NEEDS_RELAY,UNMASK_ON_APPLY,deleteLeaves,holdKey,needsUnmaskOnApply} from './beta2-checkhere-core.mjs';
import {createCheckHereSync,STATUS_ACTIONS,timeDeletePlan} from './beta2-checkhere-sync.mjs';
import {RULES,seconds} from './checkhere/rules.mjs';
// 사유 드롭다운(사용자 요청 2026-10-20): 분류 → 세부(인적성·자격증은 종류)로 표준 글, 직접 입력도 됨. 취업박람회 인정 출결은 추가 증빙(기업면접 확인서) 배지·거르기·알림.
import {tidyReason,isJobFair,extraEvidence,extraEvidenceStarted,extraNotice,EXTRA_DOC} from './attendance-reason-catalog.mjs';
import {reasonPickHtml,reasonNotesHtml,pickReasonText,kindInputText,OFFDAY_RECOGNIZED_NOTE,diseaseUsed,diseaseFullText,isDiseaseReason} from './reason-pick.mjs'; // 사유 칸·경고는 담임 출결판과 같은 공용 도우미(2026-10-20)
import {notify} from './notify.mjs';
import {linkFor} from './notify-core.mjs';
import {isIsoDate,BASE_RULE,DISEASE} from './cohort.mjs';

const FILTERS=[['all','전체'],['exceptions','출석 외'],['diff','체크히어 불일치'],['extra','추가 증빙']]; // 추가 증빙: 취업박람회 인정 출결 중 증빙 「확인」 전
const extraOpen=r=>{const x=extraEvidence(r?.rec);return !!x&&!x.done;};
const EVIDENCE=[['','자동 (인정이면 미제출)'],['미제출','미제출'],['확인','확인'],['반려','반려'],['해당없음','해당없음']];
const TIMES=['inT','outT','oa','ob'],ALL={inT:'x',outT:'x',oa:'x',ob:'x'};
const COLUMNS=['times','entryMemo','exitMemo'],PARTS=['msg','mark','status','prop','memo','memoedit']; // 직접 요청 줄의 세 칸, 따로 채우는 행 부분
// 출결대조 메모(학생마다) 빠른 칩: 증빙
const MEMO_PICKS=['증빙 미제출','증빙 보완 필요','증빙 확인 완료'],MEMO_MAX=100;
// 공통메모(반·날짜) 빠른 문구: 묶음마다 [이름, 문구들]. 이 목록만 고치면 됩니다(사용자 추가 지시 2026-10-20 '수기출석 공통메모 사항에서는 사유 오류 넣을 수 있게(시스템오류 누락) 등').
export const DAY_MEMO_PICKS=[
 ['수기출석',['수기출석 사인 미비','수기출석 미제출','수기출석 확인 완료','수기출석 시간 미기재','수기출석 서명 상이']],
 ['오류·사유',['체크히어 시스템 오류','체크히어 기록 누락','입·퇴실 기록 누락','사유 오류(재확인 필요)','단말·네트워크 오류','기타 오류']]
];
const DAY_MEMO_MAX=500;
// 공통메모 글 다듬기: 줄 안의 겹친 공백은 하나로, 빈 줄은 둘까지, 앞뒤 공백 없이, 500자까지
const tidyDayMemo=v=>String(v??'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').replace(/ ?\n ?/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,DAY_MEMO_MAX);
// 칩 글 덧붙이기: 비었으면 그 글, 이미 있으면 그대로, 아니면 ' · '로 끝에(최대 글자를 넘으면 null)
const appendPick=(cur,add,max)=>{const c=String(cur||'').trim(),next=!c?add:c.split(/\s*·\s*|\n/).map(x=>x.trim()).includes(add)?c:`${c} · ${add}`;return next.length>max?null:next;};
const ANY_DAY='__any'; // 「다른 날짜…」 칸 값
export {OFFDAY_RECOGNIZED_NOTE}; // 사용자 2026-10-20 '애초에 교육일 날만 인정출결이 되는거 아닌지?': 막지 않고 행에 경고(글은 reason-pick.mjs)
// 날짜 모양 확인: 실제 있는 날(YYYY-MM-DD)이고 연도가 1900~2999(키보드로 연도를 치는 중간 값 0002-…·0202-…는 넘김). 기간 제한이 아닙니다.
const typedDay=d=>isIsoDate(d)&&d>='1900-01-01'&&d<='2999-12-31';
const koreaNow=()=>{const s=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'});return {date:s.slice(0,10),seconds:+s.slice(11,13)*3600+ +s.slice(14,16)*60};};
const hm=v=>/^\d{2}:\d{2}/.test(String(v||''))?String(v).slice(0,5):'';
// 저장된 값 한 줄 요약('그사이 바뀜'에 시트 최신 값을 보일 때)
const brief=v=>{const t=neededTimes(v.type,v),ev=evOf(v);return [v.type||'유형 없음',t.inT&&`입실 ${t.inT}`,t.outT&&`퇴실 ${t.outT}`,t.oa&&`외출 ${t.oa}~${t.ob}`,String(v.reason||'').trim(),ev&&`증빙 ${ev}${evrOf(v)?`(${evrOf(v)})`:''}`].filter(Boolean).join(' · ');};
// 저장될 증빙 값: 출석이면 비움, 반려 사유는 반려일 때만(저장 payload와 같은 기준)
const NO_EV=new Set(['출석','해당없음','중복']); // 증빙 없는 유형: 해당없음(현황 없음)·중복(인정 출결이 아님, 2026-10-20)도 증빙 칸을 숨기고 ''로 저장
// 증빙(미제출·확인·반려)은 인정 유형(인정출석·인정지각·인정조퇴·인정외출)에만 씁니다(사용자 2026-10-21 "인정XX 제외하고는 서류 관련 드롭다운은 필요 없음"). 그 밖의 유형은 증빙을 비워 저장합니다.
const evOf=v=>recognizedType(v.type)?String(v.ev||''):'',evrOf=v=>evOf(v)==='반려'?String(v.evr||'').trim():'';
const evOn=v=>recognizedType(v.type); // 증빙 드롭다운을 보이는 유형
// 시트가 아직 '해당없음'·'중복'을 받지 않으면(Apps Script 배포 전) b2Save가 '유형을 골라 주세요.'로 거절합니다 → 기다림 안내(beta2-core sheetWait)
// 유형 드롭다운 색: 해당없음 회색, 중복 진한 주황(시트와 같은 #F9CB9C·#783F04, beta2.css t-dup)
const TYPE_STYLE={해당없음:' style="background:#e8eaed;color:#5f6368" title="해당없음(현황 없음) · 출석률·결석에 넣지 않습니다"',중복:' style="background:#f9cb9c;color:#783f04" title="중복(지각+조퇴+외출) · 입실(지각)·퇴실(조퇴)·외출 가운데 둘 이상 · 결석이 아니라 출석으로 셉니다"'};

export async function mount(host,{db,user,classes,client,selected,context}){
 const life=lifecycle(host);
 let cls=String(context?.classId||selected||'1'),date=String(context?.date||''),bundle=null,rows=[],records=[],recordsNote='',identities=[],live='',filter=context?.filter||'all',search='';
 let proposalsLoaded='',reqDay='',unwatchReq=null,unwatch=null,seq=0,chSeq=0,switching=false,painting=false,flushing=null,pend=null,recordsDay='',saveGen=0,bulk=null,bulkRun=null,bulkNote='';
 // drafts: 행 안 초안(이름 → {type,inT,outT,oa,ob,reason,ev,evr,base}). 칸을 벗어나거나 Enter로는 저장하지 않고 「변경 N건 저장」·Ctrl+S로만 저장합니다.
 // base = 처음 고칠 때의 출결원장 행 지문(저장할 때 before로 보내 그사이 바뀐 행은 서버가 거절하고, 화면에는 미리 '그사이 바뀜').
 // notes: 행 안내·오류, invalid: 입력 확인 안내가 붙은 학생(고치면 다시 확인), jobs: 학생마다 저장 하나(next=대기 중인 다음 저장, done=끝나면 풀림)
 // bulk: 모아 저장 중 {done,total}(그동안 행 입력칸 잠금), bulkRun: 그 약속, bulkNote: 끝난 뒤 도구줄 요약('6건 저장 · 1건 확인 필요')
 // pinned: 필터·검색을 바꾼 뒤 손댄 학생(필터에서 빠져도 3초·되돌리기·요청 상태가 보이게 남김, 필터·검색을 다시 바꾸면 풀림)
 const customOpen=new Set(),drafts=new Map(),notes=new Map(),invalid=new Set(),jobs=new Map(),bodies=new Map(),drawn=new Map(),stale=new Set(),shown=new Map(),pinned=new Set();
 // waiting: 쓰기 대기열에 들어가 시트 반영을 기다리는 학생(2026-10-21, client.save의 onQueued). 행 안내가 '저장 중' 대신 '반영 대기'.
 const waiting=new Set();
 // memos: '반|이름|날짜' → {memo,by}(b2LedgerMemos, 반·기간마다 한 번 읽고 저장 뒤 다시), memoUi: 열린 메모 줄 하나(open 이름, 직접 입력 칸·글, 저장 중 이름, 오류)
 const memos=new Map(),memoUi={open:'',custom:false,text:'',busy:'',err:''};let memoRange='',memoSeq=0;
 // 공통메모(반·날짜): dayMemos = 지금 반의 날짜 → 시트 줄 {memo,by,at,editedBy,editedAt}, dayMemoState = ''(읽음)·'loading'·'wait'(시트 v17 배포 전)·'err'
 // dayUi: 편집 칸(open, text 고치는 글, base 열 때의 시트 값 = 저장 때 was, busy, err, conflict 그사이 바뀐 최신 줄, day 연 반·날짜)
 const dayMemos=new Map(),dayUi={open:false,text:'',base:'',busy:false,err:'',conflict:null,day:''};let dayMemoState='loading',dayMemoErr='',dayMemoCls='',dayMemoSeq=0;
 host.innerHTML=`<div class="b2"><div class="b2-head"><div><h2>출결대조</h2><p>마스터시트 출결원장과 체크히어 기록을 나란히 봅니다. 행에서 유형·시간·사유·증빙을 고쳐 두고 「변경 N건 저장」(Ctrl+S)으로 모아서 저장합니다(Enter는 다음 학생 같은 칸, Esc는 그 행 되돌림).</p></div><div id="b2Sync"></div></div>
 <section class="b2-card"><div class="b2-toolbar">
  <label class="b2-field">반<select id="b2Class">${classOptions(classes,cls)}</select></label>
  <label class="b2-field">날짜<span style="display:flex;gap:6px"><select id="b2Date"></select><input type="date" id="b2DateAny" hidden aria-label="다른 날짜"></span></label><span class="b2-tiny b2-muted" id="b2DayNote"></span>
  <label class="b2-field">이름 찾기<input id="b2Search" placeholder="이름" autocomplete="off"></label>
  <div class="b2-chips" id="b2Filters"></div><span class="b2-grow"></span><span id="b2Live"></span><span id="b2Relay"></span>
  <button class="b2-btn" id="b2Reload">새로고침</button>
  <span class="b2-small b2-muted" id="b2BulkNote" role="status"></span><button class="b2-btn ghost" id="b2RevertAll" disabled>모두 되돌리기</button><button class="b2-btn primary" id="b2SaveAll" disabled title="고친 행을 한 행씩 차례로 마스터시트에 저장합니다 (Ctrl+S)">변경 0건 저장</button>
 </div><div class="b2-daymemo" id="b2DayMemo" hidden></div><div class="b2-stats" id="b2Stats"></div><div id="b2Msg" style="padding:0 14px"></div>
 <div class="b2-tiny b2-muted" style="padding:0 14px 10px">자동 요청: 오늘 출결원장을 저장하면 3초 뒤 [실시간 베타] [2기 베타] 요청이 만들어집니다(지난 날은 「체크히어 맞추기」를 눌러야 보냅니다). 체크히어에는 관리자가 운영 포털 「반영 요청·승인」에서 승인할 때만 수집 PC가 입력하고 다시 읽어 확인합니다. 직접 요청: 학생마다 아래 줄(추천시간·추천사유)에서 따로 요청하며, 근거 앞에 [2기 베타]가 붙고 관리자가 승인한 뒤 반영됩니다(추천값을 고치기만 해서는 체크히어가 바뀌지 않습니다).</div>
 <div class="b2-table-wrap"><table class="b2-table b2-ledger" id="b2Table"><thead><tr><th style="width:130px">이름</th><th>출결원장 (마스터시트)</th><th>체크히어</th><th style="width:200px">대조</th></tr></thead><tbody data-empty><tr><td colspan="4">${loading('출결원장을 불러오는 중…')}</td></tr></tbody></table></div></section></div>`;
 const $=s=>host.querySelector(s),table=$('#b2Table');
 // 드라이브 폴더 바로가기(drive-links.mjs, 사용자 요청 2026-10-21): 도구줄 바로 아래 한 줄(그 반·그날 수기출석·출결인정자료·교육사진, 그날이 든 단위기간 1·2·3)과
 // 학생 증빙 드롭다운 옆 작은 '출결인정자료 폴더'. 따로 불러와 못 불러와도 화면은 그대로입니다. 반·날짜는 dateOptions()가 맞춥니다.
 let drive=null;const driveSlot=document.createElement('div');driveSlot.className='b2-drive-slot';driveSlot.style.cssText='padding:0 14px 8px';$('.b2-toolbar').after(driveSlot);
 import('./drive-links.mjs?v=20261021-rd1').then(m=>{if(!life.alive())return;drive=m.createDriveBar({client,admin:true,onChange:()=>{if(life.alive()&&bundle)renderRows();}});driveSlot.append(drive.el);life.on(()=>drive.dispose());if(bundle)drive.set(cls,date);}).catch(()=>{});
 const students=()=>rows.map(r=>({rowIndex:r.rowIndex,name:r.name}));
 const rowOf=name=>rows.find(r=>r.name===name)||null;
 const recordOf=name=>recordsDay===`${cls}|${date}`?matchSnapshot({name},students(),records,identities).record||null:null; // 다른 반·날짜 기록은 보이지 않음
 const matchFor=row=>row?.name?recordOf(row.name):null;
 const keyOf=name=>holdKey(cls,date,name);
 const ledgerAt=(c,d,n)=>bundle?.ledger.findLast(r=>String(r.cls)===String(c)&&r.name===n&&r.date===d)||null;
 const pick=r=>({type:r.type,inT:r.inT||'',outT:r.outT||'',oa:r.oa||'',ob:r.ob||'',reason:r.reason||'',ev:r.ev||'',evr:r.evr||'',prov:r.prov||''});
 const saved=row=>({type:row.type,inT:row.rec?.inT||'',outT:row.rec?.outT||'',oa:row.rec?.oa||'',ob:row.rec?.ob||'',reason:row.rec?.reason||'',ev:row.rec?.ev||'',evr:row.rec?.evr||''});
 const valuesOf=row=>({...saved(row),...drafts.get(row.name)});
 // 저장될 값(유형에 필요한 시간만, 사유 앞뒤 공백 없음)으로 비교합니다.
 const sameAs=(a,b)=>a.type===b.type&&JSON.stringify(neededTimes(a.type,a))===JSON.stringify(neededTimes(b.type,b))&&tidyReason(a.reason)===tidyReason(b.reason)&&evOf(a)===evOf(b)&&evrOf(a)===evrOf(b); // 빈 괄호('인적성()')·겹친 공백은 같은 글, 증빙은 저장될 값으로
 const hasDraft=name=>drafts.has(name);
 const typing=el=>{const a=document.activeElement;return !!a&&!!el&&el.contains(a)&&a.matches('input,select,textarea');};
 const sameDay=day=>day===`${cls}|${date}`;

 const sync=createCheckHereSync({db,user,client,fs:{doc,setDoc,onSnapshot,query,collection,where,serverTimestamp},
  withdraw:id=>withdrawRequest(db,user,id),
  getRecord:(c,d,n)=>String(c)===cls&&d===date?recordOf(n):null,
  getSig:(c,d,n)=>ledgerAt(c,d,n)?.sig||'',
  getRow:(c,d,n)=>{const rec=ledgerAt(c,d,n);if(rec)return pick(rec);const row=String(c)===cls&&d===date?rowOf(n):null;return row&&!row.enrolled?{type:'해당없음'}:null;},
  hasDraft:(c,d,n)=>String(c)===cls&&d===date&&(hasDraft(n)||jobs.get(n)?.next!=null),
  teacherOf:c=>bundle?teacherOf(bundle,c):'',
  // 오늘만 자동: 서버 날짜(묶음 today, 날짜 목록과 같은 기준)와 이 PC의 한국 날짜가 같을 때만 오늘로 봅니다(PC 시계가 틀렸거나 화면을 연 채 자정을 넘기면 자동 없음).
  today:()=>{const pc=koreaNow().date;return bundle?.today&&bundle.today!==pc?'':pc;},
  onChange:changed});
 // 직접 요청은 학생마다 늘 보이는 얇은 한 줄(compact, /beta2만). 추천값 편집도 저장하지 않은 일로 셉니다(proposals.hasEdits, 떠날 때 확인).
 const proposals=createProposalReview({db,user,root:host,compact:true,render:()=>renderRows(),showErr:e=>say(e.message,'err'),hasUnsavedReason:()=>drafts.size>0,
  getContext:s=>{const row=rowOf(s.name)||{},record=recordOf(s.name);return {classId:cls,date,name:s.name,phoneLast4:record?.phoneLast4||'',status:row.type||'출석',reason:row.rec?.reason||'',reasonUnsaved:drafts.has(s.name),statusSaving:jobs.has(s.name),teacher:teacherOf(bundle,cls),raw:'',excursion:false,record};}});
 function say(text,kind=''){const el=$('#b2Msg');if(el)el.innerHTML=text?`<div class="b2-note ${kind}" style="margin-bottom:10px">${esc(text)}</div>`:'';}

 function compareRow(row){
  if(!row.enrolled&&!row.rec)return {state:'none',text:'재학 기간 아님'};
  // 보정 모드: 연결 프로그램이 고친 교시 기록으로 대조합니다(시간 맞추기·결석 삭제 뒤 남는 실제 입실은 글로만 표시).
  // 오늘 교시·퇴실이 모두 비면 compareCheckHere는 실제 입실로 봅니다(교시가 늦게 찍힐 수 있음). 결석인데 그 학생의 시간 삭제가 확인됐거나
  // 수업이 끝났으면 기다릴 교시가 없으므로 지난 날처럼 봅니다('교시 기록·퇴실 없음 · 실제 입실 남음', 삭제 뒤 ⚠가 남지 않게).
  const now=koreaNow(),settled=['결석','해당없음'].includes(row.type)&&(now.seconds>=seconds(RULES.end)||sync.timesDeleted(keyOf(row.name)));
  return compareCheckHere(row.type,row.rec,matchFor(row),{today:settled?'':now.date,date,now:now.seconds,corrected:true});
 }
 // 필터·검색은 저장된 값으로 거르지만, 손대는 중이거나 방금 손댄 학생(포커스·초안·저장·안내·메모 줄·체크히어 반영 대기·pinned)은 남깁니다.
 // 그래야 고친 행이 바로 사라져 3초·되돌리기·요청 상태·저장 전 초안을 못 보거나, 입력 중인 칸이 지워지는 일이 없습니다.
 function visible(){
  const q=search.trim(),held=new Set(sync.holds().filter(h=>h.cls===cls&&h.date===date).map(h=>h.name));
  const keep=r=>pinned.has(r.name)||held.has(r.name)||jobs.has(r.name)||hasDraft(r.name)||notes.has(r.name)||memoUi.open===r.name||typing(bodies.get(r.name));
  return rows.filter(r=>keep(r)||((!q||r.name.includes(q))&&(filter==='all'||(filter==='exceptions'&&r.rec&&r.type!=='출석')||(filter==='diff'&&compareRow(r).state==='diff')||(filter==='extra'&&extraOpen(r)))));
 }
 // × 버튼: 켜지는 조건(deletionGate: 규칙 게시 깃발·권한, 중계는 필요 없음)이 맞고, 기록 번호가 있는 칸이고(canDeleteTime), 출결원장 유형이 그 시간을 쓰지 않을 때만 켭니다.
 // v2(마지막 중계 신호에 time-delete-v2, 신호가 없으면 v2로 봄)면 관리자 1교시(ATTEND) 학생의 퇴실 ×·1교시 ×는 1교시·퇴실 두 칸을 함께 지웁니다(사용자 결정 2026-10-19, timeDeletePlan).
 // 꺼져 있으면 title에 이유를 보입니다(timeDeletePlan().reasons), 켜져 있으면 지울 칸(timeDeletePlan().sides)에 맞는 남는 것을 보입니다. 누르면 확인창 → 3초 되돌리기 → 시간 삭제 요청(sync.send). 가렸거나 해제 상태를 몰라도(중계 꺼짐) 요청은 만들고 title에 해제 필요를 붙입니다.
 // 재학 기간이 아닌 행에는 상태 칩이 없어 3초·되돌리기가 보이지 않으므로 ×를 두지 않습니다.
 function delButton(row,record,side){
  if(!hm(record?.[side])||(!row.enrolled&&!row.rec))return '';
  const plan=timeDeletePlan({gate:sync.gate(),record,side,type:valuesOf(row).type}),why=plan.reasons,label=side==='entry'?'입실(교시)':'퇴실',p=sync.relay().privacy;
  return `<button class="b2-x" data-ch-del="${side}" ${why.length?'disabled':''} title="${esc(why.length?`${label} 시간 삭제 불가 · ${why.join(' · ')}`:`체크히어 ${label} 시간 삭제 요청 (관리자 승인 뒤 지움 · ${deleteLeaves(plan.sides,record)}${needsUnmaskOnApply(p)?` · ${UNMASK_ON_APPLY}`:''})`)}" aria-label="체크히어 ${label} 시간 삭제">×</button>`;
 }
 function checkhereCell(row,record){
  if(!record)return `<span class="b2-muted b2-small">${esc(recordsNote||'저장본 없음')}</span>`;
  const t=v=>v?String(v).slice(0,5):'-',raw=Object.hasOwn(record,'rawEntry')?record.rawEntry:record.entry;
  const trips=(record.outings||[]).filter(o=>o?.start).map(o=>`${t(o.start)}~${t(o.end)}`);
  const memo=[record.entryMemo,record.exitMemo].filter(Boolean).map(esc).join('<br>');
  // 입실(교시) ×는 지울 대상인 1교시 기록 옆에 둡니다(실제 입실 옆이면 입실을 지우는 것으로 보임). 그래서 ×가 있으면 1교시가 실제 입실과 같거나
  // 실제 입실이 없어도 '교시 기록 HH:MM ×'를 같은 줄에 따로 보입니다(행 높이는 그대로).
  const entryX=delButton(row,record,'entry'),period=record.entry&&(entryX||(Object.hasOwn(record,'rawEntry')&&record.rawEntry!==record.entry));
  return `<b>${t(raw)}</b> → <b>${t(record.exit)}</b>${delButton(row,record,'exit')}${period?`<span class="b2-small b2-muted" style="white-space:nowrap"> · 교시 기록 ${t(record.entry)}${entryX}</span>`:''}${trips.length||record.outingCount?`<span class="b2-sub">외출 ${Math.max(trips.length,+record.outingCount||0)}회 ${esc(trips.join(', '))}</span>`:''}${memo?`<span class="b2-sub">${memo}</span>`:''}`;
 }
 // 행 안 입력칸: 유형, 그 유형에 필요한 시간만, 사유(적당히 좁게, 전체 글은 title). 초안이 있으면 초안 값을 보입니다.
 // 분류·세부(인적성·자격증 종류) 드롭다운. 세부가 없는 분류(기타)는 하나만.
 // 사유 칸(사용자 추가 지시 2026-10-20): 칸 자체가 드롭다운(지금까지 쓴 사유). 인적성·자격증은 바로 옆에 종류 드롭다운(자격증 X 종류는 인정 출결에서 막음)(기타면 종류 직접 입력), 목록에 없으면 '기타' → 직접 입력 칸.
 // 출석 기본 행(기록 없음)은 사유를 저장하지 않아 드롭다운을 잠급니다. customOpen: '기타'를 고른 학생(빈 글이어도 직접 입력 칸을 둠).
 // 질병 인정 한도(사용자 2026-10-23 '6회 초과 질병인정은 아예 선택이 안되도록'): 그 학생의 다른 날 질병 인정(출결원장)이 DISEASE.max면 고를 수 없고 저장도 막음
 const diseaseCount=name=>diseaseUsed((bundle?.ledger||[]).filter(r=>String(r.cls)===String(cls)&&r.name===name).map(r=>({date:r.date,type:r.type,reason:r.reason})),date);
 const diseaseBlock=(name,v)=>recognizedType(v.type)&&isDiseaseReason(v.reason)&&diseaseCount(name)>=DISEASE.max;
 function pickHtml(row,v,n,noReason){return reasonPickHtml({reason:v.reason,type:v.type,cls,name:row.name,custom:customOpen.has(row.name),locked:noReason,diseaseFull:diseaseCount(row.name)>=DISEASE.max});}
 // 사유 안내: 취업박람회(저장 전 글 기준) 추가 증빙(저장된 기록에 이미 추가 증빙 배지가 있으면 생략), 인정 출결인데 인정 분류가 아님,
 // 교육일이 아닌 날의 인정 출결(막지 않음, 17반 테스트반은 모든 날을 교육일로 보므로 없음)
 // 중복은 입실·퇴실·외출 가운데 둘 이상인지 입력하는 동안 안내(저장은 missing()이 dupCheck로 막음, beta2-core DUP_RULE)
 function pickNote(row){const v=valuesOf(row),w=dupWarning(v.type,v);return (diseaseBlock(row.name,v)?`<span class="b2-xnote" style="display:block;color:#b42318" data-disease-full>${esc(diseaseFullText(diseaseCount(row.name),DISEASE.max))}</span>`:'')+(w?`<span class="b2-xnote" style="display:block" data-dup-note>${esc(w)}</span>`:'')+reasonNotesHtml({type:v.type,reason:v.reason,cls,offDay:offDay(date),rec:row.rec});}
 function inlineHtml(row){
  const v=valuesOf(row),valid=B2_TYPES.includes(v.type),need=valid?neededTimes(v.type,ALL):{},n=esc(row.name);
  const time=(k,label)=>`<label class="b2-mini">${label}<input type="time" data-inline="${k}" value="${esc(v[k]||'')}" aria-label="${n} ${label} 시간"></label>`,dup=v.type===DUP_TYPE; // 중복: 입실(지각)·퇴실(조퇴)·외출을 함께
  const noReason=(!row.rec&&v.type==='출석')||v.type==='해당없음',record=matchFor(row),hint=memoReason(record?.entryMemo)||memoReason(record?.exitMemo);
  return `${valid?'':badge(row.type)}<select data-inline="type" aria-label="${n} 출결 유형"${TYPE_STYLE[v.type]||''}>${valid?'':'<option value="" selected>유형 선택 필요</option>'}${B2_TYPES.map(t=>`<option value="${t}" ${t===v.type?'selected':''}>${t}</option>`).join('')}</select>${need.inT||dup?time('inT',dup?'입실(지각)':'입실'):''}${need.outT||dup?time('outT',dup?'퇴실(조퇴)':'퇴실'):''}${need.oa||dup?time('oa','외출 시작')+time('ob','외출 종료'):''}<span class="b2-rpick">${pickHtml(row,v,n,noReason)}</span>${evOn(v)?evHtml(row,v,n):''}${hint&&!noReason&&hint!==v.reason?`<button class="b2-btn small ghost" data-hint="${esc(hint)}" title="체크히어 메모의 사유">체크히어 메모: ${esc(hint)}</button>`:''}`;
 }
 // 증빙 드롭다운(사유 바로 옆, 약 110px)과 반려면 반려 사유 칸. 취업박람회 추가 증빙 안내는 title로(예전 증빙 편집기의 안내 글).
 function evHtml(row,v,n){
  const ev=String(v.ev||''),known=EVIDENCE.find(([x])=>x===ev),label=known?known[1]:ev;
  const tip=[`증빙: ${label}`,extraEvidence(row.rec)||isJobFair(v.reason)?`취업박람회 · 추가 증빙 ${EXTRA_DOC}까지 받았으면 「확인」 (그 전에는 미제출·반려로 남아 '추가 증빙' 목록에 보입니다)`:'','바꾸면 「변경 N건 저장」으로 함께 저장합니다'].filter(Boolean).join('\n');
  return `<select class="b2-ev" data-inline="ev" aria-label="${n} 증빙" title="${esc(tip)}">${known?'':`<option value="${esc(ev)}" selected>${esc(ev)}</option>`}${EVIDENCE.map(([x,l])=>`<option value="${x}" ${x===ev?'selected':''}>${l}</option>`).join('')}</select>`
   +(ev==='반려'?`<input class="b2-evr" data-inline="evr" maxlength="300" value="${esc(v.evr||'')}" aria-label="${n} 반려 사유" placeholder="반려 사유 (필수)" title="${esc(v.evr||'반려 사유 (필수)')}">`:'')
   +(drive?.evLinkHtml()||''); // 그날 출결인정자료 폴더(드라이브, 새 탭)
 }
 function ledgerCell(row){
  const rec=row.rec,note=rec?.flag||'',v=valuesOf(row),evrIn=evOn(v)&&v.ev==='반려'; // 반려 사유 칸이 보이면 '반려: …' 줄은 생략
  if(!row.enrolled&&!rec)return `<fieldset class="b2-inline"><select data-inline="type" disabled aria-label="${esc(row.name)} 출결 유형"><option>해당없음</option></select></fieldset><span class="b2-sub">재학 기간 아님</span>`;
  // 모아 저장 중에는 fieldset으로 행 입력칸을 잠급니다(lock, 다시 그려도 잠긴 채).
  return `<fieldset class="b2-inline" ${bulk?'disabled':''}>${inlineHtml(row)}</fieldset><div class="b2-inline-msg" data-msg></div><div data-xnote>${pickNote(row)}</div>${evBadge(rec?.evApplied)}${extraBadge(extraEvidence(rec))}${rec?.evr&&!evrIn?`<span class="b2-sub">반려: ${esc(rec.evr)}</span>`:''}${rec?.check?`<span class="b2-sub">시트 확인: ${esc(rec.check)}</span>`:''}${rec?.pending?'<span class="b2-badge q-wait" title="담임·운영팀이 저장해 시트 반영을 기다리는 값">반영 대기</span>':rec?`<span class="b2-sub">${esc(rec.prov||'직접 입력')}</span>`:''}${note?`<span class="b2-sub">참고: ${esc(note)}</span>`:''}`;
 }
 // 학생 한 명 = <tbody data-student> 하나: 행, 메모 줄(열 때만), 그 아래 얇은 직접 요청 줄(재학 기간 아닌 행은 없음).
 // 저장 안내([data-msg])·저장 전 표시([data-mark])·상태 칩([data-status])·직접 요청 줄([data-prop])은 비워 두고 따로 채웁니다(초마다 바뀌거나 입력 중이어도 다른 칸을 건드리지 않게).
 function rowHtml(row){
  const cmp=compareRow(row),out=!row.enrolled&&!row.rec,record=matchFor(row),tone=cmp.state==='diff'?'diff':'';
  return `<tr class="${tone} ${out?'out':'has-req'}" data-name="${esc(row.name)}"><td><span class="b2-name">${esc(row.name)}</span><span data-mark></span>${row.status&&row.status!=='재학'?`<span class="b2-sub">${esc(row.status)}${row.changed?' · '+md(row.changed):''}</span>`:''}${out?'':'<div data-memo></div>'}</td><td>${ledgerCell(row)}</td><td>${checkhereCell(row,record)}${out?'':'<div class="b2-status" data-status></div>'}</td><td><span class="b2-match ${cmp.state}">${cmp.state==='ok'?'✓ ':cmp.state==='diff'?'⚠ ':''}${esc(cmp.text)}</span></td></tr>`
   +(out?'':`<tr class="b2-memo-row ${tone}" data-memo-row hidden><td colspan="4"><div data-memoedit></div></td></tr>`) // 출결대조 메모 칩 줄(열 때만, paintMemo)
   +(out?'':`<tr class="b2-req-row ${tone}"><td colspan="4"><div class="b2-req" data-prop></div></td></tr>`);
 }
 // 그사이 바뀜: 초안을 시작한 뒤 출결원장 행이 바뀜(새로 읽기·다른 사람 저장). 초안은 그대로 두고 알리기만 합니다(저장하면 before로 서버가 거절).
 const outdated=name=>{const d=drafts.get(name),row=rowOf(name);return !!d&&!!row&&d.base!==(row.rec?.sig||'');};
 const markHtml=name=>drafts.has(name)?'<span class="b2-dirty" title="저장하지 않은 변경 · 「변경 N건 저장」(Ctrl+S)으로 저장, Esc는 이 행 되돌림">저장 전</span>':'';
 // 행 안내: 저장 중, 안내·오류(입력 필요·저장 실패·그사이 바뀜), 그때만 「취소」(초안 버림). 초안만 있으면 비워 둬 행 높이가 늘지 않습니다.
 function msgHtml(name){
  const note=notes.get(name),busy=jobs.has(name),gone=!note&&outdated(name);
  return `${busy?`<span class="b2-saving">${waiting.has(name)?'<span class="b2-badge q-wait">반영 대기</span> 시트에 반영하는 중…':'저장 중…'}${jobs.get(name).next?' · 이어서 저장 대기':''}</span>`:''}${note?`<span class="b2-err">${esc(note)}</span>`:''}${gone?`<span class="b2-err">그사이 바뀜 · 시트 값 ${esc(brief(saved(rowOf(name))))}</span>`:''}${(note||gone)&&drafts.has(name)?'<button class="b2-btn small" data-inline-cancel title="이 학생의 저장하지 않은 변경을 버리고 시트 값으로 (Esc)">취소</button>':''}`;
 }
 // 남은 초는 칩 모양(html)에 넣지 않고 따로 돌려줍니다. 초만 바뀔 때 버튼을 새로 만들지 않아야 누르는 중·키보드 포커스의 「되돌리기」가 사라지지 않습니다.
 function statusHtml(name){
  const s=sync.statusFor(keyOf(name));if(!s?.label&&!s?.actions?.length)return {html:'',sec:null};
  let label=s.label;
  for(const a of s.actions){const t=STATUS_ACTIONS[a];if(label===t)label='';else if(label.endsWith(' · '+t))label=label.slice(0,-t.length-3);}
  const sec=/^보내기 전 (\d+)초$/.exec(label);
  return {sec:sec?sec[1]:null,html:`${label?`<span class="b2-st ${esc(s.tone||'')}" data-kind="${esc(s.kind)}" title="${esc(s.detail||'')}">${sec?'보내기 전 <b class="b2-sec"></b>초':esc(label)}</span>`:''}${s.actions.map(a=>`<button class="b2-btn small ${a==='undo'?'warn':'soft'}" data-act="${a}" title="${esc(s.detail||'')}">${STATUS_ACTIONS[a]}</button>`).join('')}${s.detail?`<span class="b2-sub">${esc(s.detail)}</span>`:''}`};
 }
 const patch=(name,part,html)=>{const el=bodies.get(name)?.querySelector(`[data-${part}]`);if(el&&shown.get(part+'|'+name)!==html){el.innerHTML=html;shown.set(part+'|'+name,html);}return el;};
 // 행 안내 + 저장 전 표시(행 왼쪽 줄 dirty). 다시 그리지 않고 고치므로 입력 중에도 바로 보입니다.
 const paintMsg=name=>{patch(name,'msg',msgHtml(name));patch(name,'mark',markHtml(name));bodies.get(name)?.querySelector('tr[data-name]')?.classList.toggle('dirty',drafts.has(name));};
 const paintStatus=name=>{const {html,sec}=statusHtml(name),b=patch(name,'status',html)?.querySelector('.b2-sec');if(b&&sec!=null&&b.textContent!==sec)b.textContent=sec;};
 // 직접 요청 줄(checkhere-proposals.mjs compact 세 칸). 바뀌었을 때만 다시 그리고, 그 줄에서 입력 중이면 건너뛰어 focusout 때 다시 그립니다.
 // 화면 값과 추천값이 늘 같게 그려 두므로 요청 모듈의 capture가 옛 값을 직접 수정으로 잘못 담지 않습니다(입력은 bind의 oninput이 바로 담음). 다시 그렸으면 true(bind 필요).
 const propHtml=row=>`<span class="b2-req-head">직접 요청</span>${COLUMNS.map(c=>proposals.html({rowIndex:row.rowIndex,name:row.name},c)).join('')}`;
 function paintProp(name){
  const row=rowOf(name),box=bodies.get(name)?.querySelector('[data-prop]');if(!row||!box)return false;
  let html;try{html=propHtml(row);}catch(e){html=`<span class="b2-req-head">직접 요청</span><span class="b2-err">${esc(e.message)}</span>`;}
  if(shown.get('prop|'+name)===html)return false;
  if(typing(box)){stale.add(name);return false;}
  box.innerHTML=html;shown.set('prop|'+name,html);return true;
 }
 // 출결대조 메모: 이름 아래 단추(메모가 있으면 그 글)와 열었을 때 학생 아래 칩 줄. 행을 다시 그리지 않고 따로 채우고, 직접 입력 중이면 칩 줄은 건너뜁니다.
 const memoKey=(c,n,d)=>`${c}|${n}|${d}`,memoOf=name=>memos.get(memoKey(cls,name,date))||null;
 function memoTagHtml(name){
  const m=memoOf(name),open=memoUi.open===name;
  return m?`<button class="b2-memo-tag has" data-memo-toggle aria-expanded="${open}" title="${esc(`출결대조 메모${m.by?' · '+m.by:''} · 눌러서 바꾸기`)}">메모 · ${esc(m.memo)}</button>`:`<button class="b2-memo-tag" data-memo-toggle aria-expanded="${open}" title="이 학생 출결대조 메모 남기기 (증빙·직접 입력, 반 전체 공통은 위 「공통메모」)">+ 메모</button>`;
 }
 function memoEditHtml(name){
  const cur=memoOf(name)?.memo||'',u=memoUi,off=u.busy===name?'disabled':'',chip=t=>`<button class="b2-chip" data-memo-pick="${esc(t)}" aria-pressed="${cur===t}" ${off}>${esc(t)}</button>`;
  // 수기출석 공통메모 사항은 반·날짜 공통메모(도구줄 「공통메모」)로 옮겼습니다(2026-10-20).
  return `<div class="b2-memo-edit"><div class="b2-memo-group"><span class="b2-req-head">출결대조 메모</span>${MEMO_PICKS.map(chip).join('')}<button class="b2-chip" data-memo-custom aria-pressed="${u.custom}" ${off}>직접 입력</button>${u.custom?`<input class="b2-memo-input" data-memo-input maxlength="${MEMO_MAX}" value="${esc(u.text)}" placeholder="짧게 적기 (${MEMO_MAX}자 이내)" aria-label="${esc(name)} 출결대조 메모 직접 입력" ${off}><button class="b2-btn small primary" data-memo-save ${off}>저장</button>`:''}${cur?`<button class="b2-btn small ghost" data-memo-clear ${off}>메모 지우기</button>`:''}<button class="b2-btn small ghost" data-memo-close>닫기</button>${off?'<span class="b2-saving">메모 저장 중…</span>':''}${u.err?`<span class="b2-err">${esc(u.err)}</span>`:''}<span class="b2-tiny b2-muted">${u.custom?'직접 입력 중에는 칩을 누르면 글에 덧붙습니다(「저장」을 눌러야 저장).':'누르면 바로 저장되고 운영 관리자 알림함에 알림이 갑니다(출결 수정 저장과 따로).'}</span></div></div>`;
 }
 function paintMemo(name){
  const tb=bodies.get(name);if(!tb)return;
  patch(name,'memo',memoTagHtml(name));
  const open=memoUi.open===name,tr=tb.querySelector('tr[data-memo-row]'),box=tb.querySelector('[data-memoedit]');if(tr)tr.hidden=!open;if(!box)return;
  if(open&&typing(box)&&memoUi.busy!==name)return;
  patch(name,'memoedit',open?memoEditHtml(name):'');
 }
 // 반·기간(첫 교육일 또는 보고 있는 더 이른 날~오늘) 메모를 한 번 읽습니다(force: 새로고침·시트 변경·저장 뒤). 못 읽으면 다음 읽기 때 다시 합니다.
 async function loadMemos({force=false}={}){
  // 교육일이 아닌 날(개강 전 등)을 보고 있으면 그날부터 읽습니다(2026-10-20).
  // 아직 오지 않은 날을 보고 있으면 그날까지 읽습니다.
  if(!bundle)return;const c=cls,first=bundle.days[0]||'',from=date&&(!first||date<first)?date:first,today=bundle.today||'',to=date&&date>today?date:today,k=`${c}|${from}|${to}`;
  if(!force&&memoRange===k)return;memoRange=k;const n=++memoSeq;
  try{
   const res=await client.call('b2LedgerMemos',{cls:c,from,to});if(n!==memoSeq||!life.alive())return;
   for(const key of [...memos.keys()])if(key.startsWith(c+'|'))memos.delete(key);
   for(const r of res?.rows||[])if(String(r.cls)===c&&String(r.memo||'').trim())memos.set(memoKey(c,r.name,r.date),{memo:String(r.memo).trim(),by:r.by||''});
  }catch(e){if(n!==memoSeq||!life.alive())return;memoRange='';say(`출결대조 메모를 불러오지 못했습니다: ${e.message}`,'warn');}
  if(c===cls)for(const name of bodies.keys())paintMemo(name);
 }
 // 메모 저장(빈 글이면 지움). 바로 저장하고 관리자 알림을 남깁니다(알림 실패는 작은 안내만, 메모는 저장된 그대로). 출결 초안·모아 저장과 섞이지 않습니다.
 // 리허설 안전장치(시트 v23, 2026-10-21): was = 화면이 본 메모 글자(없던 메모는 ''). 다른 운영자가 그사이 메모를 바꿨으면 CONFLICT → 메모를 새로 읽어 새 메모를 보이고,
 // 내 글은 직접 입력 칸에 남겨 다시 「저장」하게 합니다(다시 저장하면 새로 읽은 메모를 was로 보냄).
 async function saveMemo(name,text){
  const memo=String(text??'').replace(/\s+/g,' ').trim().slice(0,MEMO_MAX),c=cls,d=date,k=memoKey(c,name,d),before=memos.get(k)?.memo||'';
  if(memoUi.busy)return;if(memo===before){memoUi.custom=false;memoUi.err='';paintMemo(name);return;}
  memoUi.busy=name;memoUi.err='';paintMemo(name);
  try{
   const res=await client.call('b2LedgerMemo',{cls:c,name,date:d,memo,was:before});
   if(memo)memos.set(k,{memo,by:user?.email||''});else memos.delete(k);
   if(bundle&&String(res?.cls??c)===cls&&+res?.rev===+bundle.rev+1)bundle.rev=+res.rev; // 메모만 바뀐 변경 번호로 출결원장을 다시 읽지 않게(그사이 다른 변경이 있었으면 그대로 다시 읽음)
   memoUi.custom=false;memoUi.text='';
   toast(`${name} · ${md(d)} 출결대조 메모를 ${memo?'저장했':'지웠'}습니다.`);
   if((res?.offDay||res?.future)&&res.notice&&sameDay(`${c}|${d}`))say(res.notice); // 교육일이 아닌 날·아직 오지 않은 날의 메모 안내(시트가 붙임, 막지 않음)
   void notify('출결대조 메모',{audience:'admins',cls:c,title:`출결대조 메모 · ${c}반 ${name}`,body:memo?`${md(d)} ${memo}`:`${md(d)} 메모를 지웠습니다 (전: ${before})`,link:linkFor('b2ledger',{cls:c,date:d})});
   void loadMemos({force:true});
  }catch(e){
   if(e?.code==='CONFLICT'){
    memoUi.busy='';await loadMemos({force:true});
    const now=memos.get(k)?.memo||'';
    Object.assign(memoUi,{open:name,custom:true,text:memo,err:`그사이 다른 사람이 메모를 바꿨습니다 · 새 메모: ${now||'(없음)'} · 내 글은 칸에 남겨 두었습니다. 다시 「저장」을 누르면 내 글로 바꿉니다.`});
   }else memoUi.err=`메모를 저장하지 못했습니다: ${e.message}`;
  }
  finally{memoUi.busy='';if(life.alive()&&sameDay(`${c}|${d}`))paintMemo(name);}
 }
 function openMemo(name){const prev=memoUi.open;Object.assign(memoUi,{open:prev===name?'':name,custom:false,text:'',err:''});if(prev&&prev!==name)paintMemo(prev);paintMemo(name);}

 // ---------- 공통메모(반·날짜, 시트 v17 b2DayMemos·b2DayMemo) ----------
 // 거르기 칩 줄의 「공통메모」(지금 글 앞부분 또는 '공통메모 없음')와 도구줄 아래 편집 칸(빠른 문구 묶음 · 500자 칸 · 저장·지우기·닫기 · 마지막 저장).
 // 시트가 아직 v17 전이면(SHEET_OUTDATED) '시트 업데이트 대기'만 보이고 나머지 화면은 그대로입니다.
 const dayRow=(d=date)=>dayMemoCls===cls?dayMemos.get(d)||null:null;
 const dayDirty=()=>dayUi.open&&tidyDayMemo(dayUi.text)!==tidyDayMemo(dayUi.base); // base는 시트 값 그대로(was로 보냄)
 const lastSaved=r=>r?[r.editedBy||r.by,r.editedAt||r.at].filter(Boolean).join(' · '):''; // 고친 사람·시각이 있으면 그것, 없으면 처음 쓴 사람·시각
 const shortMemo=m=>{const t=String(m).trim(),one=t.split('\n')[0];return one.length>24?one.slice(0,24)+'…':one+(t.includes('\n')?' …':'');};
 const koreaStamp=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,16);
 function dayChipHtml(){
  const r=dayRow(),memo=r?.memo||'',st=dayMemoState;
  const label=st==='wait'?'공통메모 · 시트 업데이트 대기':st==='err'?'공통메모 · 읽기 실패':st==='loading'&&!r?'공통메모 …':memo?`공통메모 · ${shortMemo(memo)}`:'공통메모 없음';
  const title=st==='wait'?'시트 업데이트 대기 · 마스터시트가 아직 공통메모를 받지 않습니다(Apps Script v17 배포 뒤 쓸 수 있습니다)'
   :memo?`공통메모 ${md(date)} · ${memo}${lastSaved(r)?`\n마지막 저장 ${lastSaved(r)}`:''}\n눌러서 바꾸기`:'이 반·이 날짜 모든 학생과 그날 업무에 대한 공통메모 남기기 (저장하면 담임·운영 관리자에게 알림)';
  return `<button class="b2-chip b2-daymemo-chip${memo?' has':''}" id="b2DayMemoBtn" data-daymemo-toggle aria-expanded="${dayUi.open}" aria-controls="b2DayMemo" title="${esc(title)}">${esc(label)}${dayDirty()?'<span class="b2-dirty">저장 전</span>':''}</button>`;
 }
 function dayPanelHtml(){
  const r=dayRow(),u=dayUi,off=u.busy?'disabled':'',close=`<button class="b2-btn small ghost" data-daymemo-close ${off}>닫기</button>`;
  const head=`<div class="b2-daymemo-head"><b>공통메모 · ${esc(cls)}반 ${esc(md(date))}</b><span class="b2-tiny b2-muted">이 반·이 날짜의 모든 학생과 그날 업무에 대한 공통 코멘트입니다. 저장하면 이 반 담임(출결판 그날 위에 보임)과 운영 관리자에게 알림이 갑니다.</span></div>`;
  if(dayMemoState==='wait')return `${head}<div class="b2-note warn" data-daymemo-wait>시트 업데이트 대기 · 마스터시트가 아직 공통메모를 받지 않습니다. Apps Script(v17)를 배포한 뒤 쓸 수 있습니다.</div><div class="b2-daymemo-foot">${close}</div>`;
  if(dayMemoState==='err')return `${head}<div class="b2-note err">공통메모를 불러오지 못했습니다: ${esc(dayMemoErr)}</div><div class="b2-daymemo-foot"><button class="b2-btn small" data-daymemo-retry>다시 읽기</button>${close}</div>`;
  if(dayMemoState==='loading')return `${head}${loading('공통메모를 불러오는 중…')}<div class="b2-daymemo-foot">${close}</div>`;
  const picks=DAY_MEMO_PICKS.map(([g,list])=>`<div class="b2-memo-group" data-daymemo-group="${esc(g)}" role="group" aria-label="공통메모 ${esc(g)}"><span class="b2-req-head">${esc(g)}</span>${list.map(t=>`<button class="b2-chip" data-daymemo-pick="${esc(t)}" ${off}>${esc(t)}</button>`).join('')}</div>`).join('');
  const c=u.conflict,last=lastSaved(r);
  return `${head}<div class="b2-memo-edit">${picks}</div><textarea class="b2-daymemo-input" data-daymemo-input maxlength="${DAY_MEMO_MAX}" rows="3" placeholder="이 반·이 날짜 공통 코멘트 (${DAY_MEMO_MAX}자 이내 · 위 문구를 누르면 글 끝에 덧붙습니다)" aria-label="${esc(`${cls}반 ${md(date)} 공통메모`)}" ${off}>${esc(u.text)}</textarea>`
   +`<div class="b2-daymemo-foot"><span class="b2-tiny b2-muted" data-daymemo-count>${u.text.length}/${DAY_MEMO_MAX}자</span><button class="b2-btn small primary" data-daymemo-save ${off} title="저장 (Ctrl+S)">저장</button>${r?`<button class="b2-btn small ghost" data-daymemo-clear ${off}>지우기</button>`:''}${close}${u.busy?'<span class="b2-saving">저장 중…</span>':''}${u.err?`<span class="b2-err">${esc(u.err)}</span>`:''}`
   +`${c?`<span class="b2-err" data-daymemo-conflict>그사이 바뀜 · 시트 최신 값 ${c.memo?`「${esc(c.memo)}」${lastSaved(c)?` (${esc(lastSaved(c))})`:''}`:'없음(지워짐)'} · 다시 저장하면 이 글로 덮어씁니다</span>`:''}<span class="b2-tiny b2-muted" data-daymemo-last>${last?`마지막 저장 ${esc(last)}`:r?'':'아직 공통메모가 없습니다'}</span></div>`;
 }
 function paintDayMemo(){
  const btn=$('#b2DayMemoBtn');if(btn){const html=dayChipHtml();if(btn.outerHTML!==html)btn.outerHTML=html;}
  const box=$('#b2DayMemo');if(!box)return;box.hidden=!dayUi.open;
  const html=dayUi.open?dayPanelHtml():'';if(shown.get('daymemo')===html)return;
  // 입력 중에 다시 그리면 칸의 커서 자리를 되살립니다(글은 dayUi.text에서 오므로 그대로).
  const a=document.activeElement,keep=a&&box.contains(a)&&a.matches('[data-daymemo-input]')?[a.selectionStart,a.selectionEnd]:null;
  box.innerHTML=html;shown.set('daymemo',html);
  if(keep){const i=box.querySelector('[data-daymemo-input]');if(i&&!i.disabled){i.focus();try{i.setSelectionRange(...keep);}catch{}}}
 }
 // 입력할 때: 글자 수와 칩의 '저장 전'만 고칩니다(칸은 다시 그리지 않음).
 function paintDayTyping(){
  const n=$('[data-daymemo-count]');if(n)n.textContent=`${dayUi.text.length}/${DAY_MEMO_MAX}자`;
  const b=$('#b2DayMemoBtn');if(b&&!!b.querySelector('.b2-dirty')!==dayDirty())b.outerHTML=dayChipHtml();
 }
 const focusDay=()=>{const i=$('[data-daymemo-input]');if(i&&!i.disabled){i.focus();const n=i.value.length;try{i.setSelectionRange(n,n);}catch{}}};
 // 반의 공통메모를 읽습니다(반마다, 변경 번호가 같으면 beta2-data가 다시 읽지 않음, force: 새로고침·저장 뒤). 열어 둔 칸을 고치지 않았으면 시트 최신 값으로 맞춥니다.
 async function loadDayMemos({force=false}={}){
  if(!client.dayMemos)return;
  const c=cls,n=++dayMemoSeq;if(dayMemoCls!==c){dayMemos.clear();dayMemoCls=c;dayMemoState='loading';paintDayMemo();}
  try{
   const res=await client.dayMemos({cls:c},{fresh:force});if(n!==dayMemoSeq||!life.alive())return;
   dayMemos.clear();for(const r of res?.rows||[])if(String(r.cls)===c&&String(r.memo||'').trim())dayMemos.set(String(r.date),{...r,memo:String(r.memo)}); // 시트 값 그대로(was 비교용)
   dayMemoState='';dayMemoErr='';
  }catch(e){if(n!==dayMemoSeq||!life.alive())return;if(e.code==='SHEET_OUTDATED')dayMemoState='wait';else{dayMemoState='err';dayMemoErr=e.message;}}
  if(dayUi.open&&!dayUi.busy&&!dayUi.conflict&&!dayDirty()&&dayUi.day===`${cls}|${date}`){const m=dayRow()?.memo||'';dayUi.text=m;dayUi.base=m;}
  paintDayMemo();
 }
 // 열기·닫기(고친 글이 있으면 닫기 전에 묻습니다). 열 때의 시트 값이 저장 때 was(그사이 바뀜 확인)입니다.
 function toggleDayMemo(on=!dayUi.open){
  if(!on&&dayDirty()&&!confirm('저장하지 않은 공통메모 글이 있습니다. 닫으면 사라집니다. 닫을까요?'))return;
  const m=dayRow()?.memo||'';Object.assign(dayUi,{open:on,text:m,base:m,err:'',conflict:null,day:`${cls}|${date}`});
  paintDayMemo();if(on)focusDay();
 }
 function pickDayMemo(add){
  const next=appendPick(dayUi.text,add,DAY_MEMO_MAX);
  if(next===null)dayUi.err=`${DAY_MEMO_MAX}자를 넘어 덧붙이지 않았습니다.`;else{dayUi.text=next;dayUi.err='';}
  paintDayMemo();focusDay();
 }
 // 저장(clear면 지움). 같은 값이면 시트가 unchanged로 답하고 알림은 보내지 않습니다. 그사이 바뀌었으면 최신 값을 다시 읽어 보이고 글은 남깁니다(다시 저장하면 덮어씀).
 // 빈 글이 아닌 저장은 그 반 담임(toClass)과 운영 관리자에게 알림(알림 실패는 작은 안내만, 메모는 저장된 그대로).
 async function saveDayMemo(clear=false){
  if(dayUi.busy||dayMemoState||!dayUi.open)return;
  const c=cls,d=date,day=`${c}|${d}`,memo=clear?'':tidyDayMemo(dayUi.text),was=dayUi.base,me=user?.email||'';
  if(!clear&&!memo){dayUi.err='공통메모를 적어 주세요. 지우려면 「지우기」를 누릅니다.';return paintDayMemo();}
  if(memo===tidyDayMemo(was)){Object.assign(dayUi,{open:false,err:'',conflict:null});return paintDayMemo();} // 바뀐 것이 없음
  dayUi.busy=true;dayUi.err='';paintDayMemo();
  try{
   const res=await client.dayMemoSave({cls:c,date:d,memo,was});if(!life.alive())return;
   if(!res?.unchanged){
    if(dayMemoCls===c){const old=dayMemos.get(d);if(memo)dayMemos.set(d,{cls:c,date:d,memo,by:res?.by||old?.by||me,at:res?.at||old?.at||'',editedBy:me,editedAt:koreaStamp()});else dayMemos.delete(d);}
    if(bundle&&c===cls&&+res?.rev===+bundle.rev+1)bundle.rev=+res.rev; // 공통메모만 바뀐 변경 번호로 출결원장을 다시 읽지 않게
    toast(`${c}반 · ${md(d)} 공통메모를 ${memo?'저장했':'지웠'}습니다.`);
    if(memo)void notify('출결대조 메모',{audience:'admins',toClass:c,cls:c,title:`출결대조 공통메모 · ${c}반 ${md(d)}`,body:memo,link:linkFor('b2ledger',{cls:c,date:d,memo:'day'})});
   }else toast(`${c}반 · ${md(d)} 공통메모가 시트와 같아 그대로 둡니다.`);
   if(sameDay(day))Object.assign(dayUi,{open:false,text:'',base:'',err:'',conflict:null});
   void loadDayMemos({force:true}); // 시트의 마지막 저장(editedBy·editedAt)으로
  }catch(e){
   if(!life.alive())return;
   if(e.code==='CONFLICT'||/그사이 바뀌/.test(e.message)){
    await loadDayMemos({force:true});if(!life.alive()||!sameDay(day))return;
    const now=dayRow(d);dayUi.conflict=now?{...now}:{memo:''};dayUi.base=now?.memo||'';
   }else if(e.code==='SHEET_OUTDATED')dayMemoState='wait';
   else dayUi.err=`공통메모를 저장하지 못했습니다: ${e.message}`;
  }finally{dayUi.busy=false;if(life.alive())paintDayMemo();}
 }
 const focusSel=a=>!a?null:a.dataset.inline?`[data-inline="${a.dataset.inline}"]`:a.dataset.proposalEdit?`[data-proposal-edit="${CSS.escape(a.dataset.proposalEdit)}"]${a.dataset.time?`[data-time="${a.dataset.time}"]`:''}`:null;
 // 한 학생만 다시 그립니다. 입력칸에 포커스가 있는 행은 건너뛰고 focusout 때 다시 그립니다(force는 유형 변경·되돌림처럼 화면이 바뀌어야 할 때, 포커스를 되살림).
 // 초안이 있는 행도 다시 그립니다(입력칸 값은 초안에서 오므로 그대로이고 체크히어·대조 칸만 새 값).
 function paint(name,{force=false,bind=true}={}){
  const row=rowOf(name),el=bodies.get(name);if(!row||!el)return;
  // force는 같은 HTML이어도 다시 그립니다(입력칸의 화면 값은 입력하며 달라지므로 되돌린 초안이 남지 않게).
  const html=rowHtml(row);let redrawn=false;
  if(force||drawn.get(name)!==html){
   const focused=typing(el);
   if(!force&&focused)stale.add(name);
   else{
    const a=focused?document.activeElement:null,sel=focusSel(a);
    let start=null,end=null;try{start=a?.selectionStart??null;end=a?.selectionEnd??null;}catch{}
    painting=true;
    try{
     el.innerHTML=html;drawn.set(name,html);for(const p of PARTS)shown.delete(p+'|'+name);paintProp(name);redrawn=true;
     const n=sel&&el.querySelector(sel);if(n&&!n.matches(':disabled')){n.focus();if(start!==null)try{n.setSelectionRange(start,end);}catch{}}
    }finally{painting=false;}
   }
  }
  paintMsg(name);paintStatus(name);paintMemo(name);
  if((redrawn||paintProp(name))&&bind)proposals.bind(students());
  if(redrawn||!typing(el))stale.delete(name);
 }
 function paintRelay(){
  const el=$('#b2Relay');if(!el)return;const r=sync.relay();
  // 중계는 읽기 전용(10분마다 체크히어 기록 갱신)입니다. 요청은 켜져 있어도 자동 처리되지 않고 사람의 승인을 기다립니다.
  // 체크히어 해제 상태(중계 신호 privacy): 가려져 있어도 읽기·요청은 되고, 운영 포털에서 반영할 때만 사람이 수집 PC 체크히어 탭에서 해제합니다.
  // 중계가 꺼지면 해제 상태를 모릅니다(첫 줄). 요청(시간 삭제 포함)은 중계 없이도 만듭니다(2026-10-16). '시간 삭제 포함'은 도구줄 글처럼 삭제 조건(sync.gate())이 맞을 때만.
  const title=[r.privacy?.text||(r.on?'':PRIVACY_NEEDS_RELAY+'.'),r.on?`수집 PC 중계가 체크히어 기록을 10분마다 읽습니다(읽기 전용)${r.busy?' · 작업 중':''}`:`수집 PC의 체크히어 실시간 화면에서 중계를 켜면 체크히어 기록을 10분마다 읽어 옵니다(읽기 전용). 요청${sync.gate().enabled?'(시간 삭제 포함)':''}은 중계 없이도 만들 수 있습니다.`,
   '체크히어 반영 요청은 관리자가 운영 포털 「반영 요청·승인」에서 승인할 때만 반영됩니다.',
   r.needsUnmask?`승인한 반영 ${r.needsUnmask}건이 체크히어 개인정보 가림에 막혀 있습니다. 수집 PC 연결 프로그램의 체크히어 창(같은 탭)에서 직접 해제하거나 연결 프로그램 화면의 「마스킹 해제 시작」을 누른 뒤, 운영 포털에서 다시 반영해 주세요.`:'',r.requestsError?`체크히어 요청 목록 읽기 실패: ${r.requestsError}`:''].filter(Boolean).join('\n');
  const html=`<span class="b2-pill ${r.on&&!r.needsUnmask?'live':'wait'}" title="${esc(title)}">${esc(r.text)}</span>`;if(shown.get('relay')!==html){el.innerHTML=html;shown.set('relay',html);}
 }
 function showEmpty(html){let el=table.querySelector('tbody[data-empty]');if(!el){el=document.createElement('tbody');el.dataset.empty='';table.append(el);}el.innerHTML=`<tr><td colspan="4">${html}</td></tr>`;}
 function renderRows(){
  if(!life.alive()||!bundle)return;
  const list=visible(),counts=dayCounts(rows),diff=rows.filter(r=>compareRow(r).state==='diff').length;
  $('#b2Stats').innerHTML=[['총원',counts.총원],['출석',counts.출석],['결석',counts.결석,counts.결석?'bad':''],['지각',counts.지각],['조퇴',counts.조퇴],['외출',counts.외출],['중복',counts.중복],['인정',counts.인정],['체크히어 불일치',diff,diff?'alert':'']].map(([l,n,k])=>`<div class="b2-stat ${k||''}"><b>${n}</b><span>${l}</span></div>`).join('');
  const extraN=rows.filter(extraOpen).length;
  $('#b2Filters').innerHTML=FILTERS.map(([k,l])=>`<button class="b2-chip" data-filter="${k}" aria-pressed="${filter===k}" ${k==='extra'?`title="취업박람회 인정 출결 중 ${EXTRA_DOC} 확인 전"`:''}>${l}${k==='extra'?`<span class="n">${extraN}</span>`:''}</button>${k==='diff'?dayChipHtml():''}`).join(''); // 공통메모는 「체크히어 불일치」 바로 뒤
  $('#b2Live').innerHTML=live==='live'?`<span class="b2-pill live">체크히어 실시간${records.length?` · ${records.length}명`:''}</span>`:live==='day'?`<span class="b2-pill">체크히어 저장본${records.length?` · ${records.length}명`:''}</span>`:live?`<span class="b2-pill wait">${esc(live)}</span>`:'';
  paintRelay();
  const keep=new Set(list.map(r=>r.name));
  // 빠지는 행을 지울 때 포커스가 빠지며 나는 focusout이 다시 그리기를 부르지 않게 합니다(입력 중인 행은 visible()이 이미 남김).
  painting=true;
  try{for(const [name,el] of bodies)if(!keep.has(name)){el.remove();bodies.delete(name);drawn.delete(name);stale.delete(name);for(const p of PARTS)shown.delete(p+'|'+name);}}
  finally{painting=false;}
  if(list.length)table.querySelector('tbody[data-empty]')?.remove();
  else showEmpty(`<div class="b2-muted b2-pad">${rows.length?'조건에 맞는 학생이 없습니다.':'명부에 이 반 학생이 없습니다. 마스터시트 명부를 먼저 채워 주세요.'}</div>`);
  let prev=table.tHead;
  for(const row of list){
   let el=bodies.get(row.name);
   if(!el){el=document.createElement('tbody');el.dataset.student=row.name;bodies.set(row.name,el);}
   if(prev.nextElementSibling!==el)prev.after(el);
   prev=el;paint(row.name,{bind:false});
  }
  proposals.bind(students());paintBulk();
 }
 // 출결원장 행이 바뀐 학생만 rows를 고칩니다(되돌리기 저장처럼 이 화면 밖에서 묶음이 고쳐진 경우).
 function refreshRow(name){
  const i=rows.findIndex(r=>r.name===name);if(i<0)return false;
  const rec=ledgerAt(cls,date,name);if(rec===rows[i].rec)return false;
  rows[i]={...rows[i],rec,type:rec?rec.type:rows[i].enrolled?'출석':'해당없음'};return true;
 }
 // 동기화 모듈 알림: 학생 키면 그 행의 상태 칩만, null이면 전체(중계 신호·삭제 조건·요청 목록)를 다시 그립니다.
 function changed(key){if(!pend){pend=new Set();queueMicrotask(flushChanged);}pend.add(key??'*');}
 function flushChanged(){
  const keys=pend;pend=null;if(!life.alive()||!bundle)return;
  let full=keys.has('*');const names=[];
  for(const k of keys){if(k==='*')continue;const [c,d,...n]=k.split('|'),name=n.join('|');if(c!==cls||d!==date)continue;names.push(name);if(refreshRow(name))full=true;}
  if(full)return renderRows();
  names.forEach(paintStatus);
 }
 // 고를 수 있는 날: 아무 날(교육일이 아니어도, 미래여도, 2026-10-20). 지금 날짜가 날짜 모양이 아니면 가장 가까운 지난 교육일, 그것도 없으면(개강 전) 오늘.
 // 빈 날짜면 체크히어 문서 주소가 깨져 반을 못 불러왔습니다(2026-10-20).
 const canPick=(b,d)=>typedDay(d)&&!!b;
 const offDay=d=>!!bundle&&!!d&&!bundle.days.includes(d);
 const futureDay=d=>!!bundle?.today&&!!d&&d>bundle.today;
 function pickDate(b){const days=b.days.filter(d=>d<=b.today).reverse();return canPick(b,date)?date:days[0]||b.today||'';}
 // 날짜 목록: 오늘까지의 교육일(최근 먼저) + 지금 보고 있는 그 밖의 날(제자리에, '교육일 아님'·'예정') + 「다른 날짜…」. 교육일이 아니거나 미래면 날짜 칸을 열어 두고 안내를 보입니다.
 function dateOptions(){
  const days=[...new Set([...bundle.days.filter(d=>d<=bundle.today),...(date?[date]:[])])].sort().reverse();
  $('#b2Date').innerHTML=days.map(d=>`<option value="${d}" ${d===date?'selected':''}>${md(d)}${d===bundle.today?' · 오늘':''}${offDay(d)?' · 교육일 아님':''}${futureDay(d)?' · 예정':''}</option>`).join('')+`<option value="${ANY_DAY}">다른 날짜…</option>`;
  const any=$('#b2DateAny');if(document.activeElement!==any)any.value=date;if(offDay(date)||futureDay(date))any.hidden=false; // 치는 중이면 값을 덮지 않음
  $('#b2DayNote').textContent=dayNote(date);
  drive?.set(cls,date); // 드라이브 바도 그 반·그날로
 }
 // 교육일이 아니거나 아직 오지 않은 날의 작은 안내(막지 않음)
 function dayNote(d){
  const off=offDay(d),future=futureDay(d);if(!off&&!future)return '';
  return [off?'교육일이 아닌 날입니다':'',future?'아직 오지 않은 날입니다':'','기록할 수 있습니다',off?`평소 기준 ${BASE_RULE.start}~${BASE_RULE.end}로 대조합니다`:''].filter(Boolean).join(' · ');
 }
 // 모든 날짜에서 저장본을 먼저 읽고(옛 저장본 대체 포함) 그날 문서를 구독해 갱신합니다. 구독은 반·날짜가 바뀔 때만 새로 겁니다.
 // 같은 반·날짜를 다시 읽을 때(새로고침)는 새 기록이 올 때까지 지금 기록을 지우지 않습니다(그사이 '기록 없음'으로 계산하지 않게).
 async function loadCheckHere(){
  const n=++chSeq,c=cls,d=date;unwatch?.();unwatch=null;if(recordsDay!==`${c}|${d}`){records=[];recordsNote='';recordsDay=`${c}|${d}`;}live='체크히어 확인 중';renderRows();
  if(!d){live='';recordsNote='날짜 없음';renderRows();return;} // 날짜가 없으면 체크히어를 읽거나 구독하지 않음(2026-10-20)
  void import('./beta2-daytimes.mjs').then(m=>m.loadDayTimes(client,c,d)).then(ch=>{if(ch&&n===chSeq&&life.alive())renderRows();},()=>{}); // 그날 교육시간 기준(현장교육 일정, 견학일 지각 10:10·조퇴 16:50)을 반·날짜마다 한 번 읽어 대조 판정에 씀(beta2-daytimes.mjs, 2026-10-19)
  try{
   identities=await loadCheckHereIdentities(db,c,students()).catch(()=>[]);if(n!==chSeq||!life.alive())return;
   const recs=await loadCheckHereDay(db,c,d);if(n!==chSeq||!life.alive())return;
   records=recs;live='day';if(!recs.length)recordsNote='이 날 체크히어 저장본 없음';
  }catch(e){if(n!==chSeq||!life.alive())return;live='체크히어 읽기 실패';recordsNote=e.message;}
  unwatch=watchCheckHereDay(db,c,d,recs=>{if(n!==chSeq||!life.alive())return;records=recs;recordsNote=recs.length?'':'이 날 체크히어 저장본 없음';live='live';sync.recordsChanged();renderRows();},e=>{if(n===chSeq&&life.alive()){live='실시간 연결 끊김';recordsNote=e.message;renderRows();}});
  sync.recordsChanged();renderRows();
 }
 // to: 바꿀 반. 반은 묶음을 다 읽은 뒤에 바꿉니다(그동안 화면·저장은 지금 반 그대로라 반과 학생이 섞이지 않음). 못 읽으면 반 선택을 되돌립니다.
 // 새로 읽어 화면에 넣었으면 true(못 읽었거나 다른 읽기에 밀렸으면 아님 — 그사이 바뀜 안내가 옛 값을 최신이라 하지 않게).
 async function load({fresh=false,keepCheckHere=false,to=cls}={}){
  const n=++seq,from=cls,memoFresh=fresh;say('');
  try{
   // 읽는 사이 이 화면의 저장이 끝났으면 그 저장이 빠진 묶음일 수 있어 다시 읽습니다(옛 지문으로 '시트가 바뀜'·옛 값 다시 보내기가 되지 않게).
   let b,gen;do{gen=saveGen;b=await client.bundle(to,{fresh});if(n!==seq||!life.alive())return;fresh=true;}while(gen!==saveGen);
   const next=pickDate(b),moved=next!==date||to!==from;
   // S10: 반·날짜가 바뀌면 화면 값을 바꾸기 전에 동기화 모듈에 먼저 알립니다(남은 반영 대기는 확인 후 보내거나 취소).
   const r=await sync.setDay(to,next);if(n!==seq||!life.alive())return;
   // 반·날짜가 바뀌면 초안을 버립니다(묻는 것은 leaving). 같은 반·날짜를 다시 읽으면(시트 변경 번호·충돌) 초안은 그대로 두고(값은 초안에서),
   // 저장된 값과 같아진 초안만 지웁니다. 초안 밑의 행이 바뀌었으면 '그사이 바뀜'으로 보입니다(outdated).
   if(to!==from||(date&&next!==date))clearEdits();
   cls=to;bundle=b;date=next;dateOptions();rows=dayView(bundle,cls,date);
   for(const [k,d] of [...drafts]){const row=rowOf(k);if(!row||sameAs(d,saved(row))){drafts.delete(k);notes.delete(k);invalid.delete(k);}}
   renderRows();paintDayMemo();stopped(r);void loadMemos({force:memoFresh});void loadDayMemos({force:memoFresh}); // 출결대조 메모: 반·기간마다 한 번, 새로 읽을 때(새로고침·시트 변경)는 다시
   if(!keepCheckHere||moved)await loadCheckHere();
   void loadProposals();return true;
  }catch(e){if(n!==seq||!life.alive())return false;if(to!==from){$('#b2Class').value=cls;say(`${to}반을 불러오지 못해 ${cls}반을 그대로 보입니다: ${e.message}`,'err');}else showEmpty(errorBox(e));return false;}
 }
 // 반·날짜를 바꿔 멈춘 체크히어 반영 대기(진행 중 요청·기록을 기다리던 것)를 알립니다.
 // 확인창(S8)을 거치지 않아 보내지 않은 체크히어 시간 삭제(결석 저장의 3초)도 알립니다.
 function stopped(r){const text=[r?.stopped?.length?`체크히어 반영을 기다리던 ${r.stopped.join(', ')} 학생은 반·날짜를 바꿔 멈췄습니다. 그 날로 돌아가 「체크히어 맞추기」로 보낼 수 있습니다.`:'',r?.unconfirmed?.length?`${r.unconfirmed.join(', ')} 학생의 체크히어 시간 삭제는 확인창을 거치지 않아 보내지 않았습니다. 그 날로 돌아가 「체크히어 맞추기」(×로 지운 것은 ×)로 다시 보내 주세요.`:''].filter(Boolean).join(' ');if(text)say(text,'warn');}
 // 직접 요청 줄의 저장된 추천값·요청 목록은 반·날짜마다 한 번 읽습니다(새로고침은 다시 읽음, 편집값은 같은 반·날짜면 남음).
 // 요청 목록은 그 뒤 구독으로 늘 최신입니다(watchRequests: 저장 3초 뒤 자동 요청도 바로 '승인 대기'로 잠겨 같은 칸에 중복 요청을 만들지 않음).
 async function loadProposals(){watchRequests();const k=`${cls}|${date}`;if(proposalsLoaded===k)return;proposalsLoaded=k;await proposals.load(cls,date);if(life.alive()&&proposalsLoaded===k)renderRows();}
 // 동기화 모듈과 같은 조회(그 반·그날 체크히어 요청)라 Firestore가 한 연결로 받습니다. 반·날짜가 바뀔 때만 새로 겁니다. 끊기면 읽은 목록으로 돌아가고
 // 다음 새로고침·반·날짜 때 다시 겁니다. 목록이 바뀌면 동기화 알림과 한 번에 다시 그립니다(changed).
 function watchRequests(){
  const c=cls,d=date,k=`${c}|${d}`;if(reqDay===k)return;reqDay=k;unwatchReq?.();unwatchReq=null;if(!d)return;
  unwatchReq=onSnapshot(query(collection(db,'checkhereRequests'),where('classId','==',c),where('date','==',d)),
   snap=>{if(life.alive()&&reqDay===k&&proposals.liveRequests(c,d,(snap?.docs||[]).map(x=>({id:x.id,...x.data()}))))changed(null);},
   ()=>{if(reqDay!==k)return;reqDay='';unwatchReq=null;proposals.liveRequests(c,d,null);});
 }

 // 입력 확인(beta2.gs b2Validate_와 같은 기준). 못 지나가면 '입력 필요: …'와 그 칸
 function missing(v,name=''){
  if(!B2_TYPES.includes(v.type))return {field:'type',text:'입력 필요: 유형'};
  if(name&&diseaseBlock(name,v))return {field:'reason',text:`질병 인정 한도(${DISEASE.max}회)를 넘습니다`};
  // 중복: 시트 b2Save와 같은 기준으로 저장 전에 막음(외출 짝·순서, 입실·퇴실·외출 가운데 둘 이상, beta2-core dupCheck)
  if(v.type===DUP_TYPE){const d=dupCheck(v);if(d)return d;}
  const need=requiredTimes(v.type);
  if(need.inT&&!v.inT)return {field:'inT',text:'입력 필요: 입실 시간'};
  if(need.outT&&!v.outT)return {field:'outT',text:'입력 필요: 퇴실 시간'};
  if(need.oa&&!v.oa)return {field:'oa',text:'입력 필요: 외출 시작 시간'};
  if(need.ob&&!v.ob)return {field:'ob',text:'입력 필요: 외출 종료 시간'};
  if(need.oa&&v.ob<=v.oa)return {field:'ob',text:'외출 종료가 시작보다 늦어야 합니다'};
  if(recognizedType(v.type)&&!String(v.reason||'').trim())return {field:'reason',text:'입력 필요: 사유'};
  if(evOf(v)==='반려'&&!evrOf(v))return {field:'evr',text:'반려 사유를 적어 주세요.'}; // 시트(b2Validate_)와 같은 글
  return null;
 }
 function focusField(name,field){const q=f=>bodies.get(name)?.querySelector(`[data-inline="${f}"]`),n=q(field)||(field==='reason'?q('rmain'):null);if(n&&!n.matches(':disabled')){painting=true;try{n.focus();}finally{painting=false;}}}
 // 초안 고치기(입력할 때마다, 저장하지 않음). 저장된 값과 같아지면 초안을 지웁니다. base는 처음 고칠 때의 행 지문을 지킵니다.
 // 입력 확인 안내가 붙은 행은 고칠 때마다 다시 확인해 안내를 바꾸거나 지웁니다(저장 실패·그사이 바뀜 안내는 다음 저장까지 남김).
 function setDraft(name,change){
  const row=rowOf(name);if(!row)return;
  const cur=drafts.get(name),next={...valuesOf(row),...change,base:cur?cur.base:(row.rec?.sig||'')};
  if(sameAs(next,saved(row))){drafts.delete(name);notes.delete(name);invalid.delete(name);return;}
  drafts.set(name,next);
  if(invalid.has(name)){const miss=missing(next,name);if(miss)notes.set(name,miss.text);else{notes.delete(name);invalid.delete(name);}}
 }
 // 사유 드롭다운: 분류를 고르면 첫 세부(인적성은 '인적성' → 종류 칸으로), 세부·종류를 고르면 '분류(세부)', 기타는 괄호 안에 직접 씁니다('인적성()' → 저장 때 빈 괄호는 지움).
 // 사유 드롭다운에서 고르기(초안만, 저장은 모아서): 표준 글은 그대로, 인적성은 옆 종류 칸으로, '기타'는 직접 입력 칸으로(표준 글이던 칸은 비움, 직접 쓴 글은 그대로).
 // 인적성 종류 기타는 '인적성()'로 두고 종류 직접 입력 칸에 씁니다(저장 때 빈 괄호는 지움).
 function pickReason(name,which,value){
  const row=rowOf(name);if(!row)return;const p=pickReasonText(valuesOf(row).reason,which,value);
  if(p.custom===true)customOpen.add(name);else if(p.custom===false)customOpen.delete(name);
  setDraft(name,{reason:p.text});paint(name,{force:true});paintBulk();
  focusField(name,p.focus);
 }
 // 증빙 드롭다운(초안만, 저장은 모아서): 반려면 옆에 반려 사유 칸을 열어 그 칸으로, 아니면 칸을 닫습니다(적어 둔 반려 사유는 초안에 남지만 반려가 아니면 저장하지 않음).
 function setEvidence(name,ev){setDraft(name,{ev});paint(name,{force:true});paintBulk();focusField(name,ev==='반려'?'evr':'ev');}
 // 직접 쓰는 동안 안내(취업박람회 추가 증빙 등)만 고칩니다(입력칸은 그대로).
 function syncPick(name){const row=rowOf(name),x=bodies.get(name)?.querySelector('[data-xnote]');if(row&&x)x.innerHTML=pickNote(row);}
 // 유형을 바꾸면 필요한 시간만 보이게 다시 그리고, 빈 시간은 체크히어 값으로 미리 채웁니다(저장은 모아서).
 function setType(name,type){
  const row=rowOf(name);if(!row)return;
  // 중복은 체크히어에서 실제 지각·조퇴·외출인 시간만 채웁니다(정시 입실까지 채우면 지각으로 셈).
  const t=type===DUP_TYPE?dupTimesFromRecord(matchFor(row),{date,cls}):timesFromRecord(matchFor(row)),need=neededTimes(type,ALL),d={...valuesOf(row),type};
  for(const k of TIMES)if(need[k]&&!d[k])d[k]=t[k]||'';
  if(type==='해당없음'){Object.assign(d,{reason:'',ev:'',evr:''});customOpen.delete(name);} // 해당없음(현황 없음): 사유·증빙 비움
  setDraft(name,d);paint(name,{force:true});paintBulk();
 }
 // 초안 버리기: 입력칸의 화면 값은 입력하며 그린 HTML과 달라졌으므로 그린 것을 잊어 다음 그리기 때 꼭 다시 그립니다(포커스가 있으면 focusout 때).
 function forget(name){drafts.delete(name);notes.delete(name);invalid.delete(name);drawn.delete(name);customOpen.delete(name);}
 // Esc·「취소」: 그 학생의 초안을 통째로 버리고 시트 값으로 되돌립니다.
 function revertRow(name){forget(name);paint(name,{force:true});paintBulk();}
 // Enter: 다음 학생의 같은 칸으로 옮깁니다(저장하지 않음). 그 칸이 없거나 잠긴 학생은 건너뜁니다.
 function nextRow(name,sel){
  const list=[...table.querySelectorAll('tbody[data-student]')];
  // 사유 직접 입력 칸은 '기타'일 때만 있으므로, 없는 학생은 그 학생의 사유 드롭다운으로 갑니다.
  for(const tb of list.slice(list.indexOf(bodies.get(name))+1)){const n=tb.querySelector(sel)||(sel==='[data-inline="reason"]'?tb.querySelector('[data-inline="rmain"]'):null);if(n&&!n.matches(':disabled')){n.focus();try{n.setSelectionRange(n.value.length,n.value.length);}catch{}return;}}
 }
 // 도구줄: 「변경 N건 저장」(모아 저장 중이면 '저장 중 3/7')·「모두 되돌리기」·끝난 뒤 요약
 function paintBulk(){
  const n=drafts.size,s=$('#b2SaveAll'),r=$('#b2RevertAll'),m=$('#b2BulkNote');if(!s)return;
  if(!n&&!bulk&&bulkNote.includes('확인 필요'))bulkNote=''; // 남은 행을 다 고치거나 되돌렸으면 지난 요약은 지움
  const text=bulk?`저장 중 ${bulk.done}/${bulk.total}`:`변경 ${n}건 저장`;if(s.textContent!==text)s.textContent=text;
  s.disabled=!!bulk||!n;r.disabled=!!bulk||!n;if(m.textContent!==bulkNote)m.textContent=bulkNote;
 }
 // 모아 저장 중 행 입력칸 잠금(fieldset). 그동안 다시 그리는 행은 bulk를 보고 잠긴 채로 그립니다.
 function lock(on){for(const f of table.querySelectorAll('fieldset.b2-inline'))f.disabled=on;}
 // 모아 저장(사용자 결정 2026-10-16): 초안을 화면 순서대로 확인하고(행마다 저장하던 때와 같은 입력 확인), 통과한 행만 한 행씩 차례로 저장합니다.
 // 행마다 저장 경로(충돌 확인 before·묶음 고침·상태 칩·체크히어 3초 afterSave)는 그대로입니다. 저장하는 동안 행 입력칸은 잠그고 도구줄에 '저장 중 3/7'을 보입니다.
 // 입력이 모자란 행·못 저장한 행은 초안과 이유를 남기고, 끝나면 '6건 저장 · 1건 확인 필요'로 알립니다.
 function saveAll(){
  if(bulk||switching||!life.alive()||!bundle)return bulkRun;
  const day=`${cls}|${date}`,todo=[],bad=[];
  for(const n of [...notes.keys()])if(!drafts.has(n)&&!jobs.has(n)){notes.delete(n);invalid.delete(n);paintMsg(n);} // 초안 없는 행의 지난 안내
  for(const row of rows){
   if(!drafts.has(row.name))continue;
   const v=valuesOf(row);
   if(sameAs(v,saved(row))){drafts.delete(row.name);notes.delete(row.name);invalid.delete(row.name);paintMsg(row.name);continue;}
   const miss=missing(v,row.name);
   if(miss){notes.set(row.name,miss.text);invalid.add(row.name);bad.push([row.name,miss.field]);}else{notes.delete(row.name);invalid.delete(row.name);todo.push(row.name);}
   paintMsg(row.name);
  }
  if(!todo.length){bulkNote=bad.length?`${bad.length}건 확인 필요`:'';paintBulk();if(bad.length)focusField(...bad[0]);return null;}
  // 잠그면 입력칸 포커스가 빠지므로 어느 학생·칸이었는지 기억했다가 끝나면 되살립니다(확인 필요 행이 있으면 그 칸 먼저).
  const was=document.activeElement,at=was?.closest?.('tbody[data-student]')?.dataset.student,sel=at&&focusSel(was);
  bulk={done:0,total:todo.length};lock(true);paintBulk();
  const run=(async()=>{
   let ok=0;
   // 쓰기 대기열이 켜져 있으면(client.queueOn, 첫 저장이 '접수'로 답한 뒤) 6행씩 함께 보냅니다: 대기열이 순서대로 한 번에 시트에 넣으므로 잠금 다툼이 없습니다. 아니면 예전처럼 한 행씩.
   const one=async n=>{if(!life.alive()||!sameDay(day))return false;bulk.done++;paintBulk();if(drafts.has(n)&&await saveRow(n)===true)ok++;return true;};
   try{let i=0;if(todo.length&&!client.queueOn?.())await one(todo[i++]);
    const width=client.queueOn?.()?6:1,lane=async()=>{while(i<todo.length){if(!await one(todo[i++]))return;}};
    await Promise.all(Array.from({length:Math.min(width,Math.max(1,todo.length-i))},lane));} // true = 실제로 저장함(그사이 초안이 없어졌으면 'none')
   catch(e){if(life.alive())say(e.message,'err');}
   finally{
    bulk=null;bulkRun=null;
    if(life.alive()){
     lock(false);const left=rows.filter(r=>drafts.has(r.name)).length;
     bulkNote=[ok?`${ok}건 저장`:'',left?`${left}건 확인 필요`:''].filter(Boolean).join(' · ');
     renderRows();if(ok)toast(`${md(date)} ${bulkNote}`);
     const a=document.activeElement;
     if(!a||a===document.body||a.id==='b2SaveAll'){if(bad.length)focusField(...bad[0]);else{const n=sel&&bodies.get(at)?.querySelector(sel);if(n&&!n.matches(':disabled'))n.focus();}}
    }
   }
  })();
  if(bulk)bulkRun=run;return run;
 }
 // 한 행 저장(모아 저장에서): 그 학생의 다른 저장(되돌리기)이 끝나기를 기다린 뒤 같은 저장 경로로 저장합니다.
 async function saveRow(name){while(jobs.has(name)){await jobs.get(name).done;if(!life.alive())return false;}return runJobs(name,'inline');}
 // 학생마다 저장은 한 번에 하나. 저장 중에 또 저장하면 마지막 것만 대기시켰다가 이어서 저장합니다.
 // 처음 저장의 결과를 돌려줍니다(true 저장함, 'none' 저장할 것 없음, false 못 함).
 function queueSave(name,kind){const j=jobs.get(name);if(j){j.next=kind;paintMsg(name);return;}void runJobs(name,kind);}
 async function runJobs(name,kind){
  let end,first;const j={next:null,done:new Promise(r=>{end=r;})},day=`${cls}|${date}`;jobs.set(name,j);paintMsg(name);
  try{while(kind&&life.alive()&&sameDay(day)){const ok=await saveOnce(name,kind);first??=ok;kind=ok?j.next:null;j.next=null;}}
  catch(e){first??=false;if(life.alive())say(e.message,'err');}
  finally{if(jobs.get(name)===j)jobs.delete(name);waiting.delete(name);if(life.alive()&&sameDay(day))paint(name);end();}
  return first??false;
 }
 async function saveOnce(name,kind){
  const key=keyOf(name),day=`${cls}|${date}`;
  if(kind==='undo'){
   // S9: 3초 안 되돌리기는 요청을 보내지 않고 출결원장도 저장 전 값으로 되돌립니다(동기화 모듈이 client.save를 부름).
   const r=await sync.undo(key);if(r.row&&r.res)saveGen++;if(!life.alive()||!sameDay(day))return false;
   if(r.error?.code==='CONFLICT')await load({fresh:true,keepCheckHere:true});
   if(r.ok&&r.row){if(!r.res?.unchanged&&ledgerAt(cls,date,name)?.sig!==r.res?.sig)try{bundle=await client.bundle(cls);}catch{}toast(`${name} · ${md(date)} 체크히어 반영을 취소하고 출결원장을 ${r.row.type}(으)로 되돌렸습니다.`);}
   else if(r.ok&&r.kept)toast(`${name} · ${md(date)} 체크히어 반영을 취소했습니다. 이전 값은 출결원장에 다시 저장할 수 없어 그대로 둡니다.`);
   else if(!r.ok&&r.reason){notes.set(name,`되돌리지 못함 · ${r.reason}`);paintMsg(name);}
   if(!life.alive()||!sameDay(day))return false;
   rows=dayView(bundle,cls,date);renderRows();return !!r.ok;
  }
  const row=rowOf(name);if(!row)return false;
  const rec=row.rec,d0=drafts.get(name);
  if(!d0)return 'none';
  const v=valuesOf(row);if(sameAs(v,saved(row))){drafts.delete(name);return 'none';}
  const miss=missing(v,name);if(miss){notes.set(name,miss.text);invalid.add(name);paintMsg(name);return false;}
  // before: 처음 고칠 때의 지문(그사이 바뀐 행은 서버가 CONFLICT로 거절). 증빙·반려 사유도 초안 값(고치지 않았으면 저장된 값, 출석이면 비움)
  const payload={cls,name,date,type:v.type,...neededTimes(v.type,v),reason:tidyReason(v.reason),ev:evOf(v),evr:evrOf(v),before:d0.base??(rec?.sig||'')};
  const prevRow=rec?pick(rec):null;
  sync.saveStarted(key);notes.delete(name);invalid.delete(name);paintMsg(name);
  let res;
  try{res=await client.save(payload,{onQueued:()=>{waiting.add(name);if(life.alive())paintMsg(name);}});saveGen++;}
  catch(e){
   sync.saveFailed(key,e);if(!life.alive()||!sameDay(day))return false;
   if(e.code==='CONFLICT'){
    // 그사이 바뀜: 초안은 남기고 최신 값을 불러와 안내에 보입니다(체크히어 반영 대기는 saveFailed가 버림). 초안의 기준 지문을 최신으로 옮겨
    // 다시 저장하면 이 초안으로 덮어씁니다(Esc·「취소」는 최신 값). 초안이 최신 값과 같아졌으면 load가 이미 지웠습니다.
    // 최신 값을 못 읽었으면(묶음 읽기 실패) 기준 지문을 옮기지 않고 옛 값을 최신이라 보이지 않습니다(다음 저장이 다시 거절되고 다시 읽음).
    const fresh=await load({fresh:true,keepCheckHere:true});if(!life.alive()||!sameDay(day))return false;
    const now=rowOf(name),d=drafts.get(name);
    if(!fresh)notes.set(name,'그사이 바뀜 · 저장 안 됨 · 최신 값을 읽지 못했습니다 · 잠시 뒤 다시 저장해 주세요');
    else if(now&&d){drafts.set(name,{...d,base:now.rec?.sig||''});notes.set(name,`그사이 바뀜 · 저장 안 됨 · 시트 최신 값 ${brief(saved(now))} · 다시 저장하면 이 값으로 덮어씁니다`);}
    else notes.set(name,'그사이 바뀜 · 최신 값 표시');
    paint(name,{force:true});
   }else{notes.set(name,sheetWait(e.message,v.type));paintMsg(name);}
   return false;
  }
  // S5: 다음 before는 res.sig, unchanged면 지금 sig(기록 없으면 ''). 결과는 먼저 동기화 모듈에 알립니다('저장 중'으로 멈춘 보류가 남지 않게).
  const sig=res.unchanged?(rec?.sig||''):String(res.sig||'');
  // 취업박람회 인정 출결로 새로 저장되면(이미 확인된 것 빼고) 반 담임·관리자에게 '추가 증빙' 알림(기업면접 확인서). 알림을 못 남겨도 저장은 그대로(notify가 작은 안내).
  if(extraEvidenceStarted(prevRow,payload))void notify('추가 증빙',{audience:'admins',toClass:cls,cls,...extraNotice({cls,name,date,type:payload.type}),link:linkFor('b2ledger',{cls,date})});
  sync.afterSave(key,{prevRow,row:{type:payload.type,inT:payload.inT,outT:payload.outT,oa:payload.oa,ob:payload.ob,reason:payload.reason,ev:payload.ev,evr:payload.evr},sig,existedBefore:!!rec,unchanged:!!res.unchanged});
  if(!life.alive()||!sameDay(day))return false;
  // client.save가 들고 있는 묶음을 고칩니다. 캐시가 바뀌어 이 화면의 묶음이 고쳐지지 않았으면 캐시본으로 바꿉니다(통째로 다시 읽지 않음).
  // 그래도 지문이 다르면 보내기 직전 확인(S3)이 '시트가 그사이 바뀜'으로 멈춥니다.
  if(!res.unchanged&&ledgerAt(cls,date,name)?.sig!==sig){try{bundle=await client.bundle(cls);}catch{}if(!life.alive()||!sameDay(day))return false;}
  rows=dayView(bundle,cls,date);
  // 저장한 초안은 지웁니다. 저장하는 동안 바뀐 초안은 남기고 기준 지문만 새로(내가 바꾼 것이라 '그사이 바뀜'이 아님).
  const d=drafts.get(name);
  if(d&&d===d0){drafts.delete(name);customOpen.delete(name);}
  else if(d&&d.base===(rec?.sig||''))drafts.set(name,{...d,base:sig});
  if(!bulk)toast(`${name} · ${md(date)} ${payload.type} 저장했습니다.`); // 모아 저장은 끝난 뒤 요약 하나
  if((res.offDay||res.future)&&res.notice)say(res.notice); // 교육일이 아닌 날·아직 오지 않은 날 저장 안내(시트가 붙임, 막지 않음 · 2026-10-20)
  renderRows();
  return true;
 }
 async function act(name,action){
  const key=keyOf(name);
  // 되돌리기는 그 학생의 아직 저장하지 않은 입력도 버립니다(되돌린 뒤 그 초안이 다시 저장되지 않게).
  if(action==='undo'){forget(name);paintBulk();return queueSave(name,'undo');}
  if(action==='withdraw'){try{if(!await sync.withdraw(key))say('취소할 승인 대기 요청이 없습니다.','warn');}catch(e){say(e.message,'err');}return;}
  if(action==='retry')sync.retry(key);else if(action==='suggest')sync.suggest(key);
  paintStatus(name);
 }

 // 입력할 때마다 초안만 고칩니다(저장은 「변경 N건 저장」·Ctrl+S). 저장 전 표시·도구줄 건수는 다시 그리지 않고 고칩니다.
 host.addEventListener('input',e=>{
  const t=e.target,k=t.dataset?.inline,name=t.closest?.('tbody[data-student]')?.dataset.student;
  if(t.hasAttribute?.('data-memo-input')){memoUi.text=t.value;return;} // 메모 직접 입력은 초안이 아님
  if(t.hasAttribute?.('data-daymemo-input')){dayUi.text=t.value;paintDayTyping();return;} // 공통메모 글(출결 초안과 따로)
  if(k==='rmain'||k==='rsub'||k==='ev')return; // 드롭다운은 change에서
  if(k==='rapt'&&name){if(bulk)return;setDraft(name,{reason:kindInputText(t.dataset.kind,t.value)});syncPick(name);paintMsg(name);paintBulk();return;} // 인적성·자격증 종류 직접 입력
  if(k&&k!=='type'&&name){if(bulk)return;setDraft(name,{[k]:t.value});if(k==='reason'){customOpen.add(name);t.title=t.value;syncPick(name);}if(TIMES.includes(k))syncPick(name);if(k==='evr')t.title=t.value||'반려 사유 (필수)';paintMsg(name);paintBulk();return;}
 });
 host.addEventListener('change',e=>{
  const t=e.target,name=t.closest?.('tbody[data-student]')?.dataset.student;
  if(t.dataset?.inline==='type'&&name){if(!bulk)setType(name,t.value);return;}
  if((t.dataset?.inline==='rmain'||t.dataset?.inline==='rsub')&&name){if(!bulk)pickReason(name,t.dataset.inline,t.value);return;}
  if(t.dataset?.inline==='ev'&&name){if(!bulk)setEvidence(name,t.value);}
 });
 // Enter는 다음 학생 같은 칸(저장 안 함), Esc는 그 행 초안 되돌림. Ctrl+S는 문서 전체에서 받습니다(아래 onKey).
 // 직접 요청 줄의 칸도 Enter는 다음 학생 같은 칸입니다(한 줄 사유 칸의 줄바꿈은 요청 모듈이 막음, 모아 저장 중에도 됨).
 host.addEventListener('keydown',e=>{
  const t=e.target,k=t.dataset?.inline,p=t.dataset?.proposalEdit,name=t.closest?.('tbody[data-student]')?.dataset.student;if(!(k||p)||!name||e.isComposing||e.keyCode===229)return;
  if(p){if(e.key==='Enter'){e.preventDefault();nextRow(name,`[data-proposal-edit$="${p.slice(p.lastIndexOf('__'))}"]${t.dataset.time?`[data-time="${t.dataset.time}"]`:''}`);}return;}
  if(bulk)return;
  if(e.key==='Enter'){e.preventDefault();nextRow(name,`[data-inline="${k}"]`);}
  else if(e.key==='Escape'){e.preventDefault();revertRow(name);}
 });
 // 메모 직접 입력: Enter 저장, Esc 닫기(한글 입력 중에는 그대로)
 host.addEventListener('keydown',e=>{
  const t=e.target,name=t.closest?.('tbody[data-student]')?.dataset.student;if(!t.matches?.('[data-memo-input]')||!name||e.isComposing||e.keyCode===229)return;
  if(e.key==='Enter'){e.preventDefault();if(memoUi.text.trim())void saveMemo(name,memoUi.text);else{memoUi.err='메모를 적어 주세요. 지우려면 「메모 지우기」를 누릅니다.';paintMemo(name);}}
  else if(e.key==='Escape'){e.preventDefault();openMemo(name);}
 });
 // 공통메모 칸: Esc 닫기(고친 글이 있으면 물음, 한글 입력 중에는 그대로). Ctrl+S는 아래 onKey가 공통메모 저장으로 받습니다.
 host.addEventListener('keydown',e=>{if(e.key==='Escape'&&e.target.matches?.('[data-daymemo-input]')&&!e.isComposing&&e.keyCode!==229){e.preventDefault();toggleDayMemo(false);}});
 // 포커스 때문에 미뤄 둔 행 다시 그리기(칸을 벗어나도 저장하지 않음)
 host.addEventListener('focusout',e=>{
  if(painting)return;
  const tb=e.target.closest?.('tbody[data-student]');if(!tb)return;const name=tb.dataset.student;
  if(!tb.contains(e.relatedTarget))setTimeout(()=>{if(life.alive()&&stale.has(name)&&!typing(tb))paint(name);},0);
 });
 // 손댄 학생은 필터에서 빠져도 남깁니다(pinned). 「되돌리기」는 누르는 순간(pointerdown) 처리합니다: 누르는 사이 칩이 바뀌거나
 // 같은 행이 다시 그려져도 되돌리기가 조용히 사라지지 않게(키보드 Enter·Space는 click으로).
 host.addEventListener('focusin',e=>{const name=e.target.closest?.('tbody[data-student]')?.dataset.student;if(name)pinned.add(name);});
 host.addEventListener('pointerdown',e=>{
  const t=e.target.closest?.('button'),name=t?.closest('tbody[data-student]')?.dataset.student;if(!name)return;pinned.add(name);
  if(e.button===0&&t.dataset.act==='undo'&&!t.disabled)void act(name,'undo');
 });
 host.addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t||!host.contains(t))return;
  if(t.dataset.filter){filter=t.dataset.filter;pinned.clear();renderRows();return;}
  // 공통메모(모아 저장 중에도 됨, 출결 초안과 따로): 열기·닫기, 빠른 문구(글 끝에 덧붙임), 저장·지우기, 다시 읽기
  if(t.hasAttribute('data-daymemo-toggle')){toggleDayMemo();return;}
  if(t.hasAttribute('data-daymemo-close')){toggleDayMemo(false);return;}
  if(t.dataset.daymemoPick){pickDayMemo(t.dataset.daymemoPick);return;}
  if(t.hasAttribute('data-daymemo-save')){void saveDayMemo();return;}
  if(t.hasAttribute('data-daymemo-clear')){if(confirm(`${cls}반 ${md(date)} 공통메모를 지울까요?`))void saveDayMemo(true);return;}
  if(t.hasAttribute('data-daymemo-retry')){void loadDayMemos({force:true});return;}
  const name=t.closest('tbody[data-student]')?.dataset.student,row=name?rowOf(name):null;if(!row)return;
  // 출결대조 메모(모아 저장 중에도 됨, 출결 초안과 따로): 열기·닫기, 빠른 칩, 직접 입력, 지우기
  if(t.hasAttribute('data-memo-toggle')||t.hasAttribute('data-memo-close')){openMemo(name);return;}
  if(t.dataset.memoPick){
   // 직접 입력 칸이 열려 있으면 칩 글을 칸에 덧붙입니다(' · '로, 이미 있으면 그대로, 100자를 넘으면 붙이지 않음). 아니면 바로 그 글로 저장.
   if(memoUi.custom&&memoUi.open===name){
    const add=t.dataset.memoPick,cur=memoUi.text.trim(),next=!cur?add:cur.split(/\s*·\s*/).includes(add)?cur:`${cur} · ${add}`;
    if(next.length>MEMO_MAX)memoUi.err=`${MEMO_MAX}자를 넘어 덧붙이지 않았습니다.`;else{memoUi.text=next;memoUi.err='';}
    paintMemo(name);const i=bodies.get(name)?.querySelector('[data-memo-input]');if(i){i.focus();try{i.setSelectionRange(i.value.length,i.value.length);}catch{}}return;
   }
   void saveMemo(name,t.dataset.memoPick);return;
  }
  if(t.hasAttribute('data-memo-custom')){memoUi.custom=!memoUi.custom;memoUi.text=memoUi.custom?memoOf(name)?.memo||'':'';memoUi.err='';paintMemo(name);if(memoUi.custom)bodies.get(name)?.querySelector('[data-memo-input]')?.focus();return;}
  if(t.hasAttribute('data-memo-save')){if(memoUi.text.trim())void saveMemo(name,memoUi.text);else{memoUi.err='메모를 적어 주세요. 지우려면 「메모 지우기」를 누릅니다.';paintMemo(name);}return;}
  if(t.hasAttribute('data-memo-clear')){void saveMemo(name,'');return;}
  if(t.hasAttribute('data-inline-cancel')){if(!bulk)revertRow(name);return;} // 모아 저장 중에는 초안을 그대로 둠(Esc도 같음)
  if(t.dataset.hint){setDraft(name,{reason:t.dataset.hint});paint(name,{force:true});paintBulk();focusField(name,'reason');return;}
  if(t.dataset.act==='undo'&&e.detail!==0)return; // 마우스·터치는 pointerdown에서 이미 처리
  if(t.dataset.act){await act(name,t.dataset.act);return;}
  if(t.dataset.chDel){
   // 확인창(지울 시간, 실제 입실 기록은 남음)은 sync.send가 띄웁니다. 못 지우면 이유를 알립니다(확인창에서 '아니오'면 조용히 끝).
   const r=await sync.send(keyOf(name),{deleteTimes:[t.dataset.chDel]});if(!r.ok&&r.reasons?.length)say(`${name}: ${r.reasons.join(' · ')}`,'warn');paintStatus(name);return;
  }
 });
 // 반·날짜 바꾸기: 저장 중이면(모아 저장 포함) 끝나기를 기다리고(거절하지 않음), 저장하지 않은 것은 확인하고(바꾸면 사라짐),
 // 체크히어 반영 대기는 화면 값을 바꾸기 전에 sync.setDay가 확인합니다(S10). 바꾸는 동안 표는 잠급니다(inert).
 // 저장하지 않은 것(확인창 글): 출결 초안(증빙 포함), 체크히어 직접 요청 편집값(proposals.hasEdits, 1기 canNavigate와 같은 생각)
 const unsaved=()=>{const p=[drafts.size?`출결 수정 ${drafts.size}건`:'',proposals.hasEdits()?'체크히어 직접 요청 편집값':'',dayDirty()?'공통메모 글':''].filter(Boolean);return p.length?`저장하지 않은 ${p.join(' · ')}이 있습니다.`:'';};
 async function leaving(what){
  if(proposals.isWorking()){say('체크히어 직접 요청을 보내는 중입니다. 끝난 뒤 바꿔 주세요.','warn');return false;} // 1기 canNavigate처럼
  if(jobs.size||bulk){say('출결원장 저장이 끝나면 바꿉니다…');await Promise.allSettled([bulkRun,...[...jobs.values()].map(j=>j.done)]);if(!life.alive())return false;say('');}
  const u=unsaved();return !u||confirm(`${u} ${what} 바꾸면 사라집니다. 바꿀까요?`);
 }
 // 모두 되돌리기·새로고침(확인 뒤): 출결 초안만 버립니다(같은 반·날짜라 직접 요청 편집값은 남음).
 function discard(){for(const n of [...drafts.keys()])forget(n);customOpen.clear();notes.clear();invalid.clear();bulkNote='';paintBulk();}
 function clearEdits(){discard();pinned.clear();Object.assign(memoUi,{open:'',custom:false,text:'',err:''});Object.assign(dayUi,{open:false,text:'',base:'',err:'',conflict:null,day:''});}
 const dropDrafts=what=>!drafts.size||(confirm(`저장하지 않은 출결 수정 ${drafts.size}건이 있습니다. ${what} 사라집니다. 계속할까요?`)&&(discard(),true));
 async function switchTo(sel,run){
  if(switching){sel.value=sel===$('#b2Class')?cls:date;return;}
  switching=true;table.inert=true;
  try{await run();}finally{switching=false;table.inert=false;if(life.alive()){$('#b2Class').value=cls;$('#b2Date').value=date;$('#b2DateAny').value=date;}}
 }
 $('#b2Class').onchange=e=>switchTo(e.target,async()=>{const next=e.target.value;if(await leaving('반을'))await load({to:next});});
 // 날짜 바꾸기(목록·날짜 칸 공통). 날짜 목록·안내를 새 날에 맞추고, 메모는 기간이 넓어졌을 때만 다시 읽습니다.
 const goDate=(sel,next)=>switchTo(sel,async()=>{
  if(!await leaving('날짜를'))return;
  const r=await sync.setDay(cls,next);if(!life.alive())return;
  date=next;clearEdits();dateOptions();$('#b2DateAny').hidden=!offDay(date)&&!futureDay(date);rows=dayView(bundle,cls,date);paintDayMemo();void loadCheckHere();void loadProposals();void loadMemos();stopped(r);
 });
 // 「다른 날짜…」: 목록은 지금 날짜로 되돌리고 옆 날짜 칸을 엽니다(달력이 되면 바로 띄움).
 $('#b2Date').onchange=e=>{
  const v=e.target.value;
  if(v===ANY_DAY){e.target.value=date;const a=$('#b2DateAny');a.hidden=false;a.value=date;a.focus();try{a.showPicker?.();}catch{}return;}
  void goDate(e.target,v);
 };
 // 날짜 칸: 아무 날(미래·교육일 아닌 날도, 작은 안내만). 키보드로 연·일을 치는 동안 중간 값마다 바꾸지 않게 잠깐(0.5초) 기다렸다가 바꿉니다.
 let anyTimer=0;
 $('#b2DateAny').onchange=e=>{
  clearTimeout(anyTimer);const el=e.target;
  anyTimer=setTimeout(function commit(){
   const v=el.value;if(!life.alive()||!v||v===date||!canPick(bundle,v))return;
   if(switching){anyTimer=setTimeout(commit,300);return;}
   say('');void goDate(el,v);
  },500);
 };
 life.on(()=>clearTimeout(anyTimer));
 $('#b2Search').oninput=e=>{search=e.target.value;pinned.clear();renderRows();};
 // 새로고침: 저장 중이면 하지 않고, 출결 초안이 있으면 확인한 뒤 버립니다. 새로고침은 직접 요청 목록도 다시 읽습니다.
 $('#b2Reload').onclick=()=>{if(switching||bulk)return;if(jobs.size)return say('저장 중이라 새로 읽지 않았습니다. 저장이 끝난 뒤 다시 눌러 주세요.','warn');if(!dropDrafts('새로 읽으면'))return;proposalsLoaded='';void load({fresh:true});};
 $('#b2SaveAll').onclick=()=>void saveAll();
 $('#b2RevertAll').onclick=()=>{if(bulk||!drafts.size||!confirm(`저장하지 않은 출결 수정 ${drafts.size}건을 모두 되돌릴까요?`))return;discard();renderRows();};
 // Ctrl+S: 모아 저장(브라우저 '페이지 저장' 대신). 한글 입력 상태에서도 되게 키 위치(code)로 봅니다. 직접 요청 대화상자가 열려 있으면 그대로 둡니다.
 const onKey=e=>{if(!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey||(e.code!=='KeyS'&&e.key?.toLowerCase()!=='s')||!life.alive()||host.querySelector('dialog[open]'))return;e.preventDefault();if(document.activeElement?.matches?.('[data-daymemo-input]')&&host.contains(document.activeElement))void saveDayMemo();else void saveAll();}; // 공통메모 칸에서는 공통메모 저장
 document.addEventListener('keydown',onKey);
 // 시트 변경 번호가 바뀌면 다시 읽습니다. 초안은 그대로 두고(값은 초안에서) 그 밑의 행이 바뀌었으면 '그사이 바뀜'으로 보입니다.
 // 반·날짜를 바꾸는 중·저장 중(모아 저장 포함)·행 입력칸 포커스면 이번에는 건너뜁니다(다음 확인 때 다시).
 const stopWatch=client.watch(async()=>{
  const a=document.activeElement,focused=!!a&&host.contains(a)&&a.matches('input,select,textarea')&&!a.closest('.b2-toolbar');
  if(!life.alive()||switching||bulk||jobs.size||focused)return;
  await load({fresh:true,keepCheckHere:true});
 },{current:()=>bundle?.rev||0});
 const warn=e=>{if(jobs.size||bulk||unsaved()||sync.holds().length){e.preventDefault();e.returnValue='';}};
 addEventListener('beforeunload',warn);
 // 중계 신호 'n분 전'과 반영 대기 90초·반영 중 3분 안내는 30초마다 다시 봅니다(초 단위 남은 시간은 동기화 모듈이 보류가 있을 때만 알림).
 // × title의 '반영할 때 해제 필요'는 해제 남은 시간이 줄거나 중계 신호가 3분 지나면 시계만으로도 바뀌므로, 바뀌면 행을 다시 그려 ×를 맞춥니다(삭제 조건·v2는 신호가 올 때 다시 그림).
 const gateMark=()=>{const g=sync.gate();return `${g.enabled}|${!!g.v2}|${needsUnmaskOnApply(sync.relay().privacy)}`;};
 let gateOn=gateMark();
 const clock=setInterval(()=>{if(!life.alive())return;paintRelay();const g=gateMark();if(g!==gateOn){gateOn=g;return renderRows();}for(const name of bodies.keys())paintStatus(name);},30000);
 life.on(()=>unwatch?.());life.on(()=>unwatchReq?.());life.on(stopWatch);life.on(()=>removeEventListener('beforeunload',warn));life.on(()=>document.removeEventListener('keydown',onKey));life.on(()=>clearInterval(clock));
 await load();
 return {
  // S15: 저장 중이면(모아 저장 포함) 막고, 저장하지 않은 것(초안(증빙 포함)·직접 요청 편집값)은 확인하고, 체크히어 반영 대기는 확인 후 지금 보냅니다(보내기가 끝난 뒤 동기화 모듈을 닫음).
  // 진행 중 요청·기록을 기다리는 보류는 보낼 수 없어 멈춘다는 것을 따로 셉니다. 보내기를 시작하면 구독은 바로 끊습니다(leave).
  canLeave(){
   if(jobs.size||bulk){say('출결원장 저장 중입니다. 저장이 끝난 뒤 이동해 주세요.','warn');return false;}
   if(proposals.isWorking()){say('체크히어 직접 요청을 보내는 중입니다. 끝난 뒤 이동해 주세요.','warn');return false;}
   const u=unsaved();if(u&&!confirm(`${u} 화면을 떠날까요?`))return false;
   // 확인창(S8)을 거치지 않은 시간 삭제는 떠나면서 보내지 않으므로 따로 셉니다.
   const hs=sync.holds(),asks=hs.filter(h=>h.needsConfirm).length,ready=hs.filter(h=>h.sendable).length-asks,waiting=hs.filter(h=>h.phase==='waiting').length;
   const stop=[waiting?`진행 중 요청·기록을 기다리는 체크히어 반영 ${waiting}건은 보내지 못하고 멈춥니다(돌아와서 「체크히어 맞추기」로 보낼 수 있음).`:'',asks?`확인창을 거치지 않은 체크히어 시간 삭제 ${asks}건은 보내지 않고 멈춥니다(돌아와서 다시 보내 주세요).`:''].filter(Boolean).join('\n');
   if(ready&&!confirm(`체크히어 반영 대기 ${ready}건이 있습니다. 지금 보내고 화면을 떠날까요?${stop?'\n'+stop:''}`))return false;
   if(!ready&&stop&&!confirm(`${stop}\n화면을 떠날까요?`))return false;
   if(hs.length)flushing=sync.flushAll({leave:true}).catch(()=>null);
   return true;
  },
  dispose(){life.dispose();if(flushing)void flushing.finally(()=>sync.dispose());else sync.dispose();}
 };
}
