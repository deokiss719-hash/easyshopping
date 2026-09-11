const test = require('node:test');
const assert = require('node:assert/strict');

const { createOperationalHealth } = require('../src/operational-health');

function fixedNow() {
  return new Date('2026-09-11T12:00:00.000Z');
}

test('readiness is healthy only when the database is reachable and RSS success is fresh', async () => {
  const health = createOperationalHealth({
    checkDatabase: async () => {},
    getCollectionStatus: async () => ({ latestStatus: 'succeeded', lastSuccessAt: '2026-09-11T11:50:00.000Z' }),
    freshnessThresholdMs: 30 * 60 * 1000,
    now: fixedNow,
  });
  assert.deepEqual(await health.check(), {
    statusCode: 200,
    body: { ok: true, service: 'easyshopping', checks: { database: 'up', rss: 'fresh' }, reasons: [] },
  });
});

test('readiness fails closed without exposing a database error', async () => {
  const secret = 'postgres://user:password@internal/db';
  const health = createOperationalHealth({
    checkDatabase: async () => { throw new Error(secret); },
    getCollectionStatus: async () => { throw new Error('must not run'); },
    freshnessThresholdMs: 1000,
    now: fixedNow,
  });
  const result = await health.check();
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {
    ok: false,
    service: 'easyshopping',
    checks: { database: 'down', rss: 'unknown' },
    reasons: [{ code: 'database_unavailable' }],
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('readiness is pending before the first successful RSS collection', async () => {
  const health = createOperationalHealth({
    checkDatabase: async () => {},
    getCollectionStatus: async () => ({ latestStatus: 'failed', lastSuccessAt: null }),
    freshnessThresholdMs: 1000,
    now: fixedNow,
  });
  const result = await health.check();
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body.checks, { database: 'up', rss: 'pending' });
  assert.deepEqual(result.body.reasons, [{ code: 'rss_initial_collection_pending' }]);
});

test('readiness reports stale RSS success and never returns stored failure details', async () => {
  const secret = 'upstream URL with credential';
  const health = createOperationalHealth({
    checkDatabase: async () => {},
    getCollectionStatus: async () => ({ latestStatus: 'failed', lastSuccessAt: '2026-09-11T11:00:00.000Z', errorMessage: secret }),
    freshnessThresholdMs: 30 * 60 * 1000,
    now: fixedNow,
  });
  const result = await health.check();
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body.checks, { database: 'up', rss: 'stale' });
  assert.deepEqual(result.body.reasons, [{ code: 'rss_collection_stale' }]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('health handler sends the evaluated status and minimal body', async () => {
  const health = createOperationalHealth({
    checkDatabase: async () => {},
    getCollectionStatus: async () => ({ lastSuccessAt: null }),
    freshnessThresholdMs: 1000,
    now: fixedNow,
  });
  const response = {
    statusCode: null,
    payload: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; },
  };
  await health.handler({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.reasons[0].code, 'rss_initial_collection_pending');
});

test('a future RSS success timestamp is never considered fresh', async () => {
  const health = createOperationalHealth({
    getCollectionStatus: async () => ({ lastSuccessAt: '2026-09-11T12:00:00.001Z' }),
    freshnessThresholdMs: 1000,
    now: fixedNow,
  });
  const result = await health.check();
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body.checks, { database: 'up', rss: 'stale' });
});

test('readiness has a bounded deadline', async () => {
  const health = createOperationalHealth({
    getCollectionStatus: async () => new Promise(() => {}),
    freshnessThresholdMs: 1000,
    timeoutMs: 10,
    now: fixedNow,
  });
  const result = await health.check();
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body.checks, { database: 'down', rss: 'unknown' });
});
