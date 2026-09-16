const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSeoPagesRouter, sitemapXml } = require('../src/seo-pages');

const deal = { id: '42', source: 'ppomppu', title: '신라면 20봉 특가', priceAmount: 13900, merchant: 'G마켓', category: '식품', originalUrl: 'https://shop.example/ramen', imageUrl: 'https://img.example/ramen.jpg', updatedAt: '2026-09-16T00:00:00.000Z' };

async function listen(app) { const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); return { server, origin: `http://127.0.0.1:${server.address().port}` }; }

test('detail and category pages expose unique canonical metadata and crawlable internal links', async (t) => {
  const store = { getPublicById: async (id) => id === '42' ? deal : null, list: async () => ({ items: [deal] }), listSitemapDeals: async () => [deal] };
  const app = express(); app.use(createSeoPagesRouter(store));
  const { server, origin } = await listen(app); t.after(() => new Promise((resolve) => server.close(resolve)));
  const detail = await (await fetch(`${origin}/deals/42`)).text();
  assert.match(detail, /<link rel="canonical" href="https:\/\/easyshoopping\.com\/deals\/42">/);
  assert.match(detail, /"@type":"Product"/); assert.match(detail, /신라면 20봉 특가/);
  const category = await (await fetch(`${origin}/hot-deals/food`)).text();
  assert.match(category, /<h1>식품 실시간 핫딜<\/h1>/); assert.match(category, /href="\/deals\/42"/); assert.match(category, /"@type":"ItemList"/);
  assert.equal((await fetch(`${origin}/deals/999`)).status, 404);
});

test('dynamic sitemap contains home, category and active detail URLs', () => {
  const xml = sitemapXml([deal]);
  assert.match(xml, /https:\/\/easyshoopping\.com\/<\/loc>/);
  assert.match(xml, /https:\/\/easyshoopping\.com\/hot-deals\/food/);
  assert.match(xml, /https:\/\/easyshoopping\.com\/deals\/42/);
  assert.match(xml, /<lastmod>2026-09-16<\/lastmod>/);
});
