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
  assert.match(detail, /<link rel="icon" type="image\/png" sizes="512x512" href="\/favicon\.png">/);
  assert.match(detail, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png">/);
  assert.match(detail, /"@type":"Product"/); assert.match(detail, /신라면 20봉 특가/);
  const category = await (await fetch(`${origin}/hot-deals/food`)).text();
  assert.match(category, /<h1>식품 실시간 핫딜<\/h1>/); assert.match(category, /href="\/deals\/42"/); assert.match(category, /"@type":"ItemList"/);
  assert.equal((await fetch(`${origin}/deals/999`)).status, 404);
});

test('dynamic sitemap contains home, category and active detail URLs', () => {
  const xml = sitemapXml([deal], [{ id: '7', updatedAt: '2026-09-17T00:00:00.000Z' }]);
  assert.match(xml, /https:\/\/easyshoopping\.com\/<\/loc>/);
  assert.match(xml, /https:\/\/easyshoopping\.com\/hot-deals\/food/);
  assert.match(xml, /https:\/\/easyshoopping\.com\/deals\/42/);
  assert.match(xml, /https:\/\/easyshoopping\.com\/community<\/loc>/);
  assert.match(xml, /https:\/\/easyshoopping\.com\/community\/posts\/7/);
  assert.match(xml, /<lastmod>2026-09-16<\/lastmod>/);
});

test('detail escapes content, rejects executable URLs and does not claim verified inventory', () => {
  const { dealPage } = require('../src/seo-pages');
  const html = dealPage({ ...deal, title: '<script>alert(1)</script>', originalUrl: 'javascript:alert(1)' });
  assert.doesNotMatch(html, /href="javascript:|<script>alert|schema.org\/InStock/);
  assert.match(html, /&lt;script&gt;/);
  const manual = dealPage({ ...deal, source: 'manual', manualId: '9', hasManualImage: true });
  assert.match(manual, /https:\/\/easyshoopping.com\/api\/public\/manual-deals\/9\/image/);
});

test('public detail and sitemap exclude ended, stale Toss, drafts and unsupported sources', async (t) => {
  const { newDb } = require('pg-mem');
  const { migrate, createDealStore } = require('../src/deal-store');
  const { Pool } = newDb().adapters.createPg(); const pool = new Pool();
  t.after(() => pool.end()); await migrate(pool);
  const store = createDealStore(pool);
  const active = await store.upsert({ source: 'ppomppu', sourceItemId: 'a', title: '공개', originalUrl: 'https://example.com/a' });
  const ended = await store.upsert({ source: 'ppomppu', sourceItemId: 'b', title: '종료', originalUrl: 'https://example.com/b' });
  await pool.query('UPDATE deals SET is_ended=TRUE WHERE id=$1', [ended.id]);
  const stale = await store.upsert({ source: 'toss', sourceItemId: 'c', title: '오래됨', originalUrl: 'https://example.com/c' });
  await pool.query('UPDATE deals SET last_seen_at=$1 WHERE id=$2', [new Date(Date.now()-48*3600000).toISOString(), stale.id]);
  const draft = await store.upsert({ source: 'manual', sourceItemId: 'd', title: '초안', originalUrl: 'https://example.com/d' });
  const other = await store.upsert({ source: 'coupang', sourceItemId: 'e', title: '제외', originalUrl: 'https://example.com/e' });
  assert.equal((await store.getPublicById(active.id)).title, '공개');
  for (const row of [ended, stale, draft, other]) assert.equal(await store.getPublicById(row.id), null);
  assert.deepEqual((await store.listSitemapDeals()).map(x=>x.id), [active.id]);
});
