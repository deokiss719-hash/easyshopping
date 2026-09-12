const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { newDb } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');
const {
  COUPANG_SOURCE,
  createCoupangAuthorization,
  normalizeCoupangSnapshot,
  readCoupangRuntime,
  runCoupangCollector,
} = require('../src/coupang-products');

function response(body, { status = 200, contentType = 'application/json' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

function product(overrides = {}) {
  return {
    productId: 12345,
    productName: '공식 API 테스트 상품',
    productPrice: 19900,
    productImage: 'https://thumbnail.coupangcdn.com/test.jpg',
    productUrl: 'https://link.coupang.com/re/AFFSDP?lptag=AF0000000&pageKey=12345',
    categoryName: '가전디지털',
    isRocket: true,
    isFreeShipping: true,
    ...overrides,
  };
}

test('쿠팡 수집은 명시적 활성화와 Access/Secret Key가 모두 있을 때만 켜진다', () => {
  assert.equal(readCoupangRuntime({}).enabled, false);
  assert.equal(readCoupangRuntime({ COUPANG_PRODUCTS_ENABLED: 'true', COUPANG_ACCESS_KEY: 'access' }).enabled, false);
  const runtime = readCoupangRuntime({
    COUPANG_PRODUCTS_ENABLED: 'true',
    COUPANG_ACCESS_KEY: 'access',
    COUPANG_SECRET_KEY: 'secret',
  });
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.intervalMs, 6 * 60 * 60 * 1000);
  assert.deepEqual(runtime.categoryIds, ['1012', '1013', '1014', '1016', '1024', '1029']);
});

test('공식 규격대로 UTC 시각, method, path, query를 HMAC-SHA256 서명한다', () => {
  const now = new Date('2026-09-12T01:02:03.000Z');
  const uri = '/v2/providers/affiliate_open_api/apis/openapi/products/bestcategories/1016?limit=20&imageSize=512x512';
  const authorization = createCoupangAuthorization({
    method: 'GET', uri, accessKey: 'access-key', secretKey: 'secret-key', now,
  });
  const signedDate = "260912T010203Z";
  const expected = createHmac('sha256', 'secret-key')
    .update(`${signedDate}GET${uri.replace('?', '')}`, 'utf8')
    .digest('hex');
  assert.equal(authorization, `CEA algorithm=HmacSHA256, access-key=access-key, signed-date=${signedDate}, signature=${expected}`);
  assert.doesNotMatch(authorization, /secret-key/);
});

test('공식 상품 응답을 쿠팡 deal로 정규화하고 productUrl을 변경하지 않는다', () => {
  const url = 'https://link.coupang.com/re/AFFSDP?lptag=AF0000000&pageKey=12345&itemId=9';
  const deals = normalizeCoupangSnapshot([
    { kind: 'goldbox', categoryId: null, products: [product({ productUrl: url })] },
  ], new Date('2026-09-12T02:00:00.000Z'));
  assert.equal(deals.length, 1);
  assert.equal(deals[0].source, COUPANG_SOURCE);
  assert.equal(deals[0].sourceItemId, '12345');
  assert.equal(deals[0].originalUrl, url);
  assert.equal(deals[0].merchant, '쿠팡');
  assert.equal(deals[0].badge, '쿠팡특가');
  assert.equal(deals[0].description, '로켓배송 · 무료배송');
  assert.equal(deals[0].priceAmount, 19900);
  assert.equal(deals[0].imageStatus, 'ready');
});

test('일반 쿠팡 URL, 가짜 추적 호스트, 비공식 이미지, 불안전한 ID와 가격은 전체 스냅샷을 거부한다', () => {
  const invalidProducts = [
    product({ productUrl: 'https://www.coupang.com/vp/products/12345' }),
    product({ productUrl: 'https://link.coupang.com.evil.example/re/AFFSDP?lptag=x' }),
    product({ productImage: 'https://images.evil.example/test.jpg' }),
    product({ productId: Number.MAX_SAFE_INTEGER + 1 }),
    product({ productPrice: 19.9 }),
  ];
  for (const item of invalidProducts) {
    assert.throws(() => normalizeCoupangSnapshot([{ kind: 'category', categoryId: '1016', products: [item] }]), /Coupang/i);
  }
});

test('동일 productId의 동일 상품은 축약하고 내용이 충돌하면 전체 스냅샷을 거부한다', () => {
  const duplicate = normalizeCoupangSnapshot([
    { kind: 'goldbox', products: [product()] },
    { kind: 'category', categoryId: '1016', products: [product()] },
  ]);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].badge, '쿠팡특가');
  assert.throws(() => normalizeCoupangSnapshot([
    { kind: 'goldbox', products: [product()] },
    { kind: 'category', categoryId: '1016', products: [product({ productUrl: 'https://link.coupang.com/re/AFFSDP?lptag=DIFFERENT&pageKey=12345' })] },
  ]), /conflict/i);
});

test('모든 공식 API 요청이 성공한 뒤에만 DB 스냅샷 동기화를 호출한다', async () => {
  const calls = [];
  const store = {
    async withCoupangCollectionLease(worker) { return worker(); },
    async syncCoupangSnapshot(items) { calls.push(items); return { upserted: items.length, ended: 0 }; },
  };
  const runtime = {
    enabled: true,
    accessKey: 'access', secretKey: 'secret', categoryIds: ['1016'], requestTimeoutMs: 5000,
  };
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).hostname, 'api-gateway.coupang.com');
    assert.match(options.headers.Authorization, /^CEA algorithm=HmacSHA256/);
    return response({ rCode: '0', data: [product()] });
  };
  const result = await runCoupangCollector({ runtime, store, fetchImpl, now: new Date('2026-09-12T03:00:00Z') });
  assert.equal(result.fetched, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].originalUrl.includes('lptag='), true);
});

test('부분 API 실패나 비정상 성공 응답에서는 기존 쿠팡 자료를 종료하지 않는다', async () => {
  let fetchCount = 0;
  let syncCount = 0;
  const runtime = {
    enabled: true,
    accessKey: 'access', secretKey: 'secret', categoryIds: ['1016'], requestTimeoutMs: 5000,
  };
  await assert.rejects(() => runCoupangCollector({
    runtime,
    store: {
      async withCoupangCollectionLease(worker) { return worker(); },
      async syncCoupangSnapshot() { syncCount += 1; },
    },
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) return response({ rCode: '0', data: [product()] });
      return response({ rCode: 'ERROR', rMessage: 'temporary failure', data: [] });
    },
  }), /Coupang/i);
  assert.equal(syncCount, 0);
});

test('쿠팡 스냅샷 동기화는 누락된 쿠팡 상품만 종료하고 재등장 상품은 같은 행으로 복구한다', async () => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: 'pg_advisory_xact_lock', args: ['integer', 'integer'], returns: 'integer', implementation: () => 1 });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const store = createDealStore(pool);
  const a = normalizeCoupangSnapshot([{ kind: 'goldbox', products: [product({ productId: 1, productUrl: 'https://link.coupang.com/re/AFFSDP?lptag=AF0000000&pageKey=1' })] }])[0];
  const b = normalizeCoupangSnapshot([{ kind: 'category', categoryId: '1016', products: [product({ productId: 2, productName: '상품 B', productUrl: 'https://link.coupang.com/re/AFFSDP?lptag=AF0000000&pageKey=2' })] }])[0];
  await store.upsert({ ...a, source: 'ppomppu', sourceItemId: 'rss-1', originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1' });
  await store.syncCoupangSnapshot([a, b]);
  const originalAId = (await store.list({ source: 'coupang', size: 20 })).items.find((item) => item.sourceItemId === '1').id;
  await store.syncCoupangSnapshot([b]);
  assert.deepEqual((await store.list({ source: 'coupang', size: 20 })).items.map((item) => item.sourceItemId), ['2']);
  assert.equal((await store.list({ source: 'ppomppu', size: 20 })).total, 1);
  await store.syncCoupangSnapshot([a, b]);
  const restoredA = (await store.list({ source: 'coupang', size: 20 })).items.find((item) => item.sourceItemId === '1');
  assert.equal(restoredA.id, originalAId);
  await pool.end();
});

test('환경변수 예시는 런타임과 동일한 canonical 쿠팡 변수명만 사용한다', async () => {
  const envExample = await require('node:fs/promises').readFile(require('node:path').join(__dirname, '..', '.env.example'), 'utf8');
  for (const name of ['COUPANG_PRODUCTS_ENABLED', 'COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY', 'COUPANG_POLL_INTERVAL_MS', 'COUPANG_CATEGORY_IDS', 'COUPANG_REQUEST_TIMEOUT_MS']) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  }
  assert.doesNotMatch(envExample, /COUPANG_PARTNERS_|COUPANG_PRODUCTS_INTERVAL_MS/);
});

test('기능 OFF면 잘못된 쿠팡 보조 설정을 파싱하지 않는다', () => {
  const runtime = readCoupangRuntime({
    COUPANG_PRODUCTS_ENABLED: 'false',
    COUPANG_CATEGORY_IDS: 'not-a-category',
    COUPANG_POLL_INTERVAL_MS: 'broken',
    COUPANG_REQUEST_TIMEOUT_MS: '-1',
  });
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.requested, false);
});

test('플래그가 켜져도 키가 불완전하면 보조 설정을 파싱하지 않고 안전하게 비활성화한다', () => {
  const runtime = readCoupangRuntime({
    COUPANG_PRODUCTS_ENABLED: 'true',
    COUPANG_ACCESS_KEY: 'placeholder-access',
    COUPANG_CATEGORY_IDS: 'not-a-category',
    COUPANG_POLL_INTERVAL_MS: 'broken',
    COUPANG_REQUEST_TIMEOUT_MS: '-1',
  });
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.requested, true);
  assert.deepEqual(runtime.missing, ['COUPANG_SECRET_KEY']);
});

test('활성 상태에서는 공식 카테고리 ID만 허용한다', () => {
  const base = {
    COUPANG_PRODUCTS_ENABLED: 'true', COUPANG_ACCESS_KEY: 'test-access', COUPANG_SECRET_KEY: 'test-secret',
  };
  assert.deepEqual(readCoupangRuntime({ ...base, COUPANG_CATEGORY_IDS: '1012,1024,1029' }).categoryIds, ['1012', '1024', '1029']);
  assert.throws(() => readCoupangRuntime({ ...base, COUPANG_CATEGORY_IDS: '9999' }), /official category/i);
});

test('link.coupang.com 정확한 호스트 외 유사·서브·단축 호스트를 모두 거부한다', () => {
  for (const productUrl of [
    'https://coupa.ng/example',
    'https://sub.link.coupang.com/re/AFFSDP?lptag=test',
    'https://link.coupang.com.evil.example/re/AFFSDP?lptag=test',
  ]) {
    assert.throws(() => normalizeCoupangSnapshot([{ kind: 'category', products: [product({ productUrl })] }]), /tracking URL/i);
  }
});

test('잠금 경합 패자는 쿠팡 API를 호출하지 않는다', async () => {
  let fetchCount = 0;
  let syncCount = 0;
  const result = await runCoupangCollector({
    runtime: { enabled: true, accessKey: 'a', secretKey: 's', categoryIds: ['1012'], requestTimeoutMs: 5000 },
    store: {
      async withCoupangCollectionLease() { return null; },
      async syncCoupangSnapshot() { syncCount += 1; },
    },
    fetchImpl: async () => { fetchCount += 1; return response({ rCode: '0', data: [product()] }); },
  });
  assert.deepEqual(result, { enabled: true, skipped: 'lease-unavailable', fetched: 0, upserted: 0, ended: 0 });
  assert.equal(fetchCount, 0);
  assert.equal(syncCount, 0);
});

test('쿠팡 API 호출부터 DB 동기화까지 하나의 수집 잠금 안에서 실행한다', async () => {
  const events = [];
  const store = {
    async withCoupangCollectionLease(worker) {
      events.push('lease-start');
      const value = await worker();
      events.push('lease-end');
      return value;
    },
    async syncCoupangSnapshot(items) { events.push('sync'); return { upserted: items.length, ended: 0 }; },
  };
  await runCoupangCollector({
    runtime: { enabled: true, accessKey: 'a', secretKey: 's', categoryIds: [], requestTimeoutMs: 5000 },
    store,
    fetchImpl: async () => { events.push('fetch'); return response({ rCode: '0', data: [product()] }); },
  });
  assert.deepEqual(events, ['lease-start', 'fetch', 'sync', 'lease-end']);
});

test('chunked 쿠팡 응답은 제한 크기를 읽는 즉시 스트림을 취소한다', async () => {
  let cancelled = false;
  let sent = 0;
  const chunk = new Uint8Array(64 * 1024).fill(97);
  const body = new ReadableStream({
    pull(controller) {
      sent += chunk.byteLength;
      if (sent > 3 * 1024 * 1024) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() { cancelled = true; },
  });
  const store = {
    async withCoupangCollectionLease(worker) { return worker(); },
    async syncCoupangSnapshot() { throw new Error('must not sync'); },
  };
  await assert.rejects(() => runCoupangCollector({
    runtime: { enabled: true, accessKey: 'a', secretKey: 's', categoryIds: [], requestTimeoutMs: 5000 },
    store,
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
  }), /too large/i);
  assert.equal(cancelled, true);
  assert.ok(sent < 3 * 1024 * 1024);
});
