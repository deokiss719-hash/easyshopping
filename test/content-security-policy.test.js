const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildContentSecurityPolicy } = require('../src/content-security-policy');

test('CSP는 검증된 R2 public URL의 정확한 origin만 이미지 출처로 추가한다', () => {
  const policy = buildContentSecurityPolicy({
    enabled: true,
    publicBaseUrl: 'https://images.example.com/base',
  });

  assert.match(policy, /img-src 'self' https:\/\/ppomppu\.co\.kr https:\/\/\*\.ppomppu\.co\.kr https:\/\/images\.example\.com/);
  assert.doesNotMatch(policy, /img-src[^;]*https:\s/);
  assert.doesNotMatch(policy, /\/base/);
});

test('R2가 비활성화되면 CSP에 R2 origin을 추가하지 않고 HTML meta CSP도 사용하지 않는다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false });
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  assert.doesNotMatch(policy, /images\.example\.com/);
  assert.doesNotMatch(html, /http-equiv=["']Content-Security-Policy/i);
});
