const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {calculate}=require('../src/saju/calculator');
const {generate,selectors}=require('../src/saju/report-v4');
const old=require('../src/saju/report-v3');
const {metrics}=require('../scripts/saju-content-audit');
const {testPool}=require('./helpers/saju-db');
const {createStore}=require('../src/saju/store');
const {createSajuRouter}=require('../src/saju/routes');
const input=date=>({date,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});
test('modern reports: deterministic facts, distinct domains, no first-page jargon or chapter repetition',()=>{
 const distinct=[new Set(),new Set(),new Set()];
 for(let i=1;i<=15;i++){
  const chart=calculate(input(`1990-01-${String(i).padStart(2,'0')}`));
  const r=generate(chart),m=metrics(r);
  assert.deepEqual(r,generate(chart));
  assert.deepEqual(generate(chart,'ko-depth-3'),old.generate(chart));
  assert.equal(r.sections.length,7);
  assert.equal(r.sections[5].blocks[0].timeline[2].items.length,5);
  assert.equal(r.sections[5].blocks[0].timeline[0].items.length,chart.luck[0].cycles.length);
  assert.equal(m.openingTerms,0);
  assert.equal(m.repeatPairs,0,JSON.stringify(m.repeated));
  assert.equal(m.nearPairs,0,JSON.stringify(m.near));
  assert.doesNotMatch(JSON.stringify(r),/란다|보거라|보자꾸나/);
  for(const section of r.sections)for(const b of section.blocks){
   assert.ok(r.evidence[b.id].length);
   for(const e of r.evidence[b.id])assert.deepEqual(e.value,e.path.split('.').reduce((v,k)=>v?.[k],chart));
  }
  for(const j of [1,2,3,4])if(selectors(chart).personality) assert.equal(r.sections[j].blocks[0].parts.length,5);
  [0,2,4].forEach((n,j)=>distinct[j].add(r.sections[n].blocks[0].text));
  assert.equal(chart.pillars.hour,null);
  for(const section of r.sections.slice(0,5))for(const b of section.blocks)assert.ok(!r.evidence[b.id].some(e=>e.path==='pillars.hour'));
 }
 for(const set of distinct)assert.ok(set.size>=6,`only ${set.size} unique results`);
});
test('unconfirmed month does not invent personal, work or money conclusions',()=>{
 const c=calculate(input('1990-01-05'));
 assert.equal(c.pillars.month,null);
 const r=generate(c);
 assert.match(r.sections[0].blocks[0].text,/근거가 부족/);
 assert.match(r.sections[3].blocks[0].text,/결론내리지/);
 assert.equal(metrics(r).repeatPairs,0);
});
test('full beta requires owner access, creates no order, and keeps legacy reports/orders intact',async t=>{
 const pool=await testPool(),secret='beta-fixture-secret-'.repeat(4),store=await createStore(pool,secret);
 const app=express();app.use(express.json());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 app.use(createSajuRouter({store,env:{SAJU_PUBLIC_ORIGIN:base}}).router);
 t.after(async()=>{await new Promise(r=>server.close(r));await pool.end();});
 let cookie='';
 async function req(path,body){const r=await fetch(base+'/api/saju'+path,{method:body?'POST':'GET',headers:{Origin:base,'X-Saju-Request':'1','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};}
 const cfg=await req('/config');assert.equal(cfg.data.accessMode,'beta');assert.equal(cfg.data.canPay,false);assert.equal(cfg.data.price,null);
 const created=await req('/reports',{...input('1990-01-01'),consent:true});assert.equal(created.status,201);
 const id=created.data.id;
 const view=await req('/reports/'+id);assert.equal(view.data.fullAccess,true);assert.equal(view.data.paid,false);assert.equal(view.data.report.sections.length,7);assert.equal(view.data.order,undefined);
 assert.equal((await req('/reports/'+id+'/orders',{terms:true,recoverySaved:true})).status,409);
 assert.equal((await store.one('SELECT COUNT(*)::int AS count FROM saju_orders')).count,0);
 const owner=cookie;cookie='';assert.equal((await req('/reports/'+id)).status,404);cookie=owner;
 // Persist a legacy snapshot and order, then repeat schema initialization.
 const chart=calculate(input('1988-08-15'));const legacyReport=old.generate(chart);
 const legacy=await store.create({chart,report:legacyReport},cookie.split('=')[1]);
 const row=await store.one('SELECT * FROM saju_reports WHERE id=$1',[legacy.id]);
 const order=await store.order(row,6900,'demo');
 await pool.query("DELETE FROM saju_content_migrations WHERE version IN ('ko-pattern-4','ko-story-5')");
 await pool.query("UPDATE saju_settings SET report_version='ko-depth-3' WHERE id=1");
 await createStore(pool,secret);
 assert.equal((await store.settings()).report_version,'ko-story-5');
 assert.deepEqual((await req('/reports/'+legacy.id)).data.report,legacyReport);
 assert.equal((await store.one('SELECT payload FROM saju_reports WHERE id=$1',[legacy.id])).payload,row.payload);
 assert.equal((await store.one('SELECT amount FROM saju_orders WHERE id=$1',[order.id])).amount,6900);
 assert.equal((await req('/orders/'+order.id+'/confirm',{amount:6900})).status,409);
 cookie='';const recovered=await req('/recover',{code:created.data.recovery});assert.equal(recovered.data.id,id);
 assert.deepEqual((await req('/reports/'+id)).data.report,view.data.report);
});
