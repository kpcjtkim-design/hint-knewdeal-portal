import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,basename} from 'node:path';

// 2기 지킴이: Vercel이 배포하는 파일(git이 관리하는 파일 - .vercelignore)에 1기 식별자가 없어야 합니다.
// 1기 시트 id·1기 Apps Script 배포 주소·1기 Firebase 프로젝트 id(주석 밖)·cohort.json과 다른 반 정규식·반 수를 박아 둔 목록.
// 2기 반 정규식은 cohort.json 반 수에서 만듭니다(2026-10-20부터 1~16반 + 17반 시험용 테스트반 = 1[0-7]). 그 밖의 1[0-N]은 옛 값입니다. 시험 파일(checkhere/tests)·docs·tools·apps-script는 배포하지 않아 보지 않습니다.
const root=join(import.meta.dirname,'../..');
const files=execFileSync('git',['-C',root,'ls-files'],{encoding:'utf8'}).split('\n').filter(Boolean);
const ignore=readFileSync(join(root,'.vercelignore'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')).map(p=>{
 const dir=p.endsWith('/'),body=p.replace(/\/$/,'').replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'[^/]*');
 return p.includes('/')?new RegExp(`^${body}${dir?'/':'$'}`):new RegExp(`(^|/)${body}${dir?'/':'$'}`);
});
const deployed=files.filter(f=>!ignore.some(re=>re.test(f))&&!/^\.(git|github)\//.test(f)&&/\.(html|mjs|js|cjs|json|css|svg|txt|md)$/.test(f));
const SHEETS=['1KyY9t6i23_YYXKpe-2Md8BpZFGdJNlmV9r0SP4_XdMc','1rVwWjo6EOdlRoqtrZ4v4d68vXbC2Pw7HQ3zaNpKIE34','1ZU6IxnP3CqFQGB1UxC3XB9mhrC40ZArG-0cQGdLqljI'];
const COHORT_JSON=JSON.parse(readFileSync(join(root,'cohort.json'),'utf8')),CLASS_N=COHORT_JSON.classes.length,CLASS_TAIL=CLASS_N>10?`1[0-${CLASS_N-10}]`:'';
const SCRIPTS=['AKfycbxKN_','AKfycbxL2u','AKfycbzNcSYQf3JO','AKfycbzQF_ikT0z','AKfycbxE4sXaG3r6'];
// 주석을 뺀 코드(// 줄 주석·/* */·<!-- -->). 문자열 안의 'https://'는 그대로 둡니다.
const code=t=>t.replace(/<!--[\s\S]*?-->/g,'').replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>{const i=l.search(/(^|[\s;,{}()])\/\/(?!\/)/);return i<0?l:l.slice(0,i+(l[i]==='/'?0:1));}).join('\n');
function problems(f){
 const t=readFileSync(join(root,f),'utf8'),out=[];
 for(const id of SHEETS)if(t.includes(id))out.push('1기 시트 id '+id.slice(0,8));
 for(const s of SCRIPTS)if(t.includes(s))out.push('1기 Apps Script '+s);
 if(/(?<![\w-])knewdeal-portal(?![\w-])/.test(code(t)))out.push("1기 Firebase 프로젝트 'knewdeal-portal'");
 for(const m of t.matchAll(/(?<!\d)\[1-9\]\|(1\[0-\d\])/g))if(m[1]!==CLASS_TAIL)out.push(`cohort.json(${CLASS_N}개 반)과 다른 반 정규식 ${m[1]}`);
 if(/length:\s*1[67]\b/.test(code(t)))out.push('반 수를 박아 둔 목록(cohort CLASS_COUNT·REAL_CLASS_COUNT를 쓰세요)');
 if(/\.(mjs|js|cjs|html)$/.test(f)&&/'2026-07-27'|'2026-10-22'|\^2026-\\d/.test(code(t)))out.push('1기 기간·2026 고정 날짜');
 if(t.includes('AKfycbzChr0p'))out.push('2기 데이터 API 주소는 Vercel 환경변수에만(HINT_SHEET_API_URL)');
 return out;
}
// 연결 프로그램 2기판을 맡은 다른 작업 트리에서 고치는 파일(이 브랜치에서는 손대지 않음). 합쳐진 뒤에는 이 목록을 비웁니다.
const OTHER_WORKTREE=new Set([]);// 연결 프로그램 2기판(cohort2-bridge)이 합쳐져 비움(2026-10-20)

test('the guard sees the deployed 2기 files and skips undeployed ones',()=>{
 for(const f of ['index.html','cohort.mjs','cohort.json','api/teacher-beta.js','lib/cohort.cjs','beta2-ledger.mjs','checkhere/rules.mjs','checkhere/approval-core.mjs','survey-catalog.json','vercel.json'])assert.ok(deployed.includes(f),f);
 for(const f of deployed)assert.ok(!/^(apps-script|docs|tools)\/|^checkhere\/tests\/|^checkhere\/(server|collector|cloud-approval|firebase-public)\.mjs$|\.rules$/.test(f),f);
 assert.ok(deployed.length>80);
 // 지킴이가 실제로 잡는지
 assert.ok(/(?<![\w-])knewdeal-portal(?![\w-])/.test(code("const p='knewdeal-portal';")));assert.ok(!/(?<![\w-])knewdeal-portal(?![\w-])/.test(code("// 1기 knewdeal-portal\nconst repo='hint-knewdeal-portal';")));
});

test('deployed 2기 files carry no 1기 sheet ids, 1기 Apps Script URLs, 1기 Firebase project id or 17-class patterns',()=>{
 const found=deployed.filter(f=>!OTHER_WORKTREE.has(f)).map(f=>[f,problems(f)]).filter(([,p])=>p.length);
 assert.deepEqual(found,[],found.map(([f,p])=>`${f}: ${p.join(', ')}`).join('\n'));
});

for(const f of OTHER_WORKTREE)test(`(other worktree) ${f} has no 1기 identifiers`,{todo:'연결 프로그램 2기판(다른 작업 트리)에서 고치는 중 — 합쳐지면 todo를 뺍니다'},()=>{
 assert.deepEqual(problems(f),[]);
});

test('Firebase project and keys come from cohort.json only',()=>{
 const json=JSON.parse(readFileSync(join(root,'cohort.json'),'utf8'));
 assert.equal(json.firebase.projectId,'hint-knewdeal-2');
 const withKey=deployed.filter(f=>readFileSync(join(root,f),'utf8').includes(json.firebase.apiKey));
 assert.deepEqual(withKey.filter(f=>!['cohort.json','cohort.mjs'].includes(f)),[],'2기 웹 키는 cohort.json(과 사본 cohort.mjs)에만');
 assert.ok(!deployed.some(f=>basename(f)==='old.js'),'/old는 vercel.json 넘김');
});
