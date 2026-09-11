import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{correctedSeed,curriculumPlan}from'../../timetable-reference.mjs';
const seed=JSON.parse(readFileSync(new URL('../../timetable-seed.json',import.meta.url))),reference=JSON.parse(readFileSync(new URL('../../timetable-reference.json',import.meta.url)));
const catalog={courses:seed.courses,modules:seed.modules,lectures:seed.lectures,revision:1};
test('source-confirmed facilities and 39 major subjects, with no invented dates or HW Python duration',()=>{
 const corrected=correctedSeed(seed,reference);
 assert.deepEqual(Object.values(reference.courses).map(x=>x.length),[13,13,13]);
 for(const f of reference.facilities){const entries=corrected.classes[f.classId].entries;assert.equal(entries.find(e=>e.module==='공장견학').venue,f.factory);assert.equal(entries.find(e=>e.module==='분해조립').venue,f.disassembly);}
 for(const [cid,c]of Object.entries(seed.classes))assert.deepEqual(corrected.classes[cid].entries.map(e=>[e.id,e.date,e.day,e.hours,e.start,e.end]),c.entries.map(e=>[e.id,e.date,e.day,e.hours,e.start,e.end]));
 const python=corrected.lectures.find(l=>l.course==='임베디드 AI(HW)'&&l.title==='AI를 위한 Python');assert(python);assert.equal(python.days,null);assert(!Object.values(corrected.classes).some(c=>c.entries.some(e=>e.lectureId===python.id)));
 assert(corrected.lectures.some(l=>l.title==='AI기반 제조데이터 분석 입문 - Python/통계'));
 for(const course of corrected.courses)for(const module of ['공장견학','분해조립'])assert.equal(corrected.lectures.filter(l=>l.course===course&&l.module===module).length,4);
 assert.deepEqual(correctedSeed(corrected,reference),corrected);
});
test('migration preserves staff changes, unpublished differences and private instructor fields; repeated apply is empty',()=>{
 const drafts=structuredClone(seed.classes),published=structuredClone(seed.classes);
 for(const cid of Object.keys(drafts)){drafts[cid].revision=3;published[cid].revision=2;published[cid].sourceRevision=3;}
 const visit=drafts['1'].entries.find(e=>e.module==='공장견학');Object.assign(visit,{venue:'직접 지정한 집결지',instructorId:'assigned',note:'준비물',start:'09:00',end:'18:00'});
 const custom=drafts['2'].entries.find(e=>e.module==='공장견학');custom.title='담당자가 변경한 일정';published['2'].sourceRevision=2;
 const p=curriculumPlan(catalog,drafts,published,reference);assert(p.conflicts.some(x=>x.includes(custom.title)));assert.equal(p.changes.length,35);
 const changed=p.changes.find(x=>x.kind==='draft'&&x.id==='1').data.entries.find(e=>e.id===visit.id);for(const k of ['venue','instructorId','note','start','end'])assert.equal(changed[k],visit[k]);
 const publishedOne=p.changes.find(x=>x.kind==='published'&&x.id==='1').data;assert.equal(publishedOne.sourceRevision,4);assert.equal(publishedOne.entries.find(e=>e.id===visit.id).note,'');
 assert.equal(p.changes.find(x=>x.kind==='published'&&x.id==='2').data.sourceRevision,2);
 let nextCatalog=catalog;for(const c of p.changes){const value={...c.data,revision:c.revision+1};if(c.kind==='catalog')nextCatalog=value;else(c.kind==='draft'?drafts:published)[c.id]=value;}
 assert.equal(curriculumPlan(nextCatalog,drafts,published,reference).changes.length,0);
});
