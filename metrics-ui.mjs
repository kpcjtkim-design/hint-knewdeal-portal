export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pct=n=>n===null||!Number.isFinite(n)?'—':n.toFixed(1)+'%';
export function bars(items,{unit='',max=null}={}){
 const peak=max??Math.max(1,...items.map(x=>x.value||0));
 return `<div class="metric-bars" role="list">${items.map(x=>`<div class="metric-bar" role="listitem"><span>${esc(x.label)}</span><div class="bar-track"><i style="width:${Math.max(0,Math.min(100,(x.value||0)/peak*100))}%;background:${x.color||'#3878c9'}"></i></div><b>${x.value===null?'미수집':esc(x.value)+unit}</b></div>`).join('')}</div>`;
}
export const cards=items=>`<div class="metric-cards">${items.map(([label,value,hint])=>`<article><small>${esc(label)}</small><strong>${esc(value)}</strong>${hint?`<p>${esc(hint)}</p>`:''}</article>`).join('')}</div>`;
export function scoreChart(s){
 if(!s?.scores)return '<p class="metric-empty">만족도 점수는 아직 수집하지 않았습니다. 응답 동기화를 실행하면 표시됩니다.</p>';
 const scores=s.scores,rate=s.eligibleCount?s.answered.length/s.eligibleCount*100:null;
 return `${cards([['응답률',pct(rate),`${s.answered.length} / ${s.eligibleCount}명`],['종합 만족도',scores.overallAverage===null?'—':scores.overallAverage+' / '+scores.scale,'종합 만족도 문항만 집계'],['중복 제외',s.duplicateCount+'건','학생별 최신 응답 1건']])}<p class="muted">참여 대상 중 응답한 학생의 점수입니다. 난이도·추천 의향은 종합 만족도에 합산하지 않습니다.</p>${scores.questions.length?scores.questions.map(q=>`<details class="question-chart" ${q.kind==='overall'?'open':''}><summary>${esc(q.title)} <b>${q.average===null?'유효 응답 없음':q.average+' / '+q.max}</b> · ${q.count}건</summary>${bars(q.distribution.map((value,i)=>({label:(i+q.min)+'점',value})),{unit:'명'})}</details>`).join(''):'<p>평가 문항을 확인하지 못했습니다. 응답 시트 연결을 확인해 주세요.</p>'}${scores.invalid?`<p class="warning">빈칸을 제외한 범위 밖 점수 ${scores.invalid}개는 집계하지 않았습니다.</p>`:''}`;
}
