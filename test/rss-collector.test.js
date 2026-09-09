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
    merchantUrl: null,
    sourceImageUrl: null,
    imageUrl: null,
    imageStatus: 'missing_merchant_url',
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

test('RSS가 명시한 실제 판매처 URL만 저장하고 상품명으로 URL을 추측하지 않는다', () => {
  const xml = `<rss><channel>
    <item><title>[공식몰] 정확한 상품</title><link>https://feed.example/1</link><guid>url1</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[광고 https://analytics.example/click?id=1 판매처 https://shop.example/products/123]]></description></item>
    <item><title>[G마켓] 검색하면 나올 법한 상품</title><link>https://feed.example/2</link><guid>url2</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate><description>판매처 링크 없음</description></item>
  </channel></rss>`;
  const deals = parseFeed(xml, {
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedMerchantHosts: ['shop.example'],
  });
  assert.equal(deals[0].merchantUrl, 'https://shop.example/products/123');
  assert.equal(deals[0].imageStatus, 'pending');
  assert.equal(deals[1].merchantUrl, null);
  assert.equal(deals[1].imageStatus, 'missing_merchant_url');
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

  assert.equal(deals[0].imageUrl, null);
  assert.equal(deals[0].sourceImageUrl, 'https://cdn.example/monitor.jpg');
  assert.equal(deals[0].imageStatus, 'missing_merchant_url');
  assert.equal(deals[1].imageUrl, null);
  assert.equal(deals[1].sourceImageUrl, 'https://cdn.example/ramen.jpg');
  assert.equal(deals[1].imageStatus, 'missing_merchant_url');
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

test('원문 이미지 조회는 뽐뿌가 허용하는 브라우저 호환 요청 헤더를 보낸다', async () => {
  let requestHeaders;
  const image = await fetchOpenGraphImage('https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1', {
    allowedHosts: ['www.ppomppu.co.kr'],
    allowedImageHosts: ['ppomppu.co.kr'],
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      const userAgent = requestHeaders?.['User-Agent'] || '';
      if (!userAgent.startsWith('Mozilla/5.0')) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => null },
          body: { cancel: async () => {} },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html; charset=euc-kr' : null },
        text: async () => '<meta property="og:image" content="https://cdn4.ppomppu.co.kr/item.jpg">',
      };
    },
  });

  assert.equal(image, 'https://cdn4.ppomppu.co.kr/item.jpg');
  assert.match(requestHeaders['User-Agent'], /^Mozilla\/5\.0 .* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  assert.match(requestHeaders.Accept, /text\/html/);
  assert.equal(requestHeaders.Referer, 'https://www.ppomppu.co.kr/');
  assert.equal(requestHeaders['Sec-Fetch-Dest'], 'document');
  assert.equal(requestHeaders['Sec-Fetch-Mode'], 'navigate');
  assert.equal(requestHeaders['Upgrade-Insecure-Requests'], '1');
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

test('원문 이미지 조회 실패 원인을 민감정보 없이 구조화해 진단한다', async () => {
  const diagnostics = [];
  const onDiagnostic = (detail) => diagnostics.push(detail);

  assert.equal(await fetchOpenGraphImage('https://feed.example/deals/403?token=secret', {
    allowedHosts: ['feed.example'],
    onDiagnostic,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
      body: { cancel: async () => {} },
    }),
  }), null);

  assert.equal(await fetchOpenGraphImage('https://feed.example/deals/no-image', {
    allowedHosts: ['feed.example'],
    onDiagnostic,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => '<html><head></head></html>',
    }),
  }), null);

  await assert.rejects(fetchOpenGraphImage('https://feed.example/deals/large', {
    allowedHosts: ['feed.example'],
    maxBytes: 1024,
    onDiagnostic,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => {
        if (name.toLowerCase() === 'content-type') return 'text/html';
        if (name.toLowerCase() === 'content-length') return '2048';
        return null;
      } },
      body: { cancel: async () => {} },
    }),
  }), /too large/);

  await assert.rejects(fetchOpenGraphImage('https://feed.example/deals/slow', {
    allowedHosts: ['feed.example'],
    timeoutMs: 5,
    onDiagnostic,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  }), /timeout/i);

  await assert.rejects(fetchOpenGraphImage('https://feed.example/deals/redirect', {
    allowedHosts: ['feed.example'],
    onDiagnostic,
    fetchImpl: async () => ({
      ok: false,
      status: 302,
      headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://evil.example/private' : null },
      body: { cancel: async () => {} },
    }),
  }), /not allowed/);

  assert.deepEqual(diagnostics.map((entry) => entry.reason), [
    'http_status',
    'og_image_missing',
    'response_too_large',
    'timeout',
    'hostname_validation_failed',
  ]);
  assert.deepEqual(diagnostics[0], {
    reason: 'http_status',
    hostname: 'feed.example',
    finalRedirectHostname: 'feed.example',
    httpStatus: 403,
    contentType: 'text/html',
    timeout: false,
    responseTooLarge: false,
    ogImageMissing: false,
    hostnameValidationFailed: false,
  });
  assert.equal(diagnostics[1].ogImageMissing, true);
  assert.equal(diagnostics[2].responseTooLarge, true);
  assert.equal(diagnostics[3].timeout, true);
  assert.equal(diagnostics[4].finalRedirectHostname, 'evil.example');
  assert.equal(diagnostics[4].hostnameValidationFailed, true);

  assert.equal(await fetchOpenGraphImage('https://feed.example/deals/file', {
    allowedHosts: ['feed.example'],
    onDiagnostic,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/octet-stream' : null },
      body: { cancel: async () => {} },
    }),
  }), null);
  assert.equal(diagnostics[5].reason, 'content_type');
  assert.equal(diagnostics[5].contentType, 'application/octet-stream');
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|cookie|authorization/i);
});

test('이미지 보조 수집 실패 로그는 최소 상품 식별자와 안전한 진단 정보만 남긴다', async () => {
  const warnings = [];
  const store = {
    upsert: async () => ({ imageUrl: null }),
    markEndedBefore: async () => 0,
  };

  await runRssCollector({
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedHosts: ['feed.example'],
    store,
    enrichImages: true,
    imageAttemptCache: new Map(),
    logger: { warn: (message, detail) => warnings.push({ message, detail }) },
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => RSS }),
    pageFetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
      body: { cancel: async () => {} },
    }),
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, '이미지 보조 수집 실패');
  assert.match(warnings[0].detail.itemId, /^url-sha256:[a-f0-9]{16}$/);
  assert.deepEqual(warnings[0].detail, {
    source: 'approved-feed',
    itemId: warnings[0].detail.itemId,
    hostname: 'feed.example',
    finalRedirectHostname: 'feed.example',
    httpStatus: 403,
    contentType: 'text/html',
    timeout: false,
    responseTooLarge: false,
    ogImageMissing: false,
    hostnameValidationFailed: false,
    reason: 'http_status',
  });
  assert.doesNotMatch(JSON.stringify(warnings), /무료배송|authorization|cookie/i);
});

test('URL 형태 상품 식별자는 쿼리 비밀값 대신 비가역 참조값으로 기록한다', async () => {
  const warnings = [];
  const secretFeed = `<rss><channel><item><title>상품 1,000원</title><link>https://feed.example/item?token=TOP_SECRET</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item></channel></rss>`;

  await runRssCollector({
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedHosts: ['feed.example'],
    store: { upsert: async () => ({ imageUrl: null }), markEndedBefore: async () => 0 },
    enrichImages: true,
    imageAttemptCache: new Map(),
    logger: { warn: (_message, detail) => warnings.push(detail) },
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => secretFeed }),
    pageFetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: () => 'text/html' },
      body: { cancel: async () => {} },
    }),
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0].itemId, /^url-sha256:[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(warnings), /TOP_SECRET|token=|https:\/\//i);

  const ppomppuWarnings = [];
  const ppomppuFeed = `<rss><channel><item><title>상품 1,000원</title><link>https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&amp;no=123</link><pubDate>Tue, 08 Sep 2026 08:10:00 GMT</pubDate></item></channel></rss>`;
  await runRssCollector({
    source: 'ppomppu',
    feedUrl: 'https://www.ppomppu.co.kr/rss.php?id=ppomppu',
    allowedHosts: ['www.ppomppu.co.kr'],
    store: { upsert: async () => ({ imageUrl: null }), markEndedBefore: async () => 0 },
    enrichImages: true,
    imageAttemptCache: new Map(),
    logger: { warn: (_message, detail) => ppomppuWarnings.push(detail) },
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => ppomppuFeed }),
    pageFetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: () => 'text/html' },
      body: { cancel: async () => {} },
    }),
  });
  assert.equal(ppomppuWarnings[0].itemId, 'ppomppu:123');
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

test('고신뢰도 네이버 매칭만 원격 이미지와 판매 링크로 저장하고 통계를 반환한다', async () => {
  const stored = [];
  const feed = `<rss><channel>
    <item><title>[G마켓] 삼성전자 갤럭시 S25 256GB 블루 (1,099,000원/무료)</title><link>https://feed.example/1</link><guid>matched</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>[옥션] 정체 불명 상품 (10,000원/무료)</title><link>https://feed.example/2</link><guid>unresolved</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const productMatcher = {
    enabled: true,
    async match(candidate) {
      if (candidate.sourceItemId === 'matched') {
        return {
          status: 'matched',
          match: {
            merchantUrl: 'https://item.gmarket.co.kr/Item?goodscode=123',
            sourceImageUrl: 'https://shopping-phinf.pstatic.net/main_123/123.jpg',
            imageUrl: 'https://shopping-phinf.pstatic.net/main_123/123.jpg',
            imageStatus: 'ready',
            imageProvider: 'naver-shopping',
          },
        };
      }
      return { status: 'unresolved', reason: 'no_qualified_candidate' };
    },
  };

  const result = await runRssCollector({
    source: 'approved-feed',
    feedUrl: 'https://feed.example/rss.xml',
    allowedHosts: ['feed.example'],
    store: {
      upsert: async (candidate) => { stored.push(candidate); return candidate; },
      markEndedBefore: async () => 0,
    },
    productMatcher,
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => feed }),
  });

  assert.equal(stored[0].imageProvider, 'naver-shopping');
  assert.equal(stored[0].imageUrl, 'https://shopping-phinf.pstatic.net/main_123/123.jpg');
  assert.equal(stored[1].imageUrl, null);
  assert.equal(stored[1].merchantUrl, null);
  assert.deepEqual(result.matching, {
    searched: 2,
    matched: 1,
    unresolved: 1,
    failed: 0,
    imageUrls: 1,
    byMerchant: {
      'G마켓': { searched: 1, matched: 1, unresolved: 0, failed: 0 },
      '옥션': { searched: 1, matched: 0, unresolved: 1, failed: 0 },
    },
  });
});

test('RSS 판매처명이 객체 프로토타입 키여도 통계 객체를 오염시키지 않는다', async () => {
  const feed = `<rss><channel>
    <item><title>[__proto__] 안전성 확인 상품 (10,000원/무료)</title><link>https://feed.example/1</link><guid>proto</guid><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;

  try {
    const result = await runRssCollector({
      source: 'approved-feed',
      feedUrl: 'https://feed.example/rss.xml',
      allowedHosts: ['feed.example'],
      store: {
        upsert: async (candidate) => candidate,
        markEndedBefore: async () => 0,
      },
      productMatcher: {
        enabled: true,
        match: async () => ({ status: 'unresolved', reason: 'no_qualified_candidate' }),
      },
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => feed }),
    });

    assert.equal(Object.hasOwn(result.matching.byMerchant, '__proto__'), true);
    assert.deepEqual(result.matching.byMerchant.__proto__, {
      searched: 1, matched: 0, unresolved: 1, failed: 0,
    });
    assert.equal(Object.hasOwn(Object.prototype, 'searched'), false);
    assert.equal(Object.hasOwn(Object.prototype, 'unresolved'), false);
  } finally {
    delete Object.prototype.searched;
    delete Object.prototype.matched;
    delete Object.prototype.unresolved;
    delete Object.prototype.failed;
  }
});
