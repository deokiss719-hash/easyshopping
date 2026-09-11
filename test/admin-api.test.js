const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  createAdminApiRouter, createManualImageUrlValidator, adminJsonErrorHandler,
} = require('../src/admin/admin-api');
const { toApiDeal } = require('../src/live-deals-api');

async function listen(app) { const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); return { server, origin: `http://127.0.0.1:${server.address().port}` }; }

test('every admin API is behind authentication and mutations are CSRF protected', async (t) => {
  const calls = [];
  const auth = { requireAuth(req, res, next) { if (req.headers.authorization !== 'ok') return res.sendStatus(401); next(); }, requireMutationProtection(req, res, next) { calls.push(req.method); if (req.headers['x-csrf-token'] !== 'ok') return res.sendStatus(403); next(); } };
  const store = { listManualDeals: async () => [], createManualDeal: async (x) => x, updateManualDeal: async (_id, x) => x, deleteManualDeal: async () => true, getSettings: async () => ({}), setSetting: async () => ({}), setSettings: async (x) => x };
  const app = express(); app.use(express.json()); app.use('/api/admin', createAdminApiRouter({ store, auth, metadataFetcher: async () => ({ title: 'Phone' }) }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  assert.equal((await fetch(`${origin}/api/admin/manual-deals`)).status, 401);
  assert.equal((await fetch(`${origin}/api/admin/manual-deals`, { headers: { authorization: 'ok' } })).status, 200);
  assert.equal((await fetch(`${origin}/api/admin/manual-deals`, { method: 'POST', headers: { authorization: 'ok', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${origin}/api/admin/url-metadata`, { method: 'POST', headers: { authorization: 'ok', 'x-csrf-token': 'ok', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://shop.example' }) })).status, 200);
  const settings = await fetch(`${origin}/api/admin/settings`, { method: 'PUT', headers: { authorization: 'ok', 'x-csrf-token': 'ok', 'content-type': 'application/json' }, body: JSON.stringify({ values: { home_manual_limit: 4 } }) });
  assert.equal(settings.status, 200);
  assert.deepEqual(await settings.json(), { home_manual_limit: 4 });
  assert.ok(calls.includes('POST'));
});

test('public settings route returns only store public values', async (t) => {
  const { createPublicSettingsRouter } = require('../src/admin/admin-api');
  const app = express(); app.use('/api/site-settings', createPublicSettingsRouter({ getPublicSettings: async () => ({ home_manual_limit: 4 }) }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  assert.deepEqual(await (await fetch(`${origin}/api/site-settings`)).json(), { home_manual_limit: 4 });
});

test('admin JSON parser returns bounded JSON errors without HTML or stacks', async (t) => {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.post('/api/admin/probe', (_req, res) => res.sendStatus(204));
  app.use(adminJsonErrorHandler);
  const { server, origin } = await listen(app); t.after(() => server.close());

  const malformed = await fetch(`${origin}/api/admin/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('content-type').startsWith('application/json'), true);
  assert.deepEqual(await malformed.json(), { error: 'invalid_json' });

  const oversized = await fetch(`${origin}/api/admin/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(33 * 1024) }) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'request_too_large' });
});

test('published manual API mapping exposes only the canonical same-origin image endpoint', () => {
  const mapped = toApiDeal({
    id: '42', manualId: '7', source: 'manual', title: 'Phone', imageUrl: 'https://drift.example/projected.webp',
    hasManualImage: true,
    sourceImageUrl: 'https://external.example/phone.jpg', originalUrl: 'https://shop.example/phone', isEnded: false,
  });
  assert.equal(mapped.imageUrl, '/api/public/manual-deals/7/image');
  assert.equal(mapped.imageUrl.includes('external.example'), false);
  assert.equal(mapped.url, 'https://shop.example/phone');
});

test('manual API mapping fails closed instead of returning drifted raw image URLs', () => {
  for (const deal of [
    { source: 'manual', manualId: null, hasManualImage: true },
    { source: 'manual', manualId: '7', hasManualImage: false },
    { source: 'manual', manualId: 'not-numeric', hasManualImage: true },
  ]) {
    const mapped = toApiDeal({
      id: '42', title: 'Phone', imageUrl: 'https://drift.example/projected.webp',
      sourceImageUrl: 'https://drift.example/source.webp', isEnded: false, ...deal,
    });
    assert.equal(mapped.imageUrl, null);
  }
});

test('manual create and update accept only exact app-owned R2 manual object URLs', async (t) => {
  const hash = 'a'.repeat(64);
  const owned = `https://images.example.test/base/deals/manual/${hash}.webp`;
  const saved = [];
  const auth = { requireAuth: (_req, _res, next) => next(), requireMutationProtection: (_req, _res, next) => next() };
  const store = {
    async createManualDeal(input) { saved.push(input); return input; },
    async updateManualDeal(_id, input) { saved.push(input); return input; },
    listManualDeals: async () => [],
  };
  const imageStorage = { enabled: true, publicUrlForKey: (key) => `https://images.example.test/base/${key}` };
  const app = express(); app.use(express.json());
  app.use('/api/admin', createAdminApiRouter({
    store, auth, imageUrlValidator: createManualImageUrlValidator(imageStorage),
  }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const request = (method, imageUrl) => fetch(`${origin}/api/admin/manual-deals${method === 'PUT' ? '/7' : ''}`, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Phone', imageUrl }),
  });

  assert.equal((await request('POST', owned)).status, 201);
  assert.equal((await request('PUT', owned)).status, 200);
  for (const rejected of [
    'https://external.example/image.webp',
    `https://images.example.test/base/deals/manual/${'A'.repeat(64)}.webp`,
    `https://images.example.test/base/deals/manual/${hash}.png`,
    `${owned}?token=x`,
  ]) assert.equal((await request('POST', rejected)).status, 400, rejected);
  assert.equal(saved.length, 2);
});

test('manual image URL persistence fails closed when R2 is not configured', async (t) => {
  let writes = 0;
  const auth = { requireAuth: (_req, _res, next) => next(), requireMutationProtection: (_req, _res, next) => next() };
  const store = { listManualDeals: async () => [], createManualDeal: async () => { writes += 1; } };
  const app = express(); app.use(express.json());
  app.use('/api/admin', createAdminApiRouter({ store, auth, imageUrlValidator: createManualImageUrlValidator({ enabled: false }) }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const response = await fetch(`${origin}/api/admin/manual-deals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Phone', imageUrl: `https://images.example/deals/manual/${'a'.repeat(64)}.webp` }),
  });
  assert.equal(response.status, 400);
  assert.equal(writes, 0);
});

test('admin image upload is authenticated, same-origin/CSRF protected, decoded, and stored under a server key', async (t) => {
  const uploads = [];
  let conversions = 0;
  const auth = {
    requireAuth(req, res, next) {
      if (req.get('authorization') !== 'ok') return res.status(401).json({ error: 'authentication_required' });
      return next();
    },
    requireMutationProtection(req, res, next) {
      if (req.get('origin') !== `http://${req.get('host')}`) return res.status(403).json({ error: 'same_origin_required' });
      if (req.get('x-csrf-token') !== 'ok') return res.status(403).json({ error: 'csrf_invalid' });
      return next();
    },
  };
  const store = { listManualDeals: async () => [] };
  const storage = {
    enabled: true,
    publicUrlForKey(key) { return `https://images.example.test/${key}`; },
    async uploadWebp(value) {
      uploads.push(value);
      return `https://images.example.test/${value.key}`;
    },
  };
  const convertImage = async (body) => {
    conversions += 1;
    assert.deepEqual(body, Buffer.from('valid png bytes'));
    return Buffer.from('encoded webp');
  };
  const app = express();
  app.use('/api/admin', createAdminApiRouter({ store, auth, imageStorage: storage, convertImage }));
  app.use(adminJsonErrorHandler);
  const { server, origin } = await listen(app); t.after(() => server.close());
  const url = `${origin}/api/admin/images`;

  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'ok', origin, 'content-type': 'image/png' }, body: 'x' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'ok', origin: 'https://evil.example', 'x-csrf-token': 'ok', 'content-type': 'image/png' }, body: 'x' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'ok', origin, 'x-csrf-token': 'ok', 'content-type': 'image/svg+xml' }, body: '<svg/>' })).status, 415);

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'ok', origin, 'x-csrf-token': 'ok', 'content-type': 'image/png', 'x-file-name': '../../secret.png' },
    body: 'valid png bytes',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { imageUrl: `https://images.example.test/${uploads[0].key}` });
  assert.equal(conversions, 1);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].key, /^deals\/manual\/[a-f0-9]{64}\.webp$/);
  assert.equal(uploads[0].key.includes('secret'), false);
  assert.deepEqual(uploads[0].body, Buffer.from('encoded webp'));
});

test('admin image upload fails closed for unavailable storage, bad images, unsafe output URLs, and oversized bodies', async (t) => {
  const auth = { requireAuth: (_req, _res, next) => next(), requireMutationProtection: (_req, _res, next) => next() };
  const store = { listManualDeals: async () => [] };
  const app = express();
  app.use('/unavailable', createAdminApiRouter({ store, auth, imageStorage: { enabled: false }, convertImage: async () => Buffer.from('no') }));
  app.use('/invalid', createAdminApiRouter({ store, auth, imageStorage: { enabled: true, publicUrlForKey: (key) => `https://images.example/${key}`, uploadWebp: async () => 'https://images.example/x.webp' }, convertImage: async () => { throw new Error('decoder internals'); } }));
  app.use('/unsafe', createAdminApiRouter({ store, auth, imageStorage: { enabled: true, publicUrlForKey: (key) => `https://images.example/${key}`, uploadWebp: async () => 'http://127.0.0.1/credentials' }, convertImage: async () => Buffer.from('webp') }));
  app.use(adminJsonErrorHandler);
  const { server, origin } = await listen(app); t.after(() => server.close());
  const options = { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: 'not really an image' };

  const unavailable = await fetch(`${origin}/unavailable/images`, options);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'image_storage_unavailable' });
  const invalid = await fetch(`${origin}/invalid/images`, options);
  assert.equal(invalid.status, 422);
  assert.deepEqual(await invalid.json(), { error: 'invalid_image' });
  const unsafe = await fetch(`${origin}/unsafe/images`, options);
  assert.equal(unsafe.status, 502);
  assert.deepEqual(await unsafe.json(), { error: 'image_upload_failed' });
  const oversized = await fetch(`${origin}/invalid/images`, {
    method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.alloc((10 * 1024 * 1024) + 1),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'request_too_large' });
});

test('admin image upload accepts only the storage-owned URL for the exact generated key', async (t) => {
  const auth = { requireAuth: (_req, _res, next) => next(), requireMutationProtection: (_req, _res, next) => next() };
  const store = { listManualDeals: async () => [] };
  let returnedUrl = (_key) => '';
  const storage = Object.freeze({
    enabled: true,
    publicUrlForKey: (key) => `https://images.example.test/base/${key}`,
    uploadWebp: async ({ key }) => returnedUrl(key),
  });
  const app = express();
  app.use('/api/admin', createAdminApiRouter({ store, auth, imageStorage: storage, convertImage: async () => Buffer.from('webp') }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const upload = () => fetch(`${origin}/api/admin/images`, {
    method: 'POST', headers: { 'content-type': 'image/png' }, body: 'decoded image',
  });

  const attacks = [
    (key) => `https://evil.example/${key}`,
    (key) => `https://images.example.test/baseball/${key}`,
    (key) => `https://user:pass@images.example.test/base/${key}`,
    (key) => `https://images.example.test/base/${key}?token=secret`,
    (key) => `https://images.example.test/base/${key}#fragment`,
    (key) => `https://images.example.test/base/${key}/extra`,
    (key) => `https://images.example.test/base/%2e%2e/base/${key}`,
    (key) => `https://images.example.test/base%2f${key}`,
  ];
  for (const attack of attacks) {
    returnedUrl = attack;
    const response = await upload();
    assert.equal(response.status, 502, attack('deals/manual/key.webp'));
    assert.deepEqual(await response.json(), { error: 'image_upload_failed' });
  }

  returnedUrl = (key) => storage.publicUrlForKey(key);
  const accepted = await upload();
  assert.equal(accepted.status, 201);
  assert.match((await accepted.json()).imageUrl, /^https:\/\/images\.example\.test\/base\/deals\/manual\/[a-f0-9]{64}\.webp$/);
});

test('admin image upload rejects decoded SVG even when it is labelled as an allowed image type', async (t) => {
  const auth = { requireAuth: (_req, _res, next) => next(), requireMutationProtection: (_req, _res, next) => next() };
  let uploads = 0;
  const storage = {
    enabled: true,
    publicUrlForKey: (key) => `https://images.example.test/${key}`,
    uploadWebp: async ({ key }) => { uploads += 1; return `https://images.example.test/${key}`; },
  };
  const app = express();
  app.use('/api/admin', createAdminApiRouter({ store: { listManualDeals: async () => [] }, auth, imageStorage: storage }));
  const { server, origin } = await listen(app); t.after(() => server.close());

  const response = await fetch(`${origin}/api/admin/images`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: 'invalid_image' });
  assert.equal(uploads, 0);
});
