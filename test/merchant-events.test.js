const test = require('node:test');
const assert = require('node:assert/strict');
const { merchantFor, createTracker } = require('../public/merchant-events');
const { createDealClicksRouter } = require('../src/deal-clicks');
const adminCookie = require('../src/admin/admin-traffic-cookie');
const express = require('express');
const toss = 'https://toss.im/_m/example';
function storage() { const map = new Map(); return { getItem:k=>map.get(k), setItem:(k,v)=>map.set(k,v), removeItem:k=>map.delete(k) }; }
test('only known merchant links qualify; community, spoofed hosts and internal URLs do not', () => {
  assert.equal(merchantFor(toss), 'toss');
  assert.equal(merchantFor('https://toss.shopping/t/123?k=secret'), 'toss');
  assert.equal(merchantFor('https://link.coupang.com/a/abc'), 'coupang');
  for (const href of ['https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu', 'https://www.fmkorea.com/123', 'https://bbs.ruliweb.com/market/board/1020/read/1', 'https://toss.im.evil.com/_m/a', 'https://evil@toss.im/_m/a', 'http://toss.im/_m/a', 'https://toss.im/', '/deals/3']) assert.equal(merchantFor(href), null);
});
test('deduplicate same product across reloads for 30 minutes, retain distinct products, send no revenue', () => {
  const calls=[]; const session=storage(); let time=1000;
  const options={pixel:(...args)=>calls.push(args), storage:session, now:()=>time};
  assert.equal(createTracker(options).track({id:1,href:toss}),true);
  assert.equal(createTracker(options).track({id:1,href:toss}),false);
  assert.equal(createTracker(options).track({id:2,href:toss}),true);
  time+=1800000;
  assert.equal(createTracker(options).track({id:1,href:toss}),true);
  assert.deepEqual(calls[0], ['trackSingleCustom','1175739998075582','MerchantOutboundClick',{merchant:'toss',deal_id:'1',destination_type:'merchant'}]);
});
test('test mode persists across pages and can be cleared; unavailable pixel and ineligible clients send nothing', () => {
  const calls=[]; const session=storage();
  const options={pixel:(...args)=>calls.push(args),storage:session};
  for (const href of ['https://easyshoopping.com/?meta_test=1','https://easyshoopping.com/deals/1']) assert.equal(createTracker({...options,location:{href}}).track({id:1,href:toss}),false);
  assert.equal(createTracker({...options,location:{href:'https://easyshoopping.com/?meta_test=0'}}).track({id:1,href:toss}),true);
  assert.equal(createTracker({...options,ready:()=>false}).track({id:2,href:toss}),false);
  assert.equal(calls.length,1);
});
test('eligibility endpoint excludes signed admin visits and bots without caching', async t => {
  const secret='x'.repeat(32); const now=new Date(); const app=express();
  app.use(createDealClicksRouter({store:{},secret,now:()=>now}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>server.close()); const url=`http://127.0.0.1:${server.address().port}/meta-eligibility`;
  const normal=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'}});
  assert.equal(normal.headers.get('cache-control'),'no-store'); assert.equal((await normal.json()).eligible,true);
  const cookie=`${adminCookie.COOKIE_NAME}=${adminCookie.createValue(secret,new Date(+now+60000))}`;
  assert.equal((await (await fetch(url,{headers:{'user-agent':'Mozilla/5.0',cookie}})).json()).eligible,false);
  assert.equal((await (await fetch(url,{headers:{'user-agent':'Googlebot'}})).json()).eligible,false);
});
