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

  assert.match(policy, /img-src 'self' https:\/\/ppomppu\.co\.kr https:\/\/\*\.ppomppu\.co\.kr/);
  assert.match(policy, /img-src[^;]*https:\/\/images\.example\.com/);
  assert.doesNotMatch(policy, /img-src[^;]*https:\s/);
  assert.doesNotMatch(policy, /\/base/);
});

test('R2가 비활성화되면 CSP에 R2 origin을 추가하지 않고 HTML meta CSP도 사용하지 않는다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false });
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  assert.doesNotMatch(policy, /images\.example\.com/);
  assert.doesNotMatch(html, /http-equiv=["']Content-Security-Policy/i);
});

test('네이버 쇼핑이 활성화된 경우 공식 이미지 CDN origin만 CSP에 추가한다', () => {
  const policy = buildContentSecurityPolicy(
    { enabled: false },
    { enabled: true, imageBaseUrls: ['https://shopping-phinf.pstatic.net/'] },
  );
  assert.match(policy, /img-src[^;]*https:\/\/shopping-phinf\.pstatic\.net/);
  assert.doesNotMatch(policy, /\*\.pstatic\.net/);
});

test('네이버 자격증명이 비활성화돼도 저장된 네이버 이미지를 위한 고정 CDN origin은 유지한다', () => {
  const policy = buildContentSecurityPolicy(
    { enabled: false },
    { enabled: false, imageBaseUrls: ['https://shopping-phinf.pstatic.net/'] },
  );
  assert.match(policy, /img-src[^;]*https:\/\/shopping-phinf\.pstatic\.net/);
});

test('CSP는 쿠팡 상품 CDN 이미지만 허용하고 API, 스크립트, 프레임은 허용하지 않는다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false }, { enabled: false });
  assert.match(policy, /img-src[^;]*https:\/\/\*\.coupangcdn\.com/);
  assert.doesNotMatch(policy, /script-src[^;]*coupang/i);
  assert.doesNotMatch(policy, /frame-src[^;]*coupang/i);
  assert.doesNotMatch(policy, /connect-src[^;]*coupang/i);
});
