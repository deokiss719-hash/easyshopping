'use strict';

const TOSS_OAUTH_URL = 'https://oauth2.cert.toss.im/token';
const TOSS_API_ORIGIN = 'https://sharelink.toss.im';
const TOSS_API_PREFIX = '/openapi';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ITEMS = 10;
const MAX_OAUTH_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
const MAX_REQUEST_ATTEMPTS = 3;
const DEFAULT_CLOCK = () => Date.now();
const DEFAULT_SLEEP = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const collectorClients = new WeakMap();
const TOSS_SOURCES = Object.freeze(['integrated-best', 'today-special']);
const SOURCE_PATHS = Object.freeze({
  'integrated-best': `${TOSS_API_PREFIX}/products/best-selling`,
  'today-special': `${TOSS_API_PREFIX}/products/today-deals`,
});

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new TypeError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} is outside the supported range`);
  }
  return parsed;
}

function disabledRuntime({ requested = false, missing = [], clientId = null, clientSecret = null, publisherId = null } = {}) {
  return {
    enabled: false,
    requested,
    missing,
    clientId,
    clientSecret,
    publisherId,
    intervalMs: DEFAULT_INTERVAL_MS,
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxItems: DEFAULT_MAX_ITEMS,
  };
}

function readTossSharelinkRuntime(env = process.env) {
  const requested = env.TOSS_SHARELINK_ENABLED === 'true';
  if (!requested) return disabledRuntime();

  const clientId = hasValue(env.TOSS_SHARELINK_CLIENT_ID) ? env.TOSS_SHARELINK_CLIENT_ID.trim() : null;
  const clientSecret = hasValue(env.TOSS_SHARELINK_CLIENT_SECRET) ? env.TOSS_SHARELINK_CLIENT_SECRET.trim() : null;
  const publisherId = hasValue(env.TOSS_SHARELINK_PUBLISHER_ID) ? env.TOSS_SHARELINK_PUBLISHER_ID.trim() : null;
  const missing = [
    !clientId && 'TOSS_SHARELINK_CLIENT_ID',
    !clientSecret && 'TOSS_SHARELINK_CLIENT_SECRET',
    !publisherId && 'TOSS_SHARELINK_PUBLISHER_ID',
  ].filter(Boolean);
  if (missing.length > 0) return disabledRuntime({ requested: true, missing, clientId, clientSecret, publisherId });

  return {
    enabled: true,
    requested: true,
    missing: [],
    clientId,
    clientSecret,
    publisherId,
    intervalMs: boundedInteger(
      env.TOSS_SHARELINK_POLL_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      'TOSS_SHARELINK_POLL_INTERVAL_MS',
    ),
    requestTimeoutMs: boundedInteger(
      env.TOSS_SHARELINK_REQUEST_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      30_000,
      'TOSS_SHARELINK_REQUEST_TIMEOUT_MS',
    ),
    maxItems: boundedInteger(
      env.TOSS_SHARELINK_MAX_ITEMS,
      DEFAULT_MAX_ITEMS,
      1,
      10,
      'TOSS_SHARELINK_MAX_ITEMS',
    ),
  };
}

function currentMilliseconds(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value == null ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('now must be a valid date');
  return date.getTime();
}

class TossHttpError extends Error {
  constructor(label, status, retryAfter) {
    super(`${label} HTTP request failed`);
    this.name = 'TossHttpError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

class TossOfficialFailure extends Error {
  constructor(label, body) {
    const code = typeof body?.error?.errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(body.error.errorCode)
      ? ` (${body.error.errorCode})`
      : '';
    super(`${label} returned an official failure${code}`);
    this.name = 'TossOfficialFailure';
    this.label = label;
    this.body = body;
    this.errorCode = typeof body?.error?.errorCode === 'string' ? body.error.errorCode : null;
  }
}

async function cancelResponseBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === 'function' && !response.body.locked) {
      await response.body.cancel();
    }
  } catch {
    // Best effort only: preserve the original protocol error.
  }
}

async function rejectResponse(response, error) {
  await cancelResponseBody(response);
  throw error;
}

async function readLimitedJsonResponse(response, label = 'Toss API') {
  if (!response || typeof response !== 'object') throw new Error(`${label} request failed`);
  if (response.redirected === true) return rejectResponse(response, new Error(`${label} redirected unexpectedly`));
  if (response.status !== 200) {
    return rejectResponse(response, new TossHttpError(label, response.status, response.headers?.get?.('retry-after')));
  }
  const contentType = response.headers?.get?.('content-type') || '';
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return rejectResponse(response, new Error(`${label} returned an invalid content type`));
  }
  const lengthText = response.headers?.get?.('content-length');
  if (lengthText != null && lengthText !== '') {
    if (!/^\d+$/.test(lengthText)) return rejectResponse(response, new Error(`${label} returned an invalid content length`));
    if (Number(lengthText) > MAX_RESPONSE_BYTES) return rejectResponse(response, new Error(`${label} response is too large`));
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    return rejectResponse(response, new Error(`${label} returned an unreadable response`));
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      await reader.cancel();
      throw new Error(`${label} returned an unreadable response`);
    }
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${label} response is too large`);
    }
    chunks.push(Buffer.from(value));
  }

  try {
    return JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function assertOfficialSuccess(body, label = 'Toss API') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${label} returned an invalid response`);
  }
  if (body.resultType === 'FAIL') {
    const officialError = body.error;
    if (!officialError || typeof officialError !== 'object' || Array.isArray(officialError)
      || !hasValue(officialError.reason)
      || (officialError.errorCode != null
        && (typeof officialError.errorCode !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(officialError.errorCode)))) {
      throw new Error(`${label} returned an invalid failure response`);
    }
    throw new TossOfficialFailure(label, body);
  }
  if (body.resultType !== 'SUCCESS') throw new Error(`${label} returned an invalid response`);
  if (body.resultCode != null && !['SUCCESS', '0'].includes(String(body.resultCode))) {
    throw new Error(`${label} returned an unsuccessful result code`);
  }
  if (!body.success || typeof body.success !== 'object' || Array.isArray(body.success)) {
    throw new Error(`${label} returned an invalid success response`);
  }
  if (body.success.resultCode != null && !['SUCCESS', '0'].includes(String(body.success.resultCode))) {
    throw new Error(`${label} returned an unsuccessful result code`);
  }
  return body.success;
}

function normalizeProductId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Toss product ID is invalid');
    return String(value);
  }
  if (typeof value !== 'string' || !/^[1-9]\d{0,30}$/.test(value)) {
    throw new TypeError('Toss product ID is invalid');
  }
  return value;
}

function normalizeSharelinkUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new TypeError('Toss sharelink URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.hostname.toLowerCase() !== 'toss.im'
    || !/^\/_m\/[A-Za-z0-9_-]+$/.test(url.pathname)
    || url.search || url.hash) {
    throw new TypeError('Toss sharelink must use the official HTTPS host and path');
  }
  return url.href;
}

function parseIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || (offsetHourText != null && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeProduct(item, source) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Toss product is invalid');
  const productId = normalizeProductId(item.tacaItemId);
  const title = typeof item.displayName === 'string' ? item.displayName.trim() : '';
  if (!title || title.length > 500) throw new TypeError('Toss product title is invalid');
  if (!Number.isSafeInteger(item.displayPrice) || item.displayPrice < 0) {
    throw new TypeError('Toss product price is invalid');
  }
  if (!Number.isSafeInteger(item.rank) || item.rank < 1) throw new TypeError('Toss product rank is invalid');
  return { productId, title, priceAmount: item.displayPrice, source, rank: item.rank };
}

function normalizeTossSnapshot(sources, linksByProductId, maxItems = DEFAULT_MAX_ITEMS, now = new Date()) {
  if (!Array.isArray(sources) || sources.length === 0) throw new TypeError('Toss snapshot sources are required');
  if (!(linksByProductId instanceof Map)) throw new TypeError('Toss sharelinks map is required');
  const limit = boundedInteger(maxItems, DEFAULT_MAX_ITEMS, 1, 10, 'maxItems');
  const timestamp = currentMilliseconds(now);
  const queues = new Map(TOSS_SOURCES.map((kind) => [kind, []]));
  for (const source of sources) {
    if (!source || !TOSS_SOURCES.includes(source.kind) || !Array.isArray(source.products)) {
      throw new TypeError('Toss snapshot source is invalid');
    }
    for (const item of source.products.slice(0, limit)) {
      let endAt = null;
      if (source.kind === 'today-special') {
        const endTime = parseIsoTimestamp(item?.endAt);
        if (endTime == null) continue;
        if (endTime <= timestamp) continue;
        endAt = new Date(endTime).toISOString();
      }
      const normalized = { ...normalizeProduct(item, source.kind), endAt };
      const link = linksByProductId.get(normalized.productId);
      if (!link || link.linkType !== 'all') continue;
      queues.get(source.kind).push({
        ...normalized,
        sharelinkUrl: normalizeSharelinkUrl(link.shortUrl),
        linkType: 'all',
      });
    }
  }
  for (const queue of queues.values()) queue.sort((left, right) => left.rank - right.rank);

  const result = [];
  const seen = new Set();
  const offsets = new Map(TOSS_SOURCES.map((kind) => [kind, 0]));
  while (result.length < limit) {
    let added = false;
    for (const kind of TOSS_SOURCES) {
      const queue = queues.get(kind);
      let offset = offsets.get(kind);
      while (offset < queue.length && seen.has(queue[offset].productId)) offset += 1;
      offsets.set(kind, offset + 1);
      if (offset >= queue.length) continue;
      const product = queue[offset];
      seen.add(product.productId);
      result.push(product);
      added = true;
      if (result.length === limit) break;
    }
    if (!added) break;
  }
  return result;
}

function retryDelayMilliseconds(error, attempt, clock = DEFAULT_CLOCK) {
  if (error.status === 429 && typeof error.retryAfter === 'string') {
    const retryAfter = error.retryAfter.trim();
    if (/^\d+$/.test(retryAfter)) {
      const seconds = Number(retryAfter);
      if (Number.isSafeInteger(seconds)) return Math.min(seconds * 1000, 60_000);
    } else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        return Math.min(Math.max(0, retryAt - currentMilliseconds(clock)), 60_000);
      }
    }
  }
  return 50 * (2 ** (attempt - 1));
}

function createTossSharelinkClient({
  runtime,
  fetchImpl = fetch,
  clock = DEFAULT_CLOCK,
  sleep = DEFAULT_SLEEP,
  // Kept as a backwards-compatible alias for callers that supplied a token clock.
  now,
} = {}) {
  if (now !== undefined && clock === DEFAULT_CLOCK) clock = () => currentMilliseconds(now);
  if (!runtime?.enabled || !hasValue(runtime.clientId) || !hasValue(runtime.clientSecret)
    || !hasValue(runtime.publisherId)) {
    throw new TypeError('Enabled Toss Sharelink runtime with credentials is required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (typeof clock !== 'function') throw new TypeError('clock is required');
  if (typeof sleep !== 'function') throw new TypeError('sleep is required');
  const timeoutMs = boundedInteger(runtime.requestTimeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 30_000, 'requestTimeoutMs');
  const maxItems = boundedInteger(runtime.maxItems, DEFAULT_MAX_ITEMS, 1, 10, 'maxItems');
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let pendingToken = null;

  async function requestJson(url, options, label, validate = (body) => body) {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      let timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
        const body = await readLimitedJsonResponse(response, label);
        return validate(body);
      } catch (error) {
        const timedOut = error?.name === 'AbortError' || controller.signal.aborted;
        if (timedOut) throw new Error(`${label} request timed out`);
        const retryable = (error instanceof TossHttpError
          && (error.status === 429 || (error.status >= 500 && error.status <= 599)))
          || (error instanceof TossOfficialFailure && error.errorCode === '500');
        if (retryable && attempt < MAX_REQUEST_ATTEMPTS) {
          clearTimeout(timeout);
          timeout = null;
          await sleep(retryDelayMilliseconds(error, attempt, clock));
          continue;
        }
        if (typeof error?.message === 'string' && error.message.startsWith(`${label} `)) throw error;
        throw new Error(`${label} request failed`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`${label} request failed`);
  }

  async function issueAccessToken() {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: runtime.clientId,
      client_secret: runtime.clientSecret,
      scope: 'sharelink:read sharelink:write',
    });
    const response = await requestJson(TOSS_OAUTH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }, 'Toss OAuth');
    if (!hasValue(response.access_token) || response.token_type !== 'Bearer'
      || !Number.isSafeInteger(response.expires_in) || response.expires_in <= 0
      || response.expires_in > MAX_OAUTH_EXPIRES_IN_SECONDS) {
      throw new Error('Toss OAuth returned an invalid token response');
    }
    const lifetimeMs = response.expires_in * 1000;
    const safetyMarginMs = Math.min(60_000, Math.max(1, Math.floor(lifetimeMs / 2)));
    cachedToken = response.access_token;
    tokenExpiresAt = currentMilliseconds(clock) + Math.max(0, lifetimeMs - safetyMarginMs);
    return cachedToken;
  }

  async function getAccessToken() {
    if (cachedToken && currentMilliseconds(clock) < tokenExpiresAt) return cachedToken;
    if (!pendingToken) {
      pendingToken = issueAccessToken().finally(() => { pendingToken = null; });
    }
    return pendingToken;
  }

  async function authorizedRequest(path, options, label) {
    const token = await getAccessToken();
    const headers = { Accept: 'application/json', ...options.headers, Authorization: `Bearer ${token}` };
    return requestJson(
      `${TOSS_API_ORIGIN}${path}`,
      { ...options, headers },
      label,
      (body) => assertOfficialSuccess(body, label),
    );
  }

  async function fetchProducts(source) {
    if (!TOSS_SOURCES.includes(source)) throw new TypeError('Toss source is not allowed');
    const path = `${SOURCE_PATHS[source]}?size=${maxItems}`;
    const success = await authorizedRequest(path, { method: 'GET', headers: {} }, 'Toss products API');
    if (!Array.isArray(success.items)) throw new Error('Toss products API returned invalid items');
    return success.items.slice(0, maxItems);
  }

  async function createSharelink(tacaItemId) {
    const productId = normalizeProductId(tacaItemId);
    const numericId = Number(productId);
    if (!Number.isSafeInteger(numericId)) throw new TypeError('Toss product ID is outside the request range');
    const success = await authorizedRequest(`${TOSS_API_PREFIX}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tacaItemId: numericId, publisherId: runtime.publisherId }),
    }, 'Toss links API');
    if (normalizeProductId(success.tacaItemId) !== productId) {
      throw new Error('Toss links API returned a mismatched product ID');
    }
    if (success.publisherId !== runtime.publisherId) {
      throw new Error('Toss links API returned a mismatched publisher ID');
    }
    const linkType = success.linkType == null ? 'all' : success.linkType;
    return {
      // The current official response has no linkType field; a generated product link is the all-attribution form.
      linkType,
      shortUrl: linkType === 'all' ? normalizeSharelinkUrl(success.shortUrl) : null,
    };
  }

  return { getAccessToken, fetchProducts, createSharelink };
}

function collectorClientFor(runtime, fetchImpl, clock, sleep) {
  const credentials = [runtime.clientId, runtime.clientSecret, runtime.publisherId].join('\u0000');
  const cached = collectorClients.get(runtime);
  if (cached && cached.fetchImpl === fetchImpl && cached.clock === clock && cached.sleep === sleep
    && cached.credentials === credentials) return cached.client;
  const client = createTossSharelinkClient({ runtime, fetchImpl, clock, sleep });
  collectorClients.set(runtime, { fetchImpl, clock, sleep, credentials, client });
  return client;
}

function roundRobinProductIds(sources, maxItems) {
  const queues = new Map(TOSS_SOURCES.map((kind) => [kind, []]));
  for (const source of sources) {
    const queue = queues.get(source.kind);
    for (const item of source.products.slice(0, maxItems)) queue.push(normalizeProductId(item?.tacaItemId));
  }
  const result = [];
  const seen = new Set();
  const offsets = new Map(TOSS_SOURCES.map((kind) => [kind, 0]));
  while (result.length < TOSS_SOURCES.length * maxItems) {
    let added = false;
    for (const kind of TOSS_SOURCES) {
      const queue = queues.get(kind);
      let offset = offsets.get(kind);
      while (offset < queue.length && seen.has(queue[offset])) offset += 1;
      offsets.set(kind, offset + 1);
      if (offset >= queue.length) continue;
      seen.add(queue[offset]);
      result.push(queue[offset]);
      added = true;
    }
    if (!added) break;
  }
  return result;
}

async function runTossSharelinkCollector({
  runtime,
  store,
  fetchImpl = fetch,
  now = new Date(),
  clock = DEFAULT_CLOCK,
  sleep = DEFAULT_SLEEP,
  client,
} = {}) {
  if (!runtime?.enabled) return { enabled: false, fetched: 0, upserted: 0, ended: 0 };
  if (!store || typeof store.withTossSharelinkCollectionLease !== 'function'
    || typeof store.syncTossSharelinkSnapshot !== 'function') {
    throw new TypeError('Toss Sharelink store with dedicated collection lease and snapshot methods is required');
  }

  const collected = await store.withTossSharelinkCollectionLease(async () => {
    const limit = boundedInteger(runtime.maxItems, DEFAULT_MAX_ITEMS, 1, 10, 'maxItems');
    const activeClient = client || collectorClientFor(runtime, fetchImpl, clock, sleep);
    const sources = [];
    for (const kind of TOSS_SOURCES) {
      sources.push({ kind, products: await activeClient.fetchProducts(kind) });
    }

    const links = new Map();
    for (const id of roundRobinProductIds(sources, limit)) {
      links.set(id, await activeClient.createSharelink(id));
      if (links.size === limit) break;
    }
    const recommendations = normalizeTossSnapshot(sources, links, limit, now);
    if (recommendations.length === 0) {
      throw new Error('Toss snapshot contains no valid recommendations');
    }
    const synced = await store.syncTossSharelinkSnapshot(recommendations);
    return { enabled: true, fetched: recommendations.length, ...synced };
  });

  if (collected === null) {
    return { enabled: true, skipped: 'lease-unavailable', fetched: 0, upserted: 0, ended: 0 };
  }
  return collected;
}

module.exports = {
  MAX_RESPONSE_BYTES,
  TOSS_API_ORIGIN,
  TOSS_API_PREFIX,
  TOSS_OAUTH_URL,
  TOSS_SOURCES,
  assertOfficialSuccess,
  createTossSharelinkClient,
  normalizeSharelinkUrl,
  normalizeTossSnapshot,
  readLimitedJsonResponse,
  readTossSharelinkRuntime,
  runTossSharelinkCollector,
};
