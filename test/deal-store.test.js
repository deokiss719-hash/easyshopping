const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');

async function makeStore() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: 'strpos',
    args: [DataType.text, DataType.text],
    returns: DataType.integer,
    implementation: (text, search) => text.indexOf(search) + 1,
  });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createDealStore(pool) };
}

const firstDeal = {
  source: 'approved-feed',
  sourceItemId: 'deal-101',
  title: '테스트 모니터 특가',
  priceText: '199,000원',
  priceAmount: 199000,
  merchant: '테스트몰',
  originalUrl: 'https://example.com/deals/101',
  publishedAt: '2026-09-08T09:00:00.000Z',
};

test('migration creates a usable deals table', async () => {
  const { pool } = await makeStore();
  const result = await pool.query('SELECT * FROM deals LIMIT 1');
  assert.equal(result.rowCount, 0);
  await pool.end();
});

test('upsert inserts a deal and exposes it through the listing API', async () => {
  const { pool, store } = await makeStore();
  await store.upsert(firstDeal);

  const result = await store.list({ page: 1, size: 20 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].title, firstDeal.title);
  assert.equal(result.items[0].priceAmount, 199000);
  assert.equal(result.items[0].source, 'approved-feed');
  await pool.end();
});

test('upsert updates an existing source item instead of creating a duplicate', async () => {
  const { pool, store } = await makeStore();
  await store.upsert(firstDeal);
  await store.upsert({ ...firstDeal, priceText: '179,000원', priceAmount: 179000 });

  const result = await store.list({ page: 1, size: 20 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].priceAmount, 179000);
  await pool.end();
});

test('listing supports keyword search, source filtering, and bounded pagination', async () => {
  const { pool, store } = await makeStore();
  await store.upsert(firstDeal);
  await store.upsert({
    ...firstDeal,
    source: 'second-feed',
    sourceItemId: 'deal-202',
    title: '무선 키보드 할인',
    originalUrl: 'https://example.com/deals/202',
  });

  const result = await store.list({ q: '모니터', source: 'approved-feed', page: 1, size: 500 });
  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.size, 100);
  assert.equal(result.items[0].sourceItemId, 'deal-101');
  await pool.end();
});

test('upsert rejects records without a stable identity or original link', async () => {
  const { pool, store } = await makeStore();
  await assert.rejects(
    () => store.upsert({ source: 'approved-feed', title: '불완전한 상품' }),
    /sourceItemId.*originalUrl/,
  );
  await assert.rejects(
    () => store.upsert({ ...firstDeal, source: '   ' }),
    /source/,
  );
  await pool.end();
});

test('upsert rejects unsafe numeric prices before PostgreSQL can round them', async () => {
  const { pool, store } = await makeStore();
  await assert.rejects(
    () => store.upsert({ ...firstDeal, priceAmount: Number.MAX_SAFE_INTEGER + 1 }),
    /safe non-negative integer/,
  );
  await pool.end();
});

test('partial upsert preserves optional values that are temporarily missing', async () => {
  const { pool, store } = await makeStore();
  await store.upsert(firstDeal);
  await store.upsert({
    source: firstDeal.source,
    sourceItemId: firstDeal.sourceItemId,
    title: '수정된 테스트 모니터 특가',
    originalUrl: firstDeal.originalUrl,
  });

  const result = await store.list();
  assert.equal(result.items[0].priceText, '199,000원');
  assert.equal(result.items[0].priceAmount, 199000);
  assert.equal(result.items[0].merchant, '테스트몰');
  await pool.end();
});

test('pagination rejects malformed values and caps excessively large pages', async () => {
  const { pool, store } = await makeStore();
  await assert.rejects(() => store.list({ page: '2junk' }), /page/);
  await assert.rejects(() => store.list({ size: '20junk' }), /size/);

  const result = await store.list({ page: 999999999, size: 20 });
  assert.equal(result.page, 10000);
  await pool.end();
});

test('marks only stale deals from the selected source as ended', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({ ...firstDeal, sourceItemId: 'old', publishedAt: '2026-09-01T00:00:00.000Z' });
  await store.upsert({ ...firstDeal, sourceItemId: 'fresh', originalUrl: 'https://example.com/deals/fresh', publishedAt: '2026-09-08T00:00:00.000Z' });

  const ended = await store.markEndedBefore('approved-feed', '2026-09-05T00:00:00.000Z');
  const active = await store.list({ source: 'approved-feed' });
  const old = await pool.query("SELECT is_ended, ended_at FROM deals WHERE source_item_id = 'old'");

  assert.equal(ended, 1);
  assert.equal(active.total, 1);
  assert.equal(active.items[0].sourceItemId, 'fresh');
  assert.equal(old.rows[0].is_ended, true);
  assert.ok(old.rows[0].ended_at);
  await pool.end();
});

test('keyword search treats percent and underscore as literal characters', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({ ...firstDeal, title: '100% 할인 모니터' });
  await store.upsert({
    ...firstDeal,
    sourceItemId: 'deal-102',
    title: '일반 할인 모니터',
    originalUrl: 'https://example.com/deals/102',
  });

  const percentResult = await store.list({ q: '%' });
  assert.equal(percentResult.total, 1);
  assert.equal(typeof percentResult.items[0].id, 'string');
  await pool.end();
});
