// 출결판 칸 아래 사유(사용자 2026-10-23 "사유가 더 명확히 보이도록"): 앞의 [가상데이터] 꼬리표는 떼고 사유 자체를 보이고, 전체 문구는 title에 남깁니다. 이름은 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortal,PORTAL,TODAY} from './teacher-fixture.mjs';

test('board cells show the reason itself under the type, without a leading [tag]',async()=>{
 const name='가상학생가',recs={...PORTAL.recs,[`${name}|${TODAY}`]:{type:'인정출석',r:'[가상데이터] 병원 진료(질병)'}};
 const errors=await openPortal(async page=>{
  const cell=page.locator(`table.g select[data-n="${name}"][data-d="${TODAY}"]`);await cell.waitFor({timeout:30000});
  const rs=cell.locator('xpath=..').locator('[data-reason-cell]');
  assert.equal((await rs.innerText()).trim(),'병원 진료(질병)');
  assert.equal(await rs.getAttribute('title'),'[가상데이터] 병원 진료(질병)');
 },{path:'/#t/attendance/board',api:b=>b.action==='portalData'?{...PORTAL,recs}:null});
 assert.deepEqual(errors,[]);
});
