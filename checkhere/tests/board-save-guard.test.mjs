// 출결판(사용자 2026-10-23): 칸에서 고른 구분·사유가 저장 뒤 칸 아래에 바로 보이고(사유가 필요한데 비면 「사유 미입력」),
// 시트 저장이 끝나기 전에 로그아웃하려 하면 먼저 묻습니다("출결 입력 저장전에는 못나가게"). 이름은 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortal,PORTAL,TODAY} from './teacher-fixture.mjs';

test('after picking a type in a board cell, the reason line under it updates without reloading',async()=>{
 const errors=await openPortal(async page=>{
  const cell=page.locator(`table.g select[data-n="가상학생다"][data-d="${TODAY}"]`);await cell.waitFor({timeout:30000});
  await cell.selectOption('인정조퇴');
  const rs=cell.locator('xpath=..').locator('[data-reason-cell]');
  await rs.waitFor({timeout:10000});
  assert.equal((await rs.innerText()).trim(),'사유 미입력');
  await page.locator('#rp select[data-inline="rmain"]').selectOption('병원');
  for(let k=0;k<50&&!/병원/.test(await rs.innerText());k++)await page.waitForTimeout(100);
  assert.equal((await rs.innerText()).trim(),'병원');
 },{path:'/#t/attendance/board',api:b=>b.action==='portalSave'?{ok:true}:null});
 assert.deepEqual(errors,[]);
});

test('logout while a board save is still on its way asks first; 취소 keeps the teacher on the page',async()=>{
 let release;const hold=new Promise(r=>{release=r;});
 const errors=await openPortal(async page=>{
  const cell=page.locator(`table.g select[data-n="가상학생다"][data-d="${TODAY}"]`);await cell.waitFor({timeout:30000});
  const asked=[];page.on('dialog',d=>{asked.push(d.message());void d.dismiss();});
  await cell.selectOption('결석');
  await page.waitForTimeout(1200); // 0.7초 뒤 저장이 나가고 시트 답을 기다리는 중
  await page.locator('#logout').click();
  await page.waitForTimeout(300);
  assert.equal(asked.length,1);assert.match(asked[0],/저장되지 않은 출결 입력/);
  assert.equal(await page.locator('#logout').isVisible(),true,'still signed in');
  release();
 },{path:'/#t/attendance/board',api:b=>b.action==='portalSave'?{hold,reply:{ok:true}}:null});
 assert.deepEqual(errors,[]);
});

// 출결판에서 고르자마자 다른 탭으로 가도 그 저장은 그대로 나가고, 다른 탭에 있는 동안 저장이 안 되면 그 탭에서도 알림이 보입니다(사용자 2026-10-23).
test('switching to another tab right after picking still saves; a failed save while away shows a toast there',async()=>{
 let fail=false;
 const errors=await openPortal(async(page,posts)=>{
  const cell=page.locator(`table.g select[data-n="가상학생다"][data-d="${TODAY}"]`);await cell.waitFor({timeout:30000});
  await cell.selectOption('결석');
  await page.locator('.t2-top [data-main="documents"]').click(); // 0.7초 기다리기 전에 떠남
  for(let k=0;k<50&&!posts.some(b=>b.action==='portalSave');k++)await page.waitForTimeout(100);
  const save=posts.find(b=>b.action==='portalSave');
  const a=save?.args?.[0]||save;assert.ok(save,'portalSave sent');assert.equal(a.name,'가상학생다');assert.equal(a.type,'결석');
  // 다시 출결판으로 와서 다른 칸을 고르고 곧바로 떠남 → 이번에는 시트가 늦게(1.5초) 거절
  fail=true;
  await page.locator('.t2-top [data-main="attendance"]').click();
  const cell2=page.locator(`table.g select[data-n="가상학생가"][data-d="${TODAY}"]`);await cell2.waitFor({timeout:30000});
  await cell2.selectOption('결석');
  await page.locator('.t2-top [data-main="documents"]').click();
  await page.getByText(/출결 저장 확인 필요/).first().waitFor({timeout:10000});
 },{path:'/#t/attendance/board',api:b=>b.action==='portalSave'?(fail?{hold:new Promise(r=>setTimeout(r,1500)),reply:{ok:false,msg:'가상 거절'}}:{ok:true}):null});
 assert.deepEqual(errors,[]);
});
