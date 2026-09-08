const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeDeal, filterAndSortDeals, fetchAllLiveDeals } = require('../public/deal-utils');

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
  assert.match(calls[1], /page=2/);
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
