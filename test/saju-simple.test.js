const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const current=require('../src/saju/report');
const previous=require('../src/saju/report-v6');
const {inspect}=require('../scripts/saju-grandmother-audit');
test('simple stories keep facts and saved v6, omit subtitles and formal vocabulary across charts',()=>{
 const variants=[new Set(),new Set(),new Set(),new Set()];
 for(let d=1;d<=20;d++){
  const c=calculate({date:`1990-01-${String(d).padStart(2,'0')}`,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});
  const r=current.generate(c),old=previous.generate(c);
  assert.equal(r.version,'ko-simple-story-7');
  assert.deepEqual(current.generate(c,'ko-grandmother-story-6'),old);
  assert.deepEqual(current.generate(c),r);
  assert.deepEqual(r.evidence,old.evidence);
  assert.equal(c.pillars.hour,null);
  for(const s of r.sections.slice(0,6)) for(const b of s.blocks){
   assert.equal(b.hideHeading,true);
   assert.doesNotMatch(b.text,/[?？]|보거라|확인해|떠올려|자율성|성과|기여|역량|수익|수요|조율|자원|권한|통찰|체계|사양|관성|접점|회수|경금|정관|편재/);
  }
  const check=inspect(r);assert.deepEqual(check.forbidden,[]);assert.equal(check.repeatPairs,0);
  [0,2,3,4].forEach((n,j)=>variants[j].add(r.sections[n].blocks[0].text));
 }
 variants.forEach(v=>assert.ok(v.size>=6));
});
