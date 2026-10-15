// 시험 전용 가짜 Google Apps Script 환경. 실제 시트·Drive·트리거에 접속하지 않습니다.
// SpreadsheetApp·Sheets(고급 서비스)·DriveApp·PropertiesService·LockService·CacheService·Utilities·ScriptApp과 시계를 흉내 내고,
// 읽기·쓰기 횟수, 잠금 밖에서 한 쓰기, 일부러 낸 일시 오류를 기록합니다.
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

process.env.TZ='Asia/Seoul'; // Apps Script 프로젝트 시간대와 같게(new Date(y,m,d)가 한국 자정이 되도록)

const colNum=s=>[...s].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
export const colName=n=>{let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=(n-m-1)/26;}return s;};

// parseTimes: 실제 Sheets처럼 '09:20' 같은 글자를 시간 값(1899-12-30 날짜)으로 바꿔 넣습니다(예전 시험은 글자 그대로를 봄).
export function createGas({now='2026-10-14T10:00:00+09:00',tz='Asia/Seoul',sheetsApi=true,cache=true,files=[],parseTimes=false}={}){
 const clock={t:Date.parse(now)};
 class FakeDate extends Date{constructor(...a){if(!a.length)super(clock.t);else super(...a);}static now(){return clock.t;}}
 const fmtParts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(d).map(x=>[x.type,x.value]));
 function formatDate(d,zone,pattern){
  if(zone!==tz)throw new Error('시험은 '+tz+'만 씁니다: '+zone);
  const p=fmtParts(d),dow={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[p.weekday];
  return pattern.replace(/yyyy|yy|MM|dd|HH|mm|ss|u/g,k=>({yyyy:p.year,yy:p.year.slice(2),MM:p.month,dd:p.day,HH:p.hour,mm:p.minute,ss:p.second,u:String(dow)})[k]);
 }
 const log={reads:[],writes:[],outsideLock:[],flushes:0,api:[],drive:0,sleeps:[],failures:[],mails:[],cache:[],seq:0,locks:0};
 const lock={depth:0,other:false};
 const failures=[];   // {sheet, op:'read'|'write'|'flush'|'cacheRead'|'cacheWrite', message, times, skip(처음 몇 번은 통과)}
 const hooks=[];      // {when(ev), run(), once}
 const ev=e=>{for(const h of [...hooks])if(h.when(e)){if(h.once)hooks.splice(hooks.indexOf(h),1);h.run(e);}};
 const maybeFail=(sheet,op)=>{const f=failures.find(f=>f.times>0&&(f.sheet===undefined||f.sheet===sheet)&&f.op===op);if(f&&f.skip>0){f.skip--;return;}if(f){f.times--;log.failures.push(`${sheet}:${op}`);ev({op:'fail',sheet,kind:op});throw new Error(f.message);}};

 class Range{
  constructor(sh,r,c,nr,nc){
   if(!(r>=1&&c>=1&&nr>=1&&nc>=1)||r+nr-1>sh.maxRows||c+nc-1>sh.maxCols)throw new Error(`Exception: 범위가 시트 밖입니다 (${sh.name} R${r}C${c} ${nr}x${nc}, 시트 ${sh.maxRows}x${sh.maxCols})`);
   Object.assign(this,{sh,r,c,nr,nc});
  }
  _read(kind){const sh=this.sh;maybeFail(sh.name,'read');log.reads.push({seq:++log.seq,book:sh.book.id,sheet:sh.name,r:this.r,c:this.c,nr:this.nr,nc:this.nc,kind});}
  _write(kind){
   const sh=this.sh;maybeFail(sh.name,'write');
   log.writes.push({seq:++log.seq,book:sh.book.id,sheet:sh.name,r:this.r,c:this.c,nr:this.nr,nc:this.nc,kind});
   if(sh.book.master&&!lock.depth)log.outsideLock.push(`${sh.name} R${this.r}C${this.c} ${kind}`);
   if(!sh.book.master)throw new Error('운영총괄(원본)에는 쓰지 않아야 합니다: '+sh.name);
  }
  _grid(fn){const out=[];for(let i=0;i<this.nr;i++){const row=[];for(let j=0;j<this.nc;j++)row.push(fn(this.r+i,this.c+j));out.push(row);}return out;}
  getValues(){this._read('values');const g=this._grid((r,c)=>this.sh.get(r,c));ev({op:'read',range:this});return g.map(r=>r.map(v=>v instanceof Date?new FakeDate(v.getTime()):v));}
  getDisplayValues(){this._read('display');const g=this._grid((r,c)=>this.sh.display(r,c));ev({op:'read',range:this});return g;}
  getBackgrounds(){this._read('backgrounds');return this._grid((r,c)=>this.sh.bg.get(this.sh.key(r,c))||'#ffffff');}
  getValue(){return this.getValues()[0][0];}
  getDisplayValue(){return this.getDisplayValues()[0][0];}
  // 수식: 칸마다 글자로 보관(계산은 하지 않음. 시험이 결과 값을 따로 채움)
  getFormulas(){this._read('formulas');return this._grid((r,c)=>this.sh.f.get(this.sh.key(r,c))||'');}
  getFormula(){return this.getFormulas()[0][0];}
  setFormulas(rows){
   if(!Array.isArray(rows)||rows.length!==this.nr||rows.some(r=>r.length!==this.nc))throw new Error('Exception: 수식 배열 크기가 범위와 다릅니다.');
   this._write('formulas');rows.forEach((row,i)=>row.forEach((f,j)=>{const k=this.sh.key(this.r+i,this.c+j);this.sh.v.delete(k);if(f)this.sh.f.set(k,f);else this.sh.f.delete(k);}));ev({op:'write',range:this});return this;
  }
  setFormula(f){if(this.nr!==1||this.nc!==1)throw new Error('시험은 한 칸 setFormula만 흉내 냅니다.');return this.setFormulas([[f]]);}
  getNumberFormat(){this._read('format');return this.sh.fmt.get(this.sh.key(this.r,this.c))||'0.###############';}
  setValues(rows){
   if(!Array.isArray(rows)||rows.length!==this.nr)throw new Error(`Exception: 데이터 행 수(${rows?.length})가 범위 행 수(${this.nr})와 다릅니다.`);
   rows.forEach((row,i)=>{if(row.length!==this.nc)throw new Error(`Exception: 데이터 열 수(${row.length})가 범위 열 수(${this.nc})와 다릅니다 (${i}행).`);});
   this._write('values');rows.forEach((row,i)=>row.forEach((v,j)=>this.sh.put(this.r+i,this.c+j,v)));ev({op:'write',range:this});return this;
  }
  setValue(v){return this.setValues([[v]]);}
  clearContent(){this._write('clear');for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++)this.sh.put(this.r+i,this.c+j,'');ev({op:'write',range:this});return this;}
  setNumberFormat(f){this._write('format');for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++)this.sh.fmt.set(this.sh.key(this.r+i,this.c+j),f);return this;}
  setDataValidation(){this._write('validation');return this;}
  getRow(){return this.r;} getColumn(){return this.c;} getNumRows(){return this.nr;} getNumColumns(){return this.nc;} getSheet(){return this.sh;}
 }
 class Sheet{
  constructor(book,name,rows=200,cols=26){Object.assign(this,{book,name,maxRows:rows,maxCols:cols,v:new Map(),bg:new Map(),fmt:new Map(),f:new Map(),id:++book.seq});}
  key(r,c){return r*100000+c;}
  get(r,c){const v=this.v.get(this.key(r,c));return v===undefined?'':v;}
  display(r,c){const v=this.get(r,c);return v instanceof Date?formatDate(v,tz,'yyyy-MM-dd'):String(v);}
  put(r,c,v,raw=false){const k=this.key(r,c);if(!raw)this.f.delete(k);if(v===''||v===null||v===undefined){this.v.delete(k);return;}
   if(!raw&&typeof v==='string'){
    // Sheets는 '='로 시작하는 글자를 수식으로 받고, 앞의 '는 '글자로 두라'는 표시로만 쓰고 값에 남기지 않습니다.
    if(v[0]==='='){this.f.set(k,v);this.v.delete(k);return;}
    if(v[0]==="'"){this.v.set(k,v.slice(1));return;}
    const t=parseTimes&&this.fmt.get(k)!=='@'&&v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if(t){this.v.set(k,new FakeDate(1899,11,30,+t[1],+t[2],+(t[3]||0)));return;}
   }
   // Sheets는 일반 서식 칸에 숫자처럼 보이는 글자('01234567', '12345e67')를 넣으면 숫자로 바꿉니다. '@'(일반 텍스트) 서식이면 그대로 둡니다.
   if(!raw&&typeof v==='string'&&this.fmt.get(k)!=='@'&&/^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(v))v=Number(v);
   this.v.set(k,v instanceof Date?new FakeDate(v.getTime()):v);}
  formula(r,c,f){this.f.set(this.key(r,c),f);return this;} // 시험 도우미(기록에 남지 않음)
  getRange(a,b,c,d){
   if(typeof a==='string'){
    const m=a.match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/);if(!m)throw new Error('A1 표기를 읽지 못했습니다: '+a);
    const c1=m[1]?colNum(m[1]):1,r1=m[2]?+m[2]:1,two=a.includes(':');
    const c2=two?(m[3]?colNum(m[3]):this.maxCols):c1,r2=two?(m[4]?+m[4]:this.maxRows):r1;
    return new Range(this,r1,c1,r2-r1+1,c2-c1+1);
   }
   return new Range(this,a,b,c??1,d??1);
  }
  getMaxRows(){return this.maxRows;} getMaxColumns(){return this.maxCols;}
  getLastRow(){let n=0;for(const k of [...this.v.keys(),...this.f.keys()])n=Math.max(n,Math.floor(k/100000));return n;}
  getLastColumn(){let n=0;for(const k of [...this.v.keys(),...this.f.keys()])n=Math.max(n,k%100000);return n;}
  getDataRange(){return new Range(this,1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
  getRangeList(list){return {clearContent:()=>{list.forEach(a=>this.getRange(a).clearContent());},setNumberFormat:f=>{list.forEach(a=>this.getRange(a).setNumberFormat(f));}};}
  insertRowsAfter(after,n){this._shift(after,n);this.maxRows+=n;}
  insertColumnsAfter(after,n){this.maxCols+=n;}
  deleteRow(r){maybeFail(this.name,'write');log.writes.push({seq:++log.seq,book:this.book.id,sheet:this.name,r,c:1,nr:1,nc:this.maxCols,kind:'deleteRow'});if(this.book.master&&!lock.depth)log.outsideLock.push(this.name+' deleteRow '+r);this._shift(r,-1);this.maxRows--;}
  _shift(at,n){for(const m of [this.v,this.bg,this.fmt,this.f]){const e=[...m];m.clear();for(const [k,v] of e){const r=Math.floor(k/100000),c=k%100000;if(n<0&&r===at)continue;m.set(this.key(r>at?r+n:r,c),v);}}}
  appendRow(row){const at=this.getLastRow()+1;if(at>this.maxRows)this.insertRowsAfter(this.maxRows,at-this.maxRows);if(row.length>this.maxCols)this.maxCols=row.length;this.getRange(at,1,1,row.length).setValues([row]);return this;}
  getSheetId(){return this.id;} getName(){return this.name;} setFrozenRows(){} activate(){}
  hideSheet(){this.hidden=true;return this;} showSheet(){this.hidden=false;return this;} isSheetHidden(){return !!this.hidden;}
  getConditionalFormatRules(){log.reads.push({seq:++log.seq,book:this.book.id,sheet:this.name,kind:'rules'});return this.rules||[];} setConditionalFormatRules(rules){log.writes.push({seq:++log.seq,book:this.book.id,sheet:this.name,kind:'rules'});this.rules=rules;}
  // 시험에서 칸을 바로 채우는 도우미(기록에 남지 않음)
  fill(r,c,rows){rows.forEach((row,i)=>row.forEach((v,j)=>this.put(r+i,c+j,v,true)));return this;}
  color(r,c,hex){this.bg.set(this.key(r,c),hex);return this;}
  rows(r,c,nr,nc){const out=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++)row.push(this.get(r+i,c+j));out.push(row);}return out;}
 }
 class Book{
  constructor(id,name,master){Object.assign(this,{id,name,master,sheets:[],seq:0,updated:clock.t});}
  add(name,rows,cols){const s=new Sheet(this,name,rows,cols);this.sheets.push(s);return s;}
  touch(){this.updated=clock.t;}
  getSheetByName(n){return this.sheets.find(s=>s.name===n)||null;}
  getSheets(){return [...this.sheets];}
  insertSheet(n){if(this.getSheetByName(n))throw new Error('Exception: 이미 있는 탭 이름입니다: '+n);log.writes.push({seq:++log.seq,book:this.id,sheet:n,kind:'insertSheet'});if(this.master&&!lock.depth)log.outsideLock.push('insertSheet '+n);return this.add(n,1000,26);}
  deleteSheet(s){log.writes.push({seq:++log.seq,book:this.id,sheet:s.name,kind:'deleteSheet'});if(this.master&&!lock.depth)log.outsideLock.push('deleteSheet '+s.name);this.sheets.splice(this.sheets.indexOf(s),1);}
  getSpreadsheetTimeZone(){return tz;}
  getUrl(){return 'https://docs.google.com/spreadsheets/d/'+this.id+'/edit';}
  getId(){return this.id;}
 }
 const books=new Map();
 const book=(id,name,master=false)=>{const b=new Book(id,name,master);books.set(id,b);return b;};
 const store=()=>{const m=new Map();return {getProperty:k=>m.has(k)?m.get(k):null,setProperty(k,v){m.set(k,String(v));return this;},deleteProperty(k){m.delete(k);return this;},getProperties:()=>Object.fromEntries(m),_m:m};};
 const scriptProps=store(),docProps=store();
 const lockObj=()=>{let mine=0;return {
  waitLock(){if(lock.other)throw new Error('Lock timeout: another process was holding the lock for too long.');mine++;lock.depth++;log.locks++;},
  tryLock(){if(lock.other)return false;mine++;lock.depth++;log.locks++;return true;},
  releaseLock(){if(mine){mine--;lock.depth--;}},hasLock:()=>mine>0};};
 const triggers=[];
 // 데이터 확인·조건부 서식 만들기 흉내. 조건부 서식은 whenTextEqualTo 값을 getBooleanCondition으로 돌려줍니다.
 const builder=()=>{const st={},p=new Proxy({},{get:(_,k)=>k==='build'?()=>({getBooleanCondition:()=>st.eq===undefined?null:{getCriteriaType:()=>'TEXT_EQUAL_TO',getCriteriaValues:()=>[st.eq]}}):(...a)=>{if(k==='whenTextEqualTo')st.eq=a[0];return p;}});return p;};
 let active=null;
 // CacheService.getScriptCache() 흉내: 키 250자·값 100KB(UTF-8)·보관 최대 6시간(가짜 시계) 한도를 지키지 않으면 실제처럼 오류를 냅니다.
 // 읽기·쓰기는 log.cache에 남고, failures에 {op:'cacheRead'|'cacheWrite'}를 넣으면 일부러 실패합니다. 들어 있는 값은 cacheStore(시험이 지우거나 볼 수 있음).
 const cacheStore=new Map();
 const cacheLive=k=>{const e=cacheStore.get(k);if(!e)return null;if(e.exp<=clock.t){cacheStore.delete(k);return null;}return e.v;};
 const cacheCheck=(k,v,ttl)=>{
  if(typeof k!=='string'||!k||k.length>250)throw new Error('Argument too large: key');
  if(typeof v!=='string')throw new Error('캐시 값은 문자열이어야 합니다: '+k);
  if(Buffer.byteLength(v,'utf8')>100*1024)throw new Error('Argument too large: value');
  if(!(ttl>=1&&ttl<=21600))throw new Error('보관 시간은 1~21600초입니다: '+ttl);
 };
 const scriptCache={
  get(k){maybeFail('Cache','cacheRead');log.cache.push({op:'get',n:1});return cacheLive(k);},
  getAll(keys){maybeFail('Cache','cacheRead');log.cache.push({op:'getAll',n:keys.length});const out={};for(const k of keys){const v=cacheLive(k);if(v!==null)out[k]=v;}return out;},
  put(k,v,ttl=600){maybeFail('Cache','cacheWrite');cacheCheck(k,v,ttl);log.cache.push({op:'put',n:1});cacheStore.set(k,{v,exp:clock.t+ttl*1000});},
  putAll(map,ttl=600){maybeFail('Cache','cacheWrite');const e=Object.entries(map);e.forEach(([k,v])=>cacheCheck(k,v,ttl));log.cache.push({op:'putAll',n:e.length});for(const [k,v] of e)cacheStore.set(k,{v,exp:clock.t+ttl*1000});},
  remove(k){maybeFail('Cache','cacheWrite');log.cache.push({op:'remove',n:1});cacheStore.delete(k);},
  removeAll(keys){maybeFail('Cache','cacheWrite');log.cache.push({op:'removeAll',n:keys.length});for(const k of keys)cacheStore.delete(k);}
 };
 const SheetsApi={Spreadsheets:{get(id){const b=books.get(id);if(!b)throw new Error('Requested entity was not found.');maybeFail('Sheets','read');log.api.push('titles');return {sheets:b.sheets.map(x=>({properties:{title:x.name}}))};},Values:{batchGet(id,{ranges}){
  const b=books.get(id);if(!b)throw new Error('Requested entity was not found.');
  maybeFail('Sheets','read');log.api.push(ranges.length);
  return {valueRanges:ranges.map(rg=>{
   const m=rg.match(/^'((?:[^']|'')*)'!(.+)$/),sh=m&&b.getSheetByName(m[1].replace(/''/g,"'"));
   if(!sh)throw new Error('Unable to parse range: '+rg);
   const a=m[2].match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/),c1=a[1]?colNum(a[1]):1,r1=a[2]?+a[2]:1;
   const c2=Math.min(sh.maxCols,a[3]?colNum(a[3]):sh.maxCols),r2=Math.min(sh.maxRows,a[4]?+a[4]:sh.maxRows);
   const rows=[];for(let r=r1;r<=r2;r++){const row=[];for(let c=c1;c<=c2;c++)row.push(sh.display(r,c));while(row.length&&row.at(-1)==='')row.pop();rows.push(row);}
   while(rows.length&&!rows.at(-1).length)rows.pop();
   return rows.length?{range:rg,majorDimension:'ROWS',values:rows}:{range:rg,majorDimension:'ROWS'};
  })};
 }}}};
 const ctx={
  console,Date:FakeDate,
  SpreadsheetApp:{
   getActiveSpreadsheet:()=>active,getActive:()=>active,
   openById(id){const b=books.get(id);if(!b)throw new Error('Unexpected error while getting the method or property openById');return b;},
   flush(){maybeFail(undefined,'flush');log.flushes++;},
   newDataValidation:builder,newConditionalFormatRule:builder,BooleanCriteria:{TEXT_EQUAL_TO:'TEXT_EQUAL_TO'},
   getUi:()=>({createMenu:()=>{const m={addItem:()=>m,addSeparator:()=>m,addToUi:()=>m};return m;},alert(){}})
  },
  DriveApp:{getFileById(id){const b=books.get(id);if(!b)throw new Error('파일 없음');log.drive++;return {getLastUpdated:()=>new FakeDate(b.updated)};}},
  PropertiesService:{getScriptProperties:()=>scriptProps,getDocumentProperties:()=>docProps},
  LockService:{getDocumentLock:lockObj,getScriptLock:lockObj},
  Utilities:{formatDate,sleep(ms){log.sleeps.push(ms);clock.t+=ms;},getUuid:()=>'00000000-0000-4000-8000-'+String(Math.floor(Math.random()*1e12)).padStart(12,'0')},
  ScriptApp:{getProjectTriggers:()=>[...triggers],deleteTrigger(t){triggers.splice(triggers.indexOf(t),1);},
   newTrigger(fn){const t={fn,kind:'',every:0,getHandlerFunction:()=>fn};const c={timeBased:()=>c,everyMinutes(n){t.kind='minutes';t.every=n;return c;},everyHours(n){t.kind='hours';t.every=n;return c;},everyDays(n){t.kind='days';t.every=n;return c;},atHour(h){t.hour=h;return c;},nearMinute(m){t.minute=m;return c;},create(){triggers.push(t);return t;}};return c;},
   getService:()=>({getUrl:()=>'https://script.google.com/macros/s/fake/exec'})},
  Session:{getActiveUser:()=>({getEmail:()=>'tester@example.com'}),getEffectiveUser:()=>({getEmail:()=>'tester@example.com'})}, // 편집기에서 소유자가 실행한 것처럼
  MailApp:{sendEmail(m){log.mails.push(m);}}
 };
 if(sheetsApi)ctx.Sheets=SheetsApi;
 if(cache)ctx.CacheService={getScriptCache:()=>scriptCache};
 const context=vm.createContext(ctx);
 for(const f of files)vm.runInContext(readFileSync(f,'utf8'),context,{filename:String(f)});
 return {
  ctx:context,clock,FakeDate,log,lock,failures,hooks,books,scriptProps,docProps,triggers,formatDate,cacheStore,
  book(id,name,master){const b=book(id,name,master);if(master)active=b;return b;},
  run:(code)=>vm.runInContext(code,context),
  call:(name,...args)=>context[name](...args),
  at(iso){clock.t=Date.parse(iso);},
  advance(ms){clock.t+=ms;},
  date:(y,m,d)=>new FakeDate(y,m-1,d),
  resetLog(){for(const k of ['reads','writes','outsideLock','api','sleeps','failures','mails','cache'])log[k].length=0;log.flushes=0;log.drive=0;log.locks=0;}
 };
}
