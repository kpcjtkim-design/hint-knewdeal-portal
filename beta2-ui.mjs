// 2기 화면 공통 도우미(운영총괄 동기화 표시는 2기에 없습니다)
import {recognizedType} from './beta2-core.mjs';
import {fileName} from './cohort.mjs';

export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function ensureBeta2Css(){
 if(document.querySelector('link[data-beta2-css]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/beta2.css?v=20261020-ev1';link.dataset.beta2Css='1';document.head.append(link);
}
const W='일월화수목금토';
export const md=iso=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||'')))return String(iso||'');const d=new Date(iso+'T00:00:00Z');return `${+iso.slice(5,7)}/${+iso.slice(8,10)}(${W[d.getUTCDay()]})`;};
export function typeClass(t){
 if(t==='결석')return 't-absent';if(recognizedType(t))return 't-rec';if(t==='해당없음')return 't-na';if(t==='중복')return 't-dup';if(['지각','조퇴','외출'].includes(t))return 't-late';return '';
}
export const badge=t=>`<span class="b2-badge ${typeClass(t)}">${esc(t||'출석')}</span>`;
export function evBadge(state){
 if(!state||state==='해당없음')return '';
 return `<span class="b2-badge ${state==='확인'?'e-ok':['미제출','반려'].includes(state)?'e-miss':'e-none'}">증빙 ${esc(state)}</span>`;
}
// 취업박람회 추가 증빙 배지(attendance-reason-catalog extraEvidence 결과 {state,done,label}): 못 했으면 '추가 증빙 필요 · 기업면접 확인서 · 미제출', 했으면 '추가 증빙 확인'
export function extraBadge(x){if(!x)return '';return x.done?`<span class="b2-badge e-ok" title="${esc(x.label)}">추가 증빙 ${esc(x.state)}</span>`:`<span class="b2-badge e-extra" title="${esc(x.label)}">${esc(x.label)} · ${esc(x.state)}</span>`;}
export function toast(message){
 const el=document.getElementById('toast');if(!el){console.info(message);return;}
 el.textContent=message;el.classList.add('show');clearTimeout(el._b2);el._b2=setTimeout(()=>el.classList.remove('show'),2200);
}
export async function copyText(text){try{await navigator.clipboard.writeText(text);toast('복사했습니다.');}catch{toast('복사하지 못했습니다. 브라우저 권한을 확인해 주세요.');}}
// 내려받는 파일 이름 앞에 '2기_'를 붙여 1기 파일과 섞이지 않게 합니다.
export function downloadCsv(name,rows){
 name=fileName(name);
 const csv='﻿'+rows.map(r=>r.map(v=>{const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export const classOptions=(classes,selected,{all=false}={})=>(all?`<option value="all" ${selected==='all'?'selected':''}>전체 반</option>`:'')+classes.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.id)}반 · ${esc(c.course||'')}</option>`).join('');
export const loading=text=>`<div class="b2-card b2-pad b2-muted">${esc(text||'불러오는 중…')}</div>`;
export const errorBox=e=>`<div class="b2-note err">${esc(e?.message||e)}</div>`;
// 같은 화면에서 비동기 작업이 겹치지 않게 하고, 화면을 떠난 뒤 늦게 온 결과는 버립니다.
export function lifecycle(host){
 let disposed=false;const cleanups=[];
 return {alive:()=>!disposed&&host.isConnected,on:fn=>cleanups.push(fn),dispose(){if(disposed)return;disposed=true;cleanups.splice(0).forEach(fn=>{try{fn();}catch{}});}};
}
