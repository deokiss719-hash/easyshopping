const test = require('node:test');
const assert = require('node:assert/strict');

const { createTossBestCandidateReader } = require('../src/toss-best-candidate-reader');

function product(overrides = {}) {
  return {
    rank: 1,
    tacaItemId: 10001,
    displayName: '토스 인기 상품',
    thumbnailUrl: 'https://static.toss.im/image.jpg',
    productUrl: 'https://toss.shopping/product/10001',
    displayPrice: 12900,
    originalPrice: 15900,
    discountRate: 18,
    isSoldOut: false,
    reviewScore: 4.8,
    reviewCount: 321,
    ...overrides,
  };
}

function client(items) {
  const calls = { best: [], links: [] };
  return {
    calls,
    async fetchBestSelling(options) { calls.best.push(options); return { items, nextCursor: null, hasNext: false }; },
    async createLink(body) { calls.links.push(body); return { shortUrl: `https://toss.im/_m/${body.tacaItemId}`, originUrl: 'https://toss.shopping/x' }; },
  };
}

test('reader preserves popular rank order, skips sold-out/invalid cards, and uses stable namespaced IDs', async () => {
  const api = client([
    product({ rank: 1, tacaItemId: 10000, isSoldOut: true }),
    product({ rank: 2, tacaItemId: 0, displayName: '' }),
    product({ rank: 3, tacaItemId: 10003, displayName: '첫 적격' }),
    product({ rank: 4, tacaItemId: 10004, displayName: '둘째 적격' }),
  ]);
  const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:02:03Z') });
  const candidates = await reader.readLatestCandidates({ limit: 50 });
  assert.deepEqual(candidates.map((item) => item.id), ['toss:10003', 'toss:10004']);
  assert.deepEqual(candidates.map((item) => item.rank), [3, 4]);
  assert.equal(candidates[0].firstSeenAt, '2026-09-15T01:02:03.000Z');
  assert.deepEqual(api.calls.best, [{ size: 100 }]);
  assert.equal(api.calls.links.length, 0);
});

test('only selected candidate is materialized once and productUrl is never sent to link API', async () => {
  const api = client([product(), product({ rank: 2, tacaItemId: 10002 })]);
  const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:00:00Z') });
  const [selected] = await reader.readLatestCandidates({ limit: 50 });
  const linked = await reader.materializeCandidate(selected);
  const again = await reader.materializeCandidate({ ...selected });
  assert.equal(linked.originalUrl, 'https://toss.im/_m/10001');
  assert.equal(again.originalUrl, linked.originalUrl);
  assert.deepEqual(api.calls.links, [{ tacaItemId: 10001 }]);
  assert.equal(JSON.stringify(api.calls.links).includes('productUrl'), false);
});

test('fresh lookup tolerates volatile ranking metadata while preserving the selected short URL', async () => {
  let items = [product()];
  const api = client(items);
  api.fetchBestSelling = async (options) => { api.calls.best.push(options); return { items, nextCursor: null, hasNext: false }; };
  const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:00:00Z') });
  const selected = (await reader.readLatestCandidates({ limit: 50 }))[0];
  const linked = await reader.materializeCandidate(selected);

  items = [product({ rank: 2, thumbnailUrl: 'https://static.toss.im/new-image.jpg', reviewScore: 4.9, reviewCount: 322 })];
  const fresh = await reader.readCandidateById({ dealId: selected.id });

  assert.equal(fresh.originalUrl, linked.originalUrl);
  assert.equal(api.calls.links.length, 1);
});

test('fresh lookup refetches global best and rejects absent, sold-out, or safety-relevant changes while reusing selected short URL', async () => {
  let items = [product()];
  const api = client(items);
  api.fetchBestSelling = async (options) => { api.calls.best.push(options); return { items, nextCursor: null, hasNext: false }; };
  const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:00:00Z') });
  const selected = (await reader.readLatestCandidates({ limit: 50 }))[0];
  await reader.materializeCandidate(selected);
  const fresh = await reader.readCandidateById({ dealId: selected.id });
  assert.equal(fresh.originalUrl, 'https://toss.im/_m/10001');
  assert.equal(api.calls.links.length, 1);
  for (const changed of [
    { displayName: '변경된 상품명' },
    { productUrl: 'https://toss.shopping/product/changed' },
    { displayPrice: 13000 },
    { originalPrice: 16000 },
    { discountRate: 19 },
    { isSoldOut: true },
  ]) {
    items = [product(changed)];
    assert.equal(await reader.readCandidateById({ dealId: selected.id }), null);
  }
  items = [];
  assert.equal(await reader.readCandidateById({ dealId: selected.id }), null);
});

test('reader fails closed on malformed ranking envelopes instead of considering arbitrary data', async () => {
  for (const payload of [null, {}, { items: {} }, { items: [product()], hasNext: 'false', nextCursor: null }]) {
    const api = { async fetchBestSelling() { return payload; }, async createLink() { throw new Error('not reached'); } };
    const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:00:00Z') });
    await assert.rejects(() => reader.readLatestCandidates({ limit: 50 }), /malformed|invalid/i);
  }
});

test('reader rejects hostile titles, nonstandard ports, and unordered or duplicate ranks', async () => {
  for (const displayName of [
    '정상 상품\nhttps://evil.example',
    '상품\u2028다음 줄',
    '상품\u0085제어문자',
    '상품 evil.technology/path',
    'javascript:alert(1)',
    '이 콘텐츠는 토스쇼핑 쉐어링크 활동의 일환으로, 링크를 통한 구매가 발생하면 일정 수수료를 지급받습니다.',
  ]) {
    const api = client([product({ displayName })]);
    const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:00:00Z') });
    await assert.rejects(() => reader.readLatestCandidates({ limit: 3 }), /title is unsafe/i);
    assert.equal(api.calls.links.length, 0);
  }
  for (const items of [
    [product({ productUrl: 'https://toss.shopping:444/product/10001' })],
    [product({ thumbnailUrl: 'https://static.toss.im:444/image.jpg' })],
    [product({ rank: 2 }), product({ rank: 1, tacaItemId: 10002 })],
    [product(), product({ rank: 1, tacaItemId: 10002 })],
  ]) {
    const api = client(items);
    const reader = createTossBestCandidateReader({ client: api, observedAt: new Date('2026-09-15T01:00:00Z') });
    await assert.rejects(() => reader.readLatestCandidates({ limit: 50 }), /title|port|rank|order|duplicate|malformed/i);
    assert.equal(api.calls.links.length, 0);
  }
});
