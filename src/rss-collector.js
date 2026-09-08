const net = require('node:net');
const { XMLParser } = require('fast-xml-parser');
const { classifyDeal } = require('./deal-category');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_HTML_MAX_BYTES = 256 * 1024;
const DEFAULT_IMAGE_HOSTS = Object.freeze(['ppomppu.co.kr']);
const DEFAULT_IMAGE_CONCURRENCY = 3;
const DEFAULT_MAX_IMAGE_ENRICHMENTS = 12;
const DEFAULT_IMAGE_RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_REDIRECTS = 3;
const negativeImageCache = new Map();

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

function cleanText(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? value['#text'] ?? '' : value;
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function parseKrw(text) {
  const value = String(text || '');
  const parentheticalGroups = [...value.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]).reverse();
  for (const group of parentheticalGroups) {
    const deliveredPrice = group.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:원)?\s*(?=\/|$)/);
    if (deliveredPrice) return Number(deliveredPrice[1].replaceAll(',', ''));
  }

  const wonAmounts = [...value.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/g)];
  const match = wonAmounts.at(-1);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function normalizeItemUrl(value, feedUrl) {
  const raw = cleanText(value);
  if (!raw) throw new TypeError('item link is required');

  const itemUrl = new URL(raw, feedUrl);
  const parentUrl = new URL(feedUrl);
  if (!['http:', 'https:'].includes(itemUrl.protocol)) {
    throw new TypeError('item link must use HTTP or HTTPS');
  }
  if (
    parentUrl.protocol === 'https:'
    && itemUrl.protocol === 'http:'
    && itemUrl.hostname === parentUrl.hostname
  ) {
    itemUrl.protocol = 'https:';
  }
  return itemUrl.href;
}

function parseMerchant(title) {
  return title.match(/^\[([^\]]{1,50})\]/)?.[1]?.trim() || null;
}

function rawMarkup(value) {
  if (value == null) return '';
  return String(typeof value === 'object' ? value['#text'] ?? '' : value);
}

function decodeAttribute(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function isAllowedImageHost(hostname, allowedImageHosts) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return asArray(allowedImageHosts).some((entry) => {
    const allowed = String(entry || '').toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    return allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

function safeImageUrl(value, baseUrl, allowedImageHosts = DEFAULT_IMAGE_HOSTS) {
  try {
    const url = new URL(decodeAttribute(value), baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (isPrivateLiteral(url.hostname) || !isAllowedImageHost(url.hostname, allowedImageHosts)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractRssImage(item, originalUrl, allowedImageHosts) {
  const candidates = [];
  for (const media of asArray(item['media:content'])) candidates.push(media?.['@_url']);
  for (const thumbnail of asArray(item['media:thumbnail'])) candidates.push(thumbnail?.['@_url']);
  for (const enclosure of asArray(item.enclosure)) {
    if (!enclosure?.['@_type'] || String(enclosure['@_type']).toLowerCase().startsWith('image/')) {
      candidates.push(enclosure?.['@_url']);
    }
  }
  const description = rawMarkup(item.description);
  const imageMatch = description.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  if (imageMatch) candidates.push(imageMatch[1]);
  return candidates.map((candidate) => safeImageUrl(candidate, originalUrl, allowedImageHosts)).find(Boolean) || null;
}

function parseFeed(xml, { source, feedUrl, allowedImageHosts = DEFAULT_IMAGE_HOSTS }) {
  const document = parser.parse(xml);
  const items = asArray(document?.rss?.channel?.item);

  return items.flatMap((item) => {
    try {
      const title = cleanText(item.title);
      if (!title) throw new TypeError('item title is required');

      const description = cleanText(item.description);
      const publishedDate = new Date(cleanText(item.pubDate));
      if (Number.isNaN(publishedDate.getTime())) throw new TypeError('item pubDate is invalid');

      const originalUrl = normalizeItemUrl(item.link, feedUrl);
      return [{
        source,
        sourceItemId: cleanText(item.guid) || originalUrl,
        title,
        originalUrl,
        priceAmount: parseKrw(title) ?? parseKrw(description),
        currency: 'KRW',
        merchant: parseMerchant(title),
        category: classifyDeal({ title, description }),
        imageUrl: extractRssImage(item, originalUrl, allowedImageHosts),
        publishedAt: publishedDate.toISOString(),
        rawPayload: { feedUrl, description },
      }];
    } catch {
      return [];
    }
  });
}

function isPrivateLiteral(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (kind === 6) {
    const lower = host.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
  }
  return host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost');
}

function validateFeedUrl(value, allowedHosts) {
  const url = new URL(value);
  const allowlist = asArray(allowedHosts).map((host) => String(host).toLowerCase());
  if (!allowlist.length) throw new TypeError('allowedHosts is required');
  if (url.protocol !== 'https:') throw new TypeError('feedUrl must use HTTPS');
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new TypeError('feedUrl credentials or port are not allowed');
  }
  if (isPrivateLiteral(url.hostname) || !allowlist.includes(url.hostname.toLowerCase())) {
    throw new TypeError('feed host is not allowed');
  }
  return url;
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // Redirect cleanup is best-effort; validation errors remain authoritative.
  }
}

async function requestFeed(startUrl, { allowedHosts, fetchImpl }) {
  let url = validateFeedUrl(startUrl, allowedHosts);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'User-Agent': 'easyshopping-feed-collector/0.1 (+https://easyshoopping.com)',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      await cancelResponseBody(response);
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many feed redirects');
      if (!location) throw new Error('Feed redirect is missing Location');
      url = validateFeedUrl(new URL(location, url).href, allowedHosts);
      continue;
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Feed request failed with HTTP ${response.status}`);
    }
    return { response, finalUrl: url };
  }
  throw new Error('Too many feed redirects');
}

async function readLimitedBody(response, maxBytes, label = 'Feed') {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelResponseBody(response);
    throw new RangeError(`${label} response is too large`);
  }

  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let total = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    while (true) {
      const { done, value } = await iterator.next();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        try {
          await iterator.return?.();
        } catch {
          // Preserve the size-limit error even if stream cleanup fails.
        }
        throw new RangeError(`${label} response is too large`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    await cancelResponseBody(response);
    throw new RangeError(`${label} response is too large`);
  }
  return text;
}

function extractOpenGraphImage(html, pageUrl, allowedImageHosts = DEFAULT_IMAGE_HOSTS) {
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) {
      attributes[match[1].toLowerCase()] = decodeAttribute(match[3]);
    }
    const key = String(attributes.property || attributes.name || '').toLowerCase();
    if (key === 'og:image' || key === 'og:image:url') {
      const imageUrl = safeImageUrl(attributes.content, pageUrl, allowedImageHosts);
      if (imageUrl) return imageUrl;
    }
  }
  return null;
}

async function fetchOpenGraphImage(pageUrl, {
  allowedHosts,
  allowedImageHosts = DEFAULT_IMAGE_HOSTS,
  fetchImpl = fetch,
  maxBytes = DEFAULT_HTML_MAX_BYTES,
  timeoutMs = 8000,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new TypeError('maxBytes must be a safe integer of at least 1024');
  }
  let url = validateFeedUrl(pageUrl, allowedHosts);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
        Referer: `${url.origin}/`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      await cancelResponseBody(response);
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many page redirects');
      if (!location) throw new Error('Page redirect is missing Location');
      url = validateFeedUrl(new URL(location, url).href, allowedHosts);
      continue;
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      return null;
    }
    const contentType = response.headers?.get?.('content-type');
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await cancelResponseBody(response);
      return null;
    }
    const html = await readLimitedBody(response, maxBytes, 'Page');
    return extractOpenGraphImage(html, url.href, allowedImageHosts);
  }
  return null;
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

function cacheFailedImageAttempt(cache, key, timestamp) {
  if (cache.size >= 1000 && !cache.has(key)) cache.delete(cache.keys().next().value);
  cache.set(key, timestamp);
}

async function runRssCollector({
  source,
  feedUrl,
  allowedHosts,
  store,
  fetchImpl = fetch,
  enrichImages = false,
  pageFetchImpl = fetchImpl,
  allowedImageHosts = DEFAULT_IMAGE_HOSTS,
  imageConcurrency = DEFAULT_IMAGE_CONCURRENCY,
  maxImageEnrichments = DEFAULT_MAX_IMAGE_ENRICHMENTS,
  imageAttemptCache = negativeImageCache,
  imageRetryMs = DEFAULT_IMAGE_RETRY_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxAgeMs = 72 * 60 * 60 * 1000,
  now = () => new Date(),
}) {
  if (!source || typeof store?.upsert !== 'function') {
    throw new TypeError('source and DealStore are required');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new TypeError('maxBytes must be a safe integer of at least 1024');
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 60 * 60 * 1000) {
    throw new TypeError('maxAgeMs must be a safe integer of at least one hour');
  }
  if (!Number.isSafeInteger(imageConcurrency) || imageConcurrency < 1 || imageConcurrency > 8) {
    throw new TypeError('imageConcurrency must be an integer between 1 and 8');
  }
  if (!Number.isSafeInteger(maxImageEnrichments) || maxImageEnrichments < 1 || maxImageEnrichments > 100) {
    throw new TypeError('maxImageEnrichments must be an integer between 1 and 100');
  }
  if (!(imageAttemptCache instanceof Map) || !Number.isSafeInteger(imageRetryMs) || imageRetryMs < 60_000) {
    throw new TypeError('imageAttemptCache and imageRetryMs are invalid');
  }

  const { response, finalUrl } = await requestFeed(feedUrl, { allowedHosts, fetchImpl });
  const xml = await readLimitedBody(response, maxBytes);
  const deals = parseFeed(xml, { source, feedUrl: finalUrl.href, allowedImageHosts });
  const enrichmentQueue = [];
  const attemptedAt = Date.now();
  for (const deal of deals) {
    const stored = await store.upsert(deal);
    const lastAttempt = imageAttemptCache.get(deal.originalUrl);
    const recentlyFailed = Number.isFinite(lastAttempt) && attemptedAt - lastAttempt < imageRetryMs;
    if (
      enrichImages
      && !deal.imageUrl
      && !stored?.imageUrl
      && !recentlyFailed
      && enrichmentQueue.length < maxImageEnrichments
    ) {
      enrichmentQueue.push(deal);
    }
  }

  await runWithConcurrency(enrichmentQueue, imageConcurrency, async (deal) => {
    try {
      const imageUrl = await fetchOpenGraphImage(deal.originalUrl, {
        allowedHosts,
        allowedImageHosts,
        fetchImpl: pageFetchImpl,
      });
      if (imageUrl) {
        await store.upsert({ ...deal, imageUrl });
        imageAttemptCache.delete(deal.originalUrl);
        return;
      }
    } catch {
      // Image enrichment is best-effort and must never stop deal collection.
    }
    cacheFailedImageAttempt(imageAttemptCache, deal.originalUrl, attemptedAt);
  });

  let ended = 0;
  if (typeof store.markEndedBefore === 'function') {
    const currentTime = new Date(now());
    if (Number.isNaN(currentTime.getTime())) throw new TypeError('now must return a valid date');
    ended = await store.markEndedBefore(source, new Date(currentTime.getTime() - maxAgeMs));
  }
  return { fetched: deals.length, stored: deals.length, ended };
}

module.exports = {
  parseFeed,
  runRssCollector,
  safeImageUrl,
  fetchOpenGraphImage,
  extractOpenGraphImage,
};
