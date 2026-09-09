const { createHash } = require('node:crypto');
const { convertToWebp } = require('./webp');
const { safeMerchantUrl } = require('./provider-registry');

const DEFAULT_RETRY_MS = 6 * 60 * 60 * 1000;

function dealCacheKey(deal) {
  return `${String(deal?.source || '')}:${String(deal?.sourceItemId || deal?.id || '')}`;
}

class ImageFailureCache {
  constructor({ retryMs = DEFAULT_RETRY_MS, now = Date.now } = {}) {
    if (!Number.isSafeInteger(retryMs) || retryMs < 60_000) throw new TypeError('retryMs must be at least one minute');
    this.retryMs = retryMs;
    this.now = now;
    this.entries = new Map();
  }

  canAttempt(key) {
    const retryAt = this.entries.get(key);
    if (retryAt == null) return true;
    if (this.now() >= retryAt) {
      this.entries.delete(key);
      return true;
    }
    return false;
  }

  record(key) {
    if (this.entries.size >= 1000 && !this.entries.has(key)) this.entries.delete(this.entries.keys().next().value);
    const retryAt = this.now() + this.retryMs;
    this.entries.set(key, retryAt);
    return new Date(retryAt).toISOString();
  }

  clear(key) {
    this.entries.delete(key);
  }
}

class ImageBackfillCircuitBreaker {
  constructor({ cooldownMs = DEFAULT_RETRY_MS, now = Date.now, failureCodes = ['page_http_403'] } = {}) {
    if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 60_000) throw new TypeError('cooldownMs must be at least one minute');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    if (!Array.isArray(failureCodes) || failureCodes.length === 0) throw new TypeError('failureCodes must be a non-empty array');
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.failureCodes = new Set(failureCodes);
    this.blockedUntil = 0;
  }

  canAttempt() {
    return this.now() >= this.blockedUntil;
  }

  record(code) {
    if (!this.failureCodes.has(code)) return null;
    this.blockedUntil = this.now() + this.cooldownMs;
    return new Date(this.blockedUntil).toISOString();
  }
}

function safeSourceImageUrl(value) {
  const url = safeMerchantUrl(value);
  return url?.href || null;
}

function failureCode(error) {
  if (error?.code === 'unsafe_source_image_url') return 'unsafe_source_image_url';
  if (error?.code === 'image_too_small') return 'image_too_small';
  if (error?.code === 'body_image_missing') return 'body_image_missing';
  if (/^(?:page|image)_(?:http_\d{3}|[a-z0-9_]{1,48})$/.test(String(error?.code || ''))) return error.code;
  if (error instanceof RangeError) return 'image_too_large';
  if (/unsupported|content.?type/i.test(String(error?.message || ''))) return 'unsupported_image';
  return 'provider_error';
}

function createImagePipeline({
  providerRegistry,
  storage,
  store,
  convert = convertToWebp,
  failureCache = new ImageFailureCache(),
  logger = console,
} = {}) {
  if (!providerRegistry || typeof providerRegistry.find !== 'function') throw new TypeError('providerRegistry is required');
  if (!storage || typeof storage.enabled !== 'boolean') throw new TypeError('storage is required');

  return Object.freeze({
    enabled: storage.enabled,
    async process(deal) {
      const originalUrl = deal?.originalUrl || null;
      const merchantUrl = deal?.merchantUrl || null;
      if (!originalUrl && !merchantUrl) return { status: 'missing_merchant_url' };
      if (!storage.enabled) return { status: 'disabled' };

      const originalProvider = providerRegistry.find(originalUrl);
      const provider = originalProvider || providerRegistry.find(merchantUrl);
      const key = dealCacheKey(deal);
      if (!failureCache.canAttempt(key)) return { status: 'cached_failure' };
      if (!provider) {
        const imageRetryAt = failureCache.record(key);
        const updated = await store?.updateImageState?.(deal.id, {
          imageStatus: 'unsupported_provider',
          imageFailureCode: 'unsupported_provider',
          imageRetryAt,
        }, { onlyIfImageMissing: true });
        if (updated === null) {
          failureCache.clear(key);
          return { status: 'stale' };
        }
        return { status: 'unsupported_provider' };
      }
      const sourceUrl = originalProvider ? originalUrl : merchantUrl;

      try {
        const candidate = await provider.fetchImageCandidate({
          merchantUrl: deal.merchantUrl || null,
          sourceUrl,
          deal: Object.freeze({ ...deal }),
        });
        if (!candidate || !Buffer.isBuffer(candidate.body)) throw new Error('provider returned no image');
        if (!/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/i.test(String(candidate.contentType || ''))) {
          throw new Error('unsupported image content type');
        }
        const sourceImageUrl = safeSourceImageUrl(candidate.sourceImageUrl);
        if (!sourceImageUrl || !provider.isAllowedImageUrl(new URL(sourceImageUrl))) {
          throw Object.assign(new Error('provider returned an unapproved source image URL'), { code: 'unsafe_source_image_url' });
        }

        const body = await convert(candidate.body);
        const objectHash = createHash('sha256')
          .update(`${deal.source}:${deal.sourceItemId}:${sourceImageUrl}`)
          .digest('hex');
        const sourceSegment = String(deal.source || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64) || 'unknown';
        const objectKey = `deals/${sourceSegment}/${objectHash}.webp`;
        const imageUrl = await storage.uploadWebp({ key: objectKey, body });
        const updated = await store?.updateImageState?.(deal.id, {
          imageStatus: 'ready',
          imageUrl,
          sourceImageUrl,
          imageProvider: provider.name,
          imageFailureCode: null,
          imageRetryAt: null,
        }, { onlyIfImageMissing: true });
        if (updated === null) {
          failureCache.clear(key);
          return { status: 'stale', provider: provider.name };
        }
        failureCache.clear(key);
        return { status: 'ready', provider: provider.name, imageUrl };
      } catch (error) {
        const code = failureCode(error);
        const imageRetryAt = failureCache.record(key);
        let updated;
        try {
          updated = await store?.updateImageState?.(deal.id, {
            imageStatus: 'failed',
            imageFailureCode: code,
            imageRetryAt,
          }, { onlyIfImageMissing: true });
        } catch (persistenceError) {
          persistenceError.detectedFailureCode = code;
          throw persistenceError;
        }
        if (updated === null) {
          failureCache.clear(key);
          return { status: 'stale', provider: provider.name };
        }
        try {
          logger?.warn?.('상품 이미지 처리 실패', { source: deal.source, sourceItemId: deal.sourceItemId, provider: provider.name, code });
        } catch (loggingError) {
          loggingError.detectedFailureCode = code;
          throw loggingError;
        }
        return { status: 'failed', provider: provider.name, code };
      }
    },
  });
}

async function runWorkers(items, concurrency, worker) {
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

async function runImageBackfill({
  store,
  pipeline,
  limit = 20,
  concurrency = 2,
  delayMs = 0,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  stopOnFailureCodes = [],
} = {}) {
  if (!store || typeof store.listImageBackfillCandidates !== 'function') throw new TypeError('backfill store is required');
  if (!pipeline || typeof pipeline.process !== 'function') throw new TypeError('image pipeline is required');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit must be between 1 and 100');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new TypeError('concurrency must be between 1 and 4');
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new TypeError('delayMs must be between 0 and 60000');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
  if (!Array.isArray(stopOnFailureCodes)) throw new TypeError('stopOnFailureCodes must be an array');
  if ((delayMs > 0 || stopOnFailureCodes.length > 0) && concurrency !== 1) {
    throw new TypeError('rate-limited backfill requires concurrency 1');
  }
  if (!pipeline.enabled) return { status: 'disabled', selected: 0, ready: 0, failed: 0, skipped: 0 };

  const deals = await store.listImageBackfillCandidates({ limit });
  const stats = { status: 'completed', selected: deals.length, ready: 0, failed: 0, skipped: 0 };
  const stopCodes = new Set(stopOnFailureCodes);

  if (delayMs > 0 || stopCodes.size > 0) {
    for (let index = 0; index < deals.length; index += 1) {
      if (index > 0 && delayMs > 0) await sleep(delayMs);
      const result = await pipeline.process(deals[index]);
      if (result.status === 'ready') stats.ready += 1;
      else if (result.status === 'failed') stats.failed += 1;
      else stats.skipped += 1;
      if (result.status === 'failed' && stopCodes.has(result.code)) {
        stats.status = 'halted';
        stats.haltedCode = result.code;
        stats.skipped += deals.length - index - 1;
        break;
      }
    }
    return stats;
  }

  await runWorkers(deals, concurrency, async (deal) => {
    const result = await pipeline.process(deal);
    if (result.status === 'ready') stats.ready += 1;
    else if (result.status === 'failed') stats.failed += 1;
    else stats.skipped += 1;
  });
  return stats;
}

const emptyBackfillStats = (status, extra = {}) => ({
  status, ...extra, selected: 0, ready: 0, failed: 0, skipped: 0,
});

async function runGuardedImageBackfill({ store, pipeline, breaker, ...options } = {}) {
  if (!store || typeof store.withImageBackfillLease !== 'function') throw new TypeError('lease-capable backfill store is required');
  if (!breaker || typeof breaker.canAttempt !== 'function' || typeof breaker.record !== 'function') {
    throw new TypeError('backfill circuit breaker is required');
  }
  const leasedResult = await store.withImageBackfillLease(async () => {
    const durableRetryAt = typeof store.getImageBackfillCooldown === 'function'
      ? await store.getImageBackfillCooldown()
      : null;
    if (durableRetryAt && Date.parse(durableRetryAt) > breaker.now()) {
      breaker.blockedUntil = Math.max(breaker.blockedUntil, Date.parse(durableRetryAt));
      return emptyBackfillStats('cooldown', { retryAt: durableRetryAt });
    }
    if (!breaker.canAttempt()) {
      return emptyBackfillStats('cooldown', { retryAt: new Date(breaker.blockedUntil).toISOString() });
    }

    let result;
    try {
      result = await runImageBackfill({
        store, pipeline, concurrency: 1, stopOnFailureCodes: ['page_http_403'], ...options,
      });
    } catch (error) {
      if (error?.detectedFailureCode === 'page_http_403') {
        const retryAt = breaker.record(error.detectedFailureCode);
        if (retryAt && typeof store.recordImageBackfillCooldown === 'function') {
          try {
            await store.recordImageBackfillCooldown(error.detectedFailureCode, retryAt);
          } catch (cooldownPersistenceError) {
            error.cooldownPersistenceError = cooldownPersistenceError;
          }
        }
      }
      throw error;
    }
    if (result?.haltedCode === 'page_http_403') {
      const retryAt = breaker.record(result.haltedCode);
      if (retryAt && typeof store.recordImageBackfillCooldown === 'function') {
        try {
          result.retryAt = await store.recordImageBackfillCooldown(result.haltedCode, retryAt);
        } catch (error) {
          error.detectedFailureCode = result.haltedCode;
          throw error;
        }
      } else {
        result.retryAt = retryAt;
      }
    }
    return result;
  });
  return leasedResult ?? emptyBackfillStats('locked');
}

module.exports = {
  ImageFailureCache,
  ImageBackfillCircuitBreaker,
  createImagePipeline,
  runImageBackfill,
  runGuardedImageBackfill,
};
