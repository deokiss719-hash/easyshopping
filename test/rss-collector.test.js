const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');
const { parseFeed, runRssCollector } = require('../src/rss-collector');

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
