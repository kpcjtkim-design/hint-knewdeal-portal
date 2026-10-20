import test from 'node:test';
import assert from 'node:assert/strict';
import {APPROVER,cleanRequest,sameRequestTarget,matchRequest,prepareApproval,proposalFromApproval,requestMatchesRecord,memoDefaultTimes} from '../approval-core.mjs';
import {createApprovalCloud} from '../cloud-approval.mjs';
import {PROJECT} from '../firebase-public.mjs';
const record=()=>({id:'record-id',version:'version',classId:'2',date:'2026-11-05',name:'가상학생',phoneLast4:'1234',source:'live',readState:'complete',entry:'09:00:00',exit:'18:00:00',entryMemo:'기존 사유',exitMemo:'기존 퇴실 사유'});
const request=()=>({classId:'2',date:'2026-11-05',name:'가상학생',phoneLast4:'',changes:{entryMemo:'정정 사유'},reason:'수기 확인'});
test('request changes only selected fields and normalizes times',()=>{const r=cleanRequest({...request(),changes:{entry:'09:10'}});assert.deepEqual(r.changes,{entry:'09:10:00'});const a=prepareApproval(request(),record());assert.equal(a.after.exitMemo,record().exitMemo);assert.equal(a.after.entry,record().entry);assert.equal(a.after.entryMemo,'정정 사유');});
// 날짜는 모양만(사용자 결정 2026-10-20): 교육 기간 밖(2026-10-27·2027-01-23)·미래도 받고, 없는 날·모양이 틀린 날만 거절
test('dates outside the course period are accepted (date shape only)',()=>{for(const date of ['2026-10-27','2027-01-23','2026-10-20','2027-03-01','2026-10-24'])assert.equal(cleanRequest({...request(),date}).date,date);});
test('invalid dates, blank times, unexpected fields and overlong reasons rejected',()=>{for(const patch of [{date:'2026-11-31'},{date:'2026-13-01'},{date:'abc'},{date:''},{classId:'18'},{changes:{entry:''}},{changes:{delete:true}},{changes:{exit:'24:00'}},{reason:'x'.repeat(1001)}])assert.throws(()=>cleanRequest({...request(),...patch}));});
test('same-name request must resolve uniquely within class and date',()=>{assert.equal(matchRequest(request(),[record()]).id,'record-id');assert.throws(()=>matchRequest(request(),[record(),{...record(),id:'other',phoneLast4:'9876'}]));assert.equal(matchRequest({...request(),phoneLast4:'9876'},[record(),{...record(),id:'other',phoneLast4:'9876'}]).id,'other');assert.throws(()=>matchRequest({...request(),classId:'1'},[record()]));assert.throws(()=>matchRequest(request(),[{...record(),source:'snapshot'}]));});
test('pending, withdrawn, rejected or another approving administrator cannot execute',()=>{const r={...request(),approval:prepareApproval(request(),record()),approvedBy:APPROVER,status:'approved'};assert.equal(proposalFromApproval(r).entryMemo,'정정 사유');for(const status of ['pending','withdrawn','rejected','verified','unknown'])assert.throws(()=>proposalFromApproval({...r,status}));assert.throws(()=>proposalFromApproval({...r,approvedBy:'another-admin@example.com'}));});
test('blank memo survives request, approval and collector payload without touching other fields',()=>{const r=cleanRequest({...request(),changes:{entryMemo:''}}),approval=prepareApproval(r,record()),payload=proposalFromApproval({...r,approval,status:'approved',approvedBy:APPROVER});assert.equal(payload.entryMemo,'');assert.equal(payload.exitMemo,record().exitMemo);assert.equal(payload.entry,record().entry);assert.equal(payload.exit,record().exit);});
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
  await cloud.claim({id:'request-id-0123456',updateTime:'2026-11-12T00:00:00Z',data:{status:'approved'}},'fixture-token','attempt-0123456789');
  assert(captured.url.endsWith('/documents:commit'));assert.equal(captured.body.writes[0].currentDocument.updateTime,'2026-11-12T00:00:00Z');assert.equal(captured.body.writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');
  const conflict=createApprovalCloud({fetchImpl:async()=>new Response('{}',{status:412})});await assert.rejects(()=>conflict.claim({id:'request-id-0123456',updateTime:'old',data:{status:'approved'}},'fixture-token','attempt-0123456789'));
});


test('request comparison ignores stored map order but preserves identity and explicit blank fields',()=>{
 const a={...request(),changes:{entry:'09:00:00',exit:'18:00:00',entryMemo:''}};
 assert(sameRequestTarget(a,{...a,changes:{entryMemo:'',exit:'18:00:00',entry:'09:00'}}));
 for(const patch of [{classId:'3'},{date:'2026-11-16'},{name:'다른학생'},{phoneLast4:'9999'},{reason:'다른 근거'},{changes:{entry:'09:00:00',exit:'18:00:00'}},{changes:{...a.changes,exit:'17:00:00'}}])assert.equal(sameRequestTarget(a,{...a,...patch}),false);
 assert.equal(sameRequestTarget(a,null),false);
});

// 시간 삭제(deleteTimes): 관리자 요청에서 지정한 쪽만 ''. 삭제가 아닌 요청은 모양이 그대로입니다.
const removal=(patch={})=>({...request(),reason:'[가상] 결석 확인',changes:{exit:''},deleteTimes:['exit'],...patch});
test('requests without deletions keep exactly the old shape',()=>{
 const shape={classId:'2',date:'2026-11-05',name:'가상학생',phoneLast4:'',reason:'수기 확인',changes:{entryMemo:'정정 사유'}};
 for(const patch of [{},{deleteTimes:[]},{deleteTimes:null},{deleteTimes:undefined}]){const r=cleanRequest({...request(),...patch});assert.deepEqual(r,shape);assert.equal(Object.hasOwn(r,'deleteTimes'),false);}
});
test('time deletion requests are accepted and normalized only for the named side',()=>{
 assert.deepEqual(cleanRequest(removal()),{classId:'2',date:'2026-11-05',name:'가상학생',phoneLast4:'',reason:'[가상] 결석 확인',changes:{exit:''},deleteTimes:['exit']});
 const both=cleanRequest(removal({changes:{exit:'',entry:'',exitMemo:''},deleteTimes:['exit','entry']}));
 assert.deepEqual(both.deleteTimes,['entry','exit'],'fixed order');assert.deepEqual(both.changes,{entry:'',exit:'',exitMemo:''});
 assert.deepEqual(cleanRequest(removal({changes:{entry:'09:10',exit:''}})).changes,{entry:'09:10:00',exit:''},'the other side may still change and no reversed-time check against a blank');
});
test('blank times without deleteTimes, mismatched sides and memos on a deleted side are refused',()=>{
 for(const patch of [{changes:{exit:''},deleteTimes:undefined},{changes:{entry:''},deleteTimes:['exit']},{changes:{entry:'',exit:''},deleteTimes:['exit']}])assert.throws(()=>cleanRequest(removal(patch)),/공란으로 지울 수 없습니다/);
 for(const patch of [{changes:{exit:'18:00'}},{changes:{exitMemo:''}},{changes:{entry:'09:00'}},{deleteTimes:['exit','exit']},{deleteTimes:['exitMemo']},{deleteTimes:'exit'},{deleteTimes:[1]},{deleteTimes:{exit:true}}])assert.throws(()=>cleanRequest(removal(patch)),/삭제할 시간 항목/,JSON.stringify(patch));
 assert.throws(()=>cleanRequest(removal({changes:{exit:'',exitMemo:'조퇴_담임:가상(17:00)'}})),/사유는 비워/);
 assert.doesNotThrow(()=>cleanRequest(removal({changes:{exit:'',entryMemo:'다른 쪽 사유'}})),'the other side memo is unaffected');
});
test('approval keeps the requested deletion as an explicit blank and drops untouched blanks',()=>{
 const a=prepareApproval(removal(),record());
 assert.equal(a.after.exit,'');assert(Object.hasOwn(a.after,'exit'));assert.equal(a.after.entry,'09:00:00');assert.equal(a.after.exitMemo,'기존 퇴실 사유','memo stays unless requested');
 const noEntry=prepareApproval(removal(),{...record(),entry:null});assert.equal(Object.hasOwn(noEntry.after,'entry'),false,'an untouched blank is still omitted');assert.equal(noEntry.after.exit,'');
 assert.throws(()=>prepareApproval(removal(),{...record(),exit:null}),/이미 체크히어 기록과 같습니다/);
 assert.equal(prepareApproval(removal(),{...record(),exit:null},{allowAlreadyApplied:true}).after.exit,'');
 assert.equal(prepareApproval(request(),{...record(),exit:null}).after.exit,undefined,'non-deletion approvals are unchanged');
});
test('the approved payload must carry the blank for every deleted side',()=>{
 const r={...removal(),approval:prepareApproval(removal(),record()),approvedBy:APPROVER,status:'approved'};
 const payload=proposalFromApproval(r);assert.equal(payload.exit,'');assert.equal(payload.entry,'09:00:00');assert.equal(payload.exitMemo,'기존 퇴실 사유');
 const after=({exit,...rest})=>rest;
 assert.throws(()=>proposalFromApproval({...r,approval:{...r.approval,after:after(r.approval.after)}}),/일치하지 않습니다/,'missing blank');
 assert.throws(()=>proposalFromApproval({...r,approval:{...r.approval,after:{...r.approval.after,exit:'18:00:00'}}}),/일치하지 않습니다/);
 assert.throws(()=>proposalFromApproval({...r,deleteTimes:undefined}),/공란/,'the stored request must still say which side is deleted');
});
test('a deleted side matches any blank record time and fails while the time remains',()=>{
 for(const exit of [null,undefined,'','-'])assert.equal(requestMatchesRecord(removal(),{...record(),exit}),true,String(exit));
 for(const exit of ['18:00:00','12:00','시간'])assert.equal(requestMatchesRecord(removal(),{...record(),exit}),false,String(exit));
 const memo=removal({changes:{exit:'',exitMemo:''}});
 assert.equal(requestMatchesRecord(memo,{...record(),exit:null,exitMemo:''}),true);assert.equal(requestMatchesRecord(memo,{...record(),exit:null,exitMemo:'남은 사유'}),false);
 assert.equal(requestMatchesRecord(removal({changes:{entry:'09:10',exit:''}}),{...record(),exit:null,entry:'09:00:00'}),false,'the other side is still strict');
});
test('requests that differ only in deleteTimes are different targets; deletion order does not matter',()=>{
 const a=removal({changes:{entry:'',exit:''},deleteTimes:['entry','exit']});
 assert(sameRequestTarget(a,{...a,deleteTimes:['exit','entry']}));
 assert.equal(sameRequestTarget(removal(),{...removal(),deleteTimes:undefined}),false);
 assert.equal(sameRequestTarget(removal({changes:{exit:'',entryMemo:''}}),{...request(),reason:'[가상] 결석 확인',changes:{exit:'18:00',entryMemo:''}}),false);
 assert.equal(sameRequestTarget(request(),{...request(),deleteTimes:[]}),true,'an empty list is the same as none');
});
test('memo default times never fill a side that is explicitly being deleted',()=>{
 assert.deepEqual(memoDefaultTimes({exit:'',exitMemo:''},{exit:'18:00:00',exitMemo:'사유'}),{});
 assert.deepEqual(memoDefaultTimes({exit:'',exitMemo:''},{exit:null,exitMemo:'사유'}),{});
 assert.deepEqual(memoDefaultTimes({exitMemo:''},{exit:null,exitMemo:'사유'}),{exit:'18:00:00'},'a plain memo edit still gets its default');
});
