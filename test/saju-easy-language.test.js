'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const current=require('../src/saju/report');
const old=require('../src/saju/report-v10');
test('easy stories preserve v10, charts and evidence while shortening prose',()=>{
 let before=[],after=[];
 for(const date of ['1988-08-15','1990-01-09','1995-06-20','2000-12-15','1980-03-08']){
 const chart=calculate({date,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});
 const saved=JSON.stringify(chart),a=old.generate(chart),b=current.generate(chart);
 assert.deepEqual(current.generate(chart,old.VERSION),a);
 assert.equal(JSON.stringify(chart),saved);
 assert.deepEqual(a.traces,b.traces);
 assert.deepEqual(current.generate(chart),b);
 for(const [r,list] of [[a,before],[b,after]])for(const s of r.sections.filter(s=>s.id!=='basis'))for(const block of s.blocks)list.push(...block.text.split(/(?<=[.!?])\s+/u));
 assert.doesNotMatch(b.sections.filter(s=>s.id!=='basis').map(s=>s.blocks.map(b=>b.text).join(' ')).join(' '),/결정권|정산|자율성|[?？]/);
 }
 const avg=xs=>xs.reduce((n,s)=>n+s.length,0)/xs.length;
 assert.ok(avg(after)<avg(before));
});
