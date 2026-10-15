import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// 시간 삭제 규칙 초안(checkhere-time-delete.rules.txt)은 게시하지 않은 통째 사본입니다. 에뮬레이터 없이 글자만 비교합니다.
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const live=read('firestore.rules'),draft=read('checkhere-time-delete.rules.txt');
// head는 '{'로 끝나는 match 머리. 중괄호 짝으로 그 블록만 잘라 냅니다(정규식 안 {4} 같은 것도 짝이 맞음).
const block=(src,head)=>{const i=src.indexOf(head);assert.ok(i>=0,head);let d=1,j=i+head.length;for(;d&&j<src.length;j++)d+=src[j]==='{'?1:src[j]==='}'?-1:0;return src.slice(i,j);};
const allow=(blk,kind,n=0)=>{let i=-1;for(let k=0;k<=n;k++)i=blk.indexOf(`allow ${kind}:`,i+1);assert.ok(i>=0,kind);return blk.slice(i,blk.indexOf(';',i)+1);};
const REQ='match /checkhereRequests/{requestId}{',SRC='match /checkhereProposalSources/{sourceId}{';
// 승인자 update를 상태 분기별로 나눕니다: [0] 승인, [1] 반려, [2] applying, [3] 결과
const branches=src=>allow(block(src,REQ),'update').split(/\n\s*\|\| \(/);
const HELPERS=['hhmmss','memoOk','reqTimeOk','deletedMemoBlank','validRequestChanges','afterTimeOk','validAfter'];
const VALID_END="(c.exitMemo is string && c.exitMemo.size()<=500));\n    }\n";
// 설계 7장의 네 부분: [지금 firestore.rules 글, 초안 글]
const FOUR=[
 ["'reason','changes','createdBy'","'reason','changes','deleteTimes','createdBy'"],
 ["        && validChanges(request.resource.data.changes)\n        && request.resource.data.createdBy==email() && request.resource.data.status=='pending'",
  "        && (!('deleteTimes' in request.resource.data) || (isAdmin() && request.resource.data.deleteTimes is list && request.resource.data.deleteTimes.size()>0))\n        && validRequestChanges(request.resource.data.changes, request.resource.data.get('deleteTimes',[]))\n        && request.resource.data.createdBy==email() && request.resource.data.status=='pending'"],
 ["          && validChanges(request.resource.data.approval.after))","          && validAfter(request.resource.data.approval.after, resource.data.get('deleteTimes',[])))"],
];
const helperText=src=>{const i=src.indexOf(VALID_END)+VALID_END.length;return src.slice(i,src.indexOf('    '+REQ,i));};

test('draft create allows deleteTimes only from administrators and validates changes against it',()=>{
 const create=allow(block(draft,REQ),'create');
 assert.match(create,/request\.resource\.data\.keys\(\)\.hasOnly\(\[[^\]]*'deleteTimes'[^\]]*\]\)/);
 assert.ok(create.includes("(!('deleteTimes' in request.resource.data) || (isAdmin() && request.resource.data.deleteTimes is list && request.resource.data.deleteTimes.size()>0))"));
 assert.ok(create.includes("validRequestChanges(request.resource.data.changes, request.resource.data.get('deleteTimes',[]))"));
 assert.ok(!create.includes('validChanges('),'create는 더 이상 validChanges를 쓰지 않음');
 // 담임 경로(requestTeacherOwns)는 그대로 두고, deleteTimes는 isAdmin()일 때만
 assert.ok(create.includes('(isAdmin() || requestTeacherOwns(request.resource.data.classId))'));
});

test('draft approval branch uses validAfter with the stored deleteTimes; other branches unchanged',()=>{
 const d=branches(draft),l=branches(live);
 assert.equal(d.length,4);assert.equal(l.length,4);
 assert.match(d[0],/request\.resource\.data\.status=='approved'/);
 assert.ok(d[0].includes("validAfter(request.resource.data.approval.after, resource.data.get('deleteTimes',[]))"));
 assert.ok(!d[0].includes('validChanges('));
 assert.deepEqual(d.slice(1),l.slice(1),'반려·applying·결과 분기는 그대로');
 assert.equal(allow(block(draft,REQ),'update',1),allow(block(live,REQ),'update',1),'작성자 취소(withdrawn)는 그대로');
 assert.equal(allow(block(draft,REQ),'read'),allow(block(live,REQ),'read'));
 assert.match(block(draft,REQ),/allow delete: if false;/);
});

test('checkhereProposalSources and validChanges stay exactly as in firestore.rules',()=>{
 assert.equal(block(draft,SRC),block(live,SRC));
 assert.ok(block(draft,SRC).includes('validChanges(request.resource.data.changes)'));
 assert.equal(block(draft,'function validChanges(c){'),block(live,'function validChanges(c){'));
});

test('draft differs from firestore.rules only by the four parts and the added helper functions',()=>{
 const helpers=helperText(draft);
 const lines=helpers.trimEnd().split('\n');
 assert.deepEqual(lines.filter(s=>!/^\s*\/\//.test(s)).map(s=>s.match(/^    function (\w+)\(/)?.[1]),HELPERS,'추가 함수만, 설계 순서대로');
 assert.ok(lines.every(s=>/^    (\/\/ |function \w+\([\w,]*\)\{return .+;\}$)/.test(s)),'한 줄 함수 또는 주석');
 // 함수 본문은 설계 문서 7장 '규칙 초안 내용'의 글과 한 글자도 달라서는 안 됩니다(규칙을 다시 만들 때 회귀를 잡기 위해).
 const plan=readFileSync(new URL('../../docs/beta2-instant-edit-plan.md',import.meta.url),'utf8').replace(/\r\n/g,'\n'),from=plan.indexOf('function hhmmss(');
 const spec=plan.slice(from,plan.indexOf('```',from)).trim().split('\n').map(s=>s.trim());
 assert.deepEqual(lines.filter(s=>!/^\s*\/\//.test(s)).map(s=>s.trim()),spec);
 let expected=live;
 for(const [a,b] of FOUR){assert.equal(expected.split(a).length,2,'한 번만 나와야 함: '+a.trim().slice(0,60));expected=expected.replace(a,b);}
 assert.equal(expected.split(VALID_END).length,2);
 expected=expected.replace(VALID_END,VALID_END+helpers);
 assert.equal(draft,expected);
 assert.equal(draft.split('\n').length-live.split('\n').length,lines.length+1);
 // 글자 바깥의 괄호 짝(붙여 넣기 전 오타 확인용, Firestore 문법 검사는 아님)
 const bare=draft.replace(/'[^'\n]*'/g,"''").replace(/\/\/.*$/gm,'');
 for(const [o,c] of [['(',')'],['[',']'],['{','}']])assert.equal(bare.split(o).length,bare.split(c).length,o+c);
 assert.match(draft,/^rules_version = '2';\nservice cloud\.firestore \{/);
});

test('firestore.rules itself has no deleteTimes and keeps the HH:MM:SS-only validChanges',()=>{
 assert.ok(!live.includes('deleteTimes'));
 for(const name of HELPERS)assert.ok(!live.includes(`function ${name}(`),name);
 assert.ok(live.includes("&& request.resource.data.keys().hasOnly(['classId','date','name','phoneLast4','reason','changes','createdBy','createdAt','updatedAt','status'])"));
 assert.ok(live.includes("(!('entry' in c) || (c.entry is string && c.entry.matches('([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]')))"));
 assert.equal((live.match(/validChanges\(request\.resource\.data\.(changes|approval\.after)\)/g)||[]).length,3);
 // 날짜 범위는 두 파일 모두 그대로
 for(const src of [live,draft])assert.equal((src.match(/>= ?'2026-07-27' && [\w.]+ ?<= ?'2026-10-22'/g)||[]).length,2);
});

// 규칙 함수 글을 그대로 JS로 옮겨 가상 값으로 돌려 봅니다. 뜻(허용·거부)만 보고 Firestore 문법은 보지 않습니다.
class S{constructor(s){this.s=s;}matches(re){return new RegExp('^(?:'+re+')$').test(this.s);}size(){return this.s.length;}valueOf(){return this.s;}toString(){return this.s;}}
const R=v=>typeof v==='string'?new S(v):Array.isArray(v)?new Proxy(v,{has:(t,k)=>t.includes(k),get:(t,k)=>k==='size'?()=>t.length:k==='hasOnly'?l=>t.every(x=>l.includes(x)):t[k]})
 :v&&typeof v==='object'?new Proxy(v,{has:(t,k)=>Object.hasOwn(t,k),get:(t,k)=>k==='keys'?()=>R(Object.keys(t)):R(t[k])}):v;
const is=(v,t)=>t==='string'?v instanceof S:t==='list'?Array.isArray(v):t==='map'?!!v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof S):false;
const model=src=>{
 const fns=[...src.matchAll(/function (\w+)\(([\w,]*)\)\{\s*return ([\s\S]*?);\s*\}/g)].filter(m=>m[1]==='validChanges'||HELPERS.includes(m[1]));
 const js=fns.map(([,name,args,body])=>`function ${name}(${args}){return ${body.replace(/([\w.[\]]+) is (string|list|map)\b/g,"is($1,'$2')")};}`).join('\n');
 const f=new Function('is',`${js}\nreturn {${fns.map(m=>m[1]).join(',')}};`)(is);
 return Object.fromEntries(Object.entries(f).map(([k,fn])=>[k,(...a)=>fn(...a.map(R))]));
};

test('helper logic: requests without deleteTimes behave exactly like validChanges; deletion needs the matching blank side',()=>{
 const m=model(draft);
 assert.deepEqual(Object.keys(m).sort(),['validChanges',...HELPERS].sort());
 const samples=[{entry:'09:00:00'},{exit:'18:00:05',exitMemo:'조퇴_담임:가상담임(17:00)'},{entry:'9:00:00'},{entry:'24:00:00'},{entry:'09:00'},{entry:''},{exit:''},{entryMemo:''},{entryMemo:'x'.repeat(500)},
  {entryMemo:'x'.repeat(501)},{entry:'',entryMemo:''},{},{foo:'1'},{entry:5},{entry:null},{entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:''},'09:00:00',['entry']];
 for(const c of samples){const want=m.validChanges(c);assert.equal(typeof want,'boolean');
  assert.equal(m.validRequestChanges(c,[]),want,JSON.stringify(c));assert.equal(m.validAfter(c,[]),want,JSON.stringify(c));}
 // 설계 7장 '게시 안내' 4번의 플레이그라운드 경우(관리자 조건은 create 줄이 따로 봄)
 assert.equal(m.validRequestChanges({entry:'',entryMemo:''},['entry']),true);
 assert.equal(m.validRequestChanges({entry:'',entryMemo:''},[]),false);
 const ok=[[{entry:''},['entry']],[{exit:'',exitMemo:''},['exit']],[{entry:'',exit:''},['entry','exit']],[{entry:'',exit:'18:00:00',exitMemo:'조퇴_담임:가상담임(17:00)'},['entry']]];
 const bad=[[{entry:'09:00:00'},['entry']],[{exit:''},['entry']],[{entry:'',entryMemo:'지각_담임:가상담임(09:25)'},['entry']],[{entry:''},['entry','other']],[{entry:''},'entry'],
  [{entry:'',exit:''},['entry','exit','entry']],[{exitMemo:''},['exit']],[{entry:'',exit:''},['entry']]];
 for(const [c,d] of ok)assert.equal(m.validRequestChanges(c,d),true,JSON.stringify([c,d]));
 for(const [c,d] of bad)assert.equal(m.validRequestChanges(c,d),false,JSON.stringify([c,d]));
 // 승인 값: 지운 쪽은 after에 ''로 남아야 하고, 지우지 않은 쪽 ''는 거부
 assert.equal(m.validAfter({entry:'',entryMemo:''},['entry']),true);
 assert.equal(m.validAfter({entry:'',exit:'18:00:00'},['entry']),true);
 assert.equal(m.validAfter({exit:'18:00:00'},['entry']),false);
 assert.equal(m.validAfter({entry:'09:00:00'},['entry']),false);
 assert.equal(m.validAfter({entry:'',exit:''},['entry']),false);
 assert.equal(m.validAfter({entry:''},'entry'),false);
});
