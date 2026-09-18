import {matchingCheckHereRecords} from '../checkhere-name-core.mjs';
import {matchRequest} from './approval-core.mjs';

// Only the requested student's details are read, even when the day has never
// been collected on this PC. Other students' complete snapshots stay intact.
export async function readRequestRecord(adapter,request,records,identities=[],save=()=>{}){
  await adapter.requireLogin();
  let candidates=matchingCheckHereRecords(request,records,identities),opened=false;
  if(candidates.length!==1){
    const day=await adapter.openDay(String(request.classId),request.date);
    candidates=matchingCheckHereRecords(request,day,identities);
    opened=true;
  }
  if(candidates.length!==1){matchRequest(request,candidates,identities);throw Error('학생 식별정보를 확인해 주세요.');}
  const previous=candidates[0],current=await(opened&&typeof adapter.readOpened==='function'?adapter.readOpened(previous):adapter.read(previous));
  matchRequest(request,[current],identities);
  if(!previous.studentKey||current.id!==previous.id||current.studentKey!==previous.studentKey)throw Error('다른 학생 기록이 열려 중단했습니다.');
  await save(current);return current;
}
