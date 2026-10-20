// 담임 화면 시험 도구: 실제 index.html을 열고 Firebase SDK·/api/teacher-beta는 가짜로 답합니다(beta2-ui.test.mjs와 같은 방식). 사람 이름은 모두 가상입니다.
// cohort.json의 2기 Firebase 값이 아직 비어 있어(로그인 화면에서 멈춤) 시험에서만 cohort.mjs에 가짜 값을 넣고, 담임 로그인 시험은 teacherAccess도 켭니다.
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

export const base=join(import.meta.dirname,'../..');
const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
export const TODAY='2026-10-29',YESTERDAY='2026-10-28';
// 브라우저 시계: 한국 시간 2026-10-29(목) 오전 10시(머리말 '오늘 · 10/29(목)')
export const CLOCK=new Date('2026-10-29T10:00:00+09:00');
const COLS=['date','cls','name','type','inT','outT','oa','ob','reason','ev','evr','memo','evApplied','check','prov','flag','sig'];
const row=(date,cls,name,type,o={})=>COLS.map(k=>({date,cls,name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'',flag:'',sig:`sig-${name}-${date}`,...o})[k]);
export const PORTAL={cls:1,region:'서울',course:'모빌리티 AI',teacher:'가상담임',place:'서울대',mainDay:TODAY,days:[TODAY,YESTERDAY],week:[],summary:[{k:'총원',v:3},{k:'출석',v:1},{k:'결석',v:1}],
 kids:[{name:'가상학생가',status:'재학',off:''},{name:'가상학생나',status:'재학',off:''},{name:'가상학생다',status:'재학',off:''}],recs:{['가상학생가|'+TODAY]:{type:'출석'},['가상학생나|'+TODAY]:{type:'결석',r:'개인일정'}},checks:[],closed:'미확인',evals:[],sats:[],vocs:[],officer:{leader:'가상학생가'}};
export const BUNDLE={rev:5,today:TODAY,days:[YESTERDAY,TODAY],classes:Array.from({length:16},(_,i)=>({id:String(i+1),region:'서울',course:`과정${i+1}`,teacher:''})),
 roster:[['1','가상학생가','재학',''],['1','가상학생나','재학',''],['1','가상학생다','재학','']],ledgerCols:COLS,ledger:[row(TODAY,'1','가상학생나','결석',{reason:'개인일정'})],sync:{checkedAt:Date.now()-60000,changedAt:Date.now()-3600000,last:{errors:[]}}};
const DOCS={rev:5,statuses:['접수','처리중','보완 필요','처리완료','취소'],types:['출석부','교육참여확인서','훈련생 확인서','기타'],delivery:['이메일(PDF)','담임 전달','우편'],rows:[]};
const VOCS={statuses:['접수','처리중','완료','보류'],types:['수업·강사','시설·환경','출결','행정·서류','교육생 고충','안전','기타'],state:{rev:1,at:1,teacher:{}},rows:[]};
const SDK_STUB=`
window.sdkWrites=[];
const snap=(data)=>({exists:()=>data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
const DOCS={'users/teacher@test.kr':{role:'TEACHER',active:true,primaryClassId:'1',name:'가상담임'},'classes/1':{course:'모빌리티 AI',region:'서울',venue:'서울대',coreLinks:{}}};
export const getFirestore=()=>({}),doc=(db,...p)=>({path:p.join('/')}),collection=(db,...p)=>({path:p.join('/')}),query=(c)=>c,where=()=>({}),orderBy=()=>({}),limit=()=>({}),documentId=()=>'id',serverTimestamp=()=>'ts';
export const getDoc=async ref=>snap(DOCS[ref.path]),getDocFromServer=async ref=>snap(DOCS[ref.path]);
export const getDocs=async()=>({docs:[],size:0}),getDocsFromServer=async()=>({docs:[],size:0,metadata:{}});
export const onSnapshot=()=>()=>{};
export const setDoc=async(ref,data)=>{window.sdkWrites.push(['set',ref.path,data]);},updateDoc=async(ref,data)=>{window.sdkWrites.push(['update',ref.path,data]);},deleteDoc=async ref=>{window.sdkWrites.push(['delete',ref.path]);},addDoc=async(c,data)=>{window.sdkWrites.push(['add',c.path,data]);return {id:'n'};};
export const runTransaction=async(db,fn)=>fn({get:async()=>snap(undefined),set(){},update(){},delete(){}});
export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});`;
const AUTH_STUB=email=>`
export const getAuth=()=>({}),signInWithPopup=async()=>{},reauthenticateWithPopup=async()=>{},signOut=async()=>{},setPersistence=async()=>{},browserLocalPersistence={};
export class GoogleAuthProvider{setCustomParameters(){}addScope(){}static credentialFromResult(){return null;}}
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb({email:'${email}',displayName:'가상',uid:'u1',getIdToken:async()=>'tok-1'}),0);return()=>{};};`;
const TYPES={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
// 시험용 cohort.mjs: Firebase 값만 채우고(teacher면 담임 로그인도 켬) 나머지는 그대로
const cohortFor=teacher=>readFileSync(join(base,'cohort.mjs'),'utf8').replace('"apiKey": ""','"apiKey": "test-key"').replace('"appId": ""','"appId": "test-app"').replace(/"teacherAccess": (?:true|false)/,`"teacherAccess": ${teacher}`);
export const ANSWERS={portalData:()=>PORTAL,b2Bundle:()=>BUNDLE,b2Rev:()=>({rev:BUNDLE.rev,sync:BUNDLE.sync,voc:VOCS.state}),b2Docs:()=>DOCS,b2Vocs:()=>VOCS,b2Dropouts:()=>({rev:BUNDLE.rev,maxAbsence:12,rows:[]})};

// as: 'teacher'(담임 로그인, 화면이 바로 담임 화면) · 'admin'(관리자 → 미리보기 → 담임 화면). api(body)가 값을 돌려주면 그 응답을 씁니다({hold:Promise}면 그때까지 기다림).
// path: 처음 여는 주소(예: '/#t/attendance/reason'). viewport: {width,height}. files(경로)가 {hold:Promise}면 그 파일을 늦게, {status:404}면 못 찾게 줍니다.
export async function openPortal(run,{as='teacher',api=()=>null,files=()=>null,path='/',viewport={width:1360,height:900}}={}){
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport}),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.clock.setFixedTime(CLOCK);
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href.startsWith(SDK+'firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:SDK_STUB});
   if(url.href===SDK+'firebase-app.js')return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.href===SDK+'firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:AUTH_STUB(as==='teacher'?'teacher@test.kr':'hint.kpc@gmail.com')});
   if(url.hostname!=='fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html;charset=utf-8',body:readFileSync(join(base,'index.html'),'utf8')});
   if(url.pathname==='/cohort.mjs')return route.fulfill({contentType:'text/javascript',body:cohortFor(as==='teacher')});
   if(url.pathname==='/api/teacher-beta'){
    const body=route.request().postDataJSON();posts.push(body);
    let custom=await api(body);if(custom?.hold){await custom.hold;custom=custom.reply;}
    if(custom)return route.fulfill({contentType:'application/json',...(custom.status?{status:custom.status}:{}),body:JSON.stringify(custom.body||{ok:true,data:custom})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:ANSWERS[body.action]?.()||{}})});
   }
   const special=files(url.pathname);if(special?.hold)await special.hold;if(special?.status)return route.fulfill({status:special.status,body:''});
   const file=join(base,decodeURIComponent(url.pathname));
   if(file.startsWith(base)&&existsSync(file)&&TYPES[extname(file)])return route.fulfill({contentType:TYPES[extname(file)],body:readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fixture.test'+path);
  if(as==='admin'){await page.locator('.admin-major button',{hasText:'미리보기'}).click();}
  await page.locator('[data-main]').first().waitFor({timeout:20000});
  await run(page,posts,errors);
  return errors;
 }finally{await browser.close();}
}
