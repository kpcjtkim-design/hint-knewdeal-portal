import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveClassTeacher,createTeacherResolver} from '../../attendance-teacher.mjs';
import {suggestReason} from '../../checkhere-proposal-core.mjs';
const teacher=(name,primaryClassId,tempClassIds=[])=>({name,role:'TEACHER',active:true,primaryClassId,classId:primaryClassId,classIds:[primaryClassId,...tempClassIds],tempClassIds});

test('primary homeroom teacher is selected independently of temporary access and duplicate accounts',()=>{
  const users=[teacher('가담임','1',['2']),teacher('나담임','2'),teacher('나담임','2'),teacher('다담임','3',['2'])];
  assert.equal(resolveClassTeacher({classId:2,users}),'나담임');
  assert.equal(resolveClassTeacher({classId:'1',users}),'가담임');
  assert.equal(resolveClassTeacher({classId:'4',users}),'');
  assert.equal(resolveClassTeacher({classId:'2',users:[teacher('관리자','2'),...users].map((p,i)=>i? p:{...p,role:'ADMIN'})}),'나담임');
});

test('legacy primary assignment works; temporary-only and ambiguous access are not assignments',()=>{
  assert.equal(resolveClassTeacher({classId:'2',users:[{name:'나담임',role:'TEACHER',classId:'2'}]}),'나담임');
  assert.equal(resolveClassTeacher({classId:'2',users:[{name:'나담임',role:'TEACHER',classIds:['2','3'],tempClassIds:['3']}]}),'나담임');
  for(const profile of [{classIds:['2','3']},{tempClassIds:['2'],classIds:['2']},{primaryClassId:'2',active:false}])assert.equal(resolveClassTeacher({classId:'2',users:[{name:'나담임',role:'TEACHER',...profile}]}),'');
});

test('same-class saved teacher covers missing student records and disambiguates primary test accounts',()=>{
  const users=[teacher('가담임','1'),teacher('테스트계정','1')],record={classId:'1',teacher:'가담임'};
  assert.equal(resolveClassTeacher({classId:'1',users,records:[record]}),'가담임');
  assert.equal(resolveClassTeacher({classId:'1',users,history:[record]}),'가담임');
  assert.equal(resolveClassTeacher({classId:'2',users,history:[record]}),'');
  assert.equal(resolveClassTeacher({classId:'1',users:[teacher('새담임','1')],history:[record]}),'새담임');
  assert.equal(resolveClassTeacher({classId:'1',users,records:[record,{classId:'1',teacher:'다른담임'}]}),'');
});

test('teacher-only lookup never fills missing time or changes the CheckHere source',()=>{
  const name=resolveClassTeacher({classId:'2',users:[teacher('나담임','2')]});
  assert.equal(suggestReason({status:'지각',teacher:name}).text,'지각_담임:나담임([시간 확인])');
  const record={classId:'2',entry:'13:20:00',exit:'18:00:00',outings:[]};
  assert.equal(suggestReason({status:'인정지각',reason:'병원',teacher:name,record}).text,'(인정지각)병원_담임:나담임(13:20)');
  assert.equal(record.teacher,undefined);
});

test('directory reads are shared, expire, and recover after failure without leaking between classes',async()=>{
  let clock=0,calls=0,historyCalls=0,fail=true;
  const resolver=createTeacherResolver({now:()=>clock,ttl:100,loadUsers:async()=>{calls++;if(fail)throw Error('temporary');return[teacher('가담임','1'),teacher('나담임','2')];},loadHistory:async cid=>{historyCalls++;return cid==='1'?[{classId:'1',teacher:'가담임'}]:[];}});
  await resolver.refresh('1');assert.equal(resolver.get('1'),'가담임');assert.equal(resolver.get('2'),'');
  fail=false;await Promise.all([resolver.refresh('1'),resolver.refresh('2')]);
  assert.equal(calls,2);assert.equal(historyCalls,1);assert.equal(resolver.get('2'),'나담임');
  await resolver.refresh('2');assert.equal(calls,2);
  clock=101;await resolver.refresh('2');assert.equal(calls,3);
});
