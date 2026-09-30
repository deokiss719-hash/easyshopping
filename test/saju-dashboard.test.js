const {test}=require('node:test');
const assert=require('node:assert/strict');
const {testPool}=require('./helpers/saju-db');
const {createStore,token}=require('../src/saju/store');
test('dashboard counts real approvals by Korean day, separates refunds, and retains old unresolved orders',async t=>{
 const pool=await testPool();t.after(()=>pool.end());const store=await createStore(pool,'a'.repeat(64));
 const empty=await store.dashboard();assert.equal(empty.summary.today_paid_count,0);assert.equal(Number(empty.summary.today_paid_amount),0);
 const r=await store.create({chart:{},report:{}},token());
 async function insert(id,mode,status,amount,paid,refund=null,age=0){
 await pool.query(`INSERT INTO saju_orders(id,report_id,mode,status,amount,paid_at,refunded_at,created_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6::int IS NULL THEN NULL ELSE ((NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '1 hour' - make_interval(days=>$6)) AT TIME ZONE 'Asia/Seoul' END,CASE WHEN $7::int IS NULL THEN NULL ELSE ((NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '1 hour' - make_interval(days=>$7)) AT TIME ZONE 'Asia/Seoul' END,NOW()-make_interval(days=>$8))`,[id,r.id,mode,status,amount,paid,refund,age]);
 }
 await insert('real','live','refunded',5900,0,0);
 await insert('yesterday','live','refunded',4900,1,0);
 await insert('edge','live','refunded',6900,29,29);
 await insert('outside','live','refunded',9900,30,30);
 await insert('demo','demo','refunded',99999,0,0);
 await insert('test','test','refunded',99999,0,0);
 await insert('old-attention','live','refunding',5900,40,null,40);
 for(let i=0;i<205;i++)await insert('failed'+i,'live','failed',5900,null);
 const x=await store.dashboard();
 assert.equal(x.summary.today_paid_count,1);assert.equal(Number(x.summary.today_paid_amount),5900);
 assert.equal(Number(x.summary.today_refund_amount),10800);
 assert.equal(x.summary.month_paid_count,3);assert.equal(Number(x.summary.month_paid_amount),17700);
 assert.equal(Number(x.summary.month_refund_amount),17700);assert.equal(x.summary.attention_count,1);
 assert.ok(x.orders.some(o=>o.id==='old-attention'));assert.equal(x.orders.length,201);
});
