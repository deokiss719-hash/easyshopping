const test = require('node:test');
const assert = require('node:assert/strict');

const { createCollectionRunStore } = require('../src/collection-run-store');

test('collection run lifecycle records start, success counts, and sanitized failure code', async () => {
  const calls = [];
  const pool = {
    async query(query) {
      calls.push(query);
      if (query.text.startsWith('INSERT')) return { rows: [{ id: '7' }] };
      return { rows: [] };
    },
  };
  const store = createCollectionRunStore(pool, 'ppomppu');

  assert.equal(await store.start(), '7');
  await store.succeed('7', { fetched: 5, stored: 4 });
  await store.fail('7');

  assert.deepEqual(calls.map(({ values }) => values), [
    ['ppomppu'],
    [5, 4, '7'],
    ['collector_failed', '7'],
  ]);
});

test('collection status returns latest state and most recent successful completion', async () => {
  const pool = {
    async query(query) {
      assert.deepEqual(query.values, ['ppomppu']);
      return { rows: [{ latest_status: 'failed', last_success_at: '2026-09-11T11:00:00.000Z' }] };
    },
  };
  assert.deepEqual(await createCollectionRunStore(pool, 'ppomppu').getStatus(), {
    latestStatus: 'failed',
    lastSuccessAt: '2026-09-11T11:00:00.000Z',
  });
});

test('collection status uses one database round-trip with a query timeout', async () => {
  const calls = [];
  const pool = {
    async query(query) {
      calls.push(query);
      return { rows: [{ latest_status: null, last_success_at: null }] };
    },
  };
  await createCollectionRunStore(pool, 'ppomppu').getStatus({ timeoutMs: 250 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query_timeout, 250);
  assert.deepEqual(calls[0].values, ['ppomppu']);
});

test('collection lifecycle writes use a bounded database query timeout', async () => {
  const calls = [];
  const pool = {
    async query(query) {
      calls.push(query);
      if (query.text.startsWith('INSERT')) return { rows: [{ id: '8' }] };
      return { rows: [] };
    },
  };
  const store = createCollectionRunStore(pool, 'ppomppu', { queryTimeoutMs: 750 });

  await store.start();
  await store.succeed('8', { fetched: 2, stored: 1 });
  await store.fail('8');

  assert.deepEqual(calls.map(({ query_timeout: timeout }) => timeout), [750, 750, 750]);
});
