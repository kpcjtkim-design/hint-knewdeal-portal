// Reviewed curriculum metadata only. Survey dates never change timetable dates.
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
export function correctCurriculumRecord(record,reference,kind='lecture'){
 const patch=reference.patches.find(p=>p.id===(kind==='entry'?record.lectureId:record.id));
 if(!patch)return {record,changed:false,conflict:false};
 const expected={...patch.before,...patch.after};
 if(same(record,expected,['course','module','title']))return {record,changed:false,conflict:false};
 if(!same(record,patch.before,['course','module','title']))return {record,changed:false,conflict:true};
 const next={...record,...patch.after};
 // Preserve an administrator's explicit location, including a room or meeting point.
 if(record.venue)next.venue=record.venue;
 return {record:next,changed:true,conflict:false};
}
export function correctedCatalog(catalog,reference){
 let changed=0;const conflicts=[];
 const lectures=catalog.lectures.map(l=>{const r=correctCurriculumRecord(l,reference);if(r.changed)changed++;if(r.conflict)conflicts.push(l.title);return r.record;});
 for(const addition of reference.additions){
  if(!lectures.some(l=>l.id===addition.id||same(l,addition,['course','module','title']))){lectures.push({...addition});changed++;}
 }
 let modules=[...catalog.modules];
 if(lectures.some(l=>l.module==='분해조립')&&!modules.includes('분해조립')){modules.splice(Math.max(0,modules.indexOf('공장견학')+1),0,'분해조립');changed++;}
 if(!lectures.some(l=>l.module==='실차체험')&&modules.includes('실차체험')){modules=modules.filter(m=>m!=='실차체험');changed++;}
 return {data:{...catalog,modules,lectures},changed,conflicts};
}
export function curriculumPlan(catalog,drafts,published,reference){
 const c=correctedCatalog(catalog,reference),changes=[],conflicts=c.conflicts.map(title=>'강의 목록 · '+title);
 const counts={catalog:c.changed,draft:0,published:0};
 if(c.changed)changes.push({kind:'catalog',id:'timetableBetaCatalog',revision:catalog.revision||0,data:c.data});
 for(const [kind,documents]of [['draft',drafts],['published',published]]){
  for(const [cid,document]of Object.entries(documents)){
   let count=0;
   const entries=document.entries.map(e=>{const result=correctCurriculumRecord(e,reference,'entry');if(result.changed)count++;if(result.conflict)conflicts.push(`${cid}반 ${e.date} ${kind==='draft'?'편집본':'공개본'} · ${e.title}`);return result.record;});
   const data={...document,entries};
   // Keep the publication relationship only when it was already up to date.
   if(kind==='published'&&document.sourceRevision===drafts[cid]?.revision&&changes.some(x=>x.kind==='draft'&&x.id===cid))data.sourceRevision=document.sourceRevision+1;
   if(count||data.sourceRevision!==document.sourceRevision)changes.push({kind,id:cid,revision:document.revision||0,data});
   counts[kind]+=count;
  }
 }
 return {version:reference.version,changes,counts,conflicts};
}
export function correctedSeed(seed,reference){
 const catalog=correctedCatalog(seed,reference).data;
 return {...catalog,classes:Object.fromEntries(Object.entries(seed.classes).map(([cid,c])=>[cid,{...c,entries:c.entries.map(e=>correctCurriculumRecord(e,reference,'entry').record)}]))};
}
