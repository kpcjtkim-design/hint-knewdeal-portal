import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
// tools/build-timetable-seed.py(2기): 반 열 찾기·두 판 칸별 절충·충돌 CSV·주말 칸 거부. 엑셀은 openpyxl로 작게 만들어 씁니다(python -I).
const root=join(import.meta.dirname,'../..'),builder=join(root,'tools/build-timetable-seed.py');
const py=(args,opts={})=>spawnSync('python',['-I',...args],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},...opts});
// 1014판 모양(16묶음)·1007판 모양(대구상공회의소 포함 17묶음, 다른 순서). cells: {반: {날짜: [과목, 시간, 강사]}}
const MAKER=String.raw`
import sys, json, datetime, openpyxl
from openpyxl.utils import column_index_from_string as I
spec = json.load(open(sys.argv[1], encoding='utf-8'))
for book in spec:
    wb = openpyxl.Workbook(); ws = wb.active; ws['A2'] = '교육장소'; ws.cell(book['head'], 1, '날짜')
    for g in book['groups']:
        c = I(g['col']); ws.cell(2, c, g['place']); ws.cell(4, c, g['track'])
        for i, t in enumerate(('과정명', '시간', '강사명')): ws.cell(book['head'] + 2, c + i, t)
    for r, d in enumerate(book['dates'], book['head'] + 3):
        ws.cell(r, 1, datetime.datetime.fromisoformat(d))
        for g in book['groups']:
            for i, v in enumerate(g.get('cells', {}).get(d, [])): ws.cell(r, I(g['col']) + i, v)
    wb.save(book['path'])
`;
const NEW=[['C','서울대학교 ','모빌리티 AI'],['F','한양대학교','제조지능화'],['I','후인원 1','모비리티 AI'],['L','후인원 2','제조지능화 1'],['O','청주','제조지능화 2'],['R','마이크로웨이브 1','모비리티 AI'],['U','대구 생산성본부','모비리티 AI'],['X','마이크로웨이브 2','제조지능화 2'],['AA','아르피나 1','모비리티 AI'],['AD','부산대','모비리티 AI'],['AG','아르피나2','제조지능화 1'],['AJ','아르피나 3','제조지능화 2'],['AM',' 울산공장','제조지능화 3'],['AP','전남대학','모빌리티 AI'],['AS','광주공장 1','제조지능화 1'],['AV','광주공장2','제조지능화 2']];
const OLD=[['C','서울대학교 현대 · 기아 차세대자동차 연구관','모빌리티 AI'],['F','한양대학교 정몽구 미래자동차연구센터','제조지능화'],['I','대전 유성구 온천로 20,동국제강 연수원 후인원 4F','모비리티 AI'],['L','대전 유성구 온천로 20,동국제강 연수원 후인원 4F','제조지능화 1'],['O','충북 청주시 흥덕구 가로수로 1251,충북대 G-테크벤처센터 3F','제조지능화 2'],['R','대구 중구 태평로 160,마이크로웨이브 대구본점 7F','모비리티 AI'],['U','대구 동구 동대구로 489,대구무역회관 17F','모비리티 AI'],['X','대구 동구 동대구로 457,대구상공회의소 4F','제조지능화 1'],['AA','대구 중구 태평로 160,마이크로웨이브 대구본점 7F','제조지능화 2'],['AD','부산 해운대구 해운대해변로 35,아르피나(부산도시공사) 8F','모비리티 AI'],['AG','부산 금정구 부산대학로63번길 2,NC백화점 부산대점 7F','모비리티 AI'],['AJ','부산 해운대구 해운대해변로 35,아르피나(부산도시공사) 1~2F','제조지능화 1'],['AM','부산 해운대구 해운대해변로 35,아르피나(부산도시공사) 1~2F','제조지능화 2'],['AP','울산 북구 염포로 700,현대자동차 울산공장','제조지능화 3'],['AS','광주 북구 용봉로 77,전남대학교 진리관','모빌리티 AI'],['AV','광주 서구 화운로 277,기아오토랜드 광주공장','제조지능화 1'],['AY','광주 서구 화운로 277,기아오토랜드 광주공장','제조지능화 2']];
const D='2026-10-28',SAT='2026-10-31';
function build(dir,{weekend=false}={}){
 const groups=(list,cells)=>list.map(([col,place,track])=>({col,place,track,cells:cells[col]||{}}));
 // 새 판: C(1반) 입교식·강사, F(2반) 과목 빈칸, I(3반) 과목·강사 다름, L(4반) 둘 다 빈칸, 나머지 디지털스킬. 옛 판은 반 순서가 다르고 X열(대구상공회의소)이 있음.
 const nc={C:{[D]:['입교식',4,'김담임']},F:{[D]:[null,8]},I:{[D]:['MCU 프로그래밍',8,'이강사']},L:{[D]:[null,8]}};
 for(const [col] of NEW)nc[col]??={[D]:['디지털스킬',8]};if(weekend)nc.O[SAT]=['디지털스킬',8];
 const oc={C:{[D]:['입교식-프로그램',4]},F:{[D]:['C프로그래밍',8,'박강사']},I:{[D]:['자동차 통신시스템',8,'최강사']},L:{[D]:[null,8]},X:{[D]:['뺀 반 과목',8]}};
 const spec=[{path:join(dir,'new.xlsx'),head:6,dates:[D,'2026-10-30',SAT],groups:groups(NEW,nc)},{path:join(dir,'old.xlsx'),head:30,dates:[D],groups:groups(OLD,oc)}];
 writeFileSync(join(dir,'spec.json'),JSON.stringify(spec));writeFileSync(join(dir,'maker.py'),MAKER);
 const made=py([join(dir,'maker.py'),join(dir,'spec.json')]);assert.equal(made.status,0,made.stderr);
 return py([builder,'--sheet','new',join(dir,'new.xlsx'),'새 판.xlsx','--sheet','old',join(dir,'old.xlsx'),'옛 판.xlsx','--version','20990101','--conflicts',join(dir,'c.csv'),'--out',join(dir,'out')]);
}
test('builder maps class columns by place and track, merges two workbooks cell by cell and writes conflicts with a BOM',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tt2-')),r=build(dir);assert.equal(r.status,0,r.stderr+r.stdout);
 assert.match(r.stdout,/\[new\] 반 열: 1 C · 2 F · 3 I · 4 L · 5 O · 6 U · 7 R · 8 X · 9 AD · 10 AA · 11 AG · 12 AJ · 13 AM · 14 AP · 15 AS · 16 AV/);
 assert.match(r.stdout,/\[old\] 반 열: 1 C · 2 F · 3 I · 4 L · 5 O · 6 U · 7 R · 8 AA · 9 AG · 10 AD · 11 AJ · 12 AM · 13 AP · 14 AS · 15 AV · 16 AY · 뺀 열 X\(/);
 const seed=JSON.parse(readFileSync(join(dir,'out/timetable-seed.json'),'utf8')),day=cid=>seed.classes[cid].entries.find(e=>e.date===D);
 assert.deepEqual([day('1').title,day('1').event,day('1').instructorName,day('1').origin],['입교식','입교식','김담임',{subject:'both',hours:'both',instructor:'new'}]);
 assert.deepEqual([day('2').title,day('2').instructorName,day('2').origin.subject],['C 프로그래밍','박강사','old'],'빈 과목 칸은 다른 판 값');
 assert.deepEqual([day('3').title,day('3').instructorName,day('3').review],['MCU 프로그래밍','이강사',['subject','instructor']],'다르면 첫 판 값 + review');
 assert.deepEqual([day('4').title,day('4').origin.subject],['직무특화 (세부 과목 미정)',''],'둘 다 비면 지어내지 않음');
 assert(!JSON.stringify(seed).includes('뺀 반 과목'),'대구상공회의소 열은 읽지 않음');
 const csv=readFileSync(join(dir,'c.csv'));assert.deepEqual([...csv.subarray(0,3)],[0xef,0xbb,0xbf]);
 assert.deepEqual(csv.toString('utf8').slice(1).trim().split(/\r?\n/),['날짜,반,항목,new판 값,old판 값,선택(기본: 첫 판)','2026-10-28,3,강사,이강사,최강사,이강사','2026-10-28,3,과목,MCU 프로그래밍,자동차 통신 시스템,MCU 프로그래밍']);
 assert.equal(JSON.parse(readFileSync(join(dir,'out/timetable-reference.json'),'utf8')).facilities.length,16);
});
test('builder refuses lessons on weekends instead of guessing',()=>{
 const r=build(mkdtempSync(join(tmpdir(),'tt2-')),{weekend:true});assert.notEqual(r.status,0);assert.match(r.stderr,/주말·휴일·기간 밖[\s\S]*\[new\] 5반 2026-10-31: 디지털스킬/);
});
// 실제 일정표(내려받은 엑셀, 저장소 밖)가 있으면 지금 시드가 그대로 다시 만들어지는지 봅니다. TT2_SHEET_1014·TT2_SHEET_1007에 경로를 넣어 실행.
test('committed seed and reference rebuild byte-for-byte from the 261014 + 261007 workbooks',{skip:!(process.env.TT2_SHEET_1014&&existsSync(process.env.TT2_SHEET_1014)&&process.env.TT2_SHEET_1007)&&'TT2_SHEET_1014·TT2_SHEET_1007 없음'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'tt2-real-')),r=py([builder,'--sheet','1014',process.env.TT2_SHEET_1014,'261014_K-뉴딜_아카데미_2기 일정표_직무기초.xlsx','--sheet','1007',process.env.TT2_SHEET_1007,'261007_K-뉴딜_아카데미_2기 일정표.xlsx','--version','20261014','--conflicts',join(dir,'c.csv'),'--out',dir]);
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/15반 과목 칸 2026-12-02부터 1줄 당김 · 바뀐 칸 29개/);assert.match(r.stdout,/16반 · 60\/60일 · 464시간/);
 for(const f of ['timetable-seed.json','timetable-reference.json'])assert.equal(readFileSync(join(dir,f),'utf8'),readFileSync(join(root,f),'utf8'),f);
 assert.equal(readFileSync(join(dir,'c.csv'),'utf8').trim().split(/\r?\n/).length,1,'두 판 충돌 0건(머리글만)');
});
