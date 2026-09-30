const test = require('node:test');
const assert = require('node:assert/strict');
const { destination, createTracker } = require('../public/home-service-events');
const origin = 'https://easyshoopping.com';
test('only public service destinations qualify, never recovery, payment, admin or external links', () => {
  assert.equal(destination('/community', origin), 'community');
  assert.equal(destination('/phone.html', origin), 'phone');
  assert.equal(destination('/saju', origin), 'saju');
  for (const href of ['/saju?token=secret','/saju/result','/saju/admin','/saju/pay','/admin','https://evil.com/saju','/#all-deals']) assert.equal(destination(href, origin), null);
});
test('service clicks exclude private URL data and duplicate navigation, retain separate services', () => {
  const calls = []; const saved = new Map(); let at = 0;
  const location = { href: `${origin}/?q=private&utm_source=meta#private` };
  const original = location.href;
  const options = { location, history: { replaceState: (_,__,url) => { location.href = url; } },
    pixel: (...args) => calls.push({args, url:location.href}), now:()=>at,
    storage: { getItem:k=>saved.get(k) ?? null, setItem:(k,v)=>saved.set(k,v) } };
  assert.equal(createTracker(options).track('/saju'), true);
  assert.equal(createTracker(options).track('/saju'), false);
  assert.equal(createTracker(options).track('/phone.html'), true);
  assert.equal(location.href, original);
  assert.deepEqual(calls[0], {args:['trackSingleCustom','1175739998075582','HomeServiceClick',{service:'saju',source:'homepage'}],url:`${origin}/`});
  at = 1800000;
  assert.equal(createTracker(options).track('/saju'), true);
  assert.equal(createTracker({...options,ready:()=>false}).track('/community'), false);
  location.href = `${origin}/?meta_test=1`;
  assert.equal(createTracker(options).track('/community'), false);
  location.href = `${origin}/saju`;
  assert.equal(createTracker(options).track('/community'), false);
});
