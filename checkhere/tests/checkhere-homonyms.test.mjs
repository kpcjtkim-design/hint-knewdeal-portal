import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingCheckHereRecords,checkHerePhoneFor} from '../../checkhere-name-core.mjs';
import {matchSnapshot} from '../../attendance-beta-core.mjs';
import {deriveAttendanceClass,targetsFromDerived} from '../../attendance-derived-core.mjs';
import {cleanRequest,matchRequest,prepareApproval,requestMatchesRecord,APPROVER} from '../approval-core.mjs';
import {createApprovalCloud} from '../cloud-approval.mjs';
import {encodeFields} from '../../lib/survey-sync-store.mjs';
import {readRequestRecord} from '../request-record.mjs';

const identities=[{name:'가상민수(99년생)',phoneLast4:'1234'},{name:'가상민수(02년생)',phoneLast4:'5678'}];
const record=(tail='5678')=>({id:'id-'+tail,studentKey:'key-'+tail,version:'v-'+tail,classId:'9',date:'2026-08-28',name:'가상민수',phoneLast4:tail,source:'live',readState:'complete',entry:'12:00:00',rawEntry:'12:00:00',exit:'18:00:00',entryMemo:'',exitMemo:'',outings:[],collectedAt:'2026-09-18T01:00:00Z'});
const request=()=>({classId:'9',date:'2026-08-28',name:identities[1].name,phoneLast4:'',changes:{entryMemo:'(인정지각)병원_담임:가상'},reason:'가상 검증'});

test('same-class Sheet birth-year alias resolves to phone suffix while preserving real CheckHere identity',()=>{
 const rs=[record('1234'),record()],r=request();
 assert.equal(matchSnapshot({name:r.name},identities,rs,identities).record,rs[1]);
 assert.equal(matchRequest(r,rs,identities),rs[1]);
 assert.equal(matchRequest({...r,phoneLast4:'5678'},rs),rs[1]);
 const approval=prepareApproval(r,rs[1],{identities});
 assert.equal(approval.recordId,'id-5678');assert.equal(approval.after.exit,'18:00:00');
 assert.equal(cleanRequest(r).phoneLast4,'','old pending requests remain immutable');
 assert.equal(rs[1].name,'가상민수');assert.equal(rs[1].studentKey,'key-5678');
 assert(requestMatchesRecord(r,{...rs[1],...r.changes},identities));
});
test('missing, conflicting or ambiguous identity never chooses the other homonym or another class/day',()=>{
 const r=request(),rs=[record('1234'),record()];
 for(const bad of [[],identities.slice(0,1),identities.map(x=>({...x,phoneLast4:'1234'})),identities.map(x=>({...x,phoneLast4:'01012345678'}))])assert.throws(()=>matchRequest(r,rs,bad));
 assert.equal(checkHerePhoneFor({...r,phoneLast4:'1234'},identities),null);
 assert.throws(()=>matchRequest(r,[record('1234')],identities));
 assert.throws(()=>matchRequest({...r,classId:'12'},rs,identities));
 assert.throws(()=>matchRequest({...r,date:'2026-08-31'},rs,identities));
 assert.throws(()=>matchRequest(r,[record(),record()],identities));
 assert.equal(matchingCheckHereRecords(r,[{...record(),name:identities[0].name}],identities).length,0);
 assert.equal(matchRequest({...r,name:'가상민수',phoneLast4:'1234'},rs,identities),rs[0]);
});
test('recognized subtype and survey participation use the same homonym match without storing phones',()=>{
 const sheet={attendance:[['이름','','','','8/28'],[identities[0].name,'','','','인정출석'],[identities[1].name,'','','','인정출석']]};
 const derived=deriveAttendanceClass(sheet,{classId:'9',today:'2026-08-28',identities,records:[{...record('1234'),entry:'',rawEntry:'',exit:''},record()]});
 assert.equal(derived.students[0].history['2026-08-28'].status,'인정출석');
 assert.equal(derived.students[1].history['2026-08-28'].status,'인정지각');
 assert.deepEqual(targetsFromDerived(derived,'2026-08-28').map(x=>x.eligible),[false,true]);
 assert(!JSON.stringify(derived).includes('phoneLast4'));
});
test('empty collector automatically reads only the matching student, retaining real student identity',async()=>{
 const reads=[],saved=[];let days=0;
 const adapter={requireLogin:async()=>{},openDay:async(cid,date)=>{days++;assert.equal(cid,'9');assert.equal(date,'2026-08-28');return[record('1234'),{...record(),readState:'partial'}];},read:async r=>{reads.push(r.id);return record();}};
 const result=await readRequestRecord(adapter,request(),[],identities,r=>saved.push(r));
 assert.equal(result.id,'id-5678');assert.deepEqual(reads,['id-5678']);assert.equal(saved.length,1);assert.equal(days,1);
 await readRequestRecord(adapter,request(),[record()],identities);assert.equal(days,1,'existing day needs no extra roster collection');
 adapter.read=async()=>record('1234');await assert.rejects(()=>readRequestRecord(adapter,request(),[record()],identities));assert.equal(saved.length,1);
});
test('cloud resolves existing pending alias and atomically saves verified actual record with cached class identities',async()=>{
 const r=request(),id='homonym-request-0001',live={...record(),...r.changes};let identityReads=0,commits=[];
 let data={...r,status:'pending'};
 const cloud=createApprovalCloud({fetchImpl:async(url,options={})=>{
   if(url.endsWith('/classes/9')){identityReads++;return new Response(JSON.stringify({fields:encodeFields({surveyDuplicateIdentities:identities})}));}
   if(url.endsWith('/checkhereRequests/'+id))return new Response(JSON.stringify({fields:encodeFields(data),updateTime:'time-1'}));
   if(url.includes('/checkhereCurrent/'))return new Response(JSON.stringify({fields:encodeFields({records:[record('1234')]}),updateTime:'time-2'}));
   if(url.endsWith(':commit')){commits.push(JSON.parse(options.body));return new Response('{}');}
   throw Error('unexpected request '+url);
 }});
 const doc=await cloud.get(id,'fixture');assert.equal(doc.data.phoneLast4,'');assert.deepEqual(doc.identities,identities);
 data={...data,status:'applying',attemptId:'attempt',approval:prepareApproval(r,record(),{identities}),approvedBy:APPROVER};
 const result=await cloud.finish(id,'fixture','attempt',{id,status:'verified',current:live});
 assert.equal(result.platformSaved,true);assert.equal(identityReads,1);assert.equal(commits[0].writes.length,2);
 const fields=commits[0].writes[0].update.fields.records.arrayValue.values;
 assert.equal(fields.length,2);assert.equal(fields[1].mapValue.fields.name.stringValue,'가상민수');
});
