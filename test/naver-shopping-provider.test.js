const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readNaverShoppingConfig,
  buildSearchQuery,
  matchNaverCandidates,
  createNaverShoppingProvider,
} = require('../src/product-matching/naver-shopping');

const deal = {
  source: 'ppomppu',
  sourceItemId: '123',
  title: '[G마켓] 삼성전자 갤럭시 S25 256GB 블루 자급제 (1,099,000원/무료)',
  priceAmount: 1099000,
  merchant: 'G마켓',
  originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
};

function item(overrides = {}) {
  return {
    title: '<b>삼성전자</b> 갤럭시 S25 256GB 블루 자급제 새상품',
    link: 'https://item.gmarket.co.kr/Item?goodscode=123',
    image: 'https://shopping-phinf.pstatic.net/main_123/123.jpg',
    lprice: '1049000',
    mallName: 'G마켓',
    productId: '123',
    productType: '2',
    maker: '삼성전자',
    brand: '삼성',
    category1: '디지털/가전',
    ...overrides,
  };
}

test('네이버 자격증명은 둘 다 있을 때만 활성화하고 부분 설정은 거부한다', () => {
  assert.deepEqual(readNaverShoppingConfig({}), {
    enabled: false,
    missing: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
  });
  assert.throws(
    () => readNaverShoppingConfig({ NAVER_CLIENT_ID: 'id-only' }),
    /must be configured together/,
  );
  const config = readNaverShoppingConfig({ NAVER_CLIENT_ID: ' client-id ', NAVER_CLIENT_SECRET: ' secret ' });
  assert.equal(config.enabled, true);
  assert.equal(config.clientId, 'client-id');
  assert.equal(config.clientSecret, 'secret');
});

test('검색어에서 판매처·가격·배송/혜택 문구를 제거하고 상품 식별 정보는 유지한다', () => {
  assert.equal(buildSearchQuery(deal), '삼성전자 갤럭시 S25 256GB 블루 자급제');
});

test('첫 결과가 오답이어도 판매처와 제품 정보가 일치하는 유일한 후보만 선택한다', () => {
  const wrongFirst = item({
    title: '삼성 갤럭시 S25 케이스 블랙',
    link: 'https://item.gmarket.co.kr/Item?goodscode=wrong',
    image: 'https://shopping-phinf.pstatic.net/main_wrong/wrong.jpg',
    lprice: '19900',
    productId: 'wrong',
  });
  const result = matchNaverCandidates(deal, [wrongFirst, item()]);
  assert.equal(result.status, 'matched');
  assert.equal(result.match.productId, '123');
  assert.equal(result.match.imageUrl, 'https://shopping-phinf.pstatic.net/main_123/123.jpg');
  assert.equal(result.match.imageProvider, 'naver-shopping');
  assert.equal(result.match.imageStatus, 'ready');
  assert.ok(result.confidence >= 75);
});

test('판매처·규격·수량·옵션·상품 상태·가격 충돌 후보는 자동 매칭하지 않는다', () => {
  const cases = [
    item({ mallName: '옥션' }),
    item({ title: '삼성전자 갤럭시 S25 512GB 블루 자급제', lprice: '1049000' }),
    item({ title: '삼성전자 갤럭시 S25 256GB 블루 2개', lprice: '1049000' }),
    item({ title: '삼성전자 갤럭시 S25 256GB 핑크 자급제', lprice: '1049000' }),
    item({ title: '삼성전자 갤럭시 S25 256GB 블루 중고', lprice: '1049000' }),
    item({ lprice: '499000' }),
  ];
  for (const candidate of cases) {
    const result = matchNaverCandidates(deal, [candidate]);
    assert.equal(result.status, 'unresolved', JSON.stringify(candidate));
  }
});

test('고신뢰도 후보가 둘이면 첫 결과를 고르지 않고 ambiguous로 남긴다', () => {
  const result = matchNaverCandidates(deal, [item(), item({
    productId: '456',
    link: 'https://item.gmarket.co.kr/Item?goodscode=456',
    image: 'https://shopping-phinf.pstatic.net/main_456/456.jpg',
  })]);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reason, 'ambiguous_candidates');
});

test('모델 파생형·세대·통신사·묶음 구성이 다르면 같은 기본 모델명이어도 거부한다', () => {
  const conflictingTitles = [
    '삼성전자 갤럭시 S25+ 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 Ultra 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 FE 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 Edge 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 Lite 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 SE 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 2세대 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 256GB 블루 SKT 새상품',
    '1+1 삼성전자 갤럭시 S25 256GB 블루 자급제 새상품',
    '삼성전자 갤럭시 S25 256GB 블루 자급제 x2 새상품',
  ];
  for (const title of conflictingTitles) {
    const result = matchNaverCandidates(deal, [item({ title })]);
    assert.equal(result.status, 'unresolved', title);
    assert.equal(result.reason, 'no_qualified_candidate', title);
  }
});

test('제품군 바로 뒤 버전이 추가되거나 바뀐 후보를 자동 매칭하지 않는다', () => {
  const cases = [
    {
      sourceTitle: '[G마켓] 닌텐도 스위치 자급제 (300,000원/무료)',
      candidateTitle: '닌텐도 스위치 2 자급제 새상품',
      price: 300000,
    },
    {
      sourceTitle: '[G마켓] 애플 아이폰 16 128GB 자급제 (1,000,000원/무료)',
      candidateTitle: '애플 아이폰 16e 128GB 자급제 새상품',
      price: 1000000,
    },
  ];
  for (const sample of cases) {
    const source = { ...deal, title: sample.sourceTitle, priceAmount: sample.price, merchant: 'G마켓' };
    const candidate = item({
      title: sample.candidateTitle,
      mallName: 'G마켓',
      lprice: String(sample.price),
    });
    assert.notEqual(matchNaverCandidates(source, [candidate]).status, 'matched', sample.candidateTitle);
  }
});

test('OLED 같은 이름형 파생 모델과 서로 모순되는 맛 옵션은 자동 매칭하지 않는다', () => {
  const cases = [
    ['닌텐도 스위치', '닌텐도 스위치 OLED 새상품', 300000, '닌텐도'],
    ['닌텐도 스위치 OLED', '닌텐도 스위치 새상품', 300000, '닌텐도'],
    ['오뚜기 진라면 매운맛', '오뚜기 진라면 순한맛 새상품', 4000, '오뚜기'],
    ['오뚜기 진라면 컵라면 봉지라면 120g', '오뚜기 진라면 컵라면 봉지라면 120g 순한맛 새상품', 4000, '오뚜기'],
  ];
  for (const [sourceName, candidateTitle, price, brand] of cases) {
    const source = {
      ...deal,
      title: sourceName,
      priceAmount: price,
      merchant: 'G마켓',
    };
    const candidate = item({
      title: candidateTitle,
      mallName: 'G마켓',
      lprice: String(price),
      maker: brand,
      brand,
    });
    assert.notEqual(matchNaverCandidates(source, [candidate]).status, 'matched', `${sourceName} -> ${candidateTitle}`);
  }
});

test('공식 네이버 쇼핑 이미지 HTTPS 호스트가 아니면 연결하지 않는다', () => {
  for (const image of [
    'http://shopping-phinf.pstatic.net/main_123/123.jpg',
    'https://evil.example/123.jpg',
    'https://shopping-phinf.pstatic.net.evil.example/123.jpg',
    'https://user:pass@shopping-phinf.pstatic.net/123.jpg',
  ]) {
    const result = matchNaverCandidates(deal, [item({ image })]);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.reason, 'no_qualified_candidate');
  }
});

test('판매처나 유효한 가격이 없는 원본은 API를 호출하지 않고 unresolved 처리한다', async () => {
  let calls = 0;
  const config = readNaverShoppingConfig({ NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' });
  const provider = createNaverShoppingProvider({
    config,
    fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); },
  });
  for (const source of [
    { ...deal, merchant: null },
    { ...deal, priceAmount: null },
  ]) {
    const result = await provider.match(source);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.reason, 'insufficient_source_evidence');
  }
  assert.equal(calls, 0);
});

test('provider는 고정 HTTPS endpoint와 공식 인증 헤더로 최대 20개 후보를 요청한다', async () => {
  let request;
  const provider = createNaverShoppingProvider({
    config: readNaverShoppingConfig({ NAVER_CLIENT_ID: 'client-id', NAVER_CLIENT_SECRET: 'client-secret' }),
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json; charset=utf-8' },
        json: async () => ({ total: 1, start: 1, display: 1, items: [item()] }),
      };
    },
  });
  const result = await provider.match(deal);
  assert.equal(result.status, 'matched');
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://openapi.naver.com/v1/search/shop.json');
  assert.equal(url.searchParams.get('display'), '20');
  assert.equal(url.searchParams.get('sort'), 'sim');
  assert.equal(url.searchParams.get('query'), '삼성전자 갤럭시 S25 256GB 블루 자급제');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers['X-Naver-Client-Id'], 'client-id');
  assert.equal(request.options.headers['X-Naver-Client-Secret'], 'client-secret');
});

test('provider는 비정상 HTTP·content-type·응답 스키마를 명시적으로 실패시킨다', async () => {
  const config = readNaverShoppingConfig({ NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' });
  await assert.rejects(
    () => createNaverShoppingProvider({ config, fetchImpl: async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' } }) }).match(deal),
    /HTTP 401/,
  );
  await assert.rejects(
    () => createNaverShoppingProvider({ config, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' } }) }).match(deal),
    /content type/,
  );
  await assert.rejects(
    () => createNaverShoppingProvider({ config, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ items: null }) }) }).match(deal),
    /response schema/,
  );
});

test('provider timeout은 응답 헤더뿐 아니라 body 소비가 끝날 때까지 적용된다', async () => {
  const config = readNaverShoppingConfig({ NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' });
  const provider = createNaverShoppingProvider({
    config,
    timeoutMs: 20,
    fetchImpl: async (_url, options) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    }),
  });
  await assert.rejects(() => provider.match(deal), { name: 'AbortError' });
});

test('provider는 과도하게 큰 JSON 응답을 읽기 전에 거부한다', async () => {
  const config = readNaverShoppingConfig({ NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' });
  const provider = createNaverShoppingProvider({
    config,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : '2000000',
      },
      json: async () => ({ items: [] }),
    }),
  });
  await assert.rejects(() => provider.match(deal), /response body is too large/);
});
