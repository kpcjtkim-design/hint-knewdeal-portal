// cohort.json(원본) → cohort.mjs 안의 DATA 사본을 맞춥니다. 사용: node tools/build-cohort.mjs (--check면 고치지 않고 다르면 실패)
// 화면(브라우저)·연결 프로그램 화면은 JSON을 따로 받지 않고 cohort.mjs 하나만 불러오게 하려고 사본을 둡니다.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const json=readFileSync(root+'cohort.json','utf8'),data=JSON.parse(json);
const file=root+'cohort.mjs',text=readFileSync(file,'utf8');
const start='// <cohort.json>',end='// </cohort.json>',a=text.indexOf(start),b=text.indexOf(end);
if(a<0||b<a)throw Error('cohort.mjs에서 <cohort.json> 표시를 찾지 못했습니다.');
const eol=text.includes('\r\n')?'\r\n':'\n';
const block=`${start}${eol}const DATA=${json.trim().replace(/\r?\n/g,eol)};${eol}`;
const next=text.slice(0,a)+block+text.slice(b);
if(process.argv.includes('--check')){if(next!==text){console.error('cohort.mjs 사본이 cohort.json과 다릅니다. node tools/build-cohort.mjs를 실행해 주세요.');process.exit(1);}console.log('cohort.mjs 사본 일치');}
else{writeFileSync(file,next);console.log(`cohort.mjs 사본을 맞췄습니다(반 ${data.classes.length}개, ${data.period.start}~${data.period.end}).`);}
