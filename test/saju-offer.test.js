const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../src/saju/calculator');
const {generate}=require('../src/saju/report');
const {freeOffer}=require('../src/saju/offer');
const {paymentRequest}=require('../public/saju/payment-options');
const {testPool}=require('./helpers/saju-db');
const {createStore,token}=require('../src/saju/store');
test('free projection shows useful complete sections but omits paid payload, analysis and traces',()=>{
 const c=calculate({date:'1988-08-15',calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'}),r=generate(c),original=JSON.stringify(r),f=freeOffer(r,c);
 assert.equal(f.preview.length,1);
 assert.equal(f.preview[0].parts.length,2);
 assert.deepEqual(f.preview[0].parts,r.sections[0].blocks[0].parts.slice(0,2).map(p=>({text:p.text})));
 assert.ok(f.preview[0].text.length < r.sections[0].blocks[0].text.length);
 assert.equal(f.sections,undefined);assert.equal(f.analysis,undefined);assert.equal(f.traces,undefined);
 assert.deepEqual(f.evidence,{});assert.equal(JSON.stringify(r),original);
 const privateWork=r.sections[3].blocks[0].parts.at(-1).text;
 assert.ok(!JSON.stringify(f).includes(privateWork));
 assert.equal(freeOffer(r,c,4).preview[0].parts.length,3);
});
test('card SDK request uses the approved hosted card window and no personal input',()=>{
 const o={id:'local_order_123',amount:4900,successUrl:'http://localhost/saju/success',failUrl:'http://localhost/saju/fail'};
 const r=paymentRequest(o,'CARD');assert.deepEqual(r.card,{flowMode:'DEFAULT'});
 assert.equal(r.amount.value,4900);assert.equal(r.windowTarget,'self');
 assert.equal(r.customerMobilePhone,undefined);assert.equal(r.customerName,undefined);
 assert.throws(()=>paymentRequest(o,'BANK'));
 assert.throws(()=>paymentRequest(o,'KAKAOPAY'));
 assert.throws(()=>paymentRequest({...o,amount:0},'CARD'));
});
test('beta entitlement stays with report while new paid reports stay locked after store restart',async t=>{
 const pool=await testPool();t.after(()=>pool.end());const secret='beta-preserve-test-'.repeat(4),store=await createStore(pool,secret),owner=token();
 const beta=await store.create({chart:{},report:{}},owner,{betaAccess:true});
 const paid=await store.create({chart:{},report:{}},owner);
 await createStore(pool,secret);
 assert.equal((await store.authorized(beta.id,owner)).beta_access,true);
 assert.equal((await store.authorized(paid.id,owner)).beta_access,false);
});
