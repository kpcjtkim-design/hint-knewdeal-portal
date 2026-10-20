import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText,notificationDoc,notifyId,idTime,createdMs,recipientQueries,mergeNotifications,isUnread,pickNotifications,linkFor,parseLink,cleanLink,teacherTarget,adminList,whenText,KINDS} from '../../notify-core.mjs';
import {notify,setNotifyContext,startInbox,stopInbox,inbox} from '../../notify.mjs';

// 포털 알림(사용자 요청 2026-10-19): 알림 문서·받는 사람·합치기·읽음, Firestore는 가짜(fs)로. 사람 이름·이메일은 모두 가상입니다.
const A1='hint.kpc@gmail.com',A2='kpc.jtkim@gmail.com',T1='teacher1@test.kr';

test('notification bodies drop phone numbers, resident numbers and birthdates but keep request numbers and lesson dates',()=>{
 assert.equal(cleanText('가상학생 010-1234-5678 연락 요망'),'가상학생 *** 연락 요망');
 assert.equal(cleanText('주민 990101-1234567 확인'),'주민 *** 확인');
 assert.equal(cleanText('생년월일: 1999.01.01 필요'),'생년월일 *** 필요');
 assert.equal(cleanText('생일 990101'),'생일 ***');
 assert.equal(cleanText('2001년 3월 5일생'),'***생');
 assert.equal(cleanText('D261019-001 · 10/28(화) 출석부 2026-10-28'),'D261019-001 · 10/28(화) 출석부 2026-10-28');
 assert.equal(cleanText('  여러   줄\n글  '),'여러 줄 글');
 assert.equal(cleanText('가'.repeat(200),10),'가'.repeat(9)+'…');
});

test('a notification for the office goes to the admin role and the named admins except the sender, who counts it as read',()=>{
 const d=notificationDoc({kind:'출결대조 메모',audience:'admins',cls:'3',title:'출결대조 메모 · 3반 가상학생',body:'10/28(수) 수기출석 사인 미비',link:'#b2ledger?cls=3&date=2026-10-28'},{from:A1.toUpperCase(),admins:[A1,A2]});
 assert.deepEqual(d,{kind:'출결대조 메모',title:'출결대조 메모 · 3반 가상학생',body:'10/28(수) 수기출석 사인 미비',cls:'3',link:'#b2ledger?cls=3&date=2026-10-28',to:[A2],from:A1,readBy:[A1],toRole:'admin'});
 const t=notificationDoc({kind:'민원',audience:'class',cls:'12',to:[T1,'not-an-email',T1],title:'민원·이슈 답글 · 12반 기타',body:'',link:'javascript:alert(1)'},{from:A2});
 assert.deepEqual([t.toClass,t.toRole,t.to,t.link,t.readBy],['12',undefined,[T1],'',[A2]]);
 assert.equal(notificationDoc({kind:'서류발급',audience:'admins',cls:'99',title:''},{from:T1,admins:[A1]}).cls,'','unknown classes are dropped');
 assert.equal(notificationDoc({kind:'서류발급',audience:'admins',title:''},{from:T1,admins:[A1]}).title,'서류발급','an empty title falls back to the kind');
 assert.throws(()=>notificationDoc({kind:'민원',title:'x'},{from:A1}),/받을 사람/);
 assert.throws(()=>notificationDoc({kind:'',audience:'admins'},{from:A1,admins:[A2]}),/종류/);
 assert.throws(()=>notificationDoc({kind:'민원',audience:'admins'},{from:'',admins:[A2]}),/보내는 사람/);
 assert.deepEqual(KINDS,['서류발급','민원','출결대조 메모']);
});

test('the office list comes from settings when set, otherwise from the cohort admins',()=>{
 assert.deepEqual(adminList(null),[A1,A2]);
 assert.deepEqual(adminList({notifyAdmins:[]}),[A1,A2]);
 assert.deepEqual(adminList({notifyAdmins:[' Ops@Test.kr ','ops@test.kr','bad']}),['ops@test.kr']);
});

test('document numbers sort newest first so one recipient filter plus a limit reads the latest notifications',()=>{
 const older=notifyId(1_790_000_000_000,()=>0),newer=notifyId(1_790_000_060_000,()=>0.5);
 assert.match(older,/^n\d{13}-[0-9a-z]{4}$/);
 assert.ok(newer<older);
 assert.equal(idTime(newer),1_790_000_060_000);
 assert.equal(createdMs({id:newer}),1_790_000_060_000,'pending server time falls back to the number');
 assert.equal(createdMs({createdAt:{seconds:10,nanoseconds:5e6}}),10005);
 assert.equal(createdMs({createdAt:{toMillis:()=>7}}),7);
});

test('recipients: my e-mail for everyone, the admin role for admins, one query per assigned class for teachers',()=>{
 assert.deepEqual(recipientQueries({email:'Hint.KPC@gmail.com',admin:true,classIds:['1']}),[['to','array-contains',A1],['toRole','==','admin']]);
 assert.deepEqual(recipientQueries({email:T1,classIds:['3','3',12,'99']}),[['to','array-contains',T1],['toClass','==','3'],['toClass','==','12']]);
 assert.deepEqual(recipientQueries({email:''}),[]);
});

test('merging keeps one copy, newest first, at most 100; filters and unread follow readBy',()=>{
 const n=(id,s,o={})=>({id,createdAt:{seconds:s},kind:'민원',readBy:[],...o});
 const list=mergeNotifications([n('a',1),n('b',3)],[n('b',3,{readBy:[A1]}),n('c',2,{kind:'서류발급'})]);
 assert.deepEqual(list.map(x=>x.id),['b','c','a']);
 assert.deepEqual(list[0].readBy,[A1],'the later copy wins');
 assert.equal(mergeNotifications(Array.from({length:130},(_,i)=>n('x'+i,i))).length,100);
 assert.equal(isUnread(list[0],'HINT.KPC@gmail.com'),false);assert.equal(isUnread(list[1],A1),true);
 const unread=x=>isUnread(x,A1);
 assert.deepEqual(pickNotifications(list,{filter:'unread'},unread).map(x=>x.id),['c','a']);
 assert.deepEqual(pickNotifications(list,{kind:'서류발급'},unread).map(x=>x.id),['c']);
});

test('links stay inside the site and map to teacher tabs',()=>{
 assert.equal(linkFor('b2vocs',{cls:'3',id:'V261019-001',date:''}),'#b2vocs?cls=3&id=V261019-001');
 assert.deepEqual(parseLink('#b2ledger?cls=3&date=2026-10-28'),{tab:'b2ledger',params:{cls:'3',date:'2026-10-28'}});
 assert.equal(parseLink('https://evil.test'),null);assert.equal(cleanLink('#a b'),'');
 assert.deepEqual(teacherTarget('b2docs'),['documents']);assert.deepEqual(teacherTarget('b2vocs'),['feedback','voc']);assert.deepEqual(teacherTarget('b2ledger'),['today']);
});

test('times read as just now, minutes, hours today, then month/day',()=>{
 const now=Date.parse('2026-10-28T05:00:00Z');// 14:00 KST
 assert.equal(whenText(now-20000,now),'방금');
 assert.equal(whenText(now-5*60000,now),'5분 전');
 assert.equal(whenText(now-3*3600000,now),'3시간 전');
 assert.equal(whenText(Date.parse('2026-10-27T01:05:00Z'),now),'10/27 10:05');
 assert.equal(whenText(0,now),'');
});

// 가짜 Firestore: 쓰기·구독을 기록하고, 구독에는 조건(where)에 맞는 문서만 줍니다.
function fakeFs({settings=null,failSet=false}={}){
 const writes=[],subs=[];
 const fs={writes,subs,
  doc:(db,...p)=>({path:p.join('/')}),collection:(db,...p)=>({path:p.join('/')}),where:(field,op,value)=>({field,op,value}),limit:n=>({limit:n}),
  query:(c,...cs)=>({path:c.path,filters:cs.filter(x=>x.field),limit:cs.find(x=>x.limit)?.limit}),
  serverTimestamp:()=>'TS',arrayUnion:(...v)=>({union:v}),
  getDoc:async ref=>({exists:()=>ref.path==='settings/global'&&!!settings,data:()=>settings}),
  setDoc:async(ref,data)=>{if(failSet)throw Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});writes.push(['set',ref.path,data]);},
  updateDoc:async(ref,data)=>{writes.push(['update',ref.path,data]);},
  writeBatch:()=>{const ops=[];return {update:(ref,data)=>ops.push(['batch.update',ref.path,data]),commit:async()=>{writes.push(...ops,['commit']);}};},
  onSnapshot:(q,cb,err)=>{const s={q,cb,err,live:true};subs.push(s);return ()=>{s.live=false;};}};
 fs.push=docs=>{for(const s of fs.subs.filter(x=>x.live)){const hit=docs.filter(d=>s.q.filters.every(f=>f.op==='array-contains'?(d[f.field]||[]).includes(f.value):d[f.field]===f.value));s.cb({docs:hit.map(({id,...d})=>({id,data:()=>d}))});}};
 return fs;
}

test('notify writes one notification with a server time and never throws when the write is refused',async()=>{
 const warns=[],fs=fakeFs({settings:{notifyAdmins:[A1,'ops@test.kr']}}),user={email:T1};
 setNotifyContext({db:{},user,fs,warn:m=>warns.push(m)});
 const r=await notify('서류발급',{audience:'admins',cls:'1',title:'서류발급 신청 · 1반 가상학생',body:'출석부 1부 · 제출처 가상기관 · 전화 010-0000-1111',link:'#b2docs?cls=1&id=D261028-001'});
 assert.equal(r.ok,true);
 assert.equal(fs.writes.length,1);
 const [kind,path,data]=fs.writes[0];
 assert.equal(kind,'set');assert.match(path,/^notifications\/n\d{13}-/);
 assert.deepEqual(data,{kind:'서류발급',title:'서류발급 신청 · 1반 가상학생',body:'출석부 1부 · 제출처 가상기관 · 전화 ***',cls:'1',link:'#b2docs?cls=1&id=D261028-001',to:[A1,'ops@test.kr'],from:T1,readBy:[T1],toRole:'admin',createdAt:'TS'});
 const bad=fakeFs({failSet:true});setNotifyContext({fs:bad});
 const r2=await notify('민원',{audience:'admins',title:'x'});
 assert.equal(r2.ok,false);assert.deepEqual(warns,['알림을 남기지 못했습니다(민원) · 저장은 됐습니다']);
 setNotifyContext({user:null});
 assert.equal((await notify('민원',{audience:'admins',title:'x'})).ok,false,'no login, no write, no throw');
});

test('the inbox merges my recipient queries live, counts unread and marks one or all as read with arrayUnion',async()=>{
 const fs=fakeFs(),seen=[];
 const s=startInbox({db:{},user:{email:A1},admin:true,fs});
 assert.equal(inbox(),s);
 s.subscribe(x=>seen.push(x.list.length));
 await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(fs.subs.map(x=>[x.q.path,x.q.filters.map(f=>[f.field,f.op,f.value]),x.q.limit]),[['notifications',[['to','array-contains',A1]],100],['notifications',[['toRole','==','admin']],100]]);
 fs.push([
  {id:'n2',kind:'민원',title:'민원·이슈 접수 · 3반',toRole:'admin',to:[A2],readBy:[T1],createdAt:{seconds:20}},
  {id:'n1',kind:'출결대조 메모',title:'출결대조 메모 · 1반',toRole:'admin',to:[A1],readBy:[],createdAt:{seconds:30}},
  {id:'n3',kind:'민원',title:'다른 반 담임에게',toClass:'5',to:[],readBy:[],createdAt:{seconds:40}}]);
 assert.deepEqual(s.list.map(x=>x.id),['n1','n2'],'one copy each, newest first, nothing addressed elsewhere');
 assert.equal(s.unread(),2);
 assert.equal(await s.markRead('n2'),1);
 assert.deepEqual(fs.writes.at(-1),['update','notifications/n2',{readBy:{union:[A1]}}]);
 assert.equal(s.unread(),1,'shown as read at once');
 assert.equal(await s.markRead('n2'),0,'already read: no write');
 assert.equal(await s.markRead(['n1','n2']),1);
 fs.push([{id:'n4',kind:'서류발급',title:'a',toRole:'admin',to:[],readBy:[],createdAt:{seconds:50}},{id:'n5',kind:'서류발급',title:'b',toRole:'admin',to:[],readBy:[],createdAt:{seconds:60}}]);
 assert.equal(s.unread(),2);
 assert.equal(await s.markRead(s.list.filter(s.isUnread).map(x=>x.id)),2);
 assert.deepEqual(fs.writes.slice(-3).map(w=>w.slice(0,2)),[['batch.update','notifications/n5'],['batch.update','notifications/n4'],['commit']]);
 stopInbox();
 assert.equal(inbox(),null);assert.ok(fs.subs.every(x=>!x.live),'stopping unsubscribes');
});

test('a teacher inbox listens to the teacher e-mail and each assigned class; a refused query shows an error but keeps the others',async()=>{
 const fs=fakeFs(),s=startInbox({db:{},user:{email:T1},classIds:['3','7'],fs});
 await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(fs.subs.map(x=>x.q.filters.map(f=>`${f.field}${f.op}${f.value}`).join()),[`toarray-contains${T1}`,'toClass==3','toClass==7']);
 fs.subs[2].live=false;fs.subs[2].err(Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'}));
 fs.push([{id:'n1',kind:'민원',title:'운영팀 답글',toClass:'3',to:[],readBy:[],createdAt:{seconds:1}}]);
 assert.deepEqual(s.list.map(x=>x.id),['n1']);assert.match(s.error,/permissions/);
 stopInbox();
});
