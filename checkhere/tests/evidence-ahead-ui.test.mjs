// 미리 넣은(오늘 뒤 날짜) 인정 출결도 담임 증빙서류·질병 인정 탭에 보입니다(사용자 2026-10-23 "가상 데이터 학생이 담임화면에서 증빙서류와 질병인정탭에 뜨지 않음").
// 출석률 통계는 오늘까지만 셉니다. 이름은 모두 가상입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortal,BUNDLE,TODAY} from './teacher-fixture.mjs';

const COLS=BUNDLE.ledgerCols,row=(date,name,type,o={})=>COLS.map(k=>({date,cls:'1',name,type,inT:'',outT:'',oa:'',ob:'',reason:'',ev:'',evr:'',memo:'',evApplied:type.startsWith('인정')?'미제출':'해당없음',check:'',prov:'베타 수정',flag:'',sig:'s',...o})[k]);
const AHEAD=['2026-11-02','2026-11-03','2026-11-04','2026-11-05'];
const bundle={...BUNDLE,days:[...BUNDLE.days,...AHEAD],ledger:[...BUNDLE.ledger,...AHEAD.map(d=>row(d,'가상학생가','인정출석',{reason:'병원'}))]};

test('recognized records dated after today show in the teacher 증빙서류 and 질병 인정 views',async()=>{
 assert(AHEAD.every(d=>d>TODAY));
 const errors=await openPortal(async page=>{
  await page.locator('.b2-table tbody tr').first().waitFor({timeout:30000});
  assert.equal(await page.locator('.b2-table tbody tr',{hasText:'가상학생가'}).count()>=AHEAD.length,true,'증빙서류: 미리 넣은 인정 4건');
  await page.locator('[data-subtab="disease"]').click();
  await page.locator('.b2-table tbody tr',{hasText:'가상학생가'}).first().waitFor({timeout:30000});
  assert.match(await page.locator('.b2-table tbody tr',{hasText:'가상학생가'}).first().innerText(),/4\/6회/);
 },{path:'/#t/attendance/evidence',api:b=>b.action==='b2Bundle'?bundle:null});
 assert.deepEqual(errors,[]);
});
