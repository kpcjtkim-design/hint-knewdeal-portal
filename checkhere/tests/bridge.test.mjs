import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {createBridge} from '../server.mjs';import {version} from '../identity.mjs';
import {APPROVER,prepareApproval} from '../approval-core.mjs';
test('loopback API authentication, idempotency and snapshot persistence',async()=>{
  const dataDir=mkdtempSync(join(import.meta.dirname,'../test-results/bridge-'));
  let writes=0,r={id:'fake',classId:'2',date:'2026-09-03',name:'가상학생',studentKey:'fake',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[]};r.version=version(r);
  const adapter={loggedIn:async()=>true,requireLogin:async()=>{},read:async()=>structuredClone(r),write:async(_,f,v)=>{writes++;r[f+'Memo']=v.memo;}};
  const request={classId:'2',date:r.date,name:r.name,phoneLast4:'',changes:{entryMemo:'시험'},reason:'가상 시험 근거',status:'approved',approvedBy:APPROVER};request.approval=prepareApproval(request,r);
  let finishes=0;const approvalCloud={verify:async token=>{if(token!=='fixture-admin')throw Error('관리자 권한 없음');},get:async()=>({data:structuredClone(request)}),claim:async()=>{},finish:async()=>{finishes++;}};
  const app=createBridge({dataDir,collector:adapter,port:18765,approvalCloud});await new Promise(resolve=>app.server.listen(18765,'127.0.0.1',resolve));
  const url='http://127.0.0.1:18765',headers={'x-hint-key':app.key,'content-type':'application/json'};
  try{
    app.put(r);assert.equal((await fetch(url+'/api/state')).status,401);
    assert.equal((await fetch(url+'/api/session',{headers:{origin:'https://unrelated.example'}})).status,403);
    assert.equal((await fetch(url+'/checkhere/data/attendance.sqlite')).status,404);
    const forbidden=await fetch(url+'/api/apply',{method:'POST',headers,body:JSON.stringify({...r,entryMemo:'우회',requestId:'fixture-request-id-01'})});assert.equal(forbidden.status,400);assert.equal(writes,0);
    const input={idToken:'fixture-admin',approvalId:'fixture-request-id-01',entryMemo:'요청 본문 조작은 무시'};
    const first=await(await fetch(url+'/api/apply',{method:'POST',headers,body:JSON.stringify(input)})).json();
    await new Promise(resolve=>setTimeout(resolve,100));
    const repeated=await(await fetch(url+'/api/apply',{method:'POST',headers,body:JSON.stringify(input)})).json();
    assert.equal(first.id,repeated.id);assert.equal(repeated.status,'verified');assert.equal(writes,1);assert.equal(r.entryMemo,'시험');assert.equal(finishes,1);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM snapshots').get().n,2);
    assert.equal((await fetch(url+'/api/remove',{method:'POST',headers,body:'{}'})).status,404);
  }finally{app.close();}
});
