// /old(·/old/…) → 1기 운영포털 주소(cohort.json site.oldSiteUrl)로 넘깁니다. vercel.json이 /old를 여기로 돌립니다.
// 주소가 아직 정해지지 않았으면(빈 값) 안내 글만 보입니다. 1기 사이트는 cohort1 브랜치를 배포한 1기 Vercel 프로젝트입니다.
import cohort from '../lib/cohort.cjs';
export function oldTarget(base,path=''){
  let u;try{u=new URL(String(base||''));}catch{return '';}
  if(!['https:','http:'].includes(u.protocol))return '';
  const rest=String(path||'').replace(/^\/+/,'').split('/').filter(s=>s&&s!=='..'&&s!=='.').map(encodeURIComponent).join('/');
  return u.origin+(u.pathname.replace(/\/+$/,'')||'')+'/'+rest;
}
export default function handler(req,res){
  res.setHeader('cache-control','no-store');
  const target=oldTarget(cohort.COHORT.site?.oldSiteUrl,req.query?.path);
  if(target){res.statusCode=302;res.setHeader('location',target);return res.end();}
  res.statusCode=200;res.setHeader('content-type','text/html; charset=utf-8');
  return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>1기 운영포털</title><body style="font-family:system-ui,sans-serif;padding:32px;background:#f5f7fb;color:#0f172a"><h1 style="font-size:20px">1기 운영포털 주소 준비 중</h1><p>1기 운영포털의 새 주소가 정해지면 이 주소(/old)에서 바로 이어집니다. 급하면 운영팀에 문의해 주세요.</p><p><a href="/">2기 운영포털로 가기</a></p></body>');
}
