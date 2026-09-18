import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAttendanceClass} from '../../attendance-derived-core.mjs';
import {evidenceStatus,overviewColorState} from '../../attendance-beta-core.mjs';
import {syncClassWorker} from '../../lib/survey-sync-worker.mjs';
import runtime from '../../lib/survey-sync-runtime.cjs';

const sheet=color=>({attendance:[['이름','','','','9/14'],['가상','','','','인정출석']],attendanceBackgrounds:[[],['','','','',color]]});
const derive=(data,meta={})=>deriveAttendanceClass(data,{classId:'1',today:'2026-09-14',metadata:{'2026-09-14':{'0_가상':meta}}}).students[0].history['2026-09-14'];
test('recognized history shares compare-screen evidence rules and respects portal red/white distinctions',()=>{
 for(const [color,meta,expected] of [
  ['#ffff00',{},'확인'],['#ffe599',{},'확인'],['#f00',{},'반려'],['#ffffff',{},'미제출'],
  ['#ff0000',{sheetColor:'#ff0000',evidenceStatus:'미제출'},'미제출'],
  ['#ffffff',{sheetColor:'#ffffff',evidenceStatus:'미해당'},'미해당'],
  ['#ffff00',{sheetColor:'#ff0000',evidenceStatus:'반려'},'확인']
 ])for(const status of ['인정출석','인정지각','인정조퇴','인정외출']){
  const m={...meta,sheetStatus:'인정출석',portalStatus:status},result=derive(sheet(color),m);
  assert.equal(result.status,status);assert.equal(result.evidenceStatus,expected);
  assert.equal(result.evidenceStatus,evidenceStatus(color,'인정출석',m,overviewColorState));
 }
 const normal=sheet('#ff0000');normal.attendance[1][4]='출석';assert(!Object.hasOwn(derive(normal),'evidenceStatus'));
});
test('missing colors are unknown, never silently reported as a missing document',()=>{
 const data=sheet('#fff');delete data.attendanceBackgrounds;assert.equal(derive(data).evidenceStatus,'미확인');
 data.backgrounds=[[],['','','','','#ffff00']];assert.equal(derive(data).evidenceStatus,'확인');
});
test('manual and built scheduled workers store evidence in the existing class summary without additional reads',async()=>{
 for(const worker of [syncClassWorker,runtime.syncClassWorker]){
  const docs=new Map([
   ['classes/1',{course:'임베디드 AI(HW)'}],['settings/surveyBetaConfig',{}],
   ['timetableBetaPublished/1',{entries:[{id:'d1',title:'SW 테스팅',date:'2026-09-14',day:1,module:'직무특화'}]}],
   ['settings/attendanceBeta_1_2026-09-14',{students:{'0_가상':{sheetStatus:'인정출석',portalStatus:'인정지각',sheetColor:'#ff0000',evidenceStatus:'미제출'}}}],
   ['classes/1/checkhereCurrent/2026-09-14',{records:[]}]
  ]),metrics={reads:0,writes:0},wrap=p=>docs.has(p)?{path:p,data:docs.get(p)}:null;
  const store={metrics,get:async p=>{metrics.reads++;return wrap(p);},batch:async paths=>{metrics.reads+=paths.length;return new Map(paths.map(p=>[p,wrap(p)]));},query:async()=>[],list:async()=>[],save:async(p,v)=>{metrics.writes++;docs.set(p,v);}};
  await worker({classId:'1',slot:'2026-09-14T18:00+09:00',now:new Date('2026-09-14T09:00:00Z'),store,readSheet:async()=>sheet('#ff0000'),reader:{responses:async()=>[]},catalog:{events:[{id:'e1',classId:'1',date:'2026-09-14',title:'SW 테스팅'}],responseSources:[{id:'s1',title:'임베디드AI-HW(SW 테스팅)',sheetUrl:'https://docs.google.com/spreadsheets/d/fixture/edit'}]}});
  assert.equal(docs.get('attendanceBetaSummaries/1').students[0].history['2026-09-14'].evidenceStatus,'미제출');
  assert.equal(metrics.reads,6);assert.equal(metrics.writes,2);
 }
});
