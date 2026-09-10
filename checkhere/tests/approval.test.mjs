import test from 'node:test';
import assert from 'node:assert/strict';
import {APPROVER,cleanRequest,matchRequest,prepareApproval,proposalFromApproval} from '../approval-core.mjs';
import {createApprovalCloud} from '../cloud-approval.mjs';
import {PROJECT} from '../firebase-public.mjs';
const record=()=>({id:'record-id',version:'version',classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'1234',source:'live',readState:'complete',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'기존 퇴실 사유'});
const request=()=>({classId:'2',date:'2026-09-03',name:'가상학생',phoneLast4:'',changes:{entryMemo:'정정 사유'},reason:'수기 확인'});
test('request changes only selected fields and normalizes times',()=>{const r=cleanRequest({...request(),changes:{entry:'09:10'}});assert.deepEqual(r.changes,{entry:'09:10:00'});const a=prepareApproval(request(),record());assert.equal(a.after.exitMemo,record().exitMemo);assert.equal(a.after.entry,record().entry);assert.equal(a.after.entryMemo,'정정 사유');});
test('invalid dates, blank times, unexpected fields and overlong reasons rejected',()=>{for(const patch of [{date:'2026-09-31'},{date:'2026-07-26'},{changes:{entry:''}},{changes:{delete:true}},{changes:{exit:'24:00'}},{reason:'x'.repeat(1001)}])assert.throws(()=>cleanRequest({...request(),...patch}));});
test('same-name request must resolve uniquely within class and date',()=>{assert.equal(matchRequest(request(),[record()]).id,'record-id');assert.throws(()=>matchRequest(request(),[record(),{...record(),id:'other',phoneLast4:'9876'}]));assert.equal(matchRequest({...request(),phoneLast4:'9876'},[record(),{...record(),id:'other',phoneLast4:'9876'}]).id,'other');assert.throws(()=>matchRequest({...request(),classId:'1'},[record()]));assert.throws(()=>matchRequest(request(),[{...record(),source:'snapshot'}]));});
test('pending, rejected or another approving administrator cannot execute',()=>{const r={...request(),approval:prepareApproval(request(),record()),approvedBy:APPROVER,status:'approved'};assert.equal(proposalFromApproval(r).entryMemo,'정정 사유');for(const status of ['pending','rejected','verified','unknown'])assert.throws(()=>proposalFromApproval({...r,status}));assert.throws(()=>proposalFromApproval({...r,approvedBy:'another-admin@example.com'}));});
test('approved payload cannot change unrequested fields or reason',()=>{const r={...request(),approval:prepareApproval(request(),record()),approvedBy:APPROVER,status:'approved'};assert.throws(()=>proposalFromApproval({...r,approval:{...r.approval,after:{...r.approval.after,exit:'17:00:00'}}}));assert.throws(()=>proposalFromApproval({...r,reason:'다른 근거'}));});
const token=extra=>'header.'+Buffer.from(JSON.stringify({aud:PROJECT,iss:`https://securetoken.google.com/${PROJECT}`,exp:Math.floor(Date.now()/1000)+300,firebase:{sign_in_provider:'google.com'},...extra})).toString('base64url')+'.signature';
test('bridge requires remote token verification and designated verified Google account',async()=>{
  const ok=createApprovalCloud({fetchImpl:async()=>new Response(JSON.stringify({users:[{email:APPROVER,emailVerified:true}]}))});await ok.verify(token({}));
  await assert.rejects(()=>ok.verify(token({firebase:{sign_in_provider:'password'}})));await assert.rejects(()=>ok.verify(token({aud:'another-project'})));await assert.rejects(()=>ok.verify(token({exp:0})));
  const other=createApprovalCloud({fetchImpl:async()=>new Response(JSON.stringify({users:[{email:'another-admin@example.com',emailVerified:true}]}))});await assert.rejects(()=>other.verify(token({})));
  const invalid=createApprovalCloud({fetchImpl:async()=>new Response('{}',{status:400})});await assert.rejects(()=>invalid.verify(token({})));
});
test('cloud claim uses update-time precondition and server timestamp; concurrent claim fails',async()=>{
  let captured;const cloud=createApprovalCloud({fetchImpl:async(url,options)=>{captured={url,body:JSON.parse(options.body)};return new Response('{}');}});
  await cloud.claim({id:'request-id-0123456',updateTime:'2026-09-10T00:00:00Z',data:{status:'approved'}},'fixture-token','attempt-0123456789');
  assert(captured.url.endsWith('/documents:commit'));assert.equal(captured.body.writes[0].currentDocument.updateTime,'2026-09-10T00:00:00Z');assert.equal(captured.body.writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');
  const conflict=createApprovalCloud({fetchImpl:async()=>new Response('{}',{status:412})});await assert.rejects(()=>conflict.claim({id:'request-id-0123456',updateTime:'old',data:{status:'approved'}},'fixture-token','attempt-0123456789'));
});
