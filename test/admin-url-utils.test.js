const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHttpsUrlInput } = require('../public/admin/url-utils');

test('admin URL input upgrades plain HTTP links to HTTPS', () => {
  assert.equal(
    normalizeHttpsUrlInput('http://pf.kakao.com/_MKxoCX'),
    'https://pf.kakao.com/_MKxoCX',
  );
});

test('admin URL input trims and preserves existing HTTPS links', () => {
  assert.equal(
    normalizeHttpsUrlInput('  https://example.com/deal  '),
    'https://example.com/deal',
  );
});
