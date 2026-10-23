// 포털 알림(사용자 요청 2026-10-19): 서류발급 신청·민원 접수/답글·출결대조 메모가 저장되면 Firestore notifications에 한 건 남기고(notify),
// 로그인한 사람마다 받을 알림을 실시간으로 모읍니다(startInbox → 머리글 종·알림함 notify-inbox.mjs). 메일은 Apps Script가 나중에 맡습니다.
// 알림을 못 남겨도 본래 저장은 그대로이고 작은 안내만 띄웁니다. Firestore SDK는 처음 쓸 때 불러옵니다(화면 모듈이 SDK 없이도 열리게).
import {notificationDoc,notifyId,recipientQueries,mergeNotifications,isUnread,adminList,LIMIT} from './notify-core.mjs';
import {toast} from './beta2-ui.mjs';
const SDK='https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
let ctx={db:null,user:null,fs:null,warn:m=>toast(m)},current=null,admins=null;
// index.html이 로그인 때 startInbox로 채웁니다(시험은 fs·warn을 바꿔 넣음).
export function setNotifyContext(next={}){ctx={...ctx,...next};if('db' in next||'user' in next)admins=null;}
const sdk=async()=>ctx.fs||(ctx.fs=await import(SDK));
// 관리자 받는 사람: settings/global notifyAdmins(있으면) 아니면 cohort.json admins. 세션 동안 한 번 읽습니다.
async function adminRecipients(fs){
 if(admins)return admins;let s=null;
 try{const r=await fs.getDoc(fs.doc(ctx.db,'settings','global'));s=r.exists()?r.data():null;}catch{}
 return admins=adminList(s);
}
// kind: '서류발급'|'민원'|'출결대조 메모', payload: {title, body, cls, link, audience:'admins'|'class', to?, toClass?}. 늘 끝까지 가고 던지지 않습니다({ok}).
export async function notify(kind,payload={}){
 try{
  const {db,user}=ctx;if(!db||!user?.email)throw Error('로그인 정보를 찾지 못했습니다.');
  const fs=await sdk(),list=payload.audience==='admins'?await adminRecipients(fs):[];
  const data=notificationDoc({...payload,kind},{from:user.email,admins:list}),id=notifyId();
  await fs.setDoc(fs.doc(db,'notifications',id),{...data,createdAt:fs.serverTimestamp()});
  return {ok:true,id};
 }catch(e){console.warn('알림을 남기지 못했습니다',e);try{ctx.warn(`알림을 남기지 못했습니다(${kind}) · 저장은 됐습니다`);}catch{}return {ok:false,error:e};}
}

// 실시간 알림 저장소(로그인 한 번에 하나). 받는 사람 조건마다 onSnapshot(최근 40건, 2026-10-23 읽기 줄이기)을 따로 걸고 합칩니다.
export const inbox=()=>current;
export function stopInbox(){current?.stop();}
export function startInbox({db,user,admin=false,classIds=[],fs=null}){
 stopInbox();setNotifyContext({db,user,...(fs?{fs}:{})});
 const email=String(user?.email||'').trim().toLowerCase(),subs=new Set(),parts=new Map(),errs=new Map(),offs=[],pending=new Set();
 const s={email,admin,list:[],ready:false,error:'',stopped:false};
 const emit=()=>{if(s.stopped)return;for(const fn of [...subs])try{fn(s);}catch(e){console.warn(e);}};
 s.isUnread=n=>isUnread(n,email)&&!pending.has(n.id);
 s.unread=()=>s.list.filter(s.isUnread).length;
 s.subscribe=fn=>{subs.add(fn);fn(s);return ()=>subs.delete(fn);};
 // 읽음: readBy에 내 이메일만 더합니다(arrayUnion, 여러 건은 한 번에). 못 하면 되돌리고 오류를 던집니다.
 s.markRead=async ids=>{
  ids=[].concat(ids).filter(id=>{const n=s.list.find(x=>x.id===id);return n&&s.isUnread(n);});if(!ids.length)return 0;
  ids.forEach(id=>pending.add(id));emit();
  try{
   const f=await sdk(),ref=id=>f.doc(db,'notifications',id),val=()=>({readBy:f.arrayUnion(email)});
   if(ids.length===1)await f.updateDoc(ref(ids[0]),val());else{const b=f.writeBatch(db);ids.forEach(id=>b.update(ref(id),val()));await b.commit();}
   return ids.length;
  }catch(e){ids.forEach(id=>pending.delete(id));emit();throw e;}
 };
 s.stop=()=>{if(s.stopped)return;s.stopped=true;offs.splice(0).forEach(off=>{try{off();}catch{}});subs.clear();if(current===s)current=null;};
 current=s;
 (async()=>{
  try{
   const f=await sdk();if(s.stopped)return;
   const qs=recipientQueries({email,admin,classIds});if(!qs.length){s.ready=true;emit();return;}
   for(const [field,op,value] of qs){
    const key=`${field}|${value}`;
    offs.push(f.onSnapshot(f.query(f.collection(db,'notifications'),f.where(field,op,value),f.limit(LIMIT)),snap=>{
     parts.set(key,(snap?.docs||[]).map(d=>({id:d.id,...d.data({serverTimestamps:'estimate'})})));
     errs.delete(key);s.list=mergeNotifications(...parts.values());s.ready=true;s.error=[...errs.values()][0]||'';emit();
    },e=>{errs.set(key,e?.message||String(e));s.ready=true;s.error=[...errs.values()][0];emit();}));
   }
  }catch(e){s.ready=true;s.error=e?.message||String(e);emit();}
 })();
 return s;
}
