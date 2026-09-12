'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createTossRecommendationsRouter } = require('../src/toss-recommendations-api');

async function withServer(runtime, store, callback, options = {}) {
  const app = express();
  app.use('/api/toss-recommendations', createTossRecommendationsRouter({ runtime, store, ...options }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const internalRecommendation = Object.freeze({
  productId: '101',
  source: 'integrated-best',
  title: '공식 추천 상품',
  priceAmount: 12900,
  sharelinkUrl: 'https://toss.im/_m/official101',
  rank: 1,
  endAt: null,
  firstSeenAt: new Date('2026-09-12T09:00:00.000Z'),
  lastSeenAt: new Date('2026-09-12T10:00:00.000Z'),
  raw: { mustNotLeak: true },
  imageUrl: 'https://images.example/leak.jpg',
  productUrl: 'https://shop.example/leak',
});

test('disabled runtime or missing store returns a stable empty response and never queries storage', async () => {
  let calls = 0;
  const store = { async listTossRecommendations() { calls += 1; return [internalRecommendation]; } };
  await withServer({ enabled: false }, store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/toss-recommendations`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false, recommendations: [] });
    assert.match(response.headers.get('cache-control'), /no-store/);
  });
  await withServer({ enabled: true }, null, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/toss-recommendations`);
    assert.deepEqual(await response.json(), { enabled: false, recommendations: [] });
  });
  assert.equal(calls, 0);
});

test('enabled API returns no more than ten recommendations with an exact public field allowlist', async () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...internalRecommendation,
    productId: String(index + 1),
    rank: index + 1,
  }));
  await withServer({ enabled: true }, { async listTossRecommendations() { return items; } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/toss-recommendations`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=/);
    const body = await response.json();
    assert.equal(body.enabled, true);
    assert.equal(body.count, 10);
    assert.equal(body.recommendations.length, 10);
    assert.equal(body.updatedAt, '2026-09-12T10:00:00.000Z');
    assert.deepEqual(Object.keys(body.recommendations[0]), [
      'productId', 'source', 'title', 'price', 'sharelinkUrl', 'rank', 'endAt',
    ]);
    assert.equal(body.recommendations[0].price, 12900);
    assert.equal(JSON.stringify(body).includes('mustNotLeak'), false);
    assert.equal(JSON.stringify(body).includes('images.example'), false);
    assert.equal(JSON.stringify(body).includes('shop.example'), false);
  });
});

test('recommendations endpoint rejects every query parameter instead of resembling search or pagination', async () => {
  const store = { async listTossRecommendations() { throw new Error('must not query'); } };
  await withServer({ enabled: true }, store, async (baseUrl) => {
    for (const query of ['q=monitor', 'search=x', 'category=food', 'sort=price', 'page=1', 'size=10', 'unknown=x']) {
      const response = await fetch(`${baseUrl}/api/toss-recommendations?${query}`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'INVALID_QUERY');
    }
  });
});

test('cache lifetime never passes the earliest today-special endAt', async () => {
  const soon = new Date(Date.now() + 2_500).toISOString();
  await withServer({ enabled: true }, {
    async listTossRecommendations() {
      return [{ ...internalRecommendation, source: 'today-special', endAt: new Date(soon), lastSeenAt: new Date() }];
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/toss-recommendations`);
    const seconds = Number(response.headers.get('cache-control').match(/max-age=(\d+)/)?.[1]);
    assert.ok(seconds >= 0 && seconds <= 2);
  });
});

test('rechecks time after a delayed store read and neither exposes nor caches an expired row', async () => {
  const clockValues = [
    new Date('2026-09-12T10:00:00.000Z'),
    new Date('2026-09-12T10:00:02.000Z'),
  ];
  let clockCalls = 0;
  const store = {
    async listTossRecommendations({ now }) {
      assert.equal(now.toISOString(), '2026-09-12T10:00:00.000Z');
      await new Promise((resolve) => setImmediate(resolve));
      return [
        { ...internalRecommendation, productId: '201', endAt: '2026-09-12T10:00:01.000Z' },
        {
          ...internalRecommendation,
          productId: '202',
          rank: 2,
          endAt: '2026-09-12T10:00:05.000Z',
          lastSeenAt: undefined,
        },
      ];
    },
  };
  await withServer({ enabled: true }, store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/toss-recommendations`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.recommendations.map((item) => item.productId), ['202']);
    assert.equal(body.updatedAt, '2026-09-12T10:00:02.000Z');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3, must-revalidate');
  }, { clock: () => clockValues[clockCalls++] });
  assert.equal(clockCalls, 2);
});

test('validates each stored row independently and emits only normalized official values', async () => {
  const invalidRows = [
    { productId: '0' },
    { productId: Number.MAX_SAFE_INTEGER + 1 },
    { source: 'unknown-source' },
    { title: '   ' },
    { title: 'x'.repeat(501) },
    { priceAmount: -1 },
    { priceAmount: undefined },
    { priceAmount: Number.MAX_SAFE_INTEGER + 1 },
    { rank: 0 },
    { rank: 11 },
    { rank: 1.5 },
    { sharelinkUrl: 'javascript:alert(1)' },
    { sharelinkUrl: 'http://toss.im/_m/x' },
    { sharelinkUrl: 'https://evil.example/_m/x' },
    { sharelinkUrl: 'https://user:pass@toss.im/_m/x' },
    { sharelinkUrl: 'https://toss.im:444/_m/x' },
    { sharelinkUrl: 'https://toss.im/not-official/x' },
    { endAt: '2099-09-12T12:00:00' },
    { endAt: undefined },
    { endAt: '2099-02-30T12:00:00Z' },
  ].map((change, index) => ({
    ...internalRecommendation,
    productId: String(1000 + index),
    ...change,
  }));
  const valid = {
    ...internalRecommendation,
    productId: 777,
    title: '  정상 상품  ',
    priceAmount: null,
    endAt: '2099-09-12T21:00:00+09:00',
  };
  await withServer({ enabled: true }, {
    async listTossRecommendations() { return [...invalidRows, valid]; },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/toss-recommendations`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.count, 1);
    assert.deepEqual(body.recommendations, [{
      productId: '777',
      source: 'integrated-best',
      title: '정상 상품',
      price: null,
      sharelinkUrl: 'https://toss.im/_m/official101',
      rank: 1,
      endAt: '2099-09-12T12:00:00.000Z',
    }]);
    const serialized = JSON.stringify(body);
    for (const unsafe of ['javascript:', 'evil.example', 'user:pass@', ':444', 'not-official']) {
      assert.equal(serialized.includes(unsafe), false);
    }
  }, { clock: () => new Date('2026-09-12T10:00:00.000Z') });
});
