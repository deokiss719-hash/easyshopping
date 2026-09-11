const https = require('node:https');
const { createReadStream, createWriteStream } = require('node:fs');
const { mkdir, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const express = require('express');
const { validateUrl } = require('./url-metadata/url-metadata');
const { createPinnedLookup, defaultLookup, resolvePublic } = require('./pinned-https');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CACHE_ENTRIES = 32;
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;
const DEFAULT_TEMP_DIR = join(tmpdir(), 'easyshopping-manual-images');
const CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

function nativeImageRequest(url, selected, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
        'accept-encoding': 'identity',
        'user-agent': 'easyshopping-manual-image/1.0',
      },
      lookup: createPinnedLookup(selected),
      agent: false,
    }, (response) => resolve({
      statusCode: response.statusCode,
      headers: response.headers,
      stream: response,
    }));
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
    request.end();
  });
}

function discardResponse(response) {
  if (response?.stream?.destroy) response.stream.destroy();
}

async function streamToTempFile(stream, { maxBytes, tempDir }) {
  await mkdir(tempDir, { recursive: true, mode: 0o700 });
  const path = join(tempDir, `${randomUUID()}.image`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) callback(new Error('response body is too large'));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, limiter, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    return { path, size };
  } catch (error) {
    if (stream?.destroy) stream.destroy();
    await unlink(path).catch(() => {});
    throw error;
  }
}

async function fetchStoredImage(value, options = {}) {
  const lookup = options.lookup || defaultLookup;
  const request = options.request || nativeImageRequest;
  const maxBytes = options.maxBytes || MAX_IMAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let url = validateUrl(value);
  const visited = new Set();

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (visited.has(url.href)) throw new Error('redirect loop detected');
    visited.add(url.href);
    const selected = await resolvePublic(url, lookup);
    const response = await request(url, selected, {
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBytes,
    });
    const status = Number(response.statusCode);
    if ([301, 302, 303, 307, 308].includes(status)) {
      discardResponse(response);
      if (redirects >= maxRedirects) throw new Error('too many redirects');
      if (!response.headers?.location) throw new Error('redirect has no location');
      url = validateUrl(new URL(response.headers.location, url));
      continue;
    }
    if (status < 200 || status >= 300) {
      discardResponse(response);
      throw new Error(`upstream HTTP status ${status}`);
    }
    const contentType = String(response.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) {
      discardResponse(response);
      throw new Error('upstream content-type must be a supported image');
    }
    const encoding = String(response.headers?.['content-encoding'] || 'identity').trim().toLowerCase();
    if (encoding !== 'identity') {
      discardResponse(response);
      throw new Error('compressed responses are not accepted');
    }
    const declared = Number(response.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      discardResponse(response);
      throw new Error('response body is too large');
    }

    if (response.stream) {
      const artifact = await streamToTempFile(response.stream, {
        maxBytes,
        tempDir: options.tempDir || DEFAULT_TEMP_DIR,
      });
      return { contentType, ...artifact };
    }

    // Keep request injection compatible for focused unit tests; the native path above never buffers.
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || '');
    if (body.length > maxBytes) throw new Error('response body is too large');
    return { contentType, body, size: body.length };
  }
  throw new Error('too many redirects');
}

function imageEtag(value) {
  try {
    const url = new URL(value);
    if (url.search || url.hash) return null;
    const match = url.pathname.match(/^\/deals\/manual\/([a-f0-9]{64})\.webp$/);
    return match ? `"${match[1]}"` : null;
  } catch {
    return null;
  }
}

function etagMatches(header, etag) {
  if (!etag || !header) return false;
  return String(header).split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || value === etag || value.replace(/^W\//, '') === etag;
  });
}

async function removeArtifact(image) {
  if (image?.path) await unlink(image.path).catch(() => {});
}

function createImageCache({
  ttlMs,
  maxEntries,
  maxBytes,
  fillReservationBytes = Math.min(MAX_IMAGE_BYTES, maxBytes),
  artifactRemover = removeArtifact,
  now = Date.now,
}) {
  const entries = new Map();
  const trackedEntries = new Set();
  const loaderTasks = new Set();
  let totalBytes = 0;
  let closed = false;
  let closePromise;

  if (!Number.isFinite(fillReservationBytes) || fillReservationBytes <= 0) {
    throw new TypeError('image cache fill reservation must be positive');
  }

  function createEntry(key) {
    let resolveDone;
    const entry = {
      key,
      promise: null,
      image: null,
      size: 0,
      accountedBytes: fillReservationBytes,
      refs: 0,
      loading: true,
      disposed: false,
      cleanupPromise: null,
      done: new Promise((resolve) => { resolveDone = resolve; }),
      resolveDone,
    };
    trackedEntries.add(entry);
    totalBytes += entry.accountedBytes;
    return entry;
  }

  function finalize(entry) {
    if (!entry.disposed || entry.loading || entry.refs > 0) return undefined;
    if (!entry.cleanupPromise) {
      entry.cleanupPromise = (async () => {
        await artifactRemover(entry.image);
        totalBytes -= entry.accountedBytes;
        entry.accountedBytes = 0;
        trackedEntries.delete(entry);
        entry.resolveDone();
      })();
    }
    return entry.cleanupPromise;
  }

  async function dispose(entry) {
    if (!entry) return;
    entry.disposed = true;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    await finalize(entry);
  }

  function idleVictim(protectedEntry) {
    return [...entries.values()].find((entry) => (
      entry !== protectedEntry && !entry.loading && entry.refs === 0 && !entry.disposed
    ));
  }

  async function makeCapacity(requiredEntries, requiredBytes, protectedEntry) {
    while (trackedEntries.size + requiredEntries > maxEntries || totalBytes + requiredBytes > maxBytes) {
      const victim = idleVictim(protectedEntry);
      if (!victim) throw new Error('image cache is at capacity');
      await dispose(victim);
      if (closed) throw new Error('image cache is closed');
    }
  }

  async function prune(at = now(), protectedEntry) {
    for (const entry of [...entries.values()]) {
      if (entry !== protectedEntry && !entry.loading && entry.refs === 0 && entry.expiresAt <= at) {
        await dispose(entry);
      }
    }
  }

  function startLoader(entry, loader) {
    const task = Promise.resolve().then(loader).then(async (image) => {
      const size = Number.isFinite(image?.size) ? image.size : (image?.body?.length || 0);
      entry.image = image;
      entry.size = size;
      entry.loading = false;

      if (size > maxBytes) {
        await dispose(entry);
        throw new Error('cached image is too large');
      }
      if (closed || entry.disposed) {
        await dispose(entry);
        throw new Error('image cache is closed');
      }

      const additionalBytes = Math.max(0, size - entry.accountedBytes);
      await makeCapacity(0, additionalBytes, entry);
      totalBytes += size - entry.accountedBytes;
      entry.accountedBytes = size;
      entry.expiresAt = now() + ttlMs;
      await prune(now(), entry);
      return image;
    }).catch(async (error) => {
      entry.loading = false;
      await dispose(entry);
      throw error;
    }).finally(() => {
      loaderTasks.delete(task);
    });
    loaderTasks.add(task);
    entry.promise = task;
  }

  async function acquire(key, loader) {
    if (closed) throw new Error('image cache is closed');
    await prune();
    // prune/disposal can await filesystem I/O while close() starts.
    if (closed) throw new Error('image cache is closed');

    let entry = entries.get(key);
    while (!entry) {
      await makeCapacity(1, fillReservationBytes);
      if (closed) throw new Error('image cache is closed');
      // Another caller may have installed this key while capacity eviction awaited.
      entry = entries.get(key);
      if (entry) break;
      // Capacity may likewise have been consumed by another distinct caller.
      if (trackedEntries.size + 1 > maxEntries || totalBytes + fillReservationBytes > maxBytes) continue;
      entry = createEntry(key);
      entries.set(key, entry);
      startLoader(entry, loader);
    }

    if (entry.promise) await entry.promise;
    if (closed) throw new Error('image cache is closed');
    if (entry.disposed || !entry.image) return acquire(key, loader);
    entry.refs += 1;
    entry.expiresAt = now() + ttlMs;
    // Refresh insertion order for predictable LRU eviction.
    entries.delete(key);
    entries.set(key, entry);
    return {
      image: entry.image,
      release: async () => {
        entry.refs = Math.max(0, entry.refs - 1);
        if (entry.disposed) await finalize(entry);
      },
    };
  }

  const timer = setInterval(() => { prune().catch(() => {}); }, Math.max(1, Math.min(ttlMs, 1_000)));
  timer.unref();

  return {
    acquire,
    close() {
      if (closePromise) return closePromise;
      closed = true;
      clearInterval(timer);
      closePromise = (async () => {
        const closingEntries = [...trackedEntries];
        await Promise.all(closingEntries.map((entry) => dispose(entry)));
        await Promise.allSettled([...loaderTasks]);
        await Promise.all(closingEntries.map((entry) => entry.done));
      })();
      return closePromise;
    },
  };
}

function createManualDealImageRouter({
  store,
  imageUrlValidator = () => null,
  imageFetcher = fetchStoredImage,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  cacheMaxEntries = DEFAULT_CACHE_ENTRIES,
  cacheMaxBytes = DEFAULT_CACHE_BYTES,
} = {}) {
  if (!store?.getPublishedManualImage) throw new TypeError('manual image store is required');
  const cache = createImageCache({ ttlMs: cacheTtlMs, maxEntries: cacheMaxEntries, maxBytes: cacheMaxBytes });
  const router = express.Router();
  router.get('/:id/image', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    let lease;
    try {
      const record = await store.getPublishedManualImage(req.params.id);
      if (!record?.imageUrl) return res.sendStatus(404);
      const imageUrl = imageUrlValidator(record.imageUrl);
      if (!imageUrl) return res.sendStatus(404);

      const etag = imageEtag(imageUrl);
      res.set('Cache-Control', CACHE_CONTROL);
      if (etag) res.set('ETag', etag);
      if (etagMatches(req.get('If-None-Match'), etag)) return res.status(304).end();

      lease = await cache.acquire(imageUrl, () => imageFetcher(imageUrl));
      const { image } = lease;
      res.set('Content-Type', image.contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      if (image.path) {
        await pipeline(createReadStream(image.path), res);
        return undefined;
      }
      return res.send(image.body);
    } catch {
      if (res.headersSent) {
        res.destroy();
        return undefined;
      }
      return res.status(502).json({ error: 'image_unavailable' });
    } finally {
      if (lease) await lease.release();
    }
  });
  router.closeImageCache = () => cache.close();
  return router;
}

module.exports = {
  fetchStoredImage, nativeImageRequest, createManualDealImageRouter, createImageCache,
  createPinnedLookup, MAX_IMAGE_BYTES, IMAGE_TYPES,
};
