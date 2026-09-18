import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createBridge} from '../server.mjs';

const row=id=>({id,studentKey:id,classId:'2',date:'2026-09-03',name:'가상'+id,teacher:'가상',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[]});
test('delta state persists updates, replays retries and resets a restarted or invalid cursor',async()=>{
 const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/state-delta-')),port=18872;
 let duringLogin=null;
 const collector={loggedIn:async()=>{if(duringLogin){const fn=duringLogin;duringLogin=null;await fn();}return true;}};
 let app=createBridge({dataDir,collector,port});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 const read=async(cursor='',legacy=false)=>{const res=await fetch(`http://127.0.0.1:${port}/api/state`+(legacy?'':'?delta=1&cursor='+encodeURIComponent(cursor)),{headers:{'x-hint-key':app.key,connection:'close'}});assert.equal(res.status,200);return res.json();};
 try{
  app.put(row('a'));app.put(row('b'));
  const first=await read();assert.equal(first.recordsMode,'replace');assert.equal(first.records.length,2);assert(!('audit' in first.records[0]));
  assert.equal((await read(first.cursor)).records.length,0);
  const changed={...row('a'),entryMemo:'첫 변경'};app.put(changed);changed.entryMemo='저장 안 한 변경';
  assert.equal((await read(first.cursor)).records[0].entryMemo,'첫 변경','mutable caller cannot alter the persisted snapshot');
  app.put({...row('a'),entryMemo:'최종 변경'});app.put(row('c'));
  const update=await read(first.cursor);assert.equal(update.recordsMode,'merge');assert.deepEqual(update.records.map(x=>x.id).sort(),['a','c']);assert.equal(update.records.find(x=>x.id==='a').entryMemo,'최종 변경');
  assert.deepEqual(await read(first.cursor),update,'retrying a lost response retains every changed student');
  duringLogin=async()=>{await Promise.resolve();app.put({...row('b'),exitMemo:'조회 도중 완료'});};
  const raced=await read(update.cursor);assert.equal(raced.records[0].id,'b');assert.equal((await read(raced.cursor)).records.length,0);
  for(const cursor of ['broken',raced.cursor.replace(/:\d+$/,':999999999'),raced.cursor.replace(/:\d+$/,':-1')]){const reset=await read(cursor);assert.equal(reset.recordsMode,'replace');assert.equal(reset.records.length,3);}
  assert((await read('',true)).records.every(r=>r.audit),'older clients retain their full response');
  app.db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON snapshots BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(()=>app.put(row('failed')),/fixture failure/);assert.equal((await read(raced.cursor)).records.length,0);app.db.exec('DROP TRIGGER fail_snapshot');
  app.close();await new Promise(r=>setTimeout(r,20));
  app=createBridge({dataDir,collector,port});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const restarted=await read(raced.cursor);assert.equal(restarted.recordsMode,'replace');assert.equal(restarted.records.length,3);assert.equal(restarted.records.find(x=>x.id==='a').entryMemo,'최종 변경');
  assert.notEqual(restarted.cursor,raced.cursor);assert.equal((await read(restarted.cursor)).records.length,0);
 }finally{app.close();}
});
