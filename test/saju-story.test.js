const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const {generate}=require('../src/saju/report');
const previous=require('../src/saju/report-v4');
test('story reading preserves facts and snapshots while joining labelled answers into prose',()=>{
 for(let i=1;i<=12;i++){
  const chart=calculate({date:`1990-01-${String(i).padStart(2,'0')}`,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});
  const old=previous.generate(chart),r=generate(chart);
  assert.equal(r.version,'ko-story-5');
  assert.deepEqual(generate(chart,'ko-pattern-4'),old);
  assert.deepEqual(r.evidence,old.evidence);
  assert.deepEqual(r,generate(chart));
  for(const section of r.sections.slice(0,6))for(const block of section.blocks){
   assert.ok(block.parts.every(p=>!p.label));
   assert.doesNotMatch(block.title,/\?|인가|나요|할까|볼까요/);
   if(block.parts.length===2)assert.ok(block.parts[0].text.length>50);
  }
  assert.equal(chart.pillars.hour,null);
 }
});
