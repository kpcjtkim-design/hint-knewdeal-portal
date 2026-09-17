import {duplicateStudents,validateDuplicateIdentities} from './survey-identity.mjs';
import {readJson,within} from './attendance-io.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function editSurveyIdentities(dialog,{classId,store,user}){
 const [sheet,saved]=await Promise.all([readJson('/api/attendance-reader',{classId,idToken:await within(user.getIdToken()),allowCache:true},{timeout:55000}),store.identities(classId)]);
 if(!Array.isArray(sheet.attendance))throw Error('시트 학생 명단을 확인하지 못했습니다.');
 const targets=sheet.attendance.slice(1).map((r,i)=>({id:`${i}_${r[0]}`,name:String(r[0]||'').trim()})).filter(s=>s.name),students=duplicateStudents(targets);
 dialog.innerHTML=`<h3>${esc(classId)}반 · 동명이인 연결</h3><p>같은 반에서 이름이 겹치는 학생만 전화번호 끝 4자리로 구분합니다. 원본 명단과 대조하여 입력해 주세요. 전체 전화번호와 생년월일은 저장하지 않습니다.</p>${students.map((s,i)=>`<label>${esc(s.name)}<input data-identity="${i}" aria-label="${esc(s.name)} 전화번호 끝 4자리" inputmode="numeric" maxlength="4" value="${esc(saved.find(x=>x.name===s.name)?.phoneLast4||'')}"></label>`).join('')||'<p>같은 반의 동명이인이 없습니다.</p>'}<p role="status" id="identityStatus"></p><button id="identityClose">닫기</button>${students.length?'<button id="identitySave">연결 저장</button>':''}`;
 const $=s=>dialog.querySelector(s);$('#identityClose').onclick=()=>dialog.close();
 if(students.length)$('#identitySave').onclick=async()=>{const b=$('#identitySave');b.disabled=true;$('#identityClose').disabled=true;try{
  const entries=students.map((s,i)=>({name:s.name,phoneLast4:$(`[data-identity="${i}"]`).value.trim()}));validateDuplicateIdentities(entries,targets);
  await store.saveIdentities(classId,entries,targets);$('#identityStatus').textContent=`${entries.length}명 연결 저장 완료. 다음 수동·자동 동기화부터 참여 여부와 점수에 적용됩니다.`;
 }catch(e){$('#identityStatus').textContent=e.message;}finally{b.disabled=false;$('#identityClose').disabled=false;}};
 dialog.showModal();
}
