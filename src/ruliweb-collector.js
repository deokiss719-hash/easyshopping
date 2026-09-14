const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { classifyDeal } = require('./deal-category');
const { parseKrw, requestFeed, readLimitedBody } = require('./rss-collector');

const RULIWEB_FEED_URL = 'https://bbs.ruliweb.com/market/board/1020/rss';
const SOURCE = 'ruliweb';
const FEED_HOST = 'bbs.ruliweb.com';
const IMAGE_HOSTS = new Set(['i1.ruliweb.com', 'i2.ruliweb.com', 'i3.ruliweb.com']);
const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;
const RETENTION_MS = 72 * 60 * 60 * 1000;
const CATEGORY_MAP = new Map([
  ['PC/가전', '디지털/가전'],
  ['게임S/W', '게임'],
  ['상품권', '상품권/쿠폰'],
  ['생활용품', '생활/주방'],
  ['음식', '식품'],
  ['화장품', '뷰티'],
  ['도서', '기타'],
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function rawText(value) {
  return String(value == null ? '' : typeof value === 'object' ? value['#text'] ?? '' : value);
}

function cleanText(value) {
  let text = rawText(value);
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    if (decoded === text) break;
    text = decoded;
  }
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalItem(value) {
  try {
    const url = new URL(cleanText(value));
    if (url.protocol !== 'https:' || url.hostname !== FEED_HOST || url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    if (url.search || url.hash) return null;
    const match = url.pathname.match(/^\/market\/board\/1020\/read\/(\d+)$/);
    if (!match || !/^[1-9]\d*$/.test(match[1])) return null;
    return { id: match[1], url: `https://${FEED_HOST}${url.pathname}` };
  } catch {
    return null;
  }
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/gi, '&'));
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname) || url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractImage(description) {
  const markup = rawText(description);
  for (const match of markup.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const url = safeImageUrl(match[1]);
    if (url) return url;
  }
  return null;
}

function parseRuliwebFeed(xml) {
  const body = String(xml || '');
  if (!body.trim()) throw new Error('Invalid Ruliweb XML snapshot: empty XML');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) {
    throw new Error('Invalid Ruliweb XML snapshot: DTD and entity declarations are not allowed');
  }
  const validation = XMLValidator.validate(body);
  if (validation !== true) throw new Error('Invalid Ruliweb XML snapshot');
  if (/verify you are human|just a moment|captcha|challenge/i.test(body)) {
    throw new Error('Ruliweb challenge snapshot');
  }

  let document;
  try {
    document = parser.parse(body);
  } catch (error) {
    throw new Error('Invalid Ruliweb XML snapshot', { cause: error });
  }
  if (!document?.rss?.channel || document.html) throw new Error('Invalid Ruliweb RSS snapshot');

  const seen = new Set();
  const deals = [];
  for (const item of asArray(document.rss.channel.item)) {
    const canonical = canonicalItem(item?.link);
    const title = cleanText(item?.title);
    const published = new Date(cleanText(item?.pubDate));
    if (!canonical || !title || Number.isNaN(published.getTime())) {
      throw new Error('Invalid item in Ruliweb snapshot');
    }
    if (seen.has(canonical.id)) throw new Error(`Duplicate Ruliweb snapshot ID: ${canonical.id}`);
    seen.add(canonical.id);

    const price = parseKrw(title);
    const imageUrl = extractImage(item.description);
    deals.push({
      source: SOURCE,
      sourceItemId: canonical.id,
      title,
      originalUrl: canonical.url,
      merchant: title.match(/^\[([^\]]{1,50})\]/)?.[1]?.trim() || null,
      priceAmount: price.amount,
      currency: 'KRW',
      authoritativePrice: true,
      category: CATEGORY_MAP.get(cleanText(item.category))
        || classifyDeal({ title, description: cleanText(item.category) }),
      sourceImageUrl: imageUrl,
      imageUrl,
      imageStatus: imageUrl ? 'ready' : 'missing_merchant_url',
      imageProvider: imageUrl ? 'ruliweb-direct' : null,
      publishedAt: published.toISOString(),
    });
  }
  if (deals.length === 0) throw new Error('Ruliweb snapshot has zero valid items');
  return deals;
}

function strictInteger(env, name, defaultValue, minimum, maximum) {
  const raw = env[name];
  if (raw == null || raw === '') return defaultValue;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new TypeError(`${name} must be a strict integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} is outside the supported range`);
  }
  return value;
}

function readRuliwebRuntime(env = process.env) {
  const enabled = env.RULIWEB_ENABLED === 'true';
  if (!enabled) return { enabled: false, intervalMs: DEFAULT_INTERVAL_MS, timeoutMs: DEFAULT_TIMEOUT_MS };
  return {
    enabled: true,
    intervalMs: strictInteger(env, 'RULIWEB_POLL_INTERVAL_MS', DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, 24 * 60 * 60 * 1000),
    timeoutMs: strictInteger(env, 'RULIWEB_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, 60_000),
  };
}

async function runRuliwebCollector({
  store,
  fetchImpl,
  lookup,
  request,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBodyBytes = MAX_BODY_BYTES,
} = {}) {
  if (!store?.withCollectionLease || !store?.upsertBatchAndDeleteBefore) {
    throw new TypeError('store with lease and atomic batch retention is required');
  }

  const collected = await store.withCollectionLease(SOURCE, async () => {
    const cutoff = new Date(new Date(now()).getTime() - RETENTION_MS);
    let deals = [];
    let collectionError = null;
    try {
      const { response, finalUrl } = await requestFeed(RULIWEB_FEED_URL, {
        allowedHosts: [FEED_HOST],
        fetchImpl: fetchImpl ? (url, options) => fetchImpl(String(url), options) : undefined,
        lookup,
        request,
        maxRedirects: 0,
        validateUrl: (url) => url.href === RULIWEB_FEED_URL,
        timeoutMs,
      });
      const responseUrl = response.url ? new URL(response.url).href : finalUrl.href;
      if (response.redirected || responseUrl !== RULIWEB_FEED_URL || finalUrl.href !== RULIWEB_FEED_URL) {
        throw new Error('Unexpected Ruliweb feed redirect');
      }
      const contentType = response.headers?.get?.('content-type') || '';
      if (!/^(?:text|application)\/(?:rss\+xml|xml)(?:\s*;|$)/i.test(contentType)) {
        throw new Error('Unexpected Ruliweb content type');
      }
      const xml = await readLimitedBody(response, maxBodyBytes, 'Ruliweb feed');
      deals = parseRuliwebFeed(xml);
    } catch (error) {
      collectionError = error;
    }

    let batchResult;
    try {
      batchResult = await store.upsertBatchAndDeleteBefore(
        SOURCE,
        collectionError ? [] : deals,
        cutoff,
      );
    } catch (persistenceError) {
      if (!collectionError) throw persistenceError;
      collectionError.retentionError = persistenceError;
    }
    if (collectionError) throw collectionError;
    return {
      fetched: deals.length,
      stored: batchResult.stored,
      deleted: batchResult.deleted,
    };
  });
  return collected ?? { skipped: 'lease-unavailable', fetched: 0, stored: 0, deleted: 0 };
}

module.exports = {
  RULIWEB_FEED_URL,
  parseRuliwebFeed,
  readRuliwebRuntime,
  runRuliwebCollector,
};
