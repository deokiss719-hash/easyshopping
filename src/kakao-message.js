const DNS_LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`;
const DNS_FINAL_LABEL = String.raw`[\p{L}\p{N}-]*\p{L}[\p{L}\p{N}-]*`;
const URL_LIKE_SOURCE = String.raw`(?:
  \[[0-9a-f:.%]+\](?::\d+)?(?:[/?#][^\s]*)?
  |(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%[\p{L}\p{N}_.-]+)?(?:[/?#][^\s]*)?
  |[a-z][a-z\d+.-]{0,31}:(?:\/\/)?[^\s]*
  |\/\/[^\s]+
  |www\.[^\s]+
  |(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#][^\s]*)?
  |(?:${DNS_LABEL}\.)+${DNS_FINAL_LABEL}(?::\d+)?(?:[/?#][^\s]*)?
)`.replace(/\s+/gu, '');
const URI_SCHEME_PATTERN = /[a-z][a-z\d+.-]{0,31}:(?:\/\/)?[^\s]*/giu;
const URL_LIKE_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}_-])${URL_LIKE_SOURCE}`, 'giu');
const DECIMAL_OR_VERSION_PATTERN = /^(?:v(?:ersion)?\s*)?\d+(?:[.,]\d+)+(?:원|달러|엔|위안|%|배|ml|cl|dl|l|mg|g|kg|mm|cm|m|km|mah|wh|w|v|a|hz|khz|mhz|ghz|kb|mb|gb|tb|인치)?[.,!]?$/iu;
const IPV4_PREFIX_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}/u;
const INLINE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const MESSAGE_CONTROL_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/u;
const AI_WRITING_INSTRUCTION = '상품명·카테고리·가격·판매처를 보고 해당 상품에 맞는 한국어 한 문장만 작성하세요. 35자 안팎으로 짧고 담백하게 쓰고, 매번 표현을 바꾸세요. 입력에 없는 할인·최저가·역대가·품절임박 정보와 URL·숫자·설명은 출력하지 마세요.';
const SAFE_FALLBACK_INTRO = '상품 정보를 확인해보세요.';
const TOSS_SHARELINK_DISCLOSURE = '이 콘텐츠는 토스쇼핑 쉐어링크 활동의 일환으로, 링크를 통한 구매가 발생하면 일정 수수료를 지급받습니다.';
const GENERIC_RECOMMENDATION_FORMS = new Set([
  '눈여겨볼 만한 상품을 소개해요.',
  '가볍게 살펴볼 만한 구성이에요.',
  '가볍게 살펴보기 좋은 구성이에요.',
  '관심 있게 살펴볼 만한 상품이에요.',
]);
const DISPLAY_TITLE_REPLACEMENTS = Object.freeze([
  Object.freeze([/(?<!\p{L})스니커증(?!\p{L})/gu, '스니커즈']),
]);
const UNSUPPORTED_CLAIM_PATTERN = /(?:역대|최저가|최저가격|품절|매진|완판|소진|반값|저렴|싸게|싼가격|가격(?:이|가)?(?:(?:아주|정말|꽤|많이|확|크게))*(?:내렸|내린|떨어졌|하락|인하)|재고|한정수량|오늘만|지금사|서두르|무조건|강추|대박|베스트|가장인기|특가|세일|할인|쿠폰|카드혜택|카드할인|무료배송|배송비(?:없|무료))/iu;

function requireDeal(deal) {
  for (const name of ['title', 'originalUrl']) {
    if (typeof deal?.[name] !== 'string' || !deal[name]) throw new TypeError(`deal.${name} is required`);
  }
  for (const name of ['title', 'priceText', 'merchant', 'shipping', 'originalUrl']) {
    const value = deal?.[name];
    if (typeof value === 'string' && (INLINE_CONTROL_PATTERN.test(value)
        || (name !== 'originalUrl' && value.includes(TOSS_SHARELINK_DISCLOSURE)))) {
      throw new TypeError(`deal.${name} is unsafe`);
    }
  }
  return deal;
}

function withoutUrls(value) {
  if (value == null) return '';
  URL_LIKE_PATTERN.lastIndex = 0;
  const withoutBoundaryUrls = String(value).replace(URL_LIKE_PATTERN, (candidate) => (
    !IPV4_PREFIX_PATTERN.test(candidate) && DECIMAL_OR_VERSION_PATTERN.test(candidate) ? candidate : ''
  ));
  return withoutBoundaryUrls.replace(URI_SCHEME_PATTERN, '').trim();
}

function containsUrlLike(value) {
  const text = String(value).trim();
  return withoutUrls(text) !== text;
}

function buildAiInput(deal) {
  requireDeal(deal);
  const bounded = (value) => withoutUrls(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, ' ')
    .replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300);
  return {
    instruction: AI_WRITING_INSTRUCTION,
    title: bounded(deal.title),
    price: bounded(deal.priceText),
    merchant: bounded(deal.merchant),
    category: bounded(deal.category),
    shipping: bounded(deal.shipping),
    sourceDescription: bounded(deal.description),
  };
}

function normalizedStatement(value) {
  return String(value).normalize('NFKC').replace(/\s+/gu, '').replace(/[.!?。！？]+$/gu, '');
}

function normalizeDisplayTitle(originalTitle) {
  if (typeof originalTitle !== 'string' || !originalTitle) throw new TypeError('title is required');
  let displayTitle = originalTitle;
  for (const [typo, correction] of DISPLAY_TITLE_REPLACEMENTS) {
    displayTitle = displayTitle.replaceAll(typo, correction);
  }
  return displayTitle;
}

function categoryKind(category) {
  const value = String(category ?? '').normalize('NFKC').toLowerCase();
  if (/(?:식품|음료|간식|과자|먹거리)/u.test(value)) return 'food';
  if (/(?:생활|주방|욕실|청소|위생)/u.test(value)) return 'living';
  if (/(?:전자|디지털|가전|컴퓨터|모바일)/u.test(value)) return 'electronics';
  if (/(?:패션|의류|신발|잡화)/u.test(value)) return 'fashion';
  return 'other';
}

function titleKeywords(title, merchant) {
  const merchantText = normalizedStatement(merchant ?? '').toLowerCase();
  const stopwords = new Set(['상품', '제품', '구성', '세트', '선택', '무료배송', '무배', '국산', '남성', '여성']);
  return String(title)
    .normalize('NFKC')
    .replace(/^\s*(?:\[[^\]]+\]\s*)+/u, '')
    .replace(/\([^)]*(?:원|배송|무배)[^)]*\)\s*$/u, '')
    .split(/[^\p{L}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2
      && !stopwords.has(token)
      && normalizedStatement(token).toLowerCase() !== merchantText);
}

function variant(title, templates) {
  const index = [...String(title)].reduce((hash, character) => (
    (hash * 31 + character.codePointAt(0)) >>> 0
  ), 0) % templates.length;
  return templates[index];
}

function fallbackIntro(deal) {
  const kind = categoryKind(deal.category);
  const label = titleKeywords(deal.title, deal.merchant).slice(0, 2).join(' ').slice(0, 16);
  if (kind === 'food') {
    const foodLabel = label || '이 식품';
    return variant(deal.title, [
      `${foodLabel} 쟁여두고 먹을 구성인지 살펴보세요.`,
      `${foodLabel} 간식이나 식사로 둘 구성인지 보세요.`,
      `${foodLabel} 자주 먹는 제품이면 구성을 확인해보세요.`,
    ]);
  }
  if (kind === 'living') {
    const livingLabel = label || '이 생활용품';
    return variant(deal.title, [
      `${livingLabel} 자주 쓴다면 가격을 체크해보세요.`,
      `${livingLabel} 필요했다면 구성을 살펴보세요.`,
      `${livingLabel} 꾸준히 쓴다면 가격을 확인해보세요.`,
    ]);
  }
  if (kind === 'electronics') {
    const electronicsLabel = label || '이 전자제품';
    return variant(deal.title, [
      `${electronicsLabel} 기다렸다면 가격을 확인해보세요.`,
      `${electronicsLabel} 찾던 기기라면 가격대를 살펴보세요.`,
      `${electronicsLabel} 고려했다면 현재 가격을 확인해보세요.`,
    ]);
  }
  if (kind === 'fashion' && label) return variant(deal.title, [
    `${label} 찾았다면 가격 한번 볼 만해요.`,
    `${label} 찾고 있었다면 구성을 살펴보세요.`,
    `${label} 필요했다면 현재 가격을 확인해보세요.`,
  ]);
  if (!label) return SAFE_FALLBACK_INTRO;
  return variant(deal.title, [
    `${label} 필요한 제품인지 한번 확인해보세요.`,
    `${label} 찾고 있었다면 가격을 살펴보세요.`,
    `${label} 관심 있었다면 구성을 확인해보세요.`,
  ]);
}

function isProductRelevant(intro, deal) {
  const normalizedIntro = normalizedStatement(intro).toLowerCase();
  return titleKeywords(deal.title, deal.merchant)
    .some((token) => normalizedIntro.includes(normalizedStatement(token).toLowerCase()));
}

function safeIntro(candidate, deal) {
  const fallback = fallbackIntro(deal);
  if (typeof candidate !== 'string') return fallback;
  const intro = candidate.trim();
  if (!intro || intro.length < 12 || intro.length > 50 || /[\r\n\d]/u.test(intro) || containsUrlLike(intro)
      || UNSUPPORTED_CLAIM_PATTERN.test(intro.replace(/\s+/gu, '')) || GENERIC_RECOMMENDATION_FORMS.has(intro)) {
    return fallback;
  }
  const sentenceMarks = intro.match(/[.!?。！？]/gu) || [];
  if (sentenceMarks.length !== 1 || !/[.!?。！？]$/u.test(intro)) return fallback;

  const normalizedIntro = normalizedStatement(intro);
  const exactlyGrounded = [deal.title, deal.priceText, deal.merchant, deal.category, deal.shipping, deal.description]
    .filter((value) => typeof value === 'string' && value.trim())
    .some((value) => normalizedStatement(value) === normalizedIntro);
  return exactlyGrounded || isProductRelevant(intro, deal) ? intro : fallback;
}

function assertSafeMessage(message) {
  if (typeof message !== 'string' || !message
      || MESSAGE_CONTROL_PATTERN.test(message)
      || message.split(TOSS_SHARELINK_DISCLOSURE).length - 1 !== 1) {
    throw new TypeError('composed message is unsafe');
  }
  return message;
}

function compose(intro, deal, displayTitle) {
  const lines = ['🔥 이지핫딜', TOSS_SHARELINK_DISCLOSURE, '', intro, '', displayTitle];
  if (typeof deal.priceText === 'string' && deal.priceText) lines.push(`💰 ${deal.priceText}`);
  if (typeof deal.shipping === 'string' && deal.shipping) lines.push(`🚚 ${deal.shipping}`);
  if (typeof deal.merchant === 'string' && deal.merchant) lines.push(`🏪 ${deal.merchant}`);
  lines.push('', deal.originalUrl, '', '가격 변동·품절될 수 있어요.');
  return assertSafeMessage(lines.join('\n'));
}

async function createKakaoMessage({ deal, generateIntro, persistedMessage, persistedAiCallCount = 0 } = {}) {
  requireDeal(deal);
  if (containsUrlLike(deal.title)) throw new TypeError('deal.title is unsafe');
  const originalTitle = deal.title;
  const normalizedTitle = normalizeDisplayTitle(originalTitle);
  if (typeof persistedMessage === 'string' && persistedMessage) {
    assertSafeMessage(persistedMessage);
    const lines = persistedMessage.split('\n');
    const displayTitle = lines.includes(normalizedTitle) ? normalizedTitle : originalTitle;
    return {
      message: persistedMessage,
      originalTitle,
      displayTitle,
      aiCallCount: persistedAiCallCount,
      reused: true,
      aiOutcome: 'succeeded',
    };
  }
  if (typeof generateIntro !== 'function') throw new TypeError('generateIntro is required');
  // Exactly one invocation is attempted. Its DB reservation is owned by the caller.
  let candidate;
  let usedFallback = false;
  try {
    candidate = await generateIntro(buildAiInput(deal));
  } catch (_) {
    candidate = null;
    usedFallback = true;
  }
  const intro = safeIntro(candidate, deal);
  if (typeof candidate !== 'string' || intro !== candidate.trim()) usedFallback = true;
  return {
    message: compose(intro, deal, normalizedTitle),
    intro,
    originalTitle,
    displayTitle: normalizedTitle,
    aiCallCount: 1,
    reused: false,
    usedFallback,
    aiOutcome: usedFallback ? 'failed_or_uncertain' : 'succeeded',
  };
}

module.exports = {
  AI_WRITING_INSTRUCTION,
  SAFE_FALLBACK_INTRO,
  TOSS_SHARELINK_DISCLOSURE,
  buildAiInput,
  assertSafeMessage,
  containsUrlLike,
  createKakaoMessage,
  fallbackIntro,
  normalizeDisplayTitle,
};
