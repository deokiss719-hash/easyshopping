const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { newDb, DataType } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');
const { createLiveDealsRouter } = require('../src/live-deals-api');

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

async function withServer(store, callback, options = {}) {
  const app = express();
  app.use('/api/live-deals', createLiveDealsRouter(store, options));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('live deals API returns stored deals with pagination metadata and original links', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({
    source: 'approved-feed',
    sourceItemId: 'item-1',
    title: '승인된 모니터 특가',
    priceText: '199,000원',
    priceAmount: 199000,
    merchant: '테스트몰',
    imageUrl: 'https://cdn.example/item.jpg',
    imageStatus: 'ready',
    category: '디지털/가전',
    originalUrl: 'https://example.com/item-1',
    publishedAt: '2026-09-08T09:00:00.000Z',
  });

  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live-deals?q=모니터&source=approved-feed&page=1&size=20`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.page, 1);
    assert.equal(body.deals[0].url, 'https://example.com/item-1');
    assert.equal(body.deals[0].price, 199000);
    assert.equal(body.deals[0].store, '테스트몰');
    assert.equal(body.deals[0].category, '디지털/가전');
    assert.equal(body.deals[0].imageUrl, 'https://cdn.example/item.jpg');
    assert.equal(body.deals[0].imageStatus, 'ready');
    assert.deepEqual(body.imageBaseUrls, ['https://images.example.com/base']);
  }, { imageBaseUrls: ['https://images.example.com/base'] });
  await pool.end();
});

test('live deals API reports unavailable until PostgreSQL is configured', async () => {
  await withServer(null, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live-deals`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'DATABASE_NOT_CONFIGURED');
  });
});

test('live deals API returns 400 for malformed pagination', async () => {
  const { pool, store } = await makeStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live-deals?page=oops`);
    assert.equal(response.status, 400);
  });
  await pool.end();
});

test('live deals API keeps internal range errors private and returns 500', async () => {
  const brokenStore = {
    async list() {
      throw new RangeError('database value 999999999999999999 is unsafe');
    },
  };

  await withServer(brokenStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live-deals`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.code, 'DATABASE_ERROR');
    assert.doesNotMatch(body.message, /999999999999999999/);
  });
});
