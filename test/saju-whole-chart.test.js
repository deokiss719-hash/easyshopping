const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate,pillar}=require('../src/saju/calculator');
const {analyze,comparePeriod,connections}=require('../src/saju/whole-chart');
const {generate}=require('../src/saju/report');
const old=require('../src/saju/report-v7');
const {DateTime}=require('luxon');
const {Solar}=require('lunar-javascript');
const make=(date='1990-01-09',time='12:00')=>calculate({date,calendar:'solar',zone:'Asia/Seoul',timeType:time?'exact':'unknown',...(time?{time}:{})});
const fake=(chars)=>{const day=chars[2][0];return {pillars:Object.fromEntries(['year','month','day','hour'].map((k,i)=>[k,chars[i]?pillar(chars[i],day):null]))};};
test('month hidden stems and exposures, roots and full pairs are facts not automatic transformations',()=>{
 const c=fake(['甲子','丙寅','甲午','己未']),a=analyze(c);
 assert.equal(a.focus.god,'비견'); // exposed main month qi wins over secondary exposure
 assert.equal(a.focus.path,'pillars.month.hiddenStems.0');
 assert.ok(a.roots.mainPositions.includes('month'));
 assert.ok(a.relations.some(x=>x.kind==='clash'&&x.chars==='子午'));
 assert.ok(a.relations.some(x=>x.kind==='union'&&x.chars==='午未'));
 assert.ok(a.relations.some(x=>x.kind==='stemUnion'&&x.chars==='甲己'));
 assert.equal(a.tripleCandidates.length,0); // 寅午 without 戌 is not a full fire triple
 const t=analyze(fake(['甲寅','丙午','甲戌',null]));
 assert.equal(t.tripleCandidates[0].element,'화');assert.equal(t.tripleCandidates[0].transformed,false);
 assert.equal(a.climate.yongshin,null);assert.equal(a.support.definitiveStrength,false);
});
test('ambiguous hour never appears as a real pillar and uncertain support is downgraded',()=>{
 const c=make('1990-01-09',null),a=analyze(c);
 assert.equal(a.certainty.hourUsed,false);assert.ok(a.sensitivity.hourAlternatives>=12);
 assert.equal(a.sensitivity.supportMayChange,true);assert.equal(a.support.status,'uncertain');
 assert.ok(a.hidden.every(h=>h.position!=='hour'));
 const r=generate(c);assert.match(r.sections[0].blocks[0].text,/태어난 시각/);
 for(const rows of Object.values(r.evidence))assert.ok(rows.every(e=>!e.path.startsWith('pillars.hour')));
});
test('a missing month cannot be replaced by an invented focus or luck cycles',()=>{
 const c=make('1990-01-05',null),a=analyze(c),r=generate(c);
 assert.equal(a.focus,null);assert.equal(a.support.status,'unknown');
 assert.match(r.sections[0].blocks[0].text,/한쪽으로 정하지/);
 assert.ok(!Object.keys(r.analysis).some(k=>k.startsWith('age-')));
});
test('period relations compare both stem and branch to natal pillars',()=>{
 const c=fake(['甲子','丙寅','甲午','己未']);
 const clash=comparePeriod(c,pillar('庚子','甲'),'annual.0.pillar');
 const quiet=comparePeriod(c,pillar('庚辰','甲'),'annual.0.pillar');
 assert.equal(clash.stemGod,quiet.stemGod);assert.notDeepEqual(clash.relations,quiet.relations);
 assert.ok(clash.relations.some(r=>r.kind==='clash'&&r.positions.includes('day')));
});
test('same old selector, different whole charts produce different contextual readings',()=>{
 const a=make('1990-01-09','02:00'),b=make('1990-01-09','12:00');
 assert.equal(old.selectors(a).personality,old.selectors(b).personality);
 assert.notDeepEqual(generate(a).analysis,generate(b).analysis);
 assert.notEqual(generate(a).sections[0].blocks[0].text,generate(b).sections[0].blocks[0].text);
});
test('reports preserve saved versions and every new paragraph has resolvable provenance',()=>{
 for(const [date,time] of [['1990-01-09','12:00'],['1988-08-15','04:00'],['1975-11-21','19:30'],['2000-04-17','08:00'],['1996-07-12','16:00'],['1990-01-05',null]]){
  const c=make(date,time),r=generate(c);
  assert.deepEqual(generate(c),r);assert.deepEqual(generate(c,old.VERSION),old.generate(c));
  assert.equal(r.version,'ko-context-story-9');
  for(const s of r.sections)for(const b of s.blocks){
   assert.equal(b.parts.length,r.traces[b.id].length);
   for(const trace of r.traces[b.id])for(const path of trace.paths)assert.notEqual(path.split('.').reduce((v,k)=>v?.[k],c),undefined,path);
   for(const e of r.evidence[b.id])assert.deepEqual(e.value,e.path.split('.').reduce((v,k)=>v?.[k],c));
   if(s.id!=='basis')assert.doesNotMatch(b.text,/[?？]|보거라|확인해|떠올려|순행|역행|입춘|정관|편재|지장간|통근|월령|반드시.{0,10}(?:결혼|부자|사고)/);
  }
  const flow=r.sections.find(s=>s.id==='flow').blocks.flatMap(b=>b.parts.map(p=>p.text));
  assert.equal(new Set(flow).size,flow.length,'timing paragraphs must not repeat');
 }
});
test('2026 term calculations match KASI published calendar data within one minute, at all 12 month boundaries',()=>{
 // KASI 2026 calendarData V1.0a (preliminary table, not claimed to be final gazette).
 const fixtures=[['小寒','01-05T17:23'],['立春','02-04T05:02'],['惊蛰','03-05T22:59'],['清明','04-05T03:40'],['立夏','05-05T20:49'],['芒种','06-06T00:48'],['小暑','07-07T10:57'],['立秋','08-07T20:43'],['白露','09-07T23:41'],['寒露','10-08T15:29'],['立冬','11-07T18:52'],['大雪','12-07T11:53']];
 const table=Solar.fromYmd(2026,6,1).getLunar().getJieQiTable();
 for(const [name,date] of fixtures){
  const actual=DateTime.fromFormat(table[name].toYmdHms(),'yyyy-MM-dd HH:mm:ss',{zone:'UTC+8'});
  const expected=DateTime.fromISO('2026-'+date,{zone:'Asia/Seoul'});
  assert.ok(Math.abs(actual.toMillis()-expected.toMillis())<60000,name);
 }
});
test('KASI 2026 lunar month starts and day pillars are independent fixtures',()=>{
 const fixtures=[['2026-02-17','壬戌'],['2026-03-19','壬辰'],['2026-04-17','辛酉'],['2026-05-17','辛卯'],['2026-06-15','庚申'],['2026-07-14','己丑'],['2026-08-13','己未'],['2026-09-11','戊子'],['2026-10-11','戊午'],['2026-11-09','丁亥'],['2026-12-09','丁巳'],['2027-01-08','丁亥']];
 for(const [index,[date,day]] of fixtures.entries()){
  const c=calculate({date:`2026-${String(index+1).padStart(2,'0')}-01`,calendar:'lunar',leap:false,zone:'Asia/Seoul',timeType:'exact',time:'12:00'},DateTime.fromISO('2045-01-01'));
  assert.equal(c.solarDate,date);assert.equal(c.pillars.day.chars,day);
 }
});
