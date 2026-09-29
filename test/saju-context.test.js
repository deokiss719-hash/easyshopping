'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const current=require('../src/saju/report');
const prior=require('../src/saju/report-v8');
const make=(date,time)=>calculate({date,calendar:'solar',zone:'Asia/Seoul',timeType:time?'exact':'unknown',...(time?{time}:{})});
test('v8 remains byte-equivalent through version delegation',()=>{
 for(const [date,time] of [['1990-01-09',null],['1988-08-15','04:00'],['2000-04-17','08:00']]){
  const c=make(date,time);assert.deepEqual(current.generate(c,prior.VERSION),prior.generate(c));
 }
});
test('unknown support does not become a no-roots resilience conclusion',()=>{
 const r=current.generate(make('1990-01-09',null));assert.equal(r.analysis.support.status,'uncertain');
 const b=r.sections.find(x=>x.id==='strength').blocks[0];
 assert.ok(b.ruleIds.includes('strength-hour-open'));assert.ok(!b.ruleIds.includes('strength-no-roots'));
 assert.match(b.text,/정보가 모자라/);
});
test('combined earning and sharing patterns both reach money narrative',()=>{
 let count=0;
 for(let month=1;month<=12;month++){
  const r=current.generate(make(`1990-${String(month).padStart(2,'0')}-09`,'12:00'));
  const ids=r.analysis.patterns.map(x=>x.id);
  if(ids.includes('making-to-money')&&ids.includes('sharing-money')){
   count++;assert.ok(r.sections.find(x=>x.id==='money').blocks[0].ruleIds.includes('money-shared-margin'));
  }
 }
 assert.ok(count>0);
});
test('relationship context uses known month and day evidence and no structural absence filler',()=>{
 const r=current.generate(make('1988-08-15',null)),b=r.sections.find(x=>x.id==='love').blocks[0];
 assert.ok(b.ruleIds.some(x=>x.startsWith('love-outside-')));
 assert.ok(!b.ruleIds.includes('love-no-direct'));
 for(const t of r.traces.love.filter(x=>x.rule.startsWith('love-outside-'))){
  assert.ok(t.paths.includes('pillars.day.hiddenStems.0'));assert.ok(t.paths.some(x=>x.startsWith('pillars.month')));
  assert.ok(!t.paths.some(x=>x.startsWith('pillars.hour')));
 }
 const boundary=current.generate(make('1990-01-05',null));
 assert.ok(!boundary.sections.find(x=>x.id==='love').blocks[0].ruleIds.some(x=>x.startsWith('love-outside-')));
});
