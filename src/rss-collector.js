const net = require('node:net');
const { XMLParser } = require('fast-xml-parser');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

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
  const match = String(text).match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
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

function parseFeed(xml, { source, feedUrl }) {
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
        priceAmount: parseKrw(`${title} ${description}`),
        currency: 'KRW',
        merchant: parseMerchant(title),
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
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many feed redirects');
      const location = response.headers?.get?.('location');
      if (!location) throw new Error('Feed redirect is missing Location');
      url = validateFeedUrl(new URL(location, url).href, allowedHosts);
      continue;
    }
    if (!response.ok) throw new Error(`Feed request failed with HTTP ${response.status}`);
    return { response, finalUrl: url };
  }
  throw new Error('Too many feed redirects');
}

async function readLimitedBody(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RangeError('Feed response is too large');
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
        throw new RangeError('Feed response is too large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new RangeError('Feed response is too large');
  return text;
}

async function runRssCollector({
  source,
  feedUrl,
  allowedHosts,
  store,
  fetchImpl = fetch,
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

  const { response, finalUrl } = await requestFeed(feedUrl, { allowedHosts, fetchImpl });
  const xml = await readLimitedBody(response, maxBytes);
  const deals = parseFeed(xml, { source, feedUrl: finalUrl.href });
  for (const deal of deals) await store.upsert(deal);

  let ended = 0;
  if (typeof store.markEndedBefore === 'function') {
    const currentTime = new Date(now());
    if (Number.isNaN(currentTime.getTime())) throw new TypeError('now must return a valid date');
    ended = await store.markEndedBefore(source, new Date(currentTime.getTime() - maxAgeMs));
  }
  return { fetched: deals.length, stored: deals.length, ended };
}

module.exports = { parseFeed, runRssCollector };
