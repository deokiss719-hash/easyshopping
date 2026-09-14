const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RULIWEB_FEED_URL,
  parseRuliwebFeed,
  readRuliwebRuntime,
  runRuliwebCollector,
} = require('../src/ruliweb-collector');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>핫딜 게시판</title>
  <item>
    <title><![CDATA[[공식몰] 무선 키보드 19,900원]]></title>
    <link>https://bbs.ruliweb.com/market/board/1020/read/123456</link>
    <category>PC</category>
    <description><![CDATA[작성자 개인정보를 저장하면 안 됨 <img src="https://i2.ruliweb.com/img/26/09/item.jpg">]]></description>
    <pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[[스토어] 가격 미정 상품]]></title>
    <link>https://bbs.ruliweb.com/market/board/1020/read/123457</link>
    <category>기타</category>
    <description><![CDATA[텍스트만 있는 항목]]></description>
    <pubDate>Mon, 14 Sep 2026 09:10:00 GMT</pubDate>
  </item>
</channel></rss>`;

function response(body = RSS, overrides = {}) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    url: RULIWEB_FEED_URL,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/xml; charset=utf-8' : null },
    text: async () => body,
    ...overrides,
  };
}

function leasedStore({ acquired = true } = {}) {
  const calls = [];
  return {
    calls,
    async withCollectionLease(source, worker) {
      calls.push(['lease', source]);
      return acquired ? worker() : null;
    },
    async upsert(deal) { calls.push(['upsert', deal]); return deal; },
    async deleteBefore(source, cutoff) { calls.push(['deleteBefore', source, cutoff]); return 2; },
    async upsertBatchAndDeleteBefore(source, deals, cutoff) {
      for (const deal of deals) await this.upsert(deal);
      const deleted = await this.deleteBefore(source, cutoff);
      return { stored: deals.length, deleted };
    },
  };
}

test('Ruliweb RSS를 공개 필드와 숫자 ID로 변환하고 설명 본문은 보존하지 않는다', () => {
  const deals = parseRuliwebFeed(RSS);
  assert.equal(deals.length, 2);
  assert.deepEqual(deals[0], {
    source: 'ruliweb',
    sourceItemId: '123456',
    title: '[공식몰] 무선 키보드 19,900원',
    originalUrl: 'https://bbs.ruliweb.com/market/board/1020/read/123456',
    merchant: '공식몰',
    priceAmount: 19900,
    currency: 'KRW',
    authoritativePrice: true,
    category: '디지털/가전',
    sourceImageUrl: 'https://i2.ruliweb.com/img/26/09/item.jpg',
    imageUrl: 'https://i2.ruliweb.com/img/26/09/item.jpg',
    imageStatus: 'ready',
    imageProvider: 'ruliweb-direct',
    publishedAt: '2026-09-14T08:10:00.000Z',
  });
  assert.equal(deals[1].priceAmount, null);
  assert.equal(deals[1].authoritativePrice, true);
  assert.equal(deals[1].imageUrl, null);
  assert.equal(deals[1].imageStatus, 'missing_merchant_url');
  assert.equal(deals[1].imageProvider, null);
  assert.doesNotMatch(JSON.stringify(deals), /작성자 개인정보|description/);
});

test('item URL은 board 1020의 정확한 HTTPS canonical 숫자 경로만 허용한다', () => {
  const unsafe = [
    'http://bbs.ruliweb.com/market/board/1020/read/1',
    'https://user@bbs.ruliweb.com/market/board/1020/read/1',
    'https://bbs.ruliweb.com:444/market/board/1020/read/1',
    'https://evil.example/market/board/1020/read/1',
    'https://bbs.ruliweb.com/market/board/1021/read/1',
    'https://bbs.ruliweb.com/market/board/1020/read/1/extra',
    'https://bbs.ruliweb.com/market/board/1020/read/not-number',
    'https://bbs.ruliweb.com/market/board/1020/read/1?tracking=yes',
  ];
  for (const [index, url] of unsafe.entries()) {
    const item = `<item><title>[몰] 위험 ${index}</title><link>${url.replaceAll('&', '&amp;')}</link><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item>`;
    assert.throws(() => parseRuliwebFeed(`<rss><channel>${item}</channel></rss>`), /snapshot/i);
  }
  const valid = '<item><title>[몰] 정상</title><link>https://bbs.ruliweb.com/market/board/1020/read/9</link><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item>';
  assert.deepEqual(parseRuliwebFeed(`<rss><channel>${valid}</channel></rss>`).map((deal) => deal.sourceItemId), ['9']);
});

test('루리웹 상품가는 괄호 유무와 관계없이 배송비보다 우선하고 공식 category와 중복 entity를 정규화한다', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>[스토어] A &amp;amp; B 24,800원 / 배송비 2,500원</title>
    <link>https://bbs.ruliweb.com/market/board/1020/read/42</link>
    <pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate>
    <category>PC/가전</category>
  </item><item>
    <title>[스토어] 닌텐도 스위치 게임 에디션 9,900원</title>
    <link>https://bbs.ruliweb.com/market/board/1020/read/43</link>
    <pubDate>Mon, 14 Sep 2026 08:11:00 GMT</pubDate>
    <category>화장품</category>
  </item></channel></rss>`;
  const deals = parseRuliwebFeed(xml);
  assert.equal(deals[0].title, '[스토어] A & B 24,800원 / 배송비 2,500원');
  assert.equal(deals[0].priceAmount, 24800);
  assert.equal(deals[0].category, '디지털/가전');
  assert.equal(deals[1].category, '뷰티');
});

test('실제 루리웹 제목에서 무표기 배송비와 날짜 범위를 상품가로 오인하지 않는다', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>[네이버] PS 디스가이아 6 &amp; 7 24,800원 / 2,500원</title><link>https://bbs.ruliweb.com/market/board/1020/read/107211</link><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item>
    <item><title>[GS25] 페이스페이 30% 적립(일 최대 3천) (9/14~30)</title><link>https://bbs.ruliweb.com/market/board/1020/read/107200</link><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item>
  </channel></rss>`;
  const deals = parseRuliwebFeed(xml);
  assert.deepEqual(deals.map((deal) => deal.priceAmount), [24800, null]);
});

test('DTD와 entity 선언이 포함된 루리웹 XML은 파싱 전에 거부한다', () => {
  const xml = `<?xml version="1.0"?>
    <!DOCTYPE rss [<!ENTITY x "STORE">]>
    <rss><channel><item><title>[몰] &amp;x; 상품 1,000원</title><link>https://bbs.ruliweb.com/market/board/1020/read/1</link><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item></channel></rss>`;
  assert.throws(() => parseRuliwebFeed(xml), /DTD|entity/i);
});

test('thumbnail은 i1/i2/i3 정확한 HTTPS 443 origin만 원격 표시한다', () => {
  const urls = [
    'https://i1.ruliweb.com/a.jpg', 'https://i2.ruliweb.com/b.jpg', 'https://i3.ruliweb.com/c.jpg',
    'http://i1.ruliweb.com/d.jpg', 'https://sub.i1.ruliweb.com/e.jpg',
    'https://i1.ruliweb.com.evil.example/f.jpg', 'https://i1.ruliweb.com:444/g.jpg',
  ];
  const items = urls.map((url, index) => `<item><title>[몰] 상품 ${index}</title><link>https://bbs.ruliweb.com/market/board/1020/read/${index + 1}</link><description><![CDATA[<img src="${url}">]]></description><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item>`).join('');
  const deals = parseRuliwebFeed(`<rss><channel>${items}</channel></rss>`);
  assert.deepEqual(deals.map((deal) => deal.imageUrl), [urls[0], urls[1], urls[2], null, null, null, null]);
  assert.deepEqual(deals.slice(3).map((deal) => deal.imageProvider), [null, null, null, null]);
});

test('malformed/challenge/empty/zero-valid/duplicate-ID snapshot을 실패로 처리한다', () => {
  for (const xml of [
    '<rss><channel><item>',
    '<html><title>Just a moment...</title><body>verify you are human</body></html>',
    '<rss><channel></channel></rss>',
    '<rss><channel><item><title>x</title><link>https://evil.example/1</link><pubDate>bad</pubDate></item></channel></rss>',
    `<rss><channel>${RSS.match(/<item>[\s\S]*?<\/item>/)[0]}${RSS.match(/<item>[\s\S]*?<\/item>/)[0]}</channel></rss>`,
  ]) assert.throws(() => parseRuliwebFeed(xml), /snapshot|XML|duplicate|challenge/i);
});

test('lease는 요청부터 저장과 source-scoped 72h retention까지 감싸며 loser는 부작용이 없다', async () => {
  const store = leasedStore();
  let fetchCalls = 0;
  const now = new Date('2026-09-14T12:00:00.000Z');
  const result = await runRuliwebCollector({ store, now: () => now, fetchImpl: async (url, options) => {
    fetchCalls += 1;
    assert.equal(url, RULIWEB_FEED_URL);
    assert.equal(options.redirect, 'manual');
    return response();
  }});
  assert.deepEqual(result, { fetched: 2, stored: 2, deleted: 2 });
  assert.equal(fetchCalls, 1);
  assert.deepEqual(store.calls.map(([kind]) => kind), ['lease', 'upsert', 'upsert', 'deleteBefore']);
  assert.equal(store.calls.at(-1)[1], 'ruliweb');
  assert.equal(store.calls.at(-1)[2].toISOString(), '2026-09-11T12:00:00.000Z');

  const loser = leasedStore({ acquired: false });
  fetchCalls = 0;
  assert.deepEqual(await runRuliwebCollector({ store: loser, fetchImpl: async () => { fetchCalls += 1; } }), {
    skipped: 'lease-unavailable', fetched: 0, stored: 0, deleted: 0,
  });
  assert.equal(fetchCalls, 0);
  assert.deepEqual(loser.calls, [['lease', 'ruliweb']]);
});

test('실패한 snapshot은 upsert하지 않지만 source-scoped retention은 유지한다', async () => {
  const mixedSnapshot = RSS.replace('</channel>', '<item><title>[몰] 손상</title><link>https://evil.example/read/1</link><pubDate>Mon, 14 Sep 2026 08:10:00 GMT</pubDate></item></channel>');
  for (const badResponse of [
    response('', { headers: { get: () => 'text/xml' } }),
    response('<html>challenge</html>', { headers: { get: () => 'text/html' } }),
    response('<rss><channel></channel></rss>'),
    response(mixedSnapshot),
    response(RSS, { status: 302, ok: false, headers: { get: (name) => name === 'location' ? 'https://bbs.ruliweb.com/other' : null } }),
  ]) {
    const store = leasedStore();
    await assert.rejects(() => runRuliwebCollector({ store, fetchImpl: async () => badResponse }));
    assert.deepEqual(store.calls.map(([kind]) => kind), ['lease', 'deleteBefore']);
    assert.equal(store.calls.some(([kind]) => kind === 'upsert'), false);
  }
});

test('고정 URL, XML content type, body size와 timeout 설정을 강제한다', async () => {
  const store = leasedStore();
  await assert.rejects(() => runRuliwebCollector({
    store,
    maxBodyBytes: 1024,
    fetchImpl: async () => response('x'.repeat(1025), { headers: { get: () => 'text/xml' } }),
  }), /too large/i);
  assert.deepEqual(store.calls.map(([kind]) => kind), ['lease', 'deleteBefore']);

  const wrongTypeStore = leasedStore();
  await assert.rejects(() => runRuliwebCollector({
    store: wrongTypeStore,
    fetchImpl: async () => response(RSS, { headers: { get: () => 'application/json' } }),
  }), /content type/i);
  assert.deepEqual(wrongTypeStore.calls.map(([kind]) => kind), ['lease', 'deleteBefore']);
});

test('Ruliweb runtime은 기본 OFF이고 disabled에서는 optional 설정을 무시한다', () => {
  assert.deepEqual(readRuliwebRuntime({ RULIWEB_POLL_INTERVAL_MS: 'oops', RULIWEB_REQUEST_TIMEOUT_MS: 'also-bad' }), {
    enabled: false, intervalMs: 1200000, timeoutMs: 10000,
  });
  assert.deepEqual(readRuliwebRuntime({ RULIWEB_ENABLED: 'false', RULIWEB_POLL_INTERVAL_MS: '1.5' }), {
    enabled: false, intervalMs: 1200000, timeoutMs: 10000,
  });
});

test('enabled runtime은 interval/timeout을 strict integer와 보수적 범위로 검증한다', () => {
  assert.deepEqual(readRuliwebRuntime({ RULIWEB_ENABLED: 'true' }), {
    enabled: true, intervalMs: 1200000, timeoutMs: 10000,
  });
  for (const interval of ['600000.0', ' 600000', '1e6', '599999']) {
    assert.throws(() => readRuliwebRuntime({ RULIWEB_ENABLED: 'true', RULIWEB_POLL_INTERVAL_MS: interval }), /RULIWEB_POLL_INTERVAL_MS/);
  }
  assert.equal(readRuliwebRuntime({ RULIWEB_ENABLED: 'true', RULIWEB_POLL_INTERVAL_MS: '600000' }).intervalMs, 600000);
  assert.throws(() => readRuliwebRuntime({ RULIWEB_ENABLED: 'true', RULIWEB_REQUEST_TIMEOUT_MS: '1000.0' }), /RULIWEB_REQUEST_TIMEOUT_MS/);
});
