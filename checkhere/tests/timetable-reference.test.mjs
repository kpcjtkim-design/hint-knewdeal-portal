import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{correctedSeed,curriculumPlan}from'../../timetable-reference.mjs';
const seed=JSON.parse(readFileSync(new URL('../../timetable-seed.json',import.meta.url))),reference=JSON.parse(readFileSync(new URL('../../timetable-reference.json',import.meta.url)));
const catalog={courses:seed.courses,modules:seed.modules,lectures:seed.lectures,revision:1};
// 2기 기준: 장소·날짜는 일정표 칸에서(1007판 합계표 11~20행과 대조), 교육장소는 각 판 2행. 1기 교정(patches)은 없음.
test('2기 facilities come from the schedule: factory visit and disassembly place/date per class, venue addresses',()=>{
 assert.equal(reference.facilities.length,16);assert.deepEqual(reference.patches,[]);assert.deepEqual(reference.additions,[]);
 const want={1:['화성공장','천안GLC'],2:['화성공장','천안GLC'],3:['아산공장','선문대'],4:['아산공장','선문대'],5:['아산공장','선문대'],6:['울산공장','울산'],7:['울산공장','울산'],8:['울산공장','울산'],9:['울산공장','울산'],10:['울산공장','울산'],11:['공장견학 이론만(견학 일정 없음)','울산'],12:['공장견학 이론만(견학 일정 없음)','울산'],13:['울산공장','울산'],14:['광주공장','폴리텍대'],15:['광주공장','폴리텍대'],16:['광주공장','폴리텍대']};
 for(const f of reference.facilities){
  assert.deepEqual([f.factory,f.disassembly],want[f.classId],f.classId+'반');assert(f.address&&f.places['1014']&&f.places['1007'],f.classId+'반 교육장소');
  const entries=seed.classes[f.classId].entries,visit=entries.find(e=>/^공장견학/.test(e.event)),dis=entries.find(e=>e.event==='분해조립');
  assert.deepEqual([visit.date],f.factoryDates);assert.deepEqual([dis.date],f.disassemblyDates);assert.equal(dis.venue,f.disassembly);if(visit.event==='공장견학')assert.equal(visit.venue,f.factory);
 }
 assert.match(reference.facilities[5].address,/대구무역회관/);assert.equal(reference.facilities[5].places['1014'],'대구 생산성본부');
 assert.deepEqual(Object.keys(reference.courses),['모빌리티 AI','제조지능화']);assert(reference.courses['제조지능화'].includes('AI기반 제조데이터 분석 입문'));assert(!reference.courses['제조지능화'].includes('직무특화 (세부 과목 미정)'));
 assert.deepEqual(correctedSeed(seed,reference).classes,seed.classes,'교정 없음: 시드 그대로');assert.equal(curriculumPlan(catalog,structuredClone(seed.classes),structuredClone(seed.classes),reference).changes.length,0);
});
test('a reviewed curriculum patch keeps staff changes and private fields; repeated apply is empty',()=>{
 const visit=seed.lectures.find(l=>l.course==='모빌리티 AI'&&l.title==='화성공장 · 견학·이론'),patched={...reference,patches:[{id:visit.id,before:{course:visit.course,module:visit.module,title:visit.title},after:{title:'화성공장 · 견학',venue:'화성공장 정문'}}]};
 const drafts=structuredClone(seed.classes),published=structuredClone(seed.classes);
 for(const cid of Object.keys(drafts)){drafts[cid].revision=3;published[cid].revision=2;published[cid].sourceRevision=3;}
 const mine=drafts['1'].entries.find(e=>e.lectureId===visit.id);Object.assign(mine,{venue:'직접 지정한 집결지',instructorId:'assigned',note:'준비물',start:'10:00',end:'17:00'});
 assert.equal(curriculumPlan(catalog,drafts,published,patched).conflicts.length,0);
 const custom=drafts['2'].entries.find(e=>e.title==='화성공장 · 견학·이론');assert.notEqual(custom.lectureId,visit.id,'2반은 제조지능화 강의라 이 교정 대상이 아님');
 const p=curriculumPlan(catalog,drafts,published,patched);assert.deepEqual(p.changes.map(c=>c.kind+':'+c.id),['catalog:timetableBetaCatalog','draft:1','published:1']);
 const changed=p.changes.find(x=>x.kind==='draft').data.entries.find(e=>e.id===mine.id);assert.equal(changed.title,'화성공장 · 견학');for(const k of ['venue','instructorId','note','start','end'])assert.equal(changed[k],mine[k]);
 assert.equal(p.changes.find(x=>x.kind==='published').data.sourceRevision,4);
 let nextCatalog=catalog;for(const c of p.changes){const value={...c.data,revision:c.revision+1};if(c.kind==='catalog')nextCatalog=value;else(c.kind==='draft'?drafts:published)[c.id]=value;}
 assert.equal(curriculumPlan(nextCatalog,drafts,published,patched).changes.length,0);
});
