const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testPool } = require('./helpers/saju-db');
const { createStore } = require('../src/saju/store');

test('launch price is 4,900 won and later operator changes survive schema startup', async () => {
  const pool = await testPool();
  try {
    let store = await createStore(pool, 'price-test-secret-'.repeat(3));
    assert.equal((await store.settings()).price, 4900);
    await pool.query('UPDATE saju_settings SET price=5900 WHERE id=1');
    store = await createStore(pool, 'price-test-secret-'.repeat(3));
    assert.equal((await store.settings()).price, 5900);
  } finally {
    await pool.end();
  }
});
