'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

function recommendation(overrides = {}) {
  return {
    productId: '101',
    source: 'integrated-best',
    title: '추천 상품',
    price: 12900,
    sharelinkUrl: 'https://toss.im/_m/product101',
    rank: 1,
    endAt: null,
    ...overrides,
  };
}

function view() {
  return {
    section: { hidden: false },
    grid: { innerHTML: 'stale' },
  };
}

test('토스 추천은 쿠팡과 분리된 기본 hidden 구좌이며 고지 다음에 텍스트 grid가 온다', () => {
  const coupangAt = html.indexOf('id="coupangProductGrid"');
  const tossAt = html.indexOf('id="tossRecommendations"');
  const titleAt = html.indexOf('id="tossRecommendationsTitle"');
  const disclosureAt = html.indexOf('이 포스팅은 토스쇼핑 쉐어링크 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
  const gridAt = html.indexOf('id="tossRecommendationGrid"');
  const tossEnd = html.indexOf('</aside>', tossAt);
  const tossMarkup = html.slice(tossAt, tossEnd);

  assert.ok(coupangAt >= 0 && coupangAt < tossAt);
  assert.ok(tossAt < titleAt && titleAt < disclosureAt && disclosureAt < gridAt);
  assert.match(html.slice(tossAt - 80, tossAt + 180), /<aside[^>]*id="tossRecommendations"[^>]*hidden/);
  assert.match(tossMarkup, /토스쇼핑 오늘의 추천/);
  assert.match(tossMarkup, /class="affiliate-card toss-affiliate-card"/);
  assert.match(tossMarkup, /class="affiliate-product-grid deal-grid toss-recommendation-grid"/);
  assert.doesNotMatch(tossMarkup, /<img\b/i);
  assert.doesNotMatch(tossMarkup, /aria-live=/);
});

test('토스 텍스트 카드 자체는 클릭 커서를 쓰지 않고 CTA만 pointer를 쓴다', () => {
  assert.match(styles, /\.toss-text-card\s*\{[^}]*cursor:\s*default/);
  assert.match(styles, /\.toss-text-cta\s*\{[^}]*cursor:\s*pointer/);
});

test('앱은 별도 query 없는 토스 API 로더를 startup Promise.all에 추가한다', () => {
  assert.match(script, /fetchImpl\('\/api\/toss-recommendations'\)/);
  assert.doesNotMatch(script, /\/api\/toss-recommendations\?/);
  assert.match(script, /Promise\.all\(\[[\s\S]*loadTossRecommendations\(\)/);
});

test('토스 텍스트 카드는 XSS를 escape하고 공식 source, 가격, CTA 보안 속성만 렌더한다', () => {
  const { renderRecommendations } = require('../public/app');
  const { section, grid } = view();
  const result = renderRecommendations([
    recommendation({ title: '<img src=x onerror=alert(1)> & "상품"' }),
    recommendation({ source: 'today-special', title: '오늘만', price: null, rank: 2 }),
  ], { section, grid, now: new Date('2026-09-12T10:00:00.000Z') });

  assert.equal(result.length, 2);
  assert.equal(section.hidden, false);
  assert.match(grid.innerHTML, /통합 베스트/);
  assert.match(grid.innerHTML, /하루특가/);
  assert.match(grid.innerHTML, /12,900원/);
  assert.match(grid.innerHTML, /가격 확인/);
  assert.match(grid.innerHTML, /토스쇼핑에서 보기/);
  assert.match(grid.innerHTML, /target="_blank" rel="sponsored noopener noreferrer"/);
  assert.match(grid.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;상품&quot;/);
  assert.doesNotMatch(grid.innerHTML, /<img\b/i);
});

test('토스 링크는 exact HTTPS toss.im /_m/ token만 허용한다', () => {
  const { safeTossSharelinkUrl } = require('../public/app');
  assert.equal(safeTossSharelinkUrl('https://toss.im/_m/abc123'), 'https://toss.im/_m/abc123');
  assert.equal(safeTossSharelinkUrl('https://TOSS.IM/_m/abc_123-x'), 'https://toss.im/_m/abc_123-x');
  for (const value of [
    'http://toss.im/_m/x',
    'https://evil.example/_m/x',
    'https://toss.im.evil.example/_m/x',
    'https://user:pass@toss.im/_m/x',
    'https://toss.im:443/_m/x',
    'https://toss.im:444/_m/x',
    'https://toss.im/_m/',
    'https://toss.im/_m/x?q=secret',
    'https://toss.im/_m/x#fragment',
    'https://toss.im/_m/x y',
    'https://toss.im/_m/x\n',
    'https://toss.im\\_m\\x',
    'https://toss.im/_m/x%2Fy',
    'https://toss.im/_m/x%5Cy',
    'https://toss.im/_m/x%0Ay',
    'https://toss.im/_m/한글',
    'https://toss.im/_m/x.y',
    'https://toss.im/_m/x~y',
    'https://toss.im/not-m/x',
    '/_m/x',
  ]) assert.equal(safeTossSharelinkUrl(value), '', value);
});

test('source는 own-property allowlist만 허용하고 prototype pollution으로 badge HTML을 주입할 수 없다', () => {
  const { renderRecommendations } = require('../public/app');
  const { section, grid } = view();
  Object.prototype.pollutedSource = '<img src=x onerror=alert(1)>';
  try {
    const result = renderRecommendations([
      recommendation({ source: 'constructor', title: 'constructor source' }),
      recommendation({ source: 'toString', title: 'toString source' }),
      recommendation({ source: '__proto__', title: 'proto source' }),
      recommendation({ source: 'pollutedSource', title: 'polluted source' }),
    ], { section, grid, now: new Date('2026-09-12T10:00:00.000Z') });
    assert.deepEqual(result, []);
    assert.equal(section.hidden, true);
    assert.equal(grid.innerHTML, '');
  } finally {
    delete Object.prototype.pollutedSource;
  }
});

test('CTA 접근성 이름은 상품명과 새 창 안내를 포함하며 attribute escape된다', () => {
  const { renderRecommendations } = require('../public/app');
  const { section, grid } = view();
  renderRecommendations([
    recommendation({ title: '추천 "상품" <특가>' }),
  ], { section, grid, now: new Date('2026-09-12T10:00:00.000Z') });

  assert.match(grid.innerHTML, /aria-label="추천 &quot;상품&quot; &lt;특가&gt; 토스쇼핑에서 보기 \(새 창\)"/);
  assert.match(grid.innerHTML, />토스쇼핑에서 보기 <span aria-hidden="true">→<\/span><\/a>/);
});

test('productId는 양의 safe integer 숫자 또는 31자리 이하의 canonical decimal 문자열만 허용한다', () => {
  const { renderRecommendations } = require('../public/app');
  const { section, grid } = view();
  const missingProductId = recommendation({ title: 'missing productId' });
  delete missingProductId.productId;
  const invalidProductIds = [
    null,
    '',
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    '01',
    '-1',
    '1.5',
    ' ',
    ' 1',
    '1 ',
    '1 2',
    'abc',
    '1'.repeat(32),
  ];
  const validProductIds = [1, Number.MAX_SAFE_INTEGER, '1', '9'.repeat(31)];
  const items = [
    missingProductId,
    ...invalidProductIds.map((productId, index) => recommendation({
      productId,
      title: `invalid ${index}`,
    })),
    ...validProductIds.map((productId, index) => recommendation({
      productId,
      title: `valid ${index}`,
    })),
  ];

  const result = renderRecommendations(items, {
    section, grid, now: new Date('2026-09-12T10:00:00.000Z'),
  });

  assert.equal(result.length, validProductIds.length);
  assert.equal((grid.innerHTML.match(/toss-text-card/g) || []).length, validProductIds.length);
  assert.doesNotMatch(grid.innerHTML, /missing productId|invalid /);
  for (let index = 0; index < validProductIds.length; index += 1) {
    assert.match(grid.innerHTML, new RegExp(`valid ${index}`));
  }
});

test('유효하지 않거나 만료된 상품은 제외하고 유효 상품도 최대 10개만 렌더한다', () => {
  const { renderRecommendations } = require('../public/app');
  const { section, grid } = view();
  const invalid = [
    recommendation({ title: '' }),
    recommendation({ source: 'unknown' }),
    recommendation({ price: -1 }),
    recommendation({ rank: 0 }),
    recommendation({ endAt: undefined }),
    recommendation({ endAt: 'not-a-date' }),
    recommendation({ endAt: '2026-02-30T10:00:00.000Z' }),
    recommendation({ sharelinkUrl: 'https://toss.im/_m/x?query=1' }),
    recommendation({ endAt: '2026-09-12T09:59:59.999Z' }),
  ];
  const valid = Array.from({ length: 12 }, (_, index) => recommendation({
    productId: String(200 + index),
    title: `상품 ${index + 1}`,
    rank: (index % 10) + 1,
    sharelinkUrl: `https://toss.im/_m/${index + 1}`,
  }));

  const result = renderRecommendations([...invalid, ...valid], {
    section, grid, now: new Date('2026-09-12T10:00:00.000Z'),
  });
  assert.equal(result.length, 10);
  assert.equal((grid.innerHTML.match(/toss-text-card/g) || []).length, 10);
  assert.doesNotMatch(grid.innerHTML, /query=1/);
});

test('disabled, empty, malformed, non-OK와 network 오류는 토스 구좌만 비우고 숨긴다', async () => {
  const { loadRecommendations } = require('../public/app');
  const cases = [
    async () => ({ ok: true, json: async () => ({ enabled: false, recommendations: [recommendation()] }) }),
    async () => ({ ok: true, json: async () => ({ enabled: true, recommendations: [] }) }),
    async () => ({ ok: true, json: async () => ({ enabled: true, recommendations: 'bad' }) }),
    async () => ({ ok: true, json: async () => ({
      enabled: true,
      recommendations: Array.from({ length: 11 }, (_, index) => recommendation({ productId: String(index + 1) })),
    }) }),
    async () => ({ ok: false, status: 500, json: async () => ({ secret: 'do not log' }) }),
    async () => { throw new Error('token=secret'); },
  ];

  for (const fetchImpl of cases) {
    const { section, grid } = view();
    const logs = [];
    const result = await loadRecommendations({
      fetchImpl,
      section,
      grid,
      now: () => new Date('2026-09-12T10:00:00.000Z'),
      logError: (message) => logs.push(message),
    });
    assert.deepEqual(result, []);
    assert.equal(section.hidden, true);
    assert.equal(grid.innerHTML, '');
    assert.equal(logs.some((line) => /secret|token|500/.test(line)), false);
  }
});

test('optional 토스 DOM이 없으면 fetch 전에 []를 반환하고 clear/render도 null-safe다', async () => {
  const { loadRecommendations, loadTossRecommendations, renderRecommendations } = require('../public/app');
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not run');
  };

  assert.deepEqual(renderRecommendations([recommendation()], {
    section: null, grid: null, now: new Date('2026-09-12T10:00:00.000Z'),
  }), []);
  assert.deepEqual(await loadRecommendations({
    fetchImpl, section: null, grid: {}, now: () => { throw new Error('clock must not run'); },
  }), []);
  assert.deepEqual(await loadTossRecommendations({ fetchImpl, section: {}, grid: null }), []);
  assert.equal(fetchCalls, 0);
});

test('enabled 응답의 유효 항목만 표시하며 로더는 고정 오류 문구 외 사용자 UI를 건드리지 않는다', async () => {
  const { loadRecommendations } = require('../public/app');
  const { section, grid } = view();
  const calls = [];
  const result = await loadRecommendations({
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ enabled: true, recommendations: [recommendation()] }) };
    },
    section,
    grid,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['/api/toss-recommendations']);
  assert.equal(result.length, 1);
  assert.equal(section.hidden, false);
});
