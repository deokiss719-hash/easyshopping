const {test} = require('node:test');
const assert = require('node:assert/strict');
const {calculate} = require('../src/saju/calculator');
const {generate,profile} = require('../src/saju/report-v3');
const old = require('../src/saju/report-v2');
const input = date => ({date,calendar:'solar',timeType:'exact',time:'12:00',zone:'Asia/Seoul'});
test('depth report keeps earlier purchased text reproducible and every inference traceable',()=>{
  for(let i=1;i<=10;i++) {
    const chart = calculate(input(`1990-01-${String(i).padStart(2,'0')}`));
    assert.deepEqual(generate(chart,'ko-grandmother-2'),old.generate(chart));
    const r=generate(chart);
    assert.equal(r.version,'ko-depth-3');
    assert.deepEqual(r,generate(chart));
    for(const section of r.sections) for(const block of section.blocks) {
      assert.ok(r.evidence[block.id].length,block.id);
      for(const fact of r.evidence[block.id]) {
        assert.notEqual(fact.value,undefined,fact.path);
        assert.deepEqual(fact.value,fact.path.split('.').reduce((v,k)=>v?.[k],chart));
      }
    }
    assert.equal(r.sections[5].blocks.filter(b=>b.id.includes('-cycle-')).length,16);
    assert.equal(r.sections[5].blocks.filter(b=>b.id.startsWith('year-')).length,5);
    assert.equal(r.sample.text,r.sections[4].blocks[0].text);
    assert.doesNotMatch(JSON.stringify(r),/ko-grandmother-2/);
  }
});
test('same day pillar with a different month changes connected interpretations',()=>{
  const a=calculate(input('1990-01-01')), b=calculate(input('1990-03-02'));
  assert.equal(a.pillars.day.chars,b.pillars.day.chars);
  assert.notEqual(a.pillars.month.chars,b.pillars.month.chars);
  assert.notEqual(generate(a).preview[1].text,generate(b).preview[1].text);
  assert.notEqual(generate(a).sections[4].blocks[0].text,generate(b).sections[4].blocks[0].text);
});
test('missing hour/month never contributes a phantom role or forecast',()=>{
  const chart=calculate({...input('1990-01-01'),timeType:'unknown'});
  assert.equal(chart.pillars.hour,null);
  assert.equal(profile(chart).visible.some(([key])=>key==='hour'),false);
  assert.equal(profile(chart).roots.includes('hour'),false);
  const r=generate(chart);
  assert.match(r.sections[0].blocks.find(b=>b.id==='pillar-hour').text,/확정할 수 없어/);
  // Model a validated uncertain-month chart, retaining only known facts.
  const uncertain=structuredClone(chart);
  uncertain.pillars.month=null;
  uncertain.luck.forEach(l=>l.cycles=[]);
  const u=generate(uncertain);
  assert.match(u.sections[1].blocks.find(b=>b.id==='season').text,/월지가 확정되지 않아/);
  assert.equal(u.sections[5].blocks.filter(b=>b.id.includes('-cycle-')).length,0);
  assert.match(u.sections[4].blocks[0].text,/월주가 확정되지 않아/);
});
