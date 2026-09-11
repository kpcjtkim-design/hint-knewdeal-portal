import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {CheckHereCollector} from './collector.mjs';
import {judge,RULES} from './rules.mjs';
import {applyVerified,validateProposal} from './writeback.mjs';
import {createApprovalCloud} from './cloud-approval.mjs';
import {proposalFromApproval,prepareApproval} from './approval-core.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=dirname(here);
export function createBridge({dataDir=join(here,'data'),collector=null,port=8765,approvalCloud=createApprovalCloud()}={}){
  mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(join(dataDir,'attendance.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots(seq INTEGER PRIMARY KEY, id TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS snapshot_id ON snapshots(id,seq); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY, job TEXT, payload TEXT);');
  const key=randomBytes(32).toString('hex'),adapter=collector||new CheckHereCollector(dataDir),jobs=new Map();let busy=null,connecting=false;
  const put=r=>db.prepare('INSERT INTO snapshots(id,payload) VALUES(?,?)').run(r.id,JSON.stringify(r));
  const latest=()=>db.prepare('SELECT payload FROM snapshots WHERE seq IN (SELECT MAX(seq) FROM snapshots GROUP BY id)').all().map(x=>JSON.parse(x.payload));
  const get=id=>{const r=db.prepare('SELECT payload FROM snapshots WHERE id=? ORDER BY seq DESC LIMIT 1').get(id);return r?JSON.parse(r.payload):null;};
  const saveJob=j=>{db.prepare('INSERT INTO jobs(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(j.id,JSON.stringify(j));jobs.set(j.id,j);};
  for(const row of db.prepare('SELECT payload FROM jobs').all()){const j=JSON.parse(row.payload);if(j.status==='running'){j.status=j.kind==='apply'?'unknown':'interrupted';j.message='프로그램이 중단되었습니다. 다시 수집해 결과를 확인해 주세요.';saveJob(j);}jobs.set(j.id,j);}
  const seed=join(dataDir,'seed.json');if(!latest().length&&existsSync(seed))for(const r of JSON.parse(readFileSync(seed,'utf8')))put({...r,source:'snapshot',readState:'partial'});
  const journal=(job,event)=>db.prepare('INSERT INTO journal(job,payload) VALUES(?,?)').run(job,JSON.stringify({at:new Date().toISOString(),...event}));
  const authorized=req=>{const raw=req.headers['x-hint-key'];return typeof raw==='string'&&raw.length===key.length&&timingSafeEqual(Buffer.from(raw),Buffer.from(key));};
  const localOrigin=o=>!o||o===`http://127.0.0.1:${port}`||o===`http://localhost:${port}`;
  const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)throw new Error('요청이 너무 큽니다.');}return raw?JSON.parse(raw):{};}
  const publicFiles={'/attendance-beta-core.mjs':'attendance-beta-core.mjs','/checkhere/bulk-collect.mjs':'checkhere/bulk-collect.mjs','/':'checkhere.html','/checkhere.html':'checkhere.html','/checkhere-ui.mjs':'checkhere-ui.mjs','/checkhere/ui.css':'checkhere/ui.css','/checkhere/rules.mjs':'checkhere/rules.mjs'};
  const server=http.createServer(async(req,res)=>{
    try{
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,{error:'허용하지 않는 주소입니다.'});
      const url=new URL(req.url,`http://127.0.0.1:${port}`),origin=req.headers.origin;
      if(req.method==='OPTIONS'){
        if(origin&&!localOrigin(origin)&&!origin.startsWith('https://'))return send(res,403,{error:'HTTPS 플랫폼에서 연결해 주세요.'});
        res.writeHead(204,{'Access-Control-Allow-Origin':origin||`http://127.0.0.1:${port}`,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, x-hint-key','Access-Control-Allow-Private-Network':'true','Vary':'Origin'});return res.end();
      }
      if(url.pathname==='/api/session'&&req.method==='GET'){
        if(!localOrigin(origin))return send(res,403,{error:'연결 키는 이 PC 화면에서 확인해 주세요.'});return send(res,200,{key,local:true,build:'20260910.5',capabilities:['approved-requests-v1'],pid:process.pid});
      }
      if(url.pathname.startsWith('/api/')){
        if(!authorized(req))return send(res,401,{error:'이 PC의 연결 키를 입력해 주세요.'});
        if(origin&&!localOrigin(origin)){if(!origin.startsWith('https://'))return send(res,403,{error:'HTTPS 플랫폼에서 연결해 주세요.'});res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
        if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{rules:RULES,capabilities:['approved-requests-v1'],busy,jobs:[...jobs.values()].slice(-20).reverse(),connected:await adapter.loggedIn(),records:latest().map(r=>({...r,audit:judge(r)}))});
        if(req.method==='GET'&&url.pathname==='/api/history'){const id=url.searchParams.get('id');return send(res,200,{snapshots:db.prepare('SELECT payload FROM snapshots WHERE id=? ORDER BY seq DESC LIMIT 20').all(id).map(x=>JSON.parse(x.payload))});}
        if(req.method!=='POST')return send(res,405,{error:'지원하지 않는 요청입니다.'});const input=await body(req);
        if(url.pathname==='/api/cancel'){if(busy&&jobs.get(busy)?.kind==='sync')adapter.cancelled=true;return send(res,200,{ok:true});}
        if(url.pathname==='/api/connect'){
          if(busy||connecting)return send(res,409,{error:'연결 또는 작업이 진행 중입니다.'});
          connecting=true;try{return send(res,200,await adapter.connect());}finally{connecting=false;}
        }
        if(url.pathname==='/api/sync'){
          if(busy)return send(res,409,{error:'진행 중인 작업이 있습니다.'});const classId=String(input.classId),dates=input.dates;
          if(!/^(?:[1-9]|1[0-7])$/.test(classId)||!Array.isArray(dates)||!dates.length||dates.length>31||new Set(dates).size!==dates.length||dates.some(d=>!/^202\d-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new Error('반 또는 날짜 범위를 확인해 주세요. 최대 31일입니다.');
          await adapter.requireLogin();const j={id:randomUUID(),kind:'sync',classId,dates,status:'running',startedAt:new Date().toISOString(),count:0,errors:0,message:'출결 상세를 읽고 있습니다.'};saveJob(j);busy=j.id;
          void(async()=>{try{
            await adapter.collect(classId,dates,async r=>{const old=get(r.id);if(old?.reference)r.reference=old.reference;if(old?.exception)r.exception=old.exception;put(r);j.count++;if(r.readState!=='complete')j.errors++;saveJob(j);},async progress=>{j.progress=progress;saveJob(j);});
            j.status=adapter.cancelled?'cancelled':j.errors?'partial':'complete';j.message=`${j.count}건 수집 · 상세 확인 실패 ${j.errors}건`;
          }catch(e){j.status=j.count?'partial':'failed';j.message=e.message;}finally{j.finishedAt=new Date().toISOString();saveJob(j);busy=null;}})();return send(res,202,j);
        }
        if(url.pathname==='/api/apply'){
          await approvalCloud.verify(input.idToken);
          const approvalId=input.approvalId;if(typeof approvalId!=='string'||!/^[-\w]{16,80}$/.test(approvalId))throw Error('승인된 수정 요청 번호가 필요합니다.');
          if(jobs.get(approvalId)?.approvalId===approvalId)return send(res,200,jobs.get(approvalId));
          if(busy||connecting)return send(res,409,{error:'진행 중인 작업이 있습니다.'});
          busy=approvalId;
          let j,record,proposal;
          try{
            const approved=await approvalCloud.get(approvalId,input.idToken);proposal=proposalFromApproval(approved.data);
            record=get(proposal.id);if(!record)throw Error('해당 반·날짜를 이 PC에서 먼저 수집해 주세요.');
            const expected=prepareApproval(approved.data,record);if(Object.keys(expected.before).some(k=>expected.before[k]!==approved.data.approval.before[k]))throw Error('승인 당시 원본과 현재 PC 기록이 다릅니다. 다시 확인해 주세요.');
            validateProposal(record,proposal);await adapter.requireLogin();
            const attemptId=randomUUID();await approvalCloud.claim(approved,input.idToken,attemptId);
            j={id:approvalId,approvalId,attemptId,approvedBy:approved.data.approvedBy,kind:'apply',recordId:record.id,status:'running',startedAt:new Date().toISOString(),message:'승인된 변경 전 값을 다시 확인하고 있습니다.'};saveJob(j);
          }catch(e){busy=null;throw e;}
          const idToken=input.idToken;
          void(async()=>{try{const result=await applyVerified(adapter,record,proposal,async e=>journal(j.id,e));Object.assign(j,result);if(result.current)put(result.current);delete j.current;}catch(e){j.status='failed';j.message=e.message;}finally{
            j.finishedAt=new Date().toISOString();saveJob(j);
            try{await approvalCloud.finish(approvalId,idToken,j.attemptId,j);j.cloudSaved=true;}catch{j.cloudSaved=false;j.cloudError='체크히어 처리 결과를 서버에 저장하지 못했습니다. 포털에서 결과 확인을 눌러 주세요.';}
            saveJob(j);busy=null;
          }})();return send(res,202,j);
        }
        if(url.pathname==='/api/reconcile'){
          await approvalCloud.verify(input.idToken);const doc=await approvalCloud.get(input.approvalId,input.idToken),j=jobs.get(input.approvalId);
          if(j?.status==='running')return send(res,200,j);
          if(doc.data.status!=='applying')return send(res,200,{status:doc.data.status});
          const result=j?.approvalId===input.approvalId?j:{id:input.approvalId,status:'unknown',message:'이 PC에 반영 완료 기록이 없습니다. 처리한 PC와 체크히어 원본을 확인해 주세요.'};
          if(j&&j.attemptId!==doc.data.attemptId)throw Error('다른 PC의 작업입니다. 처리한 PC에서 결과를 확인해 주세요.');
          if(!j)throw Error('이 PC에서 시작한 작업이 아닙니다. 처리한 수집 PC에서 결과 확인을 눌러 주세요.');
          await approvalCloud.finish(input.approvalId,input.idToken,doc.data.attemptId,result);j.cloudSaved=true;delete j.cloudError;saveJob(j);return send(res,200,j);
        }
        return send(res,404,{error:'지원하지 않는 기능입니다.'});
      }
      if(req.method==='GET'&&publicFiles[url.pathname]){
        const ext=url.pathname.endsWith('.mjs')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html';
        res.writeHead(200,{'Content-Type':`${ext}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});return res.end(readFileSync(join(root,publicFiles[url.pathname])));
      }
      return send(res,404,{error:'페이지를 찾지 못했습니다.'});
    }catch(e){return send(res,400,{error:e.message||'요청 처리 오류'});}
  });
  return{server,db,adapter,key,put,close:()=>{server.close();db.close();}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const app=createBridge();app.server.listen(8765,'127.0.0.1',()=>console.log('HINT 체크히어 검수: http://127.0.0.1:8765'));
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'이미 실행 중입니다. http://127.0.0.1:8765 를 열어 주세요.':e.message);process.exitCode=1;});
}
