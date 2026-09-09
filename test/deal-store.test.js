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
  imageUrl: 'https://cdn.example.com/deals/101.jpg',
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
  assert.equal(result.items[0].imageUrl, firstDeal.imageUrl);
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
  assert.equal(result.items[0].imageUrl, firstDeal.imageUrl);
  await pool.end();
});

test('재수집 네이버 매칭은 기존 R2 이미지와 관련 메타데이터를 덮어쓰지 않는다', async () => {
  const { pool, store } = await makeStore();
  const r2ImageUrl = 'https://images.example.com/deals/approved-feed/deal-101.webp';
  await store.upsert({
    ...firstDeal,
    merchantUrl: 'https://shop.example/products/101',
    sourceImageUrl: 'https://cdn.shop.example/products/101.jpg',
    imageUrl: r2ImageUrl,
    imageStatus: 'ready',
    imageProvider: 'r2-official-shop',
  });
  await store.upsert({
    ...firstDeal,
    priceAmount: 179000,
    merchantUrl: 'https://search.shopping.naver.com/catalog/123',
    sourceImageUrl: 'https://shopping-phinf.pstatic.net/main_123/123.jpg',
    imageUrl: 'https://shopping-phinf.pstatic.net/main_123/123.jpg',
    imageStatus: 'ready',
    imageProvider: 'naver-shopping',
  });

  const result = await store.list();
  const stored = result.items[0];
  assert.equal(stored.priceAmount, 179000);
  assert.equal(stored.merchantUrl, 'https://shop.example/products/101');
  assert.equal(stored.sourceImageUrl, 'https://cdn.shop.example/products/101.jpg');
  assert.equal(stored.imageUrl, r2ImageUrl);
  assert.equal(stored.imageProvider, 'r2-official-shop');
  assert.equal(stored.imageStatus, 'ready');
  await pool.end();
});

test('이미지 상태를 저장하고 실패 재시도 시각이 지난 판매처 또는 원문 URL 후보를 backfill한다', async () => {
  const { pool, store } = await makeStore();
  const pending = await store.upsert({
    ...firstDeal,
    sourceItemId: 'pending-image',
    imageUrl: null,
    merchantUrl: 'https://shop.example/products/1',
    imageStatus: 'pending',
  });
  const sourceOnly = await store.upsert({ ...firstDeal, sourceItemId: 'source-only', imageUrl: null, merchantUrl: null });
  await store.upsert({
    ...firstDeal,
    source: 'other-feed',
    sourceItemId: 'other-source',
    originalUrl: 'https://example.com/deals/other-source',
    imageUrl: null,
  });

  let candidates = await store.listImageBackfillCandidates({ limit: 10, now: '2026-09-09T00:00:00.000Z', source: 'approved-feed' });
  assert.deepEqual(new Set(candidates.map((deal) => deal.id)), new Set([pending.id, sourceOnly.id]));
  await store.updateImageState(sourceOnly.id, {
    imageStatus: 'ready',
    imageUrl: 'https://images.example.com/deals/feed/source-only.webp',
  });

  await store.updateImageState(pending.id, {
    imageStatus: 'failed',
    imageFailureCode: 'provider_error',
    imageRetryAt: '2026-09-10T00:00:00.000Z',
  });
  candidates = await store.listImageBackfillCandidates({ limit: 10, now: '2026-09-09T00:00:00.000Z', source: 'approved-feed' });
  assert.equal(candidates.length, 0);

  await store.updateImageState(pending.id, {
    imageStatus: 'unsupported_provider',
    imageFailureCode: 'unsupported_provider',
    imageRetryAt: null,
  });
  candidates = await store.listImageBackfillCandidates({ limit: 10, now: '2026-09-09T00:00:00.000Z', source: 'approved-feed' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, pending.id);

  await store.updateImageState(pending.id, {
    imageStatus: 'ready',
    imageUrl: 'https://images.example.com/deals/feed/item.webp',
    sourceImageUrl: 'https://cdn.shop.example/item.jpg',
    imageProvider: 'official-shop',
    imageFailureCode: null,
    imageRetryAt: null,
  });
  const result = await store.list({ source: firstDeal.source });
  const ready = result.items.find((deal) => deal.id === pending.id);
  assert.equal(ready.imageStatus, 'ready');
  assert.equal(ready.merchantUrl, 'https://shop.example/products/1');
  assert.equal(ready.sourceImageUrl, 'https://cdn.shop.example/item.jpg');
  assert.equal(ready.imageProvider, 'official-shop');
  await pool.end();
});

test('backfill의 늦은 성공·실패 업데이트는 이미 준비된 이미지를 덮어쓰지 않는다', async () => {
  const { pool, store } = await makeStore();
  const deal = await store.upsert({
    ...firstDeal,
    sourceItemId: 'concurrent-image',
    imageStatus: 'pending',
  });
  const trustedImageUrl = 'https://images.example.com/deals/feed/trusted.webp';
  await store.updateImageState(deal.id, {
    imageStatus: 'ready',
    imageUrl: trustedImageUrl,
    sourceImageUrl: 'https://cdn.example.com/trusted.jpg',
    imageProvider: 'trusted-provider',
  });

  const lateFailure = await store.updateImageState(deal.id, {
    imageStatus: 'failed',
    imageFailureCode: 'provider_error',
  }, { onlyIfImageMissing: true });
  const lateSuccess = await store.updateImageState(deal.id, {
    imageStatus: 'ready',
    imageUrl: 'https://images.example.com/deals/feed/stale.webp',
    sourceImageUrl: 'https://cdn.example.com/stale.jpg',
    imageProvider: 'stale-provider',
  }, { onlyIfImageMissing: true });

  assert.equal(lateFailure, null);
  assert.equal(lateSuccess, null);
  const stored = (await store.list({ source: firstDeal.source })).items.find((item) => item.id === deal.id);
  assert.equal(stored.imageStatus, 'ready');
  assert.equal(stored.imageUrl, trustedImageUrl);
  assert.equal(stored.imageProvider, 'trusted-provider');
  assert.equal(stored.imageFailureCode, null);
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

test('기존 상품을 ID와 핵심 데이터 손상 없이 재분류한다', async () => {
  const { pool, store } = await makeStore();
  const before = await store.upsert(firstDeal);

  const updated = await store.reclassify((deal) => deal.title.includes('모니터') ? '디지털/가전' : '기타');
  const result = await store.list();

  assert.equal(updated, 1);
  assert.equal(result.items[0].id, before.id);
  assert.equal(result.items[0].category, '디지털/가전');
  assert.equal(result.items[0].title, firstDeal.title);
  assert.equal(result.items[0].originalUrl, firstDeal.originalUrl);
  assert.equal(result.items[0].priceAmount, firstDeal.priceAmount);
  assert.equal(result.items[0].merchant, firstDeal.merchant);
  assert.equal(result.items[0].source, firstDeal.source);
  await pool.end();
});

test('재분류 대상 행을 PostgreSQL FOR UPDATE로 잠근다', async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (/^SELECT/i.test(sql)) return { rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const store = createDealStore({ connect: async () => client });

  await store.reclassify(() => '기타');

  assert.ok(queries.some((sql) => /SELECT id, title, category FROM deals WHERE category IS NULL OR category = '기타' FOR UPDATE/i.test(sql)));
});

test('이미 유효한 카테고리는 시작 시 재분류로 덮어쓰지 않는다', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({
    ...firstDeal,
    title: '오늘의 특가',
    category: '디지털/가전',
  });

  const updated = await store.reclassify(() => '기타');
  const result = await store.list();

  assert.equal(updated, 0);
  assert.equal(result.items[0].category, '디지털/가전');
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

test('이미지 backfill cooldown을 PostgreSQL 공유 상태에 저장하고 읽는다', async () => {
  const { pool, store } = await makeStore();
  assert.equal(await store.getImageBackfillCooldown(), null);
  const retryAt = await store.recordImageBackfillCooldown('page_http_403', '2026-09-10T06:00:00.000Z');
  assert.equal(retryAt, '2026-09-10T06:00:00.000Z');
  assert.equal(await store.getImageBackfillCooldown(), retryAt);
  await pool.end();
});

test('이미지 backfill advisory lease는 전용 연결에서 원자적으로 획득하고 반드시 해제한다', async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ acquired: true }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: true }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    release() { released = true; },
  };
  const store = createDealStore({ connect: async () => client });
  const value = await store.withImageBackfillLease(async () => 'worked');
  assert.equal(value, 'worked');
  assert.match(queries[0], /pg_try_advisory_lock/);
  assert.match(queries[1], /pg_advisory_unlock/);
  assert.equal(released, true);
});

test('advisory unlock 실패에도 연결을 반환하고 기존 worker 오류를 보존한다', async () => {
  let released = false;
  const workerError = new Error('worker failed');
  const unlockError = new Error('unlock failed');
  const client = {
    async query(sql) {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ acquired: true }] };
      if (/pg_advisory_unlock/.test(sql)) throw unlockError;
      throw new Error(`unexpected query: ${sql}`);
    },
    release(destroy) { released = destroy === true; },
  };
  const store = createDealStore({ connect: async () => client });
  await assert.rejects(
    () => store.withImageBackfillLease(async () => { throw workerError; }),
    (error) => error === workerError && error.advisoryUnlockError === unlockError,
  );
  assert.equal(released, true);
});

test('advisory unlock이 false면 잠금 보유 가능성이 있는 연결을 폐기한다', async () => {
  let releaseArgument = null;
  const client = {
    async query(sql) {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ acquired: true }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: false }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    release(destroy) { releaseArgument = destroy; },
  };
  const store = createDealStore({ connect: async () => client });
  await assert.rejects(() => store.withImageBackfillLease(async () => 'worked'), /unlock/i);
  assert.equal(releaseArgument, true);
});

test('이미지 backfill advisory lease 경합 패자는 작업을 실행하지 않는다', async () => {
  let worked = false;
  let released = false;
  const client = {
    query: async () => ({ rows: [{ acquired: false }] }),
    release() { released = true; },
  };
  const store = createDealStore({ connect: async () => client });
  const value = await store.withImageBackfillLease(async () => { worked = true; });
  assert.equal(value, null);
  assert.equal(worked, false);
  assert.equal(released, true);
});
