const crypto = require('node:crypto');
const { TOSS_SHARELINK_DISCLOSURE, containsUrlLike } = require('./kakao-message');

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password ? url.href : null;
  } catch (_) { return null; }
}

function assertRankingItems(items) {
  let previousRank = 0;
  const ranks = new Set();
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || !Number.isInteger(item.rank) || item.rank < 1
        || item.rank <= previousRank || ranks.has(item.rank)) {
      throw new Error('Toss ranking order is malformed or contains a duplicate rank');
    }
    previousRank = item.rank;
    ranks.add(item.rank);
    if (Number.isSafeInteger(item.tacaItemId) && item.tacaItemId > 0) {
      if (ids.has(item.tacaItemId)) throw new Error('Toss ranking contains a duplicate item');
      ids.add(item.tacaItemId);
    }
    if (typeof item.displayName === 'string' && item.displayName
        && (/[\r\n\u2028\u2029]|[\u0000-\u001f\u007f-\u009f]/u.test(item.displayName)
          || containsUrlLike(item.displayName) || item.displayName.includes(TOSS_SHARELINK_DISCLOSURE))) {
      throw new Error('Toss product title is unsafe');
    }
    for (const [name, value] of [['productUrl', item.productUrl], ['thumbnailUrl', item.thumbnailUrl]]) {
      if (typeof value === 'string' && value) {
        let parsed;
        try { parsed = new URL(value); } catch (_) { continue; }
        if (parsed.port) throw new Error(`Toss ${name} uses a nonstandard port`);
      }
    }
  }
}

function mapProduct(item, observedAt) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const rank = item.rank;
  const tacaItemId = Number.isSafeInteger(item.tacaItemId) && item.tacaItemId > 0 ? item.tacaItemId : null;
  const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : '';
  const thumbnailUrl = validHttps(item.thumbnailUrl);
  const productUrl = validHttps(item.productUrl);
  const productHost = productUrl ? new URL(productUrl).hostname : '';
  if (!Number.isInteger(rank) || rank < 1 || tacaItemId === null
      || !displayName || displayName.length > 500 || !thumbnailUrl || !productUrl
      || productHost !== 'toss.shopping'
      || !Number.isSafeInteger(item.displayPrice) || item.displayPrice <= 0
      || !Number.isSafeInteger(item.originalPrice) || item.originalPrice <= 0
      || !Number.isInteger(item.discountRate) || item.discountRate < 0 || item.discountRate > 100
      || typeof item.isSoldOut !== 'boolean'
      || typeof item.reviewScore !== 'number' || !Number.isFinite(item.reviewScore) || item.reviewScore < 0 || item.reviewScore > 5
      || !Number.isSafeInteger(item.reviewCount) || item.reviewCount < 0) return null;
  if (item.isSoldOut) return null;
  return Object.freeze({
    id: `toss:${tacaItemId}`,
    source: 'toss',
    title: displayName,
    priceText: `${new Intl.NumberFormat('ko-KR').format(item.displayPrice)}원`,
    priceAmount: item.displayPrice,
    merchant: '토스쇼핑',
    category: null,
    discountInfo: item.discountRate > 0 ? `${item.discountRate}% 할인` : null,
    firstSeenAt: observedAt,
    endedAt: null,
    isEnded: false,
    rank,
    tacaItemId,
    displayName,
    thumbnailUrl,
    productUrl,
    displayPrice: item.displayPrice,
    originalPrice: item.originalPrice,
    discountRate: item.discountRate,
    isSoldOut: false,
    reviewScore: item.reviewScore,
    reviewCount: item.reviewCount,
  });
}

function fingerprint(candidate) {
  const fields = ['id', 'source', 'tacaItemId', 'displayName', 'productUrl', 'displayPrice', 'originalPrice', 'discountRate', 'isSoldOut'];
  return crypto.createHash('sha256').update(JSON.stringify(fields.map((key) => candidate?.[key] ?? null))).digest('hex');
}

function assertEnvelope(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || !Array.isArray(result.items) || result.items.length > 100
      || typeof result.hasNext !== 'boolean'
      || !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
    throw new Error('Toss best-selling response is malformed');
  }
  assertRankingItems(result.items);
  return result.items;
}

function createTossBestCandidateReader({ client, observedAt = new Date() } = {}) {
  if (!client || typeof client.fetchBestSelling !== 'function' || typeof client.createLink !== 'function') {
    throw new TypeError('Toss sharelink client is required');
  }
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) throw new TypeError('observedAt must be valid');
  const observedIso = observed.toISOString();
  const selected = new Map();
  const materialized = new Map();

  async function fetchCandidates() {
    const items = assertEnvelope(await client.fetchBestSelling({ size: 100 }));
    const ids = new Set();
    return items.map((item) => mapProduct(item, observedIso)).filter((item) => {
      if (!item || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    });
  }

  return Object.freeze({
    async readLatestCandidates({ limit = 50 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit must be an integer at most 100');
      const candidates = (await fetchCandidates()).slice(0, limit);
      for (const candidate of candidates) selected.set(candidate.id, candidate);
      return candidates;
    },
    async materializeCandidate(candidate) {
      const canonical = selected.get(candidate?.id);
      if (!canonical || fingerprint(canonical) !== fingerprint(candidate)) throw new Error('candidate was not selected from current Toss ranking');
      if (materialized.has(canonical.id)) return materialized.get(canonical.id);
      const link = await client.createLink({ tacaItemId: canonical.tacaItemId });
      const linked = Object.freeze({ ...canonical, originalUrl: link.shortUrl });
      materialized.set(canonical.id, linked);
      return linked;
    },
    async readCandidateById({ dealId } = {}) {
      const id = typeof dealId === 'string' ? dealId.trim() : '';
      if (!id.startsWith('toss:')) throw new TypeError('namespaced Toss dealId is required');
      const original = selected.get(id);
      if (!original) return null;
      const fresh = (await fetchCandidates()).find((candidate) => candidate.id === id);
      if (!fresh || fingerprint(fresh) !== fingerprint(original)) return null;
      return materialized.get(id) || fresh;
    },
  });
}

module.exports = { createTossBestCandidateReader, fingerprint, mapProduct, assertEnvelope };
