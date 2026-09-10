const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeImageUrl, normalizeDeal, filterAndSortDeals, fetchAllLiveDeals, mixHomeDeals, selectPhoneDeals, fetchPublicSiteSettings,
} = require('../public/deal-utils');

const rawDeal = {
  id: '1',
  badge: 'LIVE',
  title: '[G마켓] 아이폰 17 케이스 19,900원',
  price: 19900,
  store: 'G마켓',
  category: '디지털/가전',
  imageUrl: 'https://cdn4.ppomppu.co.kr/item.jpg',
  source: 'ppomppu',
  publishedAt: '2026-09-08T10:00:00.000Z',
  url: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1',
  isEnded: false,
};

test('실데이터를 가짜 반응 수치 없이 카드 표시 모델로 변환한다', () => {
  const deal = normalizeDeal(rawDeal, new Date('2026-09-08T11:30:00.000Z'));

  assert.equal(deal.category, '디지털/가전');
  assert.equal(deal.imageUrl, 'https://cdn4.ppomppu.co.kr/item.jpg');
  assert.equal(deal.postedAt, '1시간 전');
  assert.equal(deal.url, rawDeal.url);
  assert.equal(deal.price, 19900);
  assert.equal('views' in deal, false);
  assert.equal('discountRate' in deal, false);
  assert.equal(normalizeDeal({ ...rawDeal, url: 'javascript:alert(1)' }).url, '');
  assert.equal(normalizeDeal({ ...rawDeal, imageUrl: 'http://cdn.example/item.jpg' }).imageUrl, null);
  assert.equal(normalizeDeal({ ...rawDeal, imageUrl: 'https://127.0.0.1/item.jpg' }).imageUrl, null);
  assert.equal(normalizeDeal({ ...rawDeal, imageUrl: 'https://evil.example/item.jpg' }).imageUrl, null);
  assert.equal(normalizeDeal({
    ...rawDeal,
    imageUrl: 'https://images.example.com/base/deals/feed/item.webp',
    imageBaseUrls: ['https://images.example.com/base'],
  }).imageUrl, 'https://images.example.com/base/deals/feed/item.webp');
  assert.equal(normalizeDeal({
    ...rawDeal,
    imageUrl: 'https://images.example.com/other/item.webp',
    imageBaseUrls: ['https://images.example.com/base'],
  }).imageUrl, null);
  assert.equal(normalizeDeal({
    ...rawDeal,
    imageUrl: 'https://shopping-phinf.pstatic.net/main_123/123.jpg',
    imageBaseUrls: ['https://shopping-phinf.pstatic.net/'],
  }).imageUrl, 'https://shopping-phinf.pstatic.net/main_123/123.jpg');
  assert.equal(normalizeDeal({
    ...rawDeal,
    imageUrl: 'https://shopping-phinf.pstatic.net.evil.example/main_123/123.jpg',
    imageBaseUrls: ['https://shopping-phinf.pstatic.net/'],
  }).imageUrl, null);
  assert.equal(normalizeDeal({ ...rawDeal, imageUrl: 'https://evilppomppu.co.kr/item.jpg' }).imageUrl, null);
  assert.equal(normalizeDeal({ ...rawDeal, imageUrl: 'https://cdn.ppomppu.co.kr/item.jpg' }).imageUrl, 'https://cdn.ppomppu.co.kr/item.jpg');
  assert.equal(normalizeDeal({ ...rawDeal, category: '알 수 없는 분류' }).category, '기타');
  assert.equal(normalizeDeal({ ...rawDeal, title: 'QSSD 브랜드 상품', category: undefined }).category, '기타');
  assert.equal(normalizeDeal({ ...rawDeal, title: '등산 텐트', category: undefined }).category, '기타');
});

test('실데이터 API의 모든 페이지를 가져와 전체 필터·정렬 대상으로 사용한다', async () => {
  const calls = [];
  const deals = Array.from({ length: 101 }, (_, index) => ({ ...rawDeal, id: String(index + 1) }));
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'));
    const slice = page === 1 ? deals.slice(0, 100) : deals.slice(100);
    return {
      ok: true,
      json: async () => ({
        deals: slice,
        total: 101,
        page,
        size: 100,
        imageBaseUrls: ['https://images.example.com/base'],
      }),
    };
  };

  const result = await fetchAllLiveDeals({ source: 'ppomppu', query: '아이폰', fetchImpl });
  assert.equal(result.length, 101);
  assert.deepEqual(result[0].imageBaseUrls, ['https://images.example.com/base']);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /q=%EC%95%84%EC%9D%B4%ED%8F%B0/);
  assert.match(calls[0], /source=ppomppu/);
  assert.match(calls[1], /page=2/);
});

test('source를 요청하지 않으면 API에서 모든 live source를 가져온다', async () => {
  const calls = [];
  await fetchAllLiveDeals({
    query: '',
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ deals: [], total: 0 }) };
    },
  });

  const params = new URL(calls[0], 'https://example.test').searchParams;
  assert.equal(params.has('source'), false);
  assert.equal(params.get('q'), '');
  assert.equal(params.get('page'), '1');
  assert.equal(params.get('size'), '100');
});

test('실데이터 API 응답 형식이 잘못되면 명시적으로 실패한다', async () => {
  await assert.rejects(
    fetchAllLiveDeals({ fetchImpl: async () => ({ ok: true, json: async () => ({ deals: null }) }) }),
    /Invalid live deals response/,
  );
});

test('카테고리 필터와 최신순·가격순이 실제 필드로 동작한다', () => {
  const deals = [
    normalizeDeal(rawDeal),
    normalizeDeal({ ...rawDeal, id: '2', title: '[네이버] 라면 10봉', category: '식품', price: 12000, publishedAt: '2026-09-08T11:00:00.000Z' }),
    normalizeDeal({ ...rawDeal, id: '3', title: '[11번가] 이어폰', price: null, publishedAt: '2026-09-08T12:00:00.000Z' }),
  ];

  assert.deepEqual(filterAndSortDeals(deals, { category: '식품', sort: 'latest' }).map((deal) => deal.id), ['2']);
  assert.deepEqual(filterAndSortDeals(deals, { category: '전체', sort: 'latest' }).map((deal) => deal.id), ['3', '2', '1']);
  assert.deepEqual(filterAndSortDeals(deals, { category: '전체', sort: 'price-low' }).map((deal) => deal.id), ['2', '1', '3']);
});

test('수동 특가 API 필드를 카드 모델에 안전하게 보존한다', () => {
  const deal = normalizeDeal({
    ...rawDeal,
    source: 'manual',
    isManual: true,
    badge: '한정 특가',
    originalPrice: 1350000,
    description: '공시지원금 기준 안내',
    showOnHome: true,
    priority: 20,
  });

  assert.equal(deal.badge, '한정 특가');
  assert.equal(deal.originalPrice, 1350000);
  assert.equal(deal.description, '공시지원금 기준 안내');
  assert.equal(deal.isManual, true);
  assert.equal(deal.showOnHome, true);
  assert.equal(deal.priority, 20);
});

test('이미지는 허용된 HTTPS 원본과 정확한 same-origin 수동 이미지 경로만 허용한다', () => {
  assert.equal(safeImageUrl('/api/manual-deal-images/123'), '/api/manual-deal-images/123');
  for (const value of [
    '/api/manual-deal-images/123/', '/api/manual-deal-images/abc',
    '/api/manual-deal-images/1?url=https://evil.example', '//evil.example/api/manual-deal-images/1',
    '/api/manual-deal-images/1#x', '/other/1',
  ]) assert.equal(safeImageUrl(value), '', value);
  assert.equal(safeImageUrl('https://images.example/base/a.jpg', ['https://images.example/base']), 'https://images.example/base/a.jpg');
});

test('메인 수동 특가는 우선순위로 제한하고 RSS 첫 네 개 뒤부터 일정하게 섞는다', () => {
  const rss = Array.from({ length: 10 }, (_, index) => ({ id: `r${index + 1}`, isManual: false }));
  const manual = [
    { id: 'm-low', isManual: true, showOnHome: true, priority: 1, publishedAt: '2026-09-10T10:00:00Z' },
    { id: 'm-off', isManual: true, showOnHome: false, priority: 100 },
    { id: 'm-high', isManual: true, showOnHome: true, priority: 20, publishedAt: '2026-09-09T10:00:00Z' },
    { id: 'm-mid', isManual: true, showOnHome: true, priority: 10, publishedAt: '2026-09-10T10:00:00Z' },
  ];

  const mixed = mixHomeDeals([...manual, ...rss], { manualLimit: 2 });
  assert.deepEqual(mixed.slice(0, 4).map((deal) => deal.id), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(mixed.filter((deal) => deal.isManual).map((deal) => deal.id), ['m-high', 'm-mid']);
  assert.deepEqual(mixed.map((deal) => deal.id), [
    'r1', 'r2', 'r3', 'r4', 'm-high', 'r5', 'r6', 'r7', 'r8', 'm-mid', 'r9', 'r10',
  ]);
  assert.deepEqual(mixHomeDeals([...manual, ...rss.slice(0, 3)]).map((deal) => deal.id), [
    'r1', 'r2', 'r3', 'm-high', 'm-mid', 'm-low',
  ]);
});

test('공개 사이트 설정은 유효한 값만 사용하고 실패 시 기본값 4를 쓴다', async () => {
  assert.deepEqual(await fetchPublicSiteSettings({
    fetchImpl: async () => ({ ok: true, json: async () => ({ home_manual_limit: 7, admin_note: 'secret' }) }),
  }), { home_manual_limit: 7, phone_section_title: '휴대폰 초특가 핫딜' });
  assert.deepEqual(await fetchPublicSiteSettings({
    fetchImpl: async () => ({ ok: true, json: async () => ({ home_manual_limit: -1 }) }),
  }), { home_manual_limit: 4, phone_section_title: '휴대폰 초특가 핫딜' });
  assert.deepEqual(await fetchPublicSiteSettings({ fetchImpl: async () => { throw new Error('offline'); } }), {
    home_manual_limit: 4, phone_section_title: '휴대폰 초특가 핫딜',
  });
});

test('전용 휴대폰 섹션은 게시 API의 메인 수동 딜만 우선순위 순으로 최대 네 개 선택한다', () => {
  const deals = [
    { id: 'auto', isManual: false, showOnHome: true, priority: 999 },
    { id: 'off', isManual: true, showOnHome: false, priority: 999 },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `m${index}`, isManual: true, showOnHome: true, priority: index,
      publishedAt: `2026-09-0${index + 1}T00:00:00Z`,
    })),
  ];
  assert.deepEqual(selectPhoneDeals(deals, { limit: 20 }).map((deal) => deal.id), ['m5', 'm4', 'm3', 'm2']);
  assert.deepEqual(selectPhoneDeals(deals, { limit: 2 }).map((deal) => deal.id), ['m5', 'm4']);
  assert.deepEqual(selectPhoneDeals(deals, { limit: 0 }), []);
});

test('공개 사이트 설정은 휴대폰 섹션 제목을 보존하되 비정상 값은 기본 제목으로 닫는다', async () => {
  assert.deepEqual(await fetchPublicSiteSettings({
    fetchImpl: async () => ({ ok: true, json: async () => ({ home_manual_limit: 4, phone_section_title: '오늘의 폰딜', admin_note: 'secret' }) }),
  }), { home_manual_limit: 4, phone_section_title: '오늘의 폰딜' });
  assert.equal((await fetchPublicSiteSettings({ fetchImpl: async () => ({ ok: true, json: async () => ({ phone_section_title: '' }) }) })).phone_section_title, '휴대폰 초특가 핫딜');
});
