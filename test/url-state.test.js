const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readDealState,
  buildDealStateUrl,
} = require('../public/url-state');

const defaults = { query: '', category: '전체', sort: 'latest' };

test('검색어, 카테고리, 정렬을 URL에서 복원한다', () => {
  assert.deepEqual(
    readDealState('?q=%EA%B0%A4%EB%9F%AD%EC%8B%9C&category=%EC%8B%9D%ED%92%88&sort=price-low'),
    { query: '갤럭시', category: '식품', sort: 'price-low' },
  );
});

test('알 수 없거나 과도한 query 값은 안전한 기본값으로 정규화한다', () => {
  assert.deepEqual(
    readDealState(`?q=${'x'.repeat(101)}&category=unknown&sort=popular`),
    defaults,
  );
  assert.deepEqual(readDealState('?q=%20%20%EC%95%84%EC%9D%B4%ED%8F%B0%20%20'), {
    ...defaults,
    query: '아이폰',
  });
});

test('URL 생성은 기본값을 생략하고 기존 앵커와 무관한 query를 보존한다', () => {
  assert.equal(
    buildDealStateUrl('/?utm_source=test#all-deals', {
      query: '아이폰 15', category: '디지털/가전', sort: 'price-low',
    }),
    '/?utm_source=test&q=%EC%95%84%EC%9D%B4%ED%8F%B0+15&category=%EB%94%94%EC%A7%80%ED%84%B8%2F%EA%B0%80%EC%A0%84&sort=price-low#all-deals',
  );
  assert.equal(buildDealStateUrl('/?q=old&category=%EC%8B%9D%ED%92%88&sort=price-low#all-deals', defaults), '/#all-deals');
});
