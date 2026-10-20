// 포털 알림(사용자 요청 2026-10-19) 순수 함수: 알림 문서 만들기·받는 사람 조회·합치기·거르기·이동 주소. 화면·Firestore 없이 시험합니다(notify-core.test.mjs).
// 알림 문서: {kind, title, body, cls, link, to:[이메일], toRole:'admin'?, toClass:'N'?, from, createdAt, readBy:[이메일]}. 생년월일·전화번호는 본문에 남기지 않습니다(cleanText).
import {ADMINS,CLASS_ID_RE} from './cohort.mjs';

export const KINDS=['서류발급','민원','출결대조 메모'];
export const LIMIT=100,MAX_TO=10,TITLE_MAX=80,BODY_MAX=160;
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normEmail=v=>{const s=String(v??'').trim().toLowerCase();return EMAIL_RE.test(s)?s:'';};
const uniq=a=>[...new Set(a)];
// 개인정보 가리기: 주민번호 모양·전화번호·'생년월일 …'·19xx·200x년 날짜·따로 떨어진 6자리 숫자(YYMMDD)는 ***로. 신청번호(D261019-001)처럼 글자에 붙은 숫자는 그대로.
const MASKS=[[/\d{6}\s?-\s?[1-4]\d{6}/g,'***'],[/(?:\+?82[-.\s]?)?0\d{1,2}[-.\s)]?\d{3,4}[-.\s]?\d{4}/g,'***'],[/(생년월일|생일)\s*[:：]?\s*[\d.\-/년월일\s]{4,14}/g,'$1 *** '],[/(?:19\d{2}|200\d)\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?/g,'***'],[/(?<![\w-])\d{6}(?![\w-])/g,'***']];
export function cleanText(v,max=BODY_MAX){
 let s=String(v??'');for(const [re,to] of MASKS)s=s.replace(re,to);
 s=s.replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;
}
// 이동 주소: '#탭?반=…' 모양만(사이트 안 화면). 예: '#b2ledger?cls=3&date=2026-10-28', '#b2vocs?cls=3&id=V261019-001'
const LINK_RE=/^#([A-Za-z0-9_-]{1,40})(?:\?([A-Za-z0-9=&_.:%-]{0,150}))?$/;
export function linkFor(tab,params={}){const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>[k,String(v)])).toString();const l=`#${tab}${q?'?'+q:''}`;return LINK_RE.test(l)?l:`#${tab}`;}
export const cleanLink=v=>LINK_RE.test(String(v??''))?String(v):'';
export function parseLink(link){const m=LINK_RE.exec(String(link??''));return m?{tab:m[1],params:Object.fromEntries(new URLSearchParams(m[2]||''))}:null;}
// 담임 화면에서 갈 곳(beta2-teacher-layout.mjs 탭): 서류발급 → 서류발급, 민원·이슈 → 민원·만족도 › 민원·이슈, 그 밖은 오늘.
export const teacherTarget=tab=>({b2docs:['documents'],b2vocs:['feedback','voc']})[tab]||['today'];
// 관리자 받는 사람: 설정(settings/global notifyAdmins, 이메일 목록)이 있으면 그것, 없으면 cohort.json admins(hint.kpc · kpc.jtkim).
export function adminList(settings){const l=uniq((Array.isArray(settings?.notifyAdmins)?settings.notifyAdmins:[]).map(normEmail).filter(Boolean)).slice(0,MAX_TO);return l.length?l:[...ADMINS];}
// 알림 문서(createdAt은 notify.mjs가 serverTimestamp로). audience: 'admins'(toRole admin + 관리자 목록) · 'class'(그 반 담임, toClass). 보낸 사람은 to에서 빼고 readBy에 넣어 '안 읽음'으로 세지 않습니다.
export function notificationDoc(p,{from,admins=[]}={}){
 const kind=String(p?.kind??'').trim(),me=normEmail(from);
 if(!kind)throw Error('알림 종류가 없습니다.');if(!me)throw Error('보내는 사람 계정을 찾지 못했습니다.');
 const cls=String(p.cls??'').trim(),toClass=String(p.audience==='class'?cls:p.toClass??'').trim();
 const to=uniq([...(Array.isArray(p.to)?p.to:[]),...(p.audience==='admins'?admins:[])].map(normEmail).filter(e=>e&&e!==me)).slice(0,MAX_TO);
 const d={kind,title:cleanText(p.title,TITLE_MAX)||kind,body:cleanText(p.body,BODY_MAX),cls:CLASS_ID_RE.test(cls)?cls:'',link:cleanLink(p.link),to,from:me,readBy:[me]};
 if(p.audience==='admins'||p.toRole==='admin')d.toRole='admin';
 if(CLASS_ID_RE.test(toClass))d.toClass=toClass;
 if(!d.to.length&&!d.toRole&&!d.toClass)throw Error('알림 받을 사람이 없습니다.');
 return d;
}
// 문서 번호: 시간 역순('n' + (10^13 - 밀리초) 13자리 + 임의 4자). 번호 오름차순 = 최신 먼저라 조건 하나 + limit만으로 최근 것을 읽습니다(복합 색인 없음).
export function notifyId(now=Date.now(),rand=Math.random){return 'n'+String(1e13-Math.floor(now)).padStart(13,'0')+'-'+Math.floor(rand()*1679616).toString(36).padStart(4,'0');}
export const idTime=id=>{const m=/^n(\d{13})-/.exec(String(id??''));return m?1e13-+m[1]:0;};
export function createdMs(n){const c=n?.createdAt;if(c&&typeof c.toMillis==='function')return c.toMillis();if(c&&typeof c.seconds==='number')return c.seconds*1000+Math.floor((c.nanoseconds||0)/1e6);if(typeof c==='number')return c;return idTime(n?.id);}
// 받는 사람 조회(따로 걸고 합침): 내 이메일(to), 관리자면 toRole admin, 담임이면 담당 반마다 toClass ==.
export function recipientQueries({email,admin=false,classIds=[]}){
 const me=normEmail(email);if(!me)return [];
 return [['to','array-contains',me],...(admin?[['toRole','==','admin']]:uniq(classIds.map(String)).filter(c=>CLASS_ID_RE.test(c)).slice(0,MAX_TO).map(c=>['toClass','==',c]))];
}
export function mergeNotifications(...lists){
 const by=new Map();for(const l of lists)for(const n of l||[])if(n?.id)by.set(n.id,n);
 return [...by.values()].sort((a,b)=>createdMs(b)-createdMs(a)||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,LIMIT);
}
export const isUnread=(n,email)=>!(n?.readBy||[]).map(normEmail).includes(normEmail(email));
// filter: 'all' | 'unread', kind: '' 또는 종류 이름
export const pickNotifications=(list,{filter='all',kind=''}={},unread=()=>false)=>list.filter(n=>(filter!=='unread'||unread(n))&&(!kind||n.kind===kind));
const korea=ms=>new Date(ms).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'});
export function whenText(ms,now=Date.now()){
 if(!ms)return '';const d=Math.max(0,now-ms),k=korea(ms);
 if(d<60000)return '방금';if(d<3600000)return `${Math.floor(d/60000)}분 전`;
 if(k.slice(0,10)===korea(now).slice(0,10))return `${Math.floor(d/3600000)}시간 전`;
 return `${+k.slice(5,7)}/${+k.slice(8,10)} ${k.slice(11,16)}`;
}
