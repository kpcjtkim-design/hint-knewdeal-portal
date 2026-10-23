// 정원 40명 반(최신 확정 명단 2026-10-22: 4·7·8·13반)에서 담임 화면 출결판·출석률 표가 40명을 모두 그리는지(사용자 2026-10-23). 이름은 모두 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortal,PORTAL,BUNDLE,TODAY} from './teacher-fixture.mjs';

const N=40,names=Array.from({length:N},(_,i)=>`가상학생${String(i+1).padStart(2,'0')}`);
const portal={...PORTAL,kids:names.map(name=>({name,status:'재학',off:''})),recs:{[`${names[0]}|${TODAY}`]:{type:'결석',r:'개인일정'}},summary:[{k:'총원',v:N},{k:'출석',v:N-1},{k:'결석',v:1}]};
const bundle={...BUNDLE,roster:names.map(n=>['1',n,'재학',''])};

test('a 40-student class: the teacher 출결판 and 출석률 tables list every student',async()=>{
 const errors=await openPortal(async page=>{
  await page.locator('table.g select').first().waitFor({timeout:30000});
  const boardNames=await page.locator('table.g tbody tr').count();
  assert(boardNames>=N,`출결판 줄 ${boardNames}`);
  for(const n of [names[0],names[19],names[N-1]])assert.equal(await page.getByText(n,{exact:true}).first().isVisible(),true,n);
  await page.locator('[data-subtab="stats"]').click();
  await page.locator('.b2-table tbody tr').nth(N-1).waitFor({timeout:30000});
  assert.equal(await page.locator('.b2-table tbody tr').count(),N,'출석률 표 40줄');
 },{path:'/#t/attendance/board',api:b=>b.action==='portalData'?portal:b.action==='b2Bundle'?bundle:null});
 assert.deepEqual(errors,[]);
});
