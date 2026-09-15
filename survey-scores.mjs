import {classNumber,normalizeName} from './survey-core.mjs';
export function scoreColumns(headers){
 return headers.flatMap((raw,index)=>{const title=String(raw||'').trim();
  if(!title||/이름|성함|성명|전화|이메일|타임스탬프|timestamp|분반|소속|자유롭게|좋았던\s*점|건의|개선사항|무엇인가|작성해|입력해/i.test(title))return [];
  const kind=/추천.*의향/.test(title)?'recommendation':/난이도/.test(title)?'difficulty':/종합\s*만족|전반.*만족|전반에.*만족/.test(title)?'overall':'question';
  if(kind==='question'&&!/있었다|되었다|이루어졌다|만족|도움|적절|전문성|전달 방식|이해할 수|계기가/.test(title))return [];
  return [{id:'q'+index,index,title,kind,min:kind==='recommendation'?0:1,max:kind==='recommendation'?10:5}];
 });
}
export function responseTime(value,fallback=0){
 const text=String(value||'').trim(),m=text.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2})?:(\d{2})(?::(\d{2}))?/);
 if(m){let h=Number(m[5]||0);if(m[4])h=h%12+(m[4]==='오후'?12:0);return Date.UTC(+m[1],+m[2]-1,+m[3],h-9,+m[6],+(m[7]||0));}
 const n=Date.parse(text);return Number.isFinite(n)?n:fallback;
}
export function summarizeScores(responses,classId,answered,{scale=5}={}){
 const allowed=new Set(answered.map(s=>normalizeName(s.name))),latest=new Map();
 responses.forEach((r,i)=>{const key=normalizeName(r.name);if(classNumber(r.classId)!==String(classId)||!allowed.has(key))return;const time=responseTime(r.timestamp,i);if(!latest.has(key)||time>=latest.get(key).time)latest.set(key,{r,time});});
 const questions=new Map();let invalid=0;
 for(const {r}of latest.values())for(const q of r.scores||[]){
  const max=q.kind==='recommendation'?10:scale,min=q.kind==='recommendation'?0:1,key=q.id;
  if(!questions.has(key))questions.set(key,{id:key,title:q.title,kind:q.kind,min,max,count:0,sum:0,distribution:Array(max-min+1).fill(0)});
  if(String(q.value??'').trim()==='')continue;
  const n=Number(q.value);if(!Number.isInteger(n)||n<min||n>max){invalid++;continue;}
  const item=questions.get(key);item.count++;item.sum+=n;item.distribution[n-min]++;
 }
 const items=[...questions.values()].map(q=>({...q,average:q.count?Math.round(q.sum/q.count*100)/100:null}));
 const overall=items.filter(q=>q.kind==='overall'),count=overall.reduce((n,q)=>n+q.count,0),sum=overall.reduce((n,q)=>n+q.sum,0);
 return {version:1,scale,respondents:latest.size,scoredRespondents:[...latest.values()].filter(({r})=>(r.scores||[]).some(q=>q.kind==='overall'&&String(q.value??'').trim()!==''&&Number(q.value)>=1&&Number(q.value)<=scale)).length,overallAverage:count?Math.round(sum/count*100)/100:null,overallCount:count,overallSum:sum,invalid,questions:items};
}
