const NAVER_SHOPPING_ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';
const NAVER_IMAGE_BASE_URLS = Object.freeze(['https://shopping-phinf.pstatic.net/']);
const DEFAULT_DISPLAY = 20;
const DEFAULT_TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MIN_CONFIDENCE = 75;
const MIN_LEAD = 12;
const MAX_PRICE_DIFF_RATIO = 0.2;

const STOPWORDS = new Set([
  '무료', '무료배송', '배송', '핫딜', '특가', '할인', '쿠폰', '쿠폰가', '카드', '카드가', '적립',
  '최저가', '행사', '이벤트', '단독', '공식', '정품', '국내', '해외', '직구', '상품', '판매',
  '새상품', '신품', '자급제', '포함', '증정', '원',
]);
const ACCESSORY_TERMS = ['케이스', '커버', '필름', '보호필름', '충전기', '충전케이블', '스트랩', '리필', '부품'];
const OPTION_GROUPS = [
  ['블랙', '검정', 'black'], ['화이트', '흰색', 'white'], ['블루', '파랑', 'blue'],
  ['핑크', 'pink'], ['레드', '빨강', 'red'], ['그린', '초록', 'green'],
  ['그레이', '회색', 'gray', 'grey'], ['실버', 'silver'], ['골드', 'gold'],
  ['베이지', 'beige'], ['브라운', '갈색', 'brown'], ['퍼플', '보라', 'purple'],
];
const MERCHANT_ALIASES = new Map([
  ['g마켓', 'gmarket'], ['gmarket', 'gmarket'], ['지마켓', 'gmarket'],
  ['옥션', 'auction'], ['auction', 'auction'],
  ['11번가', '11st'], ['11st', '11st'],
  ['롯데on', 'lotteon'], ['롯데온', 'lotteon'], ['lotteon', 'lotteon'],
  ['ssgcom', 'ssg'], ['ssg', 'ssg'], ['쓱닷컴', 'ssg'],
  ['쿠팡', 'coupang'], ['coupang', 'coupang'],
  ['네이버쇼핑', 'naver'], ['네이버', 'naver'], ['스마트스토어', 'naver'],
  ['현대hmall', 'hmall'], ['현대홈쇼핑', 'hmall'], ['hmall', 'hmall'],
  ['w컨셉', 'wconcept'], ['wconcept', 'wconcept'],
  ['무신사', 'musinsa'], ['올리브영', 'oliveyoung'],
]);

function cleanText(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? match;
    const radix = key[1].toLowerCase() === 'x' ? 16 : 10;
    const raw = key.slice(radix === 16 ? 2 : 1);
    const codePoint = Number.parseInt(raw, radix);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try { return String.fromCodePoint(codePoint); } catch { return match; }
  });
}

function readNaverShoppingConfig(env = process.env) {
  const clientId = String(env.NAVER_CLIENT_ID || '').trim();
  const clientSecret = String(env.NAVER_CLIENT_SECRET || '').trim();
  const missing = [];
  if (!clientId) missing.push('NAVER_CLIENT_ID');
  if (!clientSecret) missing.push('NAVER_CLIENT_SECRET');
  if (missing.length === 2) return Object.freeze({ enabled: false, missing });
  if (missing.length) throw new Error('NAVER_CLIENT_ID and NAVER_CLIENT_SECRET must be configured together');
  return Object.freeze({ enabled: true, clientId, clientSecret, imageBaseUrls: NAVER_IMAGE_BASE_URLS });
}

function buildSearchQuery(deal) {
  let title = cleanText(deal?.title);
  title = title.replace(/^\s*\[[^\]]{1,80}\]\s*/, ' ');
  title = title.replace(/\([^)]*(?:\d[\d,]*\s*원|무료배송|무료|배송비|쿠폰|카드)[^)]*\)/gi, ' ');
  title = title.replace(/\b\d[\d,]*\s*원\b/gi, ' ');
  title = title.replace(/\b(?:무료배송|배송비무료|쿠폰가|카드가|적립|핫딜|특가)\b/gi, ' ');
  return title.replace(/[|/]+\s*(?:무료|무료배송|배송비.*)$/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function normalizeMerchant(value) {
  const compact = cleanText(value).toLowerCase().replace(/[\s._-]+/g, '');
  return MERCHANT_ALIASES.get(compact) || compact;
}

function canonicalText(value) {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return canonicalText(value).split(' ').filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function modelTokens(value) {
  const found = canonicalText(value).match(/\b(?=[a-z0-9-]{3,}\b)(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*\b/g) || [];
  return new Set(found.filter((token) => !/^\d+(?:gb|tb|mb|kg|g|ml|l|cm|mm)$/.test(token)));
}

function measurementMap(value) {
  const result = new Map();
  const input = canonicalText(value).replace(/\s+/g, '');
  const regex = /(\d+(?:\.\d+)?)(tb|gb|mb|kg|g|ml|l|cm|mm|인치)/gi;
  let match;
  while ((match = regex.exec(input))) {
    let amount = Number(match[1]);
    let unit = match[2].toLowerCase();
    if (unit === 'kg') { amount *= 1000; unit = 'g'; }
    if (unit === 'l') { amount *= 1000; unit = 'ml'; }
    const values = result.get(unit) || new Set();
    values.add(String(amount));
    result.set(unit, values);
  }
  return result;
}

function quantityMap(value) {
  const result = new Map();
  const input = canonicalText(value).replace(/\s+/g, '');
  const regex = /(\d+)\s*(개입|개|봉|팩|캔|병|롤|매|입|포|세트|종)/g;
  let match;
  while ((match = regex.exec(input))) {
    const unit = match[2] === '개입' ? '개' : match[2];
    const values = result.get(unit) || new Set();
    values.add(match[1]);
    result.set(unit, values);
  }
  return result;
}

function optionSet(value) {
  const text = canonicalText(value);
  const options = new Set();
  OPTION_GROUPS.forEach((aliases, index) => {
    if (aliases.some((alias) => text.includes(alias))) options.add(String(index));
  });
  return options;
}

function condition(value) {
  const text = canonicalText(value);
  if (/(?:중고|\bused\b)/.test(text)) return 'used';
  if (/(?:리퍼비시|리퍼|\brefurbished\b|\brefurb\b)/.test(text)) return 'refurbished';
  return 'new';
}

function identityVariantSet(value) {
  const text = cleanText(value).toLowerCase();
  const variants = new Set();
  if (/(?:[a-z][a-z0-9-]*\d|\d[a-z][a-z0-9-]*)\s*\+/i.test(text)) variants.add('plus');
  const aliases = new Map([
    ['plus', 'plus'], ['플러스', 'plus'], ['pro', 'pro'], ['프로', 'pro'],
    ['max', 'max'], ['맥스', 'max'], ['ultra', 'ultra'], ['울트라', 'ultra'],
    ['fe', 'fe'], ['mini', 'mini'], ['미니', 'mini'], ['air', 'air'], ['에어', 'air'],
    ['edge', 'edge'], ['엣지', 'edge'], ['lite', 'lite'], ['라이트', 'lite'],
    ['se', 'se'], ['에스이', 'se'], ['oled', 'oled'],
  ]);
  const normalized = canonicalText(text);
  for (const token of normalized.split(' ')) {
    if (aliases.has(token)) variants.add(aliases.get(token));
  }
  for (const match of normalized.matchAll(/(?:^|\s)(\d+)\s*세대(?:\s|$)/g)) variants.add(`generation:${match[1]}`);
  for (const match of normalized.matchAll(/(?:^|\s)(?:gen|generation)\s*(\d+)(?:\s|$)/g)) variants.add(`generation:${match[1]}`);
  return variants;
}

function purchaseModeSet(value) {
  const text = canonicalText(value);
  const modes = new Set();
  if (/(?:^|\s)(?:자급제|unlocked)(?:\s|$)/.test(text)) modes.add('unlocked');
  if (/(?:^|\s)skt(?:\s|$)/.test(text)) modes.add('carrier:skt');
  if (/(?:^|\s)kt(?:\s|$)/.test(text)) modes.add('carrier:kt');
  if (/(?:^|\s)(?:lgu|lg유플러스|유플러스)(?:\s|$)/.test(text)) modes.add('carrier:lgu');
  return modes;
}

function bundleSet(value) {
  const text = cleanText(value).toLowerCase();
  const bundles = new Set();
  for (const match of text.matchAll(/(?:^|\D)(\d+)\s*\+\s*(\d+)(?!\d)/g)) bundles.add(`${match[1]}+${match[2]}`);
  for (const match of text.matchAll(/(?:^|\s)[x×]\s*(\d+)(?:\s|$)/g)) bundles.add(`x${match[1]}`);
  return bundles;
}

function familyVersionMap(value) {
  const text = canonicalText(buildSearchQuery({ title: value }));
  const tokens = text.split(' ').filter(Boolean);
  const versions = new Map();
  const add = (family, version) => {
    if (!versions.has(family)) versions.set(family, new Set());
    versions.get(family).add(version);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const compact = token.match(/^(\p{L}{2,})(\d+[a-z]?)$/u);
    if (compact) {
      add(compact[1], compact[2]);
      continue;
    }
    if (!/^\d+[a-z]?$/.test(token) || index === 0) continue;
    const family = tokens[index - 1];
    if (/^\p{L}[\p{L}-]+$/u.test(family) && !STOPWORDS.has(family)) add(family, token);
  }
  return versions;
}

function mapsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, values] of left) {
    if (!right.has(key) || !setsEqual(values, right.get(key))) return false;
  }
  return true;
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

function mapsCompatible(source, candidate, { rejectCandidateOnly = false } = {}) {
  for (const [unit, values] of source) {
    const other = candidate.get(unit);
    if (!other || !setsEqual(values, other)) return false;
  }
  if (rejectCandidateOnly) {
    for (const [unit, values] of candidate) {
      if (!source.has(unit) && [...values].some((value) => Number(value) > 1)) return false;
    }
  }
  return true;
}

function isSafeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isSafeNaverImageUrl(value) {
  if (!isSafeHttpsUrl(value)) return false;
  const url = new URL(value);
  return url.hostname === 'shopping-phinf.pstatic.net';
}

function scoreCandidate(deal, item) {
  const sourceTitle = cleanText(deal.title);
  const candidateTitle = cleanText(item.title);
  if (!sourceTitle || !candidateTitle) return { qualified: false, reason: 'missing_title' };
  if (!deal.merchant || normalizeMerchant(deal.merchant) !== normalizeMerchant(item.mallName)) {
    return { qualified: false, reason: 'merchant_mismatch' };
  }
  if (!isSafeHttpsUrl(item.link) || !isSafeNaverImageUrl(item.image)) {
    return { qualified: false, reason: 'unsafe_result_url' };
  }

  const sourcePrice = Number(deal.priceAmount);
  const candidatePrice = Number(item.lprice);
  if (!Number.isFinite(sourcePrice) || sourcePrice <= 0 || !Number.isFinite(candidatePrice) || candidatePrice <= 0) {
    return { qualified: false, reason: 'missing_price' };
  }
  const priceDiffRatio = Math.abs(sourcePrice - candidatePrice) / sourcePrice;
  if (priceDiffRatio > MAX_PRICE_DIFF_RATIO) return { qualified: false, reason: 'price_mismatch', priceDiffRatio };

  const sourceCondition = condition(sourceTitle);
  const candidateCondition = condition(candidateTitle);
  if (sourceCondition !== candidateCondition) return { qualified: false, reason: 'condition_mismatch' };
  if (!setsEqual(identityVariantSet(sourceTitle), identityVariantSet(candidateTitle))) {
    return { qualified: false, reason: 'variant_mismatch' };
  }
  if (!setsEqual(purchaseModeSet(sourceTitle), purchaseModeSet(candidateTitle))) {
    return { qualified: false, reason: 'purchase_mode_mismatch' };
  }
  if (!setsEqual(bundleSet(sourceTitle), bundleSet(candidateTitle))) {
    return { qualified: false, reason: 'bundle_mismatch' };
  }
  if (!mapsEqual(familyVersionMap(sourceTitle), familyVersionMap(candidateTitle))) {
    return { qualified: false, reason: 'family_version_mismatch' };
  }

  const sourceModels = modelTokens(sourceTitle);
  const candidateModels = modelTokens(`${candidateTitle} ${item.brand || ''} ${item.maker || ''}`);
  if (sourceModels.size && ![...sourceModels].every((value) => candidateModels.has(value))) {
    return { qualified: false, reason: 'model_mismatch' };
  }

  const sourceMeasurements = measurementMap(sourceTitle);
  const candidateMeasurements = measurementMap(candidateTitle);
  if (!mapsEqual(sourceMeasurements, candidateMeasurements)) return { qualified: false, reason: 'measurement_mismatch' };

  const sourceQuantities = quantityMap(sourceTitle);
  const candidateQuantities = quantityMap(candidateTitle);
  if (!mapsCompatible(sourceQuantities, candidateQuantities, { rejectCandidateOnly: true })) {
    return { qualified: false, reason: 'quantity_mismatch' };
  }

  const sourceOptions = optionSet(sourceTitle);
  const candidateOptions = optionSet(candidateTitle);
  if (!setsEqual(sourceOptions, candidateOptions)) return { qualified: false, reason: 'option_mismatch' };

  const sourceCanonical = canonicalText(sourceTitle);
  const candidateCanonical = canonicalText(candidateTitle);
  for (const term of ACCESSORY_TERMS) {
    if (!sourceCanonical.includes(term) && candidateCanonical.includes(term)) return { qualified: false, reason: 'accessory_mismatch' };
  }

  const sourceTokens = new Set(tokens(buildSearchQuery(deal)));
  const candidateTokens = new Set(tokens(candidateTitle));
  const common = [...sourceTokens].filter((token) => candidateTokens.has(token));
  const coverage = sourceTokens.size ? common.length / sourceTokens.size : 0;
  const candidateCoverage = candidateTokens.size ? common.length / candidateTokens.size : 0;
  const sourceOnly = [...sourceTokens].filter((token) => !candidateTokens.has(token));
  const candidateOnly = [...candidateTokens].filter((token) => !sourceTokens.has(token));
  if (sourceOnly.length || candidateOnly.length) {
    return { qualified: false, reason: 'title_token_conflict', coverage, candidateCoverage };
  }
  if (coverage < 0.8 || candidateCoverage < 0.8) {
    return { qualified: false, reason: 'title_mismatch', coverage, candidateCoverage };
  }

  const brand = canonicalText(item.brand || item.maker || '');
  const brandMatched = Boolean(brand && (sourceCanonical.includes(brand) || brand.split(' ').some((part) => part.length >= 2 && sourceCanonical.includes(part))));
  const evidenceKinds = Number(sourceModels.size > 0) + Number(sourceMeasurements.size > 0)
    + Number(sourceQuantities.size > 0) + Number(sourceOptions.size > 0) + Number(brandMatched);
  if (evidenceKinds < 1 && sourceTokens.size < 3) return { qualified: false, reason: 'insufficient_identity' };

  const score = 25
    + Math.round(coverage * 30)
    + Math.round((1 - priceDiffRatio / MAX_PRICE_DIFF_RATIO) * 20)
    + (sourceModels.size ? 15 : 0)
    + (sourceMeasurements.size ? 10 : 0)
    + (sourceQuantities.size ? 10 : 0)
    + (sourceOptions.size ? 5 : 0)
    + (brandMatched ? 10 : 0);

  return {
    qualified: score >= MIN_CONFIDENCE,
    reason: score >= MIN_CONFIDENCE ? 'qualified' : 'low_confidence',
    score,
    coverage,
    priceDiffRatio,
    evidenceKinds,
  };
}

function matchNaverCandidates(deal, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { status: 'unresolved', reason: 'no_candidates', candidateCount: 0, query: buildSearchQuery(deal) };
  }
  const scored = items.map((item, index) => ({ item, index, assessment: scoreCandidate(deal, item) }));
  const qualified = scored
    .filter(({ assessment }) => assessment.qualified)
    .sort((left, right) => right.assessment.score - left.assessment.score || left.index - right.index);
  if (!qualified.length) {
    return { status: 'unresolved', reason: 'no_qualified_candidate', candidateCount: items.length, query: buildSearchQuery(deal) };
  }
  if (qualified.length > 1 && qualified[0].assessment.score - qualified[1].assessment.score < MIN_LEAD) {
    return { status: 'unresolved', reason: 'ambiguous_candidates', candidateCount: items.length, query: buildSearchQuery(deal) };
  }

  const winner = qualified[0];
  return {
    status: 'matched',
    reason: 'unique_high_confidence_candidate',
    candidateCount: items.length,
    query: buildSearchQuery(deal),
    confidence: winner.assessment.score,
    match: {
      productId: String(winner.item.productId || ''),
      merchantUrl: String(winner.item.link),
      sourceImageUrl: String(winner.item.image),
      imageUrl: String(winner.item.image),
      imageStatus: 'ready',
      imageProvider: 'naver-shopping',
      matchedMallName: cleanText(winner.item.mallName),
      matchedTitle: cleanText(winner.item.title),
      matchedPrice: Number(winner.item.lprice),
    },
  };
}

async function cancelResponse(response) {
  try { await response?.body?.cancel?.(); } catch { /* best effort */ }
}

async function readLimitedJsonResponse(response) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await cancelResponse(response);
    throw new Error('Naver Shopping API response body is too large');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw new Error('Naver Shopping API response body is too large');
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      try { await reader.cancel(); } catch { /* best effort */ }
      throw error;
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Naver Shopping API response body is too large');
    return JSON.parse(text);
  }
  if (typeof response.json === 'function') {
    const body = await response.json();
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Naver Shopping API response body is too large');
    return body;
  }
  throw new Error('Naver Shopping API response body is unavailable');
}

function createNaverShoppingProvider({ config, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!config || config.enabled !== true) throw new TypeError('enabled Naver Shopping config is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) throw new TypeError('timeoutMs is invalid');

  return Object.freeze({
    name: 'naver-shopping',
    enabled: true,
    imageBaseUrls: NAVER_IMAGE_BASE_URLS,
    async match(deal) {
      const sourcePrice = Number(deal?.priceAmount);
      if (!normalizeMerchant(deal?.merchant) || !Number.isSafeInteger(sourcePrice) || sourcePrice <= 0) {
        return { status: 'unresolved', reason: 'insufficient_source_evidence', candidateCount: 0, query: '' };
      }
      const query = buildSearchQuery(deal);
      if (!query) return { status: 'unresolved', reason: 'empty_query', candidateCount: 0, query };
      const url = new URL(NAVER_SHOPPING_ENDPOINT);
      url.searchParams.set('query', query);
      url.searchParams.set('display', String(DEFAULT_DISPLAY));
      url.searchParams.set('start', '1');
      url.searchParams.set('sort', 'sim');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'X-Naver-Client-Id': config.clientId,
            'X-Naver-Client-Secret': config.clientSecret,
          },
        });
        if (!response?.ok) {
          await cancelResponse(response);
          throw new Error(`Naver Shopping API HTTP ${response?.status || 'unknown'}`);
        }
        const contentType = String(response.headers?.get?.('content-type') || '');
        if (!/^application\/json\b/i.test(contentType)) {
          await cancelResponse(response);
          throw new Error('Naver Shopping API returned an invalid content type');
        }
        const body = await readLimitedJsonResponse(response);
        if (!body || !Array.isArray(body.items)) throw new Error('Naver Shopping API response schema is invalid');
        return matchNaverCandidates(deal, body.items.slice(0, DEFAULT_DISPLAY));
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

module.exports = {
  NAVER_IMAGE_BASE_URLS,
  readNaverShoppingConfig,
  buildSearchQuery,
  matchNaverCandidates,
  createNaverShoppingProvider,
};
