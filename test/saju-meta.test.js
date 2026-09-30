const {test}=require('node:test');const assert=require('node:assert/strict');
const {testPool}=require('./helpers/saju-db');const {createStore,token}=require('../src/saju/store');
const {createPayments}=require('../src/saju/payments');const meta=require('../src/saju/meta-conversions');
test('consented live purchases enqueue exactly once with verified amount and no birth data',async t=>{
 const pool=await testPool();t.after(()=>pool.end());const store=await createStore(pool,'s'.repeat(64));
 const owner=token(),created=await store.create({chart:{date:'1990-01-01',name:'secret'},report:{text:'private'}},owner);
 const report=await store.authorized(created.id,owner),o=await store.order(report,5900,'live');
 const context=meta.context({consent:true,anonymousId:'anonymous-random-session-123',date:'1990-01-01',name:'secret'},'test-browser');
 await pool.query('UPDATE saju_orders SET meta_context=$2 WHERE id=$1',[o.id,JSON.stringify(context)]);
 let status='IN_PROGRESS';const provider={lookup:async()=>({paymentKey:'payment-test',orderId:o.id,totalAmount:5900,balanceAmount:5900,currency:'KRW',status}),confirm:async()=>({})};
 const payments=createPayments(store,{mode:'live'},provider);
 await payments.confirm(o.id,'payment-test',5900);assert.equal((await pool.query('SELECT * FROM saju_meta_outbox')).rows.length,0);
 status='DONE';await payments.confirm(o.id,'payment-test',5900);await payments.confirm(o.id,'payment-test',5900);
 const rows=(await pool.query('SELECT * FROM saju_meta_outbox')).rows;assert.equal(rows.length,1);
 const data=typeof rows[0].payload==='string'?JSON.parse(rows[0].payload):rows[0].payload;
 assert.equal(data.custom_data.value,5900);assert.equal(data.custom_data.currency,'KRW');assert.equal(data.event_id,'saju-purchase-'+o.id);
 assert.doesNotMatch(JSON.stringify(data),/1990|secret|private|payment-test/);
 let request;const cfg={enabled:true,pixelId:'123456',accessToken:'test-token',version:'v23.0'};
 await meta.drain(pool,cfg,async(url,opts)=>{request=JSON.parse(opts.body);return{ok:true,json:async()=>({events_received:1})}});
 assert.equal(request.data[0].event_id,data.event_id);
 assert.equal((await pool.query('SELECT payload FROM saju_meta_outbox')).rows[0].payload,null);
 let calls=0;await meta.drain(pool,cfg,async()=>{calls++});assert.equal(calls,0);
});
test('no consent, demo payment, or missing configuration cannot send a Purchase',async()=>{
 assert.equal(meta.context({consent:false,anonymousId:'anonymous-random-session-123'},'ua'),null);
 let writes=0;await meta.enqueue({query:async()=>writes++},{mode:'demo',meta_context:{},amount:5900});assert.equal(writes,0);
 assert.deepEqual(await meta.drain({},meta.metaConfig({})),{disabled:true});
});
