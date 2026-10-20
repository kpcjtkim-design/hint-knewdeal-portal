import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as C from '../../cohort.mjs';
import {KINDS} from '../../notify-core.mjs';

// 2기 firestore.rules를 에뮬레이터 없이 시험합니다: 규칙 글을 작은 해석기로 JS로 옮겨 허용·거부만 봅니다(문법 검사는 콘솔 게시 때).
// 가상 계정·가상 학생만 씁니다. 지원 범위: match 중첩·{x=**}, function·let, allow, get/exists, is, in, matches, size, keys, hasOnly, diff.
const src=readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8').replace(/\r\n/g,'\n');

// ---------- 작은 규칙 해석기 ----------
const stripComments=s=>{let out='',q=false;for(let i=0;i<s.length;i++){const c=s[i];if(q){out+=c;if(c==="'")q=false;continue;}if(c==="'"){q=true;out+=c;continue;}if(c==='/'&&s[i+1]==='/'&&(i===0||/[\s;{}(,]/.test(s[i-1]))){while(i<s.length&&s[i]!=='\n')i++;out+='\n';continue;}out+=c;}return out;};
const text=stripComments(src);
function matchClose(s,i,open,close){let d=0,q=false;for(let j=i;j<s.length;j++){const c=s[j];if(q){if(c==="'")q=false;continue;}if(c==="'"){q=true;continue;}if(c===open)d++;else if(c===close){d--;if(!d)return j;}}throw Error('짝 없음 '+open);}
function parseBlock(s,i){const node={matches:[],functions:[],allows:[]};
 for(;;){while(/\s/.test(s[i]))i++;if(i>=s.length||s[i]==='}')return [node,i+1];
  if(s.startsWith('match ',i)){i+=6;while(/\s/.test(s[i]))i++;let path='';while(s[i]==='/'){path+='/';i++;if(s[i]==='{'){const e=s.indexOf('}',i);path+=s.slice(i,e+1);i=e+1;}else{const m=/^[\w.\-]+/.exec(s.slice(i));path+=m[0];i+=m[0].length;}}
   while(/\s/.test(s[i]))i++;if(s[i]!=='{')throw Error('match 뒤 { 없음 '+path);const [child,next]=parseBlock(s,i+1);node.matches.push({path,...child});i=next;continue;}
  if(s.startsWith('function ',i)){const m=/^function (\w+)\(([\w,\s]*)\)\s*/.exec(s.slice(i));const b=i+m[0].length;const e=matchClose(s,b,'{','}');node.functions.push({name:m[1],args:m[2],body:s.slice(b+1,e)});i=e+1;continue;}
  if(s.startsWith('allow ',i)){const colon=s.indexOf(':',i),ops=s.slice(i+6,colon).split(',').map(x=>x.trim());let j=colon+1,q=false,d=0;for(;j<s.length;j++){const c=s[j];if(q){if(c==="'")q=false;continue;}if(c==="'")q=true;else if('([{'.includes(c))d++;else if(')]}'.includes(c))d--;else if(c===';'&&!d)break;}
   const cond=s.slice(colon+1,j).trim().replace(/^if\s+/,'');node.allows.push({ops,cond});i=j+1;continue;}
  if(s.startsWith('rules_version',i)){i=s.indexOf(';',i)+1;continue;}
  if(s.startsWith('service ',i)){const b=s.indexOf('{',i);const [child,next]=parseBlock(s,b+1);Object.assign(node,{service:child});i=next;continue;}
  throw Error('모르는 글: '+s.slice(i,i+40));}}
const root=parseBlock(text,0)[0].service;
// 식 바꾸기: 경로 → 글자 틀, [..] 목록 → __L, X is T → __is(X,'T')
function convertPaths(e){let out='',i=0;for(;;){const k=e.indexOf('/databases/',i);if(k<0)return out+e.slice(i);out+=e.slice(i,k);let j=k,path='';
 for(;;){if(e[j]===')'||e[j]===undefined)break;if(e.startsWith('$(',j)){const c=matchClose(e,j+1,'(',')');path+='${'+e.slice(j+2,c)+'}';j=c+1;continue;}path+=e[j];j++;}
 out+='`'+path.replace(/^\/databases\/\$\{database\}\/documents\//,'')+'`';i=j;}}
function wrapLists(e){let out='',q=false;const stack=[];for(let i=0;i<e.length;i++){const c=e[i];if(q){out+=c;if(c==="'")q=false;continue;}if(c==="'"){q=true;out+=c;continue;}
 if(c==='['){const prev=out.trimEnd().slice(-1);const lit=!prev||/[(,=!&|:?]/.test(prev)||/\bin$/.test(out.trimEnd());stack.push(lit);out+=lit?'__L([':'[';continue;}
 if(c===']'){out+=stack.pop()?'])':']';continue;}out+=c;}return out;}
function convertIs(e){let r=e;for(;;){const m=/\s+is\s+(string|list|map|int|bool|timestamp)\b/.exec(r);if(!m)return r;let s=m.index;
 // 왼쪽 피연산자: 이름·점·괄호 묶음·[..]·문자열을 거꾸로 훑음
 let j=s-1;for(;;){if(j<0)break;const c=r[j];if(/[\w.$]/.test(c)){j--;continue;}if(c===')'||c===']'){const open=c===')'?'(':'[';let d=0;for(;j>=0;j--){if(r[j]===c)d++;else if(r[j]===open){d--;if(!d)break;}}j--;continue;}if(c==="'"){j--;while(j>=0&&r[j]!=="'")j--;j--;continue;}break;}
 const operand=r.slice(j+1,s);r=r.slice(0,j+1)+`__is(${operand},'${m[1]}')`+r.slice(s+m[0].length);}}
const js=e=>convertIs(wrapLists(convertPaths(e))).replace(/request\.time/g,'__TIME');

// 값 감싸기
const TIME={time:true},RAW=Symbol('raw'),KIND=Symbol('kind');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function W(v){if(Array.isArray(v))return L(v);if(v&&typeof v==='object'&&v!==TIME&&!v[KIND])return M(v);return v;}
function raw(v){return v&&v[RAW]!==undefined?v[RAW]:v;}
function L(a){a=a.map(raw);return new Proxy(a,{has:(t,k)=>t.includes(k),get:(t,k)=>k===RAW?t:k===KIND?'list':k==='size'?()=>t.length:k==='hasOnly'?l=>t.every(x=>raw(l).includes(x)):k==='hasAll'?l=>raw(l).every(x=>t.includes(x)):k==='hasAny'?l=>raw(l).some(x=>t.includes(x)):/^\d+$/.test(String(k))?W(t[k]):undefined});}
function M(o){return new Proxy(o,{has:(t,k)=>Object.hasOwn(t,k),get:(t,k)=>k===RAW?t:k===KIND?'map':k==='keys'?()=>L(Object.keys(t)):k==='size'?()=>Object.keys(t).length:k==='get'?(key,d)=>Object.hasOwn(t,key)?W(t[key]):d:k==='diff'?other=>({affectedKeys:()=>L([...new Set([...Object.keys(t),...Object.keys(raw(other))])].filter(x=>!same(t[x],raw(other)[x])))}):Object.hasOwn(t,k)?W(t[k]):undefined});}
const IS=(v,t)=>t==='string'?typeof v==='string':t==='int'?Number.isInteger(v):t==='bool'?typeof v==='boolean':t==='timestamp'?v===TIME:t==='list'?v?.[KIND]==='list':t==='map'?v?.[KIND]==='map':false;
Object.defineProperty(String.prototype,'matches',{value(re){return new RegExp('^(?:'+re+')$').test(String(this));},configurable:true});
Object.defineProperty(String.prototype,'size',{value(){return String(this).length;},configurable:true});

const functions=[];(function collect(n){functions.push(...n.functions);n.matches.forEach(collect);})(root);
const fnCode=functions.map(f=>`const ${f.name}=function(${f.args}){${js(f.body)}};`).join('\n');
// 경로 맞추기: 모든 match를 펼쳐 (조각들, allow) 목록으로
const rules=[];(function flat(n,prefix){for(const m of n.matches){const segs=[...prefix,...m.path.split('/').filter(Boolean)];for(const a of m.allows)rules.push({segs,...a});flat(m,segs);}})(root.matches[0],[]);
function bind(segs,parts){const vars={};let i=0;for(let s=0;s<segs.length;s++){const seg=segs[s],w=/^\{(\w+)(=\*\*)?\}$/.exec(seg);if(w&&w[2]){vars[w[1]]=parts.slice(i).join('/');return i<parts.length?vars:null;}if(i>=parts.length)return null;if(w)vars[w[1]]=parts[i];else if(seg!==parts[i])return null;i++;}return i===parts.length?vars:null;}
const OPS={get:['read','get'],list:['read','list'],create:['write','create'],update:['write','update'],delete:['write','delete']};
// allowed(op, 경로, {auth, data(기존), next(새 값), db(다른 문서)})
function allowed(op,path,{auth=null,data=null,next=null,db={}}={}){
 const parts=path.split('/');
 const request={auth:auth&&{uid:'u-'+auth.email,token:{email:auth.email,email_verified:auth.verified!==false,firebase:{sign_in_provider:auth.provider||'google.com'}}},resource:next&&{data:W(next)},time:TIME};
 const ctx={request:W(request),resource:data&&{data:W(data)},database:'(default)',__TIME:TIME,__L:L,__is:IS,
  get:p=>{if(!(p in db))throw Error('없는 문서 '+p);return {data:W(db[p])};},exists:p=>p in db};
 ctx.request.time=TIME;
 for(const r of rules){if(!r.ops.some(o=>OPS[op].includes(o)))continue;const vars=bind(r.segs,parts);if(!vars)continue;
  try{if(new Function('__ctx',`with(__ctx){${fnCode}\nreturn (${js(r.cond)});}`)({...ctx,...vars,request:ctx.request})===true)return true;}catch{}
 }
 return false;
}

// ---------- 가상 계정 ----------
const ADMIN={email:'hint.kpc@gmail.com'},ADMIN2={email:'kpc.jtkim@gmail.com'},T3={email:'t3@example.com'},T4={email:'t4@example.com'},OFF={email:'off@example.com'},OPS_ADMIN={email:'ops@example.com'},STRANGER={email:'stranger@example.com'};
const DB={'users/t3@example.com':{role:'TEACHER',active:true,classId:'3',primaryClassId:'3',tempClassIds:['5'],classIds:['3','5']},'users/t4@example.com':{role:'TEACHER',active:true,primaryClassId:'4',classId:'4',tempClassIds:[]},
 'users/off@example.com':{role:'TEACHER',active:false,primaryClassId:'3'},'users/ops@example.com':{role:'ADMIN',active:true}};
const can=(op,path,o={})=>allowed(op,path,{db:DB,...o});
const REQ=(o={})=>({classId:'3',date:'2026-11-05',name:'가상학생',phoneLast4:'1234',reason:'가상 사유',changes:{entry:'09:00:00'},createdBy:T3.email,createdAt:TIME,updatedAt:TIME,status:'pending',...o});

test('the rules file parses and every path is closed unless listed (default deny)',()=>{
 assert.ok(rules.length>30);assert.ok(functions.some(f=>f.name==='validRequestChanges'));
 for(const who of [ADMIN,T3,null])for(const op of ['get','create','update','delete'])assert.equal(can(op,'operationsWork/x',{auth:who,next:{a:1},data:{a:1}}),false,'unknown collection');
 assert.equal(can('get','settings/global'),false,'signed out');
 assert.equal(can('get','users/t3@example.com',{auth:{...T3,verified:false}}),false,'unverified email');
});

test('users: self or admin read, admin-only writes; bootstrap and registered admins are admins, inactive teachers are nobody',()=>{
 assert.equal(can('get','users/t3@example.com',{auth:T3,data:DB['users/t3@example.com']}),true);
 assert.equal(can('get','users/t4@example.com',{auth:T3,data:DB['users/t4@example.com']}),false);
 for(const a of [ADMIN,ADMIN2,OPS_ADMIN])assert.equal(can('update','users/t4@example.com',{auth:a,data:{},next:{role:'TEACHER'}}),true,a.email);
 assert.equal(can('create','users/x@example.com',{auth:T3,next:{role:'ADMIN'}}),false);
 assert.equal(can('get','classes/3',{auth:OFF,data:{}}),false,'inactive teacher');
 assert.equal(can('get','classes/3',{auth:STRANGER,data:{}}),false);
});

test('teachers see only their own classes (primary and temporary), admins write only classes 1..16',()=>{
 for(const [path,ok] of [['classes/3',true],['classes/5',true],['classes/4',false],['classes/3/customLinks/a',true],['classes/4/customLinks/a',false],['timetableBetaPublished/3',true],['timetableBetaPublished/4',false],['attendanceBetaSummaries/5',true],['attendanceBetaSummaries/16',false],['surveyBetaSummaries/3/surveys/e1',true],['lectureMaterialsBeta/4/items/i',false]])
  assert.equal(can('get',path,{auth:T3,data:{classId:path.split('/')[1]}}),ok,path);
 for(const path of ['classes/3/checkhereCurrent/2026-11-05','classes/3/checkhereSnapshots/s','timetableBetaDrafts/3','checkhereProposalDrafts/d','checkhereProposalSources/s','checkhereIdentities/3'])assert.equal(can('get',path,{auth:T3,data:{}}),false,path);
 assert.equal(can('update','classes/16',{auth:ADMIN,data:{},next:{urgentActive:true}}),true);
 assert.equal(can('update','classes/18',{auth:ADMIN,data:{},next:{urgentActive:true}}),false,'반 18은 없음');assert.equal(can('update','classes/17',{auth:ADMIN,data:{},next:{urgentActive:true}}),true,'17반은 시험용 테스트반');
 assert.equal(can('update','classes/3',{auth:T3,data:{},next:{urgentActive:true}}),false,'담임은 반 문서를 못 씀');
 assert.equal(can('delete','classes/3',{auth:ADMIN,data:{}}),false);
 const att=(cid,o={})=>({classId:cid,version:'v',asOf:'2027-01-04',latestDate:'2027-01-04',latestEntered:true,dates:[],students:[],fingerprint:'f',syncedAt:'s',updatedBy:ADMIN.email,updatedAt:TIME,...o});
 assert.equal(can('create','attendanceBetaSummaries/16',{auth:ADMIN,next:att('16')}),true);assert.equal(can('create','attendanceBetaSummaries/18',{auth:ADMIN,next:att('18')}),false);
});

// 날짜는 모양(YYYY-MM-DD)만: 교육 기간 밖·주말·미래도 됨(사용자 결정 2026-10-20 '둘다 넓혀'), 반은 1~17만.
const ANY_DATES=['2026-10-28','2027-01-22','2027-01-04','2026-10-27','2027-01-23','2026-10-20','2027-03-01','2026-09-03','2028-01-04','2026-10-24'],BAD_DATES=['2026-13-01','abc','2026-10-32','2026-00-10','2026-1-05','20261020','2026-10-20T00:00',''];
test('checkhereCurrent: administrators, classes 1..17, any YYYY-MM-DD date (outside the course period, weekends and future too)',()=>{
 const cur=(cid,date)=>({classId:cid,date,records:[],jobId:'j',updatedBy:ADMIN.email,updatedAt:TIME});
 for(const [cid,date,ok] of [['16','2026-11-05',true],['17','2026-11-05',true],['18','2026-11-05',false],...ANY_DATES.map(d=>['3',d,true]),...BAD_DATES.filter(Boolean).map(d=>['3',d,false])])
  assert.equal(can('create',`classes/${cid}/checkhereCurrent/${date}`,{auth:ADMIN,next:cur(cid,date)}),ok,cid+' '+date);
 assert.equal(can('create','classes/3/checkhereCurrent/2026-11-05',{auth:T3,next:{...cur('3','2026-11-05'),updatedBy:T3.email}}),false);
 assert.equal(can('create','classes/3/checkhereCurrent/2026-11-05',{auth:ADMIN,next:{...cur('3','2026-11-05'),extra:1}}),false);
});

test('checkhereRequests: own-class teacher requests on any YYYY-MM-DD date, admin-only time deletion, single approver',()=>{
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ()}),true);
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({classId:'5'})}),true,'임시담당반');
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({classId:'4'})}),false,'다른 반');
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({date:'2027-01-22'})}),true);
 for(const date of ANY_DATES)assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({date})}),true,date);
 for(const date of BAD_DATES)assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({date})}),false,date);
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({date:20261020})}),false,'날짜는 글자');
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({createdBy:T4.email})}),false,'작성자 위장');
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({status:'approved'})}),false);
 assert.equal(can('create','checkhereRequests/r1',{auth:T3,next:REQ({changes:{exit:''},deleteTimes:['exit']})}),false,'담임은 시간 삭제 못 함');
 assert.equal(can('create','checkhereRequests/r1',{auth:ADMIN,next:REQ({classId:'16',createdBy:ADMIN.email,changes:{exit:'',exitMemo:''},deleteTimes:['exit']})}),true);
 assert.equal(can('create','checkhereRequests/r1',{auth:ADMIN,next:REQ({classId:'18',createdBy:ADMIN.email})}),false);
 assert.equal(can('create','checkhereRequests/r1',{auth:ADMIN,next:REQ({createdBy:ADMIN.email,changes:{exit:''}})}),false,'deleteTimes 없는 빈 시간');
 // 읽기: 관리자 전부, 담임은 자기가 만든 자기 반 요청만
 assert.equal(can('get','checkhereRequests/r1',{auth:T3,data:REQ()}),true);assert.equal(can('get','checkhereRequests/r1',{auth:T4,data:REQ()}),false);
 assert.equal(can('get','checkhereRequests/r1',{auth:T3,data:REQ({createdBy:ADMIN.email})}),false);assert.equal(can('get','checkhereRequests/r1',{auth:ADMIN2,data:REQ()}),true);
 // 승인은 지정 승인자만, 지운 쪽은 after에 ''
 const pending=REQ({createdBy:ADMIN.email,changes:{exit:''},deleteTimes:['exit']});
 const approve=(after)=>({...pending,status:'approved',approval:{recordId:'r',version:'v',before:{},after,reason:pending.reason},approvedBy:ADMIN.email,approvedAt:TIME,updatedAt:TIME});
 assert.equal(can('update','checkhereRequests/r1',{auth:ADMIN,data:pending,next:approve({exit:'',entry:'09:00:00'})}),true);
 assert.equal(can('update','checkhereRequests/r1',{auth:ADMIN,data:pending,next:approve({exit:'18:00:00'})}),false,'지운 쪽이 남음');
 assert.equal(can('update','checkhereRequests/r1',{auth:ADMIN2,data:pending,next:{...approve({exit:''}),approvedBy:ADMIN2.email}}),false,'승인자는 한 명');
 assert.equal(can('update','checkhereRequests/r1',{auth:T3,data:REQ(),next:{...REQ(),status:'withdrawn',withdrawnBy:T3.email,withdrawnAt:TIME,updatedAt:TIME}}),true,'작성자 취소');
 assert.equal(can('delete','checkhereRequests/r1',{auth:ADMIN,data:REQ()}),false);
});

test('settings: teachers read only global and non-class documents; class documents, relay and switches stay admin-only',()=>{
 for(const [id,ok] of [['global',true],['timetableBetaCatalog',true],['surveyBetaConfig',true],['surveyAutoSync',true],['reasonCatalog',true],['attendanceBeta_3_2026-11-05',false],['attendanceOverviewMemo_3_2026-11-05',false],['checkhereRelay',false],['checkhereFeatures',false],['attendanceReviewLive_3_x',false]])
  assert.equal(can('get','settings/'+id,{auth:T3,data:{}}),ok,id);
 assert.equal(can('get','settings/checkhereRelay',{auth:ADMIN,data:{}}),true);assert.equal(can('update','settings/global',{auth:ADMIN,data:{},next:{notice:'x'}}),true);
 assert.equal(can('update','settings/global',{auth:T3,data:{},next:{notice:'x'}}),false);assert.equal(can('get','settings/global',{auth:OFF,data:{}}),false);
});

test('checkhereIdentities: the CheckHere roster link is admin-only and shaped',()=>{
 const doc=(cid,o={})=>({classId:cid,students:[{name:'가상학생',last4:'1234',attendeeId:'att-1',updatedAt:'2026-11-05T09:00:00Z'}],updatedBy:ADMIN.email,updatedAt:TIME,...o});
 assert.equal(can('create','checkhereIdentities/3',{auth:ADMIN,next:doc('3')}),true);assert.equal(can('get','checkhereIdentities/3',{auth:ADMIN2,data:doc('3')}),true);
 assert.equal(can('get','checkhereIdentities/3',{auth:T3,data:doc('3')}),false);assert.equal(can('create','checkhereIdentities/3',{auth:T3,next:{...doc('3'),updatedBy:T3.email}}),false);
 assert.equal(can('create','checkhereIdentities/18',{auth:ADMIN,next:doc('18')}),false);assert.equal(can('create','checkhereIdentities/3',{auth:ADMIN,next:doc('3',{phone:'010'})}),false,'정해진 칸만');
 assert.equal(can('create','checkhereIdentities/3',{auth:ADMIN,next:doc('4')}),false);assert.equal(can('delete','checkhereIdentities/3',{auth:ADMIN,data:doc('3')}),false);
});

test('notifications (notify.mjs shape): teachers notify admins or their own class, recipients and admins read, readers only add themselves to readBy',()=>{
 const note=(o={})=>Object.fromEntries(Object.entries({kind:'민원',title:'3반 민원 접수',body:'가상 알림',cls:'3',link:'#b2vocs?cls=3',to:[ADMIN.email,ADMIN2.email],toRole:'admin',from:T3.email,readBy:[T3.email],createdAt:TIME,...o}).filter(([,v])=>v!==undefined));// undefined = 그 칸 없음
 assert.equal(can('create','notifications/n1',{auth:T3,next:note()}),true,'담임 → 운영자');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({toRole:undefined,to:[T4.email]})}),false,'담임 → 다른 담임(운영자·자기 반 표시 없음) 안 됨');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({from:ADMIN.email,readBy:[ADMIN.email]})}),false,'보낸 사람 위장');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({readBy:[]})}),false,'readBy는 보낸 사람 하나');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({cls:'4'})}),false,'다른 반 이름으로');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({toClass:'4'})}),false,'다른 반 담임에게');
 assert.equal(can('create','notifications/n1',{auth:STRANGER,next:note({from:STRANGER.email,readBy:[STRANGER.email]})}),false,'등록 안 된 계정');
 assert.equal(can('create','notifications/n1',{auth:ADMIN,next:note({to:[],toRole:undefined,toClass:'4',cls:'4',from:ADMIN.email,readBy:[ADMIN.email],kind:'서류발급'})}),true,'운영자 → 4반 담임');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({kind:'기타'})}),false,'정해진 종류만');
 // 추가 증빙(취업박람회 기업면접 확인서, notify-core KINDS): 담임이 운영자(toRole admin) + 자기 반(toClass)으로 보냄
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({kind:'추가 증빙',toClass:'3',link:'#b2ledger?cls=3&date=2026-11-05'})}),true,'담임 추가 증빙 → 운영자 + 자기 반');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({kind:'추가 증빙',toClass:'5',cls:'5'})}),true,'임시담당반도');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({kind:'추가 증빙',toClass:'4'})}),false,'다른 반 담임에게는 안 됨');
 assert.equal(can('create','notifications/n1',{auth:ADMIN,next:note({kind:'추가 증빙',toClass:'4',cls:'4',from:ADMIN.email,readBy:[ADMIN.email]})}),true,'운영자 추가 증빙');
 // 중도탈락(beta2-dropouts.mjs): 담임 등록 → 운영자, 다른 반 이름으로는 안 됨
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({kind:'중도탈락',link:'#b2dropouts?cls=3'})}),true,'담임 중도탈락 → 운영자');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({kind:'중도탈락',cls:'4'})}),false,'다른 반 중도탈락');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({body:'x'.repeat(161)})}),false);
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({to:Array.from({length:11},(_,i)=>`a${i}@example.com`)})}),false,'받는 사람 10명까지');
 assert.equal(can('create','notifications/n1',{auth:T3,next:note({text:'옛 칸'})}),false,'정해진 칸만');
 const stored=note();
 assert.equal(can('get','notifications/n1',{auth:ADMIN,data:stored}),true);assert.equal(can('get','notifications/n1',{auth:T4,data:stored}),false);
 const toFour=note({to:[],toRole:undefined,toClass:'4',cls:'4',from:ADMIN.email,readBy:[ADMIN.email]});
 assert.equal(can('get','notifications/n1',{auth:T4,data:toFour}),true,'그 반 담임');assert.equal(can('get','notifications/n1',{auth:T3,data:toFour}),false);
 assert.equal(can('update','notifications/n1',{auth:ADMIN,data:stored,next:{...stored,readBy:[T3.email,ADMIN.email]}}),true,'받는 사람이 읽음 표시');
 assert.equal(can('update','notifications/n1',{auth:ADMIN,data:stored,next:{...stored,readBy:[T3.email,ADMIN2.email]}}),false,'다른 사람 이름으로 읽음 안 됨');
 assert.equal(can('update','notifications/n1',{auth:ADMIN,data:stored,next:{...stored,body:'바꿈'}}),false);
 assert.equal(can('update','notifications/n1',{auth:T4,data:toFour,next:{...toFour,readBy:[ADMIN.email,T4.email]}}),true,'반 담임 읽음');
 assert.equal(can('update','notifications/n1',{auth:T3,data:toFour,next:{...toFour,readBy:[ADMIN.email,T3.email]}}),false,'받는 사람이 아니면 못 바꿈');
 assert.equal(can('delete','notifications/n1',{auth:ADMIN,data:stored}),false);
});

test('rules ranges, admins and approver are the same values as cohort.json; time-delete helpers match the design text',()=>{
 assert.ok(src.includes(`c.matches('${C.classIdPattern().replace('(?:','(')}')`),'반 정규식 = cohort');assert.equal(C.classIdPattern(),'(?:[1-9]|1[0-7])','16개 반 + 17반 시험용 테스트반');
 assert.ok(src.includes("function validDate(d){return d is string && d.matches('[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])');}"),'날짜는 모양만');
 assert.ok(!/courseDate|d *[<>]=? *'20\d\d-/.test(src),'날짜 기간 비교 없음(2026-10-20부터)');assert.equal((src.match(/validDate\(/g)||[]).length,4,'validDate 정의 + 쓰는 곳 3(요청·현재 기록·추천 초안)');
 assert.ok(src.includes(`function bootstrapEmail(e){return ${C.ADMINS.map(a=>`e=='${a}'`).join('||')};}`),'관리자 = cohort');
 assert.ok(src.includes(`email()=='${C.APPROVER}'`),'승인자 = cohort');
 assert.ok(!/2026-07-27|2026-10-22|'2026-\[0-9\]/.test(src),'1기 기간 없음');assert.equal(src.match(/(?<!\d)\[1-9\]\|1\[0-\d\]/g).join(),'[1-9]|1[0-7]','반 정규식은 validClass 한 곳(17 = 시험용 테스트반)');
 const plan=readFileSync(new URL('../../docs/beta2-instant-edit-plan.md',import.meta.url),'utf8').replace(/\r\n/g,'\n'),from=plan.indexOf('function hhmmss(');
 const spec=plan.slice(from,plan.indexOf('```',from)).trim().split('\n').map(s=>s.trim());
 for(const line of spec)assert.ok(src.split('\n').some(l=>l.trim()===line),line.slice(0,40));
});

test('checkhereProposalDrafts: admin drafts on any YYYY-MM-DD date, class 1..17',()=>{
 const draft=(o={})=>({classId:'3',date:'2026-11-05',students:{},updatedBy:ADMIN.email,updatedAt:TIME,...o});
 for(const date of ANY_DATES)assert.equal(can('create','checkhereProposalDrafts/d1',{auth:ADMIN,next:draft({date})}),true,date);
 for(const date of BAD_DATES)assert.equal(can('create','checkhereProposalDrafts/d1',{auth:ADMIN,next:draft({date})}),false,date);
 assert.equal(can('create','checkhereProposalDrafts/d1',{auth:ADMIN,next:draft({classId:'18'})}),false);assert.equal(can('create','checkhereProposalDrafts/d1',{auth:T3,next:draft({updatedBy:T3.email})}),false);
});

test('notification kinds in the rules are exactly notify-core KINDS (same order)',()=>{
 const m=/d\.kind in \[([^\]]*)\]/.exec(src);assert.ok(m,'validNotification kind 목록');
 assert.deepEqual(m[1].split(',').map(s=>s.trim().replace(/^'|'$/g,'')),[...KINDS]);
});

test('settings/reasonCatalog: teachers read, admins write with rev+1 and the fixed shape, nobody deletes',()=>{
 const doc=(o={})=>({catalog:{cats:[{id:'a',label:'병원·질병'}]},rev:1,updatedBy:ADMIN.email,updatedAt:TIME,...o});
 assert.equal(can('get','settings/reasonCatalog',{auth:T3,data:doc()}),true);
 assert.equal(can('create','settings/reasonCatalog',{auth:ADMIN,next:doc()}),true);
 assert.equal(can('create','settings/reasonCatalog',{auth:ADMIN,next:doc({rev:2})}),false,'first save is rev 1');
 assert.equal(can('update','settings/reasonCatalog',{auth:ADMIN,data:doc(),next:doc({rev:2})}),true);
 assert.equal(can('update','settings/reasonCatalog',{auth:ADMIN,data:doc({rev:2}),next:doc({rev:2})}),false,'stale rev');
 assert.equal(can('update','settings/reasonCatalog',{auth:ADMIN,data:doc(),next:doc({rev:2,updatedBy:ADMIN2.email})}),false,'updatedBy is the saver');
 assert.equal(can('update','settings/reasonCatalog',{auth:ADMIN,data:doc(),next:doc({rev:2,extra:1})}),false);
 assert.equal(can('update','settings/reasonCatalog',{auth:ADMIN,data:doc(),next:doc({rev:2,catalog:{cats:[]}})}),false,'empty list');
 assert.equal(can('update','settings/reasonCatalog',{auth:T3,data:doc(),next:doc({rev:2,updatedBy:T3.email})}),false);
 assert.equal(can('delete','settings/reasonCatalog',{auth:ADMIN,data:doc()}),false);
 assert.equal(can('delete','settings/global',{auth:ADMIN,data:{}}),true);
});
