import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {mergeSeed,seedKey,draftSeedVersion,ORIGINAL_SEED} from '../../timetable-sync.mjs';
import {swapLesson,neighbour,conflictMap,classProgress,progressText,hideWeekend,bulkAssign,copyPeriod,recentChanges,toIcs} from '../../timetable-tools.mjs';
import {publishEntries} from '../../timetable-core.mjs';
const seed=JSON.parse(readFileSync(new URL('../../timetable-seed.json',import.meta.url)));
const lesson=(id,date,extra={})=>({id,date,course:'임베디드 AI(HW)',module:'직무특화',lectureId:'L-'+(extra.title||'C'),title:'C',day:1,hours:8,start:'',end:'',instructorId:'',venue:'',note:'',online:false,kind:'class',...extra});

test('excel update keeps portal-only fields and moves the sheet did not touch',()=>{
 const base=seed.classes['1'].entries,draft=structuredClone(base);
 const a=draft.find(e=>e.date==='2026-10-06'),b=draft.find(e=>e.date==='2026-10-07'&&e.kind!=='holiday'&&e.title==='SW 테스팅'),moved=draft.find(e=>e.date==='2026-10-13');
 a.instructorId='teacher';a.start='09:00';a.end='18:00';a.note='실습실';moved.date='2026-10-16';
 const next=structuredClone(base),na=next.find(e=>e.id===a.id);na.date='2026-10-08';next.find(e=>e.id==='xlsx-1-81').date='2026-10-06';
 const r=mergeSeed({classId:'1',base,next,draft,version:'20261001'});
 const out=r.entries.find(e=>e.id===a.id);
 assert.equal(out.date,'2026-10-08','sheet date change applies');
 assert.deepEqual([out.instructorId,out.start,out.end,out.note],['teacher','09:00','18:00','실습실'],'admin fields kept');
 assert.equal(r.entries.find(e=>e.id===moved.id).date,'2026-10-16','portal move kept when the sheet did not change that lesson');
 assert.equal(r.entries.length,draft.length);assert.equal(r.changes.length,2);assert(r.changes.every(c=>!c.conflict));
 assert.equal(r.entries.find(e=>e.id===b.id).date,b.date);
 assert(r.entries.every(e=>e.seedKey),'entries remember their sheet key for the next update');
 assert(!('seedKey' in publishEntries(r.entries,{})[0]),'sheet keys stay out of the teacher copy');
});
test('excel update flags overwritten portal edits, adds and removes lessons, keeps portal-only lessons',()=>{
 const base=[lesson('x1','2026-09-01'),lesson('x2','2026-09-02',{day:2}),lesson('x3','2026-09-03',{title:'MCU',lectureId:'L-MCU'})];
 const draft=[{...base[0],date:'2026-09-04'},base[1],base[2],lesson('manual','2026-09-05',{title:'특강',lectureId:''})];
 const next=[{...base[0],date:'2026-09-08'},base[1],lesson('new','2026-09-09',{title:'MCU',lectureId:'L-MCU',day:2,sourceRow:40})];
 const r=mergeSeed({classId:'1',base,next,draft,version:'v2'});
 const byKind=k=>r.changes.filter(c=>c.kind===k);
 assert.equal(byKind('변경')[0].conflict,true);assert.equal(r.entries.find(e=>e.id==='x1').date,'2026-09-08');
 assert.equal(byKind('추가').length,1);assert.equal(r.entries.find(e=>e.title==='MCU').id,'xlsx-1-v2-40');
 assert.equal(byKind('삭제').length,1);assert(!r.entries.some(e=>e.id==='x3'));
 assert(r.entries.some(e=>e.id==='manual'),'lessons added in the portal stay');
 const deleted=mergeSeed({classId:'1',base,next:base,draft:[base[0],base[1]],version:'v2'});
 assert.equal(deleted.entries.length,2,'a lesson deleted in the portal stays deleted when the sheet did not change it');assert.equal(deleted.skipped.length,1);
 const second=mergeSeed({classId:'1',base:next,next:[{...next[0],date:'2026-09-10'},...next.slice(1)],draft:r.entries,version:'v3'});
 assert.equal(second.entries.find(e=>e.id==='x1').date,'2026-09-10','later updates match by stored sheet key even when row ids changed');
 const sheet=e=>({...e,id:'xlsx-'+e.id}),blind=mergeSeed({classId:'1',base:null,next,draft:[...base.map(sheet),draft[3]],version:'v2'});
 assert.equal(blind.entries.find(e=>e.id==='xlsx-x1').date,'2026-09-08','without the old workbook the sheet wins');assert(blind.entries.some(e=>e.id==='manual'));assert.equal(draftSeedVersion({}),ORIGINAL_SEED);assert.equal(seedKey({kind:'holiday',date:'d',title:'t'}),'h|d|t');
});
test('swap, neighbours and touch-friendly reordering',()=>{
 const rows=[lesson('a','2026-09-01',{start:'09:00',end:'18:00'}),lesson('b','2026-09-02',{title:'MCU'}),lesson('c','2026-09-02',{title:'벨',hours:1}),lesson('h','2026-09-03',{kind:'holiday',module:'휴일',day:0}),lesson('d','2026-09-04')];
 const s=swapLesson(rows,'a','b');assert.equal(s.find(e=>e.id==='a').date,'2026-09-02');assert.equal(s.find(e=>e.id==='b').date,'2026-09-01');assert.equal(s.find(e=>e.id==='a').start,'09:00');
 assert.throws(()=>swapLesson(rows,'a','h'));assert.equal(neighbour(rows,'b',1).id,'d');assert.equal(neighbour(rows,'c',-1).id,'a');assert.equal(neighbour(rows,'a',-1),null);
});
test('instructor conflicts, progress, weekend and bulk tools',()=>{
 const classes={'1':{entries:[lesson('a','2026-09-01',{instructorId:'t',start:'09:00',end:'12:00'})]},'2':{entries:[lesson('b','2026-09-01',{instructorId:'t',start:'11:00',end:'13:00'}),lesson('c','2026-09-01',{instructorId:'t',start:'13:00',end:'14:00'})]}};
 const w=conflictMap(classes,{t:{name:'김강사'}});assert.deepEqual([...w.keys()].sort(),['1|a','2|b']);assert.match(w.get('1|a'),/김강사 일정 겹침 · 2반 C 11:00–13:00/);
 const p=classProgress([lesson('a','2026-09-01'),lesson('b','2026-09-02'),lesson('c','2026-09-10')],'2026-09-02');assert.deepEqual([p.done,p.total,p.dday],[2,3,8]);assert.equal(progressText(p),'진행 2/3일 · 수료 D-8');
 assert.equal(hideWeekend(['2026-09-05','2026-09-07'],[]).length,1);assert.equal(hideWeekend(['2026-09-05','2026-09-07'],[lesson('s','2026-09-05')]).length,2);
 const rows=[lesson('a','2026-09-01'),lesson('b','2026-09-02',{title:'MCU'}),lesson('c','2026-09-08')];
 const r=bulkAssign(rows,{title:'C',to:'2026-09-05',patch:{instructorId:'t',start:'09:00',end:'18:00'}});assert.equal(r.count,1);assert.equal(r.entries.find(e=>e.id==='a').instructorId,'t');assert.equal(r.entries.find(e=>e.id==='c').instructorId,'');
 assert.throws(()=>bulkAssign(rows,{title:'C',patch:{start:'18:00',end:'09:00'}}));
 let n=0;const copied=copyPeriod(rows,[lesson('x','2026-09-01',{title:'X'}),lesson('y','2026-09-09')],{from:'2026-09-01',to:'2026-09-05',course:'제조지능화',lectures:[{id:'M-C',course:'제조지능화',title:'C'}],makeId:()=>'n'+(++n)});
 assert.equal(copied.added,2);assert.equal(copied.removed,1);assert.deepEqual(copied.entries.map(e=>e.id),['n1','n2','y']);assert.equal(copied.entries[0].lectureId,'M-C');assert.equal(copied.entries[1].lectureId,'');assert.equal(copied.entries[0].course,'제조지능화');
 assert.throws(()=>copyPeriod(rows,[lesson('h','2026-09-01',{kind:'holiday'})],{from:'2026-09-01',to:'2026-09-02',makeId:()=>'z'}),/휴일/);
});
test('teacher change notices collapse repeated and undone changes',()=>{
 const v1=[lesson('a','2026-09-01'),lesson('b','2026-09-02',{title:'MCU'})],v2=[{...v1[0],date:'2026-09-03'},v1[1],lesson('n','2026-09-04',{title:'특강'})];
 const c1=recentChanges(v1,v2,[],'2026-09-01');assert.deepEqual(c1.map(c=>[c.id,c.kind]).sort(),[['a','변경'],['n','추가']]);
 const v3=[{...v1[0],date:'2026-09-01'},{...v1[1],instructorName:'박강사'}];
 const c2=recentChanges(v2,v3,c1,'2026-09-02');assert.deepEqual(c2.map(c=>[c.id,c.kind]),[['b','변경']],'moved back and added-then-removed disappear');
 assert.equal(recentChanges([],[],c2,'2026-09-30').length,0,'older than two weeks drops');
});
test('calendar export is valid iCalendar with Seoul times and all-day lessons',()=>{
 const ics=toIcs([lesson('a','2026-09-01',{start:'09:00',end:'18:00',venue:'교육장, 3층',instructorName:'김강사'}),lesson('b','2026-09-02',{title:'긴 강의명 '.repeat(12)})],{classId:'1',course:'임베디드 AI(HW)'},new Date('2026-09-01T00:00:00Z'));
 assert.match(ics,/^BEGIN:VCALENDAR\r\n/);assert.match(ics,/DTSTART;TZID=Asia\/Seoul:20260901T090000/);assert.match(ics,/DTSTART;VALUE=DATE:20260902\r\nDTEND;VALUE=DATE:20260903/);assert.match(ics,/LOCATION:교육장\\, 3층/);
 assert(ics.split('\r\n').every(l=>l.length<=61),'long lines folded');assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,2);
});
