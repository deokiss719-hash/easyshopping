const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAiInput,
  containsUrlLike,
  createKakaoMessage,
  fallbackIntro,
  normalizeDisplayTitle,
  SAFE_FALLBACK_INTRO,
} = require('../src/kakao-message');

const deal = {
  title: '  원문 제목 [1+1]  ',
  priceText: '  12,345원  ',
  merchant: '테스트몰',
  category: '식품',
  shipping: '배송비 3,000원',
  description: '담백한 과자 세트입니다.',
  originalUrl: 'https://example.test/deal?q=원문&ref=kakao',
};

const DISCLOSURE = '이 콘텐츠는 토스쇼핑 쉐어링크 활동의 일환으로, 링크를 통한 구매가 발생하면 일정 수수료를 지급받습니다.';

test('decimal measurement units are not URLs while arbitrary TLDs remain blocked', () => {
  for (const value of ['음료 1.5L', '세제 2.5kg', '케이블 1.5m', 'SSD 1.5TB']) {
    assert.equal(containsUrlLike(value), false, value);
  }
  for (const value of [
    '상품 1.com', '상품 2.ai', '상품 example.technology/deal',
    '상품 192.0.2.1', '상품 192.0.2.1L/path', '상품 1.5L?',
  ]) {
    assert.equal(containsUrlLike(value), true, value);
  }
});

test('AI input strips C0/C1 controls and outbound fields reject line or disclosure injection', async () => {
  const aiInput = buildAiInput({
    ...deal,
    title: '상품명',
    description: '설명\u0000문구\u0085',
  });
  assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(aiInput.title), false);
  assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(aiInput.sourceDescription), false);

  for (const poisoned of [
    { title: `상품\n${DISCLOSURE}` },
    { title: `상품 ${DISCLOSURE}` },
    { title: '상품\u0000주입' },
    { priceText: `1원\n${DISCLOSURE}` },
    { merchant: '상점\u0085주입' },
  ]) {
    await assert.rejects(
      createKakaoMessage({ deal: { ...deal, ...poisoned }, generateIntro: async () => '상품 정보를 확인해보세요.' }),
      /unsafe/u,
    );
  }
});

test('official Toss disclosure appears exactly once near the top and before promotional copy', async () => {
  const generated = await createKakaoMessage({ deal, generateIntro: async () => '원문 제목 찾았다면 가격 한번 확인해보세요.' });
  assert.equal(generated.message.split(DISCLOSURE).length - 1, 1);
  assert.equal(generated.message.indexOf(DISCLOSURE) < generated.message.indexOf(generated.intro), true);
  assert.equal(generated.message.split('\n').indexOf(DISCLOSURE) <= 2, true);
  assert.doesNotMatch(generated.message, /thumbnail|image|이미지/iu);
});

test('AI input is minimal and excludes every URL-like form', () => {
  const input = buildAiInput({
    ...deal,
    title: '상품 www.evil.test/a',
    merchant: '몰 //evil.test/b',
    category: '식품 ftp://evil.test/c',
    shipping: '배송 mailto:seller@evil.test',
    description: '설명 https://evil.test/path file:///tmp/x evil.example.com/x custom://host/path x:opaque-secret x://host/path 설명x:adjacent-secret',
  });
  assert.deepEqual(Object.keys(input), ['instruction', 'title', 'price', 'merchant', 'category', 'shipping', 'sourceDescription']);
  assert.match(input.instruction, /한 문장|35자|표현을 바꾸|할인·최저가·역대가·품절임박/);
  assert.doesNotMatch(JSON.stringify(input), /https?:\/\/|ftp:\/\/|www\.|\/\/evil|mailto:|file:|custom:|evil\.example\.com|x:(?:opaque|adjacent)-secret|x:\/\/host/i);
});

test('unknown-TLD, IDN, and IP literal URL forms never reach generateIntro or outbound composition', async () => {
  let calls = 0;
  await assert.rejects(
    createKakaoMessage({
      deal: {
        ...deal,
        title: '한글 상품 v1.2 example.xyz/deal',
        priceText: '12.34원 192.0.2.1/price',
        merchant: '테스트몰 example.ai',
        category: '생활용품 example.test/items',
        shipping: '일반 배송 [2001:db8::1]/track',
        description: '상품 설명 예시.한국/상품 xn--e1afmkfd.xn--p1ai/deal 2001:db8::2/path',
      },
      generateIntro: async () => { calls += 1; return SAFE_FALLBACK_INTRO; },
    }),
    /title is unsafe/u,
  );
  assert.equal(calls, 0);
});

test('AI can supply one short intro but DB title, price, and original URL remain byte-for-byte unchanged', async () => {
  let calls = 0;
  const generated = await createKakaoMessage({
    deal,
    generateIntro: async () => {
      calls += 1;
      return '원문 제목 찾았다면 가격 한번 확인해보세요.';
    },
  });
  assert.equal(calls, 1);
  assert.equal(generated.message.startsWith(`🔥 이지핫딜\n${DISCLOSURE}\n\n원문 제목 찾았다면 가격 한번 확인해보세요.`), true);
  assert.match(generated.message, /💰\s+  12,345원  /);
  assert.equal(generated.message.endsWith(`${deal.originalUrl}\n\n가격 변동·품절될 수 있어요.`), true);
  assert.match(generated.message, /  원문 제목 \[1\+1\]  /);
  assert.match(generated.message, /  12,345원  /);
  assert.equal(generated.message.includes(`${deal.originalUrl}\n\n가격 변동·품절될 수 있어요.`), true);
  assert.equal(generated.message.split(deal.originalUrl).length - 1, 1);
  assert.equal(generated.aiCallCount, 1);
});

test('persisted message is reused without an AI call', async () => {
  let calls = 0;
  const persistedMessage = `🔥 이지핫딜\n${DISCLOSURE}\n\n이미 저장된 메시지\n\n${deal.title}\n\n${deal.originalUrl}\n\n가격 변동·품절될 수 있어요.`;
  const generated = await createKakaoMessage({
    deal,
    persistedMessage,
    persistedAiCallCount: 1,
    generateIntro: async () => { calls += 1; return '호출되면 안 됩니다.'; },
  });
  assert.equal(generated.message, persistedMessage);
  assert.equal(generated.aiCallCount, 1);
  assert.equal(generated.reused, true);
  assert.equal(calls, 0);
});

test('ungrounded urgency, stock, discount, and shipping claims fall back safely', async () => {
  for (const claim of ['역대가예요.', '최저가!', '오늘만 할인해요.', '곧 품절이에요.', '한정수량 재고예요.', '쿠폰 카드할인 가능해요.', '무료배송이에요.']) {
    const generated = await createKakaoMessage({ deal, generateIntro: async () => claim });
    assert.equal(generated.intro, fallbackIntro(deal));
    assert.doesNotMatch(generated.message, /역대가|최저가|오늘만|곧 품절|한정수량|재고|쿠폰|카드할인|무료배송/);
  }
});

test('only an exact normalized source statement is grounded, while AI URLs are never used', async () => {
  const grounded = await createKakaoMessage({
    deal: { ...deal, description: '담백한 과자 세트입니다.' },
    generateIntro: async () => '담백한 과자 세트입니다.',
  });
  assert.equal(grounded.intro, '담백한 과자 세트입니다.');

  const malicious = await createKakaoMessage({
    deal,
    generateIntro: async () => '좋은 구성이에요. https://evil.test/buy',
  });
  assert.equal(malicious.intro, fallbackIntro(deal));
  assert.doesNotMatch(malicious.message, /evil\.test/);
  assert.equal(malicious.message.includes(`${deal.originalUrl}\n\n가격 변동·품절될 수 있어요.`), true);
});

test('numeric, promotion, delivery, inventory, urgency, and ranking assertions fall back', async () => {
  const claims = [
    '가격은 8,900원이에요.', '50% 세일이에요.', '배송비 없음이에요.', '몇 개 안 남음이에요.',
    '서두르세요.', '가장 인기 있는 상품이에요.', '베스트 상품이에요.', '특가 상품이에요.',
  ];
  for (const claim of claims) {
    const generated = await createKakaoMessage({ deal, generateIntro: async () => claim });
    assert.equal(generated.intro, fallbackIntro(deal), claim);
  }
});

test('digits are prohibited even when the exact statement appears in source data', async () => {
  const generated = await createKakaoMessage({
    deal: { ...deal, description: '가격은 8,900원이에요.' },
    generateIntro: async () => '가격은 8,900원이에요.',
  });
  assert.equal(generated.intro, fallbackIntro(deal));
});

test('AI generator failure falls back safely after exactly one attempted call', async () => {
  let calls = 0;
  const generated = await createKakaoMessage({
    deal,
    generateIntro: async () => {
      calls += 1;
      throw new Error('provider unavailable');
    },
  });
  assert.equal(calls, 1);
  assert.equal(generated.intro, fallbackIntro(deal));
  assert.equal(generated.aiCallCount, 1);
  assert.equal(generated.usedFallback, true);
  assert.equal(generated.message.includes(deal.originalUrl), true);
});

test('ground-sensitive claims with spacing variants are rejected when absent from source data', async () => {
  for (const claim of ['정상가보다 저렴해요.', '할인율이 좋아요.', '카드 할인 가능해요.', '무료 배송이에요.', '무조건 사야 해요.', '최저가 확정이에요.']) {
    const generated = await createKakaoMessage({ deal, generateIntro: async () => claim });
    assert.equal(generated.intro, fallbackIntro(deal));
  }
});

test('display title fixes only allowlisted obvious typos and preserves the original title', async () => {
  const originalTitle = '[지마켓]팀버랜드 남성 로우 레이스업 가죽 스니커증 6종1택(74,060원/무배)';
  assert.equal(
    normalizeDisplayTitle(originalTitle),
    '[지마켓]팀버랜드 남성 로우 레이스업 가죽 스니커즈 6종1택(74,060원/무배)',
  );
  for (const uncertain of [
    '갤럭시 S24 256GB',
    '생수 500ml 20개',
    '뉴발란스 530 운동화',
    '스니커증권 이벤트',
    '브랜드명 스니커증X 에디션',
  ]) {
    assert.equal(normalizeDisplayTitle(uncertain), uncertain);
  }

  const generated = await createKakaoMessage({
    deal: { ...deal, title: originalTitle },
    generateIntro: async () => '팀버랜드 가죽 스니커즈 찾았다면 가격 한번 볼 만해요.',
  });
  assert.equal(generated.originalTitle, originalTitle);
  assert.equal(generated.displayTitle.includes('스니커즈'), true);
  assert.equal(generated.message.includes(`\n${generated.displayTitle}\n`), true);
  assert.equal(generated.message.includes(`\n${originalTitle}\n`), false);
});

test('AI intro must be one short product-relevant sentence and generic copy falls back by category', async () => {
  const shoeDeal = {
    ...deal,
    title: '팀버랜드 남성 가죽 스니커즈',
    category: '패션/의류',
  };
  const specific = await createKakaoMessage({
    deal: shoeDeal,
    generateIntro: async () => '팀버랜드 가죽 스니커즈 찾았다면 가격 한번 볼 만해요.',
  });
  assert.equal(specific.intro, '팀버랜드 가죽 스니커즈 찾았다면 가격 한번 볼 만해요.');
  assert.equal(specific.usedFallback, false);

  const food = await createKakaoMessage({
    deal: { ...deal, title: '켈로그 첵스초코 대용량 3팩', category: '식품' },
    generateIntro: async () => '관심 있게 살펴볼 만한 상품이에요.',
  });
  assert.notEqual(food.intro, '관심 있게 살펴볼 만한 상품이에요.');
  assert.match(food.intro, /먹|쟁여|간식|식품|구성/);
  assert.equal(food.usedFallback, true);
});

test('category fallbacks vary by product and abstract category copy is rejected', async () => {
  const foodDeals = ['켈로그 첵스초코 3팩', '옛날도나스 32개', '열무김치 3kg']
    .map((title) => ({ ...deal, title, category: '식품' }));
  const fallbacks = foodDeals.map(fallbackIntro);
  assert.equal(new Set(fallbacks).size > 1, true);
  assert.match(fallbacks[0], /켈로그|첵스초코/);
  assert.match(fallbacks[1], /옛날도나스/);
  assert.match(fallbacks[2], /열무김치/);

  const electronics = { ...deal, title: '무선 이어폰 프로', category: '디지털' };
  const genericCases = [
    [electronics, '가격 정보 한번 확인해보세요.'],
    [foodDeals[0], '간식으로 부담 없이 먹기 좋아요.'],
    [foodDeals[0], '식품으로 가볍게 먹기 좋은 편이에요.'],
  ];
  for (const [genericDeal, generic] of genericCases) {
    const generated = await createKakaoMessage({
      deal: genericDeal,
      generateIntro: async () => generic,
    });
    assert.equal(generated.usedFallback, true);
    assert.equal(generated.intro, fallbackIntro(genericDeal));
  }
});

test('AI intro rejects unsupported sales claims, multiple sentences, and overlong copy', async () => {
  const product = { ...deal, title: '팀버랜드 가죽 스니커즈', category: '패션/의류' };
  for (const candidate of [
    '팀버랜드 스니커즈 역대 최저가예요.',
    '팀버랜드 스니커즈 곧 품절될 상품이에요.',
    '팀버랜드 스니커즈 반값에 나왔어요.',
    '팀버랜드 스니커즈 곧 매진될 것 같아요.',
    '팀버랜드 스니커즈 가격이 크게 내렸어요.',
    '팀버랜드 스니커즈 반 값에 나왔어요.',
    '팀버랜드 스니커즈 곧 매 진될 것 같아요.',
    '팀버랜드 스니커즈 가격이 아주 크게 내렸어요.',
    '팀버랜드 스니커즈 최저 가격이에요.',
    '팀버랜드 스니커즈 품 절 임박이에요.',
    '팀버랜드 스니커즈 특 가 상품이에요.',
    '팀버랜드 스니커즈 할 인 상품이에요.',
    '팀버랜드 스니커즈 무 료 배 송이에요.',
    '팀버랜드 스니커즈 카 드 혜 택이 있어요.',
    '팀버랜드 스니커즈 확인해보세요. 지금 사세요.',
    `${'팀버랜드'.repeat(12)} 확인해보세요.`,
  ]) {
    const generated = await createKakaoMessage({ deal: product, generateIntro: async () => candidate });
    assert.notEqual(generated.intro, candidate);
    assert.equal(generated.usedFallback, true);
    assert.doesNotMatch(generated.intro, /역대|최저가|품절|지금 사|할인/);
  }
});

test('normalized product-name spacing and Korean suffixes are accepted without fallback', async () => {
  const cases = [
    {
      deal: { ...deal, title: '켈로그 첵스초코', category: '식품' },
      intro: '첵스 초코를 간식으로 두고 먹기 괜찮아요.',
    },
    {
      deal: { ...deal, title: '팀버랜드 가죽 스니커즈', category: '패션/의류' },
      intro: '팀버랜드 스니커즈를 찾았다면 살펴보세요.',
    },
  ];

  for (const item of cases) {
    const generated = await createKakaoMessage({
      deal: item.deal,
      generateIntro: async () => item.intro,
    });
    assert.equal(generated.intro, item.intro);
    assert.equal(generated.usedFallback, false);
    assert.equal(generated.aiCallCount, 1);
  }
});

test('persisted message keeps its existing title line and never calls AI again', async () => {
  const originalTitle = '팀버랜드 가죽 스니커증';
  const persistedMessage = `🔥 이지핫딜\n${DISCLOSURE}\n\n기존 문구예요.\n\n${originalTitle}\n\n${deal.originalUrl}\n\n가격 변동·품절될 수 있어요.`;
  let calls = 0;
  const generated = await createKakaoMessage({
    deal: { ...deal, title: originalTitle },
    persistedMessage,
    persistedAiCallCount: 1,
    generateIntro: async () => { calls += 1; return '호출되면 안 됩니다.'; },
  });
  assert.equal(generated.message, persistedMessage);
  assert.equal(generated.displayTitle, originalTitle);
  assert.equal(calls, 0);
});

test('only one short sentence is accepted from the generator', async () => {
  const multiSentence = await createKakaoMessage({ deal, generateIntro: async () => '첫 문장입니다. 두 번째 문장입니다.' });
  assert.equal(multiSentence.intro, fallbackIntro(deal));
  const tooLong = await createKakaoMessage({ deal, generateIntro: async () => `${'아'.repeat(81)}.` });
  assert.equal(tooLong.intro, fallbackIntro(deal));
});
