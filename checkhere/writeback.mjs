import {editable,version} from './identity.mjs';
import {assertChangeAllowed,normalizeTime} from './rules.mjs';
import {requestMatchesRecord} from './approval-core.mjs';
export function confirmAlreadyApplied(request,record,current,identities=[]){
  if(!current||current.id!==record.id||current.studentKey!==record.studentKey||!record.studentKey||!requestMatchesRecord(request,current,identities))return false;
  return true;
}
export function validateProposal(record,input){
  if(input.version!==record.version)throw new Error('검수 화면이 오래되었습니다. 다시 조회해 주세요.');
  if(typeof input.reason!=='string'||!input.reason.trim())throw new Error('수정 근거를 입력해 주세요.');
  const next={};for(const k of ['entry','exit']){next[k]=normalizeTime(input[k]);if(!next[k])throw new Error('시간을 비우는 변경은 지원하지 않습니다.');}
  if(next.exit<next.entry)throw new Error('퇴실이 입실보다 빠릅니다.');
  for(const k of ['entryMemo','exitMemo']){if(typeof input[k]!=='string'||input[k].length>500)throw new Error('메모는 500자 이내로 입력해 주세요.');next[k]=input[k];}
  const changes=Object.fromEntries(Object.entries(next).filter(([k,v])=>v!==record[k]));
  if(!Object.keys(changes).length)throw new Error('변경한 값이 없습니다.');
  assertChangeAllowed(record,changes);return next;
}
// Each field is a separate CheckHere transaction; never report atomic success.
export async function applyVerified(adapter,record,input,journal,request=null,identities=[]){
  const results=[];
  let current=await adapter.read(record);
  if(current.id!==record.id||current.studentKey!==record.studentKey)return{status:'conflict',message:'다른 학생 기록이 열려 중단했습니다. 다시 수집해 주세요.',results};
  if(request&&confirmAlreadyApplied(request,record,current,identities))return{status:'verified',alreadyApplied:true,message:'이미 반영 · 체크히어 원본에서 요청값을 확인했습니다.',results,current};
  const next=validateProposal(record,input);
  if(current.readState!=='complete'||version(current)!==record.version)return{status:'conflict',message:'체크히어 값이 바뀌었습니다. 다시 수집한 뒤 검토해 주세요.',results,current};
  for(const [field,timeKey,memoKey] of [['entry','entry','entryMemo'],['exit','exit','exitMemo']]){
    if(current[timeKey]===next[timeKey]&&current[memoKey]===next[memoKey])continue;
    await journal({phase:'before_write',field,before:editable(current),after:next,reason:input.reason});
    let error=null;
    try{await adapter.write(current,field,{time:next[timeKey],memo:next[memoKey]});}catch(e){error=e.message;}
    let fresh;
    try{fresh=await adapter.read(record);}catch(e){const out={field,state:'unknown',error:'저장 결과를 다시 읽지 못했습니다. 재수집 후 확인해 주세요.'};results.push(out);await journal(out);return{status:'unknown',message:out.error,results};}
    if(fresh.id!==record.id||fresh.studentKey!==record.studentKey||String(fresh.classId)!==String(record.classId)||fresh.date!==record.date){
      const out={field,state:'unknown',error:'다른 학생 또는 날짜가 열려 저장 결과를 확인하지 못했습니다.'};results.push(out);await journal(out);return{status:'unknown',message:out.error,results};
    }
    const matched=fresh.source==='live'&&fresh.readState==='complete'&&fresh[timeKey]===next[timeKey]&&fresh[memoKey]===next[memoKey];
    const untouched=field==='entry'?['exit','exitMemo']:['entry','entryMemo'];
    const stable=untouched.every(k=>fresh[k]===current[k]);
    const out={field,state:matched&&stable?'verified':matched?'conflict':'failed',error:error||(!stable?'반영 중 다른 항목의 값이 바뀌었습니다.':null)};
    results.push(out);await journal(out);current=fresh;
    if(out.state!=='verified')return{status:results.some(x=>x.state==='verified')?'partial':out.state,message:'일부 또는 전체 항목이 검증되지 않았습니다. 결과를 확인해 주세요.',results,current};
  }
  return{status:'verified',message:'체크히어를 다시 열어 변경값을 확인했습니다.',results,current};
}
