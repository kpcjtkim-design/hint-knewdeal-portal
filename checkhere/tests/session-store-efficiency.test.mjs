import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';
import {cachedRead,invalidateRead,clearReadSession} from '../../session-read-cache.mjs';

const base=new URL('../../',import.meta.url),url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const mockSource=`
export const collection=(db,...parts)=>({db,path:parts.join('/')}),doc=collection,serverTimestamp=()=> 'server-time';
const copy=v=>v===undefined?undefined:structuredClone(v);
const snap=(path,value)=>({id:path.split('/').at(-1),exists:()=>value!==undefined,data:()=>copy(value)});
export async function getDoc(ref){ref.db.reads[ref.path]=(ref.db.reads[ref.path]||0)+1;return snap(ref.path,ref.db.values[ref.path]);}
export async function getDocs(ref){ref.db.reads[ref.path]=(ref.db.reads[ref.path]||0)+1;return{docs:Object.entries(ref.db.values).filter(([path])=>path.startsWith(ref.path+'/')&&!path.slice(ref.path.length+1).includes('/')).map(([path,value])=>snap(path,value))};}
export async function setDoc(ref,value,options){ref.db.writes++;ref.db.values[ref.path]=copy(options?.merge?{...ref.db.values[ref.path],...value}:value);if(ref.db.failWrite)throw Error('uncertain write failure');}
export async function runTransaction(db,fn){const writes=[];const result=await fn({get:getDoc,set:(ref,value)=>writes.push([ref,value]),update:(ref,value)=>writes.push([ref,{...db.values[ref.path],...value}])});for(const[ref,value]of writes){db.writes++;db.values[ref.path]=copy(value);}if(db.failWrite)throw Error('uncertain write failure');return result;}
`;
const firebase=url(mockSource),modules=new Map();
async function mocked(file){
 if(modules.has(file))return modules.get(file);
 let source=await readFile(new URL(file,base),'utf8');
 const replacements=new Map();
 for(const [,path]of source.matchAll(/from '([^']+)'/g)){
  replacements.set(path,path.startsWith('https:')?firebase:path==='./timetable-store.mjs'?await mocked('timetable-store.mjs'):new URL(path,base).href);
 }
 source=source.replace(/from '([^']+)'/g,(_,path)=>`from '${replacements.get(path)}'`);
 const result=url(source);modules.set(file,result);return result;
}
const {createSurveyStore}=await import(await mocked('survey-store.mjs'));
const {createTimetableStore}=await import(await mocked('timetable-store.mjs'));
const {readMaterials}=await import(await mocked('lecture-materials.mjs'));
const fixture=()=>({reads:{},writes:0,values:{}}),account=()=>({email:'admin@example.test'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('session cache expires, retries rejections, and clones every returned value',async t=>{
 let now=1000,count=0;t.mock.method(Date,'now',()=>now);
 const db={},user={},load=async()=>({value:++count,nested:{label:'original'}});
 const first=await cachedRead(db,user,'one',load,{ttl:100});first.nested.label='changed';
 now=1099;assert.deepEqual(await cachedRead(db,user,'one',load,{ttl:100}),{value:1,nested:{label:'original'}});
 now=1100;assert.equal((await cachedRead(db,user,'one',load,{ttl:100})).value,2);
 let attempts=0;const unstable=async()=>{if(++attempts===1)throw Error('temporary');return 7;};
 await assert.rejects(cachedRead(db,user,'retry',unstable),/temporary/);
 assert.equal(await cachedRead(db,user,'retry',unstable),7);assert.equal(attempts,2);
});

test('invalidated or cleared in-flight reads cannot repopulate the active session',async()=>{
 for(const invalidate of [invalidateRead,(db)=>clearReadSession(db)]){
  const db={},user={},old=deferred();let loads=0;
  const first=cachedRead(db,user,'key',()=>{loads++;return old.promise;});await Promise.resolve();
  invalidate(db,user,'key');
  assert.equal(await cachedRead(db,user,'key',async()=>{loads++;return 'new';}),'new');
  old.resolve('old');assert.equal(await first,'old');
  assert.equal(await cachedRead(db,user,'key',async()=>{loads++;return 'wrong';}),'new');assert.equal(loads,2);
 }
});

test('100 pending reads coalesce and settled key retention stays bounded',async()=>{
 const db={},user={},gate=deferred();let count=0;
 const reads=Array.from({length:100},()=>cachedRead(db,user,'pending',()=>{count++;return gate.promise;}));
 await Promise.resolve();assert.equal(count,1);gate.resolve({ok:true});const results=await Promise.all(reads);
 results[0].ok=false;assert.equal(results[1].ok,true);
 for(let i=0;i<125;i++)await cachedRead(db,user,'key'+i,async()=>i);
 let reloaded=0;await cachedRead(db,user,'key0',async()=>{reloaded++;return 0;});assert.equal(reloaded,1);
});

test('survey reads coalesce across store instances, isolate users/classes, and honor fresh',async()=>{
 const db=fixture(),user=account(),other=account();db.values['surveyBetaSummaries/1/surveys/a']={title:'one'};
 db.values['surveyBetaSummaries/2/surveys/b']={title:'two'};db.values['classes/1']={surveyDuplicateIdentities:[]};
 db.values['settings/surveyBetaConfig']={events:{}};db.values['settings/surveyAutoSync']={enabled:true};
 const a=createSurveyStore(db,user),b=createSurveyStore(db,user);
 for(const [key,read]of [['surveyBetaSummaries/1/surveys',s=>s.read('1')],['classes/1',s=>s.identities('1')],['settings/surveyBetaConfig',s=>s.configuration()],['settings/surveyAutoSync',s=>s.syncStatus()]]){
  await Promise.all([read(a),read(b),read(a)]);await read(b);assert.equal(db.reads[key],1,key);
  await read(createSurveyStore(db,other));assert.equal(db.reads[key],2,key+' account isolation');
 }
 await a.read('2');assert.equal(db.reads['surveyBetaSummaries/2/surveys'],1);
 await a.read('1',{fresh:true});assert.equal(db.reads['surveyBetaSummaries/1/surveys'],3);
 await a.identities('1',{fresh:true});await a.configuration({fresh:true});await a.syncStatus({fresh:true});
 for(const key of ['classes/1','settings/surveyBetaConfig','settings/surveyAutoSync'])assert.equal(db.reads[key],3,key+' refresh');
});

test('survey result/config/identity writes invalidate cache after success and uncertain failure',async()=>{
 for(const failWrite of [false,true]){
  const db=fixture(),user=account(),store=createSurveyStore(db,user,{canManage:true});
  db.values['surveyBetaSummaries/1/surveys/a']={title:'old'};db.values['settings/surveyBetaConfig']={events:{a:{date:'old'}}};db.values['classes/1']={surveyDuplicateIdentities:[]};
  const identities=[{name:'가상(98년생)',phoneLast4:'1001'},{name:'가상(99년생)',phoneLast4:'1002'}],targets=identities.map(({name})=>({name}));
  const cases=[
   {key:'surveyBetaSummaries/1/surveys',read:()=>store.read('1'),write:()=>store.save('1','a',{title:'new'}),check:value=>assert.equal(value.a.title,'new')},
   {key:'settings/surveyBetaConfig',read:()=>store.configuration(),write:()=>store.saveConfig('a',{date:'new'}),check:value=>assert.equal(value.events.a.date,'new')},
   {key:'classes/1',read:()=>store.identities('1'),write:()=>store.saveIdentities('1',identities,targets),check:value=>assert.deepEqual(value,identities)}
  ];
  for(const c of cases){await c.read();db.failWrite=failWrite;if(failWrite)await assert.rejects(c.write(),/uncertain/);else await c.write();const before=db.reads[c.key];c.check(await c.read());assert.equal(db.reads[c.key],before+1,c.key+' must re-read after mutation');}
 }
});

test('timetable reads coalesce, isolate accounts, refresh explicitly, and protect draft cache from caller edits',async()=>{
 const db=fixture(),user=account(),a=createTimetableStore(db,user),b=createTimetableStore(db,user);
 db.values['timetableBetaDrafts/1']={revision:1,entries:[{id:'a',date:'2026-09-22',details:{title:'original'}}]};
 db.values['settings/timetableBetaCatalog']={revision:1,courses:['test']};
 await Promise.all([a.read('draft','1'),b.read('draft','1'),a.read('draft','1')]);assert.equal(db.reads['timetableBetaDrafts/1'],1);
 const draft=await a.read('draft','1');draft.entries[0].details.title='edited';draft.entries.push({id:'new'});
 const next=await b.read('draft','1');assert.equal(next.entries.length,1);assert.equal(next.entries[0].details.title,'original');
 await a.read('draft','1',{fresh:true});assert.equal(db.reads['timetableBetaDrafts/1'],2);
 await createTimetableStore(db,account()).read('draft','1');assert.equal(db.reads['timetableBetaDrafts/1'],3);
 await a.read('draft','2');assert.equal(db.reads['timetableBetaDrafts/2'],1);
 await Promise.all([a.all('draft'),b.all('draft')]);assert.equal(db.reads.timetableBetaDrafts,1);await a.all('draft',{fresh:true});assert.equal(db.reads.timetableBetaDrafts,2);
 await Promise.all([a.catalog({}),b.catalog({})]);assert.equal(db.reads['settings/timetableBetaCatalog'],1);await a.catalog({},{fresh:true});assert.equal(db.reads['settings/timetableBetaCatalog'],2);
});

test('every timetable mutation invalidates single, list, and catalog reads even after uncertain failure',async()=>{
 const mutations=[
  s=>s.save('draft','1',{entries:[]},1),
  s=>s.saveDrafts([{classId:'1',entries:[],revision:1}]),
  s=>s.saveCatalog({courses:['new']},1),
  s=>s.publish('1',{revision:1},1,[]),
  s=>s.applyCurriculum({version:'test',changes:[{kind:'draft',id:'1',revision:1,data:{entries:[]}}]})
 ];
 for(const failWrite of [false,true])for(const mutate of mutations){
  const db=fixture(),store=createTimetableStore(db,account());
  db.values['timetableBetaDrafts/1']={revision:1,entries:[]};db.values['timetableBetaPublished/1']={revision:1,entries:[]};db.values['settings/timetableBetaCatalog']={revision:1,courses:[]};
  const reads=[()=>store.read('draft','1'),()=>store.all('draft'),()=>store.catalog({})];await Promise.all(reads.map(read=>read()));db.failWrite=failWrite;
  if(failWrite)await assert.rejects(mutate(store),/uncertain/);else await mutate(store);
  const before={...db.reads};await Promise.all(reads.map(read=>read()));
  for(const key of ['timetableBetaDrafts/1','timetableBetaDrafts','settings/timetableBetaCatalog'])assert.equal(db.reads[key],before[key]+1,key);
 }
});

test('lecture material reads share one request per account/class and fresh bypasses settled values',async()=>{
 const db=fixture(),user=account();db.values['lectureMaterialsBeta/1/items/a']={title:'old'};
 const values=await Promise.all(Array.from({length:20},()=>readMaterials(db,'1',{user})));values[0][0].title='local edit';
 assert.equal(db.reads['lectureMaterialsBeta/1/items'],1);assert.equal((await readMaterials(db,'1',{user}))[0].title,'old');
 await readMaterials(db,'1',{user:account()});assert.equal(db.reads['lectureMaterialsBeta/1/items'],2);
 await readMaterials(db,'2',{user});assert.equal(db.reads['lectureMaterialsBeta/2/items'],1);
 await readMaterials(db,'1',{user,fresh:true});assert.equal(db.reads['lectureMaterialsBeta/1/items'],3);
});

test('material editor invalidates shared reads on successful and uncertain writes',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),dir=join(import.meta.dirname,'../..'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>{
   const path=new URL(route.request().url()).pathname.slice(1);
   if(path.endsWith('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:mockSource});
   if(!path)return route.fulfill({contentType:'text/html;charset=utf-8',body:`<div id="host"></div><script type="module">
    import{mountLectureMaterials,readMaterials}from'/lecture-materials.mjs';
    window.db={reads:{},writes:0,values:{'classes/1':{},'timetableBetaPublished/1':{entries:[{id:'a',lectureId:'lecture',title:'가상 강의',module:'test'}]},'lectureMaterialsBeta/1/items/a':{title:'old',lectureKey:'lecture',url:'https://drive.google.com/file/d/synthetic/view'}}};window.user={email:'admin@example.test'};
    window.read=()=>readMaterials(window.db,'1',{user:window.user});window.ready=await mountLectureMaterials(document.querySelector('#host'),{db:window.db,user:window.user,classes:[{id:'1'}]});
   </script>`});
   if(/\.(mjs|css)$/.test(path)&&existsSync(join(dir,path)))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(dir,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.waitForFunction(()=>window.ready);
  await page.getByRole('button',{name:'old 수정',exact:true}).click();await page.locator('#materialTitle').fill('saved');await page.getByRole('button',{name:'연결 저장',exact:true}).click();
  await page.getByRole('button',{name:'saved 수정',exact:true}).waitFor();assert.equal(await page.evaluate(async()=>(await window.read())[0].title),'saved');
  await page.getByRole('button',{name:'saved 수정',exact:true}).click();await page.locator('#materialTitle').fill('committed but uncertain');await page.evaluate(()=>window.db.failWrite=true);await page.getByRole('button',{name:'연결 저장',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('#materialError').textContent.includes('uncertain'));
  const before=await page.evaluate(()=>window.db.reads['lectureMaterialsBeta/1/items']);assert.equal(await page.evaluate(async()=>(await window.read())[0].title),'committed but uncertain');
  assert.equal(await page.evaluate(()=>window.db.reads['lectureMaterialsBeta/1/items']),before+1);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
