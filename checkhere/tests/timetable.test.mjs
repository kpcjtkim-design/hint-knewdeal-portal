import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {weekDays,monthDays,validateEntry,conflicts,publishEntries,visibleToday,lectureEndDays,lectureEndsOn} from '../../timetable-core.mjs';
const seed=JSON.parse(readFileSync(new URL('../../timetable-seed.json',import.meta.url)));
test('import preserves all 17 classes and multiple same-day events, without inventing times or contacts',()=>{
 assert.equal(Object.keys(seed.classes).length,17);assert.equal(seed.classes['1'].entries.filter(e=>e.date==='2026-09-21').length,2);
 for(const c of Object.values(seed.classes)){assert.equal(new Set(c.entries.map(e=>e.id)).size,c.entries.length);for(const e of c.entries){validateEntry(e);assert.equal(e.instructorId,'');assert.equal(e.start,'');assert.equal(e.end,'');}}
 assert.equal(seed.classes['1'].entries.find(e=>e.date==='2026-10-06').title,'SW 테스팅');
});
test('calendar handles cross-month weeks and shows no-class days with next actual class',()=>{
 assert.equal(weekDays('2026-09-01')[0],'2026-08-31');assert.equal(monthDays('2026-09-30').length,42);
 const v=visibleToday(seed.classes['1'].entries,'2026-09-12');assert.equal(v.today.length,0);assert.equal(v.next.date,'2026-09-14');
});
test('invalid times rejected; instructor conflicts and privacy-safe publication',()=>{
 const e={id:'one',date:'2026-09-11',course:'course',module:'module',title:'test',day:1,hours:8,kind:'class',start:'09:00',end:'18:00',instructorId:'i'};
 assert.throws(()=>validateEntry({...e,end:'08:00'}));assert.throws(()=>validateEntry({...e,end:''}));assert.throws(()=>validateEntry({...e,day:0}));
 assert.equal(conflicts(e,{'2':{entries:[{...e,id:'two'}]}},'1').length,1);
 assert.equal(conflicts(e,{'1':{entries:[e]}},'1').length,0);
 const p=publishEntries([{...e,sourceText:'original'}],{i:{name:'강사',phone:'private',note:'private'}});
 assert.equal(p[0].instructorName,'강사');assert(!JSON.stringify(p).includes('private'));assert(!('sourceText' in p[0]));
});

test('lecture completion uses each lecture last scheduled date, isolated by class and course',()=>{
 const make=(id,title,date,extra={})=>({id,title,date,lectureId:title,course:'HW',module:'직무특화',day:1,kind:'class',...extra});
 const rows=[make('a','SW 테스팅','2026-09-01'),make('b','SW 테스팅','2026-09-03'),make('c','MCU','2026-09-10'),make('d','MCU','2026-09-11'),make('holiday','MCU','2026-09-12',{kind:'holiday'}),make('e','SW 테스팅','2026-09-02',{course:'SW'}),make('f','SW 테스팅','2026-09-01',{classId:'2'})];
 assert.deepEqual(lectureEndDays(rows).map(e=>e.id),['b','d','e','f']);
 assert.deepEqual(lectureEndsOn(rows,'2026-09-03').map(e=>e.title),['SW 테스팅']);
 assert.equal(lectureEndsOn(rows,'2026-09-12').length,0);
 rows.push(make('g','SW 테스팅','2026-09-15'));
 assert.equal(lectureEndsOn(rows,'2026-09-03').length,0,'schedule extension moves the notice');
 assert.equal(lectureEndsOn([...rows,{...rows.at(-1),id:'g2'}],'2026-09-15').length,1,'same-date lecture sessions produce one notice');
});
