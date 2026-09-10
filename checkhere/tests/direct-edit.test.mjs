import test from 'node:test';
import assert from 'node:assert/strict';
import {canEditCheckHere,createDirectEditor} from '../direct-edit.mjs';
const op='00000000-0000-4000-8000-000000000001';
const user={email:'hint.kpc@gmail.com',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'google.com'}}}),getIdToken:async()=>'test-token'};
const record={id:'student-id',version:'v1',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',teacher:'최유정',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'퇴실 사유',outings:[]};
const input={classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',reason:'수기 대조',changes:{entryMemo:'정정 사유'}};
function setup(account=user){
  const rows=new Map(),calls=[],state={records:[{...record}],jobs:[],capabilities:['approved-requests-v1']};
  const c={refresh:async()=>{},state:()=>state,api:async(path,payload)=>{calls.push({path,payload});return{status:'verified'};}};
  const store={get:async id=>rows.get(id),create:async(id,value)=>{assert(!rows.has(id));rows.set(id,{...value,status:'pending',createdBy:account.email});},approve:async(id,approval)=>Object.assign(rows.get(id),{status:'approved',approval,approvedBy:account.email})};
  return {apply:createDirectEditor({user:account,controller:()=>c,store}),rows,calls,state,c};
}
test('other administrators and unverified/non-Google accounts cannot edit',async()=>{
  for(const account of [{...user,email:'staff@example.com'},{...user,getIdTokenResult:async()=>({claims:{email_verified:false,firebase:{sign_in_provider:'google.com'}}})},{...user,getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:'password'}}})}]){
    assert.equal(await canEditCheckHere(account),false);const s=setup(account);await assert.rejects(()=>s.apply(input,record,op));assert.equal(s.rows.size,0);assert.equal(s.calls.length,0);
  }
});
test('direct apply preserves untouched fields and submits only a server-authorized operation',async()=>{
  const s=setup();await s.apply(input,record,op);const r=s.rows.get(op);
  assert.equal(r.approval.after.exitMemo,'퇴실 사유');assert.equal(r.approval.after.entry,'09:00:00');assert.equal(r.approval.after.entryMemo,'정정 사유');
  assert.deepEqual(s.calls,[{path:'apply',payload:{approvalId:op,idToken:'test-token'}}]);
});
test('changed or ambiguous source blocks direct apply before saving',async()=>{
  for(const records of [[{...record,version:'v2'}],[record,{...record,id:'duplicate'}]]){const s=setup();s.state.records=records;await assert.rejects(()=>s.apply(input,record,op));assert.equal(s.rows.size,0);assert.equal(s.calls.length,0);}
});
test('uncertain response reuses operation and reconciles without repeating the write',async()=>{
  const s=setup();s.c.api=async(path,payload)=>{s.calls.push({path,payload});if(path==='apply'){s.rows.get(op).status='applying';throw Error('lost response');}return{status:'verified'};};
  await assert.rejects(()=>s.apply(input,record,op),/반영 요청 결과/);await s.apply(input,record,op);
  assert.equal(s.rows.size,1);assert.deepEqual(s.calls.map(c=>c.path),['apply','reconcile']);
});
test('terminal failure never repeats; a completed job returns its actual result',async()=>{
  const s=setup();await s.apply(input,record,op);s.rows.get(op).status='partial';await assert.rejects(()=>s.apply(input,record,op),/이미 처리/);assert.equal(s.calls.length,1);
  const t=setup();t.state.jobs=[{id:op,status:'failed',message:'저장 실패'}];assert.deepEqual(await t.apply(input,record,op),{status:'failed',message:'저장 실패'});
});
