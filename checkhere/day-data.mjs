// Reading a whole class/day from the data the CheckHere attendance page itself
// loads (verified by the 2026-10-12 diagnosis: times, admin memos and outing
// pairs are all in it). Every value is cross-checked against the visible table;
// anything unexpected sends that student back to the editor-by-editor read.
import {studentKey,version} from './identity.mjs';
import {normalizeTime} from './rules.mjs';

const KNOWN=new Set(['ENTER','ATTEND','PASS','COMPLETE','LEAVE','COMEBACK']);
const PERIOD=new Set(['ATTEND','PASS']);
const kst=d=>d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour12:false});
// ISO with a zone is converted to Korean time; a zone-less value is already local.
export function localTime(v){
  if(v===null||v===undefined||v==='')return null;
  const s=String(v);
  if(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s)){const d=new Date(s);return Number.isNaN(d.getTime())?undefined:kst(d);}
  const m=/(?:^|T|\s)(\d{2}:\d{2}(?::\d{2})?)/.exec(s);return m?normalizeTime(m[1].length===5?m[1]+':00':m[1]):undefined;
}
const memo=v=>v===null||v===undefined?'':String(v);
// 기록 번호(eventId)가 있는 칸만 체크히어에서 지울 수 있습니다. null이면 다른 기록에서 계산된 값입니다.
const hasId=e=>typeof e?.eventId==='string'&&e.eventId.trim()!=='';
// 시간 삭제용 표시: 1교시 종류(ATTEND 관리자 입력·PASS 입실에서 계산), 1교시·퇴실·입실(ENTER) 기록 번호 유무.
// 입실 번호가 있으면 체크인한 학생입니다(1교시에 관리자 사유를 저장해 ATTEND가 되었어도 그 1교시는 지우지 않음, rules.mjs timeDeleteRefusal).
// 값 비교와 버전(identity.mjs version)에는 넣지 않습니다(넣으면 모든 기록이 바뀐 것으로 보입니다).
export const DELETE_MARKS=['entryKind','entryEventId','exitEventId','enterEventId'];
export const marksOf=d=>({entryKind:d.entryKind,entryEventId:d.entryEventId,exitEventId:d.exitEventId,enterEventId:d.enterEventId});
// One student entry from the page data → the fields an editor read produces, or a reason it cannot be trusted.
export function readStudent(s){
  const events=Array.isArray(s?.eventList)?s.eventList:[],problems=[];
  for(const e of events){if(!KNOWN.has(e?.type))problems.push('알 수 없는 기록 종류');if(e?.timeIndex!==0&&e?.timeIndex!==undefined)problems.push('교시가 여러 개');}
  const of=pred=>events.filter(e=>pred(e?.type));
  const enter=of(t=>t==='ENTER'),period=of(t=>PERIOD.has(t)),complete=of(t=>t==='COMPLETE');
  if(enter.length>1||period.length>1||complete.length>1)problems.push('같은 종류 기록이 여러 개');
  if(events.some(e=>!PERIOD.has(e?.type)&&e?.type!=='COMPLETE'&&memo(e?.memoByAdmin).trim()))problems.push('입실·퇴실 외 기록에 관리자 메모');
  const pairs=Array.isArray(s?.leaveEvents?.pairs)?s.leaveEvents.pairs:[];
  const times={rawEntry:localTime(enter[0]?.time),entry:localTime(period[0]?.time),exit:localTime(complete[0]?.time)};
  const outings=pairs.map(p=>({start:localTime(p?.startTime),end:localTime(p?.endTimeOrNull),cutoff:localTime(p?.judgedEndTime),recognized:p?.isRecognized===true?true:p?.isRecognized===false?false:null}));
  if(Object.values(times).includes(undefined)||outings.some(o=>[o.start,o.end,o.cutoff].includes(undefined)))problems.push('시간 형식');
  return {name:String(s?.name??'').trim(),phone:String(s?.phone??'').replace(/\D/g,''),...times,entryMemo:memo(period[0]?.memoByAdmin),exitMemo:memo(complete[0]?.memoByAdmin),outings,problems,
    entryKind:period[0]?period[0].type:null,entryEventId:hasId(period[0]),exitEventId:hasId(complete[0]),enterEventId:hasId(enter[0])};
}
// 그날 화면 데이터에서 이 학생(이름+전화 키)이 정확히 한 명이고 의심스러운 점이 없을 때만 돌려줍니다. 아니면 null(삭제 잠김).
export function dayStudent(json,key){
  const list=json?.data?.eventResultList;if(!Array.isArray(list)||!key)return null;
  const found=list.map(readStudent).filter(d=>d.phone.length>=9&&studentKey(d.name,d.phone)===key);
  return found.length===1&&!found[0].problems.length?found[0]:null;
}
// Rows come from the visible table. A row is read from page data only when the
// same student (name + phone key) is there once and every visible value agrees.
// entryFor(row): 표 순번으로 이미 맞춘 학생 항목(가린 화면은 이것만 씀 — 가린 이름·전화로 키를 만들지 않음).
// 그때는 맞추기가 표와 데이터의 학생 수·순번을 이미 확인했으므로 아래 학생 수 비교를 하지 않습니다. memoOk(row,d): 메모를 믿을지.
export function planFromPageData(rows,json,{now=()=>new Date().toISOString(),entryFor=null,memoOk=null}={}){
  const list=json?.data?.eventResultList;
  if(!Array.isArray(list))return {byId:new Map(),fallback:rows.map(r=>r.id),reason:'화면 데이터 형식이 예상과 다릅니다.'};
  const byKey=new Map();
  if(!entryFor)for(const s of list){const d=readStudent(s);if(d.phone.length<9)continue;const k=studentKey(d.name,d.phone);byKey.set(k,byKey.has(k)?null:d);}
  const byId=new Map(),fallback=[];
  for(const row of rows){
    const e=entryFor?entryFor(row):null,d=entryFor?(e?readStudent(e):null):byKey.get(row.studentKey);
    const agrees=d&&!d.problems.length&&(entryFor||d.name===row.name)&&d.rawEntry===row.rawEntry&&d.entry===row.entry&&d.exit===row.exit&&d.outings.length===row.outingCount&&(!memoOk||memoOk(row,d));
    if(!agrees){fallback.push(row.id);continue;}
    const r={...row,entry:d.entry,exit:d.exit,entryMemo:d.entryMemo,exitMemo:d.exitMemo,outings:d.outings,readState:'complete',collectedAt:now()};
    delete r.readError;r.version=version(r);Object.assign(r,marksOf(d));byId.set(row.id,r);
  }
  if(!entryFor&&list.length!==rows.length)return {byId:new Map(),fallback:rows.map(r=>r.id),reason:'화면 데이터와 표의 학생 수가 다릅니다.'};
  return {byId,fallback,reason:fallback.length?`표와 맞지 않는 학생 ${fallback.length}명은 수정창으로 읽습니다.`:''};
}
// Editors to open as a daily sample: a student with a memo, one with an outing, else the first.
export function sampleIds(records,limit=2){
  const list=[...records],picked=[];
  for(const test of [r=>r.entryMemo||r.exitMemo,r=>r.outings?.length,()=>true]){const hit=list.find(r=>test(r)&&!picked.includes(r.id));if(hit&&picked.length<limit)picked.push(hit.id);}
  return picked;
}
export function sameReading(a,b){
  const outs=r=>JSON.stringify((r.outings||[]).map(o=>[o.start,o.end,o.cutoff,o.recognized]));
  return a.entry===b.entry&&a.exit===b.exit&&memo(a.entryMemo)===memo(b.entryMemo)&&memo(a.exitMemo)===memo(b.exitMemo)&&outs(a)===outs(b);
}
