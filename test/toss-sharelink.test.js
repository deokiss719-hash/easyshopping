const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_RESPONSE_BYTES,
  TOSS_SOURCES,
  createTossSharelinkClient,
  normalizeTossSnapshot,
  readTossSharelinkRuntime,
  runTossSharelinkCollector,
} = require('../src/toss-sharelink');

function jsonResponse(body, { status = 200, contentType = 'application/json', headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType, ...headers },
  });
}

function product(id, overrides = {}) {
  return {
    rank: 1,
    tacaItemId: id,
    displayName: `토스 상품 ${id}`,
    displayPrice: 19900,
    thumbnailUrl: 'https://static.toss.im/forbidden.jpg',
    productUrl: `https://toss.shopping/t/${id}`,
    ...overrides,
  };
}

function enabledRuntime(overrides = {}) {
  return {
    enabled: true,
    requested: true,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    publisherId: '550e8400-e29b-41d4-a716-446655440000',
    intervalMs: 3600000,
    requestTimeoutMs: 5000,
    maxItems: 10,
    ...overrides,
  };
}

function successfulLink(id) {
  return jsonResponse({ resultType: 'SUCCESS', success: {
    tacaItemId: id,
    publisherId: '550e8400-e29b-41d4-a716-446655440000',
    shortUrl: `https://toss.im/_m/link${id}`,
  } });
}

function collectingStore(onSync = () => {}) {
  return {
    async withTossSharelinkCollectionLease(worker) { return worker(); },
    async syncTossSharelinkSnapshot(items) {
      onSync(items);
      return { upserted: items.length, ended: 0 };
    },
  };
}

test('런타임은 기본 OFF이고 OFF 상태에서는 무관한 잘못된 선택값을 검사하지 않는다', () => {
  const runtime = readTossSharelinkRuntime({
    TOSS_SHARELINK_POLL_INTERVAL_MS: 'broken',
    TOSS_SHARELINK_REQUEST_TIMEOUT_MS: '-1',
    TOSS_SHARELINK_MAX_ITEMS: '999',
  });
  assert.deepEqual(runtime, {
    enabled: false,
    requested: false,
    missing: [],
    clientId: null,
    clientSecret: null,
    publisherId: null,
    intervalMs: 3600000,
    requestTimeoutMs: 10000,
    maxItems: 10,
  });
});

test('활성화 요청 시 세 자격정보가 필요하고 모두 있어야 선택값 범위를 검사한다', () => {
  const incomplete = readTossSharelinkRuntime({
    TOSS_SHARELINK_ENABLED: 'true',
    TOSS_SHARELINK_CLIENT_ID: 'client',
    TOSS_SHARELINK_MAX_ITEMS: 'broken',
  });
  assert.equal(incomplete.enabled, false);
  assert.deepEqual(incomplete.missing, ['TOSS_SHARELINK_CLIENT_SECRET', 'TOSS_SHARELINK_PUBLISHER_ID']);

  const base = {
    TOSS_SHARELINK_ENABLED: 'true',
    TOSS_SHARELINK_CLIENT_ID: ' client ',
    TOSS_SHARELINK_CLIENT_SECRET: ' secret ',
    TOSS_SHARELINK_PUBLISHER_ID: ' publisher ',
  };
  const configured = readTossSharelinkRuntime({
    ...base,
    TOSS_SHARELINK_POLL_INTERVAL_MS: '86400000',
    TOSS_SHARELINK_REQUEST_TIMEOUT_MS: '30000',
    TOSS_SHARELINK_MAX_ITEMS: '1',
  });
  assert.equal(configured.enabled, true);
  assert.equal(configured.clientId, 'client');
  assert.equal(configured.maxItems, 1);
  for (const bad of [
    { TOSS_SHARELINK_MAX_ITEMS: '0' }, { TOSS_SHARELINK_MAX_ITEMS: '11' },
    { TOSS_SHARELINK_POLL_INTERVAL_MS: '3599999' }, { TOSS_SHARELINK_POLL_INTERVAL_MS: '86400001' },
    { TOSS_SHARELINK_REQUEST_TIMEOUT_MS: '999' }, { TOSS_SHARELINK_REQUEST_TIMEOUT_MS: '30001' },
  ]) assert.throws(() => readTossSharelinkRuntime({ ...base, ...bad }), /TOSS_SHARELINK_/);
});

test('OAuth client_credentials 형식과 스코프를 사용하고 expires_in보다 일찍 만료되는 메모리 캐시를 쓴다', async () => {
  const calls = [];
  let currentMs = Date.parse('2026-09-12T00:00:00Z');
  const client = createTossSharelinkClient({
    runtime: enabledRuntime(),
    now: () => new Date(currentMs),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ access_token: `token-${calls.length}`, token_type: 'Bearer', expires_in: 120 });
    },
  });
  assert.equal(await client.getAccessToken(), 'token-1');
  assert.equal(await client.getAccessToken(), 'token-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.cert.toss.im/token');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'test-client');
  assert.equal(body.get('client_secret'), 'test-secret');
  assert.equal(body.get('scope'), 'sharelink:read sharelink:write');
  currentMs += 61_000;
  assert.equal(await client.getAccessToken(), 'token-2');
});

test('정규화는 허용된 두 수집원만 받고 ID 중복 제거·상한 적용 후 이미지와 일반 URL을 버린다', () => {
  const items = normalizeTossSnapshot([
    { kind: 'integrated-best', products: [product(1), product(2, { rank: 2 })] },
    { kind: 'today-special', products: [product(1), product(3, { rank: 2, endAt: '2026-09-12T23:59:59+09:00' })] },
  ], new Map([
    ['1', { linkType: 'all', shortUrl: 'https://toss.im/_m/abcDE' }],
    ['2', { linkType: 'all', shortUrl: 'https://toss.im/_m/fghIJ' }],
    ['3', { linkType: 'single', shortUrl: 'https://toss.im/_m/nope' }],
  ]), 2, new Date('2026-09-12T00:00:00Z'));
  assert.deepEqual(items, [
    { productId: '1', title: '토스 상품 1', priceAmount: 19900, source: 'integrated-best', rank: 1, endAt: null, sharelinkUrl: 'https://toss.im/_m/abcDE', linkType: 'all' },
    { productId: '2', title: '토스 상품 2', priceAmount: 19900, source: 'integrated-best', rank: 2, endAt: null, sharelinkUrl: 'https://toss.im/_m/fghIJ', linkType: 'all' },
  ]);
  assert.equal(JSON.stringify(items).includes('thumbnail'), false);
  assert.equal(JSON.stringify(items).includes('productUrl'), false);
  assert.throws(() => normalizeTossSnapshot([{ kind: 'category', products: [] }], new Map(), 10), /source/i);
});

test('하루특가 endAt을 ISO 시각으로 보존하고 만료 상품은 제외하며 베스트는 null을 전달한다', () => {
  const items = normalizeTossSnapshot([
    { kind: 'integrated-best', products: [product(1)] },
    { kind: 'today-special', products: [
      product(2, { endAt: '2026-09-12T23:59:59+09:00' }),
      product(3, { rank: 2, endAt: '2026-09-12T08:59:59+09:00' }),
    ] },
  ], new Map([
    ['1', { linkType: 'all', shortUrl: 'https://toss.im/_m/best' }],
    ['2', { linkType: 'all', shortUrl: 'https://toss.im/_m/today' }],
    ['3', { linkType: 'all', shortUrl: 'https://toss.im/_m/expired' }],
  ]), 10, new Date('2026-09-12T00:00:00.000Z'));

  assert.deepEqual(items.map(({ productId, endAt }) => ({ productId, endAt })), [
    { productId: '1', endAt: null },
    { productId: '2', endAt: '2026-09-12T14:59:59.000Z' },
  ]);
});

test('하루특가는 누락·비문자열·잘못된 날짜 endAt 항목을 snapshot에서 제외한다', () => {
  const items = normalizeTossSnapshot([
    { kind: 'integrated-best', products: [product(1)] },
    { kind: 'today-special', products: [
      product(2, { rank: 1 }),
      product(3, { rank: 2, endAt: Date.parse('2026-09-13T00:00:00Z') }),
      product(4, { rank: 3, endAt: '2026-09-31T00:00:00Z' }),
      product(5, { rank: 4, endAt: '2026-09-13T00:00:00Z' }),
    ] },
  ], new Map([1, 2, 3, 4, 5].map((id) => [
    String(id), { linkType: 'all', shortUrl: `https://toss.im/_m/link${id}` },
  ])), 10, new Date('2026-09-12T00:00:00Z'));

  assert.deepEqual(items.map(({ productId, endAt }) => ({ productId, endAt })), [
    { productId: '1', endAt: null },
    { productId: '5', endAt: '2026-09-13T00:00:00.000Z' },
  ]);
});

test('두 수집원을 rank 순서로 deterministic round-robin하고 중복 제거 후 한 수집원으로 빈자리를 채운다', () => {
  const links = new Map([1, 2, 3, 4, 5].map((id) => [
    String(id), { linkType: 'all', shortUrl: `https://toss.im/_m/link${id}` },
  ]));
  const items = normalizeTossSnapshot([
    { kind: 'today-special', products: [
      product(4, { rank: 3, endAt: '2026-09-13T00:00:00Z' }),
      product(3, { rank: 1, endAt: '2026-09-13T00:00:00Z' }),
      product(2, { rank: 2, endAt: '2026-09-13T00:00:00Z' }),
    ] },
    { kind: 'integrated-best', products: [
      product(2, { rank: 2 }), product(1, { rank: 1 }), product(5, { rank: 3 }),
    ] },
  ], links, 5, new Date('2026-09-12T00:00:00Z'));

  assert.deepEqual(items.map(({ productId, source, rank }) => ({ productId, source, rank })), [
    { productId: '1', source: 'integrated-best', rank: 1 },
    { productId: '3', source: 'today-special', rank: 1 },
    { productId: '2', source: 'integrated-best', rank: 2 },
    { productId: '4', source: 'today-special', rank: 3 },
    { productId: '5', source: 'integrated-best', rank: 3 },
  ]);

  const bestOnly = normalizeTossSnapshot([
    { kind: 'integrated-best', products: [product(2, { rank: 2 }), product(1, { rank: 1 })] },
    { kind: 'today-special', products: [] },
  ], links, 2);
  assert.deepEqual(bestOnly.map(({ productId }) => productId), ['1', '2']);
});

test('공식 쉐어링크는 문서 예시의 정확한 HTTPS 호스트와 경로만 허용한다', () => {
  const source = [{ kind: 'integrated-best', products: [product(1)] }];
  for (const shortUrl of [
    'http://toss.im/_m/abcDE',
    'https://toss.im.evil.example/_m/abcDE',
    'https://sharelink.toss.im/_m/abcDE',
    'https://toss.im/not-sharelink/abcDE',
    'https://user@toss.im/_m/abcDE',
  ]) assert.throws(() => normalizeTossSnapshot(source, new Map([['1', { linkType: 'all', shortUrl }]]), 10), /sharelink/i);
});

test('수집기는 integrated-best/today-special endpoint만 조회하고 공식 linkType=all 링크만 전용 snapshot에 전달한다', async () => {
  const requests = [];
  let synced;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const parsed = new URL(url);
    assert.equal(options.redirect, 'error');
    if (parsed.hostname === 'oauth2.cert.toss.im') return jsonResponse({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 });
    assert.equal(options.headers.Authorization, 'Bearer mock-token');
    if (parsed.pathname.endsWith('/best-selling')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [product(1), product(2, { rank: 2 })] } });
    if (parsed.pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [product(1)] } });
    assert.equal(parsed.pathname, '/openapi/links');
    const id = JSON.parse(options.body).tacaItemId;
    return jsonResponse({ resultType: 'SUCCESS', success: { tacaItemId: id, publisherId: '550e8400-e29b-41d4-a716-446655440000', shortUrl: `https://toss.im/_m/link${id}`, originUrl: `https://toss.shopping/t/${id}?secret=not-stored` } });
  };
  const result = await runTossSharelinkCollector({
    runtime: enabledRuntime(),
    store: {
      async withTossSharelinkCollectionLease(worker) { return worker(); },
      async syncTossSharelinkSnapshot(items) { synced = items; return { upserted: items.length, ended: 0 }; },
    },
    fetchImpl,
    now: new Date('2026-09-12T00:00:00Z'),
  });
  assert.deepEqual(requests.filter(({ url }) => url.includes('/products/')).map(({ url }) => new URL(url).pathname), [
    '/openapi/products/best-selling', '/openapi/products/today-deals',
  ]);
  assert.equal(result.fetched, 2);
  assert.equal(synced.length, 2);
  assert.ok(synced.every((item) => item.linkType === 'all'));
  assert.equal(JSON.stringify(synced).includes('not-stored'), false);
});

test('서버가 size를 무시해도 source별 maxItems만 round-robin하며 성공 상한에서 링크 발급을 멈춘다', async () => {
  const linkIds = [];
  const productRequests = [];
  let synced;
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/token') return jsonResponse({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 });
    if (parsed.pathname.includes('/products/')) {
      productRequests.push(parsed.searchParams.get('size'));
      const start = parsed.pathname.endsWith('/best-selling') ? 1 : 10;
      return jsonResponse({ resultType: 'SUCCESS', success: { items: Array.from({ length: 5 }, (_, index) => product(
        start + index,
        { rank: index + 1, ...(start === 10 ? { endAt: '2026-09-13T00:00:00Z' } : {}) },
      )) } });
    }
    const id = JSON.parse(options.body).tacaItemId;
    linkIds.push(id);
    return jsonResponse({ resultType: 'SUCCESS', success: {
      tacaItemId: id,
      publisherId: '550e8400-e29b-41d4-a716-446655440000',
      shortUrl: `https://toss.im/_m/link${id}`,
    } });
  };

  await runTossSharelinkCollector({
    runtime: enabledRuntime({ maxItems: 2 }),
    store: {
      async withTossSharelinkCollectionLease(worker) { return worker(); },
      async syncTossSharelinkSnapshot(items) { synced = items; return { upserted: items.length, ended: 0 }; },
    },
    fetchImpl,
    now: new Date('2026-09-12T00:00:00Z'),
  });

  assert.deepEqual(productRequests, ['2', '2']);
  assert.deepEqual(linkIds, [1, 10]);
  assert.deepEqual(synced.map(({ productId }) => productId), ['1', '10']);
});


test('링크 발급의 코드 없는 공식 FAIL도 전체 수집을 즉시 실패시키고 기존 snapshot을 유지한다', async () => {
  const linkIds = [];
  let syncCalls = 0;
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/token') return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
    if (pathname.endsWith('/best-selling')) return jsonResponse({ resultType: 'SUCCESS', success: {
      items: [product(1), product(2, { rank: 2 })],
    } });
    if (pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: {
      items: [product(10, { endAt: '2026-09-13T00:00:00Z' }), product(11, { rank: 2, endAt: '2026-09-13T00:00:00Z' })],
    } });
    const id = JSON.parse(options.body).tacaItemId;
    linkIds.push(id);
    if (id === 1) return jsonResponse({
      resultType: 'FAIL', error: { reason: 'endpoint-specific restriction' },
    });
    return successfulLink(id);
  };

  await assert.rejects(runTossSharelinkCollector({
    runtime: enabledRuntime({ maxItems: 2 }),
    store: collectingStore(() => { syncCalls += 1; }),
    fetchImpl,
    now: new Date('2026-09-12T00:00:00Z'),
  }), /Toss links API returned an official failure/);
  assert.deepEqual(linkIds, [1]);
  assert.equal(syncCalls, 0);
});

test('OAuth·상품 목록 실패 또는 모든 링크 발급 실패로 snapshot이 비면 동기화하지 않아 기존 snapshot을 유지한다', async () => {
  for (const failure of ['oauth', 'products', 'all-links']) {
    let syncCalls = 0;
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/token') {
        if (failure === 'oauth') return jsonResponse({ error: 'invalid_client', error_description: 'raw-response-must-not-leak' }, { status: 401 });
        return jsonResponse({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 });
      }
      if (pathname.endsWith('/best-selling')) {
        if (failure === 'products') return jsonResponse({ resultType: 'FAIL', error: { errorCode: 'UPSTREAM_FAILED' } });
        return jsonResponse({ resultType: 'SUCCESS', success: { items: [product(1)] } });
      }
      if (pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
      return jsonResponse({ resultType: 'FAIL', error: { errorCode: 'LINK_FAILED' } });
    };
    const store = {
      async withTossSharelinkCollectionLease(worker) { return worker(); },
      async syncTossSharelinkSnapshot() { syncCalls += 1; },
    };

    await assert.rejects(
      runTossSharelinkCollector({ runtime: enabledRuntime(), store, fetchImpl }),
      /Toss (OAuth|products|links)/i,
    );
    assert.equal(syncCalls, 0);
  }
});

test('OFF이면 store/fetch를 건드리지 않고 enabled면 전용 lease/snapshot 계약을 요구한다', async () => {
  let touched = false;
  assert.deepEqual(await runTossSharelinkCollector({
    runtime: { enabled: false },
    store: null,
    fetchImpl: async () => { touched = true; },
  }), { enabled: false, fetched: 0, upserted: 0, ended: 0 });
  assert.equal(touched, false);
  await assert.rejects(() => runTossSharelinkCollector({ runtime: enabledRuntime(), store: {} }), /lease/i);
});

test('HTTP/JSON/공식 FAIL 오류를 거부하고 오류 메시지에 자격정보나 토큰을 넣지 않는다', async () => {
  for (const responseValue of [
    jsonResponse({}, { status: 500 }),
    jsonResponse({}, { contentType: 'text/html' }),
    jsonResponse({ resultType: 'FAIL', error: { errorCode: 'INVALID_ARGUMENT', reason: 'bad' } }),
    jsonResponse({ resultType: 'SUCCESS', resultCode: 'FAIL', success: { items: [] } }),
  ]) {
    const secret = 'never-leak-this-secret';
    const token = 'never-leak-this-token';
    const runtime = enabledRuntime({ clientSecret: secret });
    let call = 0;
    const client = createTossSharelinkClient({
      runtime,
      fetchImpl: async () => (++call === 1
        ? jsonResponse({ access_token: token, token_type: 'Bearer', expires_in: 3600 })
        : responseValue),
    });
    await assert.rejects(client.fetchProducts(TOSS_SOURCES[0]), (error) => {
      assert.doesNotMatch(error.message, new RegExp(`${secret}|${token}`));
      return true;
    });
  }
});

test('429와 5xx만 최대 3회 재시도하고 Retry-After delta-seconds를 우선한다', async () => {
  for (const status of [429, 503]) {
    const delays = [];
    let apiCalls = 0;
    const client = createTossSharelinkClient({
      runtime: enabledRuntime(),
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      fetchImpl: async (url) => {
        if (new URL(url).pathname === '/token') {
          return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
        }
        apiCalls += 1;
        if (apiCalls < 3) return jsonResponse({}, { status, headers: { 'retry-after': '2' } });
        return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
      },
    });
    assert.deepEqual(await client.fetchProducts('integrated-best'), []);
    assert.equal(apiCalls, 3);
    assert.deepEqual(delays, status === 429 ? [2000, 2000] : [50, 100]);
  }
});

test('HTTP 200 공식 FAIL errorCode 500도 요청 loop 안에서 지수 백오프로 재시도해 복구한다', async () => {
  const delays = [];
  let apiCalls = 0;
  const client = createTossSharelinkClient({
    runtime: enabledRuntime(),
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/token') {
        return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
      }
      apiCalls += 1;
      if (apiCalls < 3) return jsonResponse({
        resultType: 'FAIL', error: { errorCode: '500', reason: 'temporary server error' },
      });
      return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
    },
  });

  assert.deepEqual(await client.fetchProducts('integrated-best'), []);
  assert.equal(apiCalls, 3);
  assert.deepEqual(delays, [50, 100]);
});

test('HTTP 200 공식 FAIL errorCode 500이 3회 소진되면 collector 전체를 실패시키고 snapshot을 보호한다', async () => {
  let linkCalls = 0;
  let syncCalls = 0;
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/token') return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
    if (pathname.endsWith('/best-selling')) return jsonResponse({ resultType: 'SUCCESS', success: {
      items: [product(1), product(2, { rank: 2 })],
    } });
    if (pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
    const id = JSON.parse(options.body).tacaItemId;
    if (id === 1) return successfulLink(id);
    linkCalls += 1;
    return jsonResponse({ resultType: 'FAIL', error: { errorCode: '500', reason: 'server error' } });
  };

  await assert.rejects(runTossSharelinkCollector({
    runtime: enabledRuntime({ maxItems: 2 }),
    store: collectingStore(() => { syncCalls += 1; }),
    fetchImpl,
    sleep: async () => {},
  }), /Toss links API returned an official failure \(500\)/);
  assert.equal(linkCalls, 3);
  assert.equal(syncCalls, 0);
});

test('HTTP-date Retry-After는 clock 기준 남은 시간으로 제한해 적용한다', async () => {
  const delays = [];
  let apiCalls = 0;
  const currentMs = Date.parse('2026-09-12T00:00:00Z');
  const client = createTossSharelinkClient({
    runtime: enabledRuntime(),
    clock: () => currentMs,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/token') {
        return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
      }
      apiCalls += 1;
      if (apiCalls === 1) return jsonResponse({}, {
        status: 429, headers: { 'retry-after': 'Sat, 12 Sep 2026 00:00:03 GMT' },
      });
      return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
    },
  });

  assert.deepEqual(await client.fetchProducts('integrated-best'), []);
  assert.deepEqual(delays, [3000]);
});

test('HTTP 400/401/403은 재시도하지 않는다', async () => {
  for (const status of [400, 401, 403]) {
    let apiCalls = 0;
    const client = createTossSharelinkClient({
      runtime: enabledRuntime(),
      sleep: async () => assert.fail('must not sleep'),
      fetchImpl: async (url) => {
        if (new URL(url).pathname === '/token') {
          return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
        }
        apiCalls += 1;
        return jsonResponse({}, { status });
      },
    });
    await assert.rejects(client.fetchProducts('integrated-best'), /HTTP request failed/);
    assert.equal(apiCalls, 1);
  }
});

test('부분 링크 성공 뒤 공식 전역 FAIL은 상품 제한으로 오인하지 않고 snapshot을 보호한다', async () => {
  for (const errorCode of [
    'INVALID_ARGUMENT',
    'SHARELINK_OPENAPI_ACCESS_DENIED',
    'SHARELINK_OPENAPI_QUOTA_EXCEEDED',
    'OPENAPI_SUB_TAG_NOT_FOUND',
    'PUBLISHER_NOT_ALLOWED',
    'UPSTREAM_FAILED',
    'BAD_REQUEST',
    'FUTURE_UNKNOWN_CODE',
  ]) {
    let syncCalls = 0;
    let failedLinkCalls = 0;
    const fetchImpl = async (url, options) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/token') return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
      if (pathname.endsWith('/best-selling')) return jsonResponse({ resultType: 'SUCCESS', success: {
        items: [product(1), product(2, { rank: 2 })],
      } });
      if (pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
      const id = JSON.parse(options.body).tacaItemId;
      if (id === 1) return successfulLink(id);
      failedLinkCalls += 1;
      return jsonResponse({ resultType: 'FAIL', error: { errorCode, reason: 'global failure' } });
    };

    await assert.rejects(runTossSharelinkCollector({
      runtime: enabledRuntime({ maxItems: 2 }),
      store: collectingStore(() => { syncCalls += 1; }),
      fetchImpl,
      sleep: async () => {},
    }), /Toss links API returned an official failure/);
    assert.equal(failedLinkCalls, 1, errorCode);
    assert.equal(syncCalls, 0, errorCode);
  }
});

test('부분 링크 성공 뒤 401/429/5xx 전역 오류는 snapshot을 동기화하지 않는다', async () => {
  for (const status of [401, 429, 500]) {
    let syncCalls = 0;
    let failedLinkCalls = 0;
    const fetchImpl = async (url, options) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/token') return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
      if (pathname.endsWith('/best-selling')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [product(1), product(2, { rank: 2 })] } });
      if (pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
      const id = JSON.parse(options.body).tacaItemId;
      if (id === 1) return successfulLink(id);
      failedLinkCalls += 1;
      return jsonResponse({}, { status, headers: { 'retry-after': '0' } });
    };
    await assert.rejects(runTossSharelinkCollector({
      runtime: enabledRuntime({ maxItems: 2 }),
      store: collectingStore(() => { syncCalls += 1; }),
      fetchImpl,
      sleep: async () => {},
    }), /Toss links API HTTP request failed/);
    assert.equal(syncCalls, 0);
    assert.equal(failedLinkCalls, status === 401 ? 1 : 3);
  }
});

test('같은 runtime collector poll은 OAuth token을 재사용하고 snapshot now와 별도 clock으로 만료시킨다', async () => {
  const runtime = enabledRuntime({ maxItems: 1 });
  let currentMs = Date.parse('2026-09-12T00:00:00Z');
  let tokenCalls = 0;
  const clock = () => currentMs;
  const sleep = async () => {};
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/token') {
      tokenCalls += 1;
      return jsonResponse({ access_token: `token-${tokenCalls}`, token_type: 'Bearer', expires_in: 120 });
    }
    if (pathname.endsWith('/best-selling')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [product(1)] } });
    if (pathname.endsWith('/today-deals')) return jsonResponse({ resultType: 'SUCCESS', success: { items: [] } });
    return successfulLink(JSON.parse(options.body).tacaItemId);
  };
  const options = {
    runtime, store: collectingStore(), fetchImpl, clock, sleep,
    now: new Date('2000-01-01T00:00:00Z'),
  };
  await runTossSharelinkCollector(options);
  await runTossSharelinkCollector(options);
  assert.equal(tokenCalls, 1);
  currentMs += 61_000;
  await runTossSharelinkCollector(options);
  assert.equal(tokenCalls, 2);
});

test('OAuth token 요청은 single-flight이고 실패한 pending은 다음 요청에서 복구한다', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = createTossSharelinkClient({
    runtime: enabledRuntime(),
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return jsonResponse({ access_token: 'shared', token_type: 'Bearer', expires_in: 3600 });
    },
  });
  const first = client.getAccessToken();
  const second = client.getAccessToken();
  release();
  assert.deepEqual(await Promise.all([first, second]), ['shared', 'shared']);
  assert.equal(calls, 1);

  let recoveryCalls = 0;
  const recovering = createTossSharelinkClient({
    runtime: enabledRuntime(),
    fetchImpl: async () => {
      recoveryCalls += 1;
      if (recoveryCalls === 1) throw new Error('raw network detail');
      return jsonResponse({ access_token: 'recovered', token_type: 'Bearer', expires_in: 3600 });
    },
  });
  await assert.rejects(recovering.getAccessToken(), /request failed/);
  assert.equal(await recovering.getAccessToken(), 'recovered');
  assert.equal(recoveryCalls, 2);
});

test('OAuth expires_in은 양의 safe integer이며 30일 이하만 허용한다', async () => {
  for (const expiresIn of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER, 30 * 24 * 60 * 60 + 1]) {
    const client = createTossSharelinkClient({
      runtime: enabledRuntime(),
      fetchImpl: async () => jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: expiresIn }),
    });
    await assert.rejects(client.getAccessToken(), /invalid token response/);
  }
});

test('oversized Content-Length는 body를 읽기 전에 취소한다', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull() {},
    cancel() { cancelled = true; },
  });
  let calls = 0;
  const client = createTossSharelinkClient({
    runtime: enabledRuntime(),
    fetchImpl: async () => (++calls === 1
      ? jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 })
      : new Response(body, { headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_RESPONSE_BYTES + 1),
      } })),
  });
  await assert.rejects(client.fetchProducts('integrated-best'), /too large/);
  assert.equal(cancelled, true);
});

test('status/content-type 조기 거절도 가능한 response body를 취소한다', async () => {
  for (const responseOptions of [
    { status: 401, headers: { 'content-type': 'application/json' } },
    { status: 200, headers: { 'content-type': 'text/html' } },
  ]) {
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
    let calls = 0;
    const client = createTossSharelinkClient({
      runtime: enabledRuntime(),
      fetchImpl: async () => (++calls === 1
        ? jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 })
        : new Response(body, responseOptions)),
    });
    await assert.rejects(client.fetchProducts('integrated-best'));
    assert.equal(cancelled, true);
  }
});

test('2MiB 초과 chunked 응답은 즉시 취소한다', async () => {
  let cancelled = false;
  const chunk = new Uint8Array(128 * 1024).fill(97);
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  let call = 0;
  const client = createTossSharelinkClient({
    runtime: enabledRuntime(),
    fetchImpl: async () => (++call === 1
      ? jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 })
      : new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })),
  });
  await assert.rejects(client.fetchProducts('integrated-best'), /too large/i);
  assert.equal(cancelled, true);
});
