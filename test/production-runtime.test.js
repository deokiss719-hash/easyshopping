const test = require('node:test');
const assert = require('node:assert/strict');

const {
  APPROVED_FEED_SOURCE,
  APPROVED_FEED_URL,
  readAdminRuntime,
  readCollectorRuntime,
  mountDatabaseApis,
} = require('../src/production-runtime');

test('production database APIs stay public and fail closed when admin session secret is absent', async () => {
  const mounted = [];
  const bootstraps = [];
  const app = { use(path, router) { mounted.push([path, router]); } };
  const adminStore = {
    async bootstrapAdmin(...args) { bootstraps.push(args); },
  };
  const adminRuntime = readAdminRuntime({
    ADMIN_USERNAME: 'render-admin',
    ADMIN_PASSWORD_HASH: 'stored-password-hash',
  });

  const auth = await mountDatabaseApis({
    app,
    adminStore,
    adminRuntime,
    createAuth() { throw new Error('admin auth must remain disabled'); },
    createAdminApi() { throw new Error('admin API must remain disabled'); },
    createPublicSettings: () => 'public-settings-router',
    createManualImages: () => 'published-manual-images-router',
  });

  assert.equal(auth, null);
  assert.deepEqual(bootstraps, []);
  assert.deepEqual(mounted, [
    ['/api/site-settings', 'public-settings-router'],
    ['/api/public/manual-deals', 'published-manual-images-router'],
  ]);
});

test('admin auth and bootstrap are enabled only by a session secret and a complete credential pair', async () => {
  const runtime = readAdminRuntime({
    ADMIN_SESSION_SECRET: 'x'.repeat(32),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: 'password-hash',
  });
  const mounted = [];
  const bootstraps = [];
  const auth = { router: 'auth-router' };

  const result = await mountDatabaseApis({
    app: { use(path, router) { mounted.push([path, router]); } },
    adminStore: { async bootstrapAdmin(...args) { bootstraps.push(args); } },
    adminRuntime: runtime,
    createAuth: (secret) => {
      assert.equal(secret, 'x'.repeat(32));
      return auth;
    },
    createAdminApi: (receivedAuth) => {
      assert.equal(receivedAuth, auth);
      return 'admin-api-router';
    },
    createPublicSettings: () => 'public-settings-router',
    createManualImages: () => 'published-manual-images-router',
  });

  assert.equal(result, auth);
  assert.deepEqual(bootstraps, [['admin', 'password-hash']]);
  assert.deepEqual(mounted.map(([path]) => path), [
    '/api/admin/auth',
    '/api/admin',
    '/api/site-settings',
    '/api/public/manual-deals',
  ]);

  assert.equal(readAdminRuntime({ ADMIN_SESSION_SECRET: 'x'.repeat(32) }).bootstrap, null);
  assert.throws(() => readAdminRuntime({ ADMIN_USERNAME: 'admin' }), /must be configured together/);
  assert.throws(() => readAdminRuntime({ ADMIN_PASSWORD_HASH: 'hash' }), /must be configured together/);
});

test('production collector ignores feed overrides but preserves interval configuration', () => {
  const runtime = readCollectorRuntime({
    RSS_FEED_SOURCE: 'manual',
    RSS_FEED_URL: 'https://attacker.example/feed.xml',
    RSS_POLL_INTERVAL_MS: '12345',
  });

  assert.deepEqual(runtime, {
    source: APPROVED_FEED_SOURCE,
    feedUrl: APPROVED_FEED_URL,
    intervalMs: 12345,
    freshnessThresholdMs: 37035,
  });
  assert.equal(runtime.source, 'ppomppu');
  assert.equal(runtime.feedUrl, 'https://www.ppomppu.co.kr/rss.php?id=ppomppu');
});

test('RSS freshness threshold supports an environment override', () => {
  assert.equal(readCollectorRuntime({
    RSS_POLL_INTERVAL_MS: '600000',
    RSS_FRESHNESS_THRESHOLD_MS: '1200000',
  }).freshnessThresholdMs, 1200000);
});
