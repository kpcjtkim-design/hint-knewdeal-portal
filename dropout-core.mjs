import {isoLabel} from './attendance-beta-core.mjs';
import {UNIT_PERIODS} from './attendance-period-core.mjs';
// 중도포기자(교육생) 시트 + 운영총괄 반별 출결로 조기취업 수료 가능 여부를 판정한다.
// 규칙: 근로개시일 직전 수업일까지 출석해야 하고(미출석=결석), 그 이후는 출석 간주.
// 무단 지각·조퇴·외출은 단위기간별 3회=결석 1일. 단위기간 결석은 수업일 절반 미만,
// 전체 무단결석은 11일 이하여야 수료 가능.
export const DROPOUT_SHEET_ID='1ZU6IxnP3CqFQGB1UxC3XB9mhrC40ZArG-0cQGdLqljI';
export const DROPOUT_TAB='중도포기자(교육생)';
export const OPERATIONS_SHEET_ID='1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34';
export const MAX_TOTAL_ABSENCE=11;
const LAST_DAY=UNIT_PERIODS.at(-1).to,FIRST_DAY=UNIT_PERIODS[0].from;
const PARTIAL={지각:1,조퇴:1,외출:1};
const clean=v=>String(v??'').trim();
const md=(m,d)=>{const mm=+m,dd=+d;return mm>=1&&mm<=12&&dd>=1&&dd<=31?`2026-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`:'';};
// '9/1 출근', '8/7까지 출석', '=>8/31 포기일 예정' 등 자유 입력에서 날짜를 고른다.
export function parseSheetDate(text,{prefer}={}){
 const s=clean(text);if(!s)return '';
 if(prefer){const m=s.match(new RegExp('(\\d{1,2})\\s*/\\s*(\\d{1,2})\\s*(?:일)?\\s*'+prefer));if(m)return md(m[1],m[2]);}
 const m=s.match(/(\d{1,2})\s*\/\s*(\d{1,2})/)||s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
 return m?md(m[1],m[2]):'';
}
export const noEmployment=text=>/^[-–—\s]*$/.test(clean(text));
export function classIdOf(text){const m=clean(text).match(/^(\d{1,2})\s*반/);return m&&+m[1]>=1&&+m[1]<=17?String(+m[1]):'';}
// Header row locates columns; fixed letters (B,D,E,F,G,H,Q) are the fallback.
export function readDropoutRows(values){
 const rows=Array.isArray(values)?values:[];const head=(rows[0]||[]).map(clean);
 const find=(re,fallback)=>{const i=head.findIndex(h=>re.test(h));return i>=0?i:fallback;};
 const c={name:1,course:find(/반배정/,3),reason:find(/^포기사유$/,4),start:find(/근로개시일/,5),last:find(/포기일|마지막/,6),note:find(/수료가능|결석일수/,7),classInfo:find(/반\s*정보/,16),...docColumns(head)};
 if(!/근로개시일/.test(head[c.start]||'')||!/포기일|마지막/.test(head[c.last]||''))throw Error('중도포기자 시트의 근로개시일(F)·포기일(G) 머리글을 확인하지 못했습니다.');
 return rows.slice(1).map((r,i)=>({row:i+2,no:clean(r[0]),name:clean(r[c.name]),course:clean(r[c.course]),reason:clean(r[c.reason]),startText:clean(r[c.start]),lastText:clean(r[c.last]),sheetNote:clean(r[c.note]),classId:classIdOf(r[c.classInfo]),resignText:clean(r[c.resign]),offerText:clean(r[c.offer]),contractText:clean(r[c.contract])})).filter(r=>r.name);
}
// 운영총괄 탭 중 반별 원본 탭("4. 충청_제조지능화(1)")만 고른다. 단위기간·테스트·사본 탭 제외.
export function classTabs(titles){
 const out={};
 for(const t of titles){const m=clean(t).match(/^(\d{1,2})\.\s/);if(!m||/단위기간|테스트|사본|수정중/.test(t))continue;const id=String(+m[1]);(out[id]||=[]).push(t);}
 for(const [id,list] of Object.entries(out)){if(list.length!==1)throw Error(`${id}반 운영총괄 탭이 ${list.length}개입니다: ${list.join(', ')}`);out[id]=list[0];}
 return out;
}
// values: 운영총괄 M18:ZZ48 (첫 행 날짜, 첫 열 이름, 5번째 열부터 출결).
export function classAttendance(values){
 const a=Array.isArray(values)?values:[];const dates=(a[0]||[]).map((v,col)=>({date:isoLabel(v),col})).filter(d=>d.col>=4&&d.date&&d.date>=FIRST_DAY&&d.date<=LAST_DAY);
 if(!dates.length)throw Error('운영총괄 18행 수업일을 읽지 못했습니다.');
 if(new Set(dates.map(d=>d.date)).size!==dates.length)throw Error('운영총괄 수업일이 중복되었습니다.');
 dates.sort((x,y)=>x.date.localeCompare(y.date));
 const students=a.slice(1).map(r=>({name:clean(r[0]),row:r})).filter(s=>s.name);
 return {dates,students};
}
const partialCount=s=>s.startsWith('중복')?2:PARTIAL[s]||0;
const periodOf=d=>UNIT_PERIODS.find(p=>d>=p.from&&d<=p.to);
export function evaluateDropout(entry,attendance,today){
 const issues=[],out={...entry,issues,verdict:'확인필요',scheduled:false,periods:[],totalAbsence:null,preStartAbsence:0,days:[]};
 const last=parseSheetDate(entry.lastText,{prefer:'포기일'}),start=parseSheetDate(entry.startText);
 out.lastDate=last;out.startDate=start;
 if(last)out.scheduled=last>today;
 if(noEmployment(entry.startText)){
  if(/개인/.test(entry.reason)){out.verdict='제적';out.basis='개인사정 포기 (조기취업 아님)';return out;}
  issues.push('근로개시일이 없습니다. 취업 포기라면 F열에 출근일을 입력해 주세요.');return out;
 }
 if(!start)issues.push(`근로개시일(F열) "${entry.startText}"에서 날짜를 찾지 못했습니다.`);
 if(!last)issues.push(`포기일(G열) "${entry.lastText||'공란'}"에서 날짜를 찾지 못했습니다.`);
 if(!attendance)issues.push(entry.locateIssue||'운영총괄 출석부에서 학생을 찾지 못했습니다.');
 if(issues.length)return out;
 const {dates,row}=attendance,required=dates.filter(d=>d.date<start).at(-1)?.date||'';out.requiredUntil=required;
 if(last>start)issues.push('포기일이 근로개시일보다 늦습니다. 날짜를 확인해 주세요.');
 const blank=[];
 out.days=dates.map(({date,col})=>{
  const raw=clean(row[col]),real=!!raw&&raw!=='해당없음';let status,basis;
  if(!required||date>required){status='출석';basis='근로개시 이후 출석 간주';}
  else if(real){status=raw;basis='운영총괄';}
  else if(date<=last){status='출석';basis=date>today?'포기일 전 출석 예정':'출결 미입력';if(date<=today)blank.push(date);}
  else{status='결석';basis=date>today?'근로개시 전 미출석 예정':'근로개시 전 미출석';}
  return {date,raw,status,basis};
 });
 if(blank.length)issues.push(`포기일 전 출결 미입력 ${blank.length}일(${blank.slice(0,3).map(d=>+d.slice(5,7)+'/'+ +d.slice(8)).join(', ')}${blank.length>3?' …':''}) · 출석으로 계산`);
 const unknown=out.days.filter(d=>!['출석','결석','인정출석'].includes(d.status)&&!partialCount(d.status));
 if(unknown.length)issues.push(`알 수 없는 출결 값: ${[...new Set(unknown.map(d=>d.status))].join(', ')}`);
 out.preStartAbsence=out.days.filter(d=>d.date>last&&d.date<=required&&d.status==='결석').length;
 const reasons=[];
 out.periods=UNIT_PERIODS.map(p=>{
  const ds=out.days.filter(d=>periodOf(d.date)===p),absent=ds.filter(d=>d.status==='결석').length,partial=ds.reduce((n,d)=>n+partialCount(d.status),0),converted=Math.floor(partial/3),total=absent+converted,ok=total*2<ds.length;
  if(ds.length&&!ok)reasons.push(`${p.id}단위기간 결석 ${total}일 ≥ 수업일 ${ds.length}일의 절반`);
  return {id:p.id,from:p.from,to:p.to,days:ds.length,absent,partial,converted,total,ok};
 });
 out.totalAbsence=out.periods.reduce((n,p)=>n+p.total,0);
 if(out.totalAbsence>MAX_TOTAL_ABSENCE)reasons.push(`전체 무단결석 ${out.totalAbsence}일 > ${MAX_TOTAL_ABSENCE}일`);
 out.reasons=reasons;
 if(unknown.length)return out;
 out.verdict=reasons.length?'제적':'수료가능';out.basis=reasons.join(' · ')||'단위기간 결석 절반 미만 · 전체 무단결석 11일 이하';
 return out;
}
// 반 정보(Q열)가 있으면 그 반 명단에서만 찾는다(다른 반 동명이인 오연결 방지).
// Q열이 비었을 때만 전체 반에서 유일한 이름을 찾는다.
export function locateStudent(entry,classes){
 const inClass=id=>{const c=classes[id];if(!c)return [];return c.students.filter(s=>s.name===entry.name).map(s=>({classId:id,dates:c.dates,row:s.row}));};
 if(entry.classId){const hits=inClass(entry.classId);if(hits.length===1)return {hit:hits[0]};return {issue:hits.length>1?`${entry.classId}반에 동명이인이 있습니다.`:`${entry.classId}반 운영총괄 명단에서 이름을 찾지 못했습니다. Q열 반 정보를 확인해 주세요.`};}
 const all=Object.keys(classes).flatMap(inClass);
 if(all.length===1)return {hit:all[0],issue:`Q열 반 정보가 없어 ${all[0].classId}반 학생으로 계산했습니다.`};
 return {issue:all.length>1?'여러 반에 같은 이름이 있습니다. Q열 반 정보를 입력해 주세요.':'운영총괄 명단에서 이름을 찾지 못했습니다.'};
}
export function evaluateAll(entries,classes,today){
 return entries.map(e=>{const {hit,issue}=locateStudent(e,classes);const r=evaluateDropout({...e,classId:hit?.classId||e.classId,locateIssue:issue},hit||null,today);if(issue&&!r.issues.includes(issue))r.issues.unshift(issue);return r;});
}
export const verdictLabel=r=>r.verdict==='확인필요'?'확인필요':(r.scheduled?'예정 · ':'')+r.verdict;

// ---- 서류 제출 (M: 포기사유서, N: 기업합격자료, O: 채용인정서류) ----
export const DOC_FIELDS={resign:/포기사유서/,offer:/채용통보|합격/,contract:/채용인정/};
export const CONTRACT_ITEMS=[{key:'contract',label:'근로계약서',match:/근로계약서/},{key:'insurance',label:'고용보험가입확인서',match:/고용보험/}];
const NA=/^\(?\s*해당\s*없음\s*\)?$/;
export function docColumns(head){const out={};for(const [k,re] of Object.entries(DOC_FIELDS)){const i=head.findIndex(h=>re.test(clean(h).replace(/\s+/g,' ')));out[k]=i>=0?i:{resign:12,offer:13,contract:14}[k];}return out;}
export function oxValue(text){const s=clean(text).toUpperCase();if(/^[O○◯●]$/.test(s))return 'O';if(/^[X×✕]$/.test(s))return 'X';return '';}
// O열: 알려진 두 서류 여부 + 그 외 기존 줄(보존).
export function parseContractCell(text){
 const lines=clean(text).split(/\r?\n/).map(clean).filter(Boolean),out={extra:[]};for(const i of CONTRACT_ITEMS)out[i.key]=false;
 for(const line of lines){const item=CONTRACT_ITEMS.find(i=>i.match.test(line));if(item)out[item.key]=true;else if(!NA.test(line))out.extra.push(line);}
 return out;
}
export function contractCellValue(state){return [...CONTRACT_ITEMS.filter(i=>state[i.key]).map(i=>i.label),...(state.extra||[])].join('\n');}
export const isPersonal=entry=>/개인/.test(entry.reason||'');
export function documentStatus(entry,today){
 const personal=isPersonal(entry),contract=parseContractCell(entry.contractText),missing=[],later=[];
 if(oxValue(entry.resignText)!=='O')missing.push('포기사유서');
 if(!personal){
  const offer=clean(entry.offerText);if(!offer||NA.test(offer))missing.push('기업합격자료');
  const start=parseSheetDate(entry.startText),started=!!start&&start<=today;
  for(const i of CONTRACT_ITEMS)if(!contract[i.key])(started?missing:later).push(i.label);
 }
 const state=missing.length?'미제출':later.length?'입사 후 제출':'완료';
 return {kind:personal?'개인사정':'조기취업',state,missing,later,contract};
}
// 한 셀만 쓴다. 쓰기 직전 머리글·학생 이름·기존 값을 다시 확인하고, 쓴 뒤 다시 읽어 검증한다.
// api(url,{method,body}) → JSON. RAW 입력이라 수식으로 해석되지 않는다.
const SHEETS='https://sheets.googleapis.com/v4/spreadsheets/';
const norm=v=>clean(v).replace(/\r\n/g,'\n');
export async function writeDropoutCell(api,{row,name,field,before,after}){
 if(!DOC_FIELDS[field])throw Error('허용되지 않는 열입니다.');
 if(!Number.isInteger(row)||row<2||row>300)throw Error('시트 행 번호를 확인해 주세요.');
 if(typeof after!=='string'||after.length>500||/^[=+\-@]/.test(after.trim()))throw Error('입력 값을 확인해 주세요.');
 const tab="'"+DROPOUT_TAB.replace(/'/g,"''")+"'",base=SHEETS+DROPOUT_SHEET_ID,q=encodeURIComponent;
 const fresh=await api(`${base}/values:batchGet?ranges=${q(tab+'!A1:T1')}&ranges=${q(`${tab}!A${row}:T${row}`)}&valueRenderOption=FORMATTED_VALUE`);
 const head=(fresh.valueRanges?.[0]?.values?.[0]||[]).map(clean),cur=fresh.valueRanges?.[1]?.values?.[0]||[],col=docColumns(head)[field];
 if(!DOC_FIELDS[field].test((head[col]||'').replace(/\s+/g,' ')))throw Error('시트 서류 열 머리글이 바뀌었습니다. 동기화 후 다시 시도해 주세요.');
 if(clean(cur[1])!==name)throw Error('시트의 학생 행 위치가 바뀌었습니다. 동기화 후 다시 시도해 주세요.');
 if(norm(cur[col])!==norm(before))throw Error('다른 사람이 먼저 이 칸을 수정했습니다. 동기화 후 다시 확인해 주세요.');
 const letter=String.fromCharCode(65+col),range=`${tab}!${letter}${row}`;
 let transport;try{await api(`${base}/values/${q(range)}?valueInputOption=RAW`,{method:'PUT',body:{range,majorDimension:'ROWS',values:[[after]]}});}catch(e){transport=e;}
 let saved;try{saved=await api(`${base}/values/${q(range)}?valueRenderOption=FORMATTED_VALUE`);}catch{throw Error('저장 결과를 확인하지 못했습니다. 동기화해서 시트 값을 확인해 주세요.');}
 const actual=norm(saved.values?.[0]?.[0]);
 if(actual!==norm(after))throw Error(transport?`저장 실패: ${transport.message}`:'저장 후 값이 요청과 다릅니다. 시트를 확인해 주세요.');
 return {range:`${letter}${row}`,value:actual};
}
