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

test('CSP는 FMKorea 이미지와 리다이렉트 CDN의 정확한 origin만 추가한다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false }, { enabled: false });
  assert.equal(policy,
    "default-src 'self'; "
    + "img-src 'self' https://ppomppu.co.kr https://*.ppomppu.co.kr https://image.fmkorea.com https://static.toss.im https://shopping.toss.im https://ext.fmkorea.com https://i1.ruliweb.com https://i2.ruliweb.com https://i3.ruliweb.com https://*.coupangcdn.com https://www.facebook.com; "
    + "style-src 'self' https://cdn.jsdelivr.net; "
    + "font-src 'self' https://cdn.jsdelivr.net; "
    + "script-src 'self' https://connect.facebook.net; "
    + "connect-src 'self' https://www.facebook.com; "
    + "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  assert.doesNotMatch(policy, /\*\.fmkorea\.com/);
});

test('CSP는 외부 페이지 삽입과 외부 폼 전송을 차단한다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false }, { enabled: false });
  assert.match(policy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )form-action 'self'(?:;|$)/);
});

test('CSP는 루리웹 RSS thumbnail의 i1/i2/i3 정확한 origin만 허용한다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false }, { enabled: false });
  for (const host of ['i1.ruliweb.com', 'i2.ruliweb.com', 'i3.ruliweb.com']) {
    assert.match(policy, new RegExp(`img-src[^;]*https:\\/\\/${host.replaceAll('.', '\\.')}\\b`));
  }
  assert.doesNotMatch(policy, /\*\.ruliweb\.com/);
});
