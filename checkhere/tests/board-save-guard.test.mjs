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
