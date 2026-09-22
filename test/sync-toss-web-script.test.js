const test = require('node:test');
const assert = require('node:assert/strict');
const { safeFailureCode } = require('../scripts/sync-toss-web');

test('sync runner logs only allowlisted operational failure codes', () => {
  assert.equal(safeFailureCode({ code: 'toss_api_rate_limited' }), 'toss_api_rate_limited');
  assert.equal(safeFailureCode({ code: 'DATABASE_URL=secret' }), 'unknown');
  assert.equal(safeFailureCode(new Error('private response body')), 'unknown');
});
