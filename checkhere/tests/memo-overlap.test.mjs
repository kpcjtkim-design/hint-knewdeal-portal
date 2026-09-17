import test from 'node:test';
import assert from 'node:assert/strict';
import {judge,assertChangeAllowed} from '../rules.mjs';
import {validateProposal,applyVerified} from '../writeback.mjs';
import {version} from '../identity.mjs';
const record=()=>{const r={id:'fixture',classId:'2',date:'2026-09-01',name:'가상학생',teacher:'홍길동',source:'live',readState:'complete',schedule:'09:00 ~ 18:00',entry:'09:25:55',exit:'15:39:59',entryMemo:'',exitMemo:'',outings:[],outingCount:0};return{...r,version:version(r)};};
const reason='(인정조퇴)병원_담임:홍길동(15:39)';
test('overlap permits only memo changes and keeps time automation blocked',()=>{
 const r=record();assert.equal(judge(r).canApply,false);
 for(const changes of [{exitMemo:reason},{entryMemo:'지각 사유'},{entryMemo:'',exitMemo:''}])assert.match(assertChangeAllowed(r,changes).warning,/시간은 유지/);
 for(const changes of [{entry:'09:00:00'},{exit:'18:00:00'},{entry:'09:00:00',exitMemo:reason}])assert.throws(()=>assertChangeAllowed(r,changes),/시간을 자동 변경/);
 for(const changes of [{},{outings:[]},{unknown:'x'}])assert.throws(()=>assertChangeAllowed(r,changes));
});
test('memo overlap requires an upgraded collector only at approval',()=>{
 assert.throws(()=>assertChangeAllowed(record(),{exitMemo:reason},{capabilities:['approved-requests-v1']}),/최신 체크히어 시작/);
 assertChangeAllowed(record(),{exitMemo:reason},{capabilities:['approved-requests-v1','memo-only-requests-v1']});
});
test('memo exception does not bypass incomplete, historical, ambiguous or invalid records',()=>{
 for(const patch of [{source:'snapshot'},{readState:'partial'},{rawEntry:'09:00:00'},{exception:'견학일'},{teacher:''},{schedule:'10:00 ~ 19:00'},{entry:'25:00:00'},{exit:'08:00:00'},{outings:[{start:'15:00',end:'14:00'}]}]){
  assert.throws(()=>assertChangeAllowed({...record(),...patch},{exitMemo:reason}),undefined,JSON.stringify(patch));
 }
});
test('writeback evaluates actual changed fields and retains version and reason guards',()=>{
 const r=record(),input={...r,exitMemo:reason,reason:'수기 확인'};
 assert.equal(validateProposal(r,input).exitMemo,reason);
 assert.throws(()=>validateProposal(r,{...input,entry:'09:00:00'}),/시간을 자동 변경/);
 assert.throws(()=>validateProposal(r,{...input,version:'old'}),/오래되었습니다/);
 assert.throws(()=>validateProposal(r,{...input,reason:''}),/근거/);
});
for(const blank of [false,true])test(`overlap memo ${blank?'clearing':'editing'} is independently verified without time changes`,async()=>{
 const r=record();if(blank)r.exitMemo=reason;r.version=version(r);
 let current={...r},reads=0;const writes=[];
 const out=await applyVerified({read:async()=>{reads++;return structuredClone(current);},write:async(_,field,v)=>{writes.push({field,...v});current[field]=v.time;current[field+'Memo']=v.memo;}},r,{...r,exitMemo:blank?'':reason,reason:'수기 확인'},async()=>{});
 assert.equal(out.status,'verified');assert.equal(reads,2);assert.deepEqual(writes,[{field:'exit',time:'15:39:59',memo:blank?'':reason}]);assert.equal(current.entry,'09:25:55');assert.equal(current.exit,'15:39:59');assert.equal(current.entryMemo,'');
});
test('overlap memo does not report success when CheckHere refuses to save',async()=>{
 const r=record();let writes=0;const out=await applyVerified({read:async()=>({...r}),write:async()=>{writes++;}},r,{...r,exitMemo:reason,reason:'수기 확인'},async()=>{});
 assert.equal(out.status,'failed');assert.equal(writes,1);
});
