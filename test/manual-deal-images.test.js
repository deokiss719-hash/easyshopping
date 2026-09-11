const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  fetchStoredImage, nativeImageRequest, createManualDealImageRouter, createImageCache,
  createPinnedLookup, MAX_IMAGE_BYTES,
} = require('../src/manual-deal-images');

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

test('pinned DNS lookup supports Node single and all-address callback forms', async () => {
  const lookup = createPinnedLookup(PUBLIC[0]);
  const single = await new Promise((resolve, reject) => {
    lookup('cdn.example', { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  const multiple = await new Promise((resolve, reject) => {
    lookup('cdn.example', { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

  assert.deepEqual(single, PUBLIC[0]);
  assert.deepEqual(multiple, PUBLIC);
});

test('native production request exposes the upstream stream without buffering a body', async (t) => {
  const originalRequest = https.request;
  const upstream = Readable.from([Buffer.from('native-stream')]);
  upstream.statusCode = 200;
  upstream.headers = { 'content-type': 'image/webp' };
  https.request = (_url, _options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.end = () => callback(upstream);
    request.destroy = (error) => request.emit('error', error);
    return request;
  };
  t.after(() => { https.request = originalRequest; });

  const response = await nativeImageRequest(new URL(OWNED_URL), PUBLIC[0], { timeoutMs: 100 });
  assert.equal(response.stream, upstream);
  assert.equal(response.body, undefined);
});

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('stored image fetch pins public DNS and returns only exact supported image types', async () => {
  const selections = [];
  const result = await fetchStoredImage('https://cdn.example/phone.webp', {
    lookup: async () => PUBLIC,
    request: async (url, selected, options) => {
      selections.push({ url: url.href, selected, options });
      return { statusCode: 200, headers: { 'content-type': 'image/webp', 'content-encoding': 'identity' }, body: Buffer.from('image') };
    },
  });
  assert.equal(result.contentType, 'image/webp');
  assert.equal(result.body.toString(), 'image');
  assert.equal(selections[0].selected.address, PUBLIC[0].address);
  assert.equal(selections[0].options.maxBytes, MAX_IMAGE_BYTES);
});

test('stored image fetch validates every redirect against SSRF and HTTPS rules', async () => {
  const lookup = async (hostname) => hostname === 'private.example' ? [{ address: '169.254.169.254', family: 4 }] : PUBLIC;
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.jpg', {
    lookup,
    request: async () => ({ statusCode: 302, headers: { location: 'https://private.example/secret' }, body: Buffer.alloc(0) }),
  }), /public/i);
  await assert.rejects(() => fetchStoredImage('http://cdn.example/a.jpg', { lookup }), /HTTPS/i);
});

test('stored image fetch rejects compression, disguised types, and bodies over 10 MiB', async () => {
  const base = { lookup: async () => PUBLIC };
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.svg', {
    ...base, request: async () => ({ statusCode: 200, headers: { 'content-type': 'image/svg+xml' }, body: Buffer.from('<svg/>') }),
  }), /content-type/i);
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.jpg', {
    ...base, request: async () => ({ statusCode: 200, headers: { 'content-type': 'image/jpeg', 'content-encoding': 'gzip' }, body: Buffer.from('x') }),
  }), /compressed/i);
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.jpg', {
    ...base, request: async () => ({ statusCode: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(MAX_IMAGE_BYTES + 1) }),
  }), /large/i);
});

test('canonical public image endpoint only accepts numeric stored published owned records with safe revalidation', async (t) => {
  const calls = [];
  const store = {
    async getPublishedManualImage(id) {
      calls.push(id);
      return id === '7' ? { imageUrl: 'https://cdn.example/phone.png' } : null;
    },
  };
  const app = express();
  app.use('/api/public/manual-deals', createManualDealImageRouter({
    store,
    imageUrlValidator: (value) => value.startsWith('https://cdn.example/') ? value : null,
    imageFetcher: async () => ({ contentType: 'image/png', body: Buffer.from('png') }),
  }));
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  assert.equal((await fetch(`${origin}/api/public/manual-deals/anything/image`)).status, 404);
  assert.equal((await fetch(`${origin}/api/public/manual-deals/8/image`)).status, 404);
  const image = await fetch(`${origin}/api/public/manual-deals/7/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(Buffer.from(await image.arrayBuffer()).toString(), 'png');
  assert.deepEqual(calls, ['8', '7']);
});

test('public image proxy fails closed for a drifted non-owned stored URL', async (t) => {
  let fetches = 0;
  const app = express();
  app.use('/api/public/manual-deals', createManualDealImageRouter({
    store: { getPublishedManualImage: async () => ({ imageUrl: 'https://external.example/image.webp' }) },
    imageUrlValidator: () => null,
    imageFetcher: async () => { fetches += 1; return { contentType: 'image/webp', body: Buffer.from('x') }; },
  }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  assert.equal((await fetch(`${origin}/api/public/manual-deals/7/image`)).status, 404);
  assert.equal(fetches, 0);
});

const HASH = 'a'.repeat(64);
const OWNED_URL = `https://r2.example/deals/manual/${HASH}.webp`;

function createImageApp(options = {}) {
  const app = express();
  const router = createManualDealImageRouter({
    store: { getPublishedManualImage: async () => ({ imageUrl: OWNED_URL }) },
    imageUrlValidator: (value) => value === OWNED_URL ? value : null,
    ...options,
  });
  app.use('/api/public/manual-deals', router);
  return { app, router };
}

test('owned R2 hash supplies a strong ETag and matching If-None-Match returns 304 before fetch', async (t) => {
  let fetches = 0;
  const { app, router } = createImageApp({
    imageFetcher: async () => { fetches += 1; return { contentType: 'image/webp', body: Buffer.from('image') }; },
  });
  const { server, origin } = await listen(app);
  t.after(async () => { server.close(); await router.closeImageCache(); });

  const etag = `"${HASH}"`;
  const notModified = await fetch(`${origin}/api/public/manual-deals/7/image`, { headers: { 'if-none-match': etag } });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get('etag'), etag);
  assert.equal((await notModified.arrayBuffer()).byteLength, 0);
  assert.equal(fetches, 0);
});

test('repeated and concurrent misses share one bounded cached image fetch', async (t) => {
  let fetches = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { app, router } = createImageApp({
    imageFetcher: async () => {
      fetches += 1;
      await gate;
      return { contentType: 'image/webp', body: Buffer.from('shared') };
    },
  });
  const { server, origin } = await listen(app);
  t.after(async () => { server.close(); await router.closeImageCache(); });

  const first = fetch(`${origin}/api/public/manual-deals/7/image`);
  const second = fetch(`${origin}/api/public/manual-deals/8/image`);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await Promise.all(responses.map(async (response) => Buffer.from(await response.arrayBuffer()).toString())), ['shared', 'shared']);
  assert.equal(fetches, 1);
  assert.equal(Buffer.from(await (await fetch(`${origin}/api/public/manual-deals/9/image`)).arrayBuffer()).toString(), 'shared');
  assert.equal(fetches, 1);
});

test('streamed images use a bounded temp artifact instead of a heap body', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'easyshopping-image-test-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const result = await fetchStoredImage(OWNED_URL, {
    lookup: async () => PUBLIC,
    tempDir,
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/webp', 'content-encoding': 'identity' },
      stream: Readable.from([Buffer.from('streamed-'), Buffer.from('image')]),
    }),
  });
  assert.equal(result.body, undefined);
  assert.equal(typeof result.path, 'string');
  assert.equal(result.size, 14);
  assert.equal((await readdir(tempDir)).length, 1);
});

test('declared and chunked streamed oversize responses abort and clean partial temp files', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'easyshopping-image-limit-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const base = { lookup: async () => PUBLIC, tempDir, maxBytes: 5 };

  await assert.rejects(fetchStoredImage(OWNED_URL, {
    ...base,
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/webp', 'content-length': '6' },
      stream: Readable.from([Buffer.alloc(6)]),
    }),
  }), /large/i);
  assert.deepEqual(await readdir(tempDir), []);

  await assert.rejects(fetchStoredImage(OWNED_URL, {
    ...base,
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/webp' },
      stream: Readable.from([Buffer.alloc(3), Buffer.alloc(3)]),
    }),
  }), /large/i);
  assert.deepEqual(await readdir(tempDir), []);
});

test('failed fills are evicted so a retry can fetch successfully', async (t) => {
  let fetches = 0;
  const { app, router } = createImageApp({
    imageFetcher: async () => {
      fetches += 1;
      if (fetches === 1) throw new Error('temporary failure');
      return { contentType: 'image/webp', body: Buffer.from('retry') };
    },
  });
  const { server, origin } = await listen(app);
  t.after(async () => { server.close(); await router.closeImageCache(); });
  assert.equal((await fetch(`${origin}/api/public/manual-deals/7/image`)).status, 502);
  assert.equal((await fetch(`${origin}/api/public/manual-deals/7/image`)).status, 200);
  assert.equal(fetches, 2);
});

test('pending distinct fills reserve byte capacity while same-key callers still coalesce', async () => {
  const cache = createImageCache({ ttlMs: 60_000, maxEntries: 10, maxBytes: 6, fillReservationBytes: 2 });
  const releases = [];
  let loads = 0;
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => releases.push(() => resolve({
      contentType: 'image/webp', body: Buffer.from('x'), size: 1,
    })));
  };

  const first = cache.acquire('one', loader);
  const same = cache.acquire('one', loader);
  const second = cache.acquire('two', loader);
  const third = cache.acquire('three', loader);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 3);
  await assert.rejects(cache.acquire('four', loader), /capacity/i);
  assert.equal(loads, 3);

  releases.splice(0).forEach((release) => release());
  const leases = await Promise.all([first, same, second, third]);
  assert.equal(loads, 3);
  await Promise.all(leases.map((lease) => lease.release()));

  // Reservations shrink to actual sizes after completion, making room again.
  const fourth = await cache.acquire('four', async () => ({
    contentType: 'image/webp', body: Buffer.from('x'), size: 1,
  }));
  await fourth.release();
  await cache.close();
});

test('active leases cannot be evicted to admit a distinct fill beyond byte capacity', async () => {
  let currentTime = 0;
  const cache = createImageCache({
    ttlMs: 1, maxEntries: 2, maxBytes: 4, fillReservationBytes: 4, now: () => currentTime,
  });
  let loads = 0;
  const active = await cache.acquire('slow-client', async () => {
    loads += 1;
    return { contentType: 'image/webp', body: Buffer.alloc(4), size: 4 };
  });
  currentTime = 2;

  await assert.rejects(cache.acquire('other', async () => {
    loads += 1;
    return { contentType: 'image/webp', body: Buffer.alloc(1), size: 1 };
  }), /capacity/i);
  assert.equal(loads, 1);

  await active.release();
  const replacement = await cache.acquire('other', async () => {
    loads += 1;
    return { contentType: 'image/webp', body: Buffer.alloc(1), size: 1 };
  });
  assert.equal(loads, 2);
  await replacement.release();
  await cache.close();
});

test('close wins an acquire race after async prune and prevents its loader from starting', async () => {
  let currentTime = 0;
  let signalRemoval;
  const removalStarted = new Promise((resolve) => { signalRemoval = resolve; });
  let allowRemoval;
  const removalGate = new Promise((resolve) => { allowRemoval = resolve; });
  const cache = createImageCache({
    ttlMs: 60_000,
    maxEntries: 2,
    maxBytes: 2,
    fillReservationBytes: 1,
    artifactRemover: async () => {
      signalRemoval();
      await removalGate;
    },
    now: () => currentTime,
  });
  const old = await cache.acquire('old', async () => ({ contentType: 'image/webp', body: Buffer.from('x') }));
  await old.release();
  currentTime = 60_001;

  let newLoads = 0;
  const racedAcquire = cache.acquire('new', async () => {
    newLoads += 1;
    return { contentType: 'image/webp', body: Buffer.from('y') };
  });
  await removalStarted;
  const closing = cache.close();
  allowRemoval();

  await assert.rejects(racedAcquire, /closed/i);
  await closing;
  assert.equal(newLoads, 0);
  await assert.rejects(cache.acquire('later', async () => ({ body: Buffer.from('z') })), /closed/i);
});

test('close tracks an in-flight loader through rejected acquire and artifact cleanup', async () => {
  let finishLoad;
  const loadGate = new Promise((resolve) => { finishLoad = resolve; });
  let finishRemoval;
  const removalGate = new Promise((resolve) => { finishRemoval = resolve; });
  let signalRemoval;
  const removing = new Promise((resolve) => { signalRemoval = resolve; });
  const cache = createImageCache({
    ttlMs: 60_000,
    maxEntries: 2,
    maxBytes: 2,
    fillReservationBytes: 1,
    artifactRemover: async () => {
      signalRemoval();
      await removalGate;
    },
  });
  const acquiring = cache.acquire('pending', async () => {
    await loadGate;
    return { contentType: 'image/webp', body: Buffer.from('x'), size: 1 };
  });
  await new Promise((resolve) => setImmediate(resolve));

  let closed = false;
  const closing = cache.close().then(() => { closed = true; });
  finishLoad();
  await removing;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  finishRemoval();

  await assert.rejects(acquiring, /closed/i);
  await closing;
  assert.equal(closed, true);
});

test('pending fills are also bounded by entry count independently of byte budget', async () => {
  const cache = createImageCache({ ttlMs: 60_000, maxEntries: 2, maxBytes: 100, fillReservationBytes: 1 });
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await gate;
    return { contentType: 'image/webp', body: Buffer.from('x') };
  };
  const first = cache.acquire('one', loader);
  const second = cache.acquire('two', loader);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(cache.acquire('three', loader), /capacity/i);
  assert.equal(loads, 2);
  finish();
  const leases = await Promise.all([first, second]);
  await Promise.all(leases.map((lease) => lease.release()));
  await cache.close();
});

test('close retains disposed active entry accounting and waits for its lease cleanup', async () => {
  let removals = 0;
  const cache = createImageCache({
    ttlMs: 60_000,
    maxEntries: 1,
    maxBytes: 1,
    fillReservationBytes: 1,
    artifactRemover: async () => { removals += 1; },
  });
  const lease = await cache.acquire('active', async () => ({
    contentType: 'image/webp', body: Buffer.from('x'), size: 1,
  }));
  let closed = false;
  const closing = cache.close().then(() => { closed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  assert.equal(removals, 0);

  await lease.release();
  await closing;
  assert.equal(closed, true);
  assert.equal(removals, 1);
});
