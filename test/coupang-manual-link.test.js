const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { COUPANG_PARTNERS_DISCLOSURE, isCoupangPartnerLink } = require('../src/coupang-manual-link');
const { toApiDeal, createLiveDealsRouter } = require('../src/live-deals-api');
const { dealPage } = require('../src/seo-pages');

const link = 'https://link.coupang.com/a/hA2Z34yD9M';
const manual = {
  id: '123', manualId: '8', source: 'manual', title: '세타필 모이스춰라이징 로션, 591ml, 1개',
  priceAmount: 9480, merchant: '쿠팡', originalUrl: link, category: '뷰티',
  hasManualImage: false, imageStatus: 'missing_merchant_url', isEnded: false,
};

test('only official Coupang Partners short links qualify', () => {
  assert.equal(isCoupangPartnerLink(link), true);
  assert.equal(isCoupangPartnerLink('https://link.coupang.com/re/ABC123'), true);
  for (const bad of [
    'https://link.coupang.com.evil.example/a/ABC123',
    'http://link.coupang.com/a/ABC123',
    'https://link.coupang.com/a/ABC123?redirect=https://evil.example',
    'https://www.coupang.com/vp/products/7164345502',
  ]) assert.equal(isCoupangPartnerLink(bad), false);
});

test('manual Coupang deal keeps the affiliate URL and identifies paid links', () => {
  const deal = toApiDeal(manual);
  assert.equal(deal.url, link);
  assert.equal(deal.isCoupangAffiliate, true);
  assert.equal(toApiDeal({ ...manual, originalUrl: 'https://example.com/item' }).isCoupangAffiliate, false);
  const html = dealPage(manual);
  assert.match(html, /쿠팡파트너스 · 제휴/);
  assert.ok(html.includes(COUPANG_PARTNERS_DISCLOSURE));
  assert.match(html, /rel="sponsored noopener noreferrer"/);
});

test('all-products feed includes published manual products alongside Toss', async () => {
  const calls = [];
  const app = express();
  app.use('/api/live-deals', createLiveDealsRouter({
    async list(query) { calls.push(query); return { items: [manual], total: 1, page: 1, size: 12 }; },
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live-deals?source=all`);
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0].source, ['ppomppu', 'fmkorea', 'ruliweb', 'toss', 'manual']);
    assert.equal((await response.json()).deals[0].isCoupangAffiliate, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
