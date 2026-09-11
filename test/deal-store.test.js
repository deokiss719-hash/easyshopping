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

test('public listing exposes only manual projections linked to a published manual deal', async () => {
  const { pool, store } = await makeStore();
  await store.upsert(firstDeal);
  const published = await store.upsert({
    ...firstDeal,
    source: 'manual',
    sourceItemId: 'published-projection',
    title: '공개 수동 상품',
    originalUrl: 'https://example.com/manual/published',
  });
  const draft = await store.upsert({
    ...firstDeal,
    source: 'manual',
    sourceItemId: 'draft-projection',
    title: '비공개 수동 상품',
    originalUrl: 'https://example.com/manual/draft',
  });
  await store.upsert({
    ...firstDeal,
    source: 'manual',
    sourceItemId: 'orphan-projection',
    title: '고아 수동 상품',
    originalUrl: 'https://example.com/manual/orphan',
  });
  await pool.query(
    `INSERT INTO manual_deals (deal_id, title, product_url, is_published)
     VALUES ($1, '공개 수동 상품', 'https://example.com/manual/published', TRUE),
            ($2, '비공개 수동 상품', 'https://example.com/manual/draft', FALSE)`,
    [published.id, draft.id],
  );

  const all = await store.list({ page: 1, size: 1 });
  assert.equal(all.total, 2);
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].sourceItemId, 'published-projection');

  const manual = await store.list({ source: 'manual', page: 1, size: 20 });
  assert.equal(manual.total, 1);
  assert.deepEqual(manual.items.map((deal) => deal.sourceItemId), ['published-projection']);
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
    publishedAt: '2026-09-08T23:30:00.000Z',
  });
  const sourceOnly = await store.upsert({
    ...firstDeal,
    sourceItemId: 'source-only',
    imageUrl: null,
    merchantUrl: null,
    publishedAt: '2026-09-08T23:30:00.000Z',
  });
  await store.upsert({
    ...firstDeal,
    source: 'other-feed',
    sourceItemId: 'other-source',
    originalUrl: 'https://example.com/deals/other-source',
    imageUrl: null,
    publishedAt: '2026-09-08T23:30:00.000Z',
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

test('이미지 backfill은 KST 오늘 등록되고 한 시간 이내인 글만 후보로 선택한다', async () => {
  const { pool, store } = await makeStore();
  const now = '2026-09-11T17:00:00.000Z'; // 2026-09-12 02:00 KST
  const rows = [
    ['within-hour', '2026-09-11T16:30:00.000Z'],
    ['exactly-hour', '2026-09-11T16:00:00.000Z'],
    ['over-hour', '2026-09-11T15:59:59.000Z'],
  ];
  for (const [sourceItemId, publishedAt] of rows) {
    await store.upsert({
      ...firstDeal,
      sourceItemId,
      originalUrl: `https://example.com/deals/${sourceItemId}`,
      imageUrl: null,
      publishedAt,
    });
  }

  const candidates = await store.listImageBackfillCandidates({ limit: 10, now, source: 'approved-feed' });
  assert.deepEqual(candidates.map((deal) => deal.sourceItemId), ['within-hour', 'exactly-hour']);
  await pool.end();
});

test('이미지 backfill은 자정 직후 한 시간 이내라도 KST 전날 글을 제외한다', async () => {
  const { pool, store } = await makeStore();
  const now = '2026-09-11T15:30:00.000Z'; // 2026-09-12 00:30 KST
  await store.upsert({
    ...firstDeal,
    sourceItemId: 'today-kst',
    originalUrl: 'https://example.com/deals/today-kst',
    imageUrl: null,
    publishedAt: '2026-09-11T15:10:00.000Z',
  });
  await store.upsert({
    ...firstDeal,
    sourceItemId: 'yesterday-kst',
    originalUrl: 'https://example.com/deals/yesterday-kst',
    imageUrl: null,
    publishedAt: '2026-09-11T14:59:00.000Z',
  });

  const candidates = await store.listImageBackfillCandidates({ limit: 10, now, source: 'approved-feed' });
  assert.deepEqual(candidates.map((deal) => deal.sourceItemId), ['today-kst']);
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

test('이미지 backfill 저장 시점에 한 시간 또는 KST 오늘 범위를 벗어나면 업데이트하지 않는다', async () => {
  const { pool, store } = await makeStore();
  const withinWindow = await store.upsert({
    ...firstDeal,
    sourceItemId: 'write-boundary',
    imageUrl: null,
    imageStatus: 'pending',
    publishedAt: '2026-09-11T16:00:00.000Z',
  });
  const tooOld = await store.upsert({
    ...firstDeal,
    sourceItemId: 'write-too-old',
    originalUrl: 'https://example.com/deals/write-too-old',
    imageUrl: null,
    imageStatus: 'pending',
    publishedAt: '2026-09-11T15:59:59.999Z',
  });

  const boundaryResult = await store.updateImageState(withinWindow.id, {
    imageStatus: 'ready',
    imageUrl: 'https://images.example.com/deals/feed/boundary.webp',
  }, { onlyIfImageMissing: true, backfillNow: new Date('2026-09-11T17:00:00.000Z') });
  const rejectedResult = await store.updateImageState(tooOld.id, {
    imageStatus: 'ready',
    imageUrl: 'https://images.example.com/deals/feed/too-old.webp',
  }, { onlyIfImageMissing: true, backfillNow: new Date('2026-09-11T17:00:00.000Z') });

  assert.equal(boundaryResult.imageStatus, 'ready');
  assert.equal(rejectedResult, null);
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

  assert.ok(queries.some((sql) => /SELECT id, title, category FROM deals WHERE source <> 'manual' AND \(category IS NULL OR category = '기타'\) FOR UPDATE/i.test(sql)));
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

test('deletes only deals older than 72 hours from the selected source', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({ ...firstDeal, sourceItemId: 'old', publishedAt: '2026-09-01T00:00:00.000Z' });
  await store.upsert({ ...firstDeal, sourceItemId: 'boundary', originalUrl: 'https://example.com/deals/boundary', publishedAt: '2026-09-05T00:00:00.000Z' });
  await store.upsert({ ...firstDeal, source: 'other-feed', sourceItemId: 'other-old', originalUrl: 'https://example.com/deals/other-old', publishedAt: '2026-09-01T00:00:00.000Z' });

  const deleted = await store.deleteBefore('approved-feed', '2026-09-05T00:00:00.000Z');
  const remaining = await pool.query('SELECT source, source_item_id FROM deals ORDER BY source, source_item_id');

  assert.equal(deleted, 1);
  assert.deepEqual(remaining.rows, [
    { source: 'approved-feed', source_item_id: 'boundary' },
    { source: 'other-feed', source_item_id: 'other-old' },
  ]);
  await pool.end();
});

test('72시간 자동 삭제는 수동 등록 상품 소스를 거부한다', async () => {
  const { pool, store } = await makeStore();
  await assert.rejects(
    () => store.deleteBefore('manual', new Date('2026-09-12T00:00:00.000Z')),
    /manual deals cannot be deleted by retention/,
  );
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

test('public listing applies category and price sorting on the server with null prices last', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({ ...firstDeal, sourceItemId: 'expensive', category: '디지털/가전', priceAmount: 300000 });
  await store.upsert({ ...firstDeal, sourceItemId: 'cheap', originalUrl: 'https://example.com/cheap', category: '디지털/가전', priceAmount: 10000 });
  await store.upsert({ ...firstDeal, sourceItemId: 'unknown', originalUrl: 'https://example.com/unknown', category: '디지털/가전', priceAmount: null });
  await store.upsert({ ...firstDeal, sourceItemId: 'food', originalUrl: 'https://example.com/food', category: '식품', priceAmount: 100 });

  const result = await store.list({ category: '디지털/가전', sort: 'price-low', page: 1, size: 2 });
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map((deal) => deal.sourceItemId), ['cheap', 'expensive']);
  const next = await store.list({ category: '디지털/가전', sort: 'price-low', page: 2, size: 2 });
  assert.deepEqual(next.items.map((deal) => deal.sourceItemId), ['unknown']);
  await pool.end();
});

test('public listing rejects unsupported filters, sorts, and oversized searches', async () => {
  const { pool, store } = await makeStore();
  await assert.rejects(() => store.list({ category: '없는 카테고리' }), /category/);
  await assert.rejects(() => store.list({ sort: 'price; DROP TABLE deals' }), /sort/);
  await assert.rejects(() => store.list({ q: '가'.repeat(101) }), /q/);
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
