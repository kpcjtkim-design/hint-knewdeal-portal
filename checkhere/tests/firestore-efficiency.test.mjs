import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const firebase=url(`
export const collection=(db,...parts)=>({db,path:parts.join('/')}),doc=collection;
export const where=(...args)=>args,documentId=()=> '__name__',query=(ref,...filters)=>({...ref,filters}),serverTimestamp=()=> 'server-time';
export async function getDoc(ref){ref.db.reads++;return{data:()=>ref.db.values[ref.path],exists:()=>!!ref.db.values[ref.path]};}
export async function getDocs(ref){ref.db.queries.push(ref);return{docs:Object.entries(ref.db.values).filter(([path,value])=>path.startsWith(ref.path+'/')&&(ref.path!=='settings'||path.includes('attendanceBeta_'))&&(!ref.filters?.some(f=>f[0]==='date')||ref.filters.filter(f=>f[0]==='date').every(f=>f[1]==='in'?f[2].includes(value.date):f[1]==='>='?value.date>=f[2]:f[1]==='<='?value.date<=f[2]:true))).map(([path,v])=>({id:path.split('/').at(-1),data:()=>v}))};}
export async function setDoc(ref,value){ref.db.writes++;ref.db.values[ref.path]=value;}
export async function runTransaction(db,fn){return fn({get:getDoc,set:setDoc});}
export async function loadLegacyCheckHereDay(db,c,date){db.legacy.push(date);return [];}
export async function loadCheckHereIdentities(){return [];}
`);
async function moduleWithMock(file){
 const base=new URL('../../',import.meta.url),source=await readFile(new URL(file,base),'utf8');
 return import(url(source.replace(/from '([^']+)'/g,(match,path)=>`from '${path.startsWith('https:')||['./checkhere-snapshots.mjs','./checkhere-name-store.mjs'].includes(path)?firebase:new URL(path,base).href}'`)));
}
const fixture=()=>({reads:0,writes:0,queries:[],legacy:[],values:{}});
const user={email:'admin@example.com'};
test('100 concurrent identical summary requests coalesce to one bounded current-record query',async()=>{
 const {syncAttendanceSummary}=await moduleWithMock('attendance-derived-store.mjs'),db=fixture();
 const sheet={attendance:[['이름','','','','8/27','8/28'],['가상','','','','출석','조퇴']]};
 await Promise.all(Array.from({length:100},()=>syncAttendanceSummary(db,user,'2',sheet)));
 assert.equal(db.writes,1);assert.equal(db.queries.length,2);assert.equal(db.reads,2);assert.deepEqual(db.legacy,[]);
 await syncAttendanceSummary(db,user,'2',sheet);assert.equal(db.writes,1,'same derived result must not write again');
});
test('summary queries all current dates once and falls back only for unmigrated recognized days',async()=>{
 const {syncAttendanceSummary}=await moduleWithMock('attendance-derived-store.mjs'),db=fixture();
 db.values['classes/2/checkhereCurrent/2026-08-27']={date:'2026-08-27',records:[]};
 const sheet={attendance:[['이름','','','','8/27','8/28','8/31'],['가상','','','','인정출석','인정출석','출석']]};
 await syncAttendanceSummary(db,user,'2',sheet);
 const q=db.queries.find(q=>q.path.endsWith('/checkhereCurrent'));
 assert.deepEqual(q.filters,[['date','>=','2026-07-27'],['date','<=','2026-09-23']]);
 assert.deepEqual(db.legacy,['2026-08-28']);assert(!db.queries.some(q=>q.path.endsWith('/checkhereSnapshots')));
});
test('identical survey results skip writes even when sync timestamp changes; actual change writes once',async()=>{
 const {createSurveyStore}=await moduleWithMock('survey-store.mjs'),db=fixture(),store=createSurveyStore(db,user,{canManage:true});
 const data={title:'가상 설문',answered:[],missing:[{name:'가상'}],scores:{mean:4},syncedAt:'old'};
 await store.save('2','lesson',data);
 for(let i=0;i<100;i++)await store.save('2','lesson',{...data,syncedAt:String(i)});
 assert.equal(db.writes,1);
 await store.save('2','lesson',{...data,scores:{mean:5}});assert.equal(db.writes,2);
 await assert.rejects(createSurveyStore(db,user).save('2','lesson',data),/관리자/);
});

test('concurrent color-only changes update the class summary, while unchanged evidence skips writes',async()=>{
 const {syncAttendanceSummary}=await moduleWithMock('attendance-derived-store.mjs'),db=fixture();
 db.values['classes/2/checkhereCurrent/2026-08-27']={date:'2026-08-27',records:[]};
 const sheet=color=>({attendance:[['이름','','','','8/27'],['가상','','','','인정출석']],attendanceBackgrounds:[[],['','','','',color]]});
 await Promise.all([syncAttendanceSummary(db,user,'2',sheet('#ffffff')),syncAttendanceSummary(db,user,'2',sheet('#ffff00'))]);
 assert.equal(db.values['attendanceBetaSummaries/2'].students[0].history['2026-08-27'].evidenceStatus,'확인');assert.equal(db.writes,2);
 await syncAttendanceSummary(db,user,'2',sheet('#ffff00'));assert.equal(db.writes,2);
});
