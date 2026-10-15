import {matchingCheckHereRecords} from '../checkhere-name-core.mjs';
import {matchRequest} from './approval-core.mjs';
import {MASKED} from './masking.mjs';

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
  // 가린 화면에서 연결 안 된 학생(첫 글자·끝 4자리가 맞을 수 있는 줄)이면 '먼저 수집' 오류(시도 횟수에 들어감) 대신 해제를 기다립니다(검토 9).
  if(candidates.length!==1&&opened&&adapter.maskedMiss?.(request))throw Error(MASKED.UNLINKED);
  // 원문 화면에서 연결 충돌로 건너뛴 학생이면 '먼저 수집' 대신 연결 충돌로 알립니다(「연결 충돌 정리」 뒤 다시 수집).
  if(candidates.length!==1&&opened&&adapter.conflictMiss?.(request))throw Error(MASKED.CONFLICT);
  if(candidates.length!==1){matchRequest(request,candidates,identities);throw Error('학생 식별정보를 확인해 주세요.');}
  const previous=candidates[0],current=await(opened&&typeof adapter.readOpened==='function'?adapter.readOpened(previous):adapter.read(previous));
  // 가린 화면에서는 수정창으로 다시 읽을 수 없어 '다시 수집'(시도 횟수에 들어감) 대신 해제를 기다립니다.
  if(current?.readState!=='complete'&&adapter.view==='masked')throw Error(MASKED.READ);
  matchRequest(request,[current],identities);
  if(!previous.studentKey||current.id!==previous.id||current.studentKey!==previous.studentKey)throw Error('다른 학생 기록이 열려 중단했습니다.');
  await save(current);return current;
}
