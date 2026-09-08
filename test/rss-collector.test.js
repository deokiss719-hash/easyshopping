const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');
const {
  parseFeed,
  runRssCollector,
  safeImageUrl,
  fetchOpenGraphImage,
} = require('../src/rss-collector');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>허용된 핫딜 피드</title>
    <item>
      <guid isPermaLink="false">deal-101</guid>
      <title><![CDATA[무선 키보드 특가 19,900원]]></title>
      <link>https://feed.example/deals/101</link>
      <description><![CDATA[무료배송]]></description>
      <pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

test('RSS 항목을 DealStore 입력 형식으로 변환한다', () => {
  const deals = parseFeed(RSS, {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
  });

  assert.equal(deals.length, 1);
  assert.deepEqual(deals[0], {
    source: 'approved-feed',
    sourceItemId: 'deal-101',
    title: '무선 키보드 특가 19,900원',
    originalUrl: 'https://feed.example/deals/101',
    priceAmount: 19900,
    currency: 'KRW',
    merchant: null,
    category: '디지털/가전',
    imageUrl: null,
    publishedAt: '2026-09-08T08:10:00.000Z',
    rawPayload: {
      feedUrl: 'https://feed.example/rss.xml',
      description: '무료배송',
    },
  });
});

test('같은 호스트의 HTTP 원문 URL을 HTTPS로 정규화한다', () => {
  const xml = `<rss><channel><item><title>상품 1,000원</title><link>http://feed.example/deals/1</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item></channel></rss>`;
  const [deal] = parseFeed(xml, {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
  });
  assert.equal(deal.originalUrl, 'https://feed.example/deals/1');
});

test('RSS 링크의 XML 기본 엔티티를 정상 URL 문자로 복원한다', () => {
  const xml = `<rss><channel><item><title>상품 1,000원</title><link>https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&amp;no=123</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item></channel></rss>`;
  const [deal] = parseFeed(xml, {
    source: 'ppomppu',
    feedUrl: 'https://www.ppomppu.co.kr/rss.php?id=ppomppu',
  });
  assert.equal(deal.originalUrl, 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123');
});

test('괄호 안 상품가를 포인트 금액보다 우선하고 원 없는 배송 표기도 인식한다', () => {
  const xml = `<rss><channel>
    <item><title>[11번가] 김치찜 5개입 (15,200/무료)</title><link>https://feed.example/1</link><guid>p1</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>[롯데온] 커피믹스 400T + 네이버페이 2000원 (56,660원/무료)</title><link>https://feed.example/2</link><guid>p2</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const deals = parseFeed(xml, { source: 'approved-feed', feedUrl: 'https://feed.example/rss.xml' });
  assert.deepEqual(deals.map((deal) => deal.priceAmount), [15200, 56660]);
});

test('제목 앞 대괄호에서 쇼핑몰명을 추출한다', () => {
  const xml = `<rss><channel><item><title>[G마켓] 키보드 19,900원</title><link>https://feed.example/2</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item></channel></rss>`;
  const [deal] = parseFeed(xml, {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
  });
  assert.equal(deal.merchant, 'G마켓');
});

test('위험하거나 필수값이 잘못된 RSS 항목만 건너뛴다', () => {
  const xml = `<rss><channel>
    <item><title>정상 상품 3,000원</title><link>https://feed.example/ok</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item>
    <item><title>위험 상품</title><link>javascript:alert(1)</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item>
    <item><title>날짜 오류</title><link>https://feed.example/bad-date</link><pubDate>not-a-date</pubDate></item>
  </channel></rss>`;
  const deals = parseFeed(xml, {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
  });
  assert.equal(deals.length, 1);
  assert.equal(deals[0].title, '정상 상품 3,000원');
});

async function makeStore() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: 'strpos',
    args: [DataType.text, DataType.text],
    returns: DataType.integer,
    implementation: (haystack, needle) => haystack.indexOf(needle) + 1,
  });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createDealStore(pool) };
}

test('허용 목록 밖의 피드 호스트와 리다이렉트를 거부한다', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    runRssCollector({
      source: 'approved-feed',
      feedUrl: 'https://evil.example/rss.xml',
      allowedHosts: ['feed.example'],
      store: { upsert: async () => {} },
      fetchImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, text: async () => RSS };
      },
    }),
    /not allowed/,
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    runRssCollector({
      source: 'approved-feed',
      feedUrl: 'https://feed.example/rss.xml',
      allowedHosts: ['feed.example'],
      store: { upsert: async () => {} },
      fetchImpl: async () => ({
        ok: false,
        status: 302,
        headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://evil.example/feed' : null },
      }),
    }),
    /not allowed/,
  );
});

test('허용 크기를 넘는 RSS 응답을 파싱 전에 거부한다', async () => {
  await assert.rejects(
    runRssCollector({
      source: 'approved-feed',
      feedUrl: 'https://feed.example/rss.xml',
      allowedHosts: ['feed.example'],
      maxBytes: 1024,
      store: { upsert: async () => {} },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-length' ? '2048' : null },
        text: async () => RSS,
      }),
    }),
    /too large/,
  );
});

test('비스트림 text fallback의 크기 초과도 피드와 페이지 본문을 취소한다', async () => {
  let feedCancelled = false;
  await assert.rejects(
    runRssCollector({
      source: 'approved-feed',
      feedUrl: 'https://feed.example/rss',
      allowedHosts: ['feed.example'],
      maxBytes: 1024,
      store: { upsert: async () => ({ imageUrl: null }) },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { cancel: async () => { feedCancelled = true; } },
        text: async () => 'x'.repeat(1025),
      }),
    }),
    /too large/,
  );
  assert.equal(feedCancelled, true);

  let pageCancelled = false;
  await assert.rejects(
    fetchOpenGraphImage('https://feed.example/item', {
      allowedHosts: ['feed.example'],
      maxBytes: 1024,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
        body: { cancel: async () => { pageCancelled = true; } },
        text: async () => 'x'.repeat(1025),
      }),
    }),
    /too large/,
  );
  assert.equal(pageCancelled, true);
});

test('스트리밍 응답 초과 시 잠긴 스트림 오류 대신 크기 오류를 반환한다', async () => {
  const body = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(700);
      yield Buffer.alloc(700);
    },
    async cancel() {
      throw new Error('Invalid state: ReadableStream is locked');
    },
  };

  await assert.rejects(
    runRssCollector({
      source: 'approved-feed',
      feedUrl: 'https://feed.example/rss.xml',
      allowedHosts: ['feed.example'],
      maxBytes: 1024,
      store: { upsert: async () => {} },
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, body }),
    }),
    /Feed response is too large/,
  );
});

test('RSS 이미지와 설명 안의 이미지를 우선순위에 따라 안전하게 추출한다', () => {
  const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>모니터 10,000원</title><link>https://feed.example/1</link><guid>img1</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate><media:content url="https://cdn.example/monitor.jpg" medium="image" /></item>
    <item><title>라면 5,000원</title><link>https://feed.example/2</link><guid>img2</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>상품</p><img src="https://cdn.example/ramen.jpg">]]></description></item>
  </channel></rss>`;
  const deals = parseFeed(xml, {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedImageHosts: ['cdn.example'],
  });

  assert.equal(deals[0].imageUrl, 'https://cdn.example/monitor.jpg');
  assert.equal(deals[1].imageUrl, 'https://cdn.example/ramen.jpg');
});

test('외부 이미지 URL은 HTTPS 허용 호스트와 그 하위 호스트만 허용한다', () => {
  assert.equal(safeImageUrl('https://cdn.ppomppu.co.kr/item.jpg'), 'https://cdn.ppomppu.co.kr/item.jpg');
  assert.equal(safeImageUrl('https://evil.example/item.jpg'), null);
  assert.equal(safeImageUrl('https://evilppomppu.co.kr/item.jpg'), null);
  assert.equal(safeImageUrl('http://cdn.example/item.jpg'), null);
  assert.equal(safeImageUrl('javascript:alert(1)'), null);
  assert.equal(safeImageUrl('https://127.0.0.1/item.jpg'), null);
  assert.equal(safeImageUrl('https://user:pass@cdn.example/item.jpg'), null);
  assert.equal(safeImageUrl('https://cdn.example:8443/item.jpg'), null);
});

test('허용된 원문 호스트에서만 og:image를 제한적으로 조회한다', async () => {
  let calls = 0;
  const image = await fetchOpenGraphImage('https://feed.example/deals/1', {
    allowedHosts: ['feed.example'],
    allowedImageHosts: ['cdn.example'],
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
        text: async () => '<html><head><meta property="og:image" content="https://cdn.example/item.jpg"></head></html>',
      };
    },
  });
  assert.equal(image, 'https://cdn.example/item.jpg');
  assert.equal(calls, 1);

  await assert.rejects(
    fetchOpenGraphImage('https://evil.example/deals/1', {
      allowedHosts: ['feed.example'],
      fetchImpl: async () => { throw new Error('must not fetch'); },
    }),
    /not allowed/,
  );
});

test('og:image 페이지 리다이렉트와 응답 본문을 안전하게 처리한다', async () => {
  let cancelled = false;
  await assert.rejects(
    fetchOpenGraphImage('https://feed.example/deals/1', {
      allowedHosts: ['feed.example'],
      fetchImpl: async () => ({
        ok: false,
        status: 302,
        headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://evil.example/item' : null },
        body: { cancel: async () => { cancelled = true; } },
      }),
    }),
    /not allowed/,
  );
  assert.equal(cancelled, true);
});

test('피드 리다이렉트·HTTP 오류의 모든 분기에서 응답 본문을 취소한다', async () => {
  const scenarios = [
    { status: 302, location: null, error: /missing Location/, expectedCancels: 1 },
    { status: 302, location: 'https://feed.example/rss', error: /Too many feed redirects/, expectedCancels: 4 },
    { status: 503, location: null, error: /HTTP 503/, expectedCancels: 1 },
  ];

  for (const scenario of scenarios) {
    let cancels = 0;
    await assert.rejects(
      runRssCollector({
        source: 'approved-feed',
        feedUrl: 'https://feed.example/rss',
        allowedHosts: ['feed.example'],
        store: { upsert: async () => ({ imageUrl: null }) },
        fetchImpl: async () => ({
          ok: false,
          status: scenario.status,
          headers: { get: (name) => name.toLowerCase() === 'location' ? scenario.location : null },
          body: { cancel: async () => { cancels += 1; } },
        }),
      }),
      scenario.error,
    );
    assert.equal(cancels, scenario.expectedCancels);
  }
});

test('og:image 페이지의 누락·과다 리다이렉트와 HTTP 오류도 본문을 취소한다', async () => {
  const scenarios = [
    { status: 302, location: null, error: /missing Location/, expectedCancels: 1 },
    { status: 302, location: 'https://feed.example/item', error: /Too many page redirects/, expectedCancels: 4 },
    { status: 503, location: null, result: null, expectedCancels: 1 },
  ];

  for (const scenario of scenarios) {
    let cancels = 0;
    const operation = fetchOpenGraphImage('https://feed.example/item', {
      allowedHosts: ['feed.example'],
      fetchImpl: async () => ({
        ok: false,
        status: scenario.status,
        headers: { get: (name) => name.toLowerCase() === 'location' ? scenario.location : null },
        body: { cancel: async () => { cancels += 1; } },
      }),
    });
    if (scenario.error) await assert.rejects(operation, scenario.error);
    else assert.equal(await operation, scenario.result);
    assert.equal(cancels, scenario.expectedCancels);
  }
});

test('og:image HTML 크기와 전체 요청 시간을 제한한다', async () => {
  await assert.rejects(
    fetchOpenGraphImage('https://feed.example/deals/large', {
      allowedHosts: ['feed.example'],
      maxBytes: 1024,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-length' ? '2048' : 'text/html' },
        text: async () => '',
      }),
    }),
    /Page response is too large/,
  );

  await assert.rejects(
    fetchOpenGraphImage('https://feed.example/deals/slow', {
      allowedHosts: ['feed.example'],
      timeoutMs: 10,
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
    /timeout/i,
  );
});

test('비 HTML 페이지 응답은 본문을 취소하고 이미지로 사용하지 않는다', async () => {
  let cancelled = false;
  const image = await fetchOpenGraphImage('https://feed.example/deals/file', {
    allowedHosts: ['feed.example'],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/octet-stream' : null },
      body: { cancel: async () => { cancelled = true; } },
    }),
  });

  assert.equal(image, null);
  assert.equal(cancelled, true);
});

test('이미지 보조 수집은 동시성 상한을 지키고 실패 URL을 재조회하지 않는다', async () => {
  const items = Array.from({ length: 4 }, (_, index) => `
    <item><title>상품 ${index}</title><link>https://feed.example/${index}</link><guid>${index}</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
  const feed = `<rss><channel>${items}</channel></rss>`;
  const imageAttemptCache = new Map();
  let active = 0;
  let maxActive = 0;
  let pageRequests = 0;
  const store = {
    upsert: async () => ({ imageUrl: null }),
    markEndedBefore: async () => 0,
  };
  const pageFetchImpl = async () => {
    pageRequests += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
      text: async () => '<html><head></head></html>',
    };
  };
  const options = {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedHosts: ['feed.example'],
    store,
    enrichImages: true,
    imageConcurrency: 2,
    imageAttemptCache,
    imageRetryMs: 60_000,
    fetchImpl: async () => ({
      ok: true, status: 200, headers: { get: () => null }, text: async () => feed,
    }),
    pageFetchImpl,
  };

  await runRssCollector(options);
  await runRssCollector(options);

  assert.equal(maxActive, 2);
  assert.equal(pageRequests, 4);
  assert.equal(imageAttemptCache.size, 4);
});

test('성공적인 수집 뒤 출처의 TTL 초과 상품을 종료 처리한다', async () => {
  const { pool, store } = await makeStore();
  await store.upsert({
    source: 'approved-feed',
    sourceItemId: 'old-deal',
    title: '오래된 상품',
    originalUrl: 'https://feed.example/old',
    publishedAt: '2026-09-01T00:00:00.000Z',
  });

  const result = await runRssCollector({
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedHosts: ['feed.example'],
    store,
    now: () => new Date('2026-09-10T00:00:00.000Z'),
    maxAgeMs: 72 * 60 * 60 * 1000,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => RSS }),
  });
  const active = await store.list({ source: 'approved-feed' });

  assert.equal(result.ended, 1);
  assert.equal(active.total, 1);
  assert.equal(active.items[0].sourceItemId, 'deal-101');
  await pool.end();
});

test('RSS를 가져와 저장하고 재수집해도 중복을 만들지 않는다', async () => {
  const { pool, store } = await makeStore();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      text: async () => RSS,
    };
  };

  const options = {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedHosts: ['feed.example'],
    store,
    fetchImpl,
  };
  const first = await runRssCollector(options);
  const second = await runRssCollector(options);
  const listed = await store.list({ includeEnded: true });

  assert.deepEqual(first, { fetched: 1, stored: 1, ended: 0 });
  assert.deepEqual(second, { fetched: 1, stored: 1, ended: 0 });
  assert.equal(requests, 2);
  assert.equal(listed.total, 1);
  await pool.end();
});
