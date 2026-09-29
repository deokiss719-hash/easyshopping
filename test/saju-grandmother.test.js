const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const {generate,selectors}=require('../src/saju/report-v6');
const previous=require('../src/saju/report-v5');
const {inspect}=require('../scripts/saju-grandmother-audit');
test('grandmother stories are conditional narratives, not questions or exercises; prior reports and facts stay fixed',()=>{
 const variants=[new Set(),new Set(),new Set(),new Set()];
 for(let i=1;i<=20;i++){
  const c=calculate({date:`1990-01-${String(i).padStart(2,'0')}`,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});
  const r=generate(c),audit=inspect(r);
  assert.equal(r.version,'ko-grandmother-story-6');
  assert.deepEqual(r,generate(c));
  assert.deepEqual(generate(c,'ko-story-5'),previous.generate(c));
  assert.deepEqual(r.evidence,previous.generate(c).evidence);
  assert.deepEqual(audit.forbidden,[]);
  assert.equal(audit.introJargon,0);
  assert.equal(audit.repeatPairs,0);
  assert.equal(audit.nearPairs,0,JSON.stringify(audit.near));
  assert.equal(c.pillars.hour,null);
  for(const section of r.sections)for(const b of section.blocks){
   assert.ok(b.parts.every(p=>!p.label));
   assert.doesNotMatch(b.text,/습니다|보세요|보거라|(?:100%|반드시).{0,15}(?:결혼|부자|성공)/);
   for(const e of r.evidence[b.id])assert.notEqual(e.value,undefined);
  }
  for(const b of r.sections[6].blocks)assert.equal(b.collapsed,true);
  if(selectors(c).personality)for(const i of [0,1,2,3,4])assert.equal(r.sections[i].blocks[0].parts.length,2);
  [0,2,3,4].forEach((n,j)=>variants[j].add(r.sections[n].blocks[0].text));
 }
 variants.forEach(v=>assert.ok(v.size>=6));
});
