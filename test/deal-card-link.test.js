const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCardContainer } = require('../public/deal-card-link');
const { normalizeDeal } = require('../public/deal-utils');

for (const className of ['deal-card', 'popular-item', 'latest-item']) {
  test(`${className}는 유효한 URL만 새 탭 표준 링크로 렌더한다`, () => {
    const linked = renderCardContainer(className, 'https://deals.example/item?a=1&b=2', '<strong>상품</strong>');
    assert.equal(
      linked,
      `<a class="${className}" href="https://deals.example/item?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"><strong>상품</strong></a>`,
    );
  });

  test(`${className}는 URL이 없거나 unsafe이면 링크 없는 비활성 article로 렌더한다`, () => {
    for (const rawUrl of ['', 'javascript:alert(1)', '/relative-deal']) {
      const deal = normalizeDeal({ id: 'missing-url', title: '상품', url: rawUrl });
      assert.equal(deal.url, '');
      const disabled = renderCardContainer(className, deal.url, '<strong>상품</strong>');
      assert.equal(disabled, `<article class="${className}" aria-disabled="true"><strong>상품</strong></article>`);
      assert.doesNotMatch(disabled, /href=|<a\b|<article[^>]*>[^]*<article\b/);
    }
  });
}

test('쿠팡 카드만 sponsored 링크 속성을 명시할 수 있다', () => {
  const html = renderCardContainer('deal-card', 'https://link.coupang.com/re/affiliate', '상품', {
    rel: 'sponsored noopener noreferrer',
  });
  assert.match(html, /rel="sponsored noopener noreferrer"/);
  const injected = renderCardContainer('deal-card', 'https://example.com/', '상품', { rel: 'opener evil' });
  assert.match(injected, /rel="noopener noreferrer"/);
});
