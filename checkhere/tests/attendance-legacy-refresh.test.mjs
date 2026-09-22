import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadPlaywright} from '../collector.mjs';

test('legacy manual reload bypasses the display cache and paints the new sheet value',async()=>{
 const {chromium}=loadPlaywright(),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),base=join(import.meta.dirname,'../..'),bodies=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',route=>{
   const url=new URL(route.request().url()),path=url.pathname.slice(1);
   if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:`export const doc=()=>({}),getDoc=async()=>({exists:()=>false}),setDoc=async()=>{},serverTimestamp=()=>'';`});
   if(path==='api/attendance-reader'){
    const body=route.request().postDataJSON();bodies.push(body);
    return route.fulfill({json:{ok:true,classId:'1',attendance:[['이름','','','','9/21'],['가상학생','','','',body.allowCache?'출석':'지각']],reasons:[['','','','','9/21'],['','','','','']],attendanceBackgrounds:[[],['','','','','#ffffff']]}});
   }
   if(path==='')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="host"></div><script type="module">import {mountAttendanceOverview} from '/attendance-legacy.js';window.work=await mountAttendanceOverview(document.querySelector('#host'),{auth:{},db:{},user:{email:'staff@example.test',getIdToken:async()=>'fixture'},classes:[{id:'1'}]});</script>`});
   if(/\.(js|mjs)$/.test(path)&&existsSync(join(base,path)))return route.fulfill({contentType:'text/javascript',body:readFileSync(join(base,path),'utf8')});
   return route.abort();
  });
  await page.goto('https://fixture.test/');await page.getByText('가상학생',{exact:true}).waitFor();
  assert.equal(bodies[0].allowCache,true);
  await page.getByRole('button',{name:'↻ 다시 읽기'}).click();await page.locator('.student-row .status').filter({hasText:'지각'}).waitFor();
  assert.equal(bodies.length,2);assert.equal(bodies[1].allowCache,false);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.work.dispose());
 }finally{await browser.close();}
});
