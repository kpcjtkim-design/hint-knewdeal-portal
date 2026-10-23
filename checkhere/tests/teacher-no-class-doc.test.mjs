// 2기 새 Firebase에는 classes/{id} 문서가 없습니다. 담임 로그인 화면이 「담당 반 설정이 없습니다」로 멈추지 않고 기본 반 정보로 열려야 합니다(사용자 2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortal} from './teacher-fixture.mjs';

test('a teacher whose class has no Firestore class doc still gets the teacher screen',async()=>{
 const errors=await openPortal(async page=>{
  assert.equal(await page.getByText('담당 반 설정이 없습니다').count(),0);
  assert.equal(await page.locator('[data-main]').first().isVisible(),true);
 },{classDoc:false});
 assert.deepEqual(errors,[]);
});
