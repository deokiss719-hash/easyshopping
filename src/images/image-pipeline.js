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
        const updated = await store?.updateImageState?.(deal.id, {
          imageStatus: 'failed',
          imageFailureCode: code,
          imageRetryAt,
        }, { onlyIfImageMissing: true });
        if (updated === null) {
          failureCache.clear(key);
          return { status: 'stale', provider: provider.name };
        }
        logger?.warn?.('상품 이미지 처리 실패', { source: deal.source, sourceItemId: deal.sourceItemId, provider: provider.name, code });
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

async function runImageBackfill({ store, pipeline, limit = 20, concurrency = 2 } = {}) {
  if (!store || typeof store.listImageBackfillCandidates !== 'function') throw new TypeError('backfill store is required');
  if (!pipeline || typeof pipeline.process !== 'function') throw new TypeError('image pipeline is required');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit must be between 1 and 100');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new TypeError('concurrency must be between 1 and 4');
  if (!pipeline.enabled) return { status: 'disabled', selected: 0, ready: 0, failed: 0, skipped: 0 };

  const deals = await store.listImageBackfillCandidates({ limit });
  const stats = { status: 'completed', selected: deals.length, ready: 0, failed: 0, skipped: 0 };
  await runWorkers(deals, concurrency, async (deal) => {
    const result = await pipeline.process(deal);
    if (result.status === 'ready') stats.ready += 1;
    else if (result.status === 'failed') stats.failed += 1;
    else stats.skipped += 1;
  });
  return stats;
}

module.exports = { ImageFailureCache, createImagePipeline, runImageBackfill };
