// 화면 데이터의 기록 번호(eventId) 표시: 시간 삭제는 번호가 있는 칸(퇴실 COMPLETE·관리자 1교시 ATTEND)만. 순수 함수 시험, 가상 학생만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readStudent,planFromPageData,dayStudent,marksOf,DELETE_MARKS} from '../day-data.mjs';
import {studentKey,version} from '../identity.mjs';

const DATE='2026-09-03',iso=t=>`${DATE}T${t}`;
const ev=(type,t,eventId,memoByAdmin=null)=>({eventId,userId:'u',time:iso(t),baseTime:iso('09:00:00'),timeIndex:0,type,isRecognized:false,status:'NORMAL',memoByAdmin,updatedAt:null});
const student=(name,phone,eventList)=>({sequence:1,attendeeId:'a',typeAttendee:'STUDENT',name,userName:name,phone,identifier:'가상',eventList,leaveEvents:{totalLeavedDuration:'PT0S',totalLeavedSeconds:0,pairs:[]},duration:'PT9H',seconds:32400});
// 체크인한 학생: ENTER(번호)+PASS(번호 없음)+COMPLETE(번호) / 관리자가 1교시를 넣은 학생: ENTER(번호 없음)+ATTEND(번호)+COMPLETE.
const checkedIn=()=>student('가상체크인','01022220001',[ev('ENTER','08:55:31','ev-1'),ev('PASS','08:55:31',null),ev('COMPLETE','17:50:08','ev-2')]);
const admin=()=>student('가상관리자','01022220002',[ev('ENTER','08:50:03',null),ev('ATTEND','08:50:03','ev-3','시스템오류_담임:가상'),ev('COMPLETE','18:00:00','ev-4')]);
const computed=()=>student('가상계산','01022220003',[ev('ENTER','09:00:00','ev-5'),ev('ATTEND','09:00:00',null),ev('COMPLETE','18:00:00',null)]);
const noTimes=()=>student('가상없음','01022220004',[]);
const resaved=()=>student('가상사유','01022220005',[ev('ENTER','09:20:00','ev-6'),ev('ATTEND','09:20:00','ev-7','지각_담임:가상담임(09:20)'),ev('COMPLETE','17:55:00','ev-8')]);

test('readStudent marks the period kind and which cells carry a record number',()=>{
  assert.deepEqual(marksOf(readStudent(checkedIn())),{entryKind:'PASS',entryEventId:false,exitEventId:true,enterEventId:true});
  assert.deepEqual(marksOf(readStudent(admin())),{entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false});
  assert.deepEqual(marksOf(readStudent(computed())),{entryKind:'ATTEND',entryEventId:false,exitEventId:false,enterEventId:true},'a null eventId is a computed value');
  assert.deepEqual(marksOf(readStudent(noTimes())),{entryKind:null,entryEventId:false,exitEventId:false,enterEventId:false});
  // 체크인한 학생의 1교시에 관리자 사유를 저장하면 ATTEND(번호 있음)가 새로 생깁니다(Cowork 10/14). 입실 번호로 체크인한 학생임을 압니다.
  assert.deepEqual(marksOf(readStudent(resaved())),{entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:true});
  const blankId=admin();blankId.eventList[2].eventId='  ';assert.equal(readStudent(blankId).exitEventId,false,'a blank id is no id');
  const s=readStudent(admin());assert.deepEqual([s.rawEntry,s.entry,s.exit,s.entryMemo,s.problems],['08:50:03','08:50:03','18:00:00','시스템오류_담임:가상',[]],'the existing fields are unchanged');
  assert.deepEqual(DELETE_MARKS,['entryKind','entryEventId','exitEventId','enterEventId']);
});

const rowsOf=list=>list.map((s,i)=>{const d=readStudent(s),r={classId:'2',date:DATE,name:s.name,studentKey:studentKey(s.name,s.phone),phoneLast4:s.phone.slice(-4),rowIndex:i+2,schedule:'09:00 ~ 18:00',rawEntry:d.rawEntry,entry:d.entry,exit:d.exit,outingCount:0,outings:[],entryMemo:null,exitMemo:null,source:'live',readState:'partial',tableSignature:'t'+i};r.id='id'+i;return r;});
test('planFromPageData carries the marks without touching the version or the agreement check',()=>{
  const list=[checkedIn(),admin(),computed()],rows=rowsOf(list),plan=planFromPageData(rows,{data:{eventResultList:list}});
  assert.deepEqual(plan.fallback,[]);
  assert.deepEqual(['id0','id1','id2'].map(id=>marksOf(plan.byId.get(id))),[{entryKind:'PASS',entryEventId:false,exitEventId:true,enterEventId:true},{entryKind:'ATTEND',entryEventId:true,exitEventId:true,enterEventId:false},{entryKind:'ATTEND',entryEventId:false,exitEventId:false,enterEventId:true}]);
  const r=plan.byId.get('id1'),bare={...r};for(const k of DELETE_MARKS)delete bare[k];
  assert.equal(r.version,version(bare),'the version is the same as without marks');
  assert.equal(version({...r,entryKind:'PASS',entryEventId:false,exitEventId:false,enterEventId:true}),r.version,'changing a mark never changes the version');
  // 번호만 다른 같은 값의 날: 버전도 그대로입니다(모든 기록이 바뀐 것으로 보이지 않음).
  const renumbered=[checkedIn(),admin(),computed()];renumbered[1].eventList[1].eventId=null;
  const again=planFromPageData(rows,{data:{eventResultList:renumbered}}).byId.get('id1');assert.equal(again.version,r.version);assert.equal(again.entryEventId,false);
});

test('dayStudent returns the one trusted student for a key, or null so deletion stays locked',()=>{
  const list=[checkedIn(),admin()],json={data:{eventResultList:list}},key=studentKey('가상관리자','01022220002');
  assert.equal(dayStudent(json,key).name,'가상관리자');assert.equal(dayStudent(json,key).exitEventId,true);
  assert.equal(dayStudent(json,studentKey('가상관리자','01099999999')),null,'another phone is another student');
  assert.equal(dayStudent({data:{eventResultList:[...list,admin()]}},key),null,'the same student twice');
  const twice=admin();twice.eventList.push(ev('COMPLETE','18:10:00','ev-9'));assert.equal(dayStudent({data:{eventResultList:[twice]}},key),null,'two exits are doubtful');
  const short=student('가상관리자','2002',admin().eventList);assert.equal(dayStudent({data:{eventResultList:[short]}},studentKey('가상관리자','2002')),null,'a short phone is not an identity');
  for(const bad of [null,{},{data:{}},{data:{eventResultList:'x'}}])assert.equal(dayStudent(bad,key),null);
  assert.equal(dayStudent(json,''),null);
});
