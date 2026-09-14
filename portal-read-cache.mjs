// Small read-only cache and queue shared by badges and history within this page.
export function createReadQueue({concurrency=3,ttl=60000,maxEntries=600}={}){
 const cache=new Map(),pending=new Map(),queue=[];let running=0;
 function pump(){while(running<concurrency&&queue.length){const next=queue.shift();running++;const finish=()=>{running--;pending.delete(next.key);pump();};Promise.resolve().then(()=>{if(!next.active())throw Object.assign(Error('화면 이동으로 조회 중단'),{name:'AbortError'});return next.task();}).then(value=>{cache.set(next.key,{value,at:Date.now()});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);finish();next.resolve(value);},error=>{finish();next.reject(error);});}}
 return {read(key,task,{fresh=false,active=()=>true}={}){
  const hit=cache.get(key);if(!fresh&&hit&&Date.now()-hit.at<ttl)return Promise.resolve(hit.value);
  if(pending.has(key))return pending.get(key);
  const promise=new Promise((resolve,reject)=>queue.push({key,task,active,resolve,reject}));pending.set(key,promise);pump();return promise;
 },clear(){cache.clear();}};
}
