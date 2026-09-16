const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { newDb, DataType } = require('pg-mem');
const { migrate, createDealStore } = require('../src/deal-store');
const { createDealClickStore, createDealClicksRouter } = require('../src/deal-clicks');
const { createTrafficAnalytics } = require('../src/traffic-analytics');
const { applyTossWebSnapshot, readTossWebSignals } = require('../src/toss-web-sync');

async function setup(t) {
 const db=newDb();db.public.registerFunction({name:'strpos',args:[DataType.text,DataType.text],returns:DataType.integer,implementation:(a,b)=>a.indexOf(b)+1});
 const {Pool}=db.adapters.createPg();const pool=new Pool();await migrate(pool);t.after(()=>pool.end());
 return {pool,store:createDealStore(pool),clicks:createDealClickStore(pool)};
}
test('repeated browser clicks count once, different visitors count, and popular sort uses recent clicks',async(t)=>{
 const {pool,store,clicks}=await setup(t);
 const a=await store.upsert({source:'toss',sourceItemId:'1',title:'A',originalUrl:'https://toss.im/_m/A'});
 const b=await store.upsert({source:'toss',sourceItemId:'2',title:'B',originalUrl:'https://toss.im/_m/B'});
 assert.equal(await clicks.record({dealId:a.id,visitorHash:'a'.repeat(64)}),true);
 assert.equal(await clicks.record({dealId:a.id,visitorHash:'a'.repeat(64)}),false);
 await clicks.record({dealId:a.id,visitorHash:'b'.repeat(64)});
 await clicks.record({dealId:b.id,visitorHash:'a'.repeat(64)});
 const result=await store.list({source:'toss',sort:'popular'});
 assert.deepEqual(result.items.map(x=>[x.title,x.clicks24h]),[['A',2],['B',1]]);
 assert.equal((await readTossWebSignals(pool,new Date())).clickCounts['1'],2);
 await pool.query('UPDATE deal_clicks SET clicked_at = $1 WHERE deal_id = $2',[new Date(Date.now()-25*3600000).toISOString(),a.id]);
 assert.equal((await store.list({source:'toss',sort:'popular'})).items[0].title,'B');
 await pool.query('UPDATE deals SET is_ended = TRUE WHERE id = $1',[b.id]);
 assert.equal(await clicks.record({dealId:b.id,visitorHash:'c'.repeat(64)}),false);
 assert.equal(await clicks.record({dealId:'9999999',visitorHash:'c'.repeat(64)}),false);
});

test('ranking metadata and new popular products persist through a full snapshot',async(t)=>{
 const {pool,store}=await setup(t);
 await applyTossWebSnapshot(pool,{observedAt:new Date().toISOString(),deals:[{source:'toss',sourceItemId:'1',title:'상품',originalUrl:'https://toss.im/_m/A',tossRank:4,reviewScore:4.8,reviewCount:900,isPopular:true,imageUrl:null,imageStatus:'unsupported_provider'}]});
 const row=(await store.list({source:'toss'})).items[0];
 assert.equal(row.tossRank,4);assert.equal(row.reviewScore,4.8);assert.equal(row.reviewCount,900);assert.equal(row.isPopular,true);
});

test('click endpoint accepts signed first-party visitor, ignores bots, cross-site and forged cookies',async(t)=>{
 const records=[];const secret='a'.repeat(48);const app=express();app.use(express.json());
 app.use(createTrafficAnalytics({store:{recordPageView:async()=>{}},secret,production:false}));
 app.get('/',(_q,r)=>r.send('ok'));
 app.use('/api/deal-clicks',createDealClicksRouter({store:{record:async(x)=>records.push(x)},secret}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const page=await fetch(origin,{headers:{'user-agent':'Mozilla/5.0'}});
 const cookie=page.headers.get('set-cookie').split(';')[0];
 const send=(headers={},body={dealId:'1'})=>fetch(origin+'/api/deal-clicks',{method:'POST',headers:{'content-type':'application/json',origin,cookie,'user-agent':'Mozilla/5.0',...headers},body:JSON.stringify(body)});
 assert.equal((await send()).status,204);assert.equal(records.length,1);
 await send({origin:'https://evil.test'});await send({cookie:'daily_visitor=forged'});await send({'user-agent':'ExampleBot'});
 assert.equal(records.length,1);
 assert.equal((await send({}, {dealId:'1',clicks:1000})).status,400);
 assert.match(records[0].visitorHash,/^[a-f0-9]{64}$/);assert.equal(Object.keys(records[0]).includes('ip'),false);
});

test('browser tracking sends bounded click context, deduplicates, and never intercepts navigation', () => {
 const vm=require('node:vm');const fs=require('node:fs');const handlers={},events=[];
 const root={document:{addEventListener:(name,fn)=>handlers[name]=fn},navigator:{sendBeacon:(url,body)=>{events.push({url,body});return true;}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/deal-clicks.js'),'utf8'),{window:root,Blob});
 const event={isTrusted:true,type:'click',target:{closest:()=>({dataset:{dealId:'42'}})},preventDefault(){throw new Error('must not block navigation');}};
 handlers.click({...event,isTrusted:false});assert.equal(events.length,0);
 handlers.click(event);handlers.click(event);assert.equal(events.length,1);assert.equal(events[0].url,'/api/deal-clicks');
 return events[0].body.text().then(text=>assert.deepEqual(JSON.parse(text),{dealId:'42',event:'click',section:'all-deals',position:1}));
});
