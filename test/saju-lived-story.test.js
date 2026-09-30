'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const {generate}=require('../src/saju/report');
const v9=require('../src/saju/report-v9');
const make=date=>calculate({date,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});
test('v10 preserves v9 snapshots and calculation values and produces traced distinct stories',()=>{
 const examples=new Map();
 for(let m=1;m<=12;m++){
  const c=make(`1990-${String(m).padStart(2,'0')}-09`),original=JSON.stringify(c),r=generate(c);
  assert.deepEqual(generate(c,v9.VERSION),v9.generate(c));
  assert.equal(JSON.stringify(c),original);assert.deepEqual(generate(c),r);
  if(r.analysis.focus?.god)examples.set(r.analysis.focus.god,r);
 }
 assert.ok(examples.size>=5);
 const openings=new Set();
 for(const r of examples.values()){
  assert.deepEqual(r.sections.map(s=>s.id),['summary','money','work','love','strength','flow','basis']);
  openings.add(r.sections[0].blocks[0].parts[0].text);
  const sentences=new Set();
  for(const section of r.sections.filter(s=>!['flow','basis'].includes(s.id))){
   for(const block of section.blocks){
    assert.doesNotMatch(block.text,/[?？]|보거라|떠올려|확인해|임수|편재|편관|식신|겁재/);
    for(const sentence of block.text.split(/(?<=[.!?])\s+/u).filter(s=>s.length>30)){
     assert.ok(!sentences.has(sentence),'repeated sentence: '+sentence);sentences.add(sentence);
    }
    assert.equal(block.parts.length,r.traces[block.id].length);
    for(const t of r.traces[block.id])assert.ok(!t.paths.some(p=>p.startsWith('pillars.hour')));
   }
  }
 }
 assert.equal(openings.size,examples.size);
});
