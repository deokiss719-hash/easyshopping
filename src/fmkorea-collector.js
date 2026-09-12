const crypto = require('node:crypto');
const cheerio = require('cheerio');
const { classifyDeal } = require('./deal-category');

const FMKOREA_ENDPOINT = 'https://www.fmkorea.com/hotdeal';
const FMKOREA_USER_AGENT = 'EasyHotDeal/1.0 (+https://easyshoopping.com)';
const DEFAULT_INTERVAL_MS = 1_200_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_JITTER_MS = 120_000;
const MIN_BLOCK_BACKOFF_MS = 60 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const EXACT_ROW_CLASSES = Object.freeze(['li', 'li_best2_pop0', 'li_best2_hotdeal0']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function exactRowClass(value) {
  const tokens = cleanText(value).split(' ').filter(Boolean);
  return EXACT_ROW_CLASSES.every((token) => tokens.includes(token))
    && tokens.every((token) => token === 'li' || /^li_best2_(?:pop|hotdeal|politics)\d+$/.test(token));
}

function parsePositiveId(value) {
  const match = String(value || '').trim().match(/^\/([1-9]\d*)$/);
  return match ? match[1] : null;
}

function safeFmkoreaImage(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'image.fmkorea.com'
      || url.username || url.password || (url.port && url.port !== '443')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parsePrice(value) {
  const text = cleanText(value);
  if (text === '무료') return { text, amount: 0 };
  const match = text.match(/^(\d+|\d{1,3}(?:,\d{3})+)원?$/);
  if (!match) return { text, amount: null };
  const amount = Number(match[1].replaceAll(',', ''));
  if (!Number.isSafeInteger(amount) || amount < 0) return { text, amount: null };
  return { text, amount };
}

function parseKstTime(value, now) {
  const match = cleanText(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new TypeError('registration time is malformed');
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError('now must be a valid date');
  const kstOffset = 9 * 60 * 60 * 1000;
  const shifted = new Date(current.getTime() + kstOffset);
  let timestamp = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
    Number(match[1]), Number(match[2]),
  ) - kstOffset;
  if (timestamp > current.getTime()) timestamp -= 24 * 60 * 60 * 1000;
  return new Date(timestamp).toISOString();
}

function hashDeal(fields) {
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function isKnownBlockPage($, html) {
  const title = cleanText($('title').first().text()).toLowerCase();
  const text = cleanText($('body').text()).toLowerCase();
  const markup = String(html || '').toLowerCase();
  return title.includes('just a moment')
    || (title.includes('attention required') && text.includes('cloudflare'))
    || text.includes('checking your browser before accessing')
    || text.includes('enable javascript and cookies to continue')
    || text.includes('verify you are human')
    || text.includes('비정상적인 접근')
    || text.includes('접근이 차단되었습니다')
    || markup.includes('challenge-platform')
    || markup.includes('cf-chl-');
}

function parseFmkoreaHotdealHtml(html, now = new Date()) {
  const $ = cheerio.load(String(html || ''), null, false);
  const deals = [];
  $('li').each((_index, element) => {
    try {
      const row = $(element);
      if (!exactRowClass(row.attr('class'))) return;
      const content = row.children('div.li').first();
      const thumbImage = content.find('img.thumb').first();
      const thumb = thumbImage.closest('a');
      const titleLink = content.find('h3.title > a').first();
      const thumbId = parsePositiveId(thumb.attr('href'));
      const titleId = parsePositiveId(titleLink.attr('href'));
      if (!titleId || (thumb.length && thumbId !== titleId)) throw new TypeError('item ID is malformed');

      const title = cleanText(titleLink.find('span.ellipsis-target').first().text());
      const sourceCategory = cleanText(content.find('span.category > a').first().text());
      const info = content.find('div.hotdeal_info > span');
      const merchant = cleanText(info.eq(0).find('a.strong').first().text());
      const price = parsePrice(info.eq(1).find('a.strong').first().text());
      const shipping = cleanText(info.eq(2).find('a.strong').first().text());
      if (!title || !sourceCategory || !merchant || !shipping) throw new TypeError('required row field is missing');
      const publishedAt = parseKstTime(content.find('span.regdate').first().text(), now);
      const imageUrl = safeFmkoreaImage(
        thumbImage.attr('data-original') || thumbImage.attr('src'),
      );
      const hashFields = { titleId, title, sourceCategory, merchant, price, shipping, publishedAt, imageUrl };
      deals.push({
        source: 'fmkorea',
        sourceItemId: titleId,
        title,
        originalUrl: `https://www.fmkorea.com/${titleId}`,
        merchant,
        priceText: price.text,
        priceAmount: price.amount,
        currency: price.amount == null ? null : 'KRW',
        authoritativePrice: price.text !== '',
        category: classifyDeal({ title, description: sourceCategory }),
        sourceCategory,
        shipping,
        sourceImageUrl: imageUrl,
        imageUrl,
        imageStatus: imageUrl ? 'ready' : 'missing_merchant_url',
        imageProvider: imageUrl ? 'fmkorea-direct' : null,
        publishedAt,
        rawHash: hashDeal(hashFields),
      });
    } catch {
      // A malformed row must not prevent valid first-page rows from being stored.
    }
  });
  if (deals.length === 0 && isKnownBlockPage($, html)) {
    throw Object.assign(new TypeError('FMKorea response is a known block page'), { blocked: true });
  }
  return deals;
}

async function cancelBody(response) {
  try { await response?.body?.cancel?.(); } catch { /* best effort */ }
}

async function readBoundedBody(response, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response);
    throw new RangeError('FMKorea response body is too large');
  }
  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let size = 0;
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) {
        await cancelBody(response);
        throw new RangeError('FMKorea response body is too large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new RangeError('FMKorea response body is too large');
  return text;
}

function retryAfterMs(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return null;
  if (/^\d+$/.test(raw.trim())) return Math.min(Number(raw.trim()) * 1000, MAX_BACKOFF_MS);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.min(date.getTime() - now.getTime(), MAX_BACKOFF_MS));
}

async function runFmkoreaCollector({
  store,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBodyBytes = MAX_BODY_BYTES,
} = {}) {
  if (!store || typeof store.upsert !== 'function' || typeof store.deleteBefore !== 'function'
    || typeof store.withFmkoreaCollectionLease !== 'function') {
    throw new TypeError('FMKorea store with collection lease, upsert, and deleteBefore is required');
  }
  const collected = await store.withFmkoreaCollectionLease(async () => {
    const current = new Date(now());
    if (Number.isNaN(current.getTime())) throw new TypeError('clock returned an invalid date');
    const response = await fetchImpl(FMKOREA_ENDPOINT, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'User-Agent': FMKOREA_USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = Number(response?.status);
    const redirected = response?.redirected === true
      || (typeof response?.url === 'string' && response.url && response.url !== FMKOREA_ENDPOINT);
    if ((status >= 300 && status < 400) || redirected) {
      await cancelBody(response);
      throw Object.assign(new Error('FMKorea redirects are not allowed'), { status });
    }
    if (!response?.ok) {
      await cancelBody(response);
      throw Object.assign(new Error(`FMKorea request failed with HTTP ${status}`), {
        status,
        retryAfterMs: retryAfterMs(response, current),
      });
    }
    const contentType = response.headers?.get?.('content-type') || '';
    if (!/^text\/html(?:\s*;|$)|^application\/xhtml\+xml(?:\s*;|$)/i.test(contentType)) {
      await cancelBody(response);
      throw new TypeError('FMKorea response content type must be HTML');
    }
    const html = await readBoundedBody(response, maxBodyBytes);
    const deals = parseFmkoreaHotdealHtml(html, current);
    if (deals.length === 0) throw new TypeError('FMKorea response is not a recognizable non-empty snapshot');
    for (const deal of deals) await store.upsert(deal);
    const deleted = await store.deleteBefore('fmkorea', new Date(current.getTime() - RETENTION_MS));
    return { fetched: deals.length, stored: deals.length, deleted };
  });
  return collected ?? { skipped: 'lease-unavailable', fetched: 0, stored: 0, deleted: 0 };
}

function readFmkoreaRuntime(env = process.env) {
  const enabled = env.FMKOREA_ENABLED === 'true';
  if (!enabled) return { enabled: false, intervalMs: DEFAULT_INTERVAL_MS, timeoutMs: DEFAULT_TIMEOUT_MS };
  const intervalMs = Number(env.FMKOREA_POLL_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  const timeoutMs = Number(env.FMKOREA_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < DEFAULT_INTERVAL_MS) {
    throw new Error('FMKOREA_POLL_INTERVAL_MS must be at least 1200000');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error('FMKOREA_REQUEST_TIMEOUT_MS must be between 1000 and 30000');
  }
  return { enabled, intervalMs, timeoutMs };
}

function startFmkoreaScheduler({
  collect,
  intervalMs = DEFAULT_INTERVAL_MS,
  random = Math.random,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = console,
  runRecorder = null,
  recorderTimeoutMs = 2000,
} = {}) {
  if (typeof collect !== 'function') throw new TypeError('collect is required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < DEFAULT_INTERVAL_MS) {
    throw new TypeError('intervalMs must be at least 1200000');
  }
  if (!Number.isSafeInteger(recorderTimeoutMs) || recorderTimeoutMs < 1) {
    throw new TypeError('recorderTimeoutMs must be a positive integer');
  }
  let stopped = false;
  let timer = null;
  let blockBackoff = 0;

  const schedule = (delay) => {
    if (!stopped) timer = setTimeoutFn(execute, delay);
  };
  async function record(method, ...args) {
    if (!runRecorder || typeof runRecorder[method] !== 'function') return null;
    let timeoutId;
    try {
      return await Promise.race([
        Promise.resolve().then(() => runRecorder[method](...args)),
        new Promise((resolve) => {
          timeoutId = setTimeoutFn(() => resolve(null), recorderTimeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timeoutId !== undefined) clearTimeoutFn(timeoutId);
    }
  }
  async function execute() {
    if (stopped) return null;
    timer = null;
    const runId = await record('start');
    try {
      const result = await collect();
      if (runId != null) await record('succeed', runId, result);
      blockBackoff = 0;
      const sample = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
      schedule(intervalMs + Math.floor(sample * (MAX_JITTER_MS + 1)));
      logger.info('FMKorea 핫딜 수집 완료', result);
      return result;
    } catch (error) {
      if (runId != null) await record('fail', runId);
      if (error?.blocked === true || error?.status === 403 || error?.status === 429) {
        blockBackoff = blockBackoff ? Math.min(blockBackoff * 2, MAX_BACKOFF_MS) : MIN_BLOCK_BACKOFF_MS;
        const retryDelay = Number.isFinite(error.retryAfterMs)
          ? Math.max(0, Math.min(error.retryAfterMs, MAX_BACKOFF_MS)) : 0;
        schedule(Math.max(blockBackoff, retryDelay));
      } else {
        blockBackoff = 0;
        schedule(Math.max(intervalMs, MIN_BLOCK_BACKOFF_MS));
      }
      logger.error('FMKorea 핫딜 수집 실패', { status: error?.status || null });
      return null;
    }
  }

  const firstRun = execute();
  return {
    firstRun,
    stop() {
      stopped = true;
      if (timer != null) clearTimeoutFn(timer);
      timer = null;
    },
  };
}

module.exports = {
  FMKOREA_ENDPOINT,
  FMKOREA_USER_AGENT,
  MAX_BODY_BYTES,
  parseFmkoreaHotdealHtml,
  safeFmkoreaImage,
  runFmkoreaCollector,
  readFmkoreaRuntime,
  startFmkoreaScheduler,
};
