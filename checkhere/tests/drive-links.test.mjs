// 구글 드라이브 폴더 바로가기(drive-links.mjs, 2026-10-21): 링크 고르기(날짜 → 주차 → 반 폴더), 단위기간(1·2·3) 고르기, 목록 준비 중, 파일 수 글,
// /api/teacher-beta의 b2DriveFolders·b2DriveCount 반 범위(담임은 자기 반만)와 목록 만들기(b2DriveIndexBuild)를 웹에서 막는지 봅니다. 폴더 id는 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {driveLinks,pickFolder,pickUnit,weekOf,unitOf,indexState,countText,folderUrl,NOT_BUILT} from '../../drive-links.mjs';
import handler,{b2Args} from '../../api/teacher-beta.js';
import {READ_ACTIONS,actionKind} from '../../lib/sheet-retry.cjs';
import {FOLDERS,FOLDER_ROWS,url} from './drive-fixture.mjs';

const pick=(date,kind,cls='1')=>{const p=pickFolder(FOLDER_ROWS,{cls,date,kind});return p&&[p.level,p.row.id];};

test('date folders fall back to the week folder, then the class folder',()=>{
 // 그날 폴더가 있으면 그날
 assert.deepEqual(pick('2026-10-29','evidence'),['date','e-1029']);
 assert.deepEqual(pick('2026-11-05','manual'),['date','m-1105']);
 // 그날 폴더가 없으면 그날이 든 WEEK 폴더(기간 안)
 assert.deepEqual(pick('2026-10-29','manual'),['week','m-w1']);
 assert.deepEqual(pick('2026-11-05','photo'),['week','p-w2']);
 // 주말(11/7 토, WEEK 2 날짜 폴더 뒤 6일 안)도 그 주
 assert.equal(weekOf(FOLDER_ROWS,'1','2026-11-07'),'WEEK 2');
 assert.deepEqual(pick('2026-11-07','evidence'),['week','e-w2']);
 // WEEK 1 끝(10/30)과 WEEK 2 시작(11/2) 사이 주말은 앞 주
 assert.equal(weekOf(FOLDER_ROWS,'1','2026-11-01'),'WEEK 1');
 // 개강 전·주차를 모르는 날·날짜 없음은 반 폴더
 assert.deepEqual(pick('2026-10-20','photo'),['class','p-cls']);
 assert.deepEqual(pick('2026-12-30','photo'),['class','p-cls']);
 assert.deepEqual(pick('','evidence'),['class','e-cls']);
 // 다른 반 줄은 쓰지 않습니다(2반은 출결인정자료 반 폴더만, 수기출석은 없음)
 assert.deepEqual(pick('2026-10-29','evidence','2'),['class','e2-cls']);
 assert.equal(pick('2026-10-29','manual','2'),null);
});

test('link model: titles say which level opened, admin gets the unit containing the date',()=>{
 const m=driveLinks(FOLDERS,{cls:'1',date:'2026-10-29',admin:true});
 assert.equal(m.ready,true);assert.equal(m.partial,false);
 assert.deepEqual(m.links.map(l=>[l.kind,l.label,l.level,l.url]),[['manual','수기출석','week',url('m-w1')],['evidence','출결인정자료','date',url('e-1029')],['photo','교육사진','date',url('p-1029')]]);
 assert.equal(m.links[0].short,'WEEK 1');
 assert.match(m.links[0].title,/수기출석 · 10\/29\(목\) 날짜 폴더가 없어 WEEK 1 폴더를 엽니다/);
 assert.match(m.links[1].title,/출결인정자료 · 10\/29\(목\) 날짜 폴더를 엽니다 · 10\.29/);
 // 단위기간: cohort.json 1단위(10/28~11/27). 1·2는 날짜 폴더가 없어 단위 폴더, 3은 그날 하위 폴더
 assert.equal(m.unit.unit,'1단위');
 assert.deepEqual(m.unit.links.map(l=>[l.label,l.level,l.url]),[['1단위','unit',url('u1')],['1. 단위기간출석부','unit',url('u1-sheet')],['2. 출석입력요청대장','unit',url('u1-req')],['3. 출석인정서류(10/29(목))','date',url('u1-ev-1029')]]);
 // 3. 출석인정서류에 그날 폴더가 없으면 단위 폴더
 const later=driveLinks(FOLDERS,{cls:'1',date:'2026-11-04',admin:true});
 assert.deepEqual(later.unit.links.at(-1).label,'3. 출석인정서류');assert.equal(later.unit.links.at(-1).url,url('u1-ev'));
 assert.equal(driveLinks(FOLDERS,{cls:'1',date:'2026-12-01',admin:true}).unit.unit,'2단위');
 // 담임(admin 아님)에게는 단위기간이 없습니다
 assert.equal(driveLinks(FOLDERS,{cls:'1',date:'2026-10-29'}).unit,null);
 // 목록에 없는 종류는 링크 없이(누를 수 없음)
 const two=driveLinks(FOLDERS,{cls:'2',date:'2026-10-29',admin:true});
 assert.deepEqual(two.links.map(l=>l.url?l.level:''),['','class','']);assert.equal(two.unit,null);
 assert.equal(folderUrl('a b'),'https://drive.google.com/drive/folders/a%20b');
});

test('the unit falls back to dated sub-folders when the cohort periods do not cover the day',()=>{
 const rows=[{cls:'1',kind:'unitEvidence',unit:'9단위',date:'2027-03-02',id:'x9a'},{cls:'1',kind:'unitEvidence',unit:'9단위',date:'2027-03-05',id:'x9b'},{cls:'1',kind:'unitSheet',unit:'9단위',date:'',id:'x9s'}];
 assert.equal(unitOf(rows,'1','2027-03-04'),'9단위');
 assert.equal(pickUnit(rows,{cls:'1',date:'2027-03-04'}).picks.unitSheet.row.id,'x9s');
 assert.equal(unitOf(rows,'1','2027-06-01'),null);
 assert.equal(unitOf(FOLDER_ROWS,'1','2027-06-01'),null,'outside every period and every dated folder');
});

test('an index that is not built yet shows only the waiting note; counts read as n개 / 없음 / ?',()=>{
 for(const d of [{},{rows:[]},{builtAt:'',done:false,rows:[]},null])assert.equal(indexState(d).empty,true);
 const partial=indexState({done:false,rows:FOLDER_ROWS.slice(0,3)});assert.deepEqual([partial.ready,partial.partial],[true,true]);
 assert.equal(NOT_BUILT,'폴더 목록 준비 중');
 assert.deepEqual([3,0,null,500,600,'?',undefined,'x'].map(n=>countText(n,500)),['3개','없음','없음','500개+','500개+','?','','?']);
});

/* ---------- /api/teacher-beta: 담임은 자기 반, 관리자는 고른 반(목록은 전체도), 정해진 칸만, 목록 만들기는 없음 ---------- */
const teacher={role:'TEACHER',classIds:['3','7']},admin={role:'ADMIN',classIds:[]};
test('b2DriveFolders and b2DriveCount are scoped to the teacher\'s own class and send only known fields',()=>{
 assert.deepEqual(b2Args(teacher,'b2DriveFolders',[{cls:'5',date:'2026-10-29',x:1}]),[{cls:'3',date:'2026-10-29'}]);
 assert.deepEqual(b2Args(teacher,'b2DriveFolders',[{}]),[{cls:'3'}],'a teacher never reads every class');
 assert.deepEqual(b2Args(teacher,'b2DriveFolders',[{cls:'7'}]),[{cls:'7'}],'temporary class is allowed');
 assert.deepEqual(b2Args(admin,'b2DriveFolders',[{}]),[{}]);
 assert.deepEqual(b2Args(admin,'b2DriveFolders',[{cls:'all'}]),[{}]);
 assert.deepEqual(b2Args(admin,'b2DriveFolders',[{cls:'12',date:'2026-11-05'}]),[{cls:'12',date:'2026-11-05'}]);
 assert.throws(()=>b2Args(admin,'b2DriveFolders',[{cls:'99'}]),/BAD_CLASS/);
 assert.throws(()=>b2Args(admin,'b2DriveFolders',[{cls:'1',date:'11/05'}]),/BAD_REQUEST/);
 assert.deepEqual(b2Args(teacher,'b2DriveCount',[{cls:'9',date:'2026-10-29',kinds:['photo','photo','evil','unitEvidence']}]),[{cls:'3',date:'2026-10-29',kinds:['photo','unitEvidence']}]);
 assert.deepEqual(b2Args(admin,'b2DriveCount',[{cls:'2',date:'2026-10-29'}]),[{cls:'2',date:'2026-10-29'}]);
 assert.throws(()=>b2Args(admin,'b2DriveCount',[{date:'2026-10-29'}]),/BAD_CLASS/,'counts always need a class');
 assert.throws(()=>b2Args(admin,'b2DriveCount',[{cls:'2'}]),/BAD_REQUEST/,'counts always need a date');
 for(const a of ['b2DriveFolders','b2DriveCount']){assert.ok(READ_ACTIONS.has(a),a);assert.equal(actionKind(a),'read',a);}
});

const SHEET='https://script.test/exec';
function backend(t,email){
 const calls=[];
 const old={url:process.env.HINT_SHEET_API_URL,key:process.env.HINT_SHEET_API_KEY};
 process.env.HINT_SHEET_API_URL=SHEET;process.env.HINT_SHEET_API_KEY='k';
 t.after(()=>{for(const [k,v] of [['HINT_SHEET_API_URL',old.url],['HINT_SHEET_API_KEY',old.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async(u,init={})=>{
  u=String(u);
  if(u.startsWith('https://identitytoolkit.googleapis.com/'))return Response.json({users:[{email}]});
  if(u.startsWith('https://firestore.googleapis.com/'))return Response.json({fields:{role:{stringValue:'TEACHER'},primaryClassId:{stringValue:'3'}}});
  if(u===SHEET){const body=JSON.parse(init.body);calls.push(body);return Response.json({ok:true,data:{builtAt:'x',done:true,rows:[]}});}
  throw Error('unexpected fetch '+u);
 });
 return calls;
}
async function call(body){
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',headers:{authorization:'Bearer tok'},body},res);return res;
}
test('through the handler: a teacher reads only class 3 folders, and the 4.5-minute index build is never reachable from the web',async t=>{
 const calls=backend(t,'teacher@test.kr');
 let res=await call({action:'b2DriveFolders',args:[{cls:'1'}]});
 assert.equal(res.statusCode,200);assert.deepEqual(calls.at(-1).args,[{cls:'3'}]);assert.equal(calls.at(-1).action,'b2DriveFolders');
 res=await call({action:'b2DriveCount',args:[{cls:'1',date:'2026-10-29',kinds:['photo']}]});
 assert.equal(res.statusCode,200);assert.deepEqual(calls.at(-1).args,[{cls:'3',date:'2026-10-29',kinds:['photo']}]);
 const before=calls.length;
 res=await call({action:'b2DriveIndexBuild',args:[{}]});
 assert.deepEqual([res.statusCode,res.body.code],[400,'BAD_ACTION']);assert.equal(calls.length,before);
});
