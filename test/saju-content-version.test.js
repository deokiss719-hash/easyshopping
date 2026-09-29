const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testPool } = require('./helpers/saju-db');
const { createStore } = require('../src/saju/store');
test('narrator migration runs once and preserves subsequent admin choice', async () => {
  const pool = await testPool();
  try {
    const secret = 'content-version-test-secret-'.repeat(3);
    const store = await createStore(pool, secret);
    assert.equal((await store.settings()).report_version, 'ko-story-5');
    const saved = { price: 6900, report_version: 'ko-evidence-1', free_sections: 3, sales_enabled: false };
    await store.updateSettings(saved);
    await createStore(pool, secret);
    assert.equal((await store.settings()).report_version, 'ko-evidence-1');
    await store.updateSettings({ ...saved, report_version: 'ko-grandmother-2' });
    assert.equal((await store.settings()).report_version, 'ko-grandmother-2');
  } finally { await pool.end(); }
});
