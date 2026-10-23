// 질병 인정 한도(사용자 2026-10-23 "6회 초과 질병인정은 아예 선택이 안되도록"): 다른 날 질병 인정이 DISEASE.max(6)면 병원·질병을 고를 수 없고 저장도 막습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reasonPickHtml,diseaseUsed,diseaseFullText} from '../../reason-pick.mjs';
import {DISEASE} from '../../cohort.mjs';
import {openPortal,PORTAL,TODAY} from './teacher-fixture.mjs';

const six=Array.from({length:6},(_,i)=>({date:`2026-11-0${i+2}`,type:'인정출석',reason:'병원'}));
test('only recognized disease records on other days count; at the limit the 병원·질병 option is disabled for recognized types only',()=>{
 assert.equal(DISEASE.max,6);
 assert.equal(diseaseUsed([...six,{date:'2026-11-09',type:'결석',reason:'병원'},{date:'2026-11-10',type:'인정출석',reason:'면접'}]),6);
 assert.equal(diseaseUsed(six,'2026-11-02'),5,'지금 고치는 날은 세지 않음');
 const off=reasonPickHtml({type:'인정출석',diseaseFull:true});
 assert.match(off,/<option value="병원"\s+disabled>병원·질병 \(질병 인정 한도 다 씀\)/);
 assert.doesNotMatch(reasonPickHtml({type:'결석',diseaseFull:true}),/한도 다 씀/,'인정 출결이 아니면 막지 않음');
 assert.doesNotMatch(reasonPickHtml({type:'인정출석'}),/한도 다 씀/);
 assert.match(diseaseFullText(6,6),/6회까지/);
});

test('teacher board: a student with 6 recognized disease days cannot pick 병원 again, and the quick 병원 button is off',async()=>{
 const name='가상학생가',recs={...PORTAL.recs};
 six.forEach(r=>{recs[`${name}|${r.date}`]={type:r.type,r:r.reason};});
 delete recs[`${name}|${TODAY}`];
 const errors=await openPortal(async page=>{
  const cell=page.locator(`table.g select[data-n="${name}"][data-d="${TODAY}"]`);await cell.waitFor({timeout:30000});
  await cell.selectOption('인정출석');
  const opt=page.locator('#rp select[data-inline="rmain"] option[value="병원"]');await opt.waitFor({state:'attached'});
  assert.equal(await opt.isDisabled(),true);
  assert.equal(await page.locator('[data-q="병원"]').isDisabled(),true);
 },{path:'/#t/attendance/board',api:b=>b.action==='portalData'?{...PORTAL,recs}:null});
 assert.deepEqual(errors,[]);
});
