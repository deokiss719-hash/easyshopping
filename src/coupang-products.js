const { createHmac } = require('node:crypto');
const { classifyDeal } = require('./deal-category');

const COUPANG_SOURCE = 'coupang';
const COUPANG_API_ORIGIN = 'https://api-gateway.coupang.com';
const COUPANG_API_PREFIX = '/v2/providers/affiliate_open_api/apis/openapi';
const OFFICIAL_CATEGORY_IDS = Object.freeze(['1012', '1013', '1014', '1016', '1024', '1029']);
const OFFICIAL_CATEGORY_ID_SET = new Set(OFFICIAL_CATEGORY_IDS);
const DEFAULT_CATEGORY_IDS = OFFICIAL_CATEGORY_IDS;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveInteger(value, fallback, minimum, maximum, name) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} is outside the supported range`);
  }
  return number;
}

function readCoupangRuntime(env = process.env) {
  const requested = env.COUPANG_PRODUCTS_ENABLED === 'true';
  if (!requested) {
    return {
      enabled: false,
      requested: false,
      missing: [],
      accessKey: null,
      secretKey: null,
      categoryIds: [...DEFAULT_CATEGORY_IDS],
      intervalMs: 6 * 60 * 60 * 1000,
      requestTimeoutMs: 10_000,
    };
  }
  const accessKey = hasValue(env.COUPANG_ACCESS_KEY) ? env.COUPANG_ACCESS_KEY.trim() : null;
  const secretKey = hasValue(env.COUPANG_SECRET_KEY) ? env.COUPANG_SECRET_KEY.trim() : null;
  const missing = [
    ...(!accessKey ? ['COUPANG_ACCESS_KEY'] : []),
    ...(!secretKey ? ['COUPANG_SECRET_KEY'] : []),
  ];
  if (missing.length > 0) {
    return {
      enabled: false,
      requested: true,
      missing,
      accessKey,
      secretKey,
      categoryIds: [...DEFAULT_CATEGORY_IDS],
      intervalMs: 6 * 60 * 60 * 1000,
      requestTimeoutMs: 10_000,
    };
  }
  const configuredIds = hasValue(env.COUPANG_CATEGORY_IDS)
    ? env.COUPANG_CATEGORY_IDS.split(',').map((value) => value.trim()).filter(Boolean)
    : [...DEFAULT_CATEGORY_IDS];
  if (configuredIds.length === 0 || configuredIds.some((value) => !OFFICIAL_CATEGORY_ID_SET.has(value))) {
    throw new Error('COUPANG_CATEGORY_IDS must contain only supported official category IDs');
  }
  return {
    enabled: requested && Boolean(accessKey && secretKey),
    requested,
    missing: requested ? [!accessKey && 'COUPANG_ACCESS_KEY', !secretKey && 'COUPANG_SECRET_KEY'].filter(Boolean) : [],
    accessKey,
    secretKey,
    categoryIds: [...new Set(configuredIds)],
    intervalMs: positiveInteger(env.COUPANG_POLL_INTERVAL_MS, 6 * 60 * 60 * 1000, 10 * 60 * 1000, 24 * 60 * 60 * 1000, 'COUPANG_POLL_INTERVAL_MS'),
    requestTimeoutMs: positiveInteger(env.COUPANG_REQUEST_TIMEOUT_MS, 10_000, 1_000, 30_000, 'COUPANG_REQUEST_TIMEOUT_MS'),
  };
}

function formatSignedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Coupang signature date is invalid');
  return `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
}

function createCoupangAuthorization({ method, uri, accessKey, secretKey, now = new Date() }) {
  if (!hasValue(method) || !hasValue(uri) || !hasValue(accessKey) || !hasValue(secretKey)) {
    throw new TypeError('Coupang HMAC inputs are required');
  }
  const separator = uri.indexOf('?');
  const path = separator < 0 ? uri : uri.slice(0, separator);
  const query = separator < 0 ? '' : uri.slice(separator + 1);
  const signedDate = formatSignedDate(now);
  const signature = createHmac('sha256', secretKey)
    .update(`${signedDate}${method.toUpperCase()}${path}${query}`, 'utf8')
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

function normalizeProductId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Coupang productId is invalid');
    return String(value);
  }
  if (typeof value !== 'string' || !/^[1-9]\d{0,30}$/.test(value)) {
    throw new TypeError('Coupang productId is invalid');
  }
  return value;
}

function normalizeTrackingUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new TypeError('Coupang productUrl is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.toLowerCase() !== 'link.coupang.com') {
    throw new TypeError('Coupang productUrl must be an official HTTPS tracking URL');
  }
  if (!url.pathname.startsWith('/re/')) {
    throw new TypeError('Coupang productUrl must use the official tracking path');
  }
  return String(value);
}

function normalizeImageUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new TypeError('Coupang productImage is invalid');
  }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
    || (host !== 'coupangcdn.com' && !host.endsWith('.coupangcdn.com'))) {
    throw new TypeError('Coupang productImage must use the official CDN');
  }
  // Older official examples use HTTP. Upgrade only the transport while preserving host/path/query.
  url.protocol = 'https:';
  return url.href;
}

function normalizePrice(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Coupang productPrice is invalid');
  return value;
}

function normalizeCoupangProduct(item, source, now) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Coupang product is invalid');
  const sourceItemId = normalizeProductId(item.productId);
  const title = typeof item.productName === 'string' ? item.productName.trim() : '';
  if (!title || title.length > 500) throw new TypeError('Coupang productName is invalid');
  const originalUrl = normalizeTrackingUrl(item.productUrl);
  const imageUrl = normalizeImageUrl(item.productImage);
  const priceAmount = normalizePrice(item.productPrice);
  const categoryName = typeof item.categoryName === 'string' ? item.categoryName.trim().slice(0, 100) : '';
  const benefits = [item.isRocket === true && '로켓배송', item.isFreeShipping === true && '무료배송'].filter(Boolean);
  return {
    source: COUPANG_SOURCE,
    sourceItemId,
    title,
    priceText: `${priceAmount}원`,
    priceAmount,
    merchant: '쿠팡',
    originalUrl,
    sourceImageUrl: imageUrl,
    imageUrl,
    imageStatus: 'ready',
    imageProvider: 'coupang-api',
    category: classifyDeal({ title: `${title} ${categoryName}` }),
    badge: source.kind === 'goldbox' ? '쿠팡특가' : '쿠팡추천',
    description: benefits.join(' · ') || categoryName || null,
    publishedAt: new Date(now).toISOString(),
    rawHash: null,
  };
}

function normalizeCoupangSnapshot(sources, now = new Date()) {
  if (!Array.isArray(sources) || sources.length === 0) throw new TypeError('Coupang snapshot sources are required');
  const byId = new Map();
  for (const source of sources) {
    if (!source || !['goldbox', 'category'].includes(source.kind) || !Array.isArray(source.products)) {
      throw new TypeError('Coupang snapshot source is invalid');
    }
    for (const item of source.products) {
      const deal = normalizeCoupangProduct(item, source, now);
      const existing = byId.get(deal.sourceItemId);
      if (existing) {
        if (existing.originalUrl !== deal.originalUrl || existing.title !== deal.title) {
          throw new TypeError(`Coupang duplicate conflict for productId ${deal.sourceItemId}`);
        }
        if (deal.badge === '쿠팡특가') existing.badge = deal.badge;
        continue;
      }
      byId.set(deal.sourceItemId, deal);
    }
  }
  if (byId.size === 0) throw new TypeError('Coupang snapshot must not be empty');
  return [...byId.values()];
}

async function readJsonResponse(response) {
  if (!response || response.status !== 200) throw new Error('Coupang API HTTP request failed');
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(contentType)) throw new Error('Coupang API returned an invalid content type');
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Coupang API response is too large');
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Coupang API returned an unreadable response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Coupang API response is too large');
    }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks, receivedBytes).toString('utf8');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Coupang API returned invalid JSON');
  }
  if (!body || String(body.rCode) !== '0' || !Array.isArray(body.data) || body.data.length === 0) {
    throw new Error('Coupang API returned an unsuccessful product response');
  }
  return body.data;
}

async function requestProducts({ uri, runtime, fetchImpl, now }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtime.requestTimeoutMs);
  try {
    const authorization = createCoupangAuthorization({
      method: 'GET', uri, accessKey: runtime.accessKey, secretKey: runtime.secretKey, now,
    });
    const response = await fetchImpl(`${COUPANG_API_ORIGIN}${uri}`, {
      method: 'GET',
      headers: { Authorization: authorization, Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    return await readJsonResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Coupang API request timed out');
    if (/^Coupang /.test(error?.message || '')) throw error;
    throw new Error('Coupang API request failed');
  } finally {
    clearTimeout(timeout);
  }
}

async function runCoupangCollector({ runtime, store, fetchImpl = fetch, now = new Date() }) {
  if (!runtime?.enabled) return { enabled: false, fetched: 0, upserted: 0, ended: 0 };
  if (!store || typeof store.syncCoupangSnapshot !== 'function'
    || typeof store.withCoupangCollectionLease !== 'function') {
    throw new TypeError('Coupang deal store with collection lease is required');
  }
  const collected = await store.withCoupangCollectionLease(async () => {
    const sources = [];
    const goldboxUri = `${COUPANG_API_PREFIX}/products/goldbox`;
    sources.push({ kind: 'goldbox', products: await requestProducts({ uri: goldboxUri, runtime, fetchImpl, now }) });
    for (const categoryId of runtime.categoryIds) {
      const uri = `${COUPANG_API_PREFIX}/products/bestcategories/${categoryId}?limit=20&imageSize=512x512`;
      sources.push({ kind: 'category', categoryId, products: await requestProducts({ uri, runtime, fetchImpl, now }) });
    }
    const deals = normalizeCoupangSnapshot(sources, now);
    const synced = await store.syncCoupangSnapshot(deals);
    return { enabled: true, fetched: deals.length, ...synced };
  });
  if (collected === null) {
    return { enabled: true, skipped: 'lease-unavailable', fetched: 0, upserted: 0, ended: 0 };
  }
  return collected;
}

module.exports = {
  COUPANG_SOURCE,
  COUPANG_API_ORIGIN,
  COUPANG_API_PREFIX,
  createCoupangAuthorization,
  normalizeCoupangSnapshot,
  readCoupangRuntime,
  runCoupangCollector,
};
