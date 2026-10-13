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
  return {name:String(s?.name??'').trim(),phone:String(s?.phone??'').replace(/\D/g,''),...times,entryMemo:memo(period[0]?.memoByAdmin),exitMemo:memo(complete[0]?.memoByAdmin),outings,problems};
}
// Rows come from the visible table. A row is read from page data only when the
// same student (name + phone key) is there once and every visible value agrees.
export function planFromPageData(rows,json,{now=()=>new Date().toISOString()}={}){
  const list=json?.data?.eventResultList;
  if(!Array.isArray(list))return {byId:new Map(),fallback:rows.map(r=>r.id),reason:'화면 데이터 형식이 예상과 다릅니다.'};
  const byKey=new Map();
  for(const s of list){const d=readStudent(s);if(d.phone.length<9)continue;const k=studentKey(d.name,d.phone);byKey.set(k,byKey.has(k)?null:d);}
  const byId=new Map(),fallback=[];
  for(const row of rows){
    const d=byKey.get(row.studentKey);
    const agrees=d&&!d.problems.length&&d.name===row.name&&d.rawEntry===row.rawEntry&&d.entry===row.entry&&d.exit===row.exit&&d.outings.length===row.outingCount;
    if(!agrees){fallback.push(row.id);continue;}
    const r={...row,entry:d.entry,exit:d.exit,entryMemo:d.entryMemo,exitMemo:d.exitMemo,outings:d.outings,readState:'complete',collectedAt:now()};
    delete r.readError;r.version=version(r);byId.set(row.id,r);
  }
  if(list.length!==rows.length)return {byId:new Map(),fallback:rows.map(r=>r.id),reason:'화면 데이터와 표의 학생 수가 다릅니다.'};
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
