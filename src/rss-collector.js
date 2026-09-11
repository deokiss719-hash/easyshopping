const net = require('node:net');
const { createHash } = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');
const { classifyDeal } = require('./deal-category');
const { requestPinnedHttps } = require('./pinned-https');

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

function parseKrwAmount(value) {
  const normalized = String(value);
  const plain = /^\d+$/.test(normalized);
  const grouped = /^\d{1,3}(?:([,.])\d{3})(?:\1\d{3})*$/.test(normalized);
  if (!plain && !grouped) return null;

  const amount = Number(normalized.replace(/[,.]/g, ''));
  return Number.isSafeInteger(amount) ? amount : null;
}

const PRICE_FOUND = 'found';
const PRICE_ABSENT = 'absent';
const PRICE_INVALID = 'invalid';
const ANCILLARY_PRICE_BEFORE_PATTERN = /(?:배송\s*비|배송료|배달비|운임|쿠폰(?:\s*할인(?:액)?)?|할인액|할인금액|적립금|포인트)\s*[:：]?\s*(?:[-−]\s*)?$/i;
const ANCILLARY_PRICE_AFTER_PATTERN = /^\s*(?:배송\s*비|배송료|배달비|운임|할인액|할인금액|적립금|포인트)/i;

function isAncillaryPrice(value, match) {
  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  const shippingStatusFollowsAmount = /^\s*(?:배송\s*비|배송료|배달비|운임)\s*(?:[:：]\s*|\(\s*)?(?:무료|별도|포함|착불|조건부|문의|0(?!\s*원))/i.test(after);
  const couponLabelClosesGroup = /^\s*쿠폰\s*\)/i.test(after);
  const labelFollowsAmount = (
    ANCILLARY_PRICE_AFTER_PATTERN.test(after)
    && !shippingStatusFollowsAmount
    && !/\d+(?:[,.]\d+)*\s*원/.test(after)
  ) || couponLabelClosesGroup;
  return ANCILLARY_PRICE_BEFORE_PATTERN.test(before)
    || /[-−]\s*$/.test(before)
    || labelFollowsAmount;
}

function parseKrw(text) {
  const value = String(text || '');
  const wonAmounts = [...value.matchAll(/(?<![\d.,])(\d+(?:[,.]\d+)*)(?![\d.,])\s*원/g)];
  const parentheticalGroups = [...value.matchAll(/\(([^()]*)\)/g)].reverse();
  for (const parentheticalMatch of parentheticalGroups) {
    const group = parentheticalMatch[1];
    const deliveredPrice = group.match(/(?<![\d.,])(\d+(?:[,.]\d+)*)(?![\d.,])\s*(?:원)?\s*(?=\/|$)/);
    if (deliveredPrice) {
      const contextualMatch = {
        0: deliveredPrice[0],
        index: parentheticalMatch.index + 1 + deliveredPrice.index,
      };
      if (isAncillaryPrice(value, contextualMatch)) continue;
      const hasEarlierInvalidAmount = wonAmounts.some((match) => (
        match.index < contextualMatch.index
        && !isAncillaryPrice(value, match)
        && parseKrwAmount(match[1]) == null
      ));
      if (hasEarlierInvalidAmount) return { status: PRICE_INVALID, amount: null };
      const amount = parseKrwAmount(deliveredPrice[1]);
      return amount == null
        ? { status: PRICE_INVALID, amount: null }
        : { status: PRICE_FOUND, amount };
    }
  }

  let selectedAmount = null;
  let hasInvalidAmount = false;
  for (const match of wonAmounts) {
    if (isAncillaryPrice(value, match)) continue;
    const amount = parseKrwAmount(match[1]);
    if (amount == null) hasInvalidAmount = true;
    else selectedAmount = amount;
  }
  if (selectedAmount != null) return { status: PRICE_FOUND, amount: selectedAmount };
  return {
    status: hasInvalidAmount ? PRICE_INVALID : PRICE_ABSENT,
    amount: null,
  };
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
  if (!String(value || '').trim()) return null;
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

function extractExplicitMerchantUrl(item, feedUrl, originalUrl, allowedMerchantHosts) {
  if (!asArray(allowedMerchantHosts).length) return null;
  const description = decodeAttribute(rawMarkup(item.description));
  const candidates = [
    ...(description.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)),
    ...(description.matchAll(/(https:\/\/[^\s<>"']+)/gi)),
  ].map((match) => match[1]);
  const feedHost = new URL(feedUrl).hostname.toLowerCase();
  const originalHost = new URL(originalUrl).hostname.toLowerCase();
  for (const candidate of candidates) {
    try {
      const cleaned = candidate.replace(/[)\],.!?]+$/g, '');
      const url = new URL(cleaned);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) continue;
      if (isPrivateLiteral(url.hostname) || url.hostname.toLowerCase() === feedHost || url.hostname.toLowerCase() === originalHost) continue;
      if (!isAllowedImageHost(url.hostname, allowedMerchantHosts)) continue;
      if (/\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url.pathname)) continue;
      return url.href;
    } catch {
      // Only explicit, valid HTTPS URLs are eligible; malformed text is ignored.
    }
  }
  return null;
}

function parseFeed(xml, {
  source,
  feedUrl,
  allowedImageHosts = DEFAULT_IMAGE_HOSTS,
  allowedMerchantHosts = [],
}) {
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
      const sourceImageUrl = extractRssImage(item, originalUrl, allowedImageHosts);
      const merchantUrl = extractExplicitMerchantUrl(item, feedUrl, originalUrl, allowedMerchantHosts);
      const titlePrice = parseKrw(title);
      const priceAmount = titlePrice.status === PRICE_ABSENT
        ? parseKrw(description).amount
        : titlePrice.amount;
      return [{
        source,
        sourceItemId: cleanText(item.guid) || originalUrl,
        title,
        originalUrl,
        priceAmount,
        currency: 'KRW',
        merchant: parseMerchant(title),
        category: classifyDeal({ title, description }),
        merchantUrl,
        sourceImageUrl,
        imageUrl: null,
        imageStatus: merchantUrl ? 'pending' : 'missing_merchant_url',
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

function requestHop(url, options, { lookup, request, fetchImpl }) {
  const transport = request || (fetchImpl
    ? (target, _selected, requestOptions) => fetchImpl(target, requestOptions)
    : undefined);
  return requestPinnedHttps(url, { ...options, lookup, request: transport });
}

async function requestFeed(startUrl, { allowedHosts, fetchImpl, lookup, request }) {
  let url = validateFeedUrl(startUrl, allowedHosts);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestHop(url, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'User-Agent': 'easyshopping-feed-collector/0.1 (+https://easyshoopping.com)',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    }, { lookup, request, fetchImpl });

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

function isPpomppuUiImage(element, imageUrl) {
  const pathname = imageUrl.pathname.toLowerCase();
  const filename = pathname.split('/').at(-1) || '';
  const uiName = /(?:^|[_-])(icon|loading|lazy|spacer|blank|pixel)(?:[_-]|\.)/i.test(filename);
  const siteAsset = /^\/(?:images?|skin|css|js)\//i.test(pathname);
  const width = Number.parseInt(element.attr('width'), 10);
  const height = Number.parseInt(element.attr('height'), 10);
  const tiny = (Number.isFinite(width) && width <= 32) || (Number.isFinite(height) && height <= 32);
  return uiName || siteAsset || tiny;
}

function extractPpomppuBodyImage(html, pageUrl, allowedImageHosts = DEFAULT_IMAGE_HOSTS) {
  const $ = cheerio.load(String(html || ''), null, false);
  const content = $('td.board-contents').first();
  if (!content.length) return null;

  for (const node of content.find('img').toArray()) {
    const image = $(node);
    const candidates = [
      image.attr('data-original'),
      image.attr('data-src'),
      image.attr('data-lazy-src'),
      image.attr('src'),
    ];
    for (const candidate of candidates) {
      const safeUrl = safeImageUrl(candidate, pageUrl, allowedImageHosts);
      if (!safeUrl) continue;
      const parsed = new URL(safeUrl);
      if (isPpomppuUiImage(image, parsed)) continue;
      return safeUrl;
    }
  }
  return null;
}

async function fetchOpenGraphImage(pageUrl, {
  allowedHosts,
  allowedImageHosts = DEFAULT_IMAGE_HOSTS,
  fetchImpl,
  lookup,
  request,
  maxBytes = DEFAULT_HTML_MAX_BYTES,
  timeoutMs = 8000,
  onDiagnostic = () => {},
  extractImage = extractOpenGraphImage,
  missingReason = 'og_image_missing',
  missingField = 'ogImageMissing',
  validatePageUrl = null,
  requireContentType = false,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new TypeError('maxBytes must be a safe integer of at least 1024');
  }

  let hostname = null;
  try {
    hostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    // validateFeedUrl below returns the canonical validation error.
  }
  let finalRedirectHostname = hostname;
  let httpStatus = null;
  let contentType = null;
  let reported = false;
  const report = (reason, overrides = {}) => {
    if (reported) return;
    reported = true;
    onDiagnostic({
      reason,
      hostname,
      finalRedirectHostname,
      httpStatus,
      contentType,
      timeout: false,
      responseTooLarge: false,
      ogImageMissing: false,
      hostnameValidationFailed: false,
      ...overrides,
    });
  };

  try {
    let url = validateFeedUrl(pageUrl, allowedHosts);
    if (validatePageUrl && !validatePageUrl(url)) throw new Error('Page URL is not allowed');
    hostname = url.hostname;
    finalRedirectHostname = url.hostname;
    const signal = AbortSignal.timeout(timeoutMs);
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await requestHop(url, {
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
      }, { lookup, request, fetchImpl });
      httpStatus = response.status;
      contentType = response.headers?.get?.('content-type') || null;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location');
        await cancelResponseBody(response);
        if (redirectCount === MAX_REDIRECTS) throw new Error('Too many page redirects');
        if (!location) throw new Error('Page redirect is missing Location');
        const redirectUrl = new URL(location, url);
        finalRedirectHostname = redirectUrl.hostname.toLowerCase();
        url = validateFeedUrl(redirectUrl.href, allowedHosts);
        if (validatePageUrl && !validatePageUrl(url)) throw new Error('Page URL is not allowed');
        continue;
      }
      if (!response.ok) {
        await cancelResponseBody(response);
        report('http_status');
        return null;
      }
      if ((requireContentType && !contentType)
        || (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType))) {
        await cancelResponseBody(response);
        report('content_type');
        return null;
      }
      const html = await readLimitedBody(response, maxBytes, 'Page');
      const imageUrl = extractImage(html, url.href, allowedImageHosts);
      if (!imageUrl) report(missingReason, { [missingField]: true });
      return imageUrl;
    }
    return null;
  } catch (error) {
    const message = String(error?.message || '');
    const timeout = error?.name === 'TimeoutError' || /timeout/i.test(message);
    const responseTooLarge = error instanceof RangeError && /response is too large/i.test(message);
    const hostnameValidationFailed = /not allowed|must use HTTPS|must not include credentials|must use the default port/i.test(message);
    let reason = 'request_error';
    if (timeout) reason = 'timeout';
    else if (responseTooLarge) reason = 'response_too_large';
    else if (hostnameValidationFailed) reason = 'hostname_validation_failed';
    else if (/Too many page redirects/i.test(message)) reason = 'redirect_limit';
    else if (/missing Location/i.test(message)) reason = 'redirect_missing_location';
    report(reason, { timeout, responseTooLarge, hostnameValidationFailed });
    throw error;
  }
}

function fetchPpomppuBodyImage(pageUrl, options = {}) {
  let expectedBoard = null;
  let expectedNumber = null;
  try {
    const requestedUrl = new URL(pageUrl);
    expectedBoard = requestedUrl.searchParams.get('id');
    expectedNumber = requestedUrl.searchParams.get('no');
  } catch {
    // fetchOpenGraphImage will return the canonical URL validation error.
  }
  return fetchOpenGraphImage(pageUrl, {
    ...options,
    validatePageUrl: (url) => (url.hostname === 'ppomppu.co.kr' || url.hostname.endsWith('.ppomppu.co.kr'))
      && url.pathname === '/zboard/view.php'
      && expectedBoard === 'ppomppu'
      && url.searchParams.get('id') === expectedBoard
      && /^\d{1,20}$/.test(expectedNumber || '')
      && url.searchParams.get('no') === expectedNumber,
    requireContentType: true,
    extractImage: extractPpomppuBodyImage,
    missingReason: 'body_image_missing',
    missingField: 'bodyImageMissing',
  });
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

function diagnosticItemId(originalUrl) {
  try {
    const url = new URL(originalUrl);
    if (isAllowedImageHost(url.hostname, ['ppomppu.co.kr'])) {
      const board = url.searchParams.get('id');
      const number = url.searchParams.get('no');
      if (/^[a-z0-9_-]{1,32}$/i.test(board || '') && /^\d{1,20}$/.test(number || '')) {
        return `${board}:${number}`;
      }
    }
  } catch {
    // Invalid URLs are represented only by a non-reversible reference below.
  }
  return `url-sha256:${createHash('sha256').update(String(originalUrl || '')).digest('hex').slice(0, 16)}`;
}

async function runRssCollector({
  source,
  feedUrl,
  allowedHosts,
  store,
  fetchImpl,
  lookup,
  request,
  enrichImages = false,
  pageFetchImpl = fetchImpl,
  pageLookup = lookup,
  pageRequest = request,
  allowedImageHosts = DEFAULT_IMAGE_HOSTS,
  allowedMerchantHosts = [],
  productMatcher = null,
  matchingConcurrency = 2,
  imageConcurrency = DEFAULT_IMAGE_CONCURRENCY,
  maxImageEnrichments = DEFAULT_MAX_IMAGE_ENRICHMENTS,
  imageAttemptCache = negativeImageCache,
  imageRetryMs = DEFAULT_IMAGE_RETRY_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxAgeMs = 72 * 60 * 60 * 1000,
  now = () => new Date(),
  logger = console,
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
  if (!Number.isSafeInteger(matchingConcurrency) || matchingConcurrency < 1 || matchingConcurrency > 4) {
    throw new TypeError('matchingConcurrency must be an integer between 1 and 4');
  }
  if (productMatcher?.enabled && typeof productMatcher.match !== 'function') {
    throw new TypeError('enabled productMatcher must implement match');
  }

  const { response, finalUrl } = await requestFeed(feedUrl, {
    allowedHosts, fetchImpl, lookup, request,
  });
  const xml = await readLimitedBody(response, maxBytes);
  const deals = parseFeed(xml, {
    source,
    feedUrl: finalUrl.href,
    allowedImageHosts,
    allowedMerchantHosts,
  });
  let processedDeals = deals;
  let matching = null;
  if (productMatcher?.enabled) {
    matching = { searched: 0, matched: 0, unresolved: 0, failed: 0, imageUrls: 0, byMerchant: {} };
    processedDeals = new Array(deals.length);
    await runWithConcurrency(deals.map((deal, index) => ({ deal, index })), matchingConcurrency, async ({ deal, index }) => {
      const merchant = String(deal.merchant || '(미상)');
      let merchantStats = Object.hasOwn(matching.byMerchant, merchant)
        ? matching.byMerchant[merchant]
        : null;
      if (!merchantStats) {
        merchantStats = { searched: 0, matched: 0, unresolved: 0, failed: 0 };
        Object.defineProperty(matching.byMerchant, merchant, {
          value: merchantStats,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      matching.searched += 1;
      merchantStats.searched += 1;
      try {
        const result = await productMatcher.match(deal);
        if (result?.status === 'matched' && result.match) {
          const match = result.match;
          processedDeals[index] = {
            ...deal,
            merchantUrl: match.merchantUrl || null,
            sourceImageUrl: match.sourceImageUrl || null,
            imageUrl: match.imageUrl || null,
            imageStatus: match.imageUrl ? 'ready' : 'pending',
            imageProvider: match.imageProvider || productMatcher.name || null,
            imageFailureCode: null,
            imageRetryAt: null,
          };
          matching.matched += 1;
          merchantStats.matched += 1;
          if (match.imageUrl) matching.imageUrls += 1;
          return;
        }
        processedDeals[index] = deal;
        matching.unresolved += 1;
        merchantStats.unresolved += 1;
      } catch (error) {
        processedDeals[index] = deal;
        matching.failed += 1;
        merchantStats.failed += 1;
        try {
          logger?.warn?.('상품 매칭 provider 실패', {
            source,
            itemId: diagnosticItemId(deal.originalUrl),
            provider: productMatcher.name || 'unknown',
            reason: error?.name === 'AbortError' ? 'timeout' : 'provider_error',
          });
        } catch {
          // Diagnostic logging must not stop deal collection.
        }
      }
    });
  }

  const enrichmentQueue = [];
  const attemptedAt = Date.now();
  for (const deal of processedDeals) {
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
    let diagnostic = null;
    try {
      const imageUrl = await fetchOpenGraphImage(deal.originalUrl, {
        allowedHosts,
        allowedImageHosts,
        fetchImpl: pageFetchImpl,
        lookup: pageLookup,
        request: pageRequest,
        onDiagnostic: (detail) => { diagnostic = detail; },
      });
      if (imageUrl) {
        await store.upsert({ ...deal, imageUrl });
        imageAttemptCache.delete(deal.originalUrl);
        return;
      }
    } catch {
      // Image enrichment is best-effort and must never stop deal collection.
    }
    const itemId = diagnosticItemId(deal.originalUrl);
    try {
      logger?.warn?.('이미지 보조 수집 실패', {
        source,
        itemId,
        ...(diagnostic || {
          hostname: new URL(deal.originalUrl).hostname.toLowerCase(),
          finalRedirectHostname: null,
          httpStatus: null,
          contentType: null,
          timeout: false,
          responseTooLarge: false,
          ogImageMissing: false,
          hostnameValidationFailed: false,
          reason: 'request_error',
        }),
      });
    } catch {
      // Diagnostic logging must not stop deal collection.
    }
    cacheFailedImageAttempt(imageAttemptCache, deal.originalUrl, attemptedAt);
  });

  let ended = 0;
  if (typeof store.markEndedBefore === 'function') {
    const currentTime = new Date(now());
    if (Number.isNaN(currentTime.getTime())) throw new TypeError('now must return a valid date');
    ended = await store.markEndedBefore(source, new Date(currentTime.getTime() - maxAgeMs));
  }
  return {
    fetched: deals.length,
    stored: processedDeals.length,
    ended,
    ...(matching ? { matching } : {}),
  };
}

module.exports = {
  parseFeed,
  runRssCollector,
  safeImageUrl,
  fetchOpenGraphImage,
  fetchPpomppuBodyImage,
  extractOpenGraphImage,
  extractPpomppuBodyImage,
};
