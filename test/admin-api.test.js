const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAdminApiRouter, adminJsonErrorHandler } = require('../src/admin/admin-api');
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

test('published manual API mapping exposes same-origin image endpoint instead of source URL', () => {
  const mapped = toApiDeal({
    id: '42', manualId: '7', source: 'manual', title: 'Phone', imageUrl: null,
    sourceImageUrl: 'https://external.example/phone.jpg', originalUrl: 'https://shop.example/phone', isEnded: false,
  });
  assert.equal(mapped.imageUrl, '/api/manual-deal-images/7');
  assert.equal(mapped.imageUrl.includes('external.example'), false);
});
