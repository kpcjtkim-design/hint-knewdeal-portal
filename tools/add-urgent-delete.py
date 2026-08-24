from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

s=s.replace('<button id="clearCommonUrgent" class="btn btn-ghost">해제</button><button id="saveCommonUrgent" class="btn btn-danger">공통 긴급 요청 발송</button>', '<button id="clearCommonUrgent" class="btn btn-ghost">해제</button><button id="deleteCommonUrgent" class="btn btn-danger">삭제</button><button id="saveCommonUrgent" class="btn btn-danger">공통 긴급 요청 발송</button>')
s=s.replace('<button id="clearClassUrgent" class="btn btn-ghost">해제</button><button id="saveClassUrgent" class="btn btn-danger">이 반 긴급 요청 발송</button>', '<button id="clearClassUrgent" class="btn btn-ghost">해제</button><button id="deleteClassUrgent" class="btn btn-danger">삭제</button><button id="saveClassUrgent" class="btn btn-danger">이 반 긴급 요청 발송</button>')

common_anchor="document.getElementById('clearCommonUrgent').onclick=async()=>{await setDoc(doc(db,'settings','global'),{commonUrgentActive:false,commonUrgentUpdatedAt:serverTimestamp()},{merge:true});toast('공통 긴급 요청 해제 완료');urgentAdmin(user,p,String(selected))};"
common_new=common_anchor+"\n  document.getElementById('deleteCommonUrgent').onclick=async()=>{if(!confirm('공통 긴급 요청을 완전히 삭제할까요?'))return;await setDoc(doc(db,'settings','global'),{commonUrgentText:'',commonUrgentActive:false,commonUrgentUpdatedAt:serverTimestamp()},{merge:true});toast('공통 긴급 요청 삭제 완료');urgentAdmin(user,p,String(selected))};"
if common_anchor in s and "deleteCommonUrgent').onclick" not in s:
    s=s.replace(common_anchor,common_new,1)

class_anchor="document.getElementById('clearClassUrgent').onclick=async()=>{await setDoc(doc(db,'classes',String(selected)),{urgentActive:false,urgentUpdatedAt:serverTimestamp()},{merge:true});toast(`${selected}반 긴급 요청 해제 완료`);urgentAdmin(user,p,String(selected))};"
class_new=class_anchor+"\n  document.getElementById('deleteClassUrgent').onclick=async()=>{if(!confirm(`${selected}반 긴급 요청을 완전히 삭제할까요?`))return;await setDoc(doc(db,'classes',String(selected)),{urgentText:'',urgentActive:false,urgentUpdatedAt:serverTimestamp()},{merge:true});toast(`${selected}반 긴급 요청 삭제 완료`);urgentAdmin(user,p,String(selected))};"
if class_anchor in s and "deleteClassUrgent').onclick" not in s:
    s=s.replace(class_anchor,class_new,1)

p.write_text(s,encoding='utf-8')
print('patched urgent delete buttons')
