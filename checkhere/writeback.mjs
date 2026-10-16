import {editable,version} from './identity.mjs';
import {assertChangeAllowed,normalizeTime,timeDeleteRefusal,DELETE_ORDER} from './rules.mjs';
import {requestMatchesRecord,prepareApproval,cleanRequest,memoDefaultTimes,deletedNote} from './approval-core.mjs';
export function confirmAlreadyApplied(request,record,current,identities=[]){
  if(!current||current.id!==record.id||current.studentKey!==record.studentKey||!record.studentKey||!requestMatchesRecord(request,current,identities))return false;
  return true;
}
// 빈 시간: null·''·'-' 모두. 읽을 수 없는 값은 빈 것으로 보지 않습니다.
const blank=v=>{try{return !normalizeTime(v);}catch{return false;}};
// 비교용 시간: 빈 값은 null, 읽을 수 없는 값은 NaN(어떤 값과도 같지 않음).
const time=v=>{try{return normalizeTime(v);}catch{return NaN;}};
const SIDES={entry:['entry','entry','entryMemo'],exit:['exit','exit','exitMemo']};
// 덜 지워진 칸(종류·시간만, 이름·번호 없음): '1교시 18:00:00(PASS) · 퇴실 18:00:00'
const leftOf=r=>[!blank(r?.entry)?`1교시 ${time(r.entry)||r.entry}${r.entryKind?`(${r.entryKind})`:''}`:'',!blank(r?.exit)?`퇴실 ${time(r.exit)||r.exit}`:''].filter(Boolean).join(' · ');
// 빈 시간은 요청 경로에서 원래 비어 있던 쪽이거나 승인된 시간 삭제(deletions)일 때만 허용합니다.
export function validateProposal(record,input,{requested=false,deletions=[]}={}){
  if(input.version!==record.version)throw new Error('검수 화면이 오래되었습니다. 다시 조회해 주세요.');
  if(typeof input.reason!=='string'||!input.reason.trim())throw new Error('수정 근거를 입력해 주세요.');
  const next={};for(const k of ['entry','exit']){next[k]=normalizeTime(input[k]);if(!next[k]&&!(requested&&(!normalizeTime(record[k])||deletions.includes(k))))throw new Error(requested?'요청하지 않은 시간 삭제입니다.':'시간을 비우는 변경은 지원하지 않습니다.');}
  if(next.entry&&next.exit&&next.exit<next.entry)throw new Error('퇴실이 입실보다 빠릅니다.');
  for(const k of ['entryMemo','exitMemo']){if(typeof input[k]!=='string'||input[k].length>500)throw new Error('메모는 500자 이내로 입력해 주세요.');next[k]=input[k];}
  const changes=Object.fromEntries(Object.entries(next).filter(([k,v])=>v!==(k==='entry'||k==='exit'?normalizeTime(record[k]):record[k])));
  if(!Object.keys(changes).length)throw new Error('변경한 값이 없습니다.');
  // 이미 빈 쪽의 삭제는 바뀌는 것이 없으므로 검사에서 뺍니다(다시 시도해도 안전).
  assertChangeAllowed(record,changes,{requested,deletions:deletions.filter(k=>Object.hasOwn(changes,k))});return next;
}
// Each field is a separate CheckHere transaction; never report atomic success.
// writer: 입력 단계만 바꿉니다. 없으면 수정창, {kind:'request',format}이면 순차 요청(collector.requestWrite). 읽기·재확인·결과 판단·삭제 순서는 같습니다.
// 가림 확인(K4): 첫 읽기 뒤 adapter.writeBlocked, 칸마다 쓰기 직전 adapter.write 안에서 머리말을 다시 읽어 막습니다(MASKED_*, 아무것도 누르지 않음).
export async function applyVerified(adapter,record,input,journal,request=null,identities=[],{writer=null}={}){
  const results=[];
  let current=await adapter.read(record);
  if(current.id!==record.id||current.studentKey!==record.studentKey||String(current.classId)!==String(record.classId)||current.date!==record.date)return{status:'conflict',message:'다른 학생 또는 날짜가 열려 중단했습니다. 다시 수집해 주세요.',results};
  if(request&&confirmAlreadyApplied(request,record,current,identities))return{status:'verified',alreadyApplied:true,message:'이미 반영 · 체크히어 원본에서 요청값을 확인했습니다.',results,current};
  // 잡은 뒤 화면이 다시 가려졌으면(해제 시간 끝남 등) 아무것도 누르지 않고 끝냅니다(연결 프로그램이 잡기 전에도 같은 확인을 합니다).
  const blocked=adapter.writeBlocked?.(current);if(blocked)return{status:'failed',message:`${blocked} · 체크히어에 아무것도 쓰지 않았습니다.`,results,current};
  const clean=request?cleanRequest(request):null,requested=clean?clean.changes:null,deletions=clean?.deleteTimes||[];
  // 시간 삭제: 아직 시간이 있는 쪽은 쓰기 전에 봅니다. 승인 때 본 시간(approval.before)과 같아야 하고(승인 뒤 바뀐 시간은 지우지 않음,
  // 반영이 미뤄졌다 다시 시도될 때), 지금 기록에 기록 번호 표시가 있어야 합니다. 아니면 아무것도 누르지 않고 끝냅니다.
  // 같은 요청이 퇴실도 지우면(두 칸 삭제) 퇴실이 남은 1교시도 받습니다(퇴실을 먼저 지운 뒤 1교시, 아래 순서).
  for(const k of deletions){
    if(blank(current[k]))continue;
    if(time(current[k])!==time(request.approval?.before?.[k]))return{status:'conflict',message:'승인 뒤 체크히어 시간이 바뀌어 지우지 않았습니다. 지금 값을 확인하고 다시 요청해 주세요.',results,current};
    const why=timeDeleteRefusal(current,k,{withExit:deletions.includes('exit')});if(why)return{status:'conflict',message:why,results,current};
  }
  const defaultTimes=requested?memoDefaultTimes(requested,current):{};
  const next=request?validateProposal(current,{...current,...prepareApproval(request,current,{identities}).after,reason:input.reason,version:current.version},{requested:true,deletions}):validateProposal(record,input);
  if(current.readState!=='complete'||(!request&&version(current)!==record.version))return{status:'conflict',message:'체크히어 값이 바뀌었습니다. 다시 수집한 뒤 검토해 주세요.',results,current};
  // 시간 삭제는 퇴실 먼저(DELETE_ORDER, 2026-10-16 확인): 퇴실이 남은 채 1교시를 지우면 체크히어가 퇴실 시간으로 입실·1교시를 다시 채웁니다.
  // 두 칸 삭제: 퇴실 삭제 → 다시 읽기 → 1교시가 아직 번호 있는 관리자 기록(ATTEND)이면 다시 읽은 기록으로 지움(기록 번호는 쓰는 쪽이 그 읽기에서 가져옴) → 다시 읽어 두 칸 확인.
  // 덜 지워지면 'partial'(덜 지워짐: 남은 종류·시간만, 이름 없음). 수정창·순차 요청 모두 이 순서를 씁니다(adapter.write는 칸 하나씩).
  const twoCell=deletions.includes('entry')&&deletions.includes('exit'),entryAtStart=current.entry,rawAtStart=current.rawEntry??null;
  // 체크인한 학생(PASS)의 퇴실 삭제(/beta2 결석 v2의 ['exit']): 체크히어가 계산된 1교시도 함께 비워야(Cowork 확인) 두 칸이 깨끗합니다. 1교시를 건드리는 요청이 아니면 끝에 1교시도 빈 것을 봅니다.
  const passWithExit=!twoCell&&deletions.includes('exit')&&current.entryKind==='PASS'&&!blank(current.entry)&&!blank(current.exit)&&!(requested&&(Object.hasOwn(requested,'entry')||Object.hasOwn(requested,'entryMemo')));
  const leftover=(cur,why)=>({status:'partial',message:`덜 지워짐: ${leftOf(cur)||'두 칸 확인 필요'} 남음${why?` · ${why}`:''}. 체크히어 원본을 확인해 주세요.`,results,current:cur});
  for(const name of deletions.length?DELETE_ORDER:['entry','exit']){
    const [field,timeKey,memoKey]=SIDES[name];
    if(requested&&!Object.hasOwn(requested,timeKey)&&!Object.hasOwn(requested,memoKey))continue;
    const deleting=deletions.includes(timeKey);
    if(deleting&&twoCell&&field==='entry'&&results.some(r=>r.field==='exit'&&r.deleted)){
      // 퇴실과 함께 1교시가 비었으면(체크인한 학생의 PASS) 지운 것으로 적습니다(누르지 않음).
      if(blank(current.entry)){if(!blank(entryAtStart)){const out={field,state:'verified',error:null,deleted:true,withExit:true,rawEntryBefore:rawAtStart,rawEntryAfter:current.rawEntry??null};results.push(out);await journal(out);}continue;}
      // 다시 읽은 1교시: 승인 때 본 시간이고, 번호 있는 관리자 기록이며, 퇴실이 비었을 때만 지웁니다.
      const why=time(current.entry)!==time(request.approval?.before?.entry)?'승인 뒤 1교시 시간이 바뀌어 지우지 않았습니다':timeDeleteRefusal(current,'entry');
      if(why)return leftover(current,why);
    }
    // 이미 빈 쪽은 지울 것이 없습니다(다시 시도해도 안전).
    if(deleting?blank(current[timeKey]):normalizeTime(current[timeKey])===next[timeKey]&&current[memoKey]===next[memoKey])continue;
    await journal({phase:'before_write',field,before:editable(current),after:next,reason:input.reason,...(defaultTimes[field]?{defaultTime:defaultTimes[field]}:{}),...(deleting?{deleteTime:true}:{})});
    let error=null,automaticTime=defaultTimes[field];
    // 삭제가 아닌 요청은 옵션 모양이 그대로입니다(deleteFields 없음).
    const base=requested?{requestedFields:Object.keys(requested),...(deletions.length?{deleteFields:deletions}:{})}:undefined,options=writer?{...base,writer}:base;
    try{const written=await adapter.write(current,field,{time:next[timeKey],memo:next[memoKey]},options);if(written){next[timeKey]=written.time;next[memoKey]=written.memo;automaticTime=written.automaticTime;}}catch(e){error=e.message;}
    let fresh;
    try{fresh=await adapter.read(record);}catch(e){const out={field,state:'unknown',error:'저장 결과를 다시 읽지 못했습니다. 재수집 후 확인해 주세요.'};results.push(out);await journal(out);return{status:'unknown',message:out.error,results};}
    if(fresh.id!==record.id||fresh.studentKey!==record.studentKey||String(fresh.classId)!==String(record.classId)||fresh.date!==record.date){
      const out={field,state:'unknown',error:'다른 학생 또는 날짜가 열려 저장 결과를 확인하지 못했습니다.'};results.push(out);await journal(out);return{status:'unknown',message:out.error,results};
    }
    // Verify both editor values, including a default time or a preserved live time.
    // 지운 쪽: 시간이 비고 그 칸의 메모도 없어야 합니다(기록과 함께 지워짐). 쓰기가 오류를 냈어도 다시 읽은 값으로 판단합니다.
    const live=fresh.source==='live'&&fresh.readState==='complete';
    const matched=live&&(deleting?blank(fresh[timeKey])&&(fresh[memoKey]??'')==='':fresh[timeKey]===next[timeKey]&&fresh[memoKey]===next[memoKey]);
    const untouched=field==='entry'?['exit','exitMemo']:['entry','entryMemo'];
    // 반대쪽은 그대로여야 합니다. 다만 퇴실을 지우면 체크히어가 입실에서 계산한 1교시(PASS)와 그 메모도 함께 비웁니다(Cowork 확인) — 실패가 아닙니다.
    // 두 칸 삭제에서는 퇴실과 함께 1교시(ATTEND 포함)와 그 메모가 비어도 실패가 아닙니다(어차피 지울 칸, 아래 1교시 단계가 지운 것으로 적고 끝에 두 칸을 다시 봄).
    const derived=k=>deleting&&timeKey==='exit'&&blank(fresh.entry)&&(current.entryKind==='PASS'?k==='entry'||(fresh.entryMemo??'')==='':twoCell&&(fresh.entryMemo??'')==='');
    // 실제 입실(ENTER)은 지우지 않습니다: 퇴실 삭제 뒤에는 늘, 1교시 삭제 뒤에는 입실 번호가 있는 학생이면 그대로여야 합니다.
    // (관리자가 1교시를 넣은 학생의 입실은 그 1교시에서 계산된 값이라 1교시를 지우면 — 두 칸 삭제면 퇴실 단계에서도 — 함께 빌 수 있습니다.)
    const enterKept=!deleting||((timeKey==='entry'||twoCell)&&current.enterEventId===false)||time(fresh.rawEntry)===time(current.rawEntry);
    const stable=((!!request&&!deleting)||untouched.every(k=>fresh[k]===current[k]||derived(k)))&&enterKept;
    // 가린 화면에서 다시 읽지 못한 결과(일부 수집)는 실패가 아니라 미확인입니다: 저장됐을 수 있습니다(해제 뒤 다시 읽어 판단, 다시 시도도 먼저 읽음).
    const unverifiable=!live&&adapter.view==='masked';
    const state=unverifiable?'unknown':matched&&stable?'verified':matched?'conflict':'failed';
    const out={field,state,error:error||(unverifiable?'가린 화면이라 저장 결과를 다시 읽지 못했습니다. 마스킹 해제 뒤 다시 수집해 확인해 주세요.':!enterKept?'실제 입실 기록이 바뀌었습니다. 체크히어 원본을 확인해 주세요.':!stable?'반영 중 다른 항목의 값이 바뀌었습니다.':null),...(matched&&automaticTime&&next[timeKey]===automaticTime?{automaticTime}:{}),
      ...(deleting?{...(state==='verified'?{deleted:true}:{}),rawEntryBefore:current.rawEntry??null,rawEntryAfter:fresh.rawEntry??null}:{})};
    results.push(out);await journal(out);current=fresh;
    if(out.state!=='verified'){
      if(twoCell&&results.some(x=>x.state==='verified'&&x.deleted))return leftover(current,out.error);
      return{status:results.some(x=>x.state==='verified')?'partial':out.state,message:'일부 또는 전체 항목이 검증되지 않았습니다. 결과를 확인해 주세요.',results,current};
    }
  }
  // 두 칸 삭제(그리고 체크인한 학생의 퇴실 삭제)는 마지막으로 다시 읽은 기록에서 퇴실·1교시(ATTEND·PASS 시간)가 모두 비어야 끝납니다.
  if((twoCell||passWithExit)&&(!blank(current.exit)||!blank(current.entry)))return leftover(current);
  if(request&&!requestMatchesRecord(request,current,identities))return{status:'conflict',message:'입력 후 요청값과 실제 저장값이 일치하지 않습니다. 실제 기록을 확인해 주세요.',results,current};
  const defaults=results.filter(r=>r.automaticTime).map(r=>`${r.field==='entry'?'입실':'퇴실'} ${r.automaticTime}`).join(' · ');
  return{status:'verified',message:'체크히어를 다시 열어 변경값을 확인했습니다.'+(defaults?' 누락 시간 자동 입력: '+defaults:'')+deletedNote(results),results,current};
}
// 미리보기(4-2): 승인된 요청을 반영(applyVerified)할 때 쓸 칸과 값만 계산합니다. 아무것도 보내거나 누르지 않습니다. 이미 같은 값이면 빈 목록.
// format: 기록된 요청 형식(있으면 칸마다 wired). adapter.requestPlan이 없으면 칸·값만 돌려줍니다.
export function planRequest(adapter,request,current,identities=[],format=null){
  if(confirmAlreadyApplied(request,current,current,identities))return [];
  const clean=cleanRequest(request),requested=clean.changes,deletions=clean.deleteTimes||[];
  const next=validateProposal(current,{...current,...prepareApproval(request,current,{identities}).after,reason:String(request.reason||'').trim()||'미리보기',version:current.version},{requested:true,deletions});
  const out=[],options={requestedFields:Object.keys(requested),...(deletions.length?{deleteFields:deletions}:{}),format};
  // 반영과 같은 순서(시간 삭제는 퇴실 먼저)로 보입니다.
  for(const name of deletions.length?DELETE_ORDER:['entry','exit']){
    const [field,timeKey,memoKey]=SIDES[name];
    if(!Object.hasOwn(requested,timeKey)&&!Object.hasOwn(requested,memoKey))continue;
    const deleting=deletions.includes(timeKey);
    if(deleting?blank(current[timeKey]):normalizeTime(current[timeKey])===next[timeKey]&&current[memoKey]===next[memoKey])continue;
    const change={time:next[timeKey],memo:next[memoKey]};
    out.push(typeof adapter?.requestPlan==='function'?adapter.requestPlan(current,field,change,options):{field,op:deleting?'delete':'update',after:change});
  }
  return out;
}
